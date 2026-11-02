// A brush's gestures as transactions: previews once a frame, then a commit
// or a cancel (Escape, a lost pointer, an option given meanwhile); brushes
// moved, resized, and cleared as their settings say; and row selections
// that hear previews (`live`).
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectionStore, selectWhere } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { chartState } from "../../src/state.ts";
import { brushOf } from "../helpers/selections.ts";
import { MOUSE } from "./helpers.ts";

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

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const rows = () => table({ t: [0, 1, 2, 3, 4, 5, 6], v: [1, 3, 2, 5, 4, 6, 2] });

async function mount(options: Partial<ChartOptions> = {}): Promise<Chart> {
  const chart = createChart(host, {
    errorMode: "throw",
    marks: [line(rows(), { x: "t", y: "v" })],
    interaction: { brush: "x" },
    ...options,
  });
  charts.push(chart);
  // The brush loads with the controller.
  await chart.loading;
  return chart;
}

function heard<K extends keyof ChartEvents>(chart: Chart, type: K): ChartEvents[K][] {
  const events: ChartEvents[K][] = [];
  chart.on(type, (event) => events.push(event));
  return events;
}

/** Sends pointer event `type` at value `t` on x, halfway up the plot. */
function at(chart: Chart, type: string, t: number) {
  const rect = chart.root.getBoundingClientRect();
  const { plot } = chart.getPanels()[0]!;
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: rect.left + chart.toPixel(t, { axis: "x" })!,
      clientY: rect.top + plot.y + plot.height / 2,
      pointerId: MOUSE,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}

/** Presses at `from` and moves to each of `to`, a frame after each move; leaves the button down. */
async function press(chart: Chart, from: number, ...to: number[]) {
  at(chart, "pointerdown", from);
  for (const t of to) {
    at(chart, "pointermove", t);
    await frame();
  }
}

const phases = (events: ChartEvents["select"][]) =>
  events.map(({ selection, phase }) => [phase, brushOf(selection)?.x ?? null]);

const pressEscape = (chart: Chart) =>
  chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

describe("a brush's gesture", () => {
  it("previews once a frame what it shows, keeping the selection, and commits on release", async () => {
    const chart = await mount();
    chart.select([5, 6]);
    const events = heard(chart, "select");
    await press(chart, 1, 2, 3);
    expect(phases(events)).toEqual([
      ["preview", [1, 2]],
      ["preview", [1, 3]],
    ]);
    // The selection stays the one before the gesture until it commits.
    expect(brushOf(chart.selection)?.x).toEqual([5, 6]);
    at(chart, "pointerup", 3);
    expect(phases(events).at(-1)).toEqual(["commit", [1, 3]]);
    expect(brushOf(chart.selection)?.x).toEqual([1, 3]);
    expect(events.every(({ cause }) => cause === "pointer")).toBe(true);
  });

  it("goes back to the selection before it on Escape and on a lost pointer", async () => {
    const chart = await mount();
    chart.select([5, 6]);
    const events = heard(chart, "select");
    await press(chart, 1, 2);
    pressEscape(chart);
    expect(phases(events)).toEqual([
      ["preview", [1, 2]],
      ["cancel", [5, 6]],
    ]);
    expect(events.at(-1)!.cause).toBe("keyboard");
    expect(brushOf(chart.selection)?.x).toEqual([5, 6]);
    events.length = 0;
    await press(chart, 2, 3);
    at(chart, "pointercancel", 3);
    expect(phases(events)).toEqual([
      ["preview", [2, 3]],
      ["cancel", [5, 6]],
    ]);
    // The release that follows does nothing.
    at(chart, "pointerup", 3);
    expect(events).toHaveLength(2);
  });

  it("ends when a state option sets another selection, which stands", async () => {
    const chart = await mount({ state: chartState });
    const events = heard(chart, "select");
    await press(chart, 1, 2);
    chart.update({ selection: { kind: "brush", x: [4, 5], y: null, lasso: null } });
    at(chart, "pointerup", 3);
    expect(events.map(({ phase, cause }) => [phase, cause])).toEqual([
      ["preview", "pointer"],
      ["cancel", "options"],
      ["commit", "options"],
    ]);
    expect(brushOf(chart.selection)?.x).toEqual([4, 5]);
  });

  it("goes on while what it previews is written back, as bindings write it", async () => {
    const chart = await mount({ state: chartState });
    const events = heard(chart, "select");
    chart.on("select", ({ selection }) => chart.update({ selection }));
    await press(chart, 1, 2, 3);
    at(chart, "pointerup", 3);
    expect(phases(events)).toEqual([
      ["preview", [1, 2]],
      ["preview", [1, 3]],
      ["commit", [1, 3]],
    ]);
  });
});

describe("Escape during a gesture", () => {
  it("undoes it alone, with a binding that hears keys after the chart", async () => {
    const source = rows();
    const store = selectionStore(source);
    const chart = await mount({ marks: [line(source, { x: "t", y: "v" })] });
    // Bound once the chart's own keys are heard: its keys are heard after them.
    chart.update({ rowSelection: rowSelection({ store, channel: "focus", live: true }) });
    chart.select([4, 5]);
    const held = store.get("focus");
    const events = heard(chart, "select");
    await press(chart, 1, 2);
    pressEscape(chart);
    await Promise.resolve();
    expect(events.map(({ phase }) => phase)).toEqual(["preview", "cancel"]);
    expect(brushOf(chart.selection)?.x).toEqual([4, 5]);
    expect(store.get("focus")).toEqual(held);
    // Another Escape clears, as it does without a gesture.
    pressEscape(chart);
    expect(chart.selection).toBeNull();
  });
});

describe("a gesture undone", () => {
  it("gives back what a live channel held before it, which the chart did not write", async () => {
    const source = rows();
    const store = selectionStore(source);
    const outside = selectWhere(true);
    store.set("focus", outside);
    const chart = await mount({
      marks: [line(source, { x: "t", y: "v" })],
      rowSelection: rowSelection({ store, channel: "focus", live: true }),
    });
    await press(chart, 1, 2);
    expect(store.get("focus")).not.toBe(outside);
    pressEscape(chart);
    expect(chart.selection).toBeNull();
    expect(store.get("focus")).toBe(outside);
  });

  it("gives it back after the brush shrank to nothing on the way", async () => {
    const source = rows();
    const store = selectionStore(source);
    const outside = selectWhere(true);
    store.set("focus", outside);
    const chart = await mount({
      marks: [line(source, { x: "t", y: "v" })],
      rowSelection: rowSelection({ store, channel: "focus", live: true }),
    });
    await press(chart, 1, 3, 1);
    pressEscape(chart);
    expect(store.get("focus")).toBe(outside);
  });

  it("gives it back through a binding that replaced the one it previewed in", async () => {
    const source = rows();
    const store = selectionStore(source);
    const outside = selectWhere(true);
    store.set("focus", outside);
    const chart = await mount({
      marks: [line(source, { x: "t", y: "v" })],
      rowSelection: rowSelection({ store, channel: "focus", live: true }),
    });
    await press(chart, 1, 2);
    chart.update({ rowSelection: rowSelection({ store, channel: "focus", live: true }) });
    pressEscape(chart);
    expect(store.get("focus")).toBe(outside);
  });
});

describe("a brush of one category", () => {
  it("moves to the next category", async () => {
    const chart = await mount({
      marks: [bar(table({ c: ["a", "b", "c"], v: [1, 2, 3] }), { x: "c", y: "v" })],
      interaction: { brush: { shape: "x", edit: true } },
    });
    chart.select([1, 1]);
    chart.render();
    const events = heard(chart, "select");
    await press(chart, 1, 1.5, 2);
    at(chart, "pointerup", 2);
    expect(brushOf(chart.selection)?.x).toEqual([2, 2]);
    expect(events.at(-1)?.phase).toBe("commit");
  });
});

describe("synced brushes", () => {
  it("clear on the charts they were shared with when another writer replaces their rows", async () => {
    const source = rows();
    const store = selectionStore(source);
    const sync = { brush: "x", sync: { selection: "rows" } } as const;
    const chart = await mount({
      marks: [line(source, { x: "t", y: "v" })],
      interaction: sync,
      rowSelection: rowSelection({ store, channel: "focus" }),
    });
    const other = createChart(document.body.appendChild(document.createElement("div")), {
      errorMode: "throw",
      marks: [line(rows(), { x: "t", y: "v" })],
      interaction: sync,
    });
    charts.push(other);
    other.render();
    chart.select([0, 1]);
    expect(brushOf(other.selection)?.x).toEqual([0, 1]);
    store.set("focus", selectWhere(true));
    await Promise.resolve();
    expect(chart.selection).toBeNull();
    expect(other.selection).toBeNull();
  });
});

describe("a brush released where it began", () => {
  it("ends its previews as undone, writing back what live bindings held", async () => {
    const source = rows();
    const store = selectionStore(source);
    const chart = await mount({
      marks: [line(source, { x: "t", y: "v" })],
      interaction: { brush: { shape: "x", edit: true } },
      rowSelection: rowSelection({ store, channel: "focus", live: true }),
    });
    chart.select([2, 4]);
    chart.render();
    const held = store.get("focus");
    const events = heard(chart, "select");
    // Moved, then back, and released before another frame.
    await press(chart, 3);
    at(chart, "pointermove", 3.5);
    at(chart, "pointermove", 3);
    at(chart, "pointerup", 3);
    expect(phases(events)).toEqual([
      ["preview", [2.5, 4.5]],
      ["cancel", [2, 4]],
    ]);
    expect(brushOf(chart.selection)?.x).toEqual([2, 4]);
    expect(store.get("focus")).toEqual(held);
  });
});

describe("brush settings", () => {
  it("move a brush dragged inside it and resize it by its edges", async () => {
    const chart = await mount({ interaction: { brush: { shape: "x", edit: true } } });
    chart.select([2, 4]);
    chart.render();
    const events = heard(chart, "select");
    await press(chart, 3, 3.5);
    at(chart, "pointerup", 3.5);
    expect(brushOf(chart.selection)?.x).toEqual([2.5, 4.5]);
    await press(chart, 4.5, 5.5);
    at(chart, "pointerup", 5.5);
    expect(brushOf(chart.selection)?.x).toEqual([2.5, 5.5]);
    expect(events.filter(({ phase }) => phase === "commit")).toHaveLength(2);
  });

  it("clear a brush on a double click, and not on a click, when they say so", async () => {
    const chart = await mount({ interaction: { brush: { shape: "x", clear: "double-click" } } });
    chart.select([2, 4]);
    const click = (type: string) => {
      const rect = chart.root.getBoundingClientRect();
      const { plot } = chart.getPanels()[0]!;
      const init = {
        bubbles: true,
        clientX: rect.left + chart.toPixel(5.5, { axis: "x" })!,
        clientY: rect.top + plot.y + plot.height / 2,
      };
      if (type === "click") {
        at(chart, "pointerdown", 5.5);
        at(chart, "pointerup", 5.5);
      }
      chart.root.dispatchEvent(
        new MouseEvent(type, { ...init, detail: type === "dblclick" ? 2 : 1 }),
      );
    };
    click("click");
    expect(brushOf(chart.selection)?.x).toEqual([2, 4]);
    click("dblclick");
    expect(chart.selection).toBeNull();
  });
});

describe("row selections of brushes", () => {
  it("hear previews and the cancel with live, and commits only without", async () => {
    for (const live of [true, false]) {
      const source = rows();
      const store = selectionStore(source);
      const chart = await mount({
        marks: [line(source, { x: "t", y: "v" })],
        rowSelection: rowSelection({ store, channel: "focus", live }),
      });
      const changes = heard(chart, "rowSelection");
      await press(chart, 1, 2, 3);
      pressEscape(chart);
      expect(changes.map(({ phase }) => phase)).toEqual(
        live ? ["preview", "preview", "cancel"] : [],
      );
      expect(store.get("focus") ?? null).toBeNull();
      await press(chart, 1, 2);
      at(chart, "pointerup", 2);
      expect(changes.at(-1)?.phase).toBe("commit");
      expect(store.get("focus")?.kind).toBe("predicate");
      chart.destroy();
      charts.length = 0;
    }
  });
});
