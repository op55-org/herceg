// The matrix's charts mounted in the page, for the proofs of what a live
// chart does: clicks, gestures, keys, renderers, sync, and hydration.

import { afterEach } from "vitest";
import type { SelectionStore } from "../../../src/data/selection.ts";
import type { Table } from "../../../src/data/table.ts";
import { type Chart, createChart } from "../../../src/dom/chart.ts";
import { hydrateChart } from "../../../src/dom/hydrate.ts";
import { estimateText } from "../../../src/layout/text.ts";
import { renderToSnapshot } from "../../../src/render/snapshot.ts";
import type { Scene } from "../../../src/scene/scene.ts";
import {
  expectRefused,
  loadedOf,
  type Refusal,
  type Region,
  regionOf,
} from "../../contracts/matrix.ts";
import { modelOf } from "../helpers.ts";

const mounted: { chart: Chart; host: HTMLElement }[] = [];

afterEach(() => {
  for (const { chart, host } of mounted.splice(0)) {
    chart.destroy();
    host.remove();
  }
});

type Spec = Parameters<typeof loadedOf>[0];

/** A chart of a spec's options in a host 600 by 400 pixels, destroyed after the test. */
function place(spec: Spec, options: object) {
  const loaded = loadedOf(spec);
  const host = document.createElement("div");
  host.style.cssText = "width:600px;height:400px";
  document.body.append(host);
  const chart = createChart(host, { ...loaded.config, ...options } as never);
  mounted.push({ chart, host });
  return { chart, tables: loaded.tables, stores: loaded.stores };
}

/** Rejects after 5 s: a chart whose loading never settles fails, not the test's timeout. */
async function settled<T>(promise: Promise<T> | undefined, what: string): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stalled = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} did not settle in 5 s`)), 5000);
  });
  return Promise.race([promise, stalled]).finally(() => clearTimeout(timer));
}

/**
 * A chart of a spec (see `loadedOf`), once its code has loaded and it has
 * drawn, with the tables and selection stores the spec loaded.
 */
export async function mountLoaded(
  spec: Spec,
  options: object = {},
): Promise<{
  chart: Chart;
  tables: ReadonlyMap<string, Table>;
  stores: ReadonlyMap<string, SelectionStore>;
}> {
  const placed = place(spec, options);
  await settled(placed.chart.loading, "chart.loading");
  placed.chart.render();
  return placed;
}

/**
 * Two charts of a spec reading the same tables, each with options of its
 * own, fixed at the page's top left: on screen, where views and values
 * animate. Once their code has loaded and they have drawn.
 */
export async function mountPair(
  spec: Spec,
  a: object,
  b: object,
): Promise<{ a: Chart; b: Chart; tables: ReadonlyMap<string, Table> }> {
  const loaded = loadedOf(spec);
  const [first, second] = [a, b].map((options) => {
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:400px";
    document.body.append(host);
    const chart = createChart(host, { ...loaded.config, ...options } as never);
    mounted.push({ chart, host });
    return chart;
  }) as [Chart, Chart];
  for (const chart of [first, second]) {
    await settled(chart.loading, "chart.loading");
    chart.render();
  }
  return { a: first, b: second, tables: loaded.tables };
}

/** A chart of a spec (see `loadedOf`), once its code has loaded and it has drawn. */
export async function mount(spec: Spec, options: object = {}): Promise<Chart> {
  return (await mountLoaded(spec, options)).chart;
}

/**
 * A chart of a spec drawn on the server (`renderToSnapshot`), its markup
 * put in a host, then hydrated: the chart, and the root and geometry nodes
 * the server wrote.
 */
export async function hydrate(
  spec: Spec,
): Promise<{ chart: Chart; root: Element; nodes: Element[] }> {
  const { config } = loadedOf(spec);
  const initial = renderToSnapshot(config, { width: 600, height: 400, idPrefix: "served" });
  const host = document.createElement("div");
  host.style.cssText = "width:600px;height:400px";
  document.body.append(host);
  host.innerHTML = initial.html;
  const root = host.firstElementChild!;
  const nodes = [...root.querySelectorAll("svg [data-kind]")];
  const chart = hydrateChart(host, config, initial);
  mounted.push({ chart, host });
  await settled(chart.loading, "chart.loading");
  chart.render();
  return { chart, root, nodes };
}

/**
 * What a chart of a spec refuses: the error loading the spec throws, or
 * the one the chart's `ready` rejects with; undefined once it draws.
 */
export async function refusalOf(spec: Spec, options: object = {}): Promise<unknown> {
  let chart: Chart;
  try {
    ({ chart } = place(spec, options));
  } catch (error) {
    return error;
  }
  // Listened to, the failure is the chart's to report, not the console's.
  chart.on("error", () => {});
  return settled(
    chart.ready.then(
      () => undefined,
      (error: unknown) => error,
    ),
    "chart.ready",
  );
}

/**
 * The pixels of a chart's canvas (RGBA, device pixels) as they show over a
 * white page; undefined when it draws nothing on a canvas.
 */
export function canvasPixels(chart: Chart): Uint8ClampedArray | undefined {
  const canvas = chart.root.querySelector("canvas");
  if (!canvas || canvas.width === 0 || canvas.height === 0) return undefined;
  const copy = document.createElement("canvas");
  [copy.width, copy.height] = [canvas.width, canvas.height];
  const context = copy.getContext("2d")!;
  context.fillStyle = "#fff";
  context.fillRect(0, 0, copy.width, copy.height);
  context.drawImage(canvas, 0, 0);
  return context.getImageData(0, 0, copy.width, copy.height).data;
}

/** The smallest region holding every panel's plot. */
export const plotsOf = (chart: Chart): Region =>
  regionOf(chart.getPanels().map(({ plot }) => plot));

/** The scene a mounted chart draws now. */
export function sceneOf(chart: Chart): Scene {
  return modelOf(chart).scene(estimateText);
}

/** The buttons of a chart's legends, in legend order. */
export function legendButtons(chart: Chart): HTMLButtonElement[] {
  return [...chart.root.querySelectorAll<HTMLButtonElement>('[aria-label="Legend"] button')];
}

/** Expects a chart of the spec refused as the cell declares, when its spec loads or when it draws. */
export async function expectChartRefused(
  spec: Spec,
  refusal: Refusal,
  options: object = {},
): Promise<void> {
  const error = await refusalOf(spec, options);
  expectRefused(() => {
    if (error !== undefined) throw error;
  }, refusal);
}
