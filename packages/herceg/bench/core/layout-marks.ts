// Layout marks and panels: small multiples of pies and treemaps, and annotations over facets.

import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { pie } from "../../src/marks/pie.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { facet } from "../../src/model/facet.ts";
import { ChartModel } from "../../src/model/model.ts";
import { measure } from "./shared.ts";

export async function run(): Promise<void> {
  // Small multiples of a layout mark: a pie of eight products per region, 50
  // regions over 100,000 rows, labeled, at 1600 x 1200. A first scene splits the
  // rows by panel and sums each panel's; a redraw reads what those kept.
  const PANELS = 50;
  const SALES_ROWS = 100_000;
  const sales = table({
    region: Array.from({ length: SALES_ROWS }, (_, i) => `region ${i % PANELS}`),
    product: Array.from({ length: SALES_ROWS }, (_, i) => `product ${(i * 7) % 8}`),
    revenue: Float64Array.from({ length: SALES_ROWS }, (_, i) => (i * 13) % 100),
  });
  const pies = () => {
    const model = new ChartModel({
      marks: [pie(sales, { category: "product", value: "revenue" })],
      facet: facet("region", { columns: 10 }),
    });
    model.setSize(1600, 1200, 1);
    return model;
  };
  measure("facets: first scene of 50 pies over 100k rows", () => pies().scene(estimateText), {
    warmup: 5,
    samples: 30,
  });
  const drawn = pies();
  drawn.scene(estimateText);
  measure("facets: redraw 50 pies over 100k rows", () => drawn.scene(estimateText), {
    warmup: 10,
    samples: 50,
  });
  measure(
    "facets: 50 pies over 100k rows after a row arrives",
    () => {
      sales.append({ region: ["region 3"], product: ["product 1"], revenue: [5] });
      drawn.scene(estimateText);
    },
    { warmup: 5, samples: 30 },
  );

  // The same pies unlabelled, and with a name beside each slice placed by its
  // box as drawn (decorations, model/decorations.ts): 400 names a scene.
  const sliceNames = table({
    region: Array.from({ length: PANELS * 8 }, (_, i) => `region ${i % PANELS}`),
    product: Array.from({ length: PANELS * 8 }, (_, i) => `product ${Math.floor(i / PANELS)}`),
  });
  const namedPies = (names: boolean) => {
    const model = new ChartModel({
      marks: [
        pie(sales, { id: "slices", category: "product", value: "revenue", labels: false }),
        ...(names
          ? [
              text(sliceNames, {
                from: { mark: "slices", item: [{ field: "product" }], at: "center" },
                label: { field: "product" },
              }),
            ]
          : []),
      ],
      facet: facet("region", { columns: 10 }),
    });
    model.setSize(1600, 1200, 1);
    model.scene(estimateText);
    return model;
  };
  for (const names of [false, true]) {
    const model = namedPies(names);
    measure(
      `facets: redraw 50 pies${names ? ", a name beside each slice" : ", unlabelled"}`,
      () => model.scene(estimateText),
      { warmup: 10, samples: 50 },
    );
  }

  // B8's Marimekko at scale: a treemap of 50 columns of 40 cells, alone or with
  // a name above each column and a rule at its left edge, placed by the columns.
  const marimekko = table({
    column: Array.from({ length: 2000 }, (_, i) => `column ${i % 50}`),
    cell: Array.from({ length: 2000 }, (_, i) => `cell ${Math.floor(i / 50)}`),
    value: Float64Array.from({ length: 2000 }, (_, i) => 1 + ((i * 7) % 13)),
  });
  const columnNames = table({ column: Array.from({ length: 50 }, (_, i) => `column ${i}`) });
  for (const decorated of [false, true]) {
    const model = new ChartModel({
      marks: [
        treemap(marimekko, {
          id: "cells",
          path: ["column", "cell"],
          value: "value",
          labels: false,
        }),
        ...(decorated
          ? [
              text(columnNames, {
                from: {
                  mark: "cells",
                  item: [{ field: "column" }],
                  at: "top-left",
                  offset: { y: -16 },
                },
                label: { field: "column" },
              }),
              rule(columnNames, { x: { item: { mark: "cells", item: [{ field: "column" }] } } }),
            ]
          : []),
      ],
      padding: { top: 28 },
      legend: false,
    });
    model.setSize(1600, 800, 1);
    model.scene(estimateText);
    measure(
      `treemap of 2,000 cells${decorated ? ", 50 names and rules by its columns" : ", alone"}`,
      () => model.scene(estimateText),
      { warmup: 10, samples: 50 },
    );
  }

  // A treemap per region of 100,000 distinct leaves, 2,000 to a panel: each
  // panel keeps the part of the tree its rows give a value, not all of it.
  const leaves = table({
    region: Array.from({ length: SALES_ROWS }, (_, i) => `region ${i % PANELS}`),
    leaf: Array.from({ length: SALES_ROWS }, (_, i) => `leaf ${i}`),
    revenue: Float64Array.from({ length: SALES_ROWS }, (_, i) => 1 + (i % 7)),
  });
  measure(
    "facets: first scene of 50 treemaps of 2,000 leaves each",
    () => {
      const model = new ChartModel({
        marks: [treemap(leaves, { path: ["leaf"], value: "revenue", labels: false })],
        facet: facet("region", { columns: 10 }),
        legend: false,
      });
      model.setSize(2000, 1200, 1);
      model.scene(estimateText);
    },
    { warmup: 2, samples: 10 },
  );

  // Annotations over a table split by facets: a rule, a region, and a label
  // per row, 100,000 rows over 50 regions (2,000 of each to a panel), with
  // labels left out where they would cover others. Each panel reads only its
  // own rows.
  const events = table({
    region: Array.from({ length: SALES_ROWS }, (_, i) => `region ${i % PANELS}`),
    t: Float64Array.from({ length: SALES_ROWS }, (_, i) => Math.floor(i / PANELS)),
    v: Float64Array.from({ length: SALES_ROWS }, (_, i) => (i * 13) % 100),
    end: Float64Array.from({ length: SALES_ROWS }, (_, i) => Math.floor(i / PANELS) + 0.5),
    note: Array.from({ length: SALES_ROWS }, (_, i) => `event ${i % 97}`),
  });
  const annotated = () => {
    const model = new ChartModel({
      marks: [
        rule(events, { x: "t" }),
        region(events, { x1: "t", x2: "end" }),
        text(events, { x: "t", y: "v", label: { field: "note", overlap: "hide" } }),
      ],
      facet: facet("region", { columns: 10 }),
    });
    model.setSize(2000, 1200, 1);
    return model;
  };
  measure(
    "facets: first scene of 50 panels of annotations over 100k rows",
    () => annotated().scene(estimateText),
    { warmup: 2, samples: 10 },
  );
  const notes = annotated();
  notes.scene(estimateText);
  measure(
    "facets: redraw 50 panels of annotations over 100k rows",
    () => notes.scene(estimateText),
    {
      warmup: 3,
      samples: 20,
    },
  );
}
