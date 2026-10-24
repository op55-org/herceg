// Style runs (runs.ts) drawn along their series' paths. Each run's
// observations are reduced apart, so the observations either side of a
// boundary are points of the traced path, and each run draws its own
// stretch of the path, in path order, as the arrival rule gives it: a
// linear or monotone segment is its end point's, a step's hold its start
// point's and its jump its end point's (a midpoint step's first half hold
// its start point's). Observations sharing a position are joined by
// segments like any other.
//
// Where two runs meet, each is cut along the bisector of the corner there,
// within a stroke's reach of it: a run's stroke goes on a little past the
// boundary, so its half of the join is the path's own, and what lies past
// the cut is left out. The join is painted once, half by each run, and
// widths change at the cut. A cut leaves out everything of a stretch near
// it, so it is made only where the path near the boundary is the two
// straight segments meeting there (`cuttable`); elsewhere (dense or curved
// paths, sharp turns, a path coming back by its boundary) the run after
// starts at the boundary and paints over the run before, which draws the
// join.
// Dashes carry on across boundaries their pattern stays over, and start
// again where it changes. An area's fill is cut across the band at its
// boundaries, so its pieces share their edges; its outline is cut as a
// line is.

import type { Polyline } from "../../lod/polyline.ts";
import type { AreaGeometry, Drawing, Geometry } from "../../scene/scene.ts";
import type { Curve } from "../../spec/spec.ts";
import type { Series } from "../series.ts";

/**
 * Which run each stretch of an edge's points is of, as tracing found them:
 * runs of one look (`looks`, by run) in a row are one stretch, as a panel's
 * rows of a series may leave them.
 */
export class RunMarks {
  /** Each stretch's first point, ascending, and its run. */
  readonly firsts: number[] = [];
  readonly runs: number[] = [];
  /** The edge's point count when positions were last reduced into it. */
  end = 0;
  readonly #looks: ArrayLike<number>;

  constructor(looks: ArrayLike<number>) {
    this.#looks = looks;
  }

  reset(): void {
    this.firsts.length = 0;
    this.runs.length = 0;
    this.end = 0;
  }

  /** Whether runs `a` and `b` have one look. */
  same(a: number, b: number): boolean {
    return this.#looks[a] === this.#looks[b];
  }

  /** Points from `point` on are run `run`'s. */
  mark(point: number, run: number): void {
    const { firsts, runs } = this;
    if (firsts[firsts.length - 1] === point) {
      firsts.pop();
      runs.pop();
    }
    const last = runs[runs.length - 1];
    if (last !== undefined && this.same(last, run)) return;
    firsts.push(point);
    runs.push(run);
  }
}

/** The first of the runs ending at `ends` (ascending) that ends at or past position `k`. */
export function runAt(ends: ArrayLike<number>, k: number): number {
  let [low, high] = [0, ends.length - 1];
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (ends[mid]! >= k) high = mid;
    else low = mid + 1;
  }
  return low;
}

/**
 * Where the runs of `s` (ending at its positions `ends`) end among the
 * positions of `traced`, its trace: the same positions, unless tracing
 * copied its points (`sources`) or the trace is some of its rows (a
 * panel's), leaving some out.
 */
export function tracedEnds(s: Series, traced: Series, ends: readonly number[]): ArrayLike<number> {
  // The table's row at each traced position.
  const sources = traced.sources ?? (traced.rows !== s.rows ? traced.rows : undefined);
  if (!sources) return ends;
  const out = new Int32Array(ends.length);
  let [p, j] = [0, 0];
  for (let k = 0; k < traced.length; k++) {
    // Copies and panels keep the series' order: each point is a later position.
    while (p < s.length - 1 && (s.rows ? s.rows[p]! : p) !== sources[k]) p++;
    for (; j < ends.length && ends[j]! < p; j++) out[j] = k - 1;
  }
  for (; j < ends.length; j++) out[j] = traced.length - 1;
  return out;
}

/**
 * Reduces positions [a, b) of a series into `out` a run at a time (the
 * runs ending at positions `ends`), so the observations either side of each
 * boundary are points; `marks` keeps which run the points are of. Points
 * `out` gains between calls, crossings `where` meets, lead into the
 * observation past them, and are its run's.
 */
export function reduceRuns(
  out: Polyline,
  marks: RunMarks,
  ends: ArrayLike<number>,
  length: number,
  a: number,
  b: number,
  reduce: (start: number, end: number, run: number) => void,
): void {
  let run = runAt(ends, a);
  marks.mark(Math.max(out.starts[out.starts.length - 1] ?? 0, marks.end), run);
  for (let k = a; k < b; run++) {
    let to = Math.min(b, ends[run]! + 1);
    // A run a copy or a panel left no positions of.
    if (to <= k) continue;
    // Runs of one look in a row (as a panel's rows may leave them) reduce as one.
    const first = run;
    for (let next = run + 1; to < b && next < ends.length; next++) {
      if (ends[next]! + 1 <= to) continue;
      if (!marks.same(first, next)) break;
      run = next;
      to = Math.min(b, ends[run]! + 1);
    }
    marks.mark(out.count, first);
    reduce(k, to, first);
    k = to;
  }
  marks.end = out.count;
  if (b < length) marks.mark(out.count, runAt(ends, b));
}

/**
 * Marks for points kept at positions `positions` (as layers curved
 * together keep them), each its position's run.
 */
export function marksAt(
  marks: RunMarks,
  positions: ArrayLike<number>,
  ends: ArrayLike<number>,
): void {
  marks.reset();
  for (let i = 0; i < positions.length; i++) marks.mark(i, runAt(ends, positions[i]!));
}

/** A stretch of a traced edge one run draws: its points [from, to], and whether another run meets it at each end. */
export interface Stretch {
  readonly run: number;
  readonly from: number;
  readonly to: number;
  readonly open: boolean;
  readonly close: boolean;
}

/**
 * The stretches of `traced` (`reduced` as `curve` draws it) each run
 * draws, in path order, as `marks` gives runs of `reduced`'s points.
 * Stretches without a segment are left out, but for points standing alone.
 */
export function stretchesOf(
  reduced: Polyline,
  traced: Polyline,
  marks: RunMarks,
  curve: Curve | undefined,
): Stretch[] {
  // Steps add a corner (two, for midpoint steps) after each point but the last.
  const step = curve === "step" ? 3 : curve === "step-after" || curve === "step-before" ? 2 : 1;
  // Where the boundary is past the last point of the run before: the hold it keeps.
  const shift = curve === "step" || curve === "step-after" ? 1 : 0;
  const { firsts, runs } = marks;
  const out: Stretch[] = [];
  let m = 0;
  for (let piece = 0; piece < reduced.starts.length; piece++) {
    const [start, end] = [reduced.starts[piece]!, reduced.runEnd(piece)];
    const [first, last] = [traced.starts[piece]!, traced.runEnd(piece) - 1];
    const at = (i: number) => first + step * (i - start) + shift;
    // Whether a stretch is drawn before, which meets the next: a first
    // observation alone in its run draws nothing, and the next keeps the
    // path's own start.
    let before = false;
    for (let u = start; u < end; ) {
      while (m + 1 < firsts.length && firsts[m + 1]! <= u) m++;
      const v = Math.min(end, firsts[m + 1] ?? end);
      const from = u > start ? at(u - 1) : first;
      const to = v < end ? at(v - 1) : last;
      if (to > from || end - start === 1) {
        out.push({ run: runs[m]!, from, to, open: before, close: v < end });
        before = true;
      }
      u = v;
    }
  }
  return out;
}

/**
 * Of `stretches`, those `keep` keeps (an outline's, where some runs draw
 * none), each meeting only the kept ones beside it: an end where no kept
 * stretch meets it is the path's own, neither cut nor carried on.
 */
export function keptStretches(
  stretches: readonly Stretch[],
  keep: (stretch: Stretch) => boolean,
): Stretch[] {
  const kept = stretches.map(keep);
  return stretches.flatMap((stretch, i) =>
    kept[i]
      ? [{ ...stretch, open: stretch.open && kept[i - 1]!, close: stretch.close && kept[i + 1]! }]
      : [],
  );
}

/** A stretch of a stroked edge drawn apart: its points, where its dash begins, and what it leaves out. */
export interface StrokeStretch {
  readonly run: number;
  readonly path: Polyline;
  readonly dashOffset: number;
  /** Polygons, x, y pairs, its stroke leaves out: past where other runs meet it. */
  readonly holes: number[][];
}

/**
 * The stretches of `path`, a stroked edge, each drawn apart in its run's
 * width and dash, into buffer `buffer(i)`: its points, and half a stroke
 * past each boundary, cut there; dashes carried on across boundaries the
 * pattern stays over.
 */
export function strokeStretches(
  path: Polyline,
  stretches: readonly Stretch[],
  strokeOf: (run: number) => { strokeWidth: number; dash: readonly number[] | undefined },
  buffer: (i: number) => Polyline,
): StrokeStretch[] {
  let before: { stretch: Stretch; dash: readonly number[] | undefined; phase: number } | undefined;
  // Whether to cut where stretches meet: once for each boundary, for both
  // stretches there (the one drawn, where the other draws nothing), the
  // stretch ending there asking first.
  let last: { b: number; cut: boolean } | undefined;
  const cutAt = (b: number, i: number) => {
    if (last?.b === b) return last.cut;
    const meeting = [stretches[i - 1], stretches[i], stretches[i + 1]].filter(
      (st): st is Stretch => !!st && ((st.close && st.to === b) || (st.open && st.from === b)),
    );
    const width = Math.max(...meeting.map(({ run }) => strokeOf(run).strokeWidth));
    last = { b, cut: cuttable(path, b, meeting, width) };
    return last.cut;
  };
  // The way on past a boundary not cut, found once for the points sharing
  // its place: boundaries among them have the same.
  let block: { from: number; to: number; way: [number, number] } | undefined;
  const onward = (b: number) => {
    if (!block || b < block.from || b > block.to) {
      const last = runOf(path, b)[1];
      let to = b;
      while (to < last && still(path, to + 1)) to++;
      block = { from: b, to, way: direction(path, b, false) };
    }
    return block.way;
  };
  return stretches.map((stretch, i) => {
    const { from, to, open, close } = stretch;
    const { strokeWidth: width, dash } = strokeOf(stretch.run);
    // Past a boundary by half a stroke: enough for the join, all within the cut.
    const [past, reach] = [width / 2, width + 1];
    const holes: number[][] = [];
    let start: [number, number] | undefined;
    let end: [number, number] | undefined;
    // Where it is not cut, a stretch starts at the boundary, over the one
    // before, which goes on past it, drawing their join.
    if (open && cutAt(from, i)) {
      const [x, y] = point(path, from);
      const [into, after] = [way(path, from - 1, from), way(path, from, from + 1)];
      start = [x - past * into[0], y - past * into[1]];
      holes.push(beyond(x, y, bisector(into, after), -reach));
    }
    if (close) {
      const [x, y] = point(path, to);
      const cut = cutAt(to, i);
      const after = cut ? way(path, to, to + 1) : onward(to);
      end = [x + past * after[0], y + past * after[1]];
      if (cut) holes.push(beyond(x, y, bisector(way(path, to - 1, to), after), reach));
    }
    // The dash goes on from the stretch before where it meets this one in the same pattern.
    let phase = 0;
    if (dash?.length && open && before?.stretch.to === from && same(before.dash, dash))
      phase = before.phase + lengthOf(path, before.stretch.from, from);
    before = { stretch, dash, phase };
    return {
      run: stretch.run,
      path: copyStretch(path, from, to, buffer(i), start, end),
      dashOffset: phase - (start ? past : 0),
      holes,
    };
  });
}

/**
 * Whether stretches `meeting` at point `b` of `path`, `width` wide at most,
 * are cut there: the segments into and out of b straight, longer than a
 * cut and a stub reach, turning by at most 120 degrees, and no other
 * segment of theirs as near b. Then a cut leaves out of each nothing but
 * its half of the join; elsewhere (dense or curved paths, sharp turns, a
 * stretch coming back by its boundary) one would leave out more.
 */
function cuttable(path: Polyline, b: number, meeting: readonly Stretch[], width: number): boolean {
  const [first, last] = runOf(path, b);
  if (b - 1 < first || b + 1 > last || curved(path, b) || curved(path, b + 1)) return false;
  // The farthest a hole reaches from b, and a stroke (a stub's at the far end too) from its path.
  const near = Math.SQRT2 * (width + 1) + width;
  const [x, y] = point(path, b);
  const [ax, ay] = point(path, b - 1);
  const [cx, cy] = point(path, b + 1);
  const [into, out] = [Math.hypot(x - ax, y - ay), Math.hypot(cx - x, cy - y)];
  if (!(into > near && out > near)) return false;
  if (((x - ax) * (cx - x) + (y - ay) * (cy - y)) / (into * out) < -0.5) return false;
  for (const { from, to } of meeting)
    for (let s = from + 1; s <= to; s++)
      if (s !== b && s !== b + 1 && distanceTo(path, s, x, y) <= near) return false;
  return true;
}

/** The first and last points of the run of connected points of `path` holding point `i`. */
function runOf(path: Polyline, i: number): [number, number] {
  let [run, high] = [0, path.starts.length - 1];
  while (run < high) {
    const mid = (run + high + 1) >>> 1;
    if (path.starts[mid]! <= i) run = mid;
    else high = mid - 1;
  }
  return [path.starts[run] ?? 0, path.runEnd(run) - 1];
}

/** Whether segment `s` of `path` (from point s - 1 to s) is a curve. */
function curved(path: Polyline, s: number): boolean {
  return path.curved && !Number.isNaN(path.controls[s * 4]!);
}

/** The unit vector from point `a` of `path` to point `b`. */
function way(path: Polyline, a: number, b: number): [number, number] {
  const [ax, ay] = point(path, a);
  const [bx, by] = point(path, b);
  const length = Math.hypot(bx - ax, by - ay);
  return [(bx - ax) / length, (by - ay) / length];
}

/**
 * How far (x, y) is from segment `s` of `path`: from its line, or from the
 * box holding a curve's ends and controls, which holds the curve.
 */
function distanceTo(path: Polyline, s: number, x: number, y: number): number {
  const [ax, ay] = point(path, s - 1);
  const [bx, by] = point(path, s);
  if (!curved(path, s)) {
    const [dx, dy] = [bx - ax, by - ay];
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(x - ax - t * dx, y - ay - t * dy);
  }
  const k = path.controls;
  const xs = [ax, bx, k[s * 4]!, k[s * 4 + 2]!];
  const ys = [ay, by, k[s * 4 + 1]!, k[s * 4 + 3]!];
  const gap = (v: number, values: number[]) =>
    Math.max(0, Math.min(...values) - v, v - Math.max(...values));
  return Math.hypot(gap(x, xs), gap(y, ys));
}

/**
 * An area's stretches, each an area of its own filling between its edges'
 * stretches (`lower` undefined for areas closing at their baseline), into
 * buffers `buffer(i, edge)`; without outlines, which `strokeStretches`
 * draws. An area along y closes at its baseline through a lower edge of its
 * own, a line across x (area.ts), which each stretch takes between its ends.
 */
export function fillPieces(
  area: AreaGeometry,
  upper: readonly Stretch[],
  lower: readonly Stretch[] | undefined,
  buffer: (i: number, edge: "upper" | "lower") => Polyline,
): { area: AreaGeometry; run: number }[] {
  const out: { area: AreaGeometry; run: number }[] = [];
  upper.forEach((top, i) => {
    // A band's edges have the same runs in the same order.
    const bottom = lower?.[i];
    if (lower && !bottom) return;
    let edge: Polyline | null = null;
    if (bottom) edge = copyStretch(area.lower!, bottom.from, bottom.to, buffer(i, "lower"));
    else if (area.lower) {
      edge = buffer(i, "lower");
      edge.reset();
      const x = area.lower.coords[0]!;
      edge.push(x, area.upper.coords[top.from * 2 + 1]!);
      edge.push(x, area.upper.coords[top.to * 2 + 1]!);
      edge.whole = false;
    }
    out.push({
      area: {
        ...area,
        key: `${area.key}|run${i}`,
        of: area.of ?? area.key,
        upper: copyStretch(area.upper, top.from, top.to, buffer(i, "upper")),
        lower: edge,
        stroke: null,
        strokeWidth: 0,
        curve: undefined,
      },
      run: top.run,
    });
  });
  return out;
}

/** Points [from, to] of `path` into `out`, curved as they are, after `start` and before `end`. */
function copyStretch(
  path: Polyline,
  from: number,
  to: number,
  out: Polyline,
  start?: [number, number],
  end?: [number, number],
): Polyline {
  out.reset();
  const c = path.coords;
  const k = path.controls;
  if (start) out.push(start[0], start[1]);
  out.push(c[from * 2]!, c[from * 2 + 1]!);
  for (let i = from + 1; i <= to; i++)
    if (path.curved && !Number.isNaN(k[i * 4]!))
      out.curveTo(k[i * 4]!, k[i * 4 + 1]!, k[i * 4 + 2]!, k[i * 4 + 3]!, c[i * 2]!, c[i * 2 + 1]!);
    else out.push(c[i * 2]!, c[i * 2 + 1]!);
  if (end) out.push(end[0], end[1]);
  out.whole = false;
  return out;
}

function point(path: Polyline, i: number): [number, number] {
  return [path.coords[i * 2]!, path.coords[i * 2 + 1]!];
}

/**
 * The way `path` arrives at point `i` (`into`) or leaves it, within its
 * run of connected points, as a unit vector: along a curve's tangent, past
 * segments of no length; the other way where there is none, and (1, 0)
 * for points all in one place.
 */
function direction(path: Polyline, i: number, into: boolean, turned = false): [number, number] {
  const k = path.curved ? path.controls : undefined;
  const [x, y] = point(path, i);
  const [first, last] = runOf(path, i);
  // Segment s runs from point s - 1 to point s: nearest first, a curve's
  // control points; past the points sharing i's place at once.
  let from = i;
  if (into) while (from > first && still(path, from)) from--;
  else {
    while (from < last && still(path, from + 1)) from++;
    from++;
  }
  for (let s = from; into ? s > first : s <= last; s += into ? -1 : 1) {
    const near: [number, number][] =
      k && !Number.isNaN(k[s * 4]!)
        ? (into ? [2, 0] : [0, 2]).map((q) => [k[s * 4 + q]!, k[s * 4 + q + 1]!])
        : [];
    near.push(point(path, into ? s - 1 : s));
    for (const [px, py] of near) {
      const [dx, dy] = into ? [x - px, y - py] : [px - x, py - y];
      const length = Math.hypot(dx, dy);
      if (length > 1e-9) return [dx / length, dy / length];
    }
  }
  return turned ? [1, 0] : direction(path, i, !into, true);
}

/** Whether segment `s` of `path`, from point s - 1 to s, has no length, its controls neither. */
function still(path: Polyline, s: number): boolean {
  const c = path.coords;
  const [x, y] = [c[s * 2]!, c[s * 2 + 1]!];
  if (c[s * 2 - 2] !== x || c[s * 2 - 1] !== y) return false;
  const k = path.controls;
  if (!path.curved || Number.isNaN(k[s * 4]!)) return true;
  return k[s * 4] === x && k[s * 4 + 1] === y && k[s * 4 + 2] === x && k[s * 4 + 3] === y;
}

/** The unit normal of the line splitting the corner between unit directions `a` and `b` in two. */
function bisector(a: readonly number[], b: readonly number[]): [number, number] {
  const [x, y] = [a[0]! + b[0]!, a[1]! + b[1]!];
  const length = Math.hypot(x, y);
  return [x / length, y / length];
}

/**
 * The square past the line through (x, y) across `normal` on the side it
 * points to (`reach` positive) or away from: `|reach|` deep, twice as wide.
 */
function beyond(x: number, y: number, normal: readonly number[], reach: number): number[] {
  const [nx, ny] = [normal[0]! * reach, normal[1]! * reach];
  // Along the line, as far either way.
  const [ax, ay] = [-ny, nx];
  return [x + ax, y + ay, x + ax + nx, y + ay + ny, x - ax + nx, y - ay + ny, x - ax, y - ay];
}

function same(a: readonly number[] | undefined, b: readonly number[]): boolean {
  return a?.length === b.length && a.every((v, i) => v === b[i]);
}

/** The length of `path` from point `from` to point `to`, curves measured by Gauss-Legendre quadrature. */
function lengthOf(path: Polyline, from: number, to: number): number {
  const c = path.coords;
  const k = path.controls;
  let length = 0;
  for (let i = from + 1; i <= to; i++) {
    const [x0, y0, x3, y3] = [c[i * 2 - 2]!, c[i * 2 - 1]!, c[i * 2]!, c[i * 2 + 1]!];
    if (!path.curved || Number.isNaN(k[i * 4]!)) {
      length += Math.hypot(x3 - x0, y3 - y0);
      continue;
    }
    const [x1, y1, x2, y2] = [k[i * 4]!, k[i * 4 + 1]!, k[i * 4 + 2]!, k[i * 4 + 3]!];
    for (let g = 0; g < NODES.length; g++) {
      const t = NODES[g]!;
      const [a, b, d] = [3 * (1 - t) * (1 - t), 6 * (1 - t) * t, 3 * t * t];
      const dx = a * (x1 - x0) + b * (x2 - x1) + d * (x3 - x2);
      const dy = a * (y1 - y0) + b * (y2 - y1) + d * (y3 - y2);
      length += WEIGHTS[g]! * Math.hypot(dx, dy);
    }
  }
  return length;
}

/** Five-point Gauss-Legendre nodes and weights over [0, 1]. */
const NODES = [0.046910077030668, 0.2307653449471585, 0.5, 0.7692346550528415, 0.9530899229693319];
const WEIGHTS = [
  0.1184634425280945, 0.2393143352496832, 0.2844444444444444, 0.2393143352496832,
  0.1184634425280945,
];

/** Past the plot as far as anything is drawn, in pixels. */
const FAR = 1e5;

/** `geometry` drawn without what lies within `holes` (polygons, x, y pairs): an SVG clip, a canvas clip. */
export function holed<G extends Geometry>(geometry: G, holes: readonly number[][]): G {
  if (holes.length === 0) return geometry;
  // Elements would leave the clips out: the SVG layer writes markup.
  const { elements: _, ...draw } = geometry.draw as Drawing<Geometry>;
  const paint = draw.canvas;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const outlines = holes.map((hole) => {
    let d = `M${-FAR} ${-FAR}H${FAR}V${FAR}H${-FAR}ZM${round(hole[0]!)} ${round(hole[1]!)}`;
    for (let i = 2; i < hole.length; i += 2) d += `L${round(hole[i]!)} ${round(hole[i + 1]!)}`;
    return `${d}Z`;
  });
  // Named by what they cut, so SVG documents drawn apart and shown on one page do not mix them up.
  const ids = outlines.map((d) => `herceg-cut-${hash(geometry.key + d)}`);
  const drawing: Drawing<Geometry> = {
    ...draw,
    holes: [...(draw.holes ?? []), ...holes],
    svg: (g, context) =>
      outlines.reduce(
        (inner, d, i) =>
          `<clipPath id="${ids[i]}"><path clip-rule="evenodd" d="${d}"/></clipPath><g clip-path="url(#${ids[i]})">${inner}</g>`,
        draw.svg(g, context),
      ),
    canvas:
      paint &&
      ((context, g, options) => {
        context.save();
        for (const hole of holes) {
          context.beginPath();
          context.rect(-FAR, -FAR, 2 * FAR, 2 * FAR);
          context.moveTo(hole[0]!, hole[1]!);
          for (let i = 2; i < hole.length; i += 2) context.lineTo(hole[i]!, hole[i + 1]!);
          context.closePath();
          context.clip("evenodd");
        }
        paint(context, g, options);
        context.restore();
      }),
  };
  return { ...geometry, draw: drawing };
}

/** A 32-bit FNV-1a hash of `text`, in base 36. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}
