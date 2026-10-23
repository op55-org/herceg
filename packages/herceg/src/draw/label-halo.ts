// Halos of marks' labels (see draw/text.ts for drawing them).

import type { Halo } from "../spec/style.ts";
import { haloOf, type ResolvedHalo } from "../style/style.ts";
import { type PaintReader, surface, type Theme } from "../theme.ts";

/**
 * The halo that keeps a mark's labels readable over lines and fills, as the
 * mark's `halo` asks ("auto" when left out; see `haloOf`), over what its
 * frame draws on: the plot's fill, or the surface the chart is drawn on.
 */
export function labelHalo(
  halo: Halo | undefined,
  frame: { theme: Theme; surface?: string | undefined; paint: PaintReader },
): ResolvedHalo | undefined {
  const resolved = haloOf(halo ?? "auto", frame.surface ?? surface(frame.theme));
  // A color of the halo's own is the mark's option, read as its other colors are.
  return resolved && typeof halo === "object"
    ? { ...resolved, color: frame.paint(resolved.color, "halo.color") }
    : resolved;
}
