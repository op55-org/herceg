// Svelte cells in herceg grids (`<Grid>` and `<RemoteGrid>`'s `cells`):
// snippets by column id, each cell mounted into the host the grid's cell
// host hands over (herceg/grid's `GridFrameworkRenderer`) with the grid
// component's contexts (`getAllContexts`). A cell is mounted anew when its
// host shows another row, so its state is its row's, and updated in place
// while it shows the same row. Each sits in a boundary of its own drawing
// the cell's text if it throws. The grid hands cells over in its own
// animation frames, which commit them at once (`flushSync`), and in its
// first draw, made in an effect, which Svelte's running flush commits. Each
// commit of a cell, its fallback's included, tells the grid its content is
// in its host, from an effect after the content's own. A cell's context
// keeps its fields' values once its update is superseded, so content
// running again on its own before the next draws what it drew.

import type { FieldName, Schema } from "herceg";
import type {
  FrameworkCell,
  FrameworkCells,
  GridCellContext,
  GridCellRenderer,
  GridFrameworkRenderer,
} from "herceg/grid";
import { flushSync, mount, type Snippet, unmount } from "svelte";
import GridCell from "./GridCell.svelte";

/** What a Svelte cell draws for one update of its cell. */
export type GridCellSnippet<S extends Schema = Schema> = Snippet<[cell: GridCellContext<S>]>;

/**
 * A column's Svelte cells: a snippet, or one with the fields of the row its
 * `cell.read` gives (remote grids ask for them) and how the cell takes the
 * keyboard, as `GridCellRenderer`'s.
 */
export type SvelteGridCell<S extends Schema = Schema> =
  | GridCellSnippet<S>
  | {
      readonly render: GridCellSnippet<S>;
      readonly fields?: readonly FieldName<S>[] | undefined;
      readonly interaction?: GridCellRenderer["interaction"];
    };

/** Svelte cells by column id, over the columns' own cells. */
export type SvelteGridCells<S extends Schema = Schema> = Readonly<
  Record<string, SvelteGridCell<S>>
>;

/** The renderers a grid takes for Svelte cells, by column id. */
export type CellRenderers = Readonly<Record<string, GridFrameworkRenderer>>;

/** What a mounted cell's component draws: one update of its cell, and with what. */
export interface CellPacket {
  readonly cell: GridCellContext;
  readonly drawn: () => void;
  /** The column's snippet; none for a cell handed for a renderer since replaced, which draws its text. */
  readonly render: GridCellSnippet | undefined;
  /** A control or composite cell's host, whose content's own changes are watched. */
  readonly host: HTMLElement | null;
}

/** A mounted cell's props: a packet replaced whole as its updates arrive. */
class CellProps {
  packet: CellPacket = $state.raw() as CellPacket;
  constructor(packet: CellPacket) {
    this.packet = packet;
  }
}

/** A cell mounted in a host: the row it shows, its props, and what the grid handed over last (its context as content reads it). */
interface Mounted {
  readonly scope: unknown;
  readonly id: unknown;
  readonly props: CellProps;
  readonly instance: object;
  cell: FrameworkCell;
  context: GridCellContext;
}

/**
 * The cells a grid component's grid hands over, mounted by host. One per
 * component: the grids it makes for successive models hand theirs over in
 * turn.
 */
export class CellMounts implements FrameworkCells {
  /** The component's contexts; none once it went, so a grid kept after that holds none of them. */
  #contexts: Map<unknown, unknown>;
  readonly #mounted = new Map<HTMLElement, Mounted>();
  /**
   * Hosts let go of while a draw runs, by it or by a draw it caused (a
   * cell's component destroying the grid as it mounts): none is mounted
   * again, and one mounted as it went is unmounted at once.
   */
  #dropped: Set<HTMLElement> | null = null;
  /** The `cells` prop and the renderers made of it. */
  #cells: SvelteGridCells | undefined;
  #renderers: Record<string, GridFrameworkRenderer> | undefined;
  /** Counts hand-overs, so a commit waited for is of the last. */
  #handed = 0;
  #committed = 0;
  /** What waits for the cells handed over to be committed, of updates still current (a grid's first `onrender`). */
  #waiting: (() => void)[] = [];

  /** `contexts`: the component's, from `getAllContexts()` as it was made. */
  constructor(contexts: Map<unknown, unknown>) {
    this.#contexts = contexts;
  }

  /**
   * Takes the `cells` prop: the renderers the grid takes for it, one per
   * column, the same object while its column's fields and interaction stay,
   * so a new snippet changes nothing in the grid, and a column's new fields
   * replace only that column's. Mounted cells draw with the new snippets;
   * those handed for a renderer replaced draw their text until the grid
   * lets go of their hosts.
   */
  take(cells: SvelteGridCells | undefined): CellRenderers | undefined {
    const before = this.#renderers;
    let renderers: Record<string, GridFrameworkRenderer> | undefined;
    if (cells) {
      // By column id, whatever the id: "toString" and "__proto__" are ids too.
      renderers = Object.create(null) as Record<string, GridFrameworkRenderer>;
      let changed = !before || Object.keys(before).length !== Object.keys(cells).length;
      for (const [id, cell] of Object.entries(cells)) {
        const { fields, interaction } = typeof cell === "function" ? {} : (cell ?? {});
        const kept = before?.[id];
        if (kept && same(kept.fields, fields) && kept.interaction === interaction)
          renderers[id] = kept;
        else {
          changed = true;
          renderers[id] = {
            ...(fields !== undefined && { fields }),
            ...(interaction !== undefined && { interaction }),
            framework: this,
          };
        }
      }
      if (!changed) renderers = before;
    }
    this.#cells = cells;
    this.#renderers = renderers;
    for (const mounted of this.#mounted.values()) {
      // A superseded update keeps what drew it: the next brings the new snippet.
      if (mounted.cell.context.signal.aborted) continue;
      const packet = this.#packet(mounted.cell, mounted.context);
      const { render, host } = mounted.props.packet;
      if (packet.render !== render || packet.host !== host) mounted.props.packet = packet;
    }
    return renderers;
  }

  draw(cells: readonly FrameworkCell[], released: readonly HTMLElement[], frame: boolean): void {
    const outer = this.#dropped === null;
    if (outer) this.#dropped = new Set();
    const dropped = this.#dropped!;
    try {
      for (const host of released) {
        dropped.add(host);
        this.#unmount(host);
      }
      for (const cell of cells) if (!dropped.has(cell.host)) this.#show(cell, dropped);
    } finally {
      if (outer) this.#dropped = null;
    }
    if (!outer) return;
    const handed = ++this.#handed;
    // In the grid's own frame, outside Svelte: committed before the grid
    // places the focus and paints. Otherwise (the first draw, made in an
    // effect; the grid going), Svelte's flush commits it, before paint.
    if (frame) {
      flushSync();
      this.#commit(handed);
    } else queueMicrotask(() => this.#commit(handed));
  }

  /**
   * Calls `then` once what was handed over is committed, of updates still
   * current: a first draw superseded before its commit (a parent's effect
   * scrolled the grid) waits for its successor.
   */
  afterCommit(then: () => void): void {
    this.#waiting.push(then);
    this.#commit(this.#committed);
  }

  /**
   * The component went: every cell is unmounted, nothing waits, and nothing
   * of the component's (contexts, snippets) is held for a grid kept after.
   */
  destroy(): void {
    for (const host of [...this.#mounted.keys()]) this.#unmount(host);
    this.#waiting = [];
    this.#contexts = new Map();
    this.#cells = undefined;
    this.#renderers = undefined;
  }

  #commit(handed: number) {
    this.#committed = Math.max(this.#committed, handed);
    if (
      this.#waiting.length === 0 ||
      this.#committed !== this.#handed ||
      [...this.#mounted.values()].some(({ cell }) => cell.context.signal.aborted)
    )
      return;
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const then of waiting) then();
  }

  /** Mounts a cell, or gives a mounted one its update: anew for another row. */
  #show(cell: FrameworkCell, dropped: Set<HTMLElement>) {
    const { host } = cell;
    const { scope, id } = cell.context.row.ref;
    const before = this.#mounted.get(host);
    const context = keepingReads(cell.context, cell.renderer.fields ?? []);
    if (before && before.scope === scope && before.id === id) {
      before.cell = cell;
      before.context = context;
      before.props.packet = this.#packet(cell, context);
      return;
    }
    if (before) this.#unmount(host);
    const props = new CellProps(this.#packet(cell, context));
    // Cells mounting as the grid scrolls are not appearing: no intros.
    const instance = mount(GridCell, {
      target: host,
      props,
      context: this.#contexts,
      intro: false,
    });
    if (dropped.has(host)) void unmount(instance);
    else this.#mounted.set(host, { scope, id, props, instance, cell, context });
  }

  #unmount(host: HTMLElement) {
    const mounted = this.#mounted.get(host);
    if (!mounted) return;
    this.#mounted.delete(host);
    void unmount(mounted.instance);
  }

  #packet({ renderer, drawn, host }: FrameworkCell, context: GridCellContext): CellPacket {
    const column = context.column.id;
    // Handed for a renderer since replaced: never drawn by a snippet reading other fields.
    const given = this.#renderers?.[column] === renderer ? this.#cells?.[column] : undefined;
    const render = typeof given === "function" ? given : given?.render;
    const interactive = renderer.interaction === "control" || renderer.interaction === "composite";
    return { cell: context, drawn, render, host: interactive ? host : null };
  }
}

/**
 * `cell` with the values of its renderer's `fields` kept, read as it is
 * handed over and as content reads them: once its update is superseded (a
 * draw called from code hands the next over in the grid's next frame),
 * `read` gives the last of them, so content
 * running again on its own meanwhile (state of its own or of the page
 * changed) draws the row it shows and keeps its state. Other reads throw as
 * the grid's do.
 */
function keepingReads(cell: GridCellContext, fields: readonly string[]): GridCellContext {
  const kept = new Map<string, unknown>();
  for (const field of fields) {
    try {
      kept.set(field, cell.read(field as never));
    } catch {
      // Not readable now: read later, it throws as the grid's read does.
    }
  }
  const read = (field: string) => {
    if (cell.signal.aborted && kept.has(field)) return kept.get(field);
    // Live reads follow the row's values: what content last drew is kept.
    const value = cell.read(field as never);
    kept.set(field, value);
    return value;
  };
  return { ...cell, read: read as GridCellContext["read"] };
}

function same(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return a === b || (!!a && !!b && a.length === b.length && a.every((one, i) => one === b[i]));
}
