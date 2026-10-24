// What a series' color and legend entry stand for: its identity, a value in
// a scope, the place the value comes from.
//
// - `{ field }`: a category field, by its name. The series a field splits
//   rows into (`series`, or a `color` field it is inferred from), the rows
//   it colors, and a pie's slices stand for its values, in every mark,
//   table, panel, facet, and inset of the chart: one name is one meaning
//   within a chart. Fields of one name that mean different things are kept
//   apart by naming a scale for each, and fields of different names that
//   mean one thing are joined by naming one scale.
// - `{ table }`: a table's value fields. The series of wide data (`y:
//   ["p50", "p99"]`) and a mark's one series stand for their name: their
//   field's, or the mark's `label` (a band's two fields, "low–high"). Two
//   marks of a table naming their series alike, such as a line and the
//   band around it, list one thing; marks of unrelated tables do not.
// - `{ scale }`: a scale of the chart's `scales`. Marks reading it join its
//   values from any source, by value; a scale of each panel's own
//   (`scope: "panel"`) is `{ scale, panel }` (the feature compiler resolves
//   these, marks/features/identity.ts).
//
// A table of value fields is named by the table its fields come from
// (data/origin.ts: the source of a derived table, or the `origin` of one,
// while the fields pass through unchanged): by its `name`, else by a name
// the chart gives it: the place of the first mark reading it (`{ "mark": 2
// }`, or `{ "mark": "latency" }` for a mark of that id), which it keeps from
// one configuration to the next (`simpleNames`), so its series keep their
// colors as marks before it come and go, and which a new table read in the
// same place takes after it, as when a framework renders again. A table
// left out of a configuration is named anew when it comes back.
//
// The value is a series' name: its series field's value, or its label.
// Identity keys are JSON, scope first, then the value:
// `{"field":"region","value":"eu"}`, `{"table":"data","value":"p99"}`,
// `{"scale":"region","value":"eu"}`. They name legend entries, which hide
// and show every series of their identity. Series keys (`seriesKey`) stay
// the identity of what is drawn: geometry buffers, inspection, and the
// keyboard never confuse two marks drawing the same value.

import type { Table } from "../data/table.ts";

export type IdentityScope =
  | { readonly field: string }
  | { readonly table: TableName }
  | { readonly scale: string; readonly panel?: string };

/**
 * What identity keys name a table of value fields by: its `name`, or for a
 * table without one, the place of the first mark reading it (its `id`,
 * else its index, with `n` where another table took that place's name first).
 */
export type TableName = string | { readonly mark: string | number; readonly n?: number };

/** What an identity key of `scope` starts with, before its value. */
export function prefixOf(scope: IdentityScope): string {
  return `${JSON.stringify(scope).slice(0, -1)},"value":`;
}

/** The key of `value` in `scope`. */
export function identityKey(scope: IdentityScope, value: string): string {
  return identityOf(prefixOf(scope), value);
}

/** The key of `value` in the scope `prefix` starts. */
export function identityOf(prefix: string, value: string): string {
  return `${prefix}${JSON.stringify(value)}}`;
}

/** The scope prefix of an identity key; undefined for other keys (series and item keys). */
export function keyPrefix(key: string): string | undefined {
  const at = key.lastIndexOf(',"value":');
  return key.startsWith('{"') && at > 0 ? key.slice(0, at + 9) : undefined;
}

/**
 * The names of `tables` (the tables marks' value fields come from, by mark;
 * undefined for marks of none), the first mark reading each at `places`:
 * each its own `name`, else the name it had in the configuration before
 * (`last`), else its place. Undefined where two would take one name, which
 * the feature compiler settles (marks/features/identity.ts, `tableNames`,
 * naming the rest alike).
 */
export function simpleNames(
  tables: readonly (Table | undefined)[],
  places: readonly (string | number)[],
  last: ReadonlyMap<Table, TableName> | undefined,
): (TableName | undefined)[] | undefined {
  const names = new Map<Table, TableName>();
  const taken = new Set<string>();
  for (const [i, table] of tables.entries()) {
    if (!table || names.has(table)) continue;
    const name = table.name ?? last?.get(table) ?? { mark: places[i]! };
    const text = JSON.stringify(name);
    if (taken.has(text)) return undefined;
    taken.add(text);
    names.set(table, name);
  }
  return tables.map((table) => table && names.get(table));
}
