// How derived tables were made: each one's source and steps, and how a
// condition on its fields is written on its source's fields. Readers
// (provenance, selections' source conditions) walk it without loading the
// code that derives tables: each record carries its own rewriting, which
// data/derive.ts writes. It imports no code, so the picking chunk takes it
// without sharing a module with charts' first chunks.

import type { TransformSpec } from "../spec/spec.ts";
import type { Expression } from "./expression.ts";
import type { Table } from "./table.ts";

/** How a derived table was made from `source`. */
export interface Lineage {
  readonly source: Table;
  /** The transform steps it ran, in order. */
  readonly steps: readonly TransformSpec[];
  /**
   * `condition`, on the table's fields, written on `source`'s fields: true
   * for exactly the source rows behind the rows it holds; null where no
   * condition says that.
   */
  back(condition: Expression): Expression | null;
}

/** Tables' lineage, kept as long as they are. */
const lineages = /* @__PURE__ */ new WeakMap<Table, Lineage>();

/** Records how `table` was derived. */
export function setLineage(table: Table, lineage: Lineage): void {
  lineages.set(table, lineage);
}

/**
 * How `table` was derived (`deriveTable`, `derive(...).table()`, a spec's
 * `{ source, transform }`), or undefined for a table that was not.
 */
export function lineageOf(table: Table): Lineage | undefined {
  return lineages.get(table);
}

/** A condition written on the table a derived table comes from, first of all. */
export interface SourceCondition {
  /** That table's name (`Table.name`, as specs name it); undefined for a table without one. */
  readonly table: string | undefined;
  /** Exactly the rows there behind the rows the condition held; null where no condition says it. */
  readonly condition: Expression | null;
}

/**
 * `condition` (on `table`'s fields; null for none) written on the fields
 * of the table `table` was derived from first of all, through every
 * derivation between; undefined for a table not derived. (A table made
 * from another elsewhere, a spec's `origin`, is not derived: its own rows
 * are where conditions on it end.)
 */
export function sourceOf(table: Table, condition: Expression | null): SourceCondition | undefined {
  let lineage = lineages.get(table);
  if (!lineage) return undefined;
  for (; lineage; lineage = lineages.get(table)) {
    if (condition !== null) condition = lineage.back(condition);
    table = lineage.source;
  }
  return { table: table.name, condition };
}
