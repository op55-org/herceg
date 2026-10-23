// A scale's padding as views move: pans and zooms ask for the view whose
// padding shows what they reach, so padding never piles up and what is
// dragged stays under the pointer, in plots of any width sharing it.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, createChart } from "../../src/dom/chart.ts";
import { grid } from "../../src/layout.ts";
import { line } from "../../src/marks/line.ts";
import { panels } from "../../src/model/panels.ts";
import { contractTest } from "../helpers/contracts.ts";
import { MOUSE } from "./helpers.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

const data = table({
  t: Float64Array.from({ length: 101 }, (_, i) => i),
  v: Float64Array.from({ length: 101 }, (_, i) => Math.sin(i / 10)),
});

function pointer(chart: Chart, type: string, x: number, y: number) {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerId: MOUSE,
      button: 0,
    }),
  );
}

describe("padding as views move", () => {
  contractTest("scale.padding.pan", async () => {
    const chart = createChart(host, {
      interaction: { pan: "x", zoom: "x" },
      x: { domain: [0, 100], padding: { px: 30 } },
      marks: [line(data, { x: "t", y: "v" })],
    });
    // Padding is the guide compiler's, which the chart loads first.
    await chart.loading;
    const { plot } = chart.getPanels()[0]!;
    // The domain set, 30 pixels in from the plot's edges.
    expect(chart.toPixel(0, { axis: "x" })).toBeCloseTo(plot.x + 30, 3);
    expect(chart.toPixel(100, { axis: "x" })).toBeCloseTo(plot.x + plot.width - 30, 3);
    // A drag moves what is under the pointer with it, and asks for a view as wide.
    const y = plot.y + plot.height / 2;
    const at = chart.toPixel(40, { axis: "x" })!;
    for (let k = 0; k < 3; k++) {
      pointer(chart, "pointerdown", at, y);
      pointer(chart, "pointermove", at + 50, y);
      pointer(chart, "pointerup", at + 50, y);
      chart.render();
    }
    const [lo, hi] = chart.getViewport().x!;
    expect(hi - lo).toBeCloseTo(100, 6);
    expect(chart.toPixel(40, { axis: "x" })).toBeCloseTo(at + 150, 3);
    // The view's ends stay 30 pixels in.
    expect(chart.toPixel(lo, { axis: "x" })).toBeCloseTo(plot.x + 30, 3);
    chart.destroy();
  });

  contractTest("scale.padding.edge", async () => {
    // Edges are measured from the view, not its padding, and report it.
    const chart = createChart(host, {
      interaction: {
        pan: "x",
        limits: { x: { extent: [0, null], edge: { threshold: 0.1, hysteresis: 0.05 } } },
      },
      x: { padding: 0.1 },
      marks: [line(data, { x: "t", y: "v" })],
    });
    await chart.loading;
    const edges: { domain: readonly [number, number] }[] = [];
    chart.on("edge", (event) => edges.push(event));
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    // 8 from the start, more than a tenth of the view's 50, though its
    // padding reaches 3 from it, less than a tenth of the 60 drawn.
    chart.setViewport([8, 58]);
    await frame();
    expect(edges).toEqual([]);
    chart.setViewport([3, 53]);
    await frame();
    expect(edges).toHaveLength(1);
    expect(edges[0]!.domain).toEqual([3, 53]);
    chart.destroy();
  });

  contractTest("scale.padding.pan.panels", async () => {
    // Plots of other widths sharing x show one domain, padded over the
    // narrowest: pans in either keep the view as wide.
    const chart = createChart(host, {
      interaction: { pan: "x", zoom: "x" },
      panels: panels([{ id: "a" }, { id: "b" }], grid({ columns: [2, 1] })),
      x: { domain: [0, 100], padding: { px: 30 }, scope: "chart" },
      marks: [
        line(data, { x: "t", y: "v", panel: "a" }),
        line(data, { x: "t", y: "v", panel: "b" }),
      ],
    });
    await chart.loading;
    const plots = chart.getPanels().map((panel) => panel.plot);
    expect(plots[0]!.width).toBeGreaterThan(plots[1]!.width * 1.5);
    for (const plot of plots)
      for (let k = 0; k < 3; k++) {
        const [at, y] = [plot.x + plot.width * 0.4, plot.y + plot.height / 2];
        pointer(chart, "pointerdown", at, y);
        pointer(chart, "pointermove", at + 40, y);
        pointer(chart, "pointerup", at + 40, y);
        chart.render();
        const [lo, hi] = chart.getViewport().x!;
        expect(hi - lo).toBeCloseTo(100, 6);
      }
    chart.destroy();
  });
});
