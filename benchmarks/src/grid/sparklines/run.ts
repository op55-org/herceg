// Sparkline benchmark: a 1,000-row grid whose sparkline column draws each
// row's series from a million-row table, in Herceg's grid, TanStack Table,
// and Glide Data Grid (see page.tsx and benchmarks/README.md, "Sparklines").
// AG Grid's sparklines are Enterprise, so it is not compared.
//
//   npm run bench:grid-sparklines -- [--lib herceg,tanstack-table,glide]
//                                    [--gaps none,alternate] [--out results/grid-sparklines.json]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import * as esbuild from "esbuild";
import { type Browser, chromium, type Page } from "playwright";
import { HERCEG_ALIAS, ROOT, serve } from "../../runner/build.ts";
import { heapBytes, LATENCY_ARGS, REALTIME_ARGS } from "../../runner/chrome.ts";
import { commit, machine, packageVersion } from "../../runner/environment.ts";
import { type Summary, summarize } from "../../runner/stats.ts";
import type { sparkBench } from "./page.tsx";

const LIBRARIES: Record<string, string> = {
  herceg: "herceg",
  "tanstack-table": "@tanstack/react-table",
  glide: "@glideapps/glide-data-grid",
};

const { values: args } = parseArgs({
  options: {
    lib: { type: "string" },
    gaps: { type: "string", default: "none,alternate" },
    out: { type: "string" },
    headless: { type: "boolean", default: false },
    seed: { type: "string", default: "1" },
  },
});

const libraries = args.lib ? args.lib.split(",") : Object.keys(LIBRARIES);
for (const id of libraries) if (!LIBRARIES[id]) throw new Error(`unknown library ${id}`);
const gapsCases = args.gaps.split(",");
for (const gaps of gapsCases)
  if (gaps !== "none" && gaps !== "alternate") throw new Error(`unknown gaps ${gaps}`);
const SEED = Number(args.seed);
const MOUNTS = { samples: 10, warmup: 2 };
const STEPS = { samples: 30, warmup: 5 };
/** Screens a step moves down (568 px), wrapping before the end. */
const SCREEN = 568;
const TRACE = { speed: 100, ms: 3000, trials: 2 };
const STREAM = { rateHz: 10, ms: 5000, trials: 2 };
const MEMORY = { screens: 10, samples: 3 };
const VIEWPORT = { width: 1280, height: 720 };

declare global {
  interface Window {
    sparkBench: typeof sparkBench;
  }
}

interface Metric {
  unit: "ms" | "count" | "bytes" | "ratio";
  samples: number[];
  summary?: Summary;
}

async function build() {
  await esbuild.build({
    stdin: {
      contents: `import "./src/grid/sparklines/page.tsx";`,
      resolveDir: ROOT,
      sourcefile: "grid-sparklines-entry.ts",
      loader: "ts",
    },
    bundle: true,
    minify: true,
    format: "esm",
    target: "es2022",
    jsx: "automatic",
    outfile: join(ROOT, ".build", "grid-sparklines.js"),
    define: { "process.env.NODE_ENV": '"production"' },
    alias: HERCEG_ALIAS,
    logLevel: "warning",
  });
}

/** A fresh page with the series made (`gaps`: every other value of each series missing). */
async function open(browser: Browser, origin: string, gaps: boolean): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  await page.goto(`${origin}/grid-sparklines.html`);
  await page.waitForFunction(() => window.sparkBench !== undefined);
  await page.evaluate(([g, seed]) => window.sparkBench.prepare(g, seed), [gaps, SEED] as const);
  return page;
}

/**
 * Heap growth from mounting `library`'s grid and visiting screens, in a
 * fresh page with the series made, and what is left a second after
 * destroying it; with the DOM nodes it had.
 */
async function memory(browser: Browser, origin: string, gaps: boolean, library: string) {
  const page = await open(browser, origin, gaps);
  const cdp = await page.context().newCDPSession(page);
  const base = await heapBytes(cdp);
  await page.evaluate((l) => window.sparkBench.mount(l), library);
  await page.evaluate((n) => window.sparkBench.visit(n), MEMORY.screens);
  const mounted = await heapBytes(cdp);
  const nodes = await page.evaluate(() => window.sparkBench.domNodes());
  await page.evaluate(() => window.sparkBench.destroy());
  await new Promise((done) => setTimeout(done, 1000));
  const destroyed = await heapBytes(cdp);
  await page.context().close();
  return { retained: mounted.total - base.total, destroyed: destroyed.total - base.total, nodes };
}

async function main() {
  await build();
  const { server, origin } = await serve();
  const launch = (realtime: boolean) =>
    chromium.launch({
      channel: "chrome",
      headless: args.headless,
      args: realtime ? REALTIME_ARGS : LATENCY_ARGS,
    });
  const fast = await launch(false);
  const paced = await launch(true);
  const results: { library: string; gaps: string; metrics: Record<string, Metric> }[] = [];
  for (const gapsCase of gapsCases) {
    const gaps = gapsCase === "alternate";
    for (const library of libraries) {
      const metrics: Record<string, Metric> = {
        mount: { unit: "ms", samples: [] },
        step: { unit: "ms", samples: [] },
        traceIncomplete: { unit: "ratio", samples: [] },
        traceDropped: { unit: "count", samples: [] },
        traceFrame: { unit: "ms", samples: [] },
        streamLatency: { unit: "ms", samples: [] },
        streamOvertaken: { unit: "count", samples: [] },
        streamDropped: { unit: "count", samples: [] },
      };
      // Mounts and steps, with the frame rate limit off: times are the grids' own.
      const page = await open(fast, origin, gaps);
      for (let i = 0; i < MOUNTS.warmup + MOUNTS.samples; i++) {
        const time = await page.evaluate((l) => window.sparkBench.mount(l), library);
        if (i >= MOUNTS.warmup) metrics.mount!.samples.push(time);
        if (i < MOUNTS.warmup + MOUNTS.samples - 1)
          await page.evaluate(() => window.sparkBench.destroy());
      }
      for (let i = 0; i < STEPS.warmup + STEPS.samples; i++) {
        const top = ((i + 1) * SCREEN) % (SCREEN * 45);
        const time = await page.evaluate((t) => window.sparkBench.step(t), top);
        if (i >= STEPS.warmup) metrics.step!.samples.push(time);
      }
      await page.context().close();
      // Traces and streams, with vsync: frames as users see them.
      for (let trial = 0; trial < TRACE.trials; trial++) {
        const traced = await open(paced, origin, gaps);
        await traced.evaluate((l) => window.sparkBench.mount(l), library);
        const trace = await traced.evaluate(([speed, ms]) => window.sparkBench.trace(speed, ms), [
          TRACE.speed,
          TRACE.ms,
        ] as const);
        metrics.traceIncomplete!.samples.push(trace.incomplete / trace.frames);
        metrics.traceDropped!.samples.push(trace.dropped);
        metrics.traceFrame!.samples.push(...trace.intervals);
        await traced.context().close();
      }
      for (let trial = 0; trial < STREAM.trials; trial++) {
        const streamed = await open(paced, origin, gaps);
        await streamed.evaluate((l) => window.sparkBench.mount(l), library);
        const stream = await streamed.evaluate(([rate, ms]) => window.sparkBench.stream(rate, ms), [
          STREAM.rateHz,
          STREAM.ms,
        ] as const);
        metrics.streamLatency!.samples.push(...stream.latencies);
        metrics.streamOvertaken!.samples.push(stream.overtaken);
        metrics.streamDropped!.samples.push(stream.dropped);
        await streamed.context().close();
      }
      const held = { retained: [] as number[], destroyed: [] as number[], nodes: [] as number[] };
      for (let sample = 0; sample < MEMORY.samples; sample++) {
        const one = await memory(fast, origin, gaps, library);
        held.retained.push(one.retained);
        held.destroyed.push(one.destroyed);
        held.nodes.push(one.nodes);
      }
      metrics.retainedBytes = { unit: "bytes", samples: held.retained };
      metrics.destroyedBytes = { unit: "bytes", samples: held.destroyed };
      metrics.domNodes = { unit: "count", samples: held.nodes };
      if (library === "herceg") {
        // The index and paths: over the same grid with the trend column empty.
        const empty: number[] = [];
        for (let sample = 0; sample < MEMORY.samples; sample++)
          empty.push((await memory(fast, origin, gaps, "herceg-empty")).retained);
        metrics.emptyColumnRetainedBytes = { unit: "bytes", samples: empty };
      }
      for (const metric of Object.values(metrics)) metric.summary = summarize(metric.samples);
      results.push({ library, gaps: gapsCase, metrics });
      const m = (id: string, digits = 1) => metrics[id]!.summary!.median.toFixed(digits);
      const mib = (id: string) => (metrics[id]!.summary!.median / 2 ** 20).toFixed(2);
      const p95 = (id: string) => metrics[id]!.summary!.p95.toFixed(1);
      console.log(
        `${library} (gaps ${gapsCase}): mount ${m("mount")} ms, step ${m("step")} ms (p95 ${p95("step")}), trace frame ${m("traceFrame")} ms (p95 ${p95("traceFrame")}), incomplete ${m("traceIncomplete", 3)}, dropped ${m("traceDropped", 0)}; stream latency ${m("streamLatency")} ms (p95 ${p95("streamLatency")}), overtaken ${m("streamOvertaken", 0)}, dropped ${m("streamDropped", 0)}; retained ${mib("retainedBytes")} MiB${metrics.emptyColumnRetainedBytes ? ` (${mib("emptyColumnRetainedBytes")} with the column empty)` : ""}, after destroy ${mib("destroyedBytes")} MiB, ${m("domNodes", 0)} nodes`,
      );
    }
  }
  const browserVersion = fast.version();
  await fast.close();
  await paced.close();
  server.close();
  const output = {
    date: new Date().toISOString(),
    commit: commit(),
    method: {
      data: "1,000 keys x 1,000 points, interleaved in time order (1,000,000 series rows), random walks; 'alternate' gaps: every other value of each series missing. The grid: 1,000 rows (id, key, sparkline 160 px wide)",
      drawing:
        "Herceg: sparklineCell. TanStack Table and Glide: adapter code (series.ts): each key's rows kept as rows arrive, M4 per device-pixel column with gaps narrower than a pixel joined, SVG path data (TanStack) or canvas drawing (Glide), cached per key and data version",
      correct:
        "every row crossing the viewport shows its line, ending where the row's last value is (within 0.11 px), read just before the frame paints",
      mount:
        "from creating the grid (Herceg's table included) to the first correct frame; frame rate limit off",
      step: "scroll a screen (568 px) down, wrapping, to the first correct frame; frame rate limit off",
      trace: `${TRACE.speed} rows a second for ${TRACE.ms / 1000} s, the offset set every frame (vsync on); frame intervals, incomplete frames (some row in view not showing its line as the data is), dropped frames (intervals spanning k refreshes miss k - 1)`,
      stream: `a point appended to every key (1,000 rows) at ${STREAM.rateHz} Hz for ${STREAM.ms / 1000} s, the grid at the top (vsync on): each tick's latency to the first frame showing it, ticks a later one overtook, dropped frames`,
      memory: `CDP Runtime.getHeapUsage after forced GC with the grid mounted and ${MEMORY.screens} screens visited, over the same page before mounting (the series made, no grid ever mounted: code loaded once and caches a library keeps are counted), and a second after destroying it; ${MEMORY.samples} fresh pages each. For Herceg, also its grid with the trend column empty: the difference is the sparklines' index and paths`,
      mounts: MOUNTS,
      steps: STEPS,
      traceTrials: TRACE.trials,
      streamTrials: STREAM.trials,
      seed: SEED,
    },
    environment: {
      ...machine(),
      browser: `Chrome ${browserVersion}`,
      headless: args.headless,
      viewport: VIEWPORT,
      devicePixelRatio: 1,
      grid: { width: 1200, height: 600, rowHeight: 28, headerHeight: 32 },
      browserSettings: { fast: LATENCY_ARGS, paced: REALTIME_ARGS },
      playwright: packageVersion("playwright"),
    },
    libraries: Object.fromEntries(
      libraries.map((id) => [
        id,
        { package: LIBRARIES[id], version: packageVersion(LIBRARIES[id]!) },
      ]),
    ),
    notCompared: { "ag-grid": "AG Grid's sparklines are Enterprise (AG Grid Community has none)" },
    results,
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const out = args.out
    ? resolve(ROOT, args.out)
    : join(ROOT, "..", "tmp", "benchmarks", `grid-sparklines-${stamp}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(output, null, 1)}\n`);
  console.log(`\nWrote ${out}`);
}

await main();
