// What a table's rows were computed from, row by row: its contributors,
// the rows of its source each of its rows stands for. Producers register
// what they keep anyway: derived tables (derive.ts) their steps and where
// their rows came from, row groups' levels (groups.ts) their own links,
// totals (totals.ts) their view. The lineage reader, data/contributors.ts
// and the modules it loads (derived-links.ts, totals-links.ts,
// removal-log.ts), makes queries of them, which coverage
// (model/coverage.ts) counts what a selection holds through; producers
// whose contributors no one reads carry none of that code. Conditions on
// fields are lineage.ts's. It imports no code, so the data modules
// registering records share nothing else.

import type { RemovalLog } from "./removal-log.ts";
import type { RowView } from "./row-view.ts";
import type { Table } from "./table.ts";

/**
 * What one of a target's fields is of its contributors, where the
 * selected contributors' part of it can be known: a count of them (of
 * their finite values of `field`, with one) or a sum of `field`. Stated
 * only for a field that is one count or sum step over a field of the
 * ancestor, reached through steps that keep rows one for one. Nested
 * aggregates, rolling windows, calculations after an aggregate, and fields
 * of tables between have none. `weight` is for producers that weigh rows
 * (none yet).
 */
export interface Measure {
  readonly op: "count" | "sum";
  readonly field?: string;
  readonly weight?: string;
}

/**
 * One step from a table's rows (its targets) to the rows of what they were
 * computed from (its rows: a table's positions, or a step's input rows
 * inside a derivation). Fields are named on the target side; `field`
 * undefined asks for the target's rows whatever their values. Producers
 * implement links; data/contributors.ts composes them.
 */
export interface ContributorLink {
  /** Rows of the input side: positions run from 0 to `rows`. */
  readonly rows: number;
  readonly targets: number;
  /**
   * Each target has exactly one contributor, and each row at most one
   * target, for fields of class null (`classOf`): a gather, or a rolling
   * window's rows for their own fields.
   */
  readonly single: boolean;
  /** Each row feeds at most one target, for every field. */
  readonly partition: boolean;
  /** Visits each contributor of `target` once, for `field`'s value. */
  contributors(target: number, visit: (row: number) => void, field?: string): void;
  /** Visits each target `row` contributes to once, for `field`'s value. */
  targetsOf(row: number, visit: (target: number) => void, field?: string): void;
  /** Of a partition: the target `row` contributes to for `field`, or -1. */
  targetAt(row: number, field?: string): number;
  /** How many contributors `target` has for `field`. */
  count(target: number, field?: string): number;
  /**
   * Names the set of contributors `field` reads, so fields with equal sets
   * share their counts: null for the target's rows (keys, counts of rows,
   * calculated values), the field whose finite values are read otherwise.
   */
  classOf(field?: string): string | null;
  /** The input field each contributor stands for in `field`'s value; undefined for the row itself. */
  operandOf(field?: string): string | undefined;
  /** Of a gather: the input field whose value `field` is, row for row; undefined where it is computed. */
  passes(field: string): string | undefined;
  /** What `field` measures of its contributors' input fields, if anything (see `Measure`). */
  measureOf(field: string): Measure | undefined;
  /** Visits every (row, target) pair for `field` once, faster than target by target where given. */
  incidences?(visit: (row: number, target: number) => void, field?: string): void;
  /** Bytes the link holds beyond what its producer keeps anyway. */
  readonly byteLength: number;
  /** Bytes it will hold once read, where it makes some as it is read (composed links' stamps). */
  readonly estimate?: number;
}

/**
 * A dropped row's part, as a producer that follows drops remembered it: the
 * target it fed (-1 for none) and its value of the requested field (NaN
 * without one).
 */
export interface Removed {
  target: number;
  value: number;
}

/** An aggregate a producer's table holds: its field's name, its operation, and the field it reads. */
export interface Aggregated {
  readonly name: string;
  readonly op: string;
  readonly field: string | undefined;
}

/** What every record tells: its tables, and when what they hold changed. */
interface Recorded {
  readonly source: Table;
  readonly target: Table;
  /**
   * Moves whenever a target's contributors may have changed other than by
   * appends and front drops of the source (key or filter edits, insertions,
   * resets, a view's new query): readers rebuild what they keep.
   */
  readonly revision: number;
  /** Moves whenever targets are renumbered, a front drop of the target table's rows included. */
  readonly layout: number;
  /** Bytes its producer keeps anyway, for itself (groups' arrays). */
  readonly owned?: number;
}

/**
 * Of a producer following the source's front drops (groups, totals): the
 * rows it drops, kept in a log a reader gives it.
 */
interface Dropping {
  /** The fields whose values each dropped row keeps, in the log's order. */
  readonly logged: readonly string[];
  /** The log it writes, while a reader holds one. */
  readonly log: RemovalLog | null;
  /**
   * Keeps the rows dropped from now on, in the log `make` makes unless one
   * is kept already, until every release returned is called (every level
   * of row groups shares one log). A producer that stopped keeps none.
   */
  hold(make: () => RemovalLog): () => void;
}

/** Row groups' levels: their links read what only they hold (member runs, slots). */
export interface LinkedRecord extends Recorded, Dropping {
  readonly kind: "links";
  /** The aggregates the groups' tables hold, as their options name them; the other fields are keys. */
  readonly aggregates: readonly Aggregated[];
  /** The links, top first. */
  links(): readonly ContributorLink[];
  /**
   * What the dropped row at `slot` (`rowOffset` plus its position then)
   * fed for `field`, into `out`; false where the log holds it no more, or
   * it was dropped before the log was given.
   */
  removed(slot: number, field: string | undefined, out: Removed): boolean;
}

/** Totals: their one row stands for every row their view shows (totals-links.ts reads it). */
export interface TotalsRecord extends Recorded, Dropping {
  readonly kind: "totals";
  readonly view: RowView;
  readonly aggregates: readonly Aggregated[];
  /** Catches the totals up with their source; false once they stopped. */
  current(): boolean;
}

/** A derived table: derive.ts's `DerivedRecord`, which derived-links.ts reads. */
export interface DerivedEntry extends Recorded {
  readonly kind: "derived";
}

export type ContributorRecord = LinkedRecord | TotalsRecord | DerivedEntry;

/** Tables' contributor records, kept as long as the tables are. */
const records = /* @__PURE__ */ new WeakMap<Table, ContributorRecord>();

/** Records what `record.target`'s rows were computed from. */
export function setContributors(record: ContributorRecord): void {
  records.set(record.target, record);
}

/** What `table`'s rows were computed from, or undefined for a table no producer registered. */
export function contributorsOf(table: Table): ContributorRecord | undefined {
  return records.get(table);
}
