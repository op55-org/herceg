// Picking: the topmost item drawn under a point, tested against what the
// frame on screen drew (marks/drawn.ts records), never against geometry
// made again from current data. Marks are visited in paint order (their
// `zIndex`, then as listed), each geometry in the order it paints, and the
// first item within reach is picked: inside bars, bins, cells, and regions;
// within a stroke's half width plus `slop` of lines, rules, and segments;
// within a point's radius plus `slop`; inside areas and text. Nothing outside
// a geometry's clip is picked. A line's or area's path is resolved to the
// observation it draws nearest the point (level of detail, steps, and stacks
// draw vertices that are no rows). Marks with lookups of their own pick their
// items themselves (`Mark.pickItem`), layout marks through `itemAt`.
//
// The interaction controller loads this module; what it reads series with is
// the chart's code, handed in (`PickKit`), as the controller's is.

import type { Table } from "../data/table.ts";
import type { ruleDrawing } from "../draw/rule.ts";
import type { DrawnMark, DrawnPart, PickedItem, PickQuery } from "../marks/drawn.ts";
import { type PartKit, type PartReader, partReader } from "../marks/drawn-parts.ts";
import type { LayoutItem, LayoutMark } from "../marks/layout-mark.ts";
import { boxOf, clipBox, inside, type LookupKit, type Lookups, lookups } from "../marks/lookups.ts";
import type { Frame, Mark, MarkKey } from "../marks/mark.ts";
import type { lowerPosition, placeAt, Series } from "../marks/series.ts";

import type {
  AreaGeometry,
  Geometry,
  LabelsGeometry,
  LineGeometry,
  PointGeometry,
  Rect,
  RectGeometry,
  RuleGeometry,
  SegmentGeometry,
  TextGeometry,
  TextItem,
} from "../scene/scene.ts";
import type { KeyPart } from "./items.ts";
import type { Nearest } from "./nearest.ts";

// Events name what was picked by its item key, which loads with picking.
export { itemResolver } from "./items.ts";

import type { ChartModel } from "./model.ts";

/** What picking reads series with, handed in (see the top). */
export interface PickKit extends PartKit, LookupKit {
  placeAt: typeof placeAt;
  lowerPosition: typeof lowerPosition;
}

/** The item picked: its mark, its record, and what it is. */
export interface Picked {
  /** The record that drew it. */
  readonly drawn: DrawnMark;
  /** Its mark's key in the chart: the record's, or a map's layer's. */
  readonly key: MarkKey;
  readonly item: PickedItem;
  /** The series it is a point of, where it is one's. */
  readonly series: Series | undefined;
}

/** Points a search steps over looking for an observation a path can draw. */
const GAP_WALK = 1024;

/** Pixels apart that distances to the query tie within (as model/nearest.ts says). */
const TIE = 1e-3;

/** A geometry of a panel in paint order: its record, its mark, and its index (-1: the mark picks itself). */
interface Painted {
  drawn: DrawnMark;
  /** Undefined for a layout mark's record. */
  mark: Mark | undefined;
  g: number;
  z: number;
}

/**
 * Picks against a chart model's records: `pick` finds the topmost item at a
 * point of the chart, `textBox` measures placed text as picking does.
 */
export class Picker {
  readonly #kit: PickKit;
  readonly #parts: PartReader;
  readonly #lookups: Lookups;

  constructor(kit: PickKit) {
    this.#kit = kit;
    this.#parts = partReader(kit);
    this.#lookups = lookups(kit);
  }

  /**
   * The topmost item `model`'s last frame drew within `slop` pixels past
   * (x, y), in the topmost panel holding it (an inset over its parent), of
   * the marks `accept` takes (by default, those without `pick: false`);
   * undefined for none, or while a record is not current (its data
   * changed since).
   */
  pick(
    model: ChartModel,
    { x, y, slop, series }: Omit<PickQuery, "lookups">,
    accept?: (mark: Mark) => boolean,
  ): Picked | undefined {
    const query: PickQuery = { x, y, slop, series, lookups: this.#lookups };
    const records = model.drawnMarks();
    const marks = model.config.marks as readonly Mark[];
    const markOf = (key: MarkKey) =>
      marks[typeof key === "number" ? key : marks.findIndex(({ spec }) => spec.id === key)];
    const panels = model.allPanels();
    for (let p = panels.length - 1; p >= 0; p--) {
      const { key } = panels[p]!;
      if (model.coveredAt(key, query.x, query.y)) continue;
      const painted: Painted[] = [];
      for (const drawn of records) {
        if (drawn.panel !== key || !drawn.current()) continue;
        // A layout mark has its panel to itself.
        if (drawn.layout) {
          if (!accept) painted.push({ drawn, mark: undefined, g: -1, z: 0 });
          continue;
        }
        const mark = markOf(drawn.mark) as Mark | undefined;
        // The marks `accept` takes, else those the pointer does not pass through.
        if (!mark || (accept ? !accept(mark) : mark.spec.pick === false)) continue;
        const z = mark.spec.zIndex ?? 0;
        // Lookups, and points through their index, pick the mark's items at once.
        if (mark.pickItem || (mark.nearby && mark.reach)) painted.push({ drawn, mark, g: -1, z });
        else
          for (let g = 0; g < drawn.geometry.length; g++)
            painted.push({ drawn, mark, g, z: drawn.geometry[g]!.zIndex ?? z });
      }
      // By zIndex, ties as painted: the last is on top.
      painted.sort((a, b) => a.z - b.z);
      for (let k = painted.length - 1; k >= 0; k--) {
        const found = this.#pickPainted(painted[k]!, query);
        if (found) return found;
      }
    }
    return undefined;
  }

  #pickPainted({ drawn, mark, g }: Painted, query: PickQuery): Picked | undefined {
    if (!mark || g < 0) {
      // Nothing is picked outside the mark's clip, whatever its lookup finds within reach.
      const clipped =
        mark && !(drawn.frame && inside(clipBox(mark.spec.clip, drawn.frame), query.x, query.y));
      const item = !mark
        ? pickLayout(drawn, query)
        : clipped
          ? undefined
          : mark.pickItem
            ? mark.pickItem(drawn, query)
            : this.#pickPoint(mark, drawn, query);
      if (!item) return undefined;
      return {
        drawn,
        key: item.mark ?? drawn.mark,
        item,
        series: item.part.kind === "row" ? item.part.series?.series : item.part.point?.series,
      };
    }
    const { frame } = drawn;
    const geometry = drawn.geometry[g]!;
    // Of a query for one series, that series' geometry only.
    if (query.series !== undefined && this.#parts.seriesOf(drawn, geometry)?.key !== query.series)
      return undefined;
    // Nothing is picked outside the geometry's clip, though a stroke reached past it.
    const clip = frame && clipBox(geometry.clip ?? geometry.draw.defaultClip ?? "plot", frame);
    if (!clip || !inside(clip, query.x, query.y)) return undefined;
    // A path's points run along its axis where its series is sorted there:
    // only its segments near the query are tested.
    const path = geometry.kind === "line" || geometry.kind === "area";
    const trace = path ? this.#parts.partOf(mark, drawn, g, 0) : undefined;
    const along =
      trace?.kind === "trace" && (trace.order !== undefined || sortedAlong(trace, frame))
        ? trace.along
        : undefined;
    // An area is filled across the axis it runs along, ordered or not: a
    // trace's, or for outlines that are none (a histogram's), the mark's.
    const orient = trace?.kind === "trace" ? trace.along : mark.tooltip === "y" ? "y" : undefined;
    const hit = this.#hit(geometry, frame, clip, query, along, orient);
    if (!hit) return undefined;
    // Outlines that are no trace (a histogram's) say their item where it was picked.
    const part =
      trace?.kind === "trace" ? trace : this.#parts.partOf(mark, drawn, g, hit.index, query);
    if (!part) return undefined;
    const row =
      part.kind === "trace" ? this.#traced(part, mark.table, frame, hit, query, along) : part;
    if (!row) return undefined;
    const series = row.kind === "row" ? row.series?.series : this.#parts.seriesOf(drawn, geometry);
    const observed =
      row.kind === "row" && row.series
        ? pointBox(this.#kit, row.series.series, row.position, frame, mark)
        : undefined;
    // A path's observation is its point; one no scale places (a stack's zero
    // drawn at a log axis' end) is the path's vertex nearest the query.
    const box =
      part.kind === "trace" ? (observed ?? nearerEnd(hit.segment!, query)) : (hit.box ?? observed);
    if (!box) return undefined;
    return {
      drawn,
      key: drawn.mark,
      item: { part: row, names: undefined, box, distance: hit.distance },
      series,
    };
  }

  /**
   * The point of a mark with an index of its points (`nearby`) whose glyph
   * is nearest the query, within its reach plus `slop`; of glyphs as near
   * (the query inside several), the one painted on top.
   */
  #pickPoint(mark: Mark, drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
    const { frame } = drawn;
    const { x, y, slop } = query;
    const { rowOf } = this.#kit;
    if (!frame || !mark.table) return undefined;
    // What tooltips look among: series shown, with rows (the query's only, if it names one).
    const shown = drawn.series.filter(
      (s) => !frame.hidden.has(s.key) && s.length > 0 && (query.series ?? s.key) === s.key,
    );
    // The index hands every point whose center is as near as the farthest
    // any glyph reaches, past `slop`, in paint order.
    const { inset } = mark;
    const far = Math.max(
      0,
      ...shown.map((s) => (inset ? Math.max(inset.x, inset.y) : (s.features?.points?.reach ?? 0))),
    );
    const found = {
      limit: far + slop,
      best: undefined as
        | { series: Series; position: number; reach: number; distance: number; lit: number }
        | undefined,
      take(
        { series, position, distance }: { series: Series; position: number; distance: number },
        _mark: Mark,
        lit = 0,
        over?: (a: number, b: number) => boolean,
      ) {
        const reach = mark.reach!(rowOf(series, position), series);
        const near = Math.max(0, distance - reach);
        const { best } = found;
        if (!(near <= slop) || (best && near > best.distance + TIE)) return;
        // As near: highlighted rows paint over the rest, then what paints later.
        if (best && near >= best.distance - TIE) {
          const later = best.series === series && over ? over(position, best.position) : true;
          if (lit !== best.lit ? lit < best.lit : !later) return;
        }
        found.best = { series, position, reach, distance: near, lit };
      },
    };
    mark.nearby!(shown, x, y, frame, found as unknown as Nearest);
    const { best } = found;
    if (!best) return undefined;
    const { series, position, reach, distance } = best;
    const row = rowOf(series, position);
    const at = pointBox(this.#kit, series, row, frame, mark);
    if (!at) return undefined;
    return {
      part: { kind: "row", table: mark.table, position: row, series: { series, position } },
      names: undefined,
      box: { x: at.x - reach, y: at.y - reach, width: 2 * reach, height: 2 * reach },
      distance,
    };
  }

  /**
   * The primitive of `geometry` under the query, by kind: its index, how
   * far it is from the query (0 inside it), its drawn box where the
   * primitive has one, and for paths the segment hit.
   */
  #hit(
    geometry: Geometry,
    frame: Frame,
    clip: Readonly<Rect>,
    { x, y, slop }: PickQuery,
    along: "x" | "y" | undefined,
    orient: "x" | "y" | undefined,
  ): Hit | undefined {
    switch (geometry.kind) {
      case "rect": {
        const { rects, count } = geometry as RectGeometry;
        // Rectangles painted later are on top. Kept to single precision,
        // their edges are reached to within it (a bin's top, where its
        // inspection reads it).
        for (let i = count - 1; i >= 0; i--) {
          const box = {
            x: rects[i * 4]!,
            y: rects[i * 4 + 1]!,
            width: rects[i * 4 + 2]!,
            height: rects[i * 4 + 3]!,
          };
          const [dx, dy] = [
            Math.abs(x - box.x - box.width / 2),
            Math.abs(y - box.y - box.height / 2),
          ];
          if (dx <= box.width / 2 + TIE && dy <= box.height / 2 + TIE)
            return { index: i, distance: 0, box };
        }
        return undefined;
      }
      case "point": {
        const { coords, count, radius, radii } = geometry as PointGeometry;
        let best: Hit | undefined;
        for (let i = 0; i < count; i++) {
          const r = radii ? radii[i]! : radius;
          const [cx, cy] = [coords[i * 2]!, coords[i * 2 + 1]!];
          const distance = Math.max(0, Math.hypot(cx - x, cy - y) - r);
          // Of points as near, the one painted last.
          if (distance <= slop && !(best && best.distance < distance))
            best = {
              index: i,
              distance,
              box: { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r },
            };
        }
        return best;
      }
      // Strokes are reached as the clip shows them, and not at all where
      // they have no width (renderers draw none).
      case "line": {
        const { path, strokeWidth } = geometry as LineGeometry;
        const half = strokeWidth / 2;
        return half > 0 ? nearestSegment(path, half + slop, x, y, half, along, clip) : undefined;
      }
      case "area":
        return areaHit(geometry as AreaGeometry, x, y, slop, along, orient, clip);
      case "rule": {
        const rule = geometry as RuleGeometry;
        const { x1, y1, x2, y2, strokeWidth } = rule;
        const half = strokeWidth / 2;
        const shown = half > 0 ? shownDistance(x, y, x1, y1, x2, y2, clip, half) : Infinity;
        const distance = Math.max(0, shown - half);
        if (distance <= slop) return { index: 0, distance, box: boxOf(x1, y1, x2, y2) };
        // Its label, drawn whatever the line's width.
        const box = (rule.draw as typeof ruleDrawing).labelBox?.(rule, frame.theme.fontSize);
        return box && inside(box, x, y) ? { index: 0, distance: 0, box } : undefined;
      }
      case "segments": {
        const { coords, count, strokeWidth } = geometry as SegmentGeometry;
        const half = strokeWidth / 2;
        if (!(half > 0)) return undefined;
        let best: Hit | undefined;
        for (let i = 0; i < count; i++) {
          const [x1, y1, x2, y2] = [
            coords[i * 4]!,
            coords[i * 4 + 1]!,
            coords[i * 4 + 2]!,
            coords[i * 4 + 3]!,
          ];
          const distance = Math.max(0, shownDistance(x, y, x1, y1, x2, y2, clip, half) - half);
          if (distance <= slop && !(best && best.distance < distance))
            best = { index: i, distance, box: boxOf(x1, y1, x2, y2) };
        }
        return best;
      }
      case "text": {
        const { coords, labels, count, anchor } = geometry as TextGeometry;
        // Text marks write in the theme's text, as drawn.
        const paint = frame.theme.style.text;
        for (let i = count - 1; i >= 0; i--) {
          const box = textBox(
            {
              text: labels[i]!,
              x: coords[i * 2]!,
              y: coords[i * 2 + 1]!,
              anchor,
              baseline: "middle",
              angle: 0,
              paint,
            },
            frame,
            true,
          );
          if (inside(box, x, y)) return { index: i, distance: 0, box };
        }
        return undefined;
      }
      case "labels": {
        const { items } = geometry as LabelsGeometry;
        for (let i = items.length - 1; i >= 0; i--) {
          const box = textBox(items[i]!, frame);
          if (inside(box, x, y)) return { index: i, distance: 0, box };
        }
        return undefined;
      }
      default:
        return undefined;
    }
  }

  /**
   * The row a line's or area's path draws nearest the query along its axis,
   * from the segment hit (see `Hit.segment`): of a path in the order of its
   * series, the eligible observations inside the segment's span and the two
   * bracketing it, in the segment's run; of one drawn in another order, the
   * nearer of the segment's two ends' observations, or where those are not
   * known, the eligible observation nearest the query on screen.
   */
  #traced(
    part: Extract<DrawnPart, { kind: "trace" }>,
    table: Table | undefined,
    frame: Frame,
    hit: Hit,
    query: PickQuery,
    sorted: "x" | "y" | undefined,
  ): Extract<DrawnPart, { kind: "row" }> | undefined {
    const { rowOf, placeAt, lowerPosition } = this.#kit;
    const { series: s, along, eligible, sameRun, order } = part;
    const [ax, ay, bx, by] = hit.segment!;
    const found = (k: number) => {
      if (!table) return undefined;
      const row = order ? order[k]! : rowOf(s, k);
      // A position in the series, where the row has one there (rows of an order may not).
      const position = order ? positionOf(s, row, rowOf) : k;
      return {
        kind: "row" as const,
        table,
        position: row,
        series: position >= 0 ? { series: s, position } : undefined,
      };
    };
    if (!sorted) {
      const { positions } = part;
      if (positions) {
        const near =
          Math.hypot(ax - query.x, ay - query.y) <= Math.hypot(bx - query.x, by - query.y);
        const k = positions[hit.index + (near ? 0 : 1)];
        return k !== undefined && eligible(rowOf(s, k)) ? found(k) : undefined;
      }
      // The eligible observation nearest the query on screen.
      let best = -1;
      let distance = Number.POSITIVE_INFINITY;
      for (let k = 0; k < s.length; k++) {
        const row = rowOf(s, k);
        if (!eligible(row)) continue;
        const d = Math.hypot(
          frame.x.map(placeAt(s, "x", row)) - query.x,
          frame.y.map(placeAt(s, "y", row)) - query.y,
        );
        if (d < distance) [best, distance] = [k, d];
      }
      return best < 0 ? undefined : found(best);
    }
    const scale = frame[along];
    const [pa, pb, p] = along === "x" ? [ax, bx, query.x] : [ay, by, query.y];
    const [va, vb] = [scale.invert(pa), scale.invert(pb)];
    const [lo, hi] = va <= vb ? [va, vb] : [vb, va];
    const target = scale.invert(p);
    const length = order ? order.length : s.length;
    const rowAt = (k: number) => (order ? order[k]! : rowOf(s, k));
    const at = (k: number) => placeAt(s, along, rowAt(k));
    // The first position at or past `value` (past it with `after`).
    const first = (value: number, after: boolean) => {
      // Values searched as stored are no panel's own categories' places.
      if (!order && !s.places?.[along]) {
        let k = lowerPosition(s, value, along);
        while (after && k < length && at(k) <= value) k++;
        return k;
      }
      let [a, b] = [0, length];
      while (a < b) {
        const mid = (a + b) >>> 1;
        if (at(mid) < value || (after && at(mid) === value)) a = mid + 1;
        else b = mid;
      }
      return a;
    };
    // The first eligible position from `k` stepping `by`, before `end`; -1 for none.
    const walk = (k: number, by: 1 | -1, end: number) => {
      for (let n = 0; n < GAP_WALK && k !== end && k >= 0 && k < length; n++, k += by)
        if (eligible(rowAt(k))) return k;
      return -1;
    };
    const [k0, k1] = [first(lo, false), first(hi, true)];
    // Inside the span: the eligible ones either side of the query's value.
    const t = Math.min(Math.max(first(target, false), k0), k1);
    const right = walk(t, 1, k1);
    const left = walk(t - 1, -1, k0 - 1);
    const within = closest([left, right], at, target);
    // And the two bracketing the span.
    const before = walk(k0 - 1, -1, -1);
    const after = walk(k1, 1, length);
    let candidates: number[];
    if (within >= 0)
      candidates = [
        within,
        ...[before, after].filter(
          (k) => k >= 0 && sameRun(rowAt(Math.min(k, within)), rowAt(Math.max(k, within))),
        ),
      ];
    else if (before >= 0 && after >= 0 && !sameRun(rowAt(before), rowAt(after)))
      // A segment between two runs is one of theirs: the one whose end it is nearer.
      candidates = [Math.abs(at(before) - lo) <= Math.abs(at(after) - hi) ? before : after];
    else candidates = [before, after];
    const k = closest(candidates, at, target);
    return k < 0 ? undefined : found(k);
  }
}

/** Text placed as `TextItem` places it, with the parts picking reads. */
export type TextLike = Pick<
  TextItem,
  "text" | "x" | "y" | "anchor" | "baseline" | "angle" | "paint"
> & {
  readonly box?: Rect | undefined;
};

/** What a geometry has under the query: a primitive, its distance, its box, and a path's segment. */
interface Hit {
  index: number;
  distance: number;
  box?: Rect | undefined;
  /** For paths: the segment hit, its ends' pixels (index to index + 1). */
  segment?: readonly [number, number, number, number];
}

/** Of positions `ks` (-1 for none), the one whose value `at` gives is nearest `target`; the earlier on ties. */
function closest(ks: readonly number[], at: (k: number) => number, target: number): number {
  let best = -1;
  for (const k of ks) {
    if (k < 0) continue;
    const d = Math.abs(at(k) - target);
    const b = best < 0 ? Number.POSITIVE_INFINITY : Math.abs(at(best) - target);
    if (d < b || (d === b && k < best)) best = k;
  }
  return best;
}

/** Where table row `row` is in `s`: by a scan, for rows a trace's order gives; -1 for none. */
function positionOf(s: Series, row: number, rowOf: PickKit["rowOf"]): number {
  for (let k = 0; k < s.length; k++) if (rowOf(s, k) === row) return k;
  return -1;
}

/**
 * Whether a trace's series is drawn in order along its axis: sorted there,
 * or placed in bands, which are drawn in band order.
 */
function sortedAlong(
  { series: s, along }: Extract<DrawnPart, { kind: "trace" }>,
  frame: Frame,
): boolean {
  return frame[along].bandwidth !== undefined || (along === "x" ? s.sorted : s.ySorted) === true;
}

/** The pixel of row `row` of `s` as its mark draws it, as a box of no size; undefined off the scales. */
function pointBox(
  kit: PickKit,
  s: Series,
  row: number,
  frame: Frame,
  mark: Mark,
): Rect | undefined {
  // Where it is drawn: moved across its band by a mark spreading rows there.
  const [dx, dy] = mark.displace?.(s, row, frame) ?? [0, 0];
  const x = frame.x.map(kit.placeAt(s, "x", row)) + dx;
  const y = frame.y.map(kit.placeAt(s, "y", row)) + dy;
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y, width: 0, height: 0 } : undefined;
}

/**
 * The segment of `path` nearest (x, y) within `reach`: curves flattened to
 * within 0.25 px, segments painted later winning ties; with `dots`, only
 * its runs of one point, which are drawn as dots. A path drawn in order
 * along `along` is searched only where it reaches the query there.
 */
function nearestSegment(
  path: LineGeometry["path"],
  reach: number,
  x: number,
  y: number,
  half: number,
  along: "x" | "y" | undefined,
  clip: Readonly<Rect>,
  dots = false,
): Hit | undefined {
  const { coords, count, starts, curved, controls } = path;
  const a = along === "y" ? 1 : 0;
  const at = a ? y : x;
  let best: Hit | undefined;
  for (let r = 0; r < starts.length; r++) {
    const start = starts[r]!;
    const end = r + 1 < starts.length ? starts[r + 1]! : count;
    let [from, to] = [start, end - 1];
    if (along && end - start > 1) {
      // In pixels, the values run either way (a reversed or upward axis).
      const up = coords[(end - 1) * 2 + a]! >= coords[start * 2 + a]!;
      const [lo, hi] = [at - reach, at + reach];
      from = Math.max(start, seek(coords, a, start, end, up ? lo : hi, up) - 1);
      to = Math.min(end - 1, seek(coords, a, start, end, up ? hi : lo, up));
    }
    if (dots) to = from;
    for (let i = from; i < to; i++) {
      const [ax, ay, bx, by] = [
        coords[i * 2]!,
        coords[i * 2 + 1]!,
        coords[i * 2 + 2]!,
        coords[i * 2 + 3]!,
      ];
      const d =
        curved && !Number.isNaN(controls[(i + 1) * 4]!)
          ? distanceToCurve(controls, i + 1, ax, ay, bx, by, x, y, clip, half)
          : shownDistance(x, y, ax, ay, bx, by, clip, half);
      const distance = Math.max(0, d - half);
      if (d <= reach && !(best && best.distance < distance))
        best = { index: i, distance, segment: [ax, ay, bx, by] };
    }
    // A run of one point is a dot.
    if (end - start === 1) {
      const [ax, ay] = [coords[start * 2]!, coords[start * 2 + 1]!];
      const d = shownDistance(x, y, ax, ay, ax, ay, clip, half);
      if (d <= reach && !(best && best.distance < d - half))
        best = { index: start, distance: Math.max(0, d - half), segment: [ax, ay, ax, ay] };
    }
  }
  return best;
}

/**
 * How far (x, y) is from the middle of a stroke `half` wide along the
 * segment from a to b, where `clip` shows it: from its point nearest
 * (x, y) where the stroke there reaches into the clip (round at the clip's
 * corners), else from the nearest of its part inside the clip; infinitely
 * far where the clip shows none of it.
 */
function shownDistance(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  clip: Readonly<Rect>,
  half: number,
): number {
  const [dx, dy] = [bx - ax, by - ay];
  const length = dx * dx + dy * dy;
  const along = length > 0 ? ((x - ax) * dx + (y - ay) * dy) / length : 0;
  // The point nearest (x, y) of the part of the segment inside `box`, or undefined.
  const nearest = (box: Readonly<Rect>) => {
    const [t0, t1] = span(ax, ay, dx, dy, box);
    if (t0 > t1) return undefined;
    const t = Math.min(t1, Math.max(t0, along));
    return [ax + t * dx, ay + t * dy] as const;
  };
  const grown = {
    x: clip.x - half,
    y: clip.y - half,
    width: clip.width + 2 * half,
    height: clip.height + 2 * half,
  };
  let at = nearest(grown);
  if (at && outside(clip, at[0], at[1]) >= half) at = nearest(clip);
  return at ? Math.hypot(x - at[0], y - at[1]) : Number.POSITIVE_INFINITY;
}

/**
 * The span of the segment from a, `dx` and `dy` long, inside `box`, as
 * fractions of its length (Liang and Barsky); empty where the first is
 * past the second.
 */
function span(
  ax: number,
  ay: number,
  dx: number,
  dy: number,
  box: Readonly<Rect>,
): [number, number] {
  let [t0, t1] = [0, 1];
  for (let edge = 0; edge < 4; edge++) {
    // Toward the edge (p) and how far inside it a is (q): left, right, top, bottom.
    const p = edge === 0 ? -dx : edge === 1 ? dx : edge === 2 ? -dy : dy;
    const q =
      edge === 0
        ? ax - box.x
        : edge === 1
          ? box.x + box.width - ax
          : edge === 2
            ? ay - box.y
            : box.y + box.height - ay;
    if (p === 0) {
      if (q < 0) return [1, 0];
    } else if (p < 0) t0 = Math.max(t0, q / p);
    else t1 = Math.min(t1, q / p);
  }
  return [t0, t1];
}

/** How far (x, y) is from `box`: 0 inside it. */
function outside(box: Readonly<Rect>, x: number, y: number): number {
  return Math.hypot(
    Math.max(box.x - x, 0, x - box.x - box.width),
    Math.max(box.y - y, 0, y - box.y - box.height),
  );
}

/**
 * In a run of points `[start, end)` ordered along coordinate `a` (0 for x,
 * 1 for y), ascending (`up`) or descending, the first point at or past `value`.
 */
function seek(
  coords: Float32Array,
  a: number,
  start: number,
  end: number,
  value: number,
  up: boolean,
): number {
  let [lo, hi] = [start, end];
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const v = coords[mid * 2 + a]!;
    if (up ? v < value : v > value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * How far (x, y) is from what `clip` shows of a stroke `half` wide along
 * the cubic curve from a to b through point `i`'s control points.
 */
function distanceToCurve(
  controls: Float32Array,
  i: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  x: number,
  y: number,
  clip: Readonly<Rect>,
  half: number,
): number {
  const [c1x, c1y, c2x, c2y] = [
    controls[i * 4]!,
    controls[i * 4 + 1]!,
    controls[i * 4 + 2]!,
    controls[i * 4 + 3]!,
  ];
  // Flattened into pieces within 0.25 px of the curve: a chord of n strays
  // at most 3d / 4n² from it, d the larger of its second differences.
  const d = Math.max(
    Math.hypot(ax - 2 * c1x + c2x, ay - 2 * c1y + c2y),
    Math.hypot(c1x - 2 * c2x + bx, c1y - 2 * c2y + by),
  );
  const pieces = Math.max(1, Math.ceil(Math.sqrt(3 * d)));
  let distance = Number.POSITIVE_INFINITY;
  let [px, py] = [ax, ay];
  for (let k = 1; k <= pieces; k++) {
    const t = k / pieces;
    const u = 1 - t;
    const qx = u * u * u * ax + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * bx;
    const qy = u * u * u * ay + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * by;
    distance = Math.min(distance, shownDistance(x, y, px, py, qx, qy, clip, half));
    [px, py] = [qx, qy];
  }
  return distance;
}

/**
 * Whether (x, y) is inside an area's fill, as `traceArea` (draw/area.ts)
 * outlines it and the renderers fill it: each run of its upper edge, then
 * back along its lower edge's run of the same index (or down to the
 * baseline), by the nonzero rule. Inside, what is hit is the upper edge's
 * segment nearest the query across the area. Outside, an outlined upper
 * edge is reached as a line is, and without one, the dots isolated points
 * are drawn as.
 */
function areaHit(
  area: AreaGeometry,
  x: number,
  y: number,
  slop: number,
  along: "x" | "y" | undefined,
  orient: "x" | "y" | undefined,
  clip: Readonly<Rect>,
): Hit | undefined {
  const { upper, lower, baseline, stroke, strokeWidth } = area;
  // Across the axis the area runs along (`orient`): a ray from the query
  // that way crosses its outline's edges, each counted by its direction
  // where it passes the query. Its outline is searched along `along`, the
  // axis it is ordered along, if it is.
  const a = orient === "y" ? 1 : 0;
  const [p, q] = a ? [y, x] : [x, y];
  let winding = 0;
  // On the outline, to within single precision, is inside too (a stack's
  // zeros, drawn as a line along the axis).
  let onEdge = false;
  let top: { w: number; index: number } | undefined;
  const cross = (u0: number, u1: number, w: number) => {
    if (Math.abs(w - q) <= TIE) onEdge = true;
    if (w > q && ((u0 <= p && p < u1) || (u1 <= p && p < u0))) winding += u1 > u0 ? 1 : -1;
  };
  // An edge across the axis, at the query's place along it.
  const across = (w0: number, w1: number) => {
    if (Math.min(w0, w1) - TIE <= q && q <= Math.max(w0, w1) + TIE) onEdge = true;
  };
  // A straight edge between two pixels.
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const [u0, w0, u1, w1] = a ? [y0, x0, y1, x1] : [x0, y0, x1, y1];
    if (!(Math.min(u0, u1) <= p && p <= Math.max(u0, u1))) return;
    if (u0 === u1) across(w0, w1);
    else cross(u0, u1, w0 + ((p - u0) / (u1 - u0)) * (w1 - w0));
  };
  // Segment i of a path, from point i to i + 1 or back (`back`).
  const segment = (path: LineGeometry["path"], i: number, back: boolean, edge: boolean) => {
    const { coords } = path;
    const [u0, u1] = [coords[i * 2 + a]!, coords[i * 2 + 2 + a]!];
    if (!(Math.min(u0, u1) <= p && p <= Math.max(u0, u1))) return;
    if (u0 === u1) {
      across(coords[i * 2 + 1 - a]!, coords[i * 2 + 3 - a]!);
      return;
    }
    const w = crossingAt(path, a, i, p);
    if (back) cross(u1, u0, w);
    else cross(u0, u1, w);
    if (edge && !(top && Math.abs(top.w - q) <= Math.abs(w - q))) top = { w, index: i };
  };
  const u = upper.coords;
  for (let r = 0; r < upper.starts.length; r++) {
    const start = upper.starts[r]!;
    const end = r + 1 < upper.starts.length ? upper.starts[r + 1]! : upper.count;
    if (end - start < 2) continue;
    for (let i = start; i < end - 1; i++) segment(upper, i, false, true);
    const [fx, fy, lx, ly] = [u[start * 2]!, u[start * 2 + 1]!, u[(end - 1) * 2]!, u[end * 2 - 1]!];
    if (lower && r < lower.starts.length) {
      const l = lower.coords;
      const from = lower.starts[r]!;
      const to = r + 1 < lower.starts.length ? lower.starts[r + 1]! : lower.count;
      line(lx, ly, l[(to - 1) * 2]!, l[to * 2 - 1]!);
      for (let i = to - 2; i >= from; i--) segment(lower, i, true, false);
      line(l[from * 2]!, l[from * 2 + 1]!, fx, fy);
    } else {
      line(lx, ly, lx, baseline);
      line(lx, baseline, fx, baseline);
      line(fx, baseline, fx, fy);
    }
  }
  if ((winding !== 0 || onEdge) && top) {
    const { w, index: i } = top;
    return {
      index: i,
      distance: 0,
      segment: [u[i * 2]!, u[i * 2 + 1]!, u[i * 2 + 2]!, u[i * 2 + 3]!],
      box: a ? boxOf(w, p, w, p) : boxOf(p, w, p, w),
    };
  }
  const half = strokeWidth / 2;
  return strokeWidth > 0
    ? nearestSegment(upper, half + slop, x, y, half, along, clip, !stroke)
    : undefined;
}

/** The end of a segment nearer (x, y), as a box of no size. */
function nearerEnd(
  [ax, ay, bx, by]: readonly [number, number, number, number],
  { x, y }: { x: number; y: number },
): Rect {
  const near = Math.hypot(ax - x, ay - y) <= Math.hypot(bx - x, by - y);
  return { x: near ? ax : bx, y: near ? ay : by, width: 0, height: 0 };
}

/**
 * Where segment i of a path (from point i to i + 1) is at `at` along
 * coordinate `a` (0 for x, 1 for y): its other coordinate there, on the
 * curve drawn where the segment is curved (monotone along its axis).
 */
function crossingAt(path: LineGeometry["path"], a: number, i: number, at: number): number {
  const { coords, curved, controls } = path;
  const [u0, u1] = [coords[i * 2 + a]!, coords[i * 2 + 2 + a]!];
  const [w0, w1] = [coords[i * 2 + 1 - a]!, coords[i * 2 + 3 - a]!];
  const c = (i + 1) * 4;
  return curved && !Number.isNaN(controls[c]!)
    ? curveAt(
        [u0, controls[c + a]!, controls[c + 2 + a]!, u1],
        [w0, controls[c + 1 - a]!, controls[c + 3 - a]!, w1],
        at,
      )
    : w0 + ((at - u0) / (u1 - u0)) * (w1 - w0);
}

/**
 * Where a cubic curve, monotone in its first coordinate `u` (the four
 * points' u), reaches `at` in it: its other coordinate `w` there, found by
 * bisection to well within a pixel.
 */
function curveAt(u: readonly number[], w: readonly number[], at: number): number {
  const cubic = (p: readonly number[], t: number) => {
    const s = 1 - t;
    return s * s * s * p[0]! + 3 * s * s * t * p[1]! + 3 * s * t * t * p[2]! + t * t * t * p[3]!;
  };
  const up = u[3]! >= u[0]!;
  let [lo, hi] = [0, 1];
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (cubic(u, mid) < at === up) lo = mid;
    else hi = mid;
  }
  return cubic(w, (lo + hi) / 2);
}

/**
 * The box placed text takes, as the chart lays it out: its width measured
 * in its font, its lines' height, its anchor and baseline, or the box of
 * its background where it has one; turned, the box around it.
 */
export function textBox(item: TextLike, frame: Pick<Frame, "measure">, block = false): Rect {
  if (item.box) return turned(item.box, item);
  const { paint } = item;
  const lines = item.text.split("\n");
  const width = Math.max(...lines.map((line) => frame.measure(line, paint.css)));
  const height = lines.length * paint.lineHeight;
  const x = item.x - (item.anchor === "middle" ? width / 2 : item.anchor === "end" ? width : 0);
  // A text item's point places its first line, the rest below it; a text
  // mark's (`block`) centers all of them.
  const y =
    item.y -
    (item.baseline === "middle"
      ? (block ? height : paint.lineHeight) / 2
      : item.baseline === "alphabetic"
        ? paint.size * 0.8
        : 0);
  return turned({ x, y, width, height }, item);
}

/** The box around `box` turned `angle` degrees about (x, y). */
function turned(box: Rect, { x, y, angle }: { x: number; y: number; angle: number }): Rect {
  if (!angle) return box;
  const [cos, sin] = [Math.cos((angle * Math.PI) / 180), Math.sin((angle * Math.PI) / 180)];
  const corners = [
    [box.x, box.y],
    [box.x + box.width, box.y],
    [box.x, box.y + box.height],
    [box.x + box.width, box.y + box.height],
  ].map(([cx, cy]) => [
    x + (cx! - x) * cos - (cy! - y) * sin,
    y + (cx! - x) * sin + (cy! - y) * cos,
  ]);
  const xs = corners.map(([cx]) => cx!);
  const ys = corners.map(([, cy]) => cy!);
  return boxOf(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

/**
 * What layout marks pick (their records' `layout`): the item `itemAt` finds
 * under the query, as tooltips find items, at the point its tooltip points
 * to: a row of a mark whose items are rows (of the layer it is in, for a
 * map's or a 3D box's layers), else named by its key's parts after its
 * mark's. `itemAt` tests the items' own shapes (points within a few
 * pixels, as their tooltips find them), so the distance is 0: a panel
 * holds one layout mark, so no distance ranks its items against another
 * mark's.
 */
export function pickLayout(drawn: DrawnMark, query: PickQuery): PickedItem | undefined {
  const item = drawn.layout?.itemAt(query.x, query.y);
  return item && layoutItem(drawn, item);
}

/** A layout mark's item as picked: a row of its table (or its layer's), or the group it draws. */
export function layoutItem(drawn: DrawnMark, item: LayoutItem): PickedItem | undefined {
  const mark: LayoutMark | undefined = drawn.layoutMark;
  if (!mark) return undefined;
  const box = { x: item.px, y: item.py, width: 0, height: 0 };
  // A map or 3D box of one layer gives its items no layer.
  const k = item.layer ?? (mark.layers?.length === 1 ? 0 : undefined);
  const layer = k === undefined ? mark : mark.layers?.[k];
  if (layer?.rowItems && layer.table && item.row !== undefined) {
    const key = k === undefined ? undefined : (layer.spec.id ?? mark.indices?.[k] ?? k);
    return {
      part: { kind: "row", table: layer.table, position: item.row },
      names: undefined,
      box,
      distance: 0,
      ...(key !== undefined && key !== drawn.mark && { mark: key }),
    };
  }
  const names = (JSON.parse(item.key) as KeyPart[]).slice(1);
  return { part: { kind: "group", key: item.key }, names, box, distance: 0 };
}
