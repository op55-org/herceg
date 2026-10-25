// Restoring a chart's state into one mounted in its place (as a Streamlit
// app remounts its chart on each run): its views (restoreViewportState) and
// what it hides (restoreVisibility). The fixture's remount cases
// (viewport-events.test.ts) prove which views carry over.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { category, time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { restoreVisibility, visibilityState } from "../../src/from-spec.ts";
import { graph } from "../../src/marks/graph.ts";
import { line } from "../../src/marks/line.ts";
import { panels } from "../../src/model/panels.ts";
import {
  restoreViewportState,
  type ViewportStatePayload,
  viewportStatePayload,
} from "../../src/web/events.ts";

let host: HTMLDivElement;
const mounted: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:640px;height:400px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of mounted.splice(0)) chart.destroy();
  host.remove();
});

function mount(options: ChartOptions): Chart {
  const chart = createChart(host, { locale: "en-US", animation: false, ...options });
  mounted.push(chart);
  return chart;
}

const rows = table({
  t: [0, 1, 0, 1],
  v: [1, 2, 3, 4],
  w: [5, 6, 7, 8],
  g: category(["x", "x", "y", "y"]),
});

describe("restoreViewportState", () => {
  const twoPanels = (): ChartOptions => ({
    marks: [line(rows, { x: "t", y: "v", panel: "a" }), line(rows, { x: "t", y: "w", panel: "b" })],
    panels: panels([{ id: "a" }, { id: "b" }]),
  });

  it("refuse a state of another shape whole, changing nothing", async () => {
    const chart = mount(twoPanels());
    const { scales } = viewportStatePayload(chart);
    const [x] = scales;
    const views: ChartEvents["viewport"][] = [];
    chart.on("viewport", (event) => views.push(event));
    const refused = async (state: unknown, path: string, message: string) => {
      await expect(
        restoreViewportState(chart, state as ViewportStatePayload),
      ).rejects.toMatchObject({ code: "invalid-option", path, message });
      expect(chart.getViewport({ panel: "a" })).toEqual({ x: null, y: null, yRight: null });
    };
    await refused(
      { scales: "x" },
      "scales",
      "restoreViewportState scales: expected a list of instances' views; give a state viewportStatePayload made",
    );
    // A good view before a bad one is not set either.
    await refused(
      {
        scales: [
          { ...x, view: [0, 1] },
          { ...x, view: [3, 1] },
        ],
      },
      "scales[1].view",
      "restoreViewportState scales[1].view: expected null or two ascending finite numbers; give the view as viewportStatePayload wrote it",
    );
    await refused(
      {
        scales: [
          { ...x, view: [0, 1] },
          { ...x, view: [0, 2] },
        ],
      },
      "scales[1]",
      "restoreViewportState scales[1]: holds another view of an instance listed before; give each instance once",
    );
    await refused(
      { scales: [{ view: [0, 1] }] },
      "scales[0]",
      'restoreViewportState scales[0]: expected a scale ("x", "y", or "yRight") and its identity; give an entry viewportStatePayload made',
    );
    expect(views).toEqual([]);
  });

  it("give the view getViewport gives without a panel, and each instance's identity", () => {
    const chart = mount({ ...twoPanels(), x: { scope: "chart" } });
    chart.setViewport({ x: [0.2, 0.8] });
    const state = viewportStatePayload(chart);
    expect(state.view).toEqual({ x: [0.2, 0.8], y: null, yRight: null, time: [] });
    expect(new Set(state.scales.map(({ identity }) => identity)).size).toBe(state.scales.length);
  });

  it("wait for a chart still loading its panels, then report what it restored once", async () => {
    const before = mount({ ...twoPanels(), x: { scope: "chart" } });
    before.setViewport({ x: [0.2, 0.8] });
    before.setViewport({ y: [0, 3] }, { panel: "a" });
    const state = viewportStatePayload(before);
    before.destroy();
    const chart = mount({ ...twoPanels(), x: { scope: "chart" } });
    const views: ChartEvents["viewport"][] = [];
    chart.on("viewport", (event) => views.push(event));
    const restored = await restoreViewportState(chart, state);
    expect(views.map(({ cause, scales }) => [cause, scales.length])).toEqual([["options", 2]]);
    expect(restored.scales).toEqual(state.scales.map((entry) => ({ ...entry })));
    expect(chart.getViewport({ panel: "a" })).toEqual({ x: [0.2, 0.8], y: [0, 3], yRight: null });
    // Nothing more to restore: no event.
    await restoreViewportState(chart, state);
    expect(views).toHaveLength(1);
  });
});

describe("restoreViewportState, with a chart already showing views", () => {
  const twoPanels = (keys = ["a", "b"]): ChartOptions => ({
    marks: keys.map((key) => line(rows, { x: "t", y: "v", panel: key })),
    panels: panels(keys.map((id) => ({ id }))),
    x: { scope: "chart" },
  });

  it("read the panels a change pending to them leaves", () => {
    const chart = mount(twoPanels());
    chart.render();
    chart.update(twoPanels(["a"]));
    const state = viewportStatePayload(chart);
    expect(state.views.map(({ panel }) => panel)).toEqual(["a"]);
  });

  it("read a chart of one panel as a change of its x pending draws it", () => {
    const chart = mount({ marks: [line(rows, { x: "t", y: "v" })] });
    chart.render();
    chart.setViewport({ x: [0.2, 0.8] });
    chart.update({ marks: [line(rows, { x: "g", y: "v" })] });
    const state = viewportStatePayload(chart);
    const x = state.scales.find(({ scale }) => scale === "x")!;
    expect(JSON.parse(x.identity)).toEqual(["x", "band", ""]);
    expect(x.view).toBeNull();
    // Of the categories the new x draws, which do not zoom, not of the numbers it replaced.
    expect(state.view?.x).toBeNull();
  });

  it("read one scene, though a listener of the frame reading draws changes the chart again", () => {
    const chart = mount({ marks: [line(rows, { x: "t", y: "v" })] });
    chart.render();
    chart.update({ marks: [line(rows, { x: "t", y: "w" })] });
    let once = true;
    chart.on("render", () => {
      if (once)
        chart.update({ marks: [line(table({ t: time([0, 1]), v: [1, 2] }), { x: "t", y: "v" })] });
      once = false;
    });
    const state = viewportStatePayload(chart);
    const x = state.scales.find(({ scale }) => scale === "x")!;
    expect(JSON.parse(x.identity)).toEqual(["x", "linear", ""]);
    expect(state.views[0]!.time).toEqual([]);
    expect(state.view?.time).toEqual([]);
  });

  it("read one scene of axes beside a network's plane, though a listener changes the chart again", async () => {
    const network = graph(table({ id: ["u", "v"], source: ["u", "v"], target: ["v", "u"] }), {
      source: "source",
      target: "target",
      panel: "p",
    });
    const options = (t: number[] | ReturnType<typeof time>): ChartOptions => ({
      marks: [network, line(table({ t, v: [1, 2] }), { x: "t", y: "v", panel: "a" })],
      panels: panels([{ id: "p" }, { id: "a" }]),
      x: { scope: "chart" },
    });
    const chart = mount(options([0, 1]));
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    chart.setViewport({ x: [0.1, 0.8] });
    chart.update(options([0, 1]));
    let once = true;
    chart.on("render", () => {
      if (once) chart.update(options(time([0, 1])));
      once = false;
    });
    const state = viewportStatePayload(chart);
    const x = state.scales.find(({ scale }) => scale === "x")!;
    expect(JSON.parse(x.identity)).toEqual(["x", "linear", ""]);
    expect(x.view).toEqual([0.1, 0.8]);
    expect(state.view).toMatchObject({ x: [0.1, 0.8], time: [] });
  });

  it("fit what the state has fitted, and what it does not have", async () => {
    const chart = mount(twoPanels());
    const fitted = viewportStatePayload(chart);
    chart.setViewport({ x: [0.2, 0.4] });
    chart.setViewport({ y: [0, 2] }, { panel: "b" });
    const views: ChartEvents["viewport"][] = [];
    chart.on("viewport", (event) => views.push(event));
    await restoreViewportState(chart, fitted);
    expect(chart.getViewport({ panel: "a" })).toEqual({ x: null, y: null, yRight: null });
    expect(chart.getViewport({ panel: "b" })).toEqual({ x: null, y: null, yRight: null });
    expect(views).toHaveLength(1);
    // Without the instances b had, which are fitted too.
    chart.setViewport({ y: [0, 2] }, { panel: "b" });
    await restoreViewportState(chart, {
      ...fitted,
      scales: fitted.scales.filter(({ panels: [first] }) => first === "a"),
    });
    expect(chart.getViewport({ panel: "b" }).y).toBeNull();
  });

  it("give way to a restore started while it waits", async () => {
    const chart = mount(twoPanels());
    chart.setViewport({ x: [0.1, 0.2] });
    const first = viewportStatePayload(chart);
    chart.setViewport({ x: [0.6, 0.9] });
    const second = viewportStatePayload(chart);
    chart.setViewport(null);
    // A restore a listener starts as the first draws wins.
    let started: Promise<unknown> | undefined;
    const stop = chart.on("render", () => {
      stop();
      started = restoreViewportState(chart, second);
    });
    const restoring = restoreViewportState(chart, first);
    await Promise.all([restoring, started]);
    expect(chart.getViewport().x).toEqual([0.6, 0.9]);
  });

  it("refuse an entry whose identity names another scale", async () => {
    const chart = mount(twoPanels());
    const { scales } = viewportStatePayload(chart);
    const x = scales.find(({ scale }) => scale === "x")!;
    await expect(
      restoreViewportState(chart, {
        ...viewportStatePayload(chart),
        scales: [{ ...x, scale: "y", view: [0, 1] }],
      }),
    ).rejects.toMatchObject({ code: "invalid-option", path: "scales[0]" });
    expect(chart.getViewport().x).toBeNull();
  });
});

describe("restoreVisibility", () => {
  const options = (withPanelB = true, withSeries = true): ChartOptions => ({
    marks: [
      line(rows, { x: "t", y: "v", id: "m", panel: "a" }),
      ...(withSeries ? [line(rows, { x: "t", y: "w", series: "g", panel: "a" })] : []),
      ...(withPanelB ? [line(other, { x: "t", y: "w", panel: "b" })] : []),
    ],
    panels: panels(withPanelB ? [{ id: "a" }, { id: "b" }] : [{ id: "a" }]),
  });
  // What series stand for: mark m's, by its id, as its table has no name;
  // the values of g; the last mark's, of a table of its own, by its index.
  const other = table({ t: [0, 1], w: [5, 6] });
  const BY_ID = '{"table":{"mark":"m"},"value":"v"}';
  const X = '{"field":"g","value":"x"}';
  const Y = '{"field":"g","value":"y"}';
  const BY_INDEX = '{"table":{"mark":2},"value":"w"}';

  it("restore what marks of ids and what series stand for hid, as one change", async () => {
    const before = mount(options());
    expect(before.getLegend().map(({ key }) => key)).toEqual([BY_ID, X, Y, BY_INDEX]);
    before.setVisibility([BY_ID, BY_INDEX, X], false);
    before.setVisibility(Y, false, { panel: "b" });
    const state = visibilityState(before);
    expect(new Set(state.hiddenKeys)).toEqual(new Set([BY_ID, BY_INDEX, X]));
    expect(state.panels).toEqual({ b: { hidden: [Y], shown: [] } });
    before.destroy();

    const chart = mount(options());
    const heard: ChartEvents["visibility"][] = [];
    chart.on("visibility", (event) => heard.push(event));
    const restored = await restoreVisibility(chart, state);
    // A table named by a mark's index goes: another mark may take the place.
    expect(new Set(restored.hiddenKeys)).toEqual(new Set([BY_ID, X]));
    expect(restored.panels).toEqual({ b: { hidden: [Y], shown: [] } });
    expect(heard).toHaveLength(1);
    expect(visibilityState(chart)).toEqual(restored);
  });

  it("hear no change set as a visibility event gave it", () => {
    const chart = mount(options());
    chart.render();
    const heard: ChartEvents["visibility"][] = [];
    chart.on("visibility", (event) => heard.push(event));
    chart.setVisibility(Y, false, { panel: "b" });
    const [{ hiddenKeys, panels }] = heard as [ChartEvents["visibility"]];
    chart.setHiddenKeys(hiddenKeys, { panels });
    chart.setHiddenKeys(hiddenKeys, { panels });
    expect(heard).toHaveLength(1);
  });

  it("let go of what panels gone and values no longer drawn hid", async () => {
    const before = mount(options());
    before.setVisibility([BY_ID, X], false);
    before.setVisibility(Y, false, { panel: "b" });
    const state = visibilityState(before);
    before.destroy();
    const restored = await restoreVisibility(mount(options(false, false)), state);
    expect(restored).toEqual({ hiddenKeys: [BY_ID] });
  });

  it("give the state it waits to restore meanwhile", async () => {
    const chart = mount(options());
    // Showing a selection loads the brush that draws it.
    chart.select({ x: [0.2, 0.5], y: null, lasso: null }, { panel: "a" });
    expect(chart.loading).toBeDefined();
    const state = { hiddenKeys: [X] };
    const restoring = restoreVisibility(chart, state);
    expect(visibilityState(chart)).toBe(state);
    expect(chart.getHiddenKeys()).toEqual([]);
    await restoring;
    expect(chart.getHiddenKeys()).toEqual([X]);
  });
});
