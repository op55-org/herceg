// Turns a portable chart specification into a chart configuration, with
// every mark and feature of the format at hand, so that loading is
// synchronous: `herceg/spec`, static exports, and Python's engines load
// specs so. herceg/web loads only what a spec names (web/families.ts).

import { lineage } from "../model/lineage-kit.ts";
import { rangeNavigator } from "../model/navigator.ts";
import { timeBreaks } from "../scale/breaks.ts";
import { DISTRIBUTIONS } from "./families/distributions.ts";
import { LAYOUTS } from "./families/layouts.ts";
import { MAPS } from "./families/maps.ts";
import { MATRIX } from "./families/matrix.ts";
import { NETWORKS } from "./families/networks.ts";
import { SERIES } from "./families/series.ts";
import { SHAPES } from "./families/shapes.ts";
import { THREE_D } from "./families/three-d.ts";
import * as panels from "./features/panels.ts";
import * as selection from "./features/selection.ts";
import * as tables from "./features/tables.ts";
import {
  type AllMarks,
  type LoadedSpec,
  type LoadKit,
  type LoadOptions,
  loadWith,
  type SpecBuffer,
} from "./load-with.ts";
import type { ChartSpec } from "./spec.ts";

export type { LoadedSpec, LoadOptions, SpecBuffer };

const MARKS: AllMarks = {
  ...SERIES,
  ...SHAPES,
  ...DISTRIBUTIONS,
  ...MATRIX,
  ...LAYOUTS,
  ...NETWORKS,
  ...MAPS,
  ...THREE_D,
};

const ALL: LoadKit = {
  marks: MARKS,
  tables,
  selection,
  lineage,
  panels,
  navigator: rangeNavigator,
  breaks: timeBreaks,
};

/**
 * Builds tables and marks from a chart specification. Binary columns read
 * `buffers` (their `buffer` field is an index into it) without copying when
 * the bytes are aligned for their type. Errors name the offending table,
 * column, or mark. For a spec of unknown shape, such as parsed JSON, check
 * it with `validateSpec` first.
 */
export function loadSpec(
  spec: ChartSpec,
  buffers: readonly SpecBuffer[] = [],
  options: LoadOptions = {},
): LoadedSpec {
  return loadWith(ALL, spec, buffers, options);
}
