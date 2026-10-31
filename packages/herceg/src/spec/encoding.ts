// Portable encoding types: how a mark's appearance follows its data. A
// channel is a field's value through a scale, a constant, or a condition on
// each row; categorical scales with fixed mappings go in the chart's
// `scales`; a mark's `style` maps series to looks and styles its parts
// (markers, leaders); `continuity` and `where` decide which observations
// lines and areas connect. See docs/architecture/marks.md, "Encodings".

import type { Expression } from "../data/expression.ts";
import type { FormatSpec } from "./guides.ts";
import type { Side } from "./place.ts";
import type { Dash, Field } from "./spec.ts";
import type { PaintStyle, StrokeStyle, TextStyle } from "./style.ts";

/**
 * A point's shape. Every shape covers the area of a circle of the same
 * radius; "cross" is a plus and "x" the same turned 45 degrees.
 */
export type SymbolName =
  | "circle"
  | "square"
  | "triangle"
  | "diamond"
  | "cross"
  | "star"
  | "wye"
  | "triangle-down"
  | "x";

/**
 * A value per row: a field's value read through a scale (the channel's
 * default scale, "color" for colors, the one of the chart's `scales` that
 * `scale` names: of categories for a category field, a channel scale for a
 * number field; or with `scale: { type: "identity" }` the value itself),
 * the series' names through a scale (`{ series: true, scale }`: series of
 * marks naming one scale share colors, legend entries, and dodged places by
 * name, as a line and the band around it do), a constant, or a
 * condition's `then` where `when` holds and its `otherwise` elsewhere.
 */
export type ChannelSpec<V> =
  | { field: Field; scale?: string | IdentityScaleSpec }
  | { series: true; scale: string }
  | { value: V }
  | { condition: { when: Expression; then: V; otherwise: V } };

/** A channel of each row's own look: any but the series' names, for what has no series (regions). */
export type RowChannelSpec<V> = Exclude<ChannelSpec<V>, { series: true }>;

/**
 * A scale that maps nothing: each row's value is the channel's output (a
 * color for colors, a symbol's name, an area in square pixels for sizes,
 * pixels for widths, 0 to 1 for opacities, a dash), checked as the channel
 * checks its constants. Its values make no legend entries and split no
 * series.
 */
export interface IdentityScaleSpec {
  type: "identity";
}

/**
 * A continuous scale for channels other than position, in the chart's
 * `scales`: it maps a number field's values onto widths, opacities, sizes
 * (areas), or colors. Its domain is the fields' extent over the rows the
 * marks reading it draw, unless given; `range` is its outputs at the
 * domain's ends: two numbers, or two or more colors ("#rrggbb", a ramp
 * through them, evenly spaced). Inputs past the domain extend it, or with
 * `clamp` take its ends' outputs; colors stay at their ends. Outputs stay
 * in what the channel takes (opacities from 0 to 1, widths and sizes from
 * 0). Missing values, and values the scale cannot take (a log's zero or
 * less, a square root's negatives), take the mark's own paint; points,
 * which leave out rows missing a value they encode, leave those out.
 */
export interface ChannelScaleSpec {
  type: "linear" | "log" | "sqrt";
  /** The inputs mapped to `range`'s ends: two different numbers, positive for "log", not negative for "sqrt". */
  domain?: readonly [number, number];
  range: readonly [number, number] | readonly string[];
  clamp?: boolean;
}

/**
 * A mark's channels. `color` is the primary paint: a line's stroke, a bar's,
 * area's, region's, or point's fill, and text's color; `fill` and `stroke`
 * set those paints themselves and win over `color`. Marks take the channels
 * they draw (see each mark).
 */
export interface EncodingsSpec {
  color?: ChannelSpec<string>;
  fill?: ChannelSpec<string>;
  stroke?: ChannelSpec<string>;
  dash?: ChannelSpec<Dash>;
  symbol?: ChannelSpec<SymbolName>;
  strokeWidth?: ChannelSpec<number>;
  /** A point's area in square pixels. */
  size?: ChannelSpec<number>;
  opacity?: ChannelSpec<number>;
}

/**
 * A scale of categories with fixed outputs, shared by the marks that name
 * it: every value takes the same color (or shape, dash, number) in every
 * mark and panel reading it, from any table, before facets and hidden
 * series, and keeps it while the data streams. With `domain`, its values
 * in that order and only those (others take `unknown`); without, the
 * values of the fields it reads, their dictionaries' order first. Values
 * `map` leaves out take the theme's palette (or the channel's defaults) by
 * their place in the domain. A chart declaring "color" colors every mark's
 * series and fields through it, unless a channel names another; without
 * it, values take the chart's colors of what they stand for (the same
 * field of the same table; see docs/architecture/marks.md, "Identity and
 * color").
 */
export interface OrdinalScaleSpec {
  type: "ordinal";
  /**
   * Which panels share the scale's mapping: every panel of the chart (the
   * default), or each panel its own ("panel"), whose values then take
   * places in that panel's domain.
   */
  scope?: "chart" | "panel";
  /** The values in order, and only those; legends list every one, drawn or not. */
  domain?: readonly string[];
  map?: Readonly<Record<string, string | number | Dash>>;
  /** For values outside an explicit `domain`: the theme's muted color by default. */
  unknown?: string | number | Dash;
}

/** A point drawn at each observation of a line: its shape, radius, and paint (the line's color by default). */
export interface MarkerStyle {
  symbol?: SymbolName;
  /** In pixels; 3 by default. */
  radius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  /** From 0 to 1. */
  opacity?: number;
}

/** How one series (or, for marks of rows, one row) looks: its paint, and a line's markers. */
export interface SeriesStyle extends PaintStyle {
  marker?: MarkerStyle;
}

/**
 * Looks by value: each series whose `field` (constant within it) has a value
 * `map` names takes that look. Without `field`, series are named by their
 * source: a `series` field's value, or the value field of wide data
 * (`y: ["mean", "p95"]`). Marks of rows (bars, points) read each row's value.
 */
export interface StyleMapSpec {
  field?: Field;
  map: Readonly<Record<string, SeriesStyle>>;
}

/**
 * How a mark's parts look: its markers, and looks mapped by value (`by`).
 * The mark's body takes its flat paint options (`stroke`, `fill`,
 * `strokeWidth`, `dash`, `opacity`, ...); labels take their label object's
 * `style`, and their leaders its `leader`.
 */
export interface MarkStyleSpec {
  by?: StyleMapSpec;
  marker?: MarkerStyle;
}

/** A calendar unit lines break at the boundaries of, in the chart's time zone. */
export type CalendarBreak = "minute" | "hour" | "day" | "week" | "month" | "year";

/**
 * Which neighboring observations a line or area connects, decided before
 * it is drawn or reduced: never across a missing value, a row `defined`
 * rejects, more than `maxGap` along its positions (in their units; for
 * times, milliseconds or `{ milliseconds }`), or a boundary `breakBy` names
 * (a calendar unit, or a change of a field's value).
 */
export interface ContinuitySpec {
  defined?: Expression;
  maxGap?: number | { milliseconds: number };
  breakBy?: CalendarBreak | { field: Field };
}

/**
 * How an area stack piles its series: `offset` ("zero", "fill" for shares,
 * "center" or "wiggle" for streams), the layers' `order` (as listed, or
 * "inside-out", the largest in the middle), and what a series of a series
 * field counts as at a position other series have rows at but it has not
 * (`gaps`): zero, or the straight line between its rows on either side
 * ("interpolate"; zero beyond its first and last rows), and where the
 * stack stands (`support`): wherever any series has a row ("union"), or
 * only where every shown series has one or runs across ("intersection").
 * A series' run that its `continuity` breaks is a gap of the whole stack.
 */
export interface StackSpec {
  offset?: "zero" | "fill" | "center" | "wiggle";
  order?: "input" | "inside-out";
  gaps?: "zero" | "interpolate";
  support?: "union" | "intersection";
}

/**
 * Where a label goes on what it labels. `attachment` is along the geometry:
 * a rule's start, middle, or end (left to right, or top to bottom), a
 * region's edge (`side`, top by default) from its start, or a bar's root,
 * middle, or tip. `outside` puts a label at a plot edge beyond it, and
 * `reserve` keeps room for it there; `offset` moves it away from its place,
 * in pixels.
 */
export interface LabelPlaceSpec {
  attachment?: "start" | "center" | "end";
  side?: Side;
  outside?: boolean;
  reserve?: boolean;
  offset?: number;
}

/**
 * One part of a label's text: literal text, a field's value of the row
 * the label is at (written with `format`), the name of the series it
 * labels (`{ series: true }`), or its value there (`{ value: true }`, the
 * value the geometry has at the label's place, written with `format`).
 */
export type LabelPart =
  | string
  | { field: Field; format?: FormatSpec; style?: PartStyle; series?: never; value?: never }
  | { series: true; style?: PartStyle; field?: never; value?: never; format?: never }
  | { value: true; format?: FormatSpec; style?: PartStyle; field?: never; series?: never };

/**
 * How a part of a label looks over the label's style: its size, weight,
 * slant, color, and opacity. Its halo, box, and alignment are the label's.
 */
export type PartStyle = Pick<
  TextStyle,
  "fontSize" | "fontWeight" | "fontStyle" | "color" | "opacity"
>;

/** A label's text, its parts in order: `["Capacity: ", { value: true, format: { number: ".1f" } }]`. */
export type LabelContent = readonly LabelPart[];

/**
 * A label's text: constant `text`, each row's `field` (numbers written with
 * `format`), or `content` made of parts, styled as `style` says.
 */
export type LabelTextSpec = (
  | { text: string; field?: never; content?: never }
  | { field: Field; text?: never; content?: never }
  | { content: LabelContent; text?: never; field?: never; format?: never }
) & {
  format?: FormatSpec;
  style?: TextStyle;
};

/**
 * What a label does where it would cover another of its overlap group:
 * drawn at its place anyway ("show"), left out ("hide", those of lower
 * `priority` first), or moved to the nearest free place its kind of label
 * allows, and left out where none is ("move").
 */
export type Overlap = "show" | "hide" | "move";

/**
 * How labels keep apart, written the same wherever a kind of label can
 * honor it: what a label does where it would cover another (`overlap`),
 * which labels keep apart (`overlapGroup`: annotation labels of every mark
 * naming the group; by default, a mark's own), a line from each label
 * moved more than 6 pixels back to what it labels (`leader`: `true`, or its
 * look), and which labels stay where some must go (`priority`, the
 * higher; 0 by default). Each kind takes the parts it honors (see
 * docs/guide/marks.md, "Labels that would overlap").
 */
export interface LabelLayoutSpec {
  overlap?: Overlap;
  overlapGroup?: string;
  leader?: boolean | StrokeStyle;
  priority?: number;
}

/**
 * A label of an annotation (text, rule, region): its text
 * (`LabelTextSpec`), placed as `place` says, kept apart from others as its
 * layout says ("show" by default).
 */
export type LabelSpec = LabelTextSpec & { place?: LabelPlaceSpec } & LabelLayoutSpec;

/**
 * Which point of a series a label follows: its first or last observation
 * drawn ("first", "last"), or where its line enters or leaves the view
 * ("visible-start", "visible-end"), along the series' own order.
 */
export type LabelAt = "first" | "last" | "visible-start" | "visible-end";

/**
 * Labels that follow each series of a line: placed at `at`, saying
 * `content` (the series' name by default), placed as `place` says (beside
 * the point within the plot, or `outside` the plot at its edge) and styled
 * as `style` says. A panel's series labels keep apart as `overlap` says:
 * "move" (the default) moves them along y as little as keeps them apart,
 * in the order of their points, and leaves out those of lowest `priority`
 * (then the last in series order) where the plot is too short for all;
 * "show" draws each at its point; "hide" leaves out those that would cover
 * one of higher priority. `leader` draws a line from each label moved more
 * than 6 pixels back to its point.
 */
export interface SeriesLabelsSpec extends Omit<LabelLayoutSpec, "overlapGroup"> {
  at: LabelAt;
  content?: LabelContent;
  place?: LabelPlaceSpec;
  style?: TextStyle;
}

/**
 * Labels that follow each series of an area (see `SeriesLabelsSpec`): a
 * band's (`y1` and `y2`, or `x1` and `x2`) follow the edge `edge` names.
 */
export interface AreaLabelsSpec extends SeriesLabelsSpec {
  edge?: "y1" | "y2" | "x1" | "x2";
}

/**
 * A place on another mark's geometry that text follows: mark `mark`'s
 * series at `at` (see `SeriesLabelsSpec`).
 */
export interface MarkAnchorSpec {
  mark: string;
  at: LabelAt;
  edge?: "y1" | "y2" | "x1" | "x2";
}

/**
 * A bar's value label: the value (or with `field`, a field's), written with
 * `format`, or `content` made of parts (each written with its own format),
 * styled as `style` says (black or white by contrast with the bar inside
 * it unless `style.color` is set), on bars at least `minLength` pixels
 * long, placed as `place` says.
 */
export type BarLabelsSpec = (
  | { field?: Field; format?: FormatSpec; content?: never }
  | { content: LabelContent; field?: never; format?: never }
) & {
  style?: TextStyle;
  minLength?: number;
  place?: BarLabelPlaceSpec;
  /**
   * Labels that would cover another of the mark's: drawn anyway ("show",
   * the default), or left out ("hide"), the later in series and row order.
   */
  overlap?: "show" | "hide";
};

/**
 * Where bars' labels go: past each bar's end (`outside`, the default for
 * bars not stacked, just inside where past would leave the plot), or
 * inside it at its root, middle, or tip (`attachment`: "start", "center",
 * "end"; stacked bars' labels are inside, centered by default).
 */
export interface BarLabelPlaceSpec {
  attachment?: "start" | "center" | "end";
  outside?: boolean;
}
