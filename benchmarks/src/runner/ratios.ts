// Memory amplification as ratios: bytes a library keeps per byte of the
// source data it draws (benchmarks/README.md, "Memory amplification"). The
// denominator is `dataBytes`, the source data's own bytes as the harness
// made it, the same for every library; each numerator is a measured growth
// defined beside it. A ratio is computed per sample and left out where its
// numerator was not measured or the data has no bytes.

/** A metric's samples, as the runners record them. */
interface Samples {
  unit: string;
  samples: number[];
}

/** Chart ratios: each over `dataBytes`, from the readings of the same name. */
export const CHART_RATIOS = {
  /** Heap (V8, Blink, array buffers) a mount retains, the median of repeated mounts in one page. */
  heapRatio: ["retainedBytes"],
  /** The same for the first mount in a fresh page, with what a library pays once. */
  firstHeapRatio: ["firstRetainedBytes"],
  /** The renderer process's physical footprint over the first mount (macOS). */
  processRatio: ["rendererBytes"],
  /** GPU memory Chrome attributes to the page over the first mount. */
  gpuRatio: ["gpuBytes"],
  /** Canvas backing stores, estimated as width x height x 4. */
  canvasRatio: ["canvasBytes"],
} as const;

/**
 * Grid ratios. A grid's readings start from its native input (row objects
 * for the grids that take them), so the source-to-mounted heap adds the
 * conversion to it, as a chart's mount includes its adapter's conversion.
 * Every grid sample is a fresh page, so its heap ratio compares with the
 * charts' `firstHeapRatio`. Process and GPU readings span the mount from
 * the native input only, so their ratios are named for the mount.
 */
export const GRID_RATIOS = {
  /** Converting the columns to the grid's input, and mounting it. */
  heapRatio: ["inputBytes", "retainedBytes"],
  /** Mounting alone, from the native input. */
  mountRatio: ["retainedBytes"],
  processMountRatio: ["rendererBytes"],
  gpuMountRatio: ["gpuBytes"],
  canvasRatio: ["canvasBytes"],
} as const;

/**
 * The ratios `definitions` name, per sample: the sum of the numerators'
 * samples at that place over `dataBytes`. Numerators recorded with fewer
 * samples than another (one per fresh page) are paired by place.
 */
export function ratios(
  metrics: Record<string, Samples>,
  dataBytes: number,
  definitions: Record<string, readonly string[]>,
): Record<string, { unit: "ratio"; samples: number[] }> {
  if (!(dataBytes > 0)) return {};
  const out: Record<string, { unit: "ratio"; samples: number[] }> = {};
  for (const [name, numerators] of Object.entries(definitions)) {
    const parts = numerators.map((numerator) => metrics[numerator]?.samples);
    if (parts.some((samples) => !samples || samples.length === 0)) continue;
    const n = Math.min(...parts.map((samples) => samples!.length));
    out[name] = {
      unit: "ratio",
      samples: Array.from(
        { length: n },
        (_, i) => parts.reduce((sum, samples) => sum + samples![i]!, 0) / dataBytes,
      ),
    };
  }
  return out;
}
