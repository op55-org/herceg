// The herceg remote grid as a Vue component, imported as
// `@herceg/vue/grid/remote` so that grids over local tables load none of it:
// rows live elsewhere (a database behind an API, a worker) and load as they
// come into view.

import type { Schema } from "herceg";
import {
  createRemoteGrid,
  type RemoteGrid as HercegRemoteGrid,
  type RemoteGridModel,
} from "herceg/grid/remote";
import { defineComponent, type PropType, type PublicProps } from "vue";
import {
  type GridComponentProps,
  type GridInstance,
  type GridListeners,
  gridEmits,
  gridProps,
  useGrid,
} from "./base.ts";
import { type GridCellSlots, useVueCells, type VueGridCells } from "./cells.ts";

export type RemoteGridProps<S extends Schema = Schema> = GridComponentProps &
  GridListeners & {
    /**
     * What the grid shows, made with `createRemoteGridModel` and owned by the
     * application; a new model makes a new grid.
     */
    model: RemoteGridModel<S>;
    /**
     * Vue cells by column id, as `<Grid>`'s: a render function, `{ render,
     * fields, interaction }`, or a `#cell-<id>` slot. The source is asked for
     * the fields each column's cells read.
     */
    cells?: VueGridCells<NoInfer<S>> | undefined;
  };

/** `<RemoteGrid>` as templates and TSX check it: generic in its model's schema. */
export interface RemoteGridComponent {
  new <S extends Schema = Schema>(
    props: RemoteGridProps<S> & PublicProps,
  ): GridInstance<RemoteGridProps<S>, HercegRemoteGrid<S>, GridCellSlots<S>>;
}

/**
 * A herceg remote grid. Props other than `model` are applied with
 * `grid.update` when they change, as `<Grid>`'s are.
 *
 * ```vue
 * <RemoteGrid :model="model" aria-label="Requests" />
 * ```
 */
export const RemoteGrid = /* @__PURE__ */ defineComponent({
  name: "HercegRemoteGrid",
  props: {
    ...gridProps,
    cells: Object as PropType<VueGridCells>,
  },
  emits: gridEmits,
  expose: ["grid"],
  setup(props, { emit, slots }) {
    const { grid, render } = useGrid(
      (container, model, options) =>
        createRemoteGrid(container, { ...options, model: model as RemoteGridModel }),
      props,
      emit,
      useVueCells(props, slots, "<RemoteGrid>"),
    );
    return { grid, renderGrid: render };
  },
  render() {
    return this.renderGrid();
  },
}) as unknown as RemoteGridComponent;
