import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { loadSpec, SPEC_VERSION, validateSpec } from "../../src/from-spec.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import type { RectGeometry } from "../../src/scene/scene.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";

// B6's bar race: each brand's bar at its rank, a continuous y, ranks a frame apart.
const ranked = table({
  brand: category(["IBM", "Apple", "Coca-Cola"]),
  value: [53_183, 40_000, 70_452],
  rank: [1, 2, 0],
});

function bars(config: ChartConfig) {
  const model = new ChartModel(config);
  model.setSize(600, 300, 1);
  const scene = model.scene(estimateText);
  const rects = scene.panels[0]!.marks.find((g) => g.kind === "rect") as RectGeometry;
  return { model, rects, plot: scene.panels[0]!.plot };
}

describe("bars along y", () => {
  it('stand on any y with orient: "y", their lengths along x from zero', () => {
    const { model, rects } = bars({
      marks: [bar(ranked, { itemKey: "brand", orient: "y", x: "value", y: "rank" })],
      y: { domain: [2.5, -0.5] },
    });
    const x = model.xScale()!;
    const y = model.yScale()!;
    expect(rects.count).toBe(3);
    // Row by row: each bar's top and bottom around its rank, its length to its value.
    for (let i = 0; i < 3; i++) {
      const [left, top, width, height] = rects.rects.subarray(i * 4, i * 4 + 4);
      expect(left).toBeCloseTo(x.map(0), 3);
      expect(left! + width!).toBeCloseTo(x.map(ranked.numbers("value")[i]!), 3);
      expect(top! + height! / 2).toBeCloseTo(y.map(ranked.numbers("rank")[i]!), 3);
    }
    // Ranks a frame apart: bars fill their share of the gap between ranks.
    const gap = Math.abs(y.map(1) - y.map(0));
    expect(rects.rects[3]).toBeCloseTo(Math.min(64, gap * 0.8), 3);
  });

  it("pad the y domain by half a slot, and keep a category y's bands without orient", () => {
    const { model } = bars({ marks: [bar(ranked, { orient: "y", x: "value", y: "rank" })] });
    const [lo, hi] = model.yScale()!.domain;
    expect(Math.min(lo, hi)).toBeLessThanOrEqual(-0.5);
    expect(Math.max(lo, hi)).toBeGreaterThanOrEqual(2.5);
    const banded = bars({ marks: [bar(ranked, { x: "value", y: "brand" })] });
    expect(banded.model.yScale()!.type).toBe("band");
  });

  it("refuse lengths that are categories and orients that are none", () => {
    expect(() => bar(ranked, { orient: "y", x: "brand" as never, y: "rank" })).toThrow(
      'bar orient: "y" makes x the lengths, and "brand" holds categories; give orient: "x", or a number field as x',
    );
    expect(() => bar(ranked, { orient: "x", x: "rank", y: "brand" as never })).toThrow(
      'bar orient: "x" makes y the lengths, and "brand" holds categories; give orient: "y", or a number field as y',
    );
    expect(() => bar(ranked, { orient: "z" as never, x: "value", y: "rank" })).toThrow(
      'bar orient: expected "x" or "y"; received "z"',
    );
    expect(() => bar(ranked, { orient: "y", x: "value", y: ["rank", "value"] as never })).toThrow(
      "bar y: bars along y stand on one field; give one y field, and several x",
    );
  });

  it("are inspected by their lengths along x, in no order, and by their positions along y", () => {
    const lengths = table({ rank: [0, 1, 2], value: [30, 10, 20] });
    const { model } = bars({ marks: [bar(lengths, { orient: "y", x: "value", y: "rank" })] });
    const x = model.xScale()!;
    const y = model.yScale()!;
    const at = (mode: "nearest-x" | "nearest-y", px: number, py: number) => {
      const found = model.inspect(px, py, mode);
      return found && "points" in found ? found.points.map((p) => p.row) : undefined;
    };
    expect(at("nearest-x", x.map(30), y.map(0))).toEqual([0]);
    expect(at("nearest-x", x.map(10), y.map(1))).toEqual([1]);
    expect(at("nearest-y", x.map(5), y.map(2))).toEqual([2]);
  });

  it("load from specs, and refuse a bad orient there", () => {
    const spec: ChartSpec = {
      version: SPEC_VERSION,
      data: { ranked: { columns: { value: [3, 1], rank: [0, 1] } } },
      marks: [{ type: "bar", data: "ranked", orient: "y", x: "value", y: "rank" }],
    };
    expect(() => validateSpec(spec)).not.toThrow();
    expect(loadSpec(spec).config.marks[0]!.spec).toMatchObject({ orient: "y" });
    const bad = { ...spec, marks: [{ ...spec.marks[0], orient: "up" }] } as unknown as ChartSpec;
    expect(() => validateSpec(bad)).toThrow(/marks\[0\]\.orient/);
  });
});
