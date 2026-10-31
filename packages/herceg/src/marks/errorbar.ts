import type { NumericArray } from "../data/column.ts";
import type { CategoryField, NumericField, PositionField, Schema, Table } from "../data/table.ts";
import { segmentDrawing } from "../draw/segments.ts";
import type { Breaks } from "../lod/m4.ts";
import { clearDomain } from "../model/clearance.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { Rect, SegmentGeometry } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { Clip, ErrorBarSpec, Frozen } from "../spec/spec.ts";
import { colored } from "./colored.ts";
import { BandShares } from "./dodge.ts";
import type { DrawnMark, PickedItem, PickQuery } from "./drawn.ts";
import type { CssColor, FieldCoordinate, ItemKeyed } from "./encoding.ts";
import { definedFields } from "./line.ts";
import {
  type BandContext,
  type BandList,
  type Bands,
  bandIndices,
  buildSeries,
  CATEGORY,
  type ChartMark,
  checkItemKey,
  type Frame,
  fieldBands,
  frozen,
  type Hit,
  type MARK,
  type Mark,
  type MarkKey,
  type MarkSources,
  NUMERIC,
  type Palette,
  requireField,
  SeriesSplitter,
  valueKind,
} from "./mark.ts";
import { bindRows, offAxis, type RowBindings } from "./row-bindings.ts";
import { type MarkRows, rowsOf } from "./rows.ts";
import { lowerPosition, rowOf, type Series, TableCache, visibleRange, xExtent } from "./series.ts";
import { boxOf, clipBox, distanceToCut, paintedLater } from "./shapes.ts";
import { checkTooltip, type MarkTooltip } from "./tooltip-fields.ts";
import { unionExtent } from "./trace.ts";

interface ErrorBarStyle<S extends Schema> extends ItemKeyed<S> {
  /** The y axis the values are on: "left" (default) or "right", the chart's `yRight`. */
  axis?: "left" | "right";
  /** With the chart's `facet`, draw all rows in every panel instead of splitting them. */
  facet?: "repeat";
  /**
   * What the mark's drawing is cut to: "plot", "chart", or false for
   * nothing, so markers at the plot's edge show whole. Without it, data is
   * cut to the plot and labels are drawn whole.
   */
  clip?: Clip;
  /** With the chart's `panels`, the id of the panel to draw in, or "*" for every panel. */
  panel?: string;
  /** Category field: one series of error bars per value. */
  series?: CategoryField<S>;
  /**
   * A category field naming the series, whose values color them (as
   * `series` does, which must then name it too), or a color for every
   * mark's lines, as `stroke` sets it.
   */
  color?: CategoryField<S> | CssColor;
  /**
   * With `series` and category positions: place the series side by side in
   * each band, as grouped bars are, so each interval stands on its bar.
   */
  dodge?: boolean;
  stroke?: string;
  strokeWidth?: number;
  /** Width of the caps at each end in pixels; 0 for none. Default 8. */
  cap?: number;
  /** Where the error bars are drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  /** `false`: the pointer passes through the marks: clicks, hover, and context menus pick what is under them. */
  pick?: boolean;
  /** `false`: tooltips, hover, and the keyboard leave the marks out. */
  inspect?: boolean;
  label?: string;
  /** `false` leaves the mark out of the chart's legends. */
  legend?: false;
  /** Fields of the row tooltips show besides the mark's values, such as counts that are not plotted. */
  tooltip?: MarkTooltip<S>;
  id?: string;
}

/** Vertical error bars at each `x`, from `y1` to `y2`. */
export interface VerticalErrorBarOptions<S extends Schema> extends ErrorBarStyle<S> {
  x: PositionField<S> | FieldCoordinate<S>;
  y1: NumericField<S> | FieldCoordinate<S, NumericField<S>>;
  y2: NumericField<S> | FieldCoordinate<S, NumericField<S>>;
  y?: never;
  yError?: never;
  x1?: never;
  x2?: never;
  xError?: never;
}

/** Vertical error bars at each `x`, from `y - yError` to `y + yError`. */
export interface VerticalSymmetricErrorBarOptions<S extends Schema> extends ErrorBarStyle<S> {
  x: PositionField<S> | FieldCoordinate<S>;
  y: NumericField<S>;
  yError: NumericField<S>;
  y1?: never;
  y2?: never;
  x1?: never;
  x2?: never;
  xError?: never;
}

/** Horizontal error bars at each `y`, from `x1` to `x2`. */
export interface HorizontalErrorBarOptions<S extends Schema> extends ErrorBarStyle<S> {
  y: PositionField<S> | FieldCoordinate<S>;
  x1: NumericField<S> | FieldCoordinate<S, NumericField<S>>;
  x2: NumericField<S> | FieldCoordinate<S, NumericField<S>>;
  x?: never;
  xError?: never;
  y1?: never;
  y2?: never;
  yError?: never;
  /** Positions along y are on the left axis; only vertical error bars use the right one. */
  axis?: "left";
}

/** Horizontal error bars at each `y`, from `x - xError` to `x + xError`. */
export interface HorizontalSymmetricErrorBarOptions<S extends Schema> extends ErrorBarStyle<S> {
  y: PositionField<S> | FieldCoordinate<S>;
  x: NumericField<S>;
  xError: NumericField<S>;
  x1?: never;
  x2?: never;
  y1?: never;
  y2?: never;
  yError?: never;
  /** Positions along y are on the left axis; only vertical error bars use the right one. */
  axis?: "left";
}

export type ErrorBarOptions<S extends Schema> =
  | VerticalErrorBarOptions<S>
  | VerticalSymmetricErrorBarOptions<S>
  | HorizontalErrorBarOptions<S>
  | HorizontalSymmetricErrorBarOptions<S>;

const CAP = 8;
const ENDS = ["x", "y", "x1", "x2", "y1", "y2", "xError", "yError"] as const;

/**
 * The form of an error bar spec, vertical or horizontal, from two ends or a
 * center and an error; or why it has none. A field of another form would
 * be dropped quietly, so it is refused.
 */
export function errorBarForm(
  spec: Partial<Record<(typeof ENDS)[number], unknown>>,
): { horizontal: boolean; symmetric: boolean } | string {
  const vertical = spec.yError !== undefined || (spec.y1 !== undefined && spec.y2 !== undefined);
  const horizontal = spec.xError !== undefined || (spec.x1 !== undefined && spec.x2 !== undefined);
  if (vertical === horizontal) {
    return "errorbar: needs x with y1 and y2, or with y and yError (vertical); or y with x1 and x2, or with x and xError (horizontal)";
  }
  const [along, across] = horizontal ? (["y", "x"] as const) : (["x", "y"] as const);
  if (spec[along] === undefined) return `errorbar ${along}: required`;
  const symmetric = spec[`${across}Error`] !== undefined;
  if (symmetric && spec[across] === undefined) return `errorbar ${across}Error: needs ${across}`;
  const used: string[] = symmetric
    ? [along, across, `${across}Error`]
    : [along, `${across}1`, `${across}2`];
  const extra = ENDS.find((key) => spec[key] !== undefined && !used.includes(key));
  if (extra) return `errorbar ${extra}: not with ${used.join(", ")}; drop it`;
  return { horizontal, symmetric };
}

/** Where an interval's ends come from: two fields, or a center and a symmetric error. */
type Ends = { low: string; high: string } | { center: string; error: string };

/**
 * Intervals with caps, such as confidence intervals or min-max ranges.
 * Series are kept in chart coordinates: vertical bars hold their high end in
 * `y` and low end in `y0`, horizontal ones in `x` and `x0`. Tooltips report
 * both ends; intervals missing an end, or with an end the axis cannot
 * place, are neither drawn nor counted toward the axes.
 */
export class ErrorBarMark implements Mark<Frozen<ErrorBarSpec>> {
  declare readonly [MARK]: true;
  readonly clearDomain = clearDomain;
  readonly spec: Frozen<ErrorBarSpec>;
  readonly table: Table<Schema>;
  readonly identity: MarkSources;
  readonly tooltip: "x" | "y";
  readonly inset: { x: number; y: number };
  readonly bound: RowBindings | undefined;
  readonly horizontal: boolean;
  /** The field intervals stand at: x for vertical bars, y for horizontal ones. */
  readonly #position: string;
  readonly #ends: Ends;
  readonly #categorical: boolean;
  readonly #split: SeriesSplitter;
  /** Ends computed from a center and an error, per table version. */
  readonly #computed = new TableCache<{ low: Float64Array; high: Float64Array }>();
  /** With `dodge`, each series' share of the bands. */
  readonly #shares: BandShares | undefined;

  constructor(input: ErrorBarSpec, table: Table<Schema>) {
    this.spec = frozen(colored(input, table, "stroke"));
    checkTooltip(table, this.spec.tooltip, "errorbar");
    checkItemKey(table, this.spec.itemKey, "errorbar");
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.table = table;
    const { fields, bound } = bindRows(spec, table, "errorbar", ENDS.slice(0, 6));
    this.bound = bound;
    const form = errorBarForm(spec);
    if (typeof form === "string") throw new Error(form);
    const { horizontal, symmetric } = form;
    this.horizontal = horizontal;
    const [along, across] = horizontal ? (["y", "x"] as const) : (["x", "y"] as const);
    // A symmetric interval's center is a field, as its error is.
    if (symmetric && typeof spec[across] !== "string")
      throw new ChartError({
        code: "invalid-option",
        path: across,
        message: `errorbar ${across}: a center with ${across}Error is a field; give a field's name`,
      });
    const position = fields[along] as string;
    this.#position = position;
    requireField(table, position, [...NUMERIC, ...CATEGORY], `errorbar ${along}`);
    if (symmetric) {
      const center = fields[across] as string;
      const error = spec[`${across}Error`]!;
      requireField(table, center, NUMERIC, `errorbar ${across}`);
      requireField(table, error, NUMERIC, `errorbar ${across}Error`);
      this.#ends = { center, error };
    } else {
      const low = fields[`${across}1`] as string;
      const high = fields[`${across}2`] as string;
      requireField(table, low, NUMERIC, `errorbar ${across}1`);
      requireField(table, high, NUMERIC, `errorbar ${across}2`);
      this.#ends = { low, high };
    }
    if (spec.series !== undefined) requireField(table, spec.series, CATEGORY, "errorbar series");
    this.#categorical = table.kind(position) === "category";
    if (spec.dodge) {
      if (!this.#categorical)
        throw new Error(
          `errorbar dodge: needs category positions; "${position}" is not a category field`,
        );
      if (spec.series === undefined)
        throw new Error("errorbar dodge: places series side by side; give a series field");
      this.#shares = new BandShares();
    }
    this.tooltip = horizontal ? "y" : "x";
    // Caps reach half their width past each position, along the position axis.
    const half = (spec.cap ?? CAP) / 2;
    this.inset = horizontal ? { x: 0, y: half } : { x: half, y: 0 };
    const ends = this.#ends;
    const defaultLabel =
      "center" in ends ? `${ends.center} ± ${ends.error}` : `${ends.low}–${ends.high}`;
    this.#split = new SeriesSplitter(
      () => this.rows(),
      this.#categorical ? undefined : position,
      ["center" in ends ? ends.center : ends.high],
      spec.series,
      spec.label ?? defaultLabel,
    );
    const values = "center" in ends ? [ends.center, ends.error] : [ends.low, ends.high];
    this.identity = { field: spec.series, values };
  }

  #rows: MarkRows | undefined;

  /** What the mark reads of its table now (see marks/rows.ts). */
  rows(): MarkRows {
    this.#rows = rowsOf(this.table, this.#rows);
    return this.#rows;
  }

  channelKind(axis: "x" | "y") {
    if (offAxis(this.bound, axis)) return undefined;
    if ((axis === "y") === this.horizontal) return this.table.kind(this.#position);
    const ends = this.#ends;
    return valueKind(this.table, "center" in ends ? [ends.center] : [ends.low, ends.high]);
  }

  bands(axis: "x" | "y", context: BandContext): BandList | undefined {
    return (axis === "y") === this.horizontal && this.#categorical
      ? fieldBands(this.rows(), this.#position, context)
      : undefined;
  }

  series(
    key: MarkKey,
    palette: Palette,
    _hidden: ReadonlySet<string>,
    bands: Bands,
    context: BandContext,
  ): Series[] {
    const { spec, table } = this;
    const positions = this.#categorical
      ? bandIndices(
          this.rows(),
          this.#position,
          (this.horizontal ? bands.y : bands.x)?.keys ?? [],
          context,
        )
      : table.numbers(this.#position as never);
    const { low, high } = this.#endColumns();
    const series = buildSeries(table, this.#split.sources(), positions, key, palette, spec.stroke);
    for (const s of series) {
      s.y = high;
      s.y0 = low;
      s.values = high;
      s.range = true;
      // Series are built with positions on x; horizontal bars swap them onto
      // y, where binary search over x no longer applies, and over y does
      // where they were sorted.
      if (this.horizontal) {
        [s.x, s.y, s.x0, s.y0] = [s.y, s.x, s.y0, undefined];
        [s.sorted, s.ySorted] = [false, s.sorted];
      }
    }
    return series;
  }

  xExtent(series: readonly Series[], log: boolean) {
    if (this.horizontal) return unionExtent(series.map((s) => this.#interval(s, log)));
    return this.#categorical ? undefined : unionExtent(series.map((s) => xExtent(s, log)));
  }

  yExtent(series: readonly Series[], x0: number, x1: number, log: boolean, breaks?: Breaks) {
    if (!this.horizontal)
      return unionExtent(series.map((s) => this.#interval(s, log, x0, x1, breaks)));
    return this.#categorical ? undefined : unionExtent(series.map((s) => xExtent(swap(s), log)));
  }

  geometry(series: readonly Series[], frame: Frame): SegmentGeometry[] {
    const horizontal = this.horizontal;
    const along = horizontal ? frame.y : frame.x;
    const across = horizontal ? frame.x : frame.y;
    const half = (this.spec.cap ?? CAP) / 2;
    const out: SegmentGeometry[] = [];
    this.#shares?.split(series, frame, true);
    for (const s of series) {
      if (frame.hidden.has(s.key)) continue;
      const shift = this.shift(s, along);
      const [start, end] = horizontal
        ? [0, s.length]
        : visibleRange(s, along.domain[0], along.domain[1]);
      const { positions, lows, highs } = columns(s, horizontal);
      // On a panel's own categories, chart bands are read through their places (see placeAt).
      const places = s.places?.[horizontal ? "y" : "x"];
      // A stem and up to two caps per interval.
      const coords = frame.floats(s.key, "segments", (end - start) * 12);
      let count = 0;
      const push = (a: number, b: number, c: number, d: number) => {
        const at = count * 4;
        // Coordinates are written along, across; horizontal bars swap them.
        coords[at] = horizontal ? b : a;
        coords[at + 1] = horizontal ? a : b;
        coords[at + 2] = horizontal ? d : c;
        coords[at + 3] = horizontal ? c : d;
        count++;
      };
      for (let k = start; k < end; k++) {
        const row = rowOf(s, k);
        const band = positions[row]!;
        const at = places && band >= 0 ? places.at(band) : band;
        if (this.#categorical && at < 0) continue;
        // Intervals at times an axis break leaves out are not drawn.
        if (along.breaks?.hides(at)) continue;
        const p = along.map(at) + shift;
        const lo = across.map(lows[row]!);
        const hi = across.map(highs[row]!);
        if (!(Number.isFinite(p) && Number.isFinite(lo) && Number.isFinite(hi))) continue;
        push(p, lo, p, hi);
        if (half > 0) {
          push(p - half, lo, p + half, lo);
          push(p - half, hi, p + half, hi);
        }
      }
      out.push({
        kind: "segments",
        draw: segmentDrawing,
        key: s.key,
        stroke: s.color,
        strokeWidth: this.spec.strokeWidth ?? 1.5,
        coords,
        count,
      });
    }
    return out;
  }

  /**
   * Its bars are found as `pick` finds them, measured to their painted
   * strokes; bounded by what its clip keeps of them (marks/lookups.ts).
   */
  pickItem(drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
    return query.lookups.errorbar(this, drawn, query, PICKING);
  }

  /**
   * The interval nearest a pixel, measured to its stem and caps as drawn
   * (clipped to the plot). Sorted positions are searched outward from the
   * pointer in both directions until positions alone are farther than the
   * best match.
   */
  pick(series: readonly Series[], px: number, py: number, frame: Frame): Hit | undefined {
    return this.find(series, px, py, frame, 0, false);
  }

  /**
   * `pick`'s lookup: measured to the stem and caps drawn, as rectangles
   * `stroke` pixels wide (their butt ends square), cut to the plot; with
   * `top`, for picking, cut as the mark is (`clip`), and of intervals as
   * near, the one painted last (a highlight's selected rows over the
   * others, as tooltips rank them).
   */
  find(
    series: readonly Series[],
    px: number,
    py: number,
    frame: Frame,
    stroke: number,
    top: boolean,
  ): Hit | undefined {
    const horizontal = this.horizontal;
    const along = horizontal ? frame.y : frame.x;
    const across = horizontal ? frame.x : frame.y;
    const pointer = horizontal ? py : px;
    const half = (this.spec.cap ?? CAP) / 2;
    const width = stroke / 2;
    const { plot } = frame;
    // Picking measures what is drawn: past the plot with a clip of "chart" or false.
    const box = top ? clipBox(this.spec.clip, frame) : plot;
    const lit = top ? frame.highlighted?.(this.table) : undefined;
    let best: Hit | undefined;
    // Its paint order: selected, series index, position.
    let bestAt = [-1, -1, -1];
    series.forEach((s, i) => {
      const { positions, lows, highs } = columns(s, horizontal);
      const shift = this.shift(s, along);
      const places = s.places?.[horizontal ? "y" : "x"];
      // The positions geometry draws, for picking: vertical intervals in view and beside it.
      const [start, end] =
        top && !horizontal ? visibleRange(s, along.domain[0], along.domain[1]) : [0, s.length];
      /** Considers position k; returns how far along the position axis it stands. */
      const consider = (k: number): number => {
        const row = rowOf(s, k);
        const band = positions[row]!;
        const at = places && band >= 0 ? places.at(band) : band;
        const p = along.map(at) + shift;
        if (!Number.isFinite(p)) return 0;
        const offset = Math.abs(p - pointer);
        // As geometry draws: nothing off the chart's categories or in an axis break.
        if ((this.#categorical && at < 0) || along.breaks?.hides(at) || k < start || k >= end)
          return offset;
        const a = across.map(lows[row]!);
        const b = across.map(highs[row]!);
        if (!(Number.isFinite(a) && Number.isFinite(b))) return offset;
        const order = [lit?.[row] ?? 0, i, k];
        for (const [u1, v1, u2, v2] of this.pieces(p, a, b, stroke)) {
          const [x1, y1, x2, y2] = horizontal ? [v1, u1, v2, u2] : [u1, v1, u2, v2];
          // Picking measures what is painted, nothing where only an edge is
          // kept; tooltips also reach stems of no width.
          const distance = top
            ? distanceToCut(boxOf(x1, y1, x2, y2), box, px, py)
            : clippedDistance(px, py, x1, y1, x2, y2, box);
          const nearest = best?.distance ?? Infinity;
          if (distance < nearest || (top && distance === nearest && paintedLater(order, bestAt))) {
            best = { series: s, position: k, distance };
            bestAt = order;
          }
        }
        return offset;
      };
      // Caps and strokes reach past their position, so positions within that
      // of the best distance may still be as near.
      const reach = Math.max(half, width);
      const farther = (offset: number) => offset - reach > (best?.distance ?? Infinity);
      if (!s.sorted) {
        for (let k = 0; k < s.length; k++) consider(k);
        return;
      }
      const after = lowerPosition(s, along.invert(pointer));
      for (let k = after - 1; k >= 0 && !farther(consider(k)); k--);
      for (let k = after; k < s.length && !farther(consider(k)); k++);
    });
    return best;
  }

  /**
   * The stem from `a` to `b` at `p` and the caps where drawn, each a
   * rectangle `stroke` wide (butt ends square), as [along, across] corners.
   */
  pieces(p: number, a: number, b: number, stroke: number): [number, number, number, number][] {
    const half = (this.spec.cap ?? CAP) / 2;
    const width = stroke / 2;
    const pieces: [number, number, number, number][] = [[p - width, a, p + width, b]];
    if (half > 0)
      pieces.push(
        [p - half, a - width, p + half, a + width],
        [p - half, b - width, p + half, b + width],
      );
    return pieces;
  }

  /** Where a row is drawn, from where its values place it: dodged within its band. */
  displace(s: Series, _row: number, frame: Frame): readonly [number, number] {
    const shift = this.shift(s, this.horizontal ? frame.y : frame.x);
    return this.horizontal ? [0, shift] : [shift, 0];
  }

  /** How far a series stands from its bands' centers along the position axis, in pixels. */
  shift(s: Series, along: PositionScale): number {
    return this.#shares ? this.#shares.of(s, along.bandwidth ?? 0).center : 0;
  }

  /**
   * [min, max] of both ends of the drawable intervals whose position lies in
   * [from, to]: intervals missing an end, or with an end a log axis cannot
   * place, do not count.
   */
  #interval(
    s: Series,
    log: boolean,
    from = Number.NEGATIVE_INFINITY,
    to = Number.POSITIVE_INFINITY,
    breaks?: Breaks,
  ): [number, number] | undefined {
    const { positions, lows, highs } = columns(s, this.horizontal);
    const lo = this.#categorical ? 0 : Math.min(from, to);
    const hi = this.#categorical ? Number.POSITIVE_INFINITY : Math.max(from, to);
    const [start, end] = s.sorted ? visibleRange(s, lo, hi) : [0, s.length];
    const usable = (value: number) => Number.isFinite(value) && (!log || value > 0);
    let min = Infinity;
    let max = -Infinity;
    for (let k = start; k < end; k++) {
      const row = rowOf(s, k);
      const at = positions[row]!;
      if (!(at >= lo && at <= hi) || !Number.isFinite(at) || breaks?.hides(at)) continue;
      const a = lows[row]!;
      const b = highs[row]!;
      if (!(usable(a) && usable(b))) continue;
      min = Math.min(min, a, b);
      max = Math.max(max, a, b);
    }
    return min <= max ? [min, max] : undefined;
  }

  /** The low and high end of every row: the end fields, or the center minus and plus the error. */
  #endColumns(): { low: NumericArray; high: NumericArray } {
    const ends = this.#ends;
    if (!("center" in ends)) {
      return {
        low: this.table.numbers(ends.low as never),
        high: this.table.numbers(ends.high as never),
      };
    }
    return this.#computed.get(this.table, () => {
      const center = this.table.numbers(ends.center as never);
      const error = this.table.numbers(ends.error as never);
      const low = new Float64Array(center.length);
      const high = new Float64Array(center.length);
      for (let i = 0; i < center.length; i++) {
        const e = Math.abs(error[i]!);
        low[i] = center[i]! - e;
        high[i] = center[i]! + e;
      }
      return { low, high };
    });
  }
}

/**
 * Distance from (px, py) to the part of an axis-aligned segment inside
 * `plot` (or the box drawing is cut to); Infinity when none of it is.
 */
function clippedDistance(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  plot: Rect,
): number {
  const left = Math.max(plot.x, Math.min(x1, x2));
  const right = Math.min(plot.x + plot.width, Math.max(x1, x2));
  const top = Math.max(plot.y, Math.min(y1, y2));
  const bottom = Math.min(plot.y + plot.height, Math.max(y1, y2));
  if (left > right || top > bottom) return Infinity;
  const dx = px < left ? left - px : px > right ? px - right : 0;
  const dy = py < top ? top - py : py > bottom ? py - bottom : 0;
  return Math.hypot(dx, dy);
}

/** A series' positions and ends, whichever axis holds them. */
function columns(s: Series, horizontal: boolean) {
  return horizontal
    ? { positions: s.y, lows: s.x0!, highs: s.x }
    : { positions: s.x, lows: s.y0!, highs: s.y };
}

/** A horizontal series with positions on x, so position helpers apply. */
function swap(s: Series): Series {
  return { ...s, x: s.y, sorted: false };
}

/**
 * Error bars: vertical intervals at each `x` (from `y1` to `y2`, or `y ±
 * yError`), or horizontal ones at each `y` (from `x1` to `x2`, or `x ±
 * xError`). Pair them with points or bars to show the center.
 *
 * ```ts
 * errorbar(stats, { x: "group", y1: "low", y2: "high" })
 * errorbar(stats, { x: "group", y: "mean", yError: "se" })
 * errorbar(fits, { y: "model", x1: "lower", x2: "upper", cap: 0 })
 * ```
 */
export function errorbar<S extends Schema>(
  table: Table<S>,
  options: ErrorBarOptions<S>,
): ChartMark<Frozen<ErrorBarSpec>> {
  const spec = {
    type: "errorbar",
    ...definedFields(options as Partial<Record<keyof ErrorBarSpec, unknown>>, [
      "tooltip",
      "x",
      "y",
      "x1",
      "x2",
      "y1",
      "y2",
      "xError",
      "yError",
      "series",
      "color",
      "dodge",
      "stroke",
      "strokeWidth",
      "cap",
      "zIndex",
      "pick",
      "inspect",
      "label",
      "legend",
      "id",
      "itemKey",
      "axis",
      "facet",
      "panel",
      "clip",
    ]),
  } as ErrorBarSpec;
  if (table.name !== undefined) spec.data = table.name;
  // Field names were checked against S above; marks work on the erased schema.
  return new ErrorBarMark(spec, table as unknown as Table);
}

/** What its lookup reads of this module (see marks/lookups.ts). */
const PICKING = { columns };
export type ErrorBarPicking = typeof PICKING;
