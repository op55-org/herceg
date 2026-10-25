// A range navigator moving one panel's x: the subplot or facet panel it
// names, leaving the others; and the marks it cannot draw, refused.
import { describe, expect, it } from "vitest";
import type { Chart } from "../../../src/dom/chart.ts";
import { columns, panel } from "../../../src/layout.ts";
import { line } from "../../../src/marks/line.ts";
import { rule } from "../../../src/marks/rule.ts";
import { facet } from "../../../src/model/facet.ts";
import { rangeNavigator } from "../../../src/model/navigator.ts";
import { panels } from "../../../src/model/panels.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { MOUSE, mount, mountNow, rows } from "./helpers.ts";

const data = rows();

const strip = (chart: Chart) =>
  chart.root.querySelector<HTMLElement>('[role="group"][aria-label="Range navigator"]')!;
const sliders = (chart: Chart) => [
  ...strip(chart).querySelectorAll<HTMLElement>('[role="slider"]'),
];

/** Drags the navigator's window `dx` pixels along its strip, from its middle. */
function dragWindow(chart: Chart, dx: number) {
  const window = sliders(chart)[1]!;
  const box = window.getBoundingClientRect();
  const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
  for (const [type, at] of [
    ["pointerdown", x],
    ["pointermove", x + dx / 2],
    ["pointermove", x + dx],
    ["pointerup", x + dx],
  ] as const)
    window.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        pointerId: MOUSE,
        isPrimary: true,
        clientX: at,
        clientY: y,
      }),
    );
}

describe("a navigator naming a panel", () => {
  for (const placement of ["subplots", "facets"] as const)
    contractTest(
      `interaction.navigator.${placement}.panel.engine`,
      async () => {
        const [target, other] = placement === "subplots" ? ["b", "a"] : ["us", "eu"];
        const chart = await mount({
          ...(placement === "subplots"
            ? {
                marks: [
                  line(data, { x: "t", y: "v", panel: "a" }),
                  line(data, { x: "t", y: "w", panel: "b" }),
                ],
                panels: panels(columns([1, 1], [panel("a"), panel("b")])),
              }
            : { marks: [line(data, { x: "t", y: "v" })], facet: facet("region") }),
          x: { scope: "panel" },
          navigator: rangeNavigator({ panel: target }),
        });
        chart.setViewport({ x: [2, 4] }, { panel: target });
        chart.render();
        // The window shows the named panel's view.
        expect(Number(sliders(chart)[0]!.getAttribute("aria-valuenow"))).toBeCloseTo(2, 6);
        expect(Number(sliders(chart)[2]!.getAttribute("aria-valuenow"))).toBeCloseTo(4, 6);
        // Over the strip, which lies under the named panel.
        const box = strip(chart).getBoundingClientRect();
        const window = sliders(chart)[1]!.getBoundingClientRect();
        expect(window.left, "window's left").toBeGreaterThanOrEqual(box.left);
        expect(window.right, "window's right").toBeLessThanOrEqual(box.right);
        const views: unknown[] = [];
        chart.on("viewport", (event) => views.push(event));
        dragWindow(chart, 40);
        chart.render();
        const [x0, x1] = chart.getViewport({ panel: target }).x!;
        expect(x0).toBeGreaterThan(2);
        expect(x1 - x0).toBeCloseTo(2, 6);
        expect(chart.getViewport({ panel: other }).x).toBeNull();
        expect(views.length).toBeGreaterThan(0);
      },
      `a navigator naming a ${placement === "subplots" ? "subplot" : "facet panel"} moves that panel's x alone`,
    );
});

describe("a navigator dragged", () => {
  it("end the drag once the panel it moves is another", async () => {
    const options = (target: string) => ({
      marks: [
        line(data, { x: "t", y: "v", panel: "a" }),
        line(data, { x: "t", y: "w", panel: "b" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
      x: { scope: "panel" as const },
      navigator: rangeNavigator({ panel: target }),
    });
    const chart = await mount(options("a"));
    chart.setViewport({ x: [2, 4] }, { panel: "a" });
    chart.render();
    const window = sliders(chart)[1]!;
    const box = window.getBoundingClientRect();
    const [x, y] = [box.left + box.width / 2, box.top + box.height / 2];
    const send = (type: string, at: number) =>
      sliders(chart)[1]!.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: MOUSE,
          isPrimary: true,
          clientX: at,
          clientY: y,
        }),
      );
    send("pointerdown", x);
    send("pointermove", x + 20);
    const dragged = chart.getViewport({ panel: "a" }).x!;
    expect(dragged[0]).toBeGreaterThan(2);
    // b, showing what a does, is the one the strip moves now.
    chart.setViewport({ x: dragged }, { panel: "b" });
    chart.update(options("b"));
    chart.render();
    // Escape takes no view of a's back to b.
    sliders(chart)[1]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    send("pointermove", x + 60);
    send("pointerup", x + 60);
    // b keeps its view: the drag, of a's, ended.
    expect(chart.getViewport({ panel: "b" }).x).toEqual(dragged);
  });
});

describe("a navigator's marks", () => {
  contractTest(
    "interaction.navigator.chart.marks-refused.engine",
    () => {
      const marks = [line(data, { x: "t", y: "v", id: "trend" }), rule({ y: 20, id: "goal" })];
      const make = (listed: string[]) => () =>
        mountNow({ marks, navigator: rangeNavigator({ marks: listed }), errorMode: "throw" });
      expect(make(["missing"])).toThrow('navigator marks: no mark "missing" in the chart');
      expect(make(["goal"])).toThrow(
        'navigator marks: draws line, area, point, bar, and candlestick marks, not rule "goal"',
      );
      expect(make(["trend"])).not.toThrow();
    },
    "a navigator refuses marks the chart lacks and marks it cannot draw",
  );
});
