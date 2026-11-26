// Tooltip totals: a series mark's `tooltip.total` adds a row after its
// points in a reading along an axis, the sum of the values it lists of the
// mark, which inspections carry (`inspection.totals`).
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import type { FieldDisplays } from "../../src/fields/rules.ts";
import { estimateText } from "../../src/layout/text.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { placeAt, rowOf } from "../../src/marks/series.ts";
import { tooltipWriters } from "../../src/marks/tooltip-writers.ts";
import { inspectPosition } from "../../src/model/keyboard.ts";
import { type AxisInspection, type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { contractTest } from "../helpers/contracts.ts";
import { xScale } from "../helpers/scales.ts";

function build(config: ChartConfig, writers = true) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    staticCompilers(),
  );
  // As a chart does once it has loaded what writes tooltips.
  if (writers) model.writers = tooltipWriters;
  model.setSize(600, 300, 1);
  model.scene(estimateText);
  return model;
}

const DAY = 86_400_000;
const start = Date.UTC(2026, 0, 5);
/** Three regions' revenue over three days, in one long table. */
const revenue = () =>
  table({
    day: time([start, start, start, start + DAY, start + DAY, start + DAY, start + 2 * DAY]),
    region: ["north", "south", "west", "north", "south", "west", "north"],
    revenue: [100, 80, 70, 120, 90, 60, 110],
    units: [10, 8, 7, 12, 9, 6, 11],
  });

/** Whole dollars. */
const DOLLARS = { style: "currency", currency: "USD", maximumFractionDigits: 0 } as const;

/** What the pointer reads at value `x` of the first panel, its y at the plot's middle. */
const readAt = (model: ChartModel, x: number, mode?: "nearest" | "nearest-x") =>
  model.inspect(xScale(model)!.map(x), 150, mode) as AxisInspection | undefined;

describe("tooltip totals", () => {
  contractTest(
    "inspection.totals",
    () => {
      const model = build({
        marks: [
          line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
        ],
      });
      const reading = readAt(model, start)!;
      expect(reading.points.map((p) => p.value)).toEqual([100, 80, 70]);
      expect(reading.totals).toEqual([
        { mark: 0, markId: undefined, label: "Total", value: 250, text: "250", count: 3 },
      ]);
      // One point read is totalled too.
      expect(readAt(model, start + 2 * DAY)!.totals).toEqual([
        expect.objectContaining({ value: 110, count: 1 }),
      ]);
    },
    "sums the points a reading lists of a mark asking for a total",
  );

  it("is written as the points' values are: their display over the axis' tooltip format", () => {
    const fields: FieldDisplays = { revenue: { format: DOLLARS } };
    const model = build({
      fields,
      marks: [
        line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
      ],
    });
    const reading = readAt(model, start)!;
    expect(reading.points.map((p) => p.text)).toEqual(["$100", "$80", "$70"]);
    expect(reading.totals![0]!.text).toBe("$250");
    // The axis' own tooltip format writes both, over the display's format.
    const told = build({
      fields,
      y: { tooltipFormat: { number: ".1f" } },
      marks: [
        line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
      ],
    });
    const read = readAt(told, start)!;
    expect(read.points[0]!.text).toBe("100.0");
    expect(read.totals![0]!.text).toBe("250.0");
    // A mapping names one value; a sum equal to it is written as a number.
    const mapped = build({
      fields: { revenue: { mappings: [{ value: 250, text: "High" }] } },
      marks: [
        line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
      ],
    });
    expect(readAt(mapped, start)!.totals![0]!.text).toBe("250");
  });

  it("writes several value fields of different displays by the axis' format alone", () => {
    const wide = table({
      day: time([start, start + DAY]),
      revenue: [100, 120],
      units: [10, 12],
    });
    const fields: FieldDisplays = {
      revenue: { format: DOLLARS },
      units: { format: { number: ",d" } },
    };
    const total = { total: true } as const;
    const differ = build({
      fields,
      y: { tooltipFormat: { number: ".1f" } },
      marks: [line(wide, { x: "day", y: ["revenue", "units"], tooltip: total })],
    });
    expect(readAt(differ, start)!.totals![0]).toMatchObject({ value: 110, text: "110.0" });
    // Without a tooltip format, as the axis writes values.
    const plain = build({
      fields,
      marks: [line(wide, { x: "day", y: ["revenue", "units"], tooltip: total })],
    });
    expect(readAt(plain, start)!.totals![0]!.text).toBe("110");
    // Displays that agree write it as they write the points.
    const agree = build({
      fields: { revenue: { format: DOLLARS }, units: { format: DOLLARS } },
      marks: [line(wide, { x: "day", y: ["revenue", "units"], tooltip: total })],
    });
    expect(readAt(agree, start)!.totals![0]!.text).toBe("$110");
  });

  it("takes its own label and number format over both", () => {
    const model = build({
      fields: { revenue: { format: DOLLARS } },
      marks: [
        line(revenue(), {
          x: "day",
          y: "revenue",
          series: "region",
          id: "revenue",
          tooltip: { total: { label: "All regions", format: { number: ",.2f" } } },
        }),
      ],
    });
    expect(readAt(model, start)!.totals).toEqual([
      { mark: 0, markId: "revenue", label: "All regions", value: 250, text: "250.00", count: 3 },
    ]);
  });

  it("refuses a format that does not write numbers as a scene is made with the writers", () => {
    const hours = line(revenue(), {
      x: "day",
      y: "revenue",
      series: "region",
      tooltip: { total: { format: { time: "%H" } as never } },
    });
    build({ marks: [hours] }, false);
    expect(() => build({ marks: [hours] })).toThrow(
      "line tooltip.total.format: totals are numbers; give a number format",
    );
    const dates = line(revenue(), {
      x: "day",
      y: "revenue",
      tooltip: { total: { format: { dateStyle: "short" } as never } },
    });
    expect(() => build({ marks: [dates] })).toThrow("totals are numbers");
  });

  it("leaves out hidden series, series reading nothing there, and missing values", () => {
    const model = build({
      marks: [
        line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
      ],
    });
    model.hidden.add(model.series()[1]!.key);
    model.scene(estimateText);
    expect(readAt(model, start)!.totals![0]).toMatchObject({ value: 170, count: 2 });
    // Only north has a third day.
    expect(readAt(model, start + 2 * DAY)!.totals![0]).toMatchObject({ value: 110, count: 1 });
    const gaps = build({
      marks: [
        line(
          table({
            day: time([start, start, start]),
            region: ["north", "south", "west"],
            revenue: [100, null, 70],
          }),
          { x: "day", y: "revenue", series: "region", tooltip: { total: true } },
        ),
      ],
    });
    expect(readAt(gaps, start)!.totals![0]).toMatchObject({ value: 170, count: 2 });
    // Every series hidden: no point, no total.
    for (const s of model.series()) model.hidden.add(s.key);
    model.scene(estimateText);
    expect(readAt(model, start)).toBeUndefined();
  });

  it("writes a sum of zeros as 0, and shows no total for a sum past what numbers hold", () => {
    const zeros = build({
      marks: [
        line(table({ x: [1, 1, 2], s: ["a", "b", "a"], v: [0, -0, 3] }), {
          x: "x",
          y: "v",
          series: "s",
          tooltip: { total: true },
        }),
      ],
    });
    const [total] = readAt(zeros, 1)!.totals!;
    expect(Object.is(total!.value, 0)).toBe(true);
    expect(total!.text).toBe("0");
    const huge = build({
      marks: [
        line(table({ x: [1, 1, 2], s: ["a", "b", "a"], v: [1e308, 1e308, 1] }), {
          x: "x",
          y: "v",
          series: "s",
          tooltip: { total: true },
        }),
      ],
    });
    const reading = readAt(huge, 1)!;
    expect(reading.points).toHaveLength(2);
    expect(reading.totals).toBeUndefined();
  });

  it("totals a stack by its layers' own values, a normalized one by its raw values", () => {
    const layers = () =>
      table({
        day: time([start, start, start]),
        region: ["north", "south", "west"],
        revenue: [100, 80, 70],
      });
    const total = { total: true } as const;
    for (const make of [
      () =>
        area(layers(), { x: "day", y: "revenue", series: "region", stack: true, tooltip: total }),
      () =>
        bar(layers(), { x: "day", y: "revenue", series: "region", stack: true, tooltip: total }),
    ]) {
      const model = build({ marks: [make()] });
      expect(readAt(model, start)!.totals![0]).toMatchObject({ value: 250, text: "250" });
    }
    // Shares on the axis, the raw values summed and written as raw values are.
    for (const stack of ["fill", { offset: "fill" }] as const) {
      const model = build({
        y: { format: { number: ".0%" } },
        marks: [
          area(layers(), { x: "day", y: "revenue", series: "region", stack, tooltip: total }),
        ],
      });
      const reading = readAt(model, start)!;
      expect(reading.points[0]!.text).toBe("40% share (100 raw)");
      expect(reading.totals![0]).toMatchObject({ value: 250, text: "250" });
    }
    // A signed stack's net sum.
    const signed = build({
      marks: [
        bar(table({ x: ["a", "a"], s: ["in", "out"], v: [40, -40] }), {
          x: "x",
          y: "v",
          series: "s",
          stack: true,
          tooltip: total,
        }),
      ],
    });
    expect(readAt(signed, 0)!.totals![0]).toMatchObject({ value: 0, text: "0", count: 2 });
  });

  it('sums every point listed under snap: "each", wherever each stands', () => {
    const offset = table({
      t: [0, 10, 3, 13, 6],
      s: ["a", "a", "b", "b", "c"],
      v: [1, 2, 10, 20, 100],
    });
    const model = build({
      inspection: { mode: "nearest-x", snap: "each" },
      marks: [line(offset, { x: "t", y: "v", series: "s", tooltip: { total: true } })],
    });
    // At 4: a's 0, b's 3, c's 6.
    const reading = readAt(model, 4)!;
    expect(reading.points.map((p) => p.value)).toEqual([1, 10, 100]);
    expect(reading.totals![0]).toMatchObject({ value: 111, count: 3 });
    // At 12: a's 10, b's 13, c's 6 (its only point).
    expect(readAt(model, 12)!.totals![0]).toMatchObject({ value: 122, count: 3 });
    // Shared snapping reads only the series at the nearest value any has.
    const shared = build({
      marks: [line(offset, { x: "t", y: "v", series: "s", tooltip: { total: true } })],
    });
    expect(readAt(shared, 4)!.totals![0]).toMatchObject({ value: 10, count: 1 });
  });

  it("totals each mark asking for one after its own points, and none in nearest mode", () => {
    const model = build({
      marks: [
        line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
        line(revenue(), { x: "day", y: "units", series: "region" }),
        bar(revenue(), {
          x: "day",
          y: "units",
          series: "region",
          tooltip: { total: { label: "Units" } },
        }),
      ],
    });
    const reading = readAt(model, start)!;
    expect(reading.points.map((p) => p.mark)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2]);
    expect(reading.totals!.map(({ mark, label, value }) => [mark, label, value])).toEqual([
      [0, "Total", 250],
      [2, "Units", 25],
    ]);
    // "nearest" reads one point, which has no total.
    expect(readAt(model, start, "nearest")!.points).toHaveLength(1);
    expect(readAt(model, start, "nearest")!.totals).toBeUndefined();
    const nearest = build({
      inspection: { mode: "nearest" },
      marks: [
        line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
      ],
    });
    const scale = xScale(nearest)!;
    const y = nearest.inspectorOf(nearest.panels()[0]!.key)!.frame.y;
    const one = nearest.inspect(scale.map(start), y.map(100))!;
    expect(one.points).toHaveLength(1);
    expect((one as AxisInspection).totals).toBeUndefined();
    // Charts that ask for none carry none.
    const none = build({ marks: [line(revenue(), { x: "day", y: "revenue", series: "region" })] });
    expect("totals" in readAt(none, start)!).toBe(false);
  });

  it("totals bars and lines along y by their x values", () => {
    const sales = table({ region: ["north", "south"], q1: [10, 20], q2: [5, 6] });
    const model = build({
      marks: [bar(sales, { y: "region", x: ["q1", "q2"], tooltip: { total: true } })],
    });
    const y = model.inspectorOf(model.panels()[0]!.key)!.frame.y;
    const reading = model.inspect(300, y.map(0), "nearest-y") as AxisInspection;
    expect(reading.totals![0]).toMatchObject({ value: 15, count: 2 });
  });

  it("are written only once the chart has what writes them", () => {
    const marks = [
      line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
    ];
    const model = build({ marks }, false);
    expect(model.lacks()[3]).toBe(true);
    expect(readAt(model, start)!.totals).toBeUndefined();
    model.use([undefined, undefined, undefined, tooltipWriters]);
    model.scene(estimateText);
    expect(readAt(model, start)!.totals![0]!.value).toBe(250);
  });

  it("follow the points the keyboard's cursor reads", () => {
    const readers = { placeAt, rowOf };
    const model = build({
      marks: [
        line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
      ],
    });
    const [first] = model.series();
    const read = inspectPosition(model, first!.key, 0, undefined, readers)!;
    expect(read.points).toHaveLength(3);
    expect(read.totals![0]).toMatchObject({ value: 250, count: 3 });
    // Under "nearest", the cursor's point alone, and no total.
    const nearest = build({
      inspection: { mode: "nearest" },
      marks: [
        line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
      ],
    });
    const alone = inspectPosition(nearest, nearest.series()[0]!.key, 0, undefined, readers)!;
    expect(alone.points).toHaveLength(1);
    expect(alone.totals).toBeUndefined();
  });

  it("are refused for categories, times, and ranges as a scene is made with the writers", () => {
    const rows = () =>
      table({
        day: time([start, start + DAY]),
        segment: ["a", "b"],
        lo: [1, 2],
        hi: [3, 4],
        v: [5, 6],
      });
    const total = { total: true } as const;
    const refused = (mark: ChartConfig["marks"][number]) => {
      // The marks only detect a total: a chart draws without the writers, which refuse it.
      build({ marks: [mark] }, false);
      return () => build({ marks: [mark] });
    };
    expect(refused(point(rows(), { x: "v", y: "segment", tooltip: total }))).toThrow(
      'point tooltip.total: y "segment" is a category field, whose points have no sum; drop total',
    );
    expect(refused(point(rows(), { x: "v", y: "day", tooltip: total }))).toThrow(
      'point tooltip.total: y "day" is a time field, whose points have no sum; drop total',
    );
    expect(refused(line(rows(), { x: "v", y: "day", tooltip: total }))).toThrow(
      'line tooltip.total: y "day" is a time field, whose points have no sum; drop total',
    );
    expect(refused(bar(rows(), { y: "segment", x: "day", tooltip: total }))).toThrow(
      'bar tooltip.total: x "day" is a time field, whose points have no sum; drop total',
    );
    // Only JavaScript can give a band one: the types and specs refuse it.
    const ranges = "its points are ranges, which have no total; drop total";
    expect(
      refused(area(rows(), { x: "day", y1: "lo", y2: "hi", tooltip: total as never })),
    ).toThrow(`area tooltip.total: ${ranges}`);
    expect(
      refused(area(rows(), { y: "day", x1: "lo", x2: "hi", tooltip: total as never })),
    ).toThrow(`area tooltip.total: ${ranges}`);
    expect(
      refused(custom(rows(), { x: ["lo", "hi"], y: "v", tooltip: total, draw: () => {} })),
    ).toThrow(`custom tooltip.total: ${ranges}`);
    // Several y fields are several series, which total.
    expect(
      refused(custom(rows(), { x: "day", y: ["lo", "hi"], tooltip: total, draw: () => {} })),
    ).not.toThrow();
  });
});

describe("tooltip totals in specs", () => {
  const spec = (mark: object): ChartSpec =>
    ({
      data: {
        d: {
          columns: {
            t: { type: "time", values: ["2026-01-19", "2026-01-19", "2026-01-20"] },
            k: ["a", "b", "a"],
            v: [1, 2, 3],
            lo: [0, 1, 2],
          },
        },
      },
      marks: [{ data: "d", ...mark }],
    }) as unknown as ChartSpec;
  const refusal = (mark: object) => {
    try {
      loadSpec(spec(mark));
    } catch (error) {
      return (error as Error).message;
    }
    return undefined;
  };

  it("total as the types do", () => {
    const { config } = loadSpec(
      spec({ type: "line", x: "t", y: "v", series: "k", tooltip: { total: { label: "All" } } }),
    );
    const model = build(config);
    expect(readAt(model, Date.UTC(2026, 0, 19))!.totals).toEqual([
      { mark: 0, markId: undefined, label: "All", value: 3, text: "3", count: 2 },
    ]);
  });

  it("are refused with the types' and the run time's reasons", () => {
    const line = { type: "line", x: "t", y: "v" };
    expect(refusal({ ...line, tooltip: { total: { format: { time: "%H" } } } })).toBe(
      "marks[0].tooltip.total.format: totals are numbers; give a number format",
    );
    expect(refusal({ ...line, tooltip: { total: { format: { dateStyle: "short" } } } })).toBe(
      "marks[0].tooltip.total.format: totals are numbers; give a number format",
    );
    expect(refusal({ ...line, tooltip: { total: false } })).toBe(
      "marks[0].tooltip.total: expected true, or { label, format }; received false",
    );
    expect(refusal({ ...line, tooltip: { total: { label: 3 } } })).toBe(
      "marks[0].tooltip.total.label: expected a string; received 3",
    );
    expect(refusal({ type: "pie", category: "k", value: "v", tooltip: { total: true } })).toBe(
      "marks[0].tooltip.total: only lines, filled areas, bars, and points total their points; drop total",
    );
    expect(refusal({ type: "area", x: "t", y1: "lo", y2: "v", tooltip: { total: true } })).toBe(
      "marks[0].tooltip.total: a band's points are ranges, which have no total; drop total",
    );
    expect(refusal({ type: "histogram", x: "v", tooltip: { total: true } })).toBe(
      "marks[0].tooltip.total: a histogram's bins count rows, and its tooltips write each summary as it is; drop total",
    );
    // Categories and times, as the run time refuses them.
    const built = (mark: object) => () => build(loadSpec(spec(mark)).config);
    expect(built({ type: "point", x: "v", y: "k", tooltip: { total: true } })).toThrow(
      'point tooltip.total: y "k" is a category field, whose points have no sum; drop total',
    );
    expect(built({ type: "line", x: "v", y: "t", tooltip: { total: true } })).toThrow(
      'line tooltip.total: y "t" is a time field, whose points have no sum; drop total',
    );
  });
});
