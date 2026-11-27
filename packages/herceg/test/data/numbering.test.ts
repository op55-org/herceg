// Copies of one history against a reference: numbered mutations, channel
// states delivered between realms in random orders, and server writes; then
// the bytes each numbering keeps, and what a channel value refuses. The
// shared cases are sessions.test.ts's.

import { describe, expect, it } from "vitest";
import {
  type ChannelKey,
  type ChannelState,
  type ChannelValue,
  channelOf,
  checkChannelValue,
  compareStamps,
  isObsolete,
  MAX_CHANNEL_ROWS,
  newPage,
  type Page,
  pageGesture,
  pageReceive,
  pageSnapshot,
  pageStates,
  pageTakeOver,
  pageWrite,
  receive,
  resolve,
  serverWrite,
} from "../../src/data/channel-states.ts";
import {
  type Copy,
  heldRanges,
  type Mutation,
  numberedRows,
  numberingBytes,
  ordinalAt,
  ordinalsAt,
  ordinalsOf,
  positionOf,
  rowsOf,
  selectedPositions,
  stage,
} from "../../src/data/numbering.ts";

function random(seed: number) {
  let state = seed + 1;
  return (n: number) => {
    state = (state * 16807) % 2147483647;
    return state % n;
  };
}

/** How many runs of ordinals following on `ordinals` make. */
function runsIn(ordinals: readonly number[]): number {
  return ordinals.filter((ordinal, i) => i === 0 || ordinal !== ordinals[i - 1]! + 1).length;
}

interface Member {
  name: string;
  realm: number;
  copy: Copy;
  /** What the owner's order gives it: its generation and its rows' ordinals. */
  reference: { generation: number; ordinals: number[] };
}

describe("copies of one history, against a reference", () => {
  for (let seed = 0; seed < 60; seed++)
    it(`history ${seed}`, () => {
      const pick = random(seed);
      const snapshot = pick(30);
      const next = new Map([[0, snapshot]]);
      let generations = 0;
      const realms = 1 + pick(3);
      const members: Member[] = Array.from({ length: 2 + pick(3) }, (_, i) => {
        const maxRows = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 12, 30][pick(4)]!;
        const kept = Math.min(snapshot, maxRows);
        return {
          name: `w${i}`,
          realm: pick(realms),
          copy: {
            ...numberedRows(0, snapshot - kept, kept, snapshot - kept),
            allocation: { base: snapshot },
            revision: 0,
            maxRows,
          },
          reference: {
            generation: 0,
            ordinals: Array.from({ length: kept }, (_, k) => snapshot - kept + k),
          },
        };
      });
      // Realm 0 stamps the stream's writes, once it restored the stream;
      // the role moves between realms below.
      const pages: Page[] = Array.from({ length: realms }, (_, realm) =>
        realm === 0
          ? pageSnapshot(newPage("r0"), { stream: "s", epoch: "a1:1", channels: [] }).page
          : newPage(`r${realm}`),
      );
      // States to deliver to other realms, in any order; every state made, by key.
      const pending: { state: ChannelState; to: number }[] = [];
      const made = new Map<number, ChannelState[]>();
      const keyOf = (generation: number): ChannelKey => ({
        namespace: "",
        data: "trips",
        generation,
        channel: "focus",
      });
      const publish = (state: ChannelState, from: number) => {
        made.set(state.generation, [...(made.get(state.generation) ?? []), state]);
        for (let to = 0; to < realms; to++) if (to !== from) pending.push({ state, to });
      };
      let revision = 0;
      // The generation of the channel the last server write wrote: writes are
      // ordered per channel, so a late one is late for that channel.
      let written = 0;
      let stamper = 0;
      // Whether every realm that took over stamping had its predecessor's states.
      let handedAll = true;
      // The stream's state: the last write per channel, as its snapshot carries it.
      const last = new Map<number, { revision: number; value: ChannelValue }>();

      for (let step = 0; step < 150; step++) {
        const member = members[pick(members.length)]!;
        const { copy, reference } = member;
        const roll = pick(100);
        if (roll < 45) {
          // An append, numbered once by the owner, some with a window of their own.
          const count = pick(6);
          const maxRows = [undefined, undefined, undefined, 8, 20][pick(5)];
          const first = next.get(reference.generation)!;
          next.set(reference.generation, first + count);
          const mutation: Mutation = {
            op: "append",
            first,
            count,
            revision: copy.revision + 1,
            ...(maxRows === undefined ? {} : { maxRows }),
          };
          member.copy = stage(copy, [mutation], { allocator: "a1" });
          const window = Math.min(copy.maxRows, maxRows ?? Number.POSITIVE_INFINITY);
          const rows = [
            ...reference.ordinals,
            ...Array.from({ length: count }, (_, k) => first + k),
          ];
          reference.ordinals = rows.slice(Math.max(0, rows.length - window));
        } else if (roll < 55 && copy.length > 0) {
          const start = pick(copy.length);
          member.copy = stage(copy, [
            {
              op: "replace",
              start,
              count: pick(copy.length - start + 1),
              revision: copy.revision + 1,
            },
          ]);
        } else if (roll < 62) {
          const count = pick(15);
          const generation = ++generations;
          next.set(generation, count);
          member.copy = stage(
            copy,
            [{ op: "reset", generation, count, revision: copy.revision + 1 }],
            {
              allocator: "a1",
            },
          );
          const kept = Math.min(count, copy.maxRows);
          member.reference = {
            generation,
            ordinals: Array.from({ length: kept }, (_, k) => count - kept + k),
          };
        } else if (roll < 80) {
          // A gesture: some rows, none, or a clear.
          const kind = pick(5);
          const positions = Array.from({ length: copy.length }, (_, p) => p).filter(
            () => pick(3) === 0,
          );
          const value: ChannelValue =
            kind === 0
              ? null
              : { kind: "rows", ordinals: ordinalsOf(copy, kind === 1 ? [] : positions) };
          const { page, state } = pageGesture(
            pages[member.realm]!,
            keyOf(copy.numbering.generation),
            member.name,
            value,
          );
          pages[member.realm] = page;
          publish(state, member.realm);
        } else if (roll < 87) {
          // A server's write through realm 0, which stamps it once; some
          // arrive late, behind a newer one, and are dropped.
          const late = revision > 0 && pick(3) === 0;
          const write = {
            stream: "s",
            epoch: "a1:1",
            revision: late ? revision - 1 : ++revision,
            index: 0,
          };
          const ordinals = Float64Array.from(reference.ordinals.filter(() => pick(2) === 0)).sort();
          if (!late) written = reference.generation;
          const value: ChannelValue = { kind: "rows", ordinals };
          const { page, state, outcome } = pageWrite(pages[stamper]!, keyOf(written), write, value);
          pages[stamper] = page;
          expect(outcome).toBe(late ? "obsolete" : "applied");
          if (state) {
            publish(state, stamper);
            last.set(written, { revision, value });
          }
        } else if (roll < 90 && realms > 1) {
          // The stamping role moves: the realm that stamped stops and hands its
          // states over, or leaves without; the next restores the stream first.
          const to = (stamper + 1 + pick(realms - 1)) % realms;
          const hands = pick(4) > 0;
          handedAll &&= hands;
          pages[to] = pageTakeOver(pages[to]!, hands ? pageStates(pages[stamper]!) : []);
          const channels = [...last].map(([generation, { revision, value }]) => ({
            key: keyOf(generation),
            value,
            revision,
            index: 0,
          }));
          const restored = pageSnapshot(pages[to]!, {
            stream: "s",
            epoch: "a1:1",
            requested: true,
            channels,
          });
          pages[to] = restored.page;
          expect(restored.outcome).toBe("restored");
          // Handed over, every write the stream carries was accepted already.
          if (hands) expect(restored.states).toEqual([]);
          for (const state of restored.states) publish(state, to);
          stamper = to;
        } else if (pending.length > 0) {
          const { state, to } = pending.splice(pick(pending.length), 1)[0]!;
          pages[to] = pageReceive(pages[to]!, state).page;
        }
        const rows = member.reference.ordinals;
        const now = member.copy;
        expect(now.numbering.generation).toBe(member.reference.generation);
        expect(Array.from(ordinalsAt(now))).toEqual(rows);
        expect(numberingBytes(now.numbering)).toBeLessThanOrEqual(8 * rows.length);
        const runs = runsIn(rows);
        if (runs <= 1) expect(now.numbering.kind).toBe("offset");
        else if (now.numbering.kind === "runs") expect(3 * runs).toBeLessThanOrEqual(rows.length);
        else expect(6 * runs).toBeGreaterThan(rows.length);
      }

      // Every state reaches every realm, in a random order; each realm then
      // holds, per generation, the state stamped last, and each copy the rows
      // of it that it holds.
      while (pending.length > 0) {
        const { state, to } = pending.splice(pick(pending.length), 1)[0]!;
        pages[to] = pageReceive(pages[to]!, state).page;
      }
      for (const [generation, states] of made) {
        const newest = states.reduce((a, b) => (compareStamps(a.stamp, b.stamp) >= 0 ? a : b));
        // A stamp names one state; a handed-over one is a copy with its slot's writes.
        for (const page of pages) {
          const held = channelOf(page, keyOf(generation));
          expect(held?.stamp).toEqual(newest.stamp);
          expect(held?.value).toEqual(newest.value);
        }
        // With every predecessor's states handed over, a later write is stamped later.
        if (!handedAll) continue;
        const written = states.filter((state) => state.write);
        for (const a of written)
          for (const b of written)
            if (a.write!.revision > b.write!.revision)
              expect(compareStamps(a.stamp, b.stamp)).toBeGreaterThan(0);
      }
      for (const member of members) {
        const { generation, ordinals } = member.reference;
        const last = channelOf(pages[member.realm]!, keyOf(generation));
        const resolved = resolve(member.copy, last);
        if (last?.value == null) expect(resolved).toEqual({ kind: "none" });
        else {
          const chosen = new Set((last.value as { ordinals: Float64Array }).ordinals);
          const positions = ordinals.flatMap((ordinal, p) => (chosen.has(ordinal) ? [p] : []));
          expect(resolved.kind === "rows" && Array.from(resolved.positions)).toEqual(positions);
        }
      }
    });
});

describe("numbering", () => {
  it("maps positions to ordinals and back in every form", () => {
    const forms = [
      rowsOf(0, [4, 5, 6, 7]),
      rowsOf(0, [0, 1, 2, 3, 10, 11, 12, 13, 14, 15, 30, 31], 5),
      rowsOf(0, [9, 2, 7, 1]),
    ];
    expect(forms.map((rows) => rows.numbering.kind)).toEqual(["offset", "runs", "ordinals"]);
    for (const rows of forms) {
      const ordinals = ordinalsAt(rows);
      ordinals.forEach((ordinal, position) => {
        expect(ordinalAt(rows, position)).toBe(ordinal);
        expect(positionOf(rows, ordinal)).toBe(position);
      });
      expect(ordinalAt(rows, rows.length)).toBeNaN();
      expect(ordinalAt(rows, -1)).toBeNaN();
      expect(positionOf(rows, 100)).toBe(-1);
      expect(positionOf(rows, 4.5)).toBe(-1);
    }
  });

  it("stays exact for runs of ordinals up to 2^53 - 1 past a row offset", () => {
    const most = Number.MAX_SAFE_INTEGER;
    const rows = rowsOf(0, [0, 1, 2, 3, 4, 5, most - 2, most - 1, most], 7);
    expect(rows.numbering.kind).toBe("runs");
    expect([6, 7, 8].map((position) => ordinalAt(rows, position))).toEqual([
      most - 2,
      most - 1,
      most,
    ]);
    expect([most - 2, most - 1, most].map((ordinal) => positionOf(rows, ordinal))).toEqual([
      6, 7, 8,
    ]);
    expect(Array.from(selectedPositions(rows, Float64Array.of(4, most - 1, most)))).toEqual([
      4, 7, 8,
    ]);
  });

  it("gives a selection's ordinals ascending and once, and finds them from a position on", () => {
    const rows = rowsOf(0, [9, 2, 7, 1, 20, 21]);
    expect(Array.from(ordinalsOf(rows, [2, 0, 2, 1]))).toEqual([2, 7, 9]);
    const chosen = Float64Array.of(1, 2, 20, 50);
    expect(Array.from(selectedPositions(rows, chosen))).toEqual([1, 3, 4]);
    expect(Array.from(selectedPositions(rows, chosen, 2))).toEqual([3, 4]);
    expect(() => ordinalsOf(rows, [6])).toThrow(/some are not rows of the copy's 6/);
    const runs = rowsOf(0, [0, 1, 2, 3, 4, 5, 6, 7, 8, 100, 101, 102]);
    expect(runs.numbering.kind).toBe("runs");
    expect(Array.from(selectedPositions(runs, Float64Array.of(3, 8, 101), 4))).toEqual([8, 10]);
    expect(Array.from(heldRanges(rowsOf(0, [5, 6, 0, 1, 2, 3, 4])))).toEqual([0, 7]);
  });

  it("keeps at most 8 bytes a row, and 8 a selected row in a channel", () => {
    // An offset keeps nothing; runs 24 bytes each while there are at most a
    // third as many as rows; past that an ordinals column, 8 a row.
    const rows = 100_000;
    const offset = rowsOf(
      0,
      Array.from({ length: rows }, (_, i) => i),
    );
    expect(numberingBytes(offset.numbering)).toBe(0);
    // Another copy's appends interleaving every 100 rows: 1,000 runs.
    const interleaved = rowsOf(
      0,
      Array.from({ length: rows }, (_, i) => i + 7 * Math.floor(i / 100)),
    );
    expect(interleaved.numbering.kind).toBe("runs");
    expect(numberingBytes(interleaved.numbering) / rows).toBe(0.24);
    // Every other row another copy's: an ordinals column.
    const column = rowsOf(
      0,
      Array.from({ length: rows }, (_, i) => 2 * i),
    );
    expect(column.numbering.kind).toBe("ordinals");
    expect(numberingBytes(column.numbering) / rows).toBe(8);
    // A canonical set is a float64 per selected row.
    expect(
      ordinalsOf(
        offset,
        Array.from({ length: 10_000 }, (_, i) => 3 * i),
      ).byteLength,
    ).toBe(80_000);
  });
});

describe("server writes", () => {
  const key = { namespace: "", data: "trips", generation: 0, channel: "focus" };
  const write = (revision: number) => ({ stream: "s", epoch: "a1:1", revision, index: 0 });

  it("are dropped at or below the newest accepted; their states are ordered by stamps", () => {
    const accepted = serverWrite({ writes: [] }, key, write(44), null, 0, "page");
    expect(serverWrite(accepted.slot, key, write(43), null, 1, "page").state).toBeUndefined();
    // A state of write 43 that another realm stamped later (one that took
    // over stamping without its predecessor's states) wins by its stamp, as
    // it does in every realm that receives both, and keeps write 44 known.
    const older = serverWrite({ writes: [] }, key, write(43), null, 8, "other").state!;
    expect(compareStamps(older.stamp, accepted.state!.stamp)).toBeGreaterThan(0);
    const { slot, applied } = receive(accepted.slot, older);
    expect(applied).toBe(true);
    expect(slot.writes).toEqual([write(44)]);
    expect(receive({ writes: [] }, accepted.state!).applied).toBe(true);
    expect(receive(slot, accepted.state!).applied).toBe(false);
    // What a dropped state says of accepted writes is kept.
    const { write: _, ...gestured } = older;
    const told = { ...gestured, writes: [write(45)] };
    expect(receive(slot, told).applied).toBe(false);
    expect(receive({ writes: [] }, told).slot.writes).toEqual([write(45)]);
    expect(isObsolete([write(45)], write(45))).toBe(true);
    expect(isObsolete([write(45)], { ...write(45), index: 1 })).toBe(false);
    expect(isObsolete([write(45)], { ...write(40), epoch: "a2:1" })).toBe(false);
  });
});

describe("channel values", () => {
  const rows = (ordinals: number[]): ChannelValue => ({
    kind: "rows",
    ordinals: Float64Array.from(ordinals),
  });

  it("take ordinals ascending, each once, whole, and JS-safe", () => {
    expect(() => checkChannelValue(rows([1, 4, 9]), "focus")).not.toThrow();
    expect(() => checkChannelValue(null, "focus")).not.toThrow();
    expect(() => checkChannelValue(rows([1, 4, 4]), "focus")).toThrow(
      "focus: ordinals[2] (4) does not follow 4; send a channel's rows ascending and each once, as ordinalsOf gives them",
    );
    expect(() => checkChannelValue(rows([1, 0.5]), "focus")).toThrow(
      "focus: ordinals[1] is 0.5, not an ordinal; send whole numbers from 0 to 2^53 - 1",
    );
    expect(() => checkChannelValue(rows([2 ** 53]), "focus")).toThrow(
      /ordinals\[0\] is 9007199254740992/,
    );
  });

  it("carry at most 2^21 rows", () => {
    const most = new Float64Array(MAX_CHANNEL_ROWS).map((_, i) => i);
    expect(() => checkChannelValue({ kind: "rows", ordinals: most }, "focus")).not.toThrow();
    const more = new Float64Array(MAX_CHANNEL_ROWS + 1).map((_, i) => i);
    expect(() =>
      checkChannelValue({ kind: "rows", ordinals: more }, 'rowSelection channel "focus"'),
    ).toThrow(
      'rowSelection channel "focus": 2,097,153 rows (16.0 MiB) are more than a page channel carries (16 MiB); select them by a condition (a brush), or keep the binding\'s scope "chart"',
    );
  });
});
