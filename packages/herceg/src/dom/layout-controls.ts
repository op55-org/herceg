// Mounts the controls a layout mark's chart asks for (see controls.ts). The
// chart loads this module first, only when it draws such a mark, and it
// loads the one family's controls, so a map never downloads a 3D chart's.

import type { LayoutControls } from "../marks/layout-mark.ts";
import type { Bindings } from "../model/bindings.ts";
import type { ChartConfig } from "../model/model.ts";
import type { Controls, ControlsHost, ControlsModule } from "./controls.ts";

/** What a chart lends its controls, as it has them. */
export interface ChartParts
  extends Pick<
    ControlsHost,
    "chart" | "model" | "overlay" | "invalidate" | "normalize" | "select"
  > {
  /** The live region, which reads sentences aloud. */
  live: HTMLElement;
  /** The chart's legend, whose presses are its own. */
  legend: HTMLElement;
  /** Where the keyboard cursor is: its panel's key and its item's, "" for a panel with none. */
  cursor(): { panel: string; key: string } | undefined;
}

function load(kind: LayoutControls["kind"]): Promise<ControlsModule> {
  switch (kind) {
    case "orbit":
      return import("./orbit.ts");
    case "map":
      return import("./map-controls.ts");
    case "drill":
      return import("./drill.ts");
    case "drag":
      return import("./node-drag.ts");
    case "layout":
      return import("./layout-frames.ts");
  }
}

/** Loads the controls of `kind` and mounts them on the chart `parts` come from. */
export async function mountControls(
  kind: LayoutControls["kind"],
  parts: ChartParts,
): Promise<Controls> {
  // Bindings come with the interaction controller, which the chart loads too.
  const [{ Controls }, { Bindings }] = await Promise.all([load(kind), import("./interaction.ts")]);
  const { live, legend, cursor, ...shared } = parts;
  // Each panel's bindings, compiled again when the configuration changes.
  // Those it refuses are its controller's to report: here they bind nothing.
  let config: ChartConfig | undefined;
  const compiled = new Map<string | undefined, Bindings>();
  const bindings = (panel?: string) => {
    const { model } = parts;
    if (config !== model.config) compiled.clear();
    config = model.config;
    let bound = compiled.get(panel);
    if (!bound) {
      try {
        bound = new Bindings(model.interactionOf(panel));
      } catch {
        bound = new Bindings();
      }
      compiled.set(panel, bound);
    }
    return bound;
  };
  return new Controls({
    ...shared,
    bindings,
    announce(text) {
      live.textContent = text;
    },
    onPlot: (target) => !legend.contains(target as Node),
    focused: () => parts.chart.root.ownerDocument.activeElement === parts.chart.root,
    cursor: () => {
      const at = cursor();
      return at && { panel: at.panel, key: at.key || undefined };
    },
  });
}
