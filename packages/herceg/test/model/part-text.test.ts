// Labels whose parts have looks of their own (marks/features/part-text.ts):
// each part a text item in its own font on its line's baseline, halos
// before every fill, the block placed and boxed as the label's; on rules,
// text, regions, bars, and series labels.
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { bar } from "../../src/marks/bar.ts";
import { partText } from "../../src/marks/features/part-text.ts";
import { line } from "../../src/marks/line.ts";
import { region } from "../../src/marks/region.ts";
import { rule } from "../../src/marks/rule.ts";
import { text } from "../../src/marks/text.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { renderToPDF } from "../../src/pdf.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type {
  LabelsGeometry,
  RectGeometry,
  RuleGeometry,
  Scene,
  TextItem,
} from "../../src/scene/scene.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { textPaint } from "../../src/style/style.ts";
import { LIGHT } from "../../src/theme.ts";
import { contractTest } from "../helpers/contracts.ts";

function build(config: ChartConfig, width = 400, height = 240): Scene {
  const model = new ChartModel(
    { locale: "en-US", timeZone: "UTC", legend: false, ...config },
    undefined,
    ...staticCompilers(),
  );
  model.setSize(width, height, 1);
  return model.scene(estimateText);
}

/** The text items of every labels geometry in the first panel. */
function items(scene: Scene): TextItem[] {
  return scene.panels[0]!.marks.flatMap((g) =>
    g.kind === "labels" ? [...(g as LabelsGeometry).items] : [],
  );
}

const fills = (list: TextItem[]) => list.filter((item) => item.paint.color !== "transparent");

describe("labels of styled parts", () => {
  contractTest("label.parts.styled", () => {
    const scene = build({
      marks: [
        rule({
          y: 50,
          label: {
            content: ["SLO ", { value: true, style: { fontWeight: 700, color: "#c00000" } }],
            style: { halo: "auto" },
          },
        }),
      ],
      y: { domain: [0, 100] },
      x: { domain: [0, 10] },
    });
    const drawn = items(scene);
    // Halos of both parts first, then both fills.
    expect(drawn.map(({ text, paint }) => [text, paint.color === "transparent"])).toEqual([
      ["SLO ", true],
      ["50", true],
      ["SLO ", false],
      ["50", false],
    ]);
    expect(drawn.slice(0, 2).every((item) => item.halo)).toBe(true);
    const [first, second] = fills(drawn);
    // One baseline; the second part starts where the first ends.
    expect(first!.baseline).toBe("alphabetic");
    expect(second!.y).toBe(first!.y);
    expect(second!.x).toBeCloseTo(first!.x + estimateText("SLO ", first!.paint.css), 6);
    expect(second!.paint).toMatchObject({ weight: 700, color: "#c00000" });
    expect(first!.paint).toMatchObject({ weight: 400, color: scene.theme.muted });
    // The label is placed above its rule's end, as its plain text would be.
    const plain = build({
      marks: [rule({ y: 50, label: { text: "SLO 50", place: { attachment: "end" } } })],
      y: { domain: [0, 100] },
      x: { domain: [0, 10] },
    });
    const ruled = plain.panels[0]!.marks.find((g) => g.kind === "rule") as RuleGeometry;
    const end = ruled.x2;
    expect(second!.x + estimateText("50", second!.paint.css)).toBeCloseTo(end - 4, 0);
  });

  it("read parts' colors as the chart reads label colors, in PDF too", () => {
    const pdf = renderToPDF({
      locale: "en-US",
      width: 400,
      height: 240,
      y: { domain: [0, 100] },
      marks: [
        rule({
          y: 50,
          label: { content: ["SLO ", { value: true, style: { color: "var(--brand, #ff0000)" } }] },
        }),
      ],
    });
    // The variable's fallback, as a label style's color is read.
    const latin1 = Buffer.from(pdf).toString("latin1");
    const drawing = [...latin1.matchAll(/\/FlateDecode[^>]*>>\nstream\n/g)]
      .map((match) => {
        const start = match.index + match[0].length;
        const end = latin1.indexOf("\nendstream", start);
        return inflateSync(Buffer.from(pdf.subarray(start, end))).toString("latin1");
      })
      .join("");
    expect(drawing).toContain("1 0 0 rg");
  });

  it("fade parts' halos in PDF with the parts, none for parts not drawn", () => {
    const drawn = (opacity: number) => {
      const pdf = renderToPDF({
        locale: "en-US",
        width: 400,
        height: 240,
        y: { domain: [0, 100] },
        marks: [
          rule({
            y: 50,
            label: {
              content: ["SLO ", { value: true, style: { opacity } }],
              style: { halo: { color: "#ff0000", width: 4 } },
            },
          }),
        ],
      });
      const latin1 = Buffer.from(pdf).toString("latin1");
      const streams = [...latin1.matchAll(/\/FlateDecode[^>]*>>\nstream\n/g)]
        .map((match) => {
          const start = match.index + match[0].length;
          const end = latin1.indexOf("\nendstream", start);
          return inflateSync(Buffer.from(pdf.subarray(start, end))).toString("latin1");
        })
        .join("");
      return { streams, latin1 };
    };
    // One part's halo, the other's not drawn: one red halo stroke.
    const hidden = drawn(0).streams;
    expect(hidden.match(/1 0 0 RG/g)).toHaveLength(1);
    // Half faded, both drawn, the second's halo at half its opacity.
    const half = drawn(0.5);
    expect(half.streams.match(/1 0 0 RG/g)).toHaveLength(2);
    expect(half.latin1).toContain("/CA 0.5");
  });

  it("set lines as tall as their tallest part, each part in its font", () => {
    const rows = table({ x: [5], y: [5], name: ["Alpha"], value: [1234] });
    const scene = build({
      marks: [
        text(rows, {
          x: "x",
          y: "y",
          label: {
            content: [
              { field: "name", style: { fontSize: 16, fontWeight: 700 } },
              "\n",
              { field: "value", format: { number: ",.0f" }, style: { opacity: 0.7 } },
            ],
          },
        }),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const [name, value] = items(scene);
    expect(name!.text).toBe("Alpha");
    expect(value!.text).toBe("1,234");
    expect(name!.paint).toMatchObject({ size: 16, weight: 700 });
    expect(value!.paint.opacity).toBe(0.7);
    // The second line is below the first by half of each line's height.
    const tall = name!.paint.lineHeight;
    const short = value!.paint.lineHeight;
    expect(tall).toBeGreaterThan(short);
    expect(value!.y - name!.y).toBeCloseTo(
      tall / 2 + short / 2 + (value!.paint.size - name!.paint.size) * 0.27,
      6,
    );
    // Centered on the point, line by line.
    const middle = (item: TextItem) => item.x + estimateText(item.text, item.paint.css) / 2;
    expect(middle(name!)).toBeCloseTo(middle(value!), 6);
  });

  it("map each part's item to its label's row for picking", () => {
    const rows = table({ t: [2, 8], name: ["deploy", "rollback"] });
    const mark = rule(rows, {
      x: "t",
      label: { content: [{ field: "name", style: { fontWeight: 700 } }, " at ", { value: true }] },
    });
    const scene = build({ marks: [mark], x: { domain: [0, 10] }, y: { domain: [0, 1] } });
    const labels = scene.panels[0]!.marks.find((g) => g.kind === "labels") as LabelsGeometry;
    expect(labels.items.map(({ text }) => text)).toEqual([
      "deploy",
      " at ",
      "2",
      "rollback",
      " at ",
      "8",
    ]);
  });

  it("place regions' labels of parts inside their side", () => {
    const rows = table({ from: [2], to: [6], name: ["Freeze"] });
    const scene = build({
      marks: [
        region(rows, {
          x1: "from",
          x2: "to",
          label: { content: [{ field: "name", style: { fontWeight: 700 } }, " window"] },
        }),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const drawn = items(scene);
    const fill = scene.panels[0]!.marks.find((g) => g.kind === "rect") as RectGeometry;
    const [left, top] = [fill.rects[0]!, fill.rects[1]!];
    expect(drawn.length).toBeGreaterThan(0);
    for (const item of drawn) {
      expect(item.x).toBeGreaterThanOrEqual(left);
      expect(item.y - item.paint.size).toBeGreaterThanOrEqual(top);
    }
  });

  it("label bars with a bold name over a fainter value, inside their ends", () => {
    // b6.04: each bar's name in bold 12 px and its value below at 0.7 opacity.
    const rows = table({ name: ["Alpha", "Beta"], value: [80, 60] });
    const scene = build(
      {
        marks: [
          bar(rows, {
            x: "value",
            y: "name",
            labels: {
              content: [
                { field: "name", style: { fontWeight: 700, fontSize: 12 } },
                "\n",
                { value: true, style: { opacity: 0.7 } },
              ],
              place: { outside: false },
            },
          }),
        ],
        x: { domain: [0, 100] },
      },
      400,
      200,
    );
    const drawn = fills(items(scene));
    expect(drawn.map(({ text }) => text)).toEqual(["Alpha", "80", "Beta", "60"]);
    expect(drawn[0]!.paint.weight).toBe(700);
    expect(drawn[1]!.paint.opacity).toBe(0.7);
    const rects = scene.panels[0]!.marks.find((g) => g.kind === "rect") as RectGeometry;
    const end = rects.rects[0]! + rects.rects[2]!;
    // Inside the bar's end, the lines centered in their block.
    const right = (item: TextItem) => item.x + estimateText(item.text, item.paint.css);
    const middle = (item: TextItem) => (item.x + right(item)) / 2;
    expect(middle(drawn[0]!)).toBeCloseTo(middle(drawn[1]!), 6);
    expect(Math.max(right(drawn[0]!), right(drawn[1]!))).toBeLessThan(end);
    expect(drawn[1]!.y).toBeGreaterThan(drawn[0]!.y);
  });

  it("leave out bar labels of parts taller than their bars are thick, and keep small ones", () => {
    const rows = table({ name: ["a", "b", "c"], value: [80, 60, 40] });
    const drawn = (fontSize: number, height: number) =>
      fills(
        items(
          build(
            {
              marks: [
                bar(rows, {
                  x: "value",
                  y: "name",
                  labels: {
                    content: [{ value: true, style: { fontSize } }],
                    place: { outside: false },
                  },
                }),
              ],
              x: { domain: [0, 100] },
            },
            400,
            height,
          ),
        ),
      ).map(({ text }) => text);
    // Bars about 36 px thick: a 60 px part does not fit across them.
    expect(drawn(60, 180)).toEqual([]);
    expect(drawn(12, 180)).toEqual(["80", "60", "40"]);
    // Bars thinner than the base text: parts smaller than it still fit.
    expect(drawn(6, 60)).toEqual(["80", "60", "40"]);
  });

  it("measure bar labels of parts by their parts, whatever the base text's size", () => {
    // Labels of small parts in a large or a small base style.
    const content = [{ value: true as const, style: { fontSize: 6 } }];
    // Bars of a category drawn over each other, their ends close: their
    // labels past them meet, and some hide.
    const over = (fontSize: number) =>
      fills(
        items(
          build(
            {
              marks: [
                bar(table({ name: ["a", "a", "a"], value: [50, 51, 52] }), {
                  x: "value",
                  y: "name",
                  labels: { content, style: { fontSize }, overlap: "hide" },
                }),
              ],
              x: { domain: [0, 100] },
            },
            400,
            120,
          ),
        ),
      ).map(({ text }) => text);
    expect(over(60)).toEqual(over(6));
    expect(over(6).length).toBeLessThan(3);
    // Inside short upright bars: small parts fit where the base text would not.
    const short = (fontSize: number) =>
      fills(
        items(
          build(
            {
              marks: [
                bar(table({ name: ["a", "b"], value: [10, 12] }), {
                  x: "name",
                  y: "value",
                  labels: { content, style: { fontSize }, place: { outside: false } },
                }),
              ],
              y: { domain: [0, 100] },
            },
            400,
            240,
          ),
        ),
      ).map(({ text }) => text);
    expect(short(60)).toEqual(["10", "12"]);
    expect(short(6)).toEqual(["10", "12"]);
    // Parts on lines of their own: the break between them takes no height.
    const lines = (fontSize: number) =>
      fills(
        items(
          build(
            {
              marks: [
                bar(table({ name: ["a", "b", "c"], value: [80, 60, 40] }), {
                  x: "value",
                  y: "name",
                  labels: {
                    content: [...content, "\n", { field: "name", style: { fontSize: 6 } }],
                    style: { fontSize },
                    place: { outside: false },
                  },
                }),
              ],
              x: { domain: [0, 100] },
            },
            400,
            180,
          ),
        ),
      ).map(({ text }) => text);
    expect(lines(60)).toEqual(lines(6));
    expect(lines(6)).toHaveLength(6);
  });

  it("keep text labels of parts apart by their parts, whatever the base text's size", () => {
    // Three labels of small parts about 2 px apart: those placed later hide.
    const rows = table({ x: [5, 5, 5], y: [5, 5.1, 5.2], name: ["a", "b", "c"] });
    const drawn = (fontSize: number) =>
      fills(
        items(
          build({
            marks: [
              text(rows, {
                x: "x",
                y: "y",
                label: {
                  content: [{ field: "name", style: { fontSize: 6 } }],
                  style: { fontSize },
                  overlap: "hide",
                },
              }),
            ],
            x: { domain: [0, 10] },
            y: { domain: [0, 10] },
          }),
        ),
      ).map(({ text }) => text);
    expect(drawn(6)).toHaveLength(1);
    expect(drawn(200)).toEqual(drawn(6));
    // Labels of five lines, their lines as tall as their parts' size sets
    // them, at gaps around where they meet (about 20 px to a unit).
    const tall = (fontSize: number, gap: number) =>
      fills(
        items(
          build({
            marks: [
              text(
                table({ x: [5, 5], y: [5, 5 + gap], name: ["a\nb\nc\nd\ne", "f\ng\nh\ni\nj"] }),
                {
                  x: "x",
                  y: "y",
                  label: {
                    content: [{ field: "name", style: { fontSize: 6 } }],
                    style: { fontSize },
                    overlap: "hide",
                  },
                },
              ),
            ],
            x: { domain: [0, 10] },
            y: { domain: [0, 10] },
          }),
        ),
      ).length;
    // A blank line in a part is as tall as the part's lines.
    const blank = (fontSize: number) => {
      const [first, last] = fills(
        items(
          build({
            marks: [
              text(table({ x: [5], y: [5], name: ["a\n\nc"] }), {
                x: "x",
                y: "y",
                label: {
                  content: [{ field: "name", style: { fontSize: 6 } }],
                  style: { fontSize },
                },
              }),
            ],
            x: { domain: [0, 10] },
            y: { domain: [0, 10] },
          }),
        ),
      );
      return last!.y - first!.y;
    };
    expect(blank(60)).toBeCloseTo(blank(6), 6);
    for (let gap = 1.5; gap <= 2.8; gap += 0.05)
      expect(tall(60, gap), `${gap} apart`).toBe(tall(6, gap));
    expect(tall(6, 1.5)).toBeLessThan(tall(6, 2.8));
  });

  it("follow series with labels of parts", () => {
    const rows = table({ t: [0, 10], a: [2, 4], b: [6, 8] });
    const scene = build({
      marks: [
        line(rows, {
          x: "t",
          y: ["a", "b"],
          labels: {
            at: "last",
            content: [{ series: true, style: { fontWeight: 700 } }, " ", { value: true }],
          },
        }),
      ],
      y: { domain: [0, 10] },
    });
    expect(fills(items(scene)).map(({ text }) => text)).toEqual(["a", " ", "4", "b", " ", "8"]);
  });

  it("shorten the part that runs past the room with an ellipsis", () => {
    const kit = { ...GUIDE_KIT, isColor: () => true };
    const paint = textPaint([LIGHT.roles.text]);
    const parts = partText(
      kit,
      [
        { text: "Revenue ", style: { fontWeight: 700 } },
        { text: "1,234,567", style: undefined },
      ],
      paint,
      estimateText,
    );
    const bold = estimateText("Revenue ", GUIDE_KIT.cssFont(paint.font, paint.size, 700, false));
    const fitted = parts.fit(bold + 20)!;
    expect(fitted.lines.lines[0]).toMatch(/^Revenue 1.*…$/);
    expect(fitted.lines.width).toBeLessThanOrEqual(bold + 20);
    // Where nothing but the ellipsis would be left, the label is left out.
    expect(parts.fit(4)).toBeUndefined();
    // Where the ellipsis does not fit after the parts before it, the part before takes it.
    const short = partText(
      kit,
      [
        { text: "AB", style: undefined },
        { text: "CD", style: { fontWeight: 700 } },
      ],
      paint,
      estimateText,
    );
    const room = estimateText("AB", paint.css) + 1;
    const cut = short.fit(room)!;
    expect(cut.lines.lines[0]).toBe("A…");
    expect(cut.lines.width).toBeLessThanOrEqual(room);
  });
});

describe("what parts' styles refuse", () => {
  contractTest("label.parts.refused", () => {
    const spec = {
      version: 1,
      marks: [
        {
          type: "rule",
          y: 5,
          label: { content: ["SLO ", { value: true, style: { halo: false } }] },
        },
      ],
    } as unknown as ChartSpec;
    expect(() => validateSpec(spec)).toThrow(
      "marks[0].label.content[1].style: halo is the label's; give it in marks[0].label.style",
    );
    expect(() =>
      build({
        marks: [
          rule({
            y: 5,
            label: { content: [{ value: true, style: { padding: 2 } as never }] },
          }),
        ],
      }),
    ).toThrow(
      "marks[0].label.content[0].style: padding is the label's; give it in marks[0].label.style",
    );
  });
});
