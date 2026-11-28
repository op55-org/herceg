// The heatmap patching oracle (marks/heatmap-patch.ts): a chart built
// afresh over the same rows, which a chart following its table's changes
// must equal bit for bit, in its cells (each axis' cells, the index's
// order, every cell's value) and its image's RGBA, under random updates,
// appends, drops, and reducers; whether or not what patches has loaded.
import { expect } from "vitest";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { type HeatmapMark, type HeatmapOptions, heatmap } from "../../src/marks/heatmap.ts";
import { heatmapWork } from "../../src/marks/heatmap-updates.ts";
import { ChartModel } from "../../src/model/model.ts";
import type { RasterGeometry } from "../../src/scene/scene.ts";
import type { CellReduce } from "../../src/spec/spec.ts";

export type Cells = Table<{ x: "number"; y: "number"; v: "number" }>;
export type Options = Omit<
  HeatmapOptions<{ x: "number"; y: "number"; v: "number" }>,
  "x" | "y" | "color"
>;

export function chart(data: Cells, options: Options, width: number, height: number) {
  const mark = heatmap(data, { x: "x", y: "y", color: "v", ...options } as never) as HeatmapMark;
  const model = new ChartModel({
    locale: "en-US",
    timeZone: "UTC",
    legend: false,
    marks: [mark],
  });
  model.setSize(width, height, 1);
  return { mark, model };
}

/** What a chart draws of its heatmap: its image, cells along each axis, index order, and cell values. */
export function drawn({ mark, model }: ReturnType<typeof chart>) {
  const scene = model.scene(estimateText);
  const raster = scene.panels[0]!.marks.find((g) => g.kind === "raster") as
    | RasterGeometry
    | undefined;
  const panel = model.panels()[0]!;
  const inspector = model.inspectorOf(panel.key)!;
  const s = inspector.marks[0]!.series[0]!;
  const { frame } = inspector;
  const across = mark.resolve(s, "x", frame.x);
  const down = mark.resolve(s, "y", frame.y);
  const cells = mark.cellsOf(s, across, down);
  const axis = (resolved: typeof across) => {
    const c = resolved.cells!;
    return {
      values: Array.from(c.values),
      lower: Array.from(c.lower),
      upper: Array.from(c.upper),
      cells: Array.from(c.cells),
      lattice: c.lattice && { ...c.lattice, slots: c.lattice.slots && Array.from(c.lattice.slots) },
    };
  };
  return {
    raster,
    pixels: raster ? Array.from(raster.pixels) : [],
    x: axis(across),
    y: axis(down),
    order: cells.index.order ? Array.from(cells.index.order) : null,
    // Signed zeros told apart; NaN equals NaN.
    values: Array.from(cells.values, (v) => (Object.is(v, -0) ? "-0" : v)),
  };
}

export function copyOf(data: Cells): Cells {
  return table({
    x: Float64Array.from(data.numbers("x")),
    y: Float64Array.from(data.numbers("y")),
    v: Float64Array.from(data.numbers("v")),
  }) as Cells;
}

/** A seeded generator, so a failure repeats. */
export function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Values that test reduction: cancellation, overflow, signed zero, missing, and ordinary. */
export const SPECIAL = [
  1e16,
  1,
  -1e16,
  1e308,
  1.5e308,
  -0,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  0.1,
  0.2,
];

export interface Run {
  columns: number;
  rows: number;
  reduce: CellReduce;
  domain?: readonly [number, number];
  /** Rows per cell at the start. */
  crowd: number;
  /** x values off a lattice, for spans of pixels. */
  uneven?: boolean;
  size: [number, number];
  maxRows?: number;
  seed: number;
}

export function start({ columns, rows, crowd, uneven, maxRows }: Run, next: () => number): Cells {
  const xs: number[] = [];
  const ys: number[] = [];
  const vs: number[] = [];
  for (let c = 0; c < columns; c++)
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < crowd; k++) {
        xs.push(uneven ? c + (c % 3) * 0.3 : c);
        ys.push(r);
        vs.push(Math.round(next() * 1000) / 10);
      }
  const columnsOf = {
    x: Float64Array.from(xs),
    y: Float64Array.from(ys),
    v: Float64Array.from(vs),
  };
  return table(columnsOf, maxRows === undefined ? {} : { maxRows }) as Cells;
}

/** One random change of the table. */
export function change(data: Cells, run: Run, next: () => number, step: number) {
  const n = data.length;
  const pick = (array: readonly number[]) => array[Math.floor(next() * array.length)]!;
  const value = () => (next() < 0.3 ? pick(SPECIAL) : Math.round(next() * 1000) / 10);
  const what = next();
  const last = run.columns + Math.floor(step / 4);
  if (what < 0.35 && n > 0) {
    // A few values edited, sometimes through a transaction of several writes.
    const edits = 1 + Math.floor(next() * 3);
    data.transaction(() => {
      for (let i = 0; i < edits; i++) data.replace(Math.floor(next() * n), { v: [value()] });
    });
  } else if (what < 0.45 && n > 0) {
    // A row moved to another cell, or one no cell has.
    const at = Math.floor(next() * n);
    data.replace(at, {
      x: [next() < 0.5 ? Math.floor(next() * run.columns) : last + 0.5],
      y: [Math.floor(next() * run.rows)],
    });
  } else if (what < 0.8) {
    // Rows into cells there, past the last column, or a column of its own.
    const count = 1 + Math.floor(next() * run.rows);
    const column = next() < 0.5 ? Math.floor(next() * run.columns) : last;
    data.append({
      x: Float64Array.from({ length: count }, () => column),
      y: Float64Array.from({ length: count }, (_, i) => i % run.rows),
      v: Float64Array.from({ length: count }, value),
    });
  } else if (n > 0) data.dropFirst(1 + Math.floor(next() * run.rows));
}

/** What patching did: images patched in part, cells patched, axes patched, and of the pixels, the share repainted. */
export interface Patched {
  images: number;
  cells: number;
  axes: number;
  share: number;
}

export function oracle(run: Run, steps = 40): Patched {
  const next = random(run.seed);
  const data = start(run, next);
  const options: Options = {
    reduce: run.reduce,
    ...(run.domain ? { colorDomain: run.domain } : {}),
  };
  const live = chart(data, options, ...run.size);
  drawn(live);
  let images = 0;
  const work = { cells: 0, axes: 0, pixels: 0, all: 0 };
  for (let step = 0; step < steps; step++) {
    change(data, run, next, step);
    const before = { ...heatmapWork };
    const got = drawn(live);
    work.cells += heatmapWork.cellsPatched - before.cellsPatched;
    work.axes += heatmapWork.axesPatched - before.axesPatched;
    work.pixels += heatmapWork.pixels - before.pixels;
    work.all += got.raster ? got.raster.columns * got.raster.rows : 0;
    const want = drawn(chart(copyOf(data), options, ...run.size));
    expect(got.x, `step ${step}: x cells`).toEqual(want.x);
    expect(got.y, `step ${step}: y cells`).toEqual(want.y);
    expect(got.order, `step ${step}: index`).toEqual(want.order);
    expect(got.values, `step ${step}: cell values`).toEqual(want.values);
    expect(got.pixels.length, `step ${step}: image size`).toBe(want.pixels.length);
    expect(got.pixels, `step ${step}: RGBA`).toEqual(want.pixels);
    const patch = got.raster?.source?.patches.at(-1);
    if (patch && patch.revision === got.raster!.source!.revision && patch.rects) images++;
  }
  return { images, cells: work.cells, axes: work.axes, share: work.pixels / work.all };
}
