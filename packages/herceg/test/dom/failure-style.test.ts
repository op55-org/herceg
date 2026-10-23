// A mounted chart's alert, styled once its module loads (dom/failure-style.ts),
// looks as `showFailure` draws one over a chart.
import { describe, expect, it } from "vitest";
import { showFailure } from "../../src/dom/errors.ts";
import { styleFailure } from "../../src/dom/failure-style.ts";

/** An element of no document: what both read and write of one. */
function element() {
  const made = {
    style: { cssText: "" },
    textContent: "",
    setAttribute() {},
    append() {},
    ownerDocument: { createElement: () => element() },
  };
  return made;
}

describe("chart failures", () => {
  for (const kept of [false, true])
    it(
      kept ? "look alike as a banner over the last frame" : "look alike as a box over the chart",
      () => {
        const shown = showFailure(element() as never, new Error("x: no field"), kept);
        const styled = element();
        styleFailure(styled as never, kept);
        expect(styled.style.cssText).toBe(shown.style.cssText);
      },
    );
});
