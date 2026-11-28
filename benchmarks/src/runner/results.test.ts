import { describe, expect, it } from "vitest";
import type { PageResult } from "../page/timed.ts";
import { statusOf, withPasses } from "./results.ts";

const ms = (...samples: number[]) => ({ unit: "ms" as const, samples });
const measured = (metrics: PageResult["metrics"]): PageResult => ({ supported: true, metrics });

describe("rows with extra passes", () => {
  const main = () => measured({ timeToFrame: ms(10, 11), retainedBytes: ms(500) });

  it("joins every pass's readings to the main run's", () => {
    const { result, fullCostReason } = withPasses(main(), [
      measured({ retainedBytes: ms(510), firstRetainedBytes: ms(900) }),
      measured({ retainedBytes: ms(520), firstRetainedBytes: ms(910) }),
    ]);
    expect(fullCostReason).toBeUndefined();
    expect(result.metrics).toEqual({
      timeToFrame: ms(10, 11),
      retainedBytes: ms(500, 510, 520),
      firstRetainedBytes: ms(900, 910),
    });
  });

  it("makes the row incorrect, with no readings, when a later pass is incorrect", () => {
    const { result } = withPasses(main(), [
      measured({ firstRetainedBytes: ms(900) }),
      { supported: false, incorrect: true, reason: "incorrect: drew 3 items, not 4", metrics: {} },
    ]);
    expect(statusOf(result)).toBe("incorrect");
    expect(result.metrics).toEqual({});
  });

  it("keeps the main run's readings alone, with the reason, when a later pass errs", () => {
    const { result, fullCostReason } = withPasses(main(), [
      measured({ firstRetainedBytes: ms(900) }),
      { supported: false, reason: "error: the page crashed", metrics: {} },
    ]);
    expect(statusOf(result)).toBe("measured");
    // The pass that measured before the error is left out too: all or none.
    expect(result.metrics).toEqual(main().metrics);
    expect(fullCostReason).toBe("error: the page crashed");
  });

  it("leaves the main result unchanged by the passes it joins", () => {
    const first = main();
    withPasses(first, [measured({ retainedBytes: ms(510) })]);
    expect(first.metrics.retainedBytes!.samples).toEqual([500]);
  });
});
