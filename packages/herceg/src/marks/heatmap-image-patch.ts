// What a heatmap's image repaints after a change, rather than every pixel:
// where the image put each cell along each axis (`AxisPixels`), how the
// cells moved between two paints, the rectangles the cells a change
// touched cover, gathered by tile, and each rectangle painted again from
// the rows of the cells in it, in the order a whole paint reads them, so
// the pixels are those a whole paint gives. Part of what follows heatmaps'
// changes (heatmap-patch.ts), loaded on their first change.

import type { NumericArray } from "../data/column.ts";
import type { DisplayTones } from "../fields/colors.ts";
import type { SequentialScale } from "../scale/color.ts";
import type { CombinedCells } from "./heatmap.ts";
import type { CellsState, HeatmapKit } from "./heatmap-patch.ts";
import type { AxisRaster, ImageSource } from "./heatmap-raster.ts";

/**
 * Where an image put each cell (or band) along an axis, kept with the
 * image so that a later projection can be told apart from it: the image's
 * pixels along the axis, and each cell's key, ascending (its value along a
 * number or time axis, its band along a band axis) and pixel span, empty
 * for cells not shown. Copied out of the frame's buffers, which the next
 * projection writes over.
 */
export interface AxisPixels {
  readonly size: number;
  /** One pixel per cell or block of cells, rather than spans of fractions of pixels. */
  readonly regular: boolean;
  readonly keys: Float64Array;
  readonly lo: Float64Array;
  readonly hi: Float64Array;
}

/** What `axis` put where, its cells keyed by `keys` (each cell's index without). */
export function axisPixels(axis: AxisRaster, keys: Float64Array | undefined): AxisPixels {
  const n = axis.length;
  const [lo, hi] = [new Float64Array(n), new Float64Array(n)];
  const regular = axis.pixels !== undefined;
  for (let i = 0; i < n; i++) {
    if (regular) {
      const at = axis.pixels![i]!;
      [lo[i], hi[i]] = at < 0 ? [0, 0] : [at, at + 1];
    } else [lo[i], hi[i]] = [axis.starts![i]!, axis.ends![i]!];
  }
  const own = keys ?? Float64Array.from({ length: n }, (_, i) => i);
  return { size: axis.size, regular, keys: own.length === n ? own : own.slice(0, n), lo, hi };
}

/**
 * How an image's cells moved along an axis from `before` to `now`: by
 * `shift` whole pixels together (only with `slide`, and only one pixel or
 * block per cell), and the pixel ranges, after the shift, where a cell's
 * span differs or a cell came or went. Undefined when the axis' pixels
 * themselves differ in number or kind: the image is painted again.
 */
function axisMoves(
  before: AxisPixels,
  now: AxisPixels,
  slide: boolean,
): { shift: number; ranges: number[] } | undefined {
  if (before.size !== now.size || before.regular !== now.regular) return undefined;
  const [a, b] = [before.keys, now.keys];
  let shift = 0;
  if (slide && now.regular)
    for (let i = 0, j = 0; i < a.length && j < b.length; ) {
      if (a[i]! < b[j]!) i++;
      else if (a[i]! > b[j]!) j++;
      else if (before.hi[i]! > before.lo[i]! && now.hi[j]! > now.lo[j]!) {
        shift = now.lo[j]! - before.lo[i]!;
        break;
      } else [i, j] = [i + 1, j + 1];
    }
  const ranges: number[] = [];
  const add = (lo: number, hi: number) => {
    const [from, to] = [Math.max(0, Math.floor(lo)), Math.min(now.size, Math.ceil(hi))];
    if (to > from) ranges.push(from, to);
  };
  for (let i = 0, j = 0; i < a.length || j < b.length; ) {
    const ka = i < a.length ? a[i]! : Number.POSITIVE_INFINITY;
    const kb = j < b.length ? b[j]! : Number.POSITIVE_INFINITY;
    if (ka < kb) add(before.lo[i]! + shift, before.hi[i++]! + shift);
    else if (kb < ka) add(now.lo[j]!, now.hi[j++]!);
    else {
      const [lo, hi] = [before.lo[i]!, before.hi[i]!];
      const empty = !(hi > lo);
      const moved = empty
        ? now.hi[j]! > now.lo[j]!
        : now.lo[j] !== lo + shift || now.hi[j] !== hi + shift;
      if (moved) {
        if (!empty) add(lo + shift, hi + shift);
        add(now.lo[j]!, now.hi[j]!);
      }
      [i, j] = [i + 1, j + 1];
    }
  }
  return { shift, ranges };
}

/** Rectangles a patch puts one by one, at most. */
const MOST_RECTS = 16;
/** Tiles dirty rectangles are gathered in, in pixels a side. */
const TILE = 64;

/**
 * The rectangles (x, y, width, height, cut to the image) covering
 * `rects`, gathered by 64 × 64 tile: each tile's dirty part's bounds, then
 * joined across tiles where they line up, so a changed column stays one
 * column. Null when more than 16 remain or they cover half the image: the
 * whole image is painted and put then.
 */
function mergeRects(rects: readonly number[], columns: number, rows: number): Int32Array | null {
  const across = Math.ceil(columns / TILE);
  const boxes = new Map<number, [number, number, number, number]>();
  for (let i = 0; i < rects.length; i += 4) {
    const x0 = Math.max(0, rects[i]!);
    const y0 = Math.max(0, rects[i + 1]!);
    const x1 = Math.min(columns, rects[i]! + rects[i + 2]!);
    const y1 = Math.min(rows, rects[i + 1]! + rects[i + 3]!);
    if (!(x1 > x0 && y1 > y0)) continue;
    for (let ty = Math.floor(y0 / TILE); ty * TILE < y1; ty++)
      for (let tx = Math.floor(x0 / TILE); tx * TILE < x1; tx++) {
        const part = [
          Math.max(x0, tx * TILE),
          Math.max(y0, ty * TILE),
          Math.min(x1, (tx + 1) * TILE),
          Math.min(y1, (ty + 1) * TILE),
        ] as [number, number, number, number];
        const key = ty * across + tx;
        const box = boxes.get(key);
        if (!box) boxes.set(key, part);
        else
          boxes.set(key, [
            Math.min(box[0], part[0]),
            Math.min(box[1], part[1]),
            Math.max(box[2], part[2]),
            Math.max(box[3], part[3]),
          ]);
      }
  }
  // Tiles in order, row by row: neighbours in a row whose parts meet at the
  // tile edge and span the same rows join, then rows whose parts span the
  // same columns and meet.
  const tiles = [...boxes.keys()].sort((a, b) => a - b).map((key) => boxes.get(key)!);
  const joined: [number, number, number, number][] = [];
  for (const box of tiles) {
    const last = joined[joined.length - 1];
    if (last && last[2] === box[0] && last[1] === box[1] && last[3] === box[3]) last[2] = box[2];
    else joined.push([...box]);
  }
  const out: [number, number, number, number][] = [];
  for (const box of joined) {
    const above = out.find((o) => o[0] === box[0] && o[2] === box[2] && o[3] === box[1]);
    if (above) above[3] = box[3];
    else out.push(box);
  }
  let area = 0;
  for (const [x0, y0, x1, y1] of out) area += (x1 - x0) * (y1 - y0);
  if (out.length > MOST_RECTS || area * 2 > columns * rows) return null;
  return Int32Array.from(out.flatMap(([x0, y0, x1, y1]) => [x0, y0, x1 - x0, y1 - y0]));
}

/** Moves an image's pixels `shift` columns right (left when negative), in place. */
function shiftPixels(
  pixels: Uint8ClampedArray,
  columns: number,
  rows: number,
  shift: number,
): void {
  if (shift === 0) return;
  const width = columns * 4;
  const by = Math.max(-columns, Math.min(columns, shift)) * 4;
  for (let r = 0; r < rows; r++) {
    const start = r * width;
    if (by > 0) pixels.copyWithin(start + by, start, start + width - by);
    else pixels.copyWithin(start, start - by, start + width);
  }
}

/** An image being painted: its axes, the cells and colors it shows, its pixels, and the frame's buffers for the work. */
export interface PatchedImage {
  across: AxisRaster;
  down: AxisRaster;
  cells: CombinedCells;
  colors: SequentialScale | DisplayTones;
  sampling: "mean" | "max" | "min";
  pixels: Uint8ClampedArray<ArrayBuffer>;
  buffer: (stage: string) => Float64Array;
}

/** Where an image put its cells along each axis. */
export interface ImagePixels {
  readonly x: AxisPixels;
  readonly y: AxisPixels;
}

/**
 * Repaints what changed of `source`'s image, painted from the cells
 * `state` patched (as of its version before), its cells then put at
 * `before`: the cells the change touched, cells the axes now put
 * elsewhere or that came or went along an axis, and the columns a slide
 * along x uncovers, after moving the pixels by the slide. False, leaving
 * the pixels as they were, where that is too much to repaint in parts
 * (see `mergeRects`) or the axes changed otherwise. `ordinals` are each
 * row's cell along x and y.
 */
export function patchImage(
  kit: HeatmapKit,
  image: PatchedImage,
  state: CellsState,
  source: ImageSource,
  before: ImagePixels,
  where: ImagePixels,
  ordinals: { readonly x: NumericArray; readonly y: NumericArray },
): boolean {
  const { damage } = state;
  const along = axisMoves(before.x, where.x, true);
  const down = axisMoves(before.y, where.y, false);
  if (!damage || !along || !down) return false;
  const [columns, rows] = [image.across.size, image.down.size];
  const { shift } = along;
  const rects: number[] = [];
  if (shift > 0) rects.push(0, 0, shift, rows);
  else if (shift < 0) rects.push(columns + shift, 0, -shift, rows);
  for (let i = 0; i < along.ranges.length; i += 2)
    rects.push(along.ranges[i]!, 0, along.ranges[i + 1]! - along.ranges[i]!, rows);
  for (let i = 0; i < down.ranges.length; i += 2)
    rects.push(0, down.ranges[i]!, columns, down.ranges[i + 1]! - down.ranges[i]!);
  const { x, y } = where;
  for (let i = 0; i < damage.length; i += 2) {
    const [c, r] = [damage[i]!, damage[i + 1]!];
    if (c >= x.lo.length || r >= y.lo.length) continue;
    const [x0, x1, y0, y1] = [x.lo[c]!, x.hi[c]!, y.lo[r]!, y.hi[r]!];
    if (!(x1 > x0 && y1 > y0)) continue;
    const [left, top] = [Math.floor(x0), Math.floor(y0)];
    rects.push(left, top, Math.ceil(x1) - left, Math.ceil(y1) - top);
  }
  const merged = mergeRects(rects, columns, rows);
  if (!merged) return false;
  shiftPixels(source.pixels, columns, rows, shift);
  for (let i = 0; i < merged.length; i += 4) {
    const region = [
      merged[i]!,
      merged[i + 1]!,
      merged[i]! + merged[i + 2]!,
      merged[i + 1]! + merged[i + 3]!,
    ] as const;
    repaint(kit, image, where, region, ordinals);
  }
  if (merged.length > 0 || shift !== 0) source.changed(shift, merged);
  return true;
}

/**
 * Paints `region` of an image again: from the rows of every cell the
 * axes put in it, in row order (in cell order for spans of pixels, as
 * the index reads them), as a whole repaint reads them there.
 */
function repaint(
  kit: HeatmapKit,
  image: PatchedImage,
  where: ImagePixels,
  region: readonly [number, number, number, number],
  ordinals: { readonly x: NumericArray; readonly y: NumericArray },
): void {
  const [x0, y0, x1, y1] = region;
  const [c0, c1] = meeting(where.x, x0, x1);
  const [r0, r1] = meeting(where.y, y0, y1);
  const { index, values } = image.cells;
  const positions: number[] = [];
  if (c0 <= c1 && r0 <= r1)
    index.forEachRunIn(c0, c1, r0, r1, (_c, _r, from, to) => {
      for (let i = from; i < to; i++) positions.push(index.positionAt(i));
    });
  const rows = Uint32Array.from(positions).sort();
  const source = {
    x: ordinals.x,
    y: ordinals.y,
    values,
    rows,
    length: rows.length,
    index: () => new kit.CellIndex(index.x, index.y, values, index.columns, index.lines, rows),
  };
  const { across, down, colors, sampling, pixels, buffer } = image;
  kit.paint(source, across, down, colors, sampling, pixels, buffer, region);
  kit.work.pixels += (x1 - x0) * (y1 - y0);
}

/** The first and last cell (or band) along an axis whose pixels meet pixels [from, to); first > last for none. */
function meeting(where: AxisPixels, from: number, to: number): [number, number] {
  let [first, last] = [Number.POSITIVE_INFINITY, -1];
  for (let i = 0; i < where.lo.length; i++) {
    if (!(where.hi[i]! > from && where.lo[i]! < to && where.hi[i]! > where.lo[i]!)) continue;
    if (i < first) first = i;
    last = i;
  }
  return [first, last];
}
