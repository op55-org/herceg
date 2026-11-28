import { expect, it } from "vitest";
import { cellCounts, cellCountWork } from "../../src/marks/cell-counts.ts";
import type { CellRows } from "../../src/marks/mark.ts";
import type { Membership } from "../../src/model/memberships.ts";

const n = 103;
/** 11 cells; every seventh row from the fourth is in none. */
const cellOf = (position: number) => (position % 7 === 3 ? -1 : position % 11);
const cellsOf = (key: object): CellRows => ({
  key,
  count: 11,
  cellOf,
  forEach(visit) {
    for (let position = 0; position < n; position++) {
      const cell = cellOf(position);
      if (cell >= 0) visit(cell, position);
    }
  },
});

it("moves counts by the bytes that changed as a pass counts them, wherever the bytes start", () => {
  const membership = {} as Membership;
  let seed = 1;
  const random = () => {
    seed = (seed * 16_807) % 2_147_483_647;
    return (seed - 1) / 2_147_483_646;
  };
  for (const offset of [0, 1, 2, 3]) {
    // A membership's bytes are a view of an array it writes in place.
    const buffer = new Uint8Array(n + 4);
    const key = {};
    const passes = cellCountWork.passes;
    for (let step = 0; step < 20; step++) {
      for (let k = 0; k < 9; k++) buffer[offset + Math.floor(random() * n)]! ^= 1;
      const selected = buffer.subarray(offset, offset + n);
      const got = Array.from(cellCounts(cellsOf(key), membership, selected));
      expect(got, `offset ${offset}, step ${step}`).toEqual(
        Array.from(cellCounts(cellsOf({}), membership, selected)),
      );
    }
    // One pass for the kept counts, one for each count made to compare.
    expect(cellCountWork.passes - passes).toBe(21);
  }
});

it("counts in a pass for another membership", () => {
  const key = {};
  const selected = new Uint8Array(n).fill(1);
  cellCounts(cellsOf(key), {} as Membership, selected);
  const passes = cellCountWork.passes;
  cellCounts(cellsOf(key), {} as Membership, selected);
  expect(cellCountWork.passes - passes).toBe(1);
});
