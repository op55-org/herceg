// The state options of static exports (SVG, images, PDF, snapshots),
// applied as a mounted chart's first state.

import type { ChartConfig, ChartModel } from "../model/model.ts";
import type { Scene } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import { eachPanel, type ViewState } from "../spec/state.ts";

/**
 * The scene `draw` draws of `model`, the static export of `options`, with
 * the state options among them applied: hidden keys before the first
 * draw, then views (maps' and networks' to their planes) and drill roots
 * after one. A static export refuses a selection: it draws no brush.
 */
export function drawInState(model: ChartModel, options: ChartConfig, draw: () => Scene): Scene {
  const { selection, viewport, visibility, drillRoot, panels } = options;
  // Brushes draw on the page, and looks load: neither is drawn here.
  if (selection)
    throw new ChartError({
      code: "unsupported",
      path: "selection",
      message: "selection: a static export draws no selection; leave it out",
    });
  if (visibility) {
    // Keys of a legend group's series stand for the group (see `HiddenKeys.has`).
    const { hidden } = model;
    for (const key of visibility.hidden) hidden.add(key);
    if (visibility.panels) {
      if (!panels)
        throw new ChartError({
          code: "unsupported",
          path: "visibility.panels",
          message: "visibility panels: the chart has no subplots; drop panels",
        });
      hidden.panels = panels.own(visibility.panels, hidden.panels);
    }
  }
  // Drawn once first, for the legend groups, panels, and trees the state names.
  if (!viewport && !visibility && drillRoot === undefined) return draw();
  draw();
  for (const [panel, view] of eachPanel(viewport)) {
    const { x = null, y = null, yRight = null } = (view ?? {}) as ViewState;
    // A map's or network's plane keeps a view of its own, as a chart's does.
    if (model.items?.ownsView(panel)) model.items.setView({ x, y }, panel);
    else model.applyViews(model.viewChanges({ x, y, yRight }, panel));
  }
  for (const [panel, node] of eachPanel(drillRoot)) {
    if (!model.items) throw new Error("drillRoot: the chart has no tree to drill");
    model.items.setDrillRoot(node as string | readonly string[] | null, panel);
  }
  return draw();
}
