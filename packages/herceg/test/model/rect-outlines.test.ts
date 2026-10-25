// Rectangles' widths and outlines: bars of a width in pixels in every
// orientation and group, outlines of some sides on bars and regions, and
// region edges the plot cuts left unstroked.
import { describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { ALL_SIDES, sideMask } from "../../src/draw/rect.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { RectGeometry, Scene } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";
import { setViewport } from "../helpers/views.ts";

function build(config: ChartConfig, width = 400) {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(width, 200, 1);
  return { model, scene: model.scene(estimateText) };
}

const rects = (scene: Scene) =>
  scene.panels[0]!.marks.filter((m): m is RectGeometry => m.kind === "rect");
/** A geometry's rectangles as [x, y, width, height]. */
const boxes = (g: RectGeometry) =>
  Array.from({ length: g.count }, (_, i) => Array.from(g.rects.slice(i * 4, i * 4 + 4)));

const zones = table({ zone: ["North", "South", "East"], gain: [12, -7, 9] });
const sales = table({
  month: ["Jan", "Jan", "Feb", "Feb"],
  v: [3, 5, 4, 6],
  region: ["N", "S", "N", "S"],
});
const daily = table({ t: [0, 10, 20, 30, 40], v: [1, 2, 3, 2, 1] });

describe("bars of a width in pixels", () => {
  contractTest("bar.width.pixels", () => {
    // Vertical bars 8 pixels wide, centered in their bands.
    const { model, scene } = build({
      marks: [bar(zones, { x: "zone", y: "gain", width: { px: 8 } })],
    });
    const x = model.xScale()!;
    for (const [i, [left, , width]] of boxes(rects(scene)[0]!).entries()) {
      expect(width).toBe(8);
      expect(left! + 4).toBeCloseTo(x.map(i), 3);
    }
    // Horizontal bars take it as their height.
    const across = build({
      marks: [bar(zones, { y: "zone", x: "gain", width: { px: 6 } })],
    });
    for (const [, , , height] of boxes(rects(across.scene)[0]!)) expect(height).toBe(6);
  });

  contractTest("bar.width.dodge", () => {
    // Grouped bars stand centered in their shares of the band.
    const plain = rects(
      build({ marks: [bar(sales, { x: "month", y: "v", series: "region" })] }).scene,
    );
    const fixed = rects(
      build({ marks: [bar(sales, { x: "month", y: "v", series: "region", width: { px: 4 } })] })
        .scene,
    );
    for (const [k, g] of fixed.entries())
      for (const [i, [left, , width]] of boxes(g).entries()) {
        const [plainLeft, , plainWidth] = boxes(plain[k]!)[i]!;
        expect(width).toBe(4);
        expect(left! + 2).toBeCloseTo(plainLeft! + plainWidth! / 2, 3);
      }
  });

  contractTest("bar.width.view", () => {
    // Bars beyond the view's neighbors whose width reaches into it are drawn:
    // zoomed to [19, 21], a bar 7,000 pixels wide reaches about 20 units.
    const wide = bar(daily, { x: "t", y: "v", width: { px: 7000 } });
    const { model } = build({ marks: [wide] });
    setViewport(model, [19, 21]);
    expect(rects(model.scene(estimateText))[0]!.count).toBe(5);
    // Bars of their band's width draw the view's neighbors only.
    const plain = build({ marks: [bar(daily, { x: "t", y: "v" })] });
    setViewport(plain.model, [19, 21]);
    expect(rects(plain.model.scene(estimateText))[0]!.count).toBe(3);
  });
});

describe("outlines of some sides", () => {
  contractTest("bar.stroke-sides.geometry", () => {
    const capped = (options: object) =>
      rects(
        build({
          marks: [bar(zones, { x: "zone", y: "gain", stroke: "#000", ...options })],
        }).scene,
      )[0]!;
    // Every side: a closed outline over rounded ends, as without sides.
    const all = capped({ strokeSides: ["top", "right", "bottom", "left"] });
    expect(all.edge?.sides).toBeUndefined();
    expect(all.rounded).toBeDefined();
    // Some sides: the screen's top of every bar, positive or negative, over square ends.
    const top = capped({ strokeSides: ["top"] });
    expect(top.edge?.sides).toBe(sideMask(["top"]));
    expect(top.rounded).toBeUndefined();
    // None: no outline, and the ends stay rounded.
    const none = capped({ strokeSides: [] });
    expect(none.edge).toBeUndefined();
    expect(none.rounded).toBeDefined();
    // Outlines from looks of their own: square where outlined, rounded where not.
    const looks = rects(
      build({
        marks: [
          bar(zones, {
            x: "zone",
            y: "gain",
            strokeSides: ["top"],
            style: { by: { field: "zone", map: { East: { stroke: "#ff0000" } } } },
          }),
        ],
      }).scene,
    );
    const outlined = looks.find((g) => g.edge)!;
    expect(outlined.edge?.sides).toBe(sideMask(["top"]));
    expect(outlined.rounded).toBeUndefined();
    expect(looks.find((g) => !g.edge)?.rounded).toBeDefined();
  });

  contractTest("region.stroke.edges", () => {
    // A band across the plot's height outlines its two edges, not the plot's top and bottom.
    const band = region({ x1: 10, x2: 20, stroke: "#000" });
    const banded = rects(build({ marks: [line(daily, { x: "t", y: "v" }), band] }).scene)[0]!;
    expect(banded.edge).toMatchObject({ stroke: "#000", width: 1 });
    expect(Array.from(banded.edge!.sides as Uint8ClampedArray).slice(0, 1)).toEqual([
      sideMask(["left", "right"]),
    ]);
    // A rectangle cut by the plot's left edge outlines its other sides, as given.
    const cut = region({ x1: -100, x2: 20, y1: 1, y2: 2, strokeWidth: 2 });
    const kept = rects(build({ marks: [line(daily, { x: "t", y: "v" }), cut] }).scene)[0]!;
    expect((kept.edge!.sides as Uint8ClampedArray)[0]).toBe(ALL_SIDES & ~sideMask(["left"]));
    const some = region({
      x1: -100,
      x2: 20,
      y1: 1,
      y2: 2,
      stroke: "#000",
      strokeSides: ["left", "top"],
    });
    const given = rects(build({ marks: [line(daily, { x: "t", y: "v" }), some] }).scene)[0]!;
    expect((given.edge!.sides as Uint8ClampedArray)[0]).toBe(sideMask(["top"]));
    // Without a color, in the region's fill.
    expect(kept.edge).toMatchObject({ stroke: kept.fill, width: 2 });
    // From 0 on a log scale it reaches past the plot's bottom, which it leaves unstroked.
    const low = rects(
      build({
        marks: [line(daily, { x: "t", y: "v" }), region({ y1: 0, y2: 2, stroke: "#000" })],
        y: { type: "log", domain: [1, 100] },
      }).scene,
    )[0]!;
    expect((low.edge!.sides as Uint8ClampedArray)[0]).toBe(sideMask(["top"]));
  });
});
