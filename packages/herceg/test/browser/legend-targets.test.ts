// Legend entries of a chart's own that target marks whole: marks of
// series, marks drawing their own layout, and marks of no series (a
// dendrogram), and the swatches annotations' entries draw.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { legend } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { dendrogram } from "../../src/marks/dendrogram.ts";
import { graph } from "../../src/marks/graph.ts";
import { line } from "../../src/marks/line.ts";
import type { Mark } from "../../src/marks/mark.ts";
import { pie } from "../../src/marks/pie.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { text } from "../../src/marks/text.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { guidesOf } from "../../src/scene/scene.ts";
import { modelOf } from "./helpers.ts";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:640px;height:400px";
  document.body.append(host);
});
afterEach(() => host.remove());

const shares = table({ k: category(["a", "b"]), v: [1, 2] });
const links = table({ from: ["a", "b"], to: ["b", "c"] });
const cloud = table({ x: [0, 1], y: [1, 0], z: [0, 1] });
const merges = table({ first: [0, 2, 4], second: [1, 3, 5], height: [1, 2, 3] });

const mine = { entries: [{ key: "mine", label: "Mine", targets: [{ mark: "m" }] }] };

/**
 * How many items the chart's panels draw, by geometry: its count, or one
 * for a geometry without one. A 3D chart's box is not the mark's.
 */
function drawn(chart: Chart): number {
  const scene = modelOf(chart).scene(estimateText);
  return scene.panels
    .flatMap((panel) => panel.marks)
    .filter(({ key }) => !String(key).startsWith("box-"))
    .reduce((n, geometry) => n + ((geometry as { count?: number }).count ?? 1), 0);
}

async function mount(options: ChartOptions): Promise<Chart> {
  const chart = createChart(host, { locale: "en-US", renderer: "svg", ...options });
  await chart.loading;
  chart.render();
  return chart;
}

const press = (chart: Chart, label: string) => {
  [...chart.root.querySelectorAll("button")].find((b) => b.textContent === label)!.click();
  chart.render();
};

describe("an entry of the chart's own targeting a mark", () => {
  it.each<[string, () => Mark]>([
    ["pie", () => pie(shares, { category: "k", value: "v", id: "m" }) as never],
    ["treemap", () => treemap(shares, { path: ["k"], value: "v", id: "m" }) as never],
    ["graph", () => graph(links, { source: "from", target: "to", id: "m" }) as never],
    ["point3d", () => point3d(cloud, { x: "x", y: "y", z: "z", id: "m" }) as never],
  ])("hide a %s, which draws its own layout, whole", async (_, make) => {
    const chart = await mount({ marks: [make()], legend: mine });
    expect(drawn(chart)).toBeGreaterThan(0);
    press(chart, "Mine");
    expect(chart.getHiddenKeys()).toEqual(['{"mark":"m"}']);
    expect(drawn(chart)).toBe(0);
    chart.destroy();
  });

  it("hide a dendrogram, which has no series, whole", async () => {
    const leaves = table({ leaf: category(["a", "b", "c", "d"]), v: [1, 2, 3, 4] });
    const chart = await mount({
      marks: [
        bar(leaves, { x: "leaf", y: "v" }),
        dendrogram(merges, {
          first: "first",
          second: "second",
          height: "height",
          leaves: ["a", "b", "c", "d"],
          id: "m",
        }),
      ],
      guides: [legend({ include: [], ...mine })],
    });
    expect(drawn(chart)).toBeGreaterThan(4);
    press(chart, "Mine");
    // The four bars alone.
    expect(drawn(chart)).toBe(4);
    chart.destroy();
  });

  it("settle loading with the refusal of a target no mark is, found once a layout's code loads", async () => {
    const chart = createChart(host, {
      locale: "en-US",
      marks: [graph(links, { source: "from", target: "to" })],
      legend: { entries: [{ key: "x", label: "X", targets: [{ mark: "zz" }] }] },
    });
    const settled = await Promise.race([
      (chart.loading ?? Promise.resolve()).then(
        () => "resolved",
        () => "rejected",
      ),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 3000)),
    ]);
    expect(settled).not.toBe("pending");
    chart.destroy();
  });
});

describe("an annotation's entry", () => {
  it("show text in the color its label draws in", async () => {
    const chart = await mount({
      marks: [
        line(cloud, { x: "x", y: "y" }),
        text({
          x: 0.5,
          y: 0.5,
          label: { text: "Note", style: { color: "#9467bd" } },
          legend: true,
        }),
      ],
    });
    const [legendGuide] = guidesOf(modelOf(chart).scene(estimateText), "legend");
    expect(legendGuide!.entries.find(({ label }) => label === "Note")?.color).toBe("#9467bd");
    chart.destroy();
  });
});
