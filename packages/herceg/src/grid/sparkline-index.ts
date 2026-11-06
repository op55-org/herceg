// The index sparklines read their data through (grid/sparklines.ts): the
// data's rows bucketed by key, each bucket in x order (ties in the data's
// order), as table positions in one array where each bucket has room after
// its rows. Built by a counting sort with no room: about 4 bytes a row and
// 40 a key, and as much again while it is built. Rows appended to the table
// go into their bucket's room, so an append costs about the rows appended:
// a bucket without room moves to the array's end with a quarter more, and
// once the array is full every bucket is laid out again with a quarter more
// (O(rows), less often the more rows there are). A table appended to holds
// up to about 5.6 bytes a row and 36 a key (each key's room is at least 8
// rows). A category key adds 4 bytes a label of its dictionary, up to 8 as
// the dictionary grows, labels no row indexed has included.

import type { NumericArray } from "../data/column.ts";
import type { Table } from "../data/table.ts";

/** What an index reads of its table, and the column's window where it is given. */
export interface IndexedFields {
  readonly key: string;
  /** Whether the key is a category, matched by label. */
  readonly category: boolean;
  readonly x: string;
  readonly y: string;
  readonly xDomain: readonly [number, number] | undefined;
}

const NONE = -1;

/** A bucket's room once it is given some: its rows and a quarter more. */
const room = (count: number) => count + Math.max(8, count >> 2);

export class SparklineIndex {
  /** Each key's bucket. */
  readonly keys = new Map<string | number, number>();
  /** Per bucket: where its rows start in `rows`, how many there are, and the room it has. */
  starts = new Uint32Array(16);
  counts = new Uint32Array(16);
  caps = new Uint32Array(16);
  /** Per bucket: its rows with a finite y, and its greatest x. */
  values = new Uint32Array(16);
  ends = new Float64Array(16);
  /** Table positions, bucket by bucket. */
  rows = new Uint32Array(0);
  /** The data's x and y, as of the state indexed. */
  x: NumericArray = new Float64Array(0);
  y: NumericArray = new Float64Array(0);
  /** The column's window, x at the cell's ends; undefined while the data has no finite x. */
  xDomain: readonly [number, number] | undefined;
  /** The data's least and greatest finite x, of rows with keys or without. */
  low = Number.POSITIVE_INFINITY;
  high = Number.NEGATIVE_INFINITY;
  /** The table's state indexed (`length`: rows read), which appends alone extend. */
  length = 0;
  version = 0;
  modified = 0;
  generation = 0;
  offset = 0;
  #buckets = 0;
  /** Where the last bucket's room ends in `rows`. */
  #end = 0;
  readonly #table: Table;
  readonly #fields: IndexedFields;
  /** The key field's arrays as last read, and each dictionary code's bucket. */
  #codes: Int32Array | undefined;
  #dictionary: readonly string[] = [];
  #numbers: NumericArray | undefined;
  #byCode = new Int32Array(0);

  /** The index of `table`'s first `length` rows, or of `order`'s (a view's) when given. */
  constructor(table: Table, fields: IndexedFields, order: Uint32Array | undefined, length: number) {
    this.#table = table;
    this.#fields = fields;
    this.#read();
    const { x, y } = this;
    // Rows with a key and an x counted, then laid out with no room. Each
    // row's bucket is its code's for a category, kept for numbers.
    const codes = this.#codes;
    const of = codes ? undefined : new Int32Array(length);
    for (let k = 0; k < length; k++) {
      const i = order ? order[k]! : k;
      const bucket = Number.isFinite(x[i]!) ? this.#bucket(i) : NONE;
      if (of) of[k] = bucket;
      if (bucket !== NONE) this.caps[bucket]!++;
    }
    const { starts, counts, caps, values, ends } = this;
    const byCode = this.#byCode;
    let at = 0;
    for (let b = 0; b < this.#buckets; b++) {
      starts[b] = at;
      at += caps[b]!;
    }
    const rows = new Uint32Array(at);
    const unsorted = new Set<number>();
    let low = this.low;
    let high = this.high;
    for (let k = 0; k < length; k++) {
      const i = order ? order[k]! : k;
      const xv = x[i]!;
      if (!Number.isFinite(xv)) continue;
      if (xv < low) low = xv;
      if (xv > high) high = xv;
      const bucket = of ? of[k]! : codes![i]! < 0 ? NONE : byCode[codes![i]!]!;
      if (bucket === NONE) continue;
      rows[starts[bucket]! + counts[bucket]!++] = i;
      if (Number.isFinite(y[i]!)) values[bucket]!++;
      if (xv < ends[bucket]!) unsorted.add(bucket);
      else ends[bucket] = xv;
    }
    this.rows = rows;
    this.#end = at;
    this.low = low;
    this.high = high;
    this.#settle(unsorted, length);
  }

  /**
   * Whether the table only had rows appended since it was indexed: not
   * reset, dropped from, or changed in place, nor changed in place by a
   * transaction still open then (whose writes share one `modifiedVersion`).
   */
  get grown(): boolean {
    const table = this.#table;
    return (
      this.modified <= this.version &&
      table.generation === this.generation &&
      table.modifiedVersion === this.modified &&
      table.rowOffset === this.offset
    );
  }

  /** Takes in the rows appended since it was indexed (see `grown`). */
  extend(): void {
    this.#read();
    this.#take(undefined, this.length, this.#table.length);
  }

  /** Puts rows `from` to `to` (places in `order`, else table positions) in their buckets. */
  #take(order: Uint32Array | undefined, from: number, to: number) {
    const { x, y } = this;
    const unsorted = new Set<number>();
    let low = this.low;
    let high = this.high;
    // Read again as a new key widens them or a bucket moves.
    let { starts, counts, caps, values, ends, rows } = this;
    for (let k = from; k < to; k++) {
      const i = order ? order[k]! : k;
      const xv = x[i]!;
      if (!Number.isFinite(xv)) continue;
      if (xv < low) low = xv;
      if (xv > high) high = xv;
      const bucket = this.#bucket(i);
      if (bucket === NONE) continue;
      if (starts !== this.starts) ({ starts, counts, caps, values, ends } = this);
      if (counts[bucket] === caps[bucket]) {
        this.#grow(bucket);
        rows = this.rows;
      }
      rows[starts[bucket]! + counts[bucket]!++] = i;
      if (Number.isFinite(y[i]!)) values[bucket]!++;
      if (xv < ends[bucket]!) unsorted.add(bucket);
      else ends[bucket] = xv;
    }
    this.low = low;
    this.high = high;
    this.#settle(unsorted, to);
  }

  /** Sorts the buckets out of x order, stably (ties keep the data's order), and records the table's state. */
  #settle(unsorted: Set<number>, length: number) {
    const { rows, x, low, high } = this;
    for (const b of unsorted) {
      const start = this.starts[b]!;
      const sorted = Array.from(rows.subarray(start, start + this.counts[b]!));
      rows.set(
        sorted.sort((p, q) => x[p]! - x[q]!),
        start,
      );
    }
    const table = this.#table;
    this.length = length;
    this.version = table.version;
    this.modified = table.modifiedVersion;
    this.generation = table.generation;
    this.offset = table.rowOffset;
    this.xDomain = this.#fields.xDomain ?? (low <= high ? [low, high] : undefined);
  }

  /** Reads x, y, and the key field's arrays as they are now; a dictionary only grows while appends extend. */
  #read() {
    const table = this.#table;
    const { key, category, x, y } = this.#fields;
    this.x = table.numbers(x as never);
    this.y = table.numbers(y as never);
    if (!category) {
      this.#numbers = table.numbers(key as never);
      return;
    }
    const { codes, dictionary } = table.categories(key as never);
    this.#codes = codes;
    this.#dictionary = dictionary;
    if (this.#byCode.length >= dictionary.length) return;
    const byCode = new Int32Array(Math.max(dictionary.length, this.#byCode.length * 2)).fill(NONE);
    byCode.set(this.#byCode);
    this.#byCode = byCode;
  }

  /** Row `i`'s bucket, made for a key not seen before; NONE for a row without a key. */
  #bucket(i: number): number {
    const codes = this.#codes;
    if (!codes) {
      const value = this.#numbers![i]!;
      return Number.isFinite(value) ? (this.keys.get(value) ?? this.#add(value)) : NONE;
    }
    const code = codes[i]!;
    if (code < 0) return NONE;
    let bucket = this.#byCode[code]!;
    if (bucket === NONE) {
      // Labels look up once each: tables with dictionaries of their own match by label.
      const label = this.#dictionary[code]!;
      bucket = this.keys.get(label) ?? this.#add(label);
      this.#byCode[code] = bucket;
    }
    return bucket;
  }

  #add(key: string | number): number {
    const bucket = this.#buckets++;
    if (bucket === this.starts.length) {
      const size = bucket * 2;
      this.starts = widened(this.starts, size);
      this.counts = widened(this.counts, size);
      this.caps = widened(this.caps, size);
      this.values = widened(this.values, size);
      this.ends = widened(this.ends, size);
    }
    this.ends[bucket] = Number.NEGATIVE_INFINITY;
    this.keys.set(key, bucket);
    return bucket;
  }

  /** Gives bucket `b` room: at the array's end, or for every bucket once the array is full. */
  #grow(b: number) {
    const count = this.counts[b]!;
    const cap = room(count);
    if (this.#end + cap > this.rows.length) {
      this.#layout();
      return;
    }
    const start = this.starts[b]!;
    this.rows.copyWithin(this.#end, start, start + count);
    this.starts[b] = this.#end;
    this.caps[b] = cap;
    this.#end += cap;
  }

  /** Lays every bucket out again with room, and an eighth more for buckets to move into. */
  #layout() {
    let total = 0;
    for (let b = 0; b < this.#buckets; b++) total += room(this.counts[b]!);
    const rows = new Uint32Array(total + (total >> 3));
    let at = 0;
    for (let b = 0; b < this.#buckets; b++) {
      const start = this.starts[b]!;
      const count = this.counts[b]!;
      rows.set(this.rows.subarray(start, start + count), at);
      this.starts[b] = at;
      this.caps[b] = room(count);
      at += this.caps[b]!;
    }
    this.rows = rows;
    this.#end = at;
  }
}

function widened<A extends Uint32Array | Float64Array>(array: A, length: number): A {
  const next = new (array.constructor as new (length: number) => A)(length);
  next.set(array);
  return next;
}
