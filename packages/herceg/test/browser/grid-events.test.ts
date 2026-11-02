// What a grid reports: clicks on rows and cells, naming rows by identity
// wherever sorting and filtering move them, and each frame it draws; and
// what a plain click on the row selected does (`selection.click`).
import { afterEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { col } from "../../src/data/expr.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { createGrid, type Grid, type GridEvents } from "../../src/dom/grid.ts";
import { createGridModel, type GridSelectionOptions } from "../../src/grid/model.ts";

const hosts: HTMLElement[] = [];
const grids: { destroy(): void }[] = [];
afterEach(() => {
  for (const grid of grids.splice(0)) grid.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

const services = () =>
  table({
    id: [0, 1, 2, 3, 4, 5],
    ms: [50, 10, 40, 30, 60, 20],
    host: ["web", "api", "web", "db", "api", "db"],
  });

function mount(selection?: GridSelectionOptions) {
  const t = services();
  const data = rowView(t);
  const model = createGridModel({
    data,
    columns: [{ field: "id" }, { field: "ms" }, { field: "host" }],
    ...(selection && { selection }),
  });
  const element = document.createElement("div");
  element.style.cssText = "width:400px;height:300px";
  document.body.append(element);
  hosts.push(element);
  const grid = createGrid(element, { model, ariaLabel: "Services" });
  grids.push(grid);
  return { t, data, grid };
}

/** A grid of any schema, as the helpers read it. */
type Mounted = Pick<Grid, "on" | "root">;

function heard<K extends keyof GridEvents>(grid: Mounted, type: K): GridEvents[K][] {
  const events: GridEvents[K][] = [];
  grid.on(type, (event) => events.push(event));
  return events;
}

/** The cell of column `column` in the row at `rowIndex`. */
const cellAt = (grid: Mounted, rowIndex: number, column: number) =>
  grid.root.querySelector<HTMLElement>(
    `.hg-body [aria-rowindex="${rowIndex + 2}"] [aria-colindex="${column + 1}"]`,
  )!;

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

describe("grid clicks", () => {
  it("name the row by its identity, wherever sorting and filtering move it", async () => {
    const { t, data, grid } = mount();
    const rows = heard(grid, "rowClick");
    const cells = heard(grid, "cellClick");
    const order: string[] = [];
    grid.on("rowClick", () => order.push("row"));
    grid.on("cellClick", () => order.push("cell"));
    let selectedThen: boolean | undefined;
    grid.on("rowClick", ({ rowIndex }) => (selectedThen = grid.model.isSelected(rowIndex)));
    await userEvent.click(cellAt(grid, 3, 1));
    // Row 3 (id 3), as its table names it.
    const first = rows[0]!;
    expect(first).toMatchObject({ rowIndex: 3, column: "ms", cause: "pointer" });
    expect(first.ref.id).toBe(t.identity(3));
    expect(cells).toEqual(rows);
    expect(order).toEqual(["row", "cell"]);
    // The click had selected it by then.
    expect(selectedThen).toBe(true);
    // Sorted by latency, id 3 (30 ms) is the fourth row; filtered to
    // latencies over 25 ms, the second.
    grid.model.setSort([{ field: "ms" }]);
    await frame();
    await userEvent.click(cellAt(grid, 2, 0));
    data.setQuery({ filter: col("ms").gt(25), sort: [{ field: "ms" }] });
    await frame();
    await userEvent.click(cellAt(grid, 0, 2));
    expect(rows.slice(1).map(({ ref, rowIndex, column }) => [ref.id, rowIndex, column])).toEqual([
      [first.ref.id, 2, "id"],
      [first.ref.id, 0, "host"],
    ]);
  });

  it("report Enter on a cell as a click from the keyboard, which selects nothing", async () => {
    const { grid } = mount();
    const cells = heard(grid, "cellClick");
    grid.focusCell(4, "host");
    await userEvent.keyboard("{Enter}");
    expect(cells).toMatchObject([{ rowIndex: 4, column: "host", cause: "keyboard" }]);
    expect(grid.model.selectedCount).toBe(0);
  });

  it("leave out header clicks", async () => {
    const { grid } = mount();
    const rows = heard(grid, "rowClick");
    const header = grid.root.querySelector<HTMLElement>("[role=columnheader]")!;
    await userEvent.click(header);
    expect(grid.model.sort).toEqual([{ field: "id", order: "ascending" }]);
    expect(rows).toEqual([]);
  });

  it("are reported for a row the click's selection filtered out, at index -1", async () => {
    const { data, grid } = mount();
    const rows = heard(grid, "rowClick");
    // Selecting a row shows only the others.
    grid.model.selectionStore.subscribe(() => data.setQuery({ filter: col("ms").gt(1000) }));
    await userEvent.click(cellAt(grid, 2, 0));
    expect(rows).toMatchObject([{ rowIndex: -1, column: "id", cause: "pointer" }]);
  });

  it("reach no one once a listener destroyed the grid", async () => {
    const { grid } = mount();
    const cells = heard(grid, "cellClick");
    grid.on("rowClick", () => grid.destroy());
    await userEvent.click(cellAt(grid, 1, 0));
    expect(cells).toEqual([]);
  });

  it("go on to the other listeners when one throws", async () => {
    const { grid } = mount();
    const errors: unknown[] = [];
    const onError = (event: ErrorEvent) => {
      errors.push(event.error);
      event.preventDefault();
    };
    window.addEventListener("error", onError);
    try {
      grid.on("rowClick", () => {
        throw new Error("listener");
      });
      const cells = heard(grid, "cellClick");
      await userEvent.click(cellAt(grid, 1, 0));
      expect(cells).toHaveLength(1);
      await expect.poll(() => errors.length).toBe(1);
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});

describe("grid render events", () => {
  it("report each frame drawn, as of the model's revision", async () => {
    const { t, grid } = mount();
    const frames = heard(grid, "render");
    grid.model.select(1);
    grid.render();
    expect(frames.at(-1)).toEqual({ revision: grid.model.revision });
    const drawn = frames.length;
    t.append({ id: [6], ms: [5], host: ["web"] });
    await frame();
    expect(frames.length).toBe(drawn + 1);
    expect(frames.at(-1)!.revision).toBe(grid.model.revision);
    // Nothing changed, nothing drawn.
    await frame();
    expect(frames.length).toBe(drawn + 1);
  });

  it("report a change made as a frame draws with the next frame, which draws it", async () => {
    const { t, grid } = mount();
    const frames = heard(grid, "render");
    let once = true;
    grid.root.addEventListener("focusin", () => {
      if (once) t.append({ id: [6], ms: [5], host: ["web"] });
      once = false;
    });
    grid.focusCell(1, "ms");
    expect(frames.at(-1)!.revision).toBeLessThan(grid.model.revision);
    expect(grid.drawnRevision).toBe(frames.at(-1)!.revision);
    await frame();
    expect(frames.at(-1)!.revision).toBe(grid.model.revision);
    expect(grid.root.querySelectorAll(".hg-body [role=row]")).toHaveLength(7);
  });
});

describe("grid selection by click", () => {
  it("keeps the row selected on a second click by default, and clears it with toggle", async () => {
    for (const click of ["only", "toggle"] as const) {
      const { grid } = mount({ click });
      const rows = heard(grid, "rowClick");
      await userEvent.click(cellAt(grid, 2, 0));
      await userEvent.click(cellAt(grid, 2, 0));
      expect(grid.model.selectedCount, click).toBe(click === "only" ? 1 : 0);
      expect(rows, click).toHaveLength(2);
    }
  });
});
