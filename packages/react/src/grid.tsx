// The herceg grid as a React component, imported as `@herceg/react/grid` so
// that applications drawing only charts never load it.

import type { Schema } from "herceg";
import {
  createGrid,
  type GridEvents,
  type GridModel,
  type GridOptions,
  type Grid as HercegGrid,
} from "herceg/grid";
import {
  type CSSProperties,
  type Ref,
  type RefObject,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react";

export interface GridProps<S extends Schema = Schema>
  extends Omit<GridOptions<S>, "model" | "cells"> {
  /**
   * What the grid shows, made with `createGridModel` and owned by the
   * application. Data changes, scrolling, focus, and selection go through it
   * and the grid, never through React; a new model makes a new grid.
   */
  model: GridModel<S>;
  className?: string;
  /** Style of the container. Without a height, the grid is 320 px tall. */
  style?: CSSProperties;
  /** The underlying grid, for imperative calls such as `focusCell`. */
  ref?: Ref<HercegGrid<S> | null>;
  /** A body row was clicked (after the click selected) or Enter pressed on one of its cells: the row by its identity. */
  onRowClick?: ((event: GridEvents["rowClick"]) => void) | undefined;
  /** The same click, as on its cell (`column`), after `onRowClick`. */
  onCellClick?: ((event: GridEvents["cellClick"]) => void) | undefined;
  /**
   * The grid drew a frame of its model, as of the model's `revision`: its
   * first, drawn as it was made, once the ref is set, then every other.
   */
  onRender?: ((event: GridEvents["render"]) => void) | undefined;
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
export function Grid<S extends Schema>({
  model,
  className,
  style,
  ref,
  onRowClick,
  onCellClick,
  onRender,
  ...options
}: GridProps<S>) {
  const container = useRef<HTMLDivElement>(null);
  const grid = useRef<HercegGrid<S> | null>(null);
  /** The options the grid has, to skip updates when a re-render changed none. */
  const applied = useRef("");
  const { ariaLabel, theme, headerHeight } = options;
  const key = JSON.stringify([ariaLabel, theme, headerHeight]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: options change through update()
  useLayoutEffect(() => {
    const created = createGrid(container.current!, {
      model,
      ariaLabel,
      ...(theme !== undefined && { theme }),
      ...(headerHeight !== undefined && { headerHeight }),
    });
    grid.current = created;
    applied.current = key;
    return () => {
      created.destroy();
      grid.current = null;
    };
  }, [model]);

  useLayoutEffect(() => {
    if (!grid.current || applied.current === key) return;
    applied.current = key;
    grid.current.update({ ariaLabel, theme, headerHeight });
  });

  useGridEvent(grid, "rowClick", onRowClick);
  useGridEvent(grid, "cellClick", onCellClick);
  const render = useGridEvent(grid, "render", onRender);

  // A new model makes a new grid, which the ref then gives.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the grid changes with the model
  useImperativeHandle<HercegGrid<S> | null, HercegGrid<S> | null>(ref, () => grid.current, [model]);

  // Each grid drew its first frame as it was made, before handlers
  // subscribed: `onRender` hears of it once the ref is set, once a grid.
  const told = useRef<HercegGrid<S> | null>(null);
  useLayoutEffect(() => {
    const created = grid.current;
    if (!created || told.current === created) return;
    told.current = created;
    render.current?.({ revision: created.drawnRevision });
  });

  return <div ref={container} className={className} style={style} />;
}
