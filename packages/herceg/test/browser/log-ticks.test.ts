// Log axes' ticks in a browser: live SVG and Canvas charts draw the labelled
// ticks' text alone, and static SVG and PDF draw what the live chart does.
import "./interactive.ts";
import { afterEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { contractTest } from "../helpers/contracts.ts";

const charts: Chart[] = [];

/** The lines of a PDF's first content stream. */
async function inflate(pdf: Uint8Array): Promise<string[]> {
  const text = new TextDecoder("latin1").decode(pdf);
  const at = text.indexOf("stream\n") + 7;
  const bytes = pdf.slice(at, text.indexOf("\nendstream", at));
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return (await new Response(out).text()).split("\n");
}

/** The text a PDF content stream writes, in order. */
const written = (lines: string[]) =>
  lines.flatMap((line) => /\((.*)\) Tj/.exec(line)?.[1]?.replaceAll("\\327", "×") ?? []);

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
});

async function mount(options: ChartOptions, width: number, height: number): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.append(host);
  const chart = createChart(host, options);
  charts.push(chart);
  await chart.loading;
  chart.render();
  return chart;
}

// Study B1's axis: a fixed domain [1/k, k], d3's count, and the "×" format.
const k = 6.54;
const b1 = (renderer: "svg" | "canvas"): ChartOptions => ({
  renderer,
  animation: false,
  locale: "en-US",
  marks: [line(table({ t: [0, 10], v: [1 / k, k] }), { x: "t", y: "v" })],
  y: {
    type: "log",
    domain: [1 / k, k],
    nice: false,
    ticks: 10,
    format: (value: number) => `${value}×`,
  },
});

describe("log ticks", () => {
  contractTest(
    "axis.log-ticks.export",
    async () => {
      for (const renderer of ["svg", "canvas"] as const) {
        const options = b1(renderer);
        const chart = await mount(options, 928, 600);
        const texts = [...chart.root.querySelectorAll("svg text")].map((t) => t.textContent);
        expect(texts).toContain("0.7×");
        expect(texts).toContain("1×");
        // 0.8 and 0.9 keep their grid lines, without labels.
        expect(texts).not.toContain("0.8×");
        expect(texts).not.toContain("");
        const live = chart.toSVG();
        expect(live).not.toMatch(/>0\.9×<\/text>/);
        // Ids apart: a chart's export names its own.
        const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
        expect(svg(renderToSVG({ ...options, width: 928, height: 600 }))).toBe(svg(live));
        // Static PDF measures text with its own fonts, so margins may differ
        // by a pixel; it writes the same labels, the "×" in WinAnsi.
        for (const pdf of [
          renderToPDF({ ...options, width: 928, height: 600 }),
          renderToPDF(chart),
        ])
          expect(written(await inflate(pdf))).toEqual(texts);
      }
    },
    "draw static SVG and PDF as the live SVG and Canvas charts label log ticks",
  );
});
