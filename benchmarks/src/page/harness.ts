// Runs benchmark scenarios inside the browser page against one adapter.
//
// Timing model: an operation starts when the harness calls into the
// library, or for input when the page receives the event the driver sent
// (input.ts), and ends at the first frame that shows its result: checked
// just before the frame paints against what the library last drew
// (verify.ts, expect.ts), the time taken once the frame has been produced.
// For latency scenarios Chrome runs with the frame rate limit disabled, so
// waiting for frames measures work rather than vsync alignment. Paced
// scenarios run with vsync instead (paced.ts).
//
// Runs that wait for WebGL (`RunOptions.webgl`) time the same operations on
// from that frame until the GPU has also finished every WebGL context the
// page created. They are separate runs, in fresh pages, so the frame
// timings keep their meaning: waiting for the GPU after each operation
// changes how the next one overlaps with it.
//
// Before a scenario is timed, the runner checks it in a page of its own
// (`preflight`, `pixelCheck`): its operation once, verified, and then a
// screenshot showing the chart's marks where its drawing says. A library
// failing either is reported incorrect and not timed.

import { continueSeries, type PointData, random, type SeriesData } from "../datasets.ts";
import type { Scenario } from "../scenarios/index.ts";
import type { Adapter, Point } from "./adapter.ts";
import { type ChartData, hovered, redrawn, resized, seriesOf, turned, zoomed } from "./expect.ts";
import {
  type AnyHandle,
  clearStage,
  create,
  kindFor,
  makeData,
  optionsFor,
  resizeTo,
  stage,
} from "./fixtures.ts";
import { nextFrame, refreshInterval } from "./frames.ts";
import { nextArrival } from "./input.ts";
import { type LoadResult, runLoad } from "./load.ts";
import { runIngest, runOrbit, startTrace, type Trace } from "./paced.ts";
import { decode, pixelsWrong } from "./pixels.ts";
import {
  cameraAngles,
  type PageResult,
  type RunOptions,
  runDashboard,
  runInit,
  runResize,
  runRotate,
  runStream,
  runUpdate,
  runZoom,
  windowsAfter,
} from "./timed.ts";
import { Incorrect, verifiedOperation, watchFrames } from "./verify.ts";
import { finishWebgl, gpuName, webglContextsCreated } from "./webgl.ts";

export type { Metric } from "./fixtures.ts";
export type { PageResult, RunOptions } from "./timed.ts";

/** How long a hovered point may take to show: more than any library's hover throttle. */
const HOVER_WITHIN_MS = 2000;

/**
 * Runs `run` (a scenario, from mounting to cleanup), failing it when a chart
 * fails outside the calls it returned from: in a promise the library does
 * not hand back, or in an animation frame. ResizeObserver's loop notices,
 * which browsers report as errors though nothing failed, do not count.
 */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  let failure: { reason: unknown } | undefined;
  const rejected = (event: PromiseRejectionEvent) => {
    failure ??= { reason: event.reason };
  };
  const thrown = (event: ErrorEvent) => {
    if (!event.message.includes("ResizeObserver loop")) failure ??= { reason: event.error };
  };
  window.addEventListener("unhandledrejection", rejected);
  window.addEventListener("error", thrown);
  try {
    const result = await run();
    // Failures from cleaning up arrive after it: a frame later at the latest.
    await nextFrame();
    if (failure) throw failure.reason;
    return result;
  } finally {
    window.removeEventListener("unhandledrejection", rejected);
    window.removeEventListener("error", thrown);
  }
}

/** A scenario's result once it failed a check: incorrect, untimed. */
function incorrect(error: unknown): PageResult {
  if (error instanceof Incorrect)
    return {
      supported: false,
      incorrect: true,
      reason: `incorrect: ${error.message}`,
      metrics: {},
    };
  throw error;
}

/**
 * The bytes of the source data itself, as the harness made it: typed
 * arrays' bytes, each byte of a buffer once however many arrays view it
 * (series sharing an x column count it once), and strings at two bytes a
 * UTF-16 code unit.
 */
export function dataBytes(data: unknown): number {
  const views = new Map<ArrayBufferLike, [start: number, end: number][]>();
  const seen = new Set<unknown>();
  let bytes = 0;
  const visit = (value: unknown): void => {
    if (typeof value === "string") bytes += value.length * 2;
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (ArrayBuffer.isView(value)) {
      const ranges = views.get(value.buffer) ?? [];
      ranges.push([value.byteOffset, value.byteOffset + value.byteLength]);
      views.set(value.buffer, ranges);
      return;
    }
    for (const item of Array.isArray(value) ? value : Object.values(value)) visit(item);
  };
  visit(data);
  for (const ranges of views.values()) {
    ranges.sort((a, b) => a[0] - b[0]);
    let end = 0;
    for (const [start, stop] of ranges) {
      if (stop > end) bytes += stop - Math.max(start, end);
      end = Math.max(end, stop);
    }
  }
  return bytes;
}

/** A mount: supported and drawn, or why not (`incorrect` when no frame showed the chart drawn). */
export interface Mounted {
  supported: boolean;
  incorrect?: boolean;
  reason?: string;
}

export type PointerResult =
  | { latency: number; rejected: number; checkTime: number; queued: number }
  | { reason: string };

export interface Bench {
  id: string;
  renderer: Adapter["renderer"];
  verification: string;
  run(s: Scenario, options?: RunOptions): Promise<PageResult>;
  /** Creates source data only, so its memory can be excluded; returns its bytes (`dataBytes`). */
  prepareData(s: Scenario): number;
  /** Mounts the scenario's charts, each verified drawn, for hover, traces, memory, and checks. */
  mount(s: Scenario): Promise<Mounted>;
  hoverTargets(s: Scenario, count: number): Point[];
  /** DOM elements and estimated canvas backing-store bytes under the stage. */
  footprint(): { domNodes: number; canvasBytes: number };
  /** WebGL contexts the page has created since it loaded. */
  webglContexts(): number;
  /**
   * Times the next trusted pointer move to `target` (or with `event`
   * "pointerdown", a tap there, on touch screens), from its arrival to the
   * first frame whose readout shows the item there, or with `webgl` until
   * WebGL drawing finished too.
   */
  armPointer(target: Point, options?: RunOptions, event?: "pointermove" | "pointerdown"): void;
  pointerLatency(): Promise<PointerResult>;
  /** Starts watching a sustained trace of moves over the mounted chart; `traceStop` reports it. */
  traceStart(s: Scenario): Promise<void>;
  /** The trace's metrics, or why it was incorrect: its last move never showed. */
  traceStop(): Promise<Pick<PageResult, "metrics" | "distributions"> | { reason: string }>;
  /**
   * The check before timing, on the mounted charts: the scenario's
   * operation once, verified (hover and traces excepted: the runner moves
   * the pointer). What was wrong, if anything.
   */
  preflight(s: Scenario): Promise<string | undefined>;
  /** What a screenshot of the viewport (base64 PNG in CSS pixels) shows wrong of the mounted charts in view, if anything. */
  pixelCheck(s: Scenario, screenshot: string): Promise<string | undefined>;
  unmount(): Promise<void>;
  gpu(): string;
  /** Median requestAnimationFrame interval while idle, in milliseconds. */
  refreshInterval(): Promise<number>;
}

declare global {
  interface Window {
    bench: Bench;
    /** A load run's result, set when the page was opened to run one (load.ts). */
    benchLoad?: LoadResult | { error: string; incorrect: boolean };
  }
}

// State for scenarios driven step by step from Node (hover, traces, memory, checks).
let mountedScenario: Scenario | undefined;
let active: AnyHandle[] = [];
let retainedData: ChartData[] = [];
/** What each mounted chart shows now, for the pixel check: its data after the checked operation. */
let shownData: ChartData[] = [];
let pointerDone: Promise<PointerResult> = Promise.resolve({ reason: "no move armed" });
let trace: Trace | undefined;

function unsupported(adapter: Adapter, s: Scenario): PageResult | undefined {
  if (kindFor(adapter, s)) return undefined;
  return {
    supported: false,
    reason: `${adapter.id} has no built-in ${s.chart} chart`,
    metrics: {},
  };
}

/** Client positions of data points to aim pointer moves at. */
function hoverTargets(s: Scenario, count: number): Point[] {
  const handle = active[0]!;
  const data = retainedData[0]!;
  const targets: Point[] = [];
  if (s.chart === "scatter" || s.chart === "bubble") {
    const points = data as PointData;
    const next = random(42);
    for (let i = 0; i < count; i++) {
      const index = Math.floor(next() * points.x.length);
      targets.push(handle.pixelOf(0, index, points.x[index]!, points.y[index]!));
    }
    return targets;
  }
  const series = data as SeriesData;
  const length = series.x.length;
  for (let i = 0; i < count; i++) {
    // Sweep from 5% to 95% of the series, left to right.
    const index = Math.round(length * (0.05 + (0.9 * i) / Math.max(1, count - 1)));
    targets.push(handle.pixelOf(0, index, series.x[index]!, series.ys[0]![index]!));
  }
  return targets;
}

async function runScenario(
  adapter: Adapter,
  s: Scenario,
  options: RunOptions,
): Promise<PageResult> {
  const missing = unsupported(adapter, s);
  if (missing) return missing;
  const kind = kindFor(adapter, s)!;
  switch (s.operation) {
    case "init":
      return runInit(kind, s);
    case "update":
      return runUpdate(kind, s);
    case "stream":
      return runStream(kind, s, options);
    case "ingest":
      return runIngest(kind, s);
    case "resize":
      return runResize(kind, s, options);
    case "zoom":
      return runZoom(kind, s, options);
    case "dashboard":
      return runDashboard(kind, s);
    case "rotate":
      return runRotate(kind, s, options);
    case "orbit":
      return runOrbit(kind, s);
    default:
      throw new Error(`${s.operation} is driven by the runner`);
  }
}

/** The x extent of points, which need not be sorted. */
function extentOf(xs: Float64Array): [number, number] {
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const x of xs) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
  }
  return [x0, x1];
}

/**
 * The scenario's operation once on the mounted charts, verified as the
 * timed runs verify it; sets `shownData` to what they show after it.
 */
async function operateOnce(s: Scenario): Promise<void> {
  const handle = active[0]!;
  const before = handle.drawn().draws;
  const pending = () => handle.rendered?.();
  switch (s.operation) {
    case "update":
    case "dashboard": {
      const next = active.map((_, c) => makeData(s, 101 + c));
      const counts = active.map((h) => h.drawn().draws);
      await verifiedOperation(
        () => Promise.all(active.map((h, c) => h.setData(next[c]!))),
        () => {
          for (const [c, h] of active.entries()) {
            const wrong = redrawn(h.drawn(), counts[c]!, seriesOf(s.chart, next[c]!));
            if (wrong) return `chart ${c + 1}: ${wrong}`;
          }
          return undefined;
        },
        pending,
      );
      shownData = next;
      return;
    }
    case "stream":
    case "ingest": {
      if (!handle.append) return;
      // Every chart appended to in one task, as the timed runs do.
      const datasets = retainedData as SeriesData[];
      const batches = datasets.map((data) => continueSeries(data, s.append ?? 1, 0));
      const expected = datasets.map((data, c) => windowsAfter(data, [batches[c]!], s.points)[0]!);
      const counts = active.map((h) => h.drawn().draws);
      await verifiedOperation(
        () => Promise.all(active.map((h, c) => h.append!(batches[c]!.x, batches[c]!.ys, s.points))),
        () => {
          for (const [c, h] of active.entries()) {
            const wrong = redrawn(h.drawn(), counts[c]!, expected[c]!);
            if (wrong) return `chart ${c + 1}: ${wrong}`;
          }
          return undefined;
        },
        pending,
      );
      const kept = (a: Float64Array, b: Float64Array) => {
        const joined = new Float64Array(a.length + b.length);
        joined.set(a);
        joined.set(b, a.length);
        return joined.subarray(Math.max(0, joined.length - s.points));
      };
      // Every series, so the pixel check knows where later ones cover series 0.
      shownData = datasets.map((data, c) => ({
        x: kept(data.x, batches[c]!.x),
        ys: data.ys.map((y, k) => kept(y, batches[c]!.ys[k]!)),
        names: data.names,
      }));
      return;
    }
    case "zoom": {
      if (!handle.setViewport) return;
      const [x0, x1] = extentOf((retainedData[0] as SeriesData | PointData).x);
      const [from, to] = [x0 + (x1 - x0) * 0.3, x0 + (x1 - x0) * 0.4];
      await verifiedOperation(
        () => handle.setViewport!(from, to),
        () => zoomed(handle.drawn(), before, from, to),
        pending,
      );
      return;
    }
    case "resize": {
      const { width, height } = resizeTo(0);
      const container = stage().lastElementChild as HTMLElement;
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      await verifiedOperation(
        () => handle.resize(width, height),
        () => resized(handle.drawn(), before, width, height),
        pending,
      );
      return;
    }
    case "rotate":
    case "orbit": {
      if (!handle.setCamera) return;
      const [azimuth, elevation] = cameraAngles(3)[2]!;
      await verifiedOperation(
        () => handle.setCamera!(azimuth, elevation),
        () => turned(handle.drawn(), before, azimuth, elevation),
        pending,
      );
      return;
    }
    default:
      // Mounting (init, memory) was verified as it mounted; hover and traces move the pointer from the runner.
      return;
  }
}

export function installHarness(adapter: Adapter): void {
  const evaluated = performance.now();
  const bench: Bench = {
    id: adapter.id,
    renderer: adapter.renderer,
    verification: adapter.verification,
    refreshInterval: () => refreshInterval(),
    // Every scenario, from mounting to cleanup, fails on failures reported outside its calls.
    run: (s, options = {}) => guarded(() => runScenario(adapter, s, options)).catch(incorrect),
    prepareData(s) {
      retainedData = Array.from({ length: s.charts ?? 1 }, (_, c) => makeData(s, 1 + c));
      shownData = retainedData;
      return dataBytes(retainedData);
    },
    mount: (s) =>
      guarded(async () => {
        const missing = unsupported(adapter, s);
        if (missing) return missing;
        const kind = kindFor(adapter, s)!;
        const options = optionsFor(s);
        if (retainedData.length === 0) bench.prepareData(s);
        mountedScenario = s;
        active = [];
        for (const data of retainedData) active.push(await create(kind, s, data, options));
        await nextFrame();
        return { supported: true };
      }).catch(incorrect),
    hoverTargets,
    footprint() {
      const root = stage();
      let canvasBytes = 0;
      for (const canvas of root.querySelectorAll("canvas"))
        canvasBytes += canvas.width * canvas.height * 4;
      return { domNodes: root.getElementsByTagName("*").length, canvasBytes };
    },
    webglContexts: webglContextsCreated,
    armPointer(target, options, event = "pointermove") {
      const handle = active[0]!;
      const data = retainedData[0] as SeriesData | PointData;
      const kind = mountedScenario!.chart;
      pointerDone = nextArrival(
        (arrival) =>
          arrival.type === event &&
          Math.abs(arrival.x - target.x) <= 1 &&
          Math.abs(arrival.y - target.y) <= 1,
      ).then(async (arrival) => {
        const at = { pointer: { x: arrival.x, y: arrival.y }, kind, data };
        try {
          const verified = await watchFrames(
            arrival.at,
            () => hovered(handle.drawn(), at),
            () => true,
            HOVER_WITHIN_MS,
          ).shown;
          let latency = verified.time;
          if (options?.webgl) {
            finishWebgl();
            latency = performance.now() - arrival.at;
          }
          return {
            latency,
            rejected: verified.rejected,
            checkTime: verified.checkTime,
            queued: arrival.at - arrival.timeStamp,
          };
        } catch (error) {
          if (error instanceof Incorrect) return { reason: `incorrect: ${error.message}` };
          throw error;
        }
      });
    },
    pointerLatency: () => pointerDone,
    async traceStart(s) {
      trace = await startTrace(active[0]!, s, retainedData[0] as SeriesData);
    },
    async traceStop() {
      try {
        const metrics = await trace!.stop();
        return { metrics, distributions: trace!.distributions() };
      } catch (error) {
        if (error instanceof Incorrect) return { reason: `incorrect: ${error.message}` };
        throw error;
      } finally {
        trace = undefined;
      }
    },
    preflight: (s) =>
      guarded(async () => {
        await operateOnce(s);
        return undefined;
      }).catch((error) => {
        if (error instanceof Incorrect) return `incorrect: ${error.message}`;
        throw error;
      }),
    async pixelCheck(s, screenshot) {
      const { pixel } = await decode(screenshot);
      for (const [k, handle] of active.entries()) {
        const rect = stage().children[k]!.getBoundingClientRect();
        // Charts below the viewport are not in the screenshot.
        if (rect.bottom > innerHeight || rect.right > innerWidth) continue;
        const chartBox = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        const wrong = pixelsWrong(pixel, handle.drawn(), s.chart, s.series, shownData[k], chartBox);
        if (wrong) return `incorrect: ${active.length > 1 ? `chart ${k + 1}: ` : ""}${wrong}`;
      }
      return undefined;
    },
    unmount: () =>
      guarded(async () => {
        for (const handle of active) handle.destroy();
        active = [];
        retainedData = [];
        shownData = [];
        mountedScenario = undefined;
        clearStage();
      }),
    gpu: gpuName,
  };
  window.bench = bench;
  // Opened to time a load: the scenario is in the address, so no driver call stands between.
  const load = new URLSearchParams(location.search).get("load");
  if (load)
    runLoad(adapter, JSON.parse(atob(load)) as Scenario, evaluated).then(
      (result) => {
        window.benchLoad = result;
      },
      (error: Error) => {
        window.benchLoad = {
          error: `${error.name}: ${error.message}`,
          incorrect: error instanceof Incorrect,
        };
      },
    );
}
