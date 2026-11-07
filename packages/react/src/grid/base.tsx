// What `<Grid>`, `<RemoteGrid>`, and `<PivotGrid>` share: a grid made in a
// layout effect for each model, props applied with `grid.update`, events
// heard through the latest handlers, and the ref. React cells (cells.tsx)
// come with the components that take them.

import type { Schema } from "herceg";
import type { GridEvents, GridOptions, Grid as HercegGrid } from "herceg/grid";
import {
  type CSSProperties,
  type ReactNode,
  type Ref,
  type RefObject,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";
import type { ReactCells } from "./cells.tsx";

/** The props every grid component takes besides its model (and `cells`). */
export interface GridComponentProps<G>
  extends Pick<GridOptions, "ariaLabel" | "theme" | "headerHeight" | "copy"> {
  className?: string;
  /** Style of the container. Without a height, the grid is 320 px tall. */
  style?: CSSProperties;
  /** The underlying grid, for imperative calls such as `focusCell`; its model keeps its type. */
  ref?: Ref<G | null>;
  /** A body row was clicked (after the click selected) or Enter pressed on one of its cells: the row by its identity. */
  onRowClick?: ((event: GridEvents["rowClick"]) => void) | undefined;
  /** The same click, as on its cell (`column`), after `onRowClick`. */
  onCellClick?: ((event: GridEvents["cellClick"]) => void) | undefined;
  /**
   * The grid drew a frame of its model, as of the model's `revision`: its
   * first, drawn as it was made, once the ref is set and its React cells
   * are committed, then every other, after its cells' commit.
   */
  onRender?: ((event: GridEvents["render"]) => void) | undefined;
}

/** What the components need of the grids they make. */
type Made = Pick<HercegGrid, "on" | "destroy" | "render" | "drawnRevision" | "root"> & {
  update(options: object): void;
};

/** What a component makes its grid with. */
export type Make<S extends Schema, G> = (
  container: HTMLElement,
  options: Pick<GridOptions<S>, "ariaLabel" | "theme" | "headerHeight" | "copy" | "cells">,
) => G;

/**
 * A grid of `model` made by `make` in the returned element, a new one for a
 * new model; with `cells` (`useReactCells`, of a component taking them), its
 * React cells too.
 */
export function useGrid<S extends Schema, G extends Made>(
  make: Make<S, G>,
  model: object,
  {
    className,
    style,
    ref,
    onRowClick,
    onCellClick,
    onRender,
    ariaLabel,
    theme,
    headerHeight,
    copy,
  }: GridComponentProps<G>,
  cells?: ReactCells,
): ReactNode {
  const container = useRef<HTMLDivElement>(null);
  const grid = useRef<G | null>(null);
  const renderers = cells?.renderers;
  /** The options the grid has, to skip updates when a re-render changed none. */
  const applied = useRef<{ key: string; renderers: unknown }>({ key: "", renderers: undefined });
  const key = JSON.stringify([ariaLabel, theme, headerHeight, copy]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: options change through update()
  useLayoutEffect(() => {
    const created = make(container.current!, {
      ariaLabel,
      ...(theme !== undefined && { theme }),
      ...(headerHeight !== undefined && { headerHeight }),
      ...(copy !== undefined && { copy }),
      ...(renderers !== undefined && { cells: renderers as GridOptions<S>["cells"] }),
    });
    grid.current = created;
    applied.current = { key, renderers };
    return () => {
      created.destroy();
      grid.current = null;
    };
  }, [model]);

  useLayoutEffect(() => {
    const current = grid.current;
    const last = applied.current;
    if (!current || (last.key === key && last.renderers === renderers)) return;
    applied.current = { key, renderers };
    current.update({
      ariaLabel,
      theme,
      headerHeight,
      copy,
      ...(cells && { cells: renderers }),
    });
    if (!cells || last.renderers === renderers) return;
    // Cells of renderers replaced write their text before this paints.
    current.render();
  });

  useGridEvent(grid, "rowClick", onRowClick);
  useGridEvent(grid, "cellClick", onCellClick);
  const render = useGridEvent(grid, "render", onRender);

  // A new model makes a new grid, which the ref then gives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the grid changes with the model
  useImperativeHandle<G | null, G | null>(ref, () => grid.current, [model]);

  // Each grid drew its first frame as it was made, before handlers
  // subscribed: `onRender` hears of it once the ref is set and the frame's
  // React cells are committed, once a grid.
  const told = useRef<G | null>(null);
  useLayoutEffect(() => {
    const created = grid.current;
    if (!created || told.current === created) return;
    told.current = created;
    // Not of a grid replaced, or destroyed (its root removed) as its cells committed.
    const tell = () => {
      if (grid.current === created && created.root.parentElement)
        render.current?.({ revision: created.drawnRevision });
    };
    if (cells) cells.portals.afterCommit(tell);
    else tell();
  });

  return (
    <>
      <div ref={container} className={className} style={style} />
      {cells?.view}
    </>
  );
}

/**
 * Listens to the grid's `type` events while `handler` is given, calling
 * the latest one, as charts' event props do: no re-render subscribes again.
 */
function useGridEvent<K extends keyof GridEvents>(
  grid: RefObject<Pick<HercegGrid, "on"> | null>,
  type: K,
  handler: ((event: GridEvents[K]) => void) | undefined,
): RefObject<((event: GridEvents[K]) => void) | undefined> {
  const latest = useRef(handler);
  const subscribed = useRef<{ grid: Pick<HercegGrid, "on">; stop: () => void } | null>(null);
  useLayoutEffect(() => {
    latest.current = handler;
    const current = handler === undefined ? null : grid.current;
    if (subscribed.current?.grid === current) return;
    subscribed.current?.stop();
    subscribed.current = current && {
      grid: current,
      stop: current.on(type, (event) => latest.current?.(event)),
    };
  });
  useLayoutEffect(
    () => () => {
      subscribed.current?.stop();
      subscribed.current = null;
    },
    [],
  );
  return latest;
}
