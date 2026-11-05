// A field's display, resolved from its rules, for writing values: its
// label, description, bounds, and each value's text, written in the order
// every surface writes values: a missing value takes `missing`; otherwise
// the first mapping that matches gives its text; otherwise the format
// writes the value.

import type { RowView } from "../data/row-view.ts";
import type { PositionField, ReadValue, Schema, Table } from "../data/table.ts";
import type { Formatter } from "../format/format.ts";
import { type FormatKit, formatWriter } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { DisplayedKind, FieldDisplay, ValueMapping } from "../spec/fields.ts";
import type { FormatSpec } from "../spec/guides.ts";
import { checkFormat, holds, misfit } from "./check.ts";
import type { ColumnDisplay, GridColumnSettings } from "./grid.ts";
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
 * says; `surface` names the settings in messages ("displayOf").
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
  const { label = name, description, min, max, missing = fallback } = display;
  // A value not missing is a number or text.
  const format = (value: ReadValue<K>) =>
    missingValue(kind, value) ? missing : typeof value === "string" ? value : write!(value!);
  const text = (value: ReadValue<K>) =>
    (missingValue(kind, value) ? undefined : mapped?.(value!)) ?? format(value);
  return { field: name, kind, label, description, min, max, text, format };
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

/** The text of the first of `mappings` that matches a value, or undefined where none does. */
export function mapper(
  mappings: readonly ValueMapping[],
): (value: number | string) => string | undefined {
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
