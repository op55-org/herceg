// Vue cells in herceg grids (`<Grid>` and `<RemoteGrid>`): scoped slots
// named `cell-<column id>`, or render functions in `cells`, drawn through
// teleports into the hosts the grid's cell host hands over (herceg/grid's
// `GridFrameworkRenderer`). The teleports are in the grid component's tree,
// so cells keep provide and inject. Each is keyed by its host and row, so a
// cell's state never moves to another row, and sits in a boundary of its own
// drawing the cell's text if it throws. Vue commits what a frame hands over
// in the microtask after the grid's animation frame callback, before paint;
// each commit of a cell, its fallback's included, tells the grid its content
// is in its host (from the cell's mounted or updated hook, after its
// content's), and the grid then moves the focus into a focused control. A
// cell's context keeps its fields' values once its update is superseded, so
// content rendering again on its own before the next draws what it drew.

import type { FieldName, Schema } from "herceg";
import type {
  FrameworkCell,
  FrameworkCells,
  GridCellContext,
  GridCellRenderer,
  GridFrameworkRenderer,
} from "herceg/grid";
import {
  createTextVNode,
  defineComponent,
  h,
  onBeforeUnmount,
  onErrorCaptured,
  onMounted,
  onUpdated,
  type PropType,
  type ShallowRef,
  type Slot,
  type Slots,
  shallowRef,
  Teleport,
  toRaw,
  type VNode,
  type VNodeChild,
} from "vue";

/** What a Vue cell draws for one update of its cell. */
export type GridCellRender<S extends Schema = Schema> = (cell: GridCellContext<S>) => VNodeChild;

/**
 * A column's Vue cells in `cells`: a render function, or one with the
 * fields of the row its `cell.read` gives (remote grids ask for them) and
 * how the cell takes the keyboard, as `GridCellRenderer`'s. A column drawn
 * by its slot (`#cell-<id>`) gives only `fields` and `interaction` here.
 */
export type VueGridCell<S extends Schema = Schema> =
  | GridCellRender<S>
  | {
      readonly render?: GridCellRender<S> | undefined;
      readonly fields?: readonly FieldName<S>[] | undefined;
      readonly interaction?: GridCellRenderer["interaction"];
    };

/** Vue cells by column id, over the columns' own cells. */
export type VueGridCells<S extends Schema = Schema> = Readonly<Record<string, VueGridCell<S>>>;

/** Scoped slots drawing columns' cells, by column id: `<template #cell-open="{ cell }">`. */
export type GridCellSlots<S extends Schema = Schema> = {
  [K: `cell-${string}`]: ((props: { cell: GridCellContext<S> }) => VNode[]) | undefined;
};

/** The renderers a grid takes for Vue cells, by column id. */
export type CellRenderers = Readonly<Record<string, GridFrameworkRenderer>>;

/** A cell handed over: its teleport's key, the column and renderer it was handed for, and its context as content reads it. */
interface Entry {
  readonly key: string;
  readonly column: string;
  readonly renderer: GridFrameworkRenderer;
  readonly cell: FrameworkCell;
  readonly context: GridCellContext;
}

const NONE: readonly Entry[] = [];
const SLOT = "cell-";

/**
 * The cells a grid component's grid hands over, by host, which
 * `<GridCells>` teleports into their hosts. One per component: the grids it
 * makes for successive models hand theirs over in turn.
 */
export class CellTeleports implements FrameworkCells {
  readonly #entries = new Map<HTMLElement, Entry>();
  #made = 0;
  /** The entries as last handed over, a new list each time, which `<GridCells>` renders. */
  readonly list: ShallowRef<readonly Entry[]> = shallowRef(NONE);
  /** The entries `<GridCells>` last committed. */
  committed = NONE;
  /** Whether `<GridCells>` is mounted to show them. */
  shown = false;
  /** What waits for the entries handed over to be committed, of updates still current (a grid's first `render`). */
  #waiting: (() => void)[] = [];
  /** What waits for the entries handed over to be committed (frames' `render`). */
  #heard: (() => void)[] = [];

  draw(cells: readonly FrameworkCell[], released: readonly HTMLElement[]): void {
    const entries = this.#entries;
    for (const host of released) entries.delete(host);
    for (const cell of cells) {
      const { scope, id } = cell.context.row.ref;
      const before = entries.get(cell.host);
      const row = before?.cell.context.row.ref;
      entries.set(cell.host, {
        // A new key for another row: the component's state is its row's.
        key: row && row.scope === scope && row.id === id ? before!.key : String(++this.#made),
        column: cell.context.column.id,
        renderer: cell.renderer,
        cell,
        context: keepingReads(cell.context as GridCellContext, cell.renderer.fields ?? []),
      });
    }
    // A new list each time, never changed. Vue commits it in its next
    // flush: the microtask after the grid's frame, before paint; within the
    // flush making the grid (or one running), for the first draw.
    const list = [...entries.values()];
    this.list.value = list;
    // Nothing shows them (the cells went): handed over is as committed.
    if (!this.shown) this.commit(list);
  }

  /**
   * Calls `then` once what was handed over is committed, of updates still
   * current: a first draw superseded before its commit (a parent's hook
   * scrolled the grid) waits for its successor.
   */
  afterCommit(then: () => void): void {
    this.#waiting.push(then);
    this.commit(this.committed);
  }

  /** Calls `then` once what was handed over is committed: at once if it is. */
  whenCommitted(then: () => void): void {
    if (this.committed === this.list.value) then();
    else this.#heard.push(then);
  }

  /** `<GridCells>` went: nothing more commits, so what waits goes on, and no host is held. */
  detach(): void {
    this.shown = false;
    this.#entries.clear();
    this.list.value = NONE;
    this.commit(NONE);
  }

  /** `<GridCells>` committed `entries`. */
  commit(entries: readonly Entry[]): void {
    this.committed = entries;
    const current = !this.shown || entries === this.list.value;
    if (current && this.#heard.length > 0) {
      const heard = this.#heard;
      this.#heard = [];
      for (const then of heard) then();
    }
    if (
      this.#waiting.length === 0 ||
      !(current && (!this.shown || !entries.some(({ cell }) => cell.context.signal.aborted)))
    )
      return;
    const waiting = this.#waiting;
    this.#waiting = [];
    for (const then of waiting) then();
  }
}

/** What names a model's column: its id, else its field. */
interface ColumnIds {
  readonly id?: string | undefined;
  readonly field?: string | undefined;
}

/** What draws one column's cells: its slot, or its render function. */
interface Drawing {
  readonly render: Slot | GridCellRender | undefined;
  /** A slot, called with `{ cell }`; else a render function, with the cell. */
  readonly slotted: boolean;
}

/** A grid component's Vue cells: their store, the renderers its grid takes, and their teleports. */
export interface VueCells {
  readonly store: CellTeleports;
  /** The renderers for the `cells` prop and slots of this render (it reads them); throws on a column drawn twice or never. */
  renderers(): CellRenderers | undefined;
  readonly view: () => VNode;
}

/**
 * The Vue cells of a component taking `cells` and cell slots, for
 * `useGrid`. Renderers are one per column, the same object while its
 * column's fields and interaction stay, so a new render function or slot
 * (a parent's render) changes nothing in the grid, and a column's new
 * fields replace only that column's.
 */
export function useVueCells(
  props: { model: object; cells?: VueGridCells | undefined },
  slots: Slots,
  maker: string,
): VueCells {
  const store = new CellTeleports();
  let last: Record<string, GridFrameworkRenderer> | undefined;
  /** What draws each column, as of the last render. */
  let drawing: Record<string, Drawing> = Object.create(null);
  return {
    store,
    renderers() {
      const cells = props.cells;
      // By column id, whatever the id: "toString" and "__proto__" are ids too.
      const drawn: Record<string, Drawing> = Object.create(null);
      const settings: Record<string, VueGridCell> = Object.create(null);
      if (cells) for (const [id, cell] of Object.entries(cells)) settings[id] = cell;
      const slotted = Object.keys(slots).filter((name) => name.startsWith(SLOT));
      if (slotted.length > 0) {
        // Named as the template writes it; the grid checks `cells`' ids.
        const ids = (toRaw(props.model) as { columns: readonly ColumnIds[] }).columns.map(
          (column) => column.id ?? column.field!,
        );
        for (const name of slotted) {
          const id = name.slice(SLOT.length);
          if (!ids.includes(id))
            throw new Error(
              `${maker} #${name}: no column ${JSON.stringify(id)}; the columns are ${ids.map((one) => JSON.stringify(one)).join(", ")}`,
            );
          drawn[id] = { render: slots[name], slotted: true };
        }
      }
      for (const id of Object.keys(settings)) {
        const cell = settings[id];
        const render = typeof cell === "function" ? cell : cell?.render;
        if (render !== undefined && id in drawn)
          throw new Error(
            `${maker} cells.${id}: a render function and the #${SLOT}${id} slot both draw it; drop one`,
          );
        if (render === undefined && !(id in drawn))
          throw new Error(
            `${maker} cells.${id}: nothing draws its cells; give render, or a #${SLOT}${id} slot`,
          );
        if (render !== undefined) drawn[id] = { render, slotted: false };
      }
      drawing = drawn;
      const ids = Object.keys(drawn);
      if (ids.length === 0 && !cells) {
        last = undefined;
        return undefined;
      }
      const made: Record<string, GridFrameworkRenderer> = Object.create(null);
      let changed = !last || Object.keys(last).length !== ids.length;
      for (const id of ids) {
        const cell = settings[id];
        const given = typeof cell === "function" || !cell ? undefined : cell;
        // Copied: read through, so a reactive array changed in place renders
        // again, and the grid's renderer never changes under its cells.
        const fields = given?.fields && [...given.fields];
        const interaction = given?.interaction;
        const kept = last?.[id];
        if (kept && same(kept.fields, fields) && kept.interaction === interaction) made[id] = kept;
        else {
          changed = true;
          made[id] = {
            ...(fields !== undefined && { fields }),
            ...(interaction !== undefined && { interaction }),
            framework: store,
          };
        }
      }
      if (changed) last = made;
      return last;
    },
    // Mounted while the component is, with cells or not: cells going draw
    // their text until the grid lets go of their hosts.
    view: () =>
      h(GridCells, {
        store,
        renderers: last,
        drawing: (column: string) => drawing[column],
      }),
  };
}

function same(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  return a === b || (!!a && !!b && a.length === b.length && a.every((one, i) => one === b[i]));
}

/** The teleports of the cells `store` holds, each drawn by its column's slot or render function. */
const GridCells = defineComponent({
  props: {
    store: { type: Object as PropType<CellTeleports>, required: true },
    renderers: Object as PropType<CellRenderers | undefined>,
    drawing: {
      type: Function as PropType<(column: string) => Drawing | undefined>,
      required: true,
    },
  },
  setup(props) {
    const store = props.store;
    let rendered = store.list.value;
    onMounted(() => {
      store.shown = true;
      store.commit(rendered);
    });
    onUpdated(() => store.commit(rendered));
    onBeforeUnmount(() => store.detach());
    return () => {
      const entries = store.list.value;
      rendered = entries;
      const renderers = props.renderers;
      return entries.map(({ key, column, renderer, cell, context }) => {
        const to = cell.host;
        // Handed for a renderer this render replaces or removes: never drawn
        // by a slot or function reading other fields, it draws its text until
        // the grid lets go of its host (before paint).
        if (renderers?.[column] !== renderer)
          return h(Teleport, { to, key }, [createTextVNode(cell.context.text)]);
        const drawing = props.drawing(column);
        const interaction = renderer.interaction;
        return h(Teleport, { to, key }, [
          h(Cell, {
            render: drawing?.render,
            slotted: drawing?.slotted ?? false,
            cell: context,
            drawn: cell.drawn,
            host: interaction === "control" || interaction === "composite" ? to : null,
          }),
        ]);
      });
    };
  },
});

/** A cell's props: what draws it, its update, and its host when its own changes are watched. */
const cellProps = {
  render: Function as PropType<Slot | GridCellRender | undefined>,
  slotted: { type: Boolean, required: true },
  cell: { type: Object as PropType<GridCellContext>, required: true },
} as const;

/**
 * A cell in its boundary, drawing its text if it throws. An update the grid
 * has superseded (its signal aborted: the next is on its way, or the host is
 * let go of) is not given to new render functions or slots; content
 * rendering again on its own before the next update arrives reads the
 * values its update had (`keepingReads`), so it draws what it drew and
 * keeps its state.
 */
const Cell = defineComponent({
  props: {
    ...cellProps,
    drawn: { type: Function as PropType<() => void>, required: true },
    /** A control or composite cell's host, whose content's own changes are watched. */
    host: Object as PropType<HTMLElement | null | undefined>,
  },
  setup(props) {
    const failed = shallowRef(false);
    /** What the content last drew: an update still current. */
    let live = { render: props.render, slotted: props.slotted, cell: props.cell };
    onErrorCaptured((error, _instance, info) => {
      // Errors of event handlers inside the cell are the application's, as
      // React's boundaries leave them; others draw the cell's text.
      if (handling(info)) return;
      if (!failed.value) {
        failed.value = true;
        report(error);
      }
      return false;
    });
    // Each commit, the fallback's too, after the content's own hooks.
    onMounted(() => props.drawn());
    onUpdated(() => props.drawn());
    // A control or composite cell's content changed on its own (a
    // component's state): told to the grid as drawn too, before paint, so
    // the cell's focus and tab stop follow its controls.
    let observer: MutationObserver | null = null;
    onMounted(() => {
      const host = props.host;
      if (!host) return;
      observer = new MutationObserver(() => props.drawn());
      observer.observe(host, { childList: true, subtree: true, attributeFilter: FOCUSING });
    });
    onBeforeUnmount(() => observer?.disconnect());
    return () => {
      if (failed.value) return props.cell.text;
      if (!props.cell.signal.aborted)
        live = { render: props.render, slotted: props.slotted, cell: props.cell };
      return h(Content, live);
    };
  },
});

/**
 * The cell's content, in a component of its own, so its boundary catches
 * what its render throws. An update superseded before the content drew it
 * draws the cell's text; one it drew, it draws again with its reads kept.
 */
const Content = defineComponent({
  props: cellProps,
  setup(props) {
    let drew: GridCellContext | null = null;
    return () => {
      const { render, cell } = props;
      if (cell.signal.aborted && drew !== cell) return cell.text;
      drew = cell;
      if (!render) return null;
      return props.slotted ? (render as Slot)({ cell }) : (render as GridCellRender)(cell);
    };
  },
});

/**
 * `cell` with the values of its renderer's `fields` kept, read as it is
 * handed over and as content reads them: once its update is superseded (a
 * draw called from code hands the next over in the grid's next frame),
 * `read` gives the last of them, so content
 * rendering again on its own meanwhile (state of its own or of the page
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

/**
 * Whether Vue's `info` of a captured error names an event handler (its
 * development text, or a production build's code: 5 and 6).
 */
function handling(info: string): boolean {
  return /event handler$|#runtime-[56]$/.test(info);
}

function report(error: unknown) {
  if (typeof reportError === "function") reportError(error);
  else console.error(error);
}

/**
 * Attributes deciding whether an element takes the focus, or is drawn at
 * all; the grid's own `tabindex` writes change only what differs, and
 * leave its tab stop be, so they settle.
 */
const FOCUSING = ["disabled", "hidden", "inert", "href", "type", "style", "class", "tabindex"];
