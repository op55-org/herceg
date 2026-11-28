// What each operation asks a chart to show, and whether a library's last
// draw (`Drawn`, adapter.ts) shows it. Every library is held to the same
// comparison; nothing here knows which library drew. Each check returns
// what is wrong, or undefined when the drawing shows the result.

import type {
  CandleData,
  CategoryData,
  GridData,
  Point3Data,
  PointData,
  SampleData,
  SeriesData,
  SurfaceData,
} from "../datasets.ts";
import type { ChartType } from "../scenarios/index.ts";
import type { Drawn, Point, Readout, SeriesShown } from "./adapter.ts";

export type ChartData =
  | SeriesData
  | PointData
  | CategoryData
  | GridData
  | CandleData
  | SampleData
  | Point3Data
  | SurfaceData;

/** Series 0 of `data` as a chart of `kind` draws it (see `SeriesShown`). */
export function seriesOf(kind: ChartType, data: ChartData): SeriesShown {
  const of = (x: ArrayLike<number> | undefined, values: ArrayLike<number>): SeriesShown => {
    const n = values.length;
    return {
      count: n,
      firstX: x ? x[0]! : 0,
      lastX: x ? x[n - 1]! : n - 1,
      first: values[0]!,
      last: values[n - 1]!,
    };
  };
  switch (kind) {
    case "line":
    case "area": {
      const d = data as SeriesData;
      return of(d.x, d.ys[0]!);
    }
    case "bar":
      return of(undefined, (data as CategoryData).series[0]!.values);
    case "scatter":
    case "bubble": {
      const d = data as PointData;
      return of(d.x, d.y);
    }
    case "heatmap":
      return of(undefined, (data as GridData).values);
    case "candlestick": {
      const d = data as CandleData;
      return of(d.x, d.close);
    }
    case "histogram":
      return of(undefined, (data as SampleData).values);
    case "scatter3d": {
      const d = data as Point3Data;
      return of(d.x, d.z);
    }
    case "surface":
      return of(undefined, (data as SurfaceData).z);
  }
}

/** Equal as doubles the library kept, allowing for one rounding. */
const same = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

/** What differs between series 0 as drawn and as expected: its count, and its ends' positions and values. */
export function seriesWrong(
  shown: SeriesShown | undefined,
  expected: SeriesShown,
): string | undefined {
  if (!shown) return "the library reported no series drawn";
  if (shown.count !== undefined && expected.count !== undefined && shown.count !== expected.count)
    return `series 0 drew ${shown.count} items, not ${expected.count}`;
  for (const key of ["firstX", "lastX", "first", "last"] as const)
    if (!same(shown[key], expected[key]))
      return `series 0's ${key} drew ${shown[key]}, not ${expected[key]}`;
  return undefined;
}

/** `a` within `tolerance` of `b`; false for NaN, so a value a library left undefined never passes. */
const near = (a: number, b: number, tolerance: number) => Math.abs(a - b) <= tolerance;

function sizeWrong(drawn: Drawn, width: number, height: number): string | undefined {
  if (!near(drawn.width, width, 0.5) || !near(drawn.height, height, 0.5))
    return `drew at ${drawn.width} x ${drawn.height}, not ${width} x ${height}`;
  return undefined;
}

/** The chart mounted: drawn at its size from `data`. */
export function mounted(
  drawn: Drawn,
  kind: ChartType,
  data: ChartData,
  size: { width: number; height: number },
): string | undefined {
  if (drawn.draws < 1) return "nothing drawn yet";
  return (
    sizeWrong(drawn, size.width, size.height) ?? seriesWrong(drawn.series, seriesOf(kind, data))
  );
}

/** A draw after the operation began, drawn from `expected`. */
export function redrawn(
  drawn: Drawn,
  drawsBefore: number,
  expected: SeriesShown,
): string | undefined {
  if (drawn.draws <= drawsBefore) return "nothing drawn since the operation";
  return seriesWrong(drawn.series, expected);
}

/** The x domain shown is [x0, x1], each end within a CSS pixel. */
export function zoomed(
  drawn: Drawn,
  drawsBefore: number,
  x0: number,
  x1: number,
): string | undefined {
  if (drawn.draws <= drawsBefore) return "nothing drawn since the operation";
  if (!drawn.x || !drawn.plot) return "the library reported no x domain";
  const pixel = (x1 - x0) / drawn.plot.width;
  const [a, b] = drawn.x;
  if (!near(a, x0, pixel) || !near(b, x1, pixel))
    return `showed x from ${a} to ${b}, not ${x0} to ${x1}`;
  return undefined;
}

export function resized(
  drawn: Drawn,
  drawsBefore: number,
  width: number,
  height: number,
): string | undefined {
  if (drawn.draws <= drawsBefore) return "nothing drawn since the operation";
  return sizeWrong(drawn, width, height);
}

export function turned(
  drawn: Drawn,
  drawsBefore: number,
  azimuth: number,
  elevation: number,
): string | undefined {
  if (drawn.draws <= drawsBefore) return "nothing drawn since the operation";
  const camera = drawn.camera;
  if (!camera) return "the library reported no camera";
  const off = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);
  if (!near(off(camera.azimuth, azimuth), 0, 0.5) || !near(camera.elevation, elevation, 0.5))
    return `drew the camera at ${camera.azimuth}°, ${camera.elevation}°, not ${azimuth}°, ${elevation}°`;
  return undefined;
}

/**
 * The numbers a readout writes, with their decimals: "1,234.5" is 1234.5
 * to one decimal; a minus sign may be "-" or "−".
 */
const NUMBER = /[-−]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/;

export function numbersIn(text: string): { value: number; decimals: number }[] {
  const found: { value: number; decimals: number }[] = [];
  for (const match of text.matchAll(new RegExp(NUMBER, "g"))) {
    const value = Number(match[0].replace("−", "-").replaceAll(",", ""));
    if (Number.isFinite(value)) found.push({ value, decimals: match[1]?.length ?? 0 });
  }
  return found;
}

/** Whether a number a readout wrote is `value` to the decimals it shows: within half its last digit. */
const isWritten = (
  { value: shown, decimals }: { value: number; decimals: number },
  value: number,
) => Math.abs(shown - value) <= 0.5 * 10 ** -decimals + 1e-9 * Math.abs(value);

/** Whether `text` writes `value` anywhere, to the decimals it shows. */
export function writes(text: string, value: number): boolean {
  return numbersIn(text).some((number) => isWritten(number, value));
}

/**
 * Whether a readout writes `value` for the series named `name`: the part
 * the adapter told apart as that series' value, where it did, being that
 * number; otherwise the number right after the name, with nothing but
 * spaces or a colon between (not "series 1" in "series 10", nor a number
 * further on; every library writes a series' name before its value). A
 * readout that neither names the series nor tells its value apart does not
 * write it, whatever numbers it shows.
 */
export function writesFor(
  readout: Pick<Readout, "text" | "value">,
  name: string,
  value: number,
): boolean {
  if (readout.value !== undefined) {
    const written = numbersIn(readout.value);
    return (
      written.length === 1 &&
      readout.value.trim() === readout.value.trim().match(NUMBER)?.[0] &&
      isWritten(written[0]!, value)
    );
  }
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = new RegExp(`(?<![\\w])${escaped}(?![\\w])[ \\t:]*(${NUMBER.source})`, "g");
  return [...readout.text.matchAll(named)].some((match) => {
    const written = numbersIn(match[1]!)[0];
    return written !== undefined && isWritten(written, value);
  });
}

/** Where a hover went, and the data under it. */
export interface HoverTarget {
  /** The pointer's client position, as the page received it. */
  pointer: Point;
  kind: ChartType;
  data: SeriesData | PointData;
}

/**
 * Series 0's items a readout at the pointer may name: along x for lines
 * (those within 1.5 CSS px of the pointer's x, by the drawn x domain), and
 * within 4 CSS px both ways for points. Several items share a pixel in
 * dense charts, and libraries pick among them differently.
 */
export function eligible(drawn: Drawn, target: HoverTarget): number[] {
  const { plot, x: xDomain, y: yDomain } = drawn;
  if (!plot || !xDomain) return [];
  const [x0, x1] = xDomain;
  const perPixelX = (x1 - x0) / plot.width;
  const atX = x0 + (target.pointer.x - plot.left) * perPixelX;
  const xs = target.data.x;
  if (target.kind === "line" || target.kind === "area") {
    const reach = 1.5 * perPixelX;
    let lo = 0;
    let hi = xs.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (xs[mid]! < atX - reach) lo = mid + 1;
      else hi = mid;
    }
    const out: number[] = [];
    for (let i = lo; i < xs.length && xs[i]! <= atX + reach; i++) out.push(i);
    return out;
  }
  if (!yDomain) return [];
  const [y0, y1] = yDomain;
  const ys = (target.data as PointData).y;
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const px = plot.left + ((xs[i]! - x0) / (x1 - x0)) * plot.width;
    const py = plot.top + (1 - (ys[i]! - y0) / (y1 - y0)) * plot.height;
    if (Math.abs(px - target.pointer.x) <= 4 && Math.abs(py - target.pointer.y) <= 4) out.push(i);
  }
  return out;
}

/**
 * Whether the readout writes item `i`: for lines, series 0's value for
 * series 0's name (`writesFor`); for points, the point's y as the
 * readout's last number (every library's point readout ends with it:
 * ECharts' writes the value alone, the others x then y).
 */
function readsItem(readout: Readout, target: HoverTarget, i: number): boolean {
  if (target.kind === "line" || target.kind === "area") {
    const data = target.data as SeriesData;
    return writesFor(readout, data.names[0]!, data.ys[0]![i]!);
  }
  const last = numbersIn(readout.text).at(-1);
  return last !== undefined && isWritten(last, (target.data as PointData).y[i]!);
}

/**
 * The readout shows the hovered item: one of the items `eligible` names
 * (the one the library says it reads, where it says), written in the
 * readout as `readsItem` says.
 */
export function hovered(drawn: Drawn, target: HoverTarget): string | undefined {
  const readout = drawn.readout;
  if (!readout || readout.text.trim() === "") return "no readout shown";
  const under = eligible(drawn, target);
  if (under.length === 0) return "no item of series 0 under the pointer by the drawn domains";
  if (readout.index !== undefined) {
    if (!under.includes(readout.index))
      return `the readout names item ${readout.index}, not one under the pointer (${under[0]} to ${under[under.length - 1]})`;
    if (!readsItem(readout, target, readout.index))
      return `the readout "${readout.text}" does not write item ${readout.index}`;
    return undefined;
  }
  if (under.some((i) => readsItem(readout, target, i))) return undefined;
  return `the readout "${readout.text}" writes none of the items under the pointer`;
}
