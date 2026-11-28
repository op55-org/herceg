// Hydrated charts' legends clicked while the code their first frames need
// loads, and their interaction controller with it: each click is reported
// on the entry the markup showed, even once the legend is gone. A file of
// its own: its charts need the guide compiler, which no chart on its page
// has loaded yet, and both are hydrated and clicked below before either
// has; nor does it import helpers.ts, whose import loads the controller.

import { afterAll, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, forgetInteraction } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { hydrateChart } from "../../src/dom/hydrate.ts";
import { legend } from "../../src/guides/options.ts";
import { line } from "../../src/marks/line.ts";
import { renderToSnapshot } from "../../src/render/snapshot.ts";

const hosts: HTMLDivElement[] = [];
const charts: Chart[] = [];

afterAll(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  for (const host of hosts.splice(0)) host.remove();
  forgetInteraction();
});

function options(extra: Partial<ChartOptions> = {}): ChartOptions {
  return {
    marks: [line(table({ t: [0, 1], a: [1, 2], b: [3, 4] }), { id: "l", x: "t", y: ["a", "b"] })],
    // Ticks every so often need the guide compiler, which the first frame waits for.
    x: { ticks: { every: 0.5 } },
    ...extra,
  };
}

/** A chart hydrated from a snapshot of `options()`, as it travels (through JSON), and its clicks. */
function hydrated(extra?: Partial<ChartOptions>) {
  const host = document.createElement("div");
  host.style.cssText = "width:640px;height:320px";
  document.body.append(host);
  hosts.push(host);
  const snapshot = renderToSnapshot(options(extra), { width: 640, height: 320, idPrefix: "held" });
  host.innerHTML = snapshot.html;
  const chart = hydrateChart(host, options(extra), JSON.parse(JSON.stringify(snapshot)));
  charts.push(chart);
  const clicks: ChartEvents["click"][] = [];
  chart.on("click", (event) => clicks.push(event));
  const hidden: ChartEvents["visibility"][] = [];
  chart.on("visibility", (event) => hidden.push(event));
  const entry = (label: string) =>
    [...host.querySelectorAll("button")].find((button) => button.textContent === label)!;
  return { chart, host, clicks, hidden, entry };
}

const click = (button: HTMLButtonElement) =>
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));

// Clicks are kept until the controller, held here, loads.
const module = await import("../../src/dom/interaction.ts");
let release = (_: typeof module) => {};
forgetInteraction(() => new Promise((resolve) => (release = resolve)));

// An entry hidden, which a listener answers by taking the legend away.
const hiding = hydrated();
hiding.chart.on("visibility", () => {
  hiding.chart.update({ legend: false });
  hiding.chart.render();
});
// An entry of a legend that selects, which goes once it is clicked.
const selecting = hydrated({ guides: [legend({ action: "select" })] });
// The markup is still what the server drew: no frame has drawn the legends.
const drawnBefore = [hiding.chart.drawnRevision, selecting.chart.drawnRevision];
click(hiding.entry("b"));
click(selecting.entry("b"));
selecting.chart.update({ guides: [], legend: false });

/** Waits for the first frames, which draw no legend, then lets the controller play the clicks. */
async function played() {
  for (const { chart, host } of [hiding, selecting]) {
    await expect.poll(() => chart.drawnRevision).toBeDefined();
    expect(host.querySelectorAll("button")).toHaveLength(0);
  }
  release(module);
  for (const { chart } of [hiding, selecting])
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
}

it("reports a legend entry clicked before the first frame, which a listener removed as it hid it", async () => {
  expect(drawnBefore).toEqual([undefined, undefined]);
  await played();
  expect(hiding.hidden).toHaveLength(1);
  expect(hiding.clicks.map(({ target }) => target)).toEqual([
    {
      kind: "legendEntry",
      key: expect.any(String),
      label: "b",
      panel: undefined,
      references: [{ mark: "l", series: "b" }],
    },
  ]);
});

it("selects the series of a legend entry clicked before the first frame, the legend gone since", async () => {
  await played();
  // A legend that selects hides nothing.
  expect(selecting.hidden).toEqual([]);
  expect(selecting.chart.selection).toMatchObject({ kind: "series" });
  expect(selecting.clicks.map(({ target }) => target)).toMatchObject([
    { kind: "legendEntry", label: "b" },
  ]);
});
