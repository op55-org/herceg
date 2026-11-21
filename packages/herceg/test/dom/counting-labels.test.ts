// Counting labels in value transitions' frames: each number written
// exactly, laid out by its shape (its digits as the zeros of their own
// digits), and its run drawn from the edge its line aligns to, so that a
// race's frames measure only the few shapes a format writes. Scenes, at a
// transition's ends, are laid out exactly as ever.

import { describe, expect, it, vi } from "vitest";
import { category, time } from "../../src/data/column.ts";
import { type Table, table } from "../../src/data/table.ts";
import { shapeOf } from "../../src/dom/value-labels.ts";
import {
  followedOf,
  frameAt,
  plan,
  positionsOf,
  sidesOf,
  snapshot,
  type Tween,
  ValueAnimation,
} from "../../src/dom/value-transition.ts";
import { estimateText, type MeasureText } from "../../src/layout/text.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { bar } from "../../src/marks/bar.ts";
import { monotonePolyline } from "../../src/marks/curve.ts";
import { text } from "../../src/marks/text.ts";
import { planAxis } from "../../src/model/axis.ts";
import { axisGuide } from "../../src/model/axis-guide.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderSvg } from "../../src/render/svg.ts";
import type { LabelsGeometry, Scene, TextGeometry, TextItem } from "../../src/scene/scene.ts";
import type { BarLabelsSpec } from "../../src/spec/spec.ts";

vi.mock("../../src/dom/scheduler.ts", () => ({
  frameCount: () => 0,
  lastFrameTime: () => 0,
  leaveOut: () => {},
}));

/**
 * Widths as Helvetica's, but with proportional digits as system fonts
 * have them: "1" as narrow as "l", every other digit as wide as "0". A
 * number's shape is then wider than its text by each "1" it writes.
 */
const proportional: MeasureText = (text, font) => estimateText(text.replace(/1/g, "l"), font);

/** A measurer that records what it measures. */
function spying(measure = proportional) {
  const seen = new Set<string>();
  const spy: MeasureText = (text, font) => {
    seen.add(text);
    return measure(text, font);
  };
  return { spy, seen };
}

const share = { start: 0, middle: 0.5, end: 1 } as const;
/** Where an item's text is painted along x, measured as the renderer lays it out. */
function painted(item: TextItem, measure = proportional) {
  const width = measure(item.text, item.paint.css);
  const left = item.x - share[item.anchor] * width;
  return { left, middle: left + width / 2, right: left + width };
}

/** A race of brands on a rank scale drawn top down, labeled as `labels` say. */
function race(
  values: number[],
  labels: BarLabelsSpec,
  config: Partial<ChartConfig> = {},
  brands = ["A", "B", "C"],
) {
  const rows = (v: number[]) => ({
    brand: category(brands),
    value: v,
    rank: v.map((_, i) => i),
  });
  const data = table(rows(values)) as unknown as Table;
  const model = new ChartModel(
    {
      locale: "en-US",
      animation: { duration: 200, values: true, easing: "linear" },
      marks: [bar(data as never, { itemKey: "brand", orient: "y", x: "value", y: "rank", labels })],
      x: { domain: [0, 100_000] },
      y: { domain: [brands.length - 0.5, -0.5] },
      ...config,
    },
    undefined,
    staticCompilers(),
  );
  model.setSize(800, 300, 1);
  return { data, model, rows };
}

/**
 * How `model` moves to its next scene after `edit`, measured by `spy`: what
 * the scenes measured, and the tween, whose plan and frames measure with
 * `spy` too.
 */
function change(
  model: ChartModel,
  edit: () => void,
  spy: MeasureText,
  seen: Set<string>,
): { tween: Tween; scenes: Set<string> } {
  const shown = snapshot(model.scene(spy), model.panels(), 0)!;
  edit();
  const scene = model.scene(spy);
  const scenes = new Set(seen);
  const builders = { planAxis, axisGuide, Polyline, monotonePolyline, measure: spy };
  const { config } = model;
  const tween = plan(
    shown,
    scene,
    model.panels(),
    200,
    builders,
    sidesOf(config),
    followedOf(config),
    positionsOf(config),
  )!;
  expect(tween).toBeDefined();
  return { tween, scenes };
}

/** Each label's items in a frame or scene, by its name, from the labels geometry naming it. */
function labelItems(scene: Scene): Map<string | number, TextItem[]> {
  const out = new Map<string | number, TextItem[]>();
  for (const mark of scene.panels[0]!.marks) {
    if (mark.kind !== "labels" || !(mark as LabelsGeometry).named) continue;
    const { items, named } = mark as LabelsGeometry;
    items.forEach((item, k) => {
      const name = named!.names[named!.owners![k]!]!;
      out.set(name, [...(out.get(name) ?? []), item]);
    });
  }
  return out;
}

/** Each label's text and the number it writes in a frame or scene, by its name (text geometry). */
function labelTexts(scene: Scene): Map<string | number, { text: string; value: number }> {
  const out = new Map<string | number, { text: string; value: number }>();
  for (const mark of scene.panels[0]!.marks) {
    const named = (mark as TextGeometry).named;
    if (!named) continue;
    named.names.forEach((name, i) => {
      const written =
        mark.kind === "text"
          ? (mark as TextGeometry).labels[i]!
          : (mark as LabelsGeometry).items
              .filter((_, k) => named.owners![k] === i)
              .map((item) => item.text)
              .join("|");
      out.set(name, { text: written, value: named.values?.[i] ?? Number.NaN });
    });
  }
  return out;
}

/** What a tween's plan and its frames at 10 times measured that its scenes did not. */
function framesMeasure(tween: Tween, seen: Set<string>, scenes: Set<string>): string[] {
  const frames: Scene[] = [];
  for (let ms = 10; ms < 200; ms += 19) frames.push(frameAt(tween, ms));
  return [...seen].filter((text) => !scenes.has(text));
}

const RACE: BarLabelsSpec = {
  content: [
    { field: "brand", style: { fontWeight: 700 } },
    "\n",
    { value: true, format: { number: ",.0f" }, style: { opacity: 0.7 } },
  ],
  place: { outside: false },
  style: { align: "end", halo: false },
};

/** RACE's labels in boxes. */
const BOXED: BarLabelsSpec = {
  ...RACE,
  style: { align: "end", halo: false, background: { fill: "#eeeeee" }, padding: 2 },
};

const grouped = (v: number) => Math.round(v).toLocaleString("en-US");

describe("a number's shape", () => {
  it("writes each decimal digit as the zero of its own digits, everything else kept", () => {
    expect(shapeOf("59,268")).toBe("00,000");
    expect(shapeOf("−1.5 %")).toBe("−0.0 %");
    expect(shapeOf("1.2M")).toBe("0.0M");
    expect(shapeOf("Q3: 1,234")).toBe("Q0: 0,000");
    expect(shapeOf("low")).toBe("low");
    // Arabic-Indic, extended Arabic-Indic, Devanagari, and fullwidth digits.
    expect(shapeOf("١٢٬٣٤٥")).toBe("٠٠٬٠٠٠");
    expect(shapeOf("۷۸۹")).toBe("۰۰۰");
    expect(shapeOf("४२")).toBe("००");
    expect(shapeOf("１２")).toBe("００");
    // A mantissa in the locale's digits and an ASCII exponent keep their families.
    expect(shapeOf("١٫٢٣e+4")).toBe("٠٫٠٠e+0");
    // Mathematical digits run back to back, ten to a family: bold nine, double-struck zero and one.
    expect(shapeOf("\u{1d7d7}\u{1d7d8}\u{1d7d9}")).toBe("\u{1d7ce}\u{1d7d8}\u{1d7d8}");
  });
});

describe("counting labels' frames", () => {
  it("measure only their numbers' shapes and what the scenes measured, writing each number exactly", () => {
    const { spy, seen } = spying();
    const { data, model, rows } = race([59_268, 54_187, 41_000], RACE, {
      x: { domain: [0, 200_000] },
    });
    const { tween, scenes } = change(
      model,
      () => data.reset(rows([162_779, 56_844, 45_111])),
      spy,
      seen,
    );
    const measured = framesMeasure(tween, seen, scenes);
    // Shapes only, a few of them, though frames write a new number every time.
    expect(measured.length).toBeGreaterThan(0);
    expect(measured.every((text) => shapeOf(text) === text)).toBe(true);
    expect(measured.length).toBeLessThanOrEqual(3);
    const frame = frameAt(tween, 77);
    for (const [, { text, value }] of labelTexts(frame)) {
      const [, number] = text.split("|");
      expect(number).toBe(grouped(value));
    }
    // The scene at the end is laid out exactly: the destination's.
    expect(renderSvg(tween.scene, { idPrefix: "c" })).toBe(
      renderSvg(model.scene(proportional), { idPrefix: "c" }),
    );
  });

  it("draw the counting run from the edge its line aligns to: end, start, or middle", () => {
    for (const align of ["end", "start", "center"] as const) {
      const { spy, seen } = spying();
      const { data, model, rows } = race([11_111, 21_111, 31_111], {
        ...RACE,
        style: { align, halo: false },
      });
      const { tween } = change(model, () => data.reset(rows([91_111, 81_111, 71_111])), spy, seen);
      const edge = align === "end" ? "right" : align === "start" ? "left" : "middle";
      for (const ms of [30, 90, 150]) {
        for (const [name, [brand, value]] of labelItems(frameAt(tween, ms))) {
          // The brand's line is measured exactly, so it stands where the block's lines align.
          expect(painted(value!)[edge], `${align} ${name} ${ms}`).toBeCloseTo(
            painted(brand!)[edge],
            3,
          );
        }
      }
    }
  });

  it("draw a unit after a number off by the number's shape on a line aligned to its start, and exact on one aligned to its end", () => {
    for (const align of ["start", "end"] as const) {
      const { spy, seen } = spying();
      const { data, model, rows } = race([11_111, 21_111, 31_111], {
        content: [{ value: true, format: { number: ",.0f" }, style: { fontWeight: 700 } }, " kg"],
        place: { outside: false },
        style: { align, halo: false },
      });
      const { tween } = change(model, () => data.reset(rows([91_111, 81_111, 71_111])), spy, seen);
      const [number, unit] = [...labelItems(frameAt(tween, 100)).values()][0]!;
      const gap = painted(unit!).left - painted(number!).right;
      const error =
        proportional(shapeOf(number!.text), number!.paint.css) -
        proportional(number!.text, number!.paint.css);
      expect(error).toBeGreaterThan(1);
      expect(gap).toBeCloseTo(align === "start" ? error : 0, 3);
      // At the ends, exact either way.
      const [a, b] = [...labelItems(tween.scene).values()][0]!;
      expect(painted(b!).left - painted(a!).right).toBeCloseTo(0, 3);
    }
  });

  it("write signs, digit counts, and SI prefixes exactly, measuring a shape for each", () => {
    const cases = [
      {
        format: { number: ",.0f" },
        from: [-10_000, 999, 5],
        to: [10_000, 1_500, 5_000],
        domain: [-60_000, 60_000],
      },
      {
        format: { number: ".2s" },
        from: [900, 9_500, 120],
        to: [1_500_000, 12_000, 80_000],
        domain: [0, 2_000_000],
      },
    ];
    for (const { format, from, to, domain } of cases) {
      const { spy, seen } = spying();
      const labels: BarLabelsSpec = {
        content: [{ value: true, format, style: { fontWeight: 700 } }],
      };
      const x = { domain: domain as [number, number] };
      const { data, model, rows } = race(from, labels, { x });
      const { tween, scenes } = change(model, () => data.reset(rows(to)), spy, seen);
      const measured = framesMeasure(tween, seen, scenes);
      expect(measured.every((text) => shapeOf(text) === text)).toBe(true);
      // A shape for each sign, digit count, and prefix written: more than one.
      expect(measured.length).toBeGreaterThan(1);
      // Each frame's text is the one a still chart writes for its number.
      for (const ms of [40, 120]) {
        for (const [name, { text: written, value }] of labelTexts(frameAt(tween, ms))) {
          const still = race(
            from.map((v, i) => (i === ["A", "B", "C"].indexOf(name as string) ? value : v)),
            labels,
            { x },
          );
          expect(written).toBe(labelTexts(still.model.scene(proportional)).get(name)!.text);
        }
      }
    }
  });

  it("lay out digits of other families by their own zeros: Arabic-Indic, scientific, and times", () => {
    const { spy, seen } = spying();
    const { data, model, rows } = race(
      [12_345, 23_456, 34_567],
      {
        content: [
          { value: true, format: { number: ",.0f" }, style: { fontWeight: 700 } },
          " ",
          { value: true, format: { number: ".2e" } },
        ],
      },
      { locale: "ar-EG" },
    );
    const { tween, scenes } = change(
      model,
      () => data.reset(rows([45_678, 56_789, 67_891])),
      spy,
      seen,
    );
    const measured = framesMeasure(tween, seen, scenes);
    expect(measured.length).toBeGreaterThan(0);
    for (const text of measured) {
      expect(shapeOf(text)).toBe(text);
      expect(text).toContain("٠");
    }
    // Times: their fields in the locale's digits or in ASCII, each family to its own zero.
    const start = Date.UTC(2026, 0, 19, 3, 4);
    const times = table({ k: category(["a", "b"]), at: time([start, start + 3_600_000]) });
    const clock = new ChartModel(
      {
        locale: "ar-EG",
        timeZone: "UTC",
        animation: { duration: 200, values: true },
        marks: [
          bar(times, {
            x: "k",
            y: "at",
            labels: {
              content: [{ value: true, format: { time: "%H:%M" }, style: { fontWeight: 700 } }],
            },
          }),
        ],
      },
      undefined,
      staticCompilers(),
    );
    clock.setSize(800, 300, 1);
    const watch = spying();
    const moved = change(
      clock,
      () => times.setColumn("at", Float64Array.of(start + 7_200_000, start + 9_000_000)),
      watch.spy,
      watch.seen,
    );
    const shapes = framesMeasure(moved.tween, watch.seen, moved.scenes);
    expect(shapes.length).toBeGreaterThan(0);
    expect(shapes.every((text) => shapeOf(text) === text)).toBe(true);
  });

  it("measure a mapped display's words as they are, counting through the values between", () => {
    const { spy, seen } = spying();
    const labels: BarLabelsSpec = {
      place: { outside: false },
      style: { align: "end", halo: false },
    };
    const { data, model, rows } = race([10_000, 20_000, 30_000], labels, {
      fields: {
        value: {
          mappings: [
            { between: [0, 50_000], text: "low" },
            { between: [50_000, null], text: "high" },
          ],
        },
      },
    });
    const { tween, scenes } = change(
      model,
      () => data.reset(rows([90_000, 80_000, 70_000])),
      spy,
      seen,
    );
    const words = new Set<string>();
    for (let ms = 10; ms < 200; ms += 19)
      for (const [, { text: written }] of labelTexts(frameAt(tween, ms))) words.add(written);
    // Written through the display, low before high, measured as they are (they have no shape).
    expect([...words].sort()).toEqual(["high", "low"]);
    expect(framesMeasure(tween, seen, scenes).filter((t) => !words.has(t))).toEqual([]);
  });

  it("count bars' unstyled content, plain, boxed, or in lines aligned away from their place", () => {
    const looks = [
      undefined,
      { background: { fill: "#eeeeee" }, padding: 2 },
      { align: "end" as const, halo: false as const },
    ];
    for (const style of looks) {
      const { spy, seen } = spying();
      const { data, model, rows } = race([11_111, 21_111, 31_111], {
        content: ["Q3: ", { value: true, format: { number: ",.0f" } }],
        place: { outside: false },
        ...(style && { style }),
      });
      const { tween, scenes } = change(
        model,
        () => data.reset(rows([91_111, 81_111, 71_111])),
        spy,
        seen,
      );
      const frame = frameAt(tween, 100);
      for (const [, { text: written, value }] of labelTexts(frame))
        expect(written).toBe(`Q3: ${grouped(value)}`);
      // The literal's digit is shaped with the number's: the content is one string.
      const measured = framesMeasure(tween, seen, scenes);
      expect(measured.every((t) => shapeOf(t) === t && t.startsWith("Q0: "))).toBe(true);
      if (style?.background) {
        for (const [, [item]] of labelItems(frame)) {
          const box = item!.box!;
          expect(box.width).toBeCloseTo(proportional(shapeOf(item!.text), item!.paint.css) + 4, 3);
        }
      }
      if (!style) expect(measured).toEqual([]);
    }
  });

  it("leave still labels that write no value, their text the new scene's", () => {
    const { spy, seen } = spying();
    const { data, model, rows } = race([10_000, 20_000, 30_000], {
      content: [{ field: "brand", style: { fontWeight: 700 } }],
      place: { outside: false },
    });
    const { tween } = change(model, () => data.reset(rows([90_000, 80_000, 70_000])), spy, seen);
    // Bars move; their labels move with them, not written again.
    expect(tween.panels[0]!.labels[0]!.values.every(Number.isNaN)).toBe(true);
    // A text mark of words alone, its values unchanged, makes no transition.
    const notes = table({ x: [1, 2], y: [1, 2], note: category(["a", "b"]) });
    const words = new ChartModel(
      {
        locale: "en-US",
        animation: { duration: 200, values: true },
        marks: [text(notes, { x: "x", y: "y", label: { field: "note" } })],
      },
      undefined,
      staticCompilers(),
    );
    words.setSize(400, 300, 1);
    const shown = snapshot(words.scene(proportional), words.panels(), 0)!;
    notes.setColumn("y", [1, 2]);
    expect(
      plan(shown, words.scene(proportional), words.panels(), 200, {
        planAxis,
        axisGuide,
        Polyline,
        monotonePolyline,
        measure: proportional,
      }),
    ).toBeUndefined();
  });

  /**
   * A race of `labels` moving from `values` to `to`, interrupted half way
   * by a change to `then`: the frame half way, the next change's first
   * frame, its last, and the scene it ends on, laid out again.
   */
  function interrupted(values: number[], to: number[], then: number[], labels = RACE) {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { data, model, rows } = race(values, labels);
    const builders = { planAxis, axisGuide, Polyline, monotonePolyline, measure: proportional };
    const animation = new ValueAnimation(model, null, model.scene(proportional), builders);
    const reset = { dropped: 0, appended: 0, updated: null, fields: [], reset: true };
    animation.changed(animation.start(model.scene(proportional), 0), reset, 0);
    data.reset(rows(to));
    animation.start(model.scene(proportional), 0);
    now.mockReturnValue(100);
    const passing = animation.step(0)!;
    animation.changed(passing, reset, 0);
    data.reset(rows(then));
    const first = animation.start(model.scene(proportional), 0)!;
    now.mockReturnValue(1_000);
    const end = animation.step(0)!;
    const scene = model.scene(proportional);
    vi.restoreAllMocks();
    return { passing, first, end, scene };
  }

  it("move on from the frame drawn when values change again, ending as the new scene is laid out", () => {
    // Interrupted past 10,000 the other way: back under 10,000, a digit fewer.
    const { passing, first, end, scene } = interrupted(
      [9_100, 8_100, 7_100],
      [19_900, 9_200, 7_300],
      [9_050, 9_200, 7_300],
    );
    const half = labelTexts(passing).get("A")!.value;
    expect(half).toBeGreaterThan(9_100);
    expect(half).toBeLessThan(19_900);
    expect(labelTexts(first).get("A")!.value).toBeCloseTo(half, 6);
    const [, number] = labelItems(first).get("A")!;
    expect(number!.text).toBe(grouped(half));
    expect(renderSvg(end, { idPrefix: "c" })).toBe(renderSvg(scene, { idPrefix: "c" }));
  });

  it("keep where an interrupted label's text starts as it turns into its bar, laid out by its shape", () => {
    // Past its bar's end at 82,111 (eased), then inside it as it goes to 99,111.
    const outside: BarLabelsSpec = { content: BOXED.content!, style: BOXED.style! };
    const { passing, first, end, scene } = interrupted(
      [19_111, 21_111, 31_111],
      [91_111, 81_111, 71_111],
      [99_111, 60_000, 70_000],
      outside,
    );
    const anchorOf = (frame: Scene) =>
      (
        frame.panels[0]!.marks.find((m) =>
          (m as LabelsGeometry).named?.names.includes("A"),
        ) as LabelsGeometry
      ).named!.anchor;
    expect([anchorOf(passing), anchorOf(first), anchorOf(scene)]).toEqual(["start", "end", "end"]);
    const [box, number] = labelItems(passing).get("A")!;
    const [again, returned] = labelItems(first).get("A")!;
    expect(returned!.text).toBe(number!.text);
    expect(again!.box!.x).toBeCloseTo(box!.box!.x, 3);
    expect(again!.box!.width).toBeCloseTo(box!.box!.width, 3);
    expect(painted(returned!).right).toBeCloseTo(painted(number!).right, 3);
    expect(renderSvg(end, { idPrefix: "c" })).toBe(renderSvg(scene, { idPrefix: "c" }));
  });

  it("keep the shape of a label going out with its bar, coming back at the number it shows", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const { data, model, rows } = race([11_111, 21_111, 31_111], BOXED);
    const builders = { planAxis, axisGuide, Polyline, monotonePolyline, measure: proportional };
    const animation = new ValueAnimation(model, null, model.scene(proportional), builders);
    const reset = { dropped: 0, appended: 0, updated: null, fields: [], reset: true };
    const step = (at: number, rows: object) => {
      animation.changed(animation.step(0) ?? model.scene(proportional), reset, 0);
      data.reset(rows as never);
      const first = animation.start(model.scene(proportional), 0)!;
      now.mockReturnValue(at);
      return first;
    };
    animation.changed(animation.start(model.scene(proportional), 0), reset, 0);
    data.reset(rows([91_111, 81_111, 71_111]));
    animation.start(model.scene(proportional), 0);
    now.mockReturnValue(100);
    // A counts to 81,111, then goes out with its bar, then comes back at 81,111.
    step(150, { brand: category(["B", "C"]), value: [60_000, 70_000], rank: [0, 1] });
    const going = animation.step(0)!;
    const back = step(2_000, rows([81_111, 60_000, 70_000]));
    const [box, number] = labelItems(going).get("A")!;
    const [again, returned] = labelItems(back).get("A")!;
    expect(returned!.text).toBe("81,111");
    expect(painted(returned!).right).toBeCloseTo(painted(number!).right, 3);
    expect(again!.box!.width).toBeCloseTo(box!.box!.width, 3);
    const end = animation.step(0)!;
    expect(renderSvg(end, { idPrefix: "c" })).toBe(
      renderSvg(model.scene(proportional), { idPrefix: "c" }),
    );
    vi.restoreAllMocks();
  });

  it("go on laying out by its shape a label interrupted where its new number is the one it shows", () => {
    // A shows 81,111 half way (eased), then moves to 81,111 while the others change.
    const { passing, first, end, scene } = interrupted(
      [11_111, 21_111, 31_111],
      [91_111, 81_111, 71_111],
      [81_111, 60_000, 70_000],
      BOXED,
    );
    const before = labelItems(passing).get("A")!;
    const after = labelItems(first).get("A")!;
    expect(after[1]!.text).toBe("81,111");
    expect(painted(after[1]!).right).toBeCloseTo(painted(before[1]!).right, 3);
    expect(after[0]!.box!.width).toBeCloseTo(before[0]!.box!.width, 3);
    // It ends laid out exactly, narrower by the shape's error.
    const [still] = labelItems(end).get("A")!;
    expect(still!.box!.width).toBeLessThan(before[0]!.box!.width - 1);
    expect(renderSvg(end, { idPrefix: "c" })).toBe(renderSvg(scene, { idPrefix: "c" }));
  });
});
