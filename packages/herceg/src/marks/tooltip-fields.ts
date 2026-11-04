// Fields of rows that tooltips show besides a mark's values (a mark's
// `tooltip.fields`), checked against the mark's table when the mark is
// made; charts read them for inspections with dom/tooltip-content.ts.

import type { FieldKind } from "../data/column.ts";
import type { PositionField, Schema, Table } from "../data/table.ts";
import type { Formatter } from "../format/format.ts";
import type { FormatKit } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { NumberFormatSpec, TimeFormatSpec } from "../spec/guides.ts";
import type { Frozen, MarkTooltipSpec } from "../spec/spec.ts";
import { requireField } from "./mark.ts";

/**
 * What a mark's tooltips show of the rows they are at, besides its values:
 * fields of its table, by name or with a label and a format.
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
}

/** The fields a mark's tooltip shows of `row`; undefined for a mark without any. */
export type FieldReader = (
  table: Table | undefined,
  tooltip: Frozen<MarkTooltipSpec> | undefined,
  row: number,
) => InspectedField[] | undefined;

/**
 * Makes field readers in a chart's locale and zone, which write with the
 * chart's code (`kit`, see `GuideKit`): numbers as the chart's other
 * numbers, and times as `times` does (the x axis' formatter, on time axes),
 * unless a field has a format (see dom/tooltip-content.ts).
 */
export type FieldReaders = (
  locale: string | undefined,
  zone: TimeZone,
  kit: FormatKit & { formatNumber(value: number, locale?: string): string },
  times?: Formatter,
) => FieldReader;

const KINDS: readonly FieldKind[] = ["number", "time", "category"];

/** Refuses fields a mark's tooltip shows that its table does not have, naming them as `mark` does. */
export function checkTooltip(
  table: Table | undefined,
  tooltip: Frozen<MarkTooltipSpec> | undefined,
  mark: string,
): void {
  tooltip?.fields?.forEach((entry, i) => {
    const field = typeof entry === "string" ? entry : entry.field;
    requireField(table!, field, KINDS, `${mark} tooltip.fields[${i}]`);
  });
}
