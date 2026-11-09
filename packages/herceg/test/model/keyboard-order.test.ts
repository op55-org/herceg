import { describe, expect, it } from "vitest";
import type { ColumnInput } from "../../src/data/column.ts";
import { type Table, table as typed } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { placeAt, rowOf } from "../../src/marks/series.ts";
import { orderAt } from "../../src/model/keyboard.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { readKeys } from "../helpers/keyboard.ts";

const table = (columns: Record<string, ColumnInput>): Table => typed(columns) as unknown as Table;

const samples = table({
  x: [0, 1, 2, 3, 4, 5],
  y: [2, 4, 3, 20, 40, 30],
  category: ["a", "b", "c", "a", "b", "c"],
  kind: ["k", "m", "k", "m", "k", "m"],
});

function drawn(config: ChartConfig): ChartModel {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config });
  model.setSize(600, 400, 1);
  model.scene(estimateText);
  return model;
}

describe("the arrow keys", () => {
  it("step through a category axis band by band, whatever the rows' order", () => {
    const model = drawn({
      marks: [bar(samples, { x: "category", y: "y", series: "kind", stack: true })],
    });
    expect(readKeys(model, ["ArrowRight", "ArrowRight", "ArrowRight", "ArrowLeft"])).toEqual([
      "a. k: 2. m: 20",
      "b. k: 40. m: 4",
      "c. k: 3. m: 30",
      "b. k: 40. m: 4",
    ]);
    expect(readKeys(model, ["End", "Home"])).toEqual(["c. k: 3. m: 30", "a. k: 2. m: 20"]);
  });

  it("step from series to series of a mark whose series are its axis' categories", () => {
    const model = drawn({ marks: [boxplot(samples, { x: "kind", y: "y", series: "kind" })] });
    const [k, m] = readKeys(model, ["ArrowRight", "ArrowRight", "ArrowLeft"]);
    expect(k).toMatch(/^k\. k: median 3,/);
    expect(m).toMatch(/^m\. m: median 20,/);
    expect(readKeys(model, ["ArrowRight", "ArrowRight", "ArrowLeft"])[2]).toBe(k);
    // Bars colored by their x stand side by side too, the x written either way.
    for (const x of ["category", { field: "category" }] as const) {
      const colored = drawn({ marks: [bar(samples, { x, y: "y", color: "category" })] });
      const keys = ["ArrowRight", "ArrowRight", "ArrowRight"];
      expect(readKeys(colored, keys).map((s) => s[0])).toEqual(["a", "a", "b"]);
    }
  });

  it("read a sparse grid as heatmaps are read: from its top row's first cell, row by row", () => {
    const model = drawn({
      marks: [histogram(samples, { x: "x", y: "y", bins: { x: [0, 3, 6], y: [0, 25, 50] } })],
    });
    // The top row's one cell is in the last column: Right stays, Left
    // finds the nearest cell behind it in another row.
    expect(readKeys(model, ["ArrowRight", "ArrowRight", "ArrowLeft", "ArrowRight"])).toEqual([
      "4.5. x 3 – 6, y 25 – 50: 2",
      "4.5. x 3 – 6, y 25 – 50: 2",
      "1.5. x 0 – 3, y 0 – 25: 3",
      "4.5. x 3 – 6, y 0 – 25: 1",
    ]);
  });
});

describe("Up and Down", () => {
  /**
   * The order Up and Down visit the first panel's series in at `x`, from a
   * cursor at `y` (both in data values): each series' label, with the value
   * of its point the cursor lands on.
   */
  function order(model: ChartModel, x: number, y: number): string[] {
    const panel = model.panels()[0]!;
    const visits = orderAt(model, panel.key, "x", panel.x.map(x), panel.y.map(y), {
      placeAt,
      rowOf,
    });
    return visits.map(({ key, position }) => {
      const s = model.series().find((part) => part.key === key)!;
      return `${s.label} ${s.y[rowOf(s, position)]}`;
    });
  }

  it("visit series in screen order at the place, top first, each at its point nearest there", () => {
    const lines = table({ x: [0, 4, 8], a: [10, 40, 25], b: [30, 5, 35], c: [20, 20, 20] });
    const model = drawn({ marks: [line(lines, { x: "x", y: ["a", "b", "c"] })] });
    expect(order(model, 0, 0)).toEqual(["b 30", "c 20", "a 10"]);
    expect(order(model, 4, 0)).toEqual(["a 40", "c 20", "b 5"]);
    // Between points, by where the paths cross the place: at 1.5, a at
    // 21.25 and b at 20.63 over c; each at its point at 0, the nearest.
    expect(order(model, 1.5, 0)).toEqual(["a 10", "b 30", "c 20"]);
  });

  it("place a path crossing the place more than once where it crosses nearest the cursor", () => {
    const folded = table({ x: [0, 10, 10, 0], y: [30, 30, 0, 0] });
    const flat = table({ x: [0, 10], y: [20, 20] });
    const model = drawn({
      marks: [
        line(folded, { x: "x", y: "y", label: "A" }),
        line(flat, { x: "x", y: "y", label: "B" }),
      ],
    });
    // From the top, A crosses at 30, above B; from the bottom, at 0, below.
    expect(order(model, 0, 30)).toEqual(["A 30", "B 20"]);
    expect(order(model, 0, 0)).toEqual(["B 20", "A 0"]);
    // As near one crossing as the other: the first drawn.
    expect(order(model, 0, 15)).toEqual(["A 30", "B 20"]);
  });

  it("keep series at one height in series order", () => {
    const tied = table({ x: [0, 10], a: [10, 20], b: [10, 5], c: [30, 30] });
    expect(order(drawn({ marks: [line(tied, { x: "x", y: ["a", "b", "c"] })] }), 0, 0)).toEqual([
      "c 30",
      "a 10",
      "b 10",
    ]);
    expect(order(drawn({ marks: [line(tied, { x: "x", y: ["b", "a", "c"] })] }), 0, 0)).toEqual([
      "c 30",
      "b 10",
      "a 10",
    ]);
    // A jump at a repeated position spans the cursor's height: it is drawn there.
    const jump = table({ x: [0, 5, 5, 10], a: [10, 10, 50, 50], b: [35, 35, 35, 35] });
    const model = drawn({ marks: [line(jump, { x: "x", y: ["a", "b"] })] });
    expect(order(model, 5, 35)).toEqual(["a 50", "b 35"]);
  });

  it("leave out series of marks the inspection skips, and points not drawn", () => {
    const rows = table({ x: [0, 1, 2], a: [10, 20, 30], b: [40, 50, 60], c: [5, 5, Number.NaN] });
    const model = drawn({
      marks: [
        line(rows, { x: "x", y: "a" }),
        line(rows, { x: "x", y: "b", inspect: false }),
        point(rows, { x: "x", y: "c" }),
      ],
    });
    expect(order(model, 0, 0)).toEqual(["a 10", "c 5"]);
    // c's point at 2 is not drawn: its nearest drawn point stands for it.
    expect(order(model, 2, 0)).toEqual(["a 30", "c 5"]);
  });
});
