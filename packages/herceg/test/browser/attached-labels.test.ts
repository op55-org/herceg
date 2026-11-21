// Labels marks attach to their data, as the screen shows them: series
// labels where lines meet a zoomed view's edge, leaders where a name's text
// is drawn more than 6 pixels from its line's end while streaming (the
// study's A6), bars' labels over the white grid lines an axis raises over
// the bars (B6), in SVG and Canvas alike, and static SVG and PDF as the
// live chart draws them.
import { afterEach, beforeEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { axis } from "../../src/guides/options.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import { num } from "../../src/render/pdf-document.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { LabelsGeometry, Scene, SegmentGeometry } from "../../src/scene/scene.ts";
import type { SeriesLabelsSpec } from "../../src/spec/encoding.ts";
import { contractTest } from "../helpers/contracts.ts";

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 1);
/** A6's names: 12 px, grey, without a halo, beside the plot with a leader. */
const NAMES = {
  place: { outside: true, offset: 28 },
  leader: true,
  style: { color: "#333333", fontSize: 12, halo: false },
} as const satisfies Omit<SeriesLabelsSpec, "at">;
const COLORS = [
  "#1f77b4",
  "#ff7f0e",
  "#2ca02c",
  "#d62728",
  "#9467bd",
  "#8c564b",
  "#e377c2",
  "#7f7f7f",
  "#bcbd22",
  "#17becf",
  "#393b79",
  "#637939",
];

/** Charts drawn at once, without a legend. */
const STILL = { animation: false, legend: false } as const;

let host: HTMLDivElement;
const charts: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:700px;height:420px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  host.remove();
  restore?.();
});

async function mount(options: ChartOptions): Promise<Chart> {
  const chart = createChart(host, options);
  charts.push(chart);
  await chart.loading;
  chart.render();
  return chart;
}

const sceneOf = (chart: Chart): Scene =>
  (chart as unknown as ExportsScene)[EXPORT_SCENE]((scene) => scene);

/** Each leader's stroke and its end at the label, as the chart's scene draws them. */
function leaders(scene: Scene): { stroke: string; y: number }[] {
  return scene.panels[0]!.marks.flatMap((g) => {
    if (g.kind !== "segments") return [];
    const { stroke, coords, count } = g as SegmentGeometry;
    return Array.from({ length: count }, (_, k) => ({ stroke, y: coords[k * 4 + 3]! }));
  });
}

// Canvas text as drawn: the middle of each fill's font box, in CSS pixels
// of the chart, as the study reads it (the font's box about the baseline drawn).
let drawn: { text: string; y: number }[] = [];
let restore: (() => void) | undefined;
function recordCanvasText(): void {
  const proto = CanvasRenderingContext2D.prototype;
  const { fillText, clearRect } = proto;
  proto.clearRect = function (...args) {
    drawn = [];
    return clearRect.apply(this, args);
  };
  proto.fillText = function (text, x, y, max) {
    const m = this.measureText(String(text));
    const middle = y + (m.fontBoundingBoxDescent - m.fontBoundingBoxAscent) / 2;
    const t = this.getTransform();
    const ratio = this.canvas.width / this.canvas.getBoundingClientRect().width;
    drawn.push({ text: String(text), y: (t.b * x + t.d * middle + t.f) / ratio });
    return fillText.call(this, text, x, y, max);
  };
  restore = () => {
    proto.fillText = fillText;
    proto.clearRect = clearRect;
    restore = undefined;
  };
}

/** Where each name's text is drawn, its middle along y, in CSS pixels of the chart. */
function drawnMiddles(chart: Chart, renderer: "svg" | "canvas"): Map<string, number> {
  if (renderer === "canvas") return new Map(drawn.map(({ text, y }) => [text, y]));
  const origin = chart.root.getBoundingClientRect();
  const range = document.createRange();
  const middles = new Map<string, number>();
  for (const text of chart.root.querySelectorAll("svg text")) {
    range.selectNodeContents(text);
    const box = range.getBoundingClientRect();
    middles.set(text.textContent ?? "", box.top + box.height / 2 - origin.top);
  }
  return middles;
}

describe("series labels where lines meet the view's edge", () => {
  contractTest(
    "labels.attach.view-edge.live",
    async () => {
      // payments is above search at the last minute in view, and below it
      // where they meet the view's edge, half a minute later.
      const minutes = 20;
      const rows = table({
        t: Array.from({ length: minutes }, (_, i) => START + i * MINUTE),
        payments: Array.from({ length: minutes }, (_, i) => (i < minutes - 1 ? 500 : 400)),
        search: Array.from({ length: minutes }, (_, i) => (i < minutes - 1 ? 450 : 520)),
      });
      const edge = START + (minutes - 1.5) * MINUTE;
      for (const renderer of ["svg", "canvas"] as const) {
        const order = async (at: "view-end" | "visible-end") => {
          const chart = await mount({
            ...STILL,
            renderer,
            timeZone: "UTC",
            x: { domain: [START, edge], nice: false },
            y: { domain: [0, 1000], nice: false },
            marks: [line(rows, { x: "t", y: ["payments", "search"], labels: { at, ...NAMES } })],
          });
          const labels = sceneOf(chart).panels[0]!.marks.flatMap((g) =>
            g.kind === "labels" ? (g as LabelsGeometry).items : [],
          );
          // Top to bottom, as drawn on screen.
          const svgTexts = [...chart.root.querySelectorAll("svg text")].map((t) => t.textContent);
          if (renderer === "svg") expect(svgTexts).toEqual(expect.arrayContaining(["search"]));
          const names = labels.sort((a, b) => a.y - b.y).map(({ text }) => text);
          chart.destroy();
          charts.pop();
          return names;
        };
        // Read between the minutes either side of the edge: 485 against 450.
        expect(await order("view-end")).toEqual(["search", "payments"]);
        // The last observation in view keeps the minute's order.
        expect(await order("visible-end")).toEqual(["payments", "search"]);
      }
    },
    "label lines where they meet a zoomed view's edge, read between two minutes, in SVG and Canvas",
  );

  contractTest(
    "label.series.leader.painted",
    async () => {
      for (const renderer of ["svg", "canvas"] as const) {
        if (renderer === "canvas") recordCanvasText();
        // Twelve lines streaming a minute at a time, their ends closer
        // together than a name is tall: the names spread about their middle,
        // the outermost moved just under 6 pixels each way.
        const names = COLORS.map((_, k) => `line ${String.fromCharCode(97 + k)}`);
        const window = 30;
        const columns: Record<string, number[]> = {
          t: Array.from({ length: window }, (_, i) => START + i * MINUTE),
        };
        for (const name of names) columns[name] = new Array(window).fill(500);
        const rows = table(columns, { maxRows: window });
        const options = (view: [number, number]): ChartOptions => ({
          ...STILL,
          renderer,
          timeZone: "UTC",
          theme: { tokens: { palette: COLORS } },
          x: { domain: view, nice: false },
          y: { domain: [0, 1000], nice: false },
          marks: [line(rows, { x: "t", y: names, labels: { at: "view-end", ...NAMES } })],
        });
        const chart = await mount(options([START, START + (window - 1) * MINUTE]));
        const { plot } = chart.getPanels()[0]!;
        const label = sceneOf(chart).panels[0]!.marks.flatMap((g) =>
          g.kind === "labels" ? (g as LabelsGeometry).items : [],
        )[0]!;
        const { lineHeight } = label.paint;
        // How far a name's text is drawn from its box's middle: the font's
        // ascent and descent about the baseline, which differ by platform.
        // The outermost names move 6 less half of that, so the one whose
        // text is drawn further out has its box within 6 pixels of its end
        // and its text beyond them.
        const drop = Math.abs(drawnMiddles(chart, renderer).get(label.text)! - label.y);
        const move = 6 - drop / 2;
        // The next minute arrives, the view following the window.
        const step = ((lineHeight - (2 * move) / (names.length - 1)) * 1000) / plot.height;
        const t = START + window * MINUTE;
        rows.append({
          t: [t],
          ...Object.fromEntries(names.map((name, k) => [name, [400 + (names.length - k) * step]])),
        });
        chart.update(options([t - (window - 1) * MINUTE, t]));
        await chart.loading;
        chart.render();
        const scene = sceneOf(chart);
        const middles = drawnMiddles(chart, renderer);
        const led = new Set(leaders(scene).map(({ stroke }) => stroke));
        const boxes = new Map(
          scene.panels[0]!.marks.flatMap((g) =>
            g.kind === "labels"
              ? (g as LabelsGeometry).items.map((i) => [i.text, i.y] as const)
              : [],
          ),
        );
        let fixed = 0;
        names.forEach((name, k) => {
          const end = chart.toPixel(400 + (names.length - k) * step, { axis: "y" })!;
          const away = Math.abs(middles.get(name)! - end);
          // Drawn more than 6 pixels from its end: a leader; within, none.
          if (Math.abs(away - 6) > 0.05)
            expect([name, led.has(COLORS[k]!)]).toEqual([name, away > 6]);
          // Its box moved no more than 6 pixels, its text drawn further.
          if (away > 6 && Math.abs(boxes.get(name)! - end) <= 6) fixed++;
        });
        // A font drawn about its box's middle has no such name.
        if (drop > 0.1) expect(fixed).toBeGreaterThan(0);
        // Static SVG, measured with the browser's fonts, and the chart's
        // PDF, draw the leaders the live chart draws.
        const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
        const { width, height } = host.getBoundingClientRect();
        const measureText = measurer(document);
        const view: [number, number] = [t - (window - 1) * MINUTE, t];
        expect(svg(renderToSVG({ ...options(view), width, height }, { measureText }))).toBe(
          svg(chart.toSVG()),
        );
        const pdf = new TextDecoder("latin1").decode(await pdfStream(renderToPDF(chart)));
        for (const leader of scene.panels[0]!.marks.filter(
          (g): g is SegmentGeometry => g.kind === "segments",
        )) {
          const c = leader.coords;
          for (let k = 0; k < leader.count; k++)
            expect(pdf).toContain(
              `${num(c[k * 4]!)} ${num(c[k * 4 + 1]!)} m\n${num(c[k * 4 + 2]!)} ${num(c[k * 4 + 3]!)} l\n`,
            );
        }
        chart.destroy();
        charts.pop();
        restore?.();
      }
    },
    "draw leaders where a name's text, as drawn, is more than 6 pixels from its line's end, while streaming",
  );

  contractTest(
    "labels.attach.view-edge.export",
    async () => {
      const rows = table({ t: [0, 1, 2, 3], v: [0, 10, 20, 30], w: [30, 20, 10, 0] });
      const options = (renderer: "svg" | "canvas"): ChartOptions => ({
        ...STILL,
        renderer,
        x: { domain: [0.25, 2.5], nice: false },
        y: { domain: [0, 40], nice: false },
        marks: [
          line(rows, {
            x: "t",
            y: ["v", "w"],
            curve: "monotone",
            labels: { at: "view-end", content: [{ series: true }, " ", { value: true }], ...NAMES },
          }),
        ],
      });
      for (const renderer of ["svg", "canvas"] as const) {
        const chart = await mount(options(renderer));
        const { width, height } = host.getBoundingClientRect();
        const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
        const live = chart.toSVG();
        expect(live).toContain(">v 25</text>");
        const stat = svg(
          renderToSVG({ ...options(renderer), width, height }, { measureText: measurer(document) }),
        );
        expect(stat).toBe(svg(live));
        // PDF in its own fonts writes the same names at the same crossings.
        for (const pdf of [
          renderToPDF({ ...options(renderer), width, height }),
          renderToPDF(chart),
        ]) {
          const page = new TextDecoder("latin1").decode(await pdfStream(pdf));
          expect(page).toContain("(v 25) Tj");
          expect(page).toContain("(w 5) Tj");
        }
        chart.destroy();
        charts.pop();
      }
    },
    "write labels where lines meet the view's edge alike in static SVG, PDF, and the live chart",
  );
});

describe("attached labels over raised grid lines", () => {
  contractTest(
    "labels.paint.over-grid.live",
    async () => {
      // B6: bars' two-line labels inside their ends, white grid lines raised over the bars.
      const ranked = table({
        brand: ["Alpha brand", "Beta brand"],
        value: [45, 85],
        rank: [0, 1],
        sector: ["a", "b"],
      });
      const options = (renderer: "svg" | "canvas"): ChartOptions => ({
        ...STILL,
        renderer,
        x: { domain: [0, 100], nice: false },
        y: { domain: [-0.5, 1.5], nice: false, show: false, grid: false },
        guides: [
          axis({
            scale: "x",
            ticks: { values: [20, 40, 60, 80] },
            grid: { zIndex: 1 },
            style: { grid: { stroke: "#ffffff", strokeWidth: 3 } },
          }),
        ],
        marks: [
          bar(ranked, {
            orient: "y",
            x: "value",
            y: "rank",
            color: "sector",
            labels: {
              content: [{ field: "brand", style: { fontWeight: 700 } }, "\n", { value: true }],
              style: { color: "#000000", fontSize: 14, halo: false },
              place: { attachment: "end" },
            },
          }),
        ],
      });
      for (const renderer of ["svg", "canvas"] as const) {
        // What the canvas paints, in order: fills and strokes in their colors, and text.
        const painted: string[] = [];
        const proto = CanvasRenderingContext2D.prototype;
        const { fill, stroke, fillText } = proto;
        proto.fill = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
          painted.push(`fill ${this.fillStyle}`);
          return (fill as (...given: unknown[]) => void).apply(this, args);
        };
        proto.stroke = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
          painted.push(`stroke ${this.strokeStyle}`);
          return (stroke as (...given: unknown[]) => void).apply(this, args);
        };
        proto.fillText = function (text, ...rest) {
          painted.push(`text ${text}`);
          return fillText.call(this, text, ...rest);
        };
        const chart = await mount(options(renderer));
        [proto.fill, proto.stroke, proto.fillText] = [fill, stroke, fillText];
        const labels = sceneOf(chart).panels[0]!.marks.find(
          (g) => g.kind === "labels",
        ) as LabelsGeometry;
        expect(labels.zIndex).toBe(1);
        // The bars, then the white grid lines over them, then the labels over those.
        const order = (bars: number, grid: number, text: number) => {
          expect(bars).toBeGreaterThanOrEqual(0);
          expect(grid).toBeGreaterThan(bars);
          expect(text).toBeGreaterThan(grid);
        };
        if (renderer === "canvas")
          order(
            painted.findIndex((p) => p.startsWith("fill ") && p !== "fill #ffffff"),
            painted.indexOf("stroke #ffffff"),
            painted.indexOf("text Alpha brand"),
          );
        else {
          const elements = [...chart.root.querySelectorAll("svg *")];
          order(
            elements.findIndex(
              (e) => e.tagName === "path" && e.getAttribute("fill-opacity") !== null,
            ),
            elements.findIndex((e) => e.getAttribute("stroke") === "#ffffff"),
            elements.findIndex((e) => e.tagName === "text" && e.textContent === "Alpha brand"),
          );
        }
        chart.destroy();
        charts.pop();
      }
    },
    "paint bars' labels over the white grid lines an axis raises over the bars, in SVG and Canvas",
  );
});

/** A PDF's first content stream, inflated. */
async function pdfStream(pdf: Uint8Array): Promise<ArrayBuffer> {
  const text = new TextDecoder("latin1").decode(pdf);
  const at = text.indexOf("stream\n") + 7;
  const bytes = pdf.slice(at, text.indexOf("\nendstream", at));
  const out = new Blob([bytes as Uint8Array<ArrayBuffer>])
    .stream()
    .pipeThrough(new DecompressionStream("deflate"));
  return new Response(out).arrayBuffer();
}
