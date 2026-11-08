// What `<Grid>`, `<RemoteGrid>`, and `<PivotGrid>` share: a grid made as the
// component's element is attached and for each new model, props applied with
// `grid.update`, the latest handlers called, and the grid bound. Svelte
// cells (cells.svelte.ts) come with the components that take them.

import type { GridOptions, Grid as HercegGrid } from "herceg/grid";
import { untrack } from "svelte";
import type { Attachment } from "svelte/attachments";
import type { CellMounts, CellRenderers, SvelteGridCell, SvelteGridCells } from "./cells.svelte.js";
import type { GridComponentProps } from "./props.js";

/** What the components need of the grids they make (each listens as `HercegGrid` does). */
type Made = Pick<HercegGrid, "destroy" | "render" | "drawnRevision" | "root"> & {
  update(options: object): void;
};

type Options = Pick<GridOptions, "ariaLabel" | "theme" | "headerHeight" | "copy">;

/** What a component makes its grid with. */
export type Make<G> = (
  container: HTMLElement,
  model: object,
  options: Options & { cells?: CellRenderers },
) => G;

/** What a component's props say of its grid, read where they are tracked. */
export interface Settings {
  model: object;
  options: Options;
  cells?: SvelteGridCells | undefined;
}

type Handlers = Pick<GridComponentProps, "onselect" | "onrowclick" | "oncellclick" | "onrender">;

/**
 * A grid of the `model` prop made by `make` in the element the returned
 * attachment is on, a new one for a new model; with `cells` (of a component
 * taking them), its Svelte cells too. `settings` and `handlers` read the
 * props; `bind` sets the component's `grid`.
 */
export function useGrid<G extends Made>(
  make: Make<G>,
  settings: () => Settings,
  handlers: () => Handlers,
  bind: (grid: G | null) => void,
  cells?: CellMounts,
): Attachment<HTMLDivElement> {
  let container: HTMLDivElement | null = null;
  let grid: G | null = null;
  /** Whether the component went: its grid and cells too, and none is made after. */
  let gone = false;
  /** The model, options, and renderers the grid has, to skip updates when none changed. */
  let applied: { model: object; key: string; renderers: CellRenderers | undefined } | null = null;

  function create(next: Settings, key: string, renderers: CellRenderers | undefined) {
    // Destroying the grid it replaces unmounted the component (a cell's teardown did).
    if (gone) return;
    const { ariaLabel, theme, headerHeight, copy } = next.options;
    const created = make(container!, next.model, {
      ariaLabel,
      ...(theme !== undefined && { theme }),
      ...(headerHeight !== undefined && { headerHeight }),
      ...(copy !== undefined && { copy }),
      ...(renderers !== undefined && { cells: renderers }),
    });
    // A cell mounting in the first draw unmounted the component: the grid
    // goes too, with the cells it mounted after, unbound and unheard.
    if (gone) {
      created.destroy();
      return;
    }
    // Grids of every model listen alike; only `select`'s selection type differs.
    const listened = created as unknown as Pick<HercegGrid, "on">;
    listened.on("select", (event) => handlers().onselect?.(event));
    listened.on("rowClick", (event) => handlers().onrowclick?.(event));
    listened.on("cellClick", (event) => handlers().oncellclick?.(event));
    listened.on("render", (event) => handlers().onrender?.(event));
    grid = created;
    applied = { model: next.model, key, renderers };
    bind(created);
    // The first frame was drawn as the grid was made, before it had
    // listeners: heard once its Svelte cells are mounted, once a grid.
    const tell = () => {
      if (grid === created && created.root.parentElement)
        handlers().onrender?.({ revision: created.drawnRevision });
    };
    if (cells) cells.afterCommit(tell);
    else tell();
  }

  function destroy() {
    grid?.destroy();
    grid = null;
    applied = null;
  }

  function sync(next: Settings) {
    if (!container || gone) return;
    const { ariaLabel, theme, headerHeight, copy } = next.options;
    const key = JSON.stringify([ariaLabel, theme, headerHeight, copy]);
    // Cells handed for renderers replaced draw their text from here on.
    const renderers = cells?.take(next.cells);
    if (!grid || applied?.model !== next.model) {
      destroy();
      create(next, key, renderers);
      return;
    }
    const last = applied;
    if (last.key === key && last.renderers === renderers) return;
    applied = { model: next.model, key, renderers };
    grid.update({ ariaLabel, theme, headerHeight, copy, ...(cells && { cells: renderers }) });
    // Cells of renderers replaced write their text before this paints.
    if (cells && last.renderers !== renderers) grid?.render();
  }

  // Made before the attachment runs, so its teardown runs as the component
  // goes even while the attachment makes the grid (a cell's setup unmounting
  // it), before the attachment has returned its own.
  $effect.pre(() => () => {
    gone = true;
    destroy();
    cells?.destroy();
  });

  // Reads every prop, nested state included, so that a change of any
  // updates the grid.
  $effect(() => {
    const next = readThrough(settings());
    untrack(() => sync(next));
  });

  return (element) => {
    container = element;
    untrack(() => sync(readThrough(settings())));
    return () => {
      destroy();
      cells?.destroy();
      container = null;
      bind(null);
    };
  };
}

/**
 * `settings` read through: state nested in the options (a `$state` theme)
 * and in `cells` (a column's `fields` or `interaction`) is read where it is
 * tracked, and what reaches the grid is plain.
 */
function readThrough({ model, options, cells }: Settings): Settings {
  let plain: Record<string, SvelteGridCell> | undefined;
  if (cells) {
    plain = Object.create(null) as Record<string, SvelteGridCell>;
    for (const [id, cell] of Object.entries(cells))
      plain[id] =
        typeof cell === "function" || !cell
          ? cell
          : {
              render: cell.render,
              fields: cell.fields && [...cell.fields],
              interaction: cell.interaction,
            };
  }
  return { model, options: $state.snapshot(options) as Options, cells: plain };
}
