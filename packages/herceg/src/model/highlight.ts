// Highlighting: a chart bound to a selection store draws the rows a
// channel selects as they are and dims the others (see row-selection.ts).
// Marks draw their own geometry, so layout, stacking, curves, and color
// stay as drawn without a selection; nothing here is in a chart that binds
// no store.
//
// - Marks drawing a glyph per row (points, bars, error bars, candlesticks,
//   rugs): unselected rows dimmed, then selected rows on top, each row
//   drawn once. Their series keep their place in the list, so grouped bars
//   stay in their slots. Point series the GPU draws stay clouds: two, of
//   their unselected and selected rows.
// - Lines and areas: drawn as they are within the x spans of their runs of
//   selected rows and dimmed outside them, so each pixel is painted once and
//   the highlighted part is the same curve and stack. A line's selected rows
//   with no selected neighbor are dots. Lines whose x does not ascend, and
//   runs of rows at one x, draw whole and dimmed with their selected rows'
//   values over them instead.
// - Marks summarizing rows (histograms, box plots, heatmaps) draw their
//   selected rows against the whole themselves (`Mark.selectedGeometry`),
//   through the parts and dimming lent here.
// - Other marks (annotations, custom marks, contours) draw every row as before.
//
// Memberships, splits, and masked values depend only on the selection and
// the data, so charts showing one selection share them.

import { compileExpression, type Expression } from "../data/expression.ts";
import type { DataSelection, SelectionStore } from "../data/selection.ts";
import type { Table } from "../data/table.ts";
import { pointDrawing } from "../draw/point.ts";
import { unmappable } from "../lod/m4.ts";
import { shareSquares } from "../marks/cell-selection.ts";
import { STILL } from "../marks/dodge.ts";
import {
  DIM,
  type Frame,
  type Mark,
  type MarkKey,
  type RowParts,
  type SelectionDrawing,
} from "../marks/mark.ts";
import { placeAt, rowOf, type Series } from "../marks/series.ts";
import { alphaOf } from "../scale/color.ts";
import {
  type AreaGeometry,
  CLOUD_POINTS,
  type Drawing,
  type Geometry,
  type LineGeometry,
  type PointGeometry,
  type RectGeometry,
} from "../scene/scene.ts";
import type { DotLook } from "./features.ts";

export { DIM };

/** A store channel whose selection a chart highlights, for the marks over its table. */
export interface HighlightedChannel {
  table: Table;
  store: SelectionStore;
  channel: string;
}

/**
 * Whether each of a table's rows is selected, by position: 1 or 0, as of
 * the table's version and, for rows, the set's.
 */
interface Membership {
  version: number;
  generation: number;
  modified: number;
  rowOffset: number;
  /** The row set's version; -1 for a condition. */
  rows: number;
  selected: Uint8Array;
}

/** Positions of a series' rows, split into the selected and the others. */
interface Split {
  on: Uint32Array;
  off: Uint32Array;
}

/** Memberships by table and selection, kept while either lives. */
const memberships = new WeakMap<Table, WeakMap<DataSelection, Membership>>();
/**
 * Splits by membership, then by series rows (the membership itself for
 * series of whole columns), and values with unselected rows missing by
 * membership, then by the column they were read from: kept while the
 * membership lives, so a selection let go takes them with it.
 */
const splits = new WeakMap<Uint8Array, WeakMap<object, Split>>();
const masks = new WeakMap<Uint8Array, WeakMap<object, Float64Array>>();

/** What `cache` keeps for a membership, made on first use. */
function within<V>(cache: WeakMap<Uint8Array, WeakMap<object, V>>, selected: Uint8Array) {
  let kept = cache.get(selected);
  if (!kept) {
    kept = new WeakMap();
    cache.set(selected, kept);
  }
  return kept;
}
/** Dimmed copies of drawings, made once per drawing. */
const dimmedDrawings = new WeakMap<Drawing<Geometry>, Drawing<Geometry>>();
const ON = "\u0001on";
const OFF = "\u0001off";

/** Marks drawing a glyph per row, each drawn dimmed or not. */
const ROWS = new Set(["point", "bar", "errorbar", "rug"]);

/**
 * Which of a table's rows a selection holds, by position. Rows still in the
 * table keep their membership when rows were only appended or dropped
 * since: only appended rows are tested.
 */
export function membership(table: Table, selection: DataSelection): Uint8Array {
  let byTable = memberships.get(table);
  if (!byTable) {
    byTable = new WeakMap();
    memberships.set(table, byTable);
  }
  const known = byTable.get(selection);
  const rows = selection.kind === "rows" ? selection.rows.version : -1;
  const same = known?.generation === table.generation && known.rows === rows;
  if (same && known.version === table.version) return known.selected;
  const selected = new Uint8Array(table.length);
  let from = 0;
  if (same && known.modified === table.modifiedVersion && table.rowOffset >= known.rowOffset) {
    const kept = known.selected.subarray(table.rowOffset - known.rowOffset);
    from = Math.min(kept.length, selected.length);
    selected.set(kept.subarray(0, from));
  }
  if (selection.kind === "rows") {
    const set = selection.rows;
    for (let row = from; row < selected.length; row++) if (set.has(row)) selected[row] = 1;
  } else if (from < selected.length) {
    // Compiled first in any case, which checks it against the table.
    const { at } = compileExpression(selection.expression, table);
    if (!fill(selection.expression, table, from, selected.subarray(from))) {
      selected.fill(0, from);
      for (let row = from; row < selected.length; row++) if (at(row) === true) selected[row] = 1;
    }
  }
  byTable.set(selection, {
    version: table.version,
    generation: table.generation,
    modified: table.modifiedVersion,
    rowOffset: table.rowOffset,
    rows,
    selected,
  });
  return selected;
}

/** Comparisons of a number field with a literal, which conditions test a column at a time. */
const COMPARE = new Set(["==", "!=", "<", "<=", ">", ">="]);
const FLIP: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };

/** How a test's results go into what is there: in place of it, or and-ed or or-ed with it. */
type Into = "set" | "and" | "or";

/**
 * Whether each of rows `from` on (as many as `out` holds) meets condition
 * `e`, 1 or 0 into `out`: worked out a column at a time, for the
 * conditions brushes write (number fields compared with numbers, category
 * fields among labels, and conjunctions, disjunctions, and negations of
 * them), about ten times faster than testing row by row. False, with `out`
 * in any state, for any other condition. It gives what the compiled
 * condition gives: a missing value compares false, though unequal.
 */
function fill(
  e: Expression,
  table: Table,
  from: number,
  out: Uint8Array,
  into: Into = "set",
): boolean {
  const n = out.length;
  if (typeof e === "boolean") {
    const bit = e ? 1 : 0;
    if (into === "set" || (into === "and" && !e) || (into === "or" && e)) out.fill(bit);
    return true;
  }
  if (!Array.isArray(e)) return false;
  const [op, ...args] = e as readonly [string, ...Expression[]];
  const name = (arg: Expression | undefined) =>
    Array.isArray(arg) && arg[0] === "field" && typeof arg[1] === "string" ? arg[1] : undefined;
  // A field between two numbers, as brushes write ranges: one pass.
  const range = op === "and" && args.length === 2 && rangeOf(args[0]!, args[1]!, table);
  if (range) {
    const [v, lo, hi] = range;
    // Without branches: a branch on scattered values mispredicts every other row.
    if (into === "set")
      for (let i = 0; i < n; i++) out[i] = +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
    else if (into === "and")
      for (let i = 0; i < n; i++) out[i]! &= +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
    else for (let i = 0; i < n; i++) out[i]! |= +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
    return true;
  }
  if ((op === "and" || op === "or") && args.length > 0) {
    // Each part goes straight into `out` when it combines as the node does.
    if (into === op || into === "set")
      return args.every((arg, i) => fill(arg, table, from, out, i === 0 ? into : op));
    const own = new Uint8Array(n);
    if (!fill(e, table, from, own)) return false;
    combine(out, own, into);
    return true;
  }
  if (op === "not" && args.length === 1) {
    const own = new Uint8Array(n);
    if (!fill(args[0]!, table, from, own)) return false;
    for (let i = 0; i < n; i++) own[i]! ^= 1;
    combine(out, own, into);
    return true;
  }
  if (COMPARE.has(op) && args.length === 2) {
    const compared = comparisonOf(op, args[0]!, args[1]!, table);
    if (!compared) return false;
    const [v, test, c] = compared;
    const own = into === "set" ? out : new Uint8Array(n);
    // A loop per comparison, without branches: these run over every row.
    if (test === "==") for (let i = 0; i < n; i++) own[i] = +(v[from + i] === c);
    else if (test === "!=") for (let i = 0; i < n; i++) own[i] = +(v[from + i] !== c);
    else if (test === "<") for (let i = 0; i < n; i++) own[i] = +(v[from + i]! < c);
    else if (test === "<=") for (let i = 0; i < n; i++) own[i] = +(v[from + i]! <= c);
    else if (test === ">") for (let i = 0; i < n; i++) own[i] = +(v[from + i]! > c);
    else for (let i = 0; i < n; i++) own[i] = +(v[from + i]! >= c);
    if (own !== out) combine(out, own, into);
    return true;
  }
  const field = name(args[0]);
  if (op !== "in" || field === undefined || table.kind(field) !== "category") return false;
  const candidates = args.slice(1);
  if (!candidates.every((v) => typeof v === "string" || v === null)) return false;
  // Whether each category is a candidate, then each row's.
  const { codes, dictionary } = table.categories(field as never);
  const labels = new Set(candidates);
  const member = Uint8Array.from(dictionary, (label) => (labels.has(label) ? 1 : 0));
  const missing = labels.has(null) ? 1 : 0;
  const own = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const code = codes[from + i]!;
    own[i] = code < 0 ? missing : member[code]!;
  }
  combine(out, own, into);
  return true;
}

/**
 * A comparison of a number field with a number, as a test of the field's
 * values with a literal on the right; undefined for other comparisons.
 */
function comparisonOf(
  op: string,
  left: Expression,
  right: Expression,
  table: Table,
): [values: ArrayLike<number>, op: string, literal: number] | undefined {
  // A literal on the left is the same comparison turned around.
  const flipped = typeof left === "number";
  const [arg, c] = flipped ? [right, left] : [left, right];
  const field = Array.isArray(arg) && arg[0] === "field" ? arg[1] : undefined;
  if (typeof field !== "string" || typeof c !== "number" || table.kind(field) === "category")
    return undefined;
  return [table.numbers(field as never), flipped ? (FLIP[op] ?? op) : op, c];
}

/** A field from one number to another, inclusive (`>=` one and `<=` the other); undefined otherwise. */
function rangeOf(
  a: Expression,
  b: Expression,
  table: Table,
): [values: ArrayLike<number>, lo: number, hi: number] | undefined {
  if (!Array.isArray(a) || !Array.isArray(b)) return undefined;
  const first = comparisonOf(a[0] as string, a[1]!, a[2]!, table);
  const second = comparisonOf(b[0] as string, b[1]!, b[2]!, table);
  if (!first || !second || first[0] !== second[0] || a.length !== 3 || b.length !== 3)
    return undefined;
  const low = first[1] === ">=" ? first : second[1] === ">=" ? second : undefined;
  const high = first[1] === "<=" ? first : second[1] === "<=" ? second : undefined;
  return low && high && low !== high ? [first[0], low[2], high[2]] : undefined;
}

/** `own` into `out`, as `into` says. */
function combine(out: Uint8Array, own: Uint8Array, into: Into): void {
  if (into === "set") out.set(own);
  else if (into === "and") for (let i = 0; i < out.length; i++) out[i]! &= own[i]!;
  else for (let i = 0; i < out.length; i++) out[i]! |= own[i]!;
}

export class Highlighter {
  readonly #channels: readonly HighlightedChannel[];

  constructor(channels: readonly HighlightedChannel[]) {
    this.#channels = channels;
  }

  /**
   * Which of `table`'s rows its channel's selection holds, 1 each, for
   * layout marks to draw highlighted; undefined when it holds none (or
   * rows of a table since reset), or no channel is of the table.
   */
  selected(table: Table): Uint8Array | undefined {
    const selection = this.#selection(table);
    return selection && membership(table, selection);
  }

  /** The selection `table`'s channel holds; undefined for none, or rows of a table since reset. */
  #selection(table: Table): DataSelection | undefined {
    const channel = this.#channels.find((c) => c.table === table);
    const selection = channel?.store.get(channel.channel);
    if (!selection || (selection.kind === "rows" && !selection.rows.current)) return undefined;
    return selection;
  }

  /**
   * The geometry of a mark with the rows its table's channel selects
   * highlighted; undefined when nothing of it is highlighted (the channel
   * holds no selection, or the mark is not one this draws), for the mark
   * to draw as usual.
   */
  geometry(
    mark: Mark,
    series: readonly Series[],
    frame: Frame,
    key: MarkKey,
    rows?: RowParts,
  ): Geometry[] | undefined {
    const type = mark.spec.type;
    if (!ROWS.has(type) && type !== "line" && type !== "area" && !mark.selectedGeometry)
      return undefined;
    const table = mark.table;
    const selected = table && this.selected(table);
    if (!selected) return undefined;
    // Parts of series draw into buffers and keys of their own, hidden as their series are.
    const hidden = (suffix: string) =>
      frame.hidden.size === 0
        ? frame.hidden
        : new Set(series.filter((s) => frame.hidden.has(s.key)).map((s) => s.key + suffix));
    const own = (suffix: string): Frame => ({ ...frame, hidden: hidden(suffix), keyed: false });
    if (mark.selectedGeometry) {
      const byKey = new Map(series.map((s) => [s.key, s]));
      // Each part stands for the drawn series of its key, whose slot it keeps.
      const parts = (list: readonly Series[], suffix: string) =>
        list.map((p) => ({ ...p, key: p.key + suffix, whole: p.whole ?? byKey.get(p.key) }));
      const drawing: SelectionDrawing = {
        selected,
        dimmed: (list) => mark.geometry(parts(list, OFF), own(OFF), key, rows).flatMap(dimLayer),
        lit: (list) => mark.geometry(parts(list, ON), own(ON), key, rows),
        dim: dimLayer,
        squares: shareSquares,
      };
      return mark.selectedGeometry(series, frame, drawing);
    }
    const selection = this.#selection(table)!;
    if (ROWS.has(type)) {
      // Every series' dimmed rows, then every series' selected rows: picking
      // finds those on top (`Frame.highlighted`).
      const dimClouds: Geometry[] = [];
      const litClouds: Geometry[] = [];
      let rest = series;
      if (type === "point" && frame.clouds && series.some((s) => s.length >= CLOUD_POINTS)) {
        const big = series.filter((s) => s.length >= CLOUD_POINTS);
        const drawn = (mark.geometry(big, frame, key) as PointGeometry[]).filter((g) => g.cloud);
        for (const g of drawn) {
          const s = big.find(({ key }) => key === g.key)!;
          const [off, on] = lightClouds(g, split(s, selected), selection, table);
          dimClouds.push(off);
          litClouds.push(on);
        }
        const done = new Set(drawn.map((g) => g.key));
        rest = series.filter((s) => !done.has(s.key));
      }
      const parts = rest.map((s) => split(s, selected));
      const off = rest.map((s, i) => part(s, OFF, parts[i]!.off));
      const on = rest.map((s, i) => part(s, ON, parts[i]!.on));
      // Clouds are drawn into the canvas in turn: each part in its series' place.
      const place = new Map(series.map((s, i) => [s.key, i]));
      const of = ({ key }: Geometry) => place.get(key.slice(0, key.indexOf("\u0001"))) ?? 0;
      const inOrder = (parts: Geometry[]) => parts.sort((a, b) => of(a) - of(b));
      return [
        ...inOrder([...dimClouds, ...mark.geometry(off, own(OFF), key).map(dim)]),
        ...inOrder([...litClouds, ...mark.geometry(on, own(ON), key)]),
      ];
    }
    const drawn = mark.geometry(series, frame, key);
    const byKey = new Map(series.map((s) => [s.key, s]));
    // Lines and areas run along x, or along y (`orient`), which their runs follow.
    const along = mark.tooltip === "y" ? "y" : "x";
    // Stacked areas draw their zeros at a log axis' low end.
    const low =
      type === "area" &&
      Boolean((mark.spec as { stack?: boolean | string }).stack) &&
      frame[along === "x" ? "y" : "x"].type === "log";
    const found = new Map<Series, Runs>();
    const runs = (s: Series) =>
      found.get(s) ?? found.set(s, runsOf(s, selected, frame, low, along)).get(s)!;
    // A series' runs' ends, which its pieces (style runs', markers) share.
    const endsOf = new Map<Series, number[] | undefined>();
    const seriesEnds = (s: Series) => {
      if (!endsOf.has(s)) {
        // Dodged series are drawn off their bands' centers.
        const shift = shiftOf(mark, s, frame)[along === "x" ? 0 : 1];
        endsOf.set(s, runEnds(s, runs(s), frame, shift, along));
      }
      return endsOf.get(s);
    };
    // Series spans cannot say: their selected rows' values draw over them instead.
    const others = new Set<Series>();
    for (const g of drawn) {
      const s = byKey.get(g.of ?? g.key);
      if (s && !seriesEnds(s) && !frame.hidden.has(s.key)) others.add(s);
    }
    const lit = new Map<string, Geometry[]>();
    // Geometry of a series with a key of its own (markers, style runs'
    // pieces) by its series and layer: an area's outlines apart from its fills.
    const litKey = (g: Geometry, on = "") =>
      g.of === undefined ? g.key + on : `${g.of}${on}|${outlined(g) ? "outline" : g.kind}`;
    if (others.size > 0)
      for (const g of mark.geometry(
        [...others].map((s) => masked(s, selected, along === "y")),
        own(ON),
        key,
      )) {
        const parts = lit.get(litKey(g)) ?? lit.set(litKey(g), []).get(litKey(g))!;
        parts.push(...over(g));
      }
    // A series drawn in pieces (sharing `of`: markers, style runs'): each
    // layer's selected values go once, over the last of its dimmed pieces.
    const lastPiece = new Map<string, Geometry>();
    for (const g of drawn) if (g.of !== undefined) lastPiece.set(litKey(g, ON), g);
    // In the mark's order, each part as it paints it: an area's fill, then
    // its outline; a series' selected rows over its own dimmed ones, so that
    // translucent colors selected whole show as they are.
    const out: Geometry[] = [];
    const shift = (s: Series) => shiftOf(mark, s, frame);
    for (const g of drawn) {
      const s = byKey.get(g.of ?? g.key);
      const ends = s && seriesEnds(s);
      // Markers are lit whole where their observations are selected rows,
      // which they mark in place of dots.
      const rows = ends && g.kind === "point" && s.features?.markerRows?.(g);
      if (rows) {
        const [inside, outside] = pointsIn(g as PointGeometry, rows, selected);
        out.push(...dimLayer(outside), inside);
        continue;
      }
      if (ends) {
        // Each pixel is painted once: dimmed outside the selected runs, as
        // drawn inside them; each piece of a series (a style run's) by the
        // spans its own extent reaches, for its own width. Line ends are
        // round caps, half a stroke past the last vertex.
        const width =
          g.kind === "line"
            ? (g as LineGeometry).strokeWidth
            : (g as AreaGeometry).stroke
              ? (g as AreaGeometry).strokeWidth
              : 0;
        const box = strokeBounds(g);
        const [lo, hi] = along === "x" ? [box[0], box[2]] : [box[1], box[3]];
        const spans =
          lo <= hi
            ? spansAt(ends, width / 2, lo, hi)
            : spansAt(ends, width / 2, -Infinity, Infinity);
        const off = complement(spans, frame, along);
        const [outside, inside] =
          lo <= hi ? [reaching(off, lo, hi), reaching(spans, lo, hi)] : [off, spans];
        if (outside.length > 0)
          for (const dimmed of dimLayer(g)) out.push(clipped(dimmed, outside, frame, along, OFF));
        if (inside.length > 0) out.push(clipped(g, inside, frame, along, ON));
        continue;
      }
      // Dimmed, then its selected rows' values over it, part by part.
      const [under, values] = [dimLayer(g), lit.get(litKey(g, ON)) ?? []];
      const last = lastPiece.get(litKey(g, ON));
      if (last) {
        out.push(...under);
        if (last === g) out.push(...values);
        continue;
      }
      for (let i = 0; i < Math.max(under.length, values.length); i++) {
        if (under[i]) out.push(under[i]!);
        if (values[i]) out.push(values[i]!);
      }
    }
    // Dots at selected rows no span shows, for series without markers, in
    // the look each observation is drawn in: a line's color, opacity, and
    // width, an area's outline's (or its dots'), or as its style runs give
    // it. Over the series' own runs, under later series, as its selected
    // parts are (picking reads them so: `litOverSeries`).
    const whole = new Map<string, DotLook>();
    for (const g of drawn)
      if (g.kind === "line") {
        const line = g as LineGeometry;
        whole.set(g.key, {
          color: line.stroke,
          opacity: g.draw.opacity ?? 1,
          width: line.strokeWidth,
        });
      } else if (g.kind === "area" && g.of === undefined) {
        const area = g as AreaGeometry;
        whole.set(g.key, {
          color: area.stroke ?? area.fill,
          opacity: area.strokeOpacity ?? 1,
          width: area.strokeWidth,
        });
      }
    const marked = new Set(drawn.map((g) => (g.kind === "point" ? g.of : undefined)));
    const dotsOf = new Map<string, PointGeometry[]>();
    for (const d of dots(
      series.filter((s) => !marked.has(s.key)),
      table,
      runs,
      frame,
      shift,
      (s) => {
        const at = s.features?.lookAt?.(s);
        const look = whole.get(s.key) ?? { color: s.color, opacity: 1, width: 0 };
        return at ?? (() => look);
      },
    )) {
      const owner = d.key.slice(0, d.key.indexOf(ON));
      (dotsOf.get(owner) ?? dotsOf.set(owner, []).get(owner)!).push(d);
    }
    if (dotsOf.size === 0) return out;
    const ownerOf = (g: Geometry) => (g.of ?? g.key).split("\u0001")[0]!;
    const last = new Map<string, Geometry>();
    for (const g of out) last.set(ownerOf(g), g);
    // Dots of a series none of whose pieces reach the plot go where it
    // would be drawn: before the first part of a later series.
    const order = new Map(series.map((s, i) => [s.key, i]));
    const rank = (owner: string) => order.get(owner) ?? -1;
    const waiting = [...dotsOf.keys()].filter((owner) => !last.has(owner));
    waiting.sort((a, b) => rank(a) - rank(b));
    const placed: Geometry[] = [];
    for (const g of out) {
      const owner = ownerOf(g);
      while (waiting.length > 0 && rank(waiting[0]!) < rank(owner))
        placed.push(...dotsOf.get(waiting.shift()!)!);
      placed.push(g);
      if (last.get(owner) === g && dotsOf.has(owner)) placed.push(...dotsOf.get(owner)!);
    }
    for (const owner of waiting) placed.push(...dotsOf.get(owner)!);
    return placed;
  }
}

/** Points split by whether the rows they stand at (`rows`, one a point) are selected: those in, and the others. */
function pointsIn(
  g: PointGeometry,
  rows: ArrayLike<number>,
  selected: Uint8Array,
): [PointGeometry, PointGeometry] {
  const parts = [new Float32Array(g.count * 2), new Float32Array(g.count * 2)];
  const counts = [0, 0];
  for (let i = 0; i < g.count; i++) {
    const part = selected[rows[i]!] === 1 ? 0 : 1;
    parts[part]!.set(g.coords.subarray(i * 2, i * 2 + 2), counts[part]! * 2);
    counts[part]!++;
  }
  const part = (j: number): PointGeometry => ({
    ...g,
    key: `${g.key}${j ? "" : ON}`,
    coords: parts[j]!,
    count: counts[j]!,
  });
  return [part(0), part(1)];
}

/** How far a mark draws a line's or area's series from its values' place (dodged series). */
function shiftOf(mark: Mark, s: Series, frame: Frame): readonly [number, number] {
  return mark.displace?.(s, 0, frame) ?? STILL;
}

/** A series' positions split by whether their rows are selected. */
function split(s: Series, selected: Uint8Array): Split {
  const kept = within(splits, selected);
  const key = s.rows ?? selected;
  const known = kept.get(key);
  if (known) return known;
  let count = 0;
  for (let k = 0; k < s.length; k++) count += selected[rowOf(s, k)]!;
  const on = new Uint32Array(count);
  const off = new Uint32Array(s.length - count);
  // Each row is written to both and kept by the one it belongs to: without
  // a branch, which scattered selections mispredict. Writes past an array's
  // end, of rows that belong to the other, are dropped.
  let [i, j] = [0, 0];
  for (let k = 0; k < s.length; k++) {
    const row = rowOf(s, k);
    const lit = selected[row]!;
    on[i] = row;
    off[j] = row;
    i += lit;
    j += lit ^ 1;
  }
  const found = { on, off };
  kept.set(key, found);
  return found;
}

/** A series cut down to some of its rows, under a key of its own. */
function part(s: Series, suffix: string, rows: Uint32Array): Series {
  return {
    ...s,
    key: s.key + suffix,
    rows,
    length: rows.length,
    stream: undefined,
    edges: undefined,
    whole: s.whole ?? s,
  };
}

/**
 * A point cloud highlighted on the GPU: its unselected and its selected
 * rows as two clouds, so each point composites once. Each part streams as
 * its cloud does: while the selection stays and rows are only appended and
 * dropped, a part loses rows from its front and gains them at its end, so
 * its upload takes appended points rather than being made again.
 */
function lightClouds(
  g: PointGeometry,
  { on, off }: Split,
  selection: DataSelection,
  table: Table,
): [dimmed: PointGeometry, lit: PointGeometry] {
  const cloud = g.cloud!;
  const rows = (side: "on" | "off", of: Uint32Array, opacity: number): PointGeometry => ({
    ...g,
    key: g.key + (side === "on" ? ON : OFF),
    fillOpacity: opacity,
    opaque: g.opaque && opacity >= 1,
    count: of.length,
    cloud: {
      ...cloud,
      rows: of,
      start: 0,
      end: of.length,
      stream: cloud.stream && partStream(cloud.stream.key, side, of, selection, table),
    },
  });
  return [rows("off", off, g.fillOpacity * DIM), rows("on", on, g.fillOpacity)];
}

/** What a streaming cloud's part was last drawn of, by its cloud's stream key. */
interface PartUpload {
  /** Names the part's upload, as long as it can follow its rows. */
  key: object;
  /** The row set's version; -1 for a condition. */
  version: number;
  generation: number;
  modified: number;
  rowOffset: number;
  rows: Uint32Array;
  /** Rows the part has lost from its front. */
  offset: number;
  /** Counts the times the part changed otherwise, which uploads it again. */
  epoch: number;
}

/** Cloud parts' uploads by selection, then by their cloud's stream key, kept while both live. */
const partUploads = new WeakMap<
  DataSelection,
  WeakMap<object, { on?: PartUpload; off?: PartUpload }>
>();

/**
 * A cloud part's stream (see `PointCloud.stream`): rows dropped from the
 * table's front leave the part's front (its rows are ascending positions),
 * appended rows join its end; any other change starts a new epoch.
 */
function partStream(
  base: object,
  side: "on" | "off",
  rows: Uint32Array,
  selection: DataSelection,
  table: Table,
): NonNullable<NonNullable<PointGeometry["cloud"]>["stream"]> {
  let bySelection = partUploads.get(selection);
  if (!bySelection) {
    bySelection = new WeakMap();
    partUploads.set(selection, bySelection);
  }
  let parts = bySelection.get(base);
  if (!parts) {
    parts = {};
    bySelection.set(base, parts);
  }
  const known = parts[side];
  const version = selection.kind === "rows" ? selection.rows.version : -1;
  let next: PartUpload;
  if (
    known &&
    known.version === version &&
    known.generation === table.generation &&
    known.modified === table.modifiedVersion &&
    table.rowOffset >= known.rowOffset
  ) {
    // Rows of the part before the table's new first row have left.
    const shift = table.rowOffset - known.rowOffset;
    let dropped = 0;
    while (dropped < known.rows.length && known.rows[dropped]! < shift) dropped++;
    next = { ...known, rowOffset: table.rowOffset, rows, offset: known.offset + dropped };
  } else {
    next = {
      key: known?.key ?? {},
      version,
      generation: table.generation,
      modified: table.modifiedVersion,
      rowOffset: table.rowOffset,
      rows,
      offset: 0,
      epoch: (known?.epoch ?? 0) + 1,
    };
  }
  parts[side] = next;
  return { key: next.key, offset: next.offset, modified: next.epoch };
}

/**
 * A line's or area's series with the unselected rows' values (and a
 * stack's or band's bases) missing, so the mark breaks its runs there:
 * values along y, or for marks along y, along x.
 */
function masked(s: Series, selected: Uint8Array, alongY: boolean): Series {
  // Indexes and streams follow the columns, not these values; edges draw a
  // whole layer. A part keeps its whole, whose slot it stands in (dodge).
  const part = { key: s.key + ON, field: undefined, stream: undefined, edges: undefined };
  const whole = s.whole ?? s;
  if (alongY)
    return { ...s, ...part, x: mask(s.x, selected), x0: s.x0 && mask(s.x0, selected), whole };
  return { ...s, ...part, y: mask(s.y, selected), y0: s.y0 && mask(s.y0, selected), whole };
}

function mask(values: Series["y"], selected: Uint8Array): Float64Array {
  const kept = within(masks, selected);
  const known = kept.get(values);
  if (known) return known;
  const out = new Float64Array(selected.length);
  for (let row = 0; row < selected.length; row++)
    out[row] = selected[row] ? values[row]! : Number.NaN;
  kept.set(values, out);
  return out;
}

/** A series' runs of selected rows, as its mark draws them (see `runsOf`). */
interface Runs {
  /**
   * The first and last of each run, as pairs of indices in x order,
   * trimmed to the rows the mark draws through.
   */
  runs: number[];
  /** How many positions are in x order: the series', or a stack layer's with an x. */
  count: number;
  /** The position at an index in x order. */
  at(i: number): number;
  /** Whether the mark draws through the row at an index in x order. */
  drawn(i: number): boolean;
  /** From `i` on by `step`, the first index an axis break does not hide (-1 or `count` past the ends). */
  shown(i: number, step: 1 | -1): number;
}

/**
 * The runs of selected rows of a series, in x order: as its positions are,
 * or for a layer of a stack drawn through its edges, its rows with an x
 * sorted, as the stack orders them. A run ends at its outermost rows the
 * mark draws through, by the rule it draws by: x, y, and a range's or a
 * stack's lower end placed (`low`: zeros at a log axis' low end), rows
 * inside axis breaks hidden, and for a stack's layer drawn through its
 * edges, x alone, since the edges draw what is there. A run goes on across
 * rows a break hides, as the line joins the rows either side, and keeps the
 * rows inside it that the line breaks at: the caps either side are within
 * its span. Only runs' ends and their neighbors are placed, so this costs
 * per run, beyond a scan of the membership.
 */
function runsOf(
  s: Series,
  selected: Uint8Array,
  frame: Frame,
  low: boolean,
  along: "x" | "y",
): Runs {
  const { rows, edges } = s;
  const across = along === "x" ? "y" : "x";
  const bases = along === "x" ? s.y0 : s.x0;
  const sorted = runsAlong(s, frame, along);
  const positionOf = (k: number) => placeAt(s, along, rowOf(s, k));
  let order: Uint32Array | undefined;
  if (!sorted && edges) {
    const placed: number[] = [];
    for (let k = 0; k < s.length; k++) if (Number.isFinite(positionOf(k))) placed.push(k);
    order = Uint32Array.from(placed).sort((a, b) => positionOf(a) - positionOf(b));
  }
  const count = order ? order.length : s.length;
  const at = (i: number) => (order === undefined ? i : order[i]!);
  const [alongMap, acrossMap] = [frame[along].mapping(), frame[across].mapping()];
  // Only time x axes have breaks, which hide positions, or the values of marks along y.
  const breaks = frame.x.breaks;
  const onAlong =
    frame[along].type === "band" ? (v: number) => v >= 0 : (v: number) => !unmappable(alongMap, v);
  const onAcross =
    frame[across].type === "band"
      ? (v: number) => v >= 0
      : (v: number) => (low && v === 0) || !unmappable(acrossMap, v);
  const drawn = (i: number) => {
    const row = rowOf(s, at(i));
    const position = placeAt(s, along, row);
    if (!onAlong(position) || breaks?.hides(placeAt(s, "x", row))) return false;
    // Rows `where` and `continuity.defined` leave out.
    if (s.features?.drawn?.(row) === false) return false;
    return (
      edges !== undefined ||
      (onAcross(placeAt(s, across, row)) && (bases === undefined || onAcross(bases[row]!)))
    );
  };
  const shown = (i: number, step: 1 | -1) => {
    let j = i;
    while (breaks && j >= 0 && j < count && breaks.hides(placeAt(s, "x", rowOf(s, at(j)))))
      j += step;
    return j;
  };
  // Series of whole columns in their own order read the membership directly.
  const direct = order === undefined && rows === undefined;
  const chosen = (i: number) => selected[direct ? i : rowOf(s, at(i))] === 1;
  const runs: number[] = [];
  for (let i = 0; i < count; i++) {
    if (!chosen(i)) continue;
    // Runs start at rows shown: past those a break hides, each read once.
    const from = shown(i, 1);
    if (from !== i) {
      i = from - 1;
      continue;
    }
    const first = i;
    let next = i + 1;
    for (;;) {
      if (i + 1 < count && chosen(i + 1)) i++;
      else {
        // Past rows a break hides, to the row the line joins next.
        next = shown(i + 1, 1);
        if (next === i + 1 || next >= count || !chosen(next)) break;
        i = next;
      }
    }
    let [start, end] = [first, i];
    while (start <= end && !drawn(start)) start++;
    while (end > start && !drawn(end)) end--;
    if (start <= end) runs.push(start, end);
    // The hidden rows after the run were read: go on from the row shown next.
    i = next - 1;
  }
  return { runs, count, at, drawn, shown };
}

/**
 * Whether a series' positions ascend along `along` as it is traced: as it
 * says, or over categories, whose rows lines and areas draw in band order.
 */
function runsAlong(s: Series, frame: Frame, along: "x" | "y"): boolean {
  return (along === "x" ? s.sorted : (s.ySorted ?? false)) || frame[along].type === "band";
}

/**
 * The pixel ends along the axis a series runs along (`along`: x, or y for
 * lines and areas along y) of its runs of selected rows, in pixel order:
 * per run, its low and high ends, from its first row to its last, moved
 * `shift` pixels where a dodged series is drawn, and whether each ends a
 * path (1, else 0), where a stroke's round cap reaches further (`spansAt`).
 * A layer of a stack drawn through its edges (a series field's) fills
 * positions other layers have too: its runs reach the stack's ends past
 * its own first and last rows. Undefined where spans cannot say what is
 * selected: a line whose positions do not ascend, or rows at one position
 * drawn as a run across, all selected or some at a run's end.
 */
function runEnds(
  s: Series,
  found: Runs,
  frame: Frame,
  shift: number,
  along: "x" | "y",
): number[] | undefined {
  const edges = s.edges;
  const sorted = runsAlong(s, frame, along);
  if (!sorted && !edges) return undefined;
  const { at, drawn, shown, count: n } = found;
  // Where the series was traced, as its trace ended its paths (`continuity`, `where`).
  const stops = s.features?.pathEnds?.(s, frame);
  const xAt = (i: number) => placeAt(s, along, rowOf(s, at(i)));
  // Edges hold positions as the series does: bands read through a panel's places.
  const places = s.places?.[along];
  const placed = (value: number) => (places && value >= 0 ? places.at(value) : value);
  // In x order, which is pixel order or (reversed axes) its reverse.
  const ends: number[] = [];
  for (let r = 0; r < found.runs.length; r += 2) {
    const [start, end] = [found.runs[r]!, found.runs[r + 1]!];
    let [from, to] = [xAt(start), xAt(end)];
    // Other rows drawn at a run's end, past breaks too: no span tells their segments apart.
    for (let j = start - 1; j >= 0 && xAt(j) === from; j--) if (drawn(j)) return undefined;
    for (let j = end + 1; j < n && xAt(j) === to; j++) if (drawn(j)) return undefined;
    if (edges && edges.x.length > 0) {
      if (start === 0) from = Math.min(from, placed(edges.x[0]!));
      if (end === n - 1) to = Math.max(to, placed(edges.x[edges.x.length - 1]!));
    }
    // A row alone is a dot.
    if (start === end && from === to) continue;
    if (from === to) return undefined;
    const [a, b] = [frame[along].map(from) + shift, frame[along].map(to) + shift];
    // Ends of paths: as its trace ended them, or rows with no row drawn
    // before or after them, past rows breaks hide.
    const [before, after] = [shown(start - 1, -1), shown(end + 1, 1)];
    const endsPath = (i: number, j: number, way: 1 | -1) =>
      stops ? stops(rowOf(s, at(i)), way) : j < 0 || j >= n || !drawn(j);
    const first = endsPath(start, before, -1) ? 1 : 0;
    const last = endsPath(end, after, 1) ? 1 : 0;
    if (a <= b) ends.push(a, b, first, last);
    else ends.push(b, a, last, first);
  }
  if (ends.length > 4 && ends[0]! > ends[ends.length - 4]!) {
    const reversed: number[] = [];
    for (let i = ends.length - 4; i >= 0; i -= 4) reversed.push(...ends.slice(i, i + 4));
    return reversed;
  }
  return ends;
}

/**
 * The spans of the runs of `ends` (`runEnds`) reaching from `lo` to `hi`,
 * for a stroke whose round caps reach `cap` pixels past a path's ends:
 * ascending pixel pairs, merged where they touch, at least a pixel wide.
 * Found by bisection, so a piece of a series reads only the runs it meets.
 */
function spansAt(ends: readonly number[], cap: number, lo: number, hi: number): number[] {
  // Runs' high ends ascend; a run reaches at most a cap and half a pixel past its ends.
  const reach = cap + 0.5;
  let [a, b] = [0, ends.length / 4];
  while (a < b) {
    const mid = (a + b) >> 1;
    if (ends[mid * 4 + 1]! + reach < lo) a = mid + 1;
    else b = mid;
  }
  const spans: number[] = [];
  for (let i = a * 4; i < ends.length && ends[i]! - reach <= hi; i += 4) {
    let [from, to] = [ends[i]! - ends[i + 2]! * cap, ends[i + 1]! + ends[i + 3]! * cap];
    if (to - from < 1) [from, to] = [(from + to) / 2 - 0.5, (from + to) / 2 + 0.5];
    // A cap may reach over spans before it: they merge.
    while (spans.length > 0 && from <= spans[spans.length - 1]!) {
      to = Math.max(to, spans.pop()!);
      from = Math.min(from, spans.pop()!);
    }
    spans.push(from, to);
  }
  return spans;
}

/** The plot's x (or y, `along`) outside `spans` (ascending pairs), as pairs. */
function complement(spans: readonly number[], frame: Frame, along: "x" | "y"): number[] {
  const { plot } = frame;
  const [start, size] = along === "x" ? [plot.x, plot.width] : [plot.y, plot.height];
  const out: number[] = [];
  let from = start - 1;
  for (let i = 0; i < spans.length; i += 2) {
    if (spans[i]! > from) out.push(from, spans[i]!);
    from = Math.max(from, spans[i + 1]!);
  }
  const end = start + size + 1;
  if (end > from) out.push(from, end);
  return out;
}

/** Of `spans` (ascending pairs that do not overlap), those reaching from `lo` to `hi`. */
function reaching(spans: readonly number[], lo: number, hi: number): number[] {
  let [a, b] = [0, spans.length / 2];
  while (a < b) {
    const mid = (a + b) >> 1;
    if (spans[mid * 2 + 1]! < lo) a = mid + 1;
    else b = mid;
  }
  const out: number[] = [];
  for (let i = a * 2; i < spans.length && spans[i]! <= hi; i += 2)
    out.push(spans[i]!, spans[i + 1]!);
  return out;
}

/**
 * A geometry drawn only over spans (pairs of pixels) along x, across the
 * plot's height, or with `along` "y" along y, across its width.
 */
function clipped(
  geometry: Geometry,
  spans: readonly number[],
  frame: Frame,
  along: "x" | "y",
  part: typeof ON | typeof OFF,
): Geometry {
  const { plot } = frame;
  // Runs of series' data, which canvases draw.
  const draw = geometry.draw as Drawing<Geometry> & { canvas: CanvasPaint };
  // Each span's rectangle: x, y, width, height.
  const rect = (i: number) =>
    along === "x"
      ? [spans[i]!, plot.y, spans[i + 1]! - spans[i]!, plot.height]
      : [plot.x, spans[i]!, plot.width, spans[i + 1]! - spans[i]!];
  // Named by what it cuts, so that scenes name it alike, and SVG documents
  // drawn apart and shown on one page do not mix them up.
  const id = `herceg-runs-${hash(`${geometry.key}${part}${along} ${spans.join(" ")} ${plot.x} ${plot.y} ${plot.width} ${plot.height}`)}`;
  const drawing: Drawing<Geometry> = {
    size: draw.size,
    opacity: draw.opacity,
    clip: Array.from({ length: spans.length / 2 }, (_, i) => rect(i * 2)).flat(),
    // What it leaves out where style runs meet, which PDF cuts as the drawing's own clips do.
    ...(draw.holes && { holes: draw.holes }),
    svg(g, context) {
      // One shape of every span: WebKit clips away all of a flat line under several.
      let d = "";
      for (let i = 0; i < spans.length; i += 2) {
        const [x, y, width, height] = rect(i);
        d += `M${x} ${y}h${width}v${height}h${-width!}Z`;
      }
      return `<clipPath id="${id}"><path d="${d}"/></clipPath><g clip-path="url(#${id})">${draw.svg(g, context)}</g>`;
    },
    canvas(context, g, options) {
      context.save();
      context.beginPath();
      for (let i = 0; i < spans.length; i += 2) {
        const [x, y, width, height] = rect(i);
        context.rect(x!, y!, width!, height!);
      }
      context.clip();
      draw.canvas(context, g, options);
      context.restore();
    },
  };
  return { ...geometry, key: `${geometry.key}${part}${id}`, draw: drawing };
}

type CanvasPaint = Exclude<Drawing<Geometry>["canvas"], false>;

/** What a stroke may paint: its points' bounds (curves' controls too), out by half its width. */
function strokeBounds(geometry: Geometry): [number, number, number, number] {
  const box: [number, number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  const take = (values: ArrayLike<number>, count: number) => {
    for (let i = 0; i + 1 < count; i += 2) {
      const [x, y] = [values[i]!, values[i + 1]!];
      if (Number.isNaN(x) || Number.isNaN(y)) continue;
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
  };
  const paths =
    geometry.kind === "line"
      ? [(geometry as LineGeometry).path]
      : [(geometry as AreaGeometry).upper, (geometry as AreaGeometry).lower];
  for (const path of paths) {
    if (!path) continue;
    take(path.coords, path.count * 2);
    if (path.curved) take(path.controls, path.count * 4);
  }
  // Round joins and caps reach half a width from the path, and a pixel more antialiased.
  const half = (geometry as LineGeometry | AreaGeometry).strokeWidth / 2 + 1;
  return [box[0] - half, box[1] - half, box[2] + half, box[3] + half];
}

/** A 32-bit FNV-1a hash of `text`, in base 36 (as run-paths.ts names its cuts). */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * Where a series draws its runs of one selected row, which no span shows:
 * x, y pixels per row; with `positions`, the position of each in it too.
 */
function loneRows(
  s: Series,
  runs: (s: Series) => Runs,
  frame: Frame,
  shift: (s: Series) => readonly [number, number],
  positions?: number[],
): number[] {
  const coords: number[] = [];
  const found = runs(s);
  const [dx, dy] = shift(s);
  for (let r = 0; r < found.runs.length; r += 2) {
    if (found.runs[r] !== found.runs[r + 1]) continue;
    const k = found.at(found.runs[r]!);
    const row = rowOf(s, k);
    coords.push(frame.x.map(placeAt(s, "x", row)) + dx, frame.y.map(placeAt(s, "y", row)) + dy);
    positions?.push(k);
  }
  return coords;
}

/**
 * Dots at runs of one row drawn, which no span shows, where `shift` says
 * each series is drawn, in the look `looks` gives each position: a
 * geometry per series, a piece of it (`of`), which value animation moves
 * with it by the rows of `table` the dots are. Each covers its
 * observation's stroke, or its dot where it stands alone, and composites
 * over what is drawn under it as translucent points do.
 */
function dots(
  series: readonly Series[],
  table: Table,
  runs: (s: Series) => Runs,
  frame: Frame,
  shift: (s: Series) => readonly [number, number],
  looks: (s: Series) => (position: number) => DotLook,
): PointGeometry[] {
  const out: PointGeometry[] = [];
  for (const s of series) {
    if (frame.hidden.has(s.key)) continue;
    const positions: number[] = [];
    const coords = loneRows(s, runs, frame, shift, positions);
    if (coords.length === 0) continue;
    const lookAt = looks(s);
    // In observation order, each in its own look: later dots over earlier
    // ones, as translucent points draw (never grouped by color).
    const count = positions.length;
    const palette: string[] = [];
    const indexOf = new Map<string, number>();
    const [index, opacities, radii] = [
      new Float32Array(count),
      new Float32Array(count),
      new Float32Array(count),
    ];
    const least = Math.max(2.5, frame.theme.style.line.strokeWidth * 1.5);
    positions.forEach((k, i) => {
      const { color, opacity, width } = lookAt(k);
      let at = indexOf.get(color);
      if (at === undefined) {
        at = palette.length;
        palette.push(color);
        indexOf.set(color, at);
      }
      [index[i], opacities[i], radii[i]] = [at, opacity, Math.max(least, width / 2)];
    });
    const alike = (values: Float32Array) => values.every((value) => value === values[0]);
    const one = palette.length === 1 && alike(opacities) && alike(radii);
    const items = frame.keyed
      ? {
          table,
          generation: table.generation,
          ids: Float64Array.from(positions, (k) => table.rowOffset + rowOf(s, k)),
        }
      : undefined;
    out.push({
      kind: "point",
      draw: pointDrawing,
      key: `${s.key}${ON}-dots`,
      of: s.key,
      ...(items && { items }),
      fill: palette[0]!,
      fillOpacity: opacities[0]!,
      opaque: false,
      radius: radii.reduce((most, r) => Math.max(most, r), 0),
      symbol: "circle",
      coords: Float32Array.from(coords),
      count,
      ...(!one && { colors: { index, palette, categorical: true as const }, opacities, radii }),
    });
  }
  return out;
}

/** A point's or bar's geometry with its opacity dimmed; anything else (labels) drawn dimmed. */
function dim(geometry: Geometry): Geometry {
  if (geometry.kind === "point") {
    const points = geometry as PointGeometry;
    const dimmed: PointGeometry = {
      ...points,
      fillOpacity: points.fillOpacity * DIM,
      opaque: false,
      opacities: points.opacities?.map((opacity) => opacity * DIM),
      ring: points.ring && { ...points.ring, opacity: (points.ring.opacity ?? 1) * DIM },
    };
    return dimmed;
  }
  if (geometry.kind === "rect") {
    const rects = geometry as RectGeometry;
    const { edge } = rects;
    const dimmed: RectGeometry = {
      ...rects,
      fillOpacity: rects.fillOpacity * DIM,
      ...(edge && { edge: { ...edge, opacity: edge.opacity * DIM } }),
    };
    return dimmed;
  }
  let draw = dimmedDrawings.get(geometry.draw);
  if (!draw) {
    draw = faded(geometry.draw, DIM);
    dimmedDrawings.set(geometry.draw, draw);
  }
  return { ...geometry, draw };
}

/**
 * Whether `geometry` is an area of no fill (a style run's outline, or dots
 * of observations standing alone, painted at its stroke's opacity), which
 * paints after an area's fills.
 */
function outlined(geometry: Geometry): boolean {
  return geometry.kind === "area" && (geometry as AreaGeometry).fillOpacity === 0;
}

/**
 * A geometry dimmed, for any kind: an area's fill at a fraction of its
 * opacity and its outline drawn apart, an area of no fill (`outlineOf`)
 * at a fraction of its stroke's opacity, since areas paint their outline
 * at full opacity (and set the canvas' alpha, which a faded drawing would
 * multiply).
 */
function dimLayer(geometry: Geometry): Geometry[] {
  if (geometry.kind !== "area") return [dim(geometry)];
  const area = geometry as AreaGeometry;
  // An outline of no fill (a style run's) dims as drawn, keeping where it is cut.
  if (outlined(area))
    return [{ ...area, strokeOpacity: (area.strokeOpacity ?? 1) * DIM } as AreaGeometry];
  // Areas draw isolated observations as dots of their outline, or of their
  // fill's color without one: with the outline, dimmed, or dimmed here.
  const fill: AreaGeometry = area.stroke
    ? { ...area, fillOpacity: area.fillOpacity * DIM, stroke: null, strokeWidth: 0 }
    : {
        ...area,
        fillOpacity: area.fillOpacity * DIM,
        strokeOpacity: (area.strokeOpacity ?? 1) * DIM,
      };
  return area.stroke ? [fill, ...dimLayer(outlineOf(area))] : [fill];
}

/**
 * An area's outline apart from its fill, as an area of no fill: drawn as
 * the area draws it (its ends, its isolated observations' dots), at its
 * own opacity.
 */
function outlineOf(area: AreaGeometry): AreaGeometry {
  // Its series', whose selected dots are drawn after it.
  return { ...area, key: `${area.key}-outline`, of: area.of ?? area.key, fillOpacity: 0 };
}

/** A drawing of the same marks at `fraction` of their opacity. */
function faded(draw: Drawing<Geometry>, fraction: number): Drawing<Geometry> {
  const { elements, canvas: paint } = draw;
  const copy = {
    ...draw,
    opacity: (draw.opacity ?? 1) * fraction,
    svg: (geometry, context) => `<g opacity="${fraction}">${draw.svg(geometry, context)}</g>`,
    elements:
      elements &&
      ((geometry, context) =>
        elements(geometry, context)?.map(({ tag, attributes }) => ({
          tag,
          attributes: {
            ...attributes,
            opacity: String(fraction * Number(attributes.opacity ?? 1)),
          },
        }))),
    canvas:
      paint &&
      ((context, geometry, options) => {
        const alpha = context.globalAlpha;
        context.globalAlpha = alpha * fraction;
        paint(context, geometry, options);
        context.globalAlpha = alpha;
      }),
  } as Drawing<Geometry>;
  return copy;
}

/**
 * Selected rows' values drawn over their series dimmed (where spans cannot
 * say what is selected), at the opacity that, over the dimmed drawing in
 * the same color, shows the mark's own: a color of alpha `a` (its own
 * alpha times the mark's opacity) over itself at `a * DIM` composites to
 * `a` when drawn at `(1 - DIM) a / (1 - DIM a)`. An area's outline is
 * drawn apart, an area of no fill (`outlineOf`), so each is drawn at its
 * own alpha.
 */
function over(geometry: Geometry): Geometry[] {
  const at = (a: number) => (a >= 1 ? 1 : ((1 - DIM) * a) / (1 - DIM * a));
  if (geometry.kind === "line") {
    const line = geometry as LineGeometry;
    // The line's alpha: its color's, at the opacity it is drawn at.
    const c = alphaOf(line.stroke) * (line.draw.opacity ?? 1);
    return [
      c >= 1 || c <= 0
        ? line
        : {
            ...line,
            draw: faded(line.draw as Drawing<Geometry>, at(c) / c) as LineGeometry["draw"],
          },
    ];
  }
  if (geometry.kind === "point") {
    // Markers: their fill and ring, each at its own alpha.
    const points = geometry as PointGeometry;
    const fill = alphaOf(points.fill);
    const ring = points.ring;
    const edge = ring && alphaOf(ring.color);
    return [
      {
        ...points,
        fillOpacity: fill > 0 ? at(points.fillOpacity * fill) / fill : points.fillOpacity,
        ...(ring &&
          edge! > 0 && { ring: { ...ring, opacity: at((ring.opacity ?? 1) * edge!) / edge! } }),
      } as PointGeometry,
    ];
  }
  if (geometry.kind !== "area") return [geometry];
  const area = geometry as AreaGeometry;
  if (outlined(area)) {
    // An outline of no fill (a style run's), at its own alpha, keeping where it is cut.
    // Dots of observations standing alone paint in the fill where there is no outline.
    const a = alphaOf(area.stroke ?? area.fill) * (area.strokeOpacity ?? 1);
    if (a >= 1 || a <= 0) return [area];
    return [{ ...area, strokeOpacity: ((area.strokeOpacity ?? 1) * at(a)) / a } as AreaGeometry];
  }
  const c = alphaOf(area.fill);
  // The outline, its isolated observations' dots too, drawn apart.
  const fill: AreaGeometry = {
    ...area,
    fillOpacity: c > 0 ? at(area.fillOpacity * c) / c : area.fillOpacity,
    stroke: null,
    ...(area.stroke && { strokeWidth: 0 }),
  };
  return area.stroke ? [fill, ...over(outlineOf(area))] : [fill];
}
