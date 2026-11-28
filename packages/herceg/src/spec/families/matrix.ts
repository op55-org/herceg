// Matrices: heatmaps and contours of values over a plane, and dendrograms (the
// trees beside a clustered heatmap).

import { ContourMark } from "../../marks/contour.ts";
import { DendrogramMark } from "../../marks/dendrogram.ts";
import { HeatmapMark } from "../../marks/heatmap.ts";
import { type AllMarks, withScheme } from "../load-with.ts";

export const MATRIX: Pick<AllMarks, "heatmap" | "contour" | "dendrogram"> = {
  heatmap: (spec, table, view) => new HeatmapMark(withScheme(spec), table(), view),
  contour: (spec, table) => new ContourMark(withScheme(spec), table()),
  dendrogram: (spec, table) => new DendrogramMark(spec, table()),
};
