// Contours of 1000 x 1000 grids, and a 2D histogram of a million points.

import { fromMatrix } from "../../src/data/matrix.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { contour } from "../../src/marks/contour.ts";
import { GridTracer } from "../../src/marks/contour-trace.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { ChartModel } from "../../src/model/model.ts";
import { measure, N, seeded } from "./shared.ts";

export async function run(): Promise<void> {
  const random = seeded(9);
  const normal = () => {
    const u = Math.max(random(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
  };
  // Contours of 1000 x 1000 grids: a smooth field, whose ten thresholds cross
  // few cells, and uniform noise, whose cells each cross six of the ten on
  // average, traced (lines; bands' rings), then a chart's scenes as its colors change
  // and as it zooms, which only project what was traced.
  const side = 1000;
  const gridXs = Float64Array.from({ length: side }, (_, i) => i);
  const fields = {
    smooth: Float64Array.from({ length: side * side }, (_, k) => {
      const [u, v] = [(k % side) / 150 - 3.33, Math.floor(k / side) / 150 - 3.33];
      return Math.exp(-(u * u + v * v)) + 0.3 * Math.sin(u * 2) * Math.cos(v * 3);
    }),
    noise: Float64Array.from({ length: side * side }, () => random()),
  };
  for (const [name, values] of Object.entries(fields)) {
    const tracer = new GridTracer({ xs: gridXs, ys: gridXs, values });
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
    const levels = Array.from({ length: 10 }, (_, k) => lo + ((k + 0.5) / 10) * (hi - lo));
    measure(
      `contour: lines of a ${name} 1000 x 1000 grid at 10 levels`,
      () => {
        for (const t of levels) tracer.lines(t);
      },
      { warmup: 1, samples: 5 },
    );
    measure(
      `contour: band rings of a ${name} 1000 x 1000 grid at 10 levels`,
      () => {
        for (const t of levels) tracer.rings(t);
      },
      { warmup: 1, samples: 5 },
    );
    const chart = new ChartModel({
      marks: [
        contour(fromMatrix({ x: gridXs, y: gridXs, v: values }, { x: "x", y: "y" }), {
          x: "x",
          y: "y",
          color: "v",
          thresholds: levels,
          variant: "bands",
        }),
      ],
    });
    chart.setSize(800, 600, 1);
    chart.scene(estimateText);
    let theme = 0;
    measure(
      `contour: scene of ${name} bands, colors changed`,
      () => {
        chart.update({ marks: chart.config.marks, theme: theme++ % 2 ? "dark" : "light" });
        chart.scene(estimateText);
      },
      { warmup: 1, samples: 5 },
    );
    let zoomed = 0;
    measure(
      `contour: scene of ${name} bands, zoomed`,
      () => {
        const half = 200 + (zoomed++ % 2) * 100;
        chart.applyViews(chart.viewChanges([500 - half, 500 + half]));
        chart.scene(estimateText);
      },
      { warmup: 1, samples: 5 },
    );
  }

  // A 2D histogram of a million points in 50 x 50 bins (steps of a fiftieth of
  // each axis' range, a hair wider so that rounding cannot leave the maximum
  // for a 51st): counted, and drawn, by a new chart each time.
  const pairsX = Float64Array.from({ length: N }, normal);
  const pairsY = Float64Array.from(pairsX, (x) => 0.5 * x + normal());
  const pairs = table({ x: pairsX, y: pairsY });
  const fiftieths = (values: Float64Array) => {
    let [lo, hi] = [Infinity, -Infinity];
    for (const v of values) [lo, hi] = [Math.min(lo, v), Math.max(hi, v)];
    return { step: ((hi - lo) / 50) * (1 + 1e-12), start: lo };
  };
  const pairBins = { x: fiftieths(pairsX), y: fiftieths(pairsY) };
  measure(
    "histogram 2d: count and draw 1,000,000 points in 50 x 50 bins",
    () => {
      const chart = new ChartModel({
        marks: [histogram(pairs, { x: "x", y: "y", bins: pairBins })],
      });
      chart.setSize(800, 600, 1);
      chart.scene(estimateText);
    },
    { warmup: 1, samples: 5 },
  );
}
