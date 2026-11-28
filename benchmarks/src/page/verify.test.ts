import { afterEach, describe, expect, it } from "vitest";
import { Incorrect, limits, verifiedOperation } from "./verify.ts";

const saved = { ...limits };
afterEach(() => Object.assign(limits, saved));

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) =>
      left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(n);
  });

describe("verified frames", () => {
  it("refuses frames that do not show the result, and ends at the first that does", async () => {
    // A library that shows the result three frames after the call.
    let shown = "old";
    const verified = await verifiedOperation(
      () => {
        void frames(3).then(() => {
          shown = "new";
        });
      },
      () => (shown === "new" ? undefined : `showed ${shown}`),
    );
    expect(verified.rejected).toBeGreaterThanOrEqual(2);
    expect(verified.time).toBeGreaterThan(verified.first);
    expect(verified.checkTime).toBeGreaterThanOrEqual(0);
  });

  it("checks the frame the operation draws in first, since it watches before the call", async () => {
    let shown = "old";
    const verified = await verifiedOperation(
      () => {
        requestAnimationFrame(() => {
          shown = "new";
        });
      },
      () => (shown === "new" ? undefined : `showed ${shown}`),
    );
    expect(verified.rejected).toBe(0);
    expect(verified.time).toBe(verified.first);
  });

  it("does not check before the library's progressive rendering finished", async () => {
    let checked = 0;
    const start = performance.now();
    const verified = await verifiedOperation(
      () => {},
      () => {
        checked++;
        return undefined;
      },
      () => new Promise((resolve) => setTimeout(resolve, 100)),
    );
    expect(verified.time).toBeGreaterThanOrEqual(100);
    expect(performance.now() - start).toBeGreaterThanOrEqual(100);
    expect(checked).toBe(1);
  });

  it("is incorrect when no frame shows the result after the operation finished", async () => {
    limits.settled = 200;
    const failed = verifiedOperation(
      () => {},
      () => "showed the old data",
    );
    await expect(failed).rejects.toBeInstanceOf(Incorrect);
    await expect(failed).rejects.toThrow(/showed the old data/);
  });

  it("fails with the library's progressive rendering when it fails", async () => {
    const failed = verifiedOperation(
      () => {},
      () => undefined,
      () => Promise.reject(new Error("the renderer failed")),
    );
    await expect(failed).rejects.toThrow("the renderer failed");
  });

  it("passes on an operation's own failure, not as incorrect", async () => {
    const failed = verifiedOperation(
      () => {
        throw new Error("the library threw");
      },
      () => undefined,
    );
    await expect(failed).rejects.toThrow("the library threw");
    await expect(failed).rejects.not.toBeInstanceOf(Incorrect);
  });
});
