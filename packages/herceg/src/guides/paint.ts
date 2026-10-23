// Panels' paint plans: the order of each panel's grid lines and geometry
// where zIndex values change it from the order they are listed in (see
// scene/paint.ts for the rules). Charts that give zIndex values load this
// with the guide compiler; others paint in the order listed.

import type { Panel } from "../scene/scene.ts";

/** A panel's paint order and the zIndex values it was made of, kept while they stay. */
export interface PaintPlan {
  readonly zs: readonly number[];
  /** Indexes into the panel's grid batches and geometry listed one after the other. */
  readonly order: readonly number[];
}

/**
 * The order to paint `grids` and then `geometry` in, each at its `zIndex`
 * (geometry's 0 when absent; see scene/paint.ts): `kept` while the
 * values are its own, undefined when they are in order already.
 */
export function paintOrder(
  grids: readonly { readonly zIndex: number }[],
  geometry: readonly { readonly zIndex?: number | undefined }[],
  kept?: PaintPlan,
): PaintPlan | undefined {
  const count = grids.length + geometry.length;
  const z = (i: number) =>
    i < grids.length ? grids[i]!.zIndex : (geometry[i - grids.length]!.zIndex ?? 0);
  let sorted = true;
  let same = kept?.zs.length === count;
  for (let i = 0; i < count; i++) {
    if (i > 0 && z(i) < z(i - 1)) sorted = false;
    if (same && kept!.zs[i] !== z(i)) same = false;
  }
  if (sorted) return undefined;
  if (same) return kept;
  const zs = Array.from({ length: count }, (_, i) => z(i));
  // Sorting is stable, so ties keep the order above.
  const order = zs.map((_, i) => i).sort((a, b) => zs[a]! - zs[b]!);
  return { zs, order };
}

/**
 * Sets each of `panels`' paint order (`Panel.paint`) where zIndex values
 * change it, keeping each panel's plan in `plans` (by panel key) while its
 * values stay and its panel is drawn. Charts that give zIndex values load
 * it with the guide compiler.
 */
export function planPanels(panels: readonly Panel[], plans: Map<string, PaintPlan>): void {
  let planned = 0;
  for (const panel of panels) {
    const plan = paintOrder(panel.grids, panel.marks, plans.get(panel.key));
    if (plan) {
      plans.set(panel.key, plan);
      planned++;
    } else plans.delete(panel.key);
    panel.paint = plan?.order;
  }
  if (plans.size > planned)
    for (const key of plans.keys())
      if (!panels.some((panel) => panel.key === key)) plans.delete(key);
}
