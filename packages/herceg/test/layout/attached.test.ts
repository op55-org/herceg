// Labels attached to series (layout/attached.ts): blocks beside their
// points, or outside the plot in the side tracks, spread apart in columns,
// and the room the outside ones keep; and the chart's tracks growing for
// them within a layout.
import { describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type AttachedLabel, placeAttached as place } from "../../src/layout/attached.ts";
import { estimateText } from "../../src/layout/text.ts";
import { grid } from "../../src/layout.ts";
import type { Attachment } from "../../src/marks/attachments.ts";
import { labelPaint } from "../../src/marks/labels.ts";
import { line } from "../../src/marks/line.ts";
import type { Frame, MarkKey } from "../../src/marks/mark.ts";
import { RuleMark, rule } from "../../src/marks/rule.ts";
import { facet } from "../../src/model/facet.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { ChartModel } from "../../src/model/model.ts";
import { panels } from "../../src/model/panels.ts";
import type { Geometry, LabelsGeometry, Rect, TextItem } from "../../src/scene/scene.ts";
import type { TextStyle } from "../../src/spec/style.ts";
import { resolveTheme } from "../../src/theme.ts";
import { contractTest } from "../helpers/contracts.ts";

const theme = resolveTheme("light");
/** Places labels with the chart's code, as the feature compiler does. */
const placeAttached = (labels: readonly AttachedLabel[], frame: Frame, key: string) =>
  place(labels, frame, key, GUIDE_KIT);
const plot: Rect = { x: 40, y: 10, width: 300, height: 200 };
const frame = {
  plot,
  measure: estimateText,
  theme,
  outside: [30, 350],
} as unknown as Frame;

let n = 0;
function label(
  x: number,
  y: number,
  text: string,
  style: TextStyle = {},
  place: AttachedLabel["place"] = {},
  visible = true,
): AttachedLabel {
  const at: Attachment = { panel: "", mark: 0, series: `s${n}`, row: 0, value: 0, x, y, visible };
  return {
    key: `s${n++}`,
    at,
    text,
    paint: labelPaint(theme, "#333333", style),
    place,
    halo: undefined,
  };
}

const itemsOf = (geometry: readonly LabelsGeometry[]) => geometry.flatMap((g) => g.items);
/** An item's box: its lines', or its background's. */
const boxOf = (item: TextItem): Rect => {
  if (item.box) return item.box;
  const lines = item.text.split("\n");
  const width = Math.max(...lines.map((line) => estimateText(line, item.paint.css)));
  const x = item.anchor === "start" ? item.x : item.x - width / (item.anchor === "end" ? 1 : 2);
  const { lineHeight } = item.paint;
  return { x, y: item.y - lineHeight / 2, width, height: lines.length * lineHeight };
};

describe("attached labels", () => {
  contractTest("label.attached.inside", () => {
    const { geometry, room } = placeAttached([label(100, 50, "North")], frame, "labels");
    const [item] = itemsOf(geometry);
    // After its point by the gap, its middle at the point's height.
    expect(item!.anchor).toBe("start");
    expect(item!.x).toBeCloseTo(104, 6);
    expect(item!.y).toBeCloseTo(50, 6);
    // Labels inside the plot keep no room.
    expect(room).toEqual([0, 0]);
  });

  contractTest("label.attached.align", () => {
    const at = (style: TextStyle, offset?: number) =>
      boxOf(
        itemsOf(
          placeAttached(
            [label(100, 50, "two\nlines", style, offset === undefined ? {} : { offset })],
            frame,
            "labels",
          ).geometry,
        )[0]!,
      );
    // Before its point.
    expect(at({ align: "end" }).x + at({ align: "end" }).width).toBeCloseTo(96, 6);
    // Over its point: below it for "top", above it for "bottom", the gap and offset away.
    expect(at({ align: "center", verticalAlign: "top" }).y).toBeCloseTo(54, 6);
    const above = at({ align: "center", verticalAlign: "bottom" }, 6);
    expect(above.y + above.height).toBeCloseTo(40, 6);
    // A box's padding is part of the block.
    const boxed = at({ background: { fill: "#eeeeee" }, padding: 3 });
    expect(boxed.x).toBeCloseTo(104, 6);
    expect(boxed.y + boxed.height / 2).toBeCloseTo(50, 6);
  });

  contractTest("label.attached.outside", () => {
    const { geometry, room } = placeAttached(
      [
        label(340, 60, "Right", {}, { outside: true }),
        label(40, 80, "Left side", { align: "end" }, { outside: true, offset: 5 }),
        label(340, 150, "Unreserved, and wide", {}, { outside: true, reserve: false }),
      ],
      frame,
      "labels",
    );
    const [right, left] = itemsOf(geometry).sort((a, b) => a.y - b.y);
    // In the tracks: from where the right one starts, up to where the left one ends.
    expect(right!.anchor).toBe("start");
    expect(right!.x).toBeCloseTo(350, 6);
    expect(left!.anchor).toBe("end");
    expect(left!.x).toBeCloseTo(25, 6);
    // Room for those that reserve it, their offset too.
    const css = right!.paint.css;
    expect(room[1]).toBe(Math.ceil(estimateText("Right", css)));
    expect(room[0]).toBe(Math.ceil(estimateText("Left side", css) + 5));
  });

  contractTest("label.attached.spread", () => {
    // Three series ending a few pixels apart near the plot's bottom.
    const { geometry } = placeAttached(
      [
        label(340, 205, "c", {}, { outside: true }),
        label(340, 200, "b", {}, { outside: true }),
        label(340, 198, "a", {}, { outside: true }),
      ],
      frame,
      "labels",
    );
    const boxes = itemsOf(geometry).map(boxOf);
    const text = itemsOf(geometry).map((item) => item.text);
    // In the order of their points, apart, and inside the plot.
    expect(text).toEqual(["a", "b", "c"]);
    for (let k = 1; k < boxes.length; k++)
      expect(boxes[k]!.y).toBeGreaterThanOrEqual(boxes[k - 1]!.y + boxes[k - 1]!.height - 1e-9);
    expect(boxes.at(-1)!.y + boxes.at(-1)!.height).toBeLessThanOrEqual(plot.y + plot.height);
  });

  contractTest("label.attached.spread.bounds", () => {
    // A label alone near the plot's top comes into it.
    const [alone] = itemsOf(
      placeAttached([label(340, 12, "two\nlines", {}, { outside: true })], frame, "labels")
        .geometry,
    );
    expect(boxOf(alone!).y).toBeGreaterThanOrEqual(plot.y - 1e-9);
    // A column taller than the plot keeps the labels that fit from its top.
    const many = Array.from({ length: 40 }, (_, k) =>
      label(340, 20 + k, `s${k}`, {}, { outside: true }),
    );
    const { geometry, room } = placeAttached(many, frame, "labels");
    const boxes = itemsOf(geometry).map(boxOf);
    expect(boxes.length).toBeLessThan(40);
    expect(boxes.length).toBeGreaterThan(0);
    expect(itemsOf(geometry)[0]!.text).toBe("s0");
    expect(boxes[0]!.y).toBeGreaterThanOrEqual(plot.y - 1e-9);
    expect(boxes.at(-1)!.y + boxes.at(-1)!.height).toBeLessThanOrEqual(plot.y + plot.height + 1e-9);
    for (let k = 1; k < boxes.length; k++)
      expect(boxes[k]!.y).toBeGreaterThanOrEqual(boxes[k - 1]!.y + boxes[k - 1]!.height - 1e-9);
    // Room for the labels shown.
    expect(room[1]).toBe(
      Math.ceil(
        Math.max(...itemsOf(geometry).map((item) => estimateText(item.text, item.paint.css))),
      ),
    );
  });

  contractTest("label.attached.halo", () => {
    // Halos are part of what is painted: apart by them, and room for them.
    const halo = { color: "#ffffff", width: 6, opacity: 1 };
    const haloed = (at: AttachedLabel) => ({ ...at, halo });
    const { geometry, room } = placeAttached(
      [
        haloed(label(340, 100, "a", {}, { outside: true })),
        haloed(label(340, 101, "b", {}, { outside: true })),
      ],
      frame,
      "labels",
    );
    const [a, b] = itemsOf(geometry).map(boxOf);
    expect(b!.y - (a!.y + a!.height)).toBeGreaterThanOrEqual(6 - 1e-9);
    expect(room[1]).toBe(Math.ceil(estimateText("a", itemsOf(geometry)[0]!.paint.css) + 3));
  });

  contractTest("label.attached.hidden", () => {
    const { geometry, room } = placeAttached(
      [label(340, 60, "Hidden", {}, { outside: true }, false)],
      frame,
      "labels",
    );
    expect(geometry).toEqual([]);
    expect(room).toEqual([0, 0]);
  });
});

/**
 * A mark labeling the plot's right edge at y = 5 outside the plot with
 * `text(plot)`, which keeps the room its last labels took, as marks with
 * labels following series do.
 */
class Following extends RuleMark {
  readonly roomPlaced = true;
  #room: readonly [number, number] = [0, 0];
  readonly text: (plot: Rect) => string;
  constructor(text: (plot: Rect) => string, panel?: string) {
    super({ type: "rule", y: 5, ...(panel !== undefined && { panel }) });
    this.text = text;
  }
  override geometry(_series: unknown, frame: Frame, _key: MarkKey): Geometry[] {
    const { plot } = frame;
    const at = label(plot.x + plot.width, frame.y.map(5), this.text(plot), {}, { outside: true });
    const { geometry, room } = placeAttached([at], frame, "following");
    this.#room = room;
    return geometry;
  }
  override room(): [number, number] {
    return [this.#room[0], this.#room[1]];
  }
}

describe("tracks for labels placed as they are drawn", () => {
  contractTest("label.attached.room.grows", () => {
    const rows = table({ t: [0, 10], v: [0, 10] });
    let text = "short";
    const follower = new Following(() => text);
    const model = new ChartModel({
      locale: "en-US",
      legend: false,
      marks: [line(rows, { x: "t", y: "v" }), follower as never],
    });
    model.setSize(400, 300, 1);
    const right = () => {
      const scene = model.scene(estimateText);
      const { plot } = scene.panels[0]!;
      const labels = scene.panels[0]!.marks.find((m) => m.kind === "labels") as LabelsGeometry;
      const item = labels.items[0]!;
      return { edge: plot.x + plot.width, end: item.x + estimateText(item.text, item.paint.css) };
    };
    // The first scene already keeps room for the label it places.
    const first = right();
    expect(first.end).toBeLessThanOrEqual(400);
    // A wider label widens the track at once; a narrower one keeps it.
    text = "a much longer label";
    const wide = right();
    expect(wide.end).toBeLessThanOrEqual(400);
    expect(wide.edge).toBeLessThan(first.edge);
    text = "short";
    expect(right().edge).toBe(wide.edge);
    // A new size lays the tracks out afresh.
    model.setSize(420, 300, 1);
    expect(right().edge).toBeCloseTo(first.edge + 20, 6);
  });

  contractTest("label.attached.room.removed", () => {
    // A chart updated without the marks whose labels took room gives it back.
    const rows = table({ t: [0, 10], v: [0, 10] });
    const plain = new ChartModel({
      locale: "en-US",
      legend: false,
      marks: [line(rows, { x: "t", y: "v" })],
    });
    plain.setSize(400, 300, 1);
    const edge = (model: ChartModel) => {
      const { plot } = model.scene(estimateText).panels[0]!;
      return plot.x + plot.width;
    };
    const model = new ChartModel({
      locale: "en-US",
      legend: false,
      marks: [line(rows, { x: "t", y: "v" }), new Following(() => "a very long label") as never],
    });
    model.setSize(400, 300, 1);
    expect(edge(model)).toBeLessThan(edge(plain) - 50);
    model.update({ locale: "en-US", legend: false, marks: [line(rows, { x: "t", y: "v" })] });
    expect(edge(model)).toBe(edge(plain));
    model.setSize(420, 300, 1);
    model.setSize(400, 300, 1);
    expect(edge(model)).toBe(edge(plain));
  });

  contractTest("label.attached.room.interior", () => {
    // Labels outside the plots of panels beside others keep room between them.
    const rows = table({ t: [0, 10, 0, 10], v: [0, 10, 0, 10], g: ["a", "a", "b", "b"] });
    const model = new ChartModel({
      locale: "en-US",
      legend: false,
      facet: facet("g"),
      marks: [
        line(rows, { x: "t", y: "v" }),
        rule({ y: 5, label: { text: "a long threshold", place: { outside: true } } }),
      ],
    });
    model.setSize(600, 300, 1);
    const [first, second] = model.scene(estimateText).panels;
    const labels = first!.marks.find((m) => m.kind === "labels") as LabelsGeometry;
    const { x, text, paint } = labels.items[0]!;
    expect(x).toBeGreaterThan(first!.plot.x + first!.plot.width);
    expect(x + estimateText(text, paint.css)).toBeLessThanOrEqual(second!.plot.x);
  });

  /** The first panel's label in a facet of `columns` labeled by `text`, and where the second panel's plot starts. */
  const faceted = (columns: string[], text: (column: number) => string) => {
    const rows = table({
      t: columns.flatMap(() => [0, 10]),
      v: columns.flatMap(() => [0, 10]),
      g: columns.flatMap((g) => [g, g]),
    });
    const width = 300 * columns.length;
    const follower = new Following((plot) => text(Math.floor(plot.x / 300)));
    const model = new ChartModel({
      locale: "en-US",
      legend: false,
      facet: facet("g"),
      marks: [line(rows, { x: "t", y: "v" }), follower as never],
    });
    model.setSize(width, 300, 1);
    return () => {
      const [first, second] = model.scene(estimateText).panels;
      const labels = first!.marks.find((m) => m.kind === "labels") as LabelsGeometry;
      const { x, text, paint } = labels.items[0]!;
      return { end: x + estimateText(text, paint.css), next: second!.plot.x };
    };
  };

  contractTest("label.attached.room.panels", () => {
    // A mark drawn in several panels keeps room for each panel's labels, not its last one's.
    const first = faceted(["a", "b"], (column) => (column === 0 ? "a long interior label" : "x"));
    const { end, next } = first();
    expect(end).toBeLessThanOrEqual(next);
  });

  contractTest("label.attached.room.panel-grows", () => {
    // A label between subplots growing, though narrower than the chart's widest, widens its gap.
    const rows = table({ t: [0, 10], v: [0, 10] });
    let interior = "s";
    const model = new ChartModel({
      locale: "en-US",
      legend: false,
      panels: panels([{ id: "a" }, { id: "b" }, { id: "c" }], grid({ columns: 3 })),
      marks: [
        line(rows, { x: "t", y: "v", panel: "*" }),
        new Following(() => interior, "a") as never,
        new Following(() => "the widest label of all", "c") as never,
      ],
    });
    model.setSize(900, 300, 1);
    const first = () => {
      const [a, b] = model.scene(estimateText).panels;
      const labels = a!.marks.find((m) => m.kind === "labels") as LabelsGeometry;
      const { x, text, paint } = labels.items[0]!;
      return { end: x + estimateText(text, paint.css), next: b!.plot.x };
    };
    expect(first().end).toBeLessThanOrEqual(first().next);
    interior = "a wider label";
    const { end, next } = first();
    expect(end).toBeLessThanOrEqual(next);
  });

  contractTest("label.attached.room.cells", () => {
    // And so do subplots': here the first's, on its right.
    const rows = table({ t: [0, 10], v: [0, 10] });
    const model = new ChartModel({
      locale: "en-US",
      legend: false,
      panels: panels([{ id: "left" }, { id: "right" }], grid({ columns: 2 })),
      marks: [
        line(rows, { x: "t", y: "v", panel: "*" }),
        rule({
          y: 5,
          panel: "left",
          label: { text: "a long threshold", place: { outside: true } },
        }),
      ],
    });
    model.setSize(600, 300, 1);
    const [first, second] = model.scene(estimateText).panels;
    const labels = first!.marks.find((m) => m.kind === "labels") as LabelsGeometry;
    const { x, text, paint } = labels.items[0]!;
    const yLabels = second!.axes.find((a) => a.side === "left");
    const textStart = Math.min(
      second!.plot.x,
      ...(yLabels?.items ?? []).flatMap((item) =>
        item.type === "text" ? [item.x - estimateText(item.text, item.paint.css)] : [],
      ),
    );
    expect(x + estimateText(text, paint.css)).toBeLessThanOrEqual(textStart);
  });
});
