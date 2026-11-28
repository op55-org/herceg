// The pixel check before timing: a screenshot of the page, taken by the
// runner once an operation's first verified frame has been produced, must
// show the chart's marks where the library's last draw put them. A frame's
// drawing state (expect.ts) can say a chart drew the right thing while
// nothing reached the screen, or reached it elsewhere; this catches that.
// It runs untimed, in a page of its own, before a scenario is timed.

import type { SeriesData } from "../datasets.ts";
import { BUBBLE } from "../datasets.ts";
import type { ChartType } from "../scenarios/index.ts";
import type { Box, Drawn } from "./adapter.ts";
import { FALL, PALETTE, RISE } from "./adapter.ts";

export type RGB = readonly [number, number, number];

/** The color at a viewport position, in CSS pixels. */
export type Pixels = (x: number, y: number) => RGB;

/**
 * Decodes a PNG screenshot (base64) of the viewport, taken in CSS pixels
 * (Playwright's `scale: "css"`) or in device pixels (WebDriver's): positions
 * and sizes are CSS pixels either way.
 */
export async function decode(
  base64: string,
): Promise<{ pixel: Pixels; width: number; height: number }> {
  const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
  const image = await createImageBitmap(blob);
  const context = new OffscreenCanvas(image.width, image.height).getContext("2d")!;
  context.drawImage(image, 0, 0);
  const { data, width } = context.getImageData(0, 0, image.width, image.height);
  const scale = width / innerWidth;
  return {
    width: innerWidth,
    height: image.height / scale,
    pixel: (x, y) => {
      const i = (Math.round(y * scale) * width + Math.round(x * scale)) * 4;
      return [data[i]!, data[i + 1]!, data[i + 2]!];
    },
  };
}

function rgb(hex: string): RGB {
  return [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) as unknown as RGB;
}

const distance = (a: RGB, b: RGB) => Math.max(...a.map((v, i) => Math.abs(v - b[i]!)));

const WHITE: RGB = [255, 255, 255];

/**
 * A pixel in `color`, or with `faint`, in it or drawn over white at 25%
 * opacity (areas' fills). The page's white background never counts, so a
 * chart's light marks (a heatmap's palest cells) cannot pass for a blank
 * plot.
 */
function near(color: RGB, pixel: RGB, faint = false, tolerance = 64): boolean {
  if (distance(pixel, WHITE) <= 24) return false;
  if (distance(color, pixel) <= tolerance) return true;
  const light = color.map((v) => Math.round(v * 0.25 + 255 * 0.75)) as unknown as RGB;
  return faint && distance(light, pixel) <= tolerance / 2;
}

/** The colors a chart of `kind` draws its marks in, as every adapter is given them. */
function markColors(kind: ChartType, series: number): RGB[] | "saturated" {
  switch (kind) {
    case "heatmap":
    case "bubble":
      return [rgb(BUBBLE.colors[1]), rgb("#5a8bbf"), rgb("#9ec3e0")];
    case "candlestick":
      return [rgb(RISE), rgb(FALL)];
    case "scatter3d":
    case "surface":
      return "saturated";
    default:
      return PALETTE.slice(0, Math.max(1, series)).map(rgb);
  }
}

const saturated = ([r, g, b]: RGB) => Math.max(r, g, b) - Math.min(r, g, b) > 48;

/**
 * Pixels of the plot (or the whole chart for 3D) in the marks' colors: at
 * least a 400th of the area, or, for lines, a pixel in 2 of 3 columns of a
 * line's width.
 */
function marksShown(pixel: Pixels, area: Box, kind: ChartType, series: number): string | undefined {
  const colors = markColors(kind, series);
  let hits = 0;
  let total = 0;
  for (let y = area.top + 1; y < area.top + area.height - 1; y += 2)
    for (let x = area.left + 1; x < area.left + area.width - 1; x += 2) {
      total++;
      const p = pixel(x, y);
      if (colors === "saturated" ? saturated(p) : colors.some((c) => near(c, p, kind === "area")))
        hits++;
    }
  const needed = Math.max(4, total / 400);
  if (hits < needed)
    return `the screenshot shows ${hits} pixels in the marks' colors in the plot, fewer than ${Math.ceil(needed)}`;
  return undefined;
}

/**
 * For lines: in a dozen columns across the plot, series 0's color within
 * the band it spans in that column by the drawn domains (its points there,
 * and its segments crossing the column; an area's fill counts), or, where
 * other series run within 3 px of it, the color of one of them (the one
 * drawn later covers it, and no pixel tells them apart). Series 0 must run
 * through at least 4 of the columns, and show in at least half of them.
 */
function lineShown(
  pixel: Pixels,
  drawn: Drawn,
  data: SeriesData,
  faint: boolean,
): string | undefined {
  const { plot, x, y } = drawn;
  if (!plot || !x || !y) return "the library reported no plot or domains to place series 0 by";
  const toData = (px: number) => x[0] + ((px - plot.left) / plot.width) * (x[1] - x[0]);
  const toY = (v: number) => plot.top + (1 - (v - y[0]) / (y[1] - y[0])) * plot.height;
  const xs = data.x;
  const n = xs.length;
  /** The first index whose x is at least `v` (x is sorted). */
  const from = (v: number) => {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (xs[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /**
   * Where series `ys` runs between `left` and `right` (data x), as client y:
   * its points there, and its segments crossing the edges.
   */
  const band = (ys: ArrayLike<number>, left: number, right: number) => {
    const first = from(left);
    const last = from(right);
    if (last === 0 || first === n) return undefined;
    const along = (i: number, v: number) =>
      ys[i - 1]! + ((ys[i]! - ys[i - 1]!) * (v - xs[i - 1]!)) / (xs[i]! - xs[i - 1]!);
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    const add = (value: number) => {
      low = Math.min(low, toY(value));
      high = Math.max(high, toY(value));
    };
    for (let i = first; i < last; i++) add(ys[i]!);
    if (first > 0) add(along(first, left));
    if (last < n) add(along(last, right));
    return [low, high] as const;
  };
  let checked = 0;
  let shown = 0;
  const columns = 12;
  for (let c = 0; c < columns; c++) {
    const column = plot.left + (plot.width * (c + 0.5)) / columns;
    const left = toData(column - 1.5);
    const right = toData(column + 1.5);
    const own = band(data.ys[0]!, left, right);
    if (!own) continue;
    const [low, high] = own;
    // Series 0's color, or that of a series running within 3 px of it.
    const colors = data.ys
      .map((ys, k) => ({ k, other: k === 0 ? own : band(ys, left, right) }))
      .filter(({ other }) => other !== undefined && other[0] <= high + 3 && other[1] >= low - 3)
      .map(({ k }) => rgb(PALETTE[k % PALETTE.length]!));
    checked++;
    search: for (let cx = column - 1; cx <= column + 1; cx++)
      for (
        let cy = Math.max(plot.top, low - 3);
        cy <= Math.min(plot.top + plot.height, high + 3);
        cy++
      )
        if (colors.some((color) => near(color, pixel(cx, cy), faint))) {
          shown++;
          break search;
        }
  }
  if (checked < 4)
    return `series 0 runs through only ${checked} of the plot's columns checked, too few to tell where it is drawn`;
  if (shown < checked / 2)
    return `series 0 (or a series over it) shows in ${shown} of the ${checked} columns checked, fewer than half`;
  return undefined;
}

/**
 * What is wrong with what the screenshot shows of a chart of `kind`, if
 * anything: its marks in their colors inside the drawn plot, and for lines
 * series 0 where the drawn domains put its points.
 */
export function pixelsWrong(
  pixel: Pixels,
  drawn: Drawn,
  kind: ChartType,
  series: number,
  data: unknown,
  chartBox: Box,
): string | undefined {
  const area = kind === "scatter3d" || kind === "surface" ? chartBox : drawn.plot;
  if (!area) return "the library reported no plot";
  return (
    marksShown(pixel, area, kind, series) ??
    (kind === "line" || kind === "area"
      ? lineShown(pixel, drawn, data as SeriesData, kind === "area")
      : undefined)
  );
}
