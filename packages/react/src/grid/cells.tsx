// React cells in herceg grids (`<Grid>` and `<RemoteGrid>`'s `cells`):
// render functions by column id, drawn through portals into the hosts the
// grid's cell host hands over (herceg/grid's `GridFrameworkRenderer`). The
// portals are in the grid component's tree, so cells keep the application's
// providers and context. Each is keyed by its host and row, so a cell's
// state never moves to another row, and sits in a boundary of its own whose
// fallback is the cell's text. The grid hands cells over in its own
// animation frames, which commit them at once (`flushSync`), and in its
// first draw, made in the component's layout effect, whose cells React
// commits before paint. Each commit of a cell, its fallback's included,
// tells the grid its content is in its host, from a layout effect after it.

import type { FieldName, Schema } from "herceg";
import type {
  FrameworkCell,
  FrameworkCells,
  GridCellContext,
  GridCellRenderer,
  GridFrameworkRenderer,
} from "herceg/grid";
import {
  Component,
  memo,
  type ReactNode,
  Suspense,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";

/** What a React cell draws for one update of its cell. */
export type GridCellRender<S extends Schema = Schema> = (cell: GridCellContext<S>) => ReactNode;

/**
 * A column's React cells: a render function, or one with the fields of the
 * row its `cell.read` gives (remote grids ask for them) and how the cell
 * takes the keyboard, as `GridCellRenderer`'s.
 */
export type ReactGridCell<S extends Schema = Schema> =
  | GridCellRender<S>
  | {
      readonly render: GridCellRender<S>;
      readonly fields?: readonly FieldName<S>[] | undefined;
      readonly interaction?: GridCellRenderer["interaction"];
    };

/** React cells by column id, over the columns' own cells. */
export type ReactGridCells<S extends Schema = Schema> = Readonly<Record<string, ReactGridCell<S>>>;

/** The renderers a grid takes for React cells, by column id. */
export type CellRenderers = Readonly<Record<string, GridFrameworkRenderer>>;

/** A cell handed over: its portal's key, and the column and renderer it was handed for. */
interface Entry {
  readonly key: string;
  readonly column: string;
  readonly renderer: GridFrameworkRenderer;
  readonly cell: FrameworkCell;
}

const NONE: readonly Entry[] = [];

/**
 * The cells a grid component's grid hands over, by host, and what shows
 * them (`<GridCells>`, while mounted). One per component: the grids it makes
 * for successive models hand theirs over in turn.
 */
export class CellPortals implements FrameworkCells {
  readonly #entries = new Map<HTMLElement, Entry>();
  #made = 0;
  /** The entries as last handed over, a new list each time. */
  entries = NONE;
  /** The entries `<GridCells>` last committed. */
  committed = NONE;
  /** Sets `<GridCells>`'s entries while it is mounted. */
  show: ((entries: readonly Entry[]) => void) | null = null;
  /** What waits for the entries handed over to be committed (a grid's first `onRender`). */
  #waiting: (() => void)[] = [];

  draw(cells: readonly FrameworkCell[], released: readonly HTMLElement[], frame: boolean): void {
    const entries = this.#entries;
    for (const host of released) entries.delete(host);
    for (const cell of cells) {
      const { scope, id } = cell.context.row.ref;
      const before = entries.get(cell.host);
      const row = before?.cell.context.row.ref;
      const column = cell.context.column.id;
      entries.set(cell.host, {
        // A new key for another row: the component's state is its row's.
        key: row && row.scope === scope && row.id === id ? before!.key : String(++this.#made),
        column,
        renderer: cell.renderer,
        cell,
      });
    }
    // A new list each time, never changed: a commit this hand-off makes
    // (below) may hand cells over again, which set the next.
    const list = [...entries.values()];
    this.entries = list;
    const show = this.show;
    // Nothing shows them (the cells went): handed over is as committed.
    if (!show) {
      this.commit(list);
      return;
    }
    // In the grid's own frame, outside React: committed before the grid
    // places the focus and paints. Otherwise (the first draw, made in a
    // layout effect; the grid going), React commits it before paint.
    if (frame) flushSync(() => show(list));
    else show(list);
  }

  /**
   * Calls `then` once what was handed over is committed, of updates still
   * current: a first draw superseded before its commit (a parent's effect
   * scrolled the grid) waits for its successor.
   */
  afterCommit(then: () => void): void {
    this.#waiting.push(then);
    this.commit(this.committed);
  }

  /** `<GridCells>` went: nothing more commits, so what waits goes on, and no host is held. */
  detach(): void {
    this.show = null;
    this.#entries.clear();
    this.entries = NONE;
    this.commit(NONE);
  }

  /** `<GridCells>` committed `entries`. */
  commit(entries: readonly Entry[]): void {
    this.committed = entries;
    if (
      this.#waiting.length === 0 ||
      (this.show !== null &&
        (entries !== this.entries || entries.some(({ cell }) => cell.context.signal.aborted)))
    )
      return;
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const then of waiting) then();
  }
}

/**
 * The renderers the grid takes for `cells`: one per column, the same object
 * while its column's fields and interaction stay, so a new render function
 * (a component's re-render) changes nothing in the grid, and a column's new
 * fields replace only that column's.
 */
function useCellRenderers<S extends Schema>(
  cells: ReactGridCells<S> | undefined,
  portals: CellPortals,
): CellRenderers | undefined {
  const last = useRef<CellRenderers | undefined>(undefined);
  const signature =
    cells &&
    JSON.stringify(
      Object.entries(cells).map(([id, cell]) =>
        typeof cell === "function" ? [id] : [id, cell?.fields, cell?.interaction],
      ),
    );
  // biome-ignore lint/correctness/useExhaustiveDependencies: renderers change with their columns' fields and interaction
  const renderers = useMemo(() => {
    if (!cells) return undefined;
    const before = last.current;
    // By column id, whatever the id: "toString" and "__proto__" are ids too.
    const made: Record<string, GridFrameworkRenderer> = Object.create(null);
    for (const [id, cell] of Object.entries(cells)) {
      const { fields, interaction } = typeof cell === "function" ? {} : (cell ?? {});
      const kept = before?.[id];
      made[id] =
        kept && same(kept.fields, fields) && kept.interaction === interaction
          ? kept
          : {
              ...(fields !== undefined && { fields }),
              ...(interaction !== undefined && { interaction }),
              framework: portals,
            };
    }
    return made;
  }, [signature, portals]);
  useLayoutEffect(() => {
    last.current = renderers;
  }, [renderers]);
  return renderers;
}

function same(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return a === b || (!!a && !!b && a.length === b.length && a.every((one, i) => one === b[i]));
}

/** A grid component's React cells: their store, the renderers its grid takes, and their portals. */
export interface ReactCells {
  readonly portals: CellPortals;
  readonly renderers: CellRenderers | undefined;
  readonly view: ReactNode;
}

/** The React cells of a component taking `cells`, for `useGrid`. */
export function useReactCells<S extends Schema>(cells: ReactGridCells<S> | undefined): ReactCells {
  const [portals] = useState(() => new CellPortals());
  const renderers = useCellRenderers(cells, portals);
  return {
    portals,
    renderers,
    // Mounted while the component is, with cells or not: cells going draw
    // their text until the grid lets go of their hosts.
    view: <GridCells portals={portals} cells={cells} renderers={renderers} />,
  };
}

/** The portals of the cells `portals` holds, each drawn by its column's render function. */
function GridCells<S extends Schema>({
  portals,
  cells,
  renderers,
}: {
  portals: CellPortals;
  cells: ReactGridCells<S> | undefined;
  renderers: CellRenderers | undefined;
}) {
  const [entries, setEntries] = useState(portals.entries);
  // biome-ignore lint/correctness/useExhaustiveDependencies: entries handed over before this listened, once
  useLayoutEffect(() => {
    portals.show = setEntries;
    // Handed over before this listened.
    if (portals.entries !== entries) setEntries(portals.entries);
    return () => portals.detach();
  }, [portals]);
  useLayoutEffect(() => portals.commit(entries), [portals, entries]);
  return entries.map(({ key, column, renderer, cell }) => {
    // Handed for a renderer this render replaces or removes: never drawn by
    // a render function reading other fields, it draws its text until the
    // grid lets go of its host (before paint, or in the grid's next frame
    // when this commit is the grid's own).
    if (renderers?.[column] !== renderer) return createPortal(cell.context.text, cell.host, key);
    const given = cells && Object.hasOwn(cells, column) ? cells[column] : undefined;
    const render = (typeof given === "function" ? given : given?.render) as
      | GridCellRender
      | undefined;
    const interaction = renderer?.interaction;
    return createPortal(
      <Cell
        render={render}
        cell={cell.context as GridCellContext}
        drawn={cell.drawn}
        host={interaction === "control" || interaction === "composite" ? cell.host : null}
      />,
      cell.host,
      key,
    );
  });
}

interface CellProps {
  render: GridCellRender | undefined;
  cell: GridCellContext;
  drawn: () => void;
  /** A control or composite cell's host, whose content's own changes are watched. */
  host: HTMLElement | null;
}

/**
 * A cell in its boundary, drawing its text if it throws or suspends. An
 * update the grid has superseded (its signal aborted: the next is on its
 * way, or the host is let go of) is not drawn again, so no render reads a
 * row its cell no longer shows: rendered all the same (as a suspended cell
 * reveals), it draws its text until the next arrives.
 */
const Cell = memo(
  function Cell({ render, cell, drawn, host }: CellProps) {
    const fallback = (
      <>
        {cell.text}
        <Drawn drawn={drawn} />
      </>
    );
    return (
      <>
        <Boundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <Content render={render} cell={cell} />
            <Drawn drawn={drawn} />
          </Suspense>
        </Boundary>
        {host && <Watch host={host} drawn={drawn} />}
      </>
    );
  },
  (before, after) =>
    after.cell.signal.aborted ||
    (before.render === after.render &&
      before.cell === after.cell &&
      before.drawn === after.drawn &&
      before.host === after.host),
);

function Content({ render, cell }: Pick<CellProps, "render" | "cell">) {
  if (cell.signal.aborted) return cell.text;
  return render ? render(cell) : null;
}

/**
 * Tells the grid the cell's content is in its host, on each commit: after
 * the content's own layout effects, and again as a suspended cell reveals.
 */
function Drawn({ drawn }: { drawn: () => void }) {
  useLayoutEffect(() => drawn());
  return null;
}

/**
 * A control or composite cell's content changed on its own (a component's
 * state, a boundary inside it revealing or suspending again): told to the
 * grid as drawn too, before paint, so the cell's focus and tab stop follow
 * its controls. Elements coming and going, and the attributes that make
 * one take the focus or not.
 */
function Watch({ host, drawn }: { host: HTMLElement; drawn: () => void }) {
  const latest = useRef(drawn);
  useLayoutEffect(() => {
    latest.current = drawn;
  });
  useLayoutEffect(() => {
    const observer = new MutationObserver(() => latest.current());
    observer.observe(host, { childList: true, subtree: true, attributeFilter: FOCUSING });
    return () => observer.disconnect();
  }, [host]);
  return null;
}

/**
 * Attributes deciding whether an element takes the focus, or is drawn at
 * all; the grid's own `tabindex` writes change only what differs, and
 * leave its tab stop be, so they settle.
 */
const FOCUSING = ["disabled", "hidden", "inert", "href", "type", "style", "class", "tabindex"];

/**
 * A cell's error boundary: a cell that throws draws its fallback, and its
 * error is reported once, until the cell shows another row (a new key).
 */
class Boundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    if (typeof reportError === "function") reportError(error);
    else console.error(error);
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
