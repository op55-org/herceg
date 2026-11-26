// Text placed by its first line's alphabetic baseline: "baseline" in the
// style of a mark's label (`LabelStyle`). Its first line's box reaches half
// a line and half the font's x-height above the baseline, as renderers draw
// a line placed by its middle, and its box, its room, and its moves are
// its block's, as for blocks placed by their sides (layout/block.ts). The
// feature compiler hands it to the marks whose labels ask for it
// (`MarkFeatures.baseline`), so charts without them load none of it.

import type { PartText } from "../marks/features/part-text.ts";
import type { PlacedLabel } from "../marks/labels.ts";
import type { Frame } from "../marks/mark.ts";
import type { Rect } from "../scene/scene.ts";
import type { TextPaint } from "../style/style.ts";
import { anchorBlock, type BlockAnchor } from "./block.ts";
import type { MeasuringContext, TextAt, TextLines } from "./text.ts";

/** An "x" in `paint` as `context`'s fonts measure it. */
export function measureX(context: MeasuringContext, paint: TextPaint) {
  if (context.font !== paint.css) context.font = paint.css;
  return context.measureText("x");
}

/** Labels in one paint placed by their first line's baseline. */
export interface Baseline {
  /**
   * How far above a label's first baseline its block's top (its box's,
   * where it has one) is: its padding, and half a line and half the font's
   * x-height, or its parts' first row's baseline below their top.
   */
  top(parts: PartText | undefined): number;
  /**
   * Where `lines` are drawn for their first baseline to be at `anchor`'s
   * point, from its `align` side or middle, and the box behind them, as
   * `anchorBlock` places blocks by their sides (unturned).
   */
  block(
    lines: TextLines,
    anchor: Pick<BlockAnchor, "x" | "y" | "align">,
    parts: PartText | undefined,
  ): { at: TextAt; box: Rect | undefined };
  /**
   * A text mark's label placed by its first line's middle, drawn from its
   * baseline; one of parts, in its box, as it is.
   */
  drawn(label: PlacedLabel): PlacedLabel;
}

/**
 * Labels in `paint` placed by their first line's baseline, the font's
 * x-height read once, as the frame's measuring context measures an "x"
 * (without one, as with built-in estimates, 0.52 em); undefined unless
 * there is a paint and it places them so.
 */
export function baseline(
  paint: TextPaint | undefined,
  { measure: { context } }: Pick<Frame, "measure">,
): Baseline | undefined {
  if (paint?.verticalAlign !== "baseline") return undefined;
  const { lineHeight } = paint;
  const x = (context && measureX(context, paint).actualBoundingBoxAscent) || 0.52 * paint.size;
  // How far below its top a line's baseline is.
  const line = (lineHeight + x) / 2;
  const padding = paint.background ? paint.padding[0] : 0;
  // Drawn from its first line's baseline, `above` below the line's top, not from its middle.
  const fromBaseline = <T extends Pick<TextAt, "y" | "baseline">>(at: T, above: number): T => ({
    ...at,
    y: at.y + above - lineHeight / 2,
    baseline: "alphabetic",
    above,
  });
  const top = (parts: PartText | undefined) => padding + (parts?.baseline ?? line);
  return {
    top,
    block(lines, anchor, parts) {
      // Placed as the block whose top is that far above the point.
      const above = top(parts);
      const { at, box } = anchorBlock(
        lines,
        { ...anchor, y: anchor.y - above, verticalAlign: "top", angle: 0 },
        paint,
      );
      return { at: fromBaseline(at, above - padding), box };
    },
    drawn: (label) => (label.parts ? label : fromBaseline(label, line)),
  };
}
