// A subplot's interaction settings, as the chart, its input gate, its
// controller, and spec validation read them alike. Apart from bindings.ts,
// which only the controller needs, so charts load it with the controller.

import type { InteractionSpec, PanelInteractionSpec } from "../spec/spec.ts";

/**
 * A subplot's interaction settings: its own (`PanelSpec.interaction`) over
 * the chart's, one by one (its `bindings` replace the chart's list), but
 * its limits per scale.
 */
export function panelInteraction(
  chart: InteractionSpec | undefined,
  own: PanelInteractionSpec | undefined,
): InteractionSpec | undefined {
  if (!own) return chart;
  const limits = own.limits && { limits: { ...chart?.limits, ...own.limits } };
  return { ...chart, ...own, ...limits };
}
