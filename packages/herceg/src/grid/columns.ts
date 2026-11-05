// Grid columns: which fields a grid shows, in what order and width, which
// are pinned to its edges, and how their values read as text. Values are
// written when a cell is drawn, by one writer per column (a format in any
// form axes take); no written string is kept. A grid given field displays
// (`fields`) writes headers, cells, and group rows through them instead
// (fields/grid.ts), which keeps a category's texts per dictionary entry.

import type { Fields } from "../data/expression.ts";
import type { PositionField, Schema, Table } from "../data/table.ts";
import { checkFormat, holds, misfit } from "../fields/check.ts";
import { KIT } from "../fields/compiled.ts";
import type { CompiledFields } from "../fields/display.ts";
import { columnDisplay } from "../fields/grid.ts";
import { type Formatter, FULL_TIME, numberFormatter, timeFormatter } from "../format/format.ts";
import { formatWriter } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { FormatSpec, NumberFormatSpec, TimeFormatSpec } from "../spec/guides.ts";

/** The formats a field of kind `K` takes: every number or time form, as axes take them; none for categories. */
export type FormatOf<K> = K extends "number"
  ? NumberFormatSpec
  : K extends "time"
    ? TimeFormatSpec
    : never;

/** A side of the grid a column can be pinned to. */
export type PinSide = "left" | "right";

/**
 * A field shown in a grid. `format` writes its values in any form axes
 * take, by the field's kind: Intl options, `{ number }` patterns with
 * `prefix` and `suffix`, durations, SI and binary prefixes for numbers;
 * Intl date options and `{ time }` patterns (with fiscal years) for times;
 * none for categories. With the grid's `fields`, it replaces the field's
 * format, while the field's mappings and missing text stay.
 */
export type GridColumn<S extends Schema = Schema> = {
  [F in PositionField<S>]: {
    field: F;
    /** Names the column in focus, sort, and layout calls; the field by default. Unique in a grid. */
    id?: string;
    /** The header's text; the field's label (with the grid's `fields`), else the field, by default. */
    title?: string;
    /** In CSS pixels, at least `MIN_COLUMN_WIDTH`; 120 by default. */
    width?: number;
    /** Numbers align to the end by default, so their digits line up; other values to the start. */
    align?: "start" | "center" | "end";
    format?: FormatOf<S[F]>;
    hidden?: boolean;
    /**
     * Holds the column at the grid's left or right edge while the others
     * scroll past. Pinned columns show first or last, in the columns' order.
     */
    pin?: PinSide;
    /**
     * In grouped grids: the name of an aggregate of the groups that group
     * rows show in this column. Without one, group rows leave it empty.
     */
    aggregate?: string;
  };
}[PositionField<S>];

/** A shown column, placed: what renderers draw. */
export interface GridColumnLayout {
  readonly id: string;
  readonly field: string;
  readonly kind: "number" | "time" | "category";
  readonly title: string;
  /** Left edge, from the first shown column, in CSS pixels, as if nothing were scrolled. */
  readonly x: number;
  readonly width: number;
  readonly align: "start" | "center" | "end";
  /**
   * The edge the column is held at as the others scroll, or null. Null for
   * pinned columns too while the grid is too narrow to hold them (see
   * `GridModel.canPin`); they then scroll with the others, in the same order.
   */
  readonly pinned: PinSide | null;
}

export interface FormatSettings {
  /** What messages name the grid: "grid", "remote grid", or "pivot grid". */
  readonly surface: string;
  readonly locale: string | undefined;
  readonly timeZone: TimeZone;
  /** Text for missing values. */
  readonly missing: string;
  /** The field displays the grid writes through, where it is given them. */
  readonly fields?: CompiledFields | undefined;
  /**
   * What displays' rules naming tables match: a remote grid's source by its
   * name, or the table a pivot's values come from; the table read otherwise.
   */
  readonly source?: string | Table | undefined;
}

/** What a column shows, apart from where: made by `setColumns`, kept while columns only move, resize, pin, or hide. */
export interface ColumnContent {
  readonly kind: "number" | "time" | "category";
  readonly title: string;
  readonly align: "start" | "center" | "end";
  /** The cell text of row `position` of a table (or a remote grid's window of rows). */
  text(fields: Fields, position: number): string;
  /** A value of the column's field as text: a label, a number, or a time; null for missing. */
  format(value: string | number | null): string;
  /** An aggregate of the field's values in its units (a mean, a sum) as text: in its format, without mappings. */
  readonly amount: (value: number) => string;
  /** A group's key as text: a missing one by its field's missing text, else "(missing)". */
  readonly key: (value: string | number | null) => string;
  /** With field displays: the field's description, the header's title and accessible description. */
  readonly description?: string | undefined;
  readonly aggregate: string | undefined;
  /** A header over the column and its neighbors with the same one: a pivot's value over its aggregates. */
  readonly heading?: { readonly id: string; readonly title: string };
}

/** A shown column with what it shows. */
export interface PlacedColumn extends GridColumnLayout {
  /** The same object as long as the column's content is: its cells' text need not be written again. */
  readonly content: ColumnContent;
}

const WIDTH = 120;
/** The narrowest a column can be, in CSS pixels: room for the cell's padding and a few characters. */
export const MIN_COLUMN_WIDTH = 32;
/**
 * How much room pinned columns leave for the others, at least, to be held
 * at the edges: the width of one column of the default width.
 */
export const MIN_SCROLLING_WIDTH = WIDTH;
const LAST_DATE = 8.64e15;

/** Checks columns against a table's fields, and says what each shows (hidden ones too), by id. */
export function describeColumns(
  table: Pick<Fields, "has" | "kind">,
  columns: readonly GridColumn[],
  settings: FormatSettings,
): Map<string, ColumnContent> {
  const contents = new Map<string, ColumnContent>();
  columns.forEach((column, i) => {
    const id = column.id ?? column.field;
    if (contents.has(id)) throw new Error(`Two grid columns have the id "${id}"`);
    contents.set(id, describeColumn(table, column, settings, `${settings.surface} columns[${i}]`));
  });
  return contents;
}

/** Checks a column against a table's fields, and says what it shows; `at` names it in messages. */
export function describeColumn(
  table: Pick<Fields, "has" | "kind">,
  column: GridColumn,
  settings: FormatSettings,
  at: string,
): ColumnContent {
  const { field } = column;
  if (!table.has(field)) throw new Error(`Unknown grid field "${field}"`);
  const kind = table.kind(field);
  if (kind === "geometry") throw new Error(`Grids cannot show geometry ("${field}")`);
  const id = column.id ?? field;
  const width = column.width ?? WIDTH;
  if (!(Number.isFinite(width) && width >= MIN_COLUMN_WIDTH))
    throw new RangeError(
      `Column "${id}" needs a width of at least ${MIN_COLUMN_WIDTH} pixels, not ${width}`,
    );
  if (column.pin !== undefined && column.pin !== "left" && column.pin !== "right")
    throw new TypeError(`Column "${id}" pins to "left" or "right", not "${column.pin}"`);
  const format = valueFormatter(kind, settings, column.format, `${at}.format`, field);
  return {
    kind,
    title: column.title ?? field,
    align: column.align ?? (kind === "number" ? "end" : "start"),
    text: reader(field, kind, format, settings.missing),
    format,
    amount: format,
    key: (value) => (value === null ? "(missing)" : format(value)),
    aggregate: column.aggregate,
    // Written through the grid's field displays, where it has them.
    ...(settings.fields &&
      columnDisplay(settings.fields, column, kind, settings.source ?? (table as Table), settings)),
  };
}

/**
 * Places the shown columns side by side: those pinned left first, then the
 * others, then those pinned right, each in the columns' order. Pinned columns
 * are held at their edges unless together they would leave less than
 * `MIN_SCROLLING_WIDTH` of a `room` pixels wide (0: not measured yet).
 */
export function placeColumns(
  columns: readonly (GridColumn & { id: string })[],
  contents: ReadonlyMap<string, ColumnContent>,
  room: number,
): PlacedColumn[] {
  const shown = columns.filter((column) => !column.hidden);
  const ordered = [
    ...shown.filter(({ pin }) => pin === "left"),
    ...shown.filter(({ pin }) => pin === undefined),
    ...shown.filter(({ pin }) => pin === "right"),
  ];
  const held = pinsHold(pinnedWidth(shown), room);
  const placed: PlacedColumn[] = [];
  let x = 0;
  for (const { id, field, width = WIDTH, pin } of ordered) {
    const content = contents.get(id)!;
    const { kind, title, align } = content;
    placed.push({
      id,
      field,
      kind,
      title,
      x,
      width,
      align,
      pinned: held ? (pin ?? null) : null,
      content,
    });
    x += width;
  }
  return placed;
}

/** Width of the shown pinned columns together. */
export function pinnedWidth(columns: readonly GridColumn[]): number {
  let width = 0;
  for (const column of columns)
    if (column.pin !== undefined && !column.hidden) width += column.width ?? WIDTH;
  return width;
}

/** Whether pinned columns this wide together are held at their edges in a grid of `room` pixels (0: not measured). */
export function pinsHold(width: number, room: number): boolean {
  return room <= 0 || width <= room - MIN_SCROLLING_WIDTH;
}

/** A column's width, given or the default. */
export function widthOf(column: GridColumn): number {
  return column.width ?? WIDTH;
}

/** What reads a field's values as text. */
function reader(
  field: string,
  kind: "number" | "time" | "category",
  format: (value: string | number | null) => string,
  missing: string,
): (table: Fields, position: number) => string {
  if (kind === "category") {
    return (table, position) => {
      const { codes, dictionary } = table.categories(field);
      const code = codes[position]!;
      return code < 0 ? missing : dictionary[code]!;
    };
  }
  return (table, position) => format(table.numbers(field)[position]!);
}

/**
 * What writes values of a kind as text: in `format`, any form axes take,
 * checked against the kind (refused naming its path `at` and the values'
 * holder `name`); else numbers readably and times to the second. Missing
 * values are `settings.missing`.
 */
export function valueFormatter(
  kind: "number" | "time" | "category",
  settings: FormatSettings,
  format?: FormatSpec,
  at = "",
  name = "",
): (value: string | number | null) => string {
  const { locale, timeZone, missing } = settings;
  if (format !== undefined) checkKind(kind, format, at, name);
  if (kind === "category") return (value) => (value === null ? missing : String(value));
  if (kind === "time") {
    const write = format
      ? formatWriter(KIT, format, true, timeZone, locale, at)
      : timeFormatter(FULL_TIME, timeZone, locale);
    const number = readableNumber(locale);
    return (value) => {
      if (value === null || Number.isNaN(value)) return missing;
      // Dates end 8.64e15 ms from 1970 either way; Intl throws past them.
      return Math.abs(value as number) <= LAST_DATE
        ? write(value as number)
        : number(value as number);
    };
  }
  const write = format
    ? formatWriter(KIT, format, false, timeZone, locale, at)
    : readableNumber(locale);
  return (value) => (value === null || Number.isNaN(value) ? missing : write(value as number));
}

/**
 * What writes the values of `field` of `table` as group keys: through the
 * field's display where the grid has displays, else as `valueFormatter`
 * writes them, with "(missing)" for a missing key; in `format` (checked as
 * `valueFormatter` checks it, named `at`) over the display's.
 */
export function keyFormatter(
  kind: "number" | "time" | "category",
  settings: FormatSettings,
  field: string,
  table?: Table,
  format?: FormatSpec,
  at?: string,
): (value: string | number | null) => string {
  const write = valueFormatter(kind, settings, format, at, field);
  if (settings.fields)
    return columnDisplay(
      settings.fields,
      { field, format },
      kind,
      settings.source ?? table,
      settings,
    ).key;
  return (value) => (value === null ? "(missing)" : write(value));
}

/**
 * Refuses displays that cannot write the group keys of `fields` (of
 * `table`), as group rows will: before the settings or groups that would
 * write them are taken, not as rows are read.
 */
export function checkKeys(
  table: Pick<Fields, "kind">,
  fields: readonly string[],
  settings: FormatSettings,
  source?: Table,
): void {
  if (settings.fields)
    for (const field of fields)
      keyFormatter(table.kind(field) as "number" | "time" | "category", settings, field, source);
}

/**
 * Refuses a format malformed, or of a form that `kind`'s values do not
 * take, naming its path `at` and what holds the values (`name`).
 */
function checkKind(
  kind: "number" | "time" | "category",
  format: FormatSpec,
  at: string,
  name: string,
) {
  checkFormat(format, at, KIT);
  const wrong = misfit(kind, "format", format);
  if (!wrong) return;
  // The option's own name: `format`, or a pivot's `valueFormat`.
  const option = /\w+$/.exec(at)![0];
  throw new Error(
    `${at}: ${
      kind === "category"
        ? `${holds(name, kind)}; formats are for numbers and times; drop ${option}`
        : wrong.problem(holds(name, kind))
    }`,
  );
}

/** Two decimals for most numbers, three significant digits for small ones, as tooltips show them. */
function readableNumber(locale: string | undefined): Formatter {
  const large = numberFormatter({ maximumFractionDigits: 2 }, locale);
  const small = numberFormatter({ maximumSignificantDigits: 3 }, locale);
  return (value) => (Math.abs(value) >= 1 || value === 0 ? large(value) : small(value));
}
