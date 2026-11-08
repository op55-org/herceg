// What a grid's `select` reports: each change of its channel, by any writer,
// with what caused it, once per command, in the order of the changes; apart
// from `rowClick`, which reports activation. Selections reported never
// change.
import "./interactive.ts";
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { count } from "../../src/data/aggregations.ts";
import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import {
  type DataSelection,
  type SelectionStore,
  selectionStore,
  selectRows,
  selectWhere,
} from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { type Chart, createChart } from "../../src/dom/chart.ts";
import { createGrid, type Grid, type GridSelectEvent } from "../../src/dom/grid.ts";
import { createPivotGrid } from "../../src/dom/grid-pivot.ts";
import { createRemoteGrid } from "../../src/dom/grid-remote.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridModel } from "../../src/grid/model.ts";
import { createPivotGridModel } from "../../src/grid/pivot.ts";
import { createRemoteGridModel } from "../../src/grid/remote.ts";
import {
  type RemoteSelection,
  remoteSelectionStore,
  selectKeys,
} from "../../src/grid/remote-selection.ts";
import { line } from "../../src/marks/line.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { MOUSE } from "./helpers.ts";

const hosts: HTMLElement[] = [];
const made: { destroy(): void }[] = [];
afterEach(() => {
  for (const grid of made.splice(0)) grid.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

const services = () =>
  table({
    id: [0, 1, 2, 3, 4, 5],
    ms: [50, 10, 40, 30, 60, 20],
    host: ["web", "api", "web", "db", "api", "db"],
  });

type Services = ReturnType<typeof services> extends Table<infer S> ? S : never;

function host() {
  const element = document.createElement("div");
  element.style.cssText = "width:400px;height:300px";
  document.body.append(element);
  hosts.push(element);
  return element;
}

function mount(
  options: { source?: Table<Services>; store?: SelectionStore<Services>; toggle?: boolean } = {},
) {
  const t = options.source ?? services();
  const data = rowView(t);
  const model = createGridModel({
    data,
    columns: [{ field: "id" }, { field: "ms" }, { field: "host" }],
    ...(options.store && { selectionStore: options.store }),
    ...(options.toggle && { selection: { click: "toggle" as const } }),
  });
  const grid = createGrid(host(), { model, ariaLabel: "Services" });
  made.push(grid);
  return { t, data, model, grid, store: model.selectionStore };
}

type LocalGrid = Grid<Services, GridModel<Services>>;

/** The `select` events a grid reports from now on. */
function selects(grid: LocalGrid): GridSelectEvent<GridModel<Services>>[] {
  const events: GridSelectEvent<GridModel<Services>>[] = [];
  grid.on("select", (event) => events.push(event));
  return events;
}

/** The positions a selection holds, or null. */
function rowsOf(selection: DataSelection<Services> | null): number[] | null {
  return selection?.kind === "rows" ? Array.from(selection.rows.positions()) : null;
}

/** Each event as its cause and the rows it holds. */
const summary = (events: readonly GridSelectEvent<GridModel<Services>>[]) =>
  events.map(({ cause, selection }) => [cause, rowsOf(selection)]);

const COMMAND = navigator.platform.startsWith("Mac") ? "Meta" : "Control";

const cellAt = (grid: LocalGrid, rowIndex: number, column: number) =>
  grid.root.querySelector<HTMLElement>(
    `.hg-body [aria-rowindex="${rowIndex + 2}"] [aria-colindex="${column + 1}"]`,
  )!;

describe("a grid's select event", () => {
  it("reports clicks, Ctrl and Shift clicks, and a second click that clears, by the pointer", async () => {
    const { grid } = mount({ toggle: true });
    const events = selects(grid);
    await userEvent.click(cellAt(grid, 1, 0));
    await userEvent.click(cellAt(grid, 3, 0), { modifiers: [COMMAND] });
    await userEvent.click(cellAt(grid, 5, 0), { modifiers: ["Shift"] });
    await userEvent.click(cellAt(grid, 4, 0));
    // The one row selected, clicked again, clears.
    await userEvent.click(cellAt(grid, 4, 0));
    expect(summary(events)).toEqual([
      ["pointer", [1]],
      ["pointer", [1, 3]],
      ["pointer", [3, 4, 5]],
      ["pointer", [4]],
      ["pointer", null],
    ]);
    // Each with the model's revision once it applied, which the grid then draws.
    const revisions = events.map((event) => event.revision);
    expect(revisions).toEqual([...revisions].sort((a, b) => a - b));
    expect(grid.drawnRevision).toBeGreaterThanOrEqual(revisions.at(-1)!);
  });

  it("reports Space, Shift with arrows, Ctrl A, and Escape, by the keyboard", async () => {
    const { grid } = mount();
    const events = selects(grid);
    grid.focusCell(1, "id");
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Shift>}{ArrowDown}{ArrowDown}{/Shift}");
    await userEvent.keyboard(`{${COMMAND}>}a{/${COMMAND}}`);
    await userEvent.keyboard("{Escape}");
    // Moves without Shift select nothing.
    await userEvent.keyboard("{ArrowDown}");
    expect(summary(events)).toEqual([
      ["keyboard", [1]],
      ["keyboard", [1, 2]],
      ["keyboard", [1, 2, 3]],
      ["keyboard", [0, 1, 2, 3, 4, 5]],
      ["keyboard", null],
    ]);
  });

  it("reports a group's checkbox by the pointer, and the rows it selects", async () => {
    const t = services();
    const data = rowView(t);
    const model = createGridModel({
      data,
      groups: groupRows(data, { by: ["host"], ops: { n: count() } }),
      columns: [{ field: "id" }, { field: "ms" }],
    });
    const grid = createGrid(host(), { model, ariaLabel: "Services" });
    made.push(grid);
    const events = selects(grid);
    // The first group, web: rows 0 and 2.
    await userEvent.click(grid.root.querySelector<HTMLElement>(".hg-body .hg-check")!);
    expect(summary(events)).toEqual([["pointer", [0, 2]]]);
  });

  it("reports a pivot's row selecting its records", async () => {
    const t = table({ host: ["web", "api", "web", "db"], kind: ["get", "get", "put", "put"] });
    const model = createPivotGridModel({
      data: pivotRows(rowView(t), { rows: "host", pivot: "kind", ops: { n: count() } }),
    });
    const grid = createPivotGrid(host(), { model, ariaLabel: "Requests by host" });
    made.push(grid);
    const events: GridSelectEvent<typeof model>[] = [];
    grid.on("select", (event) => events.push(event));
    const first = grid.root.querySelector<HTMLElement>(
      '.hg-body [aria-rowindex="2"] [aria-colindex="1"]',
    )!;
    await userEvent.click(first);
    const [event] = events;
    const rows = event?.selection?.kind === "rows" ? [...event.selection.rows.positions()] : [];
    // Every record of the host the row stands for.
    const shown = first.textContent;
    expect(event?.cause).toBe("pointer");
    expect(rows).toEqual([0, 1, 2, 3].filter((i) => t.value("host", i) === shown));
    expect(rows.length).toBeGreaterThan(0);
  });

  it("reports other writers of its channel as sync, and the model's methods as api", async () => {
    const store = selectionStore(services());
    const first = mount({ source: store.source, store });
    const second = mount({ source: store.source, store });
    const [mine, theirs] = [selects(first.grid), selects(second.grid)];
    store.set("grid-rows", selectRows(new RowSet(store.source).add(4)));
    // Another grid's click is that grid's pointer, and this grid's sync.
    await userEvent.click(cellAt(second.grid, 2, 0));
    first.model.select(3, "toggle");
    first.model.click(5);
    first.model.selectAll();
    first.model.clearSelection();
    // Clearing what is clear changes nothing, and reports nothing.
    first.model.clearSelection();
    // Another channel is not the grid's.
    store.set("other", selectWhere(true));
    expect(summary(mine)).toEqual([
      ["sync", [4]],
      ["sync", [2]],
      ["api", [2, 3]],
      ["api", [5]],
      ["api", [0, 1, 2, 3, 4, 5]],
      ["api", null],
    ]);
    expect(summary(theirs).map(([cause]) => cause)).toEqual([
      "sync",
      "pointer",
      "sync",
      "sync",
      "sync",
      "sync",
    ]);
  });

  it("reports input in one of two grids over one model as sync in the other", async () => {
    const { model, grid } = mount();
    const other = createGrid(host(), { model, ariaLabel: "Services again" });
    made.push(other);
    const [mine, theirs] = [selects(grid), selects(other)];
    await userEvent.click(cellAt(grid, 1, 0));
    other.focusCell(3, "id");
    await userEvent.keyboard(" ");
    model.select(0);
    expect(summary(mine).map(([cause]) => cause)).toEqual(["pointer", "sync", "api"]);
    expect(summary(theirs).map(([cause]) => cause)).toEqual(["sync", "keyboard", "api"]);
    // The same changes, at the same revisions.
    expect(theirs.map(({ selection, revision }) => [selection, revision])).toEqual(
      mine.map(({ selection, revision }) => [selection, revision]),
    );
  });
});

describe("select and activation", () => {
  it("report a click's selection before the click, Space's alone, and Enter's click alone", async () => {
    const { grid } = mount();
    const order: string[] = [];
    grid.on("select", ({ cause }) => order.push(`select ${cause}`));
    grid.on("rowClick", ({ cause }) => order.push(`rowClick ${cause}`));
    grid.on("cellClick", ({ cause }) => order.push(`cellClick ${cause}`));
    await userEvent.click(cellAt(grid, 2, 1));
    await userEvent.keyboard(" ");
    await userEvent.keyboard("{Enter}");
    expect(order).toEqual([
      "select pointer",
      "rowClick pointer",
      "cellClick pointer",
      "select keyboard",
      "rowClick keyboard",
      "cellClick keyboard",
    ]);
  });

  it("report the row clicked by identity, though a select listener cleared or filtered it", async () => {
    const { t, data, model, grid } = mount();
    const events = selects(grid);
    const clicks: [number, number][] = [];
    grid.on("rowClick", ({ ref, rowIndex }) => clicks.push([ref.id as number, rowIndex]));
    const stop = grid.on("select", ({ cause }) => {
      if (cause === "pointer") model.clearSelection();
    });
    await userEvent.click(cellAt(grid, 1, 0));
    stop();
    // A listener filtering the view to rows not selected takes the row out.
    grid.on("select", ({ selection, cause }) => {
      if (cause !== "pointer" || selection?.kind !== "rows") return;
      const picked = selection.rows;
      data.setQuery({ filter: col("id").ne(t.value("id", picked.positions()[0]!)!) });
    });
    await userEvent.click(cellAt(grid, 3, 0));
    expect(summary(events)).toEqual([
      ["pointer", [1]],
      ["api", null],
      ["pointer", [3]],
    ]);
    expect(clicks).toEqual([
      [t.identity(1), 1],
      [t.identity(3), -1],
    ]);
  });

  it("report nothing more once a select listener destroyed the grid", async () => {
    const { model, grid } = mount();
    const heard: string[] = [];
    grid.on("select", () => {
      heard.push("select");
      grid.destroy();
    });
    grid.on("select", () => heard.push("late select"));
    grid.on("rowClick", () => heard.push("rowClick"));
    await userEvent.click(cellAt(grid, 1, 0));
    model.select(2);
    expect(heard).toEqual(["select"]);
    expect(model.isSelected(2)).toBe(true);
  });

  it("report a listener's own commands after the change it heard, to every listener in order", async () => {
    const { model, grid } = mount();
    const first: string[] = [];
    const second: string[] = [];
    grid.on("select", ({ cause, selection }) => {
      first.push(`${cause} ${rowsOf(selection)}`);
      // Each row clicked brings the next along, once.
      if (cause === "pointer" && selection?.kind === "rows" && selection.rows.size === 1)
        model.select(selection.rows.positions()[0]! + 1, "toggle");
    });
    grid.on("select", ({ cause, selection }) => second.push(`${cause} ${rowsOf(selection)}`));
    await userEvent.click(cellAt(grid, 1, 0));
    await userEvent.click(cellAt(grid, 3, 0), { modifiers: [COMMAND] });
    expect(first).toEqual(["pointer 1", "api 1,2", "pointer 1,2,3"]);
    expect(second).toEqual(first);
  });
});

describe("a selection reported", () => {
  it("never changes: later toggles publish copies", async () => {
    const { grid, store } = mount();
    const events = selects(grid);
    await userEvent.click(cellAt(grid, 1, 0));
    const kept = events[0]!;
    const rows = kept.selection?.kind === "rows" ? kept.selection.rows : null;
    const version = rows!.version;
    await userEvent.click(cellAt(grid, 3, 0), { modifiers: [COMMAND] });
    await userEvent.click(cellAt(grid, 4, 0), { modifiers: [COMMAND] });
    expect(rowsOf(kept.selection)).toEqual([1]);
    expect(rows!.version).toBe(version);
    expect(store.get("grid-rows")).toBe(events.at(-1)!.selection);
    expect(rowsOf(store.get("grid-rows"))).toEqual([1, 3, 4]);
  });

  it("throws when the application changes a set, a condition, or a selection it published", () => {
    const { grid, store } = mount();
    const events = selects(grid);
    const rows = new RowSet(store.source).add(2);
    const selection = { kind: "rows" as const, rows };
    store.set("grid-rows", selection);
    expect(() => rows.add(3)).toThrow(
      "RowSet: the set is frozen, as selections hold it; change a copy, rows.copy()",
    );
    expect(() => {
      (selection as { rows: unknown }).rows = new RowSet(store.source);
    }).toThrow(TypeError);
    const expression = [">", ["field", "ms"], 35] as [">", ["field", "ms"], number];
    store.set("grid-rows", { kind: "predicate", expression });
    expect(() => {
      expression[2] = 0;
    }).toThrow(TypeError);
    expect(() => (expression[1] as string[]).push("x")).toThrow(TypeError);
    expect(events.map(({ selection }) => selection)).toEqual([
      selection,
      { kind: "predicate", expression: [">", ["field", "ms"], 35] },
    ]);
    // The grid shows the condition's rows: 50, 40, and 60 ms.
    expect([0, 1, 2, 3, 4, 5].filter((i) => grid.model.isSelected(i))).toEqual([0, 2, 4]);
  });

  it("is copied to change it, its own set left as it was", async () => {
    const { grid, store } = mount();
    const events = selects(grid);
    await userEvent.click(cellAt(grid, 1, 0));
    const reported = events[0]!.selection;
    if (reported?.kind !== "rows") throw new Error("expected rows");
    const edited = reported.rows.copy().add(4);
    store.set("grid-rows", selectRows(edited));
    expect(summary(events)).toEqual([
      ["pointer", [1]],
      ["sync", [1, 4]],
    ]);
    expect(Array.from(reported.rows.positions())).toEqual([1]);
  });

  it("follows its table's insertions, drops, and resets, its members unchanged", async () => {
    const t = orderedTable(
      { t: [10, 20, 30, 40, 50], v: [1, 2, 3, 4, 5] },
      { orderBy: "t", maxRows: 6 },
    );
    const model = createGridModel({ data: rowView(t), columns: [{ field: "t" }, { field: "v" }] });
    const grid = createGrid(host(), { model, ariaLabel: "Readings" });
    made.push(grid);
    const events: GridSelectEvent<typeof model>[] = [];
    grid.on("select", (event) => events.push(event));
    grid.focusCell(1, "t");
    await userEvent.keyboard(" {Shift>}{ArrowDown}{/Shift}");
    const kept = events.at(-1)!.selection;
    if (kept?.kind !== "rows") throw new Error("expected rows");
    expect(Array.from(kept.rows.positions())).toEqual([1, 2]);
    // A late row goes before them, and the oldest drops.
    t.append({ t: [15, 60], v: [0, 6] });
    expect(Array.from(kept.rows.positions())).toEqual([1, 2]);
    expect(t.value("t", 1)).toBe(20);
    // A row before every other arrives, and is the one dropped.
    t.append({ t: [5], v: [0] });
    expect(Array.from(kept.rows.positions()).map((p) => t.value("t", p))).toEqual([20, 30]);
    t.dropBefore("t", 25);
    expect(Array.from(kept.rows.positions()).map((p) => t.value("t", p))).toEqual([30]);
    t.reset({ t: [1, 2], v: [1, 2] });
    expect([kept.rows.current, kept.rows.size]).toEqual([false, 0]);
    // Nothing the grid reported changed meanwhile: the channel still holds it.
    expect(model.selectionStore.get("grid-rows")).toBe(kept);
  });
});

describe("a remote grid's select", () => {
  /** A remote grid of the source's keyed rows over `store`, once its first rows are loaded. */
  async function remote(store: ReturnType<typeof remoteSelectionStore>) {
    const model = createRemoteGridModel({
      source,
      selectionStore: store,
      columns: [{ field: "id" }],
    });
    const grid = createRemoteGrid(host(), { model, ariaLabel: "Requests" });
    made.push(grid);
    await until(() => model.row(0).kind === "row");
    grid.render();
    const events: GridSelectEvent<typeof model>[] = [];
    grid.on("select", (event) => events.push(event));
    return { model, grid, events };
  }

  const source = memorySource(
    table({
      id: Float64Array.from({ length: 20 }, (_, i) => i),
      host: category(Array(20).fill("a")),
    }),
    { key: "id" },
  );
  const keys = (selection: RemoteSelection | null) =>
    selection?.kind === "keys" ? [...selection.keys] : (selection?.kind ?? null);

  it("reports a listener's replacement heard first alone, the click it replaced skipped", async () => {
    const store = remoteSelectionStore(source.schema);
    // Subscribed before the grid's model: it hears the click's change first.
    store.subscribe(({ selection }) => {
      if (keys(selection)?.toString() === "1") store.set("grid-rows", selectKeys([1, 9]));
    });
    const { grid, events } = await remote(store);
    await userEvent.click(
      grid.root.querySelector('.hg-body [aria-rowindex="3"] [aria-colindex="1"]')!,
    );
    expect(events.map(({ cause, selection }) => [cause, keys(selection)])).toEqual([
      ["sync", [1, 9]],
    ]);
    expect(events.at(-1)!.selection).toBe(store.get("grid-rows"));
  });

  it("reports the click, then a later listener's replacement, in the order of the changes", async () => {
    const store = remoteSelectionStore(source.schema);
    const { grid, events } = await remote(store);
    // Subscribed after the grid's model: it hears the click's change once the model has.
    store.subscribe(({ selection }) => {
      if (keys(selection)?.toString() === "1") store.set("grid-rows", selectKeys([1, 9]));
    });
    await userEvent.click(
      grid.root.querySelector('.hg-body [aria-rowindex="3"] [aria-colindex="1"]')!,
    );
    expect(events.map(({ cause, selection }) => [cause, keys(selection)])).toEqual([
      ["pointer", [1]],
      ["sync", [1, 9]],
    ]);
    expect(events.at(-1)!.selection).toBe(store.get("grid-rows"));
    // Space, Ctrl A, and the model's methods, as a local grid's.
    await userEvent.keyboard(" ");
    await userEvent.keyboard(`{${COMMAND}>}a{/${COMMAND}}`);
    events.length = 0;
    (grid.model as typeof grid.model).clearSelection();
    expect(events.map(({ cause, selection }) => [cause, keys(selection)])).toEqual([["api", null]]);
  });
});

describe("a chart brush bound to the grid's channel", () => {
  async function bound(live = true) {
    const { t, grid, model, store } = mount();
    const element = host();
    const chart = createChart(element, {
      errorMode: "throw",
      marks: [line(t, { x: "id", y: "ms" })],
      interaction: { brush: "x" },
      rowSelection: rowSelection({ store, channel: "grid-rows", live }),
    });
    made.push(chart);
    await chart.loading;
    return { grid, model, store, chart };
  }

  it("reports its previews and the cancel giving back the grid's selection, as sync", async () => {
    const { grid, model, store, chart } = await bound();
    model.select(5);
    const before = store.get("grid-rows");
    const events = selects(grid);
    await press(chart, 1, 2, 3);
    pressEscape(chart);
    expect(events.length).toBeGreaterThanOrEqual(3);
    expect(events.every(({ cause }) => cause === "sync")).toBe(true);
    expect(events.slice(0, -1).every(({ selection }) => selection?.kind === "predicate")).toBe(
      true,
    );
    expect(events.at(-1)!.selection).toBe(before);
  });

  it("reports its commit and its clear as sync", async () => {
    const { grid, store, chart } = await bound(false);
    const events = selects(grid);
    await press(chart, 1, 3);
    at(chart, "pointerup", 3);
    expect(events.map(({ cause, selection }) => [cause, selection?.kind ?? null])).toEqual([
      ["sync", "predicate"],
    ]);
    expect([0, 1, 2, 3, 4, 5].filter((i) => grid.model.isSelected(i))).toEqual([1, 2, 3]);
    chart.select(null);
    expect(events.map(({ cause, selection }) => [cause, selection?.kind ?? null])).toEqual([
      ["sync", "predicate"],
      ["sync", null],
    ]);
    expect(store.get("grid-rows")).toBeNull();
  });

  it("lets its brush go when the grid's click replaces what it wrote", async () => {
    const { grid, chart } = await bound(false);
    const events = selects(grid);
    await press(chart, 1, 3);
    at(chart, "pointerup", 3);
    await userEvent.click(cellAt(grid, 5, 0));
    await Promise.resolve();
    expect(events.map(({ cause, selection }) => [cause, selection?.kind ?? null])).toEqual([
      ["sync", "predicate"],
      ["pointer", "rows"],
    ]);
    expect(rowsOf(events.at(-1)!.selection)).toEqual([5]);
    expect(chart.selection).toBeNull();
  });
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function until(ready: () => boolean, ms = 3000): Promise<void> {
  const start = performance.now();
  while (!ready()) {
    if (performance.now() - start > ms) throw new Error("timed out");
    await frame();
  }
}

/** Sends pointer event `type` at value `x` on the chart's x axis, halfway up its plot. */
function at(chart: Chart, type: string, x: number) {
  const rect = chart.root.getBoundingClientRect();
  const { plot } = chart.getPanels()[0]!;
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: rect.left + chart.toPixel(x, { axis: "x" })!,
      clientY: rect.top + plot.y + plot.height / 2,
      pointerId: MOUSE,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
    }),
  );
}

/** Presses at `from` and moves to each of `to`, a frame after each move; leaves the button down. */
async function press(chart: Chart, from: number, ...to: number[]) {
  at(chart, "pointerdown", from);
  for (const x of to) {
    at(chart, "pointermove", x);
    await frame();
  }
}

const pressEscape = (chart: Chart) =>
  chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
