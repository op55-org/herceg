// Treemaps and sunbursts against their references. B8, D3's Marimekko: a
// slice-and-dice layout of markets by segment, cells colored by segment at
// their share, 1 px gaps, names in each cell's corner. B3, the zoomable
// sunburst: two rings around a third of the radius, lighter leaves, names
// along the radius, drilled in by a click and out through the empty middle.
// On a canvas at pixel ratios 1, 1.5, and 2, gaps are whole device pixels
// and edges meet on one boundary, where SVG and PDF keep the layout's own
// numbers; a mounted chart's static SVG, PNG, and PDF draw what it shows.

import "./interactive.ts";
import { afterEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { renderToImage } from "../../src/image.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { LIGHT, paletteColor } from "../../src/theme.ts";
import { modelOf, pageOrigin, realMouse } from "./helpers.ts";

const mounted: Chart[] = [];
const hosts: HTMLElement[] = [];
const ratio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio")!;
afterEach(() => {
  for (const chart of mounted.splice(0)) chart.destroy();
  for (const host of hosts.splice(0)) host.remove();
  Object.defineProperty(window, "devicePixelRatio", ratio);
});

async function mount(size: string, options: ChartOptions): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = size;
  document.body.append(host);
  hosts.push(host);
  const chart = createChart(host, { locale: "en-US", ...options });
  mounted.push(chart);
  await chart.loading;
  await frame();
  return chart;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A color as red, green, and blue. */
function rgb(color: string): [number, number, number] {
  const hex = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color)!;
  return [parseInt(hex[1]!, 16), parseInt(hex[2]!, 16), parseInt(hex[3]!, 16)];
}

/** `color` at `opacity` over white, as a canvas blends it. */
function overWhite(color: string, opacity: number): [number, number, number] {
  return rgb(color).map((c) => c * opacity + 255 * (1 - opacity)) as [number, number, number];
}

/** The canvas's pixels, each over white (the page under a transparent canvas). */
function pixels(chart: Chart) {
  const canvas = chart.root.querySelector("canvas")!;
  const data = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  return {
    width: canvas.width,
    height: canvas.height,
    at(x: number, y: number): [number, number, number] {
      const i = (y * canvas.width + x) * 4;
      const a = data[i + 3]! / 255;
      return [0, 1, 2].map((c) => data[i + c]! * a + 255 * (1 - a)) as [number, number, number];
    },
  };
}

const near = (a: readonly number[], b: readonly number[], within = 3) =>
  a.every((v, i) => Math.abs(v - b[i]!) <= within);
const white = (pixel: readonly number[]) => near(pixel, [255, 255, 255], 1);

// B8: four markets by four segments, D3's figures, in input order.
const MARKETS = ["Auburn, AL", "Birmingham, AL", "Gainesville, FL", "Durham, NC"];
const SEGMENTS = ["Almond lovers", "Berry buyers", "Carrots-n-more", "Delicious-n-new"];
const VALUES = [
  [3840, 1920, 960, 400],
  [1600, 1440, 960, 400],
  [640, 960, 640, 400],
  [320, 480, 640, 400],
];
const sales = () =>
  table({
    market: MARKETS.flatMap((m) => SEGMENTS.map(() => m)),
    segment: MARKETS.flatMap(() => SEGMENTS),
    value: VALUES.flat(),
  });
// A frame of awkward size, so edges fall between device pixels.
const [W, H] = [601, 333];
const B8_SIZE = `width:${W}px;height:${H}px`;
const marimekko = () =>
  treemap(sales(), {
    id: "cells",
    path: ["market", "segment"],
    value: "value",
    tile: "slice-dice",
    sort: "input",
    gap: 1,
    color: "segment",
    fillOpacity: { measure: "share", range: [0.5, 1] },
    labels: {
      at: "top-left",
      parents: false,
      content: [{ field: "segment" }, "\n", { value: true, style: { opacity: 0.7 } }],
    },
  });
const b8 = (renderer: "canvas" | "svg") =>
  mount(B8_SIZE, { renderer, padding: 0, legend: false, marks: [marimekko()] });

/**
 * The reference's cuts: each market's column its share of the whole across,
 * each segment its share of the market down, from the top. (D3 draws each
 * cell from its cuts less a pixel on its right and bottom.)
 */
function reference() {
  const total = VALUES.flat().reduce((a, b) => a + b, 0);
  let before = 0;
  return VALUES.map((row) => {
    const sum = row.reduce((a, b) => a + b, 0);
    const column = { x0: before / total, x1: (before + sum) / total, cells: [] as Cell[] };
    before += sum;
    let above = 0;
    for (const v of row) {
      column.cells.push({ y0: above / sum, y1: (above + v) / sum, share: v / sum });
      above += v;
    }
    return column;
  });
}
interface Cell {
  y0: number;
  y1: number;
  share: number;
}

/**
 * Where Herceg cuts a span at a share with 1 px gaps, as D3's `paddingInner`
 * does: siblings split their parent widened by half the gap each side, then
 * each gives half the gap up each side; at most half a gap from the
 * reference's cut, which is `share * span`.
 */
const cut = (share: number, span: number) => share * (span + 1) - 0.5;

/** The opacity a share is drawn at: 0.5 to 1, in the canvas's 8-bit steps. */
const opacityOf = (share: number) => Math.round((0.5 + share * 0.5) * 255) / 255;

/** Runs of white along a line of pixels: [first, past the last]. */
function whiteRuns(line: readonly (readonly number[])[]): [number, number][] {
  const runs: [number, number][] = [];
  for (let i = 0; i < line.length; i++) {
    if (!white(line[i]!)) continue;
    const start = i;
    while (i < line.length && white(line[i]!)) i++;
    runs.push([start, i]);
  }
  return runs;
}

describe("B8, a Marimekko", () => {
  for (const scale of [1, 1.5, 2]) {
    it(`matches the reference on a canvas at a pixel ratio of ${scale}, gaps whole device pixels`, async () => {
      Object.defineProperty(window, "devicePixelRatio", { value: scale, configurable: true });
      const chart = await b8("canvas");
      const image = pixels(chart);
      const columns = reference();
      const gap = Math.max(1, Math.round(scale));
      // A gap about a cut: whole device pixels, split about the cut rounded once.
      const gapAt = (at: number) => Math.round(at * scale) - Math.floor(gap / 2);
      // Every cell its segment's color at its share, sampled low in the cell, away from its names.
      const colorOf = (s: number, cell: Cell) =>
        overWhite(paletteColor(LIGHT, s), opacityOf(cell.share));
      for (const [m, { x0, x1, cells }] of columns.entries())
        for (const [s, cell] of cells.entries()) {
          const x = Math.floor(((x0 + x1) / 2) * W * scale);
          const y = Math.floor((cell.y1 * H - 3) * scale);
          expect(near(image.at(x, y), colorOf(s, cell)), `${MARKETS[m]}, ${SEGMENTS[s]}`).toBe(
            true,
          );
        }
      // Across the cells, below every column's names: the cells' colors, and
      // between columns white runs of exactly the device gap, nothing blurred
      // (but the last pixel where the frame ends inside it).
      const y = Math.floor(50 * scale);
      const across = Array.from({ length: Math.floor(W * scale) }, (_, x) => image.at(x, y));
      const colors = columns.flatMap(({ cells }) => cells.map((cell, s) => colorOf(s, cell)));
      const blurred = across.flatMap((pixel, x) =>
        white(pixel) || colors.some((c) => near(pixel, c)) ? [] : [[x, pixel.map(Math.round)]],
      );
      expect(JSON.stringify(blurred)).toBe("[]");
      const runs = whiteRuns(across);
      expect(runs.map(([a, b]) => b - a)).toEqual([gap, gap, gap]);
      for (const [i, [start]] of runs.entries()) {
        const share = columns[i]!.x1;
        expect(start).toBe(gapAt(cut(share, W)));
        expect(Math.abs(cut(share, W) - share * W)).toBeLessThanOrEqual(0.5);
      }
      // Down each column, beside its right edge: three gaps between four cells.
      for (const [m, { x1, cells }] of columns.entries()) {
        const x = Math.floor((cut(x1, W) - 2) * scale);
        const down = Array.from({ length: Math.floor(H * scale) }, (_, y) => image.at(x, y));
        const gaps = whiteRuns(down);
        expect(
          gaps.map(([a, b]) => b - a),
          MARKETS[m],
        ).toEqual([gap, gap, gap]);
        for (const [s, [start]] of gaps.entries()) expect(start).toBe(gapAt(cut(cells[s]!.y1, H)));
      }
      // The outer edges stay on the frame's: no gap at the left or the top.
      expect(white(image.at(0, y))).toBe(false);
      expect(white(image.at(Math.floor((W * scale) / 2), 0))).toBe(false);
    });
  }

  it("keeps its continuous layout in SVG, with names in each cell's corner", async () => {
    const chart = await b8("svg");
    const drawn = [...chart.root.querySelectorAll("path")]
      .flatMap((path) => [
        ...(path.getAttribute("d") ?? "").matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)/g),
      ])
      .map((m) => m.slice(1, 5).map(Number) as [number, number, number, number]);
    for (const [m, column] of reference().entries())
      for (const [s, cell] of column.cells.entries()) {
        // Half the gap off each side that faces a neighbor; outer sides on the frame's.
        const x0 = m > 0 ? cut(column.x0, W) + 0.5 : 0;
        const x1 = m < 3 ? cut(column.x1, W) - 0.5 : W;
        const y0 = s > 0 ? cut(cell.y0, H) + 0.5 : 0;
        const y1 = s < 3 ? cut(cell.y1, H) - 0.5 : H;
        // SVG writes tenths of a pixel.
        const found = drawn.find(
          ([x, y, w, h]) =>
            Math.abs(x - x0) <= 0.051 &&
            Math.abs(y - y0) <= 0.051 &&
            Math.abs(x + w - x1) <= 0.11 &&
            Math.abs(y + h - y1) <= 0.11,
        );
        expect(found, `${MARKETS[m]}, ${SEGMENTS[s]}`).toBeDefined();
      }
    // Each name and value written from the corner of the cells with room for them.
    const texts = [...chart.root.querySelectorAll("text")];
    const auburn = texts.find((t) => t.textContent?.includes("Almond lovers"))!;
    expect(Number(auburn.getAttribute("x"))).toBeLessThan(8);
    const written = texts.map((t) => t.textContent).join(" ");
    expect(written).toContain("3,840");
    // The markets are not named: parents: false keeps their names out and no strip above.
    expect(written).not.toContain("Auburn");
  });

  it("lists its segments in the legend in input order, and lays the columns out again without one hidden", async () => {
    const chart = await mount(B8_SIZE, {
      renderer: "svg",
      padding: 0,
      legend: true,
      marks: [marimekko()],
    });
    const entries = [...chart.root.querySelectorAll("button")].filter((b) =>
      SEGMENTS.includes(b.textContent!),
    );
    expect(entries.map((b) => b.textContent)).toEqual(SEGMENTS);
    entries[0]!.click();
    await frame();
    const drawn = modelOf(chart).items!.result()!.items!();
    expect(drawn.some((item) => item.label.endsWith("Almond lovers"))).toBe(false);
    // Each market's column its share of what is left: Auburn's 3,280 of 9,600.
    const auburn = drawn.find((item) => item.label === "Auburn, AL")!;
    const width = drawn.find((item) => item.label === "Durham, NC")!.box;
    expect(auburn.box.width / (width.x + width.width)).toBeCloseTo(3280 / 9600, 2);
  });

  it("draws in its static SVG, PNG, and PDF what the live chart shows", async () => {
    const live = await b8("svg");
    // SVG: the static file's rectangles are the live chart's.
    const paths = (root: ParentNode) =>
      [...root.querySelectorAll("path")]
        .map((p) => p.getAttribute("d")!)
        .filter((d) => d?.includes("h"));
    const file = new DOMParser().parseFromString(renderToSVG(live), "image/svg+xml");
    expect(paths(file).sort()).toEqual(paths(live.root).sort());
    // PNG, drawn from the chart's SVG, at two image pixels per CSS pixel: the
    // cells' colors as the canvas paints them, and white at each cut.
    const canvas = await b8("canvas");
    const image = await createImageBitmap(await renderToImage(canvas, { dpi: 192 }));
    const raster = new OffscreenCanvas(image.width, image.height).getContext("2d")!;
    raster.drawImage(image, 0, 0);
    const at = (x: number, y: number) => {
      const [r, g, b, a] = raster.getImageData(x, y, 1, 1).data;
      return [r!, g!, b!].map((c) => c * (a! / 255) + 255 * (1 - a! / 255));
    };
    const columns = reference();
    for (const [m, { x0, x1, cells }] of columns.entries()) {
      const cell = cells[0]!;
      const expected = overWhite(paletteColor(LIGHT, 0), opacityOf(cell.share));
      expect(at(Math.floor((x0 + x1) * W), 100), MARKETS[m]).toSatisfy((p: number[]) =>
        near(p, expected),
      );
      if (m < 3) expect(at(Math.floor(cut(x1, W) * 2), 100), MARKETS[m]).toSatisfy(white);
    }
    // PDF: the layout's own numbers, as SVG's (in CSS pixels, under its page's scale).
    const pdf = await pdfContent(renderToPDF(live));
    const boxes = [...pdf.matchAll(/(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\nf/g)].map((m) =>
      m.slice(1, 5).map(Number),
    );
    for (const d of paths(live.root)) {
      const [x, y, w, h] = /M([\d.]+) ([\d.]+)h([\d.]+)v([\d.]+)/.exec(d)!.slice(1, 5).map(Number);
      expect(
        boxes.some((box) => near(box, [x!, y!, w!, h!], 0.06)),
        d,
      ).toBe(true);
    }
  });
});

/** The text of a PDF's content streams, inflated. */
async function pdfContent(bytes: Uint8Array): Promise<string> {
  const text = new TextDecoder("latin1").decode(bytes);
  const streams: string[] = [];
  for (const match of text.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    // The stream's own bytes: its /Length, given just before it.
    const length = Number(
      /\/Length (\d+)[\s\S]*$/.exec(text.slice(Math.max(0, match.index! - 200), match.index!))?.[1],
    );
    const body = bytes.slice(start, start + length);
    try {
      const inflated = new Blob([body]).stream().pipeThrough(new DecompressionStream("deflate"));
      streams.push(await new Response(inflated).text());
    } catch {
      // Not deflated: fonts and images.
    }
  }
  return streams.join("\n");
}

// B3: a tree three levels deep, two rings drawn.
const flare = () =>
  table({
    ring1: [
      "vis",
      "vis",
      "vis",
      "vis",
      "util",
      "util",
      "util",
      "query",
      "query",
      "animate",
      "animate",
    ],
    ring2: [
      "operator",
      "operator",
      "data",
      "controls",
      "math",
      "math",
      "palette",
      "methods",
      "Query",
      "Easing",
      "Tween",
    ],
    ring3: [
      "filter",
      "layout",
      "DataList",
      "Anchor",
      "Maths",
      "Stats",
      null,
      "add",
      "Query",
      null,
      null,
    ],
    size: [40, 30, 20, 10, 8, 6, 5, 9, 7, 6, 4],
  });
const B3_SIZE = "width:400px;height:300px";
const zoomable = (options: { labels?: false } = {}) =>
  sunburst(flare(), {
    path: ["ring1", "ring2", "ring3"],
    value: "size",
    levels: 2,
    innerRadius: 1 / 3,
    center: false,
    gap: 1,
    branch: { fillOpacity: 0.6 },
    leaf: { fillOpacity: 0.4 },
    labels: { rotation: "radial" },
    ...options,
  });

/** The items drawn, by name. */
function items(chart: Chart) {
  return new Map(modelOf(chart).items!.result()!.items!().map((item) => [item.label, item]));
}

/** A pixel in the middle of a sector: halfway across its ring, at its middle angle. */
function middle(sector: {
  cx: number;
  cy: number;
  innerRadius: number;
  outerRadius: number;
  startAngle: number;
  endAngle: number;
}) {
  const angle = (sector.startAngle + sector.endAngle) / 2;
  const r = (sector.innerRadius + sector.outerRadius) / 2;
  return [sector.cx + Math.sin(angle) * r, sector.cy - Math.cos(angle) * r] as const;
}

async function click(chart: Chart, x: number, y: number) {
  const at = pageOrigin(chart.root);
  for (const type of ["move", "press", "release"] as const)
    await realMouse({
      type,
      x: at.x + x,
      y: at.y + y,
      clickCount: 1,
      deltaY: 0,
      shift: false,
      ctrl: false,
    });
  await frame();
}

describe("B3, a zoomable sunburst", () => {
  it("draws two rings around a third of the radius, leaves lighter, names along the radius", async () => {
    const chart = await mount(B3_SIZE, { renderer: "svg", legend: false, marks: [zoomable()] });
    const drawn = items(chart);
    const vis = drawn.get("vis")!.sector!;
    const r = vis.outerRadius * 1.5;
    expect(vis.innerRadius).toBeCloseTo(r / 3, 6);
    expect(drawn.get("vis / operator")!.sector!.outerRadius).toBeCloseTo(r, 6);
    // Two levels: the third is not drawn until drilled into.
    expect([...drawn.values()].every((item) => item.depth! <= 2)).toBe(true);
    // Names turned along their radius, upright: a quarter turn from the middle angle, or three.
    for (const text of chart.root.querySelectorAll("text[transform]")) {
      const item = drawn.get(text.textContent ?? "");
      if (!item?.sector) continue;
      const turn = Number(/rotate\((-?[\d.]+)/.exec(text.getAttribute("transform")!)![1]);
      const along = ((item.sector.startAngle + item.sector.endAngle) / 2) * (180 / Math.PI) - 90;
      const off = (((turn - along) % 180) + 180) % 180;
      expect(Math.min(off, 180 - off), text.textContent!).toBeCloseTo(0, 3);
    }
  });

  for (const scale of [1, 1.5, 2])
    it(`paints branches at 0.6 and leaves at 0.4, rings a whole device gap apart, at a ratio of ${scale}`, async () => {
      Object.defineProperty(window, "devicePixelRatio", { value: scale, configurable: true });
      const chart = await mount(B3_SIZE, {
        renderer: "canvas",
        legend: false,
        marks: [zoomable({ labels: false })],
      });
      const drawn = items(chart);
      const image = pixels(chart);
      // vis and its operator have children; palette, under util, has none.
      for (const [name, opacity] of [
        ["vis", 0.6],
        ["vis / operator", 0.6],
        ["util / palette", 0.4],
      ] as const) {
        const [x, y] = middle(drawn.get(name)!.sector!);
        const color = paletteColor(LIGHT, name.startsWith("vis") ? 0 : 1);
        expect(
          near(image.at(Math.floor(x * scale), Math.floor(y * scale)), overWhite(color, opacity)),
          name,
        ).toBe(true);
      }
      // From the middle out along 3 o'clock (vis, then operator): white between
      // the rings adds up to the device gap, however the edges fall.
      const { cx, cy, innerRadius, outerRadius } = drawn.get("vis")!.sector!;
      const y = Math.floor(cy * scale);
      const fill = overWhite(paletteColor(LIGHT, 0), 0.6)[0];
      let whiteness = 0;
      for (
        let x = Math.floor((cx + (innerRadius + outerRadius) / 2) * scale);
        x < (cx + outerRadius * 1.25) * scale;
        x++
      )
        whiteness += (image.at(x, y)[0] - fill) / (255 - fill);
      expect(whiteness).toBeCloseTo(Math.max(1, Math.round(scale)), 0);
    });

  it("drills into a sector clicked, rings keeping their width, and out through the empty middle", async () => {
    const chart = await mount(B3_SIZE, {
      renderer: "svg",
      legend: false,
      interaction: { zoom: true },
      marks: [zoomable()],
    });
    const before = items(chart).get("vis")!.sector!;
    await click(chart, ...middle(before));
    expect(chart.getDrillRoot()?.key).toBe('[0,"vis"]');
    const drilled = items(chart);
    // No middle drawn (center: false); vis's children in the first ring, as wide as before.
    expect(drilled.has("vis")).toBe(false);
    const operator = drilled.get("vis / operator")!.sector!;
    expect(operator.innerRadius).toBeCloseTo(before.innerRadius, 6);
    expect(operator.outerRadius).toBeCloseTo(before.outerRadius, 6);
    // The third level shows in the outer ring now.
    expect(drilled.has("vis / operator / filter")).toBe(true);
    // The breadcrumbs name the path.
    expect([...chart.root.querySelectorAll("nav button")].map((b) => b.textContent)).toEqual([
      "All",
    ]);
    await click(chart, operator.cx, operator.cy);
    expect(chart.getDrillRoot()?.key).toBeNull();
  });
});
