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
  selectWhere,
} from "../data/selection.ts";
import type { Schema, Table } from "../data/table.ts";
import { unmappable } from "../lod/m4.ts";
import { shareSquares } from "../marks/cell-selection.ts";
import { type LayoutMark, tablesOf } from "../marks/layout-mark.ts";
import { DIM, type Mark } from "../marks/mark.ts";
import { offAxis } from "../marks/row-bindings.ts";
import { placeAt, rowOf } from "../marks/series.ts";
import { CLOUD_POINTS } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";
import type { BrushSpec, SelectionGesture } from "../spec/spec.ts";
import type { ChartSelection, ItemSelection, Phase, SeriesSelection } from "../spec/state.ts";
import { shapeOf } from "./bindings.ts";
import { conditionsOf } from "./conditions.ts";
import { GUIDE_KIT } from "./guides.ts";
import { Highlighter, type HighlightKit, highlights } from "./highlight.ts";
import { itemResolver } from "./items.ts";
import {
  kitOf,
  type Reader,
  type Resolution,
  type RouteBinding,
  tablesOf as reaching,
  resolve,
  type SelectionLineage,
} from "./lineage-binding.ts";
import type { LineageRoute } from "./lineage-kit.ts";
import { channelSelection, channelsChosen, type Membership, membershipOf } from "./memberships.ts";
import type { ChangeCause, ChartConfig, ChartModel } from "./model.ts";
import {
  brushedRows,
  clickedOn,
  clickedRows,
  cursorRows,
  type PointRows,
  type SelectionOwner,
  selects,
} from "./selected-rows.ts";

/**
 * The phase of the gesture whose rows a binding is writing: charts hearing
 * the write as another writer's report it (a live brush's previews).
 */
let writingPhase: Phase = "commit";

/** What highlighting draws with: bindings load it with them, squares of cells' selected shares too. */
export const HIGHLIGHT_KIT: HighlightKit = {
  placeAt,
  rowOf,
  unmappable,
  guides: GUIDE_KIT,
  dim: DIM,
  cloudPoints: CLOUD_POINTS,
  squares: shareSquares,
};

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
  /**
   * The channel hears a brush's previews as it is drawn, moved, or resized
   * (one write a frame), and its cancel; by default, what is committed only.
   */
  live?: boolean;
  /**
   * The lineage reader (`import { lineage } from "herceg"`), for a store of
   * a table the chart's marks come from rather than one they draw: a bar
   * of `groupRows(sales, ...)`'s table bound to a store of `sales` draws
   * each group's selected part, and a click on a bar selects its rows of
   * `sales`. Bindings of a table the chart draws need none.
   */
  lineage?: SelectionLineage | undefined;
  /**
   * Bytes the indexes highlighting through lineage may take (coverage of
   * each group, what derived tables keep of their rows); 16 a row of the
   * bound table by default. Past it, the chart is refused, or, when tables
   * grow past it later, stops highlighting and reports it to `onError`.
   */
  budget?: number | undefined;
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
  readonly defaultPrevented: boolean;
  preventDefault(): void;
}

/**
 * What a bound chart lends its row selection: its brushed selection, which
 * `clear` lets go, as a change of the cause that replaced the rows it
 * wrote, and `render`, which draws pending changes before a key reads
 * what the chart shows.
 */
export interface BrushedChart {
  readonly selection: ChartSelection | null;
  clear(cause: ChangeCause): void;
  render(): void;
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
    change: RowSelectionChange & { cause: ChangeCause; revision: number; phase: Phase },
  ): void;
}

/** A binding with its defaults filled in. */
interface Bound extends RouteBinding {
  events: ReadonlySet<SelectionGesture>;
  highlight: boolean;
  live: boolean;
  /** Which rows the channel holds, taken on first read and held as long as the binding. */
  membership?: Membership;
}

/** A binding as a row selection holds it: defaults filled in, the lineage reader and budget as given. */
export type BindingOptions = Readonly<
  Required<Omit<SelectionBinding, "lineage" | "budget">> &
    Pick<SelectionBinding, "lineage" | "budget">
>;

/** The membership of a bound channel, held by the binding from its first read. */
function membershipOfBound(bound: Bound): Membership {
  bound.membership ??= membershipOf(bound.store, bound.channel);
  return bound.membership;
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

/** Identities of stores, which say whether two row selections bind the same ones. */
const storeIds = new WeakMap<SelectionStore, number>();

export class RowSelection {
  readonly bindings: readonly BindingOptions[];
  readonly #bound: readonly Bound[];
  /** How each chart configuration's marks reach the bindings (see `check`). */
  readonly #resolutions = new WeakMap<ChartConfig, Resolution<Bound>>();
  /** The lineage reader, where a binding was given it. */
  readonly #kit;

  constructor(bindings: readonly SelectionBinding[]) {
    if (bindings.length === 0)
      throw refused("rowSelection", "rowSelection: expected a binding, { store, channel }");
    this.bindings = bindings.map(
      (
        { store, channel, events = GESTURES, effect = "highlight", live = false, lineage, budget },
        i,
      ) => {
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
        if (typeof live !== "boolean")
          throw refused(
            `${at}.live`,
            `rowSelection live: expected true or false; received ${JSON.stringify(live)}`,
          );
        if (budget !== undefined && !(budget > 0))
          throw refused(
            `${at}.budget`,
            `rowSelection budget: expected bytes above 0; received ${JSON.stringify(budget)}`,
          );
        return Object.freeze({
          store,
          channel,
          events: Object.freeze([...events]),
          effect,
          live,
          lineage,
          budget,
        });
      },
    );
    this.#bound = this.bindings.map(
      ({ store, channel, events, effect, live, lineage, budget }, i) => ({
        store,
        table: store.source,
        channel,
        events: new Set(events),
        highlight: effect === "highlight",
        live,
        lineage,
        budget,
        at: this.bindings.length > 1 ? `rowSelection[${i}]` : "rowSelection",
      }),
    );
    this.#kit = kitOf(this.#bound.find((b) => b.lineage));
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
    const all = config.marks as readonly unknown[];
    const readerOf = (table: Table, mark: Mark | LayoutMark): Reader => {
      const index = all.indexOf(mark);
      const name = `${mark.spec.type}${index < 0 ? "" : ` (mark ${index})`}`;
      return { table, mark, name, key: (mark.spec as { id?: string }).id ?? index };
    };
    const readers: Reader[] = [
      ...marks.flatMap((mark) => (mark.table ? [readerOf(mark.table, mark)] : [])),
      ...layouts.flatMap((mark) => tablesOf(mark).map((table) => readerOf(table, mark))),
    ];
    const resolution = resolve(this.#bound, readers);
    for (const bound of this.#bound) {
      const routed = (table: Table | undefined) => resolution.get(table!)?.bound === bound;
      for (const mark of marks) {
        const route = resolution.get(mark.table!);
        if (route?.bound !== bound) continue;
        for (const [brush, path] of brushesOver(mark, config))
          if (bound.events.has(brush === "lasso" ? "lasso" : "brush")) {
            refuseBrush(mark, brush, path);
            route.through?.refuse(mark, brush, path);
          }
      }
      // A layout mark reading the table selects its rows and highlights them.
      if (layouts.some((layout) => tablesOf(layout).some(routed))) continue;
      refuseReaders(
        marks.filter((mark) => routed(mark.table)),
        bound,
        bound.at,
      );
    }
    this.#resolutions.set(config, resolution);
  }

  /** How the marks of chart configuration `config` reach the bindings, as `check` found. */
  resolution(config: ChartConfig): Resolution<Bound> {
    return this.#resolutions.get(config) ?? NO_ROUTES;
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
    // Marks of tables reached through lineage draw as the kit says.
    const lineage = this.#kit?.highlight(model, () => this.resolution(model.config));
    const highlighter = new Highlighter(
      HIGHLIGHT_KIT,
      channelsChosen(highlighted),
      lineage?.covered,
    );
    // What no bound channel highlights draws the chart's own selection in its looks.
    const draw: NonNullable<ChartModel["highlight"]> = (mark, series, frame, key, rows) =>
      highlighter.geometry(mark, series, frame, key, rows) ??
      model.looks?.(mark, series, frame, key, rows) ??
      mark.geometry(series, frame, key, rows);
    const layout: NonNullable<ChartModel["layoutHighlight"]> = (table, mark, series) => {
      const selection = channelSelection(highlighted, table);
      const bound = selection && highlighted.find((b) => b.table === table);
      if (bound) return membershipOfBound(bound).selected;
      return lineage?.layout(table) ?? model.layoutLooks?.(table, mark, series);
    };
    model.highlight = draw;
    model.layoutHighlight = layout;
    return () => {
      if (model.highlight === draw) model.highlight = undefined;
      if (model.layoutHighlight === layout) model.layoutHighlight = undefined;
      lineage?.stop();
    };
  }

  /**
   * What the channels chart configuration `config` highlights hold, for its
   * text alternative: "42 of 120 rows selected." (naming each table, for
   * several, or one its marks come from); undefined while none holds a
   * selection. Routes stopped past their budget say so.
   */
  describe(config: ChartConfig): string | undefined {
    const routes = [...this.resolution(config).values()];
    const shown = this.#bound.filter((b) => b.highlight);
    const several = shown.length > 1;
    const held = shown.flatMap((bound) => {
      const { store, table, channel } = bound;
      const selection = store.get(channel);
      // Rows selected before the table was reset are gone: nothing is selected.
      if (!selection || (selection.kind === "rows" && !selection.rows.current)) return [];
      const count = membershipOfBound(bound).count;
      const through = routes.some((route) => route.bound === bound && route.through);
      const name = (several || through) && table.name !== undefined ? ` of ${table.name}` : "";
      return [`${count} of ${table.length} ${table.length === 1 ? "row" : "rows"}${name}`];
    });
    // Routes stopped past their budget say so.
    const text = [held.length > 0 ? `${held.join("; ")} selected.` : ""]
      .concat(routes.map(({ through }) => through?.said ?? ""))
      .filter(Boolean)
      .join(" ");
    return text || undefined;
  }

  /**
   * The row selection of a mounted chart: `current`, the chart's so far,
   * when it is this one's, or else a new one. `events` reports changes of
   * the channels, `invalidate` redraws the chart, `count` counts a change
   * of `cause` the chart did not count and gives its revision, `cursor`
   * says where its keyboard cursor is, and `live` announces what clicks
   * and Space select.
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
    if (current?.selection === this) {
      current.reconcile();
      return current;
    }
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
    // Once the link it replaces is gone, which takes it from the model.
    current?.dispose();
    model.rowLink = link;
    return link;
  }

  /**
   * Framework adapters compare options as JSON: a row selection is the
   * same while it binds the same stores (by identity), channels, events, and effects.
   */
  toJSON(): unknown {
    return this.bindings.map(({ store, channel, events, effect, live, lineage, budget }) => {
      let id = storeIds.get(store);
      if (id === undefined) {
        id = nextStore++;
        storeIds.set(store, id);
      }
      return [id, channel, events, effect, live, lineage !== undefined, budget ?? null];
    });
  }
}

let nextStore = 0;

/** Routes of a configuration no check saw: none. */
const NO_ROUTES: Resolution<Bound> = /* @__PURE__ */ new Map();

/**
 * The brushes drawn over `mark`, with where each is set: in each panel it
 * draws in, the panel's own `interaction.brush` over the chart's.
 */
function brushesOver(mark: Mark, config: ChartConfig): [BrushSpec, string][] {
  const { interaction, panels } = config;
  const shape = shapeOf(interaction?.brush);
  if (!panels) return shape ? [[shape, "interaction.brush"]] : [];
  const found: [BrushSpec, string][] = [];
  for (const [i, { id, interaction: own }] of panels.list.entries()) {
    if (mark.spec.panel !== id && mark.spec.panel !== "*") continue;
    const brush = shapeOf(panels.interactionOf(interaction, id)?.brush);
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
      message: `${unlit.spec.type} rowSelection effect: ${unlit.spec.type === "contour" ? "its bands draw" : "it draws"} no highlight of the rows selected; give effect: "none"`,
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
   * What each channel held when last seen, so each change is reported
   * once. Stores freeze what they hold: a selection seen never changes.
   */
  readonly #seen = new Map<Bound, DataSelection | null>();
  /** What the chart's brush wrote, which clearing the brush clears while the channel still holds it. */
  readonly #brushed = new Map<Bound, DataSelection | null>();
  /**
   * What live channels held before a gesture's first preview, what the
   * brush had written there, and what the previews last wrote there: the
   * gesture's cancel puts back the first where they still hold the last.
   */
  #held = new Map<
    Bound,
    {
      selection: DataSelection | null;
      brushed: DataSelection | null | undefined;
      wrote?: DataSelection | null;
    }
  >();
  readonly #stops: (() => void)[] = [];
  /** The routes gestures last read, of the configuration then. */
  #used: Resolution<Bound> | undefined;
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
        by: { cause: ChangeCause; revision: number | undefined; phase: Phase };
      }
    | undefined;
  #disposed = false;
  /** The bindings clicks and Space write. */
  readonly #clickable: readonly Bound[];

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
    this.#clickable = bound.filter((b) => b.events.has("click"));
    this.#model = model;
    this.#chart = chart;
    this.#events = events;
    this.#invalidate = invalidate;
    this.#count = count;
    this.#cursor = cursor;
    this.#live = live;
    for (const b of bound) this.#seen.set(b, b.store.get(b.channel));
    for (const store of new Set(bound.map((b) => b.store)))
      this.#stops.push(store.subscribe((change) => this.#changed(store, change)));
    // Through lineage, the bound table's changes change coverage though the tables drawn stay the same.
    for (const b of bound) if (b.lineage) this.#stops.push(b.table.subscribe(() => invalidate()));
    this.#stops.push(selection.highlight(model));
  }

  /**
   * What the announcement of a brush or lasso adds: how many rows it
   * wrote (" 214 rows."), where it wrote a set of rows to one channel,
   * which still holds it; undefined where the count is not known (a
   * condition), so that no announcement counts rows.
   */
  countBrushed(): string | undefined {
    const [[bound, wrote] = [], other] = this.#brushed;
    return !other && wrote?.kind === "rows" && holds(bound!, wrote)
      ? ` ${rowsOf(wrote.rows.size)}.`
      : undefined;
  }

  /**
   * Takes over what the brush wrote through the link this one replaces, in
   * channels both bind, so clearing the brush still clears them, and a
   * gesture's previews there, which its cancel still undoes.
   */
  adopt(previous: RowLink): void {
    const sameAs = (b: Bound) =>
      this.#bound.find((own) => own.store === b.store && own.channel === b.channel);
    for (const [b, written] of previous.#brushed) {
      const same = sameAs(b);
      if (same) this.#brushed.set(same, written);
    }
    for (const [b, held] of previous.#held) {
      const same = sameAs(b);
      if (same?.live) this.#held.set(same, held);
    }
    // The replaced link's pending check of another writer's change is this one's now.
    if (this.#brushed.size > 0) queueMicrotask(() => this.#reconcile("sync"));
  }

  /** Whether the brush (or lasso) of panel `key` writes rows, and so never zooms. */
  brushes(key: string | undefined): boolean {
    const brush = shapeOf(this.#model.interactionOf(key)?.brush);
    const gesture = brush === "lasso" ? "lasso" : "brush";
    return brush !== undefined && this.#bound.some((b) => b.events.has(gesture));
  }

  /**
   * The chart's selection changed (a brush in the panels of `owner`, items,
   * or series), by `cause` at `revision` (the chart's count of it): with
   * `write`, writes the rows it covers, or clears what the brush wrote. A
   * gesture's `preview` goes to live bindings only, and its `cancel` puts
   * back there what they held before its first preview, where they still
   * hold what the preview wrote. The changes made, for the `select` event;
   * undefined for none.
   */
  brushed(
    selection: ChartSelection | null,
    owner: SelectionOwner | null,
    write: boolean,
    cause: ChangeCause,
    revision: number,
    phase: Phase = "commit",
  ): Written | undefined {
    // A selection shown without writing (a synced chart's, another view's)
    // replaces the brush: what that wrote is no longer the chart's to clear.
    if (!write) {
      this.#brushed.clear();
      return undefined;
    }
    const commits = phase === "commit";
    const bound = this.#bound.filter(
      (b) => commits || (b.live && (phase === "preview" || this.#holds(b))),
    );
    const held = this.#held;
    if (phase === "preview") {
      for (const b of bound)
        if (!held.has(b))
          held.set(b, { selection: b.store.get(b.channel), brushed: this.#brushed.get(b) });
    } else this.#held = new Map();
    if (phase === "cancel") {
      const back = [...held].filter(([b, { wrote }]) => wrote !== undefined && holds(b, wrote));
      for (const [b, { brushed }] of back)
        if (brushed !== undefined) this.#brushed.set(b, brushed);
        else this.#brushed.delete(b);
      const changes = back.map(([bound, { selection }]) => ({ bound, selection }));
      return written(this.#write(changes, cause, revision, phase));
    }
    // Writes, keeping what a preview wrote, which its gesture's cancel takes back while it is there.
    const apply = (changes: { bound: Bound; selection: DataSelection | null }[]) => {
      if (phase === "preview")
        for (const { bound, selection } of changes) held.get(bound)!.wrote = selection;
      return written(this.#write(changes, cause, revision, phase));
    };
    if (!selection) {
      if (commits) return this.release()(cause, revision);
      const holding = bound.filter((b) => this.#holds(b));
      for (const b of bound) this.#brushed.delete(b);
      return apply(holding.map((b) => ({ bound: b, selection: null })));
    }
    const gesture = selection.kind !== "brush" ? "click" : selection.lasso ? "lasso" : "brush";
    const resolution = this.#resolution;
    // Every table's rows are found before any channel changes: of each
    // table reaching a binding, written as the bound table's.
    const changes = bound.flatMap((b) => {
      if (!b.events.has(gesture)) return [];
      const found: DataSelection[] = [];
      for (const table of reaching(resolution, [b])) {
        const rowsOf = (of: ChartSelection, byField?: Map<string | undefined, number[]>) =>
          of.kind === "brush"
            ? brushedRows(this.#model, table, of, owner, byField)
            : chosenRows(this.#model, table, of);
        const through = this.#checked(resolution.get(table)!.through);
        const rows = through ? through.written(selection, rowsOf) : rowsOf(selection);
        if (rows) found.push(rows);
      }
      // Several tables reach a binding only through lineage, whose reader joins them.
      const rows = found.length > 1 ? kitOf(b)!.join(found, b.table) : found[0];
      return rows ? [{ bound: b, selection: rows }] : [];
    });
    if (commits) this.#brushed.clear();
    for (const { bound, selection } of changes) this.#brushed.set(bound, selection);
    return apply(changes);
  }

  /** Whether a channel holds what the chart's brush last wrote there. */
  #holds(bound: Bound): boolean {
    const wrote = this.#brushed.get(bound);
    return wrote !== undefined && holds(bound, wrote);
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

  /** Whether a binding takes clicks (`events`), which then select rows. */
  get takesClicks(): boolean {
    return this.#clickable.length > 0;
  }

  /**
   * `through`, checked against its budget as tables grew, as highlighting
   * checks it, and reporting through the chart what its walks find as the
   * tables change: bindings that draw nothing (`effect: "none"`) report the
   * refusal once too.
   */
  #checked<T extends LineageRoute | undefined>(through: T): T {
    if (!through) return through;
    through.report = this.#report;
    const refusal = through.check();
    if (refusal) this.#report(refusal);
    return through;
  }

  /** Reports a refusal through the chart, as its draws do. */
  readonly #report = (error: ChartError) => this.#model.report?.(error);

  /** Brings the routes gestures read up to the chart's configuration, letting go of those of one replaced. */
  reconcile(): void {
    void this.#resolution;
  }

  get #resolution(): Resolution<Bound> {
    const now = this.selection.resolution(this.#model.config);
    // What gestures walked through the routes of a configuration replaced goes with it.
    if (this.#used !== now) releaseRoutes(this.#used);
    this.#used = now;
    return now;
  }

  /** The tables whose rows clicks and Space select: those reaching a binding taking clicks. */
  get #clicked(): ReadonlySet<Table> {
    return reaching(this.#resolution, this.#clickable);
  }

  /**
   * Rows found of a table the chart draws as rows of the table bound:
   * themselves, or the bound table's rows behind them (of `field`'s value)
   * through lineage, found now.
   */
  #behind(found: PointRows): PointRows {
    const through = this.#checked(this.#resolution.get(found.table)?.through);
    if (!through) return found;
    return {
      table: through.relation.source,
      rows: through.rows(found.rows, found.field).positions(),
    };
  }

  /**
   * Whether a click at a pixel selects rows, as `clicked` finds them: on
   * an item standing for rows of a table a binding takes clicks on.
   * Undefined when no binding takes clicks. It reads no rows where the
   * layout can say without (`holdsRows`), so the pointer may ask as it moves.
   */
  clicks(px: number, py: number): boolean | undefined {
    if (!this.takesClicks) return undefined;
    const tables = this.#clicked;
    const on = clickedOn(this.#model, tables, px, py);
    if (!on) return false;
    // A point's rows, or an annotation's row, as `clickedRows` reads them.
    if (!("layout" in on)) return on.picked.item.part.kind === "row" || !!on.picked.item.part.point;
    const { key, layout } = on;
    const items = this.#model.items!;
    const drawn = items.result(layout);
    for (const table of tables)
      if (drawn?.holdsRows?.(key, table) ?? items.rowsAt(key, table, layout)) return true;
    return false;
  }

  /**
   * A click at a pixel: what it selects, found now, written when the
   * returned function is called: the rows of the point under it (Shift
   * adds them, Ctrl or Cmd adds or removes them), or a clear of what clicks
   * select when it is over none. The function returns what it wrote, for
   * the `click` event, and what to say of it, which the chart asks once
   * the click's listeners have returned; null on an item that stands for none of
   * the bound tables' rows (a map layer of another table), where nothing
   * changes, the chart's brush neither. Undefined when no binding takes
   * clicks. Rows are kept by identity meanwhile, so a listener that drops
   * rows before the write never makes it select others.
   */
  clicked(px: number, py: number, keys: Modifiers): (() => ClickedRows | null) | undefined {
    const clickable = this.#clickable;
    if (clickable.length === 0) return undefined;
    const hit = clickedRows(this.#model, this.#clicked, px, py);
    const mode = modeOf(keys);
    if (hit === null) return () => null;
    // The rows behind what it is on, as they are as it is clicked.
    const found = hit && this.#behind(hit);
    const kept = found && new RowSet(found.table).addAll(found.rows);
    const rows = () => found && { table: found.table, rows: kept!.positions() };
    return () => this.#picked(rows(), mode, "pointer");
  }

  /**
   * Escape, as the chart's keys take it (dom/interaction.ts) once it ends
   * no gesture and lets no tooltip go: clears what clicks select, as a
   * click off the data does. What it wrote, for the chart to say.
   */
  escape(): ClickedRows {
    return this.#picked(undefined, "only", "keyboard");
  }

  /**
   * Space, as the chart's keys hand it on (dom/interaction.ts) once none
   * of its bindings took it: selects the rows of the point the keyboard
   * cursor is on as a click does (with Shift, Ctrl, or Cmd too), and says
   * them once its listeners have run. Whether it took the key; not one
   * already taken (its default prevented: map and network controls').
   */
  key(event: KeyPress): boolean {
    if (event.defaultPrevented || event.key !== " " || !this.takesClicks || !this.#cursor())
      return false;
    // The cursor is on what the chart shows once pending changes are drawn,
    // as the arrow keys move it.
    this.#chart.render();
    const cursor = this.#cursor();
    const on = cursor && cursorRows(this.#model, this.#clicked, cursor);
    if (!on) return false;
    const found = this.#behind(on);
    event.preventDefault();
    const said = this.#picked(found, modeOf(event), "keyboard").said();
    const live = this.#live;
    if (said) live.textContent = live.textContent === said ? `${said}\u00a0` : said;
    return true;
  }

  /** Whether a channel the chart binds holds rows (a condition may hold any), read without writing. */
  holding(): boolean {
    return !this.#bound.every((b) => empty(b.store.get(b.channel)));
  }

  /**
   * Writes what a click, Space, or Escape selects (`found`; none: off the
   * data, a clear) as `mode` says, saying nothing: what it wrote, and what
   * to say of it, asked once the gesture's listeners have returned.
   */
  #picked(found: PointRows | undefined, mode: Mode, cause: ChangeCause): ClickedRows {
    const held = this.#holding();
    const rows = this.#pick(found, mode, cause);
    const at = this.#clickable.findIndex((b) => b.table === found?.table);
    return { rows, said: () => this.#said(held, at) };
  }

  /**
   * What to say of a write, from what each channel clicks write `held`
   * before it, and the found point's channel (`at`; -1 for a clear), as
   * grids say it: how many rows the point's channel holds ("2 rows
   * selected", "No rows selected"), or "Selection cleared." where it, or
   * for a clear a channel that held rows, holds none; nothing where it
   * holds what it held, or a condition a listener wrote.
   */
  #said(held: readonly (DataSelection | null)[], at: number): string | undefined {
    const now = this.#holding();
    const selected = now[at];
    const count = selected?.kind === "rows" && selected.rows.size;
    let said: string | undefined;
    if (at < 0) {
      if (held.some((was, i) => !empty(was) && empty(now[i]))) said = "Selection cleared.";
    } else if (selected !== held[at])
      said = !selected
        ? "Selection cleared."
        : count
          ? `${rowsOf(count)} selected`
          : count === 0
            ? "No rows selected"
            : undefined;
    return said;
  }

  /** What each channel clicks write holds now. */
  #holding(): (DataSelection | null)[] {
    return this.#clickable.map((b) => b.store.get(b.channel));
  }

  dispose(): undefined {
    this.#disposed = true;
    for (const stop of this.#stops) stop();
    this.#stops.length = 0;
    // What gestures and highlighting through lineage hold goes at once.
    releaseRoutes(this.#used);
    this.#used = undefined;
    // The channels keep what the chart wrote: other views may be showing it.
    this.#brushed.clear();
    if (this.#model.rowLink === this) this.#model.rowLink = undefined;
    return undefined;
  }

  /** Changes the channels clicks write as a click (or key) of `cause` on `found` (none: off the data) does. */
  #pick(found: PointRows | undefined, mode: Mode, cause: ChangeCause): RowSelectionChange[] {
    const clickable = this.#clickable;
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
    phase: Phase = "commit",
  ): RowSelectionChange[] {
    const by = { cause, revision, phase };
    const outer = writingPhase;
    writingPhase = phase;
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
      writingPhase = outer;
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
    // (another chart's, a grid's, the application's, a listener's) is
    // "sync", in the phase of the gesture writing it, if a chart's.
    const own = this.#own;
    const by =
      own?.store === store && own.revision === change.revision
        ? own.by
        : { cause: "sync" as const, revision: undefined, phase: writingPhase };
    for (const bound of this.#bound) {
      if (bound.store !== store || bound.channel !== change.channel) continue;
      // Counted even when a later change heard first already shows what it made.
      by.revision ??= this.#count(by.cause);
      const now = store.get(bound.channel);
      if (now === this.#seen.get(bound)) continue;
      this.#seen.set(bound, now);
      if (bound.highlight) this.#invalidate();
      this.#events.emit("rowSelection", {
        table: bound.table,
        channel: bound.channel,
        selection: now,
        cause: by.cause,
        revision: by.revision,
        phase: by.phase,
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

/**
 * What items or series hold of `table`'s rows, as a channel takes them:
 * their condition where one says it; else the rows their keys name (items
 * named by row identities, layout items by the rows their layout gives
 * them), or of series of a mark of one series or of one per value field,
 * every row; of what marks over views draw, only rows their views show.
 * Null where they hold none of its rows.
 */
function chosenRows(
  model: ChartModel,
  table: Table,
  selection: ItemSelection | SeriesSelection,
): DataSelection | null {
  const condition = conditionsOf(model, selection, null).find((c) => c.table === table);
  if (condition) return selectWhere(condition.condition);
  const marks = model.config.marks as readonly Mark[];
  const keys = (selection.kind === "items" ? selection.items : selection.series) as string[];
  const named = keys.flatMap((key) => {
    // Keys as events give them; others name no mark.
    let parts: unknown[] = [];
    try {
      parts = JSON.parse(key);
    } catch {}
    const mark = marks.find((m, i) => (m.spec.id ?? i) === parts[0]);
    return mark?.table === table ? [{ key, source: parts[1], mark }] : [];
  });
  const rows = new RowSet(table);
  if (selection.kind === "series") {
    if (named.length === 0) return null;
    // Over whole tables, a series of one per value field (or the one) holds every row.
    if (named.every(({ mark }) => !mark.view)) return selectWhere(true);
    for (const { source, mark } of named) {
      const split = mark.wide ? undefined : mark.identity?.field;
      const { codes, dictionary } = split ? table.categories(split as never) : {};
      const code = dictionary?.indexOf(source as string);
      const { indices, length } = mark.view?.read() ?? { length: table.length };
      for (let i = 0; i < length; i++) {
        const row = indices ? indices[i]! : i;
        if (code === undefined || codes![row] === code) rows.add(row);
      }
    }
    return rows.size > 0 ? selectRows(rows) : null;
  }
  const resolver = itemResolver(marks.map((mark, i) => ({ mark, key: mark.spec.id ?? i })));
  for (const key of keys) {
    const laid = model.items?.rowsOfItem(key, table);
    if (laid) for (const of of laid.rows) rows.addAll(of);
    else {
      const view = named.find((entry) => entry.key === key)?.mark.view;
      const of = resolver.rowsOf(key, table);
      rows.addAll(view ? of.filter((row) => view.indexOf(row) >= 0) : of);
    }
  }
  return rows.size > 0 ? selectRows(rows) : null;
}

/** Whether a channel still holds what was written to it. */
function holds(bound: Bound, wrote: DataSelection | null): boolean {
  return bound.store.get(bound.channel) === wrote;
}

/** A count of rows, as announcements say it: "1 row", "214 rows". */
function rowsOf(count: number): string {
  return `${count} ${count === 1 ? "row" : "rows"}`;
}

/**
 * What a click or key wrote to the channels clicks write (`rows`, as the
 * `click` event reports them), and what to say of it, asked once the
 * gesture's listeners have returned (see `RowLink.#said`).
 */
export interface ClickedRows {
  rows: readonly RowSelectionChange[];
  said(): string | undefined;
}

/** Whether a channel holds no rows: nothing, or no rows of a set (a condition may hold any). */
function empty(selection: DataSelection | null | undefined): boolean {
  return !selection || (selection.kind === "rows" && selection.rows.size === 0);
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
  const current = bound.store.get(bound.channel);
  if (current?.kind === "rows") return current.rows.copy();
  const rows = new RowSet(bound.table);
  if (current?.kind === "predicate") {
    const { at } = compileExpression(current.expression, bound.table);
    const matching: number[] = [];
    for (let row = 0; row < bound.table.length; row++) if (at(row) === true) matching.push(row);
    rows.addAll(matching);
  }
  return rows;
}

/** Lets go of what a resolution's routes through lineage hold. */
function releaseRoutes(resolution: Resolution<Bound> | undefined): void {
  for (const route of resolution?.values() ?? []) route.through?.release();
}
