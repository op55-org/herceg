// The rows a producer following its source's front drops (groups.ts,
// totals.ts) dropped, as a reader of its contributors (contributors.ts)
// asked it to keep them: by then the table holds them no more, and counts
// that took them in (model/coverage.ts) take them away by what is kept
// here. Readers make the log and give it to the producer, so producers
// whose contributors no one reads carry none of it.

/**
 * The rows a producer dropped from the front of its table, most recent
 * last, by slot (`rowOffset` plus the position each had): the target each
 * fed and its values of the fields the producer reads. A ring of at most
 * `capacity` rows; older ones are forgotten, and a reader needing them
 * rebuilds.
 */
export class RemovalLog {
  readonly capacity: number;
  /** Slots `#first` to `#end` are kept, slot `s` at `(#head + s - #first) % capacity`. */
  #first = 0;
  #end = 0;
  #head = 0;
  readonly #targets: Int32Array;
  readonly #values: Float64Array[];

  constructor(fields: number, capacity: number) {
    this.capacity = capacity;
    this.#targets = new Int32Array(capacity);
    this.#values = Array.from({ length: fields }, () => new Float64Array(capacity));
  }

  get byteLength(): number {
    return this.#targets.byteLength + 8 * this.capacity * this.#values.length;
  }

  /**
   * Remembers the row dropped at `slot`: the target it fed and its value of
   * each field, `values[k][index]`. Slots run on from the last one; a gap
   * (after a reset) forgets what was kept.
   */
  push(slot: number, target: number, values: readonly ArrayLike<number>[], index: number): void {
    if (slot !== this.#end) this.#first = this.#end = slot;
    const length = this.#end - this.#first;
    const at = (this.#head + length) % this.capacity;
    if (length === this.capacity) {
      this.#first++;
      this.#head = (this.#head + 1) % this.capacity;
    }
    this.#targets[at] = target;
    const kept = this.#values;
    for (let k = 0; k < kept.length; k++) kept[k]![at] = values[k]![index]!;
    this.#end++;
  }

  /** Where the row dropped at `slot` is kept, or -1. */
  find(slot: number): number {
    if (slot < this.#first || slot >= this.#end) return -1;
    return (this.#head + slot - this.#first) % this.capacity;
  }

  /** The target the row kept at `at` fed. */
  target(at: number): number {
    return this.#targets[at]!;
  }

  /** Its value of field `k`. */
  value(at: number, k: number): number {
    return this.#values[k]![at]!;
  }

  /** Forgets every row: what is dropped next starts over. */
  clear(): void {
    this.#first = this.#end = this.#head = 0;
  }
}

/** Rows a removal log keeps for a table of `length` rows: a sixteenth, and at least 4,096. */
export function removalRoom(length: number): number {
  return Math.max(4096, Math.ceil(length / 16));
}

/** Whether a table drops rows from its front: it keeps at most `maxRows`, or has dropped some. */
export function dropsRows(table: {
  readonly maxRows: number;
  readonly rowOffset: number;
}): boolean {
  return table.maxRows !== Number.POSITIVE_INFINITY || table.rowOffset > 0;
}
