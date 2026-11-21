// Tick labels a format writes in lines (study A5's repro), in the browser:
// drawn a line at a time on both axes, the short form's and listed ones in
// every overlap mode, in the room their blocks take; live in SVG and
// Canvas as static SVG and PDF draw them.
import "./interactive.ts";
import { afterEach, describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { axis } from "../../src/guides/options.ts";
import { line } from "../../src/marks/line.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { renderToSVG } from "../../src/render/static.ts";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 20);
const TIMES = Array.from({ length: 15 }, (_, i) => T0 + i * DAY);
const data = table({ time: time(TIMES), v: TIMES.map((_, i) => 10 + (i % 5)) });
const DATES = { time: "%b %-d\n%Y" };
const MS = { number: ",.0f", suffix: "\nms" };
const WIDTH = 720;
const HEIGHT = 300;

const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
});

async function mount(options: ChartOptions): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px`;
  document.body.append(host);
  const chart = createChart(host, options);
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

const options = (renderer: "svg" | "canvas", extra: Partial<ChartOptions>): ChartOptions => ({
  renderer,
  locale: "en-US",
  timeZone: "UTC",
  animation: false,
  marks: [line(data, { x: "time", y: "v" })],
  ...extra,
});

/** The labels drawn whose text `match` finds: each one's lines, as its text element's tspans or text. */
function drawn(chart: Chart, match: RegExp): string[][] {
  return [...chart.root.querySelectorAll("svg text")]
    .filter((text) => match.test(text.textContent ?? ""))
    .map((text) => {
      const spans = [...text.querySelectorAll("tspan")].map((span) => span.textContent ?? "");
      return spans.length ? spans : [text.textContent ?? ""];
    });
}

const plotOf = (chart: Chart) => chart.getPanels()[0]!.plot;

/** The text a PDF's first content stream writes, a run at a time. */
async function written(pdf: Uint8Array): Promise<string[]> {
  const text = new TextDecoder("latin1").decode(pdf);
  const at = text.indexOf("stream\n") + 7;
  const bytes = pdf.slice(at, text.indexOf("\nendstream", at));
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  const lines = (await new Response(out).text()).split("\n");
  return lines.flatMap((line) => /\((.*)\) Tj/.exec(line)?.[1] ?? []);
}

describe("tick labels a format writes in lines", () => {
  it("are drawn in lines on the short form and listed axes, in every overlap mode (A5)", async () => {
    for (const renderer of ["svg", "canvas"] as const) {
      const variants: Record<string, Partial<ChartOptions>> = {
        "x.format": { x: { format: DATES } },
        listed: { guides: [axis({ scale: "x", format: DATES })] },
        show: { guides: [axis({ scale: "x", format: DATES, labels: { overlap: "show" } })] },
        hide: { guides: [axis({ scale: "x", format: DATES, labels: { overlap: "hide" } })] },
        wrap: { guides: [axis({ scale: "x", format: DATES, labels: { overlap: "wrap" } })] },
        stagger: { guides: [axis({ scale: "x", format: DATES, labels: { overlap: "stagger" } })] },
        turned: { guides: [axis({ scale: "x", format: DATES, labels: { rotation: -45 } })] },
      };
      const one = await mount(options(renderer, { x: { format: { time: "%b %-d" } } }));
      const heights: Record<string, number> = {};
      for (const [name, extra] of Object.entries(variants)) {
        const chart = await mount(options(renderer, extra));
        const labels = drawn(chart, /^(Oct|Nov) \d+/);
        expect(labels.length, `${renderer} ${name}`).toBeGreaterThan(2);
        for (const lines of labels) expect(lines, `${renderer} ${name}`).toHaveLength(2);
        expect(labels[0]![1]).toBe("2026");
        heights[name] = plotOf(chart).height;
      }
      // Flat labels in one row take a line more than one line's room.
      const lineHeight = one.getPanels()[0]!.plot.height - heights["x.format"]!;
      expect(lineHeight).toBeGreaterThan(10);
      for (const name of ["listed", "show", "hide", "wrap"])
        expect(heights[name], `${renderer} ${name}`).toBe(heights["x.format"]);
      // Two lanes of blocks, and turned blocks, take more.
      expect(heights.stagger).toBeLessThan(heights["x.format"]!);
      expect(heights.turned).toBeLessThan(heights["x.format"]!);
    }
  });

  it("are drawn in lines along y, as wide as their widest line, inside the chart", async () => {
    for (const renderer of ["svg", "canvas"] as const) {
      for (const extra of [
        { y: { format: MS } },
        { guides: [axis({ scale: "y", format: MS, labels: { overlap: "hide" } })] },
        { y: { format: MS }, x: { format: DATES } },
      ]) {
        const chart = await mount(options(renderer, extra));
        const texts = [...chart.root.querySelectorAll("svg text")].filter((text) =>
          text.textContent?.endsWith("ms"),
        );
        expect(texts.length).toBeGreaterThan(2);
        const root = chart.root.getBoundingClientRect();
        for (const text of texts) {
          const spans = [...text.querySelectorAll("tspan")];
          expect(spans).toHaveLength(2);
          // Every line inside the chart, left of the plot: its glyphs
          // across, and its line's height down.
          const box = text.getBoundingClientRect();
          expect(box.left).toBeGreaterThanOrEqual(root.left - 0.5);
          expect(box.right).toBeLessThanOrEqual(root.left + plotOf(chart).x);
          const half = (1.25 * Number.parseFloat(getComputedStyle(text).fontSize)) / 2;
          for (const span of spans) {
            const y = Number(span.getAttribute("y"));
            expect(y - half).toBeGreaterThanOrEqual(-0.5);
            expect(y + half).toBeLessThanOrEqual(HEIGHT + 0.5);
          }
        }
      }
    }
  });

  it("leave out a row a room holds one line of, and end labels crossing the chart's edge", async () => {
    // At 12 px, a row of one line needs 23 px (8 px from the line, a 15 px line).
    const roomed = (format: object) =>
      mount(options("svg", { guides: [axis({ scale: "x", format, room: 23 })] }));
    expect(drawn(await roomed({ time: "%b %-d" }), /^(Oct|Nov) \d+/).length).toBeGreaterThan(2);
    const left = await roomed(DATES);
    expect(drawn(left, /^(Oct|Nov) \d+/)).toEqual([]);
    expect(plotOf(left).height).toBe(plotOf(await roomed({ time: "%b %-d" })).height);
    // The last label, at the right edge, is left out; the others keep their lines.
    const ends = (hide: boolean) =>
      mount(
        options("svg", {
          x: { domain: [T0, T0 + 14 * DAY], nice: false },
          guides: [
            axis({
              scale: "x",
              format: DATES,
              ticks: { values: [T0 + 7 * DAY, T0 + 14 * DAY] },
              ...(hide && { labels: { ends: "hide" } }),
            }),
          ],
        }),
      );
    expect(drawn(await ends(false), /^(Oct|Nov) \d+/)).toEqual([
      ["Oct 27", "2026"],
      ["Nov 3", "2026"],
    ]);
    expect(drawn(await ends(true), /^(Oct|Nov) \d+/)).toEqual([["Oct 27", "2026"]]);
  });

  it("are drawn by static SVG and PDF as the live chart draws them", async () => {
    const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
    for (const renderer of ["svg", "canvas"] as const) {
      const chosen = options(renderer, {
        x: { format: DATES },
        guides: [axis({ scale: "y", format: MS, labels: { overlap: "hide" } })],
      });
      const chart = await mount(chosen);
      const measureText = measurer(document);
      const live = chart.toSVG();
      expect(live).toContain(">2026</tspan>");
      expect(svg(renderToSVG({ ...chosen, width: WIDTH, height: HEIGHT }, { measureText }))).toBe(
        svg(live),
      );
      // PDF writes each line as a run of its own.
      const runs = await written(renderToPDF(chart));
      expect(runs).toContain("Oct 21");
      expect(runs).toContain("2026");
      expect(runs).toContain("ms");
      expect(runs.some((run) => run.includes("\\n"))).toBe(false);
    }
  });
});
