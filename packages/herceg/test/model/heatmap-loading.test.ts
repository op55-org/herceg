// What follows heatmaps' changes (marks/heatmap-patch.ts) loads on the
// first change a heatmap sees (marks/heatmap-updates.ts). Each test reads
// the modules afresh, so that nothing has loaded it yet.
import { describe, expect, it, vi } from "vitest";

async function fresh() {
  vi.resetModules();
  const oracle = await import("../helpers/heatmap-oracle.ts");
  const updates = await import("../../src/marks/heatmap-updates.ts");
  const { table } = await import("../../src/data/table.ts");
  const { renderToSVG } = await import("../../src/render/static.ts");
  const { heatmap } = await import("../../src/marks/heatmap.ts");
  return { ...oracle, ...updates, table, renderToSVG, heatmap };
}

describe("what follows heatmaps' changes", () => {
  it("is not loaded by charts whose data does not change, nor by static output", async () => {
    const m = await fresh();
    const data = m.start(
      { columns: 12, rows: 8, reduce: "mean", crowd: 2, size: [300, 200], seed: 3 },
      m.random(3),
    );
    const live = m.chart(data, { reduce: "mean", colorDomain: [0, 100] }, 300, 200);
    m.drawn(live);
    // Frames drawn again (a hover, a resize) are no change.
    m.drawn(live);
    live.model.setSize(320, 210, 1);
    m.drawn(live);
    m.renderToSVG({
      width: 300,
      height: 200,
      marks: [m.heatmap(data, { x: "x", y: "y", color: "v", reduce: "mean" })],
    });
    await vi.dynamicImportSettled();
    expect(m.heatmapUpdates()).toBeUndefined();
  });

  it("loads when a mark exported again saw a change, the export drawn as afresh", async () => {
    const m = await fresh();
    const data = m.start(
      { columns: 12, rows: 8, reduce: "mean", crowd: 2, size: [300, 200], seed: 4 },
      m.random(4),
    );
    const options = {
      width: 300,
      height: 200,
      marks: [m.heatmap(data, { x: "x", y: "y", color: "v", reduce: "mean" })],
    };
    m.renderToSVG(options);
    data.replace(3, { v: [42] });
    // The mark follows its table across exports: the change starts the load, and the export
    // waits for none of it.
    const again = m.renderToSVG(options);
    expect(m.heatmapUpdates()).toBeUndefined();
    const copy = m.copyOf(data);
    const drawn = m.renderToSVG({
      ...options,
      marks: [m.heatmap(copy, { x: "x", y: "y", color: "v", reduce: "mean" })],
    });
    // Each export numbers its ids.
    const ids = (svg: string) => svg.replaceAll(/herceg-svg-\d+/g, "herceg-svg");
    expect(ids(again)).toBe(ids(drawn));
    await vi.dynamicImportSettled();
    expect(m.heatmapUpdates()).toBeDefined();
  });

  it("builds again until it loads, as patching would draw, and loads on the first change", async () => {
    const m = await fresh();
    for (const reduce of ["last", "mean", "sum"] as const) {
      const patched = m.oracle({
        columns: 30,
        rows: 20,
        reduce,
        crowd: 2,
        domain: [0, 100],
        size: [400, 300],
        seed: 7,
      });
      // Run without a pause, nothing loaded in between: every change built again.
      expect(patched).toMatchObject({ images: 0, cells: 0, axes: 0 });
    }
    expect(m.heatmapUpdates()).toBeUndefined();
    await vi.dynamicImportSettled();
    expect(m.heatmapUpdates()).toBeDefined();
  });

  it("patches from the change after it loads, changes made while it loads built again", async () => {
    const m = await fresh();
    const data = m.start(
      { columns: 20, rows: 10, reduce: "mean", crowd: 2, size: [400, 300], seed: 5 },
      m.random(5),
    );
    const options = { reduce: "mean", colorDomain: [0, 100] } as const;
    const live = m.chart(data, options, 400, 300);
    m.drawn(live);
    // What the live chart did, apart from the charts drawn afresh to compare.
    const work = { cellsPatched: 0, cellsBuilt: 0 };
    const step = (k: number) => {
      data.replace(k * 7, { v: [k * 3] });
      const before = { ...m.heatmapWork };
      const got = m.drawn(live);
      work.cellsPatched += m.heatmapWork.cellsPatched - before.cellsPatched;
      work.cellsBuilt += m.heatmapWork.cellsBuilt - before.cellsBuilt;
      const want = m.drawn(m.chart(m.copyOf(data), options, 400, 300));
      expect(got.values, `change ${k}`).toEqual(want.values);
      expect(got.pixels, `change ${k}`).toEqual(want.pixels);
    };
    // The first change starts the load; the next lands while it is under way.
    step(1);
    step(2);
    expect(work).toEqual({ cellsPatched: 0, cellsBuilt: 0 });
    await vi.dynamicImportSettled();
    // The change after it loads builds the cells it keeps; the next patches them.
    step(3);
    expect(work).toEqual({ cellsPatched: 0, cellsBuilt: 1 });
    step(4);
    step(5);
    expect(work).toEqual({ cellsPatched: 2, cellsBuilt: 1 });
  });
});
