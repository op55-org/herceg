// How copies of one data object name its rows. A source row is named,
// wherever it travels, by its history's data id, a generation, and an
// ordinal: the history's one owner (its allocator) numbers each logical
// append once, and every copy (a widget's table, a fragment's, a stream's)
// applies numbered mutations and maps its own rows to those ordinals through
// its numbering. Plain data and functions over it, with no table values:
// page sharing and the update applier build on it.
// python/src/herceg/_numbering.py is the same contract in Python, and
// test/contracts/fixtures/sessions.json holds the cases both answer.

import { bisect } from "./bisect.ts";

/** The largest ordinal: JavaScript's largest safe integer, which float64 buffers carry exactly. */
export const MAX_ORDINAL = Number.MAX_SAFE_INTEGER;

/**
 * An opaque name of one history of observations: copies with one data id
 * number rows alike, and exactly one owner allocates its generations and
 * ordinals. Python's are `<snapshot digest>@<process allocator>`; an id an
 * application gives is its promise that one owner extends it.
 */
export type DataId = string;

/** One source observation, wherever it travels. Ordinals are JS-safe integers, unique in a generation. */
export interface SourceRow {
  readonly data: DataId;
  readonly generation: number;
  readonly ordinal: number;
}

/** Rows of one history, packed: the metadata once, the ordinals as a buffer, never an object per row. */
export interface SourceRows {
  readonly data: DataId;
  readonly generation: number;
  readonly ordinals: Float64Array;
}

/**
 * How a copy's rows map to its history's ordinals in one generation (the
 * history's, which a table's own `generation` need not equal):
 * - `offset`: one run, the row at position p numbered `first + p`;
 * - `runs`: where other copies' appends left gaps, triples of a local
 *   identity (`Table.identity`), the ordinal it has, and how many rows
 *   from it are numbered on, in ascending identities;
 * - `ordinals`: each row's ordinal, by position, once runs would take more
 *   room than that.
 * A copy holds its rows' numbering in the form `settled` picks, so copies
 * with the same rows and the same past hold the same form.
 */
export type Numbering =
  | { readonly generation: number; readonly kind: "offset"; readonly first: number }
  | { readonly generation: number; readonly kind: "runs"; readonly runs: Float64Array }
  | { readonly generation: number; readonly kind: "ordinals"; readonly ordinals: Float64Array };

/** What numbering reads of a copy: no values, just how many rows and where its identities start. */
export interface NumberedRows {
  readonly numbering: Numbering;
  /** The identity of the row at position 0 (`Table.rowOffset`), which runs are keyed from. */
  readonly rowOffset: number;
  readonly length: number;
}

/**
 * What a copy knows of how its generation was allocated, compared where
 * copies of one data id meet: copies that differ in either name different
 * histories by one id.
 */
export interface Allocation {
  /** The rows the generation began with, before `maxRows` dropped any; unknown when absent. */
  readonly base?: number;
  /** The allocator that numbered rows past the base, or the reset that began the generation. */
  readonly extendedBy?: string;
}

/** A copy of a history's rows, as the update applier stages mutations on it. */
export interface Copy extends NumberedRows {
  readonly allocation: Allocation;
  /** The owner's count of this copy's mutations: each one it is sent carries the count after it. */
  readonly revision: number;
  /** The table's own `maxRows`, applied with every append's. */
  readonly maxRows: number;
}

/**
 * A numbered mutation of one copy, with the rows' count where the update
 * envelope carries their columns. Each carries the copy's revision after
 * it; drops come only from an append's `maxRows`.
 */
export type Mutation =
  | {
      readonly op: "append";
      /** The ordinal of the batch's first row; the rest follow, every row `maxRows` drops included. */
      readonly first: number;
      readonly count: number;
      readonly maxRows?: number;
      readonly revision: number;
    }
  | {
      readonly op: "replace";
      readonly start: number;
      readonly count: number;
      readonly revision: number;
    }
  | {
      readonly op: "reset";
      /** Newer than the copy's; not necessarily the next. Its rows are numbered from 0. */
      readonly generation: number;
      readonly count: number;
      readonly revision: number;
    };

/**
 * A numbering as specs and snapshots carry it beside a root columns entry:
 * its first row's ordinal (rows numbered on) or a float64 buffer of each
 * row's, and the allocation facts a copy compares with others.
 */
export interface NumberingSpec {
  /** @default 0 */
  generation?: number;
  /** @default 0 */
  ordinals?: number | { buffer: number };
  base?: number;
  extendedBy?: string;
}

/** `length` rows numbered on from `first`. */
export function numberedRows(
  generation: number,
  first: number,
  length: number,
  rowOffset = 0,
): NumberedRows {
  return {
    numbering: { generation, kind: "offset", first: length > 0 ? first : 0 },
    rowOffset,
    length,
  };
}

/** Rows whose ordinals, by position, are `ordinals`, in the form `settled` picks for rows with no past. */
export function rowsOf(
  generation: number,
  ordinals: ArrayLike<number>,
  rowOffset = 0,
): NumberedRows {
  const runs: number[] = [];
  for (let position = 0; position < ordinals.length; position++)
    extend(runs, rowOffset + position, ordinals[position]!, 1);
  return settled(generation, rowOffset, ordinals.length, runs);
}

/** The rows a numbering spec gives `length` rows, and their allocation facts; `buffer` reads a float64 buffer. */
export function fromSpec(
  spec: NumberingSpec | undefined,
  length: number,
  buffer: (index: number) => Float64Array,
): { rows: NumberedRows; allocation: Allocation } {
  const generation = spec?.generation ?? 0;
  const given = spec?.ordinals ?? 0;
  const rows =
    typeof given === "number"
      ? numberedRows(generation, given, length)
      : rowsOf(generation, buffer(given.buffer));
  const allocation: Allocation = {
    ...(spec?.base === undefined ? {} : { base: spec.base }),
    ...(spec?.extendedBy === undefined ? {} : { extendedBy: spec.extendedBy }),
  };
  return { rows, allocation };
}

/** The ordinal of the row at `position`, or NaN for no row there (as `Table.identity`). */
export function ordinalAt(rows: NumberedRows, position: number): number {
  if (!(Number.isInteger(position) && position >= 0 && position < rows.length)) return Number.NaN;
  const numbering = rows.numbering;
  if (numbering.kind === "offset") return numbering.first + position;
  if (numbering.kind === "ordinals") return numbering.ordinals[position]!;
  const runs = numbering.runs;
  const identity = rows.rowOffset + position;
  // The last run starting at or before the identity holds it.
  const run = bisect(runs.length / 3, (k) => runs[3 * k]! <= identity) - 1;
  // Differences first: an ordinal plus an identity may pass 2^53 and round.
  return runs[3 * run + 1]! + (identity - runs[3 * run]!);
}

/** Where the row numbered `ordinal` is, or -1 when the copy holds none. */
export function positionOf(rows: NumberedRows, ordinal: number): number {
  const numbering = rows.numbering;
  if (numbering.kind === "offset") {
    const position = ordinal - numbering.first;
    return Number.isInteger(position) && position >= 0 && position < rows.length ? position : -1;
  }
  if (numbering.kind === "ordinals") return numbering.ordinals.indexOf(ordinal);
  const runs = numbering.runs;
  for (let k = 0; k < runs.length; k += 3) {
    const from = runs[k + 1]!;
    if (ordinal >= from && ordinal < from + runs[k + 2]! && Number.isInteger(ordinal))
      return runs[k]! - rows.rowOffset + (ordinal - from);
  }
  return -1;
}

/** Every row's ordinal, by position. */
export function ordinalsAt(rows: NumberedRows): Float64Array {
  const numbering = rows.numbering;
  if (numbering.kind === "ordinals") return numbering.ordinals.slice();
  const out = new Float64Array(rows.length);
  if (numbering.kind === "offset")
    for (let p = 0; p < out.length; p++) out[p] = numbering.first + p;
  else {
    const runs = numbering.runs;
    for (let k = 0; k < runs.length; k += 3) {
      const at = runs[k]! - rows.rowOffset;
      for (let i = 0; i < runs[k + 2]!; i++) out[at + i] = runs[k + 1]! + i;
    }
  }
  return out;
}

/** The ordinals a copy holds as ranges: (first, count) pairs, ascending, those that touch joined. */
export function heldRanges(rows: NumberedRows): Float64Array {
  const runs = runsOf(rows);
  const pairs: [number, number][] = [];
  for (let k = 0; k < runs.length; k += 3) pairs.push([runs[k + 1]!, runs[k + 2]!]);
  pairs.sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [first, count] of pairs) {
    const last = out.length - 2;
    if (last >= 0 && out[last]! + out[last + 1]! === first) out[last + 1]! += count;
    else out.push(first, count);
  }
  return Float64Array.from(out);
}

/**
 * The positions, from `from` on and ascending, of the copy's rows whose
 * ordinals are among `ordinals` (ascending and distinct, as channel values
 * hold them): a selection's rows in this copy, or of rows just appended.
 */
export function selectedPositions(
  rows: NumberedRows,
  ordinals: Float64Array,
  from = 0,
): Uint32Array {
  const out: number[] = [];
  const numbering = rows.numbering;
  if (numbering.kind === "ordinals") {
    for (let p = from; p < rows.length; p++) {
      const ordinal = numbering.ordinals[p]!;
      const at = lowerBound(ordinals, ordinal);
      if (ordinals[at] === ordinal) out.push(p);
    }
    return Uint32Array.from(out);
  }
  const runs = runsOf(rows);
  for (let k = 0; k < runs.length; k += 3) {
    const start = runs[k]! - rows.rowOffset;
    const count = runs[k + 2]!;
    const skip = Math.max(0, from - start);
    if (skip >= count) continue;
    const low = runs[k + 1]! + skip;
    const high = runs[k + 1]! + count;
    for (let at = lowerBound(ordinals, low); at < ordinals.length && ordinals[at]! < high; at++)
      out.push(start + (ordinals[at]! - runs[k + 1]!));
  }
  return Uint32Array.from(out);
}

/** The ordinals of the rows at `positions`, ascending and distinct: what a channel value holds of them. */
export function ordinalsOf(rows: NumberedRows, positions: ArrayLike<number>): Float64Array {
  const ordinals = Float64Array.from(positions, (position) => ordinalAt(rows, position));
  if (ordinals.some(Number.isNaN))
    throw new RangeError(`ordinalsOf positions: some are not rows of the copy's ${rows.length}`);
  ordinals.sort();
  return distinct(ordinals);
}

/**
 * The rows after an append of `count` rows numbered from `first`, keeping
 * at most `limit` rows: rows past it leave from the first, batch rows
 * included, as a table's `maxRows` drops them. Unchecked: see `stage`.
 */
export function appended(
  rows: NumberedRows,
  first: number,
  count: number,
  limit = Number.POSITIVE_INFINITY,
): NumberedRows {
  const runs = Array.from(runsOf(rows));
  extend(runs, rows.rowOffset + rows.length, first, count);
  const length = rows.length + count;
  const excess = Math.max(0, length - limit);
  return settled(
    rows.numbering.generation,
    rows.rowOffset + excess,
    length - excess,
    trimmed(runs, rows.rowOffset + excess),
    rows.numbering.kind,
  );
}

/** The rows after dropping the first `count` (all of them when `count` passes the length). */
export function dropped(rows: NumberedRows, count: number): NumberedRows {
  const drop = Math.min(count, rows.length);
  const rowOffset = rows.rowOffset + drop;
  return settled(
    rows.numbering.generation,
    rowOffset,
    rows.length - drop,
    trimmed(Array.from(runsOf(rows)), rowOffset),
    rows.numbering.kind,
  );
}

/** The bytes a numbering keeps: 24 a run, 8 a row of an ordinals column, none for an offset. */
export function numberingBytes(numbering: Numbering): number {
  if (numbering.kind === "offset") return 0;
  return numbering.kind === "runs" ? numbering.runs.byteLength : numbering.ordinals.byteLength;
}

/**
 * The copy after `mutations`, applied in order, each checked first: the
 * update applier's staging, which writes nothing, so a refused mutation
 * leaves `copy` as it was (it is never changed). Mutations come from one
 * owner, `allocator`, which numbered the appends and resets. Refusals are
 * RangeErrors located at `at(index, mutation)`.
 */
export function stage(
  copy: Copy,
  mutations: readonly Mutation[],
  options: { allocator?: string; at?: (index: number, mutation: Mutation) => string } = {},
): Copy {
  const at = options.at ?? ((index, mutation) => `operations[${index}] ${mutation.op}`);
  let staged = copy;
  mutations.forEach((mutation, index) => {
    staged = applied(staged, mutation, at(index, mutation), options.allocator);
  });
  return staged;
}

/**
 * Which allocation fact two copies of one data id and generation disagree
 * on, if any: the rows the generation began with, or the allocator that
 * extended it. A fact one copy does not know is not compared.
 */
export function disagreement(
  a: Allocation,
  b: Allocation,
):
  | { readonly fact: "base"; readonly values: readonly [number, number] }
  | { readonly fact: "allocator"; readonly values: readonly [string, string] }
  | undefined {
  if (a.base !== undefined && b.base !== undefined && a.base !== b.base)
    return { fact: "base", values: [a.base, b.base] };
  if (a.extendedBy !== undefined && b.extendedBy !== undefined && a.extendedBy !== b.extendedBy)
    return { fact: "allocator", values: [a.extendedBy, b.extendedBy] };
  return undefined;
}

/** One mutation checked and applied. */
function applied(copy: Copy, mutation: Mutation, at: string, allocator: string | undefined): Copy {
  const generation = copy.numbering.generation;
  if (mutation.revision !== copy.revision + 1)
    throw new RangeError(
      `${at} revision: ${shown(mutation.revision)} does not follow this copy's revision ${shown(copy.revision)}, so it missed a mutation; load the snapshot again`,
    );
  const revision = mutation.revision;
  if (mutation.op === "replace") {
    const { start, count } = mutation;
    wholeNumber(start, at, "start");
    wholeNumber(count, at, "count");
    if (start + count > copy.length)
      throw new RangeError(
        `${at}: ${range("rows", start, Math.max(count, 1))} ${count > 1 ? "pass" : "passes"} this copy's ${shown(copy.length)} rows; replace rows the copy holds`,
      );
    return { ...copy, revision };
  }
  if (mutation.op === "reset") {
    const { count } = mutation;
    if (!(Number.isSafeInteger(mutation.generation) && mutation.generation > generation))
      throw new RangeError(
        `${at} generation: ${shown(mutation.generation)} is not newer than this copy's generation ${shown(generation)}; reset to a newer generation, which the history's owner gives`,
      );
    wholeNumber(count, at, "count");
    const kept = Math.min(count, copy.maxRows);
    const rows = numberedRows(mutation.generation, count - kept, kept, count - kept);
    const allocation = {
      base: count,
      ...(allocator === undefined ? {} : { extendedBy: allocator }),
    };
    return { ...copy, ...rows, allocation, revision };
  }
  const { first, count, maxRows } = mutation;
  wholeNumber(first, at, "first");
  wholeNumber(count, at, "count");
  if (maxRows !== undefined && !(Number.isSafeInteger(maxRows) && maxRows > 0))
    throw new RangeError(`${at} maxRows: expected a positive whole number; received ${maxRows}`);
  const limit = Math.min(copy.maxRows, maxRows ?? Number.POSITIVE_INFINITY);
  if (count === 0) return { ...copy, ...dropped(copy, Math.max(0, copy.length - limit)), revision };
  // Past 2^53 sums round, so the room left is compared, which is exact.
  if (count - 1 > MAX_ORDINAL - first)
    throw new RangeError(
      `${at}: ${range("ordinals", first, count)} pass the largest safe integer (${shown(MAX_ORDINAL)}); reset the table to start a new generation`,
    );
  const held = heldRanges(copy);
  // The first range ending past `first` is the one that may overlap.
  const near = bisect(held.length / 2, (k) => held[2 * k]! + held[2 * k + 1]! <= first);
  if (near < held.length / 2 && held[2 * near]! < first + count)
    throw new RangeError(
      `${at}: ${range("ordinals", first, count)} ${count > 1 ? "overlap" : "overlaps"} ${range("ordinals", held[2 * near]!, held[2 * near + 1]!)}, which this copy holds in generation ${shown(generation)}; give each history one owner, which numbers each append once`,
    );
  const extendedBy = copy.allocation.extendedBy;
  if (allocator !== undefined && extendedBy !== undefined && allocator !== extendedBy)
    throw new RangeError(
      `${at}: numbered by allocator "${allocator}", but "${extendedBy}" extended this copy's generation ${shown(generation)}; give each history one owner, which numbers each append once`,
    );
  const allocation =
    allocator === undefined || extendedBy !== undefined
      ? copy.allocation
      : { ...copy.allocation, extendedBy: allocator };
  return { ...copy, ...appended(copy, first, count, limit), allocation, revision };
}

/** A copy's numbering as runs: triples of an identity, its ordinal, and a count. */
function runsOf(rows: NumberedRows): Float64Array | number[] {
  const numbering = rows.numbering;
  if (numbering.kind === "runs") return numbering.runs;
  if (numbering.kind === "offset")
    return rows.length > 0 ? [rows.rowOffset, numbering.first, rows.length] : [];
  const runs: number[] = [];
  const ordinals = numbering.ordinals;
  for (let position = 0; position < ordinals.length; position++)
    extend(runs, rows.rowOffset + position, ordinals[position]!, 1);
  return runs;
}

/** Adds `count` rows from `identity` numbered from `ordinal`, joining the last run where both follow on. */
function extend(runs: number[], identity: number, ordinal: number, count: number) {
  if (count === 0) return;
  const last = runs.length - 3;
  if (
    last >= 0 &&
    runs[last]! + runs[last + 2]! === identity &&
    runs[last + 1]! + runs[last + 2]! === ordinal
  )
    runs[last + 2]! += count;
  else runs.push(identity, ordinal, count);
}

/** Runs without the identities before `from`. */
function trimmed(runs: number[], from: number): number[] {
  let k = 0;
  while (k < runs.length && runs[k]! + runs[k + 2]! <= from) k += 3;
  const out = runs.slice(k);
  if (out.length > 0 && out[0]! < from) {
    const cut = from - out[0]!;
    out[0] = from;
    out[1]! += cut;
    out[2]! -= cut;
  }
  return out;
}

/**
 * The numbering of rows given as runs, in its form: one run is an offset;
 * runs while there are at most a third as many as rows (24 bytes a run
 * against 8 a row); past that, an ordinals column. A copy holding a column
 * goes back to runs only at a sixth, so one near the line does not convert
 * on every batch.
 */
function settled(
  generation: number,
  rowOffset: number,
  length: number,
  runs: number[],
  before?: Numbering["kind"],
): NumberedRows {
  const count = runs.length / 3;
  if (count <= 1) return numberedRows(generation, count ? runs[1]! : 0, length, rowOffset);
  const column = before === "ordinals" ? 6 * count > length : 3 * count > length;
  if (!column)
    return {
      numbering: { generation, kind: "runs", runs: Float64Array.from(runs) },
      rowOffset,
      length,
    };
  const ordinals = new Float64Array(length);
  for (let k = 0; k < runs.length; k += 3) {
    const at = runs[k]! - rowOffset;
    for (let i = 0; i < runs[k + 2]!; i++) ordinals[at + i] = runs[k + 1]! + i;
  }
  return { numbering: { generation, kind: "ordinals", ordinals }, rowOffset, length };
}

function wholeNumber(value: number, at: string, name: string) {
  if (!(Number.isSafeInteger(value) && value >= 0))
    throw new RangeError(`${at} ${name}: expected a whole number of 0 or more; received ${value}`);
}

/** "ordinals 1,000 to 1,009", or "ordinal 1,000" for one. */
function range(noun: string, first: number, count: number): string {
  return count === 1
    ? `${noun.slice(0, -1)} ${shown(first)}`
    : `${noun} ${shown(first)} to ${shown(first + (count - 1))}`;
}

function shown(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString("en-US") : String(value);
}

/** The values of an ascending array, each once. */
function distinct(values: Float64Array): Float64Array {
  let n = 0;
  for (let i = 0; i < values.length; i++)
    if (i === 0 || values[i] !== values[n - 1]) values[n++] = values[i]!;
  return values.subarray(0, n);
}

function lowerBound(values: Float64Array, target: number): number {
  return bisect(values.length, (i) => values[i]! < target);
}
