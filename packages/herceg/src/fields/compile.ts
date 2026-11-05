// What a chart loads for field displays (`fields`) and series named by
// parts, in a chunk of its own: charts without them never load it, nor the
// rules and checks of displays it brings. The module is the chart's
// `DisplayCode` (model/features.ts): the compilers take it from the chart,
// so neither imports it.

import type { TimeZone } from "../format/zone.ts";
import { guideFields } from "../guides/fields.ts";
import { itemLegends } from "../marks/features/item-legends.ts";
import { displayedContent } from "../marks/features/label-displays.ts";
import { naming } from "../marks/features/names.ts";
import { type ChartFieldKit, type ChartFields, chartFields } from "./chart.ts";
import type { FieldDisplays } from "./rules.ts";

/**
 * Displays compiled, by the displays given and the locale and zone they
 * write in: the two compilers of a chart, and charts sharing displays,
 * compile them once.
 */
const compiled = new WeakMap<FieldDisplays, Map<string, ChartFields>>();

/** See `DisplayCode.chartFields`. */
export function chartFieldsOf(
  fields: FieldDisplays,
  kit: ChartFieldKit,
  locale: string | undefined,
  zone: TimeZone,
): ChartFields {
  let byPlace = compiled.get(fields);
  if (!byPlace) {
    byPlace = new Map();
    compiled.set(fields, byPlace);
  }
  const key = `${locale} ${zone}`;
  let made = byPlace.get(key);
  if (!made) {
    made = chartFields(fields, kit, locale, zone);
    byPlace.set(key, made);
  }
  return made;
}

export { displayedContent, guideFields, itemLegends, naming };
