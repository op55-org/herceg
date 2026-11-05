// herceg/fields: field display for application code. `displayOf` resolves
// field displays (`fields`, the record or rules charts and grids take) for
// one field: its label, description, bounds, and each value's text, as
// surfaces write them; `compileFields` checks and compiles them once, for
// application code and for charts and grids to share; `fieldsOf` writes
// rules for a table's fields, checked against its schema. See
// docs/guide/fields.md.

import type { FieldKind } from "./data/column.ts";
import type { RowView } from "./data/row-view.ts";
import type { FieldName, PositionField, Schema, Table } from "./data/table.ts";
import { compile, type FieldAsked, KIT, kindOf } from "./fields/compiled.ts";
import type { DisplayedField, DisplaySettings } from "./fields/display.ts";
import { type FieldDisplays, type FieldRule, resolve, rulesOf } from "./fields/rules.ts";
import type {
  CategoryFieldDisplay,
  DisplayedKind,
  NumberFieldDisplay,
  TimeFieldDisplay,
} from "./spec/fields.ts";

export { compileFields } from "./fields/compiled.ts";
export type {
  CompiledFields,
  DisplayedField,
  DisplaySettings,
  FieldColumns,
} from "./fields/display.ts";
export type { LinkRows, RowLink } from "./fields/links.ts";
export type { FieldDisplays, FieldMatch, FieldRule, TableRef } from "./fields/rules.ts";
export type {
  CategoryFieldDisplay,
  CategoryMapping,
  DisplayedKind,
  FieldDisplay,
  FieldLink,
  FieldLinkOf,
  LinkPart,
  MissingDisplay,
  NumberFieldDisplay,
  NumberMapping,
  ThresholdStep,
  Thresholds,
  TimeFieldDisplay,
  ValueMapping,
} from "./spec/fields.ts";

/** The display a field of kind `K` takes (what its kind writes), its link's parts naming fields `F`. */
export type DisplayFor<K extends FieldKind, F extends string = string> = K extends "number"
  ? NumberFieldDisplay<F>
  : K extends "time"
    ? TimeFieldDisplay<F>
    : K extends "category"
      ? CategoryFieldDisplay<F>
      : never;

/**
 * A field's display from `fields` (displays by name, or rules): its label,
 * description, bounds, and each value's text, as surfaces write them, in
 * `settings`' locale and time zone. The field is a table's (its kind the
 * table's), or given by name and kind, and its table, for rules naming
 * tables, by name.
 *
 * ```ts
 * const latency = displayOf(fields, { table: requests, field: "latency" });
 * latency.text(66_000); // "1m 6s", with { latency: { format: { duration: "millisecond" } } }
 * ```
 */
export function displayOf<K extends DisplayedKind>(
  fields: FieldDisplays,
  of: { field: string; kind: K; table?: string },
  settings?: DisplaySettings,
): DisplayedField<K>;
export function displayOf<S extends Schema, F extends PositionField<S>>(
  fields: FieldDisplays,
  of: { table: Table<S> | RowView<S>; field: F },
  settings?: DisplaySettings,
): DisplayedField<S[F] & DisplayedKind>;
export function displayOf(
  fields: FieldDisplays,
  of: FieldAsked<Schema, string, DisplayedKind>,
  settings?: DisplaySettings,
): DisplayedField {
  return compile(fields, "displayOf").displayOf(
    of as { field: string; kind: DisplayedKind },
    settings,
  );
}

/**
 * Rules giving `table`'s fields the displays `displays` names them by,
 * checked against its schema: each field takes what its kind writes. The
 * rules match the table's fields (and their row views', and tables derived
 * from it that pass them through), so one list serves several tables.
 *
 * ```ts
 * const fields = fieldsOf(requests, { latency: { label: "Latency", format: { duration: "millisecond" } } });
 * ```
 */
export function fieldsOf<S extends Schema>(
  table: Table<S> | RowView<S>,
  displays: { readonly [F in FieldName<S>]?: DisplayFor<S[F], PositionField<S>> },
): FieldRule[] {
  const source = ("source" in table ? table.source : table) as unknown as Table;
  // Each a rule naming its field: what the field's kind cannot take is refused.
  return rulesOf(displays as FieldDisplays, "fieldsOf", KIT).map((rule) => {
    const name = rule.names![0]!;
    resolve([rule], { name, kind: kindOf(source, name, "fieldsOf"), tables: [source] }, "fieldsOf");
    return { ...rule.settings, match: { table: source, field: name } };
  });
}
