// What a grid writes of a field through field displays (grid models'
// `fields`, from `compileFields`): a column's header and description, its
// cells, its values as group keys, and aggregates of its values in its
// units. Grids reach it only through the compiled displays they are given,
// so a grid without them carries none of it (docs/guide/grids.md).

import type { FormatSpec } from "../spec/guides.ts";
import type { DisplayedField, FieldColumns } from "./display.ts";

/** What a grid column shows through its field's display (see `CompiledFields.column`). */
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
}

/** A grid column's field, and its own settings that its display takes. */
export interface GridColumnSettings {
  readonly field: string;
  readonly title?: string | undefined;
  readonly format?: FormatSpec | undefined;
}

/**
 * What a grid column of the field `shown` displays shows, titled `title`
 * where the column gives one.
 */
export function columnDisplay(
  shown: DisplayedField,
  title: string | undefined,
  key: DisplayedField["text"],
): ColumnDisplay {
  const { field, kind, text } = shown;
  // Each dictionary's entries shown so far, as written, by code: codes keep
  // their entries while the dictionary only grows at its end.
  const tables = new WeakMap<readonly string[], { revision: unknown; texts: string[] }>();
  return {
    title: title ?? shown.label,
    description: shown.description,
    format: text as ColumnDisplay["format"],
    key: key as ColumnDisplay["key"],
    amount: shown.format as ColumnDisplay["amount"],
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
