// Input events in the browser: what the pointer and the keyboard are on and
// read (`InputEvent`), with the chart's inspection policy, its crosshair,
// context menus, clicks that arrive while data changes, and cursors other
// charts share.
import "./interactive.ts";
import { describe, expect, it } from "vitest";
import { time } from "../../src/data/column.ts";
import { selectionStore } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import type { Chart } from "../../src/dom/chart.ts";
import { bar } from "../../src/marks/bar.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { graph } from "../../src/marks/graph.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { line } from "../../src/marks/line.ts";
import type { Mark } from "../../src/marks/mark.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { treemap } from "../../src/marks/treemap.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { timeBreaks } from "../../src/scale/breaks.ts";
import type { ChartError } from "../../src/spec/errors.ts";
import type { Snap } from "../../src/spec/spec.ts";
import { inputEventPayload } from "../../src/web/events.ts";
import { modelOf } from "./helpers.ts";
import { frame, heard, key, mount, mountNow, pointer, within } from "./interaction/helpers.ts";

const SECOND = 1000;
const seconds = (...values: number[]) => time(values.map((s) => s * SECOND));

/** Two series sampled at their own times: auth on the minute, api at 20, 70, and 200 s. */
const services = () => [
  line(table({ t: seconds(0, 60, 120, 180), v: [1, 2, 3, 4] }), { x: "t", y: "v", label: "auth" }),
  line(table({ t: seconds(20, 70, 200), v: [5, 6, 7] }), { x: "t", y: "v", label: "api" }),
];

/** The crosshairs shown: their x. */
const crosshairs = (root: Element) =>
  [...root.querySelectorAll("svg line")]
    .filter((l) => l.getAttribute("visibility") === "visible")
    .map((l) => Number(l.getAttribute("x1")));

describe("the inspection policy", () => {
  const cases: [Snap, number, string[]][] = [
    // At 67 s: api's 70 s is the value nearest that any series has.
    ["shared", 70, ["api"]],
    // Each series' own nearest, the crosshair at the pointer.
    ["each", 67, ["auth", "api"]],
    ["previous", 60, ["auth", "api"]],
    ["next", 70, ["auth", "api"]],
  ];
  for (const [snap, crosshair, labels] of cases)
    it(`stands the crosshair where "${snap}" reads`, async () => {
      const chart = await mount({ marks: services(), inspection: { mode: "nearest-x", snap } });
      const hovers = heard(chart, "hover");
      const x = chart.toPixel(67 * SECOND, { axis: "x" })!;
      pointer(chart, "pointermove", x, within(chart, "")[1]);
      await frame();
      const inspection = hovers.at(-1)?.inspection;
      expect(inspection?.points.map((p) => p.label)).toEqual(labels);
      const expected = chart.toPixel(crosshair * SECOND, { axis: "x" })!;
      expect(crosshairs(chart.root)).toEqual([Math.round(expected) + 0.5]);
    });

  it("reports a within in milliseconds on an axis that is not a time axis", async () => {
    const data = table({ x: [0, 1, 2], y: [1, 2, 3] });
    const chart = mountNow({
      marks: [line(data, { x: "x", y: "y" })],
      inspection: { mode: "nearest-x", within: { milliseconds: 30_000 } },
    });
    const errors: ChartError[] = [];
    chart.on("error", ({ error }) => errors.push(error));
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    await frame();
    expect(errors.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: "invalid-option",
        message: "inspection.within: the x axis is not a time axis; give a number",
      },
    ]);
  });

  it("keeps the keyboard reading with inspection: false, while the pointer reads nothing", async () => {
    const chart = await mount({ marks: services(), inspection: false });
    const hovers = heard(chart, "hover");
    const clicks = heard(chart, "click");
    pointer(chart, "pointermove", ...within(chart, ""));
    await frame();
    expect(hovers.at(-1)).toMatchObject({ cause: "pointer", inspection: undefined });
    expect(hovers.at(-1)?.pointer?.inPlot).toBe(true);
    expect(crosshairs(chart.root)).toEqual([]);
    chart.root.focus();
    key(chart, "Home");
    await frame();
    expect(hovers.at(-1)?.cause).toBe("keyboard");
    expect(hovers.at(-1)?.inspection?.points.length).toBeGreaterThan(0);
    expect(chart.root.querySelector("[aria-live]")!.textContent).not.toBe("");
    key(chart, "Enter");
    expect(clicks.at(-1)).toMatchObject({ cause: "keyboard", pointer: undefined });
    expect(clicks.at(-1)?.inspection?.points.length).toBeGreaterThan(0);
  });

  it("draws no cursor for the pointer with inspection: false, and still shares it", async () => {
    const interaction = { sync: "inspection-false" };
    const source = await mount({ marks: services(), inspection: false, interaction });
    const peer = await mount({ marks: services(), interaction });
    pointer(source, "pointermove", ...within(source, ""));
    await frame();
    await frame();
    expect(crosshairs(source.root)).toEqual([]);
    expect(crosshairs(peer.root)).toHaveLength(1);
  });

  it('gives each series a stop of its own in mode "nearest"', async () => {
    const chart = await mount({ marks: services(), inspection: { mode: "nearest" } });
    const hovers = heard(chart, "hover");
    chart.root.focus();
    key(chart, "Home");
    const first = hovers.at(-1)?.inspection?.points.map((p) => p.label);
    key(chart, "ArrowDown");
    const second = hovers.at(-1)?.inspection?.points.map((p) => p.label);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(second).not.toEqual(first);
  });
});

describe("pointer values", () => {
  it("read time, log, and broken axes in their values, and category axes by name", async () => {
    const start = Date.UTC(2026, 0, 1);
    const times = await mount({
      timeZone: "UTC",
      marks: [
        line(table({ t: time([start, start + 3_600_000]), v: [1, 1000] }), { x: "t", y: "v" }),
      ],
      y: { type: "log" },
    });
    const hovers = heard(times, "hover");
    const at = start + 1_800_000;
    pointer(
      times,
      "pointermove",
      times.toPixel(at, { axis: "x" })!,
      times.toPixel(100, { axis: "y" })!,
    );
    await frame();
    const { values, categories, inPlot } = hovers.at(-1)!.pointer!;
    expect(inPlot).toBe(true);
    expect(Math.abs(values.x! - at)).toBeLessThan(60_000);
    expect(values.y).toBeCloseTo(100, -1);
    expect(categories).toEqual({});

    const broken = await mount({
      marks: [line(table({ x: time([0, 20]), y: [0, 1] }), { x: "x", y: "y" })],
      x: { domain: [0, 20], breaks: timeBreaks([{ from: 4, to: 8 }]) },
    });
    const past = heard(broken, "hover");
    pointer(broken, "pointermove", broken.toPixel(12, { axis: "x" })!, within(broken, "")[1]);
    await frame();
    expect(past.at(-1)!.pointer!.values.x).toBeCloseTo(12, 0);

    const bands = await mount({
      marks: [bar(table({ c: ["a", "b", "c"], v: [1, 2, 3] }), { x: "c", y: "v" })],
    });
    const over = heard(bands, "hover");
    pointer(bands, "pointermove", bands.toPixel(1, { axis: "x" })!, within(bands, "")[1]);
    await frame();
    expect(over.at(-1)!.pointer!.categories).toEqual({ x: "b" });
    expect(over.at(-1)!.pointer!.values.x).toBeCloseTo(1, 0);
  });

  it("read a network's plane in its own units", async () => {
    const ring = table({ from: ["a", "b", "c"], to: ["b", "c", "a"] });
    const chart = await mount({ marks: [graph(ring, { source: "from", target: "to" })] });
    const hovers = heard(chart, "hover");
    const { width, height } = chart.root.getBoundingClientRect();
    const at = (x: number) => {
      pointer(chart, "pointermove", x, height / 2);
      return frame().then(() => hovers.at(-1)!.pointer!.values);
    };
    const [left, right] = [await at(width / 2), await at(width / 2 + 20)];
    expect([left.x, left.y, right.x].every(Number.isFinite)).toBe(true);
    expect(right.x).not.toBeCloseTo(left.x!);
    expect(right.y).toBeCloseTo(left.y!);
  });
});

describe("the keyboard", () => {
  it("clicks with Enter the bin it is on, as the pointer would, with pick: false too", async () => {
    const values = table({ v: [1, 2, 2, 3, 3, 3] });
    for (const pick of [true, false]) {
      const chart = await mount({
        marks: [histogram(values, { x: "v", bins: [0, 2, 4], id: "bins", pick })],
      });
      const clicks = heard(chart, "click");
      chart.root.focus();
      key(chart, "Home");
      key(chart, "Enter");
      await frame();
      expect(clicks.at(-1)).toMatchObject({
        cause: "keyboard",
        target: { kind: "item", markId: "bins" },
      });
    }
  });

  it("clicks with Enter a bin the view cuts off", async () => {
    const chart = await mount({
      marks: [histogram(table({ v: [1, 1, 1, 3] }), { x: "v", bins: [0, 2, 4], id: "bins" })],
      y: { domain: [0, 1] },
    });
    const clicks = heard(chart, "click");
    chart.root.focus();
    key(chart, "Home");
    key(chart, "Enter");
    await frame();
    expect(clicks).toMatchObject([
      {
        cause: "keyboard",
        target: { kind: "item", markId: "bins" },
        inspection: { points: [{ value: 3 }] },
      },
    ]);
  });

  it("clicks with Enter its series' bin, where another series' is drawn over it", async () => {
    const values = table({ v: [1, 1, 1], g: ["A", "B", "B"] });
    const chart = await mount({
      marks: [histogram(values, { x: "v", series: "g", bins: [0, 2], id: "bins" })],
      inspection: { mode: "nearest" },
    });
    const clicks = heard(chart, "click");
    chart.root.focus();
    key(chart, "Home");
    key(chart, "Enter");
    await frame();
    expect(clicks[0]?.inspection?.points.map((p) => p.label)).toEqual(["A"]);
    expect(clicks[0]?.target).toMatchObject({ kind: "item", series: '["bins","A"]' });
  });

  it("clicks with Enter no bin the view leaves out, nor the one beside it", async () => {
    const chart = await mount({
      // Counts 1, 2, and 1: the second bin stands where the first's top is moved to.
      marks: [histogram(table({ v: [1, 3, 3, 5] }), { x: "v", bins: [0, 2, 4, 6], id: "bins" })],
      x: { domain: [2.5, 6] },
    });
    const clicks = heard(chart, "click");
    chart.root.focus();
    key(chart, "Home");
    key(chart, "Enter");
    await frame();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.inspection).toMatchObject({ label: "1", points: [{ value: 1 }] });
    expect(clicks[0]!.target).toBeUndefined();
  });

  it("clicks with Enter the box of the series it is on, of boxes grouped at a category", async () => {
    const values = table({
      host: ["a", "a", "a", "a", "a", "a"],
      g: ["A", "A", "A", "B", "B", "B"],
      v: [1, 2, 3, 4, 5, 6],
    });
    const chart = await mount({
      marks: [boxplot(values, { x: "host", y: "v", series: "g", id: "boxes" })],
    });
    const clicks = heard(chart, "click");
    chart.root.focus();
    for (const name of ["Home", "Enter", "ArrowDown", "Enter"]) key(chart, name);
    await frame();
    const targets = clicks.map(({ target }) => (target?.kind === "item" ? target : undefined));
    expect(targets.map((target) => target?.series)).toEqual(['["boxes","A"]', '["boxes","B"]']);
    expect(targets[0]?.item).not.toEqual(targets[1]?.item);
  });
});

describe("the keyboard on layout marks", () => {
  it("clicks with Enter the slice it is on", async () => {
    const shares = table({ kind: ["a", "b", "c"], v: [1, 2, 3] });
    const chart = await mount({
      marks: [pie(shares, { category: "kind", value: "v", id: "shares" })],
    });
    const clicks = heard(chart, "click");
    chart.root.focus();
    key(chart, "Home");
    key(chart, "ArrowRight");
    key(chart, "Enter");
    const [click] = clicks;
    expect(click).toMatchObject({ cause: "keyboard", target: { kind: "item", markId: "shares" } });
    const inspection = click!.inspection;
    expect(click!.target?.kind === "item" && click!.target.item).toBe(
      inspection?.axis === "item" && inspection.key,
    );
  });
});

/** The center of the tick label `text` of the chart's x axis, under its plot. */
function tickLabel(chart: Chart, text: string): [number, number] {
  const root = chart.root.getBoundingClientRect();
  const { plot } = chart.getPanels()[0]!;
  const box = [...chart.root.querySelectorAll("svg text")]
    .map((label) => ({ label, box: label.getBoundingClientRect() }))
    .find(
      ({ label, box }) => label.textContent === text && box.top - root.top > plot.y + plot.height,
    )!.box;
  return [box.left - root.left + box.width / 2, box.top - root.top + box.height / 2];
}

describe("axis labels", () => {
  it("are targets of the clicks and hovers on them", async () => {
    const chart = await mount({
      marks: [bar(table({ c: ["a", "b", "c"], v: [1, 2, 3] }), { x: "c", y: "v" })],
    });
    const [clicks, hovers] = [heard(chart, "click"), heard(chart, "hover")];
    const [x, y] = tickLabel(chart, "b");
    pointer(chart, "pointermove", x, y);
    await frame();
    pointer(chart, "pointerdown", x, y);
    pointer(chart, "pointerup", x, y);
    const target = { kind: "axisLabel", scale: "x", text: "b", category: "b" };
    expect(hovers.at(-1)?.target).toMatchObject(target);
    expect(clicks.map((click) => click.target)).toMatchObject([target]);
    // Off the plot and every label, nothing is clicked.
    pointer(chart, "pointerdown", 2, 2);
    pointer(chart, "pointerup", 2, 2);
    expect(clicks).toHaveLength(1);
  });
});

describe("the keyboard on a treemap", () => {
  it("clicks with Enter the node it reads, not one drawn inside it", async () => {
    const sales = table({
      region: ["A", "A", "B"],
      city: ["one", "two", "three"],
      revenue: [1, 2, 3],
    });
    const chart = await mount({
      marks: [treemap(sales, { path: ["region", "city"], value: "revenue", id: "tree" })],
    });
    const [clicks, hovers] = [heard(chart, "click"), heard(chart, "hover")];
    chart.root.focus();
    key(chart, "Home");
    key(chart, "Enter");
    const read = hovers.at(-1)!.inspection!;
    expect(read.axis).toBe("item");
    const key0 = read.axis === "item" ? read.key : undefined;
    expect(JSON.parse(key0!)).toHaveLength(2);
    for (const event of [hovers.at(-1)!, clicks[0]!])
      expect(event.target).toMatchObject({ kind: "item", markId: "tree", item: key0 });
  });
});

describe("legend entries", () => {
  it("are targets of clicks, read before the click hides their series", async () => {
    const chart = await mount({ marks: services() });
    const clicks = heard(chart, "click");
    // Hiding a series, the application drops the marks, and the legend with them.
    chart.on("visibility", () => {
      chart.update({ marks: [] });
      chart.render();
    });
    const button = [...chart.root.querySelectorAll("button")].find((b) => b.textContent === "api")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    expect(clicks.map(({ target }) => target)).toMatchObject([
      { kind: "legendEntry", label: "api" },
    ]);
  });
});

describe("legend clicks", () => {
  it("are reported in their turn, after clicks waiting for a frame", async () => {
    const auth = table({ t: seconds(0, 60), v: [1, 2] });
    const api = table({ t: seconds(0, 60), v: [3, 4] });
    const chart = await mount({
      marks: [
        line(auth, { x: "t", y: "v", label: "auth" }),
        line(api, { x: "t", y: "v", label: "api" }),
      ],
    });
    const clicks = heard(chart, "click");
    const [x, y] = within(chart, "");
    pointer(chart, "pointerdown", x, y);
    auth.append({ t: [120 * SECOND], v: [3] });
    pointer(chart, "pointerup", x, y);
    const button = [...chart.root.querySelectorAll("button")].find((b) => b.textContent === "api")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
    await frame();
    await frame();
    const kinds = clicks.map(({ target }) => target?.kind);
    expect(kinds).toHaveLength(2);
    expect(kinds.at(-1)).toBe("legendEntry");
  });
});

describe("input events as JSON", () => {
  it("read the axes of the frame they acted on, though the chart changed since", async () => {
    const chart = await mount({
      marks: [line(table({ t: seconds(0, 60), v: [1, 2] }), { x: "t", y: "v" })],
    });
    const hovers = heard(chart, "hover");
    pointer(chart, "pointermove", ...within(chart, ""));
    await frame();
    const event = hovers.at(-1)!;
    // As a listener of an earlier event might, before this one is written:
    // the x axis is no time axis now.
    const numbers = [line(table({ t: [0, 60], v: [1, 2] }), { x: "t", y: "v" })];
    chart.update({ marks: numbers });
    chart.render();
    expect(chart.getPanels()[0]!.x?.type).not.toBe("time");
    expect(inputEventPayload(chart, event).pointer?.time).toEqual(["x"]);
    // And a listener of the same click, before the one writing it.
    chart.update({ marks: [line(table({ t: seconds(0, 60), v: [1, 2] }), { x: "t", y: "v" })] });
    chart.render();
    const written: (readonly string[] | undefined)[] = [];
    chart.on("click", () => {
      chart.update({ marks: numbers });
      chart.render();
    });
    chart.on("click", (click) => written.push(inputEventPayload(chart, click).pointer?.time));
    const [x, y] = within(chart, "");
    pointer(chart, "pointerdown", x, y);
    pointer(chart, "pointerup", x, y);
    await frame();
    expect(written).toEqual([["x"]]);
  });
});

describe("hover", () => {
  it("reaches as the pointer moving does, after a touch's press waited for a frame", async () => {
    const chart = await mount({
      marks: [point(table({ x: [5], y: [5] }), { x: "x", y: "y", radius: 5, id: "dot" })],
      x: { domain: [0, 10] },
      y: { domain: [0, 10] },
    });
    const hovers = heard(chart, "hover");
    const clicks = heard(chart, "click");
    // 6 px past the dot: within a finger's reach (8 px), not a mouse's (4).
    const [x, y] = [chart.toPixel(5, { axis: "x" })! + 11, chart.toPixel(5, { axis: "y" })!];
    const touch = { pointerType: "touch", pointerId: 9 };
    pointer(chart, "pointerdown", x, y, touch);
    // The press waits for the frame of the chart's new options.
    chart.update({ padding: 1 });
    pointer(chart, "pointerup", x, y, touch);
    pointer(chart, "pointermove", x, y);
    await frame();
    await frame();
    expect(clicks.map(({ target }) => target?.kind)).toEqual(["item"]);
    expect(hovers.at(-1)?.target?.kind).toBe("plot");
  });

  it("reports the pointer at other values once the view under it moves", async () => {
    const chart = await mount({
      // Along the bottom, away from the pointer: the pointer is on the plot alone.
      marks: [line(table({ x: [0, 10], y: [0, 0] }), { x: "x", y: "y" })],
      inspection: false,
      x: { domain: [0, 20] },
      y: { domain: [0, 10] },
    });
    chart.setViewport({ x: [0, 10] });
    await frame();
    const hovers = heard(chart, "hover");
    pointer(chart, "pointermove", chart.toPixel(5, { axis: "x" })!, within(chart, "")[1]);
    await frame();
    chart.setViewport({ x: [0, 20] });
    await frame();
    await frame();
    expect(hovers.map(({ pointer }) => Math.round(pointer?.values.x ?? Number.NaN))).toEqual([
      5, 10,
    ]);
  });
});

describe("context menus", () => {
  it("keep the browser's menu off plots, not off axes, while a listener listens", async () => {
    const chart = await mount({ marks: services() });
    const menu = (x: number, y: number) => {
      const rect = chart.root.getBoundingClientRect();
      const event = new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
        clientX: rect.left + x,
        clientY: rect.top + y,
      });
      chart.root.dispatchEvent(event);
      return event;
    };
    const [px, py] = within(chart, "");
    // Unheard, the browser's own menu shows.
    expect(menu(px, py).defaultPrevented).toBe(false);
    const menus = heard(chart, "contextMenu");
    expect(menu(px, py).defaultPrevented).toBe(true);
    const { plot } = chart.getPanels()[0]!;
    const below = menu(px, plot.y + plot.height + 12);
    expect(below.defaultPrevented).toBe(false);
    await frame();
    expect(menus.map(({ pointer }) => pointer.inPlot)).toEqual([true, false]);
    expect(menus[0]!.pointer.values.x).toBeGreaterThan(0);
  });
});

describe("pointers off the plot", () => {
  it("are in a chart's one panel, of a layout mark too", async () => {
    const shares = table({ kind: ["a", "b"], v: [1, 2] });
    const chart = await mount({
      title: "Shares",
      marks: [pie(shares, { category: "kind", value: "v" })],
    });
    const hovers = heard(chart, "hover");
    pointer(chart, "pointermove", 3, 3);
    await frame();
    expect(hovers.at(-1)?.pointer).toMatchObject({ panel: "", inPlot: false });
  });
});

describe("clicks", () => {
  it("wait for the frame that draws rows inserted while the button is down, and name what it drew", async () => {
    const data = table({ x: [0, 5, 10], y: [0, 5, 10] });
    const chart = await mount({ marks: [point(data, { x: "x", y: "y", id: "dots" })] });
    const clicks = heard(chart, "click");
    const [x, y] = [chart.toPixel(5, { axis: "x" })!, chart.toPixel(5, { axis: "y" })!];
    pointer(chart, "pointerdown", x, y);
    data.append({ x: [2], y: [8] });
    pointer(chart, "pointerup", x, y);
    // The frame on screen no longer shows the data: the click waits for the next.
    expect(clicks).toHaveLength(0);
    await frame();
    await frame();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.target).toMatchObject({ kind: "item", markId: "dots", row: 1 });
  });
});

describe("clicks selecting rows", () => {
  const bound = async () => {
    const source = table({ x: [0, 5, 10], y: [0, 5, 10] });
    const store = selectionStore(source);
    const chart = await mount({
      marks: [point(source, { x: "x", y: "y", id: "dots" })],
      rowSelection: rowSelection({ store, channel: "focus" }),
    });
    const [x, y] = [chart.toPixel(5, { axis: "x" })!, chart.toPixel(5, { axis: "y" })!];
    return { source, store, chart, x, y };
  };

  it("reach as far as the click's own target: further for a finger", async () => {
    const { store, chart, x, y } = await bound();
    const model = modelOf(chart);
    const drawn = model.drawnMarks()[0]!;
    const reach = (model.config.marks[0] as Mark).reach!(1, drawn.series[0]!);
    const tap = (pointerType: string) => {
      for (const type of ["pointerdown", "pointerup"])
        pointer(chart, type, x + reach + 6, y, { pointerType, pointerId: 7 });
      return store.get("focus");
    };
    expect(tap("mouse")).toBeNull();
    expect(tap("touch")).not.toBeNull();
  });

  it("name what was clicked, though a listener of the selection changes the data first", async () => {
    const { source, chart, x, y } = await bound();
    // A row drawn over the one clicked, appended as the click selects.
    chart.on("rowSelection", () => source.append({ x: [5], y: [5] }));
    const clicks = heard(chart, "click");
    pointer(chart, "pointerdown", x, y);
    pointer(chart, "pointerup", x, y);
    await frame();
    expect(clicks.map(({ target }) => target)).toMatchObject([
      { kind: "item", markId: "dots", row: 1 },
    ]);
  });
});

describe("cursors other charts share", () => {
  it("report a hover with cause sync once the received cursor is drawn", async () => {
    const options = { marks: services(), interaction: { sync: "input-test" } };
    const source = await mount(options);
    const receiver = await mount(options);
    const received = heard(receiver, "hover");
    pointer(
      source,
      "pointermove",
      source.toPixel(60 * SECOND, { axis: "x" })!,
      within(source, "")[1],
    );
    await frame();
    await frame();
    const last = received.at(-1);
    expect(last?.cause).toBe("sync");
    expect(last?.pointer).toBeUndefined();
    expect(last?.inspection?.points.map((p) => p.label)).toContain("auth");
    expect(crosshairs(receiver.root)).toHaveLength(1);
  });
});
