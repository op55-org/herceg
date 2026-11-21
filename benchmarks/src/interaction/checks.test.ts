import { describe, expect, it } from "vitest";
import { barWrong, columnMiddles, misplacedLabel, over, type RGB, shadeWrong } from "./checks.ts";

const label = (name: string, point: number, at: number, height = 18) => ({
  name,
  point,
  height,
  at,
});

describe("columnMiddles", () => {
  it("leaves labels that meet none at their points", () => {
    expect(columnMiddles([label("a", 70, 0), label("b", 300, 0)], 8, 348)).toEqual([70, 300]);
  });

  it("stacks labels that meet a height apart, centered on their points' mean", () => {
    const middles = columnMiddles(
      [label("a", 100, 0), label("b", 104, 0), label("c", 96, 0)],
      8,
      348,
    );
    expect(middles.map((m) => m - 100)).toEqual([0, 18, -18]);
  });

  it("keeps a stack inside the plot", () => {
    expect(columnMiddles([label("a", 9, 0), label("b", 10, 0)], 0, 100)).toEqual([9, 27]);
    expect(columnMiddles([label("a", 95, 0), label("b", 99, 0)], 0, 100)).toEqual([73, 91]);
  });

  it("orders labels at one point as given", () => {
    expect(columnMiddles([label("a", 50, 0), label("b", 50, 0)], 0, 100)).toEqual([41, 59]);
  });

  it("spaces labels of different heights by half of each", () => {
    expect(columnMiddles([label("a", 50, 0, 10), label("b", 50, 0, 30)], 0, 100)).toEqual([40, 60]);
  });

  it("agrees with an exhaustive search over small columns", () => {
    // Every placement of up to three labels on a half-pixel grid of a 30 px
    // plot, in the order of their points (ties in theirs), each below the
    // one before: the one of least squared moves.
    let seed = 7;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const STEP = 0.5;
    for (let n = 0; n < 40; n++) {
      const count = 2 + Math.floor(next() * 2);
      const labels = Array.from({ length: count }, (_, i) =>
        label(`l${i}`, Math.round(next() * 30), 0, 4 + 2 * Math.floor(next() * 3)),
      );
      const order = labels.map((_, i) => i);
      order.sort((i, j) => labels[i]!.point - labels[j]!.point || i - j);
      let best = { cost: Number.POSITIVE_INFINITY, middles: [] as number[] };
      const place = (k: number, from: number, tops: number[]) => {
        if (k === count) {
          const middles = new Array<number>(count);
          let cost = 0;
          order.forEach((i, j) => {
            middles[i] = tops[j]! + labels[i]!.height / 2;
            cost += (middles[i]! - labels[i]!.point) ** 2;
          });
          if (cost < best.cost) best = { cost, middles };
          return;
        }
        const { height } = labels[order[k]!]!;
        for (let top = from; top + height <= 30; top += STEP)
          place(k + 1, top + height, [...tops, top]);
      };
      place(0, 0, []);
      const middles = columnMiddles(labels, 0, 30);
      middles.forEach((m, i) => {
        expect(Math.abs(m - best.middles[i]!)).toBeLessThanOrEqual(STEP);
      });
    }
  });
});

describe("misplacedLabel", () => {
  const stack = [
    label("a", 157, 143),
    label("b", 187, 161),
    label("c", 188, 179),
    label("d", 194, 197),
  ];

  it("passes labels where the layout puts them", () => {
    const middles = columnMiddles(stack, 8, 348);
    const placed = stack.map((l, i) => ({ ...l, at: middles[i]! }));
    expect(misplacedLabel(placed, 8, 348, "end")).toBeUndefined();
  });

  it("fails a stack spaced by less than its labels' height", () => {
    const middles = columnMiddles(stack, 8, 348);
    const mean = middles.reduce((s, m) => s + m, 0) / middles.length;
    // Half the height apart, about the same mean: what inferring the step from the result accepted.
    const halved = stack.map((l, i) => ({ ...l, at: mean + (middles[i]! - mean) / 2 }));
    expect(misplacedLabel(halved, 8, 348, "end")).toMatch(
      /^a at the view's end stands at 168.0 px, not 154.5/,
    );
  });

  it("fails labels pushed far from the plot's edge", () => {
    const pushed = [label("a", 5, 80, 10), label("b", 7, 100, 10)];
    expect(misplacedLabel(pushed, 0, 100, "start")).toMatch(
      /^a at the view's start stands at 80.0/,
    );
  });

  it("fails labels at the plot's middle", () => {
    const middle = stack.map((l, i) => ({ ...l, at: 178 - 27 + 18 * i }));
    expect(misplacedLabel(middle, 8, 348, "end")).toBeDefined();
  });

  it("refuses columns too tall for the plot", () => {
    expect(misplacedLabel(stack, 0, 50, "end")).toMatch(/taller together than the plot/);
  });
});

describe("barWrong", () => {
  // 10 px a row up from 200; the bin from 10 to 28 px across.
  const y = (rows: number) => 200 - rows * 10;
  const edges = [10, 28] as const;
  const part = (top: number, bottom: number, opaque: boolean, left = 10.5, right = 27.5) => ({
    left,
    right,
    top,
    bottom,
    opaque,
  });
  const check = (parts: ReturnType<typeof part>[], low: number, high = low) =>
    barWrong(parts, 10, low, high, edges, y);

  it("passes a bar opaque to its brushed rows and faint above", () => {
    expect(check([part(100, 160, false), part(160, 200, true)], 4)).toBeUndefined();
    expect(check([part(100, 200, true)], 10)).toBeUndefined();
    expect(check([part(100, 200, false)], 0)).toBeUndefined();
  });

  it("fails a bar not drawn", () => {
    expect(check([], 4)).toBe("is not drawn (10 rows)");
  });

  it("fails a bar drawn elsewhere along y", () => {
    expect(check([part(1100, 1160, false), part(1160, 1200, true)], 4)).toBe(
      "starts at 1100.0 px, not at 100.0 (10 rows)",
    );
  });

  it("fails a bar narrower than its bin", () => {
    expect(check([part(100, 160, false), part(160, 200, true, 18, 19)], 4)).toBe(
      "has a part across 18.0 to 19.0 px, not 10.0 to 28.0 px",
    );
  });

  it("fails a bar opaque to other rows than the brush holds", () => {
    expect(check([part(100, 150, false), part(150, 200, true)], 4)).toMatch(
      /^is opaque up to 150.0 px, not between 160.0 and 160.0/,
    );
  });

  it("fails parts that leave a gap, overlap, or end short", () => {
    expect(check([part(100, 150, false), part(160, 200, true)], 4)).toBe(
      "has a gap from 150.0 to 160.0 px",
    );
    // Their heights sum to the bar's: an overlap and a gap of 10 px each.
    const parts = [
      part(100, 160, false),
      part(160, 185, true),
      part(160, 170, true),
      part(195, 200, true),
    ];
    expect(check(parts, 4)).toBe("has parts overlapping from 160.0 to 185.0 px");
    expect(check([part(100, 160, false), part(160, 190, true)], 4)).toBe(
      "ends at 190.0 px, not at its base, 200.0",
    );
  });

  it("fails faint parts below opaque ones", () => {
    expect(check([part(100, 140, true), part(140, 200, false)], 6)).toBe(
      "has faint parts below its opaque one",
    );
  });
});

describe("shadeWrong", () => {
  const white: RGB = [255, 255, 255];
  const blue: RGB = [50, 102, 214];
  const opaque = over(blue, 1, white);
  const faint = over(blue, 0.25, white);

  it("passes the colors bars composite to, and rounding", () => {
    expect(shadeWrong([50, 102, 214], opaque)).toBe(false);
    expect(shadeWrong([204, 217, 245], faint)).toBe(false);
    expect(shadeWrong([207, 220, 247], faint)).toBe(false);
  });

  it("fails bars painted at 65% of their opacity", () => {
    expect(shadeWrong(over(opaque, 0.65, white), opaque)).toBe(true);
    expect(shadeWrong(over(faint, 0.65, white), faint)).toBe(true);
  });

  it("fails the plot's white for either part", () => {
    expect(shadeWrong(white, opaque)).toBe(true);
    expect(shadeWrong(white, faint)).toBe(true);
  });
});
