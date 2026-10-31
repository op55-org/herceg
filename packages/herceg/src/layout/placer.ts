// The panel placer: where a panel's labels go, once its marks are drawn.
// Series labels (lines' and areas' `labels`, text `from` a series) are
// placed first, together (layout/attached.ts, through the feature
// compiler); annotation labels (text, rule, and region labels) are then
// placed together among their boxes, each mark giving *label requests*:
// its labels' blocks, the places their kind allows, and their policy. A
// mark's labels keep apart from one another, and labels of every mark
// naming one `overlapGroup` keep apart as one group: those that "show"
// stay at their first place, then by `priority` (the higher first), mark
// order, and their own order, those that "hide" are left out where they
// would cover a label placed before them, and those that "move" take the
// first free place their kind allows, nearest first, and are left out
// where none is. Places far from a label's point are tried only after
// every label of the panel has tried its near ones, so a far place never
// takes a nearer label's room; with `leader`, a line joins a label placed
// far to its point, clear of other labels, points, and leaders. Every
// label that moves or hides keeps off series labels. Requests are made per
// panel and frame and used in that frame; nothing is kept between frames,
// panels, or charts sharing a mark.

import type { Frame, Mark, MarkKey, RowParts } from "../marks/mark.ts";
import type { CompiledFeatures } from "../model/features.ts";
import type { Geometry, Rect } from "../scene/scene.ts";
import type { Overlap } from "../spec/encoding.ts";
import { LabelBoxes, segmentMeetsBox, segmentsMeet } from "./label-boxes.ts";

/**
 * A label a mark asks a panel's placer to place: its block at its first
 * place, the offsets its kind allows, its policy, and the box it must stay
 * inside.
 */
export interface LabelRequest {
  readonly mark: MarkKey;
  /** The mark's own index of the label, to draw its placement back. */
  readonly index: number;
  /** Annotation labels of marks naming one group are placed together; by default, a mark's own. */
  readonly group: string | undefined;
  readonly overlap: Overlap;
  readonly priority: number;
  /** Where the block's top left corner is at its first place, and its size (with its box and padding). */
  readonly anchor: { readonly x: number; readonly y: number };
  readonly block: { readonly width: number; readonly height: number };
  /**
   * Offsets of the block from `anchor` for its first place: the one
   * reaching least past its bounds (the earlier of equals, so a rule's
   * label goes to its mirror image only where that reaches less far),
   * moved in by as much as it still reaches past each edge. A label that
   * moves tries the others next, moved in so too.
   */
  readonly places: readonly { readonly dx: number; readonly dy: number }[];
  /**
   * Where a label that moves may go when its first place is taken, nearest
   * first: `count` offsets from `anchor`, the first `near` of them beside
   * what it labels and the rest farther, tried once every label of the
   * panel has tried its near ones. Places reaching past `bounds` are not
   * taken.
   */
  readonly moves?: Moves | undefined;
  /**
   * The point it labels: leaders start `size` pixels from it, and labels
   * placed off their first place keep off the points of others in their
   * group (squares `size` pixels from them).
   */
  readonly point?: { readonly x: number; readonly y: number; readonly size: number } | undefined;
  /** Pixels of room kept around the block within it, which a leader ends inside of. */
  readonly inset?: number | undefined;
  /**
   * Whether its places are moved inside its bounds (rules' and regions'
   * labels, the default), or left out where they reach past them, a label
   * that moves then trying its moves (text's).
   */
  readonly hold?: boolean | undefined;
  /** Whether a label placed far from its point draws a leader back to it. */
  readonly leader: boolean;
  /** The box the block must stay inside: the plot, the chart, or a region's; null for none. */
  readonly bounds: Readonly<Rect> | null;
}

/** Places a label that moves may take beyond its first (see `LabelRequest.moves`). */
export interface Moves {
  readonly count: number;
  readonly near: number;
  at(k: number): { readonly dx: number; readonly dy: number };
}

/**
 * Where a request went: an offset of its block from its anchor, and the
 * leader drawn back to its point, if any; or left out (null).
 */
export type LabelPlacement = {
  readonly dx: number;
  readonly dy: number;
  readonly moved: boolean;
  readonly leader?: readonly [x0: number, y0: number, x1: number, y1: number] | undefined;
} | null;

/** Places a panel's label requests among `obstacles` (boxes to keep off, such as series labels'). */
export type PlaceLabels = (
  requests: readonly LabelRequest[],
  obstacles: readonly Readonly<Rect>[],
) => readonly LabelPlacement[];

/**
 * A mark whose labels a panel's placer places (rule, region, and text
 * marks): asked as its geometry is, with the frame, its key, and its
 * panel's rows; its geometry draws its other parts. Requests are made per
 * panel and frame, and nothing is kept between them.
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
  /** The panel placer it is placed by (`placePanel`), which the chart calls for each panel. */
  readonly placer: PlacePanel;
}

/** What a mark drew in a panel (its record, `DrawnMark`), which the placer adds its labels to. */
export interface PanelDrawing {
  /** The mark's key, and the mark. */
  readonly mark: MarkKey;
  readonly of: Mark;
  readonly frame: Frame;
  readonly rows: RowParts | undefined;
  readonly geometry: Geometry[];
}

/** Places a panel's labels once its marks are drawn, adding them to the marks' geometry. */
export type PlacePanel = (
  drawings: readonly PanelDrawing[],
  features: CompiledFeatures | undefined,
) => void;

/**
 * Places the labels of a panel's marks, `drawings`: series labels first
 * (by the feature compiler, `features.labels`), whose boxes annotation
 * labels then keep off; then every labelled mark's requests together.
 */
export const placePanel: PlacePanel = (drawings, features) => {
  const obstacles = features?.labels?.(drawings) ?? [];
  const requests: LabelRequest[] = [];
  const asked: [drawing: PanelDrawing, from: number, to: number][] = [];
  for (const drawing of drawings) {
    const mark = drawing.of as Mark & Partial<LabelledMark>;
    if (!mark.labelRequests) continue;
    const own = mark.labelRequests(drawing.frame, drawing.mark, drawing.rows);
    if (own.length === 0) continue;
    asked.push([drawing, requests.length, requests.length + own.length]);
    requests.push(...own);
  }
  if (requests.length === 0) return;
  const placements = placeLabels(requests, obstacles);
  for (const [drawing, from, to] of asked)
    drawing.geometry.push(
      ...(drawing.of as Mark & LabelledMark).drawLabels(
        drawing.frame,
        drawing.mark,
        drawing.rows,
        placements.slice(from, to),
      ),
    );
};

/** A group's labels placed so far: their boxes, the points moved labels keep off, and leaders. */
interface Group {
  /** Whether any of its labels hides or moves (others need no boxes kept), and moves. */
  tight: boolean;
  moving: boolean;
  readonly boxes: LabelBoxes;
  points: LabelBoxes | undefined;
  readonly leaders: number[];
}

/**
 * Places `requests` among `obstacles` (see the module): every "show"
 * label at its first place, then by priority (the higher first) and
 * request order, the others.
 */
export const placeLabels: PlaceLabels = (requests, obstacles) => {
  const placements: LabelPlacement[] = requests.map(() => null);
  const groups = new Map<string, Group>();
  const keyOf = (request: LabelRequest) =>
    request.group === undefined ? `m${JSON.stringify(request.mark)}` : `g${request.group}`;
  const groupOf = requests.map((request) => {
    const key = keyOf(request);
    let group = groups.get(key);
    if (!group) {
      group = {
        tight: false,
        moving: false,
        boxes: new LabelBoxes(),
        points: undefined,
        leaders: [],
      };
      groups.set(key, group);
    }
    if (request.overlap !== "show") group.tight = true;
    if (request.overlap === "move") group.moving = true;
    return group;
  });
  // Moved labels keep off the points of the others in their group; labels
  // at one point (to half a pixel) share it, as their own.
  const pointOf = new Int32Array(requests.length).fill(-1);
  const shared = new Map<string, number>();
  requests.forEach((request, i) => {
    const { point } = request;
    const group = groupOf[i]!;
    if (!point || !group.moving) return;
    group.points ??= new LabelBoxes();
    const { x, y, size } = point;
    const at = `${keyOf(request)} ${Math.round(x * 2)} ${Math.round(y * 2)}`;
    let index = shared.get(at);
    if (index === undefined) {
      index = group.points.add(x - size, y - size, x + size, y + size);
      shared.set(at, index);
    }
    pointOf[i] = index;
  });
  const fixed = new LabelBoxes();
  for (const { x, y, width, height } of obstacles) fixed.add(x, y, x + width, y + height);
  // Labels that show are where they are, for every other label to keep off.
  const firsts = requests.map((request) => {
    const places = held(request);
    return places.length === 1 ? places[0]! : places[chosen(request)]!;
  });
  requests.forEach((request, i) => {
    if (request.overlap !== "show") return;
    const at = firsts[i]!;
    placements[i] = placed(at);
    if (groupOf[i]!.tight) groupOf[i]!.boxes.add(...boxAt(request, at));
  });
  const order = requests
    .map((_, i) => i)
    .filter((i) => requests[i]!.overlap !== "show")
    .sort((a, b) => requests[b]!.priority - requests[a]!.priority || a - b);
  /**
   * Whether request `i`'s block at offset `at` is free, and inside its
   * bounds where it moves (a label too large for them has no place); at a
   * place off its first, of points too.
   */
  const free = (i: number, at: Offset, moved: boolean): boolean => {
    const request = requests[i]!;
    const [x0, y0, x1, y1] = boxAt(request, at);
    const group = groupOf[i]!;
    const bound = moved || request.overlap === "move";
    if (bound && request.bounds && !inside(request.bounds, x0, y0, x1, y1)) return false;
    // Labels before points: in a crowded plot labels refuse most places,
    // and there are fewer of them to check.
    if (group.boxes.hits(x0, y0, x1, y1) || fixed.hits(x0, y0, x1, y1)) return false;
    if (moved && group.points?.hits(x0, y0, x1, y1, pointOf[i])) return false;
    return !meetsLeader(group.leaders, (sx, sy, ex, ey) =>
      segmentMeetsBox(sx, sy, ex, ey, x0, y0, x1, y1),
    );
  };
  const take = (i: number, at: Offset, leader?: Leader) => {
    const request = requests[i]!;
    groupOf[i]!.boxes.add(...boxAt(request, at));
    if (leader) groupOf[i]!.leaders.push(...leader);
    placements[i] = placed(at, leader);
  };
  /**
   * Takes offset `at`, off request `i`'s first place, where it is free:
   * with `leader`, more than LEADER_MOVE pixels away only with a leader
   * clear of the group's labels, leaders, and points.
   */
  const moveTo = (i: number, at: Offset): boolean => {
    if (!free(i, at, true)) return false;
    const request = requests[i]!;
    const first = firsts[i]!;
    let leader: Leader | undefined;
    if (
      request.leader &&
      request.point &&
      Math.hypot(at.dx - first.dx, at.dy - first.dy) > LEADER_MOVE
    ) {
      leader = leaderTo(request, at, groupOf[i]!, pointOf[i]!, fixed);
      if (!leader) return false;
    }
    take(i, at, leader);
    return true;
  };
  // Labels that find no place near their point: tried farther out once
  // every label has its near place.
  const later: number[] = [];
  for (const i of order) {
    const request = requests[i]!;
    const at = firsts[i]!;
    if (free(i, at, false)) {
      take(i, at);
      continue;
    }
    if (request.overlap !== "move") continue;
    const first = chosen(request);
    const others = request.places.length > 1 ? held(request).filter((_, k) => k !== first) : [];
    if (others.some((place) => moveTo(i, place))) continue;
    const { moves } = request;
    if (!moves) continue;
    let k = 0;
    while (k < moves.near && !moveTo(i, moves.at(k))) k++;
    if (k === moves.near && moves.count > moves.near) later.push(i);
  }
  for (const i of later) {
    const moves = requests[i]!.moves!;
    for (let k = moves.near; k < moves.count && !moveTo(i, moves.at(k)); k++);
  }
  return placements;
};

type Offset = { readonly dx: number; readonly dy: number };
type Leader = readonly [number, number, number, number];

/** A placement at offset `at` of a request's anchor, with its leader. */
function placed(at: Offset, leader?: Leader): LabelPlacement {
  const moved = at.dx !== 0 || at.dy !== 0;
  return leader ? { dx: at.dx, dy: at.dy, moved, leader } : { dx: at.dx, dy: at.dy, moved };
}

/** The box of `request`'s block at offset `at`: x0, y0, x1, y1. */
function boxAt(request: LabelRequest, at: Offset): [number, number, number, number] {
  const x = request.anchor.x + at.dx;
  const y = request.anchor.y + at.dy;
  return [x, y, x + request.block.width, y + request.block.height];
}

/**
 * The index of a request's first place among its `places`: the one
 * reaching least past its bounds, the earlier of equals.
 */
function chosen({ anchor, block, places, bounds, hold }: LabelRequest): number {
  if (!bounds || hold === false) return 0;
  const reach = ({ dx, dy }: Offset) =>
    beyond(anchor.x + dx, block.width, bounds.x, bounds.width) +
    beyond(anchor.y + dy, block.height, bounds.y, bounds.height);
  let best = 0;
  for (let k = 1; k < places.length; k++) if (reach(places[k]!) < reach(places[best]!)) best = k;
  return best;
}

/** A request's `places` (or its anchor alone), each moved inside its bounds where it holds them. */
function held({ anchor, block, places, bounds, hold }: LabelRequest): Offset[] {
  const given = places.length > 0 ? places : [{ dx: 0, dy: 0 }];
  if (!bounds || hold === false) return [...given];
  return given.map(({ dx, dy }) => ({
    dx: within(anchor.x + dx, block.width, bounds.x, bounds.width) - anchor.x,
    dy: within(anchor.y + dy, block.height, bounds.y, bounds.height) - anchor.y,
  }));
}

/** Pixels a label moves past which it draws its leader, when asked: nearer, it reads as at its place. */
const LEADER_MOVE = 6;
/** Steps a sliding label takes forward, then back, from its first place. */
const SLIDES = 8;
/** Pixels between a label and the one it slid away from. */
const SLIDE_GAP = 2;

/**
 * The places of a label sliding along `axis` (a region's, along its
 * side): forward and then back, a block and a gap at a time, all far
 * from its first place; places past its bounds are not taken.
 */
export function slidesAlong(axis: "x" | "y", block: LabelRequest["block"]): Moves {
  const step = (axis === "x" ? block.width : block.height) + SLIDE_GAP;
  return {
    count: 2 * SLIDES,
    near: 0,
    at: (k) => {
      const d = (k % 2 ? -1 : 1) * (Math.floor(k / 2) + 1) * step;
      return axis === "x" ? { dx: d, dy: 0 } : { dx: 0, dy: d };
    },
  };
}

/**
 * The leader from `request`'s point to its block at offset `at`: from
 * the point's edge to the nearest point of the block (inside its inset),
 * clear of the group's labels and leaders, the obstacles, and others'
 * points; undefined where it is not clear.
 */
function leaderTo(
  request: LabelRequest,
  at: Offset,
  group: Group,
  point: number,
  fixed: LabelBoxes,
): Leader | undefined {
  const from = request.point!;
  const inset = request.inset ?? 0;
  const [x0, y0, x1, y1] = boxAt(request, at);
  const ex = Math.min(Math.max(from.x, x0 + inset), x1 - inset);
  const ey = Math.min(Math.max(from.y, y0 + inset), y1 - inset);
  const length = Math.hypot(ex - from.x, ey - from.y) || 1;
  const sx = from.x + ((ex - from.x) / length) * from.size;
  const sy = from.y + ((ey - from.y) / length) * from.size;
  if (group.boxes.crosses(sx, sy, ex, ey) || fixed.crosses(sx, sy, ex, ey)) return undefined;
  if (group.points?.crosses(sx, sy, ex, ey, point)) return undefined;
  if (meetsLeader(group.leaders, (ax, ay, bx, by) => segmentsMeet(sx, sy, ex, ey, ax, ay, bx, by)))
    return undefined;
  return [sx, sy, ex, ey];
}

/** Whether `test` holds for one of `leaders` (x0, y0, x1, y1 each). */
function meetsLeader(
  leaders: readonly number[],
  test: (sx: number, sy: number, ex: number, ey: number) => boolean,
): boolean {
  for (let k = 0; k < leaders.length; k += 4)
    if (test(leaders[k]!, leaders[k + 1]!, leaders[k + 2]!, leaders[k + 3]!)) return true;
  return false;
}

function inside(box: Readonly<Rect>, x0: number, y0: number, x1: number, y1: number): boolean {
  // Within a millionth of a pixel: places moved inside are at the edge, to rounding.
  return (
    x0 >= box.x - 1e-6 &&
    x1 <= box.x + box.width + 1e-6 &&
    y0 >= box.y - 1e-6 &&
    y1 <= box.y + box.height + 1e-6
  );
}

/**
 * How far a label's box moves to stay inside `plot`, as the placer places
 * one block alone: to its mirror image across a rule's line (`mirror`,
 * along x for a vertical one) where it reaches past the plot on its side
 * and the image reaches less far, then in by as much as it still reaches
 * past each edge. Plain rule labels, placed as they are drawn.
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
