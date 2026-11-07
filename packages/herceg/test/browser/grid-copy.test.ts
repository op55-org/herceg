// Copy in grids: Ctrl+C (Cmd+C) writes the selected rows, or the focused
// cell, in the `copy` event, as TSV with formulas escaped, within limits;
// refuses what a remote grid has not loaded and a pivot's rows; leaves
// selected text and cells' controls to the browser; and says what it did.
// The clipboard's own text is read in Chrome, where pages may read it.

import { afterEach, describe, expect, it } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { mean } from "../../src/data/aggregations.ts";
import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectRows } from "../../src/data/selection.ts";
import { type Schema, table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import { createGrid, type Grid, type GridOptions } from "../../src/dom/grid.ts";
import type { GridCellRenderer } from "../../src/dom/grid-cells.ts";
import { createPivotGrid } from "../../src/dom/grid-pivot.ts";
import { createRemoteGrid } from "../../src/dom/grid-remote.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridModel } from "../../src/grid/model.ts";
import { createPivotGridModel } from "../../src/grid/pivot.ts";
import { createRemoteGridModel, type RemoteGridModel } from "../../src/grid/remote.ts";
import { selectKeys, selectMatching } from "../../src/grid/remote-selection.ts";
import "./helpers.ts";

const COMMAND = navigator.platform.startsWith("Mac") ? "Meta" : "Control";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  getSelection()?.removeAllRanges();
});

function host(): HTMLDivElement {
  const element = document.createElement("div");
  element.style.cssText = "width:600px;height:300px";
  document.body.append(element);
  cleanups.push(() => element.remove());
  return element;
}

function services() {
  const data = table({
    service: category(["auth", "=1+2", "two\nlines", "billing"]),
    latency: [120, -5, 85.5, 7],
  });
  return { data, view: rowView(data) };
}

function mount<S extends Schema>(
  model: GridModel<S>,
  options: Partial<GridOptions<S>> = {},
): Grid<S> {
  const grid = createGrid(host(), { model, ariaLabel: "Services", ...options });
  cleanups.push(() => grid.destroy());
  return grid;
}

/** Presses Ctrl+C (Cmd+C), and what the copy event carried, whether a grid took it, and what the grid said. */
async function copy(grid: { root: HTMLElement }): Promise<{
  text: string | null;
  taken: boolean;
  said: string;
}> {
  let heard: { text: string; taken: boolean } | null = null;
  // Heard after the grid's own listener: the data it set is readable in the event.
  const listen = (event: ClipboardEvent) => {
    heard = {
      text: event.clipboardData!.getData("text/plain"),
      taken: event.defaultPrevented,
    };
  };
  document.addEventListener("copy", listen);
  try {
    await userEvent.keyboard(`{${COMMAND}>}c{/${COMMAND}}`);
  } finally {
    document.removeEventListener("copy", listen);
  }
  const live = grid.root.querySelector(":scope > [aria-live]")!;
  const { text = null, taken = false } = heard ?? {};
  return { text: taken && text === "" ? null : text, taken, said: live.textContent!.trim() };
}

describe("copy in a grid", () => {
  it("writes the selected rows as TSV, in the view's order, formulas escaped and line breaks quoted", async () => {
    const { data, view } = services();
    const model = createGridModel({
      data: view,
      columns: [{ field: "service" }, { field: "latency" }],
      locale: "en-US",
    });
    const grid = mount(model);
    model.selectionStore.set("grid-rows", selectRows(new RowSet(data).add(2).add(1)));
    grid.focusCell(0, "latency");
    expect(await copy(grid)).toEqual({
      text: '\'=1+2\t-5\r\n"two\nlines"\t85.5',
      taken: true,
      said: "Copied 2 rows",
    });
    // In the view's order.
    view.setQuery({ sort: [{ field: "latency", order: "descending" }] });
    grid.render();
    grid.focusCell(0, "service");
    expect((await copy(grid)).text).toBe('"two\nlines"\t85.5\r\n\'=1+2\t-5');
    // Selected rows the view leaves out are not copied.
    view.setQuery({ filter: col("latency").gt(100) });
    grid.render();
    grid.focusCell(0, "service");
    expect(await copy(grid)).toEqual({
      text: null,
      taken: true,
      said: "No selected rows in this view",
    });
  });

  it("writes the focused cell, a header's title, or a total, with nothing selected", async () => {
    const { view } = services();
    const model = createGridModel({
      data: view,
      totals: rowTotals(view, { ops: { latency: mean("latency") } }),
      columns: [
        { field: "service", title: "Service" },
        { field: "latency", aggregate: "latency" },
      ],
      locale: "en-US",
    });
    const grid = mount(model);
    grid.focusCell(1, "service");
    expect(await copy(grid)).toEqual({ text: "'=1+2", taken: true, said: "Copied cell" });
    grid.focusCell(2, "service");
    expect((await copy(grid)).text).toBe('"two\nlines"');
    grid.focusCell(-1, "service");
    expect(await copy(grid)).toEqual({
      text: "Service",
      taken: true,
      said: "Copied column heading",
    });
    grid.focusCell(model.rowCount, "latency");
    expect(await copy(grid)).toEqual({ text: "51.88", taken: true, said: "Copied cell" });
    grid.focusCell(model.rowCount, "service");
    expect((await copy(grid)).text).toBe("Total");
  });

  it("copies nothing past its limits, and says so", async () => {
    const { data, view } = services();
    const model = createGridModel({
      data: view,
      columns: [{ field: "service" }, { field: "latency" }],
    });
    const grid = mount(model, { copy: { maxCells: 3 } });
    model.selectionStore.set("grid-rows", selectRows(new RowSet(data).add(0).add(1)));
    grid.focusCell(0, "service");
    expect(await copy(grid)).toEqual({
      text: null,
      taken: true,
      said: "Too many cells to copy; export the grid instead",
    });
    grid.update({ copy: { maxBytes: 8 } });
    expect((await copy(grid)).said).toBe("Too many cells to copy; export the grid instead");
    grid.update({ copy: { maxBytes: 20, escapeFormulas: false } });
    expect((await copy(grid)).text).toBe("auth\t120\r\n=1+2\t-5");
    // Back to the defaults.
    grid.update({ copy: undefined });
    expect((await copy(grid)).text).toBe("auth\t120\r\n'=1+2\t-5");
    expect(() => grid.update({ copy: { maxCells: 0 } })).toThrow(
      "grid.update copy.maxCells: expected a positive whole number; received 0",
    );
  });

  it("leaves the key to the page with copy false, selected text to the browser, and controls to themselves", async () => {
    const { view } = services();
    const model = createGridModel({
      data: view,
      columns: [{ field: "service" }, { field: "latency" }],
    });
    const grid = mount(model, { copy: false });
    grid.focusCell(0, "service");
    expect((await copy(grid)).taken).toBe(false);
    expect(grid.root.querySelector("[id$=-keys]")!.textContent).not.toContain("copies");
    grid.update({ copy: undefined });
    grid.render();
    expect(grid.root.querySelector("[id$=-keys]")!.textContent).toContain(
      "Control C copies the selected rows, or the focused cell.",
    );
    // Text selected in a cell copies as the browser copies it.
    const cell = grid.root.querySelector<HTMLElement>(
      '.hg-body [aria-rowindex="2"] [aria-colindex="1"]',
    )!;
    getSelection()!.selectAllChildren(cell);
    expect((await copy(grid)).taken).toBe(false);
    getSelection()!.removeAllRanges();
    // A control cell's control is its own.
    const renderer: GridCellRenderer = {
      interaction: "control",
      create(host) {
        const input = host.ownerDocument.createElement("input");
        host.append(input);
        return { update: (cell) => (input.value = cell.text) };
      },
    };
    grid.update({ cells: { service: renderer } });
    grid.focusCell(0, "service");
    expect(document.activeElement?.tagName).toBe("INPUT");
    expect((await copy(grid)).taken).toBe(false);
    // Its neighbor copies.
    grid.focusCell(0, "latency");
    expect((await copy(grid)).text).toBe("120");
  });

  it("copies from the grid holding the focus, the nearest of grids in grids", async () => {
    const { view } = services();
    const inner = createGridModel({ data: view, columns: [{ field: "latency" }] });
    const outer = createGridModel({
      data: rowView(table({ name: category(["outer"]) })),
      columns: [{ field: "name" }],
    });
    let nested: Grid | null = null;
    const renderer: GridCellRenderer = {
      interaction: "composite",
      create(cell) {
        const box = cell.ownerDocument.createElement("div");
        box.style.cssText = "width:200px;height:120px";
        cell.append(box);
        nested = createGrid(box, { model: inner, ariaLabel: "Inner" }) as unknown as Grid;
        return { update() {}, destroy: () => nested?.destroy() };
      },
    };
    const grid = mount(outer as never, { cells: { name: renderer } as never });
    const other = mount(
      createGridModel({ data: rowView(table({ x: [1] })), columns: [{ field: "x" }] }),
    );
    other.focusCell(0, "x");
    expect((await copy(other)).text).toBe("1");
    nested!.focusCell(0, "latency");
    expect((await copy(nested!)).text).toBe("120");
    expect(grid.root.querySelector(":scope > [aria-live]")!.textContent).not.toContain("Copied");
  });

  it("copies from a grid in a closed shadow root, whose focus the page cannot see", async () => {
    const shadow = host().attachShadow({ mode: "closed" });
    const element = document.createElement("div");
    element.style.cssText = "width:600px;height:300px";
    shadow.append(element);
    const { view } = services();
    const model = createGridModel({
      data: view,
      columns: [{ field: "service" }, { field: "latency" }],
    });
    const grid = createGrid(element, { model, ariaLabel: "Services" });
    cleanups.push(() => grid.destroy());
    grid.focusCell(0, "latency");
    expect(await copy(grid)).toEqual({ text: "120", taken: true, said: "Copied cell" });
  });

  it("refuses a pivot's selected rows, and copies its cells", async () => {
    const data = table({
      region: category(["eu", "us"]),
      service: category(["api", "api"]),
      ms: [10, 20],
    });
    const model = createPivotGridModel({
      data: pivotRows(rowView(data), { rows: "region", pivot: "service", ops: { ms: mean("ms") } }),
      locale: "en-US",
    });
    const grid = createPivotGrid(host(), { model, ariaLabel: "Latency" });
    cleanups.push(() => grid.destroy());
    grid.focusCell(1, model.columnLayout[1]!.id);
    expect((await copy(grid)).text).toBe("20");
    model.select(0);
    expect(await copy(grid)).toEqual({
      text: null,
      taken: true,
      said: "A pivot's selected rows stand for its records, which it shows only as aggregates; copy a cell, or export the grid",
    });
  });

  it("writes the clipboard, and leaves it as it was when it refuses", async () => {
    const { data, view } = services();
    const model = createGridModel({
      data: view,
      columns: [{ field: "service" }, { field: "latency" }],
    });
    const grid = mount(model, { copy: { maxCells: 2 } });
    grid.focusCell(0, "latency");
    // Chrome's pages may read the clipboard; other engines' only the event's data.
    if ((await commands.clipboard("before")) === null) return;
    await userEvent.keyboard(`{${COMMAND}>}c{/${COMMAND}}`);
    expect(await commands.clipboard()).toBe("120");
    await commands.clipboard("before");
    model.selectionStore.set("grid-rows", selectRows(new RowSet(data).add(0).add(1)));
    grid.focusCell(0, "latency");
    await userEvent.keyboard(`{${COMMAND}>}c{/${COMMAND}}`);
    expect(await commands.clipboard()).toBe("before");
  });
});

describe("copy in a remote grid", () => {
  async function remote() {
    const memory = memorySource(
      table({
        id: Float64Array.from({ length: 1000 }, (_, i) => i),
        name: category(Array.from({ length: 1000 }, (_, i) => `row ${i}`)),
      }),
      { key: "id" },
    );
    const model = createRemoteGridModel({
      source: memory,
      columns: [{ field: "id" }, { field: "name" }],
      locale: "en-US",
    }) as unknown as RemoteGridModel;
    const grid = createRemoteGrid(host(), { model, ariaLabel: "Rows" });
    cleanups.push(() => {
      grid.destroy();
      model.dispose();
    });
    for (let i = 0; i < 50 && model.row(0).kind !== "row"; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    grid.render();
    return { model, grid };
  }

  it("copies a selection of keys whose rows are loaded, in the order shown", async () => {
    const { model, grid } = await remote();
    model.selectionStore.set("grid-rows", selectKeys([3, 1]));
    grid.focusCell(0, "id");
    expect(await copy(grid)).toEqual({
      text: "1\trow 1\r\n3\trow 3",
      taken: true,
      said: "Copied 2 rows",
    });
  });

  it("refuses rows it has not loaded, and a selection of every row matching a condition", async () => {
    const { model, grid } = await remote();
    const refused = {
      text: null,
      taken: true,
      said: "The selection holds rows that are not loaded; select fewer rows to copy them",
    };
    model.selectionStore.set("grid-rows", selectKeys([1, 900]));
    grid.focusCell(0, "id");
    expect(await copy(grid)).toEqual(refused);
    model.selectionStore.set("grid-rows", selectMatching(["<", ["field", "id"], 2]));
    expect(await copy(grid)).toEqual(refused);
  });
});
