// The order a panel paints in: its grid lines and its geometry, each at a
// `zIndex` (marks 0 and grid lines -1 by default), higher above lower. The
// order is local to a panel, as a CSS stacking context is, and apart from
// clipping (`clipOf`) and from logical order, which the keyboard,
// descriptions, and tooltips keep. Ties keep the order things are listed
// in: a panel's grid batches before its geometry at the same `zIndex`,
// batches among themselves as their axes are listed, and geometry as its
// marks are declared, then as each mark emits it. Picking takes the
// topmost of the targets the pointer is over. A plot's background stays
// under everything, its border, axes, and the pointer's overlays above.
// Renderers paint what `paintOrder` gives them in one plane: SVG-only
// drawings among canvas ones need canvas painters, or a renderer that
// keeps them in order.

import type { StrokePaint } from "../style/style.ts";

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

/** What a panel paints next: one of its grid batches, or one of its geometries, by index. */
export type PaintEntry =
  | { readonly kind: "grid"; readonly index: number }
  | { readonly kind: "geometry"; readonly index: number };

/**
 * The order to paint `grids` and `geometry` in, each with its `zIndex`
 * (see the module's rules): by `zIndex`, ties as listed, grids first.
 */
export function paintOrder(
  grids: readonly { readonly zIndex: number }[],
  geometry: readonly { readonly zIndex: number }[],
): PaintEntry[] {
  const entries: (PaintEntry & { zIndex: number })[] = [
    ...grids.map(({ zIndex }, index) => ({ kind: "grid" as const, index, zIndex })),
    ...geometry.map(({ zIndex }, index) => ({ kind: "geometry" as const, index, zIndex })),
  ];
  // Sorting is stable, so ties keep the order above.
  return entries.sort((a, b) => a.zIndex - b.zIndex).map(({ kind, index }) => ({ kind, index }));
}
