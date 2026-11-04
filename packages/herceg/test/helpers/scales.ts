// What the last scene of a model drew in a panel, read through the
// model's panels and inspectors, as charts read them.

import type { Series } from "../../src/marks/series.ts";
import type { ChartModel } from "../../src/model/model.ts";
import type { PositionScale } from "../../src/scale/scale.ts";

/** The x scale of the last scene's first panel (the only one without facets). */
export function xScale(model: ChartModel): PositionScale | undefined {
  return model.panels()[0]?.x;
}

/** The y scale of the last scene's first panel. */
export function yScale(model: ChartModel): PositionScale | undefined {
  const first = model.panels()[0];
  return first && model.inspectorOf(first.key)?.frame.y;
}

/** The scale of the right y axis in the last scene's first panel, when marks use it. */
export function yRightScale(model: ChartModel): PositionScale | undefined {
  return model.panels()[0]?.yRight;
}

/** The series a panel of the last scene draws; with facets, the parts of series in it. */
export function panelSeries(model: ChartModel, panel: string): Series[] {
  return model.inspectorOf(panel)?.marks.flatMap(({ series }) => series) ?? [];
}
