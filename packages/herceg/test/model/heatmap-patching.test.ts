// Heatmaps patch what a change of their table touches (marks/heatmap-patch.ts),
// once it has loaded: checked against the oracle (helpers/heatmap-oracle.ts)
// and for what patching leaves alone. heatmap-loading.test.ts checks
// changes before it loads and while it does.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { col } from "../../src/data/expr.ts";
import { selectionStore, selectWhere } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { cellCountWork } from "../../src/marks/cell-counts.ts";
import { heatmap } from "../../src/marks/heatmap.ts";
import { heatmapUpdates, heatmapWork } from "../../src/marks/heatmap-updates.ts";
import { histogram } from "../../src/marks/histogram.ts";
import type { ChartMark } from "../../src/marks/mark.ts";
import { ChartModel } from "../../src/model/model.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import type { Geometry, RasterGeometry, RectGeometry } from "../../src/scene/scene.ts";
import {
  type Cells,
  chart,
  copyOf,
  drawn,
  oracle,
  type Run,
  random,
  start,
} from "../helpers/heatmap-oracle.ts";

// As a chart's first change does.
beforeAll(async () => {
  heatmapUpdates(true);
  await vi.dynamicImportSettled();
});

describe("patched heatmaps equal rebuilt ones", () => {
  const sizes = {
    // One pixel per cell; blocks of cells per pixel; spans of uneven cells.
    whole: [400, 300] as [number, number],
    blocks: [120, 90] as [number, number],
  };
  for (const reduce of ["last", "mean", "sum", "min", "max"] as const)
    it(`with reduce "${reduce}", cells of several rows, a fixed domain`, () => {
      const run: Run = {
        columns: 30,
        rows: 20,
        reduce,
        crowd: 3,
        domain: [0, 100],
        size: sizes.whole,
        seed: 7,
      };
      const patched = oracle(run);
      expect(patched.images).toBeGreaterThan(10);
      expect(patched.cells).toBeGreaterThan(20);
      expect(patched.axes).toBeGreaterThan(5);
      expect(patched.share).toBeLessThan(0.6);
    });

  it("with one row per cell and an automatic domain", () => {
    oracle({ columns: 40, rows: 30, reduce: "last", crowd: 1, size: sizes.whole, seed: 11 });
  });

  it("reducing blocks of cells into pixels", () => {
    for (const reduce of ["mean", "max"] as const)
      oracle(
        {
          columns: 150,
          rows: 120,
          reduce,
          crowd: 1,
          domain: [0, 100],
          size: sizes.blocks,
          seed: 3,
        },
        25,
      );
  });

  it("spanning uneven cells over pixels", () => {
    oracle({
      columns: 30,
      rows: 20,
      reduce: "mean",
      crowd: 2,
      uneven: true,
      domain: [0, 100],
      size: sizes.whole,
      seed: 5,
    });
  });

  it("over a rolling window", () => {
    oracle({
      columns: 30,
      rows: 16,
      reduce: "sum",
      crowd: 1,
      domain: [0, 100],
      size: sizes.whole,
      maxRows: 400,
      seed: 13,
    });
  });

  it("keep cells and image as they are after writes to a field the mark does not read", () => {
    const data = table({
      x: Float64Array.from({ length: 60 }, (_, i) => i % 10),
      y: Float64Array.from({ length: 60 }, (_, i) => Math.floor(i / 20)),
      v: Float64Array.from({ length: 60 }, (_, i) => i),
      note: Float64Array.from({ length: 60 }, (_, i) => -i),
    }) as unknown as Cells;
    const live = chart(data, { reduce: "mean", colorDomain: [0, 60] }, 200, 100);
    drawn(live);
    const before = { ...heatmapWork };
    (data as unknown as Table<{ note: "number" }>).replace(7, { note: [1] });
    drawn(live);
    expect(heatmapWork).toEqual(before);
  });

  it("drawn by a listener told of a change before the journal is", () => {
    const run: Run = { columns: 5, rows: 4, reduce: "last", crowd: 1, size: [200, 100], seed: 19 };
    const data = start(run, random(run.seed));
    const options = { reduce: "last", colorDomain: [0, 100] } as const;
    const live = chart(data, options, ...run.size);
    let got: ReturnType<typeof drawn> | undefined;
    data.subscribe(() => {
      got = drawn(live);
    });
    drawn(live);
    for (const value of [9, 50, 1]) {
      data.replace(0, { v: [value] });
      const want = drawn(chart(copyOf(data), options, ...run.size));
      expect(got!.pixels).toEqual(want.pixels);
      expect(drawn(live).pixels).toEqual(want.pixels);
    }
  });

  it("with many rows in one cell, cancelling and overflowing", () => {
    const next = random(17);
    for (const reduce of ["mean", "sum"] as const) {
      const data = table({
        x: new Float64Array(200).fill(0),
        y: new Float64Array(200).fill(0),
        v: Float64Array.from({ length: 200 }, () => next() * 10),
      }) as Cells;
      data.append({ x: [1, 1], y: [0, 0], v: [5, 6] });
      const live = chart(data, { reduce, colorDomain: [-1e300, 1e300] }, 200, 100);
      drawn(live);
      for (const edit of [
        [1e16, 1, -1e16],
        [1e308, 1e308, 1],
        [-0, -0, -0],
        [Number.NaN, 2, 3],
      ]) {
        data.replace(10, { v: edit.slice(0, 1) });
        data.replace(11, { v: edit.slice(1, 2) });
        data.replace(199, { v: edit.slice(2, 3) });
        const got = drawn(live);
        const want = drawn(chart(copyOf(data), { reduce, colorDomain: [-1e300, 1e300] }, 200, 100));
        expect(got.values).toEqual(want.values);
        expect(got.pixels).toEqual(want.pixels);
      }
    }
  });
});

describe("selections over heatmaps and 2D histograms", () => {
  const setup = (marks: (data: Cells) => ChartMark[], n = 40) => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (let c = 0; c < n; c++)
      for (let r = 0; r < n; r++) for (let k = 0; k < 3; k++) [xs.push(c), ys.push(r)];
    const data = table({
      x: Float64Array.from(xs),
      y: Float64Array.from(ys),
      v: Float64Array.from(xs, (_, i) => (i * 7) % 100),
    }) as Cells;
    const store = selectionStore(data);
    const selection = rowSelection({ store, channel: "focus" });
    const model = new ChartModel({
      locale: "en-US",
      timeZone: "UTC",
      legend: false,
      marks: marks(data),
      rowSelection: selection,
    });
    model.setSize(600, 400, 1);
    selection.highlight(model);
    const geometry = () => model.scene(estimateText).panels[0]!.marks;
    const brush = (to: number) =>
      store.set(
        "focus",
        selectWhere(
          col("x")
            .lt(to)
            .and(col("y").ge(to / 2)),
        ),
      );
    return { data, geometry, brush };
  };
  /** What a selection is drawn as: squares, by color, and an image of the cells holding selected rows. */
  const drawnSelection = (geometry: Geometry[]) =>
    geometry
      .filter((g) => g.key.includes("|selected"))
      .map((g) =>
        g.kind === "rect"
          ? Array.from((g as RectGeometry).rects)
          : Array.from((g as RasterGeometry).pixels),
      );

  it("a brush over a heatmap places no cell, paints none, and changes nothing of its image", async () => {
    const { geometry, brush } = setup((data) => [
      heatmap(data, { x: "x", y: "y", color: "v", colorDomain: [0, 100] }),
    ]);
    brush(4);
    geometry();
    await vi.dynamicImportSettled();
    const image = () =>
      geometry().find((g) => g.kind === "raster" && !g.key.includes("|selected")) as RasterGeometry;
    const before = { ...heatmapWork };
    const source = image().source!;
    const revision = source.revision;
    const moved = cellCountWork.moved;
    for (let to = 5; to < 30; to++) {
      brush(to);
      expect(image().source).toBe(source);
    }
    expect(source.revision).toBe(revision);
    expect(heatmapWork).toEqual(before);
    // The cells' counts moved by the rows that left and joined.
    expect(cellCountWork.moved).toBeGreaterThan(moved);
  });

  it("count a store's selection by its changes as a pass counts it", async () => {
    for (const marks of [
      (data: Cells) => [heatmap(data, { x: "x", y: "y", color: "v", reduce: "mean" })],
      (data: Cells) => [histogram(data, { x: "x", y: "y", bins: { step: 2 } } as never)],
    ] as const) {
      for (const n of [40, 240]) {
        const live = setup(marks, n);
        live.brush(4);
        live.geometry();
        await vi.dynamicImportSettled();
        const passes = cellCountWork.passes;
        // Steps of a column or two: fewer rows than an eighth move.
        for (const to of [5, 6, 8, 7, 9]) {
          live.brush(to);
          const got = drawnSelection(live.geometry());
          const fresh = setup(marks, n);
          fresh.brush(to);
          expect(got, `to ${to}`).toEqual(drawnSelection(fresh.geometry()));
        }
        // Each fresh chart counted once; the live one, by changes.
        expect(cellCountWork.passes - passes).toBe(5);
      }
    }
  });
});
