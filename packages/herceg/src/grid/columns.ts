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
import type { LinkRows, RowLink } from "../fields/links.ts";
import { type Formatter, FULL_TIME, numberFormatter, timeFormatter } from "../format/format.ts";
import { formatWriter } from "../format/patterns.ts";
import type { TimeZone } from "../format/zone.ts";
import type { FormatSpec, NumberFormatSpec, TimeFormatSpec } from "../spec/guides.ts";
import {
  type CellFieldKind,
  type CellKind,
  type GridCell,
  kindOf,
  type UnboundCell,
} from "./cells.ts";
import type { CellEncodings } from "./looks.ts";
import type { Sparkline } from "./sparklines.ts";

/** The formats a field of kind `K` takes: every number or time form, as axes take them; none for categories. */
export type FormatOf<K> = K extends "number"
  ? NumberFormatSpec
  : K extends "time"
    ? TimeFormatSpec
    : never;

/** The cell kinds a field of kind `K` takes (`barCell` numbers only); for a kind not known, any. */
export type CellOf<K> = K extends CellFieldKind ? GridCell<K> : never;

/** A side of the grid a column can be pinned to. */
export type PinSide = "left" | "right";

/**
 * What a grid's columns read on group rows: the fields of the groups'
 * tables (`schema`: grouping fields and aggregates), and the names of the
 * aggregates a column may show (`names`).
 */
export interface AggregateScope {
  readonly schema: Schema;
  readonly names: string;
}

/**
 * Groups not known as a model is made (chosen later, as a user picks them),
 * or erased (`RowGroups<S>`): any names and fields, which the model checks
 * when groups arrive.
 */
export interface AnyAggregates {
  // biome-ignore lint/suspicious/noExplicitAny: fields named at run time, as erased groups' are.
  readonly schema: any;
  readonly names: string;
}

type IsAny<T> = 0 extends 1 & T ? true : false;

/** A schema's field names, spelled out in errors. */
type NameOf<S extends Schema> = S extends unknown ? Extract<keyof S, string> : never;

/**
 * The scope of a model's groups (their last level's table `G`, grouped by
 * `B`), fixed as it is made: precise for inferred groups, any names for
 * erased ones or none.
 */
export type ScopeOf<G extends Schema, B extends readonly string[]> =
  IsAny<G> extends true
    ? AnyAggregates
    : [keyof G] extends [never]
      ? AnyAggregates
      : string extends B[number]
        ? { readonly schema: G; readonly names: string }
        : { readonly schema: G; readonly names: Exclude<NameOf<G>, B[number]> };

/** What every column takes, with a field or without. */
interface ColumnPlacing {
  /** The header's text; the field's label (with the grid's `fields`), else the field (or the id), by default. */
  title?: string;
  /** In CSS pixels, at least `MIN_COLUMN_WIDTH`; 120 by default. */
  width?: number;
  /** Numbers align to the end by default, so their digits line up; other values to the start. */
  align?: "start" | "center" | "end";
  hidden?: boolean;
  /**
   * Holds the column at the grid's left or right edge while the others
   * scroll past. Pinned columns show first or last, in the columns' order.
   */
  pin?: PinSide;
}

/**
 * A field shown in a grid. `format` writes its values in any form axes
 * take, by the field's kind: Intl options, `{ number }` patterns with
 * `prefix` and `suffix`, durations, SI and binary prefixes for numbers;
 * Intl date options and `{ time }` patterns (with fiscal years) for times;
 * none for categories. With the grid's `fields`, it replaces the field's
 * format, while the field's mappings and missing text stay. `X` is what it
 * reads on group rows (see `AggregateScope`).
 */
export type GridFieldColumn<S extends Schema = Schema, X extends AggregateScope = AnyAggregates> = {
  [F in PositionField<S>]: ColumnPlacing & {
    field: F;
    /** Names the column in focus, sort, and layout calls; the field by default. Unique in a grid. */
    id?: string;
    format?: FormatOf<S[F]>;
    /**
     * In grouped grids: the name of an aggregate of the groups that group
     * rows show in this column (not a grouping field). Without one, group
     * rows leave it empty.
     */
    aggregate?: X["names"];
    /** How its cells look on table rows, read from the row (see `CellEncodings`). */
    encode?: CellEncodings<S>;
    /**
     * How its cells look on group rows, read from their groups' tables:
     * grouping fields and aggregates by name. A field without a scale
     * colors an aggregate by its field's display only for a mean, a
     * minimum, or a maximum; a name a level's table lacks (a grouping field
     * of a deeper level) gives that level's rows no look.
     */
    aggregateEncode?: Omit<CellEncodings<X["schema"]>, "symbol">;
    /**
     * What its cells draw besides their text on table rows: a bar
     * (`barCell`), a chip (`chipCell`), or a symbol (`symbolCell`). Group
     * rows write text.
     */
    cell?: CellOf<S[F]>;
    text?: never;
  };
}[PositionField<S>];

/**
 * A column without a field: it has no value, format, sort, or aggregate,
 * and header clicks do not sort it. Its cells write its `text`, literal
 * text and the row's fields as their displays write them (what the model's
 * `textAt` gives, and copy and export write); without one, they write
 * nothing. A sparkline (`cell`) or a custom renderer (the DOM grid's
 * `cells`) draws more, the text naming its cells for assistive technology.
 */
export interface GridTextColumn<S extends Schema = Schema> extends ColumnPlacing {
  /** Names the column: it has no field to be named by. Unique in a grid. */
  id: string;
  field?: never;
  format?: never;
  aggregate?: never;
  aggregateEncode?: never;
  /**
   * What its cells draw on table rows: a sparkline of another table's rows
   * matching the row by key (`sparklineCell`), its text a summary of what
   * it draws. Group rows write nothing.
   */
  cell?: UnboundCell<PositionField<S>>;
  /** How its cells look on table rows, read from the row (see `CellEncodings`); `color` is a sparkline's line. */
  encode?: Omit<CellEncodings<S>, "symbol">;
  text?: readonly (string | { readonly field: PositionField<S> })[];
}

/** A column a grid shows: a field (`GridFieldColumn`), or a column without one (`GridTextColumn`). */
export type GridColumn<S extends Schema = Schema, X extends AggregateScope = AnyAggregates> =
  | GridFieldColumn<S, X>
  | GridTextColumn<S>;

/** What placing a column reads of it: its field (none for a column without one), id, width, pin, and whether it is hidden. */
export interface ColumnPlace {
  readonly field?: string | undefined;
  readonly width?: number | undefined;
  readonly pin?: PinSide | undefined;
  readonly hidden?: boolean | undefined;
}

/** A shown column, placed: what renderers draw. */
export interface GridColumnLayout {
  readonly id: string;
  /** Its field, and the field's kind; null for a column without a field. */
  readonly field: string | null;
  readonly kind: "number" | "time" | "category" | null;
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
  /** Its field's kind; null for a column without a field. */
  readonly kind: "number" | "time" | "category" | null;
  readonly title: string;
  readonly align: "start" | "center" | "end";
  /** The cell text of row `position` of a table (or a remote grid's window of rows). */
  text(fields: Fields, position: number): string;
  /** The fields its text and link read besides its own: a column without a field's `text`, a link's parts. */
  readonly reads?: readonly string[] | undefined;
  /** A value of the column's field as text: a label, a number, or a time; null for missing. */
  format(value: string | number | null): string;
  /** An aggregate of the field's values in its units (a mean, a sum) as text: in its format, without mappings. */
  readonly amount: (value: number) => string;
  /** A group's key as text: a missing one by its field's missing text, else "(missing)". */
  readonly key: (value: string | number | null) => string;
  /** With field displays: the field's description, the header's title and accessible description. */
  readonly description?: string | undefined;
  /**
   * With field displays whose display gives the field a link: row `row`'s
   * link (of a table, or a remote window's rows), which its text cells draw.
   */
  readonly link?: ((table: LinkRows, row: number) => RowLink | undefined) | undefined;
  /** With field displays: the field's bounds, where its display gives them. */
  readonly min?: number | undefined;
  readonly max?: number | undefined;
  /** What its cells draw besides their text (a bar, a sparkline), where the column says. */
  readonly cell?: CellKind | undefined;
  /** A sparkline column's reading of its data, kept with this content and released with it. */
  readonly sparkline?: Sparkline | undefined;
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
    if (column.field === undefined && typeof column.id !== "string")
      throw new TypeError(
        `${settings.surface} columns[${i}]: a column without a field needs an id; give id`,
      );
    const id = columnId(column);
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
  if (field === undefined) return describeTextColumn(table, column, settings, at);
  if (!table.has(field)) throw new Error(`Unknown grid field "${field}"`);
  const kind = table.kind(field);
  if (kind === "geometry") throw new Error(`Grids cannot show geometry ("${field}")`);
  checkPlace(column.id ?? field, column);
  const format = valueFormatter(kind, settings, column.format, `${at}.format`, field);
  const cell = column.cell === undefined ? undefined : kindOf(column.cell);
  if (column.cell !== undefined && !cell)
    throw new TypeError(
      `${at}.cell: expected a cell kind such as barCell(); received ${JSON.stringify(column.cell)}`,
    );
  cell?.check(field, kind, `${at}.cell`);
  return {
    kind,
    title: column.title ?? field,
    align: column.align ?? (kind === "number" ? "end" : "start"),
    text: reader(field, kind, format, settings.missing),
    format,
    amount: format,
    key: (value) => (value === null ? "(missing)" : format(value)),
    aggregate: column.aggregate,
    cell,
    // Written through the grid's field displays, where it has them.
    ...(settings.fields &&
      columnDisplay(settings.fields, column, kind, settings.source ?? (table as Table), settings)),
  };
}

/** A column's id: its own, else its field's (a column without a field has one). */
export function columnId(column: {
  readonly id?: string | undefined;
  readonly field?: string | undefined;
}): string {
  return (column.id ?? column.field)!;
}

/** What a column without a field shows: its `text`, checked against the table's fields. */
function describeTextColumn(
  table: Pick<Fields, "has" | "kind">,
  column: GridTextColumn,
  settings: FormatSettings,
  at: string,
): ColumnContent {
  const { id, text } = column;
  checkPlace(id, column);
  for (const key of ["format", "aggregate", "aggregateEncode"] as const)
    if (column[key] !== undefined)
      throw new TypeError(
        `${at}.${key}: a column without a field has no ${key === "format" ? "value to format" : "aggregate"}; drop ${key}`,
      );
  const cell = column.cell === undefined ? undefined : kindOf(column.cell);
  if (column.cell !== undefined && !cell?.describe)
    throw new TypeError(
      `${at}.cell: a column without a field takes sparklineCell() alone; give a field for other cell kinds`,
    );
  // A kind's cells write what it says (a sparkline's summary).
  const drawn = cell?.describe?.(table, column, settings, at);
  if (text !== undefined && !Array.isArray(text))
    throw new TypeError(
      `${at}.text: expected text and { field } parts; received ${JSON.stringify(text)}`,
    );
  // Each field part as the field's own column writes it.
  const parts = (text ?? []).map((part, i): string | ColumnContent["text"] => {
    if (typeof part === "string") return part;
    const where = `${at}.text[${i}]`;
    if (typeof part !== "object" || part === null || typeof part.field !== "string")
      throw new TypeError(`${where}: expected text or { field }; received ${JSON.stringify(part)}`);
    if (!table.has(part.field) || table.kind(part.field) === "geometry")
      throw new Error(`${where}.field: no field ${JSON.stringify(part.field)} in the grid's table`);
    return describeColumn(table, { field: part.field }, settings, where).text;
  });
  const empty = () => "";
  return {
    kind: null,
    title: column.title ?? id,
    align: column.align ?? "start",
    text:
      drawn?.text ??
      ((fields, position) =>
        parts.map((part) => (typeof part === "string" ? part : part(fields, position))).join("")),
    reads:
      drawn?.reads ??
      (text ?? []).flatMap((part) => (typeof part === "string" ? [] : [part.field])),
    format: empty,
    amount: empty,
    key: empty,
    aggregate: undefined,
    cell,
    sparkline: drawn?.sparkline,
  };
}

/**
 * Places the shown columns side by side: those pinned left first, then the
 * others, then those pinned right, each in the columns' order. Pinned columns
 * are held at their edges unless together they would leave less than
 * `MIN_SCROLLING_WIDTH` of a `room` pixels wide (0: not measured yet).
 */
export function placeColumns(
  columns: readonly (ColumnPlace & { id: string })[],
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
      field: field ?? null,
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

/** Refuses a column's width or pin, naming the column `id`. */
function checkPlace(id: string, column: ColumnPlacing) {
  const width = column.width ?? WIDTH;
  if (!(Number.isFinite(width) && width >= MIN_COLUMN_WIDTH))
    throw new RangeError(
      `Column "${id}" needs a width of at least ${MIN_COLUMN_WIDTH} pixels, not ${width}`,
    );
  if (column.pin !== undefined && column.pin !== "left" && column.pin !== "right")
    throw new TypeError(`Column "${id}" pins to "left" or "right", not "${column.pin}"`);
}

/** Width of the shown pinned columns together. */
export function pinnedWidth(columns: readonly ColumnPlace[]): number {
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
export function widthOf(column: ColumnPlace): number {
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
