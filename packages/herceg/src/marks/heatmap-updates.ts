// Heatmaps and 2D histograms follow changes of their table and of the
// selections drawn over them with heatmap-patch.ts, which loads the first
// time one of them sees a change: a mark's first frame (mounting, a static
// export) and charts whose data never changes do not load it; a mark
// exported again after a change does, and the export does not wait. Until
// it has loaded, a change builds the cells and the image again, which is
// what patching them would draw.

type Updates = typeof import("./heatmap-patch.ts");

let updates: Updates | undefined;
let loading = false;

/**
 * What follows changes, once it has loaded; with `start` (a mark saw a
 * change), loads it if it has not.
 */
export function heatmapUpdates(start = false): Updates | undefined {
  if (start && !updates && !loading) {
    loading = true;
    import("./heatmap-patch.ts").then(
      (module) => {
        updates = module;
      },
      // A later change tries again; changes build anew until then.
      () => {
        loading = false;
      },
    );
  }
  return updates;
}

/**
 * Work heatmaps did, for tests and benchmarks: axes and cells patched and
 * built afresh, and image pixels painted.
 */
export const heatmapWork = {
  axesPatched: 0,
  axesPlaced: 0,
  cellsPatched: 0,
  cellsBuilt: 0,
  pixels: 0,
};
