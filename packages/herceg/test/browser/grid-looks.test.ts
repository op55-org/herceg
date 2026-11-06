// Grid looks in the page: cells' fills and text colors, text over a fill in
// black or white by WCAG contrast with what it lands on (the fill over the
// surface, under the selection's tint in selected rows), palette places in
// the theme's colors, repainting as domains move, pinned cells, forced
// colors, and grids without looks drawn as before.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { afterEach, describe, expect, it } from "vitest";
import { commands } from "vitest/browser";
import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { createGrid, type Grid, type GridOptions } from "../../src/dom/grid.ts";
import { createGridModel, type GridColumn, type GridModel } from "../../src/grid/model.ts";
import { resolveTheme } from "../../src/theme.ts";
import "./helpers.ts";

const hosts: HTMLElement[] = [];
const grids: { destroy(): void }[] = [];
afterEach(async () => {
  for (const grid of grids.splice(0)) grid.destroy();
  for (const host of hosts.splice(0)) host.remove();
});

function mount<S extends Schema>(model: GridModel<S>, options: Partial<GridOptions<S>> = {}) {
  const element = document.createElement("div");
  element.style.cssText = "width:600px;height:400px";
  document.body.append(element);
  hosts.push(element);
  const grid = createGrid(element, { model, ariaLabel: "Looks", ...options });
  grids.push(grid);
  return grid;
}

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Fills to test, as [red, green, blue, alpha] (0 to 255, alpha 0 to 1). */
const FILLS: readonly (readonly [number, number, number, number])[] = [
  [0x00, 0x6e, 0xff, 1], // saturated blue, just light enough for black text
  [0x75, 0x75, 0x75, 1], // gray just under the crossover: white text
  [0x76, 0x76, 0x76, 1], // and just over it: black text
  [0xff, 0xeb, 0x3b, 1],
  [0x15, 0x65, 0xc0, 1],
  [0x00, 0x00, 0x00, 0.5], // translucent: what shows depends on the surface
  [0xc6, 0x28, 0x28, 0.3],
];

const css = ([r, g, b, a]: readonly number[]) => `rgb(${r} ${g} ${b} / ${a})`;

/** One row per fill, its fill given as a field of colors. */
function filled<S extends Schema = Schema>(
  extra: Partial<Parameters<typeof createGridModel>[0]> = {},
) {
  const t = table({
    id: Float64Array.from(FILLS, (_, i) => i),
    paint: category(FILLS.map(css)),
  });
  return createGridModel({
    data: rowView(t),
    columns: [
      { field: "id", width: 120 },
      {
        field: "paint",
        width: 200,
        encode: { fill: { field: "paint", scale: { type: "identity" } } },
      },
    ],
    ...extra,
  } as never) as unknown as GridModel<S>;
}

const cellOf = (grid: Grid<Schema>, row: number, column: number) =>
  grid.root.querySelector<HTMLElement>(
    `.hg-body [aria-rowindex="${row + 2}"] [aria-colindex="${column + 1}"]`,
  )!;

/** A computed color's red, green, and blue, 0 to 1 (black and white read alike in every space). */
function channelsOf(color: string): number[] {
  const numbers = color.match(/-?[\d.]+(?:e-?\d+)?/g)!.map(Number);
  return color.startsWith("color(") ? numbers.slice(0, 3) : numbers.slice(0, 3).map((n) => n / 255);
}

/** Whether a computed text color is black or white, or neither. */
function inkOf(color: string): "black" | "white" | string {
  const [r, g, b] = channelsOf(color);
  if (r === 0 && g === 0 && b === 0) return "black";
  if (r === 1 && g === 1 && b === 1) return "white";
  return color;
}

/** WCAG's relative luminance of sRGB channels from 0 to 1. */
function luminance([r, g, b]: readonly number[]): number {
  const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear(r!) + 0.7152 * linear(g!) + 0.0722 * linear(b!);
}

/** The text WCAG contrast picks on `under`: black where it contrasts more, else white. */
function expectedInk(under: readonly number[]): "black" | "white" {
  const l = luminance(under);
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? "black" : "white";
}

/** The theme's channels the stylesheet reads, from the grid's root: the surface's or the accent's. */
const themeChannels = (grid: Grid<Schema>, prefix: "s" | "a") =>
  ["r", "g", "b"].map((c) => Number(grid.root.style.getPropertyValue(`--hg-${prefix}${c}`)));

/**
 * What a fill shows over: composited over the surface, and when selected
 * under the selection's tint, the accent at `--hg-tint`'s opacity.
 */
function under(grid: Grid<Schema>, fill: readonly number[], selected: boolean): number[] {
  const surface = themeChannels(grid, "s");
  const alpha = fill[3]!;
  const over = [0, 1, 2].map((i) => (fill[i]! / 255) * alpha + surface[i]! * (1 - alpha));
  if (!selected) return over;
  const accent = themeChannels(grid, "a");
  const tint = Number(grid.root.style.getPropertyValue("--hg-tint"));
  return over.map((c, i) => c * (1 - tint) + accent[i]! * tint);
}

describe("grid looks in the page", () => {
  for (const theme of ["light", "dark"] as const)
    it(`write text over a fill in black or white, whichever contrasts more (${theme})`, () => {
      const grid = mount(filled(), { theme }) as unknown as Grid<Schema>;
      FILLS.forEach((fill, row) => {
        const cell = cellOf(grid, row, 1);
        expect(cell.dataset.look).toBe("fill");
        expect(cell.style.getPropertyValue("--hg-look-fill")).toBe(css(fill));
        // Fills the grid reads take inks it worked out, not the page's relative colors.
        expect(cell.style.getPropertyValue("--hg-look-ink")).toMatch(/^#(000000|ffffff)$/);
        expect(inkOf(getComputedStyle(cell).color), css(fill)).toBe(
          expectedInk(under(grid, fill, false)),
        );
      });
    });

  it("pick black for the saturated blue and across the gray crossover as WCAG does", () => {
    const grid = mount(filled(), { theme: "light" }) as unknown as Grid<Schema>;
    const ink = (row: number) => inkOf(getComputedStyle(cellOf(grid, row, 1)).color);
    expect([ink(0), ink(1), ink(2)]).toEqual(["black", "white", "black"]);
  });

  it("contrast text with the selection's tint over a fill in selected rows", async () => {
    const model = filled();
    const grid = mount(model, { theme: "light" }) as unknown as Grid<Schema>;
    model.selectAll();
    await frame();
    let flipped = 0;
    FILLS.forEach((fill, row) => {
      const cell = cellOf(grid, row, 1);
      expect(cell.closest("[role=row]")!.getAttribute("data-selection")).toBe("all");
      // The tint over the fill over the surface.
      expect(getComputedStyle(cell).backgroundImage.match(/gradient/g)).toHaveLength(2);
      const selected = expectedInk(under(grid, fill, true));
      expect(inkOf(getComputedStyle(cell).color), css(fill)).toBe(selected);
      if (selected !== expectedInk(under(grid, fill, false))) flipped++;
    });
    // The tint moves at least one fill across the crossover (the gray just over it).
    expect(flipped).toBeGreaterThan(0);
  });

  it("tint selected rows by a translucent accent's opacity, in both inks", async () => {
    // A gray black text suits under black at 8% (the accent's half of 16%), not under black at 16%.
    document.documentElement.style.setProperty("--test-gray", "#858585");
    try {
      const t = table({ id: [1], paint: category(["#858585"]) });
      const model = createGridModel({
        data: rowView(t),
        columns: [
          { field: "id", encode: { fill: { value: "var(--test-gray)" } } },
          { field: "paint", encode: { fill: { field: "paint", scale: { type: "identity" } } } },
        ],
      });
      const grid = mount(model, {
        theme: { tokens: { palette: ["rgb(0 0 0 / 0.5)"] } },
      }) as unknown as Grid<Schema>;
      expect(grid.root.style.getPropertyValue("--hg-tint")).toBe("0.08");
      model.selectAll();
      await frame();
      const page = cellOf(grid, 0, 0);
      const read = cellOf(grid, 0, 1);
      expect(page.style.getPropertyValue("--hg-look-ink-selected")).toMatch(/^color\(from /);
      expect(read.style.getPropertyValue("--hg-look-ink-selected")).toBe("#000000");
      expect(inkOf(getComputedStyle(page).color)).toBe("black");
      expect(inkOf(getComputedStyle(read).color)).toBe("black");
    } finally {
      document.documentElement.style.removeProperty("--test-gray");
    }
  });

  it("take a given text color over the contrast's", () => {
    const grid = mount(
      filled({ encode: { color: { value: "#ff0000" } } }) as GridModel<Schema>,
    ) as unknown as Grid<Schema>;
    const cell = cellOf(grid, 0, 1);
    expect(cell.dataset.look).toBe("fill color");
    expect(getComputedStyle(cell).color).toBe("rgb(255, 0, 0)");
    // Cells without a fill take the color too.
    expect(getComputedStyle(cellOf(grid, 0, 0)).color).toBe("rgb(255, 0, 0)");
  });

  it("follow fills given as the page's variables", () => {
    document.documentElement.style.setProperty("--test-brand", "#101010");
    try {
      const t = table({ id: [1] });
      const grid = mount(
        createGridModel({
          data: rowView(t),
          columns: [{ field: "id", encode: { fill: { value: "var(--test-brand)" } } }],
        }),
      );
      const cell = grid.root.querySelector<HTMLElement>("[role=gridcell]")!;
      expect(cell.style.getPropertyValue("--hg-look-ink")).toMatch(/^color\(from /);
      expect(inkOf(getComputedStyle(cell).color)).toBe("white");
      document.documentElement.style.setProperty("--test-brand", "#f0f0f0");
      expect(inkOf(getComputedStyle(cell).color)).toBe("black");
    } finally {
      document.documentElement.style.removeProperty("--test-brand");
    }
  });

  it("fill currentColor with the grid's text color, which the ink contrasts with", () => {
    const t = table({ id: [1], n: [2] });
    const grid = mount(
      createGridModel({
        data: rowView(t),
        columns: [
          { field: "id", encode: { fill: { value: "currentColor" } } },
          { field: "n", encode: { fill: { value: " CurrentColor " } } },
        ],
      }),
      { theme: "light" },
    ) as unknown as Grid<Schema>;
    for (const column of [0, 1]) {
      const cell = cellOf(grid, 0, column);
      expect(cell.style.getPropertyValue("--hg-look-fill")).toBe("var(--hg-text)");
      const style = getComputedStyle(cell);
      // The light theme's text is dark, so the fill is too, and the text over it white.
      expect(style.backgroundImage).toContain(getComputedStyle(grid.root).color);
      expect(inkOf(style.color)).toBe("white");
    }
  });

  it("paint fills over a translucent surface taken over the page, white under dark text", async () => {
    document.documentElement.style.setProperty("--test-clear", "transparent");
    try {
      const t = table({ id: [1], paint: category(["rgb(0 0 0 / 0)"]) });
      const model = createGridModel({
        data: rowView(t),
        columns: [
          { field: "id", encode: { fill: { value: "var(--test-clear)" } } },
          { field: "paint", encode: { fill: { field: "paint", scale: { type: "identity" } } } },
        ],
      });
      const grid = mount(model, {
        theme: { tokens: { background: "rgb(0 0 0 / 0.4)" } },
      }) as unknown as Grid<Schema>;
      // Black at 40% over white, once: a gray (153) black text suits, which fills are painted over.
      expect(Number(grid.root.style.getPropertyValue("--hg-sr"))).toBeCloseTo(0.6, 5);
      expect(cellOf(grid, 0, 1).style.getPropertyValue("--hg-look-ink")).toBe("#000000");
      for (const column of [0, 1]) {
        const style = getComputedStyle(cellOf(grid, 0, column));
        expect(style.backgroundColor).toBe("rgb(153, 153, 153)");
        expect(inkOf(style.color)).toBe("black");
      }
      // Selected: the tint over the same opaque gray.
      model.selectAll();
      await frame();
      for (const column of [0, 1]) {
        const style = getComputedStyle(cellOf(grid, 0, column));
        expect(style.backgroundColor).toBe("rgb(153, 153, 153)");
        expect(inkOf(style.color)).toBe(expectedInk(under(grid, [0, 0, 0, 0], true)));
      }
    } finally {
      document.documentElement.style.removeProperty("--test-clear");
    }
  });

  it("leave the page to read colors the grid would read differently", () => {
    // 90 degrees, a yellow green black text suits; read as 0.25 degrees, a red white text would.
    const t = table({ paint: category(["hsl(0.25turn 100% 40%)"]) });
    const grid = mount(
      createGridModel({
        data: rowView(t),
        columns: [
          { field: "paint", encode: { fill: { field: "paint", scale: { type: "identity" } } } },
        ],
      }),
    );
    const cell = grid.root.querySelector<HTMLElement>("[role=gridcell]")!;
    expect(cell.style.getPropertyValue("--hg-look-ink")).toMatch(/^color\(from /);
    expect(inkOf(getComputedStyle(cell).color)).toBe("black");
  });

  it("paint palette places in the theme's palette, again when the theme changes", () => {
    const t = table({ host: category(["web", "api", "db"]) });
    const grid = mount(
      createGridModel({
        data: rowView(t),
        columns: [{ field: "host", encode: { fill: { field: "host", scale: "hosts" } } }],
        scales: { hosts: { type: "ordinal" } },
      }),
    );
    const fills = () =>
      [...grid.root.querySelectorAll<HTMLElement>("[role=gridcell]")].map((cell) =>
        cell.style.getPropertyValue("--hg-look-fill"),
      );
    expect(fills()).toEqual(resolveTheme("light").palette.slice(0, 3));
    grid.update({ theme: "dark" });
    grid.render();
    expect(fills()).toEqual(resolveTheme("dark").palette.slice(0, 3));
  });

  it("repaint cells in view as streaming rows move a gradient's domain", async () => {
    const t = table({ ms: [0, 50, 100] });
    const grid = mount(
      createGridModel({
        data: rowView(t),
        columns: [{ field: "ms", encode: { fill: { field: "ms", scale: "heat" } } }],
        scales: { heat: { type: "linear", range: ["#ffffff", "#ff0000"] } },
      }),
    );
    const fill = (row: number) =>
      cellOf(grid as unknown as Grid<Schema>, row, 0).style.getPropertyValue("--hg-look-fill");
    expect(fill(2)).toBe("#ff0000");
    t.append({ ms: [200] });
    await frame();
    await frame();
    // 100 is halfway now; the new row is the reddest.
    expect(fill(2)).toBe("#ff7f7f");
    expect(fill(3)).toBe("#ff0000");
  });

  it("paint pinned cells' fills over the surface", () => {
    const t = table({ id: [1, 2], ms: [10, 90] });
    const grid = mount(
      createGridModel({
        data: rowView(t),
        columns: [
          { field: "id", pin: "left", encode: { fill: { value: "rgb(0 0 255 / 0.5)" } } },
          { field: "ms" },
        ],
      }),
    );
    const pinned = cellOf(grid as unknown as Grid<Schema>, 0, 0);
    const style = getComputedStyle(pinned);
    expect(style.position).toBe("sticky");
    expect(style.backgroundImage).toMatch(/gradient/);
    // Opaque under the fill: rows scrolling under a pinned cell stay hidden.
    expect(channelsOf(style.backgroundColor)).toEqual(
      themeChannels(grid as unknown as Grid<Schema>, "s"),
    );
  });

  it("drop looks for the system's colors under forced colors", async (context) => {
    const grid = mount(filled(), { theme: "light" }) as unknown as Grid<Schema>;
    if (!(await commands.forcedColors(true))) {
      await commands.forcedColors(false);
      context.skip("this engine emulates no forced colors");
    }
    try {
      const looked = getComputedStyle(cellOf(grid, 0, 1));
      const plain = getComputedStyle(cellOf(grid, 0, 0));
      expect(looked.backgroundImage).toBe("none");
      expect(looked.color).toBe(plain.color);
    } finally {
      await commands.forcedColors(false);
    }
  });

  it("draw grids without looks as before: no look attributes or properties", () => {
    const t = table({ id: [1, 2], host: category(["web", "api"]) });
    const columns: GridColumn<{ id: "number"; host: "category" }>[] = [
      { field: "id" },
      { field: "host" },
    ];
    const grid = mount(
      createGridModel({ data: rowView(t as Table<{ id: "number"; host: "category" }>), columns }),
    );
    const cells = [...grid.root.querySelectorAll<HTMLElement>("[role=gridcell]")];
    expect(cells).toHaveLength(4);
    for (const cell of cells) {
      expect(cell.hasAttribute("data-look")).toBe(false);
      expect(cell.getAttribute("style")).not.toMatch(/--hg-look/);
      expect(getComputedStyle(cell).backgroundImage).toBe("none");
    }
  });

  it("clear a cell's look where a condition stops holding", async () => {
    const t = table({ ms: [10, 90] });
    const view = rowView(t);
    const grid = mount(
      createGridModel({
        data: view,
        columns: [
          {
            field: "ms",
            encode: { fill: { condition: { when: col("ms").gt(50), then: "#ff0000" } } },
          },
        ],
      }),
    );
    const cell = () => cellOf(grid as unknown as Grid<Schema>, 0, 0);
    expect(cell().hasAttribute("data-look")).toBe(false);
    t.replace(0, { ms: [70] });
    await frame();
    await frame();
    expect(cell().dataset.look).toBe("fill");
    t.replace(0, { ms: [20] });
    await frame();
    await frame();
    expect(cell().hasAttribute("data-look")).toBe(false);
    expect(cell().style.getPropertyValue("--hg-look-fill")).toBe("");
  });
});
