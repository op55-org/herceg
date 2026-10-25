// Proofs of the GPU paths (test/contracts/capabilities.json, gpu): past
// their sizes, points and 3D charts are drawn by the page's WebGL2 painter,
// which holds their data, and the canvas shows them. A browser without
// WebGL2 fails these proofs rather than skipping them; gpu-fallback.test.ts
// proves the drawing without it.

import { expect } from "vitest";
import { type Table, table } from "../../../src/data/table.ts";
import { estimateText } from "../../../src/layout/text.ts";
import { line3d } from "../../../src/marks/line3d.ts";
import type { ChartMark } from "../../../src/marks/mark.ts";
import { point } from "../../../src/marks/point.ts";
import { point3d } from "../../../src/marks/point3d.ts";
import { surface } from "../../../src/marks/surface.ts";
import { cloudPainter } from "../../../src/render/webgl.ts";
import { markColors, nearColor } from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { modelOf } from "../helpers.ts";
import { canvasPixels, mount, sceneOf } from "./mount.ts";

/** `n` rows of x, y, and z along a spiral. */
function spiral(n: number): Table {
  const i = Float64Array.from({ length: n }, (_, k) => k);
  return table({
    x: i.map((k) => Math.cos(k / 500) * (1 + k / n)),
    y: i.map((k) => Math.sin(k / 500) * (1 + k / n)),
    z: i.map((k) => k / n),
  }) as unknown as Table;
}

/** A z field on an n by n grid. */
function grid(n: number): Table {
  const k = Float64Array.from({ length: n * n }, (_, i) => i);
  return table({
    x: k.map((i) => i % n),
    y: k.map((i) => Math.floor(i / n)),
    z: k.map((i) => Math.sin((i % n) / 9) + Math.cos(Math.floor(i / n) / 7)),
  }) as unknown as Table;
}

/**
 * Mounts a chart of `mark`: the GPU painter holds data for it, the scene
 * hands it over (`kind`), and the canvas shows the mark's colors.
 */
async function expectOnGpu(mark: ChartMark, kind: "points" | "3d"): Promise<void> {
  const painter = cloudPainter();
  expect(painter, "a WebGL2 painter").toBeDefined();
  const before = painter!.bytes;
  const chart = await mount({ marks: [] }, { marks: [mark] });
  expect(painter!.bytes, "the painter holds the mark's data").toBeGreaterThan(before);
  // The scene as the chart builds it, with the painter to hand geometry to.
  const geometry = modelOf(chart)
    .scene(estimateText, true)
    .panels.flatMap((p) => p.marks);
  if (kind === "points")
    expect(geometry.some((g) => g.kind === "point" && "cloud" in g && g.cloud)).toBe(true);
  else expect(geometry.some((g) => g.kind === "faces" && "batches" in g && g.batches)).toBe(true);
  const pixels = canvasPixels(chart)!;
  const colors = markColors(sceneOf(chart));
  const shown = colors.filter((color) => nearColor(pixels, 4, color) > 100);
  expect(shown, `the canvas shows the mark's colors ${colors}`).not.toEqual([]);
}

contractTest("rendering.gpu.points", () =>
  expectOnGpu(point(spiral(120_000), { x: "x", y: "y" }), "points"),
);

contractTest("rendering.gpu.point3d", () =>
  expectOnGpu(point3d(spiral(25_000), { x: "x", y: "y", z: "z" }), "3d"),
);

contractTest("rendering.gpu.line3d", () =>
  expectOnGpu(line3d(spiral(25_000), { x: "x", y: "y", z: "z" }), "3d"),
);

contractTest("rendering.gpu.surface", () =>
  expectOnGpu(surface(grid(120), { x: "x", y: "y", z: "z" }), "3d"),
);
