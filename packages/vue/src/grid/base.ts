// What `<Grid>`, `<RemoteGrid>`, and `<PivotGrid>` share: a grid made as the
// component mounts and for each new model, props applied with `grid.update`,
// events emitted, and the grid exposed. Vue cells (cells.ts) come with the
// components that take them.

import type { Schema } from "herceg";
import type { GridEvents, GridOptions, GridSelectEvent, Grid as HercegGrid } from "herceg/grid";
import {
  type ComponentPublicInstance,
  h,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  type PropType,
  type ShallowRef,
  shallowRef,
  toRaw,
  type VNode,
} from "vue";
import type { CellRenderers, VueCells } from "./cells.ts";

/**
 * The props every grid component takes besides its model (and `cells`).
 * Its accessible name is `ariaLabel`, which templates write `aria-label`:
 * Vue passes that to the prop, and its template checker reads `aria-*`
 * attributes as written.
 */
export type GridComponentProps = Pick<GridOptions, "theme" | "headerHeight" | "copy"> &
  (
    | { ariaLabel: string; "aria-label"?: undefined }
    | { "aria-label": string; ariaLabel?: undefined }
  );

/** The grid's events as listeners, as templates write them (`@row-click`), `select` typed by the model `M`. */
export interface GridListeners<M = unknown> {
  /**
   * The model's selection changed, by any writer of its channel: what it
   * holds now (frozen), what changed it (`cause`), and the model's
   * revision. A click that selects emits it before `rowClick`.
   */
  onSelect?: ((event: GridSelectEvent<M>) => void) | undefined;
  /** A body row was clicked (after the click selected) or Enter pressed on one of its cells: the row by its identity. */
  onRowClick?: ((event: GridEvents["rowClick"]) => void) | undefined;
  /** The same click, as on its cell (`column`), after `rowClick`. */
  onCellClick?: ((event: GridEvents["cellClick"]) => void) | undefined;
  /**
   * The grid drew a frame of its model, as of the model's `revision`: its
   * first, once the grid is exposed and its Vue cells are committed, then
   * every other, the grid's own frames after their cells' commit.
   */
  onRender?: ((event: GridEvents["render"]) => void) | undefined;
}

/**
 * A grid component's instance as templates and refs see it: its props
 * `P`, its slots `T`, and the grid it exposes (`grid`, of the model's
 * schema), null until mounted. Components are typed as constructors of it,
 * generic in the schema, as templates and TSX check them.
 */
export type GridInstance<P, G, T = object> = ComponentPublicInstance<P> & {
  $slots: T;
  /** The underlying grid, for imperative calls such as `focusCell`; null until mounted. */
  grid: G | null;
};

/** The runtime props every grid component takes; `copy` stays unset when absent, not false. */
export const gridProps = {
  model: { type: Object as PropType<object>, required: true },
  ariaLabel: { type: String, required: true },
  theme: [String, Object] as PropType<NonNullable<GridOptions["theme"]>>,
  headerHeight: Number,
  copy: {
    type: [Boolean, Object] as PropType<NonNullable<GridOptions["copy"]>>,
    default: undefined,
  },
} as const;

/** The grid's events, emitted as Vue events (`@select`, `@row-click`, `@cell-click`, `@render`). */
export const gridEmits = {
  select: (_: GridEvents["select"]) => true,
  rowClick: (_: GridEvents["rowClick"]) => true,
  cellClick: (_: GridEvents["cellClick"]) => true,
  render: (_: GridEvents["render"]) => true,
};

type Emit = <K extends keyof GridEvents>(type: K, event: GridEvents[K]) => void;

/** What the components need of the grids they make (each listens as `HercegGrid` does). */
type Made = Pick<HercegGrid, "destroy" | "render" | "drawnRevision" | "root"> & {
  update(options: object): void;
};

/** What a component makes its grid with. */
export type Make<S extends Schema, G> = (
  container: HTMLElement,
  model: object,
  options: Pick<GridOptions<S>, "ariaLabel" | "theme" | "headerHeight" | "copy" | "cells">,
) => G;

/** The props `useGrid` reads, as Vue gives them. */
type Props = Pick<GridOptions, "ariaLabel" | "theme" | "headerHeight" | "copy"> & { model: object };

/**
 * A grid of the `model` prop made by `make` in the component's element, a
 * new one for a new model; with `cells` (`useVueCells`, of a component
 * taking them), its Vue cells too. Returns the exposed grid and the
 * render function.
 */
export function useGrid<S extends Schema, G extends Made>(
  make: Make<S, G>,
  props: Props,
  emit: Emit,
  cells?: VueCells,
): { grid: ShallowRef<G | null>; render: () => VNode } {
  const container = shallowRef<HTMLDivElement | null>(null);
  // Typed apart: shallowRef's type of a type parameter stays unresolved.
  const grid = shallowRef(null) as ShallowRef<G | null>;
  /** The model, options, and renderers the grid has, to skip updates when a render changed none. */
  let applied: { model: object; key: string; renderers: CellRenderers | undefined } | null = null;
  /** What the last render read, applied once Vue has patched the DOM. */
  let rendered: { model: object; key: string; renderers: CellRenderers | undefined } | null = null;
  /** An error the last render met reading `cells`, thrown where Vue reports it. */
  let failure: { error: unknown } | undefined;
  /** Whether the component is going: no grid is made, or kept, after. */
  let gone = false;

  /**
   * Makes the grid, or none if the component went: as the grid it replaces
   * was destroyed, or as making it (a model's listener unmounted it).
   */
  function create(model: object, renderers: CellRenderers | undefined): G | null {
    if (gone) return null;
    const { ariaLabel, theme, headerHeight, copy } = props;
    const created = make(container.value!, model, {
      ariaLabel,
      ...(theme !== undefined && { theme }),
      ...(headerHeight !== undefined && { headerHeight }),
      ...(copy !== undefined && { copy }),
      ...(renderers !== undefined && { cells: renderers as GridOptions<S>["cells"] }),
    });
    if (gone) {
      created.destroy();
      return null;
    }
    // Grids of every model listen alike; only `select`'s selection type differs.
    const listened = created as unknown as Pick<HercegGrid, "on">;
    listened.on("select", (event) => emit("select", event));
    listened.on("rowClick", (event) => emit("rowClick", event));
    listened.on("cellClick", (event) => emit("cellClick", event));
    // The grid's own frames commit their Vue cells in the microtask after
    // the frame's callback, before paint: heard once committed, unless the
    // grid went meanwhile (a cell's hook destroyed it).
    listened.on("render", (event) => {
      if (!cells) emit("render", event);
      else
        cells.store.whenCommitted(() => {
          if (grid.value === created && created.root.parentElement) emit("render", event);
        });
    });
    return created;
  }

  function sync() {
    if (gone) return;
    if (failure) throw failure.error;
    const next = rendered!;
    const current = grid.value;
    if (!current || applied?.model !== next.model) {
      current?.destroy();
      grid.value = null;
      applied = null;
      const created = create(next.model, next.renderers);
      if (!created) return;
      grid.value = created;
      applied = next;
      // The first frame was drawn as the grid was made, before it had
      // listeners: heard once its Vue cells are committed, once a grid.
      const tell = () => {
        if (grid.value === created && created.root.parentElement)
          emit("render", { revision: created.drawnRevision });
      };
      if (cells) cells.store.afterCommit(tell);
      else tell();
      return;
    }
    const last = applied;
    if (last.key === next.key && last.renderers === next.renderers) return;
    applied = next;
    const { ariaLabel, theme, headerHeight, copy } = props;
    current.update({
      ariaLabel,
      theme,
      headerHeight,
      copy,
      ...(cells && { cells: next.renderers }),
    });
    // Cells of renderers replaced write their text before this paints.
    if (cells && last.renderers !== next.renderers) current.render();
  }

  onMounted(sync);
  onUpdated(sync);
  onBeforeUnmount(() => {
    gone = true;
    grid.value?.destroy();
    grid.value = null;
  });

  return {
    grid,
    // Reads every prop, so that a change of any renders and updates the grid.
    render: () => {
      let renderers: CellRenderers | undefined;
      failure = undefined;
      try {
        renderers = cells?.renderers();
      } catch (error) {
        // Thrown here, Vue would replace the element with a placeholder and
        // strand the grid in the old one: thrown again from the hook.
        failure = { error };
      }
      rendered = {
        model: toRaw(props.model),
        key: JSON.stringify([props.ariaLabel, props.theme, props.headerHeight, props.copy]),
        renderers: failure ? applied?.renderers : renderers,
      };
      // Class, style, and other attributes fall through onto this element;
      // Vue cells teleport out of it, and the grid is appended after them.
      return h("div", { ref: container }, cells?.view());
    },
  };
}
