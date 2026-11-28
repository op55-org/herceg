// Axes: first scenes' axes, log axes, and a streamed axis' plans.

import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { axis } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { labelsMeet, planAxis } from "../../src/model/axis.ts";
import { facet } from "../../src/model/facet.ts";
import { ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { LIGHT } from "../../src/theme.ts";
import { measure, pageMeasurer } from "./shared.ts";

export async function run(): Promise<void> {
  // A first scene's axes: a line's default axes, a listed axis of hours over
  // days laid out at its own depth (giving its end labels room or leaving them
  // out) or in a room the day row does not fit, and twenty horizon strips
  // under an axis on top in a fixed room (study B4).
  const DAY_START = Date.UTC(2026, 8, 28);
  const hourly = table({
    t: time(Array.from({ length: 49 }, (_, i) => DAY_START + i * 3_600_000)),
    v: Float64Array.from({ length: 49 }, (_, i) => 50 + 40 * Math.sin(i / 5)),
  });
  const days = axis({
    scale: "x",
    layers: [{ id: "day", ticks: { every: "day" }, format: { time: "%b %d" }, labels: { row: 1 } }],
  });
  // The same axis leaving out its end labels where they cross the chart's edge.
  const daysInside = axis({
    scale: "x",
    labels: { ends: "hide" },
    layers: [
      {
        id: "day",
        ticks: { every: "day" },
        format: { time: "%b %d" },
        labels: { row: 1, ends: "hide" },
      },
    ],
  });
  const strips = table({
    site: Array.from({ length: 20 * 49 }, (_, i) => `site ${Math.floor(i / 49)}`),
    t: time(Array.from({ length: 20 * 49 }, (_, i) => DAY_START + (i % 49) * 3_600_000)),
    v: Float64Array.from({ length: 20 * 49 }, (_, i) => Math.abs(Math.sin(i / 7))),
  });
  for (const [name, config, height] of [
    ["a line, default axes", {}, 300],
    ["hours over days", { guides: [days] }, 300],
    ["hours over days, end labels left out", { guides: [daysInside] }, 300],
    ["hours over days, in a room for one row", { x: { room: 18 }, guides: [days] }, 300],
    [
      "20 strips under an axis on top in 30 px",
      {
        x: { place: { side: "top" }, room: 30 },
        y: { show: false, grid: false },
        facet: facet("site", { columns: 1, header: false, gap: 1 }),
      },
      30 + 20 * 26,
    ],
  ] as const) {
    const marks =
      height === 300
        ? [line(hourly, { x: "t", y: "v" })]
        : [area(strips, { x: "t", y: "v", line: false })];
    measure(`axes: first scene of ${name}`, () => {
      const model = new ChartModel(
        { marks, timeZone: "UTC", ...config },
        undefined,
        staticCompilers(),
      );
      model.setSize(600, height, 1);
      model.scene(estimateText);
    });
  }

  // Log axes, ticked and labelled as d3's: a line over three decades and one
  // over six (every digit ticked, the leading digits that fit the count
  // labelled), and study B1's axis (a fixed domain, d3's count of 10, and a
  // function format writing the labelled ticks alone).
  const decades = (n: number) =>
    table({
      x: Float64Array.from({ length: 200 }, (_, i) => i),
      v: Float64Array.from({ length: 200 }, (_, i) => 10 ** ((n * i) / 199)),
    });
  const b1Ratio = 6.54;
  for (const [name, rows, y] of [
    ["a log line over three decades", decades(3), { type: "log" }],
    ["a log line over six decades", decades(6), { type: "log" }],
    [
      "B1's log axis, ten ticks and a format",
      decades(1),
      {
        type: "log",
        domain: [1 / b1Ratio, b1Ratio],
        nice: false,
        ticks: 10,
        format: (v: number) => `${v}×`,
      },
    ],
  ] as const) {
    measure(`axes: first scene of ${name}`, () => {
      const model = new ChartModel(
        { marks: [line(rows, { x: "x", y: "v" })], y },
        undefined,
        staticCompilers(),
      );
      model.setSize(600, 600, 1);
      model.scene(estimateText);
    });
  }

  // A streamed axis' plans, one a frame, its labels judged as the model's x
  // axis judges them: a 1.2-second window moving 16.7 ms a frame over 864 px,
  // in UTC and in London's repeated hour (01:30 GMT on 2026-10-25), a
  // 30-minute window moving a second a frame, and `ticks: 50` panning
  // [0, 1000] over 300 px, whose labels meet, so that each frame plans about
  // a dozen counts. One sample plans 600 frames; the intervals they take
  // follow.
  const SUMMER = Date.UTC(2026, 6, 1, 5, 38, 58);
  const LONDON_REPEATED = Date.UTC(2026, 9, 25, 1, 30);
  for (const [name, type, zone, from, span, step, pixels, count] of [
    ["a 1.2 s window, UTC", "time", "UTC", SUMMER, 1200, 16.7, 864, 9],
    [
      "a 1.2 s window, London's repeated hour",
      "time",
      "Europe/London",
      LONDON_REPEATED,
      1200,
      16.7,
      864,
      9,
    ],
    ["a 30-minute window, UTC", "time", "UTC", SUMMER, 30 * 60_000, 1000, 864, 9],
    ["ticks: 50 over 300 px", "linear", "UTC", 0, 1000, 0.37, 300, 50],
  ] as const) {
    const context = {
      type,
      spec: undefined,
      zone,
      locale: "en-US",
      meets: labelsMeet([LIGHT.style.tickLabel], pageMeasurer(), true),
    };
    const intervals = new Set<number>();
    measure(
      `axes: 600 streamed plans of ${name}`,
      () => {
        for (let k = 0; k < 600; k++) {
          const start = from + k * step;
          const { ticks } = planAxis(context, [start, start + span], [0, pixels], count);
          intervals.add(ticks.length > 1 ? Math.round(ticks[1]! - ticks[0]!) : 0);
        }
      },
      { warmup: 3, samples: 15 },
    );
    console.log(`  intervals: ${[...intervals].join(", ")}`);
  }
}
