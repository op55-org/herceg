// Layouts: marks that place their items themselves, off the axes: pies,
// funnels, gauges, radars, treemaps, sunbursts, and Sankey diagrams.

import { FunnelMark } from "../../marks/funnel.ts";
import { GaugeMark } from "../../marks/gauge.ts";
import { PieMark } from "../../marks/pie.ts";
import { RadarMark } from "../../marks/radar.ts";
import { SankeyMark } from "../../marks/sankey.ts";
import { SunburstMark } from "../../marks/sunburst.ts";
import { TreemapMark } from "../../marks/treemap.ts";
import type { AllMarks } from "../load-with.ts";

export const LAYOUTS: Pick<
  AllMarks,
  "pie" | "funnel" | "gauge" | "radar" | "treemap" | "sunburst" | "sankey"
> = {
  pie: (spec, table) => new PieMark(spec, table()),
  funnel: (spec, table) => new FunnelMark(spec, table()),
  gauge: (spec, table) => new GaugeMark(spec, table()),
  radar: (spec, table) => new RadarMark(spec, table()),
  treemap: (spec, table) => new TreemapMark(spec, table()),
  sunburst: (spec, table) => new SunburstMark(spec, table()),
  sankey: (spec, table) => new SankeyMark(spec, table()),
};
