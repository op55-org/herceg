// Where a label following a series goes (marks/attachments.ts): at its
// first or last drawn observation, before level of detail reduces it, or
// where its edge as drawn (steps held, curves, crossings `where` meets)
// enters or leaves the plot, in the series' own order; and which
// observation owns that point, whose fields the label reads. A series'
// trace records which observation each point of its edge is
// (provenance.ts): an observation owns its point; a segment or curve, the
// observation it arrives at; a step's hold, the one whose value it holds,
// and its jump, the one it arrives at; a crossing of `where`, the row it
// arrives at. Layers drawn through a stack's edges are not traced so:
// which row stands at their visible ends is not known, and labels there
// read no fields (`checkOwners`, labels.ts).

import type { NumericArray } from "../../data/column.ts";
import type { Mapping } from "../../lod/m4.ts";
import type { Polyline } from "../../lod/polyline.ts";
import type { Rect } from "../../scene/scene.ts";
import type { LabelAt } from "../../spec/encoding.ts";
import type { Curve } from "../../spec/spec.ts";
import type { Frame } from "../mark.ts";
import type { Series } from "../series.ts";
import { crossingOwner, type TracedEdge, tableRow } from "./provenance.ts";

/**
 * How near, in pixels, two points are the same: paths hold pixels as
 * 32-bit floats, a few hundred-thousandths of a pixel apart from where
 * 64-bit arithmetic places them on a plot some hundreds of pixels wide.
 */
const PIXEL = 1e-3;

/** A label's anchor on a series: its point, the row owning it, and the value drawn there. */
export interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly row: number;
  readonly value: number;
}

/**
 * A series' edge as its mark drew it in a panel: the axis its positions
 * run along, its path in pixels and curve, and its trace (`traced`, where
 * recorded); and for edges not traced so, how the mark drew their rows:
 * the series, the edge's values by row (an area's top, a band's edge), a
 * band's or stack layer's other edge, how far the mark moves each row (a
 * dodged series), whether it keeps rows a break hides along y at the
 * break's seam (layers do), and where a stack on a log axis draws its
 * zeros (the axis' low end).
 */
export interface DrawnEdge {
  readonly along: "x" | "y";
  readonly path: Polyline;
  readonly curve: Curve | undefined;
  readonly traced: TracedEdge | undefined;
  readonly series: Series;
  readonly values: NumericArray;
  readonly other?: NumericArray | undefined;
  readonly shift?: ((row: number) => readonly [number, number]) | undefined;
  readonly seams?: boolean | undefined;
  readonly zeros?: number | undefined;
}

/**
 * Where on `edge`, drawn in `frame`, a label at `at` goes; undefined where
 * the series draws nothing there: its first or last drawn observation is
 * outside the plot, or nothing of it is in view. A visible end of an edge
 * whose trace is not recorded stands at no observation (row -1).
 */
export function anchorOf(edge: DrawnEdge, frame: Frame, at: LabelAt): Anchor | undefined {
  if (at === "first" || at === "last") {
    const first = at === "first";
    const found = edge.traced
      ? drawnEnd(edge.traced, edge.along, first)
      : observedEnd(edge, frame, first);
    if (!found || !within(frame.plot, found.x, found.y)) return undefined;
    return { ...found, value: edge.values[found.row]! };
  }
  const start = at === "visible-start";
  const hit = visibleEnd(edge.path, frame.plot, start);
  if (!hit) return undefined;
  const row = edge.traced ? ownerOf(edge.traced, edge.path, edge.curve, hit, start) : -1;
  if (row === undefined) return undefined;
  const value = edge.along === "x" ? frame.y.invert(hit.y) : frame.x.invert(hit.x);
  return { x: hit.x, y: hit.y, row, value };
}

/**
 * The first or last observation of the whole series a trace draws, by the
 * rules it draws by: rows `where` and `continuity` keep, whose position
 * and value (and a band's other edge) its scales place, outside an axis'
 * breaks along x (along y, a copy has left out the rows breaks hide, or a
 * layer keeps them at the break's seam), placed as it placed them. Rows
 * `where` and `continuity` keep are found once a data version (`shown`),
 * but in a copy of a series' points, made again each frame.
 */
function drawnEnd(
  traced: TracedEdge,
  along: "x" | "y",
  first: boolean,
): { x: number; y: number; row: number } | undefined {
  const { series, values, other, frame } = traced;
  const [xMap, yMap] = [frame.x.mapping(), frame.y.mapping()];
  const kept = series.sources ? undefined : series.features?.shown?.(series);
  const drawn = series.features?.drawn;
  const count = kept ? kept.length : series.length;
  const rows = kept ? kept.rows : series.rows;
  // Where positions ascend, past the rows a break hides at once.
  const breaks = series.sorted ? frame.x.breaks : undefined;
  for (let j = first ? 0 : count - 1; j >= 0 && j < count; j += first ? 1 : -1) {
    // Kept rows index the series' columns as rows do.
    const i = rows ? rows[j]! : j;
    const row = kept ? i : tableRow(series, j);
    if (!kept && drawn && !drawn(row)) continue;
    const [x, y] = [series.x[i]!, values[i]!];
    if (breaks?.hides(x)) {
      j = first
        ? breaks.shownFrom(series.x, j, count, rows) - 1
        : breaks.shownBefore(series.x, j, rows) + 1;
      continue;
    }
    if (!placeable(xMap, x) || xMap.breaks?.hides(x) || !placeable(yMap, y)) continue;
    if (other && !placeable(yMap, other[i]!)) continue;
    const [px, py] = [mapped(xMap, x), mapped(yMap, y)];
    return along === "x" ? { x: px, y: py, row } : { x: py, y: px, row };
  }
  return undefined;
}

/** Whether a mapping places a value (as `unmappable` in lod/m4.ts has it). */
function placeable(mapping: Mapping, value: number): boolean {
  return Number.isFinite(value) && !(mapping.log && value <= 0);
}

/** A value's pixel, as `mapValue` in lod/m4.ts maps it. */
function mapped(mapping: Mapping, value: number): number {
  const { breaks } = mapping;
  const v = mapping.log ? Math.log10(value) : breaks ? breaks.collapse(value) : value;
  return mapping.offset + (v - mapping.origin) * mapping.factor;
}

/** Whether (x, y) is in the plot, or off it by no more than a path's 32-bit rounding. */
function within(plot: Rect, x: number, y: number): boolean {
  const e = PIXEL;
  return (
    x >= plot.x - e &&
    x <= plot.x + plot.width + e &&
    y >= plot.y - e &&
    y <= plot.y + plot.height + e
  );
}

/** A point of a path: one of its points (`vertex`), or on the segment into point `segment`. */
interface Hit {
  readonly x: number;
  readonly y: number;
  readonly vertex?: number;
  readonly segment?: number;
}

/**
 * Where `path` first enters the plot (`start`), or last leaves it: a point
 * of it inside, or where a segment or curve crosses the plot's edge.
 */
function visibleEnd(path: Polyline, plot: Rect, start: boolean): Hit | undefined {
  const c = path.coords;
  const runs = path.starts.length;
  const step = start ? 1 : -1;
  for (let r = start ? 0 : runs - 1; r >= 0 && r < runs; r += step) {
    const first = path.starts[r]!;
    const last = path.runEnd(r) - 1;
    // A break with nothing after it leaves a run of no points.
    if (last < first) continue;
    const near = start ? first : last;
    if (within(plot, c[near * 2]!, c[near * 2 + 1]!))
      return { x: c[near * 2]!, y: c[near * 2 + 1]!, vertex: near };
    // Segment s runs from point s - 1 to s; seen from the end sought.
    for (let s = start ? first + 1 : last; start ? s <= last : s > first; s += step) {
      const crossing = crossingOf(path, s, plot, start);
      if (!crossing) continue;
      const [x, y] = crossing;
      // At its point inside the plot, on the plot's edge: that point.
      const inside = start ? s : s - 1;
      const [px, py] = [c[inside * 2]!, c[inside * 2 + 1]!];
      if (Math.abs(px - x) <= PIXEL && Math.abs(py - y) <= PIXEL) return { x, y, vertex: inside };
      return { x, y, segment: s };
    }
  }
  return undefined;
}

/**
 * Where segment `s` of `path` first comes into the plot along its way
 * (`entering`), or last goes out of it; undefined where it misses the plot.
 */
function crossingOf(
  path: Polyline,
  s: number,
  plot: Rect,
  entering: boolean,
): [number, number] | undefined {
  const c = path.coords;
  const k = path.controls;
  const [x0, y0, x3, y3] = [c[s * 2 - 2]!, c[s * 2 - 1]!, c[s * 2]!, c[s * 2 + 1]!];
  if (!path.curved || Number.isNaN(k[s * 4]!)) return clipped(x0, y0, x3, y3, plot, entering);
  return curveCrossing(
    [x0, y0, k[s * 4]!, k[s * 4 + 1]!, k[s * 4 + 2]!, k[s * 4 + 3]!, x3, y3],
    plot,
    entering,
    0,
  );
}

/** How far from straight, in pixels, a piece of a curve is clipped as its chord. */
const FLAT = 0.01;

/**
 * Where the cubic Bezier `curve` (x, y of its four points) first comes
 * into the plot (`entering`), or last goes out of it: split in halves,
 * nearest first, until each piece is straight within `FLAT`; a piece whose
 * points' box misses the plot does too.
 */
function curveCrossing(
  curve: readonly number[],
  plot: Rect,
  entering: boolean,
  depth: number,
): [number, number] | undefined {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = curve as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  if (
    Math.max(x0, x1, x2, x3) < plot.x - PIXEL ||
    Math.min(x0, x1, x2, x3) > plot.x + plot.width + PIXEL ||
    Math.max(y0, y1, y2, y3) < plot.y - PIXEL ||
    Math.min(y0, y1, y2, y3) > plot.y + plot.height + PIXEL
  )
    return undefined;
  // The control points' distances from the chord.
  const [dx, dy] = [x3 - x0, y3 - y0];
  const length = Math.hypot(dx, dy);
  const off = (x: number, y: number) =>
    length === 0 ? Math.hypot(x - x0, y - y0) : Math.abs((x - x0) * dy - (y - y0) * dx) / length;
  if (depth >= 32 || Math.max(off(x1, y1), off(x2, y2)) <= FLAT)
    return clipped(x0, y0, x3, y3, plot, entering);
  // De Casteljau at a half.
  const mid = (a: number, b: number) => (a + b) / 2;
  const [ax, ay, bx, by, cx, cy] = [
    mid(x0, x1),
    mid(y0, y1),
    mid(x1, x2),
    mid(y1, y2),
    mid(x2, x3),
    mid(y2, y3),
  ];
  const [dx1, dy1, ex, ey] = [mid(ax, bx), mid(ay, by), mid(bx, cx), mid(by, cy)];
  const [mx, my] = [mid(dx1, ex), mid(dy1, ey)];
  const first = [x0, y0, ax, ay, dx1, dy1, mx, my];
  const second = [mx, my, ex, ey, cx, cy, x3, y3];
  const [near, far] = entering ? [first, second] : [second, first];
  return (
    curveCrossing(near, plot, entering, depth + 1) ?? curveCrossing(far, plot, entering, depth + 1)
  );
}

/**
 * The first (`entering`) or last point of the segment from (x0, y0) to
 * (x1, y1) inside `plot` (Liang-Barsky); undefined where it misses it.
 */
function clipped(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  plot: Rect,
  entering: boolean,
): [number, number] | undefined {
  const [dx, dy] = [x1 - x0, y1 - y0];
  let [t0, t1] = [0, 1];
  const sides: [number, number][] = [
    [-dx, x0 - plot.x],
    [dx, plot.x + plot.width - x0],
    [-dy, y0 - plot.y],
    [dy, plot.y + plot.height - y0],
  ];
  for (const [p, q] of sides) {
    if (p === 0) {
      // Along a side: on it counts as inside, as `within` has it, whatever rounding placed it.
      if (q < -PIXEL) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
  }
  // Touching the plot within rounding is meeting it.
  if (t0 > t1 + 1e-9) return undefined;
  const t = Math.min(Math.max(entering ? t0 : t1, 0), 1);
  return [x0 + t * dx, y0 + t * dy];
}

/** The run of `path` holding its point `i`. */
function runOf(path: Polyline, i: number): number {
  const { starts } = path;
  let [lo, hi] = [0, starts.length - 1];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= i) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * The table row owning `hit`, a point of `path`, which is `traced.path`
 * drawn through `curve`: steps add corners to each run after its first
 * point (two for `step`, one otherwise) before each point traced; curves
 * keep the points. A step's corner on the plot's edge is owned as the
 * segment from it inside the plot is (`start`: the series enters there).
 */
function ownerOf(
  traced: TracedEdge,
  path: Polyline,
  curve: Curve | undefined,
  hit: Hit,
  start: boolean,
): number | undefined {
  let v = hit.vertex ?? hit.segment!;
  if (curve === "step" || curve === "step-before" || curve === "step-after") {
    const each = curve === "step" ? 3 : 2;
    const r = runOf(path, v);
    let offset = v - path.starts[r]!;
    let segment = hit.segment !== undefined;
    // A corner on the plot's edge: the segment from it inside the plot.
    if (!segment && offset > 0 && (offset - 1) % each !== each - 1) {
      segment = true;
      if (start) offset++;
    }
    v = traced.path.starts[r]! + (offset === 0 ? 0 : Math.floor((offset - 1) / each) + 1);
    // Into a step's first corner (but `step-before`'s, a jump) runs the hold of the point before.
    if (segment && (offset - 1) % each === 0 && curve !== "step-before") v--;
  }
  const { positions, series } = traced;
  // The recorder's buffer is pooled: past the path's points, an earlier trace's.
  if (v >= traced.path.count) return undefined;
  let p = positions[v]!;
  // A crossing of `where`: the row the series arrives at through it.
  if (p < -1) p = crossingOwner(p);
  return p >= 0 && p < series.length ? tableRow(series, p) : undefined;
}

/**
 * For an edge whose trace is not recorded: its first or last observation
 * drawn, as the tracer draws a layer's rows (`where` keeps them, outside
 * the x axis' breaks or at their seams, with values of both its edges,
 * zeros of a stack on a log axis at its low end), and its point.
 */
function observedEnd(
  edge: DrawnEdge,
  frame: Frame,
  first: boolean,
): { x: number; y: number; row: number } | undefined {
  const { series: s, other, seams } = edge;
  const breaks = seams ? undefined : frame.x.breaks;
  const across = frame[edge.along === "x" ? "y" : "x"];
  const at = pointAt(edge, frame);
  for (let k = first ? 0 : s.length - 1; k >= 0 && k < s.length; k += first ? 1 : -1) {
    const row = s.rows ? s.rows[k]! : k;
    if (s.features?.drawn && !s.features.drawn(row)) continue;
    if (breaks?.hides(s.x[row]!)) {
      // Where positions ascend, past the rows the break hides at once.
      if (s.sorted)
        k = first
          ? breaks.shownFrom(s.x, k, s.length, s.rows) - 1
          : breaks.shownBefore(s.x, k, s.rows) + 1;
      continue;
    }
    if (other && !Number.isFinite(across.map(drawnValue(edge, other[row]!)))) continue;
    const p = at(row);
    if (p) return { x: p[0], y: p[1], row };
  }
  return undefined;
}

/** A value as an edge not traced so draws it: a stack's zeros on a log axis at its low end. */
function drawnValue(edge: DrawnEdge, value: number): number {
  return value === 0 && edge.zeros !== undefined ? edge.zeros : value;
}

/** A row's point in pixels, drawn or not; undefined where it has no place. */
function pointAt(edge: DrawnEdge, frame: Frame) {
  const { along, values, shift, series: s } = edge;
  const across = along === "x" ? "y" : "x";
  return (row: number): [number, number] | undefined => {
    const [dx, dy] = shift?.(row) ?? [0, 0];
    const at = frame[along].map(placed(s, along, row)) + (along === "x" ? dx : dy);
    const value = frame[across].map(drawnValue(edge, values[row]!)) + (along === "x" ? dy : dx);
    if (!Number.isFinite(at) || !Number.isFinite(value)) return undefined;
    return along === "x" ? [at, value] : [value, at];
  };
}

/** A row's position along `axis`: on a panel holding some of the chart's bands, its band's place there. */
function placed(s: Series, axis: "x" | "y", row: number): number {
  const value = s[axis][row]!;
  const places = s.places?.[axis];
  return places && value >= 0 ? places.at(value) : value;
}
