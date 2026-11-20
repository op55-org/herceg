// Axes' room and the short forms' place in a browser: the guide compiler
// loads only for them, a horizon chart's strips sit under a short form's
// axis on top exactly, and a bar race's value axis on top moves with it,
// keeping its plot's width where its end labels are left out.
import "./interactive.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { SvgLayer } from "../../src/dom/svg-layer.ts";
import { axis } from "../../src/guides/options.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { facet } from "../../src/model/facet.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { renderToSVG } from "../../src/render/static.ts";
import type { AxisGuide, Scene } from "../../src/scene/scene.ts";
import { contractTest } from "../helpers/contracts.ts";
import { modelOf } from "./helpers.ts";

// The guide compiler as it is, counting the charts that make one.
const compilers = vi.hoisted(() => ({ made: 0 }));
vi.mock("../../src/guides/compile.ts", async (original) => {
  const real = await original<typeof import("../../src/guides/compile.ts")>();
  return {
    ...real,
    guideCompiler: (...args: Parameters<typeof real.guideCompiler>) => {
      compilers.made++;
      return real.guideCompiler(...args);
    },
  };
});

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

/** A chart in a container of its own, drawn once what it loads has loaded. */
async function mount(options: ChartOptions, width = 600, height = 300): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.append(host);
  const chart = createChart(host, options);
  charts.push(chart);
  await chart.loading;
  chart.render();
  return chart;
}

const series = table({ t: [0, 25, 50, 75, 100], v: [3, 5, 4, 6, 5] });

describe("the guide compiler", () => {
  it("loads for a room or a short form's place, and not for the short forms' other settings", async () => {
    const made = compilers.made;
    for (const options of [
      {},
      { x: { title: "Time", domain: [0, 100], nice: false, ticks: 5 } },
      { y: { title: "Load", format: { maximumFractionDigits: 1 }, zero: true, grid: false } },
      { x: { show: false }, y: { show: false } },
    ] as const) {
      const chart = await mount({ marks: [line(series, { x: "t", y: "v" })], ...options });
      await frame();
      await chart.loading;
      expect(chart.toSVG()).toContain("<svg");
    }
    expect(compilers.made).toBe(made);
    const roomed = await mount({ marks: [line(series, { x: "t", y: "v" })], x: { room: 30 } });
    expect(compilers.made).toBeGreaterThan(made);
    const { plot } = modelOf(roomed).panels()[0]!;
    // 2 px of the chart's own padding under the room.
    expect(plot.y + plot.height).toBe(300 - 2 - 30);
  });
});

describe("short forms' place and room", () => {
  it("put a horizon chart's twenty strips under an axis on top in 30 px, a pixel apart", async () => {
    // B4: one chart of twenty 25 px strips and their time axis above them.
    const locations = Array.from({ length: 20 }, (_, i) => `site ${i}`);
    const hours = Array.from({ length: 49 }, (_, i) => i);
    const rows = table({
      location: locations.flatMap((name) => hours.map(() => name)),
      hour: locations.flatMap(() => hours),
      band: locations.flatMap((_, k) => hours.map((h) => Math.abs(Math.sin(h / 7 + k)))),
    });
    const options = (axes: Pick<ChartOptions, "x" | "guides">): ChartOptions => ({
      legend: false,
      padding: { top: 0, right: 0, bottom: 1, left: 0 },
      facet: facet("location", { columns: 1, header: false, gap: 1 }),
      y: { domain: [0, 1], nice: false, show: false, grid: false },
      marks: [area(rows, { x: "hour", y: "band", line: false })],
      ...axes,
    });
    const height = 30 + 20 * 26;
    const short = await mount(
      options({ x: { domain: [0, 48], nice: false, place: { side: "top" }, room: 30 } }),
      600,
      height,
    );
    const plots = modelOf(short)
      .panels()
      .map(({ plot }) => plot);
    expect(plots).toHaveLength(20);
    plots.forEach((plot, k) => {
      expect(plot.y).toBe(30 + 26 * k);
      expect(plot.height).toBe(25);
    });
    // The labels are drawn within the room, above the first strip.
    const labels = [...short.root.querySelectorAll("svg text")].filter((text) =>
      /^\d+$/.test(text.textContent ?? ""),
    );
    expect(labels.length).toBeGreaterThan(2);
    const top = short.root.getBoundingClientRect().top;
    for (const label of labels) {
      const box = label.getBoundingClientRect();
      expect(box.top - top).toBeGreaterThanOrEqual(-0.5);
      expect(box.bottom - top).toBeLessThanOrEqual(30.5);
    }
    // As the axis guide the short form stands for.
    const guide = await mount(
      options({
        x: { domain: [0, 48], nice: false },
        guides: [axis({ scale: "x", place: { side: "top" }, room: 30 })],
      }),
      600,
      height,
    );
    const svg = (chart: Chart) => chart.toSVG().replace(/herceg-\d+/g, "");
    expect(svg(short)).toBe(svg(guide));
  });

  it("move a bar race's value axis on top with the bars", async () => {
    // B6: the value axis above the bars, from the short form, moving as values change.
    /** Every scene `chart` draws from now on. */
    const drawn = (chart: Chart): Scene[] => {
      const scenes: Scene[] = [];
      const render = SvgLayer.prototype.render;
      vi.spyOn(SvgLayer.prototype, "render").mockImplementation(function (this: SvgLayer, ...args) {
        if (chart.root.contains(this.svg)) scenes.push(args[0]);
        return render.apply(this, args);
      });
      return scenes;
    };
    const data = table({ brand: ["a", "b", "c"], value: [100, 80, 60] });
    const chart = await mount({
      animation: { values: true, duration: 250 },
      marks: [bar(data, { itemKey: "brand", orient: "y", x: "value", y: "brand" })],
      x: { place: { side: "top" } },
      // Room for the end label as it widens, as B6's margin keeps: a plot that
      // moves would show the change at once.
      padding: { top: 0, right: 40, bottom: 0, left: 0 },
    });
    const ticksOf = (scene: Scene) => {
      const axes = scene.panels[0]!.axes;
      expect(axes.map(({ side }) => side).sort()).toEqual(["left", "top"]);
      const top = axes.find(({ side }) => side === "top") as AxisGuide;
      return top.ticks.map(({ label, position }) => `${label}@${position.toFixed(1)}`);
    };
    // Frames and the clock are the test's from here on.
    await frame();
    await frame();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    chart.render();
    chart.root.dispatchEvent(new PointerEvent("pointerleave"));
    vi.advanceTimersByTime(16);
    const scenes = drawn(chart);
    chart.render();
    const before = ticksOf(scenes.at(-1)!);
    data.set("value", 0, 260);
    vi.advanceTimersByTime(16);
    vi.advanceTimersByTime(110);
    const middle = ticksOf(scenes.at(-1)!);
    vi.advanceTimersByTime(400);
    const after = ticksOf(scenes.at(-1)!);
    expect(after).not.toEqual(before);
    // Half way, its ticks are neither where they were nor where they end.
    expect(middle).not.toEqual(before);
    expect(middle).not.toEqual(after);
  });
});

describe("end labels", () => {
  /** Bars of a race: brands' values, by rank. */
  const ranked = (values: number[]) =>
    table({
      brand: values.map((_, i) => `brand ${i}`),
      value: values,
      rank: values.map((_, i) => i),
    });
  /** A bar race's chart as B6 draws it: its value axis on top in 16 px, without line or tick marks. */
  const race = (data: ReturnType<typeof ranked>, ends?: "room" | "hide"): ChartOptions => ({
    animation: { values: true, duration: 250, easing: "linear" },
    padding: { top: 0, right: 6, bottom: 0, left: 0 },
    legend: false,
    marks: [bar(data, { itemKey: "brand", orient: "y", x: "value", y: "rank" })],
    x: { nice: false },
    y: { domain: [11.5, -0.5], show: false, grid: false },
    guides: [
      axis({
        scale: "x",
        place: { side: "top" },
        room: 16,
        line: false,
        tick: false,
        labels: { gap: 0, ...(ends && { ends }) },
        style: { tickLabel: { font: "sans-serif", fontSize: 10 } },
      }),
    ],
  });
  /** The lead's value at each keyframe of a race: rising unevenly, as a race's leader does. */
  const leads = Array.from({ length: 120 }, (_, k) => Math.round(900 * 1.035 ** k + 211 * (k % 9)));

  contractTest(
    "axis.tick-labels.ends.race",
    async () => {
      for (const ends of ["room", "hide"] as const) {
        const data = ranked([leads[0]!]);
        const chart = await mount(race(data, ends), 928, 598);
        const widths = new Set<number>();
        for (const lead of leads) {
          data.reset({ brand: ["brand 0"], value: [lead], rank: [0] });
          chart.render();
          widths.add(chart.getPanels()[0]!.plot.width);
        }
        if (ends === "room") expect(widths.size).toBeGreaterThan(1);
        else expect([...widths]).toEqual([922]);
      }
    },
    "keep a race's plot width across its keyframes, where room narrows it for good",
  );

  contractTest(
    "axis.tick-labels.ends.transitions",
    async () => {
      const data = ranked([3300, 1000]);
      const chart = await mount(race(data, "hide"), 600, 300);
      const scenes: Scene[] = [];
      const render = SvgLayer.prototype.render;
      vi.spyOn(SvgLayer.prototype, "render").mockImplementation(function (this: SvgLayer, ...args) {
        if (chart.root.contains(this.svg)) scenes.push(args[0]);
        return render.apply(this, args);
      });
      const top = (scene: Scene) => scene.panels[0]!.axes.find(({ side }) => side === "top")!;
      const ticks = (scene: Scene) =>
        top(scene).ticks.map(({ label, position }) => `${label}@${position.toFixed(1)}`);
      await frame();
      await frame();
      vi.useFakeTimers({
        toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
      });
      chart.render();
      chart.root.dispatchEvent(new PointerEvent("pointerleave"));
      vi.advanceTimersByTime(16);
      const before = ticks(scenes.at(-1)!);
      // At 4,000 the last label stands at the chart's right edge.
      data.set("value", 0, 4000);
      vi.advanceTimersByTime(16);
      vi.advanceTimersByTime(110);
      const middle = scenes.at(-1)!;
      vi.advanceTimersByTime(400);
      const after = scenes.at(-1)!;
      expect(ticks(middle)).not.toEqual(before);
      expect(ticks(middle)).not.toEqual(ticks(after));
      expect(top(after).ticks.at(-1)!.label).toBe("");
      for (const scene of [middle, after]) {
        expect(scene.panels[0]!.plot.width).toBe(594);
        for (const { box } of top(scene).labelBoxes ?? []) {
          expect(box.x).toBeGreaterThanOrEqual(-0.5);
          expect(box.x + box.width).toBeLessThanOrEqual(594.5);
        }
      }
    },
    "play a race's transitions with its end labels left out, inside the chart",
  );

  contractTest(
    "axis.tick-labels.ends.export",
    async () => {
      const data = ranked([4000, 1000]);
      const options = { ...race(data, "hide"), animation: false } as ChartOptions;
      const chart = await mount(options, 600, 300);
      const live = chart.toSVG();
      expect(live).not.toMatch(/>0<\/text>/);
      expect(live).not.toMatch(/>4,000<\/text>/);
      expect(live).toMatch(/>2,000<\/text>/);
      // Ids apart: a chart's export names its own.
      const svg = (text: string) => text.replace(/herceg-(svg-)?\d+-(export-)?/g, "");
      expect(svg(renderToSVG({ ...options, width: 600, height: 300 }))).toBe(svg(live));
      expect(renderToPDF({ ...options, width: 600, height: 300 })).toEqual(renderToPDF(chart));
    },
    "draw static SVG and PDF as the live chart leaves its end labels out",
  );
});
