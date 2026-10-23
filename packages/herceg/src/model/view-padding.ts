// Views and the ranges axes draw for them. A view (a viewport, or a domain
// set) is what is asked for; its axis draws it widened by the padding its
// settings give (guides/padding.ts), over the pixels its plan was padded
// over (`AxisPlan.padded`, the shortest plot sharing the scale). What reads
// a drawn range back as a view (gestures, the navigator, edge events) goes
// through `unpadded`, so padding never piles up.

import type { AxisPlan } from "./axis.ts";

/** `view` as the axis `plan` planned draws it: with its padding, or as it is. */
export function padded(
  plan: AxisPlan | undefined,
  view: readonly [number, number],
): readonly [number, number] {
  const padding = plan?.context?.padding;
  return padding && plan.padded !== undefined ? padding.pad(view, plan.padded) : view;
}

/** The view the axis `plan` planned draws as `drawn`: its padding taken off, or as it is. */
export function unpadded(
  plan: AxisPlan | undefined,
  drawn: readonly [number, number],
): [number, number] {
  const padding = plan?.context?.padding;
  return padding && plan.padded !== undefined
    ? padding.unpad(drawn, plan.padded)
    : [drawn[0], drawn[1]];
}
