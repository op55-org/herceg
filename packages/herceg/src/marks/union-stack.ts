// Stacked areas from long data: the series a field splits rows into,
// stacked on the union of their x positions, and kept current as their
// table streams. Areas of several fields sharing rows stack row by row
// (RowStack in stack.ts) instead.

import type { NumericArray } from "../data/column.ts";
import type { MovingRows } from "../data/ordered.ts";
import { lowerBound, type Table, upperBound } from "../data/table.ts";
import { MinMaxIndex, type RangeIndex } from "../lod/minmax-index.ts";
import type { AreaStack, StackGaps, StackOrder, StackSupport } from "../spec/spec.ts";
import type { MarkRows } from "./rows.ts";
import type { LayerEdges } from "./series.ts";
import { capacityFor, makeRoom, shrunk } from "./stack.ts";
import { offsetLayers } from "./stack-offset.ts";
import { INDEXED_POINTS } from "./trace.ts";

/** One series of the stack: its rows (ascending table positions) and whether it is shown. */
export interface StackLayer {
  readonly name: string;
  readonly rows: Uint32Array;
  readonly shown: boolean;
}

/** The stack as of one table version: views valid until the next update. */
export interface UnionLayers {
  /**
   * Each row's stacked top and bottom, by table position, where the row's
   * layer is drawn at it; NaN for rows of hidden layers and rows without x.
   */
  tops: Float64Array;
  bases: Float64Array;
  totals?: Float64Array | undefined;
  /** Each layer's edges, aligned on the shown layers' x; undefined for hidden layers. */
  edges: (LayerEdges | undefined)[];
}

/**
 * Which rows of a layer are drawn and which neighbors connect, as a mark's
 * `continuity` says (marks/features/continuity.ts).
 */
export interface Connections {
  drawn(row: number): boolean;
  joins(a: number, xa: number, b: number, xb: number): boolean;
}

/** What layers count as where they have no row (`gaps`), where the stack stands, and which rows connect. */
export interface StackRules {
  gaps: StackGaps;
  support: StackSupport;
  continuity?: Connections | undefined;
}

/**
 * What a stack reads of its table: where its rows are, and what changed,
 * with where an ordered table moved rows.
 */
type Rows = Pick<Table, "rowOffset" | "length" | "version" | "modifiedVersion" | "generation"> &
  Partial<MovingRows>;

/** What stacks follow of a view's rows, one per answer: rows the stack takes anew. */
const answers = new WeakMap<MarkRows, Rows>();

/** A view's rows in table order as stacks follow them: its table's changes, generations by query. */
interface Followed {
  readonly rows: Rows;
  query: number;
  table: number;
  generation: number;
}

/** What stacks follow of views' rows in table order, by view. */
const followed = new WeakMap<object, Followed>();

/** The rows stacks follow of `view`, a view of `table` in table order. */
function followedRows(view: object, table: Table, query: number): Followed {
  const moving = table as Partial<MovingRows>;
  const state: Followed = {
    rows: {
      get rowOffset() {
        return table.rowOffset;
      },
      get length() {
        return table.length;
      },
      get version() {
        return table.version;
      },
      get modifiedVersion() {
        return table.modifiedVersion;
      },
      get generation() {
        return state.generation;
      },
      changedFrom: (version) => moving.changedFrom?.(version),
    },
    query,
    table: table.generation,
    generation: 0,
  };
  followed.set(view, state);
  return state;
}

/**
 * What a stack of a mark's rows follows: their table; for a view whose
 * rows are in table order (no sort), the table's changes, in a generation
 * a new query, restriction, or reset ends; for a sorted view's rows, a
 * state of their own, so the stack is made again whenever they change, as
 * a table of those rows would be.
 */
export function stackedRows(rows: MarkRows): Rows {
  const { view, table } = rows;
  if (!view) return table;
  if (!view.query.sort?.length) {
    const state = followed.get(view) ?? followedRows(view, table as Table, view.queryRevision);
    if (state.query !== view.queryRevision || state.table !== table.generation) {
      state.query = view.queryRevision;
      state.table = table.generation;
      state.generation++;
    }
    return state.rows;
  }
  let state = answers.get(rows);
  if (!state) {
    state = {
      rowOffset: 0,
      length: rows.table.length,
      version: 0,
      modifiedVersion: 0,
      generation: 0,
    };
    answers.set(rows, state);
  }
  return state;
}

/**
 * Shown layers stacked on every x any of them has a row at, in layer order
 * (the first at the bottom). A layer without a row at such an x counts as
 * zero there, or with "interpolate" as the straight line between its rows
 * on either side (zero beyond its ends); a missing value draws nothing and
 * counts as zero above, as in stacks of fields. Several rows of a layer at
 * one x pair up with the others' by occurrence: the stack has as many
 * positions at that x as the layer with the most rows there, and a layer
 * with fewer holds its last one. Layers whose x does not ascend (or is
 * missing at some row) are stacked through their rows sorted by x.
 *
 * The stack has no support (its edges are missing in every layer) where a
 * layer's run of connected rows breaks (between rows its `continuity`
 * does not connect, and at rows it leaves out), and with "intersection"
 * support before a layer's first row and after its last. Where a layer's
 * run ends at one position and another starts at the next, an entry with
 * missing edges follows the first, at its x: drawing, inspection, and
 * extents read the gap as they read missing values.
 *
 * As the table streams, appended rows restack the positions from where
 * they change the stack (their first x, or their layer's previous last x
 * with "interpolate", "intersection", or `continuity`) to the end, and rows a rolling window drops
 * restack the positions up to the first x their layers keep; positions in
 * between stay. Anything else (values replaced in place, a reset, layers
 * shown, hidden, or added, rows out of order, or both ends overlapping)
 * stacks every row again. Positions live in buffers laid out like table
 * columns, and long stacks keep min/max indexes of their edges.
 */
export class UnionStack {
  #table: Rows | undefined;
  #version = -1;
  #modified = -1;
  #generation = -1;
  #signature = "";
  #places: object | undefined;
  #rules: StackRules = { gaps: "zero", support: "union" };
  readonly #mode: AreaStack;
  readonly #order: StackOrder;
  #layerOrder: number[] = [];

  constructor(mode: AreaStack = true, order: StackOrder = "input") {
    this.#mode = mode;
    this.#order = order;
  }

  get #shifted(): boolean {
    return this.#mode !== true || this.#order !== "input";
  }
  /** Every shown layer's rows ascend in x, with every x present: changes can restack in part. */
  #direct = false;
  /**
   * Per shown layer whose rows do not ascend in x: its rows in x order,
   * which it stacked through, kept for pickers until the next build.
   */
  #sorted: (Uint32Array | undefined)[] = [];
  /** Row identities of the live rows at the last update: from `#offset` up to `#end`. */
  #offset = 0;
  #end = 0;
  /** Per shown layer: its first row's identity, at the last update. */
  #first = new Float64Array(0);

  /** Union x, layer tops, and bases (ordinary stacks omit the first); fill adds totals. */
  #buffers: Float64Array[] = [];
  #shown = 0;
  #start = 0;
  #length = 0;
  #topIndexes: MinMaxIndex[] | undefined;
  #bottomIndexes: MinMaxIndex[] | undefined;

  /** Each row's top and bottom, by row identity: live rows at `[#rowStart, #rowStart + length)`. */
  #rowTops: Float64Array = new Float64Array(0);
  #rowBases: Float64Array = new Float64Array(0);
  #rowTotals: Float64Array | undefined;
  #rowStart = 0;

  /** Merge scratch, per shown layer. */
  #cursor = new Int32Array(0);
  #stop = new Int32Array(0);
  #count = new Int32Array(0);

  /**
   * The stack of `layers` (in stacking order) over `x` and `y`, the table's
   * columns, as of its current version.
   */
  update(
    table: Rows,
    x: NumericArray,
    y: NumericArray,
    layers: readonly StackLayer[],
    rules: StackRules,
    places?: object,
  ): UnionLayers {
    try {
      return this.#update(table, x, y, layers, rules, places);
    } catch (error) {
      this.clear();
      throw error;
    }
  }

  #update(
    table: Rows,
    x: NumericArray,
    y: NumericArray,
    layers: readonly StackLayer[],
    rules: StackRules,
    places?: object,
  ): UnionLayers {
    const signature = JSON.stringify([
      rules.gaps,
      rules.support,
      layers.map(({ name, shown }) => [name, shown]),
    ]);
    const shown = layers.filter((layer) => layer.shown).map((layer) => layer.rows);
    // The first row identity that is not a row stacked before: past the
    // last, or where an ordered table moved rows since; -1 when unknown.
    let changed = this.#end;
    if (this.#modified !== table.modifiedVersion) {
      const from = table.changedFrom?.(this.#version);
      changed = from === undefined ? -1 : Math.min(changed, table.rowOffset + from);
    }
    const current =
      this.#table === table &&
      this.#signature === signature &&
      this.#places === places &&
      this.#rules.continuity === rules.continuity &&
      this.#generation === table.generation &&
      changed >= 0;
    // Layers stacked in a sorted order of their own restack whenever rows change.
    if (
      !current ||
      (this.#version !== table.version &&
        !(
          this.#direct &&
          this.#mode !== "wiggle" &&
          this.#order === "input" &&
          this.#follow(table, x, y, shown, changed)
        ))
    )
      this.#rebuild(table, x, y, shown, signature, rules);
    this.#places = places;
    return this.#output(table, layers);
  }

  /** Bytes the stack's buffers hold: its edges, its rows' tops and bases, and indexes not counted. */
  get byteLength(): number {
    let bytes =
      this.#rowTops.byteLength + this.#rowBases.byteLength + (this.#rowTotals?.byteLength ?? 0);
    for (const buffer of this.#buffers) bytes += buffer.byteLength;
    return bytes;
  }

  /** Lets go of every buffer; the next update stacks every row again. */
  clear(): void {
    if (!this.#table) return;
    this.#table = undefined;
    this.#buffers = [];
    this.#sorted = [];
    this.#rowTops = new Float64Array(0);
    this.#rowBases = new Float64Array(0);
    this.#rowTotals = undefined;
    this.#topIndexes = undefined;
    this.#bottomIndexes = undefined;
    this.#length = 0;
  }

  #rebuild(
    table: Rows,
    x: NumericArray,
    y: NumericArray,
    shown: readonly Uint32Array[],
    signature: string,
    rules: StackRules,
  ) {
    // The same layers stack again in the buffers they had, when those fit,
    // so stacks whose values change every tick do not allocate every tick.
    // Others (another chart's hidden series, say) get new ones: a chart
    // sharing the mark still reads the old.
    const reuse = this.#table === table && this.#signature === signature;
    this.#table = table;
    this.#signature = signature;
    this.#rules = rules;
    this.#shown = shown.length;
    this.#sorted = shown.map((rows) => (ascends(x, rows) ? undefined : sortedByX(x, rows)));
    this.#direct = this.#sorted.every((order) => order === undefined);
    const orders = shown.map((rows, l) => this.#sorted[l] ?? rows);
    const length = table.length;
    if (!reuse || !fits(this.#rowTops.length, length)) {
      this.#rowTops = new Float64Array(capacityFor(length));
      this.#rowBases = new Float64Array(this.#rowTops.length);
      this.#rowTotals = this.#mode === "fill" ? new Float64Array(this.#rowTops.length) : undefined;
    }
    this.#rowTops.fill(Number.NaN, 0, length);
    this.#rowBases.fill(Number.NaN, 0, length);
    this.#rowTotals?.fill(Number.NaN, 0, length);
    this.#rowStart = 0;
    this.#stackAll(x, y, orders, reuse);
    this.#remember(table, shown);
  }

  /**
   * `layers` stacked from scratch, for facet panels, whose rows do not
   * stream as a group's do: their rows' tops and bases are written into
   * `tops` and `bases` (by table position), which panels of disjoint rows
   * share, and nothing is kept for a next update.
   */
  static once(
    x: NumericArray,
    y: NumericArray,
    layers: readonly StackLayer[],
    rules: StackRules,
    tops: Float64Array,
    bases: Float64Array,
    mode: AreaStack = true,
    order: StackOrder = "input",
    totals?: Float64Array,
  ): (LayerEdges | undefined)[] {
    const stack = new UnionStack(mode, order);
    stack.#rules = rules;
    stack.#rowTops = tops;
    stack.#rowBases = bases;
    stack.#rowTotals = totals;
    const shown = layers.filter((layer) => layer.shown).map(({ rows }) => rows);
    stack.#sorted = shown.map((rows) => (ascends(x, rows) ? undefined : sortedByX(x, rows)));
    stack.#stackAll(
      x,
      y,
      shown.map((rows, l) => stack.#sorted[l] ?? rows),
    );
    return stack.#edges(layers, false);
  }

  /**
   * Stacks every position of layers whose rows in x order are `orders`: in
   * new buffers, or with `reuse` in the old ones if they fit.
   */
  #stackAll(x: NumericArray, y: NumericArray, orders: readonly Uint32Array[], reuse = false) {
    this.#shown = orders.length;
    // The stack has at least as many positions as its longest layer has rows.
    const longest = Math.max(0, ...orders.map((order) => order.length));
    const buffers = Math.max(
      1,
      2 * this.#shown + Number(this.#shifted) + Number(this.#mode === "fill"),
    );
    if (!reuse || this.#buffers.length !== buffers || this.#buffers[0]!.length < longest) {
      const capacity = capacityFor(longest);
      this.#buffers = Array.from({ length: buffers }, () => new Float64Array(capacity));
    }
    this.#start = 0;
    this.#length = 0;
    this.#topIndexes = undefined;
    this.#bottomIndexes = undefined;
    this.#length = this.#merge(x, y, orders, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY);
    // Buffers kept from before give back what the union no longer needs.
    const smaller = shrunk(this.#buffers, 0, this.#length);
    if (smaller) this.#buffers = smaller;
  }

  /**
   * Brings the stack up to date with rows appended and dropped since the
   * last update, restacking only the positions they change; false when it
   * cannot, and every row must be stacked again.
   */
  #follow(
    table: Rows,
    x: NumericArray,
    y: NumericArray,
    shown: readonly Uint32Array[],
    changed: number,
  ): boolean {
    const offset = table.rowOffset;
    const end = offset + table.length;
    // Identities only move forward, and some rows from before must remain.
    if (offset < this.#offset || end < this.#end || offset >= changed) return false;
    const { gaps, support, continuity } = this.#rules;
    // Rows reach back to their layer's previous last x where they bridge the positions since.
    const back = gaps === "interpolate" || support === "intersection" || continuity !== undefined;
    // Positions from `from` on change with appended rows; up to `until`, with dropped ones.
    let from = Number.POSITIVE_INFINITY;
    let until = Number.NEGATIVE_INFINITY;
    for (const [l, rows] of shown.entries()) {
      // Each layer's rows from the first changed on, ascending from the last before.
      const first = lowerBound(rows, changed - offset);
      if (first === 0) return false;
      let previous = x[rows[first - 1]!]!;
      for (let k = first; k < rows.length; k++) {
        const value = x[rows[k]!]!;
        if (!(value >= previous && Number.isFinite(value))) return false;
        previous = value;
      }
      if (first < rows.length) from = Math.min(from, x[rows[back ? first - 1 : first]!]!);
      if (this.#first[l]! < offset) until = Math.max(until, x[rows[0]!]!);
    }
    if (until >= from) return false;
    this.#followRows(offset - this.#offset, changed - offset, table.length);
    if (until > Number.NEGATIVE_INFINITY && !this.#restackHead(x, y, shown, until)) return false;
    if (from < Number.POSITIVE_INFINITY) this.#restackTail(x, y, shown, from);
    this.#remember(table, shown);
    return true;
  }

  /**
   * Drops `dropped` rows from the front of the row buffers, keeps the
   * `kept` after them, and makes room up to `length`, unstacked.
   */
  #followRows(dropped: number, kept: number, length: number) {
    this.#rowStart += dropped;
    const buffers = [this.#rowTops, this.#rowBases, ...(this.#rowTotals ? [this.#rowTotals] : [])];
    const room =
      shrunk(buffers, this.#rowStart, kept, length - kept) ??
      makeRoom(buffers, this.#rowStart, kept, length - kept);
    if (room) {
      this.#rowTops = room[0]!;
      this.#rowBases = room[1]!;
      if (this.#rowTotals) this.#rowTotals = room[2]!;
      this.#rowStart = 0;
    }
    this.#rowTops.fill(Number.NaN, this.#rowStart + kept, this.#rowStart + length);
    this.#rowBases.fill(Number.NaN, this.#rowStart + kept, this.#rowStart + length);
    this.#rowTotals?.fill(Number.NaN, this.#rowStart + kept, this.#rowStart + length);
  }

  /**
   * Restacks the positions up to x `until` (inclusive), which rows dropped
   * from the front changed: they are as many or fewer now, and end where
   * the old ones did.
   */
  #restackHead(
    x: NumericArray,
    y: NumericArray,
    shown: readonly Uint32Array[],
    until: number,
  ): boolean {
    const before = upperBound(this.#buffers[0]!, until, this.#start, this.#start + this.#length);
    const old = before - this.#start;
    // A long head costs about what stacking every row does.
    if (old * 2 > this.#length) return false;
    const end = this.#length;
    const count = this.#merge(x, y, shown, Number.NEGATIVE_INFINITY, until);
    if (count > old) return false;
    // Written past the live positions: moved to end where the old head did.
    const start = this.#start;
    const to = start + old - count;
    for (const buffer of this.#buffers) buffer.copyWithin(to, start + end, start + end + count);
    this.#start = to;
    this.#length = end - (old - count);
    this.#reindex(to, to + count);
    const smaller = shrunk(this.#buffers, this.#start, this.#length);
    if (smaller) this.#moved(smaller);
    return true;
  }

  /** Restacks the positions from x `from` (inclusive) to the end, which appended rows changed. */
  #restackTail(x: NumericArray, y: NumericArray, shown: readonly Uint32Array[], from: number) {
    const cut = lowerBound(this.#buffers[0]!, from, this.#start, this.#start + this.#length);
    this.#length = cut - this.#start;
    this.#length += this.#merge(x, y, shown, from, Number.POSITIVE_INFINITY);
    this.#reindex(cut, this.#start + this.#length);
  }

  /** Takes buffers the live positions moved into: they start at 0, and indexes start again. */
  #moved(buffers: Float64Array[]) {
    this.#buffers = buffers;
    this.#start = 0;
    this.#topIndexes = undefined;
    this.#bottomIndexes = undefined;
  }

  /** Brings indexes over the buffers up to date with positions `[from, to)` rewritten. */
  #reindex(from: number, to: number) {
    const end = this.#start + this.#length;
    const shown = this.#shown;
    this.#topIndexes?.forEach((index, l) => {
      const values = this.#buffers[1 + l]!;
      index.update(values, from, to);
      index.extend(values, end);
    });
    this.#bottomIndexes?.forEach((index, l) => {
      const values = this.#buffers[1 + shown + l]!;
      index.update(values, from, to);
      index.extend(values, end);
    });
  }

  #remember(table: Rows, shown: readonly Uint32Array[]) {
    this.#version = table.version;
    this.#modified = table.modifiedVersion;
    this.#generation = table.generation;
    this.#offset = table.rowOffset;
    this.#end = table.rowOffset + table.length;
    if (this.#first.length !== shown.length) this.#first = new Float64Array(shown.length);
    shown.forEach((rows, l) => {
      this.#first[l] = rows.length > 0 ? table.rowOffset + rows[0]! : Number.POSITIVE_INFINITY;
    });
  }

  /**
   * Stacks the positions whose x is in [lo, hi], through each shown
   * layer's rows in x order (`orders`), writing them after the live
   * positions; returns how many it wrote. Rows of those positions get
   * their tops and bases.
   */
  #merge(
    x: NumericArray,
    y: NumericArray,
    orders: readonly Uint32Array[],
    lo: number,
    hi: number,
  ): number {
    const layers = orders.length;
    if (this.#cursor.length < layers) {
      this.#cursor = new Int32Array(layers);
      this.#stop = new Int32Array(layers);
      this.#count = new Int32Array(layers);
    }
    const cursor = this.#cursor;
    const stop = this.#stop;
    const count = this.#count;
    orders.forEach((order, l) => {
      cursor[l] = lo === Number.NEGATIVE_INFINITY ? 0 : rowBound(x, order, lo, false);
      stop[l] = hi === Number.POSITIVE_INFINITY ? order.length : rowBound(x, order, hi, true);
    });
    const { gaps, support, continuity } = this.#rules;
    const interpolate = gaps === "interpolate";
    const shifted = this.#shifted;
    const rowTops = this.#rowTops;
    const rowBases = this.#rowBases;
    const rowStart = this.#rowStart;
    // Entries without support, by place among those written: offsets give
    // them bases, which are taken away again.
    const unsupported: number[] = [];
    let written = 0;
    for (;;) {
      // The next x, and how many rows each layer has there.
      let at = Number.POSITIVE_INFINITY;
      for (let l = 0; l < layers; l++) {
        if (cursor[l]! < stop[l]!) at = Math.min(at, x[orders[l]![cursor[l]!]!]!);
      }
      if (at === Number.POSITIVE_INFINITY) break;
      let occurrences = 0;
      // Whether layers without rows here leave support, and whether a layer's run ends here and goes on later.
      let supported = true;
      let ends = false;
      for (let l = 0; l < layers; l++) {
        const order = orders[l]!;
        const first = cursor[l]!;
        let k = first;
        while (k < stop[l]! && x[order[k]!] === at) k++;
        count[l] = k - first;
        occurrences = Math.max(occurrences, count[l]!);
        if (k > first) {
          const next = order[k];
          if (
            continuity &&
            next !== undefined &&
            !continuity.joins(order[k - 1]!, at, next, x[next]!)
          )
            ends = true;
        } else if (first === 0 || first === order.length) {
          if (support === "intersection") supported = false;
        } else if (continuity) {
          const [a, b] = [order[first - 1]!, order[first]!];
          if (!continuity.joins(a, x[a]!, b, x[b]!)) supported = false;
        }
      }
      // An entry per occurrence, a break before one its layer's rows here do not join, and one after.
      this.#reserve(written, 2 * occurrences + 1);
      const buffers = this.#buffers;
      const xs = buffers[0]!;
      let held = false;
      for (let j = 0; j < occurrences; j++) {
        // Each occurrence's rows: every layer's j-th here (a layer with fewer, its last).
        let drawn = supported;
        let broken = false;
        if (continuity && supported)
          for (let l = 0; l < layers; l++) {
            const rows = count[l]!;
            if (rows === 0) continue;
            const r = cursor[l]! + Math.min(j, rows - 1);
            const order = orders[l]!;
            if (!continuity.drawn(order[r]!)) drawn = false;
            else if (j > 0 && j < rows && !continuity.joins(order[r - 1]!, at, order[r]!, at))
              broken = true;
          }
        if (broken && held && drawn) {
          if (shifted) unsupported.push(written);
          this.#blank(this.#start + this.#length + written++, at, layers);
        }
        held = drawn;
        if (!drawn && shifted) unsupported.push(written);
        const w = written++;
        const p = this.#start + this.#length + w;
        xs[p] = at;
        let total = 0;
        for (let l = 0; l < layers; l++) {
          const order = orders[l]!;
          const rows = count[l]!;
          let row = -1;
          let value = 0;
          if (rows > 0) {
            // A layer with fewer rows here holds its last.
            row = order[cursor[l]! + Math.min(j, rows - 1)]!;
            value = y[row]!;
          } else if (interpolate && drawn) {
            value = between(x, y, order, cursor[l]!, at);
          }
          const base = drawn ? total : Number.NaN;
          let top = Number.NaN;
          if (drawn && Number.isFinite(value)) {
            if (!shifted) total += value;
            top = shifted ? value : total;
          }
          buffers[1 + l]![p] = top;
          if (shifted) buffers[1 + layers + l]![p] = 0;
          else if (l > 0) buffers[layers + l]![p] = base;
          if (j < rows) {
            // Shifted stacks read their rows' edges from this entry once offsets are made.
            rowTops[rowStart + row] = shifted ? w : top;
            rowBases[rowStart + row] = base;
          }
        }
      }
      if (held && ends) {
        if (shifted) unsupported.push(written);
        this.#blank(this.#start + this.#length + written++, at, layers);
      }
      for (let l = 0; l < layers; l++) cursor[l]! += count[l]!;
    }
    if (shifted && written > 0) {
      const start = this.#start + this.#length;
      const view = (buffer: Float64Array) => buffer.subarray(start, start + written);
      this.#layerOrder = offsetLayers(
        this.#buffers.slice(1, 1 + layers).map(view),
        this.#buffers.slice(1 + layers, 1 + 2 * layers).map(view),
        this.#mode,
        this.#order,
        view(this.#buffers[0]!),
        this.#mode === "fill" ? view(this.#buffers[1 + 2 * layers]!) : undefined,
      );
      for (const j of unsupported)
        for (let l = 0; l < layers; l++) this.#buffers[1 + layers + l]![start + j] = Number.NaN;
      // Map the aligned boundaries back to observed rows, from the entries
      // their tops held. Synthetic positions stay in the edges and never
      // become tooltip rows.
      for (let l = 0; l < layers; l++) {
        const rows = orders[l]!;
        for (let k = rowBound(x, rows, lo, false); k < rows.length; k++) {
          const row = rows[k]!;
          if (x[row]! > hi) break;
          const p = start + rowTops[rowStart + row]!;
          rowTops[rowStart + row] = this.#buffers[1 + l]![p]!;
          rowBases[rowStart + row] = this.#buffers[1 + layers + l]![p]!;
          if (this.#rowTotals) this.#rowTotals[rowStart + row] = this.#buffers[1 + 2 * layers]![p]!;
        }
      }
    }
    return written;
  }

  /** Writes a break at `p`: an entry at x `at` with missing edges in every layer. */
  #blank(p: number, at: number, layers: number) {
    const buffers = this.#buffers;
    buffers[0]![p] = at;
    for (let l = 0; l < layers; l++) {
      buffers[1 + l]![p] = Number.NaN;
      if (this.#shifted) buffers[1 + layers + l]![p] = 0;
      else if (l > 0) buffers[layers + l]![p] = Number.NaN;
    }
  }

  /** Makes room for `count` positions after the live ones and the `written` past them. */
  #reserve(written: number, count: number) {
    const room = makeRoom(this.#buffers, this.#start, this.#length + written, count);
    if (room) this.#moved(room);
  }

  #output(table: Rows, layers: readonly StackLayer[]): UnionLayers {
    const rows = (buffer: Float64Array) =>
      buffer.subarray(this.#rowStart, this.#rowStart + table.length);
    return {
      tops: rows(this.#rowTops),
      bases: rows(this.#rowBases),
      totals: this.#rowTotals && rows(this.#rowTotals),
      edges: this.#edges(layers, true),
    };
  }

  /** Each layer's edges, with indexes of long stacks when `indexed`. */
  #edges(layers: readonly StackLayer[], indexed: boolean): (LayerEdges | undefined)[] {
    const start = this.#start;
    const end = start + this.#length;
    const shown = this.#shown;
    const view = (buffer: Float64Array) => buffer.subarray(start, end);
    if (indexed) indexed = this.#indexes();
    const x = view(this.#buffers[0]!);
    let l = 0;
    return layers.map((layer): LayerEdges | undefined => {
      if (!layer.shown) return undefined;
      const top = this.#buffers[1 + l]!;
      const bottom = this.#shifted
        ? this.#buffers[1 + shown + l]!
        : l > 0
          ? this.#buffers[shown + l]!
          : undefined;
      const indexes = indexed
        ? {
            top: this.#view(this.#topIndexes![l]!, top),
            bottom: bottom && this.#view(this.#bottomIndexes![this.#shifted ? l : l - 1]!, bottom),
          }
        : undefined;
      const order = this.#layerOrder.indexOf(l);
      const positionOrder = this.#sorted[l];
      l++;
      return { order, x, top: view(top), bottom: bottom && view(bottom), indexes, positionOrder };
    });
  }

  /** Whether the stack keeps indexes now; builds them when it first does. */
  #indexes(): boolean {
    if (this.#length < INDEXED_POINTS) {
      this.#topIndexes = undefined;
      this.#bottomIndexes = undefined;
      return false;
    }
    const end = this.#start + this.#length;
    const shown = this.#shown;
    this.#topIndexes ??= this.#buffers
      .slice(1, 1 + shown)
      .map((buffer) => new MinMaxIndex(buffer, end));
    this.#bottomIndexes ??= this.#buffers
      .slice(1 + shown, 2 * shown + Number(this.#shifted))
      .map((buffer) => new MinMaxIndex(buffer, end));
    return true;
  }

  /** An index over a whole buffer, answering by live position instead of buffer position. */
  #view(index: MinMaxIndex, buffer: Float64Array): RangeIndex {
    const start = this.#start;
    return {
      length: this.#length,
      gapShare: index.gapShare,
      query: (_values, from, to, out) => {
        index.query(buffer, start + from, start + to, out);
        if (out.low >= 0) out.low -= start;
        if (out.high >= 0) out.high -= start;
        return out;
      },
    };
  }
}

/**
 * A layer's value at x `at`, where it has no row, on the straight line
 * between its last row before (`order[next - 1]`) and its first after
 * (`order[next]`); zero beyond its first and last rows. A missing value
 * at either end leaves it missing.
 */
function between(
  x: NumericArray,
  y: NumericArray,
  order: Uint32Array,
  next: number,
  at: number,
): number {
  if (next <= 0 || next >= order.length) return 0;
  const a = order[next - 1]!;
  const b = order[next]!;
  let from = at - x[a]!;
  let span = x[b]! - x[a]!;
  // Halves, exactly, where the span of finite ends overflows.
  if (span === Number.POSITIVE_INFINITY) [from, span] = [at / 2 - x[a]! / 2, x[b]! / 2 - x[a]! / 2];
  // Weighted ends rather than their difference, which large values overflow.
  const t = from / span;
  return y[a]! * (1 - t) + y[b]! * t;
}

/** The first position in `order` whose x is at least `value` (past it, with `after`). */
function rowBound(x: NumericArray, order: Uint32Array, value: number, after: boolean): number {
  let lo = 0;
  let hi = order.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const at = x[order[mid]!]!;
    if (at < value || (after && at === value)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Whether buffers of `capacity` suit `length` entries: room enough, and not four times too much. */
function fits(capacity: number, length: number): boolean {
  return capacity >= length && capacity <= 4 * capacityFor(length);
}

/** Whether x is finite and never decreases over `rows`. */
function ascends(x: NumericArray, rows: Uint32Array): boolean {
  let previous = Number.NEGATIVE_INFINITY;
  for (let k = 0; k < rows.length; k++) {
    const value = x[rows[k]!]!;
    if (!(value >= previous && Number.isFinite(value))) return false;
    previous = value;
  }
  return true;
}

/**
 * The rows with a finite x, sorted by x, ties in the order given: a
 * view's rows keep its order, which need not be the table's.
 */
function sortedByX(x: NumericArray, rows: Uint32Array): Uint32Array {
  const kept = rows.filter((row) => Number.isFinite(x[row]!));
  const order = Uint32Array.from(kept.keys());
  order.sort((i, j) => x[kept[i]!]! - x[kept[j]!]! || i - j);
  return order.map((k) => kept[k]!);
}
