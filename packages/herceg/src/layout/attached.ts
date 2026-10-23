// Labels attached to another mark's series (marks/attachments.ts): placed
// as blocks beside the point they follow, or outside the plot in the side
// tracks the chart keeps for marks' labels (`Frame.outside`, `Mark.room`).
// Inside, `align` says which way the block goes from its point: "start"
// after it (to the right), "end" before it, "center" over it, where
// `verticalAlign` puts it below ("top"), above ("bottom"), or on it; it
// stands `GAP` and its offset away. Outside, labels before their series
// ("end") go in the left track, others in the right one, at their point's
// height, their offset further from the plot. Labels in one column (one
// side's track, or one x and alignment inside) are spread apart along y
// within the plot, in the order of their points, as painted, halos too; a
// column taller than the plot keeps the labels that fit from its top and
// leaves the others out. The marks that make attachments load this
// module; the line chart's first chunk does not.

import { labelsDrawing } from "../draw/text.ts";
import type { Attachment } from "../marks/attachments.ts";
import type { Frame } from "../marks/mark.ts";
import type { LabelsGeometry, Rect, TextItem } from "../scene/scene.ts";
import type { ResolvedHalo, TextPaint } from "../style/style.ts";
import { surface } from "../theme.ts";
import { anchorBlock } from "./block.ts";
import { type TextLines, textItem, textLines } from "./text.ts";

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
): { geometry: LabelsGeometry[]; room: readonly [left: number, right: number] } {
  const { plot, measure } = frame;
  // Each label's block, unturned, by column.
  const columns = new Map<string, Block[]>();
  for (const label of labels) {
    if (!label.at.visible) continue;
    const { paint, place, at, halo } = label;
    const lines = textLines(label.text, paint, measure);
    const [top, right, bottom, left] = paint.background ? paint.padding : [0, 0, 0, 0];
    // How far a halo reaches past the block: half its width around the glyphs, less a box's padding.
    const reach = halo ? Math.max(0, halo.width / 2 - Math.min(top, right, bottom, left)) : 0;
    const offset = place.offset ?? 0;
    const align = paint.align ?? "start";
    const verticalAlign = paint.verticalAlign ?? "middle";
    let x = at.x;
    let y = at.y;
    let column: string;
    let keeps: Block["room"];
    if (place.outside) {
      const side = align === "end" ? 0 : 1;
      const edges = frame.outside ?? [plot.x - GAP, plot.x + plot.width + GAP];
      x = side ? edges[1] + offset : edges[0] - offset;
      if (place.reserve !== false)
        keeps = [side, Math.ceil(lines.width + left + right + reach + offset)];
      column = `outside ${side}`;
    } else {
      const away = GAP + offset;
      if (align === "start") x += away;
      else if (align === "end") x -= away;
      else if (verticalAlign === "top") y += away;
      else if (verticalAlign === "bottom") y -= away;
      column = `${Math.round(x)} ${align}`;
    }
    const block = lines.height + top + bottom;
    // Where the painted top is when the anchor is at `y`.
    const lift =
      reach + (verticalAlign === "top" ? 0 : verticalAlign === "middle" ? block / 2 : block);
    const blocks = columns.get(column) ?? [];
    columns.set(column, blocks);
    blocks.push({ label, lines, x, top: y - lift, lift, height: block + 2 * reach, room: keeps });
  }
  const items: TextItem[] = [];
  const room: [number, number] = [0, 0];
  const under = frame.surface ?? surface(frame.theme);
  for (const blocks of columns.values()) {
    for (const { label, lines, x, top, lift, room: taken } of spread(blocks, plot)) {
      if (taken) room[taken[0]] = Math.max(room[taken[0]], taken[1]);
      const { paint, halo, text } = label;
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
  }
  const geometry: LabelsGeometry[] =
    items.length > 0 ? [{ kind: "labels", draw: labelsDrawing, key, items }] : [];
  return { geometry, room };
}

/**
 * A label's block in its column as painted: its lines, its anchor's x, its
 * top, how far its anchor is below that, its height, and the room it keeps
 * in a side's track (0 left, 1 right) outside the plot.
 */
interface Block {
  readonly label: AttachedLabel;
  readonly lines: TextLines;
  readonly x: number;
  top: number;
  readonly lift: number;
  readonly height: number;
  readonly room: readonly [side: 0 | 1, size: number] | undefined;
}

/**
 * The blocks of one column that fit in the plot's height, in the order of
 * their points, moved apart along y and into the plot: each below the one
 * before it where they would meet, then the column back up from the
 * plot's bottom.
 */
function spread(blocks: Block[], plot: Rect): Block[] {
  blocks.sort((a, b) => a.label.at.y - b.label.at.y);
  let fit = 0;
  for (let height = 0; fit < blocks.length; fit++) {
    height += blocks[fit]!.height;
    if (height > plot.height) break;
  }
  const kept = blocks.slice(0, fit);
  let floor = plot.y;
  for (const block of kept) {
    block.top = Math.max(block.top, floor);
    floor = block.top + block.height;
  }
  floor = plot.y + plot.height;
  for (let k = kept.length - 1; k >= 0; k--) {
    const block = kept[k]!;
    if (block.top + block.height <= floor) break;
    block.top = floor - block.height;
    floor = block.top;
  }
  return kept;
}
