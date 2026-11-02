// Views and selections set before a chart's first frame, while it waits
// for code it loads: applied at once, then reported and shared as the
// first frame draws the panels they are in. A file of its own: its charts
// need the guide compiler, which no chart on its page has loaded yet, and
// every chart is mounted and changed below before any has.
import { afterAll, expect, it } from "vitest";
import { selectionStore } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { bar } from "../../src/marks/bar.ts";
import { graph } from "../../src/marks/graph.ts";
import { line } from "../../src/marks/line.ts";
import { facet } from "../../src/model/facet.ts";
import { panels } from "../../src/model/panels.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { chartState } from "../../src/state.ts";
import { brushOf } from "../helpers/selections.ts";

const hosts: HTMLDivElement[] = [];
const charts: Chart[] = [];

afterAll(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

function mount(group: string, options: Partial<ChartOptions> = {}): Chart {
  const host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
  hosts.push(host);
  const chart = createChart(host, {
    locale: "en-US",
    marks: [line(table({ x: [0, 10, 20, 30, 40], y: [1, 3, 2, 5, 4] }), { x: "x", y: "y" })],
    // Ticks every 10 need the guide compiler, which the first frame waits for.
    x: { ticks: { every: 10 } },
    interaction: { zoom: "x", brush: "x", sync: { viewport: group, selection: group } },
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

const lines = table({ x: [0, 10, 20, 30, 40], y: [1, 3, 2, 5, 4] });

// A view and a selection set on A; C zooms too, before the view A shares reaches it.
const [a, b, c] = [mount("early"), mount("early"), mount("early")];
const views = heard(a, "viewport");
const selections = heard(a, "select");
const followed = heard(b, "viewport");
const replaced = heard(c, "viewport");
const made = a.revision;
a.setViewport([10, 30]);
a.select([15, 25]);
// Each counts once, as it is set: the first frame reports them without counting them again.
const counted = { view: made + 1, selection: made + 2 };
c.setViewport([0, 5]);
const before = { panels: a.getPanels(), views: [...views], selections: [...selections] };

// A sender that needs no compiler draws, and shares, at once: twice, while
// its followers load, which take each as it comes; one stops syncing after.
const sender = mount("late", { x: {} });
const [follower, leaver] = [mount("late"), mount("late")];
sender.setViewport([0, 10]);
sender.setViewport([20, 30]);
leaver.update({ interaction: { zoom: "x" } });
// A chart's own changes after what it heard are newer: they stand, and are
// shared; a change of y keeps the x it heard.
const [told, teller, kept] = [mount("newer", { x: {} }), mount("newer"), mount("newer")];
told.setViewport([0, 10]);
told.select([1, 9]);
teller.setViewport([20, 30]);
teller.select([21, 29]);
kept.setViewport({ y: [1, 2] });
// So is a reset.
const [zoomer, resetter] = [mount("reset", { x: {} }), mount("reset")];
zoomer.setViewport([0, 10]);
resetter.setViewport(null);

// A y selection of a chart drawing only a right y axis.
const right = mount("right", {
  marks: [line(table({ x: [0, 10, 20], y: [1, 5, 3] }), { x: "x", y: "y", axis: "right" })],
  interaction: { brush: "y" },
});
const rightSelections = heard(right, "select");
right.select({ kind: "brush", x: null, y: [2, 4], lasso: null });

// An export of a chart that no longer waits for code draws its first scene.
const [exporter, importer] = [mount("export"), mount("export")];
const exported = heard(exporter, "viewport");
exporter.setViewport([10, 20]);
exporter.update({ x: {} });
exporter.toSVG();

// A selection a chart drawing at once shares with one waiting for its first
// frame, which takes it without sharing it back: the rows the first one's
// selection wrote stay its own.
const owned = table({ x: [0, 10, 20, 30, 40], y: [1, 3, 2, 5, 4] });
const store = selectionStore(owned);
const owner = mount("own", {
  x: {},
  marks: [line(owned, { x: "x", y: "y" })],
  rowSelection: rowSelection({ store, channel: "focus" }),
});
const taker = mount("own");
owner.select([10, 30]);
// One cleared before its first frame, after it took one shared then: the
// clear is shared. An export draws the sharer's first scene, which shares.
const [sharer, clearer] = [mount("cleared", { x: {} }), mount("cleared")];
sharer.select([10, 30]);
sharer.toSVG();
clearer.select(null);
// A selection cleared before the first frame, which reports the clear.
const unselector = mount("unselect");
const unselected = heard(unselector, "select");
unselector.select([10, 20]);
unselector.select(null);
// So with items, of a chart with state support.
const itemized = mount("unselect-items", {
  state: chartState,
  marks: [line(lines, { id: "l", x: "x", y: "y" })],
});
const unitemized = heard(itemized, "select");
itemized.select({ kind: "series", series: [{ mark: "l", series: "y" }] });
itemized.select(null);
// Categories by name, shared along x before the first frame, which draws them.
const bands = (options: Partial<ChartOptions>) =>
  mount("bands", {
    marks: [bar(table({ c: ["a", "b", "c"], v: [1, 2, 3] }), { x: "c", y: "v" })],
    interaction: { brush: "x", sync: { selection: { group: "bands", scale: "x" } } },
    ...options,
  });
const [namer, named] = [bands({ x: {} }), bands({ x: {}, y: { ticks: { every: 1 } } })];
namer.select([0, 1]);
namer.toSVG();

// A view of a subplot's panel, and of a network's plane.
const subplots = mount("subplots", {
  panels: panels([{ id: "p" }, { id: "q" }]),
  marks: ["p", "q"].map((panel) => line(lines, { x: "x", y: "y", panel })),
});
subplots.setViewport([10, 30], { panel: "p" });
subplots.select([5, 15], { panel: "q" });
// Calls after one that waits for the first frame wait too, in order.
subplots.setViewport(null);
subplots.select(null);
subplots.setViewport([20, 40], { panel: "p" });
const people = table({ name: ["Ana", "Bo", "Cy"], team: ["Data", "Data", "Sales"] });
const talks = table({ from: ["Ana", "Bo"], to: ["Bo", "Cy"], n: [3, 1] });
const network = mount("network", {
  interaction: { zoom: true },
  marks: [
    graph(talks, {
      source: "from",
      target: "to",
      value: "n",
      nodes: people,
      node: "name",
      color: "team",
    }),
  ],
});
network.setViewport({ x: [0, 50], y: [0, 50] });
// A network's views and a reset of every view, waiting for the first frame
// of a chart of axes and a network, which a listener writes back.
const mixed = mount("mixed", {
  panels: panels([{ id: "axes" }, { id: "net" }]),
  marks: [
    line(lines, { x: "x", y: "y", panel: "axes" }),
    graph(talks, { source: "from", target: "to", nodes: people, node: "name", panel: "net" }),
  ],
  interaction: { zoom: true },
});
const netViews: unknown[] = [];
mixed.on("viewport", ({ views }) => {
  const net = views.find((view) => view.panel === "net");
  if (!net) return;
  netViews.push(net.x);
  mixed.setViewport({ x: net.x, y: net.y }, { panel: "net" });
});
mixed.setViewport({ x: [0, 50], y: [0, 50] }, { panel: "net" });
mixed.setViewport(null);
mixed.setViewport({ x: [10, 40], y: [10, 40] }, { panel: "net" });

// A y view shared with a chart drawing only a right y axis.
const [lifter, lifted] = [
  mount("lift", {
    x: {},
    interaction: { zoom: "y", sync: { viewport: { group: "lift", scale: "y" } } },
  }),
  mount("lift", {
    marks: [line(lines, { x: "x", y: "y", axis: "right" })],
    interaction: { zoom: "y", sync: { viewport: { group: "lift", scale: "y" } } },
  }),
];
lifter.setViewport({ y: [2, 4] });
// A chart's own y view, then a newer one a synced chart shares: the newer
// stands on both; so with selections.
const ordered = {
  zoom: "y",
  brush: "xy",
  sync: { viewport: { group: "order", scale: "y" }, selection: "order" },
} as const;
const [newer, older] = [
  mount("order", { x: {}, interaction: ordered }),
  mount("order", { interaction: ordered }),
];
older.setViewport({ y: [2, 4] });
older.select({ kind: "brush", x: [10, 20], y: [2, 3], lasso: null });
newer.setViewport({ y: [1, 3] });
newer.select({ kind: "brush", x: [0, 5], y: [1, 2], lasso: null });
// A view shared with a chart of subplots, which waits for the first frame,
// on a channel the chart then moves to another group.
const [mover, moved] = [
  mount("move", { x: {} }),
  mount("move", {
    panels: panels([{ id: "only" }]),
    marks: [line(lines, { x: "x", y: "y", panel: "only" })],
  }),
];
mover.setViewport([10, 20]);
moved.update({ interaction: { zoom: "x", sync: { viewport: "elsewhere" } } });
// A subplot's view and selection, waiting for the first frame, then newer
// ones a drawn chart shares: the newer stand on both.
const [ahead, behind] = [
  mount("queued", { x: {} }),
  mount("queued", {
    panels: panels([{ id: "only" }]),
    marks: [line(lines, { x: "x", y: "y", panel: "only" })],
    interaction: {
      zoom: "x",
      brush: "x",
      sync: {
        viewport: { group: "queued", panel: "only" },
        selection: { group: "queued", panel: "only" },
      },
    },
  }),
];
const aheadViews = heard(ahead, "viewport");
behind.setViewport([0, 10], { panel: "only" });
behind.select([1, 9], { panel: "only" });
ahead.setViewport([20, 30]);
ahead.select([21, 29]);

// A view of a chart of one subplot, whose x the first frame resolves.
const single = mount("single", {
  panels: panels([{ id: "only" }]),
  marks: [line(lines, { x: "x", y: "y", panel: "only" })],
});
single.setViewport([10, 20]);

// A view of a facet's panel, whose key the data gives.
const faceted = mount("facets", {
  marks: [line(table({ x: [0, 10], y: [1, 2], host: ["a", "b"] }), { x: "x", y: "y" })],
  facet: facet("host"),
});
faceted.setViewport([0, 5], { panel: "a" });
const refusal = (() => {
  try {
    faceted.getViewport({ panel: "a" });
  } catch (error) {
    return (error as Error).message;
  }
})();

it("applies a view and a selection set before the first frame at once, and reports them with it", async () => {
  expect(before.panels).toEqual([]);
  expect(a.getViewport().x).toEqual([10, 30]);
  expect(brushOf(a.selection)?.x).toEqual([15, 25]);
  // Reported in the panels the first frame draws.
  expect(before.views).toEqual([]);
  expect(before.selections).toEqual([]);

  await Promise.all([a.ready, b.ready, c.ready]);
  expect(views).toEqual([
    {
      viewRevision: 1,
      revision: counted.view,
      cause: "api",
      scales: [{ scale: "x", instance: "", type: "linear", panels: [""], view: [10, 30] }],
      views: [
        { panel: "", x: [10, 30], y: null, yRight: null, types: { x: "linear", y: "linear" } },
      ],
    },
  ]);
  expect(a.revision).toBe(counted.selection);
  expect(selections).toHaveLength(1);
  expect(selections[0]).toMatchObject({
    selection: { kind: "brush", x: [15, 25] },
    revision: counted.selection,
    owner: { scales: [{ scale: "x", instance: "", panels: [""] }], panels: [""] },
  });
});

it("shares them with synced charts, which draw them in their first frames", async () => {
  await Promise.all([a.ready, b.ready, c.ready]);
  expect(b.getViewport().x).toEqual([10, 30]);
  expect(b.getPanels()[0]!.x!.domain).toEqual([10, 30]);
  expect(brushOf(b.selection)?.x).toEqual([15, 25]);
  expect(followed).toMatchObject([{ cause: "sync", views: [{ panel: "", x: [10, 30] }] }]);
  // C took A's view, which came after its own: its first frame reports
  // both changes, in order, as the view is now, and every synced chart
  // shows the same.
  expect(c.getViewport().x).toEqual([10, 30]);
  expect(replaced).toMatchObject([
    { cause: "api", views: [{ panel: "", x: [10, 30] }] },
    { cause: "sync", views: [{ panel: "", x: [10, 30] }] },
  ]);
  expect(a.getViewport().x).toEqual([10, 30]);
  expect(views).toHaveLength(1);
});

it("takes views and selections shared before its first frame in order with its own", async () => {
  await Promise.all([follower.ready, leaver.ready]);
  expect(follower.getViewport().x).toEqual([20, 30]);
  expect(follower.getPanels()[0]!.x!.domain).toEqual([20, 30]);
  expect(leaver.getViewport().x).toEqual([20, 30]);
  await Promise.all([teller.ready, kept.ready]);
  for (const chart of [teller, told, kept]) {
    expect(chart.getViewport().x).toEqual([20, 30]);
    expect(brushOf(chart.selection)?.x).toEqual([21, 29]);
  }
  expect(kept.getViewport().y).toEqual([1, 2]);
  await resetter.ready;
  expect([zoomer.getViewport().x, resetter.getViewport().x]).toEqual([null, null]);
});

it("selects on the right y axis of a chart drawing only that", async () => {
  await right.ready;
  expect(brushOf(right.selection)?.y).toEqual([2, 4]);
  expect(rightSelections).toMatchObject([
    { selection: { y: [2, 4] }, owner: { scales: [{ scale: "yRight" }], panels: [""] } },
  ]);
});

it("sets a view of a facet's panel, which the data gives, with the first frame, and says to wait to read it", async () => {
  expect(refusal).toBe(
    'getViewport: no panel "a" yet, as the chart draws its panels with its first frame; call it once chart.ready resolves',
  );
  await faceted.ready;
  expect(faceted.getViewport({ panel: "a" }).x).toEqual([0, 5]);
});

it("reports and shares what changed before an export that drew the first scene", async () => {
  expect(exported).toMatchObject([{ cause: "api", views: [{ panel: "", x: [10, 20] }] }]);
  await importer.ready;
  expect(importer.getViewport().x).toEqual([10, 20]);
});

it("takes a selection shared before its first frame without sharing it back", async () => {
  await Promise.all([owner.ready, taker.ready]);
  expect(brushOf(taker.selection)?.x).toEqual([10, 30]);
  expect(store.get("focus")).not.toBeNull();
  // The rows are still the owner's, which clears them with its selection.
  owner.select(null);
  expect(store.get("focus")).toBeNull();
  expect(taker.selection).toBeNull();
});

it("shares a clear made before the first frame of a selection shared then", async () => {
  await Promise.all([sharer.ready, clearer.ready]);
  expect(clearer.selection).toBeNull();
  expect(sharer.selection).toBeNull();
});

it("reports a clear made before the first frame", async () => {
  await unselector.ready;
  expect(unselected).toMatchObject([{ selection: null, phase: "commit", cause: "api" }]);
  expect(unselected[0]!.owner.scales).toHaveLength(1);
  await itemized.ready;
  expect(unitemized).toMatchObject([{ selection: null, phase: "commit", cause: "api" }]);
});

it("takes categories shared by name before the first frame, once it draws them", async () => {
  await Promise.all([namer.ready, named.ready]);
  expect(brushOf(named.selection)?.x).toEqual(brushOf(namer.selection)!.x);
  expect(brushOf(named.selection)?.x).not.toBeNull();
});

it("sets a view of a subplot's panel, or of a network, set before the first frame with it", async () => {
  await Promise.all([subplots.ready, network.ready]);
  expect(subplots.getViewport({ panel: "p" }).x).toEqual([20, 40]);
  expect(subplots.getViewport({ panel: "q" }).x).not.toEqual([10, 30]);
  expect(subplots.selection).toBeNull();
  expect(network.getViewport()).toMatchObject({ x: [0, 50], y: [0, 50] });
  // Reported in the order they were made, each as the view is then: the
  // listener writing them back replays no older one.
  await mixed.ready;
  expect(netViews.length).toBeGreaterThan(1);
  expect(new Set(netViews.map(String))).toEqual(new Set(["10,40"]));
  expect(mixed.getViewport({ panel: "net" })).toMatchObject({ x: [10, 40], y: [10, 40] });
  await single.ready;
  expect(single.getViewport({ panel: "only" }).x).toEqual([10, 20]);
});

it("takes a y view on the y axis the chart draws, and only on channels it still syncs as then", async () => {
  await Promise.all([lifted.ready, moved.ready]);
  expect(lifted.getViewport().yRight).toEqual([2, 4]);
  await older.ready;
  for (const chart of [newer, older]) {
    expect(chart.getViewport().y).toEqual([1, 3]);
    expect(chart.selection).toMatchObject({ x: [0, 5], y: [1, 2] });
  }
  expect(moved.getViewport({ panel: "only" }).x).toBeNull();
});

it("shares calls that waited for the first frame only if no newer view or selection came", async () => {
  await behind.ready;
  for (const [chart, target] of [
    [ahead, {}],
    [behind, { panel: "only" }],
  ] as const) {
    expect(chart.getViewport(target).x).toEqual([20, 30]);
    expect(brushOf(chart.selection)?.x).toEqual([21, 29]);
  }
  expect(aheadViews).toMatchObject([{ cause: "api", views: [{ x: [20, 30] }] }]);
});
