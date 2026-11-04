// Labels' text made of parts (`LabelContent`): literal text, a field's
// value at the label's row, the name of the series it labels, the value
// drawn at its place, and a field's label, each written with its own format
// or as the chart's field displays write it. Bars' value labels,
// annotations' labels, and labels following series share it.

import type { Table } from "../../data/table.ts";
import type { ChartFields } from "../../fields/chart.ts";
import type { Formatter } from "../../format/format.ts";
import { formatWriter } from "../../format/patterns.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { LabelContent, LabelPart, PartStyle } from "../../spec/encoding.ts";
import type { FormatSpec } from "../../spec/guides.ts";
import type { TextPaint } from "../../style/style.ts";
import type { Frame, Mark } from "../mark.ts";
import { type PartText, partText } from "./part-text.ts";

/**
 * A label's text at row `row` of the series named `series`, where the
 * value drawn is `value`, a time where `time` says; with parts in looks of
 * their own, `styled` writes it in `paint`, each part in its look, its
 * colors read as `frame` reads styles (without `read`, for measuring only;
 * see `PartText`).
 */
export type ContentWriter = ((
  row: number,
  series: string,
  value: number,
  time?: boolean,
  field?: string,
) => string) & {
  readonly styled?: (
    row: number,
    series: string,
    value: number,
    time: boolean | undefined,
    paint: TextPaint,
    frame: Pick<Frame, "measure"> & Partial<Pick<Frame, "read">>,
    field?: string,
  ) => PartText;
};

/** What a label's block has once, which its parts' styles leave to it. */
const BLOCK = ["halo", "background", "padding", "align", "verticalAlign", "lineHeight", "font"];

/** How times are written where a part gives no format: date and time, in the chart's zone. */
const TIME = { dateStyle: "medium", timeStyle: "short" } as const;

/**
 * Writes `content` at its labels' places: fields of `table` (none for
 * labels of no rows), checked now, through the chart's field displays
 * (`fields`: missing values, mappings, formats), numbers as the chart
 * writes them and times in `zone`, or each with its part's format (over
 * its display's); the value through the display of the labeled series'
 * value field of mark `valued` (`field`, as the writer is told, else the
 * mark's; see `ChartFields.valueDisplay`; the part's format over the
 * display's), else in its part's format, else as numbers, or as times
 * where the writer is told it is one; a field's label as its display
 * gives it. `path` names each part
 * (`marks[1].labels.content[0]`) in errors; `has` says what parts the
 * mark's labels can say: `series` and `value` where it has them.
 */
export function writeContent(
  kit: FeatureKit,
  content: LabelContent,
  table: Table | undefined,
  locale: string | undefined,
  zone: string,
  path: (part: number) => string,
  has: { series: boolean; value: boolean },
  fields?: ChartFields,
  valued?: Mark,
): ContentWriter {
  const format = (spec: FormatSpec | undefined, at: string, time: boolean): Formatter => {
    // Intl options write a date for times, in the chart's zone, else a number; other forms as they say.
    if (spec) return formatWriter(kit, spec, time, zone, locale, `${at}.format`);
    return time ? kit.timeFormatter(TIME, zone, locale) : (v) => kit.formatNumber(v, locale);
  };
  const styles: (PartStyle | undefined)[] = [];
  const writers = content.map((part: LabelPart, i): ContentWriter => {
    const at = path(i);
    if (typeof part === "string") return () => part;
    const kinds = ["field", "series", "value", "label"].filter((key) => key in (part ?? {}));
    if (typeof part !== "object" || part === null || kinds.length !== 1)
      refuse(kit, at, "expected text, { field }, { series: true }, { value: true }, or { label }");
    if (part.style) {
      for (const key of BLOCK)
        if (key in part.style)
          refuse(
            kit,
            `${at}.style`,
            `${key} is the label's; give it in ${at.replace(/\.content\[\d+\]$/, "")}.style`,
          );
      styles[i] = part.style;
    }
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
      // Each value field's display of its kind writes its series' values,
      // mappings whatever the format; times are written as a field of
      // times is. Missing values are left blank.
      const writes = new Map<string, Formatter>();
      return (_row, _series, v, time, field) => {
        if (!Number.isFinite(v)) return "";
        const key = `${!!time}${field === undefined ? "" : `:${field}`}`;
        let write = writes.get(key);
        if (!write) {
          const own = part.format && format(part.format, at, !!time);
          const fallback = format(undefined, at, !!time);
          const shown = valued && fields?.valueDisplay(valued, field);
          write =
            (shown?.kind === (time ? "time" : "number")
              ? shown.writer(own, fallback, "")
              : undefined) ??
            (own || fallback);
          writes.set(key, write);
        }
        return write(v);
      };
    }
    const field = (part.field ?? part.label)!;
    const key = part.label === undefined ? "field" : "label";
    if (!table?.has(field))
      throw new kit.ChartError({
        code: table ? "unknown-field" : "invalid-option",
        path: `${at}.${key}`,
        message: table
          ? `${at}.${key}: no field "${field}"; the table has ${table
              .fields()
              .map((name) => `"${name}"`)
              .join(", ")}`
          : `${at}.${key}: these labels have no table whose rows a field reads; give text, or the series or value`,
      });
    const shown = fields?.of(table, field);
    // A field's label, the same at every row: its name without one.
    if (part.label !== undefined) {
      const label = shown?.label ?? field;
      return () => label;
    }
    const time = table.kind(field as never) === "time";
    const own = part.format && format(part.format, at, time);
    const fallback = format(undefined, at, time);
    // The part's format over the display's; mappings and missing text stay the field's.
    const write =
      shown?.writer(own, fallback, "") ??
      ((read: number | string | null) =>
        read === null ? "" : typeof read === "number" ? (own || fallback)(read) : String(read));
    return (row) => write(table.value(field as never, row));
  });
  const write: ContentWriter = (row, series, v, time, field) =>
    writers.map((part) => part(row, series, v, time, field)).join("");
  if (styles.length === 0) return write;
  // Parts' styles as the last frame read them: a frame is a panel's in one scene.
  let readIn: object | undefined;
  let read = styles;
  return Object.assign(write, {
    styled: (
      row: number,
      series: string,
      v: number,
      time: boolean | undefined,
      paint: TextPaint,
      frame: Pick<Frame, "measure"> & Partial<Pick<Frame, "read">>,
      field?: string,
    ) => {
      if (frame.read && readIn !== frame) {
        readIn = frame;
        read = styles.map((style, i) => style && frame.read!(style, `${path(i)}.style`));
      }
      return partText(
        kit,
        writers.map((part, i) => ({
          text: part(row, series, v, time, field),
          style: frame.read ? read[i] : styles[i],
        })),
        paint,
        frame.measure,
      );
    },
  });
}

function refuse(kit: FeatureKit, at: string, why: string): never {
  throw new kit.ChartError({ code: "invalid-option", path: at, message: `${at}: ${why}` });
}
