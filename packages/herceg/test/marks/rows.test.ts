// Marks read their tables only through rowsOf: given a provider of some of
// a table's rows, each draws what it draws over a table of those rows alone,
// so series, domains, bins, bands, slots, cells, and summaries read no row
// around it.
import { describe, expect, it, vi } from "vitest";
import { encodedCategory, time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { custom } from "../../src/marks/custom.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import type { ChartMark, Mark } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { extentAt, type MarkRows, rowsOf } from "../../src/marks/rows.ts";
import { rug } from "../../src/marks/rug.ts";
import { violin } from "../../src/marks/violin.ts";
import { describeChart } from "../../src/model/describe.ts";
import { facet } from "../../src/model/facet.ts";
import { ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { RectGeometry } from "../../src/scene/scene.ts";

/** The rows the provider gives marks of each table registered here, each set under a number of its own. */
const provided = vi.hoisted(() => new WeakMap<object, Uint32Array>());
const sets = vi.hoisted(() => new WeakMap<Uint32Array, number>());

vi.mock("../../src/marks/rows.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/marks/rows.ts")>();
  return {
    ...actual,
    rowsOf: (data: Table, known: MarkRows | undefined): MarkRows => {
      const positions = provided.get(data);
      if (!positions) return actual.rowsOf(data, known);
      if (!sets.has(positions)) sets.set(positions, Math.random());
      const revision = `subset ${data.version} ${sets.get(positions)}`;
      return known?.table === data && known.revision === revision
        ? known
        : { table: data, positions, revision };
    },
  };
});

const DAY = 86_400_000;
const january = Date.UTC(2024, 0, 1);

/**
 * Rows 1 and 5 hold the extremes of every number field, the only rows of
 * region X, host z, and February, and the closest positions; the provider
 * leaves them out.
 */
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

/**
 * A table of the rows at `positions`, or of every row. Categories keep
 * every value in their dictionaries: colors follow dictionaries, not rows,
 * so a value has one color whatever rows show it.
 */
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

/** A table of every row, whose marks the provider gives the kept rows. */
function provider(): Table<Schema> {
  const whole = rowsAt();
  provided.set(whole, Uint32Array.from(KEPT));
  return whole;
}

/** What a chart of the mark draws and says: its static SVG and its description. */
function drawn(mark: ChartMark) {
  const options = { marks: [mark], width: 480, height: 320, locale: "en-US", timeZone: "UTC" };
  const model = new ChartModel(options);
  model.setSize(480, 320, 1);
  // Each render numbers its ids anew; elements apart, so failures show which differ.
  const svg = renderToSVG(options)
    .replace(/herceg-svg-\d+/g, "herceg-svg")
    .split("><");
  return { svg, description: describeChart(model) };
}

const marks: [string, (data: Table<Schema>) => ChartMark][] = [
  ["line", (data) => line(data, { x: "t", y: "v", series: "host" })],
  ["area", (data) => area(data, { x: "t", y: "v" })],
  ["range area", (data) => area(data, { x: "t", y1: "low", y2: "high" })],
  [
    "range areas by series",
    (data) => area(data, { x: "t", y1: "low", y2: "high", series: "host" }),
  ],
  ["areas of fields", (data) => area(data, { x: "t", y: ["low", "high"] })],
  ["bars in bands", (data) => bar(data, { x: "region", y: "v" })],
  ["bars at numbers", (data) => bar(data, { x: "t", y: "w" })],
  ["stacked bars", (data) => bar(data, { x: "region", y: ["w", "high"], stack: true })],
  [
    "bars stacked by series",
    (data) => bar(data, { x: "region", y: "w", series: "host", stack: true }),
  ],
  ["points", (data) => point(data, { x: "t", y: "v", size: "w", color: "low" })],
  ["points in bands", (data) => point(data, { x: "region", y: "v", fillOpacity: "w" })],
  ["histogram", (data) => histogram(data, { x: "v", series: "host" })],
  ["2D histogram", (data) => histogram(data, { x: "t", y: "v" })],
  ["box plot", (data) => boxplot(data, { x: "region", y: "v", series: "host" })],
  ["violin", (data) => violin(data, { x: "region", y: "v" })],
  ["error bars", (data) => errorbar(data, { x: "t", y1: "low", y2: "high" })],
  [
    "candlestick",
    (data) => candlestick(data, { x: "t", open: "v", high: "high", low: "low", close: "v" }),
  ],
  ["heatmap of bands", (data) => heatmap(data, { x: "region", y: "host", color: "v" })],
  ["heatmap of cells", (data) => heatmap(data, { x: "t", y: "w", color: "v" })],
  ["calendar", (data) => heatmap(data, { date: "day", color: "v" })],
  ["rug", (data) => rug(data, { x: "v", series: "host" })],
  ["custom", (data) => custom(data, { x: "t", y: ["low", "high"], series: false, draw() {} })],
];

describe("marks' rows", () => {
  it.each(marks)("a %s reads only the rows the provider gives", (_, make) => {
    const subset = drawn(make(rowsAt(KEPT)));
    expect(drawn(make(provider()))).toEqual(subset);
  });

  it.each(marks)("a %s draws a provider's new rows, though its table is unchanged", (_, make) => {
    const whole = provider();
    const mark = make(whole);
    drawn(mark);
    const others = [1, 2, 5, 6];
    provided.set(whole, Uint32Array.from(others));
    expect(drawn(mark)).toEqual(drawn(make(rowsAt(others))));
  });

  it("stacks by series a provider's new rows of the same categories and series", () => {
    const whole = provider();
    const make = (data: Table<Schema>) =>
      bar(data, { x: "region", y: "w", series: "host", stack: true });
    // One chart drawing twice, so that its bands and the stack's places stay.
    const rects = (mark: ChartMark, model = modelOf(mark)) =>
      model.scene(estimateText).panels[0]!.marks.map((g) => {
        const { rects, count } = g as RectGeometry;
        return Array.from(rects.subarray(0, count * 4));
      });
    const modelOf = (mark: ChartMark) => {
      const model = new ChartModel({ marks: [mark], locale: "en-US" });
      model.setSize(480, 320, 1);
      return model;
    };
    const model = modelOf(make(whole));
    rects(model.config.marks[0]!, model);
    // Regions N, S, and E and hosts a and b, as the kept rows have.
    const others = [0, 2, 4, 6, 7];
    provided.set(whole, Uint32Array.from(others));
    expect(rects(model.config.marks[0]!, model)).toEqual(rects(make(rowsAt(others))));
  });

  it("styles and colors lines by the provider's rows, as they change and the table grows", () => {
    const kinds = () =>
      table({
        t: [1, 2, 3, 4],
        v: [1, 3, 2, 4],
        kind: encodedCategory(Int32Array.of(0, 0, 1, 1), ["r", "b"]),
        paint: encodedCategory(Int32Array.of(0, 0, 1, 1), ["#ff0000", "#0000ff"]),
      }) as unknown as Table<Schema>;
    const looks: [string, (data: Table<Schema>) => ChartMark][] = [
      [
        "style map",
        (data) =>
          line(data, {
            x: "t",
            y: "v",
            style: {
              by: { field: "kind", map: { r: { stroke: "#ff0000" }, b: { stroke: "#0000ff" } } },
            },
          }),
      ],
      [
        "encoded color",
        (data) =>
          line(data, {
            x: "t",
            y: "v",
            encode: { color: { field: "paint", scale: { type: "identity" } } },
          }),
      ],
    ];
    // One chart drawing again, so that its caches of looks stay.
    const strokes = (model: ChartModel) =>
      model
        .scene(estimateText)
        .panels[0]!.marks.flatMap((g) => ("stroke" in g ? [g.stroke] : []))
        .join();
    const modelOf = (mark: ChartMark) => {
      const model = new ChartModel(
        { marks: [mark], locale: "en-US" },
        undefined,
        ...staticCompilers(),
      );
      model.setSize(480, 320, 1);
      return model;
    };
    for (const [name, make] of looks) {
      const whole = kinds();
      provided.set(whole, Uint32Array.of(0, 1));
      const model = modelOf(make(whole));
      const red = strokes(model);
      // Other rows of the same table: drawn as a table of them alone.
      provided.set(whole, Uint32Array.of(2, 3));
      const fresh = table({
        t: [3, 4],
        v: [2, 4],
        kind: encodedCategory(Int32Array.of(1, 1), ["r", "b"]),
        paint: encodedCategory(Int32Array.of(1, 1), ["#ff0000", "#0000ff"]),
      });
      const blue = strokes(modelOf(make(fresh as unknown as Table<Schema>)));
      expect(blue, name).not.toEqual(red);
      expect(strokes(model), name).toEqual(blue);
      // A row the provider leaves out, unlike the rows drawn, changes nothing.
      provided.set(whole, Uint32Array.of(0, 1));
      expect(strokes(model), name).toEqual(red);
      whole.append({ t: [5], v: [9], kind: ["b"], paint: ["#0000ff"] } as never);
      provided.set(whole, Uint32Array.of(0, 1));
      expect(strokes(model), name).toEqual(red);
    }
  });

  it("style a provider's lines again when another mark's bands reorder their rows", () => {
    const strokes = (model: ChartModel) =>
      model
        .scene(estimateText)
        .panels[0]!.marks.flatMap((g) => ("stroke" in g ? [g.stroke] : []))
        .join();
    const categories = (keys: string[]) =>
      table({ c: keys, v: keys.map(() => 0) }) as unknown as Table<Schema>;
    const chart = (order: string[]) => {
      const others = categories(order);
      const lines = table({
        c: ["a", "b", "c", "d"],
        v: [1, 2, 3, 4],
        paint: encodedCategory(Int32Array.of(0, 1, 2, 3), [
          "#ff0000",
          "#0000ff",
          "#00aa00",
          "#f0f",
        ]),
        kind: encodedCategory(Int32Array.of(0, 0, 0, 1), ["k", "z"]),
      }) as unknown as Table<Schema>;
      // Row 3 is left out, so the line's rows are the provider's.
      provided.set(lines, Uint32Array.of(0, 1, 2));
      const model = new ChartModel(
        {
          marks: [
            point(others, { x: "c", y: "v" }),
            line(lines, {
              x: "c",
              y: "v",
              encode: { color: { field: "paint", scale: { type: "identity" } } },
            }),
          ],
          locale: "en-US",
        },
        undefined,
        ...staticCompilers(),
      );
      model.setSize(480, 320, 1);
      return { model, others };
    };
    const { model, others } = chart(["a", "b", "c"]);
    const before = strokes(model);
    others.reset({ c: ["c", "b", "a"], v: [0, 0, 0] } as never);
    const after = strokes(model);
    expect(after).not.toEqual(before);
    expect(after).toEqual(strokes(chart(["c", "b", "a"]).model));
  });

  it("name a provider's series by their one color value after another mark's bands reorder them", () => {
    const others = table({ c: ["a", "b", "c"], v: [0, 0, 0] }) as unknown as Table<Schema>;
    const lines = table({
      c: ["a", "b", "c", "a", "b", "c"],
      v: [1, 2, 3, 4, 5, 6],
      s: encodedCategory(Int32Array.of(0, 0, 0, 1, 1, 1), ["one", "two"]),
      team: encodedCategory(Int32Array.of(0, 0, 0, 1, 1, 1), ["red", "blue"]),
    }) as unknown as Table<Schema>;
    provided.set(lines, Uint32Array.of(0, 1, 2, 3, 4));
    const model = new ChartModel(
      {
        marks: [
          point(others, { x: "c", y: "v" }),
          line(lines, { x: "c", y: "v", series: "s", encode: { color: { field: "team" } } }),
        ],
        locale: "en-US",
      },
      undefined,
      ...staticCompilers(),
    );
    model.setSize(480, 320, 1);
    const values = () =>
      model
        .scene(estimateText)
        .guides.flatMap((g) =>
          g.kind === "legend" ? g.entries.map((e) => `${e.key} ${e.label}`) : [],
        );
    const before = values();
    expect(before.slice(1)).toEqual([
      '{"field":"team","value":"red"} red',
      '{"field":"team","value":"blue"} blue',
    ]);
    others.reset({ c: ["c", "b", "a"], v: [0, 0, 0] } as never);
    expect(values()).toEqual(before);
  });

  it("draw lines and areas over bands in the order of a provider's rows within each band", () => {
    const values = (order: number[]) =>
      table({
        g: order.map((i) => ["a", "b", "a"][i]!),
        v: order.map((i) => [1, 2, 3][i]!),
      }) as unknown as Table<Schema>;
    for (const make of [
      (data: Table<Schema>) => line(data, { x: "g", y: "v" }),
      (data: Table<Schema>) => area(data, { x: "g", y: "v" }),
    ]) {
      const whole = values([0, 1, 2]);
      provided.set(whole, Uint32Array.of(2, 1, 0));
      expect(drawn(make(whole))).toEqual(drawn(make(values([2, 1, 0]))));
    }
  });

  it("facet a provider's rows alone, as they change", () => {
    const rows = (positions?: number[]) => {
      const at = <T>(all: T[]) => (positions ? positions.map((i) => all[i]!) : all);
      return table({
        x: at([0, 1]),
        y: at([1, 2]),
        g: encodedCategory(Int32Array.from(at([0, 1])), ["a", "b"]),
      }) as unknown as Table<Schema>;
    };
    const options = (data: Table<Schema>) => ({
      marks: [point(data, { x: "x", y: "y" })],
      facet: facet("g"),
      width: 480,
      height: 320,
      locale: "en-US",
    });
    const svg = (data: Table<Schema>) =>
      renderToSVG(options(data))
        .replace(/herceg-svg-\d+/g, "herceg-svg")
        .split("><");
    const whole = rows();
    provided.set(whole, Uint32Array.of(0));
    expect(svg(whole)).toEqual(svg(rows([0])));
    // One chart, as the provider's rows change: b's panel alone.
    const model = new ChartModel(options(whole), undefined, ...staticCompilers());
    model.setSize(480, 320, 1);
    const keys = () => {
      model.scene(estimateText);
      return model.panels().map(({ key }) => key);
    };
    expect(keys()).toEqual(["a"]);
    provided.set(whole, Uint32Array.of(1));
    expect(keys()).toEqual(["b"]);
  });

  it("summarize a provider's rows in each facet panel", () => {
    const values = (positions?: number[]) => {
      const at = <T>(all: T[]) => (positions ? positions.map((i) => all[i]!) : all);
      return table({
        v: at([1, 2, 100, 4]),
        g: encodedCategory(Int32Array.from(at([0, 0, 0, 1])), ["a", "b"]),
      }) as unknown as Table<Schema>;
    };
    const faceted = (mark: ChartMark) => {
      const options = {
        marks: [mark],
        facet: facet("g"),
        width: 480,
        height: 320,
        locale: "en-US",
      };
      return renderToSVG(options)
        .replace(/herceg-svg-\d+/g, "herceg-svg")
        .split("><");
    };
    for (const make of [
      (data: Table<Schema>) => histogram(data, { x: "v" }),
      (data: Table<Schema>) => boxplot(data, { x: "g", y: "v" }),
    ]) {
      const whole = values();
      provided.set(whole, Uint32Array.of(0, 1, 3));
      expect(faceted(make(whole))).toEqual(faceted(make(values([0, 1, 3]))));
    }
  });

  it("paints lines by rows a provider gives in another order than the table's", () => {
    const paints = ["#00aa00", "#ff0000", "#0000ff"];
    const colored = (order: number[], provider?: Uint32Array) => {
      const t = [2, 0, 1];
      const data = table({
        t: order.map((i) => t[i]!),
        v: order.map((i) => [5, 1, 3][i]!),
        paint: encodedCategory(Int32Array.from(order), paints),
      }) as unknown as Table<Schema>;
      if (provider) provided.set(data, provider);
      return line(data, {
        x: "t",
        y: "v",
        encode: { color: { field: "paint", scale: { type: "identity" } } },
      });
    };
    // Rows 1, 2, 0 of the table, whose x values ascend in that order.
    expect(drawn(colored([0, 1, 2], Uint32Array.of(1, 2, 0)))).toEqual(drawn(colored([1, 2, 0])));
  });

  it("check, size, and pad points by identity values of the rows a provider gives", () => {
    // Row 1 holds a size and an opacity no point may have; the provider leaves it out.
    const encoded = (positions: number[], provider?: Uint32Array) => {
      const at = <T>(values: T[]) => positions.map((i) => values[i]!);
      const data = table({
        x: at([0, 1]),
        y: at([1, 2]),
        a: at([25, -1]),
        o: at([0.5, 7]),
      }) as unknown as Table<Schema>;
      if (provider) provided.set(data, provider);
      return point(data, {
        x: "x",
        y: "y",
        size: { field: "a", scale: { type: "identity" } },
        fillOpacity: { field: "o", scale: { type: "identity" } },
      });
    };
    expect(drawn(encoded([0, 1], Uint32Array.of(0)))).toEqual(drawn(encoded([0])));
  });

  it("check, color, and key bars by the rows a provider gives, as they change", () => {
    // Row 1 holds an opacity no bar may have and the only kind "z"; the provider leaves it out.
    const encoded = (positions: number[], provider?: Uint32Array) => {
      const at = <T>(values: T[]) => positions.map((i) => values[i]!);
      const data = table({
        x: at(["a", "b", "c"]),
        y: at([1, 2, 3]),
        o: at([0.5, 7, 0.25]),
        paint: encodedCategory(Int32Array.from(at([0, 1, 2])), ["#ff0000", "#00ff00", "#0000ff"]),
        // Values keep their colors whatever rows show them, so every table has one dictionary.
        kind: encodedCategory(Int32Array.from(at([0, 1, 2])), ["p", "z", "q"]),
      }) as unknown as Table<Schema>;
      if (provider) provided.set(data, provider);
      return data;
    };
    const identities = (data: Table<Schema>) =>
      bar(data, {
        x: "x",
        y: "y",
        encode: {
          color: { field: "paint", scale: { type: "identity" } },
          opacity: { field: "o", scale: { type: "identity" } },
        },
      });
    const kinds = (data: Table<Schema>) => bar(data, { x: "x", y: "y", color: "kind" });
    for (const make of [identities, kinds])
      expect(drawn(make(encoded([0, 1, 2], Uint32Array.of(0, 2))))).toEqual(
        drawn(make(encoded([0, 2]))),
      );
    // One chart drawing again, so that its caches of looks and keys stay.
    const looks = (model: ChartModel) =>
      JSON.stringify(
        model
          .scene(estimateText)
          .panels[0]!.marks.filter((g): g is RectGeometry => g.kind === "rect")
          .map((g) => [g.fill, g.fillOpacity]),
      );
    const modelOf = (mark: ChartMark) => {
      const model = new ChartModel(
        { marks: [mark], locale: "en-US", legend: true },
        undefined,
        ...staticCompilers(),
      );
      model.setSize(480, 320, 1);
      return model;
    };
    const keys = (model: ChartModel) => describeChart(model);
    for (const make of [identities, kinds]) {
      const whole = encoded([0, 1, 2], Uint32Array.of(0));
      const model = modelOf(make(whole));
      const first = [looks(model), keys(model)];
      provided.set(whole, Uint32Array.of(2));
      const other = modelOf(make(encoded([2])));
      expect([looks(model), keys(model)]).toEqual([looks(other), keys(other)]);
      expect([looks(model), keys(model)]).not.toEqual(first);
    }
  });

  it("read no value of a row the provider leaves out of an encoded bar", () => {
    const n = 1000;
    const data = table({
      x: Array.from({ length: n }, (_, i) => i),
      y: Array.from({ length: n }, () => 1),
      o: Array.from({ length: n }, (_, i) => (i % 7) / 7),
    }) as unknown as Table<Schema>;
    provided.set(data, Uint32Array.of(0));
    // Every read of the opacity column, by row.
    const read = new Set<number>();
    const numbers = data.numbers.bind(data);
    data.numbers = ((field: string) => {
      const values = numbers(field as never);
      if (field !== "o") return values;
      return new Proxy(values, {
        get(target, key) {
          if (typeof key === "string" && /^\d+$/.test(key)) read.add(Number(key));
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }) as typeof data.numbers;
    const mark = bar(data, {
      x: "x",
      y: "y",
      encode: { opacity: { field: "o", scale: { type: "identity" } } },
    });
    const model = new ChartModel(
      { marks: [mark], locale: "en-US" },
      undefined,
      ...staticCompilers(),
    );
    model.setSize(480, 320, 1);
    model.scene(estimateText);
    expect([...read]).toEqual([0]);
  });

  it("a provider's rows differ from the table's, so each case tests something", () => {
    for (const [name, make] of marks) {
      expect(drawn(make(rowsAt())).svg, name).not.toEqual(drawn(make(rowsAt(KEPT))).svg);
    }
  });

  it("give a table's rows without a copy, and the same answer while they are unchanged", () => {
    const data = table({ t: [1, 2, 3], v: [4, 5, 6] });
    const first = rowsOf(data, undefined);
    expect(first).toMatchObject({
      table: data,
      positions: undefined,
      revision: String(data.version),
    });
    expect(rowsOf(data, first)).toBe(first);
    data.append({ t: [4], v: [7] });
    const next = rowsOf(data, first);
    expect(next).not.toBe(first);
    expect(next.revision).not.toBe(first.revision);
  });

  it("give a view's rows as positions of its table, in its order, kept as a copy", () => {
    const data = table({ t: [1, 2, 3, 4], v: [4, 9, 6, 1] });
    const view = rowView(data, { sort: [{ field: "v", order: "descending" }] });
    const first = rowsOf(view, undefined);
    expect(first.table).toBe(data);
    expect(Array.from(first.positions!)).toEqual([1, 2, 0, 3]);
    expect(first.positions).not.toBe(view.read().indices);
    expect(rowsOf(view, first)).toBe(first);
    data.append({ t: [5], v: [7] });
    expect(Array.from(rowsOf(view, first).positions!)).toEqual([1, 4, 2, 0, 3]);
    // Another view's answer, however alike its revision, is not this one's.
    const low = rowView(data, { filter: ["<", ["field", "v"], 5] });
    const high = rowView(data, { filter: [">=", ["field", "v"], 5] });
    const lows = rowsOf(low, undefined);
    expect(lows.view).toBe(low);
    expect(Array.from(rowsOf(high, lows).positions!)).toEqual([1, 2, 4]);
  });

  it("read a view's extents once while its rows are unchanged", () => {
    const data = table({ t: [1, 2, 3, 4], v: [4, 9, 6, 1] });
    const view = rowView(data, { filter: ["<", ["field", "t"], 4] });
    const rows = rowsOf(view, undefined) as unknown as MarkRows;
    const reads = vi.spyOn(data, "numbers");
    expect(extentAt(rows, "v")).toEqual([4, 9]);
    expect(extentAt(rows, "v")).toEqual([4, 9]);
    expect(reads).toHaveBeenCalledTimes(1);
    data.append({ t: [0], v: [20] });
    expect(extentAt(rowsOf(view, undefined) as unknown as MarkRows, "v")).toEqual([4, 20]);
  });

  it("of a view draw points as a table of the view's rows does", () => {
    // Bands, sizes, colors, and opacities follow the rows shown, not the table's others.
    const view = rowView(rowsAt(), { filter: col("v").gt(0).and(col("v").lt(50)) });
    const make = (data: Table<Schema> | RowView<Schema>) =>
      point(data, { x: "region", y: "v", size: "w", color: "low", fillOpacity: "high" });
    expect(drawn(make(view))).toEqual(drawn(make(rowsAt(KEPT))));
  });

  it("are what every series mark gives as its rows", () => {
    const data = provider();
    for (const [name, make] of marks) {
      const mark = make(data) as unknown as Mark;
      expect(Array.from(mark.rows?.().positions ?? []), name).toEqual(KEPT);
    }
  });
});
