// Scales' explicit padding: a share of what the scale shows, or pixels, at
// each end, in place of automatic clearance (`padding: 0` is tight). It
// widens a fitted domain after rounding, a domain set, and a view alike,
// in the scale's own space: logarithms on log axes, time shown on axes with
// breaks. Interaction reads views back through `unpad`, so a pan or zoom
// asks for the view whose padding shows what it dragged to, and padding
// does not pile up.

import type { AxisContext, AxisPadding } from "../model/axis.ts";
import type { GuideKit } from "../model/guides.ts";

/**
 * The padding of an axis of `context`, given `padding`, set at `path`
 * (for messages): a share of its span or `{ px }` at each end.
 */
export function axisPadding(
  kit: GuideKit,
  context: AxisContext,
  padding: number | { px: number },
  path: string,
): AxisPadding {
  const log = context.type === "log";
  const { breaks } = context;
  /** How far each end moves, as a share of the span shown, over `pixels`. */
  const share = (pixels: number) => {
    if (typeof padding === "number") return padding;
    const { px } = padding;
    if (2 * px >= pixels)
      throw new kit.ChartError({
        code: "layout-failed",
        phase: "layout",
        path: `${path}.px`,
        message: `chart ${path}.px: ${px} pixels at each end leave no room in a plot ${Math.round(pixels)} pixels long; increase the plot size or reduce padding`,
      });
    return px / (pixels - 2 * px);
  };
  /** `domain` changed by `change` in the scale's own space; undefined past what numbers hold. */
  const within = (
    domain: readonly [number, number],
    change: (ends: [number, number]) => [number, number],
  ): [number, number] | undefined => {
    let ends: [number, number];
    if (breaks) ends = breaks.inPositions([domain[0], domain[1]], change);
    else if (!log) ends = change([domain[0], domain[1]]);
    else {
      const [a, b] = change([Math.log10(domain[0]), Math.log10(domain[1])]);
      ends = [10 ** a, 10 ** b];
    }
    return ends.every((v) => Number.isFinite(v) && (!log || v > 0)) ? ends : undefined;
  };
  return {
    pad: (domain, pixels) => {
      const k = share(pixels);
      // No padding changes nothing, near the limits of floating point too.
      if (k === 0) return [domain[0], domain[1]];
      const padded = within(domain, ([a, b]) => [a - (b - a) * k, b + (b - a) * k]);
      // Drawn as it is, the domain could not be read back: refused instead.
      if (!padded)
        throw new kit.ChartError({
          code: "layout-failed",
          phase: "layout",
          path,
          message: `chart ${path}: padding the domain from ${domain[0]} to ${domain[1]} reaches past what numbers hold; reduce the padding or narrow the domain`,
        });
      return padded;
    },
    unpad: (domain, pixels) => {
      const k = share(pixels);
      if (k === 0) return [domain[0], domain[1]];
      const view = within(domain, ([a, b]) => {
        const end = ((b - a) * k) / (1 + 2 * k);
        return [a + end, b - end];
      });
      return view ?? [domain[0], domain[1]];
    },
  };
}
