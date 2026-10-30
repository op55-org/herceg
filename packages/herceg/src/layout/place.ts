// Where chart furniture goes: items anchored inside a box (a legend at a
// plot's corner), text and boxes aligned in a span, and annotations' labels
// kept inside the plot. The model stacks titles and legends along the
// chart's sides and reserves their room from the panels; these are the
// small pieces that arithmetic shares.

import type { Frame, MarkKey, RowParts } from "../marks/mark.ts";
import type { Geometry, Rect } from "../scene/scene.ts";
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
 * A label a mark asks a panel's placer to place (rule and region labels):
 * its block at its first place, the offsets its kind allows in order of
 * preference, and the box it must stay inside.
 */
export interface LabelRequest {
  readonly mark: MarkKey;
  /** The mark's own index of the label, to draw its placement back. */
  readonly index: number;
  /** Annotation labels of marks naming one group are placed together (not yet). */
  readonly group: string | undefined;
  readonly overlap: "show" | "hide" | "move";
  readonly priority: number;
  /** Where the block's top left corner is at its first place, and its size (with its box and padding). */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly block: { readonly width: number; readonly height: number };
  /** Offsets of the block from `anchor` its kind allows, in order of preference (the first none). */
  readonly places: readonly { readonly dx: number; readonly dy: number }[];
  readonly leader: boolean;
  /** The box the block must stay inside: the plot, the chart, or a region's; null for none. */
  readonly bounds: Readonly<Rect> | null;
}

/** Where a request went: an offset of its block from its anchor, or left out (null). */
export type LabelPlacement = {
  readonly dx: number;
  readonly dy: number;
  readonly moved: boolean;
} | null;

/** Places a panel's label requests among `obstacles` (boxes to keep off, such as series labels'). */
export type PlaceLabels = (
  requests: readonly LabelRequest[],
  obstacles: readonly Readonly<Rect>[],
) => readonly LabelPlacement[];

/**
 * A mark whose labels a panel's placer places (rule and region marks):
 * asked as its geometry is, with the frame, its key, and its panel's rows.
 * Requests are made per panel and frame, and nothing is kept between them.
 */
export interface LabelledMark {
  labelRequests(frame: Frame, key: MarkKey, panelRows?: RowParts): readonly LabelRequest[];
  /** Its labels drawn at their placements, in request order. */
  drawLabels(
    frame: Frame,
    key: MarkKey,
    panelRows: RowParts | undefined,
    placements: readonly LabelPlacement[],
  ): Geometry[];
}

/**
 * Places each request on its own: at the place reaching least past its
 * bounds (the earlier of equals, so a rule's label goes to its mirror
 * image only where that reaches less far), then moved in by as much as it
 * still reaches past each edge. A block larger than its bounds keeps its
 * left or top edge in them. Labels do not yet keep off each other or
 * `obstacles`.
 */
export const placeLabels: PlaceLabels = (requests) =>
  requests.map(({ anchor, block, places, bounds }) => {
    if (!bounds) return { dx: 0, dy: 0, moved: false };
    const reach = ({ dx, dy }: { dx: number; dy: number }) =>
      beyond(anchor.x + dx, block.width, bounds.x, bounds.width) +
      beyond(anchor.y + dy, block.height, bounds.y, bounds.height);
    let chosen = places[0] ?? { dx: 0, dy: 0 };
    for (const place of places.slice(1)) if (reach(place) < reach(chosen)) chosen = place;
    const dx = within(anchor.x + chosen.dx, block.width, bounds.x, bounds.width) - anchor.x;
    const dy = within(anchor.y + chosen.dy, block.height, bounds.y, bounds.height) - anchor.y;
    return { dx, dy, moved: dx !== 0 || dy !== 0 };
  });

/**
 * How far a label's box moves to stay inside `plot`, as `placeLabels`
 * places one block alone: to its mirror image across a rule's line
 * (`mirror`, along x for a vertical one) where it reaches past the plot on
 * its side and the image reaches less far, then in by as much as it still
 * reaches past each edge. Plain rule labels, placed as they are drawn.
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
    shift[axis] = within(at, length, from, room) - start;
  }
  return [shift.x, shift.y];
}

/** The offsets of a block at `box` to where it is and to its mirror image across a rule's `line`. */
export function mirrorPlaces(
  box: Rect,
  line: { axis: "x" | "y"; at: number },
): { dx: number; dy: number }[] {
  const along = line.axis === "x";
  const [start, length] = along ? [box.x, box.width] : [box.y, box.height];
  const image = 2 * line.at - start - length - start;
  return [
    { dx: 0, dy: 0 },
    { dx: along ? image : 0, dy: along ? 0 : image },
  ];
}

/** Where a span from `start`, `length` long, starts moved into the room from `from`, `room` long. */
function within(start: number, length: number, from: number, room: number): number {
  if (start < from || length > room) return from;
  return start + length > from + room ? from + room - length : start;
}

/** How far a span from `start`, `length` long, reaches past the room from `from`, `room` long. */
function beyond(start: number, length: number, from: number, room: number): number {
  return Math.max(0, from - start) + Math.max(0, start + length - from - room);
}
