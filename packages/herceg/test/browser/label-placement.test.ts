// Labels the panel's placer places, in every output: series labels moved
// apart with leaders, annotation labels of one overlap group, and a label
// of styled parts over a halo. Live SVG and Canvas draw them alike, and
// static SVG, PNG, and PDF, with the chart's supplied fonts, where the
// browser does.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, createChart } from "../../src/dom/chart.ts";
import { type Fonts, prepareFonts } from "../../src/fonts.ts";
import { line } from "../../src/marks/line.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import type { LabelsGeometry, TextItem } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:500px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

const fixture = async (name: string) =>
  new Uint8Array(
    await (
      await fetch(new URL(`../fixtures/pdf-fonts/${name}.ttf`, import.meta.url))
    ).arrayBuffer(),
  );

let fonts: Fonts | undefined;
async function suppliedFonts(): Promise<Fonts> {
  fonts ??= prepareFonts([
    { family: "Fixture", data: await fixture("sans") },
    { family: "Fixture", weight: "bold", data: await fixture("sans-bold") },
  ]);
  return fonts;
}

const series = table({ t: [0, 10], a: [50, 51], b: [51, 52], c: [52, 53] });
const peaks = table({ t: [3], v: [80], name: ["Peak"] });

async function mount(renderer: "svg" | "canvas"): Promise<Chart> {
  const chart = createChart(host, {
    locale: "en-US",
    renderer,
    legend: false,
    fonts: await suppliedFonts(),
    theme: { style: { text: { font: "Fixture, sans-serif" } } },
    x: { domain: [0, 10] },
    y: { domain: [0, 100] },
    marks: [
      line(series, { x: "t", y: ["a", "b", "c"], labels: { at: "last", leader: true } }),
      rule({ x: 5, label: { text: "Deploy", overlap: "move", overlapGroup: "events" } }),
      rule({ x: 5.1, label: { text: "Outage", overlap: "move", overlapGroup: "events" } }),
      text(peaks, {
        x: "t",
        y: "v",
        label: {
          content: [
            { field: "name", style: { fontWeight: 700, color: "#ff0000" } },
            " ",
            { field: "v", style: { opacity: 0.6 } },
          ],
          style: { halo: "auto" },
        },
      }),
    ],
  });
  await chart.loading;
  chart.render();
  return chart;
}

/** The text items of the labels the chart draws, fills only (a part's halo is an item of its own). */
function drawnLabels(chart: Chart): TextItem[] {
  const scene = (chart as unknown as ExportsScene)[EXPORT_SCENE]((drawn) => drawn);
  return scene.panels
    .flatMap((panel) => panel.marks)
    .flatMap((g) => (g.kind === "labels" ? (g as LabelsGeometry).items : []))
    .filter((item) => item.paint.color !== "transparent");
}

const placement = (items: TextItem[]): [string, number, number][] =>
  items.map(({ text, x, y }) => [text, Math.round(x * 100) / 100, Math.round(y * 100) / 100]);

/** Each SVG text's content and place, as written (to a tenth of a pixel). */
function texts(root: ParentNode): [string, number, number][] {
  return [...root.querySelectorAll("text")].map((t) => [
    t.textContent ?? "",
    Number(t.getAttribute("x")),
    Number(t.getAttribute("y")),
  ]);
}

/** What a PDF's compressed streams hold, inflated: its pages' drawing. */
async function inflated(pdf: Uint8Array): Promise<string> {
  const latin1 = new TextDecoder("latin1");
  const raw = latin1.decode(pdf);
  let out = "";
  for (const match of raw.matchAll(/>>\nstream\n/g)) {
    const start = match.index + match[0].length;
    const dictionary = raw.slice(raw.lastIndexOf("<<", start), start);
    if (!dictionary.includes("/FlateDecode")) continue;
    const length = Number(/\/Length (\d+)/.exec(dictionary)![1]);
    const stream = new Blob([pdf.slice(start, start + length)])
      .stream()
      .pipeThrough(new DecompressionStream("deflate"));
    out += latin1.decode(await new Response(stream).arrayBuffer());
  }
  return out;
}

/** Red pixels of `pixels` (RGBA, `width` wide, `scale` pixels per chart pixel) in the box of `item`. */
function redIn(
  pixels: Uint8ClampedArray,
  width: number,
  scale: number,
  item: TextItem,
  textWidth: number,
): number {
  let red = 0;
  const [x0, x1] = [Math.floor(item.x * scale), Math.ceil((item.x + textWidth) * scale)];
  const [y0, y1] = [Math.floor((item.y - item.paint.size) * scale), Math.ceil(item.y * scale)];
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      if (pixels[i]! > 180 && pixels[i + 1]! < 90 && pixels[i + 2]! < 90 && pixels[i + 3]! > 150)
        red++;
    }
  return red;
}

describe("placed labels", () => {
  contractTest("label.placement.renderers", async () => {
    const svg = await mount("svg");
    const drawn = drawnLabels(svg);
    // Three series labels, two event labels, and the styled label's parts.
    expect(drawn.map(({ text }) => text)).toEqual(
      expect.arrayContaining(["a", "b", "c", "Deploy", "Outage", "Peak", " ", "80"]),
    );
    // The live SVG writes each where the scene places it.
    const written = texts(svg.root.querySelector("svg")!);
    for (const [label, x, y] of placement(drawn))
      expect(
        written.some(
          ([t, wx, wy]) => t === label && Math.abs(wx - x) < 0.051 && Math.abs(wy - y) < 0.051,
        ),
        `${label} at ${x}, ${y}`,
      ).toBe(true);
    const peak = drawn.find(({ text }) => text === "Peak")!;
    const peakWidth = (await suppliedFonts()).measure("Peak", peak.paint.css);
    svg.destroy();

    // A canvas lays them out alike, and paints the red part in red over the halos.
    const canvas = await mount("canvas");
    expect(placement(drawnLabels(canvas))).toEqual(placement(drawn));
    const element = host.querySelector("canvas")!;
    const scale = element.width / host.clientWidth;
    const { data } = element.getContext("2d")!.getImageData(0, 0, element.width, element.height);
    expect(redIn(data, element.width, scale, peak, peakWidth)).toBeGreaterThan(10);
    canvas.destroy();
  });

  contractTest("label.placement.static", async () => {
    const chart = await mount("svg");
    const drawn = drawnLabels(chart);
    const live = texts(chart.root.querySelector("svg")!);
    // Static SVG writes every label where the live chart does.
    const markup = new DOMParser().parseFromString(chart.toSVG(), "image/svg+xml");
    const written = texts(markup);
    for (const [label, x, y] of placement(drawn)) {
      const at = (list: [string, number, number][]) =>
        list.find(
          ([t, wx, wy]) => t === label && Math.abs(wx - x) < 0.051 && Math.abs(wy - y) < 0.051,
        );
      expect(at(live), `live ${label}`).toBeDefined();
      expect(at(written), `static ${label}`).toBeDefined();
    }

    // The PDF sets each styled part at its baseline's start, as the scene does.
    const { renderToPDF } = await import("../../src/pdf.ts");
    const pdf = await inflated(renderToPDF(chart));
    const set = [...pdf.matchAll(/ (\d) Tr (?:-?[\d.]+ ){4}(-?[\d.]+) (-?[\d.]+) Tm/g)].map(
      ([, mode, x, y]) => [Number(mode), Number(x), Number(y)] as const,
    );
    for (const part of drawn.filter(({ baseline }) => baseline === "alphabetic")) {
      // Filled once; its halo stroked once before every part's fill.
      const fill = set.findIndex(
        ([mode, x, y]) => mode === 0 && Math.abs(x - part.x) < 0.01 && Math.abs(y - part.y) < 0.01,
      );
      const halo = set.findIndex(
        ([mode, x, y]) => mode === 1 && Math.abs(x - part.x) < 0.01 && Math.abs(y - part.y) < 0.01,
      );
      expect(fill, `PDF fills "${part.text}"`).toBeGreaterThanOrEqual(0);
      if (part.text.trim()) expect(halo, `PDF strokes "${part.text}"`).toBeGreaterThanOrEqual(0);
    }
    expect(pdf).toContain("1 0 0 rg");

    // The PNG paints the red part in red where the browser does.
    const peak = drawn.find(({ text }) => text === "Peak")!;
    const width = (await suppliedFonts()).measure("Peak", peak.paint.css);
    const bitmap = await createImageBitmap(await chart.toPNG());
    const surface = document.createElement("canvas");
    [surface.width, surface.height] = [bitmap.width, bitmap.height];
    const context = surface.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    expect(redIn(data, bitmap.width, bitmap.width / host.clientWidth, peak, width)).toBeGreaterThan(
      10,
    );
    chart.destroy();
  });
});
