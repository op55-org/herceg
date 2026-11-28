// A live feed of ten series in one table ordered by time, with late rows, drawn as lines and a stack.

import { encodedCategory, time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { rowView } from "../../src/data/row-view.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { measure } from "./shared.ts";

export async function run(): Promise<void> {
  // A live feed of ten series at 10 Hz in one table ordered by time, over a
  // 30-minute window (180,000 rows). Each tick brings a tenth of a second's rows;
  // one row in 150 arrives 5 s to 2 min late and merges into place. Rows leaving
  // the window drop, and two charts draw again: lines by series, and an
  // intersection stack of three series, over a view of the table or picked
  // from the table by `where`. As in the study's feed, s3 has a 7-minute gap
  // and s4 starts 4 minutes late, which break the lines and the stack.
  const FEED = 10;
  const FEED_WINDOW = 18_000;
  const feedNames = Array.from({ length: FEED }, (_, s) => `s${s}`);
  const reading = (at: number, s: number) => 70 + 95 * s + 32 * Math.sin(at / (60_000 + 9000 * s));
  const history = { time: [] as number[], series: [] as number[], value: [] as number[] };
  for (let k = 0; k < FEED_WINDOW; k++)
    for (let s = 0; s < FEED; s++) {
      if ((s === 3 && k >= 6000 && k < 10_200) || (s === 4 && k < 2400)) continue;
      history.time.push(k * 100 + s * 9);
      history.series.push(s);
      history.value.push(reading(k * 100 + s * 9, s));
    }
  const feed = orderedTable(
    {
      time: time(history.time),
      series: history.series.map((s) => feedNames[s]!),
      value: Float64Array.from(history.value),
    },
    { orderBy: "time" },
  );
  // The history as A7's application has it, each series' rows in time order
  // one series after another: an ordered table sorts them as it is made.
  const bySeries = {
    time: new Float64Array(history.time.length),
    series: new Int32Array(history.time.length),
  };
  {
    let at = 0;
    for (let s = 0; s < FEED; s++)
      history.time.forEach((t, i) => {
        if (history.series[i] !== s) return;
        bySeries.time[at] = t;
        bySeries.series[at++] = s;
      });
  }
  measure(
    "ordered: make a table of 10 series given one after another, 180k rows",
    () =>
      orderedTable(
        {
          time: time(bySeries.time),
          series: encodedCategory(bySeries.series, feedNames),
          value: bySeries.time,
        },
        { orderBy: "time" },
      ),
    { warmup: 5, samples: 20 },
  );
  // The feature compiler applies continuity, as charts load it.
  const feedModel = (marks: ConstructorParameters<typeof ChartModel>[0]["marks"]) => {
    const model = new ChartModel({ marks, legend: false }, undefined, staticCompilers());
    model.setSize(1100, 400, 1);
    model.scene(estimateText);
    return model;
  };
  const gap = { maxGap: { milliseconds: 300_000 } };
  const feedLines = feedModel([
    line(feed, { x: "time", y: "value", series: "series", continuity: gap }),
  ]);
  const stackOptions = {
    x: "time",
    y: "value",
    series: "series",
    continuity: gap,
    stack: { gaps: "interpolate", support: "intersection" },
  } as const;
  const feedStack = feedModel([
    area(rowView(feed, { filter: col("series").isIn("s2", "s3", "s4") }), stackOptions),
  ]);
  // As in a chart, the code keeping a streaming table's series split loads
  // after the first scene; without it, every tick would group the rows again.
  await new Promise((resolve) => setTimeout(resolve, 50));
  let feedTick = FEED_WINDOW;
  let late: { due: number; at: number; s: number }[] = [];
  const feedOnce = (stack = feedStack) => {
    const k = feedTick++;
    const rows = { time: [] as number[], series: [] as string[], value: [] as number[] };
    const deliver = (at: number, s: number) => {
      rows.time.push(at);
      rows.series.push(feedNames[s]!);
      rows.value.push(reading(at, s));
    };
    for (let s = 0; s < FEED; s++) {
      const draw = (Math.imul(k * FEED + s, 2654435761) >>> 0) / 2 ** 32;
      if (draw < 1 / 150)
        late.push({ due: k + 50 + Math.floor(draw * 150 * 1150), at: k * 100 + s * 9, s });
      else deliver(k * 100 + s * 9, s);
    }
    for (const row of late) if (row.due <= k) deliver(row.at, row.s);
    late = late.filter((row) => row.due > k);
    feed.transaction(() => {
      feed.append(rows);
      feed.dropBefore("time", (k - FEED_WINDOW) * 100);
    });
    feedLines.scene(estimateText);
    stack.scene(estimateText);
  };
  measure("ordered: feed tick, 10 series, 1 in 150 late, 180k rows", () => feedOnce(), {
    warmup: 600,
    samples: 300,
  });
  // Made only now: the series split of a chart on the table follows its every tick.
  const feedWhere = feedModel([
    area(feed, { ...stackOptions, where: col("series").isIn("s2", "s3", "s4") }),
  ]);
  measure(
    "ordered: feed tick, the stack by where on the table, 180k rows",
    () => feedOnce(feedWhere),
    { warmup: 600, samples: 300 },
  );
  const feedPlot = feedLines.scene(estimateText).panels[0]!.plot;
  measure(
    "ordered: inspect 10 series of the feed along x, 180k rows",
    () => {
      for (const px of [300, 520, 740, 960])
        feedLines.inspect(px, feedPlot.y + 200, "nearest-x", undefined, "each");
    },
    { repeat: 25 },
  );
}
