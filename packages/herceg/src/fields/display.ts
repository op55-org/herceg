// A field's display, resolved from its rules, for writing values: its
// label, description, bounds, and each value's text, written in the order
// every surface writes values: a missing value takes `missing`; otherwise
// the first mapping that matches gives its text; otherwise the format
// writes the value.

import type { ReadValue } from "../data/table.ts";
import type { Formatter } from "../format/format.ts";
import { type FormatKit, formatWriter } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { DisplayedKind, FieldDisplay, ValueMapping } from "../spec/fields.ts";
import type { FormatSpec } from "../spec/guides.ts";
import { checkFormat, holds, misfit } from "./check.ts";
import type { FieldOf, Resolved } from "./rules.ts";

/** The chart's code a display writes with (see `GuideKit`): its formatters and zone arithmetic. */
export type DisplayKit = FormatKit & { formatNumber(value: number, locale?: string): string };

/** Where and how values are written. */
export interface DisplaySettings {
  /** The locale, as a chart's: the runtime's by default. */
  locale?: string | undefined;
  /** The time zone times are written in: "local" by default. */
  timeZone?: TimeZone | undefined;
  /**
   * A format of the surface's own (a grid column's, a KPI tile's), over the
   * field's: missing values and mappings still read as the field says.
   */
  format?: FormatSpec | undefined;
  /** The surface's text of missing values where the field's displays give none: "–" by default. */
  missing?: string | undefined;
}

/** A field's display, its rules resolved: what application code (a KPI tile, a cell) shows of it. */
export interface DisplayedField<K extends DisplayedKind = DisplayedKind> {
  readonly field: string;
  readonly kind: K;
  /** Its label, else its name. */
  readonly label: string;
  readonly description: string | undefined;
  /** Its bounds (number fields), where its rules give them. */
  readonly min: number | undefined;
  readonly max: number | undefined;
  /**
   * A value as surfaces write it: the missing text (the surface's, "–" by
   * default, where the field gives none) for a missing value, a mapping's
   * text, or the value in its format (numbers and times as charts write
   * them by default, categories as they are).
   */
  text(value: ReadValue<K>): string;
}

/** A display's settings once resolved, without the `false` that resets them. */
type ResolvedDisplay = {
  [K in keyof FieldDisplay]?: Exclude<FieldDisplay[K], false>;
};

/** Times written without a format: the date and the time of day. */
const DATE_TIME = { dateStyle: "medium", timeStyle: "short" } as const;

/**
 * `field`'s display from `resolved`, writing with `kit` where `settings`
 * says; `surface` names the settings in messages ("displayOf").
 */
export function displayed<K extends DisplayedKind>(
  field: FieldOf & { kind: K },
  { settings: display, from }: Resolved,
  kit: DisplayKit,
  { locale, timeZone = "local", format: own, missing: fallback = "–" }: DisplaySettings,
  surface: string,
): DisplayedField<K> {
  const { name, kind } = field;
  const { mappings } = display as ResolvedDisplay;
  if (own !== undefined) {
    checkFormat(own, `${surface} settings.format`, kit);
    const wrong = misfit(kind, "format", own);
    if (wrong) throw new Error(`${surface} settings.format: ${wrong.problem(holds(name, kind))}`);
  }
  const format = own ?? (display as ResolvedDisplay).format;
  const at = own ? `${surface} settings.format` : `${surface} ${from.format}.format`;
  const write: Formatter | undefined = format
    ? formatWriter(kit, format, kind === "time", timeZone, locale, at)
    : kind === "number"
      ? (value) => kit.formatNumber(value, locale)
      : kind === "time"
        ? kit.timeFormatter(DATE_TIME, timeZone, locale)
        : undefined;
  const mapped = mappings ? mapper(mappings) : undefined;
  // Resolved settings hold no `false`: resetting removed them.
  const { label = name, description, min, max, missing = fallback } = display as ResolvedDisplay;
  return {
    field: name,
    kind,
    label,
    description,
    min,
    max,
    text: (value) => {
      // Times beyond what dates hold (an infinity among them) have no date to write.
      if (
        value === null ||
        (typeof value === "number" &&
          (kind === "time" ? !(Math.abs(value) <= 8.64e15) : Number.isNaN(value)))
      )
        return missing;
      return mapped?.(value) ?? (typeof value === "string" ? value : write!(value));
    },
  };
}

/** The text of the first of `mappings` that matches a value, or undefined where none does. */
function mapper(mappings: readonly ValueMapping[]): (value: number | string) => string | undefined {
  const tests = mappings.map((mapping): ((value: number | string) => string | undefined) => {
    const { text } = mapping;
    if (mapping.regex !== undefined) {
      const pattern = new RegExp(mapping.regex);
      return (value) => {
        const match = typeof value === "string" ? pattern.exec(value) : null;
        // "$1" to "$9" write the expression's groups.
        return match
          ? text.replace(/\$(\d)/g, (_, group: string) => match[Number(group)] ?? "")
          : undefined;
      };
    }
    if (mapping.between !== undefined) {
      const [from, to] = mapping.between;
      return (value) =>
        typeof value === "number" &&
        (from === null || value >= from) &&
        (to === null || value <= to)
          ? text
          : undefined;
    }
    return (value) => (value === mapping.value ? text : undefined);
  });
  return (value) => {
    for (const test of tests) {
      const text = test(value);
      if (text !== undefined) return text;
    }
    return undefined;
  };
}
