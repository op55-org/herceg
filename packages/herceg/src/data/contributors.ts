// Contributors through chains of tables: a table's rows to the positions
// of a table it was computed from, through every derivation, groups, or
// totals between (lineage.ts records each link). Chains compose lazily: a
// traversal walks each link in turn and nothing is flattened, so a bar of
// 1,000 groups over a million rows holds no list of a million pairs. A
// traversal that can reach a row twice (an aggregate of rolling windows)
// visits each once, by a stamp per row made on first need.

import {
  type ContributorLink,
  type ContributorRecord,
  contributorsOf,
  type Measure,
  type Removed,
} from "./contributor-records.ts";
import type { DerivedRecord } from "./derive.ts";
import { derivedBytes, derivedEstimate, derivedLinks, releaseDerived } from "./derived-links.ts";
import { dropsRows, RemovalLog, removalRoom } from "./removal-log.ts";
import type { Schema, Table } from "./table.ts";
import { totalsLinks, totalsRemoved } from "./totals-links.ts";

/**
 * The rows of `source` (the bound ancestor) behind each row of `target`:
 * a query, its storage the producers'. Targets are `target`'s rows; each is
 * its own coverage group. `field` names a target field where the rows its
 * value reads differ from the target's rows (an aggregate reads its field's
 * finite values); left out, it asks for the target's rows.
 */
export interface ContributorRelation {
  readonly source: Table;
  readonly target: Table;
  /** Moves whenever a target's contributors may have changed other than by the source's appends and front drops. */
  readonly revision: number;
  /** Moves whenever targets are renumbered (a groups' table compacted, a table reset or dropping rows). */
  readonly layout: number;
  readonly targets: number;
  /** Coverage groups: targets with the same contributors share one (packed relations; one each here). */
  readonly groups: number;
  groupOf(target: number): number;
  /** A target of coverage group `group`: every target of a group has the same contributors. */
  representative(group: number): number;
  /** Each source row feeds at most one coverage group. */
  readonly partition: boolean;
  /** Each target stands for exactly one source row, and each row for at most one target, for fields of class null. */
  readonly single: boolean;
  /** Visits each distinct source position behind `target` once. */
  contributors(target: number, visit: (position: number) => void, field?: string): void;
  /** Visits each target a source position feeds, once each. */
  targetsOf(position: number, visit: (target: number) => void, field?: string): void;
  /** Of a partition: the coverage group a source position feeds, or -1. */
  groupAt(position: number, field?: string): number;
  count(target: number, field?: string): number;
  /** Names the contributors `field` reads, so fields reading the same rows share counts (null: the target's rows). */
  classOf(field?: string): string | null;
  /** The source field `field`'s value reads of each contributor, where it reads one through every link. */
  operandOf(field?: string): string | undefined;
  /** What `field` measures of the source's rows (see `Measure`). */
  measureOf(field: string): Measure | undefined;
  /** Visits every (source position, coverage group) pair once. */
  incidences(visit: (position: number, group: number) => void, field?: string): void;
  /**
   * What the source row dropped at `slot` fed, for relations whose one
   * producer follows drops (groups, totals over the source or a view of
   * it): false where it is not known, and the reader rebuilds.
   */
  removed(slot: number, field: string | undefined, out: Removed): boolean;
  /** Asks the producers to remember the rows they drop from now on (see `removed`). */
  retain(): void;
  /** Bytes the links hold beyond what their producers keep, and stamps. */
  readonly byteLength: number;
  /** Bytes they hold once read: each part as built where it is, as estimated where it is not yet. */
  estimate(): number;
  /** Bytes the producers keep anyway (groups' arrays): reported beside a budget. */
  readonly owned: number;
  /**
   * Holds what its readers build (composed links and their stamps,
   * derivations' traces, logs of dropped rows) until the release returned
   * is called. Once nothing holds them, they go, and a later read builds
   * them again.
   */
  hold(): () => void;
}

/** Composed relations by target and ancestor, so that readers of one share what they keep. */
const relations = /* @__PURE__ */ new WeakMap<Table, WeakMap<Table, ContributorRelation | null>>();
/** Relations holding each record, for `ContributorRelation.hold`. */
const holders = /* @__PURE__ */ new WeakMap<ContributorRecord, number>();

/**
 * The contributors of `target`'s rows among `ancestor`'s positions,
 * through every record between; undefined where no chain of records leads
 * there (or `target` is `ancestor`). The same object for the same pair.
 */
export function relationTo<S extends Schema, A extends Schema>(
  of: Table<S>,
  from: Table<A>,
): ContributorRelation | undefined {
  // Read by field name at run time, whatever the schemas.
  const [target, ancestor] = [of as unknown as Table, from as unknown as Table];
  let byAncestor = relations.get(target);
  if (!byAncestor) {
    byAncestor = new WeakMap();
    relations.set(target, byAncestor);
  }
  let known = byAncestor.get(ancestor);
  if (known === undefined) {
    const records: ContributorRecord[] = [];
    for (let at = contributorsOf(target); at; at = contributorsOf(at.source)) {
      records.push(at);
      if (at.source === ancestor) break;
    }
    known = records.at(-1)?.source === ancestor ? new Chain(records) : null;
    byAncestor.set(ancestor, known);
  }
  return known ?? undefined;
}

/** Marks rows once per traversal: a stamp per row, made on first need. */
class Visits {
  #stamps = new Uint32Array(0);
  #epoch = 0;

  get byteLength(): number {
    return this.#stamps.byteLength;
  }

  /** Starts a traversal of rows below `size`. */
  begin(size: number): void {
    if (this.#stamps.length < size) {
      this.#stamps = new Uint32Array(Math.max(size, Math.ceil(this.#stamps.length * 1.5)));
      this.#epoch = 0;
    }
    if (++this.#epoch === 0xffffffff) {
      this.#stamps.fill(0);
      this.#epoch = 1;
    }
  }

  /** Whether `row` is seen for the first time in this traversal. */
  first(row: number): boolean {
    if (this.#stamps[row] === this.#epoch) return false;
    this.#stamps[row] = this.#epoch;
    return true;
  }
}

/**
 * `outer` over `inner`: targets of `outer` to the rows of `inner`'s input
 * side. Where `inner` is no partition and `outer` gathers several of its
 * targets into one for a field (an aggregate, a rolling window's value), a
 * row can be reached twice: stamps keep visits distinct.
 */
function compose(outer: ContributorLink, inner: ContributorLink): ContributorLink {
  let rows: Visits | null = null;
  let targets: Visits | null = null;
  // What each field reads below, and whether it can reach a row twice, asked per row: once per field.
  const operands = new Map<string | undefined, string | undefined>();
  const operandOf = (field: string | undefined) => {
    if (!operands.has(field)) operands.set(field, outer.operandOf(field));
    return operands.get(field);
  };
  const twice = new Map<string | undefined, boolean>();
  const twiceFor = (field: string | undefined) => {
    let again = twice.get(field);
    if (again === undefined) {
      again = !inner.partition && !(outer.single && outer.classOf(field) === null);
      twice.set(field, again);
    }
    return again;
  };
  const link: ContributorLink = {
    get rows() {
      return inner.rows;
    },
    get targets() {
      return outer.targets;
    },
    single: outer.single && inner.single,
    partition: outer.partition && inner.partition,
    contributors(target: number, visit: (row: number) => void, field?: string) {
      const operand = operandOf(field);
      if (!twiceFor(field)) {
        outer.contributors(target, (i) => inner.contributors(i, visit, operand), field);
        return;
      }
      rows ??= new Visits();
      const seen = rows;
      seen.begin(inner.rows);
      const once = (row: number) => {
        if (seen.first(row)) visit(row);
      };
      outer.contributors(target, (i) => inner.contributors(i, once, operand), field);
    },
    targetsOf(row: number, visit: (target: number) => void, field?: string) {
      const operand = operandOf(field);
      if (!twiceFor(field)) {
        inner.targetsOf(row, (i) => outer.targetsOf(i, visit, field), operand);
        return;
      }
      targets ??= new Visits();
      const seen = targets;
      seen.begin(outer.targets);
      const once = (target: number) => {
        if (seen.first(target)) visit(target);
      };
      inner.targetsOf(row, (i) => outer.targetsOf(i, once, field), operand);
    },
    targetAt(row: number, field?: string) {
      const i = inner.targetAt(row, operandOf(field));
      return i < 0 ? -1 : outer.targetAt(i, field);
    },
    count(target: number, field?: string) {
      let count = 0;
      if (inner.partition) {
        const operand = operandOf(field);
        outer.contributors(target, (i) => (count += inner.count(i, operand)), field);
      } else link.contributors(target, () => count++, field);
      return count;
    },
    classOf(field?: string) {
      const own = outer.classOf(field);
      const below = inner.classOf(operandOf(field));
      return own === null && below === null ? null : JSON.stringify([own, below]);
    },
    operandOf(field?: string) {
      const operand = operandOf(field);
      return operand === undefined ? undefined : inner.operandOf(operand);
    },
    passes(field: string) {
      const passed = outer.passes(field);
      return passed === undefined ? undefined : inner.passes(passed);
    },
    measureOf(field: string): Measure | undefined {
      const measure = outer.measureOf(field);
      if (measure) {
        // A count of rows is one of the source's rows only through links keeping rows one for one.
        if (measure.field === undefined) return inner.single ? measure : undefined;
        const passed = inner.passes(measure.field);
        return passed === undefined ? undefined : { ...measure, field: passed };
      }
      const passed = outer.single ? outer.passes(field) : undefined;
      return passed === undefined ? undefined : inner.measureOf(passed);
    },
    incidences(visit: (row: number, target: number) => void, field?: string) {
      if (link.partition && inner.incidences) {
        inner.incidences((row, i) => {
          const target = outer.targetAt(i, field);
          if (target >= 0) visit(row, target);
        }, operandOf(field));
        return;
      }
      const count = outer.targets;
      for (let target = 0; target < count; target++)
        link.contributors(target, (row) => visit(row, target), field);
    },
    get byteLength() {
      return (
        outer.byteLength + inner.byteLength + (rows?.byteLength ?? 0) + (targets?.byteLength ?? 0)
      );
    },
    // Stamps a row and a target each, where rows can be reached twice: as made, or as they will be.
    get estimate() {
      const made = (rows?.byteLength ?? 0) + (targets?.byteLength ?? 0);
      const stamps = Math.max(made, inner.partition ? 0 : 4 * (inner.rows + outer.targets));
      return stamps + (outer.estimate ?? 0) + (inner.estimate ?? 0);
    },
  };
  return link;
}

/**
 * A chain of records (top first) from a target to an ancestor: their links
 * composed, again whenever one of them changed its links.
 */
class Chain implements ContributorRelation {
  readonly #records: readonly ContributorRecord[];
  #link: ContributorLink | null = null;
  #holds = 0;
  /** Releases the log of dropped rows `retain` asked its one producer for. */
  #retained: (() => void) | null = null;

  constructor(records: readonly ContributorRecord[]) {
    this.#records = records;
  }

  get source(): Table {
    return this.#records.at(-1)!.source;
  }

  get target(): Table {
    return this.#records[0]!.target;
  }

  get revision(): number {
    this.#sync();
    // A record below that renumbers its rows changes the positions those above read.
    let revision = 0;
    this.#records.forEach((record, i) => {
      revision += record.revision + (i > 0 ? record.layout : 0);
    });
    return revision;
  }

  get layout(): number {
    this.#sync();
    return this.#records[0]!.layout;
  }

  get targets(): number {
    this.#sync();
    return this.#current().targets;
  }

  get groups(): number {
    return this.targets;
  }

  groupOf(target: number): number {
    return target;
  }

  representative(group: number): number {
    return group;
  }

  get partition(): boolean {
    this.#catchUp();
    return this.#current().partition;
  }

  get single(): boolean {
    this.#catchUp();
    return this.#current().single;
  }

  contributors(target: number, visit: (position: number) => void, field?: string): void {
    this.#sync();
    this.#current().contributors(target, visit, field);
  }

  targetsOf(position: number, visit: (target: number) => void, field?: string): void {
    this.#sync();
    this.#current().targetsOf(position, visit, field);
  }

  groupAt(position: number, field?: string): number {
    this.#sync();
    return this.#current().targetAt(position, field);
  }

  count(target: number, field?: string): number {
    this.#sync();
    return this.#current().count(target, field);
  }

  classOf(field?: string): string | null {
    this.#catchUp();
    return this.#current().classOf(field);
  }

  operandOf(field?: string): string | undefined {
    this.#catchUp();
    return this.#current().operandOf(field);
  }

  measureOf(field: string): Measure | undefined {
    this.#catchUp();
    return this.#current().measureOf(field);
  }

  incidences(visit: (position: number, group: number) => void, field?: string): void {
    this.#sync();
    const link = this.#current();
    if (link.incidences) {
      link.incidences(visit, field);
      return;
    }
    for (let target = 0; target < link.targets; target++)
      link.contributors(target, (position) => visit(position, target), field);
  }

  removed(slot: number, field: string | undefined, out: Removed): boolean {
    const [record, other] = this.#records;
    if (other || linksOf(record!).length !== 1) return false;
    if (record!.kind === "links") return record!.removed(slot, field, out);
    return record!.kind === "totals" && totalsRemoved(record!, slot, field, out);
  }

  retain(): void {
    const [record, other] = this.#records;
    if (other || record!.kind === "derived" || this.#retained) return;
    const { source, logged } = record!;
    this.#retained = record!.hold(
      () => new RemovalLog(logged.length, removalRoom(Math.min(source.maxRows, source.length))),
    );
  }

  get byteLength(): number {
    let bytes = this.#link?.byteLength ?? 0;
    for (const record of this.#records)
      bytes +=
        record.kind === "derived"
          ? derivedBytes(record as DerivedRecord)
          : (record.log?.byteLength ?? 0);
    return bytes;
  }

  estimate(): number {
    // Each part as built where it is, as estimated where it is not yet, of the rows caught up with.
    this.#catchUp();
    let bytes = this.#current().estimate ?? 0;
    for (const record of this.#records) {
      if (record.kind === "derived") {
        const derived = record as DerivedRecord;
        bytes += Math.max(derivedBytes(derived), derivedEstimate(derived));
      } else if (record.log) bytes += record.log.byteLength;
      // Rows dropped are remembered only of tables that drop them.
      else if (dropsRows(record.source)) {
        const rows = Math.min(record.source.maxRows, record.source.length);
        bytes += (4 + 8 * record.logged.length) * removalRoom(rows);
      }
    }
    return bytes;
  }

  get owned(): number {
    this.#catchUp();
    let bytes = 0;
    for (const record of this.#records) bytes += record.owned ?? 0;
    return bytes;
  }

  hold(): () => void {
    if (this.#holds++ === 0)
      for (const record of this.#records) holders.set(record, (holders.get(record) ?? 0) + 1);
    let held = true;
    return () => {
      if (!held) return;
      held = false;
      if (--this.#holds > 0) return;
      // Nothing reads through the chain: its stamps and log go, and traces no other chain holds.
      this.#link = null;
      this.#retained?.();
      this.#retained = null;
      for (const record of this.#records) {
        const left = holders.get(record)! - 1;
        holders.set(record, left);
        if (left === 0 && record.kind === "derived") releaseDerived(record as DerivedRecord);
      }
    };
  }

  /**
   * Catches each record up with the one below, from the ancestor up: a
   * derivation or groups over a table that is itself behind would answer
   * as of its stale rows. A chain of one record catches up in its links.
   */
  #sync() {
    if (this.#records.length > 1) this.#catchUp();
  }

  /**
   * Catches every record up, one alone too: what a relation says of itself
   * (what fields measure, what it will hold) is of the rows its source
   * holds, though asked from a listener of the source that runs before the
   * producers'.
   */
  #catchUp() {
    const records = this.#records;
    for (let i = records.length - 1; i >= 0; i--) void records[i]!.revision;
  }

  /**
   * The links composed. Links read their producers' state as it is, and
   * records give the same links throughout, so they are composed once,
   * and again after a release.
   */
  #current(): ContributorLink {
    if (this.#link) return this.#link;
    const links = this.#records.flatMap(linksOf);
    let link = links.at(-1)!;
    for (let i = links.length - 2; i >= 0; i--) link = compose(links[i]!, link);
    this.#link = link;
    return link;
  }
}

/**
 * A record's links: groups make their own; the reader makes totals' and
 * derivations' from what they keep.
 */
function linksOf(record: ContributorRecord): readonly ContributorLink[] {
  if (record.kind === "links") return record.links();
  if (record.kind === "totals") return totalsLinks(record);
  // derive.ts registered it; the registry cannot name its type, which pivots would reach.
  return derivedLinks(record as DerivedRecord);
}
