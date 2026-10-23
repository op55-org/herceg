import { describe, expect, it } from "vitest";
import { textItemMarkup } from "../../src/draw/text.ts";
import {
  anchorBlock,
  canvasMeasurer,
  estimateText,
  fontKind,
  textBox,
  textItem,
  textLines,
} from "../../src/layout/text.ts";
import { measurePdfText } from "../../src/render/pdf-fonts.ts";
import { haloOf, textPaint } from "../../src/style/style.ts";
import { resolveTheme } from "../../src/theme.ts";

describe("text estimates", () => {
  it("scale with the font size and pad Helvetica widths by a tenth", () => {
    expect(estimateText("iiii", "12px sans-serif")).toBeCloseTo(4 * 0.222 * 12 * 1.1);
    expect(estimateText("iiii", "24px sans-serif")).toBeCloseTo(2 * estimateText("iiii", "12px x"));
  });

  it("give monospace fonts an even width per glyph", () => {
    const mono = estimateText("iiiiiiiiii", "12px ui-monospace, Menlo, monospace");
    expect(mono).toBeCloseTo(10 * 0.6 * 12 * 1.1);
    expect(estimateText("WWWWWWWWWW", "12px Courier")).toBeCloseTo(mono);
  });

  it("read font families in order, as the first recognized one draws", () => {
    expect(fontKind("Arial, monospace")).toBe("sans");
    expect(fontKind('"Fira Code", Monaco, monospace')).toBe("monospace");
    expect(fontKind("Unknown Face, Georgia, serif")).toBe("serif");
    expect(fontKind("Unknown Face")).toBe("sans");
    expect(estimateText("WWWWWWWWWW", "12px Arial, monospace")).toBeCloseTo(10 * 0.944 * 12 * 1.1);
    expect(estimateText("WWWWWWWWWW", "12px Monaco")).toBeCloseTo(10 * 0.6 * 12 * 1.1);
  });

  it("measure PDF text with the standard fonts' own widths", () => {
    expect(measurePdfText("iiiiiiiiiiiiiiiiiiii", "12px Georgia, serif")).toBeCloseTo(
      20 * 0.278 * 12,
    );
    expect(measurePdfText("iiiiiiiiii", "12px ui-monospace")).toBeCloseTo(10 * 0.6 * 12);
    // Titles are bold.
    expect(measurePdfText("Sales", "600 15px Inter, sans-serif")).toBeGreaterThan(
      measurePdfText("Sales", "15px Inter, sans-serif"),
    );
  });
});

describe("text layout", () => {
  const paint = textPaint([
    { font: "sans-serif", fontSize: 10, lineHeight: 1.2, color: "#333333" },
    { background: { fill: "#eeeeee" }, padding: { top: 1, right: 2, bottom: 3, left: 4 } },
  ]);
  const measure = (text: string) => text.length * 5;
  const at = { x: 100, y: 50, anchor: "start", baseline: "middle", angle: 0 } as const;

  it("breaks text into measured lines at line breaks", () => {
    expect(textLines("ab\ncdef", paint, measure)).toEqual({
      lines: ["ab", "cdef"],
      widths: [10, 20],
      width: 20,
      height: 24,
    });
  });

  it("boxes text around its lines, padded, wherever its point is on it", () => {
    const lines = textLines("ab\ncdef", paint, measure);
    expect(textBox(lines, at, paint)).toEqual({ x: 96, y: 43, width: 26, height: 28 });
    // Centered and ended text, and a box below a hanging first line.
    expect(textBox(lines, { ...at, anchor: "middle" }, paint).x).toBe(86);
    expect(textBox(lines, { ...at, anchor: "end" }, paint).x).toBe(76);
    expect(textBox(lines, { ...at, baseline: "hanging" }, paint).y).toBe(48);
  });

  it("places a block of lines by its sides or middle, its box's padding inside it", () => {
    const lines = textLines("ab\ncdef", paint, measure);
    const block = (align: "start" | "center" | "end", verticalAlign: "top" | "middle" | "bottom") =>
      anchorBlock(lines, { x: 100, y: 50, align, verticalAlign, angle: 0 }, paint);
    // The box's top left, bottom right, and middle at the point; the first
    // line's middle inside it by the padding and half a line.
    expect(block("start", "top")).toEqual({
      at: { x: 104, y: 57, anchor: "start", baseline: "middle", angle: 0 },
      box: { x: 100, y: 50, width: 26, height: 28 },
    });
    expect(block("end", "bottom").box).toEqual({ x: 74, y: 22, width: 26, height: 28 });
    expect(block("center", "middle").box).toEqual({ x: 87, y: 36, width: 26, height: 28 });
    // Without a box, the lines alone are placed, unpadded.
    const plain = textPaint([{ fontSize: 10, lineHeight: 1.2 }]);
    expect(
      anchorBlock(lines, { x: 100, y: 50, align: "start", verticalAlign: "top", angle: 0 }, plain),
    ).toEqual({
      at: { x: 100, y: 56, anchor: "start", baseline: "middle", angle: 0 },
      box: undefined,
    });
  });

  it("turns a block about its anchor", () => {
    const lines = textLines("ab\ncdef", paint, measure);
    const anchor = { x: 100, y: 50, align: "start", verticalAlign: "top", angle: 90 } as const;
    const { at, box } = anchorBlock(lines, anchor, paint);
    // The unturned box's top left, turned about the text's point as
    // renderers turn it, is the anchor.
    const turned = (x: number, y: number) => [at.x - (y - at.y), at.y + (x - at.x)];
    const [x, y] = turned(box!.x, box!.y);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(50);
  });

  it("keeps a guide's lines in one item, boxed around them all, drawn a line height apart", () => {
    const item = textItem("ab\ncdef", at, { ...paint, halo: "auto" }, "#ffffff", measure);
    // The box starts where the text would and is centered on its first line
    // as the text would be; the text moves in by the padding (4 left, and
    // 1 above against 3 below).
    expect([item.text, item.x, item.y]).toEqual(["ab\ncdef", 104, 49]);
    expect(item.box).toEqual({ x: 100, y: 42, width: 26, height: 28 });
    // Text in a box is drawn on the box, whatever is under it.
    expect(item.halo).toEqual({ color: "#eeeeee", width: 3, opacity: 1 });
    expect(textItemMarkup(item, resolveTheme("light"))).toContain(
      '<tspan x="104" y="49">ab</tspan><tspan x="104" y="61">cdef</tspan>',
    );
    // Without a background, nothing is measured.
    const plain = textPaint([{ fontSize: 10 }]);
    const unmeasured = textItem("ab", at, plain, "#ffffff", () => {
      throw new Error("measured");
    });
    expect(unmeasured).toEqual({
      type: "text",
      text: "ab",
      x: 100,
      y: 50,
      anchor: "start",
      baseline: "middle",
      angle: 0,
      paint: plain,
    });
  });

  it("stacks turned lines along the text's own down, moving a box's text in its turn", () => {
    // Lines go down in the text's frame, which the element's turn turns.
    const plain = textPaint([{ fontSize: 10, lineHeight: 1.2 }]);
    const turned = textItemMarkup(
      textItem("a\nb", { ...at, angle: -90 }, plain, "#ffffff"),
      resolveTheme("light"),
    );
    expect(turned).toContain('transform="rotate(-90 100 50)"');
    expect(turned).toContain('<tspan x="100" y="62">b</tspan>');
    // Padded 4 at its start and 1 above against 3 below, read upward: the
    // text moves up by 4 and left by 1.
    const boxed = textItem("a\nb", { ...at, angle: -90 }, paint, "#ffffff", measure);
    expect([boxed.x, boxed.y]).toEqual([expect.closeTo(99), expect.closeTo(46)]);
  });

  it("measures text of several lines by its widest, a line at a time", () => {
    const seen: string[] = [];
    const lines = canvasMeasurer({
      font: "",
      measureText(text) {
        seen.push(text);
        return { width: text.length };
      },
    });
    expect(lines("ab\ncdef\n", "12px x")).toBe(4);
    expect(seen).toEqual(["ab", "cdef", ""]);
    for (const measure of [estimateText, measurePdfText])
      expect(measure("ab\nlonger", "12px x")).toBe(measure("longer", "12px x"));
  });

  it("gives automatic halos the surface's color, whatever the text's, and others their own", () => {
    for (const surface of ["#ffffff", "#12151c"])
      expect(haloOf("auto", surface)).toEqual({ color: surface, width: 3, opacity: 1 });
    expect(haloOf({ color: "#123456" }, "#ffffff")).toEqual({
      color: "#123456",
      width: 3,
      opacity: 1,
    });
    expect(haloOf({ color: "#123456", width: 5, opacity: 0.5 }, "#ffffff")).toEqual({
      color: "#123456",
      width: 5,
      opacity: 0.5,
    });
    expect(haloOf(false, "#ffffff")).toBeUndefined();
  });
});
