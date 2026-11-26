// Tick labels' gap in the browser: y labels beside tick marks and at large
// fonts stand where x labels do, painted where the scene places them in SVG
// and Canvas charts alike, in static SVG and PDF as the live chart draws
// them, and under the crosshair's boxes.
import { afterEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { axis } from "../../src/guides/options.ts";
import { line } from "../../src/marks/line.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import { encodeText, standardFont, textWidth } from "../../src/render/pdf-fonts.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { AxisGuide, Scene, TextItem } from "../../src/scene/scene.ts";
import { yScale } from "../helpers/scales.ts";
import { MOUSE, modelOf } from "./helpers.ts";

const WIDTH = 640;
const HEIGHT = 320;
const data = table({ x: [0, 1, 2, 3, 4], v: [1200, 1500, 1300, 2000, 1700] });
const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
});

async function mount(options: ChartOptions): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px`;
  document.body.append(host);
  const chart = createChart(host, options);
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

const sceneOf = (chart: Chart): Scene =>
  (chart as unknown as ExportsScene)[EXPORT_SCENE]((scene) => scene);
const axisOn = (scene: Scene, side: AxisGuide["side"]) =>
  scene.panels[0]!.axes.find((a) => a.side === side)!;
const labelsOf = (guide: AxisGuide) =>
  guide.items.filter((item): item is TextItem => item.type === "text" && !!item.text);

/** 16 px labels beside 6 px marks on x and y, and an axis on top at B4's `gap: 0`. */
const options = (renderer: "svg" | "canvas"): ChartOptions => ({
  renderer,
  locale: "en-US",
  animation: false,
  legend: false,
  theme: { style: { tickLabel: { fontSize: 16 } } },
  marks: [line(data, { x: "x", y: "v" })],
  guides: [
    axis({ scale: "x", tick: { length: 6 } }),
    axis({ scale: "x", place: { side: "top" }, tick: { length: 6 }, labels: { gap: 0 } }),
    axis({ scale: "y", tick: { length: 6 } }),
  ],
});

/** A PDF's first content stream, inflated. */
async function pdfContent(pdf: Uint8Array): Promise<string> {
  const text = new TextDecoder("latin1").decode(pdf);
  const at = text.indexOf("stream\n") + 7;
  const bytes = pdf.slice(at, text.indexOf("\nendstream", at));
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Response(out).text();
}

/** Where a PDF starts each run of `text` it writes upright: the text matrix's origin. */
function runsOf(content: string, text: string): [number, number][] {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`1 0 0 -1 ([\\d.-]+) ([\\d.-]+) Tm \\(${escaped}\\) Tj`, "g");
  return [...content.matchAll(pattern)].map(([, x, y]) => [Number(x), Number(y)]);
}

describe("tick labels' gap", () => {
  it("stands y labels where x labels stand from their line, painted where the scene puts them", async () => {
    for (const renderer of ["svg", "canvas"] as const) {
      const chart = await mount(options(renderer));
      const scene = sceneOf(chart);
      const left = axisOn(scene, "left");
      const bottom = axisOn(scene, "bottom");
      // 10 px for 16 px text, and 1 px more past 6 px marks: on both axes.
      for (const item of labelsOf(left)) expect(left.edge - item.x).toBe(11);
      for (const item of labelsOf(bottom))
        expect(item.y - (Math.round(bottom.edge) + 0.5)).toBe(11);
      // Every label is drawn in the SVG layer where the scene places it.
      const origin = chart.root.getBoundingClientRect();
      const range = document.createRange();
      const painted = [...chart.root.querySelectorAll("svg text")];
      for (const item of labelsOf(left)) {
        const text = painted.find((node) => node.textContent === item.text)!;
        expect(text.getAttribute("text-anchor")).toBe("end");
        expect(Number(text.getAttribute("x"))).toBe(item.x);
        range.selectNodeContents(text);
        const box = range.getBoundingClientRect();
        expect(Math.abs(box.right - origin.left - item.x)).toBeLessThanOrEqual(2);
      }
      for (const item of labelsOf(bottom)) {
        const text = painted.find(
          (node) => node.textContent === item.text && node.getAttribute("y") === String(item.y),
        )!;
        expect(text.getAttribute("dominant-baseline")).toBe("hanging");
      }
    }
  });

  it("is drawn by static SVG and PDF as the live chart draws it", async () => {
    const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
    const font = standardFont("sans-serif", false);
    for (const renderer of ["svg", "canvas"] as const) {
      const chosen = options(renderer);
      const chart = await mount(chosen);
      const measureText = measurer(document);
      expect(svg(renderToSVG({ ...chosen, width: WIDTH, height: HEIGHT }, { measureText }))).toBe(
        svg(chart.toSVG()),
      );
      const scene = sceneOf(chart);
      const content = await pdfContent(renderToPDF(chart));
      // y labels end where the scene puts their end, their baseline 0.35 em
      // below their middle; x labels hang, their baseline 0.72 em below the
      // line they hang from, and the labels above sit by their middle.
      const checks: [AxisGuide, number][] = [
        [axisOn(scene, "left"), 1],
        [axisOn(scene, "bottom"), 0.5],
        [axisOn(scene, "top"), 0.5],
      ];
      for (const [guide, share] of checks)
        for (const item of labelsOf(guide)) {
          const width = textWidth(encodeText(item.text), font) * item.paint.size;
          const drop = (item.baseline === "hanging" ? 0.72 : 0.35) * item.paint.size;
          const runs = runsOf(content, item.text);
          expect(
            runs.some(
              ([x, y]) =>
                Math.abs(x + width * share - item.x) < 0.02 && Math.abs(y - item.y - drop) < 0.02,
            ),
          ).toBe(true);
        }
    }
  });
});

describe("the crosshair's boxes on y", () => {
  // The boxes are HTML over the chart, each placed by a translation.
  const boxes = (chart: Chart) =>
    [...chart.root.querySelectorAll<HTMLElement>("div[aria-hidden='true'] > div")].filter(
      (box) => box.style.display !== "none" && box.style.transform,
    );

  it("end their text where the y labels end, at the default font and a larger one", async () => {
    for (const fontSize of [12, 16]) {
      const chart = await mount({
        locale: "en-US",
        animation: false,
        legend: false,
        theme: { style: { text: { fontSize } } },
        tooltip: { axisLabels: true },
        marks: [line(data, { x: "x", y: "v" })],
      });
      const left = axisOn(sceneOf(chart), "left");
      const rect = chart.root.getBoundingClientRect();
      const y = yScale(modelOf(chart))!;
      chart.root.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: rect.left + 300,
          clientY: rect.top + y.map(1600),
          pointerId: MOUSE,
        }),
      );
      await expect.poll(() => boxes(chart).length).toBe(2);
      const box = boxes(chart).find((one) => /^1,?6/.test(one.textContent ?? ""))!;
      // The box's text ends its padding (5 px) inside its right side.
      const end = box.getBoundingClientRect().right - rect.left - 5;
      expect(Math.abs(end - labelsOf(left)[0]!.x)).toBeLessThanOrEqual(1);
    }
  });
});
