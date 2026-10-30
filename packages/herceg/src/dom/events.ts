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
 * What pointer and keyboard events carry: what the input read, what made
 * it, and the revision of the frame it acted on (what the user saw).
 */
export interface InputEvent {
  /** The data under the pointer or cursor; undefined when there is none. */
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
  /** The data under the pointer or cursor changed (see `InputEvent`). */
  hover: InputEvent;
  /**
   * The plot was clicked (not dragged), with the data under the pointer and,
   * with `rowSelection` taking clicks, what the click wrote to the channels
   * (the rows clicked, or null where a click off the data cleared them).
   */
  click: InputEvent & { rows?: readonly RowSelectionChange[] };
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
