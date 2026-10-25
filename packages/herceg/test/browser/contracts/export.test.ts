// Proofs of the matrix's SVG and PNG export (test/contracts/), one per row:
// the file is well formed, at the chart's size, and drawn by the browser it
// shows the mark's colors at every place inside its plots the mark draws at,
// and its marks' text in its boxes (test/contracts/drawn.ts); the SVG's text
// is the live chart's, and the PNG draws the SVG export (Chart.toPNG).
// Exports draw the chart as it is now (a series hidden stays hidden). PDF is
// proved in Node (test/contracts/export.test.ts).

import { describe, expect } from "vitest";
import type { Chart } from "../../../src/dom/chart.ts";
import { expectDrawn } from "../../contracts/drawn.ts";
import {
  cellsOf,
  markColors,
  markOf,
  nearColor,
  neighbor,
  splitPixels,
} from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { legendButtons, mount, plotsOf, sceneOf } from "./mount.ts";
import { draw, drawnScene, drawSvg, measure, PICTURE, SCALE } from "./pictures.ts";

/** The colors of `colors` the pixels show, a few pixels each at least. */
const shown = (pixels: Uint8ClampedArray, colors: readonly string[]) =>
  colors.filter((color) => nearColor(pixels, 4, color) >= 4);

/** The texts an SVG element draws, in order. */
const textsOf = (svg: Element) =>
  [...svg.querySelectorAll("text")].map((text) => text.textContent).filter((text) => text);

/** Parses an SVG document; an error for markup that is not one. */
function parseSvg(svg: string): SVGSVGElement {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  expect(document.querySelector("parsererror"), "well-formed SVG").toBeNull();
  expect(document.documentElement.tagName).toBe("svg");
  return document.documentElement as unknown as SVGSVGElement;
}

describe("export.svg", () => {
  for (const cell of cellsOf("export.svg"))
    contractTest(`${cell.row}.export.svg`, async () => {
      if (cell.state !== "works") throw new Error(`export.svg is never ${cell.state}`);
      const chart = await mount({ marks: [markOf(cell.row)] });
      const svg = chart.toSVG();
      const root = parseSvg(svg);
      expect([root.getAttribute("width"), root.getAttribute("height")]).toEqual(["600", "400"]);
      expectDrawn(drawnScene(chart), await drawSvg(svg, SCALE), PICTURE, measure);
      // The chart's text, as the live chart's SVG draws it (its legend, live in HTML, too).
      const written = textsOf(root);
      const missing = textsOf(chart.root.querySelector("svg")!).filter((text) => {
        const at = written.indexOf(text);
        if (at >= 0) written.splice(at, 1);
        return at < 0;
      });
      expect(missing, "texts the export leaves out").toEqual([]);
    });
});

describe("export.png", () => {
  for (const cell of cellsOf("export.png"))
    contractTest(`${cell.row}.export.png`, async () => {
      if (cell.state !== "works") throw new Error(`export.png is never ${cell.state}`);
      const chart = await mount({ marks: [markOf(cell.row)] });
      const png = await chart.toPNG();
      expect(png.type).toBe("image/png");
      const bitmap = await createImageBitmap(png);
      // At 96 dpi, a CSS pixel per pixel.
      expect([bitmap.width, bitmap.height]).toEqual([600, 400]);
      const sharp = await createImageBitmap(await chart.toPNG({ dpi: 96 * SCALE }));
      expect([sharp.width, sharp.height]).toEqual([600 * SCALE, 400 * SCALE]);
      expectDrawn(drawnScene(chart), await draw(sharp), PICTURE, measure);
    });
});

contractTest("export.current-state", async () => {
  // A line of two series with the first hidden: exports draw the second only.
  const chart: Chart = await mount({ marks: [neighbor({ series: "kind" })], legend: true });
  const [k, m] = markColors(sceneOf(chart));
  legendButtons(chart)[0]!.click();
  chart.render();
  for (const pixels of [
    await drawSvg(chart.toSVG()),
    await draw(await createImageBitmap(await chart.toPNG())),
  ]) {
    // In the plot, where the series are drawn: the legend lists both.
    const { inside } = splitPixels(pixels, 600, 1, plotsOf(chart), 8);
    expect(shown(inside, [k!, m!])).toEqual([m]);
  }
});
