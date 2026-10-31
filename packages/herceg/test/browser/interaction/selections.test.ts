// Row selections and legend toggles in panels: a brush writes the rows its
// panel draws inside it, read on the scales they are drawn with (a right
// axis too), and a legend hides series where it says: a panel's legend in
// its panel, the chart's in every panel.
import "../interactive.ts";
import { describe, expect, it } from "vitest";
import { compileExpression } from "../../../src/data/expression.ts";
import { type SelectionStore, selectionStore } from "../../../src/data/selection.ts";
import { type Table, table } from "../../../src/data/table.ts";
import type { Chart } from "../../../src/dom/chart.ts";
import { legend } from "../../../src/guides/options.ts";
import { estimateText } from "../../../src/layout/text.ts";
import { columns, panel } from "../../../src/layout.ts";
import { line } from "../../../src/marks/line.ts";
import { facet } from "../../../src/model/facet.ts";
import { panels } from "../../../src/model/panels.ts";
import { rowSelection } from "../../../src/model/row-selection.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { modelOf } from "../helpers.ts";
import { drag, heard, mount, placements, rows, within } from "./helpers.ts";

/** The rows of `source` a store's channel holds. */
function selectedRows(store: SelectionStore, channel: string, source: { length: number }) {
  const held = store.get(channel);
  if (!held) return [];
  if (held.kind === "rows") return [...held.rows.positions()];
  const { at } = compileExpression(held.expression, source as never);
  return Array.from({ length: source.length }, (_, row) => row).filter((row) => at(row) === true);
}

/** Brushes a rectangle across panel `key`'s plot; its pixel corners. */
function brush(chart: Chart, key: string) {
  const [x0, y0] = within(chart, key, 0.2, 0.25);
  const [x1, y1] = within(chart, key, 0.75, 0.8);
  drag(chart, [
    [x0, y0],
    [(x0 + x1) / 2, (y0 + y1) / 2],
    [x1, y1],
  ]);
  return { x0, y0, x1, y1 };
}

describe("row selections in each placement", () => {
  for (const placement of placements().filter(({ name }) => name !== "chart"))
    contractTest(
      `interaction.row-selection.${placement.name}.engine`,
      async () => {
        const data = rows();
        const store = selectionStore(data as unknown as Table);
        const options = placements(data).find(({ name }) => name === placement.name)!;
        const chart = await mount(
          options.options(
            { brush: "xy" },
            { rowSelection: rowSelection({ store, channel: "focus" }) },
          ),
        );
        const box = brush(chart, options.target);
        chart.render();
        // The rows the target panel draws inside the rectangle, on its scales.
        const field = placement.name === "facets" ? "v" : "w";
        const expected = Array.from({ length: data.length }, (_, row) => row).filter((row) => {
          if (placement.name === "facets" && data.value("region", row) !== "us") return false;
          const px = chart.toPixel(data.value("t", row) as number, {
            panel: options.target,
            axis: "x",
          })!;
          const py = chart.toPixel(data.value(field, row) as number, {
            panel: options.target,
            axis: "y",
          })!;
          return px >= box.x0 && px <= box.x1 && py >= box.y0 && py <= box.y1;
        });
        expect(expected.length).toBeGreaterThan(0);
        expect(selectedRows(store, "focus", data)).toEqual(expected);
        expect(chart.selectionOwner?.panels).toEqual([options.target]);
      },
      `a brush in ${placement.name} selects the rows its panel draws inside it`,
    );

  contractTest(
    "interaction.row-selection.subplots.right-y.engine",
    async () => {
      const left = rows();
      const right = table({
        t: Float64Array.from({ length: 10 }, (_, i) => i),
        w: Float64Array.from({ length: 10 }, (_, i) => 1000 + ((i * 7) % 10) * 100),
      });
      const store = selectionStore(right as unknown as Table);
      const chart = await mount({
        marks: [
          line(left, { x: "t", y: "v", panel: "a" }),
          line(left, { x: "t", y: "v", panel: "b" }),
          line(right, { x: "t", y: "w", panel: "b", axis: "right" }),
        ],
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        interaction: { brush: "y" },
        rowSelection: rowSelection({ store, channel: "focus" }),
      });
      const [x, y0] = within(chart, "b", 0.5, 0.2);
      const [, y1] = within(chart, "b", 0.5, 0.6);
      drag(chart, [
        [x, y0],
        [x, (y0 + y1) / 2],
        [x, y1],
      ]);
      chart.render();
      // Rows on the right axis, read through the pixels the brush covers.
      const expected = Array.from({ length: right.length }, (_, row) => row).filter((row) => {
        const py = chart.toPixel(right.value("w", row) as number, { panel: "b", axis: "yRight" })!;
        return py >= y0 && py <= y1;
      });
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.length).toBeLessThan(right.length);
      expect(selectedRows(store, "focus", right)).toEqual(expected);
    },
    "a y brush in a subplot selects the rows of its right axis' marks through the same pixels",
  );
});

/** The lines each panel draws, by panel key. */
function linesByPanel(chart: Chart): Record<string, number> {
  const scene = modelOf(chart).scene(estimateText);
  return Object.fromEntries(
    scene.panels.map((drawn) => [
      drawn.key,
      drawn.marks.filter(({ kind }) => kind === "line").length,
    ]),
  );
}

const ODD = '{"field":"kind","value":"odd"}';

describe("legend toggles in panels", () => {
  contractTest(
    "interaction.legend-toggle.subplots.engine",
    async () => {
      const data = rows();
      const chart = await mount({
        marks: [
          line(data, { x: "t", y: "v", series: "kind", panel: "a" }),
          line(data, { x: "t", y: "w", series: "kind", panel: "b" }),
        ],
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        guides: [legend({}), legend({ panel: "b" })],
      });
      const changes = heard(chart, "visibility");
      const buttons = () => [...chart.root.querySelectorAll("button")];
      expect(buttons().map((b) => b.textContent)).toEqual(["even", "odd", "even", "odd"]);
      // b's own legend hides the series there alone.
      buttons()[3]!.click();
      chart.render();
      expect(chart.getHiddenKeys({ panel: "b" })).toEqual([ODD]);
      expect(chart.getHiddenKeys({ panel: "a" })).toEqual([]);
      expect(linesByPanel(chart)).toEqual({ a: 2, b: 1 });
      // The chart's entry, mixed, shows it everywhere; again, hides it everywhere.
      expect(buttons()[1]!.getAttribute("aria-pressed")).toBe("mixed");
      buttons()[1]!.click();
      chart.render();
      expect(chart.getHiddenKeys({ panel: "b" })).toEqual([]);
      buttons()[1]!.click();
      chart.render();
      expect(chart.getHiddenKeys()).toEqual([ODD]);
      expect(linesByPanel(chart)).toEqual({ a: 1, b: 1 });
      expect(changes).toHaveLength(3);
    },
    "a subplot's legend toggles series there; the chart's, in every panel",
  );

  contractTest(
    "interaction.legend-toggle.facets.engine",
    async () => {
      const data = rows();
      const chart = await mount({
        marks: [line(data, { x: "t", y: "v", series: "kind" })],
        facet: facet("region"),
      });
      expect(linesByPanel(chart)).toEqual({ eu: 2, us: 2 });
      const odd = [...chart.root.querySelectorAll("button")].find((b) => b.textContent === "odd")!;
      odd.click();
      chart.render();
      expect(chart.getHiddenKeys()).toEqual([ODD]);
      expect(linesByPanel(chart)).toEqual({ eu: 1, us: 1 });
      expect(odd.getAttribute("aria-pressed")).toBe("false");
    },
    "a facet chart's legend toggles a series in every facet panel",
  );
});

describe("selections along a right axis alone", () => {
  const data = rows();
  /** Subplots a, of the left y alone, and b, of the right y alone, sharing their y scales. */
  const sides = () => ({
    marks: [
      line(data, { x: "t", y: "v", panel: "a" }),
      line(data, { x: "t", y: "w", panel: "b", axis: "right" as const }),
    ],
    panels: panels(columns([1, 1], [panel("a"), panel("b")])),
  });

  it("belong to the panels drawing the right y, in its values", async () => {
    const chart = await mount(sides());
    chart.select({ x: null, y: [110, 150], lasso: null }, { panel: "b" });
    const owner = chart.selectionOwner!;
    expect(owner.scales.map(({ scale }) => scale)).toEqual(["yRight"]);
    expect(owner.panels).toEqual(["b"]);
    expect(chart.selection!.y).toEqual([110, 150]);
  });

  it("refuse a y range without a panel where panels have left y scales of their own", async () => {
    const chart = await mount({
      ...sides(),
      marks: [...sides().marks, line(data, { x: "t", y: "v", panel: "b" })],
      y: { scope: "panel" },
    });
    expect(() => chart.select({ x: null, y: [12, 20], lasso: null })).toThrow(
      expect.objectContaining({ code: "invalid-option", path: "y" }),
    );
  });
});
