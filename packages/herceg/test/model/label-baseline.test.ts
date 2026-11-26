// verticalAlign: "baseline" on marks' labels: the first line's alphabetic
// baseline at the label's point, later lines a line height below, the
// block's box (backgrounds, halos, keeping apart, staying inside the chart)
// reaching half a line and half the font's x-height above it; on text
// marks, rules', regions', and series' labels, and labels of parts. Style
// roles, titles, and tick labels refuse it.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { textItemMarkup } from "../../src/draw/text.ts";
import { baseline } from "../../src/layout/baseline.ts";
import {
  canvasMeasurer,
  estimateText,
  type MeasureText,
  type MeasuringContext,
  parseFont,
} from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { needsFeatures } from "../../src/model/features.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { textBox as pickedBox } from "../../src/model/pick.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { LabelsGeometry, Rect, SegmentGeometry } from "../../src/scene/scene.ts";
import type { ChartSpec, LabelStyle } from "../../src/spec/spec.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { textPaint } from "../../src/style/style.ts";
import { LIGHT } from "../../src/theme.ts";
import { contractTest } from "../helpers/contracts.ts";
import { xScale, yScale } from "../helpers/scales.ts";

const rows = table({ t: [0, 5, 10], v: [20, 60, 40] });
const domains = { x: { domain: [0, 10] }, y: { domain: [0, 100] } } as const;

/** A measurer whose fonts' "x" is `share` of their size tall, counting the "x"s it measures. */
function measured(share: number): MeasureText & { xs: number } {
  const context: MeasuringContext & { xs: number } = {
    font: "",
    xs: 0,
    measureText(this: MeasuringContext & { xs: number }, text: string) {
      const size = parseFont(this.font).size;
      if (text === "x") this.xs++;
      return {
        width: estimateText(text, this.font),
        actualBoundingBoxAscent: share * size,
        fontBoundingBoxAscent: 0.9 * size,
        fontBoundingBoxDescent: 0.2 * size,
      };
    },
  };
  const measure = canvasMeasurer(context);
  return Object.defineProperty(measure, "xs", { get: () => context.xs }) as MeasureText & {
    xs: number;
  };
}

function build(
  config: ChartConfig,
  measure: MeasureText = estimateText,
  width = 400,
  height = 300,
) {
  const model = new ChartModel(
    { locale: "en-US", legend: false, ...domains, ...config },
    undefined,
    staticCompilers(),
  );
  model.setSize(width, height, 1);
  const scene = model.scene(measure);
  const items = scene.panels[0]!.marks.flatMap((g) =>
    g.kind === "labels" ? [...(g as LabelsGeometry).items] : [],
  );
  return { model, scene, items };
}

/** Where `[x, y]` in data is in pixels. */
function at(model: ChartModel, x: number, y: number): [number, number] {
  return [xScale(model)!.map(x), yScale(model)!.map(y)];
}

/** The theme's 12 px text in 15 px lines: its baseline 7.5 px and half an x-height below a line's top. */
const LINE = 15;
const FIRST = (LINE + 0.52 * 12) / 2;

describe("text placed by its baseline", () => {
  contractTest("label.baseline.text", () => {
    for (const align of ["start", "center", "end"] as const)
      for (const label of ["Peak", "Peak\nload"]) {
        const style: LabelStyle = { align, verticalAlign: "baseline" };
        const { model, items } = build({
          marks: [
            line(rows, { x: "t", y: "v" }),
            text({ x: 5, y: 50, label: { text: label, style } }),
          ],
        });
        const [x, y] = at(model, 5, 50);
        expect(items).toHaveLength(1);
        const item = items[0]!;
        // The first line's alphabetic baseline at the point, drawn as such.
        expect(item).toMatchObject({ text: label, baseline: "alphabetic", angle: 0 });
        expect(item.y).toBeCloseTo(y, 9);
        expect(item.x).toBeCloseTo(x, 9);
        expect(item.anchor).toBe(align === "center" ? "middle" : align);
        // Its line box reaches half a line and half an x-height above it.
        expect(item.above).toBeCloseTo(FIRST, 9);
      }
    // In SVG, no dominant-baseline: the first line's baseline at y, the next a line below.
    const { model, items } = build({
      marks: [
        line(rows, { x: "t", y: "v" }),
        text({ x: 5, y: 50, label: { text: "Peak\nload", style: { verticalAlign: "baseline" } } }),
      ],
    });
    const y = at(model, 5, 50)[1];
    const svg = textItemMarkup(items[0]!, LIGHT);
    const element = /<text[^>]*>(<tspan[^>]*>Peak<\/tspan><tspan[^>]*>load<\/tspan>)<\/text>/.exec(
      svg,
    );
    expect(element).not.toBeNull();
    expect(element![0]).not.toContain("dominant-baseline");
    const ys = [...element![1]!.matchAll(/y="([\d.-]+)"/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBeCloseTo(y, 2);
    expect(ys[1]).toBeCloseTo(y + LINE, 2);
  });

  contractTest("label.baseline.measured", () => {
    // The x-height is the measuring context's: an "x" 0.5 em tall puts the
    // line's top 7.5 + 3 px above the baseline; read once for each label's
    // paint (a series label's is its own, in its series' color).
    const measure = measured(0.5);
    const names = ["a", "b", "c", "d", "e", "f"];
    const lines = table({
      t: names.flatMap(() => [0, 10]),
      v: names.flatMap((_, k) => [10 + k * 12, 12 + k * 12]),
      name: names.flatMap((name) => [name, name]),
    });
    const { items } = build(
      {
        marks: [
          line(lines, {
            x: "t",
            y: "v",
            color: "name",
            labels: { at: "last", overlap: "show", style: { verticalAlign: "baseline" } },
          }),
          text({ x: 5, y: 50, label: { text: "Peak", style: { verticalAlign: "baseline" } } }),
        ],
      },
      measure,
    );
    expect(items).toHaveLength(7);
    for (const item of items) expect(item.above).toBeCloseTo((LINE + 6) / 2, 9);
    // A text mark's 50 labels share one paint: read once for it in each
    // layout pass, not once for each label.
    const read = measure.xs;
    const rowsOf = table({ t: Array.from({ length: 50 }, (_, i) => i / 5), v: Array(50).fill(50) });
    build(
      {
        marks: [
          line(rows, { x: "t", y: "v" }),
          text(rowsOf, {
            x: "t",
            y: "v",
            label: { text: "x", style: { verticalAlign: "baseline" } },
          }),
        ],
      },
      measure,
    );
    expect(measure.xs - read).toBeGreaterThan(0);
    expect(measure.xs - read).toBeLessThanOrEqual(2);
    // Leaders read nothing more: a line's middle is its x-height's, so the
    // two labels moved apart from one point draw leaders to their blocks'
    // middles.
    const meeting = table({ t: [0, 10, 0, 10], v: [40, 50, 60, 50], name: ["a", "a", "b", "b"] });
    const reads = (leader: boolean) => {
      const before = measure.xs;
      const built = build(
        {
          marks: [
            line(meeting, {
              x: "t",
              y: "v",
              color: "name",
              labels: { at: "last", overlap: "move", leader, style: { verticalAlign: "baseline" } },
            }),
          ],
        },
        measure,
      );
      return { ...built, read: measure.xs - before };
    };
    const led = reads(true);
    expect(led.read).toBe(reads(false).read);
    const ends = led.scene.panels[0]!.marks.flatMap((g) =>
      g.kind === "segments" ? [(g as SegmentGeometry).coords[3]!] : [],
    );
    const middles = led.items.map((item) => {
      const box = pickedBox(item, { measure });
      return box.y + box.height / 2;
    });
    expect(ends).toHaveLength(2);
    for (const [k, end] of ends.entries()) expect(end).toBeCloseTo(middles[k]!, 3);
    // A static export, measuring with built-in estimates, takes 0.52 em.
    const paint = textPaint([{ fontSize: 20, lineHeight: 2, verticalAlign: "baseline" }]);
    expect(baseline(paint, { measure: estimateText })!.top(undefined)).toBeCloseTo(
      (40 + 0.52 * 20) / 2,
      9,
    );
  });

  contractTest("label.baseline.box", () => {
    // A box's top its padding above the first line's box: the baseline at
    // the point whatever the padding, at every alignment.
    const padding = { top: 6, right: 5, bottom: 2, left: 3 };
    for (const align of ["start", "center", "end"] as const) {
      const { model, items } = build({
        marks: [
          line(rows, { x: "t", y: "v" }),
          text({
            x: 5,
            y: 50,
            label: {
              text: "Peak\nload",
              style: {
                align,
                verticalAlign: "baseline",
                background: { fill: "#eeeeee" },
                padding,
              },
            },
          }),
        ],
      });
      const [x, y] = at(model, 5, 50);
      const item = items[0]!;
      const box = item.box!;
      expect(item.y).toBeCloseTo(y, 9);
      expect(box.y).toBeCloseTo(y - FIRST - padding.top, 9);
      expect(box.height).toBeCloseTo(2 * LINE + padding.top + padding.bottom, 9);
      const width =
        Math.max(estimateText("Peak", item.paint.css), estimateText("load", item.paint.css)) +
        padding.left +
        padding.right;
      expect(box.width).toBeCloseTo(width, 9);
      // The box's side (or middle) at the point, the text moved in by its padding.
      const edge =
        align === "start" ? box.x : align === "end" ? box.x + box.width : box.x + width / 2;
      expect(edge).toBeCloseTo(x, 9);
      const dx =
        align === "start"
          ? padding.left
          : align === "end"
            ? -padding.right
            : (padding.left - padding.right) / 2;
      expect(item.x).toBeCloseTo(x + dx, 9);
    }
    // A rule's label in a box: the baseline 4 px above the rule, the text
    // moved in from the rule's start by its padding, the box about it.
    const ruled = build({
      marks: [
        rule({
          y: 50,
          label: {
            text: "SLO",
            place: { attachment: "start" },
            style: { verticalAlign: "baseline", background: { fill: "#eeeeee" }, padding },
          },
        }),
      ],
    });
    const [left, y] = at(ruled.model, 0, 50);
    const labelled = ruled.items[0]!;
    expect(labelled).toMatchObject({ baseline: "alphabetic", above: FIRST });
    expect(labelled.y).toBeCloseTo(y - 4, 9);
    expect(labelled.x).toBeCloseTo(left + 4 + padding.left, 9);
    expect(labelled.box!.y).toBeCloseTo(labelled.y - FIRST - padding.top, 9);
    expect(labelled.box!.x).toBeCloseTo(left + 4, 9);
    // Picking and anchors take the line box, not an ascent.
    const { items } = build({
      marks: [
        line(rows, { x: "t", y: "v" }),
        text({
          x: 5,
          y: 50,
          label: { text: "Peak", style: { verticalAlign: "baseline", lineHeight: 3 } },
        }),
      ],
    });
    const item = items[0]!;
    const picked = pickedBox(item, { measure: estimateText });
    expect(picked.y).toBeCloseTo(item.y - (36 + 0.52 * 12) / 2, 9);
    expect(picked.height).toBe(36);
  });

  contractTest("label.baseline.move", () => {
    // Labels that move keep apart as with other alignments, the baseline
    // moving with its block: two at one point, in boxes, never overlap, and
    // each box stands where its baseline puts it.
    const style: LabelStyle = {
      verticalAlign: "baseline",
      background: { fill: "#eeeeee" },
      padding: { top: 4, bottom: 1 },
    };
    const notes = table({ t: [5, 5], v: [50, 50], note: ["first", "second"] });
    const { items } = build({
      marks: [
        line(rows, { x: "t", y: "v" }),
        text(notes, { x: "t", y: "v", label: { field: "note", overlap: "move", style } }),
      ],
    });
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.box!.y).toBeCloseTo(item.y - FIRST - 4, 9);
    const [a, b] = items.map((item) => item.box!) as [Rect, Rect];
    const apart =
      a.y + a.height <= b.y + 1e-9 ||
      b.y + b.height <= a.y + 1e-9 ||
      a.x + a.width <= b.x ||
      b.x + b.width <= a.x;
    expect(apart).toBe(true);
    // A text mark's labels without a box or styled parts keep apart by
    // their text, as "middle" ones do: in 36 px lines, 26.4 px apart,
    // neither moves. Labels of styled parts keep apart by their rows.
    const tall = table({ t: [5, 5], v: [50, 40], note: ["first", "second"] });
    const ys = (verticalAlign: "middle" | "baseline", styled = false) =>
      build({
        marks: [
          line(rows, { x: "t", y: "v" }),
          text(tall, {
            x: "t",
            y: "v",
            label: {
              ...(styled
                ? { content: [{ field: "note", style: { color: "#ff0000" } }] }
                : { field: "note" }),
              overlap: "move",
              style: { verticalAlign, lineHeight: 3, halo: false },
            },
          }),
        ],
      }).items.map((item) => item.y);
    const { model } = build({ marks: [line(rows, { x: "t", y: "v" })] });
    const points = [at(model, 5, 50)[1], at(model, 5, 40)[1]];
    expect(ys("baseline")).toEqual(points);
    expect(ys("middle")).toEqual(points);
    const [first, second] = ys("baseline", true) as [number, number];
    expect(second - first).toBeGreaterThanOrEqual(36);
  });

  contractTest("label.baseline.inside", () => {
    // Without a clip, text stays inside the chart: a label whose block would
    // cross the chart's top goes below its point, its baseline with its
    // block; one moving at the chart's edge keeps inside it too.
    for (const overlap of ["show", "move"] as const) {
      const { items } = build({
        marks: [
          line(rows, { x: "t", y: "v" }),
          text({
            x: { px: 100, frame: "chart" },
            y: { px: 3, frame: "chart" },
            label: {
              text: "Edge",
              overlap,
              style: { verticalAlign: "baseline", background: { fill: "#eeeeee" }, padding: 2 },
            },
          }),
        ],
      });
      const item = items[0]!;
      const box = item.box!;
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeCloseTo(item.y - FIRST - 2, 9);
      expect(item.y).toBeGreaterThan(3);
    }
  });

  contractTest("label.baseline.parts", () => {
    // Labels of parts lay out rows each as tall as its tallest part: the
    // first row's baseline at the point, whatever its parts' sizes.
    const { model, items } = build({
      marks: [
        line(rows, { x: "t", y: "v" }),
        text(table({ t: [5], v: [50], name: ["North"], total: [1200] }), {
          x: "t",
          y: "v",
          label: {
            content: [
              { field: "name", style: { fontSize: 24 } },
              " ",
              { field: "total", style: { fontSize: 10 } },
              "\n",
              { field: "total", style: { fontSize: 8 } },
            ],
            style: {
              verticalAlign: "baseline",
              background: { fill: "#eeeeee" },
              padding: { top: 5 },
            },
          },
        }),
      ],
    });
    const y = at(model, 5, 50)[1];
    const drawn = items.filter((item) => item.paint.color !== "transparent");
    const first = drawn.filter((item) => item.paint.size !== 8);
    // The name, the space after it, and the total.
    expect(first.map((item) => item.paint.size).sort()).toEqual([10, 12, 24]);
    for (const item of first) expect(item.y).toBeCloseTo(y, 9);
    // The second row's baseline its own row below, and the box from the block's top.
    const second = drawn.find((item) => item.paint.size === 8)!;
    const tall = Math.round(24 * 1.25);
    const small = Math.round(8 * 1.25);
    const firstBaseline = tall / 2 + 24 * 0.27;
    expect(second.y).toBeCloseTo(y - firstBaseline + tall + small / 2 + 8 * 0.27, 9);
    const box = items.find((item) => item.box)!.box!;
    expect(box.y).toBeCloseTo(y - firstBaseline - 5, 9);
  });
});

describe("marks' labels placed by their baseline", () => {
  contractTest("label.baseline.rule", () => {
    const style: LabelStyle = { verticalAlign: "baseline" };
    // Above a horizontal rule, where its block's bottom is by default: 4 px up.
    const above = build({ marks: [rule({ y: 50, label: { text: "SLO", style } })] });
    const y = at(above.model, 0, 50)[1];
    expect(above.items[0]).toMatchObject({ baseline: "alphabetic", above: FIRST });
    expect(above.items[0]!.y).toBeCloseTo(y - 4, 9);
    // Outside the plot, beside its end, on the rule's height.
    const outside = build({
      marks: [rule({ y: 50, label: { text: "SLO", style, place: { outside: true } } })],
    });
    expect(outside.items[0]!.y).toBeCloseTo(y, 9);
    // Beside a vertical rule, 4 px below its start; at the plot's top, its
    // block is kept inside the plot, the baseline moving with it.
    const vertical = build({
      marks: [rule({ x: 5, span: [{ data: 20 }, { data: 80 }], label: { text: "deploy", style } })],
    });
    expect(vertical.items[0]!.y).toBeCloseTo(at(vertical.model, 5, 80)[1] + 4, 9);
    expect(vertical.items[0]!.x).toBeCloseTo(at(vertical.model, 5, 0)[0] + 4, 9);
    const kept = build({ marks: [rule({ x: 5, label: { text: "deploy", style } })] });
    const plot = kept.scene.panels[0]!.plot;
    expect(kept.items[0]!.y).toBeCloseTo(plot.y + FIRST, 9);
    // A rule's label of several lines, its first line's baseline there.
    const two = build({ marks: [rule({ y: 50, label: { text: "SLO\n250 ms", style } })] });
    expect(two.items[0]!.y).toBeCloseTo(y - 4, 9);
  });

  contractTest("label.baseline.region", () => {
    const style: LabelStyle = { verticalAlign: "baseline" };
    // Inside its top edge, 4 px down; outside it, 4 px up; on a side edge at its start.
    const inside = build({ marks: [region({ y1: 20, y2: 80, label: { text: "band", style } })] });
    const top = at(inside.model, 0, 80)[1];
    expect(inside.items[0]).toMatchObject({ baseline: "alphabetic", above: FIRST });
    expect(inside.items[0]!.y).toBeCloseTo(top + 4, 9);
    const outside = build({
      marks: [region({ y1: 20, y2: 80, label: { text: "band", style, place: { outside: true } } })],
    });
    expect(outside.items[0]!.y).toBeCloseTo(top - 4, 9);
    const bottom = build({
      marks: [
        region({ y1: 20, y2: 80, label: { text: "band", style, place: { side: "bottom" } } }),
      ],
    });
    expect(bottom.items[0]!.y).toBeCloseTo(at(bottom.model, 0, 20)[1] - 4, 9);
    const side = build({
      marks: [region({ y1: 20, y2: 80, label: { text: "band", style, place: { side: "left" } } })],
    });
    expect(side.items[0]!.y).toBeCloseTo(top + 4, 9);
  });

  contractTest("label.baseline.series", () => {
    const style: LabelStyle = { verticalAlign: "baseline" };
    // Inside, after its last point by 4 px and its offset, its baseline on the point's height.
    const inside = build({
      marks: [line(rows, { x: "t", y: "v", labels: { at: "last", style, place: { offset: 2 } } })],
      x: { domain: [0, 12] },
    });
    const [x, y] = at(inside.model, 10, 40);
    expect(inside.items[0]).toMatchObject({ baseline: "alphabetic", above: FIRST });
    expect(inside.items[0]!.y).toBeCloseTo(y, 9);
    expect(inside.items[0]!.x).toBeCloseTo(x + 6, 9);
    // Outside, in its track at the point's height.
    const outside = build({
      marks: [
        line(rows, { x: "t", y: "v", labels: { at: "last", style, place: { outside: true } } }),
      ],
    });
    const plot = outside.scene.panels[0]!.plot;
    expect(outside.items[0]!.y).toBeCloseTo(at(outside.model, 10, 40)[1], 9);
    expect(outside.items[0]!.x).toBeGreaterThan(plot.x + plot.width);
    // Centered on its point, it sits there.
    const centered = build({
      marks: [
        line(rows, {
          x: "t",
          y: "v",
          labels: { at: "last", style: { ...style, align: "center" } },
        }),
      ],
      x: { domain: [0, 12] },
    });
    expect(centered.items[0]!.y).toBeCloseTo(at(centered.model, 10, 40)[1], 9);
    // Text following a series, and a box, padding above.
    const following = build({
      marks: [
        line(rows, { x: "t", y: "v", id: "l" }),
        text({
          from: { mark: "l", at: "last" },
          label: {
            text: "p99",
            style: { ...style, background: { fill: "#eeeeee" }, padding: { top: 3 } },
          },
        }),
      ],
      x: { domain: [0, 12] },
    });
    const item = following.items[0]!;
    expect(item.y).toBeCloseTo(at(following.model, 10, 40)[1], 9);
    expect(item.box!.y).toBeCloseTo(item.y - FIRST - 3, 9);
  });

  it("move nothing that does not ask for the baseline", () => {
    // Middle-aligned labels draw by their middles, as before.
    const { items } = build({
      marks: [rule({ y: 50, label: { text: "SLO", style: { verticalAlign: "bottom" } } })],
    });
    expect(items[0]).toMatchObject({ baseline: "middle" });
    expect(items[0]!.above).toBeUndefined();
  });

  it("load the feature compiler only for labels placed by their baseline", () => {
    // The placing comes with the compiler; other labels draw without it.
    for (const verticalAlign of ["baseline", "bottom"] as const) {
      const style: LabelStyle = { verticalAlign };
      const label = { text: "SLO", style };
      const needs = +(verticalAlign === "baseline");
      expect(needsFeatures({ marks: [rule({ y: 50, label })] })).toBe(needs);
      expect(needsFeatures({ marks: [region({ y1: 20, y2: 80, label })] })).toBe(needs);
      expect(needsFeatures({ marks: [text({ x: 5, y: 50, label })] })).toBe(needs);
    }
  });
});

describe("what refuses the baseline", () => {
  const spec = (extra: object): ChartSpec =>
    ({
      version: 1,
      data: { metrics: { columns: { t: [0, 1], v: [1, 2] } } },
      marks: [{ type: "line", data: "metrics", x: "t", y: "v" }],
      ...extra,
    }) as unknown as ChartSpec;
  const thrown = (value: ChartSpec) => {
    try {
      validateSpec(value);
    } catch (error) {
      return error as { path?: string; message: string };
    }
    return undefined;
  };

  contractTest("label.baseline.refused.spec", () => {
    // Marks' labels take it.
    const label = { text: "Peak", style: { verticalAlign: "baseline" } };
    expect(
      thrown(
        spec({
          marks: [
            {
              type: "line",
              data: "metrics",
              x: "t",
              y: "v",
              labels: { at: "last", style: label.style },
            },
            { type: "text", x: 0, y: 1, label },
            { type: "rule", y: 1, label },
            { type: "region", y1: 0, y2: 1, label },
          ],
        }),
      ),
    ).toBeUndefined();
    // "alphabetic" is no alignment.
    expect(
      thrown(
        spec({
          marks: [
            {
              type: "text",
              x: 0,
              y: 1,
              label: { text: "A", style: { verticalAlign: "alphabetic" } },
            },
          ],
        }),
      ),
    ).toMatchObject({
      path: "marks[0].label.style.verticalAlign",
      message:
        'marks[0].label.style.verticalAlign: expected "top", "middle", "bottom", or "baseline"; received "alphabetic"',
    });
    // Tick labels align at their ticks; roles every text inherits from refuse it.
    expect(
      thrown(
        spec({
          guides: [
            { type: "axis", scale: "x" },
            { type: "axis", scale: "y", style: { tickLabel: { verticalAlign: "baseline" } } },
          ],
        }),
      ),
    ).toMatchObject({
      path: "guides[1].style.tickLabel.verticalAlign",
      message:
        'guides[1].style.tickLabel.verticalAlign: "baseline" places a mark\'s label by a point; tick labels align "top", "middle", or "bottom" at their ticks',
    });
    expect(
      thrown(spec({ theme: { style: { text: { verticalAlign: "baseline" } } } })),
    ).toMatchObject({
      path: "theme.style.text.verticalAlign",
      message:
        "theme.style.text.verticalAlign: \"baseline\" places a mark's label by a point; give it in the label's style",
    });
    expect(
      thrown(
        spec({
          layout: { type: "rows", panels: [{ id: "a" }] },
          panels: [{ id: "a", style: { tickLabel: { verticalAlign: "baseline" } } }],
          marks: [{ type: "line", data: "metrics", x: "t", y: "v", panel: "a" }],
        }),
      ),
    ).toMatchObject({ path: "panels[0].style.tickLabel.verticalAlign" });
    // Titles and bars' labels, which are not placed by a point, take three.
    expect(
      thrown(spec({ title: { text: "T", style: { verticalAlign: "baseline" } } })),
    ).toMatchObject({
      message:
        'title.style.verticalAlign: expected "top", "middle", or "bottom"; received "baseline"',
    });
  });
});
