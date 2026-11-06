// A pivot's totals row (data/pivot.ts, `totals: { row: true }`): each pivot
// value's aggregates over every row with that value, and the aggregates of
// every row, folded from the pivot's own groups: its combinations by their
// pivot values, and its rows into one. Folding running sums, counts of
// finite values, and extremes is aggregating the rows themselves (a mean is
// the sum of its rows over their count, never a mean of means), so the row
// is always of the same state as the crosstab, stops with it, and holds
// nothing per row. A sum that folding left beyond its accuracy is summed
// again exactly from its rows, except in a pivot stopped at a limit, whose
// groups stay as they were while their table moves on (its values are no
// longer theirs), so its sums keep their compensated fold. Folded again
// when read after the groups changed (their revision, which moves with
// every change of their aggregates, whether or not a published one
// changed): O(combinations).

import { GroupLevel } from "./group-levels.ts";
import { levelsOf, type RowGroups } from "./groups.ts";
import type { Table } from "./table.ts";

export class PivotTotals {
  readonly #groups: RowGroups;
  /** Whether the pivot stopped at a limit. */
  readonly #stopped: () => boolean;
  /** Each pivot value's totals, by its slot, and every row's. */
  readonly #values: GroupLevel;
  readonly #all: GroupLevel;
  #seen = "";

  constructor(groups: RowGroups, stopped: () => boolean) {
    this.#groups = groups;
    this.#stopped = stopped;
    const { aggregates } = levelsOf(groups)[0]!;
    this.#values = new GroupLevel(0, false, aggregates);
    this.#all = new GroupLevel(0, false, aggregates);
    this.#all.add(null, -1);
  }

  /**
   * Aggregate `k` of the rows with the pivot value of slot `slot` (of every
   * row, with -1), given each combination's slot (`slots`, of the pivot's
   * current crosstab) and how many values there are (`count`).
   */
  read(k: number, slot: number, slots: Int32Array, count: number): number {
    const key = `${this.#groups.revision} ${count}`;
    if (key !== this.#seen) {
      this.#seen = key;
      this.#fold(slots, count);
    }
    return slot < 0 ? this.#all.result(k, 0) : this.#values.result(k, slot);
  }

  /** Bytes of the folds' typed arrays. */
  get byteLength(): number {
    return this.#values.byteLength + this.#all.byteLength;
  }

  /** Folds the combinations into their values' totals, and the rows into every row's. */
  #fold(slots: Int32Array, count: number) {
    const groups = this.#groups;
    const [rows, combinations] = levelsOf(groups) as [GroupLevel, GroupLevel];
    const values = this.#values;
    const all = this.#all;
    while (values.count < count) values.add(null, -1);
    values.clear(0, values.count);
    all.clear(0, 1);
    values.fold(combinations, null, slots);
    all.fold(rows, null, new Int32Array(rows.count));
    // Sums whose folding lost their accuracy, from their rows.
    const exact = !this.#stopped();
    const source = groups.view.source as unknown as Table;
    const columns = [...new Set(groups.aggregates.flatMap(({ field }) => field ?? []))].map(
      (field) => source.numbers(field),
    );
    for (const [level, members] of [
      [values, (slot: number) => this.#members(slots, slot, 1, combinations.count)],
      [all, () => this.#members(null, 0, 0, rows.count)],
    ] as const) {
      level.checkSums(null);
      if (level.staleCount === 0) continue;
      for (let group = 0; exact && group < level.count; group++) {
        if (!level.stale[group]) continue;
        const positions = members(group);
        level.recompute(group, columns, positions, positions.length);
      }
      level.settle();
    }
  }

  /** The rows of the groups at `depth` (of `count`) whose slot is `slot` (every one without slots). */
  #members(slots: Int32Array | null, slot: number, depth: number, count: number): Uint32Array {
    const lists: Uint32Array[] = [];
    for (let group = 0; group < count; group++)
      if (!slots || slots[group] === slot) lists.push(this.#groups.members(group, depth));
    const out = new Uint32Array(lists.reduce((sum, list) => sum + list.length, 0));
    let at = 0;
    for (const list of lists) {
      out.set(list, at);
      at += list.length;
    }
    return out;
  }
}
