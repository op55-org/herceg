// Series' names and value writers from the chart's field displays and a
// mark's `label` parts (docs/guide/fields.md, "Names"): a series is named
// by its parts, else by its value field's label (wide data, one series) or
// its series value as its field's display writes it (long data); legend
// entries several series share through a color field are named by that
// value; and each series writes its values through its value field's
// display. Names are text only: identities, keys, and colors stay raw.

import type { Table } from "../../data/table.ts";
import type { ChartFields, ShownField } from "../../fields/chart.ts";
import type { FeatureKit, MarkFeatures } from "../../model/features.ts";
import type { NamePart } from "../../spec/encoding.ts";
import type { Mark } from "../mark.ts";
import type { Series } from "../series.ts";
import type { MarkScope } from "./identity.ts";

/** Where a mark's names are worked out: its name in messages, its index, and its id or index. */
interface NamedAt {
  readonly path: string;
  readonly index: number;
  readonly mark: string | number;
}

/**
 * Names `mark`'s series, and gives them their value writers, from the
 * chart's displays (`fields`) and the mark's `label` parts, over what its
 * other features do (the features given, changed in place): their palette
 * reads parts as their raw form, and their `attach` names each series
 * after it. `own` is the prefix of the identity keys the core gives the
 * mark's series. `entries` holds, by the identity prefix of the legend
 * entries a color field's values stand for, the table and field of each
 * mark sharing them, as the chart's marks are named: an entry is named by
 * the text their displays all write (`ChartFields.entry`), else by its raw
 * value. Throws, naming the
 * part, for parts a name cannot read; undefined where nothing names them.
 */
export function naming(
  kit: FeatureKit,
  mark: Mark,
  own: string | undefined,
  scope: MarkScope | undefined,
  fields: ChartFields | undefined,
  at: NamedAt,
  entries: Map<string, [Table, string][]>,
): (<F extends MarkFeatures>(features: F) => F) | undefined {
  const label = (mark.spec as { label?: unknown }).label;
  const parts = Array.isArray(label) ? (label as readonly NamePart[]) : undefined;
  if (!fields && !parts) return undefined;
  const table = mark.table;
  const series = mark.identity?.field;
  // A line's or area's color field it keeps one color per series by, other than its series field.
  const color =
    scope?.field !== undefined &&
    scope.field !== series &&
    scope.rows === undefined &&
    (mark.spec.type === "line" || mark.spec.type === "area")
      ? scope.field
      : undefined;
  if (parts) checkParts(kit, parts, mark, series, color, at);
  const of = (field: string | undefined) =>
    field === undefined ? undefined : fields?.of(table, field);
  const bySeries = of(series);
  const byColor = of(color);
  const seriesText = bySeries?.writer();
  const colorText = byColor?.writer();
  const shared = color === undefined ? undefined : scope?.color;
  // Each mark sharing entries through its color field names them by its field's display.
  if (shared !== undefined) entries.set(shared, [...(entries.get(shared) ?? []), [table!, color!]]);
  // Writers of each value field, made once.
  const writers = new Map<string, Series["write"]>();
  const writerOf = (field: string) => {
    if (!writers.has(field)) writers.set(field, valueWriter(mark, of(field)));
    return writers.get(field);
  };
  // A series' value field of the mark's table: for a summary of one, that
  // field where its values are the field's (a box plot's medians), not
  // counts of it; for a range, its high end (a band's ends are its fields,
  // and its series' none).
  const [low, high] = mark.identity!.values;
  const valueField = (s: Series) =>
    mark.summarizes
      ? mark.summarizes === "values"
        ? low
        : undefined
      : (s.field ?? (s.range ? high : undefined));
  /**
   * A series' own name: its value field's label (a summary's field, of
   * counts too), or its series value as written.
   */
  const ownName = (s: Series, source: string): string => {
    if (series !== undefined) return seriesText ? seriesText(source) : source;
    const field = mark.summarizes ? low! : (s.field ?? source);
    return of(field)?.label ?? (mark.summarizes ? field : source);
  };
  /** What a part of a series' identity reads, raw: its parts' text, a field's name for its label. */
  const raw = (source: string) =>
    parts!.map((part) => (typeof part === "string" ? part : (part.label ?? source))).join("");
  return (base) => {
    const palette = base.palette.bind(base);
    const attach = base.attach.bind(base);
    // One series named by parts stands for their raw form, as a mark's text label does.
    const single = parts && series === undefined;
    base.palette = (p) => {
      const inner = palette(p);
      return single
        ? (key, given, paint, entry) =>
            inner(key, Array.isArray(given) ? raw(sourceOf(key)) : given, paint, entry)
        : inner;
    };
    base.attach = (s) => {
      const source = sourceOf(s.key);
      if (single && Array.isArray(s.label)) {
        s.label = raw(source);
        if (own !== undefined && s.entry?.startsWith(own))
          s.entry = `${own}${JSON.stringify(s.label)}}`;
      }
      attach(s);
      // A value the series' color field holds throughout, which a part of its name may read.
      const held =
        color !== undefined && scope?.color !== undefined && s.entry?.startsWith(scope.color)
          ? (JSON.parse(s.entry) as { value: string }).value
          : undefined;
      s.label = parts
        ? parts
            .map((part, i) => {
              if (typeof part === "string") return part;
              if (part.series) return ownName(s, source);
              if (part.label !== undefined) return of(part.label)?.label ?? part.label;
              if (part.field === series) return seriesText ? seriesText(source) : source;
              // Missing throughout the series, it is its missing text.
              if (held === undefined && missingIn(s, table!, part.field))
                return colorText ? colorText(null) : "–";
              if (held === undefined)
                throw new kit.ChartError({
                  code: "series-varies",
                  path: `marks[${at.index}].label[${i}].field`,
                  mark: at.mark,
                  message: `${at.path} label[${i}].field: "${part.field}" changes within series "${ownName(s, source)}"; a name reads a field constant within each series`,
                });
              return colorText ? colorText(held) : held;
            })
            .join("")
        : // A single series' name the mark gives wins, its field's name too.
          series === undefined && typeof label === "string" && s.label === label
          ? s.label
          : ownName(s, source);
      // An entry shared through the color field is named by its value, as
      // the marks sharing it write it where they all write it alike.
      if (s.entryLabel !== undefined && shared !== undefined)
        s.entryLabel = fields?.entry(entries.get(shared)!, s.entryLabel) ?? s.entryLabel;
      // A range's low end is its first field's (a band's low field; an error
      // bar's low end, or its center).
      const field = valueField(s);
      if (field !== undefined) s.write = writerOf(field);
      if (s.range && low !== undefined) s.write0 = writerOf(low);
      s.about = of(field)?.description;
      s.fields = fields;
    };
    return base;
  };
}

/**
 * How a series of `mark` writes the values of a number or time field with
 * display `shown` in tooltips, the keyboard, and the text alternative,
 * given how the surface writes them otherwise (`fallback`: its axis'
 * writer in the panel inspected, a subplot's or a named scale's, with
 * their formats and guides; numbers as charts write them without one):
 * missing values and mappings as the display says; else the axis' own
 * `tooltipFormat`; else the field's format; else `fallback` (see
 * `ShownField.over`). Undefined where the display of a number field
 * writes nothing of its own.
 */
function valueWriter(mark: Mark, shown: ShownField | undefined): Series["write"] {
  // Times are written as times, whatever else their display gives.
  if (
    !shown ||
    shown.kind === "category" ||
    (shown.kind !== "time" && !shown.format && !shown.textKey)
  )
    return undefined;
  // Rugs place values along the axis they are inspected along; other marks across it.
  const onX = mark.spec.type === "rug" ? mark.tooltip === "x" : mark.tooltip === "y";
  // Times a mark places on an axis of numbers (bars' lengths) are written as times.
  const numbers = shown.kind === "time" && mark.channelKind?.(onX ? "x" : "y") !== "time";
  return (fallback) => shown.over(fallback, numbers);
}

/**
 * Refuses parts a series' name cannot read: values, looks, and fields
 * other than the mark's series field and a line's or area's color field.
 */
function checkParts(
  kit: FeatureKit,
  parts: readonly NamePart[],
  mark: Mark,
  series: string | undefined,
  color: string | undefined,
  at: NamedAt,
): void {
  const refuse = (i: number, key: string, why: string): never => {
    throw new kit.ChartError({
      code: "invalid-option",
      path: `marks[${at.index}].label[${i}]${key}`,
      mark: at.mark,
      message: `${at.path} label[${i}]${key}: ${why}`,
    });
  };
  if (parts.length === 0) refuse(0, "", "a name of parts needs one; give text, or parts");
  parts.forEach((part, i) => {
    if (typeof part === "string") return;
    const given = (typeof part === "object" && part !== null ? Object.keys(part) : []).filter(
      (key) => (part as Record<string, unknown>)[key] !== undefined,
    );
    if ((part as { value?: unknown }).value !== undefined)
      refuse(i, "", "a series' name has no value; use { series: true }, { field }, or { label }");
    for (const key of ["style", "format"])
      if (given.includes(key))
        refuse(i, `.${key}`, `a name is written in the legend's and tooltip's look; drop ${key}`);
    const ways = given.filter((key) => key === "series" || key === "field" || key === "label");
    if (ways.length !== 1 || given.length !== 1)
      refuse(i, "", "expected text, { series: true }, { field }, or { label }");
    const { series: one } = part as { series?: unknown };
    if (one !== undefined && one !== true)
      refuse(i, ".series", `expected true; received ${JSON.stringify(one)}`);
    const named = part.label ?? part.field;
    if (named !== undefined && (typeof named !== "string" || !mark.table?.has(named)))
      refuse(
        i,
        part.label !== undefined ? ".label" : ".field",
        `no field ${JSON.stringify(named)}; the table has ${mark
          .table!.fields()
          .map((field) => JSON.stringify(field))
          .join(", ")}`,
      );
    if (part.field === undefined || part.field === series || part.field === color) return;
    if (series === undefined && (mark.identity?.values.length ?? 0) > 1)
      refuse(
        i,
        ".field",
        `this ${mark.spec.type}'s series are its value fields; use { series: true }`,
      );
    const reads = [series, color].flatMap((field) =>
      field === undefined ? [] : [JSON.stringify(field)],
    );
    refuse(
      i,
      ".field",
      reads.length
        ? `"${part.field}" does not split the series; a name reads the series field or the color field (${reads.join(" or ")})`
        : `this ${mark.spec.type} has one series; give it a series field, or name it with text or { label }`,
    );
  });
}

/** Whether category field `field` is missing at every row of `s` (read only where it holds no one value). */
function missingIn(s: Series, table: Table, field: string): boolean {
  const { codes } = table.categories(field as never);
  for (let k = 0; k < s.length; k++) if (codes[s.rows ? s.rows[k]! : k]! >= 0) return false;
  return true;
}

/** A series' source, from its key (see `seriesKey`): a y field, or a series field's value. */
function sourceOf(key: string): string {
  return String((JSON.parse(key) as unknown[])[1]);
}
