// Style runs: a line's or area's looks changing along a series, where its
// channels read rows (a field other than the series', a condition, an
// identity scale). A piece of line takes the look of the observation it
// arrives at, and a step's flat run the look of the observation whose value
// it holds (run-paths.ts draws them so). Runs are kept as where each ends
// and its look, interned by content; nothing is kept per row, and as a
// table appends rows only the new rows are read.

import type { MarkRows } from "../../data/row-view.ts";
import type { Table } from "../../data/table.ts";
import type { Dash } from "../../spec/spec.ts";
import type { Series } from "../series.ts";
import type { RowReader } from "./channels.ts";

/** What a run draws in: its channels' outputs, as they give them (colors not yet read). */
export interface Look {
  /** The primary paint: a line's stroke, an area's fill. */
  readonly color?: string | undefined;
  /** An area's outline. */
  readonly stroke?: string | undefined;
  readonly dash?: Dash | undefined;
  readonly strokeWidth?: number | undefined;
  readonly opacity?: number | undefined;
}

/** A channel read by rows: which part of a look it gives, and its rows for the table's version. */
export interface RunPart {
  readonly name: keyof Look;
  read(table: Table): RowReader<unknown>;
}

/** A series' runs: the position each ends at (its last observation) and its look. */
export interface Runs {
  readonly count: number;
  readonly ends: readonly number[];
  readonly looks: readonly number[];
}

/**
 * Runs as read so far, ending at row identities (`rowOffset + row`) where
 * a series' rows ascend, else at positions, and what they were read with.
 */
interface Kept {
  generation: number;
  modified: number;
  subset: string | undefined;
  /** The series' rows, whose order bands can change while the subset stays. */
  order: Uint32Array | undefined;
  key: object | undefined;
  /** The last row read. */
  last: number;
  ends: number[];
  looks: number[];
}

/**
 * Which of its table's rows a mark draws, for caches that read on as the
 * table appends: undefined for every row; else the rows' revision, which
 * changes whenever they may (a view's, a provider's), so such caches read
 * them again rather than on from the table.
 */
export function subset(rows: MarkRows): string | undefined {
  return rows.positions ? rows.revision : undefined;
}

/** The runs of a mark's series, and their looks. */
export class StyleRuns {
  readonly #table: Table;
  readonly #parts: readonly RunPart[];
  /** The rows the mark draws (marks/rows.ts). */
  readonly #rows: () => MarkRows;
  /** Whether a series' rows ascend in the table, so appended rows extend it (not in band order). */
  readonly #ascending: boolean;
  /**
   * Looks by index, their indexes by content, and how many kept runs take
   * each: those no run takes go as they pile up (`#compact`).
   */
  #looks: Look[] = [];
  #interned = new Map<string, number>();
  #takers: number[] = [];
  #taken = 0;
  #read:
    | {
        version: number;
        key: object | undefined;
        readers: RowReader<unknown>[];
        /** Looks by their parts' values, a level per part. */
        of: Tree;
      }
    | undefined;
  /** Runs by series key, as asked for at the table's version, and at the version before. */
  #kept = new Map<string, Kept>();
  #before = new Map<string, Kept>();
  #version = -1;

  constructor(table: Table, parts: readonly RunPart[], rows: () => MarkRows, ascending: boolean) {
    this.#table = table;
    this.#parts = parts;
    this.#rows = rows;
    this.#ascending = ascending;
  }

  /** Look `index`. */
  look(index: number): Look {
    return this.#looks[index]!;
  }

  /**
   * A series' runs, for the table's current version; `key` is what the
   * looks' outputs were read with (the theme, whose palette they take).
   */
  of(s: Series, key: object | undefined): Runs {
    const table = this.#table;
    const offset = table.rowOffset;
    const drawn = subset(this.#rows());
    // Series no longer asked for, as a rolling window drops them, go.
    if (this.#version !== table.version) {
      for (const [series, gone] of this.#before)
        if (this.#kept.get(series) !== gone) for (const look of gone.looks) this.#release(look);
      [this.#before, this.#kept, this.#version] = [this.#kept, new Map(), table.version];
      if (this.#looks.length > Math.max(LOOKS, 2 * this.#taken)) this.#compact();
    }
    // Rows a view or provider gives may come in any order: read whole, by
    // position, and kept while they and their order are unchanged (new
    // rows are new ones; another mark's bands can reorder them).
    const ascending = this.#ascending && drawn === undefined;
    let kept = this.#kept.get(s.key) ?? this.#before.get(s.key);
    if (
      !kept ||
      (!ascending && drawn === undefined) ||
      kept.generation !== table.generation ||
      kept.modified !== table.modifiedVersion ||
      kept.subset !== drawn ||
      (!ascending && kept.order !== s.rows) ||
      kept.key !== key
    ) {
      if (kept) for (const look of kept.looks) this.#release(look);
      this.#before.delete(s.key);
      kept = {
        generation: table.generation,
        modified: table.modifiedVersion,
        subset: drawn,
        order: s.rows,
        key,
        last: -1,
        ends: [],
        looks: [],
      };
    }
    this.#kept.set(s.key, kept);
    // Runs of rows the table dropped go.
    let dropped = 0;
    while (ascending && dropped < kept.ends.length && kept.ends[dropped]! < offset) dropped++;
    if (dropped > 0) {
      kept.ends.splice(0, dropped);
      for (const look of kept.looks.splice(0, dropped)) this.#release(look);
    }
    const lookOf = this.#lookOf(key);
    const from = ascending ? firstAfter(s, kept.last - offset) : kept.last < 0 ? 0 : s.length;
    for (let k = from; k < s.length; k++) {
      const row = s.rows ? s.rows[k]! : k;
      const look = lookOf(row);
      const end = ascending ? offset + row : k;
      const last = kept.looks.length - 1;
      if (last >= 0 && kept.looks[last] === look) kept.ends[last] = end;
      else {
        kept.ends.push(end);
        kept.looks.push(look);
        this.#takers[look] = (this.#takers[look] ?? 0) + 1;
        if (this.#takers[look] === 1) this.#taken++;
      }
      kept.last = offset + row;
    }
    // Where each run ends among the series' positions now.
    const ends = ascending ? kept.ends.map((id) => this.#positionOf(s, id - offset)) : kept.ends;
    return { count: ends.length, ends, looks: kept.looks };
  }

  /** The position of row `row` in `s` (its rows ascend), or of the last before it. */
  #positionOf(s: Series, row: number): number {
    return Math.max(0, firstAfter(s, row) - 1);
  }

  /** A kept run of look `look` went. */
  #release(look: number): void {
    if (--this.#takers[look]! === 0) this.#taken--;
  }

  /** Keeps the looks runs take, renumbered, so streams of ever new looks hold no more than they show. */
  #compact(): void {
    const renumbered: number[] = [];
    const looks: Look[] = [];
    const takers: number[] = [];
    this.#looks.forEach((look, old) => {
      if (!this.#takers[old]) return;
      renumbered[old] = looks.push(look) - 1;
      takers.push(this.#takers[old]!);
    });
    // A series' runs may be kept under both versions.
    for (const kept of new Set([...this.#kept.values(), ...this.#before.values()]))
      kept.looks.forEach((old, j) => {
        kept.looks[j] = renumbered[old]!;
      });
    this.#looks = looks;
    this.#takers = takers;
    this.#interned = new Map(looks.map((look, i) => [JSON.stringify(look), i]));
    this.#read = undefined;
  }

  /** Each row's look, for the table's version: an index into the looks. */
  #lookOf(key: object | undefined): (row: number) => number {
    const table = this.#table;
    if (this.#read?.version !== table.version || this.#read.key !== key)
      this.#read = {
        version: table.version,
        key,
        readers: this.#parts.map((part) => part.read(table)),
        of: new Map(),
      };
    const { readers, of } = this.#read;
    const parts = this.#parts;
    const last = readers.length - 1;
    return (row) => {
      // Rows of equal parts' values share a look.
      let node = of;
      for (let i = 0; i < last; i++) {
        const at = readers[i]!.at(row);
        node = (node.get(at) as Tree | undefined) ?? (node.set(at, new Map()).get(at) as Tree);
      }
      const at = readers[last]!.at(row);
      let look = node.get(at) as number | undefined;
      if (look === undefined) {
        const values: Record<string, unknown> = {};
        readers.forEach((reader, i) => {
          const value = reader.output(row);
          if (value !== undefined) values[parts[i]!.name] = value;
        });
        const content = JSON.stringify(values);
        look = this.#interned.get(content);
        if (look === undefined) {
          look = this.#looks.push(values as Look) - 1;
          this.#interned.set(content, look);
        }
        node.set(at, look);
      }
      return look;
    };
  }
}

/** Looks by parts' values: a level per part, looks' indexes at the last. */
type Tree = Map<number, Tree | number>;

/** Looks a mark's runs keep before those no run takes are let go. */
const LOOKS = 256;

/** The first position of `s` (its rows ascending) past row `row`. */
export function firstAfter(s: Series, row: number): number {
  if (!s.rows) return Math.min(s.length, Math.max(0, row + 1));
  let [lo, hi] = [0, s.length];
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (s.rows[mid]! <= row) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
