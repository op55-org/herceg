// Broken adapters fail their checks before anything is timed, and leave no
// timings: a chart that never draws, one that reports a draw it never
// painted, one that zooms to the wrong range, one that goes wrong after the
// check passed, and one whose appends keep the right x with the wrong
// values. A working adapter of the same small library is measured, so the
// failures are the faults', not the fixture's.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { page } from "vitest/browser";
import type { GridData, SeriesData } from "../datasets.ts";
import type { Scenario } from "../scenarios/index.ts";
import { type Adapter, type ChartHandle, type Drawn, PALETTE } from "./adapter.ts";
import { installHarness } from "./harness.ts";
import { limits } from "./verify.ts";

type Fault = "none" | "nothing" | "unpainted" | "shifted" | "stale" | "frozen";

const MARGIN = { left: 40, top: 10, right: 10, bottom: 30 };

/**
 * A small Canvas line chart: draws series 0 in the next animation frame
 * after each change, as libraries do, and reports what it drew; `fault`
 * breaks it one way.
 */
function line(fault: Fault): Adapter["line"] {
  return {
    prepare: (data) => data,
    create(container, data, options): ChartHandle<SeriesData> {
      const canvas = document.createElement("canvas");
      container.append(canvas);
      let width = options.width;
      let height = options.height;
      let shown = data;
      let x: [number, number] = [data.x[0]!, data.x[data.x.length - 1]!];
      let changes = 0;
      let appends = 0;
      let draws = 0;
      let last: Omit<Drawn, "draws"> = { width: 0, height: 0 };
      const ys = () => {
        let lo = Infinity;
        let hi = -Infinity;
        for (const y of shown.ys[0]!) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
        return [lo, hi] as const;
      };
      const draw = () =>
        requestAnimationFrame(() => {
          if (fault === "nothing") return;
          canvas.width = width;
          canvas.height = height;
          canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
          const plot = {
            left: MARGIN.left,
            top: MARGIN.top,
            width: width - MARGIN.left - MARGIN.right,
            height: height - MARGIN.top - MARGIN.bottom,
          };
          const y = ys();
          const context = canvas.getContext("2d")!;
          context.clearRect(0, 0, width, height);
          if (fault !== "unpainted") {
            context.strokeStyle = PALETTE[0]!;
            context.lineWidth = 2;
            context.beginPath();
            const xs = shown.x;
            const values = shown.ys[0]!;
            for (let i = 0; i < xs.length; i++) {
              if (xs[i]! < x[0] || xs[i]! > x[1]) continue;
              const px = plot.left + ((xs[i]! - x[0]) / (x[1] - x[0])) * plot.width;
              const py = plot.top + (1 - (values[i]! - y[0]) / (y[1] - y[0])) * plot.height;
              context.lineTo(px, py);
            }
            context.stroke();
          }
          const box = container.getBoundingClientRect();
          const n = shown.x.length;
          draws++;
          last = {
            width,
            height,
            plot: { ...plot, left: box.left + plot.left, top: box.top + plot.top },
            x: fault === "shifted" ? [x[0] + (x[1] - x[0]) / 10, x[1] + (x[1] - x[0]) / 10] : x,
            y,
            series: {
              count: n,
              firstX: shown.x[0]!,
              lastX: shown.x[n - 1]!,
              first: shown.ys[0]![0]!,
              last: shown.ys[0]![n - 1]!,
            },
          };
        });
      draw();
      return {
        setData(next) {
          // Stale: from the third change on, it draws the data it had.
          if (fault !== "stale" || ++changes < 3) shown = next;
          x = [shown.x[0]!, shown.x[shown.x.length - 1]!];
          draw();
        },
        append(xs, ys, keep) {
          // Frozen: from the second append on, the new points repeat the last value.
          const frozen = fault === "frozen" && ++appends > 1;
          const join = (a: Float64Array, b: Float64Array) => {
            const out = new Float64Array(a.length + b.length);
            out.set(a);
            out.set(b, a.length);
            return out.subarray(Math.max(0, out.length - keep));
          };
          shown = {
            ...shown,
            x: join(shown.x, xs),
            ys: shown.ys.map((y, k) => join(y, frozen ? xs.map(() => y[y.length - 1]!) : ys[k]!)),
          };
          x = [shown.x[0]!, shown.x[shown.x.length - 1]!];
          draw();
        },
        setViewport(x0, x1) {
          x = [x0, x1];
          draw();
        },
        resize(w, h) {
          width = w;
          height = h;
          draw();
        },
        pixelOf: (_series, _index, px) => ({ x: last.plot!.left + px, y: last.plot!.top }),
        drawn: () => ({ ...last, draws }),
        destroy: () => canvas.remove(),
      };
    },
  };
}

/**
 * A small Canvas heatmap: cells from white-blue to dark blue by value, the
 * suite's heatmap colors; `unpainted` reports its draw and paints nothing,
 * which leaves the plot white, the palest cells' neighbour.
 */
function heatmap(fault: Fault): Adapter["heatmap"] {
  return {
    prepare: (data) => data,
    create(container, data, options): ChartHandle<GridData> {
      const canvas = document.createElement("canvas");
      container.append(canvas);
      let draws = 0;
      let last: Omit<Drawn, "draws"> = { width: 0, height: 0 };
      requestAnimationFrame(() => {
        const { width, height } = options;
        canvas.width = width;
        canvas.height = height;
        canvas.style.cssText = `display:block;width:${width}px;height:${height}px`;
        const plot = { left: MARGIN.left, top: MARGIN.top, width: width - 50, height: height - 40 };
        const values = data.values;
        let lo = Infinity;
        let hi = -Infinity;
        for (const v of values) {
          lo = Math.min(lo, v);
          hi = Math.max(hi, v);
        }
        if (fault !== "unpainted") {
          const context = canvas.getContext("2d")!;
          const cw = plot.width / data.columns;
          const ch = plot.height / data.rows;
          for (let r = 0; r < data.rows; r++)
            for (let c = 0; c < data.columns; c++) {
              const t = (values[r * data.columns + c]! - lo) / (hi - lo);
              const mix = (a: number, b: number) => Math.round(a + (b - a) * t);
              context.fillStyle = `rgb(${mix(247, 8)},${mix(251, 48)},${mix(255, 107)})`;
              context.fillRect(plot.left + c * cw, plot.top + r * ch, cw + 0.5, ch + 0.5);
            }
        }
        const box = container.getBoundingClientRect();
        const n = values.length;
        draws++;
        last = {
          width,
          height,
          plot: { ...plot, left: box.left + plot.left, top: box.top + plot.top },
          series: { count: n, firstX: 0, lastX: n - 1, first: values[0]!, last: values[n - 1]! },
        };
      });
      return {
        setData() {},
        resize() {},
        pixelOf: () => ({ x: 0, y: 0 }),
        drawn: () => ({ ...last, draws }),
        destroy: () => canvas.remove(),
      };
    },
  };
}

const adapter = (fault: Fault): Adapter => ({
  id: `test-${fault}`,
  renderer: { normal: "canvas", large: "canvas" },
  verification: "the test chart's own record of its last draw",
  line: line(fault),
  heatmap: heatmap(fault),
});

const scenario = (operation: "init" | "update" | "zoom"): Scenario => ({
  id: `test-${operation}`,
  chart: "line",
  operation,
  series: 2,
  points: 400,
  large: false,
  tooltip: false,
  samples: 4,
  warmup: 1,
  description: "a small line chart",
});

/** The runner's check before timing, in this page: the operation once, then a screenshot. */
async function check(s: Scenario): Promise<string | undefined> {
  const mounted = await window.bench.mount(s);
  if (!mounted.supported) return mounted.reason;
  try {
    const wrong = await window.bench.preflight(s);
    if (wrong) return wrong;
    return await window.bench.pixelCheck(s, await page.screenshot({ save: false }));
  } finally {
    await window.bench.unmount();
  }
}

const saved = { ...limits };
beforeAll(() => {
  document.body.style.margin = "0";
  const stage = document.createElement("div");
  stage.id = "stage";
  stage.style.lineHeight = "0";
  document.body.append(stage);
  // A drawing that is wrong once the operation returned stays wrong.
  limits.settled = 500;
});
afterEach(() => {
  limits.shown = saved.shown;
});

/** Two trials of paced ingestion, each delivering fewer ticks than it holds (the clock stops it first). */
const ingest: Scenario = {
  id: "test-ingest",
  chart: "line",
  operation: "ingest",
  series: 2,
  points: 400,
  append: 1,
  rateHz: 50,
  durationMs: 300,
  large: false,
  tooltip: false,
  samples: 1,
  warmup: 1,
  description: "a small line chart appended to at 50 Hz",
};

describe("broken adapters", () => {
  it("a working chart passes the check and is measured", async () => {
    installHarness(adapter("none"));
    for (const operation of ["init", "update", "zoom"] as const)
      expect(await check(scenario(operation)), operation).toBeUndefined();
    const result = await window.bench.run(scenario("update"));
    expect(result.supported).toBe(true);
    expect(result.metrics.timeToFrame?.samples).toHaveLength(4);
  });

  it("a chart that never draws is incorrect at its mount, untimed", async () => {
    installHarness(adapter("nothing"));
    expect(await check(scenario("init"))).toMatch(/nothing drawn yet/);
    const result = await window.bench.run(scenario("init"));
    expect(result).toMatchObject({ supported: false, incorrect: true, metrics: {} });
  });

  it("a chart that reports a draw it never painted fails the screenshot", async () => {
    installHarness(adapter("unpainted"));
    expect(await check(scenario("init"))).toMatch(/series 0|colors/);
  });

  it("a blank heatmap fails the screenshot, and a painted one passes", async () => {
    const cells: Scenario = {
      ...scenario("init"),
      id: "test-heatmap",
      chart: "heatmap",
      series: 1,
      points: 2500,
    };
    installHarness(adapter("none"));
    expect(await check(cells)).toBeUndefined();
    installHarness(adapter("unpainted"));
    expect(await check(cells)).toMatch(/pixels in the marks' colors/);
  });

  it("a chart that zooms to the wrong range is incorrect, untimed", async () => {
    installHarness(adapter("shifted"));
    expect(await check(scenario("zoom"))).toMatch(/showed x from/);
    const result = await window.bench.run(scenario("zoom"));
    expect(result).toMatchObject({ supported: false, incorrect: true, metrics: {} });
    expect(result.reason).toMatch(/showed x from/);
  });

  it("paced ingestion checks the window each trial keeps, after the ticks the last delivered", async () => {
    installHarness(adapter("none"));
    const result = await window.bench.run(ingest);
    expect(result.supported, result.reason).toBe(true);
    expect(result.metrics.tickToShownFrame!.samples.length).toBeGreaterThan(0);
    expect(result.metrics.ticksUnshown!.samples).toEqual([0]);
  });

  it("appends that keep the right x and the wrong values are incorrect", async () => {
    installHarness(adapter("frozen"));
    const result = await window.bench.run(ingest);
    expect(result).toMatchObject({ supported: false, incorrect: true, metrics: {} });
    expect(result.reason).toMatch(/last tick/);
  });

  it("a chart that goes wrong after the check passed is incorrect with no timings", async () => {
    installHarness(adapter("stale"));
    // The check's one update is drawn: the third change is the first it draws stale.
    expect(await check(scenario("update"))).toBeUndefined();
    const result = await window.bench.run(scenario("update"));
    expect(result).toMatchObject({ supported: false, incorrect: true, metrics: {} });
    expect(result.reason).toMatch(/series 0/);
  });
});
