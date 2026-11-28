// Operations timed one at a time, each from the harness's call to the first
// frame that shows its result (verify.ts): mounting, replacing the data,
// appending, zooming, resizing, turning a 3D camera, and a dashboard's
// mount and refresh. Runs that wait for WebGL go on from that frame until
// the GPU has finished every WebGL context the page made (webgl.ts).

import { continueSeries, type PointData, type SeriesData } from "../datasets.ts";
import type { Scenario } from "../scenarios/index.ts";
import type { ChartKind, ChartOptions, SeriesShown } from "./adapter.ts";
import { type ChartData, mounted, redrawn, resized, seriesOf, turned, zoomed } from "./expect.ts";
import {
  type AnyHandle,
  box,
  clearStage,
  create,
  type Metric,
  makeData,
  metric,
  optionsFor,
  resizeTo,
  stage,
} from "./fixtures.ts";
import { nextFrame } from "./frames.ts";
import { type Verified, verifiedOperation } from "./verify.ts";
import { finishWebgl } from "./webgl.ts";

export interface RunOptions {
  /** End timed operations when the GPU has finished the page's WebGL drawing too. */
  webgl?: boolean;
}

export interface PageResult {
  supported: boolean;
  /** No frame showed what an operation asked: the library or its adapter drew something else. */
  incorrect?: boolean;
  reason?: string;
  metrics: Record<string, Metric>;
  /** Histograms of a metric's samples: counts below each upper edge, and one count above the last. */
  distributions?: Record<string, { edges: number[]; counts: number[] }>;
}

/** A verified timing, and in runs waiting for WebGL its time to the GPU finishing. */
type Timing = Verified & { webgl?: number };

/** Times `operation` to its verified frame, and then to WebGL drawing finished where asked. */
export async function timed(
  options: RunOptions,
  operation: () => unknown,
  check: () => string | undefined,
  pending?: () => Promise<unknown> | undefined,
): Promise<Timing> {
  const verified = await verifiedOperation(operation, check, pending);
  if (!options.webgl) return verified;
  finishWebgl();
  return { ...verified, webgl: performance.now() - verified.start };
}

/**
 * Metrics of a sequence of timed operations: `${name}ToFrame`, or in a run
 * waiting for WebGL `${name}ToWebglDone`; with the frames each rejected and
 * the checks' time.
 */
export function timings(
  name: string,
  measured: Timing[],
  options: RunOptions,
): Record<string, Metric> {
  return {
    ...(options.webgl
      ? {
          [`${name}ToWebglDone`]: metric(
            "ms",
            measured.map((t) => t.webgl!),
          ),
        }
      : {
          [`${name}ToFrame`]: metric(
            "ms",
            measured.map((t) => t.time),
          ),
        }),
    ...checks(measured),
  };
}

/** What the checks of verified frames found: frames rejected before each showed its result, and their time. */
function checks(measured: Verified[]): Record<string, Metric> {
  return {
    rejectedFrames: metric(
      "count",
      measured.map((t) => t.rejected),
    ),
    checkTime: metric(
      "ms",
      measured.map((t) => t.checkTime),
    ),
    // Frames whose pre-paint observer did not run: never credited, but counted.
    unobservedFrames: metric(
      "count",
      measured.map((t) => t.unobserved),
    ),
  };
}

function timePrepare(
  kind: ChartKind<ChartData>,
  data: ChartData,
  options: ChartOptions,
  samples: number,
) {
  const result = metric("ms");
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    kind.prepare(data, options);
    result.samples.push(performance.now() - start);
  }
  return result;
}

export async function runInit(kind: ChartKind<ChartData>, s: Scenario): Promise<PageResult> {
  const data = makeData(s, 1);
  const options = optionsFor(s);
  const measured: Verified[] = [];
  for (let i = 0; i < s.warmup + s.samples; i++) {
    const container = box(options.width, options.height);
    let handle: AnyHandle | undefined;
    const elapsed = await timed(
      {},
      async () => {
        handle = await kind.create(container, data, options);
      },
      () => (handle ? mounted(handle.drawn(), s.chart, data, options) : "not created yet"),
      () => handle?.rendered?.(),
    );
    handle!.destroy();
    clearStage();
    if (i >= s.warmup) measured.push(elapsed);
    await nextFrame();
  }
  return {
    supported: true,
    metrics: {
      timeToFrame: metric(
        "ms",
        measured.map((t) => t.time),
      ),
      firstFrame: metric(
        "ms",
        measured.map((t) => t.first),
      ),
      ...checks(measured),
      prepare: timePrepare(kind, data, options, s.samples),
    },
  };
}

export async function runUpdate(kind: ChartKind<ChartData>, s: Scenario): Promise<PageResult> {
  const datasets = [makeData(s, 1), makeData(s, 2)];
  const expected = datasets.map((data) => seriesOf(s.chart, data));
  const options = optionsFor(s);
  const handle = await create(kind, s, datasets[0]!, options);
  const measured: Verified[] = [];
  for (let i = 0; i < s.warmup + s.samples; i++) {
    const next = (i + 1) % 2;
    const before = handle.drawn().draws;
    const elapsed = await timed(
      {},
      () => handle.setData(datasets[next]!),
      () => redrawn(handle.drawn(), before, expected[next]!),
      () => handle.rendered?.(),
    );
    if (i >= s.warmup) measured.push(elapsed);
  }
  handle.destroy();
  clearStage();
  return {
    supported: true,
    metrics: {
      timeToFrame: metric(
        "ms",
        measured.map((t) => t.time),
      ),
      firstFrame: metric(
        "ms",
        measured.map((t) => t.first),
      ),
      ...checks(measured),
      prepare: timePrepare(kind, datasets[1]!, options, s.samples),
    },
  };
}

/**
 * Series 0 of a rolling window after each of `ticks` batches: the window
 * keeps the newest `keep` points of the data and the batches appended to
 * it. Every x is one step after the last, so the oldest kept is found by
 * its place.
 */
export function windowsAfter(
  data: SeriesData,
  batches: { x: Float64Array; ys: Float64Array[] }[],
  keep: number,
): SeriesShown[] {
  const n = data.x.length;
  const xAt = (g: number) =>
    g < n
      ? data.x[g]!
      : batches[Math.floor((g - n) / batches[0]!.x.length)]!.x[(g - n) % batches[0]!.x.length]!;
  const yAt = (g: number) => {
    if (g < n) return data.ys[0]![g]!;
    const size = batches[0]!.x.length;
    return batches[Math.floor((g - n) / size)]!.ys[0]![(g - n) % size]!;
  };
  return batches.map((batch, tick) => {
    const total = n + (tick + 1) * batch.x.length;
    const first = Math.max(0, total - keep);
    return {
      count: total - first,
      firstX: xAt(first),
      lastX: xAt(total - 1),
      first: yAt(first),
      last: yAt(total - 1),
    };
  });
}

export async function runStream(
  kind: ChartKind<ChartData>,
  s: Scenario,
  options: RunOptions,
): Promise<PageResult> {
  const data = makeData(s, 1) as SeriesData;
  const handle = await create(kind, s, data, optionsFor(s));
  if (!handle.append) {
    handle.destroy();
    clearStage();
    return { supported: false, reason: "the adapter has no rolling-window append", metrics: {} };
  }
  const ticks = s.warmup + s.samples;
  // Every tick, and what it should show, made up front so neither is timed.
  const batches = Array.from({ length: ticks }, (_, tick) =>
    continueSeries(data, s.append ?? 1, tick),
  );
  const expected = windowsAfter(data, batches, s.points);
  const measured: Timing[] = [];
  for (let i = 0; i < ticks; i++) {
    const batch = batches[i]!;
    const before = handle.drawn().draws;
    const elapsed = await timed(
      options,
      () => handle.append!(batch.x, batch.ys, s.points),
      () => redrawn(handle.drawn(), before, expected[i]!),
      () => handle.rendered?.(),
    );
    if (i >= s.warmup) measured.push(elapsed);
  }
  handle.destroy();
  clearStage();
  return { supported: true, metrics: timings("tick", measured, options) };
}

/**
 * Zoomed-in x ranges: 50%, 10%, and 1% of the data in turn, each centered a
 * little further along, so consecutive ranges both zoom and pan.
 */
function zoomWindows(x0: number, x1: number, count: number): [number, number][] {
  const span = x1 - x0;
  const fractions = [0.5, 0.1, 0.01];
  return Array.from({ length: count }, (_, i) => {
    const width = span * fractions[i % fractions.length]!;
    const center = x0 + span * (0.3 + 0.4 * ((i * 0.618) % 1));
    return [center - width / 2, center + width / 2];
  });
}

export async function runZoom(
  kind: ChartKind<ChartData>,
  s: Scenario,
  options: RunOptions,
): Promise<PageResult> {
  const data = makeData(s, 1) as SeriesData | PointData;
  const handle = await create(kind, s, data, optionsFor(s));
  if (!handle.setViewport) {
    handle.destroy();
    clearStage();
    return { supported: false, reason: "the adapter has no zoom path", metrics: {} };
  }
  // Scatter x values are unsorted, so the extent comes from a scan.
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const x of data.x) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
  }
  const windows = zoomWindows(x0, x1, s.warmup + s.samples);
  const measured: Timing[] = [];
  for (let i = 0; i < windows.length; i++) {
    const [from, to] = windows[i]!;
    const before = handle.drawn().draws;
    const elapsed = await timed(
      options,
      () => handle.setViewport!(from, to),
      () => zoomed(handle.drawn(), before, from, to),
      () => handle.rendered?.(),
    );
    if (i >= s.warmup) measured.push(elapsed);
  }
  handle.destroy();
  clearStage();
  return { supported: true, metrics: timings("viewport", measured, options) };
}

/**
 * Camera angles a rotation steps through: around the vertical axis in steps
 * of 7 degrees, tilting between 10 and 50 degrees above the floor.
 */
export function cameraAngles(count: number): [number, number][] {
  return Array.from({ length: count }, (_, i) => [-60 + i * 7, 30 + 20 * Math.sin(i / 3)]);
}

export async function runRotate(
  kind: ChartKind<ChartData>,
  s: Scenario,
  options: RunOptions,
): Promise<PageResult> {
  const handle = await create(kind, s, makeData(s, 1), optionsFor(s));
  if (!handle.setCamera) {
    handle.destroy();
    clearStage();
    return { supported: false, reason: "the adapter has no camera path", metrics: {} };
  }
  const measured: Timing[] = [];
  const angles = cameraAngles(s.warmup + s.samples);
  for (let i = 0; i < angles.length; i++) {
    const [azimuth, elevation] = angles[i]!;
    const before = handle.drawn().draws;
    const elapsed = await timed(
      options,
      () => handle.setCamera!(azimuth, elevation),
      () => turned(handle.drawn(), before, azimuth, elevation),
      () => handle.rendered?.(),
    );
    if (i >= s.warmup) measured.push(elapsed);
  }
  handle.destroy();
  clearStage();
  return { supported: true, metrics: timings("camera", measured, options) };
}

export async function runResize(
  kind: ChartKind<ChartData>,
  s: Scenario,
  options: RunOptions,
): Promise<PageResult> {
  const handle = await create(kind, s, makeData(s, 1), optionsFor(s));
  const container = stage().lastElementChild as HTMLElement;
  const measured: Timing[] = [];
  for (let i = 0; i < s.warmup + s.samples; i++) {
    const { width, height } = resizeTo(i);
    // Read before the container changes: reading after would lay it out
    // here, outside the timing, where main's suite left that to the library.
    const before = handle.drawn().draws;
    container.style.width = `${width}px`;
    container.style.height = `${height}px`;
    const elapsed = await timed(
      options,
      () => handle.resize(width, height),
      () => resized(handle.drawn(), before, width, height),
      () => handle.rendered?.(),
    );
    if (i >= s.warmup) measured.push(elapsed);
  }
  handle.destroy();
  clearStage();
  return { supported: true, metrics: timings("resize", measured, options) };
}

/** The first reason any of `charts` gives, prefixed with the chart's place. */
function every(reasons: (string | undefined)[]): string | undefined {
  const k = reasons.findIndex((reason) => reason !== undefined);
  return k < 0 ? undefined : `chart ${k + 1}: ${reasons[k]}`;
}

/**
 * Mounts `charts` line charts, then refreshes them all in one task; each
 * ends at the first frame in which every chart shows its data.
 */
export async function runDashboard(kind: ChartKind<ChartData>, s: Scenario): Promise<PageResult> {
  const count = s.charts ?? 10;
  const options = optionsFor(s);
  const first = Array.from({ length: count }, (_, c) => makeData(s, 1 + c));
  const second = Array.from({ length: count }, (_, c) => makeData(s, 101 + c));
  const expected = second.map((data) => seriesOf(s.chart, data));
  const init = metric("ms");
  const update = metric("ms");
  const rejected = metric("count");
  for (let i = 0; i < s.warmup + s.samples; i++) {
    const handles: AnyHandle[] = [];
    const initElapsed = await timed(
      {},
      async () => {
        for (const data of first)
          handles.push(await kind.create(box(options.width, options.height), data, options));
      },
      () =>
        handles.length < count
          ? "not every chart created yet"
          : every(handles.map((h, c) => mounted(h.drawn(), s.chart, first[c]!, options))),
      () => {
        const pending = handles.map((handle) => handle.rendered?.()).filter(Boolean);
        return pending.length ? Promise.all(pending) : undefined;
      },
    );
    // Periodic refresh: every chart receives new data in the same task.
    const before = handles.map((handle) => handle.drawn().draws);
    const updateElapsed = await timed(
      {},
      () => Promise.all(handles.map((handle, c) => handle.setData(second[c]!))),
      () => every(handles.map((h, c) => redrawn(h.drawn(), before[c]!, expected[c]!))),
      () => {
        const pending = handles.map((handle) => handle.rendered?.()).filter(Boolean);
        return pending.length ? Promise.all(pending) : undefined;
      },
    );
    for (const handle of handles) handle.destroy();
    clearStage();
    if (i >= s.warmup) {
      init.samples.push(initElapsed.time);
      update.samples.push(updateElapsed.time);
      rejected.samples.push(initElapsed.rejected + updateElapsed.rejected);
    }
    await nextFrame();
  }
  return {
    supported: true,
    metrics: { initAllToFrame: init, updateAllToFrame: update, rejectedFrames: rejected },
  };
}
