// Counting labels in a bar race, as B6 draws them: bars' two-line labels
// of parts, the brand above its value, aligned to their end inside each
// bar's end. Mid-transition each value is written exactly and laid out by
// its shape, so the race measures only keyframes' text and a few shapes,
// and the value is drawn from the labels' right edge, as it is at rest; at
// rest the chart draws what a static export of its options draws. Text
// labels of parts count each of their number fields alike.

import "./interactive.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type Table, table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { facesLoaded, measurer } from "../../src/dom/measurers.ts";
import { axis } from "../../src/guides/options.ts";
import { shapeOf } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { text } from "../../src/marks/text.ts";
import { renderToSVG } from "../../src/render/static.ts";

const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

const N = 12;
const BRANDS = Array.from({ length: 20 }, (_, i) => `Brand ${String.fromCharCode(65 + i)}`);

/** A race's keyframes: the top 12 of 20 brands, their values growing unevenly. */
function keyframes(count: number) {
  let seed = 7;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  const values = BRANDS.map(() => 10_000 + random() * 50_000);
  return Array.from({ length: count }, () => {
    for (let i = 0; i < values.length; i++) values[i]! += random() * 8_000;
    const order = values
      .map((v, i) => [v, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, N);
    return {
      brand: order.map(([, i]) => BRANDS[i]!),
      value: order.map(([v]) => v),
      rank: order.map((_, r) => r),
    };
  });
}

/** B6's chart: 960 x 600, the value axis on top, bars labeled by brand and value. */
function options(data: Table): ChartOptions & { width: number; height: number } {
  return {
    width: 960,
    height: 600,
    padding: { top: 0, right: 6, bottom: 0, left: 0 },
    legend: false,
    inspection: false,
    animation: { values: true, duration: 250, easing: "linear" },
    x: { nice: false },
    y: { domain: [N - 0.5, -0.5], show: false, grid: false },
    guides: [
      axis({
        scale: "x",
        place: { side: "top" },
        room: 16,
        line: false,
        tick: false,
        ticks: 6,
        labels: { gap: 0, ends: "hide" },
        // In a font of their own, as B6's, so the labels' measuring is told apart.
        style: { tickLabel: { font: "sans-serif", fontSize: 10 } },
      }),
    ],
    marks: [
      bar(data as never, {
        itemKey: "brand",
        orient: "y",
        x: "value",
        y: "rank",
        fillOpacity: 0.6,
        width: { px: 40 },
        labels: {
          content: [
            { field: "brand", style: { fontWeight: 700 } },
            "\n",
            { value: true, format: { number: ",.0f" }, style: { opacity: 0.7 } },
          ],
          place: { outside: false },
          style: {
            font: "system-ui, sans-serif",
            fontSize: 12,
            color: "#000000",
            align: "end",
            halo: false,
          },
        },
      }),
    ],
  } as ChartOptions & { width: number; height: number };
}

/** Each label's two lines as drawn: the brand's and the value's text elements. */
function lines(chart: Chart): [SVGTextElement, SVGTextElement][] {
  const texts = [...chart.root.querySelectorAll<SVGTextElement>('[data-kind="labels"] text')];
  const pairs: [SVGTextElement, SVGTextElement][] = [];
  for (let k = 0; k + 1 < texts.length; k += 2) pairs.push([texts[k]!, texts[k + 1]!]);
  return pairs;
}

/** Where a line's text ends as the browser lays it out (WebKit's end positions of characters are a pixel or two short). */
function right(text: SVGTextElement): number {
  const box = text.getBBox();
  return box.x + box.width;
}

/** Where a text element is anchored along x. */
const end = (text: SVGTextElement) => Number(text.getAttribute("x"));

describe("counting labels in a race", () => {
  it("measure only keyframes' text and their numbers' shapes, each value drawn from the labels' right edge", async () => {
    // A measurer of the page's own, which measures every string once.
    facesLoaded(document);
    const race = keyframes(9);
    const data = table(race[0]!) as unknown as Table;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0";
    document.body.append(host);
    const chart = createChart(host, options(data));
    charts.push(chart);
    await chart.loading;
    chart.render();
    await frame();
    await frame();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    chart.render();
    chart.root.dispatchEvent(new PointerEvent("pointerleave"));
    vi.advanceTimersByTime(16);
    // What is measured in the labels' font.
    const measured = new Set<string>();
    const measureText = CanvasRenderingContext2D.prototype.measureText;
    vi.spyOn(CanvasRenderingContext2D.prototype, "measureText").mockImplementation(function (
      this: CanvasRenderingContext2D,
      text: string,
    ) {
      if (this.font.includes("system-ui")) measured.add(text);
      return measureText.call(this, text);
    });
    const written = new Set<string>();
    let frames = 0;
    let moving = 0;
    for (const keyframe of race.slice(1)) {
      data.reset(keyframe);
      for (let t = 0; t < 250; t += 16) {
        vi.advanceTimersByTime(16);
        frames++;
        for (const [brand, value] of lines(chart)) {
          written.add(value.textContent!);
          // The value's right edge is the brand's, the labels' lines aligned
          // to their end and drawn from it, mid-transition and at rest
          // alike, whatever WebKit's SVG text measures against the page's
          // canvas. As painted, Linux's hinted glyph advances can put an
          // end-anchored line's box a pixel or two from it.
          expect(value.getAttribute("text-anchor")).toBe("end");
          moving++;
          expect(Math.abs(end(value) - end(brand)), value.textContent!).toBeLessThan(0.01);
          expect(Math.abs(right(value) - right(brand)), value.textContent!).toBeLessThan(2);
        }
      }
    }
    vi.restoreAllMocks();
    expect(frames).toBeGreaterThan(100);
    expect(moving).toBeGreaterThan(1000);
    // Hundreds of values written as they count; measured, the keyframes'
    // values and a shape or two.
    const ends = new Set(
      race.flatMap(({ value }) =>
        value.map((v) => v.toLocaleString("en-US", { maximumFractionDigits: 0 })),
      ),
    );
    expect([...written].filter((text) => !ends.has(text)).length).toBeGreaterThan(300);
    expect([...measured].filter((text) => !ends.has(text) && shapeOf(text) !== text)).toEqual([]);
    expect(
      [...measured].filter((text) => shapeOf(text) === text && /0/.test(text)).length,
    ).toBeLessThan(6);
    // At rest, as a static export of its options draws it.
    vi.advanceTimersByTime(400);
    vi.useRealTimers();
    const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
    expect(svg(renderToSVG(options(data), { measureText: measurer(document) }))).toBe(
      svg(chart.toSVG()),
    );
    for (const [brand, value] of lines(chart))
      expect(Math.abs(end(value) - end(brand)), value.textContent!).toBeLessThan(0.01);
  });
});

/** Three stores' two-line text labels: the name above revenue and share, aligned to their end. */
function stores(data: Table): ChartOptions & { width: number; height: number } {
  return {
    width: 480,
    height: 300,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    legend: false,
    inspection: false,
    animation: { values: true, duration: 250, easing: "linear" },
    x: { domain: [0, 10], show: false, grid: false },
    y: { domain: [0, 10], show: false, grid: false },
    marks: [
      text(data as never, {
        itemKey: "id",
        x: "x",
        y: "y",
        label: {
          content: [
            { field: "name", style: { fontWeight: 700 } },
            "\n",
            { field: "revenue", format: { number: ",.0f" } },
            " · ",
            { field: "share", format: { number: ".1%" }, style: { opacity: 0.7 } },
          ],
          style: { font: "system-ui, sans-serif", fontSize: 12, align: "end", halo: false },
        },
      }),
    ],
  } as ChartOptions & { width: number; height: number };
}

describe("labels of parts at rest", () => {
  it("keep the room of the spaces at their parts' ends, however their lines align", async () => {
    facesLoaded(document);
    for (const align of ["start", "center", "end"] as const) {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:0;top:0";
      document.body.append(host);
      const data = table({ x: [5], y: [5], v: [1234] }) as unknown as Table;
      const chart = createChart(host, {
        width: 400,
        height: 200,
        legend: false,
        x: { domain: [0, 10] },
        y: { domain: [0, 10] },
        marks: [
          text(data as never, {
            x: "x",
            y: "y",
            label: {
              content: [
                "Revenue ",
                { field: "v", format: { number: ".0f" }, style: { fontWeight: 700 } },
                " kg",
              ],
              // A font the page's canvas and SVG text resolve alike (Firefox's canvas takes system-ui for another face).
              style: { font: "sans-serif", fontSize: 12, align, halo: false },
            },
          }),
        ],
      } as ChartOptions);
      charts.push(chart);
      await chart.loading;
      chart.render();
      await frame();
      const [name, number, unit] = [
        ...chart.root.querySelectorAll<SVGTextElement>('[data-kind="labels"] text'),
      ];
      expect([name, number, unit].map((text) => text!.textContent)).toEqual([
        "Revenue",
        "1234",
        "kg",
      ]);
      // A space's room between each part and the next, as the page's canvas measures it.
      const context = document.createElement("canvas").getContext("2d")!;
      context.font = "12px sans-serif";
      const space = context.measureText(" ").width;
      // Pen positions where each part's text starts and ends (Firefox's
      // boxes of text are wider than its glyphs' advances).
      const first = (text: SVGTextElement) => text.getStartPositionOfChar(0).x;
      const last = (text: SVGTextElement) =>
        text.getEndPositionOfChar(text.getNumberOfChars() - 1).x;
      expect(first(number!) - last(name!), align).toBeGreaterThan(space - 1);
      expect(first(unit!) - last(number!), align).toBeGreaterThan(space - 1);
    }
  });
});

describe("counting text labels of parts", () => {
  it("count each number in its format, their lines ending at one edge inside the chart, and rest as a static export", async () => {
    facesLoaded(document);
    const rows = (revenue: number[], share: number[]) => ({
      id: ["a", "b", "c"],
      // c by the chart's left edge: its block, ending at its point, is kept inside.
      x: [5, 9, 0.2],
      y: [2, 5, 8],
      name: ["North", "Centre", "Kiosk"],
      revenue,
      share,
    });
    const keyframes = [
      rows([1_000, 20_000, 300], [0.1, 0.5, 0.9]),
      rows([9_000, 20_000, 4_800_000], [0.3, 0.2, 0.15]),
      rows([2_500, 61_000, 7_000], [0.45, 0.05, 0.6]),
    ];
    const data = table(keyframes[0]!) as unknown as Table;
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0";
    document.body.append(host);
    const chart = createChart(host, stores(data));
    charts.push(chart);
    await chart.loading;
    chart.render();
    await frame();
    await frame();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    chart.render();
    chart.root.dispatchEvent(new PointerEvent("pointerleave"));
    vi.advanceTimersByTime(16);
    const measured = new Set<string>();
    const measureText = CanvasRenderingContext2D.prototype.measureText;
    vi.spyOn(CanvasRenderingContext2D.prototype, "measureText").mockImplementation(function (
      this: CanvasRenderingContext2D,
      text: string,
    ) {
      if (this.font.includes("system-ui")) measured.add(text);
      return measureText.call(this, text);
    });
    const written = new Set<string>();
    const ends = new Set<string>();
    for (const keyframe of keyframes.slice(1)) {
      data.reset(keyframe);
      for (let t = 0; t < 250; t += 16) {
        vi.advanceTimersByTime(16);
        const texts = [...chart.root.querySelectorAll<SVGTextElement>('[data-kind="labels"] text')];
        expect(texts).toHaveLength(12);
        for (let k = 0; k < texts.length; k += 4) {
          const [name, revenue, , share] = texts.slice(k, k + 4) as SVGTextElement[];
          // Each number in its format, between its ends.
          expect(revenue!.textContent).toMatch(/^\d{1,3}(,\d{3})*$/);
          expect(share!.textContent).toMatch(/^\d+\.\d%$/);
          written.add(revenue!.textContent!);
          // Both lines drawn from their end, at one edge.
          for (const text of texts.slice(k, k + 4))
            expect(text.getAttribute("text-anchor")).toBe("end");
          expect(Math.abs(end(share!) - end(name!)), share!.textContent!).toBeLessThan(0.01);
          // As painted, within Linux's hinting (see the race above).
          expect(Math.abs(right(share!) - right(name!)), share!.textContent!).toBeLessThan(2);
        }
        // Inside the chart, to the shapes' error (a pixel or so per narrow digit).
        for (const text of texts) {
          const box = text.getBBox();
          expect(box.x, text.textContent!).toBeGreaterThan(-4);
          expect(box.x + box.width, text.textContent!).toBeLessThan(484);
        }
      }
      for (const v of keyframe.revenue) ends.add(v.toLocaleString("en-US"));
      for (const v of keyframe.share) ends.add(`${(v * 100).toFixed(1)}%`);
    }
    vi.restoreAllMocks();
    // Written as they count; measured, the keyframes' text and the numbers' shapes.
    expect([...written].filter((text) => !ends.has(text)).length).toBeGreaterThan(20);
    expect([...measured].filter((text) => !ends.has(text) && shapeOf(text) !== text)).toEqual([]);
    // At rest, as a static export of its options draws it, its lines at one edge.
    vi.advanceTimersByTime(400);
    vi.useRealTimers();
    const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
    expect(svg(renderToSVG(stores(data), { measureText: measurer(document) }))).toBe(
      svg(chart.toSVG()),
    );
    const texts = [...chart.root.querySelectorAll<SVGTextElement>('[data-kind="labels"] text')];
    for (let k = 0; k < texts.length; k += 4)
      expect(Math.abs(end(texts[k + 3]!) - end(texts[k]!))).toBeLessThan(0.01);
  });
});
