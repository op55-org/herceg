// A legend entry of the chart's own that names a mark whole hides and shows
// it whatever the mark draws: series, a layout of items, or a whole-table
// drawing. Its button says so, and so do the visibility methods and events.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Chart } from "../../src/dom/chart.ts";
import { chartFromSpec } from "../../src/from-spec.ts";
import { estimateText } from "../../src/layout/text.ts";
import type { ChartSpec, MarkSpec } from "../../src/spec/spec.ts";
import { modelOf } from "./helpers.ts";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:640px;height:400px";
  document.body.append(host);
});
afterEach(() => host.remove());

const data = {
  samples: {
    columns: {
      x: [0, 1, 2, 3, 4, 5],
      y: [2, 4, 3, 20, 40, 30],
      category: ["a", "b", "c", "a", "b", "c"],
      kind: ["k", "m", "k", "m", "k", "m"],
    },
  },
  tree: { columns: { first: [0, 2], second: [1, 3], height: [1, 2] } },
  links: { columns: { source: ["a", "b", "a"], target: ["b", "c", "c"], value: [3, 2, 4] } },
  nodes: { columns: { node: ["a", "b", "c"], kind: ["k", "m", "m"] } },
  world: {
    columns: {
      shape: {
        type: "geometry",
        coordinates: [0, 0, 10, 0, 10, 10, 0, 10, 0, 0, 20, 0, 30, 0, 30, 10, 20, 10, 20, 0],
        ringOffsets: [0, 5, 10],
        polygonOffsets: [0, 1, 2],
        geometryOffsets: [0, 1, 2],
      },
      name: ["west", "east"],
      kind: ["k", "m"],
    },
  },
  spatial: {
    columns: { x: [0, 1, 2, 3], y: [1, 3, 2, 4], z: [2, 4, 1, 3], kind: ["k", "m", "k", "m"] },
  },
  grid: { columns: { x: [0, 1, 0, 1], y: [0, 0, 1, 1], z: [1, 2, 3, 4] } },
};

const marks: Record<string, object> = {
  line: { data: "samples", type: "line", x: "x", y: "y", series: "kind" },
  pie: { data: "samples", type: "pie", category: "category", value: "y", labels: false },
  treemap: { data: "samples", type: "treemap", path: ["kind", "category"], value: "y" },
  sunburst: { data: "samples", type: "sunburst", path: ["kind", "category"], value: "y" },
  graph: {
    data: "links",
    type: "graph",
    source: "source",
    target: "target",
    nodes: "nodes",
    node: "node",
    color: "kind",
  },
  dendrogram: {
    data: "tree",
    type: "dendrogram",
    first: "first",
    second: "second",
    height: "height",
    leaves: ["a", "b", "c"],
  },
  geopoint: { data: "samples", type: "geopoint", longitude: "x", latitude: "y", series: "kind" },
  point3d: { data: "spatial", type: "point3d", x: "x", y: "y", z: "z", series: "kind" },
  line3d: { data: "spatial", type: "line3d", x: "x", y: "y", z: "z", series: "kind" },
  surface: { data: "grid", type: "surface", x: "x", y: "y", z: "z" },
  gauge: { data: "samples", type: "gauge", value: "y" },
  funnel: { data: "samples", type: "funnel", category: "category", value: "y" },
  radar: { data: "samples", type: "radar", category: "category", value: "y", series: "kind" },
  sankey: { data: "links", type: "sankey", source: "source", target: "target", value: "value" },
  geoshape: { data: "world", type: "geoshape", color: "kind" },
};

/** How much each panel draws: its geometries' points, items, and labels. */
function drawn(chart: Chart): Record<string, number> {
  const scene = modelOf(chart).scene(estimateText);
  return Object.fromEntries(
    scene.panels.map((panel) => [
      panel.key,
      panel.marks.reduce((n, g) => n + g.draw.size(g) + ((g as { count?: number }).count ?? 0), 0),
    ]),
  );
}

const button = (chart: Chart, label: string) =>
  [...chart.root.querySelectorAll("button")].find((b) => b.textContent === label)!;

describe("an entry of the chart's own naming a mark in a panel", () => {
  it.each(Object.keys(marks))("hides and shows a %s", async (row) => {
    const spec = {
      version: 1,
      data,
      panels: [{ id: "a" }, { id: "b" }],
      marks: [
        { data: "samples", type: "line", x: "x", y: "y", panel: "a" },
        { ...marks[row], id: "m", panel: "b" } as MarkSpec,
      ],
      legend: { entries: [{ key: "mine", label: "Mine", targets: [{ mark: "m" }] }] },
    } as unknown as ChartSpec;
    const chart = chartFromSpec(host, spec);
    const events: unknown[] = [];
    chart.on("visibility", (e) => events.push(e.hiddenKeys));
    await chart.loading;
    chart.render();
    const before = drawn(chart);
    expect(before.b).toBeGreaterThan(0);
    // The line's entry in panel a, the mark's own entries, and the chart's.
    const pressed = () =>
      Object.fromEntries(
        [...chart.root.querySelectorAll("button[aria-pressed]")].map((b) => [
          b.textContent,
          b.getAttribute("aria-pressed"),
        ]),
      );
    const shown = pressed();
    expect(Object.values(shown).every((state) => state === "true")).toBe(true);
    const mine = button(chart, "Mine");
    mine.click();
    chart.render();
    expect(chart.getHiddenKeys()).toEqual(['{"mark":"m"}']);
    expect(drawn(chart)).toEqual({ ...before, b: 0 });
    // Every entry of the mark is hidden with it, as a line's series are.
    const hidden = Object.fromEntries(Object.keys(shown).map((label) => [label, "false"]));
    expect(pressed()).toEqual({ ...hidden, y: "true" });
    mine.click();
    chart.render();
    expect(chart.getHiddenKeys()).toEqual([]);
    expect(drawn(chart)).toEqual(before);
    expect(pressed()).toEqual(shown);
    expect(events).toEqual([['{"mark":"m"}'], []]);
    chart.destroy();
  });
});

describe("an entry naming one layer of a map or a 3D box", () => {
  it.each([
    ["geoshape", "geopoint"],
    ["surface", "point3d"],
  ])("hides that layer's %s and keeps its %s", async (layer, other) => {
    const of = (row: string) => (marks[row] as { data: string }).data;
    const spec = {
      version: 1,
      data,
      marks: [
        { ...marks[layer], id: "m" },
        // Points of the layer's own table, where it has x and y.
        { ...marks[other], ...(of(other) === "samples" && { data: "samples" }) },
      ],
      legend: { entries: [{ key: "mine", label: "Mine", targets: [{ mark: "m" }] }] },
    } as unknown as ChartSpec;
    const chart = chartFromSpec(host, spec);
    await chart.loading;
    chart.render();
    const geometry = () => modelOf(chart).scene(estimateText).panels[0]!.marks;
    const before = geometry().map((g) => g.draw.size(g) + ((g as { count?: number }).count ?? 0));
    const mine = button(chart, "Mine");
    mine.click();
    chart.render();
    expect(mine.getAttribute("aria-pressed")).toBe("false");
    const after = geometry().map((g) => g.draw.size(g) + ((g as { count?: number }).count ?? 0));
    // Less is drawn, and something still is: the other layer, in the same frame.
    const sum = (counts: number[]) => counts.reduce((a, b) => a + b, 0);
    expect(sum(after)).toBeLessThan(sum(before));
    expect(sum(after)).toBeGreaterThan(0);
    expect(modelOf(chart).items!.summary()).not.toBe("Hidden.");
    mine.click();
    chart.render();
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    expect(geometry().map((g) => g.draw.size(g) + ((g as { count?: number }).count ?? 0))).toEqual(
      before,
    );
    chart.destroy();
  });
});

describe("an entry naming a mark whose items are hidden one by one", () => {
  it.each([
    "pie",
    "treemap",
    "sunburst",
    "graph",
    "radar",
    "geoshape",
    "geopoint",
    "point3d",
    "line3d",
  ])("is hidden with a %s's items, and showing it shows them", async (row) => {
    const spec = {
      version: 1,
      data,
      marks: [{ ...marks[row], id: "m" }],
      legend: { entries: [{ key: "mine", label: "Mine", targets: [{ mark: "m" }] }] },
    } as unknown as ChartSpec;
    const chart = chartFromSpec(host, spec);
    await chart.loading;
    chart.render();
    const before = drawn(chart);
    const mine = button(chart, "Mine");
    const own = () =>
      [...chart.root.querySelectorAll("button[aria-pressed]")].filter((b) => b !== mine);
    expect(own().length).toBeGreaterThan(0);
    for (const entry of own()) {
      (entry as HTMLButtonElement).click();
      chart.render();
    }
    expect(own().every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
    expect(mine.getAttribute("aria-pressed")).toBe("false");
    mine.click();
    chart.render();
    expect(chart.getHiddenKeys()).toEqual([]);
    expect(mine.getAttribute("aria-pressed")).toBe("true");
    expect(own().every((b) => b.getAttribute("aria-pressed") === "true")).toBe(true);
    expect(drawn(chart)).toEqual(before);
    chart.destroy();
  });
});
