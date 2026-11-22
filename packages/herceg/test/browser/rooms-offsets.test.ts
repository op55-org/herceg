// Bars' labels at their offset and legends in their rooms in a browser,
// with its fonts: live SVG and Canvas draw the same scene, and static SVG
// measured as the browser measures draws what the live chart draws.
import { afterEach, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { measurer } from "../../src/dom/measurers.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { EXPORT_SCENE, type ExportsScene } from "../../src/render/export-scene.ts";
import { renderToSVG } from "../../src/render/static.ts";
import {
  guidesOf,
  type LegendGuide,
  type RectGeometry,
  type Scene,
  type TextGeometry,
} from "../../src/scene/scene.ts";
import type { Side } from "../../src/spec/place.ts";
import { cssFont } from "../../src/style/style.ts";
import { LIGHT } from "../../src/theme.ts";
import { contractTest } from "../helpers/contracts.ts";

const WIDTH = 600;
const HEIGHT = 360;

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
/** Static SVG as the live chart's, but for generated ids. */
const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");

const brands = table({
  brand: ["Apple", "Google", "Amazon", "Microsoft"],
  value: [120, 95, -40, 8],
});

contractTest(
  "bar.labels.offset.export",
  async () => {
    const measure = measurer(document);
    for (const place of [{ offset: 10 }, { outside: false, offset: 6 }] as const) {
      const config = (renderer: "svg" | "canvas"): ChartOptions => ({
        animation: false,
        renderer,
        x: { domain: [-80, 200] },
        marks: [bar(brands, { x: "value", y: "brand", labels: { place } })],
      });
      const live = await mount(config("svg"));
      const canvas = await mount(config("canvas"));
      const scene = sceneOf(live);
      // Each label's near edge `offset` from its bar's end: past it, or inside it.
      const font = cssFont(LIGHT.font, LIGHT.fontSize);
      const [bars] = scene.panels[0]!.marks.filter((g): g is RectGeometry => g.kind === "rect");
      const groups = scene.panels[0]!.marks.filter((g): g is TextGeometry => g.kind === "text");
      const values = [120, 95, -40, 8];
      let checked = 0;
      for (const labels of groups)
        labels.labels.forEach((text, i) => {
          const k = values.indexOf(Number(text.replace("−", "-")));
          const [left, , length] = bars!.rects.subarray(k * 4, k * 4 + 3);
          const forward = values[k]! >= 0;
          const end = forward ? left! + length! : left!;
          const width = measure(text, font);
          const x = labels.coords[i * 2]!;
          const [from, to] =
            labels.anchor === "start"
              ? [x, x + width]
              : labels.anchor === "end"
                ? [x - width, x]
                : [x - width / 2, x + width / 2];
          // Past the end, its near edge beyond it; inside, short of it.
          const gap =
            "outside" in place
              ? forward
                ? end - to
                : from - end
              : forward
                ? from - end
                : end - to;
          expect(gap, text).toBeCloseTo(place.offset, 3);
          checked++;
        });
      expect(checked).toBeGreaterThan(2);
      expect(
        JSON.stringify(sceneOf(canvas).panels[0]!.marks.filter((g) => g.kind === "text")),
      ).toBe(JSON.stringify(scene.panels[0]!.marks.filter((g) => g.kind === "text")));
      const sized = { ...config("svg"), width: WIDTH, height: HEIGHT };
      expect(svg(renderToSVG(sized, { measureText: measure }))).toBe(svg(live.toSVG()));
    }
  },
  "stand their offset from their bar's end, past it or inside it, live and in static SVG",
);

contractTest(
  "legend.room.export",
  async () => {
    const measure = measurer(document);
    const wide = table({ t: [0, 1, 2], North: [0, 1, 2], South: [1, 2, 3], East: [2, 3, 4] });
    const config = (side: Side, room?: number): ChartOptions => ({
      animation: false,
      padding: 0,
      legend: { place: { side }, columns: 1, ...(room !== undefined && { room }) },
      marks: [line(wide, { x: "t", y: ["North", "South", "East"] })],
    });
    const entries = (chart: Chart) =>
      (guidesOf(sceneOf(chart), "legend") as LegendGuide[]).flatMap((g) =>
        g.entries.map(({ x, y }) => [x, y]),
      );
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const measured = await mount(config(side));
      for (const room of [0, 200]) {
        const roomed = await mount(config(side, room));
        // Drawn whole where it stands without a room, the plots moved.
        expect(entries(roomed), `${side} ${room}`).toEqual(entries(measured));
        // The live legend's buttons stand where the scene draws its entries.
        const host = roomed.root.getBoundingClientRect();
        const buttons = [...roomed.root.querySelectorAll("button")].filter((b) =>
          ["North", "South", "East"].includes(b.textContent ?? ""),
        );
        expect(buttons).toHaveLength(3);
        for (const button of buttons) {
          const box = button.getBoundingClientRect();
          expect(box.top - host.top, `${side} ${room}`).toBeGreaterThanOrEqual(-1);
          expect(box.bottom - host.top, `${side} ${room}`).toBeLessThanOrEqual(HEIGHT + 1);
          expect(box.left - host.left, `${side} ${room}`).toBeGreaterThanOrEqual(-1);
          expect(box.right - host.left, `${side} ${room}`).toBeLessThanOrEqual(WIDTH + 1);
        }
        const sized = { ...config(side, room), width: WIDTH, height: HEIGHT };
        expect(svg(renderToSVG(sized, { measureText: measure }))).toBe(svg(roomed.toSVG()));
      }
    }
  },
  "stand whole at their side's edge in a room of 0 or deeper, live and in static SVG",
);
