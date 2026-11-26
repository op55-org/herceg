// A room for the outside label column in a browser, with its fonts: names
// in a room of 64 px keep the plot where it is whatever they measure, from
// the first frame and as names stream in; those wider than the room are
// shortened to it as the browser measures them, in SVG and Canvas alike;
// and static SVG, measured as the browser measures, draws what the live
// chart draws.
import { afterEach, expect } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { line } from "../../src/marks/line.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { LabelsGeometry, Scene, TextItem } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";

const MINUTE = 60_000;
const minutes = Float64Array.from({ length: 30 }, (_, k) => k * MINUTE);
const wave = (s: number) => Float64Array.from(minutes, (_, k) => 100 + s * 200 + 20 * Math.sin(k));
const NAMES = ["auth", "payments", "recommendations-engine"] as const;
const metrics = table({
  time: time(minutes),
  auth: wave(0),
  payments: wave(1),
  "recommendations-engine": wave(2),
});
const WIDTH = 700;
const HEIGHT = 360;
const ROOM = 64;
const OFFSET = 8;
/** A1's names: beside the plot, 8 px out, with leaders, in a room of 64 px. */
const LABELS = {
  at: "visible-end",
  place: { outside: true, offset: OFFSET, room: ROOM },
  leader: true,
} as const;
/** Where the plot ends: the room, its offset, 12 px to the track and 8 px edge. */
const RIGHT = WIDTH - 8 - 12 - OFFSET - ROOM;

const options = (
  renderer: "svg" | "canvas",
  names: readonly (typeof NAMES)[number][] = NAMES,
): ChartOptions => ({
  animation: false,
  legend: false,
  renderer,
  timeZone: "UTC",
  y: { domain: [0, 600] },
  marks: [line(metrics, { x: "time", y: [...names], labels: LABELS })],
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
const rightOf = (scene: Scene) => {
  const { plot } = scene.panels[0]!;
  return plot.x + plot.width;
};

contractTest(
  "labels.attach.room.live",
  async () => {
    const measure = measurer(document);
    for (const renderer of ["svg", "canvas"] as const) {
      // The plot ends where the room says, with any names or none.
      for (const names of [NAMES, ["auth"], ["recommendations-engine"], []] as const) {
        const scene = sceneOf(await mount(options(renderer, names)));
        expect(rightOf(scene)).toBe(RIGHT);
      }
      const chart = await mount(options(renderer));
      const scene = sceneOf(chart);
      const names = namesOf(scene);
      expect(names.map(({ text }) => text).slice(0, 2)).toEqual(["auth", "payments"]);
      const cut = names[2]!;
      // Shortened to the room as the browser measures it: the most of the
      // name that fits, its halo past its end in the room too.
      expect(cut.text).toMatch(/^recomm.*…$/);
      const reach = (cut.halo?.width ?? 0) / 2;
      const kept = Array.from(cut.text).length - 1;
      expect(measure(cut.text, cut.paint.css) + reach).toBeLessThanOrEqual(ROOM);
      expect(
        measure(`${"recommendations-engine".slice(0, kept + 1)}…`, cut.paint.css) + reach,
      ).toBeGreaterThan(ROOM);
      for (const name of names) expect(name.x).toBe(RIGHT + 6 + OFFSET);
      // The page draws the shortened name, and names the series whole.
      if (renderer === "svg") {
        const texts = [...chart.root.querySelectorAll("text")].map((t) => t.textContent);
        expect(texts).toContain(cut.text);
        expect(texts).not.toContain("recommendations-engine");
      }
      chart.setHiddenKeys(["recommendations-engine"]);
      chart.render();
      expect(rightOf(sceneOf(chart))).toBe(RIGHT);
    }
  },
  "keeps the plot where the room says with any names, shortened as the browser measures, in SVG and Canvas",
);

contractTest(
  "labels.attach.room.export.live",
  async () => {
    const measure = measurer(document);
    // Names stream in: the plot holds still, live and in static SVG.
    const live = table({ time: time([0, MINUTE]), ms: [100, 200], service: ["api", "db"] });
    const streamed: ChartOptions = {
      animation: false,
      legend: false,
      renderer: "svg",
      timeZone: "UTC",
      y: { domain: [0, 600] },
      marks: [line(live, { x: "time", y: "ms", series: "service", labels: LABELS })],
    };
    const chart = await mount(streamed);
    const services = ["api", "a-much-longer-service-name", "db", "x", "queue-workers-eu-west"];
    const rights = new Set<number>();
    for (let k = 2; k < 24; k++) {
      live.append({
        time: [k * MINUTE],
        ms: [100 + (k % 5) * 50],
        service: [services[k % services.length]!],
      });
      if (k > 8) live.dropFirst(1);
      chart.render();
      rights.add(rightOf(sceneOf(chart)));
    }
    expect([...rights]).toEqual([RIGHT]);
    // Static SVG draws the chart, shortened names and all, in both renderers'
    // scenes alike.
    const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
    const sized = { ...options("svg"), width: WIDTH, height: HEIGHT };
    const drawn = await mount(options("svg"));
    expect(svg(renderToSVG(sized, { measureText: measure }))).toBe(svg(drawn.toSVG()));
    const painted = await mount(options("canvas"));
    expect(namesOf(sceneOf(painted))).toEqual(namesOf(sceneOf(drawn)));
    expect(svg(painted.toSVG())).toBe(svg(drawn.toSVG()));
  },
  "holds the plot still as names stream in; static SVG draws the live chart's shortened names",
);
