// Where the keyboard cursor stops in a panel, the order Up and Down visit
// its series in, how it steps through cells, and what it reads, from what
// the panel's inspector and its last frame drew. The interaction controller
// (dom/interaction.ts) uses these, handing in the code it shares with the
// chart (see `InteractionKit`), so that they load with it.

import type { OrderedTable } from "../data/ordered.ts";
import type { Table } from "../data/table.ts";
import type { Polyline } from "../lod/polyline.ts";
import type { HeatmapMark } from "../marks/heatmap.ts";
import type { Frame, Mark } from "../marks/mark.ts";
import type { placeAt, rowOf, Series } from "../marks/series.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { AreaGeometry, LineGeometry } from "../scene/scene.ts";
import type { AxisInspection, Inspector } from "./inspect.ts";
import type { ChartModel } from "./model.ts";

/**
 * The series of a panel the keyboard stops at, in series order: every
 * series shown, whatever the inspection reads, but those of marks with
 * `inspect: false`.
 */
export function keyboardStops(inspector: Inspector | undefined): Series[] {
  return (inspector?.marks ?? []).flatMap(({ visible }) => visible);
}

/**
 * The axis a mark's series run along, which Up and Down order them across:
 * y for marks along y (horizontal bars, profiles), x for the others but
 * cells, and none for cells and marks placed off that axis.
 */
function runsAlong(mark: Mark): "x" | "y" | undefined {
  const axis = mark.tooltip === "y" ? "y" : mark.tooltip === "cell" ? undefined : "x";
  return axis && !off(mark, axis) ? axis : undefined;
}

/** Whether a mark places its rows off `axis`: in a frame, or on a scale of the chart's own. */
function off(mark: Mark, axis: "x" | "y"): boolean {
  const bound = mark.bound?.[axis];
  return bound !== undefined && bound.kind !== "axis";
}

/** A series where Up and Down visit it: its observation the cursor lands on, and its height. */
export interface Visit {
  readonly key: string;
  readonly position: number;
  /** Pixels across the axis the series run along: y for series along x, x for those along y. */
  readonly height: number;
}

/**
 * The series panel `panel` stops at (see `keyboardStops`) in the order Up
 * and Down visit them at `place`, a pixel along `axis`: the series running
 * along `axis` by their height across it, top (or left) first, ties in
 * series order; then the others, in series order. Each is at its drawn
 * observation nearest the place along the axis. A path's height is where
 * what the panel's last frame drew of it crosses the place, the crossing
 * nearest `height` where it crosses more than once (ties to the first
 * drawn); a point's, or a path's not drawn there, its observation's.
 * Series with no observation drawn are left out.
 */
export function orderAt(
  model: ChartModel,
  panel: string,
  axis: "x" | "y",
  place: number,
  height: number,
  readers: SeriesReaders,
): Visit[] {
  const inspector = model.inspectorOf(panel);
  if (!inspector) return [];
  const a = axis === "x" ? 0 : 1;
  // Each series' paths as drawn, by key: its lines, and its areas' value
  // edges, which stand for it where it has some. Copies (a highlight's)
  // and runs (`|run0`) are its own too.
  const paths = new Map<string, [lines: Polyline[], areas: Polyline[]]>();
  for (const drawn of model.drawnMarks()) {
    if (drawn.panel !== panel || !drawn.current()) continue;
    for (const g of drawn.geometry) {
      if (g.kind !== "line" && g.kind !== "area") continue;
      const base = (g.of ?? g.key).split("\u0001")[0]!;
      const s =
        drawn.series.find(({ key }) => key === base) ??
        drawn.series.find(({ key }) => key === base.slice(0, base.lastIndexOf("|")));
      if (!s) continue;
      const own = paths.get(s.key) ?? [[], []];
      paths.set(s.key, own);
      if (g.kind === "line") own[0].push((g as LineGeometry).path);
      else own[1].push((g as AreaGeometry).upper);
    }
  }
  const ordered: Visit[] = [];
  const others: Visit[] = [];
  for (const { mark, frame, visible } of inspector.marks) {
    const along = runsAlong(mark) === axis;
    const scale = frame[axis];
    for (const s of visible) {
      // Rows sorted along the axis are searched by halves; paths are drawn in
      // order along it where their rows are, or in bands, in band order.
      const rows = along && (axis === "x" ? s.sorted || !!s.placesSorted : !!s.ySorted);
      const [lines = [], areas = []] = (along && paths.get(s.key)) || [];
      let crossed = Number.NaN;
      for (const path of areas.length ? areas : lines)
        crossed = crossing(path, a, place, height, rows || scale.bandwidth !== undefined, crossed);
      const near = Number.isNaN(crossed) ? height : crossed;
      const [position, observed] = nearest(inspector, s, axis, scale, place, near, rows, readers);
      if (position < 0) continue;
      const visit = { key: s.key, position, height: Number.isNaN(crossed) ? observed : crossed };
      (along ? ordered : others).push(visit);
    }
  }
  // Sorting is stable: series at one height stay in series order.
  return [...ordered.sort((p, q) => p.height - q.height), ...others];
}

/**
 * The entry of `inspector` drawing the series keyed `key`, shown or hidden
 * by the legend, and the series; undefined for none.
 */
function entryOf(
  inspector: Inspector | undefined,
  key: string,
): [Inspector["marks"][number], Series] | undefined {
  for (const entry of inspector?.marks ?? []) {
    const s = entry.series.find((part) => part.key === key);
    if (s) return [entry, s];
  }
  return undefined;
}

/**
 * What the keyboard cursor is on, kept so that data changes do not move
 * it: a table row by identity (see `Table.identity`), with its order value
 * in an ordered table; or where an aggregate or a cell is (see `placeOf`).
 */
export type KeyedItem =
  | { table: Table; identity: number; generation: number; at?: number | undefined }
  | { place: readonly (number | string | undefined)[] };

/**
 * What position `position` of the series keyed `key` in panel `panel` is
 * on (see `KeyedItem`); undefined for a layout mark's items, which keys name.
 */
export function keyedItem(
  model: ChartModel,
  panel: string,
  key: string,
  position: number,
  readers: SeriesReaders,
): KeyedItem | undefined {
  const [entry, s] = entryOf(model.inspectorOf(panel), key) ?? [];
  if (!entry || !s) return undefined;
  const { mark } = entry;
  const { table } = mark;
  if (!table || mark.summarizes || mark.tooltip === "cell")
    return { place: placeOf(mark, s, position, entry.frame, readers) };
  return rowItem(table, readers.rowOf(s, position));
}

/** Row `row` of `table`, as what the keyboard cursor is on (see `KeyedItem`). */
export function rowItem(table: Table, row: number): KeyedItem {
  const { orderBy } = table as Partial<OrderedTable>;
  return {
    table,
    identity: table.identity(row),
    generation: table.generation,
    at: orderBy ? table.numbers(orderBy)[row] : undefined,
  };
}

/**
 * Where the aggregate or cell at `position` of `s` is: its values along
 * the axes that place it (the axis the mark reads along, or both), by name
 * on category axes, whose indices data changes move.
 */
function placeOf(
  mark: Mark,
  s: Series,
  position: number,
  frame: Frame,
  { placeAt, rowOf }: SeriesReaders,
): (number | string | undefined)[] {
  const row = rowOf(s, position);
  const along = mark.tooltip === "x" || mark.tooltip === "y" ? mark.tooltip : undefined;
  return (["x", "y"] as const).map((axis) => {
    if (along && along !== axis) return undefined;
    const value = placeAt(s, axis, row);
    return frame[axis].categories?.[value] ?? value;
  });
}

/**
 * Where `item` is now in the series keyed `key` in panel `panel`, data
 * changes having moved it, by direct lookups only; -1 once it is gone. A
 * row is where it was (its identity there), or found by halves where its
 * table has it, then among its series' rows, which are in the order of
 * the mark's view or its table (every row, or a group's), and gone where
 * that misses: dropped, filtered out, moved to another group, or moved by
 * a mark that keeps rows in an order of its own (rugs, oriented bands,
 * union stacks). A heatmap's cell is found at its place in the mark's
 * index of cells, and gone unless the cell there is at its place. An
 * aggregate is found among its series' few.
 */
export function itemAt(
  model: ChartModel,
  panel: string,
  key: string,
  position: number,
  item: KeyedItem,
  readers: SeriesReaders,
): number {
  const [entry, s] = entryOf(model.inspectorOf(panel), key) ?? [];
  if (!s || !entry!.visible.includes(s)) return -1;
  const { mark, frame } = entry!;
  const { rowOf } = readers;
  const n = s.length;
  if ("table" in item) {
    const table = item.table as OrderedTable;
    const { identity, generation, at } = item;
    const has = (k: number) =>
      k < n &&
      mark.table === table &&
      table.generation === generation &&
      table.identity(rowOf(s, k)) === identity;
    // Where it was, by its identity there; else by halves where its table
    // has it, whose rows ascend by identity (an ordered table's by order
    // value, then by identity, rows of one value keeping the order they
    // arrived in), then in the order of the mark's view, else of its table.
    if (has(position)) return position;
    const values = at === undefined ? undefined : table.numbers(table.orderBy);
    const row = firstPast(
      0,
      table.length,
      (r) => ((values ? values[r]! - at! : 0) || table.identity(r) - identity) >= 0,
    );
    const { view } = mark;
    const order = (r: number) => (view ? view.indexOf(r) : r);
    const k = firstPast(0, n, (k) => order(rowOf(s, k)) >= order(row));
    return has(k) ? k : -1;
  }
  const same = (k: number) =>
    placeOf(mark, s, k, frame, readers).every((value, i) => value === item.place[i]);
  if (mark.summarizes || mark.tooltip !== "cell") {
    for (let k = 0; k < n; k++) if (same(k)) return k;
    return -1;
  }
  // Its column and row in the mark's grid: along a number axis, the cell
  // holding its value; along a category axis, its category's band.
  const cells = mark as unknown as HeatmapMark;
  const resolve = (axis: "x" | "y", value: number | string | undefined) => {
    const resolved = cells.resolve(s, axis, frame[axis]);
    const place = frame[axis].categories?.indexOf(value as string) ?? (value as number);
    const at = resolved.cells
      ? resolved.cells.find(place)
      : (resolved.places?.band(place) ?? place);
    return { resolved, at };
  };
  const x = resolve("x", item.place[0]);
  const y = resolve("y", item.place[1]);
  const k = cells.cellsOf(s, x.resolved, y.resolved).index.find(x.at, y.at);
  return k >= 0 && same(k) ? k : -1;
}

/**
 * Where the keyboard cursor at position `position` of the series keyed
 * `key` stands in panel `panel`, in pixels, for Up and Down: the axis its
 * series runs along (x for cells), its place along it (before marks spread
 * rows across their bands), and its height across, NaN where its point is
 * not drawn. The series may be one the legend hides. Undefined where its
 * place along the axis is not drawn.
 */
export function standing(
  model: ChartModel,
  panel: string,
  key: string,
  position: number,
  { placeAt, rowOf }: SeriesReaders,
): { axis: "x" | "y"; place: number; height: number } | undefined {
  const inspector = model.inspectorOf(panel);
  const [entry, s] = entryOf(inspector, key) ?? [];
  if (!entry || !s || position < 0 || position >= s.length) return undefined;
  const row = rowOf(s, position);
  const axis = runsAlong(entry.mark) ?? (entry.mark.tooltip === "y" ? "y" : "x");
  const place = entry.frame[axis].map(placeAt(s, axis, row));
  const height = inspector!.drawn(s, row)?.[axis === "x" ? 1 : 0] ?? Number.NaN;
  return Number.isFinite(place) ? { axis, place, height } : undefined;
}

/** The first of positions `lo` to `hi` (exclusive) `past` holds for, it holding for every one after. */
function firstPast(lo: number, hi: number, past: (k: number) => boolean): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (past(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/**
 * Where `path` crosses `place` along coordinate `a` (0 for x, 1 for y): of
 * its crossings and `best` (NaN for none), the one nearest `near` across,
 * the first on ties; NaN where none is. A `sorted` path runs one way along
 * `a` in each run, which is searched only where it reaches the place. A
 * segment along the other coordinate (a step's jump, a reduced column,
 * repeated positions) crosses at every height it spans; the curves paths
 * draw put their control points at thirds along `a`, so `a` is linear in a
 * curve's parameter.
 */
function crossing(
  path: Polyline,
  a: 0 | 1,
  place: number,
  near: number,
  sorted: boolean,
  best: number,
): number {
  const { coords, count, starts, curved, controls } = path;
  const c = 1 - a;
  const take = (at: number) => {
    if (Number.isNaN(best) || Math.abs(at - near) < Math.abs(best - near)) best = at;
  };
  for (let r = 0; r < starts.length; r++) {
    const start = starts[r]!;
    const end = starts[r + 1] ?? count;
    // A run of one point is a dot.
    if (end - start === 1 && Math.abs(coords[start * 2 + a]! - place) <= 0.5)
      take(coords[start * 2 + c]!);
    let [from, to] = [start, end - 1];
    if (sorted && to > from) {
      // In pixels, positions run either way (a reversed or upward axis); from
      // the last point before the place to the first past it.
      const way = coords[to * 2 + a]! >= coords[start * 2 + a]! ? 1 : -1;
      const along = (k: number) => way * (coords[k * 2 + a]! - place);
      from = Math.max(start, firstPast(start, end, (k) => along(k) >= 0) - 1);
      to = Math.min(
        to,
        firstPast(start, end, (k) => along(k) > 0),
      );
    }
    for (let i = from; i < to; i++) {
      const p = coords[i * 2 + a]!;
      const q = coords[i * 2 + 2 + a]!;
      if ((place - p) * (place - q) > 0) continue;
      const u = coords[i * 2 + c]!;
      const v = coords[i * 2 + 2 + c]!;
      if (p === q) {
        take(Math.min(Math.max(near, Math.min(u, v)), Math.max(u, v)));
        continue;
      }
      const t = (place - p) / (q - p);
      const k = (i + 1) * 4;
      const s = 1 - t;
      take(
        curved && !Number.isNaN(controls[k]!)
          ? s * s * s * u +
              3 * s * t * (s * controls[k + c]! + t * controls[k + 2 + c]!) +
              t * t * t * v
          : u + t * (v - u),
      );
    }
  }
  return best;
}

/**
 * The drawn observation of `s` nearest `place` along `axis` (on `scale`,
 * before marks spread rows across their bands), the nearest `near` across
 * among ties, and its height across; -1 for none drawn.
 */
function nearest(
  inspector: Inspector,
  s: Series,
  axis: "x" | "y",
  scale: PositionScale,
  place: number,
  near: number,
  sorted: boolean,
  { placeAt, rowOf }: SeriesReaders,
): [number, number] {
  const c = axis === "x" ? 1 : 0;
  const at = (k: number) => scale.map(placeAt(s, axis, rowOf(s, k))) - place;
  let best = -1;
  let height = Number.NaN;
  let [along, across] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const far = (k: number) => Math.abs(at(k)) > along;
  const consider = (k: number) => {
    const d = Math.abs(at(k));
    const pixels = d > along ? undefined : inspector.drawn(s, rowOf(s, k));
    if (!pixels) return;
    const h = Math.abs(pixels[c] - near);
    if (d < along || h < across) [best, height, along, across] = [k, pixels[c], d, h];
  };
  // Sorted rows outward from where the place falls, either way, until they
  // are farther than the best; other rows, every one.
  let k = 0;
  if (sorted) {
    const way = at(s.length - 1) >= at(0) ? 1 : -1;
    k = firstPast(0, s.length, (j) => way * at(j) >= 0);
    for (let j = k - 1; j >= 0 && !far(j); j--) consider(j);
  }
  for (; k < s.length && !(sorted && far(k)); k++) consider(k);
  return [best, height];
}

/**
 * For series the keyboard reads cell by cell (heatmaps): the position of
 * the cell `columns` to the right and `rows` up from the one at `position`
 * in the series keyed `key`, as the panel draws them, or undefined when
 * there is none.
 */
export function stepCell(
  inspector: Inspector | undefined,
  key: string,
  position: number,
  columns: number,
  rows: number,
): number | undefined {
  const [entry, s] = entryOf(inspector, key) ?? [];
  return s && entry!.mark.stepCell?.(s, position, columns, rows, inspector!.frame);
}

/**
 * The axis a panel's data is placed along, which a cursor follows: y when
 * its marks are placed along y (horizontal bars), otherwise x.
 */
export function cursorAxis(inspectors: readonly (Inspector | undefined)[]): "x" | "y" {
  return inspectors.some((inspector) =>
    inspector?.marks.some(({ mark, series }) => mark.tooltip === "y" && series.length > 0),
  )
    ? "y"
    : "x";
}

/** What `inspectPosition` reads series with, handed in (see `InteractionKit`). */
export interface SeriesReaders {
  placeAt: typeof placeAt;
  rowOf: typeof rowOf;
}

/**
 * The field a position reads, a name or a coordinate's (`{ field }`,
 * `{ fraction: { field } }`, `{ px: { field } }`), as `rowField` reads it:
 * a copy, so that this module shares no code with the chart (see the top).
 */
function placedBy(position: unknown): unknown {
  if (typeof position !== "object" || position === null) return position;
  const coordinate = position as {
    field?: unknown;
    fraction?: { field?: unknown };
    px?: { field?: unknown };
  };
  return coordinate.field ?? (coordinate.fraction ?? coordinate.px)?.field;
}

/** Keys that step through a stop's points: by how many, or to its ends. */
const POINT_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  Home: Number.NEGATIVE_INFINITY,
  End: Number.POSITIVE_INFINITY,
};

/**
 * Where a key (Left, Right, Page Up and Down, Home, End) moves the
 * keyboard cursor from position `current` of `series` (-1 arriving at it),
 * stepping through the points in order along the axis the series follows:
 * its positions' order, or on a category axis band by band (rows of one
 * band in theirs), as bars, boxes, and points are drawn whatever their
 * rows' order. A mark whose series are the axis' categories (box plots of
 * `x: "kind", series: "kind"`, bars colored by their x) draws them side by
 * side along it: the keys step through all of them, from series to series.
 */
export function stepPoint(
  inspector: Inspector,
  series: Series,
  current: number,
  key: string,
  { placeAt, rowOf }: SeriesReaders,
): { series: Series; position: number } {
  const owner = inspector.marks.find(({ series: all }) => all.includes(series));
  const axis = owner?.mark.tooltip === "y" ? "y" : "x";
  const field = owner?.mark.identity?.field;
  const spec = owner?.mark.spec as Record<string, unknown> | undefined;
  const parts =
    field !== undefined && placedBy(spec?.[axis]) === field && owner!.visible.includes(series)
      ? owner!.visible
      : [series];
  // The parts' points numbered one after another, and sorted by place where they are not in order.
  const starts: number[] = [];
  let length = 0;
  for (const part of parts) {
    starts.push(length);
    length += part.length;
  }
  let order: Uint32Array | undefined;
  if (parts.length > 1 || (owner?.frame ?? inspector.frame)[axis].type === "band") {
    const places = new Float64Array(length);
    let sorted = true;
    parts.forEach((part, i) => {
      for (let k = 0; k < part.length; k++) {
        const place = placeAt(part, axis, rowOf(part, k));
        const at = starts[i]! + k;
        places[at] = Number.isFinite(place) ? place : Number.POSITIVE_INFINITY;
        if (at > 0 && places[at]! < places[at - 1]!) sorted = false;
      }
    });
    if (!sorted) {
      order = new Uint32Array(length);
      for (let k = 0; k < length; k++) order[k] = k;
      order.sort((a, b) => (places[a]! < places[b]! ? -1 : places[a]! > places[b]! ? 1 : a - b));
    }
  }
  const own = starts[parts.indexOf(series)]!;
  const page = Math.max(1, Math.round(length / 10));
  const step = key === "PageUp" ? -page : key === "PageDown" ? page : (POINT_STEPS[key] ?? 0);
  let rank = current < 0 ? 0 : order ? order.indexOf(own + current) : own + current;
  // Right arrives at the first point; the other keys step from it.
  if (current >= 0 || key !== "ArrowRight") rank += step;
  rank = Math.min(length - 1, Math.max(0, rank));
  const at = order ? order[rank]! : rank;
  // The part holding point `at`: the last starting at or before it.
  let i = parts.length - 1;
  while (i > 0 && starts[i]! > at) i--;
  return { series: parts[i]!, position: at - starts[i]! };
}

/**
 * Position `position` of the series keyed `key` in panel `panel` (the
 * first by default): its panel's key and inspector, the series, the axis
 * it runs along, and its own observation read alone, headed by its place
 * along that axis (no point where it is not drawn); undefined where the
 * series is not shown, or its place has none along the axis (a zero on a
 * log axis, say).
 */
function locate(
  model: ChartModel,
  key: string,
  position: number,
  panel: string | undefined,
  { placeAt, rowOf }: SeriesReaders,
) {
  const at = panel ?? model.panels()[0]?.key;
  const inspector = at === undefined ? undefined : model.inspectorOf(at);
  const [entry, anchor] = entryOf(inspector, key) ?? [];
  if (!entry || !anchor?.length || !entry.visible.includes(anchor) || !(position < anchor.length))
    return undefined;
  const axis: "x" | "y" = entry.mark.tooltip === "y" ? "y" : "x";
  const value = placeAt(anchor, axis, rowOf(anchor, position));
  const scale = (off(entry.mark, axis) ? entry.frame : inspector!.frame)[axis];
  if (!Number.isFinite(scale.map(value)) || (scale.type === "band" && value < 0)) return undefined;
  const own = inspector!.inspectAt(axis, value, [anchor], undefined, anchor, position);
  const cell = entry.mark.tooltip === "cell";
  return { at: at!, inspector: inspector!, anchor, cell, axis, value, own };
}

/**
 * The keyboard cursor's own observation at position `position` of the
 * series keyed `key`, in panel `panel` (the first by default): read alone,
 * headed by its place along its axis, whatever the inspection reads there.
 * Enter clicks it, announcements name it, and its tooltip stands at it.
 * Undefined where it is not drawn.
 */
export function keyedPoint(
  model: ChartModel,
  key: string,
  position: number,
  panel: string | undefined,
  readers: SeriesReaders,
): AxisInspection | undefined {
  const own = locate(model, key, position, panel, readers)?.own;
  return own?.points.length ? own : undefined;
}

/**
 * What the keyboard cursor at position `position` of the series keyed
 * `key` reads, in panel `panel` (the first by default): what the pointer
 * reads at its observation, as the chart's inspection says, kept inside
 * the plot across the axis it reads along; nothing where the pointer reads
 * nothing. Along the series' axis with `snap: "shared"`, the series the
 * pointer reads are read at the cursor's value, those sharing its
 * positions at its row, so that every row is reached where values repeat,
 * beside the cells it reads; otherwise the cursor's own row stands for its
 * series' point at its place where the reading is along its axis. With mode "nearest", and
 * for a point placed off the axis, its observation alone.
 */
export function inspectPosition(
  model: ChartModel,
  key: string,
  position: number,
  panel: string | undefined,
  readers: SeriesReaders,
): AxisInspection | undefined {
  const located = locate(model, key, position, panel, readers);
  if (!located) return undefined;
  const { inspector, anchor, cell, axis, value, own } = located;
  const [target] = own.points;
  const { mode, frame } = inspector;
  const { x, y, width, height } = frame.plot;
  // The axis the pointer reads along; none for mode "nearest".
  const along = mode === "nearest" ? undefined : mode === "nearest-y" ? "y" : "x";
  // The series the pointer reads along the axis; a point placed off it (in
  // a frame, on a scale of the chart's own) is read alone. Along y, it
  // compares those of one y axis: the left one's, else the right one's.
  const marks = inspector.marks.filter(
    ({ mark }) =>
      mark.tooltip !== "cell" && (!mark.place || mark.tooltip === axis) && !off(mark, axis),
  );
  const lefts = marks.filter((entry) => entry.axis.frame === frame && entry.visible.length);
  const reads = (axis === "y" && lefts.length ? lefts : marks).flatMap(({ visible }) => visible);
  const shared = along === axis && inspector.snap === "shared" && reads.includes(anchor);
  // What the pointer reads at the point, where the reading needs it: a
  // shared one only for its reach and cells.
  const asks =
    along &&
    target &&
    (reads.includes(anchor) || cell) &&
    (!shared ||
      inspector.within < Number.POSITIVE_INFINITY ||
      inspector.marks.some(({ mark }) => mark.tooltip === "cell"));
  const read = asks
    ? inspector.inspect(
        along === "x" ? target.px : Math.min(Math.max(target.px, x), x + width),
        along === "y" ? target.py : Math.min(Math.max(target.py, y), y + height),
      )
    : undefined;
  if (asks && !read) return undefined;
  let inspection = read ?? own;
  if (shared) {
    const anchored = inspector.inspectAt(axis, value, reads, undefined, anchor, position);
    // Of the series the pointer reads, each at the row the cursor's reading
    // gives it (none for a stack's layer without one), and its cells.
    inspection = read
      ? {
          ...anchored,
          points: read.points.flatMap((p) =>
            reads.some((s) => s.key === p.key)
              ? anchored.points.filter((q) => q.key === p.key)
              : [p],
          ),
        }
      : anchored;
  } else if (read && along === axis) {
    // The cursor's row stands for its series' point at its place (a snap
    // may read another), where positions repeat.
    const at = along === "x" ? "px" : "py";
    inspection = {
      ...read,
      points: read.points.map((p) => (p.key === key && p[at] === target![at] ? target! : p)),
    };
  }
  // Nothing drawn at this position: no tooltip rather than an empty one.
  if (!inspection?.points.length) return undefined;
  return model.namesPanels ? { ...inspection, panel: located.at } : inspection;
}
