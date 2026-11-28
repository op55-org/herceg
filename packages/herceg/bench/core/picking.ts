// Picking, the keyboard's cursor, and candles drawn as they stream.

import { orderedTable } from "../../src/data/ordered.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxen } from "../../src/marks/boxen.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { custom } from "../../src/marks/custom.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { rug } from "../../src/marks/rug.ts";
import { placeAt, rowOf } from "../../src/marks/series.ts";
import { violin } from "../../src/marks/violin.ts";
import {
  inspectPosition,
  itemAt,
  keyedItem,
  keyedPoint,
  orderAt,
  standing,
} from "../../src/model/keyboard.ts";
import { ChartModel } from "../../src/model/model.ts";
import { earliest } from "../../src/model/nearest.ts";
import { Picker } from "../../src/model/pick.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { measure, N } from "./shared.ts";

export async function run(): Promise<void> {
  // Picking (model/pick.ts): the nearest stroke or point within reach, down
  // to the first fill the point is inside, so every geometry within reach
  // above that fill is tested, not only the first. Each case picks under 100
  // places of the plot, a click's or a hover's worth of queries.
  const pickPlaces = (plot: { x: number; y: number; width: number; height: number }) =>
    Array.from(
      { length: 100 },
      (_, i) =>
        [
          plot.x + ((i * 97) % 1000) * (plot.width / 1000),
          plot.y + ((i * 61) % 1000) * (plot.height / 1000),
        ] as const,
    );
  const picking = (
    marks: ConstructorParameters<typeof ChartModel>[0]["marks"],
    y?: [number, number],
  ) => {
    const chart = new ChartModel(
      {
        locale: "en-US",
        timeZone: "UTC",
        legend: false,
        ...(y && { y: { domain: y, nice: false } }),
        marks,
      },
      undefined,
      staticCompilers(),
    );
    chart.setSize(960, 400, 1);
    const picker = new Picker({ rowOf, placeAt });
    chart.picker = (px, py, accept) => picker.pick(chart, { x: px, y: py, slop: 4 }, accept);
    chart.scene(estimateText);
    return chart;
  };
  const pickUnder = (chart: ChartModel) => {
    const places = pickPlaces(chart.scene(estimateText).panels[0]!.plot);
    return () => {
      for (const [px, py] of places) chart.picker!(px, py);
    };
  };
  // A1's crowd: 12 lines of 2,160 minutes, 6 ms apart around 200 ms.
  const PICK_CROWD = 2160;
  const pickNames = Array.from({ length: 12 }, (_, k) => `s${k}`);
  const pickCrowdColumns = (order: (i: number) => number) =>
    table({
      t: Float64Array.from({ length: PICK_CROWD }, (_, i) => order(i) * 60_000),
      ...Object.fromEntries(
        pickNames.map((name, k) => [
          name,
          Float64Array.from(
            { length: PICK_CROWD },
            (_, i) => 200 + 6 * k + 10 * Math.sin(order(i) / 90 + k),
          ),
        ]),
      ),
    });
  const pickCrowd = pickCrowdColumns((i) => i);
  const pickCrowdChart = () => picking([line(pickCrowd, { x: "t", y: pickNames as never })]);
  measure("pick: 12 lines × 2,160, under 100 places", pickUnder(pickCrowdChart()));
  // The same lines picked at 100 places where two of them cross, inside both
  // strokes (2 px wide, the lines within 1.2 px): picking goes on below the
  // first line found for one whose centre line is nearer.
  const pickCrossings = (chart: ChartModel) => {
    chart.scene(estimateText);
    const { frame } = chart.drawnMarks()[0]!;
    const found: (readonly [number, number])[] = [];
    for (let i = 0; i < PICK_CROWD; i++) {
      const ys = pickNames.map((name) => frame!.y.map(pickCrowd.numbers(name as never)[i]!));
      let [a, b] = [0, 1];
      for (let j = 0; j < ys.length; j++)
        for (let k = j + 1; k < ys.length; k++)
          if (Math.abs(ys[j]! - ys[k]!) < Math.abs(ys[a]! - ys[b]!)) [a, b] = [j, k];
      if (Math.abs(ys[a]! - ys[b]!) < 1.2)
        found.push([frame!.x.map(i * 60_000), ys[a]! + (ys[b]! - ys[a]!) / 3]);
    }
    const places = Array.from(
      { length: 100 },
      (_, i) => found[Math.floor((i * found.length) / 100)]!,
    );
    return () => {
      for (const [px, py] of places) chart.picker!(px, py);
    };
  };
  measure("pick: 12 lines × 2,160, at 100 crossings", pickCrossings(pickCrowdChart()));
  // The same lines unordered along x (a shuffled table), traced as listed.
  const pickShuffled = pickCrowdColumns((i) => (i * 1201) % PICK_CROWD);
  measure(
    "pick: 12 unordered lines × 2,160, under 100 places",
    pickUnder(picking([line(pickShuffled, { x: "t", y: pickNames as never })])),
  );
  // The keyboard's Up and Down (model/keyboard.ts) over the same crowd: where
  // the cursor stands, its run's order there (as a run's first press takes
  // it, the costliest), then what the press reads: the next series' point
  // alone and the inspection there. Each case presses at 100 places of s0.
  const upDown = (chart: ChartModel) => {
    const readers = { placeAt, rowOf, earliest };
    const { key: panel } = chart.panels()[0]!;
    const { key } = chart.series()[0]!;
    const positions = Array.from({ length: 100 }, (_, i) => (i * 97) % PICK_CROWD);
    return () => {
      for (const position of positions) {
        const stood = standing(chart, panel, key, position, readers)!;
        const order = orderAt(chart, panel, stood.axis, stood.place, stood.height, readers);
        const to = order[(order.findIndex((visit) => visit.key === key) + 1) % order.length]!;
        keyedPoint(chart, to.key, to.position, panel, readers);
        inspectPosition(chart, to.key, to.position, panel, readers);
      }
    };
  };
  measure("keyboard: Up or Down over 12 lines × 2,160, at 100 places", upDown(pickCrowdChart()));
  measure(
    "keyboard: Up or Down over 12 unordered lines × 2,160, at 100 places",
    upDown(picking([line(pickShuffled, { x: "t", y: pickNames as never })])),
  );
  // What each scene does for a keyboard cursor at rest (the controller's
  // `draw`): finds what it is on again, wherever data changes moved it, and
  // where it stands, or finds it gone. The cursor came to the row at the
  // middle of a series (a heatmap's cell) before the change.
  const resting = (chart: ChartModel, change: (position: number) => void, length: number) => {
    const readers = { placeAt, rowOf };
    const { key: panel } = chart.panels()[0]!;
    const { key } = chart.series()[0]!;
    const position = length / 2;
    const item = keyedItem(chart, panel, key, position, readers)!;
    change(position);
    chart.scene(estimateText);
    return () => {
      const now = itemAt(chart, panel, key, position, item, readers);
      if (now >= 0) standing(chart, panel, key, now, readers);
    };
  };
  // A 1M-row stream that has dropped its first 1,000 rows (a heatmap's grid,
  // its first row of cells).
  const restingLine = table({
    t: Float64Array.from({ length: N }, (_, i) => i),
    v: Float64Array.from({ length: N }, (_, i) => Math.sin(i / 1000)),
  });
  measure(
    "keyboard: a scene's cursor at rest, 1M-row line",
    resting(picking([line(restingLine, { x: "t", y: "v" })]), () => restingLine.dropFirst(1000), N),
    { repeat: 100 },
  );
  const restingCells = table({
    x: Float64Array.from({ length: N }, (_, i) => i % 1000),
    y: Float64Array.from({ length: N }, (_, i) => Math.floor(i / 1000)),
    v: Float64Array.from({ length: N }, (_, i) => i % 97),
  });
  measure(
    "keyboard: a scene's cursor at rest, 1M-row heatmap",
    resting(
      picking([heatmap(restingCells, { x: "x", y: "y", color: "v" })]),
      () => restingCells.dropFirst(1000),
      N,
    ),
    { repeat: 100 },
  );
  // An ordered 10M-row stream that a row joined at its end, the cursor's row
  // where it was; and a 10M-row table split in two series, the cursor's row
  // moved to the other (gone).
  const M = 10_000_000;
  const restingOrdered = orderedTable(
    { t: Float64Array.from({ length: M }, (_, i) => i), v: new Float64Array(M) },
    { orderBy: "t" },
  );
  measure(
    "keyboard: a scene's cursor at rest, ordered 10M-row line",
    resting(
      picking([line(restingOrdered, { x: "t", y: "v" })]),
      () => restingOrdered.append({ t: [M], v: [0] }),
      M,
    ),
    { repeat: 100 },
  );
  // An ordered 10M-row stream of one time throughout: a row of that time
  // joins at the end, the cursor's row where it was; then its first row
  // leaves, the cursor's row one place back.
  const restingTies = orderedTable(
    { t: new Float64Array(M), v: new Float64Array(M) },
    { orderBy: "t" },
  );
  measure(
    "keyboard: a scene's cursor at rest, ordered 10M rows of one time",
    resting(
      picking([line(restingTies, { x: "t", y: "v" })]),
      () => restingTies.append({ t: [0], v: [0] }),
      M,
    ),
    { repeat: 100 },
  );
  measure(
    "keyboard: a scene's cursor one row back, ordered 10M rows of one time",
    resting(picking([line(restingTies, { x: "t", y: "v" })]), () => restingTies.dropFirst(1), M),
    { repeat: 100 },
  );
  const restingSplit = table({
    t: Float64Array.from({ length: M }, (_, i) => i >> 1),
    v: new Float64Array(M),
    s: Array.from({ length: M }, (_, i) => (i % 2 ? "b" : "a")),
  });
  measure(
    "keyboard: a scene's cursor whose row left its series, 10M rows",
    resting(
      picking([line(restingSplit, { x: "t", y: "v", series: "s" })]),
      (position) => restingSplit.replace(2 * position, { s: ["b"] }),
      M / 2,
    ),
    { repeat: 100 },
  );
  // Overlapping fills: 50 translucent regions over each other under the crowd,
  // and 50 bars over it, which cover what is under them.
  const pickSpans = table({
    from: Float64Array.from({ length: 50 }, (_, i) => (i * 1500 * 60_000) / 50),
    to: Float64Array.from({ length: 50 }, (_, i) => ((i * 1500 + 40_000) * 60_000) / 50),
  });
  measure(
    "pick: 50 regions under 12 lines, under 100 places",
    pickUnder(
      picking([
        region(pickSpans, { x1: "from", x2: "to" }),
        line(pickCrowd, { x: "t", y: pickNames as never }),
      ]),
    ),
  );
  const pickBars = table({
    c: Array.from({ length: 50 }, (_, i) => `c${i}`),
    v: Float64Array.from({ length: 50 }, (_, i) => 100 + ((i * 37) % 50)),
  });
  const pickLines = table({
    c: Array.from({ length: 50 }, (_, i) => `c${i}`),
    ...Object.fromEntries(
      pickNames.map((name, k) => [
        name,
        Float64Array.from({ length: 50 }, (_, i) => 50 + 6 * k + (i % 7)),
      ]),
    ),
  });
  measure(
    "pick: 50 bars over 12 lines, under 100 places",
    pickUnder(
      picking(
        [line(pickLines, { x: "c", y: pickNames as never }), bar(pickBars, { x: "c", y: "v" })],
        [0, 200],
      ),
    ),
  );
  // Dense custom shapes: 20,000 filled squares, a few pixels each, as items.
  const PICK_DENSE = 20_000;
  const pickDenseRows = table({
    x: Float64Array.from({ length: PICK_DENSE }, (_, i) => (i * 7919) % 1000),
    y: Float64Array.from({ length: PICK_DENSE }, (_, i) => (i * 104_729) % 1000),
  });
  type PickDense = typeof pickDenseRows extends Table<infer S> ? S : never;
  const pickDenseShapes = custom<PickDense>(pickDenseRows, {
    x: "x",
    y: "y",
    draw({ series, x, y, item, rect }) {
      for (const s of series)
        for (let k = 0; k < s.length; k++) {
          const row = s.rowAt(k);
          item(s, row, () => rect(x(s.x[row]!) - 2, y(s.y[row]!) - 2, 4, 4));
        }
    },
  });
  measure("pick: 20,000 custom squares, under 100 places", pickUnder(picking([pickDenseShapes])));
  // One case for each other family a hover listener picks in: points of
  // four marks, a stack's layers, a heatmap's cells, candles over a line,
  // box plots, and a pie's slices.
  const PICK_POINTS = 2500;
  const pickClouds = Array.from({ length: 4 }, (_, k) =>
    point(
      table({
        x: Float64Array.from({ length: PICK_POINTS }, (_, i) => ((i * 7919 + k * 13) % 1000) / 10),
        y: Float64Array.from(
          { length: PICK_POINTS },
          (_, i) => ((i * 104_729 + k * 31) % 1000) / 10,
        ),
      }),
      { x: "x", y: "y" },
    ),
  );
  measure("pick: 4 marks of 2,500 points, under 100 places", pickUnder(picking(pickClouds)));
  measure(
    "pick: a stack of 12 areas × 2,160, under 100 places",
    pickUnder(picking([area(pickCrowd, { x: "t", y: pickNames as never, stack: true })])),
  );
  const pickCells = table({
    x: Float64Array.from({ length: 200 * 50 }, (_, i) => i % 200),
    y: Float64Array.from({ length: 200 * 50 }, (_, i) => Math.floor(i / 200)),
    v: Float64Array.from({ length: 200 * 50 }, (_, i) => (i * 37) % 101),
  });
  measure(
    "pick: a heatmap of 200 × 50 cells, under 100 places",
    pickUnder(picking([heatmap(pickCells, { x: "x", y: "y", color: "v" })])),
  );
  const PICK_CANDLES = 500;
  const pickPrices = table({
    t: Float64Array.from({ length: PICK_CANDLES }, (_, i) => i * 60_000),
    o: Float64Array.from({ length: PICK_CANDLES }, (_, i) => 100 + 10 * Math.sin(i / 20)),
    c: Float64Array.from({ length: PICK_CANDLES }, (_, i) => 100 + 10 * Math.sin((i + 3) / 20)),
    h: Float64Array.from({ length: PICK_CANDLES }, (_, i) => 112 + 10 * Math.sin(i / 20)),
    l: Float64Array.from({ length: PICK_CANDLES }, (_, i) => 88 + 10 * Math.sin(i / 20)),
  });
  measure(
    "pick: 500 candles over a line, under 100 places",
    pickUnder(
      picking([
        line(pickPrices, { x: "t", y: "c" }),
        candlestick(pickPrices, { x: "t", open: "o", high: "h", low: "l", close: "c" }),
      ]),
    ),
  );
  // A chart of 2,000 candles, merged into pixel columns at 960 px or drawn one
  // by one at 3,200 (about 1.5 px each): made and drawn, and drawn again as a
  // candle arrives and the oldest leaves.
  const CHART_CANDLES = 2000;
  const candleAt = (i: number) => ({
    t: i * 60_000,
    o: 100 + 10 * Math.sin(i / 20),
    c: 100 + 10 * Math.sin((i + 3) / 20),
    h: 112 + 10 * Math.sin(i / 20),
    l: 88 + 10 * Math.sin(i / 20),
  });
  for (const width of [960, 3200]) {
    const prices = table(
      {
        t: Float64Array.from({ length: CHART_CANDLES }, (_, i) => candleAt(i).t),
        o: Float64Array.from({ length: CHART_CANDLES }, (_, i) => candleAt(i).o),
        c: Float64Array.from({ length: CHART_CANDLES }, (_, i) => candleAt(i).c),
        h: Float64Array.from({ length: CHART_CANDLES }, (_, i) => candleAt(i).h),
        l: Float64Array.from({ length: CHART_CANDLES }, (_, i) => candleAt(i).l),
      },
      { maxRows: CHART_CANDLES },
    );
    const chart = () => {
      const model = new ChartModel(
        {
          locale: "en-US",
          timeZone: "UTC",
          legend: false,
          marks: [candlestick(prices, { x: "t", open: "o", high: "h", low: "l", close: "c" })],
        },
        undefined,
        staticCompilers(),
      );
      model.setSize(width, 400, 1);
      return model;
    };
    const how = width === 960 ? "merged into pixel columns" : "one by one";
    measure(`candles: make and draw a chart of 2,000, ${how}`, () => chart().scene(estimateText));
    const streamed = chart();
    streamed.scene(estimateText);
    let next = CHART_CANDLES;
    measure(`candles: 2,000 drawn again as one arrives, ${how}`, () => {
      prices.appendRow(candleAt(next++));
      streamed.scene(estimateText);
    });
  }
  const pickSamples = table({
    g: Array.from({ length: 20 * 500 }, (_, i) => `g${i % 20}`),
    v: Float64Array.from({ length: 20 * 500 }, (_, i) => ((i * 7919) % 1000) / 10),
  });
  measure(
    "pick: box plots of 20 groups × 500, under 100 places",
    pickUnder(picking([boxplot(pickSamples, { x: "g", y: "v" })])),
  );
  measure(
    "pick: boxen of 20 groups × 500, under 100 places",
    pickUnder(picking([boxen(pickSamples, { x: "g", y: "v" })])),
  );
  const pickShares = table({
    k: Array.from({ length: 12 }, (_, i) => `k${i}`),
    v: Float64Array.from({ length: 12 }, (_, i) => 1 + i),
  });
  measure(
    "pick: a pie of 12 slices, under 100 places",
    pickUnder(picking([pie(pickShares, { category: "k", value: "v" })])),
  );
  // Lookup marks with many shapes: 100,000 rug ticks and error bars, whose
  // lookups measure what they draw, and 500 violins, mostly missed.
  const PICK_MANY = 100_000;
  const pickMany = table({
    x: Float64Array.from({ length: PICK_MANY }, (_, i) => (i * 7919) % 100_000),
    low: Float64Array.from({ length: PICK_MANY }, (_, i) => (i * 13) % 50),
    high: Float64Array.from({ length: PICK_MANY }, (_, i) => 50 + ((i * 17) % 50)),
  });
  measure(
    "pick: a rug of 100,000 ticks, under 100 places",
    pickUnder(picking([rug(pickMany, { x: "x" })])),
  );
  measure(
    "pick: 100,000 error bars, under 100 places",
    pickUnder(picking([errorbar(pickMany, { x: "x", y1: "low", y2: "high" })])),
  );
  const pickViolins = table({
    g: Array.from({ length: 500 * 20 }, (_, i) => `g${i % 500}`),
    v: Float64Array.from({ length: 500 * 20 }, (_, i) => ((i * 7919) % 1000) / 100),
  });
  measure(
    "pick: 500 violins, under 100 places",
    pickUnder(picking([violin(pickViolins, { x: "g", y: "v" })], [0, 40])),
  );
  // The first query after a draw, which reads what the frame drew afresh
  // (a custom mark's grid of boxes, an unordered trace's positions): a
  // scene drawn ahead for each sample.
  const firstQuery = (name: string, chart: () => ChartModel) => {
    const charts = Array.from({ length: 70 }, chart);
    const at = pickPlaces(charts[0]!.panels()[0]!.plot)[17]!;
    let next = 0;
    measure(name, () => charts[next++ % charts.length]!.picker!(at[0], at[1]), {
      warmup: 20,
      samples: 50,
    });
  };
  firstQuery("pick: first query after a draw, 12 lines × 2,160", pickCrowdChart);
  firstQuery("pick: first query after a draw, 20,000 custom squares", () =>
    picking([pickDenseShapes]),
  );
}
