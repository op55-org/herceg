// The session fixtures (test/contracts/fixtures/sessions.json): how copies
// of one data object name its rows, through the numbering, channel states,
// and envelope of TypeScript. python/tests/test_numbering.py answers the
// cases Python runs from the same file.

import { describe, expect, it } from "vitest";
import fixture from "../../../../test/contracts/fixtures/sessions.json";
import {
  type ChannelKey,
  type ChannelState,
  type ChannelValue,
  channelOf,
  newPage,
  type Page,
  pageGesture,
  pageReceive,
  pageSnapshot,
  pageStates,
  pageTakeOver,
  pageWrite,
  resolve,
} from "../../src/data/channel-states.ts";
import type { Expression } from "../../src/data/expression.ts";
import {
  type Allocation,
  appended,
  type Copy,
  disagreement,
  dropped,
  fromSpec,
  heldRanges,
  type Mutation,
  type NumberedRows,
  type NumberingSpec,
  numberedRows,
  ordinalAt,
  ordinalsAt,
  ordinalsOf,
  positionOf,
  rowsOf,
  stage,
} from "../../src/data/numbering.ts";
import {
  checkUpdateCounts,
  checkUpdateLength,
  type UpdateHeader,
  type UpdateOperation,
} from "../../src/web/envelope.ts";

type Ranges = readonly (readonly number[])[];

interface CopySpec {
  generation?: number;
  ordinals: Ranges;
  rowOffset?: number;
  maxRows?: number | null;
  revision?: number;
  base?: number;
  extendedBy?: string;
}

interface CopyExpect {
  generation?: number;
  ordinals?: Ranges;
  form?: string;
  rowOffset?: number;
  held?: Ranges;
  positions?: Record<string, number>;
  revision?: number;
  base?: number;
  extendedBy?: string;
  spec?: NumberingSpec;
  buffers?: Ranges[];
}

// biome-ignore lint/suspicious/noExplicitAny: each kind's cases are read by its runner below.
type Case = { name: string; kind: string; runs: string[] } & Record<string, any>;

const cases = (fixture.cases as Case[]).filter((c) => c.runs.includes("typescript"));
const ofKind = (kind: string) => cases.filter((c) => c.kind === kind);

const expand = (ranges: Ranges): number[] =>
  ranges.flatMap(([first, count]) => Array.from({ length: count! }, (_, i) => first! + i));

function copyOf(spec: CopySpec): Copy {
  const rows = rowsOf(spec.generation ?? 0, expand(spec.ordinals), spec.rowOffset ?? 0);
  return {
    ...rows,
    allocation: allocationOf(spec),
    revision: spec.revision ?? 0,
    maxRows: spec.maxRows ?? Number.POSITIVE_INFINITY,
  };
}

function allocationOf(facts: { base?: number; extendedBy?: string }): Allocation {
  return {
    ...(facts.base === undefined ? {} : { base: facts.base }),
    ...(facts.extendedBy === undefined ? {} : { extendedBy: facts.extendedBy }),
  };
}

function expectCopy(copy: Copy, want: CopyExpect) {
  if (want.generation !== undefined) expect(copy.numbering.generation).toBe(want.generation);
  if (want.ordinals) {
    const ordinals = expand(want.ordinals);
    expect(Array.from(ordinalsAt(copy))).toEqual(ordinals);
    expect(ordinals.map((_, position) => ordinalAt(copy, position))).toEqual(ordinals);
  }
  if (want.form) expect(copy.numbering.kind).toBe(want.form);
  if (want.rowOffset !== undefined) expect(copy.rowOffset).toBe(want.rowOffset);
  if (want.held) expect(Array.from(heldRanges(copy))).toEqual(want.held.flat());
  for (const [ordinal, position] of Object.entries(want.positions ?? {}))
    expect(positionOf(copy, Number(ordinal))).toBe(position);
  if (want.revision !== undefined) expect(copy.revision).toBe(want.revision);
  if (want.base !== undefined) expect(copy.allocation.base).toBe(want.base);
  if (want.extendedBy !== undefined) expect(copy.allocation.extendedBy).toBe(want.extendedBy);
}

/** The message `run` throws. */
function refusal(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("numbering", () => {
  for (const c of ofKind("numbering"))
    it(c.name, () => {
      let copy = copyOf(c.copy);
      for (const step of c.steps) {
        const allocator = step.allocator ?? c.allocator;
        if ("drop" in step) copy = { ...copy, ...dropped(copy, step.drop) };
        else if (step.refused) {
          const before = copy;
          expect(refusal(() => stage(copy, step.mutations, { allocator }))).toBe(
            step.refused.typescript,
          );
          expect(copy).toBe(before);
        } else copy = stage(copy, step.mutations, { allocator });
        if (step.expect) expectCopy(copy, step.expect);
      }
    });
});

describe("history", () => {
  for (const c of ofKind("history"))
    it(c.name, () => {
      // Copies of the snapshot, as the allocator makes them: its rows numbered
      // from 0, the table's own window dropping the first.
      const start = (maxRows?: number | null): Copy => {
        const kept = Math.min(c.snapshot, maxRows ?? Number.POSITIVE_INFINITY);
        return {
          ...numberedRows(0, c.snapshot - kept, kept, c.snapshot - kept),
          allocation: { base: c.snapshot },
          revision: 0,
          maxRows: maxRows ?? Number.POSITIVE_INFINITY,
        };
      };
      const copies = new Map<string, Copy>(
        Object.entries(c.copies as Record<string, { maxRows?: number }>).map(([name, spec]) => [
          name,
          start(spec.maxRows),
        ]),
      );
      for (const step of c.steps) {
        if (step.make) copies.set(step.copy, start(step.make.maxRows));
        else if (step.expect)
          copies.set(
            step.copy,
            stage(copies.get(step.copy)!, step.expect, { allocator: c.allocator }),
          );
      }
      for (const [name, want] of Object.entries(c.end as Record<string, CopyExpect>)) {
        const copy = copies.get(name)!;
        expectCopy(copy, want);
        // The numbering its snapshot carries gives the same rows back.
        const { rows, allocation } = fromSpec(want.spec, copy.length, (index) =>
          Float64Array.from(expand(want.buffers![index]!)),
        );
        expect(Array.from(ordinalsAt(rows))).toEqual(Array.from(ordinalsAt(copy)));
        expect(allocation).toEqual(copy.allocation);
      }
    });
});

/** A channel value as the fixtures write one. */
function channelValue(given: null | { rows?: number[]; predicate?: Expression }): ChannelValue {
  if (given === null) return null;
  if (given.rows) return { kind: "rows", ordinals: Float64Array.from(given.rows) };
  return { kind: "predicate", expression: given.predicate! };
}

interface PageCopy {
  realm: string;
  namespace: string;
  data: string;
  rows: NumberedRows;
}

describe("page", () => {
  for (const c of ofKind("page"))
    it(c.name, () => {
      const pages = new Map<string, Page>(c.realms.map((realm: string) => [realm, newPage(realm)]));
      const copies = new Map<string, PageCopy>(
        Object.entries(
          c.copies as Record<
            string,
            { realm: string; namespace?: string; data: string } & CopySpec
          >,
        ).map(([name, spec]) => [
          name,
          {
            realm: spec.realm,
            namespace: spec.namespace ?? "",
            data: spec.data,
            rows: rowsOf(spec.generation ?? 0, expand(spec.ordinals)),
          },
        ]),
      );
      const keyOf = (copy: PageCopy, channel: string): ChannelKey => ({
        namespace: copy.namespace,
        data: copy.data,
        generation: copy.rows.numbering.generation,
        channel,
      });
      const named = new Map<string, ChannelState>();
      for (const step of c.steps) {
        const want = step.expect ?? {};
        let stamp: ChannelState["stamp"] | undefined;
        if (step.gesture) {
          const g = step.gesture;
          const copy = copies.get(g.copy)!;
          const value: ChannelValue = g.clear
            ? null
            : g.predicate
              ? { kind: "predicate", expression: g.predicate }
              : { kind: "rows", ordinals: ordinalsOf(copy.rows, g.positions) };
          const { page, state } = pageGesture(
            pages.get(step.realm)!,
            keyOf(copy, g.channel),
            g.copy,
            value,
          );
          pages.set(step.realm, page);
          if (step.as) named.set(step.as, state);
          stamp = state.stamp;
          if (want.ordinals)
            expect(state.value?.kind === "rows" && Array.from(state.value.ordinals)).toEqual(
              want.ordinals,
            );
        } else if (step.receive) {
          const r = step.receive;
          const state: ChannelState =
            typeof r === "string"
              ? named.get(r)!
              : {
                  namespace: r.namespace ?? "",
                  data: r.data,
                  generation: r.generation ?? 0,
                  channel: r.channel,
                  stamp: r.stamp,
                  value: channelValue(r.value),
                };
          const { page, applied } = pageReceive(pages.get(step.realm)!, state);
          pages.set(step.realm, page);
          expect(applied).toBe(want.applied);
        } else if (step.write) {
          const w = step.write;
          const key = {
            namespace: w.namespace ?? "",
            data: w.data,
            generation: 0,
            channel: w.channel,
          };
          const write = { stream: w.stream, epoch: w.epoch, revision: w.revision, index: w.index };
          const { page, state, outcome } = pageWrite(
            pages.get(step.realm)!,
            key,
            write,
            channelValue(w.value),
          );
          pages.set(step.realm, page);
          expect(outcome).toBe(want.outcome);
          if (state && step.as) named.set(step.as, state);
          stamp = state?.stamp;
        } else if (step.takeOver) {
          // The realm that stamped before hands its states over, unless it left.
          const from = step.takeOver.from;
          const handed = from ? pageStates(pages.get(from)!) : [];
          pages.set(step.realm, pageTakeOver(pages.get(step.realm)!, handed));
        } else if (step.join) {
          // A realm joining another takes every state it holds, with the writes it accepted.
          for (const state of pageStates(pages.get(step.join)!))
            pages.set(step.realm, pageReceive(pages.get(step.realm)!, state).page);
        } else if (step.snapshot) {
          const s = step.snapshot;
          const { page, outcome, states } = pageSnapshot(pages.get(step.realm)!, {
            stream: s.stream,
            epoch: s.epoch,
            requested: s.requested,
            channels: s.channels.map(
              (ch: {
                namespace?: string;
                data: string;
                channel: string;
                value: null;
                revision: number;
                index: number;
              }) => ({
                key: {
                  namespace: ch.namespace ?? "",
                  data: ch.data,
                  generation: 0,
                  channel: ch.channel,
                },
                value: channelValue(ch.value),
                revision: ch.revision,
                index: ch.index,
              }),
            ),
          });
          pages.set(step.realm, page);
          expect(outcome).toBe(want.outcome);
          expect(states.map((state) => state.stamp)).toEqual(want.stamps);
          if (step.as) named.set(step.as, states[0]!);
        } else {
          const copy = copies.get(step.copy)!;
          if (step.append) copy.rows = appended(copy.rows, step.append.first, step.append.count);
          else if (step.reset) copy.rows = numberedRows(step.reset.generation, 0, step.reset.count);
          // A replacement edits values in place: the numbering stays.
        }
        if (want.stamp) expect(stamp).toEqual(want.stamp);
        if (want.clock !== undefined) expect(pages.get(step.realm)!.clock).toBe(want.clock);
        for (const [realm, clock] of Object.entries(want.clocks ?? {}))
          expect(pages.get(realm)!.clock).toBe(clock);
        for (const [name, channels] of Object.entries(want.copies ?? {})) {
          const copy = copies.get(name)!;
          for (const [channel, held] of Object.entries(channels as Record<string, unknown>)) {
            const resolved = resolve(
              copy.rows,
              channelOf(pages.get(copy.realm)!, keyOf(copy, channel)),
            );
            if (held === null) expect(resolved).toEqual({ kind: "none" });
            else if (Array.isArray(held))
              expect(resolved.kind === "rows" && Array.from(resolved.positions)).toEqual(held);
            else
              expect(resolved).toEqual({
                kind: "predicate",
                expression: (held as { predicate: Expression }).predicate,
              });
          }
        }
      }
    });
});

describe("agreement", () => {
  for (const c of ofKind("agreement"))
    it(c.name, () => {
      for (const { a, b, expect: want } of c.pairs)
        expect(disagreement(allocationOf(a), allocationOf(b)) ?? null).toEqual(want);
    });
});

describe("caps", () => {
  for (const c of ofKind("caps"))
    it(c.name, () => {
      for (const limit of c.limits) {
        const check = () => {
          if (limit.headerBytes !== undefined) checkUpdateLength(limit.headerBytes);
          if (limit.operations !== undefined)
            checkUpdateCounts({ operations: new Array(limit.operations), buffers: [] });
          if (limit.buffers !== undefined)
            checkUpdateCounts({ operations: [], buffers: new Array(limit.buffers) });
          if (limit.bufferBytes !== undefined)
            checkUpdateCounts({ operations: [], buffers: [[0, limit.bufferBytes]] });
        };
        if (limit.expect === null) expect(check).not.toThrow();
        else expect(refusal(check)).toBe(limit.typescript);
      }
      const { header, bytes } = c.measured;
      expect(new TextEncoder().encode(JSON.stringify(header)).length).toBe(bytes);
    });
});

/**
 * An update header as a stream case writes one: whole, or by its rule
 * operations' count, or by its revisions' buffer bytes, each an append of
 * one buffer.
 */
function headerOf(c: Case, want: Record<string, unknown>) {
  if (!("rules" in want || "bytes" in want)) return want;
  const { rules, bytes, ...rest } = want as { rules?: number; bytes?: number[] };
  const sizes = bytes ?? [];
  let end = 0;
  const buffers = sizes.map((size) => {
    const descriptor = [end, size];
    end = Math.ceil((end + size) / 8) * 8;
    return descriptor;
  });
  const operations = bytes
    ? sizes.map((_, buffer) => ({
        op: "append",
        data: "t",
        columns: { v: { type: "number", dtype: "float64", buffer } },
        first: 0,
        revision: 1,
      }))
    : Array.from({ length: rules! }, () => ({ op: "rule", id: "r" }));
  return {
    protocol: 1,
    kind: "update",
    stream: c.stream,
    epoch: c.epoch,
    ...rest,
    operations,
    buffers,
  };
}

/** A buffer as the fixtures write one: float64 values, or typed ({ int32: [...] }). */
function bufferOf(given: number[] | { float64?: number[]; int32?: number[] }) {
  if (Array.isArray(given)) return Float64Array.from(given);
  return given.int32 ? Int32Array.from(given.int32) : Float64Array.from(given.float64!);
}

describe("stream", () => {
  for (const c of ofKind("stream"))
    it(c.name, () => {
      for (const request of c.requests) {
        if (request.expect === null) continue;
        const header = headerOf(c, request.expect) as unknown as UpdateHeader;
        // What the page reads: within the limits.
        checkUpdateLength(new TextEncoder().encode(JSON.stringify(header)).length);
        checkUpdateCounts(header);
        if (!request.read) continue;
        // Its selects through a realm, each named by the revision and index
        // that wrote it; then the first again, through another fragment.
        const buffers = (request.buffers as Parameters<typeof bufferOf>[0][]).map(bufferOf);
        const selects = header.operations.filter(
          (op): op is Extract<UpdateOperation, { op: "select" }> => op.op === "select",
        );
        // The realm restored the stream's snapshot before its updates.
        let page = pageSnapshot(newPage("page"), {
          stream: c.stream,
          epoch: c.epoch,
          channels: [],
        }).page;
        const write = (select: (typeof selects)[number]) => {
          const key = {
            namespace: select.namespace,
            data: select.data,
            generation: select.generation,
            channel: select.channel,
          };
          const { selection } = select;
          const value: ChannelValue =
            selection?.kind === "rows"
              ? { kind: "rows", ordinals: buffers[selection.ordinals.buffer] as Float64Array }
              : selection;
          const result = pageWrite(
            page,
            key,
            { stream: c.stream, epoch: c.epoch, ...select.write },
            value,
          );
          page = result.page;
          return result.outcome;
        };
        expect(selects.map(write)).toEqual(request.read.outcomes);
        expect(write(selects[0]!)).toBe(request.read.delayed);
        // Its mutations staged on the copy, each table's rows counted from its columns.
        const mutations = header.operations.flatMap((op): Mutation[] => {
          if (op.op === "options" || op.op === "rule" || op.op === "select") return [];
          const count = (Object.values(op.columns)[0] as readonly unknown[]).length;
          if (op.op === "append")
            return [{ op: "append", first: op.first, count, revision: op.revision }];
          if (op.op === "replace")
            return [{ op: "replace", start: op.start, count, revision: op.revision }];
          return [{ op: "reset", generation: op.generation, count, revision: op.revision }];
        });
        expectCopy(stage(copyOf(request.read.copy), mutations), request.read.then);
      }
      if (c.alone) {
        // One revision past the limits, which the stream sends as a snapshot instead.
        const [revision] = c.alone.revisions;
        const header = headerOf(c, {
          revision: revision.number,
          baseRevision: 0,
          ...(revision.rules ? { rules: revision.rules } : { bytes: [revision.bytes] }),
        });
        expect(() => checkUpdateCounts(header)).toThrow(/more than an update's/);
      }
    });
});
