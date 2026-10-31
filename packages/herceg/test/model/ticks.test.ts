// Tick forms beyond a count (every, values, functions) and formats beyond
// Intl options (patterns, functions), planned by the guide compiler.
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { axis, type Format } from "../../src/guides/options.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { GUIDE_KIT, needsGuides } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import type { AxisGuide, Scene } from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { contractTest } from "../helpers/contracts.ts";
import { setViewport } from "../helpers/views.ts";

const guides = guideCompiler(GUIDE_KIT);
const HOUR = 3_600_000;
const start = Date.UTC(2026, 8, 28);
const hours = Array.from({ length: 49 }, (_, i) => start + i * HOUR);
const week = table({ t: time(hours), v: hours.map((_, i) => Math.sin(i / 5) * 40 + 50) });

function build(config: ChartConfig, width = 800, height = 300) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config }, undefined, guides);
  model.setSize(width, height, 1);
  return { model, scene: model.scene(estimateText) };
}

const axisOf = (scene: Scene, side: AxisGuide["side"]) =>
  scene.panels[0]!.axes.find((axis) => axis.side === side)!;
const labels = (scene: Scene, side: AxisGuide["side"] = "bottom") =>
  axisOf(scene, side).ticks.map((tick) => tick.label);
const xTicks = (model: ChartModel) => model.panels()[0]!.plans.x.ticks;

describe("ticks every so often", () => {
  it("steps through the calendar in the chart's time zone", () => {
    const { scene, model } = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { ticks: { every: "6 hours" }, format: { time: "%H:%M" } },
    });
    const ticks = xTicks(model);
    expect(ticks.every((t) => (t - start) % (6 * HOUR) === 0)).toBe(true);
    expect(labels(scene).slice(0, 5)).toEqual(["00:00", "06:00", "12:00", "18:00", "00:00"]);
  });

  it("starts days at midnight in another zone", () => {
    const { model } = build({
      marks: [line(week, { x: "t", y: "v" })],
      timeZone: "America/New_York",
      x: { ticks: { every: "day" } },
    });
    // Midnight in New York is 04:00 UTC in September.
    for (const t of xTicks(model)) expect(new Date(t).getUTCHours()).toBe(4);
  });

  it("takes { unit, step } and elapsed milliseconds alike", () => {
    const calendar = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { ticks: { every: { unit: "hour", step: 12 } } },
    });
    const elapsed = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { ticks: { every: { milliseconds: 12 * HOUR } } },
    });
    expect(xTicks(calendar.model)).toEqual(xTicks(elapsed.model));
  });

  it("steps by a number on number axes, from an anchor", () => {
    const data = table({ x: [0, 1, 2, 3], v: [3, 47, 12, 88] });
    const { scene } = build({
      marks: [line(data, { x: "x", y: "v" })],
      y: { ticks: { every: 25, anchor: 5 }, nice: false, domain: [0, 100] },
    });
    expect(labels(scene, "left")).toEqual(["5", "30", "55", "80"]);
  });

  contractTest("ticks.fiscal", () => {
    // Two years of days, in a zone whose clocks change: quarters of a year starting in February.
    const DAY = 24 * HOUR;
    const from = Date.UTC(2025, 0, 1);
    const days = Array.from({ length: 730 }, (_, i) => from + i * DAY);
    const span = table({ t: time(days), v: days.map((_, i) => i) });
    const fiscal = { start: 2 };
    const at = (data: typeof span, width: number) =>
      build(
        {
          marks: [line(data, { x: "t", y: "v" })],
          timeZone: "America/New_York",
          x: {
            ticks: { every: "3 months", fiscal },
            format: { time: "FY%y Q%q", fiscal },
          },
        },
        width,
      );
    const { model, scene } = at(span, 1200);
    const wall = (t: number) => new Date(GUIDE_KIT.toWall("America/New_York", t));
    const ticks = xTicks(model);
    // February, May, August, and November firsts, at local midnight whatever the offset.
    expect(ticks.map((t) => new Date(t).getUTCMonth())).toEqual([1, 4, 7, 10, 1, 4, 7, 10]);
    for (const t of ticks) {
      expect(wall(t).getUTCDate()).toBe(1);
      expect(wall(t).getUTCHours()).toBe(0);
    }
    expect(labels(scene).slice(0, 5)).toEqual([
      "FY26 Q1",
      "FY26 Q2",
      "FY26 Q3",
      "FY26 Q4",
      "FY27 Q1",
    ]);
    // Zoomed out over decades, the coarser steps are fiscal years' starts.
    const decades = table({ t: time([Date.UTC(1900, 0, 1), from]), v: [0, 1] });
    const sparse = xTicks(at(decades, 300).model);
    expect(sparse.length).toBeGreaterThan(1);
    expect(sparse.length).toBeLessThan(150);
    for (const t of sparse) expect(wall(t).getUTCMonth()).toBe(1);
  });

  it("refuses a fiscal year on number axes and on steps shorter than a month", () => {
    const data = table({ x: [0, 1], v: [0, 1] });
    expect(() =>
      build({
        marks: [line(data, { x: "x", y: "v" })],
        x: { ticks: { every: 1, fiscal: { start: 7 } } as never },
      }),
    ).toThrow(
      "x.ticks.fiscal: fiscal years step through time; a linear axis steps by numbers; drop fiscal",
    );
    expect(() =>
      build({
        marks: [line(week, { x: "t", y: "v" })],
        x: { ticks: { every: "day", fiscal: { start: 7 } } },
      }),
    ).toThrow(
      "x.ticks.fiscal: fiscal years start months and years; step by months or years, or drop fiscal",
    );
    // Numbers have no fiscal year, in formats too.
    expect(() =>
      build({
        marks: [line(data, { x: "x", y: "v" })],
        x: { format: { number: ".0f", fiscal: { start: 7 } } as never },
      }),
    ).toThrow("x.format.fiscal: numbers have no fiscal year; give time, or drop fiscal");
    // Elapsed time has no years to start.
    expect(() =>
      build({
        marks: [line(week, { x: "t", y: "v" })],
        x: { ticks: { every: { milliseconds: 100_000_000 }, fiscal: { start: 7 } } },
      }),
    ).toThrow(
      "x.ticks.fiscal: fiscal years start months and years; step by months or years, or drop fiscal",
    );
    // Nor do ticks by count or values, or Intl options, axes' or labels'.
    for (const ticks of [{ count: 4 }, { values: [0, 1] }])
      expect(() =>
        build({
          marks: [line(week, { x: "t", y: "v" })],
          x: { ticks: { ...ticks, fiscal: { start: 7 } } as never },
        }),
      ).toThrow(
        "x.ticks.fiscal: fiscal years step ticks through months and years; give every, or drop fiscal",
      );
    const intl =
      'Intl options write no fiscal year; give { time: "%Y Q%q" } with fiscal, or drop fiscal';
    expect(() =>
      build({
        marks: [line(week, { x: "t", y: "v" })],
        x: { format: { month: "short", fiscal: { start: 7 } } as never },
      }),
    ).toThrow(`x.format.fiscal: ${intl}`);
    expect(() => {
      const content = [{ value: true, format: { maximumFractionDigits: 0, fiscal: { start: 7 } } }];
      const marks = [line(data, { x: "x", y: "v", labels: { at: "last", content } as never })];
      const model = new ChartModel({ marks }, undefined, ...staticCompilers());
      model.setSize(400, 200, 1);
      model.scene(estimateText);
    }).toThrow(/content\[0\]\.format\.fiscal: Intl options write no fiscal year/);
    // A chart that would not load the guide compiler loads it to refuse
    // them, for an axis' format or tooltip format, the chart's or a panel's.
    const refused = { maximumFractionDigits: 0, fiscal: { start: 7 } } as never;
    const plain = { marks: [line(week, { x: "t", y: "v" })] };
    expect(needsGuides(plain)).toBe(false);
    for (const config of [
      { x: { format: refused } },
      { y: { tooltipFormat: refused } },
      { panels: panels([{ id: "a", y: { format: refused } }]) },
    ])
      expect(needsGuides({ ...plain, ...config })).toBe(true);
    // Specs are refused where they are read.
    const spec = (x: object) => () =>
      loadSpec({
        data: { t: { columns: { t: [0, 1], v: [0, 1] } } },
        marks: [{ type: "line", x: "t", y: "v" }],
        x,
      });
    expect(spec({ ticks: { count: 4, fiscal: { start: 7 } } })).toThrow(
      "x.ticks.fiscal: fiscal years step ticks through months and years; give every, or drop fiscal",
    );
    expect(spec({ format: { maximumFractionDigits: 0, fiscal: { start: 7 } } })).toThrow(
      `x.format.fiscal: ${intl}`,
    );
  });

  it("keeps ticks in place as the view moves", () => {
    const { model } = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { ticks: { every: "2 days" } },
    });
    setViewport(model, [start + 26 * HOUR, start + 48 * HOUR]);
    model.scene(estimateText);
    const later = xTicks(model);
    // Days 1, 3, 5, ... of the month, wherever the view starts.
    for (const t of later) expect((new Date(t).getUTCDate() - 1) % 2).toBe(0);
  });

  it("steps by coarser boundaries of the same unit where ticks would crowd, across the whole domain", () => {
    const days = Array.from({ length: 8 }, (_, i) => start + i * 24 * HOUR);
    const span = table({ t: time(days), v: days.map((_, i) => i) });
    for (const every of ["second", "millisecond", "10 minutes", "3 days"]) {
      const { model } = build({ marks: [line(span, { x: "t", y: "v" })], x: { ticks: { every } } });
      const ticks = xTicks(model);
      // Never closer than two pixels, and over all seven days.
      expect(ticks.length, every).toBeLessThanOrEqual(400);
      expect(ticks[0]!, every).toBeLessThan(start + 24 * HOUR);
      expect(ticks.at(-1)!, every).toBeGreaterThanOrEqual(start + 6 * 24 * HOUR);
      // Each is a boundary of the asked-for step.
      const unit = every === "10 minutes" ? 10 * 60_000 : every === "second" ? 1000 : 1;
      if (every !== "3 days") for (const t of ticks) expect((t - start) % unit, every).toBe(0);
      else for (const t of ticks) expect((new Date(t).getUTCDate() - 1) % 3, every).toBe(0);
    }
  });

  it("keeps both of a repeated hour's steps as clocks go back", () => {
    // Berlin goes from 03:00 back to 02:00 summer time at 01:00 UTC on October 25, 2026.
    const from = Date.UTC(2026, 9, 25, 0);
    const span = table({ t: time([from, from + 3 * HOUR]), v: [0, 1] });
    const { model } = build(
      {
        marks: [line(span, { x: "t", y: "v" })],
        timeZone: "Europe/Berlin",
        x: { ticks: { every: "5 minutes" } },
      },
      1200,
    );
    const ticks = xTicks(model);
    expect(ticks).toHaveLength(37);
    for (let k = 1; k < ticks.length; k++) expect(ticks[k]! - ticks[k - 1]!).toBe(5 * 60_000);
  });

  it("step by numbers too small for the domain's precision without stalling", () => {
    const data = table({ x: [1e16, 1e16 + 100], v: [0, 1] });
    const { model } = build({
      marks: [line(data, { x: "x", y: "v" })],
      x: { ticks: { every: 1 } },
    });
    const ticks = xTicks(model);
    expect(ticks.length).toBeGreaterThan(0);
    expect(new Set(ticks).size).toBe(ticks.length);
    // Inside a domain narrower than the numbers' 15 digits can tell apart.
    const narrow = build({
      marks: [line(table({ x: [1e16 + 30, 1e16 + 60], v: [0, 1] }), { x: "x", y: "v" })],
      x: { ticks: { every: 2 }, nice: false },
    });
    const within = xTicks(narrow.model);
    expect(within.length).toBeGreaterThan(5);
    for (const t of within) {
      expect(t).toBeGreaterThanOrEqual(1e16 + 30);
      expect(t).toBeLessThanOrEqual(1e16 + 60);
    }
  });

  it("refuses steps an axis cannot take, saying what to give", () => {
    const data = table({ x: [1, 10, 100], v: [1, 2, 3] });
    expect(() =>
      build({ marks: [line(data, { x: "x", y: "v" })], x: { type: "log", ticks: { every: 10 } } }),
    ).toThrow("chart x.ticks.every: a log axis has no even steps; give ticks a count or values");
    expect(() =>
      build({ marks: [line(week, { x: "t", y: "v" })], x: { ticks: { every: 5 } } }),
    ).toThrow(
      /^chart x\.ticks\.every: a time axis steps by time; give an interval such as "6 hours"/,
    );
    expect(() =>
      build({ marks: [line(data, { x: "x", y: "v" })], x: { ticks: { every: "day" } } }),
    ).toThrow('chart x.ticks.every: "day" steps through time; a linear axis steps by a number');
    expect(() =>
      build({ marks: [line(week, { x: "t", y: "v" })], x: { ticks: { every: "6 hourz" } } }),
    ).toThrow(/^chart x\.ticks\.every: "6 hourz" is not a time interval/);
    expect(() =>
      build({ marks: [line(week, { x: "t", y: "v" })], x: { ticks: { every: "day", anchor: 3 } } }),
    ).toThrow(/^chart x\.ticks\.anchor: calendar steps start at calendar boundaries/);
  });

  it("refuses steps and patterns on category axes", () => {
    const sites = table({ site: ["a", "b", "c"], v: [1, 2, 3] });
    expect(() =>
      build({ marks: [line(sites, { x: "site", y: "v" })], x: { ticks: { every: 2 } } }),
    ).toThrow(/^chart x\.ticks: a category axis labels the categories that fit/);
    expect(() =>
      build({ marks: [line(sites, { x: "site", y: "v" })], x: { format: { number: ".1f" } } }),
    ).toThrow(/^chart x\.format: a category axis writes its categories as they are/);
  });

  it("leaves out ticks inside time-axis breaks", () => {
    const { model } = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { ticks: { every: "6 hours" }, breaks: timeBreaks([{ hours: ["18:00", "06:00"] }]) },
    });
    for (const t of xTicks(model)) {
      const hour = new Date(t).getUTCHours();
      expect(hour >= 6 && hour <= 18).toBe(true);
    }
  });
});

describe("ticks at values", () => {
  it("draws exactly those inside the domain", () => {
    const data = table({ x: [0, 1, 2, 3], v: [10, 40, 70, 100] });
    const { scene } = build({
      marks: [line(data, { x: "x", y: "v" })],
      y: { ticks: { values: [95, 15, 300] } },
    });
    expect(labels(scene, "left")).toEqual(["15", "95"]);
  });

  it("takes Dates on time axes", () => {
    const { model } = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { ticks: { values: [new Date(start + 6 * HOUR), start + 30 * HOUR] } },
    });
    expect(xTicks(model)).toEqual([start + 6 * HOUR, start + 30 * HOUR]);
  });

  it("writes values given one by one as single values are written", () => {
    const data = table({ x: [0, 1], v: [0, 100] });
    const { scene } = build({
      marks: [line(data, { x: "x", y: "v" })],
      y: { ticks: { values: [0.5, 95] } },
    });
    expect(labels(scene, "left")).toEqual(["0.5", "95"]);
  });

  it("names the value it refuses", () => {
    const data = table({ x: [0, 1], v: [0, 100] });
    expect(() =>
      build({ marks: [line(data, { x: "x", y: "v" })], y: { ticks: { values: [1, "two"] } } }),
    ).toThrow('chart y.ticks.values[1]: expected a finite number; received "two"');
  });
});

describe("ticks from a function", () => {
  it("is asked once per plan, with the domain and the automatic count", () => {
    const data = table({ x: [0, 1], v: [0, 100] });
    const asked: { domain: readonly number[]; count: number; type: string }[] = [];
    const { scene } = build({
      marks: [line(data, { x: "x", y: "v" })],
      y: {
        ticks: (context) => {
          asked.push(context);
          return [context.domain[0], context.domain[1]];
        },
      },
    });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked[0]!.type).toBe("linear");
    expect(labels(scene, "left")).toEqual(["0", "100"]);
  });
});

describe("label formats", () => {
  it("writes numbers and times by pattern", () => {
    const data = table({ x: [0, 1, 2], v: [1200, 5400, 9800] });
    const numbers = build({
      marks: [line(data, { x: "x", y: "v" })],
      y: { format: { number: "~s" } },
    });
    expect(labels(numbers.scene, "left")).toContain("4k");
    const times = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { format: { time: "%a %-d" } },
    });
    expect(labels(times.scene)[0]).toMatch(/^Mon 28$/);
  });

  it("labels by value with a function, and leaves out labels that repeat the one before", () => {
    const { scene } = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: {
        ticks: { every: "6 hours" },
        format: (t) => (new Date(t).getUTCHours() === 0 ? "00:00" : "06"),
      },
    });
    expect(labels(scene).slice(0, 5)).toEqual(["00:00", "06", "", "", "00:00"]);
  });

  it("asks automatic ticks for fewer where a pattern cannot tell them apart", () => {
    const { scene } = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { format: { time: "%b %d" } },
    });
    const written = labels(scene);
    expect(new Set(written).size).toBe(written.length);
  });

  it("keeps ticks whose pattern repeats an earlier, not neighboring, label", () => {
    const day = 24 * HOUR;
    const days = Array.from({ length: 731 }, (_, i) => Date.UTC(2024, 0, 1) + i * day);
    const years = table({ t: time(days), v: days.map((_, i) => i) });
    const { scene, model } = build(
      {
        marks: [line(years, { x: "t", y: "v" })],
        x: { format: { time: "%b" } },
      },
      1176,
    );
    expect(xTicks(model).at(-1)).toBeGreaterThanOrEqual(Date.UTC(2025, 9, 1));
    expect(labels(scene)).toEqual(["Jan", "Apr", "Jul", "Oct", "Jan", "Apr", "Jul", "Oct"]);
  });

  it("leaves out repeats of explicit ticks, keeping their marks", () => {
    const { scene } = build({
      marks: [line(week, { x: "t", y: "v" })],
      x: { ticks: { every: "6 hours" }, format: { time: "%b %d" } },
    });
    const ticks = axisOf(scene, "bottom").ticks;
    expect(ticks.length).toBe(9);
    expect(ticks.map((t) => t.label).filter(Boolean)).toEqual(["Sep 28", "Sep 29", "Sep 30"]);
  });

  it("writes tooltips' values with the axis' pattern, or its tooltip format", () => {
    const data = table({ x: [0, 1, 2], v: [0.1234, 0.5, 0.9] });
    const axis = build({
      marks: [line(data, { x: "x", y: "v" })],
      y: { format: { number: ".0%" } },
    });
    expect(axis.model.formatsOf().y(0.1234)).toBe("12%");
    const own = build({
      marks: [line(data, { x: "x", y: "v" })],
      y: { format: { number: ".0%" }, tooltipFormat: { number: ".2%" } },
    });
    expect(own.model.formatsOf().y(0.1234)).toBe("12.34%");
  });

  it("keeps the axis' count of ticks with a pattern", () => {
    const data = table({ x: [0, 100], v: [0, 100] });
    for (const ticks of [2, { count: 2 }]) {
      const { model } = build({
        marks: [line(data, { x: "x", y: "v" })],
        x: { ticks, format: { number: ".1f" } },
      });
      expect(xTicks(model)).toEqual([0, 50, 100]);
    }
  });

  it("writes every automatic tick's label when duplicates are shown", () => {
    const data = table({ x: [0, 1], v: [0, 1] });
    const shown = (format: Format) =>
      labels(
        build({
          marks: [line(data, { x: "x", y: "v" })],
          x: { ticks: 4, format },
          guides: [axis({ scale: "x", labels: { duplicates: "show" } })],
        }).scene,
      );
    expect(shown(() => "same")).toEqual(["same", "same", "same", "same", "same", "same"]);
    expect(shown({ number: ".0f" })).toEqual(["0", "0", "0", "1", "1", "1"]);
    expect(shown({ maximumFractionDigits: 0 })).toEqual(["0", "0", "0", "1", "1", "1"]);
    // Asked to hide them, Intl formats leave out repeats too.
    const hidden = labels(
      build({
        marks: [line(data, { x: "x", y: "v" })],
        x: { ticks: 4, format: { maximumFractionDigits: 0 } },
        guides: [axis({ scale: "x", labels: { duplicates: "hide" } })],
      }).scene,
    );
    expect(new Set(hidden).size).toBe(hidden.length);
    const days = labels(
      build({
        marks: [line(week, { x: "t", y: "v" })],
        x: { ticks: 8, format: { month: "short", day: "numeric" } },
        guides: [axis({ scale: "x", labels: { duplicates: "show" } })],
      }).scene,
    );
    expect(days.length).toBeGreaterThan(4);
    expect(new Set(days).size).toBeLessThan(days.length);
  });

  it("refuses a pattern for the other kind of axis", () => {
    expect(() =>
      build({ marks: [line(week, { x: "t", y: "v" })], x: { format: { number: ".2f" } } }),
    ).toThrow(
      'chart x.format.number: a time axis writes times; give { time: "%b %d" } or Intl date options',
    );
  });
});

describe("scales", () => {
  it("set the short forms' scale settings", () => {
    const data = table({ x: [0, 1, 2], v: [10, 20, 30] });
    const { model } = build({
      marks: [line(data, { x: "x", y: "v" })],
      y: { domain: [0, 50], title: "ms" },
      scales: { y: { domain: [0, 100] } },
    });
    expect(model.yScale()!.domain).toEqual([0, 100]);
  });

  it("scope subplots' scales as the short forms do, checked as the model reads them", () => {
    const marks = ["a", "b"].map((panel) =>
      line(table({ x: [0, 1], v: [1, 2] }), { x: "x", y: "v", panel }),
    );
    const differing = panels([
      { id: "a", x: { domain: [0, 5] } },
      { id: "b", x: { domain: [0, 9] } },
    ]);
    // Panels that share x must agree on its settings; scoped per panel, they need not.
    expect(() => build({ panels: differing, marks, x: { scope: "chart" } })).toThrow(
      /panels\[1\]\.x: shares an x scale/,
    );
    expect(() => build({ panels: differing, marks, scales: { x: { scope: "chart" } } })).toThrow(
      /panels\[1\]\.x: shares an x scale/,
    );
    expect(() => build({ panels: differing, marks })).not.toThrow();
  });

  it("let shared panels agree on functions only when they are the same one", () => {
    const formats = [(v: number) => `A${v}`, (v: number) => `B${v}`];
    const marks = ["a", "b"].map((panel) =>
      line(table({ x: [0, 1], v: [1, 2] }), { x: "x", y: "v", panel }),
    );
    const subplots = (format: (i: number) => (v: number) => string) =>
      panels([
        { id: "a", x: { format: format(0) } },
        { id: "b", x: { format: format(1) } },
      ]);
    const x = { scope: "chart" } as const;
    expect(() => build({ panels: subplots(() => formats[0]!), marks, x })).not.toThrow();
    expect(() => build({ panels: subplots((i) => formats[i]!), marks, x })).toThrow(
      /panels\[1\]\.x: shares an x scale with others but differs in type, domain, zero, nice, ticks, format/,
    );
  });
});

describe("what needs the guide compiler", () => {
  it("is ticks other than a number, patterns, functions, position scales, guides, and legend layouts", () => {
    const marks = [line(week, { x: "t", y: "v" })];
    expect(needsGuides({ marks, x: { ticks: 5, format: { month: "short" } } })).toBe(false);
    expect(needsGuides({ marks, legend: { place: { side: "bottom" } } })).toBe(false);
    // Scales of categories are the feature compiler's.
    expect(needsGuides({ marks, scales: { site: { type: "ordinal" } } } as ChartConfig)).toBe(
      false,
    );
    for (const config of [
      { x: { ticks: { count: 4 } } },
      { x: { ticks: { every: "day" } } },
      { y: { ticks: { values: [1] } } },
      { y: { ticks: () => [1] } },
      { y: { format: { number: ".1f" } } },
      { y: { tooltipFormat: (v: number) => String(v) } },
      { scales: { y: {} } },
      // Settings the guide compiler checks before the feature compiler refuses the scale.
      { scales: { depth: { type: "linear", padding: 0.5 } } },
      { guides: [] },
      { legend: { columns: 2 } },
    ])
      expect(needsGuides({ marks, ...config } as ChartConfig)).toBe(true);
  });

  it("plans with the model's compiler once given", () => {
    const model = new ChartModel({
      marks: [line(week, { x: "t", y: "v" })],
      timeZone: "UTC",
      x: { ticks: { every: "day" } },
    });
    model.setSize(800, 300);
    model.use(guides);
    model.scene(estimateText);
    expect(xTicks(model).every((t) => (t - start) % (24 * HOUR) === 0)).toBe(true);
  });
});
