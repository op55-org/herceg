// The notebook widget taking what Python says the legends hide while its
// chart waits for the guide compiler: the newer state wins over the one
// the chart had or was restoring. A test file of its own: each runs in a
// page of its own, where the compiler has not loaded yet.

import { afterEach, expect, it, vi } from "vitest";
import { MountedChart } from "../../../packages/herceg/src/dom/chart.ts";
import widgetModule, { type Snapshot } from "../widget.ts";
import { MockModel, snapshot } from "./widget-model.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

it("hides what Python sends while charts wait for their panels, over what they restore", async () => {
  const listener = vi.spyOn(MountedChart.prototype, "on");
  const base = snapshot();
  const [marked] = base.spec.marks;
  const subplots = (revision: number, legend: boolean): Snapshot => ({
    ...base,
    revision,
    spec: {
      ...base.spec,
      panels: [{ id: "a" }, { id: "b" }],
      layout: { type: "grid", columns: [1, 1] },
      // A panel's legend needs the guide compiler, which loads first.
      ...(legend && { guides: [{ type: "legend", panel: "a" }] }),
      marks: [
        { ...marked!, color: "host", panel: "a" },
        { ...marked!, color: "host", panel: "b" },
      ],
    } as Snapshot["spec"],
  });
  const model = new MockModel({ _chart: subplots(0, false), _listening: [] });
  const widget = widgetModule();
  cleanups.push(widget.initialize({ model }));
  const host = document.createElement("div");
  host.style.width = "600px";
  document.body.append(host);
  cleanups.push(widget.render({ model, el: host }), () => host.remove());
  const first = listener.mock.instances[0] as MountedChart;
  await first.loading;
  first.render();
  const key = JSON.stringify({ field: "host", value: "a" });
  first.setHiddenKeys([key]);
  // Drawn again from other marks, it waits, to restore what the legends hid.
  const next = subplots(1, true);
  model.receive(
    { type: "chart", revision: 1, spec: next.spec, rows: {} },
    next.buffers as DataView[],
  );
  const waiting = listener.mock.instances.at(-1) as MountedChart;
  expect(waiting.getPanels()).toEqual([]);
  // Python shows everything meanwhile: that is newer.
  model.receive({ type: "visibility", revision: 2, visibility: { hiddenKeys: [] } });
  // Drawn again before the compiler is in: the newer state goes with it.
  const again = subplots(3, true);
  model.receive(
    { type: "chart", revision: 3, spec: again.spec, rows: {} },
    again.buffers as DataView[],
  );
  const last = listener.mock.instances.at(-1) as MountedChart;
  expect(last).not.toBe(waiting);
  await last.loading;
  await vi.waitFor(() => expect(last.getPanels()).toHaveLength(2));
  await vi.waitFor(() => expect(last.getHiddenKeys()).toEqual([]));
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(last.getHiddenKeys()).toEqual([]);
  // Python never hears of the state restoring would have brought back.
  const after = model.messages("visibility").filter(({ revision }) => (revision as number) >= 2);
  for (const { visibility } of after) expect(visibility).toEqual({ hiddenKeys: [] });
});
