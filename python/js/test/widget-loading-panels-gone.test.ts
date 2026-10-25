// The notebook widget drawing a chart again while the one before it waits
// for the guide compiler, with a state from Python naming a subplot that
// chart lacks: the subplot's setting goes with that chart, as the chart
// itself would have let go of it. A test file of its own: each runs in a
// page of its own, where the compiler has not loaded.

import { afterEach, expect, it, vi } from "vitest";
import { MountedChart } from "../../../packages/herceg/src/dom/chart.ts";
import { visibilityState } from "../../../packages/herceg/src/from-spec.ts";
import widgetModule, { type Snapshot } from "../widget.ts";
import { MockModel, snapshot } from "./widget-model.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

it("drops what Python sent for a subplot the waiting chart lacks when drawn again", async () => {
  const listener = vi.spyOn(MountedChart.prototype, "on");
  const base = snapshot();
  const [marked] = base.spec.marks;
  const subplots = (revision: number, ids: [string, string], legend: boolean): Snapshot => ({
    ...base,
    revision,
    spec: {
      ...base.spec,
      panels: ids.map((id) => ({ id })),
      layout: { type: "grid", columns: [1, 1] },
      // A panel's legend needs the guide compiler, which loads first.
      ...(legend && { guides: [{ type: "legend", panel: ids[0] }] }),
      marks: ids.map((panel) => ({ ...marked!, color: "host", panel })),
    } as Snapshot["spec"],
  });
  const model = new MockModel({ _chart: subplots(0, ["a", "b"], false), _listening: [] });
  const redraw = (shot: Snapshot) =>
    model.receive(
      { type: "chart", revision: shot.revision, spec: shot.spec, rows: {} },
      shot.buffers as DataView[],
    );
  const widget = widgetModule();
  cleanups.push(widget.initialize({ model }));
  const host = document.createElement("div");
  host.style.width = "600px";
  document.body.append(host);
  cleanups.push(widget.render({ model, el: host }), () => host.remove());
  const first = listener.mock.instances[0] as MountedChart;
  await first.loading;
  first.render();
  // Panel a gives way to c, and the chart waits for the compiler.
  redraw(subplots(1, ["c", "b"], true));
  const waiting = listener.mock.instances.at(-1) as MountedChart;
  expect(waiting.getPanels()).toEqual([]);
  // Python hides a series in panel a meanwhile, which that chart has not.
  const key = JSON.stringify({ field: "host", value: "a" });
  model.receive({
    type: "visibility",
    revision: 2,
    visibility: { hiddenKeys: [], panels: { a: { hidden: [key], shown: [] } } },
  });
  // Panel a again, drawn before the compiler is in.
  redraw(subplots(3, ["a", "b"], true));
  const last = listener.mock.instances.at(-1) as MountedChart;
  expect(last).not.toBe(waiting);
  await last.loading;
  await vi.waitFor(() => expect(last.getPanels()).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(visibilityState(last)).toEqual({ hiddenKeys: [] });
});
