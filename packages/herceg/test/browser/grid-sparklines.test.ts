// Sparklines in the page: each row's path in its cell and what a screen
// reader reads of it, their color, redraws as the data changes (that
// column's cells alone) and as the column resizes, high and low pixel
// ratios, scrolling, group rows, forced colors, and what is let go of with
// the grid and the model.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { category, time } from "../../src/data/column.ts";
import { groupRows } from "../../src/data/groups.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Table, table } from "../../src/data/table.ts";
import { createGridModel, type GridModel, sparklineCell } from "../../src/grid/model.ts";
import { createGrid, type GridCellRenderer } from "../../src/grid.ts";
import { collectGarbage } from "./helpers.ts";

const hosts: HTMLElement[] = [];
const grids: { destroy(): void }[] = [];
const models: { dispose(): void }[] = [];
afterEach(() => {
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

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const frames = async (count = 2) => {
  for (let i = 0; i < count; i++) await frame();
};

/** The request log of the design's example: web's (0, 100), (5, 0), (10, 100); api's (1, 3), (6, 900). */
const requests = () =>
  table({
    service: category(["web", "api", "web", "api", "web"]),
    time: time([0, 1, 5, 6, 10]),
    latency: [100, 3, 0, 900, 100],
  });

/** A grid of `rows` (services by default) with a sparkline column `trend` of `options` over `data`. */
async function mount(
  data: unknown = requests(),
  options: Record<string, unknown> = {},
  {
    rows = table({ service: category(["web", "api", "db"]) }),
    column = {},
    cells,
  }: {
    rows?: unknown;
    column?: Record<string, unknown>;
    cells?: Record<string, GridCellRenderer>;
  } = {},
) {
  const model = createGridModel({
    data: rowView(rows as Table),
    locale: "en-US",
    columns: [
      { field: "service" },
      {
        id: "trend",
        width: 116,
        cell: sparklineCell({ data, key: "service", x: "time", y: "latency", ...options } as never),
        ...column,
      },
    ],
  } as never) as GridModel;
  models.push(model);
  const grid = createGrid(place(), { model, ariaLabel: "Services", ...(cells && { cells }) });
  grids.push(grid);
  await frames();
  return { model, grid };
}

/** The mounted sparkline cells, in row order. */
const sparklines = (grid: { root: HTMLElement }) =>
  [...grid.root.querySelectorAll<HTMLElement>(".hg-body [role=row]")]
    .sort(
      (a, b) => Number(a.getAttribute("aria-rowindex")) - Number(b.getAttribute("aria-rowindex")),
    )
    .map((row) => row.querySelector<HTMLElement>('[aria-colindex="2"]')!);

const d = (cell: HTMLElement, part = "line") =>
  cell.querySelector(`.hg-spark-${part}`)?.getAttribute("d") ?? null;

describe("sparklines", () => {
  it("draw each row's series in one path, named by its summary", async () => {
    const { grid } = await mount();
    const cells = sparklines(grid);
    expect(cells.map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "3 values, 0 to 100, last 100",
      "2 values, 3 to 900, last 900",
      "No values",
    ]);
    expect(cells.map((cell) => d(cell))).toEqual(["M0 1.5L50 17.5L100 1.5", "M10 17.5L60 1.5", ""]);
    // The svg fills the cell inside its padding, 116 - 16 by 28 - 9, hidden from screen readers.
    const svg = cells[0]!.querySelector("svg")!;
    expect([svg.getAttribute("width"), svg.getAttribute("height")]).toEqual(["100", "19"]);
    expect(svg.getAttribute("aria-hidden")).toBe("true");
    const box = svg.getBoundingClientRect();
    const cell = cells[0]!.getBoundingClientRect();
    expect([box.left - cell.left, box.top - cell.top, box.width, box.height]).toEqual([
      8, 4, 100, 19,
    ]);
    // The text names the cell; it is not written in it.
    expect(cells[0]!.textContent).toBe("");
    expect(cells[0]!.dataset.cell).toBe("sparkline");
  });

  it("draw in the theme's accent, or in the column's color look", async () => {
    const rows = table({ service: category(["web", "api"]), status: category(["ok", "down"]) });
    const { grid } = await mount(
      requests(),
      {},
      {
        rows,
        column: {
          encode: {
            color: { condition: { when: ["==", ["field", "status"], "down"], then: "#c62828" } },
          },
        },
      },
    );
    const [web, api] = sparklines(grid);
    const stroke = (cell: HTMLElement) =>
      getComputedStyle(cell.querySelector(".hg-spark-line")!).stroke;
    const accent = getComputedStyle(grid.root).getPropertyValue("--hg-accent").trim();
    expect(web!.querySelector("svg")!.style.getPropertyValue("--hg-spark-color")).toBe("");
    expect(stroke(web!)).not.toBe("none");
    expect(accent).not.toBe("");
    expect(stroke(api!)).toBe("rgb(198, 40, 40)");
  });

  it("fill areas under their line", async () => {
    const { grid } = await mount(requests(), { mark: "area" });
    const [web] = sparklines(grid);
    expect(d(web!, "area")).toBe("M0 1.5L50 17.5L100 1.5L100 17.5L0 17.5Z");
    expect(d(web!)).toBe("M0 1.5L50 17.5L100 1.5");
    expect(getComputedStyle(web!.querySelector(".hg-spark-area")!).fillOpacity).toBe("0.25");
  });

  it("draw again as their data changes, their column's cells alone", async () => {
    const data = requests();
    const updates = { status: 0 };
    const rows = table({
      service: category(["web", "api", "db"]),
      status: category(["a", "b", "c"]),
    });
    const model = createGridModel({
      data: rowView(rows),
      locale: "en-US",
      columns: [
        { field: "status" },
        {
          id: "trend",
          width: 116,
          cell: sparklineCell({ data, key: "service", x: "time", y: "latency" }),
        },
      ],
    });
    models.push(model);
    const grid = createGrid(place(), {
      model,
      ariaLabel: "Services",
      cells: {
        status: {
          create(host) {
            return {
              update(cell) {
                updates.status++;
                host.textContent = cell.text;
              },
            };
          },
        },
      },
    });
    grids.push(grid);
    await frames();
    const before = updates.status;
    expect(before).toBe(3);
    data.append({ service: ["db", "db"], time: [10, 20], latency: [5, 9] });
    await frames();
    const cells = sparklines(grid);
    expect(cells[2]!.getAttribute("aria-label")).toBe("2 values, 5 to 9, last 9");
    expect(d(cells[2]!)).toBe("M50 17.5L100 1.5");
    // The window grew to 20: every row's line is drawn again over it.
    expect(d(cells[0]!)).toBe("M0 1.5L25 17.5L50 1.5");
    // The custom cells' rows did not change: they are not updated.
    expect(updates.status).toBe(before);
    data.reset({ service: category(["api"]), time: time([0]), latency: [5] });
    await frames();
    expect(sparklines(grid).map((cell) => cell.getAttribute("aria-label"))).toEqual([
      "No values",
      "1 value, 5",
      "No values",
    ]);
    expect(updates.status).toBe(before);
  });

  it("draw again as their column resizes", async () => {
    const { model, grid } = await mount();
    model.resizeColumn("trend", 216);
    await frames();
    const [web] = sparklines(grid);
    expect(web!.querySelector("svg")!.getAttribute("width")).toBe("200");
    expect(d(web!)).toBe("M0 1.5L100 17.5L200 1.5");
  });

  it("keep at most four points a device pixel, at high and low pixel ratios", async () => {
    const n = 20_000;
    const data = table({
      service: category(Array.from({ length: n }, () => "web")),
      time: time(Array.from({ length: n }, (_, i) => i)),
      latency: Float64Array.from({ length: n }, (_, i) =>
        i % 3 === 1 ? Number.NaN : Math.sin(i / 7),
      ),
    });
    const points = (cell: HTMLElement) => (d(cell)!.match(/[ML]/g) ?? []).length;
    const ratio = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    const counts: number[] = [];
    let moved = 0;
    try {
      for (const value of [1, 2, 0.5]) {
        Object.defineProperty(window, "devicePixelRatio", { value, configurable: true });
        const { grid } = await mount(data);
        counts.push(points(sparklines(grid)[0]!));
      }
      // A grid whose window moves to a display of another ratio draws to it in its next frame.
      const { grid } = await mount(data);
      Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
      grid.render();
      await frames();
      moved = points(sparklines(grid)[0]!);
    } finally {
      if (ratio) Object.defineProperty(window, "devicePixelRatio", ratio);
      else delete (window as { devicePixelRatio?: number }).devicePixelRatio;
    }
    const [one, two, half] = counts as [number, number, number];
    expect(moved).toBe(two);
    expect(one).toBeLessThanOrEqual(4 * 101);
    expect(two).toBeLessThanOrEqual(4 * 201);
    expect(two).toBeGreaterThan(one);
    expect(half).toBeLessThan(one);
  });

  it("follow their rows as cells are recycled by scrolling", async () => {
    const names = Array.from({ length: 1000 }, (_, i) => `s${i}`);
    const data = table({
      service: category(names.flatMap((name) => [name, name])),
      time: time(names.flatMap(() => [0, 10])),
      latency: names.flatMap((_, i) => [i, i + 1]),
    });
    const { grid } = await mount(data, {}, { rows: table({ service: category(names) }) });
    const scroller = grid.root.querySelector<HTMLElement>(".hg-scroller")!;
    scroller.scrollTop = 28 * 500;
    await frames(3);
    for (const row of grid.root.querySelectorAll<HTMLElement>(".hg-body [role=row]")) {
      const index = Number(row.getAttribute("aria-rowindex")) - 2;
      const cell = row.querySelector<HTMLElement>('[aria-colindex="2"]')!;
      expect(cell.getAttribute("aria-label")).toBe(
        `2 values, ${index} to ${index + 1}, last ${index + 1}`,
      );
      expect(d(cell)).toBe("M0 17.5L100 1.5");
    }
  });

  it("draw nothing on group rows, and draw again as rows return", async () => {
    const rows = table({ service: category(["web", "api"]), region: category(["eu", "eu"]) });
    const view = rowView(rows);
    const model = createGridModel({
      data: view,
      groups: groupRows(view, { by: ["region"] }),
      columns: [
        { field: "region" },
        {
          id: "trend",
          width: 116,
          cell: sparklineCell({ data: requests(), key: "service", x: "time", y: "latency" }),
        },
      ],
    });
    models.push(model);
    const grid = createGrid(place(), { model, ariaLabel: "Services" });
    grids.push(grid);
    await frames();
    const header = grid.root.querySelector<HTMLElement>(
      '.hg-body [aria-rowindex="2"] [aria-colindex="2"]',
    )!;
    expect(header.querySelector("svg")).toBeNull();
    model.setExpanded(["eu"], true);
    await frames();
    const row = grid.root.querySelector<HTMLElement>(
      '.hg-body [aria-rowindex="3"] [aria-colindex="2"]',
    )!;
    expect(row.getAttribute("aria-label")).toBe("3 values, 0 to 100, last 100");
    expect(d(row)).toBe("M0 1.5L50 17.5L100 1.5");
  });

  it("draw in the system's text color in forced colors", async (context) => {
    if (!(await commands.forcedColors(true))) {
      await commands.forcedColors(false);
      context.skip("this engine emulates no forced colors");
    }
    try {
      const { grid } = await mount(
        requests(),
        { mark: "area" },
        { column: { encode: { color: { value: "#c62828" } } } },
      );
      const [web] = sparklines(grid);
      const line = getComputedStyle(web!.querySelector(".hg-spark-line")!);
      const area = getComputedStyle(web!.querySelector(".hg-spark-area")!);
      const probe = document.createElement("span");
      probe.style.color = "CanvasText";
      grid.root.append(probe);
      const text = getComputedStyle(probe).color;
      probe.remove();
      expect(line.stroke).toBe(text);
      expect(area.fill).toBe(text);
    } finally {
      await commands.forcedColors(false);
    }
  });

  it("go with their grid and model, which their data keeps nothing of", async () => {
    const data = requests();
    let told = 0;
    const refs = (() => {
      const model = createGridModel({
        data: rowView(table({ service: category(["web"]) })),
        columns: [
          { id: "trend", cell: sparklineCell({ data, key: "service", x: "time", y: "latency" }) },
        ],
      });
      model.subscribe(() => told++);
      const grid = createGrid(place(), { model, ariaLabel: "Services" });
      model.textAt(0, 0);
      grid.destroy();
      model.dispose();
      return [new WeakRef(model), new WeakRef(grid)];
    })();
    told = 0;
    data.append({ service: ["web"], time: [20], latency: [1] });
    expect(told).toBe(0);
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(refs.map((ref) => ref.deref())).toEqual([undefined, undefined]);
    // Between an append and the next read, the index kept to extend holds
    // none of the arrays the append replaced.
    const growing = requests();
    const kept = createGridModel({
      data: rowView(table({ service: category(["web"]) })),
      columns: [
        {
          id: "trend",
          cell: sparklineCell({ data: growing, key: "service", x: "time", y: "latency" }),
        },
      ],
    });
    models.push(kept);
    expect(kept.textAt(0, 0)).toBe("3 values, 0 to 100, last 100");
    const before = new WeakRef(growing.numbers("latency").buffer);
    growing.append({ service: ["web"], time: [11], latency: [50] });
    await collectGarbage();
    expect(before.deref()).toBeUndefined();
    expect(kept.textAt(0, 0)).toBe("4 values, 0 to 100, last 50");
    // A model let go of without disposal is collected too, and its data's listener stops.
    const dropped = (() => {
      const model = createGridModel({
        data: rowView(table({ service: category(["web"]) })),
        columns: [
          { id: "trend", cell: sparklineCell({ data, key: "service", x: "time", y: "latency" }) },
        ],
      });
      model.textAt(0, 0);
      return new WeakRef(model);
    })();
    await frames();
    await collectGarbage();
    await frames();
    await collectGarbage();
    expect(dropped.deref()).toBeUndefined();
    data.append({ service: ["web"], time: [30], latency: [2] });
  });
});
