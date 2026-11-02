// Tree items on a canvas, rounded to device pixels: a treemap's neighbors
// meet one boundary at each gap, gaps are whole device pixels (at least
// one), and a sunburst's gaps between sectors and rings likewise; SVG keeps
// the layout's own numbers.

import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { ringDrawing } from "../../src/draw/rings.ts";
import { SPLIT_LEFT, SPLIT_RIGHT, type TileGeometry, tileDrawing } from "../../src/draw/tiles.ts";
import { estimateText } from "../../src/layout/text.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { ChartModel } from "../../src/model/model.ts";
import type { ArcGeometry, CanvasOptions, RectGeometry } from "../../src/scene/scene.ts";
import { LIGHT } from "../../src/theme.ts";

/** A canvas context that records the rectangles and arcs traced, at `ratio` device pixels to one. */
function recorder(ratio: number) {
  const rects: number[][] = [];
  const radii: number[] = [];
  const context = {
    getTransform: () => ({ a: ratio, b: 0, c: 0, d: ratio, e: 0, f: 0 }),
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    arc(_x: number, _y: number, r: number) {
      radii.push(r);
    },
    rect(x: number, y: number, w: number, h: number) {
      rects.push([x * ratio, y * ratio, (x + w) * ratio, (y + h) * ratio]);
    },
    fill() {},
    globalAlpha: 1,
    fillStyle: "",
  };
  return { context: context as unknown as CanvasRenderingContext2D, rects, radii };
}

const options = {
  plot: { x: 0, y: 0, width: 0, height: 0 },
  pixelRatio: 1,
  clouds: {},
  theme: LIGHT,
} as CanvasOptions;

// Columns of awkward widths, so edges fall between device pixels.
const sales = table({
  market: category(["a", "a", "b", "c", "c", "c"]),
  segment: category(["x", "y", "x", "x", "y", "z"]),
  value: [313, 271, 199, 157, 113, 97],
});

/** The leaves of a slice-and-dice treemap of `data`, every color's, as one geometry the drawing paints. */
function tiles(gap: number, data = sales): RectGeometry {
  const model = new ChartModel({
    marks: [
      treemap(data, {
        path: ["market", "segment"],
        value: "value",
        tile: "slice-dice",
        sort: "input",
        gap,
        labels: false,
      }),
    ],
    legend: false,
    padding: 0,
  });
  model.setSize(601, 333, 1);
  const leaves = model
    .scene(estimateText)
    .panels[0]!.marks.filter(
      (m): m is RectGeometry => m.kind === "rect" && m.key.startsWith("treemap-leaves"),
    );
  const cuts = (g: RectGeometry) => (g as RectGeometry & { cuts: Uint8Array }).cuts;
  return {
    ...leaves[0]!,
    rects: Float32Array.from(leaves.flatMap((g) => Array.from(g.rects))),
    count: leaves.reduce((sum, g) => sum + g.count, 0),
    cuts: Uint8Array.from(leaves.flatMap((g) => Array.from(cuts(g)))),
    nodes: Uint32Array.from(leaves.flatMap((g) => Array.from((g as TileGeometry).nodes))),
  } as RectGeometry;
}

describe("treemap tiles on a canvas", () => {
  for (const ratio of [1, 1.5, 2]) {
    it(`meet on device pixels with gaps of whole device pixels at a pixel ratio of ${ratio}`, () => {
      const leaves = tiles(1);
      const { context, rects } = recorder(ratio);
      (tileDrawing.canvas as Exclude<typeof tileDrawing.canvas, false>)(context, leaves, options);
      const gap = Math.max(1, Math.round(ratio));
      for (const edges of rects)
        for (const edge of edges) expect(edge).toBeCloseTo(Math.round(edge), 9);
      // Each pair of neighbors along x or y: apart by the device gap, or not neighbors at all.
      const xs = new Set(rects.flatMap(([x0, , x1]) => [x0!, x1!]));
      for (const [x0] of rects) if (x0! > 0) expect(xs.has(x0! - gap)).toBe(true);
      for (const [, y0] of rects)
        if (y0! > 0) expect(rects.some(([, , , below]) => below === y0! - gap)).toBe(true);
      // The outer edges stay on the chart's.
      expect(Math.min(...rects.map(([x0]) => x0!))).toBe(0);
      expect(Math.max(...rects.map(([, , x1]) => x1!))).toBe(Math.round(601 * ratio));
      expect(rects.every(([, , , y1]) => y1! <= Math.round(333 * ratio))).toBe(true);
    });
  }

  it("keeps the layout's own numbers in SVG", () => {
    const leaves = tiles(1);
    const svg = tileDrawing.svg(leaves, { theme: LIGHT } as never);
    expect(svg).toMatch(/\d\.\d/);
  });

  it("rounds a gap both neighbors face once, whatever single precision makes of their edges", () => {
    // Widths whose edges fall a hair either side of half a pixel.
    const columns = table({
      market: category(["a", "b", "c"]),
      segment: category(["x", "x", "x"]),
      value: [100.12345, 100.87555, 401.001],
    });
    const leaves = tiles(1, columns);
    const { context, rects } = recorder(1);
    (tileDrawing.canvas as Exclude<typeof tileDrawing.canvas, false>)(context, leaves, options);
    const across = rects.map(([x0, , x1]) => [x0!, x1!]).sort((a, b) => a[0]! - b[0]!);
    expect(across).toHaveLength(3);
    for (let i = 1; i < across.length; i++) expect(across[i]![0]! - across[i - 1]![1]!).toBe(1);
  });

  it("meets a selected share and the rest at one rounded split", () => {
    // In single precision the selected part ends a hair before the split, at 400.49999.
    const parts = {
      kind: "rect",
      key: "parts",
      draw: tileDrawing,
      fill: "#000",
      fillOpacity: 1,
      rects: Float32Array.of(300.0001, 0, 100.4999, 10, 400.5, 0, 50, 10),
      count: 2,
      cuts: Uint8Array.of(SPLIT_RIGHT, SPLIT_LEFT),
      splits: Float64Array.of(400.5, 400.5),
      middles: new Float64Array(4),
      nodes: Uint32Array.of(0, 0),
      gap: 1,
    } as TileGeometry;
    const { context, rects } = recorder(1);
    (tileDrawing.canvas as Exclude<typeof tileDrawing.canvas, false>)(context, parts, options);
    expect(rects[0]![2]).toBe(rects[1]![0]);
  });

  it("draws neighbors with no gap edge to edge", () => {
    const leaves = tiles(0);
    const { context, rects } = recorder(1.5);
    (tileDrawing.canvas as Exclude<typeof tileDrawing.canvas, false>)(context, leaves, options);
    const xs = new Set(rects.flatMap(([x0, , x1]) => [x0!, x1!]));
    for (const [x0] of rects) if (x0! > 0) expect(xs.has(x0!)).toBe(true);
  });
});

describe("sunburst rings on a canvas", () => {
  it("draws gaps between rings as whole device pixels", () => {
    // One sector from 10.5 to 20.5 with a 1 px gap on each side: cut at 10 and 21.
    const ring = {
      kind: "arc",
      key: "ring",
      draw: ringDrawing,
      arcs: Float32Array.of(50, 50, 10.5, 20.5, 0, Math.PI),
      count: 1,
      colors: ["#000"],
      colorIndex: Uint32Array.of(0),
      fillOpacity: 1,
      gap: 1,
      cuts: Uint8Array.of(3),
      ringGap: 1,
    } as ArcGeometry;
    const { context, radii } = recorder(1.5);
    (ringDrawing.canvas as Exclude<typeof ringDrawing.canvas, false>)(context, ring, options);
    // At 1.5 a 1 px gap is 2 device pixels, 4/3 px: the radii move in by 1/6 px each.
    expect(Math.max(...radii)).toBeCloseTo(21 - 2 / 3, 5);
    expect(Math.min(...radii)).toBeCloseTo(10 + 2 / 3, 5);
  });
});
