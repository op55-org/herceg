// Automatic ticks fitting their labels in a browser, with its fonts: A6's
// sub-second view at 1100, 820, and 360 px keeps neighbouring x labels at
// least 4 px apart as the page measures them, in SVG and Canvas alike, and
// static SVG measured as the page measures draws the same axis.
import { afterEach, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { line } from "../../src/marks/line.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { chooseInterval } from "../../src/scale/time.ts";
import type { Scene, TextItem } from "../../src/scene/scene.ts";

const MINUTE = 60_000;
const START = Date.UTC(2026, 9, 1);
const minutes = Float64Array.from({ length: 360 }, (_, k) => START + k * MINUTE);
const NAMES = [
  "auth",
  "cart",
  "edge",
  "mail",
  "ledger",
  "search",
  "billing",
  "catalog",
  "checkout",
  "payments",
  "inventory",
  "scheduler",
  "analytics",
  "audit-log",
  "image-proxy",
  "geo-lookup",
  "rate-limiter",
  "session-store",
  "feature-flags",
  "order-history",
  "user-profiles",
  "export-worker",
  "webhook-relay",
  "pricing-engine",
  "fraud-detection",
  "shipping-quotes",
  "notification-hub",
  "media-transcoder",
  "search-autocomplete",
  "recommendations-engine",
];
const metrics = table({
  time: time(minutes),
  ...Object.fromEntries(
    NAMES.map((name, s) => [
      name,
      Float64Array.from(minutes, (_, k) => 440 + s * 4 + 6 * Math.sin(k / 25 + s)),
    ]),
  ),
});
/** 1.2 seconds ending between two minutes. */
const SECONDS: [number, number] = [START + 338.5 * MINUTE - 1200, START + 338.5 * MINUTE];

const options = (renderer: "svg" | "canvas"): ChartOptions => ({
  animation: false,
  renderer,
  timeZone: "UTC",
  legend: { place: { side: "top" } },
  x: { domain: SECONDS },
  y: { domain: [0, 1000] },
  marks: [
    line(metrics, {
      x: "time",
      y: NAMES as never,
      labels: { at: "view-end", place: { outside: true, offset: 28 }, leader: true },
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

async function mount(config: ChartOptions, width: number, height: number): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.append(host);
  const chart = createChart(host, config);
  charts.push(chart);
  await chart.loading;
  chart.render();
  return chart;
}

const sceneOf = (chart: Chart): Scene =>
  (chart as unknown as ExportsScene)[EXPORT_SCENE]((scene) => scene);

/** Pixels between neighbouring spans, in order. */
const gaps = (spans: (readonly [number, number])[]) =>
  spans
    .sort((a, b) => a[0] - b[0])
    .slice(1)
    .map((span, k) => span[0] - spans[k]![1]);

it("keeps A6's sub-second x labels 4 px apart at every size, live and in static SVG", async () => {
  const measure = measurer(document);
  for (const renderer of ["svg", "canvas"] as const)
    for (const [width, height] of [
      [1100, 720],
      [820, 640],
      [360, 300],
    ] as const) {
      const config = options(renderer);
      const chart = await mount(config, width, height);
      const scene = sceneOf(chart);
      const { plot } = scene.panels[0]!;
      const bottom = scene.panels[0]!.axes.find(({ side }) => side === "bottom")!;
      const labels = bottom.items.filter((item): item is TextItem => item.type === "text");
      const where = `${renderer} at ${width} px`;
      expect(labels.length, where).toBeGreaterThan(0);
      // As written, at their ticks, by the widths the page measures.
      const widths = labels.map(({ text, paint }) => measure(text, paint.css));
      for (const gap of gaps(labels.map(({ x }, k) => [x - widths[k]! / 2, x + widths[k]! / 2])))
        expect(gap, where).toBeGreaterThanOrEqual(4 - 1e-9);
      // Where the count's own interval would put labels closer, the axis steps wider.
      const count = Math.max(2, Math.round(plot.width / 100));
      const own = chooseInterval(1200, count).duration;
      const step = bottom.ticks.length > 1 ? bottom.ticks[1]!.value - bottom.ticks[0]!.value : 0;
      if ((plot.width * own) / 1200 < Math.max(...widths) + 4)
        expect(step === 0 || step > own, where).toBe(true);
      if (renderer === "svg") {
        // As the page paints them, within the 2 px of hinted advances.
        const host = chart.root.getBoundingClientRect();
        const texts = [...chart.root.querySelectorAll("text")].filter((text) =>
          labels.some(({ text: label }) => label === text.textContent),
        );
        const painted = texts.map((text) => {
          const box = text.getBoundingClientRect();
          return [box.left - host.left, box.right - host.left] as const;
        });
        for (const gap of gaps(painted)) expect(gap, where).toBeGreaterThanOrEqual(2);
      }
      // Static SVG, measured as the browser measures, draws the chart.
      const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
      expect(svg(renderToSVG({ ...config, width, height }, { measureText: measure })), where).toBe(
        svg(chart.toSVG()),
      );
      chart.destroy();
      chart.root.parentElement?.remove();
      charts.splice(charts.indexOf(chart), 1);
    }
});
