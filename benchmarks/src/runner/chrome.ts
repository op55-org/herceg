// Chrome settings and DevTools helpers shared by the chart and grid runners.

import { execFileSync } from "node:child_process";
import type { CDPSession, Page } from "playwright";

export const COMMON_ARGS = [
  "--js-flags=--expose-gc",
  "--disable-renderer-backgrounding",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
];
// Latency scenarios produce frames as fast as work allows; paced scenarios
// keep vsync so frame intervals mean what users see.
export const LATENCY_ARGS = [...COMMON_ARGS, "--disable-frame-rate-limit", "--disable-gpu-vsync"];
export const REALTIME_ARGS = COMMON_ARGS;

/** Waits for `promise` at most `ms`, ignoring its outcome. */
export function bounded(promise: Promise<unknown>, ms = 10_000): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    promise.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        resolve();
      },
    );
  });
}

interface HeapUsage {
  usedSize: number;
  totalSize: number;
  embedderHeapUsedSize?: number;
  backingStorageSize?: number;
}

/** Heap in use after forced garbage collection. */
export async function heapBytes(cdp: CDPSession) {
  await cdp.send("HeapProfiler.collectGarbage");
  await cdp.send("HeapProfiler.collectGarbage");
  const usage = (await cdp.send("Runtime.getHeapUsage")) as HeapUsage;
  // V8 heap + Blink (Oilpan) heap + ArrayBuffer backing stores. Typed arrays
  // live in backing stores, so leaving them out would hide columnar data.
  return {
    js: usage.usedSize,
    embedder: usage.embedderHeapUsedSize ?? 0,
    backing: usage.backingStorageSize ?? 0,
    total: usage.usedSize + (usage.embedderHeapUsedSize ?? 0) + (usage.backingStorageSize ?? 0),
  };
}

/**
 * Heap reserved now, without collecting garbage: V8's committed heap plus
 * the Blink heap and ArrayBuffer backing stores, garbage included. Read
 * before and after an operation, it shows how much the operation made the
 * heap grow; it is not the operation's peak.
 */
export async function committedBytes(cdp: CDPSession): Promise<number> {
  const usage = (await cdp.send("Runtime.getHeapUsage")) as HeapUsage;
  return usage.totalSize + (usage.embedderHeapUsedSize ?? 0) + (usage.backingStorageSize ?? 0);
}

type TraceEvent = {
  name: string;
  ph: string;
  pid: number;
  args?: Record<string, unknown>;
};

/** Records a trace of `categories` on `cdp` while `body` runs. */
async function trace(
  cdp: CDPSession,
  categories: string[],
  body: () => Promise<unknown>,
): Promise<TraceEvent[]> {
  const events: TraceEvent[] = [];
  const collect = (event: { value: unknown[] }) => {
    events.push(...(event.value as TraceEvent[]));
  };
  cdp.on("Tracing.dataCollected", collect);
  const complete = new Promise<void>((resolve) =>
    cdp.once("Tracing.tracingComplete", () => resolve()),
  );
  try {
    await cdp.send("Tracing.start", {
      traceConfig: {
        includedCategories: categories,
        excludedCategories: ["*"],
        // No periodic dumps: memory dumps only when asked for.
        memoryDumpConfig: { triggers: [] } as unknown as Record<string, string>,
      },
      transferMode: "ReportEvents",
    });
    await body();
    await cdp.send("Tracing.end");
    await complete;
  } finally {
    cdp.off("Tracing.dataCollected", collect);
  }
  return events;
}

/**
 * The process id of the renderer showing a page: the trace a page's own
 * DevTools session starts lists its frames with their processes.
 */
export async function rendererPid(page: CDPSession): Promise<number> {
  const events = await trace(page, ["disabled-by-default-devtools.timeline"], async () => {});
  const started = events.find((event) => event.name === "TracingStartedInBrowser");
  const frames = (
    started?.args?.data as { frames?: { processId: number; isOutermostMainFrame?: boolean }[] }
  )?.frames;
  const main = frames?.find((frame) => frame.isOutermostMainFrame) ?? frames?.[0];
  if (!main) throw new Error("rendererPid: the page's trace lists no frames; is this Chrome?");
  return main.processId;
}

/**
 * A process's physical footprint: the kernel's `phys_footprint`, which
 * Activity Monitor shows as a process's memory, read with macOS's
 * `footprint`. Undefined elsewhere.
 */
export function physFootprint(pid: number): number | undefined {
  if (process.platform !== "darwin") return undefined;
  const output = execFileSync("footprint", ["-p", String(pid), "-f", "bytes", "--noCategories"], {
    stdio: ["ignore", "pipe", "ignore"],
  }).toString();
  const match = /phys_footprint:\s*(\d+)/.exec(output);
  if (!match) throw new Error(`physFootprint: no phys_footprint for process ${pid}`);
  return Number(match[1]);
}

/** GPU memory Chrome's memory instrumentation attributes to a renderer, in bytes. */
export interface GpuMemory {
  /** WebGL buffers, textures, renderbuffers, and drawing buffers. */
  webgl: number;
  /** 2D canvas resources (GPU textures for accelerated canvases). */
  canvas: number;
  /** Compositor tiles rasterized for the page's content. */
  tiles: number;
}

/**
 * The GPU memory a renderer's own memory dump attributes to it (Chrome's
 * memory-infra, detailed level, which lists canvas resources). The GPU
 * process holds these allocations; the renderer's dump names them.
 * `browser` is a browser-level DevTools session.
 */
export async function gpuMemory(browser: CDPSession, pid: number): Promise<GpuMemory> {
  const events = await trace(browser, ["disabled-by-default-memory-infra"], () =>
    browser.send("Tracing.requestMemoryDump", { deterministic: false, levelOfDetail: "detailed" }),
  );
  const dump = events.find((event) => event.ph === "v" && event.pid === pid && dumpOf(event));
  if (!dump) throw new Error(`gpuMemory: the memory dump has no allocators for process ${pid}`);
  const allocators = dumpOf(dump)!;
  const size = (name: string) => {
    const value = allocators[name]?.attrs?.size?.value;
    return value ? Number.parseInt(value, 16) : 0;
  };
  let canvas = 0;
  for (const name of Object.keys(allocators))
    if (/^canvas\/[^/]+$/.test(name)) canvas += size(name);
  return { webgl: size("webgl"), canvas, tiles: size("cc/tile_memory") };
}

type Allocators = Record<string, { attrs?: { size?: { value: string } } }>;

function dumpOf(event: TraceEvent): Allocators | undefined {
  return (event.args?.dumps as { allocators?: Allocators } | undefined)?.allocators;
}

/**
 * Pause after forced garbage collection before reading process memory, so
 * work a mount leaves for later frames (compositor tiles, canvas resources)
 * is done. The renderer's footprint read 0, 0.1, 0.5, 1, and 2 s after
 * collection agreed within 0.1 MB; one interval for every library.
 */
export const PROCESS_SETTLE_MS = 500;

/**
 * The page's renderer footprint and the GPU memory attributed to it, after
 * a settling pause; call it right after a heap reading, which collects
 * garbage. `browser` is a browser-level DevTools session.
 */
export async function processMemory(page: Page, browser: CDPSession, pid: number) {
  await page.waitForTimeout(PROCESS_SETTLE_MS);
  return { renderer: physFootprint(pid), gpu: await gpuMemory(browser, pid) };
}

type ProcessMemory = Awaited<ReturnType<typeof processMemory>>;

/** Growth between two `processMemory` readings as named metrics; `rendererBytes` only where measured. */
export function processGrowth(before: ProcessMemory, after: ProcessMemory): Record<string, number> {
  const gpu = (key: keyof GpuMemory) => after.gpu[key] - before.gpu[key];
  return {
    ...(after.renderer !== undefined &&
      before.renderer !== undefined && { rendererBytes: after.renderer - before.renderer }),
    gpuBytes: gpu("webgl") + gpu("canvas") + gpu("tiles"),
    gpuWebglBytes: gpu("webgl"),
    gpuCanvasBytes: gpu("canvas"),
    gpuTileBytes: gpu("tiles"),
  };
}
