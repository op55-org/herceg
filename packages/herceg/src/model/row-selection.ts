// Row selection: a chart bound to channels of selection stores writes the
// rows its brushes, lassos, and clicks select there, and highlights the
// rows each channel holds, whoever selected them (another chart, a grid).
// The chart's own selection (`chart.selection`, the `select` event) stays
// in data values as before; this adds the rows it covers. Which rows a
// gesture selects is selected-rows.ts's; how they are drawn, highlight.ts's.

import { compileExpression } from "../data/expression.ts";
import { RowSet } from "../data/row-set.ts";
import {
  type DataSelection,
  type SelectionChange,
  type SelectionStore,
  selectRows,
} from "../data/selection.ts";
import type { Schema, Table } from "../data/table.ts";
import { type LayoutMark, tablesOf } from "../marks/layout-mark.ts";
import type { Mark } from "../marks/mark.ts";
import { offAxis } from "../marks/row-bindings.ts";
import { ChartError } from "../spec/errors.ts";
import type { BrushSpec, SelectionGesture } from "../spec/spec.ts";
import { Highlighter, highlights, membership } from "./highlight.ts";
import type { ChangeCause, ChartConfig, ChartModel } from "./model.ts";
import {
  type Brushed,
  brushedRows,
  clickedRows,
  cursorRows,
  type PointRows,
  type SelectionOwner,
  selects,
} from "./selected-rows.ts";

/** A chart's binding to a channel of a table's selection store. */
export interface SelectionBinding<S extends Schema = Schema> {
  /** The store of the table whose rows the chart selects and highlights. */
  store: SelectionStore<S>;
  /** The store's channel the chart writes its selections to and highlights. */
  channel: string;
  /**
   * The gestures that write to the channel: all three by default; none
   * (`[]`) for a chart that only highlights. Brushes and lassos write where
   * `interaction.brush` draws them, and a brush that writes rows never zooms.
   */
  events?: readonly SelectionGesture[];
  /** "highlight" (the default) dims the rows the channel does not hold; "none" leaves them. */
  effect?: "highlight" | "none";
}

/**
 * What a chart wrote to a channel of a store it is bound to, or found
 * there: the table, the channel, and the selection, null when cleared.
 */
export interface RowSelectionChange {
  table: Table;
  channel: string;
  selection: DataSelection | null;
}

/** The modifier keys of a click or key press, as DOM events carry them. */
export interface Modifiers {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** A key press, as DOM keyboard events carry it. */
export interface KeyPress extends Modifiers {
  readonly key: string;
  readonly target: unknown;
  preventDefault(): void;
}

/**
 * What a bound chart lends its row selection: its brushed selection, which
 * `clear` lets go, as a change of the cause that replaced the rows it
 * wrote, its root element, whose keys select rows under the keyboard
 * cursor, and `render`, which draws pending changes before a key reads
 * what the chart shows.
 */
export interface BrushedChart {
  readonly selection: Brushed | null;
  clear(cause: ChangeCause): void;
  render(): void;
  readonly root: {
    addEventListener(type: "keydown", listener: (event: KeyPress) => void): void;
    removeEventListener(type: "keydown", listener: (event: KeyPress) => void): void;
  };
}

/** Where the keyboard cursor is: a panel, a series' key, and a position in the series' part there. */
export interface Cursor {
  readonly panel: string;
  readonly key: string;
  readonly position: number;
}

/** Reports changes of the bound channels as a chart's `rowSelection` events. */
interface Reporter {
  emit(
    type: "rowSelection",
    change: RowSelectionChange & { cause: ChangeCause; revision: number },
  ): void;
}

/** A binding with its defaults filled in. */
interface Bound {
  store: SelectionStore;
  table: Table;
  channel: string;
  events: ReadonlySet<SelectionGesture>;
  highlight: boolean;
}

const GESTURES: readonly SelectionGesture[] = ["brush", "lasso", "click"];

/**
 * Binds a chart to channels of selection stores, one per table its marks
 * read, for the chart's `rowSelection` option. A brush selects the rows
 * whose values are in its ranges, as a condition that rows appended later
 * meet or not; lassos and clicks select rows (a click on a histogram bin,
 * the rows it counts). The chart dims the rows the channel does not hold.
 *
 * ```ts
 * const focus = selectionStore(trips);
 * createChart(a, {
 *   marks: [point(trips, { x: "distance", y: "fare" })],
 *   interaction: { brush: "xy" },
 *   rowSelection: rowSelection({ store: focus, channel: "focus" }),
 * });
 * createGrid(b, { data: rowView(trips), columns, selection: focus, channel: "focus" });
 * ```
 */
export function rowSelection<const S extends readonly Schema[]>(
  ...bindings: { [K in keyof S]: SelectionBinding<S[K]> }
): RowSelection {
  // Each table's schema types its own binding; the chart reads them alike.
  return new RowSelection(bindings as unknown as readonly SelectionBinding[]);
}

/** How many rows each membership holds, counted once: descriptions are read every frame. */
const counts = new WeakMap<Uint8Array, number>();

/** Identities of stores, which say whether two row selections bind the same ones. */
const storeIds = new WeakMap<SelectionStore, number>();

export class RowSelection {
  readonly bindings: readonly Readonly<Required<SelectionBinding>>[];
  readonly #bound: readonly Bound[];

  constructor(bindings: readonly SelectionBinding[]) {
    if (bindings.length === 0)
      throw refused("rowSelection", "rowSelection: expected a binding, { store, channel }");
    this.bindings = bindings.map(
      ({ store, channel, events = GESTURES, effect = "highlight" }, i) => {
        // Paths as the spec's: a binding's index among several.
        const at = bindings.length > 1 ? `rowSelection[${i}]` : "rowSelection";
        if (typeof store?.get !== "function" || !store.source)
          throw refused(
            `${at}.store`,
            "rowSelection store: expected a SelectionStore, from selectionStore(table)",
          );
        if (typeof channel !== "string" || channel === "")
          throw refused(
            `${at}.channel`,
            `rowSelection channel: expected a name; received ${JSON.stringify(channel)}`,
          );
        for (const event of events)
          if (!GESTURES.includes(event))
            throw refused(
              `${at}.events`,
              `rowSelection events: expected "brush", "lasso", or "click"; received ${JSON.stringify(event)}`,
            );
        if (effect !== "highlight" && effect !== "none")
          throw refused(
            `${at}.effect`,
            `rowSelection effect: expected "highlight" or "none"; received ${JSON.stringify(effect)}`,
          );
        return Object.freeze({ store, channel, events: Object.freeze([...events]), effect });
      },
    );
    this.#bound = this.bindings.map(({ store, channel, events, effect }) => ({
      store,
      table: store.source,
      channel,
      events: new Set(events),
      highlight: effect === "highlight",
    }));
    const tables = this.#bound.map(({ table }) => table);
    if (tables.some((table, i) => tables.indexOf(table) !== i))
      throw refused(
        "rowSelection",
        "rowSelection: binds each table once; give one store and channel per table",
      );
  }

  /**
   * Refuses charts whose rows cannot be selected yet: layout marks other
   * than maps, pies, funnels, trees, Sankey diagrams, and networks (gauges,
   * radars, 3D charts), stores of tables no mark reads, and brushes along an
   * axis of statistics (a histogram's counts, a box plot's values) or
   * lassos over them.
   */
  check(config: ChartConfig, marks: readonly Mark[], layouts: readonly LayoutMark[]): void {
    const layout = layouts.find((mark) => !mark.selects);
    if (layout)
      throw new ChartError({
        code: "unsupported",
        path: "rowSelection",
        // A 3D chart's layers draw as one mark, named by the first one's type.
        message: `${(layout.layers?.[0] ?? layout).spec.type} rowSelection: cannot select rows yet; select them in a chart of the same table along x and y, linked by the store`,
      });
    const read = [...layouts.flatMap(tablesOf), ...marks.map((mark) => mark.table)];
    for (const [i, bound] of this.#bound.entries()) {
      if (!read.includes(bound.table))
        throw refused(
          "rowSelection",
          `rowSelection store: no mark reads its table (channel "${bound.channel}"); bind a table the chart draws`,
        );
      for (const mark of marks)
        if (mark.table === bound.table)
          for (const [brush, path] of brushesOver(mark, config))
            if (bound.events.has(brush === "lasso" ? "lasso" : "brush"))
              refuseBrush(mark, brush, path);
      // A layout mark reading the table selects its rows and highlights them.
      if (layouts.some((layout) => tablesOf(layout).includes(bound.table))) continue;
      const readers = marks.filter((mark) => mark.table === bound.table);
      const at = this.#bound.length > 1 ? `rowSelection[${i}]` : "rowSelection";
      refuseReaders(readers, bound, at);
    }
  }

  /**
   * Draws `model`'s scenes with the rows the bound channels hold
   * highlighted, for the bindings whose `effect` is "highlight": a mounted
   * chart's (see `mount`) and static exports' alike, which read the stores
   * as they are when drawn. Returns what undoes it.
   */
  highlight(model: ChartModel): () => void {
    const highlighted = this.#bound.filter((b) => b.highlight);
    if (highlighted.length === 0) return () => {};
    const highlighter = new Highlighter(highlighted);
    const draw: NonNullable<ChartModel["highlight"]> = (mark, series, frame, key, rows) =>
      highlighter.geometry(mark, series, frame, key, rows) ??
      mark.geometry(series, frame, key, rows);
    const layout = (table: Table) => highlighter.selected(table);
    model.highlight = draw;
    model.layoutHighlight = layout;
    return () => {
      if (model.highlight === draw) model.highlight = undefined;
      if (model.layoutHighlight === layout) model.layoutHighlight = undefined;
    };
  }

  /**
   * What the channels the chart highlights hold, for its text alternative:
   * "42 of 120 rows selected." (naming each table, for several); undefined
   * while none holds a selection.
   */
  get description(): string | undefined {
    const shown = this.#bound.filter((b) => b.highlight);
    const several = shown.length > 1;
    const held = shown.flatMap(({ store, table, channel }) => {
      const selection = store.get(channel);
      // Rows selected before the table was reset are gone: nothing is selected.
      if (!selection || (selection.kind === "rows" && !selection.rows.current)) return [];
      const selected = membership(table, selection);
      let count = counts.get(selected);
      if (count === undefined) {
        count = 0;
        for (let row = 0; row < selected.length; row++) count += selected[row]!;
        counts.set(selected, count);
      }
      const name = several && table.name !== undefined ? ` of ${table.name}` : "";
      return [`${count} of ${table.length} ${table.length === 1 ? "row" : "rows"}${name}`];
    });
    return held.length > 0 ? `${held.join("; ")} selected.` : undefined;
  }

  /**
   * The row selection of a mounted chart: `current`, the chart's so far,
   * when it is this one's, or else a new one. `events` reports changes of
   * the channels, `invalidate` redraws the chart, `count` counts a change
   * of `cause` the chart did not count and gives its revision, `cursor`
   * says where its keyboard cursor is, and `live` announces what the
   * keyboard selected.
   */
  mount(
    current: RowLink | undefined,
    model: ChartModel,
    chart: BrushedChart,
    events: Reporter,
    invalidate: () => void,
    count: (cause: ChangeCause) => number,
    cursor: () => Cursor | null,
    live: { textContent: string | null },
  ): RowLink {
    if (current?.selection === this) return current;
    const link = new RowLink(
      this,
      this.#bound,
      model,
      chart,
      events,
      invalidate,
      count,
      cursor,
      live,
    );
    if (current) link.adopt(current);
    current?.dispose();
    return link;
  }

  /**
   * Framework adapters compare options as JSON: a row selection is the
   * same while it binds the same stores (by identity), channels, events, and effects.
   */
  toJSON(): unknown {
    return this.bindings.map(({ store, channel, events, effect }) => {
      let id = storeIds.get(store);
      if (id === undefined) {
        id = nextStore++;
        storeIds.set(store, id);
      }
      return [id, channel, events, effect];
    });
  }
}

let nextStore = 0;

/**
 * The brushes drawn over `mark`, with where each is set: in each panel it
 * draws in, the panel's own `interaction.brush` over the chart's.
 */
function brushesOver(mark: Mark, config: ChartConfig): [BrushSpec, string][] {
  const { interaction, panels } = config;
  if (!panels) return interaction?.brush ? [[interaction.brush, "interaction.brush"]] : [];
  const found: [BrushSpec, string][] = [];
  for (const [i, { id, interaction: own }] of panels.list.entries()) {
    if (mark.spec.panel !== id && mark.spec.panel !== "*") continue;
    const brush = panels.interactionOf(interaction, id)?.brush;
    if (brush)
      found.push([brush, own?.brush ? `${panels.path(i)}.interaction.brush` : "interaction.brush"]);
  }
  return found;
}

/** Brushes along an axis of a summary's statistics, and lassos over summaries, select no rows yet. */
function refuseBrush(mark: Mark, brush: BrushSpec, path: string) {
  const type = mark.spec.type;
  const refuse = (problem: string) =>
    new ChartError({
      code: "unsupported",
      path,
      message: `${type} brush: ${problem}`,
    });
  if (brush === "lasso" && mark.summarizes)
    throw refuse(`lassos cannot select its rows yet; leave "lasso" out of rowSelection events`);
  // A rug's ticks have a place along their own axis only.
  if (type === "rug") {
    const other = mark.tooltip === "x" ? "y" : "x";
    if (brush === other || brush === "xy")
      throw refuse(`its ticks have no ${other} value; brush along ${mark.tooltip} only`);
  }
  // Rows placed off an axis (in a frame, on a scale of the chart's own) hold none of its values.
  for (const axis of ["x", "y"] as const)
    if (offAxis(mark.bound, axis) && (brush === axis || brush === "xy"))
      throw refuse(
        `its ${axis} is not on the ${axis} axis, whose values a brush selects by; ${brush === "xy" ? `brush along ${axis === "x" ? "y" : "x"} only` : "lasso its rows"}, or place ${axis} on the axis`,
      );
  // Cells of a 2D histogram place their rows along x and y both.
  if (!mark.summarizes || mark.tooltip === "cell") return;
  // A summary's values axis holds statistics: a histogram's counts, a box plot's quartiles.
  const values = mark.tooltip === "y" ? "x" : "y";
  if (brush === values || brush === "xy")
    throw refuse(
      `its ${values} axis holds statistics; brush along ${values === "y" ? "x" : "y"} only`,
    );
}

/**
 * Refuses a binding (at `at`) of a table only marks read whose rows
 * gestures do not select (annotations, a dendrogram's merges), only
 * contours read for clicks, or nothing reading it draws highlighted.
 */
function refuseReaders(readers: readonly Mark[], bound: Bound, at: string) {
  const unselected = readers.filter((mark) => !selects(mark));
  const [first] = unselected;
  if (first && unselected.length === readers.length) {
    const type = first.spec.type;
    throw new ChartError({
      code: "unsupported",
      path: at,
      message:
        type === "dendrogram"
          ? "dendrogram rowSelection: its rows are merges of clusters, which gestures do not select; bind the table of the heatmap it orders"
          : `${type} rowSelection: ${["rule", "region", "text"].includes(type) ? "annotations do not select their rows yet" : "cannot select rows yet"}; bind the table of a mark that draws its rows as data, such as points`,
    });
  }
  if (bound.events.has("click") && readers.every((mark) => mark.spec.type === "contour"))
    throw new ChartError({
      code: "unsupported",
      path: `${at}.events`,
      message:
        'contour rowSelection events: its bands summarize the grid, whose rows a click does not select; give events: ["brush"], and brush a range of x or y',
    });
  const unlit = readers.find((mark) => !highlights(mark));
  if (bound.highlight && unlit && !readers.some(highlights))
    throw new ChartError({
      code: "unsupported",
      path: `${at}.effect`,
      message: `${unlit.spec.type} rowSelection effect: ${unlit.spec.type === "contour" ? "its bands draw" : "custom marks draw their own geometry, with"} no highlight of the rows selected; give effect: "none"`,
    });
}

/** A binding the chart refuses, at `path`. */
function refused(path: string, message: string): ChartError {
  return new ChartError({ code: "invalid-option", path, message });
}

/** How a click or key changes a channel: select only what it is on, add it, or add it or take it out. */
type Mode = "only" | "add" | "toggle";

function modeOf(keys: Modifiers): Mode {
  return keys.shiftKey ? "add" : keys.ctrlKey || keys.metaKey ? "toggle" : "only";
}

/**
 * A mounted chart's row selection: it writes what the chart's gestures
 * select to the bound channels and redraws the chart when a channel it
 * highlights changes. The chart calls it as gestures end.
 */
export class RowLink {
  readonly selection: RowSelection;
  readonly #bound: readonly Bound[];
  readonly #model: ChartModel;
  readonly #chart: BrushedChart;
  readonly #events: Reporter;
  readonly #invalidate: () => void;
  readonly #count: (cause: ChangeCause) => number;
  readonly #cursor: () => Cursor | null;
  readonly #live: { textContent: string | null };
  /**
   * What each channel held when last seen, and its row set's version, so
   * each change is reported once, also of a set changed in place.
   */
  readonly #seen = new Map<Bound, { selection: DataSelection | null; version: number }>();
  /**
   * What the chart's brush wrote, and its row set's version, which clearing
   * the brush clears while the channel still holds it, unchanged.
   */
  readonly #brushed = new Map<Bound, ReturnType<typeof seen>>();
  readonly #stops: (() => void)[] = [];
  /** How deep in writes of the chart's own selections, which leave its brush in place. */
  #writing = 0;
  /**
   * The chart's own write in progress: the store and the revision its
   * change takes there, by whom, and the chart's revision of it (its count
   * of the selection that wrote it, or counted as the change is heard:
   * clicks, keys). Only that change is the chart's; others heard meanwhile
   * (a listener's) are their own.
   */
  #own:
    | {
        store: SelectionStore;
        revision: number;
        by: { cause: ChangeCause; revision: number | undefined };
      }
    | undefined;
  #disposed = false;

  constructor(
    selection: RowSelection,
    bound: readonly Bound[],
    model: ChartModel,
    chart: BrushedChart,
    events: Reporter,
    invalidate: () => void,
    count: (cause: ChangeCause) => number,
    cursor: () => Cursor | null,
    live: { textContent: string | null },
  ) {
    this.selection = selection;
    this.#bound = bound;
    this.#model = model;
    this.#chart = chart;
    this.#events = events;
    this.#invalidate = invalidate;
    this.#count = count;
    this.#cursor = cursor;
    this.#live = live;
    for (const b of bound) this.#seen.set(b, seen(b.store.get(b.channel)));
    for (const store of new Set(bound.map((b) => b.store)))
      this.#stops.push(store.subscribe((change) => this.#changed(store, change)));
    // After the chart's own key handling, which moves the cursor and clears its brush on Escape.
    const keys = (event: KeyPress) => this.#key(event);
    chart.root.addEventListener("keydown", keys);
    this.#stops.push(() => chart.root.removeEventListener("keydown", keys));
    this.#stops.push(selection.highlight(model));
  }

  /**
   * Takes over what the brush wrote through the link this one replaces, in
   * channels both bind, so clearing the brush still clears them.
   */
  adopt(previous: RowLink): void {
    for (const [b, written] of previous.#brushed) {
      const same = this.#bound.find((own) => own.store === b.store && own.channel === b.channel);
      if (same) this.#brushed.set(same, written);
    }
    // The replaced link's pending check of another writer's change is this one's now.
    if (this.#brushed.size > 0) queueMicrotask(() => this.#reconcile("sync"));
  }

  /** Whether the brush (or lasso) of panel `key` writes rows, and so never zooms. */
  brushes(key: string | undefined): boolean {
    const brush = this.#model.interactionOf(key)?.brush;
    const gesture = brush === "lasso" ? "lasso" : "brush";
    return brush !== undefined && this.#bound.some((b) => b.events.has(gesture));
  }

  /**
   * The chart's brushed selection changed, in the panels of `owner`
   * (every panel's, for null), by `cause` at `revision` (the chart's
   * count of it): with `write`, writes the rows it covers, or clears what
   * the brush wrote. The changes made, for the `select` event; undefined
   * for none.
   */
  brushed(
    selection: Brushed | null,
    owner: SelectionOwner | null,
    write: boolean,
    cause: ChangeCause,
    revision: number,
  ): Written | undefined {
    // A selection shown without writing (a synced chart's, another view's)
    // replaces the brush: what that wrote is no longer the chart's to clear.
    if (!write) {
      this.#brushed.clear();
      return undefined;
    }
    if (!selection) return this.release()(cause, revision);
    const gesture = selection.lasso ? "lasso" : "brush";
    // Every table's rows are found before any channel changes.
    const changes = this.#bound.flatMap((bound) => {
      if (!bound.events.has(gesture)) return [];
      const rows = brushedRows(this.#model, bound.table, selection, owner);
      return rows ? [{ bound, selection: rows }] : [];
    });
    this.#brushed.clear();
    for (const { bound, selection } of changes) this.#brushed.set(bound, seen(selection));
    return written(this.#write(changes, cause, revision));
  }

  /**
   * Lets the brush go, and gives what clears the rows it wrote from the
   * channels still holding them when called (not those a later selection
   * wrote since), as a change of `cause` at `revision`: the changes made.
   */
  release(): (cause: ChangeCause, revision: number) => Written | undefined {
    const taken = new Map(this.#brushed);
    this.#brushed.clear();
    return (cause, revision) => {
      const changes: RowSelectionChange[] = [];
      // Each as its turn comes: a listener of a clear before may have written it since.
      for (const [bound, wrote] of taken)
        if (holds(bound, wrote))
          changes.push(...this.#write([{ bound, selection: null }], cause, revision));
      return written(changes);
    };
  }

  /**
   * A click at a pixel: what it selects, found now, written when the
   * returned function is called: the rows of the point under it (Shift
   * adds them, Ctrl or Cmd adds or removes them), or a clear of what clicks
   * select when it is over none. The function returns the changes made,
   * for the `click` event, and null on an item that stands for none of
   * the bound tables' rows (a map layer of another table), where nothing
   * changes, the chart's brush neither. Undefined when no binding takes
   * clicks. Rows are kept by identity meanwhile, so a listener that drops
   * rows before the write never makes it select others.
   */
  clicked(px: number, py: number, keys: Modifiers): (() => Written | null) | undefined {
    const clickable = this.#bound.filter((b) => b.events.has("click"));
    if (clickable.length === 0) return undefined;
    const tables = new Set(clickable.map((b) => b.table));
    const found = clickedRows(this.#model, tables, px, py);
    const mode = modeOf(keys);
    if (found === null) return () => null;
    const kept = found && new RowSet(found.table).addAll(found.rows);
    const rows = () => found && { table: found.table, rows: kept!.positions() };
    return () => ({ rows: this.#pick(clickable, rows(), mode, "pointer") });
  }

  /**
   * Keys of the chart, after its own handling: Space selects the rows of
   * the point the keyboard cursor is on as a click does (with Shift, Ctrl,
   * or Cmd too) and announces how many are selected; Escape clears what
   * clicks select.
   */
  #key(event: KeyPress) {
    const clickable = this.#bound.filter((b) => b.events.has("click"));
    if (event.target !== this.#chart.root || clickable.length === 0) return;
    if (event.key === "Escape") {
      this.#pick(clickable, undefined, "only", "keyboard");
      return;
    }
    if (event.key !== " " || !this.#cursor()) return;
    // The cursor is on what the chart shows once pending changes are drawn,
    // as the arrow keys move it.
    this.#chart.render();
    const cursor = this.#cursor();
    const tables = new Set(clickable.map((b) => b.table));
    const found = cursor && cursorRows(this.#model, tables, cursor);
    if (!found) return;
    event.preventDefault();
    const [change] = this.#pick(clickable, found, modeOf(event), "keyboard");
    const selected = change?.selection;
    const count = selected?.kind === "rows" ? selected.rows.size : 0;
    // As grids say it.
    this.#live.textContent = `${count} ${count === 1 ? "row" : "rows"} selected`;
  }

  dispose(): undefined {
    this.#disposed = true;
    for (const stop of this.#stops) stop();
    this.#stops.length = 0;
    // The channels keep what the chart wrote: other views may be showing it.
    this.#brushed.clear();
    return undefined;
  }

  /** Changes the channels clicks write as a click (or key) of `cause` on `found` (none: off the data) does. */
  #pick(
    clickable: readonly Bound[],
    found: PointRows | undefined,
    mode: Mode,
    cause: ChangeCause,
  ): RowSelectionChange[] {
    if (!found) {
      // Off the data, a plain click clears; with a modifier, it changes nothing.
      if (mode !== "only") return [];
      const holding = clickable.filter((b) => b.store.get(b.channel) !== null);
      return this.#write(
        holding.map((bound) => ({ bound, selection: null })),
        cause,
      );
    }
    const bound = clickable.find((b) => b.table === found.table)!;
    const rows = mode === "only" ? new RowSet(found.table) : held(bound);
    if (mode === "toggle" && found.rows.every((row) => rows.has(row)))
      for (const row of found.rows) rows.delete(row);
    else rows.addAll(found.rows);
    return this.#write([{ bound, selection: selectRows(rows) }], cause);
  }

  /**
   * Writes selections to their channels, as a change of `cause` the chart
   * counted at `revision` (or counts as it is heard); the changes.
   */
  #write(
    changes: readonly { bound: Bound; selection: DataSelection | null }[],
    cause: ChangeCause,
    revision?: number,
  ): RowSelectionChange[] {
    const by = { cause, revision };
    this.#writing++;
    try {
      for (const { bound, selection } of changes) {
        const outer = this.#own;
        this.#own = { store: bound.store, revision: bound.store.revision + 1, by };
        try {
          bound.store.set(bound.channel, selection);
        } finally {
          this.#own = outer;
        }
      }
    } finally {
      this.#writing--;
    }
    // A listener may have replaced what the brush wrote while it was written.
    if (this.#writing === 0) this.#reconcile(cause);
    return changes.map(({ bound, selection }) => ({
      table: bound.table,
      channel: bound.channel,
      selection,
    }));
  }

  /**
   * A store's channel changed (`change`): counts the change once and, where
   * a channel it binds now holds something else than last reported, reports
   * it and redraws the chart for those it highlights. When another writer
   * replaced every selection the chart's brush wrote, the brush goes too:
   * it no longer shows the channels' selection.
   */
  #changed(store: SelectionStore, change: SelectionChange) {
    // The chart's own write reports its cause and revision; any other
    // (another chart's, a grid's, the application's, a listener's) is "sync".
    const own = this.#own;
    const by =
      own?.store === store && own.revision === change.revision
        ? own.by
        : { cause: "sync" as const, revision: undefined };
    for (const bound of this.#bound) {
      if (bound.store !== store || bound.channel !== change.channel) continue;
      // Counted even when a later change heard first already shows what it made.
      by.revision ??= this.#count(by.cause);
      const now = seen(store.get(bound.channel));
      const before = this.#seen.get(bound);
      if (now.selection === before?.selection && now.version === before.version) continue;
      this.#seen.set(bound, now);
      if (bound.highlight) this.#invalidate();
      this.#events.emit("rowSelection", {
        table: bound.table,
        channel: bound.channel,
        selection: now.selection,
        cause: by.cause,
        revision: by.revision,
      });
    }
    // Another writer's change is checked once it has been reported and
    // shown: a view showing that writer's brush lets its own go first.
    if (this.#writing === 0) queueMicrotask(() => this.#reconcile("sync"));
  }

  /** Lets the brush go once no channel holds what it wrote, as a change of `cause`, which replaced it. */
  #reconcile(cause: ChangeCause) {
    if (this.#disposed || this.#brushed.size === 0 || !this.#chart.selection) return;
    const kept = [...this.#brushed].some(([b, written]) => holds(b, written));
    if (kept) return;
    this.#brushed.clear();
    this.#chart.clear(cause);
  }
}

/** A channel's selection as last seen, with its row set's version. */
function seen(selection: DataSelection | null) {
  return { selection, version: selection?.kind === "rows" ? selection.rows.version : -1 };
}

/** Whether a channel still holds what was written to it, its rows unchanged since. */
function holds(bound: Bound, wrote: ReturnType<typeof seen>): boolean {
  const now = seen(bound.store.get(bound.channel));
  return now.selection === wrote.selection && now.version === wrote.version;
}

/** What a gesture wrote, as its event reports it: undefined when it wrote nothing. */
interface Written {
  rows: readonly RowSelectionChange[];
}

function written(rows: readonly RowSelectionChange[]): Written | undefined {
  return rows.length > 0 ? { rows } : undefined;
}

/** A copy of what a channel holds as rows: a condition's rows as they are now. */
function held(bound: Bound): RowSet {
  const rows = new RowSet(bound.table);
  const current = bound.store.get(bound.channel);
  if (current?.kind === "rows") rows.addAll(current.rows.positions());
  else if (current?.kind === "predicate") {
    const { at } = compileExpression(current.expression, bound.table);
    const matching: number[] = [];
    for (let row = 0; row < bound.table.length; row++) if (at(row) === true) matching.push(row);
    rows.addAll(matching);
  }
  return rows;
}
