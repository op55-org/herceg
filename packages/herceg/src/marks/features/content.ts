// Labels' text made of parts (`LabelContent`): literal text, a field's
// value at the label's row, the name of the series it labels, and the value
// drawn at its place, each written with its own format. Bars' value labels,
// annotations' labels, and labels following series share it.

import type { Table } from "../../data/table.ts";
import type { Formatter } from "../../format/format.ts";
import { numberPattern, timePattern } from "../../format/patterns.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { LabelContent, LabelPart } from "../../spec/encoding.ts";
import type { FormatSpec } from "../../spec/guides.ts";

/**
 * A label's text at row `row` of the series named `series`, where the
 * value drawn is `value`, a time where `time` says.
 */
export type ContentWriter = (row: number, series: string, value: number, time?: boolean) => string;

/** How times are written where a part gives no format: date and time, in the chart's zone. */
const TIME = { dateStyle: "medium", timeStyle: "short" } as const;

/**
 * Writes `content` at its labels' places: fields of `table` (none for
 * labels of no rows), checked now, numbers as the chart writes them and
 * times in `zone`, or each with its part's format; the value with `value`
 * (how the mark writes values) unless its part has a format, and as a
 * time where the writer is told it is one. `path` names
 * each part (`marks[1].labels.content[0]`) in errors; `has` says what parts
 * the mark's labels can say: `series` and `value` where it has them.
 */
export function writeContent(
  kit: FeatureKit,
  content: LabelContent,
  table: Table | undefined,
  locale: string | undefined,
  zone: string,
  path: (part: number) => string,
  has: { series: boolean; value: boolean },
  value?: Formatter,
): ContentWriter {
  const format = (spec: FormatSpec | undefined, at: string, time: boolean): Formatter => {
    const pattern = spec as { number?: string; time?: string } | undefined;
    if (pattern?.time !== undefined)
      return timePattern(kit, pattern.time, zone, locale, `${at}.format.time`);
    if (pattern?.number !== undefined)
      return numberPattern(kit, pattern.number, locale, `${at}.format.number`);
    // Intl options: a date's for times, in the chart's zone, else a number's.
    if (spec)
      return time
        ? kit.timeFormatter(spec as Intl.DateTimeFormatOptions, zone, locale)
        : kit.numberFormatter(spec as Intl.NumberFormatOptions, locale);
    return time ? kit.timeFormatter(TIME, zone, locale) : (v) => kit.formatNumber(v, locale);
  };
  const writers = content.map((part: LabelPart, i): ContentWriter => {
    const at = path(i);
    if (typeof part === "string") return () => part;
    const kinds = ["field", "series", "value"].filter((key) => key in (part ?? {}));
    if (typeof part !== "object" || part === null || kinds.length !== 1)
      refuse(kit, at, "expected text, { field }, { series: true }, or { value: true }");
    if (part.series) {
      if (!has.series)
        refuse(
          kit,
          at,
          "names the series it labels, and these labels label none; give text or a field",
        );
      return (_row, series) => series;
    }
    if (part.value) {
      if (!has.value)
        refuse(
          kit,
          at,
          "writes the value at the label's place, and these labels have none; give text or a field",
        );
      const write = part.format
        ? format(part.format, at, false)
        : (value ?? format(undefined, at, false));
      // Times are written as a field of times is; a pattern says which it writes.
      const pattern = part.format as { number?: string; time?: string } | undefined;
      const patterned = pattern?.number !== undefined || pattern?.time !== undefined;
      let times: Formatter | undefined;
      return (_row, _series, v, time) => {
        if (!Number.isFinite(v)) return "";
        if (!time || patterned) return write(v);
        times ??= format(part.format, at, true);
        return times(v);
      };
    }
    const field = part.field;
    if (!table?.has(field))
      throw new kit.ChartError({
        code: table ? "unknown-field" : "invalid-option",
        path: `${at}.field`,
        message: table
          ? `${at}.field: no field "${field}"; the table has ${table
              .fields()
              .map((name) => `"${name}"`)
              .join(", ")}`
          : `${at}.field: these labels have no table whose rows a field reads; give text, or the series or value`,
      });
    const kind = table.kind(field as never);
    const write = format(part.format, at, kind === "time");
    return (row) => {
      const read = table.value(field as never, row);
      return read === null ? "" : typeof read === "number" ? write(read) : String(read);
    };
  });
  return (row, series, v, time) => writers.map((write) => write(row, series, v, time)).join("");
}

function refuse(kit: FeatureKit, at: string, why: string): never {
  throw new kit.ChartError({ code: "invalid-option", path: at, message: `${at}: ${why}` });
}
