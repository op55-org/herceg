// A treemap's rectangles on a canvas, rounded to device pixels: neighbors
// meet on one pixel boundary at each gap, and gaps are whole device pixels.
// SVG and PDF draw the same geometry as it is, continuous. Only treemaps
// import this.

import { CUT_BOTTOM, CUT_LEFT, CUT_RIGHT, CUT_TOP } from "../layout/treemap.ts";
import type { Drawing, RectGeometry } from "../scene/scene.ts";
import { deviceGap } from "./device-pixels.ts";
import { rectDrawing } from "./rect.ts";

/** A treemap's rectangles: which sides of each face a gap, where its middle is, and how wide gaps are. */
export interface TileGeometry extends RectGeometry {
  /** Per rectangle, the sides facing a gap (layout/treemap.ts, `CUT_TOP` and the rest). */
  cuts: Uint8Array;
  /**
   * The middles of the gaps each node's sides face, four per node clockwise
   * from the top, as the layout wrote them: one number for both neighbors.
   */
  middles: Float64Array;
  /** Per rectangle, its node, which `middles` is read at. */
  nodes: Uint32Array;
  /** The gaps' width, in CSS pixels. */
  gap: number;
  /**
   * Per rectangle, where a selected share splits its node from the rest
   * (`SPLIT_LEFT`, `SPLIT_RIGHT`): one number for both parts.
   */
  splits?: Float64Array | undefined;
}

/** In `cuts`: the side at the split (see `TileGeometry.splits`), which meets the other part. */
export const SPLIT_RIGHT = 16;
export const SPLIT_LEFT = 32;

/**
 * Rectangles whose sides facing a gap are placed from the gap's middle,
 * the one number the layout gave both neighbors, rounded to device pixels
 * so they meet it alike, the gap split about it in whole device pixels;
 * other sides round where they are.
 */
export const tileDrawing: Drawing<RectGeometry> = {
  ...rectDrawing,
  canvas(context, mark) {
    const { cuts, middles, nodes, gap, rects, splits } = mark as TileGeometry;
    // Device pixels from the context's own transform: the chart's scale and any offset.
    const { a: sx, d: sy, e: ox, f: oy } = context.getTransform();
    const span = (scale: number, offset: number) => {
      const wide = deviceGap(gap, scale);
      const before = Math.floor(wide / 2);
      const after = wide - before;
      const device = (at: number) => Math.round(at * scale + offset);
      return {
        // A side facing a gap at `middle`, or where it is (`at`).
        start: (at: number, middle: number | undefined) =>
          ((middle === undefined ? device(at) : device(middle) + after) - offset) / scale,
        end: (at: number, middle: number | undefined) =>
          ((middle === undefined ? device(at) : device(middle) - before) - offset) / scale,
        at: (at: number) => (device(at) - offset) / scale,
      };
    };
    const across = span(sx, ox);
    const down = span(sy, oy);
    context.beginPath();
    for (let i = 0; i < mark.count; i++) {
      const [x, y, w, h] = [rects[i * 4]!, rects[i * 4 + 1]!, rects[i * 4 + 2]!, rects[i * 4 + 3]!];
      const cut = cuts[i]!;
      const at = nodes[i]! * 4;
      const x0 =
        cut & SPLIT_LEFT
          ? across.at(splits![i]!)
          : across.start(x, cut & CUT_LEFT ? middles[at + 3] : undefined);
      const x1 =
        cut & SPLIT_RIGHT
          ? across.at(splits![i]!)
          : across.end(x + w, cut & CUT_RIGHT ? middles[at + 1] : undefined);
      const y0 = down.start(y, cut & CUT_TOP ? middles[at] : undefined);
      const y1 = down.end(y + h, cut & CUT_BOTTOM ? middles[at + 2] : undefined);
      if (x1 > x0 && y1 > y0) context.rect(x0, y0, x1 - x0, y1 - y0);
    }
    context.globalAlpha = mark.fillOpacity;
    context.fillStyle = mark.fill;
    context.fill();
    context.globalAlpha = 1;
  },
};
