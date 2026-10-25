// Marks whose drawing does not move to changed values refuse
// `animation.values` in every frame they draw: moving the marks and axes
// beside them would leave theirs standing apart. Only their modules import
// this, so charts without them carry none of it.

import { ChartError } from "../spec/errors.ts";

/** Throws, in a frame of a chart animating values (`keyed`), that marks of `type` do not move. */
export function refuseValues(keyed: boolean | undefined, type: string): void {
  if (!keyed) return;
  const marks = type === "custom" ? "custom marks do" : `${type} does`;
  throw new ChartError({
    code: "unsupported",
    path: "animation.values",
    // A refusal of the options, found as the chart draws them.
    phase: "validate",
    message: `animation.values: ${marks} not move to new values; leave values out, and new values show at once`,
  });
}
