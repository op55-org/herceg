// Labels attached to another mark's series (marks/attachments.ts): placed
// as blocks beside the point they follow, or outside the plot in the side
// tracks the chart keeps for marks' labels (`Frame.outside`, `Mark.room`).
// Inside, `align` says which way the block goes from its point: "start"
// after it (to the right), "end" before it, "center" over it, where
// `verticalAlign` puts it below ("top"), above ("bottom"), or on it; it
// stands `GAP` and its offset away, and within the plot: a block that
// would cross its left or right edge, into an axis' tick labels or a
// neighboring panel, moves along its row until it is inside, over its
// series (its halo keeps it legible there), and one wider than the plot
// has its lines shortened with an ellipsis to fit (left out when nothing
// but the ellipsis would). Outside, labels before their series ("end") go
// in the left track, others in the right one, at their point's height,
// their offset further from the plot. Labels whose extents along x meet
// (in one side's track, or inside) are kept apart along y within the plot,
// in the order of their points, and others share rows; a label that would
// not fit below those it meets, packed from the plot's top, is left out.
// Extents are as painted: halos and boxes' outlines too. The feature
// compiler places labels with it, and hands it the chart's code it uses
// (`AttachedKit`), so the line chart's first chunk does not load it.

import type { textItemMarkup } from "../draw/text.ts";
import { labelsDrawingOf } from "../draw/text-items.ts";
import type { Attachment } from "../marks/attachments.ts";
import type { Frame } from "../marks/mark.ts";
import type { Drawing, LabelsGeometry, Rect, TextItem } from "../scene/scene.ts";
import type { ResolvedHalo, TextPaint } from "../style/style.ts";
import type { surface } from "../theme.ts";
import { anchorBlock } from "./block.ts";
import type { fitText, TextLines, textItem, textLines } from "./text.ts";

/** The chart's code labels are placed and drawn with (see model/guides.ts `GUIDE_KIT`). */
export interface AttachedKit {
  readonly fitText: typeof fitText;
  readonly textLines: typeof textLines;
  readonly textItem: typeof textItem;
  readonly textItemMarkup: typeof textItemMarkup;
  readonly surface: typeof surface;
}

/** How placed labels draw, with the chart's markup of text items (made once). */
let drawing: Drawing<LabelsGeometry> | undefined;

/** Pixels between a label inside the plot and its point. */
const GAP = 4;

/** A label C's marks attach to a series, its content resolved, as `placeAttached` places it. */
export interface AttachedLabel {
  /** Stable within its mark: the source series' key and where the label follows it. */
  readonly key: string;
  readonly at: Attachment;
  readonly text: string;
  /** Its resolved style: `align` and `verticalAlign` anchor its block (see the module). */
  readonly paint: TextPaint;
  readonly place: {
    readonly outside?: boolean | undefined;
    /** Whether outside labels keep room in their track; true by default. */
    readonly reserve?: boolean | undefined;
    readonly offset?: number | undefined;
  };
  readonly halo: ResolvedHalo | undefined;
}

/**
 * The geometry of `labels` placed in `frame` (one batch, keyed `key`) and
 * the room the outside ones that reserve it take in the left and right
 * tracks, in pixels. Labels of hidden series are left out.
 */
export function placeAttached(
  labels: readonly AttachedLabel[],
  frame: Frame,
  key: string,
  { fitText, textLines, textItem, textItemMarkup, surface }: AttachedKit,
): { geometry: LabelsGeometry[]; room: readonly [left: number, right: number] } {
  const { plot, measure } = frame;
  // Each label's block, unturned.
  const blocks: Block[] = [];
  for (const label of labels) {
    if (!label.at.visible) continue;
    const { paint, place, at, halo } = label;
    const [top, right, bottom, left] = paint.background ? paint.padding : [0, 0, 0, 0];
    // How far painting reaches past the block: a halo half its width around
    // the glyphs, less a box's padding, or a box's outline half its width.
    const box = paint.background;
    const pastOutline = box?.stroke ? (box.strokeWidth ?? 1) / 2 : 0;
    const pastHalo = halo ? Math.max(0, halo.width / 2 - Math.min(top, right, bottom, left)) : 0;
    const reach = Math.max(pastHalo, pastOutline);
    let text = label.text;
    let lines = textLines(text, paint, measure);
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
      if (lines.width > room) {
        const fitted = lines.lines.map((line) => fitText(line, room, measure, paint.css));
        if (fitted.some((line, k) => line === "…" && line !== lines.lines[k])) continue;
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
      text,
      lines,
      x,
      top: y - lift,
      lift,
      height: block + 2 * reach,
      extent: [from, from + width],
      room: keeps,
    });
  }
  const items: TextItem[] = [];
  const room: [number, number] = [0, 0];
  const under = frame.surface ?? surface(frame.theme);
  for (const { label, text, lines, x, top, lift, room: taken } of spread(blocks, plot)) {
    if (taken) room[taken[0]] = Math.max(room[taken[0]], taken[1]);
    const { paint, halo } = label;
    const { at, box } = anchorBlock(
      lines,
      {
        x,
        y: top + lift,
        align: paint.align ?? "start",
        verticalAlign: paint.verticalAlign ?? "middle",
        angle: 0,
      },
      paint,
    );
    const item = textItem(text, at, paint, under, measure, box);
    items.push(halo ? { ...item, halo } : item);
  }
  if (items.length === 0) return { geometry: [], room };
  drawing ??= labelsDrawingOf(textItemMarkup);
  return { geometry: [{ kind: "labels", draw: drawing, key, items }], room };
}

/**
 * A label's block as painted: its text (shortened to fit) and lines, its
 * anchor's x, its top, how far its anchor is below that, its height, its
 * extent along x, and the room it keeps in a side's track (0 left, 1
 * right) outside the plot.
 */
interface Block {
  readonly label: AttachedLabel;
  readonly text: string;
  readonly lines: TextLines;
  readonly x: number;
  top: number;
  readonly lift: number;
  readonly height: number;
  readonly extent: readonly [number, number];
  readonly room: readonly [side: 0 | 1, size: number] | undefined;
}

/**
 * The blocks that fit in the plot's height, in the order of their points,
 * moved apart along y where their extents along x meet, and into the plot.
 * Earlier blocks come first: a block is left out only when it cannot fit
 * below the earlier blocks kept that it meets, and each is placed as near
 * its own top as the blocks before it, and room for those after it, allow.
 * Blocks already apart stay where they are; tops move continuously with
 * the points while the same blocks meet, in the same order, and fit,
 * though one that comes to meet another, or passes one it meets, can move
 * those after it.
 */
function spread(blocks: Block[], plot: Rect): Block[] {
  const meet = (a: Block, b: Block) => a.extent[0] < b.extent[1] && b.extent[0] < a.extent[1];
  const bottom = plot.y + plot.height;
  blocks.sort((a, b) => a.label.at.y - b.label.at.y);
  // Which fit: each packed from the top, below the earlier ones kept that it meets.
  const kept: Block[] = [];
  const earliest: number[] = [];
  for (const block of blocks) {
    let top = plot.y;
    for (let j = 0; j < kept.length; j++)
      if (meet(kept[j]!, block)) top = Math.max(top, earliest[j]! + kept[j]!.height);
    if (top + block.height > bottom) continue;
    kept.push(block);
    earliest.push(top);
  }
  // How low each can go, leaving room above the bottom for the later ones it meets.
  const latest = new Array<number>(kept.length);
  for (let i = kept.length - 1; i >= 0; i--) {
    let top = bottom - kept[i]!.height;
    for (let j = i + 1; j < kept.length; j++)
      if (meet(kept[i]!, kept[j]!)) top = Math.min(top, latest[j]! - kept[i]!.height);
    latest[i] = top;
  }
  // Each as near its own top as below the earlier ones it meets, and that room, allow.
  for (let i = 0; i < kept.length; i++) {
    const block = kept[i]!;
    let floor = plot.y;
    for (let j = 0; j < i; j++)
      if (meet(kept[j]!, block)) floor = Math.max(floor, kept[j]!.top + kept[j]!.height);
    block.top = Math.max(floor, Math.min(block.top, latest[i]!));
  }
  return kept;
}
