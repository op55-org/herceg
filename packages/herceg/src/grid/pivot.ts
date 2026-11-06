// A pivot in a grid, imported with its DOM grid as `herceg/grid/pivot`: a
// grid model (grid/model.ts) of a row pivot (data/pivot.ts). Its rows are
// the pivot's rows; its columns are the rows field's, then one per pivot
// value and aggregate (each value heading its aggregates), then the totals.
// Generated columns are named by their ids, which the model's layout
// (order, widths, pins, hidden columns) and sorting are keyed by, so values
// coming and going never take another column's width or focus. A cell's
// look reads its combination's row of the pivot's table (a total column's,
// its row's totals). The model takes this through `GridPivot`, so grids
// that show no pivot load none of it.

import type { Fields } from "../data/expression.ts";
import type { GroupSchema, NamedAggregate } from "../data/groups.ts";
import {
  type PivotColumn,
  type PivotSnapshot,
  type PivotValue,
  pivotGroups,
  type RowPivot,
} from "../data/pivot.ts";
import type { MarkRows, RowView } from "../data/row-view.ts";
import type { SelectionStore } from "../data/selection.ts";
import type { Schema, Table } from "../data/table.ts";
import { nextRevision, wholeTable } from "../encoding/channel-scales.ts";
import type { RankRead } from "../encoding/channels.ts";
import { Rank } from "../encoding/ranks.ts";
import { keyPath } from "../fields/check.ts";
import { type CompiledFields, missingValue } from "../fields/display.ts";
import { columnDisplay } from "../fields/grid.ts";
import type { FieldDisplays } from "../fields/rules.ts";
import type { TimeZone } from "../format/zone.ts";
import type { NumberFormatSpec, TimeFormatSpec } from "../spec/guides.ts";
import {
  type ColumnContent,
  describeColumn,
  type FormatOf,
  type FormatSettings,
  type GridColumn,
  keyFormatter,
  MIN_COLUMN_WIDTH,
  valueFormatter,
} from "./columns.ts";
import {
  type CellEncodings,
  compileEncodings,
  type GridScales,
  type Look,
  type LookSettings,
  type LookTable,
  lookOf,
  rankOf,
  type Updating,
  withEncodingsCopied,
} from "./looks.ts";
import { GridModel, type GridPivot, type PivotLooks } from "./model.ts";

/**
 * How a pivot grid's column shows: its title, width (120 pixels by
 * default), alignment, and format, in any form axes take for the kind `K`
 * of its values (none for categories).
 */
export interface PivotColumnOptions<K = "number" | "time"> {
  title?: string;
  width?: number;
  align?: "start" | "center" | "end";
  format?: FormatOf<K>;
}

/**
 * How an aggregate's columns show, and how their cells look (`encode`),
 * read from each cell's combination: its row of the pivot's table (the
 * rows' and the pivot's values, and every aggregate), a total column's
 * from its row's totals (the rows' value and every aggregate). `S` is that
 * table's schema.
 */
export interface PivotAggregateOptions<S extends Schema = Schema, K = "number" | "time">
  extends PivotColumnOptions<K> {
  encode?: CellEncodings<S> | undefined;
}

/** The fields a pivot's cells' looks read: the rows and pivot fields, and every aggregate. */
export type PivotCellSchema<S extends Schema, R extends string, P extends string, O> = GroupSchema<
  S,
  (R | P) & keyof S,
  O
>;

/** The kind of a pivot's aggregate `K`: what its operation gives; either, where the aggregates are not known. */
type AggregateKind<S extends Schema, O, K extends keyof O> = unknown extends O[K]
  ? "number" | "time"
  : GroupSchema<S, never, O>[K & string];

export interface PivotGridModelOptions<
  S extends Schema = Schema,
  R extends string = string,
  P extends string = string,
  O = Record<string, unknown>,
> {
  /** The pivot to show; the application owns it. */
  data: RowPivot<S, R, P, O>;
  /** The rows field's column, titled by the field's label (with `fields`), else the field, by default. */
  rowColumn?: PivotColumnOptions<S[R & keyof S]>;
  /**
   * Each aggregate's columns, by its name, titled by it by default: formats
   * of its result's kind, and looks read from each cell's combination.
   */
  aggregates?: {
    readonly [K in keyof O]?: PivotAggregateOptions<
      PivotCellSchema<S, R, P, O>,
      AggregateKind<S, O, K>
    >;
  };
  /** The format of the pivot field's values over their columns, over its display's: numbers' or times' forms. */
  valueFormat?: FormatOf<S[P & keyof S]>;
  /**
   * Field displays, as grids take them (see `GridSettings.fields`): the rows
   * field's column, each pivot value over its columns, and aggregates of a
   * field that keep its kind (its minimums, maximums, means, and sums) are
   * written through them. Without them, missing values are empty and
   * missing keys read "(missing)".
   */
  fields?: FieldDisplays | CompiledFields | undefined;
  /** Scales the aggregates' looks read values through (see `GridScales`). */
  scales?: GridScales | undefined;
  /** Where the selected rows go; a store of the grid's own when left out. */
  selectionStore?: SelectionStore<S>;
  /** The store's channel for the selected rows; "grid-rows" by default. */
  channel?: string;
  /** In CSS pixels; 28 by default. */
  rowHeight?: number;
  /** BCP 47 locale for numbers and times; the runtime's by default. */
  locale?: string;
  /** Zone times are shown in: "UTC", an IANA zone, or "local" (the default). */
  timeZone?: TimeZone;
}

/**
 * A grid model of a pivot's rows (`createPivotGridModel`): a `GridModel`
 * whose rows are the pivot's, each standing for its rows of the view, and
 * whose columns are generated. Columns and sort keys name the crosstab's
 * fields: the rows field, and each generated column's id.
 */
export type PivotGridModel<S extends Schema = Schema> = Omit<
  GridModel,
  | "data"
  | "selection"
  | "groups"
  | "setGroups"
  | "groupSort"
  | "setGroupSort"
  | "isExpanded"
  | "setExpanded"
  | "expandAll"
  | "collapseAll"
  | "rowAt"
  | "identityAt"
  | "rowIndexOf"
> & {
  /** The view the pivot pivots. */
  readonly data: RowView<S>;
  readonly selectionStore: SelectionStore<S>;
};

/**
 * A grid model of a pivot: a row per row of the pivot, which selects that
 * row's rows of the view, and the columns it generates.
 *
 * ```ts
 * const model = createPivotGridModel({
 *   data: pivotRows(rowView(requests), {
 *     rows: "region",
 *     pivot: "service",
 *     ops: { requests: count(), latency: mean("latency") },
 *   }),
 *   aggregates: { latency: { title: "Latency (ms)", format: { maximumFractionDigits: 1 } } },
 * });
 * createPivotGrid(element, { model, ariaLabel: "Requests by region and service" });
 * ```
 */
export function createPivotGridModel<S extends Schema, R extends string, P extends string, O>(
  options: PivotGridModelOptions<S, R, P, O>,
): PivotGridModel<S> {
  const { data, rowColumn, aggregates, valueFormat, ...rest } = options;
  const pivot = data as unknown as RowPivot;
  const layout = new PivotLayout(pivot, {
    // Typed by kind for callers; checked by kind as the grid is made.
    rowColumn: (rowColumn ?? {}) as PivotColumnOptions,
    // Encodings copied, so a caller's later changes do not reach looks.
    aggregates: Object.fromEntries(
      Object.entries(aggregates ?? {}).map(([name, given]) => [
        name,
        given && withEncodingsCopied(given as PivotAggregateOptions),
      ]),
    ) as Record<string, PivotAggregateOptions | undefined>,
    valueFormat: valueFormat as NumberFormatSpec | TimeFormatSpec | undefined,
  });
  const model: GridModel = new GridModel(
    { ...(rest as unknown as Omit<PivotGridModelOptions, "data">), data: pivot.view, columns: [] },
    layout,
  );
  pivots.set(model, pivot);
  return model as unknown as PivotGridModel<S>;
}

/** Each pivot grid model's pivot. */
const pivots = new WeakMap<GridModel, RowPivot>();

/** The pivot a grid model shows, if it is a pivot grid model: for its DOM grid (dom/grid-pivot.ts). */
export function pivotOfModel(model: GridModel): RowPivot | undefined {
  return pivots.get(model);
}

/** What a column's layout says: the model's record of it, apart from what it shows. */
type Layout = Pick<GridColumn, "width" | "pin" | "hidden">;

type Column = GridColumn & { readonly id: string };

interface LayoutOptions {
  readonly rowColumn: PivotColumnOptions;
  readonly aggregates: Record<string, PivotAggregateOptions | undefined>;
  readonly valueFormat: NumberFormatSpec | TimeFormatSpec | undefined;
}

/** What the pivot's columns are written with, as of one state of the grid's settings. */
interface Written {
  readonly settings: FormatSettings;
  readonly rows: Described;
  /** A pivot value as it heads its columns. */
  readonly heading: (value: string | number | null) => string;
  /** Each aggregate's values' writer, by name. */
  readonly aggregates: ReadonlyMap<string, (value: number) => string>;
  /** What each generated column shows, by id: kept while it is generated, so its cells need no writing again. */
  contents: Map<string, ColumnContent>;
}

/** A generated column: its full title (for menus and announcements) and what it shows. */
interface Described {
  readonly title: string;
  readonly content: ColumnContent;
  readonly width: number | undefined;
}

/** The pivot's columns and their layout, as the grid model takes them (see `GridPivot`). */
class PivotLayout implements GridPivot {
  readonly groups;
  readonly rows: Table;
  readonly fields: Fields;
  readonly #pivot: RowPivot;
  readonly #options: LayoutOptions;
  /** What the columns are written with, and what `check` made for settings not taken yet. */
  #written: Written | null = null;
  #staged: Written | null = null;
  /** The crosstab the revision was last counted for, and its values. */
  #seen: object | null = null;
  #values: readonly PivotValue[] = [];
  #revision = 0;
  /**
   * The layout of columns not generated now, by id, given back when they
   * are again, with the column each followed in an order the user chose
   * (null for none: it was first); the oldest are forgotten.
   */
  readonly #gone = new Map<string, { layout: Layout; after?: string | null }>();
  /** The columns' ids in their own order as last generated: what tells an order the user chose. */
  #order: readonly string[] = [];

  constructor(pivot: RowPivot, options: LayoutOptions) {
    this.#pivot = pivot;
    this.#options = options;
    this.groups = pivotGroups(pivot);
    const rowTable = pivot.rowTable as unknown as Table;
    this.rows = rowTable;
    const field = pivot.rows;
    // Generated ids are JSON arrays starting so: a rows field named like one would be two columns.
    if (field.startsWith('["pivot"'))
      throw new Error(`A pivot grid's rows field cannot be named like its columns ("${field}")`);
    const { width } = options.rowColumn;
    check(field, { field, ...(width !== undefined && { width }) });
    for (const [name, aggregate] of Object.entries(options.aggregates))
      if (aggregate?.width !== undefined) check(name, { field: name, width: aggregate.width });
    this.fields = {
      fields: () => [field, ...pivot.read().columns.map(({ id }) => id)],
      has: (name) => name === field || pivot.read().column(name) !== undefined,
      kind: (name) => (name === field ? rowTable.kind(field) : "number"),
      numbers: (name) => (name === field ? rowTable.numbers(field) : this.#valuesOf(name)),
      categories: (name) => rowTable.categories(name),
    };
  }

  get stopped(): boolean {
    return this.#pivot.failure !== null;
  }

  get revision(): number {
    const crosstab = this.#pivot.read();
    if (crosstab !== this.#seen) {
      this.#seen = crosstab;
      const { values } = crosstab;
      const old = this.#values;
      if (values.length !== old.length || values.some((value, i) => value !== old[i])) {
        this.#values = values;
        this.#revision++;
      }
    }
    return this.#revision;
  }

  columns(
    current: readonly Column[],
    given: readonly GridColumn[] | null,
    settings: FormatSettings,
  ): { columns: Column[]; contents: Map<string, ColumnContent> } {
    const described = this.#describe(settings);
    // Layouts by id: the columns', then those given (to restore).
    const layouts = new Map<string, Layout>();
    for (const column of current) layouts.set(column.id, layoutOf(column));
    const named = new Set<string>();
    for (const column of given ?? []) {
      const id = column.id ?? column.field;
      if (named.has(id)) throw new Error(`Two grid columns have the id "${id}"`);
      named.add(id);
      check(id, column);
      layouts.set(id, layoutOf(column));
    }
    const ids = [...described.keys()];
    const idOf = (column: GridColumn) => column.id ?? column.field;
    const placed = (given ?? current).map(idOf).filter((id) => described.has(id));
    // Columns going keep their layout, and where they were in an order the
    // user chose: the current one once the user moved columns, or one given.
    const gone = this.#gone;
    const remember = (columns: readonly GridColumn[], ordered: boolean) => {
      let previous: string | null = null;
      for (const column of columns) {
        const id = idOf(column);
        if (!described.has(id)) {
          gone.delete(id);
          gone.set(id, { layout: layouts.get(id)!, ...(ordered && { after: previous }) });
        }
        previous = id;
      }
    };
    remember(current, !follows(current.map(idOf), this.#order));
    if (given) remember(given, true);
    for (const id of gone.keys()) {
      if (gone.size <= 64 + 2 * ids.length) break;
      gone.delete(id);
    }
    const contents = new Map<string, ColumnContent>();
    const order = arrange(ids, placed, (id) => gone.get(id)?.after);
    this.#order = ids;
    const columns = order.map((id): Column => {
      const { title, content, width } = described.get(id)!;
      contents.set(id, content);
      const layout = layouts.get(id) ?? gone.get(id)?.layout ?? {};
      gone.delete(id);
      return {
        field: id,
        id,
        title,
        ...(width !== undefined && { width }),
        ...layout,
      } as Column;
    });
    this.#written!.contents = contents;
    return { columns, contents };
  }

  check(settings: FormatSettings): void {
    this.#staged = this.#writtenFor(settings);
  }

  looks(settings: LookSettings): PivotLooks {
    const pivot = this.#pivot;
    const table = pivot.table as unknown as Table;
    const totals = pivot.rowTable as unknown as Table;
    const { aggregates } = pivot;
    const cells: LookTable = {
      table,
      rows: () => wholeTable(table),
      rank: (field, count, top) => columnRanks(pivot, field, count, top),
      aggregates,
    };
    const rows = () => wholeTable(totals);
    const total: LookTable = { table: totals, rows, rank: rankOf(rows), aggregates };
    const ofValues = new Map<string, Look>();
    const ofTotals = new Map<string, Look>();
    for (const { name } of aggregates) {
      const encode = this.#options.aggregates[name]?.encode;
      const at = `${settings.surface} aggregates${keyPath(name)}.encode`;
      const look = compileEncodings(encode, cells, settings, at);
      if (look) ofValues.set(name, look);
      // A row's totals lack the pivot field, which gives them no look.
      const totalLook = pivot.totals && compileEncodings(encode, total, settings, at, true);
      if (totalLook) ofTotals.set(name, totalLook);
    }
    return {
      any: ofValues.size > 0 || ofTotals.size > 0,
      lookAt(id, row) {
        const crosstab = pivot.read();
        const column = crosstab.column(id);
        if (!column) return undefined;
        const { name } = column.aggregate;
        if (column.kind === "total") return lookOf(totals, row, ofTotals.get(name));
        const look = ofValues.get(name);
        const position = look ? crosstab.cell(row, crosstab.indexOf(column.value)) : -1;
        return position < 0 ? undefined : lookOf(table, position, look);
      },
    };
  }

  read(id: string, row: number): ReturnType<GridPivot["read"]> {
    const pivot = this.#pivot;
    const crosstab = pivot.read();
    const column = crosstab.column(id);
    const read = (value: number | string | null, kind: "number" | "time" | "category") =>
      missingValue(kind, value)
        ? { state: "missing" as const, value: null, kind }
        : { state: "value" as const, value, kind };
    if (!column) {
      const value = crosstab.rowKey(row);
      return read(value, this.rows.kind(pivot.rows) as "number" | "time" | "category");
    }
    const { name } = column.aggregate;
    const kind = (pivot.table as unknown as Table).kind(name) as "number" | "time";
    const value =
      column.kind === "total"
        ? (pivot.rowTable as unknown as Table).numbers(name as never)[row]!
        : crosstab.value(row, crosstab.indexOf(column.value), name);
    return value === undefined
      ? { state: "absent", value: undefined, kind: null }
      : read(value, kind);
  }

  /**
   * What writes the columns as `settings` say: made again for other
   * settings, checking every aggregate's format whether or not the pivot
   * has columns of it yet. Throws, changing nothing, where they refuse it.
   */
  #writtenFor(settings: FormatSettings): Written {
    for (const written of [this.#written, this.#staged])
      if (written?.settings === settings) return written;
    const pivot = this.#pivot;
    const source = pivot.view.source as unknown as Table;
    const kind = source.kind(pivot.pivot) as "number" | "time" | "category";
    const at = `${settings.surface} valueFormat`;
    const { valueFormat } = this.#options;
    return {
      settings,
      rows: this.#describeRows(settings),
      // Values head their columns as group keys are written, in `valueFormat`.
      heading: keyFormatter(kind, settings, pivot.pivot, source, valueFormat, at),
      aggregates: new Map(
        pivot.aggregates.map((aggregate) => [
          aggregate.name,
          this.#writer(aggregate, this.#options.aggregates[aggregate.name] ?? {}, settings),
        ]),
      ),
      contents: new Map(),
    };
  }

  /**
   * Every column the pivot generates now, in their own order, by id,
   * written as `settings` say. Throws before anything changes where
   * `settings` refuse what it shows.
   */
  #describe(settings: FormatSettings): Map<string, Described> {
    const pivot = this.#pivot;
    const crosstab = pivot.read();
    const several = pivot.aggregates.length > 1;
    const options = (name: string) => this.#options.aggregates[name] ?? {};
    const written = this.#writtenFor(settings);
    const described = new Map<string, Described>([[pivot.rows, written.rows]]);
    for (const column of crosstab.columns) {
      const { name } = column.aggregate;
      const own = options(name);
      const aggregate = own.title ?? name;
      const value =
        column.kind === "total" ? "Total" : written.heading(column.value as string | number | null);
      const content =
        written.contents.get(column.id) ??
        this.#content(column, own, written.aggregates.get(name)!, {
          title: several ? aggregate : value,
          heading: several ? value : undefined,
        });
      described.set(column.id, {
        title: several ? `${value}, ${aggregate}` : value,
        content,
        width: own.width,
      });
    }
    this.#written = written;
    this.#staged = null;
    return described;
  }

  /** The rows field's column: through its display where the grid has displays, a missing key as group keys are written. */
  #describeRows(settings: FormatSettings): Described {
    const field = this.#pivot.rows;
    const { title, width, align, format } = this.#options.rowColumn;
    const column = {
      field,
      ...(title !== undefined && { title }),
      ...(align !== undefined && { align }),
      ...(format !== undefined && { format }),
    } as GridColumn;
    const content = describeColumn(this.rows, column, settings, `${settings.surface} rowColumn`);
    return {
      title: content.title,
      width,
      content: {
        ...content,
        // A row whose key is missing is a row of its own.
        text: (table, row) =>
          (table as Table).value(field, row) === null
            ? content.key(null)
            : content.text(table, row),
      },
    };
  }

  /**
   * What writes an aggregate's values: an aggregate of its own field that
   * keeps the field's kind (not a count) through the field's display, in
   * its format without its mappings; others, and every aggregate without
   * displays, plainly. The column's own format comes first.
   */
  #writer(
    { name, op, field }: NamedAggregate,
    options: PivotColumnOptions,
    settings: FormatSettings,
  ): (value: number) => string {
    const pivot = this.#pivot;
    const kind = (pivot.table as unknown as Table).kind(name) as "number" | "time";
    const { format } = options;
    const at = `${settings.surface} aggregates${keyPath(name)}.format`;
    const plain = valueFormatter(kind, settings, format, at, name);
    const source = pivot.view.source as unknown as Table;
    if (!settings.fields || field === undefined || op === "count" || source.kind(field) !== kind)
      return plain;
    return columnDisplay(settings.fields, { field, format }, kind, source, settings).amount;
  }

  /** What a generated column shows: its aggregate's value in each row, read from the crosstab as it is. */
  #content(
    column: PivotColumn,
    options: PivotColumnOptions,
    format: (value: number) => string,
    { title, heading }: { title: string; heading: string | undefined },
  ): ColumnContent {
    const pivot = this.#pivot;
    const { name } = column.aggregate;
    const kind = (pivot.table as unknown as Table).kind(name) as "number" | "time";
    const value = column.kind === "value" ? column.value : undefined;
    const text =
      column.kind === "total"
        ? (_: Table, row: number) =>
            format((pivot.rowTable as unknown as Table).numbers(name)[row]!)
        : (_: Table, row: number) => {
            const crosstab = pivot.read();
            const index = crosstab.indexOf(value!);
            const at = index < 0 ? undefined : crosstab.value(row, index, name);
            return at === undefined ? "" : format(at);
          };
    const written = format as (value: string | number | null) => string;
    return {
      kind,
      title,
      align: options.align ?? "end",
      text,
      format: written,
      amount: format,
      key: written,
      aggregate: name,
      ...(heading !== undefined && {
        heading: {
          id:
            column.kind === "total"
              ? "total"
              : JSON.stringify(value === null ? null : String(value)),
          title: heading,
        },
      }),
    };
  }

  /** A generated column's value in each row, NaN where it is missing or absent: what rows sort by. */
  #valuesOf(id: string): Float64Array {
    const pivot = this.#pivot;
    const crosstab = pivot.read();
    const column = crosstab.column(id);
    if (!column) throw new Error(`The pivot has no column "${id}"`);
    const { name } = column.aggregate;
    if (column.kind === "total")
      return Float64Array.from((pivot.rowTable as unknown as Table).numbers(name));
    const values = new Float64Array(crosstab.rowCount);
    const index = crosstab.indexOf(column.value);
    for (let row = 0; row < values.length; row++)
      values[row] = crosstab.value(row, index, name) ?? Number.NaN;
    return values;
  }
}

/**
 * Ids in the order `placed` has them, with the others placed: a column that
 * was in an order the user chose (`after` gives the column it followed,
 * null when it was first) goes back after that column, or after the one
 * that one followed if it is gone too; others go just before the one after
 * them in `ids` (last when none is), so new values go last, before the
 * totals. `ids` itself while `placed` keeps their order and nothing has a
 * place to go back to.
 */
function arrange(
  ids: readonly string[],
  placed: readonly string[],
  after: (id: string) => string | null | undefined,
): string[] {
  const known = new Set(placed);
  const returning = ids.filter((id) => !known.has(id) && after(id) !== undefined);
  if (returning.length === 0 && follows(placed, ids)) return [...ids];
  const order = [...placed];
  for (const id of returning) {
    // Through the columns it followed that are gone too, to one that is here.
    let before = after(id);
    const passed = new Set<string>();
    while (typeof before === "string" && !known.has(before) && !passed.has(before)) {
      passed.add(before);
      before = after(before);
    }
    if (before === null) order.unshift(id);
    else if (typeof before === "string" && known.has(before))
      order.splice(order.indexOf(before) + 1, 0, id);
    // Nothing it followed is known: it goes where new columns do.
    else continue;
    known.add(id);
  }
  for (let k = ids.length - 1; k >= 0; k--) {
    const id = ids[k]!;
    if (known.has(id)) continue;
    // The one after it is placed already: placed, or added on the way here.
    order.splice(k === ids.length - 1 ? order.length : order.indexOf(ids[k + 1]!), 0, id);
    known.add(id);
  }
  return order;
}

/** Whether the ids of `order` that `reference` has come in its order. */
function follows(order: readonly string[], reference: readonly string[]): boolean {
  const [inOrder, inReference] = [new Set(order), new Set(reference)];
  const kept = reference.filter((id) => inOrder.has(id));
  const shared = order.filter((id) => inReference.has(id));
  return kept.length === shared.length && kept.every((id, i) => id === shared[i]);
}

/** A column's layout, without what it shows. */
function layoutOf({ width, pin, hidden }: GridColumn): Layout {
  return {
    ...(width !== undefined && { width }),
    ...(pin !== undefined && { pin }),
    ...(hidden !== undefined && { hidden }),
  };
}

/**
 * A rank test of a pivot's cells: each value column's own, over the
 * combinations holding its pivot value (positions of the pivot's table), so
 * "the top 3" are a column's three largest.
 */
function columnRanks(
  pivot: RowPivot,
  field: string,
  count: number,
  top: boolean,
): RankRead & Updating {
  const table = pivot.table as unknown as Table;
  /** Each value column's test, and its revision as `update` last saw it. */
  const ranks = new Map<PivotValue, { rank: Rank; seen: number }>();
  let revision = 0;
  let seen: PivotSnapshot | undefined;
  /** Each pivot value's combinations, found in one pass over the table for each crosstab. */
  let columns = new Map<PivotValue, Uint32Array>();
  const rowsOf = (value: PivotValue) => (): MarkRows => {
    const crosstab = pivot.read();
    if (crosstab !== seen) {
      seen = crosstab;
      columns = combinationsByValue(table, pivot.pivot);
    }
    const positions = columns.get(value) ?? NO_POSITIONS;
    return { table, positions, revision: String(table.version) };
  };
  return {
    holds(position) {
      const value = table.value(pivot.pivot, position) as PivotValue;
      let held = ranks.get(value);
      if (!held) {
        held = { rank: new Rank(rowsOf(value), field, count, top), seen: Number.NaN };
        ranks.set(value, held);
      }
      return held.rank.holds(position);
    },
    get revision() {
      return revision;
    },
    update() {
      // Values gone take their ranks with them.
      const values = new Set(pivot.read().values);
      let changed = false;
      for (const [value, held] of ranks) {
        if (!values.has(value)) {
          ranks.delete(value);
          continue;
        }
        // Compared with what this saw last, as cells read may have brought it up to date.
        held.rank.update();
        if (held.rank.revision !== held.seen) {
          held.seen = held.rank.revision;
          changed = true;
        }
      }
      if (changed) revision = nextRevision();
    },
  };
}

const NO_POSITIONS = new Uint32Array(0);

/** The positions of `table`'s rows (a pivot's combinations) by their value of `field`. */
function combinationsByValue(table: Table, field: string): Map<PivotValue, Uint32Array> {
  const lists = new Map<PivotValue, number[]>();
  for (let position = 0; position < table.length; position++) {
    const value = table.value(field as never, position) as PivotValue;
    const list = lists.get(value);
    if (list) list.push(position);
    else lists.set(value, [position]);
  }
  return new Map(Array.from(lists, ([value, list]) => [value, Uint32Array.from(list)]));
}

/** Throws unless a column's layout can be taken. */
function check(id: string, { width, pin }: GridColumn) {
  if (width !== undefined && !(Number.isFinite(width) && width >= MIN_COLUMN_WIDTH))
    throw new RangeError(
      `Column "${id}" needs a width of at least ${MIN_COLUMN_WIDTH} pixels, not ${width}`,
    );
  if (pin !== undefined && pin !== "left" && pin !== "right")
    throw new TypeError(`Column "${id}" pins to "left" or "right", not "${pin}"`);
}
