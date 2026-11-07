// The herceg grid as a Vue component, imported as `@herceg/vue/grid` so that
// applications drawing only charts never load it. Remote grids are
// `@herceg/vue/grid/remote`, pivots' `@herceg/vue/grid/pivot`.

import type { Schema } from "herceg";
import { createGrid, type GridModel, type Grid as HercegGrid } from "herceg/grid";
import { defineComponent, type PropType, type PublicProps } from "vue";
import {
  type GridComponentProps,
  type GridInstance,
  type GridListeners,
  gridEmits,
  gridProps,
  useGrid,
} from "./grid/base.ts";
import { type GridCellSlots, useVueCells, type VueGridCells } from "./grid/cells.ts";

export type { GridComponentProps, GridInstance, GridListeners } from "./grid/base.ts";
export type { GridCellRender, GridCellSlots, VueGridCell, VueGridCells } from "./grid/cells.ts";

export type GridProps<S extends Schema = Schema> = GridComponentProps &
  GridListeners & {
    /**
     * What the grid shows, made with `createGridModel` and owned by the
     * application (kept as it is: not in `ref()` or `reactive()`). Data
     * changes, scrolling, focus, and selection go through it and the grid,
     * never through Vue; a new model makes a new grid.
     */
    model: GridModel<S>;
    /**
     * Vue cells by column id, over the columns' own cells: a render function
     * of the cell (`GridCellContext`), or `{ render, fields, interaction }` as
     * `createGrid`'s renderers take them. A slot `#cell-<id>="{ cell }"` draws
     * a column too, `cells` then giving only its `fields` and `interaction`.
     * Each cell renders in the component's tree (provide and inject reach
     * it), its state its row's, in a boundary of its own drawing the cell's
     * text if it throws. The column's text is what the model, export, and
     * copy know of the cell, and names it for screen readers.
     */
    cells?: VueGridCells<NoInfer<S>> | undefined;
  };

/** `<Grid>` as templates and TSX check it: generic in its model's schema. */
export interface GridComponent {
  new <S extends Schema>(
    props: GridProps<S> & PublicProps,
  ): GridInstance<GridProps<S>, HercegGrid<S>, GridCellSlots<S>>;
}

/**
 * A herceg grid. Props other than `model` are applied with `grid.update`
 * when they change; a theme or header height no longer passed goes back to
 * its default. The grid is exposed as `grid` (a template ref's).
 *
 * ```vue
 * <Grid :model="model" aria-label="Services" style="height: 400px">
 *   <template #cell-open="{ cell }"><button @click="open(cell.text)">Open</button></template>
 * </Grid>
 * ```
 */
export const Grid = /* @__PURE__ */ defineComponent({
  name: "HercegGrid",
  props: {
    ...gridProps,
    cells: Object as PropType<VueGridCells>,
  },
  emits: gridEmits,
  expose: ["grid"],
  setup(props, { emit, slots }) {
    const { grid, render } = useGrid(
      (container, model, options) =>
        createGrid(container, { ...options, model: model as GridModel }),
      props,
      emit,
      useVueCells(props, slots, "<Grid>"),
    );
    return { grid, renderGrid: render };
  },
  render() {
    return this.renderGrid();
  },
}) as unknown as GridComponent;
