// The grid components' props (`<Grid>`, `<RemoteGrid>`, `<PivotGrid>`).

import type { Schema } from "herceg";
import type {
  GridEvents,
  GridModel,
  GridOptions,
  GridSelectEvent,
  Grid as HercegGrid,
} from "herceg/grid";
import type { PivotGrid as HercegPivotGrid, PivotGridModel } from "herceg/grid/pivot";
import type { RemoteGrid as HercegRemoteGrid, RemoteGridModel } from "herceg/grid/remote";
import type { SvelteGridCells } from "./cells.svelte.js";

/** The props every grid component takes besides its model, `cells`, and `grid`; `onselect` typed by the model `M`. */
export interface GridComponentProps<M = unknown>
  extends Pick<GridOptions, "ariaLabel" | "theme" | "headerHeight" | "copy"> {
  class?: string | undefined;
  /** Style of the container. Without a height, the grid is 320 px tall. */
  style?: string | undefined;
  /**
   * The model's selection changed, by any writer of its channel: what it
   * holds now (frozen), what changed it (`cause`), and the model's
   * revision. A click that selects reports it before `onrowclick`.
   */
  onselect?: ((event: GridSelectEvent<M>) => void) | undefined;
  /** A body row was clicked (after the click selected) or Enter pressed on one of its cells: the row by its identity. */
  onrowclick?: ((event: GridEvents["rowClick"]) => void) | undefined;
  /** The same click, as on its cell (`column`), after `onrowclick`. */
  oncellclick?: ((event: GridEvents["cellClick"]) => void) | undefined;
  /**
   * The grid drew a frame of its model, as of the model's `revision`: its
   * first, drawn as it was made, once `grid` is bound and its Svelte cells
   * are mounted, then every other, the grid's own frames after their cells'.
   */
  onrender?: ((event: GridEvents["render"]) => void) | undefined;
}

export interface GridProps<S extends Schema = Schema> extends GridComponentProps<GridModel<S>> {
  /**
   * What the grid shows, made with `createGridModel` and owned by the
   * application (kept as it is: not in `$state`). Data changes, scrolling,
   * focus, and selection go through it and the grid, never through Svelte;
   * a new model makes a new grid.
   */
  model: GridModel<S>;
  /**
   * Svelte cells by column id, over the columns' own cells: a snippet of
   * the cell (`GridCellContext`), or `{ render, fields, interaction }` as
   * `createGrid`'s renderers take them. Each cell is mounted with the
   * component's contexts, its state its row's, in a boundary of its own
   * drawing the cell's text if it throws. The column's text is what the
   * model, export, and copy know of the cell, and names it for screen
   * readers.
   */
  cells?: SvelteGridCells<NoInfer<S>> | undefined;
  /** The underlying grid once mounted (`bind:grid`), for imperative calls such as `focusCell`. */
  grid?: HercegGrid<S> | null;
}

export interface RemoteGridProps<S extends Schema = Schema>
  extends GridComponentProps<RemoteGridModel<S>> {
  /**
   * What the grid shows, made with `createRemoteGridModel` and owned by the
   * application; a new model makes a new grid.
   */
  model: RemoteGridModel<S>;
  /**
   * Svelte cells by column id, as `<Grid>`'s: a snippet, or `{ render,
   * fields, interaction }`. The source is asked for the fields each
   * column's cells read.
   */
  cells?: SvelteGridCells<NoInfer<S>> | undefined;
  /** The underlying grid once mounted (`bind:grid`). */
  grid?: HercegRemoteGrid<S> | null;
}

export interface PivotGridProps<S extends Schema = Schema>
  extends GridComponentProps<PivotGridModel<S>> {
  /**
   * What the grid shows, made with `createPivotGridModel` and owned by the
   * application; a new model makes a new grid.
   */
  model: PivotGridModel<S>;
  /** The underlying grid once mounted (`bind:grid`). */
  grid?: HercegPivotGrid<S> | null;
}
