// Ordered painting in a live chart: marks as declared, `zIndex` over that,
// on one canvas (text and rules painted there in their place) or in the SVG
// layer, whose nodes keep their identity as they move; and hydration.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { hydrateChart } from "../../src/dom/hydrate.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { renderToSnapshot } from "../../src/render/snapshot.ts";
import { contractTest } from "../helpers/contracts.ts";
import { modelOf, panelGroups } from "./helpers.ts";

let host: HTMLDivElement;

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:400px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  host.remove();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const across = table({ x: [0, 10], y: [5, 5] });
const spot = table({ x: [5], y: [5] });
/**
 * A thick red line across the plot, then a green box of text over it at
 * x = 4, then a translucent blue point over both at x = 5: line, then
 * multi-line text, then points, each above the one before unless `zIndex`
 * says otherwise.
 */
function layered(zIndex: { line?: number; text?: number; points?: number } = {}): ChartOptions {
  return {
    renderer: "canvas",
    theme: { tokens: { background: "transparent" } },
    legend: false,
    x: { domain: [0, 10], grid: false, nice: false },
    y: { domain: [0, 10], grid: false, nice: false },
    marks: [
      line(across, {
        x: "x",
        y: "y",
        stroke: "#ff0000",
        strokeWidth: 30,
        zIndex: zIndex.line ?? 0,
      }),
      text({
        x: 4,
        y: 5,
        zIndex: zIndex.text ?? 0,
        label: {
          text: "two\nlines",
          style: {
            color: "#000000",
            background: { fill: "#00ff00" },
            padding: 24,
            halo: false,
          },
        },
      }),
      point(spot, {
        x: "x",
        y: "y",
        radius: 40,
        fill: "#0000ff",
        fillOpacity: 0.5,
        zIndex: zIndex.points ?? 0,
      }),
    ],
  };
}

/**
 * The canvas' color at a chart's values (x, y), from a point `dx` pixels
 * right of them, once the chart has drawn (charts giving zIndex values
 * load the guide compiler first).
 */
async function colorAt(options: ChartOptions, x: number, y: number, dx = 0): Promise<number[]> {
  const chart = createChart(host, options);
  await chart.loading;
  const canvas = host.querySelector("canvas")!;
  const ratio = canvas.width / host.clientWidth;
  const px = (chart.toPixel(x, { axis: "x" })! + dx) * ratio;
  const py = chart.toPixel(y, { axis: "y" })! * ratio;
  const pixel = Array.from(
    canvas.getContext("2d")!.getImageData(Math.round(px), Math.round(py), 1, 1).data,
  );
  chart.destroy();
  return pixel;
}

const near = (actual: readonly number[], expected: readonly number[]) =>
  actual.every((value, i) => Math.abs(value - expected[i]!) <= 3);

describe("ordered painting", () => {
  contractTest("mark.z-index.order.canvas", async () => {
    // The box's left padding, clear of the text and the point.
    const box = (options: ChartOptions) => colorAt(options, 4, 5, -30);
    // Its right padding, under the point: half blue over green.
    const both = (options: ChartOptions) => colorAt(options, 4, 5, 30);
    expect(await colorAt(layered(), 1, 5)).toEqual([255, 0, 0, 255]);
    expect(await box(layered())).toEqual([0, 255, 0, 255]);
    expect(near(await both(layered()), [0, 128, 127, 255])).toBe(true);
    // Raised over the others, the line covers the box; lowered, the point paints under it.
    expect(await box(layered({ line: 1 }))).toEqual([255, 0, 0, 255]);
    expect(await both(layered({ points: -1 }))).toEqual([0, 255, 0, 255]);
  });

  contractTest("rule.stroke-width.zero.canvas", () => {
    // A rule 0 pixels wide draws no line on a canvas, as in SVG and PDF,
    // whatever was stroked before it.
    const reds = (strokeWidth: number) => {
      const chart = createChart(host, {
        renderer: "canvas",
        theme: { tokens: { background: "transparent" } },
        legend: false,
        x: { domain: [0, 10], show: false, grid: false },
        y: { domain: [0, 10], show: false, grid: false },
        marks: [
          line(table({ x: [0, 10], y: [2, 2] }), { x: "x", y: "y", strokeWidth: 6 }),
          rule({ y: 5, stroke: "#ff0000", strokeWidth }),
        ],
      });
      const canvas = host.querySelector("canvas")!;
      const row = Math.round(chart.toPixel(5, { axis: "y" })! * (canvas.width / host.clientWidth));
      const { data } = canvas.getContext("2d")!.getImageData(0, row, canvas.width, 1);
      chart.destroy();
      let count = 0;
      // Any of its ink, however faint.
      for (let i = 0; i < data.length; i += 4) if (data[i]! > 0 && data[i + 3]! > 0) count++;
      return count;
    };
    expect(reds(2)).toBeGreaterThan(0);
    expect(reds(0)).toBe(0);
  });

  contractTest("rule.label.opacity.canvas", () => {
    // A rule's stroke opacity is its line's: its label shows, as in SVG and PDF.
    const ink = (label?: string | { text: string; style: { fontWeight: number } }) => {
      const chart = createChart(host, {
        renderer: "canvas",
        theme: { tokens: { background: "transparent" } },
        legend: false,
        x: { domain: [0, 10], show: false, grid: false },
        y: { domain: [0, 10], show: false, grid: false },
        marks: [rule({ y: 5, stroke: "#ff0000", strokeOpacity: 0, ...(label && { label }) })],
      });
      const canvas = host.querySelector("canvas")!;
      const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      chart.destroy();
      let count = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i]! > 100) count++;
      return count;
    };
    expect(ink(undefined)).toBe(0);
    expect(ink("Threshold")).toBeGreaterThan(20);
    expect(ink({ text: "Threshold", style: { fontWeight: 700 } })).toBeGreaterThan(20);
  });

  contractTest("mark.z-index.canvas.store", () => {
    // Annotations among the data are painted on the chart's one canvas.
    const chart = createChart(host, layered());
    expect(host.querySelectorAll("canvas")).toHaveLength(1);
    expect(host.querySelector("svg text")?.textContent ?? "").not.toContain("two");
    chart.destroy();
  });

  contractTest("mark.z-index.canvas.text", async () => {
    // Text of several lines lands where SVG puts it: the same rows of ink.
    const options = (renderer: "svg" | "canvas"): ChartOptions => ({
      renderer,
      theme: { tokens: { background: "transparent" } },
      legend: false,
      x: { domain: [0, 10], show: false, grid: false },
      y: { domain: [0, 10], show: false, grid: false },
      marks: [
        text({
          x: 5,
          y: 5,
          label: {
            text: "Target\n52.8%\nend",
            style: { color: "#000000", fontSize: 16, halo: false },
          },
        }),
      ],
    });
    const rows = (canvas: HTMLCanvasElement) => {
      const { data, width, height } = canvas
        .getContext("2d")!
        .getImageData(0, 0, canvas.width, canvas.height);
      const inked: number[] = [];
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (data[(y * width + x) * 4 + 3]! > 128) {
            inked.push(y);
            break;
          }
      return inked;
    };
    const painted = createChart(host, options("canvas"));
    const ratio = host.querySelector("canvas")!.width / host.clientWidth;
    const onCanvas = rows(host.querySelector("canvas")!);
    painted.destroy();
    const drawn = createChart(host, options("svg"));
    const svg = new XMLSerializer().serializeToString(host.querySelector("svg")!);
    drawn.destroy();
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(400 * ratio);
    canvas.height = Math.round(300 * ratio);
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    const inSvg = rows(canvas);
    // Three lines, each within a device pixel of where SVG draws it.
    expect(onCanvas.length).toBeGreaterThan(20);
    expect(Math.abs(onCanvas[0]! - inSvg[0]!)).toBeLessThanOrEqual(Math.ceil(ratio));
    expect(Math.abs(onCanvas.at(-1)! - inSvg.at(-1)!)).toBeLessThanOrEqual(Math.ceil(ratio));
  });

  contractTest("mark.z-index.svg.identity", () => {
    // In SVG, a mark painted elsewhere keeps its node, moved.
    const data = table({ x: [0, 1, 2], y: [1, 3, 2] });
    const marks = (zIndex: number) => [
      line(data, { x: "x", y: "y", stroke: "#ff0000" }),
      rule({ y: 2, stroke: "#00ff00", zIndex }),
      line(data, { x: "x", y: "y", stroke: "#0000ff" }),
    ];
    const chart = createChart(host, { renderer: "svg", marks: marks(0) });
    // The panel's group holds its grid lines first, then its marks.
    const drawn = () =>
      [...panelGroups(chart.root)[0]!.children].filter(
        (node) => node.getAttribute("data-kind") !== "grid",
      );
    const kinds = () =>
      drawn().map(
        (node) => node.getAttribute("stroke") ?? node.firstElementChild?.getAttribute("stroke"),
      );
    expect(kinds()).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
    const ruled = drawn()[1]!;
    chart.update({ renderer: "svg", marks: marks(1) });
    chart.render();
    expect(kinds()).toEqual(["#ff0000", "#0000ff", "#00ff00"]);
    expect(drawn()[2]).toBe(ruled);
    chart.destroy();
  });

  contractTest("mark.z-index.hydrate", async () => {
    // A snapshot of interleaved marks is taken over node for node.
    const data = table({ x: [0, 1, 2], y: [1, 3, 2] });
    const options = (): ChartOptions => ({
      marks: [
        line(data, { x: "x", y: "y" }),
        rule({ y: 2, label: "limit", zIndex: -1 }),
        point(data, { x: "x", y: "y" }),
      ],
    });
    const initial = renderToSnapshot(options(), { width: 400, height: 300, idPrefix: "order" });
    host.innerHTML = initial.html;
    const before = [...host.querySelectorAll("svg [data-kind]")];
    const chart = hydrateChart(host, options(), initial);
    await frame();
    expect([...chart.root.querySelectorAll("svg [data-kind]")]).toEqual(before);
    // The rule under the line, as its zIndex says, over the grid lines it ties with.
    const kinds = [...panelGroups(chart.root)[0]!.children].map((node) =>
      node.getAttribute("data-kind"),
    );
    expect(kinds).toEqual(["grid", "rule", "line", "point"]);
    expect(modelOf(chart).config.marks).toHaveLength(3);
    chart.destroy();
  });
});
