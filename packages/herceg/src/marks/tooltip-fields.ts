// What marks' tooltips show of the rows they are at besides their values:
// fields of the row (a mark's `tooltip.fields`) and a row of parts in place
// of the name and value (`tooltip.content`), checked against the mark's
// table when the mark is made; charts write them for inspections with
// marks/tooltip-writers.ts.

import type { PositionField, Schema, Table } from "../data/table.ts";
import type { RowLink } from "../fields/links.ts";
import type { Formatter } from "../format/format.ts";
import type { FormatKit } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { CompiledFeatures } from "../model/features.ts";
import type { PartStyle } from "../spec/encoding.ts";
import type { NumberFormatSpec, TimeFormatSpec } from "../spec/guides.ts";
import type { Frozen, MarkTooltipSpec } from "../spec/spec.ts";
import type { LabelPartOf } from "./encoding.ts";
import { ANY_KIND, requireField } from "./mark.ts";

/**
 * What a mark's tooltips show of the rows they are at: fields of its
 * table besides its values, by name or with a label and a format, and a
 * row of parts in place of each point's name and value.
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
}

/**
 * What `mark`'s tooltip writes of `point`: the fields of `row` (its table's
 * row the point is; undefined where no one row is) and its content, a
 * layout item's `names` (from the top) naming it by the fields of its
 * path or category; undefined for a mark that writes neither.
 */
export type TooltipWriter = (
  mark:
    | {
        readonly table?: Table | undefined;
        readonly spec: { readonly tooltip?: Frozen<MarkTooltipSpec> | undefined };
      }
    | undefined,
  row: number | undefined,
  point: PointText,
  names?: readonly string[],
) => TooltipText | undefined;

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
 * Refuses fields a mark's tooltip shows, and fields its content's parts
 * read, that its table does not have, naming them as `mark` does.
 */
export function checkTooltip(
  table: Table | undefined,
  tooltip: Frozen<MarkTooltipSpec> | undefined,
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
  tooltip?.content?.forEach((part, i) => {
    // Literal text reads no field.
    const { field, label } = part as { field?: string; label?: string };
    const read = field ?? label;
    if (read !== undefined)
      requireField(
        table!,
        read,
        ANY_KIND,
        `${mark} tooltip.content[${i}].${field ? "field" : "label"}`,
      );
  });
}
