// Where a label following a series goes (marks/attachments.ts): at an
// observation of the series, before level of detail reduces it: its first
// or last drawn, or its first or last drawn in view (whose position is in
// the view along the series' axis), in the series' own order. The label
// reads that observation's fields and the value drawn there; one whose
// observation is outside the plot (its value past the view across the
// series' axis) is not drawn. A series' trace gives the rows it drew and
// how it placed them: rows `where` and `continuity` keep, outside an axis'
// breaks, placed as the trace placed them (a dodged series' shift, along y
// with x and y swapped). Layers drawn through a stack's edges are not
// traced so: their rows are read as the stack draws them.

import type { NumericArray } from "../../data/column.ts";
import type { Mapping } from "../../lod/m4.ts";
import type { Rect } from "../../scene/scene.ts";
import type { LabelAt } from "../../spec/encoding.ts";
import type { Frame } from "../mark.ts";
import type { Series } from "../series.ts";
import { type TracedEdge, tableRow } from "./provenance.ts";

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
 * run along and its trace (`traced`, where recorded); and for edges not
 * traced so, how the mark drew their rows: the series, the edge's values
 * by row (an area's top, a band's edge), a band's or stack layer's other
 * edge, how far the mark moves each row (a dodged series), whether it
 * keeps rows a break hides along y at the break's seam (layers do),
 * where a stack on a log axis draws its zeros (the axis' low end),
 * whether its layers curve together (`curved`, tracing two distinct
 * positions past each end of the view), and whether continuity cuts its
 * stack (`cut`, writing breaks between the stack's entries).
 */
export interface DrawnEdge {
  readonly along: "x" | "y";
  readonly traced: TracedEdge | undefined;
  readonly series: Series;
  readonly values: NumericArray;
  readonly other?: NumericArray | undefined;
  readonly shift?: ((row: number) => readonly [number, number]) | undefined;
  readonly seams?: boolean | undefined;
  readonly zeros?: number | undefined;
  readonly curved?: boolean | undefined;
  readonly cut?: boolean | undefined;
}

/**
 * Where on `edge`, drawn in `frame`, a label at `at` goes: at the
 * observation `at` names; undefined where the series has none (nothing of
 * it drawn, or in view), or its point is outside the plot.
 */
export function anchorOf(edge: DrawnEdge, frame: Frame, at: LabelAt): Anchor | undefined {
  const first = at === "first" || at === "visible-start";
  const inView = at === "visible-start" || at === "visible-end";
  const found = edge.traced
    ? drawnEnd(edge.traced, edge.along, first, inView ? frame.plot : undefined)
    : observedEnd(edge, frame, first, inView);
  if (!found || !within(frame.plot, found.x, found.y)) return undefined;
  return { ...found, value: edge.values[found.row]! };
}

/**
 * The first or last observation a trace draws, of the whole series or,
 * with `view`, of those whose position is in the plot `view` along the
 * series' axis, by the rules it draws by: rows `where` and `continuity`
 * keep, whose position and value (and a band's other edge) its scales
 * place, outside an axis' breaks along x (along y, a copy has left out the
 * rows breaks hide, or a layer keeps them at the break's seam), placed as
 * it placed them. Of the whole series, the rows `where` and `continuity`
 * keep are found once a data version (`shown`). In a copy of a series'
 * points, made again each frame, and in view, the walk runs over the
 * positions the trace drew (in view; else all of them), from their end, a
 * run of those `where` and `continuity` keep at a time (as the trace found
 * them), jumping an axis' break at once: the rows kept but not placed
 * between, no more.
 */
function drawnEnd(
  traced: TracedEdge,
  along: "x" | "y",
  first: boolean,
  view: Rect | undefined,
): { x: number; y: number; row: number } | undefined {
  const { series, values, other, frame } = traced;
  const [xMap, yMap] = [frame.x.mapping(), frame.y.mapping()];
  const kept = series.sources || view ? undefined : series.features?.shown?.(series);
  const drawn = series.features?.drawn;
  const rows = kept ? kept.rows : series.rows;
  const [lo, hi] = view ? [traced.start, traced.end] : [0, kept ? kept.length : series.length];
  // Where positions ascend, past the rows a break hides at once.
  const breaks = series.sorted ? frame.x.breaks : undefined;
  // The view along the series' axis, in pixels of the trace.
  const [from, to] = view
    ? along === "x"
      ? [view.x, view.x + view.width]
      : [view.y, view.y + view.height]
    : [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  // Positions [a, b), from the end the label is at.
  const walk = (a: number, b: number) => {
    for (let j = first ? a : b - 1; j >= a && j < b; j += first ? 1 : -1) {
      // Kept rows index the series' columns as rows do.
      const i = rows ? rows[j]! : j;
      const [x, y] = [series.x[i]!, values[i]!];
      if (breaks?.hides(x)) {
        j = first
          ? breaks.shownFrom(series.x, j, b, rows) - 1
          : breaks.shownBefore(series.x, j, rows) + 1;
        continue;
      }
      const row = kept ? i : tableRow(series, j);
      if (!kept && drawn && !drawn(row)) continue;
      const px = placeable(xMap, x) && !xMap.breaks?.hides(x) ? mapped(xMap, x) : Number.NaN;
      const inside = px >= from - PIXEL && px <= to + PIXEL;
      if (!inside || !placeable(yMap, y) || (other && !placeable(yMap, other[i]!))) continue;
      const py = mapped(yMap, y);
      return along === "x" ? { x: px, y: py, row } : { x: py, y: px, row };
    }
    return undefined;
  };
  if (kept || !traced.kept) return walk(lo, hi);
  // In view or in a copy, the runs `where` and `continuity` keep: a run at
  // a time, past the rows they leave out at once.
  const { runs, count } = traced.kept;
  const starts = (r: number) => runs[r * 3]!;
  const ends = (r: number) => runs[r * 3 + 1]!;
  if (first)
    for (let r = startOf(ends, count, true, lo + 1, 0); r < count && starts(r) < hi; r++) {
      const found = walk(Math.max(starts(r), lo), Math.min(ends(r), hi));
      if (found) return found;
    }
  else
    for (let r = startOf(starts, count, false, 0, hi - 1); r >= 0 && ends(r) > lo; r--) {
      const found = walk(Math.max(starts(r), lo), Math.min(ends(r), hi));
      if (found) return found;
    }
  return undefined;
}

/**
 * The first position at or after `lo` of positions that ascend (`at`,
 * `count` of them), with `first`; else the last at or before `hi`: -1 or
 * `count` where none is. (Its own search: series.ts's would join this
 * chunk to the chart's.)
 */
function startOf(
  at: (k: number) => number,
  count: number,
  first: boolean,
  lo: number,
  hi: number,
): number {
  let [a, b] = [0, count];
  while (a < b) {
    const m = (a + b) >> 1;
    if (first ? at(m) < lo : at(m) <= hi) a = m + 1;
    else b = m;
  }
  return first ? a : a - 1;
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

/**
 * For an edge whose trace is not recorded: its first or last observation
 * drawn, of the whole series or, `inView`, of those whose position is in
 * the plot along the series' axis, as the tracer draws a layer's rows (in
 * the stack's order along its positions where they do not ascend, `where`
 * keeps them, outside the x axis' breaks or at their seams, with values of
 * both its edges, zeros of a stack on a log axis at its low end), and its
 * point. In view, where positions ascend, the walk runs over the rows at
 * the positions the tracer draws (`traced`), from their end, as
 * `drawnEnd`'s does, past rows at one position outside the plot at once.
 */
function observedEnd(
  edge: DrawnEdge,
  frame: Frame,
  first: boolean,
  inView: boolean,
): { x: number; y: number; row: number } | undefined {
  const { series: s, other, seams, along } = edge;
  const breaks = seams ? undefined : frame.x.breaks;
  const across = frame[along === "x" ? "y" : "x"];
  const point = pointAt(edge, frame);
  const { plot } = frame;
  const [from, to] = along === "x" ? [plot.x, plot.x + plot.width] : [plot.y, plot.y + plot.height];
  // A stack's layer whose rows do not ascend is drawn in its positions' order.
  const order = s.edges?.positionOrder ?? s.rows;
  const count = order ? order.length : s.length;
  const ascends = !!s.edges?.positionOrder || (along === "x" ? s.sorted : !!s.ySorted);
  const positions = s[along];
  const at = (k: number) => positions[order ? order[k]! : k]!;
  const bounded = inView && ascends && !s.places?.[along];
  const [lo, hi] = bounded ? traced(edge, frame, order, count) : [0, count];
  for (let k = first ? lo : hi - 1; k >= lo && k < hi; k += first ? 1 : -1) {
    const row = order ? order[k]! : k;
    if (breaks?.hides(s.x[row]!)) {
      // Where positions ascend, past the rows the break hides at once.
      if (ascends && along === "x")
        k = first ? breaks.shownFrom(s.x, k, hi, order) - 1 : breaks.shownBefore(s.x, k, order) + 1;
      continue;
    }
    const p = point(row);
    if (!p) continue;
    const position = p[along === "x" ? 0 : 1];
    if (inView && !(position >= from - PIXEL && position <= to + PIXEL)) {
      // Rows at one position stand at one point (a dodge moves a whole
      // series): past the others at this one at once.
      if (bounded)
        k = first ? startOf(at, count, false, 0, at(k)) : startOf(at, count, true, at(k), 0);
      continue;
    }
    if (s.features?.drawn && !s.features.drawn(row)) continue;
    if (other && !Number.isFinite(across.map(drawnValue(edge, other[row]!)))) continue;
    return { x: p[0], y: p[1], row };
  }
  return undefined;
}

/**
 * The rows [start, end) of `order` (`count` of them; all where it is
 * undefined) at the positions a trace of an edge whose positions ascend
 * runs through in `frame`, as `drawnRange` in marks/trace.ts finds them:
 * those in the view's domain (moved by a dodge's shift), and the next past
 * each end (shown ones, past an x axis' breaks), of the stack's positions
 * where the edge is drawn through its edges, else of its own rows.
 */
function traced(
  edge: DrawnEdge,
  frame: Frame,
  order: Uint32Array | undefined,
  count: number,
): [number, number] {
  const { series: s, along } = edge;
  const scale = frame[along];
  const moved = edge.shift?.(order ? (order[0] ?? 0) : 0)[along === "x" ? 0 : 1] ?? 0;
  // As marks/orient.ts moves it for a dodge, the domain itself otherwise.
  const [d0, d1] =
    moved === 0 ? scale.domain : scale.domain.map((d) => scale.invert(scale.map(d) - moved));
  const [lo, hi] = d0! <= d1! ? [d0!, d1!] : [d1!, d0!];
  const union = s.edges?.x;
  const [x, rows, n] = union ? [union, undefined, union.length] : [s[along], order, count];
  const at = (k: number) => x[rows ? rows[k]! : k]!;
  let start = Math.max(0, startOf(at, n, true, lo, hi) - 1);
  let end = Math.min(n, startOf(at, n, false, lo, hi) + 2);
  const breaks = along === "x" && !edge.seams ? frame.x.breaks : undefined;
  if (breaks && start < end) [start, end] = breaks.reach(x, start, end, n, rows);
  if (edge.curved && start < end) {
    // Two distinct positions past each end, as `curveRows` widens a curve's.
    const before = (k: number) => (breaks ? breaks.shownBefore(x, k, rows) : k);
    const after = (k: number) => (breaks ? breaks.shownFrom(x, k, n, rows) : k);
    for (let distinct = 0; start > 0 && distinct < 2; ) {
      const k = before(start - 1);
      if (k < 0) break;
      if (at(k) !== at(start)) distinct++;
      start = k;
    }
    for (let distinct = 0; end < n && distinct < 2; ) {
      const k = after(end);
      if (k >= n) break;
      if (at(k) !== at(end - 1)) distinct++;
      end = k + 1;
    }
  }
  if (!union || start >= end) return [start, end];
  // The layer's rows there: its n-th row at a position stands at the
  // stack's n-th entry there (as `alongside` in marks/area.ts pairs them),
  // where it has a row of that occurrence. Where continuity cuts the stack,
  // breaks it writes between entries stand for no row: an entry with no
  // top beside a row with one (a row's top is its entry's, and a break
  // comes before a drawn entry only), counted at the two ends alone.
  const own = (k: number) => s[along][order ? order[k]! : k]!;
  const tops = along === "x" ? s.y : s.x;
  const top = s.edges!.top;
  // Rows of the layer in [first one at k's position, the one at entry k), or through it.
  const rowsAt = (k: number, through: boolean) => {
    const p = at(k);
    const from = startOf(at, n, true, p, 0);
    const [a, b] = [startOf(own, count, true, p, 0), startOf(own, count, false, 0, p) + 1];
    let r = through ? k + 1 - from : k - from;
    if (edge.cut) {
      r = 0;
      for (let e = from; e < (through ? k + 1 : k); e++) {
        const value = a + r < b ? tops[order ? order[a + r]! : a + r]! : 0;
        if (!(Number.isNaN(top[e]!) && !Number.isNaN(value))) r++;
      }
    }
    return Math.min(a + r, b);
  };
  return [rowsAt(start, false), rowsAt(end - 1, true)];
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
