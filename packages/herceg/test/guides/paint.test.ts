// Paint plans (guides/paint.ts): the order renderers paint panels in.
import { describe, expect } from "vitest";
import { paintOrder } from "../../src/guides/paint.ts";
import { contractTest } from "../helpers/contracts.ts";

describe("paint order", () => {
  contractTest("paint.order.z-index", () => {
    // A y grid over the marks, an x grid under them, and a mark at -2 under both.
    // Indexes into the grids, then the geometry: 0 and 1 are grids, 2 and 3 geometry.
    const plan = paintOrder([{ zIndex: -1 }, { zIndex: 1 }], [{}, { zIndex: -2 }]);
    expect(plan?.order).toEqual([3, 0, 2, 1]);
    // Kept while the values stay; already in order: no plan.
    expect(paintOrder([{ zIndex: -1 }, { zIndex: 1 }], [{}, { zIndex: -2 }], plan)).toBe(plan);
    expect(
      paintOrder([{ zIndex: -1 }, { zIndex: 1 }], [{ zIndex: 3 }, { zIndex: -2 }], plan),
    ).not.toBe(plan);
    expect(paintOrder([{ zIndex: -1 }], [{}, { zIndex: 2 }])).toBeUndefined();
  });

  contractTest("paint.order.ties", () => {
    // Grids before geometry at one zIndex; each as listed.
    const plan = paintOrder(
      [{ zIndex: 0 }, { zIndex: 1 }],
      [{ zIndex: 1 }, { zIndex: 0 }, { zIndex: 1 }],
    );
    expect(plan?.order).toEqual([0, 3, 1, 2, 4]);
  });
});
