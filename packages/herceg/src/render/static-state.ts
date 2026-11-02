// The state options of static exports: applied with state support, as a
// mounted chart's first state, and refused without it, as a chart refuses
// them.

import type { ChartConfig, ChartModel } from "../model/model.ts";
import type { Scene } from "../scene/scene.ts";
import { needsState, STATE_OPTIONS } from "../spec/state.ts";
import type { ChartStateSupport } from "../state/chart-state.ts";

/** Options of a static export, with the state support its state options need. */
export type StatefulConfig = ChartConfig & {
  /** State support (`chartState`, from herceg/state), which the state options need. */
  state?: ChartStateSupport | undefined;
};

/** The scene `draw` draws of `model`, the static export of `options`, in their state. */
export function drawInState(model: ChartModel, options: StatefulConfig, draw: () => Scene): Scene {
  if (options.state) return options.state.exported(model, options, draw);
  const name = STATE_OPTIONS.find((key) => options[key] !== undefined);
  if (name) throw needsState(name);
  return draw();
}
