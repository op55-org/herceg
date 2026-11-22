// The pointer overlay: an `<svg>` of its own over the data's, so that what
// the pointer and keyboard draw repaints it alone, made the first time
// something draws there. Where it stacks, what it holds and cuts, what it
// lets through to the chart and to anchors, and that it goes with the chart.

import "./interactive.ts";
import axe from "axe-core";
import { afterEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { anchor } from "../../src/dom/anchors.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { inset, panel } from "../../src/layout.ts";
import { line } from "../../src/marks/line.ts";
import { facet } from "../../src/model/facet.ts";
import { panels } from "../../src/model/panels.ts";
import { MOUSE, pageOrigin, realMouse } from "./helpers.ts";

const hosts: HTMLElement[] = [];
const charts: Chart[] = [];
afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const data = table({
  t: [0, 1, 2, 3, 4, 5, 6, 7],
  a: [3, 5, 4, 6, 5, 7, 6, 8],
  b: [1, 2, 2, 3, 2, 4, 3, 5],
  region: ["n", "n", "n", "n", "s", "s", "s", "s"],
});

function host(): HTMLDivElement {
  const element = document.createElement("div");
  // At the top of the page, where real input lands (the test frame is 414 pixels high).
  element.style.cssText = "position:fixed;left:0;top:0;width:400px;height:300px";
  document.body.append(element);
  hosts.push(element);
  return element;
}

async function mount(options: ChartOptions, into = host()): Promise<Chart> {
  const chart = createChart(into, { locale: "en-US", ...options });
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

function pointer(chart: Chart, x: number, y: number) {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerId: MOUSE,
    }),
  );
}

/** The chart's SVGs: the data's (marks, grid, axes), and the overlay over it once made. */
const svgs = (chart: Chart) =>
  [...chart.root.children].filter((node): node is SVGSVGElement => node instanceof SVGSVGElement);

/** The data's SVG and the overlay, which must have been made. */
function layers(chart: Chart): [SVGSVGElement, SVGSVGElement] {
  const found = svgs(chart);
  expect(found).toHaveLength(2);
  return found as [SVGSVGElement, SVGSVGElement];
}

/** The crosshair lines shown, wherever they are in the chart. */
const crosshairs = (root: Element) =>
  [...root.querySelectorAll("line[visibility='visible']")] as SVGLineElement[];

/** The plot's middle of a chart's first panel. */
function middle(chart: Chart) {
  const { plot } = chart.getPanels()[0]!;
  return { x: plot.x + plot.width / 2, y: plot.y + plot.height / 2 };
}

describe("the pointer overlay", () => {
  it.each(["svg", "canvas"] as const)(
    "stacks over the data and under the legend and tooltip, holding what a hover draws (%s)",
    async (renderer) => {
      const chart = await mount({ renderer, marks: [line(data, { x: "t", y: ["a", "b"] })] });
      // Nothing has drawn over the chart yet.
      expect(svgs(chart)).toHaveLength(1);
      const at = middle(chart);
      pointer(chart, at.x, at.y);
      await frame();
      const [svg, overlay] = layers(chart);
      const children = [...chart.root.children];
      const legend = chart.root.querySelector('[aria-label="Legend"]')!;
      const tooltip = children.find(
        (node) => node instanceof HTMLDivElement && node.style.display === "block",
      )!;
      // A canvas chart's canvas, then the data's SVG, the overlay, the legend, the tooltip.
      const order = [svg, overlay, legend, tooltip].map((node) => children.indexOf(node));
      expect(order).toEqual([...order].sort((a, b) => a - b));
      expect(order[1]).toBe(order[0]! + 1);
      expect(children.indexOf(svg)).toBe(renderer === "canvas" ? 1 : 0);
      if (renderer === "canvas") expect(children[0]!.tagName).toBe("CANVAS");
      // The same box and coordinates as the data's.
      for (const name of ["width", "height", "viewBox"])
        expect(overlay.getAttribute(name)).toBe(svg.getAttribute(name));
      expect(getComputedStyle(overlay).position).toBe("absolute");
      expect(getComputedStyle(overlay).pointerEvents).toBe("none");
      expect(overlay.getAttribute("aria-hidden")).toBe("true");
      // The crosshair and its points are the overlay's; the data's SVG holds none of them.
      expect(crosshairs(overlay)).toHaveLength(1);
      expect(overlay.querySelectorAll("circle[r='3.5']")).toHaveLength(2);
      expect(crosshairs(svg)).toHaveLength(0);
      expect(svg.querySelectorAll("circle[r='3.5']")).toHaveLength(0);
    },
  );

  it("draws a move into the overlay alone, writing nothing to the data's SVG", async () => {
    const chart = await mount({ renderer: "svg", marks: [line(data, { x: "t", y: ["a", "b"] })] });
    const { plot } = chart.getPanels()[0]!;
    pointer(chart, plot.x + plot.width / 4, plot.y + plot.height / 2);
    await frame();
    const [svg, overlay] = layers(chart);
    const written = new Map<Node, number>();
    const observer = new MutationObserver((records) => {
      for (const { target } of records) {
        const layer = svg.contains(target) ? svg : overlay;
        written.set(layer, (written.get(layer) ?? 0) + 1);
      }
    });
    for (const layer of [svg, overlay])
      observer.observe(layer, { subtree: true, childList: true, attributes: true });
    pointer(chart, plot.x + (plot.width * 3) / 4, plot.y + plot.height / 2);
    await frame();
    await frame();
    observer.disconnect();
    expect(written.get(overlay)).toBeGreaterThan(0);
    expect(written.get(svg)).toBeUndefined();
  });

  it("lets real input through to the chart, and keeps anchors over it", async () => {
    const chart = await mount({ renderer: "svg", marks: [line(data, { x: "t", y: "a" })] });
    const button = document.createElement("button");
    button.textContent = "Peak";
    button.style.cssText = "width:40px;height:20px";
    anchor(chart, button, { at: { x: 4, y: 5 }, side: "center" });
    await frame();
    const x = chart.toPixel(4, { axis: "x" })!;
    const origin = pageOrigin(chart.root);
    const { plot } = chart.getPanels()[0]!;
    // Real moves in the plot reach the chart, the second through the overlay
    // the first made: the crosshair shows.
    const y = plot.y + 10;
    await realMouse({ type: "move", x: origin.x + x - 20, y: origin.y + y });
    await expect.poll(() => svgs(chart).length).toBe(2);
    const [svg, overlay] = layers(chart);
    await realMouse({ type: "move", x: origin.x + x, y: origin.y + y });
    await expect
      .poll(() => crosshairs(overlay).map((line) => Number(line.getAttribute("x1"))))
      .toEqual([Math.round(x) + 0.5]);
    // The anchors' layer is over the overlay.
    const children = [...chart.root.children];
    const layer = button.parentElement!.parentElement!;
    expect(children.indexOf(layer)).toBeGreaterThan(children.indexOf(overlay));
    const drawnAt = Number(crosshairs(overlay)[0]!.getAttribute("x1"));
    expect(Math.abs(drawnAt - x)).toBeLessThan(1);
    // What is under the crosshair, to the browser, is the chart's, not the overlay's.
    const rect = chart.root.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + drawnAt, rect.top + y)!;
    expect(chart.root.contains(hit)).toBe(true);
    expect(overlay.contains(hit)).toBe(false);
    expect(hit === svg || svg.contains(hit) || hit === chart.root).toBe(true);
    // Where the crosshair crosses the anchored button, the button is what is hit.
    const box = button.getBoundingClientRect();
    expect(box.left).toBeLessThan(rect.left + drawnAt);
    expect(box.right).toBeGreaterThan(rect.left + drawnAt);
    expect(document.elementFromPoint(rect.left + drawnAt, box.top + box.height / 2)).toBe(button);
  });

  it("cuts its crosshair and brush off an inset with clip paths of its own", async () => {
    const chart = await mount({
      renderer: "svg",
      interaction: { brush: "x" },
      marks: [
        line(data, { x: "t", y: "a", panel: "main" }),
        line(data, { x: "t", y: "b", panel: "detail" }),
      ],
      panels: panels(panel("main", [inset("detail", { place: { inside: "top-right" } })])),
    });
    const main = chart.getPanels().find(({ key }) => key === "main")!;
    const detail = chart.getPanels().find(({ key }) => key === "detail")!;
    // Under the inset's left edge, low in the main plot: the crosshair crosses up under the inset.
    pointer(chart, detail.plot.x + 4, main.plot.y + main.plot.height - 10);
    await frame();
    const [svg, overlay] = layers(chart);
    chart.select({ kind: "brush", x: [1, 6], y: null, lasso: null }, { panel: "main" });
    await expect
      .poll(() => overlay.querySelectorAll("path[clip-path][visibility='visible']").length)
      .toBe(1);
    expect(crosshairs(overlay)[0]?.getAttribute("clip-path")).toMatch(/^url\(#.+\)$/);
    // Every clip path the overlay draws through is in the overlay, the data's own in the data's SVG.
    const references = [...overlay.querySelectorAll("[clip-path]")].map(
      (node) => /^url\(#(.+)\)$/.exec(node.getAttribute("clip-path")!)![1]!,
    );
    expect(references.length).toBeGreaterThan(1);
    for (const id of references) {
      const clip = document.getElementById(id)!;
      expect(clip.tagName).toBe("clipPath");
      expect(overlay.contains(clip)).toBe(true);
    }
    for (const node of svg.querySelectorAll("[clip-path^='url(']")) {
      const id = /^url\(#(.+)\)$/.exec(node.getAttribute("clip-path")!)![1]!;
      expect(svg.contains(document.getElementById(id))).toBe(true);
    }
  });

  it("draws each facet's crosshair in the chart's one overlay", async () => {
    const chart = await mount({
      renderer: "svg",
      marks: [line(data, { x: "t", y: "a" })],
      facet: facet("region"),
    });
    const [first] = chart.getPanels();
    pointer(chart, first!.plot.x + first!.plot.width / 2, first!.plot.y + first!.plot.height / 2);
    await frame();
    const [svg, overlay] = layers(chart);
    expect(crosshairs(overlay).length).toBeGreaterThan(0);
    expect(crosshairs(svg)).toHaveLength(0);
  });

  it("keeps its node through renderer changes, and leaves with the chart", async () => {
    const into = host();
    const options: ChartOptions = { renderer: "svg", marks: [line(data, { x: "t", y: "a" })] };
    const chart = await mount(options, into);
    const at = middle(chart);
    pointer(chart, at.x, at.y);
    await frame();
    const [svg, overlay] = layers(chart);
    chart.update({ ...options, renderer: "canvas" });
    chart.render();
    expect([...chart.root.children].slice(0, 3)).toEqual([
      chart.root.querySelector("canvas"),
      svg,
      overlay,
    ]);
    chart.update(options);
    chart.render();
    expect([...chart.root.children].slice(0, 2)).toEqual([svg, overlay]);
    expect(chart.root.querySelector("canvas")).toBeNull();
    chart.destroy();
    expect(into.querySelector("svg")).toBeNull();
    // Mounted again in the same element: a new chart, and nothing of the last.
    const again = await mount(options, into);
    expect(svgs(again)).toHaveLength(1);
    expect(into.querySelectorAll("svg[aria-hidden='true']")).toHaveLength(1);
    pointer(again, at.x, at.y);
    await frame();
    expect(layers(again)[1]).not.toBe(overlay);
  });

  it("is made by the first selection, which draws under the pointer's feedback", async () => {
    const chart = await mount({
      renderer: "svg",
      interaction: { brush: "x" },
      marks: [line(data, { x: "t", y: "a" })],
    });
    // The brush has loaded; with no selection, nothing draws over the chart.
    await frame();
    expect(svgs(chart)).toHaveLength(1);
    chart.select({ kind: "brush", x: [1, 3], y: null, lasso: null });
    await expect.poll(() => svgs(chart).length).toBe(2);
    const [, overlay] = layers(chart);
    const outline = () => overlay.querySelector("path[fill-opacity][visibility='visible']");
    await expect.poll(outline).not.toBeNull();
    const at = middle(chart);
    pointer(chart, at.x, at.y);
    await frame();
    // The brush's group comes before the one of the crosshair, so paints under it.
    const groups = [...overlay.children];
    const brush = groups.findIndex((group) => group.contains(outline()));
    const feedback = groups.findIndex((group) => group.contains(crosshairs(overlay)[0]!));
    expect(brush).toBeGreaterThanOrEqual(0);
    expect(feedback).toBeGreaterThan(brush);
  });

  it("adds nothing for assistive technology to read", async () => {
    const chart = await mount({
      renderer: "svg",
      title: "Requests",
      marks: [line(data, { x: "t", y: ["a", "b"] })],
    });
    const at = middle(chart);
    pointer(chart, at.x, at.y);
    await frame();
    expect(chart.root.querySelectorAll("svg:not([aria-hidden='true'])")).toHaveLength(0);
    const results = await axe.run(chart.root, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
      rules: { region: { enabled: false }, "page-has-heading-one": { enabled: false } },
    });
    expect(results.violations.map(({ id }) => id)).toEqual([]);
  });
});
