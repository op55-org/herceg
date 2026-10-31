// Proofs of the matrix's lifecycle (test/contracts/), one per row: views
// and values animate (mid-way neither where they were nor where they go,
// ending as a chart without animation draws them); two charts share the
// cursor, the view, and the selection without echo; and a chart drawn on
// the server is hydrated (its nodes adopted, not written again), answers
// the pointer, takes updates, and leaves the page when destroyed.

import "../interactive.ts";
import { afterEach, describe, expect, vi } from "vitest";
import type { Table } from "../../../src/data/table.ts";
import type { Chart } from "../../../src/dom/chart.ts";
import type { Inspection } from "../../../src/model/model.ts";
import { ChartError } from "../../../src/spec/errors.ts";
import { cellsOf, defaultsOf, fixtureOf, markOf, neighbor } from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { dateTimes } from "../helpers.ts";
import { expectChartRefused, hydrate, mount, mountPair } from "./mount.ts";
import { type Item, itemAt, type Pair, pixel, pixels, press } from "./pointer.ts";

interface Reading {
  at?: Pair | Item;
  points?: [string, number | null, string][];
  describes: string[];
}

function readingOf(row: string): Reading {
  const { read } = defaultsOf(fixtureOf(row).table) as { read?: Pair };
  return { ...(read && { at: read }), ...(fixtureOf(row).reading as Reading) };
}

/** What moves a row (rows.json's `lifecycle`, over its table's). */
interface Lifecycle {
  change: [field: string, row: number, value: number | string];
  view?: "x" | "y" | { x: Pair; y: Pair };
  cursor?: "x" | "y";
}

function lifecycleOf(row: string): Lifecycle {
  const { table, lifecycle } = fixtureOf(row) as { table: string; lifecycle?: object };
  return { ...(defaultsOf(table, "lifecycle") as unknown as Lifecycle), ...lifecycle };
}

afterEach(releaseTime);

/**
 * Gives frames and the clock back. Transitions run to their end first, so
 * that the shared scheduler asks for no frame the real clock never runs.
 */
function releaseTime(): void {
  if (!vi.isFakeTimers()) return;
  vi.advanceTimersByTime(2000);
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const tick = (ms: number) => vi.advanceTimersByTime(ms);

/**
 * Frames and the clock from here on are the test's: time moves only with
 * `tick`, so frames take no time and transitions never fall back for speed.
 */
async function controlTime(charts: Chart[]): Promise<void> {
  await frame();
  await frame();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "performance"] });
  for (const chart of charts) {
    chart.render();
    // Asks for a frame without changing anything, so the scheduler runs one.
    chart.root.dispatchEvent(new PointerEvent("pointerleave"));
  }
  tick(16);
}

/** What the chart's SVG draws of its marks (not grid lines), without the ids that tell charts apart. */
const drawn = (chart: Chart, kinds?: (kind: string) => boolean) =>
  [...chart.root.querySelectorAll<SVGElement>('svg [data-kind]:not([data-kind="grid"])')]
    .filter((element) => !kinds || kinds(element.dataset.kind!))
    .map((element) => element.outerHTML.replace(/herceg-\d+/g, ""))
    .join("");

const VALUES = { duration: 300, values: true } as const;

/** Expects `moving` part way to `still`, then there: mid-way neither where it was nor where it goes. */
function expectMoves(moving: Chart, still: Chart, before: string, move: () => void) {
  move();
  tick(16);
  tick(80);
  const [mid, end] = [drawn(moving), drawn(still)];
  expect(end, "the change is drawn").not.toBe(before);
  expect(mid, "mid-way, not where it was").not.toBe(before);
  expect(mid, "mid-way, not where it goes").not.toBe(end);
  tick(500);
  expect(drawn(moving), "it ends as a chart without animation draws it").toBe(end);
}

/** The error a call throws. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

const continuous = (axis: { type: string } | undefined) =>
  !!axis && axis.type !== "band" && axis.type !== "category";

/** The axis a row's view moves along: its fixture's, else x where x is continuous, else y. */
function axisOf(chart: Chart, row: string): "x" | "y" {
  const { view } = lifecycleOf(row);
  if (view === "x" || view === "y") return view;
  return continuous(chart.getPanels()[0]?.x) ? "x" : "y";
}

/** A view of `axis` shifted from the chart's and wider, so that what spans its domain shows an edge. */
function shifted(chart: Chart, axis: "x" | "y"): Pair {
  const [lo, hi] = chart.getPanels()[0]![axis]!.domain as Pair;
  const span = hi - lo;
  return [lo + 0.25 * span, hi + 0.6 * span];
}

/** A view of `axis` around the chart's domain, off center. */
function around(chart: Chart, axis: "x" | "y"): Pair {
  const [lo, hi] = chart.getPanels()[0]![axis]!.domain as Pair;
  const span = hi - lo;
  return [lo - 0.5 * span, hi + 0.25 * span];
}

describe("lifecycle.value-animation", () => {
  for (const cell of cellsOf("lifecycle.value-animation"))
    contractTest(`${cell.row}.lifecycle.value-animation`, async () => {
      const spec = { marks: [markOf(cell.row)] };
      if (cell.state === "refused") return expectChartRefused({ ...spec, animation: VALUES }, cell);
      if (cell.state === "na") {
        // Beside a line whose values move, the annotation stays as drawn.
        const { a: moving, tables } = await mountPair(
          { marks: [neighbor(), markOf(cell.row)], y: { domain: [0, 50] } },
          { renderer: "svg", animation: VALUES },
          { renderer: "svg", animation: false },
        );
        await controlTime([moving]);
        const isLine = (kind: string) => kind === "line";
        const [line, annotation] = [drawn(moving, isLine), drawn(moving, (k) => !isLine(k))];
        tables.get("samples")!.set("y", 3, 14);
        tick(16);
        tick(80);
        expect(drawn(moving, isLine), "the line moves").not.toBe(line);
        expect(drawn(moving, (k) => !isLine(k))).toBe(annotation);
        return;
      }
      const {
        a: moving,
        b: still,
        tables,
      } = await mountPair(
        spec,
        { renderer: "svg", animation: VALUES },
        { renderer: "svg", animation: false },
      );
      await controlTime([moving, still]);
      const [field, row, value] = lifecycleOf(cell.row).change;
      const data = tables.get(fixtureOf(cell.row).table) as Table;
      expectMoves(moving, still, drawn(moving), () =>
        data.set(field as never, row, value as never),
      );
    });

  contractTest("lifecycle.value-animation.layout", async () => {
    // Bars in one panel, a line in the other, of one table: both move.
    const {
      a: moving,
      b: still,
      tables,
    } = await mountPair(
      {
        panels: [{ id: "a" }, { id: "b" }],
        marks: [markOf("bar", { panel: "a" }), neighbor({ panel: "b" })],
      },
      { renderer: "svg", animation: VALUES },
      { renderer: "svg", animation: false },
    );
    await controlTime([moving, still]);
    const isLine = (kind: string) => kind === "line";
    const isBar = (kind: string) => kind !== "line" && kind !== "text";
    const before = [drawn(moving, isBar), drawn(moving, isLine)];
    tables.get("samples")!.set("y", 3, 14);
    tick(16);
    tick(80);
    for (const [i, kinds] of [isBar, isLine].entries()) {
      expect(drawn(moving, kinds), "mid-way, not where it was").not.toBe(before[i]);
      expect(drawn(moving, kinds), "mid-way, not where it goes").not.toBe(drawn(still, kinds));
    }
    tick(500);
    expect(drawn(moving)).toBe(drawn(still));
  });

  // What a refusal of values gives instead: without them, a changed value shows at once,
  // as a chart without animation shows it, in each row whose refusal says so.
  for (const cell of cellsOf("lifecycle.value-animation"))
    if (
      cell.state === "refused" &&
      cell.alternative.proofs.includes(`${cell.row}.lifecycle.value-animation.off`)
    )
      contractTest(`${cell.row}.lifecycle.value-animation.off`, async () => {
        const {
          a: chart,
          b: still,
          tables,
        } = await mountPair(
          { marks: [markOf(cell.row)] },
          { renderer: "svg", animation: { duration: 300 } },
          { renderer: "svg", animation: false },
        );
        await controlTime([chart, still]);
        const before = drawn(chart);
        const [field, row, value] = lifecycleOf(cell.row).change;
        (tables.get(fixtureOf(cell.row).table) as Table).set(field as never, row, value as never);
        tick(16);
        expect(drawn(chart), "the changed value shows").not.toBe(before);
        expect(drawn(chart), "at once, as without animation").toBe(drawn(still));
      });
});

describe("lifecycle.view-animation", () => {
  for (const cell of cellsOf("lifecycle.view-animation"))
    contractTest(`${cell.row}.lifecycle.view-animation`, async () => {
      if (cell.state === "na") {
        // No axes, no view: setViewport refuses the axis, and the drawing stays.
        const chart = await mount({ marks: [markOf(cell.row)] }, { renderer: "svg" });
        const panel = chart.getPanels()[0];
        expect([panel?.x, panel?.y]).toEqual([undefined, undefined]);
        const before = drawn(chart);
        const error = thrownBy(() => chart.setViewport({ x: [0, 1] }));
        expect(error, "setViewport is refused").toBeInstanceOf(ChartError);
        const { code, path, message } = error as ChartError;
        expect({ code, path }).toEqual({ code: "unknown-reference", path: "x" });
        expect(message).toContain("the chart has no x axis; drop x");
        chart.render();
        expect(drawn(chart)).toBe(before);
        return;
      }
      if (cell.state !== "works")
        throw new Error(`lifecycle.view-animation is never ${cell.state}`);
      const { view } = lifecycleOf(cell.row);
      const { a: moving, b: still } = await mountPair(
        { marks: [markOf(cell.row)] },
        { renderer: "svg", animation: { duration: 300 } },
        { renderer: "svg", animation: false },
      );
      await controlTime([moving, still]);
      expectMoves(moving, still, drawn(moving), () => {
        for (const chart of [moving, still]) {
          if (typeof view === "object") chart.setViewport(view);
          else {
            const axis = axisOf(chart, cell.row);
            chart.setViewport({ [axis]: shifted(chart, axis) });
          }
        }
      });
    });
});

/** Where a chart's visible crosshair is along `axis`, in pixels; undefined for none. */
function crosshairOf(chart: Chart, axis: "x" | "y"): number | undefined {
  const [from, to] = axis === "x" ? ["x1", "x2"] : ["y1", "y2"];
  const line = [...chart.root.querySelectorAll("svg line")].find(
    (line) =>
      line.getAttribute("visibility") === "visible" &&
      line.getAttribute(from!) === line.getAttribute(to!),
  );
  return line ? Number(line.getAttribute(from!)) : undefined;
}

/** Counts a chart's events of a type from now on. */
function heard(chart: Chart, type: "hover" | "viewport" | "select"): unknown[] {
  const events: unknown[] = [];
  chart.on(type, (event) => events.push(event));
  return events;
}

/**
 * The value a row's cursor goes to along `axis`, and the pixel the pointer
 * goes to in `chart`: where the row reads a point, else the plot's middle.
 * A cursor reading a point stands where the point is drawn instead (a
 * calendar's cell), which peers show.
 */
function cursorTarget(chart: Chart, row: string, axis: "x" | "y"): { value: number; at: Pair } {
  const { at, points } = readingOf(row);
  const panel = chart.getPanels()[0]!;
  if (Array.isArray(at) && points) {
    const value = at[axis === "x" ? 0 : 1];
    const banded = !continuous(panel[axis]);
    return { value: banded ? Math.round(value) : value, at: pixels(chart, at) };
  }
  const [lo, hi] = panel[axis]!.domain as Pair;
  const value = (lo + hi) / 2;
  const middle = axis === "x" ? [value, undefined] : [undefined, value];
  const { plot } = panel;
  return {
    value,
    at: [
      middle[0] === undefined ? plot.x + plot.width / 2 : pixel(chart, value, "x"),
      middle[1] === undefined ? plot.y + plot.height / 2 : pixel(chart, value, "y"),
    ],
  };
}

describe("lifecycle.cursor-sync", () => {
  for (const cell of cellsOf("lifecycle.cursor-sync"))
    contractTest(`${cell.row}.lifecycle.cursor-sync`, async () => {
      const axis = lifecycleOf(cell.row).cursor ?? "x";
      const group = `cursor ${cell.row}`;
      const interaction = { sync: { cursor: { group, scale: axis } } };
      const spec = { marks: [markOf(cell.row)], interaction };
      if (cell.state === "refused") return expectChartRefused(spec, cell);
      if (cell.state !== "works") throw new Error(`lifecycle.cursor-sync is never ${cell.state}`);
      const a = await mount(spec);
      const b = await mount(spec);
      // The peer shows another range where its axis can, around its domain, so that the value shows.
      if (continuous(b.getPanels()[0]![axis])) b.setViewport({ [axis]: around(b, axis) });
      b.render();
      const { value: pointed, at } = cursorTarget(a, cell.row, axis);
      const hovers = heard(a, "hover");
      press(a, "pointermove", at);
      await frame();
      await frame();
      // Where it reads a point, the value its readout gives: the point's place, not the pointer's.
      const read = (hovers[0] as { inspection?: Inspection } | undefined)?.inspection;
      const value = read?.axis === axis ? read.value : pointed;
      const shown = crosshairOf(b, axis);
      expect(shown, "the peer shows the cursor").toBeDefined();
      expect(Math.abs(shown! - pixel(b, value, axis))).toBeLessThanOrEqual(1.5);
      // No echo: the first chart's cursor stays at the pointer, reported once, reading what is there.
      expect(Math.abs(crosshairOf(a, axis)! - pixel(a, value, axis))).toBeLessThanOrEqual(1.5);
      const reads = (hover: unknown) =>
        !!(hover as { inspection?: Inspection }).inspection?.points.length;
      expect(hovers.map(reads)).toEqual([!!readingOf(cell.row).points]);
    });

  contractTest("lifecycle.cursor-sync.panel", async () => {
    // Subplots each have an x of their own: the channel carries panel b's.
    const interaction = { sync: { cursor: { group: "cursor panel", panel: "b" } } };
    const a = await mount({
      panels: [{ id: "a" }, { id: "b" }],
      marks: [neighbor({ panel: "a" }), neighbor({ panel: "b" })],
      interaction,
    });
    const b = await mount({
      marks: [neighbor()],
      interaction: { sync: { cursor: "cursor panel" } },
    });
    const [left, right] = ["a", "b"].map((key) => a.getPanels().find((p) => p.key === key));
    const at = (panel: typeof left, x: number): Pair => [
      a.toPixel(x, { axis: "x", panel: panel!.key })!,
      panel!.plot.y + panel!.plot.height / 2,
    ];
    press(a, "pointermove", at(left, 3));
    await frame();
    await frame();
    expect(crosshairOf(b, "x"), "panel a's cursor is not carried").toBeUndefined();
    press(a, "pointermove", at(right, 3));
    await frame();
    await frame();
    expect(Math.abs(crosshairOf(b, "x")! - pixel(b, 3, "x"))).toBeLessThanOrEqual(1.5);
  });
});

describe("lifecycle.viewport-sync", () => {
  for (const cell of cellsOf("lifecycle.viewport-sync"))
    contractTest(`${cell.row}.lifecycle.viewport-sync`, async () => {
      const group = `viewport ${cell.row}`;
      const probe = await mount({ marks: [markOf(cell.row)] });
      const axis = cell.state === "works" ? axisOf(probe, cell.row) : "x";
      const interaction = { sync: { viewport: { group, scale: axis } } };
      const spec = { marks: [markOf(cell.row)], interaction };
      if (cell.state === "refused") return expectChartRefused(spec, cell);
      if (cell.state !== "works") throw new Error(`lifecycle.viewport-sync is never ${cell.state}`);
      const a = await mount(spec);
      const b = await mount(spec);
      const [fromA, fromB] = [heard(a, "viewport"), heard(b, "viewport")];
      const view = shifted(a, axis);
      a.setViewport({ [axis]: view });
      expect(b.getViewport()[axis]).toEqual(view);
      b.render();
      expect(b.getPanels()[0]![axis]!.domain).toEqual(view);
      expect([fromA.length, fromB.length], "each reports it once").toEqual([1, 1]);
    });
});

describe("lifecycle.selection-sync", () => {
  for (const cell of cellsOf("lifecycle.selection-sync"))
    contractTest(`${cell.row}.lifecycle.selection-sync`, async () => {
      const group = `selection ${cell.row}`;
      const interaction = {
        brush: "x" as const,
        sync: { selection: { group, scale: "x" as const } },
      };
      const spec = { marks: [markOf(cell.row)], interaction };
      // Asked to sync selections alone: a mark without brushes refuses the brush first.
      if (cell.state === "refused")
        return expectChartRefused({ ...spec, interaction: { sync: interaction.sync } }, cell);
      if (cell.state !== "works")
        throw new Error(`lifecycle.selection-sync is never ${cell.state}`);
      const a = await mount(spec);
      const b = await mount(spec);
      const { selection } = fixtureOf(cell.row) as { selection?: { x?: Pair } };
      const { x = shifted(a, "x") } = {
        ...(defaultsOf(fixtureOf(cell.row).table) as { x?: Pair }),
        ...selection,
      };
      const [fromA, fromB] = [heard(a, "select"), heard(b, "select")];
      a.select(x);
      // Along categories, a range selects the categories whose middles it holds.
      const banded = !continuous(a.getPanels()[0]!.x);
      expect(a.selection?.x).toEqual(banded ? [Math.ceil(x[0]) || 0, Math.floor(x[1]) || 0] : x);
      expect(b.selection?.x).toEqual(a.selection?.x);
      expect([fromA.length, fromB.length], "each reports it once").toEqual([1, 1]);
    });
});

describe("lifecycle.hydration", () => {
  for (const cell of cellsOf("lifecycle.hydration"))
    contractTest(`${cell.row}.lifecycle.hydration`, async () => {
      if (cell.state !== "works") throw new Error(`lifecycle.hydration is never ${cell.state}`);
      const { chart, root, nodes } = await hydrate({ marks: [markOf(cell.row)] });
      // The server's element and geometry, taken over as they are.
      expect(nodes.length, "the server drew the mark").toBeGreaterThan(0);
      expect(chart.root).toBe(root);
      expect(
        nodes.filter((node) => !node.isConnected),
        "geometry written again",
      ).toEqual([]);
      // It reads its datum, or says what it draws.
      const { at, points, describes } = readingOf(cell.row);
      if (points) {
        const target = Array.isArray(at) ? pixels(chart, at) : itemAt(chart, at!).at;
        const read = chart
          .inspect(...target, { mode: "nearest" })
          ?.points.map((p) => [p.label, p.row ?? null, dateTimes(p.text)]);
        expect(read?.[0]).toEqual(points[0]);
      } else {
        const id = chart.root.getAttribute("aria-describedby")!.split(" ")[0]!;
        for (const part of describes)
          expect(document.getElementById(id)?.textContent).toContain(part);
      }
      // It takes an update, and leaves the page when destroyed.
      chart.update({ title: "Updated" });
      chart.render();
      expect(chart.root.textContent).toContain("Updated");
      chart.destroy();
      expect(root.isConnected).toBe(false);
    });
});
