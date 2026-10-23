// Colors given as CSS variables, read from the page a live chart is in:
// every renderer draws the page's color, and tooltips and hover dots match.
import { afterEach, beforeEach, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, createChart } from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { rangeNavigator } from "../../src/model/navigator.ts";
import { modelOf } from "./helpers.ts";

let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px;--brand:#ff0000;--accent:rgb(0, 0, 255)";
  document.body.append(host);
});
afterEach(() => host.remove());

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

/** The swatch of the tooltip's one point and its hover dot, at the chart's first row. */
function hovered(chart: Chart): { swatch: string | undefined; dot: string | null | undefined } {
  const model = modelOf(chart);
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + model.xScale()!.map(0),
      clientY: rect.top + model.yScale()!.map(1),
    }),
  );
  chart.render();
  const box = [...chart.root.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')].find(
    (div) => div.style.display === "block",
  );
  const row = box?.children[1]?.firstElementChild as HTMLElement | null | undefined;
  return {
    swatch: row?.style.background,
    dot: chart.root.querySelector("circle")?.getAttribute("fill"),
  };
}

it.each(["svg", "canvas"] as const)(
  "draws the page's colors of variables in %s, in its tooltips, and in its exports",
  async (renderer) => {
    const data = table({ x: [0, 1, 2], y: [1, 2, 3], kind: ["a", "b", "a"] });
    const chart = createChart(host, {
      renderer,
      locale: "en-US",
      x: { show: false, domain: [0, 2], grid: false },
      y: { show: false, domain: [0, 4], grid: false },
      theme: { tokens: { background: "transparent" } },
      scales: { color: { type: "ordinal", map: { a: "var(--accent, #00ff00)" } } },
      marks: [
        line(data, { x: "x", y: "y", stroke: "var(--brand, #00ff00)", strokeWidth: 8 }),
        point(data, { x: "x", y: "y", color: "kind" }),
      ],
    });
    try {
      await chart.loading;
      const model = modelOf(chart);
      const px = model.xScale()!.map(0.5);
      const py = model.yScale()!.map(1.5);
      if (renderer === "canvas") {
        const canvas = chart.root.querySelector("canvas")!;
        const ratio = canvas.width / 600;
        const pixel = [
          ...canvas
            .getContext("2d")!
            .getImageData(Math.floor(px * ratio), Math.floor(py * ratio), 1, 1).data,
        ];
        expect(pixel).toEqual([255, 0, 0, 255]);
      } else {
        expect(chart.root.querySelector('path[stroke="#ff0000"]')).not.toBeNull();
        expect(chart.root.innerHTML).not.toContain("var(");
      }
      // An export of a chart in a page reads the page, as the chart does.
      const svg = chart.toSVG();
      expect(svg).toContain('stroke="#ff0000"');
      expect(svg).toContain("#0000ff");
      expect(svg).not.toContain("var(");
      // The tooltip's swatch and the hover dot are the colors drawn: the
      // point's, then with the line alone, the line's.
      expect(hovered(chart)).toEqual({ swatch: "rgb(0, 0, 255)", dot: "#0000ff" });
      chart.update({ marks: [line(data, { x: "x", y: "y", stroke: "var(--brand, #00ff00)" })] });
      chart.render();
      expect(hovered(chart)).toEqual({ swatch: "rgb(255, 0, 0)", dot: "#ff0000" });
    } finally {
      chart.destroy();
    }
  },
);

it("draws the page's new color when the page switches themes", async () => {
  const style = document.createElement("style");
  style.textContent = ":root { --line-ink: #ff0000; } :root.night { --line-ink: #00aa00; }";
  document.head.append(style);
  const data = table({ x: [0, 1, 2], y: [1, 2, 3] });
  const chart = createChart(host, {
    renderer: "svg",
    marks: [line(data, { x: "x", y: "y", stroke: "var(--line-ink)" })],
  });
  try {
    expect(chart.root.querySelector('path[stroke="#ff0000"]')).not.toBeNull();
    document.documentElement.classList.add("night");
    // The chart reads the page again on its next frame.
    await frame();
    await frame();
    expect(chart.root.querySelector('path[stroke="#00aa00"]')).not.toBeNull();
    expect(chart.toSVG()).toContain('stroke="#00aa00"');
  } finally {
    chart.destroy();
    document.documentElement.classList.remove("night");
    style.remove();
  }
});

it("reads the page again on an update, as after a change of its variables", () => {
  const data = table({ x: [0, 1, 2], y: [1, 2, 3] });
  const options = {
    renderer: "svg" as const,
    marks: [line(data, { x: "x", y: "y", stroke: "var(--brand)" })],
  };
  const chart = createChart(host, options);
  try {
    expect(chart.root.querySelector('path[stroke="#ff0000"]')).not.toBeNull();
    host.style.setProperty("--brand", "#00aa00");
    chart.update({});
    chart.render();
    expect(chart.root.querySelector('path[stroke="#00aa00"]')).not.toBeNull();
    expect(chart.toSVG()).toContain('stroke="#00aa00"');
  } finally {
    chart.destroy();
  }
});

it("draws a navigator's overview in the page's new colors", async () => {
  const style = document.createElement("style");
  style.textContent = ":root { --line-ink: #ff0000; } :root.night { --line-ink: #00aa00; }";
  document.head.append(style);
  const data = table({ x: [0, 1, 2], y: [1, 2, 3] });
  const chart = createChart(host, {
    renderer: "svg",
    navigator: rangeNavigator({ height: 48 }),
    marks: [line(data, { x: "x", y: "y", stroke: "var(--line-ink)" })],
  });
  const strokes = () => chart.root.querySelectorAll('path[stroke="#00aa00"]').length;
  try {
    document.documentElement.classList.add("night");
    await frame();
    await frame();
    // The plot's line and the overview's.
    expect(strokes()).toBe(2);
  } finally {
    chart.destroy();
    document.documentElement.classList.remove("night");
    style.remove();
  }
});
