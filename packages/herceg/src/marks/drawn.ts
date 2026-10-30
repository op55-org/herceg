// Drawn-mark records: what one frame drew of one mark in one panel
// (docs/architecture/marks.md "Drawn marks"). A picker tests a record's
// geometry by kind, then asks `partOf` (drawn-parts.ts, which only pickers
// load) what the primitive it hit stands for; marks whose geometry says
// too little pick their own items (`pickItem`). Records reference the
// scene's geometry and series; they copy nothing, and cost a frame one
// object per mark and panel.

import type { Table } from "../data/table.ts";
import { groupKey, type KeyPart } from "../model/items.ts";
import type { Geometry, RasterGeometry, Rect, RectGeometry } from "../scene/scene.ts";
import type { Clip, Curve } from "../spec/spec.ts";
import type { LayoutMark, LayoutResult } from "./layout-mark.ts";
import type { Frame, Hit, Mark, MarkKey } from "./mark.ts";
import { rowOf, type Series } from "./series.ts";

/** A position in a series, as drawn. */
export interface DrawnRow {
  readonly series: Series;
  readonly position: number;
}

/**
 * What a drawn primitive draws:
 * - a row of a table, with its series and position where it has one
 *   (annotations' rows have none);
 * - a group: an aggregate's or a layout item's key;
 * - a trace: a path of a line or area, matched to its rows by data
 *   coordinate, since its points are not its rows (reduced, stepped,
 *   stacked).
 */
export type DrawnPart =
  | {
      readonly kind: "row";
      readonly table: Table;
      readonly position: number;
      readonly series?: DrawnRow | undefined;
    }
  | { readonly kind: "group"; readonly key: string }
  | {
      readonly kind: "trace";
      /** The logical series drawn: the mark's own (for a stacked area, the layer's series). */
      readonly series: Series;
      readonly along: "x" | "y";
      /**
       * Table rows in axis order, for a binary search by data coordinate:
       * undefined where the series' own order is it.
       */
      readonly order?: ArrayLike<number> | undefined;
      /**
       * Whether a table row can be what the path draws: kept by the series'
       * predicates (`where`, `continuity.defined`) and drawable on the
       * frame's scales (finite, positive on log axes, both edges for areas).
       */
      eligible(row: number): boolean;
      /** Whether two drawn rows are in one run: nothing breaks the path between them. */
      sameRun(a: number, b: number): boolean;
      /**
       * For lines drawn unsorted (not reduced, but stepped): each path
       * point's position in the series, after stepping (an inserted vertex
       * takes the position of the observation it leaves). Undefined for
       * monotone curves, copied points, series whose features trace them,
       * and areas, whose fill is no one path of observations.
       */
      readonly positions?: Int32Array | undefined;
    };

/** An item a mark draws that is not a series point: custom marks' items, which no mark records yet. */
export interface DrawnItem {
  readonly key: string;
  readonly box: Readonly<Rect>;
  /** Its series and row where it has them, for tooltips and selections. */
  readonly row?: DrawnRow | undefined;
}

/** What one frame drew of one mark in one panel. */
export interface DrawnMark {
  readonly mark: MarkKey;
  readonly panel: string;
  /** The frame it drew with; undefined for layout marks, which lay out their own room. */
  readonly frame: Frame | undefined;
  /** As painted; while a transition plays, the state it goes to. */
  readonly geometry: readonly Geometry[];
  readonly series: readonly Series[];
  /** Items that are not series points, in reading order. */
  readonly items?: readonly DrawnItem[] | undefined;
  /** For layout marks: what they laid out, whose items `pickItem` (layout-mark.ts) finds. */
  readonly layout?: LayoutResult | undefined;
  /**
   * For layout marks: the mark that laid it out, which for a map's or a 3D
   * box's layers drawn as one is none of the chart's marks.
   */
  readonly layoutMark?: LayoutMark | undefined;
  /** The chart revision drawn. */
  readonly revision: number;
  /**
   * Whether every table and view it read has the version it read, and the
   * chart's options and marks are unchanged: only then are its series'
   * column views valid and the record readable.
   */
  current(): boolean;
}

/**
 * Geometry painted as copies of a mark's (a highlight's dimmed, lit, or
 * clipped parts): each copy's source, and where it draws only some of the
 * source's primitives, the source index of each of its own.
 */
const copies = /* @__PURE__ */ new WeakMap<
  Geometry,
  { source: Geometry; indices: ArrayLike<number> | undefined }
>();

/**
 * Records that `copy` draws primitives of `source`: all of them, in order,
 * or those at `indices`. Returns `copy`.
 */
export function copiedFrom<G extends Geometry>(
  copy: G,
  source: Geometry,
  indices?: ArrayLike<number>,
): G {
  copies.set(copy, { source, indices });
  return copy;
}

/** Rows drawn by geometry that carries none (a highlight's dots), each primitive's. */
const rowsDrawn = /* @__PURE__ */ new WeakMap<Geometry, Uint32Array>();

/** Records the table row each primitive of `geometry` draws. Returns `geometry`. */
export function drawingRows<G extends Geometry>(geometry: G, rows: Uint32Array): G {
  rowsDrawn.set(geometry, rows);
  return geometry;
}

/** The rows `geometry`'s primitives draw: its own `rows`, or those recorded for it. */
export function rowsOfDrawn(geometry: Geometry): Uint32Array | undefined {
  return (geometry as { rows?: Uint32Array }).rows ?? rowsDrawn.get(geometry);
}

/** The geometry primitive `index` of `geometry` was made in, and its index there. */
export function madeIn(geometry: Geometry, index: number): [Geometry, number] {
  for (let copy = copies.get(geometry); copy; copy = copies.get(geometry)) {
    index = copy.indices ? copy.indices[index]! : index;
    geometry = copy.source;
  }
  return [geometry, index];
}

/**
 * The series geometry traces where its key names another: a highlight's
 * masked copy of a line's or area's series, with the values of rows it
 * leaves out missing.
 */
const seriesTraced = /* @__PURE__ */ new WeakMap<Geometry, Series>();

/** Records that `geometry` traces `series`, not the series its key names. Returns `geometry`. */
export function tracing<G extends Geometry>(geometry: G, series: Series): G {
  seriesTraced.set(geometry, series);
  return geometry;
}

/** The series `geometry` traces, where that is not the one its key names. */
export function tracedBy(geometry: Geometry): Series | undefined {
  return seriesTraced.get(geometry);
}

/** Where a picker asks, in the CSS pixels of the chart. */
export interface PickQuery {
  readonly x: number;
  readonly y: number;
  /** Extra reach past a shape: 4 px for a mouse, 8 for touch. */
  readonly slop: number;
}

/** A mark's topmost item within reach. */
export interface PickedItem {
  /** The mark whose item it is, where it is not the record's: a layer of a map or 3D box drawn as one. */
  readonly mark?: MarkKey | undefined;
  /** What it is: a row (a trace resolved to its observation), or a group. */
  readonly part: Exclude<DrawnPart, { kind: "trace" }>;
  /** For aggregates and layout items: the item's names after its mark's key (a bin's interval, a path). */
  readonly names: readonly KeyPart[] | undefined;
  /** Its drawn bounds; a line's observation, or a layout item, its point. */
  readonly box: Readonly<Rect>;
  /** Pixels from the pointer to the drawn shape; 0 inside it. */
  readonly distance: number;
}

/**
 * What marks' `partOf` builds parts with, given them by the picker's
 * `partOf` (drawn-parts.ts), so that the code making parts loads with
 * pickers, not with every chart.
 */
export interface PartBuilders {
  /** The series a geometry of `drawn` draws: keyed as it is, or as the series it is a part of. */
  seriesOf(drawn: DrawnMark, geometry: Geometry): Series | undefined;
  /** A row of `table` that `geometry` draws, with its series and position there where it has one. */
  row(drawn: DrawnMark, geometry: Geometry, table: Table, row: number): DrawnPart;
  /** An annotation's row of `table`, or without a table (places given alone), its index's group. */
  annotation(drawn: DrawnMark, table: Table | undefined, row: number): DrawnPart;
  /** An aggregate's group: the key of its parts and names after its mark's (see `groupKey`). */
  group(drawn: DrawnMark, parts: readonly KeyPart[], names: readonly KeyPart[]): DrawnPart;
  /** A line's or area's path drawing `s`: rows its predicates keep and its frame places, in runs. */
  trace(s: Series, reading: TraceReading): DrawnPart;
}

/** What a trace part of a line or area reads beyond its series. */
export interface TraceReading {
  readonly along: "x" | "y";
  /** The frame it was drawn on: its scales say what is drawable. */
  readonly frame: Frame;
  /** For areas: the lower edge, whose values must be drawable too. */
  readonly lower?: ArrayLike<number> | undefined;
  /** For stacked areas on a log axis of values: zeros, which they draw along the plot's bottom. */
  readonly lowZero?: boolean | undefined;
  /**
   * For series drawn unsorted: how they were traced, so each path point's
   * position can be worked out when asked (see `DrawnPart`'s `positions`).
   */
  readonly unsorted?: { readonly curve: Curve | undefined } | undefined;
  /**
   * The series as its path traced it, where that is not the logical one: a
   * highlight's masked copy (`tracedBy`), of the same rows, whose missing
   * values say which rows it draws and where its runs end.
   */
  readonly traced?: Series | undefined;
}

/** How a mark's own lookup reads the point it found (see `pickedHit`). */
export interface HitReading {
  /** Its drawn bounds, as the mark draws it; undefined where it is not drawn. */
  bounds(series: Series, position: number, frame: Frame): Readonly<Rect> | undefined;
  /** For aggregates: the parts and names of its group's key (see `groupKey`). */
  group?(
    series: Series,
    position: number,
  ): { parts: readonly KeyPart[]; names: readonly KeyPart[] } | undefined;
  /**
   * A lookup to use instead of `pick`, for marks whose `pick` finds
   * otherwise than picking does: reaching less far than `query.slop` or
   * measuring strokes' middles (contours), ranking ties apart from paint
   * order (error bars, rugs), choosing by span before shape (violins),
   * measuring what the mark's clip keeps.
   */
  lookup?:
    | ((series: readonly Series[], px: number, py: number, frame: Frame) => Hit | undefined)
    | undefined;
}

/**
 * The item `mark` finds at `query` through its own lookup (`pick`), for
 * marks whose cells, boxes, or candles a lookup finds faster and more
 * exactly than geometry by kind: the row of the point hit or, with
 * `group`, the aggregate it is; its drawn bounds; its distance as the
 * lookup gives it, within `query.slop`.
 */
export function pickedHit(
  mark: Mark,
  drawn: DrawnMark,
  query: PickQuery,
  reading: HitReading,
): PickedItem | undefined {
  const { frame } = drawn;
  if (!frame || !mark.pick) return undefined;
  // What tooltips look among: series shown, with rows.
  const shown = drawn.series.filter((s) => !frame.hidden.has(s.key) && s.length > 0);
  const hit = reading.lookup
    ? reading.lookup(shown, query.x, query.y, frame)
    : mark.pick(shown, query.x, query.y, frame);
  if (!hit) return undefined;
  const { series, position, distance } = hit;
  // Lookups find the nearest, however far; a pick reaches `slop` past a shape.
  if (!(distance <= query.slop)) return undefined;
  const box = reading.bounds(series, position, frame);
  if (!box) return undefined;
  if (reading.group) {
    const named = reading.group(series, position);
    if (!named) return undefined;
    const key = groupKey(drawn.mark, named.parts, named.names);
    return { part: { kind: "group", key }, names: named.names, box, distance };
  }
  const row = rowOf(series, position);
  if (!mark.table) return undefined;
  return {
    part: { kind: "row", table: mark.table, position: row, series: { series, position } },
    names: undefined,
    box,
    distance,
  };
}

/** The box with corners at two points, in either order. */
export function boxOf(x0: number, y0: number, x1: number, y1: number): Rect {
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    width: Math.abs(x1 - x0),
    height: Math.abs(y1 - y0),
  };
}

/** What a mark's drawing is cut to: the chart with a `clip` of "chart" or false, else the plot. */
export function clipBox(clip: Clip | undefined, frame: Frame): Readonly<Rect> {
  return clip === "chart" || clip === false ? (frame.chart ?? frame.plot) : frame.plot;
}

/** Each drawing's cover, read once: picking asks for it at every pointer move. */
const covers = new WeakMap<DrawnMark, Rect[] | undefined>();

/**
 * What a cell mark's drawing covers: the rasters it drew (the cells the
 * plot shows) and rectangles (a highlight's cells) outside them, each cut
 * to its clip box; undefined where it drew none, or nothing of them shows.
 */
export function cellsCover(drawn: DrawnMark, clip: Clip | undefined): Rect[] | undefined {
  if (covers.has(drawn)) return covers.get(drawn);
  const box = clipBox(clip, drawn.frame!);
  const rasters: Rect[] = [];
  const cells: Rect[] = [];
  for (const g of drawn.geometry) {
    if (g.kind !== "raster") continue;
    const { x, y, width, height } = g as RasterGeometry;
    const kept = cut({ x, y, width, height }, box);
    if (kept) rasters.push(kept);
  }
  const within = (r: Rect, image: Rect) =>
    r.x >= image.x &&
    r.y >= image.y &&
    r.x + r.width <= image.x + image.width &&
    r.y + r.height <= image.y + image.height;
  for (const g of drawn.geometry) {
    if (g.kind !== "rect") continue;
    const { rects, count } = g as RectGeometry;
    for (let i = 0; i < count * 4; i += 4) {
      const r = { x: rects[i]!, y: rects[i + 1]!, width: rects[i + 2]!, height: rects[i + 3]! };
      const kept = cut(r, box);
      // A highlight's cells drawn over the image add nothing to what it covers.
      if (kept && !rasters.some((image) => within(kept, image))) cells.push(kept);
    }
  }
  const cover = rasters.length + cells.length > 0 ? [...rasters, ...cells] : undefined;
  covers.set(drawn, cover);
  return cover;
}

/**
 * Of a drawing's cover, the rectangles within `reach` of a pixel, which
 * alone can hold what is drawn of a cell there: a highlight draws one
 * rectangle per cell.
 */
export function coverNear(cover: readonly Rect[], px: number, py: number, reach: number): Rect[] {
  return cover.filter((r) => distanceToCut(r, r, px, py) <= reach);
}

/** How far a pixel is from what `cover` holds of `rect`: infinite for nothing. */
export function distanceToCover(
  rect: Readonly<Rect>,
  cover: readonly Rect[],
  px: number,
  py: number,
): number {
  let distance = Number.POSITIVE_INFINITY;
  for (const r of cover) distance = Math.min(distance, distanceToCut(rect, r, px, py));
  return distance;
}

/** What `cover` holds of `rect`, bounded: undefined for nothing. */
export function coverOf(rect: Readonly<Rect>, cover: readonly Rect[]): Rect | undefined {
  let bounds: Rect | undefined;
  for (const r of cover) {
    const kept = cut(rect, r);
    if (!kept) continue;
    bounds = bounds
      ? boxOf(
          Math.min(bounds.x, kept.x),
          Math.min(bounds.y, kept.y),
          Math.max(bounds.x + bounds.width, kept.x + kept.width),
          Math.max(bounds.y + bounds.height, kept.y + kept.height),
        )
      : kept;
  }
  return bounds;
}

/** Whether a point is in a box, edges included. */
export function inside(box: Readonly<Rect>, x: number, y: number): boolean {
  return x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;
}

/** The part of `rect` inside `box`; undefined where none of it is (or only an edge). */
export function cut(rect: Readonly<Rect>, box: Readonly<Rect>): Rect | undefined {
  const x0 = Math.max(rect.x, box.x);
  const y0 = Math.max(rect.y, box.y);
  const x1 = Math.min(rect.x + rect.width, box.x + box.width);
  const y1 = Math.min(rect.y + rect.height, box.y + box.height);
  return x0 < x1 && y0 < y1 ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } : undefined;
}

/** How far a point is from the part of `rect` inside `box`; Infinity where none is. */
export function distanceToCut(
  rect: Readonly<Rect>,
  box: Readonly<Rect>,
  x: number,
  y: number,
): number {
  const kept = cut(rect, box);
  if (!kept) return Number.POSITIVE_INFINITY;
  return Math.hypot(
    Math.max(0, kept.x - x, x - kept.x - kept.width),
    Math.max(0, kept.y - y, y - kept.y - kept.height),
  );
}

/**
 * The part of the segment from (x0, y0) to (x1, y1) inside `box`, as its
 * ends; undefined where none of it is.
 */
export function clipSegment(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  box: Readonly<Rect>,
): [number, number, number, number] | undefined {
  const [dx, dy] = [x1 - x0, y1 - y0];
  let [from, to] = [0, 1];
  // Each side of the box: how fast the segment nears it, and how far inside it starts.
  for (const [p, q] of [
    [-dx, x0 - box.x],
    [dx, box.x + box.width - x0],
    [-dy, y0 - box.y],
    [dy, box.y + box.height - y0],
  ] as const) {
    if (p === 0) {
      if (q < 0) return undefined;
      continue;
    }
    const t = q / p;
    if (p < 0) from = Math.max(from, t);
    else to = Math.min(to, t);
    if (from > to) return undefined;
  }
  return [x0 + from * dx, y0 + from * dy, x0 + to * dx, y0 + to * dy];
}

/**
 * How far a point is from what `box` keeps of the stroke of the segment
 * from (x0, y0) to (x1, y1), `half` wide either side with round ends (as
 * strokes are drawn, round-joined); Infinity where it keeps none.
 */
export function distanceToStroke(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  half: number,
  box: Readonly<Rect>,
  x: number,
  y: number,
): number {
  // Wholly inside the box, as most are: the capsule's own distance, with nothing to cut.
  if (
    half > 0 &&
    Math.min(x0, x1) - half >= box.x &&
    Math.max(x0, x1) + half <= box.x + box.width &&
    Math.min(y0, y1) - half >= box.y &&
    Math.max(y0, y1) + half <= box.y + box.height
  )
    return Math.max(0, distanceToSegment(x, y, x0, y0, x1, y1) - half);
  const length = Math.hypot(x1 - x0, y1 - y0);
  let distance = Math.min(
    distanceToDisc(x0, y0, half, box, x, y),
    distanceToDisc(x1, y1, half, box, x, y),
  );
  if (length === 0) return distance;
  // Across the segment, `half` long: its stroke between the ends.
  const [nx, ny] = [((y0 - y1) / length) * half, ((x1 - x0) / length) * half];
  const body = clipPolygon(
    [x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny],
    box,
  );
  distance = Math.min(distance, distanceToPolygon(body, x, y));
  return distance;
}

/**
 * How far a point is from what `box` keeps of the disc of radius `r` about
 * (cx, cy); Infinity where it keeps none.
 */
export function distanceToDisc(
  cx: number,
  cy: number,
  r: number,
  box: Readonly<Rect>,
  x: number,
  y: number,
): number {
  // A disc the box keeps no area of (a point where it touches) is not drawn there.
  const outside = Math.hypot(
    Math.max(0, box.x - cx, cx - box.x - box.width),
    Math.max(0, box.y - cy, cy - box.y - box.height),
  );
  if (!(outside < r)) return Number.POSITIVE_INFINITY;
  // The disc's point nearest the point, where the box keeps it, is the nearest kept.
  const d = Math.hypot(x - cx, y - cy);
  const [nx, ny] = d > r ? [cx + ((x - cx) / d) * r, cy + ((y - cy) / d) * r] : [x, y];
  if (inside(box, nx, ny)) return Math.max(0, d - r);
  // Else the nearest kept is on the box's sides where the disc covers them.
  let distance = Number.POSITIVE_INFINITY;
  const [left, top] = [box.x, box.y];
  const [right, bottom] = [box.x + box.width, box.y + box.height];
  for (const [at, from, to, center, along, vertical] of [
    [top, left, right, cy, cx, false],
    [bottom, left, right, cy, cx, false],
    [left, top, bottom, cx, cy, true],
    [right, top, bottom, cx, cy, true],
  ] as const) {
    const off = at - center;
    if (Math.abs(off) > r) continue;
    const chord = Math.sqrt(r * r - off * off);
    const [a, b] = [Math.max(from, along - chord), Math.min(to, along + chord)];
    if (a > b) continue;
    distance = Math.min(
      distance,
      vertical ? distanceToSegment(x, y, at, a, at, b) : distanceToSegment(x, y, a, at, b, at),
    );
  }
  return distance;
}

/** The part of a convex polygon (its corners' x and y in turn) inside `box`. */
function clipPolygon(points: number[], box: Readonly<Rect>): number[] {
  // Each side of the box: the axis it limits, where, and which side it keeps.
  const sides = [
    [0, box.x, 1],
    [0, box.x + box.width, -1],
    [1, box.y, 1],
    [1, box.y + box.height, -1],
  ] as const;
  let out = points;
  for (const [axis, at, keep] of sides) {
    const corners = out;
    const n = corners.length / 2;
    out = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const a = (corners[i * 2 + axis]! - at) * keep;
      const b = (corners[j * 2 + axis]! - at) * keep;
      if (a >= 0) out.push(corners[i * 2]!, corners[i * 2 + 1]!);
      if (a >= 0 !== b >= 0) {
        const t = a / (a - b);
        out.push(
          corners[i * 2]! + t * (corners[j * 2]! - corners[i * 2]!),
          corners[i * 2 + 1]! + t * (corners[j * 2 + 1]! - corners[i * 2 + 1]!),
        );
      }
    }
  }
  return out;
}

/** How far a point is from a polygon (0 inside it); Infinity for none, or one of no area. */
function distanceToPolygon(points: number[], x: number, y: number): number {
  const n = points.length / 2;
  let area = 0;
  for (let i = 0, j = n - 1; i < n; j = i++)
    area += points[j * 2]! * points[i * 2 + 1]! - points[i * 2]! * points[j * 2 + 1]!;
  if (!(Math.abs(area) > 1e-9)) return Number.POSITIVE_INFINITY;
  let inside = false;
  let distance = Number.POSITIVE_INFINITY;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, ay, bx, by] = [
      points[i * 2]!,
      points[i * 2 + 1]!,
      points[j * 2]!,
      points[j * 2 + 1]!,
    ];
    if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside;
    distance = Math.min(distance, distanceToSegment(x, y, ax, ay, bx, by));
  }
  return inside ? 0 : distance;
}

/** How far a point is from the segment between two others. */
export function distanceToSegment(
  px: number,
  py: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const squared = dx * dx + dy * dy;
  const t = squared > 0 ? Math.min(1, Math.max(0, ((px - x0) * dx + (py - y0) * dy) / squared)) : 0;
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
}

/**
 * Whether paint order `a` comes after `b`, each a list compared in turn
 * (a highlight's selected rows over the others, then series, then position).
 */
export function paintedLater(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return false;
}
