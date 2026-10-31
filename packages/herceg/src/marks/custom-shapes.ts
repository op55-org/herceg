// Where a custom mark's items are, as their shapes are painted: for the
// picker (within a pointer's reach) and for tooltips and `chart.inspect()`
// (exactly on a shape). Each item is the shapes one `item` call drew.
// Paths are read as browsers read SVG path data (draw/svg-path.ts),
// curves and arcs flattened to within a quarter pixel near the query
// (pieces far from it are their chords); fills by the nonzero rule,
// each subpath closed; strokes by their width, with butt ends at a
// subpath's open ends and round joins (a miter's tip is not reached, and
// dashes count whole); text by the box of its lines. Boxes are found when
// first asked, once per scene, and filed in a grid when there are many, so
// a query tests the few items near it; the shapes near it are traced again
// rather than kept, so an item costs 32 bytes and its grid entries.

import { tracePath } from "../draw/svg-path.ts";
import type { MeasureText } from "../layout/text.ts";
import type { PathShape, Rect, TextShape } from "../scene/scene.ts";

/** Pixels a flattened curve may be off its true course. */
const TOLERANCE = 0.25;
/** Items over which queries look through a grid of boxes rather than every box. */
const INDEXED = 256;
/** A grid cell's side, in pixels, at least: cells grow so that a side holds at most GRID of them. */
const CELL = 32;
const GRID = 1024;
/** Cells an item may take in the grid; larger ones are looked at by every query. */
const SPREAD = 64;
/** Distances apart that tie (as picking's do). */
const TIE = 1e-3;

/** A line height for text shapes, in font sizes, as drawn (draw/shapes.ts). */
const LINE = 1.25;

/** A path flattened: each subpath's points (x, y pairs) and whether it is closed. */
interface Flat {
  readonly points: number[];
  /** Index into `points` (of x) where each subpath starts. */
  readonly starts: number[];
  readonly closed: boolean[];
}

/** Halvings of a curve at most, past which a piece is its chord (2^-64 of its size: well within a pixel). */
const DEPTH = 64;

/**
 * Path data flattened into subpaths of straight segments, as seen from
 * (qx, qy) within `reach` pixels. Curves are halved until each piece strays
 * from its chord by at most TOLERANCE (3/4 of its largest second
 * difference bounds that), but a piece whose control box, grown by
 * `reach`, misses the query is its chord at once: the query is outside
 * what lies between them, so neither the winding there nor anything within
 * reach changes, and the work stays near the query however far a curve
 * runs.
 */
function flatten(d: string, qx: number, qy: number, reach: number): Flat {
  const points: number[] = [];
  const starts: number[] = [];
  const closed: boolean[] = [];
  let x = 0;
  let y = 0;
  // A point repeating the last is no segment: subpaths end where they last move.
  const to = (px: number, py: number) => {
    const n = points.length;
    if (n - starts[starts.length - 1]! >= 2 && points[n - 2] === px && points[n - 1] === py) return;
    points.push(px, py);
  };
  const curve = (
    x0: number,
    y0: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    x3: number,
    y3: number,
    depth: number,
  ): void => {
    const far =
      Math.min(x0, ax, bx, x3) > qx + reach ||
      Math.max(x0, ax, bx, x3) < qx - reach ||
      Math.min(y0, ay, by, y3) > qy + reach ||
      Math.max(y0, ay, by, y3) < qy - reach;
    const stray =
      0.75 *
      Math.max(
        Math.hypot(x0 - 2 * ax + bx, y0 - 2 * ay + by),
        Math.hypot(ax - 2 * bx + x3, ay - 2 * by + y3),
      );
    if (far || !(stray > TOLERANCE) || depth >= DEPTH) {
      to(x3, y3);
      return;
    }
    // Halved at t = 1/2 (de Casteljau).
    const [abx, aby, bcx, bcy, cdx, cdy] = [
      (x0 + ax) / 2,
      (y0 + ay) / 2,
      (ax + bx) / 2,
      (ay + by) / 2,
      (bx + x3) / 2,
      (by + y3) / 2,
    ];
    const [lx, ly, rx, ry] = [(abx + bcx) / 2, (aby + bcy) / 2, (bcx + cdx) / 2, (bcy + cdy) / 2];
    const [mx, my] = [(lx + rx) / 2, (ly + ry) / 2];
    curve(x0, y0, abx, aby, lx, ly, mx, my, depth + 1);
    curve(mx, my, rx, ry, cdx, cdy, x3, y3, depth + 1);
  };
  tracePath(
    d,
    {
      moveTo(px, py) {
        starts.push(points.length);
        closed.push(false);
        points.push(px, py);
        [x, y] = [px, py];
      },
      lineTo(px, py) {
        to(px, py);
        [x, y] = [px, py];
      },
      bezierCurveTo(ax, ay, bx, by, px, py) {
        curve(x, y, ax, ay, bx, by, px, py, 0);
        [x, y] = [px, py];
      },
      closePath() {
        closed[closed.length - 1] = true;
        // The way back to the start is the closing segment's.
        const start = starts[starts.length - 1]!;
        const n = points.length;
        if (n - start > 2 && points[n - 2] === points[start] && points[n - 1] === points[start + 1])
          points.length = n - 2;
      },
    },
    TOLERANCE,
  );
  return { points, starts, closed };
}

/** The box of path data's points and curves' control points, which hold every curve. */
function pathBox(d: string, pad: number, box: [number, number, number, number]): void {
  const add = (px: number, py: number) => {
    box[0] = Math.min(box[0], px - pad);
    box[1] = Math.min(box[1], py - pad);
    box[2] = Math.max(box[2], px + pad);
    box[3] = Math.max(box[3], py + pad);
  };
  tracePath(
    d,
    {
      moveTo: add,
      lineTo: add,
      bezierCurveTo(ax, ay, bx, by, px, py) {
        add(ax, ay);
        add(bx, by);
        add(px, py);
      },
      closePath() {},
    },
    TOLERANCE,
  );
}

/** Whether (x, y) is inside `flat`'s fill: its subpaths each closed, by the nonzero rule. */
function filled({ points, starts }: Flat, x: number, y: number): boolean {
  let winding = 0;
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = s + 1 < starts.length ? starts[s + 1]! : points.length;
    for (let i = from; i < to; i += 2) {
      const j = i + 2 < to ? i + 2 : from;
      const [x0, y0, x1, y1] = [points[i]!, points[i + 1]!, points[j]!, points[j + 1]!];
      if (y0 <= y ? y1 > y : y1 <= y) {
        const cross = (x1 - x0) * (y - y0) - (x - x0) * (y1 - y0);
        if (y1 > y0 ? cross > 0 : cross < 0) winding += y1 > y0 ? 1 : -1;
      }
    }
  }
  return winding !== 0;
}

/**
 * Pixels from (x, y) to the stroke of width `width` along `flat`: 0 on it.
 * A subpath's open ends are butt, its joins round; with `whole`, every
 * subpath is closed, as a fill's outline is.
 */
function toStroke(
  { points, starts, closed }: Flat,
  width: number,
  x: number,
  y: number,
  whole = false,
): number {
  const half = width / 2;
  let best = Infinity;
  for (let s = 0; s < starts.length; s++) {
    const from = starts[s]!;
    const to = s + 1 < starts.length ? starts[s + 1]! : points.length;
    // A subpath of one point paints nothing: its butt ends meet.
    if (to - from < 4) continue;
    const shut = whole || closed[s]!;
    const last = shut ? to : to - 2;
    for (let i = from; i < last; i += 2) {
      const j = i + 2 < to ? i + 2 : from;
      const [x0, y0, x1, y1] = [points[i]!, points[i + 1]!, points[j]!, points[j + 1]!];
      const length = Math.hypot(x1 - x0, y1 - y0);
      if (!(length > 0)) continue;
      const [ux, uy] = [(x1 - x0) / length, (y1 - y0) / length];
      const along = (x - x0) * ux + (y - y0) * uy;
      const across = Math.abs(-(x - x0) * uy + (y - y0) * ux);
      const side = Math.max(0, across - half);
      let distance: number;
      if (along >= 0 && along <= length) distance = side;
      else {
        // Past an end: a butt end at the subpath's open ends, a round join elsewhere.
        const start = along < 0;
        const open = !shut && (start ? i === from : j === to - 2);
        const over = start ? -along : along - length;
        distance = open ? Math.hypot(over, side) : Math.max(0, Math.hypot(over, across) - half);
      }
      if (distance < best) best = distance;
    }
  }
  return best;
}

/** Pixels from (x, y) to `box`: 0 inside it. */
function toBox(box: Readonly<Rect>, x: number, y: number): number {
  const dx = Math.max(box.x - x, 0, x - box.x - box.width);
  const dy = Math.max(box.y - y, 0, y - box.y - box.height);
  return Math.hypot(dx, dy);
}

/** A text shape's box: its lines, measured, about its point as drawn. */
function textBox(shape: TextShape, font: string, size: number, measure: MeasureText): Rect {
  const lines = shape.text.split("\n");
  const width = Math.max(...lines.map((line) => measure(line, font)));
  const height = lines.length * Math.round(size * LINE);
  const x =
    shape.anchor === "start"
      ? shape.x
      : shape.anchor === "end"
        ? shape.x - width
        : shape.x - width / 2;
  return { x, y: shape.y - height / 2, width, height };
}

/** One item's shapes: shapes [start, end) of the geometry. */
export interface ShapeGroup {
  readonly start: number;
  readonly end: number;
}

/**
 * The items of one geometry of a custom mark, found by their shapes: the
 * topmost within reach of a point, and each one's drawn box.
 */
export class ShapeIndex {
  readonly #shapes: readonly (PathShape | TextShape)[];
  readonly #groups: readonly ShapeGroup[];
  readonly #font: string;
  readonly #size: number;
  readonly #measure: MeasureText;
  /** Where queries are: boxes past it are filed in no grid cell. */
  readonly #bounds: Readonly<Rect> | undefined;
  /** x, y, width, height of each group, once asked; NaN for a group drawing nothing. */
  #boxes: Float64Array | undefined;
  /** With many groups: the groups each grid cell's area holds, by cell, and those too large to file. */
  #grid:
    | {
        x: number;
        y: number;
        /** A cell's side, in pixels. */
        cell: number;
        columns: number;
        rows: number;
        offsets: Int32Array;
        groups: Int32Array;
        large: number[];
      }
    | undefined;

  /**
   * `bounds` is where the pointer may find items (the plot and a plot's
   * size around it): items drawn far past it are left out of the grid, so
   * that they neither stretch its cells nor its memory.
   */
  constructor(
    shapes: readonly (PathShape | TextShape)[],
    groups: readonly ShapeGroup[],
    font: string,
    size: number,
    measure: MeasureText,
    bounds?: Readonly<Rect>,
  ) {
    this.#shapes = shapes;
    this.#groups = groups;
    this.#font = font;
    this.#size = size;
    this.#measure = measure;
    this.#bounds = bounds;
  }

  /** Where group `group`'s shapes end among the geometry's (past its last). */
  endOf(group: number): number {
    return this.#groups[group]!.end;
  }

  /** Group `group`'s drawn box: what its shapes paint, strokes included; undefined for nothing. */
  box(group: number): Rect | undefined {
    const boxes = this.#boxesOf();
    const x = boxes[group * 4]!;
    if (Number.isNaN(x)) return undefined;
    return {
      x,
      y: boxes[group * 4 + 1]!,
      width: boxes[group * 4 + 2]!,
      height: boxes[group * 4 + 3]!,
    };
  }

  /**
   * The group drawn nearest (x, y) within `reach` pixels of its shapes (0:
   * on them), of those `accept` takes; of groups as near (the point inside
   * several), the one painted last.
   */
  find(
    x: number,
    y: number,
    reach: number,
    accept?: (group: number) => boolean,
  ): { group: number; distance: number } | undefined {
    let best: { group: number; distance: number } | undefined;
    const test = (group: number) => {
      if (accept && !accept(group)) return;
      const box = this.box(group);
      if (!box || toBox(box, x, y) > reach) return;
      const distance = this.#distance(group, x, y, reach);
      if (distance > reach) return;
      if (
        best &&
        (distance > best.distance + TIE || (distance > best.distance - TIE && group < best.group))
      )
        return;
      best = { group, distance };
    };
    const grid = this.#gridOf();
    if (!grid) {
      for (let g = 0; g < this.#groups.length; g++) test(g);
      return best;
    }
    const seen = new Set<number>();
    // The cells the query's reach covers, those at the grid's edges for a
    // query past them (boxes there may reach it; the exact test decides).
    const { cell: side, columns, rows } = grid;
    const clamp = (v: number, last: number) => Math.min(last, Math.max(0, Math.floor(v / side)));
    const c0 = clamp(x - reach - grid.x, columns - 1);
    const c1 = clamp(x + reach - grid.x, columns - 1);
    const r0 = clamp(y - reach - grid.y, rows - 1);
    const r1 = clamp(y + reach - grid.y, rows - 1);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cell = r * grid.columns + c;
        for (let k = grid.offsets[cell]!; k < grid.offsets[cell + 1]!; k++) {
          const group = grid.groups[k]!;
          if (seen.has(group)) continue;
          seen.add(group);
          test(group);
        }
      }
    for (const group of grid.large) test(group);
    return best;
  }

  /** Pixels from (x, y) to what group `group` paints, exactly where within `reach`. */
  #distance(group: number, x: number, y: number, reach: number): number {
    const { start, end } = this.#groups[group]!;
    let best = Infinity;
    for (let i = start; i < end && best > 0; i++) {
      const shape = this.#shapes[i]!;
      if ("text" in shape) {
        best = Math.min(best, toBox(textBox(shape, this.#font, this.#size, this.#measure), x, y));
        continue;
      }
      const width = shape.stroke !== undefined ? shape.strokeWidth : 0;
      const flat = flatten(shape.d, x, y, reach + width / 2);
      if (shape.fill !== "none" && filled(flat, x, y)) return 0;
      if (shape.fill !== "none") best = Math.min(best, toStroke(flat, 0, x, y, true));
      if (shape.stroke !== undefined && shape.strokeWidth > 0)
        best = Math.min(best, toStroke(flat, shape.strokeWidth, x, y));
    }
    return best;
  }

  #boxesOf(): Float64Array {
    if (this.#boxes) return this.#boxes;
    const groups = this.#groups;
    const boxes = new Float64Array(groups.length * 4).fill(Number.NaN);
    groups.forEach(({ start, end }, g) => {
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let i = start; i < end; i++) {
        const shape = this.#shapes[i]!;
        if ("text" in shape) {
          const { x, y, width, height } = textBox(shape, this.#font, this.#size, this.#measure);
          [box[0], box[1]] = [Math.min(box[0], x), Math.min(box[1], y)];
          [box[2], box[3]] = [Math.max(box[2], x + width), Math.max(box[3], y + height)];
          continue;
        }
        pathBox(shape.d, shape.stroke !== undefined ? shape.strokeWidth / 2 : 0, box);
      }
      const [x0, y0, x1, y1] = box;
      if (x0 > x1) return;
      boxes.set([x0, y0, x1 - x0, y1 - y0], g * 4);
    });
    this.#boxes = boxes;
    return boxes;
  }

  #gridOf() {
    if (this.#groups.length <= INDEXED) return undefined;
    if (this.#grid) return this.#grid;
    const boxes = this.#boxesOf();
    const count = this.#groups.length;
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (let g = 0; g < count; g++) {
      const x = boxes[g * 4]!;
      if (Number.isNaN(x)) continue;
      const y = boxes[g * 4 + 1]!;
      [x0, y0] = [Math.min(x0, x), Math.min(y0, y)];
      [x1, y1] = [Math.max(x1, x + boxes[g * 4 + 2]!), Math.max(y1, y + boxes[g * 4 + 3]!)];
    }
    // Within the bounds queries are in.
    const bounds = this.#bounds;
    if (bounds) {
      [x0, y0] = [Math.max(x0, bounds.x), Math.max(y0, bounds.y)];
      [x1, y1] = [Math.min(x1, bounds.x + bounds.width), Math.min(y1, bounds.y + bounds.height)];
    }
    if (x0 > x1 || y0 > y1) [x0, y0, x1, y1] = [0, 0, 0, 0];
    // Cells cover every box within them.
    const cell = Math.max(CELL, (x1 - x0) / GRID, (y1 - y0) / GRID);
    const columns = Math.min(GRID, Math.max(1, Math.ceil((x1 - x0) / cell)));
    const rows = Math.min(GRID, Math.max(1, Math.ceil((y1 - y0) / cell)));
    const cellOf = (v: number, last: number) => Math.min(last, Math.max(0, Math.floor(v / cell)));
    // The cells a group's box spans: undefined for one too large to file,
    // which every query looks at; null for one drawing nothing or past the bounds.
    const spans = (g: number): [number, number, number, number] | undefined | null => {
      const x = boxes[g * 4]!;
      if (Number.isNaN(x)) return null;
      const y = boxes[g * 4 + 1]!;
      if (
        bounds &&
        (x > bounds.x + bounds.width ||
          y > bounds.y + bounds.height ||
          x + boxes[g * 4 + 2]! < bounds.x ||
          y + boxes[g * 4 + 3]! < bounds.y)
      )
        return null;
      const c0 = cellOf(x - x0, columns - 1);
      const c1 = cellOf(x + boxes[g * 4 + 2]! - x0, columns - 1);
      const r0 = cellOf(y - y0, rows - 1);
      const r1 = cellOf(y + boxes[g * 4 + 3]! - y0, rows - 1);
      return (c1 - c0 + 1) * (r1 - r0 + 1) > SPREAD ? undefined : [c0, c1, r0, r1];
    };
    const offsets = new Int32Array(columns * rows + 1);
    const large: number[] = [];
    for (let g = 0; g < count; g++) {
      const at = spans(g);
      if (at === undefined) large.push(g);
      if (!at) continue;
      for (let r = at[2]; r <= at[3]; r++)
        for (let c = at[0]; c <= at[1]; c++) offsets[r * columns + c + 1]!++;
    }
    for (let i = 1; i < offsets.length; i++) offsets[i]! += offsets[i - 1]!;
    const groups = new Int32Array(offsets[offsets.length - 1]!);
    const filled = offsets.slice(0, -1);
    for (let g = 0; g < count; g++) {
      const at = spans(g);
      if (!at) continue;
      for (let r = at[2]; r <= at[3]; r++)
        for (let c = at[0]; c <= at[1]; c++) groups[filled[r * columns + c]!++] = g;
    }
    this.#grid = { x: x0, y: y0, cell, columns, rows, offsets, groups, large };
    return this.#grid;
  }
}
