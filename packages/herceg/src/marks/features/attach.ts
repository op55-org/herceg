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
//
// Or where the line meets the view's edge along the series' axis: the
// crossing nearest the end of the path as drawn (its start, for
// "view-start"), in pixels, or the path's own end inside the view. Its
// value is the crossing's pixel read back through the value scale, and its
// fields the observation at the nearer of the points around it (a step's
// corner standing for the observation whose level it carries): by the
// point's index where the edge drew a point for each position it traced,
// else the one drawn at its pixels or position; failing that, the farther
// point's, the one beside a cut `where` makes, or the last drawn in view.

import type { NumericArray } from "../../data/column.ts";
import type { Mapping } from "../../lod/m4.ts";
import type { Polyline } from "../../lod/polyline.ts";
import type { Rect } from "../../scene/scene.ts";
import type { LabelAt } from "../../spec/encoding.ts";
import type { Curve } from "../../spec/spec.ts";
import type { Frame } from "../mark.ts";
import type { Series } from "../series.ts";
import { type TracedEdge, tableRow } from "./provenance.ts";

/**
 * How near, in pixels, two points are the same: paths hold pixels as
 * 32-bit floats, a few hundred-thousandths of a pixel apart from where
 * 64-bit arithmetic places them on a plot some hundreds of pixels wide.
 */
const PIXEL = 1e-3;

/**
 * How far a pixel `p` read from a path may be from where 64-bit arithmetic
 * places it: PIXEL, or a 32-bit float's rounding far off the plot (a point
 * tens of thousands of pixels away when zoomed in).
 */
const slack = (p: number) => PIXEL + Math.abs(p) * 2 ** -22;

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
 * stack (`cut`, writing breaks between the stack's entries). `path` is the
 * edge as drawn in the chart's pixels, which labels at the view's edge
 * stand on, and `curve` the mark's (its steps' corners).
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
  readonly path?: Polyline | undefined;
  readonly curve?: Curve | undefined;
}

/**
 * Where on `edge`, drawn in `frame`, a label at `at` goes: at the
 * observation `at` names, or where the path meets the view's edge;
 * undefined where the series has none (nothing of it drawn, or in view),
 * or its point is outside the plot.
 */
export function anchorOf(edge: DrawnEdge, frame: Frame, at: LabelAt): Anchor | undefined {
  const first = at === "first" || at.endsWith("-start");
  const view = at.startsWith("view");
  const { along, traced, path, curve } = edge;
  const { plot } = frame;
  // The last (first) observation drawn in `inside` (at the value pixel
  // `value`, if given), or of the whole series.
  const end = (inside?: Rect, value?: number) =>
    traced
      ? drawnEnd(traced, along, first, inside, value)
      : observedEnd(edge, frame, first, inside, value);
  // Points a step draws per observation: two, or three for "step".
  const per = curve === "step" ? 3 : curve?.startsWith("step") ? 2 : 1;
  // Where the line meets the view's edge, and the points around it whose
  // observations the label reads, the nearer first.
  const meets = view
    ? crossing(path!, along, plot, first, per, curve === "step-before")
    : undefined;
  // The observation drawn at point k of the path: of a trace drawing one
  // point (`per` with steps) for each position it traced, in one run, the
  // k-th; else the one drawn at its pixels, else at its position.
  const observed = (k: number) => {
    const { coords, starts, count } = path!;
    const [px, py] = [coords[k * 2]!, coords[k * 2 + 1]!];
    const { start = 0, end: stop = 0 } = traced ?? {};
    if (traced && !traced.kept && starts.length < 2 && count === (stop - start - 1) * per + 1)
      return { x: px, y: py, row: tableRow(traced.series, start + k / per) };
    const there = along === "x" ? { ...plot, x: px, width: 0 } : { ...plot, y: py, height: 0 };
    return end(there, along === "x" ? py : px) ?? end(there);
  };
  // Of the points around a crossing, the nearer's, the farther's, the one
  // beside them in their run (where `where` cuts the line, neither is
  // one), else the last drawn in view.
  const found = meets
    ? (observed(meets[2]) ?? observed(meets[3]) ?? observed(meets[4]) ?? end(plot))
    : view
      ? undefined
      : end(at === "first" || at === "last" ? undefined : plot);
  if (!found) return undefined;
  const [x, y] = meets ?? [found.x, found.y];
  if (!within(plot, x, y)) return undefined;
  // At its observation's point, the value drawn there; elsewhere, the crossing's.
  const value =
    Math.hypot(found.x - x, found.y - y) > PIXEL
      ? frame[along === "x" ? "y" : "x"].invert(along === "x" ? y : x)
      : edge.values[found.row]!;
  return { x, y, row: found.row, value };
}

/**
 * Where `path` (in the chart's pixels) is last in `plot` along `along`, in
 * the order it was drawn (`first`: first): the end of a run there, or where
 * a segment leaves the plot's extent along that axis, on a cubic at the
 * share of the way along (monotone curves place their controls a third and
 * two thirds of the way). With it, the points around it whose observations
 * the label reads, the nearer first (the earlier on a tie), and the point
 * beside the farther inside its run (at the run's end, the one before it;
 * at its start, the one after): a step's corner stands for the observation
 * whose value it carries. At the start's edge, points standing on it count
 * as outside, so a step's vertical segment there gives the value after
 * it, as at the end's; a run that only stands on it is met there.
 * Undefined where no part of it is there.
 */
function crossing(
  path: Polyline,
  along: "x" | "y",
  plot: Rect,
  first: boolean,
  per: number,
  before: boolean,
): [x: number, y: number, near: number, far: number, beside: number] | undefined {
  const a = along === "x" ? 0 : 1;
  const [from, to] = a ? [plot.y, plot.y + plot.height] : [plot.x, plot.x + plot.width];
  const { coords: p, controls: k, starts } = path;
  // A point's position along the axis, and its pixel across it.
  const at = (i: number) => p[i * 2 + a]!;
  const across = (i: number) => p[i * 2 + 1 - a]!;
  const step = first ? 1 : -1;
  for (let r = first ? 0 : starts.length - 1; r >= 0 && r < starts.length; r += step) {
    const [start, end] = [starts[r]!, path.runEnd(r) - 1];
    // The point a corner of a step (`per` points an observation) stands
    // for: the one before it, or after it for "step-before" (`before`) and
    // a "step"'s second corner.
    const owner = (i: number) => {
      const o = (i - start) % per;
      return o === 0 ? i : o > 1 || before ? i + per - o : i - o;
    };
    const beside = (i: number) =>
      i === end && i - per >= start ? i - per : i === start && i + per <= end ? i + per : i;
    // Points within `e` pixels past the extent count as in it: at the
    // start's edge, first none (-PIXEL), then those standing on it.
    for (const e of first ? [-PIXEL, PIXEL] : [PIXEL]) {
      const side = (i: number) => (at(i) < from - e ? -1 : at(i) > to + e ? 1 : 0);
      for (let i = first ? start : end, j = -1; i >= start && i <= end; j = i, i += step) {
        // The run's first point in the plot, or one past the edge j is beyond.
        if (j < 0 ? side(i) : side(i) === side(j)) continue;
        if (j < 0) return [p[i * 2]!, p[i * 2 + 1]!, owner(i), owner(i), beside(owner(i))];
        const edge = side(j) < 0 ? from : to;
        // The segment from u to v, drawn in that order, at `edge`: its points'
        // values, and its controls' (`c(1)`, `c(3)`; `c(a)` is NaN where straight).
        const [u, v] = first ? [j, i] : [i, j];
        const t = (edge - at(u)) / (at(v) - at(u));
        const s = 1 - t;
        const [y0, y1] = [across(u), across(v)];
        const c = (n: number) => k[v * 4 + n - a]!;
        const y =
          path.curved && !Number.isNaN(c(a))
            ? s * s * (s * y0 + 3 * t * c(1)) + t * t * (3 * s * c(3) + t * y1)
            : y0 + (y1 - y0) * t;
        const [n, f] = t > 0.5 + 1e-6 ? [v, u] : [u, v];
        const ends = [owner(n), owner(f), beside(owner(f))] as const;
        return a ? [y, edge, ...ends] : [edge, y, ...ends];
      }
    }
  }
  return undefined;
}

/**
 * The first or last observation a trace draws, of the whole series or,
 * with `view`, of those whose position is in the plot `view` along the
 * series' axis (and drawn at the pixel `value` across it, if given), by the
 * rules it draws by: rows `where` and `continuity`
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
  value = Number.NaN,
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
      const inside = px >= from - slack(from) && px <= to + slack(to);
      if (!inside || !placeable(yMap, y) || (other && !placeable(yMap, other[i]!))) continue;
      const py = mapped(yMap, y);
      // (Never with no value given: NaN is no distance.)
      if (Math.abs(py - value) > slack(value)) continue;
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
 * drawn, of the whole series or, with `view`, of those whose position is in
 * it along the series' axis (and drawn at the pixel `value` across it, if
 * given), as the tracer draws a layer's rows (in
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
  view: Rect | undefined,
  value = Number.NaN,
): { x: number; y: number; row: number } | undefined {
  const { series: s, other, seams, along } = edge;
  const breaks = seams ? undefined : frame.x.breaks;
  const across = frame[along === "x" ? "y" : "x"];
  const point = pointAt(edge, frame);
  const plot = view ?? frame.plot;
  const [from, to] = along === "x" ? [plot.x, plot.x + plot.width] : [plot.y, plot.y + plot.height];
  // A stack's layer whose rows do not ascend is drawn in its positions' order.
  const order = s.edges?.positionOrder ?? s.rows;
  const count = order ? order.length : s.length;
  const ascends = !!s.edges?.positionOrder || (along === "x" ? s.sorted : !!s.ySorted);
  const positions = s[along];
  const at = (k: number) => positions[order ? order[k]! : k]!;
  const bounded = view && ascends && !s.places?.[along];
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
    if (view && !(position >= from - slack(from) && position <= to + slack(to))) {
      // Rows at one position stand at one point (a dodge moves a whole
      // series): past the others at this one at once.
      if (bounded)
        k = first ? startOf(at, count, false, 0, at(k)) : startOf(at, count, true, at(k), 0);
      continue;
    }
    if (s.features?.drawn && !s.features.drawn(row)) continue;
    if (other && !Number.isFinite(across.map(drawnValue(edge, other[row]!)))) continue;
    if (Math.abs(p[along === "x" ? 1 : 0]! - value) > slack(value)) continue;
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
