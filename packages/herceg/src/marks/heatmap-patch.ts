// What follows a heatmap's changes, loaded on the first one it sees
// (heatmap-updates.ts): the cells kept between table versions and how a
// change patches them rather than placing every cell again (the cells
// along each number or time axis, the index of rows by cell, each cell's
// value with its rows combined), the image repainted where they changed
// (heatmap-image-patch.ts), and selections counted in cells by what changed
// (cell-counts.ts). Each patch gives what a rebuild of the same rows would,
// bit for bit: cells are placed by the same code from the same distinct
// values, the index keeps the order its stable sort gives, and a changed
// cell is reduced again from its rows in their order, never by
// subtracting. A change of more than an eighth of the rows, insertions,
// and resets rebuild. What changed is kept as the cells it touched, for
// the image to repaint only those.

import { type Changes, changesSince } from "../data/changes.ts";
import type { NumericArray } from "../data/column.ts";
import type { Table, untold } from "../data/table.ts";
import type { CellIndex } from "../lod/cell-index.ts";
import type { CellReduce } from "../spec/spec.ts";
import type { CombinedCells, combine, crowdedIn, reduceRun } from "./heatmap.ts";
import type { AxisCells, cellsAt } from "./heatmap-cells.ts";
import type { paint } from "./heatmap-raster.ts";
import type { heatmapWork } from "./heatmap-updates.ts";

export { cellCounts } from "./cell-counts.ts";
export { axisPixels, patchImage } from "./heatmap-image-patch.ts";
export { changesSince };

/**
 * The heatmap modules' code patching uses, handed over by heatmap.ts
 * rather than imported: a bundler splitting code puts what a lazily loaded
 * module imports from modules every page reaches into those pages' first
 * chunk, though only heatmaps use it.
 */
export interface HeatmapKit {
  readonly CellIndex: typeof CellIndex;
  readonly cellsAt: typeof cellsAt;
  readonly combine: typeof combine;
  readonly crowdedIn: typeof crowdedIn;
  readonly reduceRun: typeof reduceRun;
  readonly paint: typeof paint;
  readonly untold: typeof untold;
  readonly work: typeof heatmapWork;
}

/** Changed rows past this share of the rows rebuild instead. */
const MOST = 1 / 8;

/** Rows each cell along an axis holds: a row with a finite value of its field is in one. */
export function countCells(cells: AxisCells): Uint32Array {
  const counts = new Uint32Array(cells.length);
  for (const c of cells.cells) if (c >= 0) counts[c]!++;
  return counts;
}

/** The index of `value` among ascending distinct `values`, or -1. */
function indexIn(values: Float64Array, value: number): number {
  let [lo, hi] = [0, values.length];
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo < values.length && values[lo] === value ? lo : -1;
}

/**
 * The cells along a number or time axis (`placeCells`', without breaks)
 * after `change`, from those placed before it and their `counts` of rows:
 * the rows that left and those whose `field` was updated leave their
 * cells, the rows that came and those updated join theirs, cells left with
 * no row go, and new values add cells where they sort. The cells are then
 * placed from the distinct values as `placeCells` places them, so they
 * equal a rebuild's. Undefined, to place the column again, past an eighth
 * of the rows or for insertions and resets.
 */
export function patchAxis(
  kit: HeatmapKit,
  before: AxisCells,
  counts: Uint32Array,
  column: NumericArray,
  change: Changes,
  field: string,
  step: number | undefined,
  time: boolean,
  name: string,
): { cells: AxisCells; counts: Uint32Array } | undefined {
  const n = column.length;
  const { dropped, appended } = change;
  const kept = n - appended;
  const old = before.cells;
  if (change.reset || change.inserted || before.breaks || old.length - dropped !== kept)
    return undefined;
  const spans = spansOf(change, kept, [field]);
  let moved = appended;
  for (let i = 0; i < spans.length; i += 2) moved += spans[i + 1]! - spans[i]!;
  if (dropped + moved > n * MOST) return undefined;
  const left = counts.slice();
  const leave = (k: number) => {
    const c = old[k]!;
    if (c >= 0) left[c]!--;
  };
  for (let k = 0; k < dropped; k++) leave(k);
  for (let i = 0; i < spans.length; i += 2)
    for (let p = spans[i]!; p < spans[i + 1]!; p++) leave(p + dropped);
  // Values that came: each row's, and those no cell has.
  const values = before.values;
  const fresh: number[] = [];
  const arrive = (p: number) => {
    // As `distinct` reads them: zero of either sign is one value.
    const v = column[p]! + 0;
    if (!Number.isFinite(v)) return;
    const c = indexIn(values, v);
    if (c >= 0) left[c]!++;
    else fresh.push(v);
  };
  for (let i = 0; i < spans.length; i += 2)
    for (let p = spans[i]!; p < spans[i + 1]!; p++) arrive(p);
  for (let p = kept; p < n; p++) arrive(p);
  fresh.sort((a, b) => a - b);
  // The distinct values now, ascending: the cells kept, merged with those that came.
  const remap = new Int32Array(values.length).fill(-1);
  const next: number[] = [];
  /** Cells now of values no cell had before. */
  const added: number[] = [];
  for (let c = 0, f = 0; c < values.length || f < fresh.length; ) {
    const v = c < values.length ? values[c]! : Number.POSITIVE_INFINITY;
    const w = f < fresh.length ? fresh[f]! : Number.POSITIVE_INFINITY;
    if (w < v) {
      added.push(next.length);
      next.push(w);
      while (f < fresh.length && fresh[f] === w) f++;
    } else {
      if (left[c]! > 0) {
        remap[c] = next.length;
        next.push(v);
      }
      c++;
    }
  }
  const distinctValues = Float64Array.from(next);
  const cells = new Int32Array(n);
  const tally = new Uint32Array(distinctValues.length);
  for (let c = 0; c < values.length; c++) if (remap[c]! >= 0) tally[remap[c]!] = left[c]!;
  const isNew = new Uint8Array(distinctValues.length);
  for (const c of added) isNew[c] = 1;
  // Rows kept keep their cells, renumbered. When the values kept stay in
  // one run, as when a window slides on, that is a copy and a subtraction
  // (a row whose value left was updated, and is placed below).
  let shift = Number.NaN;
  for (let c = 0; c < remap.length; c++) {
    if (remap[c]! < 0) continue;
    if (Number.isNaN(shift)) shift = c - remap[c]!;
    else if (c - remap[c]! !== shift) {
      shift = Number.NaN;
      break;
    }
  }
  cells.set(old.subarray(dropped, dropped + kept));
  if (Number.isNaN(shift))
    for (let p = 0; p < kept; p++) {
      const c = cells[p]!;
      if (c >= 0) cells[p] = remap[c]!;
    }
  else if (shift !== 0) for (let p = 0; p < kept; p++) if (cells[p]! >= 0) cells[p]! -= shift;
  // Rows that came or moved, found among the values now; cells new to them counted.
  const place = (p: number) => {
    const v = column[p]! + 0;
    const c = Number.isFinite(v) ? indexIn(distinctValues, v) : -1;
    cells[p] = c;
    if (c >= 0 && isNew[c]) tally[c]!++;
  };
  for (let i = 0; i < spans.length; i += 2)
    for (let p = spans[i]!; p < spans[i + 1]!; p++) place(p);
  for (let p = kept; p < n; p++) place(p);
  kit.work.axesPatched++;
  return { cells: kit.cellsAt(distinctValues, cells, step, time, undefined, name), counts: tally };
}

/**
 * The spans of rows there before `change` that it updated, of `fields`
 * (any field without them), as positions now: merged, ascending, as
 * [start, end) pairs.
 */
export function spansOf(change: Changes, kept: number, fields?: readonly string[]): number[] {
  const spans = change.spans
    .filter((span) => !fields || span.fields.some((field) => fields.includes(field)))
    .map(({ start, end }) => [start, Math.min(end, kept)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const out: number[] = [];
  for (const [start, end] of spans) {
    const last = out.length - 1;
    if (last > 0 && start <= out[last]!) out[last] = Math.max(out[last]!, end);
    else out.push(start, end);
  }
  return out;
}

/** Whether position `p` is in one of `spans` (`spansOf`'). */
function within(spans: readonly number[], p: number): boolean {
  let [lo, hi] = [0, spans.length / 2];
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (spans[mid * 2 + 1]! <= p) lo = mid + 1;
    else hi = mid;
  }
  return lo < spans.length / 2 && spans[lo * 2]! <= p;
}

/** What a series' cells are drawn from: each row's cell along x and y, and the grid they are in. */
export interface CellsLayout {
  /** Each row's cell (or band) along x and y, -1 for none. */
  readonly x: NumericArray;
  readonly y: NumericArray;
  /** The value of each cell along a number or time axis, ascending; undefined along a band axis. */
  readonly xValues: Float64Array | undefined;
  readonly yValues: Float64Array | undefined;
  readonly columns: number;
  readonly lines: number;
  /** The `color` field's values, by row. */
  readonly values: NumericArray;
}

/**
 * A heatmap series' cells as of a table version (a whole table's, in one
 * panel): the index of its rows by cell, the cells with their rows
 * combined, and what changed since the version before.
 */
export interface CellsState extends CellsLayout {
  readonly version: number;
  readonly index: CellIndex;
  readonly cells: CombinedCells;
  /** Cells of more than one row: combined unless none. */
  readonly crowded: number;
  /**
   * The cells changed since version `from` (x and y cell pairs), for an
   * image painted then to repaint; null for every cell, as after a rebuild.
   */
  readonly damage: Int32Array | null;
  readonly from: number;
}

/** The cells of `layout` placed afresh, as of `version`. */
export function buildCells(
  kit: HeatmapKit,
  layout: CellsLayout,
  reduce: CellReduce,
  version: number,
): CellsState {
  const { x, y, values, columns, lines } = layout;
  kit.work.cellsBuilt++;
  const index = new kit.CellIndex(x, y, values, columns, lines);
  const crowded = kit.crowdedIn(index);
  const cells = crowded === 0 ? { values, index } : kit.combine(index, reduce);
  return { ...layout, version, index, cells, crowded, damage: null, from: Number.NaN };
}

/**
 * `before`'s cells after `change` (the table's since its version), drawn
 * from `now`: the rows dropped and appended, and those updated in the
 * fields the mark `read`s, leave and join their cells; with none of the
 * fields `placing` cells updated nor rows moved, rows keep theirs.
 * `ordered`: rows that did not change keep the order of their cells (a
 * band axis with the bands in the same order, any number or time axis).
 * Undefined to build them again.
 */
export function patchCells(
  kit: HeatmapKit,
  before: CellsState,
  now: CellsLayout,
  change: Changes,
  fields: { readonly read: readonly string[]; readonly placing: readonly string[] },
  reduce: CellReduce,
  version: number,
  ordered: boolean,
): CellsState | undefined {
  const n = now.values.length;
  const { dropped, appended } = change;
  const kept = before.values.length - dropped;
  if (!ordered || change.inserted || change.reset || kept < 0 || n - appended !== kept)
    return undefined;
  const { columns, lines } = now;
  if (columns * lines > Number.MAX_SAFE_INTEGER) return undefined;
  const spans = spansOf(change, kept, fields.read);
  // Writes to fields the mark does not read leave its cells as they are.
  if (
    dropped + appended + spans.length === 0 &&
    now.x === before.x &&
    now.y === before.y &&
    now.values === before.values
  )
    return { ...before, version, damage: new Int32Array(0), from: before.version };
  let updated = 0;
  for (let i = 0; i < spans.length; i += 2) updated += spans[i + 1]! - spans[i]!;
  if (dropped + appended + updated > Math.max(n, before.values.length) * MOST) return undefined;
  const old = before.index;
  // Cells touched, in the numbering before and now; each mapped to the other where it is in both.
  const touchedBefore = new Set<number>();
  const touchedNow = new Set<number>();
  const keyBefore = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < before.columns && r < before.lines ? r * before.columns + c : -1;
  const keyNow = (c: number, r: number) =>
    c >= 0 && r >= 0 && c < columns && r < lines ? r * columns + c : -1;
  const across = mapping(before.xValues, now.xValues);
  const down = mapping(before.yValues, now.yValues);
  const touchBefore = (k: number) => {
    const key = keyBefore(before.x[k]!, before.y[k]!);
    if (key < 0) return;
    touchedBefore.add(key);
    const at = keyNow(across.forth(before.x[k]!), down.forth(before.y[k]!));
    if (at >= 0) touchedNow.add(at);
  };
  const touchNow = (p: number) => {
    const key = keyNow(now.x[p]!, now.y[p]!);
    if (key < 0) return;
    touchedNow.add(key);
    const at = keyBefore(across.back(now.x[p]!), down.back(now.y[p]!));
    if (at >= 0) touchedBefore.add(at);
  };
  for (let k = 0; k < dropped; k++) touchBefore(k);
  for (let i = 0; i < spans.length; i += 2)
    for (let p = spans[i]!; p < spans[i + 1]!; p++) {
      touchBefore(p + dropped);
      touchNow(p);
    }
  for (let p = kept; p < n; p++) touchNow(p);
  // Whether a position holds a value in the grid: before, as the index found it; now, by its values.
  const heldBefore = (k: number) => {
    if (keyBefore(before.x[k]!, before.y[k]!) < 0) return false;
    if (!old.order) return k < old.length;
    const [from, to] = old.runOf(before.x[k]!, before.y[k]!);
    let [lo, hi] = [from, to];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (old.order[mid]! < k) lo = mid + 1;
      else hi = mid;
    }
    return lo < to && old.order[lo] === k;
  };
  const holds = (p: number) => keyNow(now.x[p]!, now.y[p]!) >= 0 && Number.isFinite(now.values[p]!);
  // The index: unchanged in order when only values changed and each row
  // changed holds a value as before; else the rows kept, in their order,
  // merged with those that came or changed.
  let same = dropped === 0 && appended === 0 && spansOf(change, kept, fields.placing).length === 0;
  for (let i = 0; same && i < spans.length; i += 2)
    for (let p = spans[i]!; same && p < spans[i + 1]!; p++) same = heldBefore(p) === holds(p);
  let order: Uint32Array | null;
  if (same) order = old.order ?? null;
  else {
    const stay = remaining(old, dropped, (p) => within(spans, p), spans.length > 0);
    const fresh: number[] = [];
    for (let i = 0; i < spans.length; i += 2)
      for (let p = spans[i]!; p < spans[i + 1]!; p++) if (holds(p)) fresh.push(p);
    for (let p = kept; p < n; p++) if (holds(p)) fresh.push(p);
    order = merged(stay, fresh, now.x, now.y);
  }
  const index = new kit.CellIndex(now.x, now.y, now.values, columns, lines, undefined, order);
  // Cells of more than one row, counted again where touched.
  let crowded = before.crowded;
  for (const key of touchedBefore) {
    const [from, to] = old.runOf(key % before.columns, Math.floor(key / before.columns));
    if (to - from > 1) crowded--;
  }
  const runs = new Map<number, [number, number]>();
  for (const key of touchedNow) {
    const run = index.runOf(key % columns, Math.floor(key / columns));
    runs.set(key, run);
    if (run[1] - run[0] > 1) crowded++;
  }
  let cells: CombinedCells;
  if (crowded === 0 && before.crowded === 0) cells = { values: now.values, index };
  else if (crowded === 0 || before.crowded === 0) cells = kit.combine(index, reduce);
  else cells = recombined(kit, before, index, spans, runs, reduce, dropped, kept);
  kit.work.cellsPatched++;
  const damage = new Int32Array(touchedNow.size * 2);
  let d = 0;
  for (const key of touchedNow) {
    damage[d++] = key % columns;
    damage[d++] = Math.floor(key / columns);
  }
  return {
    ...now,
    version,
    index,
    cells,
    crowded,
    damage,
    from: before.version,
  };
}

/**
 * The combined values after a patch: those of the cells untouched, moved
 * by the rows dropped; the cells touched (`runs`, by key, in the index
 * now) reduced again from their rows; and the index of each cell's value.
 */
function recombined(
  kit: HeatmapKit,
  before: CellsState,
  index: CellIndex,
  spans: readonly number[],
  runs: ReadonlyMap<number, readonly [number, number]>,
  reduce: CellReduce,
  dropped: number,
  kept: number,
): CombinedCells {
  const { columns, lines } = index;
  const n = index.x.length;
  const values = new Float64Array(n);
  values.set((before.cells.values as Float64Array).subarray(dropped, dropped + kept));
  values.fill(Number.NaN, kept);
  for (let i = 0; i < spans.length; i += 2) values.fill(Number.NaN, spans[i]!, spans[i + 1]!);
  // Each touched cell's rows lose the value one of them held; its last takes the cell's.
  const fresh: number[] = [];
  for (const [from, to] of runs.values()) {
    for (let i = from; i < to; i++) values[index.positionAt(i)] = Number.NaN;
    if (to === from) continue;
    const value = kit.reduceRun(index, from, to, reduce);
    const last = index.positionAt(to - 1);
    values[last] = value;
    if (Number.isFinite(value)) fresh.push(last);
  }
  // The values' index: one entry a cell, kept where untouched.
  const { x, y } = index;
  const stay = remaining(
    before.cells.index,
    dropped,
    (p) => within(spans, p) || runs.has(y[p]! * columns + x[p]!),
    true,
  );
  const order = merged(stay, fresh, x, y);
  return { values, index: new kit.CellIndex(x, y, values, columns, lines, undefined, order) };
}

/**
 * The positions `index` holds, in its order, less the first `dropped`
 * (and those `leaves`, where `some` may), moved back by `dropped`.
 */
function remaining(
  index: CellIndex,
  dropped: number,
  leaves: (position: number) => boolean,
  some: boolean,
): Uint32Array {
  const { order } = index;
  const total = index.length;
  const out = new Uint32Array(total);
  let m = 0;
  for (let i = 0; i < total; i++) {
    const k = order ? order[i]! : i;
    if (k < dropped) continue;
    const p = k - dropped;
    if (some && leaves(p)) continue;
    out[m++] = p;
  }
  return out.subarray(0, m);
}

/**
 * `kept` (positions in cell order, each cell's in their order) merged
 * with `fresh` (in any order) into cell order, by row then column then
 * position, as the index's stable sort orders them: each fresh position
 * goes where a binary search over the kept finds its place, and the kept
 * between are copied whole. Null when that is every position in order.
 */
function merged(
  kept: Uint32Array,
  fresh: number[],
  x: NumericArray,
  y: NumericArray,
): Uint32Array | null {
  const before = (a: number, b: number) => y[a]! - y[b]! || x[a]! - x[b]! || a - b;
  fresh.sort(before);
  const out = new Uint32Array(kept.length + fresh.length);
  let [from, k] = [0, 0];
  for (const position of fresh) {
    let [lo, hi] = [from, kept.length];
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (before(kept[mid]!, position) < 0) lo = mid + 1;
      else hi = mid;
    }
    out.set(kept.subarray(from, lo), k);
    k += lo - from;
    out[k++] = position;
    from = lo;
  }
  out.set(kept.subarray(from), k);
  if (out.length !== x.length) return out;
  for (let p = 0; p < out.length; p++) if (out[p] !== p) return out;
  return null;
}

/**
 * How cells along an axis are numbered before and now: the same along a
 * band axis (whose bands are in the same order); by their values along a
 * number or time axis. -1 for a cell the other numbering has not.
 */
function mapping(
  before: Float64Array | undefined,
  now: Float64Array | undefined,
): { forth(c: number): number; back(c: number): number } {
  if (!before || !now || before === now) return { forth: (c) => c, back: (c) => c };
  return {
    forth: (c) => (c < 0 ? -1 : indexIn(now, before[c]!)),
    back: (c) => (c < 0 ? -1 : indexIn(before, now[c]!)),
  };
}

/** The band keys along each band axis a heatmap's cells were placed among (none along number or time axes). */
export interface CellKeys {
  readonly x?: readonly string[] | undefined;
  readonly y?: readonly string[] | undefined;
}

/**
 * The cells of a heatmap's series of a whole table in one panel, kept
 * between table versions: as they are while the series reads the same
 * rows, else patched by the table's changes since (see `patchCells`), or
 * built again.
 */
export class FollowedCells {
  readonly #kit: HeatmapKit;
  #state: CellsState | undefined;
  #keys: CellKeys = {};

  constructor(kit: HeatmapKit) {
    this.#kit = kit;
  }

  /** The cells last read, which an image painted from them patches from. */
  get state(): CellsState | undefined {
    return this.#state;
  }

  /**
   * The cells of `layout` in `table` now, with `fields` the fields the mark
   * reads (and of them those placing rows), combined by `reduce`; `keys`
   * are the band keys the layout's band ordinals index.
   */
  read(
    table: Table,
    layout: CellsLayout,
    keys: CellKeys,
    fields: { readonly read: readonly string[]; readonly placing: readonly string[] },
    reduce: CellReduce,
  ): CellsState {
    const known = this.#state;
    const { x, y, columns, lines } = layout;
    // Columns that fill their buffer are the same array at every version.
    if (
      known?.version === table.version &&
      !this.#kit.untold(table) &&
      known.x === x &&
      known.y === y &&
      known.columns === columns &&
      known.lines === lines &&
      (layout.values === known.values || layout.values === known.cells.values)
    )
      return known;
    // A copy read for tooltips holds the cells' values: the table's are read.
    const now =
      layout.values === known?.cells.values ? { ...layout, values: known.values } : layout;
    const version = versionOf(this.#kit, table);
    const change = known && changesSince(table, known.version);
    // Rows keep their cells' order unless bands were reordered or more of them shown.
    const ordered =
      sameKeys(this.#keys.x, keys.x) &&
      sameKeys(this.#keys.y, keys.y) &&
      (layout.xValues !== undefined || known?.columns === columns) &&
      (layout.yValues !== undefined || known?.lines === lines);
    const kit = this.#kit;
    const state =
      (known && change && patchCells(kit, known, now, change, fields, reduce, version, ordered)) ||
      buildCells(kit, now, reduce, version);
    this.#state = state;
    this.#keys = keys;
    return state;
  }
}

/** Whether two lists of band keys name the same bands in the same order (both none too). */
function sameKeys(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * A table's version as what reads it now may name it: NaN inside a
 * transaction that has written to it, whose rows the version does not name
 * yet. Its change journal is attached (see `changesSince`), so the version
 * can be followed from.
 */
export function versionOf(kit: HeatmapKit, table: Table): number {
  if (kit.untold(table)) return Number.NaN;
  changesSince(table, table.version);
  return table.version;
}

/** Whether `change` moved rows or updated any of `fields`. */
export function touches(change: Changes, fields: readonly string[]): boolean {
  return (
    change.appended > 0 ||
    change.dropped > 0 ||
    !!change.inserted ||
    change.spans.some((span) => span.fields.some((field) => fields.includes(field)))
  );
}
