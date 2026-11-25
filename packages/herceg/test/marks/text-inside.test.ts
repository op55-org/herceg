// Text labels stay inside the chart, as rule and region labels do: a label
// whose painted block would reach past the chart's edge goes to the other
// side of its point along that axis, else moves in as little as stays
// inside. A clip draws text where told, and so does a point outside the
// chart. Value transitions' frames keep the labels inside too.

import { describe, expect, it, vi } from "vitest";
import { category } from "../../src/data/column.ts";
import { type Table, table } from "../../src/data/table.ts";
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
import { estimateText, lineCount, type MeasureText, shapeOf } from "../../src/layout/text.ts";
import { Polyline } from "../../src/lod/polyline.ts";
import { bar } from "../../src/marks/bar.ts";
import { monotonePolyline } from "../../src/marks/curve.ts";
import { text } from "../../src/marks/text.ts";
import { planAxis } from "../../src/model/axis.ts";
import { axisGuide } from "../../src/model/axis-guide.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { renderSvg } from "../../src/render/svg.ts";
import type { LabelsGeometry, Rect, Scene, TextGeometry } from "../../src/scene/scene.ts";
import type { Frozen, TextSpec } from "../../src/spec/spec.ts";
import { LIGHT } from "../../src/theme.ts";

vi.mock("../../src/dom/scheduler.ts", () => ({
  frameCount: () => 0,
  lastFrameTime: () => 0,
  leaveOut: () => {},
}));

const [WIDTH, HEIGHT] = [400, 300];
const CHART: Rect = { x: 0, y: 0, width: WIDTH, height: HEIGHT };
const share = { start: 0, middle: 0.5, end: 1 } as const;
const { lineHeight } = LIGHT.style.text;

/** A model of `marks` (and the rest of `config`), 400 x 300. */
function model(
  config: Partial<ChartConfig> & Pick<ChartConfig, "marks">,
  size: [number, number] = [WIDTH, HEIGHT],
) {
  const chart = new ChartModel({ locale: "en-US", ...config }, undefined, staticCompilers());
  chart.setSize(size[0], size[1], 1);
  return chart;
}

/** A chart of one point's text, as `options` place and label it. */
function one(options: object, measure: MeasureText = estimateText, size?: [number, number]) {
  const chart = model(
    {
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
      marks: [text(options as never)],
    },
    size,
  );
  return chart.scene(measure);
}

interface Painted extends Rect {
  text: string;
}

/**
 * Each text label's painted block in `scene`: its lines at the theme's
 * line height (labels in boxes, their box), and its halo past them,
 * measured by `measure`.
 */
function blocks(scene: Scene, measure: MeasureText = estimateText): Painted[] {
  const out: Painted[] = [];
  for (const mark of scene.panels.flatMap((panel) => panel.marks)) {
    if (mark.kind === "text") {
      const { coords, labels, anchor, halo } = mark as TextGeometry;
      const font = `${LIGHT.fontSize}px ${LIGHT.font}`;
      const reach = (halo?.width ?? 0) / 2;
      labels.forEach((label, i) => {
        const width = measure(label, font);
        const height = lineCount(label) * lineHeight;
        out.push({
          text: label,
          x: coords[i * 2]! - share[anchor] * width - reach,
          y: coords[i * 2 + 1]! - height / 2 - reach,
          width: width + 2 * reach,
          height: height + 2 * reach,
        });
      });
    }
    if (mark.kind === "labels")
      for (const item of (mark as LabelsGeometry).items) {
        // A box's outline paints past it, and a halo past its padding.
        const background = item.paint.background;
        const outline = background?.stroke ? (background.strokeWidth ?? 1) / 2 : 0;
        const padding = background ? Math.min(...item.paint.padding) : 0;
        const reach = Math.max(0, outline, (item.halo?.width ?? 0) / 2 - padding);
        const width = measure(item.text, item.paint.css);
        const height = lineCount(item.text) * item.paint.lineHeight;
        const box = item.box ?? {
          x: item.x - share[item.anchor] * width,
          y: item.y - item.paint.lineHeight / 2,
          width,
          height,
        };
        out.push({
          text: item.text,
          x: box.x - reach,
          y: box.y - reach,
          width: box.width + 2 * reach,
          height: box.height + 2 * reach,
        });
      }
  }
  return out;
}

/** How far a block reaches past `box` on its farthest side (0 when inside). */
function past(block: Rect, box: Rect = CHART): number {
  return Math.max(
    0,
    box.x - block.x,
    box.y - block.y,
    block.x + block.width - box.x - box.width,
    block.y + block.height - box.y - box.height,
  );
}

const centre = (block: Rect) => [block.x + block.width / 2, block.y + block.height / 2] as const;
/** A place in the chart's pixels. */
const px = (at: number, offset = 0) => ({ px: at, frame: "chart", offset });

describe("text labels in a scene", () => {
  it("go to the other side of their point at each edge of the chart, then stay there", () => {
    // 14 px above a point 4 px below the chart's top: 14 px below it.
    const top = blocks(one({ at: { x: px(200), y: px(4, -14) }, label: "Note" }))[0]!;
    expect(past(top)).toBe(0);
    expect(centre(top)[1]).toBeCloseTo(4 + 14, 3);
    // And above a point 4 px above the bottom.
    const bottom = blocks(one({ at: { x: px(200), y: px(296, 14) }, label: "Note" }))[0]!;
    expect(past(bottom)).toBe(0);
    expect(centre(bottom)[1]).toBeCloseTo(296 - 14, 3);
    // A start-aligned label at the right edge goes to its point's left, its
    // block's start as far from the point as its end was.
    const start = { text: "A note", style: { align: "start" } };
    const right = blocks(one({ at: { x: px(396), y: px(150) }, label: start }))[0]!;
    expect(past(right)).toBe(0);
    // (The default halo reaches 1.5 px past the text.)
    expect(right.x + right.width).toBeCloseTo(396 + 1.5, 3);
    // An end-aligned label at the left edge goes to its point's right.
    const end = { text: "A note", style: { align: "end" } };
    const left = blocks(one({ at: { x: px(4), y: px(150) }, label: end }))[0]!;
    expect(past(left)).toBe(0);
    expect(left.x).toBeCloseTo(4 - 1.5, 3);
    // Offsets along x mirror too: 30 px right of a point at the right edge, 30 px left of it.
    const offset = { x: px(390, 30), y: px(150) };
    const across = blocks(one({ at: offset, label: "Note" }))[0]!;
    expect(past(across)).toBe(0);
    expect(centre(across)[0]).toBeCloseTo(390 - 30, 3);
  });

  it("move in a centred label, whose mirror image is where it is, as little as stays inside", () => {
    const label = "A centred note";
    const width = estimateText(label, `${LIGHT.fontSize}px ${LIGHT.font}`) + 3;
    const [right] = blocks(one({ at: { x: px(398), y: px(150) }, label }));
    expect(right!.x + right!.width).toBeCloseTo(WIDTH, 3);
    expect(right!.width).toBeCloseTo(width, 3);
    const [corner] = blocks(one({ at: { x: px(2), y: px(1) }, label }));
    expect(corner!.x).toBeCloseTo(0, 3);
    expect(corner!.y).toBeCloseTo(0, 3);
  });

  it("move in where the mirror image reaches past too, from the side that reaches less far", () => {
    // 300 px of text 10 px right of a point 250 px from the left: past the
    // right edge by 160, its mirror image past the left by 60. It goes to
    // the image, then moves in to the chart's left edge.
    const sized: MeasureText = (text, font) => (text === "wide" ? 300 : estimateText(text, font));
    const label = { text: "wide", style: { align: "start" } };
    const [block] = blocks(one({ at: { x: px(250, 10), y: px(150) }, label }, sized), sized);
    expect(block!.width).toBeCloseTo(300 + 3, 3);
    expect(block!.x).toBeCloseTo(0, 3);
    // Without a mirror image, from the right edge.
    const [right] = blocks(one({ at: { x: px(150, 10), y: px(150) }, label }, sized), sized);
    expect(right!.x + right!.width).toBeCloseTo(WIDTH, 3);
  });

  it("start a label larger than the chart at its left and top edges", () => {
    const label = Array.from({ length: 12 }, () => "wide words").join(" ");
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    const [wide] = blocks(one({ at: { x: px(200), y: px(150) }, label }));
    expect(wide!.width).toBeGreaterThan(WIDTH);
    expect(wide!.x).toBeCloseTo(0, 3);
    const [tall] = blocks(one({ at: { x: px(200), y: px(150) }, label: lines }));
    expect(tall!.height).toBeGreaterThan(HEIGHT);
    expect(tall!.y).toBeCloseTo(0, 3);
  });

  it("keep labels in boxes inside by their boxes, outlines, and halos", () => {
    const label = {
      text: "Boxed\nnote",
      style: { background: { fill: "#eee", stroke: "#333" }, padding: 4, align: "start" },
    };
    const [box] = blocks(one({ at: { x: px(396), y: px(2) }, label }));
    expect(past(box!)).toBe(0);
    // Mirrored left of its point: its box ends at the point, and its
    // outline half a pixel past.
    expect(box!.x + box!.width).toBeCloseTo(396 + 0.5, 3);
    // Centred on its point along y, it moves in.
    expect(box!.y).toBeCloseTo(0, 3);
  });

  it("measure with the chart's measurer, which may be wider than Helvetica", () => {
    const wider: MeasureText = (text, font) => estimateText(text, font) * 1.6;
    const label = { text: "Measured note", style: { align: "start" } };
    const options = { at: { x: px(300), y: px(150) }, label };
    // Inside by Helvetica's widths where told; past by the wider ones, so mirrored.
    const [told] = blocks(one(options), estimateText);
    expect(told!.x).toBeCloseTo(300 - 1.5, 3);
    const [wide] = blocks(one(options, wider), wider);
    expect(past(wide!)).toBe(0);
    expect(wide!.x + wide!.width).toBeCloseTo(300 + 1.5, 3);
  });

  it("leave labels in the margins where they are put, and draw nothing of points outside the chart elsewhere", () => {
    // Above the plot, in a top margin 30 px deep: as told.
    const scene = model({
      x: { domain: [0, 10] },
      y: { domain: [0, 10], padding: 0 },
      padding: { top: 30 },
      marks: [text({ at: { x: { data: 5 }, y: { data: 10, offset: -14 } }, label: "Top" })],
    }).scene(estimateText);
    const margin = blocks(scene)[0]!;
    const plot = scene.panels[0]!.plot;
    expect(past(margin)).toBe(0);
    expect(plot.y).toBeGreaterThan(30);
    expect(centre(margin)[1]).toBeCloseTo(plot.y - 14, 3);
    // A point 20 px left of the chart, its label 30 px right: drawn there, unseen past the edge.
    const outside = blocks(one({ at: { x: px(-20, 30), y: px(150) }, label: "Out" }))[0]!;
    expect(centre(outside)[0]).toBeCloseTo(10, 3);
    expect(past(outside)).toBeGreaterThan(0);
  });

  it("cut text where a clip says, and draw it exactly where told", () => {
    const at = { x: px(200), y: px(4, -14) };
    for (const clip of ["plot", "chart", false] as const) {
      const scene = one({ at, label: "Note", clip });
      const [block] = blocks(scene);
      expect(centre(block!)[1], String(clip)).toBeCloseTo(4 - 14, 3);
      const mark = scene.panels[0]!.marks.find((m) => m.kind === "text")!;
      expect(mark.clip, String(clip)).toBe(clip);
    }
  });

  it("take the place they are kept at as the first place of labels that hide or move", () => {
    const notes = table({ x: [1, 9], y: [9.9, 9.9], note: ["first note", "second note"] });
    const scene = (overlap: "hide" | "move") =>
      model({
        x: { domain: [0, 10] },
        y: { domain: [0, 10], padding: 0 },
        padding: 0,
        marks: [
          text(notes, {
            x: "x",
            y: { field: "y", offset: -14 },
            label: { field: "note", overlap },
          }),
        ],
      }).scene(estimateText);
    for (const overlap of ["hide", "move"] as const) {
      const drawn = blocks(scene(overlap));
      expect(
        drawn.map((block) => block.text),
        overlap,
      ).toEqual(["first note", "second note"]);
      for (const block of drawn) expect(past(block), overlap).toBe(0);
    }
    // Below their points, 14 px down: where "show" draws them.
    const plot = scene("hide").panels[0]!.plot;
    const y = plot.y + plot.height * 0.01;
    for (const block of blocks(scene("hide"))) expect(centre(block)[1]).toBeCloseTo(y + 14, 0);
  });

  it("draw static SVG and the scene alike", () => {
    const scene = one({
      at: { x: px(396), y: px(4, -14) },
      label: { text: "Corner", style: { align: "start" } },
    });
    const svg = renderSvg(scene, { idPrefix: "c" });
    const [block] = blocks(scene);
    expect(svg).toContain(">Corner<");
    expect(past(block!)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Frames.

/** A measurer of proportional digits: "1" as narrow as "l". A number's shape is wider by each "1". */
const proportional: MeasureText = (text, font) => estimateText(text.replace(/1/g, "l"), font);
const builders = (measure: MeasureText) => ({
  planAxis,
  axisGuide,
  Polyline,
  monotonePolyline,
  measure,
  shapeOf,
});

/** The tween from `chart`'s scene to the next after `edit`, measured by `measure`. */
function change(chart: ChartModel, edit: () => void, measure: MeasureText = estimateText): Tween {
  const shown = snapshot(chart.scene(measure), chart.panels(), 0)!;
  edit();
  const scene = chart.scene(measure);
  const { config } = chart;
  const tween = plan(
    shown,
    scene,
    chart.panels(),
    200,
    builders(measure),
    sidesOf(config),
    followedOf(config),
    positionsOf(config),
  );
  expect(tween).toBeDefined();
  return tween!;
}

/**
 * The first label's painted block in every frame of `tween`, 10 ms apart,
 * read as each is drawn (frames share their tween's buffers).
 */
function framed(tween: Tween, measure: MeasureText = estimateText): Painted[] {
  const out: Painted[] = [];
  for (let ms = 0; ms <= 200; ms += 10) out.push(blocks(frameAt(tween, ms), measure)[0]!);
  return out;
}

/**
 * A chart of `notes`' text at (x, y), its items named by their `id`,
 * animating values; its domains 0 to 10.
 */
function animated(notes: Table, label: object, options: Partial<Frozen<TextSpec>> = {}) {
  return model({
    animation: { duration: 200, values: true, easing: "linear" },
    x: { domain: [0, 10] },
    y: { domain: [0, 10] },
    marks: [text(notes as never, { x: "x", y: "y", itemKey: "id", label, ...options } as never)],
  });
}
const id = category(["n"]);

describe("text labels in a value transition's frames", () => {
  it("stay inside as a label's new text, 5 to 80 px wide, shows at once near the edge", () => {
    const rows = (y: number, note: string) => ({
      id,
      x: [9.6],
      y: [y],
      note: category([note]),
    });
    const notes = table(rows(2, "a")) as unknown as Table;
    const chart = animated(notes, { field: "note", style: { align: "start" } });
    const long = "a note eighty px wide";
    expect(estimateText(long, `${LIGHT.fontSize}px ${LIGHT.font}`)).toBeGreaterThan(80);
    const tween = change(chart, () => notes.reset(rows(8, long)));
    const drawn = framed(tween);
    expect(drawn.every((block) => block.text === long)).toBe(true);
    for (const block of drawn) expect(past(block)).toBeLessThan(1e-3);
    // It ends where its scene keeps it, at its point's left.
    expect(renderSvg(frameAt(tween, 200), { idPrefix: "c" })).toBe(
      renderSvg(chart.scene(estimateText), { idPrefix: "c" }),
    );
  });

  it("stay inside as a label grows lines at the chart's bottom", () => {
    // 2 px above the chart's bottom: a line moved up to stay inside, then ten
    // lines at once, which the frames move up faster than their place goes.
    const rows = (x: number, note: string) => ({ id, x: [x], y: [5], note: category([note]) });
    const notes = table(rows(2, "one")) as unknown as Table;
    const chart = animated(notes, { field: "note" }, { y: px(298) as never });
    const lines = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten";
    const tween = change(chart, () => notes.reset(rows(8, lines)));
    const drawn = framed(tween);
    for (const block of drawn) expect(past(block)).toBeLessThan(1e-3);
    expect(Math.max(...drawn.map((block) => block.y + block.height))).toBeCloseTo(HEIGHT, 3);
  });

  it("stay inside, to their shapes' error, as a long fractional number counts near the edge", () => {
    const rows = (value: number) => ({ id, x: [9.5], y: [5], value: [value] });
    const font = `${LIGHT.fontSize}px ${LIGHT.font}`;
    // Digits as wide as their shape (Helvetica's), narrower (a "1" as an
    // "l"), or wider (a "0" as an "l", so shapes are the narrowest).
    const narrowZero: MeasureText = (text, f) => estimateText(text.replace(/0/g, "l"), f);
    // Plain text, and labels in looks of their own: bold, and in a box.
    const styles = [
      { align: "start" },
      { align: "start", fontWeight: 700 },
      { align: "start", background: { fill: "#eeeeee" }, padding: 3 },
    ];
    for (const measure of [estimateText, proportional, narrowZero])
      for (const style of styles) {
        const notes = table(rows(1.111111)) as unknown as Table;
        // 5 px from the right edge: mirrored at both ends, and its number
        // grows faster than its place moves, so frames keep it in.
        const chart = animated(
          notes,
          { field: "value", format: { number: ",.6f" }, style },
          { x: px(395) as never },
        );
        const tween = change(chart, () => notes.reset(rows(911_111.111111)), measure);
        const drawn = framed(tween, measure);
        // Counting: the frames write numbers between.
        expect(new Set(drawn.map((block) => block.text)).size).toBeGreaterThan(5);
        // How much wider a frame's number is than its shape.
        const css = style.fontWeight ? `700 ${font}` : font;
        const error = (text: string) => measure(text, css) - measure(text.replace(/\d/g, "0"), css);
        // Past by no more than that.
        for (const block of drawn)
          expect(past(block)).toBeLessThanOrEqual(Math.max(0, error(block.text)) + 1e-3);
        // And kept in by its shape: some frames' right edges at the chart's, to the error.
        const gaps = drawn.map(
          (block) => Math.abs(WIDTH - block.x - block.width) - Math.abs(error(block.text)),
        );
        expect(Math.min(...gaps)).toBeLessThan(1e-3);
      }
  });

  it("stay inside through an interrupted transition, moving on from where they were drawn", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    const rows = (y: number, value: number) => ({ id, x: [5], y: [y], value: [value] });
    const notes = table(rows(2, 10)) as unknown as Table;
    const chart = animated(
      notes,
      { field: "value", format: { number: ",.3f" }, style: { align: "start" } },
      { x: px(395) as never },
    );
    const scene = () => chart.scene(estimateText);
    const animation = new ValueAnimation(chart, null, scene(), builders(estimateText));
    const reset = { dropped: 0, appended: 0, updated: null, fields: [], reset: true };
    animation.changed(animation.start(scene(), 0), reset, 0);
    notes.reset(rows(8, 99_999));
    animation.start(scene(), 0);
    now.mockReturnValue(100);
    // Frames share their tween's buffers: each read as it is drawn.
    const passing = animation.step(0)!;
    const before = blocks(passing)[0]!;
    animation.changed(passing, reset, 0);
    notes.reset(rows(5, 12_345_678));
    const first = blocks(animation.start(scene(), 0)!)[0]!;
    expect(past(before)).toBeLessThan(1e-3);
    // The next transition starts where the frame before drew the label, at the number it showed.
    expect(first.text).toBe(before.text);
    expect([first.x, first.y]).toEqual([before.x, before.y]);
    const edges: number[] = [];
    for (let ms = 110; ms < 300; ms += 10) {
      now.mockReturnValue(ms);
      const block = blocks(animation.step(0)!)[0]!;
      expect(past(block), String(ms)).toBeLessThan(1e-3);
      edges.push(block.x + block.width);
    }
    // Its number grows faster than its place moves: the frames keep it in.
    expect(Math.max(...edges)).toBeCloseTo(WIDTH, 3);
    now.mockReturnValue(1_000);
    const end = animation.step(0)!;
    vi.restoreAllMocks();
    expect(renderSvg(end, { idPrefix: "c" })).toBe(renderSvg(scene(), { idPrefix: "c" }));
  });

  it("leave labels of points outside the chart, and labels with a clip, where told", () => {
    // A point 30 px past the chart's right edge, its label offset 60 px back in.
    const rows = (y: number, note: string) => ({ id, x: [10], y: [y], note: category([note]) });
    const outside = table(rows(2, "a")) as unknown as Table;
    const chart = animated(
      outside,
      { field: "note", style: { align: "start" } },
      { x: { px: WIDTH + 30, frame: "chart", offset: -60 } as never },
    );
    const long = "a long note reaching out of the chart";
    const tween = change(chart, () => outside.reset(rows(8, long)));
    for (const block of framed(tween)) expect(block.x).toBeCloseTo(WIDTH + 30 - 60 - 1.5, 3);
    // With a clip, the label is drawn where told on every frame.
    const clipped = table(rows(2, "a")) as unknown as Table;
    const cut = animated(clipped, { field: "note", style: { align: "start" } }, { clip: "chart" });
    const told = change(cut, () => clipped.reset(rows(8, long)));
    const plot = cut.panels()[0]!.plot;
    for (const block of framed(told)) expect(block.x).toBeCloseTo(plot.x + plot.width - 1.5, 3);
  });

  it("leave frames of transitions without text labels as they were", () => {
    const data = table({ c: category(["a", "b"]), v: [1, 2] }) as unknown as Table;
    const chart = model({
      animation: { duration: 200, values: true },
      marks: [bar(data as never, { x: "c", y: "v", labels: true })],
    });
    const tween = change(chart, () => data.reset({ c: category(["a", "b"]), v: [2, 1] }));
    for (const labels of tween.panels[0]!.labels)
      expect(labels.mark.named?.stayInside).toBeUndefined();
  });
});
