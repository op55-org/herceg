// Bars of a width in pixels capped by an outline of their top, painted on
// a canvas: the width as given, the cap stroked, the sides left to the fill.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { bar } from "../../src/marks/bar.ts";
import { contractTest } from "../helpers/contracts.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:400px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

const one = table({ x: [5], y: [8] });

/** A bar 20 pixels wide at x = 5 up to y = 8, outlined red `strokeWidth` pixels wide on `strokeSides`. */
function capped(
  strokeSides?: ("top" | "right" | "bottom" | "left")[],
  strokeWidth = 4,
): ChartOptions {
  return {
    renderer: "canvas",
    theme: { tokens: { background: "transparent" } },
    legend: false,
    x: { domain: [0, 10], grid: false, nice: false },
    y: { domain: [0, 10], grid: false, nice: false },
    marks: [
      bar(one, {
        x: "x",
        y: "y",
        fill: "#0000ff",
        stroke: "#ff0000",
        strokeWidth,
        width: { px: 20 },
        ...(strokeSides && { strokeSides }),
      }),
    ],
  };
}

/** The canvas' colors at a chart's values (x, y), each `dx` pixels right of them. */
function colorsAt(options: ChartOptions, x: number, y: number, dxs: number[]): number[][] {
  const chart = createChart(host, options);
  const canvas = host.querySelector("canvas")!;
  const ratio = canvas.width / host.clientWidth;
  const context = canvas.getContext("2d")!;
  const colors = dxs.map((dx) => {
    const px = (chart.toPixel(x, { axis: "x" })! + dx) * ratio;
    const py = chart.toPixel(y, { axis: "y" })! * ratio;
    return Array.from(context.getImageData(Math.round(px), Math.round(py), 1, 1).data);
  });
  chart.destroy();
  return colors;
}

const RED = [255, 0, 0, 255];
const BLUE = [0, 0, 255, 255];
const CLEAR = [0, 0, 0, 0];

describe("capped bars on a canvas", () => {
  contractTest("bar.stroke-sides.canvas", () => {
    // Halfway up: inside the bar, beyond its side's outline, beyond the bar.
    const [inside, side, beyond] = colorsAt(capped(["top"]), 5, 4, [6, 11, 14]);
    expect(inside).toEqual(BLUE);
    expect(side).toEqual(CLEAR);
    expect(beyond).toEqual(CLEAR);
    // The cap, across the bar's top.
    expect(colorsAt(capped(["top"]), 5, 8, [0, 6])).toEqual([RED, RED]);
    // Every side outlined: the stroke reaches 2 pixels past the side.
    expect(colorsAt(capped(), 5, 4, [11])).toEqual([RED]);
  });

  contractTest("bar.stroke-sides.ends.canvas", () => {
    // A cap 12 pixels thick ends where the bar does, square, as SVG and
    // PDF end it: 3 pixels past the side is clear, inside the end is not.
    expect(colorsAt(capped(["top"], 12), 5, 8, [8, 13])).toEqual([RED, CLEAR]);
  });
});
