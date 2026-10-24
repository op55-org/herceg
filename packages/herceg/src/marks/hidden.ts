// What legends hide of marks besides their series: an annotation whole, and
// the rows of marks of rows (points, bars, annotations of tables) whose
// field holds a value. Each is a key of its own in the chart's hidden set,
// which legend entries name as their targets and the visibility methods
// take: `{"mark":"maintenance"}`, and `{"mark":2,"field":"kind","equals":"x"}`.
// Keys name their mark, so they stay while it does (`keepsKey`).

import type { Table } from "../data/table.ts";
import type { MarkKey, RowParts } from "./mark.ts";
import type { Series } from "./series.ts";

/** The key hiding mark `mark` (its id, or its index) whole. */
export function markKey(mark: MarkKey): string {
  return JSON.stringify({ mark });
}

/** The key hiding the rows of mark `mark` whose `field` holds `value` (numbers as text). */
export function rowKey(mark: MarkKey, field: string, value: string): string {
  return JSON.stringify({ mark, field, equals: value });
}

/**
 * Whether row `row` of `table` is one `hidden` hides by the value of one of
 * its fields, through keys of mark `mark`; undefined where none name it.
 */
export function hiddenRows(
  hidden: Iterable<string>,
  mark: MarkKey,
  table: Table,
): ((row: number) => boolean) | undefined {
  const start = `${markKey(mark).slice(0, -1)},"field":`;
  const values = new Map<string, Set<string>>();
  for (const key of hidden)
    if (key.startsWith(start)) {
      const { field, equals } = JSON.parse(key) as { field: string; equals: string };
      if (!table.has(field)) continue;
      const of = values.get(field) ?? values.set(field, new Set()).get(field)!;
      of.add(equals);
    }
  if (values.size === 0) return undefined;
  const tests = [...values].map(([field, of]): ((row: number) => boolean) => {
    if (table.kind(field) !== "category")
      return (row) => of.has(String(table.value(field as never, row)));
    // A category's values by code.
    const { codes, dictionary } = table.categories(field as never);
    const hides = dictionary.map((value) => of.has(value));
    return (row) => hides[codes[row]!] === true;
  });
  return (row) => tests.some((hides) => hides(row));
}

/**
 * Of `rows` (the table's rows from 0 to `length` without them), those
 * `hides` leaves shown.
 */
export function shownRows(
  rows: ArrayLike<number> | undefined,
  length: number,
  hides: (row: number) => boolean,
): Uint32Array {
  const kept: number[] = [];
  const count = rows ? rows.length : length;
  for (let k = 0; k < count; k++) {
    const row = rows ? rows[k]! : k;
    if (!hides(row)) kept.push(row);
  }
  return Uint32Array.from(kept);
}

/**
 * The items of `rows` (every item of `count` without them) the legend
 * leaves shown of mark `mark`: none where it hides the mark whole.
 */
export function shownItems(
  hidden: ReadonlySet<string>,
  mark: MarkKey,
  table: Table | undefined,
  count: number,
  rows: RowParts | undefined,
): RowParts | undefined {
  if (hidden.has(markKey(mark))) return [];
  const hides = table && hiddenRows(hidden, mark, table);
  if (!hides) return rows;
  return rows
    ? rows.map((part) => shownRows(part, 0, hides))
    : [shownRows(undefined, count, hides)];
}

/** `series` of mark `mark` without the rows `hidden` hides by value (see `hiddenRows`). */
export function withoutHidden(
  series: Series[],
  hidden: Iterable<string>,
  mark: MarkKey,
  table: Table,
): Series[] {
  const hides = hiddenRows(hidden, mark, table);
  if (!hides) return series;
  return series.map((s) => {
    // A subset of rows in order keeps their order; streaming state is the whole series'.
    const rows = shownRows(s.rows, s.length, hides);
    return { ...s, rows, length: rows.length, stream: undefined, unhidden: s };
  });
}
