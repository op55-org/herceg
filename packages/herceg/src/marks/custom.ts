import type { Clip, Dash, Frozen, MarkTooltipSpec } from "../spec/spec.ts";
// Custom marks: a JavaScript `draw` function places shapes using the chart's
// scales. They share axes, viewport, and rendering (SVG, Canvas, static SVG)
// with built-in marks, but are not portable: a chart spec cannot hold one.
// Over x and y fields, a custom mark shows series (one per y field of one x
// field, as a line; else one, or one per value of `series`), so the legend,
// colors, tooltips, the keyboard, facets, and summaries reach it through the
// chart's own machinery. Shapes `draw` makes inside `item(series, row, ...)`
// are that row's item: picked by their shapes (custom-shapes.ts), and
// dimmed while a selection leaves them out. Glyphs over several fields of a
// row (ranges) are inspected by their items' shapes, under the pointer.

import type { RowView } from "../data/row-view.ts";
import type { CategoryField, NumericField, PositionField, Schema, Table } from "../data/table.ts";
import { n } from "../draw/markup.ts";
import { shapesDrawing } from "../draw/shapes.ts";
import type { PathShape, PlotRect, Rect, ShapesGeometry, TextShape } from "../scene/scene.ts";
import type { ChannelSpec, RowChannelSpec } from "../spec/encoding.ts";
import { dashPattern } from "../style/style.ts";
import type { Theme } from "../theme.ts";
import { ShapeIndex } from "./custom-shapes.ts";
import type { DrawnMark, DrawnPart, PartBuilders, PickedItem, PickQuery } from "./drawn.ts";
import type { Channel, ItemKeyed, RowChannel } from "./encoding.ts";
import { definedFields } from "./line.ts";
import { clipBox } from "./lookups.ts";
import {
  type AxisFormat,
  type BandContext,
  type Bands,
  buildSeries,
  CATEGORY,
  type ChartMark,
  categoryBands,
  categoryIndices,
  checkOptionalItemKey,
  DIM,
  type Frame,
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
  type SummaryContext,
  seriesKey,
  valueKind,
} from "./mark.ts";
import { extentAt, isRowView, type MarkRows, rowAt, rowCount, rowsOf } from "./rows.ts";
import {
  type BandPlaces,
  placeAt,
  rowOf,
  type Series,
  valueAt,
  xExtent,
  yExtent,
} from "./series.ts";
import { refuseValues } from "./still.ts";
import { checkTooltip, type MarkTooltip } from "./tooltip-fields.ts";
import { unionExtent } from "./trace.ts";

/**
 * Style of a shape. Without `fill` or `stroke`, shapes are filled with the
 * theme's text color; undefined takes the default, as for a row `encoded`
 * gives no output.
 */
export interface ShapeStyle {
  fill?: string | undefined;
  stroke?: string | undefined;
  /** Default 1. */
  strokeWidth?: number | undefined;
  /** From 0 to 1. Default 1. */
  opacity?: number | undefined;
  /** Pixel dash array, or a matplotlib style scaled by strokeWidth. */
  dash?: Dash | undefined;
}

export interface TextShapeStyle {
  /** Defaults to the theme's text color. */
  fill?: string;
  /** Which end of the text is at the point. Default "middle". */
  anchor?: "start" | "middle" | "end";
}

/**
 * What a custom mark's `draw` receives: the chart's scales and shape
 * functions. Positions are in CSS pixels; `x` and `y` turn data values into
 * them (times in epoch milliseconds; band indices on category axes, at the
 * band's middle).
 */
export interface DrawContext {
  x(value: number): number;
  y(value: number): number;
  /** The visible data range of each axis. */
  domain: { x: readonly [number, number]; y: readonly [number, number] };
  /** Band width in pixels on category axes; 0 on others. */
  bandwidth: { x: number; y: number };
  /** The area inside the axes; shapes are clipped to it. */
  plot: PlotRect;
  theme: Theme;
  /** A path in SVG path syntax, such as "M0 0L10 10". */
  path(d: string, style?: ShapeStyle): void;
  rect(x: number, y: number, width: number, height: number, style?: ShapeStyle): void;
  circle(cx: number, cy: number, r: number, style?: ShapeStyle): void;
  line(x1: number, y1: number, x2: number, y2: number, style?: ShapeStyle): void;
  /** Text vertically centered on `y`. */
  text(x: number, y: number, text: string, style?: TextShapeStyle): void;
}

/**
 * A series a custom mark shows: one y field, or one value of the `series`
 * field. Its points are rows of the mark's table.
 */
export interface CustomSeries {
  /** Identifies the series in the chart, as in legend state and events. */
  readonly key: string;
  /** Its name in the legend and tooltips. */
  readonly label: string;
  /** The color of its legend entry and tooltip swatch. */
  readonly color: string;
  /**
   * Each row's place on x and y, indexed by row: its first x and first y
   * field's values (on category axes, its band's place on the panel's axis).
   */
  readonly x: ArrayLike<number>;
  readonly y: ArrayLike<number>;
  /** The rows it holds, in table order; undefined when it holds every row. */
  readonly rows: ArrayLike<number> | undefined;
  /** How many rows it holds. */
  readonly length: number;
  /**
   * The row of its point at `position`, from 0 to `length - 1`: what `x`,
   * `y`, and the table's columns are indexed by.
   */
  rowAt(position: number): number;
}

/** The channels a custom mark's `encode` gives `draw` (see `DataDrawContext.encoded`). */
export type CustomChannel = "color" | "strokeWidth" | "opacity";

/** The draw context of a custom mark over a table. */
export interface DataDrawContext<S extends Schema> extends DrawContext {
  table: Table<S>;
  /**
   * The series to draw: those the legend has not hidden, each holding only
   * this panel's rows in charts with facets. Empty for marks without series.
   */
  series: readonly CustomSeries[];
  /**
   * Draws the item of row `row` of series `series`: the shapes `draw`
   * makes are that item's, which the pointer picks by their shapes (inside
   * a fill, on a stroke), tooltips and the keyboard read, selections dim,
   * and events name (by `itemKey`). Calls may repeat for one item (its
   * tails, then its heads over every other's); they do not nest.
   */
  item(series: CustomSeries, row: number, draw: () => void): void;
  /**
   * A channel's output for row `row` (`encode`): its color, width, or
   * opacity, through the scale the channel names; undefined where the row
   * has none (a missing value) or the mark has no such channel. A color
   * naming the series (`{ series: true }`) is the series' `color`.
   */
  encoded(channel: "color", row: number): string | undefined;
  encoded(channel: "strokeWidth" | "opacity", row: number): number | undefined;
  /**
   * Whether row `row`'s item of `series` is selected, unselected (another
   * is), or neither (no selection), for looks of the selected's own: shapes
   * of unselected items are dimmed as other marks' are.
   */
  selection(series: CustomSeries, row: number): "selected" | "unselected" | undefined;
}

interface CustomBase {
  /** A sentence for the chart's text alternative, saying what the mark shows. */
  description?: string;
  /** The y axis `y` maps to: "left" (default) or "right", the chart's `yRight`. */
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
  /**
   * The axis the mark's shapes are drawn from zero along, such as
   * lollipops' stems ("y") or horizontal ones' ("x"): its domain includes
   * zero, as for bars, unless the axis says otherwise (`zero: false`).
   */
  zero?: "x" | "y";
  id?: string;
  /** `false` leaves the mark's series out of the legend; they still draw. */
  legend?: false;
}

/** A custom mark that only uses the scales other marks set. */
export interface CustomOptions extends CustomBase {
  draw(context: DrawContext): void;
}

/**
 * A custom mark over a table, whose fields count toward the axis domains.
 * With one `x` field and several `y` fields, each `y` field is a series, as
 * a line's; otherwise the mark shows one series (named by `label`), or one
 * per value of `series`, each row an item spanning its fields.
 */
export interface CustomDataOptions<S extends Schema> extends CustomBase, ItemKeyed<S> {
  /**
   * Fields whose values the mark places along x: a time field gives a time
   * axis, one category field a band axis; several (number or time) fields
   * span a range, such as an interval's start and end.
   */
  x?: PositionField<S> | readonly NumericField<S>[];
  /**
   * Fields whose values the mark places along y (see `x`). With one `x`
   * field and no `series`, several `y` fields are a series each, with a
   * legend entry, tooltips, and keyboard stops at their points.
   */
  y?: PositionField<S> | readonly NumericField<S>[];
  /**
   * Category field: one series per value. `false`: no series; the fields
   * only count toward the axis domains.
   */
  series?: CategoryField<S> | false;
  /** Name of a single series in legends and tooltips. Defaults to the y field. */
  label?: string;
  /**
   * Tooltip text for a row of a series, by default its y value (a range's
   * values, "12.5 – 40"); `format` formats values as the chart's x and y
   * axes and other numbers.
   */
  pointText?(row: number, format: AxisFormat, series: CustomSeries): string;
  /** Fields of the row tooltips show besides the series' values. */
  tooltip?: MarkTooltip<S>;
  /**
   * Channels `draw` reads per row (`encoded`): a color, a stroke width, an
   * opacity, from fields through the chart's scales (a channel scale for
   * numbers), as constants, or by a condition. A color naming the series
   * field colors the series, as a line's does.
   */
  encode?: {
    color?: Channel<string, S>;
    strokeWidth?: RowChannel<number, S>;
    opacity?: RowChannel<number, S>;
  };
  draw(context: DataDrawContext<S>): void;
}

/**
 * A custom mark's spec: its identity and, when it shows series, their
 * fields. `draw` and `pointText` cannot be serialized.
 */
export interface CustomSpec {
  type: "custom";
  id?: string;
  /** The field naming each row's item (see `ItemKeyed`). */
  itemKey?: string;
  axis?: "left" | "right";
  zero?: "x" | "y";
  facet?: "repeat";
  clip?: Clip;
  /** Where it is drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  /** `false`: the pointer passes through the marks: clicks, hover, and context menus pick what is under them. */
  pick?: boolean;
  /** `false`: tooltips, hover, and the keyboard leave the marks out. */
  inspect?: boolean;
  /** With the chart's `panels`, the id of the panel to draw in, or "*" for every panel. */
  panel?: string;
  /** The x fields of the series: one, or a range's. */
  x?: string | string[];
  /** The y field of each series, or a range's fields. */
  y?: string | string[];
  series?: string;
  label?: string;
  tooltip?: MarkTooltipSpec;
  /** The channels `draw` reads per row. */
  encode?: {
    color?: ChannelSpec<string>;
    strokeWidth?: RowChannelSpec<number>;
    opacity?: RowChannelSpec<number>;
  };
  legend?: false;
}

/** How a custom mark's rows make series: as a line's, a series per y field, or a row an item. */
type Layout = "points" | "wide" | "ranges" | undefined;

/** Pixels a series' point reaches when its mark drew no items, which the picker finds it within. */
const POINT_REACH = 3;

/**
 * A series as `draw` and `pointText` see it. On a panel's own bands, its
 * rows hold chart band indices, given as the panel's places (see placeAt)
 * through `placed`.
 */
function customSeries(
  s: Series,
  placed: (values: ArrayLike<number>, places: BandPlaces) => ArrayLike<number>,
): CustomSeries {
  const { key, label, color, rows, length } = s;
  const along = (axis: "x" | "y") => {
    const places = s.places?.[axis];
    return places ? placed(s[axis], places) : s[axis];
  };
  return {
    key,
    label,
    color,
    x: along("x"),
    y: along("y"),
    rows,
    length,
    rowAt: (k) => (rows ? rows[k]! : k),
  };
}

/** [min, max] of a field's finite values at the mark's rows; positive ones on log axes. */
function fieldExtent(
  rows: MarkRows,
  field: string,
  log: boolean,
): readonly [number, number] | undefined {
  if (!log) return extentAt(rows, field);
  const values = rows.table.numbers(field as never);
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < rowCount(rows); k++) {
    const value = values[rowAt(rows, k)]!;
    if (!(value > 0 && value < Infinity)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? [min, max] : undefined;
}

/** [min, max] of fields' finite values over a series' rows; positive ones on log axes. */
function seriesExtent(
  table: Table,
  s: Series,
  fields: readonly string[],
  log: boolean,
): readonly [number, number] | undefined {
  let min = Infinity;
  let max = -Infinity;
  for (const field of fields) {
    const values = table.numbers(field as never);
    for (let k = 0; k < s.length; k++) {
      const value = values[rowOf(s, k)]!;
      if (!(log ? value > 0 && value < Infinity : Number.isFinite(value))) continue;
      if (value < min) min = value;
      if (value > max) max = value;
    }
  }
  return min <= max ? [min, max] : undefined;
}

/**
 * What one geometry of a custom mark drew as items: each `item` call's
 * shapes, its series, and its position there, found by their shapes.
 */
interface DrawnItems {
  readonly series: readonly Series[];
  readonly positions: readonly number[];
  readonly shapes: ShapeIndex;
  /** Each call's first shape, ascending. */
  readonly starts: readonly number[];
  /** The calls drawing each series' position, as asked (see `#callsOf`). */
  calls?: Map<Series, Map<number, number[]>>;
}

/** Items of the shapes geometry that drew them. */
const drawnItems = /* @__PURE__ */ new WeakMap<ShapesGeometry, DrawnItems>();
/** The shapes geometry a plot's last frame drew of a mark, by mark: what inspection reads. */
const byPlot = /* @__PURE__ */ new WeakMap<PlotRect, Map<Mark, ShapesGeometry>>();

export class CustomMark implements Mark<Frozen<CustomSpec>> {
  declare readonly [MARK]: true;
  readonly spec: Frozen<CustomSpec>;
  readonly table: Table | undefined;
  /** The view of `table` whose rows the mark's series hold, when it shows only some (see `rowsOf`). */
  readonly view: RowView | undefined;
  /** Ranges are read by their items' shapes, wherever they are on the axes; others along x. */
  readonly tooltip: "x" | "point";
  readonly zero: "x" | "y" | undefined;
  readonly seriesless: boolean;
  readonly identity: MarkSources | undefined;
  readonly wide: boolean;
  readonly featured: boolean;
  /** For ranges: where an item is (its drawn box's middle), for the keyboard and selections. */
  readonly place?: (
    series: Series,
    row: number,
    frame: Frame,
  ) => readonly [number, number] | undefined;
  /** For ranges: the item under a point, exactly on its shapes, for tooltips. */
  readonly pick?: (
    series: readonly Series[],
    px: number,
    py: number,
    frame: Frame,
  ) => Hit | undefined;
  readonly #x: readonly string[];
  readonly #y: readonly string[];
  readonly #layout: Layout;
  /** The axes a single category field places rows in bands along. */
  readonly #banded: { readonly x: boolean; readonly y: boolean };
  /** Splits the table into series, when the mark shows any. */
  readonly #split: SeriesSplitter | undefined;
  readonly #draw: (context: DataDrawContext<Schema>) => void;
  readonly #pointText: CustomDataOptions<Schema>["pointText"];
  readonly #description: string | undefined;
  /** Columns placed on panels' own bands, by column and places, as of a table version. */
  readonly #placedColumns = new WeakMap<
    ArrayLike<number>,
    WeakMap<BandPlaces, { version: number; values: Float64Array }>
  >();

  constructor(table: Table | undefined, options: CustomDataOptions<Schema>, view?: RowView) {
    const spec: CustomSpec = {
      type: "custom",
      ...definedFields(options, [
        "id",
        "itemKey",
        "axis",
        "zero",
        "facet",
        "panel",
        "clip",
        "zIndex",
        "pick",
        "inspect",
        "legend",
      ]),
    };
    if (options.zero !== undefined && options.zero !== "x" && options.zero !== "y")
      throw new TypeError(
        `custom zero: expected "x" or "y"; received ${JSON.stringify(options.zero)}`,
      );
    this.zero = options.zero;
    this.table = table;
    this.view = view;
    const list = (fields: string | readonly string[] | undefined) =>
      fields === undefined ? [] : typeof fields === "string" ? [fields] : [...fields];
    this.#x = list(options.x);
    this.#y = list(options.y);
    for (const [axis, fields] of [
      ["x", this.#x],
      ["y", this.#y],
    ] as const) {
      if (fields.length > 0 && !table)
        throw new Error(`custom ${axis}: fields need a table; pass one`);
      // A category places rows in bands, alone on its axis.
      for (const field of fields)
        requireField(
          table!,
          field,
          fields.length === 1 ? [...NUMERIC, ...CATEGORY] : NUMERIC,
          `custom ${axis}`,
        );
    }
    this.#banded = {
      x: this.#x.length === 1 && table!.kind(this.#x[0]!) === "category",
      y: this.#y.length === 1 && table!.kind(this.#y[0]!) === "category",
    };
    const field = options.series === false ? undefined : options.series;
    // One x field and y fields are series as a line's (a series per y field
    // without a series field); other fields span each row's item.
    const layout: Layout =
      options.series === false || this.#x.length === 0 || this.#y.length === 0
        ? undefined
        : this.#x.length === 1 && this.#y.length === 1
          ? "points"
          : this.#x.length === 1 && field === undefined
            ? "wide"
            : "ranges";
    this.#layout = layout;
    if (layout) {
      if (field !== undefined) requireField(table!, field, CATEGORY, "custom series");
      const ranged = this.#x.length > 1 ? this.#x : this.#y;
      this.#split = new SeriesSplitter(
        () => this.rows(),
        // Bands place a category's rows; they are not sorted along x.
        this.#banded.x ? undefined : this.#x[0],
        layout === "wide" ? this.#y : [this.#y[0]!],
        field,
        options.label ?? (layout === "ranges" ? ranged.join(" – ") : undefined),
      );
      spec.x = this.#x.length === 1 ? this.#x[0]! : [...this.#x];
      spec.y = typeof options.y === "string" ? options.y : [...this.#y];
      if (field !== undefined) spec.series = field;
      if (options.label !== undefined) spec.label = options.label;
      if (options.tooltip !== undefined) spec.tooltip = options.tooltip as MarkTooltipSpec;
    } else if (
      field !== undefined ||
      options.label !== undefined ||
      options.pointText ||
      options.tooltip
    ) {
      throw new Error(
        "custom: series, label, pointText, and tooltip need x and y fields, and no series: false",
      );
    }
    if (options.encode !== undefined) {
      if (!table)
        throw new Error(
          "custom encode: channels read the rows of a table; pass one, or drop encode",
        );
      spec.encode = options.encode as NonNullable<CustomSpec["encode"]>;
    }
    this.spec = frozen(spec);
    this.featured = options.encode !== undefined;
    this.seriesless = !this.#split;
    this.tooltip = layout === "ranges" ? "point" : "x";
    // Series stand for their field's values, or for their y fields' names, as a line's do.
    this.identity = this.#split
      ? { field, values: layout === "wide" ? this.#y : [this.#y[0]!] }
      : undefined;
    this.wide = layout === "wide" && this.#y.length > 1;
    checkTooltip(table, this.spec.tooltip, "custom");
    checkOptionalItemKey(table, this.spec.itemKey, "custom");
    this.#draw = options.draw;
    this.#pointText = options.pointText;
    this.#description = options.description;
    if (layout === "ranges") {
      this.place = (series, row, frame) => this.#placeOf(series, row, frame);
      this.pick = (series, px, py, frame) => this.#pickAt(series, px, py, frame);
    }
  }

  #rows: MarkRows | undefined;

  /** `values` placed through a panel's own bands, shared by the series and tooltips reading them. */
  #placed = (values: ArrayLike<number>, places: BandPlaces): ArrayLike<number> => {
    const version = this.table!.version;
    let byPlaces = this.#placedColumns.get(values);
    if (!byPlaces) {
      byPlaces = new WeakMap();
      this.#placedColumns.set(values, byPlaces);
    }
    const cached = byPlaces.get(places);
    if (cached?.version === version) return cached.values;
    const placed = Float64Array.from(values, (v) => (v >= 0 ? places.at(v) : v));
    byPlaces.set(places, { version, values: placed });
    return placed;
  };

  /** What the mark reads of its table now (see marks/rows.ts). */
  rows(): MarkRows {
    this.#rows = rowsOf(this.view ?? this.table!, this.#rows);
    return this.#rows;
  }

  channelKind(axis: "x" | "y") {
    const fields = axis === "x" ? this.#x : this.#y;
    if (fields.length === 0) return undefined;
    if (this.#banded[axis]) return "category" as const;
    return valueKind(this.table!, fields);
  }

  bands(axis: "x" | "y") {
    return this.#banded[axis]
      ? categoryBands(this.rows(), (axis === "x" ? this.#x : this.#y)[0]!)
      : undefined;
  }

  series(
    key: MarkKey,
    palette: Palette,
    _hidden?: ReadonlySet<string>,
    bands?: Bands,
    _context?: BandContext,
  ): Series[] {
    if (!this.#split) return [];
    // A category's place is its band's index on the chart's axis.
    const placed = (axis: "x" | "y") =>
      this.#banded[axis]
        ? categoryIndices(
            this.rows(),
            (axis === "x" ? this.#x : this.#y)[0]!,
            bands?.[axis]?.keys ?? [],
          )
        : undefined;
    const x = placed("x") ?? this.table!.numbers(this.#x[0] as never);
    return buildSeries(this.table!, this.#split.sources(), x, key, palette, undefined, placed("y"));
  }

  xExtent(series: readonly Series[], log: boolean): readonly [number, number] | undefined {
    if (this.#banded.x) return undefined;
    // A range counts whole: every field, at the rows of the series shown.
    if (this.#layout === "ranges")
      return unionExtent(series.map((s) => seriesExtent(this.table!, s, this.#x, log)));
    if (this.#split) return unionExtent(series.map((s) => xExtent(s, log)));
    return unionExtent(this.#x.map((field) => fieldExtent(this.rows(), field, log)));
  }

  /**
   * Series fit y to what the x range shows, taking in the points just past
   * its edges: shapes between neighboring points may be steps or glyphs
   * rather than straight segments, and staying between the neighbors'
   * values keeps them in view. Other fields count whole.
   */
  yExtent(series: readonly Series[], x0: number, x1: number, log: boolean) {
    if (this.#banded.y) return undefined;
    if (this.#layout === "ranges")
      return unionExtent(series.map((s) => seriesExtent(this.table!, s, this.#y, log)));
    if (!this.#split)
      return unionExtent(this.#y.map((field) => fieldExtent(this.rows(), field, log)));
    return unionExtent(series.map((s) => yExtent(s, x0, x1, s.y, log, undefined, true)));
  }

  /**
   * Tooltip text for a row: the `pointText` option's, or the series'
   * value; a range's values, each axis' written as it writes them: "12 –
   * 40" along one axis, "(1, 2) – (3, 4)" along both.
   */
  pointText(series: Series, row: number, format: AxisFormat): string {
    if (this.#pointText) return this.#pointText(row, format, customSeries(series, this.#placed));
    if (this.#layout !== "ranges") return format.y(valueAt(series, row));
    const table = this.table!;
    const written = (fields: readonly string[], axis: "x" | "y") =>
      fields.map((field, i) =>
        format[axis](
          this.#banded[axis] && i === 0
            ? placeAt(series, axis, row)
            : table.numbers(field as never)[row]!,
        ),
      );
    const [xs, ys] = [written(this.#x, "x"), written(this.#y, "y")];
    if (xs.length > 1 && ys.length > 1)
      return xs.length === ys.length
        ? xs.map((x, i) => `(${x}, ${ys[i]})`).join(" – ")
        : `x ${xs.join(" – ")}, y ${ys.join(" – ")}`;
    return (xs.length > 1 ? xs : ys).join(" – ");
  }

  /**
   * The text alternative's sentence for ranges, and for points along
   * category y, whose values the chart's sentence would read as band
   * indices: how many rows are placed, in how many categories, and each
   * value axis' extent over its fields. Others take the chart's.
   */
  summarize(parts: readonly Series[], name: string, { format }: SummaryContext) {
    const ranges = this.#layout === "ranges";
    if (!ranges && !this.#banded.y) return undefined;
    const table = this.table!;
    const axes = (["x", "y"] as const).map((axis) => ({
      axis,
      banded: this.#banded[axis],
      // A category axis is read through its series' band indices.
      columns: this.#banded[axis]
        ? []
        : (axis === "x" ? this.#x : this.#y).map((f) => table.numbers(f as never)),
      used: new Set<number>(),
      low: Infinity,
      high: -Infinity,
    }));
    let count = 0;
    for (const s of parts)
      for (let k = 0; k < s.length; k++) {
        const row = rowOf(s, k);
        // Placed as drawn: a band on category axes, finite values otherwise.
        const placed = axes.every((a) =>
          a.banded ? s[a.axis][row]! >= 0 : a.columns.every((c) => Number.isFinite(c[row]!)),
        );
        if (!placed) continue;
        count++;
        for (const a of axes) {
          if (a.banded) a.used.add(s[a.axis][row]!);
          else
            for (const c of a.columns) {
              a.low = Math.min(a.low, c[row]!);
              a.high = Math.max(a.high, c[row]!);
            }
        }
      }
    if (count === 0) return `${name}: no data`;
    let text = `${name}: ${count} ${ranges ? "range" : "point"}${count === 1 ? "" : "s"}`;
    // Categories along y, as points' sentences count them, else along x.
    const { used } = axes[this.#banded.y ? 1 : 0]!;
    if (used.size > 0) text += ` in ${used.size} ${used.size === 1 ? "category" : "categories"}`;
    for (const { axis, banded, low, high } of axes)
      if (!banded) text += `, ${axis} from ${format[axis](low)} to ${format[axis](high)}`;
    return text;
  }

  describe(): string | undefined {
    return this.#description;
  }

  geometry(series: readonly Series[], frame: Frame, key: MarkKey): ShapesGeometry[] {
    refuseValues(frame.keyed, this.spec.type);
    const { theme, paint } = frame;
    const shapes: (PathShape | TextShape)[] = [];
    // Shapes' colors are read as the chart's other colors are: each distinct one once.
    const path = (d: string, style: ShapeStyle = {}) => {
      // A stroke of "none" or of no width is no stroke, on Canvas as in SVG.
      const width = style.strokeWidth ?? 1;
      const stroke =
        style.stroke !== undefined && style.stroke !== "none" && width > 0 && width < Infinity
          ? paint(style.stroke, "custom stroke")
          : undefined;
      const opacity = style.opacity ?? 1;
      shapes.push({
        d,
        fill:
          style.fill === undefined
            ? stroke === undefined
              ? theme.text
              : "none"
            : paint(style.fill, "custom fill"),
        stroke,
        strokeWidth: stroke === undefined ? 0 : width,
        opacity: opacity >= 0 && opacity <= 1 ? opacity : opacity > 1 ? 1 : 0,
        dash: dashPattern(style.dash, width),
      });
    };
    // Hidden series are not drawn, as with other marks.
    const shown = series.filter((s) => !frame.hidden.has(s.key));
    const views = shown.map((s) => customSeries(s, this.#placed));
    const seriesOf = new Map(views.map((view, i) => [view, shown[i]!]));
    // Items as `item` calls draw them, and which rows a selection holds.
    const table = this.table;
    const selected = table && frame.highlighted?.(table);
    const itemSeries: Series[] = [];
    const positions: number[] = [];
    const starts: number[] = [];
    const ends: number[] = [];
    let drawing = false;
    const features = frame.features?.of(this);
    const ownerOf = (view: CustomSeries, role: string) => {
      const s = seriesOf.get(view);
      if (!s)
        throw new TypeError(
          `custom ${role}: the series is not one of this draw's series; pass one of context.series`,
        );
      return s;
    };
    // Without a table, `table` is undefined; the table-free context's type has none.
    const context: DataDrawContext<Schema> = {
      table: table!,
      series: views,
      x: (value) => frame.x.map(value),
      y: (value) => frame.y.map(value),
      domain: { x: frame.x.domain, y: frame.y.domain },
      bandwidth: { x: Math.abs(frame.x.bandwidth ?? 0), y: Math.abs(frame.y.bandwidth ?? 0) },
      plot: frame.plot,
      theme,
      path,
      rect: (x, y, width, height, style) =>
        path(`M${n(x)} ${n(y)}h${n(width)}v${n(height)}h${n(-width)}Z`, style),
      circle: (cx, cy, r, style) =>
        path(
          `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`,
          style,
        ),
      line: (x1, y1, x2, y2, style) =>
        path(`M${n(x1)} ${n(y1)}L${n(x2)} ${n(y2)}`, {
          ...style,
          stroke: style?.stroke ?? theme.text,
          fill: "none",
        }),
      text: (x, y, text, style = {}) => {
        const fill = style.fill === undefined ? theme.text : paint(style.fill, "custom text fill");
        if (fill === "none") return;
        shapes.push({ text, x, y, fill, anchor: style.anchor ?? "middle" });
      },
      item: (view, row, draw) => {
        if (drawing)
          throw new Error("custom item: called inside another item's draw; draw each item apart");
        const s = ownerOf(view, "item");
        const position = positionOf(s, row);
        if (position < 0)
          throw new RangeError(
            `custom item: row ${JSON.stringify(row)} is not a row of series "${s.label}"; pass a row from series.rowAt`,
          );
        const start = shapes.length;
        drawing = true;
        try {
          draw();
        } finally {
          drawing = false;
        }
        if (shapes.length === start) return;
        // An item a selection leaves out is dimmed, whatever draw made of it.
        if (selected && !selected[row])
          for (let i = start; i < shapes.length; i++) {
            const shape = shapes[i]!;
            shapes[i] = { ...shape, opacity: (shape.opacity ?? 1) * DIM };
          }
        itemSeries.push(s);
        positions.push(position);
        starts.push(start);
        ends.push(shapes.length);
      },
      encoded: ((channel: CustomChannel, row: number) =>
        features?.encoded?.(channel, row)) as DataDrawContext<Schema>["encoded"],
      selection: (view, row) => {
        ownerOf(view, "selection");
        return selected ? (selected[row] ? "selected" : "unselected") : undefined;
      },
    };
    this.#draw(context);
    const font = `${theme.fontSize}px ${theme.font}`;
    const geometry: ShapesGeometry = {
      kind: "shapes",
      draw: shapesDrawing,
      key: seriesKey(key, "custom"),
      shapes,
      font,
      fontSize: theme.fontSize,
    };
    let byMark = byPlot.get(frame.plot);
    if (!byMark) {
      byMark = new Map();
      byPlot.set(frame.plot, byMark);
    }
    byMark.set(this, geometry);
    if (starts.length > 0)
      drawnItems.set(geometry, {
        series: itemSeries,
        positions,
        starts,
        shapes: new ShapeIndex(
          shapes,
          starts.map((start, i) => ({ start, end: ends[i]! })),
          font,
          theme.fontSize,
          frame.measure,
          // Where a pointer may find items: inside the clip (the plot's, or
          // the chart's), and its size around it for strokes reaching in.
          grown(clipBox(this.spec.clip, frame)),
        ),
      });
    if (shapes.length === 0) return [];
    return [geometry];
  }

  /**
   * The topmost item within `query.slop` of its shapes, of the series
   * shown (the query's only, if it names one), with its drawn box; for a
   * mark of points that drew no items, its series' nearest point within a
   * few pixels. Ranges are picked by their items only, as they are read.
   */
  pickItem(drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
    const { frame } = drawn;
    const table = this.table;
    if (!frame || !table) return undefined;
    const geometry = drawn.geometry.find((g): g is ShapesGeometry => g.kind === "shapes");
    const items = geometry && drawnItems.get(geometry);
    const wanted = (s: Series) =>
      !frame.hidden.has(s.key) && (query.series === undefined || query.series === s.key);
    if (!items)
      return this.#layout === "ranges" ? undefined : this.#pickPoint(drawn, query, wanted);
    const found = items.shapes.find(query.x, query.y, query.slop, (group) =>
      wanted(items.series[group]!),
    );
    if (!found) return undefined;
    const series = items.series[found.group]!;
    const position = items.positions[found.group]!;
    const box = this.#boxOf(items, series, position);
    if (!box) return undefined;
    return {
      part: { kind: "row", table, position: rowOf(series, position), series: { series, position } },
      names: undefined,
      box,
      distance: found.distance,
    };
  }

  /** What shape `index` of the shapes geometry draws: its item's row, or nothing outside items. */
  partOf(
    _drawn: DrawnMark,
    geometry: ShapesGeometry,
    index: number,
    _parts: PartBuilders,
  ): DrawnPart | undefined {
    const items = drawnItems.get(geometry);
    if (!items || !this.table) return undefined;
    // The last call starting at or before the shape, if the shape is one of its.
    let [lo, hi] = [0, items.starts.length];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (items.starts[mid]! <= index) lo = mid + 1;
      else hi = mid;
    }
    const call = lo - 1;
    if (call < 0 || index >= items.shapes.endOf(call)) return undefined;
    const series = items.series[call]!;
    const position = items.positions[call]!;
    return {
      kind: "row",
      table: this.table,
      position: rowOf(series, position),
      series: { series, position },
    };
  }

  /** Where row `row`'s item of `series` is in `frame`'s plot: its drawn box's middle, inside the plot. */
  #placeOf(series: Series, row: number, frame: Frame): readonly [number, number] | undefined {
    const geometry = byPlot.get(frame.plot)?.get(this);
    const items = geometry && drawnItems.get(geometry);
    const position = positionOf(series, row);
    const box = items && position >= 0 ? this.#boxOf(items, series, position) : undefined;
    if (!box) return undefined;
    const { plot } = frame;
    const x0 = Math.max(box.x, plot.x);
    const x1 = Math.min(box.x + box.width, plot.x + plot.width);
    const y0 = Math.max(box.y, plot.y);
    const y1 = Math.min(box.y + box.height, plot.y + plot.height);
    if (x0 > x1 || y0 > y1) return undefined;
    return [(x0 + x1) / 2, (y0 + y1) / 2];
  }

  /** The item exactly under (px, py) in `frame`'s plot, of `series`. */
  #pickAt(series: readonly Series[], px: number, py: number, frame: Frame): Hit | undefined {
    const geometry = byPlot.get(frame.plot)?.get(this);
    const items = geometry && drawnItems.get(geometry);
    if (!items) return undefined;
    const among = new Set(series);
    const found = items.shapes.find(px, py, 0, (group) => among.has(items.series[group]!));
    if (!found) return undefined;
    // Its tooltip stands where the pointer found it.
    return {
      series: items.series[found.group]!,
      position: items.positions[found.group]!,
      distance: 0,
      at: [px, py],
    };
  }

  /** The drawn box of every call drawing `series`' position `position`, together. */
  #boxOf(items: DrawnItems, series: Series, position: number): Rect | undefined {
    if (!items.calls) {
      const calls = new Map<Series, Map<number, number[]>>();
      items.series.forEach((s, call) => {
        const byPosition = calls.get(s) ?? new Map<number, number[]>();
        calls.set(s, byPosition);
        const at = items.positions[call]!;
        byPosition.set(at, [...(byPosition.get(at) ?? []), call]);
      });
      items.calls = calls;
    }
    let box: Rect | undefined;
    for (const call of items.calls.get(series)?.get(position) ?? []) {
      const own = items.shapes.box(call);
      if (!own) continue;
      if (!box) box = { ...own };
      else {
        const x1 = Math.max(box.x + box.width, own.x + own.width);
        const y1 = Math.max(box.y + box.height, own.y + own.height);
        box.x = Math.min(box.x, own.x);
        box.y = Math.min(box.y, own.y);
        box.width = x1 - box.x;
        box.height = y1 - box.y;
      }
    }
    return box;
  }

  /** For marks drawing no items: their series' point nearest the query within reach, the later on ties. */
  #pickPoint(
    drawn: DrawnMark,
    query: PickQuery,
    wanted: (s: Series) => boolean,
  ): PickedItem | undefined {
    const frame = drawn.frame!;
    let best:
      | { series: Series; position: number; x: number; y: number; distance: number }
      | undefined;
    for (const series of drawn.series) {
      if (!wanted(series)) continue;
      for (let position = 0; position < series.length; position++) {
        const row = rowOf(series, position);
        const x = frame.x.map(placeAt(series, "x", row));
        const y = frame.y.map(placeAt(series, "y", row));
        const distance = Math.max(0, Math.hypot(x - query.x, y - query.y) - POINT_REACH);
        if (
          Number.isFinite(distance) &&
          distance <= query.slop &&
          !(best && best.distance < distance)
        )
          best = { series, position, x, y, distance };
      }
    }
    if (!best) return undefined;
    const { series, position, x, y, distance } = best;
    return {
      part: {
        kind: "row",
        table: this.table!,
        position: rowOf(series, position),
        series: { series, position },
      },
      names: undefined,
      box: {
        x: x - POINT_REACH,
        y: y - POINT_REACH,
        width: 2 * POINT_REACH,
        height: 2 * POINT_REACH,
      },
      distance,
    };
  }
}

/** `box` with its own size added on every side. */
function grown({ x, y, width, height }: Readonly<Rect>): Rect {
  return { x: x - width, y: y - height, width: 3 * width, height: 3 * height };
}

/**
 * Of series whose rows do not ascend (a sorted view's), each row's
 * position, by the series' rows and as long as it holds them.
 */
const positionsOf = /* @__PURE__ */ new WeakMap<
  ArrayLike<number>,
  { length: number; positions: Map<number, number> }
>();

/** Position of row `row` in series `s`, or -1 when it holds none. */
function positionOf(s: Series, row: number): number {
  if (!Number.isInteger(row)) return -1;
  const { rows, length } = s;
  if (!rows) return row >= 0 && row < length ? row : -1;
  // Rows split from a table ascend, and are found by halving.
  let [lo, hi] = [0, length];
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (rows[mid]! < row) lo = mid + 1;
    else hi = mid;
  }
  if (lo < length && rows[lo] === row) return lo;
  // A view's may run in any order: their positions are indexed once.
  let index = positionsOf.get(rows);
  if (index?.length !== length) {
    const positions = new Map<number, number>();
    for (let k = length - 1; k >= 0; k--) positions.set(rows[k]!, k);
    index = { length, positions };
    positionsOf.set(rows, index);
  }
  return index.positions.get(row) ?? -1;
}

/**
 * A custom mark: `draw` places shapes with the chart's scales on every
 * frame. With a table, the `x` and `y` fields count toward the axis
 * domains and make series, which `draw` receives, with legend entries and
 * tooltips; shapes drawn in `item` calls are rows' items, which the
 * pointer picks by shape and selections dim. Over a `RowView`, the
 * series hold the view's rows only, in its order (`draw`'s `table` is the
 * view's table, which rows index). JavaScript only: chart specs (and so
 * the Python package) cannot hold custom marks.
 *
 * ```ts
 * custom(forecasts, {
 *   x: ["start", "end"],
 *   y: "id",
 *   series: "category",
 *   encode: { strokeWidth: { field: "confidence", scale: "widths" } },
 *   draw({ table, series, x, y, item, path, encoded }) {
 *     const end = table.numbers("end");
 *     for (const s of series)
 *       for (let k = 0; k < s.length; k++) {
 *         const row = s.rowAt(k);
 *         item(s, row, () =>
 *           path(`M${x(s.x[row]!)} ${y(s.y[row]!)}H${x(end[row]!)}`, {
 *             stroke: s.color,
 *             strokeWidth: encoded("strokeWidth", row),
 *           }),
 *         );
 *       }
 *   },
 * })
 * ```
 */
export function custom(options: CustomOptions): ChartMark<Frozen<CustomSpec>>;
export function custom<S extends Schema>(
  data: Table<S> | RowView<S>,
  options: CustomDataOptions<S>,
): ChartMark<Frozen<CustomSpec>>;
export function custom<S extends Schema>(
  first: Table<S> | RowView<S> | CustomOptions,
  second?: CustomDataOptions<S>,
): ChartMark<Frozen<CustomSpec>> {
  const data = second ? (first as Table<S> | RowView<S>) : undefined;
  const view = data && isRowView(data) ? data : undefined;
  const table = view ? view.source : (data as Table<S> | undefined);
  const options = (second ?? first) as CustomDataOptions<S>;
  // Field names were checked against S above; marks work on the erased schema.
  return new CustomMark(
    table as unknown as Table | undefined,
    options as unknown as CustomDataOptions<Schema>,
    view as unknown as RowView | undefined,
  );
}
