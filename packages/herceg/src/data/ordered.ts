// Tables kept in the order of one field (`orderedTable`): rows that arrive
// late merge into place, one merge per append. Rows keep identities of their
// own, ordinals given as they arrive, since a late row moves the rows after
// it. A module of its own, so charts of ordinary tables carry none of it.

import {
  type ColumnInput,
  category,
  encodedCategory,
  type NumericArray,
  type TimeValue,
  time,
  toMilliseconds,
} from "./column.ts";
import { geometryOf } from "./geometry.ts";
import { popcount, type SparseRows } from "./row-set.ts";
import {
  type Batch,
  lowerBound,
  moved,
  type NumericField,
  type Schema,
  type SchemaOf,
  Table,
  type TableChange,
  type TableOptions,
  upperBound,
} from "./table.ts";

/** How many changes that move rows `changedFrom` remembers. */
const CHANGES = 16;

/**
 * What consumers following a table read of one whose rows move (an
 * ordered table), without importing it: see `OrderedTable.changedFrom`.
 */
export interface MovingRows {
  changedFrom(version: number): number | undefined;
}

export interface OrderedTableOptions<S extends Schema> extends TableOptions {
  /**
   * The number or time field the rows are kept in ascending order of, ties
   * in the order they arrived. Every row needs a value of it, and it
   * cannot be `replace`d: drop those rows and append them again.
   */
  orderBy: NumericField<S>;
}

/**
 * A table kept in ascending order of `orderBy`, ties in arrival order:
 * `append` takes rows in any order, appending those at or after the last
 * row and merging earlier ones into place (one merge per batch; a late row
 * costs a shift of the rows after it), and listeners hear one change that
 * says where rows were inserted (`TableChange.inserted`). `maxRows`,
 * `dropFirst`, and `dropBefore` drop from the first row up, so a late row
 * that sorts before every row kept is not kept. Each row's identity is the
 * ordinal it took as it arrived (8 bytes a row), so row sets and
 * selections stay with their rows as others move in front of them. A new
 * table's rows are sorted as it is made: its version starts at 0.
 */
export class OrderedTable<S extends Schema = Schema> extends Table<S> implements MovingRows {
  readonly orderBy: NumericField<S>;
  /** Each row's ordinal, by position, from `#first`, in a buffer with room to grow as columns have. */
  #ordinals: Float64Array;
  #first = 0;
  /** The ordinal of the next row to arrive. */
  #next: number;
  readonly #listeners = new Set<(change: TableChange) => void>();
  /**
   * Since listeners last heard a change: the slot (`rowOffset` plus
   * position, which drops leave in place) rows were merged into place
   * from, and the slot past the last row anyone may have read: those
   * listeners heard of, and in a transaction those its writes made.
   */
  #low = Number.POSITIVE_INFINITY;
  #end: number;
  /**
   * The last changes that moved rows or rewrote them in place, as pairs of
   * the version they made and the slot they started at, for `changedFrom`;
   * changes made before version `#since` are not all among them.
   */
  #changes: number[] = [];
  #since = 0;

  constructor(columns: Record<string, ColumnInput>, options: OrderedTableOptions<S>) {
    const { orderBy, maxRows = Number.POSITIVE_INFINITY, ...rest } = options;
    if (!(maxRows === Number.POSITIVE_INFINITY || (Number.isInteger(maxRows) && maxRows > 0)))
      throw new RangeError(
        `orderedTable maxRows: expected a positive whole number; received ${maxRows}`,
      );
    // Columns are read as tables read them, numbered as given, then sorted;
    // rows past maxRows from the end leave.
    const given = new Table(columns, rest);
    const field = orderBy as string;
    if (!given.has(field))
      throw new TypeError(
        `orderedTable orderBy: no field "${field}"; the table has "${given.fields().join('", "')}"`,
      );
    const kind = given.kind(field);
    if (kind !== "number" && kind !== "time")
      throw new TypeError(
        `orderedTable orderBy: "${field}" is a ${kind} field; give a number or time field`,
      );
    const kept = sortedOrder(given, field, "orderedTable", maxRows);
    super(reordered(given, kept), rest);
    // Tables keep `maxRows` as they append; this one, once rows are in place.
    (this as { maxRows: number }).maxRows = maxRows;
    this.orderBy = orderBy;
    this.#ordinals = Float64Array.from(kept);
    this.#next = given.length;
    this.#end = this.length;
    super.subscribe((change) => this.#tell(change));
  }

  /**
   * The first position whose row may have moved or changed since the
   * table's `version`, other than rows appended after the last or dropped
   * from the first: `length` when none has; undefined when the table cannot
   * say (it was reset since, or too many such changes ago). Consumers that
   * follow the table read it to take only those rows again.
   */
  changedFrom(version: number): number | undefined {
    if (version < this.#since || version > this.version) return undefined;
    let slot = Number.POSITIVE_INFINITY;
    const changes = this.#changes;
    for (let i = 0; i < changes.length; i += 2)
      if (changes[i]! > version) slot = Math.min(slot, changes[i + 1]!);
    return Math.max(0, Math.min(this.length, slot - this.rowOffset));
  }

  /** The identity of the row at `position`: the ordinal it took as it arrived. */
  override identity(position: number): number {
    return position >= 0 && position < this.length
      ? this.#ordinals[this.#first + position]!
      : Number.NaN;
  }

  /**
   * Where the row of `identity` is now, or -1 once dropped or after a
   * reset (`generation`): a scan of the rows, or of the rows whose order
   * value is `at`, where the caller kept it.
   */
  override positionOf(identity: number, generation: number, at?: TimeValue): number {
    if (generation !== this.generation) return -1;
    let from = 0;
    let to = this.length;
    if (at !== undefined) {
      const values = this.numbers(this.orderBy);
      const value = toMilliseconds(at);
      from = lowerBound(values, value, 0, to);
      to = upperBound(values, value, from, to);
    }
    const ordinals = this.#ordinals;
    const first = this.#first;
    for (let position = from; position < to; position++)
      if (ordinals[first + position] === identity) return position;
    return -1;
  }

  override get byteLength(): number {
    return super.byteLength + this.#ordinals.byteLength;
  }

  /** What row sets of the table keep their members in (see `RowSet`). */
  sparseRows(): SparseRows {
    return new SparseWords(this, () =>
      this.#ordinals.subarray(this.#first, this.#first + this.length),
    );
  }

  /** The order field always ascends. */
  override isSorted(field: NumericField<S>): boolean {
    return field === this.orderBy || super.isSorted(field);
  }

  /** Listeners hear a change once per write or transaction, with the rows inserted before others. */
  override subscribe(listener: (change: TableChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /**
   * Appends a batch of rows in any order: rows at or after the last row
   * go at the end, earlier ones into place, after rows of the same order
   * value already there and in the batch's order among themselves. Rows
   * past `maxRows` leave from the first; batch rows that would leave at
   * once are not taken in, though each is numbered as it arrived.
   */
  override append(batch: Batch<S>): void {
    const field = this.orderBy as string;
    const given = (batch as Record<string, ArrayLike<unknown>>)[field];
    if (given)
      for (let i = 0; i < given.length; i++) {
        const value = given[i];
        if (
          value == null ||
          ((typeof value === "number" || value instanceof Date) && Number.isNaN(+value))
        )
          throw missingValue("append", field, i);
      }
    const arrived = given?.length ?? 0;
    // Batches append refuses (fields of other lengths) are taken whole, to be refused there.
    const whole = Object.values(batch as Record<string, ArrayLike<unknown>>).every(
      (values) => values.length === arrived,
    );
    const kept = given && whole ? this.#kept(given) : undefined;
    // A transaction's earlier rows may have been read since: rows moved
    // among them are told as inserted, not appended.
    this.#end = Math.max(this.#end, this.rowOffset + this.length);
    this.transaction(() => {
      const before = this.length;
      super.append(kept ? (taken(batch, kept) as Batch<S>) : batch);
      const count = this.length - before;
      this.#took(before, count, kept, arrived);
      if (count === 0) return;
      const values = this.numbers(this.orderBy);
      // The batch in order (ties as they came), and where it starts among the rows there.
      const fresh = stableOrder(values, before, this.length);
      const start = upperBound(values, values[before + fresh[0]!]!, 0, before);
      if (start < before || !isRange(fresh)) {
        const order = new Uint32Array(this.length - start);
        let i = start;
        let j = 0;
        for (let k = 0; k < order.length; k++) {
          const next = j < count ? before + fresh[j]! : -1;
          // Rows already there come before batch rows of the same value.
          if (i < before && (next < 0 || values[i]! <= values[next]!)) order[k] = i++ - start;
          else {
            order[k] = next - start;
            j++;
          }
        }
        this.#move(start, order);
      }
      if (this.length > this.maxRows) this.dropFirst(this.length - this.maxRows);
    });
  }

  override dropFirst(count: number): void {
    // Listeners hear the drop once the ordinals have dropped too.
    this.transaction(() => {
      const before = this.length;
      super.dropFirst(count);
      this.#first += before - this.length;
      // As tables give back room: once less than a quarter is used.
      const room = Math.max(64, Math.ceil(this.length * 1.5));
      if (this.#ordinals.length > 4 * room) this.#room(room);
    });
  }

  /** Writes rows in place; the order field is refused, since its rows would move. */
  override replace(start: number, values: Partial<Batch<S>>): void {
    const field = this.orderBy as string;
    if (Object.hasOwn(values, field))
      throw new TypeError(`replace "${field}": is the table's orderBy; drop and append those rows`);
    super.replace(start, values);
  }

  /** Replaces every row with `columns`, numbered from 0 as given and then sorted, as `orderedTable` does. */
  override reset(columns: { [K in keyof S]: ColumnInput }): void {
    // Read as the table's fields are, as `reset` reads them.
    const empty: Record<string, ColumnInput> = Object.create(null);
    for (const field of this.fields()) {
      const kind = this.kind(field);
      empty[field] =
        kind === "geometry"
          ? geometryOf(this.geometries(field as never).set, new Int32Array(0))
          : kind === "category"
            ? category([])
            : kind === "time"
              ? time([])
              : new Float64Array(0);
    }
    const given = new Table(empty);
    given.reset(columns);
    const kept = sortedOrder(given, this.orderBy as string, "reset", this.maxRows);
    this.transaction(() => {
      super.reset(reordered(given, kept) as { [K in keyof S]: ColumnInput });
      this.#ordinals = Float64Array.from(kept);
      this.#first = 0;
      this.#next = given.length;
    });
  }

  /** Tells listeners of a change the table made, with the rows merged into place since the last. */
  #tell(change: TableChange) {
    const offset = this.rowOffset;
    const length = this.length;
    const start = Math.max(0, this.#low - offset);
    let told = change;
    if (!change.reset && start < length) {
      // Rows after the last that listeners had heard of are appended.
      const appended = Math.max(
        0,
        Math.min(change.appended, length - Math.max(start, this.#end - offset)),
      );
      const updated = change.updated;
      const kept = updated && updated.start < start;
      told = {
        dropped: change.dropped,
        appended,
        inserted: { start, count: change.appended - appended },
        updated: kept ? { start: updated.start, end: Math.min(updated.end, start) } : null,
        fields: kept ? change.fields : [],
        reset: false,
      };
    }
    this.#low = Number.POSITIVE_INFINITY;
    this.#end = offset + length;
    // What moved or changed in place, for `changedFrom`; a reset, anything.
    const from = Math.min(
      told.inserted?.start ?? Number.POSITIVE_INFINITY,
      told.updated?.start ?? Number.POSITIVE_INFINITY,
    );
    if (told.reset) {
      this.#changes = [];
      this.#since = this.version;
    } else if (from < Number.POSITIVE_INFINITY) {
      if (this.#changes.length === CHANGES * 2) this.#since = this.#changes.splice(0, 2)[0]!;
      this.#changes.push(this.version, offset + from);
    }
    for (const listener of [...this.#listeners]) listener(told);
  }

  /**
   * Numbers `count` rows appended after the `before` there, of a batch of
   * `arrived` whose rows `kept` (all, without) were taken in: each batch
   * row has the ordinal of its place in the batch, kept or not.
   */
  #took(before: number, count: number, kept: Uint32Array | undefined, arrived: number) {
    const length = before + count;
    if (this.#first + length > this.#ordinals.length)
      this.#room(Math.max(64, Math.ceil(length * 1.5)));
    const at = this.#first + before;
    for (let i = 0; i < count; i++) this.#ordinals[at + i] = this.#next + (kept ? kept[i]! : i);
    this.#next += Math.max(arrived, count);
  }

  /**
   * The batch rows (ascending) still there once the batch is merged and
   * `maxRows` drops the first rows: undefined when all are. Rows already
   * there go first among equal values, as merging places them.
   */
  #kept(given: ArrayLike<unknown>): Uint32Array | undefined {
    const count = given.length;
    const excess = this.length + count - this.maxRows;
    if (!(excess > 0)) return undefined;
    const there = this.numbers(this.orderBy);
    // Compared as the column stores them (a Float32Array rounds them).
    const values = new (there.constructor as new (length: number) => NumericArray)(count);
    for (let i = 0; i < count; i++) {
      const value = given[i];
      const at = typeof value === "number" ? value : toMilliseconds(value as TimeValue);
      // Values append refuses are taken in, to be refused there.
      if (Number.isNaN(at)) return undefined;
      values[i] = at;
    }
    const order = stableOrder(values);
    let i = 0;
    let lost = 0;
    for (let k = 0; k < excess; k++) {
      if (lost < count && (i >= there.length || values[order[lost]!]! < there[i]!)) lost++;
      else i++;
    }
    if (lost === 0) return undefined;
    const leaves = new Uint8Array(count);
    for (let k = 0; k < lost; k++) leaves[order[k]!] = 1;
    const kept = new Uint32Array(count - lost);
    for (let row = 0, n = 0; row < count; row++) if (!leaves[row]) kept[n++] = row;
    return kept;
  }

  /**
   * Rows from `start` on become those at `start + order[i]`, in turn: every
   * column, through the arrays the table gives, and the ordinals.
   */
  #move(start: number, order: Uint32Array) {
    for (const field of this.fields()) {
      const kind = this.kind(field);
      permute(
        kind === "category"
          ? this.categories(field as never).codes
          : kind === "geometry"
            ? this.geometries(field as never).codes
            : this.numbers(field as never),
        start,
        order,
      );
    }
    permute(this.#ordinals.subarray(this.#first, this.#first + this.length), start, order);
    // Rows listeners heard of, from `start` on, and where the last of them is now.
    const offset = this.rowOffset;
    const heard = this.#end - offset - start;
    let last = -1;
    for (let i = 0; i < order.length; i++) if (order[i]! < heard) last = i;
    if (heard > 0) {
      this.#low = Math.min(this.#low, offset + start);
      this.#end = offset + start + last + 1;
    }
    moved(this, start, heard > 0);
  }

  /** Moves the ordinals to the front of a buffer of `capacity`. */
  #room(capacity: number) {
    const next = new Float64Array(capacity);
    next.set(this.#ordinals.subarray(this.#first, this.#first + this.length));
    this.#ordinals = next;
    this.#first = 0;
  }
}

/**
 * A table kept in ascending order of `orderBy`, whose late rows merge into
 * place (see `OrderedTable`). Columns are taken as `table` takes them,
 * then sorted, ties in the order given.
 *
 * ```ts
 * const observations = orderedTable(
 *   { time: time([]), service: category([]), value: new Float64Array(0) },
 *   { orderBy: "time", maxRows: 180_000 },
 * );
 * ```
 */
export function orderedTable<const T extends Record<string, ColumnInput>>(
  columns: T,
  options: OrderedTableOptions<SchemaOf<T>>,
): OrderedTable<SchemaOf<T>> {
  return new OrderedTable<SchemaOf<T>>(columns, options);
}

function missingValue(method: string, field: string, row: number): TypeError {
  return new TypeError(
    `${method} "${field}": row ${row}: is missing; an ordered table needs every row's ${field}`,
  );
}

/** The rows of `table` in order of `field`, ties as they are, the last `keep` of them. */
function sortedOrder(table: Table, field: string, method: string, keep: number): Uint32Array {
  const values = table.numbers(field as never);
  const missing = values.findIndex((value) => Number.isNaN(value));
  if (missing >= 0) throw missingValue(method, field, missing);
  return stableOrder(values).subarray(Math.max(0, values.length - keep));
}

/** Columns of `table`'s rows at `order` as tables take them: typed, categories as codes. */
function reordered(table: Table, order: Uint32Array): Record<string, ColumnInput> {
  const columns: Record<string, ColumnInput> = Object.create(null);
  const at = <T extends NumericArray>(values: T): T => {
    if (isRange(order) && order.length === values.length) return values;
    const out = new (values.constructor as new (length: number) => T)(order.length);
    for (let i = 0; i < order.length; i++) out[i] = values[order[i]!]!;
    return out;
  };
  for (const field of table.fields()) {
    const kind = table.kind(field);
    if (kind === "category") {
      const { codes, dictionary } = table.categories(field);
      columns[field] = encodedCategory(at(codes), dictionary);
    } else if (kind === "geometry") {
      const { codes, set } = table.geometries(field);
      columns[field] = geometryOf(set, at(codes));
    } else {
      const values = at(table.numbers(field));
      columns[field] = kind === "time" ? time(values) : values;
    }
  }
  return columns;
}

/** Writes `values[start + i]` with what was at `start + order[i]`. */
function permute(values: NumericArray, start: number, order: Uint32Array) {
  const rows = values.slice(start, start + order.length);
  for (let i = 0; i < order.length; i++) values[start + i] = rows[order[i]!]!;
}

/** Positions `[from, to)` of `values` in ascending order of their values, ties in position order, from 0. */
function stableOrder(values: ArrayLike<number>, from = 0, to = values.length): Uint32Array {
  const order = new Uint32Array(to - from);
  let sorted = true;
  for (let i = 0; i < order.length; i++) {
    order[i] = i;
    if (i > 0 && values[from + i]! < values[from + i - 1]!) sorted = false;
  }
  return sorted ? order : order.sort((a, b) => values[from + a]! - values[from + b]! || a - b);
}

/** A batch's rows at `rows`, every field's. */
function taken(batch: object, rows: Uint32Array): Record<string, ArrayLike<unknown>> {
  const out: Record<string, ArrayLike<unknown>> = Object.create(null);
  for (const [field, values] of Object.entries(batch as Record<string, ArrayLike<unknown>>)) {
    if (ArrayBuffer.isView(values)) {
      const typed = new (values.constructor as new (length: number) => NumericArray)(rows.length);
      rows.forEach((row, k) => {
        typed[k] = values[row] as number;
      });
      out[field] = typed;
    } else out[field] = Array.from(rows, (row) => values[row]);
  }
  return out;
}

/** Whether `order` is 0, 1, 2, ...: nothing moves. */
function isRange(order: Uint32Array): boolean {
  for (let i = 0; i < order.length; i++) if (order[i] !== i) return false;
  return true;
}

/**
 * A row set's members over an ordered table: words of 32 identities, held
 * only where a member is (12 bytes a word), in ascending order. The table
 * drops rows by order, which can leave a row that arrived early alone far
 * from the others, so dense words from the lowest identity kept would grow
 * without end. Rows the table drops leave on the next count or listing, or
 * once it has dropped a quarter of its rows since; until then their bits
 * stay, bounding the words by members plus those rows.
 */
class SparseWords implements SparseRows {
  readonly #table: Table;
  /** The table's ordinals by position: identities of its rows now. */
  readonly #ordinals: () => Float64Array;
  /** Word numbers (identity / 32), ascending, and their bits, up to `#count`. */
  #index = new Float64Array(0);
  #words = new Uint32Array(0);
  #count = 0;
  /** Bits set, those of rows dropped since the last trim included. */
  #members = 0;
  /** Words emptied by `delete` since the last compaction, about: refilled ones count too. */
  #emptied = 0;
  /** The table's `rowOffset` at the last trim: it counts the rows dropped since. */
  #trimmed: number;
  /** The slot found last: rows near each other in order arrived near each other. */
  #hint = 0;

  constructor(table: Table, ordinals: () => Float64Array) {
    this.#table = table;
    this.#ordinals = ordinals;
    this.#trimmed = table.rowOffset;
  }

  get byteLength(): number {
    return this.#index.byteLength + this.#words.byteLength;
  }

  has(identity: number): boolean {
    const slot = this.#find(Math.floor(identity / 32));
    return slot >= 0 && (this.#words[slot]! & (1 << (identity % 32))) !== 0;
  }

  add(identities: Float64Array): number {
    this.#trim(false);
    // Words not held yet join in one merge.
    const missing: number[] = [];
    for (const identity of identities) {
      const word = Math.floor(identity / 32);
      if (this.#find(word) < 0) missing.push(word);
    }
    if (missing.length > 0)
      this.#insert(
        missing.sort((a, b) => a - b).filter((word, k) => k === 0 || word !== missing[k - 1]),
      );
    let added = 0;
    for (const identity of identities) {
      const slot = this.#find(Math.floor(identity / 32));
      const mask = 1 << (identity % 32);
      if ((this.#words[slot]! & mask) === 0) {
        this.#words[slot]! |= mask;
        added++;
      }
    }
    this.#members += added;
    return added;
  }

  delete(identity: number): boolean {
    const slot = this.#find(Math.floor(identity / 32));
    const mask = 1 << (identity % 32);
    if (slot < 0 || (this.#words[slot]! & mask) === 0) return false;
    this.#words[slot]! &= ~mask;
    this.#members--;
    // Empty words leave once they are half of those held.
    if (this.#words[slot] === 0 && ++this.#emptied * 2 > this.#count) this.#compact();
    return true;
  }

  size(): number {
    this.#trim(true);
    return this.#members;
  }

  positions(): Uint32Array {
    this.#trim(true);
    const ordinals = this.#ordinals();
    const out = new Uint32Array(this.#members);
    let n = 0;
    for (let position = 0; position < ordinals.length && n < out.length; position++)
      if (this.has(ordinals[position]!)) out[n++] = position;
    return out;
  }

  /**
   * Forgets the members the table dropped: when asked to, or once it has
   * dropped a quarter of its rows since the last time, so a set only added
   * to stays bounded too.
   */
  #trim(asked: boolean) {
    const table = this.#table;
    const dropped = table.rowOffset - this.#trimmed;
    if (dropped === 0 || (!asked && dropped * 4 < Math.max(256, table.length))) return;
    this.#trimmed = table.rowOffset;
    const live = new Uint32Array(this.#count);
    for (const identity of this.#ordinals()) {
      const slot = this.#find(Math.floor(identity / 32));
      if (slot >= 0) live[slot]! |= 1 << (identity % 32);
    }
    this.#compact(live);
  }

  /** Keeps the words with members: of those in `live` (bits of rows the table holds), when given. */
  #compact(live?: Uint32Array) {
    let kept = 0;
    let members = 0;
    for (let slot = 0; slot < this.#count; slot++) {
      const word = live ? this.#words[slot]! & live[slot]! : this.#words[slot]!;
      if (word === 0) continue;
      this.#index[kept] = this.#index[slot]!;
      this.#words[kept++] = word;
      members += popcount(word);
    }
    this.#count = kept;
    this.#members = members;
    this.#emptied = 0;
    this.#hint = 0;
    // Room given back once less than a quarter is used, as tables do.
    if (this.#index.length > 4 * Math.max(16, kept * 1.5)) this.#resize(Math.ceil(kept * 1.5));
  }

  /** The slot of word `word`, or -1. */
  #find(word: number): number {
    const index = this.#index;
    const count = this.#count;
    let slot = this.#hint;
    if (!(slot < count && index[slot] === word)) {
      slot++;
      if (!(slot < count && index[slot] === word)) {
        let hi = count;
        slot = 0;
        while (slot < hi) {
          const mid = (slot + hi) >>> 1;
          if (index[mid]! < word) slot = mid + 1;
          else hi = mid;
        }
        if (!(slot < count && index[slot] === word)) return -1;
      }
    }
    this.#hint = slot;
    return slot;
  }

  /** Adds empty words for `words`, ascending and none held yet. */
  #insert(words: number[]) {
    const count = this.#count;
    const length = count + words.length;
    if (length > this.#index.length) this.#resize(Math.max(16, Math.ceil(length * 1.5)));
    const index = this.#index;
    const bits = this.#words;
    // Merged from the end, so nothing is overwritten before it is read.
    let i = count - 1;
    let k = length - 1;
    for (let j = words.length - 1; j >= 0; j--) {
      while (i >= 0 && index[i]! > words[j]!) {
        index[k] = index[i]!;
        bits[k--] = bits[i--]!;
      }
      index[k] = words[j]!;
      bits[k--] = 0;
    }
    this.#count = length;
    this.#hint = 0;
  }

  #resize(capacity: number) {
    const index = new Float64Array(capacity);
    const words = new Uint32Array(capacity);
    index.set(this.#index.subarray(0, this.#count));
    words.set(this.#words.subarray(0, this.#count));
    this.#index = index;
    this.#words = words;
  }
}
