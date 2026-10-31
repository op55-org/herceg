// Drawn-mark records: what one frame drew of one mark in one panel
// (docs/architecture/marks.md "Drawn marks"). A picker tests a record's
// geometry by kind, then asks `partOf` (drawn-parts.ts, which only pickers
// load) what the primitive it hit stands for; marks whose geometry says
// too little pick their own items (`pickItem`). Records reference the
// scene's geometry and series; they copy nothing, and cost a frame one
// object per mark and panel.

import type { Table } from "../data/table.ts";
import type { KeyPart } from "../model/items.ts";
import type { Geometry, Rect } from "../scene/scene.ts";
import type { Curve } from "../spec/spec.ts";
import type { LayoutMark, LayoutResult } from "./layout-mark.ts";
import type { Lookups } from "./lookups.ts";
import type { Frame, MarkKey } from "./mark.ts";
import type { Series } from "./series.ts";

/** A position in a series, as drawn. */
export interface DrawnRow {
  readonly series: Series;
  readonly position: number;
}

/**
 * What a drawn primitive draws:
 * - a row of a table, with its series and position where it has one
 *   (annotations' rows have none);
 * - a group: an aggregate's or a layout item's key, with the series
 *   point it is where a mark found it as one (a bin, a box);
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
  | { readonly kind: "group"; readonly key: string; readonly point?: DrawnRow | undefined }
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
  /** For layout marks: what they laid out, whose items `itemAt` finds (model/pick.ts `pickLayout`). */
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
  /** Only this series' items, by key: a keyboard cursor's, wherever others are drawn over it. */
  readonly series?: string | undefined;
  /**
   * How marks with lookups of their own pick (`Mark.pickItem`), which load
   * with the picker that asks (marks/lookups.ts).
   */
  readonly lookups: Lookups;
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
  /**
   * An aggregate's group: the key of its parts and names after its mark's
   * (see `groupKey`), and the series point it is, where it is one.
   */
  group(
    drawn: DrawnMark,
    parts: readonly KeyPart[],
    names: readonly KeyPart[],
    point?: DrawnRow,
  ): DrawnPart;
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
   * For series drawn unsorted: the curve they were traced with, so each
   * path point's position can be worked out when asked (see `DrawnPart`'s
   * `positions`).
   */
  readonly unsorted?: { readonly curve: Curve | undefined } | undefined;
  /**
   * The series as its path traced it, where that is not the logical one: a
   * highlight's masked copy (`tracedBy`), of the same rows, whose missing
   * values say which rows it draws and where its runs end.
   */
  readonly traced?: Series | undefined;
}
