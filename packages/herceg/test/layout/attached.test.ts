// Labels attached to series (layout/attached.ts): blocks beside their
// points, or outside the plot in the side tracks, spread apart in columns,
// and the room the outside ones keep; and the chart's tracks growing for
// them within a layout.
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import {
  type AttachedLabel,
  type LabelOwner,
  placeAttached as place,
} from "../../src/layout/attached.ts";
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
import type {
  Geometry,
  LabelsGeometry,
  Rect,
  SegmentGeometry,
  TextItem,
} from "../../src/scene/scene.ts";
import type { TextStyle } from "../../src/spec/style.ts";
import { resolveTheme } from "../../src/theme.ts";
import { contractTest } from "../helpers/contracts.ts";

const theme = resolveTheme("light");
/** Places labels of one mark, keyed `key`, with the chart's code, as the feature compiler does. */
const placeAttached = (labels: readonly AttachedLabel[], frame: Frame, key: string) => {
  const owner: LabelOwner = { key, leader: undefined, room: [0, 0] };
  const { geometry } = place(
    labels.map((at) => ({ ...at, owner })),
    frame,
    GUIDE_KIT,
  );
  const drawn = (geometry.get(owner) ?? []).filter((g): g is LabelsGeometry => g.kind === "labels");
  return { geometry: drawn, room: owner.room };
};
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
    overlap: "move",
    priority: 0,
    owner: { key: "labels", leader: undefined, room: [0, 0] },
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
    const items = itemsOf(geometry).sort((a, b) => a.y - b.y);
    const boxes = items.map(boxOf);
    const text = items.map((item) => item.text);
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

describe("series labels keeping apart", () => {
  /** A label of `owner` with a policy, outside the plot on the right, its point at (340, y). */
  const series = (
    y: number,
    text: string,
    overlap: AttachedLabel["overlap"],
    owner: LabelOwner,
    priority = 0,
  ): AttachedLabel => ({ ...label(340, y, text, {}, { outside: true }), overlap, priority, owner });
  const owner = (key = "labels", leader?: LabelOwner["leader"]): LabelOwner => ({
    key,
    leader,
    room: [0, 0],
  });
  /** Each drawn label's text and the middle of its block, top to bottom. */
  const middles = (geometry: Map<LabelOwner, Geometry[]>) =>
    [...geometry.values()]
      .flat()
      .filter((g): g is LabelsGeometry => g.kind === "labels")
      .flatMap((g) => g.items)
      .map((item) => {
        const box = boxOf(item);
        return [item.text, box.y + box.height / 2] as const;
      })
      .sort((a, b) => a[1] - b[1]);
  const height = theme.style.text.lineHeight;

  contractTest("label.series.overlap.show", () => {
    // A1.05: each exactly at its point, overlapping if they must.
    const own = owner();
    const { geometry } = place(
      [series(100, "auth", "show", own), series(103, "api", "show", own)],
      frame,
      GUIDE_KIT,
    );
    expect(middles(geometry)).toEqual([
      ["auth", 100],
      ["api", 103],
    ]);
  });

  contractTest("label.series.overlap.move", () => {
    // A1.06: two labels a few pixels apart move apart by half the overlap
    // each, no further; a third with room stays at its point.
    const own = owner();
    const { geometry } = place(
      [
        series(100, "auth", "move", own),
        series(104, "api", "move", own),
        series(160, "db", "move", own),
      ],
      frame,
      GUIDE_KIT,
    );
    const [auth, api, db] = middles(geometry);
    expect(auth![0]).toBe("auth");
    expect(api![1] - auth![1]).toBeCloseTo(height, 6);
    expect((auth![1] + api![1]) / 2).toBeCloseTo(102, 6);
    expect(db).toEqual(["db", 160]);
  });

  it("move as little as a crowd needs, the least squared moves", () => {
    // Three at one point: the middle stays, the others a label's height away.
    const own = owner();
    const { geometry } = place(
      [series(100, "a", "move", own), series(100, "b", "move", own), series(100, "c", "move", own)],
      frame,
      GUIDE_KIT,
    );
    // Ties keep series order.
    expect(middles(geometry)).toEqual([
      ["a", 100 - height],
      ["b", 100],
      ["c", 100 + height],
    ]);
  });

  it("keep inside the plot, moving the crowd as one", () => {
    const own = owner();
    const { geometry } = place(
      [series(plot.y + 1, "a", "move", own), series(plot.y + 2, "b", "move", own)],
      frame,
      GUIDE_KIT,
    );
    const [a, b] = middles(geometry);
    expect(a![1]).toBeCloseTo(plot.y + height / 2, 6);
    expect(b![1]).toBeCloseTo(plot.y + height * 1.5, 6);
  });

  contractTest("label.series.overlap.hide", () => {
    // The first in series order stays where they would cover each other;
    // the higher priority wins over order.
    const own = owner();
    const hide = (priority: number) =>
      middles(
        place(
          [series(100, "auth", "hide", own), series(104, "api", "hide", own, priority)],
          frame,
          GUIDE_KIT,
        ).geometry,
      ).map(([text]) => text);
    expect(hide(0)).toEqual(["auth"]);
    expect(hide(1)).toEqual(["api"]);
  });

  contractTest("label.series.drop", () => {
    // A column too short for all: the lowest priority left out first, then
    // the last in series order, until the rest fit.
    const own = owner();
    const rows = Math.floor(plot.height / height);
    const labels = Array.from({ length: rows + 2 }, (_, k) =>
      series(plot.y + 100, `s${k}`, "move", own, k === 0 ? -1 : 0),
    );
    const shown = middles(place(labels, frame, GUIDE_KIT).geometry).map(([text]) => text);
    expect(shown).toHaveLength(rows);
    expect(shown).not.toContain("s0");
    expect(shown).not.toContain(`s${rows + 1}`);
    expect(shown).toContain(`s${rows}`);
  });

  contractTest("label.series.leader", () => {
    // Leaders join labels moved more than 6 pixels to their points; others draw none.
    const own = owner("labels", {
      stroke: undefined,
      path: "line labels.leader.stroke",
      strokeWidth: 1,
    });
    const { geometry } = place(
      [
        series(100, "a", "move", own),
        series(100, "b", "move", own),
        series(100, "c", "move", own),
        series(180, "d", "move", own),
      ],
      frame,
      GUIDE_KIT,
    );
    const [leaders, labels] = geometry.get(own)!;
    expect(leaders!.kind).toBe("segments");
    expect(labels!.kind).toBe("labels");
    const segments = leaders as SegmentGeometry;
    // "a" and "c" moved a line's height; "b" and "d" stayed.
    expect(segments.count).toBe(2);
    expect(segments.stroke).toBe(theme.muted);
    for (let k = 0; k < segments.count; k++) {
      // From beside the point, to the label's near edge.
      expect(segments.coords[k * 4]!).toBeGreaterThan(340);
      expect(Math.abs(segments.coords[k * 4 + 1]! - 100)).toBeLessThanOrEqual(2);
      expect(segments.coords[k * 4 + 2]!).toBeCloseTo(350, 6);
    }
  });

  it("move least where blocks meet only some of the others", () => {
    // A meets B and C; B and C do not meet. C, tall, wants to be above A,
    // so A and C move apart; B, whose room A leaves, stays at its point.
    const a = label(100, 100, "aaaaaaaaaa");
    const b = label(140, 101, "bb");
    const c = label(60, 102, "cccccccccc\nc\nc\nc\nc\nc");
    const items = itemsOf(placeAttached([a, b, c], frame, "labels").geometry);
    const [ia, ib, ic] = ["aaaaaaaaaa", "bb", "cccccccccc\nc\nc\nc\nc\nc"].map(
      (text) => items.find((item) => item.text === text)!,
    );
    expect(ib!.y).toBeCloseTo(101, 6);
    const [boxA, boxC] = [boxOf(ia!), boxOf(ic!)];
    expect(boxC.y).toBeCloseTo(boxA.y + boxA.height, 4);
    // A and C share the move: each as far from where it wants to be.
    const lineHeight = ia!.paint.lineHeight;
    expect(100 - (boxA.y + lineHeight / 2)).toBeCloseTo(boxC.y + boxC.height / 2 - 102, 4);
  });

  it("place labels meeting only some of the others between the walls each meets", () => {
    // A meets B and C, B and C do not meet; a shown label just above their
    // points meets all three, which go below it.
    const wall = { ...label(60, 99, "wwwwwwwwwwwwwwwwwwwwwwwww"), overlap: "show" as const };
    const a = label(100, 100, "aaaaaaaaaa");
    const b = label(140, 101, "bb");
    const c = label(60, 102, "cccccccccc");
    const items = itemsOf(placeAttached([wall, a, b, c], frame, "labels").geometry);
    expect(items).toHaveLength(4);
    const shown = boxOf(items.find((item) => item.text === wall.text)!);
    for (const text of [a.text, b.text, c.text]) {
      const box = boxOf(items.find((item) => item.text === text)!);
      expect(box.y).toBeGreaterThanOrEqual(shown.y + shown.height - 1e-6);
    }
  });

  it("leave a label its point where the walls and labels it meets leave room", () => {
    // A meets B, B meets C, A and C do not meet; a shown label after A's and
    // B's points meets only them. C, below B, stays at its point.
    const a = label(100, 90, "aaaaaaaaaa");
    const b = label(140, 95, "bbbbbbbbbb");
    const c = label(180, 100, "cccccccccc");
    const wall = { ...label(100, 99, "wwwwww"), overlap: "show" as const };
    const items = itemsOf(placeAttached([a, b, c, wall], frame, "labels").geometry);
    expect(items).toHaveLength(4);
    const lineHeight = items[0]!.paint.lineHeight;
    const middle = (text: string) => {
      const box = boxOf(items.find((item) => item.text === text)!);
      return box.y + box.height / 2;
    };
    expect(middle(c.text)).toBeCloseTo(100, 6);
    expect(middle(b.text)).toBeLessThanOrEqual(99 - lineHeight + 1e-6);
  });

  it("keep the labels a left-out one joined, where they no longer meet", () => {
    // Three labels in a plot room for one, the middle weakest and meeting
    // the others, which do not meet: it is left out, and both others stay.
    const short = { ...frame, plot: { x: 40, y: 10, width: 300, height: 20 } } as Frame;
    const a = label(60, 20, "aaaaaaaaaa");
    const b = { ...label(100, 20, "bbbbbbbbbbbbbbbbbbbb"), priority: -1 };
    const c = label(200, 20, "cccccccccc");
    const items = itemsOf(placeAttached([a, b, c], short, "labels").geometry);
    expect(items.map(({ text }) => text)).toEqual([a.text, c.text]);
  });

  it("keep labels that move off labels shown at their points", () => {
    const shown = { ...label(340, 100, "fixed", {}, { outside: true }), overlap: "show" as const };
    const moving = label(340, 100, "moving", {}, { outside: true });
    const [fixed, moved] = itemsOf(placeAttached([shown, moving], frame, "labels").geometry);
    expect(fixed!.y).toBeCloseTo(100, 6);
    const [boxF, boxM] = [boxOf(fixed!), boxOf(moved!)];
    expect(boxM.y >= boxF.y + boxF.height - 1e-6 || boxM.y + boxM.height <= boxF.y + 1e-6).toBe(
      true,
    );
  });

  it("keep the order of their points around labels shown at theirs", () => {
    // A label that moves, its point a little below a shown one's, goes below it.
    const own = owner();
    const { geometry } = place(
      [series(100, "shown", "show", own), series(105, "moving", "move", own)],
      frame,
      GUIDE_KIT,
    );
    expect(middles(geometry)).toEqual([
      ["shown", 100],
      ["moving", 100 + height],
    ]);
  });

  it("keep labels that hide where they outrank every label that moves", () => {
    // The hider of higher priority stays at its point; the mover goes around it.
    const own = owner();
    const at = (priority: number) =>
      middles(
        place(
          [series(100, "mover", "move", own, 0), series(100, "hider", "hide", own, priority)],
          frame,
          GUIDE_KIT,
        ).geometry,
      );
    const [first, second] = at(100);
    expect(second).toEqual(["hider", 100]);
    expect(first).toEqual(["mover", 100 - height]);
    // Of no higher priority, it hides where the mover, placed first, covers it.
    expect(at(0)).toEqual([["mover", 100]]);
  });

  it("move continuously while their points do, and change places where points cross", () => {
    const own = owner();
    const at = (shift: number) =>
      middles(
        place(
          [series(100, "a", "move", own), series(104 + shift, "b", "move", own)],
          frame,
          GUIDE_KIT,
        ).geometry,
      );
    const [a0, b0] = at(0);
    const [a1, b1] = at(0.5);
    expect(a1![1] - a0![1]).toBeCloseTo(0.25, 6);
    expect(b1![1] - b0![1]).toBeCloseTo(0.25, 6);
    // Crossed: b above a.
    expect(at(-10).map(([text]) => text)).toEqual(["b", "a"]);
  });

  it("keep apart across the marks of a panel, each drawing its own", () => {
    const first = owner("first");
    const second = owner("second");
    const { geometry, boxes } = place(
      [series(100, "auth", "move", first), series(102, "api", "move", second)],
      frame,
      GUIDE_KIT,
    );
    expect([...geometry.keys()]).toEqual([first, second]);
    const [a, b] = middles(geometry);
    expect(b![1] - a![1]).toBeCloseTo(height, 6);
    // Their boxes, for annotation labels to keep off.
    expect(boxes).toHaveLength(2);
    expect(first.room[1]).toBeGreaterThan(0);
    expect(second.room[1]).toBeGreaterThan(0);
  });
});
