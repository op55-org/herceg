import { describe, expect, it } from "vitest";
import { orderSeed, schedule, seeded, shuffled } from "./order.ts";

const SCENARIOS = ["line-small-init", "hover-line-medium", "zoom-line-large", "dashboard"];
const LIBRARIES = ["herceg", "echarts", "chartjs", "plotly", "tanstack", "uplot"];
const steps = (seed: number) =>
  schedule(seed, SCENARIOS, () => LIBRARIES).map(({ block, member }) => `${block}/${member}`);

describe("seeded order", () => {
  it("reproduces a recorded run's order from its seed", () => {
    // Pinned: a seed recorded with results must give this order on every
    // machine and in every later version of the runner.
    const pinned = schedule(1234, ["a", "b", "c"], () => ["x", "y", "z"]).map(
      ({ block, member }) => block + member,
    );
    expect(pinned).toEqual(["cx", "cy", "cz", "by", "bz", "bx", "az", "ay", "ax"]);
    expect(steps(3310985814)).toEqual(steps(3310985814));
    expect(steps(1)).not.toEqual(steps(2));
  });

  it("runs every library in every scenario once, a scenario's libraries together", () => {
    const planned = schedule(7, SCENARIOS, () => LIBRARIES);
    expect(planned).toHaveLength(SCENARIOS.length * LIBRARIES.length);
    expect(new Set(planned.map(({ block, member }) => `${block}/${member}`)).size).toBe(
      planned.length,
    );
    for (let i = 0; i < planned.length; i += LIBRARIES.length) {
      const block = planned.slice(i, i + LIBRARIES.length);
      expect(new Set(block.map((step) => step.block)).size).toBe(1);
      expect([...block.map((step) => step.member)].sort()).toEqual([...LIBRARIES].sort());
    }
  });

  it("does not always put the same library first", () => {
    const first = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const planned = schedule(seed, SCENARIOS, () => LIBRARIES);
      first.add(planned[0]!.member);
    }
    expect(first.size).toBe(LIBRARIES.length);
  });

  it("shuffles without losing or repeating items", () => {
    const items = Array.from({ length: 100 }, (_, i) => i);
    const out = shuffled(items, seeded(9));
    expect(out).not.toEqual(items);
    expect([...out].sort((a, b) => a - b)).toEqual(items);
  });

  it("takes a seed from 0 to 2^32 - 1, and makes one when none is given", () => {
    expect(orderSeed("0")).toBe(0);
    expect(orderSeed(String(2 ** 32 - 1))).toBe(2 ** 32 - 1);
    for (const wrong of ["-1", "1.5", String(2 ** 32), "seed"])
      expect(() => orderSeed(wrong)).toThrow(/--order-seed/);
    const made = orderSeed(undefined);
    expect(Number.isInteger(made) && made >= 0 && made < 2 ** 32).toBe(true);
  });
});
