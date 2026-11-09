// The pointer cursor where the chart's own click acts (a node that drills,
// a tree's centre that drills out, an item `select` selects or a click
// pins, rows a row selection takes, a legend entry), and nowhere else;
// draggable rules keep their own. Targets are read as an inspecting chart
// reads them: a move settles values playing, a resting pointer shows
// changes at once. `interaction.toolbar: false` hides controls' buttons
// and keeps their keys.

import "./interactive.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { category } from "../../src/data/column.ts";
import { type FeatureCollection, fromGeoJSON } from "../../src/data/geojson.ts";
import { selectionStore } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { bar } from "../../src/marks/bar.ts";
import { geoshape } from "../../src/marks/geoshape.ts";
import { graph } from "../../src/marks/graph.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { rule } from "../../src/marks/rule.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import type { ItemInspection } from "../../src/model/model.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { contractTest } from "../helpers/contracts.ts";
import { MOUSE, modelOf, pageOrigin, realMouse } from "./helpers.ts";

const mounted: Chart[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const chart of mounted.splice(0)) chart.destroy();
  for (const host of hosts.splice(0)) host.remove();
  // The shared scheduler waits for a frame it asked for; let it run.
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

async function mount(options: ChartOptions): Promise<Chart> {
  const host = document.createElement("div");
  // At the top of the page, within the test frame's 414 pixels: input beyond them lands nowhere.
  host.style.cssText = "position:fixed;left:0;top:0;width:400px;height:300px";
  document.body.append(host);
  hosts.push(host);
  const chart = createChart(host, { locale: "en-US", renderer: "svg", ...options });
  mounted.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

/** Destroys a chart and its host, for tests that mount another in the same place. */
function unmount(chart: Chart) {
  chart.root.parentElement?.remove();
  chart.destroy();
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Moves the mouse to (x, y) of the chart's root and waits for the frame that answers it. */
async function moveTo(chart: Chart, x: number, y: number) {
  const at = pageOrigin(chart.root);
  await realMouse({ type: "move", x: at.x + x, y: at.y + y });
  // Picking may load for the first move.
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  await frame();
  await frame();
}

async function click(chart: Chart, x: number, y: number) {
  const at = pageOrigin(chart.root);
  await realMouse({ type: "move", x: at.x + x, y: at.y + y });
  await realMouse({ type: "press", x: at.x + x, y: at.y + y });
  await realMouse({ type: "release", x: at.x + x, y: at.y + y });
  await frame();
}

/** A pointer event at the chart's pixel (x, y). */
function pointer(chart: Chart, type: string, x: number, y: number) {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: MOUSE,
      pointerType: "mouse",
      clientX: rect.left + x,
      clientY: rect.top + y,
    }),
  );
}

/** The cursor the chart shows over its drawing, where its parts set none of their own. */
const cursor = (chart: Chart) => getComputedStyle(chart.root).cursor;

function heard<K extends keyof ChartEvents>(chart: Chart, type: K): ChartEvents[K][] {
  const events: ChartEvents[K][] = [];
  chart.on(type, (event) => events.push(event));
  return events;
}

const sales = () =>
  table({
    region: ["Europe", "Europe", "Europe", "Asia", "Asia"],
    country: ["France", "France", "Spain", "Japan", "India"],
    revenue: [40, 10, 20, 50, 30],
  });

/** Where the item drawn as `label` (by its path) is: its tooltip's anchor. */
function itemAt(chart: Chart, label: string): [number, number] {
  const model = modelOf(chart);
  let key = model.stepItem(undefined, 1);
  const seen = new Set<string>();
  while (key !== undefined && !seen.has(key)) {
    seen.add(key);
    const item = model.inspectItem(key) as ItemInspection;
    const [found] = item.points;
    if (found!.label === label) return [found!.px, found!.py];
    key = model.stepItem(key, 1);
  }
  throw new Error(`No item ${label}`);
}

/** A sunburst's middle, where a drilled one goes up. */
function middle(chart: Chart): [number, number] {
  const { plot } = modelOf(chart).items!.panels[0]!;
  return [plot.x + plot.width / 2, plot.y + plot.height / 2];
}

const metrics = () => table({ t: [0, 1, 2, 3, 4], v: [10, 30, 20, 50, 40] });
/** A pixel of the chart at data (x, y). */
const at = (chart: Chart, x: number, y: number) =>
  [chart.toPixel(x, { axis: "x" })!, chart.toPixel(y, { axis: "y" })!] as [number, number];

describe("the pointer cursor", () => {
  contractTest(
    "interaction.cursor.drill.engine",
    async () => {
      const chart = await mount({
        marks: [sunburst(sales(), { path: ["region", "country"], value: "revenue" })],
        interaction: { zoom: true },
      });
      await moveTo(chart, ...itemAt(chart, "Asia"));
      expect(cursor(chart)).toBe("pointer");
      await moveTo(chart, ...itemAt(chart, "Asia / Japan"));
      expect(cursor(chart)).toBe("auto");
      // Off the rings, nothing.
      await moveTo(chart, 5, 5);
      expect(cursor(chart)).toBe("auto");
    },
    "shows over a node that drills, and not over a leaf",
  );

  it("shows over a drilled tree's centre, painted or left empty, which goes up", async () => {
    for (const center of [true, false]) {
      const chart = await mount({
        marks: [sunburst(sales(), { path: ["region", "country"], value: "revenue", center })],
        interaction: { zoom: true },
      });
      // At the whole tree, the middle goes nowhere.
      await moveTo(chart, ...middle(chart));
      expect(cursor(chart)).toBe("auto");
      chart.setDrillRoot('[0,"Asia"]');
      chart.render();
      const [x, y] = middle(chart);
      await moveTo(chart, x + 1, y);
      expect(cursor(chart)).toBe("pointer");
      const drills = heard(chart, "drill");
      await click(chart, x, y);
      expect(drills.at(-1)?.key).toBeNull();
      unmount(chart);
    }
  });

  contractTest(
    "interaction.cursor.select.engine",
    async () => {
      const chart = await mount({
        marks: [point(metrics(), { x: "t", y: "v" }), rule({ y: 45 })],
        interaction: { select: "items" },
      });
      await moveTo(chart, ...at(chart, 3, 50));
      expect(cursor(chart)).toBe("pointer");
      await moveTo(chart, ...at(chart, 3.5, 10));
      expect(cursor(chart)).toBe("auto");
      // The rule is an item, which items select.
      await moveTo(chart, ...at(chart, 0.5, 45));
      expect(cursor(chart)).toBe("pointer");
      // It is of no series, which series select.
      chart.update({ interaction: { select: "series" } });
      chart.render();
      await moveTo(chart, ...at(chart, 0.6, 45));
      expect(cursor(chart)).toBe("auto");
      await moveTo(chart, ...at(chart, 3, 50));
      expect(cursor(chart)).toBe("pointer");
    },
    "shows over an item select selects, and not off the data",
  );

  contractTest(
    "interaction.cursor.pin.engine",
    async () => {
      const chart = await mount({
        marks: [point(metrics(), { x: "t", y: "v" })],
        tooltip: { pin: "click" },
        inspection: { mode: "nearest" },
      });
      await moveTo(chart, ...at(chart, 3, 50));
      expect(cursor(chart)).toBe("pointer");
      await moveTo(chart, ...at(chart, 3.5, 10));
      expect(cursor(chart)).toBe("auto");
    },
    "shows over an item a click pins",
  );

  contractTest(
    "interaction.cursor.row-selection.engine",
    async () => {
      const data = sales();
      const chart = await mount({
        marks: [sunburst(data, { path: ["region", "country"], value: "revenue" })],
        interaction: { zoom: true },
        rowSelection: rowSelection({ store: selectionStore(data), channel: "picked" }),
      });
      // A leaf selects its rows.
      await moveTo(chart, ...itemAt(chart, "Asia / Japan"));
      expect(cursor(chart)).toBe("pointer");
      await moveTo(chart, 5, 5);
      expect(cursor(chart)).toBe("auto");
      unmount(chart);
      const lines = metrics();
      const linked = await mount({
        marks: [point(lines, { x: "t", y: "v" })],
        rowSelection: rowSelection({ store: selectionStore(lines), channel: "picked" }),
      });
      await moveTo(linked, ...at(linked, 3, 50));
      expect(cursor(linked)).toBe("pointer");
      await moveTo(linked, ...at(linked, 1, 5));
      expect(cursor(linked)).toBe("auto");
    },
    "shows over an item whose rows a click selects, which a tree does instead of drilling",
  );

  contractTest(
    "interaction.cursor.legend.engine",
    async () => {
      const chart = await mount({
        marks: [
          line(table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], s: category(["a", "a", "b", "b"]) }), {
            x: "t",
            y: "v",
            series: "s",
          }),
        ],
      });
      const entry = chart.root.querySelector<HTMLElement>("button[aria-pressed]")!;
      expect(getComputedStyle(entry).cursor).toBe("pointer");
    },
    "shows over a legend entry, which toggles its series",
  );

  it("leaves a rule the pointer drags its own cursor, beside items select selects", async () => {
    const chart = await mount({
      marks: [point(metrics(), { x: "t", y: "v" }), rule({ id: "threshold", y: 25, drag: true })],
      interaction: { select: "items" },
    });
    const settled = async () => {
      await frame();
      await frame();
      return chart.root.style.cursor;
    };
    pointer(chart, "pointermove", ...at(chart, 2.5, 25));
    expect(await settled()).toBe("ns-resize");
    pointer(chart, "pointermove", ...at(chart, 3, 50));
    expect(await settled()).toBe("pointer");
    pointer(chart, "pointermove", ...at(chart, 2.5, 10));
    expect(await settled()).toBe("");
  });

  it("shows nothing where the chart's clicks act on nothing", async () => {
    const lines = await mount({ marks: [point(metrics(), { x: "t", y: "v" })] });
    await moveTo(lines, ...at(lines, 3, 50));
    expect(cursor(lines)).toBe("auto");
    unmount(lines);
    const tree = await mount({
      marks: [sunburst(sales(), { path: ["region", "country"], value: "revenue" })],
    });
    await moveTo(tree, ...itemAt(tree, "Asia"));
    expect(cursor(tree)).toBe("auto");
  });

  it("shows none over an item drawn off the plot, where a press clicks no item", async () => {
    // Beyond the plot's right edge, clear of the axes' labels.
    const edge = table({ t: [1.03, 0.5], v: [1.5, 2] });
    const chart = await mount({
      marks: [point(edge, { x: "t", y: "v", clip: false })],
      x: { domain: [0, 1] },
      interaction: { select: "items" },
    });
    const selections = heard(chart, "select");
    await moveTo(chart, ...at(chart, 0.5, 2));
    expect(cursor(chart)).toBe("pointer");
    const off = at(chart, 1.03, 1.5);
    const { plot } = modelOf(chart).panels()[0]!;
    expect(off[0]).toBeGreaterThan(plot.x + plot.width);
    await moveTo(chart, ...off);
    expect(cursor(chart)).toBe("auto");
    await click(chart, ...off);
    expect(selections).toEqual([]);
  });

  it("shows none where a drag moves the crosshair, which makes presses click nothing", async () => {
    const chart = await mount({
      marks: [point(metrics(), { x: "t", y: "v" })],
      interaction: {
        select: "items",
        bindings: [{ gesture: { type: "drag" }, action: { type: "cursor" } }],
      },
    });
    const selections = heard(chart, "select");
    const [x, y] = at(chart, 3, 50);
    await moveTo(chart, x, y);
    expect(cursor(chart)).toBe("auto");
    await click(chart, x, y);
    expect(selections).toEqual([]);
    // Bound to touches only, a mouse's press clicks again.
    chart.update({
      interaction: {
        select: "items",
        bindings: [{ gesture: { type: "drag", pointer: "touch" }, action: { type: "cursor" } }],
      },
    });
    chart.render();
    await moveTo(chart, x + 1, y);
    expect(cursor(chart)).toBe("pointer");
  });

  it("shows none where a drag passes over editing a brush it is not on, to move the crosshair", async () => {
    const chart = await mount({
      marks: [point(metrics(), { x: "t", y: "v" })],
      interaction: {
        select: "items",
        bindings: [
          { gesture: { type: "drag" }, action: { type: "editBrush" } },
          { gesture: { type: "drag", pointer: "mouse" }, action: { type: "cursor" } },
        ],
      },
    });
    const selections = heard(chart, "select");
    const [x, y] = at(chart, 3, 50);
    await moveTo(chart, x, y);
    expect(cursor(chart)).toBe("auto");
    await click(chart, x, y);
    expect(selections).toEqual([]);
  });

  it("shows again where the pointer rests once a drag ends", async () => {
    const chart = await mount({
      marks: [point(metrics(), { x: "t", y: "v" })],
      interaction: { zoom: "x", select: "items" },
    });
    const [x, y] = at(chart, 3, 50);
    await moveTo(chart, x, y);
    expect(cursor(chart)).toBe("pointer");
    const page = pageOrigin(chart.root);
    await realMouse({ type: "press", x: page.x + x, y: page.y + y });
    await realMouse({ type: "move", x: page.x + x - 30, y: page.y + y });
    await frame();
    expect(cursor(chart)).toBe("auto");
    // The view moved with the pointer, so the point is under it again.
    await realMouse({ type: "release", x: page.x + x - 30, y: page.y + y });
    await frame();
    await frame();
    expect(cursor(chart)).toBe("pointer");
  });

  it("goes when the pointer leaves, and shows again as it comes back", async () => {
    const chart = await mount({
      marks: [point(metrics(), { x: "t", y: "v" })],
      interaction: { select: "items" },
    });
    const [x, y] = at(chart, 3, 50);
    pointer(chart, "pointermove", x, y);
    await frame();
    await frame();
    expect(chart.root.style.cursor).toBe("pointer");
    pointer(chart, "pointerleave", x, y);
    expect(chart.root.style.cursor).toBe("");
    pointer(chart, "pointermove", x, y);
    await frame();
    await frame();
    expect(chart.root.style.cursor).toBe("pointer");
  });
});

describe("targets read as an inspecting chart reads them", () => {
  const tick = (ms: number) => vi.advanceTimersByTime(ms);
  /** Frames and the clock are the test's from here on (see animation.test.ts). */
  async function controlTime(chart: Chart) {
    await frame();
    await frame();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    chart.render();
    chart.root.dispatchEvent(new PointerEvent("pointerleave"));
    tick(16);
  }
  /** What the chart's SVG draws. */
  const drawn = (chart: Chart) => chart.root.querySelector("svg")!.outerHTML;
  /** Bars that a click selects (or not), the pointer reading nothing else. */
  const bars = (select: boolean) => {
    const data = table({ k: ["a", "b"], y: [10, 20] });
    const options: ChartOptions = {
      marks: [bar(data, { x: "k", y: "y" })],
      y: { domain: [0, 60] },
      animation: { values: true, duration: 300 },
      inspection: false,
      ...(select && { interaction: { select: "items" } }),
    };
    return { data, options };
  };
  /** A pixel over the first bar's place, at `value`. */
  const over = (chart: Chart, value: number) =>
    [modelOf(chart).panels()[0]!.x.map(0) + 10, chart.toPixel(value, { axis: "y" })!] as [
      number,
      number,
    ];

  it("show a change under a resting pointer at once where a click selects, as inspection does", async () => {
    for (const select of [true, false]) {
      const { data, options } = bars(select);
      const chart = await mount(options);
      await controlTime(chart);
      pointer(chart, "pointermove", ...over(chart, 5));
      tick(16);
      data.replace(0, { y: [50] });
      tick(16);
      const early = drawn(chart);
      tick(400);
      // Where nothing reads the pointer, values move under it, as before.
      expect(drawn(chart) === early, `select ${select}`).toBe(select);
      unmount(chart);
      vi.runOnlyPendingTimers();
      vi.useRealTimers();
    }
  });

  contractTest(
    "interaction.cursor.reads-drawn.engine",
    async () => {
      const { data, options } = bars(true);
      const chart = await mount(options);
      await controlTime(chart);
      data.replace(0, { y: [50] });
      tick(100);
      // Part way: the bar is short of 40.
      const between = drawn(chart);
      pointer(chart, "pointermove", ...over(chart, 40));
      // The move shows the new values before it reads them.
      const settled = drawn(chart);
      expect(settled).not.toBe(between);
      tick(16);
      expect(chart.root.style.cursor).toBe("pointer");
      tick(400);
      expect(drawn(chart)).toBe(settled);
      // At rest, a change is drawn at once, and what the pointer is on is read again.
      data.replace(0, { y: [10] });
      tick(16);
      expect(chart.root.style.cursor).toBe("");
      const shrunk = drawn(chart);
      tick(400);
      expect(drawn(chart)).toBe(shrunk);
    },
    "settle values playing on a move, and read the item drawn, never a destination between",
  );
});

/** Toolbars the chart shows: none where `interaction.toolbar` is false. */
function toolbars(chart: Chart): HTMLElement[] {
  return [...chart.root.querySelectorAll<HTMLElement>("[role=toolbar]")].filter(
    (toolbar) => getComputedStyle(toolbar).display !== "none",
  );
}

const square = (x: number, y: number, s: number) => [
  [x, y],
  [x + s, y],
  [x + s, y + s],
  [x, y + s],
  [x, y],
];
const countries = (): FeatureCollection => ({
  type: "FeatureCollection",
  features: Array.from({ length: 4 }, (_, i) => ({
    type: "Feature" as const,
    properties: { name: `C${i}` },
    geometry: { type: "Polygon" as const, coordinates: [square(i * 10, -5, 10)] },
  })),
});

describe("interaction.toolbar: false", () => {
  /** The toolbars shown with the pointer and the focus in the chart. */
  async function shown(chart: Chart) {
    chart.root.dispatchEvent(new PointerEvent("pointerenter"));
    chart.root.focus();
    chart.render();
    await frame();
    return toolbars(chart);
  }

  contractTest(
    "interaction.toolbar.hidden.engine",
    async () => {
      const families: [string, Partial<ChartOptions>][] = [
        [
          "tree",
          {
            marks: [sunburst(sales(), { path: ["region", "country"], value: "revenue" })],
            drillRoot: '[0,"Asia"]',
          },
        ],
        ["map", { marks: [geoshape(fromGeoJSON(countries()), { labelField: "name" })] }],
        [
          "network",
          {
            marks: [
              graph(table({ from: ["a", "b"], to: ["b", "c"] }), { source: "from", target: "to" }),
            ],
          },
        ],
        [
          "3D",
          {
            marks: [
              point3d(table({ x: [0, 1], y: [1, 0], z: [0, 1] }), { x: "x", y: "y", z: "z" }),
            ],
          },
        ],
      ];
      for (const [family, options] of families) {
        const own = await mount({ ...options, interaction: { zoom: true } } as ChartOptions);
        expect((await shown(own)).length, family).toBeGreaterThan(0);
        // As options change too.
        own.update({ interaction: { zoom: true, toolbar: false } });
        expect(await shown(own), family).toEqual([]);
        unmount(own);
        const hidden = await mount({
          ...options,
          interaction: { zoom: true, toolbar: false },
        } as ChartOptions);
        expect(await shown(hidden), family).toEqual([]);
        unmount(hidden);
      }
    },
    "shows no buttons in trees, maps, networks, or 3D",
  );

  contractTest(
    "interaction.toolbar.keys.engine",
    async () => {
      const map = await mount({
        marks: [geoshape(fromGeoJSON(countries()), { labelField: "name" })],
        interaction: { zoom: true, toolbar: false },
      });
      map.root.focus();
      map.root.dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
      map.render();
      expect(modelOf(map).items!.result()!.plane!.zoom).toBeGreaterThan(1);
      unmount(map);
      const three = await mount({
        marks: [point3d(table({ x: [0, 1], y: [1, 0], z: [0, 1] }), { x: "x", y: "y", z: "z" })],
        interaction: { toolbar: false },
      });
      const before = three.getCamera()!.azimuth;
      three.root.focus();
      three.root.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }),
      );
      expect(three.getCamera()!.azimuth).not.toBe(before);
    },
    "keeps the keys: a map zooms with plus, a 3D chart turns with Shift and the arrows",
  );

  it("drills out by Backspace, 0, and the tree's centre", async () => {
    const chart = await mount({
      marks: [sunburst(sales(), { path: ["region", "country"], value: "revenue", center: false })],
      interaction: { zoom: true, toolbar: false },
    });
    const drills = heard(chart, "drill");
    chart.root.focus();
    const press = (key: string) =>
      chart.root.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    chart.setDrillRoot('[0,"Asia","Japan"]');
    chart.render();
    expect(toolbars(chart)).toEqual([]);
    press("Backspace");
    expect(drills.at(-1)!.key).toBe('[0,"Asia"]');
    press("0");
    expect(drills.at(-1)!.key).toBeNull();
    chart.setDrillRoot('[0,"Asia"]');
    chart.render();
    await click(chart, ...middle(chart));
    expect(drills.at(-1)!.key).toBeNull();
  });
});

describe("the keyboard beside the pointer cursor", () => {
  it("drills with Enter, and says what it said without the cursor or toolbar", async () => {
    const said: string[][] = [];
    for (const interaction of [
      { zoom: true },
      { zoom: true, toolbar: false, select: "items" as const },
    ]) {
      const chart = await mount({
        marks: [sunburst(sales(), { path: ["region", "country"], value: "revenue" })],
        interaction,
      });
      const drills = heard(chart, "drill");
      const live = chart.root.querySelector("[aria-live]")!;
      const texts: string[] = [];
      // The pointer rests on a node that drills while the keys move.
      await moveTo(chart, ...itemAt(chart, "Asia"));
      chart.root.focus();
      for (const key of ["{ArrowRight}", "{Enter}", "{ArrowRight}", "{Backspace}"]) {
        await userEvent.keyboard(key);
        await frame();
        texts.push(live.textContent ?? "");
      }
      // Enter drilled into the node read, and Backspace went back up.
      expect(drills.map(({ key }) => key === null)).toEqual([false, true]);
      said.push([...texts, ...drills.map(({ key }) => String(key))]);
      unmount(chart);
    }
    expect(said[1]).toEqual(said[0]);
  });
});
