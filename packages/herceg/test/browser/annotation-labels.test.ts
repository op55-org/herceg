// Annotations' labels stay inside the plot: a region's in a band thinner
// than itself, a rule's at the plot's edge (across the rule), in plain
// text and in styles of their own, live and in static SVG alike. Text
// labels stay inside the chart: across their point, else moved in.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
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

describe("text labels", () => {
  /** A4's bar chart: no room past the values, an annotation at the highest bar's top. */
  const annotated = (): ChartOptions => {
    const regions = table({ region: category(["N", "E", "S", "W"]), value: [10, 40, 25, 30] });
    const marked = table({ region: category(["E"]), value: [40], label: ["E: 40"] });
    return {
      locale: "en-US",
      renderer: "svg",
      y: { padding: 0 },
      marks: [
        bar(regions, { x: "region", y: "value" }),
        point(marked, { x: "region", y: "value", color: "#c00", radius: 4, legend: false }),
        text(marked, {
          x: "region",
          y: { field: "value", offset: -14 },
          label: { field: "label", style: { color: "#c00" } },
        }),
      ],
    };
  };
  /**
   * Where the chart laid out the text reading `label`: its line's box, as
   * wide as the page's measurer says (what the chart lays out by: engines'
   * glyph boxes reach a few pixels past it in Firefox), from its anchor and
   * its middle as written.
   */
  const laidOut = (chart: Chart, label: string): Rect => {
    const element = [...chart.root.querySelectorAll<SVGTextElement>("svg text")].find(
      (t) => t.textContent === label,
    );
    expect(element, `a text "${label}"`).toBeDefined();
    const style = getComputedStyle(element!);
    const width = measurer(document)(
      label,
      `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
    );
    const size = Number.parseFloat(style.fontSize);
    const share = style.textAnchor === "middle" ? 0.5 : style.textAnchor === "end" ? 1 : 0;
    const x = Number(element!.getAttribute("x")) - share * width;
    const y = Number(element!.getAttribute("y"));
    return { x, y: y - size * 0.6, width, height: size * 1.2 };
  };
  /** Expects `box` inside the chart, to a pixel's rounding of its line's height. */
  const expectInChart = (chart: Chart, box: Rect) => {
    const { width, height } = chart.root.getBoundingClientRect();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(height + 1);
  };
  /** The live chart's SVG and static SVG from its options, its fonts measuring both, without ids. */
  const svgs = (chart: Chart, options: ChartOptions) => {
    const plain = (svg: string) => svg.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
    const { width, height } = host.getBoundingClientRect();
    const measureText = measurer(document);
    return [
      plain(chart.toSVG()),
      plain(renderToSVG({ ...options, width, height }, { measureText })),
    ];
  };

  it("of an annotation at the plot's top go below its marker, inside the chart, with no padding", async () => {
    const options = annotated();
    const chart = createChart(host, options);
    // Bars draw once their chunk loads.
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    const box = laidOut(chart, "E: 40");
    expectInChart(chart, box);
    const marker = chart.toPixel(40, { axis: "y" })!;
    // Too near the chart's top for the label 14 px above it.
    expect(marker).toBeLessThan(14);
    expect(marker).toBeLessThan(box.y + box.height / 2);
    expect(box.y + box.height / 2 - marker).toBeCloseTo(14, 3);
    const [live, still] = svgs(chart, options);
    expect(still).toBe(live);
    chart.destroy();
  });

  it("at each edge of the chart go across their point, start-, centre-, and end-aligned", () => {
    const at = (x: number, y: number, dx = 0, dy = 0) => ({
      x: { px: x, frame: "chart", offset: dx },
      y: { px: y, frame: "chart", offset: dy },
    });
    const { width, height } = host.getBoundingClientRect();
    const notes = [
      text({ at: at(width / 2, 3, 0, -14), label: "top" } as never),
      text({ at: at(width / 2, height - 3, 0, 14), label: "bottom" } as never),
      text({
        at: at(width - 3, height / 2),
        label: { text: "right start", style: { align: "start" } },
      } as never),
      text({
        at: at(3, height / 2),
        label: { text: "left end", style: { align: "end" } },
      } as never),
      text({ at: at(width - 3, 40), label: "right middle" } as never),
      text({
        at: at(4, 4),
        label: { text: "corner", style: { fontSize: 18, fontWeight: 700, align: "end" } },
      } as never),
    ];
    const options: ChartOptions = {
      locale: "en-US",
      renderer: "svg",
      marks: [line(data, { x: "t", y: "v" }), ...notes],
      x: { domain: [0, 10] },
      y: { domain: [0, 100] },
    };
    const chart = createChart(host, options);
    chart.render();
    for (const label of ["top", "bottom", "right start", "left end", "right middle", "corner"])
      expectInChart(chart, laidOut(chart, label));
    // Across their points: 14 px below the top one, the start-aligned one left of its point.
    expect(laidOut(chart, "top").y).toBeGreaterThan(3);
    expect(laidOut(chart, "bottom").y + laidOut(chart, "bottom").height).toBeLessThan(height - 3);
    expect(laidOut(chart, "right start").x + laidOut(chart, "right start").width).toBeLessThan(
      width - 1,
    );
    expect(laidOut(chart, "left end").x).toBeGreaterThan(1);
    const [live, still] = svgs(chart, options);
    expect(still).toBe(live);
    chart.destroy();
  });

  it("with a clip, or of a point outside the chart, are drawn where told", () => {
    const { width } = host.getBoundingClientRect();
    const options: ChartOptions = {
      locale: "en-US",
      renderer: "svg",
      marks: [
        line(data, { x: "t", y: "v" }),
        text({
          at: { x: { px: width - 3, frame: "chart" }, y: { px: 60, frame: "chart" } },
          label: { text: "clipped start", style: { align: "start" } },
          clip: false,
        } as never),
        text({
          at: { x: { px: width + 20, frame: "chart", offset: -40 }, y: { px: 90, frame: "chart" } },
          label: { text: "outside start", style: { align: "start" } },
        } as never),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 100] },
    };
    const chart = createChart(host, options);
    chart.render();
    expect(laidOut(chart, "clipped start").x).toBeCloseTo(width - 3, 3);
    expect(laidOut(chart, "outside start").x).toBeCloseTo(width - 20, 3);
    chart.destroy();
  });
});
