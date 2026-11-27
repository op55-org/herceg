// What changed in a membership (memberships.ts) since a reader's cursor:
// part of the lineage reader, so highlighting without lineage carries none
// of it. A membership tells its history each transition; the history keeps
// the positions that left and joined, found in the pass that writes the new
// bytes, and gives a reader that lags the ones it missed merged.

import type { Membership, Transition, TransitionLog } from "./memberships.ts";

/** Where a consumer last read a membership: the state it reflects. */
export interface MembershipCursor {
  /** The membership read, so a cursor of another one never matches. */
  readonly membership: Membership;
  readonly generation: number;
  /** The table version its positions are of. */
  readonly version: number;
  /** Counts the membership's states: every change of its rows or of which are selected. */
  readonly revision: number;
  /** The table's `rowOffset` and `length` then: positions are slots less `rowOffset`. */
  readonly rowOffset: number;
  readonly length: number;
}

/**
 * What changed since a cursor. A delta spans table versions between which
 * the table only appended, dropped from the front, and changed values in
 * place, so positions moved by the front drop alone; anything else
 * (insertions, a reset, history that ran out) is "rebuild". Arrays are
 * borrowed: never write them.
 */
export type MembershipChanges =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "delta";
      readonly from: MembershipCursor;
      readonly to: MembershipCursor;
      /** Rows that went from the front: `from`'s first `dropped` rows. */
      readonly dropped: number;
      /** Positions in `from`'s layout of rows selected then and not now, the dropped selected rows among them; ascending. */
      readonly left: Uint32Array;
      /** Positions in `to`'s layout of rows selected now and not then, appended rows among them; ascending. */
      readonly joined: Uint32Array;
      /** Positions in `to`'s layout, among rows that were there at `from`, whose values of `fields` changed in place. */
      readonly updated: { readonly start: number; readonly end: number } | null;
      /** Fields changed in place, of rows still there or since dropped. */
      readonly fields: readonly string[];
      /**
       * Some dropped rows changed in place before they went: what a reader
       * kept of them is older than what their producer remembers.
       */
      readonly droppedEdited: boolean;
    }
  | { readonly kind: "rebuild"; readonly cursor: MembershipCursor };

/** One transition, kept for consumers that read later. */
interface Step {
  readonly from: number;
  readonly to: number;
  /** Positions do not carry across it, or it changed too many to list. */
  readonly rebuild: boolean;
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly left: Uint32Array;
  readonly joined: Uint32Array;
  /** Slots whose values changed in place, and the fields. */
  readonly updated: readonly [number, number] | null;
  readonly fields: readonly string[];
}

const UNCHANGED = Object.freeze({ kind: "unchanged" as const });
const NONE = new Uint32Array(0);
/** Transitions kept at most, whatever their sizes. */
const STEPS = 64;

/** Histories by membership: one per membership, shared by its readers. */
const histories = /* @__PURE__ */ new WeakMap<Membership, MembershipHistory>();

/**
 * The history of `membership`'s changes, kept from the first call on, and
 * after holds (`hold`) while one is.
 */
export function historyOf(membership: Membership): MembershipHistory {
  let history = histories.get(membership);
  if (!history) {
    history = new MembershipHistory(membership);
    histories.set(membership, history);
    membership.attach(history);
  }
  return history;
}

/** Bytes `membership`'s history holds, 0 for none. */
export function historyBytes(membership: Membership): number {
  return histories.get(membership)?.byteLength ?? 0;
}

/**
 * A membership's transitions since a reader's cursor, bounded: at most an
 * eighth of the rows' positions (at least 16) and `STEPS` transitions;
 * past that, the oldest go, and readers that lag behind them rebuild.
 */
export class MembershipHistory implements TransitionLog {
  readonly membership: Membership;
  #steps: Step[] = [];
  /** Positions the steps list. */
  #listed = 0;
  #cursor: MembershipCursor | null = null;
  #holds = 0;

  constructor(membership: Membership) {
    this.membership = membership;
  }

  /**
   * Keeps the history until the release returned is called. Once nothing
   * holds it, the membership stops telling it what changed, and what it
   * kept goes: readers of older cursors rebuild.
   */
  hold(): () => void {
    if (this.#holds++ === 0) this.membership.attach(this);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      if (--this.#holds > 0) return;
      this.membership.attach(null);
      this.#steps = [];
      this.#listed = 0;
    };
  }

  /** Bytes of the positions kept. */
  get byteLength(): number {
    return 4 * this.#listed;
  }

  /** Where the membership is now, for `changes`. */
  cursor(): MembershipCursor {
    const membership = this.membership;
    // Read first: the membership catches up, telling its transitions.
    const revision = membership.revision;
    if (this.#cursor?.revision !== revision) {
      const table = membership.table;
      this.#cursor = Object.freeze({
        membership,
        generation: table.generation,
        version: table.version,
        revision,
        rowOffset: table.rowOffset,
        length: table.length,
      });
    }
    return this.#cursor;
  }

  /** What changed since `since`: nothing, the positions that left and joined, or "rebuild". */
  changes(since: MembershipCursor): MembershipChanges {
    const now = this.cursor();
    if (since.membership !== this.membership) return { kind: "rebuild", cursor: now };
    if (since.revision === now.revision) return UNCHANGED;
    const steps = this.#steps;
    let first = steps.length;
    while (first > 0 && steps[first - 1]!.to > since.revision) first--;
    if (first === steps.length || steps[first]!.from !== since.revision)
      return { kind: "rebuild", cursor: now };
    for (let i = first; i < steps.length; i++)
      if (steps[i]!.rebuild) return { kind: "rebuild", cursor: now };
    const dropped = Math.min(now.rowOffset - since.rowOffset, since.length);
    // Updated rows among those there at both, by position now.
    let updated: { start: number; end: number } | null = null;
    const fields = new Set<string>();
    let low = Number.POSITIVE_INFINITY;
    let high = 0;
    for (let i = first; i < steps.length; i++) {
      const step = steps[i]!;
      if (!step.updated) continue;
      low = Math.min(low, step.updated[0]);
      high = Math.max(high, step.updated[1]);
      for (const field of step.fields) fields.add(field);
    }
    const droppedEdited =
      Math.max(low, since.rowOffset) < Math.min(high, since.rowOffset + dropped);
    low = Math.max(low, now.rowOffset);
    high = Math.min(high, since.rowOffset + since.length);
    if (low < high) updated = { start: low - now.rowOffset, end: high - now.rowOffset };
    const delta = (left: Uint32Array, joined: Uint32Array) => ({
      kind: "delta" as const,
      from: since,
      to: now,
      dropped,
      left,
      joined,
      updated,
      fields: [...fields],
      droppedEdited,
    });
    if (first === steps.length - 1) return delta(steps[first]!.left, steps[first]!.joined);
    // Rows by slot: those that left and later joined again, or joined and
    // later left, changed nothing between the two.
    let left: number[] = [];
    let joined: number[] = [];
    for (let i = first; i < steps.length; i++) {
      const step = steps[i]!;
      const out = Array.from(step.left, (p) => p + step.fromOffset);
      const into = Array.from(step.joined, (p) => p + step.toOffset);
      [left, joined] = [
        union(minus(left, into), minus(out, joined)),
        union(minus(joined, out), minus(into, left)),
      ];
    }
    return delta(
      Uint32Array.from(left, (slot) => slot - since.rowOffset),
      Uint32Array.from(joined, (slot) => slot - now.rowOffset),
    );
  }

  hear(t: Transition): void {
    const left: number[] = [];
    const joined: number[] = [];
    const allowance = Math.max(16, t.length >> 3);
    let listed = !t.rebuild;
    if (listed && t.appended) {
      // The kept bytes are as they were: the dropped rows that were selected left, the rows appended that are joined.
      const { before, beforeStart, after, afterStart } = t;
      for (let p = 0; p < t.dropped && before; p++) if (before[beforeStart + p]) left.push(p);
      for (let p = t.kept; p < t.length && after; p++) if (after[afterStart + p]) joined.push(p);
      listed = left.length + joined.length <= allowance;
    } else if (listed) listed = diff(t, left, joined, allowance);
    this.#keep({
      from: t.from,
      to: t.to,
      rebuild: !listed,
      fromOffset: t.fromOffset,
      toOffset: t.toOffset,
      left: listed && left.length > 0 ? Uint32Array.from(left) : NONE,
      joined: listed && joined.length > 0 ? Uint32Array.from(joined) : NONE,
      updated: t.updated,
      fields: t.fields,
    });
  }

  /** Keeps a transition, letting the oldest go past an eighth of the rows' positions (and `STEPS` transitions). */
  #keep(step: Step) {
    const steps = this.#steps;
    steps.push(step);
    this.#listed += step.left.length + step.joined.length;
    const allowance = Math.max(16, this.membership.table.length >> 3);
    while (steps.length > STEPS || (this.#listed > allowance && steps.length > 1)) {
      const gone = steps.shift()!;
      this.#listed -= gone.left.length + gone.joined.length;
    }
  }
}

/**
 * The rows whose bytes differ across a transition: positions before that
 * left (dropped selected ones too), and after that joined. False once they
 * pass `allowance`, listing no more. Rows kept are compared a word of four
 * at a time where both arrays place them alike, as the membership places
 * its new bytes.
 */
function diff(t: Transition, left: number[], joined: number[], allowance: number): boolean {
  const { before, beforeStart: start, dropped, kept, after, afterStart: at, length } = t;
  for (let p = 0; p < dropped && before; p++) {
    if (!before[start + p]) continue;
    if (left.length >= allowance) return false;
    left.push(p);
  }
  const from = start + dropped;
  /** Compares row `p`, listing it where it changed; false past the allowance. */
  const row = (p: number) => {
    const was = p < kept && before ? before[from + p]! : 0;
    const is = after ? after[at + p]! : 0;
    if (was === is) return true;
    if (left.length + joined.length >= allowance) return false;
    if (was) left.push(dropped + p);
    else joined.push(p);
    return true;
  };
  const both = before && after ? Math.min(kept, length) : 0;
  let p = 0;
  const [a0, b0] = [(before?.byteOffset ?? 0) + from, (after?.byteOffset ?? 0) + at];
  if (both >= 16 && (a0 & 3) === (b0 & 3)) {
    for (; (b0 + p) & 3; p++) if (!row(p)) return false;
    const words = (both - p) >> 2;
    const a = new Uint32Array(before!.buffer, a0 + p, words);
    const b = new Uint32Array(after!.buffer, b0 + p, words);
    for (let w = 0; w < words; w++) {
      if (a[w] === b[w]) continue;
      const q = p + 4 * w;
      if (!(row(q) && row(q + 1) && row(q + 2) && row(q + 3))) return false;
    }
    p += 4 * words;
  }
  for (; p < length; p++) if (!row(p)) return false;
  return true;
}

/** `a` without the members of `b`; both ascending. */
function minus(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let j = 0;
  for (const x of a) {
    while (j < b.length && b[j]! < x) j++;
    if (j >= b.length || b[j] !== x) out.push(x);
  }
  return out;
}

/** The members of `a` and `b`, which share none; ascending. */
function union(a: readonly number[], b: readonly number[]): number[] {
  const out: number[] = [];
  let [i, j] = [0, 0];
  while (i < a.length || j < b.length)
    out.push(j >= b.length || (i < a.length && a[i]! < b[j]!) ? a[i++]! : b[j++]!);
  return out;
}
