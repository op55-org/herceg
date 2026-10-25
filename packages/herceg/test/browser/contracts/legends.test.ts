// Proofs of the matrix's legend toggles (test/contracts/), one per row: a
// click on a legend's button hides what it names, there and nowhere else,
// and a second click shows it again.

import { describe, expect } from "vitest";
import type { Chart } from "../../../src/dom/chart.ts";
import type { Geometry } from "../../../src/scene/scene.ts";
import { guidesOf } from "../../../src/scene/scene.ts";
import {
  cellsOf,
  drawsNothing,
  fixtureOf,
  markOf,
  neighbor,
  paintsOf,
} from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { legendButtons, mount, sceneOf } from "./mount.ts";

/**
 * How much geometry draws: its points, items, and labels, and one for a
 * drawing of none to count (a rule).
 */
function drawn(geometry: readonly Geometry[]): number {
  return geometry.reduce(
    (total, g) =>
      drawsNothing(g)
        ? total
        : total + Math.max(g.draw.size(g) + ((g as { count?: number }).count ?? 0), 1),
    0,
  );
}

/**
 * Expects what each panel draws after hiding a row's entry: less, or for a
 * row whose hidden shapes stay (in the fill for no data), as much.
 */
function expectLess(row: string, after: number | undefined, before: number): void {
  if (fixtureOf(row).hiddenStay) expect(after).toBe(before);
  else expect(after).toBeLessThan(before);
}

/** What each panel draws, by panel. */
function byPanel(chart: Chart): Record<string, number> {
  chart.render();
  return Object.fromEntries(sceneOf(chart).panels.map((p) => [p.key, drawn(p.marks)]));
}

function click(chart: Chart, button: HTMLButtonElement): void {
  button.click();
  chart.render();
}

const twoPanels = [{ id: "a" }, { id: "b" }];

/** The colors each panel's marks paint, by panel. */
function paintsByPanel(chart: Chart): Record<string, string[]> {
  chart.render();
  return Object.fromEntries(
    sceneOf(chart).panels.map((p) => [p.key, [...paintsOf(p.marks)].sort()]),
  );
}

/** The legends' entries' keys, labels, and swatch colors, in order: those of one panel's legend, with `panel`. */
function entriesOf(chart: Chart, panel?: string): { key: string; label: string; color: string }[] {
  return guidesOf(sceneOf(chart), "legend")
    .filter((legend) => panel === undefined || legend.panel === panel)
    .flatMap((legend) => legend.entries.map(({ key, label, color }) => ({ key, label, color })));
}

describe("legend.toggle", () => {
  for (const cell of cellsOf("legend.toggle"))
    contractTest(`${cell.row}.legend.toggle`, async () => {
      const { toggle } = fixtureOf(cell.row);
      if (cell.state === "na") {
        // Beside a line of two series in another panel, the legend's
        // buttons are the line's: hiding them all leaves the mark as it was.
        const chart = await mount({
          panels: twoPanels,
          marks: [neighbor({ series: "kind", panel: "a" }), markOf(cell.row, { panel: "b" })],
          legend: true,
        });
        const before = byPanel(chart);
        expect(legendButtons(chart).map((b) => b.textContent)).toEqual(["k", "m"]);
        for (const button of legendButtons(chart)) click(chart, button);
        expect(byPanel(chart)).toEqual({ ...before, a: 0 });
        return;
      }
      if (cell.state !== "works") throw new Error(`legend.toggle is never ${cell.state}`);
      const chart = await mount({ marks: [markOf(cell.row, toggle)], legend: true });
      const before = { drawn: byPanel(chart)[""]!, paints: paintsByPanel(chart)[""]! };
      const [first, ...others] = entriesOf(chart);
      const [button] = legendButtons(chart);
      expect(first, "a legend entry of the mark").toBeDefined();
      expect(before.paints, "its color is drawn").toContain(first!.color);
      expect(button!.textContent).toBe(first!.label);
      click(chart, button!);
      expect(button!.getAttribute("aria-pressed")).toBe("false");
      expect(chart.getHiddenKeys()).toEqual([first!.key]);
      // What it names is drawn no more; what other entries name still is.
      expectLess(cell.row, byPanel(chart)[""], before.drawn);
      const hidden = paintsByPanel(chart)[""]!;
      if (others.every(({ color }) => color !== first!.color))
        expect(hidden).not.toContain(first!.color);
      for (const { color } of others) expect(hidden).toContain(color);
      click(chart, button!);
      expect(button!.getAttribute("aria-pressed")).toBe("true");
      expect(chart.getHiddenKeys()).toEqual([]);
      expect(paintsByPanel(chart)[""]).toEqual(before.paints);
      expect(byPanel(chart)[""]).toBe(before.drawn);
    });
});

describe("legend.panel-toggle", () => {
  for (const cell of cellsOf("legend.panel-toggle"))
    contractTest(`${cell.row}.legend.panel-toggle`, async () => {
      const { toggle } = fixtureOf(cell.row);
      const legends = twoPanels.map(({ id }) => ({ type: "legend", panel: id }));
      if (cell.state === "na") {
        // The panels' legends list a line's series in one, and nothing of the mark in the other.
        const chart = await mount({
          panels: twoPanels,
          marks: [
            neighbor({ series: "kind", panel: "a" }),
            markOf(cell.row, { ...toggle, panel: "b" }),
          ],
          guides: legends,
        } as never);
        expect(legendButtons(chart).map((b) => b.textContent)).toEqual(["k", "m"]);
        return;
      }
      if (cell.state !== "works") throw new Error(`legend.panel-toggle is never ${cell.state}`);
      const chart = await mount({
        panels: twoPanels,
        marks: [
          markOf(cell.row, { ...toggle, panel: "a" }),
          markOf(cell.row, { ...toggle, panel: "b" }),
        ],
        guides: legends,
      } as never);
      const before = { drawn: byPanel(chart), paints: paintsByPanel(chart) };
      // Each panel's legend lists the mark's entries; the first button is panel a's first.
      const [first, ...others] = entriesOf(chart, "a");
      expect(entriesOf(chart, "b").map(({ label }) => label)).toEqual(
        [first!, ...others].map(({ label }) => label),
      );
      const buttons = legendButtons(chart);
      expect(buttons[0]!.textContent).toBe(first!.label);
      click(chart, buttons[0]!);
      expect(chart.getHiddenKeys({ panel: "a" })).toEqual([first!.key]);
      expect(chart.getHiddenKeys({ panel: "b" })).toEqual([]);
      expectLess(cell.row, byPanel(chart).a, before.drawn.a!);
      expect(byPanel(chart).b).toBe(before.drawn.b);
      // In panel a, what it names is drawn no more; what a's other entries name still is.
      const after = paintsByPanel(chart);
      if (others.every(({ color }) => color !== first!.color))
        expect(after.a).not.toContain(first!.color);
      for (const { color } of others) expect(after.a).toContain(color);
      expect(after.b).toEqual(before.paints.b);
      click(chart, buttons[0]!);
      expect(paintsByPanel(chart)).toEqual(before.paints);
      expect(byPanel(chart)).toEqual(before.drawn);
    });
});

describe("legend.entry", () => {
  const entry = { key: "mine", label: "Mine", targets: [{ mark: "m" }] };
  for (const cell of cellsOf("legend.entry"))
    contractTest(`${cell.row}.legend.entry`, async () => {
      if (cell.state !== "works") throw new Error(`legend.entry is never ${cell.state}`);
      // Beside a line in another panel, an entry of the chart's own hides the mark whole.
      const chart = await mount({
        panels: twoPanels,
        marks: [neighbor({ panel: "a" }), markOf(cell.row, { id: "m", panel: "b" })],
        legend: { entries: [entry] },
      } as never);
      const before = byPanel(chart);
      const mine = legendButtons(chart).find((button) => button.textContent === "Mine");
      expect(mine, "the legend lists the entry").toBeDefined();
      click(chart, mine!);
      expect(byPanel(chart)).toEqual({ ...before, b: 0 });
      click(chart, mine!);
      expect(byPanel(chart)).toEqual(before);
    });
});
