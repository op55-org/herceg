// Numbers in SVG markup: n() writes what String(Math.round(v * 10) / 10)
// does, from integers.

import { describe, expect, it } from "vitest";
import { n } from "../../src/draw/markup.ts";

const written = (value: number) => String(Math.round(value * 10) / 10);

describe("n", () => {
  it("writes a number rounded to tenths as String() writes it", () => {
    const values = [0, -0, 0.04, -0.04, 0.05, -0.05, 0.15, -0.15, 1e-300, -1e-300, Number.NaN];
    values.push(Infinity, -Infinity, 214748364.7, -214748364.7, 214748364.75, -214748364.85);
    values.push(2 ** 31 / 10, 1e12, -1e12, 1e21, 1e300, -1e300, Number.MAX_VALUE, Number.MIN_VALUE);
    for (let t = -20_000; t <= 20_000; t++)
      values.push(t / 10, t / 10 + 0.05, t / 10 - 0.05, t / 100);
    let seed = 1;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 100_000; i++)
      values.push((random() - 0.5) * 10 ** (Math.floor(random() * 24) - 4));
    const differing = values.filter((value) => n(value) !== written(value));
    expect(differing).toEqual([]);
  });
});
