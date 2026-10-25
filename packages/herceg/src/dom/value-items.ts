// Geometry drawn as lists in row order, and rasters, moving to changed
// values (value-transition.ts): error bars' and candles' segments,
// rectangles other than bars (regions, candle bodies), annotations' text
// and labels, and heatmaps' and 2D histograms' cells. Their items carry no
// identity of their own, so a list moves only when both scenes draw as many
// items at the same places along one axis (rows at the same positions are
// the same rows, as for lines), each moving along both axes' scales; a
// raster when both draw the same grid of cells in the same place, each
// cell's color moving to its new one.

import type {
  Geometry,
  LabelsGeometry,
  RasterGeometry,
  RectGeometry,
  SegmentGeometry,
  TextGeometry,
} from "../scene/scene.ts";
import { type Blend, blend } from "./value-motion.ts";

type List = SegmentGeometry | RectGeometry | TextGeometry | LabelsGeometry;

/** A list as drawn, owned: its kind and items, and their points, x and y alternating (rectangles' corners). */
export interface ShownList {
  kind: "list";
  of: List["kind"];
  count: number;
  points: Float32Array;
}

/** A raster as drawn, owned: where it is, its grid, and its pixels. */
export interface ShownRaster {
  kind: "raster";
  box: readonly [number, number, number, number];
  columns: number;
  rows: number;
  pixels: Uint8ClampedArray;
}

/** A list moving: its points before and after, and a frame's. */
export interface MovingList {
  /** The geometry's place among its panel's. */
  index: number;
  mark: List;
  from: Float32Array;
  to: Float32Array;
  points: Float32Array;
  /** A frame's rectangles, for a list of them. */
  rects: Float32Array | undefined;
  /** The y scale the list is on. */
  side: "y" | "yRight";
}

/** A raster moving: its cells' colors before and after, and a frame's. */
export interface MovingRaster {
  index: number;
  mark: RasterGeometry;
  from: Uint8ClampedArray;
  pixels: Uint8ClampedArray<ArrayBuffer>;
}

/** Whether a geometry is a list this module moves: bars move as bars do. */
export function listed(mark: Geometry): mark is List {
  return (
    mark.kind === "segments" ||
    mark.kind === "text" ||
    mark.kind === "labels" ||
    (mark.kind === "rect" && (mark as RectGeometry).bars === undefined)
  );
}

/** The points of a list's items: segments' ends, rectangles' corners, labels' anchors. */
function pointsOf(mark: List): Float32Array {
  switch (mark.kind) {
    case "segments":
      return mark.coords.slice(0, mark.count * 4);
    case "text":
      return mark.coords.slice(0, mark.count * 2);
    case "labels":
      return Float32Array.from(mark.items.flatMap(({ x, y }) => [x, y]));
    case "rect": {
      const { rects, count } = mark;
      const points = new Float32Array(count * 4);
      for (let i = 0; i < count * 4; i += 4) {
        points[i] = rects[i]!;
        points[i + 1] = rects[i + 1]!;
        points[i + 2] = rects[i]! + rects[i + 2]!;
        points[i + 3] = rects[i + 1]! + rects[i + 3]!;
      }
      return points;
    }
  }
}

const countOf = (mark: List) => (mark.kind === "labels" ? mark.items.length : mark.count);

export function copyList(mark: List): ShownList {
  return { kind: "list", of: mark.kind, count: countOf(mark), points: pointsOf(mark) };
}

export function copyRaster({ x, y, width, height, columns, rows, pixels }: RasterGeometry) {
  const box = [x, y, width, height] as const;
  return { kind: "raster", box, columns, rows, pixels: pixels.slice() } satisfies ShownRaster;
}

/**
 * How `shown` moves to `mark`, the same geometry in the new scene, on the x
 * scale and the y scale `side`; undefined unless both have as many items,
 * every one at the same place along x, or every one along y.
 */
export function moveList(
  index: number,
  shown: ShownList,
  mark: List,
  side: "y" | "yRight",
): { moving: MovingList; moves: boolean } | undefined {
  if (shown.of !== mark.kind || shown.count !== countOf(mark)) return undefined;
  const to = pointsOf(mark);
  const { points: from } = shown;
  const along = (axis: 0 | 1) => {
    for (let i = axis; i < to.length; i += 2) if (from[i] !== to[i]) return false;
    return true;
  };
  if (!along(0) && !along(1)) return undefined;
  const moves = from.some((point, i) => point !== to[i]);
  const points = new Float32Array(to.length);
  const rects = mark.kind === "rect" ? new Float32Array(to.length) : undefined;
  return { moving: { index, mark, from, to, points, rects, side }, moves };
}

/** A list at the frame's scales: each point's x and y between, on them. */
export function listAt(moving: MovingList, x: Blend, y: Blend): List {
  const { mark, from, to, points } = moving;
  // A point at one place in both scenes stays there, however the scale moves.
  for (let i = 0; i < points.length; i += 2) {
    points[i] = blend(x, from[i]!, to[i]!);
    points[i + 1] = blend(y, from[i + 1]!, to[i + 1]!);
  }
  switch (mark.kind) {
    case "segments":
    case "text":
      return { ...mark, coords: points };
    case "labels":
      // Each label, and the box behind it, moves by its anchor.
      return {
        ...mark,
        items: mark.items.map((item, i) => {
          const [x, y] = [points[i * 2]!, points[i * 2 + 1]!];
          const { box } = item;
          const moved = box && { ...box, x: box.x + x - item.x, y: box.y + y - item.y };
          return { ...item, x, y, box: moved };
        }),
      };
    case "rect": {
      const rects = moving.rects!;
      for (let i = 0; i < rects.length; i += 4) {
        rects[i] = Math.min(points[i]!, points[i + 2]!);
        rects[i + 1] = Math.min(points[i + 1]!, points[i + 3]!);
        rects[i + 2] = Math.abs(points[i + 2]! - points[i]!);
        rects[i + 3] = Math.abs(points[i + 3]! - points[i + 1]!);
      }
      return { ...mark, rects };
    }
  }
}

/** How `shown` moves to `mark`: undefined unless both draw the same grid in the same place. */
export function moveRaster(
  index: number,
  shown: ShownRaster,
  mark: RasterGeometry,
): { moving: MovingRaster; moves: boolean } | undefined {
  const [x, y, width, height] = shown.box;
  const same =
    mark.x === x &&
    mark.y === y &&
    mark.width === width &&
    mark.height === height &&
    mark.columns === shown.columns &&
    mark.rows === shown.rows;
  if (!same) return undefined;
  const moves = shown.pixels.some((value, i) => value !== mark.pixels[i]);
  const pixels = new Uint8ClampedArray(mark.pixels.length);
  return { moving: { index, mark, from: shown.pixels, pixels }, moves };
}

/**
 * A raster at eased progress `t`: each cell's color between its two. A
 * cell drawn in one scene only keeps its color and fades in or out.
 */
export function rasterAt(moving: MovingRaster, t: number): RasterGeometry {
  const { mark, from, pixels } = moving;
  const to = mark.pixels;
  for (let i = 0; i < pixels.length; i += 4) {
    const [a0, a1] = [from[i + 3]!, to[i + 3]!];
    // Straight alpha: a cell coming or going keeps the color it has.
    const start = a0 === 0 ? to : from;
    const end = a1 === 0 ? from : to;
    for (let c = i; c < i + 3; c++) pixels[c] = start[c]! + (end[c]! - start[c]!) * t;
    pixels[i + 3] = a0 + (a1 - a0) * t;
  }
  return { ...mark, pixels };
}
