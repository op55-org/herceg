// Views set on a model directly, as charts set them.

import type { ChartModel, ViewChange, ViewReport } from "../../src/model/model.ts";

/** Sets views on a model as `Chart.setViewport` does, without its event (see `ChartModel.viewChanges`). */
export function setViewport(model: ChartModel, view: ViewChange, panel?: string): void {
  model.applyViews(model.viewChanges(view, panel));
}

/**
 * A viewport event in brief: the panel it was made in, if any, and each
 * instance it changed, as its scale, its view, and its panels.
 */
export function brief({ panel, scales }: ViewReport) {
  return {
    ...(panel !== undefined && { panel }),
    scales: scales.map(({ scale, view, panels }) => [scale, view, panels]),
  };
}
