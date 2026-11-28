// Channels: regions painted per row, channel scales, and the forms of a color channel.

import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { measure } from "./shared.ts";

export async function run(): Promise<void> {
  // Regions over a table painted per row (B8's Marimekko, at 10,000 cells):
  // fills through a scale of categories and opacities by identity, batched
  // into a geometry per run of rows of one look.
  const CELLS = 10_000;
  const cells = table({
    x1: Float64Array.from({ length: CELLS }, (_, i) => (i % 100) * 10),
    x2: Float64Array.from({ length: CELLS }, (_, i) => (i % 100) * 10 + 9),
    y1: Float64Array.from({ length: CELLS }, (_, i) => Math.floor(i / 100)),
    y2: Float64Array.from({ length: CELLS }, (_, i) => Math.floor(i / 100) + 0.9),
    segment: category(Array.from({ length: CELLS }, (_, i) => `s${(i * 7) % 6}`)),
    share: Float64Array.from({ length: CELLS }, (_, i) => ((i * 13) % 100) / 100),
  });
  measure(
    "region: 10,000 rows painted per row, scene",
    () => {
      const chart = new ChartModel(
        {
          scales: { segments: { type: "ordinal", domain: ["s0", "s1", "s2", "s3", "s4", "s5"] } },
          marks: [
            region(cells, {
              x1: "x1",
              x2: "x2",
              y1: "y1",
              y2: "y2",
              encode: {
                fill: { field: "segment", scale: "segments" },
                opacity: { field: "share", scale: { type: "identity" } },
              },
            }),
          ],
        },
        undefined,
        staticCompilers(),
      );
      chart.setSize(800, 600, 1);
      chart.scene(estimateText);
    },
    { warmup: 5, samples: 30 },
  );

  // Channel scales: 100,000 points sized and faded from number fields through
  // the chart's scales, against the same channels by identity.
  const SCALED = 100_000;
  const scaled = table({
    x: Float64Array.from({ length: SCALED }, (_, i) => (i * 7919) % 1000),
    y: Float64Array.from({ length: SCALED }, (_, i) => (i * 104_729) % 1000),
    v: Float64Array.from({ length: SCALED }, (_, i) => ((i * 31) % 1000) / 1000),
  });
  for (const through of ["identity", "a channel scale"] as const)
    measure(
      `channels: 100k points, opacity and size by ${through}, scene`,
      () => {
        const chart = new ChartModel(
          {
            scales: {
              fade: { type: "linear", range: [0.2, 1] },
              sizes: { type: "sqrt", range: [4, 64] },
            },
            marks: [
              point(scaled, {
                x: "x",
                y: "y",
                encode:
                  through === "identity"
                    ? {
                        opacity: { field: "v", scale: { type: "identity" } },
                        size: { field: "v", scale: { type: "identity" } },
                      }
                    : {
                        opacity: { field: "v", scale: "fade" },
                        size: { field: "v", scale: "sizes" },
                      },
              }),
            ],
          },
          undefined,
          staticCompilers(),
        );
        chart.setSize(800, 600, 1);
        chart.scene(estimateText);
      },
      { warmup: 3, samples: 20 },
    );

  // Channels' forms on 100,000 points' colors, compiled and drawn: one
  // condition with otherwise (the baseline), the same colors from a list of
  // a condition without otherwise and a constant, a list of three entries,
  // and a rank test (the 1,000 largest). Then a line of 100,000 rows colored
  // by a rank test, appending 100 rows a frame, against a condition: the
  // rank reads only the rows appended.
  const RED = "#c62828";
  const GREY = "#90a4ae";
  const AMBER = "#ff9800";
  const colorForms = {
    "a condition": {
      // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
      condition: { when: col("v").gt(0.99), then: RED, otherwise: GREY },
    },
    "a list of two": [
      // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
      { condition: { when: col("v").gt(0.99), then: RED } },
      { value: GREY },
    ],
    "a list of three": [
      // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
      { condition: { when: col("v").gt(0.99), then: RED } },
      // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
      { condition: { when: col("v").lt(0.01), then: AMBER } },
      { value: GREY },
    ],
    "a rank test": [
      // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
      { condition: { when: { top: 1000, field: "v" as const }, then: RED } },
      { value: GREY },
    ],
  } as const;
  for (const [form, color] of Object.entries(colorForms))
    measure(
      `channels: 100k points, color by ${form}, chart and scene`,
      () => {
        const chart = new ChartModel(
          { marks: [point(scaled, { x: "x", y: "y", color })] },
          undefined,
          staticCompilers(),
        );
        chart.setSize(800, 600, 1);
        chart.scene(estimateText);
      },
      { warmup: 3, samples: 20 },
    );
  for (const form of ["a condition", "a rank test"] as const) {
    const streamed = table({
      t: Float64Array.from({ length: SCALED }, (_, i) => i),
      v: Float64Array.from({ length: SCALED }, (_, i) => ((i * 31) % 1000) / 1000),
    });
    const chart = new ChartModel(
      { marks: [line(streamed, { x: "t", y: "v", encode: { color: colorForms[form] } })] },
      undefined,
      staticCompilers(),
    );
    chart.setSize(800, 600, 1);
    chart.scene(estimateText);
    let t = SCALED;
    const batch = { t: new Float64Array(100), v: new Float64Array(100) };
    measure(
      `channels: 100k-row line, color by ${form}, append 100 rows and scene`,
      () => {
        for (let i = 0; i < 100; i++) {
          batch.t[i] = t;
          batch.v[i] = ((t++ * 31) % 1000) / 1000;
        }
        streamed.append(batch);
        chart.scene(estimateText);
      },
      { warmup: 5, samples: 40 },
    );
  }
}
