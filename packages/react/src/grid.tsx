// The herceg grid as a React component, imported as `@herceg/react/grid` so
// that applications drawing only charts never load it. Remote grids are
// `@herceg/react/grid/remote`, pivots' `@herceg/react/grid/pivot`.

import type { Schema } from "herceg";
import { createGrid, type GridModel, type Grid as HercegGrid } from "herceg/grid";
import type { ReactNode } from "react";
import { type GridComponentProps, useGrid } from "./grid/base.tsx";
import { type ReactGridCells, useReactCells } from "./grid/cells.tsx";

export type { GridComponentProps } from "./grid/base.tsx";
export type { GridCellRender, ReactGridCell, ReactGridCells } from "./grid/cells.tsx";

/** A grid's props; `R` is the schema of its model's store's table (see `GridModel`). */
export interface GridProps<S extends Schema = Schema, R extends Schema = S>
  extends GridComponentProps<HercegGrid<S, GridModel<S, R>>> {
  /**
   * What the grid shows, made with `createGridModel` and owned by the
   * application. Data changes, scrolling, focus, and selection go through it
   * and the grid, never through React; a new model makes a new grid.
   */
  model: GridModel<S, R>;
  /**
   * React cells by column id, over the columns' own cells: a render
   * function of the cell (`GridCellContext`), or `{ render, fields,
   * interaction }` as `createGrid`'s renderers take them. Each cell renders
   * in the component's tree (its providers and context), its state its
   * row's, in a boundary of its own drawing the cell's text if it throws or
   * suspends. The column's text is what the model, export, and copy know of
   * the cell, and names it for screen readers.
   */
  cells?: ReactGridCells<NoInfer<S>> | undefined;
}

/**
 * A herceg grid. Props other than `model` are applied with `grid.update`
 * when they change; a theme or header height no longer passed goes back to
 * its default.
 *
 * ```tsx
 * const model = useMemo(() => createGridModel({ data: rowView(requests), columns }), []);
 * <Grid model={model} ariaLabel="Requests" />
 * ```
 */
export function Grid<S extends Schema, R extends Schema = S>({
  model,
  cells,
  ...props
}: GridProps<S, R>): ReactNode {
  return useGrid<S, HercegGrid<S, GridModel<S, R>>>(
    (container, options) => createGrid(container, { ...options, model }),
    model,
    props,
    useReactCells(cells),
  );
}
