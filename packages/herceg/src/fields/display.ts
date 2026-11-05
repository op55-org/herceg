// A field's display, resolved from its rules, for writing and coloring
// values: its label, description, bounds, and each value's text and color,
// in the order every surface reads them: a missing value takes `missing`;
// otherwise the first mapping that matches gives its text and color;
// otherwise the format writes the value and the thresholds color it.

import type { RowView } from "../data/row-view.ts";
import type { PositionField, ReadValue, Schema, Table } from "../data/table.ts";
import type { Formatter } from "../format/format.ts";
import { type FormatKit, formatWriter } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { DisplayedKind, FieldDisplay, MissingDisplay, ValueMapping } from "../spec/fields.ts";
import type { FormatSpec } from "../spec/guides.ts";
import { checkFormat, holds, misfit } from "./check.ts";
import type { ColumnDisplay, GridColumnSettings } from "./grid.ts";
import { type LinkRows, type LinkWrite, linker, type RowLink } from "./links.ts";
import type { FieldDisplays, FieldOf, Resolved } from "./rules.ts";

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
  /**
   * The surface's format of values of the kind it writes, where neither
   * `format` nor the field's displays give one (a grid's times, to the
   * second): numbers as charts write them and times as dates with times of
   * day by default.
   */
  defaultFormat?: FormatSpec | undefined;
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
  /**
   * A value in the field's format, or the missing text, without mappings:
   * how a value computed from the field's values in its units (a mean, a
   * sum, a maximum) is written, since it is not one of them.
   */
  format(value: ReadValue<K>): string;
  /**
   * A value's display color: the missing color for a missing value, its
   * mapping's color, or its step's (`thresholds`); undefined where none
   * gives one, which surfaces draw in their own paint.
   */
  color(value: ReadValue<K>): string | undefined;
  /**
   * Row `row`'s link, as the field's `link` makes it from `table` (a row
   * view's: its table's row `row`): its URL, and its text, written as
   * `text` writes values; undefined where the field has no link, the row
   * misses a value its URL reads, or the URL's scheme is not http, https,
   * mailto, or none (relative).
   */
  // biome-ignore lint/suspicious/noExplicitAny: a table of any schema holding the field.
  link(table: Table<any> | RowView<any> | LinkRows, row: number): RowLink | undefined;
}

/**
 * Field displays checked and compiled once: what surfaces that take field
 * display through an explicit import read, and displays of many fields
 * without checking the rules again for each.
 */
export interface CompiledFields {
  /** The displays, as given. */
  readonly displays: FieldDisplays;
  /** A field's display, as `displayOf` gives it. */
  displayOf<K extends DisplayedKind>(
    of: { field: string; kind: K; table?: string },
    settings?: DisplaySettings,
  ): DisplayedField<K>;
  displayOf<S extends Schema, F extends PositionField<S>>(
    of: { table: Table<S> | RowView<S>; field: F },
    settings?: DisplaySettings,
  ): DisplayedField<S[F] & DisplayedKind>;
  /**
   * What a grid column (its field, and its own title and format) of a field
   * of `kind` in `table` (a table, or a remote source's name) shows through
   * the displays, in the grid's locale and zone (`settings`): grid models
   * call it where they are given displays.
   */
  column<S extends Schema>(
    column: GridColumnSettings,
    kind: DisplayedKind,
    table: Table<S> | string | undefined,
    settings: DisplaySettings,
  ): ColumnDisplay;
}

/** What grid cells read a field's values from: a table, or a remote grid's window of rows. */
export interface FieldColumns {
  numbers(field: string): ArrayLike<number>;
  categories(field: string): {
    readonly codes: ArrayLike<number>;
    readonly dictionary: readonly string[];
    /** Changes where the dictionary was compacted in place (see `Table.categories`). */
    readonly revision?: number;
  };
}

/** A display's settings once resolved, without the `false` that resets them. */
export type ResolvedDisplay = {
  [K in keyof FieldDisplay]?: Exclude<FieldDisplay[K], false>;
};

/** Times written without a format: the date and the time of day. */
/** How times are written without a format: dates with times of day. */
export const DATE_TIME = { dateStyle: "medium", timeStyle: "short" } as const;

/**
 * `field`'s display from `resolved`, writing with `kit` where `settings`
 * says, and its link's other fields as `textOf(table, name)` writes them;
 * `surface` names the settings in messages ("displayOf").
 */
export function displayed<K extends DisplayedKind>(
  field: FieldOf & { kind: K },
  { settings, from }: Resolved,
  kit: DisplayKit,
  {
    locale,
    timeZone = "local",
    format: own,
    defaultFormat,
    missing: fallback = "–",
  }: DisplaySettings,
  surface: string,
  textOf: (table: LinkRows, name: string) => LinkWrite,
): DisplayedField<K> {
  const { name, kind } = field;
  const display = settings as ResolvedDisplay;
  if (own !== undefined) {
    checkFormat(own, `${surface} settings.format`, kit);
    const wrong = misfit(kind, "format", own);
    if (wrong) throw new Error(`${surface} settings.format: ${wrong.problem(holds(name, kind))}`);
  }
  if (defaultFormat !== undefined)
    checkFormat(defaultFormat, `${surface} settings.defaultFormat`, kit);
  const given =
    own ?? display.format ?? (misfit(kind, "format", defaultFormat) ? undefined : defaultFormat);
  const at = display.format && !own ? `${surface} ${from.format}.format` : `${surface} settings`;
  const write: Formatter | undefined = given
    ? formatWriter(kit, given, kind === "time", timeZone, locale, at)
    : kind === "number"
      ? (value) => kit.formatNumber(value, locale)
      : kind === "time"
        ? kit.timeFormatter(DATE_TIME, timeZone, locale)
        : undefined;
  const mapped = display.mappings && mapper(display.mappings);
  const { label = name, description, min, max } = display;
  const missing = missingText(display.missing) ?? fallback;
  // A value not missing is a number or text.
  const format = (value: ReadValue<K>) =>
    missingValue(kind, value) ? missing : typeof value === "string" ? value : write!(value!);
  const text = (value: ReadValue<K>) =>
    (missingValue(kind, value) ? undefined : mapped?.(value!)?.text) ?? format(value);
  const color = colorer(kind, display, mapped) ?? (() => undefined);
  const linked = display.link && linker(display.link, name, `${surface} ${from.link}.link`, textOf);
  return {
    field: name,
    kind,
    label,
    description,
    min,
    max,
    text,
    format,
    color,
    link: (table, row) =>
      linked?.("source" in table ? table.source : table, row, text as LinkWrite),
  };
}

/** The text of missing values a display's `missing` gives, if it gives one. */
export function missingText(missing: string | MissingDisplay | undefined): string | undefined {
  return typeof missing === "object" ? missing.text : missing;
}

/**
 * A display's thresholds, their steps' values in the field's units (a
 * percent step's turned into a value between the display's bounds), and
 * the keys of what they place: each step's value as given ("500"; a
 * percent step's percent, "70"), whatever bounds turn it into.
 */
export interface Steps {
  readonly base: string | undefined;
  readonly keys: readonly string[];
  readonly values: readonly number[];
  readonly colors: readonly string[];
}

/** The steps of `display`'s thresholds; undefined without thresholds. */
export function stepsOf(display: ResolvedDisplay): Steps | undefined {
  const { thresholds, min = 0, max = 0 } = display;
  if (!thresholds) return undefined;
  const { steps } = thresholds;
  const percent = thresholds.mode === "percent";
  return {
    base: thresholds.base,
    keys: steps.map(({ value }) => String(value)),
    values: steps.map(({ value }) => (percent ? between(min, max, value) : value)),
    colors: steps.map(({ color }) => color),
  };
}

/**
 * `percent` of the way from `min` to `max`: the bounds themselves at 0 and
 * 100, exact for whole percents of whole bounds, and in units of the larger
 * bound where the span overflows (near the largest numbers).
 */
function between(min: number, max: number, percent: number): number {
  if (percent === 0) return min;
  if (percent === 100) return max;
  const at = min + ((max - min) * percent) / 100;
  if (Number.isFinite(at)) return at;
  // In units of the larger bound, nothing overflows before the result does.
  const unit = Math.max(Math.abs(min), Math.abs(max));
  const [lo, hi] = [min / unit, max / unit];
  return (lo + (hi - lo) * (percent / 100)) * unit;
}

/**
 * Which of `steps` colors `value`: the number of steps at or below it, so 0
 * for the base (values below the first step) and i for step i - 1. Steps
 * include their own value.
 */
export function stepAt(steps: Steps, value: number): number {
  const { values } = steps;
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * A display's colors of values of `kind`: the missing color, else the
 * first matching mapping's color (`mapped`), else the color of the step
 * the value is in; undefined where the display gives no colors.
 */
export function colorer(
  kind: DisplayedKind,
  display: ResolvedDisplay,
  mapped: ((value: number | string) => Shown | undefined) | undefined,
): ((value: number | string | null) => string | undefined) | undefined {
  const steps = stepsOf(display);
  const lost = typeof display.missing === "object" ? display.missing.color : undefined;
  if (!steps && lost === undefined && !display.mappings?.some((one) => one.color !== undefined))
    return undefined;
  return (value) => {
    if (missingValue(kind, value)) return lost;
    const shown = mapped?.(value!);
    if (shown?.color !== undefined) return shown.color;
    if (!steps || typeof value !== "number") return undefined;
    const at = stepAt(steps, value);
    return at === 0 ? steps.base : steps.colors[at - 1];
  };
}

/**
 * Whether `value` of a field of `kind` is missing: null (a missing
 * category), NaN, or for times one beyond what dates hold (an infinity among them).
 */
export function missingValue(kind: DisplayedKind, value: number | string | null): boolean {
  return (
    value === null ||
    (typeof value === "number" &&
      (kind === "time" ? !(Math.abs(value) <= 8.64e15) : Number.isNaN(value)))
  );
}

/** What a mapping shows a value as: its text and color, either of which it may leave out. */
export interface Shown {
  readonly text?: string | undefined;
  readonly color?: string | undefined;
}

/**
 * What the first of `mappings` that matches a value shows it as (its text,
 * a regular expression's groups written into it, and its color), or
 * undefined where none matches.
 */
export function mapper(
  mappings: readonly ValueMapping[],
): (value: number | string) => Shown | undefined {
  const tests = mappings.map((mapping): ((value: number | string) => Shown | undefined) => {
    const { text } = mapping;
    if (mapping.regex !== undefined) {
      const pattern = new RegExp(mapping.regex);
      return (value) => {
        const match = typeof value === "string" ? pattern.exec(value) : null;
        // "$1" to "$9" write the expression's groups.
        return match
          ? {
              text: text?.replace(/\$(\d)/g, (_, group: string) => match[Number(group)] ?? ""),
              color: mapping.color,
            }
          : undefined;
      };
    }
    if (mapping.between !== undefined) {
      const [from, to] = mapping.between;
      return (value) =>
        typeof value === "number" &&
        (from === null || value >= from) &&
        (to === null || value <= to)
          ? mapping
          : undefined;
    }
    return (value) => (value === mapping.value ? mapping : undefined);
  });
  return (value) => {
    for (const test of tests) {
      const shown = test(value);
      if (shown) return shown;
    }
    return undefined;
  };
}
