import { childrenByValue, type Hierarchy } from "../data/hierarchy.ts";

/** How a treemap's nodes fill their parents. */
export interface TreemapLayout {
  /** Gap between siblings, in px. */
  inner: number;
  /** Space inside a parent around its children. */
  outer: number;
  /** Extra space at the top of parents below the root, for their labels. */
  top: number;
  /**
   * "squarify" (the default): rows of rectangles kept close to square;
   * "slice-dice": the root's children side by side along x, theirs along
   * y, and so on, as a Marimekko's columns and cells.
   */
  tile?: "squarify" | "slice-dice" | undefined;
  /** Children largest first (the default), or in the order the table gives them. */
  byValue?: boolean | undefined;
  /** Levels laid out below the root; deeper nodes get empty rectangles. Every level by default. */
  levels?: number | undefined;
}

/**
 * The sides of a node's rectangle that face a gap (each a bit, clockwise
 * from the top, as outlines' sides are): a sibling's, or one its parent's
 * side faces where the node is flush with it. The canvas painter rounds
 * the middle of each such gap to device pixels once, so neighbors meet it
 * alike (see draw/tiles.ts); other sides are rounded where they are. Bit
 * `1 << k` goes with a node's `k`th middle (see `layoutTreemap`).
 */
export const CUT_TOP = 1;
export const CUT_RIGHT = 2;
export const CUT_BOTTOM = 4;
export const CUT_LEFT = 8;

/** The aspect ratio squarified rows aim for: the golden ratio, as in D3. */
const RATIO = (1 + Math.sqrt(5)) / 2;
/** How close a side must be to its parent's content edge to be flush with it, in px. */
const FLUSH = 1e-6;

/**
 * A treemap: each node's children fill its rectangle, squarified (Bruls,
 * Huizing, and van Wijk: rows kept as close to the target aspect ratio as
 * the values allow) or sliced along x and y by turns. Writes x, y, width,
 * and height per node into `out` (four per node); the root fills
 * `bounds`, and nodes without a value, or deeper than `levels`, get empty
 * rectangles. With `cuts`, writes each node's sides that face a gap (see
 * `CUT_TOP`), and with `middles` the middle of the gap each faces (four per
 * node, clockwise from the top): neighbors facing one gap get the same
 * number, which the canvas painter rounds once.
 */
export function layoutTreemap(
  tree: Hierarchy,
  values: Float64Array,
  bounds: { x: number; y: number; width: number; height: number },
  layout: TreemapLayout,
  out: Float64Array,
  cuts?: Uint8Array,
  middles?: Float64Array,
): void {
  out.fill(0, 0, tree.size * 4);
  cuts?.fill(0, 0, tree.size);
  out[0] = bounds.x;
  out[1] = bounds.y;
  out[2] = Math.max(0, bounds.width);
  out[3] = Math.max(0, bounds.height);
  const half = layout.inner / 2;
  const levels = layout.levels ?? Number.POSITIVE_INFINITY;
  const byValue = layout.byValue ?? true;
  let scratch: Uint32Array = new Uint32Array(16);
  for (let at = 0; at < tree.size; at++) {
    const node = tree.order[at]!;
    if (tree.childStart[node + 1] === tree.childStart[node] || !(values[node]! > 0)) continue;
    if (tree.depth[node]! >= levels) continue;
    const top = node === 0 ? 0 : layout.top;
    // Children are placed in the content box widened by half the gap, then
    // each shrinks by half the gap: siblings end up a gap apart, and the
    // outer ones flush with the content box.
    const x0 = out[node * 4]! + layout.outer - half;
    const y0 = out[node * 4 + 1]! + layout.outer + top - half;
    const x1 = out[node * 4]! + out[node * 4 + 2]! - layout.outer + half;
    const y1 = out[node * 4 + 1]! + out[node * 4 + 3]! - layout.outer + half;
    if (!(x1 > x0 && y1 > y0)) continue;
    const children = byValue
      ? childrenByValue(tree, values, node, scratch)
      : tree.children.subarray(tree.childStart[node]!, tree.childStart[node + 1]!);
    if (byValue && children.length > scratch.length) scratch = children;
    if (layout.tile === "slice-dice") {
      // The root's children side by side along x, theirs along y, and so on.
      const across = tree.depth[node]! % 2 === 0;
      place(
        children,
        0,
        children.length,
        values,
        values[node]!,
        x0,
        y0,
        x1,
        y1,
        across,
        out,
        middles,
      );
    } else {
      squarify(children, values, values[node]!, x0, y0, x1, y1, out, middles);
    }
    // A side flush with the content box faces what the parent's side does,
    // where no padding comes between.
    const inherited = cuts
      ? cuts[node]! &
        ((layout.outer === 0 ? CUT_RIGHT | CUT_BOTTOM | CUT_LEFT : 0) |
          (layout.outer === 0 && top === 0 ? CUT_TOP : 0))
      : 0;
    for (const child of children) {
      const i = child * 4;
      if (cuts) {
        const [x, y, w, h] = [out[i]!, out[i + 1]!, out[i + 2]!, out[i + 3]!];
        const inside =
          (y > y0 + FLUSH ? CUT_TOP : 0) |
          (x + w < x1 - FLUSH ? CUT_RIGHT : 0) |
          (y + h < y1 - FLUSH ? CUT_BOTTOM : 0) |
          (x > x0 + FLUSH ? CUT_LEFT : 0);
        cuts[child] = inside | (inherited & ~inside);
        // A side flush with the parent's faces the parent's gap, and takes its middle.
        if (middles)
          for (let k = 0; k < 4; k++)
            if (!(inside & (1 << k))) middles[i + k] = middles[node * 4 + k]!;
      }
      const width = out[i + 2]! - 2 * half;
      const height = out[i + 3]! - 2 * half;
      if (width > 0 && height > 0) {
        out[i] = out[i]! + half;
        out[i + 1] = out[i + 1]! + half;
        out[i + 2] = width;
        out[i + 3] = height;
      } else {
        out.fill(0, i, i + 4);
      }
    }
  }
}

function squarify(
  nodes: Uint32Array,
  values: Float64Array,
  total: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  out: Float64Array,
  middles: Float64Array | undefined,
): void {
  let remaining = total;
  let i0 = 0;
  const n = nodes.length;
  while (i0 < n) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    // A row starts at the next node with a value; those without take no room.
    let i1 = i0;
    let sum = 0;
    do sum = values[nodes[i1++]!]!;
    while (!sum && i1 < n);
    let min = sum;
    let max = sum;
    const alpha = Math.max(dy / dx, dx / dy) / (remaining * RATIO);
    let worst = Math.max(max / (sum * sum * alpha), (sum * sum * alpha) / min);
    // Grow the row while its worst aspect ratio does not get worse.
    for (; i1 < n; i1++) {
      const value = values[nodes[i1]!]!;
      const grown = sum + value;
      const beta = grown * grown * alpha;
      const ratio = Math.max(Math.max(max, value) / beta, beta / Math.min(min, value));
      if (ratio > worst) break;
      sum = grown;
      min = Math.min(min, value);
      max = Math.max(max, value);
      worst = ratio;
    }
    // Rows run along the longer side of what is left.
    if (dx < dy) {
      const y = remaining ? y0 + (dy * sum) / remaining : y1;
      place(nodes, i0, i1, values, sum, x0, y0, x1, y, true, out, middles);
      y0 = y;
    } else {
      const x = remaining ? x0 + (dx * sum) / remaining : x1;
      place(nodes, i0, i1, values, sum, x0, y0, x, y1, false, out, middles);
      x0 = x;
    }
    remaining -= sum;
    i0 = i1;
  }
}

/**
 * Splits a rectangle among nodes by value, left to right or top to bottom,
 * writing each node's sides into `middles`: a side two nodes share is the
 * same number for both.
 */
function place(
  nodes: Uint32Array,
  from: number,
  to: number,
  values: Float64Array,
  sum: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  across: boolean,
  out: Float64Array,
  middles: Float64Array | undefined,
): void {
  let at = across ? x0 : y0;
  const span = across ? x1 - x0 : y1 - y0;
  for (let k = from; k < to; k++) {
    const node = nodes[k]!;
    const size = sum ? (span * values[node]!) / sum : 0;
    const end = at + size;
    const i = node * 4;
    out[i] = across ? at : x0;
    out[i + 1] = across ? y0 : at;
    out[i + 2] = across ? size : x1 - x0;
    out[i + 3] = across ? y1 - y0 : size;
    if (middles) {
      middles[i] = across ? y0 : at;
      middles[i + 1] = across ? end : x1;
      middles[i + 2] = across ? y1 : end;
      middles[i + 3] = across ? at : x0;
    }
    at = end;
  }
}
