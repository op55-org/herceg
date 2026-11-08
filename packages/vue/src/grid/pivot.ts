// The herceg pivot grid as a Vue component, imported as
// `@herceg/vue/grid/pivot` so that grids showing no pivot load none of it.
// Pivot grids take no Vue cells: their rows are combinations, not records.

import type { Schema } from "herceg";
import {
  createPivotGrid,
  type PivotGrid as HercegPivotGrid,
  type PivotGridModel,
} from "herceg/grid/pivot";
import { defineComponent, type PublicProps } from "vue";
import {
  type GridComponentProps,
  type GridInstance,
  type GridListeners,
  gridEmits,
  gridProps,
  useGrid,
} from "./base.ts";

export type PivotGridProps<S extends Schema = Schema> = GridComponentProps &
  GridListeners<PivotGridModel<S>> & {
    /**
     * What the grid shows, made with `createPivotGridModel` and owned by the
     * application; a new model makes a new grid.
     */
    model: PivotGridModel<S>;
  };

/** `<PivotGrid>` as templates and TSX check it: generic in its model's schema. */
export interface PivotGridComponent {
  new <S extends Schema = Schema>(
    props: PivotGridProps<S> & PublicProps,
  ): GridInstance<PivotGridProps<S>, HercegPivotGrid<S>>;
}

/**
 * A herceg pivot grid. Props other than `model` are applied with
 * `grid.update` when they change, as `<Grid>`'s are.
 *
 * ```vue
 * <PivotGrid :model="model" aria-label="Requests by region and service" />
 * ```
 */
export const PivotGrid = /* @__PURE__ */ defineComponent({
  name: "HercegPivotGrid",
  props: gridProps,
  emits: gridEmits,
  expose: ["grid"],
  setup(props, { emit }) {
    const { grid, render } = useGrid(
      (container, model, options) =>
        createPivotGrid(container, { ...options, model: model as PivotGridModel }),
      props,
      emit,
    );
    return { grid, renderGrid: render };
  },
  render() {
    return this.renderGrid();
  },
}) as unknown as PivotGridComponent;
