// Annotations (rules, regions, and text) draw one item from constant
// places, or one item per row of a table when a place or the label is a
// field; facets split those rows into panels, which draw and summarize their
// own. A place along an axis is a value (a constant or a field), or any
// coordinate (spec/place.ts): a category, a value on a scale of the chart's
// own, a fraction of the plot or pixels (constants or a field's), each
// moved by an offset. This module resolves them for the three marks.

import type { FieldKind, NumericArray } from "../data/column.ts";
import type { Schema, Table } from "../data/table.ts";
import { type Formatter, formatNumber, numberFormatter } from "../format/format.ts";
import { coordinateAt } from "../layout/position.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { Rect } from "../scene/scene.ts";
import type { LabelSpec } from "../spec/encoding.ts";
import { ChartError } from "../spec/errors.ts";
import type { Coordinate } from "../spec/place.ts";
import type { AnnotationPosition, AnnotationValue, Frozen } from "../spec/spec.ts";
import type { ContentWriter } from "./features/content.ts";
import { markKey, rowKey, shownItems } from "./hidden.ts";
import { type Frame, type MarkKey, type RowParts, requireField } from "./mark.ts";

/** Kinds of fields places on a scale read: values, and categories in their bands. */
const POSITIONS: readonly FieldKind[] = ["number", "time", "category"];

/** Fields whose values can be drawn as text: categories and numbers. */
export type TextField<S extends Schema> = string extends keyof S
  ? string
  : { [K in keyof S & string]: S[K] extends "category" | "number" ? K : never }[keyof S & string];

/** A place as annotations' TypeScript options take it: a value, a Date, a field, or a coordinate. */
export type PlaceOption<F extends string> =
  | number
  | Date
  | F
  | Coordinate
  | { data: number | string | Date; scale?: string; offset?: number };

/** Epoch milliseconds for dates, in values and coordinates; numbers, fields, and other coordinates pass through. */
export function position<P>(value: P): Exclude<P, Date> {
  if (value instanceof Date) return value.getTime() as Exclude<P, Date>;
  const data = (value as { data?: unknown } | undefined)?.data;
  if (data instanceof Date) return { ...value, data: data.getTime() } as Exclude<P, Date>;
  return value as Exclude<P, Date>;
}

const SUMMARY_ITEMS = 10;

/**
 * Refuses `legend: true` on an annotation of `type` without a label, or
 * with a label of parts (`content`), which would name no one entry.
 */
export function checkLegend(spec: { legend?: unknown; label?: unknown }, type: string): void {
  if (spec.legend !== true) return;
  const content = (spec.label as { content?: unknown } | undefined)?.content !== undefined;
  if (spec.label === undefined || content)
    throw new ChartError({
      code: "invalid-option",
      path: "legend",
      message: content
        ? `${type} legend: true lists the ${type} by its label's text or field, and a label of parts has neither; give text or a field, or drop legend`
        : `${type} legend: true lists the ${type} by its label; give it a label, or drop legend`,
    });
}

/** A position ready to read: a constant, or a column with a value per row. */
export type Channel = number | NumericArray;

export function valueAt(channel: Channel, item: number): number {
  return typeof channel === "number" ? channel : channel[item]!;
}

/**
 * Whether pixel `at` of `place` along `axis`, before its offset, is in the
 * plot's view, as annotations without a `clip` of their own show places:
 * one in data (a value, field, or category) while the view holds it, and
 * one in pixels or a share of a frame always.
 */
export function inView(place: Place, at: number, axis: "x" | "y", plot: Rect): boolean {
  if (place.kind === "frame") return true;
  const [start, size] = axis === "x" ? [plot.x, plot.width] : [plot.y, plot.height];
  return at >= start - 0.5 && at <= start + size + 0.5;
}

/**
 * A place compiled: a value per item (a constant or a column) on its axis'
 * scale, or on `scale`, one of the chart's own; a category on a band axis;
 * or a share or pixels of the plot or chart (each item's from `channel`
 * when a field gives them); with the coordinate it is, which
 * `coordinateAt` resolves.
 */
export type Place = { readonly coordinate: Coordinate } & (
  | { readonly kind: "value"; readonly channel: Channel; readonly scale?: string | undefined }
  | { readonly kind: "category"; readonly value: string | undefined }
  | { readonly kind: "frame"; readonly channel?: Channel | undefined }
);

/** A label's settings, its short form (a string) read as its text. */
export type Label = Frozen<Exclude<LabelSpec, string>>;

/** The label object of a `label` option. */
export function labelOf(label: string | Frozen<LabelSpec> | undefined): Label | undefined {
  return typeof label === "string" ? { text: label } : (label as Label | undefined);
}

/** The field a place reads, if any: its own, or its share's or pixels'. */
function fieldOf(position: Frozen<AnnotationPosition> | undefined): string | undefined {
  if (typeof position !== "object") return typeof position === "string" ? position : undefined;
  const share =
    "fraction" in position ? position.fraction : "px" in position ? position.px : position;
  return (share as { field?: string }).field;
}

/**
 * Whether an annotation reads a table: a place, its label, or a part of its
 * label's content is a field, or it paints rows (a region's `encode`).
 */
export function readsTable(
  positions: readonly (Frozen<AnnotationPosition> | undefined)[],
  label: string | Frozen<LabelSpec> | undefined,
  encode?: object,
): boolean {
  const own = typeof label === "object" ? label : undefined;
  return (
    (encode !== undefined && Object.keys(encode).length > 0) ||
    own?.field !== undefined ||
    !!own?.content?.some((part) => typeof part === "object" && part.field !== undefined) ||
    positions.some((p) => fieldOf(p) !== undefined)
  );
}

/** Checks an annotation's fields and reads its places and text. */
export class AnnotationData {
  /** The table when the annotation reads one; constants ignore it. */
  readonly table: Table | undefined;
  readonly label: Label | undefined;
  /** Whether a place is on a scale of the chart's own. */
  readonly scaled: boolean;
  readonly #role: string;
  /** The scales of the axes places are on, unless they name one of the chart's own. */
  readonly #scales: { readonly x: string; readonly y: string };

  /**
   * `positions` are named by their axis (`x`, `y1`, ...); others (a rule's
   * `span`) lie along `across`. `encode` paints rows: a region's, which then
   * reads its table whatever its places.
   */
  constructor(
    table: Table | undefined,
    positions: Record<string, Frozen<AnnotationPosition> | undefined>,
    label: Label | undefined,
    role: string,
    scales: { x: string; y: string },
    across: "x" | "y" = "x",
    encode?: object,
  ) {
    this.label = label;
    this.#role = role;
    const text = label?.field;
    if (label && [label.text, text, label.content].filter((v) => v !== undefined).length !== 1)
      throw new Error(`${role} label: needs one of text, field, and content`);
    this.#scales = scales;
    let scaled = false;
    for (const [channel, place] of Object.entries(positions)) {
      const scale = typeof place === "object" && "scale" in place ? place.scale : undefined;
      // Text's `at.x` and `at.y` are named as given.
      const name = channel.replace("at.", "");
      const axis = name[0] === "x" || name[0] === "y" ? name[0] : across;
      const own = scales[axis];
      // Another axis' scale; others are the chart's own (guides/positions.ts).
      if ((scale === "x" || scale === "y" || scale === "yRight") && scale !== own)
        throw new ChartError({
          code: "invalid-option",
          path: `${channel}.scale`,
          message: `${role} ${channel}.scale: "${scale}" is not this ${axis} axis' scale ("${own}"); ${scale === "yRight" ? 'give axis: "right"' : `name "${own}"`}`,
        });
      scaled ||= scale !== undefined && scale !== own;
    }
    this.scaled = scaled;
    if (!readsTable(Object.values(positions), label, encode)) {
      this.table = undefined;
      return;
    }
    if (!table) {
      // A constant given as a string, such as a date, reads as a field name.
      const [channel, field] = Object.entries(positions)
        .map(([name, p]) => [name, fieldOf(p)] as const)
        .find(([, f]) => f !== undefined) ?? ["label.field", text];
      const constant = channel === "label.field" ? "constant text as label" : "a number or Date";
      throw new Error(
        `${role} ${channel}: "${field}" names a field, and fields need a table; pass the table first, or give ${constant}`,
      );
    }
    for (const [channel, place] of Object.entries(positions)) {
      const field = fieldOf(place);
      if (field === undefined) continue;
      // Shares and pixels are numbers; places on a scale, numbers, times,
      // or categories, as other marks take them.
      const share = typeof place === "object" && !("field" in place);
      requireField(
        table,
        field,
        share ? ["number"] : POSITIONS,
        `${role} ${channel}${share ? `.${"fraction" in place ? "fraction" : "px"}.field` : ""}`,
      );
    }
    if (text !== undefined)
      requireField(table, text, ["category", "number"], `${role} label.field`);
    this.table = table;
  }

  /** Items to draw: one per row when reading a table, otherwise one. */
  get count(): number {
    return this.table ? this.table.length : 1;
  }

  /** How many items `rows` holds: every item without them. */
  size(rows: RowParts | undefined): number {
    if (!rows) return this.count;
    let size = 0;
    for (const part of rows) size += part.length;
    return size;
  }

  /** The items of `rows` (every item without them) the legend leaves shown of mark `mark` (see marks/hidden.ts). */
  shown(
    hidden: ReadonlySet<string>,
    mark: MarkKey,
    rows: RowParts | undefined,
  ): RowParts | undefined {
    return shownItems(hidden, mark, this.table, this.count, rows);
  }

  /**
   * Visits the items `rows` holds (every item without them), in order: each
   * item, which is its row of the table, and its place among them.
   */
  each(rows: RowParts | undefined, visit: (item: number, place: number) => void): void {
    if (!rows) {
      for (let i = 0; i < this.count; i++) visit(i, i);
      return;
    }
    let place = 0;
    for (const part of rows) for (let k = 0; k < part.length; k++) visit(part[k]!, place++);
  }

  /** A place compiled. */
  place(position: Frozen<AnnotationPosition>): Place {
    if (typeof position === "number")
      return { kind: "value", channel: position, coordinate: { data: position } };
    if (typeof position === "string") return this.#field(position, { field: position });
    const coordinate = position as Coordinate;
    // A scale of the chart's own, rather than the axis'.
    const scale =
      "scale" in position && position.scale !== this.#scales.x && position.scale !== this.#scales.y
        ? position.scale
        : undefined;
    if ("field" in position) return this.#field(position.field, coordinate, scale);
    if ("data" in position)
      return typeof position.data === "string"
        ? { kind: "category", value: position.data, coordinate }
        : { kind: "value", channel: position.data, coordinate, scale };
    const field = fieldOf(position);
    return {
      kind: "frame",
      coordinate,
      channel: field === undefined ? undefined : this.#column(field),
    };
  }

  /** A field's place: its values on a scale, or its categories in their bands. */
  #field(field: string, coordinate: Coordinate, scale?: string): Place {
    return this.table!.kind(field as never) === "category"
      ? { kind: "category", value: undefined, coordinate }
      : { kind: "value", channel: this.#column(field), coordinate, scale };
  }

  #column(field: string): NumericArray {
    return this.table!.numbers(field as never);
  }

  /** An item's category at a category place: the constant, or its row's; undefined for others. */
  category(place: Place, item: number): string | undefined {
    if (place.kind !== "category") return undefined;
    if (place.value !== undefined) return place.value;
    const value = this.table!.value((place.coordinate as { field: string }).field as never, item);
    return value === null ? undefined : String(value);
  }

  /** An item's value at a place, NaN for places that are not values. */
  value(place: Place, item: number): number {
    return place.kind === "value" ? valueAt(place.channel, item) : Number.NaN;
  }

  /**
   * The pixel of an item's place along `axis` on `scale`, or undefined when
   * it has none (a missing value, a category the axis lacks, a value a log
   * scale cannot place unless `low` puts it endlessly past the scale's low
   * end, as a region from 0 reaches past the plot).
   */
  pixel(
    place: Place,
    axis: "x" | "y",
    item: number,
    scale: PositionScale,
    frame: Pick<Frame, "plot" | "chart" | "scaleOf">,
    low = false,
  ): number | undefined {
    // A value is on the axis' scale, `scale`, or on one of the chart's own.
    const own = this.#scales;
    return coordinateAt(place.coordinate, axis, {
      plot: frame.plot,
      chart: frame.chart ?? frame.plot,
      scales: own,
      at(name, value) {
        const on = name === own[axis] ? scale : frame.scaleOf?.(name, axis);
        if (!on) return undefined;
        if (typeof value === "string") {
          const index = on.categories?.indexOf(value) ?? -1;
          return index < 0 ? undefined : on.map(index);
        }
        if (!Number.isFinite(value)) return undefined;
        if (low && on.type === "log" && value <= 0) {
          const [a, b] = on.domain[0] <= on.domain[1] ? on.domain : [on.domain[1], on.domain[0]];
          return on.map(a) < on.map(b) ? -Infinity : Infinity;
        }
        const at = on.map(value);
        return Number.isNaN(at) ? undefined : at;
      },
      // A category field's row reads as its label, which its band places.
      field: () =>
        place.kind === "category"
          ? this.category(place, item)
          : valueAt((place as { channel: Channel }).channel, item),
    });
  }

  /**
   * Kind of a place's field; undefined for constants, which fit any axis
   * (on a category axis a number is a band index, as in Plotly: 0 is the
   * first band's center and -0.5 its edge), and for category fields, which
   * add no bands: their rows go to bands other marks give the axis.
   */
  kind(position: Frozen<AnnotationPosition> | undefined): FieldKind | undefined {
    // Shares, pixels, and values on scales of the chart's own tell the axis nothing.
    if (position === undefined) return undefined;
    const place = this.place(position);
    const field = place.kind === "value" && !place.scale ? fieldOf(position) : undefined;
    return field === undefined ? undefined : this.table!.kind(field as never);
  }

  /** Whether items have text to draw. */
  get labeled(): boolean {
    return this.label !== undefined;
  }

  /**
   * The legend entries of the annotation, as mark `mark`, by its label: one
   * for constant text, or one per value of its label's field among `rows`,
   * in the order rows first hold them, numbers written with `write` (see
   * `Mark.labelEntries`).
   */
  entries(
    mark: MarkKey,
    locale: string | undefined,
    rows?: RowParts,
    write?: Formatter,
  ): { key: string; label: string }[] {
    const label = this.label;
    const field = label?.field;
    if (field === undefined)
      return label?.text === undefined ? [] : [{ key: markKey(mark), label: label.text }];
    const seen = new Set<string>();
    const entries: { key: string; label: string }[] = [];
    this.each(rows, (item) => {
      const value = this.table!.value(field as never, item);
      if (value === null || seen.has(String(value))) return;
      seen.add(String(value));
      entries.push({
        key: rowKey(mark, field, String(value)),
        label: this.text(item, locale, write),
      });
    });
    return entries;
  }

  /**
   * Text of an item: the constant label, or the label field's value at its
   * row, numbers written with `write` (the chart's locale's by default); or
   * a label of parts written by `content`, the value at its place `at` (a rule's).
   */
  text(
    item: number,
    locale: string | undefined,
    write?: Formatter,
    content?: ContentWriter,
    at = Number.NaN,
  ): string {
    const label = this.label;
    if (content) return content(item, "", at);
    if (label?.field === undefined) return label?.text ?? "";
    const value = this.table!.value(label.field as never, item);
    if (value === null) return "";
    return typeof value === "number" ? (write ?? ((v) => formatNumber(v, locale)))(value) : value;
  }

  /**
   * How numbers in labels are written: the label's Intl options, a
   * pattern by `pattern` (the feature compiler's), or the locale's default.
   */
  writer(
    locale: string | undefined,
    pattern?: (format: object, locale: string | undefined, path: string) => Formatter,
  ): Formatter | undefined {
    const format = this.label?.format as { number?: string; time?: string } | undefined;
    if (!format) return undefined;
    if (format.number !== undefined || format.time !== undefined)
      return pattern?.(format, locale, `${this.#role} label.format`);
    return numberFormatter(format as Intl.NumberFormatOptions, locale);
  }

  /**
   * A sentence for the chart's text alternative listing the items of
   * `rows` (every item without them): their text and where they are, as
   * `where` describes it (undefined for items that are not drawn), such as
   * "Rules: deploy v41 (x 03:00), deploy v42 (x 08:30)." At most ten items
   * are listed; labels of parts are written by `content`, at the value
   * `valued` gives an item.
   */
  summary(
    [one, many]: [string, string],
    locale: string | undefined,
    where: (item: number) => string | undefined,
    rows?: RowParts,
    content?: ContentWriter,
    valued?: (item: number) => number,
  ): string | undefined {
    const items: string[] = [];
    let total = 0;
    this.each(rows, (i) => {
      const at = where(i);
      if (at === undefined) return;
      total++;
      if (items.length >= SUMMARY_ITEMS) return;
      const text = this.labeled ? this.text(i, locale, undefined, content, valued?.(i)) : "";
      items.push(text ? `${text} (${at})` : at);
    });
    if (total === 0) return undefined;
    const more = total > items.length ? `, and ${total - items.length} more` : "";
    return `${total === 1 ? one : many}: ${items.join(", ")}${more}.`;
  }

  /**
   * [min, max] of usable values of the places over the items of `rows`
   * (every item without them) that `keep` accepts; with `log`, positive
   * values only: of those on the axis' scale, or on `scale` of the chart's
   * own. Fractions, pixels, and categories never count. Marks that do not
   * count toward domains (`contributeDomain`) stand in only where no other
   * mark has values (see `Mark.domainFallback`).
   */
  extent(
    positions: readonly (Frozen<AnnotationPosition> | undefined)[],
    log: boolean,
    keep?: (item: number) => boolean,
    rows?: RowParts,
    scale?: string,
  ): [number, number] | undefined {
    let min = Infinity;
    let max = -Infinity;
    for (const position of positions) {
      if (position === undefined) continue;
      const place = this.place(position);
      if (place.kind !== "value" || place.scale !== scale) continue;
      this.each(rows, (i) => {
        const value = valueAt(place.channel, i);
        if (!Number.isFinite(value) || (log && value <= 0) || (keep && !keep(i))) return;
        if (value < min) min = value;
        if (value > max) max = value;
      });
    }
    return min <= max ? [min, max] : undefined;
  }
}

export type { AnnotationValue };
