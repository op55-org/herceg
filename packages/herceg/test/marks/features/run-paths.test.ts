// The stretches of a stroked edge each style run draws (run-paths.ts), as
// tracing leaves them: work in proportion to the path, however many of its
// points share a place.
import { describe, expect, it } from "vitest";
import { Polyline } from "../../../src/lod/polyline.ts";
import { type Stretch, strokeStretches } from "../../../src/marks/features/run-paths.ts";

describe("stroke stretches", () => {
  it("pass points sharing a place once, whatever boundaries they hold", () => {
    // Every observation at one place, its runs alternating: a boundary at each.
    const n = 2000;
    const path = new Polyline();
    for (let i = 0; i < n; i++) path.push(5, 5);
    const stretches: Stretch[] = Array.from({ length: n - 1 }, (_, i) => ({
      run: i % 2,
      from: i,
      to: i + 1,
      open: i > 0,
      close: i < n - 2,
    }));
    let reads = 0;
    const coords = path.coords;
    path.coords = new Proxy(coords, {
      get(target, key) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, target);
      },
    });
    const out = strokeStretches(
      path,
      stretches,
      () => ({ strokeWidth: 2, dash: undefined }),
      () => new Polyline(),
    );
    expect(out).toHaveLength(n - 1);
    expect(reads).toBeLessThan(100 * n);
  });
});
