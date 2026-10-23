// Automatic padding ("auto"): room at the ends of a fitted domain for what
// marks draw past their data there, such as a point's radius and outline
// or bar labels. Marks that ask for room carry this solver (`Mark.clearDomain`),
// so charts of marks that ask for none do not load it.

import type { AxisType } from "./axis.ts";

/**
 * Widens an automatic domain so marks drawing `low` pixels past its low
 * end's data and `high` past its high end's stay inside a plot `pixels`
 * long, solved at once. Applied after rounding to nice values, so ticks
 * stay round and the axis ends just past them; log domains widen in log
 * space. Plots less than twice as long as the room asked keep the data
 * domain rather than shrinking the data to a point.
 */
export function clearDomain(
  domain: [number, number],
  low: number,
  high: number,
  pixels: number,
  type: AxisType,
): [number, number] {
  if (!(low + high > 0) || pixels <= 2 * (low + high)) return domain;
  const log = type === "log";
  const lo = log ? Math.log10(domain[0]) : domain[0];
  const hi = log ? Math.log10(domain[1]) : domain[1];
  const step = (hi - lo) / (pixels - low - high);
  const ends: [number, number] = [lo - low * step, hi + high * step];
  const widened: [number, number] = log ? [10 ** ends[0], 10 ** ends[1]] : ends;
  // Domains near the limits of floating point keep their data ends.
  return widened.every((v) => Number.isFinite(v) && (!log || v > 0)) ? widened : domain;
}
