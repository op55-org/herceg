// What the model asks of the feature compiler, the code for what only some
// charts ask of their marks: channels beyond constants (fields through
// categorical scales, conditions), styles by value, markers, and which
// observations lines and areas connect (`continuity`, `where`). It loads
// with the charts that use it: a live chart imports it before drawing such
// a configuration, and static output brings it with it.

import type { Table } from "../data/table.ts";
import type { Breaks } from "../lod/m4.ts";
import type { RangeIndex } from "../lod/minmax-index.ts";
import type { PointSink, Polyline } from "../lod/polyline.ts";
import type { ContentWriter } from "../marks/features/content.ts";
import type { TracedEdge } from "../marks/features/provenance.ts";
import type { ChartMark, Frame, GlyphKey, Mark, Palette } from "../marks/mark.ts";
import type { RowBindings } from "../marks/row-bindings.ts";
import type { Series } from "../marks/series.ts";
import type { TraceFrame } from "../marks/trace.ts";
import type { Connections } from "../marks/union-stack.ts";
import type { Geometry } from "../scene/scene.ts";
import type { ChannelSpec, SymbolName } from "../spec/encoding.ts";
import type { FormatSpec, SwatchSpec } from "../spec/guides.ts";
import type { Dash } from "../spec/spec.ts";
import type { PaintReader, Theme } from "../theme.ts";
import type { clearDomain } from "./clearance.ts";
import type { GuideKit } from "./guides.ts";
import type { TableName } from "./identity.ts";
import type { LegendEntry } from "./legend.ts";
import type { ChartConfig } from "./model.ts";

/**
 * What the feature compiler uses of the chart's own code: the guide
 * compiler's kit (`GUIDE_KIT`), handed to it for the same reason, and how
 * to tell a color from a field's name: the browser's `CSS.supports` on a
 * page, the CSS color reader in static output (a chunk of its own would
 * hold the reader where both the chart and the compiler imported it).
 */
export type FeatureKit = GuideKit & { isColor(value: string): boolean };

/**
 * A series' swatch: one a spec could give, a box whose fill has an opacity
 * of its own under the outline's (`opacity` fades both), or a marker's
 * symbol as SVG path data about its center, `size` pixels across.
 */
export type SeriesSwatch =
  | Exclude<SwatchSpec, { type: "composite" | "rect" }>
  | (Extract<SwatchSpec, { type: "rect" }> & { fillOpacity?: number })
  | { type: "glyph"; d: string; size: number; fill: string; stroke?: string; opacity?: number }
  | { type: "composite"; parts: readonly SeriesSwatch[] };

/** Checks and compiles a configuration's mark features (marks/features/compile.ts). */
export interface FeatureCompiler {
  /**
   * Throws for what the configuration's marks ask that it refuses, naming
   * where. `previous`, the chart's compilation before, keeps its scales'
   * values in their places. `identities` says what the marks' series stand
   * for, which colors by value follow.
   */
  compile(
    config: ChartConfig,
    marks: readonly Mark[],
    previous: CompiledFeatures | undefined,
    identities: Identities,
  ): CompiledFeatures;
  /**
   * The names of the tables marks' value fields come from, where two would
   * take one name (model/identity.ts, `simpleNames`); throws for two tables
   * of one name.
   */
  names(
    tables: readonly (Table | undefined)[],
    places: readonly (string | number)[],
    last: ReadonlyMap<Table, TableName> | undefined,
  ): (TableName | undefined)[];
}

/** What the model resolved of what series stand for (see model/identity.ts). */
export interface Identities {
  /**
   * The prefix of each mark's series' identity keys, as the compiler's
   * `marks`: undefined for marks whose series stand for nothing.
   */
  readonly scopes: readonly (string | undefined)[];
  /** Each of the compiler's `marks`' index in the chart's `marks`, which errors name. */
  readonly positions: readonly number[];
  /**
   * The prefix of the identity keys of category `field`'s values, which
   * colors of the values of `table`'s field read by the mark at `index`
   * (among the chart's marks) follow.
   */
  field(table: Table, field: string, index: number): string;
}

/** A configuration's mark features, compiled. */
export interface CompiledFeatures {
  /** What `mark` takes from the features; undefined for a mark that uses none. */
  of(mark: Mark): MarkFeatures | undefined;
  /**
   * Legend entries with the declared domain of each of the chart's scales
   * that series and layout items stand for in place of the entries of its
   * values: an entry per value in the domain's order, drawn or not. A
   * `plain` legend (no guides to name marks left out of legends) lists none
   * of the scales only those read.
   */
  listDomains(entries: readonly LegendEntry[], plain: boolean): LegendEntry[];
  /** The keys of the values of declared domains `mark`'s series stand for, which it owns in legends. */
  domainKeys(mark: ChartMark): string[];
  /**
   * An annotation's legend entries by its labels (`Mark.labelEntries`, in
   * the mark's look): a region painted per row's in the paint of the first
   * row holding each label; others' as they are.
   */
  labelLooks(mark: Mark, entries: LegendEntry[]): LegendEntry[];
  /** `frame` with the scales placing a mark's rows where `bound` binds them (marks/row-bindings.ts). */
  frame(frame: Frame, bound: RowBindings): Frame;
  /**
   * Before each scene's series: the categorical scales' values, from every
   * mark's rows, `slot`, the chart's palette slot of an identity key (for
   * colors by value that no declared scale gives), and `paint`, which reads
   * the colors the options give (scales' maps, channels' values, looks).
   */
  update(theme: Theme, slot: (key: string) => number, paint: PaintReader): void;
  /**
   * The prefixes of identity keys the compiler gives series and rows beyond
   * the core's (see marks/features/identity.ts), whose hidden keys stay.
   */
  readonly scopes: ReadonlySet<string>;
  /**
   * With `scales.color` declared, what a layout mark's items (a pie's
   * slices) stand for and their colors: its values, through it (its
   * panel's, for a scale of each panel's own), as every mark's.
   */
  items?(
    mark: Mark,
  ): { readonly prefix: string; color(value: string): string | undefined } | undefined;
}

/** One mark's compiled features. */
export interface MarkFeatures {
  /** Pixels a line's markers reach past their observations along each axis, as `Mark.inset`. */
  readonly inset?: { readonly x: number; readonly y: number } | undefined;
  /** Automatic padding's solver, as `Mark.clearDomain`, with `inset`. */
  readonly clearDomain?: typeof clearDomain | undefined;
  /** The mark's series' colors: by value through its color channel, by series through `style.by`. */
  palette(palette: Palette): Palette;
  /** What a series of the mark draws with, set on it as it is resolved. */
  attach(series: Series): void;
  /** How the mark writes values in `format`, a pattern (`{ number }`, `{ time }`) included. */
  format?(format: FormatSpec, locale: string | undefined, path: string): (value: number) => string;
  /**
   * Labels following series the mark draws (`labels` on lines and areas,
   * text `from` a mark), placed in `frame`'s panel after the mark is drawn
   * there, painted where it paints (marks/features/labels.ts).
   */
  labels?(frame: Frame): Geometry[];
  /** What those labels outside the plot took left and right, as last placed (`Mark.room`). */
  room?(): [number, number];
  /** How labels of parts (`content`: a bar's, an annotation's) are written (marks/features/content.ts). */
  readonly content?: ContentWriter | undefined;
  /** Which rows connect, where a stack of a series field breaks (marks/union-stack.ts). */
  readonly continuity?: Connections | undefined;
  /**
   * For marks drawing a shape per row without series (regions): each row's
   * look, an index into `paints` (colors read), for the table's version
   * and the channel scales' domains; undefined where no channel reads rows.
   */
  rowLooks?(): RowLooks | undefined;
  /**
   * For custom marks: a channel's output for a row of their table (a
   * color, a width, an opacity), undefined where the row has none or the
   * channel is not given.
   */
  encoded?(channel: "color" | "strokeWidth" | "opacity", row: number): string | number | undefined;
}

/** Rows' looks (see `MarkFeatures.rowLooks`). */
export interface RowLooks {
  readonly paints: readonly RowPaint[];
  of(row: number): number;
}

/**
 * What the feature compiler gives a series: how its geometry is drawn
 * (its own paint from `style.by` and series-constant channels, its
 * markers), and how its observations are traced and read where
 * `continuity` or `where` decide which it connects.
 */
export interface SeriesFeatures {
  /** What to draw of `geometry`, the mark's for the series: restyled, and with markers. */
  geometry?(geometry: Geometry, series: Series, frame: Frame): Geometry[];
  /**
   * Traces positions [start, end) of an edge of the series into `path` as
   * `tracePath` does, a run of connected observations at a time, each
   * reduced by `reduce` into `path`, or through `sink` where it records
   * which position each point kept is (marks/features/provenance.ts), with
   * the crossings `where` meets between them.
   */
  trace?(
    series: Series,
    y: Series["y"],
    frame: TraceFrame,
    stage: string,
    path: Polyline,
    start: number,
    end: number,
    reduce: (start: number, end: number, sink?: PointSink) => void,
  ): void;
  /**
   * Traces positions [start, end) of a band's edges `top` and `bottom`
   * into `upper` and `lower`, a run at a time (`reduce` reducing an edge's
   * positions into a polyline, through its min/max index where given),
   * with `where`'s crossings at their ends; `indexes`, the edges' own,
   * where the mark keeps them.
   */
  band?(
    series: Series,
    top: Series["y"],
    bottom: Series["y"],
    frame: TraceFrame,
    upper: Polyline,
    lower: Polyline,
    start: number,
    end: number,
    reduce: (
      edge: Series["y"],
      start: number,
      end: number,
      out: PointSink,
      index?: RangeIndex,
    ) => void,
    indexes?: { top: RangeIndex; bottom: RangeIndex },
  ): void;
  /** The extent of the series' drawn observations within [x0, x1], as `yExtent` gives it. */
  extent?(
    series: Series,
    x0: number,
    x1: number,
    y: Series["y"],
    log: boolean,
    index: RangeIndex | undefined,
    curved: boolean,
    breaks: Breaks | undefined,
  ): [number, number] | undefined;
  /**
   * For a series running along y (x holds its values): the extent of
   * `values` it draws, of the rows `where` and `defined` keep and the
   * crossings `where` adds, placed between rows in the time x's `breaks`
   * leave.
   */
  across?(
    series: Series,
    values: Series["y"],
    log: boolean,
    breaks?: Breaks,
  ): [number, number] | undefined;
  /** Whether a row is drawn: false where `where` or `defined` leave it out. */
  drawn?(row: number): boolean;
  /**
   * Whether the series' path stops at table row `row` going `way`, as its
   * last trace in `frame`'s panel drew it: at an observation ending a run
   * of the path (past a `maxGap` or `breakBy` boundary, rows `defined`
   * leaves out, or a value its scales cannot place), not at one the path
   * goes on from to a crossing of `where`. Undefined where it keeps none.
   */
  pathEnds?(series: Series, frame: Frame): ((row: number, way: 1 | -1) => boolean) | undefined;
  /** The table row each of `markers` (the series' markers, as `geometry` made them last) stands at. */
  markerRows?(markers: Geometry): ArrayLike<number> | undefined;
  /**
   * For series labels follow, drawn with the other layers of their band or
   * stack curved together: their edges as drawn on `frame`, and the
   * position in the series of each of their points (both edges').
   */
  curved?(
    series: Series,
    edges: { readonly upper: Polyline; readonly lower: Polyline },
    positions: readonly number[],
    frame: TraceFrame,
  ): void;
  /**
   * For series labels follow: takes the edges (a line's or an area's upper,
   * a band's lower) of the series' last trace, which observation each point
   * is, so a geometry drawn next without them reads none; none where the
   * series was not traced so (a stack's layers drawn through its edges).
   */
  takeTrace?(): { readonly upper?: TracedEdge; readonly lower?: TracedEdge };
  /** The series' drawn observations, as a series of those rows: what text summaries read. */
  shown?(series: Series): Series;
  /**
   * For a band whose looks change along its series (style runs): the
   * positions of `series` its runs end at, which layers curved together
   * keep as points, and which positions they kept (`kept`).
   */
  runs?:
    | {
        ends(series: Series): ArrayLike<number>;
        kept(series: Series, positions: ArrayLike<number>): void;
      }
    | undefined;
  /**
   * For a series whose looks change along it (style runs): the color,
   * opacity, and stroke width each position of `series` (it, or its
   * trace) is drawn in, as its stretch of line or its area's outline and
   * dots draw it, which highlights' dots at its selected rows take.
   */
  lookAt?(series: Series): (position: number) => DotLook;
  /** The series' swatch as it draws, for legends that show marks' looks (`swatches: "mark"`). */
  swatch?: ((theme: Theme) => SeriesSwatch) | undefined;
  /**
   * For marks of rows (bars): the looks rows take, from channels and
   * `style.by` per row, and which each row takes (an index into `paints`).
   */
  rows?: { readonly paints: readonly RowPaint[]; of(row: number): number } | undefined;
  /** For points: what their channels give each row (`PointLooks`), which every series of the mark shares. */
  points?: PointLooks | undefined;
  /** For bars colored by a field other than the series': a key of its values' colors. */
  key?(): GlyphKey | undefined;
}

/** How an observation of a line or area is drawn: its stroke's (or dot's) color, opacity, and width. */
export interface DotLook {
  readonly color: string;
  readonly opacity: number;
  readonly width: number;
}

/**
 * A point mark's channels the feature compiler reads (marks/features/points.ts),
 * as the mark found them in its options: each a channel's spec and the
 * option it came from (`color`, `encode.size`). Number fields whose values
 * points map themselves (a color ramp, sizes by area, opacities) and
 * constants are the mark's own.
 */
export interface PointChannels {
  readonly color?: PointChannel<string> | undefined;
  readonly size?: PointChannel<number> | undefined;
  readonly opacity?: PointChannel<number> | undefined;
  readonly symbol?: PointChannel<SymbolName> | undefined;
  /** What the mark draws itself: its radius (with a size field, the largest), shape, and outline width. */
  readonly radius: number;
  readonly shape: SymbolName;
  readonly outline: number;
}

export interface PointChannel<V> {
  readonly spec: ChannelSpec<V>;
  readonly path: string;
}

/**
 * What a point mark's channels (`PointChannels`) give each row, for the
 * table's current version. Rows read small integers (a field's dictionary
 * code, a condition's truth) or, through identity scales of numbers, their
 * value: nothing is made per row.
 */
export interface PointLooks {
  /** A row's color, an index into `colors`; -1 where it has none, which leaves it undrawn. */
  readonly color?: ((row: number) => number) | undefined;
  /** The colors `color` indexes, as many as rows take: identity colors stay exact. */
  readonly colors: readonly string[];
  /** A row's area in square pixels; NaN where it has none. */
  readonly area?: ((row: number) => number) | undefined;
  /** A row's fill opacity, 0 to 1; NaN where it has none. */
  readonly opacity?: ((row: number) => number) | undefined;
  /** A row's shape, an index into SYMBOLS; -1 where it has none. */
  readonly shape?: ((row: number) => number) | undefined;
  /** The shape of the series of a name, where the series field gives shapes. */
  readonly seriesShape?: ((name: string) => number) | undefined;
  /** How far points reach past their centers at most, outlines included. */
  readonly reach: number;
  /** Keys of the values field channels map through ordinal scales: colors, shapes, and sizes. */
  readonly keys: readonly GlyphKey[];
  /** What a row's channels read, for its text, numbers in `format`: ", kind Threshold". */
  text(row: number, format: (value: number) => string): string;
}

/** A row's look, over its mark's paint and its series' color. */
export interface RowPaint {
  readonly fill?: string | undefined;
  readonly stroke?: string | undefined;
  readonly strokeWidth?: number | undefined;
  readonly dash?: Dash | undefined;
  readonly opacity?: number | undefined;
  readonly fillOpacity?: number | undefined;
  readonly strokeOpacity?: number | undefined;
}

/**
 * Whether a mark's spec sets any of `options`, which need the feature
 * compiler, or a `color` other than a color in CSS syntax that names no
 * field of `table` (which the mark draws itself) or the mark's `series`
 * field (whose series the chart colors by value) unless the browser reads
 * that name as a color too.
 */
export function asksFeatures(
  spec: object,
  options: readonly string[],
  table?: Table,
  series?: string,
): boolean {
  const { color } = spec as { color?: string };
  return (
    options.some((key) => (spec as Record<string, unknown>)[key] !== undefined) ||
    (color !== undefined &&
      (color !== series
        ? !!table?.has(color) || !/^(#|rgb|hsl|var\()/.test(color)
        : // A series field named as a color is (the compiler refuses the name).
          !!globalThis.CSS?.supports("color", color)))
  );
}

/**
 * Whether a configuration uses what only the feature compiler draws:
 * categorical scales, or marks whose options need it (`Mark.featured`)
 * or that place rows by coordinates (`Mark.bound`).
 * Without it, such a configuration draws without its marks' features, so
 * charts load it first and static output brings it.
 */
export function needsFeatures(config: ChartConfig): boolean {
  return (
    // Scales of other names, and a position's with a range, which it refuses.
    Object.entries(config.scales ?? {}).some(
      ([name, scale]) => !/^(x|y|yRight)$/.test(name) || (!!scale && "range" in scale),
    ) || config.marks.some((mark) => (mark as Mark).featured || (mark as Mark).bound)
  );
}
