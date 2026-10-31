// Which observations lines connect (`continuity`, `where`), decided before
// they are reduced: runs of connected observations, traced one by one.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import type { Polyline } from "../../src/lod/polyline.ts";
import { area } from "../../src/marks/area.ts";
import { line } from "../../src/marks/line.ts";
import { describeChart } from "../../src/model/describe.ts";
import { facet } from "../../src/model/facet.ts";
import { type AxisInspection, type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import type { AreaGeometry, LineGeometry } from "../../src/scene/scene.ts";

function build(config: ChartConfig, width = 600) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(width, 300, 1);
  return { model, scene: model.scene(estimateText) };
}

const pathOf = (config: ChartConfig, width?: number) =>
  (build(config, width).scene.panels[0]!.marks[0] as LineGeometry).path;

/** Each run's points, as [x, y] pairs in pixels. */
function runs(path: Polyline): [number, number][][] {
  return path.starts.map((start, r) =>
    Array.from({ length: path.runEnd(r) - start }, (_, i) => [
      path.coords[(start + i) * 2]!,
      path.coords[(start + i) * 2 + 1]!,
    ]),
  );
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe("continuity", () => {
  const hours = Array.from({ length: 72 }, (_, i) => i * HOUR);
  const hourly = table({ t: time(hours), v: hours.map((_, i) => i % 7) });

  it("breaks lines at calendar boundaries in the chart's time zone", () => {
    const { model, scene } = build({
      marks: [line(hourly, { x: "t", y: "v", continuity: { breakBy: "day" } })],
    });
    const path = (scene.panels[0]!.marks[0] as LineGeometry).path;
    expect(path.starts.length).toBe(3);
    // Each day's line ends at its last hour and the next starts at midnight.
    const x = model.xScale()!;
    expect(runs(path).map((run) => [x.invert(run[0]![0]), x.invert(run.at(-1)![0])])).toEqual(
      [0, 1, 2].map((d) => [expect.closeTo(d * DAY, -3), expect.closeTo(d * DAY + 23 * HOUR, -3)]),
    );
    // In another zone the boundaries move.
    const shifted = build({
      timeZone: "Asia/Kolkata",
      marks: [line(hourly, { x: "t", y: "v", continuity: { breakBy: "day" } })],
    });
    expect((shifted.scene.panels[0]!.marks[0] as LineGeometry).path.starts.length).toBe(4);
  });

  it("breaks lines where neighbors are more than maxGap apart, or a field changes", () => {
    const gappy = table({ t: time([0, HOUR, 2 * HOUR, 5 * HOUR, 6 * HOUR]), v: [1, 2, 3, 4, 5] });
    expect(
      pathOf({
        marks: [line(gappy, { x: "t", y: "v", continuity: { maxGap: { milliseconds: HOUR } } })],
      }).starts,
    ).toEqual([0, 3]);
    expect(
      pathOf({ marks: [line(gappy, { x: "t", y: "v", continuity: { maxGap: 2 * HOUR } })] }).starts,
    ).toEqual([0, 3]);
    const sessions = table({ t: [0, 1, 2, 3], v: [1, 2, 3, 4], s: ["a", "a", "b", "b"] });
    expect(
      pathOf({
        marks: [line(sessions, { x: "t", y: "v", continuity: { breakBy: { field: "s" } } })],
      }).starts,
    ).toEqual([0, 2]);
  });

  it("never bridges a break while reducing a dense line", () => {
    const n = 200_000;
    const t = Float64Array.from({ length: n }, (_, i) => i * 60_000);
    const dense = table({ t: time(t), v: Float64Array.from(t, (_, i) => Math.sin(i / 1000)) });
    const { model, scene } = build({
      marks: [line(dense, { x: "t", y: "v", continuity: { breakBy: "day" } })],
    });
    const path = (scene.panels[0]!.marks[0] as LineGeometry).path;
    const days = Math.ceil((n * 60_000) / DAY);
    expect(path.starts.length).toBe(days);
    expect(path.count).toBeLessThan(n / 20);
    const x = model.xScale()!;
    for (const run of runs(path)) {
      const day = Math.floor(x.invert(run[0]![0]) / DAY + 1e-6);
      for (const [px] of run) expect(Math.floor(x.invert(px) / DAY + 1e-6)).toBe(day);
    }
  });

  it("leaves out rows `defined` rejects: not drawn, inspected, described, or in the y domain", () => {
    const t = table({ t: [0, 1, 2, 3, 4], v: [1, 2, 50, 3, 4], ok: [1, 1, 0, 1, 1] });
    const { model, scene } = build({
      marks: [line(t, { x: "t", y: "v", continuity: { defined: col("ok").eq(1) } })],
    });
    expect((scene.panels[0]!.marks[0] as LineGeometry).path.starts).toEqual([0, 2]);
    expect(model.yScale()!.domain[1]).toBeLessThan(50);
    const x = model.xScale()!;
    // Inside the gap the rejected row leaves, the line reads nothing; beside it, its own points.
    const y = scene.panels[0]!.plot.y + 5;
    expect(model.inspect(x.map(2), y)).toBeUndefined();
    const at = model.inspect(x.map(0.8), y) as AxisInspection;
    expect(at.points.map((p) => p.value)).toEqual([2]);
    expect(describeChart(model)).toContain("v: 4 points, from 1 to 4, last 4.");
  });

  it("refuses what it cannot do: calendar breaks of numbers, elapsed gaps of numbers", () => {
    const numbers = table({ t: [0, 1], v: [1, 2] });
    expect(() =>
      build({ marks: [line(numbers, { x: "t", y: "v", continuity: { breakBy: "day" } })] }),
    ).toThrow(
      'line (mark 0) continuity.breakBy: "day" breaks times; the positions hold number values',
    );
    expect(() =>
      build({
        marks: [line(numbers, { x: "t", y: "v", continuity: { maxGap: { milliseconds: 5 } } })],
      }),
    ).toThrow("line (mark 0) continuity.maxGap: { milliseconds } is a time");
    expect(() =>
      build({
        marks: [line(numbers, { x: "t", y: "v", continuity: { connect: true } as never })],
      }),
    ).toThrow("line (mark 0) continuity.connect: not supported");
  });
});

describe("where", () => {
  // efficiency crosses the limit (1) between t = 1 and 2, and back between 3 and 4.
  const runs3 = table({ t: [0, 1, 2, 3, 4], e: [0, 0.5, 1.5, 1.5, 0.5], limit: [1, 1, 1, 1, 1] });

  it("leaves rows out as gaps, meeting the condition where it changes on linear curves", () => {
    const { model, scene } = build({
      marks: [line(runs3, { x: "t", y: "e", where: col("e").lt(col("limit")) })],
    });
    const path = (scene.panels[0]!.marks[0] as LineGeometry).path;
    const x = model.xScale()!;
    const y = model.yScale()!;
    const [first, second] = runs(path);
    // The first run ends where e reaches 1: halfway from t = 1 to 2.
    expect(x.invert(first!.at(-1)![0])).toBeCloseTo(1.5, 6);
    expect(y.invert(first!.at(-1)![1])).toBeCloseTo(1, 6);
    // The second starts where it falls back to 1.
    expect(x.invert(second![0]![0])).toBeCloseTo(3.5, 6);
    expect(first!.length).toBe(3);
  });

  it("ends steps where the interval each row owns ends", () => {
    const at = (curve: "step-after" | "step-before" | "step") => {
      const { model, scene } = build({
        marks: [line(runs3, { x: "t", y: "e", curve, where: col("e").lt(col("limit")) })],
      });
      const x = model.xScale()!;
      return runs((scene.panels[0]!.marks[0] as LineGeometry).path).map((run) => [
        x.invert(run[0]![0]),
        x.invert(run.at(-1)![0]),
      ]);
    };
    // Row 1 owns [1, 2) after, row 4 owns [4, ...): the band runs 0..2 and 4.
    expect(at("step-after")).toEqual([
      [expect.closeTo(0, 6), expect.closeTo(2, 6)],
      [expect.closeTo(4, 6), expect.closeTo(4, 6)],
    ]);
    // Before: row 4 owns (3, 4].
    expect(at("step-before")).toEqual([
      [expect.closeTo(0, 6), expect.closeTo(1, 6)],
      [expect.closeTo(3, 6), expect.closeTo(4, 6)],
    ]);
    // Steps at midpoints.
    expect(at("step")).toEqual([
      [expect.closeTo(0, 6), expect.closeTo(1.5, 6)],
      [expect.closeTo(3.5, 6), expect.closeTo(4, 6)],
    ]);
  });

  it("ends centered steps where they step, in time a break leaves out", () => {
    // Collapsed, the rows stand 0 and 6 hours apart: the step is at hour 3
    // of drawn time, 7 of the clock, not at the clock's midpoint (5, which
    // the break leaves out).
    const data = table({ t: time([0, 10 * HOUR, 20 * HOUR]), e: [0, 10, 0], limit: [5, 5, 5] });
    const { model, scene } = build({
      x: { breaks: timeBreaks([{ from: 2 * HOUR, to: 6 * HOUR }]) },
      marks: [line(data, { x: "t", y: "e", curve: "step", where: col("e").lt(col("limit")) })],
    });
    const [first] = runs((scene.panels[0]!.marks[0] as LineGeometry).path);
    expect(model.xScale()!.invert(first!.at(-1)![0])).toBeCloseTo(7 * HOUR, -3);
  });

  it("meet a condition at a row a break hides at the break's seam", () => {
    // Row 1 (t = 4, v = 4) meets each condition itself; the break hides it,
    // so its crossing at the seam is where the line starts (>=) or ends (<=).
    const data = table({ t: time([0, 4, 8, 10]), v: [0, 4, 8, 10], lo: [-2, 2, 6, 8] });
    for (const field of ["t", "v"] as const)
      for (const op of ["ge", "le"] as const) {
        const where = col(field)[op](4);
        for (const mark of [
          line(data, { x: "t", y: "v", where }),
          area(data, { x: "t", y: "v", where }),
          area(data, { x: "t", y1: "lo", y2: "v", where }),
        ]) {
          const { model, scene } = build({
            x: { domain: [0, 10], nice: false, breaks: timeBreaks([{ from: 2, to: 6 }]) },
            y: { domain: [-2, 10], nice: false },
            marks: [mark],
          });
          const g = scene.panels[0]!.marks[0] as LineGeometry | AreaGeometry;
          const [run] = runs(g.kind === "line" ? g.path : g.upper);
          expect(run!.length, `${g.kind} ${field} ${op}`).toBe(op === "ge" ? 3 : 2);
          const [x, y] = op === "ge" ? run![0]! : run!.at(-1)!;
          expect(x).toBeCloseTo(model.xScale()!.map(6), 3);
          expect(y).toBeCloseTo(model.yScale()!.map(4), 3);
        }
      }
  });

  it("meet a condition on the segment drawn, where a break of x leaves out values along y", () => {
    // Collapsed, v runs 0 to 6 drawn: v > 8 meets the segment two thirds
    // along, and t > 5 half way, past the break, not at its seam.
    const data = table({ t: [0, 10], v: time([0, 10]), lo: time([-1, 9]) });
    for (const [where, along] of [
      [col("v").gt(8), 2 / 3],
      [col("t").gt(5), 1 / 2],
    ] as const)
      for (const mark of [
        line(data, { y: "t", x: "v", orient: "y", where }),
        area(data, { y: "t", x: "v", orient: "y", where }),
        area(data, { y: "t", x1: "lo", x2: "v", orient: "y", where }),
      ]) {
        const { model, scene } = build({
          x: { domain: [0, 10], nice: false, breaks: timeBreaks([{ from: 2, to: 6 }]) },
          y: { domain: [0, 10], nice: false },
          marks: [mark],
        });
        const g = scene.panels[0]!.marks[0] as LineGeometry | AreaGeometry;
        const [x, y] = runs(g.kind === "line" ? g.path : g.upper)[0]![0]!;
        const [x0, x1] = [model.xScale()!.map(0), model.xScale()!.map(10)];
        const [y0, y1] = [model.yScale()!.map(0), model.yScale()!.map(10)];
        expect(x).toBeCloseTo(x0 + along * (x1 - x0), 3);
        expect(y).toBeCloseTo(y0 + along * (y1 - y0), 3);
      }
  });

  it("keep crossings in the values' domain as drawn, where a break of x leaves out values along y", () => {
    // Collapsed, v falls from 6 to 0 drawn: t > 5 meets it at 3 drawn, 7 in time.
    const data = table({ t: [0, 10], v: time([10, 0]), lo: time([9, -1]) });
    const where = col("t").gt(5);
    for (const mark of [
      line(data, { y: "t", x: "v", orient: "y", where }),
      area(data, { y: "t", x: "v", orient: "y", where }),
      area(data, { y: "t", x1: "lo", x2: "v", orient: "y", where }),
    ]) {
      const { model } = build({
        x: { nice: false, breaks: timeBreaks([{ from: 2, to: 6 }]) },
        y: { domain: [0, 10], nice: false },
        marks: [mark],
      });
      expect(model.dataXExtent()![1]).toBeCloseTo(7, 5);
    }
    // A line or area leaves out a row whose value the break hides (t = 4):
    // it is drawn, and its crossing found, from t = 0 to 10 as above.
    const hidden = table({ t: [0, 4, 10], v: time([10, 4, 0]) });
    for (const mark of [
      line(hidden, { y: "t", x: "v", orient: "y", where }),
      area(hidden, { y: "t", x: "v", orient: "y", where }),
    ]) {
      const { model } = build({
        x: { nice: false, breaks: timeBreaks([{ from: 2, to: 6 }]) },
        y: { domain: [0, 10], nice: false },
        marks: [mark],
      });
      expect(model.dataXExtent()![1]).toBeCloseTo(7, 5);
    }
  });

  it("leave out each value field's own rows a break hides along y", () => {
    // Fields a and b share their rows (in band order): a's middle value is
    // in the break, b's is not, and b reaches 100.
    const data = table({ t: ["A", "B", "A"], a: time([10, 0, 4]), b: time([20, 0, 100]) });
    for (const mark of [
      line(data, { orient: "y", y: "t", x: ["a", "b"], continuity: { maxGap: 100 } }),
      area(data, { orient: "y", y: "t", x: ["a", "b"], continuity: { maxGap: 100 } }),
    ]) {
      const { model } = build({
        x: { nice: false, zero: false, breaks: timeBreaks([{ from: 2, to: 6 }]) },
        marks: [mark],
      });
      expect(model.dataXExtent()).toEqual([0, 100]);
    }
  });

  it("reads the rows a streaming window holds, testing appended rows only", () => {
    const stream = table({ t: [0, 1, 2], v: [1, -1, 1] }, { maxRows: 3 });
    const { model } = build({
      marks: [line(stream, { x: "t", y: "v", where: col("v").gt(0) })],
    });
    const drawnRuns = () =>
      (model.scene(estimateText).panels[0]!.marks[0] as LineGeometry).path.starts.length;
    expect(drawnRuns()).toBe(2);
    // The window moves: rows 1..3 hold -1, 1, 1, one run; then 1, 1, -1.
    stream.append({ t: [3], v: [1] });
    expect(drawnRuns()).toBe(1);
    stream.append({ t: [4], v: [-1] });
    expect(drawnRuns()).toBe(1);
    stream.append({ t: [5, 6], v: [5, 5] });
    expect(drawnRuns()).toBe(1);
    expect(model.yScale()!.domain[1]).toBeGreaterThanOrEqual(5);
  });

  it("keep the part of a run in view in the y domain, up to its crossing", () => {
    // From 10 at x = 0 down to the crossing at x = 5; the view [2, 3] sees 6 to 4.
    const fall = table({ x: [0, 10], y: [10, -10] });
    const { model } = build({
      x: { domain: [2, 3] },
      marks: [line(fall, { x: "x", y: "y", where: col("y").gt(0) })],
    });
    const [lo, hi] = model.yScale()!.domain;
    expect(lo).toBeLessThanOrEqual(4);
    expect(hi).toBeGreaterThanOrEqual(6);
    expect(hi).toBeLessThan(10);
  });

  it("reads each copied point's own row in panels that place categories their own way", () => {
    const sales = table({
      region: ["N", "N", "N", "S", "S", "S"],
      month: ["Jan", "Feb", "Mar", "Feb", "Mar", "Apr"],
      v: [1, 2, 3, 4, -5, 6],
    });
    const { scene, model } = build({
      facet: facet("region"),
      x: { scope: "panel" },
      marks: [line(sales, { x: "month", y: "v", where: col("v").gt(0) })],
    });
    const [north, south] = scene.panels.map((panel) => (panel.marks[0] as LineGeometry).path);
    expect(north!.starts).toHaveLength(1);
    expect(north!.count).toBe(3);
    // In S, Mar (row 4, -5) is left out: Feb and Apr each run to where v crosses 0.
    expect(south!.starts).toEqual([0, 2]);
    const zero = model.yScale()!.map(0);
    for (const run of runs(south!))
      expect(run.at(-1)![1] <= zero + 0.5 && run[0]![1] <= zero + 0.5).toBe(true);
  });

  it("keep a step's value at the view's edges in the y domain", () => {
    const fall = table({ x: [0, 10], y: [10, 0] });
    const { model } = build({
      x: { domain: [2, 3] },
      marks: [line(fall, { x: "x", y: "y", curve: "step-after", continuity: { maxGap: 100 } })],
    });
    const [lo, hi] = model.yScale()!.domain;
    expect(hi).toBeGreaterThanOrEqual(10);
    expect(lo).toBeGreaterThan(5);
  });

  it("keep rows it leaves out at a line's ends in the positions' domain", () => {
    // A streaming window's domain stays the window's, whatever its last rows' values.
    const data = table({ t: [0, 1, 2, 3], e: [0.5, 0.5, 2, 2] });
    const { model } = build({ marks: [line(data, { x: "t", y: "e", where: col("e").lt(1) })] });
    expect(model.xScale()!.domain).toEqual([0, 3]);
  });

  it("leave outliers it rejects out of the values' domain along y", () => {
    const casts = table({ depth: [0, 10, 20, 30], temperature: [12, 11, 99, 9] });
    const { model } = build({
      marks: [
        line(casts, {
          x: "temperature",
          y: "depth",
          orient: "y",
          where: col("temperature").lt(50),
        }),
      ],
    });
    // The outlier does not count; the line's crossings at 50 do.
    expect(model.xScale()!.domain[1]).toBe(50);
  });

  it("keep crossings in the values' domain: along y, and of unsorted lines", () => {
    // Along y, the line meets 50 between depths 0 and 10, and 10 and 20.
    const casts = table({ depth: [0, 10, 20], temperature: [10, 100, 10] });
    const cold = col("temperature").lt(50);
    for (const mark of [
      line(casts, { x: "temperature", y: "depth", orient: "y", where: cold }),
      area(casts, { x: "temperature", y: "depth", orient: "y", where: cold }),
    ]) {
      const { model } = build({ marks: [mark] });
      expect(model.xScale()!.domain[1]).toBeGreaterThanOrEqual(50);
    }
    const unsorted = table({ x: [0, 2, 1, 3], v: [10, 30, 10, 30] });
    const { model } = build({
      marks: [line(unsorted, { x: "x", y: "v", where: col("v").lt(20) })],
    });
    expect(model.yScale()!.domain[1]).toBeGreaterThanOrEqual(20);
  });

  it("meet conditions where lines on log scales are drawn", () => {
    // A centered step between 1 and 100 on a log x steps at 10.
    const decades = table({ x: [1, 100], e: [1, 10] });
    const step = build({
      x: { type: "log" },
      marks: [line(decades, { x: "x", y: "e", curve: "step", where: col("e").lt(5) })],
    });
    const [run] = runs((step.scene.panels[0]!.marks[0] as LineGeometry).path);
    expect(step.model.xScale()!.invert(run!.at(-1)![0])).toBeCloseTo(10, 6);
    // A straight line from 1 to 100 on a log y meets 10 half way.
    const rising = table({ x: [0, 1], e: [1, 100] });
    const straight = build({
      y: { type: "log" },
      marks: [line(rising, { x: "x", y: "e", where: col("e").lt(10) })],
    });
    const [first] = runs((straight.scene.panels[0]!.marks[0] as LineGeometry).path);
    const [px, py] = first!.at(-1)!;
    expect(straight.model.xScale()!.invert(px)).toBeCloseTo(0.5, 6);
    expect(straight.model.yScale()!.invert(py)).toBeCloseTo(10, 4);
    // A condition on the positions meets them as x draws them, whatever y's scale.
    const early = table({ x: [1, 100], e: [1, 100] });
    const before = build({
      y: { type: "log" },
      marks: [line(early, { x: "x", y: "e", where: col("x").lt(10) })],
    });
    const [ended] = runs((before.scene.panels[0]!.marks[0] as LineGeometry).path);
    expect(before.model.xScale()!.invert(ended!.at(-1)![0])).toBeCloseTo(10, 4);
    // On a log x, half way along is 10, where the line is at 50.5; y's domain holds it.
    const along = build({
      x: { type: "log" },
      marks: [line(early, { x: "x", y: "e", where: col("x").lt(10) })],
    });
    const [half] = runs((along.scene.panels[0]!.marks[0] as LineGeometry).path);
    expect(along.model.yScale()!.invert(half!.at(-1)![1])).toBeCloseTo(50.5, 4);
    expect(along.model.yScale()!.domain[1]).toBeGreaterThanOrEqual(50.5);
    // So do marks in every panel, on panels' own log axes.
    const repeated = build({
      panels: panels([
        { id: "a", x: { type: "log" } },
        { id: "b", x: { type: "log" } },
      ]),
      marks: [line(early, { x: "x", y: "e", where: col("x").lt(10), panel: "*" })],
    });
    expect(repeated.model.yScale()!.domain[1]).toBeGreaterThanOrEqual(50.5);
    // In a view on log axes, values between observations are between their logs.
    const zoomed = build({
      x: { type: "log", domain: [2, 3] },
      y: { type: "log", nice: false },
      marks: [line(early, { x: "x", y: "e", continuity: { maxGap: 1000 } })],
    });
    const [lo, hi] = zoomed.model.yScale()!.domain;
    expect(lo).toBeCloseTo(2, 6);
    expect(hi).toBeCloseTo(3, 6);
  });

  it("refuses monotone curves", () => {
    expect(() =>
      build({ marks: [line(runs3, { x: "t", y: "e", curve: "monotone", where: col("e").lt(1) })] }),
    ).toThrow("line (mark 0) where: monotone curves cannot meet a condition where it changes");
  });

  it("checks its fields when the compiler compiles it", () => {
    expect(() =>
      build({ marks: [line(runs3, { x: "t", y: "e", where: col("eff").lt(1) })] }),
    ).toThrow('line (mark 0) where: expression: no field "eff"');
  });
});
