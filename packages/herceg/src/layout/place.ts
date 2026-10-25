// Where chart furniture goes: items anchored inside a box (a legend at a
// plot's corner), text and boxes aligned in a span, and annotations' labels
// kept inside the plot. The model stacks titles and legends along the
// chart's sides and reserves their room from the panels; these are the
// small pieces that arithmetic shares.

import type { Rect } from "../scene/scene.ts";
import type { Inside } from "../spec/place.ts";

/**
 * The top left corner of an item `width` by `height` inside `box` at
 * `inside`, a corner or the middle of an edge, `inset` pixels in.
 */
export function insideAt(
  inside: Inside,
  box: Rect,
  width: number,
  height: number,
  inset: number,
): { x: number; y: number } {
  const across = inside.endsWith("left") ? 0 : inside.endsWith("right") ? 1 : 0.5;
  const down = inside.startsWith("top") ? 0 : inside.startsWith("bottom") ? 1 : 0.5;
  return {
    x: box.x + inset + (box.width - width - 2 * inset) * across,
    y: box.y + inset + (box.height - height - 2 * inset) * down,
  };
}

/** Where something goes in a span: at its start, center, or end. */
export type Align = "start" | "center" | "end";

const SHARE = { start: 0, center: 0.5, end: 1 } as const;
const ANCHOR = { start: "start", center: "middle", end: "end" } as const;

/** Where an item `length` long goes in a span from `start`, `room` long, aligned `align` (its start by default). */
export function alignedAt(
  align: Align | undefined,
  start: number,
  room: number,
  length: number,
): number {
  return start + (room - length) * SHARE[align ?? "start"];
}

/**
 * Where text aligned `align` goes in a span from `start`, `length` long
 * (negative for a span read backward): its anchor point and anchor.
 */
export function aligned(
  align: Align,
  start: number,
  length: number,
): { at: number; anchor: "start" | "middle" | "end" } {
  return { at: start + length * SHARE[align], anchor: ANCHOR[align] };
}

/**
 * How far an annotation's label moves for its box to stay inside `plot`:
 * to its mirror image across a rule's line (`mirror`, along x for a
 * vertical one) where it reaches past the plot on its side and the image
 * reaches less far, then in by as much as it still reaches past each edge.
 * A box larger than the plot keeps its left or top edge in it.
 */
export function shiftInside(
  box: Rect,
  plot: Rect,
  mirror?: { axis: "x" | "y"; at: number },
): [dx: number, dy: number] {
  const shift = { x: 0, y: 0 };
  for (const axis of ["x", "y"] as const) {
    const [start, length] = axis === "x" ? [box.x, box.width] : [box.y, box.height];
    const [from, room] = axis === "x" ? [plot.x, plot.width] : [plot.y, plot.height];
    let at = start;
    if (mirror?.axis === axis) {
      const image = 2 * mirror.at - start - length;
      if (beyond(image, length, from, room) < beyond(start, length, from, room)) at = image;
    }
    if (at < from || length > room) at = from;
    else if (at + length > from + room) at = from + room - length;
    shift[axis] = at - start;
  }
  return [shift.x, shift.y];
}

/** How far a span from `start`, `length` long, reaches past the room from `from`, `room` long. */
function beyond(start: number, length: number, from: number, room: number): number {
  return Math.max(0, from - start) + Math.max(0, start + length - from - room);
}
