// Input over time in subplots: what arrives before the interaction
// controller loads plays in the panel it was made over, steps faster than
// frames add up as if drawn between them, and a listener changing a view
// as it hears of one makes the next change, heard after the first by all.
import "../interactive.ts";
import { afterEach, describe, expect, it } from "vitest";
import { table } from "../../../src/data/table.ts";
import { type ChartOptions, forgetInteraction } from "../../../src/dom/chart.ts";
import type { ViewportEvent } from "../../../src/dom/events.ts";
import { columns, panel } from "../../../src/layout.ts";
import { graph } from "../../../src/marks/graph.ts";
import { line } from "../../../src/marks/line.ts";
import { pie } from "../../../src/marks/pie.ts";
import { panels } from "../../../src/model/panels.ts";
import type { PanelSpec } from "../../../src/spec/spec.ts";
import { contractTest } from "../../helpers/contracts.ts";
import {
  drag,
  expectFrom,
  heard,
  mount,
  mountNow,
  pointer,
  rows,
  viewsOf,
  wheel,
  within,
} from "./helpers.ts";

afterEach(() => forgetInteraction());

const data = rows();

/** Subplots a and b, each with its own x, and settings of b's own. */
const subplots = (extra: Partial<ChartOptions> = {}, own?: PanelSpec["interaction"]) => ({
  marks: [line(data, { x: "t", y: "v", panel: "a" }), line(data, { x: "t", y: "w", panel: "b" })],
  panels: panels(
    [{ id: "a" }, { id: "b", ...(own && { interaction: own }) }],
    columns([1, 1], [panel("a"), panel("b")]),
  ),
  x: { scope: "panel" as const },
  ...extra,
});

describe("input before the controller loads", () => {
  contractTest(
    "interaction.early-input.subplots.engine",
    async () => {
      const module = await import("../../../src/dom/interaction.ts");
      let attach = (_: typeof module) => {};
      forgetInteraction(() => new Promise((resolve) => (attach = resolve)));
      // Only b zooms, by settings of its own.
      const chart = mountNow(subplots({}, { zoom: "xy" }));
      expect(chart.loading).toBeInstanceOf(Promise);
      const events = heard(chart, "viewport");
      const [bx, by] = within(chart, "b", 0.4, 0.4);
      const under = () => [
        chart.fromPixel(bx, { panel: "b", axis: "x" })!,
        chart.fromPixel(by, { panel: "b", axis: "y" })!,
      ];
      const before = under();
      // Taken at once over b, whose settings zoom; left to the page over a.
      expect(wheel(chart, bx, by).defaultPrevented).toBe(true);
      expect(wheel(chart, ...within(chart, "a")).defaultPrevented).toBe(false);
      expect(viewsOf(chart).get("b")).toEqual({ x: null, y: null, yRight: null });
      expect(events).toEqual([]);
      attach(module);
      for (let loading = chart.loading; loading; loading = chart.loading) await loading;
      chart.render();
      // Played in b, about the pixel it was made at; a stays.
      const view = chart.getViewport({ panel: "b" });
      expect(view.x).not.toBeNull();
      expect(view.y).not.toBeNull();
      expect(chart.getViewport({ panel: "a" })).toEqual({ x: null, y: null, yRight: null });
      const [x, y] = under();
      expect(x).toBeCloseTo(before[0]!, 6);
      expect(y).toBeCloseTo(before[1]!, 6);
      expect(events).toHaveLength(1);
      expectFrom(chart, events, "b", "wheel");
    },
    "a wheel step over a subplot before the controller loads plays in that subplot once it does",
  );
});

describe("input faster than frames", () => {
  contractTest(
    "interaction.rapid-gestures.subplots.engine",
    async () => {
      const options = subplots({ interaction: { zoom: "x" } });
      const fast = await mount(options);
      const drawn = await mount(options);
      // Wheel steps in b and a in turn, and a pan in b, at the same pixels:
      // without frames between them in one chart, each drawn in the other.
      const steps = (chart: typeof fast, draw: boolean) => {
        const [bx, by] = within(chart, "b", 0.3, 0.5);
        const [ax, ay] = within(chart, "a", 0.7, 0.5);
        const inputs = [
          () => wheel(chart, bx, by),
          () => wheel(chart, bx, by),
          () => wheel(chart, ax, ay),
          () =>
            drag(chart, [
              [bx, by],
              [bx - 15, by],
              [bx - 30, by],
            ]),
          () => wheel(chart, ax, ay),
          () => wheel(chart, bx, by),
        ];
        for (const input of inputs) {
          input();
          if (draw) chart.render();
        }
      };
      const events = heard(fast, "viewport");
      steps(fast, false);
      steps(drawn, true);
      // The views add up as they do drawn step by step, each in its panel.
      for (const key of ["a", "b"]) {
        const [x0, x1] = fast.getViewport({ panel: key }).x!;
        const [d0, d1] = drawn.getViewport({ panel: key }).x!;
        expect(x0).toBeCloseTo(d0, 9);
        expect(x1).toBeCloseTo(d1, 9);
      }
      const madeIn = events.map(({ panel }) => panel);
      expect(madeIn.filter((key, i) => key !== madeIn[i - 1])).toEqual(["b", "a", "b", "a", "b"]);
      for (const event of events) {
        expect(event.scales.map(({ scale }) => scale)).toEqual(["x"]);
        expect(event.views.map(({ panel }) => panel)).toEqual([event.panel]);
      }
      // One revision a change, in order.
      const revisions = events.map(({ viewRevision }) => viewRevision);
      expect(revisions).toEqual(revisions.map((_, i) => revisions[0]! + i));
    },
    "wheel steps and pans in subplots faster than frames add up, each in its subplot, in order",
  );
});

describe("settings changing during a gesture", () => {
  it("end a pan once its subplot's settings no longer pan", async () => {
    const chart = await mount(subplots({ interaction: { pan: "x" } }));
    const [x, y] = within(chart, "b");
    pointer(chart, "pointerdown", x, y);
    pointer(chart, "pointermove", x - 20, y);
    const panned = chart.getViewport({ panel: "b" }).x;
    expect(panned).not.toBeNull();
    // b no longer pans; a, by the chart's settings, still does.
    chart.update(subplots({ interaction: { pan: "x" } }, { pan: false }));
    chart.render();
    pointer(chart, "pointermove", x - 60, y);
    pointer(chart, "pointerup", x - 60, y);
    expect(chart.getViewport({ panel: "b" }).x).toEqual(panned);
  });

  it("go on panning as options with the same settings come", async () => {
    const chart = await mount(subplots({ interaction: { pan: "x" } }));
    const [x, y] = within(chart, "b");
    pointer(chart, "pointerdown", x, y);
    pointer(chart, "pointermove", x - 20, y);
    const panned = chart.getViewport({ panel: "b" }).x!;
    chart.update(subplots({ interaction: { pan: "x" } }));
    chart.render();
    pointer(chart, "pointermove", x - 60, y);
    pointer(chart, "pointerup", x - 60, y);
    expect(chart.getViewport({ panel: "b" }).x![0]).toBeGreaterThan(panned[0]);
  });
});

describe("listeners changing views", () => {
  contractTest(
    "interaction.viewport-event.subplots.reentrant.engine",
    async () => {
      const chart = await mount(subplots({ interaction: { zoom: "x" } }));
      const heardBy: string[] = [];
      const seen = (who: string, { panel, viewRevision, cause }: ViewportEvent) =>
        `${who} ${panel} ${viewRevision} ${cause}`;
      const events = heard(chart, "viewport");
      let inside: readonly [number, number] | null = null;
      chart.on("viewport", (event) => {
        heardBy.push(seen("first", event));
        // Hearing of b's change, a listener changes a's.
        if (event.panel === "b") {
          chart.setViewport({ x: [1, 3] }, { panel: "a" });
          inside = chart.getViewport({ panel: "a" }).x;
        }
      });
      chart.on("viewport", (event) => heardBy.push(seen("second", event)));
      wheel(chart, ...within(chart, "b"));
      const [b, a] = events;
      expect(events).toHaveLength(2);
      // The change is made at once; it is heard once every listener heard
      // the first, by each in turn.
      expect(inside).toEqual([1, 3]);
      expect(heardBy).toEqual([
        `first b ${b!.viewRevision} wheel`,
        `second b ${b!.viewRevision} wheel`,
        `first a ${b!.viewRevision + 1} api`,
        `second a ${b!.viewRevision + 1} api`,
      ]);
      // Each event says what its own change did.
      expect(b!.views.map(({ panel, x }) => [panel, x])).toEqual([
        ["b", chart.getViewport({ panel: "b" }).x],
      ]);
      expect(a!.scales.map(({ scale, view }) => [scale, view])).toEqual([["x", [1, 3]]]);
      expect(a!.views.map(({ panel }) => panel)).toEqual(["a"]);
    },
    "a listener changing another subplot's view as it hears of a change makes the next change, heard after the first",
  );
});

describe("instances that go", () => {
  const brief = ({ cause, scales }: ViewportEvent) => ({
    cause,
    scales: scales.map(({ scale, instance, type, panels, view }) => ({
      scale,
      instance,
      type,
      panels,
      view,
    })),
  });

  it("fit a view whose instance changes type, as the options changed it", async () => {
    const chart = await mount({ marks: [line(data, { x: "t", y: "v" })] });
    chart.setViewport({ x: [2, 4], y: [12, 20] });
    const events = heard(chart, "viewport");
    chart.update({ marks: [line(data, { x: "region", y: "v" })], y: { type: "log" } });
    chart.render();
    expect(events.map(brief)).toEqual([
      {
        cause: "options",
        scales: [
          { scale: "x", instance: "", type: "linear", panels: [""], view: null },
          { scale: "y", instance: "", type: "linear", panels: [""], view: null },
        ],
      },
    ]);
    expect(chart.getViewport()).toEqual({ x: null, y: null, yRight: null });
  });

  it("fit the plane of a subplot that goes, in the panels it had", async () => {
    const links = table({ from: ["a", "b"], to: ["b", "c"] });
    const options = (withGraph: boolean): ChartOptions => ({
      marks: [
        ...(withGraph ? [graph(links, { source: "from", target: "to", panel: "g" })] : []),
        line(data, { x: "t", y: "v", panel: "a" }),
      ],
      panels: panels(withGraph ? [{ id: "g" }, { id: "a" }] : [{ id: "a" }]),
    });
    const chart = await mount(options(true));
    chart.setViewport({ x: [0, 0.5], y: [0, 0.5] }, { panel: "g" });
    const events = heard(chart, "viewport");
    chart.update(options(false));
    chart.render();
    expect(events.map(brief)).toEqual([
      {
        cause: "options",
        scales: [
          { scale: "x", instance: "g", type: "linear", panels: ["g"], view: null },
          { scale: "y", instance: "g", type: "linear", panels: ["g"], view: null },
        ],
      },
    ]);
  });

  it("fit views when another family of chart takes the chart's place, so they do not come back", async () => {
    const links = table({ from: ["a", "b"], to: ["b", "c"] });
    const shares = table({ k: ["a", "b"], v: [1, 2] });
    const chart = await mount({ marks: [line(data, { x: "t", y: "v" })] });
    chart.setViewport({ x: [2, 4] });
    const events = heard(chart, "viewport");
    chart.update({ marks: [pie(shares, { category: "k", value: "v" })] });
    chart.render();
    expect(events.map(brief).flatMap(({ scales }) => scales.map(({ scale }) => scale))).toEqual([
      "x",
    ]);
    chart.update({ marks: [line(data, { x: "t", y: "v" })] });
    chart.render();
    expect(chart.getViewport().x).toBeNull();
    // A network's plane goes too, though a pie keeps the state it had.
    chart.update({ marks: [graph(links, { source: "from", target: "to" })] });
    chart.render();
    chart.setViewport({ x: [0, 0.5], y: [0, 0.5] });
    chart.update({ marks: [pie(shares, { category: "k", value: "v" })] });
    chart.render();
    chart.update({ marks: [graph(links, { source: "from", target: "to" })] });
    chart.render();
    expect(chart.getViewport()).toEqual({ x: null, y: null, yRight: null });
  });

  it("report a view the options retired with their cause, though a call changed a view since", async () => {
    const chart = await mount({ marks: [line(data, { x: "t", y: "v" })] });
    chart.setViewport({ y: [12, 20] });
    const events = heard(chart, "viewport");
    chart.update({ marks: [line(data, { x: "t", y: "v", axis: "right" })] });
    chart.setViewport({ x: [2, 4] });
    chart.render();
    expect(events.map(({ cause, scales }) => [cause, scales.map(({ scale }) => scale)])).toEqual([
      ["api", ["x"]],
      ["options", ["y"]],
    ]);
  });
});
