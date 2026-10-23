// Channels bound in one form (spec/channels.ts), whatever form a mark's
// options give them in.
import { describe, expect, it } from "vitest";
import { bindChannels, MARK_CHANNELS, outputProblem } from "../../src/spec/channels.ts";

const COLORS = new Set(["red", "#d62728"]);
const forms = {
  hasField: (name: string) => ["region", "red", "size"].includes(name),
  isOutput: (channel: string, value: string) =>
    channel === "symbol" ? value === "diamond" : COLORS.has(value),
};
const point = MARK_CHANNELS.point!;

describe("channel bindings", () => {
  it("bind constants, fields, series, and conditions, keeping the option each came from", () => {
    const when = { op: "==", args: [{ field: "region" }, "eu"] } as const;
    expect(
      bindChannels(
        {
          color: "region",
          symbol: "diamond",
          size: 40,
          encode: {
            stroke: { field: "region", scale: { type: "identity" } },
            fill: { series: true, scale: "paints" },
            opacity: {
              condition: {
                when,
                // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
                then: 1,
                otherwise: 0.4,
              },
            },
            strokeWidth: { field: "size", scale: "widths" },
          },
        } as never,
        point,
        forms,
      ),
    ).toEqual({
      color: { kind: "field", field: "region", scale: { kind: "default" }, path: "color" },
      symbol: { kind: "constant", value: "diamond", path: "symbol" },
      size: { kind: "constant", value: 40, path: "size" },
      stroke: {
        kind: "field",
        field: "region",
        scale: { kind: "identity" },
        path: "encode.stroke",
      },
      fill: { kind: "series", scale: "paints", path: "encode.fill" },
      opacity: {
        kind: "condition",
        when,
        // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
        then: 1,
        otherwise: 0.4,
        path: "encode.opacity",
      },
      strokeWidth: {
        kind: "field",
        field: "size",
        scale: { kind: "named", name: "widths" },
        path: "encode.strokeWidth",
      },
    });
  });

  it("bind a mark's constant options as constants, whatever their form", () => {
    expect(
      bindChannels(
        { stroke: "red", strokeWidth: 3, dash: [2, 1], opacity: 0.5, color: "region" },
        MARK_CHANNELS.line!,
        forms,
      ),
    ).toEqual({
      stroke: { kind: "constant", value: "red", path: "stroke" },
      strokeWidth: { kind: "constant", value: 3, path: "strokeWidth" },
      dash: { kind: "constant", value: [2, 1], path: "dash" },
      opacity: { kind: "constant", value: 0.5, path: "opacity" },
      color: { kind: "field", field: "region", scale: { kind: "default" }, path: "color" },
    });
    // A constant's string is never a field: a stroke named like one is a color.
    expect(bindChannels({ fill: "region" }, MARK_CHANNELS.bar!, forms).fill).toEqual({
      kind: "constant",
      value: "region",
      path: "fill",
    });
  });

  it("refuse a string both a field and an output, or neither, and a channel set twice", () => {
    expect(() => bindChannels({ color: "red" }, point, forms)).toThrow(
      'color: "red" names a field and is a color too; give { field: "red" } or { value: "red" }',
    );
    expect(() => bindChannels({ symbol: "hexagon" }, point, forms)).toThrow(
      'symbol: no field "hexagon", and not a shape\'s name',
    );
    expect(() =>
      bindChannels({ color: "#d62728", encode: { color: { value: "#000000" } } }, point, forms),
    ).toThrow(expect.objectContaining({ path: "encode.color", code: "invalid-option" }));
    expect(() =>
      bindChannels(
        { stroke: "red", encode: { stroke: { field: "region" } } },
        MARK_CHANNELS.line!,
        forms,
      ),
    ).toThrow("encode.stroke: set as stroke and as encode.stroke; give one");
    // `{ field }` and `{ value }` say which a string is.
    expect(bindChannels({ color: { value: "red" } }, point, forms).color).toEqual({
      kind: "constant",
      value: "red",
      path: "color",
    });
  });
});

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
