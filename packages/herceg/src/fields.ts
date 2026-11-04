// herceg/fields: field display for application code and for surfaces that
// take it through an explicit import. `displayOf` resolves field displays
// (`fields`, the record or rules charts take) for one field: its label,
// description, bounds, and each value's text, as surfaces write them;
// `compileFields` checks and compiles them once; `fieldsOf` writes rules
// for a table's fields, checked against its schema. See
// docs/guide/fields.md.

import type { FieldKind } from "./data/column.ts";
import { origins } from "./data/origin.ts";
import type { RowView } from "./data/row-view.ts";
import type { FieldName, PositionField, Schema, Table } from "./data/table.ts";
import { KINDS, shown } from "./fields/check.ts";
import { type DisplayedField, type DisplaySettings, displayed } from "./fields/display.ts";
import {
  type FieldDisplays,
  type FieldOf,
  type FieldRule,
  lineOf,
  resolve,
  rulesOf,
} from "./fields/rules.ts";
import { formatNumber, numberFormatter, timeFormatter } from "./format/format.ts";
import { toWall } from "./format/zone.ts";
import type {
  CategoryFieldDisplay,
  DisplayedKind,
  NumberFieldDisplay,
  TimeFieldDisplay,
} from "./spec/fields.ts";

export type { DisplayedField, DisplaySettings } from "./fields/display.ts";
export type { FieldDisplays, FieldMatch, FieldRule, TableRef } from "./fields/rules.ts";
export type {
  CategoryFieldDisplay,
  CategoryMapping,
  DisplayedKind,
  FieldDisplay,
  FieldLink,
  LinkPart,
  NumberFieldDisplay,
  NumberMapping,
  TimeFieldDisplay,
  ValueMapping,
} from "./spec/fields.ts";

/** The formatters and zone arithmetic displays write with: application code has no chart to hand them. */
const KIT = { numberFormatter, timeFormatter, toWall, formatNumber };

/** The display a field of kind `K` takes: what its kind writes. */
export type DisplayFor<K extends FieldKind> = K extends "number"
  ? NumberFieldDisplay
  : K extends "time"
    ? TimeFieldDisplay
    : K extends "category"
      ? CategoryFieldDisplay
      : never;

/** What a display is asked for: a table's field, or a field by name and kind, of a table by name. */
type FieldAsked<S extends Schema, F extends PositionField<S>, K extends DisplayedKind> =
  | { table: Table<S> | RowView<S>; field: F }
  | { field: string; kind: K; table?: string };

/**
 * Field displays checked and compiled once: what surfaces that take field
 * display through an explicit import read, and displays of many fields
 * without checking the rules again for each.
 */
export interface CompiledFields {
  /** The displays, as given. */
  readonly displays: FieldDisplays;
  /** A field's display, as `displayOf` gives it. */
  displayOf<K extends DisplayedKind>(
    of: { field: string; kind: K; table?: string },
    settings?: DisplaySettings,
  ): DisplayedField<K>;
  displayOf<S extends Schema, F extends PositionField<S>>(
    of: { table: Table<S> | RowView<S>; field: F },
    settings?: DisplaySettings,
  ): DisplayedField<S[F] & DisplayedKind>;
}

/**
 * `fields` (displays by name, or rules) checked and compiled, to resolve
 * displays of fields from: `compileFields(rules).displayOf(...)`.
 */
export function compileFields(fields: FieldDisplays): CompiledFields {
  return compiled(fields, "compileFields");
}

function compiled(displays: FieldDisplays, surface: string): CompiledFields {
  const rules = rulesOf(displays, surface, KIT);
  const displayOf = (
    of: FieldAsked<Schema, string, DisplayedKind>,
    settings: DisplaySettings = {},
  ): DisplayedField => {
    const field = fieldOf(of, surface);
    return displayed(field, resolve(rules, field, surface), KIT, settings, surface);
  };
  return { displays, displayOf: displayOf as CompiledFields["displayOf"] };
}

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
  return compiled(fields, "displayOf").displayOf(
    of as { field: string; kind: DisplayedKind },
    settings,
  );
}

/** The field `of` asks for, refused where its table lacks it or its kind is not one displays write. */
function fieldOf(of: FieldAsked<Schema, string, DisplayedKind>, surface: string): FieldOf {
  const { field: name, table } = of as { field: unknown; table?: unknown; kind?: unknown };
  if (typeof table === "object" && table !== null) {
    const ref = table as Table | RowView;
    const source = "source" in ref ? ref.source : ref;
    return {
      name: name as string,
      kind: kindOf(source, name as string, surface),
      tables: lineOf(origins, source, name as string),
    };
  }
  const { kind } = of as { kind?: unknown };
  if (typeof name !== "string")
    throw new Error(`${surface} field: expected a field's name; received ${shown(name)}`);
  if (!KINDS.includes(kind as DisplayedKind))
    throw new Error(
      `${surface} kind: expected "number", "time", or "category"; received ${shown(kind)}`,
    );
  if (table !== undefined && typeof table !== "string")
    throw new Error(
      `${surface} table: expected a table, a row view, or a table's name; received ${shown(table)}`,
    );
  return { name, kind: kind as DisplayedKind, table };
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
  displays: { readonly [F in FieldName<S>]?: DisplayFor<S[F]> },
): FieldRule[] {
  const source = ("source" in table ? table.source : table) as unknown as Table;
  // Each a rule naming its field: what the field's kind cannot take is refused.
  return rulesOf(displays as FieldDisplays, "fieldsOf", KIT).map((rule) => {
    const name = rule.names![0]!;
    resolve([rule], { name, kind: kindOf(source, name, "fieldsOf"), tables: [source] }, "fieldsOf");
    return { ...rule.settings, match: { table: source, field: name } };
  });
}

/** The kind of `table`'s field `name`, refused where the table lacks it or displays write none of it. */
function kindOf(table: Table, name: string, surface: string): DisplayedKind {
  if (!table.has(name))
    throw new Error(
      `${surface}: no field ${JSON.stringify(name)}; the table has ${table
        .fields()
        .map((field) => JSON.stringify(field))
        .join(", ")}`,
    );
  const kind = table.kind(name);
  if (kind === "geometry")
    throw new Error(
      `${surface}: ${JSON.stringify(name)} holds shapes, which displays do not write; give a number, time, or category field`,
    );
  return kind;
}
