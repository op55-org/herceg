import { describe, expect, it } from "vitest";
import { CHART_RATIOS, GRID_RATIOS, ratios } from "./ratios.ts";

const bytes = (...samples: number[]) => ({ unit: "bytes", samples });

describe("memory ratios", () => {
  it("divides each chart reading by the source data's bytes, sample by sample", () => {
    const metrics = {
      retainedBytes: bytes(500, 700),
      firstRetainedBytes: bytes(900),
      rendererBytes: bytes(4000),
      gpuBytes: bytes(2500),
      canvasBytes: bytes(1000, 1000),
    };
    expect(ratios(metrics, 1000, CHART_RATIOS)).toEqual({
      heapRatio: { unit: "ratio", samples: [0.5, 0.7] },
      firstHeapRatio: { unit: "ratio", samples: [0.9] },
      processRatio: { unit: "ratio", samples: [4] },
      gpuRatio: { unit: "ratio", samples: [2.5] },
      canvasRatio: { unit: "ratio", samples: [1, 1] },
    });
  });

  it("counts a grid's conversion to its input in the heap ratio, and not in the mount ratio", () => {
    // 100 bytes of columns, converted into 60 bytes of input, mounted into 140 more.
    const metrics = { inputBytes: bytes(60), retainedBytes: bytes(140) };
    const out = ratios(metrics, 100, GRID_RATIOS);
    expect(out.heapRatio?.samples).toEqual([2]);
    expect(out.mountRatio?.samples).toEqual([1.4]);
    expect(
      ratios({ rendererBytes: bytes(300) }, 100, GRID_RATIOS).processMountRatio?.samples,
    ).toEqual([3]);
  });

  it("leaves out ratios whose readings are missing, and every ratio of data without bytes", () => {
    const out = ratios({ retainedBytes: bytes(10) }, 100, CHART_RATIOS);
    expect(Object.keys(out)).toEqual(["heapRatio"]);
    expect(ratios({ retainedBytes: bytes(10) }, 0, CHART_RATIOS)).toEqual({});
    expect(ratios({ inputBytes: bytes(10) }, 100, GRID_RATIOS)).toEqual({});
  });
});
