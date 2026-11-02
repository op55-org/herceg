// Every mark that draws selections takes its looks from its function's
// options into its spec, as specs and Python give them; annotations,
// contours, and dendrograms, which draw none, refuse them.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import {
  area,
  bar,
  boxen,
  boxplot,
  candlestick,
  errorbar,
  heatmap,
  histogram,
  line,
  point,
  rug,
  violin,
} from "../../src/index.ts";
import { validateSpec } from "../../src/spec/validate.ts";

const rows = table({
  x: [0, 1, 2, 3],
  y: [1, 3, 2, 4],
  y2: [2, 4, 3, 5],
  g: ["a", "a", "b", "b"],
});
const looks = { selected: { stroke: "#111", strokeWidth: 2 }, unselected: { opacity: 0.1 } };

describe("mark functions", () => {
  it("keep a mark's selection looks in its spec", () => {
    const marks = [
      line(rows, { x: "x", y: "y", ...looks }),
      area(rows, { x: "x", y: "y", ...looks }),
      bar(rows, { x: "g", y: "y", ...looks }),
      point(rows, { x: "x", y: "y", ...looks }),
      rug(rows, { x: "x", ...looks }),
      errorbar(rows, { x: "g", y1: "y", y2: "y2", ...looks }),
      candlestick(rows, { x: "x", open: "y", high: "y2", low: "y", close: "y2", ...looks }),
      histogram(rows, { x: "y", ...looks }),
      histogram(rows, { x: "x", y: "y", ...looks }),
      heatmap(rows, { x: "x", y: "g", color: "y", ...looks }),
      boxplot(rows, { x: "g", y: "y", ...looks }),
      boxplot(rows, { x: "g", low: "y", q1: "y", median: "y", q3: "y2", high: "y2", ...looks }),
      boxen(rows, { x: "g", y: "y", ...looks }),
      violin(rows, { x: "g", y: "y", ...looks }),
    ];
    for (const mark of marks) expect(mark.spec).toMatchObject(looks);
  });

  it("whose specs check their looks", () => {
    const spec = (selected: unknown) => ({
      data: { d: { columns: { x: [0, 1], y: [1, 2] } } },
      marks: [{ type: "point", data: "d", x: "x", y: "y", selected }],
    });
    expect(() => validateSpec(spec({ radius: 4, fill: "#c00" }))).not.toThrow();
    expect(() => validateSpec(spec({ radius: -1 }))).toThrow(/marks\[0\]\.selected\.radius/);
    expect(() =>
      validateSpec({ marks: [{ type: "rule", y: 1, selected: { stroke: "#c00" } }] }),
    ).toThrow(/marks\[0\]\.selected/);
    const grid = { data: { d: { columns: { x: [0, 1], y: [0, 1], v: [1, 2] } } } };
    expect(() =>
      validateSpec({
        ...grid,
        marks: [{ type: "contour", data: "d", x: "x", y: "y", color: "v", unselected: {} }],
      }),
    ).toThrow(/marks\[0\]\.unselected/);
  });
});
