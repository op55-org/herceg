import type { NumericArray } from "../data/column.ts";
import type { RowView } from "../data/row-view.ts";
import type { NumericField, PositionField, Schema, Table } from "../data/table.ts";
import { rectDrawing } from "../draw/rect.ts";
import { segmentDrawing } from "../draw/segments.ts";
import type { Breaks } from "../lod/m4.ts";
import { type Nearest, settle } from "../model/nearest.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { Geometry, Rect, RectGeometry, SegmentGeometry } from "../scene/scene.ts";
import type { CandlestickSpec, Clip, Frozen } from "../spec/spec.ts";
import { refuseColor } from "./colored.ts";
import type { DrawnMark, PickedItem, PickQuery } from "./drawn.ts";
import type { ItemKeyed } from "./encoding.ts";
import { definedFields } from "./line.ts";
import {
  type AxisFormat,
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
  NUMERIC,
  type Palette,
  painted,
  requireField,
  type SelectionDrawing,
  SeriesSplitter,
  type SummaryContext,
  valueKind,
} from "./mark.ts";
import { isRowView, type MarkRows, rowsOf } from "./rows.ts";
import { lowerPosition, rowOf, type Series, visibleRange, xExtent } from "./series.ts";
import { boxOf } from "./shapes.ts";
import { FILL, Slots } from "./slots.ts";
import { checkTooltip, type MarkTooltip } from "./tooltip-fields.ts";
import { unionExtent } from "./trace.ts";

export interface CandlestickOptions<S extends Schema> extends ItemKeyed<S> {
  /** Time, number, or category field the candles stand at. */
  x: PositionField<S>;
  open: NumericField<S>;
  high: NumericField<S>;
  low: NumericField<S>;
  close: NumericField<S>;
  /** Color of candles closing at or above their open; the theme's `rise` by default. */
  rise?: string;
  /** Color of candles closing below their open; the theme's `fall` by default. */
  fall?: string;
  /**
   * "candlestick" (the default): bodies from open to close, hollow when
   * they rise. "ohlc": bars, a line from low to high with the open ticked
   * to its left and the close to its right, colored by direction.
   */
  variant?: "candlestick" | "ohlc";
  label?: string;
  /** The y axis the prices are on: "left" (default) or "right", the chart's `yRight`. */
  axis?: "left" | "right";
  /** With the chart's `facet`, draw all rows in every panel instead of splitting them. */
  facet?: "repeat";
  /**
   * What the mark's drawing is cut to: "plot", "chart", or false for
   * nothing, so markers at the plot's edge show whole. Without it, data is
   * cut to the plot and labels are drawn whole.
   */
  clip?: Clip;
  /** Where it is drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  /** `false`: the pointer passes through the marks: clicks, hover, and context menus pick what is under them. */
  pick?: boolean;
  /** `false`: tooltips, hover, and the keyboard leave the marks out. */
  inspect?: boolean;
  /** With the chart's `panels`, the id of the panel to draw in, or "*" for every panel. */
  panel?: string;
  /** `false` leaves the mark out of the chart's legends. */
  legend?: false;
  /** Fields of the row tooltips show besides the mark's values, such as counts that are not plotted. */
  tooltip?: MarkTooltip<S>;
  id?: string;
}

/** Segments a candle draws at most: a hollow body's four sides and two wicks. */
const SEGMENTS = 6;
/** Segments of an OHLC bar: its line from low to high, and the open and close ticks. */
const OHLC_SEGMENTS = 3;

type Prices = Record<"open" | "high" | "low" | "close", NumericArray>;

/**
 * The candle of a row, written to `out` as open, high, low, close; false
 * when the row makes none. All four prices must be finite, and positive on
 * a log axis. High and low widen to cover open and close, so inconsistent
 * data still draws within its extent.
 */
function candleOf(prices: Prices, row: number, log: boolean, out: Float64Array): boolean {
  const open = prices.open[row]!;
  const close = prices.close[row]!;
  const rawHigh = prices.high[row]!;
  const rawLow = prices.low[row]!;
  // Each price must be finite before high and low widen over the others.
  if (!(Number.isFinite(open) && Number.isFinite(close))) return false;
  if (!(Number.isFinite(rawHigh) && Number.isFinite(rawLow))) return false;
  const high = Math.max(rawHigh, open, close);
  const low = Math.min(rawLow, open, close);
  if (log && !(low > 0)) return false;
  out[0] = open;
  out[1] = high;
  out[2] = low;
  out[3] = close;
  return true;
}

/**
 * Open-high-low-close candles, as for prices. A candle's body spans its open
 * and close, its wicks its low and high. Candles closing at or above their
 * open are hollow, others filled, so direction reads without color while
 * candles are a few pixels wide. The "ohlc" variant draws bars instead: a
 * line from low to high, the open ticked left and the close right, which
 * show direction by their order. When more candles are in view than the plot
 * has pixels, the candles in each pixel column merge into one: the open of
 * the earliest, the close of the latest (by x, then by row), and the highest
 * high and lowest low. The series reads the close, which tooltips mark and
 * the nearest-point search measures from.
 */
export class CandlestickMark implements Mark<Frozen<CandlestickSpec>> {
  declare readonly [MARK]: true;
  readonly spec: Frozen<CandlestickSpec>;
  readonly table: Table<Schema>;
  /** The view of `table` whose rows the mark draws, when it draws only some (see `rowsOf`). */
  readonly view: RowView | undefined;
  readonly tooltip = "x";
  /** Its one series, named by its label, though it stands for no field. */
  readonly legendScales = ["series"] as const;
  readonly categorical: boolean;
  readonly #split: SeriesSplitter;
  readonly #slots: Slots | undefined;
  /** Scratch for one candle's prices. */
  readonly candle = new Float64Array(4);

  constructor(input: CandlestickSpec, table: Table<Schema>, view?: RowView) {
    this.spec = frozen(input);
    checkTooltip(table, this.spec.tooltip, "candlestick");
    checkItemKey(table, this.spec.itemKey, "candlestick");
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.table = table;
    this.view = view;
    requireField(table, spec.x, [...NUMERIC, ...CATEGORY], "candlestick x");
    for (const name of ["open", "high", "low", "close"] as const)
      requireField(table, spec[name], NUMERIC, `candlestick ${name}`);
    this.categorical = table.kind(spec.x) === "category";
    this.#slots = this.categorical ? undefined : new Slots(() => this.rows(), spec.x);
    this.#split = new SeriesSplitter(
      () => this.rows(),
      this.categorical ? undefined : spec.x,
      [spec.close],
      undefined,
      spec.label ?? spec.close,
    );
  }

  #rows: MarkRows | undefined;

  /** What the mark reads of its table now (see marks/rows.ts). */
  rows(): MarkRows {
    this.#rows = rowsOf(this.view ?? this.table, this.#rows);
    return this.#rows;
  }

  channelKind(axis: "x" | "y") {
    const { spec, table } = this;
    if (axis === "x") return table.kind(spec.x);
    return valueKind(table, [spec.open, spec.high, spec.low, spec.close]);
  }

  bands(axis: "x" | "y", context: BandContext): BandList | undefined {
    return axis === "x" && this.categorical
      ? fieldBands(this.rows(), this.spec.x, context)
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
    const positions = this.categorical
      ? bandIndices(this.rows(), spec.x, bands.x?.keys ?? [], context)
      : table.numbers(spec.x as never);
    const color = painted(context.paint, spec.rise, "candlestick rise") ?? context.theme.rise;
    return buildSeries(table, this.#split.sources(), positions, key, palette, color);
  }

  xExtent(series: readonly Series[], log: boolean, breaks?: Breaks) {
    if (!this.#slots) return undefined;
    const extent = unionExtent(series.map((s) => xExtent(s, log)));
    // Leave half a candle slot of room at each end.
    return extent && this.#slots.pad(extent, log, breaks);
  }

  /**
   * The lowest low and highest high of candles whose center is in [x0, x1]
   * and not inside one of the x axis' `breaks`.
   */
  yExtent(series: readonly Series[], x0: number, x1: number, log: boolean, breaks?: Breaks) {
    const prices = this.prices();
    const candle = this.candle;
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      const [start, end] = this.categorical ? [0, s.length] : visibleRange(s, lo, hi);
      for (let k = start; k < end; k++) {
        const row = rowOf(s, k);
        const at = s.x[row]!;
        if (this.categorical ? at < 0 : !(at >= lo && at <= hi)) continue;
        if (breaks?.hides(at) || !candleOf(prices, row, log, candle)) continue;
        if (candle[2]! < min) min = candle[2]!;
        if (candle[1]! > max) max = candle[1]!;
      }
    }
    return min <= max ? ([min, max] as const) : undefined;
  }

  /**
   * The candles with a selection's rows in them. Candles drawn one by one
   * are rows, dimmed unless selected, as points are; candles merged into
   * pixel columns summarize rows, so the whole column's candle is dimmed
   * and the selected rows' own candle, merged on the same columns, drawn
   * over it.
   */
  selectedGeometry(series: readonly Series[], frame: Frame, drawing: SelectionDrawing): Geometry[] {
    const { selected } = drawing;
    const { x } = frame;
    const columns = Math.max(1, Math.ceil(frame.plot.width));
    // The rows in view a selection holds (1) or leaves out (0).
    const rowsOf = (s: Series, lit: number): Series => {
      const [start, end] = this.categorical
        ? [0, s.length]
        : visibleRange(s, x.domain[0], x.domain[1]);
      let count = 0;
      for (let k = start; k < end; k++) count += selected[rowOf(s, k)] === lit ? 1 : 0;
      const rows = new Uint32Array(count);
      for (let k = start, i = 0; k < end; k++)
        if (selected[rowOf(s, k)] === lit) rows[i++] = rowOf(s, k);
      return { ...s, rows, length: count, stream: undefined };
    };
    const merged = series.filter((s) => this.inView(s, frame, columns) > columns);
    const single = series.filter((s) => !merged.includes(s));
    return [
      ...this.geometry(merged, frame).flatMap(drawing.dim),
      ...drawing.dimmed(single.map((s) => rowsOf(s, 0))),
      ...drawing.lit(series.map((s) => rowsOf(s, 1))),
    ];
  }

  /**
   * How many of a series' candles reach the plot, counted up to one more
   * than `most`: candles merge into pixel columns when there are more of
   * them than columns.
   */
  inView(s: Series, frame: Frame, most: number): number {
    const { x, plot } = frame;
    const prices = this.prices();
    const log = frame.y.type === "log";
    const candle = this.candle;
    const breaks = x.breaks;
    const [start, end] = this.categorical
      ? [0, s.length]
      : visibleRange(s, x.domain[0], x.domain[1]);
    const width = this.categorical ? Math.abs(x.bandwidth ?? 0) : this.#slots!.width(x);
    const places = s.places?.x;
    let count = 0;
    for (let k = start; k < end && count <= most; k++) {
      const row = rowOf(s, k);
      const at = s.x[row]!;
      if ((this.categorical && at < 0) || breaks?.hides(at)) continue;
      const center = x.map(places ? places.at(at) : at);
      const reaches = center >= plot.x - width / 2 && center <= plot.x + plot.width + width / 2;
      if (reaches && candleOf(prices, row, log, candle)) count++;
    }
    return count;
  }

  geometry(series: readonly Series[], frame: Frame): (SegmentGeometry | RectGeometry)[] {
    const out: (SegmentGeometry | RectGeometry)[] = [];
    const { x, y, plot } = frame;
    const prices = this.prices();
    const log = y.type === "log";
    const rise = painted(frame.paint, this.spec.rise, "candlestick rise") ?? frame.theme.rise;
    const fall = painted(frame.paint, this.spec.fall, "candlestick fall") ?? frame.theme.fall;
    const candle = this.candle;
    const ohlc = this.spec.variant === "ohlc";
    // Candles at times an axis break leaves out are not drawn.
    const breaks = x.breaks;
    for (const s of series) {
      if (frame.hidden.has(s.key)) continue;
      const [start, end] = this.categorical
        ? [0, s.length]
        : visibleRange(s, x.domain[0], x.domain[1]);
      const width = this.categorical ? Math.abs(x.bandwidth ?? 0) : this.#slots!.width(x);
      // On a panel's own categories, chart bands are read through their places (see placeAt).
      const places = s.places?.x;
      // Candles whose body reaches the plot.
      const reaches = (center: number) =>
        center >= plot.x - width / 2 && center <= plot.x + plot.width + width / 2;
      // Candles merge when there are more of them than pixel columns; either
      // way there are at most as many as columns, so buffers stay bounded.
      // Some of a series' rows (a selection's) merge as the series does.
      const columns = Math.max(1, Math.ceil(plot.width));
      const count = this.inView(s, frame, columns);
      const merged = (s.whole ? this.inView(s.whole, frame, columns) : count) > columns;
      const capacity = merged ? columns : count;
      const rising = frame.floats(s.key, "rise", capacity * SEGMENTS * 4);
      // A falling candle draws one wick beside its body; a falling bar, all its segments.
      const falling = frame.floats(s.key, "fall", capacity * (ohlc ? OHLC_SEGMENTS : 1) * 4);
      const bodies = ohlc ? undefined : frame.floats(s.key, "body", capacity * 4);
      let risingCount = 0;
      let fallingCount = 0;
      let bodyCount = 0;
      const segment = (
        to: Float32Array,
        at: number,
        a: number,
        b: number,
        c: number,
        d: number,
      ) => {
        to[at * 4] = a;
        to[at * 4 + 1] = b;
        to[at * 4 + 2] = c;
        to[at * 4 + 3] = d;
      };
      const draw = (center: number, width: number, o: number, h: number, l: number, c: number) => {
        const [yo, yh, yl, yc] = [y.map(o), y.map(h), y.map(l), y.map(c)];
        const left = center - width / 2;
        const right = center + width / 2;
        if (ohlc) {
          const rises = c >= o;
          const to = rises ? rising : falling;
          let at = rises ? risingCount : fallingCount;
          segment(to, at++, center, yh, center, yl);
          segment(to, at++, left, yo, center, yo);
          segment(to, at++, center, yc, right, yc);
          if (rises) risingCount = at;
          else fallingCount = at;
          return;
        }
        const top = Math.min(yo, yc);
        const bottom = Math.max(yo, yc);
        if (c >= o) {
          // A hollow body: its four sides, and wicks above and below it to
          // the high and the low, whichever way the axis runs.
          segment(rising, risingCount++, left, top, right, top);
          segment(rising, risingCount++, left, bottom, right, bottom);
          segment(rising, risingCount++, left, top, left, bottom);
          segment(rising, risingCount++, right, top, right, bottom);
          segment(rising, risingCount++, center, Math.min(yh, yl, top), center, top);
          segment(rising, risingCount++, center, bottom, center, Math.max(yh, yl, bottom));
        } else {
          segment(falling, fallingCount++, center, yh, center, yl);
          const at = bodyCount++ * 4;
          bodies![at] = left;
          bodies![at + 1] = top;
          bodies![at + 2] = width;
          // A candle that barely moves still shows as a line.
          bodies![at + 3] = Math.max(1, bottom - top);
        }
      };
      if (merged) {
        this.#merge(s, start, end, frame, log, columns, draw);
      } else {
        for (let k = start; k < end; k++) {
          const row = rowOf(s, k);
          const at = s.x[row]!;
          if ((this.categorical && at < 0) || breaks?.hides(at)) continue;
          const center = x.map(places ? places.at(at) : at);
          if (!reaches(center) || !candleOf(prices, row, log, candle)) continue;
          draw(center, width, candle[0]!, candle[1]!, candle[2]!, candle[3]!);
        }
      }
      // Bars wide enough to read a heavier line get one.
      const strokeWidth = ohlc && !merged && width >= 8 ? 2 : 1;
      out.push(
        {
          kind: "segments",
          draw: segmentDrawing,
          key: `${s.key}|rise`,
          stroke: rise,
          strokeWidth,
          coords: rising,
          count: risingCount,
        },
        {
          kind: "segments",
          draw: segmentDrawing,
          key: `${s.key}|fall`,
          stroke: fall,
          strokeWidth,
          coords: falling,
          count: fallingCount,
        },
      );
      if (bodies) {
        out.push({
          kind: "rect",
          draw: rectDrawing,
          key: `${s.key}|body`,
          fill: fall,
          fillOpacity: 1,
          rects: bodies,
          count: bodyCount,
        });
      }
    }
    return out;
  }

  /**
   * Merges the candles in view into one per pixel column of the plot, in any
   * row order: the open of the column's earliest candle and the close of its
   * latest (by x; equal x by row order), and its highest high and lowest low.
   */
  #merge(
    s: Series,
    start: number,
    end: number,
    frame: Frame,
    log: boolean,
    columns: number,
    draw: (center: number, width: number, o: number, h: number, l: number, c: number) => void,
  ): void {
    const { x, plot } = frame;
    const prices = this.prices();
    const candle = this.candle;
    // Places keep the chart's order, so candles compare by their chart bands.
    const places = s.places?.x;
    // Per column: the rows of its first and last candle, and its low and high.
    const first = new Int32Array(columns).fill(-1);
    const last = new Int32Array(columns);
    const lows = new Float64Array(columns);
    const highs = new Float64Array(columns);
    for (let k = start; k < end; k++) {
      const row = rowOf(s, k);
      const at = s.x[row]!;
      if ((this.categorical && at < 0) || x.breaks?.hides(at)) continue;
      const offset = x.map(places ? places.at(at) : at) - plot.x;
      // Only candles centered in the plot; the domain's end maps to its edge.
      if (!(offset >= 0 && offset <= plot.width)) continue;
      if (!candleOf(prices, row, log, candle)) continue;
      const column = Math.min(columns - 1, Math.floor(offset));
      const earliest = first[column]!;
      if (earliest < 0) {
        first[column] = row;
        last[column] = row;
        lows[column] = candle[2]!;
        highs[column] = candle[1]!;
        continue;
      }
      if (at < s.x[earliest]!) first[column] = row;
      if (at >= s.x[last[column]!]!) last[column] = row;
      if (candle[2]! < lows[column]!) lows[column] = candle[2]!;
      if (candle[1]! > highs[column]!) highs[column] = candle[1]!;
    }
    for (let column = 0; column < columns; column++) {
      const row = first[column]!;
      if (row < 0) continue;
      const open = prices.open[row]!;
      const close = prices.close[last[column]!]!;
      const [center, width] = this.column(column, frame);
      draw(center, width, open, highs[column]!, lows[column]!, close);
    }
  }

  /**
   * Its candles are found as drawn, one by one or merged a pixel column at
   * a time (marks/lookups.ts).
   */
  pickItem(drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
    return query.lookups.candlestick(this, drawn, query, PICKING);
  }

  /** Where a pixel column's merged candle is drawn: its center, and its width (the last column may be a fraction of a pixel wide). */
  column(column: number, { plot }: Frame): readonly [number, number] {
    const left = plot.x + column;
    const right = Math.min(left + 1, plot.x + plot.width);
    return [(left + right) / 2, FILL * (right - left)];
  }

  /** How wide candles drawn one by one are. */
  width({ x }: Frame): number {
    return this.categorical ? Math.abs(x.bandwidth ?? 0) : this.#slots!.width(x);
  }

  /** What a candle of prices `candle` (open, high, low, close) paints, merged or not. */
  candleBox(
    center: number,
    width: number,
    candle: ArrayLike<number>,
    merged: boolean,
    { y }: Frame,
  ): Rect {
    const ohlc = this.spec.variant === "ohlc";
    // As geometry draws: bars wide enough to read a heavier line get one.
    const stroke = ohlc && !merged && width >= 8 ? 2 : 1;
    const pixels = Array.from(candle, (price) => y.map(price));
    return candleBox(center, width, pixels, candle[3]! >= candle[0]!, ohlc, stroke);
  }

  /** The candle under a pixel, else the nearest; of candles tying with it, the one on top (see `Nearest`). */
  pick(series: readonly Series[], px: number, py: number, frame: Frame): Hit | undefined {
    return settle((found) => this.nearby(series, px, py, frame, found));
  }

  /**
   * Hands `found` each candle within its limit of a pixel, highlighted
   * candles marked: measured to the box from its low to its high, as wide
   * as its body, so that the pointer anywhere on a candle finds it. Sorted
   * positions are searched outward from the pointer until positions alone
   * are farther than the limit.
   */
  nearby(series: readonly Series[], px: number, py: number, frame: Frame, found: Nearest): void {
    const { x, y } = frame;
    const prices = this.prices();
    const log = y.type === "log";
    const candle = this.candle;
    const half = (this.categorical ? Math.abs(x.bandwidth ?? 0) : this.#slots!.width(x)) / 2;
    const lit = frame.highlighted?.(this.table);
    for (const s of series) {
      const places = s.places?.x;
      /** Considers position k; returns how far from the pointer its candle's edge stands along x. */
      const consider = (k: number): number => {
        const row = rowOf(s, k);
        const at = s.x[row]!;
        if ((this.categorical && at < 0) || x.breaks?.hides(at)) return 0;
        const off = Math.max(0, Math.abs(x.map(places ? places.at(at) : at) - px) - half);
        if (!Number.isFinite(off) || !candleOf(prices, row, log, candle)) return 0;
        const [high, low] = [y.map(candle[1]!), y.map(candle[2]!)];
        const distance = Math.hypot(
          off,
          Math.max(0, Math.min(high, low) - py, py - Math.max(high, low)),
        );
        found.take({ series: s, position: k, distance }, this, lit?.[row]);
        return off;
      };
      if (!s.sorted || this.categorical) {
        for (let k = 0; k < s.length; k++) consider(k);
        continue;
      }
      const after = lowerPosition(s, x.invert(px));
      for (let k = after - 1; k >= 0 && consider(k) <= found.limit; k--);
      for (let k = after; k < s.length && consider(k) <= found.limit; k++);
    }
  }

  /** Whether a row draws a candle: inspection skips rows that do not. */
  shows(_series: Series, row: number, y: PositionScale): boolean {
    return candleOf(this.prices(), row, y.type === "log", this.candle);
  }

  /** The candle's four prices, high and low widened as drawn. */
  pointText(_series: Series, row: number, format: AxisFormat): string {
    const candle = this.candle;
    if (!candleOf(this.prices(), row, false, candle)) return "";
    const [open, high, low, close] = Array.from(candle, format.y);
    return `open ${open}, high ${high}, low ${low}, close ${close}`;
  }

  /** Candles, their price range, and the latest candle, over a series' parts in every panel. */
  summarize(parts: readonly Series[], name: string, { format, log }: SummaryContext): string {
    const prices = this.prices();
    const candle = this.candle;
    let count = 0;
    let low = Infinity;
    let high = -Infinity;
    // The latest candle by x, then by the mark's order (a view's), as merged
    // columns take their close; on category axes, by that order alone.
    const rank = this.rows().rank ?? ((row: number) => row);
    let latest = -1;
    let latestAt = Number.NEGATIVE_INFINITY;
    for (const part of parts) {
      for (let k = 0; k < part.length; k++) {
        const row = rowOf(part, k);
        const position = part.x[row]!;
        // As drawn: a placed x (a band on category axes) and a valid candle.
        if (this.categorical ? position < 0 : !Number.isFinite(position)) continue;
        if (!candleOf(prices, row, log, candle)) continue;
        count++;
        low = Math.min(low, candle[2]!);
        high = Math.max(high, candle[1]!);
        const at = this.categorical ? rank(row) : part.x[row]!;
        if (at > latestAt || (at === latestAt && rank(row) > rank(latest))) {
          latest = row;
          latestAt = at;
        }
      }
    }
    const bars = this.spec.variant === "ohlc";
    const noun = (n: number) =>
      bars ? (n === 1 ? "OHLC bar" : "OHLC bars") : n === 1 ? "candle" : "candles";
    if (count === 0 || latest < 0) return `${name}: no ${noun(0)}`;
    const f = format.y;
    candleOf(prices, latest, log, candle);
    const [o, h, l, c] = candle;
    return `${name}: ${count} ${noun(count)}, prices from ${f(low)} to ${f(high)}; the last opened at ${f(o!)}, ranged from ${f(l!)} to ${f(h!)}, and closed at ${f(c!)}`;
  }

  prices(): Prices {
    const { table, spec } = this;
    const read = (field: string) => table.numbers(field as never);
    return {
      open: read(spec.open),
      high: read(spec.high),
      low: read(spec.low),
      close: read(spec.close),
    };
  }
}

/**
 * Open-high-low-close candles at each `x`, as for prices.
 *
 * ```ts
 * candlestick(prices, { x: "day", open: "open", high: "high", low: "low", close: "close" })
 * ```
 */
export function candlestick<S extends Schema>(
  data: Table<S> | RowView<S>,
  options: CandlestickOptions<S>,
): ChartMark<Frozen<CandlestickSpec>> {
  const view = isRowView(data) ? data : undefined;
  const table = view ? view.source : (data as Table<S>);
  refuseColor(options, "candlestick");
  const spec: CandlestickSpec = {
    type: "candlestick",
    x: options.x,
    open: options.open,
    high: options.high,
    low: options.low,
    close: options.close,
    ...definedFields(options, [
      "tooltip",
      "variant",
      "rise",
      "fall",
      "label",
      "legend",
      "axis",
      "facet",
      "panel",
      "clip",
      "zIndex",
      "pick",
      "inspect",
      "id",
      "itemKey",
    ]),
  };
  if (table.name !== undefined) spec.data = table.name;
  // Field names were checked against S above; marks work on the erased schema.
  return new CandlestickMark(spec, table as unknown as Table, view as RowView | undefined);
}

/**
 * What a candle paints, `width` wide about its center, from its open,
 * high, low, and close pixels, as `geometry` draws it: an OHLC bar's line
 * and ticks `stroke` wide, a hollow body's sides and wicks, or a filled
 * body and its wick.
 */
function candleBox(
  center: number,
  width: number,
  [o, h, l, c]: readonly number[],
  rises: boolean,
  ohlc: boolean,
  stroke: number,
): Rect {
  const half = stroke / 2;
  // As wide as the body or ticks, or the wick's stroke where that is wider
  // (a hollow body's side strokes reach past both).
  const wide = rises && !ohlc ? width : Math.max(width, stroke);
  const [left, right] = [center - wide / 2, center + wide / 2];
  // The wick's ends in pixel order, whichever way the axis runs.
  const [above, below] = [Math.min(h!, l!), Math.max(h!, l!)];
  if (ohlc)
    return boxOf(
      left,
      Math.min(above, o! - half, c! - half),
      right,
      Math.max(below, o! + half, c! + half),
    );
  const top = Math.min(o!, c!);
  const bottom = Math.max(o!, c!);
  // A hollow body's sides are strokes; a filled one is at least a pixel tall, down from its top.
  return rises
    ? boxOf(left - half, Math.min(above, top - half), right + half, Math.max(below, bottom + half))
    : boxOf(left, Math.min(above, top), right, Math.max(below, top + Math.max(1, bottom - top)));
}

/** Candles merged into one pixel column: their positions, lowest low, and highest high. */
export interface Merged {
  positions: number[];
  low: number;
  high: number;
}

/** What its lookup reads of this module (see marks/lookups.ts). */
const PICKING = { candleOf, visibleRange };
export type CandlePicking = typeof PICKING;
