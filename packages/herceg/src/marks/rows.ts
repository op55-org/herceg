// What a mark drawing series of a table reads of it. Series construction,
// aggregation, bins and their caches, domains, and category discovery all
// read the mark's rows here, never the table around them, and key their
// caches by the rows' revision; so a mark draws a row view's rows as it
// draws a table's (docs/architecture/data.md "Marks' rows").

import type { NumericArray } from "../data/column.ts";
import type { MarkRows, RowView } from "../data/row-view.ts";
import type { Schema, Table } from "../data/table.ts";

export type { MarkRows } from "../data/row-view.ts";

/**
 * The rows of a mark's `data` now: `known` (the last answer) while they are
 * unchanged, so caches keyed by it last, else read again.
 */
export function rowsOf<S extends Schema>(
  data: Table<S> | RowView<S>,
  known: MarkRows<S> | undefined,
): MarkRows<S> {
  if (isRowView(data)) return data.markRows(known);
  const revision = String(data.version);
  return known?.table === data && !known.view && known.revision === revision
    ? known
    : { table: data, positions: undefined, revision };
}

/** The positions of `rows`, each row's in turn, for readers looping over them. */
export function rowAt(rows: MarkRows, k: number): number {
  return rows.positions ? rows.positions[k]! : k;
}

/** How many rows `rows` has. */
export function rowCount(rows: MarkRows): number {
  return rows.positions ? rows.positions.length : rows.table.length;
}

type Extent = readonly [number, number] | undefined;

/** Extents of some rows' fields, kept while the rows are unchanged (a new answer for new rows). */
const extents = new WeakMap<MarkRows, Map<string, Extent>>();

/**
 * The least and greatest finite value of a number field at the rows: the
 * table's own, which it keeps, for every row; else kept with the rows, as
 * readers ask for it per point (a lasso asks each point's size).
 */
export function extentAt(rows: MarkRows, field: string): Extent {
  const { table, positions } = rows;
  if (!positions) return table.extent(field as never);
  let known = extents.get(rows);
  if (!known) {
    known = new Map();
    extents.set(rows, known);
  }
  if (known.has(field)) return known.get(field);
  const values = table.numbers(field as never);
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < positions.length; k++) {
    const value = values[positions[k]!]!;
    if (value < min && value > -Infinity) min = value;
    if (value > max && value < Infinity) max = value;
  }
  const extent: Extent = min <= max ? [min, max] : undefined;
  known.set(field, extent);
  return extent;
}

/**
 * A number field's values for code that reads a column at every position
 * (cell grids, calendars): the column itself for every row, else a copy
 * holding NaN, as a missing value, at the rows not drawn.
 */
export function numbersAt(rows: MarkRows, field: string): NumericArray {
  const column = rows.table.numbers(field as never);
  const { positions } = rows;
  if (!positions) return column;
  const out = new Float64Array(column.length).fill(Number.NaN);
  for (let k = 0; k < positions.length; k++) out[positions[k]!] = column[positions[k]!]!;
  return out;
}

/** What a mark makes of its rows, made again when they change. */
export class MarkRowsCache<T> {
  #rows: MarkRows | undefined;
  #value: T | undefined;

  get(rows: MarkRows, compute: () => T): T {
    if (this.#rows !== rows) {
      this.#value = compute();
      this.#rows = rows;
    }
    return this.#value as T;
  }
}

/**
 * Whether marks' data is a row view rather than a table, told apart by
 * shape so that charts without views do not bundle the view code.
 */
export function isRowView<S extends Schema>(data: Table<S> | RowView<S>): data is RowView<S> {
  return "markRows" in data;
}
