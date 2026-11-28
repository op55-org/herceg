// What a scenario draws, as the page harness sets it up: its data, the
// boxes its charts mount in, and their options.

import {
  bubbles,
  candles,
  categories,
  grid,
  points3d,
  samples,
  scatterPoints,
  surfaceGrid,
  timeSeries,
} from "../datasets.ts";
import type { Scenario } from "../scenarios/index.ts";
import type { Adapter, ChartHandle, ChartKind, ChartOptions } from "./adapter.ts";
import { type ChartData, mounted } from "./expect.ts";
import { verifiedOperation } from "./verify.ts";

export type AnyHandle = ChartHandle<ChartData>;

export interface Metric {
  unit: "ms" | "bytes" | "count" | "hz" | "ratio";
  samples: number[];
}

export function metric(unit: Metric["unit"], samples: number[] = []): Metric {
  return { unit, samples };
}

const WIDTH = 800;
const HEIGHT = 400;

export function makeData(s: Scenario, seed: number): ChartData {
  switch (s.chart) {
    case "line":
    case "area":
      return timeSeries(s.series, s.points, seed);
    case "bar":
      return categories(s.points, s.series, seed);
    case "scatter":
      return scatterPoints(s.points, seed);
    case "heatmap": {
      const side = Math.round(Math.sqrt(s.points));
      return grid(side, side, seed);
    }
    case "candlestick":
      return candles(s.points, seed);
    case "histogram":
      return samples(s.points, seed);
    case "bubble":
      return bubbles(s.points, seed);
    case "scatter3d":
      return points3d(s.points, seed);
    case "surface":
      return surfaceGrid(Math.round(Math.sqrt(s.points)), seed);
  }
}

export function kindFor(adapter: Adapter, s: Scenario): ChartKind<ChartData> | undefined {
  return adapter[s.chart] as ChartKind<ChartData> | undefined;
}

export function stage(): HTMLElement {
  return document.getElementById("stage")!;
}

export function box(width: number, height: number): HTMLElement {
  const element = document.createElement("div");
  element.style.cssText = `width:${width}px;height:${height}px;display:inline-block;vertical-align:top`;
  stage().append(element);
  return element;
}

function chartSize(s: Scenario): { width: number; height: number } {
  const charts = s.charts ?? 1;
  if (charts >= 50) return { width: 300, height: 150 };
  if (charts > 1) return { width: 600, height: 250 };
  return { width: WIDTH, height: HEIGHT };
}

export function optionsFor(s: Scenario): ChartOptions {
  return { ...chartSize(s), tooltip: s.tooltip, large: s.large, zoom: s.operation === "zoom" };
}

export function clearStage(): void {
  stage().replaceChildren();
}

/**
 * Creates a chart and waits, untimed, for a frame showing it drawn from
 * `data` at its size: the starting point every other operation is timed
 * from, so a chart that never draws fails before anything is timed.
 */
export async function create(
  kind: ChartKind<ChartData>,
  s: Scenario,
  data: ChartData,
  options: ChartOptions,
): Promise<AnyHandle> {
  let handle: AnyHandle | undefined;
  await verifiedOperation(
    async () => {
      handle = await kind.create(box(options.width, options.height), data, options);
    },
    () => (handle ? mounted(handle.drawn(), s.chart, data, options) : "not created yet"),
    () => handle?.rendered?.(),
  );
  return handle!;
}

/** The sizes a resize scenario toggles between: the chart's own, and 600 x 300. */
export function resizeTo(i: number): { width: number; height: number } {
  return i % 2 === 0 ? { width: 600, height: 300 } : { width: WIDTH, height: HEIGHT };
}
