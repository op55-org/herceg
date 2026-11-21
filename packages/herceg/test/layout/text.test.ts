import { describe, expect, it } from "vitest";
import { textItemMarkup } from "../../src/draw/text.ts";
import { paintedMiddle } from "../../src/layout/attached.ts";
import { anchorBlock } from "../../src/layout/block.ts";
import {
  canvasMeasurer,
  estimateText,
  fontKind,
  type MeasuringContext,
  textBox,
  textItem,
  textLines,
} from "../../src/layout/text.ts";
import { measurePdfText } from "../../src/render/pdf-fonts.ts";
import { haloOf, type TextPaint, textPaint } from "../../src/style/style.ts";
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
      '<tspan x="104" y="49" dominant-baseline="middle">ab</tspan><tspan x="104" y="61" dominant-baseline="middle">cdef</tspan>',
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
    expect(turned).toContain('<tspan x="100" y="62" dominant-baseline="middle">b</tspan>');
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
        return {
          width: text.length,
          actualBoundingBoxAscent: 5,
          fontBoundingBoxAscent: 10,
          fontBoundingBoxDescent: 3,
        };
      },
    });
    expect(lines("ab\ncdef\n", "12px x")).toBe(4);
    expect(seen).toEqual(["ab", "cdef", ""]);
    // Text drawn by its middle, its baseline half an x-height below: the
    // font's box (10 up, 3 down) a pixel above.
    const paint = { css: "12px x", size: 12 } as TextPaint;
    expect(paintedMiddle(lines.context, paint)).toBe(-1);
    // Without a context, Arial's; PDF's Helvetica drawn 0.35 em above its baseline.
    expect(paintedMiddle(undefined, paint)).toBeCloseTo(-0.087 * 12, 9);
    expect(paintedMiddle(measurePdfText.context, paint)).toBeCloseTo(0.0945 * 12, 9);
    for (const measure of [estimateText, measurePdfText])
      expect(measure("ab\nlonger", "12px x")).toBe(measure("longer", "12px x"));
  });

  it("measures on a new context every 1,000 strings, in the font asked for, keeping its widths", () => {
    // Contexts that measure a line as wide as its length in its font's pixels.
    const made: { context: MeasuringContext; lines: string[] }[] = [];
    const context = (): MeasuringContext => {
      const lines: string[] = [];
      const own: MeasuringContext = {
        font: "10px sans-serif",
        measureText(text) {
          lines.push(text);
          return {
            width: text.length * Number.parseFloat(own.font),
            actualBoundingBoxAscent: 0,
            fontBoundingBoxAscent: 0,
            fontBoundingBoxDescent: 0,
          };
        },
      };
      made.push({ context: own, lines });
      return own;
    };
    const counts = () => made.map(({ lines }) => lines.length);
    let refuse = false;
    const measure = canvasMeasurer(context(), () => (refuse ? null : context()));
    const strings = (from: number, count: number) =>
      Array.from({ length: count }, (_, i) => `line ${from + i}`);
    for (const line of strings(0, 998)) measure(line, "12px x");
    // Measured already, a string is the cache's: the context measures nothing.
    expect(measure("line 0", "12px x")).toBe(6 * 12);
    // A string of two lines is the context's 999th; the 1,001st is the next
    // context's, in its font, which fonts' metrics read.
    expect(measure("a\nbb", "20px x")).toBe(40);
    measure("line 998", "12px x");
    expect(counts()).toEqual([1001]);
    expect(measure("x", "20px x")).toBe(20);
    expect(counts()).toEqual([1001, 1]);
    expect(made[1]!.context.font).toBe("20px x");
    expect(measure.context).toBe(made[1]!.context);
    for (const line of strings(1000, 999)) measure(line, "12px x");
    expect(counts()).toEqual([1001, 1000]);
    // A context the document cannot make leaves the old one measuring 1,000 more.
    refuse = true;
    expect(measure("line 2000", "12px x")).toBe(9 * 12);
    refuse = false;
    for (const line of strings(2001, 999)) measure(line, "12px x");
    expect(counts()).toEqual([1001, 2000]);
    expect(measure("line 3000", "12px x")).toBe(9 * 12);
    expect(counts()).toEqual([1001, 2000, 1]);
    expect(measure.context).toBe(made[2]!.context);
    // Widths measured on an old context stay the cache's.
    expect(measure("line 5", "12px x")).toBe(6 * 12);
    expect(counts()).toEqual([1001, 2000, 1]);
    // Without `renew`, one context measures everything.
    const one = canvasMeasurer(context());
    for (const line of strings(0, 2500)) one(line, "12px x");
    expect(counts().at(-1)).toBe(2500);
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
