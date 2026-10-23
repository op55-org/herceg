// verticalAlign: a block of text's top, middle, or bottom at the point it
// is placed at, for text marks and rules' labels.
import { describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import type { LabelsGeometry, TextGeometry } from "../../src/scene/scene.ts";
import type { TextStyle } from "../../src/spec/spec.ts";
import { contractTest } from "../helpers/contracts.ts";

const rows = table({ t: [0, 10], v: [0, 10] });

function build(marks: ChartConfig["marks"]) {
  const model = new ChartModel({
    locale: "en-US",
    legend: false,
    marks: [line(rows, { x: "t", y: "v" }), ...marks],
  });
  model.setSize(400, 300, 1);
  const scene = model.scene(estimateText);
  return { model, marks: scene.panels[0]!.marks };
}

describe("verticalAlign", () => {
  contractTest("text.vertical-align.place", () => {
    const at = (style?: TextStyle) => {
      const { model, marks } = build([
        text({ x: 5, y: 5, label: { text: "peak", ...(style && { style }) } }),
      ]);
      const drawn = marks.find((m) => m.kind === "text") as TextGeometry;
      return drawn.coords[1]! - model.yScale()!.map(5);
    };
    // Plain text's line is 15 pixels tall (12px, line height 1.25): its middle by default.
    expect(at()).toBeCloseTo(0, 6);
    expect(at({ verticalAlign: "middle" })).toBeCloseTo(0, 6);
    expect(at({ verticalAlign: "top" })).toBeCloseTo(7.5, 6);
    expect(at({ verticalAlign: "bottom" })).toBeCloseTo(-7.5, 6);
    // A box's edge at the point: its padding outside the lines.
    const boxed = (verticalAlign: "top" | "bottom") => {
      const { model, marks } = build([
        text({
          x: 5,
          y: 5,
          label: {
            text: "two\nlines",
            style: {
              verticalAlign,
              background: { fill: "#eeeeee" },
              padding: { top: 2, bottom: 6 },
            },
          },
        }),
      ]);
      const drawn = marks.find((m) => m.kind === "labels") as LabelsGeometry;
      const box = drawn.items[0]!.box!;
      return [box.y - model.yScale()!.map(5), box.y + box.height - model.yScale()!.map(5)];
    };
    expect(boxed("top")[0]).toBeCloseTo(0, 6);
    expect(boxed("bottom")[1]).toBeCloseTo(0, 6);
  });

  contractTest("rule.label.vertical-align", () => {
    const at = (style?: TextStyle) => {
      const { model, marks } = build([
        rule({ y: 5, label: { text: "SLO", ...(style && { style }) } }),
      ]);
      const drawn = marks.find((m) => m.kind === "labels") as LabelsGeometry | undefined;
      const y = model.yScale()!.map(5);
      return drawn ? drawn.items[0]!.y - y : undefined;
    };
    // Above the rule by default, below it for "top", on it for "middle".
    const below = at({ verticalAlign: "top" })!;
    const on = at({ verticalAlign: "middle" })!;
    const above = at({ verticalAlign: "bottom" })!;
    expect(on).toBeCloseTo(0, 6);
    expect(below).toBeGreaterThan(6);
    expect(above).toBeCloseTo(-below, 6);
  });

  contractTest("rule.label.vertical-align.box", () => {
    // The block's box, padding and all, has its edge the label's gap (4
    // pixels) from the rule: lines of any count and height, padding of any sides.
    const box = (verticalAlign: "top" | "bottom", vertical = false) => {
      const { model, marks } = build([
        rule({
          ...(vertical ? { x: 5 } : { y: 5 }),
          label: {
            text: "two\nlines",
            style: {
              verticalAlign,
              lineHeight: 2,
              background: { fill: "#eeeeee" },
              padding: { top: 20, right: 3, bottom: 1, left: 5 },
            },
          },
        }),
      ]);
      const drawn = marks.find((m) => m.kind === "labels") as LabelsGeometry;
      const item = drawn.items[0]!;
      // The box holds both lines and their padding.
      expect(item.box!.height).toBeCloseTo(2 * item.paint.lineHeight + 21, 6);
      return { box: item.box!, x: model.xScale()!.map(5), y: model.yScale()!.map(5) };
    };
    const below = box("top");
    expect(below.box.y - below.y).toBeCloseTo(4, 6);
    const above = box("bottom");
    expect(above.box.y + above.box.height - above.y).toBeCloseTo(-4, 6);
    // Beside a vertical rule, its start's 4 pixels right of the rule.
    const beside = box("top", true);
    expect(beside.box.x - beside.x).toBeCloseTo(4, 6);
  });

  contractTest("region.label.vertical-align", () => {
    // A region's label block, box and all, below its top edge for "top",
    // on it for "middle", above it for "bottom", the gap (4 pixels) away.
    const box = (verticalAlign: "top" | "middle" | "bottom", side?: "left") => {
      const { model, marks } = build([
        region({
          y1: 2,
          y2: 8,
          label: {
            text: "two\nlines",
            ...(side && { place: { side } }),
            style: { verticalAlign, background: { fill: "#eeeeee" }, padding: 2 },
          },
        }),
      ]);
      const drawn = marks.find((m) => m.kind === "labels") as LabelsGeometry;
      return { box: drawn.items[0]!.box!, top: model.yScale()!.map(8) };
    };
    const below = box("top");
    expect(below.box.y - below.top).toBeCloseTo(4, 6);
    const on = box("middle");
    expect(on.box.y + on.box.height / 2 - on.top).toBeCloseTo(0, 6);
    const above = box("bottom");
    expect(above.box.y + above.box.height - above.top).toBeCloseTo(-4, 6);
    // Beside a side edge, at its start: the block's bottom there.
    const side = box("bottom", "left");
    expect(side.box.y + side.box.height - side.top).toBeCloseTo(4, 6);
  });
});
