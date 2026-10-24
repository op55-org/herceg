// Exports of static options without a DOM: SVG settings (size in physical
// units, native titles, refusals) and what a raster export draws
// (render/static.ts `staticRaster`): layout independent of dpi, the colors
// under a JPEG, and the background setting.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { specToPDF, specToSVG } from "../../src/from-spec.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { rule } from "../../src/marks/rule.ts";
import { renderToPDF } from "../../src/pdf.ts";
import {
  checkRaster,
  renderToSVG,
  type StaticOptions,
  staticRaster,
} from "../../src/render/static.ts";
import { ChartError } from "../../src/spec/errors.ts";
import { contractTest } from "../helpers/contracts.ts";

const sales = table({ region: ["N", "S", "E"], units: [10, 20, 30], t: [1, 2, 3] });
const chart = (
  marks: StaticOptions["marks"],
  extra: Partial<StaticOptions> = {},
): StaticOptions => ({
  width: 400,
  height: 200,
  locale: "en-US",
  timeZone: "UTC",
  marks,
  ...extra,
});

/** The error `run` throws. */
function thrown(run: () => unknown): ChartError {
  try {
    run();
  } catch (error) {
    if (error instanceof ChartError) return error;
    throw error;
  }
  throw new Error("expected a ChartError");
}

const titles = (svg: string) => svg.match(/pointer-events="all"><title>/g)?.length ?? 0;
/** What the SVG draws, apart from its root element and ids. */
const body = (svg: string) => svg.slice(svg.indexOf(">") + 1).replace(/herceg-[a-z]+-\d+/g, "id");

describe("SVG settings", () => {
  contractTest("export.svg.size.unit", () => {
    const svg = renderToSVG(chart([line(sales, { x: "t", y: "units" })]), {
      size: [254, 127],
      unit: "mm",
      idPrefix: "a",
    });
    // Laid out at 960 by 480 CSS pixels; documents place it at 254 by 127 mm.
    expect(svg).toMatch(/^<svg [^>]*width="254mm" height="127mm" viewBox="0 0 960 480"/);
    // In CSS pixels, the size is the root's.
    const px = renderToSVG(chart([line(sales, { x: "t", y: "units" })]), {
      size: [960, 480],
      idPrefix: "a",
    });
    expect(px).toMatch(/^<svg [^>]*width="960" height="480" viewBox="0 0 960 480"/);
    expect(body(px)).toBe(body(svg));
    // A fluid SVG lays out at the size and leaves its own size to CSS.
    const fluid = renderToSVG(chart([line(sales, { x: "t", y: "units" })]), {
      size: [10, 5],
      unit: "in",
      sizing: "fluid",
    });
    expect(fluid).toMatch(/^<svg [^>]*viewBox="0 0 960 480"/);
    expect(fluid.slice(0, fluid.indexOf(">"))).not.toMatch(/ width=/);
  });

  contractTest("export.svg.titles", () => {
    const options = chart([
      bar(sales, { x: "region", y: "units" }),
      line(sales, { x: "region", y: "units" }),
      point(sales, { x: "region", y: "units" }),
      rule({ y: 15 }),
    ]);
    const svg = renderToSVG(options, { tooltip: "title" });
    // Three bars, three observations of the line, three points; the rule has none.
    expect(titles(svg)).toBe(9);
    expect(titles(renderToSVG(options))).toBe(0);
    // The chart's own description stays what assistive technology reads.
    expect(svg).toContain("<desc ");
    // A spec takes the same setting.
    const spec = specToSVG(
      {
        version: 1,
        data: { s: { columns: { x: [1, 2], y: [3, 4] } } },
        marks: [{ type: "point", data: "s", x: "x", y: "y" }],
      },
      [],
      { tooltip: "title" },
    );
    expect(titles(spec)).toBe(2);
  });

  contractTest("export.svg.titles.refused", () => {
    // Marks the tooltip reads that titles cannot go on.
    const areas = thrown(() =>
      renderToSVG(
        chart([line(sales, { x: "t", y: "units" }), area(sales, { x: "t", y: "units" })]),
        {
          tooltip: "title",
        },
      ),
    );
    expect([areas.code, areas.path]).toEqual(["unsupported", "tooltip"]);
    expect(areas.message).toBe(
      'renderToSVG tooltip: "title" goes on bars, points, and lines, and marks[1] (area) is none of them; export without tooltip, or with that mark in a chart of its own',
    );
    // Marks laying out a panel of their own: pies and 3D.
    const slices = thrown(() =>
      renderToSVG(chart([pie(sales, { category: "region", value: "units" })]), {
        tooltip: "title",
      }),
    );
    expect(slices.message).toMatch(/^renderToSVG tooltip: "title" goes on .* marks\[0\] \(pie\)/);
    const depth = thrown(() =>
      renderToSVG(chart([point3d(sales, { x: "t", y: "units", z: "t" })]), { tooltip: "title" }),
    );
    expect(depth.message).toMatch(/marks\[0\] \(point3d\) is none of them/);
    // More than the budget, whole: no title is written for the first 5,000.
    const many = table({
      x: Float64Array.from({ length: 5001 }, (_, i) => i),
      y: new Float64Array(5001),
    });
    const over = thrown(() =>
      renderToSVG(chart([point(many, { x: "x", y: "y" })]), { tooltip: "title" }),
    );
    expect([over.code, over.path]).toEqual(["unsupported", "tooltip"]);
    expect(over.message).toMatch(/^renderToSVG tooltip: titles in SVG go on at most 5000 /);
    // A spec's refusals name specToSVG.
    expect(() =>
      specToSVG(
        {
          version: 1,
          data: { s: { columns: { x: [1, 2], y: [3, 4] } } },
          marks: [{ type: "area", data: "s", x: "x", y: "y" }],
        },
        [],
        { tooltip: "title" },
      ),
    ).toThrow(/^specToSVG tooltip: "title" goes on bars/);
    // Settings of raster images.
    const dpi = thrown(() => renderToSVG(chart([]), { dpi: 300 } as never));
    expect(dpi.message).toBe("renderToSVG dpi: sets image pixels, which SVG has none of; drop dpi");
    // A PDF has no pointer to show titles under.
    const lines = chart([line(sales, { x: "t", y: "units" })]);
    expect(() => renderToPDF(lines, { tooltip: "title" } as never)).toThrow(
      /^renderToPDF tooltip: a PDF shows no tooltips; export SVG with renderToSVG/,
    );
    const spec = { version: 1, data: { s: { columns: { x: [1, 2] } } }, marks: [] } as never;
    expect(() => specToPDF(spec, { tooltip: "title" } as never)).toThrow(/^specToPDF tooltip:/);
  });

  it("refuses static options without a size, unless an export gives one", () => {
    const sized = thrown(() => renderToSVG({ marks: [] } as unknown as StaticOptions));
    expect([sized.path, sized.message]).toEqual([
      "width",
      "renderToSVG width: expected the chart's size in CSS pixels; received undefined",
    ]);
    expect(renderToSVG({ marks: [] } as unknown as StaticOptions, { size: [100, 50] })).toMatch(
      /width="100" height="50"/,
    );
  });
});

describe("what a raster export draws", () => {
  const options = chart([line(sales, { x: "t", y: "units" })], { title: "Units" });

  contractTest("export.image.layout", () => {
    // 16 by 10 inches at 150 dpi: laid out at 1536 by 960 CSS pixels, drawn
    // at 2400 by 1500 pixels; the dpi changes nothing of the layout.
    const at = (dpi: number) =>
      staticRaster("renderToImage", options, { size: [16, 10], unit: "in", dpi }, undefined);
    const dense = at(150);
    expect(dense.plan).toMatchObject({ width: 1536, height: 960, pixels: [2400, 1500], dpi: 150 });
    expect(dense.svg).toMatch(/^<svg [^>]*width="1536" height="960" viewBox="0 0 1536 960"/);
    expect(body(at(96).svg)).toBe(body(dense.svg));
    expect(body(at(300).svg)).toBe(body(dense.svg));
  });

  it("draws images marks make at the image's resolution, which its limits bound", () => {
    // Dense cells are drawn as an image of the plot's pixels.
    const n = 4000;
    const cells = table({
      x: Float64Array.from({ length: n }, (_, i) => i),
      y: new Float64Array(n),
      v: Float64Array.from({ length: n }, (_, i) => i % 7),
    });
    const heat = chart([heatmap(cells, { x: "x", y: "y", color: "v" })]);
    const width = (settings: Parameters<typeof staticRaster>[2]) => {
      const svg = staticRaster("renderToImage", heat, settings, undefined).svg;
      const data = /href="data:image\/png;base64,([^"]+)"/.exec(svg)![1]!;
      return Buffer.from(data, "base64").readUInt32BE(16);
    };
    const plot = width({ dpi: 96 });
    expect(Math.abs(width({ dpi: 192 }) - 2 * plot)).toBeLessThanOrEqual(1);
    expect(Math.abs(width({ dpi: 384 }) - 4 * plot)).toBeLessThanOrEqual(2);
    // A vast layout drawn at a low dpi allocates no more than its image.
    expect(width({ size: [16000, 16000], dpi: 1 })).toBeLessThanOrEqual(167);
  });

  contractTest("export.image.under", () => {
    const under = (extra: Partial<StaticOptions>, settings: Parameters<typeof staticRaster>[2]) =>
      staticRaster("renderToImage", { ...options, ...extra }, settings, undefined).under;
    // A JPEG of a chart painting its own background needs nothing under it.
    expect(under({}, { format: "jpeg" })).toEqual([]);
    // Under a transparent one, white beneath dark text, black beneath light.
    expect(under({ theme: "auto" }, { format: "jpeg" })).toEqual(["#ffffff"]);
    expect(
      under(
        { theme: { tokens: { background: "transparent", text: "#eeeeee" } } },
        { format: "jpeg" },
      ),
    ).toEqual(["#000000"]);
    // PNG stays transparent, unless a background is given, read as the chart's colors are.
    expect(under({ theme: "auto" }, {})).toEqual([]);
    expect(under({ theme: "auto" }, { background: "var(--paper, rebeccapurple)" })).toEqual([
      "#663399",
    ]);
    expect(under({ theme: "auto" }, { format: "jpeg", background: "#00ff0080" })).toEqual([
      "#ffffff",
      "rgba(0, 255, 0, 0.5019607843137255)",
    ]);
    const bad = thrown(() => under({}, { background: "paper" }));
    expect([bad.code, bad.path, bad.message]).toEqual([
      "invalid-option",
      "background",
      'renderToImage background: expected a CSS color; received "paper"',
    ]);
    // A variable without a fallback, which only a page could read.
    const unread = thrown(() => under({}, { background: "var(--paper)" }));
    expect([unread.code, unread.path, unread.message]).toEqual([
      "invalid-option",
      "background",
      "renderToImage background: is the CSS variable var(--paper), which only a chart in a page can read; give a fallback, as var(--name, #2a78d6)",
    ]);
  });

  it("refuses what image exports do not take", () => {
    const svg = thrown(() => checkRaster("renderToImage", { format: "svg" }));
    expect(svg.message).toBe(
      'renderToImage format: writes "png", "jpeg", or "webp" images; renderToSVG writes SVG',
    );
    const scale = thrown(() => checkRaster("renderToImage", { scale: 2 }));
    expect([scale.path, scale.message]).toEqual([
      "scale",
      "renderToImage scale: is not a setting of image exports, which take format, size, unit, dpi, quality, background, and fonts",
    ]);
    const tooltip = thrown(() =>
      staticRaster("renderToImage", options, { tooltip: "title" } as never, undefined),
    );
    expect(tooltip.message).toBe(
      'renderToImage tooltip: "title" writes tooltips into SVG, which a PNG image cannot hold; export SVG, or drop tooltip',
    );
    const quality = thrown(() =>
      staticRaster("renderToImage", options, { quality: 80 }, undefined),
    );
    expect(quality.message).toBe(
      "renderToImage quality: compresses JPEG and WebP; PNG keeps every pixel, so drop quality",
    );
  });
});
