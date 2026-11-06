// The herceg pivot grid as a React component, imported as
// `@herceg/react/grid/pivot` so that grids showing no pivot load none of it.
// Pivot grids take no React cells: their rows are combinations, not records.

import type { Schema } from "herceg";
import {
  createPivotGrid,
  type PivotGrid as HercegPivotGrid,
  type PivotGridModel,
} from "herceg/grid/pivot";
import type { ReactNode } from "react";
import { type GridComponentProps, useGrid } from "./base.tsx";

export interface PivotGridProps<S extends Schema = Schema>
  extends GridComponentProps<HercegPivotGrid<S>> {
  /**
   * What the grid shows, made with `createPivotGridModel` and owned by the
   * application; a new model makes a new grid.
   */
  model: PivotGridModel<S>;
}

/**
 * A herceg pivot grid. Props other than `model` are applied with
 * `grid.update` when they change, as `<Grid>`'s are.
 *
 * ```tsx
 * const model = useMemo(() => createPivotGridModel({ data: pivotRows(view, { rows, pivot, ops }) }), [view]);
 * <PivotGrid model={model} ariaLabel="Requests by region and service" />
 * ```
 */
export function PivotGrid<S extends Schema>({ model, ...props }: PivotGridProps<S>): ReactNode {
  return useGrid<S, HercegPivotGrid<S>>(
    (container, options) => createPivotGrid(container, { ...options, model }),
    model,
    props,
  );
}
