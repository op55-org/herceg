// What marks' tooltips show of the rows they are at besides their values:
// fields of the row (a mark's `tooltip.fields`), a row of parts in place
// of the name and value (`tooltip.content`), and parts heading a tooltip of
// one point (`tooltip.heading`), checked against the mark's table when the
// mark is made; charts write them for inspections with
// marks/tooltip-writers.ts.

import type { PositionField, Schema, Table } from "../data/table.ts";
import type { RowLink } from "../fields/links.ts";
import type { Formatter } from "../format/format.ts";
import type { FormatKit } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { CompiledFeatures } from "../model/features.ts";
import type { AxisInspection } from "../model/inspect.ts";
import type { PartStyle, PathPart } from "../spec/encoding.ts";
import type { NumberFormatSpec, TimeFormatSpec } from "../spec/guides.ts";
import type { AnyTooltipSpec, Frozen, TooltipTotalSpec } from "../spec/spec.ts";
import type { LabelPartOf } from "./encoding.ts";
import { ANY_KIND, requireField } from "./mark.ts";

/**
 * What a mark's tooltips show of the rows they are at: fields of its
 * table besides its values, by name or with a label and a format, a row
 * of parts in place of each point's name and value, and parts heading a
 * tooltip of one of its points.
 */
export interface MarkTooltip<S extends Schema> {
  /**
   * Fields of the row, shown in order under the mark's values: data that is
   * not plotted, such as a request count. A format writes a number field
   * in any of numbers' forms (`NumberFormatSpec`), a time field in any of
   * times' (`TimeFormatSpec`); without one, numbers are written as the
   * chart's other numbers, times as the x axis writes them when it is a
   * time axis (else as dates and times), and categories as they are. The
   * keyboard's announcements and hover events read them too.
   */
  fields?: readonly (PositionField<S> | TooltipFieldOf<S>)[];
  /**
   * Each point's row as one line of parts, in place of its name and value:
   * text, `{ series: true }` (what the tooltip names the point by),
   * `{ value: true }` (its value as the tooltip writes it, or in `format`,
   * a time where it is a time pattern or Intl date options),
   * `{ field }` of its row (as `fields` write it, or in `format`; "–"
   * where no one row is the point, as for a slice of several rows), or
   * `{ label }` (a field's label), each in its `style`. The swatch stays,
   * `fields` follow under it, and the keyboard's announcements, hover
   * events, and `chart.inspect()` read the same text.
   * @minItems 1
   */
  content?: readonly LabelPartOf<keyof S & string>[];
  /**
   * The tooltip's heading where it shows one point of this mark alone
   * (inspection "nearest", an item, or one series read), in place of the
   * place it reads: parts written from that point's row, as `content`'s
   * are, such as a range item's id or ends (`[{ field: "start" }, "–",
   * { field: "end" }]`). Tooltips of several points keep the place, and
   * the chart's `tooltip: { heading: false }` leaves every heading out.
   * Inspected points carry it (`point.heading`); the keyboard announces
   * the place, and this heading before the point.
   * @minItems 1
   */
  heading?: readonly LabelPartOf<keyof S & string>[];
}

/**
 * A treemap's or sunburst's tooltip: as `MarkTooltip`, its content and
 * heading taking `{ path: true, separator? }` too, the node's names from
 * the top of the whole tree, each as its path field's display writes it,
 * joined by `separator` (" / " by default).
 */
export interface TreeTooltip<S extends Schema> extends Omit<MarkTooltip<S>, "content" | "heading"> {
  /**
   * As `MarkTooltip.content`, and `{ path: true }`: "Europe / France", or
   * `{ path: true, separator: "/" }` for "Europe/France". A node of the
   * first level writes its own name, the middle of a drilled view the
   * levels it stands for.
   * @minItems 1
   */
  content?: readonly (LabelPartOf<keyof S & string> | PathPart)[];
  /**
   * As `MarkTooltip.heading`, and `{ path: true }`, the node's levels.
   * @minItems 1
   */
  heading?: readonly (LabelPartOf<keyof S & string> | PathPart)[];
}

/**
 * A row after a mark's points in a reading along an axis, summing their
 * values: `true`, or `{ label, format }` ("Total" by default; a number
 * format, else as the points' values are written).
 */
export type TooltipTotal = TooltipTotalSpec;

/**
 * The tooltip of a mark whose points carry one number each (lines, filled
 * areas, bars, points, custom marks): as `MarkTooltip`, with `total`.
 */
export interface SeriesTooltip<S extends Schema> extends MarkTooltip<S> {
  /**
   * A row after the mark's points in a reading along an axis (any mode but
   * "nearest"), the sum of the values it lists of the mark (one point
   * too): hidden series and series reading nothing there are left out; a
   * stack's points carry their own values, a normalized stack's their raw
   * ones; under `snap: "each"` they may stand at different places. Written
   * as the points' values are (their value fields' display over the axis'
   * `tooltipFormat`; the axis' alone where the value fields' displays
   * differ), or in `format`, under `label` ("Total" by default). A sum that
   * is not finite shows no row. Category and time values, and ranges, have
   * none: refused. Inspections carry it (`inspection.totals`), as hover and
   * click events, `chart.inspect()`, `renderTooltip`, and the keyboard's
   * `i` read it.
   */
  total?: TooltipTotal;
}

/** A tooltip field with a label and a format of its kind's forms. */
type TooltipFieldOf<S extends Schema> = {
  [F in PositionField<S>]: { field: F; label?: string; format?: FormatFor<S[F]> };
}[PositionField<S>];

/** The formats a field of kind `K` takes: numbers' forms, times', or none for categories. */
type FormatFor<K> = K extends "number"
  ? NumberFormatSpec
  : K extends "time"
    ? TimeFormatSpec
    : never;

/** A field of the row a tooltip is at, as it shows it. */
export interface InspectedField {
  field: string;
  /** What the tooltip names it by: its `label`, or the field's name. */
  label: string;
  /** The field's kind, which says how to read `value`. */
  kind: "number" | "time" | "category";
  /** The row's value: a number (epoch milliseconds for times), a category, or null when missing. */
  value: number | string | null;
  /** The value as the tooltip writes it. */
  text: string;
  /**
   * The value's color, as the chart's field displays give it (thresholds,
   * mappings, missing values; see `displayOf`), where they give it one; the
   * built-in tooltip draws it as a swatch beside the value.
   */
  color?: string;
  /**
   * The value's link, as the chart's field displays make it (`link`; see
   * `displayOf`): an http, https, mailto, or relative URL, and its text,
   * which the built-in tooltip writes for the value, as a link once pinned.
   */
  link?: RowLink;
}

/** A run of a tooltip's row (`tooltip.content`): a part's text, in its style. */
export interface ContentRun {
  text: string;
  style?: PartStyle;
}

/** A point as its tooltip writes it, which its content's parts read: what names it, its value, and that value written. */
export interface PointText {
  label: string;
  value: number;
  text: string;
}

/** What a mark's tooltip writes of a point besides its name and value. */
export interface TooltipText {
  fields?: InspectedField[];
  content?: ContentRun[];
  heading?: ContentRun[];
}

/** A mark as tooltip writers read it: its table, and its spec's type, tooltip, and id. */
export interface WrittenMark {
  readonly table?: Table | undefined;
  readonly spec: {
    readonly type: string;
    readonly tooltip?: Frozen<AnyTooltipSpec> | undefined;
    readonly id?: string | undefined;
  };
}

/** A mark that totals readings, as tooltip writers read it: its value fields (`Mark.identity`) and how it is read besides. */
export type TotalingMark = WrittenMark & {
  readonly identity?: { readonly values: readonly string[] } | undefined;
  readonly tooltip: string;
};

/** A mark whose tooltip totals a reading: its index in the chart's marks, and how its totals are written. */
export interface TotaledMark {
  readonly mark: TotalingMark;
  readonly index: number;
  readonly text: Formatter;
}

/**
 * Writes what marks' tooltips show of points besides their names and
 * values, and the totals of readings.
 */
export interface TooltipWriter {
  /**
   * What `mark`'s tooltip writes of `point`: the fields of `row` (its
   * table's row the point is; undefined where no one row is), its content,
   * and its heading, a layout item's `names` (from the top) naming it by
   * the fields of its path or category; undefined for a mark that writes
   * none.
   */
  (
    mark: WrittenMark | undefined,
    row: number | undefined,
    point: PointText,
    names?: readonly string[],
  ): TooltipText | undefined;
  /**
   * How `mark`'s totals are written in a panel (see `tooltipWriters`),
   * where `axisText` writes its values on their axis. Refuses totals of
   * ranges (among its `series` there), categories, and times, which have
   * no sum, and formats that do not write numbers.
   */
  total(
    mark: TotalingMark,
    series: readonly { readonly range: boolean }[],
    axisText: Formatter,
  ): Formatter;
  /**
   * Gives `inspection`, a reading along an axis, the totals of its points
   * of `marks`, in place: of each that it lists points of, their values'
   * sum and its text. Leaves none where no mark has one.
   */
  totals(marks: readonly TotaledMark[], inspection: AxisInspection): void;
}

/**
 * Makes tooltip writers in a chart's locale and zone, which write with the
 * chart's code (`kit`, see `GuideKit`): through the chart's field displays
 * (`features.fields`), else numbers as the chart's other numbers, and
 * times as `times` does (the x axis' formatter, on time axes), unless a
 * part or field has a format (see marks/tooltip-writers.ts); `report`
 * tells the chart of parts it writes otherwise than they ask.
 */
export type TooltipWriters = (
  locale: string | undefined,
  zone: TimeZone,
  kit: FormatKit & { formatNumber(value: number, locale?: string): string },
  features?: Pick<CompiledFeatures, "fields">,
  report?: (error: Error) => void,
  times?: Formatter,
) => TooltipWriter;

/**
 * Refuses fields a mark's tooltip shows, and fields its content's and
 * heading's parts read, that its table does not have, naming them as
 * `mark` does. Parts and totals the mark does not take are refused by
 * its types and by the spec validator.
 */
export function checkTooltip(
  table: Table | undefined,
  tooltip: Frozen<AnyTooltipSpec> | undefined,
  mark: string,
): void {
  tooltip?.fields?.forEach((entry, i) => {
    requireField(
      table!,
      typeof entry === "string" ? entry : entry.field,
      ANY_KIND,
      `${mark} tooltip.fields[${i}]`,
    );
  });
  for (const list of ["content", "heading"] as const)
    tooltip?.[list]?.forEach((part, i) => {
      // Literal text reads no field.
      const { field, label } = part as { field?: string; label?: string };
      const read = field ?? label;
      if (read !== undefined)
        requireField(
          table!,
          read,
          ANY_KIND,
          `${mark} tooltip.${list}[${i}].${field ? "field" : "label"}`,
        );
    });
}
