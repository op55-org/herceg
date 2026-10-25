// What the interaction contract proofs share: charts of one data set in each
// placement (one panel, subplots, facet panels, an inset), input dispatched
// at pixels of a panel, and the rule every gesture keeps: it acts in the
// panel it is in, on that panel's scale instances, and the panels sharing
// an instance follow while the others stay as they were.
//
// It does not import ../helpers.ts, whose import loads the interaction
// controller: the proofs of input before it loads need it unloaded.

import { afterEach, expect } from "vitest";
import { MOUSE } from "../../../../../scripts/browser/mouse.ts";
import { table } from "../../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../../src/dom/chart.ts";
import type { ChartEvents } from "../../../src/dom/events.ts";
import type { Axis, PanelInfo } from "../../../src/dom/handle.ts";
import { columns, inset, panel } from "../../../src/layout.ts";
import { line } from "../../../src/marks/line.ts";
import { facet } from "../../../src/model/facet.ts";
import { panels } from "../../../src/model/panels.ts";
import type { InteractionSpec } from "../../../src/spec/spec.ts";

export { MOUSE };

export const AXES = ["x", "y", "yRight"] as const;

const hosts: HTMLElement[] = [];
const charts: Chart[] = [];

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

/** A host of the size given, in the page. */
export function host(width = 640, height = 400): HTMLDivElement {
  const element = document.createElement("div");
  element.style.cssText = `width:${width}px;height:${height}px`;
  document.body.append(element);
  hosts.push(element);
  return element;
}

/** A chart in a host of its own, destroyed after the test; not waiting for what it loads. */
export function mountNow(options: ChartOptions, into: HTMLElement = host()): Chart {
  const chart = createChart(into, { locale: "en-US", renderer: "svg", ...options });
  charts.push(chart);
  return chart;
}

/** A chart, once its interaction controller (and what it loads) has loaded. */
export async function mount(options: ChartOptions, into?: HTMLElement): Promise<Chart> {
  const chart = mountNow(options, into);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

export const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Ten x values, twice: region eu then us, with a second measure and two kinds. */
export function rows() {
  const n = 20;
  return table({
    t: Float64Array.from({ length: n }, (_, i) => i % 10),
    v: Float64Array.from({ length: n }, (_, i) => 10 + ((i * 7) % 10) + (i < 10 ? 0 : 20)),
    w: Float64Array.from({ length: n }, (_, i) => 100 + ((i * 3) % 10) * 10),
    region: Array.from({ length: n }, (_, i) => (i < 10 ? "eu" : "us")),
    kind: Array.from({ length: n }, (_, i) => (i % 2 ? "odd" : "even")),
  });
}

export type PlacementName = "chart" | "subplots" | "facets" | "insets";

/** A chart of `rows()` in a placement, and the panel gestures are made in. */
export interface Placement {
  name: PlacementName;
  /** The panel input acts in: the only one, subplot b, facet panel us, or the inset. */
  target: string;
  options(interaction?: InteractionSpec, extra?: Partial<ChartOptions>): ChartOptions;
}

/**
 * The placements, each with an x scale its panels share (insets aside,
 * which have their own) and y scales of each panel's own, so a gesture
 * shows both a panel's own scales and the ones it shares.
 */
export function placements(data = rows()): Placement[] {
  return [
    {
      name: "chart",
      target: "",
      options: (interaction, extra) => ({
        marks: [line(data, { x: "t", y: "v" })],
        ...(interaction && { interaction }),
        ...extra,
      }),
    },
    {
      name: "subplots",
      target: "b",
      options: (interaction, extra) => ({
        marks: [
          line(data, { x: "t", y: "v", panel: "a" }),
          line(data, { x: "t", y: "w", panel: "b" }),
        ],
        panels: panels(columns([1, 1], [panel("a"), panel("b")])),
        x: { scope: "chart" },
        ...(interaction && { interaction }),
        ...extra,
      }),
    },
    {
      name: "facets",
      target: "us",
      options: (interaction, extra) => ({
        marks: [line(data, { x: "t", y: "v" })],
        facet: facet("region"),
        y: { scope: "panel" },
        ...(interaction && { interaction }),
        ...extra,
      }),
    },
    {
      name: "insets",
      target: "detail",
      options: (interaction, extra) => ({
        marks: [
          line(data, { x: "t", y: "v", panel: "main" }),
          line(data, { x: "t", y: "w", panel: "detail" }),
        ],
        panels: panels(panel("main", [inset({ id: "detail" }, { width: { fraction: 0.45 } })])),
        ...(interaction && { interaction }),
        ...extra,
      }),
    },
  ];
}

/** The panel keyed `key`, as the last frame drew it. */
export function panelOf(chart: Chart, key: string): PanelInfo {
  const found = chart.getPanels().find((drawn) => drawn.key === key);
  if (!found) throw new Error(`no panel "${key}" drawn`);
  return found;
}

/** A point of panel `key`'s plot, as fractions of its width and height from its top left corner. */
export function within(chart: Chart, key: string, fx = 0.5, fy = 0.5): [number, number] {
  const { plot } = panelOf(chart, key);
  return [Math.round(plot.x + plot.width * fx), Math.round(plot.y + plot.height * fy)];
}

/** A pointer event at (x, y) of the chart's root. */
export function pointer(
  chart: Chart,
  type: string,
  x: number,
  y: number,
  init: PointerEventInit = {},
): PointerEvent {
  const rect = chart.root.getBoundingClientRect();
  const event = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: MOUSE,
    isPrimary: true,
    clientX: rect.left + x,
    clientY: rect.top + y,
    ...init,
  });
  chart.root.dispatchEvent(event);
  return event;
}

/** A wheel step at (x, y): with Ctrl (zooming in), or sideways (`dx`, panning). */
export function wheel(chart: Chart, x: number, y: number, { ctrl = true, dx = 0, dy = -200 } = {}) {
  const rect = chart.root.getBoundingClientRect();
  const event = new WheelEvent("wheel", {
    ctrlKey: ctrl,
    deltaX: dx,
    deltaY: ctrl ? dy : 0,
    clientX: rect.left + x,
    clientY: rect.top + y,
    bubbles: true,
    cancelable: true,
  });
  chart.root.dispatchEvent(event);
  return event;
}

/** A drag through `points` (pixels of the chart's root), pressed at the first and released at the last. */
export function drag(chart: Chart, points: readonly (readonly [number, number])[], init = {}) {
  const [first, ...rest] = points;
  pointer(chart, "pointerdown", ...first!, init);
  for (const point of rest) pointer(chart, "pointermove", ...point, init);
  pointer(chart, "pointerup", ...(rest.at(-1) ?? first!), init);
}

/** A key pressed on the chart's root. */
export function key(chart: Chart, name: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", {
    key: name,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  chart.root.dispatchEvent(event);
  return event;
}

/** Events of one type, as they come. */
export function heard<K extends keyof ChartEvents>(chart: Chart, type: K): ChartEvents[K][] {
  const events: ChartEvents[K][] = [];
  chart.on(type, (event) => events.push(event));
  return events;
}

/** Each panel's view, by key. */
export function viewsOf(chart: Chart) {
  return new Map(
    chart
      .getPanels()
      .filter(({ x }) => x)
      .map(({ key }) => [key, chart.getViewport({ panel: key })] as const),
  );
}

/**
 * That a gesture in panel `target` changed its views along `axes` (and
 * only those), and that every other panel shows its views along the
 * instances it shares with `target`, and none along the others: the views
 * `before` (all fitted, by default).
 */
export function expectFollowed(
  chart: Chart,
  target: string,
  axes: readonly Axis[],
  before?: ReadonlyMap<string, ReturnType<Chart["getViewport"]>>,
) {
  chart.render();
  const at = panelOf(chart, target);
  const shown = chart.getViewport({ panel: target });
  for (const axis of AXES) {
    if (!at[axis]) continue;
    if (axes.includes(axis)) expect(shown[axis], `${target} ${axis}`).not.toBeNull();
    else expect(shown[axis], `${target} ${axis}`).toEqual(before?.get(target)?.[axis] ?? null);
  }
  for (const drawn of chart.getPanels()) {
    if (!drawn.x || drawn.key === target) continue;
    const view = chart.getViewport({ panel: drawn.key });
    for (const axis of AXES) {
      const info = drawn[axis];
      if (!info) continue;
      const shares = at[axis]?.instance === info.instance;
      expect(view[axis], `${drawn.key} ${axis}`).toEqual(
        shares ? shown[axis] : (before?.get(drawn.key)?.[axis] ?? null),
      );
    }
  }
}

/** The instances panel `key` draws with, by scale. */
export function instancesOf(chart: Chart, key: string): Partial<Record<Axis, string>> {
  const drawn = panelOf(chart, key);
  return Object.fromEntries(
    AXES.flatMap((axis) => (drawn[axis] ? [[axis, drawn[axis]!.instance]] : [])),
  );
}

/** The panels drawing every one of `scales` of panel `key`'s instances, in order. */
export function panelsSharing(chart: Chart, key: string, scales: readonly Axis[]): string[] {
  const own = instancesOf(chart, key);
  return chart
    .getPanels()
    .filter((drawn) => scales.every((axis) => drawn[axis]?.instance === own[axis]))
    .map(({ key }) => key);
}

/**
 * That `events` were made in panel `target` (a chart of one panel names
 * none, or its own "") and changed only instances it draws with.
 */
export function expectFrom(
  chart: Chart,
  events: readonly ChartEvents["viewport"][],
  target: string,
  cause?: ChartEvents["viewport"]["cause"],
) {
  expect(events.length).toBeGreaterThan(0);
  const own = instancesOf(chart, target);
  for (const event of events) {
    expect(event.panel ?? "").toBe(target);
    if (cause) expect(event.cause).toBe(cause);
    for (const { scale, instance } of event.scales) expect(instance).toBe(own[scale]);
  }
}
