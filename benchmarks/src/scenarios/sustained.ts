// Sustained runs: a minute of streaming or pointer movement with the display
// refresh on, recording every frame's interval and how long each tick or
// move took to show, so the distribution shows stalls a five-second run
// would miss.

import type { Scenario } from "./types.ts";

export const SUSTAINED_SCENARIOS: Scenario[] = [
  {
    id: "ingest-chart-60hz-60s",
    chart: "line",
    operation: "ingest",
    series: 15,
    points: 3_000,
    append: 1,
    rateHz: 60,
    durationMs: 60_000,
    large: false,
    tooltip: true,
    samples: 1,
    warmup: 0,
    description: "15 series, 3,000-point window, +1 point at 60 Hz for 60 s",
  },
  {
    id: "hover-trace-line-medium-60s",
    chart: "line",
    operation: "trace",
    series: 10,
    points: 5_000,
    durationMs: 60_000,
    large: false,
    tooltip: true,
    samples: 1,
    warmup: 1,
    description: "pointer moves every 8 ms over 10 x 5,000 points for 60 s",
  },
];
