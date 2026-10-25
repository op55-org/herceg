// Chart state as the Python package reads it (python/src/herceg/_events.py),
// beside the JSON forms of selections, views, and inspections, which the
// engine's web module shares with pages' DOM events.

import type {
  Chart,
  ChartOptions,
  DrillRoot,
  PanelTarget,
  Selection,
  SelectionOwner,
} from "herceg";
import type { VisibilityState } from "herceg/spec";
import { type SelectionPayload, selectionPayload } from "../../packages/herceg/src/web/events.ts";

export {
  chartSelection,
  chartViewport,
  edgePayload,
  type InspectionPayload,
  inspectionPayload,
  namesCategories,
  restoreViewportState,
  type SelectionPayload,
  selectionPayload,
  type ViewportEventPayload,
  type ViewportPayload,
  type ViewportStatePayload,
  viewportEventPayload,
  viewportPayload,
  viewportStatePayload,
} from "../../packages/herceg/src/web/events.ts";

/**
 * What a chart hides, with what its subplots' legends set only of the
 * subplots `panels` names (a chart's `visibilityState`): a chart still
 * restoring another's state has not let go of those it lacks yet (see
 * `restoreVisibility`), and a chart drawn in its place must not take them
 * back.
 */
export function ownPanels(state: VisibilityState, panels: readonly string[]): VisibilityState {
  if (!state.panels) return state;
  const own = Object.entries(state.panels).filter(([panel]) => panels.includes(panel));
  return { ...state, panels: Object.fromEntries(own) };
}

/**
 * A selection as Python reads it: naming its panels only where they are
 * not the chart's own, of instances every panel shares (a subplot's lasso,
 * or panels' own scales).
 */
export function selectionReport(
  selection: Selection | null,
  owner: SelectionOwner | null,
): SelectionPayload | null {
  const payload = selectionPayload(selection, owner);
  if (payload && !owner?.scales.some(({ instance }) => instance !== "")) delete payload.panels;
  return payload;
}

export interface DrillPayload {
  path: string[];
}

export type ItemPositionsPayload = Record<string, [number, number]>;

export function drillPayload(root: DrillRoot | undefined): DrillPayload | null {
  return root?.key == null ? null : { path: root.path.map(({ key }) => key) };
}

/**
 * The panel a state of a chart's layout marks belongs to, as a chart's
 * methods take it: none for "", the chart's one (or its facet panels' one).
 */
export function targetOf(panel: string): PanelTarget | undefined {
  return panel === "" ? undefined : { panel };
}

/**
 * The keys of the states the chart's marks of `types` have (see
 * `targetOf`): each subplot's of theirs, or the chart's one ("") without
 * subplots; none without such marks.
 */
export function statePanels(
  config: Pick<ChartOptions, "marks" | "panels">,
  types: readonly string[],
): string[] {
  const marks = config.marks.filter(({ spec }) => types.includes(spec.type));
  if (!config.panels) return marks.length > 0 ? [""] : [];
  return [...new Set(marks.map(({ spec }) => spec.panel!))];
}

/** Marks with drill roots, moved nodes, and views of planes of their own, by state. */
export const CAMERAS = ["point3d", "line3d", "surface"];
export const DRILLS = ["treemap", "sunburst"];
export const MOVES = ["graph"];
export const PLANES = ["geoshape", "geopoint", "graph"];

/** Restoring an old path falls back to its nearest surviving ancestor. */
export function showDrillRoot(
  chart: Chart,
  payload: DrillPayload | null,
  restore = false,
  panel = "",
) {
  const target = targetOf(panel);
  const root = chart.getDrillRoot(target);
  if (!root && !payload) return;
  const path = payload?.path ?? [];
  if (!restore) {
    chart.setDrillRoot(path.at(-1) ?? null, target);
    return;
  }
  if (!root) return;
  for (const key of [...path].reverse()) {
    try {
      chart.setDrillRoot(key, target);
      return;
    } catch (error) {
      if (!(error instanceof RangeError)) throw error;
    }
  }
  chart.setDrillRoot(null, target);
}

/** Records one engine delta in the accumulated manual positions. */
export function recordPosition(
  held: ItemPositionsPayload,
  key: string,
  position: { x: number; y: number } | null,
): void {
  if (position)
    Object.defineProperty(held, key, {
      value: [position.x, position.y],
      enumerable: true,
      configurable: true,
      writable: true,
    });
  else delete held[key];
}

/** Replaces overrides, recording only setters that succeeded, including on error. */
export function showItemPositions(
  chart: Chart,
  next: ItemPositionsPayload,
  held: ItemPositionsPayload,
  restore = false,
  panel = "",
) {
  const target = targetOf(panel);
  for (const key of Object.keys(held)) {
    if (Object.hasOwn(next, key)) continue;
    chart.setItemPosition(key, null, target);
    delete held[key];
  }
  for (const [key, [x, y]] of Object.entries(next)) {
    const before = held[key];
    if (before?.[0] === x && before[1] === y) continue;
    try {
      chart.setItemPosition(key, { x, y }, target);
      Object.defineProperty(held, key, {
        value: [x, y],
        enumerable: true,
        configurable: true,
        writable: true,
      });
    } catch (error) {
      if (!restore || !(error instanceof RangeError)) throw error;
    }
  }
}

export function positionsValue(positions: ItemPositionsPayload): string {
  return JSON.stringify(Object.entries(positions).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}
