// Display colors in live charts: bars by step, the legend's key of the
// steps, and rules at thresholds, drawn as static output draws them, in
// SVG and on canvas.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { bar } from "../../src/marks/bar.ts";
import { rule } from "../../src/marks/rule.ts";
import { renderToSVG } from "../../src/render/static.ts";

let host: HTMLDivElement;
const charts: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  host.remove();
});

const options = (): ChartOptions => ({
  locale: "en-US",
  fields: {
    p99: {
      format: { duration: "millisecond" },
      thresholds: {
        base: "#2e7d32",
        steps: [
          { value: 200, color: "#f9a825" },
          { value: 500, color: "#c62828" },
        ],
      },
    },
  },
  marks: [
    bar(table({ service: category(["auth", "cart", "edge"]), p99: [120, 320, 640] }), {
      x: "service",
      y: "p99",
      encode: { color: { field: "p99" } },
    }),
    rule({ y: { thresholds: "p99" }, id: "slo" }),
  ],
});

const texts = (root: Element) =>
  [...root.querySelectorAll("svg text")].map((text) => text.textContent).filter(Boolean);

describe("display colors in live charts", () => {
  for (const renderer of ["svg", "canvas"] as const)
    it(`color bars by step, list the steps' key, and draw rules at the steps (${renderer})`, async () => {
      const chart = createChart(host, { ...options(), renderer });
      charts.push(chart);
      await chart.loading;
      chart.render();
      // The key, as static output writes it.
      const key = ["< 200ms", "200ms – 500ms", "≥ 500ms"];
      expect(texts(chart.root)).toEqual(expect.arrayContaining(key));
      const svg = renderToSVG({ ...options(), width: 600, height: 300 });
      const drawn = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
      expect(texts(drawn)).toEqual(expect.arrayContaining(key));
      // Bars and rules in their steps' colors.
      for (const color of ["#2e7d32", "#f9a825", "#c62828"]) expect(svg).toContain(color);
    });
});
