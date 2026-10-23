// Grid lines as every renderer strokes them: on pixel centers (device
// pixels on a canvas), across the plot or along the spans insets leave.

import type { StrokePaint } from "../style/style.ts";
import type { GridBatch } from "./paint.ts";
import type { Rect } from "./scene.ts";

/**
 * Where a batch of grid lines is drawn: x1, y1, x2, y2 per segment, across
 * `plot` or along each line's spans, on the centers of pixels `ratio` to a
 * CSS pixel, so 1-pixel lines are crisp.
 */
export function gridLines({ along, at, spans }: GridBatch, plot: Rect, ratio = 1): number[] {
  const snap = (value: number) => (Math.round(value * ratio) + 0.5) / ratio;
  const across: [number, number] =
    along === "x" ? [plot.y, plot.y + plot.height] : [plot.x, plot.x + plot.width];
  const coords: number[] = [];
  at.forEach((value, i) => {
    const line = snap(value);
    for (const [from, to] of spans?.[i] ?? [across])
      if (along === "x") coords.push(line, from, line, to);
      else coords.push(from, line, to, line);
  });
  return coords;
}

/** What tells strokes apart: two strokes with one key look alike. */
export function strokeKey({ stroke, strokeWidth, dash, opacity }: StrokePaint): string {
  return `${stroke} ${strokeWidth} ${dash} ${opacity}`;
}
