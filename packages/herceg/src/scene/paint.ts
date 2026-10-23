// The order a panel paints in: its grid lines and its geometry, each at a
// `zIndex` (marks 0 and grid lines -1 by default), higher above lower. The
// order is local to a panel, as a CSS stacking context is, and apart from
// clipping (`clipOf`) and from logical order, which the keyboard,
// descriptions, and tooltips keep. Ties keep the order things are listed
// in: a panel's grid batches before its geometry at the same `zIndex`,
// batches among themselves as their axes are listed, and geometry as its
// marks are declared, then as each mark emits it. Picking takes the
// topmost of the targets the pointer is over. Panels paint one after
// another, each its plot's background and then its plan, so a later
// panel's (an inset's over its parent) go over an earlier one's drawings;
// only the chart's background is under every panel, and plots' borders,
// axes, and the pointer's overlays are above them all.
// Renderers paint what the plan gives them (`Panel.paint`, from
// guides/paint.ts, which charts giving zIndex values load) in one plane:
// SVG-only drawings among canvas ones need canvas painters, or a renderer
// that keeps them in order.

import type { StrokePaint } from "../style/style.ts";
import type { Geometry, Panel } from "./scene.ts";

/** A panel's grid lines along one axis, painted together at their `zIndex`. */
export interface GridBatch {
  /** Its axis among the panel's ("x", "y", or an axis guide's id), the same from one scene to the next. */
  readonly key: string;
  readonly zIndex: number;
  /** Vertical lines at x positions ("x"), or horizontal ones at y positions ("y"), in CSS pixels. */
  readonly along: "x" | "y";
  readonly at: readonly number[];
  readonly paint: StrokePaint | undefined;
  /** With insets over the plot, the spans of each line their boxes leave clear. */
  readonly spans?: readonly (readonly (readonly [number, number])[])[] | undefined;
}

/**
 * Visits what `panel` paints, in order: its grid batches (`grid`) and
 * geometry (`geometry`), by its plan, or without one its grid batches first.
 */
export function eachPainted(
  { paint, grids, marks }: Panel,
  grid: (batch: GridBatch) => void,
  geometry: (mark: Geometry) => void,
): void {
  for (let i = 0; i < grids.length + marks.length; i++) {
    const at = paint ? paint[i]! : i;
    if (at < grids.length) grid(grids[at]!);
    else geometry(marks[at - grids.length]!);
  }
}
