// Turns a portable chart specification into a chart configuration, with
// the code its marks and features need given as a kit: tables from `data`,
// marks from `marks`. `loadSpec` (load.ts) gives every mark and feature, so
// it is synchronous; `herceg/web` gives what a spec names, loaded first
// (web/families.ts), so a page fetches only the code its charts draw with.

import {
  type ColumnInput,
  encodedCategory,
  type NumericArray,
  time,
  UNTYPED,
} from "../data/column.ts";
import { geometry } from "../data/geometry.ts";
import { fromMatrix } from "../data/matrix.ts";
import { orderedTable } from "../data/ordered.ts";
import { setOrigin } from "../data/origin.ts";
import type { RowView } from "../data/row-view.ts";
import type { SelectionStore } from "../data/selection.ts";
import { type Table, table } from "../data/table.ts";
import { holds, misfit } from "../fields/check.ts";
import type { FieldDisplays } from "../fields/rules.ts";
import type { LayoutMark } from "../marks/layout-mark.ts";
import type { Mark } from "../marks/mark.ts";
import type { SelectionLineage } from "../model/lineage-binding.ts";
import type { ChartConfig } from "../model/model.ts";
import type { rangeNavigator } from "../model/navigator.ts";
import type { timeBreaks } from "../scale/breaks.ts";
import { scheme } from "../scale/schemes.ts";
import { ChartError, within } from "./errors.ts";
import type * as panelKit from "./features/panels.ts";
import type * as selectionKit from "./features/selection.ts";
import type * as tableKit from "./features/tables.ts";
import type { DisplayedKind, FieldDisplaysSpec, FieldRuleSpec } from "./fields.ts";
import type {
  BinaryType,
  ChartSpec,
  ColumnSpec,
  ColumnsSpec,
  DataSpec,
  MarkSpec,
  MarkTooltipSpec,
  RowSelectionSpec,
} from "./spec.ts";
import { describeUnknown, findUnknown, unknownRefusal } from "./validate.ts";

/** Bytes of a binary column: an ArrayBuffer, or a view such as a Uint8Array or DataView. */
export type SpecBuffer = ArrayBuffer | ArrayBufferView;

export interface LoadedSpec {
  /** Chart options with marks, ready for `createChart` or `renderToSVG`. */
  config: ChartConfig & { width?: number; height?: number };
  /**
   * The spec's tables by name, groups' and totals' tables too; changing the
   * tables of columns updates charts built from the spec (the others follow
   * them).
   */
  tables: Map<string, Table>;
  /** The spec's views of tables' rows (`{ source, view }` entries) by name; changing their queries updates charts. */
  views: Map<string, RowView>;
  /**
   * The selection stores `rowSelection` binds and views follow, by table
   * name, one per table: those given in `stores`, or new ones.
   */
  stores: Map<string, SelectionStore>;
  /** Paths of the properties this herceg does not know, such as `marks[0].strokeWidht`. */
  unknown: string[];
}

export interface LoadOptions {
  /**
   * What to do about properties the spec format does not have, such as
   * misspellings: "error" (the default) throws, naming the property and the
   * one it likely meant; "warn" logs them and loads the rest; "ignore" loads
   * the rest quietly. Unknown properties never change the chart.
   */
  unknown?: "error" | "warn" | "ignore";
  /**
   * Tables to use instead of making them from the spec's `data`, by name
   * (a map, such as another loaded spec's `tables`, or an object): charts
   * loaded from several specs share rows (and so selections) only through
   * tables they share. The spec's own columns for them are not read.
   */
  tables?: ByName<AnyTable>;
  /**
   * The selection stores `rowSelection` binds and views follow, by table
   * name; a store of a table's own is made for each one left out. Each must
   * be of that table.
   */
  stores?: ByName<AnyStore>;
}

/** Values by name: a map, or an object of them. */
type ByName<T> = ReadonlyMap<string, T> | Readonly<Record<string, T>>;

/**
 * Tables and stores of any schema, which the loader reads by field name:
 * a table's schema types its fields only where it is used by name.
 */
// biome-ignore lint/suspicious/noExplicitAny: the erasure point of tables of several schemas.
type AnyTable = Table<any>;
// biome-ignore lint/suspicious/noExplicitAny: as for tables.
type AnyStore = SelectionStore<any>;

/**
 * Makes a mark of `spec`, the class of its type, with what its `data`
 * names: `table()` gives the table (its view's, or with no `data` the
 * spec's one table), refused where there is none, or several and none
 * named; `view` is the view of it named, which marks of series take; and
 * `named` gives another of the spec's tables, as a graph's `nodes` name.
 */
export type MarkFactory<S extends MarkSpec = MarkSpec> = (
  spec: S,
  table: () => Table,
  view: RowView | undefined,
  named: (name: string) => Table,
) => Mark | LayoutMark;

/** Factories by mark type: a family's, or every family's (`AllMarks`). */
export type MarkFactories = {
  readonly [T in MarkSpec["type"]]?: MarkFactory<Extract<MarkSpec, { type: T }>>;
};

/** A factory for every mark type of the spec format. */
export type AllMarks = Required<MarkFactories>;

/**
 * The code a spec's marks and features take, as the loader is given it:
 * the factories of the marks it draws, and the code of the features it
 * names (views, derived tables, groups, and totals; selection stores and
 * bindings, and their lineage; facets and subplots; a navigator; time
 * breaks). `loadSpec` gives
 * all of it; what a spec names is missing only through an engine fault.
 */
export interface LoadKit {
  readonly marks: MarkFactories;
  /** Views, derived tables, groups, and totals: `data` entries made from tables. */
  readonly tables?: typeof tableKit | undefined;
  /** Selection stores, which views follow and bindings write, and the bindings. */
  readonly selection?: typeof selectionKit | undefined;
  /** The lineage reader bindings take, for marks of tables made from the bound one. */
  readonly lineage?: SelectionLineage | undefined;
  readonly panels?: typeof panelKit | undefined;
  readonly navigator?: typeof rangeNavigator | undefined;
  readonly breaks?: typeof timeBreaks | undefined;
}

/** A part of the kit a spec names, which whoever loads the spec gives (see LoadKit). */
function kitPart<T>(part: T | undefined, what: string): T {
  if (part === undefined) throw new Error(`spec loader: the code of ${what} was not given`);
  return part;
}

const TYPED: Record<
  BinaryType,
  {
    new (buffer: ArrayBuffer, offset: number, length: number): NumericArray;
    BYTES_PER_ELEMENT: number;
  }
> = {
  float64: Float64Array,
  float32: Float32Array,
  int32: Int32Array,
  uint32: Uint32Array,
  int16: Int16Array,
  uint16: Uint16Array,
  int8: Int8Array,
  uint8: Uint8Array,
};

/**
 * The properties of `spec` the format does not have, as `options.unknown`
 * handles them: refused ("error", the default), logged ("warn"), or only
 * returned. Throws for what is not valid. Loading checks first.
 */
export function checkUnknown(spec: ChartSpec, options: LoadOptions = {}): string[] {
  const found = findUnknown(spec);
  const handling = options.unknown ?? "error";
  if (found.length > 0 && handling === "error") throw unknownRefusal(found);
  if (found.length > 0 && handling === "warn")
    console.warn(
      `herceg spec: ignoring properties the format does not have: ${found.map(describeUnknown).join(", ")}`,
    );
  return found.map(({ path }) => path);
}

/**
 * Builds tables and marks from a chart specification with the code `kit`
 * gives, as `loadSpec` does with all of it. `unknown` is what
 * `checkUnknown` found, for a spec already checked.
 */
export function loadWith(
  kit: LoadKit,
  spec: ChartSpec,
  buffers: readonly SpecBuffer[] = [],
  options: LoadOptions = {},
  unknown: string[] = checkUnknown(spec, options),
): LoadedSpec {
  const views = new Map<string, RowView>();
  const listed = Array.isArray(spec.rowSelection);
  const bindings = (
    spec.rowSelection === undefined ? [] : [spec.rowSelection].flat()
  ) as readonly RowSelectionSpec[];
  const givenTables = byName(options.tables);
  const tables = new Map<string, Table>();
  // Stores are made at the first binding or view naming one.
  let made: selectionKit.Stores | undefined;
  const stores = (): selectionKit.Stores =>
    (made ??= kitPart(
      kit.selection,
      bindings.length > 0 ? "rowSelection" : "views' selection",
    ).storesOf(
      bindings,
      listed,
      byName(options.stores),
      buffers,
      (name) => tables.get(name) ?? givenTables?.get(name),
    ));
  // Tables, then the stores the bindings and views name, the views, groups, and totals, in the order they need each other.
  loadTables(kit, spec.data ?? {}, buffers, givenTables, views, stores, tables);
  const marks = spec.marks.map((mark, index) => loadMark(kit.marks, mark, index, tables, views));
  marks.forEach(tooltipKinds);
  const {
    data: _data,
    marks: _marks,
    version: _version,
    facet: split,
    panels,
    layout,
    x,
    navigator: strip,
    rowSelection: _bindings,
    fields: displays,
    ...chart
  } = spec;
  const rows =
    bindings.length > 0 &&
    kitPart(kit.selection, "rowSelection").loadRowSelection(
      bindings,
      listed,
      tables,
      views,
      marks,
      stores(),
      kit.lineage,
    );
  const facet = split && new (kitPart(kit.panels, "facet").Facet)(split);
  const subplots = panels && new (kitPart(kit.panels, "panels").Panels)(panels, layout);
  const navigator = strip
    ? kitPart(kit.navigator, "navigator")(strip === true ? {} : strip)
    : undefined;
  // Breaks become the TimeBreaks that resolve them.
  const { breaks, ...axis } = x ?? {};
  const xAxis = x && {
    ...axis,
    ...(breaks && { breaks: kitPart(kit.breaks, "x.breaks")(breaks) }),
  };
  return {
    config: {
      ...chart,
      ...(displays && { fields: fieldTables(displays, tables, views) }),
      marks,
      ...(xAxis && { x: xAxis }),
      ...(facet && { facet }),
      ...(subplots && { panels: subplots }),
      ...(navigator && { navigator }),
      ...(rows && { rowSelection: rows }),
    },
    tables,
    views,
    stores: made?.made ?? new Map(),
    unknown,
  };
}

/**
 * Refuses a format of a mark's tooltip field (`tooltip.fields`), or of a
 * field its content or heading writes (`tooltip.content`,
 * `tooltip.heading`), that its field's kind does
 * not take: a number form on a time field, a time pattern on a number
 * field, or any on a category field, as the chart's tooltips would when
 * they first write it (marks/tooltip-writers.ts).
 */
function tooltipKinds(mark: Mark | LayoutMark, index: number): void {
  const { table } = mark as { table?: Table };
  const { type, id, tooltip } = mark.spec as {
    type: string;
    id?: string;
    tooltip?: MarkTooltipSpec;
  };
  const formatted = [
    ...(tooltip?.fields ?? []).map((entry, i) => [entry, `tooltip.fields[${i}].format`] as const),
    ...(["content", "heading"] as const).flatMap((list) =>
      (tooltip?.[list] ?? []).map((part, i) => [part, `tooltip.${list}[${i}].format`] as const),
    ),
  ];
  formatted.forEach(([entry, at]) => {
    if (typeof entry !== "object" || entry.format === undefined || !entry.field || !table) return;
    const kind = table.kind(entry.field);
    const wrong = kind !== "geometry" && misfit(kind, "format", entry.format);
    if (!wrong) return;
    throw within(
      `marks[${index}]`,
      new ChartError({
        code: "invalid-option",
        path: at,
        message: `${type} ${at}: ${wrong.problem(holds(entry.field, kind as DisplayedKind))}`,
      }),
      id ?? index,
    );
  });
}

/**
 * Field displays with the tables their rules name by the spec's names
 * (`match.table`) as the tables loaded, a view's its table's, so that they
 * match those tables whatever their own names; names the data lacks match
 * tables of that name, or nothing.
 */
function fieldTables(
  displays: FieldDisplaysSpec,
  tables: ReadonlyMap<string, Table>,
  views: ReadonlyMap<string, RowView>,
): FieldDisplays {
  if (!Array.isArray(displays)) return displays as FieldDisplays;
  return (displays as readonly FieldRuleSpec[]).map((rule) => {
    const { match } = rule;
    const name = typeof match === "object" ? match.table : undefined;
    const table = name === undefined ? undefined : (tables.get(name) ?? views.get(name)?.source);
    return table ? { ...rule, match: { ...(match as object), table } } : rule;
  });
}

function byName<T>(values: ByName<T> | undefined): ReadonlyMap<string, T> | undefined {
  if (values === undefined || values instanceof Map) return values as ReadonlyMap<string, T>;
  return new Map(Object.entries(values));
}

/**
 * Every table of the spec: tables before the tables, views, groups, and
 * totals made from them (features/tables.ts), a view's store before the
 * view. Tables in `given` are used rather than made from their columns.
 */
function loadTables(
  kit: LoadKit,
  data: Record<string, DataSpec>,
  buffers: readonly SpecBuffer[],
  given: ReadonlyMap<string, Table> | undefined,
  views: Map<string, RowView>,
  stores: () => selectionKit.Stores,
  tables: Map<string, Table>,
): void {
  /** How entries made from tables load, once one does. */
  let madeFrom: ((name: string, entry: tableKit.MadeSpec) => Table) | undefined;
  /** Table `of`, as `at` names it: tables and views are made from tables, never from views. */
  const tableAt = (at: string, of: string): Table => {
    const entry = data[of];
    if (entry && "view" in entry)
      throw new Error(`${at}: "${of}" is a view of "${entry.source}"; name "${entry.source}"`);
    return load(of);
  };
  const load = (name: string): Table => {
    const done = tables.get(name) ?? given?.get(name);
    if (done) {
      tables.set(name, done);
      return done;
    }
    const entry = data[name];
    if (!entry) throw new Error(`data: no table "${name}"`);
    if ("source" in entry) {
      madeFrom ??= kitPart(kit.tables, `data.${name}`).madeTables({
        data,
        given,
        views,
        tables,
        load,
        tableAt,
        store: (of, table) => stores().of(of, table),
      });
      return madeFrom(name, entry);
    }
    const loaded = loadTable(name, entry, buffers);
    tables.set(name, loaded);
    const { origin } = entry;
    if (origin !== undefined) {
      if (!Object.hasOwn(data, origin))
        throw new Error(
          `data.${name}.origin: no table "${origin}" in data; name one of ${names(data)}`,
        );
      // Tables are made from others, through origins and sources, never from themselves.
      const from = (at: string) => {
        const of = data[at];
        return of && ("source" in of ? of.source : of.origin);
      };
      const seen = new Set([name]);
      for (let at: string | undefined = origin; at !== undefined; at = from(at)) {
        if (seen.has(at))
          throw new Error(
            `data.${name}.origin: the table is made from itself; name a table it is made from`,
          );
        seen.add(at);
      }
      const source = tableAt(`data.${name}.origin`, origin);
      setOrigin(loaded, source, (field) => source.has(field));
    }
    return loaded;
  };
  for (const name of Object.keys(data)) load(name);
  // A view names no table.
  for (const name of views.keys()) if (!given?.has(name)) tables.delete(name);
}

function loadTable(name: string, data: ColumnsSpec, buffers: readonly SpecBuffer[]): Table {
  // A null-prototype record keeps fields such as "__proto__" ordinary keys.
  const columns: Record<string, ColumnInput> = Object.create(null);
  for (const [field, column] of Object.entries(data.columns)) {
    try {
      columns[field] = loadColumn(column, buffers);
    } catch (error) {
      throw within(`data.${name}.columns.${field}`, error);
    }
  }
  const { matrix, orderBy, maxRows } = data;
  for (const [option, given] of [
    ["orderBy", orderBy],
    ["maxRows", maxRows],
  ] as const)
    if (matrix && given !== undefined)
      throw new Error(`data.${name}.${option}: a matrix's rows are its cells; drop ${option}`);
  try {
    return matrix
      ? fromMatrix(columns, { x: matrix.x, y: matrix.y }, { name })
      : orderBy !== undefined
        ? orderedTable(columns, { name, orderBy, ...(maxRows !== undefined && { maxRows }) })
        : table(columns, { name, ...(maxRows !== undefined && { maxRows }) });
  } catch (error) {
    throw within(`data.${name}`, error);
  }
}

/** `Array.isArray`, typed to narrow readonly arrays too, as spec columns are. */
const isList = Array.isArray as (value: unknown) => value is readonly unknown[];

function loadColumn(column: ColumnSpec, buffers: readonly SpecBuffer[]): ColumnInput {
  if (isList(column)) return inlineValues(column);
  if (typeof column !== "object" || column === null) {
    throw new TypeError("expected an array of values or a column object; received neither");
  }
  switch (column.type) {
    case "time":
      return "values" in column
        ? time(timeValues(column.values))
        : time(binary(column.dtype, column.buffer, buffers));
    case "number":
      return binary(column.dtype, column.buffer, buffers);
    case "category": {
      if (
        !Array.isArray(column.dictionary) ||
        column.dictionary.some((v) => typeof v !== "string")
      ) {
        throw new TypeError("dictionary: expected an array of strings");
      }
      const codes =
        typeof column.codes === "number"
          ? (binary("int32", column.codes, buffers) as Int32Array)
          : inlineCodes(column.codes, column.dictionary.length);
      return encodedCategory(codes, column.dictionary);
    }
    case "geometry": {
      // Offsets and codes are int32, coordinates float64, as buffers or JSON arrays.
      const ints = (value: unknown, name: string) => {
        if (typeof value === "number") return binary("int32", value, buffers) as Int32Array;
        const list = numberList(value, name);
        const bad = list.findIndex((v) => !Number.isInteger(v) || Math.abs(v) > 2 ** 31 - 1);
        if (bad >= 0)
          throw new TypeError(`${name}[${bad}]: expected an int32; received ${list[bad]}`);
        return Int32Array.from(list);
      };
      const coordinates =
        typeof column.coordinates === "number"
          ? (binary("float64", column.coordinates, buffers) as Float64Array)
          : Float64Array.from(numberList(column.coordinates, "coordinates"));
      return geometry(
        {
          coordinates,
          ringOffsets: ints(column.ringOffsets, "ringOffsets"),
          polygonOffsets: ints(column.polygonOffsets, "polygonOffsets"),
          geometryOffsets: ints(column.geometryOffsets, "geometryOffsets"),
        },
        column.codes === undefined ? undefined : ints(column.codes, "codes"),
      );
    }
    default:
      throw new TypeError(
        `type: expected "number", "time", "category", or "geometry"; received ${JSON.stringify((column as { type: unknown }).type)}`,
      );
  }
}

/** A JSON array: numbers (null for missing) or strings (null for missing), not a mix. */
function inlineValues(values: readonly unknown[]): ColumnInput {
  let kind: "number" | "string" | undefined;
  values.forEach((value, row) => {
    if (value === null) return;
    const type = typeof value;
    if (type !== "number" && type !== "string") {
      throw new TypeError(
        `row ${row}: expected a number, string, or null; received ${JSON.stringify(value)}`,
      );
    }
    kind ??= type;
    if (type !== kind)
      throw new TypeError(
        `row ${row}: a ${type} in a column of ${kind}s; give one kind per column`,
      );
  });
  return values as ColumnInput;
}

/** A JSON array of finite numbers. */
function numberList(values: unknown, name: string): number[] {
  if (!Array.isArray(values)) throw new TypeError(`${name}: expected a buffer index or an array`);
  values.forEach((value, i) => {
    if (typeof value !== "number" || !Number.isFinite(value))
      throw new TypeError(
        `${name}[${i}]: expected a finite number; received ${JSON.stringify(value)}`,
      );
  });
  return values;
}

function timeValues(values: unknown): number[] {
  if (!Array.isArray(values)) throw new TypeError("values: expected an array of times");
  return values.map((value, row) => {
    if (value === null) return Number.NaN;
    const time = typeof value === "string" ? Date.parse(value) : value;
    if (typeof time !== "number" || Number.isNaN(time)) {
      throw new TypeError(
        `row ${row}: expected epoch milliseconds or an ISO 8601 time; received ${JSON.stringify(value)}`,
      );
    }
    return time;
  });
}

function inlineCodes(codes: unknown, size: number): Int32Array {
  if (!Array.isArray(codes)) throw new TypeError("codes: expected a buffer index or an array");
  return Int32Array.from(codes, (code, row) => {
    if (!Number.isInteger(code) || code < -1 || code >= size) {
      throw new RangeError(
        `row ${row}: code ${JSON.stringify(code)} is outside the dictionary; codes run from -1 to ${size - 1}`,
      );
    }
    return code;
  });
}

/** Whether this machine stores multi-byte numbers little-endian, as the spec does. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/**
 * A typed view of buffer `index`, copied only when its bytes are misaligned
 * or this machine is big-endian.
 */
export function binary(
  dtype: BinaryType,
  index: number,
  buffers: readonly SpecBuffer[],
): NumericArray {
  const Typed = Object.hasOwn(TYPED, dtype) ? TYPED[dtype] : undefined;
  if (!Typed)
    throw new TypeError(
      `dtype: expected ${Object.keys(TYPED)
        .map((type) => `"${type}"`)
        .join(", ")}; received ${JSON.stringify(dtype)}`,
    );
  if (!Number.isInteger(index) || index < 0) {
    throw new TypeError(`buffer: expected a buffer index; received ${JSON.stringify(index)}`);
  }
  const source = buffers[index];
  if (source === undefined)
    throw new RangeError(
      `buffer: buffer ${index} is missing; ${buffers.length} were delivered with the spec`,
    );
  const bytes = ArrayBuffer.isView(source)
    ? new Uint8Array(source.buffer as ArrayBuffer, source.byteOffset, source.byteLength)
    : new Uint8Array(source);
  const size = Typed.BYTES_PER_ELEMENT;
  if (bytes.byteLength % size !== 0) {
    throw new RangeError(
      `buffer: buffer ${index} has ${bytes.byteLength} bytes, not a whole number of ${dtype} values; check dtype`,
    );
  }
  if (!LITTLE_ENDIAN && size > 1) return swapped(Typed, bytes);
  const aligned = bytes.byteOffset % size === 0 ? bytes : bytes.slice();
  return new Typed(aligned.buffer as ArrayBuffer, aligned.byteOffset, aligned.byteLength / size);
}

/** Little-endian bytes reversed per value into native order, for big-endian machines. */
function swapped(Typed: (typeof TYPED)[BinaryType], bytes: Uint8Array): NumericArray {
  const size = Typed.BYTES_PER_ELEMENT;
  const copy = bytes.slice();
  for (let at = 0; at < copy.length; at += size) copy.subarray(at, at + size).reverse();
  return new Typed(copy.buffer, 0, copy.length / size);
}

/** Marks that draw series of a table, which take a view of its rows too. */
const SERIES = new Set([
  "line",
  "area",
  "bar",
  "point",
  "heatmap",
  "rug",
  "segment",
  "errorbar",
  "candlestick",
  "histogram",
  "boxplot",
  "boxen",
  "violin",
]);

function loadMark(
  factories: MarkFactories,
  spec: MarkSpec,
  index: number,
  tables: Map<string, Table>,
  views: ReadonlyMap<string, RowView>,
): Mark | LayoutMark {
  try {
    const view = spec.data === undefined ? undefined : views.get(spec.data);
    if (view && !SERIES.has(spec.type))
      throw new Error(
        `data: "${spec.data}" is a view; a ${spec.type} mark takes a table, so name "${nameOf(view.source, tables)}", or derive one`,
      );
    const factory = factories[spec.type] as MarkFactory | undefined;
    if (!factory)
      throw new TypeError(
        `type: not a mark type; received ${JSON.stringify((spec as { type: unknown }).type)}`,
      );
    return factory(
      spec,
      () => view?.source ?? tableFor(spec.data, tables),
      view,
      (name) => tableFor(name, tables),
    );
  } catch (error) {
    // A spec starts a column of text as an empty category column.
    if (error instanceof Error)
      error.message = error.message.replace(
        UNTYPED,
        '; an empty array makes a number column, so start text with { "type": "category", "codes": [], "dictionary": [] }',
      );
    throw within(`marks[${index}]`, error, spec.id ?? index);
  }
}

/** A list of tables' names, as an error suggests them. */
export function names(tables: ReadonlyMap<string, unknown> | Record<string, unknown>): string {
  const all = tables instanceof Map ? [...tables.keys()] : Object.keys(tables);
  return all.map((name) => `"${name}"`).join(", ") || "(none)";
}

/** A mark's spec with a named color scheme replaced by the scheme's colors. */
export function withScheme<T extends { colors?: string | readonly string[] | undefined }>(
  spec: T,
): T {
  return typeof spec.colors === "string" ? { ...spec, colors: [...scheme(spec.colors)] } : spec;
}

/** The name `table` has among `tables`. */
export function nameOf(table: Table, tables: ReadonlyMap<string, Table>): string | undefined {
  for (const [name, of] of tables) if (of === table) return name;
  return table.name;
}

function tableFor(name: string | undefined, tables: Map<string, Table>): Table {
  if (name !== undefined) {
    const found = tables.get(name);
    if (!found) throw new Error(`data: no table "${name}" in data; name one of ${names(tables)}`);
    return found;
  }
  if (tables.size === 0) throw new Error("data: the spec has no tables; add one to data");
  if (tables.size > 1)
    throw new Error(`data: missing; the spec has several tables, so name one of ${names(tables)}`);
  return tables.values().next().value!;
}
