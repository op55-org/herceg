// Labels attached to marks' series (marks/attachments.ts): placed as blocks
// beside the point they follow, or outside the plot in the side tracks the
// chart keeps for marks' labels (`Frame.outside`, `Mark.room`). Inside,
// `align` says which way the block goes from its point: "start" after it
// (to the right), "end" before it, "center" over it, where `verticalAlign`
// puts it below ("top"), above ("bottom"), or on it; it stands `GAP` and
// its offset away, and within the plot: a block that would cross its left
// or right edge, into an axis' tick labels or a neighboring panel, moves
// along its row until it is inside, over its series (its halo keeps it
// legible there), and one wider than the plot has its lines shortened with
// an ellipsis to fit (left out when nothing but the ellipsis would); a
// label of parts, the part that runs past.
// Outside, labels before their series ("end") go in the left track, others
// in the right one, at their point's height, their offset further from the
// plot. Extents are as painted: halos and boxes' outlines too.
//
// A panel's series labels, of every mark, are placed together, each as its
// `overlap` says. Labels that "move" keep apart along y from those whose
// extents along x they meet (in one side's track, or inside), in the order
// of their points, moving as little as that allows (the least sum of
// squared moves) and staying within the plot; where the plot is too short
// for all of them, those of lowest `priority`, then the last in series
// order, are left out until the rest fit. Labels that "show" stay at their
// points, and those that move keep off them. Those that "hide" stay there
// too, or are left out where they would cover a label kept before them;
// they are kept by priority, then series order: those that outrank every
// label that moves before the movers are placed (and the movers keep off
// them), the others after. A label moved more than LEADER_MOVE pixels draws
// a leader back to its point when asked. The feature compiler places labels with it, and hands it the
// chart's code it uses (`AttachedKit`), so the line chart's first chunk
// does not load it.

import { leaderDrawingOf } from "../draw/leaders.ts";
import type { markupOf, n } from "../draw/markup.ts";
import type { textItemMarkup } from "../draw/text.ts";
import { labelsDrawingOf } from "../draw/text-items.ts";
import type { Attachment } from "../marks/attachments.ts";
import type { PartText } from "../marks/features/part-text.ts";
import type { Frame } from "../marks/mark.ts";
import type {
  Drawing,
  Geometry,
  LabelsGeometry,
  Rect,
  SegmentGeometry,
  TextItem,
} from "../scene/scene.ts";
import type { Overlap } from "../spec/encoding.ts";
import type { ResolvedHalo, TextPaint } from "../style/style.ts";
import type { surface } from "../theme.ts";
import { anchorBlock } from "./block.ts";
import { LabelBoxes } from "./label-boxes.ts";
import { separate } from "./separate.ts";
import type { fitText, TextLines, textItem, textLines } from "./text.ts";

/** The chart's code labels are placed and drawn with (see model/guides.ts `GUIDE_KIT`). */
export interface AttachedKit {
  readonly fitText: typeof fitText;
  readonly textLines: typeof textLines;
  readonly textItem: typeof textItem;
  readonly textItemMarkup: typeof textItemMarkup;
  readonly surface: typeof surface;
  readonly markupOf: typeof markupOf;
  readonly n: typeof n;
}

/** How placed labels and their leaders draw, with the chart's markup (made once). */
let drawing: Drawing<LabelsGeometry> | undefined;
let leaders: Drawing<SegmentGeometry> | undefined;

/** Pixels between a label inside the plot and its point. */
const GAP = 4;
/** Pixels a label moves before it draws a leader back to its point. */
export const LEADER_MOVE = 6;
/** Pixels from a point to its leader's start, so the leader does not cover it. */
const LEADER_GAP = 2;
/** Pixels by which boxes may overlap and still count as apart: rounding. */
const EPSILON = 1e-6;
/** Blocks meeting only some of the others solved as such; larger groups are solved as columns. */
const GROUP = 48;

/** How a leader looks: resolved from `leader: true` or its own look (the theme's muted color by default). */
export interface LeaderLook {
  readonly stroke: string | undefined;
  /** Names the stroke in messages: `line labels.leader.stroke`. */
  readonly path: string;
  readonly strokeWidth: number;
  readonly dash?: readonly number[] | undefined;
  readonly opacity?: number | undefined;
}

/**
 * A mark whose series labels are placed: the key its geometry is drawn
 * under, the look of its leaders, and the room its labels outside the plot
 * took left and right in the panel placed last.
 */
export interface LabelOwner {
  readonly key: string;
  readonly leader: LeaderLook | undefined;
  room: [number, number];
}

/** A label C's marks attach to a series, its content resolved, as `placeAttached` places it. */
export interface AttachedLabel {
  /** Stable within its mark: the source series' key and where the label follows it. */
  readonly key: string;
  readonly at: Attachment;
  readonly text: string;
  /** Its text in parts of their own looks, where it has them. */
  readonly parts?: PartText | undefined;
  /** Its resolved style: `align` and `verticalAlign` anchor its block (see the module). */
  readonly paint: TextPaint;
  readonly place: {
    readonly outside?: boolean | undefined;
    /** Whether outside labels keep room in their track; true by default. */
    readonly reserve?: boolean | undefined;
    readonly offset?: number | undefined;
  };
  readonly halo: ResolvedHalo | undefined;
  readonly overlap: Overlap;
  readonly priority: number;
  /** The mark it labels the series of, which draws it. */
  readonly owner: LabelOwner;
}

/**
 * Places a panel's series labels, `labels` (of every mark, in mark and
 * series order), in `frame`'s panel: each owner's geometry (its leaders,
 * then its labels), and the boxes of the labels drawn, which other labels
 * keep off. Sets each owner's `room`: what its outside labels that reserve
 * it take in the left and right tracks, in pixels. Labels of hidden series
 * are left out.
 */
export function placeAttached(
  labels: readonly AttachedLabel[],
  frame: Frame,
  { fitText, textLines, textItem, textItemMarkup, surface, markupOf, n }: AttachedKit,
): { geometry: Map<LabelOwner, Geometry[]>; boxes: Rect[] } {
  const { plot, measure } = frame;
  // Each label's block, unturned.
  const blocks: Block[] = [];
  labels.forEach((label, order) => {
    label.owner.room = [0, 0];
    if (!label.at.visible) return;
    const { paint, place, at, halo } = label;
    const [top, right, bottom, left] = paint.background ? paint.padding : [0, 0, 0, 0];
    // How far painting reaches past the block: a halo half its width around
    // the glyphs, less a box's padding, or a box's outline half its width.
    const box = paint.background;
    const pastOutline = box?.stroke ? (box.strokeWidth ?? 1) / 2 : 0;
    const pastHalo = halo ? Math.max(0, halo.width / 2 - Math.min(top, right, bottom, left)) : 0;
    const reach = Math.max(pastHalo, pastOutline);
    let { text, parts } = label;
    let lines = parts?.lines ?? textLines(text, paint, measure);
    const offset = place.offset ?? 0;
    const align = paint.align ?? "start";
    const verticalAlign = paint.verticalAlign ?? "middle";
    let x = at.x;
    let y = at.y;
    let keeps: Block["room"];
    if (place.outside) {
      const side = align === "end" ? 0 : 1;
      const edges = frame.outside ?? [plot.x - GAP, plot.x + plot.width + GAP];
      x = side ? edges[1] + offset : edges[0] - offset;
      if (place.reserve !== false)
        keeps = [side, Math.ceil(lines.width + left + right + reach + offset)];
    } else {
      // Lines wider than the plot's room, shortened to it.
      const room = plot.width - left - right - 2 * reach;
      if (lines.width > room && parts) {
        parts = parts.fit(room);
        if (!parts) return;
        lines = parts.lines;
        text = lines.lines.join("\n");
      } else if (lines.width > room) {
        const fitted = lines.lines.map((line) => fitText(line, room, measure, paint.css));
        if (fitted.some((line, k) => line === "…" && line !== lines.lines[k])) return;
        text = fitted.join("\n");
        lines = textLines(text, paint, measure);
      }
      const away = GAP + offset;
      if (align === "start") x += away;
      else if (align === "end") x -= away;
      else if (verticalAlign === "top") y += away;
      else if (verticalAlign === "bottom") y -= away;
    }
    // Where it is painted along x, halo or outline included: inside, within the plot.
    const width = lines.width + left + right + 2 * reach;
    let from =
      x - (width - 2 * reach) * (align === "start" ? 0 : align === "end" ? 1 : 0.5) - reach;
    if (!place.outside) {
      const kept = Math.max(plot.x, Math.min(from, plot.x + plot.width - width));
      x += kept - from;
      from = kept;
    }
    const block = lines.height + top + bottom;
    // Where the painted top is when the anchor is at `y`.
    const lift =
      reach + (verticalAlign === "top" ? 0 : verticalAlign === "middle" ? block / 2 : block);
    blocks.push({
      label,
      order,
      text,
      parts,
      reach,
      lines,
      x,
      top: y - lift,
      wanted: y - lift,
      lift,
      height: block + 2 * reach,
      extent: [from, from + width],
      room: keeps,
    });
  });
  const geometry = new Map<LabelOwner, Geometry[]>();
  const boxes: Rect[] = [];
  const kept = arrange(blocks, plot);
  if (kept.length === 0) return { geometry, boxes };
  const under = frame.surface ?? surface(frame.theme);
  const drawn = new Map<LabelOwner, { items: TextItem[]; leaders: number[] }>();
  for (const block of kept) {
    const { label, text, parts, reach, lines, x, top, lift, room: taken, extent, height } = block;
    const { owner, paint, halo, at } = label;
    if (taken) owner.room[taken[0]] = Math.max(owner.room[taken[0]], taken[1]);
    let own = drawn.get(owner);
    if (!own) {
      own = { items: [], leaders: [] };
      drawn.set(owner, own);
    }
    const align = paint.align ?? "start";
    const { at: point, box } = anchorBlock(
      lines,
      { x, y: top + lift, align, verticalAlign: paint.verticalAlign ?? "middle", angle: 0 },
      paint,
    );
    if (parts) {
      const [from, to] = extent;
      const inner = {
        x: from + reach,
        y: top + reach,
        width: to - from - 2 * reach,
        height: height - 2 * reach,
      };
      own.items.push(...parts.items(inner, point.anchor, paint, halo));
    } else {
      const item = textItem(text, point, paint, under, measure, box);
      own.items.push(halo ? { ...item, halo } : item);
    }
    boxes.push({ x: extent[0], y: top, width: extent[1] - extent[0], height });
    if (owner.leader && Math.abs(top - block.wanted) > LEADER_MOVE)
      own.leaders.push(...leaderOf(at, block, align));
  }
  for (const [owner, { items, leaders: coords }] of drawn) {
    const parts: Geometry[] = [];
    const look = owner.leader;
    if (look && coords.length > 0) {
      leaders ??= leaderDrawingOf(markupOf, n);
      const segments: SegmentGeometry = {
        kind: "segments",
        draw: leaders,
        key: `${owner.key}|leaders`,
        stroke: look.stroke === undefined ? frame.theme.muted : frame.paint(look.stroke, look.path),
        strokeWidth: look.strokeWidth,
        coords: Float32Array.from(coords),
        count: coords.length / 4,
      };
      if (look.dash) segments.dash = look.dash;
      if (look.opacity !== undefined) segments.opacity = look.opacity;
      parts.push(segments);
    }
    drawing ??= labelsDrawingOf(textItemMarkup);
    parts.push({ kind: "labels", draw: drawing, key: owner.key, items } as LabelsGeometry);
    geometry.set(owner, parts);
  }
  return { geometry, boxes };
}

/**
 * A label's block as painted: its text (shortened to fit) and lines, its
 * place in the panel's labels (`order`), its anchor's x, its top and the
 * top it would have at its point (`wanted`), how far its anchor is below
 * its top, its height, its extent along x, and the room it keeps in a
 * side's track (0 left, 1 right) outside the plot.
 */
interface Block {
  readonly label: AttachedLabel;
  readonly order: number;
  readonly text: string;
  readonly parts: PartText | undefined;
  /** How far painting reaches past the block (halo or outline). */
  readonly reach: number;
  readonly lines: TextLines;
  readonly x: number;
  top: number;
  readonly wanted: number;
  readonly lift: number;
  readonly height: number;
  readonly extent: readonly [number, number];
  readonly room: readonly [side: 0 | 1, size: number] | undefined;
}

/** A leader from `at` to the side of `block` facing it: its middle, at the edge its alignment puts nearest. */
function leaderOf(
  at: Attachment,
  block: Block,
  align: "start" | "center" | "end",
): [number, number, number, number] {
  const [from, to] = block.extent;
  const middle = block.top + block.height / 2;
  const [ex, ey] =
    align === "start"
      ? [from, middle]
      : align === "end"
        ? [to, middle]
        : [(from + to) / 2, middle > at.y ? block.top : block.top + block.height];
  const length = Math.hypot(ex - at.x, ey - at.y) || 1;
  return [
    at.x + ((ex - at.x) / length) * LEADER_GAP,
    at.y + ((ey - at.y) / length) * LEADER_GAP,
    ex,
    ey,
  ];
}

/** Whether two blocks' extents along x meet. */
function meet(a: Block, b: Block): boolean {
  return a.extent[0] < b.extent[1] - EPSILON && b.extent[0] < a.extent[1] - EPSILON;
}

/** Files `block`'s box, as placed, in `boxes`. */
function file(boxes: LabelBoxes, block: Block): void {
  boxes.add(block.extent[0], block.top, block.extent[1], block.top + block.height);
}

/** Whether `block` as placed covers a box of `boxes`, beyond rounding. */
function covers(boxes: LabelBoxes, block: Block): boolean {
  return boxes.hits(
    block.extent[0] + EPSILON,
    block.top + EPSILON,
    block.extent[1] - EPSILON,
    block.top + block.height - EPSILON,
  );
}

/**
 * The blocks drawn, in the panel's order: those that "show" at their
 * points; those that "hide" and outrank every one that moves, by priority
 * and order, where they cover none kept before; those that "move" placed
 * apart (`apart`) among those; then the other hiders, where they cover
 * none kept.
 */
function arrange(blocks: Block[], plot: Rect): Block[] {
  const walls: Block[] = [];
  const movers: Block[] = [];
  const hiders: Block[] = [];
  for (const block of blocks)
    (block.label.overlap === "move"
      ? movers
      : block.label.overlap === "hide"
        ? hiders
        : walls
    ).push(block);
  const kept = new LabelBoxes();
  for (const wall of walls) file(kept, wall);
  const strongest = Math.max(
    Number.NEGATIVE_INFINITY,
    ...movers.map(({ label }) => label.priority),
  );
  hiders.sort((a, b) => b.label.priority - a.label.priority || a.order - b.order);
  const later: Block[] = [];
  for (const block of hiders)
    if (block.label.priority <= strongest) later.push(block);
    else if (!covers(kept, block)) {
      file(kept, block);
      walls.push(block);
    }
  const drawn = [...walls, ...apart(movers, walls, plot)];
  for (const block of drawn.slice(walls.length)) file(kept, block);
  for (const block of later)
    if (!covers(kept, block)) {
      file(kept, block);
      drawn.push(block);
    }
  return drawn.sort((a, b) => a.order - b.order);
}

/**
 * The blocks that fit in the plot's height, moved apart along y where
 * their extents along x meet, and off the `walls` (labels kept where they
 * are) they meet, in the order of their points (ties in the panel's
 * order), each moved as little as that and staying in the plot allow (the
 * least sum of squared moves). Blocks whose extents meet, directly or
 * through others, are solved together, exactly: a column (every block
 * meets every other and every wall the group meets, as outside labels
 * and labels at one point do) by pool-adjacent-violators between the
 * walls, in O(k log k) for k blocks and w walls; others of `GROUP` blocks
 * or fewer by `partial`. Larger others are kept apart as a column, every
 * block below the earlier ones and every wall met, which may move them
 * further than they need. Finding the walls each group meets takes
 * O(W log W) for W walls, and sorting them O(w log w) a group (O(G·W log W)
 * for G groups every wall meets). Tops move
 * continuously with the points while the same blocks meet in the same
 * order; where two points cross, their labels change places at once.
 */
function apart(blocks: Block[], walls: readonly Block[], plot: Rect): Block[] {
  blocks.sort(byPoint);
  const groups = meeting(blocks);
  // Each group's span along x, which every point of is in one of its blocks.
  const spans = groups.map((group) => ({
    group,
    from: Math.min(...group.map(({ extent }) => extent[0])),
    to: Math.max(...group.map(({ extent }) => extent[1])),
  }));
  spans.sort((a, b) => a.from - b.from);
  // The walls each group meets, in one sweep along x.
  const byStart = [...walls].sort((a, b) => a.extent[0] - b.extent[0]);
  let next = 0;
  let open: Block[] = [];
  const kept: Block[] = [];
  for (const { group, from, to } of spans) {
    while (next < byStart.length && byStart[next]!.extent[0] < to - EPSILON)
      open.push(byStart[next++]!);
    open = open.filter(({ extent }) => extent[1] > from + EPSILON);
    const met = open.filter(({ extent }) => extent[0] < to - EPSILON);
    kept.push(
      ...(group.length > GROUP || columnOf(group, met)
        ? column(group, met, plot)
        : partial(group, met, plot)),
    );
  }
  return kept;
}

/** Blocks in the order of their points, ties in the panel's order. */
function byPoint(a: Block, b: Block): number {
  return a.label.at.y - b.label.at.y || a.order - b.order;
}

/** The groups of `blocks` (in their order) whose extents along x meet, directly or through others. */
function meeting(blocks: readonly Block[]): Block[][] {
  const byStart = [...blocks].sort((a, b) => a.extent[0] - b.extent[0]);
  const groupOf = new Map<Block, number>();
  let group = -1;
  let end = Number.NEGATIVE_INFINITY;
  for (const block of byStart) {
    if (block.extent[0] >= end - EPSILON) {
      group++;
      end = block.extent[1];
    } else end = Math.max(end, block.extent[1]);
    groupOf.set(block, group);
  }
  const groups: Block[][] = Array.from({ length: group + 1 }, () => []);
  for (const block of blocks) groups[groupOf.get(block)!]!.push(block);
  return groups;
}

/**
 * Whether `blocks` are a column among `walls`: every block meets every
 * other (their extents share a stretch) and every wall meets them all.
 */
function columnOf(blocks: readonly Block[], walls: readonly Block[]): boolean {
  let [from, to] = [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY];
  for (const { extent } of blocks)
    [from, to] = [Math.max(from, extent[0]), Math.min(to, extent[1])];
  return (
    from < to - EPSILON &&
    walls.every(({ extent }) => extent[0] < to - EPSILON && extent[1] > from + EPSILON)
  );
}

/**
 * `blocks` (in their order) as a column among the `walls` they meet:
 * those between two walls in the order of their points, between them,
 * the stretches the walls leave solved alone. Where a stretch is too
 * short for its blocks, those of lowest priority, then the last in the
 * panel's order, are left out until the rest fit.
 */
function column(blocks: readonly Block[], walls: readonly Block[], plot: Rect): Block[] {
  const ordered = [...walls].sort(byPoint);
  const w = ordered.length;
  // Stretch k is below every wall before the k-th and above the others.
  const lo = [plot.y];
  for (const wall of ordered) lo.push(Math.max(lo.at(-1)!, wall.top + wall.height));
  const hi = new Float64Array(w + 1);
  hi[w] = plot.y + plot.height;
  for (let k = w - 1; k >= 0; k--) hi[k] = Math.min(hi[k + 1]!, ordered[k]!.top);
  const stretches: Block[][] = Array.from({ length: w + 1 }, () => []);
  let k = 0;
  for (const block of blocks) {
    while (k < w && byPoint(ordered[k]!, block) < 0) k++;
    stretches[k]!.push(block);
  }
  const kept: Block[] = [];
  stretches.forEach((stretch, k) => {
    const fit = fitting(stretch, hi[k]! - lo[k]!);
    stack(fit, lo[k]!, hi[k]!);
    kept.push(...fit);
  });
  return kept;
}

/** `blocks` (in their order) less the weakest, until they stack within `room`. */
function fitting(blocks: readonly Block[], room: number): Block[] {
  let total = blocks.reduce((sum, { height }) => sum + height, 0);
  if (total <= room + EPSILON) return [...blocks];
  const out = new Set<Block>();
  const weakest = [...blocks].sort(
    (a, b) => a.label.priority - b.label.priority || b.order - a.order,
  );
  for (const block of weakest) {
    if (total <= room + EPSILON) break;
    out.add(block);
    total -= block.height;
  }
  return blocks.filter((block) => !out.has(block));
}

/**
 * Sets the tops of `blocks` (in their order, together no taller than
 * `hi` - `lo`): each below the one before, within `lo` and `hi`, the sum
 * of squared moves least. With each top less the heights above it, the
 * tops must not decrease, which pool-adjacent-violators solves exactly,
 * and the bounds clip the result.
 */
function stack(blocks: readonly Block[], lo: number, hi: number): void {
  const above: number[] = [];
  let total = 0;
  for (const block of blocks) {
    above.push(total);
    total += block.height;
  }
  // Runs of blocks moved as one: their first block and the sum of their wanted levels.
  const runs: { first: number; sum: number; count: number }[] = [];
  blocks.forEach((block, i) => {
    let run = { first: i, sum: block.wanted - above[i]!, count: 1 };
    for (
      let last = runs.at(-1);
      last && last.sum / last.count > run.sum / run.count;
      last = runs.at(-1)
    ) {
      runs.pop();
      run = { first: last.first, sum: last.sum + run.sum, count: last.count + run.count };
    }
    runs.push(run);
  });
  runs.forEach((run, r) => {
    const level = Math.min(Math.max(run.sum / run.count, lo), hi - total);
    const end = runs[r + 1]?.first ?? blocks.length;
    for (let i = run.first; i < end; i++) blocks[i]!.top = level + above[i]!;
  });
}

/**
 * `group`'s blocks (in their order), which meet only some of the others or
 * of the `walls`, placed: those that fit, each below every earlier one it
 * meets, between the walls it meets as their points are (below those
 * before its point, above the others) and inside the plot, the sum of
 * squared moves least (`separate`). Where some cannot fit, the lowest
 * priority, then the last in the panel's order, among those, is left
 * out, and the rest are looked at again: O(k · (w + m)) for k blocks, w
 * walls, and m meeting pairs, a time each one is left out.
 */
function partial(group: readonly Block[], walls: readonly Block[], plot: Rect): Block[] {
  // Each block's bounds: the plot, and the walls it meets. Those with no
  // room between them are left out first, whatever their priority.
  const bounds = new Map<Block, [number, number]>();
  for (const block of group) {
    let [lo, hi] = [plot.y, plot.y + plot.height];
    for (const wall of walls)
      if (meet(wall, block)) {
        if (byPoint(wall, block) < 0) lo = Math.max(lo, wall.top + wall.height);
        else hi = Math.min(hi, wall.top);
      }
    if (hi - lo >= block.height - EPSILON) bounds.set(block, [lo, hi]);
  }
  let blocks = group.filter((block) => bounds.has(block));
  for (;;) {
    const before = blocks.map((block, i) => {
      const earlier: number[] = [];
      for (let u = 0; u < i; u++) if (meet(blocks[u]!, block)) earlier.push(u);
      return earlier;
    });
    const n = blocks.length;
    const lo = blocks.map((block) => bounds.get(block)![0]);
    const hi = blocks.map((block) => bounds.get(block)![1]);
    // The highest top each block can take below those before it, and the
    // lowest above those after it: it fits where the one is above the other.
    const highest = new Float64Array(n);
    const lowest = Float64Array.from(blocks, ({ height }, i) => hi[i]! - height);
    for (let i = 0; i < n; i++) {
      let at = lo[i]!;
      for (const u of before[i]!) at = Math.max(at, highest[u]! + blocks[u]!.height);
      highest[i] = at;
    }
    for (let i = n - 1; i >= 0; i--)
      for (const u of before[i]!) lowest[u] = Math.min(lowest[u]!, lowest[i]! - blocks[u]!.height);
    let weakest = -1;
    for (let i = 0; i < n; i++) {
      if (highest[i]! <= lowest[i]! + EPSILON) continue;
      const block = blocks[i]!;
      const other = blocks[weakest];
      if (
        !other ||
        block.label.priority < other.label.priority ||
        (block.label.priority === other.label.priority && block.order > other.order)
      )
        weakest = i;
    }
    if (weakest < 0) {
      const pairs: number[] = [];
      before.forEach((earlier, v) => {
        for (const u of earlier) pairs.push(u, v);
      });
      const tops = separate(
        blocks.map(({ wanted }) => wanted),
        blocks.map(({ height }) => height),
        pairs,
        lo,
        hi,
      );
      blocks.forEach((block, i) => {
        block.top = tops[i]!;
      });
      return blocks;
    }
    blocks = blocks.filter((_, i) => i !== weakest);
  }
}
