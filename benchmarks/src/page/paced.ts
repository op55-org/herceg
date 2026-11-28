// Workloads paced by the clock with the display's refresh on: ingestion
// at a fixed rate, a 3D camera turned a step a frame, and sustained traces
// of pointer moves the runner sends on a schedule. They measure frame
// intervals and what the frames showed: each append or move from its
// arrival to the first frame showing it exactly, and those a later one
// overtook before any frame showed them. Each run ends with a verified
// frame showing its last tick, move, or camera; a run whose last input
// never shows is incorrect.

import { continueSeries, type SeriesData, timeSeries } from "../datasets.ts";
import type { Scenario } from "../scenarios/index.ts";
import type { ChartKind, Drawn, SeriesShown } from "./adapter.ts";
import { type ChartData, type HoverTarget, hovered, seriesWrong, turned } from "./expect.ts";
import {
  type AnyHandle,
  clearStage,
  create,
  type Metric,
  makeData,
  metric,
  optionsFor,
} from "./fixtures.ts";
import { afterFrame, beforePaint, droppedFrames, nextFrame, refreshInterval } from "./frames.ts";
import { type Arrival, recordArrivals, stopRecording } from "./input.ts";
import type { PageResult } from "./timed.ts";
import { cameraAngles } from "./timed.ts";
import { limits, watchFrames } from "./verify.ts";

/** Waits, untimed, for a frame in which `check` passes; the run is `Incorrect` when none does within `limits.settled`. */
async function finalFrame(check: () => string | undefined): Promise<void> {
  await watchFrames(performance.now(), check, () => true, limits.settled).shown;
}

/**
 * A frame-interval histogram's bins, in refreshes the interval spans: about
 * one (a frame every refresh), two (one refresh missed), three, four, and
 * five or more; the edges sit half a refresh between them.
 */
export const REFRESHES_SPANNED = [1.5, 2.5, 3.5, 4.5];

/** The histogram of `intervals` (ms) in `REFRESHES_SPANNED`'s bins, its edges in ms at `refresh`. */
export function binned(
  intervals: number[],
  refresh: number,
): { edges: number[]; counts: number[] } {
  const edges = REFRESHES_SPANNED.map((spanned) => spanned * refresh);
  const counts = new Array<number>(edges.length + 1).fill(0);
  for (const interval of intervals) {
    const bin = edges.findIndex((edge) => interval < edge);
    counts[bin < 0 ? edges.length : bin]!++;
  }
  return { edges, counts };
}

/**
 * Watches every frame until `stop()` is called: its interval from the one
 * before (requestAnimationFrame's time stamps, so intervals follow the
 * display's refresh), and, just before it paints, what `observe` finds in
 * it, which `observe` commits with the time the frame was produced.
 * `stop()` resolves once the last frame's observation is committed.
 */
function watchEveryFrame(observe: () => ((time: number) => void) | undefined) {
  const intervals: number[] = [];
  let running = true;
  let previous = 0;
  let finished = () => {};
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  const step = (t: number) => {
    if (previous) intervals.push(t - previous);
    previous = t;
    const last = !running;
    const end = () => {
      if (last) finished();
    };
    beforePaint(() => {
      const commit = observe();
      afterFrame(() => {
        commit?.(performance.now());
        end();
      });
    }, end);
    if (!last) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  return {
    intervals,
    async stop() {
      running = false;
      await done;
    },
  };
}

/**
 * Inputs (appends or moves) as frames show them: each is shown exactly at
 * the first frame whose drawing `shows` it; earlier ones not yet shown are
 * then overtaken (superseded), since no frame showed them alone. An input
 * no frame showed within `limits.settled` is given up as unshown, which
 * keeps each frame's search bounded when a library falls far behind.
 * `S` is what a frame drew, read once a frame for every pending input.
 */
export class Shown<S> {
  readonly latencies: number[] = [];
  superseded = 0;
  #unshown = 0;
  #pending: { at: number; shows: (seen: S) => boolean }[] = [];

  add(at: number, shows: (seen: S) => boolean): void {
    this.#pending.push({ at, shows });
  }

  /**
   * Checks a frame before it paints: gives up the inputs waiting longer
   * than `limits.settled`, then looks for the newest input the frame shows,
   * newest first through every pending one, in what `read` says it drew
   * (read once, and only with inputs pending). Returns what records it once
   * the frame has been produced, or undefined.
   */
  frame(read: () => S, now = performance.now()): ((time: number) => void) | undefined {
    let stale = 0;
    while (stale < this.#pending.length && now - this.#pending[stale]!.at > limits.settled) stale++;
    if (stale > 0) {
      this.#unshown += stale;
      this.#pending = this.#pending.slice(stale);
    }
    const pending = this.#pending;
    if (pending.length === 0) return undefined;
    const seen = read();
    for (let k = pending.length - 1; k >= 0; k--) {
      if (!pending[k]!.shows(seen)) continue;
      const at = pending[k]!.at;
      this.superseded += k;
      this.#pending = pending.slice(k + 1);
      return (time) => this.latencies.push(time - at);
    }
    return undefined;
  }

  /** Inputs still waiting for a frame to show them. */
  get outstanding(): number {
    return this.#pending.length;
  }

  /** Inputs no frame showed: given up, and still waiting. */
  get unshown(): number {
    return this.#unshown + this.#pending.length;
  }
}

/** Ingestion measurements from one trial. */
interface IngestTrial {
  intervals: number[];
  appendTimes: number[];
  dropped: number;
  /** Undefined where the browser does not report long animation frames. */
  longFrames: number | undefined;
  rate: number;
  drain: number;
  shown: Shown<(SeriesShown | undefined)[]>;
  /** Ticks appended: the next trial continues after them. */
  delivered: number;
}

/**
 * Series 0's values and positions as appended so far, on one chart: the
 * dataset's, then each tick's batch. A tick's window is the last
 * `s.points` of them.
 */
interface History {
  x: number[];
  y: number[];
}

/**
 * One paced-ingestion trial: for the scenario's duration of wall-clock
 * time a timer appends data at its rate while the display runs at its
 * normal refresh rate. Libraries decide when to render; one that blocks
 * the main thread receives fewer ticks. Every frame is checked for the
 * newest tick it shows on every chart.
 */
async function ingestTrial(
  handles: AnyHandle[],
  datasets: SeriesData[],
  histories: History[],
  s: Scenario,
  refresh: number,
  offset: number,
): Promise<IngestTrial> {
  const rate = s.rateHz ?? 10;
  const duration = s.durationMs ?? 5000;
  const append = s.append ?? 1;
  // Sustained runs stop on the clock alone; short ones also at their count of ticks.
  const capacity = Math.ceil((duration * rate) / 1000) * (duration >= 60_000 ? 2 : 1);
  // Each trial continues after the ticks earlier ones appended, so x keeps increasing.
  const batches = datasets.map((data) =>
    Array.from({ length: capacity }, (_, tick) => continueSeries(data, append, offset + tick)),
  );
  // The window each tick leaves on each chart (series 0's ends), from its history.
  const kept = histories.map((history) => history.x.length);
  histories.forEach((history, c) => {
    for (const batch of batches[c]!) {
      history.x.push(...batch.x);
      history.y.push(...batch.ys[0]!);
    }
  });
  const windows = histories.map((history, c) =>
    Array.from({ length: capacity }, (_, tick): SeriesShown => {
      const last = kept[c]! + (tick + 1) * append - 1;
      const first = last - s.points + 1;
      return {
        count: s.points,
        firstX: history.x[first]!,
        lastX: history.x[last]!,
        first: history.y[first]!,
        last: history.y[last]!,
      };
    }),
  );
  const showsTick = (seen: (SeriesShown | undefined)[], tick: number) =>
    seen.every((series, c) => seriesWrong(series, windows[c]![tick]!) === undefined);
  const shown = new Shown<(SeriesShown | undefined)[]>();
  const seen = () => handles.map((handle) => handle.drawn().series);
  const frames = watchEveryFrame(() => shown.frame(seen));
  const longFrames: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => longFrames.push(...list.getEntries()));
  const reportsLongFrames =
    PerformanceObserver.supportedEntryTypes.includes("long-animation-frame");
  const pending: Promise<unknown>[] = [];
  const appendTimes: number[] = [];
  let timer = 0;
  const started = performance.now();
  let delivered = 0;
  try {
    if (reportsLongFrames) observer.observe({ type: "long-animation-frame" });
    await new Promise<void>((resolve, reject) => {
      timer = window.setInterval(() => {
        try {
          if (performance.now() - started >= duration || delivered >= capacity) {
            resolve();
            return;
          }
          const t0 = performance.now();
          handles.forEach((handle, c) => {
            const batch = batches[c]![delivered]!;
            pending.push(Promise.resolve(handle.append!(batch.x, batch.ys, s.points)));
          });
          appendTimes.push(performance.now() - t0);
          const tick = delivered;
          shown.add(t0, (drawn) => showsTick(drawn, tick));
          delivered++;
        } catch (error) {
          reject(error);
        }
      }, 1000 / rate);
    });
    window.clearInterval(timer);
    const deadline = performance.now();
    // Drain asynchronous appends and progressive rendering before measuring.
    await Promise.all(pending);
    for (const handle of handles) await handle.rendered?.();
    await nextFrame();
    const drain = performance.now() - deadline;
    const counted = frames.intervals.length;
    // Ticks not shown yet may show in later frames: the ledger watches them
    // until none waits (each is given up after `limits.settled`).
    while (shown.outstanding > 0 && performance.now() - deadline < limits.settled + 1000)
      await nextFrame();
    // The ledger's watch first: one pre-paint observer at a time (frames.ts).
    await frames.stop();
    if (delivered > 0)
      await finalFrame(() => {
        const drawn = seen();
        for (const [c, series] of drawn.entries()) {
          const wrong = seriesWrong(series, windows[c]![delivered - 1]!);
          if (wrong) return `chart ${c} does not show the last tick (${delivered}): ${wrong}`;
        }
        return undefined;
      });
    // Long-animation-frame entries arrive after their frame; give the last one time to land.
    await new Promise((resolve) => setTimeout(resolve, 100));
    longFrames.push(...observer.takeRecords());
    return {
      // The frames up to the drain's end, as before the ledger's wait.
      intervals: frames.intervals.slice(0, counted),
      appendTimes,
      dropped: droppedFrames(frames.intervals.slice(0, counted), refresh),
      longFrames: reportsLongFrames
        ? longFrames.filter((entry) => entry.startTime >= started).length
        : undefined,
      rate: (delivered * 1000) / (deadline - started),
      drain,
      shown,
      delivered,
    };
  } finally {
    // Only what was appended stays in the history for the next trial.
    histories.forEach((history, c) => {
      history.x.length = history.y.length = kept[c]! + delivered * append;
    });
    window.clearInterval(timer);
    observer.disconnect();
    await frames.stop();
  }
}

export async function runIngest(kind: ChartKind<ChartData>, s: Scenario): Promise<PageResult> {
  const options = optionsFor(s);
  const datasets = Array.from({ length: s.charts ?? 1 }, (_, c) =>
    timeSeries(s.series, s.points, 1 + c),
  );
  const handles: AnyHandle[] = [];
  try {
    for (const data of datasets) handles.push(await create(kind, s, data, options));
    if (handles.some((handle) => !handle.append))
      return { supported: false, reason: "the adapter has no rolling-window append", metrics: {} };
    const refresh = await refreshInterval();
    const histories = datasets.map((data) => ({
      x: Array.from(data.x),
      y: Array.from(data.ys[0]!),
    }));
    const measured: IngestTrial[] = [];
    let offset = 0;
    for (let i = 0; i < s.warmup + s.samples; i++) {
      const trial = await ingestTrial(handles, datasets, histories, s, refresh, offset);
      offset += trial.delivered;
      if (i >= s.warmup) measured.push(trial);
    }
    const intervals = measured.flatMap((trial) => trial.intervals);
    return {
      supported: true,
      metrics: {
        frameInterval: metric("ms", intervals),
        appendTime: metric(
          "ms",
          measured.flatMap((trial) => trial.appendTimes),
        ),
        droppedFrames: metric(
          "count",
          measured.map((trial) => trial.dropped),
        ),
        // Browsers without long-animation-frame entries (WebKit) leave it out.
        ...(measured.every((trial) => trial.longFrames !== undefined) && {
          longFrames: metric(
            "count",
            measured.map((trial) => trial.longFrames!),
          ),
        }),
        achievedRate: metric(
          "hz",
          measured.map((trial) => trial.rate),
        ),
        drainTime: metric(
          "ms",
          measured.map((trial) => trial.drain),
        ),
        tickToShownFrame: metric(
          "ms",
          measured.flatMap((trial) => trial.shown.latencies),
        ),
        ticksSuperseded: metric(
          "count",
          measured.map((trial) => trial.shown.superseded),
        ),
        ticksUnshown: metric(
          "count",
          measured.map((trial) => trial.shown.unshown),
        ),
        refreshInterval: metric("ms", [refresh]),
      },
      distributions: { frameInterval: binned(intervals, refresh) },
    };
  } finally {
    for (const handle of handles) handle.destroy();
    clearStage();
  }
}

/** The time of the next animation frame. */
function animationFrame(): Promise<number> {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

/**
 * Turns a 3D chart's camera a step every frame, as dragging does, with the
 * display's refresh on: the intervals between frames, unlike `rotate`'s
 * timings, include work the GPU has not finished when a frame's script ends.
 */
export async function runOrbit(kind: ChartKind<ChartData>, s: Scenario): Promise<PageResult> {
  const handle = await create(kind, s, makeData(s, 1), optionsFor(s));
  try {
    if (!handle.setCamera)
      return { supported: false, reason: "the adapter has no camera path", metrics: {} };
    const refresh = await refreshInterval();
    const angles = cameraAngles(s.warmup + s.samples);
    const intervals: number[] = [];
    let last = await animationFrame();
    let before = handle.drawn().draws;
    for (let i = 0; i < angles.length; i++) {
      const [azimuth, elevation] = angles[i]!;
      before = handle.drawn().draws;
      await handle.setCamera(azimuth, elevation);
      const now = await animationFrame();
      if (i >= s.warmup) intervals.push(now - last);
      last = now;
    }
    // Frames along the way are not checked; the last camera must show.
    const [azimuth, elevation] = angles[angles.length - 1]!;
    await finalFrame(() => turned(handle.drawn(), before, azimuth, elevation));
    // A frame later than half a refresh past its time missed it.
    const missed = intervals.filter((interval) => interval > refresh * 1.5).length;
    return {
      supported: true,
      metrics: {
        frameInterval: metric("ms", intervals),
        missedFrames: metric("count", [missed]),
        refreshInterval: metric("ms", [refresh]),
      },
    };
  } finally {
    handle.destroy();
    clearStage();
    await nextFrame();
  }
}

/** A sustained pointer trace under way: moves recorded as they arrive, every frame checked. */
export interface Trace {
  stop(): Promise<Record<string, Metric>>;
  distributions(): Record<string, { edges: number[]; counts: number[] }>;
}

/**
 * Starts watching a trace of pointer moves over `handle` (series 0 of
 * `data`): every move the page receives, and every frame, for the newest
 * move whose readout it shows.
 */
export async function startTrace(handle: AnyHandle, s: Scenario, data: SeriesData): Promise<Trace> {
  const refresh = await refreshInterval();
  const arrivals = recordArrivals();
  const shown = new Shown<Drawn>();
  let taken = 0;
  let current = 0;
  let observed = 0;
  const frames = watchEveryFrame(() => {
    for (; taken < arrivals.length; taken++) {
      const arrival: Arrival = arrivals[taken]!;
      if (arrival.type !== "pointermove") continue;
      const target: HoverTarget = { pointer: { x: arrival.x, y: arrival.y }, kind: s.chart, data };
      shown.add(arrival.at, (drawn) => hovered(drawn, target) === undefined);
    }
    observed++;
    const commit = shown.frame(() => handle.drawn());
    // Current: the frame shows the newest move that had arrived (or no move is waiting).
    if (shown.outstanding === 0) current++;
    return commit;
  });
  const started = performance.now();
  let result: Record<string, Metric> | undefined;
  /** The intervals of the frames while moves were offered, once stopped. */
  let offeredIntervals: number[] = [];
  return {
    async stop() {
      // Moves already sent may still be on their way, and moves not shown
      // yet may show in later frames: the ledger takes every move received
      // and watches them until none waits (each is given up after
      // `limits.settled`). Frame intervals and the share of current frames
      // are of the offered run, up to here.
      const offered = performance.now();
      const counted = frames.intervals.length;
      const currentShare = observed ? current / observed : 0;
      while (
        (taken < arrivals.length || shown.outstanding > 0) &&
        performance.now() - offered < limits.settled + 1000
      )
        await nextFrame();
      const drain = performance.now() - offered;
      // The ledger's watch first: one pre-paint observer at a time (frames.ts).
      await frames.stop();
      stopRecording();
      const moves = arrivals.filter((arrival) => arrival.type === "pointermove");
      const final = moves.at(-1);
      if (final) {
        const target: HoverTarget = { pointer: { x: final.x, y: final.y }, kind: s.chart, data };
        await finalFrame(() => hovered(handle.drawn(), target));
      }
      const intervals = frames.intervals.slice(0, counted);
      offeredIntervals = intervals;
      const seconds = (offered - started) / 1000;
      result = {
        frameInterval: metric("ms", intervals),
        droppedFrames: metric("count", [droppedFrames(intervals, refresh)]),
        drainTime: metric("ms", [drain]),
        movesReceived: metric("count", [moves.length]),
        receivedRate: metric("hz", [moves.length / seconds]),
        moveToShownFrame: metric("ms", shown.latencies),
        movesSuperseded: metric("count", [shown.superseded]),
        movesUnshown: metric("count", [shown.unshown]),
        currentFrames: metric("ratio", [currentShare]),
        refreshInterval: metric("ms", [refresh]),
      };
      return result;
    },
    distributions: () => ({
      frameInterval: binned(offeredIntervals, refresh),
    }),
  };
}
