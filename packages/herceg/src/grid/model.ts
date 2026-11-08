// A grid's state without a DOM, imported as `herceg/grid/model`: the rows
// of a row view (or the view's groups, level by level, each followed by its
// groups below or its rows when expanded, or a pivot's rows, from
// grid/pivot.ts), which rows are selected, and what every grid model has
// (grid/base.ts): its columns, where it is scrolled, and which cell has the
// focus. A renderer (dom/grid.ts) draws it and turns keys, clicks, and drags
// into its commands; applications call the same commands.
// One model serves one grid: grids showing the same rows share the view, the
// groups, and the selection store, each with a model of its own.

import { compileExpression, type Expression, type Fields } from "../data/expression.ts";
import { type GroupKey, groupId, type NamedAggregate, type RowGroups } from "../data/groups.ts";
import type { SortKey } from "../data/order.ts";
import { RowSet } from "../data/row-set.ts";
import type { MarkRows, RowSnapshot, RowView } from "../data/row-view.ts";
import {
  type DataSelection,
  type SelectionChange,
  type SelectionStore,
  selectionStore,
  selectRows,
} from "../data/selection.ts";
import type { PositionField, Schema, Table } from "../data/table.ts";
import type { RowTotals } from "../data/totals.ts";
import { wholeTable } from "../encoding/channel-scales.ts";
import { missingValue } from "../fields/display.ts";
import {
  BaseGridModel,
  type Column,
  cycled,
  type GridCellRead,
  type GridCellState,
  type GridDisplay,
  type GridFocus,
  type GridPresentation,
  type GridRef,
  type GridSettings,
  type GridTotalsRow,
  type LookPresentation,
  nextOrder,
  type SelectionState,
  type SelectMode,
  type TotalsSource,
  totalsRow,
} from "./base.ts";
import { type CellBinding, drawsSymbols } from "./cells.ts";
import {
  aggregateWriter,
  type ColumnContent,
  cellText,
  checkKeys,
  columnId,
  describeColumns,
  type FormatSettings,
  type GridColumn,
  type NoTables,
  type PlacedColumn,
  type ScopeOf,
} from "./columns.ts";
import { COPY_ROWS, type CopiedRows, EXPORT_ROWS, type LocalRows } from "./export-rows.ts";
import {
  countGroup,
  countRow,
  countSelected,
  countsHold,
  extended,
  groupCell,
  headerTexts,
  type Projection,
  placeOf,
  project,
  type SelectedCounts,
  shownAs,
  stamped,
} from "./grouped.ts";
import {
  type CellEncodings,
  type CellLook,
  compileEncodings,
  type Look,
  LookScales,
  type LookSettings,
  type LookTable,
  lookOf,
  rankOf,
  withEncodingsCopied,
} from "./looks.ts";

export {
  BaseGridModel,
  type FocusMove,
  type GridCellRead,
  type GridCellState,
  type GridFocus,
  type GridPresentation,
  type GridRange,
  type GridRef,
  type GridSelectCause,
  type GridSelectionOptions,
  type GridSettings,
  type GridTotalsRow,
  type SelectionState,
  type SelectMode,
  type ShownRow,
} from "./base.ts";
export {
  type BarCellOptions,
  barCell,
  type CellFieldKind,
  chipCell,
  type GridCell,
  type GridCellSpec,
  type SymbolCellOptions,
  symbolCell,
  type UnboundCell,
} from "./cells.ts";
export {
  type AggregateScope,
  type AnyAggregates,
  type CellOf,
  type GridColumn,
  type GridColumnLayout,
  type GridFieldColumn,
  type GridHeading,
  type GridTextColumn,
  MIN_COLUMN_WIDTH,
  MIN_SCROLLING_WIDTH,
  type NoTables,
  type PinSide,
  type ScopeOf,
} from "./columns.ts";
export { exportGrid, GridExportError, type GridExportOptions } from "./export.ts";
export type {
  CellEncodings,
  CellLook,
  GridCategories,
  GridGradient,
  GridScale,
  GridScales,
} from "./looks.ts";
export {
  type SparklineCellSpec,
  type SparklineKey,
  type SparklineOptions,
  type SparklineRead,
  sparklineCell,
} from "./sparklines.ts";

/**
 * A model's options. `G` and `B` are its groups' (their last level's table
 * and grouping fields), inferred from `groups`, and `T` its totals'
 * (their table), inferred from `totals`; by default (none, a schema given
 * alone: `createGridModel<S>(...)`, or options annotated
 * `GridModelOptions<S>`), they take groups and totals of any aggregates,
 * and columns name any, which the model checks as groups and totals arrive.
 */
/** Groups' or totals' table as options take it: any while none is inferred or given (`NoTables`). */
// biome-ignore lint/suspicious/noExplicitAny: groups and totals of any aggregates, as erased ones are.
type Given<T extends Schema> = [keyof T] extends [never] ? any : T;

export interface GridModelOptions<
  S extends Schema = Schema,
  G extends Schema = NoTables,
  B extends readonly string[] = readonly string[],
  T extends Schema = NoTables,
> extends GridSettings {
  /** The rows to show, in order. The application owns the view; the grid sorts through it. */
  data: RowView<S>;
  /**
   * The columns. Their `aggregate` and `aggregateEncode` name what the
   * groups' and the totals' tables hold, checked against those the model
   * is made with.
   */
  columns: readonly GridColumn<S, NoInfer<ScopeOf<G, B, T>>>[];
  /**
   * Groups of the view's rows (`groupRows(data, ...)`) to show as group
   * rows, each followed by its groups below, or its rows, when expanded;
   * none by default.
   */
  groups?: RowGroups<S, Given<G>, B> | null;
  /**
   * A totals row under the rows (`rowTotals(data, { ops })`, of the grid's
   * view): each column's `aggregate` of these totals, and "Total" in the
   * first shown column without one; none by default. With groups, group
   * rows are the subtotals and this the grand total: an aggregate both
   * name is one operation of one field.
   */
  totals?: RowTotals<S, Given<T>> | null;
  /**
   * How whole table rows look (`fill`, `color`): every cell of a row where
   * its column's own channel gives no output. Group rows and the totals
   * row take none.
   */
  encode?: CellEncodings<S> | undefined;
  /** Where the selected rows go; a store of the grid's own when left out. */
  selectionStore?: SelectionStore<S>;
  /** The store's channel for the selected rows; "grid-rows" by default. */
  channel?: string;
}

/**
 * What a row of the grid shows: a row of the table, or, in grouped grids,
 * a group's header. Made when asked for; the grid keeps no object per row.
 */
export type GridRow =
  | {
      readonly kind: "row";
      /** Follows the row: its table's generation and identity. */
      readonly ref: GridRef;
      /** The table's `modifiedVersion`: what the row shows changes with it. */
      readonly version: number;
      /** Its position in the table. */
      readonly position: number;
      /** Its table's identity of it (`Table.identity`): its own while rows come and go, until the table resets. */
      readonly identity: number;
      /** Its group (a row of the groups' last table), or -1 when the grid has no groups. */
      readonly group: number;
      /** Its level in the tree: one past the groups' levels under groups, 1 otherwise. */
      readonly level: number;
      /** Its place among its group's rows (or the grid's), from 0, and how many there are. */
      readonly setIndex: number;
      readonly setSize: number;
    }
  | {
      readonly kind: "group";
      /** Follows the group: its groups and its id. */
      readonly ref: GridRef;
      /** The groups' revision: what the header shows changes with it. */
      readonly version: number;
      /** The group: a row of its level's table, `groups.tableOf(groups.by[level - 1])`. */
      readonly group: number;
      /** Its key path: its value of each grouping field down to its level's. */
      readonly key: GroupKey;
      /** Names the group for maps and element keys, the same while its key is. */
      readonly id: string;
      /** Rows of the view in the group, shown or not. */
      readonly rows: number;
      readonly expanded: boolean;
      /** Its level in the tree, from 1: the number of grouping fields its key has. */
      readonly level: number;
      /** Its place among the groups in the same group above (or the first level's), from 0, and how many there are. */
      readonly setIndex: number;
      readonly setSize: number;
    };

/** A table row by its table's generation and identity, or a group by its key among its groups. */
type RowRef = { readonly scope: number; readonly id: number };
type GroupRef = { readonly scope: RowGroups; readonly id: string; readonly key: GroupKey };

/** What the grid shows, as of one state of its view, table, and groups. */
interface Display extends GridDisplay {
  readonly snapshot: RowSnapshot;
  readonly grouped: Projection | null;
}

/**
 * A row: its group and the group's depth (the last level's for a row of the
 * table), its position (-1 for a group's header), and in grouped grids the
 * header shown at or before it and how far past that header it is.
 */
interface Entry {
  readonly depth: number;
  readonly group: number;
  readonly position: number;
  readonly header: number;
  readonly offset: number;
}

/** A pivot's cells' looks, compiled (see `GridPivot.looks`). */
export interface PivotLooks {
  /** Whether any aggregate's columns have looks. */
  readonly any: boolean;
  /** The look of the cell of generated column `column` in pivot row `row`. */
  lookAt(column: string, row: number): CellLook | undefined;
  /** The look of its cell on the totals row. */
  totalAt(column: string): CellLook | undefined;
}

/**
 * A pivot as a grid shows it (grid/pivot.ts, which keeps pivots out of
 * grids that show none): its rows are its groups' first level, never
 * expanded, and its columns are generated, each a field of its crosstab.
 */
export interface GridPivot {
  readonly groups: RowGroups;
  /** The table whose row `r` holds the pivot's row `r`, which cells read. */
  readonly rows: Table;
  /** The crosstab's fields (the rows field and the columns generated), which rows sort by. */
  readonly fields: Fields;
  /** Counts changes of the columns generated. */
  readonly revision: number;
  /** Whether the pivot stopped at a limit: its rows show what they held, and select nothing. */
  readonly stopped: boolean;
  /** Whether it has a totals row, and the versions of what that row reads (see `GridTotalsRow.version`). */
  readonly totalsRow: boolean;
  readonly totalsVersion: string;
  /** What the totals row's cell of column `column` holds; null for the rows column, which says "Total". */
  total(column: string): Pick<GridCellRead, "state" | "value" | "kind"> | null;
  /** Refuses `settings` that cannot write what the pivot shows, changing nothing; `columns` then takes them. */
  check(settings: FormatSettings): void;
  /**
   * The columns generated now, laid out as `current` left them, or as
   * `given` (by `setColumns`) says, written as `settings` say. Throws
   * before anything changes where they refuse what the pivot shows.
   */
  columns(
    current: readonly Column[],
    given: readonly GridColumn[] | null,
    settings: FormatSettings,
  ): { columns: Column[]; contents: Map<string, ColumnContent> };
  /** Its aggregates' looks compiled as `settings` say; throws where they are refused. */
  looks(settings: LookSettings): PivotLooks;
  /** What the cell of column `column` in pivot row `row` holds. */
  read(column: string, row: number): Pick<GridCellRead, "state" | "value" | "kind">;
}

/** A model's looks, compiled (see grid/looks.ts). */
interface ModelLooks {
  readonly scales: LookScales;
  /** Each column's channels on table rows, by column id, and the rows' own. */
  readonly records: ReadonlyMap<string, Look>;
  readonly rows: Look | undefined;
  /** Each group level's table, and each column's channels on its rows, by column id. */
  readonly tables: readonly Table[];
  readonly levels: readonly ReadonlyMap<string, Look>[];
  /** Each column's channels on the totals row, by column id. */
  readonly totals: ReadonlyMap<string, Look>;
  readonly pivot: PivotLooks | undefined;
  /** Whether anything has looks. */
  readonly any: boolean;
  /** The display the domains and ranks were last brought up to date for. */
  seen: GridDisplay | undefined;
}

/**
 * The state of one grid over a row view. Every read brings it up to date
 * with its view, its groups, its table, and its selection store; listeners
 * are told synchronously when any of them, or the model's own state, changes.
 */
export class GridModel<S extends Schema = Schema> extends BaseGridModel<S> {
  readonly data: RowView<S>;
  readonly selectionStore: SelectionStore<S>;
  readonly channel: string;
  readonly #table: Table;
  #looks: ModelLooks | null = null;
  /** What columns' cell kinds read of the rows, by column id, and the display they were brought up to date for. */
  #cells: { bindings: Map<string, CellBinding>; seen: GridDisplay | undefined } = {
    bindings: new Map(),
    seen: undefined,
  };
  /** The view's rows as looks last read them. */
  #recordRows: MarkRows | undefined;

  #groups: RowGroups | null = null;
  #totals: RowTotals | null = null;
  /** The totals row's reader while there is one, and what it reads. */
  #totalsRow: GridTotalsRow | null = null;
  #totalsSource: TotalsSource | null = null;
  readonly #pivot: GridPivot | null;
  /** The pivot's columns' revision the columns were generated for. */
  #pivotRevision = -1;
  #groupSort: readonly SortKey[] = [];
  /** Ids of groups expanded otherwise than by default. */
  readonly #toggled = new Set<string>();
  #expandedByDefault = false;
  /** Counts changes of the groups or their order, which keep the scroll offset as a new query does. */
  #structure = 0;
  /** Counts those and changes of expansion, which keep the top row in place. */
  #arrangement = 0;
  #groupTexts: {
    layout: readonly PlacedColumn[];
    groups: RowGroups;
    texts: ((group: number, depth: number) => string)[];
  } | null = null;
  #counts: SelectedCounts | null = null;

  /** The view's revision, its table's version, and the groups' revision the display is of. */
  #seen = {
    revision: -1,
    version: -1,
    query: -1,
    generation: -1,
    groups: -1,
    structure: -1,
    arrangement: -1,
  };

  #condition: { expression: Expression; version: number; test: (row: number) => boolean } | null =
    null;
  #count: { selection: unknown; version: number; count: number } | null = null;

  readonly #stop: () => void;

  /** `pivot`, from `createPivotGridModel`, shows a pivot's rows. */
  // biome-ignore lint/suspicious/noExplicitAny: groups and totals of any fields, which the columns' types were checked against.
  constructor(options: GridModelOptions<S, any, any, any>, pivot?: GridPivot) {
    super(options, pivot ? "pivot grid" : "grid", options.data.source as unknown as Table);
    const { data, selectionStore: store } = options;
    this.data = data;
    this.#table = data.source as unknown as Table;
    if (store && store.source !== data.source)
      throw new Error(
        "grid selectionStore: the store is of another table; give a store of the view's table",
      );
    this.selectionStore = store ?? selectionStore(data.source);
    this.channel = options.channel ?? "grid-rows";
    this.#pivot = pivot ?? null;
    const columns = options.columns as unknown as readonly GridColumn[];
    const groups = pivot ? null : (options.groups ?? null);
    this.#totals = this.#checkAggregates(groups, this.presentation.totals, pivot ? [] : columns);
    this.#groups = pivot ? pivot.groups : (groups as RowGroups | null);
    this.#totalsRow = this.#makeTotalsRow();
    if (pivot) this.#looks = this.#compileLooks([], this.settings, this.presentation, null, null);
    this.setColumns(options.columns as unknown as readonly GridColumn<S>[]);
    // Held weakly by what it follows, so a model no one keeps stops following on its own.
    const ref = new WeakRef(this);
    const changed = () => {
      const model = ref.deref();
      if (model) model.#changed();
      else stop();
    };
    const selected = ({ channel, selection, revision }: SelectionChange<S>) => {
      const model = ref.deref();
      if (!model) return stop();
      if (channel === model.channel) model.heardSelection(selection, revision);
      model.#changed();
    };
    const stops = [data.subscribe(changed), this.selectionStore.subscribe(selected)];
    const stop = () => {
      for (const unsubscribe of stops) unsubscribe();
    };
    this.#stop = stop;
    followers.register(this, stop, this);
  }

  // Columns

  /**
   * Replaces the columns: their order, widths, pins, formats, aggregates,
   * looks, and which are hidden; names of aggregates are checked against
   * the groups. A pivot grid's columns are generated: it takes their
   * layout, by id, kept for columns not generated now until they are.
   */
  setColumns(columns: readonly GridColumn<S>[]): void {
    const pivot = this.#pivot;
    // Encodings copied, so a caller's later changes reach looks only through `setColumns`.
    const given = (columns as unknown as readonly GridColumn[]).map(withEncodingsCopied);
    if (pivot) {
      const generated = pivot.columns(
        this.columnList as unknown as readonly Column[],
        given,
        this.settings,
      );
      this.#pivotRevision = pivot.revision;
      this.takeColumns(generated.columns as unknown as Column<S>[], generated.contents);
      return;
    }
    const contents = describeColumns(this.#table, given, this.settings);
    this.#checkAggregates(this.#groups, this.#totals, given);
    const looks = this.#compileLooks(
      given,
      this.settings,
      this.presentation,
      this.#groups,
      this.#totals,
    );
    const cells = this.#bindCells(given, contents, this.settings);
    this.#looks = looks;
    this.#cells = cells;
    this.takeColumns(
      given.map((column) => ({
        ...column,
        id: columnId(column),
      })) as unknown as Column<S>[],
      contents,
    );
  }

  protected restyle(settings: FormatSettings, presentation: LookPresentation): () => void {
    const pivot = this.#pivot;
    if (pivot) {
      this.#checkAggregates(null, presentation.totals, []);
      pivot.check(settings);
      const looks = this.#compileLooks([], settings, presentation, null, null);
      // Once the settings are the model's: the columns generated as the
      // pivot is now and written as they say, as catching up generates them.
      return () => {
        this.#looks = looks;
        this.#generate(pivot);
      };
    }
    const columns = this.columnList as unknown as readonly GridColumn[];
    const contents = describeColumns(this.#table, columns, settings);
    const totals = this.#checkAggregates(this.#groups, presentation.totals, columns);
    // Group rows write keys of grouping fields no column shows too.
    checkKeys(this.#table, this.#groups?.by ?? [], settings, this.#table);
    const looks = this.#compileLooks(columns, settings, presentation, this.#groups, totals);
    const cells = this.#bindCells(columns, contents, settings);
    return () => {
      this.#looks = looks;
      this.#cells = cells;
      if (totals !== this.#totals) {
        this.#totals = totals;
        this.#totalsRow = this.#makeTotalsRow();
      }
      this.takeColumns(this.columnList, contents);
    };
  }

  // Groups

  /** The groups the grid shows, or null when it shows the view's rows alone (or a pivot's). */
  get groups(): RowGroups<S> | null {
    return (this.#pivot ? null : this.#groups) as RowGroups<S> | null;
  }

  get grouped(): boolean {
    return this.groups !== null;
  }

  /**
   * Shows the view's rows in these groups (made by `groupRows` from the
   * grid's view), or without groups again with null. Groups start
   * collapsed, in the order they first appeared.
   */
  setGroups(groups: RowGroups<S> | null): void {
    if (this.#pivot) throw new Error("A pivot grid shows its pivot's rows");
    if (groups === this.#groups) return;
    const columns = this.columnList as unknown as readonly GridColumn[];
    this.#checkAggregates(groups, this.#totals, columns);
    const looks = this.#compileLooks(
      columns,
      this.settings,
      this.presentation,
      groups as RowGroups | null,
      this.#totals,
    );
    this.current();
    this.#groups = groups as RowGroups | null;
    this.#looks = looks;
    this.#toggled.clear();
    this.#expandedByDefault = false;
    this.#groupSort = [];
    // Nothing may keep the groups replaced, which follow their view while kept.
    this.#counts = null;
    this.#groupTexts = null;
    if (this.rangeAnchor && "key" in this.rangeAnchor) this.rangeAnchor = null;
    this.#structure++;
    this.#arrangement++;
    this.current();
    this.notify();
  }

  /** The order of the groups: keys over the groups' tables (grouping fields and aggregates). */
  get groupSort(): readonly SortKey[] {
    return this.#groupSort;
  }

  /**
   * Orders the groups by fields of the groups' tables, stably; the order
   * they appeared in without keys. Each level's groups are ordered among
   * their siblings by the keys its table has: aggregates order every level,
   * and a grouping field the groups of its own level.
   */
  setGroupSort(keys: readonly SortKey[]): void {
    this.current();
    this.#sortGroups(keys);
    this.current();
    this.notify();
  }

  /** Whether the group with this key path (of any level) shows its groups below, or its rows. */
  isExpanded(key: GroupKey): boolean {
    return this.#isOpen(groupId(key));
  }

  /**
   * Shows or hides the groups below, or the rows, of the group with this key
   * path; groups below keep their own expansion. The focus on a row or group
   * hidden moves to the group's header when it collapses.
   */
  setExpanded(key: GroupKey, expanded: boolean): void {
    if (this.isExpanded(key) === expanded) return;
    const id = groupId(key);
    if (expanded === this.#expandedByDefault) this.#toggled.delete(id);
    else this.#toggled.add(id);
    this.#prune();
    this.#rearrange();
  }

  /** Expands every group of every level, those that appear later too. */
  expandAll(): void {
    this.#expandedByDefault = true;
    this.#toggled.clear();
    this.#rearrange();
  }

  /** Collapses every group of every level, those that appear later too. */
  collapseAll(): void {
    this.#expandedByDefault = false;
    this.#toggled.clear();
    this.#rearrange();
  }

  /** Where the header of the group with this key path shows, or -1 (a group above it is collapsed). */
  rowIndexOfGroup(key: GroupKey): number {
    const groups = this.#groups;
    this.current();
    if (!groups) return -1;
    return this.find({ scope: groups, id: groupId(key), key } as GroupRef, false);
  }

  // Rows

  /** What the row at `rowIndex` shows: a row of the table, or a group's header. */
  row(rowIndex: number): GridRow {
    const display = this.current() as Display;
    const entry = this.#entry(rowIndex);
    const ref = this.refAt(rowIndex);
    const { grouped } = display;
    if (entry.position >= 0) {
      const { position, group } = entry;
      return {
        kind: "row",
        ref,
        version: this.#table.modifiedVersion,
        position,
        identity: ref.id as number,
        group,
        level: grouped ? grouped.groups.by.length + 1 : 1,
        setIndex: grouped ? entry.offset - 1 : rowIndex,
        setSize: grouped ? grouped.groups.size(group) : display.length,
      };
    }
    const { groups, open, places, siblings } = grouped!;
    const { group, depth, header } = entry;
    return {
      kind: "group",
      ref,
      version: groups.revision,
      group,
      key: (ref as GroupRef).key,
      id: ref.id as string,
      rows: groups.size(group, depth),
      expanded: open[depth]![group] === 1,
      level: depth + 1,
      setIndex: places[header]!,
      setSize: siblings[header]!,
    };
  }

  /** The table position of the row at `rowIndex`; a group's header has none. */
  rowAt(rowIndex: number): number {
    const { position } = this.#entry(rowIndex);
    if (position < 0) throw new TypeError(`Row ${rowIndex} is a group's header, not a table row`);
    return position;
  }

  /**
   * The row's identity (`Table.identity`), which stays its own as rows
   * are appended and dropped, until the table resets.
   */
  identityAt(rowIndex: number): number {
    return this.#table.identity(this.rowAt(rowIndex));
  }

  /** Where the row of this identity shows now, or -1 when the grid leaves it out (or its group is collapsed). */
  rowIndexOf(identity: number): number {
    const { generation } = (this.current() as Display).snapshot;
    return this.find({ scope: generation, id: identity }, false);
  }

  /** The text of a cell: row `rowIndex` of the view, shown column `columnIndex`. */
  textAt(rowIndex: number, columnIndex: number): string {
    // Catching up first: a pivot's columns follow its rows.
    const { group, depth, position } = this.#entry(rowIndex);
    const { content } = this.#column(columnIndex);
    // A linked cell's text is its link's.
    if (position >= 0) return cellText(content, this.#table, position);
    if (this.#pivot) return content.text(this.#pivot.rows, group);
    return this.#textsOfGroups()[columnIndex]!(group, depth);
  }

  lookAt(rowIndex: number, columnIndex: number): CellLook | undefined {
    const { group, depth, position } = this.#entry(rowIndex);
    const { id } = this.#column(columnIndex);
    const looks = this.#currentLooks();
    if (!looks.any) return undefined;
    if (looks.pivot) return looks.pivot.lookAt(id, group);
    if (position >= 0) return lookOf(this.#table, position, looks.records.get(id), looks.rows);
    return lookOf(looks.tables[depth]!, group, looks.levels[depth]?.get(id));
  }

  cellAt(rowIndex: number, columnIndex: number): GridCellRead {
    const { group, depth, position } = this.#entry(rowIndex);
    const column = this.#column(columnIndex);
    const look = this.lookAt(rowIndex, columnIndex);
    if (position >= 0 && !this.#pivot) {
      const { content } = column;
      // A column without a field has its text alone, and a sparkline's series.
      if (column.field === null)
        return {
          state: "empty",
          value: undefined,
          kind: null,
          text: content.text(this.#table, position),
          look,
          link: undefined,
          ...(content.sparkline && { sparkline: content.sparkline.read(this.#table, position) }),
        };
      const link = content.link?.(this.#table, position);
      const value = this.#table.value(column.field as never, position) as number | string | null;
      const missing = missingValue(column.kind!, value);
      const binding = content.cell && this.#currentCells().get(column.id);
      return {
        state: missing ? "missing" : "value",
        value: missing ? null : value,
        kind: column.kind,
        text: link ? link.text : content.text(this.#table, position),
        look,
        link,
        ...(binding && { bar: binding.bar(missing ? null : (value as number)) }),
      };
    }
    const text = this.textAt(rowIndex, columnIndex);
    const cell = (
      state: GridCellState,
      value: GridCellRead["value"],
      kind: GridCellRead["kind"],
    ) => ({
      state,
      value,
      kind,
      text,
      look,
      link: undefined,
    });
    if (this.#pivot) return { ...this.#pivot.read(column.id, group), text, look, link: undefined };
    const { state, value, kind } = groupCell(
      this.#groups!,
      this.#table,
      group,
      depth,
      column,
      columnIndex === 0,
    );
    return cell(state, value, kind);
  }

  /**
   * Changes how the grid presents its rows (see `BaseGridModel.update`),
   * and its totals row: `totals` of the grid's view, or null to drop it.
   */
  override update(
    options: GridPresentation<S> & { totals?: RowTotals<S> | null | undefined },
  ): void {
    super.update(options);
  }

  /** The totals row under the rows, of the model's `totals` or a pivot's totals row; null without one. */
  get totalsRow(): GridTotalsRow | null {
    return this.#totalsRow;
  }

  /** The totals the totals row shows (`totals`), or null; a pivot's are its own. */
  get totals(): RowTotals<S> | null {
    return this.#totals as RowTotals<S> | null;
  }

  get hasLooks(): boolean {
    return this.#looks?.any ?? false;
  }

  get looksRevision(): number {
    return this.#currentLooks().scales.revision;
  }

  cellsRevision(columnIndex: number): number {
    const { id, content } = this.#column(columnIndex);
    return content.sparkline?.revision ?? this.#currentCells().get(id)?.revision ?? 0;
  }

  askFields(_asker: object, fields: readonly (readonly [field: string, at: string])[]): void {
    const table = this.#table;
    for (const [field, at] of fields)
      if (!table.has(field as never) || table.kind(field as never) === "geometry")
        throw new Error(
          `${at}: no field ${JSON.stringify(field)} in the grid's table; the table has ${table
            .fields()
            .map((one) => JSON.stringify(one))
            .join(", ")}`,
        );
  }

  rowValues(rowIndex: number): (field: string) => number | string | null {
    const table = this.#table;
    // By identity: a sort or a rolling window moves the row, not its values; a reset ends it.
    const identity = table.identity(this.rowAt(rowIndex));
    const generation = table.generation;
    return (field) => {
      if (!table.has(field as never))
        throw new Error(`grid rowValues: no field ${JSON.stringify(field)}`);
      const position = table.positionOf(identity, generation);
      if (position < 0)
        throw new RangeError(`grid rowValues: row ${identity} is no longer in the table`);
      const value = table.value(field as never, position) as number | string | null;
      return missingValue(table.kind(field as never) as "number", value) ? null : value;
    };
  }

  [EXPORT_ROWS](): LocalRows {
    const { snapshot, grouped, length } = this.current() as Display;
    return {
      table: this.#table,
      view: this.data as unknown as RowView,
      snapshot,
      grouped,
      length,
      pivot: this.#pivot,
      settings: this.settings,
      layout: this.columnLayout as readonly PlacedColumn[],
      totals: this.#totalsSource,
      selected: (limit) => this.#selectedOf(limit),
    };
  }

  [COPY_ROWS](columns: readonly PlacedColumn[], limit: number): CopiedRows {
    // A pivot refuses any selection, without finding its rows.
    if (this.#pivot) return this.selectionStore.get(this.channel) ? PIVOT_ROWS : null;
    const positions = this.#selectedOf(limit);
    if (!positions) return null;
    const table = this.#table;
    let row = 0;
    return {
      total: positions.length,
      next: (cells) => {
        if (row >= positions.length) return false;
        const position = positions[row++]!;
        columns.forEach(({ content }, c) => {
          cells[c] = cellText(content, table, position);
        });
        return true;
      },
    };
  }

  // Sorting

  get sort(): readonly SortKey<PositionField<S>>[] {
    // A pivot grid's keys are of its crosstab's fields, as they are now.
    if (this.#pivot) {
      this.generated();
      return this.#groupSort as readonly SortKey<PositionField<S>>[];
    }
    return this.data.query.sort ?? [];
  }

  /**
   * Sorts the view by these keys, keeping its filter; in grouped grids, the
   * rows within each group. A pivot grid sorts its rows by its columns'
   * fields, leaving the view alone.
   */
  setSort(keys: readonly SortKey<PositionField<S>>[]): void {
    if (this.#pivot) this.setGroupSort(keys);
    else this.data.setQuery({ ...this.data.query, sort: keys });
  }

  /**
   * Sorts by a column's field as a header click does: ascending, then
   * descending, then not at all. Plain, the field becomes the only key;
   * additive (Shift and click), the other keys stay and a new field goes last.
   * In grouped grids the groups sort too: every level's by the column's
   * aggregate, or the level of the grouping field the column shows by key.
   */
  cycleSort(column: string, { additive = false }: { additive?: boolean } = {}): void {
    const definition = this.column(column);
    if (definition.field === undefined)
      throw new TypeError(
        `${this.settings.surface} cycleSort: column ${JSON.stringify(column)} has no field to sort by; sort by a field`,
      );
    const field = definition.field as PositionField<S>;
    const keys = this.sort;
    const order = nextOrder(keys, field);
    const groups = this.#groups;
    if (groups && !this.#pivot) {
      const by = groups.by as readonly string[];
      const key = definition.aggregate ?? (by.includes(field) ? field : undefined);
      this.current();
      this.#sortGroups(cycled(this.#groupSort, key, order, additive));
    }
    this.setSort(cycled(keys, field, order, additive));
  }

  // Selection

  /** How much of a row is selected; a group's header is partly when some of its rows are. */
  selectionState(rowIndex: number): SelectionState {
    const { group, depth, position } = this.#entry(rowIndex);
    if (position >= 0) return this.#selected(position) ? "all" : "none";
    const selected = this.#groupCounts().counts[depth]![group]!;
    return selected === 0 ? "none" : selected >= this.#groups!.size(group, depth) ? "all" : "some";
  }

  get selectionRevision(): number {
    return this.selectionStore.revision;
  }

  /**
   * Rows selected, counting those the view leaves out. A condition is
   * counted over the whole table, so ask after selecting, not every frame.
   */
  get selectedCount(): number {
    const selection = this.selectionStore.get(this.channel);
    if (!selection) return 0;
    if (selection.kind === "rows") return selection.rows.size;
    const version = this.#table.version;
    if (this.#count?.selection !== selection || this.#count.version !== version) {
      const test = this.#test(selection.expression);
      let count = 0;
      for (let row = 0; row < this.#table.length; row++) if (test(row)) count++;
      this.#count = { selection, version, count };
    }
    return this.#count.count;
  }

  /**
   * The selection becomes a row set in the channel (a copy of the one
   * there, which is frozen). A group's header stands for every row of the
   * group the view shows, in its groups below too, collapsed or not;
   * toggling it clears them when all are selected.
   */
  protected applySelect(rowIndex: number, mode: SelectMode): void {
    const { group, depth, position } = this.#entry(rowIndex);
    if (this.#pivot?.stopped) return;
    if (mode === "only" || mode === "toggle") {
      const only = mode === "only";
      const rows = only ? new RowSet(this.data.source) : this.#writable();
      const groups = this.#groups;
      let adjust: (counts: readonly Float64Array[]) => void;
      if (position >= 0) {
        const removed = !only && rows.has(position);
        if (removed) rows.delete(position);
        else rows.add(position);
        adjust = (counts) => {
          if (only) for (const at of counts) at.fill(0);
          if (group >= 0) countRow(counts, groups!, group, removed ? -1 : 1);
        };
      } else {
        const members = groups!.members(group, depth);
        const removed = !only && this.selectionState(rowIndex) === "all";
        if (removed) for (const member of members) rows.delete(member);
        else rows.addAll(members);
        adjust = (counts) => {
          if (only) for (const at of counts) at.fill(0);
          countGroup(counts, groups!, depth, group, !removed);
        };
      }
      this.rangeAnchor = this.refAt(rowIndex);
      this.#publish(rows, adjust);
      return;
    }
    let from = this.rangeAnchorIndex();
    if (from === null) {
      from = rowIndex;
      this.rangeAnchor = this.refAt(rowIndex);
    }
    const rows = mode === "range" ? new RowSet(this.data.source) : this.#writable();
    const [start, end] = from <= rowIndex ? [from, rowIndex + 1] : [rowIndex, from + 1];
    this.#addRows(rows, start, end);
    this.#publish(rows, null);
  }

  protected applySelectAll(): void {
    const { snapshot } = this.current() as Display;
    if (this.#pivot?.stopped) return;
    const rows = new RowSet(this.data.source);
    addRows(rows, snapshot, 0, snapshot.length);
    const groups = this.#groups;
    this.#publish(rows, (counts) => {
      counts.forEach((at, depth) => {
        for (let group = 0; group < at.length; group++) at[group] = groups!.size(group, depth);
      });
    });
  }

  protected selectedAlone(rowIndex: number): boolean {
    const { group, depth, position } = this.#entry(rowIndex);
    const rows = position >= 0 ? 1 : this.#groups!.size(group, depth);
    return this.selectionState(rowIndex) === "all" && this.selectedCount === rows;
  }

  protected applyClearSelection(): boolean {
    const store = this.selectionStore;
    const had = store.get(this.channel) !== null || this.rangeAnchor !== null;
    this.rangeAnchor = null;
    if (store.get(this.channel) !== null) this.writeSelection(store, this.channel, null);
    return had;
  }

  /** Stops following the view and the store. They, the groups, and the table stay the application's. */
  override dispose(): void {
    this.#stop();
    followers.unregister(this);
    super.dispose();
    this.#condition = null;
    this.#count = null;
    this.#counts = null;
    this.#groupTexts = null;
    this.#recordRows = undefined;
  }

  // For the shared model (base.ts)

  /**
   * Catches up with the view, its table, and the groups: the top row keeps
   * its place when the table changed or groups were expanded or collapsed,
   * unless the query, the groups, or their order changed too or the table
   * was reset.
   */
  protected catchUp(previous: GridDisplay | undefined): Display {
    const view = this.data;
    const groups = this.#groups;
    const pivot = this.#pivot;
    if (pivot && pivot.revision !== this.#pivotRevision) this.#generate(pivot);
    // The groups' revision catches them up; the table's version too, since a
    // listener of the table that runs before the view's reads before the
    // view has been told.
    const revision = groups ? groups.revision : -1;
    const seen = this.#seen;
    if (
      previous &&
      view.revision === seen.revision &&
      view.source.version === seen.version &&
      revision === seen.groups &&
      this.#arrangement === seen.arrangement
    )
      return previous as Display;
    const snapshot = view.read();
    const reset = snapshot.generation !== seen.generation;
    const requery = view.queryRevision !== seen.query || this.#structure !== seen.structure;
    const grouped = groups
      ? project(
          groups,
          this.#groupSort,
          (id) => this.#isOpen(id),
          pivot ? [pivot.fields] : undefined,
        )
      : null;
    this.#seen = {
      revision: view.revision,
      version: view.source.version,
      query: view.queryRevision,
      generation: snapshot.generation,
      groups: revision,
      structure: this.#structure,
      arrangement: this.#arrangement,
    };
    return {
      snapshot,
      length: grouped ? grouped.starts[grouped.count]! : snapshot.length,
      grouped,
      keep: !reset && !requery,
    };
  }

  /** What follows the row at `rowIndex`: its identity, or its group's key path. */
  protected refAt(rowIndex: number): GridRef {
    const { snapshot, grouped } = this.current() as Display;
    const { group, depth, position } = this.#entry(rowIndex);
    if (position >= 0) return { scope: snapshot.generation, id: this.#table.identity(position) };
    const groups = grouped!.groups;
    return {
      scope: groups,
      id: groups.idOf(group, depth),
      key: groups.keyOf(group, depth),
    } as GroupRef;
  }

  /**
   * Where a row or group is now, or -1 when it left (or the table was reset
   * since). A row or group hidden by a collapsed group above is at that
   * group's header with `collapsed`, and nowhere without.
   */
  protected find(ref: GridRef, collapsed: boolean): number {
    const { snapshot, grouped } = this.current() as Display;
    if ("key" in ref) {
      const { key, scope } = ref as GroupRef;
      if (!grouped || scope !== grouped.groups) return -1;
      const group = grouped.groups.indexOf(key);
      if (group < 0) return -1;
      const depth = key.length - 1;
      const shown = shownAs(grouped, depth, group);
      if (shown.depth < depth && !collapsed) return -1;
      return grouped.starts[grouped.rank[shown.depth]![shown.group]!]!;
    }
    const { scope, id } = ref as RowRef;
    if (scope !== snapshot.generation) return -1;
    const position = this.#table.positionOf(id, scope);
    if (position < 0) return -1;
    if (!grouped) return this.data.indexOf(position);
    const { groups, starts, rank, open } = grouped;
    const group = groups.groupOf(position);
    if (group < 0) return -1;
    const last = groups.by.length - 1;
    const shown = shownAs(grouped, last, group);
    const header = starts[rank[shown.depth]![shown.group]!]!;
    if (shown.depth < last || !open[last]![group]) return collapsed ? header : -1;
    const index = groups.memberIndex(position);
    return index < 0 ? -1 : header + 1 + index;
  }

  protected override moveInTree(focus: GridFocus, left: boolean): boolean {
    const { grouped } = this.current() as Display;
    if (!grouped || this.#pivot) return false;
    const { group, depth, position, header } = this.#entry(focus.rowIndex);
    const expanded = position < 0 && grouped.open[depth]![group] === 1;
    if (position < 0 && expanded === left) {
      this.setExpanded(grouped.groups.keyOf(group, depth), !expanded);
      return true;
    }
    // A collapsed group's parent, or a row's group, is shown above it.
    const holder =
      position >= 0
        ? header
        : depth > 0
          ? grouped.rank[depth - 1]![grouped.groups.parentOf(group, depth)]!
          : -1;
    if (!left || holder < 0) return false;
    this.focusCell(grouped.starts[holder]!, focus.column);
    return true;
  }

  /** A pivot's columns follow its values: they catch up with the rows. */
  protected override generated() {
    if (this.#pivot) this.current();
  }

  /** The view, its table, or the store changed. */
  #changed() {
    // Compiled conditions hold the table's arrays as they were.
    this.#condition = null;
    this.#count = null;
    this.notify();
  }

  /** The shown column `columnIndex`, or an error. */
  #column(columnIndex: number): PlacedColumn {
    const column = this.columnLayout[columnIndex] as PlacedColumn | undefined;
    if (!column) throw new RangeError(`Column ${columnIndex} is not shown`);
    return column;
  }

  /**
   * The records looks read: the view's rows, or the table's every row where
   * the view shows each of them (in any order), whose extents appends extend.
   */
  #records = (): MarkRows => {
    const view = this.data as unknown as RowView;
    const { filter } = view.query;
    if ((filter === undefined || filter === true) && view.restriction === null)
      return wholeTable(this.#table);
    this.#recordRows = view.markRows(this.#recordRows);
    return this.#recordRows;
  };

  /**
   * Looks of `columns` and of `presentation`'s rows compiled for `groups`
   * and `totals`, as `settings` say; throws where any is refused, changing
   * nothing.
   */
  #compileLooks(
    columns: readonly GridColumn[],
    settings: FormatSettings,
    presentation: LookPresentation,
    groups: RowGroups | null,
    totals: RowTotals | null,
  ): ModelLooks {
    const table = this.#table;
    const { surface } = settings;
    const scales = new LookScales(presentation.scales, surface, false, this.#looks?.scales);
    const looks: LookSettings = {
      surface,
      scales,
      fields: settings.fields,
      source: settings.source,
      kinds: table,
    };
    const records = new Map<string, Look>();
    const levels: Map<string, Look>[] = [];
    const tables: Table[] = [];
    const pivot = this.#pivot;
    if (pivot) {
      if (presentation.encode !== undefined)
        throw new TypeError(
          `${surface} encode: a pivot's cells take looks by aggregate (aggregates.<name>.encode); drop encode`,
        );
      const cells = pivot.looks(looks);
      return {
        scales,
        records,
        rows: undefined,
        tables,
        levels,
        totals: new Map(),
        pivot: cells,
        any: cells.any,
        seen: undefined,
      };
    }
    const of: LookTable = { table, rows: this.#records, rank: rankOf(this.#records) };
    columns.forEach((column, i) => {
      const at = `${surface} columns[${i}].encode`;
      const look = compileEncodings(column.encode, of, looks, at, false, drawsSymbols(column));
      if (look) records.set(columnId(column), look);
    });
    const rows = compileEncodings(presentation.encode, of, looks, `${surface} encode`);
    // Group rows read their level's table, and the totals row the totals':
    // a table lacking a field an entry reads (a level above the last its
    // grouping fields below, the totals any grouping field) gives its rows
    // no look from it, so each compiles what it has, once every entry is
    // checked against what they have together.
    const by = (groups?.by ?? []) as readonly string[];
    const aggregated: LookTable[] = [];
    for (let depth = by.length - 1; depth >= 0; depth--)
      aggregated[depth] = aggregateTable(
        groups!.tableOf(by[depth]!) as Table,
        groups!.aggregates,
        "group rows take no rank",
      );
    const own =
      totals &&
      aggregateTable(totals.table as Table, totals.aggregates, "the totals row takes no rank");
    const partial = by.length > 0 && own !== null;
    if (partial)
      columns.forEach((column, i) => {
        compileEncodings(
          column.aggregateEncode,
          joined(aggregated.at(-1)!, own),
          looks,
          `${surface} columns[${i}].aggregateEncode`,
        );
      });
    const compile = (at: LookTable, partly: boolean) => {
      const map = new Map<string, Look>();
      columns.forEach((column, i) => {
        const look = compileEncodings(
          column.aggregateEncode,
          at,
          looks,
          `${surface} columns[${i}].aggregateEncode`,
          partly,
        );
        if (look) map.set(columnId(column), look);
      });
      return map;
    };
    aggregated.forEach((at, depth) => {
      tables[depth] = at.table as Table;
      levels[depth] = compile(at, partial || depth < by.length - 1);
    });
    // The totals alone take only what their table has: the rest is for groups yet to come.
    const ofTotals = own ? compile(own, true) : new Map<string, Look>();
    const any =
      records.size > 0 ||
      rows !== undefined ||
      levels.some((map) => map.size > 0) ||
      ofTotals.size > 0;
    return {
      scales,
      records,
      rows,
      tables,
      levels,
      totals: ofTotals,
      pivot: undefined,
      any,
      seen: undefined,
    };
  }

  /** The looks, their domains and ranks brought up to date with what the grid shows. */
  #currentLooks(): ModelLooks {
    const looks = this.#looks!;
    const display = this.current();
    if (looks.seen !== display) {
      looks.seen = display;
      looks.scales.update();
    }
    return looks;
  }

  /** What `columns`' cell kinds read of the records, bound as `settings` say; throws where one is refused. */
  #bindCells(
    columns: readonly GridColumn[],
    contents: ReadonlyMap<string, ColumnContent>,
    settings: FormatSettings,
  ): { bindings: Map<string, CellBinding>; seen: GridDisplay | undefined } {
    const bindings = new Map<string, CellBinding>();
    columns.forEach((column, i) => {
      const id = columnId(column);
      const content = contents.get(id)!;
      if (content.cell?.bind)
        bindings.set(
          id,
          content.cell.bind(
            column.field!,
            content,
            this.#records,
            `${settings.surface} columns[${i}].cell`,
          ),
        );
    });
    return { bindings, seen: undefined };
  }

  /** Cell kinds' bindings, brought up to date with what the grid shows. */
  #currentCells(): ReadonlyMap<string, CellBinding> {
    const cells = this.#cells;
    const display = this.current();
    if (cells.seen !== display) {
      cells.seen = display;
      for (const binding of cells.bindings.values()) binding.update();
    }
    return cells.bindings;
  }

  /**
   * `totals` (given) as the model's, checked with `groups` against the
   * columns: both of the grid's view, each column's aggregate theirs, and
   * an aggregate both name one operation of one field.
   */
  #checkAggregates(
    groups: RowGroups<S> | RowGroups | null,
    given: unknown,
    columns: readonly GridColumn[],
  ): RowTotals | null {
    const { surface } = this.settings;
    const totals = (given ?? null) as RowTotals | null;
    if (totals && (this.#pivot || totals.view !== (this.data as unknown)))
      throw new Error(
        `${surface} totals: ${this.#pivot ? "a pivot's totals row is its own; give pivotRows totals: { row: true }" : "expected rowTotals(data, { ops }) of the grid's view"}`,
      );
    if (groups && groups.view !== this.data)
      throw new Error(
        `${surface} groups: expected groupRows(data, { by, ops }) of the grid's view`,
      );
    const all = [...(totals?.aggregates ?? []), ...(groups?.aggregates ?? [])];
    const names = [...new Set(all.map(({ name }) => name))];
    for (const { name, op, field } of all) {
      const other = all.find((one) => one.name === name)!;
      if (other.op !== op || other.field !== field)
        throw new Error(
          `${surface} totals: ${JSON.stringify(name)} is ${named(other)} in the totals and ${named({ op, field })} in the groups; make them one operation of one field`,
        );
    }
    if (groups || totals)
      columns.forEach(({ aggregate }, i) => {
        if (aggregate !== undefined && !names.includes(aggregate))
          throw new Error(
            `${surface} columns[${i}].aggregate: no aggregate ${JSON.stringify(aggregate)} in the ${totals ? (groups ? "totals or the groups" : "totals") : "groups"}; they have ${names.map((one) => JSON.stringify(one)).join(", ") || "none"}`,
          );
      });
    if (groups) checkKeys(this.#table, groups.by, this.settings, this.#table);
    return totals;
  }

  /** The totals row's reader, while the model has totals or its pivot a totals row. */
  #makeTotalsRow(): GridTotalsRow | null {
    const totals = this.#totals;
    const pivot = this.#pivot;
    this.#totalsSource = null;
    if (!totals && !pivot?.totalsRow) return null;
    this.#totalsSource = {
      key: () => `${pivot?.totalsVersion ?? totals!.revision} ${this.looksRevision}`,
      state: () => "loaded",
      totals: () => this.settings,
      writer: (column) => {
        if (pivot) return column.field === pivot.groups.by[0] ? null : column.content.amount;
        const aggregate = totals!.aggregates.find(({ name }) => name === column.content.aggregate);
        if (!aggregate) return null;
        const { name, op, field } = aggregate;
        return aggregateWriter(column, op, field, totals!.table.kind(name as never), this.settings);
      },
      read: ({ id, content }) => {
        if (pivot) return pivot.total(id)!;
        // Caught up first.
        totals!.revision;
        const table = totals!.table as Table;
        const kind = table.kind(content.aggregate!) as "number" | "time";
        const value = table.numbers(content.aggregate!)[0]!;
        return missingValue(kind, value)
          ? { state: "missing", value: null, kind }
          : { state: "value", value, kind };
      },
      look: ({ id }) => {
        const looks = this.#currentLooks();
        if (looks.pivot) return looks.pivot.totalAt(id);
        const own = looks.totals.get(id);
        return own && lookOf(totals!.table as Table, 0, own);
      },
    };
    return totalsRow(this, this.#totalsSource);
  }

  #isOpen(id: string): boolean {
    return !this.#pivot && this.#expandedByDefault !== this.#toggled.has(id);
  }

  /**
   * Takes the pivot's columns as they are now: generated columns come and
   * go, keeping their layout and the focus, the first scrolling column in
   * view stays where it was, and sort keys of columns gone go too.
   */
  #generate(pivot: GridPivot) {
    const generated = pivot.columns(
      this.columnList as unknown as readonly Column[],
      null,
      this.settings,
    );
    this.#pivotRevision = pivot.revision;
    // Rows sort by the columns there are; the others' keys go.
    const keys = this.#groupSort.filter(({ field }) => pivot.fields.has(field));
    if (keys.length < this.#groupSort.length) this.#groupSort = Object.freeze(keys);
    this.regenerate(generated.columns as unknown as Column<S>[], generated.contents);
  }

  /** Forgets the expansion of groups gone once they outnumber those left, so streams of keys do not pile up. */
  #prune() {
    const groups = this.#groups;
    if (!groups) return;
    const depths = groups.by.length;
    let count = 0;
    for (let depth = 0; depth < depths; depth++) count += groups.countAt(depth);
    if (this.#toggled.size <= 64 + 2 * count) return;
    const current = new Set<string>();
    for (let depth = 0; depth < depths; depth++)
      for (let group = 0; group < groups.countAt(depth); group++)
        current.add(groups.idOf(group, depth));
    for (const id of this.#toggled) if (!current.has(id)) this.#toggled.delete(id);
  }

  /** Expansion changed: rows move, the focus leaves rows hidden, and listeners hear of it. */
  #rearrange() {
    this.current();
    this.#arrangement++;
    this.current();
    this.notify();
  }

  #sortGroups(keys: readonly SortKey[]) {
    const table = this.#pivot?.fields ?? this.#groups?.table;
    for (const { field } of keys)
      if (!table?.has(field)) throw new Error(`The groups have no field "${field}" to sort by`);
    this.#groupSort = Object.freeze(keys.map((key) => Object.freeze({ ...key })));
    this.#structure++;
    this.#arrangement++;
  }

  /** The row at `rowIndex`: its group and position, and the header it follows. */
  #entry(rowIndex: number): Entry {
    const { snapshot, grouped, length } = this.current() as Display;
    if (!(Number.isInteger(rowIndex) && rowIndex >= 0 && rowIndex < length))
      throw new RangeError(`Row ${rowIndex} is not among the grid's ${length} rows`);
    if (!grouped) {
      const position = snapshot.indices ? snapshot.indices[rowIndex]! : rowIndex;
      return { depth: -1, group: -1, position, header: -1, offset: 0 };
    }
    const header = placeOf(grouped, rowIndex);
    const group = grouped.heads[header]!;
    const offset = rowIndex - grouped.starts[header]!;
    const position = offset === 0 ? -1 : grouped.groups.memberAt(group, offset - 1);
    return { depth: grouped.depths[header]!, group, position, header, offset };
  }

  /**
   * The positions of the selected records the view shows, in its order,
   * or null with nothing selected; past `limit` of them, one more and no
   * further.
   */
  #selectedOf(limit: number): Uint32Array | null {
    const selection = this.selectionStore.get(this.channel);
    if (!selection) return null;
    const { indices, length } = (this.current() as Display).snapshot;
    let found = new Uint32Array(Math.min(length, 1024));
    let count = 0;
    const test =
      selection.kind === "rows"
        ? (position: number) => selection.rows.has(position)
        : this.#test(selection.expression);
    for (let i = 0; i < length && count <= limit; i++) {
      const position = indices ? indices[i]! : i;
      if (!test(position)) continue;
      if (count === found.length) {
        const grown = new Uint32Array(Math.min(length, found.length * 2));
        grown.set(found);
        found = grown;
      }
      found[count++] = position;
    }
    return found.subarray(0, count);
  }

  /** Whether the table's row at `position` is selected. */
  #selected(position: number): boolean {
    const selection = this.selectionStore.get(this.channel);
    if (!selection) return false;
    if (selection.kind === "rows") return selection.rows.has(position);
    return this.#test(selection.expression)(position);
  }

  /** What each column shows on a group's header row. */
  #textsOfGroups(): ((group: number, depth: number) => string)[] {
    const groups = this.#groups!;
    const layout = this.columnLayout as readonly PlacedColumn[];
    const cached = this.#groupTexts;
    if (cached?.layout === layout && cached.groups === groups) return cached.texts;
    const texts = headerTexts(groups, layout, this.settings, this.#table);
    this.#groupTexts = { layout, groups, texts };
    return texts;
  }

  /** Selected rows per group, counted once per change of the selection or of the groups' rows. */
  #groupCounts(): SelectedCounts {
    const groups = this.#groups!;
    this.current();
    const selection = this.selectionStore.get(this.channel) as DataSelection | null;
    const revision = this.selectionStore.revision;
    const view = this.data as unknown as RowView;
    const cached = this.#counts;
    if (cached && countsHold(cached, groups, revision, selection, view)) {
      // Groups started by appended rows have none selected yet.
      const counts = extended(cached.counts, groups);
      if (counts.some((at, depth) => at !== cached.counts[depth]))
        this.#counts = { ...cached, counts };
      return this.#counts!;
    }
    const test = selection?.kind === "predicate" ? this.#test(selection.expression) : () => false;
    this.#counts = countSelected(groups, selection, revision, test, view);
    return this.#counts;
  }

  /**
   * Adds the rows from row index `start` to `end`: a group's header adds
   * every row of its group, those of its groups below too.
   */
  #addRows(rows: RowSet<S>, start: number, end: number) {
    const { snapshot, grouped } = this.current() as Display;
    if (!grouped) {
      addRows(rows, snapshot, start, end);
      return;
    }
    const { starts, heads, depths, open, groups, count } = grouped;
    const last = groups.by.length - 1;
    // The depth of a header in the range whose rows were added: those below it add nothing more.
    let covered = -1;
    for (let at = this.#entry(start).header; at < count; at++) {
      const header = starts[at]!;
      if (header >= end) break;
      const [group, depth] = [heads[at]!, depths[at]!];
      if (covered >= 0 && depth > covered) continue;
      covered = -1;
      if (header >= start) {
        rows.addAll(groups.members(group, depth));
        covered = depth;
      } else if (depth === last && open[depth]![group]) {
        const members = groups.members(group, depth);
        rows.addAll(
          members.subarray(start - header - 1, Math.min(members.length, end - header - 1)),
        );
      }
    }
  }

  /** A compiled condition, for the table as it is now. */
  #test(expression: Expression): (row: number) => boolean {
    const version = this.#table.version;
    const cached = this.#condition;
    if (cached?.expression === expression && cached.version === version) return cached.test;
    const { at } = compileExpression(expression, this.#table);
    const test = (row: number) => at(row) === true;
    this.#condition = { expression, version, test };
    return test;
  }

  /**
   * The row set to change: a copy of the channel's (it is frozen there),
   * of its words alone, not its rows; or a new set with a condition's rows
   * as they are now (toggling a row of it keeps the others selected).
   */
  #writable(): RowSet<S> {
    const current = this.selectionStore.get(this.channel);
    if (current?.kind === "rows") return current.rows.copy();
    const rows = new RowSet(this.data.source);
    if (current?.kind === "predicate") {
      const test = this.#test(current.expression);
      const matching: number[] = [];
      for (let row = 0; row < this.#table.length; row++) if (test(row)) matching.push(row);
      rows.addAll(matching);
    }
    return rows;
  }

  /**
   * Puts the rows in the channel. In grouped grids, `adjust` turns the
   * counts of selected rows per group into those of the new selection,
   * when they were current, so a click counts nothing again.
   */
  #publish(rows: RowSet<S>, adjust: ((counts: readonly Float64Array[]) => void) | null) {
    const store = this.selectionStore;
    const groups = this.#groups;
    const before = this.#counts;
    const view = this.data as unknown as RowView;
    const current = store.get(this.channel) as DataSelection | null;
    let after: SelectedCounts | null = null;
    if (groups && adjust && before && countsHold(before, groups, store.revision, current, view)) {
      const counts = extended(before.counts, groups).map((at) => at.slice());
      adjust(counts);
      // Stamped as things are now, and with the revision setting the channel
      // makes: the store's listeners may change the store, the view, or the
      // table, which the stamp then no longer matches.
      after = stamped(groups, store.revision + 1, view, counts);
    }
    this.#counts = null;
    this.writeSelection(store, this.channel, selectRows(rows));
    // Unless a listener showed other groups meanwhile, which these counts must not keep.
    if (after && this.#groups === groups) this.#counts = after;
  }
}

/**
 * A grid model; see `GridModel`. The columns' `aggregate` and
 * `aggregateEncode` it is given are typed by the groups it is given; made
 * without groups (as groups a user picks later), they take any names,
 * which `setGroups` checks, as `setColumns` checks the columns it takes.
 */
export function createGridModel<
  S extends Schema,
  G extends Schema = NoTables,
  B extends readonly string[] = readonly string[],
  T extends Schema = NoTables,
>(options: GridModelOptions<S, G, B, T>): GridModel<S> {
  return new GridModel(options);
}

/** Why copy writes no rows of a pivot (selecting one selects its records). */
const PIVOT_ROWS =
  "A pivot's selected rows stand for its records, which it shows only as aggregates; copy a cell, or export the grid";

/** Adds the rows at view indices `[start, end)`. */
function addRows<S extends Schema>(
  rows: RowSet<S>,
  { indices, length }: RowSnapshot,
  start: number,
  end: number,
) {
  // A view of every row in some order selects them all as one range.
  if (!indices || (start === 0 && end === length && length === rows.source.length))
    rows.addRange(indices ? 0 : start, indices ? length : end);
  else rows.addAll(indices.subarray(start, end));
}

const followers = new FinalizationRegistry<() => void>((stop) => stop());

/** An aggregate as messages write it: `mean("latency")`. */
const named = ({ op, field }: { op: string; field?: string | undefined }) =>
  `${op}(${field === undefined ? "" : JSON.stringify(field)})`;

/** A table of aggregates as looks read it: group rows' and the totals row's, which `rows` takes no rank. */
function aggregateTable(
  table: Table,
  aggregates: readonly NamedAggregate[],
  rows: string,
): LookTable {
  return {
    table,
    rows: () => wholeTable(table),
    rank: `ranks read table rows; ${rows}`,
    aggregates,
  };
}

/**
 * Two tables of aggregates as one, to check channels against what they
 * have together: a field of either, its kind and values its first's.
 */
function joined(a: LookTable, b: LookTable): LookTable {
  const of = (name: string) => (a.table.has(name) ? a.table : b.table);
  return {
    table: {
      fields: () => [...new Set([...a.table.fields(), ...b.table.fields()])],
      has: (name) => a.table.has(name) || b.table.has(name),
      kind: (name) => of(name).kind(name),
      numbers: (name) => of(name).numbers(name),
      categories: (name) => of(name).categories(name),
    },
    rank: a.rank,
    aggregates: [...(a.aggregates ?? []), ...(b.aggregates ?? [])],
  };
}
