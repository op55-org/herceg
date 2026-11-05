// Field displays compiled without a chart: `compileFields` (herceg/fields),
// and grid models' `fields`, which a grid compiles when it is given rules,
// since it writes its cells synchronously. Displays write with the formatters
// and zone arithmetic imported here; a chart's own compile through its kit
// (fields/chart.ts).

import { origins } from "../data/origin.ts";
import type { RowView } from "../data/row-view.ts";
import type { PositionField, Schema, Table } from "../data/table.ts";
import { formatNumber, numberFormatter, timeFormatter } from "../format/format.ts";
import { toWall } from "../format/zone.ts";
import type { DisplayedKind } from "../spec/fields.ts";
import { KINDS, shown } from "./check.ts";
import {
  type CompiledFields,
  type DisplayedField,
  type DisplaySettings,
  displayed,
  isCompiled,
} from "./display.ts";
import type { LinkRows, LinkWrite } from "./links.ts";
import { type FieldDisplays, type FieldOf, lineOf, resolve, rulesOf } from "./rules.ts";

/** The formatters and zone arithmetic displays write with, where there is no chart to hand them. */
export const KIT = { numberFormatter, timeFormatter, toWall, formatNumber };

/** What a display is asked for: a table's field, or a field by name and kind, of a table by name. */
export type FieldAsked<S extends Schema, F extends PositionField<S>, K extends DisplayedKind> =
  | { table: Table<S> | RowView<S>; field: F }
  | { field: string; kind: K; table?: string };

/**
 * `fields` (displays by name, or rules) checked and compiled, to resolve
 * displays of fields from: `compileFields(rules).displayOf(...)`.
 */
export function compileFields(fields: FieldDisplays): CompiledFields {
  return compile(fields, "compileFields");
}

/**
 * A surface's `fields` as displays to write with: those `compileFields`
 * made as given, rules and displays by name compiled, naming them on
 * `surface` ("grid fields[1]") in messages.
 */
export function compiledFields(
  fields: FieldDisplays | CompiledFields | undefined,
  surface: string,
): CompiledFields | undefined {
  if (fields === undefined) return undefined;
  return isCompiled(fields) ? fields : compile(fields, surface);
}

/** `displays` compiled, their messages naming them on `surface`. */
export function compile(displays: FieldDisplays, surface: string): CompiledFields {
  const rules = rulesOf(displays, surface, KIT);
  const displayOf = (
    of: FieldAsked<Schema, string, DisplayedKind>,
    settings: DisplaySettings = {},
  ): DisplayedField => {
    const field = fieldOf(of, surface);
    // Links write other fields of their rows through those fields' displays,
    // in the surface's place and missing text, without its own format; the
    // fields of the table this display is of, which rules naming tables
    // match, whatever reads the rows.
    const { format: _, ...others } = settings;
    const texts = new WeakMap<LinkRows, Map<string, DisplayedField["text"]>>();
    const textOf = (rows: LinkRows, name: string) => {
      let byName = texts.get(rows);
      if (!byName) {
        byName = new Map();
        texts.set(rows, byName);
      }
      let text = byName.get(name);
      if (!text) {
        const other: FieldOf = {
          name,
          kind: rows.kind(name) as DisplayedKind,
          tables: field.tables && lineOf(origins, field.tables[0]!, name),
          table: field.table,
        };
        text = displayed(other, resolve(rules, other, surface), KIT, others, surface, textOf).text;
        byName.set(name, text);
      }
      return text as LinkWrite;
    };
    return displayed(field, resolve(rules, field, surface), KIT, settings, surface, textOf);
  };
  return { displays, displayOf: displayOf as CompiledFields["displayOf"] };
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

/** The kind of `table`'s field `name`, refused where the table lacks it or displays write none of it. */
export function kindOf(table: Table, name: string, surface: string): DisplayedKind {
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
