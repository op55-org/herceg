import { describe, expect, it } from "vitest";
import { category, time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type TableChange, table } from "../../src/data/table.ts";
import type { RangeExtremes } from "../../src/lod/minmax-index.ts";

function changesOf(t: { subscribe(listener: (change: TableChange) => void): () => void }) {
  const changes: TableChange[] = [];
  t.subscribe((change) => changes.push(change));
  return changes;
}

const times = (t: { numbers(field: "t"): ArrayLike<number> }) => Array.from(t.numbers("t"));
const identities = (t: { length: number; identity(position: number): number }) =>
  Array.from({ length: t.length }, (_, p) => t.identity(p));

describe("orderedTable()", () => {
  it("sorts the rows it is given, ties as given, numbering them as given", () => {
    const t = orderedTable({ t: [3, 1, 2, 1], v: [30, 10, 20, 11] }, { orderBy: "t" });
    expect(times(t)).toEqual([1, 1, 2, 3]);
    expect(Array.from(t.numbers("v"))).toEqual([10, 11, 20, 30]);
    expect(identities(t)).toEqual([1, 3, 2, 0]);
    expect(t.isSorted("t")).toBe(true);
    expect(t.version).toBe(0);
    expect(t.maxRows).toBe(Number.POSITIVE_INFINITY);
  });

  it("keeps the last maxRows rows in order", () => {
    const t = orderedTable(
      { t: [5, 1, 4, 2, 3], v: [5, 1, 4, 2, 3] },
      { orderBy: "t", maxRows: 3 },
    );
    expect(times(t)).toEqual([3, 4, 5]);
    expect(identities(t)).toEqual([4, 2, 0]);
    expect(t.maxRows).toBe(3);
  });

  it("appends rows at or after the last row as ordinary tables do", () => {
    const t = orderedTable({ t: [1, 2], v: [1, 2] }, { orderBy: "t" });
    const changes = changesOf(t);
    const modified = t.modifiedVersion;
    t.append({ t: [2, 3], v: [22, 3] });
    expect(times(t)).toEqual([1, 2, 2, 3]);
    expect(changes).toEqual([{ dropped: 0, appended: 2, updated: null, fields: [], reset: false }]);
    expect(t.modifiedVersion).toBe(modified);
    expect(identities(t)).toEqual([0, 1, 2, 3]);
  });

  it("merges late rows into place, after rows of their time, in one change", () => {
    const t = orderedTable({ t: [10, 20, 30, 40], v: [1, 2, 3, 4] }, { orderBy: "t" });
    const changes = changesOf(t);
    t.append({ t: [50, 20, 15, 20], v: [5, 22, 15, 23] });
    expect(times(t)).toEqual([10, 15, 20, 20, 20, 30, 40, 50]);
    expect(Array.from(t.numbers("v"))).toEqual([1, 15, 2, 22, 23, 3, 4, 5]);
    expect(changes).toEqual([
      {
        dropped: 0,
        appended: 1,
        inserted: { start: 1, count: 3 },
        updated: null,
        fields: [],
        reset: false,
      },
    ]);
    // Identities stay with their observations.
    expect(identities(t)).toEqual([0, 6, 1, 5, 7, 2, 3, 4]);
    expect(t.modifiedVersion).toBe(t.version);
    expect(t.positionOf(2, 0)).toBe(5);
    expect(t.positionOf(7, 0, 20)).toBe(4);
    expect(t.positionOf(7, 0, 30)).toBe(-1);
  });

  it("drops from the first row up, so rows that sort first leave first", () => {
    const t = orderedTable({ t: [10, 20, 30], v: [1, 2, 3] }, { orderBy: "t", maxRows: 3 });
    const changes = changesOf(t);
    // 5 sorts before every row kept: it is not taken in, though numbered 3.
    t.append({ t: [5, 25], v: [0, 25] });
    expect(times(t)).toEqual([20, 25, 30]);
    expect(identities(t)).toEqual([1, 4, 2]);
    expect(t.rowOffset).toBe(1);
    expect(changes).toEqual([
      {
        dropped: 1,
        appended: 0,
        inserted: { start: 1, count: 1 },
        updated: null,
        fields: [],
        reset: false,
      },
    ]);
    // A batch none of which would stay changes nothing.
    t.append({ t: [1, 2], v: [0, 0] });
    expect(changes.length).toBe(1);
    expect(identities(t)).toEqual([1, 4, 2]);
    t.append({ t: [40], v: [40] });
    expect(identities(t)).toEqual([4, 2, 7]);
    t.dropBefore("t", 26);
    expect(times(t)).toEqual([30, 40]);
    expect(identities(t)).toEqual([2, 7]);
    expect(t.positionOf(4, 0)).toBe(-1);
  });

  it("judges which late rows a window keeps only of batches append takes, as stored", () => {
    const t = orderedTable({ x: [10, 20], y: [100, 200] }, { orderBy: "x", maxRows: 2 });
    expect(() => t.append({ x: [0, 30], y: [300] })).toThrow();
    expect(Array.from(t.numbers("y"))).toEqual([100, 200]);
    // 0.99999999 is 1 as a Float32Array holds it: a tie, and later, so it stays.
    const f = orderedTable({ x: Float32Array.of(1) }, { orderBy: "x", maxRows: 1 });
    f.append({ x: [0.99999999] });
    expect(identities(f)).toEqual([1]);
  });

  it("refuses rows without an order value, and changes nothing", () => {
    const t = orderedTable({ t: time([1, 2]), v: [1, 2] }, { orderBy: "t" });
    expect(() => t.append({ t: [3, null], v: [3, 4] })).toThrow(
      'append "t": row 1: is missing; an ordered table needs every row\'s t',
    );
    expect(() => t.append({ t: [new Date(Number.NaN)], v: [3] })).toThrow(/row 0: is missing/);
    expect(t.length).toBe(2);
    expect(() => orderedTable({ t: [1, Number.NaN], v: [1, 2] }, { orderBy: "t" })).toThrow(
      'orderedTable "t": row 1: is missing; an ordered table needs every row\'s t',
    );
    expect(() => t.reset({ t: [null, 1], v: [1, 2] })).toThrow(/reset "t": row 0: is missing/);
    expect(t.generation).toBe(0);
  });

  it("refuses an order field of categories, a missing one, and replacing it", () => {
    expect(() =>
      orderedTable({ service: category(["a"]), value: [1] }, { orderBy: "service" as never }),
    ).toThrow('orderedTable orderBy: "service" is a category field; give a number or time field');
    expect(() => orderedTable({ value: [1] }, { orderBy: "time" as never })).toThrow(
      'orderedTable orderBy: no field "time"; the table has "value"',
    );
    expect(() => orderedTable({ t: [1] }, { orderBy: "t", maxRows: 0 })).toThrow(
      "orderedTable maxRows: expected a positive whole number; received 0",
    );
    const t = orderedTable({ t: [1, 2], v: [1, 2] }, { orderBy: "t" });
    expect(() => t.replace(0, { t: [5] })).toThrow(
      'replace "t": is the table\'s orderBy; drop and append those rows',
    );
    expect(() => t.set("t", 0, 5)).toThrow(/is the table's orderBy/);
    t.replace(0, { v: [9] });
    expect(t.value("v", 0)).toBe(9);
  });

  it("sorts and numbers again on reset, a new generation", () => {
    const t = orderedTable({ t: [1, 2], v: [1, 2] }, { orderBy: "t", maxRows: 2 });
    const changes = changesOf(t);
    t.reset({ t: [9, 7, 8], v: [9, 7, 8] });
    expect(times(t)).toEqual([8, 9]);
    expect(identities(t)).toEqual([2, 0]);
    expect(t.generation).toBe(1);
    expect(changes).toEqual([{ dropped: 0, appended: 0, updated: null, fields: [], reset: true }]);
    t.append({ t: [7.5], v: [0] });
    expect(times(t)).toEqual([8, 9]);
    t.append({ t: [8.5], v: [0] });
    expect(identities(t)).toEqual([4, 0]);
  });

  it("says from where rows moved or changed since a version", () => {
    const t = orderedTable({ t: [1, 2, 3, 4], v: [1, 2, 3, 4] }, { orderBy: "t" });
    const start = t.version;
    t.append({ t: [5, 6], v: [5, 6] });
    // Appends at the end move nothing.
    expect(t.changedFrom(start)).toBe(t.length);
    const appended = t.version;
    t.append({ t: [2.5, 7], v: [0, 0] });
    expect([t.changedFrom(start), t.changedFrom(appended), t.changedFrom(t.version)]).toEqual([
      2, 2, 8,
    ]);
    // Drops leave rows where they are: positions count from the first kept.
    t.dropFirst(1);
    expect(t.changedFrom(appended)).toBe(1);
    t.dropFirst(3);
    expect(t.changedFrom(appended)).toBe(0);
    const moved = t.version;
    t.replace(2, { v: [9] });
    expect(t.changedFrom(moved)).toBe(2);
    // Not before the table began, after it is now, or across a reset.
    expect(t.changedFrom(t.version + 1)).toBeUndefined();
    const before = t.version;
    t.reset({ t: [1], v: [1] });
    expect(t.changedFrom(before)).toBeUndefined();
    expect(t.changedFrom(t.version)).toBe(1);
    // Nor across more changes than it remembers.
    const many = t.version;
    for (let i = 0; i < 20; i++) t.append({ t: [0.5 + i / 100, 9 + i], v: [0, 0] });
    expect(t.changedFrom(many)).toBeUndefined();
    // Each of those went in after the one before, at positions 0 to 19.
    expect(t.changedFrom(t.version - 3)).toBe(17);
  });

  it("reports the first row a transaction changed or moved, whichever is first", () => {
    const t = orderedTable({ t: [1, 2, 3, 4], v: [1, 2, 3, 4] }, { orderBy: "t" });
    const start = t.version;
    t.transaction(() => {
      t.replace(0, { v: [9] });
      t.append({ t: [3.5], v: [0] });
    });
    expect(t.changedFrom(start)).toBe(0);
  });

  it("tells rows a transaction moved among those it took in as inserted", () => {
    // A view read between the writes holds the first row a later one moved.
    const t = orderedTable({ t: [1] }, { orderBy: "t" });
    const changes = changesOf(t);
    const view = rowView(t, { filter: col("t").gt(2) });
    t.transaction(() => {
      t.append({ t: [3] });
      expect(Array.from(view.read().indices!)).toEqual([1]);
      t.append({ t: [2] });
    });
    expect(changes).toEqual([
      {
        dropped: 0,
        appended: 0,
        inserted: { start: 1, count: 2 },
        updated: null,
        fields: [],
        reset: false,
      },
    ]);
    expect(Array.from(view.read().indices!)).toEqual([2]);
    // Rows in order after the move are appended.
    t.transaction(() => {
      t.append({ t: [0.5] });
      t.append({ t: [5, 6] });
    });
    expect(changes[1]).toMatchObject({ appended: 2, inserted: { start: 0, count: 1 } });
  });

  it("tells listeners of a drop once the rows' identities have dropped too", () => {
    const t = orderedTable({ t: [10, 20, 30], v: [1, 2, 3] }, { orderBy: "t" });
    const seen: number[][] = [];
    let once = true;
    t.subscribe((change) => {
      seen.push(identities(t));
      if (change.dropped && once) {
        once = false;
        t.append({ t: [40], v: [4] });
      }
    });
    t.dropFirst(1);
    expect(seen[0]).toEqual([1, 2]);
    expect(identities(t)).toEqual([1, 2, 3]);
    const picked = new RowSet(t).add(1);
    t.subscribe(() => seen.push(Array.from(picked.positions())));
    t.dropBefore("t", 25);
    expect(seen.at(-1)).toEqual([0]);
    expect(identities(t)).toEqual([2, 3]);
  });

  it("keeps its min/max indexes and extents through merges", () => {
    const values = Array.from({ length: 2000 }, (_, i) => Math.sin(i / 7) * 100);
    const t = orderedTable(
      { t: values.map((_, i) => i * 10), v: values },
      { orderBy: "t", maxRows: 1500 },
    );
    t.minMaxIndex("v");
    t.extent("v");
    let seed = 1;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let step = 0; step < 50; step++) {
      const at = 20_000 + step * 100;
      const batch = Array.from({ length: 12 }, () => at - next() * 3000);
      t.append({ t: batch, v: batch.map(() => next() * 400 - 200) });
      const check = table({ t: t.numbers("t").slice(), v: t.numbers("v").slice() });
      const out: RangeExtremes = { low: -1, high: -1, gap: false };
      const fresh: RangeExtremes = { low: -1, high: -1, gap: false };
      const from = Math.floor(next() * 700);
      const to = from + 700;
      t.minMaxIndex("v").query(t.numbers("v"), from, to, out);
      check.minMaxIndex("v").query(check.numbers("v"), from, to, fresh);
      expect(out).toEqual(fresh);
      expect(t.extent("v")).toEqual(check.extent("v"));
    }
    expect(times(t)).toEqual([...times(t)].sort((a, b) => a - b));
    expect(t.length).toBe(1500);
  });

  it("numbers rows past a buffer's room, and gives room back as rows drop", () => {
    const t = orderedTable({ t: time([]), v: new Float64Array(0) }, { orderBy: "t", maxRows: 100 });
    for (let i = 0; i < 1000; i++) t.append({ t: [i, i - 0.5], v: [i, -i] });
    expect(t.length).toBe(100);
    expect(identities(t).slice(-4)).toEqual([1997, 1996, 1999, 1998]);
    expect(t.byteLength).toBeLessThan(100 * 8 * 3 * 4);
  });
});

describe("Table transactions and replace", () => {
  it("replace writes several fields as one change", () => {
    const t = table({ a: [1, 2, 3], b: [4, 5, 6], c: [7, 8, 9] });
    const changes = changesOf(t);
    t.replace(1, { a: [20, 30], b: [50, 60] });
    expect(Array.from(t.numbers("a"))).toEqual([1, 20, 30]);
    expect(Array.from(t.numbers("b"))).toEqual([4, 50, 60]);
    expect(changes).toEqual([
      { dropped: 0, appended: 0, updated: { start: 1, end: 3 }, fields: ["a", "b"], reset: false },
    ]);
    expect(() => t.replace(0, { a: [1], b: [1, 2] })).toThrow(
      'replace "b": has 2 values, expected 1',
    );
    expect(() => t.replace(0, { a: [1], b: ["x" as never] })).toThrow(/^replace "b": row 0/);
    expect(Array.from(t.numbers("a"))).toEqual([1, 20, 30]);
  });

  it("a transaction reports its writes as one change", () => {
    const t = table({ x: [1, 2, 3, 4], y: [1, 2, 3, 4] });
    const changes = changesOf(t);
    const version = t.version;
    t.transaction(() => {
      t.dropFirst(1);
      t.replace(2, { y: [30] });
      t.append({ x: [5, 6], y: [5, 6] });
      t.set("x", 0, 20);
    });
    expect(t.version).toBe(version + 1);
    expect(changes).toEqual([
      {
        dropped: 1,
        appended: 2,
        updated: { start: 0, end: 3 },
        fields: ["y", "x"],
        reset: false,
      },
    ]);
    expect(t.modifiedVersion).toBe(t.version);
  });

  it("counts rows a transaction appended and dropped as never kept", () => {
    const t = table({ x: [1, 2] });
    const changes = changesOf(t);
    t.transaction(() => {
      t.append({ x: [3, 4, 5] });
      t.dropFirst(4);
    });
    expect(Array.from(t.numbers("x"))).toEqual([5]);
    expect(changes).toEqual([{ dropped: 2, appended: 1, updated: null, fields: [], reset: false }]);
    expect(t.rowOffset).toBe(4);
  });

  it("joins nested transactions, and reports writes before a throw", () => {
    const t = table({ x: [1, 2] });
    const changes = changesOf(t);
    expect(() =>
      t.transaction(() => {
        t.append({ x: [3] });
        t.transaction(() => t.append({ x: [4] }));
        expect(changes).toEqual([]);
        throw new Error("stop");
      }),
    ).toThrow("stop");
    expect(changes).toEqual([{ dropped: 0, appended: 2, updated: null, fields: [], reset: false }]);
    // A refused write changes nothing; nothing is reported.
    expect(() => t.transaction(() => t.append({ x: ["a" as never] }))).toThrow();
    expect(changes).toHaveLength(1);
    t.transaction(() => {});
    expect(changes).toHaveLength(1);
  });

  it("reports a reset in a transaction as a reset", () => {
    const t = table({ x: [1, 2] });
    const changes = changesOf(t);
    t.transaction(() => {
      t.append({ x: [3] });
      t.reset({ x: [9] });
      t.append({ x: [10] });
    });
    expect(changes).toEqual([{ dropped: 0, appended: 0, updated: null, fields: [], reset: true }]);
  });

  it("runs a transaction inside a listener as a write there: one change, told when it returns", () => {
    // What each listener hears, in turn, when the first writes as it hears the first change.
    const heard = (write: (t: ReturnType<typeof table<{ x: number[] }>>) => void) => {
      const t = table({ x: [1] });
      const log: string[] = [];
      let once = true;
      t.subscribe((change) => {
        log.push(`a ${change.appended}`);
        if (!once) return;
        once = false;
        write(t);
        log.push("a returns");
      });
      t.subscribe((change) => log.push(`b ${change.appended}`));
      t.append({ x: [2] });
      return log;
    };
    const transaction = heard((t) =>
      t.transaction(() => {
        t.append({ x: [3] });
        t.append({ x: [4] });
      }),
    );
    const write = heard((t) => t.append({ x: [3, 4] }));
    expect(transaction).toEqual(["a 1", "a 2", "b 2", "a returns", "b 1"]);
    expect(transaction).toEqual(write);
  });

  it("lets ordered tables merge inside listeners and transactions", () => {
    const source = table({ x: [1] });
    const t = orderedTable({ t: [10], v: [1] }, { orderBy: "t" });
    source.subscribe(() => t.append({ t: [5], v: [0] }));
    source.append({ x: [2] });
    expect(times(t)).toEqual([5, 10]);
    const changes = changesOf(t);
    t.transaction(() => {
      t.append({ t: [7], v: [7] });
      t.append({ t: [20, 6], v: [20, 6] });
      t.replace(0, { v: [50] });
    });
    expect(times(t)).toEqual([5, 6, 7, 10, 20]);
    expect(changes).toEqual([
      {
        dropped: 0,
        appended: 1,
        inserted: { start: 1, count: 2 },
        updated: { start: 0, end: 1 },
        fields: ["v"],
        reset: false,
      },
    ]);
  });
});

describe("row sets and views of ordered tables", () => {
  it("keep members on their rows as late rows move them", () => {
    const t = orderedTable({ t: [10, 20, 30, 40], v: [1, 2, 3, 4] }, { orderBy: "t" });
    const rows = new RowSet(t).addAll([1, 3]);
    expect(Array.from(rows.positions())).toEqual([1, 3]);
    t.append({ t: [15, 5, 35], v: [0, 0, 0] });
    // 20 and 40 are now at 3 and 6.
    expect(Array.from(rows.positions())).toEqual([3, 6]);
    expect(rows.has(3)).toBe(true);
    expect(rows.has(1)).toBe(false);
    rows.add(1);
    expect(rows.size).toBe(3);
    t.dropBefore("t", 16);
    expect(Array.from(rows.positions())).toEqual([0, 3]);
    expect(rows.size).toBe(2);
    rows.delete(0);
    expect(Array.from(rows.positions())).toEqual([3]);
    t.reset({ t: [1], v: [1] });
    expect(rows.size).toBe(0);
    expect(rows.current).toBe(false);
  });

  it("keep row sets bounded over an hour of early-arriving rows", () => {
    // Ten rows a second for an hour in a window of 3,000 rows. A row in a
    // hundred arrives early, dated an hour ahead: it stays while every row
    // around it in arrival order is dropped.
    const t = orderedTable(
      { t: time([]), v: new Float64Array(0) },
      { orderBy: "t", maxRows: 3000 },
    );
    const selected = new RowSet(t);
    const added = new RowSet(t);
    let largest = 0;
    for (let second = 0; second < 3600; second++) {
      const at = second * 1000;
      const batch = Array.from({ length: 10 }, (_, i) =>
        (second * 10 + i) % 100 === 0 ? at + 3_600_000 : at + i * 100 - 2000,
      );
      t.append({ t: batch, v: batch });
      // One set keeps the window's newest rows; one gains rows and never reads.
      selected.addRange(t.length - 10, t.length);
      if (second % 7 === 0) added.addRange(0, Math.min(5, t.length));
      if (second % 60 === 0) expect(selected.size).toBeLessThanOrEqual(t.length);
      largest = Math.max(largest, selected.byteLength, added.byteLength);
    }
    expect(t.length).toBe(3000);
    // 12 bytes a word, words of members and of rows dropped since the last trim.
    expect(largest).toBeLessThan(12 * 3000 * 2);
    const positions = selected.positions();
    expect(positions.length).toBe(selected.size);
    for (const position of positions) expect(selected.has(position)).toBe(true);
  });

  it("let go of words their members left, though the table drops none", () => {
    const t = orderedTable(
      { t: Array.from({ length: 32_000 }, (_, i) => i), v: new Float64Array(32_000) },
      { orderBy: "t" },
    );
    const picked = new RowSet(t);
    for (let word = 0; word < 1000; word++) picked.add(word * 32);
    for (let word = 0; word < 1000; word++) picked.delete(word * 32);
    expect(picked.size).toBe(0);
    expect(picked.byteLength).toBeLessThan(12 * 64);
    picked.addAll([5, 70, 31_999]);
    expect(Array.from(picked.positions())).toEqual([5, 70, 31_999]);
  });

  it("views follow late rows as a view made again would", () => {
    const t = orderedTable(
      {
        t: Array.from({ length: 200 }, (_, i) => i),
        v: Array.from({ length: 200 }, (_, i) => i % 13),
      },
      { orderBy: "t", maxRows: 260 },
    );
    const filtered = rowView(t, { filter: col("v").gt(4) });
    const sorted = rowView(t, { filter: col("v").lt(9), sort: [{ field: "v" }] });
    let seed = 7;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let step = 0; step < 40; step++) {
      filtered.read();
      sorted.read();
      const end = t.numbers("t")[t.length - 1]!;
      const batch = Array.from({ length: 3 }, (_, i) => (i === 0 ? end + 1 : end - next() * 30));
      t.append({ t: batch, v: batch.map(() => Math.floor(next() * 13)) });
      if (step % 9 === 4) t.replace(5, { v: [1, 2, 3] });
      const same = (view: typeof filtered) =>
        expect(Array.from(view.read().indices!)).toEqual(
          Array.from(rowView(t, view.query).read().indices!),
        );
      same(filtered);
      same(sorted);
    }
  });
});
