// What a legend's entries do (`legend.action`): hide (the default), select
// the series they name (with state support), or nothing of the chart's own.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { legend } from "../../src/guides/options.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { chartState } from "../../src/state.ts";

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

const metrics = () => table({ t: [0, 1, 2], auth: [1, 3, 2], api: [2, 1, 4] });

async function mount(options: Partial<ChartOptions> = {}): Promise<Chart> {
  const chart = createChart(host, {
    errorMode: "throw",
    renderer: "svg",
    marks: [line(metrics(), { id: "lines", x: "t", y: ["auth", "api"] })],
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

const entry = (chart: Chart, label: string) =>
  [...chart.root.querySelectorAll("button")].find((b) => b.textContent === label)!;

function press(chart: Chart, label: string, init: MouseEventInit = {}) {
  entry(chart, label).dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1, ...init }));
  chart.render();
}

const AUTH = '["lines","auth"]';
const API = '["lines","api"]';

describe("a legend that selects", () => {
  it("selects the series an entry names, adds with Shift, and clears on the one selected", async () => {
    // A1's legend, selecting lines instead of hiding them.
    const chart = await mount({ state: chartState, legend: { action: "select" } });
    const selections = heard(chart, "select");
    const clicks = heard(chart, "click");
    press(chart, "auth");
    expect(chart.selection).toEqual({ kind: "series", series: [AUTH] });
    expect(selections.at(-1)).toMatchObject({ cause: "pointer", phase: "commit" });
    expect(entry(chart, "auth").getAttribute("aria-pressed")).toBe("true");
    expect(entry(chart, "api").getAttribute("aria-pressed")).toBe("false");
    expect(entry(chart, "api").title).toBe("Select api");
    expect(entry(chart, "api").style.opacity).toBe("0.4");
    press(chart, "api", { shiftKey: true });
    expect(chart.selection).toEqual({ kind: "series", series: [API, AUTH] });
    press(chart, "api", { shiftKey: true });
    expect(chart.selection).toEqual({ kind: "series", series: [AUTH] });
    press(chart, "auth");
    expect(chart.selection).toBeNull();
    expect(entry(chart, "api").style.opacity).toBe("");
    // Nothing hid; every press still reports a click on its entry.
    expect(chart.getHiddenKeys()).toEqual([]);
    expect(clicks.map(({ target }) => target?.kind)).toEqual(Array(4).fill("legendEntry"));
  });

  it("selects from the keyboard, as the button's own click", async () => {
    const chart = await mount({ state: chartState, legend: { action: "select" } });
    const selections = heard(chart, "select");
    press(chart, "api", { detail: 0 });
    expect(selections.at(-1)).toMatchObject({ cause: "keyboard" });
    expect(chart.selection).toEqual({ kind: "series", series: [API] });
  });

  it("in a legend the guides list, too", async () => {
    const chart = await mount({
      state: chartState,
      legend: false,
      guides: [legend({ action: "select" })],
    });
    press(chart, "api");
    expect(chart.selection).toEqual({ kind: "series", series: [API] });
  });

  it("selects a layout mark's items, as a pie's slices", async () => {
    const chart = await mount({
      state: chartState,
      legend: { action: "select" },
      marks: [
        pie(table({ fruit: ["apple", "pear", "fig"], n: [3, 2, 1] }), {
          id: "slices",
          category: "fruit",
          value: "n",
        }),
      ],
    });
    press(chart, "pear");
    const selection = chart.selection;
    expect(selection?.kind === "items" && selection.items).toEqual(['["slices","pear"]']);
    expect(entry(chart, "pear").getAttribute("aria-pressed")).toBe("true");
    press(chart, "fig", { shiftKey: true });
    expect(chart.selection).toMatchObject({
      kind: "items",
      items: ['["slices","fig"]', '["slices","pear"]'],
    });
    press(chart, "apple");
    expect(chart.selection).toMatchObject({ kind: "items", items: ['["slices","apple"]'] });
  });

  it("needs state support", async () => {
    const errors: string[] = [];
    const chart = createChart(host, {
      marks: [line(metrics(), { x: "t", y: ["auth", "api"] })],
      legend: { action: "select" },
      onError: (error) => errors.push(`${error.code} ${error.message}`),
    });
    charts.push(chart);
    // Refused once the interaction code reads the options: `loading` rejects.
    await chart.loading?.catch(() => {});
    expect(errors).toEqual([
      "unsupported legend action: needs state support; give the chart state: chartState, from herceg/state",
    ]);
  });
});

describe("a legend that does nothing", () => {
  it("hides nothing, and reports the click", async () => {
    const chart = await mount({ legend: { action: false } });
    const clicks = heard(chart, "click");
    const visibility = heard(chart, "visibility");
    press(chart, "auth");
    expect(chart.getHiddenKeys()).toEqual([]);
    expect(visibility).toEqual([]);
    expect(clicks.map(({ target }) => target?.kind)).toEqual(["legendEntry"]);
    expect(entry(chart, "auth").hasAttribute("aria-pressed")).toBe(false);
  });

  it("shows nothing hidden more widely than its entry, a mark whole", async () => {
    for (const action of [false, "select"] as const) {
      const chart = await mount({ state: chartState, legend: { action } });
      const whole = '{"mark":"lines"}';
      chart.setHiddenKeys([whole]);
      chart.render();
      press(chart, "auth");
      expect(chart.getHiddenKeys(), String(action)).toEqual([whole]);
      chart.destroy();
    }
  });
});

describe("a legend that hides", () => {
  it("still hides by default, and with action hide", async () => {
    const hidden: (readonly string[])[] = [];
    for (const legendOption of [true, { action: "hide" as const }]) {
      const chart = await mount({ legend: legendOption });
      press(chart, "auth");
      hidden.push(chart.getHiddenKeys());
      chart.destroy();
    }
    expect(hidden[0]).toHaveLength(1);
    expect(hidden[1]).toEqual(hidden[0]);
  });

  it("says so again on its entries once it selected or did nothing", async () => {
    const chart = await mount({ state: chartState, legend: { action: "select" } });
    press(chart, "auth");
    const hiding = (label: string) => {
      const button = entry(chart, label);
      return [button.getAttribute("aria-pressed"), button.title, button.style.opacity];
    };
    for (const action of [false, "select"] as const) {
      chart.update({ legend: { action } });
      chart.render();
      chart.update({ legend: { action: "hide" } });
      chart.render();
      expect(hiding("api"), String(action)).toEqual(["true", "Hide api", ""]);
      expect(hiding("auth"), String(action)).toEqual(["true", "Hide auth", ""]);
    }
  });
});
