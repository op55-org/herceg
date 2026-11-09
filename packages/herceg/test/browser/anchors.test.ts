// Anchors: application elements a chart holds at a place in its data,
// moved with every frame it draws and hidden while the place is out of view.
import "./interactive.ts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { AnchorItems } from "../../src/dom/anchor-items.ts";
import { anchor } from "../../src/dom/anchors.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { InputEvent, ItemTarget } from "../../src/dom/events.ts";
import { columns, panel } from "../../src/layout.ts";
import { area } from "../../src/marks/area.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { region } from "../../src/marks/region.ts";
import { facet } from "../../src/model/facet.ts";
import { panels } from "../../src/model/panels.ts";
import { renderToPDF } from "../../src/pdf.ts";
import type { ChartError } from "../../src/spec/errors.ts";
import { collectGarbage, MOUSE } from "./helpers.ts";

const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
  if (vi.isFakeTimers()) vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** A host of `width` by `height`, at the top of the page, so that it is on screen. */
function host(width = 600, height = 300): HTMLDivElement {
  const element = document.createElement("div");
  element.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px`;
  document.body.append(element);
  return element;
}

/** A chart, once what it loads has loaded and its first frame is drawn. */
async function mount(options: ChartOptions, into = host()): Promise<Chart> {
  const chart = createChart(into, { locale: "en-US", renderer: "svg", ...options });
  charts.push(chart);
  await settle(chart);
  return chart;
}

/** Waits for what the chart loads (picking, for item anchors) and the frames that follow. */
async function settle(chart: Chart): Promise<void> {
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  await frame();
  await frame();
}

/** A button of a known size, without margins. */
function button(text = "Peak"): HTMLButtonElement {
  const element = document.createElement("button");
  element.textContent = text;
  element.style.cssText = "margin:0;padding:0;border:0;width:40px;height:20px;font:12px sans-serif";
  return element;
}

/** Where `element` is, in CSS pixels from the chart's root. */
function boxIn(chart: Chart, element: Element) {
  const root = chart.root.getBoundingClientRect();
  const box = element.getBoundingClientRect();
  return { x: box.left - root.left, y: box.top - root.top, width: box.width, height: box.height };
}

/** That `a` is within a pixel of `b`. */
function near(a: number, b: number, what = "") {
  expect(Math.abs(a - b), `${what} ${a} vs ${b}`).toBeLessThanOrEqual(1);
}

/** That `element` sits 8 px above (x, y): its bottom centre there. */
function expectAbove(chart: Chart, element: Element, x: number, y: number, offset = 8) {
  const box = boxIn(chart, element);
  near(box.x + box.width / 2, x, "x");
  near(box.y + box.height, y - offset, "y");
}

/** What a pointer resting at (x, y) of the chart's root is on, once drawn. */
async function hovered(chart: Chart, x: number, y: number): Promise<ItemTarget | undefined> {
  const events: InputEvent[] = [];
  const stop = chart.on("hover", (event) => events.push(event));
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerId: MOUSE,
      isPrimary: true,
    }),
  );
  await frame();
  stop();
  const target = events.at(-1)?.target;
  return target?.kind === "item" ? target : undefined;
}

const values = () =>
  table({ x: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], y: [1, 3, 2, 8, 4, 5, 2, 6, 3, 4] });

describe("anchor", () => {
  it("holds A3's button 8 px above its point within a pixel through zoom, pan, resize, and streaming", async () => {
    const data = values();
    const into = host();
    const chart = await mount(
      { marks: [line(data, { x: "x", y: "y" })], interaction: { zoom: "x" } },
      into,
    );
    const peak = button();
    const held = anchor(chart, peak, { at: { x: 3, y: 8 }, side: "top", offset: 8 });
    await frame();
    const expectAtPeak = () =>
      expectAbove(chart, peak, chart.toPixel(3, { axis: "x" })!, chart.toPixel(8, { axis: "y" })!);
    expect(held.shown).toBe(true);
    expectAtPeak();
    chart.setViewport([2, 6]);
    await frame();
    expectAtPeak();
    // Panned by the wheel, sideways.
    const rect = chart.root.getBoundingClientRect();
    chart.root.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaX: 60,
        clientX: rect.left + 300,
        clientY: rect.top + 150,
      }),
    );
    await frame();
    expect(chart.getViewport().x).not.toEqual([2, 6]);
    expectAtPeak();
    into.style.width = "420px";
    into.style.height = "260px";
    await frame();
    await frame();
    expect(chart.getPanels()[0]!.plot.width).toBeLessThan(420);
    expectAtPeak();
    chart.setViewport(null);
    // Streamed rows move the axes under it.
    for (let k = 10; k < 30; k++) {
      data.append({ x: [k], y: [k % 2 ? 12 : 1] });
      await frame();
      expectAtPeak();
    }
  });

  it("hides out of view, telling `render` listeners what each frame showed", async () => {
    const chart = await mount({ marks: [line(values(), { x: "x", y: "y" })] });
    const peak = button();
    const held = anchor(chart, peak, { at: { x: 3, y: 8 } });
    const shown: boolean[] = [];
    chart.on("render", () => shown.push(held.shown));
    await frame();
    chart.setViewport([5, 9]);
    await frame();
    expect(held.shown).toBe(false);
    expect(getComputedStyle(peak.parentElement!).display).toBe("none");
    chart.setViewport(null);
    await frame();
    expect(held.shown).toBe(true);
    // The first frame only placed it: drawing nothing, it told no listener.
    expect(shown).toEqual([false, true]);
  });

  it("keeps an element's place when its size changes, without a frame", async () => {
    const chart = await mount({ marks: [line(values(), { x: "x", y: "y" })] });
    const peak = button();
    anchor(chart, peak, { at: { x: 3, y: 8 }, side: "top", offset: 8 });
    await frame();
    const px = chart.toPixel(3, { axis: "x" })!;
    const py = chart.toPixel(8, { axis: "y" })!;
    peak.style.width = "120px";
    peak.style.height = "48px";
    // Read before any frame: the wrapper's transform puts its bottom centre there whatever its size.
    expectAbove(chart, peak, px, py);
  });

  it("moves with set from the next frame, and forgets its place with remove", async () => {
    const chart = await mount({ marks: [line(values(), { x: "x", y: "y" })] });
    const peak = button();
    const held = anchor(chart, peak, { at: { x: 3, y: 8 }, side: "center" });
    await frame();
    held.set({ at: { x: 6, y: 2 }, side: "center" });
    await frame();
    const box = boxIn(chart, peak);
    near(box.x + box.width / 2, chart.toPixel(6, { axis: "x" })!);
    near(box.y + box.height / 2, chart.toPixel(2, { axis: "y" })!);
    const wrapper = peak.parentElement!;
    held.remove();
    expect(peak.isConnected).toBe(false);
    expect(wrapper.isConnected).toBe(false);
    expect(held.shown).toBe(false);
    // Once removed, it does nothing; the element can be anchored anew.
    held.set({ at: { x: 1, y: 1 } });
    held.remove();
    expect(anchor(chart, peak, { at: { x: 1, y: 1 } }).element).toBe(peak);
  });

  it("places points by categories, dates, scales, shares, and pixels", async () => {
    const days = table({ day: ["Mon", "Tue", "Wed"], v: [3, 5, 2] });
    const chart = await mount({ marks: [bar(days, { x: "day", y: "v" })] });
    const tag = button();
    anchor(chart, tag, { at: { x: "Tue", y: { fraction: 1 } }, side: "bottom" });
    const corner = button();
    anchor(chart, corner, {
      at: { x: { px: 0, frame: "chart" }, y: { data: 5, offset: -4 } },
      side: "right",
      align: "start",
    });
    await frame();
    const { plot } = chart.getPanels()[0]!;
    const box = boxIn(chart, tag);
    near(box.x + box.width / 2, chart.toPixel(1, { axis: "x" })!);
    near(box.y, plot.y);
    const beside = boxIn(chart, corner);
    near(beside.x, 0);
    near(beside.y, chart.toPixel(5, { axis: "y" })! - 4);

    const times = table({ t: [Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2)], v: [1, 2] });
    const timed = await mount({ marks: [line(times, { x: "t", y: "v" })] });
    const at = button();
    anchor(timed, at, { at: { x: new Date(Date.UTC(2026, 0, 2)), y: 2 }, side: "center" });
    await frame();
    const centre = boxIn(timed, at);
    near(centre.x + centre.width / 2, timed.toPixel(Date.UTC(2026, 0, 2), { axis: "x" })!);
  });

  it("starts and ends along the top in the text's direction", async () => {
    const chart = await mount({ marks: [line(values(), { x: "x", y: "y" })] });
    chart.root.parentElement!.dir = "rtl";
    const start = button();
    anchor(chart, start, { at: { x: 3, y: 8 }, align: "start" });
    await frame();
    // In right-to-left text, its start (right edge) is at the point.
    near(boxIn(chart, start).x + 40, chart.toPixel(3, { axis: "x" })!);
  });

  it("places points in subplots and facet panels, hiding while a facet panel is not drawn", async () => {
    const data = table({
      t: [0, 1, 2, 0, 1, 2],
      v: [1, 2, 3, 4, 5, 6],
      region: ["eu", "eu", "eu", "us", "us", "us"],
    });
    const faceted = await mount({
      marks: [line(data, { x: "t", y: "v" })],
      facet: facet("region"),
      y: { scope: "panel" },
    });
    const us = button("US");
    const held = anchor(faceted, us, { at: { x: 1, y: 5 }, side: "center", panel: "us" });
    await frame();
    const box = boxIn(faceted, us);
    near(box.x + box.width / 2, faceted.toPixel(1, { axis: "x", panel: "us" })!);
    near(box.y + box.height / 2, faceted.toPixel(5, { axis: "y", panel: "us" })!);
    data.reset({ t: [0, 1], v: [1, 2], region: ["eu", "eu"] });
    await frame();
    expect(held.shown).toBe(false);
    data.reset({ t: [0, 1, 0, 1], v: [1, 2, 4, 5], region: ["eu", "eu", "us", "us"] });
    await frame();
    expect(held.shown).toBe(true);

    const split = await mount({
      marks: [
        line(values(), { x: "x", y: "y", panel: "a" }),
        line(values(), { x: "x", y: "y", panel: "b" }),
      ],
      panels: panels(columns([1, 1], [panel("a"), panel("b")])),
    });
    const right = button("B");
    anchor(split, right, { at: { x: 3, y: 8 }, side: "center", panel: "b" });
    await frame();
    const inB = boxIn(split, right);
    near(inB.x + inB.width / 2, split.toPixel(3, { axis: "x", panel: "b" })!);
  });

  it("places a bar's item at its box, and an item's visible part", async () => {
    const sales = table({ region: ["N", "S", "E"], value: [3, 5, 2] });
    const bands = table({ id: ["a"], start: [2], end: [4] });
    const chart = await mount({
      marks: [bar(sales, { id: "bars", x: "region", y: "value", itemKey: "region" })],
    });
    const tag = button("S");
    const held = anchor(chart, tag, { at: { item: { mark: "bars", item: ["S"] } }, side: "top" });
    await settle(chart);
    expect(held.shown).toBe(true);
    const box = boxIn(chart, tag);
    const target = await hovered(chart, box.x + 20, box.y + 30);
    expect(target?.item).toBe(JSON.stringify(["bars", "S"]));
    near(box.x + box.width / 2, target!.box.x + target!.box.width / 2);
    near(box.y + box.height, target!.box.y);

    const banded = await mount({
      marks: [
        line(values(), { x: "x", y: "y" }),
        region(bands, { id: "downtime", x1: "start", x2: "end", itemKey: "id" }),
      ],
    });
    const popover = button("Down");
    anchor(banded, popover, { at: { item: { mark: "downtime", item: ["a"] } }, align: "start" });
    await settle(banded);
    const plot = banded.getPanels()[0]!.plot;
    near(boxIn(banded, popover).x, banded.toPixel(2, { axis: "x" })!);
    near(boxIn(banded, popover).y + 20, plot.y);
    // Half in view: its visible half's start.
    banded.setViewport([3, 9]);
    await frame();
    near(boxIn(banded, popover).x, plot.x);
  });

  it("places a layout mark's item and a custom mark's item where they are drawn", async () => {
    const shares = table({ k: ["a", "b"], v: [1, 3] });
    const pies = await mount({ marks: [pie(shares, { id: "pie", category: "k", value: "v" })] });
    const slice = button("b");
    anchor(pies, slice, { at: { item: { mark: "pie", item: ["b"] } }, side: "center" });
    await settle(pies);
    const centre = boxIn(pies, slice);
    const on = await hovered(pies, centre.x + centre.width / 2, centre.y + centre.height / 2);
    expect(on?.item).toBe(JSON.stringify(["pie", "b"]));

    const flights = table({ id: ["F-1", "F-2"], start: [10, 30], end: [40, 90], lane: ["a", "b"] });
    const chart = await mount({
      marks: [
        custom(flights, {
          id: "flights",
          x: ["start", "end"],
          y: "lane",
          itemKey: "id",
          draw({ table: t, series, x, y, item, rect }) {
            const end = t.numbers("end");
            for (const s of series)
              for (let k = 0; k < s.length; k++) {
                const row = s.rowAt(k);
                item(s, row, () =>
                  rect(x(s.x[row]!), y(s.y[row]!) - 4, x(end[row]!) - x(s.x[row]!), 8, {
                    fill: s.color,
                  }),
                );
              }
          },
        }),
      ],
    });
    const tag = button("F-2");
    anchor(chart, tag, { at: { item: { mark: "flights", item: ["F-2"] } }, side: "top" });
    await settle(chart);
    const box = boxIn(chart, tag);
    near(
      box.x + box.width / 2,
      (chart.toPixel(30, { axis: "x" })! + chart.toPixel(90, { axis: "x" })!) / 2,
    );
    near(box.y + box.height, chart.toPixel(1, { axis: "y" })! - 4);
  });

  it("hides an item the legend hides, or that is gone, and focus inside moves to the root", async () => {
    const data = table({
      t: [0, 1, 2, 0, 1, 2],
      v: [1, 2, 3, 4, 5, 6],
      s: ["a", "a", "a", "b", "b", "b"],
      name: ["a0", "a1", "a2", "b0", "b1", "b2"],
    });
    const chart = await mount({
      marks: [point(data, { id: "pts", x: "t", y: "v", color: "s", itemKey: "name" })],
    });
    const tag = button("b1");
    const held = anchor(chart, tag, { at: { item: { mark: "pts", item: ["b1"] } } });
    await settle(chart);
    expect(held.shown).toBe(true);
    tag.focus();
    const b = chart.getLegend().find(({ label }) => label === "b")!;
    chart.setVisibility(b.key, false);
    await frame();
    expect(held.shown).toBe(false);
    expect(document.activeElement).toBe(chart.root);
    chart.setVisibility(b.key, true);
    await frame();
    expect(held.shown).toBe(true);
    data.reset({ t: [0, 1], v: [1, 2], s: ["a", "a"], name: ["a0", "a1"] });
    await frame();
    expect(held.shown).toBe(false);
    // Focus elsewhere is not touched.
    const outside = document.body.appendChild(button("Outside"));
    outside.focus();
    data.reset({ t: [0, 1], v: [1, 5], s: ["a", "b"], name: ["a0", "b1"] });
    await frame();
    expect(held.shown).toBe(true);
    data.reset({ t: [0], v: [1], s: ["a"], name: ["a0"] });
    await frame();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it("finds items' rows after appends, drops, and resets, as the resolver does", async () => {
    const data = table({ name: ["a", "b"], t: [0, 1], v: [1, 2] });
    const chart = await mount({
      marks: [point(data, { id: "pts", x: "t", y: "v", itemKey: "name" })],
    });
    const tag = button("c");
    const held = anchor(chart, tag, { at: { item: { mark: "pts", item: ["c"] } }, side: "center" });
    await settle(chart);
    expect(held.shown).toBe(false);
    data.append({ name: ["c"], t: [2], v: [3] });
    await frame();
    expect(held.shown).toBe(true);
    const at = () => {
      const box = boxIn(chart, tag);
      return [box.x + box.width / 2, box.y + box.height / 2];
    };
    near(at()[0]!, chart.toPixel(2, { axis: "x" })!);
    data.dropFirst(1);
    data.append({ name: ["d"], t: [3], v: [1] });
    await frame();
    near(at()[0]!, chart.toPixel(2, { axis: "x" })!);
    near(at()[1]!, chart.toPixel(3, { axis: "y" })!);
    data.setColumn("v", [5, 5, 5]);
    await frame();
    near(at()[1]!, chart.toPixel(5, { axis: "y" })!);
  });

  it("finds rows again when a view asks another question, and lets go of tables no item anchor names", async () => {
    const data = table({ name: ["a", "b"], t: [0, 1], v: [1, 2] });
    const view = rowView(data, { filter: ["==", ["field", "name"], "a"] });
    // Subscriptions to the table, as anchors and the chart make them.
    let listening = 0;
    const subscribe = data.subscribe.bind(data);
    data.subscribe = (listener) => {
      listening++;
      const stop = subscribe(listener);
      return () => {
        listening--;
        stop();
      };
    };
    const chart = await mount({
      marks: [point(view, { id: "pts", x: "t", y: "v", itemKey: "name" })],
    });
    const before = listening;
    const tag = button("b");
    const held = anchor(chart, tag, { at: { item: { mark: "pts", item: ["b"] } }, side: "center" });
    await settle(chart);
    expect(held.shown).toBe(false);
    expect(listening).toBe(before + 1);
    view.setQuery({});
    await frame();
    expect(held.shown).toBe(true);
    near(boxIn(chart, tag).x + 20, chart.toPixel(1, { axis: "x" })!);
    // A point anchor names no rows; no anchor names the table's.
    held.set({ at: { x: 1, y: 2 } });
    await frame();
    expect(listening).toBe(before);
    held.set({ at: { item: { mark: "pts", item: ["b"] } } });
    await frame();
    expect(listening).toBe(before + 1);
    // Removed, it lets go at the next frame, though nothing else draws.
    held.remove();
    await frame();
    expect(listening).toBe(before);
  });

  it.each([
    ["line", line],
    ["area", area],
  ] as const)("finds a %s's observation along a category axis, in band order", async (_, make) => {
    const rows = table({ x: ["a", "b", "a"], y: [1, 2, 3], id: ["a0", "b", "a1"] });
    const chart = await mount({ marks: [make(rows, { id: "m", x: "x", y: "y", itemKey: "id" })] });
    const tag = button("b");
    const held = anchor(chart, tag, { at: { item: { mark: "m", item: ["b"] } }, side: "center" });
    await settle(chart);
    expect(held.shown).toBe(true);
    // Where a point anchor at its category and value is.
    const at = button("at");
    anchor(chart, at, { at: { x: "b", y: 2 }, side: "center" });
    await frame();
    const [box, point] = [boxIn(chart, tag), boxIn(chart, at)];
    near(box.x, point.x, "x");
    near(box.y, point.y, "y");
  });

  it("stays where the frame drew its item though a hover listener changes it, focus kept", async () => {
    const rows = table({ name: ["p"], t: [1], v: [3] });
    const chart = await mount({
      marks: [point(rows, { id: "pts", x: "t", y: "v", itemKey: "name", radius: 4 })],
      x: { domain: [0, 2] },
      y: { domain: [0, 10] },
    });
    const field = document.createElement("input");
    const held = anchor(chart, field, { at: { item: { mark: "pts", item: ["p"] } } });
    await settle(chart);
    // A pointer resting on the plot, which hears of the values moving under it.
    await hovered(chart, chart.toPixel(1, { axis: "x" })! + 30, chart.toPixel(5, { axis: "y" })!);
    field.focus();
    const stop = chart.on("hover", () => {
      if (rows.numbers("v")[0] === 4) rows.set("v", 0, 5);
    });
    rows.set("v", 0, 4);
    await frame();
    expect(held.shown).toBe(true);
    expect(document.activeElement).toBe(field);
    await frame();
    expect(held.shown).toBe(true);
    near(boxIn(chart, field).y + boxIn(chart, field).height, chart.toPixel(5, { axis: "y" })! - 4);
    stop();
  });

  it("stays where the frame drew its item though a listener of the frame's reports changes it", async () => {
    const rows = table({
      id: ["a", "b", "gone"],
      x: [1, 2, 3],
      y: [3, 4, 5],
      region: ["eu", "eu", "us"],
    });
    const chart = await mount({
      marks: [point(rows, { id: "pts", x: "x", y: "y", itemKey: "id" })],
      facet: facet("region"),
      x: { domain: [0, 5] },
      y: { scope: "panel", domain: [0, 10] },
    });
    const field = document.createElement("input");
    const held = anchor(chart, field, { at: { item: { mark: "pts", item: ["a"] } }, panel: "eu" });
    await settle(chart);
    chart.setViewport({ y: [2, 8] }, { panel: "us" });
    await frame();
    field.focus();
    // The frame that drops "us" retires its zoom, whose listener moves "a".
    let moved = false;
    const stop = chart.on("viewport", (event) => {
      if (moved || event.cause !== "data") return;
      moved = true;
      rows.set("y", 0, 6);
    });
    rows.reset({ id: ["a", "b"], x: [1, 2], y: [3, 4], region: ["eu", "eu"] });
    await frame();
    expect(moved).toBe(true);
    expect(held.shown).toBe(true);
    expect(document.activeElement).toBe(field);
    await settle(chart);
    expect(held.shown).toBe(true);
    stop();
  });

  it.each([
    ["focus leaving one hidden", "blur"],
    ["a refusal told of", "error"],
  ])("place every anchor where the frame drew it though %s changes data", async (_, by) => {
    const rows = table({ name: ["a", "b"], t: [1, 7], v: [3, 4] });
    const chart = await mount({
      marks: [point(rows, { id: "pts", x: "t", y: "v", itemKey: "name" })],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
      interaction: { zoom: "x" },
      onError: () => {},
    });
    const at = (name: string) => ({ at: { item: { mark: "pts", item: [name] } } });
    const [first, second] = [document.createElement("input"), document.createElement("input")];
    const change = () => rows.set("v", 1, rows.numbers("v")[1]! + 1);
    // Placed before the other: hidden as the view pans away from "a", or refused.
    const refused = { at: { x: 1 } } as never;
    const one = anchor(chart, first, by === "blur" ? at("a") : refused);
    const held = anchor(chart, second, at("b"));
    await settle(chart);
    if (by === "blur") {
      first.focus();
      first.addEventListener("blur", change, { once: true });
      chart.setViewport([5, 10]);
    } else {
      second.focus();
      chart.on("error", change);
      // Told of again in the frame placing the other.
      one.set(refused);
    }
    await frame();
    expect(held.shown).toBe(true);
    if (by === "error") expect(document.activeElement).toBe(second);
    await settle(chart);
    expect(held.shown).toBe(true);
  });

  it("leave an element anchored again as focus leaves it on removal to its new anchor", async () => {
    const chart = await mount({ marks: [line(values(), { x: "x", y: "y" })] });
    const field = document.createElement("input");
    const first = anchor(chart, field, { at: { x: 3, y: 8 } });
    await settle(chart);
    field.focus();
    let again: ReturnType<typeof anchor> | undefined;
    field.addEventListener("blur", () => (again = anchor(chart, field, { at: { x: 5, y: 4 } })), {
      once: true,
    });
    first.remove();
    await settle(chart);
    expect(again?.shown).toBe(true);
    expect(field.isConnected).toBe(true);
    expect(chart.root.contains(field)).toBe(true);
  });

  it.each([
    ["in table order", false],
    ["in a view's own order", true],
  ])("stand at every point of an item many rows share, drawn %s", async (_, sorted) => {
    const rows = table({ name: ["k", "j", "k", "k"], x: [1, 5, 2, 8], y: [5, 5, 5, 5] });
    const data = sorted ? rowView(rows, { sort: [{ field: "x", order: "descending" }] }) : rows;
    const chart = await mount({
      marks: [point(data, { id: "pts", x: "x", y: "y", itemKey: "name", radius: 4 })],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const tag = button("k");
    anchor(chart, tag, { at: { item: { mark: "pts", item: ["k"] } }, side: "center" });
    await settle(chart);
    // The middle of the points at 1, 2, and 8.
    const box = boxIn(chart, tag);
    near(
      box.x + box.width / 2,
      (chart.toPixel(1, { axis: "x" })! + chart.toPixel(8, { axis: "x" })!) / 2,
    );
  });

  it("stay where a blur listener placed them again as they hide", async () => {
    const chart = await mount({
      marks: [line(values(), { x: "x", y: "y" })],
      interaction: { zoom: "x" },
    });
    const field = document.createElement("input");
    const held = anchor(chart, field, { at: { x: 1, y: 3 } });
    await settle(chart);
    field.focus();
    const again = () => {
      held.set({ at: { x: 7, y: 3 } });
      chart.render();
    };
    field.addEventListener("blur", again, { once: true });
    chart.setViewport([5, 9]);
    await settle(chart);
    expect(held.shown).toBe(true);
    const box = boxIn(chart, field);
    near(box.x + box.width / 2, chart.toPixel(7, { axis: "x" })!);
  });

  it("stands at a bar's outline, shown where only the outline is in view", async () => {
    const rows = table({ k: ["a", "b"], v: [9.8, 15] });
    const chart = await mount({
      marks: [
        bar(rows, { id: "bars", x: "k", y: "v", itemKey: "k", stroke: "#333", strokeWidth: 20 }),
      ],
      y: { domain: [10, 20] },
    });
    const [low, high] = [button("a"), button("b")];
    const shown = anchor(chart, low, { at: { item: { mark: "bars", item: ["a"] } } });
    anchor(chart, high, { at: { item: { mark: "bars", item: ["b"] } } });
    await settle(chart);
    expect(shown.shown).toBe(true);
    near(boxIn(chart, high).y + 20, chart.toPixel(15, { axis: "y" })! - 10);
  });

  it.each([
    ["in table order", false],
    ["in a view's own order", true],
  ])(
    "stand at a wide mark's bars of an item many rows share, of its own field, drawn %s",
    async (_, sorted) => {
      const rows = table({
        name: ["k", "k", "k", "j"],
        c: ["c1", "c2", "c3", "c4"],
        a: [2, 3, 4, 5],
        b: [3, 4, 5, 6],
      });
      const data = sorted ? rowView(rows, { sort: [{ field: "a", order: "descending" }] }) : rows;
      const chart = await mount({
        marks: [bar(data, { id: "bars", x: "c", y: ["a", "b"], itemKey: "name" })],
      });
      const [a, b, first, last] = [button("a"), button("b"), button("c1"), button("c3")];
      anchor(chart, a, { at: { item: { mark: "bars", item: ["a", "k"] } }, side: "center" });
      anchor(chart, b, { at: { item: { mark: "bars", item: ["b", "k"] } }, side: "center" });
      // The categories' middles, where points at them stand.
      anchor(chart, first, { at: { x: "c1", y: 0 }, side: "center" });
      anchor(chart, last, { at: { x: "c3", y: 0 }, side: "center" });
      await settle(chart);
      const middle = (tag: HTMLElement) => boxIn(chart, tag).x + boxIn(chart, tag).width / 2;
      // Each field's bars of "k", from c1 to c3, either side of their middle.
      expect(middle(a)).toBeLessThan(middle(b));
      near((middle(a) + middle(b)) / 2, (middle(first) + middle(last)) / 2);
    },
  );

  it("places a wide mark's item many rows share, drawn in a view's own order, in a few ms", async () => {
    const n = 20_000;
    const rows = table({
      k: new Float64Array(n).fill(1),
      t: Float64Array.from({ length: n }, (_, i) => i),
      a: Float64Array.from({ length: n }, (_, i) => 1 + (i % 7)),
      b: Float64Array.from({ length: n }, (_, i) => 2 + (i % 5)),
    });
    const view = rowView(rows, { sort: [{ field: "t", order: "descending" }] });
    const chart = await mount({
      renderer: "canvas",
      marks: [bar(view, { id: "bars", x: "t", y: ["a", "b"], itemKey: "k" })],
    });
    const options = { at: { item: { mark: "bars", item: ["a", 1] } } } as const;
    const held = anchor(chart, button("all"), options);
    await settle(chart);
    expect(held.shown).toBe(true);
    const boxes = AnchorItems.prototype.boxes;
    const times: number[] = [];
    const spy = vi.spyOn(AnchorItems.prototype, "boxes").mockImplementation(function (
      this: AnchorItems,
      ...args: Parameters<typeof boxes>
    ) {
      const start = performance.now();
      const found = boxes.apply(this, args);
      times.push(performance.now() - start);
      return found;
    });
    try {
      // Each `set` places again, the scene as it was.
      for (let k = 0; k < 6; k++) {
        held.set({ ...options });
        await frame();
      }
    } finally {
      spy.mockRestore();
    }
    expect(times.length).toBeGreaterThanOrEqual(5);
    // Searching every primitive's series for its row took over 100 ms here.
    expect(times.sort((x, y) => x - y)[times.length >> 1]).toBeLessThan(25);
  });

  it("finds a long table's observation in its own series", async () => {
    const rows = table({
      id: [1, 2, 3, 4, 5, 6],
      t: [0, 0, 1, 1, 2, 2],
      v: [1, 5, 2, 6, 3, 7],
      host: ["a", "b", "a", "b", "a", "b"],
    });
    const chart = await mount({
      marks: [line(rows, { id: "lines", x: "t", y: "v", series: "host", itemKey: "id" })],
    });
    const tag = button("4");
    anchor(chart, tag, { at: { item: { mark: "lines", item: [4] } }, side: "center" });
    await settle(chart);
    const box = boxIn(chart, tag);
    near(box.x + box.width / 2, chart.toPixel(1, { axis: "x" })!);
    near(box.y + box.height / 2, chart.toPixel(6, { axis: "y" })!);
  });

  it("place nothing again in a frame that only moves the cursor", async () => {
    const chart = await mount({
      marks: [point(values(), { id: "pts", x: "x", y: "y", itemKey: "x" })],
    });
    const boxes = vi.spyOn(AnchorItems.prototype, "boxes");
    try {
      anchor(chart, button(), { at: { item: { mark: "pts", item: [3] } } });
      await settle(chart);
      const placed = boxes.mock.calls.length;
      expect(placed).toBeGreaterThan(0);
      await hovered(chart, 100, 100);
      await hovered(chart, 140, 120);
      expect(boxes.mock.calls.length).toBe(placed);
      chart.setViewport([1, 7]);
      await frame();
      expect(boxes.mock.calls.length).toBeGreaterThan(placed);
    } finally {
      boxes.mockRestore();
    }
  });

  it("stands at a point's glyph as drawn, each side at its symbol's edge", async () => {
    const rows = table({ x: [5], y: [5], name: ["p"] });
    const chart = await mount({
      marks: [
        point(rows, { id: "pts", x: "x", y: "y", itemKey: "name", symbol: "triangle", radius: 30 }),
      ],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const sides = (["top", "bottom", "left", "right"] as const).map((side) => {
      const tag = button(side);
      return [
        side,
        tag,
        anchor(chart, tag, { at: { item: { mark: "pts", item: ["p"] } }, side }),
      ] as const;
    });
    await settle(chart);
    const glyph = chart.root.querySelector<SVGGraphicsElement>('[data-kind="point"]')!;
    const drawn = glyph.getBBox();
    const svg = boxIn(chart, glyph.ownerSVGElement!);
    const [left, top] = [svg.x + drawn.x, svg.y + drawn.y];
    for (const [side, tag] of sides) {
      const box = boxIn(chart, tag);
      if (side === "top") near(box.y + box.height, top, side);
      if (side === "bottom") near(box.y, top + drawn.height, side);
      if (side === "left") near(box.x + box.width, left, side);
      if (side === "right") near(box.x, left + drawn.width, side);
    }
    // Above the plot with its base reaching into it, it is shown; higher,
    // its base above the plot too, not.
    const plot = chart.getPanels()[0]!.plot;
    const above = (px: number) => 10 + (10 * px) / plot.height;
    rows.set("y", 0, above(20));
    await settle(chart);
    expect(sides.every(([, , held]) => held.shown)).toBe(true);
    rows.set("y", 0, above(top + drawn.height - chart.toPixel(5, { axis: "y" })! + 5));
    await settle(chart);
    expect(sides.some(([, , held]) => held.shown)).toBe(false);
  });

  it("anchors a heatmap's cell as a point at its categories, through zoom and resize", async () => {
    const cells = table({
      hour: [9, 10, 11, 9, 10, 11],
      day: ["Mon", "Mon", "Mon", "Tue", "Tue", "Tue"],
      v: [1, 2, 3, 4, 5, 6],
    });
    const into = host();
    const chart = await mount(
      { marks: [heatmap(cells, { x: "hour", y: "day", color: "v" })] },
      into,
    );
    const tag = button("Tue 10");
    anchor(chart, tag, { at: { x: 10, y: "Tue" }, side: "center" });
    await frame();
    const expectOnCell = async () => {
      const box = boxIn(chart, tag);
      const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
      // The cell under its centre is Tue 10's, centred there.
      const below = await hovered(chart, cx, box.y + box.height + 2);
      expect(below?.item).toBe(JSON.stringify([0, 10, "Tue"]));
      near(cx, below!.box.x + below!.box.width / 2);
      near(cy, below!.box.y + below!.box.height / 2);
    };
    await expectOnCell();
    chart.setViewport([9.5, 11.5]);
    await frame();
    await expectOnCell();
    into.style.width = "400px";
    await frame();
    await frame();
    await expectOnCell();
  });
});

describe("anchors during value transitions", () => {
  /** Frames and the clock from here on are the test's, as in animation.test.ts. */
  async function controlTime(...shown: Chart[]) {
    await frame();
    await frame();
    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
    for (const chart of shown) {
      chart.render();
      chart.root.dispatchEvent(new PointerEvent("pointerleave"));
    }
    vi.advanceTimersByTime(16);
  }
  const tick = (ms: number) => vi.advanceTimersByTime(ms);

  /** The box the bar chart's one bar is drawn at, from the chart's root. */
  function drawnBar(chart: Chart) {
    return boxIn(chart, chart.root.querySelector('[data-kind="rect"]')!);
  }

  it("follow a bar changing sign through zero length, with its axis moving", async () => {
    // Bars along y: the value axis' labels, below the plot, leave the plot where it is.
    const sales = table({ region: ["N"], v: [10] });
    const chart = await mount({
      animation: { values: true, duration: 300 },
      marks: [bar(sales, { id: "bars", orient: "y", y: "region", x: "v", itemKey: "region" })],
    });
    const item = { item: { mark: "bars", item: ["N"] } } as const;
    const left = button("left");
    const right = button("right");
    anchor(chart, left, { at: item, side: "left" });
    anchor(chart, right, { at: item, side: "right" });
    await settle(chart);
    await controlTime(chart);
    const domain = chart.getPanels()[0]!.x!.domain;
    sales.setColumn("v", [-10]);
    const lengths: number[] = [];
    for (let k = 0; k < 24; k++) {
      tick(16);
      const drawn = drawnBar(chart);
      near(boxIn(chart, left).x + 40, drawn.x, `left at ${k}`);
      near(boxIn(chart, right).x, drawn.x + drawn.width, `right at ${k}`);
      lengths.push(drawn.width);
    }
    // It passed through no length at all on its way, and ended as long as it began.
    expect(Math.min(...lengths)).toBeLessThan(16);
    expect(lengths[0]).toBeGreaterThan(100);
    near(lengths.at(-1)!, drawnBar(chart).width);
    expect(lengths.at(-1)).toBeGreaterThan(400);
    expect(chart.getPanels()[0]!.x!.domain).not.toEqual(domain);
  });

  it("hold a bubble's outline as its radius moves, the outline keeping its width", async () => {
    // Sizes 1 and 100, which swap: "p" grows from the smallest radius to the largest.
    const sizes = table({ name: ["p", "q"], t: [0.5, 1.5], v: [5, 5], s: [1, 100] });
    const chart = await mount({
      animation: { values: true, duration: 300 },
      marks: [
        point(sizes, {
          id: "pts",
          x: "t",
          y: "v",
          itemKey: "name",
          size: "s",
          radiusRange: [1, 40],
          strokeWidth: 10,
        }),
      ],
      x: { domain: [0, 2] },
      y: { domain: [0, 10] },
    });
    const tag = button("p");
    anchor(chart, tag, { at: { item: { mark: "pts", item: ["p"] } } });
    await settle(chart);
    await controlTime(chart);
    sizes.setColumn("s", [100, 1]);

    const radii: number[] = [];
    // Its glyph, without its outline (which Firefox's client boxes include): the point left
    // of the plot's middle, in the SVG's pixels, which are the root's.
    const middle = chart.toPixel(1, { axis: "x" })!;
    const dot = () =>
      [...chart.root.querySelectorAll<SVGGraphicsElement>('[data-kind="point"]')]
        .map((element) => element.getBBox())
        .find((box) => box.x + box.width / 2 < middle)!;
    for (let k = 0; k < 24; k++) {
      tick(16);
      radii.push(dot().height / 2);
      // Its bottom half the outline's width over the glyph's top, within a pixel.
      const off = boxIn(chart, tag).y + 20 - (dot().y - 5);
      expect(Math.abs(off), `top at ${k}`).toBeLessThanOrEqual(1);
    }
    // It moved through radii between.
    expect(radii.some((r) => r > 5 && r < 35)).toBe(true);
  });

  it("hold a line's observation at its destination while its trace moves", async () => {
    const data = table({ name: ["a", "b", "c"], t: [0, 1, 2], v: [1, 5, 2] });
    const chart = await mount({
      animation: { values: true, duration: 300 },
      marks: [line(data, { id: "l", x: "t", y: "v", itemKey: "name" })],
      y: { domain: [0, 10] },
    });
    const tag = button("b");
    anchor(chart, tag, { at: { item: { mark: "l", item: ["b"] } }, side: "center" });
    await settle(chart);
    await controlTime(chart);
    const path = () => chart.root.querySelector('[data-kind="line"]')?.getAttribute("d");
    const before = path();
    data.setColumn("v", [1, 9, 2]);
    tick(16);
    tick(100);
    // On its way, the line is neither where it was nor where it goes; the anchor is where it goes.
    expect(path()).not.toBe(before);
    const box = boxIn(chart, tag);
    near(box.y + box.height / 2, chart.toPixel(9, { axis: "y" })!);
    tick(400);
    near(boxIn(chart, tag).y + 10, chart.toPixel(9, { axis: "y" })!);
  });
});

describe("anchors' focus and input", () => {
  it("are reached by Tab after the chart's root, and keep their keys from the chart", async () => {
    const chart = await mount({ marks: [line(values(), { x: "x", y: "y" })] });
    // An input: WebKit leaves buttons out of the Tab order.
    const field = document.createElement("input");
    field.value = "note";
    anchor(chart, field, { at: { x: 3, y: 8 } });
    await frame();
    // Only what is inside takes focus: the wrapper is no stop of its own.
    expect(field.parentElement!.tabIndex).toBe(-1);
    chart.root.focus();
    const live = chart.root.querySelector("[aria-live]")!;
    await userEvent.keyboard("{ArrowRight}");
    await frame();
    const said = live.textContent;
    expect(said).not.toBe("");
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement).toBe(field);
    // Its arrow keys move its caret, not the chart's cursor.
    field.setSelectionRange(0, 0);
    await userEvent.keyboard("{ArrowRight}");
    await frame();
    expect(field.selectionStart).toBe(1);
    expect(live.textContent).toBe(said);
    // Back on the root, the keyboard moves the chart's cursor as before.
    chart.root.focus();
    await userEvent.keyboard("{ArrowRight}");
    await userEvent.keyboard("{ArrowRight}");
    await frame();
    expect(live.textContent).not.toBe(said);
  });

  it("take their own pointer input: the chart neither picks, pans, nor clicks through them", async () => {
    const chart = await mount({
      marks: [line(values(), { x: "x", y: "y" })],
      interaction: { zoom: "x" },
    });
    const peak = button();
    anchor(chart, peak, { at: { x: 3, y: 8 }, side: "center" });
    chart.setViewport([1, 7]);
    await frame();
    const clicks: unknown[] = [];
    const hovers: InputEvent[] = [];
    chart.on("click", (event) => clicks.push(event));
    chart.on("hover", (event) => hovers.push(event));
    let pressed = 0;
    peak.addEventListener("click", () => pressed++);
    const box = peak.getBoundingClientRect();
    const at = (dx: number) => ({
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: MOUSE,
      isPrimary: true,
      clientX: box.left + 20 + dx,
      clientY: box.top + 10,
    });
    peak.dispatchEvent(new PointerEvent("pointermove", at(0)));
    peak.dispatchEvent(new PointerEvent("pointerdown", at(0)));
    peak.dispatchEvent(new PointerEvent("pointermove", at(-80)));
    peak.dispatchEvent(new PointerEvent("pointerup", at(-80)));
    peak.click();
    peak.dispatchEvent(new WheelEvent("wheel", { ...at(0), ctrlKey: true, deltaY: -200 }));
    peak.dispatchEvent(new MouseEvent("dblclick", at(0)));
    await frame();
    expect(chart.getViewport().x).toEqual([1, 7]);
    expect(clicks).toEqual([]);
    expect(hovers.every((event) => event.target === undefined)).toBe(true);
    expect(pressed).toBe(1);
  });

  it.each([
    ["", false],
    [", its button stopping the press", true],
  ])(
    "leave another finger's pan alone: one pressed in an anchor neither moves nor ends it%s",
    async (_, stops) => {
      const chart = await mount({
        marks: [line(values(), { x: "x", y: "y" })],
        interaction: { zoom: "x" },
      });
      const peak = button();
      if (stops) peak.addEventListener("pointerdown", (event) => event.stopPropagation());
      anchor(chart, peak, { at: { x: 3, y: 8 }, side: "center" });
      chart.setViewport([1, 7]);
      await frame();
      const rect = chart.root.getBoundingClientRect();
      const plot = chart.getPanels()[0]!.plot;
      const box = peak.getBoundingClientRect();
      const finger = (id: number, x: number, y: number) => ({
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: id,
        pointerType: "touch",
        isPrimary: id === 11,
        clientX: x,
        clientY: y,
      });
      const [x, y] = [rect.left + plot.x + plot.width / 2, rect.top + plot.y + plot.height - 10];
      chart.root.dispatchEvent(new PointerEvent("pointerdown", finger(11, x, y)));
      chart.root.dispatchEvent(new PointerEvent("pointermove", finger(11, x + 40, y)));
      await frame();
      const panned = chart.getViewport().x;
      expect(panned).not.toEqual([1, 7]);
      // A second finger, down in the anchor, moves there, and over the plot once
      // the button lets go of it.
      const [ax, ay] = [box.left + 20, box.top + 10];
      peak.dispatchEvent(new PointerEvent("pointerdown", finger(12, ax, ay)));
      peak.dispatchEvent(new PointerEvent("pointermove", finger(12, ax - 80, ay)));
      await frame();
      expect(chart.getViewport().x).toEqual(panned);
      chart.root.dispatchEvent(new PointerEvent("pointermove", finger(12, x - 100, y)));
      await frame();
      expect(chart.getViewport().x).toEqual(panned);
      peak.dispatchEvent(new PointerEvent("pointerup", finger(12, ax - 80, ay)));
      // A button lets go of the finger it held, and the finger leaves the chart.
      peak.dispatchEvent(new PointerEvent("lostpointercapture", finger(12, ax - 80, ay)));
      peak.dispatchEvent(new PointerEvent("pointercancel", finger(12, ax - 80, ay)));
      chart.root.dispatchEvent(new PointerEvent("pointerleave", finger(12, ax - 80, ay)));
      // The first finger's pan goes on.
      chart.root.dispatchEvent(new PointerEvent("pointermove", finger(11, x + 80, y)));
      await frame();
      expect(chart.getViewport().x![0]).toBeLessThan(panned![0]!);
      chart.root.dispatchEvent(new PointerEvent("pointerup", finger(11, x + 80, y)));
    },
  );

  it("are left out of exports", async () => {
    const chart = await mount({ marks: [line(values(), { x: "x", y: "y" })] });
    const before = await chart.toPNG();
    const tag = button("ANCHORED");
    anchor(chart, tag, { at: { x: 3, y: 8 } });
    await frame();
    expect(chart.toSVG()).not.toContain("ANCHORED");
    const png = await chart.toPNG();
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(
      new Uint8Array(await before.arrayBuffer()),
    );
    const pdf = new TextDecoder("latin1").decode(renderToPDF(chart));
    expect(pdf).not.toContain("ANCHORED");
  });
});

describe("anchors' refusals", () => {
  /** What a chart told of, once the anchor's options were placed. */
  async function told(
    options: ChartOptions,
    anchored: Parameters<typeof anchor>[2],
  ): Promise<ChartError[]> {
    const errors: ChartError[] = [];
    const chart = await mount({ ...options, onError: (error) => errors.push(error) });
    const held = anchor(chart, button(), anchored);
    await settle(chart);
    await frame();
    expect(held.shown).toBe(false);
    return errors;
  }
  const lines = () => ({ marks: [line(values(), { id: "lines", x: "x", y: "y" })] });
  const messages = async (options: ChartOptions, anchored: Parameters<typeof anchor>[2]) =>
    (await told(options, anchored)).map((error) => error.message);

  it("refuse a second anchor of one element, in this chart or another", async () => {
    const chart = await mount(lines());
    const other = await mount(lines());
    const element = button();
    anchor(chart, element, { at: { x: 1, y: 1 } });
    expect(() => anchor(chart, element, { at: { x: 1, y: 1 } })).toThrow(
      "anchor element: anchored already, in this chart; move it with its anchor's set, or remove that anchor first",
    );
    expect(() => anchor(other, element, { at: { x: 1, y: 1 } })).toThrow(
      "anchor element: anchored already, in another chart; move it with its anchor's set, or remove that anchor first",
    );
    chart.destroy();
    expect(element.isConnected).toBe(false);
    expect(() => anchor(chart, button(), { at: { x: 1, y: 1 } })).toThrow(
      "anchor chart: the chart is destroyed; anchor in a mounted chart",
    );
    expect(() => anchor({} as Chart, button(), { at: { x: 1, y: 1 } })).toThrow(
      "anchor chart: expected a chart from createChart",
    );
  });

  it("tell of each row of the error table once, keeping the element hidden", async () => {
    const several = {
      marks: [
        line(values(), { x: "x", y: "y", panel: "North" }),
        line(values(), { x: "x", y: "y", panel: "South" }),
      ],
      panels: panels(columns([1, 1], [panel("North"), panel("South")])),
    };
    const faceted = {
      marks: [
        point(table({ x: [1, 2], y: [1, 2], region: ["eu", "us"], name: ["a", "a"] }), {
          id: "pts",
          x: "x",
          y: "y",
          itemKey: "name",
        }),
      ],
      facet: facet("region"),
    };
    const threshold = {
      marks: [...lines().marks, line(values(), { id: "threshold", x: "x", y: "y" })],
    };
    expect(await messages(lines(), { at: { x: 1 } as never })).toEqual([
      "anchor at.y: expected a value on the y axis, a category, or { fraction } or { px }; received undefined",
    ]);
    expect(await messages(lines(), { at: { x: 1, y: 1, item: "[0,1]" } as never })).toEqual([
      "anchor at: a point (x and y) or an item, not both; drop one",
    ]);
    const unknown = await told(threshold, { at: { item: { mark: "downtime", item: ["a"] } } });
    expect(unknown.map((e) => [e.code, e.message])).toEqual([
      [
        "unknown-reference",
        'anchor at.item: no mark "downtime" in the chart; marks with ids are "lines", "threshold"',
      ],
    ]);
    expect(await messages(several, { at: { x: 1, y: 1 }, panel: "West" })).toEqual([
      'anchor panel: no panel "West"; name one of "North", "South"',
    ]);
    expect(await messages(several, { at: { x: 1, y: 1 } })).toEqual([
      'anchor panel: the chart has several panels; name one of "North", "South"',
    ]);
    const named = {
      ...several,
      marks: [line(values(), { id: "north", x: "x", y: "y", panel: "North" })],
    };
    expect(
      await messages(named, { at: { item: { mark: "north", item: [] } }, panel: "West" }),
    ).toEqual(['anchor panel: no panel "West"; name one of "North", "South"']);
    expect(await messages(faceted, { at: { item: { mark: "pts", item: ["a"] } } })).toEqual([
      'anchor at.item: the item is drawn in panels "eu", "us"; name one with panel',
    ]);
    expect(await messages(lines(), { at: { x: "Tuesday", y: 1 } })).toEqual([
      'anchor at.x: "Tuesday" is a category, and the x axis holds numbers; give a number',
    ]);
    expect(await messages(lines(), { at: { x: 1, y: 1 }, side: "middle" as never })).toEqual([
      'anchor side: expected "top", "right", "bottom", "left", or "center"; received "middle"',
    ]);
    expect(await messages(lines(), { at: { x: 1, y: 1 }, align: "middle" as never })).toEqual([
      'anchor align: expected "start", "center", or "end"; received "middle"',
    ]);
    expect(await messages(lines(), { at: { x: 1, y: 1 }, offset: -2 })).toEqual([
      "anchor offset: expected pixels, 0 or more; received -2",
    ]);
    expect(await messages(lines(), { at: { item: "downtime" } })).toEqual([
      'anchor at.item: expected an item key from an event, or a reference ({ mark, item }); received "downtime"',
    ]);
    expect(await messages(lines(), { at: { x: { data: 1, scale: "z" }, y: 1 } })).toEqual([
      'anchor at.x.scale: the panel has no scale "z"; name "x", "y", "yRight", or one of the chart\'s scales',
    ]);
    const pies = {
      marks: [pie(table({ k: ["a", "b"], v: [1, 2] }), { category: "k", value: "v" })],
    };
    expect(await messages(pies, { at: { x: 1, y: 1 } })).toEqual([
      'anchor at: panel "" has no axes (a layout mark\'s); anchor at an item',
    ]);
  });

  it("tell of options refused again once set changes them", async () => {
    const errors: ChartError[] = [];
    const chart = await mount({ ...lines(), onError: (error) => errors.push(error) });
    const held = anchor(chart, button(), { at: { x: 1, y: 1 }, side: "middle" as never });
    await frame();
    await frame();
    expect(errors).toHaveLength(1);
    held.set({ at: { x: 1, y: 1 }, align: "middle" as never });
    await frame();
    expect(errors).toHaveLength(2);
    held.set({ at: { x: 1, y: 1 } });
    await frame();
    expect(held.shown).toBe(true);
  });
});

describe("anchors' memory", () => {
  it("let go of the wrapper once removed, and of the chart once destroyed, while its data and elements live", async () => {
    const data = values();
    const element = button();
    // Made in a function of their own, so that nothing on the stack holds them.
    const refs = await (async () => {
      const chart = createChart(host(), {
        renderer: "svg",
        marks: [point(data, { id: "pts", x: "x", y: "y", itemKey: "x" })],
      });
      const held = anchor(chart, element, { at: { x: 3, y: 8 } });
      const item = anchor(chart, button(), { at: { item: { mark: "pts", item: [3] } } });
      await settle(chart);
      expect(item.shown).toBe(true);
      const wrapper = new WeakRef(element.parentElement!);
      held.remove();
      await frame();
      chart.destroy();
      // Not holding its root: a destroyed chart's root keeps the chart, anchors or not.
      chart.root.parentElement?.remove();
      return { wrapper, chart: new WeakRef(chart) };
    })();
    for (let i = 0; i < 3; i++) {
      await frame();
      await collectGarbage();
    }
    // A handle holds its chart while the application keeps it; these were let go.
    expect([refs.wrapper.deref(), refs.chart.deref()]).toEqual([undefined, undefined]);
    // The table and the element outlive both.
    expect(data.length).toBe(10);
    expect(element.isConnected).toBe(false);
  });
});
