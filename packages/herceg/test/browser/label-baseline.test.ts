// Text placed by its baseline in the browser: marks' labels painted with
// their first line's baseline at their point in SVG and on canvases, as the
// engine's own fonts put a baseline (found from text drawn on a known
// baseline beside them, not from pixel numbers seen on one machine), and
// drawn by static SVG and PDF as the live chart draws them.
import { afterEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { line } from "../../src/marks/line.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { LabelsGeometry, Scene, TextItem } from "../../src/scene/scene.ts";
import type { LabelStyle } from "../../src/spec/spec.ts";
import { contractTest } from "../helpers/contracts.ts";

const WIDTH = 480;
const HEIGHT = 300;
const SIZE = 24;
const FONT = "sans-serif";
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
  host.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px;background:#ffffff`;
  document.body.append(host);
  const chart = createChart(host, options);
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

const sceneOf = (chart: Chart): Scene =>
  (chart as unknown as ExportsScene)[EXPORT_SCENE]((scene) => scene);

/** The alphabetic text items of the scene's labels: what "baseline" places. */
const placed = (scene: Scene): TextItem[] =>
  scene.panels[0]!.marks.flatMap((g) =>
    g.kind === "labels"
      ? (g as LabelsGeometry).items.filter((item) => item.baseline === "alphabetic")
      : [],
  );

/** Black capitals and x's, which sit on the baseline: no descenders. */
const style: LabelStyle = {
  verticalAlign: "baseline",
  font: FONT,
  fontSize: SIZE,
  color: "#000000",
  halo: false,
};
const data = table({ x: [0, 10], v: [0, 50] });

const options = (renderer: "svg" | "canvas"): ChartOptions => ({
  renderer,
  locale: "en-US",
  animation: false,
  legend: false,
  x: { domain: [0, 12] },
  y: { domain: [0, 100] },
  marks: [
    line(data, { x: "x", y: "v", labels: { at: "last", content: ["HXH"], style } }),
    text({ x: 2, y: 80, label: { text: "HHxx", style } }),
    text({ x: 6, y: 80, label: { text: "XHX\nHH", style: { ...style, align: "center" } } }),
    rule({ y: 25, label: { text: "HXX", style: { ...style, align: "start" } } }),
  ],
});

/**
 * How far below its baseline text in the font is painted to (its range's
 * bottom in SVG), as this engine paints text on a known baseline.
 */
function svgDescent(svg: SVGSVGElement, content: string): number {
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
  probe.setAttribute("x", "0");
  probe.setAttribute("y", "200");
  probe.setAttribute("font-family", FONT);
  probe.setAttribute("font-size", String(SIZE));
  probe.textContent = content;
  svg.append(probe);
  const range = document.createRange();
  range.selectNodeContents(probe);
  const bottom = range.getBoundingClientRect().bottom - svg.getBoundingClientRect().top;
  probe.remove();
  return bottom - 200;
}

/** The last row of ink of `content` drawn black on its baseline at y 100 of a canvas, at `dpr`. */
function canvasInk(content: string, dpr: number): number {
  const canvas = document.createElement("canvas");
  canvas.width = 400 * dpr;
  canvas.height = 200 * dpr;
  const context = canvas.getContext("2d")!;
  context.scale(dpr, dpr);
  context.font = `${SIZE}px ${FONT}`;
  context.textBaseline = "alphabetic";
  context.fillText(content, 10, 100);
  return lastInk(context, 0, canvas.width, canvas.height) / dpr - 100;
}

/** The bottom (in device pixels) of the lowest row with ink between columns `from` and `to`. */
function lastInk(
  context: CanvasRenderingContext2D,
  from: number,
  to: number,
  rows: number,
): number {
  const { data } = context.getImageData(from, 0, to - from, rows);
  const width = to - from;
  for (let row = rows - 1; row >= 0; row--)
    for (let column = 0; column < width; column++) {
      const k = (row * width + column) * 4;
      // Black ink, opaque enough: the labels', not a series' color or a grid line's.
      if (data[k + 3]! > 128 && Math.max(data[k]!, data[k + 1]!, data[k + 2]!) < 96) return row + 1;
    }
  return Number.NaN;
}

describe("text placed by its baseline", () => {
  contractTest("label.baseline.painted", async () => {
    // SVG: written at its point with no dominant-baseline, and painted there.
    const live = await mount(options("svg"));
    const items = placed(sceneOf(live));
    expect(items.map((item) => item.text).sort()).toEqual(["HHxx", "HXH", "HXX", "XHX\nHH"]);
    const svg = [...live.root.querySelectorAll("svg")].find((one) =>
      [...one.querySelectorAll("text")].some((node) => node.textContent === "HHxx"),
    )!;
    const origin = svg.getBoundingClientRect();
    for (const item of items) {
      const first = item.text.split("\n")[0]!;
      const node = [...svg.querySelectorAll("text")].find((one) =>
        (one.textContent ?? "").startsWith(first),
      )!;
      expect(node.hasAttribute("dominant-baseline")).toBe(false);
      expect(Number(node.getAttribute("y"))).toBeCloseTo(item.y, 1);
      const range = document.createRange();
      range.selectNodeContents(node.querySelector("tspan") ?? node);
      const painted = range.getBoundingClientRect().bottom - origin.top - svgDescent(svg, first);
      expect(Math.abs(painted - item.y)).toBeLessThanOrEqual(1);
      // Its second line a line height lower.
      const second = node.querySelectorAll("tspan")[1];
      if (second)
        expect(Number(second.getAttribute("y"))).toBeCloseTo(item.y + item.paint.lineHeight, 1);
    }
    // Canvas: its glyphs' ink ends on the baseline where text drawn on a known baseline ends.
    const chart = await mount(options("canvas"));
    const scene = sceneOf(chart);
    const canvases = [...chart.root.querySelectorAll("canvas")];
    expect(
      placed(scene)
        .map((item) => item.text)
        .sort(),
    ).toEqual(["HHxx", "HXH", "HXX", "XHX\nHH"]);
    for (const item of placed(scene)) {
      const first = item.text.split("\n")[0]!;
      // Drawn on the canvas, not in SVG over it.
      const inSvg = [...chart.root.querySelectorAll("svg text")].some(
        (node) => node.textContent === item.text.replace("\n", ""),
      );
      expect(inSvg).toBe(false);
      const canvas = canvases.find((one) => one.width > 0)!;
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      const width = measurer(document)(first, item.paint.css);
      const start =
        item.anchor === "start"
          ? item.x
          : item.anchor === "end"
            ? item.x - width
            : item.x - width / 2;
      const context = canvas.getContext("2d")!;
      // The ink of its first line only: rows above its next line's capitals.
      const rows = Math.floor((item.y + 0.25 * SIZE) * dpr);
      const ink = lastInk(context, Math.floor(start * dpr), Math.ceil((start + width) * dpr), rows);
      expect(Math.abs(ink / dpr - canvasInk(first, dpr) - item.y)).toBeLessThanOrEqual(1);
    }
  });

  contractTest("label.baseline.boxed", async () => {
    // A box placed by its text's baseline holds the painted text as a box
    // placed by its middle does, by the engine's own fonts.
    const boxed = (verticalAlign: NonNullable<LabelStyle["verticalAlign"]>) => ({
      ...style,
      verticalAlign,
      background: { fill: "#dddddd" },
      padding: 3,
    });
    const chart = await mount({
      renderer: "svg",
      locale: "en-US",
      animation: false,
      legend: false,
      x: { domain: [0, 10] },
      y: { domain: [0, 100] },
      marks: [
        text({ x: 3, y: 70, label: { text: "Hxa", style: boxed("baseline") } }),
        text({ x: 7, y: 70, label: { text: "Hxb", style: boxed("middle") } }),
      ],
    });
    const inBox = (content: string) => {
      const node = [...chart.root.querySelectorAll("svg text")].find(
        (one) => one.textContent === content,
      )!;
      const box = node.previousElementSibling as SVGRectElement;
      expect(box.tagName).toBe("rect");
      const range = document.createRange();
      range.selectNodeContents(node);
      const painted = range.getBoundingClientRect();
      const rect = box.getBoundingClientRect();
      return [painted.top - rect.top, rect.bottom - painted.bottom];
    };
    const [top, bottom] = inBox("Hxa");
    const [middleTop, middleBottom] = inBox("Hxb");
    expect(Math.abs(top! - middleTop!)).toBeLessThanOrEqual(1);
    expect(Math.abs(bottom! - middleBottom!)).toBeLessThanOrEqual(1);
  });

  contractTest("label.baseline.export", async () => {
    // Static SVG measured with the page's fonts draws what the live chart
    // draws; PDF runs start on the baseline at the point.
    const svg = (markup: string) => markup.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
    for (const renderer of ["svg", "canvas"] as const) {
      const chosen = options(renderer);
      const chart = await mount(chosen);
      const measureText = measurer(document);
      expect(svg(renderToSVG({ ...chosen, width: WIDTH, height: HEIGHT }, { measureText }))).toBe(
        svg(chart.toSVG()),
      );
      const content = await pdfContent(renderToPDF(chart));
      for (const item of placed(sceneOf(chart))) {
        const first = item.text.split("\n")[0]!;
        expect(runsOf(content, first).some(([, y]) => Math.abs(y - item.y) < 0.02)).toBe(true);
      }
    }
  });
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
