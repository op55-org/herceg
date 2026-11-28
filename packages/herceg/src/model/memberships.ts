// Which rows of a table a store's channel holds, a byte per row, and the
// selection a chart's bound channels hold of each table (see
// row-selection.ts): what highlighting draws a store's selection by, and
// what coverage (coverage.ts) follows through lineage.
//
// A membership is kept per store and channel. Its bytes grow in place past
// their end as rows arrive, so appends test only the new rows; a change of
// rows already there (a new selection, an edit of a field a condition
// reads) writes a new array, leaving the one readers hold as it was. Once a
// consumer asks for changes, the membership tells each transition to its
// history (membership-changes.ts, part of the lineage reader), which keeps
// the positions that left and joined, so consumers that keep counts take
// only what changed.

import { compileExpression, type Expression } from "../data/expression.ts";
import { fieldsOf } from "../data/row-view.ts";
import type { DataSelection, SelectionStore } from "../data/selection.ts";
import type { Schema, Table, TableChange } from "../data/table.ts";
import type { Mark } from "../marks/mark.ts";
import type { Chosen } from "./highlight.ts";

/** A store channel whose selection a chart highlights, for the marks over its table. */
export interface HighlightedChannel {
  table: Table;
  store: SelectionStore;
  channel: string;
}

/**
 * The selection `table`'s channel holds among `channels`; undefined for
 * none, or rows of a table since reset.
 */
export function channelSelection(
  channels: readonly HighlightedChannel[],
  table: Table,
): DataSelection | undefined {
  const channel = channels.find((c) => c.table === table);
  const selection = channel?.store.get(channel.channel);
  if (!selection || (selection.kind === "rows" && !selection.rows.current)) return undefined;
  return selection;
}

/**
 * What each mark's series hold of its table's channel's selection, for
 * `Highlighter`: the same rows in every series; undefined for marks of
 * tables whose channels hold none.
 */
export function channelsChosen(
  channels: readonly HighlightedChannel[],
): (mark: Mark) => Chosen | undefined {
  // Held while the highlighter is, so the bytes follow appends in place.
  const held = channels.map(({ store, channel }) => membershipOf(store, channel));
  return (mark) => {
    const table = mark.table;
    const selection = table && channelSelection(channels, table);
    if (!selection) return undefined;
    const membership = held[channels.findIndex((c) => c.table === table)]!;
    const chosen = {
      selected: membership.selected,
      key: selection,
      version: selection.kind === "rows" ? selection.rows.version : -1,
      membership,
    };
    return () => chosen;
  };
}

/**
 * A membership's transition as it catches up, for its change log
 * (membership-changes.ts): its revisions, the table's `rowOffset` before
 * and after, and the bytes before (row `p` at `beforeStart + p`, the first
 * `dropped` gone, `kept` after them) and after (at `afterStart + p`, of
 * `length`); null bytes hold no row.
 */
export interface Transition {
  readonly from: number;
  readonly to: number;
  /** Positions do not carry across it: insertions, a reset, a change unheard. */
  readonly rebuild: boolean;
  /** Rows only arrived or left: the bytes kept are as they were. */
  readonly appended: boolean;
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly dropped: number;
  readonly kept: number;
  readonly length: number;
  readonly before: Uint8Array | null;
  readonly beforeStart: number;
  readonly after: Uint8Array | null;
  readonly afterStart: number;
  /** Slots whose values changed in place, and the fields. */
  readonly updated: readonly [number, number] | null;
  readonly fields: readonly string[];
}

/** What a membership tells of its transitions: membership-changes.ts's history. */
export interface TransitionLog {
  hear(transition: Transition): void;
}

/** Memberships by store and channel, while some consumer holds them. */
const memberships = /* @__PURE__ */ new WeakMap<SelectionStore, Map<string, WeakRef<Membership>>>();
const forgotten = /* @__PURE__ */ new FinalizationRegistry<() => void>((forget) => forget());

/**
 * The membership of `store`'s table in `channel`: shared by every reader
 * of the same store and channel while one holds it.
 */
export function membershipOf<S extends Schema>(of: SelectionStore<S>, channel: string): Membership {
  const store = of as unknown as SelectionStore;
  let byChannel = memberships.get(store);
  if (!byChannel) {
    byChannel = new Map();
    memberships.set(store, byChannel);
  }
  const known = byChannel.get(channel)?.deref();
  if (known) return known;
  const made = new Membership(store, channel);
  const ref = new WeakRef(made);
  byChannel.set(channel, ref);
  // A store can see many channel names: those no one holds are let go.
  const channels = byChannel;
  forgotten.register(made, () => {
    if (channels.get(channel) === ref) channels.delete(channel);
  });
  return made;
}

/**
 * Which rows of a store's table its channel holds, 1 or 0 by position, as
 * of the table's version and the channel's selection, with their count and
 * the changes since a consumer's cursor (see `changes`).
 */
export class Membership {
  readonly store: SelectionStore;
  readonly channel: string;
  readonly table: Table;
  /** The bytes, row `p` at `#start + p`; null while none is selected (no selection, or rows since reset). */
  #buffer: Uint8Array | null = null;
  #start = 0;
  #view: Uint8Array | null = null;
  /** Rows selected; -1 until counted again. */
  #count = 0;
  /** The selection the bytes are of: frozen, so identity says it is the same. */
  #held: DataSelection | null = null;
  #revision = 0;
  /** The table as the bytes are of it. */
  #version: number;
  #generation: number;
  #rowOffset: number;
  #length: number;
  #modified: number;
  /** Changes of the table heard since, by its listener. */
  #heard = 0;
  /** The table version the changes heard reach: one heard out of turn says positions moved under it. */
  #heardTo = -1;
  #rebuild = false;
  #updated: [number, number] | null = null;
  #fields = new Set<string>();
  /** Told of each transition, once a reader asked for changes (membership-changes.ts). */
  #log: TransitionLog | null = null;

  constructor(store: SelectionStore, channel: string) {
    this.store = store;
    this.channel = channel;
    const table = store.source as unknown as Table;
    this.table = table;
    this.#version = -1;
    this.#generation = table.generation;
    this.#rowOffset = table.rowOffset;
    this.#length = 0;
    this.#modified = table.modifiedVersion;
    const ref = new WeakRef(this);
    const stop = table.subscribe((change) => {
      const membership = ref.deref();
      if (membership) membership.#hear(change);
      else stop();
    });
    forgotten.register(this, stop);
  }

  /** The bytes, by position of the table's rows now; a new array whenever the table or the selection changed. */
  get selected(): Uint8Array {
    this.#sync();
    if (!this.#view) {
      const length = this.#length;
      this.#view = this.#buffer
        ? this.#buffer.subarray(this.#start, this.#start + length)
        : new Uint8Array(length);
    }
    return this.#view;
  }

  /** Rows selected now. */
  get count(): number {
    this.#sync();
    if (this.#count < 0) {
      const bytes = this.selected;
      let count = 0;
      for (let i = 0; i < bytes.length; i++) count += bytes[i]!;
      this.#count = count;
    }
    return this.#count;
  }

  /** Whether the channel holds a selection of the table's rows now (one holding none of them included). */
  get held(): boolean {
    this.#sync();
    return this.#held !== null;
  }

  /** Counts states: it moves whenever the table's rows or the selected ones changed. */
  get revision(): number {
    this.#sync();
    return this.#revision;
  }

  /** Rows the array has room for before rows appended move it to a larger one. */
  get room(): number {
    return this.#buffer ? this.#buffer.length - this.#start : 0;
  }

  /** Bytes of the array held: the bytes with their room. */
  get byteLength(): number {
    return this.#buffer?.byteLength ?? 0;
  }

  /** Tells `log` of every transition from now on, or none (null): membership-changes.ts's, one per membership. */
  attach(log: TransitionLog | null): void {
    this.#log = log;
  }

  /** A change of the table, heard as it happens. */
  #hear(change: TableChange) {
    const table = this.table;
    // A read inside an earlier listener caught up with it already.
    if (table.version <= this.#version) return;
    this.#heard++;
    // A change made inside an earlier listener arrives out of turn: positions told after it are of another layout.
    if (table.version !== this.#heardTo + 1) this.#rebuild = true;
    this.#heardTo = table.version;
    if (change.reset || change.inserted) this.#rebuild = true;
    if (change.updated) {
      const from = table.rowOffset + change.updated.start;
      const to = table.rowOffset + change.updated.end;
      this.#updated = this.#updated
        ? [Math.min(this.#updated[0], from), Math.max(this.#updated[1], to)]
        : [from, to];
      for (const field of change.fields) this.#fields.add(field);
    }
  }

  /** Catches up with the table and the channel. */
  #sync() {
    const table = this.table;
    const current = this.store.get(this.channel);
    const selection =
      current && !(current.kind === "rows" && !current.rows.current) ? current : null;
    if (selection === this.#held && table.version === this.#version) return;
    // Changes made before a read caught up, which no listener call described.
    const unheard = table.version - this.#version > this.#heard;
    const rebuild =
      this.#version < 0 ||
      this.#rebuild ||
      table.generation !== this.#generation ||
      (unheard && table.modifiedVersion !== this.#modified);
    const updated = rebuild ? null : this.#updated;
    const fields = [...this.#fields];
    this.#heard = 0;
    this.#rebuild = false;
    this.#updated = null;
    this.#fields.clear();
    const before = {
      buffer: this.#buffer,
      start: this.#start,
      rowOffset: this.#rowOffset,
      length: this.#length,
    };
    const length = table.length;
    const dropped = rebuild ? 0 : Math.min(table.rowOffset - before.rowOffset, before.length);
    const kept = before.length - dropped;
    // Updates of fields the condition reads change which rows it holds.
    const reads =
      selection?.kind === "predicate" &&
      updated !== null &&
      fieldsOf(selection.expression).some((field) => fields.includes(field));
    const rewrite = rebuild || selection !== this.#held || reads;
    if (rewrite) {
      // Rows already there may change: a new array, left to readers of the old one.
      // Rows at the same place in a word of both arrays compare four at a time.
      const at = before.buffer ? (before.start + dropped) & 3 : 0;
      const buffer = selection ? new Uint8Array(roomFor(length) + at) : null;
      if (buffer) {
        if (rebuild || selection !== this.#held) evaluate(selection!, table, 0, length, buffer, at);
        else {
          // Only the updated rows and those appended are tested again.
          if (before.buffer)
            buffer.set(
              before.buffer.subarray(before.start + dropped, before.start + before.length),
              at,
            );
          const from = Math.max(0, updated![0] - table.rowOffset);
          const to = Math.min(kept, updated![1] - table.rowOffset);
          if (from < to) evaluate(selection!, table, from, to, buffer, at);
          if (kept < length) evaluate(selection!, table, kept, length, buffer, at);
        }
      }
      this.#buffer = buffer;
      this.#start = at;
      this.#count = -1;
    } else if (selection) {
      // Rows only arrived or left: what they were is kept, and the new rows tested.
      let buffer = this.#buffer!;
      let start = this.#start + dropped;
      if (this.#count > 0)
        for (let p = 0; p < dropped; p++) if (buffer[this.#start + p]) this.#count--;
      if (start + length > buffer.length) {
        // Past the room: a new array, twice the rows, the kept bytes copied once.
        const grown = new Uint8Array(Math.max(64, 2 * length));
        grown.set(buffer.subarray(start, start + kept));
        buffer = grown;
        start = 0;
      }
      if (kept < length) {
        const added = buffer.subarray(start + kept, start + length);
        // Rows appended since a set was made are never in it.
        if (selection.kind === "rows") added.fill(0);
        else evaluate(selection, table, kept, length, buffer, start);
        if (this.#count >= 0) for (let i = 0; i < added.length; i++) this.#count += added[i]!;
      }
      this.#buffer = buffer;
      this.#start = start;
    } else {
      // Nothing selected before or now.
      this.#buffer = null;
      this.#count = 0;
    }
    this.#held = selection;
    this.#view = null;
    const from = this.#revision++;
    this.#version = table.version;
    this.#heardTo = table.version;
    this.#generation = table.generation;
    this.#rowOffset = table.rowOffset;
    this.#length = length;
    this.#modified = table.modifiedVersion;
    this.#log?.hear({
      from,
      to: this.#revision,
      rebuild,
      appended: !rewrite,
      fromOffset: before.rowOffset,
      toOffset: table.rowOffset,
      dropped,
      kept,
      length,
      before: before.buffer,
      beforeStart: before.start,
      after: this.#buffer,
      afterStart: this.#start,
      updated,
      fields: updated ? fields : [],
    });
  }
}

/** Room for `length` rows of a new array: a quarter more, for rows appended. */
function roomFor(length: number): number {
  return Math.max(64, length + (length >> 2));
}

/**
 * Rows `from` to `to` of `table` that `selection` holds, 1 or 0, into
 * `out` from `at + from`.
 */
function evaluate(
  selection: DataSelection,
  table: Table,
  from: number,
  to: number,
  out: Uint8Array,
  at = 0,
): void {
  const target = out.subarray(at + from, at + to);
  if (selection.kind === "rows") {
    target.fill(0);
    for (const position of selection.rows.positions())
      if (position >= from && position < to) target[position - from] = 1;
    return;
  }
  // Compiled first in any case, which checks it against the table.
  const { at: test } = compileExpression(selection.expression, table);
  if (fill(selection.expression, table, from, target)) return;
  target.fill(0);
  for (let row = from; row < to; row++) if (test(row) === true) target[row - from] = 1;
}

/** Comparisons of a number field with a literal, which conditions test a column at a time. */
const FLIP: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=" };

/** How a test's results go into what is there: in place of it, or and-ed or or-ed with it. */
type Into = "set" | "and" | "or";

/** Values from `from`, one for each byte of `out`. */
type Values = ArrayLike<number>;

// The loops over every row, without branches (a branch on scattered values
// mispredicts every other row), each a function of its own: in one
// function, optimized before some loop had run, that loop would run
// unoptimized from then on.

/** Whether each value lies in [lo, hi], into `out` as `Into` says. */
const BETWEEN: Record<
  Into,
  (v: Values, lo: number, hi: number, from: number, out: Uint8Array) => void
> = {
  set: (v, lo, hi, from, out) => {
    for (let i = 0, n = out.length; i < n; i++)
      out[i] = +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
  },
  and: (v, lo, hi, from, out) => {
    for (let i = 0, n = out.length; i < n; i++)
      out[i]! &= +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
  },
  or: (v, lo, hi, from, out) => {
    for (let i = 0, n = out.length; i < n; i++)
      out[i]! |= +(v[from + i]! >= lo) & +(v[from + i]! <= hi);
  },
};

/** Whether each value compares with `c` by the test named. */
const COMPARED: Record<string, (v: Values, c: number, from: number, out: Uint8Array) => void> = {
  "==": (v, c, from, out) => {
    for (let i = 0, n = out.length; i < n; i++) out[i] = +(v[from + i] === c);
  },
  "!=": (v, c, from, out) => {
    for (let i = 0, n = out.length; i < n; i++) out[i] = +(v[from + i] !== c);
  },
  "<": (v, c, from, out) => {
    for (let i = 0, n = out.length; i < n; i++) out[i] = +(v[from + i]! < c);
  },
  "<=": (v, c, from, out) => {
    for (let i = 0, n = out.length; i < n; i++) out[i] = +(v[from + i]! <= c);
  },
  ">": (v, c, from, out) => {
    for (let i = 0, n = out.length; i < n; i++) out[i] = +(v[from + i]! > c);
  },
  ">=": (v, c, from, out) => {
    for (let i = 0, n = out.length; i < n; i++) out[i] = +(v[from + i]! >= c);
  },
};

/**
 * Whether each of rows `from` on (as many as `out` holds) meets condition
 * `e`, 1 or 0 into `out`: worked out a column at a time, for the
 * conditions brushes write (number fields compared with numbers, category
 * fields among labels, and conjunctions, disjunctions, and negations of
 * them), about ten times faster than testing row by row. False, with `out`
 * in any state, for any other condition. It gives what the compiled
 * condition gives: a missing value compares false, though unequal.
 */
function fill(
  e: Expression,
  table: Table,
  from: number,
  out: Uint8Array,
  into: Into = "set",
): boolean {
  const n = out.length;
  if (typeof e === "boolean") {
    const bit = e ? 1 : 0;
    if (into === "set" || (into === "and" && !e) || (into === "or" && e)) out.fill(bit);
    return true;
  }
  if (!Array.isArray(e)) return false;
  const [op, ...args] = e as readonly [string, ...Expression[]];
  const name = (arg: Expression | undefined) =>
    Array.isArray(arg) && arg[0] === "field" && typeof arg[1] === "string" ? arg[1] : undefined;
  // A field between two numbers, as brushes write ranges: one pass.
  const range = op === "and" && args.length === 2 && rangeOf(args[0]!, args[1]!, table);
  if (range) {
    const [v, lo, hi] = range;
    BETWEEN[into](v, lo, hi, from, out);
    return true;
  }
  if ((op === "and" || op === "or") && args.length > 0) {
    // Each part goes straight into `out` when it combines as the node does.
    if (into === op || into === "set")
      return args.every((arg, i) => fill(arg, table, from, out, i === 0 ? into : op));
    const own = new Uint8Array(n);
    if (!fill(e, table, from, own)) return false;
    combine(out, own, into);
    return true;
  }
  if (op === "not" && args.length === 1) {
    const own = new Uint8Array(n);
    if (!fill(args[0]!, table, from, own)) return false;
    for (let i = 0; i < n; i++) own[i]! ^= 1;
    combine(out, own, into);
    return true;
  }
  if (Object.hasOwn(COMPARED, op) && args.length === 2) {
    const compared = comparisonOf(op, args[0]!, args[1]!, table);
    if (!compared) return false;
    const [v, test, c] = compared;
    const own = into === "set" ? out : new Uint8Array(n);
    COMPARED[test]!(v, c, from, own);
    if (own !== out) combine(out, own, into);
    return true;
  }
  const field = name(args[0]);
  if (op !== "in" || field === undefined || table.kind(field) !== "category") return false;
  const candidates = args.slice(1);
  if (!candidates.every((v) => typeof v === "string" || v === null)) return false;
  // Whether each category is a candidate, then each row's.
  const { codes, dictionary } = table.categories(field as never);
  const labels = new Set(candidates);
  const member = Uint8Array.from(dictionary, (label) => (labels.has(label) ? 1 : 0));
  const missing = labels.has(null) ? 1 : 0;
  const own = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const code = codes[from + i]!;
    own[i] = code < 0 ? missing : member[code]!;
  }
  combine(out, own, into);
  return true;
}

/**
 * A comparison of a number field with a number, as a test of the field's
 * values with a literal on the right; undefined for other comparisons.
 */
function comparisonOf(
  op: string,
  left: Expression,
  right: Expression,
  table: Table,
): [values: ArrayLike<number>, op: string, literal: number] | undefined {
  // A literal on the left is the same comparison turned around.
  const flipped = typeof left === "number";
  const [arg, c] = flipped ? [right, left] : [left, right];
  const field = Array.isArray(arg) && arg[0] === "field" ? arg[1] : undefined;
  if (typeof field !== "string" || typeof c !== "number" || table.kind(field) === "category")
    return undefined;
  return [table.numbers(field as never), flipped ? (FLIP[op] ?? op) : op, c];
}

/** A field from one number to another, inclusive (`>=` one and `<=` the other); undefined otherwise. */
function rangeOf(
  a: Expression,
  b: Expression,
  table: Table,
): [values: ArrayLike<number>, lo: number, hi: number] | undefined {
  if (!Array.isArray(a) || !Array.isArray(b)) return undefined;
  const first = comparisonOf(a[0] as string, a[1]!, a[2]!, table);
  const second = comparisonOf(b[0] as string, b[1]!, b[2]!, table);
  if (!first || !second || first[0] !== second[0] || a.length !== 3 || b.length !== 3)
    return undefined;
  const low = first[1] === ">=" ? first : second[1] === ">=" ? second : undefined;
  const high = first[1] === "<=" ? first : second[1] === "<=" ? second : undefined;
  return low && high && low !== high ? [first[0], low[2], high[2]] : undefined;
}

/** `own` into `out`, as `into` says. */
function combine(out: Uint8Array, own: Uint8Array, into: Into): void {
  if (into === "set") out.set(own);
  else if (into === "and") for (let i = 0; i < out.length; i++) out[i]! &= own[i]!;
  else for (let i = 0; i < out.length; i++) out[i]! |= own[i]!;
}
