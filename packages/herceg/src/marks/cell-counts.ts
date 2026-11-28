// How many of each cell's rows a store's selection holds, for heatmaps and
// 2D histograms, kept per cells and membership and moved by the rows whose
// byte changed since they were counted: a brush step compares the bytes
// and counts the rows that left and joined, not every row's cell. Part of
// what follows heatmaps' changes (heatmap-patch.ts), loaded on their first
// change. It reads no membership history (model/membership-changes.ts):
// pages that read lineage load that eagerly, and a lazy chunk importing it
// would split it out of their first chunk.

import type { Membership } from "../model/memberships.ts";
import type { CellRows } from "./mark.ts";

/** A count kept for some cells and a membership: the bytes it counted, its own copy. */
interface Kept {
  readonly bytes: Uint8Array;
  readonly counts: Uint32Array;
}

/** Rows counted in cells, for tests and benchmarks: in passes over every row, and as changes moved them. */
export const cellCountWork = { passes: 0, moved: 0 };

/** Counts by the cells they are of and the membership counted, while both are held. */
const kept = /* @__PURE__ */ new WeakMap<object, WeakMap<Membership, Kept>>();

/**
 * How many of each of `cells`' rows `selected` (`membership`'s bytes)
 * holds: the counts kept with the cells, moved by the rows whose byte
 * changed since; counted in one pass over the cells' rows the first time,
 * for other cells, and for another membership. The cells' key stands for
 * their rows, so the same key means the same positions.
 */
export function cellCounts(
  cells: CellRows,
  membership: Membership,
  selected: Uint8Array,
): Uint32Array {
  let byMembership = kept.get(cells.key);
  if (!byMembership) {
    byMembership = new WeakMap();
    kept.set(cells.key, byMembership);
  }
  const known = byMembership.get(membership);
  if (known && known.bytes.length === selected.length) {
    const { bytes, counts } = known;
    let moved = 0;
    const move = (from: number, to: number) => {
      for (let position = from; position < to; position++) {
        const now = selected[position]!;
        if (now === bytes[position]) continue;
        const cell = cells.cellOf(position);
        if (cell >= 0) counts[cell]! += now - bytes[position]!;
        bytes[position] = now;
        moved++;
      }
    };
    // Four bytes at a time where the bytes' view allows it (the copy's does).
    const aligned = selected.byteOffset % 4 === 0;
    const words = aligned ? selected.length >> 2 : 0;
    const now = new Uint32Array(selected.buffer, aligned ? selected.byteOffset : 0, words);
    const was = new Uint32Array(bytes.buffer, 0, words);
    for (let word = 0; word < words; word++)
      if (now[word] !== was[word]) move(word * 4, word * 4 + 4);
    move(words * 4, selected.length);
    cellCountWork.moved += moved;
    return counts;
  }
  const counts = new Uint32Array(cells.count);
  cellCountWork.passes++;
  cells.forEach((cell, position) => {
    counts[cell]! += selected[position]!;
  });
  byMembership.set(membership, { bytes: selected.slice(), counts });
  return counts;
}
