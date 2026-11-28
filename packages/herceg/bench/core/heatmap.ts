// A heatmap's scene after a change to its table: the cells and the image
// patched where the change touched them, or built again past an eighth.
// Patching loads on a heatmap's first change (marks/heatmap-updates.ts);
// until it has, a change builds both again. Each case reports the image's
// pixels painted per change.

import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { heatmapUpdates, heatmapWork } from "../../src/marks/heatmap-updates.ts";
import { ChartModel } from "../../src/model/model.ts";
import { seeded } from "./shared.ts";

const chartOf = (mark: ReturnType<typeof heatmap>, size: number) => {
  const chart = new ChartModel({ legend: false, marks: [mark] });
  chart.setSize(size, size, 1);
  chart.scene(estimateText);
  return chart;
};

const random = seeded(16);

/** A grid's rows in row order, `per` rows to a cell. */
const cellRows = (columns: number, rows: number, per = 1) => {
  const n = columns * rows * per;
  const cell = (i: number) => Math.floor(i / per);
  return {
    x: Float64Array.from({ length: n }, (_, i) => cell(i) % columns),
    y: Float64Array.from({ length: n }, (_, i) => Math.floor(cell(i) / columns)),
    v: Float64Array.from({ length: n }, () => random() * 100),
  };
};

const report = (name: string, times: number[], pixels: number) => {
  times.sort((a, b) => a - b);
  const median = times[times.length >> 1]!;
  const mad = times.map((t) => Math.abs(t - median)).sort((a, b) => a - b)[times.length >> 1]!;
  console.log(
    `${name.padEnd(48)} ${median.toFixed(3)} ms ± ${mad.toFixed(3)}; ` +
      `${Math.round(pixels / times.length).toLocaleString("en-US")} pixels painted`,
  );
};

/** Times `change` and the scene after it on `chart`. */
const patched = (
  name: string,
  chart: ChartModel,
  change: () => void,
  { warmup = 5, samples = 30 } = {},
) => {
  const step = () => {
    change();
    chart.scene(estimateText);
  };
  for (let i = 0; i < warmup; i++) step();
  const times: number[] = [];
  const pixels = heatmapWork.pixels;
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    step();
    times.push(performance.now() - start);
  }
  report(name, times, heatmapWork.pixels - pixels);
};

const fixed = { x: "x", y: "y", color: "v", colorDomain: [0, 100] } as const;

/**
 * A chart's first changes: before patching loads, each builds again; once
 * it has, a chart drawn before that builds the cells it keeps on its next
 * change. An earlier area's heatmaps may have loaded it, so these run only
 * in a process where none has.
 */
async function firstChanges() {
  const cells = table(cellRows(1024, 1024));
  const charts = Array.from({ length: 5 }, () => chartOf(heatmap(cells, fixed), 1200));
  const change = () => cells.replace(Math.floor(random() * cells.length), { v: [random() * 100] });
  // Synchronous, so the load the first starts cannot land in between.
  patched("heatmap: one cell of 1024², before patching loads", charts[0]!, change, {
    warmup: 2,
    samples: 10,
  });
  while (!heatmapUpdates()) await new Promise((resolve) => setTimeout(resolve, 0));
  const times: number[] = [];
  const pixels = heatmapWork.pixels;
  for (const chart of charts) {
    change();
    const start = performance.now();
    chart.scene(estimateText);
    times.push(performance.now() - start);
  }
  report("heatmap: its next change, once it has loaded", times, heatmapWork.pixels - pixels);
}

export async function run(): Promise<void> {
  if (heatmapUpdates())
    console.log("heatmap: first changes: patching has loaded; run --area heatmap");
  else await firstChanges();

  const one = table(cellRows(1024, 1024));
  patched(
    "heatmap: one cell of 1024² changed, fixed domain",
    chartOf(heatmap(one, fixed), 1200),
    () => one.replace(Math.floor(random() * one.length), { v: [random() * 100] }),
  );
  const scattered = table(cellRows(1024, 1024));
  patched(
    "heatmap: 1% of cells changed, scattered",
    chartOf(heatmap(scattered, fixed), 1200),
    () =>
      scattered.transaction(() => {
        for (let i = 0; i < 10_486; i++)
          scattered.replace(Math.floor(random() * scattered.length), { v: [random() * 100] });
      }),
    { warmup: 3, samples: 10 },
  );
  // Column by column, as a stream writes it.
  const streamed = table(
    {
      x: Float64Array.from({ length: 512 * 1024 }, (_, i) => Math.floor(i / 1024)),
      y: Float64Array.from({ length: 512 * 1024 }, (_, i) => i % 1024),
      v: Float64Array.from({ length: 512 * 1024 }, () => random() * 100),
    },
    { maxRows: 512 * 1024 },
  );
  const column = {
    x: new Float64Array(1024),
    y: Float64Array.from({ length: 1024 }, (_, i) => i),
    v: new Float64Array(1024),
  };
  let next = 512;
  patched(
    "heatmap: a column of 1,024 cells appended to a 512-column window",
    chartOf(heatmap(streamed, fixed), 1200),
    () => {
      column.x.fill(next++);
      for (let i = 0; i < 1024; i++) column.v[i] = random() * 100;
      streamed.append(column);
    },
  );
  const widened = table(cellRows(1024, 1024));
  let top = 100;
  patched(
    "heatmap: an automatic domain widened by one cell",
    chartOf(heatmap(widened, { x: "x", y: "y", color: "v" }), 1200),
    () => widened.replace(Math.floor(random() * widened.length), { v: [++top] }),
  );
  const crowded = table(cellRows(256, 256, 4));
  const arriving = { x: new Float64Array(256), y: new Float64Array(256), v: new Float64Array(256) };
  patched(
    "heatmap: rows appended into existing cells, mean",
    chartOf(heatmap(crowded, { ...fixed, reduce: "mean" }), 800),
    () => {
      for (let i = 0; i < 256; i++) {
        arriving.x[i] = Math.floor(random() * 256);
        arriving.y[i] = Math.floor(random() * 256);
        arriving.v[i] = random() * 100;
      }
      crowded.append(arriving);
    },
  );
  const hundreds = table(cellRows(100, 100, 100));
  patched(
    "heatmap: rows updated in cells of 100 rows",
    chartOf(heatmap(hundreds, { ...fixed, reduce: "mean" }), 800),
    () => {
      for (let i = 0; i < 10; i++)
        hundreds.replace(Math.floor(random() * hundreds.length), { v: [random() * 100] });
    },
  );
}
