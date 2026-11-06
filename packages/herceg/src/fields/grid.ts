// What a grid writes of a field through field displays (grid models'
// `fields`): a column's header and description, its cells, its values as
// group keys, and aggregates of its values in its units
// (docs/guide/grids.md).

import type { Schema, Table } from "../data/table.ts";
import { FULL_TIME } from "../format/format.ts";
import type { DisplayedKind } from "../spec/fields.ts";
import type { FormatSpec } from "../spec/guides.ts";
import {
  type CompiledFields,
  type DisplaySettings,
  type FieldColumns,
  hasLink,
} from "./display.ts";
import type { LinkRows, RowLink } from "./links.ts";

/** What a grid column shows through its field's display (see `columnDisplay`). */
export interface ColumnDisplay {
  /** The header's text: the column's own title, else the field's label. */
  readonly title: string;
  /** The field's description: the header's title and accessible description. */
  readonly description: string | undefined;
  /**
   * The cell text of row `position` of a table, or of a remote grid's
   * window of rows. A category field's values are written once per entry
   * of its dictionary, the first time a cell shows it; a dictionary
   * replaced or compacted is written again.
   */
  text(table: FieldColumns, position: number): string;
  /** A value of the field as text, as cells write it. */
  format(value: string | number | null): string;
  /** A group's key as group rows write it: as cells do, but a missing key as "(missing)" where the field gives no missing text. */
  key(value: string | number | null): string;
  /** An aggregate of the field's values in its units (a sum, a mean) as text: its format, without mappings. */
  amount(value: number): string;
  /**
   * A value's display color: the missing color for a missing value, its
   * mapping's, or its threshold step's; undefined where none gives one.
   */
  color(value: string | number | null): string | undefined;
  /** The field's bounds, where its display gives them. */
  readonly min: number | undefined;
  readonly max: number | undefined;
  /**
   * Row `row`'s link of `table`, its text written as cells write values
   * (see `DisplayedField.link`), which text cells draw; undefined where the
   * field's display gives no link.
   */
  readonly link: ((table: LinkRows, row: number) => RowLink | undefined) | undefined;
  /** The fields its link reads besides the field: what a remote grid asks for with it. */
  readonly reads: readonly string[];
}

/** A grid column's field, and its own settings that its display takes. */
export interface GridColumnSettings {
  readonly field: string;
  readonly title?: string | undefined;
  readonly format?: FormatSpec | undefined;
}

/**
 * What a grid column (its field, and its own title and format) of a field
 * of `kind` in `table` (a table, or a remote source's name, which rules
 * naming tables match) shows through `fields`, in the grid's locale and
 * zone. Times without a format are written to the second, as grids write
 * them; missing values are empty in cells and "(missing)" in group keys
 * where the field gives no missing text.
 */
export function columnDisplay<S extends Schema>(
  fields: CompiledFields,
  { field, title, format }: GridColumnSettings,
  kind: DisplayedKind,
  table: Table<S> | string | undefined,
  { locale, timeZone }: Pick<DisplaySettings, "locale" | "timeZone">,
): ColumnDisplay {
  const of = { field, kind, table } as { field: string; kind: DisplayedKind };
  const settings = { locale, timeZone, format, defaultFormat: FULL_TIME };
  const shown = fields.displayOf(of, { ...settings, missing: "" });
  const key = fields.displayOf(of, { ...settings, missing: "(missing)" }).text;
  const { text } = shown;
  // Each dictionary's entries shown so far, as written, by code: codes keep
  // their entries while the dictionary only grows at its end.
  const tables = new WeakMap<readonly string[], { revision: unknown; texts: string[] }>();
  return {
    title: title ?? shown.label,
    description: shown.description,
    format: text as ColumnDisplay["format"],
    key: key as ColumnDisplay["key"],
    amount: shown.format as ColumnDisplay["amount"],
    color: shown.color as ColumnDisplay["color"],
    min: shown.min,
    max: shown.max,
    link: hasLink(shown) ? (shown.link as ColumnDisplay["link"]) : undefined,
    reads: shown.linkFields.filter((name) => name !== field),
    text: (table, position) => {
      if (kind !== "category") return text(table.numbers(field)[position]!);
      const { codes, dictionary, revision } = table.categories(field);
      const code = codes[position]!;
      if (code < 0) return text(null);
      let held = tables.get(dictionary);
      if (!held || held.revision !== revision) {
        held = { revision, texts: [] };
        tables.set(dictionary, held);
      }
      held.texts[code] ??= text(dictionary[code]!);
      return held.texts[code]!;
    },
  };
}
