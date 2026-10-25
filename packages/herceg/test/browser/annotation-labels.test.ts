// Annotations' labels stay inside the plot: a region's in a band thinner
// than itself, a rule's at the plot's edge (across the rule), in plain
// text and in styles of their own, live and in static SVG alike.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { Rect } from "../../src/scene/scene.ts";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});
afterEach(() => host.remove());

const data = table({ t: [0, 10], v: [0, 100] });

function mount(marks: ChartOptions["marks"]): Chart {
  const chart = createChart(host, {
    locale: "en-US",
    renderer: "svg",
    marks: [line(data, { x: "t", y: "v" }), ...marks],
    x: { domain: [0, 10] },
    y: { domain: [0, 100] },
  });
  chart.render();
  return chart;
}

/** The drawn box of the chart's text reading `label`, in the chart's pixels. */
function boxOf(chart: Chart, label: string): Rect {
  const text = [...chart.root.querySelectorAll<SVGTextElement>("svg text")].find(
    (t) => t.textContent === label,
  );
  expect(text, `a text "${label}"`).toBeDefined();
  const svg = text!.ownerSVGElement!.getBoundingClientRect();
  const drawn = text!.getBoundingClientRect();
  const root = chart.root.getBoundingClientRect();
  expect(svg.left).toBe(root.left);
  return {
    x: drawn.left - root.left,
    y: drawn.top - root.top,
    width: drawn.width,
    height: drawn.height,
  };
}

function expectInPlot(chart: Chart, label: string): Rect {
  const { plot } = chart.getPanels()[0]!;
  const box = boxOf(chart, label);
  // The line's box is inside; its glyphs, as engines measure them, may reach a pixel or so past it.
  expect(box.x).toBeGreaterThanOrEqual(plot.x - 2);
  expect(box.y).toBeGreaterThanOrEqual(plot.y - 2);
  expect(box.x + box.width).toBeLessThanOrEqual(plot.x + plot.width + 2);
  expect(box.y + box.height).toBeLessThanOrEqual(plot.y + plot.height + 2);
  return box;
}

/** The x and anchor static SVG writes `label` at. */
function writtenAt(svg: string, label: string): { x: number; y: number; anchor: string } {
  const found = new RegExp(
    `<text x="([-\\d.]+)" y="([-\\d.]+)" text-anchor="(\\w+)"[^>]*>${label}<`,
  ).exec(svg);
  expect(found, `static SVG writes "${label}"`).not.toBeNull();
  return { x: Number(found![1]), y: Number(found![2]), anchor: found![3]! };
}

describe("annotation labels", () => {
  it("of a region thinner than its label at the plot's bottom stay above the plot's bottom", () => {
    const chart = mount([region({ y1: 0, y2: 1, label: "thin" })]);
    expectInPlot(chart, "thin");
    chart.destroy();
  });

  it("of a vertical rule at the plot's right edge go left of the rule, in every output", () => {
    const chart = mount([rule({ x: 9.9, label: "six" })]);
    const box = expectInPlot(chart, "six");
    const x = chart.toPixel(9.9, { axis: "x" })!;
    expect(box.x + box.width).toBeLessThanOrEqual(x);
    // Static SVG, which PNG and PDF share the place of, writes it where the live chart draws it.
    const live = chart.root.querySelector("svg text[text-anchor]")!;
    const at = writtenAt(renderToSVG(chart), "six");
    expect(at.anchor).toBe(live.getAttribute("text-anchor"));
    expect(at.x).toBeCloseTo(Number(live.getAttribute("x")), 1);
    chart.destroy();
  });

  it("of a horizontal rule at the plot's top go below the rule", () => {
    const chart = mount([rule({ y: 100, label: "ceiling" })]);
    const box = expectInPlot(chart, "ceiling");
    expect(box.y).toBeGreaterThanOrEqual(chart.toPixel(100, { axis: "y" })!);
    chart.destroy();
  });

  it("in a style of their own stay inside the plot too, unless placed outside it", () => {
    const style = { fontSize: 14, fontWeight: 700 };
    const chart = mount([
      rule({ x: 9.9, label: { text: "bold", style } }),
      region({ x1: 0, x2: 10, y1: 0, y2: 1, label: { text: "low", style } }),
      rule({ y: 50, label: { text: "beside", place: { outside: true, attachment: "end" } } }),
    ]);
    expectInPlot(chart, "bold");
    expectInPlot(chart, "low");
    const { plot } = chart.getPanels()[0]!;
    expect(boxOf(chart, "beside").x).toBeGreaterThan(plot.x + plot.width);
    chart.destroy();
  });
});
