import type { Panel } from "../../src/scene/scene.ts";

/** Where a panel's grid lines along `along` are: x for vertical lines, y for horizontal ones; none without them. */
export function gridAt(panel: Pick<Panel, "grids">, along: "x" | "y"): readonly number[] {
  return panel.grids.find((batch) => batch.along === along)?.at ?? [];
}
