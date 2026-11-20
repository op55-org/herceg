// Transitions are judged by their own frames: building or planning where a
// change goes is done once, and is left out of how the frame after it is
// judged; every later frame counts whole. Costs here are the test's: the
// clock is fake and moves only as builds, paints, and plans say.

import "./interactive.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { lastFrameTime } from "../../src/dom/scheduler.ts";
import { SvgLayer } from "../../src/dom/svg-layer.ts";
import { ViewAnimation } from "../../src/dom/transition.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { ChartModel } from "../../src/model/model.ts";
import { modelOf } from "./helpers.ts";

const charts: Chart[] = [];
/** What building a chart's scene, painting its frame, and planning its view cost, in ms. */
const costs = new Map<Chart, { build: number; paint: number; plan: number }>();
/** Where the last test's clock stopped: the next goes on from there, as the page's does. */
let ended = 0;

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
  costs.clear();
  // The shared scheduler waits for a frame it asked for; let it run.
  if (vi.isFakeTimers()) {
    vi.runOnlyPendingTimers();
    ended = performance.now();
  }
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const tick = (ms = 16) => vi.advanceTimersByTime(ms);

/** A chart at the top of the page, so that it is on screen, with its code loaded. */
async function mount(options: ChartOptions, width = 600, height = 300): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.append(host);
  const chart = createChart(host, options);
  charts.push(chart);
  await chart.ready;
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  return chart;
}

/**
 * Frames and the clock from here on are the test's: time moves with `tick`
 * and with what each chart's builds, paints, and plans cost (`charge`).
 */
async function controlTime() {
  // Frames already asked for run first, on the real clock.
  await frame();
  await frame();
  // The fake clock starts at 0; the test's goes on from the page's.
  let spent = Math.max(ended, performance.now());
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  const clock = performance.now.bind(performance);
  vi.spyOn(performance, "now").mockImplementation(() => clock() + spent);
  const chartOf = (find: (chart: Chart) => boolean) => costs.get(charts.find(find)!);
  // A view transition's plan builds the scene of the view asked for.
  let planning = false;
  const scene = ChartModel.prototype.scene;
  vi.spyOn(ChartModel.prototype, "scene").mockImplementation(function (this: ChartModel, ...args) {
    const cost = chartOf((chart) => modelOf(chart) === this);
    spent += (planning ? cost?.plan : cost?.build) ?? 0;
    return scene.apply(this, args);
  });
  const render = SvgLayer.prototype.render;
  vi.spyOn(SvgLayer.prototype, "render").mockImplementation(function (this: SvgLayer, ...args) {
    spent += chartOf((chart) => chart.root.contains(this.svg))?.paint ?? 0;
    return render.apply(this, args);
  });
  const step = ViewAnimation.prototype.step;
  vi.spyOn(ViewAnimation.prototype, "step").mockImplementation(function (
    this: ViewAnimation,
    plan,
    frameTime,
  ) {
    const planned = () => {
      planning = true;
      try {
        return plan();
      } finally {
        planning = false;
      }
    };
    return step.call(this, planned, frameTime);
  });
  // Frame times measured on the real clock are forgotten: each chart draws
  // once more at no cost, and the page runs a frame of nothing.
  for (const chart of charts) {
    chart.render();
    chart.root.dispatchEvent(new PointerEvent("pointerleave"));
  }
  tick();
}

/** Has `chart`'s builds, paints, and view plans cost these many ms of the test's clock. */
function charge(chart: Chart, cost: Partial<{ build: number; paint: number; plan: number }>) {
  costs.set(chart, { build: 0, paint: 0, plan: 0, ...costs.get(chart), ...cost });
}

const VALUES = { values: true, duration: 300, easing: "linear" } as const;
const sales = () => table({ region: ["N", "S", "E"], sales: [10, 20, 30] });
/** A bar chart whose y axis stays put while its values change. */
const bars = (data: ReturnType<typeof sales>, animation: ChartOptions["animation"] = VALUES) =>
  mount({ animation, marks: [bar(data, { x: "region", y: "sales" })], y: { domain: [0, 40] } });
const path = (chart: Chart) => chart.root.querySelector(`[data-kind="rect"]`)?.getAttribute("d");

describe("value transitions judged by their own frames", () => {
  it("play a slow build's change whose frames are cheap: A2's comets", async () => {
    // A2's chart of 300 comets, whose destination took longer to build
    // than a frame allows while its frames took about 1 ms.
    const rows = 300;
    const forecasts = table({
      id: Array.from({ length: rows }, (_, i) => `F-${i}`),
      start: Float64Array.from({ length: rows }, (_, i) => (i * 7) % 40),
      end: Float64Array.from({ length: rows }, (_, i) => 50 + ((i * 11) % 40)),
      category: Array.from({ length: rows }, (_, i) => ["rates", "credit", "fx"][i % 3]!),
    });
    // A comet the update moves.
    const watched = 40;
    const seen: number[] = [];
    const chart = await mount(
      {
        animation: { values: true, duration: 300 },
        interaction: { select: "items" },
        marks: [
          custom(forecasts, {
            id: "comets",
            x: ["start", "end"],
            y: "id",
            series: "category",
            itemKey: "id",
            draw: ({ table: t, series, x, y, item, path }) => {
              const end = t.numbers("end");
              seen.push(end[watched]!);
              for (const s of series)
                for (let k = 0; k < s.length; k++) {
                  const row = s.rowAt(k);
                  item(s, row, () =>
                    path(`M${x(s.x[row]!)},${y(s.y[row]!)}L${x(end[row]!)},${y(s.y[row]!)}`, {
                      stroke: s.color,
                    }),
                  );
                }
            },
          }),
        ],
      },
      960,
      1000,
    );
    await controlTime();
    charge(chart, { build: 25, paint: 1 });
    seen.length = 0;
    forecasts.transaction(() => {
      for (let row = 0; row < rows; row += 5) forecasts.set("end", row, 95 - (row % 30));
    });
    for (let frames = 0; frames < 30; frames++) tick();
    const [from, to] = [50 + ((watched * 11) % 40), 95 - (watched % 30)];
    // Every frame of its 300 ms moved the comets, through values between.
    const between = seen.filter((end) => end > Math.min(from, to) && end < Math.max(from, to));
    expect(between.length, JSON.stringify(seen)).toBeGreaterThanOrEqual(10);
    // The build drew the new value first; the last frame between was all but there.
    expect(seen[0]).toBe(to);
    expect(seen.at(-1)).toBeCloseTo(to, 2);
  });

  it("end a change whose frames are slow after a cheap build", async () => {
    const data = sales();
    const chart = await bars(data);
    await controlTime();
    const before = path(chart);
    charge(chart, { build: 1, paint: 12 });
    data.setColumn("sales", [30, 20, 10]);
    tick();
    // Its first frame between is judged by the frame before the change.
    const first = path(chart);
    expect(first).not.toBe(before);
    // Its next is judged by that first frame: 12 ms painting it end it.
    tick();
    const ended = path(chart);
    expect(ended).not.toBe(first);
    tick(400);
    expect(path(chart)).toBe(ended);
  });

  it("leave the build out of the page's frame, and judge every later frame whole", async () => {
    const data = sales();
    const chart = await bars(data);
    await controlTime();
    charge(chart, { build: 30, paint: 1 });
    data.setColumn("sales", [30, 20, 10]);
    tick();
    // The frame that built where it goes counts its first frame between.
    expect(lastFrameTime()).toBe(1);
    const moving = [path(chart)];
    for (let frames = 0; frames < 4; frames++) {
      tick();
      moving.push(path(chart));
    }
    expect(new Set(moving).size).toBe(5);
    expect(lastFrameTime()).toBe(1);
  });

  it("leave a synchronous build out of the chart's frame only", async () => {
    const data = sales();
    const chart = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    const { key } = chart.getPanels()[0]!;
    const page = lastFrameTime();
    charge(chart, { build: 30, paint: 1 });
    data.setColumn("sales", [30, 20, 10]);
    // A call that draws pending changes first builds where they go now,
    // outside the page's frames.
    chart.getViewport({ panel: key });
    const first = path(chart);
    expect(lastFrameTime()).toBe(page);
    // The next frame judges the chart's last less the build, and the page's
    // last as it was: none of it is left out of the page's frames.
    tick();
    expect(path(chart)).not.toBe(first);
    expect(path(chart)).not.toBe(path(still));
    expect(lastFrameTime()).toBe(1);
    tick();
    expect(path(chart)).not.toBe(path(still));
    expect(lastFrameTime()).toBe(1);
  });

  it("show the changes of a chart rebuilding every frame at once when its builds are slow", async () => {
    const data = sales();
    const chart = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    charge(chart, { build: 12, paint: 1 });
    // Values change every frame (60 Hz): each change is judged as it starts
    // by the frame before, which built the last.
    const moved: boolean[] = [];
    for (let k = 1; k <= 8; k++) {
      data.setColumn("sales", [10 + k, 20 + k, 30 - k]);
      tick();
      moved.push(path(chart) !== path(still));
    }
    // At most the first moves; once its frames are judged by its builds,
    // every change shows at once.
    expect(moved.slice(1)).toEqual(Array(7).fill(false));
  });

  it("keep moving a chart rebuilding every frame within the budget", async () => {
    const data = sales();
    const chart = await bars(data);
    const still = await bars(data, false);
    await controlTime();
    // 6 ms to build and 1 to paint: every frame is within 10 ms.
    charge(chart, { build: 6, paint: 1 });
    const moved: boolean[] = [];
    for (let k = 1; k <= 8; k++) {
      data.setColumn("sales", [10 + k, 20 + k, 30 - k]);
      tick();
      moved.push(path(chart) !== path(still));
    }
    expect(moved).toEqual(Array(8).fill(true));
  });
});

describe("value transitions of charts together", () => {
  /** `count` bar charts on one page, of tables of their own, and charts drawing their values at once. */
  async function dashboard(count: number) {
    const tables = Array.from({ length: count }, sales);
    const moving: Chart[] = [];
    const still: Chart[] = [];
    for (const data of tables) moving.push(await bars(data));
    for (const data of tables) still.push(await bars(data, false));
    await controlTime();
    const change = (k: number, which = tables) => {
      for (const data of which) data.setColumn("sales", [10 + k, 20 + k, 30 - k]);
    };
    /** Which of the charts show something between their values. */
    const moved = () => moving.map((chart, i) => path(chart) !== path(still[i]!));
    return { tables, moving, change, moved };
  }

  it("play together when their builds are slow and their frames together cheap", async () => {
    // A refresh of ten charts: 3 ms each to build, half a millisecond each
    // to paint. The frame that builds them takes 35 ms, those after 5 ms.
    const { moving, change, moved } = await dashboard(10);
    for (const chart of moving) charge(chart, { build: 3, paint: 0.5 });
    change(1);
    tick();
    expect(lastFrameTime()).toBe(5);
    tick();
    tick();
    expect(moved()).toEqual(Array(10).fill(true));
  });

  it("end when their frames together pass the budget, each cheap alone", async () => {
    const { moving, change, moved } = await dashboard(4);
    for (const chart of moving) charge(chart, { build: 1, paint: 3 });
    change(1);
    tick();
    expect(moved()).toEqual(Array(4).fill(true));
    expect(lastFrameTime()).toBe(12);
    tick();
    expect(moved()).toEqual(Array(4).fill(false));
  });

  it("count every build in a frame after one that left builds out", async () => {
    // Two groups changing on alternate frames: each chart builds every
    // other frame, but the page builds every frame, for 18 ms.
    const { tables, moving, change, moved } = await dashboard(6);
    for (const chart of moving) charge(chart, { build: 5, paint: 0.5 });
    const [odd, even] = [tables.slice(0, 3), tables.slice(3)];
    const frames: number[] = [];
    for (let k = 1; k <= 6; k++) {
      change(k, k % 2 ? odd : even);
      tick();
      frames.push(lastFrameTime());
    }
    // The first frame builds three charts, left out, and paints them; the
    // second builds the other three in full and paints all six, ending
    // every change; from then on, changes show at once.
    expect(frames).toEqual([1.5, 18, 18, 16.5, 16.5, 16.5]);
    expect(moved()).toEqual(Array(6).fill(false));
  });
});

describe("one-off work within other one-off work", () => {
  it("leaves out the inner build once, and counts the work around it whole", async () => {
    const [a, b] = [sales(), sales()];
    const other = await bars(b);
    const { key } = other.getPanels()[0]!;
    // A custom mark whose `draw` changes the other chart's data and asks it
    // for its panel, which draws the change at once, within this build.
    let ask = false;
    const asking = custom({
      draw() {
        if (!ask) return;
        ask = false;
        b.setColumn("sales", [30, 20, 10]);
        other.getViewport({ panel: key });
      },
    });
    const chart = await mount({
      animation: VALUES,
      marks: [bar(a, { x: "region", y: "sales" }), asking],
      y: { domain: [0, 40] },
    });
    await controlTime();
    charge(chart, { build: 1, paint: 1 });
    charge(other, { build: 5, paint: 12 });
    a.setColumn("sales", [30, 20, 10]);
    ask = true;
    tick();
    // 19 ms: this chart's build (1), the other's build (5) and paint (12)
    // within it, and this chart's paint (1). Only the other's build is left
    // out: its painting counts, and ends both changes.
    expect(lastFrameTime()).toBe(14);
    tick();
    const ended = [path(chart), path(other)];
    tick(400);
    expect([path(chart), path(other)]).toEqual(ended);
  });
});

describe("view transitions judged by their own frames", () => {
  const t = Float64Array.from({ length: 101 }, (_, i) => i * 1000);
  const series = () => table({ t, v: Float64Array.from(t, (x) => Math.sin(x / 9000) * 10) });
  const x = (chart: Chart) => [...modelOf(chart).panels()[0]!.x.domain] as [number, number];

  it("move to a view whose plan is slow, its frames cheap", async () => {
    const chart = await mount({
      animation: { duration: 300 },
      marks: [line(series(), { x: "t", y: "v" })],
    });
    await controlTime();
    charge(chart, { plan: 30, paint: 1 });
    const [lo] = x(chart);
    chart.setViewport([20_000, 40_000]);
    const starts: number[] = [];
    for (let frames = 0; frames < 5; frames++) {
      tick();
      starts.push(x(chart)[0]);
    }
    // Each frame moved the axis, between where it was and where it goes.
    expect(new Set(starts).size).toBe(5);
    for (const start of starts) expect(start > lo && start < 20_000).toBe(true);
    // The plan is left out of the page's frame; the chart's own never counted it.
    expect(lastFrameTime()).toBe(1);
    tick(400);
    expect(x(chart)).toEqual([20_000, 40_000]);
  });

  it("jump when the frames after a slow plan are slow", async () => {
    const chart = await mount({
      animation: { duration: 300 },
      marks: [line(series(), { x: "t", y: "v" })],
    });
    await controlTime();
    charge(chart, { plan: 30, paint: 12 });
    chart.setViewport([20_000, 40_000]);
    tick();
    expect(x(chart)).not.toEqual([20_000, 40_000]);
    tick();
    expect(x(chart)).toEqual([20_000, 40_000]);
  });
});
