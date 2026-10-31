// Boxes moved apart along one axis as little as possible (layout/separate.ts),
// checked against cases worked by hand and against a slow reference solver.
import { describe, expect, it } from "vitest";
import { separate } from "../../src/layout/separate.ts";

/** The sum of squared moves. */
const cost = (tops: ArrayLike<number>, wanted: readonly number[]) =>
  wanted.reduce((sum, w, i) => sum + (tops[i]! - w) ** 2, 0);

/** Whether `tops` keep every pair apart and every box within its bounds. */
function keeps(
  tops: ArrayLike<number>,
  heights: readonly number[],
  pairs: readonly number[],
  lo: readonly number[],
  hi: readonly number[],
): boolean {
  for (let i = 0; i < heights.length; i++)
    if (tops[i]! < lo[i]! - 1e-7 || tops[i]! + heights[i]! > hi[i]! + 1e-7) return false;
  for (let k = 0; k < pairs.length; k += 2)
    if (tops[pairs[k + 1]!]! < tops[pairs[k]!]! + heights[pairs[k]!]! - 1e-7) return false;
  return true;
}

/** Hildreth's method run long: slow, but simple enough to trust. */
function reference(
  wanted: readonly number[],
  heights: readonly number[],
  pairs: readonly number[],
  lo: readonly number[],
  hi: readonly number[],
): number[] {
  const tops = [...wanted];
  const pair = new Float64Array(pairs.length / 2);
  const low = new Float64Array(wanted.length);
  const high = new Float64Array(wanted.length);
  for (let sweep = 0; sweep < 200_000; sweep++) {
    let change = 0;
    for (let k = 0; k < pair.length; k++) {
      const [u, v] = [pairs[2 * k]!, pairs[2 * k + 1]!];
      const step = Math.max((heights[u]! - tops[v]! + tops[u]!) / 2, -pair[k]!);
      pair[k]! += step;
      tops[v]! += step;
      tops[u]! -= step;
      change = Math.max(change, Math.abs(step));
    }
    for (let i = 0; i < tops.length; i++) {
      const up = Math.max(lo[i]! - tops[i]!, -low[i]!);
      low[i]! += up;
      tops[i]! += up;
      const down = Math.max(tops[i]! + heights[i]! - hi[i]!, -high[i]!);
      high[i]! += down;
      tops[i]! -= down;
      change = Math.max(change, Math.abs(up), Math.abs(down));
    }
    if (change < 1e-12) break;
  }
  return tops;
}

/** `n` bounds of `value`. */
const all = (n: number, value: number) => Array<number>(n).fill(value);

/** A seeded generator, so failures repeat. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("separate", () => {
  it("lets a constraint go once it stops binding", () => {
    // A meets B and C; C wants to be far above A, B just below it.
    const tops = separate([92.5, 93.5, 52], [15, 15, 100], [0, 1, 0, 2], all(3, 0), all(3, 1000));
    expect([...tops].map((t) => Math.round(t * 1000) / 1000)).toEqual([64.75, 93.5, 79.75]);
  });

  it("stacks a long chain around the middle of where its boxes want to be", () => {
    // 48 boxes 15 tall wanting their middles at 500, each meeting the next.
    const n = 48;
    const pairs = Array.from({ length: n - 1 }, (_, i) => [i, i + 1]).flat();
    const tops = separate(all(n, 492.5), all(n, 15), pairs, all(n, 0), all(n, 1000));
    expect(tops[0]).toBeCloseTo(140, 9);
    tops.forEach((top, i) => {
      expect(top).toBeCloseTo(140 + 15 * i, 9);
    });
  });

  it("keeps within its bounds, the moves then least", () => {
    // Three boxes wanting to be above the top: stacked down from it.
    const tops = separate([-20, -10, 0], [10, 10, 10], [0, 1, 1, 2], all(3, 0), all(3, 100));
    expect([...tops]).toEqual([0, 10, 20]);
    // A stack exactly as tall as the room between its bounds fills it.
    const full = separate([50, 50, 50], [30, 40, 30], [0, 1, 1, 2], all(3, 0), all(3, 100));
    expect([...full]).toEqual([0, 30, 70]);
    // Bounds of their own: the middle box kept below 60, the others free.
    const own = separate([50, 50, 50], [10, 10, 10], [0, 1, 1, 2], [0, 60, 0], all(3, 100));
    expect([...own]).toEqual([50, 60, 70]);
  });

  it("finds the least moves the reference does, in partly meeting groups", () => {
    const next = random(7);
    for (let trial = 0; trial < 300; trial++) {
      const n = 2 + Math.floor(next() * 7);
      const heights = Array.from({ length: n }, () => 5 + Math.floor(next() * 30));
      // Wanted tops crowd one stretch, so constraints bind and stop binding.
      const wanted = Array.from({ length: n }, () => 40 + next() * 80);
      const pairs: number[] = [];
      for (let v = 1; v < n; v++) for (let u = 0; u < v; u++) if (next() < 0.5) pairs.push(u, v);
      const bottom = 30 + heights.reduce((a, b) => a + b, 0) * (0.6 + next());
      // Some boxes have bounds of their own, as walls give them.
      const lo = heights.map(() => (next() < 0.2 ? next() * 40 : 0));
      const hi = heights.map(() => bottom - (next() < 0.2 ? next() * 40 : 0));
      // The constraints must leave room: leave out trials where they do not.
      const highest = lo.slice();
      for (let k = 0; k < pairs.length; k += 2)
        highest[pairs[k + 1]!] = Math.max(
          highest[pairs[k + 1]!]!,
          highest[pairs[k]!]! + heights[pairs[k]!]!,
        );
      if (highest.some((top, i) => top + heights[i]! > hi[i]!)) continue;
      const tops = separate(wanted, heights, pairs, lo, hi);
      expect(keeps(tops, heights, pairs, lo, hi), `trial ${trial} keeps its constraints`).toBe(
        true,
      );
      const best = reference(wanted, heights, pairs, lo, hi);
      expect(cost(tops, wanted), `trial ${trial}`).toBeCloseTo(cost(best, wanted), 4);
    }
  });

  it("settles a crowded group of 48 quickly", () => {
    const next = random(11);
    const n = 48;
    const heights = Array.from({ length: n }, () => 12 + Math.floor(next() * 8));
    const pairs: number[] = [];
    for (let v = 1; v < n; v++) for (let u = 0; u < v; u++) if (next() < 0.3) pairs.push(u, v);
    const wanted = Array.from({ length: n }, () => 300 + next() * 100);
    const started = performance.now();
    const [lo, hi] = [all(n, 0), all(n, 2000)];
    const tops = separate(wanted, heights, pairs, lo, hi);
    expect(performance.now() - started).toBeLessThan(50);
    expect(keeps(tops, heights, pairs, lo, hi)).toBe(true);
    const best = reference(wanted, heights, pairs, lo, hi);
    expect(cost(tops, wanted)).toBeLessThanOrEqual(cost(best, wanted) + 1e-6);
  });
});
