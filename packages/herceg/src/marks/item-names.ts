// Items' names for value transitions (`animation.values`): what matches a
// bar or a label between two scenes, as model/items.ts names items without
// the mark's key. Only marks of charts that animate values read them.

import type { Table } from "../data/table.ts";
import { NAMELESS } from "../scene/scene.ts";

/**
 * Each row's name by `field`: a category's name or a finite number; for a
 * row missing it, NAMELESS and its identity, which matches only within one
 * table generation.
 */
export function namesBy(table: Table, field: string): (row: number) => string | number {
  if (table.kind(field) === "category") {
    const { codes, dictionary } = table.categories(field as never);
    return (row) => dictionary[codes[row]!] ?? NAMELESS + table.identity(row);
  }
  const values = table.numbers(field as never);
  return (row) => {
    const value = values[row]!;
    return Number.isFinite(value) ? value : NAMELESS + table.identity(row);
  };
}
