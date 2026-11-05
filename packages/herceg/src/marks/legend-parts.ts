// Legends of color scales and of point sizes and shapes, as marks list them:
// ramps (ramp-legend.ts) and keys (key-legend.ts), keys laid out with the
// chart's text helpers.

import { centeredLines, textHeight, textItem, textWidth } from "../layout/text.ts";
import type { LegendPart } from "../model/legend.ts";
import { keyLegendWith } from "./key-legend.ts";
import type { ColorRamp, GlyphKey } from "./mark.ts";
import { rampLegend } from "./ramp-legend.ts";

const KEY_KIT = { textItem, centeredLines, textWidth, textHeight };

/** A key of glyphs (see `keyLegendWith`). */
export function keyLegend(key: GlyphKey): LegendPart {
  return keyLegendWith(KEY_KIT, key);
}

/** Legends for a mark's color scales and keys, color scales first. */
export function legendParts(ramps: readonly ColorRamp[], keys: readonly GlyphKey[]): LegendPart[] {
  return [...ramps.map(rampLegend), ...keys.map(keyLegend)];
}
