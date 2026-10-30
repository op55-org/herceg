import type { RowView } from "../data/row-view.ts";
import type { CategoryField, NumericField, PositionField, Schema, Table } from "../data/table.ts";
import { pointDrawing } from "../draw/point.ts";
import { SYMBOLS, type SymbolName, symbolPath, symbolReach } from "../draw/symbols.ts";
import { formatNumber } from "../format/format.ts";
import { GridIndex } from "../lod/grid-index.ts";
import type { Breaks } from "../lod/m4.ts";
import { clearDomain } from "../model/clearance.ts";
import type { PointChannel, PointChannels, PointLooks } from "../model/features.ts";
import type { LegendPart } from "../model/legend.ts";
import { type Nearest, settle } from "../model/nearest.ts";
import {
  checkColorScale,
  checkRamp,
  fraction,
  isOpaqueColor,
  rampOf,
  SequentialScale,
} from "../scale/color.ts";
import { linearTicks } from "../scale/ticks.ts";
import {
  CLOUD_POINTS,
  MOVING_POINTS,
  type PointCloud,
  type PointGeometry,
  type PointItems,
  type Rect,
} from "../scene/scene.ts";
import { type ChannelName, outputProblem } from "../spec/channels.ts";
import type { ChannelSpec } from "../spec/encoding.ts";
import { ChartError } from "../spec/errors.ts";
import type { Clip, Frozen, PointSpec } from "../spec/spec.ts";
import { type PaintReader, surface, type Theme } from "../theme.ts";
import { BandShares, jitterOf, STILL } from "./dodge.ts";
import type { Channel, Encodings, FieldCoordinate, ItemKeyed, MappedField } from "./encoding.ts";
import { withoutHidden } from "./hidden.ts";
import { legendParts } from "./legend-parts.ts";
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
  type ColorRamp,
  checkItemKey,
  type Frame,
  fieldBands,
  frozen,
  type GlyphKey,
  type Hit,
  type LegendScale,
  type MARK,
  type Mark,
  type MarkKey,
  type MarkSources,
  NUMERIC,
  type Palette,
  painted,
  requireField,
  rowBuffer,
  SeriesSplitter,
  type SummaryContext,
  seriesOf,
} from "./mark.ts";
import { bindRows, offAxis, type RowBindings } from "./row-bindings.ts";
import { extentAt, isRowView, type MarkRows, rowsOf } from "./rows.ts";
import { placeAt, rowOf, type Series, valueAt, visibleRange, xExtent, yExtent } from "./series.ts";
import { offsetOf, Swarms } from "./swarm.ts";
import { checkTooltip, type MarkTooltip } from "./tooltip-fields.ts";
import { unionExtent } from "./trace.ts";

/**
 * A point's size, in one form: a constant `radius`, a number field `size`
 * sized by area within `radiusRange` (bubbles), or a size channel, as
 * `size` or `encode.size`.
 */
export type PointSize<S extends Schema> =
  | {
      /** Radius in pixels; 2.5 by default. */
      radius?: number;
      size?: never;
      radiusRange?: never;
      encode?: { size?: never };
    }
  | {
      radius?: never;
      /** A number field sized by area within `radiusRange` (bubbles). */
      size?: NumericField<S>;
      /** Radii of the smallest and largest values of `size`. Default [2, 12]. */
      radiusRange?: readonly [number, number];
      encode?: { size?: never };
    }
  | {
      radius?: never;
      /**
       * A channel giving each point's area in square pixels, or a number
       * field sized by area as `size` is.
       */
      size?: Channel<number, S> | MappedField<S>;
      radiusRange?: never;
      encode?: { size?: never };
    }
  | { radius?: never; size?: never; radiusRange?: never };

/**
 * Where a point's `spec` has no single size form (see `PointSize`), and
 * why, or undefined: a size channel, given as `size` or in `encode`, gives
 * points' areas on its own scale, and a radius one size for all.
 */
export function pointSizeForm(spec: {
  radius?: unknown;
  size?: unknown;
  radiusRange?: unknown;
  encode?: unknown;
}): { path: string; message: string } | undefined {
  const { radius, size, radiusRange, encode } = spec;
  const encoded =
    typeof encode === "object" &&
    encode !== null &&
    (encode as { size?: unknown }).size !== undefined;
  if (((typeof size === "object" && size !== null) || encoded) && radiusRange !== undefined)
    return {
      path: "radiusRange",
      message: "point radiusRange: a size channel's scale gives its areas; drop radiusRange",
    };
  if (encoded && (radius !== undefined || size !== undefined))
    return {
      path: "encode.size",
      message: `point encode.size: a size channel, and ${radius !== undefined ? "a constant radius" : "size"} too; drop one`,
    };
  return radius !== undefined && size !== undefined
    ? {
        path: "radius",
        message: "point radius: a constant radius or a size field, not both; drop one",
      }
    : undefined;
}

export type PointOptions<S extends Schema> = PointStyle<S> & PointSize<S>;

interface PointStyle<S extends Schema> extends ItemKeyed<S> {
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
  /**
   * A number or time field, a category field placing points in its bands
   * (strip plots), or a coordinate.
   */
  x: PositionField<S> | FieldCoordinate<S>;
  /** Like `x`: categories run top to bottom. */
  y: PositionField<S> | FieldCoordinate<S>;
  /**
   * Category field: one colored point series per value; by default the
   * category `color` field, and `false` for none (points colored each by
   * their row's `color`).
   */
  series?: CategoryField<S> | false;
  fill?: string;
  /** Opacity from 0 to 1, a number field mapped from 0.15 to 1, or a channel. */
  fillOpacity?: number | NumericField<S> | Channel<number, S> | MappedField<S>;
  /** Outline color of every point; the chart's background with only `strokeWidth`. */
  stroke?: string;
  /** Outline width in pixels: 1 with only `stroke`, none by default. */
  strokeWidth?: number;
  /**
   * A number or time field colored on a continuous scale, with a color
   * legend; or a category field whose values take the theme's palette in
   * order of appearance, with a key of them (the `series` field, named here,
   * keeps its series' colors); or a channel, such as `{ field, scale: {
   * type: "identity" } }` for a field of colors.
   */
  color?: PositionField<S> | Channel<string, S> | MappedField<S>;
  /**
   * Colors for a number or time `color`, low to high, such as an imported
   * scheme (`viridis`, `rdbu`, ...). Defaults to the theme's sequential
   * ramp, or its diverging one with a midpoint.
   */
  colors?: readonly string[];
  /** The values at the ends of the color ramp; the field's extent by default. */
  colorDomain?: readonly [number, number];
  /** The value at the ramp's middle, for diverging ramps. */
  colorMidpoint?: number;
  /**
   * A shape's name, or a category field with a shape per value: its name,
   * or `{ field }`, which a field named like a shape needs (with `scale`,
   * a channel). Default "circle".
   */
  symbol?: SymbolName | CategoryField<S> | Channel<SymbolName, S>;
  /**
   * Channels of each point: color, fill, stroke, strokeWidth, opacity,
   * symbol, and size; color and size map number fields as `color` and
   * `size` do.
   */
  encode?: Pick<Encodings<S>, "fill" | "stroke" | "strokeWidth" | "opacity" | "symbol"> & {
    color?: Channel<string, S> | MappedField<S>;
    size?: Channel<number, S> | MappedField<S>;
  };
  /**
   * "pixel": draw opaque points whose centers share a device pixel once.
   * Faster for dense scatters; edges can differ by a fraction of a pixel.
   */
  sampling?: "none" | "pixel";
  /**
   * With a `series` field and a category `x` or `y`: place the series side
   * by side in each band, as grouped bars are, instead of at its center.
   */
  dodge?: boolean;
  /**
   * With a category `x` or `y`: spread points across their band (or, with
   * `dodge`, their series' share of it) over `width`, a fraction of it, by a
   * hash of each row and `seed`, so points stay put as data streams.
   */
  jitter?: { width: number; seed?: number };
  /**
   * With a category `x` or `y`: pack points across their band (or, with
   * `dodge`, their series' share of it) without overlap, in order of their
   * values, as a beeswarm; points that do not fit stand at its edges. It
   * is laid out again as the chart resizes and zooms.
   */
  swarm?: boolean;
  /** Where the points are drawn among the panel's marks: higher above lower; 0 by default. */
  zIndex?: number;
  label?: string;
  /** `false` leaves the mark out of the chart's legends. */
  legend?: false;
  /** Fields of the row tooltips show besides the mark's values, such as counts that are not plotted. */
  tooltip?: MarkTooltip<S>;
  id?: string;
}

const DEFAULT_RADIUS = 2.5;
const RADIUS_RANGE: readonly [number, number] = [2, 12];
/** Opacity of a field's smallest value; its largest is opaque. */
const MIN_OPACITY = 0.15;
const NO_COORDS = new Float32Array(0);
const POSITION: readonly ["number", "time", "category"] = ["number", "time", "category"];
/** Legend shapes: circles of this radius, other shapes reaching at most LEGEND_REACH. */
const LEGEND_RADIUS = 4.5;
const LEGEND_REACH = 6;

/** How a point's radius, color, opacity, and shape follow fields, for one frame. */
interface Encoding {
  radius?: (value: number) => number;
  /** A number or time `color`'s scale. */
  color?: SequentialScale;
  /** The colors of a color channel the feature compiler reads (see `PointLooks`). */
  looks?: PointLooks;
  palette?: readonly string[];
  opacity?: (value: number) => number;
}

/** Stream identities of clouds by table, x field, and y field, shared by every chart drawing them. */
const streamKeys = new WeakMap<Table, Map<string, Map<string, object>>>();

export class PointMark implements Mark<Frozen<PointSpec>> {
  declare readonly [MARK]: true;
  readonly clearDomain = clearDomain;
  readonly spec: Frozen<PointSpec>;
  readonly table: Table<Schema>;
  readonly identity: MarkSources;
  readonly legendScales: readonly LegendScale[];
  readonly view: RowView | undefined;
  readonly tooltip = "point";
  /** Channels the feature compiler reads per row colors, sizes, and shapes points through (see model/features.ts). */
  readonly featured: boolean = false;
  /** What of the channels the feature compiler reads, and what the mark draws itself. */
  readonly channels: PointChannels;
  /** Room automatic padding keeps for points; the feature compiler's where its channels size or shape them. */
  readonly inset: { x: number; y: number } | undefined;
  readonly bound: RowBindings | undefined;
  /** The fields placing points along x and y: their own, or their coordinates'. */
  readonly #fields: { readonly x: string; readonly y: string };
  readonly #split: SeriesSplitter;
  /** Which positions are categories: each row's band index places it. */
  readonly #banded: { readonly x: boolean; readonly y: boolean };
  /** Pick indexes per frame (charts sharing this mark have separate frames), per series key. */
  readonly #indexes = new WeakMap<Frame, Map<string, GridIndex>>();
  /** Number fields points map themselves: sizes by area, opacities, a color ramp. */
  readonly #sizeField: string | undefined;
  readonly #opacityField: string | undefined;
  readonly #toneField: string | undefined;
  /** The shape of every point when no channel gives one. */
  readonly #symbol: SymbolName;
  /** The radius of every point, or with a `size` field the largest. */
  readonly #radius: number;
  /** Fill opacity of every point when no channel gives one. */
  readonly #opacity: number;
  /** Outline color and width in pixels; 0 for none. */
  readonly #stroke: string | undefined;
  readonly #ringWidth: number;
  /** How far each of SYMBOLS reaches per unit of radius. */
  readonly #reaches = SYMBOLS.map(symbolReach);
  /** The field splitting series: `series`, or a category `color` field (see `seriesOf`). */
  readonly #series: string | undefined;
  /** The banded axis points spread along (dodge, jitter, swarm), and their series' shares of its bands. */
  readonly #spread: { axis: "x" | "y"; shares: BandShares } | undefined;
  /** With `swarm`, the layout of each panel's swarms. */
  readonly #swarms: Swarms | undefined;

  constructor(input: PointSpec, table: Table<Schema>, view?: RowView) {
    // Well formed first, as the validator checks a spec before what it draws.
    const sizeForm = pointSizeForm(input);
    if (sizeForm) throw new ChartError({ code: "invalid-option", ...sizeForm });
    this.spec = frozen(input);
    checkTooltip(table, this.spec.tooltip, "point");
    checkItemKey(table, this.spec.itemKey, "point");
    // Read from the copy: the caller may change what it passed.
    const spec = this.spec;
    this.table = table;
    if (view && view.source !== table)
      throw new Error("point: the view must be of the mark's table");
    this.view = view;
    const { fields, bound } = bindRows(spec, table, "point", ["x", "y"]);
    this.bound = bound;
    const position = fields as { x: string; y: string };
    this.#fields = position;
    requireField(table, position.x, POSITION, "point x");
    requireField(table, position.y, POSITION, "point y");
    if (typeof spec.series === "string") requireField(table, spec.series, CATEGORY, "point series");
    // A category color names the series, as on lines and bars.
    const series = seriesOf(spec as PointSpec as never, table, "fill");
    this.#series = series;
    this.#banded = {
      x: table.kind(position.x) === "category",
      y: table.kind(position.y) === "category",
    };
    const { dodge, jitter, swarm } = spec;
    if (swarm !== undefined && typeof swarm !== "boolean")
      throw new TypeError(`point swarm: expected true or false; received ${JSON.stringify(swarm)}`);
    if (swarm && jitter) throw new Error("point swarm: places points itself; drop jitter or swarm");
    if (swarm && spec.sampling === "pixel")
      throw new Error('point sampling: a swarm places every point; drop sampling: "pixel"');
    if (dodge || jitter || swarm) {
      const option = dodge ? "dodge" : jitter ? "jitter" : "swarm";
      if (this.#banded.x === this.#banded.y)
        throw new Error(`point ${option}: needs one category position, x or y`);
      if (dodge && series === undefined)
        throw new Error("point dodge: places series side by side; give a series field");
      if (jitter && !(jitter.width >= 0 && jitter.width <= 1))
        throw new RangeError(
          `point jitter.width: expected a number from 0 to 1; received ${jitter.width}`,
        );
      if (jitter?.seed !== undefined && !Number.isInteger(jitter.seed))
        throw new RangeError(`point jitter.seed: expected a whole number; received ${jitter.seed}`);
      this.#spread = { axis: this.#banded.x ? "x" : "y", shares: new BandShares() };
      if (swarm) this.#swarms = new Swarms();
    }
    // Points in bands are in no x order.
    const xField = this.#banded.x ? undefined : position.x;
    this.#split = new SeriesSplitter(() => this.rows(), xField, [position.y], series, spec.label);
    this.identity = { field: series, values: [position.y] };
    const channels = pointChannels(spec, table);
    const { color, size, opacity, symbol } = channels;
    this.#toneField = color.own;
    this.#sizeField = size.own;
    this.#opacityField = opacity.own;
    if (
      color.given !== undefined &&
      color.own === undefined &&
      (spec.colors !== undefined ||
        spec.colorDomain !== undefined ||
        spec.colorMidpoint !== undefined)
    )
      throw new Error(
        `point colors: ${typeof color.given === "string" ? `"${color.given}" is a category field, colored by the theme's palette` : "a ramp colors a number field"}; drop colors, colorDomain, and colorMidpoint`,
      );
    if (Array.isArray(spec.colors)) checkRamp(spec.colors, "point colors", true);
    checkColorScale(spec.colorDomain, spec.colorMidpoint, "point");
    if (spec.radius !== undefined && !(spec.radius > 0 && Number.isFinite(spec.radius)))
      throw new RangeError(
        `point radius: expected a positive number of pixels; received ${spec.radius}`,
      );
    this.#opacity = typeof opacity.given === "number" ? opacity.given : 1;
    if (!(this.#opacity >= 0 && this.#opacity <= 1))
      throw new RangeError(
        `point fillOpacity: expected a number from 0 to 1 or a field; received ${this.#opacity}`,
      );
    const range = spec.radiusRange ?? RADIUS_RANGE;
    if (!(range[0] >= 0 && range[1] > range[0] && Number.isFinite(range[1])))
      throw new RangeError(
        `point radiusRange: expected two finite radii, ascending; received [${range}]`,
      );
    this.#symbol = typeof symbol.given === "string" ? (symbol.given as SymbolName) : "circle";
    // What guides may name: the series, and the fields that color, size,
    // and shape points (a symbol field splitting series shows in its entries).
    const scales: LegendScale[] = ["series"];
    const field = (c: PointChannel<unknown> | undefined) =>
      c && "field" in c.spec && c.spec.field !== series;
    if (this.#toneField !== undefined) scales.push("ramp");
    if (field(color.compiled)) scales.push("key");
    if (this.#sizeField !== undefined || field(size.compiled)) scales.push("size");
    if (field(symbol.compiled)) scales.push("symbol");
    this.legendScales = scales;
    const radius = this.#sizeField !== undefined ? range[1] : (spec.radius ?? DEFAULT_RADIUS);
    this.#radius = radius;
    const encode = spec.encode ?? {};
    for (const name of ["stroke", "strokeWidth"] as const) {
      if (encode[name] === undefined) continue;
      refuseBoth(spec, name, name);
      if (!("value" in encode[name]))
        throw new ChartError({
          code: "unsupported",
          path: `encode.${name}`,
          message: `point encode.${name}: points of a mark draw one outline; give { value }, or ${name}`,
        });
    }
    this.#stroke = spec.stroke ?? (encode.stroke as { value?: string } | undefined)?.value;
    const width = spec.strokeWidth ?? (encode.strokeWidth as { value?: number } | undefined)?.value;
    if (width !== undefined && !(width >= 0 && Number.isFinite(width)))
      throw new RangeError(`point strokeWidth: expected 0 or more pixels; received ${width}`);
    this.#ringWidth = width ?? (this.#stroke !== undefined ? 1 : 0);
    this.channels = {
      color: color.compiled,
      size: size.compiled,
      opacity: opacity.compiled,
      symbol: symbol.compiled,
      radius,
      shape: this.#symbol,
      outline: this.#ringWidth,
    };
    this.featured = !!(color.compiled || size.compiled || opacity.compiled || symbol.compiled);
    // Outlines reach half their width past the shape, along the axes it is placed on.
    const extent = radius * this.#reaches[SYMBOLS.indexOf(this.#symbol)]! + this.#ringWidth / 2;
    this.inset = size.compiled || symbol.compiled ? undefined : { x: extent, y: extent };
  }

  #rows: MarkRows | undefined;

  /** What the mark reads of its table now (see marks/rows.ts). */
  rows(): MarkRows {
    this.#rows = rowsOf(this.view ?? this.table, this.#rows);
    return this.#rows;
  }

  channelKind(axis: "x" | "y") {
    return offAxis(this.bound, axis) ? undefined : this.table.kind(this.#fields[axis]);
  }

  bands(axis: "x" | "y", context: BandContext): BandList | undefined {
    return this.#banded[axis] ? fieldBands(this.rows(), this.#fields[axis], context) : undefined;
  }

  series(
    key: MarkKey,
    palette: Palette,
    hidden: ReadonlySet<string>,
    bands: Bands,
    context: BandContext,
  ) {
    const { spec, table } = this;
    const fields = this.#fields;
    // A category position is each row's band index on the chart's axis.
    const banded = (axis: "x" | "y") =>
      bandIndices(this.rows(), fields[axis], bands[axis]?.keys ?? [], context);
    const series = buildSeries(
      table,
      this.#split.sources(),
      this.#banded.x ? banded("x") : table.numbers(fields.x as never),
      key,
      palette,
      spec.fill,
      this.#banded.y ? banded("y") : undefined,
    );
    // Rows the legend hides by value go, as hidden series do.
    return withoutHidden(series, hidden, key, table);
  }

  xExtent(series: readonly Series[], log: boolean) {
    if (this.#banded.x) return undefined;
    return unionExtent(
      series.map((s) => (this.#banded.y ? bandedExtent(s, "x", log) : xExtent(s, log))),
    );
  }

  yExtent(series: readonly Series[], x0: number, x1: number, log: boolean, breaks?: Breaks) {
    if (this.#banded.y) return undefined;
    // A category x axis shows all its bands.
    if (this.#banded.x) return unionExtent(series.map((s) => bandedExtent(s, "y", log)));
    return unionExtent(series.map((s) => yExtent(s, x0, x1, s.y, log, undefined, false, breaks)));
  }

  geometry(series: readonly Series[], frame: Frame): PointGeometry[] {
    const looks = looksOf(series);
    const encoding = this.#encoding(frame, looks);
    // With no color value at all, no point has the value it encodes.
    if (this.#toneField !== undefined && !encoding.color) return [];
    const radius = this.#radius;
    const reachOf = this.#reaches;
    const fixedReach = reachOf[SYMBOLS.indexOf(this.#symbol)]!;
    const opacity = this.#opacity;
    const area = looks?.area;
    const opacityOf = looks?.opacity;
    const shapeOf = looks?.shape;
    // Points of one size, color, opacity, and circle shape can take the fast paths.
    const encoded =
      encoding.radius !== undefined ||
      encoding.palette !== undefined ||
      encoding.opacity !== undefined ||
      !!(area || opacityOf || shapeOf) ||
      this.#symbol !== "circle";
    const { plot, pixelRatio } = frame;
    const out: PointGeometry[] = [];
    const columns = Math.ceil(plot.width * pixelRatio) + 1;
    const rows = Math.ceil(plot.height * pixelRatio) + 1;
    const read = (field: string | undefined) =>
      field === undefined ? undefined : this.table.numbers(field as never);
    const sizes = read(this.#sizeField);
    const tones = read(this.#toneField);
    const toneOf = looks?.color;
    const alphas = read(this.#opacityField);
    // Outlined points are drawn one by one, each outline over its point, on the CPU.
    const ring =
      this.#ringWidth > 0
        ? {
            color: painted(frame.paint, this.#stroke, "point stroke") ?? surface(frame.theme),
            width: this.#ringWidth,
          }
        : undefined;
    const keyField = frame.keyed ? this.spec.itemKey : undefined;
    const keyKind = keyField === undefined ? undefined : this.table.kind(keyField);
    const keyLabels = keyKind === "category" ? this.table.categories(keyField as never) : undefined;
    const keyNumbers = keyLabels ? undefined : read(keyField);
    this.#spread?.shares.split(series, frame, Boolean(this.spec.dodge));
    // Swarms are laid out for the panel's scales before any point is placed.
    if (this.#swarms) {
      const radiusOf = this.#radiusScale();
      const values = this.table.numbers(
        this.#fields[this.#spread!.axis === "x" ? "y" : "x"] as never,
      );
      this.#swarms.offsets(
        series,
        frame,
        this.#spread!.axis,
        this.#spread!.shares,
        (row) => this.#reach(row, radiusOf, looks),
        values,
        this.table.version,
      );
    }
    const placeRow = this.#placer();
    const box = this.#bounds(frame);
    for (const s of series) {
      if (frame.hidden.has(s.key)) continue;
      const opaque =
        encoding.opacity === undefined &&
        !opacityOf &&
        opacity >= 1 &&
        (encoding.color !== undefined ||
          (toneOf ? encoding.palette!.every(isOpaqueColor) : isOpaqueColor(s.color)));
      // Device-pixel occupancy for sampling; only opaque plain points qualify,
      // since overlapping translucent or varied points look different from one.
      const sample = this.spec.sampling === "pixel" && opaque && !encoded;
      const [start, end] = this.#visible(s, frame);
      // The GPU maps linearly; points on an axis with breaks are placed here.
      const linear = frame.x.breaks === undefined;
      // The WebGL painter draws whole columns of numbers; a view's rows, and
      // points in bands (read through a panel's places), are drawn on the CPU.
      if (
        frame.clouds &&
        !this.view &&
        !this.#banded.x &&
        !this.#banded.y &&
        !ring &&
        !sample &&
        !encoded &&
        linear &&
        end - start >= CLOUD_POINTS
      ) {
        out.push({
          kind: "point",
          draw: pointDrawing,
          key: s.key,
          fill: s.color,
          fillOpacity: opacity,
          opaque,
          radius,
          symbol: "circle",
          coords: NO_COORDS,
          count: end - start,
          cloud: {
            x: s.x,
            y: s.y,
            rows: s.rows,
            start,
            end,
            xMap: frame.x.mapping(),
            yMap: frame.y.mapping(),
            version: this.table.version,
            stream: this.#stream(s),
          },
        });
        continue;
      }
      const length = end - start;
      const coords = frame.floats(s.key, "point", length * 2);
      const occupied = sample ? frame.bytes(s.key, "occupied", columns * rows) : undefined;
      occupied?.fill(0);
      const radii = (sizes || area) && frame.floats(s.key, "radius", length);
      // Points index more colors than bytes hold (identity colors) by floats.
      const colorIndex =
        encoding.palette &&
        (encoding.palette.length > 256
          ? frame.floats(s.key, "colors", length)
          : frame.bytes(s.key, "color", length));
      const opacities = (alphas || opacityOf) && frame.floats(s.key, "opacity", length);
      const symbols = shapeOf && frame.bytes(s.key, "symbol", length);
      let largest = radius;
      // Capture identity alongside positions; static and sampled charts keep none.
      let items: PointItems | undefined;
      if (frame.keyed && !sample && length <= MOVING_POINTS) {
        const identity = { table: this.table, generation: this.table.generation };
        if (keyLabels) {
          items = { ...identity, ids: [], key: { field: keyField!, kind: "category" } };
        } else {
          const ids = frame.doubles(s.key, "id", length);
          items =
            keyField === undefined
              ? { ...identity, ids }
              : { ...identity, ids, key: { field: keyField, kind: keyKind as "number" | "time" } };
        }
      }
      // The row each point draws, for drawn-mark records and titles.
      const drawnRows = rowBuffer(frame, s.key, "rows", length);
      let count = 0;
      for (let k = start; k < end; k++) {
        const row = rowOf(s, k);
        // A point missing a value it encodes is not drawn.
        const r = sizes
          ? encoding.radius!(sizes[row]!)
          : area
            ? Math.sqrt(area(row) / Math.PI)
            : radius;
        const tone = tones ? encoding.color!.index(tones[row]!) : toneOf ? toneOf(row) : 0;
        const alpha = alphas
          ? encoding.opacity!(alphas[row]!)
          : opacityOf
            ? opacityOf(row)
            : opacity;
        const shape = shapeOf ? shapeOf(row) : 0;
        if (!(r > 0 && tone >= 0 && Number.isFinite(alpha) && shape >= 0)) continue;
        // Points whose shape reaches into what the mark is cut to are drawn.
        const reach = r * (shapeOf ? reachOf[shape]! : fixedReach) + this.#ringWidth / 2;
        const placed = placeRow(s, row, frame, reach, box);
        if (!placed) continue;
        const [px, py] = placed;
        // Device pixels of the plot hold one point each; points past it are all drawn.
        if (occupied) {
          const column = Math.floor((px - plot.x) * pixelRatio);
          const line = Math.floor((py - plot.y) * pixelRatio);
          if (column >= 0 && column < columns && line >= 0 && line < rows) {
            if (occupied[line * columns + column]) continue;
            occupied[line * columns + column] = 1;
          }
        }
        coords[count * 2] = px;
        coords[count * 2 + 1] = py;
        if (radii) radii[count] = r;
        if (r > largest) largest = r;
        if (colorIndex) colorIndex[count] = tone;
        if (opacities) opacities[count] = alpha;
        if (symbols) symbols[count] = shape;
        drawnRows[count] = row;
        if (items) {
          if (keyLabels) {
            (items.ids as (string | undefined)[])[count] =
              keyLabels.dictionary[keyLabels.codes[row]!];
          } else {
            (items.ids as Float64Array)[count] = keyNumbers
              ? keyNumbers[row]!
              : this.table.identity(row);
          }
        }
        count++;
      }
      out.push({
        kind: "point",
        draw: pointDrawing,
        key: s.key,
        fill: s.color,
        fillOpacity: opacity,
        opaque,
        radius: area ? largest : radius,
        symbol: this.#symbol,
        coords,
        count,
        radii,
        colors: colorIndex && {
          index: colorIndex,
          palette: encoding.palette!,
          ...(toneOf && { categorical: true }),
        },
        opacities,
        symbols,
        ring,
        items,
        rows: drawnRows,
      });
    }
    return out;
  }

  /**
   * For opaque points of several colors, which paint color by color (see
   * draw/point.ts): each row's color, by which they paint; undefined for
   * points painted in row order.
   */
  #paintedTone(encoding: Encoding): ((row: number) => number) | undefined {
    const { palette, looks, color } = encoding;
    if (
      !palette ||
      this.#ringWidth > 0 ||
      encoding.opacity !== undefined ||
      looks?.opacity ||
      this.#opacity < 1 ||
      (color === undefined && !palette.every(isOpaqueColor))
    )
      return undefined;
    const tones =
      this.#toneField === undefined ? undefined : this.table.numbers(this.#toneField as never);
    return tones ? (row) => color!.index(tones[row]!) : looks!.color;
  }

  /** How sizes, colors, and opacities follow their fields, with the current data. */
  #encoding(frame: Frame, looks: PointLooks | undefined): Encoding {
    const out: Encoding = {};
    const radius = this.#radiusScale();
    if (radius) out.radius = radius;
    if (this.#opacityField !== undefined) {
      const [lo, hi] = extentAt(this.rows(), this.#opacityField) ?? [0, 0];
      out.opacity = (value) => {
        if (!Number.isFinite(value)) return Number.NaN;
        return MIN_OPACITY + (1 - MIN_OPACITY) * fraction(value, lo, hi);
      };
    }
    const color = this.#colorScale(frame.theme, frame.paint);
    if (color) {
      out.color = color;
      out.palette = this.#palette(color);
    }
    if (looks) out.looks = looks;
    if (looks?.color) out.palette = looks.colors;
    return out;
  }

  /**
   * Radius of a value of the `size` field: areas grow linearly within `radiusRange`
   * from zero, or from the least value when some are negative.
   */
  #radiusScale(): ((value: number) => number) | undefined {
    if (this.#sizeField === undefined) return undefined;
    const extent = extentAt(this.rows(), this.#sizeField);
    const [lo, hi] = extent ? (extent[0] >= 0 ? [0, extent[1]] : extent) : [0, 0];
    const [r0, r1] = this.spec.radiusRange ?? RADIUS_RANGE;
    return (value) => {
      if (!Number.isFinite(value)) return Number.NaN;
      const t = Math.min(1, Math.max(0, fraction(value, lo, hi)));
      return Math.sqrt(r0 * r0 + (r1 * r1 - r0 * r0) * t);
    };
  }

  /** The continuous color scale of a number or time `color` field, with the current data. */
  #colorScale(theme: Theme, paint: PaintReader): SequentialScale | undefined {
    const { spec } = this;
    if (this.#toneField === undefined) return undefined;
    const domain = spec.colorDomain ?? extentAt(this.rows(), this.#toneField);
    if (!domain) return undefined;
    const fallback = spec.colorMidpoint === undefined ? theme.sequential : theme.diverging;
    const ramp = rampOf(spec.colors, fallback, paint, "point colors");
    return new SequentialScale(domain, ramp, spec.colorMidpoint);
  }

  /** The scale's colors, kept while the scale's ramp, domain, and midpoint are unchanged. */
  #palette(scale: SequentialScale): readonly string[] {
    const key = `${scale.stops.join()}|${scale.domain.join()}|${scale.midpoint}`;
    if (this.#palettes?.key !== key) this.#palettes = { key, colors: scale.colors() };
    return this.#palettes.colors;
  }

  #palettes: { key: string; colors: readonly string[] } | undefined;

  /** A color legend for a `color` field, and keys of sizes and shapes encoded by field. */
  legends(
    series: readonly Series[],
    theme: Theme,
    format: (value: number) => string,
    paint: PaintReader,
  ): LegendPart[] {
    const scale = series.length > 0 ? this.#colorScale(theme, paint) : undefined;
    const ramps: ColorRamp[] = scale
      ? [
          {
            stops: scale.legendStops(),
            domain: scale.domain,
            midpoint: scale.midpoint,
            title: this.#toneField!,
          },
        ]
      : [];
    return legendParts(ramps, this.#glyphKeys(series, format));
  }

  /**
   * Point series show their symbol; with a color field coloring points, in a
   * neutral color. An outline in a color of its own shows too, so hollow
   * points have a swatch; one in the background color only keeps points apart.
   */
  legendEntry(
    s: Series,
    theme: Theme,
    paint: PaintReader,
  ): { color: string; glyph: string; stroke?: string } {
    const looks = s.features?.points;
    const entry = {
      color: this.#toneField === undefined && !looks?.color ? s.color : theme.muted,
      glyph: legendGlyph(this.#legendSymbol(s, looks)).glyph,
    };
    const stroke = painted(paint, this.#stroke, "point stroke");
    return stroke !== undefined && this.#ringWidth > 0 ? { ...entry, stroke } : entry;
  }

  /** A series' shape: its own when the symbol field also splits series, else a circle. */
  #legendSymbol(s: Series, looks: PointLooks | undefined): SymbolName {
    if (!looks?.shape) return this.#symbol;
    return SYMBOLS[looks.seriesShape?.(s.label) ?? 0] ?? "circle";
  }

  /**
   * A key of sizes (three round values of the `size` field), of shapes (each
   * value of a symbol field that does not also split series), and of colors
   * (each value of a category `color`).
   */
  #glyphKeys(series: readonly Series[], format: (value: number) => string): GlyphKey[] {
    if (series.length === 0) return [];
    const out: GlyphKey[] = [];
    const radius = this.#radiusScale();
    const extent = this.#sizeField !== undefined && extentAt(this.rows(), this.#sizeField);
    if (radius && extent) {
      // Round values nearest a quarter, half, and all of the way from the
      // smallest size's value (zero, or the least) to the largest's.
      const [lo, hi] = extent[0] >= 0 ? [0, extent[1]] : extent;
      const ticks = linearTicks(extent[0], extent[1], 5).filter((v) => !(lo === 0 && v === 0));
      const nearest = (target: number) =>
        ticks.reduce(
          (a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a),
          ticks.at(-1) ?? extent[1],
        );
      const values = [...new Set([0.25, 0.5, 1].map((f) => nearest(lo + (hi - lo) * f)))];
      out.push({
        title: this.#sizeField!,
        channel: "size",
        entries: values.map((value) => {
          const r = radius(value);
          return { label: format(value), glyph: symbolPath("circle", 0, 0, r), r };
        }),
      });
    }
    // Keys of the values channels map through scales, from the feature compiler.
    out.push(...(looksOf(series)?.keys ?? []));
    return out;
  }

  /** The stream identity of a series of whole columns, for GPU uploads that follow appends. */
  #stream(s: Series): PointCloud["stream"] {
    const { table } = this;
    const x = this.#fields.x;
    // A series' rows grouped from the table stream as their group does.
    if (s.rows !== undefined) {
      if (!s.stream || s.x !== table.numbers(x as never)) return undefined;
      return { key: s.stream.key, offset: s.stream.dropped, modified: table.modifiedVersion };
    }
    if (s.field === undefined) return undefined;
    if (s.x !== table.numbers(x as never) || s.y !== table.numbers(s.field as never))
      return undefined;
    let byX = streamKeys.get(table);
    if (!byX) {
      byX = new Map();
      streamKeys.set(table, byX);
    }
    let byY = byX.get(x);
    if (!byY) {
      byY = new Map();
      byX.set(x, byY);
    }
    let key = byY.get(s.field);
    if (!key) {
      key = {};
      byY.set(s.field, key);
    }
    return { key, offset: table.rowOffset, modified: table.modifiedVersion };
  }

  /**
   * The y value (or category) and the values of the fields encoded as size,
   * color, opacity, and shape.
   */
  pointText(s: Series, row: number, format: AxisFormat): string {
    let text = format.y(valueAt(s, row));
    for (const field of [this.#sizeField, this.#toneField, this.#opacityField]) {
      if (field === undefined) continue;
      text += `, ${field} ${format.value(this.table.numbers(field as never)[row]!)}`;
    }
    return text + (s.features?.points?.text(row, format.value) ?? "");
  }

  /** The color a row's point is drawn in: its series', or from the `color` field. */
  pointColor(s: Series, row: number, theme: Theme, paint: PaintReader): string {
    const looks = s.features?.points;
    if (looks?.color) return looks.colors[looks.color(row)] ?? s.color;
    if (this.#toneField === undefined) return s.color;
    return (
      this.#colorScale(theme, paint)?.color(this.table.numbers(this.#toneField as never)[row]!) ??
      s.color
    );
  }

  paintsOver(
    series: readonly Series[],
    s: Series,
    frame: Frame,
  ): (a: number, b: number) => boolean {
    // Colors and highlights are read at the first tie: most pointers meet none.
    let toneOf: ((row: number) => number) | undefined | null = null;
    let lit: Uint8Array | undefined | null = null;
    return (a, b) => {
      const [rowA, rowB] = [rowOf(s, a), rowOf(s, b)];
      // Highlighted rows paint over the others, dimmed: translucent, in row order.
      if (lit === null) lit = frame.highlighted?.(this.table);
      if (lit && lit[rowA] !== lit[rowB]) return lit[rowA]! > lit[rowB]!;
      if (lit && !lit[rowA]) return a > b;
      if (toneOf === null) toneOf = this.#paintedTone(this.#encoding(frame, looksOf(series)));
      const [first, second] = toneOf ? [toneOf(rowA), toneOf(rowB)] : [0, 0];
      return first !== second ? first > second : a > b;
    };
  }

  /** How far a row's point reaches from its center, in pixels; NaN when it is not drawn. */
  reach(row: number, s: Series): number {
    return this.#reach(row, this.#radiusScale(), s.features?.points);
  }

  /** Whether a row is drawn: rows missing a value they encode, or sized to nothing, are not. */
  shows(s: Series, row: number): boolean {
    return this.reach(row, s) > 0;
  }

  #drawn(row: number, looks: PointLooks | undefined): boolean {
    const finite = (field: string | undefined) =>
      field === undefined || Number.isFinite(this.table.numbers(field as never)[row]);
    return (
      finite(this.#sizeField) &&
      finite(this.#toneField) &&
      finite(this.#opacityField) &&
      (looks?.color?.(row) ?? 0) >= 0 &&
      !Number.isNaN(looks?.opacity?.(row))
    );
  }

  /**
   * How many points are drawn and over what values: on category y, in how
   * many categories and over what x. Rows without a category, a position, or
   * a value they encode are not drawn, so not counted; points on numeric axes
   * that encode no field take the chart's sentence.
   */
  summarize(
    parts: readonly Series[],
    name: string,
    { format, bands, locale }: SummaryContext,
  ): string | undefined {
    const { x: bandX, y: bandY } = this.#banded;
    // Points of no encoded field are drawn wherever they are placed.
    const looks = looksOf(parts);
    const encodes =
      !!looks ||
      [this.#sizeField, this.#toneField, this.#opacityField].some((field) => field !== undefined);
    if (!bandX && !bandY && !encodes) return undefined;
    const radiusOf = this.#radiusScale();
    // Parts hold the chart's band indices, which panels may place apart.
    const used = new Uint8Array(bandY ? (bands.y?.keys.length ?? 0) : 0);
    let [points, categories, low, high] = [0, 0, Infinity, -Infinity];
    // The last value is a part's last drawn point (a view's rows may run in
    // any order), of the part whose last point is the table's latest row.
    let [last, lastRow] = [Number.NaN, -1];
    for (const s of parts) {
      let [partLast, partRow] = [Number.NaN, -1];
      for (let k = 0; k < s.length; k++) {
        const row = rowOf(s, k);
        const x = s.x[row]!;
        const y = s.y[row]!;
        const placed =
          (bandX ? x >= 0 : Number.isFinite(x)) && (bandY ? y >= 0 : Number.isFinite(y));
        if (!placed || (encodes && !(this.#reach(row, radiusOf, looks) > 0))) continue;
        points++;
        if (bandY && !used[y]) {
          used[y] = 1;
          categories++;
        }
        // The value along the axis of values: y, or x along category y.
        const value = bandY ? x : y;
        if (value < low) low = value;
        if (value > high) high = value;
        partLast = value;
        partRow = row;
      }
      if (partRow > lastRow) [last, lastRow] = [partLast, partRow];
    }
    if (points === 0) return `${name}: no data`;
    const count = `${points} point${points === 1 ? "" : "s"}`;
    // Numbers read as the chart's sentence reads them; along category x, as tooltips do.
    const value = bandX ? format.value : (v: number) => formatNumber(v, locale);
    if (!bandY)
      return `${name}: ${count}, from ${value(low)} to ${value(high)}, last ${value(last)}`;
    const among = `${count} in ${categories} ${categories === 1 ? "category" : "categories"}`;
    return bandX
      ? `${name}: ${among}`
      : `${name}: ${among}, x from ${format.x(low)} to ${format.x(high)}`;
  }

  /**
   * Rows of a series drawn within what the mark is cut to, widened by how
   * far points reach past it; all on category x.
   */
  #visible(s: Series, frame: Frame): [number, number] {
    if (this.#banded.x) return [0, s.length];
    const box = this.#bounds(frame);
    const reach = this.inset?.x ?? s.features?.points?.reach ?? 0;
    return visibleRange(
      s,
      frame.x.invert(box.x - reach),
      frame.x.invert(box.x + box.width + reach),
    );
  }

  /** Where the mark's points show: in its plot, or for a mark not cut to it, the chart. */
  #bounds(frame: Frame): Rect {
    const { clip } = this.spec;
    return clip === undefined || clip === "plot" ? frame.plot : (frame.chart ?? frame.plot);
  }

  /** How far a row's point and outline reach from its center, in pixels; NaN when it is not drawn. */
  #reach(
    row: number,
    radiusOf: ((value: number) => number) | undefined,
    looks: PointLooks | undefined,
  ): number {
    if (!this.#drawn(row, looks)) return Number.NaN;
    const r = radiusOf
      ? radiusOf(this.table.numbers(this.#sizeField as never)[row]!)
      : looks?.area
        ? Math.sqrt(looks.area(row) / Math.PI)
        : this.#radius;
    const shape = looks?.shape ? looks.shape(row) : SYMBOLS.indexOf(this.#symbol);
    return r > 0 && shape >= 0 ? r * this.#reaches[shape]! + this.#ringWidth / 2 : Number.NaN;
  }

  /** Where a row is drawn, from where its values place it: spread across its band. */
  displace(s: Series, row: number, frame: Frame): readonly [number, number] {
    const spread = this.#spread;
    if (!spread) return STILL;
    const shift = this.#shift(s, row, frame);
    return spread.axis === "x" ? [shift, 0] : [0, shift];
  }

  /** Rows spread within their bands: at most half a band off their places. */
  maxDisplacement(_s: Series, frame: Frame): number {
    return this.#spread?.axis === "x" ? Math.abs(frame.x.bandwidth ?? 0) / 2 : 0;
  }

  /** How rows are placed in pixels: through their bands' places, spread as `dodge` and `jitter` say. */
  #placer(): Place {
    if (!this.#banded.x && !this.#banded.y) return place;
    const spread = this.#spread;
    if (!spread) return placeBanded;
    const along = spread.axis === "x" ? 0 : 1;
    // Culled where spreading puts them: an offset band's rows may be spread into view.
    return (s, row, frame, reach, box) => {
      const at = bandedPixel(s, row, frame);
      if (!at) return undefined;
      at[along] += this.#shift(s, row, frame);
      return shows(at[0], at[1], reach, box) ? at : undefined;
    };
  }

  /** How far a row stands from its band's center along the banded axis, in pixels. */
  #shift(s: Series, row: number, frame: Frame): number {
    const spread = this.#spread!;
    const band = spread.axis === "x" ? frame.x : frame.y;
    const { center, width } = spread.shares.of(s, band.bandwidth ?? 0);
    // A swarm's offsets are its panel's last layout, which geometry made.
    if (this.#swarms) {
      const layout = this.#swarms.last(frame);
      return center + (layout ? offsetOf(layout, row) : 0);
    }
    const jitter = this.spec.jitter;
    if (!jitter) return center;
    const unit = jitterOf(this.table.identity(row), jitter.seed ?? 0);
    return center + (unit - 0.5) * jitter.width * width;
  }

  /**
   * Nearest drawn point to a pixel position, through a grid index per series.
   * The index covers every visible point (not only those kept by sampling),
   * so the tooltip reports a real row. Of points tying with the nearest,
   * the one painted over the others (see `Nearest`).
   */
  pick(series: readonly Series[], px: number, py: number, frame: Frame): Hit | undefined {
    return settle((found) => this.nearby(series, px, py, frame, found));
  }

  /** Hands `found` each drawn point within its limit of a pixel position, in paint order. */
  nearby(series: readonly Series[], px: number, py: number, frame: Frame, found: Nearest): void {
    let indexes = this.#indexes.get(frame);
    if (!indexes) {
      indexes = new Map();
      this.#indexes.set(frame, indexes);
    }
    const radiusOf = this.#radiusScale();
    const placeRow = this.#placer();
    const lit = frame.highlighted?.(this.table);
    for (const s of series) {
      if (frame.hidden.has(s.key)) continue;
      let index = indexes.get(s.key);
      if (!index) {
        index = buildIndex(
          s,
          frame,
          this.#visible(s, frame),
          this.#bounds(frame),
          placeRow,
          (row) => this.#reach(row, radiusOf, s.features?.points),
        );
        indexes.set(s.key, index);
      }
      const over = this.paintsOver(series, s, frame);
      index.visit(px, py, {
        get limit() {
          return found.limit;
        },
        take: (position, distance) =>
          found.take({ series: s, position, distance }, this, lit?.[rowOf(s, position)] ?? 0, over),
      });
    }
  }
}

/**
 * A point's channel as its options give it (`given`: in `encode`, else as
 * an option of its own), and who reads it: the mark, a number field it
 * maps itself (`own`: a color ramp, sizes by area, opacities) or a
 * constant, or the feature compiler (`compiled`).
 */
interface PointChannelOf<V> {
  readonly given: unknown;
  readonly own?: string | undefined;
  readonly compiled?: PointChannel<V> | undefined;
}

/** Refuses a channel set as option `flat` and in `encode` as `name`. */
function refuseBoth(options: object, flat: string, name: string): void {
  if ((options as Record<string, unknown>)[flat] !== undefined)
    throw new ChartError({
      code: "invalid-option",
      path: `encode.${name}`,
      message: `point encode.${name}: set as ${flat} and as encode.${name}; give one`,
    });
}

/**
 * Sorts a point's channels by who reads them (see `PointChannelOf`),
 * checking the fields they name and the constants they give: colors as
 * text, as the validator does, since the chart reads them as it draws.
 */
function pointChannels(spec: Frozen<PointSpec>, table: Table) {
  const encode = (spec.encode ?? {}) as Record<string, unknown>;
  const options = spec as unknown as Record<string, unknown>;
  const channel = <V>(
    name: ChannelName,
    flat: string,
    channels: readonly string[],
    numbers: boolean,
  ): PointChannelOf<V> => {
    const own = channels.find((c) => encode[c] !== undefined);
    if (own) refuseBoth(options, own === name ? flat : own, own);
    const path = own ? `encode.${own}` : flat;
    const given = own ? encode[own] : options[flat];
    if (typeof given === "string") {
      if (name === "symbol" && SYMBOLS.includes(given as SymbolName)) {
        if (table.has(given))
          throw new Error(
            `point symbol: "${given}" names both a shape and a field; give { field: "${given}" } to encode the field`,
          );
        return { given };
      }
      if (name === "symbol" && !table.has(given))
        throw new RangeError(
          `point symbol: no shape or field "${given}"; name a category field or one of ${SYMBOLS.map((s) => `"${s}"`).join(", ")}`,
        );
      requireField(table, given, numbers ? NUMERIC : POSITION, `point ${path}`);
      return table.kind(given) === "category"
        ? { given, compiled: { spec: { field: given }, path } }
        : { given, own: given };
    }
    if (typeof given !== "object" || given === null) return { given };
    const c = given as ChannelSpec<V> & { field?: string; scale?: unknown };
    for (const [key, value] of "value" in c
      ? [["value", c.value]]
      : "condition" in c
        ? [
            ["condition.then", c.condition.then],
            ["condition.otherwise", c.condition.otherwise],
          ]
        : []) {
      const problem = outputProblem(name, value, () => true);
      if (problem)
        throw new ChartError({
          code: "invalid-option",
          path: `${path}.${key}`,
          message: `point ${path}.${key}: expected ${problem}; received ${JSON.stringify(value)}`,
        });
    }
    if (c.field !== undefined) {
      requireField(table, c.field, POSITION, `point ${path}.field`);
      // A number field without a scale is mapped as its name is.
      if (c.scale === undefined && table.kind(c.field) !== "category" && name !== "symbol")
        return { given, own: c.field };
    }
    return { given, compiled: { spec: c, path } };
  };
  const color = channel<string>("color", "color", ["fill", "color"], false);
  return {
    // A fill set flat wins over the color, as a line's stroke and a bar's fill do.
    color: spec.fill === undefined ? color : { given: undefined },
    size: channel<number>("size", "size", ["size"], true),
    opacity: channel<number>("opacity", "fillOpacity", ["opacity"], true),
    symbol: channel<SymbolName>("symbol", "symbol", ["symbol"], false),
  };
}

/** Whether a point at (px, py) reaching `reach` pixels from it shows in `box`, what its mark is cut to. */
function shows(px: number, py: number, reach: number, box: Rect): boolean {
  return (
    px >= box.x - reach &&
    px <= box.x + box.width + reach &&
    py >= box.y - reach &&
    py <= box.y + box.height + reach
  );
}

/**
 * How a row of a series is placed: `place` at its x and y, or `placeBanded`
 * for points in bands. Declared functions, not constants: calls through a
 * constant cost dense scatters about a twentieth of their scene.
 */
type Place = typeof place;

function place(
  s: Series,
  row: number,
  frame: Frame,
  reach: number,
  box: Rect,
): [number, number] | undefined {
  // Culled before a place is made: placing is most of a dense scatter's time.
  // Points inside an axis break are not drawn.
  const x = s.x[row]!;
  if (frame.x.breaks?.hides(x)) return undefined;
  const px = frame.x.map(x);
  const py = frame.y.map(s.y[row]!);
  if (!(Number.isFinite(px) && Number.isFinite(py) && shows(px, py, reach, box))) return undefined;
  return [px, py];
}

function placeBanded(
  s: Series,
  row: number,
  frame: Frame,
  reach: number,
  box: Rect,
): [number, number] | undefined {
  const at = bandedPixel(s, row, frame);
  return at && shows(at[0], at[1], reach, box) ? at : undefined;
}

/**
 * Where a row in bands is drawn, before culling: its categories read at
 * their panel's places (a band index of -1 is a missing one); undefined
 * for a missing value, or one in an axis break.
 */
function bandedPixel(s: Series, row: number, frame: Frame): [number, number] | undefined {
  const x = placeAt(s, "x", row);
  const y = placeAt(s, "y", row);
  if ((x < 0 && frame.x.type === "band") || (y < 0 && frame.y.type === "band")) return undefined;
  if (frame.x.breaks?.hides(x)) return undefined;
  const px = frame.x.map(x);
  const py = frame.y.map(y);
  return Number.isFinite(px) && Number.isFinite(py) ? [px, py] : undefined;
}

/**
 * [min, max] of a series' `axis` values (with `log`, positive ones) at rows
 * with a category on the other axis: rows without one are not drawn.
 */
function bandedExtent(s: Series, axis: "x" | "y", log: boolean): [number, number] | undefined {
  const [values, bands] = axis === "x" ? [s.x, s.y] : [s.y, s.x];
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < s.length; k++) {
    const row = rowOf(s, k);
    const value = values[row]!;
    if (bands[row]! < 0 || !Number.isFinite(value) || (log && value <= 0)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? [min, max] : undefined;
}

/** A grid index of the rows in [start, end) whose points reach into `box`. */
function buildIndex(
  s: Series,
  frame: Frame,
  [start, end]: [number, number],
  box: Rect,
  placeRow: Place,
  reachOf: (row: number) => number,
): GridIndex {
  const coords = new Float32Array((end - start) * 2);
  const ids = new Uint32Array(end - start);
  let count = 0;
  for (let k = start; k < end; k++) {
    const row = rowOf(s, k);
    const reach = reachOf(row);
    const placed = reach >= 0 ? placeRow(s, row, frame, reach, box) : undefined;
    if (!placed) continue;
    coords[count * 2] = placed[0];
    coords[count * 2 + 1] = placed[1];
    ids[count] = k;
    count++;
  }
  return new GridIndex(coords, ids, count, box);
}

/**
 * Points at (x, y): scatter plots.
 *
 * ```ts
 * point(cars, { x: "weight", y: "mpg", series: "origin" })
 * ```
 */
/**
 * Points at x and y. Over a `RowView`, the points of the view's rows only,
 * read from its table without a copy, and following the view as it changes.
 */
export function point<S extends Schema>(
  data: Table<S> | RowView<S>,
  options: PointOptions<S>,
): ChartMark<Frozen<PointSpec>> {
  const view = isRowView(data) ? data : undefined;
  const table = view ? view.source : (data as Table<S>);
  // A radius or a size, as the options' types allow; the mark refuses both from others.
  const spec = {
    type: "point",
    x: options.x,
    y: options.y,
    ...definedFields(options, [
      "tooltip",
      "series",
      "itemKey",
      "radius",
      "size",
      "fill",
      "fillOpacity",
      "stroke",
      "strokeWidth",
      "color",
      "colorMidpoint",
      "sampling",
      "dodge",
      "swarm",
      "zIndex",
      "encode",
      "label",
      "legend",
      "id",
      "axis",
      "facet",
      "panel",
      "clip",
    ]),
    ...(options.radiusRange && {
      radiusRange: [options.radiusRange[0], options.radiusRange[1]] as const,
    }),
  } as unknown as PointSpec;
  // Specs name symbol fields as { field }, so a reader never mistakes one for a shape.
  const { symbol } = options;
  if (typeof symbol === "object") spec.symbol = symbol as ChannelSpec<SymbolName>;
  else if (symbol !== undefined)
    spec.symbol =
      SYMBOLS.includes(symbol as SymbolName) || !table.has(symbol) ? symbol : { field: symbol };
  if (options.colors) spec.colors = [...options.colors];
  if (options.colorDomain) spec.colorDomain = [options.colorDomain[0], options.colorDomain[1]];
  if (options.jitter) spec.jitter = { ...options.jitter };
  if (table.name !== undefined) spec.data = table.name;
  // Field names were checked against S above; marks work on the erased schema.
  return new PointMark(spec, table as unknown as Table, view as unknown as RowView | undefined);
}

/** A shape for legends, about as large as the 10-pixel swatch, and how far it reaches. */
function legendGlyph(symbol: SymbolName): { glyph: string; reach: number } {
  const reach = symbolReach(symbol);
  const r = Math.min(LEGEND_RADIUS, LEGEND_REACH / reach);
  return { glyph: symbolPath(symbol, 0, 0, r), reach: r * reach };
}

/** What points' channels give rows, which every series of the mark shares (see the feature compiler). */
function looksOf(series: readonly Series[]): PointLooks | undefined {
  return series[0]?.features?.points;
}
