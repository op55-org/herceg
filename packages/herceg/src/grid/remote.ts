// A grid model over rows that live elsewhere (a `GridSource`: a database
// behind an API, a worker), imported with its DOM grid as
// `herceg/grid/remote`. It shares the columns, scrolling, and focus of every
// grid model (base.ts); its rows are blocks of a query's answer that it
// asks the source for as they come into view, keeping a few around them.
//
// The answer is a tree of sibling lists: the query's rows, or for a grouped
// query the first level's groups, each group expanded holding the list of
// its groups below or its rows. A list knows its length (or how far it has
// been read, while the source has not said), holds the blocks loaded of it,
// and the lists of its expanded groups by their place in it, with prefix
// sums of the rows those show, so a row index finds its list and place by
// binary search per level. Nothing is kept per row of the answer, and an
// unloaded run of a million groups is one range.
//
// Each query (or refresh) is a revision of the model: requests carry its
// number and, after the first answer, the snapshot that answer started.
// Answers to an earlier revision, to a request since replaced, or for a list
// since collapsed are dropped; requests nothing needs any more are aborted.

import type { Fields } from "../data/expression.ts";
import { type GroupKey, groupId, type NamedAggregate } from "../data/groups.ts";
import type { SortKey } from "../data/order.ts";
import type { PositionField, Schema } from "../data/table.ts";
import { missingValue } from "../fields/display.ts";
import { numberFormatter } from "../format/format.ts";
import {
  BaseGridModel,
  type Column,
  cycled,
  type GridCellRead,
  type GridDisplay,
  type GridFocus,
  type GridPresentation,
  type GridRef,
  type GridTotalsRow,
  type LookPresentation,
  nextOrder,
  type SelectionState,
  type SelectMode,
  totalsRow,
} from "./base.ts";
import { type CellBinding, drawsSymbols } from "./cells.ts";
import {
  aggregateWriter,
  type ColumnContent,
  checkKeys,
  columnId,
  describeColumns,
  type FormatSettings,
  type GridColumn,
  keyFormatter,
  type PlacedColumn,
} from "./columns.ts";
import {
  type CellLook,
  compileEncodings,
  type Look,
  LookScales,
  type LookSettings,
  type LookTable,
  lookFields,
  lookOf,
  plain,
  withEncodingsCopied,
} from "./looks.ts";
import {
  aggregatesOf,
  expressionFields,
  type GridAggregate,
  type GridQuery,
  type GridQueryOf,
  type GridSchema,
  type RowKey,
  schemaFields,
  validateGridQuery,
} from "./query.ts";
import {
  aggregateKind,
  at,
  attach,
  count,
  detach,
  findGroup,
  groupFields,
  groupValue,
  indexOf,
  isPrefix,
  keyOf,
  locate,
  recount,
  refOf,
  start,
} from "./remote-list.ts";
import type {
  GridQueryInput,
  RemoteGridMessage,
  RemoteGridModelOptions,
  RemoteGridRow,
  RemoteGridStatus,
  RemoteTotal,
} from "./remote-model-types.ts";
import { bytesOf, later, ownColumns } from "./remote-requests.ts";
import {
  matchingSelection,
  type RemoteSelectionStore,
  remoteSelectionStore,
  rowSelected,
  selectionMeets,
  selectionSets,
} from "./remote-selection.ts";
import type { Block, List, RemoteSelection, Revision, Scope } from "./remote-types.ts";
import {
  checkTotals,
  checkWindow,
  decodeGroupPath,
  encodeGroupPath,
  type GridSource,
  GridSourceError,
  type LocateRequest,
  type LocateResult,
  type RowsRequest,
  type RowsWindow,
  type TotalsRequest,
  type WindowRows,
  windowFields,
} from "./source.ts";

export type {
  GridQueryInput,
  RemoteGridMessage,
  RemoteGridModelOptions,
  RemoteGridRow,
  RemoteGridStatus,
  RemoteTotal,
} from "./remote-model-types.ts";

/** What a request dropped before it asked the source fails with; its handlers find it no longer wanted. */
const DROPPED = new Error("Dropped before it was asked");

/** A jump farther than this many blocks waits for scrolling to settle. */
const JUMP = 2;
/** Rows the DOM grid mounts past the view on each side. */
const MOUNTED = 10;
const LOADING = "Loading…";
const FAILED = "Couldn't load rows";
/** Why a remote grid's looks take no rank tests. */
const RANKS = "a rank reads every row, which a remote grid does not hold; compare with a value";

/** A column's looks, copied as given: what it is named by, and its encodings. */
interface ColumnLooks {
  readonly key: string;
  readonly encode: unknown;
  readonly aggregateEncode: unknown;
  /** Whether its cells are a symbol cell's, which take `symbol`. */
  readonly symbols: boolean;
}

/** A remote grid's looks, compiled for each block's fields as blocks are read (see grid/looks.ts). */
interface RemoteLooks {
  readonly scales: LookScales;
  readonly settings: LookSettings;
  /**
   * The columns' and the rows' encodings, copied as given (blocks compile
   * them later, so a caller's later changes reach them only through
   * `update`), and whether any has channels.
   */
  readonly columns: readonly ColumnLooks[];
  readonly rows: unknown;
  readonly any: boolean;
  /** The fields channels on table rows read, which blocks of rows are asked for. */
  readonly fields: readonly string[];
  /** Each block's channels, by its fields: each column's (by id) and the rows'. */
  readonly blocks: WeakMap<Fields, { columns: Map<string, Look>; rows: Look | undefined }>;
}
/**
 * The state of one grid over a remote source. Reads are synchronous over
 * what is loaded; rows not loaded are placeholders, and the model asks for
 * them (and a block ahead of the view) as they come into view.
 */
export class RemoteGridModel<S extends Schema = Schema> extends BaseGridModel<S> {
  readonly source: GridSource<S>;
  readonly schema: GridSchema<S>;
  readonly selectionStore: RemoteSelectionStore;
  readonly channel: string;
  readonly blockSize: number;
  readonly #cachedBlocks: number;
  readonly #cacheBytes: number;
  readonly #maxRequests: number;
  readonly #maxExpanded: number;
  readonly #settle: number;
  #revision: Revision;
  #revisions = 0;
  readonly #abortBlock = this.#abort.bind(this);
  /** Ids of groups expanded, kept across queries grouped alike. */
  readonly #expanded = new Set<string>();
  /** Fields each row block holds, and the revision they are of: within one they only grow. */
  #fields: string[] = [];
  #fieldsOf = -1;
  /** Counts changes of what the rows show, compared with the last display. */
  #arrangement = 0;
  #seenArrangement = -1;
  #seenRevision = -1;
  #versions = 0;
  #ticks = 0;
  #loading = 0;
  #error: Error | null = null;
  #message: RemoteGridMessage | null = null;
  #planned = false;
  #disposed = false;
  /** The rows last wanted, for telling a jump from scrolling, and their blocks, which the cache keeps. */
  #wantedFirst = 0;
  #wantedLast = 0;
  #wantedFocus = -2;
  #wantedDown = true;
  #working = new Set<string>();
  /** A jump waiting for scrolling to settle: when it began, its timer, and the first row in view. */
  #deferred: { since: number; timer: ReturnType<typeof setTimeout> | null; first: number } | null =
    null;
  /** A record the focus goes back to once the source locates it in a new query. */
  #restore: {
    key: RowKey;
    column: string;
    revision: Revision;
    controller: AbortController;
  } | null = null;
  #scope: Scope | null = null;
  /** The scope the selection being published is to have, taken when the store says it changed. */
  #pending: (Omit<Scope, "selection"> & { readonly version: number }) | null = null;
  /** Groups' selected and loaded records, counted per selection and state of the blocks. */
  #countedSelection: RemoteSelection | null = null;
  #countedArrangement = -1;
  #counts: Map<string, { selected: number; seen: number }> | null = null;
  #sets = new WeakMap<
    RemoteSelection,
    { keys: Set<RowKey>; include: Set<RowKey>; except: Set<RowKey> }
  >();
  #textLayout: readonly PlacedColumn[] | null = null;
  #textQuery: GridQuery | null = null;
  #textWriters: ((block: Block, row: number, path: GroupKey) => string)[] | null = null;
  #looks: RemoteLooks | null = null;
  /** The totals the totals row shows (null for none), and the source's answer for one revision's snapshot. */
  #totals: readonly GridAggregate[] | null = null;
  #totalsAsked: Asked | null = null;
  /**
   * The last failures of blocks and of the totals: the grid's last
   * (`#error`) is one of them, and a totals failure gone with its totals
   * gives the blocks' back.
   */
  #rowsError: Error | null = null;
  #totalsError: Error | null = null;
  #totalsVersion = 0;
  readonly #totalsRow = totalsRow(this, {
    key: () => `${this.#totalsVersion} ${this.#totalsState()} ${this.looksRevision}`,
    state: () => this.#totalsState(),
    totals: () => this.#totals,
    writer: (column) => {
      const aggregate = this.#totals!.find(({ as }) => as === column.content.aggregate);
      if (!aggregate) return null;
      const { op, field } = aggregate;
      const kind = aggregateKind(aggregate, this.schema.fields as Record<string, string>);
      return aggregateWriter(column, op, field, kind, this.settings);
    },
    read: (columnIndex) => {
      const state = this.#totalsState();
      if (state !== "loaded") return { state, value: undefined, kind: null };
      const name = (this.columnLayout[columnIndex] as PlacedColumn).content.aggregate!;
      const fields = this.#totalsAsked!.fields!;
      const value = windowValue(fields, name, 0) as number | null;
      const kind = fields.kind(name) as "number" | "time";
      return missingValue(kind, value)
        ? { state: "missing", value: null, kind }
        : { state: "value", value, kind };
    },
    look: (columnIndex) => {
      const fields = this.#totalsAsked?.fields;
      const looks = this.#looks;
      if (!fields || this.#totalsState() !== "loaded" || !looks?.any) return undefined;
      let compiled = looks.blocks.get(fields);
      if (!compiled) {
        compiled = this.#blockLooks(looks, false, fields, this.#totals!);
        looks.blocks.set(fields, compiled);
      }
      return lookOf(fields, 0, compiled.columns.get(this.columnLayout[columnIndex]!.id));
    },
  });
  /** What columns' cell kinds read, by column id: bars' ends, which remote grids are given. */
  #cells = new Map<string, CellBinding>();
  /** Fields custom renderers read, by the grid asking (`askFields`), and those columns' texts and links read. */
  readonly #asked = new Map<object, readonly string[]>();
  #reads: readonly string[] = [];
  readonly #stop: () => void;

  constructor(options: RemoteGridModelOptions<S>) {
    // Field displays' rules naming tables match a remote grid's source by its name.
    super(options, "remote grid", options.source.schema.source);
    const { source } = options;
    this.source = source;
    this.schema = source.schema;
    const selection = options.selectionStore ?? remoteSelectionStore(this.schema);
    if (selection.schema.source !== this.schema.source)
      throw new Error(
        "remote grid selectionStore: the store is of another source; give a store of the grid's source",
      );
    this.selectionStore = selection;
    this.channel = options.channel ?? "grid-rows";
    const positive = (value: number | undefined, fallback: number, what: string) => {
      const n = value ?? fallback;
      if (!(Number.isInteger(n) && n > 0))
        throw new RangeError(`A remote grid's ${what} must be a positive integer, not ${n}`);
      return n;
    };
    this.blockSize = positive(options.blockSize, 128, "blockSize");
    this.#cachedBlocks = positive(options.cachedBlocks, 16, "cachedBlocks");
    this.#cacheBytes = positive(options.cacheBytes, 8 * 2 ** 20, "cacheBytes");
    this.#maxRequests = positive(options.maxRequests, 2, "maxRequests");
    this.#maxExpanded = positive(options.maxExpanded, 256, "maxExpanded");
    this.#settle = options.settleDelay ?? 50;
    const settle = this.#settle;
    if (!(Number.isFinite(settle) && settle >= 0))
      throw new RangeError(
        `remote grid settleDelay: expected 0 or more milliseconds; received ${settle}`,
      );
    this.#revision = start(
      ++this.#revisions,
      this.#validate(options.query ?? {}),
      0,
      this.blockSize,
    );
    this.#totals = this.#checkTotals(this.presentation.totals, this.#revision.query);
    this.setColumns(options.columns);
    // Rows wanted are asked for once whatever changed has settled. Bound, not
    // an arrow: an arrow's `this` would be shared with the store's listener
    // below, which must hold the model only weakly.
    this.subscribe(this.#schedule.bind(this));
    const ref = new WeakRef(this);
    const changed = () => {
      const model = ref.deref();
      if (model) model.#selectionChanged();
      else stop();
    };
    const stop = selection.subscribe(changed);
    this.#stop = stop;
    followers.register(this, stop, this);
    this.#schedule();
  }

  // Query

  /** The query the grid shows. */
  get query(): GridQueryOf<S> {
    return this.#revision.query as GridQueryOf<S>;
  }

  /**
   * Shows another query's rows: a new revision, whose requests start a new
   * snapshot. The scroll offset stays (as many rows show until the source
   * says how many there are); the focus goes to its column's header, and
   * back to its record when the source can locate it. Selections stay.
   */
  setQuery(query: GridQueryInput<S>): void {
    this.#replace(this.#validate(query));
  }

  /** Reads the query again from a new snapshot, for data that changed where it lives. */
  refresh(): void {
    this.#replace(this.#revision.query);
  }

  /** Asks again for the blocks that failed; after a snapshot expired, refreshes. */
  retry(): void {
    const revision = this.#revision;
    if (revision.expired !== null || (revision.snapshot === null && !revision.starting)) {
      this.refresh();
      return;
    }
    for (const list of revision.lists.values())
      for (const [index, block] of list.blocks)
        if (block.state === "failed") list.blocks.delete(index);
    this.#error = this.#rowsError = this.#totalsError = null;
    if (this.#totalsAsked?.state === "failed") this.#totalsAsked = null;
    this.#askTotals();
    this.#changed();
  }

  get status(): RemoteGridStatus {
    let failed = 0;
    let blocks = 0;
    let bytes = 0;
    for (const list of this.#revision.lists.values())
      for (const block of list.blocks.values()) {
        if (block.state === "failed") failed++;
        if (block.state === "loaded") {
          blocks++;
          bytes += block.bytes;
        }
      }
    const revision = this.#revision;
    // An expired snapshot is the grid's failure until a refresh, whatever failed after.
    const error = revision.expired ?? this.#error;
    return {
      loading: this.#loading,
      starting: revision.snapshot === null && !error,
      failed,
      error,
      total: revision.root.total,
      blocks,
      bytes,
      totals: this.#totals && this.#totalsState(),
    };
  }

  /** The rows the grid shows when every list's length is known (for assistive technology), else null. */
  get exactRowCount(): number | null {
    for (const list of this.#revision.lists.values()) if (list.total === null) return null;
    return this.rowCount;
  }

  /** What the model last said of a command it refused (a range over rows not loaded, too many groups expanded). */
  get message(): RemoteGridMessage | null {
    return this.#message;
  }

  // Columns

  setColumns(columns: readonly GridColumn<S>[]): void {
    // Encodings copied, so a caller's later changes reach looks only through `setColumns`.
    const given = (columns as unknown as readonly GridColumn[]).map(withEncodingsCopied);
    const contents = describeColumns(schemaFields(this.schema), given, this.settings);
    const looks = this.#compileLooks(
      given,
      this.settings,
      this.presentation,
      this.#revision.query,
      this.#totals,
    );
    this.#cells = bindCells(given, contents, this.settings);
    this.#looks = looks;
    this.#reads = readsOf(contents);
    // Blocks lacking a field a column shows (or its looks read) go before the column does.
    this.#readFields(given);
    this.takeColumns(
      given.map((column) => ({
        ...column,
        id: columnId(column),
      })) as unknown as Column<S>[],
      contents,
    );
  }

  protected restyle(settings: FormatSettings, presentation: LookPresentation): () => void {
    const columns = this.columnList as unknown as readonly GridColumn[];
    const fields = schemaFields(this.schema);
    const contents = describeColumns(fields, columns, settings);
    // Group rows write keys of grouping fields no column shows too.
    checkKeys(fields, this.#revision.query.group?.by ?? [], settings);
    // Totals given again are asked again only where what they ask changed.
    let totals = this.#totals;
    if (presentation.totals !== this.presentation.totals) {
      const checked = this.#checkTotals(presentation.totals, this.#revision.query);
      if (!sameTotals(checked, totals)) totals = checked;
    }
    const looks = this.#compileLooks(columns, settings, presentation, this.#revision.query, totals);
    const cells = bindCells(columns, contents, settings);
    return () => {
      this.#looks = looks;
      this.#cells = cells;
      this.#reads = readsOf(contents);
      this.#readFields();
      if (totals !== this.#totals) {
        this.#totals = totals;
        this.#askTotals();
      }
      this.takeColumns(this.columnList, contents);
    };
  }

  // Rows

  get grouped(): boolean {
    return this.#revision.query.group !== undefined;
  }

  row(rowIndex: number): RemoteGridRow {
    const { list, ordinal } = this.#at(rowIndex);
    const ref = refOf(list, ordinal);
    const block = list.blocks.get(Math.floor(ordinal / this.blockSize));
    const setSize = list.total ?? -1;
    const level = list.depth + 1;
    if (block?.state !== "loaded") {
      // Rows not asked for of an expired snapshot will not load either.
      const failed = block ? block.state === "failed" : list.revision.expired !== null;
      return {
        kind: "placeholder",
        ref,
        version: failed ? -1 : 0,
        state: failed ? "failed" : "loading",
        level,
        setIndex: ordinal,
        setSize,
        indent: list.leaf ? list.depth - 1 : list.depth,
      };
    }
    block.used = ++this.#ticks;
    const row = ordinal - block.index * this.blockSize;
    if (list.leaf)
      return {
        kind: "row",
        ref,
        version: block.version,
        key: keyOf(block, row, this.schema.key),
        level,
        setIndex: ordinal,
        setSize,
      };
    const key = [...list.parent, groupValue(block, list.depth, row, this.#by())];
    const child = list.children.find(({ holder }) => holder!.ordinal === ordinal);
    return {
      kind: "group",
      ref,
      version: block.version,
      key,
      id: groupId(key),
      rows: (block.data as RowsWindow & { kind: "groups" }).rowCounts[row]!,
      expanded: child !== undefined,
      level,
      setIndex: ordinal,
      setSize,
    };
  }

  /** The key of the record at `rowIndex`, or null for groups, placeholders, and sources without keys. */
  keyAt(rowIndex: number): RowKey | null {
    const row = this.row(rowIndex);
    return row.kind === "row" ? row.key : null;
  }

  /** Where the record with this key shows among the rows loaded, or -1. */
  rowIndexOfKey(key: RowKey): number {
    this.current();
    for (const list of this.#revision.lists.values()) {
      if (!list.leaf) continue;
      for (const block of list.blocks.values()) {
        const at = block.keys?.get(key);
        if (at !== undefined) return indexOf(list, block.index * this.blockSize + at);
      }
    }
    return -1;
  }

  textAt(rowIndex: number, columnIndex: number): string {
    const { list, ordinal } = this.#at(rowIndex);
    const layout = this.columnLayout as readonly PlacedColumn[];
    const column = layout[columnIndex];
    if (!column) throw new RangeError(`Column ${columnIndex} is not shown`);
    const block = list.blocks.get(Math.floor(ordinal / this.blockSize));
    if (block?.state !== "loaded") {
      const failed = block ? block.state === "failed" : list.revision.expired !== null;
      return columnIndex > 0 ? "" : failed ? FAILED : LOADING;
    }
    const row = ordinal - block.index * this.blockSize;
    if (list.leaf) {
      // A linked cell's text is its link's.
      const link = column.content.link?.(block.fields!, row);
      return link ? link.text : column.content.text(block.fields!, row);
    }
    return this.#groupTexts(layout)[columnIndex]!(block, row, list.parent);
  }

  lookAt(rowIndex: number, columnIndex: number): CellLook | undefined {
    const { list, ordinal } = this.#at(rowIndex);
    const column = this.columnLayout[columnIndex];
    if (!column) throw new RangeError(`Column ${columnIndex} is not shown`);
    const looks = this.#looks!;
    if (!looks.any) return undefined;
    const block = list.blocks.get(Math.floor(ordinal / this.blockSize));
    if (block?.state !== "loaded") return undefined;
    const row = ordinal - block.index * this.blockSize;
    const fields = block.fields!;
    let compiled = looks.blocks.get(fields);
    if (!compiled) {
      compiled = this.#blockLooks(looks, list.leaf, fields);
      looks.blocks.set(fields, compiled);
    }
    return lookOf(fields, row, compiled.columns.get(column.id), compiled.rows);
  }

  cellAt(rowIndex: number, columnIndex: number): GridCellRead {
    const text = this.textAt(rowIndex, columnIndex);
    const look = this.lookAt(rowIndex, columnIndex);
    const { list, ordinal } = this.#at(rowIndex);
    const column = this.columnLayout[columnIndex] as PlacedColumn;
    const block = list.blocks.get(Math.floor(ordinal / this.blockSize));
    const cell = (value: GridCellRead["value"], kind: GridCellRead["kind"]) => {
      const missing = kind !== null && missingValue(kind, value ?? null);
      return {
        state:
          kind === null ? ("empty" as const) : missing ? ("missing" as const) : ("value" as const),
        value: kind === null ? undefined : missing ? null : value,
        kind,
        text,
        look,
        link: undefined,
      };
    };
    if (block?.state !== "loaded") {
      const failed = block ? block.state === "failed" : list.revision.expired !== null;
      return { ...cell(undefined, null), state: failed ? "failed" : "loading" };
    }
    const row = ordinal - block.index * this.blockSize;
    const fields = block.fields!;
    if (list.leaf) {
      // A column without a field has its text alone, and a sparkline's series.
      if (column.field === null)
        return {
          ...cell(undefined, null),
          ...(column.content.sparkline && {
            sparkline: column.content.sparkline.read(fields, row),
          }),
        };
      const value = windowValue(fields, column.field, row);
      const binding = column.content.cell && this.#cells.get(column.id);
      return {
        ...cell(value, column.kind),
        link: column.content.link?.(fields, row),
        ...(binding && { bar: binding.bar(value as number | null) }),
      };
    }
    // A group's header: its key's values, and its aggregates.
    const by = this.#by();
    const k =
      columnIndex === 0 ? list.depth : column.field === null ? -1 : by.indexOf(column.field);
    if (k >= 0 && k <= list.depth)
      return cell(
        k < list.depth ? list.parent[k]! : groupValue(block, list.depth, row, by),
        this.schema.fields[by[k]! as keyof S] as "number" | "time" | "category",
      );
    const name = column.content.aggregate;
    const kind = name !== undefined && fields.has(name) ? fields.kind(name) : null;
    return kind === null || kind === "geometry"
      ? cell(undefined, null)
      : cell(windowValue(fields, name!, row), kind);
  }

  /**
   * Changes how the grid presents its rows (see `BaseGridModel.update`),
   * and its totals row: aggregates to ask the source for, or null to drop it.
   */
  override update(
    options: GridPresentation<S> & { totals?: readonly RemoteTotal<S>[] | null | undefined },
  ): void {
    super.update(options);
  }

  /** The totals row while the grid has `totals`: their values from the source, of the query's snapshot. */
  get totalsRow(): GridTotalsRow | null {
    return this.#totals ? this.#totalsRow : null;
  }

  get hasLooks(): boolean {
    return this.#looks?.any ?? false;
  }

  /** Remote looks' domains are given, so only what they are compiled from moves it. */
  get looksRevision(): number {
    return this.#looks!.scales.revision;
  }

  /** Remote bars' ends are given, so only the columns move theirs; sparklines' data moves theirs. */
  cellsRevision(columnIndex: number): number {
    const column = this.columnLayout[columnIndex] as PlacedColumn | undefined;
    if (!column) throw new RangeError(`Column ${columnIndex} is not shown`);
    return column.content.sparkline?.revision ?? this.#cells.get(column.id)?.revision ?? 0;
  }

  askFields(asker: object, fields: readonly (readonly [field: string, at: string])[]): void {
    const kinds = this.schema.fields as Readonly<Record<string, string>>;
    for (const [field, at] of fields)
      if (!Object.hasOwn(kinds, field))
        throw new Error(
          `${at}: no field ${JSON.stringify(field)}; the source has ${Object.keys(kinds)
            .map((one) => JSON.stringify(one))
            .join(", ")}`,
        );
    if (fields.length > 0) this.#asked.set(asker, [...new Set(fields.map(([field]) => field))]);
    else if (!this.#asked.delete(asker)) return;
    this.#readFields();
    this.notify();
  }

  rowValues(rowIndex: number): (field: string) => number | string | null {
    const { list, ordinal } = this.#at(rowIndex);
    const block = list.blocks.get(Math.floor(ordinal / this.blockSize));
    if (!list.leaf || block?.state !== "loaded")
      throw new RangeError(`remote grid rowValues: row ${rowIndex} is not a loaded record`);
    // The window the row arrived in, held while the reader is.
    const fields = block.fields!;
    const row = ordinal - block.index * this.blockSize;
    return (field) => {
      if (!fields.has(field))
        throw new Error(
          `remote grid rowValues: the rows hold no field ${JSON.stringify(field)}; columns, looks, and renderers' fields are asked for`,
        );
      const value = windowValue(fields, field, row) ?? null;
      // Missing as cells read it: a time out of range too.
      return missingValue(fields.kind(field) as "number", value) ? null : value;
    };
  }

  // Sorting and groups

  get sort(): readonly SortKey<PositionField<S>>[] {
    return (this.#revision.query.sort ?? []) as readonly SortKey<PositionField<S>>[];
  }

  /** Sorts the rows by these keys (within their group, when grouped), keeping the filter and groups. */
  setSort(keys: readonly SortKey<PositionField<S>>[]): void {
    this.setQuery({ ...this.query, sort: keys });
  }

  /**
   * Sorts as a header click does (see `GridModel.cycleSort`): in grouped
   * grids the groups sort too, by the column's aggregate, or by key on the
   * level of the grouping field it shows. One query either way.
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
    const query = this.query;
    const group = query.group;
    let grouping = group;
    if (group) {
      const names = group.aggregate.map(({ as }) => as);
      const aggregate =
        definition.aggregate !== undefined && names.includes(definition.aggregate)
          ? definition.aggregate
          : undefined;
      const key =
        aggregate ?? ((group.by as readonly string[]).includes(field) ? field : undefined);
      grouping = { ...group, sort: cycled(group.sort ?? [], key, order, additive) };
    }
    this.setQuery({
      ...query,
      sort: cycled(keys, field, order, additive),
      ...(grouping && { group: grouping }),
    });
  }

  isExpanded(key: GroupKey): boolean {
    return this.#expanded.has(groupId(key));
  }

  /**
   * Shows or hides the groups below, or the rows, of the group with this key
   * path, kept for groups not loaded yet and across queries grouped alike.
   * Past `maxExpanded` groups expanded, refuses, saying so (`message`).
   */
  setExpanded(key: GroupKey, expanded: boolean): void {
    const id = groupId(key);
    if (this.#expanded.has(id) === expanded) return;
    const revision = this.#revision;
    if (expanded) {
      // Groups expanded before they load count too: each will ask for its rows.
      if (this.#expanded.size >= this.#maxExpanded) {
        this.#say(`At most ${this.#maxExpanded} groups can be expanded at once`);
        return;
      }
      this.#expanded.add(id);
      const parent = revision.lists.get(groupId(key.slice(0, -1)));
      if (parent && !parent.leaf) {
        const found = findGroup(parent, id, this.blockSize);
        if (found)
          attach(parent, found.ordinal, key, found.children, this.blockSize, this.#abortBlock);
      }
    } else {
      this.#expanded.delete(id);
      const list = revision.lists.get(id);
      if (list) detach(list, this.blockSize, this.#abortBlock);
    }
    this.#changed();
  }

  /** Collapses every group. */
  collapseAll(): void {
    this.#expanded.clear();
    for (const child of [...this.#revision.root.children])
      detach(child, this.blockSize, this.#abortBlock);
    this.#changed();
  }

  // Focus

  override focusCell(rowIndex: number, column: string, options?: { reveal?: boolean }): void {
    // Focus moved by the user stays where they put it.
    this.#forgetRestore();
    super.focusCell(rowIndex, column, options);
  }

  // Selection

  get selectionRevision(): number {
    return this.selectionStore.revision;
  }

  /**
   * Rows selected: the keys selected, or null for a condition, which only
   * the source can count.
   */
  get selectedCount(): number | null {
    const selection = this.selectionStore.get(this.channel);
    if (!selection) return 0;
    return selection.kind === "keys" ? selection.keys.length : null;
  }

  /**
   * Whether the row at `rowIndex` is selected: a loaded record by its key or
   * the selection's condition; a group's header as far as the grid knows
   * (see `#groupState`). Placeholders are not.
   */
  selectionState(rowIndex: number): SelectionState {
    const selection = this.selectionStore.get(this.channel);
    if (!selection) return "none";
    const { list, ordinal } = this.#at(rowIndex);
    const block = list.blocks.get(Math.floor(ordinal / this.blockSize));
    if (block?.state !== "loaded") return "none";
    const row = ordinal - block.index * this.blockSize;
    if (list.leaf)
      return rowSelected(selection, this.#sets, this.schema, block, row) ? "all" : "none";
    const path = [...list.parent, groupValue(block, list.depth, row, this.#by())];
    const rows = (block.data as RowsWindow & { kind: "groups" }).rowCounts[row]!;
    return this.#groupState(selection, path, rows);
  }

  /**
   * Selects as clicks do (see `SelectMode`), by key: a record (or with
   * Shift a range of records, every one between loaded, all within one
   * group), or a group's header, which selects the rows matching the group
   * (those the source adds to it later too). A selection the model cannot
   * make (rows not loaded, a source without keys) is refused, saying why.
   */
  select(rowIndex: number, mode: SelectMode = "only"): void {
    const { list, ordinal } = this.#at(rowIndex);
    const block = list.blocks.get(Math.floor(ordinal / this.blockSize));
    if (block?.state !== "loaded") {
      this.#say("Rows still loading cannot be selected");
      return;
    }
    const store = this.selectionStore;
    const current = store.get(this.channel);
    const row = ordinal - block.index * this.blockSize;
    const ref = refOf(list, ordinal);
    if (!list.leaf) {
      if (mode === "range" || mode === "addRange") {
        this.#say("Ranges select rows of one group; select a group by itself");
        return;
      }
      const path = [...list.parent, groupValue(block, list.depth, row, this.#by())];
      this.rangeAnchor = ref;
      // Toggling the group selected as a whole clears it; any other selects the group alone.
      if (mode === "toggle" && this.selectedAlone(rowIndex)) {
        store.set(this.channel, null);
        return;
      }
      this.#selectMatching(path);
      return;
    }
    const key = keyOf(block, row, this.schema.key);
    if (key === null) {
      this.#say(`Rows of "${this.schema.source}" have no key and cannot be selected one by one`);
      return;
    }
    if (mode === "only" || mode === "toggle") {
      this.rangeAnchor = ref;
      if (mode === "only" || !current) this.#publish({ kind: "keys", keys: [key] });
      else if (current.kind === "keys") {
        const has = selectionSets(this.#sets, current).keys.has(key);
        const keys = has ? current.keys.filter((other) => other !== key) : [...current.keys, key];
        this.#publish({ kind: "keys", keys });
      } else {
        // A row the condition selects is taken out; one it does not, added (or taken out of `include`).
        const selected = rowSelected(current, this.#sets, this.schema, block, row);
        const meets = selectionMeets(current, block, row);
        const include = current.include.filter((other) => other !== key);
        const except = current.except.filter((other) => other !== key);
        if (selected && meets) except.push(key);
        else if (!selected && !meets) include.push(key);
        this.#publish({ ...current, include, except });
      }
      return;
    }
    const from = this.rangeAnchorIndex();
    if (from === null) {
      this.rangeAnchor = ref;
      this.#publish({ kind: "keys", keys: [key] });
      return;
    }
    const anchor = this.#at(from);
    if (anchor.list !== list) {
      this.#say("A range selects rows of one group");
      return;
    }
    const [start, end] =
      anchor.ordinal <= ordinal ? [anchor.ordinal, ordinal] : [ordinal, anchor.ordinal];
    const keys: RowKey[] = [];
    for (let at = start; at <= end; at++) {
      const w = list.blocks.get(Math.floor(at / this.blockSize));
      const k =
        w?.state === "loaded" ? keyOf(w, at - w.index * this.blockSize, this.schema.key) : null;
      if (k === null) {
        this.#say("A range selects only rows loaded; scroll through it first");
        return;
      }
      keys.push(k);
    }
    if (mode === "range" || !current) this.#publish({ kind: "keys", keys });
    else if (current.kind === "keys") {
      const known = selectionSets(this.#sets, current).keys;
      this.#publish({
        kind: "keys",
        keys: [...current.keys, ...keys.filter((k) => !known.has(k))],
      });
    } else {
      const added = new Set(keys);
      this.#publish({
        ...current,
        include: [...current.include.filter((k) => !added.has(k)), ...keys],
        except: current.except.filter((k) => !added.has(k)),
      });
    }
  }

  /** Selects every row matching the query's filter, those the source adds later too. */
  selectAll(): void {
    this.#selectMatching(null);
  }

  /**
   * Whether the loaded row at `rowIndex` is all that is selected: a
   * record's key alone, or a group's header selected as a whole.
   */
  protected selectedAlone(rowIndex: number): boolean {
    const current = this.selectionStore.get(this.channel);
    const { list, ordinal } = this.#at(rowIndex);
    const block = list.blocks.get(Math.floor(ordinal / this.blockSize));
    if (!current || block?.state !== "loaded") return false;
    const row = ordinal - block.index * this.blockSize;
    if (list.leaf) {
      const key = keyOf(block, row, this.schema.key);
      return current.kind === "keys" && current.keys.length === 1 && current.keys[0] === key;
    }
    const path = [...list.parent, groupValue(block, list.depth, row, this.#by())];
    const scope = this.#scopeNow();
    const rows = (block.data as RowsWindow & { kind: "groups" }).rowCounts[row]!;
    return (
      current === scope?.selection &&
      scope.path !== null &&
      groupId(scope.path) === groupId(path) &&
      this.#groupState(current, path, rows) === "all"
    );
  }

  clearSelection(): boolean {
    const had = this.selectionStore.get(this.channel) !== null || this.rangeAnchor !== null;
    this.rangeAnchor = null;
    if (this.selectionStore.get(this.channel) !== null) this.selectionStore.set(this.channel, null);
    return had;
  }

  /**
   * Stops asking the source for rows, aborts requests in flight, releases
   * the snapshot, and drops the rows loaded, which whatever still holds the
   * model (a framework's state) would otherwise keep.
   */
  override dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#forgetRestore();
    this.#totals = null;
    this.#askTotals();
    this.#stop();
    followers.unregister(this);
    this.#end(this.#revision);
    this.#error = this.#rowsError = this.#totalsError = null;
    this.#counts = null;
    if (this.#deferred?.timer) clearTimeout(this.#deferred.timer);
    super.dispose();
  }

  // For the shared model (base.ts)

  protected catchUp(previous: GridDisplay | undefined): GridDisplay {
    const revision = this.#revision;
    if (
      previous &&
      this.#seenArrangement === this.#arrangement &&
      this.#seenRevision === revision.number
    )
      return previous;
    const keep = this.#seenRevision === revision.number;
    this.#seenArrangement = this.#arrangement;
    this.#seenRevision = revision.number;
    return { length: revision.root.span, keep };
  }

  protected refAt(rowIndex: number): GridRef {
    const { list, ordinal } = this.#at(rowIndex);
    return refOf(list, ordinal);
  }

  protected find(ref: GridRef, collapsed: boolean): number {
    const at = locate(this.#revision, ref);
    if (!at) return -1;
    let { list, ordinal } = at;
    if (list.revision !== this.#revision) return -1;
    while (!list.attached) {
      if (!collapsed || !list.holder) return -1;
      ({ list, ordinal } = list.holder);
    }
    return ordinal < count(list, this.blockSize) ? indexOf(list, ordinal) : -1;
  }

  protected override moveInTree(focus: GridFocus, left: boolean): boolean {
    if (!this.grouped) return false;
    const row = this.row(focus.rowIndex);
    if (row.kind === "group" && row.expanded === left) {
      this.setExpanded(row.key, !row.expanded);
      return true;
    }
    const { holder } = this.#at(focus.rowIndex).list;
    if (!left || !holder?.list.attached) return false;
    this.focusCell(indexOf(holder.list, holder.ordinal), focus.column);
    return true;
  }

  #at(rowIndex: number) {
    const length = this.current().length;
    return at(this.#revision.root, rowIndex, length);
  }

  #by(): readonly string[] {
    return groupFields(this.#revision);
  }

  // Requests

  #validate(input: GridQueryInput<S>): GridQuery {
    const query = validateGridQuery(
      { ...input, version: input.version ?? 1, source: input.source ?? this.schema.source },
      this.schema,
    );
    checkKeys(schemaFields(this.schema), query.group?.by ?? [], this.settings);
    // Columns' looks of group rows read the query's aggregates.
    if (this.#looks) this.#groupLooks(this.#looks, query);
    if (this.#totals) this.#checkTotals(this.#totals, query);
    return query;
  }

  /**
   * `given` as the totals of `query`'s rows, checked: aggregates the
   * source answers, of its fields, none named as one of the query's groups'
   * meaning another operation or field.
   */
  #checkTotals(given: unknown, query: GridQuery): readonly GridAggregate[] | null {
    if (given === null || given === undefined) return null;
    const at = `${this.settings.surface} totals`;
    if (!this.source.totals)
      throw new Error(
        `${at}: the source answers no totals; give the source totals(request, signal), or drop totals`,
      );
    if (!Array.isArray(given) || given.length === 0)
      throw new TypeError(
        `${at}: expected aggregates such as [{ op: "count", as: "n" }], or null for no totals row; received ${JSON.stringify(given)}`,
      );
    let totals: GridAggregate[];
    try {
      totals = aggregatesOf(given, this.schema);
    } catch (error) {
      throw new TypeError(`${at}: ${(error as Error).message}`);
    }
    for (const { as, op, field } of totals) {
      const other = query.group?.aggregate.find((one) => one.as === as);
      if (other && (other.op !== op || other.field !== field))
        throw new Error(
          `${at}: "${as}" is ${op}(${field ?? ""}) in the totals and ${other.op}(${other.field ?? ""}) in the query's groups; make them one operation of one field`,
        );
    }
    return Object.freeze(totals);
  }

  /** Where the totals of the query's snapshot are: asked for, answered, or failed. */
  #totalsState(): "loading" | "loaded" | "failed" {
    const asked = this.#totalsAsked;
    return asked?.revision === this.#revision && asked.totals === this.#totals
      ? asked.state
      : this.#revision.expired !== null ||
          (this.#error !== null && this.#revision.snapshot === null)
        ? "failed"
        : "loading";
  }

  /**
   * Asks the source for the totals of the query's snapshot once it is
   * named (by the first window) and they are not asked for already; a
   * request for another revision or other totals is aborted, its answer
   * dropped.
   */
  #askTotals() {
    const revision = this.#revision;
    const totals = this.#totals;
    const asked = this.#totalsAsked;
    if (asked && (asked.revision !== revision || asked.totals !== totals)) {
      this.#totalsAsked = null;
      this.#totalsVersion++;
      // A failure of totals no longer asked for is no longer the grid's.
      if (this.#error === this.#totalsError) this.#error = this.#rowsError;
      this.#totalsError = null;
      const { controller } = asked;
      if (asked.state === "loading") later(() => controller.abort());
    }
    const snapshot = revision.snapshot;
    // An expired snapshot has no totals to give; the rows' failure says so until a refresh.
    if (
      !totals ||
      snapshot === null ||
      revision.expired !== null ||
      this.#totalsAsked ||
      this.#disposed
    )
      return;
    const request: TotalsRequest = {
      query: revision.query,
      revision: revision.number,
      schemaVersion: this.schema.version,
      snapshot,
      aggregate: totals,
    };
    const read: Asked = {
      revision,
      totals,
      state: "loading",
      fields: null,
      controller: new AbortController(),
    };
    this.#totalsAsked = read;
    this.#totalsVersion++;
    const fields = this.schema.fields as Record<string, string>;
    Promise.resolve()
      .then(() => {
        // Asked a microtask later: not for totals replaced, a revision
        // ended, or a grid disposed meanwhile (each drops the read), nor of
        // a snapshot expired meanwhile.
        if (this.#totalsAsked !== read) throw DROPPED;
        if (revision.expired) throw revision.expired;
        return this.source.totals!(request, read.controller.signal);
      })
      .then((answer) => {
        if (this.#totalsAsked !== read) return;
        checkTotals(answer, request);
        const kinds: Record<string, string> = Object.create(null);
        // Each total copied: an answer's arrays may view far larger buffers.
        const owned: Record<string, Float64Array> = Object.create(null);
        for (const aggregate of totals) {
          kinds[aggregate.as] = aggregateKind(aggregate, fields);
          owned[aggregate.as] = Float64Array.of(answer.columns[aggregate.as]![0]!);
        }
        read.fields = windowFields(kinds, owned);
        read.state = "loaded";
        this.#changed();
      })
      .catch((error) => {
        if (this.#totalsAsked !== read) return;
        read.state = "failed";
        const failure = sourceError(error);
        // An expired snapshot is the rows' failure too, kept until a refresh.
        if (failure.code === "snapshot-expired") revision.expired ??= failure;
        else this.#error = this.#totalsError = failure;
        this.#changed();
      });
  }

  /**
   * Looks of `columns` and of `presentation`'s rows as `settings` say,
   * checked against the source's fields and `query`'s groups; throws where
   * any is refused, changing nothing.
   */
  #compileLooks(
    columns: readonly GridColumn[],
    settings: FormatSettings,
    presentation: LookPresentation,
    query: GridQuery,
    totals: readonly GridAggregate[] | null,
  ): RemoteLooks {
    const { surface } = settings;
    const kinds = schemaFields(this.schema);
    const scales = new LookScales(presentation.scales, surface, true, this.#looks?.scales);
    const looks: LookSettings = {
      surface,
      scales,
      fields: settings.fields,
      source: settings.source,
      kinds,
    };
    const records: LookTable = { table: kinds, rank: RANKS };
    const fields = new Set<string>();
    let any = false;
    const copied = columns.map(
      (column): ColumnLooks => ({
        key: columnId(column),
        encode: plain(column.encode),
        aggregateEncode: plain(column.aggregateEncode),
        symbols: drawsSymbols(column),
      }),
    );
    copied.forEach((column, i) => {
      const at = `${surface} columns[${i}].encode`;
      if (compileEncodings(column.encode, records, looks, at, false, column.symbols)) any = true;
      if (column.aggregateEncode !== undefined) any = true;
      for (const field of lookFields(column.encode)) fields.add(field);
    });
    const rows = plain(presentation.encode);
    if (compileEncodings(rows, records, looks, `${surface} encode`)) any = true;
    for (const field of lookFields(rows)) fields.add(field);
    const compiled: RemoteLooks = {
      scales,
      settings: looks,
      columns: copied,
      rows,
      any,
      fields: [...fields],
      blocks: new WeakMap(),
    };
    this.#groupLooks(compiled, query);
    // The totals row's looks read the totals, whose kinds are known before any answer.
    if (totals) this.#aggregateLooks(compiled, this.#aggregateTable([], totals));
    // Remote domains are given, so the scales are read once: gradients' ramps.
    scales.update();
    return compiled;
  }

  /**
   * Checks the columns' looks of group rows against `query`'s groups,
   * which they read by the names of its grouping fields and aggregates
   * (names a level lacks give its rows no look).
   */
  #groupLooks(looks: RemoteLooks, query: GridQuery) {
    const group = query.group;
    if (group) this.#aggregateLooks(looks, this.#aggregateTable(group.by, group.aggregate));
  }

  /** Compiles the columns' looks of group rows or the totals row against what those rows read, throwing where refused. */
  #aggregateLooks(looks: RemoteLooks, of: LookTable) {
    looks.columns.forEach((column, i) => {
      compileEncodings(
        column.aggregateEncode,
        of,
        looks.settings,
        `${looks.settings.surface} columns[${i}].aggregateEncode`,
        true,
      );
    });
  }

  /**
   * What rows of aggregates read, as looks compile against them: group
   * rows their grouping fields (`by`) and aggregates, the totals row its
   * totals; a window's fields, or the source's kinds before one came.
   */
  #aggregateTable(
    by: readonly string[],
    aggregates: readonly GridAggregate[],
    table?: Fields,
  ): LookTable {
    const fields = this.schema.fields as Record<string, string>;
    const kinds: Record<string, string> = Object.create(null);
    for (const field of by) kinds[field] = fields[field]!;
    for (const aggregate of aggregates) kinds[aggregate.as] = aggregateKind(aggregate, fields);
    return {
      table: table ?? schemaFields({ ...this.schema, fields: kinds } as unknown as GridSchema),
      rank: RANKS,
      aggregates: named(aggregates),
    };
  }

  /** The looks of a block's rows (`leaf`) or groups, or of the totals, compiled against its fields. */
  #blockLooks(
    looks: RemoteLooks,
    leaf: boolean,
    fields: Fields,
    totals?: readonly GridAggregate[],
  ): { columns: Map<string, Look>; rows: Look | undefined } {
    const columns = new Map<string, Look>();
    const { settings } = looks;
    const at = (i: number, option: string) => `${settings.surface} columns[${i}].${option}`;
    if (leaf) {
      const records: LookTable = { table: fields, rank: RANKS };
      looks.columns.forEach((column, i) => {
        const look = compileEncodings(
          column.encode,
          records,
          settings,
          at(i, "encode"),
          false,
          column.symbols,
        );
        if (look) columns.set(column.key, look);
      });
      const rows = compileEncodings(looks.rows, records, settings, `${settings.surface} encode`);
      return { columns, rows };
    }
    const group = this.#revision.query.group!;
    const of = totals
      ? this.#aggregateTable([], totals, fields)
      : this.#aggregateTable(group.by, group.aggregate, fields);
    looks.columns.forEach((column, i) => {
      const look = compileEncodings(
        column.aggregateEncode,
        of,
        settings,
        at(i, "aggregateEncode"),
        true,
      );
      if (look) columns.set(column.key, look);
    });
    return { columns, rows: undefined };
  }

  /** Shows a new revision of `query`, keeping the scroll offset and the focus's record. */
  #replace(query: GridQuery) {
    const old = this.#revision;
    const focus = this.focus;
    let restore: { key: RowKey; column: string } | null = null;
    // A focus on the totals row stays there.
    const totals = focus !== null && focus.rowIndex === this.rowCount;
    if (focus && focus.rowIndex >= 0 && !totals) {
      const key = this.keyAt(focus.rowIndex);
      if (key !== null) restore = { key, column: focus.column };
    } else if (focus && this.#restore?.column === focus.column)
      // Queries one after another before the record was located: it is still to go back to.
      restore = { key: this.#restore.key, column: focus.column };
    this.#forgetRestore();
    // A new query is asked for at once, not after a jump that was settling.
    if (this.#deferred?.timer) clearTimeout(this.#deferred.timer);
    this.#deferred = null;
    this.#wantedFirst = -1;
    const regrouped = JSON.stringify(old.query.group?.by) !== JSON.stringify(query.group?.by);
    if (regrouped) this.#expanded.clear();
    // As many rows as the last query showed, until the source says; none of another grouping's.
    const shown = regrouped ? 0 : (old.root.total ?? count(old.root, this.blockSize));
    const revision = start(++this.#revisions, query, shown, this.blockSize);
    this.#revision = revision;
    this.#restore =
      restore && this.source.locate
        ? { ...restore, revision, controller: new AbortController() }
        : null;
    this.rangeAnchor = null;
    this.#error = this.#rowsError = this.#totalsError = null;
    this.#textLayout = null;
    this.#textQuery = null;
    this.#textWriters = null;
    this.#readFields();
    this.#arrangement++;
    // The old query's requests are aborted and its snapshot released once the
    // new one is in place: the source's hooks may start another, which then
    // tells listeners itself.
    this.#end(old);
    if (this.#revision !== revision) return;
    this.#askTotals();
    // Listeners hear of it once, all of it in place: the focus waits on the
    // header, its row not known in the new query.
    if (focus && focus.rowIndex >= 0 && !totals)
      super.focusCell(-1, focus.column, { reveal: false });
    else this.notify();
  }

  /**
   * Aborts a revision's requests, releases its snapshot, and lets go of
   * what it read and how it failed, which requests the source has not
   * settled still reach.
   */
  #end(revision: Revision) {
    for (const list of revision.lists.values()) {
      for (const block of list.blocks.values()) this.#abort(block);
      list.blocks.clear();
    }
    revision.expired = null;
    const { snapshot } = revision;
    if (snapshot !== null) later(() => this.source.release?.(snapshot));
  }

  #abort(block: Block) {
    if (block.state !== "loading") return;
    // Everything kept in order first: the source's abort listeners run
    // synchronously, and may do anything (a new query, another abort).
    const controller = block.controller;
    block.state = "aborted";
    block.controller = null;
    if (block.list.blocks.get(block.index) === block) block.list.blocks.delete(block.index);
    this.#loading--;
    // The request that was to start the snapshot: the next one starts it.
    const revision = block.list.revision;
    if (revision.snapshot === null) revision.starting = false;
    if (controller) later(() => controller.abort());
  }

  /**
   * The fields row blocks hold: the columns', those their looks and the
   * rows' read, the key, the grouping fields, and the filter's.
   */
  #readFields(
    columns: readonly GridColumn[] = this.columnList as unknown as readonly GridColumn[],
  ) {
    const { query } = this.#revision;
    const fields = new Set<string>();
    for (const { field } of columns) if (field !== undefined) fields.add(field);
    for (const field of this.#reads) fields.add(field);
    for (const field of this.#looks?.fields ?? []) fields.add(field);
    for (const asked of this.#asked.values()) for (const field of asked) fields.add(field);
    if (this.schema.key !== null) fields.add(this.schema.key);
    for (const field of query.group?.by ?? []) fields.add(field);
    for (const field of expressionFields(query.filter)) fields.add(field);
    const selection = this.selectionStore.get(this.channel);
    if (selection?.kind === "matching")
      for (const field of expressionFields(selection.where))
        if (Object.hasOwn(this.schema.fields, field)) fields.add(field);
    // Blocks of the query keep the fields they have: a selection or column
    // coming and going does not read them again.
    if (this.#fieldsOf === this.#revision.number)
      for (const field of this.#fields) fields.add(field);
    this.#fieldsOf = this.#revision.number;
    const next = [...fields].sort();
    if (next.join("\u0000") === this.#fields.join("\u0000")) return;
    const fresh = next.some((field) => !this.#fields.includes(field));
    this.#fields = next;
    if (!fresh) return;
    // Blocks read before lack the new fields.
    for (const list of this.#revision.lists.values()) {
      if (!list.leaf) continue;
      for (const block of list.blocks.values()) {
        this.#abort(block);
        list.blocks.delete(block.index);
      }
    }
    // The caller tells listeners, once what it changed is all in place.
    this.#arrangement++;
  }

  #schedule() {
    if (this.#planned || this.#disposed) return;
    this.#planned = true;
    queueMicrotask(() => {
      this.#planned = false;
      this.#plan();
    });
  }

  /**
   * Asks for the blocks the view needs: those in view, the focused row's,
   * then a block ahead, in the direction of scrolling.
   * Requests for blocks more than two blocks from the view are aborted.
   * After a jump (a scrollbar dragged far), requests wait for the scrolling
   * to settle for `settleDelay` ms, but never longer than three times that while it
   * goes on; moves of the focus (the keyboard) do not wait.
   */
  #plan() {
    if (this.#disposed) return;
    const revision = this.#revision;
    const length = this.current().length;
    const size = this.blockSize;
    const height = this.rowHeight;
    const top = this.top;
    const first = Math.min(Math.floor(top / height), Math.max(0, length - 1));
    const last = Math.min(
      length,
      Math.max(first + 1, Math.ceil((top + this.viewportHeight) / height)),
    );
    const focus = this.focus?.rowIndex ?? -1;
    /** Adds the blocks of rows `[from, to)`, in order. */
    const add = (into: Map<string, { list: List; index: number }>, from: number, to: number) => {
      for (let x = Math.max(0, from); x < Math.min(to, length); x++) {
        const { list, ordinal } = this.#at(x);
        const index = Math.floor(ordinal / size);
        const key = `${list.id}\u0000${index}`;
        if (!into.has(key)) into.set(key, { list, index });
      }
    };
    const wanted = new Map<string, { list: List; index: number }>();
    add(wanted, first, last);
    if (focus >= 0) add(wanted, focus, focus + 1);
    // A block ahead, in the direction of scrolling (rows behind were just
    // shown), which holds until the rows in view move; after a jump, below.
    const previousFirst = this.#wantedFirst;
    const previousFocus = this.#wantedFocus;
    // A new query has no rows wanted before to have jumped from.
    const far =
      previousFirst >= 0 &&
      (first >= this.#wantedLast + JUMP * size || last <= previousFirst - JUMP * size);
    let down = this.#wantedDown;
    if (far) down = true;
    else if (first !== previousFirst) down = first > previousFirst;
    if (down) add(wanted, last, last + size);
    else add(wanted, first - size, first);
    // Requests a little past those wanted go on, so scrolling back and forth reuses them.
    const kept = new Map(wanted);
    add(kept, first - 2 * size, last + 2 * size);
    for (const list of revision.lists.values())
      for (const block of list.blocks.values())
        if (block.state === "loading" && !kept.has(`${list.id}\u0000${block.index}`))
          this.#abort(block);
    this.#wantedFirst = first;
    this.#wantedLast = last;
    this.#wantedFocus = focus;
    this.#wantedDown = down;
    // The cache keeps those, and the blocks of rows the DOM grid mounts
    // around the view (ten more on each side).
    const working = new Map(wanted);
    add(working, first - MOUNTED, last + MOUNTED);
    this.#working = new Set(working.keys());
    // A view grown smaller wants fewer blocks: the cache keeps no more than its
    // limits. Blocks dropped are none the grid has mounted (see `#working`),
    // but groups count the records loaded: listeners hear of it, last.
    const evicted = this.#evict();
    try {
      if (this.#defer(far, first, focus !== previousFocus)) return;
      if (revision.expired !== null || revision.starting) return;
      for (const { list, index } of wanted.values()) {
        if (this.#loading >= this.#maxRequests) break;
        if (list.blocks.has(index)) continue;
        // Past a known end there is nothing to ask for.
        if (list.total !== null && index * size >= list.total) continue;
        this.#request(list, index);
        // The first answer starts the snapshot the others are read from.
        if (revision.snapshot === null) break;
      }
    } finally {
      if (evicted) this.#changed();
    }
  }

  /**
   * Whether requests wait for scrolling to settle: from a jump (`far`) until
   * the rows in view have stayed `settle` ms (other changes meanwhile, an
   * answer or a resize, do not restart the wait), but no longer than three
   * times that from the jump, and never past a move of the focus.
   */
  #defer(far: boolean, first: number, focused: boolean): boolean {
    const settle = this.#settle;
    const deferred = this.#deferred;
    const now = Date.now();
    // Each wait ends by the deadline, three times `settle` from the jump.
    const wait = () => {
      const pending = this.#deferred!;
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = setTimeout(
        () => {
          if (this.#deferred) this.#deferred.timer = null;
          this.#plan();
        },
        Math.max(0, Math.min(settle, pending.since + 3 * settle - Date.now())),
      );
    };
    if (deferred && !focused && now - deferred.since < 3 * settle) {
      // Still scrolling: wait again. The wait over, or another change: go on waiting or ask.
      if (first !== deferred.first) {
        deferred.first = first;
        wait();
        return true;
      }
      if (deferred.timer) return true;
    }
    if (deferred) {
      if (deferred.timer) clearTimeout(deferred.timer);
      this.#deferred = null;
      return false;
    }
    if (!far || focused || settle === 0) return false;
    this.#deferred = { since: now, timer: null, first };
    wait();
    return true;
  }

  #request(list: List, index: number) {
    const revision = list.revision;
    // A plan a hook interrupted may go on over a query since replaced.
    if (revision !== this.#revision || !list.attached || this.#disposed) return;
    const controller = new AbortController();
    const block: Block = {
      list,
      index,
      state: "loading",
      controller,
      data: null,
      fields: null,
      keys: null,
      version: 0,
      used: ++this.#ticks,
      bytes: 0,
      test: null,
    };
    list.blocks.set(index, block);
    this.#loading++;
    if (revision.snapshot === null) revision.starting = true;
    const request: RowsRequest = {
      query: revision.query,
      revision: revision.number,
      schemaVersion: this.schema.version,
      snapshot: revision.snapshot,
      parent: encodeGroupPath(list.parent),
      offset: index * this.blockSize,
      limit: this.blockSize,
      fields: list.leaf ? this.#fields : [],
    };
    Promise.resolve()
      .then(() => {
        // Asked a microtask later: not for a block no longer wanted (its
        // handlers drop it), nor of a snapshot expired meanwhile.
        if (!this.#current(block)) throw DROPPED;
        if (revision.expired) throw revision.expired;
        return this.source.rows(request, controller.signal);
      })
      .then(
        (data) => this.#arrived(block, request, data),
        (error) => this.#failed(block, error),
      );
  }

  /** Whether an answer is still wanted: its block is the one asked for, of a list still shown. */
  #current(block: Block): boolean {
    const { list } = block;
    return (
      !this.#disposed &&
      list.revision === this.#revision &&
      list.attached &&
      list.blocks.get(block.index) === block &&
      block.state === "loading"
    );
  }

  #arrived(block: Block, request: RowsRequest, data: RowsWindow) {
    // A first answer started a snapshot of its own, which the grid releases
    // once it reads none of it: dropped, or refused below.
    const unread = () => {
      const snapshot = (data as { snapshot?: unknown } | null)?.snapshot;
      if (request.snapshot === null && typeof snapshot === "string")
        later(() => this.source.release?.(snapshot));
    };
    if (!this.#current(block)) {
      unread();
      return;
    }
    const { list } = block;
    const revision = list.revision;
    let held: {
      data: RowsWindow;
      keys: Map<RowKey, number> | null;
      fields: WindowRows;
      bytes: number;
    };
    // Everything that can throw on a bad answer happens before the block changes.
    try {
      const kinds = this.#kinds(list);
      const keys = checkWindow(data, request, list.leaf ? "rows" : "groups", kinds, {
        key: list.leaf ? this.schema.key : null,
        ...(!list.leaf && { group: this.#by()[list.depth]! }),
      });
      if (data.total !== null && list.total !== null && data.total !== list.total)
        throw new GridSourceError("invalid-response", "The answer changed its list's total");
      // Only the fields asked for are kept, in arrays of the block's own.
      const own = ownColumns(data, kinds);
      held = { data: own, keys, fields: windowFields(kinds, own.columns), bytes: bytesOf(own) };
    } catch (error) {
      unread();
      this.#failed(block, error);
      return;
    }
    this.#loading--;
    block.controller = null;
    if (revision.snapshot === null) {
      revision.snapshot = data.snapshot;
      revision.starting = false;
      this.#locate();
      this.#askTotals();
    }
    if (data.total !== null) list.total = data.total;
    list.frontier = Math.max(list.frontier, data.offset + data.length);
    if (data.length === 0) {
      // Past the end: the list is shorter than shown.
      list.blocks.delete(block.index);
      recount(list, this.blockSize, this.#abortBlock);
      this.#changed();
      return;
    }
    block.data = held.data;
    block.keys = held.keys;
    block.fields = held.fields;
    block.bytes = held.bytes;
    block.version = ++this.#versions;
    block.state = "loaded";
    if (!list.leaf && held.data.kind === "groups") {
      // Groups expanded before they were loaded show their rows now.
      const by = this.#by();
      const counts = held.data.childCounts;
      for (let row = 0; row < held.data.length; row++) {
        const key = [...list.parent, groupValue(block, list.depth, row, by)];
        if (this.#expanded.has(groupId(key)))
          attach(list, data.offset + row, key, counts[row]!, this.blockSize, this.#abortBlock);
      }
    }
    recount(list, this.blockSize, this.#abortBlock);
    this.#evict();
    this.#changed();
  }

  #failed(block: Block, error: unknown) {
    if (!this.#current(block)) return;
    const { list } = block;
    const revision = list.revision;
    this.#loading--;
    block.controller = null;
    block.state = "failed";
    const failure = sourceError(error);
    if (failure.code === "snapshot-expired") revision.expired ??= failure;
    else this.#error = this.#rowsError = failure;
    if (revision.snapshot === null) revision.starting = false;
    // Failed blocks count against the cache too.
    this.#evict();
    this.#changed();
  }

  /** Asks the source where the focused record went in the new query. */
  #locate() {
    const restore = this.#restore;
    const revision = this.#revision;
    const locate = this.source.locate;
    if (!restore || restore.revision !== revision || !locate || revision.snapshot === null) return;
    const snapshot = revision.snapshot;
    const request: LocateRequest = {
      query: revision.query,
      revision: revision.number,
      schemaVersion: this.schema.version,
      snapshot,
      key: restore.key,
    };
    Promise.resolve()
      .then(() => {
        // Asked a microtask later: not once the focus no longer waits on it,
        // nor of a snapshot expired meanwhile.
        if (this.#restore !== restore || this.#disposed || revision.expired) throw DROPPED;
        return locate.call(this.source, request, restore.controller.signal);
      })
      .then(
        (result) => {
          if (this.#restore !== restore || this.#disposed) return;
          this.#restore = null;
          if (result?.revision !== revision.number || result.snapshot !== snapshot) return;
          // A result that does not hold together is not followed.
          try {
            if (result.address) this.#focusAt(result, restore.column, restore.key);
          } catch {}
        },
        () => {
          if (this.#restore === restore) this.#restore = null;
        },
      );
  }

  /** Stops waiting to put the focus back on a record. */
  #forgetRestore() {
    const controller = this.#restore?.controller;
    if (controller) later(() => controller.abort());
    this.#restore = null;
  }

  /** Focuses a located record (`record` its key), or the first collapsed group on its way. */
  #focusAt({ address, ancestors }: LocateResult, column: string, record: RowKey) {
    const revision = this.#revision;
    let path: GroupKey;
    try {
      path = decodeGroupPath(address!.parent);
    } catch {
      return;
    }
    // A place the query does not have is not followed.
    const whole = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
    if (!Array.isArray(ancestors) || path.length !== this.#by().length) return;
    if (!whole(address!.offset)) return;
    if (path.some((_, depth) => !whole(ancestors[depth]?.offset))) return;
    // Checked through the lists shown before anything changes: a place past
    // a known end, or a group there other than the record's, is not followed.
    const fits = (at: List | null, ordinal: number) => at?.total == null || ordinal < at.total;
    let shown: List | null = revision.root;
    let stop = path.length;
    for (let depth = 0; depth < path.length; depth++) {
      const offset = ancestors[depth]!.offset;
      if (!fits(shown, offset)) return;
      const key = path.slice(0, depth + 1);
      // A group loaded at that place must be the record's.
      const block = shown?.blocks.get(Math.floor(offset / this.blockSize));
      if (block?.state === "loaded") {
        const row = offset - block.index * this.blockSize;
        if (groupId([...shown!.parent, groupValue(block, depth, row, this.#by())]) !== groupId(key))
          return;
      }
      if (!this.#expanded.has(groupId(key))) {
        stop = depth;
        break;
      }
      const child: List | undefined = shown?.children.find(
        ({ holder }) => holder!.ordinal === offset,
      );
      if (child && child.id !== groupId(key)) return;
      // Nor where the group is shown elsewhere already.
      const elsewhere = revision.lists.get(groupId(key));
      if (elsewhere && elsewhere !== child) return;
      shown = child ?? null;
    }
    if (stop === path.length) {
      if (!fits(shown, address!.offset)) return;
      // A record loaded at that place must be the one located.
      const block = shown?.blocks.get(Math.floor(address!.offset / this.blockSize));
      if (
        block?.state === "loaded" &&
        keyOf(block, address!.offset - block.index * this.blockSize, this.schema.key) !== record
      )
        return;
    }
    // Lists whose lengths the source has not said yet show at least as far as the record.
    const reach = (at: List, ordinal: number) => {
      at.provisional = Math.max(at.provisional, ordinal + 1);
      recount(at, this.blockSize, this.#abortBlock);
    };
    let list = revision.root;
    let target: { list: List; ordinal: number } | null = null;
    for (let depth = 0; depth < path.length; depth++) {
      const offset = ancestors[depth]!.offset;
      reach(list, offset);
      if (depth === stop) {
        target = { list, ordinal: offset };
        break;
      }
      list = attach(list, offset, path.slice(0, depth + 1), null, this.blockSize, this.#abortBlock);
    }
    target ??= { list, ordinal: address!.offset };
    reach(target.list, target.ordinal);
    // Listeners hear of it once, with the focus in place.
    this.#arrangement++;
    const index = indexOf(target.list, target.ordinal);
    if (index < this.rowCount && this.columnIndex(column) >= 0)
      super.focusCell(index, column, { reveal: false });
    else this.notify();
  }

  /**
   * Drops blocks past the cache's limits, farthest from the view first:
   * those the view wants (in view, the focused row's, and those around)
   * stay, so a cache smaller than them never asks for a block again and
   * again.
   */
  /** Whether it dropped any. */
  #evict(): boolean {
    const first = this.#wantedFirst;
    const last = this.#wantedLast;
    const working = this.#working;
    const size = this.blockSize;
    // The cache's limits are of the blocks besides those the view wants.
    // Dropping any changes the records loaded, which groups' counts are of.
    const kept: { block: Block; distance: number }[] = [];
    let bytes = 0;
    for (const list of this.#revision.lists.values())
      for (const block of list.blocks.values()) {
        if (block.state === "loading" || working.has(`${list.id}\u0000${block.index}`)) continue;
        const start = indexOf(list, block.index * size);
        const distance = start >= last ? start - last : Math.max(0, first - start - size);
        kept.push({ block, distance });
        bytes += block.bytes;
      }
    if (kept.length <= this.#cachedBlocks && bytes <= this.#cacheBytes) return false;
    kept.sort((a, b) => b.distance - a.distance || a.block.used - b.block.used);
    this.#countedSelection = null;
    this.#counts = null;
    let held = kept.length;
    for (const { block } of kept) {
      if (held <= this.#cachedBlocks && bytes <= this.#cacheBytes) break;
      block.list.blocks.delete(block.index);
      held--;
      bytes -= block.bytes;
    }
    return true;
  }

  #changed() {
    this.#arrangement++;
    this.notify();
  }

  #say(text: string) {
    this.#message = { text, count: (this.#message?.count ?? 0) + 1 };
    this.notify();
  }

  // Reading blocks

  /** Fields a list's blocks hold, and their kinds. */
  #kinds(list: List): Record<string, string> {
    const fields = this.schema.fields as Record<string, string>;
    // Without a prototype: a field may be named "__proto__".
    const kinds: Record<string, string> = Object.create(null);
    if (list.leaf) {
      for (const field of this.#fields) kinds[field] = fields[field]!;
      return kinds;
    }
    const group = this.#revision.query.group!;
    for (const field of group.by.slice(0, list.depth + 1)) kinds[field] = fields[field]!;
    for (const aggregate of group.aggregate) kinds[aggregate.as] = aggregateKind(aggregate, fields);
    return kinds;
  }

  /** What each column says on a group's header, as a local grid's groups do. */
  #groupTexts(
    layout: readonly PlacedColumn[],
  ): ((block: Block, row: number, parent: GroupKey) => string)[] {
    const query = this.#revision.query;
    if (this.#textLayout === layout && this.#textQuery === query) return this.#textWriters!;
    const settings = this.settings;
    const group = query.group!;
    const by = group.by;
    const fields = this.schema.fields as Record<string, "number" | "time" | "category">;
    const formats = by.map(
      (field) =>
        layout.find((column) => column.field === field)?.content.key ??
        keyFormatter(fields[field]!, settings, field),
    );
    const count = numberFormatter({ maximumFractionDigits: 0 }, settings.locale);
    const value = (
      block: Block,
      row: number,
      parent: GroupKey,
      k: number,
      format = formats[k]!,
    ) => {
      const depth = parent.length;
      return format(k < depth ? parent[k]! : groupValue(block, depth, row, by));
    };
    const write = layout.map(
      (column, c): ((block: Block, row: number, parent: GroupKey) => string) => {
        if (c === 0)
          return (block, row, parent) =>
            `${value(block, row, parent, parent.length)} (${count((block.data as RowsWindow & { kind: "groups" }).rowCounts[row]!)})`;
        const k = column.field === null ? -1 : by.indexOf(column.field);
        if (k >= 0)
          return (block, row, parent) =>
            k <= parent.length ? value(block, row, parent, k, column.content.key) : "";
        const aggregate = group.aggregate.find(({ as }) => as === column.content.aggregate);
        if (!aggregate) return () => "";
        const { op, field } = aggregate;
        const format = aggregateWriter(
          column,
          op,
          field,
          aggregateKind(aggregate, fields),
          settings,
        );
        return (block, row) => format((block.data!.columns[aggregate.as] as Float64Array)[row]!);
      },
    );
    this.#textLayout = layout;
    this.#textQuery = query;
    this.#textWriters = write;
    return write;
  }

  // Selection

  /**
   * The store's channel changed: the scope the model published with it
   * goes with it; one of a selection replaced since goes.
   */
  #selectionChanged() {
    // Counts and conditions compiled for the selection replaced would keep it.
    this.#countedSelection = null;
    this.#counts = null;
    for (const list of this.#revision.lists.values())
      for (const block of list.blocks.values()) block.test = null;
    this.#scope = this.#scopeNow();
    // Rows show a condition as selected only with the fields it reads.
    this.#readFields();
    this.notify();
  }

  /**
   * A group's state, from what is known now: whole when it was selected as
   * a group (or a group holding it, or every row) and no record loaded
   * within it was taken out since; partly when a group within it was, or
   * when some of its records loaded are selected; whole too when all of its
   * records are loaded and selected. Records not loaded are not guessed at.
   */
  #groupState(selection: RemoteSelection, path: GroupKey, rows: number): SelectionState {
    const { selected, seen } = this.#loadedUnder(selection, path);
    const scope = this.#scopeNow();
    if (
      scope?.selection === selection &&
      scope.filter === JSON.stringify(this.#revision.query.filter ?? null) &&
      scope.by === JSON.stringify(this.#by())
    ) {
      const within = scope.path;
      if (within === null || isPrefix(within, path)) return selected < seen ? "some" : "all";
      // A group within this one was selected: all of it only if it is all there is.
      if (isPrefix(path, within)) {
        for (let depth = path.length; depth < within.length; depth++)
          if (this.#revision.lists.get(groupId(within.slice(0, depth)))?.total !== 1) return "some";
        return selected >= seen ? "all" : "some";
      }
    }
    if (selected === 0) return "none";
    return selected >= rows && seen >= rows ? "all" : "some";
  }

  #selectMatching(path: GroupKey | null) {
    const filter = this.#revision.query.filter;
    this.#publish(matchingSelection(filter, path ? this.#by() : [], path), path);
  }

  /** Selected and loaded record counts within a group. */
  #loadedUnder(selection: RemoteSelection, path: GroupKey): { selected: number; seen: number } {
    if (this.#countedSelection !== selection || this.#countedArrangement !== this.#arrangement) {
      this.#countedSelection = selection;
      this.#countedArrangement = this.#arrangement;
      this.#counts = new Map();
    }
    const counts = this.#counts!;
    const id = groupId(path);
    let count = counts.get(id);
    if (!count) {
      count = { selected: 0, seen: 0 };
      for (const list of this.#revision.lists.values()) {
        if (!list.leaf || !isPrefix(path, list.parent)) continue;
        for (const block of list.blocks.values()) {
          if (block.state !== "loaded") continue;
          for (let row = 0; row < block.data!.length; row++) {
            count.seen++;
            if (rowSelected(selection, this.#sets, this.schema, block, row)) count.selected++;
          }
        }
      }
      counts.set(id, count);
    }
    return count;
  }

  /**
   * The scope the channel's selection was published with by the model:
   * that of the publication under way when the store is at its revision
   * (store listeners that run before the model's own read it so too), or
   * the one installed, while its selection is the channel's.
   */
  #scopeNow(): Scope | null {
    const current = this.selectionStore.get(this.channel);
    const pending = this.#pending;
    const version = this.selectionStore.version(this.channel);
    if (pending && pending.version === version && current?.kind === "matching") {
      const { version: _, ...scope } = pending;
      return { ...scope, selection: current };
    }
    return this.#scope?.selection === current ? this.#scope : null;
  }

  /**
   * Puts a selection in the channel; a group's or every row's when `path`
   * is given (null for every row), which the model then shows selected as
   * a group. Rows toggled in or out of it keep it a group's.
   */
  #publish(selection: RemoteSelection, path?: GroupKey | null) {
    const store = this.selectionStore;
    const scope = this.#scopeNow();
    // The scope is of this publication alone: the channel's next version.
    const version = store.version(this.channel) + 1;
    if (path !== undefined)
      this.#pending = {
        path,
        filter: JSON.stringify(this.#revision.query.filter ?? null),
        by: JSON.stringify(this.#by()),
        version,
      };
    else if (scope && selection.kind === "matching")
      this.#pending = { path: scope.path, filter: scope.filter, by: scope.by, version };
    try {
      store.set(this.channel, selection);
    } finally {
      this.#pending = null;
    }
  }
}

/** A remote grid model; see `RemoteGridModel`. */
export function createRemoteGridModel<S extends Schema>(
  options: RemoteGridModelOptions<S>,
): RemoteGridModel<S> {
  return new RemoteGridModel(options);
}

/** Row `row`'s value of `field` in a window: a label, a number, or a time; null where missing. */
/** The fields columns' texts and links read besides their own. */
function readsOf(contents: ReadonlyMap<string, ColumnContent>): string[] {
  return [...contents.values()].flatMap((content) => content.reads ?? []);
}

/** What `columns`' cell kinds read, bound as `settings` say: remote grids hold no records. */
function bindCells(
  columns: readonly GridColumn[],
  contents: ReadonlyMap<string, ColumnContent>,
  settings: FormatSettings,
): Map<string, CellBinding> {
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
          undefined,
          `${settings.surface} columns[${i}].cell`,
        ),
      );
  });
  return bindings;
}

function windowValue(fields: Fields, field: string, row: number): number | string | null {
  if (fields.kind(field) === "category") {
    const { codes, dictionary } = fields.categories(field);
    const code = codes[row]!;
    return code < 0 ? null : dictionary[code]!;
  }
  const value = fields.numbers(field)[row]!;
  return Number.isNaN(value) ? null : value;
}

const followers = new FinalizationRegistry<() => void>((stop) => stop());

/** A query's aggregates named as looks read them. */
function named(aggregates: readonly GridAggregate[]): NamedAggregate[] {
  return aggregates.map(({ op, field, as }) => ({ name: as, op, field }));
}

/** Whether two checked lists of totals ask the same of the source. */
function sameTotals(
  a: readonly GridAggregate[] | null,
  b: readonly GridAggregate[] | null,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every(
    (one, k) => one.as === b[k]!.as && one.op === b[k]!.op && one.field === b[k]!.field,
  );
}

/** A failure as a `GridSourceError`: the source's own, or "unavailable". */
function sourceError(error: unknown): GridSourceError {
  return error instanceof GridSourceError
    ? error
    : new GridSourceError(
        "unavailable",
        error instanceof Error ? error.message : `The source failed: ${String(error)}`,
      );
}

/** The totals asked of the source for a revision's snapshot, and its answer's fields once loaded. */
interface Asked {
  readonly revision: Revision;
  readonly totals: readonly GridAggregate[];
  state: "loading" | "loaded" | "failed";
  fields: Fields | null;
  readonly controller: AbortController;
}
