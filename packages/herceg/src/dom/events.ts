// Events a chart emits to the application.

import type { Table } from "../data/table.ts";
import type { SelectionCondition } from "../model/conditions.ts";
import type { ItemChanges } from "../model/item-views.ts";
import type { PanelVisibility } from "../model/legend.ts";
import type { ChangeCause, Inspection, ViewReport } from "../model/model.ts";
import type { Provenance } from "../model/provenance.ts";
import type { RowSelectionChange } from "../model/row-selection.ts";
import type { ChartError } from "../spec/errors.ts";
import type {
  ChartSelection,
  DrillState,
  Phase,
  PinTarget,
  ViewportState,
  VisibilityState,
} from "../spec/state.ts";
import type { ScaleInstance, SelectionOwner } from "./handle.ts";
import { report } from "./scheduler.ts";

export type { SelectionCondition } from "../model/conditions.ts";
export type { PanelVisibility } from "../model/legend.ts";
export type { ChangeCause, PanelViewport, ScaleView } from "../model/model.ts";
export type { Provenance, ProvenanceGroup, SourceCondition } from "../model/provenance.ts";

/**
 * An opaque name of one chart's state as one of its reports saw it (each
 * state event's `basis`, and `chart.basis` now), for conditional writes:
 * charts with state support (`herceg/state`) report it.
 */
export type Basis = string & { readonly __basis: unique symbol };

/**
 * A write that applies only if the state it writes, where it writes it (a
 * panel's view, the chart's selection), has not changed since the report
 * whose `basis` is `expected` (a chart's creation counts as a change):
 * otherwise it changes nothing and the state is reported again, with
 * cause "api". So an answer that took time (a server's, a Streamlit
 * rerun's) never undoes what the user did meanwhile. A basis of another
 * chart, or of one since destroyed, is refused. It needs state support
 * (`herceg/state`), as bases do.
 */
export interface Conditional {
  expected?: Basis | undefined;
}

/**
 * Where the pointer is, unsnapped: in pixels, and in data on the axes of
 * the panel it is over, read from the scales (no data is read).
 */
export interface Pointer {
  /** CSS pixels from the chart root's top left corner. */
  readonly x: number;
  readonly y: number;
  /**
   * The panel it is over: its key ("" in a chart of one panel), whose plot
   * holds it, or in a chart of one panel, the panel wherever it is;
   * undefined over no panel.
   */
  readonly panel: string | undefined;
  /** Whether it is inside that panel's plot. */
  readonly inPlot: boolean;
  /**
   * Its values on the panel's axes: numbers, epoch ms on time axes, a
   * fractional band index on category axes; a map's or network's plane
   * units. Axes the panel lacks are left out.
   */
  readonly values: { readonly x?: number; readonly y?: number; readonly yRight?: number };
  /** On category axes, the category whose band it is in, by name. */
  readonly categories: { readonly x?: string; readonly y?: string; readonly yRight?: string };
}

/** A box in CSS pixels from the chart root's top left corner. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A mark's item under the pointer or keyboard cursor: a bar, a point, a line's observation, a cell, a slice. */
export interface ItemTarget {
  readonly kind: "item";
  /** The mark's index in the chart's `marks`, and its `id`. */
  readonly mark: number;
  readonly markId: string | undefined;
  /** The item's key: the same for the same item in every frame, as long as its name lasts. */
  readonly item: string;
  /** Its series' key, as the legend and visibility name it; undefined for items of no series. */
  readonly series: string | undefined;
  /**
   * Its row's position in the mark's table, read when asked from the row
   * the input picked (so rows a listener drops never make it name another
   * row); undefined for items of no one row, or once the row is gone.
   */
  readonly row: number | undefined;
  /** The panel it is drawn in ("" in a chart of one panel). */
  readonly panel: string;
  /** Where it is drawn: its box; a line's observation or a layout item, its point. */
  readonly box: Box;
  /**
   * What it stands for in its data (see `Provenance`), as the input found
   * it: on clicks, Enter, and secondary presses; never on hover.
   */
  readonly provenance?: Provenance | undefined;
  /**
   * The rows of its table it stands for, taken as the input found them and
   * read when called: its row; every row sharing its `itemKey` value, or
   * its bar's position in its series; an aggregate's or a layout item's
   * rows; each within its panel and its mark's view. Rows dropped since
   * are left out, and after a reset there are none. On clicks, Enter, and
   * secondary presses of items of a table; never on hover.
   */
  readonly rows?: () => { readonly table: Table; readonly positions: Uint32Array };
}

/** A tick label of an axis. */
export interface AxisLabelTarget {
  readonly kind: "axisLabel";
  readonly panel: string;
  /** "x", "y", or "yRight". */
  readonly scale: string;
  /** The tick layer: "major", or the id of a layer an axis the guides list adds. */
  readonly layer: string;
  /** The tick's value: epoch ms on time axes, a band index on category axes. */
  readonly value: number;
  /** On category axes, the category. */
  readonly category: string | undefined;
  readonly text: string;
  readonly box: Box;
}

/** An entry of a legend. */
export interface LegendEntryTarget {
  readonly kind: "legendEntry";
  /** What the entry names, as `getLegend()` keys it. */
  readonly key: string;
  readonly label: string;
  /** The subplot whose legend it is in; undefined for the chart's. */
  readonly panel: string | undefined;
}

/** A plot where no item is. */
export interface PlotTarget {
  readonly kind: "plot";
  readonly panel: string;
}

/** What input is on: the topmost thing drawn there that input addresses. */
export type Target = ItemTarget | AxisLabelTarget | LegendEntryTarget | PlotTarget;

/**
 * What pointer and keyboard events carry: where the pointer is, what is
 * under it, what the chart's inspection read there, what made the input,
 * and the revision of the frame it acted on (what the user saw).
 */
export interface InputEvent {
  /** Undefined for the keyboard, and for cursors other charts share or `showCursor` shows. */
  pointer: Pointer | undefined;
  /** What the pointer or keyboard cursor is on; undefined over nothing input addresses. */
  target: Target | undefined;
  /**
   * The data the chart's `inspection` reads there; undefined where it reads
   * none, and for the pointer with `inspection: false`.
   */
  inspection: Inspection | undefined;
  /** The pointer, the keyboard, a cursor another chart shares ("sync"), or `showCursor` ("api"). */
  cause: Extract<ChangeCause, "pointer" | "keyboard" | "sync" | "api">;
  /** The chart's `revision` the frame drew. */
  revision: number;
}

/**
 * What every change of the chart's state reports with it: what made it,
 * the chart's `revision` once it applied, and with state support
 * (`herceg/state`) the basis a write answering the report gives as
 * `expected`.
 */
export interface StateChange {
  cause: ChangeCause;
  revision: number;
  basis?: Basis;
}

/**
 * A change of view, with the chart's `revision` once it applied and, with
 * state support, its basis and the chart's whole view after it (`state`,
 * as the `viewport` option takes it) (see `ChartEvents.viewport`).
 */
export interface ViewportEvent extends ViewReport {
  readonly revision: number;
  readonly basis?: Basis;
  readonly state?: ViewportState;
}

/** What a `select` event reports (see `ChartEvents.select`). */
export interface SelectEvent extends StateChange {
  /**
   * The selection now: with a `preview`, the one a gesture is making; null
   * when cleared, or when a `cancel` went back to none. Items and series
   * are named by their keys.
   */
  selection: ChartSelection | null;
  /** A gesture still moving (`preview`, once a frame), done (`commit`), or undone (`cancel`); `commit` for every other change. */
  phase: Phase;
  /** A brush's: what it belongs to; for a clear, what it belonged to; empty for items and series. */
  owner: SelectionOwner;
  /** With state support: the selection committed, which a gesture's previews leave as it was. */
  state?: ChartSelection | null;
  /**
   * What the selection holds on each table its marks read, as a condition
   * on that table's fields: for filtering row views, or a product's
   * queries. A table is left out where no condition says it exactly (a
   * lasso, a stack's tops, rows without names). It needs state support:
   * without, reading it throws, naming `herceg/state`.
   */
  conditions: readonly SelectionCondition[];
  /**
   * With `rowSelection`, what the selection wrote to the channels it
   * binds: per table, the rows it covers (a condition for brushes, rows
   * for lassos), or null where clearing it cleared them. Selections from
   * synced charts write nothing.
   */
  rows?: readonly RowSelectionChange[];
}

/** What a `pin` event reports (see `ChartEvents.pin`). */
export interface PinEvent extends StateChange {
  /** Where the tooltip is pinned (see `PinTarget`); null once let go. */
  at: PinTarget | null;
  /**
   * What the pinned tooltip shows; undefined once let go, and while a pin
   * of a value is out of view.
   */
  inspection: Inspection | undefined;
}

/** The panel a view or selection is set in, for charts whose panels have scales of their own. */
export interface PanelTarget {
  /** A panel's key: its facet value (both, in a grid, as a JSON array) or subplot id. */
  panel?: string | undefined;
}

/** Chart events by name, with what their listeners receive. */
export interface ChartEvents {
  /**
   * The view changed (zoom, pan, reset, `setViewport`, a synced chart, or
   * panels gone with their zoomed scales): the scale instances it changed,
   * with what each shows, and every panel drawing one of them, with its
   * whole view (see `ViewportEvent`).
   */
  viewport: ViewportEvent;
  /**
   * The selection changed, or a gesture is changing it: a brush drawn,
   * moved, or resized reports `preview` once a frame, `commit` on release,
   * and `cancel` on Escape or a lost pointer (see `SelectEvent`).
   */
  select: SelectEvent;
  /**
   * The view came near an end of what `interaction.limits` lets its scale
   * show: within `edge.threshold` of its span of the extent's end, or, on
   * an x scale every panel shares, of the data's where the extent has none
   * (while the view is zoomed or panned). Reported on coming near, once, until the view moves farther
   * away again; what the application loads there (older history, say) it
   * adds to the chart's data, and widens the extent.
   */
  edge: ScaleInstance & {
    /** The end: the scale's low values ("start") or high ones ("end"). */
    side: "start" | "end";
    /** What the view shows, ascending (epoch ms on time axes). */
    domain: readonly [number, number];
    /** The end it came near: the extent's, or the data's. */
    bound: number;
    /** What moved the view there, or moved the end. */
    cause: ChangeCause;
  };
  /**
   * What is under the pointer or a cursor changed: what it is on, or the
   * data the inspection reads there (see `InputEvent`); for a cursor another
   * chart shares (cause "sync") or `showCursor` shows ("api"), once drawn.
   */
  hover: InputEvent;
  /**
   * A press released without moving on a plot, an axis label, or a legend
   * entry, or Enter on the keyboard cursor (cause "keyboard"): what it is
   * on, the data the inspection reads there, and with `rowSelection` taking
   * clicks, what the click wrote to the channels (the rows clicked, or null
   * where a click off the data cleared them).
   */
  click: InputEvent & { rows?: readonly RowSelectionChange[] };
  /**
   * A secondary press (a right click, a long press): where, and what it is
   * on. While a listener listens, the browser's own menu stays off the
   * plots (not off the axes or the legend).
   */
  contextMenu: InputEvent & { readonly pointer: Pointer };
  /**
   * A channel `rowSelection` binds changed, whoever changed it (this chart,
   * another, a grid): its table, its name, and what it holds now; with the
   * cause of this chart's write (its gesture's, a click's, a key's), or
   * "sync" for another writer's, and the revision that counted it.
   */
  rowSelection: RowSelectionChange & StateChange & { phase: Phase };
  /**
   * A 3D chart's camera moved: dragged, zoomed, reset, turned by keys or
   * buttons, or set with `setCamera`; once per camera per frame at most.
   * Subplot changes name their owner in `panels`; standalone changes omit it.
   */
  camera: ItemChanges["camera"] & StateChange;
  /**
   * A treemap or sunburst was drilled into a node or back out (a click,
   * Enter, Backspace, a breadcrumb, or `setDrillRoot`): the node's item key,
   * null for the whole tree, and the path to it.
   */
  drill: ItemChanges["drill"] &
    StateChange & {
      /** With state support: the whole state, as the `drillRoot` option takes it. */
      state?: DrillState;
    };
  /**
   * A network's node was moved (dragged, Shift with the arrow keys, or
   * `setItemPosition`), or put back where the layout puts it (null): its
   * item key and where it is now, in the network's layout units. Or a
   * rule with `drag` is being dragged: its item key, its mark's `id`, and
   * its value along its axis (`{ y }` for a horizontal rule, `{ x }` for a
   * vertical one), as it moves (`preview`, once a frame), where it was
   * dropped (`commit`), or where it went back to (`cancel`). A rule's
   * value is the application's to set: the frame after a commit draws the
   * rule where its options put it then.
   */
  itemMove: Omit<ItemChanges["itemMove"], "position" | "phase"> &
    StateChange & {
      position: { readonly x?: number; readonly y?: number } | null;
      /** A dragged rule's mark's `id`; undefined for a network's nodes, and for marks without one. */
      markId?: string | undefined;
      /** "right" for a rule on the right y axis (its `axis` option), whose `y` is on that scale. */
      axis?: "right" | undefined;
      /** A rule's drag while it moves (`preview`), done (`commit`), or undone (`cancel`); `commit` for every node move. */
      phase: Phase;
    };
  /**
   * The tooltip was pinned (by a click with `tooltip.pin`, Enter, or
   * `pin`) or let go (Escape, a click outside, a second click, `pin(null)`,
   * the item it followed gone, `inspection.mode` changed): where, and what
   * it shows.
   */
  pin: PinEvent;
  /**
   * Series or items were hidden or shown: through the legend,
   * `setVisibility` or `setHiddenKeys`, or as marks the chart no longer
   * has took their keys along. The keys now hidden, and by panel, the keys
   * a panel's legend hid or showed there unlike in the rest of the chart.
   */
  visibility: StateChange & {
    hiddenKeys: readonly string[];
    panels?: PanelVisibility;
    /** With state support: the whole state, as the `visibility` option takes it. */
    state?: VisibilityState;
  };
  /**
   * The chart drew a frame of its data, axes, and legend (a cursor or
   * tooltip moving alone draws none), or a selection over the last one:
   * panels, pixel mapping, and the legend now describe it, for overlays
   * drawn over the chart. `revision` is the chart's revision on screen, so
   * a change made at a revision is on screen once a frame of that revision
   * or a later one renders.
   */
  render: { revision: number };
  /**
   * Something kept the chart from drawing: options it refused, code it
   * could not load, a frame that failed (see `ChartOptions.errorMode`).
   * Once per change of options or data; the next change tries again.
   */
  error: { error: ChartError };
}

export type ChartListener<K extends keyof ChartEvents> = (event: ChartEvents[K]) => void;

/** Listeners by event. A listener that throws is reported; the others still run. */
export class Emitter {
  readonly #listeners = new Map<keyof ChartEvents, Set<(event: never) => void>>();

  on<K extends keyof ChartEvents>(type: K, listener: ChartListener<K>): () => void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  /** Whether anyone listens, so payloads nobody reads need not be computed. */
  has(type: keyof ChartEvents): boolean {
    return (this.#listeners.get(type)?.size ?? 0) > 0;
  }

  emit<K extends keyof ChartEvents>(type: K, event: ChartEvents[K]): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      try {
        (listener as ChartListener<K>)(event);
      } catch (error) {
        report(error);
      }
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
