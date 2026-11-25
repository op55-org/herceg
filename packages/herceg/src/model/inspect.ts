// Inspection: finding the data under a pointer or keyboard cursor, for
// tooltips, hover events, and the accessible live region. An Inspector holds
// what one scene drew; the chart model makes one per scene.

import { bisect } from "../data/bisect.ts";
import type { Formatter } from "../format/format.ts";
import { STILL } from "../marks/dodge.ts";
import type { Frame, Hit, Mark, RowParts } from "../marks/mark.ts";
import { offAxis } from "../marks/row-bindings.ts";
import {
  lowerPosition,
  placeAt,
  rowOf,
  type Series,
  samePositions,
  valueAt,
  xAt,
} from "../marks/series.ts";
import type { ContentRun, InspectedField, TooltipWriter } from "../marks/tooltip-fields.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { InspectionMode, Snap } from "../spec/spec.ts";
import { earliest, type Nearest, settle, type TakeEarliest } from "./nearest.ts";

/** One point of an inspection: a series' point, or a layout mark's item. */
export interface InspectedPoint {
  /** The point's mark: its index in the chart's `marks`. */
  mark: number;
  /** The mark's `id`, when it has one. */
  markId: string | undefined;
  /** Identifies the point's series, or a layout mark's item, in the chart. */
  key: string;
  /** What the tooltip names the point by: its series' name, a heatmap cell's row category, or an item's name. */
  label: string;
  /**
   * The position in the mark's table of the row the point is, which
   * `table.value(field, row)` reads (rows dropped from the front renumber
   * the others). Undefined when no one row is the point: histogram bins,
   * box plot and violin groups, pie slices, funnel stages, tree nodes, and
   * network and Sankey nodes and links summarize rows.
   */
  row: number | undefined;
  color: string;
  /** Formatted value, or "low – high" for bands. */
  text: string;
  value: number;
  px: number;
  py: number;
  /** The fields of `row` its mark's tooltip shows besides its value (the mark's `tooltip.fields`). */
  fields?: readonly InspectedField[];
  /**
   * The point's row as its mark's `tooltip.content` writes it, in place of
   * `label` and `text`: its parts' text, each with its part's style, as
   * written when inspected.
   */
  content?: readonly ContentRun[];
  /**
   * The heading its mark's `tooltip.heading` writes for it, which heads a
   * tooltip showing this point alone: its parts' text, each with its
   * part's style, as written when inspected.
   */
  heading?: readonly ContentRun[];
  /**
   * A layout item's names from the top, as `getItems` gives them: a tree
   * node's path below the whole tree's root (drilled or not), a pie slice's
   * or a funnel stage's category. Only items of pies, funnels, treemaps,
   * and sunbursts have them.
   */
  names?: readonly string[];
}

/** What a tooltip, hover event, or keyboard cursor is on. */
export type Inspection = AxisInspection | ItemInspection;

/** Points at a position along an axis, in charts with axes. */
export interface AxisInspection {
  /** The axis the inspection follows: "y" in nearest-y mode, otherwise "x". */
  axis: "x" | "y";
  /**
   * The value on that axis the crosshair stands at, as `inspection.snap`
   * reads: the value snapped to, the pointer's ("each"), or the latest or
   * earliest point read ("previous", "next").
   */
  value: number;
  /** Pixel position of `value` on that axis. */
  position: number;
  label: string;
  points: InspectedPoint[];
  /**
   * In charts with facets, the key of the panel inspected: its facet value,
   * or with row and column facets both values as a JSON array.
   */
  panel?: string;
}

/** One item of a chart without axes, such as a pie slice. */
export interface ItemInspection {
  axis: "item";
  key: string;
  /** The item's value. */
  value: number;
  /** What the values measure: the value field, or "Count". */
  label: string;
  /** The item, as one point. */
  points: InspectedPoint[];
  /** SVG path data outlining the item. */
  outline: string;
  /** The item's data by field, for items of several values (a 3D chart's points): numbers, times in epoch ms, and categories. */
  values?: Readonly<Record<string, number | string>>;
  panel?: string;
}

/** Points not drawn a walk along an axis steps over in a row (see `Inspector.walk`). */
const GAP_WALK = 1024;

/** Drawn points a walk along an axis hands on, either way (see `Inspector.walk`). */
const TIE_WALK = 1024;

/** A series' candidates along an axis, handed to `earliest`'s `take` (see `earliest`). */
type Search = (take: TakeEarliest, limit: () => number) => void;

export type { InspectionMode };

/**
 * A mark and the series it resolved for a scene; for a mark that reads its
 * table's rows without series (annotations), the rows drawn when not all.
 */
export interface MarkSeries {
  mark: Mark;
  series: Series[];
  rows?: RowParts | undefined;
}

/**
 * A mark a panel inspects: its series there, its index in the chart's
 * marks, and the frame it was drawn with where that is not its axis' (a
 * mark of every panel, by the chart's visibility in a panel with its own;
 * a mark placing rows in a frame or on a scale of the chart's own), with
 * how values are written along directions off its axes.
 */
export interface InspectedMark extends MarkSeries {
  index: number;
  frame?: Frame | undefined;
  formats?: { readonly x?: Formatter; readonly y?: Formatter } | undefined;
}

/** A y axis: the frame its marks draw with and the formatter of its values. */
export interface YAxisView {
  frame: Frame;
  formatY: Formatter;
}

/** What an Inspector needs from the scene it inspects. */
export interface DrawnScene {
  marks: InspectedMark[];
  /** The frame of marks on the left y axis; its x scale is every mark's. */
  frame: Frame;
  /** The right y axis and the marks on it, when any are. */
  right?: (YAxisView & { marks: ReadonlySet<Mark> }) | undefined;
  mode: InspectionMode;
  /** Which point of each series an inspection along an axis reads (see `Snap`). */
  snap?: Snap | undefined;
  /**
   * How far from the pointer's value a point may be read: `{ px }` for
   * "nearest", else in the axis' units (milliseconds on time axes).
   */
  within?: number | { px: number } | { milliseconds: number } | undefined;
  /** Series the user hid; they are never inspected. */
  hidden: ReadonlySet<string>;
  formatX: Formatter;
  formatY: Formatter;
  formatValue: Formatter;
  /** Writes the fields and content marks' tooltips show, once the chart has loaded what writes them. */
  writer?: TooltipWriter | undefined;
}

interface ReadableMark extends InspectedMark {
  axis: YAxisView;
  frame: Frame;
  visible: Series[];
}

export class Inspector {
  readonly marks: ReadableMark[];
  readonly #frame: Frame;
  readonly mode: InspectionMode;
  /** Which point of each series an inspection along an axis reads (see `Snap`). */
  readonly snap: Snap;
  /** How far from the pointer a point read may be, in the mode's units (see `InspectionSpec`). */
  readonly within: number;
  readonly #formatX: Formatter;
  readonly #formatValue: Formatter;
  readonly #writer: TooltipWriter | undefined;
  readonly #left: YAxisView;
  readonly #right: DrawnScene["right"];

  get frame(): Frame {
    return this.#frame;
  }

  get formatX(): Formatter {
    return this.#formatX;
  }

  get formatValue(): Formatter {
    return this.#formatValue;
  }

  /** The frame of marks on the right y axis, when any are. */
  get rightFrame(): Frame | undefined {
    return this.#right?.frame;
  }

  /** How values of the right y axis are formatted, when marks are on it. */
  get formatRight(): Formatter | undefined {
    return this.#right?.formatY;
  }
  /** The scene entry owning each series, including its mark and chart index. */
  readonly #ownerOf = new Map<Series, ReadableMark>();
  /** The marks in the order the panel paints them (see scene/paint.ts), which picking follows. */
  readonly #painted: readonly ReadableMark[];

  constructor(scene: DrawnScene) {
    this.#frame = scene.frame;
    this.mode = scene.mode;
    // A number, or one in pixels or milliseconds.
    const within = scene.within as { px?: number; milliseconds?: number } | undefined;
    this.snap = scene.snap ?? "shared";
    this.within = within?.px ?? within?.milliseconds ?? (within as number | undefined) ?? Infinity;
    this.#formatX = scene.formatX;
    this.#formatValue = scene.formatValue;
    this.#writer = scene.writer;
    this.#left = { frame: scene.frame, formatY: scene.formatY };
    this.#right = scene.right;
    this.marks = scene.marks.map((entry) => {
      const axis = this.axisOf(entry.mark);
      const frame = entry.frame ?? axis.frame;
      const series = entry.mark.readSeries?.(entry.series, frame) ?? entry.series;
      const hidden = entry.frame?.hidden ?? scene.hidden;
      // Marks that leave inspection (`inspect: false`) show nothing to read.
      const shown = entry.mark.spec.inspect !== false;
      const visible = series.filter((s) => shown && !hidden.has(s.key) && s.length > 0);
      const owner = { ...entry, series, axis, frame, visible };
      for (const s of series) this.#ownerOf.set(s, owner);
      return owner;
    });
    // By zIndex, ties as declared; the keyboard and descriptions keep `marks`' order.
    const z = ({ mark }: ReadableMark) => mark.spec.zIndex ?? 0;
    this.#painted = this.marks.some(z) ? [...this.marks].sort((a, b) => z(a) - z(b)) : this.marks;
  }

  #visibleSeries(filter: (mark: Mark) => boolean): Series[] {
    return this.marks.flatMap(({ mark, visible }) => (filter(mark) ? visible : []));
  }

  /**
   * Finds the data under a pointer position for tooltips. "nearest-x" reads
   * the visible series along x, each as `snap` says (the chart's
   * inspection's by default), within its `within`; "nearest-y" the same
   * along y; "nearest" reads the single closest point. Sorted series use
   * binary search; marks with their own lookup (grid indexes, cell tables)
   * use it.
   */
  inspect(
    px: number,
    py: number,
    mode?: InspectionMode,
    snap = this.snap,
  ): AxisInspection | undefined {
    const { plot } = this.#frame;
    if (px < plot.x || px > plot.x + plot.width || py < plot.y || py > plot.y + plot.height)
      return undefined;
    const requested = mode ?? this.mode;
    const within = this.within;
    // Cells are always found under the pointer, so with nothing placed along
    // an axis (heatmaps only) every mode inspects the nearest cell.
    const axis = requested === "nearest-y" ? "y" : "x";
    // Points placed off the axis (in a frame, on a scale of the chart's own) are found nearest only.
    let series = this.#visibleSeries(
      (mark) =>
        mark.tooltip !== "cell" &&
        (!mark.place || mark.tooltip === axis) &&
        !offAxis(mark.bound, axis),
    );
    if (requested === "nearest" || series.length === 0) {
      const hit = this.#nearest(px, py);
      // Cells are found under the pointer, whatever `within` a mode along an axis asked for.
      if (!hit || (requested === "nearest" && hit.distance > within)) return undefined;
      const point = this.#point(hit.series, hit.position, hit.at);
      if (!point) return undefined;
      // The heading names where the point is placed: its x, or its y
      // category for marks along y; for a line or region, where it was found.
      const owner = this.#ownerOf.get(hit.series)!;
      const axis = owner.mark.tooltip === "y" ? "y" : "x";
      const value = hit.at
        ? owner.frame[axis].invert(hit.at[axis === "x" ? 0 : 1])
        : placeAt(hit.series, axis, rowOf(hit.series, hit.position));
      return this.#inspection(axis, value, [point], owner.axis, owner);
    }
    // Values along y compare within one y axis: the left one, or the right
    // one when only it has series.
    let yAxis = this.#left;
    if (axis === "y" && this.#right) {
      const left = series.filter((s) => this.#ownerOf.get(s)!.axis === this.#left);
      if (left.length > 0) series = left;
      else yAxis = this.#right;
    }
    // Which side of the pointer's value each series reads: either, before, or after it.
    const side = snap === "previous" ? -1 : snap === "next" ? 1 : 0;
    const shared = snap === "shared";
    // Distances are measured from the pointer's own pixel.
    const pointer = axis === "x" ? px : py;
    const points: InspectedPoint[] = [];
    let snapped = side < 0 ? -Infinity : Infinity;
    // With "shared", each series' candidates and their owner, searched as
    // one, and the least distance of any.
    const searches: [Search, ReadableMark][] = [];
    let bound = Infinity;
    for (const s of series) {
      const owner = this.#ownerOf.get(s)!;
      const { frame } = owner;
      // Each series as drawn: on its axis' scale, moved by its offset, which
      // shows the values its domain holds.
      const scale = frame[axis];
      const { domain } = scale;
      const lo = Math.min(domain[0], domain[1]);
      const hi = Math.max(domain[0], domain[1]);
      const target = scale.invert(pointer);
      // Values as drawn: a panel's own categories are places of the chart's (`placeAt`).
      const at = (k: number) => placeAt(s, axis, rowOf(s, k));
      // What is read is in view on its side of the pointer's value (as that
      // value is), and within reach of it.
      const keep = (v: number) =>
        (v < target ? v >= lo : v <= hi) && Math.abs(v - target) <= within;
      // Where its path ends: a series reads none inside a gap it leaves.
      const ends = s.features?.pathEnds?.(s, frame);
      let search: Search | undefined;
      let position = -1;
      // The distance of its nearest candidate, where known before searching.
      let near = Infinity;
      const sorted = axis === "x" ? s.sorted || s.placesSorted : s.ySorted;
      if (sorted) {
        // The drawn points either side of the pointer's value, in view or not.
        const [a, b] = this.around(s, axis, scale, target, at);
        if (a >= 0 && b >= 0 && at(b) > target && ends?.(rowOf(s, a), 1)) continue;
        // "previous": the last drawn at or before the value, of those at it the last.
        if (side < 0)
          position = this.#drawnFrom(
            s,
            axis,
            scale,
            bisect(s.length, (k) => at(k) <= target) - 1,
            -1,
          );
        else if (side > 0) position = b;
        // Outward from them each way, while points in reach may tie with
        // the nearer of them in reach.
        else {
          for (const k of [a, b])
            if (k >= 0 && keep(at(k))) near = Math.min(near, Math.abs(scale.map(at(k)) - pointer));
          search = (take, limit) => {
            const visit = (k: number, distance: number) => {
              const v = at(k);
              if (!keep(v)) return false;
              take(k, distance, v);
            };
            this.walk(s, axis, scale, pointer, a, -1, limit, visit);
            this.walk(s, axis, scale, pointer, b, 1, limit, visit);
          };
        }
      } else if (!side) {
        if (ends && inGap(s, at, ends, target)) continue;
        // By a scan: unsorted series may hold several rows at one position
        // (long-format bars), some of them missing, so every row is checked.
        search = (take, limit) => {
          // The limit changes only as rows are taken.
          let bound = limit();
          for (let k = 0; k < s.length; k++) {
            const v = at(k);
            if (!(v >= lo && v <= hi && keep(v))) continue;
            const distance = Math.abs(scale.map(v) - pointer);
            if (!(distance <= bound) || !this.drawn(s, rowOf(s, k))) continue;
            take(k, distance, v);
            bound = limit();
          }
        };
      }
      if (search && shared) {
        searches.push([search, owner]);
        bound = Math.min(bound, near);
        continue;
      }
      if (search) {
        position = earliest(search, near);
        // Of points at its value, the first drawn, as `inspectAt` reads them.
        if (sorted && position > 0 && at(position - 1) === at(position))
          position = this.#firstAt(s, at, at(position));
      }
      if (position < 0 || !keep(at(position))) continue;
      const point = this.#point(s, position);
      if (!point) continue;
      points.push(point);
      const value = at(position);
      snapped = side < 0 ? Math.max(snapped, value) : Math.min(snapped, value);
    }
    // The value the series share: the nearest any has over every series'
    // candidates, the earliest of ties, read for the first series having it.
    let by: ReadableMark | undefined;
    if (shared)
      earliest((take, limit) => {
        by = undefined;
        for (const [search, owner] of searches)
          search((k, distance, value) => {
            const wins = take(k, distance, value);
            if (wins) [by, snapped] = [owner, value];
            return wins;
          }, limit);
      }, bound);
    // Cells are read under the pointer, beside the series read along the axis.
    const cells: InspectedPoint[] = [];
    for (const { mark, visible, frame } of this.marks) {
      const hit = mark.tooltip === "cell" ? mark.pick?.(visible, px, py, frame) : undefined;
      const point = hit && this.#point(hit.series, hit.position);
      if (point) cells.push(point);
    }
    if (!shared || !by) {
      if (points.length + cells.length === 0) return undefined;
      // Each series' own point: the crosshair stays at the pointer, or the latest or earliest read.
      const at = side && points.length ? snapped : yAxis.frame[axis].invert(pointer);
      return this.#inspection(axis, at, [...points, ...cells], yAxis);
    }
    const inspection = this.inspectAt(axis, snapped, series, yAxis);
    inspection.points.push(...cells);
    // The cursor stands where the series snapped to draws the value.
    return by?.mark.bound?.[axis]
      ? { ...inspection, position: by.frame[axis].map(snapped) }
      : inspection;
  }

  /**
   * In a series sorted along `axis`, the first drawn position from `k` on
   * stepping `by` (1 or -1), as `walk` steps; -1 for none. Inside a longer
   * gap of points not drawn, no point is near enough.
   */
  #drawnFrom(s: Series, axis: "x" | "y", scale: PositionScale, k: number, by: 1 | -1): number {
    let found = -1;
    this.walk(
      s,
      axis,
      scale,
      0,
      k,
      by,
      () => Infinity,
      (j) => {
        found = j;
        return false;
      },
    );
    return found;
  }

  /**
   * The drawn points of `s`, sorted along `axis` and placed on `scale`,
   * either side of `target` there, in view or not, as `at` places its
   * positions: the last before it and the first at or after it, each within
   * GAP_WALK; where points at it are drawn only past that, the first drawn
   * of them. -1 for none.
   */
  around(
    s: Series,
    axis: "x" | "y",
    scale: PositionScale,
    target: number,
    at: (k: number) => number,
  ): [number, number] {
    const k0 = bisect(s.length, (k) => at(k) < target);
    const b = this.#drawnFrom(s, axis, scale, k0, 1);
    return [
      this.#drawnFrom(s, axis, scale, k0 - 1, -1),
      b < 0 && k0 < s.length && at(k0) === target ? this.#firstAt(s, at, target) : b,
    ];
  }

  /**
   * Walks a series sorted along `axis` as readings along it walk outward
   * from the pointer, at pixel `pointer` on `scale`: from position `k`
   * stepping `by` (1 or -1), jumping points a break of the x axis hides, it
   * hands `visit` each drawn one, its distance on screen, and where it is
   * drawn. It stops at the first position, drawn or not, farther past the
   * pointer the way it goes than `limit()` (or with no place on the scale),
   * after GAP_WALK in a row not drawn, after TIE_WALK drawn, or where
   * `visit` returns false. Pixels follow values on every axis, so past that
   * first position none is nearer.
   */
  walk(
    s: Series,
    axis: "x" | "y",
    scale: PositionScale,
    pointer: number,
    k: number,
    by: 1 | -1,
    limit: () => number,
    visit: (k: number, distance: number, pixels: readonly [number, number]) => unknown,
  ): void {
    const breaks = axis === "x" && this.#frame.x.breaks;
    const { domain, range } = scale;
    // Pixels run the way values do, or the other way.
    const way = (range[1] - range[0]) * (domain[1] - domain[0]) < 0 ? -by : by;
    for (let gap = 0, walked = 0; gap < GAP_WALK && walked < TIE_WALK; k += by) {
      if (breaks && k >= 0 && k < s.length)
        k =
          by < 0 ? breaks.shownBefore(s.x, k, s.rows) : breaks.shownFrom(s.x, k, s.length, s.rows);
      if (k < 0 || k >= s.length) return;
      const row = rowOf(s, k);
      const ahead = way * (scale.map(placeAt(s, axis, row)) - pointer);
      if (!(ahead <= limit())) return;
      const pixels = this.drawn(s, row);
      if (!pixels) {
        gap++;
        continue;
      }
      gap = 0;
      walked++;
      if (visit(k, Math.abs(ahead), pixels) === false) return;
    }
  }

  /**
   * The first drawn position of `s` at `value`, as `at` places its
   * positions: by halves where `s` is sorted by them, else by a scan; -1
   * for none.
   */
  #firstAt(s: Series, at: (k: number) => number, value: number, sorted = true): number {
    for (let k = sorted ? bisect(s.length, (j) => at(j) < value) : 0; k < s.length; k++) {
      if (at(k) !== value) {
        if (sorted) break;
      } else if (this.drawn(s, rowOf(s, k))) return k;
    }
    return -1;
  }

  /** The y axis a mark is on. */
  axisOf(mark: Mark | undefined): YAxisView {
    return mark && this.#right?.marks.has(mark) ? this.#right : this.#left;
  }

  /**
   * Where a point is drawn, as inspections mark it; undefined unless its
   * value is finite and both scales can place it. A point of a mark
   * inspected along y (a horizontal bar) also needs part of it, from base
   * to end, inside the x domain; its end may lie outside the plot.
   */
  drawn(s: Series, row: number): readonly [number, number] | undefined {
    const pixels = this.#pixels(s, row);
    const mark = this.#ownerOf.get(s)!.mark;
    if (!pixels || mark.place || mark.tooltip !== "y") return pixels;
    const { x } = this.#ownerOf.get(s)!.frame;
    const end = s.x[row]!;
    const base = s.x0?.[row] ?? (mark.zero === "x" ? 0 : end);
    const [from, to] = mark.span?.(s, row) ?? [Math.min(base, end), Math.max(base, end)];
    const lo = Math.min(x.domain[0], x.domain[1]);
    const hi = Math.max(x.domain[0], x.domain[1]);
    return to >= lo && from <= hi ? pixels : undefined;
  }

  /**
   * Whether a point can be placed: its value is finite, both scales place
   * it (rows without a band, index -1, have no place), and so does the low
   * end of a range.
   */
  #pixels(s: Series, row: number): readonly [number, number] | undefined {
    const { mark, frame } = this.#ownerOf.get(s)!;
    if (mark.place) return mark.place(s, row, frame);
    const finite = Number.isFinite;
    if (!finite(s.values[row]!)) return undefined;
    const { x, y } = frame;
    const at = placeAt(s, "x", row);
    const across = placeAt(s, "y", row);
    const px = x.map(at);
    const py = y.map(across);
    if (!finite(px) || !finite(py)) return undefined;
    if ((x.type === "band" && at < 0) || (y.type === "band" && across < 0)) return undefined;
    if (
      x.breaks?.hides(at) ||
      !(mark.shows?.(s, row, y, x) ?? true) ||
      s.features?.drawn?.(row) === false
    )
      return undefined;
    if (s.range) {
      const along = mark.tooltip === "y";
      const low = (along ? s.x0 : s.y0)?.[row] ?? Number.NaN;
      const scale = along ? x : y;
      if (!finite(scale.map(low)) || (scale.type === "band" && low < 0)) return undefined;
    }
    // A heatmap's cell is at its center, which its value need not be.
    if (mark.pointAnchor) return mark.pointAnchor(s, row, frame);
    // Marks spreading rows across their bands (dodge, jitter) draw them off their values' place.
    const [dx, dy] = mark.displace?.(s, row, frame) ?? STILL;
    return [px + dx, py + dy];
  }

  /** What is drawn nearest a pixel: of what ties with it, the one on top. */
  #nearest(px: number, py: number): Hit | undefined {
    return settle((found) => this.#visit(px, py, found));
  }

  /** Hands what is drawn near a pixel to `found`, in paint order, but for what is farther than its limit. */
  #visit(px: number, py: number, found: Nearest): void {
    for (const { mark, visible: series, frame } of this.#painted) {
      const { x } = frame;
      const target = x.invert(px);
      if (mark.nearby) {
        mark.nearby(series, px, py, frame, found);
        continue;
      }
      if (mark.pick) {
        const hit = mark.pick(series, px, py, frame);
        if (hit) found.take(hit, mark);
        continue;
      }
      const lit = mark.table && frame.highlighted?.(mark.table);
      for (const s of series) {
        const consider = (k: number) => {
          const row = rowOf(s, k);
          const pixels = this.drawn(s, row);
          if (pixels)
            found.take(
              { series: s, position: k, distance: Math.hypot(pixels[0] - px, pixels[1] - py) },
              mark,
              lit?.[row],
            );
        };
        // Marks spreading rows across their bands draw them up to `reach` off their x.
        const reach = mark.maxDisplacement?.(s, frame) ?? 0;
        if (!s.sorted || reach === Infinity) {
          for (let k = 0; k < s.length; k++) consider(k);
          continue;
        }
        // Walk outward from the pointer's x on each side until points are
        // horizontally farther than ties reach: screen distance grows
        // away from it either way, on any scale.
        const after = lowerPosition(s, target);
        const within = (k: number) => Math.abs(x.map(xAt(s, k)) - px) - reach <= found.limit;
        // Hidden points all sit at their break's seam: they are jumped.
        const breaks = x.breaks;
        const back = (k: number) => (breaks ? breaks.shownBefore(s.x, k, s.rows) : k);
        const ahead = (k: number) => (breaks ? breaks.shownFrom(s.x, k, s.length, s.rows) : k);
        for (let k = back(after - 1); k >= 0 && within(k); k = back(k - 1)) consider(k);
        for (let k = ahead(after); k < s.length && within(k); k = ahead(k + 1)) consider(k);
      }
    }
  }

  /**
   * Every series' point at `value` on `axis` (for "y", a value of `yAxis`);
   * with an `anchor` series, at its position `anchorPosition` for the
   * series sharing its positions.
   */
  inspectAt(
    axis: "x" | "y",
    value: number,
    series: readonly Series[],
    yAxis = this.#left,
    anchor?: Series,
    anchorPosition?: number,
  ): AxisInspection {
    const points: InspectedPoint[] = [];
    for (const s of series) {
      // Series sharing the anchor's positions are read at its row: at an x
      // several rows share, the first would hide the others. Marks pairing
      // rows of their series say which to read.
      const position =
        anchor && (s === anchor || samePositions(s, anchor, axis))
          ? anchorPosition!
          : ((anchor && this.#ownerOf.get(s)!.mark.alongside?.(s, anchor, anchorPosition!)) ??
            this.#positionAt(s, axis, value));
      if (position < 0) continue;
      const point = this.#point(s, position);
      if (point) points.push(point);
    }
    // An anchor placed off the axis is headed by its own place.
    return this.#inspection(axis, value, points, yAxis, anchor && this.#ownerOf.get(anchor));
  }

  /** Position of a drawn point of `s` at `value` on `axis`, or -1. */
  #positionAt(s: Series, axis: "x" | "y", value: number): number {
    // Of several points at this x, the first one drawn.
    const sorted = s.sorted && (axis === "x" || !!this.#ownerOf.get(s)!.mark.place);
    const at = sorted ? (k: number) => xAt(s, k) : (k: number) => placeAt(s, axis, rowOf(s, k));
    return this.#firstAt(s, at, value, sorted);
  }

  /**
   * An inspection at `value` on `axis` (for "y", a value of `yAxis`), or
   * for a point `owner` places off that axis, at its value there.
   */
  #inspection(
    axis: "x" | "y",
    value: number,
    points: InspectedPoint[],
    yAxis = this.#left,
    owner?: ReadableMark,
  ): AxisInspection {
    const off = owner && offAxis(owner.mark.bound, axis);
    return {
      axis,
      value,
      // Where the owner draws it: in its frame, or moved by its offset.
      position: (owner?.mark.bound?.[axis] ? owner.frame : yAxis.frame)[axis].map(value),
      label: off
        ? this.#formatOf(owner, axis)(value)
        : axis === "x"
          ? this.#formatX(value)
          : yAxis.formatY(value),
      points,
    };
  }

  /** How `owner`'s values along `axis` are written: as its axis writes them, or where it places them off it, as there. */
  #formatOf(owner: ReadableMark, axis: "x" | "y"): Formatter {
    if (!offAxis(owner.mark.bound, axis)) return axis === "x" ? this.#formatX : owner.axis.formatY;
    return owner.formats?.[axis] ?? this.#formatValue;
  }

  #point(s: Series, position: number, at?: readonly [number, number]): InspectedPoint | undefined {
    const row = rowOf(s, position);
    const value = valueAt(s, row);
    // What a scale cannot place (log axes, missing ends) is not drawn, so not reported.
    const pixels = at ?? this.#pixels(s, row);
    if (!pixels) return undefined;
    const [px, py] = pixels;
    const owner = this.#ownerOf.get(s)!;
    const { mark, index } = owner;
    // Marks inspected along y (horizontal bars) measure their values on x;
    // marks of cells name and measure their points themselves.
    const along = mark.tooltip === "y";
    const format = {
      x: this.#formatOf(owner, "x"),
      y: this.#formatOf(owner, "y"),
      value: this.#formatValue,
    };
    const axis = along ? format.x : format.y;
    // A series of a field's values writes them as the field's display does, over its axis.
    const formatValue = s.write?.(axis) ?? axis;
    const label = mark.pointLabel?.(s, row, format) ?? s.label;
    const text = mark.pointText?.(s, row, format) ?? formatValue(value);
    // Summarizing marks' series index rows of their summaries.
    const one = mark.summarizes ? undefined : row;
    return {
      mark: index,
      markId: mark.spec.id,
      key: s.key,
      label,
      row: one,
      ...this.#writer?.(mark, one, { label, value, text }),
      color: mark.pointColor?.(s, row, this.#frame.theme, this.#frame.paint) ?? s.color,
      value,
      text,
      px,
      py,
    };
  }
}

/**
 * Whether `target` is in a gap of a series drawn in its own order (as `at`
 * places its positions): between points of it, at none, and crossed by no
 * segment its path draws (`ends` says where it ends). Past its points, it
 * reads its nearest end, as sorted series do.
 */
function inGap(
  s: Series,
  at: (k: number) => number,
  ends: (row: number, way: 1 | -1) => boolean,
  target: number,
): boolean {
  let [below, above] = [false, false];
  for (let k = 0; k < s.length; k++) {
    const value = at(k);
    if (value === target) return false;
    if (k + 1 < s.length && !ends(rowOf(s, k), 1) && (value - target) * (at(k + 1) - target) < 0)
      return false;
    below ||= value < target;
    above ||= value > target;
  }
  return below && above;
}
