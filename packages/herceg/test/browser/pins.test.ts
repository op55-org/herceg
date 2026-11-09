// Pinned tooltips (`tooltip.pin`, `pin`): what a click, Enter, and the
// application pin, what they are pinned to (an item, or a value that
// follows zoom), what lets them go, their content's own input (links and
// buttons), and one click that both pins and selects.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { col } from "../../src/data/expr.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { columns, panel } from "../../src/layout.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { rug } from "../../src/marks/rug.ts";
import { placeAt, rowOf } from "../../src/marks/series.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { itemAt, keyedItem } from "../../src/model/keyboard.ts";
import { panels } from "../../src/model/panels.ts";
import { pinPayload } from "../../src/web/events.ts";
import { positionOf } from "../helpers/keyboard.ts";
import { MOUSE, modelOf } from "./helpers.ts";

let host: HTMLDivElement;
const charts: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  host.remove();
});

const data = () => table({ t: [0, 1, 2, 3, 4], v: [1, 3, 2, 5, 4], w: [2, 1, 4, 3, 5] });

async function mount(options: Partial<ChartOptions> = {}): Promise<Chart> {
  const chart = createChart(host, {
    errorMode: "throw",
    renderer: "svg",
    locale: "en-US",
    marks: [line(data(), { x: "t", y: ["v", "w"] })],
    tooltip: { pin: "click" },
    ...options,
  });
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

function heard<K extends keyof ChartEvents>(chart: Chart, type: K): ChartEvents[K][] {
  const events: ChartEvents[K][] = [];
  chart.on(type, (event) => events.push(event));
  return events;
}

/** The chart's pixel of data (x, y), in the page. */
function pixel(chart: Chart, x: number, y: number): [number, number] {
  const rect = chart.root.getBoundingClientRect();
  return [
    rect.left + chart.toPixel(x, { axis: "x" })!,
    rect.top + chart.toPixel(y, { axis: "y" })!,
  ];
}

/** A press released in place at the page's (x, y), on `target` (the chart's root by default). */
function clickAt(chart: Chart, [clientX, clientY]: [number, number], target: Element = chart.root) {
  for (const type of ["pointerdown", "pointerup"])
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: MOUSE, button: 0 }),
    );
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
}

const click = (chart: Chart, x: number, y: number) => clickAt(chart, pixel(chart, x, y));

function hover(chart: Chart, [clientX, clientY]: [number, number]) {
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX, clientY, pointerId: MOUSE }),
  );
  chart.render();
}

function key(target: Element, name: string) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );
}

/** The chart's own tooltip box: the first child of its root padded as tooltips are. */
const tooltipOf = (chart: Chart) =>
  [...chart.root.children].find(
    (child): child is HTMLDivElement =>
      child instanceof HTMLDivElement && child.style.padding === "8px 10px",
  )!;

describe("a click on what the tooltip shows", () => {
  it("pins it at the point's value, where it stays as the pointer moves on", async () => {
    const chart = await mount();
    const pins = heard(chart, "pin");
    click(chart, 3, 5);
    chart.render();
    expect(pins).toEqual([
      {
        at: { value: 3, axis: "x", panel: "" },
        inspection: expect.objectContaining({ axis: "x", value: 3 }),
        cause: "pointer",
        revision: chart.revision,
        basis: chart.basis,
      },
    ]);
    const tip = tooltipOf(chart);
    expect(tip.style.display).toBe("block");
    expect(tip.style.pointerEvents).toBe("auto");
    expect(tip.getAttribute("role")).toBe("group");
    expect(tip.hasAttribute("aria-hidden")).toBe(false);
    const text = tip.textContent;
    // The pointer elsewhere moves its crosshair, not the pinned tooltip.
    hover(chart, pixel(chart, 1, 3));
    expect(tip.textContent).toBe(text);
    expect(tip.style.display).toBe("block");
  });

  it("pins the value its own inspection reads, not the row of the line it picked", async () => {
    // A dip at t = 200 between plateaus. A click 2.7 steps right of its foot is within reach of
    // the dip's steep sides, whose rows are 200 and its neighbors; the inspection there, which
    // the tooltip shows, reads t = 203.
    const t = Float64Array.from({ length: 401 }, (_, i) => i);
    const v = Float64Array.from(t, (i) => (i === 200 ? 0 : 100));
    const chart = await mount({
      marks: [line(table({ t, v }), { x: "t", y: "v" })],
      x: { domain: [0, 400] },
      y: { domain: [0, 100] },
      inspection: { mode: "nearest-x" },
    });
    const pins = heard(chart, "pin");
    const clicks = heard(chart, "click");
    const [x, y] = pixel(chart, 200, 0);
    const step = chart.toPixel(1, { axis: "x" })! - chart.toPixel(0, { axis: "x" })!;
    expect(2.7 * step).toBeLessThan(4);
    clickAt(chart, [x + 2.7 * step, y]);
    const clicked = clicks[0]!;
    expect(clicked.target?.kind).toBe("item");
    expect((clicked.target as { row?: number }).row).not.toBe(203);
    expect(clicked.inspection?.value).toBe(203);
    expect(pins.map(({ at }) => at)).toEqual([{ value: 203, axis: "x", panel: "" }]);
    expect(pins[0]?.inspection?.value).toBe(203);
  });

  it("pins at a point of any series, those sharing another's positions too", async () => {
    const chart = await mount();
    const pins = heard(chart, "pin");
    const clicks = heard(chart, "click");
    // w's point at t = 2; v's is at 2.
    click(chart, 2, 4);
    const target = clicks[0]!.target as { kind: "item"; item: string; series?: string };
    expect(target.series).toMatch(/"w"/);
    expect(pins.map(({ at }) => at)).toEqual([{ value: 2, axis: "x", panel: "" }]);
    chart.pin(null);
    chart.pin({ item: target.item });
    expect(chart.pinned).toEqual({ value: 2, axis: "x", panel: "" });
  });

  it("pins a rug's tick, whatever order the rug keeps its rows in", async () => {
    // A rug draws its ticks in value order: 3, its first row, is its last tick.
    const chart = await mount({ marks: [rug(table({ v: [3, 1, 2] }), { x: "v" })] });
    const pins = heard(chart, "pin");
    const model = modelOf(chart);
    const tick = positionOf(model, model.series()[0]!.key, 2)!.points[0]!;
    expect(tick.value).toBe(3);
    const rect = chart.root.getBoundingClientRect();
    clickAt(chart, [rect.left + tick.px, rect.top + tick.py]);
    chart.render();
    expect(pins.map(({ at }) => at)).toEqual([{ value: 3, axis: "x", panel: "" }]);
  });

  it("pins a rug's tick on a log axis, which reads no tick at -1, its view's filter or not", async () => {
    // The rug draws -1 (off the axis) but reads only 1 and 2: 2 is drawn
    // third and read second. The view leaves 5 out.
    const values = table({ v: [-1, 5, 1, 2] });
    for (const data of [
      table({ v: [-1, 1, 2] }),
      rowView(values, { filter: ["<", ["field", "v"], 5] }),
    ]) {
      const chart = await mount({ marks: [rug(data, { x: "v" })], x: { type: "log" } });
      const pins = heard(chart, "pin");
      const model = modelOf(chart);
      const tick = positionOf(model, model.series()[0]!.key, 1)!.points[0]!;
      expect(tick.value).toBe(2);
      const rect = chart.root.getBoundingClientRect();
      clickAt(chart, [rect.left + tick.px, rect.top + tick.py]);
      chart.render();
      expect(pins.map(({ at }) => at)).toEqual([{ value: 2, axis: "x", panel: "" }]);
      chart.destroy();
    }
  });

  it("lets it go on a second click there, a click off the data, or one outside the chart", async () => {
    const chart = await mount();
    const pins = heard(chart, "pin");
    click(chart, 3, 5);
    click(chart, 3, 5);
    expect(pins.map(({ at, cause }) => [at, cause])).toEqual([
      [{ value: 3, axis: "x", panel: "" }, "pointer"],
      [null, "pointer"],
    ]);
    click(chart, 1, 3);
    // Off the data: a plot where no item is.
    click(chart, 1.5, 4.6);
    expect(pins.at(-1)?.at).toBeNull();
    click(chart, 2, 2);
    expect(pins.at(-1)?.at).toEqual({ value: 2, axis: "x", panel: "" });
    // A press anywhere outside the chart.
    document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(pins.at(-1)).toMatchObject({ at: null, cause: "pointer" });
    chart.render();
    expect(tooltipOf(chart).style.pointerEvents).toBe("none");
    expect(tooltipOf(chart).getAttribute("aria-hidden")).toBe("true");
  });

  it("lets it go on Escape, the focus back on the chart", async () => {
    const chart = await mount({
      renderTooltip: () => {
        const link = document.createElement("a");
        link.href = "#detail";
        link.textContent = "Details";
        return link;
      },
    });
    const pins = heard(chart, "pin");
    click(chart, 3, 5);
    chart.render();
    const link = tooltipOf(chart).querySelector("a")!;
    link.focus();
    expect(document.activeElement).toBe(link);
    key(link, "Escape");
    expect(pins.at(-1)).toMatchObject({ at: null, cause: "keyboard" });
    expect(document.activeElement).toBe(chart.root);
  });

  it("keeps the focus in its content as the content is drawn again", async () => {
    const rows = data();
    let again: HTMLAnchorElement | undefined;
    const chart = await mount({
      marks: [line(rows, { x: "t", y: ["v", "w"] })],
      renderTooltip: (inspection) => {
        if (again) return again;
        const link = document.createElement("a");
        link.href = `#detail-${inspection.points[0]!.text}`;
        link.textContent = "Details";
        return link;
      },
    });
    click(chart, 3, 5);
    chart.render();
    const tip = tooltipOf(chart);
    tip.querySelector("a")!.focus();
    // New content: the focus goes to the tooltip, still pinned.
    rows.replace(3, { v: [9] });
    chart.render();
    expect(document.activeElement).toBe(tip);
    // The same control given again keeps it.
    again = tip.querySelector("a")!;
    again.focus();
    rows.replace(3, { v: [8] });
    chart.render();
    expect(document.activeElement).toBe(again);
  });

  it("leaves the wheel over its content to the content", async () => {
    const chart = await mount({
      interaction: { zoom: "x" },
      renderTooltip: () => {
        const list = document.createElement("div");
        list.textContent = "Rows";
        return list;
      },
    });
    click(chart, 3, 5);
    chart.render();
    const content = tooltipOf(chart).firstElementChild!;
    const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaX: 40 });
    content.dispatchEvent(wheel);
    chart.render();
    expect(wheel.defaultPrevented).toBe(false);
    expect(chart.getViewport().x).toBeNull();
  });

  it("leaves its content's own clicks to it, and clicks nothing of the chart's", async () => {
    // A3's button attached to a point, as content of the pinned tooltip.
    let pressed = 0;
    const chart = await mount({
      renderTooltip: (inspection) => {
        const button = document.createElement("button");
        button.textContent = `Open ${inspection.label}`;
        button.addEventListener("click", () => pressed++);
        return button;
      },
    });
    const clicks = heard(chart, "click");
    const pins = heard(chart, "pin");
    click(chart, 3, 5);
    chart.render();
    expect(clicks).toHaveLength(1);
    const button = tooltipOf(chart).querySelector("button")!;
    const box = button.getBoundingClientRect();
    clickAt(chart, [box.left + box.width / 2, box.top + box.height / 2], button);
    button.click();
    expect(pressed).toBeGreaterThan(0);
    // Neither a chart click nor a change of the pin.
    expect(clicks).toHaveLength(1);
    expect(pins).toHaveLength(1);
    expect(tooltipOf(chart).querySelector("button")?.textContent).toMatch(/^Open/);
  });
});

describe("in a shadow root", () => {
  /** A press released in place on `target`, composed, as the browser's own cross shadow roots. */
  const pressOn = (target: Element, [clientX, clientY]: [number, number]) => {
    for (const type of ["pointerdown", "pointerup"])
      target.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          composed: true,
          clientX,
          clientY,
          pointerId: MOUSE,
          button: 0,
        }),
      );
    target.dispatchEvent(
      new MouseEvent("click", { bubbles: true, composed: true, clientX, clientY }),
    );
  };

  it("is let go by presses outside the chart, not in its content, open or closed, nested", async () => {
    // Shadow roots from the page in: one open, one closed, a closed one around an open one.
    for (const modes of [["open"], ["closed"], ["closed", "open"]] as const) {
      const mode = modes.join(" > ");
      const outer = document.createElement("div");
      document.body.append(outer);
      const elsewhere: HTMLElement[] = [];
      let shadow: ShadowRoot | undefined;
      for (const kind of modes) {
        const holder = shadow ? document.createElement("div") : outer;
        shadow?.append(holder);
        shadow = holder.attachShadow({ mode: kind });
        const button = document.createElement("button");
        shadow.append(button);
        elsewhere.push(button);
      }
      const inner = document.createElement("div");
      inner.style.cssText = "width:600px;height:300px";
      shadow!.prepend(inner);
      try {
        const chart = createChart(inner, {
          renderer: "svg",
          locale: "en-US",
          marks: [line(data(), { x: "t", y: ["v", "w"] })],
          tooltip: { pin: "click" },
          renderTooltip: () => {
            const button = document.createElement("button");
            button.textContent = "Open";
            return button;
          },
        });
        charts.push(chart);
        for (let loading = chart.loading; loading; loading = chart.loading) await loading;
        chart.render();
        const pins = heard(chart, "pin");
        pressOn(chart.root, pixel(chart, 3, 5));
        chart.render();
        const button = tooltipOf(chart).querySelector("button")!;
        const box = button.getBoundingClientRect();
        pressOn(button, [box.left + 2, box.top + 2]);
        expect(
          pins.map(({ at }) => at !== null),
          mode,
        ).toEqual([true]);
        // A press in each shadow root around the chart, then on the page.
        for (const target of [...elsewhere, document.body]) {
          pressOn(target, [0, 0]);
          expect(pins.at(-1)!.at, mode).toBeNull();
          pressOn(chart.root, pixel(chart, 3, 5));
          expect(pins.at(-1)!.at, mode).not.toBeNull();
        }
      } finally {
        outer.remove();
      }
    }
  });
});

describe("a dashboard", () => {
  it("drills through a pinned tooltip's link, and pins its other charts from its own state", async () => {
    // The study's dashboard: synced cursors, a click pins with a link to
    // the detail page, and the application pins the other chart there too.
    const group = `dashboard-${Math.random()}`;
    const opened: string[] = [];
    const options = (): Partial<ChartOptions> => ({
      interaction: { sync: { cursor: group } },
      renderTooltip: (inspection) => {
        const link = document.createElement("a");
        link.href = `#detail-${inspection.value}`;
        link.textContent = "Open in detail";
        link.addEventListener("click", (event) => {
          event.preventDefault();
          opened.push(link.hash);
        });
        return link;
      },
    });
    const sales = await mount(options());
    const second = document.createElement("div");
    second.style.cssText = "width:600px;height:300px";
    host.after(second);
    const costs = createChart(second, {
      errorMode: "throw",
      renderer: "svg",
      marks: [line(data(), { x: "t", y: "w" })],
      tooltip: { pin: "click" },
      ...options(),
    });
    charts.push(costs);
    for (let loading = costs.loading; loading; loading = costs.loading) await loading;
    try {
      sales.on("pin", ({ at, cause }) => {
        if (cause !== "api") costs.pin(at && "value" in at ? { value: at.value, axis: "x" } : null);
      });
      click(sales, 2, 2);
      sales.render();
      costs.render();
      expect(costs.pinned).toMatchObject({ value: 2, axis: "x" });
      // The other chart's cursor, synced, moves on; the pins stay.
      hover(costs, pixel(costs, 4, 5));
      sales.render();
      expect(sales.pinned).toMatchObject({ value: 2 });
      const link = tooltipOf(sales).querySelector("a")!;
      link.click();
      expect(opened).toEqual(["#detail-2"]);
      expect(sales.pinned).toMatchObject({ value: 2 });
      // Escape in the first lets its pin go, and the application the other's.
      key(link, "Escape");
      expect([sales.pinned, costs.pinned]).toEqual([null, null]);
    } finally {
      second.remove();
    }
  });
});

describe("a pin's place", () => {
  it("is a value along x, which hides while out of view and shows again with it", async () => {
    const chart = await mount({ interaction: { zoom: "x" } });
    click(chart, 3, 5);
    chart.render();
    const tip = tooltipOf(chart);
    expect(tip.style.display).toBe("block");
    chart.setViewport({ x: [0, 1.5] });
    chart.render();
    expect(tip.style.display).toBe("none");
    chart.setViewport({ x: [2, 4] });
    chart.render();
    expect(tip.style.display).toBe("block");
    // Placed where 3 is drawn now.
    const at = chart.toPixel(3, { axis: "x" })!;
    const box = tip.getBoundingClientRect();
    const root = chart.root.getBoundingClientRect();
    expect(Math.abs(box.left - root.left - at)).toBeLessThan(box.width + 20);
  });

  it("shows no tooltip of the pointer's while it is out of view", async () => {
    const chart = await mount({ interaction: { zoom: "x" } });
    click(chart, 1, 3);
    hover(chart, pixel(chart, 3, 5));
    chart.setViewport({ x: [2, 4] });
    chart.render();
    const tip = tooltipOf(chart);
    expect(tip.style.display).toBe("none");
  });

  it("hides an item pinned while it is zoomed out of view", async () => {
    const chart = await mount({
      inspection: { mode: "nearest" },
      interaction: { zoom: "x" },
      marks: [point(data(), { id: "dots", x: "t", y: "v" })],
    });
    const pins = heard(chart, "pin");
    click(chart, 1, 3);
    chart.render();
    const tip = tooltipOf(chart);
    expect(tip.style.display).toBe("block");
    chart.setViewport({ x: [2, 4] });
    chart.render();
    expect(tip.style.display).toBe("none");
    chart.setViewport({ x: [0, 4] });
    chart.render();
    expect(tip.style.display).toBe("block");
    expect(pins).toHaveLength(1);
  });

  it("reads every series at its value again as data changes", async () => {
    const rows = data();
    const chart = await mount({ marks: [line(rows, { x: "t", y: ["v", "w"] })] });
    const pins = heard(chart, "pin");
    click(chart, 2, 2);
    const before = tooltipOf(chart).textContent;
    rows.replace(2, { v: [9] });
    chart.render();
    expect(tooltipOf(chart).textContent).not.toBe(before);
    expect(pins).toHaveLength(1);
  });

  it("is the item with inspection 'nearest', followed through appends, let go once dropped", async () => {
    const rows = table({ t: [0, 1, 2, 3, 4], v: [1, 3, 2, 5, 4] });
    const chart = await mount({
      inspection: { mode: "nearest" },
      marks: [point(rows, { id: "dots", x: "t", y: "v" })],
    });
    const pins = heard(chart, "pin");
    click(chart, 1, 3);
    const [pinned] = pins;
    expect(pinned!.at).toEqual({ item: expect.stringMatching(/^\["dots",/), panel: "" });
    expect(pinned!.inspection?.points.map(({ text }) => text)).toEqual(["3"]);
    rows.append({ t: [5], v: [7] });
    chart.render();
    expect(pins).toHaveLength(1);
    expect(tooltipOf(chart).textContent).toContain("3");
    // The row it follows is dropped: the pin goes with it.
    rows.dropFirst(2);
    chart.render();
    expect(pins.at(-1)).toMatchObject({ at: null, cause: "data" });
  });

  it("is the item by its key, whichever row has it after the data is reset", async () => {
    const rows = table({ t: [0, 1, 2, 3, 4], v: [1, 3, 2, 5, 4] });
    const chart = await mount({
      inspection: { mode: "nearest" },
      marks: [point(rows, { id: "dots", x: "t", y: "v", itemKey: "t" })],
    });
    const pins = heard(chart, "pin");
    chart.pin({ item: { mark: "dots", item: [3] } });
    chart.render();
    // New rows, one of them keyed 3: the pin stays on it.
    rows.reset({ t: [3, 4, 5], v: [6, 4, 2] });
    chart.render();
    expect(pins).toHaveLength(1);
    expect(tooltipOf(chart).textContent).toContain("6");
    // Its row keyed otherwise now: no item is keyed 3, and the pin goes.
    rows.set("t", 0, 30);
    chart.render();
    expect(pins.at(-1)).toMatchObject({ at: null, cause: "data" });
  });

  it("is a heatmap's cell, at its place as the keyboard's cursor is, though new rows fill it", async () => {
    const cells = table({ x: [0, 1], y: [0, 0], v: [1, 2] });
    const chart = await mount({
      inspection: { mode: "nearest" },
      marks: [heatmap(cells, { id: "cells", x: "x", y: "y", color: "v" })],
    });
    const pins = heard(chart, "pin");
    const model = modelOf(chart);
    const { key } = model.series()[0]!;
    const cell = positionOf(model, key, 1)!.points[0]!;
    const rect = chart.root.getBoundingClientRect();
    clickAt(chart, [rect.left + cell.px, rect.top + cell.py]);
    chart.render();
    expect(pins).toHaveLength(1);
    // The keyboard's cursor on the same cell is kept by its place.
    const cursor = keyedItem(model, "", key, 1, { placeAt, rowOf });
    expect(pins[0]!.inspection?.points.map(({ value }) => value)).toEqual([2]);
    // A refresh: new rows at the same places.
    cells.dropFirst(2);
    cells.append({ x: [0, 1], y: [0, 0], v: [3, 4] });
    chart.render();
    expect(itemAt(model, "", key, 1, cursor!, { placeAt, rowOf })).toBe(1);
    expect(pins).toHaveLength(1);
    expect(chart.pinned).toEqual(pins[0]!.at);
    expect(tooltipOf(chart).style.display).toBe("block");
    expect(tooltipOf(chart).textContent).toContain("4");
  });

  it("is its item still once a selection listener sorts its view, and goes once it filters it out", async () => {
    const rows = table({ t: [0, 1, 2, 3, 4], v: [10, 30, 20, 50, 40] });
    for (const query of [
      { sort: [{ field: "v" as const, order: "descending" as const }] },
      { filter: col("t").ne(1) },
    ]) {
      const view = rowView(rows);
      const chart = await mount({
        inspection: { mode: "nearest" },
        interaction: { select: "items" },
        marks: [point(view, { id: "dots", x: "t", y: "v", itemKey: "t" })],
      });
      chart.on("select", () => view.setQuery(query));
      click(chart, 1, 30);
      chart.render();
      chart.render();
      if ("sort" in query) {
        expect(chart.pinned).toEqual({ item: '["dots",1]', panel: "" });
        expect(tooltipOf(chart).textContent).toContain("30");
      } else expect(chart.pinned).toBeNull();
      chart.destroy();
    }
  });

  it("is a value along y where the chart inspects along y", async () => {
    const chart = await mount({
      inspection: { mode: "nearest-y" },
      marks: [line(data(), { x: "t", y: "v" })],
    });
    const pins = heard(chart, "pin");
    click(chart, 3, 5);
    expect(pins[0]!.at).toMatchObject({ axis: "y", panel: "" });
    expect((pins[0]!.at as { value: number }).value).toBeCloseTo(5, 5);
    chart.pin({ value: 2 });
    expect(chart.pinned).toEqual({ value: 2, axis: "y", panel: "" });
  });

  it("is nothing along y at a point the inspection along y does not read, on the right axis", async () => {
    const both = table({
      t: [0, 1, 2, 3, 4],
      left: [10, 30, 20, 50, 40],
      right: [100, 300, 200, 500, 400],
    });
    const chart = await mount({
      inspection: { mode: "nearest-y" },
      marks: [line(both, { x: "t", y: "left" }), line(both, { x: "t", y: "right", axis: "right" })],
    });
    const pins = heard(chart, "pin");
    const rect = chart.root.getBoundingClientRect();
    clickAt(chart, [
      rect.left + chart.toPixel(1, { axis: "x" })!,
      rect.top + chart.toPixel(300, { axis: "yRight" })!,
    ]);
    expect(pins).toEqual([]);
    expect(chart.pinned).toBeNull();
    // With the left axis' series hidden, its axis still holds pins along y.
    chart.setHiddenKeys(['[0,"left"]']);
    chart.render();
    expect(chart.getHiddenKeys()).toHaveLength(1);
    clickAt(chart, [
      rect.left + chart.toPixel(1, { axis: "x" })!,
      rect.top + chart.toPixel(300, { axis: "yRight" })!,
    ]);
    expect(pins).toEqual([]);
    expect(chart.pinned).toBeNull();
  });

  it("is nothing at an item the inspection at its value does not read, a heatmap's cell", async () => {
    const cells = table({ t: [0, 1, 2, 3, 4], v: [1, 3, 2, 5, 4], c: [1, 2, 3, 4, 5] });
    const chart = await mount({
      inspection: { mode: "nearest-x" },
      marks: [
        heatmap(cells, { id: "cells", x: "t", y: "v", color: "c" }),
        line(data(), { x: "t", y: "w" }),
      ],
    });
    const pins = heard(chart, "pin");
    const clicks = heard(chart, "click");
    click(chart, 3, 5);
    expect((clicks[0]!.target as { markId?: string } | undefined)?.markId).toBe("cells");
    expect(pins).toEqual([]);
    // Alone, the cells are read where they are: still no value to pin.
    chart.setHiddenKeys(['[1,"w"]']);
    chart.render();
    expect(chart.getHiddenKeys()).toHaveLength(1);
    click(chart, 1, 3);
    expect(pins).toEqual([]);
  });

  it("says in JSON that a value along y is a time on the right axis alone", async () => {
    const day = Date.UTC(2026, 0, 1);
    const chart = await mount({
      inspection: { mode: "nearest-y" },
      yRight: { type: "time" },
      marks: [
        line(table({ t: [0, 4], when: [day, day + 4 * 864e5] }), {
          x: "t",
          y: "when",
          axis: "right",
        }),
      ],
    });
    chart.pin({ value: day + 2 * 864e5 });
    expect(chart.pinned).toMatchObject({ axis: "y" });
    expect(pinPayload(chart, chart.pinned)).toMatchObject({ axis: "y", time: true });
  });

  it("is let go when the inspection's mode changes", async () => {
    const chart = await mount();
    const pins = heard(chart, "pin");
    click(chart, 3, 5);
    chart.update({ inspection: { mode: "nearest" } });
    expect(pins.at(-1)).toMatchObject({ at: null, cause: "options" });
  });
});

describe("the keyboard", () => {
  it("pins with Enter on its cursor, the focus moving into the tooltip; Escape lets it go", async () => {
    const chart = await mount({
      renderTooltip: () => {
        const link = document.createElement("a");
        link.href = "#detail";
        link.textContent = "Details";
        return link;
      },
    });
    const pins = heard(chart, "pin");
    chart.root.focus();
    key(chart.root, "ArrowRight");
    chart.render();
    key(chart.root, "Enter");
    chart.render();
    expect(pins).toHaveLength(1);
    expect(pins[0]).toMatchObject({ cause: "keyboard", at: { value: 0, axis: "x", panel: "" } });
    expect(tooltipOf(chart).contains(document.activeElement)).toBe(true);
    key(document.activeElement!, "Escape");
    expect(pins.at(-1)).toMatchObject({ at: null, cause: "keyboard" });
    expect(document.activeElement).toBe(chart.root);
  });

  it("pins with Enter the rug tick its cursor is on, whatever order the rug keeps its rows in", async () => {
    const chart = await mount({ marks: [rug(table({ v: [3, 1, 2] }), { x: "v" })] });
    const pins = heard(chart, "pin");
    chart.root.focus();
    key(chart.root, "ArrowRight");
    key(chart.root, "End");
    chart.render();
    key(chart.root, "Enter");
    chart.render();
    expect(pins.map(({ at }) => at)).toEqual([{ value: 3, axis: "x", panel: "" }]);
  });
});

describe("pin()", () => {
  it("pins from the application, as a click would, reported with cause api", async () => {
    const chart = await mount();
    const pins = heard(chart, "pin");
    chart.pin({ value: 2 });
    expect(chart.pinned).toEqual({ value: 2, axis: "x", panel: "" });
    expect(pins).toEqual([expect.objectContaining({ cause: "api", at: chart.pinned })]);
    chart.render();
    expect(tooltipOf(chart).style.display).toBe("block");
    chart.pin(null);
    expect(chart.pinned).toBeNull();
    expect(pins.at(-1)).toMatchObject({ at: null, cause: "api" });
  });

  it("waits for the chart's first frame and interaction code, then pins", async () => {
    const chart = createChart(host, {
      renderer: "svg",
      marks: [line(data(), { x: "t", y: "v" })],
    });
    charts.push(chart);
    const pins = heard(chart, "pin");
    chart.pin({ value: 1 });
    expect(chart.pinned).toEqual({ value: 1 });
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    expect(pins).toEqual([expect.objectContaining({ cause: "api" })]);
    expect(chart.pinned).toEqual({ value: 1, axis: "x", panel: "" });
  });

  it("lets a pin that waited go, said so, where nothing reads at its value", async () => {
    const chart = createChart(host, {
      renderer: "svg",
      inspection: { mode: "nearest-x", within: 0 },
      marks: [line(data(), { x: "t", y: "v" })],
    });
    charts.push(chart);
    const pins = heard(chart, "pin");
    chart.pin({ value: 1.5 });
    expect(chart.pinned).toEqual({ value: 1.5 });
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    expect(pins).toEqual([expect.objectContaining({ at: null, cause: "api" })]);
    expect(chart.pinned).toBeNull();
  });

  it("pins an item by its reference, and refuses what the chart does not draw", async () => {
    const chart = await mount({
      inspection: { mode: "nearest" },
      marks: [point(data(), { id: "dots", x: "t", y: "v", itemKey: "t" })],
    });
    chart.pin({ item: { mark: "dots", item: [3] } });
    expect(chart.pinned).toEqual({ item: '["dots",3]', panel: "" });
    expect(() => chart.pin({ item: '["dots",99]' })).toThrow(
      'pin item: "[\\"dots\\",99]" is no item the chart draws; give a key from an event',
    );
    expect(() => chart.pin({ value: 1, panel: "West" })).toThrow(
      'pin panel: "West" is no panel of the chart',
    );
    expect(() => chart.pin({ item: { mark: "nope", item: [1] } })).toThrow(
      'pin item: no mark has the id "nope"',
    );
  });

  it("reports a pin again only when it changes", async () => {
    const chart = await mount();
    const pins = heard(chart, "pin");
    click(chart, 3, 5);
    const revision = chart.revision;
    chart.pin(chart.pinned ?? null);
    chart.pin({ value: 3 });
    expect(pins).toHaveLength(1);
    expect(chart.revision).toBe(revision);
    // A listener writing back what it is told ends there.
    chart.on("pin", ({ at }) => chart.pin(at));
    chart.pin({ value: 1 });
    expect(pins).toHaveLength(2);
  });

  it("pins nothing at a value nothing reads there, and reports nothing", async () => {
    const chart = await mount({ inspection: { mode: "nearest-x", within: 0 } });
    const pins = heard(chart, "pin");
    chart.pin({ value: 1.5 });
    chart.render();
    expect(pins).toEqual([]);
    expect(chart.pinned).toBeNull();
    // Where something is pinned, it lets that go.
    chart.pin({ value: 2 });
    chart.pin({ value: 2.5 });
    expect(pins.map(({ at, revision }) => [at, revision])).toEqual([
      [{ value: 2, axis: "x", panel: "" }, pins[0]!.revision],
      [null, pins[0]!.revision + 1],
    ]);
    expect(chart.pinned).toBeNull();
  });

  it("refuses writes on a basis while a pin given before the chart can show it waits", async () => {
    const chart = createChart(host, {
      renderer: "svg",
      marks: [line(data(), { x: "t", y: "v" })],
    });
    charts.push(chart);
    const basis = chart.basis;
    chart.pin({ value: 1 });
    chart.pin(null, { expected: basis });
    expect(chart.pinned).toEqual({ value: 1 });
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    expect(chart.pinned).toEqual({ value: 1, axis: "x", panel: "" });
  });

  it("refuses a write on an older basis once the pin changed since", async () => {
    const chart = await mount();
    const basis = chart.basis;
    click(chart, 3, 5);
    const pins = heard(chart, "pin");
    chart.pin(null, { expected: basis });
    expect(chart.pinned).toEqual({ value: 3, axis: "x", panel: "" });
    // The pin as it is, reported again.
    expect(pins.at(-1)).toMatchObject({ cause: "api", at: chart.pinned });
  });
});

describe("one activation, one decision", () => {
  it("pins and selects the same item with one click", async () => {
    const chart = await mount({
      inspection: { mode: "nearest" },
      interaction: { select: "items" },
      marks: [point(data(), { id: "dots", x: "t", y: "v", itemKey: "t" })],
    });
    const pins = heard(chart, "pin");
    const selections = heard(chart, "select");
    click(chart, 3, 5);
    expect(selections.map(({ selection }) => selection)).toEqual([
      { kind: "items", items: ['["dots",3]'] },
    ]);
    expect(pins.map(({ at }) => at)).toEqual([{ item: '["dots",3]', panel: "" }]);
  });

  it("clears a brush with a click off the data, as without pins", async () => {
    const chart = await mount({ interaction: { brush: "x" } });
    chart.select({ kind: "brush", x: [1, 2], y: null, lasso: null });
    click(chart, 1.5, 4.6);
    expect(chart.selection).toBeNull();
  });

  it("pins nothing for a chart a selection listener destroyed", async () => {
    const chart = await mount({
      inspection: { mode: "nearest" },
      interaction: { select: "items" },
      marks: [point(data(), { id: "dots", x: "t", y: "v" })],
    });
    const pins = heard(chart, "pin");
    const listening = { count: 0 };
    const add = document.addEventListener;
    const remove = document.removeEventListener;
    document.addEventListener = function (this: Document, ...args: Parameters<typeof add>) {
      if (args[0] === "pointerdown") listening.count++;
      return add.apply(this, args);
    } as typeof add;
    document.removeEventListener = function (this: Document, ...args: Parameters<typeof remove>) {
      if (args[0] === "pointerdown") listening.count--;
      return remove.apply(this, args);
    } as typeof remove;
    try {
      chart.on("select", () => chart.destroy());
      click(chart, 3, 5);
    } finally {
      document.addEventListener = add;
      document.removeEventListener = remove;
    }
    expect(pins).toEqual([]);
    expect(listening.count).toBeLessThanOrEqual(0);
  });

  it("pins nothing a selection listener's options made mean another thing", async () => {
    const chart = await mount({
      inspection: { mode: "nearest-x" },
      interaction: { select: "items" },
      marks: [point(data(), { id: "dots", x: "t", y: "v", itemKey: "t" })],
    });
    const pins = heard(chart, "pin");
    click(chart, 1, 3);
    expect(chart.pinned).toEqual({ value: 1, axis: "x", panel: "" });
    chart.on("select", () => chart.update({ inspection: { mode: "nearest" } }));
    click(chart, 3, 5);
    expect(chart.pinned).toBeNull();
    expect(pins.at(-1)).toMatchObject({ at: null, cause: "options" });
  });

  it("drills a tree, and does nothing else; selects and pins a leaf", async () => {
    const tree = table({
      region: ["North", "North", "South"],
      city: ["Oslo", "Bergen", "Rome"],
      value: [4, 2, 3],
    });
    const chart = await mount({
      interaction: { zoom: true, select: "items" },
      marks: [treemap(tree, { id: "map", path: ["region", "city"], value: "value" })],
    });
    const pins = heard(chart, "pin");
    const selections = heard(chart, "select");
    const drills = heard(chart, "drill");
    // North's own strip, near its box's top left corner: North has nodes under it.
    const item = chart
      .getItems({ mark: "map" })!
      .items.find(({ key }) => key.endsWith('"North"]'))!;
    const rect = chart.root.getBoundingClientRect();
    const { x, y } = item.box!;
    clickAt(chart, [rect.left + x + 4, rect.top + y + 4]);
    chart.render();
    expect(drills).toHaveLength(1);
    expect(selections).toHaveLength(0);
    expect(pins).toHaveLength(0);
    // Inside it now, a leaf: selected and pinned, about the same item.
    const leaf = chart.getItems({ mark: "map" })!.items.find(({ key }) => key.endsWith('"Oslo"]'))!;
    const { x: lx, y: ly, width: lw, height: lh } = leaf.box!;
    clickAt(chart, [rect.left + lx + lw / 2, rect.top + ly + lh / 2]);
    expect(selections.map(({ selection }) => selection)).toEqual([
      { kind: "items", items: [leaf.key] },
    ]);
    expect(pins.map(({ at }) => at)).toEqual([{ item: leaf.key, panel: "" }]);
  });
});

describe("drilling", () => {
  const tree = () =>
    table({
      region: ["North", "North", "South"],
      city: ["Oslo", "Bergen", "Rome"],
      value: [4, 2, 3],
    });

  it("is done before the click is reported, from the pointer or from Enter", async () => {
    const chart = createChart(host, {
      renderer: "svg",
      interaction: { zoom: true },
      marks: [treemap(tree(), { id: "map", path: ["region", "city"], value: "value" })],
    });
    charts.push(chart);
    // Listening before the chart loads its controls.
    const roots: (string | null | undefined)[] = [];
    const causes: string[] = [];
    chart.on("click", ({ cause }) => {
      roots.push(chart.getDrillRoot()?.key);
      causes.push(cause);
    });
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    const north = chart
      .getItems({ mark: "map" })!
      .items.find(({ key }) => key.endsWith('"North"]'))!;
    const rect = chart.root.getBoundingClientRect();
    clickAt(chart, [rect.left + north.box!.x + 4, rect.top + north.box!.y + 4]);
    chart.render();
    expect(roots).toEqual([north.key]);
    chart.setDrillRoot(null);
    chart.render();
    chart.root.focus();
    // The largest region is read first: North.
    key(chart.root, "ArrowRight");
    chart.render();
    key(chart.root, "Enter");
    chart.render();
    expect(roots).toEqual([north.key, north.key]);
    expect(causes).toEqual(["pointer", "keyboard"]);
  });

  it("leaves a brush as it is", async () => {
    host.style.width = "800px";
    const chart = await mount({
      interaction: { zoom: true, brush: "x" },
      marks: [
        treemap(tree(), { id: "map", path: ["region", "city"], value: "value", panel: "a" }),
        line(data(), { x: "t", y: "v", panel: "b" }),
      ],
      panels: panels([{ id: "a" }, { id: "b" }], columns([1, 1], [panel("a"), panel("b")])),
    });
    const drills = heard(chart, "drill");
    chart.select({ kind: "brush", x: [1, 2], y: null, lasso: null }, { panel: "b" });
    const brushed = chart.selection;
    expect(brushed).not.toBeNull();
    const north = chart
      .getItems({ mark: "map" })!
      .items.find(({ key }) => key.endsWith('"North"]'))!;
    const rect = chart.root.getBoundingClientRect();
    clickAt(chart, [rect.left + north.box!.x + 4, rect.top + north.box!.y + 4]);
    expect(drills).toHaveLength(1);
    expect(chart.selection).toEqual(brushed);
  });
});

describe("options", () => {
  it("refuse pinning what nothing inspects", async () => {
    const errors: string[] = [];
    const chart = createChart(host, {
      marks: [line(data(), { x: "t", y: "v" })],
      tooltip: { pin: "click" },
      inspection: false,
      onError: (error) => errors.push(error.message),
    });
    charts.push(chart);
    await chart.loading?.catch(() => {});
    expect(errors).toEqual(["tooltip.pin: pins what the pointer inspects; drop inspection: false"]);
    const live = await mount();
    expect(() => live.update({ inspection: false })).toThrow(
      "tooltip.pin: pins what the pointer inspects; drop inspection: false",
    );
  });
});
