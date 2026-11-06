// What every grid model shares, whether its rows are a local row view's
// (model.ts) or a remote source's (remote.ts): the columns it shows (their
// order, widths, pins, and which are hidden), where it is scrolled and which
// row it keeps at the top, the focused cell, and its listeners. What the rows
// are, and how they are found again, read, sorted, expanded, and selected, is
// each model's own, behind the few methods this class calls. The DOM grid
// (dom/grid.ts) draws any of them.

import type { GroupKey } from "../data/groups.ts";
import type { SortKey } from "../data/order.ts";
import type { Schema, Table } from "../data/table.ts";
import { compiledFields } from "../fields/compiled.ts";
import type { CompiledFields } from "../fields/display.ts";
import type { RowLink } from "../fields/links.ts";
import type { FieldDisplays } from "../fields/rules.ts";
import { timeFormatter } from "../format/format.ts";
import type { TimeZone } from "../format/zone.ts";
import {
  type ColumnContent,
  type FormatSettings,
  type GridColumn,
  type GridColumnLayout,
  MIN_COLUMN_WIDTH,
  MIN_SCROLLING_WIDTH,
  type PinSide,
  type PlacedColumn,
  pinnedWidth,
  pinsHold,
  placeColumns,
  widthOf,
} from "./columns.ts";
import { type CellEncodings, type CellLook, type GridScales, plain } from "./looks.ts";
import type { SparklineRead } from "./sparklines.ts";

/** Options every grid model takes. */
export interface GridSettings {
  /** In CSS pixels; 28 by default. */
  rowHeight?: number;
  /** BCP 47 locale for numbers and times; the runtime's by default. */
  locale?: string;
  /** Zone times are shown in: "UTC", an IANA zone, or "local" (the default). */
  timeZone?: TimeZone;
  /**
   * Field displays: displays by field name or rules, as charts take them,
   * compiled when given, or `compileFields(rules)` from `herceg/fields`, to
   * share one compilation among grids and charts. Headers take their
   * fields' labels and descriptions, and cells and group rows write values
   * through them (missing text, mappings, formats). Without them, values
   * are written in their columns' formats, and missing values are empty.
   */
  fields?: FieldDisplays | CompiledFields | undefined;
  /**
   * Scales looks read values through, by name, as charts' `scales`: channel
   * scales (gradients through hex colors), scales of categories, and
   * identity scales (see `GridScales`).
   */
  scales?: GridScales | undefined;
  /** How clicks select rows (see `GridSelectionOptions`). */
  selection?: GridSelectionOptions;
}

/**
 * What a grid model's `update` takes: what is given changes (undefined
 * clears it), what is left out stays. Local and remote models take
 * `totals` too.
 */
export interface GridPresentation<S extends Schema = Schema> {
  /** Field displays, as the model's option takes them (see `GridSettings.fields`). */
  fields?: FieldDisplays | CompiledFields | undefined;
  /** Scales looks read values through (see `GridSettings.scales`). */
  scales?: GridScales | undefined;
  /** How whole table rows look, where a cell's column gives no look of its own (see `CellEncodings`). */
  encode?: CellEncodings<S> | undefined;
}

/** What state a cell's value is in (see `GridCellRead`). */
export type GridCellState =
  /** A value, which `value` holds. */
  | "value"
  /** Its field's value is missing, as displays read it: null, NaN, and times past the ends of dates. */
  | "missing"
  /** A pivot's combination no row holds. */
  | "absent"
  /** Nothing to show: a group row's cell without a key or aggregate. */
  | "empty"
  /** A remote row still loading, or that failed to load. */
  | "loading"
  | "failed";

/** One cell read whole (`cellAt`): made when asked for, kept by no one. */
export interface GridCellRead {
  readonly state: GridCellState;
  /** The raw value: a number, a time's epoch milliseconds, or a label; null when missing; undefined where the cell has none. */
  readonly value: number | string | null | undefined;
  /** The value's kind: its column's, or on group rows its aggregate's (a count in a time column is a number); null without a value. */
  readonly kind: "number" | "time" | "category" | null;
  /** The text the grid writes, as `textAt` gives it. */
  readonly text: string;
  /** Its look, as `lookAt` gives it. */
  readonly look: CellLook | undefined;
  /** Its row's link of the column's field, where the field's display gives one. */
  readonly link: RowLink | undefined;
  /**
   * A bar cell's bar (`barCell`): where it starts and ends, as fractions of
   * the cell's width from its start; undefined where it draws none.
   */
  readonly bar?: readonly [number, number] | undefined;
  /** A sparkline cell's series (`sparklineCell`): what it draws, its window, and its domain. */
  readonly sparkline?: SparklineRead | undefined;
}

/**
 * The totals row a grid shows under its rows, sticky at its bottom: each
 * column's `aggregate` of the grid's totals (`totals`), and "Total" in the
 * first shown column without one. It is no row of the table: `rowCount`
 * does not count it, it selects nothing, and its focus is `rowIndex:
 * rowCount`, kept there as rows come and go.
 */
export interface GridTotalsRow {
  /** Counts changes of what its cells show (values, texts, looks), apart from the columns' layout. */
  readonly version: number;
  /** The shown column whose cell says "Total"; -1 where every shown column has an aggregate (the row is named "Total"). */
  readonly label: number;
  /** A remote grid's totals while they load, or if they failed; "loaded" for local ones. */
  readonly state: "loaded" | "loading" | "failed";
  /** The text of shown column `columnIndex`'s cell. */
  textAt(columnIndex: number): string;
  /** The look of shown column `columnIndex`'s cell (its column's `aggregateEncode` of the totals). */
  lookAt(columnIndex: number): CellLook | undefined;
  /** Shown column `columnIndex`'s cell read whole: its total's value and kind (`empty` without one), text, and look. */
  cellAt(columnIndex: number): GridCellRead;
}

/** The text of a totals row's label (`GridTotalsRow.label`), and its name where it has none. */
export const TOTAL = "Total";

/** What a model's totals row reads: local, a pivot's, or remote. */
export interface TotalsSource {
  /** Says what its cells show (values, state, looks) apart from the columns: changes as they do. */
  key(): string;
  state(): GridTotalsRow["state"];
  /** What the totals are: the writers are made again when it changes, or the columns do. */
  totals(): unknown;
  /** What writes shown column `column`'s total, as group rows write aggregates; null where it shows none. */
  writer(column: PlacedColumn): ((value: number) => string) | null;
  /** Shown column `columnIndex`'s total, where it shows one: its value and kind, or why it has none. */
  read(columnIndex: number): Pick<GridCellRead, "state" | "value" | "kind">;
  look(columnIndex: number): CellLook | undefined;
}

/**
 * The totals row of `model`, reading `of`: each shown column's total, and
 * "Total" in the first shown column without one.
 */
export function totalsRow(
  model: { readonly columnLayout: readonly GridColumnLayout[] },
  of: TotalsSource,
): GridTotalsRow {
  let seen = { key: "", version: 0 };
  let written: {
    layout: readonly GridColumnLayout[];
    totals: unknown;
    texts: (((value: number) => string) | null)[];
    label: number;
  } | null = null;
  const writers = () => {
    const layout = model.columnLayout;
    const totals = of.totals();
    if (written?.layout !== layout || written.totals !== totals) {
      const texts = (layout as readonly PlacedColumn[]).map((column) => of.writer(column));
      written = { layout, totals, texts, label: texts.indexOf(null) };
    }
    return written;
  };
  const cellAt = (columnIndex: number): GridCellRead => {
    const { texts, label } = writers();
    const write = texts[columnIndex];
    const read = write ? of.read(columnIndex) : NO_TOTAL;
    const text =
      columnIndex === label
        ? TOTAL
        : write && read.kind
          ? write((read.value as number | null) ?? Number.NaN)
          : "";
    return { ...read, text, look: of.look(columnIndex), link: undefined };
  };
  return {
    get version() {
      const key = of.key();
      if (seen.key !== key) seen = { key, version: seen.version + 1 };
      return seen.version;
    },
    get label() {
      return writers().label;
    },
    get state() {
      return of.state();
    },
    textAt: (columnIndex) => cellAt(columnIndex).text,
    lookAt: (columnIndex) => of.look(columnIndex),
    cellAt,
  };
}

/** A totals row's cell without a total. */
const NO_TOTAL = { state: "empty", value: undefined, kind: null } as const;

/** How a grid's clicks select its rows. */
export interface GridSelectionOptions {
  /**
   * What a plain click on the one row selected (or a group's header whose
   * rows are all that is selected) does: clears the selection ("toggle"),
   * or keeps it ("only", the default). Elsewhere a plain click selects
   * only its row; Ctrl or Cmd toggles a row, Shift selects a range.
   */
  click?: "toggle" | "only";
}

/** A cell: its row's index in the view (-1 for the header row) and its column. */
export interface GridFocus {
  readonly rowIndex: number;
  /** Index among the shown columns. */
  readonly columnIndex: number;
  /** The column's id. */
  readonly column: string;
}

/**
 * Rows `[rowStart, rowEnd)` and shown columns `[columnStart, columnEnd)`
 * among those that scroll; columns held at the edges are always in view.
 */
export interface GridRange {
  readonly rowStart: number;
  readonly rowEnd: number;
  readonly columnStart: number;
  readonly columnEnd: number;
}

/**
 * Names a row of a grid while it is shown, however rows around it come and
 * go: equal `scope` and `id` are the same row. `indexOf` finds it again.
 */
export interface GridRef {
  readonly scope: unknown;
  readonly id: string | number;
}

/**
 * What renderers read of a row: a record, a group's header, or (in remote
 * grids) a placeholder for a row still loading. `version` changes when what
 * the row shows may have; a set size of -1 is unknown.
 */
export type ShownRow =
  | {
      readonly kind: "row";
      readonly ref: GridRef;
      readonly version: number;
      readonly level: number;
      readonly setIndex: number;
      readonly setSize: number;
    }
  | {
      readonly kind: "placeholder";
      readonly ref: GridRef;
      readonly version: number;
      readonly level: number;
      readonly setIndex: number;
      readonly setSize: number;
      /** How far its first cell is indented: as the group's header or row it stands for. */
      readonly indent: number;
    }
  | {
      readonly kind: "group";
      readonly ref: GridRef;
      readonly version: number;
      readonly key: GroupKey;
      readonly expanded: boolean;
      readonly level: number;
      readonly setIndex: number;
      readonly setSize: number;
    };

/** How much of a row is selected: a group's rows can be partly. */
export type SelectionState = "all" | "some" | "none";

/** Where `moveFocus` goes: a cell over, a page over, a row's ends, or the grid's first or last cell. */
export type FocusMove =
  | "up"
  | "down"
  | "left"
  | "right"
  | "pageUp"
  | "pageDown"
  | "rowStart"
  | "rowEnd"
  | "first"
  | "last";

/**
 * How `select` changes the selection: to only the row (a click), the row
 * toggled (Ctrl or Cmd and click), the rows from the anchor to it (Shift
 * and click), or those added (both). A group's header stands for its rows.
 */
export type SelectMode = "only" | "toggle" | "range" | "addRange";

/**
 * What a model shows as of one state of its rows: how many, and whether
 * the row at the top keeps its place since the last (not after a new
 * query, which keeps the pixel offset).
 */
export interface GridDisplay {
  readonly length: number;
  readonly keep: boolean;
}

/** A column as models keep it: with its id. */
export type Column<S extends Schema = Schema> = GridColumn<S> & { readonly id: string };

interface Focus {
  /** The focused body row; null for the header row, `TOTALS` for the totals row. */
  row: GridRef | null | typeof TOTALS;
  /** Where the row was, for when it leaves. */
  rowIndex: number;
  column: string;
  columnIndex: number;
}

const ROW_HEIGHT = 28;
/** The focus's row while it is on the totals row, which no ref names. */
const TOTALS = "totals";

/**
 * The state every grid model has: columns, viewport, scrolling, and focus,
 * over rows the subclass provides. Every read brings it up to date with its
 * rows; listeners are told synchronously when the rows or the model's own
 * state change.
 */
export abstract class BaseGridModel<S extends Schema = Schema> {
  readonly rowHeight: number;
  /** How values are written: replaced whole by `update`. */
  protected settings: FormatSettings;
  /** The scales and row encodings looks read, as given: replaced whole by `update`. */
  protected presentation: LookPresentation;
  /** The columns, shown or hidden, in order: the one record of their layout. */
  #columns: readonly Column<S>[] = [];
  /** What each column shows, by id, made when the columns are set. */
  #contents = new Map<string, ColumnContent>();
  #layout: readonly PlacedColumn[] = [];
  #width = 0;
  /** How many shown columns are held at each edge, and how wide they are. */
  #pins = { left: 0, right: 0, leftWidth: 0, rightWidth: 0 };

  #display: GridDisplay | undefined;
  #viewWidth = 0;
  #viewHeight = 0;
  #top = 0;
  #left = 0;
  /** The row at the top and how far it is scrolled past, kept in place as rows come and go. */
  #anchor: { ref: GridRef; offset: number } | null = null;
  #focus: Focus | null = null;
  /** Where Shift ranges start. */
  protected rangeAnchor: GridRef | null = null;
  readonly #listeners = new Set<() => void>();
  #batching = 0;
  #notified = false;
  /** Counts what listeners were told of: what the grid shows changes with it (see `revision`). */
  #revision = 0;
  /** What a plain click on the one row selected does (`selection.click`). */
  readonly #clicks: "toggle" | "only";
  /**
   * What sparklines call as their data changes: tells listeners, and says
   * whether the model is still kept. Holds it weakly, as its view's
   * listener does.
   */
  readonly #redraw: () => boolean;

  /**
   * `surface` names the grid in messages ("grid", "remote grid", "pivot
   * grid"); rules naming tables match `source`, the table its rows are of
   * or a remote source's name.
   */
  constructor(options: GridSettings, surface: string, source: Table | string) {
    const ref = new WeakRef(this);
    this.#redraw = () => {
      const model = ref.deref();
      model?.notify();
      return model !== undefined;
    };
    this.rowHeight = options.rowHeight ?? ROW_HEIGHT;
    if (!(Number.isFinite(this.rowHeight) && this.rowHeight > 0))
      throw new RangeError(`A grid's rowHeight must be positive, not ${this.rowHeight}`);
    const click = options.selection?.click ?? "only";
    if (click !== "toggle" && click !== "only")
      throw new TypeError(
        `grid selection.click: expected "toggle" or "only"; received ${JSON.stringify(click)}`,
      );
    this.#clicks = click;
    const timeZone = options.timeZone ?? "local";
    // Refused as the grid is made, whichever formats would read the zone later.
    try {
      timeFormatter({}, timeZone);
    } catch {
      throw new RangeError(
        `${surface} timeZone: ${JSON.stringify(timeZone)} is not a time zone; give "UTC", "local", or an IANA zone such as "Europe/Belgrade"`,
      );
    }
    this.settings = {
      surface,
      locale: options.locale,
      timeZone,
      missing: "",
      fields: compiledFields(options.fields, surface),
      source,
    };
    // Copies, so a caller's later changes reach looks only through `update`.
    this.presentation = {
      scales: plain(options.scales) as GridScales | undefined,
      encode: plain((options as { encode?: CellEncodings | undefined }).encode) as
        | CellEncodings
        | undefined,
      totals: totalsCopied((options as { totals?: unknown }).totals),
    };
  }

  // Columns

  /**
   * Every column, shown or hidden, in order, with its id: their layout as
   * resizing, moving, pinning, and hiding left it, which `setColumns` takes
   * back.
   */
  get columns(): readonly GridColumn<S>[] {
    this.generated();
    return this.#columns;
  }

  /** The shown columns, placed side by side: pinned left, the others, pinned right. */
  get columnLayout(): readonly GridColumnLayout[] {
    this.generated();
    return this.#layout;
  }

  /** Width of the shown columns together, in CSS pixels. */
  get width(): number {
    this.generated();
    return this.#width;
  }

  /** The columns as they are, generated ones not caught up: for models generating them. */
  protected get columnList(): readonly Column<S>[] {
    return this.#columns;
  }

  /** Replaces the columns: their order, widths, pins, formats, aggregates, and which are hidden. */
  abstract setColumns(columns: readonly GridColumn<S>[]): void;

  /**
   * Changes how the grid presents its columns: `fields` (field displays),
   * `scales`, `encode` (whole rows' looks), and in local and remote grids
   * `totals` (a totals row; null or undefined drops it), as given, or
   * cleared with undefined; what is left out stays. The whole update is
   * checked and compiled before any of it applies, so a refused one changes
   * nothing; listeners are told once. The columns' layout, the sort,
   * groups, selection, and scroll stay.
   */
  update(options: GridPresentation<S>): void {
    const { surface } = this.settings;
    if (typeof options !== "object" || options === null)
      throw new TypeError(`${surface} update: expected options such as { fields }`);
    for (const key of Object.keys(options))
      if (key !== "fields" && key !== "scales" && key !== "encode" && key !== "totals")
        throw new Error(
          `${surface} update.${key}: unknown option; use fields, scales, encode, or totals`,
        );
    if (Object.keys(options).length === 0) return;
    const settings =
      "fields" in options
        ? { ...this.settings, fields: compiledFields(options.fields, surface) }
        : this.settings;
    const presentation: LookPresentation = {
      scales:
        "scales" in options
          ? (plain(options.scales) as GridScales | undefined)
          : this.presentation.scales,
      encode:
        "encode" in options
          ? (plain(options.encode) as CellEncodings | undefined)
          : this.presentation.encode,
      totals:
        "totals" in options
          ? totalsCopied((options as { totals?: unknown }).totals)
          : this.presentation.totals,
    };
    const apply = this.restyle(settings, presentation);
    this.#batch(() => {
      this.settings = settings;
      this.presentation = presentation;
      apply();
      this.notify();
    });
  }

  /**
   * What column `id`, shown or hidden, is called in menus, announcements,
   * and its header's accessible name: its title (else its field's label,
   * else its field) after its headings ("Latency, p99"; a pivot's value
   * column: "api, Latency (ms)").
   */
  columnTitle(id: string): string {
    this.generated();
    const content = this.#contents.get(id);
    if (!content) return id;
    return [...content.headings.map(({ title }) => title), content.title].join(", ");
  }

  /**
   * Sets a column's width, in CSS pixels, no narrower than
   * `MIN_COLUMN_WIDTH`. A pinned column held at its edge widens only as far
   * as the pinned columns leave the others `MIN_SCROLLING_WIDTH`.
   */
  resizeColumn(id: string, width: number): void {
    const column = this.column(id);
    if (!Number.isFinite(width)) throw new RangeError(`Column "${id}" cannot be ${width} wide`);
    const next = Math.max(MIN_COLUMN_WIDTH, Math.min(width, this.#widest(column)));
    if (next === widthOf(column)) return;
    this.#replace(column, { ...column, width: next });
  }

  /**
   * Moves a column before the column `before` in the columns' order, or last
   * with null. Pinned columns show at their edge in that order, so a move
   * among them, or among the others, is a move on the screen.
   */
  moveColumn(id: string, before: string | null): void {
    const column = this.column(id);
    if (before !== null) this.column(before);
    if (before === id) return;
    const rest = this.#columns.filter((other) => other !== column);
    const at = before === null ? rest.length : rest.findIndex((other) => other.id === before);
    if (this.#columns[at] === column) return;
    rest.splice(at, 0, column);
    this.takeColumns(rest);
  }

  /**
   * Pins a column to the grid's left or right edge, or unpins it with null,
   * back to its place among the others. A column the grid has no room to
   * hold at an edge is refused (see `canPin`); `setColumns` takes pins as
   * given, to restore a layout, and pinned columns the grid becomes too
   * narrow for scroll with the others until it widens.
   */
  pinColumn(id: string, side: PinSide | null): void {
    if (side !== null && side !== "left" && side !== "right")
      throw new TypeError(`Columns pin to "left" or "right", not "${side}"`);
    const column = this.column(id);
    if ((column.pin ?? null) === side) return;
    if (side !== null && !this.canPin(id))
      throw new RangeError(
        `Pinning "${id}" would leave the other columns less than ${MIN_SCROLLING_WIDTH} pixels`,
      );
    const { pin: _, ...rest } = column;
    this.#replace(column, (side === null ? rest : { ...rest, pin: side }) as Column<S>);
  }

  /**
   * Whether `pinColumn` can pin the column: whether, pinned, it would leave
   * the other columns at least `MIN_SCROLLING_WIDTH` of the grid as wide as
   * it is now. Always for a column pinned already (to move it to the other
   * side), a hidden one, or before the grid is measured.
   */
  canPin(id: string): boolean {
    const column = this.column(id);
    if (column.pin !== undefined || column.hidden) return true;
    return pinsHold(pinnedWidth(this.#columns) + widthOf(column), this.#viewWidth);
  }

  /** Shows or hides a column. The focus on a column hidden goes to the nearest shown one. */
  setColumnVisible(id: string, visible: boolean): void {
    const column = this.column(id);
    if (!column.hidden === visible) return;
    const { hidden: _, ...rest } = column;
    this.#replace(column, (visible ? rest : { ...rest, hidden: true }) as Column<S>);
  }

  /** Index of the shown column `id`, or -1. */
  columnIndex(id: string): number {
    this.generated();
    return this.#layout.findIndex((column) => column.id === id);
  }

  // Rows

  get rowCount(): number {
    return this.current().length;
  }

  /** Height of every row together, in CSS pixels. */
  get contentHeight(): number {
    return this.rowCount * this.rowHeight;
  }

  /** Whether the rows are grouped, each group's header followed by its groups or rows: a tree. */
  abstract get grouped(): boolean;

  /** What the row at `rowIndex` shows. */
  abstract row(rowIndex: number): ShownRow;

  /** The text of a cell: row `rowIndex`, shown column `columnIndex`. */
  abstract textAt(rowIndex: number, columnIndex: number): string;

  /**
   * The look of a cell (`cellAt(rowIndex, columnIndex).look`), without its
   * text or the rest of the cell: undefined where its channels give none.
   */
  abstract lookAt(rowIndex: number, columnIndex: number): CellLook | undefined;

  /** A cell read whole: its state, raw value and kind, text, look, and link. */
  abstract cellAt(rowIndex: number, columnIndex: number): GridCellRead;

  /** The totals row under the rows, or null without totals (see `GridTotalsRow`). */
  abstract get totalsRow(): GridTotalsRow | null;

  /** Whether the grid's columns or rows have looks: without them, every cell's look is undefined. */
  abstract get hasLooks(): boolean;

  /**
   * Counts changes of looks that a row's own version does not count: what
   * looks are compiled from, a channel scale's domain found from the data,
   * a rank test's nth value. Renderers read mounted cells' looks again when
   * it moves.
   */
  abstract get looksRevision(): number;

  /**
   * Counts changes of what the kind of shown column `columnIndex` draws
   * that a row's own version does not count: a bar's domain found from the
   * records, a sparkline's data. Renderers draw that column's mounted cells
   * again when it moves; 0 for a column without a kind.
   */
  abstract cellsRevision(columnIndex: number): number;

  /**
   * A reader of the record at `rowIndex`'s raw values, bound to that record
   * wherever it moves: a number, a time's epoch milliseconds, or a label;
   * null when missing (custom renderers' `read`). Throws for a group's row
   * and a row still loading; the reader throws for a field the grid does
   * not have, and once a local table no longer holds the record.
   */
  abstract rowValues(rowIndex: number): (field: string) => number | string | null;

  /**
   * Fields `asker` (a DOM grid of the model) reads besides those the
   * columns and looks read: its custom renderers' (`cells`), each with
   * where it was given (`[field, at]`), replacing those it asked for
   * before; none lets go of them. A remote grid asks its source for every
   * asker's with its rows. Refuses a field the grid lacks, changing nothing.
   */
  abstract askFields(
    asker: object,
    fields: readonly (readonly [field: string, at: string])[],
  ): void;

  /** Where the row a ref names shows now, or -1 when the grid no longer shows it. */
  indexOf(ref: GridRef): number {
    this.current();
    return this.find(ref, false);
  }

  // Sorting and groups

  abstract get sort(): readonly SortKey[];

  /**
   * Sorts by a column's field as a header click does: ascending, then
   * descending, then not at all; additive (Shift and click), the other keys
   * stay and a new field goes last.
   */
  abstract cycleSort(column: string, options?: { additive?: boolean }): void;

  /** Whether the group with this key path shows its groups below, or its rows. */
  abstract isExpanded(key: GroupKey): boolean;

  /** Shows or hides the groups below, or the rows, of the group with this key path. */
  abstract setExpanded(key: GroupKey, expanded: boolean): void;

  // Viewport

  /** Sets the size of the area rows show in (below the header), in CSS pixels. */
  setViewport(width: number, height: number): void {
    if (width === this.#viewWidth && height === this.#viewHeight) return;
    const pinned = pinnedWidth(this.#columns);
    const held = pinsHold(pinned, this.#viewWidth);
    this.#viewWidth = Math.max(0, width);
    this.#viewHeight = Math.max(0, height);
    // Pinned columns are let go, or held again, as the grid narrows or widens.
    if (pinsHold(pinned, this.#viewWidth) !== held) this.#placeColumns();
    this.current();
    this.#scroll(this.#top, this.#left, true);
    this.notify();
  }

  get viewportWidth(): number {
    return this.#viewWidth;
  }

  get viewportHeight(): number {
    return this.#viewHeight;
  }

  /** How far the rows are scrolled, in CSS pixels; rows keep their place as the view changes. */
  get top(): number {
    this.current();
    return this.#top;
  }

  get left(): number {
    return this.#left;
  }

  /** Scrolls to these offsets, kept within the rows and columns. */
  scrollTo({ top, left }: { top?: number; left?: number }): void {
    // Offsets left out are the current ones once rows have caught up (and been anchored).
    this.current();
    this.#scroll(top ?? this.#top, left ?? this.#left);
  }

  /** Scrolls as little as needed to show a whole cell (or row, without a column). */
  reveal(rowIndex: number, column?: string): void {
    this.current();
    const [top, left] = this.#revealed(
      rowIndex,
      column === undefined ? -1 : this.columnIndex(column),
    );
    this.#scroll(top, left);
  }

  /** The rows and columns in view, with `overscan` more rows and columns on each side. */
  visibleRange(overscan: { rows?: number; columns?: number } = {}): GridRange {
    const { rows = 10, columns = 2 } = overscan;
    const count = this.rowCount;
    const height = this.rowHeight;
    const top = this.#top;
    const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));
    const layout = this.#layout;
    // Columns between those held at the edges scroll, behind them.
    const pins = this.#pins;
    const [start, end] = [pins.left, layout.length - pins.right];
    // The first scrolling column whose `edge` is past `x`, by binary search.
    const first = (x: number, edge: (column: GridColumnLayout) => number) => {
      let [lo, hi] = [start, end];
      while (lo < hi) {
        const mid = (lo + hi) >>> 1;
        if (edge(layout[mid]!) <= x) lo = mid + 1;
        else hi = mid;
      }
      return lo;
    };
    const left = this.#left + pins.leftWidth;
    const right = this.#left + this.#viewWidth - pins.rightWidth;
    const within = (index: number) => Math.max(start, Math.min(end, index));
    const columnStart = within(first(left, ({ x, width }) => x + width) - columns);
    return {
      rowStart: clamp(Math.floor(top / height) - rows, count),
      rowEnd: clamp(Math.ceil((top + this.#viewHeight) / height) + rows, count),
      columnStart,
      // Columns starting before the right edge show.
      columnEnd: Math.max(columnStart, within(first(right - 1e-6, ({ x }) => x) + columns)),
    };
  }

  // Focus

  /**
   * The focused cell, which keeps to its row as rows move. When the row
   * leaves, the focus goes to the row taking its place, or to the header row
   * when none is left; when its group collapses, to the group's header; when
   * its column is hidden, to the nearest shown column. At first it is the
   * header's first cell; null while no column is shown.
   */
  get focus(): GridFocus | null {
    this.current();
    const layout = this.#layout;
    if (layout.length === 0) return null;
    const focus = this.#focus;
    if (!focus) return { rowIndex: -1, columnIndex: 0, column: layout[0]!.id };
    return { rowIndex: focus.rowIndex, columnIndex: focus.columnIndex, column: focus.column };
  }

  /**
   * Focuses a cell (row -1 for the header row, `rowCount` for the totals
   * row), scrolling it into view unless `reveal` is false.
   */
  focusCell(rowIndex: number, column: string, { reveal = true }: { reveal?: boolean } = {}): void {
    const count = this.rowCount;
    const last = this.totalsRow ? count : count - 1;
    if (!(Number.isInteger(rowIndex) && rowIndex >= -1 && rowIndex <= last))
      throw new RangeError(`Row ${rowIndex} is not among the grid's ${count} rows`);
    const columnIndex = this.columnIndex(column);
    if (columnIndex < 0) throw new Error(`No shown grid column "${column}"`);
    this.#focus = {
      row: rowIndex < 0 ? null : rowIndex === count ? TOTALS : this.refAt(rowIndex),
      rowIndex,
      column,
      columnIndex,
    };
    if (reveal) {
      // The totals row is always in view: only its column scrolls into view.
      const [top, left] = this.#revealed(rowIndex === count ? -1 : rowIndex, columnIndex);
      this.#scroll(top, left, true);
    }
    this.notify();
  }

  /**
   * Moves the focus as the keyboard does and scrolls it into view. Moving
   * between rows with `extend` (Shift) selects the rows from the anchor to
   * the new focus. In grouped grids, on a row's first cell, right expands a
   * collapsed group, left collapses an expanded one, and left from a
   * collapsed group or a group's row goes to the group holding it. The
   * totals row is under the last row: down from it, page down from it (or
   * from the header of a grid without rows), and the grid's last cell go
   * there; moves onto or off it select nothing.
   */
  moveFocus(move: FocusMove, { extend = false }: { extend?: boolean } = {}): void {
    // Listeners hear once the focus, the scroll, and a range are all in place.
    this.#batch(() => this.#moveFocus(move, extend));
  }

  #moveFocus(move: FocusMove, extend: boolean) {
    const focus = this.focus;
    if (!focus) return;
    const rows = this.rowCount;
    // Rows of the table: the totals row is none.
    const body = (row: number) => row >= 0 && row < rows;
    if (
      body(focus.rowIndex) &&
      focus.columnIndex === 0 &&
      (move === "left" || move === "right") &&
      this.moveInTree(focus, move === "left")
    )
      return;
    const columns = this.#layout.length;
    const page = Math.max(1, Math.floor(this.#viewHeight / this.rowHeight));
    const last = this.totalsRow ? rows : rows - 1;
    let { rowIndex: row, columnIndex: column } = focus;
    if (move === "up") row = Math.max(-1, row - 1);
    else if (move === "down") row = Math.min(last, row + 1);
    else if (move === "left") column = Math.max(0, column - 1);
    else if (move === "right") column = Math.min(columns - 1, column + 1);
    else if (move === "pageUp") row = row < 0 || rows === 0 ? -1 : Math.max(0, row - page);
    else if (move === "pageDown") {
      // From the last row (or the header of a grid without rows) to the totals row, and no further.
      const next = Math.min(rows - 1, row + page);
      if (row < rows) row = next === row ? Math.min(last, row + 1) : next;
    } else if (move === "rowStart") column = 0;
    else if (move === "rowEnd") column = columns - 1;
    else if (move === "first") [row, column] = [-1, 0];
    else [row, column] = [last, columns - 1];
    // The first Shift move starts its range at the row it leaves.
    const from =
      extend && body(focus.rowIndex) && body(row) && this.rangeAnchorIndex() === null
        ? focus.rowIndex
        : -1;
    if (from >= 0) this.rangeAnchor = this.refAt(from);
    this.focusCell(row, this.#layout[column]!.id);
    // The header row is always in view; going to the grid's first cell goes to the top of its rows too.
    if (move === "first") this.#scroll(0, 0);
    if (extend && body(focus.rowIndex) && body(row) && this.rangeAnchorIndex() !== null)
      this.select(row, "range");
  }

  // Selection

  /** Whether the row at `rowIndex` is selected; a group's header when all its rows are. */
  isSelected(rowIndex: number): boolean {
    return this.selectionState(rowIndex) === "all";
  }

  /** How much of a row is selected; a group's header is partly when some of its rows are. */
  abstract selectionState(rowIndex: number): SelectionState;

  /** Rows selected; null when a condition selects them that the grid cannot count. */
  abstract get selectedCount(): number | null;

  /** Increments whenever the selection changes. */
  abstract get selectionRevision(): number;

  /** Selects as clicks do (see `SelectMode`). */
  abstract select(rowIndex: number, mode?: SelectMode): void;

  /** Selects every row the grid shows, those scrolled away or in collapsed groups too. */
  abstract selectAll(): void;

  /** Clears the selection and the range anchor; whether there was anything to clear. */
  abstract clearSelection(): boolean;

  /**
   * Whether the row at `rowIndex` (or a group header's rows) is all that
   * is selected, which a plain click clears with `selection.click` "toggle".
   */
  protected abstract selectedAlone(rowIndex: number): boolean;

  /**
   * What a plain click on the row at `rowIndex` does: selects only it, or
   * with `selection.click` "toggle", clears the selection where the row is
   * all of it.
   */
  click(rowIndex: number): void {
    if (this.#clicks === "toggle" && this.selectedAlone(rowIndex)) this.clearSelection();
    else this.select(rowIndex, "only");
  }

  /**
   * Counts the changes of what the grid shows (its rows, columns, sort,
   * selection, scrolling, focus): each one listeners are told of
   * increments it, and a grid's `render` reports the revision it drew.
   */
  get revision(): number {
    return this.#revision;
  }

  // Subscriptions

  /** Calls `listener` whenever what the grid shows may have changed; returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** Stops listeners; models stop following what they show too. */
  dispose(): void {
    this.#listeners.clear();
    this.#follow(false);
  }

  protected notify() {
    if (this.#batching > 0) {
      this.#notified = true;
      return;
    }
    this.#revision++;
    for (const listener of [...this.#listeners]) listener();
  }

  /** Runs a command whose steps notify, telling listeners once, when it is done. */
  #batch(command: () => void) {
    this.#batching++;
    try {
      command();
    } finally {
      if (--this.#batching === 0 && this.#notified) {
        this.#notified = false;
        this.notify();
      }
    }
  }

  // For models

  /**
   * Brings the rows up to date: the display as it is now, the same object
   * when nothing changed since `previous`. Never notifies.
   */
  protected abstract catchUp(previous: GridDisplay | undefined): GridDisplay;

  /** What follows the row at `rowIndex` as rows move. */
  protected abstract refAt(rowIndex: number): GridRef;

  /**
   * Where a row is now, or -1 when it left. A row hidden by a collapsed
   * group above it is at that group's header with `collapsed`, and nowhere
   * without.
   */
  protected abstract find(ref: GridRef, collapsed: boolean): number;

  /**
   * In grouped grids, what Left (`left`) or Right does on a row's first
   * cell: expand or collapse its group, or go to the group holding it.
   * Whether it did anything.
   */
  protected moveInTree(_focus: GridFocus, _left: boolean): boolean {
    return false;
  }

  /** Brings generated columns up to date before they are read (a pivot's); none by default. */
  protected generated(): void {}

  /**
   * What the columns show written as `settings` say, and the looks as
   * `presentation` and `settings` say, checked (throwing before anything
   * changes), and what then takes them.
   */
  protected abstract restyle(settings: FormatSettings, presentation: LookPresentation): () => void;

  /**
   * What the grid shows, catching up with changes since the last read: the
   * top row keeps its place unless the display says otherwise, and the
   * focus finds its row again. Never notifies: readers inside listeners
   * must not cause more notifications.
   */
  protected current(): GridDisplay {
    const previous = this.#display;
    const display = this.catchUp(previous);
    if (display === previous) return display;
    this.#display = display;
    const anchor = this.#anchor;
    if (anchor && display.keep) {
      const index = this.find(anchor.ref, true);
      if (index >= 0) this.#top = index * this.rowHeight + anchor.offset;
    }
    this.#top = this.#clampTop(this.#top);
    this.#resolveFocus();
    this.#remember();
    return display;
  }

  /** The column `id`, shown or hidden. */
  protected column(id: string): Column<S> {
    this.generated();
    const column = this.#columns.find((other) => other.id === id);
    if (!column) throw new Error(`No grid column "${id}"`);
    return column;
  }

  /** Takes these as the columns (with what they show, when given), placed anew. */
  protected takeColumns(columns: readonly Column<S>[], contents?: Map<string, ColumnContent>) {
    if (contents) {
      this.#follow(false);
      this.#contents = contents;
      this.#follow(true);
    }
    // The focus moves to the columns as they are now: catch up with the rows first.
    if (this.#display) this.current();
    this.#columns = Object.freeze(columns.map((column) => Object.freeze(column) as Column<S>));
    this.#placeColumns();
    this.#left = this.#clampLeft(this.#left);
    this.#resolveFocus();
    this.notify();
  }

  /** Has the columns' sparklines follow their data, or (false) let go of it and of their indexes. */
  #follow(follow: boolean) {
    for (const { sparkline } of this.#contents.values()) sparkline?.follow(follow && this.#redraw);
  }

  /**
   * Takes columns generated again while catching up (a pivot's): the first
   * scrolling column in view stays where it was on the screen.
   */
  protected regenerate(columns: readonly Column<S>[], contents: Map<string, ColumnContent>) {
    const left = this.#left;
    const anchor = this.#layout.find(
      ({ x, width, pinned }) => pinned === null && x + width > left + this.#pins.leftWidth,
    );
    this.#contents = contents;
    this.#columns = Object.freeze(columns.map((column) => Object.freeze(column) as Column<S>));
    this.#placeColumns();
    const moved = anchor && this.#layout.find(({ id }) => id === anchor.id);
    this.#left = this.#clampLeft(moved ? moved.x - anchor.x + left : left);
  }

  /** The row index of the range anchor, or null when there is none or it left. */
  protected rangeAnchorIndex(): number | null {
    const anchor = this.rangeAnchor;
    const index = anchor ? this.find(anchor, true) : -1;
    return index < 0 ? null : index;
  }

  #replace(column: Column<S>, next: Column<S>) {
    this.takeColumns(this.#columns.map((other) => (other === column ? next : other)));
  }

  /** Places the shown columns, holding pinned ones at the edges if the viewport leaves room. */
  #placeColumns() {
    const layout = placeColumns(this.#columns, this.#contents, this.#viewWidth);
    this.#layout = Object.freeze(layout);
    const last = layout.at(-1);
    this.#width = last ? last.x + last.width : 0;
    const pins = { left: 0, right: 0, leftWidth: 0, rightWidth: 0 };
    while (pins.left < layout.length && layout[pins.left]!.pinned === "left")
      pins.leftWidth += layout[pins.left++]!.width;
    while (pins.right < layout.length && layout.at(-1 - pins.right)!.pinned === "right")
      pins.rightWidth += layout.at(-1 - pins.right++)!.width;
    this.#pins = pins;
  }

  /** The widest a column can be: pinned columns held at the edges leave the others room. */
  #widest(column: Column<S>): number {
    const pinned = pinnedWidth(this.#columns);
    const room = this.#viewWidth;
    if (column.pin === undefined || column.hidden || room <= 0 || !pinsHold(pinned, room))
      return Number.POSITIVE_INFINITY;
    return room - MIN_SCROLLING_WIDTH - (pinned - widthOf(column));
  }

  #scroll(top: number, left: number, quiet = false) {
    const [nextTop, nextLeft] = [this.#clampTop(top), this.#clampLeft(left)];
    const moved = nextTop !== this.#top || nextLeft !== this.#left;
    this.#top = nextTop;
    this.#left = nextLeft;
    this.#remember();
    if (moved && !quiet) this.notify();
  }

  #clampTop(top: number): number {
    const max = this.#display!.length * this.rowHeight - this.#viewHeight;
    return Math.max(0, Math.min(max, top));
  }

  #clampLeft(left: number): number {
    return Math.max(0, Math.min(this.#width - this.#viewWidth, left));
  }

  /** The offsets showing a whole cell, scrolled as little as possible. */
  #revealed(rowIndex: number, columnIndex: number): [number, number] {
    let [top, left] = [this.#top, this.#left];
    if (rowIndex >= 0) {
      const y = rowIndex * this.rowHeight;
      if (y < top) top = y;
      else if (y + this.rowHeight > top + this.#viewHeight)
        top = y + this.rowHeight - this.#viewHeight;
    }
    // Columns held at the edges are always in view; the others scroll between them.
    const column = this.#layout[columnIndex];
    if (column && column.pinned === null) {
      const { leftWidth, rightWidth } = this.#pins;
      if (column.x - leftWidth < left) left = column.x - leftWidth;
      else if (column.x + column.width > left + this.#viewWidth - rightWidth)
        left = column.x + column.width - this.#viewWidth + rightWidth;
    }
    return [top, left];
  }

  /** Remembers the row at the top, to keep it there. */
  #remember() {
    const { length } = this.#display!;
    if (length === 0) {
      this.#anchor = null;
      return;
    }
    const index = Math.min(length - 1, Math.floor(this.#top / this.rowHeight));
    this.#anchor = { ref: this.refAt(index), offset: this.#top - index * this.rowHeight };
  }

  #resolveFocus() {
    const focus = this.#focus;
    if (!focus || !this.#display) return;
    const layout = this.#layout;
    if (layout.length > 0) {
      let index = layout.findIndex(({ id }) => id === focus.column);
      if (index < 0) index = Math.min(focus.columnIndex, layout.length - 1);
      focus.columnIndex = index;
      focus.column = layout[index]!.id;
    }
    if (!focus.row) return;
    const length = this.#display.length;
    if (focus.row === TOTALS) {
      // Kept on the totals row while there is one, wherever rows come and go; else to the last row.
      if (this.totalsRow) {
        focus.rowIndex = length;
        return;
      }
      focus.rowIndex = length - 1;
      focus.row = length > 0 ? this.refAt(length - 1) : null;
      return;
    }
    let index = this.find(focus.row, true);
    if (index < 0 && length > 0) index = Math.min(focus.rowIndex, length - 1);
    focus.rowIndex = index;
    focus.row = index < 0 ? null : this.refAt(index);
  }
}

/** The scales and row encodings a model's looks read, and its totals, as given. */
export interface LookPresentation {
  readonly scales: GridScales | undefined;
  readonly encode: CellEncodings | undefined;
  /** A local model's `RowTotals`, a remote model's aggregates, or null: checked by the model. */
  readonly totals: unknown;
}

/** Sort keys after a header click on `field`: going to `order`, or off without one. */
export function cycled<F extends string>(
  keys: readonly SortKey<F>[],
  field: F | undefined,
  order: "ascending" | "descending" | undefined,
  additive: boolean,
): SortKey<F>[] {
  if (!additive) return order && field !== undefined ? [{ field, order }] : [];
  const next = [...keys];
  if (field === undefined) return next;
  const at = next.findIndex((key) => key.field === field);
  if (at < 0) {
    if (order) next.push({ field, order });
  } else if (order) next[at] = { field, order };
  else next.splice(at, 1);
  return next;
}

/** The order a header click on a field sorted `order` goes to: ascending, descending, then none. */
export function nextOrder(
  keys: readonly SortKey[],
  field: string,
): "ascending" | "descending" | undefined {
  const at = keys.findIndex((key) => key.field === field);
  const current = at < 0 ? undefined : (keys[at]!.order ?? "ascending");
  return current === undefined ? "ascending" : current === "ascending" ? "descending" : undefined;
}

/**
 * Totals as a presentation keeps them: a remote grid's list of aggregates
 * copied, so a caller's later changes reach it only when given again; a
 * local grid's `rowTotals` as given.
 */
function totalsCopied(given: unknown): unknown {
  return Array.isArray(given) ? plain(given) : (given ?? null);
}
