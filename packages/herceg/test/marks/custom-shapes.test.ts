// The index of custom marks' items by their shapes (marks/custom-shapes.ts).
import { describe, expect, it } from "vitest";
import { estimateText } from "../../src/layout/text.ts";
import { ShapeIndex } from "../../src/marks/custom-shapes.ts";
import type { PathShape } from "../../src/scene/scene.ts";

const square = (x: number, y: number, side = 10): PathShape => ({
  d: `M${x} ${y}h${side}v${side}h${-side}Z`,
  fill: "#000000",
  stroke: undefined,
  strokeWidth: 0,
  opacity: 1,
  dash: undefined,
});

const indexOf = (
  shapes: PathShape[],
  bounds?: { x: number; y: number; width: number; height: number },
) =>
  new ShapeIndex(
    shapes,
    shapes.map((_, i) => ({ start: i, end: i + 1 })),
    "12px sans-serif",
    12,
    estimateText,
    bounds,
  );

describe("the shapes index", () => {
  it("finds items through its grid whatever the boxes' extent", () => {
    // Over 256 items, one drawn far off the plot, the rest near the origin.
    const shapes = [
      square(-100_000, 0),
      ...Array.from({ length: 300 }, (_, i) =>
        square(100 + (i % 20) * 12, 100 + Math.floor(i / 20) * 12),
      ),
    ];
    const index = indexOf(shapes);
    expect(index.find(105, 105, 0)?.group).toBe(1);
    expect(index.find(-99_995, 5, 0)?.group).toBe(0);
    expect(index.find(5_000, 5, 4)).toBeUndefined();
  });

  it("keep boxes that enclose the shapes, far off or at fractions of a pixel", () => {
    // A bar from far off the plot visibly ends at x 80.25.
    const long: PathShape = { ...square(0, 0), d: "M-1000000000 0H80.25V10H-1000000000Z" };
    const bounds = { x: -100, y: -100, width: 300, height: 300 };
    for (const count of [1, 257]) {
      const index = indexOf(
        Array.from({ length: count }, () => long),
        bounds,
      );
      expect(index.find(80.2, 5, 0)?.group, `${count}`).toBe(count - 1);
      expect(index.box(0)).toEqual({ x: -1e9, y: 0, width: 1e9 + 80.25, height: 10 });
    }
  });

  it("find curves as drawn, however far zooming stretches them", () => {
    // A curve 10 px wide a million pixels across, through (200, 150).
    const stroke: PathShape = {
      ...square(0, 0),
      d: "M-507299.75 -749775C-507299.75 250225 492700.25 250225 492700.25 -749775",
      fill: "none",
      stroke: "#000000",
      strokeWidth: 10,
    };
    const index = indexOf([stroke]);
    expect(index.find(200, 150, 4)?.distance).toBe(0);
    expect(index.find(200, 162, 4)).toBeUndefined();
  });

  it("find arcs as drawn, circles and ellipses enlarged by zooming", () => {
    // Outlines 1 px wide through (200, 150), at an eighth of a turn, where a
    // quarter turn's cubic strays furthest.
    for (const [rx, ry] of [
      [20_000, 20_000],
      [40_000, 10_000],
    ] as const) {
      const [cx, cy] = [200 - rx * Math.cos(Math.PI / 8), 150 - ry * Math.sin(Math.PI / 8)];
      const ellipse: PathShape = {
        ...square(0, 0),
        d: `M${cx - rx} ${cy}A${rx} ${ry} 0 1 0 ${cx + rx} ${cy}A${rx} ${ry} 0 1 0 ${cx - rx} ${cy}Z`,
        fill: "none",
        stroke: "#000000",
        strokeWidth: 1,
      };
      const index = indexOf([ellipse]);
      expect(index.find(200, 150, 0.5)?.distance, `${rx} × ${ry}`).toBe(0);
    }
  });

  it("pick strokes only where they paint, their ends butt however their points repeat", () => {
    const stroked = (d: string, strokeWidth: number): PathShape => ({
      ...square(0, 0),
      d,
      fill: "none",
      stroke: "#000000",
      strokeWidth,
    });
    // A closed path of one point paints nothing: the square under it is found.
    const dot = indexOf([square(95, 95), stroked("M100 100Z", 10)]);
    expect(dot.find(100, 100, 0)?.group).toBe(0);
    // A line whose first point repeats ends butt there, as drawn.
    const line = indexOf([stroked("M0 50L0 50L10 50", 4)]);
    expect(line.find(-1, 50, 0)).toBeUndefined();
    expect(line.find(1, 51, 0)?.distance).toBe(0);
  });

  it("find shapes at the grid's edges, and leave those far past its bounds out of it", () => {
    const shapes = Array.from({ length: 257 }, () => square(0, 0, 32));
    const index = indexOf(shapes);
    expect(index.find(32, 16, 0)?.group).toBe(256);
    expect(index.find(16, 32, 0)?.group).toBe(256);
    // One drawn far away is not filed, and does not coarsen the grid.
    const bounded = indexOf([square(-1e9, -1e9), ...shapes], {
      x: -100,
      y: -100,
      width: 300,
      height: 300,
    });
    expect(bounded.find(16, 16, 0)?.group).toBe(257);
    expect(bounded.find(-1e9 + 5, -1e9 + 5, 0)).toBeUndefined();
    expect(bounded.box(0)).toEqual({ x: -1e9, y: -1e9, width: 10, height: 10 });
  });

  it("find the last painted of shapes as near, and fills by their shapes, not their boxes", () => {
    const triangle: PathShape = { ...square(0, 0), d: "M0 0L20 0L0 20Z" };
    const index = indexOf([square(0, 0, 30), triangle]);
    expect(index.find(5, 5, 0)?.group).toBe(1);
    // Inside the triangle's box, outside the triangle: the square under it.
    expect(index.find(15, 15, 0)?.group).toBe(0);
  });
});
