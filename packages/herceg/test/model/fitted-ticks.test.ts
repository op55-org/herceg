// Automatic ticks take the finest interval at which their labels do not
// meet, judged as "hide" judges them, by widths no narrower than the
// labels' shapes; chosen ticks and other overlap modes keep their count.
import { describe, expect, it, vi } from "vitest";
import { time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import {
  followedOf,
  frameAt,
  plan,
  positionsOf,
  sidesOf,
  snapshot,
} from "../../src/dom/value-transition.ts";
import { guideCompiler } from "../../src/guides/compile.ts";
import { axis, colorbar } from "../../src/guides/options.ts";
import { estimateText, type MeasureText, shapedMeasure, shapeOf } from "../../src/layout/text.ts";
import { grid } from "../../src/layout.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { monotonePolyline } from "../../src/marks/curve.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import {
  type AxisContext,
  type LabelsMeet,
  labelsMeet,
  planAxis,
  type TickPlan,
} from "../../src/model/axis.ts";
import { axisGuide } from "../../src/model/axis-guide.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import type { PositionScale } from "../../src/scale/scale.ts";
import {
  type AxisGuide,
  type AxisTick,
  guidesOf,
  type Scene,
  type TextItem,
} from "../../src/scene/scene.ts";
import { LIGHT } from "../../src/theme.ts";

vi.mock("../../src/dom/scheduler.ts", () => ({
  frameCount: () => 0,
  lastFrameTime: () => 0,
  leaveOut: () => {},
}));

const guides = guideCompiler(GUIDE_KIT);
const PAINT = LIGHT.style.tickLabel;

function build(config: ChartConfig, width = 600, height = 300, measure = estimateText) {
  const model = new ChartModel({ locale: "en-US", timeZone: "UTC", ...config }, undefined, [
    guides,
  ]);
  model.setSize(width, height, 1);
  model.scene(measure);
  return { model, scene: model.scene(measure) };
}

const axisOf = (scene: Scene, side: AxisGuide["side"], panel = 0) =>
  scene.panels[panel]!.axes.find((a) => a.side === side)!;
const labelled = (guide: AxisGuide) => guide.ticks.filter(({ label }) => label);
/** The steps between an axis' ticks. */
const steps = (ticks: readonly number[]) => ticks.slice(1).map((t, k) => t - ticks[k]!);

/** The least room between neighbouring labels' boxes along x, as `measure` sizes them. */
function leastGap(ticks: readonly AxisTick[], measure: MeasureText = estimateText): number {
  const boxes = ticks
    .filter(({ label }) => label)
    .map(({ position, label }) => {
      const half = measure(label, PAINT.css) / 2;
      return [position - half, position + half] as const;
    })
    .sort((a, b) => a[0] - b[0]);
  let least = Number.POSITIVE_INFINITY;
  for (let k = 1; k < boxes.length; k++) least = Math.min(least, boxes[k]![0] - boxes[k - 1]![1]);
  return least;
}

/** The least room between neighbouring drawn boxes of one layer's labels, along x or y. */
function leastBetween(guide: AxisGuide, layer: string, across: boolean): number {
  const spans = (guide.labelBoxes ?? [])
    .filter((label) => label.layer === layer)
    .map(({ box }) => (across ? [box.x, box.x + box.width] : [box.y, box.y + box.height]))
    .sort((a, b) => a[0]! - b[0]!);
  expect(spans.length, layer).toBeGreaterThan(0);
  return Math.min(...spans.slice(1).map((span, k) => span[0]! - spans[k]![1]!));
}

/** A context of `type` whose plans fit labels by `meets`. */
const contextOf = (type: AxisContext["type"], meets?: LabelsMeet): AxisContext => ({
  type,
  spec: undefined,
  zone: "UTC",
  locale: "en-US",
  meets,
});
const across = (measure: MeasureText = estimateText) => labelsMeet([PAINT], measure, true);

// A6: thirty lines meeting at the right edge, their names outside the plot.
const A6_NAMES = [
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
const START = Date.UTC(2026, 9, 1);
const minutes = Array.from({ length: 360 }, (_, i) => START + i * 60_000);
const a6Data = table({
  time: time(minutes),
  ...Object.fromEntries(
    A6_NAMES.map((name, s) => [
      name,
      minutes.map((_, k) => 440 + s * 4 + 6 * Math.sin(k / 25 + s)),
    ]),
  ),
});
/** A6's 1.2-second view, ending between two minutes. */
const SECONDS: [number, number] = [START + 338.5 * 60_000 - 1200, START + 338.5 * 60_000];
/**
 * A6's chart, the room its names take beside the plot held as padding (the
 * study's 236 px of furniture at 1100 px), so its plots are as wide as
 * A6's: about 864, 584, and 150 px at 1100, 820, and 360.
 */
const a6 = (extra: Partial<ChartConfig> = {}): ChartConfig => ({
  padding: { right: 160 },
  x: { domain: SECONDS },
  y: { domain: [0, 1000] },
  legend: { place: { side: "top" } },
  marks: [
    line(a6Data, {
      x: "time",
      y: A6_NAMES as never,
      labels: { at: "view-end", place: { outside: true, offset: 28 }, leader: true },
    }),
  ],
  ...extra,
});

describe("automatic ticks fitting their labels", () => {
  it("step A6's sub-second view by the finest interval whose labels stand 4 px apart", () => {
    const at = (width: number, height: number) => {
      const { scene } = build(a6(), width, height);
      return { scene, x: axisOf(scene, "bottom") };
    };
    // 1100 px: a count of 9 steps every 100 ms, its labels (77 px as
    // estimated) 72 px apart; every 200 ms they stand clear.
    const wide = at(1100, 720);
    const plot = wide.scene.panels[0]!.plot.width;
    expect(Math.round(plot / 100)).toBe(9);
    expect((plot * 100) / 1200).toBeLessThan(estimateText("00:00:00.000", PAINT.css) + 4);
    expect(new Set(steps(wide.x.ticks.map(({ value }) => value)))).toEqual(new Set([200]));
    expect(leastGap(wide.x.ticks)).toBeGreaterThanOrEqual(4);
    // 820 px: a count of 6 steps every 200 ms already.
    const resized = at(820, 640);
    expect(new Set(steps(resized.x.ticks.map(({ value }) => value)))).toEqual(new Set([200]));
    expect(leastGap(resized.x.ticks)).toBeGreaterThanOrEqual(4);
    // 360 px, a plot of 150: 500 ms meet too; whole seconds, one or two of them.
    const { scene: small } = build(a6({ padding: { right: 186 } }), 360, 300);
    expect(Math.round(small.panels[0]!.plot.width)).toBe(150);
    const narrow = { x: axisOf(small, "bottom") };
    expect(narrow.x.ticks.length).toBeGreaterThanOrEqual(1);
    for (const { value } of narrow.x.ticks) expect(value % 1000).toBe(0);
    expect(leastGap(narrow.x.ticks)).toBeGreaterThanOrEqual(4);
  });

  it("draw static exports as the chart lays them out", () => {
    const { scene } = build(a6(), 1100, 720);
    const svg = renderToSVG({
      ...a6(),
      locale: "en-US",
      timeZone: "UTC",
      width: 1100,
      height: 720,
    });
    for (const { label } of labelled(axisOf(scene, "bottom")))
      expect(svg).toContain(`>${label}</text>`);
    expect(svg).not.toContain(">05:38:58.900</text>");
  });

  it("take the finest of the counts below where coarser labels are shorter", () => {
    // [0, 0.003] over 114 px at count 5: 0.0005 steps 19 px apart meet;
    // count 4's 0.001 steps, 38 px apart with "0.001" 33 px wide, fit.
    const plan = planAxis(contextOf("linear", across()), [0, 0.003], [0, 114], 5);
    expect(plan.ticks).toEqual([0, 0.001, 0.002, 0.003]);
    expect(plan.count).toBe(5);
    expect(planAxis(contextOf("linear"), [0, 0.003], [0, 114], 5).ticks).toHaveLength(7);
  });

  it("keep the plan whose labels fit as it is, without planning again", () => {
    let plans = 0;
    const context: AxisContext = {
      ...contextOf("linear", across()),
      plan: (ticker, count) => {
        plans++;
        return { ...autoPlan(ticker, count), auto: true };
      },
    };
    planAxis(context, [0, 100], [0, 600], 7);
    expect(plans).toBe(1);
  });

  it("bound the search by the axis' length: eight counts below, then halving", () => {
    const counts: number[] = [];
    // Labels that never fit: every count is tried once.
    const context: AxisContext = {
      ...contextOf("linear", () => true),
      plan: (ticker, count) => {
        counts.push(count);
        return { ...autoPlan(ticker, count), auto: true };
      },
    };
    const plan = planAxis(context, [0, 1000], [0, 300], 150);
    expect(counts).toEqual([150, 149, 148, 147, 146, 145, 144, 143, 142, 71, 35, 17, 8, 4, 2, 1]);
    // At one tick's count, labels meeting the one before them go blank, their ticks kept.
    expect(plan.ticks.length).toBeGreaterThan(1);
    expect(plan.labels.filter((label) => label)).toHaveLength(1);
  });

  it("judge a plan the same as the last judged once", () => {
    let judged = 0;
    // Counts 9 to 2 plan the same four ticks, count 1 two of them.
    const context: AxisContext = {
      ...contextOf("linear", () => {
        judged++;
        return true;
      }),
      plan: (_, count) =>
        count > 1
          ? { ticks: [0, 10, 20, 30], labels: ["a", "b", "c", "d"], auto: true }
          : { ticks: [0, 30], labels: ["a", "d"], auto: true },
    };
    const plan = planAxis(context, [0, 30], [0, 40], 9);
    // Three pairs at count 9, one at count 1, and that one again as it is blanked.
    expect(judged).toBe(5);
    expect(plan).toMatchObject({ ticks: [0, 30], labels: ["a", ""] });
  });

  it("normalize counts before rounding a domain: huge and fractional counts plan", () => {
    // y rounds its fitted domain by the count: a count of 1e308 rounded
    // [1e12, 1e12 + 1] to NaN, and the axis drew no ticks.
    const data = table({ x: [0, 1], y: [1e12, 1e12 + 1] });
    for (const ticks of [1e308, 1e20, 2.5]) {
      const { scene, model } = build({ marks: [line(data, { x: "x", y: "y" })], y: { ticks } });
      expect(model.panels()[0]!.y.domain, `${ticks}`).toEqual([1e12, 1e12 + 1]);
      const left = axisOf(scene, "left");
      expect(left.ticks.length, `${ticks}`).toBeGreaterThan(1);
      expect(left.ticks.every(({ value }) => Number.isFinite(value))).toBe(true);
    }
    // Across x, a count of 1e20 over 300 px is searched from 150 down.
    const small = table({ x: [0, 100], y: [0, 1] });
    for (const ticks of [1e20, 2.5]) {
      const { scene } = build({ marks: [line(small, { x: "x", y: "y" })], x: { ticks } }, 300);
      const bottom = axisOf(scene, "bottom");
      expect(bottom.ticks.length, `${ticks}`).toBeGreaterThan(1);
      expect(leastGap(bottom.ticks)).toBeGreaterThanOrEqual(4);
    }
  });

  it("keep the finest interval of the eight counts on an axis with breaks", () => {
    const context = (breaks: { from: number; to: number }[], width: number): AxisContext => ({
      ...contextOf("time", (a, b) => Math.abs(b.position - a.position) < width + 4),
      breaks: timeBreaks(breaks).calendar("UTC"),
    });
    // The design's case: count 6's closest ticks stand 185 px apart, count 4's 167.
    const one = context([{ from: 1000, to: 7000 }], 171);
    const kept = planAxis(one, [0, 60_000], [0, 1000], 12);
    const plain = { ...one, meets: undefined };
    const of = (count: number) => planAxis(plain, [0, 60_000], [0, 1000], count).ticks;
    expect([6, 5]).toContainEqual(
      [11, 10, 9, 8, 7, 6, 5].find((count) => of(count).join() === kept.ticks.join()),
    );
    // Sol's: count 17 fits with 5-second ticks, count 16 with 2-second ones.
    const four = context(
      [
        { from: 1500, to: 2000 },
        { from: 41_500, to: 44_000 },
        { from: 44_600, to: 47_100 },
        { from: 47_400, to: 51_400 },
      ],
      32,
    );
    const finest = planAxis(four, [0, 60_000], [0, 1000], 18);
    expect(finest.ticks.join()).toBe(
      planAxis({ ...four, meets: undefined }, [0, 60_000], [0, 1000], 16).ticks.join(),
    );
    expect(finest.ticks).toContain(4000);
  });

  it("fit time, log, and linear axes along y by their lines", () => {
    // Labels of three lines stand 45 px tall: ticks at least that far apart.
    const data = table({ t: [0, 1], v: [0, 100] });
    const { scene } = build(
      {
        marks: [line(data, { x: "t", y: "v" })],
        y: { format: (value) => `${value}\nunits\nper s` },
      },
      400,
      240,
    );
    const left = labelled(axisOf(scene, "left"));
    expect(left.length).toBeGreaterThan(1);
    for (let k = 1; k < left.length; k++)
      expect(Math.abs(left[k]!.position - left[k - 1]!.position)).toBeGreaterThanOrEqual(45);
    // A log axis of two decades labels the digits that fit.
    const logs = table({ t: [0, 1], v: [1e3, 1e5] });
    const log = build(
      { marks: [line(logs, { x: "v", y: "t" })], x: { type: "log", ticks: 13, nice: false } },
      340,
    );
    const bottom = axisOf(log.scene, "bottom");
    expect(leastGap(bottom.ticks)).toBeGreaterThanOrEqual(4);
    const dense = planAxis(contextOf("log"), [1e3, 1e5], [0, 300], 13);
    expect(labelled(bottom).length).toBeLessThan(dense.labels.filter((label) => label).length);
  });

  it("draw chosen ticks as given, and leave other overlap modes their count", () => {
    const data = table({ x: [0, 0.003], y: [0, 1] });
    const chosen = (ticks: NonNullable<NonNullable<ChartConfig["x"]>["ticks"]>) =>
      axisOf(
        build({ marks: [line(data, { x: "x", y: "y" })], x: { domain: [0, 0.003], ticks } }, 160)
          .scene,
        "bottom",
      ).ticks.map(({ value }) => value);
    expect(chosen({ every: 0.0005 })).toHaveLength(7);
    expect(chosen({ values: [0, 0.0005, 0.001, 0.0015] })).toEqual([0, 0.0005, 0.001, 0.0015]);
    expect(chosen(() => [0, 0.0005, 0.001])).toEqual([0, 0.0005, 0.001]);
    // A6 with its listed axis: every 100 ms, every other label kept.
    for (const overlap of ["hide", "stagger"] as const) {
      const { scene } = build(
        a6({ guides: [axis({ scale: "x", labels: { overlap } })] }),
        1100,
        720,
      );
      expect(new Set(steps(axisOf(scene, "bottom").ticks.map(({ value }) => value)))).toEqual(
        new Set([100]),
      );
    }
    // Turned where they meet: the count's own interval, for the plot the
    // turned end labels leave (count 8's 200 ms).
    const turning = build(
      a6({ guides: [axis({ scale: "x", labels: { rotation: { candidates: [0, 45] } } })] }),
      1100,
      720,
    ).scene;
    const count = Math.round(turning.panels[0]!.plot.width / 100);
    const own = planAxis(contextOf("time"), SECONDS, [0, 100 * count], count);
    expect(axisOf(turning, "bottom").ticks.map(({ value }) => value)).toEqual(own.ticks);
  });

  it("fit listed axes' labels as they draw them", () => {
    // The labels drawn, by their values read back from where they are.
    const drawn = (guide: AxisGuide) =>
      guide.items.flatMap((item) =>
        item.type === "text" ? [{ position: item.x, value: item.x, label: item.text }] : [],
      );
    const intervals = (config: ChartConfig, side: AxisGuide["side"] = "bottom") => {
      const guide = axisOf(build(config, 1100, 720).scene, side);
      const labels = drawn(guide).map(({ label }) => label);
      return new Set(
        steps(guide.ticks.filter(({ label }) => labels.includes(label)).map(({ value }) => value)),
      );
    };
    // "show" with flat labels: as the default axis.
    expect(intervals(a6({ guides: [axis({ scale: "x", labels: { overlap: "show" } })] }))).toEqual(
      new Set([200]),
    );
    // Turned a quarter, labels take a line's height along x: 100 ms fit.
    expect(intervals(a6({ guides: [axis({ scale: "x", labels: { rotation: 90 } })] }))).toEqual(
      new Set([100]),
    );
    // Moved above the plots, the axis drawing x's plan fits it by its labels.
    expect(
      intervals(a6({ guides: [axis({ scale: "x", place: { side: "top" } })] }), "top"),
    ).toEqual(new Set([200]));
    // A layer of its own fits its own labels; one without labels keeps its count.
    const layered = build(
      a6({
        guides: [
          axis({
            scale: "x",
            labels: false,
            layers: [{ id: "minor", labels: false }, { id: "named" }],
          }),
        ],
      }),
      1100,
      720,
    ).scene;
    const named = drawn(axisOf(layered, "bottom"));
    expect(named.length).toBeGreaterThan(1);
    expect(leastGap(named)).toBeGreaterThanOrEqual(4);
  });

  it("measure labels by their shapes, digits as their run's widest, or as drawn where wider", () => {
    // Proportional digits: each one a pixel wider than the one before.
    const proportional =
      (zero: number): MeasureText =>
      (text) => {
        let width = 0;
        for (const char of text) {
          const code = char.codePointAt(0)!;
          width += code >= zero && code < zero + 10 ? 5 + code - zero : 4;
        }
        return width;
      };
    for (const zero of [0x660, 0x966]) {
      const measure = proportional(zero);
      const one = String.fromCodePoint(zero + 1);
      const nine = String.fromCodePoint(zero + 9);
      expect(shapeOf(one + one, (run) => String.fromCodePoint(run + 9))).toBe(nine + nine);
      // "١١" is 12 px wide, its shape "٩٩" 28: 15 px apart, the shapes meet.
      const meets = labelsMeet([PAINT], measure, true);
      const tick = (position: number) => ({ position, value: position, label: one + one });
      expect(meets(tick(0), tick(29))).toBe(true);
      expect(meets(tick(0), tick(32))).toBe(false);
    }
    // A measurer drawing "11" wider than its shape "00": as drawn.
    const kerned: MeasureText = (text) => (text === "11" ? 40 : 10 * text.length);
    const meets = labelsMeet([PAINT], kerned, true);
    const at = (position: number, label: string) => ({ position, value: position, label });
    expect(meets(at(0, "11"), at(30, "11"))).toBe(true);
    expect(meets(at(0, "22"), at(30, "22"))).toBe(false);
  });

  it("keep one interval while a window streams: shapes do not change with digits", () => {
    // Proportional ASCII digits, the "1" narrowest: its own widths alone
    // would let labels of ones fit where others do not.
    const narrowOnes: MeasureText = (text, font) =>
      estimateText(text, font) - (text.split("1").length - 1) * 3;
    for (const zone of ["UTC", "Europe/London"]) {
      const context: AxisContext = {
        ...contextOf("time", labelsMeet([PAINT], narrowOnes, true)),
        zone,
      };
      const seen = new Set<number>();
      // A 1.2-second window, 600 frames 16.7 ms apart, from London's repeated hour.
      const from = Date.UTC(2026, 9, 25, 1, 30);
      for (let frame = 0; frame < 600; frame++) {
        const start = from + frame * 16.7;
        const plan = planAxis(context, [start, start + 1200], [0, 840], 8);
        for (const step of steps(plan.ticks)) seen.add(step);
        const ticks = plan.ticks.map((t, k) => ({
          position: plan.scale.map(t),
          value: t,
          label: plan.labels[k]!,
        }));
        expect(leastGap(ticks, narrowOnes)).toBeGreaterThanOrEqual(4);
      }
      expect([...seen], zone).toEqual([200]);
    }
  });

  it("fit the axes of value transitions' frames as they plan", () => {
    // Points moving from a minute to a second and a half: frames plan x
    // over the domains between, each fitting its labels.
    const data = table({ t: time([0, 30_000, 60_000]), v: [1, 3, 2] });
    const model = new ChartModel(
      {
        locale: "en-US",
        timeZone: "UTC",
        animation: { duration: 200, values: true },
        marks: [point(data, { x: "t", y: "v" })],
      },
      undefined,
      staticCompilers(),
    );
    model.setSize(700, 300, 1);
    const shown = snapshot(model.scene(estimateText), model.panels(), 0)!;
    data.setColumn("t", [0, 700, 1500]);
    const scene = model.scene(estimateText);
    const builders = {
      planAxis,
      axisGuide,
      Polyline,
      monotonePolyline,
      measure: estimateText,
      shapeOf,
    };
    const tween = plan(
      shown,
      scene,
      model.panels(),
      200,
      builders,
      sidesOf(model.config),
      followedOf(model.config),
      positionsOf(model.config),
    )!;
    expect(tween).toBeDefined();
    let moved = 0;
    for (let ms = 0; ms <= 200; ms += 10) {
      const bottom = axisOf(frameAt(tween, ms), "bottom");
      if (bottom !== axisOf(scene, "bottom")) moved++;
      expect(leastGap(bottom.ticks), `${ms} ms`).toBeGreaterThanOrEqual(4);
    }
    expect(moved).toBeGreaterThan(5);
  });

  it("take each label's widest paint among the panels drawing them", () => {
    const data = table({ x: [0, 1_000_000], y: [0, 1] });
    const config = (fontSize: number): ChartConfig => ({
      marks: [
        line(data, { x: "x", y: "y", panel: "a" }),
        line(data, { x: "x", y: "y", panel: "b" }),
      ],
      x: { scope: "chart", repeat: "all", format: { maximumFractionDigits: 0 } },
      panels: panels(
        [{ id: "a" }, { id: "b", x: { style: { tickLabel: { fontSize } } } }],
        grid({ rows: 2 }),
      ),
    });
    const ticks = (fontSize: number) =>
      axisOf(build(config(fontSize), 420, 400).scene, "bottom").ticks.map(({ value }) => value);
    expect(ticks(24).length).toBeLessThan(ticks(12).length);
  });

  it("keep a labelled tick where coarser plans have none", () => {
    // Over [0.2, 4.8], 2 and 4 meet; count 1 steps by 5, past the domain.
    const data = table({ x: [0.2, 4.8], y: [0, 1] });
    const { scene } = build(
      {
        legend: false,
        x: { domain: [0.2, 4.8], format: (v: number) => `${v} milliseconds per request` },
        marks: [line(data, { x: "x", y: "y" })],
      },
      200,
      200,
    );
    const bottom = axisOf(scene, "bottom");
    expect(bottom.ticks.map(({ value }) => value)).toEqual([2, 4]);
    expect(labelled(bottom).map(({ label }) => label)).toEqual(["2 milliseconds per request"]);
  });

  it("judge listed layers' labels where they are drawn, moved inside the chart", () => {
    // Labels of two lines along y stay inside a chart 100 px tall: the top
    // one, moved down, would meet the next at ticks 32 px apart.
    const data = table({ x: [0, 100], y: [0, 100] });
    const tall = build(
      {
        legend: false,
        y: { domain: [0, 100] },
        guides: [
          axis({ scale: "y", format: (v: number) => `${v}\nline`, labels: { overlap: "show" } }),
        ],
        marks: [line(data, { x: "x", y: "y" })],
      },
      400,
      100,
    ).scene;
    expect(leastBetween(axisOf(tall, "left"), "major", false)).toBeGreaterThanOrEqual(0);
    // A second row's labels stay inside the chart's width: those at the ends,
    // moved in, would meet.
    const row = build(
      {
        legend: false,
        x: { domain: [0, 100] },
        guides: [
          axis({
            scale: "x",
            labels: false,
            layers: [
              {
                id: "long",
                ticks: 2,
                format: (v: number) => `long label ${v}`,
                labels: { row: 1 },
                style: { tickLabel: { fontSize: 24 } },
              },
            ],
          }),
        ],
        marks: [line(data, { x: "x", y: "y" })],
      },
      300,
      300,
    ).scene;
    // "long label 0" and "long label 100", 135 and 165 px wide at the ends
    // of the plot, each moved inside the chart, would overlap: the second is
    // left blank.
    const long = axisOf(row, "bottom");
    expect(leastBetween(long, "long", true)).toBeGreaterThanOrEqual(4);
    expect((long.labelBoxes ?? []).map(({ text }) => text)).toEqual(["long label 0"]);
    // A limit: the axis' own labels in a row past the first draw the model's
    // plan, which the model makes along the plot before it stands in the
    // chart, so they are judged at their ticks. Moved inside the chart, the
    // same two labels overlap.
    const own = build(
      {
        legend: false,
        x: { domain: [0, 100] },
        guides: [
          axis({
            scale: "x",
            format: (v: number) => `long label ${v}`,
            labels: { row: 1 },
            style: { tickLabel: { fontSize: 24 } },
          }),
        ],
        marks: [line(data, { x: "x", y: "y" })],
      },
      300,
      300,
    ).scene;
    expect(leastBetween(axisOf(own, "bottom"), "major", true)).toBeLessThan(0);
  });

  it("judge a plan where each panel drawing it stands, its labels moved inside the chart", () => {
    // Two rows of subplots share y; the lower one's last label, moved up
    // inside the chart, would meet the one before it at the top row's fit.
    const data = table({ x: [0, 100], y: [0, 100] });
    const scene = build(
      {
        legend: false,
        x: { show: false },
        y: { domain: [0, 100], ticks: 3 },
        panels: panels([{ id: "a" }, { id: "b" }], grid({ rows: 2 })),
        guides: [axis({ scale: "y", format: (v: number) => `${v}\nline` })],
        marks: [
          line(data, { x: "x", y: "y", panel: "a" }),
          line(data, { x: "x", y: "y", panel: "b" }),
        ],
      },
      400,
      180,
    ).scene;
    for (const panel of [0, 1])
      expect(leastBetween(axisOf(scene, "left", panel), "major", false)).toBeGreaterThanOrEqual(0);
  });

  it("judge labels that ends leaves out at their ticks, not moved inside", () => {
    const data = table({ x: [0, 100], y: [0, 100] });
    const left = axisOf(
      build(
        {
          legend: false,
          y: { domain: [0, 100] },
          guides: [
            axis({ scale: "y", format: (v: number) => `${v}\nline`, labels: { ends: "hide" } }),
          ],
          marks: [line(data, { x: "x", y: "y" })],
        },
        400,
        100,
      ).scene,
      "left",
    );
    // 100's label crosses the chart's top and is left out; 0 and 50 stay.
    expect(left.ticks.map(({ value }) => value)).toEqual([0, 50, 100]);
    expect(labelled(left).map(({ value }) => value)).toEqual([0, 50]);
  });

  it("judge the labels ends keeps where they are drawn, moved inside the chart", () => {
    // 100's ink stays inside the chart, so it is kept; its line box does
    // not, so it moves down toward 80.
    const data = table({ x: [0, 100], y: [0, 100] });
    const left = axisOf(
      build(
        {
          legend: false,
          x: { show: false },
          y: { domain: [0, 100], ticks: 6 },
          guides: [
            axis({
              scale: "y",
              labels: { ends: "hide" },
              style: { tickLabel: { fontSize: 14 } },
            }),
          ],
          marks: [line(data, { x: "x", y: "y" })],
        },
        400,
        102,
      ).scene,
      "left",
    );
    expect(leastBetween(left, "major", false)).toBeGreaterThanOrEqual(0);
  });

  it("keep the labels either side of one ends leaves out apart", () => {
    // 80's ten lines cross the chart's top at its tick, so it is left out;
    // 60's four lines and 100 must still not meet across it.
    const data = table({ x: [0, 100], y: [0, 100] });
    const lines = (v: number, n: number) => Array.from({ length: n }, () => `${v}`).join("\n");
    const left = axisOf(
      build(
        {
          legend: false,
          x: { show: false },
          y: { domain: [0, 100], ticks: 6 },
          guides: [
            axis({
              scale: "y",
              format: (v: number) =>
                v === 100 ? "100" : v === 80 ? lines(80, 10) : v === 60 ? lines(60, 4) : "",
              labels: { ends: "hide" },
              style: { tickLabel: { fontSize: 14 } },
            }),
          ],
          marks: [line(data, { x: "x", y: "y" })],
        },
        400,
        102,
      ).scene,
      "left",
    );
    expect(leastBetween(left, "major", false)).toBeGreaterThanOrEqual(0);
  });

  it("judge rows past the first that ends leaves labels in moved inside the chart", () => {
    // 20's label, kept by ends, reaches within 2 px of the chart's left
    // edge and is moved right, toward 60's: at their ticks they are 4 px
    // apart, as drawn 3. Ticks every 50 label 50 alone.
    const data = table({ x: [0, 100], y: [0, 100] });
    const format = (v: number) =>
      v === 20 ? "A".repeat(158) : v === 60 ? "B".repeat(154) : v === 50 ? "fifty" : "";
    for (const side of ["top", "bottom"] as const) {
      const scene = build(
        {
          legend: false,
          padding: 0,
          y: { show: false },
          x: { domain: [0, 100] },
          guides: [
            axis({
              scale: "x",
              place: { side },
              labels: false,
              layers: [{ id: "row", ticks: 6, format, labels: { row: 1, ends: "hide" } }],
            }),
          ],
          marks: [line(data, { x: "x", y: "y" })],
        },
        400,
        200,
        (text) => text.length,
      ).scene;
      const row = axisOf(scene, side);
      expect(leastBetween(row, "row", true), side).toBeGreaterThanOrEqual(4);
      expect(row.labelBoxes?.map(({ text }) => text)).toEqual(["fifty"]);
    }
  });

  it("fit a row of another height by its own panel", () => {
    // y shared, planned over the shorter row; the taller row's plan, judged
    // where the shorter row stands, would reach past the chart's bottom and
    // keep only its ends.
    const data = table({ x: [0, 100], y: [0, 100] });
    const scene = build(
      {
        legend: false,
        x: { show: false },
        y: { domain: [0, 100], ticks: 8, scope: "chart" },
        panels: panels([{ id: "a" }, { id: "b" }], grid({ rows: [3, 1] })),
        guides: [axis({ scale: "y", format: (v: number) => `${v}\nline` })],
        marks: [
          line(data, { x: "x", y: "y", panel: "a" }),
          line(data, { x: "x", y: "y", panel: "b" }),
        ],
      },
      400,
      400,
    ).scene;
    // The taller row labels more than its ends.
    const drawn = (axisOf(scene, "left", 0).labelBoxes ?? []).filter((b) => b.layer === "major");
    expect(drawn.length).toBeGreaterThan(2);
    for (const panel of [0, 1])
      expect(leastBetween(axisOf(scene, "left", panel), "major", false)).toBeGreaterThanOrEqual(0);
  });

  it("fit a colorbar's own ticks to their labels", () => {
    const spots = table({ x: [0, 1], y: [0, 1], v: [0, 100] });
    const { scene } = build({
      marks: [point(spots, { x: "x", y: "y", color: "v" })],
      guides: [
        colorbar({
          place: { side: "bottom" },
          length: 240,
          ticks: 5,
          format: (v: number) => `${v} long label`,
        }),
      ],
    });
    const texts = guidesOf(scene, "colorbar")[0]!.items.filter(
      (item): item is TextItem => item.type === "text",
    );
    // Every 25 at the count asked, labels about 75 px wide would stand 60 px apart.
    expect(texts.map(({ text }) => text)).toEqual([
      "0 long label",
      "50 long label",
      "100 long label",
    ]);
    const widths = texts.map(({ text, paint }) => estimateText(text, paint.css));
    for (let k = 1; k < texts.length; k++)
      expect(
        texts[k]!.x - widths[k]! / 2 - (texts[k - 1]!.x + widths[k - 1]! / 2),
      ).toBeGreaterThanOrEqual(4);
  });

  it("measure again with a measurer given to another export", () => {
    // One function, measuring wider for the second export.
    let scale = 1;
    const measureText: MeasureText = (text, font) => scale * estimateText(text, font);
    const data = table({ x: [0, 1_000_000], y: [0, 1] });
    const config = {
      width: 600,
      height: 300,
      x: { domain: [0, 1_000_000] as [number, number], ticks: 10 },
      marks: [line(data, { x: "x", y: "y" })],
    };
    const labels = () =>
      [...renderToSVG(config, { measureText }).matchAll(/>(\d+K)<\/text>/g)].map(
        ([, text]) => text,
      );
    expect(labels()).toContain("100K");
    scale = 3;
    const wide = labels();
    expect(wide).not.toContain("100K");
    expect(wide).toContain("200K");
  });

  it("keep at most 5,000 shaped widths a measurer, of every font", () => {
    let calls = 0;
    const measure: MeasureText = (text) => {
      calls++;
      return text.length;
    };
    const shaped = shapedMeasure(measure);
    shaped("first", "12px a");
    for (let k = 0; k < 5000; k++) shaped(`label ${k}`, `${10 + (k % 7)}px a`);
    calls = 0;
    shaped("first", "12px a");
    expect(calls).toBeGreaterThan(0);
  });
});

/** The model's own automatic plan, for planners counting their calls. */
function autoPlan(ticker: PositionScale, count: number): TickPlan {
  const plan = planAxis(
    contextOf(ticker.type === "log" ? "log" : "linear"),
    ticker.domain,
    ticker.range,
    count,
  );
  return { ticks: plan.ticks, labels: plan.labels };
}
