// The drawn contract cases (test/fixtures/contracts.json), as each surface's
// parity tests build them: their spec with the fixture's table, and their
// marks made with the mark functions from the options the spec spells.

import { expect } from "vitest";
import { type Table, table } from "../../src/data/table.ts";
import { MountedChart } from "../../src/dom/chart.ts";
import type { Chart } from "../../src/dom/handle.ts";
import { chartFromSpec } from "../../src/from-spec.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import type { ChartMark } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { panels } from "../../src/model/panels.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import contracts from "../fixtures/contracts.json";

export interface DrawnCase {
  contract: string;
  name: string;
  spec: { marks: { type: string; [option: string]: unknown }[]; [option: string]: unknown };
}

/** The cases drawn as given: neither refused nor waiting for a stream. */
export function drawnCases(): DrawnCase[] {
  return (contracts.cases as (DrawnCase & { code?: string })[]).filter(
    ({ code }) => code === undefined,
  );
}

/** The case's spec with the fixture's table, as the engine loads it. */
export function fullSpec(spec: DrawnCase["spec"]): ChartSpec {
  return { data: { data: { columns: contracts.data } }, ...spec } as unknown as ChartSpec;
}

/** The fixture's table, as a TypeScript program makes it. */
export function fixtureTable(): Table {
  return table(contracts.data) as unknown as Table;
}

/**
 * The case's chart options as a TypeScript program writes them: as the
 * spec spells them, its subplots through `panels(list, layout)`, which
 * takes the spec's panels and layout as they are.
 */
export function chartOptions({ marks: _, panels: list, layout, ...options }: DrawnCase["spec"]) {
  if (list === undefined && layout === undefined) return options;
  return { ...options, panels: panels((list ?? []) as never, layout as never) };
}

/** The mark functions, by the mark type of the spec. */
const FACTORIES: Record<string, (data: Table, options: never) => ChartMark> = {
  bar: bar as never,
  line: line as never,
  point: point as never,
  point3d: point3d as never,
  region: region as never,
  rule: rule as never,
  text: text as never,
};

/** The case's marks made with the mark functions over `data`, the fixture's table. */
export function surfaceMarks(spec: DrawnCase["spec"], data = fixtureTable()): ChartMark[] {
  return spec.marks.map(({ type, ...options }) => {
    const make = FACTORIES[type];
    if (!make) throw new Error(`surfaceMarks: no mark function of "${type}" listed yet; add it`);
    return make(data, options as never);
  });
}

/** A chart in `element` made from the case's spec, `height` pixels high. */
export function specChart(element: HTMLElement, spec: DrawnCase["spec"], height: number): Chart {
  return chartFromSpec(element, fullSpec({ ...spec, height }));
}

/** Marks' specs as a chart holds them, apart from the names of their tables. */
export function markSpecs(marks: readonly unknown[]): object[] {
  return marks.map((mark) => {
    const { data: _, ...options } = (mark as { spec: { data?: unknown } }).spec;
    return options;
  });
}

/**
 * Expects two mounted charts of the same size, once their code has loaded,
 * to hold the same chart settings and marks of the same options (an option
 * one dropped would draw the same where it changes nothing visible) and to
 * draw the same SVG, whatever their ids.
 */
export async function sameDrawing(chart: Chart, reference: Chart): Promise<void> {
  await Promise.all([chart.loading, reference.loading]);
  const settings = (of: Chart) => {
    const { marks: _, ...options } = MountedChart.modelOf(of).config;
    return JSON.parse(JSON.stringify(options));
  };
  expect(settings(chart)).toEqual(settings(reference));
  const marks = (of: Chart) => markSpecs(MountedChart.modelOf(of).config.marks);
  expect(marks(chart)).toEqual(marks(reference));
  const drawn = (of: Chart) => of.toSVG().replace(/herceg-\d+/g, "herceg");
  expect(drawn(chart)).toBe(drawn(reference));
}
