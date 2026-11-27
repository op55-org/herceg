import { describe, expect, it } from "vitest";
import { col } from "../../src/data/expr.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows, selectWhere } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import {
  historyBytes,
  historyOf,
  type MembershipChanges,
  type MembershipCursor,
} from "../../src/model/membership-changes.ts";
import { type Membership, membershipOf } from "../../src/model/memberships.ts";

/** A table read by field name at run time, as lineage reads it. */
const untyped = (...args: Parameters<typeof table>) => table(...args) as unknown as Table;

/**
 * Applies changes to what a reader kept at `cursor` (`kept`, by position)
 * as a consumer would: the dropped rows go, rows that left become 0, rows
 * that joined 1; returns the bytes it then holds, which must be the
 * membership's now.
 */
function applied(kept: Uint8Array, changes: MembershipChanges): Uint8Array {
  if (changes.kind !== "delta") throw new Error(`expected a delta, got ${changes.kind}`);
  const { from, to, dropped, left, joined } = changes;
  const out = kept.slice();
  for (const p of left) {
    expect(out[p], `left row ${p} was selected`).toBe(1);
    out[p] = 0;
  }
  const next = new Uint8Array(to.length);
  next.set(out.subarray(dropped, Math.min(from.length, dropped + to.length)));
  for (const p of joined) {
    expect(next[p], `joined row ${p} was not selected`).toBe(0);
    next[p] = 1;
  }
  return next;
}

/** A reader keeping its own copy of the bytes, following by changes. */
function reader(membership: Membership) {
  const history = historyOf(membership);
  let cursor: MembershipCursor = history.cursor();
  let kept: Uint8Array = membership.selected.slice();
  return {
    read(): MembershipChanges {
      const changes = history.changes(cursor);
      if (changes.kind === "delta") {
        kept = applied(kept, changes);
        cursor = changes.to;
      } else if (changes.kind === "rebuild") {
        kept = membership.selected.slice();
        cursor = changes.cursor;
      }
      expect(Array.from(kept)).toEqual(Array.from(membership.selected));
      return changes;
    },
  };
}

describe("memberships", () => {
  it("are shared by store and channel, apart for two stores under one channel name", () => {
    const source = untyped({ x: [1, 2, 3] });
    const [a, b] = [selectionStore(source), selectionStore(source)];
    a.set("c", selectWhere(col("x").ge(2)));
    b.set("c", selectWhere(col("x").ge(3)));
    expect(membershipOf(a, "c")).toBe(membershipOf(a, "c"));
    expect(Array.from(membershipOf(a, "c").selected)).toEqual([0, 1, 1]);
    expect(Array.from(membershipOf(b, "c").selected)).toEqual([0, 0, 1]);
    expect([membershipOf(a, "c").count, membershipOf(b, "c").count]).toEqual([2, 1]);
  });

  it("tell a cleared channel from a selection holding no rows", () => {
    const source = untyped({ x: [1, 2] });
    const store = selectionStore(source);
    const held = membershipOf(store, "c");
    expect([held.held, held.count]).toEqual([false, 0]);
    store.set("c", selectWhere(col("x").gt(5)));
    expect([held.held, held.count, Array.from(held.selected)]).toEqual([true, 0, [0, 0]]);
  });

  it("give deltas across appends and front drops, in both layouts", () => {
    const source = untyped({ x: [1, 5, 2, 6] }, { maxRows: 5 });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("x").ge(5)));
    const membership = membershipOf(store, "c");
    const follower = reader(membership);
    source.append({ x: [7, 1, 9] });
    // Rows x = 1 and x = 5 dropped: 5 was selected and left; 7 and 9 joined.
    const changes = follower.read();
    expect(changes).toMatchObject({ kind: "delta", dropped: 2, updated: null });
    if (changes.kind !== "delta") return;
    expect(Array.from(changes.left)).toEqual([1]);
    expect(Array.from(changes.joined)).toEqual([2, 4]);
    expect(membership.count).toBe(3);
    // A selection change with appends between reads: one delta for both.
    store.set("c", selectWhere(col("x").le(2)));
    source.append({ x: [0] });
    follower.read();
    // x = 2 dropped: 1 and 0 are held.
    expect(membership.count).toBe(2);
  });

  it("give in-place edits as updated rows, testing the condition again where it reads them", () => {
    const source = untyped({ x: [1, 5, 2], y: [0, 0, 0] });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("x").ge(5)));
    const membership = membershipOf(store, "c");
    const follower = reader(membership);
    source.set("y", 1, 3);
    const unread = follower.read();
    expect(unread).toMatchObject({ kind: "delta", updated: { start: 1, end: 2 }, fields: ["y"] });
    source.set("x", 2, 8);
    const read = follower.read();
    expect(read).toMatchObject({ kind: "delta", updated: { start: 2, end: 3 }, fields: ["x"] });
    if (read.kind === "delta") expect(Array.from(read.joined)).toEqual([2]);
    expect(membership.count).toBe(2);
  });

  it("follow row sets, which rows appended never join", () => {
    const source = untyped({ x: [1, 2, 3, 4] }, { maxRows: 4 });
    const store = selectionStore(source);
    store.set("c", selectRows(new RowSet(source).addAll([0, 2])));
    const membership = membershipOf(store, "c");
    const follower = reader(membership);
    store.set("c", selectRows(new RowSet(source).addAll([0, 3])));
    const changes = follower.read();
    if (changes.kind === "delta") {
      expect(Array.from(changes.left)).toEqual([2]);
      expect(Array.from(changes.joined)).toEqual([3]);
    }
    source.append({ x: [5] });
    follower.read();
    // x = 1 dropped; x = 4 moved to row 2, and x = 5 is no member.
    expect(Array.from(membership.selected)).toEqual([0, 0, 1, 0]);
  });

  it("rebuild across resets and insertions", () => {
    const source = untyped({ x: [1, 5] });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("x").ge(5)));
    const follower = reader(membershipOf(store, "c"));
    source.reset({ x: [9, 9, 1] });
    expect(follower.read().kind).toBe("rebuild");
    const ordered = orderedTable({ t: [1, 3], x: [5, 6] }, { orderBy: "t" });
    const own = selectionStore(ordered);
    own.set("c", selectWhere(col("x").ge(5)));
    const late = reader(membershipOf(own, "c"));
    ordered.append({ t: [2], x: [7] });
    expect(late.read().kind).toBe("rebuild");
    expect(Array.from(membershipOf(own, "c").selected)).toEqual([1, 1, 1]);
  });

  it("merge the deltas a lagging reader missed, and rebuild once their history ran out", () => {
    const source = untyped({ x: Float64Array.from({ length: 64 }, (_, i) => i) }, { maxRows: 64 });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("x").ge(60)));
    const membership = membershipOf(store, "c");
    const lagging = reader(membership);
    const keeping = reader(membership);
    for (let i = 0; i < 6; i++) {
      // Rows join and leave between the lagging reader's reads.
      store.set("c", selectWhere(col("x").ge(58 + i)));
      source.append({ x: [100 + i] });
      keeping.read();
    }
    expect(lagging.read().kind).toBe("delta");
    // Past an eighth of the rows' positions, the oldest transitions go.
    for (let i = 0; i < 40; i++) {
      store.set("c", selectWhere(col("x").ge(i % 2 === 0 ? 0 : 200)));
      keeping.read();
    }
    expect(lagging.read().kind).toBe("rebuild");
  });

  it("give the rows that changed whatever the rows dropped do to their alignment", () => {
    // Drops of one to seven rows place the bytes kept at every offset within a word.
    const source = untyped(
      { x: Float64Array.from({ length: 200 }, (_, i) => i % 29) },
      { maxRows: 200 },
    );
    const store = selectionStore(source);
    store.set("c", selectWhere(col("x").ge(27)));
    const follower = reader(membershipOf(store, "c"));
    let seed = 7;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
    for (let step = 0; step < 60; step++) {
      const rows = 1 + (next() % 7);
      source.append({ x: Array.from({ length: rows }, () => next() % 29) });
      // A few rows change at a time, within the transitions a delta lists.
      if (step % 3 === 0) store.set("c", selectWhere(col("x").ge(step % 2 === 0 ? 28 : 27)));
      expect(follower.read().kind).toBe("delta");
    }
  });

  it("follow rows a listener moved while an earlier change was being told", () => {
    const source = untyped({ v: [0, 0, 0, 0] }, { maxRows: 4 });
    let appended = false;
    // Heard before the membership hears the edit: the rows move under it.
    source.subscribe(() => {
      if (appended) return;
      appended = true;
      source.append({ v: [0] });
    });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("v").ge(1)));
    const membership = membershipOf(store, "c");
    void membership.selected;
    source.set("v", 2, 1);
    expect(Array.from(membership.selected)).toEqual([0, 1, 0, 0]);
  });

  it("grow in place as rows arrive, leaving the bytes readers hold as they were", () => {
    const source = untyped({ x: [5] }, { maxRows: 100 });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("x").ge(5)));
    const membership = membershipOf(store, "c");
    const follower = reader(membership);
    const held: [Uint8Array, number[]][] = [];
    let buffers = new Set<ArrayBufferLike>();
    for (let i = 0; i < 300; i++) {
      source.append({ x: [i % 3 === 0 ? 5 : 1] });
      const bytes = membership.selected;
      held.push([bytes, Array.from(bytes)]);
      buffers.add(bytes.buffer);
      follower.read();
    }
    // Capacity crossings copy the bytes once each, into twice the rows.
    expect(buffers.size).toBeLessThan(10);
    for (const [bytes, then] of held) expect(Array.from(bytes)).toEqual(then);
    buffers = new Set();
    expect(membership.count).toBe(Array.from(membership.selected).filter((b) => b === 1).length);
  });

  it("hold their changes only once a reader asked for them", () => {
    const source = untyped({ x: Float64Array.from({ length: 1000 }, (_, i) => i) });
    const store = selectionStore(source);
    store.set("c", selectWhere(col("x").ge(10)));
    const membership = membershipOf(store, "c");
    void membership.selected;
    store.set("c", selectWhere(col("x").ge(20)));
    void membership.selected;
    // The bytes and their room, and no history.
    expect([membership.byteLength, historyBytes(membership)]).toEqual([1250, 0]);
    const follower = reader(membership);
    store.set("c", selectWhere(col("x").ge(30)));
    follower.read();
    // Ten rows left: their positions.
    expect(historyBytes(membership)).toBe(40);
  });
});
