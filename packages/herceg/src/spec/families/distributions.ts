// Distributions: histograms (of one field, or of two as a grid of counts),
// box plots, letter-value (boxen) plots, and violins.

import { BoxenMark } from "../../marks/boxen.ts";
import { BoxPlotMark } from "../../marks/boxplot.ts";
import { HistogramMark } from "../../marks/histogram.ts";
import { Histogram2DMark } from "../../marks/histogram2d.ts";
import { ViolinMark } from "../../marks/violin.ts";
import { type AllMarks, withScheme } from "../load-with.ts";
import type { Histogram1DSpec, Histogram2DSpec } from "../spec.ts";

export const DISTRIBUTIONS: Pick<AllMarks, "histogram" | "boxplot" | "boxen" | "violin"> = {
  histogram: (spec, table, view) =>
    spec.x !== undefined && spec.y !== undefined
      ? new Histogram2DMark(withScheme(spec as Histogram2DSpec), table(), view)
      : new HistogramMark(spec as Histogram1DSpec, table(), view),
  boxplot: (spec, table, view) => new BoxPlotMark(spec, table(), view),
  boxen: (spec, table, view) => new BoxenMark(spec, table(), view),
  violin: (spec, table, view) => new ViolinMark(spec, table(), view),
};
