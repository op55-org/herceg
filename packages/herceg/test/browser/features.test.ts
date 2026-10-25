// Live charts whose marks need the feature compiler: they load it before
// drawing, and draw its features on SVG and Canvas as static output does.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { facet } from "../../src/model/facet.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

const sites = table({
  t: [0, 1, 2, 0, 1, 2],
  v: [1, 2, 3, 2, 3, 1],
  site: ["A", "A", "A", "Average", "Average", "Average"],
});

/**
 * Where text is laid out: its advance from its anchor along x (which the
 * chart measures; engines' boxes of text take in some ink past it), and its
 * line's box along y.
 */
function laidOut(text: SVGTextElement) {
  const width = text.getComputedTextLength();
  const anchor = text.getAttribute("text-anchor");
  const share = anchor === "end" ? 1 : anchor === "middle" ? 0.5 : 0;
  const { y, height } = text.getBBox();
  return { x: Number(text.getAttribute("x")) - width * share, y, width, height };
}

const strokes = () =>
  [...host.querySelectorAll("svg path")].map((path) => path.getAttribute("stroke"));

describe("charts drawing marks' features", () => {
  // First in the file, so that the compiler loads for it.
  it("draw once the feature compiler loads, in the colors their scales fix", async () => {
    const chart = createChart(host, {
      renderer: "svg",
      scales: { color: { type: "ordinal", map: { Average: "#222222" } } },
      marks: [
        line(sites, {
          x: "t",
          y: "v",
          series: "site",
          color: "site",
          style: { by: { map: { Average: { dash: "--" } } } },
        }),
      ],
    });
    const loading = chart.loading;
    if (loading) {
      expect(strokes()).not.toContain("#222222");
      expect(() => chart.toSVG()).toThrow(/chart: its code has not loaded; await chart.loading/);
      await loading;
    }
    expect(strokes()).toContain("#222222");
    const dashed = [...host.querySelectorAll('svg path[stroke="#222222"]')];
    expect(dashed.some((path) => path.getAttribute("stroke-dasharray"))).toBe(true);
    expect(chart.toSVG()).toContain('stroke="#222222"');
    chart.destroy();
  });

  it("tell colors from fields as the page reads CSS", async () => {
    const chart = createChart(host, {
      renderer: "svg",
      marks: [line(sites, { x: "t", y: "v", color: "rebeccapurple" })],
    });
    await chart.loading;
    // Read as the page computes it, as every color the chart draws is.
    expect(strokes()).toContain("#663399");
    expect(() =>
      chart.update({
        marks: [line(sites, { x: "t", y: "v", color: "stie" as never })],
        errorMode: "throw",
      }),
    ).toThrow(/"stie" is neither a field nor a color/);
    chart.destroy();
  });

  it("keep series labels at a view's edges inside the plot, off the axes' tick labels", async () => {
    const chart = createChart(host, {
      renderer: "svg",
      legend: false,
      theme: { style: { plot: { fill: "#eeeeee" } } },
      x: { domain: [2, 10] },
      marks: [
        // Entering the view at its left edge, and ending at its right edge on the right axis.
        line(table({ t: [0, 10], limit: [57, 57] }), {
          x: "t",
          y: "limit",
          labels: { at: "visible-start", content: ["Limit ", { value: true }] },
        }),
        line(table({ t: [0, 5, 10], v: [0, 100, 40] }), { x: "t", y: "v" }),
        line(table({ t: [0, 10], rate: [300, 520] }), {
          x: "t",
          y: "rate",
          axis: "right",
          labels: { at: "last", content: ["Requests ", { value: true }] },
        }),
      ],
    });
    await chart.loading;
    chart.render();
    const plot = host.querySelector<SVGRectElement>('svg rect[fill="#eeeeee"]')!.getBBox();
    const labels = [...host.querySelectorAll<SVGTextElement>('g[data-kind="labels"] text')];
    expect(labels.map((label) => label.textContent)).toEqual(["Limit 57", "Requests 520"]);
    const others = [...host.querySelectorAll<SVGTextElement>("svg text")].filter(
      (t) => !labels.includes(t),
    );
    for (const label of labels) {
      const box = laidOut(label);
      expect(box.x).toBeGreaterThanOrEqual(plot.x);
      expect(box.x + box.width).toBeLessThanOrEqual(plot.x + plot.width);
      for (const other of others) {
        const tick = laidOut(other);
        const apart =
          box.x + box.width <= tick.x ||
          tick.x + tick.width <= box.x ||
          box.y + box.height <= tick.y ||
          tick.y + tick.height <= box.y;
        expect(apart, `${label.textContent} over ${other.textContent}`).toBe(true);
      }
      // Its halo is the plot's fill, which it is drawn on.
      expect(label.getAttribute("stroke")).toBe("#eeeeee");
    }
    chart.destroy();
  });

  it("spread labels moved in from one edge apart, and keep their boxes' outlines inside", async () => {
    const level = table({ x: [0, 1, 0, 1], y: [5, 5, 5, 5], g: ["A", "A", "Longer", "Longer"] });
    for (const at of ["first", "last"] as const) {
      const chart = createChart(host, {
        renderer: "svg",
        legend: false,
        theme: { style: { plot: { fill: "#eeeeee" } } },
        marks: [line(level, { x: "x", y: "y", series: "g", labels: { at } })],
      });
      await chart.loading;
      chart.render();
      const [a, b] = [...host.querySelectorAll<SVGTextElement>('g[data-kind="labels"] text')].map(
        laidOut,
      );
      const apart =
        a!.x + a!.width <= b!.x ||
        b!.x + b!.width <= a!.x ||
        a!.y + a!.height <= b!.y ||
        b!.y + b!.height <= a!.y;
      expect(apart, at).toBe(true);
      const background = { fill: "#ffffff", stroke: "#ff0000", strokeWidth: 12 };
      const style = { background, padding: 4 };
      chart.update({ marks: [line(level, { x: "x", y: "y", labels: { at, style } })] });
      await chart.loading;
      chart.render();
      const plot = host.querySelector<SVGRectElement>('svg rect[fill="#eeeeee"]')!.getBBox();
      const box = host.querySelector<SVGRectElement>('g[data-kind="labels"] rect')!.getBBox();
      expect(box.x - 6).toBeGreaterThanOrEqual(plot.x - 0.01);
      expect(box.x + box.width + 6).toBeLessThanOrEqual(plot.x + plot.width + 0.01);
      chart.destroy();
    }
  });

  for (const renderer of ["svg", "canvas"] as const)
    it(`shorten series labels to narrow facet panels at both edges on ${renderer}`, async () => {
      host.style.width = "400px";
      const long = "A longer series label which does not fit in a panel";
      const level = (y: number) =>
        table({ x: [0, 1, 0, 1], y: [y, y, y, y], g: ["a", "a", "b", "b"] });
      const chart = createChart(host, {
        renderer,
        legend: false,
        theme: { style: { plot: { fill: "#eeeeee" } } },
        facet: facet("g"),
        marks: [
          line(level(1), { x: "x", y: "y", labels: { at: "first", content: [long] } }),
          line(level(2), { x: "x", y: "y", labels: { at: "last", content: [long] } }),
        ],
      });
      await chart.loading;
      chart.render();
      // The chart's static SVG writes what it draws, on SVG and Canvas alike.
      const written = [...chart.toSVG().matchAll(/>(A longer [^<]*)</g)].map(([, text]) => text);
      expect(written).toHaveLength(4);
      for (const shortened of written) expect(shortened).toMatch(/^A longer .+…$/);
      if (renderer === "svg") {
        const plots = [...host.querySelectorAll<SVGRectElement>('svg rect[fill="#eeeeee"]')].map(
          (rect) => rect.getBBox(),
        );
        const labels = [...host.querySelectorAll<SVGTextElement>('g[data-kind="labels"] text')];
        expect(labels.map((label) => label.textContent)).toEqual(written);
        for (const label of labels) {
          const { x, width } = laidOut(label);
          const inside = plots.some((plot) => x >= plot.x && x + width <= plot.x + plot.width);
          expect(inside, `${label.textContent} at ${x} to ${x + width}`).toBe(true);
        }
      }
      chart.destroy();
    });

  for (const renderer of ["svg", "canvas"] as const)
    it(`draw markers, outlined bars, labels, and conditional bands on ${renderer}`, async () => {
      const hours = table({
        t: time([0, 1, 2, 3, 4].map((h) => Date.UTC(2026, 3, 1, h * 6))),
        e: [0.9, 0.7, 0.6, 0.85, 0.95],
        limit: [0.8, 0.8, 0.8, 0.8, 0.8],
      });
      const chart = createChart(host, {
        renderer,
        timeZone: "UTC",
        marks: [
          area(hours, { x: "t", y1: "e", y2: "limit", where: col("e").lt(col("limit")) }),
          line(hours, { x: "t", y: "e", markers: true, continuity: { breakBy: "day" } }),
          rule({
            y: 0.8,
            label: { text: "Limit", place: { attachment: "start", outside: true } },
          }),
          text({ at: { x: { fraction: 0.03 }, y: { data: 0.65 } }, label: "note" }),
        ],
      });
      await chart.loading;
      chart.render();
      const svg = chart.toSVG();
      expect(svg).toContain(">Limit<");
      expect(svg).toContain(">note<");
      const sales = table({ zone: ["a", "b"], gain: [60, 30] });
      chart.update({
        marks: [
          bar(sales, {
            x: "zone",
            y: "gain",
            fill: "#3266d6",
            stroke: "#1b3a6b",
            labels: { place: { outside: false } },
          }),
        ],
      });
      await chart.loading;
      chart.render();
      const bars = chart.toSVG();
      expect(bars).toContain('stroke="#1b3a6b"');
      // White labels inside the blue bars.
      expect(bars).toMatch(/<g fill="#ffffff"[^>]*><text[^>]*>60</);
      chart.destroy();
    });
});
