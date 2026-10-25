import { describe, expect, it } from "vitest";
import type { ColumnInput } from "../../src/data/column.ts";
import { type Table, table as typed } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { histogram } from "../../src/marks/histogram.ts";
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
