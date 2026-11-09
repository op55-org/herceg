// Treemaps' tiling, sorting, gaps, and corner labels; sunbursts' levels,
// center, gaps, and radial names; and both marks' paint (colors by a level
// of the path, leaf and branch looks, opacity by an item measure), their
// breadcrumbs, the items they give overlays, and the options they refuse.

import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type {
  ArcGeometry,
  Geometry,
  LabelsGeometry,
  RectGeometry,
  Scene,
  TextGeometry,
} from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { contractTest } from "../helpers/contracts.ts";
import { legendOf } from "../helpers/guides.ts";

// B8's shape: markets by segments, in data order.
const sales = table({
  market: category(["Auburn", "Auburn", "Auburn", "Birmingham", "Birmingham", "Chattanooga"]),
  segment: category([
    "Nut fans",
    "Berry buyers",
    "Veg boxes",
    "Nut fans",
    "Veg boxes",
    "Berry buyers",
  ]),
  value: [300, 600, 100, 100, 300, 600],
});

function build(config: ChartConfig, { compilers = false, width = 600, height = 400 } = {}) {
  const model = compilers
    ? new ChartModel({ locale: "en-US", ...config }, undefined, staticCompilers())
    : new ChartModel({ locale: "en-US", ...config });
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

const all = (scene: Scene): Geometry[] => scene.panels[0]!.marks;
const rects = (scene: Scene) => all(scene).filter((m): m is RectGeometry => m.kind === "rect");
const arcs = (scene: Scene) => all(scene).filter((m): m is ArcGeometry => m.kind === "arc");

const marimekko = (options: object = {}) =>
  treemap(sales, {
    id: "cells",
    path: ["market", "segment"],
    value: "value",
    tile: "slice-dice",
    sort: "input",
    gap: 1,
    labels: false,
    ...options,
  });

describe("treemap tiling", () => {
  it("slices the top level along x in data order and each column along y, a gap apart", () => {
    const { model } = build({ marks: [marimekko()], padding: 0 });
    const items = model.items!.result()!.items!();
    const columns = items.filter((item) => item.depth === 1);
    expect(columns.map((c) => c.label)).toEqual(["Auburn", "Birmingham", "Chattanooga"]);
    const [auburn, birmingham, chattanooga] = columns.map((c) => c.box);
    // Widths in proportion to 1000, 400, and 600 of 2000, less the gaps between them.
    expect(auburn!.x).toBeCloseTo(0, 6);
    expect(birmingham!.x - (auburn!.x + auburn!.width)).toBeCloseTo(1, 6);
    expect(chattanooga!.x + chattanooga!.width).toBeCloseTo(600, 6);
    expect(auburn!.width + 0.5).toBeCloseTo((600 * 1000) / 2000, 6);
    // Auburn's cells top to bottom in data order, as tall as their shares.
    const cells = items.filter((item) => item.parent === columns[0]!.key);
    expect(cells.map((c) => c.names.at(-1))).toEqual(["Nut fans", "Berry buyers", "Veg boxes"]);
    const heights = cells.map((c) => c.box.height);
    expect(heights[1]! / heights[0]!).toBeCloseTo(2, 1);
    expect(cells.every((c) => Math.abs(c.box.x - auburn!.x) < 1e-6)).toBe(true);
  });

  it("fills the same area by value with either tiling, squarified rectangles closer to square", () => {
    const many = table({
      group: category(Array.from({ length: 12 }, () => "all")),
      item: category(Array.from({ length: 12 }, (_, i) => `item ${i}`)),
      value: Array.from({ length: 12 }, (_, i) => 12 - i),
    });
    const laid = (tile: "squarify" | "slice-dice") => {
      const mark = treemap(many, {
        path: ["group", "item"],
        value: "value",
        tile,
        gap: 0,
        labels: false,
      });
      const { model } = build({ marks: [mark], padding: 0, legend: false });
      const leaves = model.items!.result()!.items!().filter((item) => item.depth === 2);
      const ratios = leaves.map((c) =>
        Math.max(c.box.width / c.box.height, c.box.height / c.box.width),
      );
      return {
        areas: new Map(leaves.map((c) => [c.key, c.box.width * c.box.height])),
        ratio: ratios.reduce((sum, r) => sum + r, 0) / ratios.length,
      };
    };
    const sliced = laid("slice-dice");
    const squares = laid("squarify");
    for (const [key, value] of sliced.areas) expect(squares.areas.get(key)).toBeCloseTo(value, 3);
    expect(squares.ratio).toBeLessThan(sliced.ratio / 4);
  });

  it("orders siblings largest first by default, and takes levels", () => {
    const { model } = build({ marks: [marimekko({ sort: undefined, levels: 1 })] });
    const items = model.items!.result()!.items!();
    expect(items.map((c) => c.label)).toEqual(["Auburn", "Chattanooga", "Birmingham"]);
    // A level drawn: the markets are cells, at full opacity, with no strip.
    const drawn = rects(model.scene(estimateText));
    expect(drawn.map((g) => [g.key, g.fillOpacity])).toEqual(
      drawn.map(() => [expect.stringMatching(/^treemap-leaves-1/), 1]),
    );
  });
});

describe("tree paint", () => {
  it("colors items by a level of the path, leaving those above it unfilled, the legend in data order", () => {
    const { model, scene } = build({ marks: [marimekko({ color: "segment" })] });
    expect(legendOf(scene).map((entry) => entry.label)).toEqual([
      "Nut fans",
      "Berry buyers",
      "Veg boxes",
    ]);
    // Markets have no segment: no rectangles of depth 1 are filled.
    expect(rects(scene).some((g) => g.key.startsWith("treemap-groups"))).toBe(false);
    const nut = legendOf(scene)[0]!;
    const cells = rects(scene).filter((g) => g.fill === nut.color);
    expect(cells.reduce((sum, g) => sum + g.count, 0)).toBe(2);
    // Hiding a segment takes its cells' room from their markets.
    model.hidden.add(legendOf(scene)[1]!.key);
    model.scene(estimateText);
    const after = model.items!.result()!.items!();
    expect(after.find((c) => c.label === "Auburn")!.value).toBe(400);
    expect(after.map((c) => c.label)).not.toContain("Chattanooga");
    expect(after.some((c) => c.label.endsWith("Berry buyers"))).toBe(false);
  });

  it("keeps what is left beside a much larger hidden color, at any level", () => {
    const lopsided = table({
      a: category(["x", "x", "y"]),
      b: category(["big", "small", "small"]),
      v: [1e12, 1, 1],
    });
    for (const [color, label] of [
      [undefined, "x"],
      ["b", "big"],
    ] as const) {
      const mark = treemap(lopsided, {
        id: "t",
        path: ["a", "b"],
        value: "v",
        labels: false,
        ...(color && { color }),
      });
      const model = new ChartModel({ marks: [mark] });
      model.setSize(400, 300, 1);
      model.hidden.add(JSON.stringify(["t", label]));
      model.scene(estimateText);
      const left = model.items!.result()!.items!();
      // Hiding x leaves y; hiding "big" leaves both "small"s, x's of weight 1.
      expect(left.length, String(color)).toBeGreaterThan(0);
      if (color) expect(left.find((item) => item.label === "x")!.value).toBe(1);
    }
  });

  it("keeps the weight of rows ending above the color's level when a much larger color is hidden", () => {
    const partial = table({
      a: category(["x", "x", "y"]),
      b: category([null, "big", "small"]),
      v: [1, 1e12, 1],
    });
    for (const mark of [
      treemap(partial, { id: "t", path: ["a", "b"], value: "v", color: "b", labels: false }),
      sunburst(partial, { id: "t", path: ["a", "b"], value: "v", color: "b", labels: false }),
    ]) {
      const model = new ChartModel({ marks: [mark] });
      model.setSize(400, 300, 1);
      model.hidden.add(JSON.stringify(["t", "big"]));
      model.scene(estimateText);
      const left = model.items!.result()!.items!();
      expect(left.find((item) => item.label === "x")!.value).toBe(1);
      expect(left.find((item) => item.label === "y")!.value).toBe(1);
    }
  });

  it("reads depth to the deepest level shown, with the deepest branch hidden", () => {
    const uneven = table({
      a: category(["A", "B"]),
      b: category(["p", "q"]),
      c: category(["r", null]),
      v: [1, 1],
    });
    const fillOpacity = { measure: "depth" as const, range: [0.2, 1] as [number, number] };
    for (const mark of [
      treemap(uneven, { id: "t", path: ["a", "b", "c"], value: "v", fillOpacity, labels: false }),
      sunburst(uneven, { id: "t", path: ["a", "b", "c"], value: "v", fillOpacity, labels: false }),
    ]) {
      const model = new ChartModel({ marks: [mark] });
      model.setSize(400, 300, 1);
      model.hidden.add(JSON.stringify(["t", "A"]));
      const drawn = all(model.scene(estimateText)).filter(
        (g): g is RectGeometry | ArcGeometry => g.kind === "rect" || g.kind === "arc",
      );
      // B / q, two levels down, is now the deepest: the end of the range.
      expect(drawn.map((g) => g.fillOpacity)).toContain(1);
    }
  });

  it("orders the legend largest first with sort by value", () => {
    const { scene } = build({ marks: [marimekko({ color: "segment", sort: "value" })] });
    // Nut fans and Veg boxes tie at 400: the first in the data first.
    expect(legendOf(scene).map((entry) => entry.label)).toEqual([
      "Berry buyers",
      "Nut fans",
      "Veg boxes",
    ]);
  });

  it("reads each item's opacity from its share of its parent through a range", () => {
    const { scene } = build({
      marks: [marimekko({ color: "segment", fillOpacity: { measure: "share", range: [0.5, 1] } })],
    });
    // Auburn's Berry buyers are 0.6 of it: 0.5 + 0.6 * 0.5 = 0.8; whole steps of an 8-bit alpha.
    const opacities = rects(scene).map((g) => Math.round(g.fillOpacity * 1000) / 1000);
    const shares = [0.3, 0.6, 0.1, 0.25, 0.75, 1];
    expect(opacities.sort()).toEqual(
      shares
        .map((share) => Math.round((Math.round((0.5 + share / 2) * 255) / 255) * 1000) / 1000)
        .sort(),
    );
  });

  it("lays leaf and branch looks over the mark's paint, by the tree, whatever is drawn", () => {
    const { scene } = build({
      marks: [
        sunburst(sales, {
          path: ["market", "segment"],
          value: "value",
          levels: 1,
          leaf: { fillOpacity: 0.4 },
          branch: { fillOpacity: 0.6 },
          labels: false,
        }),
      ],
    });
    // One ring of markets, each with segments under it though they are not drawn.
    expect(arcs(scene).map((g) => [g.key, g.fillOpacity])).toEqual([["sunburst-1", 0.6]]);
    const leaves = build({
      marks: [
        sunburst(sales, {
          path: ["market", "segment"],
          value: "value",
          leaf: { fillOpacity: 0.4, fill: "#123456" },
        }),
      ],
    }).scene;
    const outer = arcs(leaves).find((g) => g.key === "sunburst-2")!;
    expect([outer.fillOpacity, outer.colors]).toEqual([0.4, ["#123456"]]);
  });
});

describe("tree paint read as renderers read colors", () => {
  it("resolves looks' fills as other colors, so exports and canvases can draw them", () => {
    const svg = renderToSVG({
      width: 300,
      height: 200,
      marks: [marimekko({ leaf: { fill: "var(--leaf, #ff0000)" } })],
    });
    expect(svg).not.toContain("var(");
    expect(svg).toContain('fill="#ff0000"');
  });

  it("paints no center for a root above the level color names, and still drills out there", () => {
    const deep = table({
      a: category(["x", "x", "y"]),
      b: category(["p", "q", "r"]),
      c: category(["k", "l", "k"]),
      v: [1, 2, 3],
    });
    const { model } = build({
      marks: [sunburst(deep, { path: ["a", "b", "c"], value: "v", color: "c", labels: false })],
      interaction: { zoom: true },
    });
    model.items!.setDrillRoot(["x"]);
    const scene = model.scene(estimateText);
    expect(arcs(scene).some((g) => g.key.startsWith("sunburst-root"))).toBe(false);
    const found = model.items!.result()!.items!();
    expect(found.some((item) => item.depth === 0)).toBe(false);
    const { cx, cy } = found[0]!.sector!;
    expect(model.items!.result()!.drill!.out!(cx, cy)).toBe(true);
  });

  it("reads depth to the deepest level drawn, not to levels asked for beyond it", () => {
    const { scene } = build({
      marks: [
        sunburst(sales, {
          path: ["market", "segment"],
          value: "value",
          levels: 5,
          fillOpacity: { measure: "depth", range: [0, 1] },
          labels: false,
        }),
      ],
    });
    expect(arcs(scene).find((g) => g.key === "sunburst-2")!.fillOpacity).toBe(1);
  });
});

describe("sunburst geometry", () => {
  const rings = (options: object = {}) =>
    sunburst(sales, {
      id: "rings",
      path: ["market", "segment"],
      value: "value",
      labels: false,
      ...options,
    });

  it("keeps rings as wide as levels makes them, drilled or not, the center a fraction of the radius", () => {
    // No breadcrumbs, whose strip would take room once drilled.
    const options = { levels: 2, innerRadius: 1 / 3, gap: 0, breadcrumbs: false };
    const { model } = build({ marks: [rings(options)] }, { width: 400, height: 400 });
    const r = Math.max(...model.items!.result()!.items!().map((item) => item.sector!.outerRadius));
    const sector = (item: {
      sector?: { innerRadius: number; outerRadius: number };
    }): [number, number] => [item.sector!.innerRadius, item.sector!.outerRadius];
    const first = model.items!.result()!.items!()[0]!;
    // The ring's radii, before gaps: a third of the radius each.
    expect(sector(first)[0]).toBeCloseTo(r / 3, 6);
    expect(sector(first)[1]).toBeCloseTo((2 * r) / 3, 6);
    expect(first.sector!.startAngle).toBe(0);
    model.items!.setDrillRoot(["Auburn"]);
    model.scene(estimateText);
    const drilled = model.items!.result()!.items!();
    // The center first, then one ring, as wide as before; the outer ring stays empty.
    expect(drilled[0]!.depth).toBe(0);
    expect(sector(drilled[1]!)[1] - sector(drilled[1]!)[0]).toBeCloseTo(r / 3, 6);
    expect(drilled.every((item) => (item.depth ?? 0) <= 1)).toBe(true);
    expect(drilled[1]!.parent).toBe(drilled[0]!.key);
  });

  it("leaves the center empty with center: false, which still drills out on a click", () => {
    const { model, scene } = build({
      marks: [rings({ center: false })],
      interaction: { zoom: true },
    });
    model.items!.setDrillRoot(["Auburn"]);
    const drilled = model.scene(estimateText);
    expect(arcs(drilled).some((g) => g.key.startsWith("sunburst-root"))).toBe(false);
    const { cx, cy } = model.items!.result()!.items!()[0]!.sector!;
    expect(model.inspect(cx, cy)).toBeUndefined();
    expect(model.items!.result()!.drill!.out!(cx, cy)).toBe(true);
    expect(model.items!.result()!.drill!.out!(cx + 150, cy)).toBe(false);
    expect(arcs(scene).some((g) => g.key.startsWith("sunburst-root"))).toBe(false);
  });

  it("takes angular and radial gaps apart", () => {
    const { scene } = build({ marks: [rings({ gap: { angular: 3, radial: 1 } })] });
    const ring = arcs(scene).find((g) => g.key === "sunburst-1")! as ArcGeometry & {
      ringGap: number;
    };
    expect([ring.gap, ring.ringGap]).toEqual([3, 1]);
  });

  it("hides breadcrumbs with false and shows them at the root with true", () => {
    const crumbs = (scene: Scene) =>
      all(scene).filter((g): g is TextGeometry => g.kind === "text" && g.key.includes("-path"));
    expect(
      crumbs(build({ marks: [rings({ breadcrumbs: false })], interaction: { zoom: true } }).scene),
    ).toEqual([]);
    expect(crumbs(build({ marks: [rings({ breadcrumbs: true })] }).scene)).not.toEqual([]);
    expect(crumbs(build({ marks: [rings()], interaction: { zoom: true } }).scene)).not.toEqual([]);
  });
});

describe("tree labels", () => {
  it("writes content in the top-left corner of each cell, parents unnamed and without strips", () => {
    const labels = {
      at: "top-left" as const,
      parents: false,
      content: [
        { field: "segment" as const },
        "\n",
        { value: true as const, format: { number: ",.0f" }, style: { opacity: 0.7 } },
      ],
    };
    const { model, scene } = build({ marks: [marimekko({ labels })] }, { compilers: true });
    const items = all(scene)
      .filter((g): g is LabelsGeometry => g.kind === "labels")
      .flatMap((g) => g.items);
    const texts = items.map((item) => item.text);
    expect(texts).toEqual(expect.arrayContaining(["Nut fans", "300", "Berry buyers", "600"]));
    expect(texts).not.toContain("Auburn");
    expect(items.find((item) => item.text === "600")!.paint.opacity).toBe(0.7);
    // No strips: Auburn's first cell starts at its column's top.
    const found = model.items!.result()!.items!();
    const auburn = found.find((c) => c.label === "Auburn")!.box;
    const nut = found.find((c) => c.label === "Auburn / Nut fans")!.box;
    expect(nut.y).toBeCloseTo(auburn.y, 6);
    // Corner: the first line starts 4 pixels in.
    expect(items.find((item) => item.text === "Nut fans")!.x).toBeCloseTo(nut.x + 4, 6);
  });

  it("draws plain names until the feature compiler is there", () => {
    const { scene } = build({ marks: [marimekko({ labels: { style: { fontWeight: 700 } } })] });
    expect(all(scene).some((g) => g.kind === "labels")).toBe(false);
    expect(all(scene).some((g) => g.kind === "text")).toBe(true);
  });

  it("turns sunburst names along the radius, upright", () => {
    const { scene } = build(
      {
        marks: [
          sunburst(sales, {
            path: ["market", "segment"],
            value: "value",
            labels: { rotation: "radial" },
          }),
        ],
      },
      { compilers: true, width: 600, height: 600 },
    );
    const items = all(scene)
      .filter((g): g is LabelsGeometry => g.kind === "labels")
      .flatMap((g) => g.items);
    expect(items.length).toBeGreaterThan(0);
    expect(items.some((item) => item.angle !== 0)).toBe(true);
    for (const item of items)
      expect(Math.cos((item.angle * Math.PI) / 180)).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe("sunburst names by an angle", () => {
  // Sectors of 237.6, 118.8, 2.38, and 1.19 degrees.
  const slices = table({
    name: category(["Wide", "Half", "A long name of a thin sector", "Thinner"]),
    v: [100, 50, 1, 0.5],
  });
  const thin = (1 / 151.5) * 360;
  const sectors = (labels: object, compilers = false) =>
    build(
      {
        marks: [sunburst(slices, { path: ["name"], value: "v", labels })],
        legend: false,
      },
      { compilers, width: 400, height: 400 },
    ).scene;
  const plain = (scene: Scene) =>
    all(scene).flatMap((g) => (g.kind === "text" ? (g as TextGeometry).labels : []));
  const parts = (scene: Scene) =>
    all(scene)
      .filter((g): g is LabelsGeometry => g.kind === "labels")
      .flatMap((g) => g.items.map((item) => item.text));

  it("names where names fit without it", () => {
    const names = plain(sectors({}));
    expect(names).toContain("Wide");
    expect(names.some((name) => name.startsWith("A long"))).toBe(false);
  });

  contractTest(
    "sunburst.labels.min-angle",
    () => {
      expect(plain(sectors({ minAngle: 2 }))).toEqual([
        "Wide",
        "Half",
        "A long name of a thin sector",
      ]);
      // A sector as wide as the angle is named.
      expect(plain(sectors({ minAngle: thin }))).toContain("A long name of a thin sector");
      expect(plain(sectors({ minAngle: thin + 0.01 }))).toEqual(["Wide", "Half"]);
      // 0: every sector drawn.
      expect(plain(sectors({ minAngle: 0 }))).toHaveLength(4);
    },
    "names every sector at least that wide, whole, and no narrower one",
  );

  it("names whole along the radius and in parts' styles too", () => {
    const radial = parts(sectors({ rotation: "radial", minAngle: 2 }, true));
    expect(radial).toEqual(["Wide", "Half", "A long name of a thin sector"]);
    const styled = parts(
      sectors(
        {
          minAngle: 2,
          content: [{ field: "name" }, "\n", { value: true }],
          style: { fontSize: 14 },
        },
        true,
      ),
    );
    expect(styled).toEqual(expect.arrayContaining(["A long name of a thin sector", "1"]));
    expect(styled).not.toContain("Thinner");
  });
});

describe("tree labels as painted", () => {
  const labelItems = (scene: Scene) =>
    all(scene)
      .filter((g): g is LabelsGeometry => g.kind === "labels")
      .flatMap((g) => g.items);

  it("keeps a label's padded background inside its cell", () => {
    const labels = { style: { background: { fill: "#eeeeee" }, padding: 10 } };
    const { model, scene } = build(
      { marks: [marimekko({ labels })], padding: 0 },
      { compilers: true },
    );
    const boxed = labelItems(scene).filter((item) => item.box);
    expect(boxed.length).toBeGreaterThan(0);
    const cells = model.items!.result()!.items!().map((item) => item.box);
    for (const { box } of boxed) {
      const inside = cells.some(
        (cell) =>
          box!.x >= cell.x - 1e-6 &&
          box!.y >= cell.y - 1e-6 &&
          box!.x + box!.width <= cell.x + cell.width + 1e-6 &&
          box!.y + box!.height <= cell.y + cell.height + 1e-6,
      );
      expect(inside, JSON.stringify(box)).toBe(true);
    }
  });

  it("keeps parents' names in strips as tall as their padded labels", () => {
    const labels = { style: { background: { fill: "#eeeeee" }, padding: 10 } };
    const { scene } = build(
      { marks: [treemap(sales, { path: ["market", "segment"], value: "value", labels })] },
      { compilers: true },
    );
    expect(labelItems(scene).map((item) => item.text)).toEqual(
      expect.arrayContaining(["Auburn", "Birmingham", "Chattanooga"]),
    );
  });

  it("keeps a drilled sunburst's center name inside its disc", () => {
    const style = { fontSize: 50, background: { fill: "#eeeeee" }, padding: 2 };
    const { model } = build(
      {
        marks: [
          sunburst(sales, {
            path: ["market", "segment"],
            value: "value",
            innerRadius: 0.45,
            labels: { style },
            breadcrumbs: false,
          }),
        ],
        interaction: { zoom: true },
      },
      { compilers: true, width: 400, height: 400 },
    );
    model.items!.setDrillRoot(["Chattanooga"]);
    const scene = model.scene(estimateText);
    const { cx, cy, innerRadius } = model.items!.result()!.items!()[1]!.sector!;
    const disc = innerRadius - 1;
    for (const { box } of labelItems(scene).filter((item) => item.box)) {
      if (Math.hypot(box!.x + box!.width / 2 - cx, box!.y + box!.height / 2 - cy) > 1) continue;
      for (const [x, y] of [
        [box!.x, box!.y],
        [box!.x + box!.width, box!.y + box!.height],
      ])
        expect(Math.hypot(x! - cx, y! - cy)).toBeLessThanOrEqual(disc);
    }
  });

  it("writes fields on one line, so parents' strips hold their names", () => {
    const broken = table({
      a: category(["long\nname", "long\nname", "other"]),
      b: category(["x", "y", "z"]),
      v: [3, 2, 4],
    });
    const { model, scene } = build(
      {
        marks: [
          treemap(broken, { path: ["a", "b"], value: "v", labels: { content: [{ field: "a" }] } }),
        ],
      },
      { compilers: true },
    );
    // The parent's own name, in its strip above its children's.
    const parent = model.items!.result()!.items!().find(
      (item) => item.depth === 1 && item.names[0] === "long\nname",
    )!;
    const child = model.items!.result()!.items!().find((item) => item.parent === parent.key)!;
    const named = labelItems(scene).filter((item) => item.text === "long name");
    expect(named.some((item) => item.y >= parent.box.y && item.y < child.box.y)).toBe(true);
  });

  it("inks names by what a rectangle is seen against, its parents under it", () => {
    // Faint white leaves over black parents look nearly black: their names are white.
    const { scene } = build({
      marks: [
        treemap(sales, {
          path: ["market", "segment"],
          value: "value",
          branch: { fill: "#000000", fillOpacity: 1 },
          leaf: { fill: "#ffffff", fillOpacity: 0.1 },
        }),
      ],
      legend: false,
    });
    const names = all(scene).filter(
      (g): g is TextGeometry => g.kind === "text" && g.key.includes("treemap-labels"),
    );
    expect(names.flatMap((g) => g.labels)).toContain("Nut fans");
    expect(names.map((g) => g.fill)).toEqual(names.map(() => "#ffffff"));
  });

  it("inks names against the plot's own fill, and unfilled items by what is behind them", () => {
    const faint = { leaf: { fill: "#ffffff", fillOpacity: 0.05 }, labels: true } as const;
    for (const mark of [
      treemap(sales, { path: ["market", "segment"], value: "value", ...faint }),
      sunburst(sales, { path: ["market", "segment"], value: "value", ...faint }),
    ]) {
      const { scene } = build({
        marks: [mark],
        legend: false,
        theme: { style: { plot: { fill: "#000000" } } },
      });
      const names = all(scene).filter(
        (g): g is TextGeometry => g.kind === "text" && g.key.includes("-labels"),
      );
      expect(names.flatMap((g) => g.labels)).toContain("Nut fans");
      expect(new Set(names.map((g) => g.fill))).toEqual(new Set(["#ffffff"]));
    }
    // A sunburst's first ring, above the color's level: not filled, over the black plot.
    const rings = build({
      marks: [sunburst(sales, { path: ["market", "segment"], value: "value", color: "segment" })],
      legend: false,
      theme: { style: { plot: { fill: "#000000" } } },
    }).scene;
    const markets = all(rings)
      .filter((g): g is TextGeometry => g.kind === "text" && g.key.includes("-labels"))
      .find((g) => g.labels.includes("Auburn"))!;
    expect(markets.fill).toBe("#ffffff");
    // "short" ends above the color's level: not filled, over its black parent.
    const partial = table({
      a: category(["A", "A", "Z"]),
      b: category(["short", "B", "Y"]),
      c: category([null, "C", "X"]),
      v: [5, 5, 5],
    });
    const { scene } = build({
      marks: [
        treemap(partial, {
          path: ["a", "b", "c"],
          value: "v",
          color: "c",
          branch: { fill: "#000000", fillOpacity: 1 },
        }),
      ],
      legend: false,
    });
    const short = all(scene)
      .filter((g): g is TextGeometry => g.kind === "text" && g.key.includes("-labels"))
      .find((g) => g.labels.includes("short"))!;
    expect(short.fill).toBe("#ffffff");
  });

  it("finds what is behind items of a tree deeper than the call stack", () => {
    const n = 10_000;
    const chain = table({
      node: Array.from({ length: n }, (_, i) => `n${i}`),
      parent: Array.from({ length: n }, (_, i) => (i ? `n${i - 1}` : null)),
      v: Float64Array.from({ length: n }, (_, i) => (i === n - 1 ? 1 : 0)),
    });
    const mark = treemap(chain, {
      node: "node",
      parent: "parent",
      value: "v",
      gap: 0,
      labels: { parents: false },
    });
    expect(() => build({ marks: [mark], legend: false })).not.toThrow();
  });

  it("names a drilled root's parent in the middle of a tree of node and parent fields", () => {
    const org = table({
      node: category(["A", "B", "C", "D"]),
      parent: category([null, "A", "B", "B"]),
    });
    const { model } = build(
      {
        marks: [
          sunburst(org, {
            node: "node",
            parent: "parent",
            labels: { content: [{ field: "parent" }] },
          }),
        ],
        interaction: { zoom: true },
      },
      { compilers: true, width: 400, height: 400 },
    );
    model.items!.setDrillRoot(["A", "B"]);
    const scene = model.scene(estimateText);
    const { cx, cy } = model.items!.result()!.items!()[0]!.sector!;
    const middle = labelItems(scene).filter((item) => Math.hypot(item.x - cx, item.y - cy) < 20);
    expect(middle.map((item) => item.text)).toEqual(["A"]);
  });

  it("draws no radial name whose outer corners would cross the ring's edge", () => {
    const one = table({ name: category(["iii"]), v: [1] });
    const { scene } = build(
      {
        marks: [
          sunburst(one, {
            path: ["name"],
            value: "v",
            innerRadius: 0.45,
            labels: { rotation: "radial", style: { fontSize: 100 } },
          }),
        ],
        legend: false,
      },
      { compilers: true, width: 300, height: 300 },
    );
    expect(labelItems(scene)).toEqual([]);
  });
});

describe("refused tree options", () => {
  const refuses = (make: () => unknown, message: string) => expect(make).toThrow(message);

  it("names the option and what it takes", () => {
    refuses(
      () => sunburst(sales, { path: ["market"], levels: 0 }),
      "sunburst levels: expected a whole number of at least 1; received 0",
    );
    refuses(
      () => treemap(sales, { path: ["market", "segment"], color: "value" as never }),
      'treemap color: "value" is not a field of the path; use one of market, segment',
    );
    refuses(
      () =>
        treemap(sales, {
          path: ["market"],
          fillOpacity: { measure: "size" as never, range: [0, 1] },
        }),
      'treemap fillOpacity measure: expected "share", "value", or "depth"; received "size"',
    );
    refuses(
      () => treemap(sales, { path: ["market"], labels: { overlap: "hide" } as never }),
      "treemap labels overlap: names show where they fit; drop overlap",
    );
    refuses(
      () => treemap(sales, { path: ["market"], leaf: { stroke: "black" } as never }),
      "treemap leaf.stroke: treemap items draw no outline and no stroke; give fill, fillOpacity, or opacity",
    );
    refuses(
      () => treemap(sales, { path: ["market"], labels: { rotation: "radial" } as never }),
      "treemap labels rotation: treemap labels take at, parents, content, style; drop rotation",
    );
    refuses(
      () => sunburst(sales, { path: ["market"], labels: { content: [{ series: true }] } as never }),
      "sunburst labels.content[0]: names a series, and tree items are none; give text, a field, or the value",
    );
    refuses(
      () => sunburst(sales, { path: ["market"], innerRadius: 1 }),
      "sunburst innerRadius: expected at least 0 and below 1; received 1",
    );
    refuses(
      () => treemap(sales, { path: ["market"], tile: "binary" as never }),
      'treemap tile: expected "squarify" or "slice-dice"; received "binary"',
    );
    for (const minAngle of [-1, 361, Number.NaN, "2" as never])
      refuses(
        () => sunburst(sales, { path: ["market"], labels: { minAngle } }),
        `sunburst labels.minAngle: expected degrees from 0 to 360; received ${JSON.stringify(minAngle)}`,
      );
    refuses(
      () => treemap(sales, { path: ["market"], labels: { minAngle: 2 } as never }),
      "treemap labels minAngle: treemap labels take at, parents, content, style; drop minAngle",
    );
  });

  it("refuses time formats in labels, which write numbers", () => {
    for (const make of [treemap, sunburst] as const)
      for (const format of [
        { time: "%Y" },
        { minute: "2-digit" as const },
        { timeZone: "UTC" },
        { calendar: "gregory" },
        { formatMatcher: "basic" as const },
      ])
        refuses(
          () =>
            make(sales, {
              path: ["market"],
              value: "value",
              labels: { content: [{ value: true, format }] },
            }),
          `${make.name} labels.content[0].format: tree labels write numbers, which time formats do not; give a number format, such as { number: ",.0f" }`,
        );
  });

  it("checks the same options in specs", () => {
    const spec = (mark: object) => ({
      version: 1,
      data: { sales: { columns: { market: ["a"], segment: ["b"], value: [1] } } },
      marks: [
        { type: "treemap", data: "sales", path: ["market", "segment"], value: "value", ...mark },
      ],
    });
    expect(() =>
      validateSpec(
        spec({
          tile: "slice-dice",
          sort: "input",
          gap: 1,
          color: "segment",
          fillOpacity: { measure: "share", range: [0.5, 1] },
          labels: { at: "top-left", parents: false, content: [{ field: "segment" }] },
          leaf: { fillOpacity: 0.4 },
          breadcrumbs: false,
          levels: 2,
        }),
      ),
    ).not.toThrow();
    expect(() => validateSpec(spec({ labels: { overlap: "hide" } }))).toThrow(
      "marks[0].labels.overlap: names show where they fit; drop overlap",
    );
    expect(() => validateSpec(spec({ fillOpacity: { measure: "size", range: [0, 1] } }))).toThrow(
      'marks[0].fillOpacity.measure: expected "share", "value", or "depth"; received "size"',
    );
    expect(() => validateSpec(spec({ levels: 0 }))).toThrow(
      "marks[0].levels: expected a whole number of at least 1; received 0",
    );
    expect(() => validateSpec(spec({ labels: { minAngle: 2 } }))).toThrow(
      "marks[0].labels.minAngle: treemap names show where they fit; drop minAngle",
    );
    expect(() =>
      validateSpec(spec({ type: "sunburst", labels: { rotation: "radial", minAngle: 1.72 } })),
    ).not.toThrow();
    expect(() => validateSpec(spec({ type: "sunburst", labels: { minAngle: -1 } }))).toThrow(
      "marks[0].labels.minAngle: expected degrees from 0 to 360; received -1",
    );
    // Loaded, both marks refuse formats they cannot write.
    for (const type of ["treemap", "sunburst"])
      for (const format of [
        { timeZone: "UTC" },
        { calendar: "gregory" },
        { formatMatcher: "basic" },
      ])
        expect(() =>
          loadSpec(spec({ type, labels: { content: [{ value: true, format }] } }) as never),
        ).toThrow(
          `marks[0]: ${type} labels.content[0].format: tree labels write numbers, which time formats do not`,
        );
  });
});
