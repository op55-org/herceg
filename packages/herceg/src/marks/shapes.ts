// The shapes marks draw, measured: boxes, what a clip keeps of them, and
// how far a point is from a segment, a stroke, or a disc as drawn. Marks'
// lookups (`pick`) and picking (marks/lookups.ts, model/pick.ts) read them.

import type { Rect } from "../scene/scene.ts";
import type { Clip } from "../spec/spec.ts";
import type { Frame } from "./mark.ts";

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
