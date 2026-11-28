import "./interactive.ts";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type Table, table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import { rasterWork } from "../../src/draw/raster.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { heatmapUpdates } from "../../src/marks/heatmap-updates.ts";

const hosts: HTMLDivElement[] = [];
const host = () => {
  const element = document.createElement("div");
  element.style.cssText = "width:600px;height:300px";
  document.body.append(element);
  hosts.push(element);
  return element;
};

let seed = 1;
const random = () => {
  seed = (seed * 16_807) % 2_147_483_647;
  return (seed - 1) / 2_147_483_646;
};

beforeEach(() => {
  seed = 1;
});
afterEach(() => {
  for (const element of hosts.splice(0)) element.remove();
});

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// Patching loads on a heatmap's first change; loaded first, charts patch from theirs.
beforeAll(async () => {
  heatmapUpdates(true);
  while (!heatmapUpdates()) await frame();
});

type Cells = Table<{ x: "number"; y: "number"; v: "number" }>;

/** `columns` × `rows` cells, a row of the table each, column by column, as a stream writes them. */
const cells = (columns: number, rows: number, maxRows?: number): Cells =>
  table(
    {
      x: Float64Array.from({ length: columns * rows }, (_, i) => Math.floor(i / rows)),
      y: Float64Array.from({ length: columns * rows }, (_, i) => i % rows),
      v: Float64Array.from({ length: columns * rows }, () => random() * 100),
    },
    maxRows ? { maxRows } : {},
  ) as Cells;

const options = { x: "x", y: "y", color: "v", colorDomain: [0, 100] } as const;

const chartOf = (data: Cells, renderer: "canvas" | "svg" = "canvas") =>
  createChart(host(), {
    renderer,
    legend: false,
    animation: false,
    marks: [heatmap(data, options)],
  });

/** What a canvas chart shows, as RGBA. */
const shown = (chart: ReturnType<typeof createChart>) => {
  const canvas = chart.root.querySelector("canvas")!;
  return canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
};

/** The same chart drawn afresh from the rows `data` holds now. */
const afresh = (data: Cells, renderer: "canvas" | "svg" = "canvas") =>
  chartOf(
    table({
      x: Float64Array.from(data.numbers("x")),
      y: Float64Array.from(data.numbers("y")),
      v: Float64Array.from(data.numbers("v")),
    }) as Cells,
    renderer,
  );

describe("heatmaps patched on canvas", () => {
  it("put only the pixels of the cells a change touched, and none for a hover", async () => {
    // 256 × 128 cells, a pixel each: an image of 4 × 2 tiles of 64 × 64.
    const data = cells(256, 128);
    const chart = chartOf(data);
    await frame();
    const canvas = chart.root.querySelector("canvas")!;
    const rect = canvas.getBoundingClientRect();
    let put = rasterWork.put;
    canvas.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }),
    );
    await frame();
    expect(rasterWork.put).toBe(put);
    // One cell, one pixel of an image of a pixel per cell.
    data.replace(5 * 128 + 7, { v: [random() * 100] });
    await frame();
    expect(rasterWork.put - put).toBe(1);
    expect(shown(chart)).toEqual(shown(afresh(data)));
    // Two changes before one draw, in tiles apart, put both cells.
    put = rasterWork.put;
    data.replace(200 * 128 + 100, { v: [random() * 100] });
    data.replace(3 * 128 + 30, { v: [random() * 100] });
    await frame();
    expect(rasterWork.put - put).toBe(2);
    expect(shown(chart)).toEqual(shown(afresh(data)));
    chart.destroy();
  });

  it("move a sliding window's canvas and put the columns it uncovers", async () => {
    const [columns, rows] = [64, 32];
    const data = cells(columns, rows, columns * rows);
    const chart = chartOf(data);
    await frame();
    let next = columns;
    const column = () => ({
      x: new Float64Array(rows).fill(next++),
      y: Float64Array.from({ length: rows }, (_, i) => i),
      v: Float64Array.from({ length: rows }, () => random() * 100),
    });
    // One column a frame, then two and three before a frame: the patches compose.
    for (const appends of [1, 1, 2, 3]) {
      const put = rasterWork.put;
      for (let i = 0; i < appends; i++) data.append(column());
      await frame();
      expect(rasterWork.put - put).toBe(appends * rows);
      expect(shown(chart)).toEqual(shown(afresh(data)));
    }
    chart.destroy();
  });

  it("put the whole image to a chart's new canvas", async () => {
    const data = cells(64, 32);
    const first = chartOf(data);
    await frame();
    data.replace(0, { v: [1] });
    await frame();
    const put = rasterWork.put;
    const second = chartOf(data);
    await frame();
    expect(rasterWork.put - put).toBe(64 * 32);
    expect(shown(second)).toEqual(shown(first));
    first.destroy();
    second.destroy();
  });
});

describe("heatmaps patched in SVG", () => {
  it("encode the image a chart drawn afresh encodes", async () => {
    const data = cells(64, 32, 64 * 32);
    const chart = chartOf(data, "svg");
    await frame();
    data.replace(9, { v: [12] });
    data.append({ x: [64], y: [0], v: [50] });
    await frame();
    const href = (svg: ReturnType<typeof createChart>) =>
      svg.root.querySelector("image")!.getAttribute("href");
    expect(href(chart)).toBe(href(afresh(data, "svg")));
    chart.destroy();
  });
});
