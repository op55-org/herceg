// Raster images in the browser (herceg/image): pixel dimensions from layout
// size and dpi, the resolution each format records, what JPEG is drawn on,
// text drawn as it was measured, WebP where the browser writes it, and a
// mounted chart left as it was. Files are read by an independent reader
// (helpers/image.ts) and decoded by the browser.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import type { Chart } from "../../src/dom/handle.ts";
import { prepareFonts } from "../../src/fonts.ts";
import { type ImageSettings, renderToImage } from "../../src/image.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { renderToSVG, type StaticOptions } from "../../src/render/static.ts";
import { ChartError } from "../../src/spec/errors.ts";
import { imageFacts } from "../helpers/image.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

const ramp = table({ t: [0, 1, 2, 3, 4], v: [3, 1, 4, 1, 5] });
const options = (extra: Partial<StaticOptions> = {}): StaticOptions => ({
  width: 400,
  height: 200,
  marks: [line(ramp, { x: "t", y: "v" })],
  ...extra,
});

/** The file's facts, and its pixels as the browser decodes them. */
async function read(blob: Blob) {
  const facts = imageFacts(new Uint8Array(await blob.arrayBuffer()));
  const image = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0);
  const pixel = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data];
  return { facts, width: image.width, height: image.height, pixel, context };
}

/** What `promise` rejects with. */
async function rejection(promise: Promise<unknown>): Promise<ChartError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ChartError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

describe("renderToImage", () => {
  it("lays a figure out at its size in inches and draws it at its dpi, which the PNG records", async () => {
    const png = await renderToImage(options(), { size: [16, 10], unit: "in", dpi: 150 });
    expect(png.type).toBe("image/png");
    const { facts, width, height } = await read(png);
    expect([width, height]).toEqual([2400, 1500]);
    expect(facts.format).toBe("png");
    expect(facts.dpi![0]).toBeCloseTo(150, 1);
    expect(facts.dpi![1]).toBeCloseTo(150, 1);
  });

  it("writes JPEG with its density, on the chart's background or white under a transparent one", async () => {
    const jpeg = await renderToImage(options(), { format: "jpeg", dpi: 300, quality: 80 });
    const { facts, width, height, pixel } = await read(jpeg);
    expect(jpeg.type).toBe("image/jpeg");
    expect([width, height]).toEqual([1250, 625]);
    expect(facts).toMatchObject({ format: "jpeg", width: 1250, height: 625, dpi: [300, 300] });
    const near = (actual: number[], expected: number[]) =>
      expect(actual.slice(0, 3).every((channel, i) => Math.abs(channel - expected[i]!) < 10)).toBe(
        true,
      );
    near(pixel(2, 2), [255, 255, 255]);
    near(
      (await read(await renderToImage(options({ theme: "dark" }), { format: "jpeg" }))).pixel(2, 2),
      [0x12, 0x15, 0x1c],
    );
    // A transparent theme: white under dark text, or the background given.
    const auto = options({ theme: "auto" });
    near((await read(await renderToImage(auto, { format: "jpeg" }))).pixel(2, 2), [255, 255, 255]);
    near(
      (
        await read(
          await renderToImage(auto, { format: "jpeg", background: "var(--paper, #00ff00)" }),
        )
      ).pixel(2, 2),
      [0, 255, 0],
    );
    // PNG keeps the transparency, unless given a background.
    expect((await read(await renderToImage(auto))).pixel(2, 2)[3]).toBe(0);
    expect((await read(await renderToImage(auto, { background: "#0000ff" }))).pixel(2, 2)).toEqual([
      0, 0, 255, 255,
    ]);
  });

  it("writes WebP with its resolution where the browser writes WebP, and otherwise refuses", async () => {
    const settings: ImageSettings = { format: "webp", dpi: 150, quality: 90 };
    // Ask the browser as the export does: some builds' canvases (WebKit on macOS) write PNG
    // in place of WebP, others (WebKit on Linux) write WebP.
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const probe = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp"));
    if (probe?.type !== "image/webp") {
      const refused = await rejection(renderToImage(options(), settings));
      expect([refused.code, refused.path]).toEqual(["unsupported", "format"]);
      expect(refused.message).toMatch(
        /^renderToImage format: this browser does not write WebP images \(it wrote image\/png\); export PNG or JPEG$/,
      );
      return;
    }
    const webp = await renderToImage(options(), settings);
    expect(webp.type).toBe("image/webp");
    const { facts, width, height } = await read(webp);
    expect([width, height]).toEqual([625, 313]);
    expect(facts).toMatchObject({ format: "webp", width: 625, height: 313, dpi: [150, 150] });
  });

  it("draws text in the fonts it was measured with, whatever the dpi", async () => {
    const data = new Uint8Array(
      await (await fetch(new URL("../fixtures/pdf-fonts/sans.ttf", import.meta.url))).arrayBuffer(),
    );
    const fonts = prepareFonts([{ family: "Fixture", data }]);
    const title = "WMWMWM";
    const chart = options({
      marks: [],
      legend: false,
      x: { show: false },
      y: { show: false },
      title: { text: title, style: { fontSize: 40, fontWeight: 400, color: "#000000" } },
      // Monospace stands in, much narrower, where the face is missing.
      theme: { style: { text: { font: "Fixture, monospace" } } },
    });
    const measured = fonts.measure(title, "40px Fixture, monospace");
    /** The title's ink across its first rows, in CSS pixels: from its first dark column to its last. */
    const ink = async (settings: ImageSettings) => {
      const dpi = settings.dpi ?? 96;
      const { context, width } = await read(await renderToImage(chart, settings));
      const rows = context.getImageData(0, 0, width, Math.round((60 * dpi) / 96)).data;
      let first = width;
      let last = -1;
      for (let i = 0; i < rows.length; i += 4)
        if (rows[i]! < 128 && rows[i + 3]! > 128) {
          const x = (i / 4) % width;
          first = Math.min(first, x);
          last = Math.max(last, x);
        }
      return ((last - first + 1) * 96) / dpi;
    };
    const drawn = await ink({ fonts });
    // The advance less the glyphs' side bearings.
    expect(drawn).toBeLessThan(measured);
    expect(drawn).toBeGreaterThan(measured - 8);
    // At twice the dpi, the same text at the same size.
    expect(Math.abs((await ink({ fonts, dpi: 192 })) - drawn)).toBeLessThanOrEqual(1);
    // Without the fonts the image has none of the face, and draws another.
    expect(await ink({})).toBeLessThan(drawn - 40);
  });

  it("refuses settings of other exports, before drawing", async () => {
    const tooltip = await rejection(renderToImage(options(), { tooltip: "title" } as never));
    expect([tooltip.code, tooltip.path]).toEqual(["unsupported", "tooltip"]);
    const quality = await rejection(renderToImage(options(), { quality: 50 }));
    expect(quality.message).toBe(
      "renderToImage quality: compresses JPEG and WebP; PNG keeps every pixel, so drop quality",
    );
    const big = await rejection(renderToImage(options(), { size: [16, 10], unit: "in", dpi: 600 }));
    expect([big.code, big.path]).toEqual(["invalid-option", "dpi"]);
  });
});

describe("renderToImage of a mounted chart", () => {
  const mount = (extra: Partial<Parameters<typeof createChart>[1]> = {}): Chart =>
    createChart(host, { marks: [line(ramp, { x: "t", y: "v" })], ...extra });

  it("draws its current state at its size, and leaves it as it was", async () => {
    const chart = mount();
    chart.setViewport([1, 3]);
    chart.render();
    const before = chart.toSVG();
    const panels = JSON.stringify(chart.getPanels());
    let renders = 0;
    chart.on("render", () => renders++);
    const jpeg = await renderToImage(chart, { format: "jpeg", dpi: 150 });
    const { facts, width, height } = await read(jpeg);
    // 600 by 300 CSS pixels at 150 dpi.
    expect([width, height]).toEqual([938, 469]);
    expect(facts.dpi).toEqual([150, 150]);
    expect(chart.toSVG()).toBe(before);
    expect(JSON.stringify(chart.getPanels())).toBe(panels);
    expect(chart.getViewport().x).toEqual([1, 3]);
    expect(renders).toBe(0);
  });

  it("reads its background setting from its page", async () => {
    host.style.setProperty("--paper", "#ff0000");
    const chart = mount({ theme: "auto" });
    chart.render();
    const { pixel } = await read(
      await renderToImage(chart, { background: "var(--paper, #00ff00)" }),
    );
    expect(pixel(1, 1)).toEqual([255, 0, 0, 255]);
    const wrong = await rejection(renderToImage(chart, { background: "paper" }));
    expect([wrong.path, wrong.message]).toEqual([
      "background",
      'renderToImage background: expected a CSS color; received "paper"',
    ]);
  });

  it("refuses another size and other fonts", async () => {
    const chart = mount();
    chart.render();
    const sized = await rejection(renderToImage(chart, { size: [4, 2], unit: "in" }));
    expect([sized.code, sized.path]).toEqual(["unsupported", "size"]);
    expect(sized.message).toBe(
      "renderToImage size: a mounted chart is written at its own size, which its container sets; resize the container, or export its options at that size",
    );
    const data = new Uint8Array(
      await (await fetch(new URL("../fixtures/pdf-fonts/sans.ttf", import.meta.url))).arrayBuffer(),
    );
    const fonts = prepareFonts([{ family: "Fixture", data }]);
    const other = await rejection(renderToImage(chart, { fonts }));
    expect([other.code, other.path]).toEqual(["unsupported", "fonts"]);
  });

  it("refuses to encode a bitmap of its own past the limits, however small the image", async () => {
    // Cells at uneven places: a heatmap drawn as a bitmap of its plot, at
    // twice its 10,000 pixels on a screen of two device pixels to one.
    const ratio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    try {
      host.style.width = "10000px";
      const cells = table({ x: [0, 1, 3], y: [0, 0, 0], v: [1, 2, 3] });
      const chart = createChart(host, {
        height: 100,
        marks: [heatmap(cells, { x: "x", y: "y", color: "v" })],
      });
      chart.render();
      const refused = await rejection(renderToImage(chart, { dpi: 1 }));
      expect(refused.code).toBe("invalid-option");
      expect(refused.message).toMatch(
        /^renderToImage: the chart draws an image of \d+ by \d+ pixels, more than exports allocate \(16384 a side, 16777216 in all\); export the chart's options/,
      );
      chart.destroy();
    } finally {
      if (ratio) Object.defineProperty(window, "devicePixelRatio", ratio);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    }
  });
});

describe("renderToSVG of a mounted chart", () => {
  it("writes native titles of its current state, read of its page, and leaves it as it was", () => {
    host.style.setProperty("--brand", "#ff0000");
    const chart = createChart(host, {
      marks: [line(ramp, { x: "t", y: "v", stroke: "var(--brand, #0000ff)" })],
    });
    chart.setViewport([1, 3]);
    chart.render();
    const before = chart.toSVG();
    let renders = 0;
    chart.on("render", () => renders++);
    const svg = renderToSVG(chart, { tooltip: "title" });
    // An observation of the line each, in the view (1 to 3), in the page's color.
    expect(svg.match(/pointer-events="all"><title>/g)).toHaveLength(3);
    expect(svg).toContain('stroke="#ff0000"');
    expect(chart.toSVG()).toBe(before);
    expect(renders).toBe(0);
    // Its size and measurement are its own.
    expect(() => renderToSVG(chart, { size: [4, 2], unit: "in" })).toThrow(
      "renderToSVG size: a mounted chart is written at its own size",
    );
    expect(() => renderToSVG(chart, { measureText: () => 1 })).toThrow(
      "renderToSVG measureText: measures static options; a mounted chart measures its own text",
    );
  });
});
