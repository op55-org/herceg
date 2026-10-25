// Reading values in each placement: the pointer's tooltip reads the panel
// it is over (an inset over its parent), and the keyboard's cursor reads
// one panel at a time, moving between them.
import { describe, expect } from "vitest";
import type { Chart } from "../../../src/dom/chart.ts";
import type { Inspection } from "../../../src/model/model.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { frame, heard, key, mount, panelOf, placements, pointer, within } from "./helpers.ts";

/** The tooltips the chart shows now. */
const tooltipsOf = (chart: Chart) =>
  [...chart.root.children].filter(
    (el) =>
      el.tagName === "DIV" &&
      (el as HTMLElement).style.pointerEvents === "none" &&
      (el as HTMLElement).style.display === "block",
  );

/** Moves the pointer to x value `value` of panel `key`, at a height of its plot. */
async function hover(chart: Chart, key: string, value: number, fy = 0.5) {
  const x = chart.toPixel(value, { panel: key, axis: "x" })!;
  const [, y] = within(chart, key, 0.5, fy);
  pointer(chart, "pointermove", x, y);
  await frame();
}

/** The marks a placement draws in panel `key`, by index: all of them in a chart of one panel or facets. */
const marksOf = (name: string, key: string) =>
  name === "subplots" ? [key === "a" ? 0 : 1] : name === "insets" ? [key === "main" ? 0 : 1] : [0];

describe("tooltips in each placement", () => {
  for (const placement of placements().filter(({ name }) => name !== "chart"))
    contractTest(
      `interaction.tooltip.${placement.name}.engine`,
      async () => {
        const chart = await mount(placement.options());
        const hovers = heard(chart, "hover");
        await hover(chart, placement.target, 4, 0.7);
        const inspection = hovers.at(-1)?.inspection as Inspection | undefined;
        expect(inspection?.panel).toBe(placement.target);
        expect(inspection?.axis).toBe("x");
        expect(inspection?.value).toBe(4);
        // Of the panel's marks and rows only.
        for (const point of inspection!.points) {
          expect(marksOf(placement.name, placement.target)).toContain(point.mark);
          if (placement.name === "facets") expect(point.row).toBeGreaterThanOrEqual(10);
        }
        expect(tooltipsOf(chart)).toHaveLength(1);
      },
      `the pointer's tooltip in ${placement.name} reads the panel it is over`,
    );

  contractTest(
    "interaction.tooltip.insets.occlusion.engine",
    async () => {
      const [, , , insets] = placements();
      const chart = await mount(insets!.options());
      const hovers = heard(chart, "hover");
      const inset = panelOf(chart, "detail").plot;
      const main = panelOf(chart, "main").plot;
      // Over the inset, which covers part of its parent's plot: the inset's.
      const [x, y] = within(chart, "detail");
      expect(x > main.x && x < main.x + main.width && y > main.y && y < main.y + main.height).toBe(
        true,
      );
      pointer(chart, "pointermove", x, y);
      await frame();
      expect(hovers.at(-1)?.inspection?.panel).toBe("detail");
      expect(chart.inspect(x, y)?.panel).toBe("detail");
      // Beside it, over the parent alone: the parent's.
      const [mx, my] = [main.x + 10, inset.y + inset.height + 10];
      pointer(chart, "pointermove", mx, my);
      await frame();
      expect(hovers.at(-1)?.inspection?.panel).toBe("main");
      expect(tooltipsOf(chart)).toHaveLength(1);
    },
    "the pointer over an inset reads the inset, not the parent under it",
  );
});

describe("the keyboard in each placement", () => {
  for (const placement of placements().filter(({ name }) => name !== "chart"))
    contractTest(
      `interaction.keyboard.${placement.name}.engine`,
      async () => {
        const chart = await mount(placement.options());
        const hovers = heard(chart, "hover");
        const panelNow = () => (hovers.at(-1)?.inspection as Inspection | undefined)?.panel;
        chart.root.focus();
        key(chart, "Home");
        const first = chart.getPanels()[0]!.key;
        expect(panelNow()).toBe(first);
        // Down moves to the next panel, in reading order.
        for (let i = 0; i < 4 && panelNow() !== placement.target; i++) key(chart, "ArrowDown");
        expect(panelNow()).toBe(placement.target);
        const before = hovers.at(-1)!.inspection!.value as number;
        key(chart, "ArrowRight");
        const after = hovers.at(-1)!.inspection!;
        expect(after.panel).toBe(placement.target);
        expect(after.value as number).toBeGreaterThan(before);
        const live = chart.root.querySelector("[aria-live]")!;
        expect(live.textContent).not.toBe("");
      },
      `the keyboard's cursor in ${placement.name} reads one panel at a time, moving between them`,
    );
});
