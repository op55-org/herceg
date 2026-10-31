import { type FieldKind, type NumericArray, UNTYPED } from "../data/column.ts";
import type { RowView } from "../data/row-view.ts";
import type { Schema, Table } from "../data/table.ts";
import type { Formatter } from "../format/format.ts";
import { formatNumber, timeTickLabels } from "../format/format.ts";
import type { TimeZone } from "../format/zone.ts";
import type { MeasureText } from "../layout/text.ts";
import type { Breaks } from "../lod/m4.ts";
import type { Polyline } from "../lod/polyline.ts";
import type { clearDomain } from "../model/clearance.ts";
import type { CompiledFeatures } from "../model/features.ts";
import { keyPrefix } from "../model/identity.ts";
import type { MarkSeries } from "../model/inspect.ts";
import type { LocalGroup } from "../model/items.ts";
import type { LegendPart } from "../model/legend.ts";
import type { Nearest } from "../model/nearest.ts";
import type { PositionScale } from "../scale/scale.ts";
import { TIME_UNIT_MS, type TimeUnit } from "../scale/time.ts";
import type { Geometry, Rect } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { Clip, Frozen, MarkTooltipSpec } from "../spec/spec.ts";
import type { PaintReader, Theme } from "../theme.ts";
import type { DrawnMark, DrawnPart, PartBuilders, PickedItem, PickQuery } from "./drawn.ts";
import type { ContentWriter } from "./features/content.ts";
import type { RowBindings } from "./row-bindings.ts";
import { type MarkRows, rowAt, rowCount } from "./rows.ts";
import { isSortedSubset, rowsByCode, type Series, type SeriesStream } from "./series.ts";
import type { SplitRows } from "./split.ts";

/**
 * How opaque rows a chart's selection leaves out are drawn when it
 * highlights the rows it holds, as a fraction of their own opacity.
 */
export const DIM = 0.25;

/**
 * Whether a mark with a selection highlighted draws every series' selected
 * rows over every series' others, as marks of a glyph per row do; lines
 * and areas draw each series' over its own (model/highlight.ts).
 */
export function litOverSeries(mark: Mark): boolean {
  const { type } = mark.spec;
  return type !== "line" && type !== "area";
}

/**
 * Identifies a mark within a chart: its explicit `id`, or its index. Series
 * keys combine it with the series' source as JSON, so no pair of mark and
 * series names can produce the same key.
 */
export type MarkKey = string | number;

export function seriesKey(mark: MarkKey, source: string): string {
  return JSON.stringify([mark, source]);
}

/**
 * The identity of the mark a series or item key belongs to: keys are JSON
 * arrays that start with it, or objects (groups of networks, maps, and 3D
 * points) that hold it as `mark`. Undefined for any other string.
 */
export function keyOwner(key: string): MarkKey | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(key);
  } catch {
    return undefined;
  }
  const owner = Array.isArray(parsed) ? parsed[0] : (parsed as { mark?: unknown } | null)?.mark;
  return typeof owner === "string" || typeof owner === "number" ? owner : undefined;
}

/**
 * Whether an existing series, item, or identity key still belongs to the
 * chart: a key of a mark it still has (`owners`), or an identity key whose
 * scope one of its marks still draws (`scopes`, their prefixes, see
 * model/identity.ts).
 */
export function keepsKey(
  key: string,
  owners: ReadonlySet<MarkKey>,
  scopes: ReadonlySet<string>,
): boolean {
  const prefix = keyPrefix(key);
  if (prefix !== undefined) return scopes.has(prefix);
  const owner = keyOwner(key);
  return owner !== undefined && owners.has(owner);
}

/**
 * Color for a series key. A chart assigns each series' identity (see
 * model/identity.ts) a palette slot the first time it appears and keeps it,
 * so colors follow what series stand for, not their order. Marks pass the
 * series' `label` too; the feature compiler, the identity key a series
 * stands for where it names one (`entry`). An explicit `color` still
 * registers the series but takes no palette slot.
 */
export type Palette = (seriesKey: string, label?: string, color?: string, entry?: string) => string;

/** The band axes' bands, in index order. */
export interface Bands {
  x?: BandList | undefined;
  y?: BandList | undefined;
}

/** Settings marks need to label categories made from numbers and times. */
export interface BandContext {
  zone: TimeZone;
  locale: string | undefined;
  theme: Theme;
  /** Reads the colors marks' options give, as renderers read them (see `PaintReader`). */
  paint: PaintReader;
  /** The marks' compiled features, when the chart draws any (see model/features.ts). */
  features?: CompiledFeatures | undefined;
}

/**
 * What a chart highlighting a selection lends a mark drawing it (see
 * `Mark.selectedGeometry`): which rows are selected, and the mark's own
 * geometry of parts of its series, drawn dimmed or as they are under keys
 * of their own, hidden as their series are and in their series' slots.
 */
export interface SelectionDrawing {
  /** Which of the mark's table's rows the selection holds, 1 each, by position. */
  readonly selected: Uint8Array;
  /** The mark's geometry of `parts` (each standing for the drawn series of its key) dimmed. */
  dimmed(parts: readonly Series[]): Geometry[];
  /** The mark's geometry of `parts`, as drawn, for over the dimmed. */
  lit(parts: readonly Series[]): Geometry[];
  /** A geometry dimmed, for geometry the mark makes itself: one or two (an area's fill and outline). */
  dim(geometry: Geometry): Geometry[];
  /**
   * For marks of cells (heatmaps, 2D histograms): a square in each of
   * `cells` covering its share of the cell, in its color, keyed from `key`;
   * undefined when the cells are too small or too many hold selected rows
   * for squares, for the mark to draw an image of those cells instead.
   */
  squares(cells: CellShares, key: string): Geometry[] | undefined;
}

/** A mark's cells as `SelectionDrawing.squares` draws a selection's share of each. */
export interface CellShares {
  /** How many cells there are, and how many of them hold selected rows. */
  count: number;
  held: number;
  /** The fewest pixels any cell spans across and down. */
  size: readonly [number, number];
  /** A cell's corners in pixels: x0, y0, x1, y1. */
  box(cell: number): readonly [number, number, number, number];
  /** The share of a cell its selected rows are, from 0 to 1. */
  share(cell: number): number;
  color(cell: number): string;
}

/** Everything a mark needs to produce geometry for one frame. */
export interface Frame {
  x: PositionScale;
  y: PositionScale;
  plot: Rect;
  pixelRatio: number;
  /** Pixels per CSS pixel of images (heatmap rasters): the pixel ratio, or more for static output. */
  rasterRatio: number;
  theme: Theme;
  /** Reads the colors the mark's options give, as renderers read them (see `PaintReader`). */
  paint: PaintReader;
  /** `style` (a label's) with its colors and font read as `paint` reads colors, `path` naming it. */
  read: <T extends object>(style: T, path: string) => T;
  /** What the plot draws on, for halos: its fill, or the chart's background when absent. */
  surface?: string | undefined;
  /** Locale for numbers the mark formats as text; undefined uses the runtime's. */
  locale: string | undefined;
  hidden: ReadonlySet<string>;
  /** Scene-owned series before panel splits, from which dodging marks make partitions' rosters. */
  groupSeries?: readonly [series: readonly MarkSeries[], hidden: ReadonlySet<string>] | undefined;
  /** The chart drawing this frame, for caches that count each chart's redraws. */
  owner: object;
  /** The panel's key, which labels following series name (marks/attachments.ts). */
  panel?: string | undefined;
  /** The owner's count of scenes drawn; the panels of one scene share it. */
  scene: number;
  /** Large point series may be left to a GPU painter as clouds. */
  clouds: boolean;
  /** Text widths for the chart's fonts, as its axes measure them. */
  measure: MeasureText;
  /** The marks' compiled features, when the chart draws any (see model/features.ts). */
  features?: CompiledFeatures | undefined;
  /** The chart's box, for places in its frame. */
  chart?: Rect | undefined;
  /** The chart's position scales of its own along x or y over this plot, where it has any. */
  scaleOf?: ((name: string, axis: "x" | "y") => PositionScale) | undefined;
  /**
   * Where marks' labels outside the plot go: the x where those on the left
   * end and those on the right start, in the tracks the chart keeps for
   * them (`Mark.room`) beside its first and last columns, else beyond the
   * panel's y labels.
   */
  outside?: readonly [left: number, right: number] | undefined;
  /**
   * The chart animates changed values: bars say what identifies each and
   * where it ends (BarItems), points the row each shows (PointItems).
   */
  keyed?: boolean;
  /**
   * With a selection highlighted, which of `table`'s rows it holds, 1 each:
   * drawn over the others (model/highlight.ts), so that of points equally
   * near, picking takes those.
   */
  highlighted?: ((table: Table) => Uint8Array | undefined) | undefined;
  /**
   * A polyline buffer reused across frames, one per series key and stage
   * (for example "line", "upper", "upper-step").
   */
  polyline(seriesKey: string, stage: string): Polyline;
  /** A Float32Array of at least `length` items, reused across frames. */
  floats(seriesKey: string, stage: string, length: number): Float32Array;
  /** A Float64Array of at least `length` items, reused across frames. */
  doubles(seriesKey: string, stage: string, length: number): Float64Array;
  /** A byte array of at least `length` items, reused across frames. */
  bytes(seriesKey: string, stage: string, length: number): Uint8ClampedArray<ArrayBuffer>;
}

/**
 * A buffer of at least `length` table rows for series `seriesKey`'s
 * `stage`, reused across frames: its pooled floats, read as 32-bit
 * integers.
 */
export function rowBuffer(
  frame: Frame,
  seriesKey: string,
  stage: string,
  length: number,
): Uint32Array {
  const floats = frame.floats(seriesKey, stage, length);
  return new Uint32Array(floats.buffer, floats.byteOffset, floats.length);
}

/** What a mark's summary sentence is written with. */
export interface SummaryContext {
  format: AxisFormat;
  locale: string | undefined;
  log: boolean;
  /**
   * The chart's bands, which band indices in series name: summaries read
   * series' parts across panels, whose own categories place them apart.
   */
  bands: Bands;
}

/** How the chart formats single x and y values, as in tooltips. */
export interface AxisFormat {
  x: (value: number) => string;
  y: (value: number) => string;
  /** Other numbers, such as values of fields a mark encodes as size or color. */
  value: (value: number) => string;
  /** How the mark's labels of parts (`content`) are written (`MarkFeatures.content`). */
  content?: ContentWriter | undefined;
}

/**
 * Rows of a mark's table, in parts that are never copied together: what a
 * panel, or a group of panels, draws of a mark that reads its table's rows
 * without series (annotations split by facets). Undefined means every row.
 */
export type RowParts = readonly Uint32Array[];

/** A point found by a mark's own lookup: series, position in it, pixel distance. */
export interface Hit {
  series: Series;
  position: number;
  distance: number;
  /**
   * Where the pointer found it, for points that are lines or regions (a
   * contour's): its inspection is there, rather than at the point's anchor.
   */
  at?: readonly [number, number] | undefined;
}

/** A continuous color scale a mark uses, for the chart's color legend. */
export interface ColorRamp {
  stops: readonly string[];
  domain: readonly [number, number];
  title: string;
  /** The value at the ramp's middle, for diverging ramps. */
  midpoint?: number | undefined;
}

/**
 * A legend of the point sizes, shapes, or category colors a mark encodes by
 * field: each glyph is SVG path data centered on (0, 0), reaching `r` pixels
 * from its center, in `color` or else the theme's muted color.
 */
export interface GlyphKey {
  title: string;
  /** What the glyphs vary in, for the chart's text alternative. */
  channel: "size" | "shape" | "color";
  /** The scale of categories mapping the values, which legends include by name. */
  scale?: string | undefined;
  /** For shapes, `shape` is the symbol's name. */
  entries: { label: string; glyph: string; r: number; shape?: string; color?: string }[];
}

/**
 * What charts read from any mark's spec: its type and identity. Built-in
 * marks have portable specs (`MarkSpec`); custom marks only this.
 */
export interface MarkIdentity {
  readonly type: string;
  readonly id?: string | undefined;
  /** The y axis the mark's values are on; "left" when absent. */
  readonly axis?: "left" | "right" | undefined;
  /** "repeat" draws all of the mark's rows in every panel of a faceted chart. */
  readonly facet?: "repeat" | undefined;
  /** In a chart with panels, the panel the mark draws in, or "*" for every one. */
  readonly panel?: string | undefined;
  /** What the mark's drawing is cut to; data to the plot, labels and text not at all, when absent. */
  readonly clip?: Clip | undefined;
  /** `false` leaves the mark out of the chart's legends; `true` lists an annotation. */
  readonly legend?: boolean | undefined;
  /** What tooltips show of the rows of marks whose points are rows, besides their values. */
  readonly tooltip?: Frozen<MarkTooltipSpec> | undefined;
  /** Where the mark is drawn among the others of its panel (see `MarkBase.zIndex`). */
  readonly zIndex?: number | undefined;
  /** `false`: the pointer passes through the mark (see `MarkBase.pick`). */
  readonly pick?: boolean | undefined;
  /** `false`: tooltips, hover, and the keyboard leave the mark out (see `MarkBase.inspect`). */
  readonly inspect?: boolean | undefined;
}

/** A scale of a mark that guides may name (see `Mark.legendScales`). */
export type LegendScale = "series" | "ramp" | "key" | "size" | "symbol";

/** What a mark's series stand for (see `Mark.identity`). */
export interface MarkSources {
  readonly field?: string | undefined;
  readonly values: readonly string[];
}

/**
 * Brands the marks herceg's mark functions make. It exists only in types,
 * so an object written by hand is not a `ChartMark`.
 */
export declare const MARK: unique symbol;

/**
 * A mark as charts take it, made by a mark function (`line`, `bar`,
 * `custom`, and the others). Its `spec` says what it draws: for built-in
 * marks the portable spec, for custom marks their identity. How marks draw
 * is the engine's own; `custom` draws shapes of your own.
 */
export interface ChartMark<S extends MarkIdentity = MarkIdentity> {
  readonly spec: S;
  readonly [MARK]: true;
}

/**
 * A mark along axes, as the chart model draws it: one visual layer. It
 * pairs a portable spec with the table it reads (if any) and holds caches
 * that depend only on the data, so the same mark can be shown by several
 * charts. Internal: applications make marks with the mark functions.
 */
export interface Mark<S extends MarkIdentity = MarkIdentity> extends ChartMark<S> {
  readonly table: Table | undefined;
  /** The view of `table` whose rows the mark shows, when it shows only some, in its order. */
  readonly view?: RowView | undefined;
  /**
   * For marks drawing series of a table: the rows they read now, through
   * which every read of the table goes (marks/rows.ts).
   */
  rows?(): MarkRows;
  /**
   * Kind of the field on a position channel. "category" puts the axis on a
   * band scale; "time" makes it a time axis.
   */
  channelKind(axis: "x" | "y"): FieldKind | undefined;
  /**
   * Bands this mark places on a band axis, in order. Its series hold chart
   * band indices, which it reads through their places (`placeAt`) where a
   * panel holds only some of the bands.
   */
  bands?(axis: "x" | "y", context: BandContext): BandList | undefined;
  /**
   * Marks that place whole-table bands without series: retain each panel's
   * resolved lists for geometry. These marks contribute their declared bands
   * to panel categories even without series rows.
   */
  resolveBands?(bands: Bands): void;
  /** Gap between bands, as a fraction of each band's step. */
  readonly bandPadding?: number;
  /**
   * The mark's options need the feature compiler (see model/features.ts):
   * channels, styles by value, markers, continuity.
   */
  readonly featured?: boolean;
  /**
   * What the mark's series stand for, for their colors and legend entries
   * (see model/identity.ts): the values of the category field splitting
   * its rows into series (`field`), or without one, the value fields its
   * series read (`values`), by the series' names. Undefined for marks
   * whose series stand for neither (contours, heatmaps, annotations).
   */
  readonly identity?: MarkSources | undefined;
  /**
   * The scales of the mark a legend or colorbar may name (`{ mark, channel
   * }`), by its options, whatever its rows hold now: its series' colors, a
   * color ramp (which colorbars show) or key of colors, and keys of sizes
   * and symbols. By default, its series' colors where it has an identity.
   */
  readonly legendScales?: readonly LegendScale[];
  /**
   * Pixels the mark's glyphs reach past their data position along each
   * axis, such as a point's radius and outline. Automatic padding leaves
   * this much room at the plot edges.
   */
  readonly inset?: { readonly x: number; readonly y: number } | undefined;
  /**
   * Automatic padding's solver (model/clearance.ts), carried by marks that
   * ask for room (`inset`, `headroom`), so charts of others do not load it.
   */
  readonly clearDomain?: typeof clearDomain;
  /**
   * Automatic y domains end at the mark's data rather than at round values
   * unless the axis says `nice` (heatmap cells, which would otherwise leave
   * empty rows at the ends).
   */
  readonly tight?: boolean;
  /**
   * The axis whose automatic domain runs from high to low, so the mark's
   * values grow away from the edge it starts at (a dendrogram's heights,
   * from leaves at the top or right). A domain the axis sets runs as given.
   */
  readonly descends?: "x" | "y" | undefined;
  /**
   * How tooltips find this mark's data. "x", "y", and "point" choose the
   * chart's default mode (along x, along y, or nearest point) when the chart
   * does not set one; "cell" marks always report the cell under the pointer,
   * in every mode.
   */
  readonly tooltip: "x" | "y" | "point" | "cell";
  /**
   * For marks of rows placing them otherwise than plainly on their axes (in
   * a frame, on a scale of the chart's own, or moved by pixels): how, by
   * direction (marks/row-bindings.ts). The chart draws and inspects such a
   * mark with those scales in its frame.
   */
  readonly bound?: RowBindings | undefined;
  /** For annotations: whether a place is on a scale of the chart's own. */
  readonly scaled?: boolean;
  /**
   * For marks placing values on a scale of the chart's own by their places
   * (annotations): the extent of those along `axis` on scale `name`, of
   * `rows` (every row without them); with `log`, of positive values only.
   */
  scaleExtent?(
    name: string,
    axis: "x" | "y",
    log: boolean,
    rows?: RowParts,
  ): readonly [number, number] | undefined;
  /**
   * The series' points summarize rows of the table (histogram bins, box
   * plot groups) rather than being its rows, so inspections name no row.
   */
  readonly summarizes?: boolean;
  /**
   * For marks naming items without `itemKey` by their position (bars): the
   * field of their positions, whose value with their series names each
   * (model/items.ts).
   */
  readonly itemPosition?: string | undefined;
  /**
   * Whether one row draws an item per value field: a series of each field
   * (a line, area, or bar of several fields), which item keys name
   * (model/items.ts). Error bars and range areas, whose fields bound one
   * item, are not wide.
   */
  readonly wide?: boolean;
  /**
   * For marks whose items aggregate rows (bins, boxes, cells, tree nodes):
   * what the item keyed `key` groups by on the mark's table (its position's
   * category or interval, its series' value, its facet's), for provenance
   * and for the rows the key names (model/items.ts); undefined for a key
   * of none of its items.
   */
  groupsOf?(key: string): readonly LocalGroup[] | undefined;
  /**
   * Resolves series for the current data. `key` prefixes series keys,
   * `palette` returns the color for a series key, `hidden` holds keys of
   * series the user hid, and `bands` gives the band axes' categories. With
   * `split`, facets split the series' rows into panels next, and marks that
   * combine rows (stacks) leave that to `stackPanels`; marks that summarize
   * rows return their series without data (keys, labels, and colors), and
   * summarize each panel's rows in `summarizePanels`.
   */
  series(
    key: MarkKey,
    palette: Palette,
    hidden: ReadonlySet<string>,
    bands: Bands,
    context: BandContext,
    split?: boolean,
  ): Series[];
  /**
   * Stacks each panel's series apart, for series resolved with `split`:
   * `panels` holds the mark's series in each panel (split from those
   * `series` returned), whose values it stacks in place. `scope` is the
   * facet planner's identity, stable across redraws and table updates.
   */
  stackPanels?(
    panels: readonly (readonly Series[])[],
    hidden: ReadonlySet<string>,
    scope?: object,
  ): void;
  /**
   * For marks facets split (not summaries), once they are split: `panels`
   * holds the mark's series in each panel, split from `series`, for what
   * depends on every panel together, such as the color domain of a
   * heatmap's summed cells.
   */
  splitPanels?(series: readonly Series[], panels: readonly (readonly Series[])[]): void;
  /**
   * For marks whose series summarize rows (histograms, box plots), resolved
   * with `split`: each panel's series, one per series of `roster` (those
   * `series` returned, whose keys, labels, and colors they keep), from the
   * table rows in each panel (`rows[p]`, ascending). `xGroupOf[p]` is the
   * group of panels sharing panel p's x scale; `yGroupOf[p]` is its y group.
   */
  summarizePanels?(
    roster: readonly Series[],
    rows: readonly Uint32Array[],
    xGroupOf: readonly number[],
    hidden: ReadonlySet<string>,
    bands: Bands,
    context: BandContext,
    yGroupOf: readonly number[],
  ): Series[][];
  /**
   * The axis whose domain includes zero, for marks drawn from a zero
   * baseline: while one of their series is shown, or for marks that draw
   * without series (`seriesless`), whenever they draw.
   */
  readonly zero?: "x" | "y" | undefined;
  /** The mark draws from fields without series (custom marks of fields), whatever the legend hides. */
  readonly seriesless?: boolean;
  /**
   * The mark's extents count toward a domain only where no other mark's do
   * (annotations without `contributeDomain`): an axis of annotations alone
   * still fits them.
   */
  readonly domainFallback?: boolean;
  /**
   * x extent; with `log`, of positive values only. On a time axis with
   * `breaks`, room a mark leaves at the ends is time shown. Marks reading
   * rows without series (annotations) read only `rows`, when given.
   */
  xExtent(
    series: readonly Series[],
    log: boolean,
    breaks?: Breaks,
    rows?: RowParts,
  ): readonly [number, number] | undefined;
  /**
   * y extent of what the x range [x0, x1] shows; with `log`, of positive
   * values only; with x `breaks`, of points they do not hide; for
   * annotations, of `rows` only, when given.
   */
  yExtent(
    series: readonly Series[],
    x0: number,
    x1: number,
    log: boolean,
    breaks?: Breaks,
    rows?: RowParts,
  ): readonly [number, number] | undefined;
  /**
   * The mark's part of the scene. `key` identifies the mark, for marks whose
   * geometry is not keyed by series (annotations), which draw only `rows`
   * when given (a facet panel's).
   */
  geometry(series: readonly Series[], frame: Frame, key: MarkKey, rows?: RowParts): Geometry[];
  /**
   * For marks whose points summarize rows (histogram bins, box plot
   * groups, heatmap cells): the mark's part of the scene while a chart
   * highlights a selection of its table's rows, showing each point's
   * selected rows against the whole (a bin's selected count, the selected
   * rows' own box), drawn through `drawing`. Tooltips read what it found.
   */
  selectedGeometry?(series: readonly Series[], frame: Frame, drawing: SelectionDrawing): Geometry[];
  /**
   * Pixel anchor for a row whose drawing uses only one data axis. Undefined
   * means the row cannot be drawn; the other coordinate comes from the plot.
   */
  place?(series: Series, row: number, frame: Frame): readonly [number, number] | undefined;
  /** Nearest point to a pixel, for marks with a faster lookup than the chart's generic search. */
  pick?(series: readonly Series[], px: number, py: number, frame: Frame): Hit | undefined;
  /**
   * Hands `found` each target within its limit of a pixel, in paint order,
   * for marks with `pick` whose targets tie with others' only to rounding:
   * hover settles them with the other marks' (model/nearest.ts).
   */
  nearby?(series: readonly Series[], px: number, py: number, frame: Frame, found: Nearest): void;
  /**
   * How many pixels along x and y a row is drawn from where its values
   * place it, for marks spreading rows across their bands (grouped bars,
   * `dodge`, `jitter`, side-by-side boxes and violins, split violins'
   * halves), as last drawn: inspections report points where they are.
   */
  displace?(series: Series, row: number, frame: Frame): readonly [number, number];
  /**
   * The most pixels `displace` moves a row of `series` along x, which the
   * nearest-point search allows for before it stops at rows too far along
   * x; Infinity has it read every row.
   */
  maxDisplacement?(series: Series, frame: Frame): number;
  /**
   * How far a row's glyph reaches from its place, in pixels, for marks
   * whose glyphs differ in size (points sized by a field); NaN when the row
   * is not drawn. Clicks that select rows read it.
   */
  reach?(row: number, series: Series): number;
  /**
   * Of two positions of series `s` (one of `series`), whether the first's
   * glyph paints over the second's, for marks whose glyphs do not paint in
   * row order (opaque points of several colors paint color by color).
   * Clicks that select rows read it where glyphs are equally near.
   */
  paintsOver?(
    series: readonly Series[],
    s: Series,
    frame: Frame,
  ): (a: number, b: number) => boolean;
  /**
   * For marks whose points summarize rows (histogram bins, box plot
   * groups): whether a table row is one of those the point at `position`
   * of `series` summarizes, so that selecting the point selects them. Rows
   * of other facet panels are the caller's to leave out.
   */
  summarized?(series: Series, position: number): (row: number) => boolean;
  /**
   * What primitive `index` of `geometry`, which the mark made and `drawn`
   * paints (itself or as copies), stands for, for geometry that does not
   * say it itself (bars and points record their rows): an aggregate's
   * group, an annotation's row, built with `parts` (see drawn-parts.ts).
   * `at` is the point picked, for primitives whose index alone does not
   * say it (a histogram's outline). Undefined for primitives of no item.
   */
  partOf?(
    drawn: DrawnMark,
    geometry: Geometry,
    index: number,
    parts: PartBuilders,
    at?: { x: number; y: number },
  ): DrawnPart | undefined;
  /**
   * The topmost item at `query`, for marks whose own lookup finds it better
   * than geometry by kind (cells, boxes, candles; see `pickedHit`). A picker
   * tests other marks' geometry and asks `partOf`.
   */
  pickItem?(drawn: DrawnMark, query: PickQuery): PickedItem | undefined;
  /**
   * For marks that pair rows of their series (stacks of a series field):
   * the position of `s` to read beside the point of `anchor` at
   * `position`, where the keyboard is, or -1 for none; undefined leaves it
   * to the chart, which reads the first point drawn at the anchor's x.
   */
  alongside?(s: Series, anchor: Series, position: number): number | undefined;
  /**
   * Tooltip text for a row of a series, for marks that show more than one
   * value per point (candlesticks, histogram bins); `format` formats values
   * of the x axis and of the series' y axis. Undefined leaves the chart's.
   */
  pointText?(series: Series, row: number, format: AxisFormat): string | undefined;
  /**
   * What a tooltip names a row's point by, for marks naming it other than
   * by its series (a heatmap's cell by its row, a 2D histogram's by its
   * bins, a contour's band by its field). Undefined leaves the series' name.
   */
  pointLabel?(series: Series, row: number, format: AxisFormat): string | undefined;
  /**
   * The inspected point's pixels for marks that draw a row away from its
   * values altogether (a heatmap cell, at its center); marks that move rows
   * from their values' place (dodge, jitter) say by how much (`displace`).
   */
  pointAnchor?(series: Series, row: number, frame: Frame): readonly [number, number] | undefined;
  /** The color a row is drawn in, for marks coloring rows by a field rather than by series. */
  pointColor?(series: Series, row: number, theme: Theme, paint: PaintReader): string;
  /**
   * The values a row's drawing covers along the axis its values are on,
   * for marks drawing more than their series value (box plots, from
   * whisker to whisker); inspection along y treats rows with any of it in
   * view as visible.
   */
  span?(series: Series, row: number): readonly [number, number];
  /**
   * Whether the mark draws a row on these scales, for marks reading more
   * fields than their series holds (candlesticks, histogram bins' edges);
   * inspection skips rows it does not draw.
   */
  shows?(series: Series, row: number, y: PositionScale, x: PositionScale): boolean;
  /** Series of drawable observations for tooltips and keyboard reading in this frame. */
  readSeries?(series: readonly Series[], frame: Frame): Series[];
  /**
   * For marks the keyboard reads cell by cell (heatmaps): the position of
   * the cell `columns` to the right and `rows` up from the one at
   * `position`, as `frame` draws them, or undefined when there is none; a
   * negative position asks for the first cell.
   */
  stepCell?(
    series: Series,
    position: number,
    columns: number,
    rows: number,
    frame: { x: PositionScale; y: PositionScale },
  ): number | undefined;
  /**
   * The text alternative's sentence for a series, over its parts in every
   * panel, for marks whose values say more than one number (candlesticks,
   * histograms); undefined leaves it to the chart's (points, range, and last
   * value). `context.log` says whether the series' y axis is logarithmic.
   */
  summarize?(parts: readonly Series[], name: string, context: SummaryContext): string | undefined;
  /**
   * A sentence describing what the mark shows, for marks without series
   * (annotations), which the chart's data summary would otherwise leave
   * out: of `rows` only, when given.
   */
  describe?(format: AxisFormat, locale: string | undefined, rows?: RowParts): string | undefined;
  /**
   * Pixels the mark draws past its data at the ends of its value axis (the
   * `zero` axis) that lie away from zero, such as bar labels; automatic
   * padding leaves that much room.
   */
  headroom?(series: readonly Series[], context: BandContext): number;
  /**
   * Whether `room` is what the mark's last geometry placed (labels that
   * follow series): the chart asks right after drawing it in each panel,
   * and keeps what each panel's labels took.
   */
  readonly roomPlaced?: boolean;
  /**
   * Pixels the mark's labels outside the plot take beside it, left and
   * right: the chart keeps a track for them on each side, innermost, beside
   * the y axes (see `Frame.outside`). With `roomPlaced`, what its last
   * geometry's labels took (see layout/attached.ts).
   */
  room?(
    measure: MeasureText,
    theme: Theme,
    locale: string | undefined,
    features: CompiledFeatures | undefined,
  ): [number, number];
  /**
   * How a series appears in the legend: by default, a square of its color.
   * `false` leaves it out, for marks whose series colors mean nothing (heatmaps).
   */
  legendEntry?(
    series: Series,
    theme: Theme,
    paint: PaintReader,
  ): { color: string; glyph?: string; stroke?: string } | false;
  /**
   * Legends of the color scales, sizes, or shapes the mark encodes by field
   * (see legend-parts.ts); `format` writes numbers in the chart's locale.
   */
  legends?(
    series: readonly Series[],
    theme: Theme,
    format: (value: number) => string,
    paint: PaintReader,
  ): LegendPart[];
  /**
   * An annotation's legend entries by its label, as mark `key`: one for
   * constant text, hiding the mark whole, or one per value of its label's
   * field among `rows` (all by default), hiding the rows that hold it
   * (marks/hidden.ts), written as its labels are (`pattern`, the
   * formatter of patterns, as `MarkFeatures.format`).
   */
  labelEntries?(
    key: MarkKey,
    locale: string | undefined,
    rows?: RowParts,
    pattern?: (format: object, locale: string | undefined, path: string) => Formatter,
  ): { key: string; label: string }[];
}

/**
 * Whether a mark places values along y: a y position in its spec or a y
 * field, whatever its data and the view. Vertical rules and custom marks
 * without fields do not.
 */
export function usesY(mark: Mark): boolean {
  const { y, y1, y2 } = mark.spec as { y?: unknown; y1?: unknown; y2?: unknown };
  return y !== undefined || y1 !== undefined || y2 !== undefined || !!mark.channelKind("y");
}

/**
 * The kind of a channel several fields place values on: time when any of
 * them holds times, as an axis is a time axis when any mark's field is.
 */
export function valueKind(table: Table, fields: readonly string[]): "time" | "number" {
  return fields.some((field) => table.kind(field) === "time") ? "time" : "number";
}

/** Throws an invalid-option error at `path` of a `type` mark unless `ok`: a malformed option. */
export function checkOption(
  ok: boolean,
  type: string,
  path: string,
  expected: string,
  value: unknown,
): void {
  if (!ok)
    throw new ChartError({
      code: "invalid-option",
      path,
      message: `${type} ${path}: expected ${expected}; received ${typeof value === "number" ? value : JSON.stringify(value)}`,
    });
}

/** Whether `value` is a length of 0 or more pixels. */
export const isPixels = (value: unknown): boolean =>
  typeof value === "number" && value >= 0 && Number.isFinite(value);

/** Whether `value` lists sides of a rectangle, as `strokeSides` does. */
export const isSides = (value: unknown): boolean =>
  Array.isArray(value) && value.every((side) => ["top", "right", "bottom", "left"].includes(side));

export function requireField(
  table: Table,
  field: string,
  kinds: readonly FieldKind[],
  role: string,
): void {
  const path = role.slice(role.lastIndexOf(" ") + 1);
  if (!table.has(field)) {
    throw new ChartError({
      code: "unknown-field",
      path,
      message: `${role}: no field "${field}"; the table has ${table
        .fields()
        .map((f) => `"${f}"`)
        .join(", ")}`,
    });
  }
  const kind = table.kind(field);
  if (!kinds.includes(kind)) {
    // Categories come from strings or category(), and times (only a heatmap's
    // date takes nothing else) from Dates or time(), so the usual fix is the
    // values' type.
    const fix =
      kinds[0] === "category"
        ? kind === "number" && !table.extent(field)
          ? UNTYPED
          : "; give its values as strings, or numbers wrapped in category()"
        : kinds[0] === "time"
          ? "; give Dates or time() values"
          : kind === "category" && kinds.includes("number")
            ? "; give numbers, not strings"
            : "";
    throw new ChartError({
      code: "field-type",
      path,
      message: `${role}: field "${field}" holds ${kind} values; expected ${kinds.join(" or ")}${fix}`,
    });
  }
}

export const NUMERIC: readonly FieldKind[] = ["number", "time"];
export const CATEGORY: readonly FieldKind[] = ["category"];
const ITEM_KEYS: readonly FieldKind[] = ["number", "time", "category"];

/** Checks a `type` mark's `itemKey`, which names each row's item: a category, number, or time field. */
export function checkItemKey(table: Table, field: string | undefined, type: string): void {
  if (field !== undefined) requireField(table, field, ITEM_KEYS, `${type} itemKey`);
}

/**
 * `checkItemKey` for marks whose data is optional (annotations, custom
 * marks): without data, there are no rows to name.
 */
export function checkOptionalItemKey(
  table: Table | undefined,
  field: string | undefined,
  type: string,
): void {
  if (table) checkItemKey(table, field, type);
  else if (field !== undefined)
    throw new ChartError({
      code: "invalid-option",
      path: "itemKey",
      message: `${type} itemKey: names the rows of the mark's data; give it data, or drop itemKey`,
    });
}

/** One y column per series before colors and keys are assigned. */
export interface SeriesSource {
  id: string;
  label: string;
  y: string;
  rows: Uint32Array | undefined;
  /** x ascends over the source's rows. */
  sorted: boolean;
  /** For rows grouped from a whole table as it streams: see `Series.stream`. */
  stream?: SeriesStream | undefined;
}

/**
 * The field splitting a line's, area's, or bar's rows into series: its
 * `series`, or without one the category field its color names (`color`, a
 * point's color channel's field, or `encode.color`'s), so that `color:
 * "region"` draws a series per region. None with `series: false`, where the
 * mark's own paint (`paint`: a line's stroke, an area's or bar's fill)
 * overrides the color, or where an identity scale of the channel's own reads
 * the field (one of the chart's is refused, in the feature compiler).
 */
export function seriesOf(
  spec: {
    readonly series?: string | false | undefined;
    readonly color?: string | object | undefined;
    readonly stroke?: string | undefined;
    readonly fill?: string | undefined;
    readonly encode?: Readonly<Record<string, unknown>> | undefined;
  },
  table: Table,
  paint: "stroke" | "fill",
): string | undefined {
  if (spec.series !== undefined) return spec.series === false ? undefined : spec.series;
  if (spec[paint] !== undefined || spec.encode?.[paint] !== undefined) return undefined;
  // A point's color may be a channel itself, as encode's is.
  const given = (spec.encode?.color ?? spec.color) as
    | string
    | { field?: string; scale?: unknown }
    | undefined;
  // Colors read as they are (an identity scale) stand for nothing to split by.
  if (typeof given === "object" && typeof given.scale === "object") return undefined;
  const field = typeof given === "object" ? given.field : given;
  return field !== undefined && table.has(field) && table.kind(field) === "category"
    ? field
    : undefined;
}

/**
 * A color a mark's option gives (`value`), read with `paint` as renderers
 * read it; `path` names the option in messages. Undefined without one.
 */
export function painted(
  paint: PaintReader,
  value: string | undefined,
  path: string,
): string | undefined {
  return value === undefined ? undefined : paint(value, path);
}

/**
 * A mark's `color` where it draws it itself: a color, not the field its
 * series are split by (whose values the chart colors).
 */
export function ownColor(color: string | undefined, table: Table): string | undefined {
  return color === undefined || table.has(color) ? undefined : color;
}

/**
 * Checks whether fields identify separate series or values within one
 * grouped series; `inferred` says the series field came from the color.
 */
export function requireSeriesFields(
  fields: readonly string[],
  series: string | undefined,
  role = "y",
  correction = false,
  inferred = false,
): void {
  if (series !== undefined && fields.length > 1) {
    // Placed at the option that splits series, which the correction changes.
    const space = role.lastIndexOf(" ");
    const path = inferred ? "color" : "series";
    throw new ChartError({
      code: "series-with-values",
      path,
      message: `${role.slice(0, space + 1)}${path}: several ${role.slice(space + 1)} fields${
        inferred
          ? `, and series by "${series}" from color; give one field per mark, or series: false`
          : " or a series field, not both; drop one"
      }`,
    });
  }
  const repeated = fields.find((field, i) => fields.indexOf(field) !== i);
  if (repeated !== undefined)
    throw new Error(
      `${role}: field "${repeated}" is listed twice${correction ? "; list it once" : ""}`,
    );
}

/** What keeps long-format rows grouped as tables stream, loaded the first time a splitter needs it. */
let splitRows: Promise<typeof import("./split.ts")> | undefined;
/** The same once loaded, so splitters made after it group through it from their first scene. */
let split: typeof import("./split.ts") | undefined;

/**
 * Splits a mark's rows into series sources: one per y field, or one per
 * category of the `series` field. Cached until the rows change. Without
 * an x field (or with a categorical one) sources are reported unsorted.
 */
export class SeriesSplitter {
  readonly #rows: () => MarkRows;
  readonly #xField: string | undefined;
  readonly yFields: readonly string[];
  readonly #seriesField: string | undefined;
  readonly #label: string | undefined;
  #cache: { rows: MarkRows; sources: SeriesSource[] } | undefined;
  /**
   * A whole table's rows by the series field, kept current as it streams;
   * until its code loads, rows are grouped again each change.
   */
  #groups: SplitRows | undefined;
  #loading = false;

  constructor(
    rows: () => MarkRows,
    xField: string | undefined,
    yFields: readonly string[],
    seriesField: string | undefined,
    label: string | undefined,
  ) {
    this.#rows = rows;
    this.#xField = xField;
    this.yFields = yFields;
    this.#seriesField = seriesField;
    this.#label = label;
    requireSeriesFields(yFields, seriesField);
  }

  sources(): SeriesSource[] {
    const rows = this.#rows();
    if (this.#cache?.rows !== rows) this.#cache = { rows, sources: this.#split(rows) };
    return this.#cache.sources;
  }

  #split({ table, positions: shown }: MarkRows): SeriesSource[] {
    const xField = this.#xField;
    const field = this.#seriesField;
    if (field === undefined) {
      const x = xField === undefined ? undefined : table.numbers(xField as never);
      const sorted =
        x !== undefined && (shown ? isSortedSubset(x, shown) : table.isSorted(xField as never));
      return this.yFields.map((y) => ({
        id: y,
        label: this.yFields.length === 1 ? (this.#label ?? y) : y,
        y,
        rows: shown,
        sorted,
      }));
    }
    if (!shown && split) this.#groups ??= new split.SplitRows(table, field, xField);
    if (!shown && this.#groups) {
      return this.#groups.groups().map(({ name, rows, sorted, stream }) => ({
        id: name,
        label: name,
        y: this.yFields[0]!,
        rows,
        sorted,
        stream,
      }));
    }
    if (!shown && !this.#loading) {
      this.#loading = true;
      splitRows ??= import("./split.ts");
      splitRows.then(
        (loaded) => {
          split = loaded;
          // The next call groups through it, though the rows may not have changed.
          this.#cache = undefined;
        },
        // Without it, rows are grouped again each change, as before it loaded.
        () => {},
      );
    }
    const x = xField === undefined ? undefined : table.numbers(xField as never);
    const { codes, dictionary } = table.categories(field as never);
    const groups = rowsByCode(codes, dictionary.length, shown);
    // Categories with no remaining rows (for example after a rolling
    // window moved past them) produce no series.
    return dictionary.flatMap((name, code) => {
      const rows = groups[code]!;
      if (rows.length === 0) return [];
      const sorted = x !== undefined && isSortedSubset(x, rows);
      return [{ id: name, label: name, y: this.yFields[0]!, rows, sorted }];
    });
  }
}

/**
 * Builds series from sources: keys, colors, column views. `x` holds each
 * row's x position; `positions`, when given, each row's y position in place
 * of the sources' y field (band indices of a category field).
 */
export function buildSeries(
  table: Table<Schema>,
  sources: readonly SeriesSource[],
  x: NumericArray,
  key: MarkKey,
  palette: Palette,
  stroke: string | undefined,
  positions?: NumericArray,
): Series[] {
  return sources.map((source) => {
    const y = positions ?? table.numbers(source.y as never);
    const id = seriesKey(key, source.id);
    return {
      key: id,
      label: source.label,
      // The palette returns `stroke` when it is set, unless a series style overrides it.
      color: palette(id, source.label, stroke),
      x,
      y,
      y0: undefined,
      values: y,
      field: positions ? undefined : source.y,
      range: false,
      rows: source.rows,
      stream: source.stream,
      length: source.rows?.length ?? y.length,
      sorted: source.sorted,
    };
  });
}

/**
 * The bands of one axis, in order. `keys` identify bands by raw value (a
 * category, or a number's full-precision text), so values whose display
 * labels coincide stay distinct; `labels` are what the axis shows.
 */
export interface BandList {
  keys: readonly string[];
  labels: readonly string[];
}

/** Ordered distinct values of a field as bands, with each row's band. */
interface Ordinal extends BandList {
  /** Band index of each row in `keys`, -1 for missing values. */
  own: Int32Array;
}

const ordinals = new WeakMap<object, Map<string, { revision: string; ordinal: Ordinal }>>();

/**
 * What caches of bands are kept by: a table, for every row of it, which marks
 * reading it share; else the positions, copies of their own.
 */
function rowsKey(rows: MarkRows): object {
  return rows.positions ?? rows.table;
}

/** An ordinal of a mark's rows, cached under `key` per revision of them. */
function cachedOrdinal(rows: MarkRows, key: string, compute: () => Ordinal): Ordinal {
  let byField = ordinals.get(rowsKey(rows));
  if (!byField) {
    byField = new Map();
    ordinals.set(rowsKey(rows), byField);
  }
  const cached = byField.get(key);
  if (cached && cached.revision === rows.revision) return cached.ordinal;
  const result = compute();
  byField.set(key, { revision: rows.revision, ordinal: result });
  return result;
}

/**
 * Bands for a field: category fields give their categories that occur in
 * the mark's rows (in dictionary order); number and time fields give their
 * distinct values in ascending order, labeled for display. Cached per
 * revision of the rows.
 */
function ordinal(rows: MarkRows, field: string, context: BandContext): Ordinal {
  if (rows.table.kind(field) === "category") return categoryBandsOf(rows, field);
  return cachedOrdinal(rows, `${field}|${context.zone}|${context.locale}`, () =>
    valueOrdinal(rows, field, context),
  );
}

/** A category field's bands, which no zone or locale labels. */
function categoryBandsOf(rows: MarkRows, field: string): Ordinal {
  return cachedOrdinal(rows, field, () => categoryOrdinal(rows, field));
}

function categoryOrdinal(rows: MarkRows, field: string): Ordinal {
  const { codes, dictionary } = rows.table.categories(field as never);
  const band = new Int32Array(dictionary.length).fill(-1);
  const count = rowCount(rows);
  for (let k = 0; k < count; k++) {
    const code = codes[rowAt(rows, k)]!;
    if (code >= 0) band[code] = 0;
  }
  const labels: string[] = [];
  for (let code = 0; code < dictionary.length; code++) {
    if (band[code] === 0) {
      band[code] = labels.length;
      labels.push(dictionary[code]!);
    }
  }
  const own = new Int32Array(codes.length);
  for (let i = 0; i < codes.length; i++) own[i] = codes[i]! >= 0 ? band[codes[i]!]! : -1;
  return { keys: labels.map((label) => `c:${label}`), labels, own };
}

function valueOrdinal(rows: MarkRows, field: string, context: BandContext): Ordinal {
  const values = rows.table.numbers(field as never);
  // Number distinct values as they appear, then renumber them in ascending
  // order: grids have far fewer distinct values than rows.
  const ids = new Map<number, number>();
  const own = new Int32Array(values.length).fill(-1);
  const count = rowCount(rows);
  for (let k = 0; k < count; k++) {
    const i = rowAt(rows, k);
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    let id = ids.get(v);
    if (id === undefined) {
      id = ids.size;
      ids.set(v, id);
    }
    own[i] = id;
  }
  const unique = Float64Array.from(ids.keys()).sort();
  const rank = new Int32Array(unique.length);
  for (let k = 0; k < unique.length; k++) rank[ids.get(unique[k]!)!] = k;
  for (let i = 0; i < own.length; i++) if (own[i]! >= 0) own[i] = rank[own[i]!]!;
  return {
    keys: Array.from(unique, (v) => `n:${v}`),
    labels: valueLabels(unique, rows.table.kind(field) === "time", context),
    own,
  };
}

function valueLabels(values: Float64Array, isTime: boolean, context: BandContext): string[] {
  if (!isTime) return Array.from(values, (v) => formatNumber(v, context.locale));
  let spacing = Infinity;
  for (let i = 1; i < values.length; i++) spacing = Math.min(spacing, values[i]! - values[i - 1]!);
  const units: TimeUnit[] = ["year", "month", "day", "hour", "minute", "second"];
  const unit = units.find((u) => spacing >= TIME_UNIT_MS[u]) ?? "millisecond";
  const interval = { unit, step: 1, duration: TIME_UNIT_MS[unit] };
  return timeTickLabels(Array.from(values), interval, context.zone, context.locale);
}

/** Bands made from numbers or times, which run upward on a y axis; categories run downward. */
export function numericBands(list: BandList): boolean {
  return list.keys.length > 0 && list.keys.every((key) => key.startsWith("n:"));
}

/** The bands a field of a mark's rows contributes to an axis. */
export function fieldBands(rows: MarkRows, field: string, context: BandContext): BandList {
  return ordinal(rows, field, context);
}

/**
 * The bands a category field contributes to an axis, for marks that band
 * categories only (lines and areas), which need no labels of numbers or times.
 */
export function categoryBands(rows: MarkRows, field: string): BandList {
  return categoryBandsOf(rows, field);
}

// Keyed weakly by the axis' key list (one per chart while its bands are
// unchanged), so charts sharing a table do not evict each other's mappings.
const indexCache = new WeakMap<
  readonly string[],
  WeakMap<object, Map<string, { revision: string; indices: Int32Array }>>
>();

/**
 * Each row's band index on an axis whose band keys are `keys` (which may
 * include bands from other marks). Cached per revision of the rows and key
 * list; the chart keeps key lists stable while their contents do not
 * change. The array is shared with other callers and must not be modified.
 */
export function bandIndices(
  rows: MarkRows,
  field: string,
  keys: readonly string[],
  context: BandContext,
): Int32Array {
  return indicesOf(rows, field, keys, () => ordinal(rows, field, context));
}

/** `bandIndices` of a category field (see `categoryBands`). */
export function categoryIndices(
  rows: MarkRows,
  field: string,
  keys: readonly string[],
): Int32Array {
  return indicesOf(rows, field, keys, () => categoryBandsOf(rows, field));
}

/** Each row's band index on an axis of `keys`, from the field's own bands (`own`). */
function indicesOf(
  rows: MarkRows,
  field: string,
  keys: readonly string[],
  ownBands: () => Ordinal,
): Int32Array {
  let byRows = indexCache.get(keys);
  if (!byRows) {
    byRows = new WeakMap();
    indexCache.set(keys, byRows);
  }
  let byField = byRows.get(rowsKey(rows));
  if (!byField) {
    byField = new Map();
    byRows.set(rowsKey(rows), byField);
  }
  const cached = byField.get(field);
  if (cached && cached.revision === rows.revision) return cached.indices;
  const own = ownBands();
  const position = new Map(keys.map((key, index) => [key, index]));
  const remap = Int32Array.from(own.keys, (key) => position.get(key) ?? -1);
  // When the field's bands lead the axis in their own order, as with one
  // mark on it, rows keep their own indices rather than a copy of them.
  let indices = own.own;
  if (!remap.every((to, from) => to === from)) {
    indices = new Int32Array(own.own.length);
    for (let i = 0; i < indices.length; i++)
      indices[i] = own.own[i]! >= 0 ? remap[own.own[i]!]! : -1;
  }
  byField.set(field, { revision: rows.revision, indices });
  return indices;
}

/**
 * A frozen copy of a spec, all the way down, so it cannot change under the
 * mark's caches, nor freeze arrays and objects its caller still holds.
 * Specs are small plain objects; copying them is cheap.
 */
export function frozen<T>(spec: T): Frozen<T> {
  if (!spec || typeof spec !== "object") return spec as Frozen<T>;
  // Expressions built with `col` are their JSON form.
  if (typeof (spec as { toJSON?: unknown }).toJSON === "function")
    return frozen((spec as unknown as { toJSON(): T }).toJSON());
  // fromEntries keeps a JSON key "__proto__" as an own property.
  return Object.freeze(
    Array.isArray(spec)
      ? spec.map(frozen)
      : Object.fromEntries(Object.entries(spec).map(([key, value]) => [key, frozen(value)])),
  ) as Frozen<T>;
}
