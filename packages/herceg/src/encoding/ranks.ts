// Rank tests (`{ top: n, field }`, `{ bottom: n, field }`): a condition
// holding for the rows whose value of a number or time field is among the n
// largest (smallest) of the rows a mark draws, before facets and the
// legend's hiding, as channel scales find their domains. Values tied with
// the nth are in; missing and infinite values never are. What is kept is
// the n rows' identities, a heap with the nth first: as a table whose rows
// the mark draws whole appends rows, only theirs are read (O(batch × log
// n)); a dropped row among the n, a view's rows, values replaced, or a
// reset read every row again (O(rows × log n)).

import type { MarkRows } from "../data/row-view.ts";
import type { Table } from "../data/table.ts";
import { nextRevision } from "./channel-scales.ts";

export class Rank {
  readonly field: string;
  readonly count: number;
  readonly top: boolean;
  /** Changes whenever the nth value does, so caches of looks read through the test read again. */
  revision = 0;
  readonly #rows: () => MarkRows;
  /** Row identities (`rowOffset + row`) of the n values kept: a heap, the nth (the worst kept) first. */
  #heap: number[] = [];
  #table: Table | undefined;
  #values: ArrayLike<number> = [];
  #offset = 0;
  #nth = Number.NaN;
  /**
   * What was read: the table's version, generation, and replaced values,
   * the rows' revision, whether they were the table's every row, and the
   * last row identity.
   */
  #read:
    | {
        version: number;
        generation: number;
        modified: number;
        revision: string;
        whole: boolean;
        offset: number;
        last: number;
      }
    | undefined;

  constructor(rows: () => MarkRows, field: string, count: number, top: boolean) {
    this.#rows = rows;
    this.field = field;
    this.count = count;
    this.top = top;
  }

  /**
   * Whether row `row` of the table's current rows holds a value among the
   * n. The chart brings the test up to date before it draws (`update`);
   * rows read after the table changed bring it up to date first.
   */
  holds(row: number): boolean {
    if (!this.#read || this.#table!.version !== this.#read.version) this.update();
    const value = this.#values[row]!;
    const nth = this.#nth;
    return this.top ? value >= nth && value < Infinity : value <= nth && value > -Infinity;
  }

  /** Brings the nth value up to date with the rows the mark draws. */
  update(): void {
    const rows = this.#rows();
    const { table, positions } = rows;
    const read = this.#read;
    if (read?.version === table.version && read.revision === rows.revision) return;
    const values = table.numbers(this.field as never);
    const offset = table.rowOffset;
    this.#table = table;
    this.#values = values;
    this.#offset = offset;
    const heap = this.#heap;
    // Appends (and drops of rows none of the n is) to rows that were the
    // table's every row leave the n kept among them.
    const appended =
      !positions &&
      read?.whole === true &&
      read.generation === table.generation &&
      read.modified === table.modifiedVersion &&
      (read.offset === offset || heap.every((id) => id >= offset));
    if (appended) {
      for (let id = Math.max(read.last + 1, offset); id < offset + table.length; id++)
        this.#offer(id);
    } else {
      heap.length = 0;
      const count = positions ? positions.length : table.length;
      for (let k = 0; k < count; k++) this.#offer(offset + (positions ? positions[k]! : k));
    }
    this.#read = {
      version: table.version,
      generation: table.generation,
      modified: table.modifiedVersion,
      revision: rows.revision,
      whole: !positions,
      offset,
      last: offset + table.length - 1,
    };
    const nth = heap.length > 0 ? this.#value(heap[0]!) : Number.NaN;
    if (!Object.is(nth, this.#nth)) {
      this.#nth = nth;
      this.revision = nextRevision();
    }
  }

  #value(id: number): number {
    return this.#values[id - this.#offset]!;
  }

  /** Whether the value of row `a` ranks below row `b`'s (smaller for top, larger for bottom). */
  #below(a: number, b: number): boolean {
    return this.top ? this.#value(a) < this.#value(b) : this.#value(a) > this.#value(b);
  }

  /** Keeps row `id` among the n where its value is finite and ranks above the nth's. */
  #offer(id: number): void {
    if (!Number.isFinite(this.#value(id))) return;
    const heap = this.#heap;
    if (heap.length < this.count) {
      // Up from the end.
      let at = heap.push(id) - 1;
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (!this.#below(id, heap[parent]!)) break;
        heap[at] = heap[parent]!;
        at = parent;
      }
      heap[at] = id;
      return;
    }
    if (!this.#below(heap[0]!, id)) return;
    // Down from the top, in place of the nth.
    let at = 0;
    for (;;) {
      const left = 2 * at + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child = right < heap.length && this.#below(heap[right]!, heap[left]!) ? right : left;
      if (!this.#below(heap[child]!, id)) break;
      heap[at] = heap[child]!;
      at = child;
    }
    heap[at] = id;
  }
}
