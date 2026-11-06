// Sparklines without a DOM: keys of each kind and dictionaries, the index's
// order, the window with its neighbors, the gap rule, paths and their
// bounds, domains, summaries through field displays, data changing, the
// checks, remote grids, and what the model follows and lets go of.
import { afterEach, describe, expect, it, vi } from "vitest";
import { category, time } from "../../src/data/column.ts";
import { groupRows } from "../../src/data/groups.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Schema, Table, table } from "../../src/data/table.ts";
import type { PlacedColumn } from "../../src/grid/columns.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridModel, sparklineCell } from "../../src/grid/model.ts";
import { createRemoteGridModel } from "../../src/grid/remote.ts";
import type { Sparkline } from "../../src/grid/sparklines.ts";
import { Polyline } from "../../src/lod/polyline.ts";

const models: { dispose(): void }[] = [];
afterEach(() => {
  for (const model of models.splice(0)) model.dispose();
});

const services = () => table({ service: category(["web", "api", "db"]) });

/** The request log of the design's example: web's (0, 100), (5, 0), (10, 100); api's (1, 3), (6, 900). */
const requests = () =>
  table({
    service: category(["web", "api", "web", "api", "web"]),
    time: time([0, 1, 5, 6, 10]),
    latency: [100, 3, 0, 900, 100],
  });

/** A model over `rows` whose column 0 draws `options`' sparklines (loosely typed, so tests can give what types refuse). */
function spark(
  options: Record<string, unknown>,
  rows: unknown = services(),
  extra: Record<string, unknown> = {},
) {
  const model = createGridModel({
    data: rowView(rows as Table),
    locale: "en-US",
    columns: [{ id: "trend", cell: sparklineCell(options as never) }],
    ...extra,
  } as never) as GridModel<Schema>;
  models.push(model);
  return model;
}

/** Each row's text of column `column`. */
const texts = (model: Pick<GridModel<Schema>, "rowCount" | "textAt">, column = 0) =>
  Array.from({ length: model.rowCount }, (_, i) => model.textAt(i, column));

/** The paths of row `row`'s sparkline in a box `width` by `height` at `ratio`. */
function paths(model: GridModel<Schema>, row: number, width = 100, height = 19, ratio = 1) {
  const read = model.cellAt(row, 0).sparkline!;
  const sparkline = (model.columnLayout[0] as PlacedColumn).content.sparkline as Sparkline;
  return sparkline.trace(read, width, height, ratio);
}

/** A path's subpaths, each as its points. */
function subpaths(d: string): number[][][] {
  return d
    .split("M")
    .filter(Boolean)
    .map((part) =>
      part
        .replace(/l0\.02 0$/, "")
        .split("L")
        .map((point) => point.split(" ").map(Number)),
    );
}

describe("keys", () => {
  it("match a field of one name in both tables, by label across dictionaries", () => {
    // The grid's dictionary holds "db" first; the data's "web".
    const model = spark(
      { data: requests(), key: "service", x: "time", y: "latency" },
      table({ service: category(["db", "api", "web"]) }),
    );
    expect(texts(model)).toEqual([
      "No values",
      "2 values, 3 to 900, last 900",
      "3 values, 0 to 100, last 100",
    ]);
    expect(model.cellAt(1, 0).sparkline).toMatchObject({ key: "api", count: 2 });
  });

  it("match numbers and times by value, and fields named apart", () => {
    const data = table({ host: [7, 8, 7], at: time([0, 1, 2]), v: [1, 2, 3] });
    const byNumber = spark(
      { data, key: { row: "id", data: "host" }, x: "at", y: "v" },
      table({ id: [8, 7, -0, Number.NaN] }),
    );
    expect(texts(byNumber)).toEqual([
      "1 value, 2",
      "2 values, 1 to 3, last 3",
      "No values",
      "No values",
    ]);
    // Times match times: a day's series by the day's start.
    const day = Date.UTC(2026, 0, 1);
    const daily = table({ day: time([day, day, day + 864e5]), t: [1, 2, 1], v: [5, 6, 7] });
    const byTime = spark({ data: daily, key: "day", x: "t", y: "v" }, table({ day: time([day]) }));
    expect(byTime.cellAt(0, 0).sparkline).toMatchObject({ key: day, count: 2, low: 5, high: 6 });
  });

  it("leave out rows without a key or an x, and write no values for rows without a key", () => {
    const data = table({
      service: category(["web", null, "web", "web"]),
      time: time([0, 1, Number.NaN, 3]),
      latency: [1, 2, 3, 4],
    });
    const model = spark(
      { data, key: "service", x: "time", y: "latency" },
      table({ service: category(["web", null]) }),
    );
    expect(texts(model)).toEqual(["2 values, 1 to 4, last 4", "No values"]);
    expect(model.cellAt(1, 0).sparkline).toEqual({
      key: null,
      count: 0,
      low: undefined,
      high: undefined,
      last: undefined,
      domain: undefined,
      xDomain: [0, 3],
    });
  });

  it("are refused when the grid lacks them or holds another kind", () => {
    const data = requests();
    const at = "grid columns[0].cell";
    expect(() => spark({ data, key: "trace", x: "time", y: "latency" })).toThrow(
      `${at}.key: no field "trace" in the grid's table; give key: { row, data } naming a field of each`,
    );
    expect(() =>
      spark({ data, key: { row: "service", data: "svc" }, x: "time", y: "latency" }),
    ).toThrow(
      `${at}.key.data: no field "svc" in the data; the data has "service", "time", "latency"`,
    );
    expect(() =>
      spark({ data, key: "service", x: "time", y: "latency" }, table({ service: [1, 2] })),
    ).toThrow(
      `${at}.key: "service" holds categories in the data and numbers in the grid; give fields of one kind`,
    );
    expect(() =>
      spark({ data: table({ t: time([0]), n: [1] }), key: "t", x: "n", y: "n" }, table({ t: [0] })),
    ).toThrow(
      `${at}.key: "t" holds times in the data and numbers in the grid; give fields of one kind`,
    );
    expect(() => spark({ data, key: 3, x: "time", y: "latency" })).toThrow(
      `${at}.key: expected a field name, or { row, data } naming a field of each; received 3`,
    );
  });
});

describe("options", () => {
  it("are checked against the data, with the column's path", () => {
    const data = requests();
    const at = "grid columns[0].cell";
    const cases: [Record<string, unknown>, string][] = [
      [{ data: [1, 2] }, `${at}.data: expected a table or a row view; received [1,2]`],
      [{ y: "service" }, `${at}.y: "service" holds categories; sparklines draw numbers`],
      [{ y: "time" }, `${at}.y: "time" holds times; sparklines draw numbers`],
      [
        { x: "service" },
        `${at}.x: "service" holds categories; sparklines place numbers and times along x`,
      ],
      [{ x: "when" }, `${at}.x: no field "when" in the data`],
      [{ mark: "bar" }, `${at}.mark: expected "line" or "area"; received "bar"`],
      [{ domain: [0] }, `${at}.domain: expected two finite numbers, low first; received [0]`],
      [{ domain: [5, 5] }, `${at}.domain: 5 is not below 5; give the line's ends, low first`],
      [{ xDomain: [6, 4] }, `${at}.xDomain: 6 is not below 4; give x's ends, low first`],
    ];
    for (const [given, message] of cases)
      expect(() => spark({ data, key: "service", x: "time", y: "latency", ...given })).toThrow(
        message,
      );
  });

  it("refuse text beside them, and fields' columns", () => {
    const cell = sparklineCell({ data: requests(), key: "service", x: "time", y: "latency" });
    const model = (column: Record<string, unknown>) =>
      createGridModel({ data: rowView(services()), columns: [column as never] });
    expect(() => model({ id: "trend", cell, text: ["x"] })).toThrow(
      "grid columns[0].text: a sparkline's text is its summary; drop text",
    );
    expect(() => model({ field: "service", cell })).toThrow(
      "grid columns[0].cell: sparklineCell() draws another table's rows in a column without a field; drop field, and give id",
    );
  });

  it("serialize as their portable form, copied as given", () => {
    const named = new Table(
      { service: category(["web"]), time: time([0]), latency: [1] },
      { name: "requests" },
    );
    const domain: [number, number] = [0, 10];
    const key = { row: "service", data: "service" };
    const cell = sparklineCell({ data: named, key, x: "time", y: "latency", mark: "area", domain });
    domain[1] = 99;
    key.row = "other";
    expect(cell.spec).toEqual({
      kind: "sparkline",
      data: "requests",
      key: { row: "service", data: "service" },
      x: "time",
      y: "latency",
      mark: "area",
      domain: [0, 10],
    });
    expect(Object.isFrozen(cell.spec)).toBe(true);
    // An unnamed table has no name for a spec to give.
    expect(
      sparklineCell({ data: requests(), key: "service", x: "time", y: "latency" }).spec,
    ).not.toHaveProperty("data");
  });
});

describe("the window", () => {
  it("is the extent of every data row's x, shared by the column", () => {
    const model = spark({ data: requests(), key: "service", x: "time", y: "latency" });
    expect(model.cellAt(0, 0).sparkline?.xDomain).toEqual([0, 10]);
    expect(model.cellAt(1, 0).sparkline?.xDomain).toEqual([0, 10]);
    // api's line starts and ends where its rows do, at 1 and 6 of 0 to 10.
    expect(subpaths(paths(model, 1).line)[0]!.map(([x]) => x)).toEqual([10, 60]);
  });

  it("reaches its ends through the rows past them, interpolated", () => {
    // The design's example: (0, 100), (5, 0), (10, 100) in [4, 6].
    const model = spark({
      data: requests(),
      key: "service",
      x: "time",
      y: "latency",
      xDomain: [4, 6],
    });
    expect(model.textAt(0, 0)).toBe("1 value, 0 to 20, last 20");
    expect(model.cellAt(0, 0).sparkline).toEqual({
      key: "web",
      count: 1,
      low: 0,
      high: 20,
      last: 20,
      domain: [0, 20],
      xDomain: [4, 6],
    });
    // From the window's start at 20, down to 0 at 5, up to 20 at its end.
    const [run] = subpaths(paths(model, 0).line);
    expect(run).toEqual([
      [0, 1.5],
      [50, 17.5],
      [100, 1.5],
    ]);
    // api's row at 6 is the window's end: its line ends there, its start interpolated.
    const api = model.cellAt(1, 0).sparkline!;
    expect(api).toMatchObject({ count: 1, last: 900 });
    expect(api.low).toBeCloseTo(541.2, 9);
  });

  it("draws a line crossing it with no row inside, and nothing where none crosses", () => {
    const data = table({
      service: category(["web", "web", "api", "api", "api"]),
      time: time([0, 10, 0, 1, 10]),
      latency: [10, 30, 5, Number.NaN, 7],
    });
    const model = spark(
      { data, key: "service", x: "time", y: "latency", xDomain: [4, 6] },
      table({ service: category(["web", "api"]) }),
    );
    expect(model.textAt(0, 0)).toBe("No values in this range; interpolated line from 18 to 22");
    expect(model.cellAt(0, 0).sparkline).toMatchObject({ count: 0, low: 18, high: 22, last: 22 });
    expect(subpaths(paths(model, 0).line)).toEqual([
      [
        [0, 17.5],
        [100, 1.5],
      ],
    ]);
    // api's rows either side of the window are a missing value and 7: no line crosses it.
    expect(model.textAt(1, 0)).toBe("No values in this range");
    expect(paths(model, 1)).toEqual({ line: "", area: "" });
  });

  it("reads rows exactly at its ends, duplicates included, as inside", () => {
    const data = table({
      service: category(["web", "web", "web", "web"]),
      time: time([2, 4, 4, 8]),
      latency: [1, 2, 3, 4],
    });
    const model = spark(
      { data, key: "service", x: "time", y: "latency", xDomain: [4, 6] },
      table({ service: category(["web"]) }),
    );
    // Both rows at 4 are inside; the line leaves through 8's neighbor, 3.5 at 6.
    expect(model.cellAt(0, 0).sparkline).toMatchObject({ count: 2, low: 2, high: 3.5, last: 3.5 });
  });
});

describe("the index", () => {
  it("orders each series by x, keeping the data's order for equal x", () => {
    const data = table({
      service: category(["web", "web", "web", "web"]),
      time: time([5, 0, 5, 10]),
      latency: [1, 2, 3, 4],
    });
    const model = spark(
      { data, key: "service", x: "time", y: "latency" },
      table({ service: category(["web"]) }),
    );
    // 0 first (2), then the two at 5 in table order (1, then 3), then 10 (4).
    const [run] = subpaths(paths(model, 0).line);
    expect(run!.map(([x]) => x)).toEqual([0, 50, 50, 100]);
    expect(run!.map(([, y]) => y)).toEqual([12.2, 17.5, 6.8, 1.5]);
    // A view sorted otherwise: its rows in x order, ties in the view's order.
    const view = rowView(data, { sort: [{ field: "latency", order: "descending" }] });
    const sorted = spark(
      { data: view, key: "service", x: "time", y: "latency" },
      table({ service: category(["web"]) }),
    );
    const [ordered] = subpaths(paths(sorted, 0).line);
    expect(ordered!.map(([, y]) => y)).toEqual([12.2, 6.8, 17.5, 1.5]);
    expect(sorted.cellAt(0, 0).sparkline).toMatchObject({ last: 4 });
  });

  it("reads a view's rows alone, and its extent for the window", () => {
    const data = requests();
    const view = rowView(data, { filter: ["<", ["field", "time"], 6] });
    const model = spark({ data: view, key: "service", x: "time", y: "latency" });
    expect(texts(model)).toEqual(["2 values, 0 to 100, last 0", "1 value, 3", "No values"]);
    expect(model.cellAt(0, 0).sparkline?.xDomain).toEqual([0, 5]);
    // A query changing reads it again, and tells the grid.
    let told = 0;
    model.subscribe(() => told++);
    view.setQuery({});
    expect(told).toBeGreaterThan(0);
    expect(texts(model)[0]).toBe("3 values, 0 to 100, last 100");
  });
});

describe("gaps", () => {
  /** web's series of `values` at x 0, 1, 2, ... over a window of 0 to `span`. */
  const series = (values: readonly number[], span = values.length - 1) =>
    spark(
      {
        data: table({
          service: category(values.map(() => "web")),
          time: time(values.map((_, i) => i)),
          latency: values,
        }),
        key: "service",
        x: "time",
        y: "latency",
        xDomain: [0, span],
      },
      table({ service: category(["web"]) }),
    );

  it("inside a pixel column are joined, and break the line between columns", () => {
    // 1,000 x over 100 pixels: ten rows a column, gaps between them inside it.
    const inside = series([1, Number.NaN, 2, 3, Number.NaN, 4, 1, 2, 3, 4, 5], 1000);
    expect(subpaths(paths(inside, 0).line)).toHaveLength(1);
    // Over 10 pixels a column a row: the gap is a column of its own.
    const across = series([1, Number.NaN, 2, 3]);
    expect(subpaths(paths(across, 0, 30).line)).toEqual([
      [[0, 17.5]],
      [
        [20, 9.5],
        [30, 1.5],
      ],
    ]);
  });

  it("at a pixel boundary break once, wherever in the columns the gap falls", () => {
    // Rows at 0, 0.6 (missing), and 1.2 over 2 pixels: 0 and 1.2 in columns 0 and 1.
    const data = table({
      service: category(["web", "web", "web"]),
      time: time([0, 0.6, 1.2]),
      latency: [1, Number.NaN, 2],
    });
    const model = spark(
      { data, key: "service", x: "time", y: "latency", xDomain: [0, 2] },
      table({ service: category(["web"]) }),
    );
    expect(subpaths(paths(model, 0, 2).line)).toHaveLength(2);
    // At twice the pixel ratio the columns are half as wide: still two runs.
    expect(subpaths(paths(model, 0, 2, 19, 2).line)).toHaveLength(2);
    // Over one pixel, the gap is inside a column: joined.
    expect(subpaths(paths(model, 0, 1).line)).toHaveLength(1);
  });

  it("alternating with values keep a path of at most four points a column and a break a boundary", () => {
    const values = Array.from({ length: 10_000 }, (_, i) => (i % 2 ? Number.NaN : Math.sin(i)));
    const model = series(values);
    const points = (runs: number[][][]) => runs.reduce((sum, run) => sum + run.length, 0);
    // A gap at nearly every boundary, inside every column: charts' M4 would keep 5,000 points.
    const runs = subpaths(paths(model, 0, 100, 19, 1).line);
    expect(runs.length).toBeLessThanOrEqual(101);
    expect(points(runs)).toBeLessThanOrEqual(4 * 101);
    expect(points(runs)).toBeGreaterThan(200);
    // At a ratio of 2, columns are half a CSS pixel: up to twice the points.
    const dense = subpaths(paths(model, 0, 100, 19, 2).line);
    expect(dense.length).toBeLessThanOrEqual(201);
    expect(points(dense)).toBeLessThanOrEqual(4 * 201);
    expect(points(dense)).toBeGreaterThan(points(runs));
    // At half, a pixel holds two columns' worth: fewer.
    expect(points(subpaths(paths(model, 0, 100, 19, 0.5).line))).toBeLessThan(points(runs));
    // Every other column missing breaks the line at each: one run a column.
    const columns = series(Array.from({ length: 20 }, (_, i) => (i % 2 ? Number.NaN : i)));
    expect(subpaths(paths(columns, 0, 19).line)).toHaveLength(10);
  });
});

describe("paths", () => {
  it("draw a lone point as a dot, mid-height when it is the domain", () => {
    const model = spark(
      { data: requests(), key: "service", x: "time", y: "latency" },
      table({ service: category(["web"]) }),
      {},
    );
    expect(paths(model, 0).line).toMatch(/^M0 /);
    const lone = spark({
      data: table({ service: category(["web"]), time: time([3]), latency: [7] }),
      key: "service",
      x: "time",
      y: "latency",
    });
    expect(lone.textAt(0, 0)).toBe("1 value, 7");
    // One x is the window: the dot at its middle, level.
    expect(paths(lone, 0).line).toBe("M50 9.5l0.02 0");
  });

  it("fill areas down to the domain's low end, each run apart", () => {
    const data = table({
      service: category(["web", "web", "web", "web", "web"]),
      time: time([0, 1, 2, 3, 4]),
      latency: [1, 3, Number.NaN, 2, 4],
    });
    const model = spark(
      { data, key: "service", x: "time", y: "latency", mark: "area" },
      table({ service: category(["web"]) }),
    );
    const { line, area } = paths(model, 0, 40);
    expect(subpaths(line)).toHaveLength(2);
    expect(area).toBe("M0 17.5L10 6.8L10 17.5L0 17.5ZM30 12.2L40 1.5L40 17.5L30 17.5Z");
    // A lone point of an area is the line's dot; the fill has no run to close.
    const lone = spark(
      {
        data: table({ service: category(["web"]), time: time([3]), latency: [7] }),
        key: "service",
        x: "time",
        y: "latency",
        mark: "area",
      },
      table({ service: category(["web"]) }),
    );
    expect(paths(lone, 0)).toEqual({ line: "M50 9.5l0.02 0", area: "" });
  });

  it("draw nothing in a box of no size", () => {
    const model = spark({ data: requests(), key: "service", x: "time", y: "latency" });
    expect(paths(model, 0, 0)).toEqual({ line: "", area: "" });
    expect(paths(model, 0, 100, 0)).toEqual({ line: "", area: "" });
  });
});

describe("domains", () => {
  it("take each end given, else the y field's display, else what is drawn", () => {
    const options = { data: requests(), key: "service", x: "time", y: "latency" };
    expect(spark({ ...options, domain: [-10, 1000] }).cellAt(0, 0).sparkline?.domain).toEqual([
      -10, 1000,
    ]);
    const display = spark(options, services(), { fields: { latency: { min: 0 } } });
    expect(display.cellAt(1, 0).sparkline?.domain).toEqual([0, 900]);
    // A domain past every value draws them outside the cell, which clips them.
    const past = spark({ ...options, domain: [500, 1000] });
    expect(past.cellAt(0, 0).sparkline).toMatchObject({ low: 0, high: 100, domain: [500, 1000] });
    const ys = subpaths(paths(past, 0).line)[0]!.map(([, y]) => y!);
    expect(Math.min(...ys)).toBeGreaterThan(19);
    // A display's bound past the values on its own side meets them: a level line.
    const level = spark(options, services(), { fields: { latency: { min: 2000 } } });
    expect(level.cellAt(0, 0).sparkline?.domain).toEqual([2000, 2000]);
  });

  it("draw any finite values as numbers path data takes", () => {
    const of = (latency: number[], at = [0, 1], extra: Record<string, unknown> = {}) =>
      spark(
        {
          data: table({ service: category(latency.map(() => "web")), time: time(at), latency }),
          key: "service",
          x: "time",
          y: "latency",
          ...extra,
        },
        table({ service: category(["web"]) }),
      );
    const finite = (model: GridModel<Schema>) => {
      const { line } = paths(model, 0);
      expect(line).not.toBe("");
      expect(line).not.toMatch(/NaN|Infinity/);
      return subpaths(line).flat();
    };
    // Spans too small or too large for a factor: level lines.
    for (const values of [
      [1e-310, 2e-310],
      [-1e308, 1e308],
    ])
      expect(finite(of(values)).every(([, y]) => y === 9.5)).toBe(true);
    // A line crossing the window between values near the largest numbers.
    const crossing = of([0, 1e300], [0, 1e12], { xDomain: [4e11, 6e11] });
    expect(crossing.textAt(0, 0)).toMatch(/^No values in this range; interpolated line from /);
    expect(crossing.cellAt(0, 0).sparkline).toMatchObject({ low: 4e299, high: 6e299 });
    finite(crossing);
    // Rows spanning more than numbers can, crossing the window: half way.
    const wide = of([0, 100], [-1e308, 1e308], { xDomain: [0, 1] });
    expect(wide.cellAt(0, 0).sparkline).toMatchObject({ low: 50, high: 50 });
    // Lines crossing both ends keep their direction, whatever the rounding:
    // level, or between neighboring numbers, rising and falling.
    const next = 3 + 2 ** -51;
    for (const [values, low, high] of [
      [[3, 3], 3, 3],
      [[3, next], 3, 3],
      [[next, 3], next, next],
    ]) {
      const crossed = of(values as number[], [0, 10], { xDomain: [2, 4] });
      expect(crossed.cellAt(0, 0).sparkline).toMatchObject({ low, high, domain: [low, high] });
      expect(finite(crossed).every(([, y]) => y === 9.5)).toBe(true);
    }
    // A value far past a given domain stays far outside the cell.
    const ys = finite(of([0, 1e300], [0, 1], { domain: [0, 1] })).map(([, y]) => y!);
    expect(Math.min(...ys)).toBeLessThan(-1000);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e6);
  });
});

describe("summaries", () => {
  it("write values through the y field's display, without its mappings", () => {
    const model = spark({ data: requests(), key: "service", x: "time", y: "latency" }, services(), {
      fields: {
        latency: {
          format: { duration: "millisecond" },
          mappings: [{ value: 0, text: "idle" }],
        },
      },
    });
    expect(texts(model)).toEqual([
      "3 values, 0ms to 100ms, last 100ms",
      "2 values, 3ms to 900ms, last 900ms",
      "No values",
    ]);
  });

  it("count in the grid's locale, and say when every value is one", () => {
    const n = 1_204;
    const many = spark(
      {
        data: table({
          service: category(Array.from({ length: n }, () => "web")),
          time: time(Array.from({ length: n }, (_, i) => i)),
          latency: Array.from({ length: n }, () => 45),
        }),
        key: "service",
        x: "time",
        y: "latency",
      },
      table({ service: category(["web"]) }),
    );
    expect(many.textAt(0, 0)).toBe("1,204 values, all 45");
    expect(subpaths(paths(many, 0).line)[0]!.every(([, y]) => y === 9.5)).toBe(true);
    // Counts of one too, in digits of the locale's own.
    const one = spark(
      { data: requests(), key: "service", x: "time", y: "latency", xDomain: [0, 4] },
      table({ service: category(["api"]) }),
      { locale: "ar-EG" },
    );
    expect(one.textAt(0, 0)).toMatch(/^١ value, /);
  });

  it("are written with the column's text, and its looks", () => {
    const model = createGridModel({
      data: rowView(table({ service: category(["web", "api"]), status: category(["ok", "down"]) })),
      locale: "en-US",
      fields: { status: { mappings: [{ value: "down", color: "#c62828" }] } },
      columns: [
        { field: "service" },
        {
          id: "trend",
          title: "Latency",
          cell: sparklineCell({ data: requests(), key: "service", x: "time", y: "latency" }),
          encode: { color: { field: "status" } },
        },
      ],
    });
    models.push(model);
    expect(model.columnLayout[1]).toMatchObject({ title: "Latency", field: null, kind: null });
    expect(model.cellAt(1, 1)).toMatchObject({
      state: "empty",
      value: undefined,
      kind: null,
      text: "2 values, 3 to 900, last 900",
      look: { color: "#c62828" },
    });
    expect(model.cellAt(0, 1).look).toBeUndefined();
  });
});

describe("data changes", () => {
  it("read appends and resets, and tell the grid, moving the column's cells revision alone", () => {
    const data = requests();
    const rows = table({ service: category(["web", "api", "db"]), ms: [1, 2, 3] });
    const model = createGridModel({
      data: rowView(rows),
      locale: "en-US",
      columns: [
        { id: "trend", cell: sparklineCell({ data, key: "service", x: "time", y: "latency" }) },
        { field: "ms" },
      ],
    });
    models.push(model);
    let told = 0;
    model.subscribe(() => told++);
    const before = model.cellsRevision(0);
    expect(model.cellsRevision(1)).toBe(0);
    expect(model.textAt(2, 0)).toBe("No values");
    data.append({ service: ["db", "db"], time: [11, 12], latency: [7, 9] });
    expect(told).toBe(1);
    expect(model.cellsRevision(0)).not.toBe(before);
    expect(model.cellsRevision(1)).toBe(0);
    expect(model.textAt(2, 0)).toBe("2 values, 7 to 9, last 9");
    // Every row's window grew with the data's extent.
    expect(model.cellAt(0, 0).sparkline?.xDomain).toEqual([0, 12]);
    data.reset({ service: category(["api"]), time: time([0]), latency: [5] });
    expect(texts(model)).toEqual(["No values", "1 value, 5", "No values"]);
    // The grid's own rows changing reads the same index.
    const revision = model.cellsRevision(0);
    rows.append({ service: ["api"], ms: [4] });
    expect(model.cellsRevision(0)).toBe(revision);
    expect(model.textAt(3, 0)).toBe("1 value, 5");
  });

  it("extend their index through appends to what a new one reads, rebuilding after other changes", () => {
    // A seeded walk of appends (out of x order, ties, new keys, rows without
    // a key, x, or y) among updates, drops, and resets.
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const keys = ["web", "api", "db", "n0", "n1", null];
    const data = requests();
    const rows = () => table({ service: category(["web", "api", "db", "n0", "n1"]) });
    const options = { data, key: "service", x: "time", y: "latency" };
    const followed = spark(options, rows());
    let end = 10;
    const batch = () => {
      const count = 1 + Math.floor(random() * 5);
      const pick = () => keys[Math.floor(random() * keys.length)]!;
      const at = () => {
        const roll = random();
        if (roll < 0.1) return Number.NaN;
        if (roll < 0.3) return Math.floor(random() * end);
        end += Math.floor(random() * 3);
        return end;
      };
      return {
        service: Array.from({ length: count }, pick),
        time: Array.from({ length: count }, at),
        latency: Array.from({ length: count }, () =>
          random() < 0.15 ? Number.NaN : Math.round(random() * 1000),
        ),
      };
    };
    for (let step = 0; step < 80; step++) {
      const roll = random();
      if (roll < 0.75) data.append(batch() as never);
      else if (roll < 0.85 && data.length > 0)
        data.set("latency", Math.floor(random() * data.length), Math.round(random() * 1000));
      else if (roll < 0.92 && data.length > 0) data.dropFirst(1);
      else if (roll < 0.96) data.transaction(() => data.append(batch() as never));
      else data.reset({ service: category(["api"]), time: time([end]), latency: [5] });
      const fresh = spark(options, rows());
      expect(texts(followed)).toEqual(texts(fresh));
      for (let row = 0; row < 5; row++)
        expect(paths(followed, row, 30, 19)).toEqual(paths(fresh, row, 30, 19));
      fresh.dispose();
    }
  });

  it("read the writes of a transaction as it runs, and build again after it changed rows in place", () => {
    const data = table({
      service: category(["web", "web"]),
      time: time([0, 1]),
      latency: [Number.NaN, Number.NaN],
    });
    const options = { data, key: "service", x: "time", y: "latency" };
    const model = spark(options, table({ service: category(["web", "api"]) }));
    expect(texts(model)).toEqual(["No values", "No values"]);
    data.transaction(() => {
      data.set("latency", 0, 2);
      expect(texts(model)).toEqual(["1 value, 2", "No values"]);
      data.set("service", 0, "api");
      expect(texts(model)).toEqual(["No values", "1 value, 2"]);
      data.set("latency", 1, 8);
      data.append({ service: ["web"], time: [2], latency: [9] });
      expect(texts(model)).toEqual(["2 values, 8 to 9, last 9", "1 value, 2"]);
    });
    // As a model made now reads it.
    expect(texts(model)).toEqual(
      texts(spark(options, table({ service: category(["web", "api"]) }))),
    );
    data.append({ service: ["api"], time: [3], latency: [4] });
    expect(texts(model)).toEqual(["2 values, 8 to 9, last 9", "2 values, 2 to 4, last 4"]);
  });

  it("over the grid's own table read its rows as they stream", () => {
    const data = requests();
    const model = createGridModel({
      data: rowView(data),
      locale: "en-US",
      columns: [
        { field: "service" },
        { id: "trend", cell: sparklineCell({ data, key: "service", x: "time", y: "latency" }) },
      ],
    });
    models.push(model);
    expect(model.textAt(0, 1)).toBe("3 values, 0 to 100, last 100");
    data.append({ service: ["web"], time: [11], latency: [50] });
    expect(model.textAt(5, 1)).toBe("4 values, 0 to 100, last 50");
  });
});

describe("paths made before the frame", () => {
  const options = (data: unknown) => ({ data, key: "service", x: "time", y: "latency" });
  const rows = () => table({ service: category(["web", "api", "db"]) });
  /** Each row's paths in a box, as a model made now draws them. */
  const fresh = (data: unknown, width = 100) => {
    const model = spark(options(data), rows());
    const out = [0, 1, 2].map((row) => paths(model, row, width));
    model.dispose();
    return out;
  };
  const drawn = (model: GridModel<Schema>, width = 100) =>
    [0, 1, 2].map((row) => paths(model, row, width));
  const turn = () => new Promise<void>((done) => queueMicrotask(done));

  it("draw the data as it is, whatever comes between a change and the frame", async () => {
    const data = requests();
    const model = spark(options(data), rows());
    drawn(model);
    // Made once the task changing the data has run, its later changes taken in.
    data.append({ service: ["db"], time: [11], latency: [5] });
    data.append({ service: ["db", "web"], time: [12, 12], latency: [7, 1] });
    await turn();
    expect(drawn(model)).toEqual(fresh(data));
    // A change after they were made, before the frame.
    data.append({ service: ["api"], time: [13], latency: [2] });
    await turn();
    data.append({ service: ["api"], time: [14], latency: [3] });
    expect(drawn(model)).toEqual(fresh(data));
    // Another box.
    data.append({ service: ["web"], time: [15], latency: [9] });
    await turn();
    expect(drawn(model, 60)).toEqual(fresh(data, 60));
    // Built again after a reset.
    data.reset({ service: category(["db"]), time: time([0]), latency: [4] });
    await turn();
    expect(drawn(model)).toEqual(fresh(data));
  });

  it("are made once a task, for the keys drawn last, not every row scrolled past", async () => {
    const keys = Array.from({ length: 1000 }, (_, k) => `s${k}`);
    const data = table({
      service: category(keys),
      time: time(keys.map((_, k) => k)),
      latency: keys.map(() => 1),
    });
    const model = spark(options(data), table({ service: category(keys) }));
    const scroll = () => {
      for (let row = 0; row < keys.length; row++) paths(model, row);
    };
    scroll();
    const made = vi.spyOn(Polyline.prototype, "reset");
    data.append({ service: ["s0"], time: [1000], latency: [2] });
    await turn();
    expect(made).toHaveBeenCalledTimes(256);
    // Drawn again between changes in one task: made once, after the last.
    scroll();
    data.append({ service: ["s1"], time: [1001], latency: [2] });
    scroll();
    data.append({ service: ["s2"], time: [1002], latency: [2] });
    made.mockClear();
    await turn();
    expect(made).toHaveBeenCalledTimes(256);
    made.mockRestore();
    // Prepared or not, drawn as the data is now.
    const now = spark(options(data), table({ service: category(keys) }));
    for (const row of [0, 999]) expect(paths(model, row)).toEqual(paths(now, row));
  });

  it("are not made once the model lets go, nor for a column no cell drew", async () => {
    const data = requests();
    const model = spark(options(data), rows());
    drawn(model);
    data.append({ service: ["db"], time: [11], latency: [5] });
    model.dispose();
    await turn();
    // Not drawn since its last change: nothing to make.
    const idle = spark(options(data), rows());
    idle.textAt(0, 0);
    data.append({ service: ["db"], time: [12], latency: [6] });
    await turn();
    expect(drawn(idle)).toEqual(fresh(data));
  });
});

describe("what the model follows", () => {
  /** `data`, counting the listeners it holds. */
  function counted<S extends Schema>(data: Table<S>) {
    const subscribe = data.subscribe.bind(data);
    const live = { count: 0 };
    data.subscribe = (listener) => {
      live.count++;
      const stop = subscribe(listener);
      return () => {
        live.count--;
        stop();
      };
    };
    return live;
  }

  it("is the data while the column is the model's, once however many columns draw it", () => {
    const data = requests();
    const live = counted(data);
    const cell = sparklineCell({ data, key: "service", x: "time", y: "latency" });
    const model = createGridModel({
      data: rowView(services()),
      columns: [
        { id: "a", cell },
        { id: "b", cell },
      ],
    });
    models.push(model);
    // A sparkline a column, each following its data.
    expect(live.count).toBe(2);
    model.setColumns([{ id: "a", cell }]);
    expect(live.count).toBe(1);
    model.update({ fields: { latency: { label: "Latency" } } });
    expect(live.count).toBe(1);
    // Columns moving or resizing keep their contents.
    model.resizeColumn("a", 200);
    expect(live.count).toBe(1);
    model.setColumns([{ field: "service" }]);
    expect(live.count).toBe(0);
    let told = 0;
    model.subscribe(() => told++);
    data.append({ service: ["web"], time: [20], latency: [1] });
    expect(told).toBe(0);
  });

  it("stops with the model's disposal, and with a refused update changes nothing", () => {
    const data = requests();
    const live = counted(data);
    const model = createGridModel({
      data: rowView(services()),
      columns: [
        { id: "a", cell: sparklineCell({ data, key: "service", x: "time", y: "latency" }) },
      ],
    });
    expect(() => model.update({ fields: { latency: { format: { time: "%Y" } } } })).toThrow();
    expect(live.count).toBe(1);
    model.dispose();
    expect(live.count).toBe(0);
  });

  it("over a remote grid's rows matches the rows' values, asking for the key", async () => {
    const rows = table({ id: [1, 2, 3], service: category(["web", "api", "db"]) });
    const asked: (readonly string[] | undefined)[] = [];
    const memory = memorySource(rows, { key: "id" });
    const model = createRemoteGridModel({
      source: {
        schema: memory.schema,
        rows(request, signal) {
          asked.push(request.fields);
          return memory.rows(request, signal);
        },
      },
      locale: "en-US",
      columns: [
        { field: "id" },
        {
          id: "trend",
          cell: sparklineCell({ data: requests(), key: "service", x: "time", y: "latency" }),
        },
      ],
    });
    models.push(model);
    model.setViewport(400, 300);
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(asked.at(-1)).toContain("service");
    expect(model.textAt(1, 1)).toBe("2 values, 3 to 900, last 900");
    expect(model.cellAt(1, 1).sparkline).toMatchObject({ key: "api", count: 2 });
    expect(model.cellsRevision(1)).toBeGreaterThan(0);
  });

  it("writes nothing on group rows", () => {
    const view = rowView(
      table({ service: category(["web", "api"]), region: category(["eu", "eu"]) }),
    );
    const model = createGridModel({
      data: view,
      groups: groupRows(view, { by: ["region"] }),
      columns: [
        { field: "region" },
        {
          id: "trend",
          cell: sparklineCell({ data: requests(), key: "service", x: "time", y: "latency" }),
        },
      ],
    });
    models.push(model);
    expect(model.textAt(0, 1)).toBe("");
    expect(model.cellAt(0, 1).sparkline).toBeUndefined();
  });
});
