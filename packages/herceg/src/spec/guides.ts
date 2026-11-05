// Portable guide types: the position scales a chart names (`scales`), the
// guides that explain scales (`guides`: axes, legends, colorbars), and how
// ticks are chosen and written. The chart's `x`, `y`, `yRight`, and
// `legend` options are their short forms (see docs/architecture/layout.md,
// "The guide compiler").

import type {
  AxisTitleSpec,
  ChannelScaleSpec,
  IdentityScaleSpec,
  OrdinalScaleSpec,
  SymbolName,
} from "./encoding.ts";
import type { Place, Side } from "./place.ts";
import type { Dash, ScaleScope } from "./spec.ts";
import type { AxisStyles, LegendStyles, TextStyle } from "./style.ts";

/** A calendar unit of time, as time axes step through it in their time zone. */
export type TimeUnit =
  | "millisecond"
  | "second"
  | "minute"
  | "hour"
  | "day"
  | "week"
  | "month"
  | "year";

/**
 * The time between ticks on a time axis: calendar steps in the scale's time
 * zone, written as a unit ("day"), a count and a unit ("6 hours"), or
 * `{ unit, step }`; or elapsed time, `{ milliseconds }`, which keeps the
 * same length across daylight saving changes.
 * @examples ["month", "6 hours", "15 minutes"]
 */
export type TimeInterval =
  | string
  | {
      unit: TimeUnit;
      /** @integer @minimum 1 */
      step?: number;
    }
  | {
      /** @exclusiveMinimum 0 */
      milliseconds: number;
    };

/**
 * Which ticks an axis draws: about `count` round values (a number alone is
 * the same); one every `every` (a number on number axes, from `anchor`, 0 by
 * default; a time interval on time axes; on category axes, every n-th
 * category); or exactly `values` (numbers, epoch milliseconds on time axes,
 * or categories), those inside the axis' domain.
 * @exclusiveMinimum 0
 */
export type TicksSpec =
  | number
  | {
      /** @exclusiveMinimum 0 */
      count: number;
      fiscal?: never;
    }
  | {
      /** @exclusiveMinimum 0 */
      every: number;
      anchor?: number;
      fiscal?: never;
    }
  | { every: TimeInterval; anchor?: number; fiscal?: FiscalSpec }
  | { values: readonly (number | string)[]; fiscal?: never };

/**
 * A fiscal year: it starts on the first of month `start` (1 to 12) and is
 * named by the year it ends in ("end", the default) or starts in. Time
 * patterns write it with %Y, %y, and %q (its quarter); month and year
 * ticks step from its start.
 */
export interface FiscalSpec {
  /** @integer @minimum 1 @maximum 12 */
  start: number;
  name?: "end" | "start";
}

/** A unit lengths of time are in. Weeks and longer have no fixed length. */
export type DurationUnit =
  | "nanosecond"
  | "microsecond"
  | "millisecond"
  | "second"
  | "minute"
  | "hour"
  | "day";

/**
 * Numbers as lengths of time, in their largest units: 66000 milliseconds
 * is "1m 6s", 450 is "450ms". Unit symbols are d, h, m, s, ms, µs, and ns;
 * digits are the locale's.
 */
export interface DurationFormat {
  /** The unit the values are in. */
  duration: DurationUnit;
  /** At most this many units, the largest first ("1m 6s" is two). @integer @minimum 1 @maximum 7 @default 2 */
  maxUnits?: number;
  /** Decimals of the last unit, kept when zero. @integer @minimum 0 @maximum 20 @default 0 */
  decimals?: number;
  fiscal?: never;
}

/**
 * Numbers with SI prefixes, by thousands from n to E, before the unit `si`:
 * 1500000 with `{ si: "B" }` is "1.5 MB", 0.45 with `{ si: "W" }` "450 mW".
 * The prefix is chosen after rounding; values are in the unit already.
 */
export interface SiFormat {
  /** The unit's symbol, written after the prefix. @examples ["B", "b/s", "W", "Hz"] */
  si: string;
  /** Decimals, kept when zero; by default up to 1, zeros dropped. @integer @minimum 0 @maximum 20 */
  decimals?: number;
  fiscal?: never;
}

/**
 * Numbers with binary prefixes, by 1,024s from Ki to Ei, before the unit
 * `binary`: 1572864 with `{ binary: "B" }` is "1.5 MiB"; values under 1,024
 * take none. The prefix is chosen after rounding.
 */
export interface BinaryFormat {
  /** The unit's symbol, written after the prefix. @examples ["B", "b"] */
  binary: string;
  /** Decimals, kept when zero; by default up to 1, zeros dropped. @integer @minimum 0 @maximum 20 */
  decimals?: number;
  fiscal?: never;
}

/** A d3-format pattern, with text before and after it: 1234 with `{ number: ".3~s", suffix: " req/s" }` is "1.23k req/s". */
export interface NumberPatternFormat {
  /** @examples [",.2f", ".1%", "~s"] */
  number: string;
  /** Text before the number. */
  prefix?: string;
  /** Text after the number. @examples [" req/s", "%"] */
  suffix?: string;
  fiscal?: never;
}

/** A strftime pattern, in the scale's time zone, with years and quarters of a `fiscal` year if given. */
export interface TimePatternFormat {
  /** @examples ["%b %d %H:%M", "%Y-%m-%d"] */
  time: string;
  fiscal?: FiscalSpec;
}

/**
 * How numbers are written: Intl.NumberFormat options; `{ number }`, a
 * d3-format pattern; `{ duration }`, lengths of time; or `{ si }` and
 * `{ binary }`, a unit after a prefix.
 */
export type NumberFormatSpec =
  | (Intl.NumberFormatOptions & { fiscal?: never })
  | NumberPatternFormat
  | DurationFormat
  | SiFormat
  | BinaryFormat;

/** How times are written: Intl.DateTimeFormat options, or `{ time }`, a strftime pattern. */
export type TimeFormatSpec = (Intl.DateTimeFormatOptions & { fiscal?: never }) | TimePatternFormat;

/**
 * How values are written: numbers as `NumberFormatSpec` says (Intl
 * options, a d3-format pattern such as ",.2f" or ".1%", a duration, or a
 * unit with SI or binary prefixes), times as `TimeFormatSpec` says (Intl
 * date options, or a strftime pattern such as "%b %d %H:%M"). The forms
 * are told apart by their keys (`number`, `time`, `duration`, `si`,
 * `binary`); a format gives one of them, or Intl options.
 */
export type FormatSpec = NumberFormatSpec | TimeFormatSpec;

/**
 * Tick marks: out from the plot (the default), in over it, or across the
 * axis line ("cross", half each way); `length` in pixels (for "cross", the
 * whole length).
 */
export interface TickMarkSpec {
  direction?: "out" | "in" | "cross";
  /** @minimum 0 */
  length?: number;
}

/**
 * What a row of tick labels does where labels would overlap: "show" draws
 * them all; "hide" leaves out labels until the rest fit, those of higher
 * `priority` last; "stagger" moves every other one to a second row; "wrap"
 * breaks labels into lines.
 */
export type TickOverlap = "show" | "hide" | "stagger" | "wrap";

/** How a layer's tick labels are written and placed. */
export interface TickLabelsSpec {
  /**
   * Degrees clockwise, from -90 (reading up) to 90 (reading down); or
   * angles tried in order, the first at which the labels fit. @minimum -90 @maximum 90
   */
  rotation?:
    | number
    | {
        /** @minimum -90 @maximum 90 @minItems 1 */
        candidates: readonly number[];
      };
  /** Overlapping labels: drawn all ("show"), the default for number and time axes, or as `TickOverlap` says. */
  overlap?: TickOverlap;
  /** The row of labels, 0 by the axis line and 1 beyond it. @integer @minimum 0 */
  row?: number;
  /** Which labels stay where labels collide, the higher; 0 by default. @default 0 */
  priority?: number;
  /**
   * Labels that repeat the one before them: left blank, their ticks kept ("hide", the default), or drawn ("show").
   * @default "hide"
   */
  duplicates?: "hide" | "show";
  /**
   * Draw the labels inside the plot, beside their ticks, rather than
   * outside it, taking none of the room outside; rows then advance inward.
   * Flat labels, inside or out, stand at their ticks along the axis as
   * `style.tickLabel` aligns them: on x its `align`, on y its
   * `verticalAlign`; centered by default. Not on colorbars.
   */
  inside?: boolean;
  /**
   * Pixels from the labels to their tick's end on their side (half a
   * "cross" tick's length; the axis line where the tick does not reach
   * their side), 0 or more. @minimum 0
   */
  gap?: number;
}

/**
 * A layer of an axis' ticks: its own ticks, format, tick marks, and labels,
 * such as minor ticks or a row of day boundaries under hourly labels.
 * `false` leaves out its tick marks or labels.
 */
export interface TickLayerSpec {
  /** Unique among the axis' layers; "major" names the axis' own ticks. */
  id: string;
  ticks?: TicksSpec;
  format?: FormatSpec;
  tick?: TickMarkSpec | false;
  labels?: TickLabelsSpec | false;
  /** How its tick marks and labels look, over the axis'. */
  style?: Pick<AxisStyles, "tick" | "tickLabel">;
}

/**
 * Room between the data and a plot's edges, along a position scale:
 * "auto" (the default) leaves room for what marks draw at their values
 * (markers whole, bars' widths) on domains fitted to the data, and keeps
 * explicit domains and views exact; a number widens the domain by that
 * share of its span at each end (`[a, b]` becomes `[a - p(b - a), b +
 * p(b - a)]`, in the scale's transformed space: logs on a log scale), from
 * 0 up to but not including 0.5; `{ px }` keeps that many pixels at each
 * end. 0 turns automatic room off.
 * @minimum 0 @exclusiveMaximum 0.5
 */
export type ScalePadding =
  | "auto"
  | number
  | {
      /** @minimum 0 */
      px: number;
    };

/**
 * A position scale's settings: the short forms `x`, `y`, and `yRight` hold
 * these with their axes' settings. Under another name in the chart's
 * `scales`, a position scale of its own, which marks place values on with
 * `{ field, scale }` and which has no axis unless an axis guide names it;
 * such a scale gives its `type`.
 */
export interface ScaleSpec {
  /** Inferred from the data when omitted: time fields get "time". */
  type?: "linear" | "log" | "time";
  /** Fixed domain. Time domains are epoch milliseconds. */
  domain?: readonly [number, number];
  /** Extend the domain to round values (see the short forms). */
  nice?: boolean;
  /** Include zero in the domain. */
  zero?: boolean;
  /** Room between the data and the plot's edges along the scale. */
  padding?: ScalePadding;
  /** Which panels share one instance of the scale. */
  scope?: ScaleScope;
  /** How tooltips, the keyboard, and crosshair labels write one value; the axis' format by default. */
  tooltipFormat?: FormatSpec;
}

/**
 * The chart's scales by name: the position scales x, the left y, and the
 * right y, scales of categories ("color", which color fields read unless
 * they name another, "symbol", "dash", or names marks give), identity
 * scales, and channel scales, which map numbers onto widths, opacities,
 * sizes, and colors (those with a `range`).
 */
export interface ScalesSpec {
  x?: ScaleSpec;
  y?: ScaleSpec;
  yRight?: ScaleSpec;
  readonly [name: string]:
    | ScaleSpec
    | OrdinalScaleSpec
    | IdentityScaleSpec
    | ChannelScaleSpec
    | undefined;
}

/**
 * A scale a guide shows: one a mark owns, by the mark's `id` and the
 * channel (its series colors, "series"; a color field's ramp or colors,
 * "color", which are its series' where its color splits them; its sizes,
 * "size"; or its symbols, "symbol"), or one of the chart's `scales` by
 * name (`{ scale }`), with every value any mark reads through it. Guides
 * naming a mark show it whatever its `legend` setting.
 */
export type ScaleRef =
  | { mark: string; channel: "series" | "color" | "size" | "symbol"; scale?: never }
  | { scale: string; mark?: never; channel?: never };

/**
 * A mark a legend lists whole: its series, or for an annotation, what its
 * label names (one entry, or one per value of its label's field).
 */
export interface MarkRef {
  mark: string;
  channel?: never;
  scale?: never;
}

/** What a legend lists: a scale's values, or a mark's entries. */
export type LegendInclude = ScaleRef | MarkRef;

/**
 * An axis showing a position scale along a side of the plots: its ticks
 * (the "major" layer) and more `layers`, its title, and how it looks.
 * Unset settings take the short form's (`x`, `y`, or `yRight`).
 */
export interface AxisGuideSpec {
  type: "axis";
  /** Unique among the chart's guides. */
  id?: string;
  /** "x", "y", "yRight", or a position scale of the chart's `scales`, which then needs `place`. */
  scale: "x" | "y" | "yRight" | (string & {});
  /** Below the plots (x) or left of them (y) by default; x above, y on the right. */
  place?: { side: Side };
  title?: AxisTitleSpec;
  ticks?: TicksSpec;
  format?: FormatSpec;
  tick?: TickMarkSpec | false;
  labels?: TickLabelsSpec | false;
  /** The axis' line along the plot: x axes draw it, y axes do not, by default. */
  line?: boolean;
  /** Grid lines at its major ticks across the plot; the scale's default axis draws them by default. */
  grid?: boolean | GridLinesSpec;
  layers?: readonly TickLayerSpec[];
  /** Draw the axis; true by default. @default true */
  show?: boolean;
  /**
   * Where panels sharing the scale label it: on the outer edge of panels
   * lined up with each other ("outer", the default), or on every panel ("all"). @default "outer"
   */
  repeat?: "outer" | "all";
  /**
   * Pixels a y axis' tick marks and labels take beside the plot: a fixed
   * room, so that the plots of charts and panels line up, or bounds on the
   * room its labels need. Labels wider than it are shortened with an
   * ellipsis. Y axes only. @minimum 0
   */
  room?:
    | number
    | {
        /** @minimum 0 */
        min?: number;
        /** @minimum 0 */
        max?: number;
      };
  style?: AxisStyles;
}

/**
 * Grid lines across the plot at an axis' major ticks: `zIndex` places them
 * among the marks (-1, under marks of the default 0, by default).
 */
export interface GridLinesSpec {
  zIndex?: number;
}

/**
 * A sample drawn for a legend entry: a line, a filled box, or a point's
 * symbol ("circle" by default; `size` pixels across, 10 by default),
 * outlined by a 1-pixel `stroke`, or several over each other. An entry can
 * also show a mark's look by its `sample` of the mark.
 */
export type SwatchSpec =
  | {
      type: "line";
      stroke: string;
      /** @minimum 0 */
      strokeWidth?: number;
      dash?: Dash;
      /** @minimum 0 @maximum 1 */
      opacity?: number;
    }
  | {
      type: "rect";
      fill: string;
      stroke?: string;
      /** @minimum 0 @maximum 1 */
      opacity?: number;
    }
  | {
      type: "symbol";
      symbol?: SymbolName;
      fill: string;
      stroke?: string;
      /** @exclusiveMinimum 0 */
      size?: number;
      /** @minimum 0 @maximum 1 */
      opacity?: number;
    }
  | {
      type: "composite";
      /** @minItems 1 */
      parts: readonly SwatchSpec[];
    };

/**
 * What a legend entry of your own hides and shows: a mark whole, the rows
 * of a mark whose `field` holds one of `values`, or the values of one of
 * the chart's scales (in every mark reading it). The entry is hidden when
 * everything it targets is.
 */
export type LegendTarget =
  | { mark: string; field?: never; values?: never; scale?: never }
  | { mark: string; field: string; values: readonly string[]; scale?: never }
  | { scale: string; values: readonly string[]; mark?: never; field?: never };

/**
 * A legend entry of your own: its label, and either a swatch or a sample
 * drawn as mark `sample.mark` draws its entries; with `targets`, clicking
 * it hides and shows what they name. Its `key` is unique among the
 * legend's own entries.
 */
export interface LegendEntrySpec {
  key: string;
  label: string;
  swatch?: SwatchSpec;
  sample?: { mark: string };
  targets?: readonly LegendTarget[];
}

/** A legend's title: its text, or its text and how it looks. */
export type LegendTitleSpec = string | { text: string; style?: TextStyle };

/** How a legend lays out and draws its entries, as the short form `legend` and legend guides take it. */
export interface LegendOptionsSpec {
  /**
   * Outside on a side (above the plots by default; on the left or right in a
   * column), or inside a plot at a corner, over what it draws.
   */
  place?: Place;
  /** Entries in this many columns, filled row by row (or as `order` says). @integer @minimum 1 */
  columns?: number;
  /** Entries in this many rows. @integer @minimum 1 */
  rows?: number;
  /** Fill the grid row by row ("row", the default with `columns`) or down each column ("column", the default with `rows`). */
  order?: "row" | "column";
  title?: LegendTitleSpec;
  /**
   * What the legend lists of the chart's scales and marks: every one a
   * legend shows by default; `[]` for its own `entries` alone.
   */
  include?: readonly LegendInclude[];
  /** Entries of your own, after those `include` gives. */
  entries?: readonly LegendEntrySpec[];
  /** Swatches that look like the marks: a dashed line for a dashed line, a symbol for points. */
  swatches?: "mark";
  style?: LegendStyles;
  /**
   * What a click (or Enter) on an entry does: "hide" (the default) hides
   * and shows what it names; "select" selects it, as a series selection
   * (Shift adds it or takes it out; a click on the one selected clears
   * it); `false`, nothing of the chart's own (`click` events still report
   * it). @default "hide"
   */
  action?: LegendAction;
}

/** What activating a legend entry does (see `LegendOptionsSpec.action`). */
export type LegendAction = "hide" | "select" | false;

/** A legend: the entries of what it includes (all the chart's by default), laid out as its options say. */
export interface LegendGuideSpec extends LegendOptionsSpec {
  type: "legend";
  id?: string;
  /**
   * The id of the subplot (or inset) whose marks it lists: it goes above
   * that panel by default, and its entries hide and show them there only.
   * The chart's own legend then lists what no panel's legend does.
   */
  panel?: string;
  show?: boolean;
}

/**
 * A continuous color scale's legend: a bar of its colors along its values,
 * with ticks as an axis has them. Beside the plots it stands vertically,
 * low values at the bottom; above or below them, across, low values at the
 * left.
 */
export interface ColorbarSpec {
  type: "colorbar";
  id?: string;
  /** The scale it shows; the chart's only color ramp when left out. */
  scale?: ScaleRef;
  /** On the right of the plots by default. */
  place?: Place;
  title?: LegendTitleSpec;
  ticks?: TicksSpec;
  format?: FormatSpec;
  tick?: TickMarkSpec | false;
  labels?: TickLabelsSpec | false;
  /** More layers of ticks along the bar, as axes take them. */
  layers?: readonly TickLayerSpec[];
  /**
   * Pixels along its values; the plots' height (or width) by default, up to 240.
   * @exclusiveMinimum 0
   */
  length?: number;
  /** Pixels across; 12 by default. @exclusiveMinimum 0 @default 12 */
  thickness?: number;
  show?: boolean;
  style?: Pick<AxisStyles, "tick" | "tickLabel"> & Pick<LegendStyles, "legendTitle">;
}

/** A guide: an axis, a legend, or a colorbar. */
export type GuideSpec = AxisGuideSpec | LegendGuideSpec | ColorbarSpec;
