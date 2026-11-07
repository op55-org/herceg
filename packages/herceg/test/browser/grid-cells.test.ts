// Cells in the page: links in text cells (their schemes, focus, keys, and
// presses), kinds' DOM and what a screen reader reads of them, custom
// renderers' lifecycle (created once per cell element given the column,
// updated as it shows other rows, destroyed as it leaves) under scrolling,
// streaming, groups, column moves, replacement, and destroy, their signals
// and errors, control and composite keys, a framework's hand-off, columns
// without fields, remote grids' links, fields, and rows, and what contexts
// kept hold of once the grid moves on.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { afterEach, describe, expect, it } from "vitest";
import { commands, userEvent } from "vitest/browser";
import { count } from "../../src/data/aggregations.ts";
import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Schema, table } from "../../src/data/table.ts";
import { createPivotGrid } from "../../src/dom/grid-pivot.ts";
import { createRemoteGrid } from "../../src/dom/grid-remote.ts";
import { memorySource } from "../../src/grid/memory.ts";
import {
  barCell,
  chipCell,
  createGridModel,
  type GridModel,
  symbolCell,
} from "../../src/grid/model.ts";
import { createPivotGridModel } from "../../src/grid/pivot.ts";
import { createRemoteGridModel, type RemoteGridModel } from "../../src/grid/remote.ts";
import type { GridSource, RowsRequest, RowsWindow } from "../../src/grid/source.ts";
import {
  createGrid,
  type FrameworkCell,
  type GridCellContext,
  type GridCellRenderer,
  type GridOptions,
} from "../../src/grid.ts";
import { accessibilityTree, collectGarbage } from "./helpers.ts";

const COMMAND = navigator.platform.startsWith("Mac") ? "Meta" : "Control";
const ROW = 28;

const hosts: HTMLElement[] = [];
const grids: { destroy(): void }[] = [];
const models: { dispose(): void }[] = [];
afterEach(async () => {
  for (const grid of grids.splice(0)) grid.destroy();
  for (const host of hosts.splice(0)) host.remove();
  for (const model of models.splice(0)) model.dispose();
});

function place(width = 600) {
  const element = document.createElement("div");
  element.style.cssText = `width:${width}px;height:400px`;
  document.body.append(element);
  hosts.push(element);
  return element;
}

function mount<S extends Schema>(model: GridModel<S>, options: Partial<GridOptions<S>> = {}) {
  const grid = createGrid(place(), { model, ariaLabel: "Cells", ...options });
  grids.push(grid);
  return grid;
}

function services(rows = 1000) {
  return table({
    id: Float64Array.from({ length: rows }, (_, i) => i),
    service: category(Array.from({ length: rows }, (_, i) => `svc${i}`)),
    latency: Float64Array.from({ length: rows }, (_, i) => (i % 5 === 4 ? Number.NaN : i % 100)),
  });
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Frames until `ready` holds, at most `ms`. */
async function until(ready: () => boolean, ms = 3000): Promise<void> {
  const start = performance.now();
  while (!ready()) {
    if (performance.now() - start > ms) throw new Error("timed out");
    await frame();
  }
}

const cellsOf = (grid: { root: HTMLElement }, column: number) => [
  ...grid.root.querySelectorAll<HTMLElement>(`.hg-body [aria-colindex="${column}"]`),
];
/** The mounted cell of `column` (1-based) in the row of index `row`. */
const cellAt = (grid: { root: HTMLElement }, row: number, column: number) =>
  grid.root.querySelector<HTMLElement>(
    `.hg-body [aria-rowindex="${row + 2}"] [aria-colindex="${column}"]`,
  )!;

/** Errors reported while `run` runs (and the frames it waits for). */
async function reported(run: () => Promise<void> | void): Promise<unknown[]> {
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    errors.push(event.error);
    event.preventDefault();
  };
  window.addEventListener("error", onError);
  try {
    await run();
  } finally {
    window.removeEventListener("error", onError);
  }
  return errors;
}

/** A renderer writing `<text>` in a span, counting its views' creates, updates, and destroys. */
function counting(options: Partial<GridCellRenderer> = {}) {
  const counts = { create: 0, update: 0, destroy: 0 };
  const signals: AbortSignal[] = [];
  const contexts: GridCellContext[] = [];
  const renderer: GridCellRenderer = {
    ...options,
    create(host) {
      counts.create++;
      const span = host.ownerDocument.createElement("span");
      host.append(span);
      return {
        update(cell: GridCellContext) {
          counts.update++;
          signals.push(cell.signal);
          contexts.push(cell);
          span.textContent = `<${cell.text}>`;
        },
        destroy() {
          counts.destroy++;
        },
      };
    },
  };
  return { counts, signals, contexts, renderer };
}

describe("links", () => {
  const linked = (rows = 1000) =>
    createGridModel({
      data: rowView(services(rows)),
      columns: [{ field: "id" }, { field: "service" }, { field: "latency" }],
      fields: { service: { link: { url: ["/s/", { value: true }] } } },
    });

  it("draw an anchor in a linked field's cells, opening a new browsing context", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
      fields: {
        service: {
          link: {
            url: ["https://example.com/s/", { value: true }],
            text: ["Open ", { value: true }],
          },
        },
      },
    });
    const grid = mount(model);
    const anchor = cellsOf(grid, 2)[0]!.querySelector("a")!;
    expect(anchor.getAttribute("href")).toBe("https://example.com/s/svc0");
    expect(anchor.target).toBe("_blank");
    expect(anchor.rel).toBe("noopener noreferrer");
    // The link's text is the cell's.
    expect(anchor.textContent).toBe("Open svc0");
    expect(cellsOf(grid, 2)[0]!.textContent).toBe("Open svc0");
    expect(model.cellAt(0, 1).link).toEqual({
      url: "https://example.com/s/svc0",
      text: "Open svc0",
    });
  });

  it("draw no link where values make a URL of a scheme links do not take", () => {
    const data = table({
      scheme: category(["https", "javascript", "mailto", "data"]),
    });
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "scheme" }],
      fields: { scheme: { link: { url: [{ value: true }, ":example.com"] } } },
    });
    const grid = mount(model);
    const hrefs = cellsOf(grid, 1).map((cell) => cell.querySelector("a")?.getAttribute("href"));
    expect(hrefs).toEqual(["https:example.com", null, "mailto:example.com", null]);
    // Their text is written all the same.
    expect(cellsOf(grid, 1).map((cell) => cell.textContent)).toEqual([
      "https",
      "javascript",
      "mailto",
      "data",
    ]);
  });

  it("take the cell's roving focus, and arrows move it on as from the cell", async () => {
    const model = linked();
    const grid = mount(model);
    grid.focusCell(0, "service");
    const anchor = cellAt(grid, 0, 2).querySelector("a")!;
    expect(document.activeElement).toBe(anchor);
    expect(anchor.tabIndex).toBe(0);
    // The cell shows the focus its link holds.
    expect(getComputedStyle(cellAt(grid, 0, 2)).outlineStyle).toBe("solid");
    expect(getComputedStyle(cellAt(grid, 1, 2)).outlineStyle).toBe("none");
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cellAt(grid, 0, 3));
    expect(anchor.tabIndex).toBe(-1);
    await userEvent.keyboard("{ArrowLeft}{ArrowDown}");
    expect(document.activeElement).toBe(cellAt(grid, 1, 2).querySelector("a"));
    expect(model.focus).toMatchObject({ rowIndex: 1, column: "service" });
  });

  it("follow their own Enter and presses, which neither select nor report a click", async () => {
    const model = linked();
    const grid = mount(model);
    const events: string[] = [];
    grid.on("cellClick", () => events.push("cellClick"));
    grid.on("rowClick", () => events.push("rowClick"));
    const followed: { row: number; modified: boolean }[] = [];
    grid.root.addEventListener("click", (event) => {
      const anchor = (event.target as Element).closest("a");
      if (!anchor) return;
      // Followed links would leave the test's page.
      event.preventDefault();
      followed.push({
        row: Number(anchor.closest("[role=row]")!.getAttribute("aria-rowindex")) - 2,
        modified: event.metaKey || event.ctrlKey,
      });
    });
    grid.focusCell(1, "service");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(cellAt(grid, 2, 2).querySelector("a")!);
    await userEvent.click(cellAt(grid, 3, 2).querySelector("a")!, { modifiers: [COMMAND] });
    expect(followed).toEqual([
      { row: 1, modified: false },
      { row: 2, modified: false },
      { row: 3, modified: true },
    ]);
    expect(events).toEqual([]);
    expect(model.selectedCount).toBe(0);
    // A press focuses the link's cell.
    expect(model.focus).toMatchObject({ rowIndex: 3, column: "service" });
    expect(document.activeElement).toBe(cellAt(grid, 3, 2).querySelector("a"));
    // Space on a link still selects its row.
    await userEvent.keyboard(" ");
    expect(model.isSelected(3)).toBe(true);
  });

  it("give presses on a cell whose link went back to the grid", async () => {
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "latency" }],
      fields: { latency: { link: { url: ["/l/", { value: true }] } } },
    });
    const grid = mount(model);
    const clicks: number[] = [];
    grid.on("cellClick", (event) => clicks.push(event.rowIndex));
    // Every fifth latency is missing: its URL cannot be made.
    const anchor = cellAt(grid, 4, 2).querySelector("a")!;
    expect(anchor.hasAttribute("href")).toBe(false);
    await userEvent.click(cellAt(grid, 4, 2));
    expect(clicks).toEqual([4]);
  });

  it("leave the focus on the cell when its link goes", () => {
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "latency" }],
      fields: { latency: { link: { url: ["/l/", { value: true }] } } },
    });
    const grid = mount(model);
    grid.focusCell(0, "latency");
    expect(document.activeElement?.tagName).toBe("A");
    // A missing value makes no link.
    data.set("latency", 0, Number.NaN);
    grid.render();
    const cell = cellAt(grid, 0, 2);
    expect(cell.querySelector("a")!.hasAttribute("href")).toBe(false);
    expect(document.activeElement).toBe(cell);
    expect(cell.tabIndex).toBe(0);
  });

  it("leave the focus on the cell when its link goes, in a shadow root too", () => {
    const outer = place();
    const shadow = outer.attachShadow({ mode: "open" });
    const container = document.createElement("div");
    container.style.cssText = "width:600px;height:400px";
    shadow.append(container);
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "latency" }],
      fields: { latency: { link: { url: ["/l/", { value: true }] } } },
    });
    const grid = createGrid(container, { model, ariaLabel: "Cells" });
    grids.push(grid);
    grid.focusCell(0, "latency");
    expect(shadow.activeElement?.tagName).toBe("A");
    data.set("latency", 0, Number.NaN);
    grid.render();
    const cell = cellAt(grid, 0, 2);
    expect(shadow.activeElement).toBe(cell);
    expect(cell.tabIndex).toBe(0);
  });

  it("read as links, named by their text", async () => {
    mount(linked(3));
    const tree = (await accessibilityTree("grid", [])).map((line) => line.trim());
    const first = tree.indexOf('row "0 svc0 0"');
    expect(tree.slice(first + 3, first + 6)).toEqual([
      'gridcell "svc0"',
      'link "svc0"',
      'StaticText "svc0"',
    ]);
  });
});

describe("bars", () => {
  it("draw from 0 to each value within the records' extent, none for missing values", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "latency", cell: barCell() }],
    });
    const grid = mount(model);
    // Values end at 98 (every fifth is missing).
    expect(model.cellAt(1, 1).bar).toEqual([0, 1 / 98]);
    expect(model.cellAt(4, 1).bar).toBeUndefined();
    const cell = cellsOf(grid, 2)[1]!;
    const bar = cell.querySelector<HTMLElement>(".hg-bar")!;
    expect(bar.style.getPropertyValue("--hg-bar-end")).toBe(String(1 / 98));
    expect(bar.getAttribute("aria-hidden")).toBe("true");
    expect(cell.textContent).toBe("1");
    expect(cellsOf(grid, 2)[4]!.querySelector<HTMLElement>(".hg-bar")!.hidden).toBe(true);
  });

  it("span their part of the cell, in the column's color, over a track when asked", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [
        { field: "id" },
        {
          field: "latency",
          width: 216,
          cell: barCell({ domain: [-20, 20], track: true }),
          encode: { color: [{ condition: { when: col("latency").gt(5), then: "#cc0000" } }] },
        },
      ],
    });
    const grid = mount(model);
    const cell = cellAt(grid, 10, 2);
    expect(cell.dataset.cell).toBe("bar");
    expect(cell.hasAttribute("data-track")).toBe(true);
    const bar = cell.querySelector<HTMLElement>(".hg-bar")!;
    // 10 from a base of 0 within -20 to 20: from the middle to 75% of the 200 pixels inside the padding.
    const box = bar.getBoundingClientRect();
    const left = box.left - cell.getBoundingClientRect().left;
    expect([Math.round(left), Math.round(box.width)]).toEqual([8 + 100, 50]);
    expect(bar.style.getPropertyValue("--hg-bar-color")).toBe("#cc0000");
    // The bar, not the text, takes the color.
    expect(getComputedStyle(cell).color).not.toBe("rgb(204, 0, 0)");
    expect(
      cellAt(grid, 3, 2)
        .querySelector<HTMLElement>(".hg-bar")!
        .style.getPropertyValue("--hg-bar-color"),
    ).toBe("");
    // Behind the text, which stays above it.
    expect(getComputedStyle(bar).zIndex).toBe("-1");
    expect(getComputedStyle(cell, "::before").content).toBe('""');
  });

  it("draw alone with text: false, the text naming the cell", async () => {
    const model = createGridModel({
      data: rowView(services(3)),
      columns: [
        { field: "id", cell: barCell({ domain: [0, 2], text: false }) },
        { field: "service" },
      ],
    });
    const grid = mount(model);
    const cell = cellAt(grid, 1, 1);
    expect(cell.textContent).toBe("");
    expect(cell.getAttribute("aria-label")).toBe("1");
    expect(cell.querySelector<HTMLElement>(".hg-bar")!.style.getPropertyValue("--hg-bar-end")).toBe(
      "0.5",
    );
    const tree = (await accessibilityTree("grid", [])).map((line) => line.trim());
    const row = tree.indexOf('row "1 svc1"');
    expect(tree.slice(row + 1, row + 3)).toEqual(['gridcell "1"', 'gridcell "svc1"']);
  });

  it("draw again as the records' extent moves while streaming", () => {
    const data = services(100);
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "latency", cell: barCell() }],
    });
    const grid = mount(model);
    const end = () =>
      cellAt(grid, 1, 2)
        .querySelector<HTMLElement>(".hg-bar")!
        .style.getPropertyValue("--hg-bar-end");
    expect(end()).toBe(String(1 / 98));
    data.append({
      id: Float64Array.of(100),
      service: ["svc100"],
      latency: Float64Array.of(196),
    });
    grid.render();
    expect(end()).toBe(String(1 / 196));
  });

  it("refuse fields that are not numbers", () => {
    expect(() =>
      createGridModel({
        data: rowView(services()),
        // @ts-expect-error A bar of categories.
        columns: [{ field: "service", cell: barCell() }],
      }),
    ).toThrow(
      'grid columns[0].cell: bar cells draw numbers; "service" holds categories; give a number field, or chipCell()',
    );
  });
});

describe("chips", () => {
  it("fill by the column's color, their text black or white, whichever contrasts more", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [
        { field: "id" },
        {
          field: "latency",
          cell: chipCell(),
          encode: {
            color: [
              { condition: { when: col("latency").gt(5), then: "#000080" } },
              { value: "#ffff66" },
            ],
          },
        },
      ],
    });
    const grid = mount(model);
    const chip = (row: number) => cellAt(grid, row, 2).querySelector<HTMLElement>(".hg-chip")!;
    expect(chip(10).textContent).toBe("10");
    expect(getComputedStyle(chip(10)).backgroundColor).toBe("rgb(0, 0, 128)");
    expect(getComputedStyle(chip(10)).color).toBe("rgb(255, 255, 255)");
    expect(getComputedStyle(chip(2)).backgroundColor).toBe("rgb(255, 255, 102)");
    expect(getComputedStyle(chip(2)).color).toBe("rgb(0, 0, 0)");
    // A missing value writes its text without a chip.
    expect(chip(4).hasAttribute("data-none")).toBe(true);
    expect(getComputedStyle(chip(4)).backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  /** Whether the text of row `row`'s chip in `column` is black or white, opaque; else its color. */
  const chipInk = (grid: { root: HTMLElement }, column: number, row = 0) => {
    const color = getComputedStyle(
      cellAt(grid, row, column).querySelector<HTMLElement>(".hg-chip")!,
    ).color;
    const numbers = color.match(/-?[\d.]+(?:e-?\d+)?/g)!.map(Number);
    // In sRGB or linear channels.
    const [r = 0, g = 0, b = 0, alpha = 1] = color.startsWith("color(")
      ? numbers
      : [...numbers.slice(0, 3).map((n) => n / 255), numbers[3]];
    const sum = r + g + b;
    return alpha !== 1 ? color : sum === 0 ? "black" : sum === 3 ? "white" : color;
  };

  it("ink translucent chips over their cell's fill, in selected rows too", async () => {
    document.documentElement.style.setProperty("--test-chip", "rgb(0 0 0 / 0.5)");
    try {
      const black = { fill: { value: "#000000" } };
      const model = createGridModel({
        data: rowView(services()),
        columns: [
          {
            field: "id",
            cell: chipCell(),
            encode: { ...black, color: { value: "rgba(0, 0, 0, 0.5)" } },
          },
          {
            field: "service",
            cell: chipCell(),
            encode: { ...black, color: { value: "var(--test-chip)" } },
          },
        ],
      });
      const grid = mount(model, { theme: "light" });
      // Half black over black, not over the surface: white.
      expect([chipInk(grid, 1), chipInk(grid, 2)]).toEqual(["white", "white"]);
      model.select(0, "only");
      grid.render();
      expect([chipInk(grid, 1), chipInk(grid, 2)]).toEqual(["white", "white"]);
    } finally {
      document.documentElement.style.removeProperty("--test-chip");
    }
  });

  it("ink default chips over their faint fill, and take currentColor as the text's color", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [
        { field: "id", cell: chipCell() },
        { field: "service", cell: chipCell(), encode: { fill: { value: "#777777" } } },
        { field: "latency", cell: chipCell(), encode: { color: { value: "currentColor" } } },
      ],
    });
    const grid = mount(model, { theme: "light" });
    // The faint chip over white is light; over the gray fill, dark enough for white text.
    expect([chipInk(grid, 1), chipInk(grid, 2)]).toEqual(["black", "white"]);
    const chip = cellAt(grid, 0, 3).querySelector<HTMLElement>(".hg-chip")!;
    expect(getComputedStyle(chip).backgroundColor).toBe(getComputedStyle(grid.root).color);
    expect(chipInk(grid, 3)).toBe("white");
  });

  it("drop their fill and take the row's system colors under forced colors", async (context) => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id", cell: chipCell() }, { field: "service" }],
    });
    const grid = mount(model, { theme: "light" });
    model.select(0, "only");
    grid.render();
    if (!(await commands.forcedColors(true))) {
      await commands.forcedColors(false);
      context.skip("this engine emulates no forced colors");
    }
    try {
      for (const row of [0, 1]) {
        const chip = getComputedStyle(cellAt(grid, row, 1).querySelector(".hg-chip")!);
        const cell = getComputedStyle(cellAt(grid, row, 1));
        // Transparent (forced colors keep the system color's channels).
        expect(chip.backgroundColor).toMatch(/^rgba\(\d+, \d+, \d+, 0\)$/);
        // Highlight's text in the selected row, the page's text in the other.
        expect(chip.color).toBe(cell.color);
      }
    } finally {
      await commands.forcedColors(false);
    }
  });

  it("ink translucent chips over the theme's surface, as themes change too", async () => {
    document.documentElement.style.setProperty("--test-chip", "rgb(0 0 0 / 0.5)");
    try {
      const model = createGridModel({
        data: rowView(services()),
        columns: [
          { field: "id", cell: chipCell(), encode: { color: { value: "rgba(0, 0, 0, 0.5)" } } },
          { field: "service", cell: chipCell(), encode: { color: { value: "var(--test-chip)" } } },
        ],
      });
      const grid = mount(model, { theme: "light" });
      const ink = (column: number) => chipInk(grid, column);
      // Half black over white is a gray black text suits, whether the grid or the page reads it.
      expect([ink(1), ink(2)]).toEqual(["black", "black"]);
      grid.update({ theme: "dark" });
      grid.render();
      expect([ink(1), ink(2)]).toEqual(["white", "white"]);
    } finally {
      document.documentElement.style.removeProperty("--test-chip");
    }
  });

  it("go when the column's cell does, its text back in the cell", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service", cell: chipCell() }],
    });
    const grid = mount(model);
    expect(cellAt(grid, 0, 2).querySelector(".hg-chip")).not.toBeNull();
    model.setColumns([{ field: "id" }, { field: "service" }]);
    grid.render();
    expect(cellAt(grid, 0, 2).querySelector(".hg-chip")).toBeNull();
    expect(cellAt(grid, 0, 2).textContent).toBe("svc0");
  });
});

describe("symbols", () => {
  it("draw a shape before the text by the symbol channel, none for missing values", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [
        { field: "id" },
        { field: "service", cell: symbolCell(), encode: { symbol: { field: "service" } } },
        { field: "latency", cell: symbolCell({ text: false }) },
      ],
    });
    const grid = mount(model);
    const path = (row: number, column: number) =>
      cellAt(grid, row, column).querySelector("svg.hg-symbol path")!.getAttribute("d");
    // Symbols in turn, by first appearance: a circle, then a square.
    expect(path(0, 2)).toMatch(/^M-4\.51 0a/);
    expect(path(1, 2)).toMatch(/^M-?[\d.]+ -?[\d.]+L/);
    expect(path(0, 2)).not.toBe(path(1, 2));
    expect(cellAt(grid, 0, 2).textContent).toBe("svc0");
    const missing = cellAt(grid, 4, 3).querySelector<SVGElement>("svg.hg-symbol")!;
    expect(missing.style.visibility).toBe("hidden");
    // Without text, the hidden text names the cell.
    expect(cellAt(grid, 1, 3).textContent).toBe("");
    expect(cellAt(grid, 1, 3).getAttribute("aria-label")).toBe("1");
  });

  it("read as their text, the shapes hidden", async () => {
    const model = createGridModel({
      data: rowView(services(3)),
      columns: [
        { field: "service", cell: symbolCell() },
        { field: "latency", cell: symbolCell({ text: false }) },
        { field: "id", cell: chipCell() },
      ],
    });
    mount(model);
    // Firefox gives the chip's span a node of its own, named by nothing.
    const tree = (await accessibilityTree("grid", []))
      .map((line) => line.trim())
      .filter((line) => line !== 'generic ""');
    const first = tree.indexOf('row "svc0 0 0"');
    // The symbol and the chip are not read: a symbol without text reads as its label.
    expect(tree.slice(first + 1, first + 6)).toEqual([
      'gridcell "svc0"',
      'StaticText "svc0"',
      'gridcell "0"',
      'gridcell "0"',
      'StaticText "0"',
    ]);
  });
});

describe("custom renderers", () => {
  it("create once per cell element, update as rows scroll by, and destroy with the grid", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const { counts, signals, renderer } = counting();
    const grid = mount(model, { cells: { service: renderer } });
    expect(cellsOf(grid, 2)[0]!.textContent).toBe("<svc0>");
    expect(cellsOf(grid, 2)[0]!.getAttribute("aria-label")).toBe("svc0");
    // Away from the top, as many rows are mounted wherever the grid is scrolled.
    model.scrollTo({ top: ROW * 100 });
    grid.render();
    const mounted = cellsOf(grid, 2).length;
    expect(counts.create).toBe(mounted);
    const updates = counts.update;
    model.scrollTo({ top: ROW * 300 });
    grid.render();
    expect(counts.create).toBe(mounted);
    expect(counts.update).toBe(updates + mounted);
    // Every update but each element's last was superseded.
    expect(signals.filter((signal) => !signal.aborted)).toHaveLength(mounted);
    grid.destroy();
    expect(counts.destroy).toBe(mounted);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(signals[0]!.reason).toMatchObject({ name: "AbortError" });
  });

  it("update as rows change while data streams, not as rows arrive past the view", () => {
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const { counts, renderer } = counting();
    const grid = mount(model, { cells: { service: renderer } });
    const { create, update } = counts;
    const mounted = cellsOf(grid, 2).length;
    // Rows past the view arrive.
    data.append({ id: Float64Array.of(1000), service: ["svc1000"], latency: Float64Array.of(1) });
    grid.render();
    expect(counts).toEqual({ create, update, destroy: 0 });
    // A row's value changes: a table's rows share one version, so every view draws again.
    data.set("service", 2, "renamed");
    grid.render();
    expect(counts).toEqual({ create, update: update + mounted, destroy: 0 });
    expect(cellAt(grid, 2, 2).textContent).toBe("<renamed>");
    // Rows dropped before the view move every row up: each cell shows another row.
    data.dropFirst(1);
    grid.render();
    expect(counts).toEqual({ create, update: update + 2 * mounted, destroy: 0 });
    expect(cellAt(grid, 0, 2).textContent).toBe("<svc1>");
  });

  it("update as a row's selection or index moves", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const { counts, contexts, renderer } = counting();
    const grid = mount(model, { cells: { service: renderer } });
    const update = counts.update;
    model.select(3, "only");
    grid.render();
    expect(counts.update).toBe(update + 1);
    expect(contexts.at(-1)).toMatchObject({ rowIndex: 3, selected: "all" });
  });

  it("destroy their views as cells show groups, and create them as they show rows again", () => {
    const view = rowView(
      table({
        id: Float64Array.from({ length: 40 }, (_, i) => i),
        service: category(Array.from({ length: 40 }, (_, i) => `svc${i % 4}`)),
      }),
    );
    const model = createGridModel({
      data: view,
      columns: [{ field: "service" }, { field: "id" }],
      groups: groupRows(view, { by: ["service"] }),
    });
    model.expandAll();
    const { counts, contexts, renderer } = counting();
    const grid = mount(model, { cells: { id: renderer } });
    // The first row is a group's: its cells write text.
    expect(cellAt(grid, 0, 2).querySelector(".hg-host")).toBeNull();
    expect(cellAt(grid, 1, 2).textContent).toBe("<0>");
    const views = counts.create;
    const rows = grid.root.querySelectorAll(".hg-body [role=row]:not([aria-expanded])").length;
    expect(views).toBe(rows);
    expect(contexts.every((context) => context.row.kind === "row")).toBe(true);
    model.collapseAll();
    grid.render();
    expect(counts.destroy).toBe(views);
    expect(cellsOf(grid, 2).every((cell) => !cell.querySelector(".hg-host"))).toBe(true);
    model.expandAll();
    grid.render();
    expect(counts.create).toBe(views * 2);
  });

  it("keep their views as columns move, and destroy them as columns hide", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }, { field: "latency" }],
    });
    const { counts, renderer } = counting();
    const grid = mount(model, { cells: { service: renderer } });
    const views = counts.create;
    model.moveColumn("service", "id");
    grid.render();
    expect(counts).toMatchObject({ create: views, destroy: 0 });
    expect(cellAt(grid, 0, 1).textContent).toBe("<svc0>");
    model.setColumnVisible("service", false);
    grid.render();
    expect(counts.destroy).toBe(views);
    model.setColumnVisible("service", true);
    grid.render();
    expect(counts.create).toBe(views * 2);
  });

  it("destroy a view as its element moves to another column of the same renderer", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }, { field: "latency" }],
    });
    const { counts, contexts, renderer } = counting();
    const grid = mount(model, { cells: { service: renderer, latency: renderer } });
    const views = counts.create;
    // The elements of a column hidden are given to the column shown.
    model.setColumnVisible("service", false);
    grid.render();
    expect(counts.destroy).toBe(views / 2);
    expect(contexts.at(-1)!.column.id).toBe("latency");
    model.setColumnVisible("service", true);
    grid.render();
    expect(counts.create - counts.destroy).toBe(views);
  });

  it("read their row's values wherever the row moves before the next update", () => {
    const view = rowView(services());
    const model = createGridModel({ data: view, columns: [{ field: "id" }, { field: "service" }] });
    const { contexts, renderer } = counting({ fields: ["latency"] });
    mount(model, { cells: { service: renderer } });
    const first = contexts.find((context) => context.rowIndex === 1)!;
    expect(first.read("latency")).toBe(1);
    // Sorted, not yet drawn: the context still reads its own row.
    view.setQuery({ sort: [{ field: "latency", order: "descending" }] });
    expect(first.signal.aborted).toBe(false);
    expect(first.read("latency")).toBe(1);
    expect(first.text).toBe("svc1");
  });

  it("draw a draw asked for by a renderer in the next frame, not inside the one drawing", async () => {
    const view = rowView(services());
    const model = createGridModel({ data: view, columns: [{ field: "id" }, { field: "service" }] });
    const seen: { id: unknown; text: string }[] = [];
    let armed = false;
    const grid = mount(model, {
      cells: {
        service: {
          create: (host) => ({
            update(cell) {
              seen.push({ id: cell.row.ref.id, text: cell.text });
              host.textContent = cell.text;
              if (armed && cell.rowIndex === 302) {
                armed = false;
                view.setQuery({ sort: [{ field: "id", order: "descending" }] });
                grid.render();
              }
            },
          }),
        },
      },
    });
    armed = true;
    model.scrollTo({ top: ROW * 300 });
    grid.render();
    await frame();
    await frame();
    // Every context's text is its own row's: ids are rows' identities, and service "svc<id>".
    expect(seen.length).toBeGreaterThan(cellsOf(grid, 2).length);
    expect(seen.filter(({ id, text }) => text !== `svc${id}`)).toEqual([]);
    expect(cellAt(grid, 300, 2).textContent).toBe("svc699");
  });

  it("draw nothing more once a renderer destroys the grid", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const counts = { create: 0, destroy: 0 };
    const signals: AbortSignal[] = [];
    let grid!: { destroy(): void; render(): void };
    let armed = false;
    grid = mount(model, {
      cells: {
        service: {
          create: () => {
            counts.create++;
            return {
              update(cell) {
                signals.push(cell.signal);
                if (armed && cell.rowIndex === 302) grid.destroy();
              },
              destroy() {
                counts.destroy++;
              },
            };
          },
        },
      },
    });
    armed = true;
    model.scrollTo({ top: ROW * 300 });
    grid.render();
    expect(counts.destroy).toBe(counts.create);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("stop reads before abort listeners run as the grid goes", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const read: unknown[] = [];
    const grid = mount(model, {
      cells: {
        service: {
          fields: ["latency"],
          create: () => ({
            update(cell) {
              cell.signal.addEventListener("abort", () => {
                try {
                  read.push(cell.read("latency"));
                } catch {
                  read.push("stopped");
                }
              });
            },
          }),
        },
      },
    });
    grid.destroy();
    expect(read.length).toBeGreaterThan(0);
    expect(read.every((value) => value === "stopped")).toBe(true);
  });

  it("write the cells a draw stopped before, when a renderer changed the model", async () => {
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "service" }, { field: "id" }],
    });
    let scrolled = false;
    let armed = false;
    const grid = mount(model, {
      cells: {
        service: {
          create: (host) => ({
            update(cell) {
              host.textContent = cell.text;
              if (armed && !scrolled && cell.rowIndex === 0) {
                scrolled = true;
                model.scrollTo({ top: 1 });
              }
            },
          }),
        },
      },
    });
    armed = true;
    data.set("id", 0, 9999);
    grid.render();
    await frame();
    await frame();
    expect(scrolled).toBe(true);
    expect(cellAt(grid, 0, 2).textContent).toBe("9,999");
  });

  it("deliver no context as an abort changes the model, and draw the row the next frame", async () => {
    const data = services();
    const view = rowView(data);
    const model = createGridModel({ data: view, columns: [{ field: "id" }, { field: "service" }] });
    const seen: { text: string; id: unknown }[] = [];
    const grid = mount(model, {
      cells: {
        service: {
          fields: ["id"],
          create: (host) => ({
            update(cell) {
              seen.push({ text: cell.text, id: cell.read("id") });
              host.textContent = cell.text;
              if (cell.rowIndex === 0 && seen.length === 1)
                cell.signal.addEventListener("abort", () =>
                  view.setQuery({ sort: [{ field: "id", order: "descending" }] }),
                );
            },
          }),
        },
      },
    });
    data.set("latency", 0, 55);
    grid.render();
    await frame();
    await frame();
    // A context's text and reads are of one row: service "svc<id>".
    expect(seen.filter(({ text, id }) => text !== `svc${id}`)).toEqual([]);
    expect(cellAt(grid, 0, 2).textContent).toBe("svc999");
  });

  it("write every cell again as a view destroyed with its row changes the model", async () => {
    const view = rowView(services());
    const model = createGridModel({ data: view, columns: [{ field: "id" }, { field: "service" }] });
    let armed = false;
    const grid = mount(model, {
      cells: {
        service: {
          create: (host) => ({
            update(cell) {
              host.textContent = cell.text;
            },
            destroy() {
              if (!armed) return;
              armed = false;
              view.setQuery({
                filter: col("id").ge(997),
                sort: [{ field: "id", order: "descending" }],
              });
            },
          }),
        },
      },
    });
    armed = true;
    // Three rows not shown yet take three rows' elements; the others go, their views with them.
    view.setQuery({ filter: col("id").ge(997) });
    grid.render();
    await frame();
    await frame();
    expect([0, 1, 2].map((i) => cellAt(grid, i, 1).textContent)).toEqual(["999", "998", "997"]);
  });

  it("write every cell again as a view destroyed with its column changes the model", async () => {
    const data = services(3);
    const view = rowView(data);
    const model = createGridModel({ data: view, columns: [{ field: "id" }, { field: "service" }] });
    let armed = false;
    const grid = mount(model, {
      cells: {
        service: {
          create: (host) => ({
            update(cell) {
              host.textContent = cell.text;
            },
            destroy() {
              if (!armed) return;
              armed = false;
              view.setQuery({ sort: [{ field: "id", order: "descending" }] });
            },
          }),
        },
      },
    });
    armed = true;
    // Every row writes its text again, and its first loses its view.
    data.set("latency", 0, 55);
    model.setColumnVisible("service", false);
    grid.render();
    await frame();
    await frame();
    expect([0, 1, 2].map((i) => cellAt(grid, i, 1).textContent)).toEqual(["2", "1", "0"]);
  });

  it("read nothing of a table reset since", () => {
    const data = services(10);
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const { contexts, renderer } = counting({ fields: ["latency"] });
    mount(model, { cells: { service: renderer } });
    const first = contexts.find((context) => context.rowIndex === 0)!;
    expect(first.read("latency")).toBe(0);
    data.reset({
      id: Float64Array.of(0),
      service: category(["other"]),
      latency: Float64Array.of(100),
    });
    expect(() => first.read("latency")).toThrow("grid rowValues: row 0 is no longer in the table");
  });

  it("destroy the views of a renderer replaced, and leave others be", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const first = counting();
    const kept = counting();
    const grid = mount(model, { cells: { service: first.renderer, id: kept.renderer } });
    const views = first.counts.create;
    const second = counting();
    grid.update({ cells: { service: second.renderer, id: kept.renderer } });
    grid.render();
    expect(first.counts.destroy).toBe(views);
    expect(second.counts.create).toBe(views);
    expect(kept.counts).toMatchObject({ create: views, destroy: 0 });
    expect(cellAt(grid, 0, 2).querySelectorAll(".hg-host")).toHaveLength(1);
  });

  it("make no view in place of one whose destroy destroyed the grid", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    let armed = false;
    let created = 0;
    const grid = mount(model, {
      cells: {
        service: {
          create: () => ({
            update() {},
            destroy() {
              if (!armed) return;
              armed = false;
              grid.destroy();
            },
          }),
        },
      },
    });
    armed = true;
    grid.update({
      cells: {
        service: {
          create: () => {
            created++;
            return { update() {} };
          },
        },
      },
    });
    grid.render();
    expect(created).toBe(0);
  });

  it("abort an update's signal as the next supersedes it, and draw no stale work", async () => {
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const drawn: string[] = [];
    const grid = mount(model, {
      cells: {
        service: {
          create: (host) => ({
            async update(cell) {
              await new Promise((resolve) => setTimeout(resolve, 10));
              if (cell.signal.aborted) return;
              host.textContent = cell.text;
              drawn.push(cell.text);
            },
          }),
        },
      },
    });
    data.set("service", 0, "second");
    grid.render();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(drawn).toContain("second");
    expect(drawn).not.toContain("svc0");
    expect(cellAt(grid, 0, 2).textContent).toBe("second");
  });

  it("read the fields they name until superseded, and refuse others", () => {
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const read: unknown[] = [];
    const contexts: GridCellContext[] = [];
    let error: unknown;
    const grid = mount(model, {
      cells: {
        service: {
          fields: ["latency"],
          create: () => ({
            update(cell) {
              contexts.push(cell);
              read.push(cell.read("latency"));
              try {
                cell.read("id");
              } catch (thrown) {
                error = thrown;
              }
            },
          }),
        },
      },
    });
    expect(read.slice(0, 5)).toEqual([0, 1, 2, 3, null]);
    expect(String(error)).toContain(
      'grid cells.service: read("id") reads a field the renderer does not name; give fields: ["latency", "id"]',
    );
    data.set("service", 0, "renamed");
    grid.render();
    expect(() => contexts[0]!.read("latency")).toThrow(
      'grid cells.service: read("latency") after its update was superseded; check cell.signal before reading',
    );
  });

  it("report a throwing view once, its cell writing its text until it leaves the column", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    let created = 0;
    let updates = 0;
    let grid!: { render(): void; root: HTMLElement };
    const errors = await reported(async () => {
      grid = mount(model, {
        cells: {
          service: {
            create(host) {
              // The first view made fails at every update.
              const broken = created++ === 0;
              return {
                update(cell) {
                  updates++;
                  if (broken) throw new Error("no draw");
                  host.textContent = `<${cell.text}>`;
                },
              };
            },
          },
        },
      });
      for (const top of [ROW * 50, 0, ROW * 120]) {
        model.scrollTo({ top });
        grid.render();
      }
    });
    expect(errors.map(String)).toEqual(["Error: no draw"]);
    // The others went on drawing as their cells showed other rows; the one that failed writes text.
    expect(updates).toBeGreaterThan(cellsOf(grid, 2).length * 3);
    const failed = cellsOf(grid, 2).filter((cell) => !cell.textContent?.startsWith("<"));
    expect(failed).toHaveLength(1);
    expect(failed[0]!.textContent).toMatch(/^svc\d+$/);
    expect(failed[0]!.querySelector<HTMLElement>(".hg-host")!.hidden).toBe(true);
  });

  it("report a create that throws, and draw the rest", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    let created = 0;
    let grid!: { root: HTMLElement };
    const errors = await reported(() => {
      grid = mount(model, {
        cells: {
          service: {
            create(host) {
              if (created++ === 0) throw new Error("no view");
              return {
                update(cell) {
                  host.textContent = `<${cell.text}>`;
                },
              };
            },
          },
        },
      });
    });
    expect(errors.map(String)).toEqual(["Error: no view"]);
    const texts = cellsOf(grid, 2).map((cell) => cell.textContent);
    expect(texts.filter((text) => !text?.startsWith("<"))).toHaveLength(1);
  });

  it("restore the column's own cells with cells: undefined", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const { counts, renderer } = counting();
    const grid = mount(model, { cells: { service: renderer } });
    grid.update({ cells: undefined });
    grid.render();
    expect(counts.destroy).toBe(counts.create);
    expect(cellsOf(grid, 2)[0]!.textContent).toBe("svc0");
    expect(cellsOf(grid, 2)[0]!.hasAttribute("aria-label")).toBe(false);
    expect(cellsOf(grid, 2)[0]!.querySelector(".hg-host")).toBeNull();
  });

  it("refuse a column the grid lacks, and what is not a renderer", () => {
    const model = createGridModel({ data: rowView(services()), columns: [{ field: "id" }] });
    expect(() => mount(model, { cells: { opne: counting().renderer } })).toThrow(
      'createGrid cells.opne: no column "opne"; the columns are "id"',
    );
    expect(() => mount(model, { cells: { id: {} as never } })).toThrow(
      "createGrid cells.id: expected a renderer, { create(host) }",
    );
    expect(() =>
      mount(model, { cells: { id: { ...counting().renderer, interaction: "button" } as never } }),
    ).toThrow(
      'createGrid cells.id.interaction: expected "text", "control", or "composite"; received "button"',
    );
    // A refused update changes nothing.
    const { counts, renderer } = counting();
    const grid = mount(model, { cells: { id: renderer } });
    expect(() => grid.update({ cells: { di: renderer } })).toThrow(
      'grid.update cells.di: no column "di"; the columns are "id"',
    );
    grid.render();
    expect(counts.destroy).toBe(0);
  });

  it("are presentation by default, the cell named by its text", async () => {
    const model = createGridModel({
      data: rowView(services(3)),
      columns: [{ field: "service" }, { field: "id" }],
    });
    mount(model, { cells: { service: counting().renderer } });
    const tree = await accessibilityTree("grid", []);
    const first = tree.findIndex((line) => line.includes('row "svc0'));
    expect(tree[first + 1]!.trim()).toBe('gridcell "svc0"');
  });
});

describe("control and composite cells", () => {
  const buttons = (count: number, interaction: "control" | "composite") => {
    const pressed: string[] = [];
    const renderer: GridCellRenderer = {
      interaction,
      create(host) {
        const made = Array.from({ length: count }, (_, i) => {
          const button = host.ownerDocument.createElement("button");
          button.addEventListener("click", () => pressed.push(`${button.dataset.row}:${i}`));
          host.append(button);
          return button;
        });
        return {
          update(cell) {
            made.forEach((button, i) => {
              button.textContent = `${cell.text} ${i}`;
              button.dataset.row = String(cell.rowIndex);
            });
          },
        };
      },
    };
    return { pressed, renderer };
  };

  function mounted(count: number, interaction: "control" | "composite") {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }, { field: "latency" }],
    });
    const { pressed, renderer } = buttons(count, interaction);
    const grid = mount(model, { cells: { service: renderer } });
    const events: string[] = [];
    grid.on("cellClick", () => events.push("cellClick"));
    grid.on("rowClick", () => events.push("rowClick"));
    return { model, grid, pressed, events };
  }

  it("give a control cell's focus to its control, whose Enter and Space are its own", async () => {
    const { model, grid, pressed, events } = mounted(1, "control");
    const button = (row: number) => cellAt(grid, row, 2).querySelector("button")!;
    // Out of the tab order but where the focus is.
    expect(
      [...cellsOf(grid, 2)].map((cell) => cell.querySelector("button")!.tabIndex),
    ).not.toContain(0);
    grid.focusCell(1, "service");
    expect(document.activeElement).toBe(button(1));
    expect(button(1).tabIndex).toBe(0);
    await userEvent.keyboard("{Enter} ");
    expect(pressed).toEqual(["1:0", "1:0"]);
    expect(events).toEqual([]);
    expect(model.selectedCount).toBe(0);
    // Arrows stay the grid's.
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(button(2));
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(cellAt(grid, 2, 3));
    // A press is the control's, and focuses its cell.
    await userEvent.click(button(5));
    expect(pressed.at(-1)).toBe("5:0");
    expect(events).toEqual([]);
    expect(model.focus).toMatchObject({ rowIndex: 5, column: "service" });
  });

  it("move into a composite cell with Enter or F2, and back with Escape", async () => {
    const { model, grid, pressed, events } = mounted(2, "composite");
    const controls = (row: number) => [...cellAt(grid, row, 2).querySelectorAll("button")];
    grid.focusCell(1, "service");
    // The cell holds the focus, its controls out of the tab order.
    expect(document.activeElement).toBe(cellAt(grid, 1, 2));
    expect(controls(1).map((button) => button.tabIndex)).toEqual([-1, -1]);
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(controls(1)[0]);
    // Inside, the keys are the controls': arrows move nothing of the grid's.
    await userEvent.keyboard("{ArrowDown} ");
    expect(model.focus).toMatchObject({ rowIndex: 1, column: "service" });
    expect(pressed).toEqual(["1:0"]);
    expect(events).toEqual([]);
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(cellAt(grid, 1, 2));
    await userEvent.keyboard("{ArrowDown}{F2}");
    expect(document.activeElement).toBe(controls(2)[0]);
    // An Escape a control takes for itself stays its own.
    controls(2)[0]!.addEventListener("keydown", (event) => {
      if (event.key === "Escape") event.preventDefault();
    });
    await userEvent.keyboard("{Escape}");
    expect(document.activeElement).toBe(controls(2)[0]);
  });

  it("leave the grid with Tab from inside a composite cell, as from the cell", async () => {
    const { grid } = mounted(2, "composite");
    // An input: WebKit leaves buttons out of the Tab order.
    const after = document.createElement("input");
    document.body.append(after);
    try {
      grid.focusCell(1, "service");
      await userEvent.keyboard("{Enter}");
      await userEvent.keyboard("{Tab}");
      expect(document.activeElement).toBe(after);
      await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
      expect(document.activeElement).toBe(cellAt(grid, 1, 2));
    } finally {
      after.remove();
    }
  });

  it("leave a control cell's focus on the cell while its control is disabled", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const grid = mount(model, {
      cells: {
        service: {
          interaction: "control",
          create(host) {
            const button = host.ownerDocument.createElement("button");
            host.append(button);
            return {
              update(cell) {
                button.textContent = cell.text;
                button.disabled = cell.rowIndex === 1;
              },
            };
          },
        },
      },
    });
    grid.focusCell(1, "service");
    expect(document.activeElement).toBe(cellAt(grid, 1, 2));
    expect(cellAt(grid, 1, 2).tabIndex).toBe(0);
    grid.focusCell(2, "service");
    expect(document.activeElement).toBe(cellAt(grid, 2, 2).querySelector("button"));
  });

  it("pass over hidden inputs and controls hidden by CSS for a cell's focus", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const grid = mount(model, {
      cells: {
        service: {
          interaction: "control",
          create(host) {
            const document = host.ownerDocument;
            const hidden = document.createElement("input");
            hidden.type = "hidden";
            const undrawn = document.createElement("button");
            undrawn.style.display = "none";
            const unseen = document.createElement("button");
            unseen.style.visibility = "hidden";
            const button = document.createElement("button");
            button.className = "shown";
            host.append(hidden, undrawn, unseen, button);
            return {
              update(cell) {
                button.textContent = cell.text;
              },
            };
          },
        },
      },
    });
    grid.focusCell(1, "service");
    expect(document.activeElement).toBe(cellAt(grid, 1, 2).querySelector(".shown"));
  });

  it("keep what a text cell's renderer draws out of the tab order and presses", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const pressed: string[] = [];
    const grid = mount(model, {
      cells: {
        service: {
          create(host) {
            const button = host.ownerDocument.createElement("button");
            button.addEventListener("click", () => pressed.push(button.textContent!));
            host.append(button);
            return {
              update(cell) {
                button.textContent = cell.text;
              },
            };
          },
        },
      },
    });
    const host = cellAt(grid, 1, 2).querySelector<HTMLElement>(".hg-host")!;
    expect(host.inert).toBe(true);
    await userEvent.click(cellAt(grid, 1, 2));
    expect(pressed).toEqual([]);
    expect(model.focus).toMatchObject({ rowIndex: 1, column: "service" });
  });

  it("read their controls, not the cell's text", async () => {
    const model = createGridModel({
      data: rowView(services(2)),
      columns: [{ field: "service" }, { field: "id" }],
    });
    mount(model, { cells: { service: buttons(1, "control").renderer } });
    const tree = (await accessibilityTree("grid", [])).map((line) => line.trim());
    const first = tree.indexOf('row "svc0 0 0"');
    expect(tree.slice(first + 1, first + 4)).toEqual([
      'gridcell "svc0 0"',
      'generic ""',
      'button "svc0 0"',
    ]);
  });
});

describe("framework cells", () => {
  /** A framework of `model`'s cells that draws their text when told, as a fake adapter would. */
  function framework<S extends Schema>(_model: GridModel<S>) {
    const draws: {
      cells: readonly FrameworkCell<S>[];
      released: readonly HTMLElement[];
      frame: boolean;
    }[] = [];
    const commit = (cells: readonly FrameworkCell<S>[]) => {
      for (const cell of cells) {
        cell.host.textContent = `[${cell.context.text}]`;
        cell.drawn();
      }
    };
    return {
      draws,
      commit,
      cells: {
        draw(cells: readonly FrameworkCell<S>[], released: readonly HTMLElement[], frame: boolean) {
          draws.push({ cells, released, frame });
        },
      },
    };
  }

  it("hand cells over on the first draw, each showing its text until drawn", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const fake = framework(model);
    const grid = mount(model, { cells: { service: { framework: fake.cells } } });
    expect(fake.draws).toHaveLength(1);
    const [first] = fake.draws;
    expect(first!.frame).toBe(false);
    expect(first!.cells).toHaveLength(cellsOf(grid, 2).length);
    const cell = cellAt(grid, 0, 2);
    expect(cell.textContent).toBe("svc0");
    expect(cell.querySelector<HTMLElement>(".hg-host")!.hidden).toBe(true);
    fake.commit(first!.cells);
    expect(cell.textContent).toBe("[svc0]");
    expect(cell.getAttribute("aria-label")).toBe("svc0");
  });

  it("hand later cells over in the grid's frame, and ignore what is drawn late", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const fake = framework(model);
    const grid = mount(model, { cells: { service: { framework: fake.cells } } });
    fake.commit(fake.draws[0]!.cells);
    // A draw from code waits for the frame.
    model.scrollTo({ top: ROW * 200 });
    grid.render();
    expect(fake.draws).toHaveLength(1);
    await until(() => fake.draws.length === 2);
    const second = fake.draws[1]!;
    expect(second.frame).toBe(true);
    const shown = cellsOf(grid, 2);
    expect(second.cells).toHaveLength(shown.length);
    const handedTo = (draw: (typeof fake.draws)[number], cell: HTMLElement) =>
      draw.cells.find((one) => cell.contains(one.host))!;
    // Each cell shows its own row's text until drawn, never the row it showed.
    expect(shown[0]!.querySelector<HTMLElement>(".hg-host")!.hidden).toBe(true);
    expect(shown[0]!.innerText).toBe(handedTo(second, shown[0]!).context.text);
    // Scrolled again before the framework drew: the earlier acknowledgements are stale.
    model.scrollTo({ top: ROW * 400 });
    await until(() => fake.draws.length === 3);
    fake.commit(second.cells);
    expect(shown[0]!.querySelector<HTMLElement>(".hg-host")!.hidden).toBe(true);
    fake.commit(fake.draws[2]!.cells);
    expect(shown[0]!.innerText).toBe(`[${handedTo(fake.draws[2]!, shown[0]!).context.text}]`);
  });

  it("release the hosts of views that go", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const fake = framework(model);
    const grid = mount(model, { cells: { service: { framework: fake.cells } } });
    const hosts = fake.draws[0]!.cells.map((cell) => cell.host);
    grid.update({ cells: undefined });
    await until(() => fake.draws.length === 2);
    expect(new Set(fake.draws[1]!.released)).toEqual(new Set(hosts));
    expect(hosts.every((host) => !host.isConnected)).toBe(true);
  });

  it("hand a framework its hosts to let go of when the grid is destroyed", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const fake = framework(model);
    const grid = mount(model, { cells: { service: { framework: fake.cells } } });
    const hosts = fake.draws[0]!.cells.map((cell) => cell.host);
    // Updates handed but not drawn when the grid goes are dropped.
    model.scrollTo({ top: ROW * 300 });
    grid.render();
    grid.destroy();
    const last = fake.draws.at(-1)!;
    expect(last.cells).toEqual([]);
    // Every host goes, those whose first update was still to be handed too.
    expect(hosts.every((host) => last.released.includes(host))).toBe(true);
    expect(new Set(last.released).size).toBe(last.released.length);
  });

  it("ignore an update's acknowledgement once superseded, though nothing replaced it yet", () => {
    const view = rowView(services());
    const model = createGridModel({ data: view, columns: [{ field: "id" }, { field: "service" }] });
    const fake = framework(model);
    const grid = mount(model, { cells: { service: { framework: fake.cells } } });
    const first = fake.draws[0]!.cells;
    const top = first.find((cell) => cell.context.rowIndex === 0)!;
    // Its update is superseded as the element shows another row, and the abort sorts the rows.
    top.context.signal.addEventListener("abort", () =>
      view.setQuery({ sort: [{ field: "id", order: "descending" }] }),
    );
    model.scrollTo({ top: ROW * 200 });
    grid.render();
    expect(top.context.signal.aborted).toBe(true);
    // Drawn late: the element shows its row's text, not the row it was handed.
    fake.commit(first);
    expect(top.host.hidden).toBe(true);
    expect(top.host.parentElement!.innerText).not.toContain("[svc0]");
  });

  it("hand no cells over once a framework's draw destroyed the grid", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }, { field: "latency" }],
    });
    const first = framework(model);
    const second = framework(model);
    let armed = false;
    let destroyed = false;
    const grid = mount(model, {
      cells: {
        service: {
          framework: {
            draw(cells, released, frame) {
              first.cells.draw(cells, released, frame);
              if (!armed) return;
              armed = false;
              grid.destroy();
              destroyed = true;
            },
          },
        },
        latency: { framework: second.cells },
      },
    });
    armed = true;
    model.scrollTo({ top: ROW * 300 });
    await until(() => destroyed);
    await frame();
    const last = second.draws.at(-1)!;
    // The second framework's batch of the frame was not handed over: only its hosts to let go of.
    expect(second.draws.filter((draw) => draw.frame)).toEqual([]);
    expect(last.cells).toEqual([]);
    expect(last.released.length).toBeGreaterThan(0);
  });

  it("hand a framework the host of a view replaced, though its abort destroyed the grid", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const fake = framework(model);
    const grid = mount(model, { cells: { service: { framework: fake.cells } } });
    const handed = fake.draws[0]!.cells;
    const top = handed.find((cell) => cell.context.rowIndex === 0)!;
    top.context.signal.addEventListener("abort", () => grid.destroy());
    grid.update({ cells: { service: counting().renderer } });
    grid.render();
    const released = fake.draws.flatMap((draw) => draw.released);
    expect(released).toContain(top.host);
    expect(handed.every((cell) => released.includes(cell.host))).toBe(true);
    expect(new Set(released).size).toBe(released.length);
  });

  it("hand a framework every host it lets go of, though another's draw destroyed the grid", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }, { field: "latency" }],
    });
    const first = framework(model);
    const second = framework(model);
    let armed = false;
    let destroyed = false;
    const service = {
      framework: {
        draw(...args: Parameters<typeof first.cells.draw>) {
          first.cells.draw(...args);
          if (!armed) return;
          armed = false;
          grid.destroy();
          destroyed = true;
        },
      },
    };
    const grid = mount(model, { cells: { service, latency: { framework: second.cells } } });
    const hosts = second.draws[0]!.cells.map((cell) => cell.host);
    armed = true;
    // The second's renderer goes as the first's cells show other rows: the first's batch is handed first.
    grid.update({ cells: { service } });
    model.scrollTo({ top: ROW * 300 });
    await until(() => destroyed);
    await frame();
    const released = second.draws.flatMap((draw) => draw.released);
    expect(hosts.every((host) => released.includes(host))).toBe(true);
    expect(new Set(released).size).toBe(released.length);
  });

  it("let go of the grid and model though a framework keeps its cells", async () => {
    const kept: FrameworkCell[] = [];
    const refs = await (async () => {
      const data = services();
      const model = createGridModel({
        data: rowView(data),
        columns: [{ field: "id" }, { field: "service" }],
      });
      const grid = createGrid(place(), {
        model,
        ariaLabel: "Cells",
        cells: {
          service: {
            fields: ["latency"],
            framework: { draw: (cells) => void kept.push(...cells) },
          },
        },
      });
      grid.destroy();
      model.dispose();
      return { grid: new WeakRef(grid), model: new WeakRef(model), data: new WeakRef(data) };
    })();
    expect(kept.length).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      await frame();
      await collectGarbage();
    }
    expect([refs.grid.deref(), refs.model.deref(), refs.data.deref()]).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    // Acknowledging after the grid went does nothing.
    kept[0]!.drawn();
  });

  it("keep one tab stop as a framework draws a focused control cell's row again", async () => {
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const draws: FrameworkCell[][] = [];
    // Each commit replaces the cell's button, as a framework remounting it would.
    const commit = (cells: readonly FrameworkCell[]) => {
      for (const cell of cells) {
        const button = document.createElement("button");
        button.textContent = cell.context.text;
        cell.host.replaceChildren(button);
        cell.drawn();
      }
    };
    const grid = mount(model, {
      cells: {
        service: {
          interaction: "control",
          framework: { draw: (cells) => void draws.push([...cells]) },
        },
      },
    });
    commit(draws[0]!);
    grid.focusCell(1, "service");
    expect(document.activeElement?.textContent).toBe("svc1");
    // The table changes: every row's cells are handed again, drawn in the next frame.
    data.set("service", 1, "renamed");
    grid.render();
    await until(() => draws.length === 2);
    commit(draws[1]!);
    expect(document.activeElement?.textContent).toBe("renamed");
    const tabbable = [...grid.root.querySelectorAll<HTMLElement>(".hg-body button")].filter(
      (button) => button.tabIndex === 0,
    );
    expect(tabbable).toHaveLength(1);
  });

  it("leave the page's focus where the user took it as a framework draws a cell again", async () => {
    const data = services();
    const model = createGridModel({
      data: rowView(data),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const draws: FrameworkCell[][] = [];
    const commit = (cells: readonly FrameworkCell[]) => {
      for (const cell of cells) {
        const button = document.createElement("button");
        button.textContent = cell.context.text;
        cell.host.replaceChildren(button);
        cell.drawn();
      }
    };
    const grid = mount(model, {
      cells: {
        service: {
          interaction: "control",
          framework: { draw: (cells) => void draws.push([...cells]) },
        },
      },
    });
    commit(draws[0]!);
    grid.focusCell(1, "service");
    const outside = document.createElement("input");
    document.body.append(outside);
    try {
      outside.focus();
      outside.blur();
      expect(document.activeElement).toBe(document.body);
      data.set("service", 1, "renamed");
      grid.render();
      await until(() => draws.length === 2);
      commit(draws[1]!);
      expect(document.activeElement).toBe(document.body);
    } finally {
      outside.remove();
    }
  });

  it("keep the page's focus in the grid as a framework hides or removes what held it", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }, { field: "latency" }],
    });
    const draws: FrameworkCell[][] = [];
    const commit = (cells: readonly FrameworkCell[]) => {
      for (const cell of cells) {
        const button = document.createElement("button");
        button.textContent = cell.context.text;
        cell.host.replaceChildren(button);
        cell.drawn();
      }
    };
    const grid = mount(model, {
      cells: {
        service: {
          interaction: "control",
          framework: { draw: (cells) => void draws.push([...cells]) },
        },
        latency: {
          interaction: "composite",
          framework: { draw: (cells) => void draws.push([...cells]) },
        },
      },
    });
    for (const cells of draws) commit(cells);
    // A control hidden as its content suspends again: the cell takes the focus.
    grid.focusCell(1, "service");
    const control = cellAt(grid, 1, 2);
    const button = control.querySelector("button")!;
    expect(document.activeElement).toBe(button);
    button.style.display = "none";
    draws[0]!.find((cell) => control.contains(cell.host))!.drawn();
    expect(document.activeElement).toBe(control);
    // A control disabled, made invisible, or inert: the cell takes the focus.
    const ways: ((button: HTMLButtonElement) => void)[] = [
      (one) => {
        one.disabled = true;
      },
      (one) => {
        one.style.visibility = "hidden";
      },
      (one) => {
        one.inert = true;
      },
    ];
    for (const way of ways) {
      grid.focusCell(3, "service");
      const other = cellAt(grid, 3, 2);
      const held = other.querySelector("button")!;
      expect(document.activeElement).toBe(held);
      way(held);
      draws[0]!.find((cell) => other.contains(cell.host))!.drawn();
      expect(document.activeElement).toBe(other);
      held.disabled = false;
      held.style.visibility = "";
      held.inert = false;
    }
    // A composite cell's control the user entered, removed.
    grid.focusCell(2, "latency");
    const composite = cellAt(grid, 2, 3);
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(composite.querySelector("button"));
    composite.querySelector("button")!.remove();
    draws
      .flat()
      .find((cell) => composite.contains(cell.host))!
      .drawn();
    expect(document.activeElement).toBe(composite);
  });

  it("hand framework cells over as part of drawing: a commit asking for a draw has the next", async () => {
    const view = rowView(services());
    const model = createGridModel({ data: view, columns: [{ field: "id" }, { field: "service" }] });
    let grid!: { render(): void; root: HTMLElement };
    let depth = 0;
    let deepest = 0;
    let sorted = false;
    grid = mount(model, {
      cells: {
        service: {
          framework: {
            draw(cells) {
              depth++;
              deepest = Math.max(deepest, depth);
              for (const cell of cells) {
                cell.host.textContent = cell.context.text;
                cell.drawn();
              }
              if (!sorted && cells.length > 0 && grid) {
                sorted = true;
                view.setQuery({ sort: [{ field: "id", order: "descending" }] });
                grid.render();
              }
              depth--;
            },
          },
        },
      },
    });
    model.scrollTo({ top: ROW * 100 });
    grid.render();
    for (let i = 0; i < 4; i++) await frame();
    expect(deepest).toBe(1);
    // Every cell shows its own row: ids descend from 999.
    const shown = cellsOf(grid, 2).map((cell) => [
      cell.closest("[role=row]")!.querySelector('[aria-colindex="1"]')!.textContent,
      cell.innerText,
    ]);
    expect(shown.filter(([id, text]) => text !== `svc${id}`)).toEqual([]);
  });

  it("move a focused control cell's focus into its control once drawn", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    const draws: FrameworkCell[][] = [];
    const grid = mount(model, {
      cells: {
        service: {
          interaction: "control",
          framework: { draw: (cells) => void draws.push([...cells]) },
        },
      },
    });
    grid.focusCell(0, "service");
    const cell = cellAt(grid, 0, 2);
    expect(document.activeElement).toBe(cell);
    const handed = draws
      .flat()
      .filter((one) => one.context.rowIndex === 0)
      .at(-1)!;
    const button = document.createElement("button");
    button.textContent = "Open";
    handed.host.append(button);
    handed.drawn();
    expect(document.activeElement).toBe(button);
    expect([button.tabIndex, cell.tabIndex]).toEqual([0, -1]);
  });

  it("report a throwing framework draw, and keep drawing the grid", async () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }],
    });
    let grid!: { root: HTMLElement; destroy(): void };
    const released: number[] = [];
    const errors = await reported(() => {
      grid = mount(model, {
        cells: {
          service: {
            framework: {
              draw(_cells, gone) {
                released.push(gone.length);
                throw new Error("no commit");
              },
            },
          },
        },
      });
      expect(cellAt(grid, 0, 2).textContent).toBe("svc0");
      expect(cellAt(grid, 0, 1).textContent).toBe("0");
      // Letting go of hosts is a draw too: its error is reported, and the grid goes all the same.
      grid.destroy();
    });
    expect(errors.map(String)).toEqual(["Error: no commit", "Error: no commit"]);
    // The first draw lets go of nothing; the last, of every host.
    expect(released[0]).toBe(0);
    expect(released[1]).toBeGreaterThan(0);
    expect(grid.root.isConnected).toBe(false);
  });
});

describe("columns without fields", () => {
  const data = () =>
    table({
      id: Float64Array.from({ length: 50 }, (_, i) => i),
      service: category(Array.from({ length: 50 }, (_, i) => `svc${i}`)),
    });

  it("draw their text without a renderer: made so, set so, or left without one", () => {
    const model = createGridModel({
      data: rowView(data()),
      columns: [{ field: "id" }, { id: "open", text: ["Open ", { field: "service" }] }],
    });
    const grid = mount(model);
    expect(cellAt(grid, 3, 2).textContent).toBe("Open svc3");
    model.setColumns([{ field: "id" }, { id: "go", text: ["Go to ", { field: "id" }] }]);
    grid.render();
    expect(cellAt(grid, 3, 2).textContent).toBe("Go to 3");
    grid.update({ cells: { go: counting().renderer } });
    grid.render();
    expect(cellAt(grid, 3, 2).textContent).toBe("<Go to 3>");
    grid.update({ cells: undefined });
    grid.render();
    expect(cellAt(grid, 3, 2).textContent).toBe("Go to 3");
    expect(cellAt(grid, 3, 2).querySelector(".hg-host")).toBeNull();
  });

  it("draw their renderer, named by their text, and sort nothing from their header", async () => {
    const model = createGridModel({
      data: rowView(data()),
      columns: [
        { field: "id" },
        { id: "open", title: "Actions", text: ["Open ", { field: "service" }] },
      ],
    });
    const { contexts, renderer } = counting();
    const grid = mount(model, { cells: { open: renderer } });
    const cell = cellAt(grid, 3, 2);
    expect(cell.textContent).toBe("<Open svc3>");
    expect(cell.getAttribute("aria-label")).toBe("Open svc3");
    expect(contexts[0]).toMatchObject({ state: "empty", kind: null, value: undefined });
    expect(contexts[0]!.column).toMatchObject({ id: "open", field: null, kind: null });
    const header = grid.root.querySelector<HTMLElement>('.hg-header [aria-colindex="2"]')!;
    expect(header.hasAttribute("aria-sort")).toBe(false);
    await userEvent.click(header);
    grid.focusCell(-1, "open");
    await userEvent.keyboard("{Enter} ");
    expect(model.data.query.sort ?? []).toEqual([]);
    expect(header.hasAttribute("aria-sort")).toBe(false);
  });
});

describe("pivot grids", () => {
  it("refuse custom renderers, on create and on update", () => {
    const t = table({
      region: category(["r0", "r1"]),
      service: category(["s0", "s1"]),
    });
    const model = createPivotGridModel({
      data: pivotRows(rowView(t), { rows: "region", pivot: "service", ops: { n: count() } }),
    });
    models.push(model);
    const refusal =
      "cells: pivot grids take no custom renderers (their rows are combinations, not records); drop cells";
    expect(() =>
      createPivotGrid(place(), { model, cells: { region: counting().renderer } } as never),
    ).toThrow(`createPivotGrid ${refusal}`);
    const grid = createPivotGrid(place(), { model, ariaLabel: "Pivot" });
    grids.push(grid);
    expect(() => grid.update({ cells: { region: counting().renderer } } as never)).toThrow(
      `grid.update ${refusal}`,
    );
  });
});

describe("remote grids", () => {
  const HOSTS = ["web", "api", "db"];

  /** `rows` rows computed from their place; answers keep weak references to their columns. */
  function synthetic(rows: number) {
    const requests: RowsRequest[] = [];
    const answered: WeakRef<object>[] = [];
    const source: GridSource = {
      schema: {
        source: "synthetic",
        version: "1",
        fields: { id: "number", v: "number", host: "category" },
        key: "id",
      },
      rows: (request) => {
        requests.push(request);
        const length = Math.max(0, Math.min(request.limit, rows - request.offset));
        const id = Float64Array.from({ length }, (_, i) => request.offset + i);
        const columns = {
          id,
          v: id.map((x) => (x * 7919) % 1000),
          host: { codes: Int32Array.from(id, (x) => x % 3), dictionary: HOSTS },
        };
        answered.push(new WeakRef(columns.v));
        return Promise.resolve<RowsWindow>({
          kind: "rows",
          revision: request.revision,
          snapshot: request.snapshot ?? "s",
          parent: request.parent,
          offset: request.offset,
          length,
          total: rows,
          columns: Object.fromEntries(
            Object.entries(columns).filter(([field]) => request.fields.includes(field)),
          ),
        });
      },
    };
    return { source, requests, answered };
  }

  function remote(
    source: GridSource,
    options: {
      columns: object[];
      fields?: object;
      cells?: object;
      blockSize?: number;
      cachedBlocks?: number;
    },
    kept = true,
  ) {
    const { cells, ...settings } = options;
    const model = createRemoteGridModel({
      source,
      ...settings,
    } as never) as unknown as RemoteGridModel;
    const grid = createRemoteGrid(place(), {
      model,
      ariaLabel: "Requests",
      ...(cells && { cells }),
    } as never);
    if (kept) {
      grids.push(grid);
      models.push(model);
    }
    return { model, grid };
  }

  it("link cells from the fields their links read, asking for them", async () => {
    const { source, requests } = synthetic(1000);
    const { grid } = remote(source, {
      columns: [{ field: "v" }],
      fields: { v: { link: { url: ["/hosts/", { field: "host" }, "/", { value: true }] } } },
    });
    await until(() => cellAt(grid, 1, 1)?.querySelector("a[href]") !== null);
    expect(requests[0]!.fields).toEqual(expect.arrayContaining(["host", "v"]));
    expect(cellAt(grid, 1, 1).querySelector("a")!.getAttribute("href")).toBe("/hosts/api/919");
  });

  it("draw a column without a field by its text, asking for its fields", async () => {
    const { source, requests } = synthetic(1000);
    const { grid } = remote(source, {
      columns: [{ field: "id" }, { id: "open", text: ["Open ", { field: "host" }] }],
    });
    await until(() => cellAt(grid, 1, 2)?.textContent === "Open api");
    expect(requests[0]!.fields).toEqual(expect.arrayContaining(["host", "id"]));
  });

  it("ask for renderers' and texts' fields, and read them in renderers", async () => {
    const { source, requests } = synthetic(1000);
    const read: unknown[] = [];
    const { grid } = remote(source, {
      columns: [{ field: "id" }, { id: "open", text: ["Open ", { field: "v" }] }],
      cells: {
        open: {
          fields: ["host"],
          create: (host: HTMLElement) => ({
            update(cell: GridCellContext) {
              read.push(cell.read("host"));
              host.textContent = cell.text;
            },
          }),
        },
      },
    });
    await until(() => cellAt(grid, 1, 2)?.textContent === "Open 919");
    expect(requests[0]!.fields).toEqual(expect.arrayContaining(["host", "id", "v"]));
    expect(read.slice(0, 3)).toEqual(["web", "api", "db"]);
  });

  it("ask for every grid's renderers' fields where grids share a model", async () => {
    const { source, requests } = synthetic(1000);
    const read: unknown[] = [];
    const { model } = remote(source, {
      columns: [{ field: "id" }, { field: "v" }],
      cells: {
        v: {
          fields: ["host"],
          create: (host: HTMLElement) => ({
            update(cell: GridCellContext) {
              read.push(cell.read("host"));
              host.textContent = cell.text;
            },
          }),
        },
      },
    });
    const other = createRemoteGrid(place(), { model, ariaLabel: "Others" } as never);
    grids.push(other);
    model.refresh();
    await until(() => requests.length > 1 && read.length > 3);
    expect(requests.at(-1)!.fields).toContain("host");
    // The second grid going leaves the first's fields asked for.
    other.destroy();
    model.refresh();
    expect(requests.at(-1)!.fields).toContain("host");
  });

  it("let a grid go that a subscriber destroyed as an update asked for fields", async () => {
    const { source } = synthetic(1000);
    const renderer = {
      fields: ["host"],
      create: (host: HTMLElement) => ({
        update(cell: GridCellContext) {
          host.textContent = cell.text;
        },
      }),
    };
    let destroyed = false;
    // The model stays (the application keeps it); the grid goes.
    const ref = await (async () => {
      const { model, grid } = remote(source, { columns: [{ field: "id" }, { field: "v" }] }, false);
      models.push(model);
      await until(() => cellAt(grid, 1, 2)?.textContent === "919");
      const stop = model.subscribe(() => {
        stop();
        grid.destroy();
        destroyed = true;
      });
      // A theme following the page would watch it, were the grid still there.
      grid.update({ theme: "auto", cells: { v: renderer } } as never);
      return new WeakRef(grid);
    })();
    expect(destroyed).toBe(true);
    for (let i = 0; i < 3; i++) {
      await frame();
      await collectGarbage();
    }
    expect(ref.deref()).toBeUndefined();
  });

  it("let a grid go though a framework updates it as it lets go of its hosts", async () => {
    const { source } = synthetic(1000);
    let updated = 0;
    // The model stays (the application keeps it); the grid goes.
    const ref = await (async () => {
      let handed = false;
      const { model, grid } = remote(
        source,
        {
          columns: [{ field: "id" }, { field: "v" }],
          cells: {
            v: {
              fields: ["host"],
              framework: {
                draw(cells: readonly unknown[], released: readonly HTMLElement[]) {
                  if (cells.length > 0) handed = true;
                  if (released.length === 0) return;
                  updated++;
                  grid.update({ ariaLabel: "Changed" });
                },
              },
            },
          },
        },
        false,
      );
      models.push(model);
      await until(() => handed);
      grid.destroy();
      return new WeakRef(grid);
    })();
    for (let i = 0; i < 3; i++) {
      await frame();
      await collectGarbage();
    }
    expect(updated).toBe(1);
    expect(ref.deref()).toBeUndefined();
  });

  it("refuse bars without both ends", () => {
    const { source } = synthetic(10);
    expect(() => remote(source, { columns: [{ field: "v", cell: barCell() }] })).toThrow(
      "remote grid columns[0].cell: a bar's ends come from every row, which a remote grid does not hold; give domain, or fields.v min and max",
    );
  });

  it("match rows by their refs' scope and id: kept as blocks reload, new after a query", async () => {
    const memory = memorySource(
      table({
        id: Float64Array.from({ length: 2000 }, (_, i) => i),
        v: Float64Array.from({ length: 2000 }, (_, i) => (i * 7919) % 1000),
      }),
      { key: "id" },
    );
    const { contexts, renderer } = counting();
    const { model, grid } = remote(memory, {
      columns: [{ field: "id" }, { field: "v" }],
      cells: { v: renderer },
      blockSize: 50,
      cachedBlocks: 1,
    });
    const first = () =>
      contexts.findLast((context) => context.text === "0" && context.rowIndex === 0);
    await until(() => first() !== undefined);
    const before = first()!.row.ref;
    // Each context's ref is its own: a scope and an id, no more.
    expect(Object.keys(before)).toEqual(["scope", "id"]);
    // Its second block too: the cache drops a block only once two are out of
    // view, so with the second still loading the first would stay.
    await until(() => model.row(50).kind === "row");
    // Far away and back: the first block was evicted and loaded again, its rows the same rows.
    model.scrollTo({ top: ROW * 1500 });
    // The first block goes once the new window's blocks have loaded, which
    // may be after row 1500's own block.
    await until(() => model.row(1500).kind === "row" && model.row(0).kind === "placeholder");
    const seen = contexts.length;
    model.scrollTo({ top: 0 });
    await until(
      () => contexts.length > seen && model.row(0).kind === "row" && first() !== contexts[0],
    );
    const again = first()!.row.ref;
    expect([again.scope, again.id]).toEqual([before.scope, before.id]);
    // Another query's rows are other rows, though their ids are the same.
    model.setQuery({ sort: [{ field: "v", order: "descending" }] });
    await until(() => contexts.at(-1)!.row.ref.scope !== before.scope);
    grid.render();
    expect(cellAt(grid, 0, 2).textContent).toBe("<999>");
  });

  it("find rows by contexts' refs", async () => {
    const { source } = synthetic(1000);
    const { contexts, renderer } = counting();
    const { model } = remote(source, {
      columns: [{ field: "id" }, { field: "v" }],
      cells: { v: renderer },
    });
    await until(() => contexts.some((context) => context.rowIndex === 3));
    const ref = contexts.findLast((context) => context.rowIndex === 3)!.row.ref;
    expect(model.indexOf(ref)).toBe(3);
    model.setQuery({ sort: [{ field: "v", order: "descending" }] });
    expect(model.indexOf(ref)).toBe(-1);
  });

  it("let go of every block, and of the grid and model, though renderers keep their contexts", async () => {
    const { source, answered } = synthetic(100_000);
    const kept: GridCellContext[] = [];
    const renderer = {
      create: (host: HTMLElement) => ({
        update(cell: GridCellContext) {
          kept.push(cell);
          host.textContent = cell.text;
        },
      }),
    };
    const settings = { columns: [{ field: "id" }, { field: "v" }], blockSize: 50, cachedBlocks: 2 };
    // A disposed model a test (or a framework's state) still holds lets go of its blocks.
    const held = remote(source, { ...settings, cells: { v: renderer } });
    await until(() => kept.length > 0);
    held.grid.destroy();
    held.model.dispose();
    const refs = await (async () => {
      const { model, grid } = remote(source, { ...settings, cells: { v: renderer } }, false);
      await until(
        () => model.row(0).kind === "row" && kept.at(-1)!.row.ref.scope !== kept[0]!.row.ref.scope,
      );
      // A new query, then far away: the first query's blocks go, and the first blocks are evicted.
      model.setQuery({ sort: [{ field: "v", order: "descending" }] });
      await until(() => model.row(0).kind === "row");
      for (const top of [ROW * 20_000, ROW * 60_000]) {
        model.scrollTo({ top });
        await until(() => model.row(Math.floor(top / ROW)).kind === "row");
      }
      grid.destroy();
      model.dispose();
      return { grid: new WeakRef(grid), model: new WeakRef(model) };
    })();
    expect(kept.length).toBeGreaterThan(0);
    // Read only after collecting: `deref` keeps what it returns until the page's task ends.
    for (let i = 0; i < 3; i++) {
      await frame();
      await collectGarbage();
    }
    expect(answered.filter((ref) => ref.deref() !== undefined)).toEqual([]);
    expect([refs.grid.deref(), refs.model.deref()]).toEqual([undefined, undefined]);
    expect(kept.at(-1)!.text).not.toBe("");
  });
});

describe("contexts kept", () => {
  it("hold no table of a linked column once the grid and model go", async () => {
    const kept: GridCellContext[] = [];
    const table = await (async () => {
      const data = services();
      const view = rowView(data);
      const model = createGridModel({
        data: view,
        columns: [{ field: "id" }, { field: "service" }],
        fields: { service: { link: { url: ["/s/", { value: true }] } } },
      });
      const grid = createGrid(place(), {
        model,
        ariaLabel: "Cells",
        cells: {
          id: {
            fields: ["latency"],
            create: () => ({
              update(cell) {
                kept.push(cell);
              },
            }),
          },
        },
      });
      grid.destroy();
      model.dispose();
      view.dispose();
      return new WeakRef(data);
    })();
    expect(kept.length).toBeGreaterThan(0);
    for (let i = 0; i < 3; i++) {
      await frame();
      await collectGarbage();
    }
    expect(table.deref()).toBeUndefined();
    expect(Object.keys(kept[0]!.column).sort()).toEqual([
      "align",
      "field",
      "headings",
      "id",
      "kind",
      "pinned",
      "title",
      "width",
      "x",
    ]);
  });
});

describe("grids without cells", () => {
  it("draw text cells as plain text, holding nothing", () => {
    const model = createGridModel({
      data: rowView(services()),
      columns: [{ field: "id" }, { field: "service" }, { field: "latency" }],
    });
    const grid = mount(model);
    const cells = [...grid.root.querySelectorAll<HTMLElement>(".hg-body [role=gridcell]")];
    expect(cells.length).toBeGreaterThan(0);
    // Each cell holds its text node and nothing else, as before cells could hold more.
    expect(
      cells.every(
        (cell) => cell.childNodes.length === 1 && cell.firstChild!.nodeType === Node.TEXT_NODE,
      ),
    ).toBe(true);
    expect(
      cells.some((cell) => cell.hasAttribute("aria-label") || cell.hasAttribute("data-cell")),
    ).toBe(false);
    // The grid's stylesheet alone: kinds bring theirs as their cells mount.
    expect(grid.root.querySelectorAll("style")).toHaveLength(1);
  });
});
