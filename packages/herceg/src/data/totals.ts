// A view's totals: one row of aggregates (`count`, `sum`, `mean`, `min`,
// `max`) over every row the view shows, in a one-row table that grids show
// as their totals row and charts read as any table (a KPI, a gauge, a rule
// at the mean). The totals are a group level of one group
// (data/group-levels.ts), so sums are compensated as groups' are.
//
// The table follows the view. Rows appended are added, and rows a rolling
// window drops taken away, reading no other row; a minimum or maximum that
// leaves, or a sum that loses its accuracy, is computed again from the rows
// shown. Anything else (a value the totals or the view's filter read changed
// in place, a new query or restriction, rows inserted, a reset) computes the
// totals again.

import type { ColumnInput, NumericArray } from "./column.ts";
import { time } from "./column.ts";
import type { Expression } from "./expression.ts";
import { addCompensated, checkAggregates, GroupLevel, GroupTable } from "./group-levels.ts";
import type { GroupAggregate, GroupSchema, NamedAggregate } from "./groups.ts";
import { fieldsOf, type RowSnapshot, type RowView } from "./row-view.ts";
import type { NumericField, Schema, Table, TableChange } from "./table.ts";

/** Each totals' table keeps its totals following; the source holds them only weakly. */
const keepers = new WeakMap<Table, RowTotals>();
const followers = new FinalizationRegistry<() => void>((stop) => stop());

/**
 * The totals of a row view's rows: one row of aggregates over every row the
 * view shows, in `table`, by their names. Over no rows, counts and sums are
 * 0 and the others missing. The table is current as soon as the view's
 * table changes (see the module's comment); treat it as read-only. It keeps
 * the totals following; `dispose()` stops them.
 */
export class RowTotals<
  S extends Schema = Schema,
  // biome-ignore lint/suspicious/noExplicitAny: `RowTotals<S>` erases the table's fields, as `RowGroups<S>` does, so grids take totals of any aggregates (which their columns name at run time).
  R extends Schema = any,
> {
  readonly view: RowView<S>;
  readonly aggregates: readonly NamedAggregate[];
  /** One row: each aggregate, by its name. */
  readonly table: Table<R>;
  readonly #source: Table;
  readonly #level: GroupLevel;
  /** The fields aggregates read, each once, and the aggregates whose values are times. */
  readonly #read: readonly string[];
  readonly #times: ReadonlySet<string>;
  /**
   * Kept to take rows away once the table drops them, for position `p` at
   * `#offset + p`: the values of the fields read, and, for views that leave
   * rows out, whether the view showed each row.
   */
  #kept: Float64Array[] | null = null;
  #shown: Uint8Array | null = null;
  #offset = 0;
  /** Whether the table drops rows (it has `maxRows`, or has dropped some). */
  #dropping: boolean;
  /** What the totals were computed from. */
  #seen: {
    version: number;
    query: number;
    generation: number;
    rowOffset: number;
    length: number;
    modified: number;
  };
  /** Table changes heard since the last update, and whether they need every row read again. */
  #heard = 0;
  #recompute = false;
  /** Set while writing the table, whose listeners may read the totals or change their source. */
  #updating = false;
  #stopped = false;
  readonly #stop: () => void;
  readonly #listeners = new Set<() => void>();

  constructor(view: RowView<S>, options: { ops: Record<string, GroupAggregate> }) {
    const source = view.source as unknown as Table;
    this.view = view;
    this.#source = source;
    if (typeof options !== "object" || options === null || typeof options.ops !== "object")
      throw new TypeError(
        "rowTotals options: expected { ops }, aggregates by name such as { n: count() }",
      );
    const { aggregates, read, times, leveled } = checkAggregates(
      source,
      options.ops,
      "rowTotals ops",
    );
    if (aggregates.length === 0)
      throw new RangeError(
        "rowTotals ops: expected at least one aggregate, such as { n: count() }",
      );
    this.aggregates = aggregates;
    this.#read = read;
    this.#times = times;
    const level = new GroupLevel(0, true, leveled);
    level.add(null, -1);
    this.#level = level;
    this.#dropping = source.maxRows !== Number.POSITIVE_INFINITY;
    const snapshot = view.read();
    this.#compute(snapshot);
    this.#settle(snapshot);
    this.#seen = this.#state();
    level.table = new GroupTable(this.#columns(true));
    level.published = { version: level.table.version, length: 1 };
    level.unmark();
    this.table = level.table as unknown as Table<R>;
    keepers.set(level.table, this as unknown as RowTotals);

    // Held weakly by what it follows, so totals no one keeps (nor their table) stop on their own.
    const ref = new WeakRef(this);
    const stops = [
      source.subscribe((change) => {
        const totals = ref.deref();
        if (totals) totals.#changed(change);
        else stop();
      }),
      view.subscribe(() => {
        const totals = ref.deref();
        if (!totals) stop();
        else if (view.queryRevision !== totals.#seen.query) totals.#update();
      }),
    ];
    const stop = () => {
      for (const unsubscribe of stops) unsubscribe();
    };
    this.#stop = stop;
    followers.register(this, stop, this);
  }

  /** Counts changes of the totals' values: the table's version, once the totals caught up with their view. */
  get revision(): number {
    this.#update();
    return this.table.version;
  }

  /**
   * Bytes of the typed arrays the totals hold beyond their view and table:
   * values kept for rows to drop and which rows the view shows.
   */
  get byteLength(): number {
    let bytes = this.#level.byteLength + (this.#shown?.byteLength ?? 0);
    for (const kept of this.#kept ?? []) bytes += kept.byteLength;
    return bytes;
  }

  /**
   * Calls `listener` whenever the totals followed a change of their view or
   * table, once they caught up with any change their table's listeners
   * made meanwhile; returns a function that stops it.
   */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Stops following the view; the table keeps its last values. */
  dispose(): void {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#stop();
    followers.unregister(this);
    this.#kept = null;
    this.#shown = null;
    this.#listeners.clear();
  }

  #state() {
    const source = this.#source;
    return {
      version: source.version,
      query: this.view.queryRevision,
      generation: source.generation,
      rowOffset: source.rowOffset,
      length: source.length,
      modified: source.modifiedVersion,
    };
  }

  /** A change of the table, heard as it happens (after the view's, which subscribed first). */
  #changed(change: TableChange) {
    // A read inside an earlier listener caught up with it already.
    if (this.#source.version === this.#seen.version) return;
    this.#heard++;
    if (change.inserted) this.#recompute = true;
    else if (change.updated) {
      // A view keeps its filter as an expression.
      const reads = new Set([...this.#read, ...fieldsOf(this.view.query.filter as Expression)]);
      if (change.fields.some((field) => reads.has(field))) this.#recompute = true;
    }
    this.#update();
  }

  /** Catches up with the view and its table. */
  #update() {
    const source = this.#source;
    const view = this.view;
    const seen = this.#seen;
    if (this.#stopped || this.#updating) return;
    if (source.version === seen.version && view.queryRevision === seen.query) return;
    const snapshot = view.read();
    // Changes made before a read caught up, which no listener call described.
    const unheard = source.version - seen.version > this.#heard;
    const dropped = source.rowOffset - seen.rowOffset;
    if (dropped > 0) this.#dropping = true;
    const recompute =
      this.#recompute ||
      (unheard && source.modifiedVersion !== seen.modified) ||
      source.generation !== seen.generation ||
      view.queryRevision !== seen.query ||
      // Dropped rows are taken away by what was kept of them, kept from now on.
      (dropped > 0 && !this.#keeps(snapshot));
    this.#heard = 0;
    this.#recompute = false;
    this.#seen = this.#state();
    this.#updating = true;
    try {
      if (recompute) this.#compute(snapshot);
      else this.#follow(snapshot, seen);
      this.#settle(snapshot);
      const level = this.#level;
      const change = level.publish(false, true, () => this.#columns(false));
      if (change) level.table.tell(change);
    } finally {
      this.#updating = false;
    }
    // A listener of the totals' table changed their source meanwhile.
    if (source.version !== this.#seen.version || view.queryRevision !== this.#seen.query)
      this.#update();
    else for (const listener of [...this.#listeners]) listener();
  }

  /** Whether what was kept of the rows can take away those dropped: their values, and which the view showed. */
  #keeps(snapshot: RowSnapshot): boolean {
    return (
      (this.#read.length === 0 || this.#kept !== null) &&
      (this.#all(snapshot) || this.#shown !== null)
    );
  }

  /** Whether the view shows every row of its table, in some order. */
  #all({ indices }: RowSnapshot): boolean {
    const { filter } = this.view.query;
    return (
      !indices || ((filter === undefined || filter === true) && this.view.restriction === null)
    );
  }

  /** Computes the totals again from every row the view shows, keeping what drops will need. */
  #compute(snapshot: RowSnapshot) {
    const level = this.#level;
    const source = this.#source;
    const { indices, length } = snapshot;
    level.clear(0, 1);
    const columns = this.#read.map((field) => source.numbers(field));
    add(level, columns, 0, length, indices);
    this.#offset = 0;
    const rows = source.length;
    const kept = this.#dropping && columns.length > 0;
    this.#kept = kept ? columns.map((column) => grownCopy(column, rows)) : null;
    if (this.#dropping && !this.#all(snapshot)) {
      const shown = new Uint8Array(grown(rows));
      for (let i = 0; i < length; i++) shown[indices![i]!] = 1;
      this.#shown = shown;
    } else this.#shown = null;
  }

  /** Takes away the rows dropped since `seen` and adds those appended. */
  #follow(snapshot: RowSnapshot, seen: { rowOffset: number; length: number }) {
    const source = this.#source;
    // An append larger than `maxRows` drops every row there was, and some of its own.
    const removed = Math.min(source.rowOffset - seen.rowOffset, seen.length);
    const from = Math.max(0, seen.rowOffset + seen.length - source.rowOffset);
    if (removed > 0) this.#remove(removed);
    if (from < source.length) this.#add(snapshot, from);
  }

  /** Takes away the table's first `removed` rows (as they were), which it dropped. */
  #remove(removed: number) {
    const level = this.#level;
    const kept = this.#kept ?? [];
    const shown = this.#shown;
    const start = this.#offset;
    for (let index = start; index < start + removed; index++)
      if (!shown || shown[index]) level.change(0, -1, kept, index);
    this.#offset += removed;
  }

  /** Adds the rows the view shows from position `from` on, all appended. */
  #add(snapshot: RowSnapshot, from: number) {
    const source = this.#source;
    const length = source.length;
    const columns = this.#read.map((field) => source.numbers(field));
    const all = this.#all(snapshot);
    // The appended rows the view shows: every one, or found among its positions.
    let positions: Uint32Array | undefined;
    if (!all) {
      const { indices, length: count } = snapshot;
      if (!this.view.query.sort?.length) {
        // Unsorted views keep table order: new rows are at the end.
        let first = count;
        while (first > 0 && indices![first - 1]! >= from) first--;
        positions = indices!.subarray(first, count);
      } else {
        const found: number[] = [];
        for (let position = from; position < length; position++)
          if (this.view.indexOf(position) >= 0) found.push(position);
        positions = Uint32Array.from(found);
      }
    }
    if (positions) add(this.#level, columns, 0, positions.length, positions);
    else add(this.#level, columns, from, length);
    if (!this.#kept && !this.#shown) return;
    this.#reserve(from, length);
    const offset = this.#offset;
    this.#kept?.forEach((kept, i) => {
      kept.set(columns[i]!.subarray(from, length), offset + from);
    });
    const shown = this.#shown;
    if (shown) {
      shown.fill(0, offset + from, offset + length);
      for (const position of positions ?? []) shown[offset + position] = 1;
    }
  }

  /** Computes again a minimum or maximum that left, and sums that lost their accuracy, from the rows shown. */
  #settle({ indices, length }: RowSnapshot) {
    const level = this.#level;
    level.checkSums(null);
    if (level.staleCount === 0) return;
    const source = this.#source;
    level.recompute(
      0,
      this.#read.map((field) => source.numbers(field)),
      indices,
      length,
    );
    level.settle();
  }

  /** Room for rows up to position `length`, the first `live` of which are kept. */
  #reserve(live: number, length: number) {
    const offset = this.#offset;
    const capacity = (this.#kept?.[0] ?? this.#shown)!.length;
    if (offset + length <= capacity) return;
    // Moving the rows to the front costs as much as the appends that filled the room since.
    const size = length * 1.5 <= capacity ? capacity : grown(length);
    const move = <A extends Float64Array | Uint8Array>(array: A): A => {
      if (size === array.length) {
        array.copyWithin(0, offset, offset + live);
        return array;
      }
      const next = new (array.constructor as new (length: number) => A)(size);
      next.set(array.subarray(offset, offset + live));
      return next;
    };
    if (this.#kept) this.#kept = this.#kept.map(move);
    if (this.#shown) this.#shown = move(this.#shown);
    this.#offset = 0;
  }

  /** The totals as the table's columns, tagged with their kinds for a new table. */
  #columns(tagged: boolean): Record<string, ColumnInput> {
    const level = this.#level;
    const columns: Record<string, ColumnInput> = Object.create(null);
    level.aggregates.forEach(({ name }, k) => {
      const values = Float64Array.of(level.result(k, 0));
      columns[name] = tagged && this.#times.has(name) ? time(values) : values;
    });
    return columns;
  }
}

/**
 * The totals of a row view's rows: one row of aggregates, by name, over
 * every row the view shows, with `groupRows`' operations (`count()`,
 * `sum("bytes")`, `mean("latency")`, `min`, `max`). See `RowTotals`.
 *
 * ```ts
 * const totals = rowTotals(rowView(requests), { ops: { n: count(), latency: mean("latency") } });
 * totals.table.value("latency", 0); // the mean latency of every request
 * createGridModel({ data: totals.view, totals, columns: [{ field: "latency", aggregate: "latency" }] });
 * ```
 */
export function rowTotals<
  S extends Schema,
  O extends Record<string, GroupAggregate<NumericField<S>>>,
>(view: RowView<S>, options: { ops: O }): RowTotals<S, GroupSchema<S, never, O>> {
  return new RowTotals(view, options as unknown as { ops: Record<string, GroupAggregate> });
}

/**
 * Adds rows `from` to `to` of `positions` (every row from `from` to `to`
 * without) to the level's one group: a pass over each column.
 */
function add(
  level: GroupLevel,
  columns: readonly NumericArray[],
  from: number,
  to: number,
  positions?: Uint32Array,
) {
  level.rows[0]! += to - from;
  level.aggregates.forEach(({ op, field }, k) => {
    if (field < 0) return;
    const values = columns[field]!;
    const out = level.running[k]!;
    const sums = op === "sum" || op === "mean";
    let count = 0;
    let extreme = out[0]!;
    for (let i = from; i < to; i++) {
      const value = values[positions ? positions[i]! : i]!;
      if (!Number.isFinite(value)) continue;
      count++;
      if (sums) addCompensated(out, level.low[k]!, level.error[k]!, 0, value);
      else if (
        op !== "count" &&
        (Number.isNaN(extreme) || (op === "min" ? value < extreme : value > extreme))
      )
        extreme = value;
    }
    if (op === "count") out[0]! += count;
    else if (sums) level.finite[k]![0]! += count;
    else out[0] = extreme;
  });
}

/** A copy of `column`'s first `length` values with room to grow. */
function grownCopy(column: NumericArray, length: number): Float64Array {
  const kept = new Float64Array(grown(length));
  kept.set(column.subarray(0, length));
  return kept;
}

/** Capacity for `length` entries, with room to grow. */
function grown(length: number): number {
  return Math.max(64, Math.ceil(length * 1.5));
}
