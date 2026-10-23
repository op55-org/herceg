// Blocks of text placed by a point: which of a block's sides, or its
// middle, goes there along its lines (`align`) and across them
// (`verticalAlign`), padded as its box is, then turned about the point. Tick
// labels inside the plot and labels attached to marks are placed so. This
// module imports only types: the guide and feature compilers, which load
// later, take it with them rather than the line chart's first chunk.

import type { Rect, TextItem } from "../scene/scene.ts";
import type { TextPaint } from "../style/style.ts";
import type { TextAt, TextLines } from "./text.ts";

/**
 * Where a block of text (its lines, and its box's padding when its paint
 * has a box) is placed: the point `x`, `y`; which of the block's sides or
 * its middle goes there along its lines (`align`) and across them
 * (`verticalAlign`); and its turn about that point, in degrees clockwise.
 */
export interface BlockAnchor {
  readonly x: number;
  readonly y: number;
  readonly align: "start" | "center" | "end";
  readonly verticalAlign: "top" | "middle" | "bottom";
  readonly angle: number;
}

/**
 * Where `lines` in `paint` are drawn for their block to be at `anchor`:
 * the first line's place, and the box behind them (before the turn, as
 * `TextItem.box` is) when the paint has one. Hand both to `textItem`, which
 * pads text only when it is given no box.
 */
export function anchorBlock(
  lines: TextLines,
  anchor: BlockAnchor,
  paint: TextPaint,
): { at: TextAt; box: Rect | undefined } {
  const [top, right, bottom, left] = paint.background ? paint.padding : [0, 0, 0, 0];
  const { align, verticalAlign, angle } = anchor;
  const height = lines.height + top + bottom;
  const blockTop = verticalAlign === "top" ? 0 : verticalAlign === "middle" ? -height / 2 : -height;
  const dx = align === "start" ? left : align === "end" ? -right : (left - right) / 2;
  // The first line's middle, moved from the point in the text's own turn.
  const dy = blockTop + top + paint.lineHeight / 2;
  const turn = (angle * Math.PI) / 180;
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const textAnchor: TextItem["anchor"] = align === "center" ? "middle" : align;
  const at: TextAt = {
    x: anchor.x + dx * cos - dy * sin,
    y: anchor.y + dx * sin + dy * cos,
    anchor: textAnchor,
    angle,
    baseline: "middle",
  };
  if (!paint.background) return { at, box: undefined };
  // The box, unturned about the first line's place, as `textBox` measures it.
  const start = at.x - lines.width * (align === "center" ? 0.5 : align === "end" ? 1 : 0);
  const box = {
    x: start - left,
    y: at.y - paint.lineHeight / 2 - top,
    width: lines.width + left + right,
    height,
  };
  return { at, box };
}
