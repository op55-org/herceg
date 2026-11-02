// A sunburst's sectors on a canvas: gaps between neighbors and between
// rings drawn as whole device pixels. SVG and PDF draw the same geometry
// as it is, continuous. Only sunbursts import this.

import type { ArcGeometry, Drawing } from "../scene/scene.ts";
import { arcDrawing } from "./arc.ts";
import { deviceGap } from "./device-pixels.ts";

/** A sunburst's sectors: which of their radii face a gap between rings, and how wide it is. */
export interface RingGeometry extends ArcGeometry {
  /** Per sector: `INNER_CUT` where its inner radius faces a gap, `OUTER_CUT` where its outer does. */
  cuts: Uint8Array;
  /** The gap between rings, in CSS pixels. */
  ringGap: number;
}

export const INNER_CUT = 1;
export const OUTER_CUT = 2;

/** Sectors whose gaps, between neighbors and between rings, are whole device pixels. */
export const ringDrawing: Drawing<ArcGeometry> = {
  ...arcDrawing,
  canvas(context, mark, options) {
    const { cuts, ringGap } = mark as RingGeometry;
    const { a, b } = context.getTransform();
    const ratio = Math.hypot(a, b);
    // Each radius facing a gap moves so the gap about its ring's edge is whole.
    const shift = (deviceGap(ringGap, ratio) / ratio - ringGap) / 2;
    const arcs = mark.arcs.slice();
    const rims = mark.rims?.slice();
    for (let i = 0; i < mark.count; i++) {
      if (cuts[i]! & INNER_CUT) arcs[i * 6 + 2]! += shift;
      if (cuts[i]! & OUTER_CUT) arcs[i * 6 + 3]! -= shift;
      if (rims) rims[i]! -= shift;
    }
    const gap = deviceGap(mark.gap, ratio) / ratio;
    (arcDrawing.canvas as Exclude<Drawing<ArcGeometry>["canvas"], false>)(
      context,
      { ...mark, arcs, rims, gap },
      options,
    );
  },
};
