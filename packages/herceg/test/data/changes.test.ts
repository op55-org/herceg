import { describe, expect, it } from "vitest";
import { changesSince } from "../../src/data/changes.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { table } from "../../src/data/table.ts";

const rows = (n: number, from = 0) => ({
  t: Float64Array.from({ length: n }, (_, i) => from + i),
  v: Float64Array.from({ length: n }, (_, i) => (from + i) * 10),
});

describe("changesSince()", () => {
  it("attaches on first use: earlier versions rebuild, and a table nothing asks of keeps none", () => {
    const data = table(rows(4));
    data.append(rows(2, 4));
    data.dropFirst(1);
    // Nothing recorded these changes: a reader from before them rebuilds.
    expect(changesSince(data, 0)).toBeUndefined();
    expect(changesSince(data, 1)).toBeUndefined();
    expect(changesSince(data, data.version)).toEqual({
      dropped: 0,
      appended: 0,
      updated: null,
      fields: [],
      reset: false,
      spans: [],
    });
    // From here on, it follows.
    const from = data.version;
    data.append(rows(1, 6));
    expect(changesSince(data, from)).toMatchObject({ dropped: 0, appended: 1, updated: null });
  });

  it("merges appends and drops, counting rows appended then dropped as neither", () => {
    const data = table(rows(4), { maxRows: 5 });
    const from = data.version;
    changesSince(data, from);
    data.append(rows(2, 4)); // drops 1
    data.dropFirst(2);
    data.append(rows(3, 6)); // 3 + 3 > 5: drops 1
    // Of the four rows there, three left; five rows came, of which one left again.
    expect(Array.from(data.numbers("t"))).toEqual([4, 5, 6, 7, 8]);
    expect(changesSince(data, from)).toEqual({
      dropped: 4,
      appended: 5,
      inserted: null,
      updated: null,
      fields: [],
      reset: false,
      spans: [],
    });
  });

  it("merges spans updated in place by slot, as drops move them, and their fields", () => {
    const data = table(rows(10));
    const from = data.version;
    changesSince(data, from);
    data.replace(6, { v: [1, 2] }); // rows 6 and 7
    data.dropFirst(3);
    data.replace(0, { t: [0.5] }); // what is row 3 of the first rows
    data.append(rows(2, 10));
    expect(changesSince(data, from)).toEqual({
      dropped: 3,
      appended: 2,
      inserted: null,
      updated: { start: 0, end: 5 },
      fields: ["v", "t"],
      reset: false,
      // Each write's own rows, where they are now.
      spans: [
        { start: 3, end: 5, fields: ["v"] },
        { start: 0, end: 1, fields: ["t"] },
      ],
    });
    // A reader that caught up after the first update hears only what followed.
    expect(changesSince(data, from + 1)).toMatchObject({
      dropped: 3,
      updated: { start: 0, end: 1 },
      fields: ["t"],
    });
  });

  it("leaves out spans whose rows were dropped since", () => {
    const data = table(rows(10));
    const from = data.version;
    changesSince(data, from);
    data.replace(1, { v: [1, 2] });
    data.dropFirst(4);
    expect(changesSince(data, from)).toMatchObject({ dropped: 4, updated: null, fields: [] });
  });

  it("merges an ordered table's insertions, with the rows appended among them", () => {
    const data = orderedTable({ t: [0, 10, 20, 30], v: [0, 1, 2, 3] }, { orderBy: "t" });
    const from = data.version;
    changesSince(data, from);
    data.append({ t: [40], v: [4] });
    data.append({ t: [15], v: [5] }); // before what was the last row
    data.append({ t: [50], v: [6] });
    expect(Array.from(data.numbers("t"))).toEqual([0, 10, 15, 20, 30, 40, 50]);
    expect(changesSince(data, from)).toEqual({
      dropped: 0,
      appended: 0,
      inserted: { start: 2, count: 3 },
      updated: null,
      fields: [],
      reset: false,
      spans: [],
    });
    // One change is told as the table told it.
    const last = changesSince(data, data.version - 1)!;
    expect([last.appended, last.inserted ?? null]).toEqual([1, null]);
  });

  it("keeps each write's span, so that writes far apart name only their rows", () => {
    const data = table(rows(1000));
    const from = data.version;
    changesSince(data, from);
    for (let i = 0; i < 16; i++) data.replace(i * 60, { v: [i] });
    const changes = changesSince(data, from)!;
    expect(changes.updated).toEqual({ start: 0, end: 901 });
    expect(changes.spans.map(({ start, end }) => end - start)).toEqual(Array(16).fill(1));
    expect(changes.spans[15]).toEqual({ start: 900, end: 901, fields: ["v"] });
  });

  it("asks a reader more than 16 changes behind, or behind a reset, to rebuild", () => {
    const data = table(rows(4));
    const from = data.version;
    changesSince(data, from);
    for (let i = 0; i < 16; i++) data.append(rows(1, 4 + i));
    expect(changesSince(data, from)).toMatchObject({ appended: 16 });
    data.append(rows(1, 20));
    expect(changesSince(data, from)).toBeUndefined();
    expect(changesSince(data, from + 1)).toMatchObject({ appended: 16 });
    const before = data.version;
    data.reset(rows(3));
    expect(changesSince(data, before)).toBeUndefined();
    expect(changesSince(data, data.version)).toMatchObject({ appended: 0, dropped: 0 });
  });

  it("hears a transaction's writes as one change", () => {
    const data = table(rows(6));
    const from = data.version;
    changesSince(data, from);
    data.transaction(() => {
      data.replace(4, { v: [0] });
      data.dropFirst(2);
      data.append(rows(1, 6));
    });
    expect(data.version).toBe(from + 1);
    expect(changesSince(data, from)).toMatchObject({
      dropped: 2,
      appended: 1,
      updated: { start: 2, end: 3 },
      fields: ["v"],
    });
  });

  it("rebuilds after a change heard out of turn, written by a listener before it", () => {
    const data = table(rows(6));
    let once = true;
    data.subscribe(() => {
      if (!once) return;
      once = false;
      data.append(rows(1, 6));
    });
    const from = data.version;
    changesSince(data, from);
    data.dropFirst(1);
    expect(changesSince(data, from)).toBeUndefined();
    const now = data.version;
    data.append(rows(1, 7));
    expect(changesSince(data, now)).toMatchObject({ appended: 1, dropped: 0 });
  });

  it("asks a listener told before the journal, which a change has not reached, to rebuild", () => {
    const data = table(rows(6));
    const heard: unknown[] = [];
    let since = data.version;
    let nested = false;
    data.subscribe(() => {
      if (nested) {
        nested = false;
        // A write made here, read at once.
        data.append(rows(1, 6));
      }
      heard.push(changesSince(data, since));
      since = data.version;
    });
    changesSince(data, since);
    data.replace(0, { v: [1] });
    expect(heard).toEqual([undefined]);
    // Read after it, the change has reached the journal.
    data.replace(1, { v: [2] });
    expect(changesSince(data, since)).toEqual(changesSince(data, data.version));
    const after = data.version;
    data.replace(2, { v: [3] });
    expect(changesSince(data, after)).toMatchObject({ updated: { start: 2, end: 3 } });
    nested = true;
    expect(() => data.replace(3, { v: [4] })).not.toThrow();
    // Then the append it made, which it read already.
    expect(heard.at(-2)).toBeUndefined();
    expect(heard.at(-1)).toMatchObject({ dropped: 0, appended: 0, updated: null });
  });
});
