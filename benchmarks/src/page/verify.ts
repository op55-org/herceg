// Verified frames: a timed operation ends at the first frame that shows its
// result, checked just before the frame paints (frames.ts), not at the next
// frame after the call. The check reads what the library drew (see
// adapter.ts, `Drawn`) against what the operation asked (expect.ts), the
// same comparison for every library. Each frame is checked once it has
// started: the observer is armed before the operation is called, so a
// frame the operation draws in at once is the first one checked.

import { checkedFrame } from "./frames.ts";

/** A timed operation's verified frame. */
export interface Verified {
  /** The `performance.now()` time the timing started at. */
  start: number;
  /** ms from the start to the end of the first frame that showed the result. */
  time: number;
  /** ms from the start to the end of the first frame after it, whatever it showed. */
  first: number;
  /** Frames checked before it that did not show the result. */
  rejected: number;
  /** Frames in which the pre-paint observer did not run, so nothing was checked. */
  unobserved: number;
  /** ms the checks took, inside `time`. */
  checkTime: number;
}

/** No frame showed the operation's result in time: the library, or its adapter, drew something else. */
export class Incorrect extends Error {
  override name = "Incorrect";
}

/** How long frames may take to show a result before the operation counts as incorrect, ms; tests shorten them. */
export const limits = {
  /**
   * From the operation's start: long enough for the slowest library's
   * slowest scenario (Plotly mounting 10M points takes about 40 s).
   */
  shown: 120_000,
  /**
   * From the operation returning and its progressive rendering finishing:
   * a library has drawn by then, so a wrong drawing that persists is not a
   * slow one.
   */
  settled: 15_000,
};

export interface Watch {
  /** Resolves at the first frame that showed the result; rejects with `Incorrect` past the limit. */
  shown: Promise<Verified>;
  /** Stops watching (the operation failed); `shown` rejects with `reason`. */
  cancel(reason: unknown): void;
}

/**
 * Watches the frames after `start` (a `performance.now()` time) for the
 * first in which `check` returns undefined (shown) while `settled()` holds
 * (the operation returned and the library's progressive rendering, if any,
 * finished). `check` returns what is wrong otherwise. Call it before
 * starting the operation. Past `limitMs` from the start, or
 * `limits.settled` from settling, a wrong frame makes it `Incorrect`.
 */
export function watchFrames(
  start: number,
  check: () => string | undefined,
  settled: () => boolean = () => true,
  limitMs = limits.shown,
): Watch {
  let cancelled: { reason: unknown } | undefined;
  const run = async (): Promise<Verified> => {
    let first: number | undefined;
    let rejected = 0;
    let unobserved = 0;
    let checkTime = 0;
    let wrong = "no frame was observed";
    let settledAt: number | undefined;
    for (;;) {
      const frame = await checkedFrame(() => {
        if (!settled()) return "the library has not finished rendering";
        settledAt ??= performance.now();
        return check();
      });
      if (cancelled) throw cancelled.reason;
      first ??= frame.time - start;
      if (!frame.observed) unobserved++;
      else {
        checkTime += frame.spent;
        if (frame.value === undefined)
          return { start, time: frame.time - start, first, rejected, unobserved, checkTime };
        rejected++;
        wrong = frame.value;
      }
      if (frame.time - start > limitMs)
        throw new Incorrect(`no frame showed the result within ${limitMs / 1000} s: ${wrong}`);
      if (settledAt !== undefined && frame.time - settledAt > limits.settled)
        throw new Incorrect(
          `no frame showed the result within ${limits.settled / 1000} s of the operation finishing: ${wrong}`,
        );
    }
  };
  return {
    shown: run(),
    cancel(reason) {
      cancelled = { reason };
    },
  };
}

/**
 * Times `operation` from its call to the first frame `check` verifies,
 * waiting for `pending()` (a library's progressive rendering of the change)
 * once the operation has returned.
 */
export async function verifiedOperation(
  operation: () => unknown,
  check: () => string | undefined,
  pending?: () => Promise<unknown> | undefined,
): Promise<Verified> {
  let settled = false;
  const start = performance.now();
  const watch = watchFrames(start, check, () => settled);
  try {
    await operation();
  } catch (error) {
    watch.cancel(error);
    await watch.shown.catch(() => {});
    throw error;
  }
  const rendering = pending?.();
  if (rendering)
    rendering.then(
      () => {
        settled = true;
      },
      // A library's progressive rendering failed: the operation fails with it.
      (error) => watch.cancel(error),
    );
  else settled = true;
  return watch.shown;
}
