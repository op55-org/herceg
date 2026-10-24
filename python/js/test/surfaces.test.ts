// Each drawn contract case (herceg's test/fixtures/contracts.json), as
// Python sends it to a notebook widget, a Streamlit app, and a web page,
// draws what a chart made from its spec draws: the front ends carry the
// spec to the engine and draw nothing of their own. Python's
// tests/test_surfaces.py checks that each sends the spec as it is.

import { encodePayload, mount as mountFragment, unmount as unmountFragment } from "herceg/web";
import { afterEach, describe, vi } from "vitest";
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
