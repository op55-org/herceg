// Sync channels scoped to a panel: a channel naming a panel carries that
// panel's instance of its scale, and only changes of that instance; what a
// synced chart sends lands on it alone. Same-realm sync is synchronous.
import { describe, expect, it } from "vitest";
import { table } from "../../../src/data/table.ts";
import type { Chart, ChartOptions } from "../../../src/dom/chart.ts";
import { columns, inset, panel } from "../../../src/layout.ts";
import { bar } from "../../../src/marks/bar.ts";
import { heatmap } from "../../../src/marks/heatmap.ts";
import { line } from "../../../src/marks/line.ts";
import { rule } from "../../../src/marks/rule.ts";
import { facet } from "../../../src/model/facet.ts";
import { panels } from "../../../src/model/panels.ts";
import type { InteractionSpec, SyncSpec } from "../../../src/spec/spec.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { drag, frame, heard, key, mount, pointer, rows, wheel, within } from "./helpers.ts";

const data = rows();
const single = (interaction: InteractionSpec): ChartOptions => ({
  marks: [line(data, { x: "t", y: "v" })],
  interaction,
});

/** Charts of several panels, each panel with its own x (an inset beside its parent's), synced through `sync`. */
const MULTI: Record<
  "subplots" | "facets" | "insets",
  { target: string; other: string; options: (interaction: InteractionSpec) => ChartOptions }
> = {
  subplots: {
    target: "b",
    other: "a",
    options: (interaction) => ({
      marks: [
        line(data, { x: "t", y: "v", panel: "a" }),
        line(data, { x: "t", y: "w", panel: "b" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
      x: { scope: "panel" },
      interaction,
    }),
  },
  facets: {
    target: "us",
    other: "eu",
    options: (interaction) => ({
      marks: [line(data, { x: "t", y: "v" })],
      facet: facet("region"),
      x: { scope: "panel" },
      interaction,
    }),
  },
  insets: {
    target: "detail",
    other: "main",
    options: (interaction) => ({
      marks: [
        line(data, { x: "t", y: "v", panel: "main" }),
        line(data, { x: "t", y: "w", panel: "detail" }),
      ],
      panels: panels(panel("main", [inset({ id: "detail" }, { width: { fraction: 0.45 } })])),
      interaction,
    }),
  },
};

/** Moves the pointer to x value `value` of panel `key`. */
async function hover(chart: Chart, key: string, value: number) {
  const x = chart.toPixel(value, { panel: key, axis: "x" })!;
  const [, y] = within(chart, key);
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: chart.root.getBoundingClientRect().left + x,
      clientY: chart.root.getBoundingClientRect().top + y,
    }),
  );
  await frame();
}

describe("cursors synced through a panel", () => {
  for (const placement of ["subplots", "facets"] as const)
    contractTest(
      `interaction.sync-cursor.${placement}.engine`,
      async () => {
        const { target, other, options } = MULTI[placement];
        const sync: SyncSpec = { cursor: { group: `cursor-${placement}`, panel: target } };
        const many = await mount(options({ sync }));
        const one = await mount(single({ sync: { cursor: `cursor-${placement}` } }));
        const received = heard(one, "hover");
        await hover(many, target, 4);
        expect(received.at(-1)?.inspection?.value).toBe(4);
        // The other panel's x is another instance: its cursor stays home.
        const count = received.length;
        await hover(many, other, 6);
        expect(received.slice(count).some(({ inspection }) => inspection?.value === 6)).toBe(false);
        // What the other chart sends, once the pointer left this one, shows in the channel's panel.
        many.root.dispatchEvent(new PointerEvent("pointerleave"));
        await frame();
        const shown = heard(many, "hover");
        await hover(one, "", 2);
        expect(shown.at(-1)?.inspection).toMatchObject({ panel: target, value: 2 });
      },
      `a cursor channel naming a ${placement === "subplots" ? "subplot" : "facet panel"} carries that panel's x`,
    );
});

describe("views synced through a panel", () => {
  for (const placement of ["subplots", "facets", "insets"] as const)
    contractTest(
      `interaction.sync-viewport.${placement}.engine`,
      async () => {
        const { target, other, options } = MULTI[placement];
        const group = `view-${placement}`;
        const many = await mount(
          options({ zoom: "x", sync: { viewport: { group, panel: target } } }),
        );
        const one = await mount(single({ zoom: "x", sync: { viewport: group } }));
        wheel(many, ...within(many, target));
        expect(one.getViewport().x).toEqual(many.getViewport({ panel: target }).x);
        expect(one.getViewport().x).not.toBeNull();
        // The other panel's zoom is its own.
        const shared = one.getViewport().x;
        wheel(many, ...within(many, other, 0.3, 0.8));
        expect(many.getViewport({ panel: other }).x).not.toBeNull();
        expect(one.getViewport().x).toEqual(shared);
        // What the other chart sends lands on the channel's panel alone.
        const before = many.getViewport({ panel: other }).x;
        one.setViewport([2, 5]);
        expect(many.getViewport({ panel: target }).x).toEqual([2, 5]);
        expect(many.getViewport({ panel: other }).x).toEqual(before);
      },
      `a viewport channel naming ${placement === "insets" ? "an inset" : `a panel of ${placement}`} shares that panel's x`,
    );

  contractTest(
    "interaction.sync-viewport.subplots.y.engine",
    async () => {
      const { options } = MULTI.subplots;
      const many = await mount(
        options({ zoom: "y", sync: { viewport: { group: "rows", scale: "y", panel: "b" } } }),
      );
      const one = await mount(
        single({ zoom: "y", sync: { viewport: { group: "rows", scale: "y" } } }),
      );
      wheel(many, ...within(many, "b"));
      expect(one.getViewport().y).toEqual(many.getViewport({ panel: "b" }).y);
      one.setViewport({ y: [110, 150] });
      expect(many.getViewport({ panel: "b" }).y).toEqual([110, 150]);
      expect(many.getViewport({ panel: "a" }).y).toBeNull();
    },
    "a viewport channel along y naming a subplot shares that subplot's y",
  );

  contractTest(
    "interaction.sync-viewport.chart.immediate.engine",
    async () => {
      const a = await mount(single({ zoom: "x", sync: { viewport: "now" } }));
      const b = await mount(single({ zoom: "x", sync: { viewport: "now" } }));
      const heardB = heard(b, "viewport");
      a.setViewport([2, 4]);
      // Before any frame: the other chart has the view, and has said so.
      expect(b.getViewport().x).toEqual([2, 4]);
      expect(heardB.map(({ cause, scales }) => [cause, scales[0]!.view])).toEqual([
        ["sync", [2, 4]],
      ]);
    },
    "a synced chart takes a view at once, in the same call",
  );

  contractTest(
    "interaction.sync-viewport.chart.reentrant.engine",
    async () => {
      const a = await mount(single({ zoom: "x", sync: { viewport: "again" } }));
      const b = await mount(single({ zoom: "x", sync: { viewport: "again" } }));
      const heardA = heard(a, "viewport");
      const order: string[] = [];
      b.on("viewport", ({ scales, viewRevision }) => {
        order.push(`b ${viewRevision} ${JSON.stringify(scales[0]!.view)}`);
        // A listener answering a synced change with one of its own.
        if (scales[0]!.view?.[0] === 2) b.setViewport([3, 6]);
      });
      a.setViewport([2, 4]);
      expect(a.getViewport().x).toEqual([3, 6]);
      expect(b.getViewport().x).toEqual([3, 6]);
      // Each change heard once, in order; the answer came back to a as a synced change.
      expect(order).toEqual(["b 1 [2,4]", "b 2 [3,6]"]);
      expect(heardA.map(({ cause, scales }) => [cause, scales[0]!.view])).toEqual([
        ["api", [2, 4]],
        ["sync", [3, 6]],
      ]);
    },
    "a listener changing a synced view as it hears of one makes the next change, which comes back once",
  );
});

describe("selections synced through a panel", () => {
  contractTest(
    "interaction.sync-selection.subplots.engine",
    async () => {
      const { options } = MULTI.subplots;
      const many = await mount(
        options({ brush: "x", sync: { selection: { group: "sel", panel: "b" } } }),
      );
      const one = await mount(single({ brush: "x", sync: { selection: "sel" } }));
      const brushIn = (key: string) => {
        const [x0, y] = within(many, key, 0.3, 0.5);
        const [x1] = within(many, key, 0.6, 0.5);
        drag(many, [
          [x0, y],
          [(x0 + x1) / 2, y],
          [x1, y],
        ]);
      };
      brushIn("b");
      expect(one.selection?.x).toEqual(many.selection!.x);
      // A brush in a, of its own x, is not the channel's: b's selection,
      // which it takes the place of, goes from the other chart too.
      brushIn("a");
      expect(many.selectionOwner?.panels).toEqual(["a"]);
      expect(one.selection).toBeNull();
      // What the other chart sends belongs to the channel's panel.
      one.select([2, 3]);
      expect(many.selection?.x).toEqual([2, 3]);
      expect(many.selectionOwner?.panels).toEqual(["b"]);
    },
    "a selection channel naming a subplot carries that subplot's brushes",
  );
});

describe("selections of categories", () => {
  it("land on the categories data changed since the last frame gives", async () => {
    for (const scope of ["chart", "panel"] as const) {
      const group = `cats-${scope}`;
      const cats = table({ k: ["a", "b"], v: [1, 2] });
      const many = await mount({
        marks: [
          bar(cats, { x: "k", y: "v", panel: "a" }),
          bar(cats, { x: "k", y: "v", panel: "b" }),
        ],
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        x: { scope },
        interaction: { brush: "x", sync: { selection: { group, panel: "b" } } },
      });
      const one = await mount({
        marks: [bar(table({ k: ["a", "b"], v: [1, 2] }), { x: "k", y: "v" })],
        interaction: { brush: "x", sync: { selection: group } },
      });
      cats.reset({ k: ["b", "a"], v: [2, 1] });
      // "a", the first of the sender's categories, and the receiver's second now.
      one.select([0, 0]);
      many.render();
      expect(many.selection?.x).toEqual([1, 1]);
      expect(many.selectionOwner?.panels).toEqual(scope === "chart" ? ["a", "b"] : ["b"]);
    }
  });
});

describe("cursors on charts that read nothing under them", () => {
  /** Where a chart's visible crosshair crosses x, in pixels; undefined for none. */
  const crosshairX = (chart: Chart) => {
    const shown = [...chart.root.querySelectorAll("svg line")].find(
      (line) =>
        line.getAttribute("visibility") === "visible" &&
        line.getAttribute("x1") === line.getAttribute("x2"),
    );
    return shown ? Number(shown.getAttribute("x1")) : undefined;
  };
  const cells = table({
    t: [0, 1, 2, 0, 1, 2],
    row: ["a", "a", "a", "b", "b", "b"],
    z: [1, 2, 3, 4, 5, 6],
  });

  it("show a received cursor as a line across a heatmap, and share the pointer's from one", async () => {
    const sync = { sync: { cursor: "heat" } };
    const heat = await mount({
      marks: [heatmap(cells, { x: "t", y: "row", color: "z" })],
      interaction: sync,
    });
    const trend = await mount({ marks: [line(data, { x: "t", y: "v" })], interaction: sync });
    // At a cell's center, which the cursor snaps to as a line's does to its points.
    trend.showCursor({ x: 1 });
    await frame();
    const at = heat.toPixel(1, { axis: "x" })!;
    expect(Math.abs(crosshairX(heat)! - at)).toBeLessThanOrEqual(1);
    // The pointer over the heatmap, between its cells' centers, moves the line chart's cursor.
    trend.hideCursor();
    const [, y] = within(heat, "", 0.5, 0.5);
    const x = heat.toPixel(1.6, { axis: "x" })!;
    pointer(heat, "pointermove", x, y);
    await frame();
    expect(crosshairX(trend)).toBeDefined();
  });

  it("show the cursor the pointer shares where it reads nothing, on the chart it is over too", async () => {
    const sync = { sync: { cursor: "rules" } };
    // Rules of a table alone, which the pointer reads nothing of.
    const chart = await mount({
      marks: [rule(table({ t: [0.5, 3.5] }), { x: "t" })],
      interaction: sync,
    });
    const peer = await mount({ marks: [line(data, { x: "t", y: "v" })], interaction: sync });
    const [, y] = within(chart, "", 0.5, 0.5);
    const x = chart.toPixel(2, { axis: "x" })!;
    pointer(chart, "pointermove", x, y);
    await frame();
    expect(Math.abs(crosshairX(chart)! - x)).toBeLessThanOrEqual(1);
    expect(Math.abs(crosshairX(peer)! - peer.toPixel(2, { axis: "x" })!)).toBeLessThanOrEqual(1);
  });

  it("carry the cursor to the chart's panels that read nothing, and from them", async () => {
    const chart = await mount({
      marks: [
        line(data, { x: "t", y: "v", panel: "a" }),
        rule(table({ t: [0.5, 3.5] }), { x: "t", panel: "b" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
      x: { scope: "chart" },
    });
    const hovers = heard(chart, "hover");
    const crossings = () =>
      [...chart.root.querySelectorAll("svg line")].filter(
        (line) =>
          line.getAttribute("visibility") === "visible" &&
          line.getAttribute("x1") === line.getAttribute("x2"),
      ).length;
    await hover(chart, "a", 2);
    expect(crossings()).toBe(2);
    expect(hovers.at(-1)?.inspection?.panel).toBe("a");
    // Over the rules, the pointer reads nothing, though the line's panel does.
    await hover(chart, "b", 2);
    expect(crossings()).toBe(2);
    expect(hovers.at(-1)?.inspection).toBeUndefined();
  });

  it("leave the pointer's cursor to the application without the tooltip, listening or not", async () => {
    const chart = await mount({
      marks: [line(data, { x: "t", y: "v" })],
      tooltip: false,
      interaction: { sync: { cursor: "quiet" } },
    });
    await hover(chart, "", 2);
    expect(crosshairX(chart)).toBeUndefined();
    const hovers = heard(chart, "hover");
    await hover(chart, "", 3);
    expect(crosshairX(chart)).toBeUndefined();
    expect(hovers.at(-1)?.inspection?.points.length).toBeGreaterThan(0);
  });

  it("label a line alone on its axis with the value it crosses at", async () => {
    const chart = await mount({
      marks: [rule(table({ t: [0.5, 3.5] }), { x: "t" })],
      tooltip: { axisLabels: true },
    });
    chart.showCursor({ x: 2 });
    await frame();
    const boxes = [...chart.root.querySelectorAll<HTMLElement>("div[aria-hidden] > div")].filter(
      (box) => box.style.display !== "none",
    );
    expect(boxes.map((box) => box.textContent)).toEqual(["2"]);
  });
});

describe("sync endpoints", () => {
  it("carry a right axis' view along y in a panel drawing no left y", async () => {
    const many = await mount({
      marks: [
        line(data, { x: "t", y: "v", panel: "a" }),
        line(data, { x: "t", y: "w", panel: "b", axis: "right" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
      interaction: { sync: { viewport: { group: "right", scale: "y", panel: "b" } } },
    });
    const one = await mount(single({ sync: { viewport: { group: "right", scale: "y" } } }));
    one.setViewport({ y: [110, 150] });
    expect(many.getViewport({ panel: "b" }).yRight).toEqual([110, 150]);
    expect(many.getViewport({ panel: "a" }).y).toBeNull();
    // Its left y, which it does not draw, has no pixels.
    expect(many.toPixel(120, { panel: "b", axis: "y" })).toBeUndefined();
  });

  it("land on the panels as options changed them since the last frame", async () => {
    const options = (scope: "panel" | "chart"): ChartOptions => ({
      ...MULTI.subplots.options({ sync: { viewport: { group: "regrouped", panel: "b" } } }),
      x: { scope },
    });
    const many = await mount(options("panel"));
    const one = await mount(single({ sync: { viewport: "regrouped" } }));
    many.update(options("chart"));
    one.setViewport({ x: [2, 4] });
    expect(many.getViewport({ panel: "a" }).x).toEqual([2, 4]);
    many.render();
    expect(many.getViewport({ panel: "b" }).x).toEqual([2, 4]);
  });

  it("let a view a listener of the frame drawn on receiving shares win over the one received", async () => {
    const options = (scope: "panel" | "chart"): ChartOptions => ({
      ...MULTI.subplots.options({ sync: { viewport: { group: "nested", panel: "b" } } }),
      x: { scope },
    });
    const many = await mount(options("panel"));
    const one = await mount(single({ sync: { viewport: "nested" } }));
    many.update(options("chart"));
    let once = true;
    many.on("render", () => {
      if (once) one.setViewport({ x: [3, 4] });
      once = false;
    });
    one.setViewport({ x: [1, 2] });
    expect(one.getViewport().x).toEqual([3, 4]);
    expect(many.getViewport({ panel: "b" }).x).toEqual([3, 4]);
  });

  it("draw a stream's views a frame at a time, as their data changes between them", async () => {
    const streamed = rows();
    const many = await mount({
      marks: [
        line(streamed, { x: "t", y: "v", panel: "a" }),
        line(streamed, { x: "t", y: "w", panel: "b" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
      x: { scope: "panel" },
      interaction: { sync: { viewport: { group: "streamed", panel: "b" } } },
    });
    const one = await mount(single({ sync: { viewport: "streamed" } }));
    const renders = heard(many, "render");
    for (let i = 0; i < 5; i++) {
      streamed.set("v", 0, i);
      one.setViewport({ x: [i, i + 2] });
    }
    expect(renders).toHaveLength(0);
    expect(many.getViewport({ panel: "b" }).x).toEqual([4, 6]);
  });

  it("carry y to the right axis panels without a left one share, and not to one of a panel's own", async () => {
    const options = (yRight: "panel" | "chart"): ChartOptions => ({
      marks: [
        line(data, { x: "t", y: "v", panel: "a", axis: "right" }),
        line(data, { x: "t", y: "w", panel: "b", axis: "right" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
      y: { scope: yRight === "chart" ? "panel" : "chart" },
      yRight: { scope: yRight },
      interaction: { sync: { viewport: { group: `right-${yRight}`, scale: "y" } } },
    });
    const shared = await mount(options("chart"));
    const own = await mount(options("panel"));
    const shares = await mount(
      single({ sync: { viewport: { group: "right-chart", scale: "y" } } }),
    );
    const keeps = await mount(single({ sync: { viewport: { group: "right-panel", scale: "y" } } }));
    shares.setViewport({ y: [110, 150] });
    keeps.setViewport({ y: [110, 150] });
    expect(shared.getViewport({ panel: "a" }).yRight).toEqual([110, 150]);
    expect(own.getViewport({ panel: "a" }).yRight).toBeNull();
  });

  it("show a cursor on the channel's panel as the panels share its scale when drawn", async () => {
    const options = (scope: "panel" | "chart"): ChartOptions => ({
      ...MULTI.subplots.options({ sync: { cursor: { group: "regrouped-cursor", panel: "b" } } }),
      x: { scope },
    });
    const many = await mount(options("panel"));
    const one = await mount(single({ sync: { cursor: "regrouped-cursor" } }));
    many.update(options("chart"));
    one.showCursor({ x: 2 });
    await frame();
    const crossings = [...many.root.querySelectorAll("svg line")].filter(
      (line) =>
        line.getAttribute("visibility") === "visible" &&
        line.getAttribute("x1") === line.getAttribute("x2"),
    );
    expect(crossings).toHaveLength(2);
  });

  it("share the keyboard's cursor once it moves into the channel's panel at the same value", async () => {
    const many = await mount(
      MULTI.subplots.options({ sync: { cursor: { group: "keys", panel: "b" } } }),
    );
    const one = await mount(single({ sync: { cursor: "keys" } }));
    const shows = () => one.root.querySelector("svg line[visibility=visible]") !== null;
    many.root.focus();
    // Into a's first point: a's x is not the channel's.
    key(many, "ArrowRight");
    await frame();
    expect(shows()).toBe(false);
    // Down into b, at the same x.
    key(many, "ArrowDown");
    await frame();
    expect(shows()).toBe(true);
  });
});
