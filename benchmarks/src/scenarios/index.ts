// The chart suite's scenario catalog: one file per area, listed here in the
// order the catalog has always had. A new scenario goes in its area's file
// (or a new area's file listed here); `id`s stay unique across areas.

import { DASHBOARD_SCENARIOS } from "./dashboard.ts";
import { INIT_SCENARIOS } from "./init.ts";
import { INTERACTION_SCENARIOS } from "./interaction.ts";
import { MEMORY_SCENARIOS } from "./memory.ts";
import { STREAM_SCENARIOS } from "./stream.ts";
import { SUSTAINED_SCENARIOS } from "./sustained.ts";
import { THREE_D_SCENARIOS } from "./three-d.ts";
import type { Scenario } from "./types.ts";
import { UPDATE_SCENARIOS } from "./update.ts";

export type { ChartType, Operation, Scenario } from "./types.ts";

export const SCENARIOS: Scenario[] = [
  ...INIT_SCENARIOS,
  ...UPDATE_SCENARIOS,
  ...STREAM_SCENARIOS,
  ...INTERACTION_SCENARIOS,
  ...DASHBOARD_SCENARIOS,
  ...MEMORY_SCENARIOS,
  ...THREE_D_SCENARIOS,
  ...SUSTAINED_SCENARIOS,
];

export function scenario(id: string): Scenario {
  const found = SCENARIOS.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}
