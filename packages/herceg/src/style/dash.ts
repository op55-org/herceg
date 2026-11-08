// Dash patterns, apart from the style cascade: the brush painter, which
// loads lazily, reads them without the cascade's module, which charts
// share with other lazy chunks.

import type { Dash } from "../spec/spec.ts";

/** A dash pattern in pixels: arrays as they are, matplotlib's styles scaled by the stroke width. */
export function dashPattern(value: Dash | undefined, width: number): readonly number[] | undefined {
  if (typeof value !== "string") return value;
  switch (value) {
    case "-":
      return [];
    case "--":
      return [3.7 * width, 1.6 * width];
    case ":":
      return [width, 1.65 * width];
    case "-.":
      return [6.4 * width, 1.6 * width, width, 1.6 * width];
  }
  throw new Error("dash: expected -, --, :, -.");
}
