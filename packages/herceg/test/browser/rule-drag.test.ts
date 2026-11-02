// Dragging rules (`rule({ drag: true })`): previews, a commit, and a cancel
// reported as `itemMove`, the rule drawn at the pointer meanwhile, and the
// application accepting, rejecting, or removing it; A1's threshold, which
// neither pans nor selects a line, and A4's right-click annotation.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { columns, panel } from "../../src/layout.ts";
import { line } from "../../src/marks/line.ts";
import type { ChartMark } from "../../src/marks/mark.ts";
import { rule } from "../../src/marks/rule.ts";
import { facet } from "../../src/model/facet.ts";
import { panels } from "../../src/model/panels.ts";
import type { RuleGeometry } from "../../src/scene/scene.ts";
import { loadSpec } from "../../src/spec/load.ts";
import { itemMovePayload } from "../../src/web/events.ts";
import { sceneOf } from "./contracts/mount.ts";
import { MOUSE, pageOrigin, realMouse } from "./helpers.ts";

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

const metrics = () => table({ t: [0, 1, 2, 3, 4], v: [10, 30, 20, 50, 40] });
const lines = () => line(metrics(), { id: "lines", x: "t", y: "v" });

async function mount(options: Partial<ChartOptions> = {}): Promise<Chart> {
  const chart = createChart(host, {
    errorMode: "throw",
    renderer: "svg",
    marks: [lines(), rule({ id: "threshold", y: 25, drag: true })],
    interaction: { zoom: "x", select: false },
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

/** A pointer event at the chart's pixel (x, y), the primary button held (`buttons`) or not. */
function pointer(chart: Chart, type: string, x: number, y: number, buttons = 0) {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      button: type === "contextmenu" ? 2 : 0,
      buttons,
      pointerId: MOUSE,
      clientX: rect.left + x,
      clientY: rect.top + y,
    }),
  );
}

/** The y pixel the threshold rule is drawn at, or undefined where none is drawn. */
function ruleAt(chart: Chart): number | undefined {
  const rules = sceneOf(chart).panels[0]!.marks.filter((g): g is RuleGeometry => g.kind === "rule");
  return rules[0]?.y1;
}

/** Presses the rule, moves it to `values` (data, one a frame), and lets go at the last. */
async function dragRule(chart: Chart, values: readonly number[], release = true) {
  const x = chart.toPixel(2, { axis: "x" })!;
  pointer(chart, "pointerdown", x, chart.toPixel(25, { axis: "y" })!, 1);
  for (const value of values) {
    pointer(chart, "pointermove", x, chart.toPixel(value, { axis: "y" })!, 1);
    chart.render();
  }
  if (release) pointer(chart, "pointerup", x, chart.toPixel(values.at(-1)!, { axis: "y" })!);
}

describe("a rule with drag", () => {
  it("reports its value as it moves and where it is dropped, panning and selecting nothing", async () => {
    // A1's threshold, dragged vertically.
    const chart = await mount();
    const moves = heard(chart, "itemMove");
    const views = heard(chart, "viewport");
    const clicks = heard(chart, "click");
    const selections = heard(chart, "select");
    await dragRule(chart, [30, 40]);
    expect(moves.map(({ phase }) => phase)).toEqual(["preview", "preview", "commit"]);
    expect(
      moves.every(({ markId, key }) => markId === "threshold" && key === '["threshold",0]'),
    ).toBe(true);
    expect(moves.at(-1)!.position!.y).toBeCloseTo(40, 0);
    expect(moves[0]!.position!.y).toBeCloseTo(30, 0);
    expect(moves.every(({ position }) => position?.x === undefined)).toBe(true);
    expect(views).toEqual([]);
    expect(clicks).toEqual([]);
    expect(selections).toEqual([]);
  });

  it("is drawn at the pointer while it moves", async () => {
    const chart = await mount();
    await dragRule(chart, [45], false);
    expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(45, { axis: "y" })!, 0);
    pointer(
      chart,
      "pointerup",
      chart.toPixel(2, { axis: "x" })!,
      chart.toPixel(45, { axis: "y" })!,
    );
  });

  it("stays where the application sets it (accepted), else goes back (rejected)", async () => {
    let threshold = 25;
    const marks = (): ChartMark[] => [lines(), rule({ id: "threshold", y: threshold, drag: true })];
    const chart = await mount({ marks: marks() });
    // Rejected: the application keeps its value.
    await dragRule(chart, [40]);
    chart.render();
    expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(25, { axis: "y" })!, 0);
    // Accepted: it sets the value committed.
    chart.on("itemMove", ({ phase, position }) => {
      if (phase !== "commit" || position?.y === undefined) return;
      threshold = position.y;
      chart.update({ marks: marks() });
    });
    await dragRule(chart, [40]);
    chart.render();
    expect(threshold).toBeCloseTo(40, 0);
    expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(threshold, { axis: "y" })!, 0);
  });

  it("goes when the application removes it", async () => {
    const chart = await mount();
    chart.on("itemMove", ({ phase }) => {
      if (phase === "commit") chart.update({ marks: [lines()] });
    });
    await dragRule(chart, [40]);
    chart.render();
    expect(ruleAt(chart)).toBeUndefined();
  });

  it("goes back on Escape and on a lost pointer, reported as a cancel at its value", async () => {
    const chart = await mount();
    const moves = heard(chart, "itemMove");
    await dragRule(chart, [40], false);
    chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    chart.render();
    expect(moves.map(({ phase }) => phase)).toEqual(["preview", "cancel"]);
    expect(moves.at(-1)!.position).toEqual({ y: 25 });
    expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(25, { axis: "y" })!, 0);
    await dragRule(chart, [35], false);
    pointer(chart, "pointercancel", 0, 0);
    chart.render();
    expect(moves.map(({ phase }) => phase)).toEqual(["preview", "cancel", "preview", "cancel"]);
    expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(25, { axis: "y" })!, 0);
  });

  it("lets the pointer go when Escape gives it up", async () => {
    const chart = await mount();
    const moves = heard(chart, "itemMove");
    const origin = pageOrigin(chart.root);
    const x = origin.x + chart.toPixel(2, { axis: "x" })!;
    const y = (value: number) => origin.y + chart.toPixel(value, { axis: "y" })!;
    await realMouse({ type: "move", x, y: y(25) });
    await realMouse({ type: "press", x, y: y(25) });
    try {
      await realMouse({ type: "move", x, y: y(35) });
      await realMouse({ type: "move", x, y: y(40) });
      chart.render();
      expect(chart.root.hasPointerCapture(MOUSE)).toBe(true);
      chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      expect(chart.root.hasPointerCapture(MOUSE)).toBe(false);
    } finally {
      await realMouse({ type: "release", x, y: y(40) });
    }
    expect(moves.at(-1)!.phase).toBe("cancel");
  });

  it("goes on being dragged when the options make it again", async () => {
    const chart = await mount();
    const moves = heard(chart, "itemMove");
    const origin = pageOrigin(chart.root);
    const x = origin.x + chart.toPixel(2, { axis: "x" })!;
    const y = (value: number) => origin.y + chart.toPixel(value, { axis: "y" })!;
    await realMouse({ type: "move", x, y: y(25) });
    await realMouse({ type: "press", x, y: y(25) });
    try {
      await realMouse({ type: "move", x, y: y(35) });
      await realMouse({ type: "move", x, y: y(40) });
      chart.render();
      chart.update({ marks: [lines(), rule({ id: "threshold", y: 25, drag: true })] });
      chart.render();
      expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(40, { axis: "y" })!, 0);
      expect(chart.root.hasPointerCapture(MOUSE)).toBe(true);
      await realMouse({ type: "move", x, y: y(45) });
      chart.render();
    } finally {
      await realMouse({ type: "release", x, y: y(45) });
    }
    expect(moves.map(({ phase }) => phase)).not.toContain("cancel");
    expect(moves.at(-1)!.phase).toBe("commit");
    expect(moves.at(-1)!.position!.y).toBeCloseTo(45, 0);
  });

  it("goes back when the options make it along another axis, or on the right axis", async () => {
    for (const again of [
      rule({ id: "threshold", x: 2, drag: true }),
      rule({ id: "threshold", y: 25, axis: "right", drag: true }),
    ]) {
      const chart = await mount();
      const moves = heard(chart, "itemMove");
      await dragRule(chart, [40], false);
      chart.update({ marks: [lines(), again] });
      chart.render();
      expect(moves.at(-1)).toMatchObject({ phase: "cancel", cause: "options" });
      chart.destroy();
    }
  });

  it("is its own pointer's: another touch neither moves nor drops it", async () => {
    const chart = await mount({ interaction: { zoom: false, select: false } });
    const moves = heard(chart, "itemMove");
    const touch = (type: string, id: number, x: number, value: number, buttons = 1) =>
      chart.root.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: "touch",
          buttons,
          clientX: chart.root.getBoundingClientRect().left + x,
          clientY: chart.root.getBoundingClientRect().top + chart.toPixel(value, { axis: "y" })!,
        }),
      );
    const x = chart.toPixel(2, { axis: "x" })!;
    touch("pointerdown", 11, x, 25);
    touch("pointermove", 11, x, 40);
    chart.render();
    touch("pointerdown", 12, x + 100, 10);
    touch("pointermove", 12, x + 100, 15);
    touch("pointerup", 12, x + 100, 15, 0);
    chart.render();
    expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(40, { axis: "y" })!, 0);
    touch("pointerup", 11, x, 40, 0);
    chart.render();
    expect(moves.map(({ phase }) => phase)).toEqual(["preview", "commit"]);
    expect(moves.at(-1)!.position!.y).toBeCloseTo(40, 0);
    expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(25, { axis: "y" })!, 0);
  });

  it("ends with its own pointer's release while another's tap on an axis label waits", async () => {
    const chart = await mount({ interaction: { zoom: false, select: false } });
    const moves = heard(chart, "itemMove");
    const clicks = heard(chart, "click");
    const rect = chart.root.getBoundingClientRect();
    const touch = (type: string, id: number, clientX: number, clientY: number, buttons = 1) =>
      chart.root.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId: id,
          pointerType: "touch",
          buttons,
          clientX,
          clientY,
        }),
      );
    const label = [...chart.root.querySelectorAll("svg text")].find(
      (t) => t.textContent === "2.0",
    )!;
    const box = label.getBoundingClientRect();
    const [lx, ly] = [box.left + box.width / 2, box.top + box.height / 2];
    const x = rect.left + chart.toPixel(2, { axis: "x" })!;
    const y = (value: number) => rect.top + chart.toPixel(value, { axis: "y" })!;
    touch("pointerdown", 21, lx, ly);
    touch("pointerdown", 22, x, y(25));
    touch("pointermove", 22, x, y(40));
    chart.render();
    touch("pointerup", 22, x, y(40), 0);
    chart.render();
    expect(moves.map(({ phase }) => phase)).toEqual(["preview", "commit"]);
    // The tap beside the drag clicks nothing.
    touch("pointerup", 21, lx, ly, 0);
    expect(clicks).toEqual([]);
  });

  it("goes back when the facet it is dragged in goes before it is dropped", async () => {
    host.style.width = "800px";
    const rows = table({ t: [0, 1, 0, 1], v: [10, 50, 10, 50], f: ["A", "A", "B", "B"] });
    const chart = await mount({
      marks: [line(rows, { x: "t", y: "v" }), rule({ id: "limit", y: 25, drag: true })],
      facet: facet("f", { columns: 2 }),
    });
    const moves = heard(chart, "itemMove");
    const rect = chart.root.getBoundingClientRect();
    const at = (value: number, axis: "x" | "y") => chart.toPixel(value, { panel: "B", axis })!;
    const x = at(0.5, "x");
    pointer(chart, "pointerdown", x, at(25, "y"), 1);
    pointer(chart, "pointermove", x, at(40, "y"), 1);
    chart.render();
    rows.reset({ t: [0, 1], v: [10, 50], f: ["A", "A"] });
    chart.render();
    chart.root.dispatchEvent(
      new PointerEvent("pointerup", {
        bubbles: true,
        pointerId: MOUSE,
        clientX: rect.left + x,
        clientY: rect.top + 100,
      }),
    );
    expect(moves.map(({ phase }) => phase)).toEqual(["preview", "cancel"]);
    // The cancel names the panel the previews did, though one panel is left.
    expect(moves.map(({ panels }) => panels)).toEqual([["B"], ["B"]]);
  });

  it("keeps touches that drag it from scrolling the page", async () => {
    // A horizontal rule moves along y, the zoom's pans along x: touches take both.
    const chart = await mount();
    expect(chart.root.style.touchAction).toBe("none");
    chart.update({ interaction: { zoom: false, select: false } });
    expect(chart.root.style.touchAction).toMatch(/^pan-x/);
  });

  it("commits where it was when its release went elsewhere, and lets the pointer go", async () => {
    // Released outside the chart before it took the pointer: the next move has no button held.
    const chart = await mount();
    const moves = heard(chart, "itemMove");
    await dragRule(chart, [40], false);
    pointer(chart, "pointermove", 10, 10);
    chart.render();
    expect(moves.map(({ phase }) => phase)).toEqual(["preview", "commit"]);
    expect(moves.at(-1)!.position!.y).toBeCloseTo(40, 0);
    expect(chart.root.hasPointerCapture(MOUSE)).toBe(false);
  });

  it("moves in the chart dragging it alone, though another chart draws the same mark", async () => {
    const threshold = rule({ id: "threshold", y: 25, drag: true });
    const chart = await mount({ marks: [lines(), threshold] });
    const other = document.createElement("div");
    other.style.cssText = "width:600px;height:300px";
    host.after(other);
    const second = createChart(other, { renderer: "svg", marks: [lines(), threshold] });
    charts.push(second);
    try {
      await dragRule(chart, [45], false);
      second.render();
      expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(45, { axis: "y" })!, 0);
      expect(ruleAt(second)).toBeCloseTo(second.toPixel(25, { axis: "y" })!, 0);
      // Destroyed while dragging, it leaves the mark where its options put it.
      chart.destroy();
      second.render();
      expect(ruleAt(second)).toBeCloseTo(second.toPixel(25, { axis: "y" })!, 0);
    } finally {
      other.remove();
    }
  });

  it("names the panel it moves in, and the scale it is on, for times in JSON", async () => {
    const day = Date.UTC(2026, 0, 1);
    const days = table({ t: [day, day + 864e5, day + 2 * 864e5], v: [1, 3, 2] });
    host.style.width = "800px";
    const chart = await mount({
      marks: [
        line(metrics(), { x: "t", y: "v", panel: "a" }),
        line(days, { x: "t", y: "v", panel: "b" }),
        rule({ id: "deploy", x: day + 864e5, drag: true, panel: "b" }),
      ],
      x: { type: "time", scope: "panel" },
      panels: panels([{ id: "a" }, { id: "b" }], columns([1, 1], [panel("a"), panel("b")])),
    });
    const moves = heard(chart, "itemMove");
    const at = (value: number) => chart.toPixel(value, { panel: "b", axis: "x" })!;
    const y = chart.toPixel(2, { panel: "b", axis: "y" })!;
    pointer(chart, "pointerdown", at(day + 864e5), y, 1);
    pointer(chart, "pointermove", at(day + 1.5 * 864e5), y, 1);
    pointer(chart, "pointerup", at(day + 1.5 * 864e5), y);
    const event = moves.at(-1)!;
    expect(event).toMatchObject({ markId: "deploy", phase: "commit", panels: ["b"] });
    expect(event.position!.x).toBeCloseTo(day + 1.5 * 864e5, -5);
    expect(itemMovePayload(chart, event)).toMatchObject({ panel: "b", time: ["x"] });
  });

  it("reports a rule on the right axis as there, its time read on that scale", async () => {
    const day = Date.UTC(2026, 0, 1);
    const chart = await mount({
      marks: [
        lines(),
        line(table({ t: [0, 4], when: [day, day + 4 * 864e5] }), {
          x: "t",
          y: "when",
          axis: "right",
        }),
        rule({ id: "due", y: day + 2 * 864e5, axis: "right", drag: true }),
      ],
      yRight: { type: "time" },
    });
    const moves = heard(chart, "itemMove");
    const at = (value: number) => chart.toPixel(value, { axis: "yRight" })!;
    const x = chart.toPixel(2, { axis: "x" })!;
    pointer(chart, "pointerdown", x, at(day + 2 * 864e5), 1);
    pointer(chart, "pointermove", x, at(day + 3 * 864e5), 1);
    pointer(chart, "pointerup", x, at(day + 3 * 864e5));
    const event = moves.at(-1)!;
    expect(event).toMatchObject({ markId: "due", phase: "commit", axis: "right" });
    expect(event.position!.y).toBeCloseTo(day + 3 * 864e5, -5);
    expect(itemMovePayload(chart, event).time).toEqual(["y"]);
  });

  it("shows the pointer it moves along over it", async () => {
    const chart = await mount();
    const x = chart.toPixel(2, { axis: "x" })!;
    pointer(chart, "pointermove", x, chart.toPixel(25, { axis: "y" })! + 2);
    expect(chart.root.style.cursor).toBe("ns-resize");
    pointer(chart, "pointermove", x, chart.toPixel(45, { axis: "y" })!);
    expect(chart.root.style.cursor).toBe("");
  });

  it("adds A4's right-click annotation, which then drags", async () => {
    let notes: number[] = [];
    const marks = () => [lines(), ...notes.map((y, i) => rule({ id: `note ${i}`, y, drag: true }))];
    const chart = await mount({ marks: marks() });
    chart.on("contextMenu", ({ pointer }) => {
      if (!pointer.inPlot || pointer.values.y === undefined) return;
      notes = [...notes, pointer.values.y];
      chart.update({ marks: marks() });
    });
    chart.on("itemMove", ({ markId, phase, position }) => {
      if (phase !== "commit" || !markId || position?.y === undefined) return;
      notes = notes.map((y, i) => (`note ${i}` === markId ? position.y! : y));
      chart.update({ marks: marks() });
    });
    pointer(
      chart,
      "contextmenu",
      chart.toPixel(1, { axis: "x" })!,
      chart.toPixel(25, { axis: "y" })!,
    );
    chart.render();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toBeCloseTo(25, 0);
    await dragRule(chart, [45]);
    chart.render();
    expect(notes[0]).toBeCloseTo(45, 0);
    expect(ruleAt(chart)).toBeCloseTo(chart.toPixel(45, { axis: "y" })!, 0);
  });
});

describe("drag on a rule", () => {
  it("is refused over a table, and for places that are not values", () => {
    const rows = table({ y: [1, 2] });
    expect(() => rule(rows, { y: "y", drag: true } as never)).toThrow(
      "rule drag: rules over a table move with their rows; drag a rule of a value",
    );
    expect(() => rule({ y: { fraction: 0.5 }, drag: true })).toThrow(
      "rule drag: a dragged rule stands at a number or a date along its axis; give y one",
    );
    expect(() =>
      loadSpec({
        version: 1,
        data: { rows: { y: [1, 2] } },
        marks: [{ type: "rule", data: "rows", y: "y", drag: true }],
      } as never),
    ).toThrow("marks[0].drag: rules over a table move with their rows; drag a rule of a value");
  });
});
