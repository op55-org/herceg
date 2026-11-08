// Labels the panel's placer places, in every output: series labels moved
// apart with leaders, annotation labels of one overlap group, and a label
// of styled parts over a halo. Live SVG and Canvas draw them alike, and
// static SVG, PNG, and PDF, with the chart's supplied fonts, where the
// browser does, also after the view moves and rows arrive.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, createChart } from "../../src/dom/chart.ts";
import { type Fonts, prepareFonts } from "../../src/fonts.ts";
import { line } from "../../src/marks/line.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import { num } from "../../src/render/pdf-document.ts";
import type { LabelsGeometry, SegmentGeometry, TextItem } from "../../src/scene/scene.ts";
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

const MAGENTA = "#ff00ff";

/**
 * Pixels of `pixels` (RGBA, `width` wide, `scale` pixels per chart pixel)
 * painted `color` (a hex color, or near it) in a box of chart pixels.
 */
function paintedIn(
  pixels: Uint8ClampedArray,
  width: number,
  scale: number,
  box: { x0: number; x1: number; y0: number; y1: number },
  color: string,
): number {
  const want = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
  let painted = 0;
  for (let y = Math.floor(box.y0 * scale); y < Math.ceil(box.y1 * scale); y++)
    for (let x = Math.floor(box.x0 * scale); x < Math.ceil(box.x1 * scale); x++) {
      const i = (y * width + x) * 4;
      if (pixels[i + 3]! > 150 && want.every((value, j) => Math.abs(pixels[i + j]! - value) < 60))
        painted++;
    }
  return painted;
}

/** A stream of a PDF's object `object`, inflated. */
async function streamOf(pdf: Uint8Array, raw: string, object: number): Promise<string> {
  const head = new RegExp(`\\n${object} 0 obj\\n<<([^]*?)>>\\nstream\\n`).exec(raw)!;
  const start = head.index + head[0].length;
  const length = Number(/\/Length (\d+)/.exec(head[1]!)![1]);
  const stream = new Blob([pdf.slice(start, start + length)])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new TextDecoder("latin1").decode(await new Response(stream).arrayBuffer());
}

/**
 * The text a PDF's page fills (its embedded fonts' glyph codes read back
 * through their ToUnicode maps), and where each run starts.
 */
async function pdfTexts(pdf: Uint8Array): Promise<[string, number, number][]> {
  const raw = new TextDecoder("latin1").decode(pdf);
  const unicode = new Map<string, Map<string, string>>();
  for (const [, name, font] of raw.matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const at = new RegExp(`\\n${font} 0 obj\\n<<[^\\n]*?/ToUnicode (\\d+) 0 R`).exec(raw)!;
    const cmap = await streamOf(pdf, raw, Number(at[1]));
    const codes = new Map<string, string>();
    for (const [, code, text] of cmap.matchAll(/<([0-9a-f]{4})> <([0-9a-f]+)>/g))
      codes.set(
        code!,
        String.fromCharCode(...text!.match(/.{4}/g)!.map((u) => Number.parseInt(u, 16))),
      );
    unicode.set(name!, codes);
  }
  const page = await inflated(pdf);
  const runs = page.matchAll(
    /BT \/(F\d+) [\d.]+ Tf 0 Tr (?:-?[\d.]+ ){4}(-?[\d.]+) (-?[\d.]+) Tm <([0-9a-f]*)> Tj ET/g,
  );
  return [...runs].map(([, font, x, y, hex]) => [
    hex!
      .match(/.{4}/g)
      ?.map((code) => unicode.get(font!)!.get(code)!)
      .join("") ?? "",
    Number(x),
    Number(y),
  ]);
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

  contractTest("labels.attach.export.live", async () => {
    // Four lines named at the last rows in view, moved apart outside the plot
    // with leaders in their colors, and two rules whose labels keep apart, the
    // second's leader in its rule's color; every label magenta. Zoomed, then
    // streamed, then panned to the new rows: the exports draw what the live
    // chart does, where it does.
    const rowsAt = (t: number) => ({
      t: [t, t, t, t],
      v: [50, 51, 52, 53],
      g: ["a", "b", "c", "d"],
      note: ["a", "b", "c", "d"].map((g) => `${g}${t}`),
    });
    const first = Array.from({ length: 11 }, (_, t) => rowsAt(t));
    const live = table(
      {
        t: first.flatMap(({ t }) => t),
        v: first.flatMap(({ v }) => v),
        g: first.flatMap(({ g }) => g),
        note: first.flatMap(({ note }) => note),
      },
      { maxRows: 100 },
    );
    const event = (x: number, text: string) =>
      rule({
        x,
        stroke: "#c0392b",
        label: {
          text,
          style: { color: MAGENTA },
          overlap: "move",
          overlapGroup: "events",
          leader: { strokeWidth: 3 },
        },
      });
    const chart = createChart(host, {
      locale: "en-US",
      renderer: "svg",
      legend: false,
      fonts: await suppliedFonts(),
      theme: { style: { text: { font: "Fixture, sans-serif" } } },
      x: { nice: false },
      y: { domain: [0, 100], nice: false },
      marks: [
        line(live, {
          x: "t",
          y: "v",
          series: "g",
          labels: {
            at: "visible-end",
            content: [{ field: "note" }],
            place: { outside: true },
            leader: { strokeWidth: 3 },
            style: { color: MAGENTA },
          },
        }),
        event(3.2, "Black Friday"),
        event(3, "Outage"),
      ],
    });
    await chart.loading;
    chart.setViewport({ x: [0, 8.5] });
    chart.render();
    expect(drawnLabels(chart).map(({ text }) => text)).toContain("a8");
    live.append(rowsAt(11));
    live.append(rowsAt(12));
    chart.setViewport({ x: [3, 11.5] });
    chart.render();

    const scene = (chart as unknown as ExportsScene)[EXPORT_SCENE]((drawn) => drawn);
    const marks = scene.panels.flatMap((panel) => panel.marks);
    const leaders = marks.filter((g): g is SegmentGeometry => g.kind === "segments");
    const drawn = drawnLabels(chart);
    expect(drawn.map(({ text }) => text).sort()).toEqual(
      ["Black Friday", "Outage", "a11", "b11", "c11", "d11"].sort(),
    );
    const red = leaders.filter(({ stroke }) => stroke === "#c0392b");
    expect(red).toHaveLength(1);
    expect(leaders.length).toBeGreaterThan(2);

    // Live and static SVG draw each leader's path in its color, and each label where the scene
    // places it, saying what it says (the PNG rasterizes the static markup).
    const paths = (root: ParentNode) =>
      [...root.querySelectorAll("path")].map(
        (p) => `${p.getAttribute("stroke")} ${p.getAttribute("d")}`,
      );
    const markup = new DOMParser().parseFromString(chart.toSVG(), "image/svg+xml");
    const svgContext = { theme: scene.theme, encodeRaster: undefined };
    const leaderPaths = leaders.map(
      (g) => `${g.stroke} ${g.draw.elements!(g, svgContext)![0]!.attributes.d}`,
    );
    for (const root of [chart.root.querySelector("svg")!, markup]) {
      expect(paths(root)).toEqual(expect.arrayContaining(leaderPaths));
      const written = texts(root);
      for (const [label, x, y] of placement(drawn))
        expect(
          written.some(
            ([t, wx, wy]) => t === label && Math.abs(wx - x) < 0.051 && Math.abs(wy - y) < 0.051,
          ),
          `${label} at ${x}, ${y}`,
        ).toBe(true);
    }

    // Where each label's text starts, and its box, in the supplied font.
    const fonts = await suppliedFonts();
    const boxes = drawn.map((label) => {
      const width = fonts.measure(label.text, label.paint.css);
      const x0 =
        label.x - width * (label.anchor === "end" ? 1 : label.anchor === "middle" ? 0.5 : 0);
      const size = label.paint.size;
      const [y0, y1] =
        label.baseline === "alphabetic"
          ? [label.y - 0.8 * size, label.y]
          : label.baseline === "middle"
            ? [label.y - 0.45 * size, label.y + 0.45 * size]
            : [label.y, label.y + 0.8 * size];
      return { label, x0, x1: x0 + width, y0, y1 };
    });
    expect(drawn.every(({ angle }) => angle === 0)).toBe(true);

    // The PDF sets each label's text where it starts, its baseline within its
    // line, and strokes each leader in its color along the same points.
    const { renderToPDF } = await import("../../src/pdf.ts");
    const exported = renderToPDF(chart);
    const pdf = await inflated(exported);
    const set = await pdfTexts(exported);
    for (const { label, x0 } of boxes) {
      const below = label.baseline === "alphabetic" ? [-0.01, 0.01] : [0, label.paint.size];
      expect(
        set.some(
          ([text, x, y]) =>
            text === label.text &&
            Math.abs(x - x0) < 0.05 &&
            y - label.y >= below[0]! &&
            y - label.y <= below[1]!,
        ),
        `PDF sets "${label.text}" at ${x0}, ${label.y}`,
      ).toBe(true);
    }
    const pdfColor = (hex: string) =>
      [1, 3, 5]
        .map((i) => Number((Number.parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(3)))
        .join(" ");
    for (const leader of leaders) {
      const painted = new RegExp(
        `q(?: /\\w+ gs)? ${pdfColor(leader.stroke)} RG [^\\n]*\\n([^Q]*?)S\\nQ`,
        "g",
      );
      const c = leader.coords;
      const path = Array.from(
        { length: leader.count },
        (_, k) =>
          `${num(c[k * 4]!)} ${num(c[k * 4 + 1]!)} m\n${num(c[k * 4 + 2]!)} ${num(c[k * 4 + 3]!)} l\n`,
      ).join("");
      expect([...pdf.matchAll(painted)].map(([, stroked]) => stroked)).toContain(path);
    }

    // The PNG paints each leader's middle in its color.
    const bitmap = await createImageBitmap(await chart.toPNG());
    const surface = document.createElement("canvas");
    [surface.width, surface.height] = [bitmap.width, bitmap.height];
    const context = surface.getContext("2d")!;
    context.drawImage(bitmap, 0, 0);
    const scale = bitmap.width / host.clientWidth;
    for (const leader of leaders)
      for (let k = 0; k < leader.count; k++) {
        const c = leader.coords;
        const [x, y] = [(c[k * 4]! + c[k * 4 + 2]!) / 2, (c[k * 4 + 1]! + c[k * 4 + 3]!) / 2];
        const { data } = context.getImageData(
          Math.round(x * scale) - 1,
          Math.round(y * scale) - 1,
          3,
          3,
        );
        const want = [1, 3, 5].map((i) => Number.parseInt(leader.stroke.slice(i, i + 2), 16));
        const near = (i: number) => want.every((value, j) => Math.abs(data[i + j]! - value) < 40);
        expect(
          [0, 1, 2, 3, 4, 5, 6, 7, 8].some((p) => near(p * 4)),
          `${leader.stroke} leader at ${x}, ${y}`,
        ).toBe(true);
      }
    // And each label in its box.
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    for (const { label, ...box } of boxes)
      expect(
        paintedIn(data, bitmap.width, scale, box, MAGENTA),
        `PNG paints "${label.text}"`,
      ).toBeGreaterThan(10);
    chart.destroy();
  });
});
