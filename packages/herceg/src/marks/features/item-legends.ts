// What layout marks' legends say through a chart's field displays: the
// entries their items stand for, named as every mark sharing them writes
// their value, and their ramps and keys written through their fields. Part
// of the display code (fields/compile.ts), which only charts with `fields`
// load; the feature compiler makes one per configuration, series' naming
// tells it what series name (marks/features/names.ts), and the compiled
// features call it each scene (`CompiledFeatures.listDomains`).

import type { Table } from "../../data/table.ts";
import type { ChartFields } from "../../fields/chart.ts";
import type { LegendEntry, LegendPart } from "../../model/legend.ts";
import type { PaintReader, Theme } from "../../theme.ts";
import type { LayoutMark } from "../layout-mark.ts";

/** What a chart's legend names layout items' entries and parts by. */
export interface ItemNames {
  /** Series of a mark take entries keyed under `prefix`, and name them by `field` of `table`. */
  series(prefix: string, table: Table | undefined, field: string | undefined): void;
  /** The entry keyed `key` is named by a series' own label parts this scene, as they say. */
  own(key: string): void;
  /** Before each scene's series: forgets what their own labels named. */
  scene(): void;
  /**
   * `entries` with those layout items stand for named through the displays,
   * and `parts`, the chart's, written in place.
   */
  write(
    entries: readonly LegendEntry[],
    parts: LegendPart[],
    theme: Theme | undefined,
    paint: PaintReader | undefined,
  ): LegendEntry[];
}

/**
 * The names of the legends of `layouts`, a chart's layout marks, through
 * its `fields`: an entry their items stand for, named by its value or a
 * display's text of it (whichever mark listed it first), takes the text
 * every mark naming it writes alike (`ChartFields.entry`), unless a series'
 * own label parts name it; a radar's one polygon without a series field
 * takes its value field's label; ramps and keys are written through the
 * marks' fields, keeping their keys (subplots' legends own parts by key),
 * and a part several marks share only where they all write it alike.
 * `prefixOf` gives the prefix of the identity keys a mark's items stand
 * for, and `indexOf` its place among the chart's marks.
 */
export function itemLegends(
  layouts: readonly LayoutMark[],
  prefixOf: (mark: LayoutMark) => string,
  indexOf: (mark: LayoutMark) => number,
  fields: ChartFields,
  locale: string | undefined,
): ItemNames {
  // The fields of every mark naming each prefix's entries.
  const namers = new Map<string, [Table | undefined, string | undefined][]>();
  const series = (prefix: string, table: Table | undefined, field: string | undefined) => {
    namers.set(prefix, [...(namers.get(prefix) ?? []), [table, field]]);
  };
  const prefixes: string[] = [];
  // A radar's one polygon, by its legend key.
  const measured = new Map<string, string>();
  for (const mark of layouts) {
    const { identity, measureField } = mark;
    if (identity) {
      const prefix = prefixOf(mark);
      prefixes.push(prefix);
      series(prefix, identity.table ?? mark.table, identity.field);
    }
    const label =
      measureField === undefined ? undefined : fields.of(mark.table, measureField)?.label;
    if (mark.spec.type === "radar" && !identity && label !== undefined)
      measured.set(JSON.stringify([mark.spec.id ?? indexOf(mark), mark.measure]), label);
  }
  const owned = new Set<string>();
  // What a written part shows: its sentence, and a ramp's field's format
  // and zone, which a colorbar writes its ticks in.
  const look = (part: LegendPart) => {
    const scale = part.colorbar;
    const field = scale?.kind === "ramp" ? scale.ramp.field : scale?.field;
    return `${part.describe(locale)}|${field?.formatKey}|${field?.zone}`;
  };
  return {
    series,
    own: (key) => owned.add(key),
    scene: () => owned.clear(),
    write: (entries, parts, theme, paint) => {
      const out = entries.map((entry) => {
        const label = measured.get(entry.key);
        if (label !== undefined) return { ...entry, label };
        const prefix = prefixes.find((prefix) => entry.key.startsWith(prefix));
        if (prefix === undefined || owned.has(entry.key)) return entry;
        const { value } = JSON.parse(entry.key) as { value: string };
        const reads = namers.get(prefix)!;
        const written =
          entry.label === value ||
          reads.some(
            ([table, field]) => field && fields.of(table, field)?.text(value) === entry.label,
          );
        return written ? { ...entry, label: fields.entry(reads, value) } : entry;
      });
      if (!theme || !paint) return out;
      const written = new Map<string, LegendPart | null>();
      for (const mark of layouts) {
        const own = mark.legends?.(theme, locale, paint, fields) ?? [];
        mark.legends?.(theme, locale, paint).forEach(({ key }, i) => {
          const part = { ...own[i]!, key };
          const prior = written.get(key);
          written.set(
            key,
            prior === undefined || (prior && look(prior) === look(part)) ? (prior ?? part) : null,
          );
        });
      }
      parts.forEach((part, i) => {
        parts[i] = written.get(part.key) ?? part;
      });
      return out;
    },
  };
}
