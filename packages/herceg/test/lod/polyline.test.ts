import { describe, expect, it } from "vitest";
import { Polyline } from "../../src/lod/polyline.ts";

/** Traces `points` points into `line` after a reset to `limit`, as a frame does. */
function trace(line: Polyline, points: number, limit = points): void {
  line.reset(limit);
  for (let i = 0; i < points; i++) line.push(i, i);
}

describe("Polyline", () => {
  it("grows by doubling no further than the points a trace keeps", () => {
    const line = new Polyline();
    trace(line, 3000);
    expect(line.coords.length).toBe(3000 * 2);
    expect(line.count).toBe(3000);
    expect(line.coords[2999 * 2]).toBe(2999);
  });

  it("keeps what it has for traces that keep fewer points than they could", () => {
    const line = new Polyline();
    const room = line.coords.length;
    // Missing values: nothing kept of 3,000 rows.
    trace(line, 0, 3000);
    expect(line.coords.length).toBe(room);
    // A flat line, which level of detail reduces to half its limit.
    trace(line, 3000, 6000);
    expect(line.coords.length).toBe(4096 * 2);
  });

  it("does not reallocate every frame as a series keeps a point more each frame", () => {
    const line = new Polyline();
    let buffers = 0;
    let coords = line.coords;
    for (let points = 1; points <= 3000; points++) {
      trace(line, points);
      if (line.coords !== coords) buffers++;
      coords = line.coords;
    }
    expect(buffers).toBeLessThan(40);
    expect(line.coords.length).toBeLessThan(3000 * 2 * 1.2);
  });

  it("grows past its limit when a trace keeps more", () => {
    const line = new Polyline();
    trace(line, 1000, 10);
    expect(line.count).toBe(1000);
    expect(Array.from(line.coords.subarray(0, 4))).toEqual([0, 0, 1, 1]);
  });
});
