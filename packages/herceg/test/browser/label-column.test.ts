// The outside label column in a browser, with its fonts: A6's names stand
// their offset past the plot at a view of 1.2 seconds, where the x axis'
// last tick label overhangs the plot and stands under them, as at a view
// of hours, in SVG and Canvas alike; static SVG draws what the live chart
// draws.
import { afterEach, expect } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { line } from "../../src/marks/line.ts";
import { GAP } from "../../src/model/legend.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { LabelsGeometry, Scene, TextItem } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 1);
const minutes = Float64Array.from({ length: 360 }, (_, k) => START + k * MINUTE);
const lineOf = (s: number) =>
  Float64Array.from(minutes, (_, k) => 200 + s * 180 + 30 * Math.sin(k / 7 + s));
const metrics = table({
  time: time(minutes),
  auth: lineOf(0),
  payments: lineOf(1),
  search: lineOf(2),
  "recommendations-engine": lineOf(3),
});
const NAMES = ["auth", "payments", "search", "recommendations-engine"] as const;
/** 1.2 seconds ending between two minutes, ticked in sub-second steps; and the window's hours. */
const SECONDS: [number, number] = [START + 338.99 * MINUTE, START + 339.01 * MINUTE];
const HOURS: [number, number] = [START, START + 359 * MINUTE];
const WIDTH = 700;
const HEIGHT = 420;
const OFFSET = 28;

const options = (view: [number, number], renderer: "svg" | "canvas"): ChartOptions => ({
  animation: false,
  legend: false,
  renderer,
  timeZone: "UTC",
  // At 1.2 seconds, ticks every 200 ms, as given, so the last stands at the
  // view's end and overhangs the plot; automatic ones there would take an
  // interval their labels fit, its last tick before the end.
  x: { domain: view, ...(view === SECONDS && { ticks: { every: "200 milliseconds" } }) },
  y: { domain: [0, 1000] },
  marks: [
    line(metrics, {
      x: "time",
      y: [...NAMES],
      labels: { at: "view-end", place: { outside: true, offset: OFFSET }, leader: true },
    }),
  ],
});

const charts: Chart[] = [];
afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
});

async function mount(config: ChartOptions): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${WIDTH}px;height:${HEIGHT}px`;
  document.body.append(host);
  const chart = createChart(host, config);
  charts.push(chart);
  await chart.loading;
  chart.render();
  return chart;
}

const sceneOf = (chart: Chart): Scene =>
  (chart as unknown as ExportsScene)[EXPORT_SCENE]((scene) => scene);
const namesOf = (scene: Scene): TextItem[] =>
  scene.panels[0]!.marks.filter((g): g is LabelsGeometry => g.kind === "labels").flatMap((g) => [
    ...g.items,
  ]);

contractTest(
  "labels.attach.column.live",
  async () => {
    const measure = measurer(document);
    for (const renderer of ["svg", "canvas"] as const) {
      const plots = [];
      for (const view of [SECONDS, HOURS]) {
        const config = options(view, renderer);
        const chart = await mount(config);
        const scene = sceneOf(chart);
        const { plot } = scene.panels[0]!;
        plots.push([plot.x, plot.width]);
        const right = plot.x + plot.width;
        // Each name GAP + OFFSET past the plot.
        const names = namesOf(scene);
        expect(names.map(({ text }) => text).sort()).toEqual([...NAMES].sort());
        for (const name of names) expect(name.x).toBeCloseTo(right + GAP + OFFSET, 6);
        if (view === SECONDS) {
          // The last tick label, as the browser measures it, past the plot
          // and inside the chart, the plot as wide as at the hours view.
          // (How far it reaches under the names depends on the page's
          // fonts; the unit tests place it with a fixed measurer.)
          const bottom = scene.panels[0]!.axes.find(({ side }) => side === "bottom")!;
          const last = bottom.items
            .filter((item): item is TextItem => item.type === "text")
            .at(-1)!;
          expect(last.text).toBe("05:39:00.600");
          const end = last.x + measure(last.text, last.paint.css) / 2;
          expect(end).toBeGreaterThan(right);
          expect(end).toBeLessThanOrEqual(WIDTH - 2 + 0.5);
          if (renderer === "svg") {
            // As the page draws it.
            const host = chart.root.getBoundingClientRect();
            const drawn = [...chart.root.querySelectorAll("text")].find(
              (text) => text.textContent === "05:39:00.600",
            )!;
            const box = drawn.getBoundingClientRect();
            expect(box.right - host.left).toBeGreaterThan(right);
            expect(box.right - host.left).toBeLessThanOrEqual(WIDTH);
            // Firefox's boxes take in the names' halo, so the names' drawn x
            // is checked, and their boxes only for standing past the plot.
            for (const name of NAMES) {
              const text = [...chart.root.querySelectorAll("text")].find(
                (t) => t.textContent === name,
              )!;
              expect(Number(text.getAttribute("x"))).toBeCloseTo(right + GAP + OFFSET, 6);
              expect(text.getBoundingClientRect().left - host.left).toBeGreaterThan(right + GAP);
            }
          }
          // Static SVG, measured as the browser measures, draws the chart.
          // (PDF lays out with its own fonts' metrics: see the unit tests.)
          const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
          const sized = { ...config, width: WIDTH, height: HEIGHT };
          expect(svg(renderToSVG(sized, { measureText: measure }))).toBe(svg(chart.toSVG()));
        }
      }
      // The plot keeps its width at both views.
      expect(plots[0]).toEqual(plots[1]);
    }
  },
  "stands its offset past the plot at every zoom, the overhanging end label under it, live and in static SVG",
);
