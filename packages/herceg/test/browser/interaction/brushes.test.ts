// Brushes and lassos in every placement: a selection of the instances of
// the panel it is drawn in, along its axes, which belongs to the panels
// drawing all of them, leaving every view as it was.
import "../interactive.ts";
import { describe, expect } from "vitest";
import type { Chart } from "../../../src/dom/chart.ts";
import type { Axis } from "../../../src/dom/handle.ts";
import { columns, panel } from "../../../src/layout.ts";
import { bar } from "../../../src/marks/bar.ts";
import { line } from "../../../src/marks/line.ts";
import { panels } from "../../../src/model/panels.ts";
import type { BrushSpec } from "../../../src/spec/spec.ts";
import { contractTest } from "../../helpers/contracts.ts";
import {
  drag,
  heard,
  instancesOf,
  mount,
  panelsSharing,
  placements,
  rows,
  viewsOf,
  within,
} from "./helpers.ts";

/** Corners of a rectangle within panel `key`'s plot, as fractions of its size. */
function corners(chart: Chart, key: string, from = 0.3, to = 0.7) {
  return [within(chart, key, from, from), within(chart, key, to, to)] as const;
}

/** A brush across panel `key`'s plot, or a lasso around a square of it. */
function gesture(chart: Chart, key: string, shape: BrushSpec) {
  const [[x0, y0], [x1, y1]] = corners(chart, key);
  if (shape === "lasso")
    drag(chart, [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
      [x0, y0 + 1],
    ]);
  else
    drag(chart, [
      [x0, y0],
      [(x0 + x1) / 2, (y0 + y1) / 2],
      [x1, y1],
    ]);
}

/** The values along `axis` of panel `key` between two pixels, ascending. */
function valuesBetween(chart: Chart, key: string, axis: Axis, a: number, b: number) {
  const ends = [a, b].map((pixel) => chart.fromPixel(pixel, { panel: key, axis })!);
  return [Math.min(...ends), Math.max(...ends)];
}

/**
 * That the chart's selection is the brush `shape` drew in panel `key`, and
 * belongs to that panel's instances along its axes and the panels drawing
 * them all.
 */
function expectOwned(chart: Chart, key: string, shape: BrushSpec) {
  const selection = chart.selection!;
  expect(selection).not.toBeNull();
  const [[x0, y0], [x1, y1]] = corners(chart, key);
  const owned: Axis[] = shape === "lasso" || shape === "xy" ? ["x", "y"] : [shape];
  if (shape === "lasso") expect(selection.lasso!.length).toBeGreaterThanOrEqual(4);
  else {
    for (const [axis, a, b] of [
      ["x", x0, x1],
      ["y", y0, y1],
    ] as const) {
      const range = selection[axis];
      if (!owned.includes(axis)) {
        expect(range).toBeNull();
        continue;
      }
      const [lo, hi] = valuesBetween(chart, key, axis, a, b);
      expect(range![0]).toBeCloseTo(lo!, 3);
      expect(range![1]).toBeCloseTo(hi!, 3);
    }
  }
  const own = instancesOf(chart, key);
  const owner = chart.selectionOwner!;
  expect(owner.scales.map(({ scale, instance }) => [scale, instance])).toEqual(
    owned.map((axis) => [axis, own[axis]]),
  );
  expect(owner.panels).toEqual(panelsSharing(chart, key, owned));
}

describe("brushes in each placement", () => {
  for (const shape of ["x", "y", "xy", "lasso"] as const)
    for (const placement of placements())
      contractTest(
        `interaction.${shape === "lasso" ? "lasso" : `brush-${shape}`}.${placement.name}.engine`,
        async () => {
          const chart = await mount(placement.options({ brush: shape }));
          const views = viewsOf(chart);
          const selects = heard(chart, "select");
          gesture(chart, placement.target, shape);
          chart.render();
          expectOwned(chart, placement.target, shape);
          expect(selects.at(-1)?.owner).toEqual(chart.selectionOwner);
          // A brush that does not zoom leaves every view.
          expect(viewsOf(chart)).toEqual(views);
        },
        `${shape === "lasso" ? "a lasso" : `an ${shape} brush`} in ${placement.name} selects on its panel's scales, for the panels sharing them`,
      );
});

describe("brush variants", () => {
  contractTest(
    "interaction.brush-xy.subplots.owner.engine",
    async () => {
      const [, subplots] = placements();
      const chart = await mount(subplots!.options({ brush: "xy" }));
      const selects = heard(chart, "select");
      gesture(chart, "b", "xy");
      chart.render();
      // The x the subplots share, and b's own y: b alone draws both.
      expect(chart.selectionOwner!.panels).toEqual(["b"]);
      expect(chart.selectionOwner!.scales.map(({ panels }) => panels)).toEqual([["a", "b"], ["b"]]);
      gesture(chart, "a", "xy");
      chart.render();
      expectOwned(chart, "a", "xy");
      // Cleared, the event names what it belonged to.
      chart.select(null);
      expect(selects.map(({ owner }) => owner.panels)).toEqual([["b"], ["a"], ["a"]]);
      expect(selects.at(-1)!.x).toBeNull();
      expect(chart.selectionOwner).toBeNull();
    },
    "a rectangle belongs to the panels drawing both its scales, and moves with the next brush",
  );

  contractTest(
    "interaction.brush-y.subplots.right-y.engine",
    async () => {
      const data = rows();
      const chart = await mount({
        marks: [
          line(data, { x: "t", y: "v", panel: "a" }),
          line(data, { x: "t", y: "v", panel: "b" }),
          line(data, { x: "t", y: "w", panel: "b", axis: "right" }),
        ],
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        interaction: { brush: "y" },
      });
      gesture(chart, "b", "y");
      chart.render();
      // Of the left y, in its values, though the panel has a right axis too.
      expectOwned(chart, "b", "y");
      const [[, y0], [, y1]] = corners(chart, "b");
      const right = valuesBetween(chart, "b", "yRight", y0, y1);
      expect(chart.selection!.y![0]).not.toBeCloseTo(right[0]!, 1);
    },
    "a y brush in a subplot with a right axis selects along its left y",
  );

  contractTest(
    "interaction.brush-y.subplots.right-only.engine",
    async () => {
      const data = rows();
      const chart = await mount({
        marks: [
          line(data, { x: "t", y: "v", panel: "a" }),
          line(data, { x: "t", y: "w", panel: "b", axis: "right" }),
        ],
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        interaction: { brush: "y" },
      });
      // A panel drawing nothing on the left has no left y.
      expect(chart.getPanels()[1]!.y).toBeUndefined();
      gesture(chart, "b", "y");
      chart.render();
      // Of the right y, in its values, and kept as the chart draws again.
      const [[, y0], [, y1]] = corners(chart, "b");
      const right = valuesBetween(chart, "b", "yRight", y0, y1);
      const { scales, panels: owners } = chart.selectionOwner!;
      expect(scales.map(({ scale, instance }) => [scale, instance])).toEqual([
        ["yRight", instancesOf(chart, "b").yRight],
      ]);
      expect(owners).toContain("b");
      expect(chart.selection!.y![0]).toBeCloseTo(right[0]!, 6);
      expect(chart.selection!.y![1]).toBeCloseTo(right[1]!, 6);
      chart.render();
      expect(chart.selection).not.toBeNull();
    },
    "a y brush in a subplot of the right axis alone selects along its right y",
  );

  contractTest(
    "interaction.lasso.subplots.category.engine",
    async () => {
      const data = rows();
      const chart = await mount({
        marks: [
          line(data, { x: "t", y: "v", panel: "a" }),
          bar(data, { x: "kind", y: "w", panel: "b" }),
        ],
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        interaction: { brush: "lasso" },
      });
      gesture(chart, "b", "lasso");
      chart.render();
      expectOwned(chart, "b", "lasso");
      expect(chart.selectionOwner!.scales[0]!.type).toBe("band");
      // Around band positions of b's categories, not a's numbers.
      for (const [x] of chart.selection!.lasso!) {
        expect(x).toBeGreaterThan(-0.5);
        expect(x).toBeLessThan(1.5);
      }
    },
    "a lasso over a subplot's category axis outlines its band positions, of that panel",
  );
});
