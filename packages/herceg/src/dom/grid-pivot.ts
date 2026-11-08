// A pivot's grid in the page (`herceg/grid/pivot`): the DOM grid of grid.ts
// over a pivot grid model, whose value columns' headings (each pivot value
// over its aggregates' columns, with several aggregates) the grid draws as
// any columns' headings. A pivot that stopped at a limit says so in a
// notice under the grid's rows (and its totals row).

import type { Schema } from "../data/table.ts";
import type { GridModel } from "../grid/model.ts";
import { type PivotGridModel, pivotOfModel } from "../grid/pivot.ts";
import {
  Grid,
  type GridEvents,
  type GridExtras,
  type GridOptions,
  type GridUpdate,
} from "./grid.ts";

export interface PivotGridOptions<S extends Schema = Schema>
  extends Omit<GridOptions, "model" | "cells"> {
  /** What the grid shows, made with `createPivotGridModel`; the application owns it. */
  model: PivotGridModel<S>;
}

/** A pivot's grid (`createPivotGrid`): a `Grid` whose model is a pivot grid model. */
export type PivotGrid<S extends Schema = Schema> = Omit<Grid, "model" | "update" | "on"> & {
  readonly model: PivotGridModel<S>;
  /** Changes options; one given as undefined goes back to its default. Pivot grids take no `cells`. */
  update(options: Omit<GridUpdate, "cells">): void;
  /**
   * Listens to `type`; returns what stops it (see `Grid.on`). Selecting a
   * pivot's row selects its records of the view, which `select` reports.
   */
  on<K extends keyof GridEvents<PivotGridModel<S>>>(
    type: K,
    listener: (event: GridEvents<PivotGridModel<S>>[K]) => void,
  ): () => void;
};

const CSS =
  ".herceg-grid .hg-notice{position:absolute;left:0;right:0;bottom:0;z-index:3;padding:4px 8px;background:var(--hg-surface);border-top:1px solid var(--hg-rule)}";

/** A pivot's grid in `container`, which should have a height; see `Grid`. */
export function createPivotGrid<S extends Schema>(
  container: HTMLElement,
  options: PivotGridOptions<S>,
): PivotGrid<S> {
  const model = options.model as unknown as GridModel;
  const grid = new Grid(container, { ...options, model } as GridOptions, new Notice(model));
  return grid as unknown as PivotGrid<S>;
}

/** The notice of a pivot that stopped at a limit, under the grid's rows. */
class Notice implements GridExtras {
  readonly maker = "createPivotGrid";
  readonly refuseCells =
    "pivot grids take no custom renderers (their rows are combinations, not records)";
  readonly #model: GridModel;
  #notice: HTMLDivElement | null = null;
  /** The height the notice was last given under the rows, in CSS pixels. */
  #room = 0;

  constructor(model: GridModel) {
    this.#model = model;
  }

  drawn(scroller: HTMLElement): void {
    const root = scroller.parentElement!;
    let notice = this.#notice;
    if (!notice) {
      const document = root.ownerDocument;
      const style = document.createElement("style");
      style.textContent = CSS;
      notice = document.createElement("div");
      notice.className = "hg-notice";
      notice.setAttribute("role", "status");
      notice.hidden = true;
      root.append(style, notice);
      this.#notice = notice;
    }
    const failure = pivotOfModel(this.#model)?.failure ?? null;
    if (notice.hidden !== (failure === null)) {
      notice.hidden = failure === null;
      notice.textContent = failure ? `Not updating: ${failure.message}.` : "";
    }
    // The rows, and the totals row, end above the notice.
    const height = notice.hidden ? 0 : notice.offsetHeight;
    if (height === this.#room) return;
    this.#room = height;
    scroller.style.bottom = height > 0 ? `${height}px` : "";
  }
}
