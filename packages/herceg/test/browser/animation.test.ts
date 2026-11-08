import "./interactive.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { InputEvent, ItemTarget } from "../../src/dom/events.ts";
import { SvgLayer } from "../../src/dom/svg-layer.ts";
import { sectorsOf } from "../../src/dom/value-sectors.ts";
import { ValueAnimation } from "../../src/dom/value-transition.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { candlestick } from "../../src/marks/candlestick.ts";
import { custom } from "../../src/marks/custom.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { graph } from "../../src/marks/graph.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { tablesOf } from "../../src/marks/layout-mark.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { rug } from "../../src/marks/rug.ts";
import { rule } from "../../src/marks/rule.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { text } from "../../src/marks/text.ts";
import { facet } from "../../src/model/facet.ts";
import { panels } from "../../src/model/panels.ts";
import type { ArcGeometry, RectGeometry, Scene, TextGeometry } from "../../src/scene/scene.ts";
import type { ChartError } from "../../src/spec/errors.ts";
import { collectGarbage, MOUSE, modelOf } from "./helpers.ts";

const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
  // The shared scheduler waits for a frame it asked for; let it run.
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function data() {
  const t = Float64Array.from({ length: 101 }, (_, i) => i * 1000);
  return table({ t, v: Float64Array.from(t, (x) => Math.sin(x / 9000) * 10 + x / 4000) });
}

/** A chart in a container of its own, at the top of the page so that it is on screen. */
async function mount(options: Partial<ChartOptions>): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
  document.body.append(host);
  const chart = createChart(host, {
    animation: { duration: 300 },
    marks: [line(data(), { x: "t", y: "v" })],
    ...options,
  });
  charts.push(chart);
  // Animation code loads with the chart.
  await chart.loading;
  chart.render();
  return chart;
}

/**
 * Frames and the clock from here on are the test's: time moves only with
 * `tick`, so frames take no time and transitions never fall back for speed.
 */
async function controlTime() {
  // Frames already asked for run first, on the real clock.
  await frame();
  await frame();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  // Frame times measured on the real clock are forgotten.
  for (const chart of charts) {
    chart.render();
    // Asks for a frame without changing anything, so the scheduler runs one.
    chart.root.dispatchEvent(new PointerEvent("pointerleave"));
  }
  tick(16);
}
const tick = (ms: number) => vi.advanceTimersByTime(ms);

const x = (chart: Chart) => [...modelOf(chart).panels()[0]!.x.domain];
const y = (chart: Chart) => [...modelOf(chart).panels()[0]!.y.domain];
const plot = (chart: Chart) => ({ ...modelOf(chart).panels()[0]!.plot });
const between = (value: number, a: number, b: number) =>
  value > Math.min(a, b) && value < Math.max(a, b);

describe("view transitions", () => {
  it("move the axes to a viewport asked for, which they report at once", async () => {
    const chart = await mount({});
    await controlTime();
    const viewports: unknown[] = [];
    chart.on("viewport", ({ views }) => viewports.push(views[0]!.x));
    const [lo, hi] = x(chart) as [number, number];
    chart.setViewport([20_000, 40_000]);
    expect(chart.getViewport().x).toEqual([20_000, 40_000]);
    expect(viewports).toEqual([[20_000, 40_000]]);
    tick(50);
    const [a, b] = x(chart) as [number, number];
    expect(between(a, lo, 20_000)).toBe(true);
    expect(between(b, 40_000, hi)).toBe(true);
    // Asked for again mid-way, it moves on from where it is.
    chart.setViewport([50_000, 60_000]);
    tick(20);
    expect(between(x(chart)[0]!, a, 50_000)).toBe(true);
    tick(400);
    expect(x(chart)).toEqual([50_000, 60_000]);
    expect(viewports).toHaveLength(2);
  });

  it("end at the axes and plot a chart without animation shows", async () => {
    // Values that grow by four orders of magnitude pass wide tick labels.
    const t = Float64Array.from({ length: 101 }, (_, i) => i * 1000);
    const steep = table({ t, v: Float64Array.from(t, (x) => (x < 50_000 ? x / 1000 : x * 20)) });
    const marks = () => [line(steep, { x: "t", y: "v" })];
    const moving = await mount({ marks: marks() });
    const still = await mount({ marks: marks(), animation: false });
    await controlTime();
    for (const chart of [moving, still]) chart.setViewport([0, 40_000]);
    tick(400);
    for (const chart of [moving, still]) chart.setViewport(null);
    tick(16);
    expect(x(moving)).not.toEqual(x(still));
    expect(y(moving)).not.toEqual(y(still));
    tick(400);
    expect(x(moving)).toEqual(x(still));
    expect(y(moving)).toEqual(y(still));
    expect(plot(moving)).toEqual(plot(still));
    moving.setViewport({ y: [0, 5] });
    tick(16);
    expect(y(moving)).not.toEqual([0, 5]);
    tick(400);
    expect(y(moving)).toEqual([0, 5]);
  });

  it("move both axes of one change together, reported once", async () => {
    const chart = await mount({});
    await controlTime();
    const viewports: unknown[] = [];
    chart.on("viewport", ({ views }) => viewports.push(views[0]));
    chart.setViewport({ x: [20_000, 40_000], y: [0, 5] });
    expect(viewports).toMatchObject([{ x: [20_000, 40_000], y: [0, 5], yRight: null }]);
    tick(50);
    // Both axes are on their way: the y change did not end the x one.
    expect(x(chart)).not.toEqual([20_000, 40_000]);
    expect(y(chart)).not.toEqual([0, 5]);
    tick(400);
    expect([x(chart), y(chart)]).toEqual([
      [20_000, 40_000],
      [0, 5],
    ]);
  });

  it("show the view asked for after leaving the screen", async () => {
    const chart = await mount({ animation: { duration: 1000 } });
    await controlTime();
    chart.setViewport([20_000, 40_000]);
    tick(100);
    const host = chart.root.parentElement!;
    // Visibility arrives from an IntersectionObserver, on the real clock.
    const observed = () => new Promise((resolve) => setTimeout(resolve, 100));
    host.style.top = "-2000px";
    await observed();
    host.style.top = "0px";
    await observed();
    tick(16);
    expect(x(chart)).toEqual([20_000, 40_000]);
  });

  it("jump to the view for new data, export, gestures, and drags", async () => {
    const chart = await mount({ interaction: { zoom: true } });
    await controlTime();
    chart.setViewport([20_000, 40_000]);
    tick(16);
    expect(x(chart)).not.toEqual([20_000, 40_000]);
    // Appended rows show at once, at the view asked for.
    tablesOf(modelOf(chart).config.marks[0]!)[0]!.append({ t: [101_000], v: [1] });
    tick(16);
    expect(x(chart)).toEqual([20_000, 40_000]);

    chart.setViewport([10_000, 30_000]);
    chart.toSVG();
    expect(x(chart)).toEqual([10_000, 30_000]);

    chart.setViewport([0, 50_000]);
    tick(16);
    const rect = chart.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      clientX: rect.left + 300,
      clientY: rect.top + 150,
      pointerId: MOUSE,
    };
    chart.root.dispatchEvent(new PointerEvent("pointerdown", { ...at, button: 0 }));
    expect(x(chart)).toEqual([0, 50_000]);
    chart.root.dispatchEvent(new PointerEvent("pointerup", at));

    chart.setViewport([20_000, 40_000]);
    tick(16);
    chart.root.dispatchEvent(
      new WheelEvent("wheel", {
        ctrlKey: true,
        ...at,
        deltaY: -100,
        cancelable: true,
      }),
    );
    tick(16);
    // The wheel zooms from the view on screen, and shows its zoom at once.
    expect(x(chart)).toEqual([...chart.getViewport().x!]);
    tick(400);
  });

  it("end when a viewport listener draws or links the chart", async () => {
    const chart = await mount({});
    await controlTime();
    const stop = chart.on("viewport", () => chart.render());
    chart.setViewport([20_000, 40_000]);
    tick(16);
    expect(x(chart)).toEqual([20_000, 40_000]);
    stop();
    const unlink = chart.on("viewport", () => chart.update({ interaction: { sync: "group" } }));
    chart.setViewport([10_000, 30_000]);
    tick(16);
    expect(x(chart)).toEqual([10_000, 30_000]);
    unlink();
  });

  it("zoom to a brush and reset by double click gradually", async () => {
    const chart = await mount({ interaction: { zoom: true, brush: "x" } });
    await controlTime();
    const [lo, hi] = x(chart) as [number, number];
    const scale = modelOf(chart).panels()[0]!.x;
    const rect = chart.root.getBoundingClientRect();
    for (const [type, value] of [
      ["pointerdown", 30_000],
      ["pointermove", 40_000],
      ["pointerup", 50_000],
    ] as const) {
      const clientX = rect.left + scale.map(value);
      const init = { bubbles: true, clientX, clientY: rect.top + 150, pointerId: MOUSE };
      chart.root.dispatchEvent(new PointerEvent(type, { ...init, button: 0 }));
    }
    const [from, to] = chart.getViewport().x!;
    expect(from).toBeCloseTo(30_000, -2);
    expect(to).toBeCloseTo(50_000, -2);
    tick(50);
    expect(between(x(chart)[0]!, lo, from)).toBe(true);
    tick(400);
    expect(x(chart)).toEqual([from, to]);
    chart.root.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(chart.getViewport().x).toBeNull();
    tick(50);
    expect(between(x(chart)[0]!, lo, from)).toBe(true);
    tick(400);
    expect(x(chart)).toEqual([lo, hi]);
  });

  it("move a map's and a network's plane to a view asked for, reported at once", async () => {
    const links = table({ source: ["a", "b", "a"], target: ["b", "c", "c"] });
    const nodes = table({ node: ["a", "b", "c"] });
    const places = table({ lon: [0, 10, 20], lat: [0, 10, 5] });
    for (const marks of [
      [graph(links, { source: "source", target: "target", nodes, node: "node" })],
      [geopoint(places, { longitude: "lon", latitude: "lat" })],
    ]) {
      const moving = await mount({ marks });
      const still = await mount({ marks, animation: false });
      await controlTime();
      // What the chart draws, without the ids that tell charts apart.
      const drawn = (chart: Chart) =>
        [...chart.root.querySelectorAll("svg [data-kind]")]
          .map((e) => e.outerHTML.replace(/herceg-\d+/g, ""))
          .join("");
      const before = drawn(moving);
      const viewports: unknown[] = [];
      moving.on("viewport", ({ views }) => viewports.push(views[0]));
      const view = { x: [0.2, 0.6], y: [0.2, 0.6] } as const;
      const [x0, y0] = [moving.getViewport().x, moving.getViewport().y];
      for (const chart of [moving, still]) {
        const { x, y } = chart.getViewport();
        chart.setViewport({ x: x ?? view.x, y: y ?? view.y });
      }
      expect(viewports).toHaveLength(1);
      expect([x0, y0]).toEqual([null, null]);
      tick(66);
      const end = drawn(still);
      expect(drawn(moving)).not.toBe(before);
      expect(drawn(moving)).not.toBe(end);
      tick(400);
      expect(drawn(moving)).toBe(drawn(still));
      expect(moving.getViewport()).toEqual(still.getViewport());
      for (const chart of charts.splice(0)) {
        const host = chart.root.parentElement;
        chart.destroy();
        host?.remove();
      }
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("load their code when a chart first asks for animation", async () => {
    const chart = await mount({ animation: false });
    expect(chart.loading).toBeUndefined();
    chart.update({ animation: true });
    expect(chart.loading).toBeInstanceOf(Promise);
    await chart.loading;
    expect(chart.loading).toBeUndefined();
    await controlTime();
    chart.setViewport([20_000, 40_000]);
    tick(16);
    expect(x(chart)).not.toEqual([20_000, 40_000]);
    expect(() => chart.update({ animation: { duration: Number.NaN }, errorMode: "throw" })).toThrow(
      "chart animation.duration: expected 0 or more ms",
    );
  });

  it("stay still where motion is reduced, charts are linked, or frames are slow", async () => {
    const linked = await mount({ interaction: { sync: "group" } });
    linked.setViewport([20_000, 40_000]);
    await frame();
    expect(x(linked)).toEqual([20_000, 40_000]);

    // A chart that takes longer to draw than a frame allows jumps.
    const busy = custom({
      draw() {
        const until = performance.now() + 12;
        while (performance.now() < until);
      },
    });
    const slow = await mount({ marks: [line(data(), { x: "t", y: "v" }), busy] });
    slow.setViewport([20_000, 40_000]);
    await frame();
    expect(x(slow)).toEqual([20_000, 40_000]);

    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    );
    const calm = await mount({});
    calm.setViewport([20_000, 40_000]);
    await frame();
    expect(x(calm)).toEqual([20_000, 40_000]);
  });
});

describe("value transitions", () => {
  const VALUES = { duration: 300, values: true } as const;
  const sales = () => table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
  /** A bar chart whose y axis stays put while its values change. */
  const bars = (data = sales(), animation: ChartOptions["animation"] = VALUES) =>
    mount({ animation, marks: [bar(data, { x: "region", y: "sales" })], y: { domain: [0, 40] } });
  const path = (chart: Chart, kind = "rect") =>
    chart.root.querySelector(`[data-kind="${kind}"]`)?.getAttribute("d") ?? "";
  const dataOf = (chart: Chart) => tablesOf(modelOf(chart).config.marks[0]!)[0]!;
  /** Changes the sales of a bar or pie chart's table, which every one of `charts` shows. */
  const change = (charts: Chart[], values: number[]) => {
    for (const data of new Set(charts.map(dataOf))) data.setColumn("sales", values);
  };

  it("move bars to new values, ending as a chart without animation draws them", async () => {
    const data = sales();
    const moving = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    const before = path(moving);
    change([moving], [30, 20, 10]);
    tick(16);
    const after = path(still);
    expect(after).not.toBe(before);
    // On its way: neither where it was nor where it goes.
    tick(50);
    expect(path(moving)).not.toBe(before);
    expect(path(moving)).not.toBe(after);
    tick(400);
    expect(path(moving)).toBe(after);
    // The model, tooltips, and summaries have the new values from the start.
    expect(chart(moving)).toEqual(chart(still));
  });

  it("keep a moving rule's label inside the plot on its way", async () => {
    const deploys = table({ at: [0.1] });
    const moving = await mount({
      animation: VALUES,
      marks: [line(data(), { x: "t", y: "v" }), rule(deploys, { x: "at", label: "deploy" })],
      x: { domain: [0, 100_000] },
    });
    await controlTime();
    const label = () =>
      [...moving.root.querySelectorAll("svg text")]
        .find((t) => t.textContent === "deploy")!
        .getBoundingClientRect();
    const { x: from, width } = plot(moving);
    const start = label().left;
    deploys.setColumn("at", [99_900]);
    const lefts: number[] = [];
    for (const ms of [16, 50, 100, 400]) {
      tick(ms);
      const { left, right } = label();
      lefts.push(left);
      // Its glyphs as engines measure them may reach a pixel or so past its box.
      expect(left).toBeGreaterThanOrEqual(from - 2);
      expect(right).toBeLessThanOrEqual(from + width + 2);
    }
    // On its way at 66 ms: neither where it was nor where it goes.
    expect(between(lefts[1]!, start, lefts[3]!)).toBe(true);
  });

  const chart = (chart: Chart) => ({
    plot: plot(chart),
    y: y(chart),
    svg: chart.toSVG().replace(/herceg-\d+/g, ""),
  });

  it("move to the first change's values, however long the chart's first frame took", async () => {
    // The first frame does one-time work (here, 15 ms more of it), which
    // says nothing of how long the change's frames take.
    let draws = 0;
    const render = SvgLayer.prototype.render;
    vi.spyOn(SvgLayer.prototype, "render").mockImplementation(function (this: SvgLayer, ...args) {
      if (draws++ === 0) {
        const until = performance.now() + 15;
        while (performance.now() < until);
      }
      return render.apply(this, args);
    });
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
    document.body.append(host);
    const moving = createChart(host, {
      animation: VALUES,
      marks: [bar(sales(), { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    charts.push(moving);
    await moving.ready;
    for (let loading = moving.loading; loading; loading = moving.loading) await loading;
    // Frames already asked for run first, on the real clock.
    await frame();
    await frame();
    // Its last frame is its first, drawn by the page's frame loop.
    expect(draws).toBe(1);
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    const before = path(moving);
    change([moving], [30, 20, 10]);
    tick(16);
    tick(50);
    // On its way.
    expect(path(moving)).not.toBe(before);
    const between = path(moving);
    tick(400);
    expect(path(moving)).not.toBe(between);
  });

  it("turn pie slices to new values", async () => {
    const data = sales();
    const marks = () => [pie(data, { category: "region", value: "sales", sort: "input" })];
    const moving = await mount({ animation: VALUES, marks: marks() });
    const still = await mount({ animation: false, marks: marks() });
    await controlTime();
    const before = path(moving, "arc");
    change([moving], [30, 20, 10]);
    tick(66);
    expect(path(moving, "arc")).not.toBe(before);
    expect(path(moving, "arc")).not.toBe(path(still, "arc"));
    tick(400);
    expect(path(moving, "arc")).toBe(path(still, "arc"));
  });

  /** The left axis' tick labels on screen. */
  const yLabels = (chart: Chart) =>
    [...chart.root.querySelectorAll('text[text-anchor="end"]')].map((text) => text.textContent);
  /** The grid lines on screen, drawn first in their panel's group. */
  const grid = (chart: Chart) =>
    chart.root.querySelector('svg [data-kind="grid"]')?.getAttribute("d") ?? "";

  it("move the axes with values, their ticks and grid lines between", async () => {
    const marks = (data: ReturnType<typeof sales>) => [bar(data, { x: "region", y: "sales" })];
    const data = sales();
    const moving = await mount({ animation: VALUES, marks: marks(data) });
    const still = await mount({ animation: false, marks: marks(data) });
    await controlTime();
    const before = { labels: yLabels(moving), grid: grid(moving) };
    expect(before.labels).toEqual(["0", "5", "10", "15", "20", "25", "30"]);
    change([moving], [10, 20, 45]);
    tick(16);
    // On their way: neither where they were nor where they go.
    tick(100);
    expect(yLabels(moving)).not.toEqual(before.labels);
    expect(yLabels(moving)).not.toEqual(yLabels(still));
    expect(grid(moving)).not.toBe(before.grid);
    expect(grid(moving)).not.toBe(grid(still));
    tick(400);
    expect(yLabels(moving)).toEqual(["0", "10", "20", "30", "40", "50"]);
    expect(chart(moving)).toEqual(chart(still));
  });

  it("move points and lines with their axes, ending as a chart without animation draws them", async () => {
    const data = table({ x: [1, 2, 3, 4], y: [10, 20, 30, 20] });
    const marks = () => [line(data, { x: "x", y: "y" }), point(data, { x: "x", y: "y" })];
    const moving = await mount({ animation: VALUES, marks: marks() });
    const still = await mount({ animation: false, marks: marks() });
    await controlTime();
    const before = [path(moving, "line"), path(moving, "point")];
    data.set("y", 3, 45);
    tick(66);
    const passing = [path(moving, "line"), path(moving, "point")];
    expect(passing[0]).not.toBe(before[0]);
    expect(passing[1]).not.toBe(before[1]);
    expect(passing).not.toEqual([path(still, "line"), path(still, "point")]);
    tick(400);
    expect(chart(moving)).toEqual(chart(still));
  });

  it("animate points across keyed resets in SVG and Canvas, settling before inspection", async () => {
    for (const renderer of ["svg", "canvas"] as const) {
      const data = table({ x: [1, 2, 3], y: [10, 20, 30], id: ["a", "b", "c"] });
      const marks = () => [point(data, { x: "x", y: "y", itemKey: "id" })];
      const moving = await mount({
        animation: VALUES,
        renderer,
        marks: marks(),
        x: { domain: [0, 4] },
        y: { domain: [0, 100] },
      });
      const still = await mount({
        animation: false,
        renderer,
        marks: marks(),
        x: { domain: [0, 4] },
        y: { domain: [0, 100] },
      });
      await controlTime();
      const animations: ValueAnimation[] = [];
      const start = ValueAnimation.prototype.start;
      const spy = vi.spyOn(ValueAnimation.prototype, "start").mockImplementation(function (
        this: ValueAnimation,
        ...args
      ) {
        animations.push(this);
        return start.apply(this, args);
      });
      data.reset({ x: [1, 2, 3], y: [60, 70, 50], id: ["c", "a", "d"] });
      tick(50);
      expect(animations.some((animation) => animation.playing)).toBe(true);
      moving.root.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 100 }),
      );
      expect(animations.every((animation) => !animation.playing)).toBe(true);
      expect(chart(moving)).toEqual(chart(still));
      spy.mockRestore();
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  for (const stack of [true, "fill", "center", "wiggle"] as const) {
    for (const curve of ["linear", "monotone"] as const) {
      it(`move ${stack} areas stacked by a series field together, their shared edges as one (${curve})`, async () => {
        const data = table({
          t: [0, 1, 2, 0, 2, 1],
          v: [10, 20, 15, 5, 5, 8],
          s: ["a", "a", "a", "b", "b", "c"],
        });
        const marks = () => [area(data, { x: "t", y: "v", series: "s", stack, curve })];
        const moving = await mount({ animation: VALUES, marks: marks(), y: { domain: [0, 80] } });
        const still = await mount({ animation: false, marks: marks(), y: { domain: [0, 80] } });
        await controlTime();
        const layers = (chart: Chart) =>
          [...chart.root.querySelectorAll('[data-kind="area"]')].map((p) => p.getAttribute("d"));
        const before = layers(moving);
        expect(before).toHaveLength(3);
        data.set("v", 1, 40);
        tick(66);
        const passing = layers(moving);
        // Every layer from the change up moves, none where it was or where it goes.
        for (const [i, d] of passing.entries()) {
          expect(d).not.toBe(before[i]);
          expect(d).not.toBe(layers(still)[i]);
        }
        tick(400);
        expect(chart(moving)).toEqual(chart(still));
      });
    }
  }

  it("show the new values and axes before the pointer reads them", async () => {
    const data = sales();
    const moving = await mount({
      animation: VALUES,
      marks: [bar(data, { x: "region", y: "sales" })],
    });
    await controlTime();
    change([moving], [10, 20, 45]);
    tick(50);
    const passing = yLabels(moving);
    const rect = moving.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      clientX: rect.left + 480,
      clientY: rect.top + 150,
      pointerId: MOUSE,
    };
    moving.root.dispatchEvent(new PointerEvent("pointermove", at));
    // Drawn at once: the axis is the new one, and the tooltip has the new value.
    expect(yLabels(moving)).not.toEqual(passing);
    expect(yLabels(moving)).toEqual(["0", "10", "20", "30", "40", "50"]);
    tick(16);
    expect(moving.root.textContent).toContain("45");
  });

  it("show appended rows, and changes that move the axes, at once", async () => {
    const data = table({ region: ["N", "S"], sales: [10, 20] });
    const appending = await bars(data);
    // An automatic domain moves with the values.
    const free = await mount({
      animation: VALUES,
      marks: [bar(sales(), { x: "region", y: "sales" })],
    });
    await controlTime();
    data.append({ region: ["E"], sales: [30] });
    change([free], [10, 20, 90]);
    const before = [path(appending), path(free)];
    tick(16);
    const shown = [path(appending), path(free)];
    expect(shown[0]).not.toBe(before[0]);
    expect(shown[1]).not.toBe(before[1]);
    tick(400);
    expect([path(appending), path(free)]).toEqual(shown);
  });

  it("show the new values before the pointer or keyboard reads them", async () => {
    const moving = await bars();
    await controlTime();
    const settled = async () => {
      tick(400);
      return path(moving);
    };
    change([moving], [30, 20, 10]);
    tick(50);
    const rect = moving.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      clientX: rect.left + 300,
      clientY: rect.top + 150,
      pointerId: MOUSE,
    };
    moving.root.dispatchEvent(new PointerEvent("pointermove", at));
    tick(16);
    const destination = path(moving);
    expect(await settled()).toBe(destination);
    moving.root.dispatchEvent(new PointerEvent("pointerleave", at));
    tick(16);

    change([moving], [10, 20, 30]);
    tick(50);
    const passing = path(moving);
    moving.root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    // Drawn at once, before the value is announced.
    expect(path(moving)).not.toBe(passing);
    expect(moving.root.textContent).toContain("10");
    expect(await settled()).toBe(path(moving));
  });

  it("move on under a pointer that reads nothing, and show the new values once a hover listener reads", async () => {
    const data = sales();
    const moving = await mount({
      animation: VALUES,
      inspection: false,
      tooltip: false,
      marks: [bar(data, { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const still = await bars(data, false);
    await controlTime();
    const rect = moving.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      clientX: rect.left + 300,
      clientY: rect.top + 150,
      pointerId: MOUSE,
    };
    moving.root.dispatchEvent(new PointerEvent("pointermove", at));
    change([moving], [30, 20, 10]);
    tick(16);
    tick(100);
    moving.root.dispatchEvent(new PointerEvent("pointermove", { ...at, clientX: at.clientX + 5 }));
    tick(16);
    // Between, under the pointer, and done in time.
    expect(path(moving)).not.toBe(path(still));
    tick(400);
    expect(path(moving)).toBe(path(still));

    // Hover listeners read what is under the pointer: the new values show first.
    moving.on("hover", () => {});
    change([moving], [10, 20, 30]);
    tick(50);
    moving.root.dispatchEvent(new PointerEvent("pointermove", at));
    expect(path(moving)).toBe(path(still));
  });

  it("show the new values when the pointer or keyboard comes before the change draws", async () => {
    const data = sales();
    const moving = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    const rect = moving.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      clientX: rect.left + 300,
      clientY: rect.top + 150,
      pointerId: MOUSE,
    };
    let values = [30, 20, 10];
    for (const input of ["pointermove", "pointerdown", "keydown"]) {
      change([moving], values);
      if (input === "keydown")
        moving.root.dispatchEvent(new KeyboardEvent(input, { key: "ArrowRight", bubbles: true }));
      else moving.root.dispatchEvent(new PointerEvent(input, { ...at, button: 0 }));
      tick(16);
      expect(path(moving), input).toBe(path(still));
      moving.root.dispatchEvent(new PointerEvent("pointerup", at));
      moving.root.dispatchEvent(new PointerEvent("pointerleave", at));
      moving.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      tick(400);
      values = values.map((value) => 40 - value);
    }
  });

  it("show changes at once after values were stopped, and during presses", async () => {
    const data = sales();
    const moving = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    // Stopped half way by the pointer passing, the bars show their new
    // values at once, and the next change moves from them.
    change([moving], [30, 20, 10]);
    tick(50);
    const at = { clientX: 150, clientY: 150, pointerId: MOUSE, button: 0 };
    moving.root.dispatchEvent(new PointerEvent("pointermove", at));
    still.render();
    expect(path(moving)).toBe(path(still));
    moving.root.dispatchEvent(new PointerEvent("pointerleave", at));
    const stopped = path(moving);
    change([moving], [20, 20, 20]);
    tick(16);
    expect(path(moving)).not.toBe(stopped);
    expect(path(moving)).not.toBe(path(still));
    tick(400);
    expect(path(moving)).toBe(path(still));
    // Ended by an option change, values in between are no place to move
    // from: the next change before a scene is drawn shows at once.
    change([moving], [30, 20, 10]);
    tick(50);
    moving.update({ title: "Sales" });
    still.update({ title: "Sales" });
    change([moving], [10, 20, 30]);
    tick(16);
    expect(path(moving)).toBe(path(still));
    tick(400);
    // A touch held in place sees new data drawn at once, and so does its click.
    const touch = { ...at, pointerType: "touch" };
    moving.root.dispatchEvent(new PointerEvent("pointerdown", touch));
    change([moving], [30, 20, 10]);
    tick(50);
    let clicked: string | undefined;
    moving.on("click", () => {
      clicked = path(moving);
    });
    moving.root.dispatchEvent(new PointerEvent("pointerup", touch));
    expect(clicked).toBe(path(still));
    tick(400);
    // A click right after the pointer arrives, before the next frame, sees
    // the new values drawn.
    change([moving], [10, 20, 30]);
    tick(50);
    moving.root.dispatchEvent(new PointerEvent("pointermove", at));
    moving.root.dispatchEvent(new PointerEvent("pointerdown", at));
    moving.root.dispatchEvent(new PointerEvent("pointerup", at));
    still.render();
    expect(clicked).toBe(path(still));
  });

  it("draw values a later change or option ended part way before a click reads them", async () => {
    const data = sales();
    const moving = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    const at = { clientX: 150, clientY: 150, pointerId: MOUSE, button: 0 };
    for (const end of ["data", "options"]) {
      change([moving], [30, 20, 10]);
      tick(50);
      const passing = path(moving);
      if (end === "data") change([moving], [25, 20, 15]);
      else for (const chart of [moving, still]) chart.update({ title: "Sales" });
      let clicked: string | undefined;
      const stop = moving.on("click", () => {
        clicked = path(moving);
      });
      // No frame between the change and the click.
      for (const type of ["pointermove", "pointerdown", "pointerup"])
        moving.root.dispatchEvent(new PointerEvent(type, at));
      still.render();
      expect(clicked, end).not.toBe(passing);
      expect(clicked, end).toBe(path(still));
      stop();
      moving.root.dispatchEvent(new PointerEvent("pointerleave", at));
      tick(400);
    }
  });

  it("show at once what render listeners change while input stops values", async () => {
    const data = sales();
    const moving = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    const at = { clientX: 150, clientY: 150, pointerId: MOUSE, button: 0 };
    for (const input of ["pointermove", "pointerdown", "keydown"]) {
      change([moving], [30, 20, 10]);
      tick(50);
      const stop = moving.on("render", () => {
        stop();
        change([moving], [25, 20, 15]);
      });
      moving.root.dispatchEvent(
        input === "keydown"
          ? new KeyboardEvent(input, { key: "ArrowRight", bubbles: true })
          : new PointerEvent(input, at),
      );
      tick(16);
      expect(path(moving), input).toBe(path(still));
      for (const type of ["pointerup", "pointerleave"])
        moving.root.dispatchEvent(new PointerEvent(type, at));
      moving.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      change([moving], [10, 20, 30]);
      tick(400);
    }
  });

  it("show hidden slices go at once, whatever changes with them", async () => {
    const data = sales();
    const marks = () => [pie(data, { category: "region", value: "sales", sort: "input" })];
    const moving = await mount({ animation: VALUES, marks: marks(), legend: false });
    const still = await mount({ animation: false, marks: marks(), legend: false });
    await controlTime();
    const arcs = (chart: Chart) =>
      [...chart.root.querySelectorAll('[data-kind="arc"]')].map((arc) => arc.getAttribute("d"));
    const [first, second] = moving.getLegend().map(({ key }) => key);
    // Hidden, then changed in the same frame.
    for (const chart of [moving, still]) chart.setVisibility(first!, false);
    change([moving], [10, 30, 20]);
    tick(16);
    expect(arcs(moving)).toEqual(arcs(still));
    tick(400);
    // Changed, then hidden in the same frame.
    change([moving], [10, 20, 30]);
    for (const chart of [moving, still]) chart.setVisibility(second!, false);
    tick(16);
    expect(arcs(moving)).toEqual(arcs(still));
  });

  it("show changes at once while inspected, in export, after render, and after appends", async () => {
    const data = sales();
    const moving = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    // Under the pointer, the bars show what the tooltip reads.
    const rect = moving.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      clientX: rect.left + 300,
      clientY: rect.top + 150,
      pointerId: MOUSE,
    };
    moving.root.dispatchEvent(new PointerEvent("pointermove", at));
    change([moving], [30, 20, 10]);
    tick(16);
    expect(path(moving)).toBe(path(still));
    moving.root.dispatchEvent(new PointerEvent("pointerleave", at));
    tick(400);

    // Export shows the new values, as a chart without animation does, and
    // so does the chart from then on.
    change([moving], [10, 20, 30]);
    tick(50);
    const exported = moving.toSVG().replace(/herceg-\d+/g, "");
    expect(exported).toBe(still.toSVG().replace(/herceg-\d+/g, ""));
    expect(path(moving)).toBe(path(still));
    tick(400);

    change([moving], [30, 20, 10]);
    moving.render();
    still.render();
    expect(path(moving)).toBe(path(still));
    tick(400);

    // A change while values move moves on from where they are.
    change([moving], [10, 20, 30]);
    tick(50);
    const passing = path(moving);
    change([moving], [30, 20, 10]);
    tick(16);
    expect(path(moving)).not.toBe(passing);
    expect(path(moving)).not.toBe(path(still));
    tick(400);
    expect(path(moving)).toBe(path(still));
    // Rows appended show at once, and so do changes until the data has been still.
    data.append({ region: ["W"], sales: [5] });
    tick(16);
    expect(path(moving)).toBe(path(still));
    change([moving], [20, 20, 20, 5]);
    tick(16);
    expect(path(moving)).toBe(path(still));
    // Once the data is still for a while, changes move again.
    tick(400);
    change([moving], [10, 20, 30, 5]);
    tick(50);
    expect(path(moving)).not.toBe(path(still));
  });

  it("move values in every subplot, ending as a chart without animation draws them", async () => {
    const data = table({ x: [0, 1, 2, 3], y: [10, 20, 30, 40] });
    const marks = () => [
      bar(data, { x: "x", y: "y", panel: "a" }),
      line(data, { x: "x", y: "y", panel: "b" }),
    ];
    const layout = panels([{ id: "a" }, { id: "b" }]);
    const moving = await mount({ animation: VALUES, panels: layout, marks: marks() });
    const still = await mount({ animation: false, panels: layout, marks: marks() });
    await controlTime();
    const before = [path(moving), path(moving, "line")];
    data.set("y", 3, 60);
    tick(66);
    const passing = [path(moving), path(moving, "line")];
    passing.forEach((drawn, i) => {
      expect(drawn).not.toBe(before[i]);
    });
    expect(passing).not.toEqual([path(still), path(still, "line")]);
    tick(400);
    expect(chart(moving)).toEqual(chart(still));
  });

  it("fade heatmap cells to new colors in SVG and Canvas", async () => {
    for (const renderer of ["svg", "canvas"] as const) {
      const data = table({ x: ["a", "b", "a", "b"], y: ["p", "p", "q", "q"], v: [1, 2, 3, 4] });
      const marks = () => [heatmap(data, { x: "x", y: "y", color: "v" })];
      const moving = await mount({ animation: VALUES, renderer, marks: marks() });
      const still = await mount({ animation: false, renderer, marks: marks() });
      await controlTime();
      const drawn = (chart: Chart) =>
        renderer === "svg"
          ? (chart.root.querySelector('[data-kind="raster"]')?.getAttribute("href") ?? "")
          : chart.root.querySelector("canvas")!.toDataURL();
      const before = drawn(moving);
      data.set("v", 0, 4);
      tick(16);
      tick(66);
      expect(drawn(moving), renderer).not.toBe(before);
      expect(drawn(moving), renderer).not.toBe(drawn(still));
      tick(400);
      expect(drawn(moving), renderer).toBe(drawn(still));
      // The next renderer's charts start afresh, on the real clock.
      for (const chart of charts.splice(0)) {
        const host = chart.root.parentElement;
        chart.destroy();
        host?.remove();
      }
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  it("are refused by marks that do not move, when the chart draws its options", async () => {
    const message =
      "animation.values: rug does not move to new values; leave values out, and new values show at once";
    const marks = () => [bar(sales(), { x: "region", y: "sales" }), rug(sales(), { y: "sales" })];
    const host = document.createElement("div");
    document.body.append(host);
    // Made to throw, the chart throws as it is made.
    expect(() =>
      createChart(host, { animation: VALUES, marks: marks(), errorMode: "throw" }),
    ).toThrow(message);
    host.remove();
    // Otherwise its `ready` rejects with the refusal, which `onError` hears.
    const heard: unknown[] = [];
    const refused = await mount({
      animation: VALUES,
      marks: marks(),
      onError: (error) => heard.push(error.message),
    });
    expect(heard).toEqual([message]);
    await expect(refused.ready).rejects.toMatchObject({
      code: "unsupported",
      path: "animation.values",
      message,
    });
    // Left out, the chart draws; asked for again, it is refused again.
    const errors: unknown[] = [];
    const drawn = await mount({ animation: { duration: 300 }, marks: marks() });
    drawn.on("error", ({ error }) => errors.push(error.message));
    expect(path(drawn)).not.toBe("");
    drawn.update({ animation: VALUES });
    drawn.render();
    expect(errors).toEqual([message]);
    drawn.update({ animation: { duration: 300 } });
    drawn.render();
    expect(path(drawn)).not.toBe("");
  });

  it("leave values alone with `animation: true`, and load their code only when asked", async () => {
    const viewOnly = await bars(sales(), true);
    await controlTime();
    change([viewOnly], [30, 20, 10]);
    tick(16);
    const shown = path(viewOnly);
    tick(400);
    expect(path(viewOnly)).toBe(shown);
    viewOnly.update({ animation: VALUES });
    expect(viewOnly.loading).toBeInstanceOf(Promise);
  });

  it("show changes at once where motion is reduced", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    );
    const calm = await bars();
    // Nor do axes.
    const free = await mount({
      animation: VALUES,
      marks: [bar(sales(), { x: "region", y: "sales" })],
    });
    await controlTime();
    change([calm, free], [30, 20, 45]);
    tick(16);
    const shown = [path(calm), yLabels(free)];
    tick(400);
    expect([path(calm), yLabels(free)]).toEqual(shown);
  });

  it("let go of what they move when the chart is destroyed", async () => {
    const moving = await bars();
    await controlTime();
    const animations: ValueAnimation[] = [];
    const start = ValueAnimation.prototype.start;
    vi.spyOn(ValueAnimation.prototype, "start").mockImplementation(function (
      this: ValueAnimation,
      ...args
    ) {
      animations.push(this);
      return start.apply(this, args);
    });
    change([moving], [30, 20, 10]);
    tick(50);
    expect(animations[0]?.playing).toBe(true);
    moving.destroy();
    expect(animations[0]?.playing).toBe(false);
    expect(() => tick(400)).not.toThrow();
  });
});

describe("keyed transitions", () => {
  /** Every scene the chart draws from now on. */
  function drawn(chart: Chart): Scene[] {
    const scenes: Scene[] = [];
    const render = SvgLayer.prototype.render;
    vi.spyOn(SvgLayer.prototype, "render").mockImplementation(function (this: SvgLayer, ...args) {
      if (chart.root.contains(this.svg)) scenes.push(args[0]);
      return render.apply(this, args);
    });
    return scenes;
  }
  const barsOf = (scene: Scene) =>
    scene.panels[0]!.marks.filter(
      (m): m is RectGeometry => m.kind === "rect" && !!(m as RectGeometry).bars,
    );
  /** Each named bar's middle across its thickness and its tip, as a scene draws it. */
  const placesOf = (scene: Scene) => {
    const places = new Map<string | number, { middle: number; length: number }>();
    for (const mark of barsOf(scene))
      mark.bars!.names.forEach((name, i) => {
        const [, y, width, height] = mark.rects.subarray(i * 4, i * 4 + 4);
        places.set(name, { middle: y! + height! / 2, length: width! });
      });
    return places;
  };

  it("race bars between ranks with a reset every 250 ms, as one motion", async () => {
    const brands = ["A", "B", "C", "D", "E", "F"];
    // Each keyframe's top four, ranked; brands trade places and come and go.
    const keyframe = (k: number) => {
      const values = brands.map((_, i) => 100 + 60 * Math.sin(i * 1.3 + k * 0.6) + i * 5);
      const order = brands
        .map((_, i) => i)
        .sort((a, b) => values[b]! - values[a]!)
        .slice(0, 4);
      return {
        brand: order.map((i) => brands[i]!),
        value: order.map((i) => values[i]!),
        rank: order.map((_, r) => r),
      };
    };
    const data = table(keyframe(0));
    const chart = await mount({
      animation: { values: true, duration: 250 },
      marks: [bar(data, { itemKey: "brand", orient: "y", x: "value", y: "rank", labels: true })],
      y: { domain: [3.5, -0.5] },
    });
    await controlTime();
    const scenes = drawn(chart);
    const { plot } = modelOf(chart).panels()[0]!;
    const below = plot.y + plot.height;
    let entered = 0;
    let between = 0;
    let counted = 0;
    let axis = 0;
    for (let k = 1; k <= 8; k++) {
      const last = scenes.at(-1);
      const before = last && placesOf(last);
      const ticks =
        last && last.panels[0]!.axes.find((a) => a.scale === "x")!.ticks.map((t) => t.position);
      const next = keyframe(k);
      data.reset(next);
      tick(16);
      const first = placesOf(scenes.at(-1)!);
      // Continuous at each new start: no bar jumps from where it was drawn.
      if (before)
        for (const [name, place] of first) {
          const was = before.get(name);
          if (was) expect(Math.abs(place.middle - was.middle)).toBeLessThan(plot.height / 4);
          else if (place.middle - 0 > below) entered++;
        }
      tick(110);
      const middle = scenes.at(-1)!;
      const ranks = new Map(next.brand.map((brand, r) => [brand, r]));
      for (const [name, place] of placesOf(middle)) {
        const r = ranks.get(name as string);
        const at = (rank: number) => plot.y + ((rank + 0.5) / 4) * plot.height;
        if (r !== undefined && Math.abs(place.middle - at(r)) > 2 && place.middle < below)
          between++;
      }
      // Labels write values between their two.
      for (const mark of middle.panels[0]!.marks) {
        const labels = (mark as TextGeometry).named;
        if (!labels?.values) continue;
        (mark as TextGeometry).labels?.forEach((text) => {
          const value = Number(text.replace(/,/g, ""));
          if (Number.isFinite(value) && !next.value.some((v) => Math.abs(v - value) < 0.5))
            counted++;
        });
      }
      // The value axis moves with the leader's value.
      const now = middle.panels[0]!.axes.find((a) => a.scale === "x")!.ticks.map((t) => t.position);
      if (ticks && JSON.stringify(now) !== JSON.stringify(ticks)) axis++;
      tick(124);
    }
    expect(entered).toBeGreaterThan(0);
    expect(between).toBeGreaterThan(0);
    expect(counted).toBeGreaterThan(0);
    expect(axis).toBeGreaterThan(0);
    // Once the keyframes stop, it settles at the last one, as drawn without animation.
    tick(400);
    const still = await mount({
      animation: false,
      marks: [bar(data, { itemKey: "brand", orient: "y", x: "value", y: "rank", labels: true })],
      y: { domain: [3.5, -0.5] },
    });
    expect(path(chart)).toBe(path(still));
  });

  const path = (chart: Chart) =>
    chart.root.querySelector(`[data-kind="rect"]`)?.getAttribute("d") ?? "";

  /** A sunburst that drills, with its names, and text placed on one of its sectors. */
  async function burst(extra: Partial<ChartOptions> = {}) {
    const rows = table({
      top: ["a", "a", "a", "b", "b", "c"],
      leaf: ["a1", "a2", "a3", "b1", "b2", "c1"],
      size: [10, 20, 30, 15, 25, 40],
    });
    return mount({
      animation: { values: true, duration: 750 },
      interaction: { zoom: true },
      legend: false,
      marks: [
        sunburst(rows, { id: "tree", path: ["top", "leaf"], value: "size" }),
        text({ from: { mark: "tree", item: ["a"], at: "top-left" }, label: "here" }),
      ],
      ...extra,
    });
  }
  const recordOf = (scene: Scene) =>
    (scene.panels[0]!.marks.find((m) => (m as ArcGeometry).sectors) as ArcGeometry).sectors!;

  it("drill a sunburst gradually, its sectors and labels moving, under the pointer too", async () => {
    const chart = await burst();
    const still = await burst({ animation: false });
    await controlTime();
    const scenes = drawn(chart);
    const items = () => chart.getItems({ mark: "tree" })!.items;
    const a = items().find(({ names }) => names.join() === "a")!;
    for (const each of [chart, still]) each.setDrillRoot(["a"]);
    tick(16);
    tick(234);
    // A third of the way: "a" is between its sector and the middle disc.
    const middle = items().find(({ key }) => key === a.key)!;
    expect(middle.sector!.innerRadius).toBeLessThan(a.sector!.innerRadius);
    expect(middle.sector!.innerRadius).toBeGreaterThan(0);
    expect(middle.sector!.endAngle - middle.sector!.startAngle).toBeGreaterThan(
      a.sector!.endAngle - a.sector!.startAngle,
    );
    // Labels fade: "b" and "c" go out, faded, still drawn.
    const faded = sectorsOf(recordOf(scenes.at(-1)!)).filter(
      (s) => s.label && s.shown > 0 && s.shown < 1,
    );
    expect(faded.length).toBeGreaterThan(0);
    // The pointer passing does not stop it; hovering reads the frame's sectors.
    const hovered: (string | undefined)[] = [];
    chart.on("hover", ({ target }) =>
      hovered.push(target?.kind === "item" ? target.item : undefined),
    );
    const rect = chart.root.getBoundingClientRect();
    const [cx, cy] = [middle.sector!.cx, middle.sector!.cy];
    chart.root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + cx + 1,
        clientY: rect.top + cy + 1,
        pointerId: MOUSE,
      }),
    );
    tick(100);
    const later = items().find(({ key }) => key === a.key)!;
    expect(later.sector!.innerRadius).toBeLessThan(middle.sector!.innerRadius);
    expect(later.sector!.innerRadius).toBeGreaterThan(0);
    // The text placed on "a" follows it.
    const here = () =>
      [...chart.root.querySelectorAll("svg text")]
        .find((t) => t.textContent === "here")!
        .getBoundingClientRect();
    const box = here();
    tick(100);
    expect(here().left).not.toBe(box.left);
    // The pointer reads it where it is drawn.
    const drawnText = scenes
      .at(-1)!
      .panels[0]!.marks.find(
        (m): m is TextGeometry => m.kind === "text" && (m as TextGeometry).labels?.[0] === "here",
      )!;
    const record = modelOf(chart)
      .drawnMarks()
      .flatMap(({ geometry }) => geometry)
      .find((m) => m.key === drawnText.key) as TextGeometry;
    expect(Array.from(record.coords.subarray(0, 2))).toEqual(
      Array.from(drawnText.coords.subarray(0, 2)),
    );
    // Export draws where the drill goes.
    expect(chart.toSVG().replace(/herceg-\d+/g, "")).toBe(still.toSVG().replace(/herceg-\d+/g, ""));
    tick(800);
    expect(arcs(chart)).toEqual(arcs(still));
  });

  const arcs = (chart: Chart) =>
    [...chart.root.querySelectorAll('[data-kind="arc"]')].map((arc) => arc.getAttribute("d"));

  it("drill back out with siblings coming in from the edges, and end when destroyed", async () => {
    const chart = await burst();
    await controlTime();
    chart.setDrillRoot(["a"]);
    tick(900);
    const scenes = drawn(chart);
    chart.setDrillRoot(null);
    tick(16);
    tick(100);
    const frame = sectorsOf(recordOf(scenes.at(-1)!));
    const b = frame.find(({ info }) => info?.().label === "b")!;
    // On its way in from the circle's end.
    expect(b.start).toBeGreaterThan(0.5);
    const items = modelOf(chart).items!;
    expect(items.transitionItems).toBeDefined();
    chart.destroy();
    expect(items.transitionItems).toBeUndefined();
    expect(modelOf(chart).drilled).toBeUndefined();
    expect(() => tick(900)).not.toThrow();
  });

  it("click the sector a drill draws, and drill on from there", async () => {
    const chart = await burst();
    await controlTime();
    const drills: (string | null)[] = [];
    chart.on("drill", ({ key }) => drills.push(key));
    chart.setDrillRoot(["a"]);
    tick(16);
    tick(100);
    // "a", on its way to the middle, is clicked where it is drawn: the tree goes back up.
    const a = chart.getItems({ mark: "tree" })!.items.find(({ names }) => names.join() === "a")!;
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle } = a.sector!;
    const [middle, along] = [(startAngle + endAngle) / 2, (innerRadius + outerRadius) / 2];
    const rect = chart.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      button: 0,
      pointerId: MOUSE,
      clientX: rect.left + cx + along * Math.sin(middle),
      clientY: rect.top + cy - along * Math.cos(middle),
    };
    chart.root.dispatchEvent(new PointerEvent("pointerdown", at));
    chart.root.dispatchEvent(new PointerEvent("pointerup", at));
    tick(16);
    expect(drills).toEqual([a.key, null]);
    // Going back up moves on from the frame drawn.
    expect(modelOf(chart).items!.transitionItems).toBeDefined();
  });

  it("drill into a sibling on its way out, clicked where a drill draws it", async () => {
    const chart = await burst();
    await controlTime();
    const drills: (string | null)[] = [];
    chart.on("drill", ({ key }) => drills.push(key));
    chart.setDrillRoot(["a"]);
    tick(16);
    tick(100);
    const b = chart.getItems({ mark: "tree" })!.items.find(({ names }) => names.join() === "b")!;
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle } = b.sector!;
    const [middle, along] = [(startAngle + endAngle) / 2, (innerRadius + outerRadius) / 2];
    const rect = chart.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      button: 0,
      pointerId: MOUSE,
      clientX: rect.left + cx + along * Math.sin(middle),
      clientY: rect.top + cy - along * Math.cos(middle),
    };
    chart.root.dispatchEvent(new PointerEvent("pointerdown", at));
    chart.root.dispatchEvent(new PointerEvent("pointerup", at));
    tick(16);
    expect(drills).toEqual([expect.any(String), b.key]);
  });

  it("give a leaf a drill takes away its row when clicked on its way out", async () => {
    const chart = await burst();
    await controlTime();
    const clicks: InputEvent[] = [];
    chart.on("click", (event) => clicks.push(event));
    chart.setDrillRoot(["a"]);
    tick(16);
    tick(100);
    const b1 = chart
      .getItems({ mark: "tree" })!
      .items.find(({ names }) => names.join() === "b,b1")!;
    const { cx, cy, innerRadius, outerRadius, startAngle, endAngle } = b1.sector!;
    const [middle, along] = [(startAngle + endAngle) / 2, (innerRadius + outerRadius) / 2];
    const rect = chart.root.getBoundingClientRect();
    const at = {
      bubbles: true,
      button: 0,
      pointerId: MOUSE,
      clientX: rect.left + cx + along * Math.sin(middle),
      clientY: rect.top + cy - along * Math.cos(middle),
    };
    chart.root.dispatchEvent(new PointerEvent("pointerdown", at));
    chart.root.dispatchEvent(new PointerEvent("pointerup", at));
    tick(16);
    const target = clicks.at(-1)?.target as ItemTarget | undefined;
    expect(target?.item).toBe(b1.key);
    expect([...target!.rows!().positions]).toEqual([3]);
    expect(target!.provenance?.groups).toEqual([
      { field: "top", value: "b" },
      { field: "leaf", value: "b1" },
    ]);
  });

  it("drill gradually the first time, with no frame drawn since its code loaded", async () => {
    // Its code is loaded already, as on a page where other charts loaded it.
    await import("../../src/dom/value-transition.ts");
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
    document.body.append(host);
    const chart = createChart(host, {
      animation: { values: true, duration: 750 },
      interaction: { zoom: true },
      legend: false,
      marks: [
        sunburst(
          table({ top: ["a", "a", "b", "c"], leaf: ["a1", "a2", "b1", "c1"], size: [1, 2, 3, 4] }),
          { id: "tree", path: ["top", "leaf"], value: "size" },
        ),
      ],
    });
    try {
      await chart.loading;
      await frame();
      // The clock is the test's from here: a slow machine's real frames
      // (over 10 ms) would make the drill show at once.
      vi.useFakeTimers({
        toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"],
      });
      chart.render();
      tick(16);
      const a = () =>
        chart.getItems({ mark: "tree" })!.items.find(({ names }) => names.join() === "a")!;
      const before = a().sector!.innerRadius;
      chart.setDrillRoot(["a"]);
      await vi.advanceTimersByTimeAsync(16);
      await vi.advanceTimersByTimeAsync(16);
      // On its way to the middle, not there at once.
      expect(a().sector!.innerRadius).toBeGreaterThan(0);
      expect(a().sector!.innerRadius).toBeLessThan(before);
    } finally {
      chart.destroy();
      host.remove();
    }
  });
});

/** Every scene each of `charts` draws from now on. */
function scenesOf(...charts: Chart[]): Scene[][] {
  const scenes = charts.map((): Scene[] => []);
  const render = SvgLayer.prototype.render;
  vi.spyOn(SvgLayer.prototype, "render").mockImplementation(function (this: SvgLayer, ...args) {
    const i = charts.findIndex((chart) => chart.root.contains(this.svg));
    if (i >= 0) scenes[i]!.push(args[0]);
    return render.apply(this, args);
  });
  return scenes;
}

describe("easing", () => {
  /** The bars' heights in a scene. */
  const heights = (scene: Scene) => {
    const mark = scene.panels[0]!.marks.find((m) => m.kind === "rect") as RectGeometry;
    return Array.from({ length: mark.count }, (_, i) => mark.rects[i * 4 + 3]!);
  };

  it("move values evenly with linear easing, half way at half time, and by d3's cubic in-out", async () => {
    // A frame every 16 ms from the change: 160 ms is half of 320.
    const options = (easing?: "linear" | "cubic-in-out"): Partial<ChartOptions> => ({
      animation: { values: true, duration: 320, ...(easing && { easing }) },
      marks: [bar(table({ region: ["N", "S"], sales: [10, 30] }), { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
    });
    const charts = [
      await mount(options("linear")),
      await mount(options("cubic-in-out")),
      await mount(options()),
    ];
    await controlTime();
    const scenes = scenesOf(...charts);
    const [before] = charts.map((chart) => modelOf(chart).panels()[0]!.y.map(0));
    const pixels = (value: number) => before! - modelOf(charts[0]!).panels()[0]!.y.map(value);
    for (const chart of charts)
      tablesOf(modelOf(chart).config.marks[0]!)[0]!.setColumn("sales", [30, 10]);
    tick(80);
    // A quarter of the way in time: linear a quarter, cubic in-out a sixteenth, cubic out more.
    const quarter = scenes.map((list) => heights(list.at(-1)!)[0]!);
    expect(quarter[0]).toBeCloseTo(pixels(15), 3);
    expect(quarter[1]).toBeCloseTo(pixels(10 + 20 * 0.0625), 3);
    expect(quarter[2]).toBeCloseTo(pixels(10 + 20 * (1 - 0.75 ** 3)), 3);
    tick(80);
    const half = scenes.map((list) => heights(list.at(-1)!));
    expect(half[0]).toEqual([expect.closeTo(pixels(20), 3), expect.closeTo(pixels(20), 3)]);
    expect(half[1]![0]).toBeCloseTo(pixels(20), 3);
    expect(half[2]![0]).toBeCloseTo(pixels(10 + 20 * 0.875), 3);
  });

  it("move views with the chart's easing", async () => {
    const chart = await mount({ animation: { duration: 320, easing: "linear" } });
    await controlTime();
    const [lo, hi] = x(chart) as [number, number];
    chart.setViewport([20_000, 40_000]);
    tick(160);
    const [a, b] = x(chart) as [number, number];
    expect(a).toBeCloseTo((lo + 20_000) / 2, 6);
    expect(b).toBeCloseTo((hi + 40_000) / 2, 6);
  });

  it("tell of an easing that is none, drawing and moving as by default", async () => {
    const heard: ChartError[] = [];
    const logged = vi.spyOn(console, "error");
    const animation = (easing: string) => ({
      values: true,
      duration: 320,
      easing: easing as never,
    });
    const chart = await mount({
      animation: animation("bounce"),
      marks: [bar(table({ region: ["N", "S"], sales: [10, 30] }), { x: "region", y: "sales" })],
      y: { domain: [0, 40] },
      onError: (error) => heard.push(error),
    });
    expect(heard.map(({ code, path, phase, message }) => ({ code, path, phase, message }))).toEqual(
      [
        {
          code: "invalid-option",
          path: "animation.easing",
          phase: "validate",
          message:
            'animation.easing: expected "cubic-out", "linear", or "cubic-in-out"; received "bounce"',
        },
      ],
    );
    expect(chart.root.querySelector('[data-kind="rect"]')).not.toBeNull();
    await controlTime();
    const scenes = scenesOf(chart);
    const before = modelOf(chart).panels()[0]!.y.map(0);
    const pixels = (value: number) => before - modelOf(chart).panels()[0]!.y.map(value);
    tablesOf(modelOf(chart).config.marks[0]!)[0]!.setColumn("sales", [30, 10]);
    tick(160);
    // Half way in time, cubic out has gone seven eighths of the way.
    expect(heights(scenes[0]!.at(-1)!)[0]).toBeCloseTo(pixels(10 + 20 * 0.875), 3);
    // Each option naming none is told of; one naming an easing is not.
    chart.update({ animation: animation("toString") });
    chart.update({ animation: animation("linear") });
    expect(heard.map(({ message }) => message.split("received ")[1])).toEqual([
      '"bounce"',
      '"toString"',
    ]);
    expect(logged).not.toHaveBeenCalled();
  });

  it("draw a chart naming an easing that is none, keeping `ready` its first frame's", async () => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
    document.body.append(host);
    const heard: string[] = [];
    // Its encoding loads a compiler first, so the easing is told of before the first frame.
    const data = table({ id: ["a"], start: [0], end: [40], confidence: [1] });
    const chart = createChart(host, {
      animation: { values: true, easing: "bounce" as never },
      marks: [
        custom(data, {
          x: ["start", "end"],
          y: "id",
          encode: { strokeWidth: { field: "confidence", scale: { type: "identity" } } },
          draw: ({ series, x, y, path, encoded }) => {
            for (const s of series)
              path(`M${x(s.x[0]!)},${y(s.y[0]!)}`, { strokeWidth: encoded("strokeWidth", 0) });
          },
        }),
      ],
      onError: (error) => heard.push(error.message),
    });
    charts.push(chart);
    await expect(chart.ready).resolves.toBeUndefined();
    await chart.loading;
    expect(heard).toHaveLength(1);
  });
});

describe("custom marks changing values", () => {
  // Linear, with a frame every 16 ms: 160 ms is half way.
  const VALUES = { values: true, duration: 320, easing: "linear" } as const;
  const SCALES = { widths: { type: "linear", domain: [0, 1], range: [2, 6] } } as const;
  const forecasts = () =>
    table({
      id: ["a", "b", "c"],
      start: [0, 10, 20],
      end: [40, 50, 60],
      confidence: [0, 0.5, 1],
      lane: [1, 2, 3],
      group: ["x", "x", "y"],
    });
  /** What one call of `draw` read: each comet's end and stroke width, by id. */
  type Read = Map<string, { end: number; width: number | undefined }>;

  /** A2's comets along numeric lanes, recording what each `draw` reads. */
  function comets<S extends Schema>(
    data: Table<S> | RowView<S>,
    reads: Read[] = [],
    options: object = {},
  ) {
    return custom(data as unknown as Table, {
      x: ["start", "end"],
      y: "lane",
      itemKey: "id",
      encode: { strokeWidth: { field: "confidence", scale: "widths" } },
      draw({ table: rows, series, x, y, item, path, encoded }) {
        const end = rows.numbers("end");
        const read: Read = new Map();
        reads.push(read);
        for (const s of series)
          for (let k = 0; k < s.length; k++) {
            const row = s.rowAt(k);
            const width = encoded("strokeWidth", row);
            read.set(rows.value("id", row) as string, { end: end[row]!, width });
            item(s, row, () =>
              path(`M${x(s.x[row]!)} ${y(s.y[row]!)}H${x(end[row]!)}`, {
                stroke: s.color,
                strokeWidth: width,
              }),
            );
          }
      },
      ...options,
    });
  }
  const options = (
    marks: ChartOptions["marks"],
    animation: ChartOptions["animation"] = VALUES,
  ): Partial<ChartOptions> => ({
    animation,
    scales: SCALES,
    marks,
    x: { domain: [0, 100] },
    y: { domain: [0, 5] },
  });
  /** The comets as the chart's SVG draws them. */
  const drawn = (chart: Chart) =>
    [...chart.root.querySelectorAll(`[data-kind="shapes"]`)].map((g) => g.innerHTML).join();
  const ends = (read: Read | undefined) =>
    Object.fromEntries([...(read ?? [])].map(([id, { end }]) => [id, end]));
  /** The value animations of charts made from now on. */
  function animations(): ValueAnimation[] {
    const made: ValueAnimation[] = [];
    const start = ValueAnimation.prototype.start;
    vi.spyOn(ValueAnimation.prototype, "start").mockImplementation(function (
      this: ValueAnimation,
      ...args
    ) {
      if (!made.includes(this)) made.push(this);
      return start.apply(this, args);
    });
    return made;
  }

  it("draw frames between from their declared fields, encodings between, ending as drawn without animation", async () => {
    const data = forecasts();
    const reads: Read[] = [];
    const moving = await mount(options([comets(data, reads)]));
    const still = await mount(options([comets(data)], false));
    await controlTime();
    data.replace(0, { end: [60, 70, 80], confidence: [1, 1, 0] });
    tick(160);
    expect(Object.fromEntries(reads.at(-1)!)).toEqual({
      a: { end: 50, width: 4 },
      b: { end: 60, width: 5 },
      c: { end: 70, width: 4 },
    });
    expect(drawn(moving)).not.toBe(drawn(still));
    tick(400);
    expect(drawn(moving)).toBe(drawn(still));
  });

  it("move one mark in two charts from what each drew, retargeting after the other drew", async () => {
    const data = forecasts();
    const reads: Read[] = [];
    const mark = comets(data, reads);
    const moving = await mount(options([mark]));
    const still = await mount(options([mark], false));
    await controlTime();
    data.replace(0, { end: [60, 50, 60] });
    tick(160);
    expect(ends(reads.at(-1))).toEqual({ a: 50, b: 50, c: 60 });
    // The other chart draws the mark at its new values meanwhile.
    still.render();
    expect(ends(reads.at(-1))).toEqual({ a: 60, b: 50, c: 60 });
    data.replace(0, { end: [100] });
    tick(16);
    // On from 50, a twentieth of the way to 100, whatever the other chart drew since.
    expect(reads.slice(-2).map(ends)).toEqual(
      expect.arrayContaining([
        { a: 52.5, b: 50, c: 60 },
        { a: 100, b: 50, c: 60 },
      ]),
    );
    tick(400);
    expect(drawn(moving)).toBe(drawn(still));
  });

  it("draw their new values in a static export during a transition, and from then on", async () => {
    const data = forecasts();
    const moving = await mount(options([comets(data)]));
    const still = await mount(options([comets(data)], false));
    await controlTime();
    data.replace(0, { end: [60, 70, 80] });
    tick(160);
    expect(drawn(moving)).not.toBe(drawn(still));
    const exported = moving.toSVG().replace(/herceg-\d+/g, "");
    expect(exported).toBe(still.toSVG().replace(/herceg-\d+/g, ""));
    expect(drawn(moving)).toBe(drawn(still));
    // What the export drew is kept: the next change moves from it.
    data.replace(0, { end: [40] });
    tick(160);
    expect(drawn(moving)).not.toBe(drawn(still));
  });

  it("show changes at once past the chart's budget of moving items, keeping nothing", async () => {
    const rows = (length: number) =>
      table({
        id: Array.from({ length }, (_, i) => `r${i}`),
        start: new Float64Array(length),
        end: Float64Array.from({ length }, (_, i) => i % 100),
        confidence: new Float64Array(length),
        lane: Float64Array.from({ length }, (_, i) => i % 5),
      });
    const made = animations();
    // Three marks of 700 rows: 2,100 to draw in every frame, past 2,000.
    const tables = [rows(700), rows(700), rows(700)];
    const reads: Read[] = [];
    await mount(options(tables.map((data, i) => comets(data, reads, { id: `m${i}` }))));
    // One mark of 2,001 rows.
    const long = rows(2001);
    const longReads: Read[] = [];
    await mount(options([comets(long, longReads)]));
    await controlTime();
    expect(made.map((animation) => animation.kept)).toEqual([0, 0]);
    tables[0]!.replace(0, { end: [90] });
    long.replace(0, { end: [90] });
    tick(16);
    expect(reads.slice(-3).map((read) => read.get("r0")?.end)).toContain(90);
    expect(longReads.at(-1)!.get("r0")!.end).toBe(90);
  });

  it("move a faceted mark in every panel, and keep one copy of a table two views read", async () => {
    const data = forecasts();
    const reads: Read[] = [];
    const made = animations();
    const faceted = await mount({ ...options([comets(data, reads)]), facet: facet("group") });
    const views = [rowView(data, { filter: ["<", ["field", "lane"], 3] }), rowView(data)];
    const viewReads: Read[] = [];
    const viewed = await mount(
      options(views.map((view, i) => comets(view, viewReads, { id: `view${i}` }))),
    );
    await controlTime();
    // Start, end, confidence, and lane by row, and the ids: one copy for both views.
    expect(made.map((animation) => animation.kept)).toEqual([3 * 32 + 12, 3 * 32 + 12]);
    data.replace(0, { end: [60, 70, 80] });
    tick(160);
    // Each panel's comets, and each view's, between.
    expect(reads.slice(-2).map(ends)).toEqual([{ a: 50, b: 60 }, { c: 70 }]);
    expect(viewReads.slice(-2).map(ends)).toEqual([
      { a: 50, b: 60 },
      { a: 50, b: 60, c: 70 },
    ]);
    tick(400);
    expect(drawn(faceted)).not.toBe("");
    // A view's own change of rows shows at once.
    views[0]!.setQuery({ filter: ["<", ["field", "lane"], 4] });
    tick(16);
    expect(ends(viewReads.at(-2))).toEqual({ a: 60, b: 70, c: 80 });
    void viewed;
  });

  it("move from what was drawn through in-place changes and resets, showing appends at once", async () => {
    const data = forecasts();
    const reads: Read[] = [];
    const moving = await mount(options([comets(data, reads)]));
    const still = await mount(options([comets(data)], false));
    await controlTime();
    // Two writes before a frame: from what was drawn to the last.
    data.replace(0, { end: [100] });
    data.setColumn("end", [60, 50, 60]);
    tick(160);
    expect(ends(reads.at(-1))).toEqual({ a: 50, b: 50, c: 60 });
    tick(400);
    // Settled, the next change moves from there.
    data.setColumn("end", [80, 50, 60]);
    tick(160);
    expect(ends(reads.at(-1))).toEqual({ a: 70, b: 50, c: 60 });
    // A change arriving now moves on from where they are.
    data.replace(1, { end: [90] });
    tick(16);
    expect(ends(reads.at(-1))).toEqual({ a: 70.5, b: 52, c: 60 });
    tick(400);
    // Keyed items move across a reset; one that comes, and keys repeated, show at once.
    data.reset({
      id: ["c", "a", "d", "e", "e"],
      start: [20, 0, 0, 0, 0],
      end: [80, 100, 30, 10, 20],
      confidence: [1, 0, 1, 1, 1],
      lane: [3, 1, 4, 2, 2],
      group: ["y", "x", "y", "x", "x"],
    });
    tick(160);
    expect(ends(reads.at(-1))).toEqual({ c: 70, a: 90, d: 30, e: 20 });
    tick(400);
    expect(drawn(moving)).toBe(drawn(still));
    // Appended rows show at once, with the changes soon after.
    data.append({ id: ["f"], start: [0], end: [50], confidence: [0], lane: [0], group: ["x"] });
    tick(16);
    expect(drawn(moving)).toBe(drawn(still));
    data.replace(0, { end: [40] });
    tick(16);
    expect(drawn(moving)).toBe(drawn(still));
  });

  it("match rows without a key by identity, so a reset shows at once", async () => {
    const data = forecasts();
    const reads: Read[] = [];
    await mount(options([comets(data, reads, { itemKey: undefined })]));
    await controlTime();
    data.replace(0, { end: [60] });
    tick(160);
    expect(ends(reads.at(-1))).toEqual({ a: 50, b: 50, c: 60 });
    tick(400);
    data.reset({
      id: ["a", "b", "c"],
      start: [0, 10, 20],
      end: [80, 50, 60],
      confidence: [0, 0.5, 1],
      lane: [1, 2, 3],
      group: ["x", "x", "y"],
    });
    tick(16);
    expect(ends(reads.at(-1))).toEqual({ a: 80, b: 50, c: 60 });
  });

  it("load what moves them when they come after the chart's first frame, then move", async () => {
    const data = forecasts();
    const reads: Read[] = [];
    const lines = line(table({ t: [0, 100], v: [1, 4] }), { x: "t", y: "v" });
    const chart = await mount(options([lines]));
    chart.update(options([lines, comets(data, reads)]));
    // The frame that draws them loads it, which `loading` waits for.
    chart.render();
    await chart.loading;
    await controlTime();
    data.replace(0, { end: [60, 70, 80] });
    tick(160);
    expect(ends(reads.at(-1))).toEqual({ a: 50, b: 60, c: 70 });
  });

  it("let go of a transition's values once it ends", async () => {
    const data = forecasts();
    const frames: WeakRef<object>[] = [];
    const mark = custom(data, {
      x: ["start", "end"],
      y: "lane",
      itemKey: "id",
      encode: { strokeWidth: { field: "confidence", scale: "widths" } },
      draw({ table: rows, series, x, y, path, encoded }) {
        if (rows !== (data as unknown)) frames.push(new WeakRef(rows));
        const end = rows.numbers("end");
        for (const s of series)
          for (let k = 0; k < s.length; k++) {
            const row = s.rowAt(k);
            path(`M${x(s.x[row]!)} ${y(s.y[row]!)}H${x(end[row]!)}`, {
              strokeWidth: encoded("strokeWidth", row),
            });
          }
      },
    });
    await mount(options([mark]));
    await controlTime();
    data.replace(0, { end: [60, 70, 80], confidence: [1, 1, 0] });
    tick(160);
    expect(frames.length).toBeGreaterThan(0);
    tick(400);
    vi.useRealTimers();
    for (let i = 0; i < 3; i++) {
      await frame();
      await collectGarbage();
    }
    expect(frames.filter((ref) => ref.deref() !== undefined)).toEqual([]);
  });

  it("show a change under a resting pointer at once, settle on a move, and pick the item drawn", async () => {
    const data = forecasts();
    const reads: Read[] = [];
    const chart = await mount(options([comets(data, reads)]));
    await controlTime();
    const { plot } = modelOf(chart).panels()[0]!;
    const rect = chart.root.getBoundingClientRect();
    const xOf = (value: number) => rect.left + modelOf(chart).panels()[0]!.x.map(value);
    const yOf = (lane: number) => rect.top + modelOf(chart).panels()[0]!.y.map(lane);
    const at = {
      bubbles: true,
      clientX: rect.left + plot.x + 2,
      clientY: yOf(4),
      pointerId: MOUSE,
    };
    chart.root.dispatchEvent(new PointerEvent("pointermove", at));
    tick(16);
    data.replace(0, { end: [60] });
    tick(16);
    expect(ends(reads.at(-1))).toEqual({ a: 60, b: 50, c: 60 });
    chart.root.dispatchEvent(new PointerEvent("pointerleave", at));
    tick(400);

    const hovered: (number | undefined)[] = [];
    chart.on("hover", ({ target }) =>
      hovered.push(target?.kind === "item" ? target.row : undefined),
    );
    data.replace(0, { end: [90] });
    tick(160);
    expect(ends(reads.at(-1))).toEqual({ a: 75, b: 50, c: 60 });
    // Past the frame's end, on the comet's new one: the new values show, and it is picked.
    chart.root.dispatchEvent(
      new PointerEvent("pointermove", { ...at, clientX: xOf(85), clientY: yOf(1) }),
    );
    expect(ends(reads.at(-1))).toEqual({ a: 90, b: 50, c: 60 });
    tick(16);
    expect(hovered.at(-1)).toBe(0);
    chart.root.dispatchEvent(new PointerEvent("pointerleave", at));
    tick(400);
    // So do keys.
    data.replace(0, { end: [40] });
    tick(160);
    expect(ends(reads.at(-1))).toEqual({ a: 65, b: 50, c: 60 });
    chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(ends(reads.at(-1))).toEqual({ a: 40, b: 50, c: 60 });
  });

  it("show changes at once where motion is reduced", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) => ({ matches: query.includes("reduce"), media: query }) as MediaQueryList,
    );
    const data = forecasts();
    const reads: Read[] = [];
    await mount(options([comets(data, reads)]));
    await controlTime();
    data.replace(0, { end: [60] });
    tick(16);
    expect(ends(reads.at(-1))).toEqual({ a: 60, b: 50, c: 60 });
  });
});

// A row view tells of its table's writes as the table does; the chart hears
// what changed from the table, and values move as they do over the table.
describe("value transitions over row views", () => {
  const VALUES = { duration: 300, values: true } as const;
  const prices = () =>
    table({
      k: ["a", "b", "c", "d"],
      g: ["p", "p", "q", "q"],
      x: [0, 1, 2, 3],
      y: [10, 20, 30, 40],
      lo: [5, 15, 25, 35],
      hi: [15, 25, 35, 45],
    });
  type Prices = RowView<ReturnType<typeof prices> extends Table<infer S> ? S : never>;
  type Family = [(view: Prices) => ChartOptions["marks"][number], NonNullable<ChartOptions["y"]>];
  /** Each family's mark over a view, and the y axis it is drawn on. */
  const FAMILIES: Record<string, Family> = {
    bars: [(view) => bar(view, { x: "k", y: "y" }), { domain: [0, 60] }],
    points: [(view) => point(view, { x: "x", y: "y", itemKey: "k" }), { domain: [0, 60] }],
    lines: [(view) => line(view, { x: "x", y: "y" }), { domain: [0, 60] }],
    areas: [(view) => area(view, { x: "x", y: "y" }), { domain: [0, 60] }],
    "error bars": [(view) => errorbar(view, { x: "x", y1: "lo", y2: "hi" }), { domain: [0, 60] }],
    candlesticks: [
      (view) => candlestick(view, { x: "x", open: "lo", high: "hi", low: "lo", close: "y" }),
      { domain: [0, 60] },
    ],
    heatmaps: [(view) => heatmap(view, { x: "k", y: "g", color: "y" }), {}],
  };
  /** What the chart's SVG draws, its ids aside. */
  const drawn = (chart: Chart) =>
    chart.root.querySelector("svg")!.outerHTML.replace(/herceg-\d+/g, "");

  for (const [family, [markOf, y]] of Object.entries(FAMILIES))
    it(`move ${family} over a view as its table's values change in place`, async () => {
      const data = prices();
      const options = (
        animation: NonNullable<ChartOptions["animation"]>,
      ): Partial<ChartOptions> => ({
        animation,
        renderer: "svg",
        marks: [markOf(rowView(data, { filter: [">=", ["field", "y"], 0] }))],
        y,
      });
      const moving = await mount(options(VALUES));
      const still = await mount(options(false));
      await controlTime();
      const before = drawn(moving);
      data.replace(0, { y: [30, 10, 40, 20], lo: [25, 5, 35, 15], hi: [35, 15, 45, 25] });
      tick(16);
      tick(100);
      expect(drawn(moving)).not.toBe(before);
      expect(drawn(moving)).not.toBe(drawn(still));
      tick(400);
      expect(drawn(moving)).toBe(drawn(still));
    });

  it("show a change during a view transition at once, as over the table itself", async () => {
    const data = prices();
    const options = (view: boolean): Partial<ChartOptions> => ({
      animation: VALUES,
      renderer: "svg",
      marks: [
        point(view ? rowView(data, { filter: [">=", ["field", "y"], 0] }) : data, {
          x: "x",
          y: "y",
          itemKey: "k",
        }),
      ],
      y: { domain: [0, 60] },
    });
    const viewed = await mount(options(true));
    const direct = await mount(options(false));
    await controlTime();
    for (const chart of [viewed, direct]) chart.setViewport([0.5, 2.5]);
    tick(16);
    data.replace(0, { y: [30, 10, 40, 20] });
    tick(16);
    expect(drawn(viewed)).toBe(drawn(direct));
  });

  it("move bars and points over sorted and filtered views, their own changes of rows at once", async () => {
    const sales = table({ region: ["N", "S", "E", "W"], sales: [10, 20, 30, 40] });
    const top = rowView(sales, { sort: [{ field: "sales", order: "descending" }] });
    const some = rowView(sales, { filter: [">", ["field", "sales"], 15] });
    const marks = () => [
      bar(top, { x: "region", y: "sales", itemKey: "region" }),
      point(some, { x: "region", y: "sales", itemKey: "region" }),
    ];
    const moving = await mount({ animation: VALUES, marks: marks(), y: { domain: [0, 50] } });
    const still = await mount({ animation: false, marks: marks(), y: { domain: [0, 50] } });
    await controlTime();
    // The sorted view changes order, the filtered one its rows.
    sales.setColumn("sales", [45, 20, 5, 40]);
    tick(160);
    const shapes = (chart: Chart) =>
      ["rect", "point"].map((kind) => chart.root.querySelector(`[data-kind="${kind}"]`)?.outerHTML);
    expect(shapes(moving)).not.toEqual(shapes(still));
    tick(400);
    expect(shapes(moving)).toEqual(shapes(still));
    // A view's own change of rows shows at once.
    some.setQuery({ filter: [">", ["field", "sales"], 30] });
    tick(16);
    expect(shapes(moving)).toEqual(shapes(still));
  });
});
