// Events a chart emits to the application.

import type { ItemChanges } from "../model/item-views.ts";
import type { PanelVisibility } from "../model/legend.ts";
import type { ChangeCause, Inspection, ViewReport } from "../model/model.ts";
import type { RowSelectionChange } from "../model/row-selection.ts";
import type { ChartError } from "../spec/errors.ts";
import type { Selection } from "./brushed.ts";
import type { ScaleInstance, SelectionOwner } from "./handle.ts";
import { report } from "./scheduler.ts";

export type { PanelVisibility } from "../model/legend.ts";
export type { ChangeCause, PanelViewport, ScaleView } from "../model/model.ts";

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
 * and the chart's `revision` once it applied.
 */
export interface StateChange {
  cause: ChangeCause;
  revision: number;
}

/** A change of view, with the chart's `revision` once it applied (see `ChartEvents.viewport`). */
export interface ViewportEvent extends ViewReport {
  readonly revision: number;
}

/** The panel a view or selection is set in, for charts whose panels have scales of their own. */
export interface PanelTarget {
  /** A panel's key: its facet value (both, in a grid, as a JSON array) or subplot id. */
  panel?: string;
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
   * The selection changed: its x and y ranges and a lasso's outline, all
   * null when the selection was cleared.
   */
  select: Selection &
    StateChange & {
      /** What it belongs to: for a cleared selection, what it belonged to. */
      owner: SelectionOwner;
      /**
       * With `rowSelection`, what the selection wrote to the channels it
       * binds: per table, the rows it covers (a condition for brushes, rows
       * for lassos), or null where clearing it cleared them. Selections from
       * synced charts write nothing.
       */
      rows?: readonly RowSelectionChange[];
    };
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
  rowSelection: RowSelectionChange & StateChange;
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
  drill: ItemChanges["drill"] & StateChange;
  /**
   * A network's node was moved (dragged, Shift with the arrow keys, or
   * `setItemPosition`), or put back where the layout puts it (null): its
   * item key and where it is now, in the network's layout units.
   */
  itemMove: ItemChanges["itemMove"] & StateChange;
  /**
   * Series or items were hidden or shown: through the legend,
   * `setVisibility` or `setHiddenKeys`, or as marks the chart no longer
   * has took their keys along. The keys now hidden, and by panel, the keys
   * a panel's legend hid or showed there unlike in the rest of the chart.
   */
  visibility: StateChange & {
    hiddenKeys: readonly string[];
    panels?: PanelVisibility;
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
