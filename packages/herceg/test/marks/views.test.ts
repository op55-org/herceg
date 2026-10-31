// Every series mark takes a row view: it draws what it draws over a table
// of the view's rows alone, and follows the view as its table and query
// change.
import { describe, expect, it } from "vitest";
import { encodedCategory, time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxen } from "../../src/marks/boxen.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { custom } from "../../src/marks/custom.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import type { ChartMark } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { rug } from "../../src/marks/rug.ts";
import { violin } from "../../src/marks/violin.ts";
import { describeChart } from "../../src/model/describe.ts";
import { facet } from "../../src/model/facet.ts";
import { ChartModel } from "../../src/model/model.ts";
import { renderToSVG } from "../../src/render/static.ts";

const DAY = 86_400_000;
const january = Date.UTC(2024, 0, 1);

/** Rows 1 and 5, of host z, hold the extremes of every number field; views leave them out. */
const ROWS = {
  t: [1, 1.5, 3, 5, 7, 7.2, 9, 11],
  v: [5, 100, 7, 3, 9, -50, 4, 6],
  w: [1, 40, 3, 4, 5, 0.1, 7, 8],
  low: [4, 90, 6, 2, 8, -60, 3, 5],
  high: [6, 110, 8, 4, 10, -40, 5, 7],
  day: [0, 40, 2, 3, 5, 45, 9, 12].map((d) => january + d * DAY),
  region: ["N", "X", "S", "N", "S", "X", "E", "N"],
  host: ["a", "z", "b", "a", "b", "z", "a", "b"],
};
const KEPT = [0, 2, 3, 4, 6, 7];
const FILTER = col("host").ne("z");

/** A table of the rows at `positions`, or of every row; categories keep every value. */
function rowsAt(positions?: readonly number[]): Table<Schema> {
  const at = <T>(values: readonly T[]) => (positions ? positions.map((i) => values[i]!) : values);
  const categories = (values: readonly string[]) => {
    const dictionary = [...new Set(values)];
    return encodedCategory(
      Int32Array.from(at(values), (value) => dictionary.indexOf(value)),
      dictionary,
    );
  };
  return table({
    t: at(ROWS.t),
    v: at(ROWS.v),
    w: at(ROWS.w),
    low: at(ROWS.low),
    high: at(ROWS.high),
    day: time(at(ROWS.day)),
    region: categories(ROWS.region),
    host: categories(ROWS.host),
  }) as unknown as Table<Schema>;
}

/** What a chart of the mark draws and says: its static SVG and its description. */
function drawn(mark: ChartMark) {
  const options = { marks: [mark], width: 480, height: 320, locale: "en-US", timeZone: "UTC" };
  const model = new ChartModel(options);
  model.setSize(480, 320, 1);
  // Described as drawn: marks summarize the series of the scene.
  model.scene(estimateText);
  const svg = renderToSVG(options)
    .replace(/herceg-svg-\d+/g, "herceg-svg")
    .split("><");
  return { svg, description: describeChart(model) };
}

type Data = Table<Schema> | RowView<Schema>;

const marks: [string, (data: Data) => ChartMark][] = [
  ["line", (data) => line(data, { x: "t", y: "v", series: "host" })],
  ["area", (data) => area(data, { x: "t", y: "v" })],
  ["range area", (data) => area(data, { x: "t", y1: "low", y2: "high" })],
  ["areas of fields", (data) => area(data, { x: "t", y: ["low", "high"], stack: true })],
  ["streams of fields", (data) => area(data, { x: "t", y: ["w", "t"], stack: "wiggle" })],
  [
    "streams by series",
    (data) => area(data, { x: "t", y: "w", series: "host", stack: { offset: "wiggle" } }),
  ],
  [
    "areas stacked by series",
    (data) => area(data, { x: "t", y: "w", series: "host", stack: { gaps: "interpolate" } }),
  ],
  ["bars in bands", (data) => bar(data, { x: "region", y: "v" })],
  ["bars at numbers", (data) => bar(data, { x: "t", y: "w" })],
  [
    "bars stacked by series",
    (data) => bar(data, { x: "region", y: "w", series: "host", stack: true }),
  ],
  ["points", (data) => point(data, { x: "t", y: "v", size: "w", color: "low" })],
  ["histogram", (data) => histogram(data, { x: "v", series: "host" })],
  ["2D histogram", (data) => histogram(data, { x: "t", y: "v" })],
  ["box plot", (data) => boxplot(data, { x: "region", y: "v", series: "host" })],
  ["boxen", (data) => boxen(data, { x: "region", y: "v" })],
  ["violin", (data) => violin(data, { x: "region", y: "v" })],
  ["error bars", (data) => errorbar(data, { x: "t", y1: "low", y2: "high" })],
  ["error bars about a center", (data) => errorbar(data, { x: "t", y: "v", yError: "w" })],
  [
    "candlestick",
    (data) => candlestick(data, { x: "t", open: "v", high: "high", low: "low", close: "v" }),
  ],
  ["heatmap of bands", (data) => heatmap(data, { x: "region", y: "host", color: "v" })],
  ["heatmap of cells", (data) => heatmap(data, { x: "t", y: "w", color: "v" })],
  ["calendar", (data) => heatmap(data, { date: "day", color: "v" })],
  ["rug", (data) => rug(data, { x: "v", series: "host" })],
  [
    "custom mark of points",
    (data) =>
      custom(data, {
        x: "t",
        y: "v",
        series: "host",
        draw({ series, x, y, item, circle }) {
          for (const s of series)
            for (let k = 0; k < s.length; k++) {
              const row = s.rowAt(k);
              item(s, row, () => circle(x(s.x[row]!), y(s.y[row]!), 3));
            }
        },
      }),
  ],
  [
    "custom mark of ranges",
    (data) =>
      custom(data, {
        x: ["low", "high"],
        y: "region",
        draw({ table: rows, series, x, y, item, rect }) {
          const high = rows.numbers("high");
          for (const s of series)
            for (let k = 0; k < s.length; k++) {
              const row = s.rowAt(k);
              const left = x(s.x[row]!);
              item(s, row, () => rect(left, y(s.y[row]!) - 2, x(high[row]!) - left, 4));
            }
        },
      }),
  ],
];

describe("series marks over row views", () => {
  it.each(marks)("a %s over a view draws a table of the view's rows", (_, make) => {
    const view = rowView(rowsAt(), { filter: FILTER });
    expect(drawn(make(view))).toEqual(drawn(make(rowsAt(KEPT))));
  });

  it.each(marks)("a %s follows its view's query", (_, make) => {
    const view = rowView(rowsAt());
    const mark = make(view);
    drawn(mark);
    view.setQuery({ filter: FILTER });
    expect(drawn(mark)).toEqual(drawn(make(rowsAt(KEPT))));
  });

  it("stacks a view's rows again when its query changes and its series stay", () => {
    const make = (data: Data) =>
      area(data, { x: "t", y: "w", series: "host", stack: { gaps: "interpolate" } });
    const view = rowView(rowsAt(), { filter: col("t").lt(8) });
    const mark = make(view);
    drawn(mark);
    view.setQuery({ filter: col("t").gt(2) });
    expect(drawn(mark)).toEqual(drawn(make(rowsAt([2, 3, 4, 5, 6, 7]))));
  });

  it.each(marks)("a %s over a view splits into facets as a table of its rows does", (_, make) => {
    const faceted = (mark: ChartMark) => {
      const options = {
        marks: [mark],
        facet: facet("region"),
        width: 640,
        height: 320,
        locale: "en-US",
        timeZone: "UTC",
      };
      return renderToSVG(options)
        .replace(/herceg-svg-\d+/g, "herceg-svg")
        .split("><");
    };
    expect(faceted(make(rowView(rowsAt(), { filter: FILTER })))).toEqual(
      faceted(make(rowsAt(KEPT))),
    );
  });

  it("pairs and describes rows at one x in the view's order, as a table of them does", () => {
    // Host a has three rows at t 1; sorting by w downward reverses them,
    // and the two candles at t 3.
    const rows = {
      t: [1, 1, 1, 2, 3, 3],
      w: [1, 3, 5, 2, 4, 6],
      open: [1, 2, 3, 4, 5, 6],
      host: ["a", "a", "a", "b", "b", "a"],
    };
    const order = [5, 2, 4, 1, 3, 0];
    const at = <T>(values: readonly T[]) => order.map((i) => values[i]!);
    const whole = table({
      ...rows,
      host: encodedCategory(
        Int32Array.from(rows.host, (h) => (h === "a" ? 0 : 1)),
        ["a", "b"],
      ),
    });
    const view = rowView(whole, { sort: [{ field: "w", order: "descending" }] });
    const same = table({
      t: at(rows.t),
      w: at(rows.w),
      open: at(rows.open),
      host: encodedCategory(
        Int32Array.from(at(rows.host), (h) => (h === "a" ? 0 : 1)),
        ["a", "b"],
      ),
    });
    const makes: ((data: Data) => ChartMark)[] = [
      (data) => area(data, { x: "t", y: "w", series: "host", stack: { gaps: "interpolate" } }),
      (data) => area(data, { x: "t", y: "w", series: "host", stack: { offset: "wiggle" } }),
      (data) => candlestick(data, { x: "t", open: "open", high: "w", low: "open", close: "w" }),
    ];
    for (const make of makes)
      expect(drawn(make(view as unknown as Data))).toEqual(drawn(make(same as unknown as Data)));
  });

  it("stacks fields of a view's rows at one x in its order, in facet panels too", () => {
    // Sorting by i downward reverses the rows, the two at x 1 among them.
    const rows = { x: [1, 1, 2, 0], a: [1, 8, 3, 5], b: [5, 1, 4, 3], i: [0, 1, 2, 3] };
    const at = (values: readonly number[]) => [3, 2, 1, 0].map((i) => values[i]!);
    const region = (count: number) => encodedCategory(new Int32Array(count), ["N"]);
    const whole = table({ ...rows, region: region(4) });
    const view = rowView(whole, { sort: [{ field: "i", order: "descending" }] });
    const same = table({
      x: at(rows.x),
      a: at(rows.a),
      b: at(rows.b),
      i: at(rows.i),
      region: region(4),
    });
    const stacks = [{ offset: "wiggle" }, { offset: "center", order: "inside-out" }] as const;
    for (const stack of stacks) {
      const faceted = (data: Data) =>
        renderToSVG({
          marks: [area(data, { x: "x", y: ["a", "b"], stack })],
          facet: facet("region"),
          width: 480,
          height: 320,
        })
          .replace(/herceg-svg-\d+/g, "herceg-svg")
          .split("><");
      expect(faceted(view as unknown as Data)).toEqual(faceted(same as unknown as Data));
    }
  });

  it("describes the last of a sorted view's rows across facet panels as its order has it", () => {
    const describe = (data: Data, make: (data: Data) => ChartMark) => {
      const options = { marks: [make(data)], facet: facet("region") };
      const model = new ChartModel({ ...options, locale: "en-US" });
      model.setSize(480, 320, 1);
      model.scene(estimateText);
      return describeChart(model);
    };
    const region = (labels: string[]) =>
      encodedCategory(
        Int32Array.from(labels, (r) => (r === "N" ? 0 : 1)),
        ["N", "S"],
      );
    const whole = table({ t: [1, 2, 3], v: [1, 3, 2], region: region(["N", "S", "N"]) });
    const view = rowView(whole, { sort: [{ field: "v", order: "descending" }] });
    const same = table({ t: [2, 3, 1], v: [3, 2, 1], region: region(["S", "N", "N"]) });
    // Points sized by a field summarize themselves.
    const makes: ((data: Data) => ChartMark)[] = [
      (data) => line(data, { x: "t", y: "v" }),
      (data) => point(data, { x: "t", y: "v", size: "v" }),
    ];
    for (const make of makes) {
      expect(describe(view as unknown as Data, make)).toBe(describe(same as unknown as Data, make));
      expect(describe(view as unknown as Data, make)).toContain("last 1");
    }
  });

  it("draws a view's summarized boxes in its order, in facet panels too", () => {
    // Two boxes in band g a, one over the other: the one read last is drawn on top.
    const g = (labels: string[]) =>
      encodedCategory(
        Int32Array.from(labels, () => 0),
        ["a"],
      );
    const boxes = {
      lo: [1, 2],
      q1: [2, 3],
      mid: [3, 4],
      q3: [4, 5],
      hi: [5, 6],
      n: [5, 7],
    };
    const whole = table({ ...boxes, g: g(["a", "a"]) });
    const view = rowView(whole, { sort: [{ field: "n", order: "descending" }] });
    const at = <T>(values: readonly T[]) => [values[1]!, values[0]!];
    const same = table({
      ...Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, at(v)])),
      g: g(["a", "a"]),
    } as never);
    const box = (data: Data) =>
      boxplot(data, {
        x: "g",
        low: "lo",
        q1: "q1",
        median: "mid",
        q3: "q3",
        high: "hi",
        count: "n",
      } as never);
    expect(drawn(box(view as unknown as Data))).toEqual(drawn(box(same as unknown as Data)));
    // Facet panels give summarizers the view's rows in its order too.
    const panels = (data: Data) => {
      const options = { marks: [box(data)], facet: facet("region"), width: 480, height: 320 };
      return renderToSVG({ ...options, locale: "en-US" }).replace(/herceg-svg-\d+/g, "herceg-svg");
    };
    const region = encodedCategory(Int32Array.of(0, 0), ["N"]);
    const inPanels = table({ ...boxes, g: g(["a", "a"]), region });
    const sameInPanels = table({
      ...Object.fromEntries(Object.entries(boxes).map(([k, v]) => [k, at(v)])),
      g: g(["a", "a"]),
      region,
    } as never);
    expect(
      panels(rowView(inPanels, { sort: [{ field: "n", order: "descending" }] }) as unknown as Data),
    ).toBe(panels(sameInPanels as unknown as Data));
  });

  it("describes the last candle on a category axis in the view's order", () => {
    const day = (labels: string[]) =>
      encodedCategory(
        Int32Array.from(labels, (d) => ["mon", "tue", "wed"].indexOf(d)),
        ["mon", "tue", "wed"],
      );
    const candles = (data: Data) =>
      candlestick(data, { x: "d", open: "p", high: "p", low: "p", close: "p" });
    const whole = table({ d: day(["mon", "tue", "wed"]), p: [1, 2, 3] });
    const view = rowView(whole, { sort: [{ field: "p", order: "descending" }] });
    const same = table({ d: day(["wed", "tue", "mon"]), p: [3, 2, 1] });
    const describe = (data: Data) => {
      const model = new ChartModel({ marks: [candles(data)], locale: "en-US" });
      model.setSize(480, 320, 1);
      model.scene(estimateText);
      return describeChart(model);
    };
    const said = describe(view as unknown as Data);
    expect(said).toBe(describe(same as unknown as Data));
    expect(said).toContain("closed at 1");
  });

  it("keeps the view's table as the mark's", () => {
    const whole = rowsAt();
    const view = rowView(whole, { filter: FILTER });
    const mark = line(view, { x: "t", y: "v" }) as unknown as { table: Table; view: RowView };
    expect(mark.table).toBe(whole);
    expect(mark.view).toBe(view);
  });

  it("draws an ordered table's late rows in place, through a view too", () => {
    const make = (data: Data) => line(data, { x: "t", y: "v", series: "host" });
    const live = orderedTable(
      { t: [1, 5, 9], v: [1, 5, 9], host: ["a", "b", "a"] },
      { orderBy: "t" },
    ) as unknown as Table<Schema>;
    const view = rowView(live, { filter: col("v").gt(0) });
    const marks = [make(live), make(view)];
    for (const mark of marks) drawn(mark);
    live.append({ t: [3, 7, 11], v: [3, -7, 11], host: ["b", "a", "b"] } as never);
    const whole = table({
      t: [1, 3, 5, 7, 9, 11],
      v: [1, 3, 5, -7, 9, 11],
      host: ["a", "b", "b", "a", "a", "b"],
    });
    const kept = table({
      t: [1, 3, 5, 9, 11],
      v: [1, 3, 5, 9, 11],
      host: ["a", "b", "b", "a", "b"],
    });
    expect(drawn(marks[0]!)).toEqual(drawn(make(whole as unknown as Table<Schema>)));
    expect(drawn(marks[1]!)).toEqual(drawn(make(kept as unknown as Table<Schema>)));
  });
});
