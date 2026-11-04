// Where a derived table's fields come from: its source table, and which of
// its fields pass through from it unchanged (filters and sorts keep every
// field; calculations, bins, and aggregates make some). Colors and legend
// entries follow a field back to the table it first came from, so a
// filtered or aggregated copy of a table's `region` colors its values as
// the table does (see model/identity.ts), and field displays matching a
// table follow a field so (fields/rules.ts, `lineOf`).

import type { Table } from "./table.ts";

/** Derived tables' origins: each one's source and its fields from it. */
export type Origins = Pick<
  WeakMap<Table, { source: Table; passes(field: string): boolean }>,
  "get"
>;

/** Each derived table's origin, kept alive as long as the derived table is. */
export const origins = new WeakMap<Table, { source: Table; passes(field: string): boolean }>();

/** Records that `derived` is made from `source`, the fields `passes` accepts unchanged. */
export function setOrigin(derived: Table, source: Table, passes: (field: string) => boolean): void {
  origins.set(derived, { source, passes });
}

/**
 * The table `fields` of `table` come from: its source while each passes
 * through unchanged, as far back as that holds; `table` itself otherwise.
 */
export function rootOf(table: Table, fields: readonly string[]): Table {
  for (let origin = origins.get(table); origin && fields.every(origin.passes); ) {
    table = origin.source;
    origin = origins.get(table);
  }
  return table;
}
