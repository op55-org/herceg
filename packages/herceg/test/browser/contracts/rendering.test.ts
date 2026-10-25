// Proofs of the matrix's renderers (test/contracts/), one per row: forced
// to SVG, the mark is drawn as SVG elements inside its plot, which the
// browser draws in its colors at every place it draws at and with its text
// in its boxes (test/contracts/drawn.ts), and nothing on a canvas; forced to Canvas, its colors are on the
// canvas inside its plot and not in the SVG; left to choose, a chart this
// small draws as SVG does. GPU paths are proved apart (gpu.test.ts).

import { describe, expect } from "vitest";
import { table } from "../../../src/data/table.ts";
import type { Chart } from "../../../src/dom/chart.ts";
import { line } from "../../../src/marks/line.ts";
import { expectDrawn } from "../../contracts/drawn.ts";
import {
  cellsOf,
  grey,
  markColors,
  markOf,
  nearColor,
  paintsOf,
  rgbOf,
  splitPixels,
} from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { canvasPixels, mount, plotsOf, sceneOf } from "./mount.ts";
import { atRatio, drawnScene, drawSvg, measure, PICTURE, SCALE, shownPixels } from "./pictures.ts";

/** The mark's own colors, not greys: what it paints in SVG attributes. */
function paintsOfMark(chart: Chart): string[] {
  const scene = sceneOf(chart);
  return [...paintsOf(scene.panels.flatMap((p) => p.marks))].filter(
    (paint) => !grey(rgbOf(paint) ?? [0, 0, 0]),
  );
}

/** The chart's SVG elements of its marks: of a geometry's kind, not grid lines. */
const markElements = (chart: Chart) => [
  ...chart.root.querySelectorAll('svg [data-kind]:not([data-kind="grid"])'),
];

/** What the chart's SVG draws of its marks, colors in lowercase. */
const marksInSvg = (chart: Chart) =>
  markElements(chart)
    .map((element) => element.outerHTML.toLowerCase())
    .join("");

/** Pixels of a mark's geometry may reach this far past its plot: half a marker, a stroke. */
const MARGIN = 8;

/** The mark's shapes (not its labels' text, which may reach past the plot) whose boxes leave the plots. */
function outsidePlots(chart: Chart): string[] {
  const root = chart.root.getBoundingClientRect();
  const plots = plotsOf(chart);
  const shapes = (element: Element): Element[] =>
    element.tagName === "g" ? [...element.children].flatMap(shapes) : [element];
  return markElements(chart)
    .filter((element) => !["labels", "text"].includes(element.getAttribute("data-kind")!))
    .flatMap(shapes)
    .filter((element) => element.tagName !== "text")
    .filter((element) => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) return false;
      return (
        box.left - root.left < plots.x - MARGIN ||
        box.top - root.top < plots.y - MARGIN ||
        box.right - root.left > plots.x + plots.width + MARGIN ||
        box.bottom - root.top > plots.y + plots.height + MARGIN
      );
    })
    .map((element) => element.outerHTML.slice(0, 120));
}

/** Whether the SVG draws in a color of the mark, or holds an image of its cells. */
const drawsInSvg = (chart: Chart, paints: readonly string[]) => {
  const svg = marksInSvg(chart);
  return paints.some((paint) => svg.includes(paint.toLowerCase())) || svg.includes("<image");
};

/** Pixels of the chart's canvas in the mark's colors, as they show over a white page: inside its plots and outside. */
function onCanvas(chart: Chart): { inside: number; outside: number } {
  const pixels = canvasPixels(chart);
  if (!pixels) return { inside: 0, outside: 0 };
  const canvas = chart.root.querySelector("canvas")!;
  const scale = canvas.width / canvas.getBoundingClientRect().width;
  const offset = canvas.getBoundingClientRect();
  const root = chart.root.getBoundingClientRect();
  // The plots, in the canvas' own pixels.
  const plots = plotsOf(chart);
  const region = {
    ...plots,
    x: plots.x - (offset.left - root.left),
    y: plots.y - (offset.top - root.top),
  };
  const parts = splitPixels(pixels, canvas.width, scale, region, MARGIN);
  const count = (of: Uint8ClampedArray) =>
    markColors(sceneOf(chart)).reduce((n, color) => n + nearColor(of, 4, color), 0);
  return { inside: count(parts.inside), outside: count(parts.outside) };
}

describe("rendering.svg", () => {
  for (const cell of cellsOf("rendering.svg"))
    contractTest(`${cell.row}.rendering.svg`, async () => {
      if (cell.state !== "works") throw new Error(`rendering.svg is never ${cell.state}`);
      const chart = await mount({ marks: [markOf(cell.row)] }, { renderer: "svg" });
      expect(chart.root.querySelector("canvas"), "no canvas").toBeNull();
      // The chart's SVG (a toolbar's icons are SVGs too), as the browser draws it apart from the page.
      const svg = chart.root.querySelector<SVGSVGElement>("svg:has([data-kind])")!;
      expectDrawn(drawnScene(chart), await drawSvg(svg, SCALE), PICTURE, measure);
      expect(outsidePlots(chart), "the mark's elements stay in its plot").toEqual([]);
    });
});

describe("rendering.canvas", () => {
  for (const cell of cellsOf("rendering.canvas"))
    contractTest(`${cell.row}.rendering.canvas`, async () => {
      if (cell.state !== "works") throw new Error(`rendering.canvas is never ${cell.state}`);
      // On a screen as dense as the proofs' pictures, so that the canvas is drawn as sharp.
      await atRatio(SCALE, async () => {
        const chart = await mount({ marks: [markOf(cell.row)] }, { renderer: "canvas" });
        const canvas = chart.root.querySelector("canvas")!;
        expect(canvas.width / canvas.getBoundingClientRect().width, "the screen's ratio").toBe(
          SCALE,
        );
        // What the chart shows draws the mark (its SVG none of it, below: the canvas does).
        expectDrawn(drawnScene(chart), await shownPixels(chart), PICTURE, measure);
        expectOnCanvas(chart);
      });
    });
});

/** Expects the mark's colors on the chart's canvas in its plot, next to none elsewhere, and none in the SVG. */
function expectOnCanvas(chart: Chart): void {
  const painted = onCanvas(chart);
  expect(painted.inside, "the canvas shows the mark's colors in its plot").toBeGreaterThan(0);
  // Labels may reach past the plot by a few pixels; geometry drawn elsewhere would not be few.
  expect(painted.outside, "and next to nothing elsewhere").toBeLessThanOrEqual(
    painted.inside * 0.05,
  );
  // Guides (a legend's swatches) may show its colors; its geometry may not.
  expect(drawsInSvg(chart, paintsOfMark(chart)), "the SVG draws none of the mark").toBe(false);
}

describe("rendering.auto", () => {
  for (const cell of cellsOf("rendering.auto"))
    contractTest(`${cell.row}.rendering.auto`, async () => {
      if (cell.state !== "works") throw new Error(`rendering.auto is never ${cell.state}`);
      // Few vertices: the chart chooses SVG, and draws as forced SVG does.
      const chart = await mount({ marks: [markOf(cell.row)] });
      const forced = await mount({ marks: [markOf(cell.row)] }, { renderer: "svg" });
      expect(chart.root.querySelector("canvas")).toBeNull();
      const svgOf = (c: Chart) =>
        c.root.querySelector("svg")!.outerHTML.replace(/herceg-\d+/g, "herceg");
      expect(svgOf(chart)).toEqual(svgOf(forced));
    });

  contractTest("rendering.auto.switch", async () => {
    const lines = (n: number) => {
      const t = Float64Array.from({ length: n }, (_, i) => i);
      const columns = Object.fromEntries(
        ["a", "b", "c", "d"].map((k, j) => [k, Float64Array.from(t, (v) => Math.sin(v / 50 + j))]),
      );
      return [
        line(table({ t, ...columns }) as never, { x: "t", y: ["a", "b", "c", "d"] } as never),
      ];
    };
    const chart = await mount({ marks: [] }, { marks: lines(10) });
    expect(chart.root.querySelector("canvas")).toBeNull();
    // Dense lines draw over 4,000 vertices: on Canvas; sparse again, under 2,000: SVG.
    chart.update({ marks: lines(50_000) });
    chart.render();
    expect(sceneOf(chart).vertices).toBeGreaterThan(4000);
    expect(onCanvas(chart).inside).toBeGreaterThan(0);
    chart.update({ marks: lines(10) });
    chart.render();
    expect(chart.root.querySelector("canvas")).toBeNull();
  });
});
