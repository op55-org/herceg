// Dashboards of several charts mounted and refreshed together.

import type { Scenario } from "./types.ts";

export const DASHBOARD_SCENARIOS: Scenario[] = [
  // Dashboard: 10 charts x 15 series x 3,000 points = 450,000 points
  {
    id: "dashboard",
    chart: "line",
    operation: "dashboard",
    series: 15,
    points: 3_000,
    charts: 10,
    large: false,
    tooltip: true,
    samples: 5,
    warmup: 1,
    description: "10 charts x 15 series x 3,000 points",
  },
];
