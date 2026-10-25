// The tester's operations dashboard (fixtures/Dashboard.tsx) as an
// acceptance test: what it draws, how the reader moves through it and its
// history, its panels and legends, the charts it links, the sparklines a
// server drew, and input before its code loads. Anything wrong in it is a
// bug to fix, not a case to refuse.

import { hydration, renderToSnapshot } from "herceg";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { describe, expect, vi } from "vitest";
import type { Chart as HercegChart, PanelInfo } from "../../herceg/src/dom/handle.ts";
import { contractTest } from "../../herceg/test/helpers/contracts.ts";
import { Chart } from "../src/index.ts";
import {
  DAY,
  dashboardData,
  END,
  ESTIMATED_FROM,
  HOUR,
  SPARK,
  START,
  sparkOptions,
  TARGET,
} from "./fixtures/Dashboard.tsx";
import {
  type Box,
  belowPanels,
  boxOf,
  cleanups,
  crosshair,
  drag,
  frame,
  host,
  legendButton,
  legendIn,
  middleOf,
  mountDashboard,
  overlaps,
  type Pair,
  panelOf,
  plotBox,
  press,
  texts,
  vertices,
  within,
  xOf,
  yOf,
} from "./fixtures/page.tsx";

describe("dashboard", () => {
  contractTest("dashboard.drawing.react", async () => {
    const { overview, errors } = await mountDashboard();
    expect(errors).toEqual([]);
    const now = panelOf(overview, "now");
    // Load on the left axis, requests on the right.
    expect(now.y?.type).toBe("linear");
    expect(now.yRight?.domain[0]).toBeLessThanOrEqual(650);
    expect(now.yRight?.domain[1]).toBeGreaterThanOrEqual(1150);
    expect(texts(overview, (t) => t === "requests/s")).toHaveLength(1);
    const ticks = texts(overview, (t) => /^\d+$/.test(t)).map((text) => boxOf(overview, text));

    // The target's label, in two lines, outside the plot at the rule's start.
    const [target] = texts(overview, (t) => t.startsWith("Target"));
    expect([...target!.querySelectorAll("tspan")].map((line) => line.textContent)).toEqual([
      "Target",
      `${TARGET}%`,
    ]);
    const targetBox = boxOf(overview, target!);
    expect(targetBox.right).toBeLessThanOrEqual(now.plot.x);
    expect(
      Math.abs((targetBox.top + targetBox.bottom) / 2 - yOf(overview, "now", TARGET)),
    ).toBeLessThan(8);

    // The limit holds each value until the next: every segment flat or upright.
    const limit = overview.root.querySelector('[data-kind="line"][stroke="#c0392b"]')!;
    const steps = vertices(limit.getAttribute("d")!);
    expect(steps.length).toBeGreaterThan(4);
    for (let i = 1; i < steps.length; i++) {
      const [[x0, y0], [x1, y1]] = [steps[i - 1]!, steps[i]!];
      expect(Math.abs(x0 - x1) < 0.2 || Math.abs(y0 - y1) < 0.2, `segment ${i} is a step`).toBe(
        true,
      );
    }
    // Its label at the view's start, beside the axis, clear of the tick labels.
    const [label] = texts(overview, (t) => t === "Limit 57");
    const labelBox = boxOf(overview, label!);
    expect(labelBox.right).toBeLessThanOrEqual(now.plot.x);
    expect(Math.abs((labelBox.top + labelBox.bottom) / 2 - yOf(overview, "now", 57))).toBeLessThan(
      8,
    );
    expect(ticks.filter((tick) => overlaps(tick, labelBox))).toEqual([]);

    // Estimated hours dotted and lighter, from where the estimates start.
    const runs = [...overview.root.querySelectorAll('[data-kind="line"][stroke="#1f4e79"]')]
      .map((path) => ({ path, box: boxOf(overview, path) }))
      .filter(({ box }) =>
        within({ ...box, left: Math.max(box.left, now.plot.x) }, plotBox(now), 2),
      );
    const dotted = runs.filter(({ path }) => path.getAttribute("stroke-dasharray"));
    expect(dotted).toHaveLength(1);
    expect(dotted[0]!.path.getAttribute("opacity")).toBe("0.6");
    const from = xOf(overview, "now", ESTIMATED_FROM);
    expect(Math.abs(vertices(dotted[0]!.path.getAttribute("d")!)[0]![0] - from)).toBeLessThan(4);
    const solid = runs.find(({ path }) => !path.getAttribute("stroke-dasharray"))!;
    expect(Math.abs(vertices(solid.path.getAttribute("d")!).at(-1)![0] - from)).toBeLessThan(4);

    // The latest sample a whole square, inside the plot.
    const latest = overview.root.querySelector('[data-kind="point"][fill="#1f4e79"]')!;
    const square = boxOf(overview, latest);
    expect(Math.abs(square.right - square.left - (square.bottom - square.top))).toBeLessThan(0.5);
    expect(within(square, plotBox(now)), "the square is not cut").toBe(true);
    // Four corners, two sides along each axis: a square, not a circle (whose path has arcs) in one.
    const outline = latest.getAttribute("d")!;
    expect(outline, "no arcs").not.toMatch(/[Aa]/);
    const corners = vertices(outline);
    expect(corners).toHaveLength(4);
    const sides = (axis: 0 | 1) => new Set(corners.map((corner) => corner[axis].toFixed(1))).size;
    expect([sides(0), sides(1)]).toEqual([2, 2]);

    // Badges in their lanes, numbered, each on a stem from the plot's bottom, drawn under it.
    const badges = overview.root.querySelector('[data-kind="point"][fill="#c0392b"]')!;
    const centers = vertices(badges.getAttribute("d")!).map(([x, y]) => [x + 9.05, y] as Pair);
    const lanes = [0.1, 0.22, 0.34];
    const times = [END - 20 * HOUR, END - 12 * HOUR, END - 5 * HOUR];
    const bottom = now.plot.y + now.plot.height;
    expect(centers).toHaveLength(3);
    centers.forEach(([x, y], i) => {
      expect(Math.abs(x - xOf(overview, "now", times[i]!))).toBeLessThan(1);
      expect(Math.abs(y - (bottom - lanes[i]! * now.plot.height))).toBeLessThan(1);
    });
    const numbers = texts(overview, (t) => /^[123]$/.test(t)).filter(
      (text) => text.getAttribute("fill") === "#ffffff",
    );
    expect(
      numbers.map((n) => [n.textContent, Number(n.getAttribute("x")), Number(n.getAttribute("y"))]),
    ).toEqual(
      centers.map(([x, y], i) => [String(i + 1), expect.closeTo(x, 0), expect.closeTo(y, 0)]),
    );
    const stems = [...overview.root.querySelectorAll('line[stroke="#555555"]')];
    expect(
      stems.map((stem) => ["x1", "y1", "y2"].map((name) => Number(stem.getAttribute(name)))),
    ).toEqual(
      centers.map(([x, y]) => [
        expect.closeTo(x, 0),
        expect.closeTo(y, 0),
        expect.closeTo(bottom, 0),
      ]),
    );
    for (const stem of stems)
      expect(stem.compareDocumentPosition(badges) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // Day boundaries labelled inside the plot, each just after its tick.
    for (const panel of [now, panelOf(overview, "before")]) {
      const days = texts(overview, (t) => /^(Mon|Tue|Wed) \d+$/.test(t))
        .map((text) => boxOf(overview, text))
        .filter((box) => within(box, plotBox(panel), 1));
      expect(days.length, `day labels in ${panel.key}`).toBeGreaterThan(0);
    }
    // Wednesday's starts at its midnight's tick, or a few pixels after it.
    const [wednesday] = texts(overview, (t) => t === "Wed 21").filter((text) =>
      within(boxOf(overview, text), plotBox(now), 1),
    );
    const midnight = xOf(overview, "now", START + 2 * DAY);
    // Anchored at its start, SVG's default.
    expect(wednesday!.getAttribute("text-anchor") ?? "start").toBe("start");
    expect(Number(wednesday!.getAttribute("x"))).toBeGreaterThanOrEqual(midnight - 0.5);
    expect(Number(wednesday!.getAttribute("x"))).toBeLessThan(midnight + 12);

    // A grey plot, under its grid lines.
    const grey = [...overview.root.querySelectorAll('rect[fill="#eeeeee"]')];
    const greyIn = (panel: PanelInfo) =>
      grey.map((rect) => boxOf(overview, rect)).filter((box) => within(box, plotBox(panel), 1));
    const union = (boxes: Box[]) => ({
      left: Math.min(...boxes.map((b) => b.left)),
      top: Math.min(...boxes.map((b) => b.top)),
      right: Math.max(...boxes.map((b) => b.right)),
      bottom: Math.max(...boxes.map((b) => b.bottom)),
    });
    for (const panel of [now, panelOf(overview, "before")]) {
      const covered = union(greyIn(panel));
      expect(covered.left).toBeCloseTo(panel.plot.x, 0);
      expect(covered.right).toBeCloseTo(panel.plot.x + panel.plot.width, 0);
      expect(covered.bottom).toBeCloseTo(panel.plot.y + panel.plot.height, 0);
    }
    const grid = overview.root.querySelector('[data-kind="grid"]')!;
    expect(grey[0]!.compareDocumentPosition(grid) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  contractTest("dashboard.navigation.react", async () => {
    const { overview, data, edges, loads, errors } = await mountDashboard();
    expect(errors).toEqual([]);
    const now = panelOf(overview, "now");
    const span = DAY;
    // Dragging the last day right and down: its x moves back, y moves in both panels that share it.
    drag(overview, middleOf(now), [now.plot.width / 4, 40]);
    const moved = overview.getViewport({ panel: "now" });
    expect(moved.x![0]).toBeLessThan(END - DAY - span / 8);
    expect(overview.getViewport({ panel: "before" }).x).toBeNull();
    expect(moved.y).not.toBeNull();
    expect(overview.getViewport({ panel: "before" }).y).toEqual(moved.y);
    // A finger swipes the same way.
    drag(overview, middleOf(now), [now.plot.width / 4, 0], "touch");
    expect(overview.getViewport({ panel: "now" }).x![0]).toBeLessThan(moved.x![0] - span / 8);
    // Back toward the first day loaded, the chart asks for more, which arrives in front.
    const rows = data.telemetry.length;
    const nowEdges = () => edges.filter(({ panels }) => panels.includes("now"));
    for (let i = 0; i < 6 && nowEdges().length === 0; i++)
      drag(overview, middleOf(now), [now.plot.width / 2, 0]);
    expect(nowEdges().map(({ side, cause }) => [side, cause])).toEqual([["start", "pointer"]]);
    expect(data.telemetry.length).toBe(rows + 144);
    expect(data.oldest).toBe(START - DAY);
    // The view holds while history loads, and goes on into it.
    expect(loads).toHaveLength(1);
    expect(loads[0]!.after).toEqual(loads[0]!.before);
    drag(overview, middleOf(now), [now.plot.width, 0]);
    expect(overview.getViewport({ panel: "now" }).x![0]).toBeLessThan(START);
    expect(errors).toEqual([]);
  });

  contractTest("dashboard.panels.react", async () => {
    const { overview, errors } = await mountDashboard();
    expect(errors).toEqual([]);
    const [now, before, incidents, detail] = ["now", "before", "incidents", "detail"].map((key) =>
      panelOf(overview, key),
    ) as [PanelInfo, PanelInfo, PanelInfo, PanelInfo];
    // Columns 2 to 1, rows 3 to 1.
    expect(now.plot.width / before.plot.width).toBeCloseTo(2, 1);
    expect(now.plot.height / incidents.plot.height).toBeCloseTo(3, 1);
    // Shared y, x of their own.
    expect(now.y?.instance).toBe(before.y?.instance);
    expect(now.x?.instance).not.toBe(before.x?.instance);
    // The inset over the last day, its own x, its ranges boxed on the parent.
    expect(detail.parent).toBe("now");
    expect(within(plotBox(detail), plotBox(now))).toBe(true);
    expect(detail.x?.domain).toEqual([END - 3 * HOUR, END]);
    const indicator = overview.root.querySelector('[data-kind="shapes"] path')!;
    // Its box's first two corners: the inset's x range on the parent's x.
    const corners = vertices(indicator.getAttribute("d")!.replace(/H\s*(-?[\d.]+)/, "L$1 0"));
    expect(corners[0]![0]).toBeCloseTo(xOf(overview, "now", END - 3 * HOUR), 0);
    expect(corners[1]![0]).toBeCloseTo(xOf(overview, "now", END), 0);
    // The last day's legend inside its plot; the chart's below, of what the others draw.
    expect(legendIn(overview, plotBox(now))).toEqual(["load", "requests", "limit"]);
    expect(legendIn(overview, belowPanels(overview))).toEqual(["load", "Site A", "Site B"]);
  });

  contractTest("dashboard.sync-selection-legends.react", async () => {
    const { overview, week, data, errors } = await mountDashboard();
    expect(errors).toEqual([]);
    const now = panelOf(overview, "now");
    // The week shows seven days, hourly: another range at another frequency.
    const [from, to] = week.getPanels()[0]!.x!.domain as Pair;
    expect(to - from).toBeGreaterThan(6 * DAY);
    // The pointer on the last day's load ten minutes before one of the week's hourly samples,
    // which the overview reads and shares: the week's cursor snaps to its sample before (snap
    // "previous"), almost an hour back, which on the week's x is a distance a cursor left where
    // the pointer is would not be within.
    const times = Array.from(data.weekly.numbers("t"));
    const at = times.find((t) => t > END - 10 * HOUR)! - 10 * 60_000;
    const previous = Math.max(...times.filter((t) => t <= at));
    const snapped = week.toPixel(previous, { axis: "x" })!;
    const unsnapped = week.toPixel(at, { axis: "x" })!;
    expect(unsnapped - snapped, "the pointer is apart from the sample before").toBeGreaterThan(1.5);
    const load = data.telemetry.numbers("load")[data.telemetry.numbers("t").indexOf(at)]!;
    const y = overview.toPixel(load, { axis: "y", panel: "now" })!;
    press(overview, "pointermove", [xOf(overview, "now", at), y]);
    await frame();
    await frame();
    expect(Math.abs(crosshair(week)! - snapped)).toBeLessThan(0.75);
    // Clicking the second badge picks its event, which the week highlights.
    const changes: unknown[] = [];
    week.on("rowSelection", (event) => changes.push(event));
    const badge: Pair = [
      xOf(overview, "now", END - 12 * HOUR),
      now.plot.y + now.plot.height * (1 - 0.22),
    ];
    for (const type of ["pointerdown", "pointerup", "click"]) press(overview, type, badge);
    await frame();
    const picked = data.picks.get("picked");
    expect(picked?.kind).toBe("rows");
    expect(picked?.kind === "rows" && [...picked.rows.positions()]).toEqual([1]);
    expect(changes.length).toBeGreaterThan(0);
    week.render();
    const events = [...week.root.querySelectorAll('[data-kind="point"][fill="#c0392b"]')];
    const dimmed = (path: Element) => Number(path.getAttribute("fill-opacity") ?? 1) <= 0.5;
    const lanes = (paths: Element[]) =>
      paths.flatMap((path) => vertices(path.getAttribute("d")!).map(([, y]) => y));
    const { plot } = week.getPanels()[0]!;
    // The second event, in the 22% lane, as drawn; the others at a quarter of their opacity.
    expect(lanes(events.filter((path) => !dimmed(path)))).toEqual([
      expect.closeTo(plot.y + plot.height * (1 - 0.22), 0),
    ]);
    expect(lanes(events.filter(dimmed))).toHaveLength(2);
    // The chart's legend hides a site in every panel; the last day's hides only there.
    legendButton(overview, "Site A", belowPanels(overview)).click();
    overview.render();
    expect(overview.getHiddenKeys()).toHaveLength(1);
    legendButton(overview, "requests", plotBox(now)).click();
    overview.render();
    expect(overview.getHiddenKeys({ panel: "now" })).toHaveLength(2);
    expect(overview.getHiddenKeys({ panel: "before" })).toHaveLength(1);
    expect(overview.root.querySelector('[data-kind="line"][stroke="#9aa5b1"]')).toBeNull();
    expect(errors).toEqual([]);
  });

  contractTest("dashboard.hydration.react", async () => {
    const data = dashboardData();
    const options = sparkOptions(data);
    const sparks = ["load", "requests"].map((name) => ({
      name,
      initial: hydration(renderToSnapshot(options, { ...SPARK, idPrefix: `spark-${name}` })),
    }));
    const charts: (HercegChart | null)[] = [];
    const app = (
      <div>
        {sparks.map(({ name, initial }, i) => (
          <Chart
            key={name}
            {...options}
            {...SPARK}
            initial={initial}
            ref={(chart) => {
              charts[i] = chart;
            }}
          />
        ))}
      </div>
    );
    const element = host();
    element.innerHTML = renderToString(app);
    const served = [...element.querySelectorAll("svg [data-kind]")];
    expect(served.length).toBeGreaterThanOrEqual(4);
    const logged: unknown[] = [];
    const error = vi.spyOn(console, "error").mockImplementation((...args) => logged.push(args));
    cleanups.push(() => error.mockRestore());
    let root: Root | undefined;
    act(() => {
      root = hydrateRoot(element, app);
    });
    cleanups.push(() => act(() => root!.unmount()));
    for (const chart of charts) await chart!.loading;
    for (const chart of charts) chart!.render();
    expect(logged, "no hydration mismatch").toEqual([]);
    // The server's nodes, adopted rather than drawn again.
    expect(served.filter((node) => !node.isConnected)).toEqual([]);
    for (const chart of charts) {
      const svg = chart!.root.querySelector("svg")!;
      expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual(["140", "48"]);
      // No padding: the line runs edge to edge, and its end square is whole.
      const line = boxOf(chart!, chart!.root.querySelector('[data-kind="line"]')!);
      expect(line.right - line.left).toBeGreaterThan(0.9 * SPARK.width);
      const square = boxOf(chart!, chart!.root.querySelector('[data-kind="point"]')!);
      expect(square.left).toBeGreaterThanOrEqual(-0.5);
      expect(square.right).toBeLessThanOrEqual(SPARK.width + 0.5);
      expect(square.top).toBeGreaterThanOrEqual(-0.5);
      expect(square.bottom).toBeLessThanOrEqual(SPARK.height + 0.5);
    }
  });
});
