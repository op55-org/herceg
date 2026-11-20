import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Scheduled } from "../../src/dom/scheduler.ts";

// The frame loop on the test's clock: frames run when the test says, and
// flushes take the time they say.
let time = 0;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  time = 0;
  frames = [];
  vi.resetModules();
  vi.spyOn(performance, "now").mockImplementation(() => time);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** A fresh scheduler, with nothing left out of a frame before. */
const scheduler = () => import("../../src/dom/scheduler.ts");

/** Runs the frame asked for. */
function run() {
  frames.shift()!(time);
}

/** A chart whose flush takes `ms` and leaves `left` of it out, as a transition's start does. */
function chart(
  leaveOut: (ms: number) => void,
  ms: number,
  left = 0,
  cold = false,
): Scheduled & { cold: boolean } {
  return {
    visible: true,
    cold,
    flush() {
      time += ms;
      if (left > 0) leaveOut(left);
    },
  };
}

describe("frame times", () => {
  it("leave out what transitions starting leave out, of every chart in the frame", async () => {
    const { schedule, leaveOut, lastFrameTime } = await scheduler();
    schedule(chart(leaveOut, 30, 25));
    schedule(chart(leaveOut, 10, 8));
    schedule(chart(leaveOut, 12));
    run();
    expect(lastFrameTime()).toBe(19);
  });

  it("leave out nothing of work outside a frame", async () => {
    const { schedule, leaveOut, lastFrameTime } = await scheduler();
    leaveOut(30);
    schedule(chart(leaveOut, 5));
    run();
    expect(lastFrameTime()).toBe(5);
  });

  it("count a frame after one that left work out in full, then leave it out again", async () => {
    const { schedule, leaveOut, lastFrameTime } = await scheduler();
    const seen: number[] = [];
    for (let k = 0; k < 4; k++) {
      schedule(chart(leaveOut, 30, 25));
      run();
      seen.push(lastFrameTime());
    }
    expect(seen).toEqual([5, 30, 5, 30]);
  });

  it("leave out a chart's first frame whole, with what it left out", async () => {
    const { schedule, leaveOut, lastFrameTime } = await scheduler();
    // A first frame that also plans a view asked for before it: nothing of
    // it counts, so nothing of it is left out of the others' 12 ms.
    schedule(chart(leaveOut, 30, 30, true));
    schedule(chart(leaveOut, 12));
    run();
    expect(lastFrameTime()).toBe(12);
    // The next frame may still leave work out.
    schedule(chart(leaveOut, 30, 25));
    run();
    expect(lastFrameTime()).toBe(5);
  });
});
