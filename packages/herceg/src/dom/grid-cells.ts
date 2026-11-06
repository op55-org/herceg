// The cell host: what a grid's cell elements hold besides their text
// (docs/guide/grids.md, "Cells"). A cell element shows its text, which the
// grid writes; a text cell of a field whose display gives its row a link
// holds it in an anchor; a cell of a column with a kind (grid/cells.ts)
// holds the kind's view, built once the element is given the column and
// kept across rows, only attributes and text changing; and a cell of a
// column with a custom renderer (`createGrid`'s `cells`) holds the
// renderer's view in a host element of its own. A view belongs to a cell
// element while the element shows its column: it is created when the
// element is first given it, updated as the element shows other rows, and
// destroyed when the element leaves the column, shows a row of another kind
// (a group's, a placeholder, which write text), or the renderer is
// replaced, and when the grid is destroyed. Each update has a signal of its
// own, aborted by the next update and on destroy.

import type { FieldName, ReadValue, Schema } from "../data/table.ts";
import type { BaseGridModel, GridCellRead, SelectionState, ShownRow } from "../grid/base.ts";
import type { CellKind, CellPaint, CellView } from "../grid/cells.ts";
import { columnId, type GridColumnLayout, type PlacedColumn } from "../grid/columns.ts";
import { report } from "./scheduler.ts";

/** What a custom renderer is told of the cell it draws, for one update. */
export interface GridCellContext<S extends Schema = Schema> extends GridCellRead {
  /**
   * The row: renderers draw table rows only (others write text, and the
   * view is destroyed). Rows are the same row when their refs' `scope` and
   * `id` agree.
   */
  readonly row: Extract<ShownRow, { kind: "row" }>;
  readonly rowIndex: number;
  readonly column: GridColumnLayout;
  readonly selected: SelectionState;
  /**
   * Aborted when this update is superseded (the cell's next update) and on
   * destroy: work done asynchronously checks it before drawing its result.
   */
  readonly signal: AbortSignal;
  /** A field of the row among those the renderer names in `fields`, raw; until `signal` aborts. */
  read<F extends FieldName<S>>(field: F): ReadValue<S[F]>;
}

/** What one cell element draws for a custom renderer, while the element shows its column. */
export interface GridCellView<S extends Schema = Schema> {
  /**
   * Draws the cell: when first shown, and when it shows another row, its
   * row's version moves, its column's content, look, or selection changes,
   * or its row index moves.
   */
  update(cell: GridCellContext<S>): void;
  /**
   * Once: the element left the column, its cell showed a row of another
   * kind, the renderer was replaced, or the grid was destroyed.
   */
  destroy?(): void;
}

/**
 * A custom renderer of a column's cells. The grid owns the cell (its
 * place, role, focus, selection, and look); the renderer owns what it
 * draws in `host`.
 */
export interface GridCellRenderer<S extends Schema = Schema> {
  /** Other fields of the row `read` gives, which remote grids then ask for. */
  readonly fields?: readonly FieldName<S>[] | undefined;
  /**
   * How the cell takes the keyboard: "text" (the default: what it draws is
   * presentation, and the cell's text names it), "control" (one button or
   * link takes the cell's focus; Enter and Space are its), or "composite"
   * (several controls, or one using arrow keys: Enter or F2 moves the
   * focus in, Escape back). Presses on a control or composite cell are its
   * own, not the grid's.
   */
  readonly interaction?: "text" | "control" | "composite" | undefined;
  create(host: HTMLElement): GridCellView<S>;
}

/**
 * A framework adapter's renderer (React's, Vue's, and Svelte's cells): in
 * each draw, after DOM renderers' updates and before the focus is placed,
 * the grid hands it the cells it draws (`FrameworkCells`), and it tells the
 * grid as each one's content is in its host.
 */
export interface GridFrameworkRenderer<S extends Schema = Schema> {
  readonly fields?: readonly FieldName<S>[] | undefined;
  readonly interaction?: GridCellRenderer["interaction"];
  readonly framework: FrameworkCells<S>;
}

/** What draws a framework's cells into their hosts. */
export interface FrameworkCells<S extends Schema = Schema> {
  /**
   * Draws `cells` (mounted, or shown another row or update) and lets go of
   * `released` hosts. `frame`: the grid draws in its own animation frame,
   * so the framework may commit at once; else (the first draw) it commits
   * on its own before paint. A cell whose row changed shows its text until
   * its content is drawn (`FrameworkCell.drawn`).
   */
  draw(cells: readonly FrameworkCell<S>[], released: readonly HTMLElement[], frame: boolean): void;
}

/** A cell a framework draws, for one update. */
export interface FrameworkCell<S extends Schema = Schema> {
  readonly host: HTMLElement;
  readonly context: GridCellContext<S>;
  /**
   * The renderer the grid drew the cell for: its column's as it drew, whose
   * `fields` the context reads (a framework's renderers may since differ).
   */
  readonly renderer: GridFrameworkRenderer;
  /**
   * Tells the grid what the framework drew for `context` is in the host
   * (committed, or revealed after suspending): the cell shows it, and a
   * control cell focused takes the focus into it. Ignored once the cell
   * has been handed a later update.
   */
  drawn(): void;
}

/** Custom renderers by column id. */
export type GridCellRenderers<S extends Schema = Schema> = Readonly<
  Record<string, GridCellRenderer<S> | GridFrameworkRenderer<S>>
>;

type Renderer = GridCellRenderer | GridFrameworkRenderer;

/** What takes the keys of what a cell holds: its link, its control, or a composite's controls. */
type Interaction = "link" | "control" | "composite";

/** What a cell element holds besides its text. */
type Held =
  | { readonly type: "link"; readonly anchor: HTMLAnchorElement }
  | { readonly type: "kind"; readonly kind: CellKind; readonly view: CellView }
  | Custom;

/** A custom renderer's view in a cell element of column `column`, and what it last drew. */
interface Custom {
  readonly type: "custom";
  readonly renderer: Renderer;
  readonly column: string;
  readonly host: HTMLElement;
  view: GridCellView | null;
  /** A framework's cells: updates handed over, and whether the host shows the last one's content. */
  handed: number;
  shown: boolean;
  /**
   * What frameworks' acknowledgements reach while the view lives: cleared
   * as it goes, so callbacks a framework keeps hold nothing of the grid's.
   */
  readonly ack: { drawn: ((handed: number) => void) | null };
  /** The renderer threw for this element: it writes its text until it leaves the column. */
  failed: boolean;
  /** The last update's signal, and the row's values reads hold until it aborts. */
  controller: AbortController | null;
  reader: Reader;
  /** What the last update was of. */
  drawn: { scope: unknown; id: unknown; index: number; selected: SelectionState } | null;
}

/** What a context's `read` reads: the row's values, bound to the row; null once its update is superseded. */
interface Reader {
  values: ((field: string) => number | string | null) | null;
}

/** A grid's cell element, as the host reads it. */
export interface HostedCell {
  readonly element: HTMLElement;
  readonly text: Text;
  held: Held | null;
}

/** What the grid paints a hosted cell with. */
export interface HostPaint extends CellPaint {
  /** Writes the cell's look: its fill, and with `color` its text's color. */
  look(cell: HostedCell, look: GridCellRead["look"], color: boolean): void;
}

const INTERACTIONS = ["text", "control", "composite"];

const G = ".herceg-grid";
/**
 * What links and renderers' hosts draw with, added as the first mounts, so
 * grids without them match none of it. A cell holding one (`data-held`)
 * shows the focus its link or controls take. A host waiting for its
 * framework's content is laid out under the cell's text, unseen, so content
 * measuring itself as it mounts finds the cell's size.
 */
const HOST_CSS = `${G} .hg-link{color:var(--hg-look-color,var(--hg-accent));text-decoration:underline}
${G} [data-look~=fill] .hg-link{color:inherit}
${G} .hg-link:not([href]){color:inherit;text-decoration:none}
${G} .hg-link:focus{outline:none}
${G} [data-held]:focus-within{outline:2px solid var(--hg-accent);outline-offset:-2px}
${G} .hg-host{height:100%}
${G} .hg-host[hidden]{display:block;visibility:hidden}
@media (forced-colors:active){${G} [data-held]:focus-within{outline-color:CanvasText}}`;

/**
 * Why updates' signals abort. One, made here: an error made as a signal
 * aborts would hold the frames it was made in (the grid's), and so would
 * every signal a renderer keeps.
 */
const SUPERSEDED = new DOMException("The cell's update was superseded", "AbortError");

export class CellHost {
  readonly #root: HTMLElement;
  readonly #surface: string;
  /** Called as a framework's content of a cell is in its host. */
  readonly #shown: (cell: HostedCell) => void;
  /** The grid's tab stop, which stays one as hosts' other controls leave the tab order. */
  readonly #stop: () => Element | null;
  #renderers: ReadonlyMap<string, Renderer> = new Map();
  /** Framework cells to hand over, by framework. */
  readonly #batches = new Map<
    FrameworkCells,
    { cells: FrameworkCell[]; released: HTMLElement[] }
  >();
  /** Stylesheets the grid's root holds: the host's, and kinds' by name. */
  readonly #styled = new Set<string>();
  /** Every cell element holding something, so destroying the grid destroys their views. */
  readonly #holding = new Set<HostedCell>();
  /** The grid went: nothing more is drawn, and a view made as it went is destroyed at once. */
  #destroyed = false;
  /** The model asked for the renderers' fields, which lets go of them as the grid goes. */
  #asked: BaseGridModel | null = null;
  /** Whether each shown column is hosted, for the layout and renderers it was found for. */
  #hosts: { layout: readonly PlacedColumn[]; renderers: unknown; hosted: boolean[] } | null = null;

  constructor(
    root: HTMLElement,
    surface: string,
    shown: (cell: HostedCell) => void,
    stop: () => Element | null,
  ) {
    this.#root = root;
    this.#surface = surface;
    this.#shown = shown;
    this.#stop = stop;
  }

  /**
   * Takes `cells` (by column id) as the renderers, checked against the
   * model's columns, and hands the model the fields they read (`maker`, what
   * takes them, names them in messages); a refused one changes nothing.
   */
  setRenderers(cells: GridCellRenderers | undefined, model: BaseGridModel, maker: string): void {
    const renderers = new Map<string, Renderer>();
    const asked: [string, string][] = [];
    const at = `${maker} cells`;
    if (cells !== undefined) {
      if (typeof cells !== "object" || cells === null || Array.isArray(cells))
        throw new TypeError(
          `${at}: expected renderers by column id; received ${JSON.stringify(cells)}`,
        );
      const ids = model.columns.map((column) => columnId(column));
      for (const [id, renderer] of Object.entries(cells)) {
        const path = `${at}.${id}`;
        if (!ids.includes(id))
          throw new Error(
            `${path}: no column ${JSON.stringify(id)}; the columns are ${ids.map((one) => JSON.stringify(one)).join(", ")}`,
          );
        if (
          typeof (renderer as GridCellRenderer)?.create !== "function" &&
          typeof (renderer as GridFrameworkRenderer)?.framework?.draw !== "function"
        )
          throw new TypeError(`${path}: expected a renderer, { create(host) }`);
        const { interaction, fields = [] } = renderer;
        if (interaction !== undefined && !INTERACTIONS.includes(interaction))
          throw new TypeError(
            `${path}.interaction: expected "text", "control", or "composite"; received ${JSON.stringify(interaction)}`,
          );
        if (!Array.isArray(fields))
          throw new TypeError(
            `${path}.fields: expected field names; received ${JSON.stringify(fields)}`,
          );
        fields.forEach((field, i) => {
          asked.push([field, `${path}.fields[${i}]`]);
        });
        renderers.set(id, renderer);
      }
    }
    // Known before asking: a subscriber the model tells may destroy the grid, which lets go.
    this.#asked = model;
    model.askFields(this, asked);
    if (this.#destroyed) return;
    this.#renderers = renderers;
  }

  /** Whether framework cells wait to be handed over (see `hand`). */
  get pending(): boolean {
    return this.#batches.size > 0;
  }

  /** Hands framework cells over: `frame`, from the grid's own animation frame. */
  hand(frame: boolean): void {
    // Batches leave as they are handed: one a framework's draw destroying
    // the grid has not reached goes with `destroy`'s, releases and all.
    for (const [framework, { cells, released }] of this.#batches) {
      this.#batches.delete(framework);
      try {
        framework.draw(cells, released, frame);
      } catch (error) {
        report(error);
      }
    }
  }

  /** Whether each of `layout`'s columns draws more than text: a link, a kind, or a renderer. */
  hosted(layout: readonly PlacedColumn[]): readonly boolean[] {
    const hosts = this.#hosts;
    if (hosts?.layout === layout && hosts.renderers === this.#renderers) return hosts.hosted;
    const hosted = layout.map(
      ({ id, content }) =>
        content.link !== undefined || content.cell !== undefined || this.#renderers.has(id),
    );
    this.#hosts = { layout, renderers: this.#renderers, hosted };
    return hosted;
  }

  /**
   * Draws a table row's cell of a hosted column: its content for the
   * column, and, when `changed` (its row, text, or look may have), its
   * text and look as the model reads them (`read`, made only then).
   * Custom renderers also update as the row's index or selection moves.
   */
  draw(
    cell: HostedCell,
    columnIndex: number,
    column: PlacedColumn,
    row: Extract<ShownRow, { kind: "row" }>,
    rowIndex: number,
    selected: SelectionState,
    changed: boolean,
    model: BaseGridModel,
    paint: HostPaint,
  ): void {
    if (this.#destroyed) return;
    // A view destroyed or made may change the model: the grid draws again, so this cell waits.
    const revision = model.revision;
    const renderer = this.#renderers.get(column.id);
    const { content } = column;
    let held = cell.held;
    // What the element holds is the column's, or it goes.
    const fits =
      held &&
      (renderer
        ? held.type === "custom" && held.renderer === renderer && held.column === column.id
        : content.cell
          ? held.type === "kind" && held.kind === content.cell
          : held.type === "link");
    if (held && !fits) {
      this.release(cell);
      held = null;
      // The view released destroyed the grid or changed the model: none is made in its place.
      if (this.#destroyed || model.revision !== revision) return;
    }
    if (!held) {
      held = renderer
        ? this.#custom(cell, renderer, column.id)
        : content.cell
          ? this.#kind(cell, content.cell)
          : this.#link(cell);
      cell.held = held;
      this.#holding.add(cell);
      changed = true;
    }
    if (this.#destroyed || model.revision !== revision) return;
    if (held.type === "custom") {
      // Released and mounted again as another column's (by `fits` above).
      const drawn = held.drawn;
      const moved =
        !drawn ||
        drawn.scope !== row.ref.scope ||
        drawn.id !== row.ref.id ||
        drawn.index !== rowIndex ||
        drawn.selected !== selected;
      if (!changed && !(moved && !held.failed)) return;
      this.#update(
        cell,
        held,
        columnIndex,
        column,
        row,
        rowIndex,
        selected,
        model,
        paint,
        revision,
      );
      return;
    }
    if (!changed) return;
    const read = model.cellAt(rowIndex, columnIndex);
    if (cell.text.data !== read.text) cell.text.data = read.text;
    if (held.type === "link") {
      paint.look(cell, read.look, true);
      const url = read.link?.url;
      const anchor = held.anchor;
      if (url === undefined) {
        if (anchor.hasAttribute("href")) {
          // The focus stays on the cell when its link goes.
          if (focused(anchor) === anchor) cell.element.focus({ preventScroll: true });
          anchor.removeAttribute("href");
        }
      } else if (anchor.getAttribute("href") !== url) anchor.setAttribute("href", url);
      return;
    }
    // A kind's color is its own paint (a bar's, a chip's), not the text's.
    paint.look(cell, read.look, false);
    held.view.write(read, paint);
    if (!held.kind.text) setLabel(cell.element, read.text);
  }

  /** Takes what a cell element holds out of it, its text back in, destroying a custom view. */
  release(cell: HostedCell): void {
    const held = cell.held;
    if (!held) return;
    cell.held = null;
    this.#holding.delete(cell);
    const { element, text } = cell;
    if (held.type !== "kind") delete element.dataset.held;
    if (held.type === "link") {
      if (focused(held.anchor) === held.anchor) element.focus({ preventScroll: true });
      held.anchor.replaceWith(text);
    } else if (held.type === "kind") {
      held.view.remove();
      if (!held.kind.text) {
        element.append(text);
        element.removeAttribute("aria-label");
      }
    } else {
      // The framework lets go of the host, and draws nothing more in it:
      // queued first, so a destroy the view's cleanup makes hands it over.
      if ("framework" in held.renderer) {
        const batch = this.#batch(held.renderer.framework);
        batch.cells = batch.cells.filter((one) => one.host !== held.host);
        batch.released.push(held.host);
      }
      this.#destroy(held);
      if (held.host.contains(focused(element))) element.focus({ preventScroll: true });
      held.host.remove();
      element.append(text);
      element.removeAttribute("aria-label");
    }
  }

  /**
   * The element of a cell that takes the grid's focus: a linked cell's
   * anchor, a control cell's control, else the cell element.
   */
  target(cell: HostedCell): HTMLElement {
    const held = cell.held;
    if (held?.type === "link") return held.anchor.hasAttribute("href") ? held.anchor : cell.element;
    if (
      held?.type === "custom" &&
      !held.failed &&
      held.shown &&
      held.renderer.interaction === "control"
    )
      return firstControl(held.host, true) ?? cell.element;
    return cell.element;
  }

  /**
   * Whether `element` is inside a cell's link, control, or composite's
   * controls, whose presses are their own, as are their keys but those the
   * grid keeps (arrows on links and controls, Space on links).
   */
  owns(element: Element, cell: HostedCell): Interaction | null {
    const held = cell.held;
    if (!held || element === cell.element) return null;
    // A cell whose link went writes text, whose presses are the grid's.
    if (held.type === "link")
      return held.anchor.hasAttribute("href") && held.anchor.contains(element) ? "link" : null;
    if (held.type !== "custom") return null;
    const interaction = held.renderer.interaction;
    return interaction !== undefined && interaction !== "text" && held.host.contains(element)
      ? interaction
      : null;
  }

  /** Moves the focus into a composite cell's first control (Enter or F2 on the cell); whether it did. */
  enter(cell: HostedCell): boolean {
    const held = cell.held;
    if (
      held?.type !== "custom" ||
      held.failed ||
      !held.shown ||
      held.renderer.interaction !== "composite"
    )
      return false;
    const control = firstControl(held.host, false);
    control?.focus({ preventScroll: true });
    return control !== null;
  }

  /** Destroys every view, and has frameworks let go of their hosts: the grid is going. */
  destroy(): void {
    this.#destroyed = true;
    for (const cell of [...this.#holding]) this.release(cell);
    this.#asked?.askFields(this, []);
    this.#asked = null;
    const batches = [...this.#batches];
    this.#batches.clear();
    for (const [framework, { released }] of batches) {
      if (released.length === 0) continue;
      try {
        framework.draw([], released, false);
      } catch (error) {
        report(error);
      }
    }
  }

  #link(cell: HostedCell): Held {
    const anchor = cell.element.ownerDocument.createElement("a");
    anchor.className = "hg-link";
    // A link of a cell opens in a new browsing context, leaving the grid's page be.
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.tabIndex = -1;
    cell.text.replaceWith(anchor);
    anchor.append(cell.text);
    this.#style("host", HOST_CSS);
    cell.element.dataset.held = "";
    return { type: "link", anchor };
  }

  /** Adds stylesheet `name` to the grid's root, once. */
  #style(name: string, css: string) {
    if (this.#styled.has(name)) return;
    this.#styled.add(name);
    const style = this.#root.ownerDocument.createElement("style");
    style.textContent = css;
    this.#root.prepend(style);
  }

  #kind(cell: HostedCell, kind: CellKind): Held {
    this.#style(`kind ${kind.name}`, kind.css);
    const view = kind.mount(cell.element, cell.text);
    // Hidden text names the cell for assistive technology.
    if (!kind.text) cell.text.remove();
    return { type: "kind", kind, view };
  }

  #custom(cell: HostedCell, renderer: Renderer, column: string): Custom {
    const host = cell.element.ownerDocument.createElement("div");
    host.className = "hg-host";
    const interactive = renderer.interaction === "control" || renderer.interaction === "composite";
    // Presentation, which neither takes the focus nor is read: the cell's text names it.
    if (!interactive) host.inert = true;
    this.#style("host", HOST_CSS);
    cell.element.dataset.held = "";
    cell.element.append(host);
    const held: Custom = {
      type: "custom",
      renderer,
      column,
      host,
      view: null,
      handed: 0,
      // A framework's content shows once it is drawn; the cell's text until then.
      shown: !("framework" in renderer),
      ack: { drawn: null },
      failed: false,
      controller: null,
      reader: { values: null },
      drawn: null,
    };
    if ("framework" in renderer) {
      host.hidden = true;
      held.ack.drawn = (handed) => this.#drawn(cell, held, handed);
      return held;
    }
    cell.text.remove();
    try {
      held.view = renderer.create(host);
    } catch (error) {
      this.#failed(cell, held, error);
    }
    // The grid went as the view was made (its renderer destroyed it).
    if (this.#destroyed) this.#destroy(held);
    return held;
  }

  #batch(framework: FrameworkCells): { cells: FrameworkCell[]; released: HTMLElement[] } {
    let batch = this.#batches.get(framework);
    if (!batch) {
      batch = { cells: [], released: [] };
      this.#batches.set(framework, batch);
    }
    return batch;
  }

  /**
   * A framework drew the `handed`th update of a cell: the cell shows it, if
   * it is still the last, its controls out of the tab order but the one the
   * grid's focus gives it.
   */
  #drawn(cell: HostedCell, held: Custom, handed: number) {
    if (cell.held !== held || held.handed !== handed) return;
    if (!held.shown) {
      held.shown = true;
      held.host.hidden = false;
      cell.text.remove();
    }
    const interaction = held.renderer.interaction;
    if (interaction === "control" || interaction === "composite") {
      cell.element.removeAttribute("aria-label");
      quiet(held.host, this.#stop());
    } else setLabel(cell.element, cell.text.data);
    this.#shown(cell);
  }

  #update(
    cell: HostedCell,
    held: Custom,
    columnIndex: number,
    column: PlacedColumn,
    row: Extract<ShownRow, { kind: "row" }>,
    rowIndex: number,
    selected: SelectionState,
    model: BaseGridModel,
    paint: HostPaint,
    revision: number,
  ) {
    const read = model.cellAt(rowIndex, columnIndex);
    paint.look(cell, read.look, true);
    const before = held.drawn;
    const fresh = before?.scope !== row.ref.scope || before?.id !== row.ref.id;
    held.drawn = { scope: row.ref.scope, id: row.ref.id, index: rowIndex, selected };
    if (cell.text.data !== read.text) cell.text.data = read.text;
    const framework = "framework" in held.renderer ? held.renderer.framework : null;
    if (held.failed || !(held.view || framework)) return;
    const interactive =
      held.renderer.interaction === "control" || held.renderer.interaction === "composite";
    if (framework && fresh && held.shown) {
      // Never another row's content: the text shows until the framework draws this row's.
      held.shown = false;
      held.host.hidden = true;
      cell.element.append(cell.text);
    }
    if (interactive || !held.shown) cell.element.removeAttribute("aria-label");
    else setLabel(cell.element, read.text);
    // The update before is superseded: its reads stop, its acknowledgement
    // is stale, and what they held goes.
    held.reader.values = null;
    held.handed++;
    held.controller?.abort(SUPERSEDED);
    // Its abort changed the model (or destroyed the grid): the next draw updates the cell.
    if (this.#destroyed || model.revision !== revision) {
      held.drawn = null;
      return;
    }
    const controller = new AbortController();
    const fields = held.renderer.fields ?? [];
    // Reads are of this row, wherever it goes before the next update.
    const reader: Reader = { values: fields.length > 0 ? model.rowValues(rowIndex) : null };
    held.controller = controller;
    held.reader = reader;
    const context: GridCellContext = {
      ...read,
      row: { ...row, ref: { scope: row.ref.scope, id: row.ref.id } },
      rowIndex,
      column: layoutOf(column),
      selected,
      signal: controller.signal,
      read: reading(reader, `${this.#surface} cells.${column.id}`, fields),
    };
    if (framework) {
      this.#hand(framework, held, context);
      return;
    }
    try {
      held.view!.update(context);
    } catch (error) {
      this.#failed(cell, held, error);
    }
    if (interactive) quiet(held.host, this.#stop());
  }

  #hand(framework: FrameworkCells, held: Custom, context: GridCellContext) {
    this.#batch(framework).cells.push({
      host: held.host,
      context,
      renderer: held.renderer as GridFrameworkRenderer,
      drawn: acknowledge(held.ack, held.handed),
    });
  }

  /** A renderer threw: its view goes, the error is reported once, and the cell writes its text. */
  #failed(cell: HostedCell, held: Custom, error: unknown) {
    this.#destroy(held);
    held.failed = true;
    held.host.replaceChildren();
    held.host.hidden = true;
    cell.element.removeAttribute("aria-label");
    cell.element.append(cell.text);
    report(error);
  }

  #destroy(held: Custom) {
    // Reads and acknowledgements stop before abort listeners run.
    held.reader.values = null;
    held.ack.drawn = null;
    held.controller?.abort(SUPERSEDED);
    held.controller = null;
    const view = held.view;
    held.view = null;
    if (!view?.destroy) return;
    try {
      view.destroy();
    } catch (error) {
      report(error);
    }
  }
}

/**
 * A context's `read` of the renderer's `fields` while `reader` holds the
 * row's values (`at` names the renderer in messages). Made apart from the
 * update, so a context a renderer keeps holds nothing of the grid's.
 */
function reading(reader: Reader, at: string, fields: readonly string[]): GridCellContext["read"] {
  return (field) => {
    if (!fields.includes(field))
      throw new Error(
        `${at}: read(${JSON.stringify(field)}) reads a field the renderer does not name; give fields: [${[...fields, field].map((one) => JSON.stringify(one)).join(", ")}]`,
      );
    const values = reader.values;
    if (!values)
      throw new Error(
        `${at}: read(${JSON.stringify(field)}) after its update was superseded; check cell.signal before reading`,
      );
    return values(field) as never;
  };
}

/** A framework cell's `drawn`: reaches the view through `ack` while the view lives. */
function acknowledge(ack: Custom["ack"], handed: number): () => void {
  return () => ack.drawn?.(handed);
}

/** Columns as contexts give them: what the layout says, without what the column draws with. */
const LAYOUTS = new WeakMap<PlacedColumn, GridColumnLayout>();

function layoutOf(column: PlacedColumn): GridColumnLayout {
  let layout = LAYOUTS.get(column);
  if (!layout) {
    const { id, field, kind, title, x, width, align, pinned } = column;
    layout = Object.freeze({ id, field, kind, title, x, width, align, pinned });
    LAYOUTS.set(column, layout);
  }
  return layout;
}

/** The focused element of `node`'s document or shadow root. */
function focused(node: Node): Element | null {
  return (node.getRootNode() as Document | ShadowRoot).activeElement;
}

/** Names a cell for assistive technology by its text, where what it shows does not. */
function setLabel(element: HTMLElement, text: string) {
  if (element.getAttribute("aria-label") !== text) element.setAttribute("aria-label", text);
}

const FOCUSABLE =
  "a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]";

/**
 * A host's first control that can take the focus, which takes its cell's;
 * with `own`, not one of a grid in the host, whose tab indexes are that
 * grid's to write.
 */
function firstControl(host: HTMLElement, own: boolean): HTMLElement | null {
  const grid = host.closest(G);
  for (const control of host.querySelectorAll<HTMLElement>(FOCUSABLE))
    if ((!own || control.closest(G) === grid) && canFocus(control)) return control;
  return null;
}

/**
 * Whether an element in the page can hold the focus: not disabled, inert,
 * or hidden (by CSS too: an element not drawn takes no focus).
 */
export function canFocus(element: Element): boolean {
  return (
    element.isConnected &&
    !element.matches(":disabled") &&
    !element.closest("[inert]") &&
    element.checkVisibility?.({ visibilityProperty: true }) !== false
  );
}

/**
 * Takes a host's controls out of the page's tab order but the grid's tab
 * stop (`stop`): the grid keeps one. The focused control too, which keeps
 * the focus, and a grid's in the host, which keeps none of its own there.
 * Writes only what changes, so frameworks watching their content see none
 * of the grid's own writes again.
 */
function quiet(host: HTMLElement, stop: Element | null) {
  for (const control of host.querySelectorAll<HTMLElement>(FOCUSABLE))
    if (control.tabIndex !== -1 && control !== stop) control.tabIndex = -1;
}
