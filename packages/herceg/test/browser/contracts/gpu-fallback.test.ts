// Proofs of the GPU paths' fallback (test/contracts/capabilities.json,
// gpu): in a page without WebGL2, the marks the GPU would draw are drawn on
// the CPU, on the canvas. Its own file, so that its page never made a painter.

import { beforeAll, expect } from "vitest";
import { type Table, table } from "../../../src/data/table.ts";
import type { ChartMark } from "../../../src/marks/mark.ts";
import { point } from "../../../src/marks/point.ts";
import { point3d } from "../../../src/marks/point3d.ts";
import { cloudPainter } from "../../../src/render/webgl.ts";
import { markColors, nearColor } from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { canvasPixels, mount, sceneOf } from "./mount.ts";

beforeAll(() => {
  // No WebGL2 here, as in a browser without it.
  for (const target of [HTMLCanvasElement.prototype, OffscreenCanvas.prototype]) {
    const getContext = target.getContext as (...args: unknown[]) => unknown;
    target.getContext = function (this: unknown, ...args: unknown[]) {
      return args[0] === "webgl2" ? null : getContext.apply(this, args);
    } as never;
  }
});

function spiral(n: number): Table {
  const i = Float64Array.from({ length: n }, (_, k) => k);
  return table({
    x: i.map((k) => Math.cos(k / 500) * (1 + k / n)),
    y: i.map((k) => Math.sin(k / 500) * (1 + k / n)),
    z: i.map((k) => k / n),
  }) as unknown as Table;
}

/** Mounts a chart of `mark` without WebGL2: the canvas shows its colors, drawn on the CPU. */
async function expectOnCpu(mark: ChartMark): Promise<void> {
  const chart = await mount({ marks: [] }, { marks: [mark] });
  expect(cloudPainter(), "no WebGL2 painter").toBeUndefined();
  const pixels = canvasPixels(chart)!;
  expect(pixels, "drawn on a canvas").toBeDefined();
  const colors = markColors(sceneOf(chart));
  const shown = colors.filter((color) => nearColor(pixels, 4, color) > 100);
  expect(shown, `the canvas shows the mark's colors ${colors}`).not.toEqual([]);
}

contractTest("rendering.gpu.fallback.points", () =>
  expectOnCpu(point(spiral(120_000), { x: "x", y: "y" })),
);

contractTest("rendering.gpu.fallback.3d", () =>
  expectOnCpu(point3d(spiral(25_000), { x: "x", y: "y", z: "z" })),
);
