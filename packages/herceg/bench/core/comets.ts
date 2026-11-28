// Custom marks: A2's comets drawn, picked, and inspected.

import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { custom } from "../../src/marks/custom.ts";
import { placeAt, rowOf } from "../../src/marks/series.ts";
import { ChartModel } from "../../src/model/model.ts";
import { Picker } from "../../src/model/pick.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { cometPath, measure } from "./shared.ts";

export async function run(): Promise<void> {
  // Custom marks taking part through their items (the customisation study's
  // A2): 2,000 range comets, each a tapered tail and a dot drawn in its row's
  // item, colored, widened, and faded through the chart's scales. The scene
  // builds the shapes and records the items; picking and inspecting find the
  // item under the pointer by its shapes, through the shapes' grid index.
  const COMETS = 2000;
  const comet = (() => {
    let state = 2;
    const next = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 2 ** 32;
    };
    const x0 = new Float64Array(COMETS);
    const y0 = new Float64Array(COMETS);
    const x1 = new Float64Array(COMETS);
    const y1 = new Float64Array(COMETS);
    const confidence = new Float64Array(COMETS);
    const age = new Float64Array(COMETS);
    const kind: string[] = [];
    for (let i = 0; i < COMETS; i++) {
      x0[i] = next() * 100;
      y0[i] = next() * 100;
      const angle = next() * 2 * Math.PI;
      const length = 3 + next() * 9;
      x1[i] = x0[i]! + Math.cos(angle) * length;
      y1[i] = y0[i]! + Math.sin(angle) * length;
      confidence[i] = next();
      kind.push(["energy", "metals", "grains", "rates", "fx"][Math.floor(next() * 5)]!);
      age[i] = next() * 30;
    }
    return table({ x0, y0, x1, y1, confidence, age, kind: category(kind) });
  })();
  /** A comet from (sx, sy) to (ex, ey): a tail `w` pixels wide at its start, then a head 10 long. */
  const comets = (items: boolean) =>
    custom(comet, {
      x: ["x0", "x1"],
      y: ["y0", "y1"],
      series: "kind",
      encode: {
        color: { field: "kind", scale: "kinds" },
        strokeWidth: { field: "confidence", scale: "widths" },
        opacity: { field: "age", scale: "fade" },
      },
      draw({ series, x, y, item, path, circle, encoded }) {
        const [ax, ay, bx, by] = [
          comet.numbers("x0"),
          comet.numbers("y0"),
          comet.numbers("x1"),
          comet.numbers("y1"),
        ];
        for (const s of series)
          for (let k = 0; k < s.length; k++) {
            const row = s.rowAt(k);
            const [sx, sy] = [x(ax[row]!), y(ay[row]!)];
            const style = { fill: s.color, opacity: encoded("opacity", row) };
            const drawn = () => {
              path(
                cometPath(sx, sy, x(bx[row]!), y(by[row]!), encoded("strokeWidth", row) ?? 2),
                style,
              );
              circle(sx, sy, 3, style);
            };
            if (items) item(s, row, drawn);
            else drawn();
          }
      },
    });
  const cometChart = (items: boolean) => {
    const chart = new ChartModel(
      {
        x: { domain: [0, 100], nice: false },
        y: { domain: [0, 100], nice: false },
        scales: {
          kinds: { type: "ordinal", domain: ["energy", "metals", "grains", "rates", "fx"] },
          widths: { type: "linear", domain: [0, 1], range: [2, 7] },
          fade: { type: "linear", domain: [0, 30], range: [1, 0.35] },
        },
        marks: [comets(items)],
      },
      undefined,
      staticCompilers(),
    );
    chart.setSize(960, 640, 1);
    const picker = new Picker({ rowOf, placeAt });
    chart.picker = (px, py, accept) => picker.pick(chart, { x: px, y: py, slop: 4 }, accept);
    return chart;
  };
  for (const items of [false, true])
    measure(
      `custom: 2,000 comets through scales, scene${items ? ", as items" : ""}`,
      () => {
        cometChart(items).scene(estimateText);
      },
      { warmup: 5, samples: 30 },
    );
  const cometPlaces = Array.from(
    { length: 100 },
    (_, i) => [40 + ((i * 97) % 880), 31 + ((i * 61) % 580)] as const,
  );
  const pickedComets = cometChart(true);
  pickedComets.scene(estimateText);
  measure("custom: 2,000 comets, pick under 100 places", () => {
    for (const [px, py] of cometPlaces) pickedComets.picker!(px, py);
  });
  measure("custom: 2,000 comets, inspect under 100 places", () => {
    for (const [px, py] of cometPlaces) pickedComets.inspect(px, py);
  });
}
