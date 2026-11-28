// Bar scenes: 2,000 horizontal bars on a category y and on ranks, and a sparse bar overview.

import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { type BarMark, bar } from "../../src/marks/bar.ts";
import { ChartModel } from "../../src/model/model.ts";
import { overviewBars } from "../../src/model/navigator-bars.ts";
import { LinearScale } from "../../src/scale/scale.ts";
import { measure, N } from "./shared.ts";

export async function run(): Promise<void> {
  // A chart's scene of 2,000 horizontal bars: on a category y, and standing on
  // a number y (ranks) with orient "y", whose bands come from the ranks' spacing.
  const brands = table({
    brand: Array.from({ length: 2000 }, (_, i) => `brand ${i}`),
    rank: Float64Array.from({ length: 2000 }, (_, i) => (i * 7) % 2000),
    value: Float64Array.from({ length: 2000 }, (_, i) => 1 + ((i * 13) % 97)),
  });
  for (const ranked of [false, true]) {
    const model = new ChartModel({
      marks: [
        ranked
          ? bar(brands, { x: "value", y: "rank", orient: "y" })
          : bar(brands, { x: "value", y: "brand" }),
      ],
    });
    model.setSize(800, 1600, 1);
    model.scene(estimateText);
    measure(
      `scene of 2,000 bars along y${ranked ? ", on a rank y" : ", on a category y"}`,
      () => model.scene(estimateText),
      { warmup: 10, samples: 50 },
    );
  }

  // Rebuild only the bar overview at fixed scales, with warmed reusable
  // buffers. This isolates the exact fallback on a mostly missing source.
  const sparseBars = bar(
    table({
      t: Float64Array.from({ length: N }, (_, i) => i),
      v: Float64Array.from({ length: N }, (_, i) => (i < 20 ? 1 : Number.NaN)),
    }),
    { x: "t", y: "v" },
  ) as BarMark;
  let barDrawing: Parameters<BarMark["geometry"]> | undefined;
  const barGeometry = sparseBars.geometry.bind(sparseBars);
  sparseBars.geometry = (...args) => {
    barDrawing = args;
    return barGeometry(...args);
  };
  const sparseModel = new ChartModel({ marks: [sparseBars] });
  sparseModel.setSize(600, 300, 1);
  sparseModel.scene(estimateText);
  sparseBars.geometry = barGeometry;
  const [barSeries, sourceFrame] = barDrawing!;
  const barFrame = {
    ...sourceFrame,
    x: new LinearScale([0, N], [20, 620]),
    y: new LinearScale([0, 2], [42, 8]),
    plot: { x: 20, y: 5, width: 600, height: 40 },
    theme: {
      ...sourceFrame.theme,
      style: { ...sourceFrame.theme.style, bar: { radius: 0 } },
    },
    keyed: false,
  };
  measure("bar geometry: 1M rows, 20 usable, 600 px", () =>
    sparseBars.geometry(barSeries, barFrame),
  );
  measure("bar overview exact: 1M rows, 20 usable, 600 px", () =>
    overviewBars(sparseBars, barSeries, barFrame, 0),
  );
}
