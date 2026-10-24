// What each channel draws (spec/channels.ts), which every channel's
// constants, scale outputs, and identity values are checked against.
import { describe, expect, it } from "vitest";
import { outputProblem } from "../../src/spec/channels.ts";

const COLORS = new Set(["red", "#d62728"]);

describe("channel outputs", () => {
  const isColor = (value: string) => COLORS.has(value);

  it("take what each channel draws", () => {
    expect(outputProblem("fill", "#d62728", isColor)).toBeUndefined();
    expect(outputProblem("symbol", "diamond", isColor)).toBeUndefined();
    expect(outputProblem("dash", [4, 2], isColor)).toBeUndefined();
    expect(outputProblem("dash", "--", isColor)).toBeUndefined();
    expect(outputProblem("size", 0, isColor)).toBeUndefined();
    expect(outputProblem("opacity", 1, isColor)).toBeUndefined();
  });

  it("say what a channel takes where a value is not one", () => {
    expect(outputProblem("stroke", "region", isColor)).toBe("a CSS color");
    expect(outputProblem("symbol", "hexagon", isColor)).toMatch(/^a shape: circle, /);
    expect(outputProblem("dash", [4, -2], isColor)).toMatch(/^a dash/);
    expect(outputProblem("size", -1, isColor)).toBe("an area of 0 or more square pixels");
    expect(outputProblem("strokeWidth", Number.NaN, isColor)).toBe("0 or more pixels");
    expect(outputProblem("fillOpacity", 1.5, isColor)).toBe("a number from 0 to 1");
  });
});
