// The compilers and the display code static output draws with: what a
// live chart loads when its options need it, imported here, since static
// output is drawn at once.

import * as displayCode from "../fields/compile.ts";
import { guideCompiler } from "../guides/compile.ts";
import { staticColors } from "../marks/colored.ts";
import { featureCompiler } from "../marks/features/compile.ts";
import type { FeatureCompiler } from "../model/features.ts";
import { GUIDE_KIT, type GuideCompiler, LOADED } from "../model/guides.ts";
import { cssColor } from "../scale/css-color.ts";

let made: [GuideCompiler, FeatureCompiler] | undefined;

/**
 * Colors static output reads: hex, `rgb()`, `hsl()`, and CSS's names, which
 * it can draw in PDF, `var()`, read to its fallback, and other functions
 * (`color-mix()`) and `currentColor`, which SVG passes on.
 */
const isColor = (value: string) =>
  cssColor(value) !== undefined ||
  /^[a-z-]+\(.*\)$/i.test(value.trim()) ||
  value.trim().toLowerCase() === "currentcolor";
// Marks made without a browser tell colors from fields so too.
staticColors.isColor = isColor;

/** The guide compiler and the feature compiler, made on first use, with the display code they use. */
export function staticCompilers(): [GuideCompiler, FeatureCompiler] {
  LOADED[2] ??= displayCode;
  made ??= [guideCompiler(GUIDE_KIT), featureCompiler({ ...GUIDE_KIT, isColor })];
  return made;
}
