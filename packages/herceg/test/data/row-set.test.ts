import { describe, expect, it } from "vitest";
import { RowSet } from "../../src/data/row-set.ts";
import { table } from "../../src/data/table.ts";

describe("row sets", () => {
  it("hold rows by identity as other rows are appended and dropped", () => {
    const t = table({ x: Float64Array.from({ length: 100 }, (_, i) => i) }, { maxRows: 100 });
    const set = new RowSet(t).add(3).addRange(40, 70).add(99);
    expect(set.size).toBe(32);
    expect(set.has(3) && set.has(55) && !set.has(70)).toBe(true);
    // Fifty rows drop: row 55 is now at 5, and rows 3 and 40-49 have left.
    t.append({ x: Float64Array.from({ length: 50 }, (_, i) => 100 + i) });
    expect(set.has(5)).toBe(true);
    expect(set.size).toBe(21);
    expect(Array.from(set.positions())).toEqual([...Array.from({ length: 20 }, (_, i) => i), 49]);
    set.delete(0).add(60);
    expect(set.size).toBe(21);
    expect(set.byteLength).toBeLessThan(64);
  });

  it("keep identities apart past 2^32 rows", () => {
    const t = table({ x: [0, 1] }, { maxRows: 2 });
    const set = new RowSet(t).add(0);
    // An oversized append keeps only its last rows: a sparse array this long
    // moves identities on by about 2^32 at once.
    const huge: (number | null)[] = [];
    huge.length = 2 ** 32 - 1;
    huge[huge.length - 1] = 7;
    t.append({ x: huge });
    // One more row: identities now start exactly 2^32 after the set's first.
    t.append({ x: [8] });
    expect(t.rowOffset).toBe(2 ** 32);
    // The selected row left long ago; nothing wraps around to the new rows.
    expect([set.size, set.has(0), set.has(1)]).toEqual([0, false, false]);
    expect(set.add(1).positions()).toEqual(Uint32Array.of(1));
  });

  it("add many rows at once, in any order, after drops too", () => {
    const t = table({ x: Float64Array.from({ length: 200 }, (_, i) => i) }, { maxRows: 200 });
    t.append({ x: Float64Array.from({ length: 37 }, (_, i) => 200 + i) });
    const set = new RowSet(t).add(5).addAll(Uint32Array.of(150, 5, 33, 199, 0));
    expect(set.size).toBe(5);
    expect(Array.from(set.positions())).toEqual([0, 5, 33, 150, 199]);
    expect(set.addAll([]).size).toBe(5);
    expect(() => set.addAll([3, 200])).toThrow(RangeError);
    expect(() => set.addAll([1.5])).toThrow(RangeError);
  });

  it("freeze in place: reads still follow the table, changes throw", () => {
    const t = table({ x: Float64Array.from({ length: 64 }, (_, i) => i) }, { maxRows: 64 });
    const set = new RowSet(t).addAll([3, 40, 63]);
    expect(set.freeze()).toBe(set);
    const frozen =
      /^RowSet: the set is frozen, as selections hold it; change a copy, rows.copy\(\)$/;
    expect(() => set.add(0)).toThrow(frozen);
    expect(() => set.addRange(0, 2)).toThrow(frozen);
    expect(() => set.addAll([1])).toThrow(frozen);
    expect(() => set.delete(3)).toThrow(frozen);
    expect(() => set.clear()).toThrow(frozen);
    const version = set.version;
    // Rows 0 to 31 drop: row 40 is now at 8, 63 at 31; row 3 has left.
    t.append({ x: Float64Array.from({ length: 32 }, (_, i) => 64 + i) });
    expect(Array.from(set.positions())).toEqual([8, 31]);
    expect([set.size, set.version]).toEqual([2, version]);
  });

  it("copy their members apart, of the table's current rows", () => {
    const t = table({ x: Float64Array.from({ length: 100 }, (_, i) => i) }, { maxRows: 100 });
    const set = new RowSet(t).addAll([2, 50, 99]).freeze();
    t.append({ x: [100, 101, 102, 103] });
    const copy = set.copy();
    expect(Array.from(copy.positions())).toEqual([46, 95]);
    copy.add(0).delete(46);
    expect(Array.from(copy.positions())).toEqual([0, 95]);
    expect(Array.from(set.positions())).toEqual([46, 95]);
    // No more words than its members need.
    expect(copy.byteLength).toBeLessThanOrEqual(new RowSet(t).add(95).byteLength);
    // From before a reset, a copy is empty, and of the rows now.
    t.reset({ x: [7, 8] });
    const after = set.copy();
    expect([after.current, after.size]).toEqual([true, 0]);
    expect(Array.from(after.add(1).positions())).toEqual([1]);
  });

  it("are empty after their table resets, which starts identities again", () => {
    const t = table({ x: [1, 2, 3] });
    const set = new RowSet(t).add(1);
    t.reset({ x: [7, 8, 9] });
    expect(set.current).toBe(false);
    expect([set.size, set.has(1), set.positions().length]).toEqual([0, false, 0]);
    expect(() => set.add(0)).toThrow(/reset/);
    expect(() => new RowSet(t).add(3)).toThrow(RangeError);
  });
});
