// Microbenchmarks for engine hot paths, run in Node:
//   npm run bench:core                         # every area, in this order
//   npm run bench:core -- --area lines,picking # some areas
// Each area is a file of its own exporting `run()`; a new case goes in its
// area's file, a new area in a file listed here. Reports the median and
// median absolute deviation over repeated runs. An area run alone starts
// with a colder process than in the full run, so compare figures only
// between runs of the same areas. A case's figures also depend on what ran
// before it, so new areas go at the end and the order stays.

import { parseArgs } from "node:util";

const AREAS = [
  "bars",
  "lines",
  "tables",
  "stacks",
  "views",
  "feed",
  "inspect",
  "axes",
  "layout-marks",
  "labels",
  "panel-axes",
  "navigation",
  "swarm",
  "density",
  "selection",
  "lineage",
  "comets",
  "picking",
  "custom",
  "channels",
  "formats",
  "grid",
  "totals",
  "transitions",
];

const { values } = parseArgs({ options: { area: { type: "string" } } });
const chosen = values.area ? values.area.split(",") : AREAS;
for (const area of chosen)
  if (!AREAS.includes(area))
    throw new Error(`bench:core: --area: no area ${area}; use some of ${AREAS.join(", ")}`);
for (const area of AREAS.filter((name) => chosen.includes(name))) {
  const { run } = (await import(`./${area}.ts`)) as { run: () => Promise<void> };
  await run();
}
