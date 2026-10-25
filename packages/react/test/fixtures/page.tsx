// The page the dashboard's acceptance tests mount it in (dashboard.test.tsx,
// dashboard-early-input.test.tsx), and what they read of what it draws.

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect } from "vitest";
// The pointer's id alone: herceg's browser helpers load the interaction
// controller, which the early-input test needs to arrive after the input.
import { MOUSE } from "../../../../scripts/browser/mouse.ts";
import type { ChartEvents } from "../../../herceg/src/dom/events.ts";
import type { Chart as HercegChart, PanelInfo } from "../../../herceg/src/dom/handle.ts";
import type { ChartError } from "../../../herceg/src/spec/errors.ts";
import { DAY, type DashboardData, dashboardData, END, Overview, Week } from "./Dashboard.tsx";

type Edge = ChartEvents["edge"];

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

export type Box = { left: number; top: number; right: number; bottom: number };
export type Pair = [number, number];

export const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

export function host(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.width = "900px";
  document.body.append(element);
  cleanups.push(() => element.remove());
  return element;
}

export interface Mounted {
  data: DashboardData;
  overview: HercegChart;
  week: HercegChart;
  errors: ChartError[];
  edges: Edge[];
  /** The last day's x view as each load of earlier history began, and once it was drawn. */
  loads: { before: Pair; after: Pair }[];
  element: HTMLElement;
  render(): void;
  unmount(): void;
}

/** The dashboard's two charts in a page 900 px wide, once drawn and their code loaded. */
export async function mountDashboard({ wait = true } = {}): Promise<Mounted> {
  const element = host();
  const data = dashboardData();
  const refs = { overview: { current: null }, week: { current: null } } as {
    overview: { current: HercegChart | null };
    week: { current: HercegChart | null };
  };
  const errors: ChartError[] = [];
  const edges: Edge[] = [];
  const loads: Mounted["loads"] = [];
  const root = createRoot(element);
  const render = () =>
    act(() =>
      root.render(
        <>
          <Overview
            data={data}
            chart={refs.overview}
            onError={(error) => errors.push(error)}
            onEdge={(event) => {
              edges.push(event);
              // Older history, as a server would send it, once the reader takes the last
              // day back to it (the week beside it starts there anyway); the extent widens.
              if (event.side === "start" && event.panels.includes("now")) {
                const view = () => refs.overview.current!.getViewport({ panel: "now" }).x as Pair;
                const before = view();
                data.loadEarlier();
                render();
                refs.overview.current!.render();
                loads.push({ before, after: view() });
              }
            }}
          />
          <Week data={data} chart={refs.week} onError={(error) => errors.push(error)} />
        </>,
      ),
    );
  render();
  let mountedNow = true;
  const unmount = () => {
    if (mountedNow) act(() => root.unmount());
    mountedNow = false;
  };
  cleanups.push(unmount);
  const mounted: Mounted = {
    data,
    overview: refs.overview.current!,
    week: refs.week.current!,
    errors,
    edges,
    loads,
    element,
    render,
    unmount,
  };
  if (wait) {
    await Promise.all([mounted.overview.loading, mounted.week.loading]);
    for (const chart of [mounted.overview, mounted.week]) chart.render();
  }
  return mounted;
}

export const panelOf = (chart: HercegChart, key: string): PanelInfo =>
  chart.getPanels().find((panel) => panel.key === key)!;

/** An element's box relative to its chart's root, in CSS pixels. */
export function boxOf(chart: HercegChart, element: Element): Box {
  const root = chart.root.getBoundingClientRect();
  const { left, top, right, bottom } = element.getBoundingClientRect();
  return {
    left: left - root.left,
    top: top - root.top,
    right: right - root.left,
    bottom: bottom - root.top,
  };
}

/** Whether `box` lies inside `area`, give or take `slack` pixels. */
export const within = (box: Box, area: Box, slack = 0.5) =>
  box.left >= area.left - slack &&
  box.top >= area.top - slack &&
  box.right <= area.right + slack &&
  box.bottom <= area.bottom + slack;

export const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

export const texts = (chart: HercegChart, match: (text: string) => boolean) =>
  [...chart.root.querySelectorAll("svg text")].filter((text) => match(text.textContent ?? ""));

/** The pixel of a time on a panel's x, and of a value on its y (or right y). */
export const xOf = (chart: HercegChart, panel: string, t: number) =>
  chart.toPixel(t, { axis: "x", panel })!;
export const yOf = (chart: HercegChart, panel: string, v: number, axis: "y" | "yRight" = "y") =>
  chart.toPixel(v, { axis, panel })!;

/** The points of an SVG path's moves and lines ("M x y L x y ..."). */
export const vertices = (d: string): Pair[] =>
  [...d.matchAll(/[ML]\s*(-?[\d.]+)[ ,](-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

/** A press of a pointer of `type` at a pixel of the chart's root. */
export function press(chart: HercegChart, type: string, [x, y]: Pair, pointerType = "mouse") {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + x,
      clientY: rect.top + y,
      pointerId: pointerType === "mouse" ? MOUSE : 7,
      pointerType,
      isPrimary: true,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}

/** Drags from `from` by `by` pixels in steps, as a mouse or a finger does. */
export function drag(chart: HercegChart, from: Pair, [dx, dy]: Pair, pointerType = "mouse") {
  press(chart, "pointerdown", from, pointerType);
  for (let step = 1; step <= 4; step++)
    press(
      chart,
      "pointermove",
      [from[0] + (dx * step) / 4, from[1] + (dy * step) / 4],
      pointerType,
    );
  press(chart, "pointerup", [from[0] + dx, from[1] + dy], pointerType);
}

/** A panel's plot as a box. */
export const plotBox = ({ plot }: PanelInfo): Box => ({
  left: plot.x,
  top: plot.y,
  right: plot.x + plot.width,
  bottom: plot.y + plot.height,
});

/** The box under the last row of panels, to the chart's bottom: where its legend goes. */
export const belowPanels = (chart: HercegChart): Box => {
  const bottom = Math.max(...chart.getPanels().map(({ plot }) => plot.y + plot.height));
  const { width, height } = chart.root.getBoundingClientRect();
  return { left: 0, top: bottom, right: width, bottom: height };
};

/** The legend button labelled `label` inside a box. */
export const legendButton = (chart: HercegChart, label: string, box: Box) =>
  [...chart.root.querySelectorAll("button")].find(
    (button) => button.textContent === label && within(boxOf(chart, button), box),
  )!;

export const middleOf = ({ plot }: PanelInfo): Pair => [
  plot.x + plot.width / 2,
  plot.y + plot.height / 2,
];

/** The visible vertical crosshair's x in a chart; undefined for none. */
export function crosshair(chart: HercegChart): number | undefined {
  const line = [...chart.root.querySelectorAll("svg line")].find(
    (line) =>
      line.getAttribute("visibility") === "visible" &&
      line.getAttribute("x1") === line.getAttribute("x2"),
  );
  return line ? Number(line.getAttribute("x1")) : undefined;
}

/** The legend buttons inside a box, by label. */
export const legendIn = (chart: HercegChart, box: Box) =>
  [...chart.root.querySelectorAll("button")]
    .filter((button) => within(boxOf(chart, button), box))
    .map((button) => button.textContent);

/**
 * Drags the last day back by a quarter of the chart's width while the
 * overview's code is still loading (it draws once its axes' code is here),
 * and expects the drag kept and handled once the code is here.
 */
export async function expectDragBeforeLoaded({ overview, week }: Mounted) {
  expect(overview.loading, "its code is loading").toBeDefined();
  let loaded = false;
  overview.loading!.then(() => {
    loaded = true;
  });
  // The component's box: the chart's own has no height before it first draws.
  const { width, height } = overview.root.parentElement!.getBoundingClientRect();
  const at: Pair = [width * 0.28, height * 0.36];
  drag(overview, at, [width / 4, 0]);
  expect(loaded, "the drag came before the code").toBe(false);
  await overview.loading;
  await week.loading;
  overview.render();
  const now = panelOf(overview, "now");
  const pressed = { left: at[0], top: at[1], right: at[0], bottom: at[1] };
  expect(within(pressed, plotBox(now)), JSON.stringify({ at, plot: now.plot })).toBe(true);
  // Back by the drag's quarter of the chart's width, in the last day's time.
  const [from, to] = now.x!.domain as Pair;
  const moved = ((width / 4) * (to - from)) / now.plot.width;
  const start = overview.getViewport({ panel: "now" }).x![0];
  expect(start).toBeLessThan(END - DAY - 0.9 * moved);
  expect(start).toBeGreaterThan(END - DAY - 1.1 * moved);
}
