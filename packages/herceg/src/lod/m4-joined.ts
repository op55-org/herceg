import type { NumericArray } from "../data/column.ts";
import { emitColumn, type Mapping, unmappable } from "./m4.ts";
import type { PointSink } from "./polyline.ts";

/**
 * M4 with gaps narrower than a pixel joined: the line through `x[i], y[i]`
 * for the rows `rows[k]`, `k` in `[start, end)`, ascending in x, keeping the
 * first, lowest, highest, and last point of each device-pixel column (see
 * `m4`). Missing values (those a scale cannot place) break the line only
 * where the finite points on either side of them fall in different pixel
 * columns, once at that boundary; within one column they are joined over.
 * So the output is at most four points per pixel column and one break per
 * boundary, whatever the rows hold, where `m4` keeps every run between gaps
 * (a column of alternating gaps keeping half its points). Grids' sparklines
 * (grid/sparklines.ts) draw with it.
 */
export function m4Joined(
  x: NumericArray,
  y: NumericArray,
  rows: Uint32Array,
  start: number,
  end: number,
  xMap: Mapping,
  yMap: Mapping,
  pixelRatio: number,
  out: PointSink,
): void {
  const xo = xMap.offset * pixelRatio;
  const xf = xMap.factor * pixelRatio;
  const xOrigin = xMap.origin;
  let column = Number.NaN;
  // Positions of the open column's first, lowest, highest, and last points.
  let first = -1;
  let low = -1;
  let high = -1;
  let last = -1;
  let lowValue = 0;
  let highValue = 0;
  // A missing value since the open column's last point.
  let gap = false;
  for (let k = start; k < end; k++) {
    const i = rows[k]!;
    const value = y[i]!;
    const xv = x[i]!;
    if (unmappable(yMap, value) || unmappable(xMap, xv)) {
      gap = true;
      continue;
    }
    const c = Math.floor(xo + (xv - xOrigin) * xf);
    if (c !== column) {
      if (first >= 0) emitColumn(x, y, first, low, high, last, xMap, yMap, out, rows);
      // The points either side of the gap are in different columns.
      if (gap && first >= 0) out.break();
      column = c;
      first = low = high = last = k;
      lowValue = highValue = value;
      gap = false;
      continue;
    }
    gap = false;
    last = k;
    if (value < lowValue) {
      low = k;
      lowValue = value;
    } else if (value > highValue) {
      high = k;
      highValue = value;
    }
  }
  if (first >= 0) emitColumn(x, y, first, low, high, last, xMap, yMap, out, rows);
}
