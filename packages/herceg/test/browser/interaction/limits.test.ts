// View limits and edge events in panels: limits bound each instance's
// views (a subplot's own over the chart's), panels sharing an instance
// agree on them, and an edge event names the instance that came near.
import "../interactive.ts";
import { describe, expect } from "vitest";
import type { Chart, ChartOptions } from "../../../src/dom/chart.ts";
import { columns, panel } from "../../../src/layout.ts";
import { line } from "../../../src/marks/line.ts";
import { facet } from "../../../src/model/facet.ts";
import { panels } from "../../../src/model/panels.ts";
import type { InteractionSpec, PanelSpec } from "../../../src/spec/spec.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { drag, frame, heard, instancesOf, mount, mountNow, rows, within } from "./helpers.ts";

const data = rows();

/** Subplots a and b, each with its x scale (unless `x` says), and settings of the chart's and b's own. */
function subplots(
  interaction: InteractionSpec,
  own: PanelSpec["interaction"] = undefined,
  extra: Partial<ChartOptions> = {},
): ChartOptions {
  return {
    marks: [line(data, { x: "t", y: "v", panel: "a" }), line(data, { x: "t", y: "w", panel: "b" })],
    panels: panels(
      [{ id: "a" }, { id: "b", ...(own && { interaction: own }) }],
      columns([1, 1], [panel("a"), panel("b")]),
    ),
    x: { scope: "panel" },
    interaction,
    ...extra,
  };
}

/** Pans panel `key` along x by `by` of its values, dragging (positive shows higher values). */
function panX(chart: Chart, key: string, by: number) {
  chart.render();
  const [x, y] = within(chart, key);
  const at = chart.fromPixel(x, { panel: key, axis: "x" })!;
  const to = chart.toPixel(at - by, { panel: key, axis: "x" })!;
  drag(chart, [
    [x, y],
    [(x + to) / 2, y],
    [to, y],
  ]);
}

/** Pans panel `key` along y by `by` of its values (positive shows higher values). */
function panY(chart: Chart, key: string, by: number) {
  chart.render();
  const [x, y] = within(chart, key);
  const at = chart.fromPixel(y, { panel: key, axis: "y" })!;
  const to = chart.toPixel(at - by, { panel: key, axis: "y" })!;
  drag(chart, [
    [x, y],
    [x, (y + to) / 2],
    [x, to],
  ]);
}

describe("limits in panels", () => {
  contractTest(
    "interaction.limits.subplots.engine",
    async () => {
      const chart = await mount(subplots({ pan: "x", limits: { x: { extent: [0, 9] } } }));
      chart.setViewport({ x: [2, 4] }, { panel: "b" });
      panX(chart, "b", 20);
      // Moved inside the chart's extent, keeping its span; a stays.
      expect(chart.getViewport({ panel: "b" }).x).toEqual([7, 9]);
      expect(chart.getViewport({ panel: "a" }).x).toBeNull();
      // Each subplot's instance keeps to it.
      chart.setViewport({ x: [-5, -3] }, { panel: "a" });
      expect(chart.getViewport({ panel: "a" }).x).toEqual([0, 2]);
    },
    "the chart's limits bound each subplot's own x, a pan past them stopping at the end",
  );

  contractTest(
    "interaction.limits.facets.engine",
    async () => {
      const chart = await mount({
        marks: [line(data, { x: "t", y: "v" })],
        facet: facet("region"),
        interaction: { pan: "x", limits: { x: { extent: [0, 9] } } },
      });
      chart.setViewport({ x: [2, 4] });
      panX(chart, "us", 20);
      expect(chart.getViewport({ panel: "us" }).x).toEqual([7, 9]);
      expect(chart.getViewport({ panel: "eu" }).x).toEqual([7, 9]);
    },
    "the chart's limits bound the x facet panels share, a pan in one stopping at the end",
  );

  contractTest(
    "interaction.limits.subplots.panel.engine",
    async () => {
      const chart = await mount(subplots({ pan: "x" }, { limits: { x: { extent: [2, 7] } } }));
      chart.setViewport({ x: [3, 5] }, { panel: "b" });
      panX(chart, "b", 20);
      // b's own limits bound its x; a, without, goes where it is asked.
      expect(chart.getViewport({ panel: "b" }).x).toEqual([5, 7]);
      chart.setViewport({ x: [-5, -3] }, { panel: "a" });
      expect(chart.getViewport({ panel: "a" }).x).toEqual([-5, -3]);
    },
    "a subplot's own limits bound its scales alone",
  );

  contractTest(
    "interaction.limits.subplots.log.engine",
    async () => {
      const chart = await mount({
        marks: [
          line(data, { x: "t", y: "v", panel: "a" }),
          line(data, { x: "t", y: "w", panel: "b" }),
        ],
        panels: panels(
          [
            { id: "a" },
            { id: "b", y: { type: "log" }, interaction: { limits: { y: { extent: [10, 1000] } } } },
          ],
          columns([1, 1], [panel("a"), panel("b")]),
        ),
        y: { scope: "panel" },
      });
      // Moved inside by ratios, as b's own log axis has it: a tenth to ten
      // times, a hundredfold span, goes to the extent's bottom, kept whole.
      chart.setViewport({ y: [1, 100] }, { panel: "b" });
      expect(chart.getViewport({ panel: "b" }).y).toEqual([10, 1000]);
    },
    "limits bound a subplot's own log axis by ratios, though the chart's y is linear",
  );

  contractTest(
    "interaction.limits.subplots.conflict.engine",
    () => {
      expect(() =>
        mountNow(
          subplots(
            { pan: "x" },
            { limits: { x: { extent: [2, 7] } } },
            { x: { scope: "chart" }, errorMode: "throw" },
          ),
        ),
      ).toThrow(
        "panels[1].interaction.limits.x: shares an x scale with others but limits its views otherwise; give the panels sharing it the same limits",
      );
      // The same limits for every panel sharing it are no conflict.
      expect(() =>
        mountNow(
          subplots(
            { pan: "x", limits: { x: { extent: [2, 7] } } },
            { limits: { x: { extent: [2, 7] } } },
            { x: { scope: "chart" }, errorMode: "throw" },
          ),
        ),
      ).not.toThrow();
    },
    "subplots sharing a scale with different limits are refused, naming the panel",
  );
});

describe("edges in panels", () => {
  /** The edge events after the chart's first frames. */
  async function edges(chart: Chart) {
    await frame();
    await frame();
    const events = heard(chart, "edge");
    return events;
  }
  const near = { extent: [0, 9] as [number, number], edge: { threshold: 0.1, hysteresis: 0.05 } };

  contractTest(
    "interaction.edge.subplots.engine",
    async () => {
      const chart = await mount(subplots({ pan: "x", limits: { x: near } }));
      const events = await edges(chart);
      chart.setViewport({ x: [0.5, 2.5] }, { panel: "b" });
      await frame();
      panX(chart, "b", -0.4);
      await frame();
      expect(
        events.map(({ scale, instance, panels, side, cause }) => [
          scale,
          instance,
          panels,
          side,
          cause,
        ]),
      ).toEqual([["x", instancesOf(chart, "b").x, ["b"], "start", "pointer"]]);
    },
    "a subplot's x coming near its end reports that instance, of that panel",
  );

  contractTest(
    "interaction.edge.facets.engine",
    async () => {
      const chart = await mount({
        marks: [line(data, { x: "t", y: "v" })],
        facet: facet("region"),
        interaction: { pan: "x", limits: { x: near } },
      });
      const events = await edges(chart);
      chart.setViewport({ x: [6.5, 8.5] });
      await frame();
      panX(chart, "us", 0.4);
      await frame();
      expect(events.map(({ scale, panels, side, cause }) => [scale, panels, side, cause])).toEqual([
        ["x", ["eu", "us"], "end", "pointer"],
      ]);
    },
    "the x facet panels share reports its edge once, with every panel drawing it",
  );

  contractTest(
    "interaction.edge.subplots.shared-y.engine",
    async () => {
      const chart = await mount(
        subplots(
          { pan: "y", limits: { y: { extent: [0, 200], edge: { threshold: 0.1 } } } },
          undefined,
          { y: { scope: "chart" } },
        ),
      );
      // Away from both ends first.
      chart.setViewport({ y: [80, 120] });
      const events = await edges(chart);
      chart.setViewport({ y: [150, 195] });
      await frame();
      // Within a tenth of the span of the top, by a pan in b.
      panY(chart, "b", 2);
      await frame();
      expect(events.map(({ scale, panels, side }) => [scale, panels, side])).toEqual([
        ["y", ["a", "b"], "end"],
      ]);
      expect(events[0]!.cause).toBe("pointer");
    },
    "a y the subplots share reports its edge once, not once a panel",
  );
});
