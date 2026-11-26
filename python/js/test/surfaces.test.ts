// Each drawn contract case (herceg's test/fixtures/contracts.json), as
// Python sends it to a notebook widget, a Streamlit app, and a web page,
// draws what a chart made from its spec draws: the front ends carry the
// spec to the engine and draw nothing of their own. Python's
// tests/test_surfaces.py checks that each sends the spec as it is.

import { encodePayload, mount as mountFragment, unmount as unmountFragment } from "herceg/web";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MountedChart } from "../../../packages/herceg/src/dom/chart.ts";
import { contractTest } from "../../../packages/herceg/test/helpers/contracts.ts";
import {
  type DrawnCase,
  drawnCases,
  fullSpec,
  sameDrawing,
  specChart,
} from "../../../packages/herceg/test/helpers/surfaces.ts";
import widgetModule from "../widget.ts";
import { run } from "./streamlit-payload.ts";
import { MockModel } from "./widget-model.ts";

const HEIGHT = 240;
let cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.reverse()) cleanup();
  cleanups = [];
  vi.restoreAllMocks();
});

function host(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "600px";
  document.body.append(element);
  cleanups.push(() => element.remove());
  return element;
}

/**
 * The case as Python sends it: its own theme where it has none, which
 * Streamlit would otherwise take from the app, at the height of a chart in
 * a page.
 */
function sent(spec: DrawnCase["spec"]): DrawnCase["spec"] {
  return { theme: "light", ...spec, height: HEIGHT };
}

/** The chart a front end made as `mount` ran. */
function made(mount: () => void) {
  const listener = vi.spyOn(MountedChart.prototype, "on");
  mount();
  return listener.mock.instances.at(-1) as unknown as MountedChart;
}

async function drawsTheSpec(drawn: MountedChart, spec: DrawnCase["spec"]) {
  const reference = specChart(host(), spec, HEIGHT);
  cleanups.push(() => reference.destroy());
  await sameDrawing(drawn, reference);
}

describe("front ends draw the spec as sent", () => {
  for (const { contract, name, spec } of drawnCases()) {
    const given = sent(spec);
    contractTest(
      `${contract}.widget`,
      async () => {
        const model = new MockModel({
          _chart: {
            revision: 0,
            spec: fullSpec(given),
            buffers: [],
            selection: null,
            viewport: null,
            drill_root: null,
            item_positions: {},
          },
          _listening: [],
        });
        const widget = widgetModule();
        const chart = made(() => {
          cleanups.push(widget.initialize({ model }));
          cleanups.push(widget.render({ model, el: host() }));
        });
        await drawsTheSpec(chart, given);
      },
      name,
    );
    contractTest(
      `${contract}.streamlit`,
      async () => {
        const payload = encodePayload(fullSpec(given), [], { events: [] });
        const chart = made(() => cleanups.push(run(host(), payload).cleanup));
        await drawsTheSpec(chart, given);
      },
      name,
    );
    contractTest(
      `${contract}.web`,
      async () => {
        const page = host();
        const inline = { protocol: 1, kind: "chart", spec: fullSpec(given), buffers: [] };
        const template = document.createElement("template");
        template.setAttribute("data-herceg-payload", "");
        template.innerHTML = JSON.stringify(inline).replace(/&/g, "&amp;").replace(/</g, "&lt;");
        // The size a fragment of a chart 600 pixels wide declares.
        page.dataset.herceg = "";
        page.dataset.hercegWidth = "600";
        page.dataset.hercegHeight = String(HEIGHT);
        page.append(template);
        const chart = await mountFragment(page);
        cleanups.push(() => unmountFragment(page));
        await drawsTheSpec(chart as unknown as MountedChart, given);
      },
      name,
    );
  }
});

describe("a legend entry's click, as each front end reports it", () => {
  // One series name drawn by an area and a line: the entry stands for both.
  const spec = sent({
    marks: [
      { type: "area", id: "bands", x: "t", y: ["v", "w"] },
      { type: "line", id: "lines", x: "t", y: ["v", "w"] },
    ],
  } as DrawnCase["spec"]);
  const target = {
    kind: "legendEntry",
    label: "v",
    references: [
      { mark: "bands", series: "v" },
      { mark: "lines", series: "v" },
    ],
  };

  /** Presses the entry "v" of the chart's legend in `page`, once the chart has loaded. */
  async function pressEntry(chart: MountedChart, page: HTMLElement) {
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    const button = [...page.querySelectorAll("button")].find((b) => b.textContent === "v")!;
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  }

  it("names the series it stands for, in a notebook widget", async () => {
    const model = new MockModel({
      _chart: {
        revision: 0,
        spec: fullSpec(spec),
        buffers: [],
        selection: null,
        viewport: null,
        drill_root: null,
        item_positions: {},
      },
      _listening: ["click"],
    });
    const widget = widgetModule();
    const page = host();
    const chart = made(() => {
      cleanups.push(widget.initialize({ model }));
      cleanups.push(widget.render({ model, el: page }));
    });
    await pressEntry(chart, page);
    expect(model.messages("click")).toMatchObject([{ type: "click", event: { target } }]);
  });

  it("names the series it stands for, in a Streamlit app", async () => {
    const page = host();
    const payload = encodePayload(fullSpec(spec), [], { events: ["click"] });
    let triggers: [string, unknown][] = [];
    const chart = made(() => {
      const ran = run(page, payload);
      cleanups.push(ran.cleanup);
      triggers = ran.triggers;
    });
    await pressEntry(chart, page);
    expect(triggers).toMatchObject([["click", { target }]]);
  });

  it("names the series it stands for, in a web page", async () => {
    const page = host();
    const inline = { protocol: 1, kind: "chart", spec: fullSpec(spec), buffers: [] };
    const template = document.createElement("template");
    template.setAttribute("data-herceg-payload", "");
    template.innerHTML = JSON.stringify(inline).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    page.dataset.herceg = "";
    page.append(template);
    const clicks: unknown[] = [];
    page.addEventListener("herceg:click", (event) => clicks.push((event as CustomEvent).detail));
    const chart = await mountFragment(page);
    cleanups.push(() => unmountFragment(page));
    await pressEntry(chart as unknown as MountedChart, page);
    expect(clicks).toMatchObject([{ target }]);
  });
});

/** The click events a notebook widget sends drawing `drawn`, `click` clicking its chart. */
async function widgetClicks(
  drawn: DrawnCase["spec"],
  click: (chart: MountedChart) => Promise<void>,
) {
  const model = new MockModel({
    _chart: {
      revision: 0,
      spec: fullSpec(drawn),
      buffers: [],
      selection: null,
      viewport: null,
      drill_root: null,
      item_positions: {},
    },
    _listening: ["click"],
  });
  const widget = widgetModule();
  const page = host();
  const chart = made(() => {
    cleanups.push(widget.initialize({ model }));
    cleanups.push(widget.render({ model, el: page }));
  });
  await click(chart);
  return model.messages("click");
}

/** The click events a Streamlit app triggers drawing `drawn`, `click` clicking its chart. */
async function streamlitClicks(
  drawn: DrawnCase["spec"],
  click: (chart: MountedChart) => Promise<void>,
) {
  const payload = encodePayload(fullSpec(drawn), [], { events: ["click"] });
  let triggers: [string, unknown][] = [];
  const chart = made(() => {
    const ran = run(host(), payload);
    cleanups.push(ran.cleanup);
    triggers = ran.triggers;
  });
  await click(chart);
  return triggers;
}

/** The click events a web page dispatches drawing `drawn`, `click` clicking its chart. */
async function pageClicks(drawn: DrawnCase["spec"], click: (chart: MountedChart) => Promise<void>) {
  const page = host();
  const inline = { protocol: 1, kind: "chart", spec: fullSpec(drawn), buffers: [] };
  const template = document.createElement("template");
  template.setAttribute("data-herceg-payload", "");
  template.innerHTML = JSON.stringify(inline).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  page.dataset.herceg = "";
  page.append(template);
  const clicks: unknown[] = [];
  page.addEventListener("herceg:click", (event) => clicks.push((event as CustomEvent).detail));
  const chart = await mountFragment(page);
  cleanups.push(() => unmountFragment(page));
  await click(chart as unknown as MountedChart);
  return clicks;
}

/** Each front end's click events drawing a spec, `click` clicking its chart. */
function surfacesClicking(click: (chart: MountedChart) => Promise<void>) {
  return [
    [
      "widget",
      "a notebook widget",
      async (drawn: DrawnCase["spec"]) =>
        (await widgetClicks(drawn, click)).map(({ event }) => event),
    ],
    [
      "streamlit",
      "a Streamlit app",
      async (drawn: DrawnCase["spec"]) =>
        (await streamlitClicks(drawn, click)).map(([, event]) => event),
    ],
    ["web", "a web page", (drawn: DrawnCase["spec"]) => pageClicks(drawn, click)],
  ] as const;
}

describe("an inspected tree node's names, as each front end reports them", () => {
  const spec = sent({
    data: {
      sales: {
        columns: {
          region: ["Europe", "Europe", "Asia"],
          country: ["France", "Spain", "Japan"],
          revenue: [40, 20, 50],
        },
      },
    },
    marks: [{ type: "sunburst", data: "sales", path: ["region", "country"], value: "revenue" }],
  } as unknown as DrawnCase["spec"]);
  const inspection = {
    axis: "item",
    points: [{ label: "Europe / France", names: ["Europe", "France"] }],
  };

  /** Clicks the sector of France, once the chart has loaded. */
  async function clickFrance(chart: MountedChart) {
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    const model = MountedChart.modelOf(chart);
    const point = model.inspectItem('[0,"Europe","France"]')!.points[0]!;
    const rect = chart.root.getBoundingClientRect();
    const at = { clientX: rect.left + point.px, clientY: rect.top + point.py, bubbles: true };
    for (const type of ["pointermove", "pointerdown", "pointerup"])
      chart.root.dispatchEvent(new PointerEvent(type, { ...at, pointerType: "mouse", button: 0 }));
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  /** The same sector, its tooltip's `tooltip` as given. */
  const withTooltip = (tooltip: object) =>
    sent({
      ...spec,
      marks: [{ ...(spec.marks as object[])[0], tooltip }],
    } as unknown as DrawnCase["spec"]);

  // Its tooltip's row written from parts.
  const written = withTooltip({
    content: [{ series: true, style: { fontWeight: 600 } }, " in ", { field: "region" }],
  });
  const content = {
    axis: "item",
    points: [
      {
        label: "Europe / France",
        content: [
          { text: "Europe / France", style: { fontWeight: 600 } },
          { text: " in " },
          { text: "Europe" },
        ],
      },
    ],
  };
  // Its tooltip's heading written from parts.
  const headed = withTooltip({
    heading: [{ field: "country", style: { fontStyle: "italic" } }, " sales"],
  });
  const heading = {
    axis: "item",
    points: [
      {
        label: "Europe / France",
        heading: [{ text: "France", style: { fontStyle: "italic" } }, { text: " sales" }],
      },
    ],
  };

  const surfaces = surfacesClicking(clickFrance);
  for (const [surface, where, clicks] of surfaces) {
    contractTest(
      `inspection.names.${surface}`,
      async () => expect(await clicks(spec)).toMatchObject([{ inspection }]),
      `names the node's path, in ${where}`,
    );
    contractTest(
      `inspection.content.${surface}`,
      async () => expect(await clicks(written)).toMatchObject([{ inspection: content }]),
      `carries the row its content wrote, in ${where}`,
    );
    contractTest(
      `inspection.heading.${surface}`,
      async () => expect(await clicks(headed)).toMatchObject([{ inspection: heading }]),
      `carries the heading its mark wrote, in ${where}`,
    );
  }
});

describe("a reading's totals, as each front end reports them", () => {
  const spec = sent({
    data: {
      sales: {
        columns: {
          day: [1, 1, 1, 2],
          region: ["north", "south", "west", "north"],
          revenue: [100, 80, 70, 120],
        },
      },
    },
    marks: [
      {
        type: "line",
        id: "revenue",
        data: "sales",
        x: "day",
        y: "revenue",
        series: "region",
        tooltip: { total: { label: "All regions" } },
      },
    ],
  } as unknown as DrawnCase["spec"]);

  /** Clicks the chart at day 1, once it has loaded. */
  async function clickDay(chart: MountedChart) {
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    chart.render();
    const rect = chart.root.getBoundingClientRect();
    const { plot } = chart.getPanels()[0]!;
    const at = {
      clientX: rect.left + chart.toPixel(1, { axis: "x" })!,
      clientY: rect.top + plot.y + plot.height / 2,
      bubbles: true,
    };
    for (const type of ["pointermove", "pointerdown", "pointerup"])
      chart.root.dispatchEvent(new PointerEvent(type, { ...at, pointerType: "mouse", button: 0 }));
    for (let loading = chart.loading; loading; loading = chart.loading) await loading;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  const inspection = {
    axis: "x",
    totals: [
      { mark: 0, markId: "revenue", label: "All regions", value: 250, text: "250", count: 3 },
    ],
  };
  for (const [surface, where, clicks] of surfacesClicking(clickDay))
    contractTest(
      `inspection.totals.${surface}`,
      async () => expect(await clicks(spec)).toMatchObject([{ inspection }]),
      `carries the reading's total, in ${where}`,
    );
});
