import type { NumericArray } from "../data/column.ts";
import type { NumericField, PositionField, Schema, Table } from "../data/table.ts";
import { rectDrawing } from "../draw/rect.ts";
import { segmentDrawing } from "../draw/segments.ts";
import type { Breaks } from "../lod/m4.ts";
import { type Nearest, settle } from "../model/nearest.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { Geometry, Rect, RectGeometry, SegmentGeometry } from "../scene/scene.ts";
import type { CandlestickSpec, Clip, Frozen } from "../spec/spec.ts";
import { refuseColor } from "./colored.ts";
import {
  boxOf,
  clipBox,
  cut,
  type DrawnMark,
  distanceToCut,
  type PickedItem,
  type PickQuery,
  paintedLater,
  pickedHit,
} from "./drawn.ts";
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
import { type MarkRows, rowsOf } from "./rows.ts";
import { lowerPosition, rowOf, type Series, visibleRange, xExtent } from "./series.ts";
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
  readonly tooltip = "x";
  /** Its one series, named by its label, though it stands for no field. */
  readonly legendScales = ["series"] as const;
  readonly #categorical: boolean;
  readonly #split: SeriesSplitter;
  readonly #slots: Slots | undefined;
  /** Scratch for one candle's prices. */
  readonly #candle = new Float64Array(4);

  constructor(input: CandlestickSpec, table: Table<Schema>) {
    this.spec = frozen(input);
    checkTooltip(table, this.spec.tooltip, "candlestick");
    checkItemKey(table, this.spec.itemKey, "candlestick");
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.table = table;
    requireField(table, spec.x, [...NUMERIC, ...CATEGORY], "candlestick x");
    for (const name of ["open", "high", "low", "close"] as const)
      requireField(table, spec[name], NUMERIC, `candlestick ${name}`);
    this.#categorical = table.kind(spec.x) === "category";
    this.#slots = this.#categorical ? undefined : new Slots(() => this.rows(), spec.x);
    this.#split = new SeriesSplitter(
      () => this.rows(),
      this.#categorical ? undefined : spec.x,
      [spec.close],
      undefined,
      spec.label ?? spec.close,
    );
  }

  #rows: MarkRows | undefined;

  /** What the mark reads of its table now (see marks/rows.ts). */
  rows(): MarkRows {
    this.#rows = rowsOf(this.table, this.#rows);
    return this.#rows;
  }

  channelKind(axis: "x" | "y") {
    const { spec, table } = this;
    if (axis === "x") return table.kind(spec.x);
    return valueKind(table, [spec.open, spec.high, spec.low, spec.close]);
  }

  bands(axis: "x" | "y", context: BandContext): BandList | undefined {
    return axis === "x" && this.#categorical
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
    const positions = this.#categorical
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
    const prices = this.#prices();
    const candle = this.#candle;
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    let min = Infinity;
    let max = -Infinity;
    for (const s of series) {
      const [start, end] = this.#categorical ? [0, s.length] : visibleRange(s, lo, hi);
      for (let k = start; k < end; k++) {
        const row = rowOf(s, k);
        const at = s.x[row]!;
        if (this.#categorical ? at < 0 : !(at >= lo && at <= hi)) continue;
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
      const [start, end] = this.#categorical
        ? [0, s.length]
        : visibleRange(s, x.domain[0], x.domain[1]);
      let count = 0;
      for (let k = start; k < end; k++) count += selected[rowOf(s, k)] === lit ? 1 : 0;
      const rows = new Uint32Array(count);
      for (let k = start, i = 0; k < end; k++)
        if (selected[rowOf(s, k)] === lit) rows[i++] = rowOf(s, k);
      return { ...s, rows, length: count, stream: undefined };
    };
    const merged = series.filter((s) => this.#inView(s, frame, columns) > columns);
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
  #inView(s: Series, frame: Frame, most: number): number {
    const { x, plot } = frame;
    const prices = this.#prices();
    const log = frame.y.type === "log";
    const candle = this.#candle;
    const breaks = x.breaks;
    const [start, end] = this.#categorical
      ? [0, s.length]
      : visibleRange(s, x.domain[0], x.domain[1]);
    const width = this.#categorical ? Math.abs(x.bandwidth ?? 0) : this.#slots!.width(x);
    const places = s.places?.x;
    let count = 0;
    for (let k = start; k < end && count <= most; k++) {
      const row = rowOf(s, k);
      const at = s.x[row]!;
      if ((this.#categorical && at < 0) || breaks?.hides(at)) continue;
      const center = x.map(places ? places.at(at) : at);
      const reaches = center >= plot.x - width / 2 && center <= plot.x + plot.width + width / 2;
      if (reaches && candleOf(prices, row, log, candle)) count++;
    }
    return count;
  }

  geometry(series: readonly Series[], frame: Frame): (SegmentGeometry | RectGeometry)[] {
    const out: (SegmentGeometry | RectGeometry)[] = [];
    const { x, y, plot } = frame;
    const prices = this.#prices();
    const log = y.type === "log";
    const rise = painted(frame.paint, this.spec.rise, "candlestick rise") ?? frame.theme.rise;
    const fall = painted(frame.paint, this.spec.fall, "candlestick fall") ?? frame.theme.fall;
    const candle = this.#candle;
    const ohlc = this.spec.variant === "ohlc";
    // Candles at times an axis break leaves out are not drawn.
    const breaks = x.breaks;
    for (const s of series) {
      if (frame.hidden.has(s.key)) continue;
      const [start, end] = this.#categorical
        ? [0, s.length]
        : visibleRange(s, x.domain[0], x.domain[1]);
      const width = this.#categorical ? Math.abs(x.bandwidth ?? 0) : this.#slots!.width(x);
      // On a panel's own categories, chart bands are read through their places (see placeAt).
      const places = s.places?.x;
      // Candles whose body reaches the plot.
      const reaches = (center: number) =>
        center >= plot.x - width / 2 && center <= plot.x + plot.width + width / 2;
      // Candles merge when there are more of them than pixel columns; either
      // way there are at most as many as columns, so buffers stay bounded.
      // Some of a series' rows (a selection's) merge as the series does.
      const columns = Math.max(1, Math.ceil(plot.width));
      const count = this.#inView(s, frame, columns);
      const merged = (s.whole ? this.#inView(s.whole, frame, columns) : count) > columns;
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
          if ((this.#categorical && at < 0) || breaks?.hides(at)) continue;
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
    const prices = this.#prices();
    const candle = this.#candle;
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
      if ((this.#categorical && at < 0) || x.breaks?.hides(at)) continue;
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
      const [center, width] = this.#column(column, frame);
      draw(center, width, open, highs[column]!, lows[column]!, close);
    }
  }

  /**
   * Its candles are found as drawn: by `pick`, as tooltips find them,
   * bounded from low to high and as wide as their bodies; where a series'
   * candles merge into one per pixel column, by the merged candles (with a
   * selection highlighted, the selected rows' own over the column's), each
   * naming its candle nearest the pointer's value.
   */
  pickItem(drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
    // Read once a pick: counting the candles in view reads every one.
    const merged = new Map<Series, boolean>();
    const merges = (s: Series, frame: Frame) => {
      let merging = merged.get(s);
      if (merging === undefined) {
        const columns = Math.max(1, Math.ceil(frame.plot.width));
        merging = this.#inView(s.whole ?? s, frame, columns) > columns;
        merged.set(s, merging);
      }
      return merging;
    };
    return pickedHit(this, drawn, query, {
      lookup: (series, px, py, frame) => {
        const lit = frame.highlighted?.(this.table);
        // Paint order: a highlight's selected candles over the others, then later series.
        const order = ({ series: s, position }: Hit, selected = lit?.[rowOf(s, position)] ?? 0) => [
          selected,
          series.indexOf(s),
        ];
        const box = clipBox(this.spec.clip, frame);
        let best = this.#pickSingle(
          series.filter((s) => !merges(s, frame)),
          px,
          py,
          frame,
          box,
          lit,
          query.slop,
        );
        let bestOrder = best ? order(best) : [];
        for (const s of series) {
          const found =
            merges(s, frame) && this.#pickMerged(s, px, py, frame, query.slop, lit, box);
          if (!found) continue;
          const at = order(found.hit, found.selected);
          const { distance } = found.hit;
          const nearest = best?.distance ?? Number.POSITIVE_INFINITY;
          if (distance < nearest || (distance === nearest && paintedLater(at, bestOrder)))
            [best, bestOrder] = [found.hit, at];
        }
        return best;
      },
      bounds: (s, position, frame) => {
        const { x, y } = frame;
        const row = rowOf(s, position);
        const at = s.x[row]!;
        const center = x.map(s.places?.x ? s.places.x.at(at) : at);
        if (merges(s, frame)) {
          const column = this.#columnOf(center, frame);
          const lit = frame.highlighted?.(this.table);
          const [merged] = this.#columns(s, frame, column, column, lit);
          // A selected row is drawn in the selected rows' own candle.
          const part = lit?.[row] === 1 ? merged?.selected : merged;
          return (
            part &&
            cut(
              this.#mergedBox(column, this.#merged(s, part), frame),
              clipBox(this.spec.clip, frame),
            )
          );
        }
        const candle = this.#candle;
        if (!candleOf(this.#prices(), row, y.type === "log", candle)) return undefined;
        const drawn = this.#candleBox(center, this.#width(frame), candle, false, frame);
        return cut(drawn, clipBox(this.spec.clip, frame));
      },
    });
  }

  /**
   * For picking: the candle nearest a pixel of those geometry draws one by
   * one (positions in view and beside it, whose bodies reach the plot),
   * measured to what it paints inside `box`; of candles as near, the one
   * painted last (with `lit`, a highlight's selected rows over the others,
   * as `Nearest` ranks them; then by series, then falling candles over
   * rising ones, as geometry paints them).
   */
  #pickSingle(
    series: readonly Series[],
    px: number,
    py: number,
    frame: Frame,
    box: Readonly<Rect>,
    lit: Uint8Array | undefined,
    reach: number,
  ): Hit | undefined {
    const { x, y, plot } = frame;
    const prices = this.#prices();
    const log = y.type === "log";
    const candle = this.#candle;
    const width = this.#width(frame);
    const half = width / 2;
    // How far a candle's center can be from a pixel its box (wick and strokes too) reaches.
    const far = reach + half + 2;
    let best: Hit | undefined;
    let bestAt: number[] = [];
    series.forEach((s, i) => {
      const places = s.places?.x;
      // Those geometry draws (the view's, and a neighbor beside it each side)...
      let [start, end] = this.#categorical
        ? [0, s.length]
        : visibleRange(s, x.domain[0], x.domain[1]);
      // ...where the scale alone places x, centered near the pixel.
      if (!this.#categorical && !places && !x.breaks) {
        const [from, to] = visibleRange(s, x.invert(px - far), x.invert(px + far));
        [start, end] = [Math.max(start, from), Math.min(end, to)];
      }
      for (let k = start; k < end; k++) {
        const row = rowOf(s, k);
        const at = s.x[row]!;
        if ((this.#categorical && at < 0) || x.breaks?.hides(at)) continue;
        const center = x.map(places ? places.at(at) : at);
        if (!(center >= plot.x - half && center <= plot.x + plot.width + half)) continue;
        if (!candleOf(prices, row, log, candle)) continue;
        const drawn = this.#candleBox(center, width, candle, false, frame);
        const distance = distanceToCut(drawn, box, px, py);
        const order = [lit?.[row] ?? 0, i, this.#batch(candle, center, width, px, py, y), k];
        const nearest = best?.distance ?? Number.POSITIVE_INFINITY;
        if (distance < nearest || (distance === nearest && paintedLater(order, bestAt)))
          [best, bestAt] = [{ series: s, position: k, distance }, order];
      }
    });
    return best;
  }

  /**
   * The merged candle nearest a pixel, within `reach` of it, of the columns
   * near it: with `lit`, a highlight's selected rows, their own candle over
   * the column's (see `selectedGeometry`), whose candles it names among
   * the selected rows, the column's among the others.
   */
  #pickMerged(
    s: Series,
    px: number,
    py: number,
    frame: Frame,
    reach: number,
    lit: Uint8Array | undefined,
    clip: Readonly<Rect>,
  ): { hit: Hit; selected: number } | undefined {
    const { plot, y } = frame;
    const log = y.type === "log";
    const prices = this.#prices();
    const candle = this.#candle;
    let best: { hit: Hit; selected: number } | undefined;
    // Paint order: a highlight's selected rows' candles over the columns', falling over rising, then by column.
    let bestAt: number[] = [];
    const from = Math.max(0, Math.floor(px - plot.x - reach - 1));
    const to = Math.min(Math.ceil(plot.width) - 1, Math.floor(px - plot.x + reach + 1));
    const near = this.#columns(s, frame, from, to, lit);
    for (let column = from; column <= to; column++) {
      const merged = near[column - from];
      for (const selected of lit ? [0, 1] : [0]) {
        const part = selected ? merged?.selected : merged;
        if (!part) continue;
        const drawn = this.#merged(s, part);
        const distance = distanceToCut(this.#mergedBox(column, drawn, frame), clip, px, py);
        if (distance === Number.POSITIVE_INFINITY) continue;
        const [center, width] = this.#column(column, frame);
        const at = [selected, this.#batch(drawn, center, width, px, py, y), column];
        if (
          best &&
          (distance > best.hit.distance ||
            (distance === best.hit.distance && !paintedLater(at, bestAt)))
        )
          continue;
        // Its candle whose range of prices is nearest the pointer.
        let position = -1;
        let gap = Number.POSITIVE_INFINITY;
        for (const k of part.positions) {
          const row = rowOf(s, k);
          if ((lit?.[row] ?? 0) !== selected || !candleOf(prices, row, log, candle)) continue;
          const [high, low] = [y.map(candle[1]!), y.map(candle[2]!)];
          const off = Math.max(0, Math.min(high, low) - py, py - Math.max(high, low));
          if (off <= gap) [position, gap] = [k, off];
        }
        if (position >= 0)
          [best, bestAt] = [{ hit: { series: s, position, distance }, selected }, at];
      }
    }
    return best;
  }

  /** The pixel column of the plot a candle centered at `center` merges into. */
  #columnOf(center: number, { plot }: Frame): number {
    return Math.min(Math.ceil(plot.width) - 1, Math.floor(center - plot.x));
  }

  /**
   * The candles of `s` merged into each pixel column from `from` to `to`
   * (see `#merge`), read in one pass: their positions, lowest low, and
   * highest high, and with `lit`, the lowest and highest of the rows it
   * holds (`selected`); undefined for a column without any.
   */
  #columns(
    s: Series,
    frame: Frame,
    from: number,
    to: number,
    lit?: Uint8Array,
  ): ((Merged & { selected?: Merged }) | undefined)[] {
    const { x, plot } = frame;
    const prices = this.#prices();
    const log = frame.y.type === "log";
    const candle = this.#candle;
    const places = s.places?.x;
    const [a, b] = [x.invert(plot.x + from), x.invert(plot.x + to + 1)];
    const [start, end] =
      this.#categorical || !s.sorted
        ? [0, s.length]
        : visibleRange(s, Math.min(a, b), Math.max(a, b));
    const out: ((Merged & { selected?: Merged }) | undefined)[] = [];
    for (let k = start; k < end; k++) {
      const row = rowOf(s, k);
      const at = s.x[row]!;
      if ((this.#categorical && at < 0) || x.breaks?.hides(at)) continue;
      const center = x.map(places ? places.at(at) : at);
      if (!(center >= plot.x && center <= plot.x + plot.width)) continue;
      const column = this.#columnOf(center, frame);
      if (column < from || column > to || !candleOf(prices, row, log, candle)) continue;
      out[column - from] ??= { positions: [], low: Infinity, high: -Infinity };
      const merged = out[column - from]!;
      const parts = [merged];
      if (lit?.[row] === 1) {
        merged.selected ??= { positions: [], low: Infinity, high: -Infinity };
        parts.push(merged.selected);
      }
      for (const part of parts) {
        part.positions.push(k);
        part.low = Math.min(part.low, candle[2]!);
        part.high = Math.max(part.high, candle[1]!);
      }
    }
    return out;
  }

  /**
   * What a merged candle paints, as `#merge` draws it: from its earliest
   * candle's open to its latest's close, between its low and high.
   */
  #mergedBox(column: number, candle: readonly number[], frame: Frame) {
    const [center, width] = this.#column(column, frame);
    return this.#candleBox(center, width, candle, true, frame);
  }

  /** Where a pixel column's merged candle is drawn: its center, and its width (the last column may be a fraction of a pixel wide). */
  #column(column: number, { plot }: Frame): readonly [number, number] {
    const left = plot.x + column;
    const right = Math.min(left + 1, plot.x + plot.width);
    return [(left + right) / 2, FILL * (right - left)];
  }

  /** A column's merged candle: the open of its earliest candle, their extremes, and the close of its latest. */
  #merged(s: Series, { positions, low, high }: Merged): number[] {
    let [first, last] = [rowOf(s, positions[0]!), rowOf(s, positions[0]!)];
    for (const k of positions) {
      const row = rowOf(s, k);
      if (s.x[row]! < s.x[first]!) first = row;
      if (s.x[row]! >= s.x[last]!) last = row;
    }
    const prices = this.#prices();
    return [prices.open[first]!, high, low, prices.close[last]!];
  }

  /**
   * Which of a series' batches paints the part of a candle (prices
   * `candle`, `width` wide about `center`) at a pixel, as geometry paints
   * them: rising candles, then falling wicks (or bars), then falling
   * bodies over every wick.
   */
  #batch(
    candle: ArrayLike<number>,
    center: number,
    width: number,
    px: number,
    py: number,
    y: PositionScale,
  ): number {
    if (candle[3]! >= candle[0]!) return 0;
    if (this.spec.variant === "ohlc") return 1;
    const [open, close] = [y.map(candle[0]!), y.map(candle[3]!)];
    const top = Math.min(open, close);
    // A body at least a pixel tall, down from its top.
    const body =
      Math.abs(px - center) <= width / 2 &&
      py >= top &&
      py <= top + Math.max(1, Math.abs(close - open));
    return body ? 2 : 1;
  }

  /** How wide candles drawn one by one are. */
  #width({ x }: Frame): number {
    return this.#categorical ? Math.abs(x.bandwidth ?? 0) : this.#slots!.width(x);
  }

  /** What a candle of prices `candle` (open, high, low, close) paints, merged or not. */
  #candleBox(
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
    const prices = this.#prices();
    const log = y.type === "log";
    const candle = this.#candle;
    const half = (this.#categorical ? Math.abs(x.bandwidth ?? 0) : this.#slots!.width(x)) / 2;
    const lit = frame.highlighted?.(this.table);
    for (const s of series) {
      const places = s.places?.x;
      /** Considers position k; returns how far from the pointer its candle's edge stands along x. */
      const consider = (k: number): number => {
        const row = rowOf(s, k);
        const at = s.x[row]!;
        if ((this.#categorical && at < 0) || x.breaks?.hides(at)) return 0;
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
      if (!s.sorted || this.#categorical) {
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
    return candleOf(this.#prices(), row, y.type === "log", this.#candle);
  }

  /** The candle's four prices, high and low widened as drawn. */
  pointText(_series: Series, row: number, format: AxisFormat): string {
    const candle = this.#candle;
    if (!candleOf(this.#prices(), row, false, candle)) return "";
    const [open, high, low, close] = Array.from(candle, format.y);
    return `open ${open}, high ${high}, low ${low}, close ${close}`;
  }

  /** Candles, their price range, and the latest candle, over a series' parts in every panel. */
  summarize(parts: readonly Series[], name: string, { format, log }: SummaryContext): string {
    const prices = this.#prices();
    const candle = this.#candle;
    let count = 0;
    let low = Infinity;
    let high = -Infinity;
    // The latest candle by x, then by row, as merged columns take their close.
    let latest = -1;
    let latestAt = Number.NEGATIVE_INFINITY;
    for (const part of parts) {
      for (let k = 0; k < part.length; k++) {
        const row = rowOf(part, k);
        const position = part.x[row]!;
        // As drawn: a placed x (a band on category axes) and a valid candle.
        if (this.#categorical ? position < 0 : !Number.isFinite(position)) continue;
        if (!candleOf(prices, row, log, candle)) continue;
        count++;
        low = Math.min(low, candle[2]!);
        high = Math.max(high, candle[1]!);
        const at = this.#categorical ? row : part.x[row]!;
        if (at > latestAt || (at === latestAt && row > latest)) {
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

  #prices(): Prices {
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
  table: Table<S>,
  options: CandlestickOptions<S>,
): ChartMark<Frozen<CandlestickSpec>> {
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
      "id",
      "itemKey",
    ]),
  };
  if (table.name !== undefined) spec.data = table.name;
  // Field names were checked against S above; marks work on the erased schema.
  return new CandlestickMark(spec, table as unknown as Table);
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
interface Merged {
  positions: number[];
  low: number;
  high: number;
}
