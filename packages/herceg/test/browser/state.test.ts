// A chart's state from outside: state options and their equality, writing
// reported state back, conditional writes, conditions, selections of items
// and series, and static exports' state options.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileExpression } from "../../src/data/expression.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { geopoint } from "../../src/marks/geopoint.ts";
import { graph } from "../../src/marks/graph.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { line } from "../../src/marks/line.ts";
import { pie } from "../../src/marks/pie.ts";
import { point } from "../../src/marks/point.ts";
import { point3d } from "../../src/marks/point3d.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import { facet } from "../../src/model/facet.ts";
import { panels } from "../../src/model/panels.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { renderToSVG } from "../../src/render/static.ts";
import { ChartError } from "../../src/spec/errors.ts";
import type { Look } from "../../src/spec/state.ts";
import { brushOf } from "../helpers/selections.ts";
import { sceneOf } from "./contracts/mount.ts";
import { MOUSE } from "./helpers.ts";
import { hasWebGL2 } from "./webgl.ts";

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

function mount(options: Partial<ChartOptions> = {}, into = host): Chart {
  const chart = createChart(into, {
    errorMode: "throw",
    marks: [line(data(), { x: "t", y: "v" })],
    interaction: { brush: "x" },
    ...options,
  });
  charts.push(chart);
  return chart;
}

function heard<K extends keyof ChartEvents>(chart: Chart, type: K): ChartEvents[K][] {
  const events: ChartEvents[K][] = [];
  chart.on(type, (event) => events.push(event));
  return events;
}

/** That `call` throws a ChartError of `code` whose message says `says`. */
function expectRefused(call: () => unknown, code: string, says: RegExp) {
  let thrown: unknown;
  try {
    call();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ChartError);
  expect((thrown as ChartError).code).toBe(code);
  expect((thrown as ChartError).message).toMatch(says);
}

const brush = (x: readonly [number, number]) =>
  ({ kind: "brush", x, y: null, lasso: null }) as const;

describe("a chart", () => {
  it("takes state options, conditional writes, pins, and items, as it is made", async () => {
    const chart = mount({
      marks: [point(data(), { id: "dots", x: "t", y: "v", itemKey: "t" })],
      inspection: { mode: "nearest" },
      interaction: { select: "items" },
      selection: { kind: "items", items: [{ mark: "dots", item: [1] }] },
      viewport: { x: [0, 3] },
      visibility: { hidden: [] },
    });
    expect(chart.selection).toEqual({ kind: "items", items: ['["dots",1]'] });
    expect(chart.getViewport().x).toEqual([0, 3]);
    // A write on a basis older than the change since is refused.
    const basis = chart.basis;
    chart.setViewport({ x: [1, 2] });
    chart.setViewport({ x: [0, 4] }, { expected: basis });
    expect(chart.getViewport().x).toEqual([1, 2]);
    chart.setViewport({ x: [0, 4] }, { expected: chart.basis });
    expect(chart.getViewport().x).toEqual([0, 4]);
    // Pinned by a reference, and read at once.
    const pins = heard(chart, "pin");
    chart.pin({ item: { mark: "dots", item: [2] } });
    expect(chart.pinned).toMatchObject({ item: '["dots",2]' });
    await chart.loading;
    expect(pins.at(-1)?.at).toMatchObject({ item: '["dots",2]' });
    // What a selection holds, at once.
    const selects = heard(chart, "select");
    chart.select([1, 2]);
    expect(selects[0]!.conditions).toHaveLength(1);
    // A tree's drill root.
    const tree = table({ a: ["x", "x", "y"], b: ["p", "q", "r"], v: [1, 2, 3] });
    const rings = mount(
      {
        marks: [sunburst(tree, { path: ["a", "b"], value: "v" })],
        interaction: { zoom: true },
        drillRoot: ["x"],
      },
      document.body.appendChild(document.createElement("div")),
    );
    rings.render();
    expect(rings.getDrillRoot()?.key).not.toBeNull();
  });
});

describe("state options", () => {
  it("give the first state", () => {
    const chart = mount({
      selection: brush([1, 2]),
      viewport: { x: [0, 3] },
      visibility: { hidden: ["v"] },
    });
    expect(chart.selection).toEqual(brush([1, 2]));
    expect(chart.getViewport().x).toEqual([0, 3]);
    expect(chart.getHiddenKeys()).toEqual(["v"]);
  });

  it("give the whole view: an axis left out is not zoomed, the right one too", () => {
    const source = data();
    const chart = mount({
      marks: [line(source, { x: "t", y: "v" }), line(source, { x: "t", y: "w", axis: "right" })],
      viewport: { x: [1, 3], yRight: [2, 3] },
    });
    chart.render();
    expect(chart.getViewport().yRight).toEqual([2, 3]);
    chart.update({ viewport: { x: [0, 1] } });
    expect(chart.getViewport()).toMatchObject({ x: [0, 1], yRight: null });
  });

  it("change the state when their value changes, and only then", () => {
    const chart = mount({ selection: brush([1, 2]) });
    const events = heard(chart, "select");
    chart.update({ selection: brush([1, 2]) });
    // The same value written in another order of fields is the same value.
    chart.update({ selection: { lasso: null, y: null, x: [1, 2], kind: "brush" } });
    expect(events).toEqual([]);
    chart.update({ selection: brush([2, 3]) });
    expect(events.map(({ selection, cause }) => [brushOf(selection)?.x, cause])).toEqual([
      [[2, 3], "options"],
    ]);
    // The user's change stands until the option's value changes again.
    chart.select([0, 1]);
    chart.update({ selection: brush([2, 3]) });
    expect(brushOf(chart.selection)?.x).toEqual([0, 1]);
    // Given as undefined, the option is forgotten: its old value applies again.
    chart.update({ selection: undefined });
    chart.update({ selection: brush([2, 3]) });
    expect(brushOf(chart.selection)?.x).toEqual([2, 3]);
  });

  it("take what the chart reported back without a change or a loop", () => {
    const chart = mount({ interaction: { brush: "x", zoom: "x" } });
    const selects = heard(chart, "select");
    const views = heard(chart, "viewport");
    chart.on("select", (event) => chart.update({ selection: event.selection }));
    chart.on("viewport", (event) => chart.update({ viewport: event.state }));
    chart.select([1, 2]);
    chart.setViewport([0, 3]);
    expect(selects).toHaveLength(1);
    expect(views).toHaveLength(1);
    expect(chart.revision).toBe(selects[0]!.revision + 1);
  });

  it("take every state synced charts report back, with no loop", () => {
    const other = document.createElement("div");
    other.style.cssText = "width:600px;height:300px";
    host.after(other);
    const synced = {
      interaction: { brush: "x", zoom: "x", sync: "g" },
    } as const;
    const pair = [mount(synced), mount(synced, other)] as const;
    const selects = pair.map((chart) => heard(chart, "select"));
    const views = pair.map((chart) => heard(chart, "viewport"));
    // Each chart writes every state it reports back, as an adapter's two-way binding does.
    for (const chart of pair) {
      chart.on("select", (event) => chart.update({ selection: event.selection }));
      chart.on("viewport", (event) => chart.update({ viewport: event.state }));
    }
    for (const chart of pair) chart.render();
    pair[0].select([1, 2]);
    pair[0].setViewport({ x: [0, 3] });
    for (const chart of pair) chart.render();
    expect(selects.map((events) => events.map(({ cause }) => cause))).toEqual([["api"], ["sync"]]);
    expect(views.map((events) => events.length)).toEqual([1, 1]);
    expect(pair.map((chart) => brushOf(chart.selection)?.x)).toEqual([
      [1, 2],
      [1, 2],
    ]);
    other.remove();
  });

  it("report each state whole, with a basis", () => {
    const chart = mount();
    const views = heard(chart, "viewport");
    const hidden = heard(chart, "visibility");
    chart.setViewport({ x: [1, 2] });
    chart.setHiddenKeys(["v"]);
    expect(views[0]!.state).toEqual({ x: [1, 2], y: null, yRight: null });
    expect(hidden[0]!.state).toEqual({ hidden: ["v"] });
    expect(views[0]!.basis).toMatch(/:/);
    expect(chart.basis).toBe(hidden[0]!.basis);
  });

  it("name items and series by their keys, in one order", () => {
    const chart = mount({
      marks: [point(data(), { id: "dots", x: "t", y: "v" })],
    });
    chart.select({
      kind: "items",
      items: [{ mark: "dots", item: ["3"] }, '["dots","1"]', '["dots","3"]'],
    });
    expect(chart.selection).toEqual({ kind: "items", items: ['["dots","1"]', '["dots","3"]'] });
    expectRefused(
      () => chart.select({ kind: "series", series: [{ mark: "lines", series: "v" }] }),
      "unknown-reference",
      /no mark has the id "lines"/,
    );
    expectRefused(
      () => chart.select({ kind: "rows" } as never),
      "invalid-option",
      /selection kind: expected "brush", "items", or "series"/,
    );
    // None selected is no selection.
    chart.select({ kind: "series", series: [] });
    expect(chart.selection).toBeNull();
  });
});

describe("conditional writes", () => {
  it("are refused once the state changed since their basis, which is reported again", () => {
    const chart = mount();
    const basis = chart.basis;
    chart.select([1, 2]);
    const events = heard(chart, "select");
    chart.select([3, 4], { expected: basis });
    expect(brushOf(chart.selection)?.x).toEqual([1, 2]);
    expect(events.map(({ selection, cause }) => [brushOf(selection)?.x, cause])).toEqual([
      [[1, 2], "api"],
    ]);
    expect(events[0]!.revision).toBe(chart.revision);
    // Written on what is reported now, it applies.
    chart.select([3, 4], { expected: events[0]!.basis });
    expect(brushOf(chart.selection)?.x).toEqual([3, 4]);
  });

  it("are refused once a gesture changed the state since their basis", async () => {
    const chart = mount();
    await chart.loading;
    const reports = heard(chart, "select");
    chart.select([1, 2]);
    const answered = reports[0]!.basis!;
    // The user brushes again before the answer to the first report arrives.
    const rect = chart.root.getBoundingClientRect();
    const { plot } = chart.getPanels()[0]!;
    const send = (type: string, t: number) =>
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
    send("pointerdown", 3);
    send("pointermove", 4);
    send("pointerup", 4);
    const brushed = brushOf(chart.selection)?.x;
    expect(brushed?.[0]).toBeCloseTo(3, 1);
    chart.select([0, 1], { expected: answered });
    expect(brushOf(chart.selection)?.x).toEqual(brushed);
    expect(reports.at(-1)).toMatchObject({ cause: "api", phase: "commit" });
  });

  it("apply after changes of other state and of the data", () => {
    const source = data();
    const chart = mount({ marks: [line(source, { x: "t", y: "v" })] });
    const basis = chart.basis;
    chart.setViewport({ x: [0, 2] });
    chart.setHiddenKeys(["w"]);
    source.append({ t: [5], v: [2], w: [1] });
    chart.render();
    chart.select([1, 2], { expected: basis });
    expect(brushOf(chart.selection)?.x).toEqual([1, 2]);
    // A view's write is of the instances it sets: the y view was not changed.
    chart.setViewport({ y: [0, 4] }, { expected: basis });
    expect(chart.getViewport()).toMatchObject({ x: [0, 2], y: [0, 4] });
    // The x view was.
    chart.setViewport({ x: [1, 3] }, { expected: basis });
    expect(chart.getViewport().x).toEqual([0, 2]);
  });

  it("apply on a basis older than a refused write's, when nothing changed since it", () => {
    const chart = mount();
    const before = chart.basis;
    const reports = heard(chart, "select");
    chart.select([1, 2]);
    const answered = reports[0]!.basis!;
    chart.update({ title: "Latency" });
    // Refused, it reports the selection again: that report is no change.
    chart.select([3, 4], { expected: before });
    expect(reports).toHaveLength(2);
    chart.select([2, 3], { expected: answered });
    expect(brushOf(chart.selection)?.x).toEqual([2, 3]);
  });

  it("are refused over a camera changed and not reported yet", () => {
    const chart = mount({
      interaction: {},
      marks: [
        point3d(table({ x: [0, 1, 2], y: [0, 1, 2], z: [0, 1, 2] }), { x: "x", y: "y", z: "z" }),
      ],
    });
    chart.render();
    const basis = chart.basis;
    chart.setCamera({ azimuth: 40 });
    chart.setCamera({ azimuth: 90 }, { expected: basis });
    expect(chart.getCamera()?.azimuth).toBe(40);
  });

  it("are refused over a change made and not reported yet", () => {
    // Before the first frame, whose reports wait for it.
    const chart = mount();
    const basis = chart.basis;
    chart.select([0, 1]);
    chart.select([2, 3], { expected: basis });
    expect(brushOf(chart.selection)?.x).toEqual([0, 1]);
    // Inside a listener, while the report of a change made before waits for it.
    chart.render();
    const order: string[] = [];
    chart.on("viewport", ({ basis, cause }) => {
      if (cause !== "api" || order.length > 0) return;
      order.push("first");
      chart.setViewport({ x: [1, 2] });
      order.push("second");
      chart.setViewport({ x: [3, 4] }, { expected: basis });
    });
    chart.setViewport({ x: [0, 1] });
    expect(order).toEqual(["first", "second"]);
    expect(chart.getViewport().x).toEqual([1, 2]);
  });

  it("are refused over a change no listener heard, and one waiting for the first frame", () => {
    const [chart, peer] = [
      mount({ interaction: { zoom: "x", sync: { viewport: "pair" } } }),
      mount(
        { interaction: { zoom: "x", sync: { viewport: "pair" } } },
        document.body.appendChild(document.createElement("div")),
      ),
    ];
    chart.render();
    peer.render();
    const basis = chart.basis;
    peer.setViewport({ x: [1, 2] });
    chart.setViewport({ x: [3, 4] }, { expected: basis });
    expect(chart.getViewport().x).toEqual([1, 2]);
    // A subplot's selections wait for the first frame, which draws it.
    const subplots = mount(
      {
        panels: panels([{ id: "p" }]),
        marks: [line(data(), { x: "t", y: "v", panel: "p" })],
      },
      document.body.appendChild(document.createElement("div")),
    );
    const before = subplots.basis;
    subplots.select([0, 1], { panel: "p" });
    subplots.select([2, 3], { panel: "p", expected: before });
    subplots.render();
    expect(brushOf(subplots.selection)?.x).toEqual([0, 1]);
  });

  it("are refused over a reset made in a listener, before its report", () => {
    const chart = mount({ interaction: { zoom: "x" } });
    chart.render();
    chart.setViewport({ x: [0, 2] });
    let done = false;
    chart.on("viewport", ({ basis }) => {
      if (done) return;
      done = true;
      chart.setViewport(null);
      chart.setViewport({ x: [3, 4] }, { expected: basis });
    });
    chart.setViewport({ x: [1, 3] });
    expect(chart.getViewport().x).toBeNull();
  });

  it("check only the axes of a plane a write sets", () => {
    const people = table({ name: ["Ana", "Bo", "Cy"] });
    const talks = table({ from: ["Ana", "Bo"], to: ["Bo", "Cy"] });
    const chart = mount({
      interaction: { zoom: true },
      marks: [graph(talks, { source: "from", target: "to", nodes: people, node: "name" })],
    });
    chart.render();
    const basis = chart.basis;
    chart.setViewport({ x: [0, 10] });
    chart.setViewport({ y: [0, 20] }, { expected: basis });
    expect(chart.getViewport()).toMatchObject({ x: [0, 10], y: [0, 20] });
    chart.setViewport({ x: [5, 15] }, { expected: basis });
    expect(chart.getViewport().x).toEqual([0, 10]);
  });

  it("check every plane a reset resets, with the axes", () => {
    const people = table({ name: ["Ana", "Bo", "Cy"] });
    const talks = table({ from: ["Ana", "Bo"], to: ["Bo", "Cy"] });
    const network = (panel: string) =>
      graph(talks, { source: "from", target: "to", nodes: people, node: "name", panel });
    const planes = mount({
      interaction: { zoom: true },
      panels: panels([{ id: "a" }, { id: "b" }]),
      marks: [network("a"), network("b")],
    });
    planes.render();
    let basis = planes.basis;
    planes.setViewport({ x: [0, 10] }, { panel: "b" });
    planes.setViewport(null, { expected: basis });
    expect(planes.getViewport({ panel: "b" }).x).toEqual([0, 10]);
    const mixed = mount({
      interaction: { zoom: true },
      panels: panels([{ id: "a" }, { id: "p" }]),
      marks: [network("a"), line(data(), { x: "t", y: "v", panel: "p" })],
    });
    mixed.render();
    basis = mixed.basis;
    mixed.setViewport({ x: [0, 10] }, { panel: "a" });
    mixed.setViewport(null, { expected: basis });
    expect(mixed.getViewport({ panel: "a" }).x).toEqual([0, 10]);
  });

  it("check the subplot a write names without naming it", () => {
    const tree = table({ a: ["x", "x", "y"], b: ["p", "q", "r"], v: [1, 2, 3] });
    const chart = mount({
      interaction: { zoom: true },
      panels: panels([{ id: "rings" }]),
      marks: [sunburst(tree, { path: ["a", "b"], value: "v", panel: "rings" })],
    });
    chart.render();
    const basis = chart.basis;
    chart.setDrillRoot(["x"]);
    const drilled = chart.getDrillRoot({ panel: "rings" })?.key;
    expect(drilled).not.toBeNull();
    chart.setDrillRoot(null, { expected: basis });
    expect(chart.getDrillRoot({ panel: "rings" })?.key).toBe(drilled);
  });

  it("refuse a basis another chart reported, or one remounted since", () => {
    const old = mount();
    const basis = old.basis;
    old.destroy();
    const chart = mount();
    expectRefused(
      () => chart.select([1, 2], { expected: basis }),
      "invalid-option",
      /select expected: the basis is another chart's/,
    );
  });
});

describe("conditions", () => {
  it("say what a brush holds on each table, as conditions on its fields", () => {
    const source = data();
    const chart = mount({ marks: [line(source, { x: "t", y: "v" })] });
    const events = heard(chart, "select");
    chart.select([1, 3]);
    const [{ table: of, condition }] = events[0]!.conditions as [
      ChartEvents["select"]["conditions"][0],
    ];
    expect(of).toBe(source);
    const holds = compileExpression(condition, source);
    expect([0, 1, 2, 3, 4].filter((row) => holds.at(row))).toEqual([1, 2, 3]);
  });

  it("hold a mark's view's rows for an item or series, and a repeated mark's own", () => {
    const source = table({ t: [0, 1, 2], v: [1, 2, 3], s: ["a", "a", "b"] });
    const view = rowView(source, { filter: ["==", ["field", "t"], 0] });
    const store = selectionStore(source);
    const chart = mount({
      marks: [point(view, { id: "p", x: "t", y: "v", series: "s" })],
      rowSelection: rowSelection({ store, channel: "focus" }),
    });
    chart.render();
    chart.select({ kind: "series", series: [{ mark: "p", series: "a" }] });
    const held = store.get("focus")!;
    const rows = (selection: typeof held) =>
      selection.kind === "rows"
        ? [...selection.rows.positions()]
        : [0, 1, 2].filter((row) =>
            compileExpression(selection.expression as never, source).at(row),
          );
    expect(rows(held)).toEqual([0]);
    // A mark repeated in every facet's panel holds its rows in each.
    const hosts = table({ t: [0, 1, 0, 1], v: [1, 2, 3, 4], host: ["a", "a", "b", "b"] });
    const marks = table({ t: [0, 1], v: [2, 3] });
    const faceted = mount(
      {
        x: { scope: "panel" },
        facet: facet("host"),
        marks: [line(hosts, { x: "t", y: "v" }), point(marks, { x: "t", y: "v", facet: "repeat" })],
      },
      document.body.appendChild(document.createElement("div")),
    );
    faceted.render();
    const events = heard(faceted, "select");
    faceted.select([0, 1], { panel: "a" });
    const repeated = events[0]!.conditions.find(({ table: of }) => (of as unknown) === marks)!;
    const holds = compileExpression(repeated.condition, marks);
    expect([0, 1].filter((row) => holds.at(row))).toEqual([0, 1]);
  });

  it("hold a facet's rows for a brush drawn in its panel", () => {
    const source = table({
      t: [0, 1, 2, 0, 1, 2],
      v: [1, 2, 3, 4, 5, 6],
      host: ["a", "a", "a", "b", "b", "b"],
    });
    const chart = mount({
      x: { scope: "panel" },
      facet: facet("host"),
      marks: [line(source, { x: "t", y: "v" })],
    });
    chart.render();
    const events = heard(chart, "select");
    chart.select([0, 1], { panel: "a" });
    const [{ condition }] = events[0]!.conditions as [ChartEvents["select"]["conditions"][0]];
    const holds = compileExpression(condition, source);
    expect([0, 1, 2, 3, 4, 5].filter((row) => holds.at(row))).toEqual([0, 1]);
  });
});

describe("selections of items", () => {
  const pixel = (chart: Chart, x: number, y: number) => {
    const rect = chart.root.getBoundingClientRect();
    return [
      rect.left + chart.toPixel(x, { axis: "x" })!,
      rect.top + chart.toPixel(y, { axis: "y" })!,
    ] as const;
  };
  const click = (chart: Chart, x: number, y: number) => {
    const [clientX, clientY] = pixel(chart, x, y);
    for (const type of ["pointerdown", "pointerup"])
      chart.root.dispatchEvent(
        new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: MOUSE }),
      );
    chart.root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
  };

  it("hold the item clicked, not another mark's point of the same row", async () => {
    const source = data();
    const chart = mount({
      renderer: "svg",
      interaction: { select: "items" },
      marks: [
        point(source, { id: "v", x: "t", y: "v", fill: "#c00" }),
        point(source, { id: "w", x: "t", y: "w", fill: "#00c" }),
      ],
    });
    await chart.loading;
    const events = heard(chart, "select");
    click(chart, 3, 5);
    expect(events.map(({ selection }) => selection)).toEqual([
      { kind: "items", items: [expect.stringMatching(/^\["v",/)] },
    ]);
    await chart.loading;
    const points = sceneOf(chart).panels[0]!.marks.filter((g) => g.kind === "point") as unknown as {
      fill: string;
      count: number;
      fillOpacity: number;
    }[];
    // The red mark's point is drawn as it is, its others dimmed; the blue mark as it is.
    const red = points.filter(({ fill }) => fill === "#c00");
    expect(red.map(({ count, fillOpacity }) => [count, fillOpacity < 1])).toEqual([
      [4, true],
      [1, false],
    ]);
    expect(points.filter(({ fill }) => fill === "#00c").map(({ count }) => count)).toEqual([5]);
    // A click off the data clears it.
    click(chart, 0.5, 4.5);
    expect(chart.selection).toBeNull();
  });

  it("hold their observations as late rows of an ordered table move them", async () => {
    const feed = orderedTable({ t: [0, 2, 4], v: [1, 3, 5] }, { orderBy: "t" });
    const chart = mount({
      renderer: "svg",
      interaction: { select: "items" },
      marks: [point(feed, { id: "feed", x: "t", y: "v", fill: "#c00" })],
    });
    await chart.loading;
    click(chart, 2, 3);
    const chosen = chart.selection;
    expect(chosen?.kind).toBe("items");
    await chart.loading;
    // A late row lands before the one selected, which moves down a row.
    feed.append({ t: [1], v: [2] });
    chart.render();
    expect(chart.selection).toEqual(chosen);
    const points = sceneOf(chart).panels[0]!.marks.filter((g) => g.kind === "point") as unknown as {
      coords: Float32Array;
      count: number;
      fillOpacity: number;
    }[];
    const solid = points.find(({ count, fillOpacity }) => count === 1 && !(fillOpacity < 1))!;
    // Drawn solid where t is 2, in the chart's pixels.
    expect(solid.coords[0]).toBeCloseTo(chart.toPixel(2, { axis: "x" })!, 0);
  });
});

describe("looks", () => {
  it("give points and bars an outline of the look's stroke", async () => {
    const chart = mount({
      renderer: "svg",
      marks: [
        point(data(), {
          id: "dots",
          x: "t",
          y: "v",
          selected: { stroke: "#ff0000", strokeWidth: 2 },
        }),
      ],
    });
    chart.select({ kind: "series", series: [{ mark: "dots", series: "v" }] });
    await chart.loading;
    chart.render();
    const rings = sceneOf(chart)
      .panels[0]!.marks.filter((g) => g.kind === "point")
      .map((g) => (g as unknown as { ring?: { color: string; width: number } }).ring);
    expect(rings).toContainEqual(expect.objectContaining({ width: 2 }));
  });

  it.skipIf(!hasWebGL2())("outline points the GPU would draw in the look's stroke", async () => {
    const n = 100_000;
    const many = table({
      x: Float64Array.from({ length: n }, (_, i) => i % 1000),
      y: Float64Array.from({ length: n }, (_, i) => i % 7),
    });
    const chart = mount({
      marks: [
        point(many, {
          id: "dots",
          x: "x",
          y: "y",
          selected: { stroke: "#ff0000", strokeWidth: 6 },
        }),
      ],
    });
    chart.select({ kind: "series", series: [{ mark: "dots", series: "y" }] });
    await chart.loading;
    chart.render();
    const canvas = chart.root.querySelector("canvas")!;
    const { data } = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
    let red = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i]! > 200 && data[i + 1]! < 60 && data[i + 2]! < 60) red++;
    expect(red).toBeGreaterThan(0);
  });

  it("draw a selection in its looks beside rows a binding highlights in another table", async () => {
    const bound = data();
    const other = table({ t: [0, 1], v: [1, 2] });
    const chart = mount({
      renderer: "svg",
      marks: [
        line(bound, { x: "t", y: "v" }),
        point(other, { id: "dots", x: "t", y: "v", selected: { fill: "#ff0000" } }),
      ],
      rowSelection: rowSelection({ store: selectionStore(bound), channel: "focus" }),
    });
    chart.select({ kind: "series", series: [{ mark: "dots", series: "v" }] });
    await chart.loading;
    chart.render();
    const fills = sceneOf(chart)
      .panels[0]!.marks.filter((g) => g.kind === "point")
      .map((g) => (g as unknown as { fill: string }).fill);
    expect(fills).toContain("#ff0000");
  });

  it("draw points one by one where the look's fill is translucent, so overlaps darken", async () => {
    const opaque = async (selected: Look) => {
      const chart = mount({
        renderer: "svg",
        marks: [point(data(), { id: "dots", x: "t", y: "v", selected })],
      });
      chart.select({ kind: "series", series: [{ mark: "dots", series: "v" }] });
      await chart.loading;
      chart.render();
      const lit = sceneOf(chart).panels[0]!.marks.filter(
        (g) => g.kind === "point" && (g as { key?: string }).key?.endsWith("on"),
      );
      return lit.map((g) => (g as unknown as { opaque: boolean }).opaque);
    };
    expect(await opaque({ fill: "rgba(255, 0, 0, 0.5)" })).toEqual([false]);
    expect(await opaque({ fill: "#ff000080", fillOpacity: 1 })).toEqual([false]);
    expect(await opaque({ fill: "#ff0000" })).toEqual([true]);
  });

  it("draw a heatmap's selected cells in its look", async () => {
    const grid = table({ x: [0, 1, 0, 1], y: ["a", "a", "b", "b"], v: [1, 2, 3, 4] });
    const chart = mount({
      renderer: "svg",
      interaction: {},
      marks: [heatmap(grid, { id: "h", x: "x", y: "y", color: "v", selected: { opacity: 0 } })],
    });
    chart.select({ kind: "series", series: [{ mark: "h", series: "cells" }] });
    await chart.loading;
    chart.render();
    const selected = sceneOf(chart).panels[0]!.marks.filter((g) =>
      (g as { key?: string }).key?.endsWith("|selected"),
    );
    expect(selected.length).toBeGreaterThan(0);
    expect(
      selected.every((g) => (g as unknown as { draw: { opacity?: number } }).draw.opacity === 0),
    ).toBe(true);
  });

  it("draw an image of a heatmap's selected cells in its look's fill", async () => {
    // Cells two pixels wide, too small for squares: the selected cells are an image.
    const x = Array.from({ length: 400 }, (_, i) => i % 200);
    const grid = table({ x, y: x.map((_, i) => (i < 200 ? "a" : "b")), v: x });
    const raster = async (selected: Look) => {
      const chart = mount({
        interaction: {},
        marks: [heatmap(grid, { id: "h", x: "x", y: "y", color: "v", selected })],
      });
      chart.select({ kind: "series", series: [{ mark: "h", series: "cells" }] });
      await chart.loading;
      chart.render();
      const [image] = sceneOf(chart).panels[0]!.marks.filter(
        (g) => g.kind === "raster" && (g as { key?: string }).key?.endsWith("|selected"),
      );
      return image as unknown as { pixels: Uint8ClampedArray; draw: { opacity?: number } };
    };
    const { pixels } = await raster({ fill: "#ff0000" });
    const shown = new Set<string>();
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i + 3]! > 0) shown.add(pixels.subarray(i, i + 3).join());
    expect(shown).toEqual(new Set(["255,0,0"]));
    expect((await raster({ fillOpacity: 0 })).draw.opacity).toBe(0);
  });

  it("load a selection's looks as it is given, so the first frame waited for draws them", async () => {
    // Runs of styles, whose code loads before the first frame.
    const rows = table({ t: [0, 1, 2], v: [0, 2, 0], alpha: [0.2, 0.2, 0.4] });
    const encode = { opacity: { field: "alpha", scale: { type: "identity" } } } as const;
    const chart = mount({
      renderer: "svg",
      marks: [line(rows, { id: "l", x: "t", y: "v", encode, selected: { strokeWidth: 3 } })],
    });
    chart.select({ kind: "series", series: [{ mark: "l", series: "v" }] });
    await chart.loading;
    chart.render();
    const widths = sceneOf(chart)
      .panels[0]!.marks.filter((g) => g.kind === "line")
      .map((g) => (g as unknown as { strokeWidth: number }).strokeWidth);
    expect(widths).toContain(3);
  });

  it("draw a line's opacity in place of its own", async () => {
    const chart = mount({
      renderer: "svg",
      marks: [
        line(data(), { id: "l", x: "t", y: ["v", "w"], opacity: 0.2, selected: { opacity: 0.8 } }),
      ],
    });
    chart.select({ kind: "series", series: [{ mark: "l", series: "v" }] });
    await chart.loading;
    chart.render();
    const opacities = sceneOf(chart)
      .panels[0]!.marks.filter((g) => g.kind === "line")
      .map((g) => (g as unknown as { draw: { opacity?: number } }).draw.opacity);
    expect(
      opacities.some((opacity) => opacity !== undefined && Math.abs(opacity - 0.8) < 1e-6),
    ).toBe(true);
    expect(chart.toSVG()).not.toMatch(/opacity="4"|Infinity|NaN/);
  });

  it("draw a line's stroke opacity", async () => {
    const chart = mount({
      renderer: "svg",
      marks: [line(data(), { id: "l", x: "t", y: ["v", "w"], selected: { strokeOpacity: 0.1 } })],
    });
    chart.select({ kind: "series", series: [{ mark: "l", series: "v" }] });
    await chart.loading;
    chart.render();
    const opacities = sceneOf(chart)
      .panels[0]!.marks.filter((g) => g.kind === "line")
      .map((g) => (g as unknown as { draw: { opacity?: number } }).draw.opacity);
    expect(
      opacities.some((opacity) => opacity !== undefined && Math.abs(opacity - 0.1) < 1e-6),
    ).toBe(true);
  });

  it("draw a line's opacity in place of its runs' own, cut where they meet", async () => {
    // Runs of two opacities meeting at a turn, where each is cut.
    const rows = table({ t: [0, 1, 2], v: [0, 2, 0], alpha: [0.2, 0.2, 0.4] });
    const chart = mount({
      renderer: "svg",
      marks: [
        line(rows, {
          id: "l",
          x: "t",
          y: "v",
          strokeWidth: 8,
          encode: { opacity: { field: "alpha", scale: { type: "identity" } } },
          selected: { opacity: 0.8 },
        }),
      ],
    });
    chart.select({ kind: "series", series: [{ mark: "l", series: "v" }] });
    await chart.loading;
    chart.render();
    const runs = sceneOf(chart).panels[0]!.marks.filter(
      (g) => g.kind === "line" && (g as { key?: string }).key?.includes("|run"),
    );
    const drawn = runs.map((g) => g.draw);
    expect(drawn.some(({ holes }) => holes?.length)).toBe(true);
    expect(drawn.map(({ opacity }) => opacity)).toEqual(drawn.map(() => 0.8));
  });

  it("draw a look's dash on error bars", async () => {
    const rows = table({ g: ["a", "b"], lo: [1, 2], hi: [3, 4] });
    const chart = mount({
      renderer: "svg",
      marks: [
        errorbar(rows, {
          id: "e",
          x: "g",
          y1: "lo",
          y2: "hi",
          selected: { dash: "--", strokeWidth: 2 },
        }),
      ],
    });
    chart.select({ kind: "series", series: [{ mark: "e", series: "lo" }] });
    await chart.loading;
    chart.render();
    expect(chart.toSVG()).toMatch(/stroke-dasharray="[\d.]+ [\d.]+"/);
  });

  it("draw a named dash in proportion to the width drawn", async () => {
    const chart = mount({
      renderer: "svg",
      marks: [
        line(data(), { id: "l", x: "t", y: ["v", "w"], selected: { dash: "--", strokeWidth: 2 } }),
      ],
    });
    chart.select({ kind: "series", series: [{ mark: "l", series: "v" }] });
    await chart.loading;
    chart.render();
    const dashes = sceneOf(chart)
      .panels[0]!.marks.filter((g) => g.kind === "line")
      .map((g) => (g as unknown as { dash?: readonly number[] }).dash);
    expect(dashes).toContainEqual([7.4, 3.2]);
  });
});

describe("selections of layout items", () => {
  it("draw the rows a slice stands for, dimming the others", async () => {
    const sales = table({ region: ["a", "b", "c"], revenue: [3, 2, 1] });
    const chart = mount({
      renderer: "svg",
      interaction: {},
      marks: [pie(sales, { id: "slices", category: "region", value: "revenue" })],
    });
    chart.render();
    const before = JSON.stringify(sceneOf(chart).panels[0]!.marks);
    chart.select({ kind: "items", items: [{ mark: "slices", item: ["a"] }] });
    await chart.loading;
    chart.render();
    // Each slice's selected share drawn out over the dimmed pie: a's whole, the others' none.
    const lit = sceneOf(chart).panels[0]!.marks.find(
      (g) => (g as { key?: string }).key === "pie",
    ) as unknown as { arcs: Float32Array; rims: Float32Array };
    const outer = (slice: number) => lit.arcs[slice * 6 + 3]!;
    expect(outer(0)).toBeCloseTo(lit.rims[0]!);
    expect([outer(1), outer(2)].every((radius) => radius < lit.rims[0]! / 10)).toBe(true);
    chart.select(null);
    chart.render();
    expect(JSON.stringify(sceneOf(chart).panels[0]!.marks)).toBe(before);
  });
});

describe("selections of layout items in facets and of changed data", () => {
  /** The outer radius each slice's selected share is drawn out to, as a share of its rim. */
  const shares = (chart: Chart, panel: number) => {
    const lit = sceneOf(chart).panels[panel]!.marks.find(
      (g) => (g as { key?: string }).key === "pie",
    ) as unknown as { arcs: Float32Array; rims: Float32Array };
    return Array.from(lit.rims, (rim, i) => Math.round((lit.arcs[i * 6 + 3]! / rim) * 10) / 10);
  };

  it("draw each panel's own rows of the item", async () => {
    const sales = table({
      region: ["a", "b", "a", "b"],
      revenue: [3, 2, 1, 4],
      host: ["h1", "h1", "h2", "h2"],
    });
    const chart = mount({
      renderer: "svg",
      interaction: {},
      facet: facet("host"),
      marks: [pie(sales, { id: "slices", category: "region", value: "revenue" })],
    });
    chart.render();
    chart.select({ kind: "items", items: [{ mark: "slices", item: ["a"] }] });
    await chart.loading;
    chart.render();
    chart.getPanels().forEach(({ key }, i) => {
      const labels = chart
        .getItems({ mark: "slices", panel: key })!
        .items.map(({ label }) => label);
      expect(shares(chart, i)).toEqual(labels.map((label) => (label === "a" ? 1 : 0)));
    });
  });

  it("draw the item beside rows a binding highlights in another table", async () => {
    const sales = table({ region: ["a", "b"], revenue: [3, 2] });
    const costs = table({ region: ["a", "b"], cost: [1, 1] });
    const chart = mount({
      renderer: "svg",
      interaction: {},
      panels: panels([{ id: "sales" }, { id: "costs" }]),
      marks: [
        pie(sales, { id: "slices", category: "region", value: "revenue", panel: "sales" }),
        pie(costs, { category: "region", value: "cost", panel: "costs" }),
      ],
      rowSelection: rowSelection({ store: selectionStore(costs), channel: "focus" }),
    });
    chart.render();
    chart.select({ kind: "items", items: [{ mark: "slices", item: ["a"] }] });
    await chart.loading;
    chart.render();
    const labels = chart.getItems({ mark: "slices" })!.items.map(({ label }) => label);
    expect(shares(chart, 0)).toEqual(labels.map((label) => (label === "a" ? 1 : 0)));
  });

  it("draw the rows of the item in data replaced since, once laid out", async () => {
    const sales = table({ region: ["a", "b"], revenue: [3, 2] });
    const chart = mount({
      renderer: "svg",
      interaction: {},
      marks: [pie(sales, { id: "slices", category: "region", value: "revenue" })],
    });
    chart.render();
    chart.select({ kind: "items", items: [{ mark: "slices", item: ["a"] }] });
    await chart.loading;
    chart.render();
    sales.reset({ region: ["b", "a"], revenue: [2, 3] });
    chart.render();
    await Promise.resolve();
    chart.render();
    const labels = chart.getItems({ mark: "slices" })!.items.map(({ label }) => label);
    expect(shares(chart, 0)).toEqual(labels.map((label) => (label === "a" ? 1 : 0)));
  });

  it("select items and series on a chart of two maps, naming no plane", () => {
    const places = (id: string) =>
      geopoint(table({ lon: [0, 10], lat: [0, 10] }), {
        id,
        longitude: "lon",
        latitude: "lat",
        panel: id,
      });
    const chart = mount({
      projection: "equirectangular",
      interaction: {},
      panels: panels([{ id: "a" }, { id: "b" }]),
      marks: [places("a"), places("b")],
    });
    chart.render();
    chart.select({ kind: "items", items: [{ mark: "a", item: [0] }] });
    expect(chart.selection).toEqual({ kind: "items", items: ['["a",0]'] });
    chart.select({ kind: "series", series: [{ mark: "b", series: "b" }] });
    expect(chart.selection?.kind).toBe("series");
  });

  it("write the rows of a map layer's item, joined with another layer", () => {
    const one = table({ lon: [0, 10, 20], lat: [0, 5, 10] });
    const store = selectionStore(one);
    const chart = mount({
      interaction: {},
      projection: "equirectangular",
      marks: [
        geopoint(one, { id: "one", longitude: "lon", latitude: "lat" }),
        geopoint(table({ lon: [5], lat: [5] }), { id: "two", longitude: "lon", latitude: "lat" }),
      ],
      rowSelection: rowSelection({ store, channel: "picked" }),
    });
    chart.render();
    chart.select({ kind: "items", items: [{ mark: "one", item: [1] }] });
    const held = store.get("picked");
    expect(held?.kind === "rows" && [...held.rows.positions()]).toEqual([1]);
  });

  it("write a series' rows its mark's view shows, and draw what a view shows once changed", async () => {
    const source = table({
      t: [0, 1, 2, 3],
      v: [1, 3, 2, 5],
      w: [2, 1, 4, 3],
      k: ["a", "b", "a", "b"],
    });
    const view = rowView(source, { filter: ["<", ["field", "t"], 2] });
    const store = selectionStore(source);
    const chart = mount({
      renderer: "svg",
      marks: [line(view, { id: "l", x: "t", y: ["v", "w"] })],
      rowSelection: rowSelection({ store, channel: "focus" }),
    });
    chart.render();
    chart.select({ kind: "series", series: [{ mark: "l", series: "v" }] });
    const held = store.get("focus");
    expect(held?.kind === "rows" && [...held.rows.positions()]).toEqual([0, 1]);
    // Items named by value: a row the view shows later is held too.
    const bars = mount(
      {
        renderer: "svg",
        marks: [
          bar(view, { id: "b", x: "t", y: "v", itemKey: "k", selected: { fill: "#ff0000" } }),
        ],
      },
      document.body.appendChild(document.createElement("div")),
    );
    bars.select({ kind: "items", items: [{ mark: "b", item: ["a"] }] });
    await bars.loading;
    bars.render();
    const red = () =>
      sceneOf(bars)
        .panels[0]!.marks.filter(
          (g) => g.kind === "rect" && (g as { fill?: string }).fill === "#ff0000",
        )
        .reduce((sum, g) => sum + (g as unknown as { count: number }).count, 0);
    expect(red()).toBe(1);
    view.setQuery({});
    bars.render();
    expect(red()).toBe(2);
  });

  it("write a slice's condition, and a series of value fields its rows", () => {
    const sales = table({ region: ["a", "b", "a"], revenue: [3, 2, 1] });
    const store = selectionStore(sales);
    const chart = mount({
      interaction: {},
      marks: [pie(sales, { id: "slices", category: "region", value: "revenue" })],
      rowSelection: rowSelection({ store, channel: "focus" }),
    });
    chart.render();
    chart.select({ kind: "items", items: [{ mark: "slices", item: ["a"] }] });
    // Its category, of a positive value: rows 0 and 2.
    expect(store.get("focus")).toEqual({
      kind: "predicate",
      expression: [
        "and",
        ["==", ["field", "region"], "a"],
        [
          "and",
          [">=", ["field", "revenue"], Number.MIN_VALUE],
          ["<=", ["field", "revenue"], Number.MAX_VALUE],
        ],
      ],
    });
    const source = data();
    const wide = selectionStore(source);
    const lines = mount(
      {
        marks: [line(source, { id: "l", x: "t", y: ["v", "w"] })],
        rowSelection: rowSelection({ store: wide, channel: "focus" }),
      },
      document.body.appendChild(document.createElement("div")),
    );
    lines.render();
    lines.select({ kind: "series", series: [{ mark: "l", series: "v" }] });
    expect(wide.get("focus")).not.toBeNull();
  });
});

describe("selections of a custom mark's items", () => {
  it("hold the mark's own items: another mark's of the same rows hold none", async () => {
    const source = data();
    const seen: (string | undefined)[][] = [];
    const chart = mount({
      marks: [
        point(source, { id: "dots", x: "t", y: "v" }),
        custom(source, {
          id: "ticks",
          x: "t",
          y: "w",
          draw(ctx) {
            const states: (string | undefined)[] = [];
            for (const s of ctx.series)
              for (let i = 0; i < s.length; i++) {
                const row = s.rowAt(i);
                states.push(ctx.selection(s, row));
                ctx.item(s, row, () => ctx.circle(ctx.x(s.x[row]!), ctx.y(s.y[row]!), 3));
              }
            seen.push(states);
          },
        }),
      ],
    });
    // The points' item: the custom mark holds none of it, and draws as it is.
    chart.select({ kind: "items", items: [{ mark: "dots", item: ["row", 1, 0, 1] }] });
    await chart.loading;
    chart.render();
    expect(seen.at(-1)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    // A series of the custom mark's own holds its rows.
    chart.select({ kind: "series", series: [{ mark: "ticks", series: "w" }] });
    chart.render();
    expect(seen.at(-1)).toEqual(["selected", "selected", "selected", "selected", "selected"]);
  });

  it("hold a series of the mark at its place now, unnamed marks reordered", async () => {
    const source = data();
    const seen = { a: [] as (string | undefined)[], b: [] as (string | undefined)[] };
    const ticks = (name: "a" | "b") =>
      custom(source, {
        x: "t",
        y: "v",
        draw(ctx) {
          const [s] = ctx.series;
          seen[name].push(ctx.selection(s!, s!.rowAt(0)));
        },
      });
    const [a, b] = [ticks("a"), ticks("b")];
    const chart = mount({ marks: [a, b] });
    chart.select({ kind: "series", series: ['[0,"v"]'] });
    await chart.loading;
    chart.render();
    expect([seen.a.at(-1), seen.b.at(-1)]).toEqual(["selected", undefined]);
    // The same marks swapped: the series named is the one now first.
    chart.update({ marks: [b, a] });
    chart.render();
    expect([seen.a.at(-1), seen.b.at(-1)]).toEqual([undefined, "selected"]);
  });

  it("hold a series of a mark of several value fields, not its others of the same rows", async () => {
    const source = data();
    const seen: Record<string, (string | undefined)[]> = {};
    const chart = mount({
      marks: [
        custom(source, {
          id: "ticks",
          x: "t",
          y: ["v", "w"],
          draw(ctx) {
            for (const s of ctx.series) {
              const states: (string | undefined)[] = [];
              for (let i = 0; i < s.length; i++) {
                const row = s.rowAt(i);
                states.push(ctx.selection(s, row));
                ctx.item(s, row, () => ctx.circle(ctx.x(s.x[row]!), ctx.y(s.y[row]!), 3));
              }
              seen[s.label] = states;
            }
          },
        }),
      ],
    });
    chart.select({ kind: "series", series: [{ mark: "ticks", series: "v" }] });
    await chart.loading;
    chart.render();
    expect(seen.v).toEqual(Array(5).fill("selected"));
    expect(seen.w).toEqual(Array(5).fill("unselected"));
  });
});

describe("static exports", () => {
  const options = () => ({
    width: 400,
    height: 200,
    marks: [line(data(), { x: "t", y: ["v", "w"] })],
  });

  it("draw the view and what is hidden", () => {
    const svg = (more: object) => renderToSVG({ ...options(), ...more }, { idPrefix: "c" });
    const lines = (svg: string) => svg.match(/<path [^>]*stroke-width/g)?.length ?? 0;
    expect(svg({ viewport: { x: [1, 2] } })).toBe(svg({ x: { domain: [1, 2] } }));
    // By a series' key, or by its legend entry's.
    expect(lines(svg({}))).toBe(2);
    expect(lines(svg({ visibility: { hidden: ['[0,"w"]'] } }))).toBe(1);
    const entry = JSON.stringify({ table: { mark: 0 }, value: "w" });
    expect(lines(svg({ legend: true, visibility: { hidden: [entry] } }))).toBe(1);
  });

  it("draw a network's view on its plane", () => {
    const links = table({ source: ["a", "b", "a"], target: ["b", "c", "c"] });
    const network = {
      width: 400,
      height: 200,
      marks: [graph(links, { source: "source", target: "target" })],
    };
    const whole = renderToSVG(network);
    expect(renderToSVG({ ...network, viewport: { x: [0, 0.5], y: [0, 0.5] } })).not.toBe(whole);
  });

  it("refuse a selection, which they do not draw", () => {
    expectRefused(
      () => renderToSVG({ ...options(), selection: brush([1, 2]) }),
      "unsupported",
      /a static export draws no selection/,
    );
  });
});
