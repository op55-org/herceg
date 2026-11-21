import { describe, expect, it } from "vitest";
import { facesLoaded, measurer, onFacesLoaded, roughText } from "../../src/dom/measurers.ts";
import type { MeasuringContext } from "../../src/layout/text.ts";

/** A document whose canvases measure a line as wide as its length; `canvases` counts them. */
function page(canvas = true) {
  const contexts: MeasuringContext[] = [];
  const document = {
    createElement: () => ({
      getContext: () => {
        if (!canvas) return null;
        const context: MeasuringContext = {
          font: "",
          measureText: (text) => ({
            width: text.length,
            actualBoundingBoxAscent: 0,
            fontBoundingBoxAscent: 0,
            fontBoundingBoxDescent: 0,
          }),
        };
        contexts.push(context);
        return context;
      },
    }),
  } as unknown as Document;
  return { document, contexts };
}

describe("each document's measurer", () => {
  it("is the document's own, and measures on a new canvas of it every 1,000 strings", () => {
    const one = page();
    const other = page();
    const measure = measurer(one.document);
    expect(measurer(one.document)).toBe(measure);
    expect(measurer(other.document)).not.toBe(measure);
    for (let i = 0; i < 2500; i++)
      expect(measure(`label ${i}`, "12px x")).toBe(`label ${i}`.length);
    expect(one.contexts).toHaveLength(3);
    expect(measure.context).toBe(one.contexts[2]);
    // The same measurer throughout: charts holding it measure on the new canvas.
    expect(measurer(one.document)).toBe(measure);
    expect(other.contexts).toHaveLength(1);
  });

  it("is made again, with charts told, when faces load in the document", () => {
    const { document, contexts } = page();
    const measure = measurer(document);
    let told = 0;
    const stop = onFacesLoaded(document, () => told++);
    facesLoaded(document);
    expect(told).toBe(1);
    const again = measurer(document);
    expect(again).not.toBe(measure);
    expect(again.context).toBe(contexts[1]);
    stop();
    facesLoaded(document);
    expect(told).toBe(1);
  });

  it("estimates where the document has no canvas to measure with", () => {
    expect(measurer(page(false).document)).toBe(roughText);
  });
});
