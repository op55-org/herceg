// Proofs of the matrix's selection (test/contracts/), one per row: real
// gestures report the ranges or the outline they cover; on a chart bound to
// a selection store they write exactly the rows rows.json lists, chosen by
// the rules of src/model/selected-rows.ts; a selection another view writes
// reaches the chart, which draws the rows it holds as they are and dims
// the others.

import "../interactive.ts";
import { describe, expect } from "vitest";
import { compileExpression } from "../../../src/data/expression.ts";
import { RowSet } from "../../../src/data/row-set.ts";
import { type SelectionStore, selectRows } from "../../../src/data/selection.ts";
import type { Table } from "../../../src/data/table.ts";
import type { Chart } from "../../../src/dom/chart.ts";
import type { RowSelectionChange } from "../../../src/model/row-selection.ts";
import type { BrushSpec, SelectionGesture } from "../../../src/spec/spec.ts";
import {
  cellsOf,
  defaultsOf,
  fixtureOf,
  markOf,
  neighbor,
  paintsAt,
  paintsOf,
} from "../../contracts/matrix.ts";
import { contractTest } from "../../helpers/contracts.ts";
import { canvasPixels, expectChartRefused, mount, mountLoaded, sceneOf } from "./mount.ts";
import {
  around,
  drag,
  type Item,
  itemAt,
  itemCenter,
  type Pair,
  pixel,
  pixels,
  press,
} from "./pointer.ts";

type Gesture = "brush-x" | "brush-y" | "brush-xy" | "lasso" | "click";

/** How a row's rows are selected (rows.json's `selection`, over its table's defaults). */
interface Selecting {
  data?: string;
  /** The binding's events, where it takes only some (a contour's bands take no clicks). */
  events?: SelectionGesture[];
  effect?: "highlight" | "none";
  x?: Pair;
  y?: Pair;
  click?: Pair | Item;
  lasso?: Pair[] | Item;
  receive?: number[];
  rows: Partial<Record<Gesture, number[]>>;
  highlight?: { on: Pair | Item; off: Pair | Item };
}

function selectingOf(row: string): Selecting & { data: string } {
  const { table } = fixtureOf(row);
  const own = (fixtureOf(row).selection ?? { rows: {} }) as Selecting;
  return { data: table, ...defaultsOf(own.data ?? table), ...own } as Selecting & { data: string };
}

/** The spec of a row's mark bound to the store of its table, channel "focus". */
function bound(row: string, options: object = {}, binding: object = {}) {
  const { data, events, effect } = selectingOf(row);
  return {
    marks: [markOf(row, { id: "m" })],
    rowSelection: {
      data,
      channel: "focus",
      ...(events && { events }),
      ...(effect && { effect }),
      ...binding,
    },
    ...options,
  };
}

/** The rows a channel holds now: a row set's, or those its condition holds for. */
function heldRows(store: SelectionStore, source: Table): number[] | null {
  const held = store.get("focus");
  if (!held) return null;
  if (held.kind === "rows") return Array.from(held.rows.positions());
  const test = compileExpression(held.expression, source);
  return Array.from({ length: source.length }, (_, row) => row).filter((row) => test.at(row));
}

/** The pixel of a value pair, or under an item. */
const pixelOf = (chart: Chart, at: Pair | Item): Pair =>
  Array.isArray(at) ? pixels(chart, at) : itemAt(chart, at).at;

/** The pixels a gesture of a row's fixture goes through. */
function pathOf(chart: Chart, selecting: Selecting, gesture: Gesture): Pair[] {
  const { plot } = chart.getPanels()[0]!;
  const [x, y] = [selecting.x!, selecting.y!];
  const middle: Pair = [plot.x + plot.width / 2, plot.y + plot.height / 2];
  if (gesture === "brush-x") return x.map((v) => [pixel(chart, v, "x"), middle[1]]);
  if (gesture === "brush-y") return y.map((v) => [middle[0], pixel(chart, v, "y")]);
  if (gesture === "brush-xy") return [0, 1].map((i) => pixels(chart, [x[i]!, y[i]!]));
  if (gesture === "click") return [pixelOf(chart, selecting.click!)];
  const { lasso } = selecting;
  if (lasso && !Array.isArray(lasso)) return around(itemAt(chart, lasso).anchor);
  const outline: Pair[] = lasso ?? [
    [x[0], y[0]],
    [x[1], y[0]],
    [x[1], y[1]],
    [x[0], y[1]],
  ];
  return [...outline, outline[0]!].map((at) => pixels(chart, at));
}

/**
 * A closed path with a notch cut into its first side, a third of the way
 * to the opposite side: a lasso that no rectangle or fixed shape is.
 */
function notched(path: Pair[]): Pair[] {
  const [a, b, c] = path as [Pair, Pair, Pair];
  const notch: Pair = [
    (a[0] + b[0]) / 2 + (c[0] - b[0]) / 3,
    (a[1] + b[1]) / 2 + (c[1] - b[1]) / 3,
  ];
  return [a, notch, ...path.slice(1)];
}

/** The least-squares line through points `(u, p)`, and how far the farthest is from it. */
function fit(us: number[], ps: number[]): { slope: number; off: number } {
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const [mu, mp] = [mean(us), mean(ps)];
  const slope =
    us.reduce((sum, u, i) => sum + (u - mu) * (ps[i]! - mp), 0) /
    us.reduce((sum, u) => sum + (u - mu) ** 2, 0);
  return { slope, off: Math.max(...us.map((u, i) => Math.abs(mp + slope * (u - mu) - ps[i]!))) };
}

/**
 * Where a lasso's outline lies, in pixels: through the axes' scales, or on
 * a map's or network's plane, whose units no axis shows, as the chart draws
 * it over the plot, which must be the outline reported through one linear
 * map along each axis, alike in scale along both (a plane's units are the
 * same along x and y).
 */
function outlinePixels(chart: Chart, lasso: Pair[]): Pair[] {
  if (chart.getPanels()[0]!.x) return lasso.map((at) => pixels(chart, at));
  const paths = [...chart.root.querySelectorAll("path[clip-path]")]
    .filter((path) => path.getAttribute("visibility") === "visible")
    .map((path) => path.getAttribute("d") ?? "");
  expect(paths, "the lasso drawn over the plane").toHaveLength(1);
  const drawn = [...paths[0]!.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map(
    ([, x, y]): Pair => [+x!, +y!],
  );
  expect(drawn, "a point drawn for each reported").toHaveLength(lasso.length);
  const [x, y] = [0, 1].map((axis) =>
    fit(
      lasso.map((at) => at[axis]!),
      drawn.map((at) => at[axis]!),
    ),
  );
  // The drawn path writes tenths of a pixel.
  expect(Math.max(x!.off, y!.off), "the outline drawn is the one reported").toBeLessThan(0.1);
  expect(x!.slope).toBeGreaterThan(0);
  expect(Math.abs(y!.slope) / x!.slope).toBeCloseTo(1, 2);
  return drawn;
}

/** How far a pixel is from a segment, and where along it the nearest point is (0 to 1). */
function nearest([px, py]: Pair, [ax, ay]: Pair, [bx, by]: Pair): { apart: number; t: number } {
  const [dx, dy] = [bx - ax, by - ay];
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return { apart: Math.hypot(px - (ax + t * dx), py - (ay + t * dy)), t };
}

/**
 * How far along a path a pixel lies (the length of path before it), at
 * `from` or later and within a pixel of the path; undefined where it does
 * not.
 */
function along(path: Pair[], at: Pair, from: number): number | undefined {
  let before = 0;
  for (let i = 1; i < path.length; i++) {
    const [a, b] = [path[i - 1]!, path[i]!];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const { apart, t } = nearest(at, a, b);
    if (apart <= 1 && before + t * length >= from - 1) return before + t * length;
    before += length;
  }
  return undefined;
}

/**
 * Expects a lasso's outline to be the path dragged (inside the plot, where
 * the brush keeps it), to the pixel: its points on the path in its order,
 * as the brush may keep fewer or more of them, and each of the path's
 * corners one of its points.
 */
function expectOutline(chart: Chart, lasso: Pair[] | null, path: Pair[]): void {
  expect(lasso, "the outline drawn").not.toBeNull();
  const { plot } = chart.getPanels()[0]!;
  const inside = path.map(
    ([x, y]): Pair => [
      Math.min(plot.x + plot.width, Math.max(plot.x, x)),
      Math.min(plot.y + plot.height, Math.max(plot.y, y)),
    ],
  );
  const outline = outlinePixels(chart, lasso!);
  let from = 0;
  for (const at of outline) {
    const there = along(inside, at, from);
    expect(there, `${at} on the path, after the points before it`).toBeDefined();
    from = there!;
  }
  for (const corner of inside)
    expect(
      Math.min(...outline.map((at) => Math.hypot(at[0] - corner[0], at[1] - corner[1]))),
      `${corner} in the outline`,
    ).toBeLessThanOrEqual(1);
}

/**
 * Expects a range a brush reports to be the one dragged, to the pixel: on
 * category axes, the whole bands it reached.
 */
function expectRange(
  chart: Chart,
  range: readonly [number, number] | null,
  dragged: Pair,
  axis: "x" | "y",
): void {
  expect(range, `a range along ${axis}`).not.toBeNull();
  const scale = chart.getPanels()[0]![axis]!;
  const [lo, hi] = dragged;
  const last = (scale.categories?.length ?? 1) - 1;
  const band = (v: number) => Math.min(last, Math.max(0, Math.round(v)));
  const expected = scale.type === "band" ? [band(lo), band(hi)] : [lo, hi];
  for (const i of [0, 1])
    expect(
      Math.abs(pixel(chart, range![i]!, axis) - pixel(chart, expected[i]!, axis)),
    ).toBeLessThanOrEqual(1);
}

/**
 * A row of no table: beside a line of the samples, bound to their store,
 * `act` selects the rows it selects with the line alone, which are some.
 */
async function expectLineAlone(
  row: string,
  options: object,
  act: (chart: Chart) => void,
): Promise<void> {
  const selected: (number[] | null)[] = [];
  for (const marks of [[neighbor()], [neighbor(), markOf(row)]]) {
    const spec = { marks, rowSelection: { data: "samples", channel: "focus" }, ...options };
    const { chart, stores, tables } = await mountLoaded(spec);
    act(chart);
    selected.push(heldRows(stores.get("samples")!, tables.get("samples")!));
  }
  expect(selected[0], "the line's rows").not.toEqual([]);
  expect(selected[0], "the line's rows").not.toBeNull();
  expect(selected[1]).toEqual(selected[0]);
}

const SHAPES = { "brush-x": "x", "brush-y": "y", "brush-xy": "xy", lasso: "lasso" } as const;

type Brushed = { x: Pair | null; y: Pair | null; lasso: Pair[] | null; rows?: unknown };

/** Drags a path, and the one select event it reports. */
function brush(chart: Chart, path: Pair[]): Brushed {
  const events: Brushed[] = [];
  const off = chart.on("select", (event) => events.push(event as Brushed));
  drag(chart, path);
  off();
  expect(events).toHaveLength(1);
  return events[0]!;
}

for (const [gesture, shape] of Object.entries(SHAPES) as [keyof typeof SHAPES, BrushSpec][]) {
  const capability = `selection.${gesture}`;
  describe(capability, () => {
    for (const cell of cellsOf(capability))
      contractTest(`${cell.row}.${capability}`, async () => {
        const spec = { marks: [markOf(cell.row)], interaction: { brush: shape } };
        if (cell.state === "refused") return expectChartRefused(spec as never, cell);
        if (cell.state !== "works") throw new Error(`${capability} is never ${cell.state}`);
        const selecting = selectingOf(cell.row);
        const chart = await mount(spec);
        const path = pathOf(chart, selecting, gesture);
        const dragged = gesture === "lasso" ? notched(path) : path;
        const event = brush(chart, dragged);
        // What it covers: the ranges dragged, or the outline drawn; nothing else.
        if (gesture === "lasso") {
          expectOutline(chart, event.lasso, dragged);
        } else {
          expect(event.lasso).toBeNull();
          if (gesture === "brush-y") expect(event.x).toBeNull();
          else expectRange(chart, event.x, selecting.x!, "x");
          if (gesture === "brush-x") expect(event.y).toBeNull();
          else expectRange(chart, event.y, selecting.y!, "y");
        }
        expect(event.rows, "no store, no rows").toBeUndefined();
        expect(chart.selection).toEqual({ x: event.x, y: event.y, lasso: event.lasso });
      });
  });

  const rows = `selection.rows-${shape}`;
  describe(rows, () => {
    for (const cell of cellsOf(rows))
      contractTest(`${cell.row}.${rows}`, async () => {
        const options = { interaction: { brush: shape } };
        // Asked to select rows by this gesture, which the row's binding may leave out.
        const events = [shape === "lasso" ? ("lasso" as const) : ("brush" as const)];
        if (cell.state === "refused")
          return expectChartRefused(bound(cell.row, options, { events }), cell);
        if (cell.state === "na")
          return expectLineAlone(cell.row, options, (chart) =>
            drag(chart, pathOf(chart, selectingOf("line"), gesture)),
          );
        const selecting = selectingOf(cell.row);
        const { chart, stores, tables } = await mountLoaded(bound(cell.row, options));
        const event = brush(chart, pathOf(chart, selecting, gesture));
        // What it selects: the rows it covers, in the bound channel, as the event says.
        const [store, source] = [stores.get(selecting.data)!, tables.get(selecting.data)!];
        expect(heldRows(store, source)).toEqual(selecting.rows[gesture]);
        expect(event.rows).toEqual([
          { table: source, channel: "focus", selection: store.get("focus") },
        ]);
      });
  });
}

describe("selection.click", () => {
  for (const cell of cellsOf("selection.click"))
    contractTest(`${cell.row}.selection.click`, async () => {
      const click = (chart: Chart, [at]: Pair[]) => {
        press(chart, "pointerdown", at!);
        press(chart, "pointerup", at!);
      };
      // Asked to select rows by clicks, which the row's binding may leave out.
      if (cell.state === "refused")
        return expectChartRefused(bound(cell.row, {}, { events: ["click"] }), cell);
      if (cell.state === "na")
        return expectLineAlone(cell.row, {}, (chart) =>
          click(chart, pathOf(chart, selectingOf("line"), "click")),
        );
      const selecting = selectingOf(cell.row);
      const { chart, stores, tables } = await mountLoaded(bound(cell.row));
      const changes: RowSelectionChange[] = [];
      chart.on("rowSelection", (change) => changes.push(change));
      click(chart, pathOf(chart, selecting, "click"));
      const [store, source] = [stores.get(selecting.data)!, tables.get(selecting.data)!];
      expect(heldRows(store, source)).toEqual(selecting.rows.click);
      expect(changes).toEqual([
        {
          table: source,
          channel: "focus",
          selection: store.get("focus"),
          cause: "pointer",
          revision: chart.revision,
        },
      ]);
    });
});

/** Selects `rows` of the store's table, as another view (a grid) would. */
function selectFromElsewhere(store: SelectionStore, rows: readonly number[]): void {
  const set = new RowSet(store.source);
  for (const row of rows) set.add(row);
  store.set("focus", selectRows(set));
}

function descriptionOf(chart: Chart): string {
  const id = chart.root.getAttribute("aria-describedby")!.split(" ")[0]!;
  return document.getElementById(id)?.textContent ?? "";
}

/** Geometry of a chart's scene painting any of `colors`: its kind, size, and paints at their opacity. */
function paintedIn(chart: Chart, colors: ReadonlySet<string>) {
  return sceneOf(chart)
    .panels.flatMap((p) => p.marks)
    .flatMap((g) => {
      const paints = paintsAt(g).filter(([paint]) => colors.has(paint));
      return paints.length > 0 ? [{ kind: g.kind, size: g.draw.size(g), paints }] : [];
    });
}

/**
 * How much color the chart's canvas draws around a pixel (9 by 9 CSS
 * pixels): the most ink, how far from white, of any of its pixels there
 * that is not grey (grid lines and text are grey; so are dimmed tints).
 */
function inkAt(chart: Chart, [x, y]: Pair): number {
  const data = canvasPixels(chart);
  if (!data) return 0;
  const canvas = chart.root.querySelector("canvas")!;
  const scale = canvas.width / canvas.getBoundingClientRect().width;
  let most = 0;
  for (let dy = -4; dy <= 4; dy++)
    for (let dx = -4; dx <= 4; dx++) {
      const [px, py] = [Math.round((x + dx) * scale), Math.round((y + dy) * scale)];
      if (px < 0 || py < 0 || px >= canvas.width || py >= canvas.height) continue;
      const i = (py * canvas.width + px) * 4;
      const [r, g, b] = [data[i]!, data[i + 1]!, data[i + 2]!];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 28) most = Math.max(most, 765 - r - g - b);
    }
  return most;
}

/**
 * A row of no table: beside a line of the samples, a selection of theirs
 * reaches the chart and dims the line, and leaves the mark drawn as before.
 */
async function expectDrawnAsBefore(row: string): Promise<void> {
  const alone = await mount({ marks: [markOf(row)] });
  const own = paintsOf(sceneOf(alone).panels.flatMap((p) => p.marks));
  expect(own.size, "the mark's paints").toBeGreaterThan(0);
  const spec = {
    marks: [neighbor(), markOf(row)],
    rowSelection: { data: "samples", channel: "focus", events: [] },
  };
  const { chart, stores } = await mountLoaded(spec, { renderer: "canvas" });
  const changes: RowSelectionChange[] = [];
  chart.on("rowSelection", (change) => changes.push(change));
  const before = paintedIn(chart, own);
  const line = inkAt(chart, pixels(chart, [4, 40]));
  selectFromElsewhere(stores.get("samples")!, []);
  chart.render();
  expect(changes, "the chart received it").toHaveLength(1);
  expect(inkAt(chart, pixels(chart, [4, 40])), "the line dimmed").toBeLessThan(line * 0.6);
  expect(paintedIn(chart, own), "the mark as drawn").toEqual(before);
}

describe("selection.receive", () => {
  for (const cell of cellsOf("selection.receive"))
    contractTest(`${cell.row}.selection.receive`, async () => {
      // A chart that only receives: it writes nothing of its own.
      const receiving = bound(cell.row, {}, { events: [] });
      if (cell.state === "refused") return expectChartRefused(receiving, cell);
      if (cell.state === "na") return expectDrawnAsBefore(cell.row);
      const selecting = selectingOf(cell.row);
      const { chart, stores, tables } = await mountLoaded(receiving);
      const changes: RowSelectionChange[] = [];
      chart.on("rowSelection", (change) => changes.push(change));
      const [store, source] = [stores.get(selecting.data)!, tables.get(selecting.data)!];
      const received = selecting.receive!;
      selectFromElsewhere(store, received);
      expect(changes).toEqual([
        {
          table: source,
          channel: "focus",
          selection: store.get("focus"),
          cause: "sync",
          revision: chart.revision,
        },
      ]);
      // The chart counts the rows it highlights in its text alternative.
      if (selecting.effect !== "none")
        await expect
          .poll(() => descriptionOf(chart), { timeout: 3000 })
          .toContain(`${received.length} of ${source.length} rows selected.`);
    });
});

describe("selection.highlight", () => {
  for (const cell of cellsOf("selection.highlight"))
    contractTest(`${cell.row}.selection.highlight`, async () => {
      // Asked to highlight, which the row's binding may leave out.
      if (cell.state === "refused")
        return expectChartRefused(bound(cell.row, {}, { effect: "highlight" }), cell);
      if (cell.state === "na") return expectDrawnAsBefore(cell.row);
      const selecting = selectingOf(cell.row);
      const { chart, stores } = await mountLoaded(bound(cell.row, {}, { events: [] }), {
        renderer: "canvas",
      });
      const store = stores.get(selecting.data)!;
      // Where a row the selection holds is drawn, and one it does not.
      const [on, off] = [selecting.highlight!.on, selecting.highlight!.off].map((at) =>
        Array.isArray(at) ? pixels(chart, at) : itemCenter(chart, at),
      );
      const ink = () => {
        chart.render();
        return [inkAt(chart, on!), inkAt(chart, off!)];
      };
      const before = ink();
      expect(before[0], "the mark is drawn where a selected row is").toBeGreaterThan(0);
      expect(before[1], "the mark is drawn where another row is").toBeGreaterThan(0);
      // Its rows: drawn as they are; the others dimmed.
      selectFromElsewhere(store, selecting.receive!);
      const some = ink();
      expect(some[0], "a selected row as it is").toBeGreaterThanOrEqual(before[0]! * 0.8);
      expect(some[1], "another row dimmed").toBeLessThan(before[1]! * 0.6);
      // No rows: every row dimmed.
      selectFromElsewhere(store, []);
      expect(ink()[0], "the selected row dimmed too").toBeLessThan(before[0]! * 0.6);
      // Cleared: as before.
      store.set("focus", null);
      expect(ink()).toEqual(before);
    });
});
