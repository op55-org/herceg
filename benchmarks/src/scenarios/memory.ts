// Memory retained by mounted charts.

import type { Scenario } from "./types.ts";

export const MEMORY_SCENARIOS: Scenario[] = [
  {
    id: "memory-line-large",
    chart: "line",
    operation: "memory",
    series: 1,
    points: 1_000_000,
    large: true,
    tooltip: true,
    samples: 3,
    warmup: 0,
    description: "1 chart, 1,000,000 points",
  },
  {
    id: "memory-dashboard",
    chart: "line",
    operation: "memory",
    series: 15,
    points: 3_000,
    charts: 10,
    large: false,
    tooltip: true,
    samples: 3,
    warmup: 0,
    description: "10 charts x 15 series x 3,000 points",
  },
  {
    id: "memory-small-100",
    chart: "line",
    operation: "memory",
    series: 2,
    points: 100,
    charts: 100,
    large: false,
    tooltip: true,
    samples: 3,
    warmup: 0,
    description: "100 charts x 2 series x 100 points",
  },
];
