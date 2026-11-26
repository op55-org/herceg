// What marks' tooltips write of the points they are at besides their names
// and values, as inspections take them: the fields of their rows
// (`tooltip.fields`), their rows of parts (`tooltip.content`, a tree
// node's levels among them), their headings (`tooltip.heading`), and the
// totals of readings (`tooltip.total`). Charts whose marks have any load
// it as their first frame draws, and their
// controllers and `ready` wait for it (dom/chart.ts); SVG titles import
// it. It imports only
// types of the chart's modules and writes with the chart's code handed in
// (the kit), so that loading it shares no code with the chart's own.

import type { Table } from "../data/table.ts";
import type { Formatter } from "../format/format.ts";
import { intlWrites } from "../format/intl-options.ts";
import { formatWriter, formOf } from "../format/patterns.ts";
import type { InspectedTotal } from "../model/inspect.ts";
import type { PartStyle } from "../spec/encoding.ts";
import type { FormatSpec } from "../spec/guides.ts";
import type {
  ContentRun,
  InspectedField,
  PointText,
  TooltipWriter,
  TooltipWriters,
} from "./tooltip-fields.ts";

const DATE_TIME = { dateStyle: "medium", timeStyle: "short" } as const;

/** What a field or part writes where the point has no value of it, or no row. */
const MISSING = "–";

/** The marks' tooltips each chart (by its report) was told of: a misused part is reported once. */
const told = new WeakMap<object, WeakSet<object>>();

/** One part of a row's content, as it writes a point: of `row`, named by `names` (a layout item's). */
type PartWriter = (row: number | undefined, point: PointText, names?: readonly string[]) => string;

/**
 * Writes tooltips in a chart's locale and zone, through the chart's field
 * displays (missing values, mappings, labels).
 *
 * Fields are written with their formats (any form of their kind's,
 * `FormatSpec`), else their displays', else numbers as the chart's other
 * numbers, and times as `times` does (the x axis' formatter, on time axes)
 * or as dates and times. A format of the wrong kind is refused as it is
 * first read, as a malformed one is.
 *
 * Content writes each part on one line, in place of the point's name and
 * value, and a heading its parts likewise: text as it is; `{ series: true }` as the point is named (a
 * format on it is reported, once, and not used);
 * `{ value: true }` as the tooltip writes the value, or in its format (a
 * time pattern or Intl date options write it as a time); `{ field }` as a
 * field is written, "–" where no one row is the point, and for a layout
 * item named by fields (a pie's category, a tree's path, or its node and
 * parent fields) its name at that field; `{ label }` as the field's label;
 * `{ path: true }` a tree node's names, each as its level's field writes
 * it, joined by its separator.
 *
 * A reading's total of a mark is the sum of the values it lists of the
 * mark, written in the total's format, else as the mark's points' values
 * are where its value fields' displays agree (the axis' own
 * `tooltipFormat`, else the display's format without its mappings, which
 * name single values), else as the axis writes values; a normalized
 * stack's over the chart's numbers, as its raw values are.
 */
export const tooltipWriters: TooltipWriters = (locale, zone, kit, features, report, times) => {
  const numbers = (value: number) => kit.formatNumber(value, locale);
  const formats = new Map<string, Formatter>();
  const fallback = (kind: string): Formatter =>
    kind === "number" ? numbers : (times ?? kit.timeFormatter(DATE_TIME, zone, locale));
  /** `format` for values of `kind`, made once; `subject` names them in its refusal. */
  const write = (subject: string, kind: InspectedField["kind"], format: object, at: string) => {
    const key = `${kind} ${JSON.stringify(format)}`;
    let formatter = formats.get(key);
    if (!formatter) {
      formatter = formatWriter(kit, format, kind === "time", zone, locale, at);
      const form = formOf(format, at);
      // As a display's format of the wrong kind is refused (fields/check.ts, `misfit`).
      if (
        kind === "category" ||
        (form === "intl" ? !intlWrites(format, kind) : (form === "time") !== (kind === "time"))
      )
        throw new Error(
          `${at}: ${subject} ${kind === "category" ? "categories" : `${kind}s`}; ${
            kind === "category"
              ? "formats are for numbers and times; drop format"
              : kind === "time"
                ? "give { time } or Intl date options"
                : "give a number format"
          }`,
        );
      formats.set(key, formatter);
    }
    return formatter;
  };
  /** How field `field` of `table` is written: through its display, else as `format` or by kind. */
  const fieldText = (table: Table, field: string, format: FormatSpec | undefined, at: string) => {
    const kind = table.kind(field) as InspectedField["kind"];
    const own = format && write(`${JSON.stringify(field)} holds`, kind, format, at);
    const shown = features?.fields?.of(table, field);
    const writes = shown?.writer(own, fallback(kind));
    const text = (value: number | string | null) =>
      writes
        ? writes(value)
        : // Times beyond what dates hold (an infinity among them) have no date to write.
          value === null || (kind === "time" && !(Math.abs(value as number) <= 8.64e15))
          ? MISSING
          : typeof value === "string"
            ? value
            : (own ?? fallback(kind))(value);
    return { kind, shown, writes, text };
  };
  /** Each mark's content and heading as parts' writers and styles, made at its first inspection. */
  const made = {
    content: new Map<object, [PartWriter, PartStyle | undefined][]>(),
    heading: new Map<object, [PartWriter, PartStyle | undefined][]>(),
  };
  const partsOf = (
    mark: Parameters<ReturnType<TooltipWriters>>[0] & object,
    list: "content" | "heading",
    content: readonly unknown[],
  ) => {
    let parts = made[list].get(mark);
    if (parts) return parts;
    const { table } = mark;
    const spec = mark.spec as {
      path?: readonly string[];
      node?: string;
      parent?: string;
      category?: string;
    };
    parts = content.map((given, i): [PartWriter, PartStyle | undefined] => {
      if (typeof given === "string") return [() => given, undefined];
      const at = `tooltip.${list}[${i}]`;
      const part = given as {
        series?: true;
        value?: true;
        field?: string;
        label?: string;
        path?: true;
        separator?: string;
        format?: FormatSpec;
        style?: PartStyle;
      };
      const { style, format } = part;
      if (part.series) {
        // Only JavaScript can give one (the types and specs refuse it): told
        // once, and the name written as it is.
        const seen = report && (told.get(report) ?? told.set(report, new WeakSet()).get(report)!);
        if (format && seen && !seen.has(content)) {
          seen.add(content);
          report!(
            new Error(
              `${(mark.spec as { type?: string }).type} ${at}: a series' name is written as it is; drop format`,
            ),
          );
        }
        return [(_row, point) => point.label, style];
      }
      if (part.path) {
        // Each level as its field's display writes it: a path's levels by
        // their fields, the last's below them; a tree of nodes and parents
        // by its node field.
        const levels = (spec.path ?? [spec.node!]).map(
          (field) => fieldText(table!, field, undefined, at).text,
        );
        const separator = part.separator ?? " / ";
        return [
          (_row, _point, names) =>
            names
              ?.map((name, level) => levels[Math.min(level, levels.length - 1)]!(name))
              .join(separator) ?? MISSING,
          style,
        ];
      }
      if (part.value) {
        // A value is what its format writes: a time for a time pattern or Intl date options.
        const form = format && formOf(format, `${at}.format`);
        const kind =
          form === "time" || (form === "intl" && !intlWrites(format!, "number"))
            ? "time"
            : "number";
        return [
          (_row, point) =>
            !format
              ? point.text
              : // Missing, or a time beyond what dates hold: nothing to write.
                Math.abs(point.value) <= (kind === "time" ? 8.64e15 : Infinity)
                ? write("the value is", kind, format, `${at}.format`)(point.value)
                : MISSING,
          style,
        ];
      }
      if (part.label !== undefined) {
        const label = features?.fields?.of(table, part.label)?.label ?? part.label;
        return [() => label, style];
      }
      const field = part.field!;
      const { text } = fieldText(table!, field, format, `${at}.format`);
      // Which of a layout item's names the field is: a level of a tree's
      // path, a pie's or a funnel's category, a tree's node or its parent.
      const level = spec.path?.indexOf(field) ?? (field === spec.category ? 0 : -1);
      const named =
        level >= 0
          ? (names: readonly string[]) => names[level]
          : field === spec.node
            ? (names: readonly string[]) => names.at(-1)
            : field === spec.parent
              ? (names: readonly string[]) => names.at(-2)
              : undefined;
      return [
        (row, _point, names) => {
          if (names && named) {
            const name = named(names);
            return name === undefined ? MISSING : text(name);
          }
          return row === undefined ? MISSING : text(table!.value(field as never, row));
        },
        style,
      ];
    });
    made[list].set(mark, parts);
    return parts;
  };
  /** `list`'s runs for a point: each part's text, in its style. */
  const runsOf = (
    mark: Parameters<ReturnType<TooltipWriters>>[0] & object,
    list: "content" | "heading",
    row: number | undefined,
    point: PointText,
    names: readonly string[] | undefined,
  ) => {
    const given = mark.spec.tooltip![list];
    return (
      given &&
      partsOf(mark, list, given).map(([part, style]): ContentRun => {
        const text = part(row, point, names);
        return style ? { text, style } : { text };
      })
    );
  };
  const total: TooltipWriter["total"] = (mark, series, axisText) => {
    const { type, tooltip } = mark.spec;
    const axis = mark.tooltip === "y" ? "x" : "y";
    // As the marks would refuse it, which only detect a total.
    const refuse = (why: string) => {
      throw new Error(`${type} tooltip.total: ${why}; drop total`);
    };
    // Bands' series, and custom marks' read alone, which span ranges.
    if (series.some((s) => s.range) || (type === "custom" && mark.tooltip === "point"))
      refuse("its points are ranges, which have no total");
    const values = mark.identity?.values ?? [];
    for (const field of values) {
      const kind = mark.table!.kind(field);
      if (kind !== "number")
        refuse(`${axis} ${JSON.stringify(field)} is a ${kind} field, whose points have no sum`);
    }
    const asked = tooltip!.total!;
    const format = asked === true ? undefined : asked.format;
    if (format) return write("totals are", "number", format, `${type} tooltip.total.format`);
    // A normalized stack's axis writes shares; its raw values are written over the chart's numbers.
    const { stack } = mark.spec as { stack?: { offset?: unknown } | string };
    const fallback =
      stack === "fill" || (typeof stack === "object" && stack.offset === "fill")
        ? numbers
        : axisText;
    // As the points' values are where every value field's display writes
    // them alike, without mappings, which name single values.
    const [first, ...rest] = values.map((field) => features?.fields?.of(mark.table, field));
    return (fallback as { own?: true }).own ||
      !first ||
      rest.some((one) => one?.formatKey !== first.formatKey)
      ? fallback
      : first.amount(fallback);
  };
  const totals: TooltipWriter["totals"] = (marks, inspection) => {
    const out: InspectedTotal[] = [];
    for (const { mark, index, text } of marks) {
      // From 0, so that a sum of zeros is 0, never -0.
      let value = 0;
      let count = 0;
      for (const point of inspection.points)
        if (point.mark === index) {
          value += point.value;
          count++;
        }
      // A sum past what numbers hold has none to write.
      if (!count || !Number.isFinite(value)) continue;
      const { spec } = mark;
      const asked = spec.tooltip!.total!;
      out.push({
        mark: index,
        markId: spec.id,
        label: (asked === true ? undefined : asked.label) ?? "Total",
        value,
        text: text(value),
        count,
      });
    }
    if (out.length) inspection.totals = out;
    else delete inspection.totals;
  };
  const writer = (
    mark: Parameters<TooltipWriter>[0],
    row: number | undefined,
    point: PointText,
    names?: readonly string[],
  ) => {
    const tooltip = mark?.spec.tooltip;
    if (!tooltip) return undefined;
    const table = mark.table;
    const fields =
      row === undefined
        ? undefined
        : tooltip.fields?.map((entry, i) => {
            const { field, label, format } = typeof entry === "string" ? { field: entry } : entry;
            const value = table!.value(field, row);
            const { kind, shown, writes, text } = fieldText(
              table!,
              field,
              format,
              `tooltip.fields[${i}].format`,
            );
            const color = shown?.color?.(value);
            const link = shown?.link?.(table!, row, writes!);
            const read: InspectedField = {
              field,
              label: label ?? shown?.label ?? field,
              kind,
              value,
              text: text(value),
            };
            if (color !== undefined) read.color = color;
            if (link) read.link = link;
            return read;
          });
    const content = runsOf(mark, "content", row, point, names);
    const heading = runsOf(mark, "heading", row, point, names);
    return fields || content || heading
      ? { ...(fields && { fields }), ...(content && { content }), ...(heading && { heading }) }
      : undefined;
  };
  return Object.assign(writer, { total, totals });
};
