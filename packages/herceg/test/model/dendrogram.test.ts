import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { DendrogramMark, dendrogram } from "../../src/marks/dendrogram.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import type { Frame } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { describeChart } from "../../src/model/describe.ts";
import { facet } from "../../src/model/facet.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { BandScale, LinearScale } from "../../src/scale/scale.ts";
import type { AxisGuide, SegmentGeometry } from "../../src/scene/scene.ts";
import { LIGHT } from "../../src/theme.ts";
import { clustermap } from "../fixtures/clustermap.ts";
import { legendOf } from "../helpers/guides.ts";
import { stopsOf } from "../helpers/keyboard.ts";
import { setViewport } from "../helpers/views.ts";

const linkage = () => table({ first: [0, 2, 5], second: [1, 3, 4], height: [1, 2, 4] });
const options = {
  first: "first",
  second: "second",
  height: "height",
  leaves: ["a", "b", "c", "d"],
} as const;
function build(config: ChartConfig, width = 800, height = 600) {
  const model = new ChartModel({ locale: "en-US", ...config });
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}
const segments = (marks: readonly { kind: string }[]) =>
  marks.find((m) => m.kind === "segments") as SegmentGeometry;
const coords = (mark: SegmentGeometry) => Array.from(mark.coords.subarray(0, mark.count * 4));

describe("dendrogram", () => {
  it("traverses a deep linkage without recursion", () => {
    const n = 10_000;
    const data = table({
      first: Array.from({ length: n - 1 }, (_, row) => (row === 0 ? 0 : n + row - 1)),
      second: Array.from({ length: n - 1 }, (_, row) => row + 1),
      height: Array.from({ length: n - 1 }, (_, row) => row + 1),
    });
    const leaves = Array.from({ length: n }, (_, i) => String(i));
    const { model, scene } = build({ marks: [dendrogram(data, { ...options, leaves })] });
    expect(model.xScale()!.categories).toEqual(leaves);
    expect(segments(scene.panels[0]!.marks).count).toBe(3 * (n - 1));
  });

  it.each(["bottom", "top", "left", "right"] as const)(
    "matches SciPy icoord/dcoord on side %s",
    (side) => {
      const { scene, model } = build({
        marks: [dendrogram(linkage(), { ...options, side })],
        x: { show: false },
        y: { show: false },
      });
      const { plot } = scene.panels[0]!;
      const scale = side === "bottom" || side === "top" ? model.xScale()! : model.yScale()!;
      expect(scale.categories).toEqual(["c", "d", "a", "b"]);
      // scipy.cluster.hierarchy.dendrogram(Z, no_plot=True), reordered here
      // into linkage row order: the first merge is the right-hand pair.
      const icoord = [
        [25, 25, 35, 35],
        [5, 5, 15, 15],
        [10, 10, 30, 30],
      ];
      const dcoord = [
        [0, 1, 1, 0],
        [0, 2, 2, 0],
        [2, 4, 4, 1],
      ];
      const expected: number[] = [];
      for (let row = 0; row < 3; row++) {
        const points = icoord[row]!.map((v, i) => {
          const center = scale.map((v - 5) / 10);
          const h = dcoord[row]![i]! / 4;
          const depth =
            side === "bottom"
              ? plot.y + plot.height * (1 - h)
              : side === "top"
                ? plot.y + plot.height * h
                : side === "left"
                  ? plot.x + plot.width * h
                  : plot.x + plot.width * (1 - h);
          return side === "bottom" || side === "top" ? [center, depth] : [depth, center];
        });
        for (let i = 0; i < 3; i++) expected.push(...points[i]!, ...points[i + 1]!);
      }
      const geometry = segments(scene.panels[0]!.marks);
      expect(scene.panels[0]!.marks).toHaveLength(1);
      expect(geometry.count).toBe(9);
      expect(geometry.stroke).toBe(LIGHT.muted);
      expect(geometry.strokeWidth).toBe(1);
      coords(geometry).forEach((value, i) => {
        expect(value).toBeCloseTo(expected[i]!, 3);
      });
    },
  );

  it("handles a single merge, tied and zero heights, and height inversions", () => {
    for (const height of [[0], [2]]) {
      const { scene } = build({
        marks: [
          dendrogram(table({ first: [1], second: [0], height }), {
            ...options,
            leaves: ["a", "b"],
            stroke: "red",
            strokeWidth: 2,
          }),
        ],
      });
      const g = segments(scene.panels[0]!.marks);
      expect(g.count).toBe(3);
      expect(g).toMatchObject({ stroke: "red", strokeWidth: 2 });
      expect(coords(g)[1]).toBeCloseTo(scene.panels[0]!.plot.y + scene.panels[0]!.plot.height, 3);
      if (height[0] !== 0) expect(coords(g)[3]).toBeCloseTo(scene.panels[0]!.plot.y, 3);
      if (height[0] === 0)
        expect(
          coords(g)
            .filter((_, i) => i % 2 === 1)
            .every(
              (v) => Math.abs(v - (scene.panels[0]!.plot.y + scene.panels[0]!.plot.height)) < 1e-4,
            ),
        ).toBe(true);
    }
    for (const height of [
      [2, 2, 2],
      [4, 2, 1],
    ]) {
      const { scene } = build({
        marks: [dendrogram(table({ first: [0, 2, 5], second: [1, 3, 4], height }), options)],
      });
      expect(segments(scene.panels[0]!.marks).count).toBe(9);
      const values = coords(segments(scene.panels[0]!.marks));
      expect(values.every(Number.isFinite)).toBe(true);
      const { plot } = scene.panels[0]!;
      const maximum = Math.max(...height);
      expect(values[3]).toBeCloseTo(plot.y + plot.height * (1 - height[0]! / maximum), 3);
      expect(values[27]).toBeCloseTo(plot.y + plot.height * (1 - height[2]! / maximum), 3);
    }
  });

  it.each([true, false])(
    "uses category keys when numeric labels coincide (tree first: %s)",
    (treeFirst) => {
      for (const panel of [undefined, "combined"]) {
        const tree = dendrogram(table({ first: [0], second: [1], height: [1] }), {
          ...options,
          leaves: ["1", "2"],
          ...(panel && { panel }),
        });
        // Numbers banded: a band per value, keyed apart from the tree's labels.
        const cells = heatmap(table({ x: [1, 2], y: [1, 1], value: [1, 2] }), {
          x: "x",
          y: "y",
          color: "value",
          xBanded: true,
          yBanded: true,
          ...(panel && { panel }),
        });
        const { model, scene } = build({
          marks: treeFirst ? [tree, cells] : [cells, tree],
          ...(panel && {
            panels: panels([{ id: panel }]),
            y: { scope: "panel" },
            x: { scope: "panel" },
          }),
        });
        const scale = model.panels()[0]!.x;
        expect(scale.categories).toEqual(["1", "2", "1", "2"]);
        const values = coords(segments(scene.panels[0]!.marks));
        const start = treeFirst ? 0 : 2;
        expect(values[0]).toBeCloseTo(scale.map(start), 3);
        expect(values[10]).toBeCloseTo(scale.map(start + 1), 3);
      }
    },
  );

  it("keeps a fully filtered grouped point view's panel categories empty", () => {
    const source = table({ x: ["a", "b"], y: [1, 2], group: ["one", "two"] });
    const view = rowView(source);
    const { model } = build({
      marks: [point(view, { x: "x", y: "y", series: "group", panel: "points" })],
      panels: panels([{ id: "points" }]),
      x: { scope: "panel" },
    });
    expect(model.panels()[0]!.x.categories).toEqual(["a", "b"]);
    view.setQuery({ filter: col("y").gt(10) });
    const empty = model.scene(estimateText);
    expect(empty.panels[0]!.marks).toEqual([]);
    expect(model.panels()[0]!.x.categories).toEqual([]);
  });

  it("keeps bands and the summary but emits no geometry at zero stroke width", () => {
    const { scene, model } = build({
      marks: [dendrogram(linkage(), { ...options, strokeWidth: 0 })],
    });
    expect(scene.panels[0]!.marks).toEqual([]);
    expect(model.xScale()!.categories).toEqual(["c", "d", "a", "b"]);
    expect(describeChart(model)).toContain("4 leaves, 3 merges");
  });

  it("keeps one leaf's category and draws nothing for an empty linkage", () => {
    const { model, scene } = build({
      marks: [
        dendrogram(table({ first: [], second: [], height: [] }), { ...options, leaves: ["only"] }),
      ],
    });
    expect(model.xScale()!.categories).toEqual(["only"]);
    expect(scene.panels[0]!.marks).toEqual([]);
    expect(describeChart(model)).toContain("Dendrogram: 1 leaf, 0 merges.");
  });

  it("suppresses ancestors of a leaf missing from the current band axis", () => {
    const mark = new DendrogramMark(
      { type: "dendrogram", ...options },
      linkage() as unknown as Table,
    );
    const frame = {
      x: new BandScale(["c", "d", "b"], [0, 300], 0),
      y: new LinearScale([0, 4], [100, 0]),
      pixelRatio: 1,
      rasterRatio: 1,
      locale: "en-US",
      hidden: new Set(),
      owner: {},
      scene: 1,
      clouds: false,
      measure: estimateText,
      polyline: () => new Polyline(),
      bytes: (_key: string, _stage: string, count: number) => new Uint8ClampedArray(count),
      plot: { x: 0, y: 0, width: 300, height: 100 },
      theme: LIGHT,
      paint: (value: string) => value,
      read: (style) => style,
      doubles: (_key: string, _stage: string, count: number) => new Float64Array(count),
      floats: (_key: string, _stage: string, count: number) => new Float32Array(count),
    } satisfies Frame;
    const [g] = mark.geometry([], frame, "tree");
    expect(g!.count).toBe(3);
    expect(coords(g!)).toEqual([50, 100, 50, 50, 50, 50, 150, 50, 150, 50, 150, 100]);
    frame.x = new BandScale([], [0, 300]);
    expect(mark.geometry([], frame, "tree")[0]!.count).toBe(0);
  });

  it("revalidates table updates and recomputes leaf ordering and heights", () => {
    const data = linkage();
    const { model } = build({ marks: [dendrogram(data, options)] });
    data.setColumn("height", [2, 2, 2]);
    expect(describeChart(model)).toContain("Merge heights 2 to 2.");
    data.set("first", 2, 4);
    data.set("second", 2, 5);
    model.scene(estimateText);
    expect(model.xScale()!.categories).toEqual(["a", "b", "c", "d"]);
    data.set("height", 1, -1);
    expect(() => model.scene(estimateText)).toThrow(/row 1, field "height"/);
  });

  it("has an accessible summary and no legend, tooltip, or keyboard stops", () => {
    const { model, scene } = build({
      marks: [dendrogram(linkage(), { ...options, label: "Columns" })],
      legend: true,
    });
    expect(describeChart(model)).toContain("Columns: 4 leaves, 3 merges. Merge heights 1 to 4.");
    expect(legendOf(scene)).toEqual([]);
    expect(stopsOf(model, "")).toEqual([]);
    expect(
      model.inspect(scene.panels[0]!.plot.x + 20, scene.panels[0]!.plot.y + 20),
    ).toBeUndefined();
  });

  it("draws heights on the axis across its leaves, which views and resizing move", () => {
    const { model, scene } = build({
      marks: [dendrogram(linkage(), options)],
      interaction: { zoom: "xy" },
    });
    // The axis runs from zero to the largest height; the root's link is on it.
    expect(model.panels()[0]!.y.domain).toEqual([0, 4]);
    const before = coords(segments(scene.panels[0]!.marks));
    expect(before[27]).toBeCloseTo(model.panels()[0]!.y.map(4), 3);
    // Its leaves are categories, which do not zoom.
    expect(() => setViewport(model, [100, 200])).toThrow("shows categories");
    setViewport(model, { y: [0, 2] });
    const after = model.scene(estimateText);
    const y = model.panels()[0]!.y;
    expect(y.domain).toEqual([0, 2]);
    // The second merge (row 1, height 2) is at the top of the view, the root above it.
    const merged = coords(segments(after.panels[0]!.marks));
    expect(merged[15]).toBeCloseTo(y.map(2), 3);
    expect(merged[15]).toBeCloseTo(after.panels[0]!.plot.y, 3);
    expect(merged[27]).toBeLessThan(after.panels[0]!.plot.y);
    model.setSize(1000, 800, 2);
    const larger = model.scene(estimateText);
    expect(coords(segments(larger.panels[0]!.marks))[15]).toBeCloseTo(
      model.panels()[0]!.y.map(2),
      3,
    );
  });

  it.each(["bottom", "top", "left", "right"] as const)(
    "reads merge heights on side %s from the axis' ticks",
    (side) => {
      const across = side === "bottom" || side === "top";
      const axis = across ? "y" : "x";
      const { model, scene } = build({ marks: [dendrogram(linkage(), { ...options, side })] });
      const { plot, axes } = scene.panels[0]!;
      // Heights grow away from the leaves: the automatic domain descends
      // with leaves at the top or right.
      const domain = model.panels()[0]![axis].domain;
      expect(domain).toEqual(side === "top" || side === "right" ? [4, 0] : [0, 4]);
      const ticks = axes.find((a): a is AxisGuide => a.kind === "axis" && a.scale === axis)!;
      const tick = (value: number) => ticks.ticks.find((t) => Number(t.label) === value)!.position;
      const leaves = {
        bottom: plot.y + plot.height,
        top: plot.y,
        left: plot.x,
        right: plot.x + plot.width,
      };
      expect(tick(0)).toBeCloseTo(leaves[side], 3);
      // Each merge's link across its children, at heights 1, 2, and 4.
      const links = coords(segments(scene.panels[0]!.marks));
      for (const [row, height] of [1, 2, 4].entries())
        expect(links[(row * 3 + 1) * 4 + (across ? 1 : 0)]).toBeCloseTo(tick(height), 3);
    },
  );

  it("places heights on an axis' domain as given, and keeps a descending one under views", () => {
    const at = (config: Omit<ChartConfig, "marks">) => {
      const { model, scene } = build({
        marks: [dendrogram(linkage(), { ...options, side: "top" })],
        ...config,
      });
      const links = coords(segments(scene.panels[0]!.marks));
      return { model, y: model.panels()[0]!.y, links };
    };
    // An ascending domain runs as given: heights grow toward the leaves, on its ticks.
    const given = at({ y: { domain: [0, 4] } });
    expect(given.y.domain).toEqual([0, 4]);
    expect(given.links[5]).toBeCloseTo(given.y.map(1), 3);
    expect(given.links[5]).toBeGreaterThan(given.y.map(4));
    // A view of the automatic, descending axis runs the same way.
    const viewed = at({ interaction: { zoom: "xy" } });
    setViewport(viewed.model, { y: [0, 2] });
    const after = viewed.model.scene(estimateText);
    const y = viewed.model.panels()[0]!.y;
    expect(y.domain).toEqual([2, 0]);
    const { plot } = after.panels[0]!;
    const links = coords(segments(after.panels[0]!.marks));
    // The second merge (height 2) is at the bottom of the view, the root below it.
    expect(links[17]).toBeCloseTo(y.map(2), 3);
    expect(links[17]).toBeCloseTo(plot.y + plot.height, 3);
    expect(links[29]).toBeGreaterThan(plot.y + plot.height);
  });

  it.each(["top", "right"] as const)(
    "descends only the axis of the panel whose tree on side %s asks for it",
    (side) => {
      const axis = side === "top" ? "y" : "x";
      const { model } = build({
        marks: [
          dendrogram(linkage(), { ...options, side, panel: "tree" }),
          point(table({ x: [0, 10], y: [0, 10] }), { x: "x", y: "y", panel: "points" }),
        ],
        panels: panels([{ id: "tree" }, { id: "points" }]),
        x: { scope: "panel" },
        y: { scope: "panel" },
      });
      const [tree, points] = model.panels();
      expect(tree![axis].domain).toEqual([4, 0]);
      expect(points![axis].domain[0]).toBeLessThan(points![axis].domain[1]);
    },
  );

  it("aligns clustermap leaves with matrix band centers and permits empty axes", () => {
    const { model, scene } = build(clustermap());
    const [corner, top, left, matrix] = model.panels();
    expect(corner!.x.categories).toEqual([]);
    expect(corner!.y.categories).toEqual([]);
    expect(top!.y.categories).toEqual([]);
    expect(left!.x.categories).toEqual([]);
    expect(scene.panels[0]!.marks).toEqual([]);
    expect(scene.panels[0]!.axes).toEqual([]);
    expect(scene.panels[1]!.axes.some((a) => a.side === "left")).toBe(false);
    expect(scene.panels[2]!.axes.map((a) => a.side)).toEqual(["left"]);
    expect(top!.x.categories).toEqual(matrix!.x.categories);
    expect(left!.y.categories).toEqual(matrix!.y.categories);
    const topCoords = coords(segments(scene.panels[1]!.marks));
    const leftCoords = coords(segments(scene.panels[2]!.marks));
    for (const index of [0, 1, 2, 3])
      expect(top!.x.map(index)).toBeCloseTo(matrix!.x.map(index), 10);
    for (const index of [0, 1, 2]) expect(left!.y.map(index)).toBeCloseTo(matrix!.y.map(index), 10);
    // Linkage ids a,b,c,d are at category indices 2,3,0,1.
    expect(topCoords[0]).toBeCloseTo(matrix!.x.map(2), 3);
    expect(topCoords[10]).toBeCloseTo(matrix!.x.map(3), 3);
    expect(topCoords[12]).toBeCloseTo(matrix!.x.map(0), 3);
    expect(topCoords[22]).toBeCloseTo(matrix!.x.map(1), 3);
    expect(leftCoords[1]).toBeCloseTo(matrix!.y.map(1), 3);
    expect(leftCoords[11]).toBeCloseTo(matrix!.y.map(2), 3);
    expect(leftCoords[13]).toBeCloseTo(matrix!.y.map(0), 3);
  });

  it("bands dendrogram-only panels and excludes categories from other panels", () => {
    const { model } = build({
      marks: [
        dendrogram(linkage(), { ...options, panel: "tree" }),
        heatmap(table({ x: ["other"], y: ["row"], v: [1] }), {
          x: "x",
          y: "y",
          color: "v",
          panel: "heatmap",
        }),
      ],
      panels: panels([{ id: "tree" }, { id: "heatmap" }]),
      y: { scope: "panel" },
      x: { scope: "panel" },
    });
    expect(model.panels().map((p) => p.x.categories)).toEqual([["c", "d", "a", "b"], ["other"]]);
  });

  it("requires explicit repetition with facets, even without facet fields on the linkage", () => {
    const source = table({ x: ["a", "b"], y: ["a", "b"], value: [1, 2], group: ["N", "S"] });
    expect(() => build({ marks: [dendrogram(linkage(), options)], facet: facet("group") })).toThrow(
      /facet: "repeat"/,
    );
    const { scene } = build({
      marks: [
        heatmap(source, { x: "x", y: "y", color: "value" }),
        dendrogram(linkage(), { ...options, facet: "repeat" }),
      ],
      facet: facet("group"),
      y: { scope: "panel" },
      x: { scope: "panel" },
    });
    expect(scene.panels).toHaveLength(2);
    for (const p of scene.panels) expect(segments(p.marks).count).toBe(9);
  });
});

describe("dendrogram validation", () => {
  it.each([
    ["first", -1, /row 0, field "first".*whole number/],
    ["second", 0.5, /row 0, field "second".*whole number/],
    ["first", 4, /row 0, field "first".*earlier merge/],
    ["second", 0, /row 0, field "second".*merged more than once/],
    ["height", -1, /row 0, field "height".*nonnegative/],
    ["height", Infinity, /row 0, field "height".*finite/],
    ["height", NaN, /row 0, field "height".*finite/],
  ] as const)("rejects invalid %s = %s", (field, value, error) => {
    const data = linkage();
    data.set(field, 0, value);
    expect(() => dendrogram(data, options)).toThrow(error);
  });
  it("rejects reused clusters across rows and wrong labels or field kinds", () => {
    const data = linkage();
    data.set("first", 1, 0);
    expect(() => dendrogram(data, options)).toThrow(/row 1, field "first".*more than once/);
    for (const leaves of [["a"], ["a", "b", "a", "d"], ["a", "b", 3, "d"]])
      expect(() => dendrogram(linkage(), { ...options, leaves } as never)).toThrow(/leaves/);
    expect(() => dendrogram(linkage(), { ...options, first: "missing" } as never)).toThrow(
      /field "missing"/,
    );
    for (const first of [["a", "b", "c"], time([0, 2, 5])])
      expect(() =>
        dendrogram(table({ first, second: [1, 3, 4], height: [1, 2, 4] }), options as never),
      ).toThrow(/dendrogram first: field "first" holds (category|time) values; expected number/);
    expect(() => dendrogram(linkage(), { ...options, side: "diagonal" } as never)).toThrow(/side/);
    for (const strokeWidth of [-1, Infinity, NaN])
      expect(() => dendrogram(linkage(), { ...options, strokeWidth })).toThrow(/strokeWidth/);
  });
});
