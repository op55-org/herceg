// Coverage: how much of each target's contributors (data/contributors.ts)
// a store's channel holds, the selected and all of them, and for a count or
// sum of the source's field, what the selected ones measure. It follows the
// channel's membership (memberships.ts) by its changes: rows that left and
// joined, appended and dropped, and values edited in place change the
// counts of the groups they feed, and nothing else is read. A new relation
// revision or target layout, or a membership that cannot say what changed,
// counts every incidence again once.
//
// A row that left is taken from the group it was counted in. One still in
// the table is found there again (its group changes only with the
// relation's revision); one dropped is found in what its producer
// remembered as it dropped it (groups and totals, which follow drops). A
// relation that is no partition, or whose producers cannot say, counts
// again after a drop.

import type { Measure, Removed } from "../data/contributor-records.ts";
import type { ContributorRelation } from "../data/contributors.ts";
import { addCompensated } from "../data/group-levels.ts";
import type { SelectionStore } from "../data/selection.ts";
import type { Schema, Table } from "../data/table.ts";
import { ChartError } from "../spec/errors.ts";
import {
  historyBytes,
  historyOf,
  type MembershipChanges,
  type MembershipCursor,
  type MembershipHistory,
} from "./membership-changes.ts";
import { type Membership, membershipOf } from "./memberships.ts";

export type CoverageState = "none" | "partial" | "all";

/** What a channel holds of one target's contributors, and of its measure where it has one. */
export interface TargetCoverage {
  readonly selected: number;
  readonly total: number;
  /** No contributors is "none". */
  readonly state: CoverageState;
  /** For a count or sum (`Measure`): what the selected contributors measure, and what all do. */
  readonly measure?: { readonly field: string; readonly selected: number; readonly total: number };
}

/** Work coverage did, for tests and benchmarks: incidences read, and counts from scratch. */
export const coverageWork = { incidences: 0, rebuilds: 0 };

/** Coverages by relation, store, channel, and class (null: the targets' rows), while some reader holds them. */
const coverages = /* @__PURE__ */ new WeakMap<
  ContributorRelation,
  WeakMap<SelectionStore, Map<string, Map<string | null, WeakRef<Coverage>>>>
>();
const forgotten = /* @__PURE__ */ new FinalizationRegistry<() => void>((forget) => forget());
/** Releases what a coverage still holds (its relation's links, its membership's history) once it is collected. */
const released = /* @__PURE__ */ new FinalizationRegistry<Held>((held) => {
  for (const release of held.releases ?? []) release();
});

/** What a coverage holds of its relation and history while read: the releases. */
interface Held {
  releases: (() => void)[] | null;
}

/**
 * The coverage of `relation`'s targets by `store`'s `channel`, for the
 * contributors `field` reads (its target's rows when left out): shared by
 * every reader of a field reading the same rows while one holds it.
 */
export function coverageOf<S extends Schema>(
  relation: ContributorRelation,
  field: string | undefined,
  of: SelectionStore<S>,
  channel: string,
): Coverage {
  const store = of as unknown as SelectionStore;
  if ((store.source as unknown) !== relation.source)
    throw new Error("coverageOf: the store is of another table than the relation's source");
  let byStore = coverages.get(relation);
  if (!byStore) {
    byStore = new WeakMap();
    coverages.set(relation, byStore);
  }
  let byChannel = byStore.get(store);
  if (!byChannel) {
    byChannel = new Map();
    byStore.set(store, byChannel);
  }
  let byClass = byChannel.get(channel);
  if (!byClass) {
    byClass = new Map();
    byChannel.set(channel, byClass);
  }
  const key = relation.classOf(field);
  const known = byClass.get(key)?.deref();
  if (known) return known;
  const made = new Coverage(relation, field, membershipOf(store, channel));
  const ref = new WeakRef(made);
  byClass.set(key, ref);
  const classes = byClass;
  const channels = byChannel;
  forgotten.register(made, () => {
    if (classes.get(key) === ref) classes.delete(key);
    // Channel names no coverage reads any more go with their last class.
    if (classes.size === 0 && channels.get(channel) === classes) channels.delete(channel);
  });
  return made;
}

/** Sums of the selected contributors' values, compensated, with negative contributions among all. */
interface Sums {
  /** The source field summed. */
  readonly field: string;
  high: Float64Array;
  low: Float64Array;
  error: Float64Array;
  /** Contributions below zero, of every contributor: a part drawn inside its whole needs none. */
  negatives: Uint32Array;
}

/**
 * What a channel holds of each target's contributors. Reads catch up with
 * the membership and the relation first; between changes they read
 * counts.
 *
 * While read, it holds what its relation and the membership's history
 * build for it (`ContributorRelation.hold`). Readers that keep it hold it
 * (`hold`): with the last release, what it holds goes at once, its counts
 * too, and a later read counts again. A read without a hold holds until the
 * coverage is collected.
 */
export class Coverage {
  readonly relation: ContributorRelation;
  /** The field whose contributors are counted; undefined for the targets' rows. */
  readonly field: string | undefined;
  readonly membership: Membership;
  /** Each target stands for one source row: read straight from the membership, nothing kept. */
  readonly #direct: boolean;
  /** The membership's changes, read where counts are kept. */
  readonly #history: MembershipHistory | null;
  #cursor: MembershipCursor | null = null;
  #revision = Number.NaN;
  #layout = Number.NaN;
  #selected = new Uint32Array(0);
  #total = new Uint32Array(0);
  #sums: Sums | null = null;
  /** The field sums were asked for, made at the next count from scratch. */
  #summing: string | undefined;
  #changes = 0;
  readonly #removed: Removed = { target: -1, value: Number.NaN };
  /** Measures by field: what fields measure is fixed by the steps producing them. */
  readonly #measures = new Map<string, Measure | undefined>();
  /** What it holds of its relation and history, shared with the collection's backstop. */
  readonly #held: Held = { releases: null };
  #holds = 0;
  /** A read without a hold took one, kept until the coverage is collected. */
  #unheld = false;

  constructor(relation: ContributorRelation, field: string | undefined, membership: Membership) {
    this.relation = relation;
    this.field = field;
    this.membership = membership;
    this.#direct = relation.single && relation.classOf(field) === null;
    this.#history = this.#direct ? null : historyOf(membership);
    released.register(this, this.#held);
  }

  /**
   * Holds it for a reader (a chart's binding) until the release returned is
   * called; with the last release, what it built goes at once.
   */
  hold(): () => void {
    this.#holds++;
    this.#take();
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      this.#holds--;
      this.#letGo();
    };
  }

  /** Whether readers hold it (`hold`) or it holds what it built after a read without one. */
  get held(): boolean {
    return this.#held.releases !== null;
  }

  /** Takes what it reads through: its relation's links and its membership's history. */
  #take() {
    if (this.#held.releases) return;
    const releases = [this.relation.hold()];
    if (this.#history) releases.push(this.#history.hold());
    this.#held.releases = releases;
  }

  /** With no reader left, lets what it holds go, and its counts: a later read counts again. */
  #letGo() {
    const held = this.#held;
    if (this.#holds > 0 || this.#unheld || !held.releases) return;
    for (const release of held.releases) release();
    held.releases = null;
    this.#cursor = null;
    this.#selected = new Uint32Array(0);
    this.#total = new Uint32Array(0);
    this.#sums = null;
  }

  /** Moves whenever a count may have changed: readers keep what they draw of them by it. */
  get revision(): number {
    if (this.#direct)
      return this.membership.revision + this.relation.revision + this.relation.layout;
    this.#sync();
    return this.#changes;
  }

  /** Bytes of the counts and sums. */
  get byteLength(): number {
    const sums = this.#sums;
    return (
      this.#selected.byteLength +
      this.#total.byteLength +
      (sums
        ? sums.high.byteLength +
          sums.low.byteLength +
          sums.error.byteLength +
          sums.negatives.byteLength
        : 0)
    );
  }

  /** Coverage groups its counts have room for. */
  get room(): number {
    return this.#selected.length;
  }

  /** Whether it keeps sums, or makes them at its next count from scratch. */
  get sums(): boolean {
    return this.#summing !== undefined;
  }

  /** Selected contributors of `target`. */
  selected(target: number): number {
    this.#sync();
    if (this.#direct) return this.#directly(target, true);
    return this.#selected[this.relation.groupOf(target)] ?? 0;
  }

  /** All contributors of `target`. */
  total(target: number): number {
    this.#sync();
    if (this.#direct) return this.#directly(target, false);
    return this.#total[this.relation.groupOf(target)] ?? 0;
  }

  state(target: number): CoverageState {
    const selected = this.selected(target);
    return selected === 0 ? "none" : selected >= this.total(target) ? "all" : "partial";
  }

  /**
   * The coverage of `target`, with the measure of `field` (one of this
   * coverage's class: see `ContributorRelation.classOf`) where it has one.
   * Fields of a class share one coverage, so a measure is only of the
   * field named.
   */
  of(target: number, field?: string): TargetCoverage {
    const selected = this.selected(target);
    const total = this.total(target);
    const state = selected === 0 ? "none" : selected >= total ? "all" : "partial";
    const measured = field === undefined ? undefined : this.measure(target, field);
    return measured ? { selected, total, state, measure: measured } : { selected, total, state };
  }

  /**
   * What the selected contributors of `target` measure of `field` and what
   * all do, where `field` is a count or sum of the source's field (see
   * `Measure`); undefined otherwise. The whole is the target's value as its
   * table holds it, so every row selected reads it exactly.
   */
  measure(
    target: number,
    field: string,
  ): { readonly field: string; readonly selected: number; readonly total: number } | undefined {
    // The producer caught up first, so what the field measures is of the
    // rows there; sums asked for before counts are made, so they are made once.
    const relation = this.relation;
    if (relation.revision !== this.#revision || relation.layout !== this.#layout)
      this.#measures.clear();
    let measure = this.#measures.get(field);
    if (!this.#measures.has(field)) {
      measure = relation.measureOf(field);
      this.#measures.set(field, measure);
    }
    if (measure?.op === "sum" && this.#summing !== measure.field) {
      this.#summing = measure.field;
      this.#revision = Number.NaN;
    }
    // Caught up: the target's value is read as of the rows counted.
    this.#sync();
    if (!measure) return undefined;
    const table = relation.target;
    const whole = table.has(field)
      ? (table.numbers(field as never)[target] ?? Number.NaN)
      : Number.NaN;
    if (measure.op === "count") return { field, selected: this.selected(target), total: whole };
    const group = this.relation.groupOf(target);
    const selected = this.selected(target);
    if (selected === 0) return { field, selected: 0, total: whole };
    const sums = this.#sums!;
    return {
      field,
      selected: selected >= this.total(target) ? whole : sums.high[group]! + sums.low[group]!,
      total: whole,
    };
  }

  /** Contributions below zero among `target`'s contributors, for its measured field; 0 without sums. */
  negatives(target: number): number {
    this.#sync();
    return this.#sums?.negatives[this.relation.groupOf(target)] ?? 0;
  }

  /** Of a target standing for one source row: whether it is selected (`selected`), or there (else). */
  #directly(target: number, selected: boolean): number {
    let found = 0;
    const bytes = selected ? this.membership.selected : null;
    this.relation.contributors(target, (position) => {
      found = bytes ? bytes[position]! : 1;
    });
    return found;
  }

  /** Catches up with the relation and the membership. */
  #sync() {
    // Read without a hold: held from now on until collected.
    if (!this.#held.releases) {
      this.#unheld = this.#holds === 0;
      this.#take();
    }
    if (this.#direct) {
      void this.relation.revision;
      return;
    }
    const relation = this.relation;
    const revision = relation.revision;
    const layout = relation.layout;
    const cursor = this.#cursor;
    if (!cursor || revision !== this.#revision || layout !== this.#layout) {
      this.#rebuild();
      return;
    }
    const changes = this.#history!.changes(cursor);
    if (changes.kind === "unchanged") return;
    if (changes.kind === "rebuild" || !this.#follow(changes)) {
      this.#rebuild();
      return;
    }
    this.#cursor = changes.to;
    this.#changes++;
  }

  /** Counts every incidence again. */
  #rebuild() {
    // What fields measure can change with the relation (groups stopped at a limit measure nothing).
    this.#measures.clear();
    const relation = this.relation;
    const field = this.field;
    // Rows dropped from now on are remembered for the counts to take away.
    const source = relation.source;
    if (relation.partition && dropping(source)) relation.retain();
    const groups = relation.groups;
    const selected = new Uint32Array(groups);
    const total = new Uint32Array(groups);
    const summing = this.#summing;
    const sums: Sums | null =
      summing === undefined
        ? null
        : {
            field: summing,
            high: new Float64Array(groups),
            low: new Float64Array(groups),
            error: new Float64Array(groups),
            negatives: new Uint32Array(groups),
          };
    const values = sums ? source.numbers(sums.field as never) : null;
    const bytes = this.membership.selected;
    let read = 0;
    relation.incidences((position, group) => {
      read++;
      total[group]!++;
      if (sums && values![position]! < 0) sums.negatives[group]!++;
      if (!bytes[position]) return;
      selected[group]!++;
      if (sums) addCompensated(sums.high, sums.low, sums.error, group, values![position]!);
    }, field);
    coverageWork.incidences += read;
    coverageWork.rebuilds++;
    this.#selected = selected;
    this.#total = total;
    this.#sums = sums;
    this.#cursor = this.#history!.cursor();
    this.#revision = relation.revision;
    this.#layout = relation.layout;
    this.#changes++;
  }

  /**
   * Applies a membership's delta; false where it cannot, and the counts
   * are made again.
   */
  #follow(delta: Extract<MembershipChanges, { kind: "delta" }>): boolean {
    const relation = this.relation;
    const field = this.field;
    const { from, to, dropped, left, joined, updated } = delta;
    const partition = relation.partition;
    // Rows dropped are taken away by what their producers remembered.
    if (dropped > 0 && !partition) return false;
    const operand = relation.operandOf(field);
    const reads = (fields: readonly string[]) =>
      fields.includes(operand!) || (this.#sums !== null && fields.includes(this.#sums.field));
    // What they remember of rows edited before they went is not what was counted.
    if (delta.droppedEdited && reads(delta.fields)) return false;
    const source = relation.source;
    // Groups appended since (a new key) start at zero.
    if (relation.groups > this.#selected.length) this.#grow(relation.groups);
    const selected = this.#selected;
    const total = this.#total;
    const sums = this.#sums;
    const values = sums ? source.numbers(sums.field as never) : null;
    const out = this.#removed;
    let read = 0;
    for (let slot = from.rowOffset; slot < from.rowOffset + dropped; slot++) {
      if (!relation.removed(slot, field, out)) return false;
      read++;
      if (out.target < 0) continue;
      total[out.target]!--;
      if (sums && out.value < 0) sums.negatives[out.target]!--;
    }
    const kept = from.length - dropped;
    /** Groups whose sums changed, to check their accuracy. */
    const summed = new Set<number>();
    /** Changes a group's selected count and sum by a row of value `value`. */
    const pick = (group: number, sign: 1 | -1, value: number) => {
      read++;
      selected[group]! += sign;
      if (!sums) return;
      addCompensated(sums.high, sums.low, sums.error, group, sign * value);
      summed.add(group);
    };
    for (let i = 0; i < left.length; i++) {
      const at = left[i]!;
      if (at < dropped) {
        if (!relation.removed(from.rowOffset + at, field, out)) return false;
        if (out.target >= 0) pick(out.target, -1, out.value);
        continue;
      }
      const position = at - dropped;
      const value = values ? values[position]! : 0;
      if (partition) {
        const group = relation.groupAt(position, field);
        if (group >= 0) pick(group, -1, value);
      } else
        relation.targetsOf(position, (target) => pick(relation.groupOf(target), -1, value), field);
    }
    // Rows appended join the totals, whether selected or not.
    for (let position = kept; position < to.length; position++) {
      const add = (group: number) => {
        read++;
        total[group]!++;
        if (sums && values![position]! < 0) sums.negatives[group]!++;
      };
      if (partition) {
        const group = relation.groupAt(position, field);
        if (group >= 0) add(group);
      } else relation.targetsOf(position, (target) => add(relation.groupOf(target)), field);
    }
    for (let i = 0; i < joined.length; i++) {
      const position = joined[i]!;
      const value = values ? values[position]! : 0;
      if (partition) {
        const group = relation.groupAt(position, field);
        if (group >= 0) pick(group, 1, value);
      } else
        relation.targetsOf(position, (target) => pick(relation.groupOf(target), 1, value), field);
    }
    coverageWork.incidences += read;
    // Values edited in place: their groups, wherever they belong now, are counted again.
    if (updated && reads(delta.fields)) {
      const dirty = new Set<number>();
      for (let position = updated.start; position < updated.end; position++) {
        if (partition) {
          const group = relation.groupAt(position);
          if (group >= 0) dirty.add(group);
        } else relation.targetsOf(position, (target) => dirty.add(relation.groupOf(target)));
      }
      for (const group of dirty) this.#recount(group);
    }
    // Sums that lost their accuracy, values cancelling, are summed again.
    for (const group of summed) this.#settle(group);
    return true;
  }

  /** Counts a group again from its contributors (its first target's, which every target of it shares). */
  #recount(group: number) {
    const relation = this.relation;
    const bytes = this.membership.selected;
    const sums = this.#sums;
    const values = sums ? relation.source.numbers(sums.field as never) : null;
    let [selected, total] = [0, 0];
    if (sums) sums.high[group] = sums.low[group] = sums.error[group] = sums.negatives[group] = 0;
    relation.contributors(
      relation.representative(group),
      (position) => {
        total++;
        if (sums && values![position]! < 0) sums.negatives[group]!++;
        if (!bytes[position]) return;
        selected++;
        if (sums) addCompensated(sums.high, sums.low, sums.error, group, values![position]!);
      },
      this.field,
    );
    coverageWork.incidences += total;
    this.#selected[group] = selected;
    this.#total[group] = total;
  }

  /** Room for `groups` coverage groups, the counts kept and new groups at zero. */
  #grow(groups: number) {
    const room = Math.max(groups, this.#selected.length + (this.#selected.length >> 1));
    const grown = <T extends Uint32Array | Float64Array>(array: T): T => {
      const next = new (array.constructor as new (length: number) => T)(room);
      next.set(array);
      return next;
    };
    this.#selected = grown(this.#selected);
    this.#total = grown(this.#total);
    const sums = this.#sums;
    if (sums) {
      sums.high = grown(sums.high);
      sums.low = grown(sums.low);
      sums.error = grown(sums.error);
      sums.negatives = grown(sums.negatives);
    }
  }

  /** Sums a group's selected values again where its compensated sum may be off by more than an ulp. */
  #settle(group: number) {
    const sums = this.#sums!;
    const sum = sums.high[group]! + sums.low[group]!;
    const error = sums.error[group]!;
    if (error === 0 || error <= 2 ** -52 * Math.abs(sum)) return;
    this.#recount(group);
  }
}

/** Whether a table drops rows from its front: it keeps at most `maxRows`, or has dropped some. */
function dropping(table: Table): boolean {
  return table.maxRows !== Number.POSITIVE_INFINITY || table.rowOffset > 0;
}

/** Bytes lineage keeps for a binding, as `lineageCost` counts them. */
export interface LineageCost {
  /** Every byte the binding's lineage takes, built or not: what a budget admits. */
  readonly required: number;
  /** Of those, the bytes not built yet. */
  readonly additional: number;
  /** Bytes producers keep anyway (groups' own arrays), reported beside the budget. */
  readonly owned: number;
  /** Of `required`, the membership's and its history's, which every relation of one channel shares. */
  readonly membership: number;
}

/** A binding's budget by default: bytes per row of the bound table. */
export const BUDGET_PER_ROW = 16;

/** The least a binding's budget is by default, which what any index keeps at least (64 B) fits. */
export const BUDGET_FLOOR = 64 * 1024;

/**
 * The bytes lineage keeps for highlighting `fields` of `relation`'s
 * targets by `store`'s `channel`, counted before anything is made: the
 * membership with its transitions, the relation's links (a derivation's
 * trace and inverses), what producers remember of dropped rows, and each
 * class of fields' counts per target and sums per measured field. What is
 * built already counts as it is; what is not, as estimated. Shared parts
 * count once however many fields share them.
 */
export function lineageCost<S extends Schema>(
  relation: ContributorRelation,
  fields: readonly (string | undefined)[],
  of: SelectionStore<S>,
  channel: string,
): LineageCost {
  const store = of as unknown as SelectionStore;
  const source = relation.source;
  const membership = membershipOf(store, channel);
  // Of the rows there now: the relation and the membership catch up first
  // (a source listener may ask before the producers heard of a change).
  void relation.revision;
  void membership.revision;
  const rows = source.length;
  const history = historyBytes(membership);
  // Each part as it is where it is larger: the bytes, with a quarter more
  // room, and transitions up to an eighth of the rows.
  // Bytes past their room move, at the next read, to an array for twice the rows.
  const grown = membership.byteLength > 0 && rows > membership.room ? Math.max(64, 2 * rows) : 0;
  const membershipBytes =
    Math.max(membership.byteLength, grown, Math.max(64, rows + (rows >> 2))) +
    Math.max(history, 4 * Math.max(16, rows >> 3));
  const linkBytes = relation.estimate();
  let built = membership.byteLength + history + relation.byteLength;
  let counts = 0;
  const classes = new Map<string | null, boolean>();
  for (const field of fields) {
    const key = relation.classOf(field);
    const measure = field === undefined ? undefined : relation.measureOf(field);
    classes.set(key, (classes.get(key) ?? false) || measure?.op === "sum");
  }
  const groups = relation.groups;
  const made = coverages.get(relation)?.get(store)?.get(channel);
  for (const [key, summed] of classes) {
    const coverage = made?.get(key)?.deref();
    const held = coverage?.byteLength ?? 0;
    // A coverage of the class others made keeps the sums it was asked for.
    const sums = summed || coverage?.sums === true;
    // Groups past the counts' room move them, at the next read, to half again as many.
    const room = coverage?.room ?? 0;
    const slots = room > 0 && groups > room ? Math.max(groups, room + (room >> 1)) : groups;
    const bytes = relation.single && key === null ? 0 : slots * (8 + (sums ? 28 : 0));
    counts += Math.max(bytes, held);
    built += held;
  }
  const required = membershipBytes + linkBytes + counts;
  return {
    required,
    additional: Math.max(0, required - built),
    owned: relation.owned,
    membership: membershipBytes,
  };
}

/** MiB, to a tenth, as budgets are told. */
function mebibytes(bytes: number): string {
  return `${(bytes / 2 ** 20).toFixed(1)} MiB`;
}

/**
 * The refusal of a binding whose lineage needs more than its budget (bytes;
 * `BUDGET_PER_ROW` a row of the bound table by default, at least
 * `BUDGET_FLOOR`), or null within it.
 * `target` and `source` name the tables as messages do, quoted when named;
 * `at` is the binding's path, and `fixed` says no option gives it another
 * budget (a grid's). A refusal of growth after the chart was made is met in
 * `phase` "render".
 */
export function budgetRefusal(
  cost: Pick<LineageCost, "required">,
  budget: number | undefined,
  names: { target: string; source: string; rows: number; at?: string; fixed?: boolean },
  phase?: "render",
): ChartError | null {
  const allowed = budget ?? Math.max(BUDGET_FLOOR, BUDGET_PER_ROW * names.rows);
  if (cost.required <= allowed) return null;
  const { target, source, fixed, at = "rowSelection" } = names;
  const why = budget === undefined ? `${BUDGET_PER_ROW} bytes a row of ${source}` : "its budget";
  return new ChartError({
    code: "unsupported",
    path: fixed ? at : `${at}.budget`,
    message: `${fixed ? at : `${at} budget`}: highlighting ${target} through ${source} needs ${mebibytes(cost.required)} of indexes, past ${mebibytes(allowed)} (${why}); ${fixed ? "" : "give a larger budget, or "}bind a store of ${target}`,
    ...(phase && { phase }),
  });
}
