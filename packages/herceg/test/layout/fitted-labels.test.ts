// A chart's fitted labels (layout/attached.ts `FittedLabels`): plain labels
// shortened to a width once, by text, font, and width, as `fitLabel`
// shortens them; fitted again once the measurer, its canvas, or the theme
// changes, or after 512; labels of parts fitted each time, by their parts.
import { describe, expect, it } from "vitest";
import { facesLoaded, measurer } from "../../src/dom/measurers.ts";
import { FittedLabels, fitLabel } from "../../src/layout/attached.ts";
import { estimateText, fitText, type MeasuringContext } from "../../src/layout/text.ts";
import type { PartText } from "../../src/marks/features/part-text.ts";
import { resolveTheme } from "../../src/theme.ts";

const FONT = "12px sans-serif";
const NAME = "recommendations-engine";

/** `fitText`, recording the lines it is asked to fit. */
function counting() {
  const asked: string[] = [];
  const fit: typeof fitText = (text, width, measure, font) => {
    asked.push(text);
    return fitText(text, width, measure, font);
  };
  return { fit, asked };
}

/**
 * A document whose canvases measure a character `wide.by` pixels wide: as
 * wide as its faces draw it, which faces loaded there change.
 */
function page() {
  const wide = { by: 6 };
  const document = {
    createElement: () => ({
      getContext: (): MeasuringContext => ({
        font: "",
        measureText: (text) => ({
          width: text.length * wide.by,
          actualBoundingBoxAscent: 0,
          fontBoundingBoxAscent: 0,
          fontBoundingBoxDescent: 0,
        }),
      }),
    }),
  } as unknown as Document;
  return { document, wide };
}

describe("a chart's fitted labels", () => {
  it("fit a plain label once for its text, font, and width, as fitLabel does", () => {
    const fitted = new FittedLabels();
    const { fit, asked } = counting();
    const once = fitted.fit(NAME, undefined, 64, FONT, estimateText, fit);
    expect(once).toEqual(fitLabel(NAME, undefined, 64, FONT, estimateText, fitText));
    expect(once![0]).toMatch(/^recomm.*…$/);
    expect(fitted.fit(NAME, undefined, 64, FONT, estimateText, fit)).toEqual(once);
    expect(asked).toEqual([NAME]);
    // Lines each fitted, those within the width kept.
    const lines = `SLO\n${NAME}`;
    expect(fitted.fit(lines, undefined, 64, FONT, estimateText, fit)).toEqual(
      fitLabel(lines, undefined, 64, FONT, estimateText, fitText),
    );
    // Labels that do not fit stay left out, fitted once.
    expect(fitted.fit(NAME, undefined, 4, FONT, estimateText, fit)).toBeUndefined();
    expect(fitted.fit(NAME, undefined, 4, FONT, estimateText, fit)).toBeUndefined();
    expect(asked.filter((line) => line === NAME)).toHaveLength(3);
  });

  it("fit a label again at another width or in another font, keeping each", () => {
    const fitted = new FittedLabels();
    const { fit, asked } = counting();
    const bold = "700 12px sans-serif";
    const at = (width: number, font = FONT) =>
      fitted.fit(NAME, undefined, width, font, estimateText, fit);
    const narrow = at(64);
    const wide = at(100);
    expect(wide).toEqual(fitLabel(NAME, undefined, 100, FONT, estimateText, fitText));
    expect(wide![0].length).toBeGreaterThan(narrow![0].length);
    expect(at(64, bold)).toEqual(fitLabel(NAME, undefined, 64, bold, estimateText, fitText));
    expect(asked).toHaveLength(3);
    // Each is kept: back at the first width, in the first font, none is fitted again.
    expect(at(64)).toEqual(narrow);
    expect(at(100)).toEqual(wide);
    expect(asked).toHaveLength(3);
  });

  it("keep apart labels whose font and text join alike", () => {
    // CSS allows a line break in a font's families, which a label's text may hold too.
    const fitted = new FittedLabels();
    const { fit } = counting();
    const one = ["12px Arial", `, monospace\n${NAME}`] as const;
    const other = ["12px Arial\n, monospace", NAME] as const;
    for (const [font, text] of [one, other])
      expect(fitted.fit(text, undefined, 64, font, estimateText, fit)).toEqual(
        fitLabel(text, undefined, 64, font, estimateText, fitText),
      );
    expect(fitted.fit(other[1], undefined, 64, other[0], estimateText, fit)![0]).not.toContain(
      "\n",
    );
  });

  it("fit labels again with the measurer made when faces load", () => {
    const { document, wide } = page();
    const fitted = new FittedLabels();
    const { fit, asked } = counting();
    const before = measurer(document);
    const first = fitted.fit(NAME, undefined, 64, FONT, before, fit);
    expect(fitted.fit(NAME, undefined, 64, FONT, before, fit)).toEqual(first);
    expect(asked).toHaveLength(1);
    // The faces loaded draw it narrower: more of it fits.
    wide.by = 4;
    facesLoaded(document);
    const after = measurer(document);
    expect(after).not.toBe(before);
    const again = fitted.fit(NAME, undefined, 64, FONT, after, fit);
    expect(asked).toHaveLength(2);
    expect(again).toEqual(fitLabel(NAME, undefined, 64, FONT, after, fitText));
    expect(again![0].length).toBeGreaterThan(first![0].length);
  });

  it("fit labels again once their measurer measures on a new canvas", () => {
    const { document } = page();
    const fitted = new FittedLabels();
    const { fit, asked } = counting();
    const measure = measurer(document);
    const first = fitted.fit(NAME, undefined, 64, FONT, measure, fit);
    const canvas = measure.context;
    // 1,000 strings later, the measurer measures on another canvas of the page.
    for (let k = 0; measure.context === canvas; k++) measure(`value ${k}`, FONT);
    expect(fitted.fit(NAME, undefined, 64, FONT, measure, fit)).toEqual(first);
    expect(asked).toHaveLength(2);
    expect(fitted.fit(NAME, undefined, 64, FONT, measure, fit)).toEqual(first);
    expect(asked).toHaveLength(2);
  });

  it("fit labels again in another theme", () => {
    const fitted = new FittedLabels();
    const { fit, asked } = counting();
    const label = () => fitted.fit(NAME, undefined, 64, FONT, estimateText, fit);
    fitted.use(resolveTheme("light"));
    const first = label();
    fitted.use(resolveTheme("light"));
    label();
    expect(asked).toHaveLength(1);
    fitted.use(resolveTheme("dark"));
    expect(label()).toEqual(first);
    expect(asked).toHaveLength(2);
  });

  it("keep 512 labels, then forget them all", () => {
    const fitted = new FittedLabels();
    const { fit, asked } = counting();
    const label = (k: number) => fitted.fit(`${NAME}-${k}`, undefined, 64, FONT, estimateText, fit);
    for (let k = 0; k < 512; k++) label(k);
    expect(asked).toHaveLength(512);
    label(0);
    expect(asked).toHaveLength(512);
    // The 513th: the first is fitted again.
    label(512);
    label(0);
    expect(asked).toHaveLength(514);
  });

  it("fit labels of parts each time, by their parts", () => {
    const fitted = new FittedLabels();
    const { fit, asked } = counting();
    const widths: number[] = [];
    const parts = {
      lines: { lines: [NAME], widths: [140], width: 140, height: 14 },
      fit(width: number) {
        widths.push(width);
        return { ...parts, lines: { ...parts.lines, lines: ["recomm…"], width } };
      },
    } as unknown as PartText;
    for (let k = 0; k < 2; k++)
      expect(fitted.fit(NAME, parts, 64, FONT, estimateText, fit)![0]).toBe("recomm…");
    expect(widths).toEqual([64, 64]);
    expect(asked).toEqual([]);
  });
});
