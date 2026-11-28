// Proofs of the matrix's integration cells for Python's live surfaces
// (test/contracts/): each surface's driver, which the shared harness
// (integration.ts) proves its cells through. A custom mark's cells are not
// applicable: it is a TypeScript function, which no spec can hold.

import { describe, expect, it, vi } from "vitest";
import { server } from "vitest/browser";
import { type Chart, MountedChart } from "../../../packages/herceg/src/dom/chart.ts";
import type { ChartErrorInfo } from "../../../packages/herceg/src/spec/errors.ts";
import { validateSpec } from "../../../packages/herceg/src/spec/validate.ts";
import type { InputEventPayload } from "../../../packages/herceg/src/web/events.ts";
import { press } from "../../../packages/herceg/test/browser/contracts/pointer.ts";
import { collectUntilGone } from "../../../packages/herceg/test/browser/helpers.ts";
import { specOf } from "../../../packages/herceg/test/contracts/matrix.ts";
import { contractTest } from "../../../packages/herceg/test/helpers/contracts.ts";
import widgetModule, { type Snapshot, type Update } from "../widget.ts";
import { proveIntegration, type Surface } from "./integration.ts";
import { MockModel, snapshot } from "./widget-model.ts";

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/**
 * The one chart `make` makes in `host` (one that listens to its events as it
 * runs, as a front end does of a chart it makes), or `kept` where it makes none.
 */
function made(host: HTMLElement, make: () => void, kept?: Chart): Chart {
  const listener = vi.spyOn(MountedChart.prototype, "on");
  try {
    make();
    const charts = [...new Set(listener.mock.instances as unknown as MountedChart[])];
    const shown = charts.filter((chart) => host.contains(chart.root));
    if (kept && shown.length === 0) return kept;
    expect(shown, "charts made in the host").toHaveLength(1);
    return shown[0]!;
  } finally {
    // Holding none of what it saw, which closing must let go of.
    listener.mockClear();
    listener.mockRestore();
  }
}

/**
 * The notebook widget as anywidget runs it, over a stand-in for its model:
 * Python's snapshot of the chart, and its updates in turn; hovers and
 * errors reach Python as the widget's messages.
 */
const widget: Surface = {
  name: "widget",
  changes: "in place",
  refusals: "error",
  async show(host, spec) {
    const sent: Snapshot = {
      revision: 0,
      spec,
      buffers: [],
      selection: null,
      viewport: null,
      drill_root: null,
      item_positions: {},
    };
    const model = new MockModel({ _chart: sent, _listening: ["hover"] });
    const module = widgetModule();
    const stops: (() => void)[] = [module.initialize({ model })];
    let chart = made(host, () => stops.unshift(module.render({ model, el: host })));
    let revision = 0;
    let current = spec;
    const update = (message: Record<string, unknown>) =>
      model.receive({ ...message, revision: ++revision } as Update);
    return {
      chart: () => chart,
      async readAt(at) {
        const before = model.messages("hover").length;
        press(chart, "pointermove", at);
        await expect.poll(() => model.messages("hover").length).toBeGreaterThan(before);
        const { event } = model.messages("hover").at(-1) as { event: InputEventPayload };
        return event.inspection;
      },
      async change(options) {
        current = { ...current, ...options };
        chart = made(host, () => update({ type: "options", options }), chart);
        return chart;
      },
      async refuse(refused) {
        const before = model.messages("error").length;
        update({ type: "chart", spec: refused, rows: {} });
        // Python's next chart draws in its place.
        chart = made(host, () => update({ type: "chart", spec: current, rows: {} }));
        await chart.loading;
        const errors = model.messages("error").slice(before) as { error: ChartErrorInfo }[];
        return errors.map(({ error: { code, path, message } }) => ({ code, path, message }));
      },
      close() {
        for (const stop of stops.splice(0)) stop();
      },
    };
  },
};

describe("integration.widget", () => {
  proveIntegration(widget);

  // What each row's proof leaves to these: what a closed widget held back
  // is dropped, Python's later changes draw nowhere, and its chart goes.
  it("sends and draws nothing once closed", async () => {
    await withPage(async (page, model) => {
      await closed(page, model);
      model.receive({ type: "options", revision: 1, options: { title: "After" } });
      expect(page.childElementCount).toBe(0);
    });
  });

  // Chrome alone collects exactly: WebKit scans stacks conservatively, and
  // Firefox kept a closed chart through a hundred collections in 2 runs of 25.
  it.skipIf(server.browser !== "chromium")("lets go of its chart once closed", async () => {
    await withPage(async (page, model) => {
      const drawn = await closed(page, model);
      await collectUntilGone(drawn);
      expect(drawn.map((ref) => ref.deref())).toEqual([undefined, undefined]);
    });
  });
});

/** Runs `test` with a page 600 px wide and a model of a line chart, Python listening for hovers. */
async function withPage(test: (page: HTMLElement, model: MockModel) => Promise<void>) {
  const page = document.createElement("div");
  page.style.width = "600px";
  document.body.append(page);
  try {
    await test(page, new MockModel({ _chart: snapshot(), _listening: ["hover"] }));
  } finally {
    vi.useRealTimers();
    page.remove();
  }
}

/**
 * Shows the widget's chart in `page`, moves the pointer twice (the first
 * hover goes at once, the next waits for the throttle), closes the view and
 * disposes of the widget as anywidget does, and lets the throttle's time
 * pass: the held hover is never sent. Returns weak references to the chart
 * and its root, which nothing of the widget's display holds any longer.
 */
async function closed(page: HTMLElement, model: MockModel): Promise<WeakRef<object>[]> {
  const module = widgetModule();
  const dispose = module.initialize({ model });
  let close = () => {};
  const chart = made(page, () => (close = module.render({ model, el: page })));
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { plot } = chart.getPanels()[0]!;
  for (const x of [0.2, 0.8]) {
    press(chart, "pointermove", [plot.x + plot.width * x, plot.y + plot.height / 2]);
    await frame();
  }
  expect(model.messages("hover")).toHaveLength(1);
  close();
  expect(page.childElementCount).toBe(0);
  dispose();
  vi.advanceTimersByTime(1000);
  vi.useRealTimers();
  expect(model.messages("hover")).toHaveLength(1);
  return [new WeakRef(chart), new WeakRef(chart.root)];
}

describe("integration of a custom mark", () => {
  for (const surface of ["streamlit", "web"])
    contractTest(`custom.integration.${surface}`, () => {
      // The row has no spec, and a spec naming the mark is refused.
      expect(specOf("custom")).toBeUndefined();
      expect(() => validateSpec({ marks: [{ type: "custom" }] })).toThrow(/^marks\[0\]\.type: /);
    });
});
