import { afterEach, describe, expect, it } from "vitest";
import { Shown } from "./paced.ts";
import { limits } from "./verify.ts";

const saved = { ...limits };
afterEach(() => Object.assign(limits, saved));

describe("the sustained runs' ledger", () => {
  it("finds the input a frame shows however far behind the library is", () => {
    const shown = new Shown<number>();
    let drawn = -1;
    let reads = 0;
    const read = () => {
      reads++;
      return drawn;
    };
    for (let k = 0; k < 20; k++) shown.add(k, (seen) => seen === k);
    // The frame shows input 3 of 20: the inputs before it were overtaken.
    drawn = 3;
    const commit = shown.frame(read, 10);
    expect(commit).toBeDefined();
    // What the frame drew is read once, however many inputs wait.
    expect(reads).toBe(1);
    commit!(25);
    expect(shown.latencies).toEqual([22]);
    expect(shown.superseded).toBe(3);
    expect(shown.outstanding).toBe(16);
    // A later frame showing the newest input takes it and overtakes the rest.
    drawn = 19;
    shown.frame(read, 30)!(40);
    expect(shown.latencies).toEqual([22, 21]);
    expect(shown.superseded).toBe(3 + 15);
    expect(shown.unshown).toBe(0);
  });

  it("gives up on inputs no frame showed within the settled limit, as unshown", () => {
    limits.settled = 100;
    const shown = new Shown<number>();
    for (let k = 0; k < 5; k++) shown.add(k * 10, () => false);
    expect(shown.frame(() => -1, 50)).toBeUndefined();
    expect(shown.outstanding).toBe(5);
    // At 125 ms, the inputs from 0, 10, and 20 ms have waited past the limit.
    expect(shown.frame(() => -1, 125)).toBeUndefined();
    expect(shown.outstanding).toBe(2);
    expect(shown.unshown).toBe(5);
  });

  it("gives up an input past the settled limit even when the frame shows it", () => {
    limits.settled = 100;
    const shown = new Shown<number>();
    shown.add(0, (seen) => seen === 0);
    shown.add(50, (seen) => seen === 1);
    // At 120 ms the frame shows input 0, which waited 120 ms: given up, not
    // shown, and it does not count input 1 as overtaken.
    expect(shown.frame(() => 0, 120)).toBeUndefined();
    expect(shown.latencies).toEqual([]);
    expect(shown.superseded).toBe(0);
    expect(shown.unshown).toBe(2);
    expect(shown.outstanding).toBe(1);
  });
});
