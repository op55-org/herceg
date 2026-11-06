// The herceg remote grid as a React component, imported as
// `@herceg/react/grid/remote` so that grids over local tables load none of
// it: rows live elsewhere (a database behind an API, a worker) and load as
// they come into view.

import type { Schema } from "herceg";
import {
  createRemoteGrid,
  type RemoteGrid as HercegRemoteGrid,
  type RemoteGridModel,
} from "herceg/grid/remote";
import type { ReactNode } from "react";
import { type GridComponentProps, useGrid } from "./base.tsx";
import { type ReactGridCells, useReactCells } from "./cells.tsx";

export interface RemoteGridProps<S extends Schema = Schema>
  extends GridComponentProps<HercegRemoteGrid<S>> {
  /**
   * What the grid shows, made with `createRemoteGridModel` and owned by the
   * application; a new model makes a new grid.
   */
  model: RemoteGridModel<S>;
  /**
   * React cells by column id, as `<Grid>`'s: a render function, or `{
   * render, fields, interaction }`. The source is asked for the fields
   * each column's cells read.
   */
  cells?: ReactGridCells<NoInfer<S>> | undefined;
}

/**
 * A herceg remote grid. Props other than `model` are applied with
 * `grid.update` when they change, as `<Grid>`'s are.
 *
 * ```tsx
 * const model = useMemo(() => createRemoteGridModel({ source, columns }), [source]);
 * <RemoteGrid model={model} ariaLabel="Requests" />
 * ```
 */
export function RemoteGrid<S extends Schema>({
  model,
  cells,
  ...props
}: RemoteGridProps<S>): ReactNode {
  return useGrid<S, HercegRemoteGrid<S>>(
    (container, options) => createRemoteGrid(container, { ...options, model }),
    model,
    props,
    useReactCells(cells),
  );
}
