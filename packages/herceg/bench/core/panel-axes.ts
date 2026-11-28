// Two axes per panel: facets of two lines, both on the left axis, or one on
// each with the right axis' scale shared by every panel or each panel's own.
// Its own area so that it runs after the labels, as it always has.

import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { facet } from "../../src/model/facet.ts";
import { ChartModel } from "../../src/model/model.ts";
import { measure } from "./shared.ts";

export async function run(): Promise<void> {
  // The annotated events of layout-marks.ts: 100,000 rows over 50 regions.
  const PANELS = 50;
  const ROWS = 100_000;
  const events = table({
    region: Array.from({ length: ROWS }, (_, i) => `region ${i % PANELS}`),
    t: Float64Array.from({ length: ROWS }, (_, i) => Math.floor(i / PANELS)),
    v: Float64Array.from({ length: ROWS }, (_, i) => (i * 13) % 100),
    end: Float64Array.from({ length: ROWS }, (_, i) => Math.floor(i / PANELS) + 0.5),
  });

  for (const side of ["left only", "shared", "independent"] as const) {
    const right = side !== "left only";
    const model = new ChartModel({
      marks: [
        line(events, { x: "t", y: "v" }),
        line(events, { x: "t", y: "end", ...(right && { axis: "right" as const }) }),
      ],
      facet: facet("region", { columns: 10 }),
      ...(right && { resolve: { yRight: side } }),
    });
    model.setSize(2000, 1200, 1);
    measure(`facets: 50 panels of two lines over 100k rows, ${side}`, () =>
      model.scene(estimateText),
    );
  }
}
