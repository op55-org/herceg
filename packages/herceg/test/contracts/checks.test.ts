// Tests of the proofs' own checks (matrix.ts, drawn.ts): what each must fail for.

import { expect, test } from "vitest";
import { estimateText } from "../../src/layout/text.ts";
import { expectDrawn } from "./drawn.ts";
import { build, expectInside, neighbor, panelOf } from "./matrix.ts";

test("placement fails for a mark drawn partly past its panel's plot", () => {
  const { scene } = build({ panels: [{ id: "a" }], marks: [neighbor({ panel: "a" })] } as never);
  const panel = panelOf(scene, "a");
  expectInside(panel, "line");
  const [line] = panel.marks as unknown as {
    kind: string;
    path: { coords: Float32Array; count: number };
  }[];
  expect(line!.kind).toBe("line");
  // Every point 120 pixels right: those on the left stay in the plot.
  const { coords, count } = line!.path;
  for (let i = 0; i < count; i++) coords[2 * i]! += 120;
  expect(coords[0]).toBeLessThan(panel.plot.x + panel.plot.width);
  expect(() => expectInside(panel, "line")).toThrow(/places outside the plot/);
});

test("a picture fails to draw a mark it shows nothing of", () => {
  // A line's markup with no path data draws a white page.
  const { scene } = build({ marks: [neighbor()] } as never);
  const white = new Uint8ClampedArray(600 * 400 * 4).fill(255);
  const picture = { width: 600, scale: 1, channels: 4 };
  expect(() => expectDrawn(scene, white, picture, estimateText)).toThrow(/of \d+ places/);
});
