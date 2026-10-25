// Charts on right-to-left pages. An SVG takes the page's direction, which
// flips what text-anchor's start and end mean, while the chart lays text
// out by its left and right: its SVG (live, static, and its snapshots) is
// left to right, so text is painted where it is placed, and right-to-left
// text keeps its own order.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import { hydrateChart } from "../../src/dom/hydrate.ts";
import { area } from "../../src/marks/area.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { text } from "../../src/marks/text.ts";
import { renderToSnapshot } from "../../src/render/snapshot.ts";
import type { PlotRect } from "../../src/scene/scene.ts";

let page: HTMLDivElement;
let host: HTMLDivElement;

beforeEach(() => {
  page = document.createElement("div");
  page.dir = "rtl";
  host = document.createElement("div");
  host.style.cssText = "width:200px;height:150px";
  page.append(host);
  document.body.append(page);
});

afterEach(() => {
  page.remove();
});

const LONG = "A longer series label which does not fit";
const level = table({ x: [0, 1], y: [1, 1], low: [0.2, 0.2] });
const marks = [
  area(level, { x: "x", y: "low", labels: { at: "first", content: ["Area"] } }),
  line(level, { x: "x", y: "y", id: "line", labels: { at: "last", content: [LONG] } }),
  text({ from: { mark: "line", at: "first" }, label: "שלום" }),
];

/** Where an SVG text's glyphs are painted along x: its characters' cells, as laid out. */
function painted(element: SVGTextElement): [number, number] {
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < element.getNumberOfChars(); i++) {
    const { x, width } = element.getExtentOfChar(i);
    from = Math.min(from, x);
    to = Math.max(to, x + width);
  }
  return [from, to];
}

/** The labels the marks write, by their text. */
const isLabel = (content: string) =>
  content === "Area" || content === "שלום" || content.startsWith("A longer");

/** Checks the chart's SVG text in `root` against `plot`: labels inside it, the y axis' tick labels before it. */
function checkText(root: Element, plot: PlotRect) {
  const texts = [...root.querySelectorAll<SVGTextElement>("svg text")];
  const labels = texts.filter((t) => isLabel(t.textContent!));
  const written = labels.map((label) => label.textContent);
  expect(written).toHaveLength(3);
  expect(written).toEqual(
    expect.arrayContaining(["Area", "שלום", expect.stringMatching(/^A longer .*…$/)]),
  );
  for (const label of labels) {
    const [from, to] = painted(label);
    expect(from, label.textContent!).toBeGreaterThanOrEqual(plot.x - 0.5);
    expect(to, label.textContent!).toBeLessThanOrEqual(plot.x + plot.width + 0.5);
  }
  const ticks = texts.filter((t) => !labels.includes(t) && Number(t.getAttribute("x")) < plot.x);
  expect(ticks.length).toBeGreaterThan(0);
  for (const tick of ticks) expect(painted(tick)[1]).toBeLessThanOrEqual(plot.x);
  // Right-to-left text keeps its own order: its letters stand as on a
  // left-to-right page (Chromium and Firefox put the first rightmost;
  // WebKit reports its SVG text's letters in logical order on any page).
  const hebrew = labels.find((label) => label.textContent === "שלום")!;
  const reference = document.createElement("div");
  reference.dir = "ltr";
  reference.innerHTML = `<svg width="100" height="40"><text x="10" y="20">שלום</text></svg>`;
  reference.querySelector("text")!.style.font = getComputedStyle(hebrew).font;
  document.body.append(reference);
  expect(order(hebrew)).toEqual(order(reference.querySelector("text")!));
  reference.remove();
}

/** A text's characters from left to right, by their index. */
function order(element: SVGTextElement): number[] {
  const indexes = Array.from({ length: element.getNumberOfChars() }, (_, i) => i);
  return indexes.sort((a, b) => element.getExtentOfChar(a).x - element.getExtentOfChar(b).x);
}

describe("charts on right-to-left pages", () => {
  it("paint SVG text where it is placed, live and in static SVG", async () => {
    const chart = createChart(host, {
      renderer: "svg",
      legend: false,
      theme: { style: { plot: { fill: "#eeeeee" } } },
      marks,
    });
    await chart.loading;
    chart.render();
    const { plot } = chart.getPanels()[0]!;
    checkText(host, plot);
    // Static SVG, put in the right-to-left page as it is.
    const exported = document.createElement("div");
    exported.innerHTML = chart.toSVG();
    page.append(exported);
    checkText(exported, plot);
    chart.destroy();
  });

  it("paint the text of server markup where it is placed, before and after hydrating", async () => {
    const options = { legend: false, theme: { style: { plot: { fill: "#eeeeee" } } }, marks };
    const initial = renderToSnapshot(options, { width: 200, height: 150, idPrefix: "rtl" });
    host.innerHTML = initial.html;
    checkText(host, host.querySelector<SVGRectElement>('rect[fill="#eeeeee"]')!.getBBox());
    const chart = hydrateChart(host, options, initial);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    checkText(host, chart.getPanels()[0]!.plot);
    chart.destroy();
  });

  it("write a legend's mixed-direction labels in the order its export does", async () => {
    host.style.width = "400px";
    const named = "Service שלום 123";
    const chart = createChart(host, {
      renderer: "svg",
      marks: [
        line(table({ x: [0, 1], y: [1, 2], s: [named, named] }), { x: "x", y: "y", series: "s" }),
        line(table({ x: [0, 1], y: [2, 1], s: ["Other", "Other"] }), {
          x: "x",
          y: "y",
          series: "s",
        }),
      ],
    });
    await chart.loading;
    chart.render();
    // Where "Service" stands against "123" in a run of text: before it, left to right.
    const order = (node: Text) => {
      const at = (from: number, to: number) => {
        const range = document.createRange();
        range.setStart(node, from);
        range.setEnd(node, to);
        return range.getBoundingClientRect().left;
      };
      const end = node.data.length;
      return Math.sign(at(end - 3, end) - at(0, 7));
    };
    const textIn = (root: Element) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode())
        if ((node as Text).data === named) return node as Text;
      throw new Error(`no text "${named}"`);
    };
    const live = order(textIn(chart.root.querySelector('[aria-label="Legend"]')!));
    const exported = document.createElement("div");
    exported.innerHTML = chart.toSVG();
    page.append(exported);
    expect(live).toBe(1);
    expect(order(textIn(exported))).toBe(live);
    chart.destroy();
  });

  it("paint Canvas text where it is placed", async () => {
    const red = { color: "#ff0000", halo: false } as const;
    const chart = createChart(host, {
      renderer: "canvas",
      legend: false,
      theme: { style: { plot: { fill: "#eeeeee" } } },
      marks: [
        line(level, { x: "x", y: "y", labels: { at: "last", content: [LONG], style: red } }),
        // A custom mark's text starting at its point, which Canvas aligns by the text's direction.
        custom({
          draw: ({ plot, text }) =>
            text(plot.x + 10, plot.y + 10, "Start", { fill: "#0000ff", anchor: "start" }),
        }),
      ],
    });
    await chart.loading;
    chart.render();
    const { plot } = chart.getPanels()[0]!;
    const canvas = host.querySelector("canvas")!;
    const ratio = canvas.width / canvas.getBoundingClientRect().width;
    const { data, width } = canvas
      .getContext("2d")!
      .getImageData(0, 0, canvas.width, canvas.height);
    /** How far along x the pixels `is` picks reach, in CSS pixels. */
    const ink = (is: (r: number, g: number, b: number) => boolean) => {
      let [from, to] = [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY];
      for (let i = 0; i < data.length; i += 4)
        if (data[i + 3]! > 200 && is(data[i]!, data[i + 1]!, data[i + 2]!)) {
          const x = ((i / 4) % width) / ratio;
          [from, to] = [Math.min(from, x), Math.max(to, x + 1 / ratio)];
        }
      return [from, to] as const;
    };
    // The label's red ink, all of it inside the plot.
    const [from, to] = ink((r, g, b) => r > 200 && g < 90 && b < 90);
    expect(to - from).toBeGreaterThan(plot.width / 2);
    expect(from).toBeGreaterThanOrEqual(plot.x - 0.5);
    expect(to).toBeLessThanOrEqual(plot.x + plot.width + 0.5);
    // The custom text's blue ink, after its point.
    const [start] = ink((r, g, b) => b > 200 && r < 90 && g < 90);
    expect(start).toBeGreaterThanOrEqual(plot.x + 9.5);
    chart.destroy();
  });
});
