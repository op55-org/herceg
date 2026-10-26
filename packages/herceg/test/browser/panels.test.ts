// Scenes with several panels, drawn by the live SVG layer and the canvas painter.
import { afterEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { SvgLayer } from "../../src/dom/svg-layer.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { rule } from "../../src/marks/rule.ts";
import { ChartModel } from "../../src/model/model.ts";
import { paintCanvas } from "../../src/render/canvas.ts";
import type { Scene } from "../../src/scene/scene.ts";

const model = new ChartModel({
  marks: [
    line(table({ x: [0, 10], y: [5, 5] }), { x: "x", y: "y" }),
    // Drawn whole, so apart from the line, which panels cut.
    rule({ y: 8, label: "eight" }),
  ],
  y: { domain: [0, 10] },
});
model.setSize(400, 200, 1);
const base = model.scene(estimateText);
const [only] = base.panels;

/**
 * The chart's one panel repeated under `keys`, side by side: each panel's
 * plot is a slice of the original, with a 20px gutter between slices.
 */
function sceneOf(keys: readonly string[]): Scene {
  const { plot } = only!;
  const width = (plot.width - 20 * (keys.length - 1)) / Math.max(1, keys.length);
  return {
    ...base,
    panels: keys.map((key, i) => ({
      ...only!,
      key,
      plot: { ...plot, x: plot.x + i * (width + 20), width },
    })),
  };
}

let host: HTMLDivElement | undefined;
afterEach(() => host?.remove());

function mount(): SvgLayer {
  const layer = new SvgLayer(document, "panels");
  host = document.createElement("div");
  host.append(layer.svg);
  document.body.append(host);
  return layer;
}

/**
 * The layer's groups of what each panel paints, in document order (after
 * the backgrounds, before the guides and the overlay), its clips, and the
 * left edge of the plot each group's data is cut to.
 */
function groups(layer: SvgLayer) {
  const painted = [...layer.svg.children].filter((node) => node.tagName === "g").slice(1, -2);
  const clips = [...layer.svg.querySelectorAll("clipPath")];
  const rects = painted.map((group) => {
    const cut = group.querySelector("[clip-path]")?.getAttribute("clip-path") ?? "";
    // A plot of one rectangle is cut by a shape in the view box, others through a clip path.
    const shape = /^path\("M([\d.]+) /.exec(cut);
    if (shape) return Number(shape[1]);
    const id = /url\(#(.+)\)/.exec(cut)?.[1];
    const clip = clips.find((node) => node.id === id);
    return clip ? Number(clip.querySelector("rect")!.getAttribute("x")) : undefined;
  });
  return { painted, clips, rects };
}

describe("panels", () => {
  it("keep each panel's nodes through reorders, removal, and return", () => {
    const layer = mount();
    const steps: string[][] = [["a", "b"], ["b", "a"], ["b", "c"], [], ["a", "b"]];
    let previous: Element[] = [];
    for (const keys of steps) {
      const scene = sceneOf(keys);
      layer.render(scene, { marks: true });
      const { painted, clips, rects } = groups(layer);
      // One clip per panel, each panel's data cut to its own plot.
      expect(clips).toHaveLength(keys.length);
      expect(new Set(clips.map((clip) => clip.id)).size).toBe(keys.length);
      expect(rects).toEqual(scene.panels.map((panel) => panel.plot.x));
      // Each panel's group in panel order: its grid lines, then its line and rule, as declared.
      for (const group of painted)
        expect([...group.children].map((node) => node.getAttribute("data-kind"))).toEqual([
          "grid",
          "line",
          "rule",
        ]);
      if (keys.join() === "b,a") {
        // Panel b keeps its nodes when it moves first.
        expect(painted[0]).toBe(previous[1]);
        expect(painted[1]).toBe(previous[0]);
        expect(painted[0]!.firstElementChild).toBe(previous[1]!.firstElementChild);
      }
      previous = painted;
    }
  });

  it("fill their groups when the SVG takes over drawing from a canvas", () => {
    const layer = mount();
    const scene = sceneOf(["a", "b"]);
    layer.render(scene, { marks: false });
    expect(groups(layer).painted.map((group) => group.childElementCount)).toEqual([0, 0]);
    layer.render(scene, { marks: true });
    expect(groups(layer).painted.map((group) => group.childElementCount)).toEqual([3, 3]);
  });

  it("clip canvas drawing to each panel, leaving gutters empty", () => {
    const scene = sceneOf(["a", "b"]);
    const canvas = document.createElement("canvas");
    paintCanvas(canvas, { ...scene, theme: { ...scene.theme, background: "transparent" } });
    const context = canvas.getContext("2d")!;
    const [a, b] = scene.panels;
    // The line runs across the whole chart at y = 5, the middle of the plot.
    const y = Math.round(a!.plot.y + a!.plot.height / 2);
    const alpha = (x: number) => context.getImageData(Math.round(x), y, 1, 1).data[3]!;
    expect(alpha(a!.plot.x + a!.plot.width / 2)).toBeGreaterThan(0);
    expect(alpha(b!.plot.x + b!.plot.width / 2)).toBeGreaterThan(0);
    expect(alpha(a!.plot.x + a!.plot.width + 10)).toBe(0);
  });
});
