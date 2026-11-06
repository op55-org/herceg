// A grid in the page, imported with its model as `herceg/grid`. It scrolls a
// spacer as tall as its rows and mounts only the rows and cells in view, with
// a few more around them, updated in place as it scrolls and as its model
// changes; cells of pinned columns stick to the edges (CSS sticky, so they
// keep up with the browser's scrolling). It follows the WAI grid pattern (the
// treegrid pattern when its rows are grouped): one tab stop, a roving focused
// cell, logical row and column indexes on what is mounted, and a polite live
// region saying what sorting, selecting, expanding, collapsing, and changing
// columns did. Headers resize and move their columns by dragging, or by keys
// and a column menu. Headings span header rows over the columns' own
// (grid-headings.ts); a model's totals row is a footer rowgroup, sticky at
// the bottom.

import type { Schema } from "../data/table.ts";
import type {
  BaseGridModel,
  GridFocus,
  GridRange,
  GridRef,
  GridTotalsRow,
  SelectionState,
  ShownRow,
} from "../grid/base.ts";
import { TOTAL } from "../grid/base.ts";
import type { ColumnContent, GridColumnLayout, PlacedColumn } from "../grid/columns.ts";
import type { CellLook } from "../grid/looks.ts";
import type { GridModel } from "../grid/model.ts";
import type { ThemeName, ThemeSpec } from "../spec/spec.ts";
import { resolveTokens, themeReadsPage } from "../theme.ts";
import {
  CellHost,
  canFocus,
  type GridCellRenderers,
  type HostedCell,
  type HostPaint,
} from "./grid-cells.ts";
import { ColumnControls } from "./grid-columns.ts";
import { Headings } from "./grid-headings.ts";
import { arrange, placeCell, setAttribute, setText } from "./grid-place.ts";
import { contrastOf, faintOf, GRID_CSS, PAGE_INKS, themeProperties } from "./grid-style.ts";
import { readPage, watchPage } from "./page-theme.ts";
import { observeVisibility, report, type Scheduled, schedule, unschedule } from "./scheduler.ts";

export interface GridOptions<S extends Schema = Schema, M extends BaseGridModel<S> = GridModel<S>> {
  /** What the grid shows; the application owns it, and destroying the grid leaves it be. */
  model: M;
  /** Names the grid for assistive technology. */
  ariaLabel: string;
  /** "light" by default. */
  theme?: ThemeName | ThemeSpec | undefined;
  /** In CSS pixels; 32 by default. */
  headerHeight?: number | undefined;
  /**
   * Custom renderers of columns' cells, by column id, over the column's
   * own `cell` (see `GridCellRenderer`). JavaScript only: what they draw is
   * theirs, and the column's text is what the model, export, and copy know
   * of it.
   */
  cells?: GridCellRenderers<S> | undefined;
}

/** Options to change; one given as undefined goes back to its default. */
export type GridUpdate<S extends Schema = Schema> = Partial<Omit<GridOptions<S>, "model">>;

/** What a grid's clicks on rows and cells report. */
export interface GridInputEvent {
  /**
   * The row as the model names it (see `GridRef`): a table row by its
   * identity, a group by its key, the same however sorting, filtering, and
   * scrolling move it.
   */
  readonly ref: GridRef;
  /**
   * Its index in the grid's rows now (the model's `row(rowIndex)` reads
   * it); -1 where the click's selection took it out of them (a filter on
   * the selection, applied by a `select` listener).
   */
  readonly rowIndex: number;
  /** The id of the column of the cell clicked. */
  readonly column: string;
  /** A press, or Enter on the focused cell. */
  readonly cause: "pointer" | "keyboard";
}

/** A grid's events by name, with what their listeners receive. */
export interface GridEvents {
  /**
   * A body row was clicked (a press released in place on one of its
   * cells, after the click selected) or Enter pressed on one of its cells.
   * Not for its expand toggle or checkbox, which act alone.
   */
  rowClick: GridInputEvent;
  /** The same click, as on its cell: in every case `rowClick` is, after it. */
  cellClick: GridInputEvent;
  /** The grid drew a frame of its model, as of the model's `revision`. */
  render: { readonly revision: number };
}

/**
 * The tallest the rows' spacer is made, in CSS pixels; taller content
 * scrolls scaled. Browsers lay out up to about 33.5 million pixels (Chrome,
 * Safari) or 17.9 million (Firefox), but Chrome stops drawing one-pixel
 * lines past 2^24, and single precision keeps half pixels exact only below
 * 2^23.
 */
const MAX_EXTENT = 8_000_000;
const HEADER_HEIGHT = 32;
/** Height of grids whose container has none. */
const DEFAULT_HEIGHT = 320;
const OVERSCAN = { rows: 10, columns: 2 };
/** Fills whose inks are kept: more than a screen of cells shows. */
const INKS_KEPT = 4096;
/** How far a press may move and still be a click; farther, it selects text or drags a header. */
const CLICK_SLOP = 4;
const HIDDEN_TEXT =
  "position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
const INSTRUCTIONS =
  "Arrow keys, Page Up, Page Down, Home, and End move between cells. Space selects a row, Shift with arrow keys selects a range, and Control A selects every row. Enter on a column header sorts by it; Shift and Enter adds it to the sort. On a column header, Shift with Left or Right Arrow moves the column, Alt with Left or Right Arrow resizes it, and Alt and Down Arrow opens its menu, which also pins, hides, and shows columns.";
const GROUP_INSTRUCTIONS =
  " Rows are grouped. Enter on a group expands or collapses it, and Space selects its rows. On a row's first cell, Right Arrow expands a group, Left Arrow collapses it, and Left Arrow on a collapsed group or a group's row goes to the group holding it.";

const MOVES = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  PageUp: "pageUp",
  PageDown: "pageDown",
  Home: "rowStart",
  End: "rowEnd",
} as const;

/** A mounted cell: a body cell, or a header cell (with `sort` for its sort mark). */
interface Cell extends HostedCell {
  /** What column's content its text was written for. */
  content: ColumnContent | null;
  /** Its column's cells revision as its kind was last drawn (see `cellsRevision`). */
  kinds: number;
  /** The fill and text color its look was written with, as the page reads them, and the theme's count then. */
  fill: string | undefined;
  color: string | undefined;
  themed: number;
  readonly element: HTMLDivElement;
  readonly text: Text;
  readonly sort: Text | undefined;
  /** The expand toggle and checkbox of a group's first cell, made when first needed. */
  controls: { element: HTMLSpanElement; check: HTMLSpanElement } | null;
  /** The body row it belongs to; null in the header. */
  readonly row: Row | null;
  /** The id of the column it shows, which it keeps when columns move. */
  id: string;
  /** That column's index among the shown columns. */
  column: number;
  /** The column layout it was placed for; null when newly assigned. */
  placed: GridColumnLayout | null;
}

/** A mounted body row, following the row (or group's header) whose ref it shows. */
interface Row {
  readonly element: HTMLDivElement;
  cells: Cell[];
  index: number;
  ref: GridRef | null;
  /**
   * The row's version and the columns its text was written for: a group's
   * header writes its first cell otherwise.
   */
  written: { version: number; layout: readonly GridColumnLayout[] } | null;
  y: number;
  width: number;
  selected: SelectionState | null;
}

/**
 * What grids of other kinds add to the DOM grid: a pivot's limit notice
 * (dom/grid-pivot.ts), a remote grid's loading and failed rows
 * (dom/grid-remote.ts).
 */
export interface GridExtras {
  /** The keyboard instructions, in place of the plain grid's. */
  instructions?(grouped: boolean): string;
  /** The rows there are for assistive technology, null when unknown; the model's row count by default. */
  rowCount?(): number | null;
  /** Marks a mounted row as it is drawn. */
  row?(element: HTMLElement, row: ShownRow): void;
  /** Called after each frame drawn, with the grid's scroller (in its root) and its live region. */
  drawn?(scroller: HTMLElement, say: (text: string) => void): void;
  /** What makes the grid, in messages ("createRemoteGrid"); refuses `cells` where it says why. */
  readonly maker?: string;
  readonly refuseCells?: string;
}

let nextId = 0;

/**
 * A virtualized, accessible grid over a `GridModel`. Create it with
 * `createGrid`; it fills its container, which should have a height (else
 * the grid is 320 pixels tall).
 */
export class Grid<S extends Schema = Schema, M extends BaseGridModel<S> = GridModel<S>>
  implements Scheduled
{
  readonly model: M;
  /** The element the grid adds to its container. */
  readonly root: HTMLDivElement;
  readonly #container: HTMLElement;
  readonly #scroller: HTMLDivElement;
  readonly #headerRow: HTMLDivElement;
  readonly #body: HTMLDivElement;
  /** The footer rowgroup and its one row, the totals row's, while the model has one. */
  readonly #footer: HTMLDivElement;
  readonly #totals: Row;
  /** What the totals row was last written for: its reader, version, columns, and theme. */
  #totalsWritten: {
    row: GridTotalsRow;
    version: number;
    layout: readonly GridColumnLayout[];
    themes: number;
  } | null = null;
  /** The header rows over the columns' own. */
  readonly #headings: Headings;
  readonly #description: HTMLDivElement;
  readonly #live: HTMLDivElement;
  /** What the headers do to their columns: drags, keys, and the column menu. */
  readonly #controls: ColumnControls<S>;
  readonly #cells = new WeakMap<Element, Cell>();
  /** What cell elements hold besides text: links, kinds' views, custom renderers' views. */
  readonly #host: CellHost;
  /** What hosted cells' looks and kinds are painted with. */
  readonly #hostPaint: HostPaint;
  #options: GridOptions<S, M>;
  readonly #extras: GridExtras;
  /** Header rows: the columns' own and the headings' over them. */
  #levels = 1;
  /** Whether the footer shows the totals row, which the rows' viewport leaves room for. */
  #footed = false;
  #headerHeight = HEADER_HEIGHT;
  #rows: Row[] = [];
  #headerCells: Cell[] = [];
  #header: { layout: readonly GridColumnLayout[]; sort: unknown } | null = null;
  /** The model's looks revision as cells' looks were last written, and the palette they read. */
  #looks = Number.NaN;
  #palette: readonly string[] = [];
  /** A chip's fill without a color of its own, in the theme (see `faintOf`). */
  #faint = "";
  /** Counts themes taken, which cells' inks follow. */
  #themes = 0;
  /** Inks of text over fills, by fill, for the theme (see `contrastOf`). */
  #inks = new Map<string, readonly [string, string]>();
  #contrast: ReturnType<typeof contrastOf> = () => undefined;
  /** The cell with tabindex 0. */
  #active: HTMLElement | null = null;
  /** Whether the page's focus is in the grid, as focus events last said. */
  #focused = false;
  /** The element that last took the page's focus in the grid, while it holds it. */
  #lastFocused: Element | null = null;
  /** Content box of the scroller, from the resize observer. */
  #box: { width: number; height: number } | null = null;
  #spacer = { height: -1, width: -1 };
  #ratio = 1;
  /** The scroller's offsets, as last read or set. */
  #scrollTop = 0;
  #scrollLeft = 0;
  /** The scroller's offset as last drawn, and the model's top it stands for. */
  #expected: { physical: number; logical: number } | null = null;
  #dirty = true;
  #drawn = -1;
  #visible = true;
  #destroyed = false;
  #rendering = false;
  /** Set while the grid draws in its own animation frame (`flush`). */
  #frame = false;
  /** Set by commands that move the page's focus into the grid on the next draw. */
  #focusRequested = false;
  #pageChanged = false;
  #press: { x: number; y: number } | null = null;
  readonly #listeners = new Map<keyof GridEvents, Set<(event: never) => void>>();
  readonly #stops: (() => void)[] = [];
  #unwatchPage: (() => void) | undefined;

  /** `extras` are what pivot and remote grids add (`createPivotGrid` and `createRemoteGrid` give them). */
  constructor(container: HTMLElement, options: GridOptions<S, M>, extras: GridExtras = {}) {
    const document = container.ownerDocument;
    this.#container = container;
    this.model = options.model;
    this.#options = options;
    this.#extras = extras;
    this.root = element(document, "herceg-grid");
    const style = document.createElement("style");
    style.textContent = GRID_CSS;
    this.#scroller = element(document, "hg-scroller");
    this.#scroller.setAttribute("role", "grid");
    this.#scroller.tabIndex = 0;
    const header = element(document, "hg-header");
    header.setAttribute("role", "rowgroup");
    this.#headerRow = element(document);
    this.#headerRow.setAttribute("role", "row");
    header.append(this.#headerRow);
    this.#body = element(document, "hg-body");
    this.#body.setAttribute("role", "rowgroup");
    this.#footer = element(document, "hg-footer");
    this.#footer.hidden = true;
    this.#totals = this.#newRow();
    this.#totals.element.className = "hg-totals";
    // Named for what it is, whether or not the cell saying "Total" is mounted.
    this.#totals.element.setAttribute("aria-label", TOTAL);
    this.#footer.append(this.#totals.element);
    this.#headings = new Headings(document);
    this.#scroller.append(header, this.#body, this.#footer);
    const description = element(document);
    description.id = `herceg-grid-${++nextId}-keys`;
    description.hidden = true;
    this.#description = description;
    this.#scroller.setAttribute("aria-describedby", description.id);
    this.#live = element(document);
    this.#live.setAttribute("aria-live", "polite");
    this.#live.setAttribute("aria-atomic", "true");
    this.#live.style.cssText = HIDDEN_TEXT;
    this.root.append(style, this.#scroller, description, this.#live);
    container.append(this.root);
    this.#host = new CellHost(
      this.root,
      "grid",
      (cell) => this.#shown(cell as Cell),
      () => this.#active,
    );
    this.#hostPaint = {
      // A kind's color is its own paint (a bar's, a chip's): the cell keeps only the fill.
      look: (cell, look, color) =>
        this.#paint(
          cell as Cell,
          color || !look ? look : look.fill === undefined ? undefined : { fill: look.fill },
        ),
      color: (color) => this.#paletted(color),
      // Over colors the grid reads, worked out here; over others, by the page.
      inks: (color, fill) => this.#inksOf(this.#filled(fill), color ?? this.#faint),
    };
    this.#controls = new ColumnControls({
      model: this.model,
      root: this.root,
      scroller: this.#scroller,
      headerCells: () => this.#headerCells,
      cellOf: (element) => this.#cellOf(element),
      render: (focus) => {
        if (focus) this.#focusRequested = true;
        this.render();
      },
      invalidate: () => this.#invalidate(),
      say: (text) => this.#say(text),
    });

    try {
      this.#applyOptions(options, extras.maker ?? "createGrid");
      this.#listen();
      this.#stops.push(this.model.subscribe(() => this.#invalidate()));
      this.#stops.push(
        observeVisibility(this.root, (visible) => {
          this.#visible = visible;
          if (visible && (this.#dirty || this.#pageChanged || this.#host.pending)) schedule(this);
        }),
      );
      if (typeof ResizeObserver !== "undefined") {
        const observer = new ResizeObserver((entries) => {
          for (const entry of entries) {
            if (entry.target === container) this.#fit(entry.contentRect.height);
            else this.#measured(entry.contentRect.width, entry.contentRect.height);
          }
        });
        observer.observe(container);
        observer.observe(this.#scroller);
        this.#stops.push(() => observer.disconnect());
      }
      // The first frame draws at once, so the grid is never blank.
      const sizes = getComputedStyle(container);
      this.#fit(
        container.clientHeight -
          Number.parseFloat(sizes.paddingTop) -
          Number.parseFloat(sizes.paddingBottom),
      );
      this.#placeSpacer();
      this.#measured(this.#scroller.clientWidth, this.#scroller.clientHeight);
      this.#draw();
    } catch (error) {
      // Nothing returns a handle to the caller, so undo everything here.
      this.destroy();
      throw error;
    }
  }

  get visible(): boolean {
    return this.#visible;
  }

  /** The model's `revision` as the grid last drew it (it draws its first frame as it is made). */
  get drawnRevision(): number {
    return this.#drawn;
  }

  /** Changes options; one given as undefined goes back to its default. */
  update(options: GridUpdate<S>): void {
    // A destroyed grid takes nothing more (a renderer's cleanup may ask), and listens to nothing again.
    if (this.#destroyed) return;
    const next: Record<string, unknown> = { ...this.#options, ...options };
    for (const [key, value] of Object.entries(options)) if (value === undefined) delete next[key];
    this.#applyOptions(next as unknown as GridOptions<S, M>, "grid.update");
    if (this.#destroyed) return;
    if (this.#box) this.#measured(this.#box.width, this.#box.height);
    this.#invalidate();
  }

  /** Draws now instead of on the next frame, even while the grid is scrolled out of the page's view. */
  render(): void {
    if (this.#destroyed) return;
    if (this.#pageChanged) this.#applyTheme();
    this.#draw();
  }

  /** Listens to `type`; returns what stops it. A listener that throws is reported; the others still run. */
  on<K extends keyof GridEvents>(type: K, listener: (event: GridEvents[K]) => void): () => void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    set.add(listener);
    return () => set.delete(listener);
  }

  #emit<K extends keyof GridEvents>(type: K, event: GridEvents[K]): void {
    for (const listener of [...(this.#listeners.get(type) ?? [])]) {
      // A listener may destroy the grid: the rest hear nothing more.
      if (this.#destroyed) return;
      try {
        (listener as (event: GridEvents[K]) => void)(event);
      } catch (error) {
        report(error);
      }
    }
  }

  /**
   * Reports a click (or Enter) on the cell of column `column` in the row
   * named `ref`, where that row is now (-1 if gone): its own action is done.
   */
  #clicked(ref: GridRef, column: string, cause: GridInputEvent["cause"]): void {
    const event = { ref, rowIndex: this.model.indexOf(ref), column, cause };
    this.#emit("rowClick", event);
    this.#emit("cellClick", event);
  }

  /** Focuses a cell (row -1 for the header row), scrolling it into view, and moves the page's focus to it. */
  focusCell(rowIndex: number, column: string): void {
    this.model.focusCell(rowIndex, column);
    this.#focusRequested = true;
    this.render();
  }

  /** Removes the grid and stops everything it listens to; the model, its view, and its table stay. */
  destroy(): void {
    if (this.#destroyed) return;
    // First: cleanups below run renderers' code, which may call back into the grid.
    this.#destroyed = true;
    this.#controls.destroy();
    this.#host.destroy();
    this.#listeners.clear();
    unschedule(this);
    for (const stop of this.#stops) stop();
    this.#unwatchPage?.();
    this.root.remove();
  }

  /** Called by the scheduler. */
  flush(): void {
    if (this.#destroyed) return;
    this.#controls.flush();
    if (this.#pageChanged) {
      this.#applyTheme();
      this.#dirty = true;
    }
    // Scrolled scaled, rows the browser scrolls natively land in the wrong
    // place: an offset a script set this frame (an animation, a synced
    // scroll), whose scroll event comes only next frame, is taken now.
    if (this.#ratio > 1 && this.#scroller.scrollTop !== this.#scrollTop) this.#onScroll();
    this.#frame = true;
    try {
      if (this.#dirty) this.#draw();
      else if (this.#host.pending) {
        // Framework cells of a draw called from code, handed over in the
        // frame: as part of drawing, so a commit asking for a draw has the next.
        this.#rendering = true;
        try {
          this.#host.hand(true);
        } finally {
          this.#rendering = false;
        }
      }
    } finally {
      this.#frame = false;
    }
  }

  #invalidate() {
    // A model's subscribers, the grid's among them, may hear of changes after one of them destroyed it.
    if (this.#destroyed) return;
    this.#dirty = true;
    schedule(this);
  }

  /** Takes `options`, checked first (`at` names them in messages): a refused one changes nothing. */
  #applyOptions(options: GridOptions<S, M>, at: string) {
    const { ariaLabel, headerHeight = HEADER_HEIGHT, theme, cells } = options;
    if (!(Number.isFinite(headerHeight) && headerHeight > 0))
      throw new RangeError(`A grid's headerHeight must be positive, not ${headerHeight}`);
    const refused = this.#extras.refuseCells;
    if (refused && cells !== undefined) throw new TypeError(`${at} cells: ${refused}; drop cells`);
    this.#host.setRenderers(
      cells as GridCellRenderers | undefined,
      this.model as unknown as BaseGridModel,
      at,
    );
    // A subscriber the model told of the renderers' fields destroyed the grid: nothing is watched.
    if (this.#destroyed) return;
    this.#options = options;
    this.#headerHeight = headerHeight;
    this.#scroller.setAttribute("aria-label", ariaLabel);
    this.#applyTheme();
    // Themes that follow the page read it again when it may have changed.
    const follows = themeReadsPage(theme);
    if (follows && !this.#unwatchPage) {
      this.#unwatchPage = watchPage(this.#container.ownerDocument, () => {
        this.#pageChanged = true;
        schedule(this);
      });
    } else if (!follows && this.#unwatchPage) {
      this.#unwatchPage();
      this.#unwatchPage = undefined;
    }
  }

  #applyTheme() {
    this.#pageChanged = false;
    const theme = readPage(this.#container, (page) => resolveTokens(this.#options.theme, page));
    // Looks' palette places take the theme's colors: mounted cells read theirs again.
    this.#palette = theme.tokens.palette;
    this.#looks = Number.NaN;
    this.#themes++;
    this.#inks.clear();
    this.#contrast = contrastOf(theme);
    this.#faint = faintOf(theme);
    const properties = themeProperties(theme, this.model.rowHeight, this.#headerHeight);
    for (const [name, value] of Object.entries(properties))
      this.root.style.setProperty(name, value);
  }

  /** Sizes the grid to its container's content height, or the default without one. */
  #fit(height: number) {
    const value = `${height > 0 ? height : DEFAULT_HEIGHT}px`;
    if (this.root.style.height !== value) this.root.style.height = value;
  }

  /** Takes the scroller's content box: the rows' viewport is what the header and the totals row leave. */
  #measured(width: number, height: number) {
    this.#box = { width, height };
    const footer = this.#footed ? this.model.rowHeight : 0;
    this.model.setViewport(width, Math.max(0, height - this.#headerHeight * this.#levels - footer));
  }

  #draw() {
    // A subscriber told of a scroll in this frame may have destroyed the grid.
    if (this.#destroyed) return;
    // A draw asked for while one runs (by a renderer, or a focus listener) is the next frame's.
    if (this.#rendering) {
      this.#invalidate();
      return;
    }
    this.#dirty = false;
    const model = this.model;
    // What the frame draws: changes made as it draws (by a focus listener) are the next frame's.
    const revision = model.revision;
    // A request to move the focus in made as it draws (by a framework's commit) is the next's too.
    let requested = this.#focusRequested;
    this.#focusRequested = false;
    this.#rendering = true;
    try {
      const count = model.rowCount;
      // The model's layout is of placed columns, which say what they show.
      const layout = model.columnLayout as readonly PlacedColumn[];
      const levels = 1 + this.#headings.rows(layout);
      const footed = model.totalsRow !== null && layout.length > 0;
      if (levels !== this.#levels || footed !== this.#footed) {
        if (levels !== this.#levels) {
          this.#levels = levels;
          // Rows' indexes count the header rows: every mounted row writes its own again.
          for (const row of this.#rows) row.index = -1;
        }
        this.#footed = footed;
        if (this.#box) this.#measured(this.#box.width, this.#box.height);
        // The model's subscribers heard of the viewport, and one may have destroyed the grid.
        if (this.#destroyed) return;
      }
      // A column's menu closing with its column gives the focus back to the grid.
      if (this.#controls.sync()) requested = true;
      const shift = this.#scroll();
      const shown = model.visibleRange(OVERSCAN);
      const focus = model.focus;
      const root = this.root.getRootNode() as Document | ShadowRoot;
      const holding = this.#scroller.contains(root.activeElement) || requested;
      // While it holds the page's focus, the focused cell stays mounted wherever it is scrolled.
      const keep = holding ? focus : null;
      this.#drawHeader(shown, keep, layout);
      if (!this.#drawRows(shown, keep, shift, layout)) {
        if (this.#destroyed) return;
        // Cells left unwritten, and looks and kinds unread, are the next frame's.
        for (const row of this.#rows) row.written = null;
        this.#looks = Number.NaN;
        if (requested) this.#focusRequested = true;
        // Out of view no frame comes: what was handed over goes now, hosts let go of too.
        if (!this.#visible && this.#host.pending) this.#host.hand(false);
        this.#invalidate();
        return;
      }
      this.#drawTotals(shown, keep, layout);
      this.#describe(count, layout.length);
      // Framework cells, before the focus: a draw in the grid's frame hands
      // them over at once, as does the first, and any while the grid is out
      // of view (whose frames wait, and nothing of it paints); one called from
      // code (which may be a framework's render or effect) leaves them to the
      // next frame.
      if (this.#host.pending) {
        if (this.#frame || this.#drawn < 0 || !this.#visible) this.#host.hand(this.#frame);
        else schedule(this);
        // A framework's draw destroyed the grid.
        if (this.#destroyed) return;
      }
      // A framework's commit may have moved the page's focus out (to a dialog
      // it opened): the grid takes it back only when asked to.
      const page = this.root.ownerDocument.activeElement;
      const away =
        page !== null &&
        page !== this.root.ownerDocument.body &&
        !this.#scroller.contains(root.activeElement);
      this.#placeFocus(focus, requested || (holding && !away));
      this.#extras.drawn?.(this.#scroller, (text) => this.#say(text));
    } finally {
      this.#rendering = false;
    }
    this.#drawn = revision;
    if (this.#listeners.get("render")?.size) this.#emit("render", { revision });
  }

  /**
   * The grid's own attributes. With no column shown it has no rows (a row
   * needs cells), so it is a named group until columns come back; with
   * groups it is a tree grid.
   */
  #describe(rows: number, columns: number) {
    const scroller = this.#scroller;
    const grid = columns > 0;
    const grouped = this.model.grouped;
    setAttribute(scroller, "role", grid ? (grouped ? "treegrid" : "grid") : "group");
    const extras = this.#extras;
    const instructions =
      extras.instructions?.(grouped) ??
      (grouped ? INSTRUCTIONS + GROUP_INSTRUCTIONS : INSTRUCTIONS);
    if (this.#description.textContent !== instructions)
      this.#description.textContent = instructions;
    // Rows and row groups belong in a grid. Their elements stay laid out, so
    // the scroll offset is kept for when columns come back.
    for (const [element, role] of [
      [this.#headerRow.parentElement!, "rowgroup"],
      [this.#headerRow, "row"],
      [this.#body, "rowgroup"],
      [this.#footer, "rowgroup"],
      [this.#totals.element, "row"],
    ] as const) {
      if (grid) setAttribute(element, "role", role);
      else element.removeAttribute("role");
    }
    if (grid) setAttribute(this.#headerRow, "aria-rowindex", String(this.#levels));
    else this.#headerRow.removeAttribute("aria-rowindex");
    const known = extras.rowCount ? extras.rowCount() : rows;
    const totals = this.#footed ? 1 : 0;
    // The totals row comes after the rows: its index is known with their count.
    const footer = this.#totals.element;
    if (known === null || !this.#footed) footer.removeAttribute("aria-rowindex");
    else setAttribute(footer, "aria-rowindex", String(known + this.#levels + 1));
    for (const [name, value] of [
      ["aria-rowcount", String(known === null ? -1 : known + this.#levels + totals)],
      ["aria-colcount", String(columns)],
      ["aria-multiselectable", "true"],
      ["aria-readonly", "true"],
    ] as const) {
      if (grid) setAttribute(scroller, name, value);
      else scroller.removeAttribute(name);
    }
  }

  /** Sizes the spacer: as tall as the rows, up to the most browsers draw correctly. */
  #placeSpacer() {
    const model = this.model;
    const height = Math.min(model.contentHeight, MAX_EXTENT);
    if (height !== this.#spacer.height) {
      this.#spacer.height = height;
      this.#body.style.height = `${height}px`;
    }
    const span = this.#span();
    if (span !== this.#spacer.width) {
      this.#spacer.width = span;
      this.#body.style.width =
        this.#headerRow.style.width =
        this.#totals.element.style.width =
          `${span}px`;
    }
    return height;
  }

  /**
   * How wide rows are: as the columns, or as the viewport when they are
   * narrower and some are held at the right edge, which they then reach.
   * Either way nothing scrolls past the columns.
   */
  #span(): number {
    const { width, viewportWidth, columnLayout } = this.model;
    return columnLayout.at(-1)?.pinned === "right" ? Math.max(width, viewportWidth) : width;
  }

  /**
   * Brings the scroller to the model's offsets and returns how far rows
   * shift from their logical place: none unless the rows are taller than
   * the spacer, which then scrolls a fraction (`#ratio`) as far.
   */
  #scroll(): number {
    const model = this.model;
    const viewport = model.viewportHeight;
    const spacer = this.#placeSpacer();
    const range = spacer - viewport;
    const ratio = range > 0 ? Math.max(1, (model.contentHeight - viewport) / range) : 1;
    this.#ratio = ratio;
    const top = model.top;
    const scroller = this.#scroller;
    if (Math.abs(top / ratio - this.#scrollTop) >= 1) {
      scroller.scrollTop = top / ratio;
      this.#scrollTop = scroller.scrollTop;
    }
    // The offset the scroller is at (as the browser took it) stands for the
    // model's top: a scroll event reporting it is the grid's own scrolling.
    this.#expected = { physical: this.#scrollTop, logical: top };
    if (Math.abs(model.left - this.#scrollLeft) >= 1) {
      scroller.scrollLeft = model.left;
      this.#scrollLeft = scroller.scrollLeft;
    }
    return Math.round(top - this.#scrollTop);
  }

  #drawHeader(shown: GridRange, keep: GridFocus | null, layout: readonly PlacedColumn[]) {
    const columns = columnsOf(shown, keep?.rowIndex === -1 ? keep : null, layout);
    const cells = this.#mountCells(this.#headerRow, null, this.#headerCells, columns, layout);
    this.#headerCells = cells;
    this.#headings.draw(
      this.#headerRow.parentElement!,
      this.#headerRow,
      columns,
      cells,
      layout,
      this.model.width,
      this.#spacer.width,
    );
    const sort = this.model.sort;
    const changed = this.#header?.layout !== layout || this.#header.sort !== sort;
    this.#header = { layout, sort };
    const moving = this.#controls.moving;
    for (const cell of cells) {
      const column = layout[cell.column]!;
      cell.element.toggleAttribute("data-moving", cell.id === moving);
      if (!this.#place(cell, column, layout) && !changed) continue;
      setText(cell.text, column.title);
      // The field's description: a tooltip, and the header's accessible description.
      setAttribute(cell.element, "title", column.content.description);
      const at = sort.findIndex(({ field }) => field === column.field);
      const order = at < 0 ? undefined : (sort[at]!.order ?? "ascending");
      const mark = order
        ? `${order === "ascending" ? "▲" : "▼"}${sort.length > 1 ? at + 1 : ""}`
        : "";
      setText(cell.sort!, mark);
      // One header at a time carries aria-sort: the first key's.
      if (at === 0) cell.element.setAttribute("aria-sort", order!);
      else cell.element.removeAttribute("aria-sort");
    }
  }

  /**
   * Draws the rows `shown`; false when a renderer changed the model as it
   * drew (a sort, a scroll): what is left is the next frame's, as rows read
   * now would be of another order than the ones mounted.
   */
  #drawRows(
    shown: GridRange,
    keep: GridFocus | null,
    shift: number,
    layout: readonly PlacedColumn[],
  ): boolean {
    const model = this.model;
    const drawing = model.revision;
    const { rowStart, rowEnd } = shown;
    // The focused row stays mounted wherever it is scrolled (not the totals row, always in view).
    const outside =
      keep &&
      keep.rowIndex >= 0 &&
      keep.rowIndex < model.rowCount &&
      (keep.rowIndex < rowStart || keep.rowIndex >= rowEnd)
        ? keep.rowIndex
        : -1;
    const indices: number[] = [];
    // Rows without cells are not rows: with no column shown, none are mounted.
    if (layout.length > 0) {
      if (outside >= 0 && outside < rowStart) indices.push(outside);
      for (let i = rowStart; i < rowEnd; i++) indices.push(i);
      if (outside >= rowEnd) indices.push(outside);
    }

    // Rows keep their elements by ref (rows by identity, groups' headers by
    // key), so a row that moves (a rolling window dropping rows above it, a
    // sort, a group expanding above it) keeps its text.
    const previous = new Map<number | string, Row>();
    for (const row of this.#rows) if (row.ref) previous.set(row.ref.id, row);
    const entries = indices.map((index) => model.row(index));
    const found = entries.map(({ ref }) => {
      const row = previous.get(ref.id);
      // Rows of another scope (from before a reset, or of groups replaced) may share ids.
      if (row?.ref?.scope !== ref.scope) return undefined;
      previous.delete(ref.id);
      return row;
    });
    // Rows no longer shown, those from before a reset among them.
    const kept = new Set(found);
    const free = this.#rows.filter((row) => !kept.has(row));
    const rows = found.map((row, k) => {
      const entry = entries[k]!;
      // The same row may come with a new ref (its group collapsed and expanded again).
      if (row) {
        row.ref = entry.ref;
        return row;
      }
      const reused = free.pop() ?? this.#newRow();
      reused.ref = entry.ref;
      reused.written = null;
      // Group headers and table rows mark selection differently.
      reused.selected = null;
      return reused;
    });
    for (const row of free) {
      for (const cell of row.cells) this.#host.release(cell);
      row.element.remove();
    }
    arrange(
      this.#body,
      rows.map(({ element }) => element),
      this.#holder(this.#body),
    );
    this.#rows = rows;
    // Views destroyed (above, and as cells go or write text below) may change the model.
    if (this.#destroyed || model.revision !== drawing) return false;

    const grouped = model.grouped;
    const height = model.rowHeight;
    // Mounted cells read their looks again when what looks follow besides
    // their rows moved (a domain, a rank, the looks themselves).
    const looks = model.hasLooks;
    const revision = looks ? model.looksRevision : -1;
    const relook = revision !== this.#looks;
    this.#looks = revision;
    // And a column's kinds again when what its kind reads besides its rows
    // moved (a bar's domain, a sparkline's data), for that column alone.
    const hosted = this.#host.hosted(layout);
    const kinds = layout.map((column, c) =>
      hosted[c] && column.content.cell ? model.cellsRevision(c) : 0,
    );
    for (let k = 0; k < rows.length; k++) {
      const row = rows[k]!;
      const index = indices[k]!;
      const entry = entries[k]!;
      if (row.index !== index) {
        row.index = index;
        row.element.setAttribute("aria-rowindex", String(index + 1 + this.#levels));
      }
      const y = index * height - shift;
      if (row.y !== y) {
        row.y = y;
        row.element.style.transform = `translateY(${y}px)`;
      }
      if (row.width !== this.#spacer.width) {
        row.width = this.#spacer.width;
        row.element.style.width = `${row.width}px`;
      }
      this.#placeInTree(row.element, entry, grouped);
      this.#extras.row?.(row.element, entry);
      const selected = model.selectionState(index);
      if (row.selected !== selected) {
        row.selected = selected;
        // A group's header can be partly selected, which its checkbox says.
        if (entry.kind === "group") row.element.removeAttribute("aria-selected");
        else row.element.setAttribute("aria-selected", String(selected === "all"));
        row.element.dataset.selection = selected;
      }
      // A table row's cells keep their text while their columns only move or
      // resize; a group's header's first cell names the group, so its text
      // goes with the columns' places.
      const written = row.written;
      const stale =
        written?.version !== entry.version || (entry.kind !== "row" && written.layout !== layout);
      row.written = { version: entry.version, layout };
      const columns = columnsOf(shown, keep?.rowIndex === index ? keep : null, layout);
      row.cells = this.#mountCells(row.element, row, row.cells, columns, layout);
      if (this.#destroyed || model.revision !== drawing) return false;
      for (const cell of row.cells) {
        const column = layout[cell.column]!;
        const controls = entry.kind === "group" && cell.column === 0;
        this.#place(cell, column, layout);
        const host = hosted[cell.column] && entry.kind === "row";
        // Rows of other kinds, and columns drawing text alone, write text.
        if (cell.held && !host) {
          this.#host.release(cell);
          cell.content = null;
          if (this.#destroyed || model.revision !== drawing) return false;
        }
        const decorated = this.#decorate(cell, controls, selected, grouped);
        const write = stale || decorated || cell.content !== column.content;
        if (host) {
          const redraw = cell.kinds !== kinds[cell.column];
          cell.kinds = kinds[cell.column]!;
          cell.content = column.content;
          this.#host.draw(
            cell,
            cell.column,
            column,
            entry,
            index,
            selected,
            write || relook || redraw,
            model as unknown as BaseGridModel,
            this.#hostPaint,
          );
          if (this.#destroyed || model.revision !== drawing) return false;
          continue;
        }
        this.#write(
          cell,
          column,
          write,
          relook,
          (c) => model.textAt(index, c),
          (c) => (looks ? model.lookAt(index, c) : undefined),
        );
      }
    }
    return true;
  }

  /**
   * Writes a cell of text, of a table row, a group's, or the totals row:
   * its text (`textAt`) where `write`, and its look (`lookAt`) where that
   * or `relook`.
   */
  #write(
    cell: Cell,
    column: PlacedColumn,
    write: boolean,
    relook: boolean,
    textAt: (column: number) => string,
    lookAt: (column: number) => CellLook | undefined,
  ) {
    if (write) {
      cell.content = column.content;
      setText(cell.text, textAt(cell.column));
    }
    if (write || relook) this.#paint(cell, lookAt(cell.column));
  }

  /**
   * Draws the totals row in the footer, over the columns mounted (and the
   * focused one), writing its cells where its values, looks, or columns
   * changed; with no totals or no column shown, the footer is hidden.
   */
  #drawTotals(shown: GridRange, keep: GridFocus | null, layout: readonly PlacedColumn[]) {
    const model = this.model;
    const totals = this.#totals;
    const row = model.totalsRow;
    if (this.#footer.hidden === this.#footed) this.#footer.hidden = !this.#footed;
    if (!row || !this.#footed) {
      if (totals.cells.length > 0) {
        for (const cell of totals.cells) cell.element.remove();
        totals.cells = [];
      }
      this.#totalsWritten = null;
      return;
    }
    const count = model.rowCount;
    const columns = columnsOf(shown, keep?.rowIndex === count ? keep : null, layout);
    totals.cells = this.#mountCells(totals.element, totals, totals.cells, columns, layout);
    const version = row.version;
    const themes = this.#themes;
    const written = this.#totalsWritten;
    const stale =
      written?.row !== row ||
      written.version !== version ||
      written.layout !== layout ||
      written.themes !== themes;
    this.#totalsWritten = { row, version, layout, themes };
    for (const cell of totals.cells) {
      const column = layout[cell.column]!;
      this.#place(cell, column, layout);
      const write = stale || cell.content !== column.content;
      this.#write(cell, column, write, false, row.textAt, row.lookAt);
    }
    const element = totals.element;
    if (row.state === "loading") setAttribute(element, "aria-busy", "true");
    else element.removeAttribute("aria-busy");
    setAttribute(element, "data-state", row.state === "loaded" ? "" : row.state);
  }

  /**
   * A row's place in the tree, for grouped grids: its level, place among its
   * siblings, and expansion, and how far its first cell is indented (a
   * table row's as far as its group's header).
   */
  #placeInTree(element: HTMLDivElement, entry: ShownRow, grouped: boolean) {
    if (!grouped) {
      for (const name of ["aria-level", "aria-posinset", "aria-setsize", "aria-expanded"])
        element.removeAttribute(name);
      element.style.removeProperty("--hg-indent");
      return;
    }
    const indent = String(
      entry.kind === "placeholder" ? entry.indent : entry.level - (entry.kind === "group" ? 1 : 2),
    );
    if (element.style.getPropertyValue("--hg-indent") !== indent)
      element.style.setProperty("--hg-indent", indent);
    setAttribute(element, "aria-level", String(entry.level));
    setAttribute(element, "aria-posinset", String(entry.setIndex + 1));
    setAttribute(element, "aria-setsize", String(entry.setSize));
    if (entry.kind === "group") setAttribute(element, "aria-expanded", String(entry.expanded));
    else element.removeAttribute("aria-expanded");
  }

  /**
   * Puts a group's checkbox in a cell, with its expand toggle when groups
   * can expand (not a pivot's), or takes them out; whether they came or
   * went (the text must be written again).
   */
  #decorate(cell: Cell, wanted: boolean, selected: SelectionState, toggles: boolean): boolean {
    const shown = cell.controls?.element.parentNode === cell.element;
    if (wanted) {
      let controls = cell.controls;
      if (!controls) {
        const document = this.root.ownerDocument;
        const element = document.createElement("span");
        element.className = "hg-controls";
        const toggle = document.createElement("span");
        toggle.className = "hg-toggle";
        toggle.setAttribute("aria-hidden", "true");
        const check = document.createElement("span");
        check.className = "hg-check";
        check.setAttribute("role", "checkbox");
        check.setAttribute("aria-label", "Select");
        if (toggles) element.append(toggle);
        element.append(check);
        controls = { element, check };
        cell.controls = controls;
      }
      setAttribute(
        controls.check,
        "aria-checked",
        selected === "all" ? "true" : selected === "some" ? "mixed" : "false",
      );
      if (!shown) cell.element.insertBefore(controls.element, cell.text);
    } else if (shown) {
      cell.controls!.element.remove();
    }
    return wanted !== shown;
  }

  /** Writes a cell's look where it changed: its fill and text color, as CSS properties the stylesheet reads. */
  #paint(cell: Cell, look: CellLook | undefined) {
    const fill = this.#filled(look?.fill);
    const color = this.#paletted(look?.color);
    if (fill === cell.fill && color === cell.color && cell.themed === this.#themes) return;
    cell.fill = fill;
    cell.color = color;
    cell.themed = this.#themes;
    // Text over a fill without a color of its own takes the fill's inks.
    const inks = fill !== undefined && color === undefined ? this.#inksOf(fill) : undefined;
    const { element } = cell;
    for (const [name, value] of [
      ["--hg-look-fill", fill],
      ["--hg-look-color", color],
      ["--hg-look-ink", inks?.[0]],
      ["--hg-look-ink-selected", inks?.[1]],
    ] as const)
      if (value === undefined) element.style.removeProperty(name);
      else element.style.setProperty(name, value);
    const kinds = [fill !== undefined && "fill", color !== undefined && "color"].filter(Boolean);
    setAttribute(element, "data-look", kinds.join(" "));
  }

  /** A look's fill as cells paint it. */
  #filled(given: string | undefined): string | undefined {
    // currentColor would follow the text over the fill, which the fill sets:
    // it is the color text has without a look.
    return given !== undefined && /^\s*currentcolor\s*$/i.test(given)
      ? "var(--hg-text)"
      : this.#paletted(given);
  }

  /**
   * Black or white text over `fill` (in a kind's color `top` over it), in
   * plain and selected rows: worked out once a fill and theme, for as many
   * fills as a screen shows (a field of colors streaming through starts the
   * cache again). A kind's color over a fill only the page reads takes its
   * inks over the surface.
   */
  #inksOf(fill: string | undefined, top?: string): readonly [string, string] {
    const key = top === undefined ? fill! : `${top}\u0000${fill ?? ""}`;
    let inks = this.#inks.get(key);
    if (!inks) {
      if (this.#inks.size >= INKS_KEPT) this.#inks.clear();
      // Without a fill the grid reads, a kind's color is taken over the surface, which it does.
      inks =
        this.#contrast(fill, top) ??
        (top === undefined ? PAGE_INKS : this.#contrast(undefined, top)!);
      this.#inks.set(key, inks);
    }
    return inks;
  }

  /** A look's color as the page reads it: a palette place takes the theme's palette color there, cycled. */
  #paletted(color: string | undefined): string | undefined {
    const place = color === undefined ? null : /^var\(--hg-palette-(\d+)\)$/.exec(color);
    const palette = this.#palette;
    return place && palette.length > 0 ? palette[Number(place[1]) % palette.length] : color;
  }

  #newRow(): Row {
    const element = this.root.ownerDocument.createElement("div");
    element.setAttribute("role", "row");
    return {
      element,
      cells: [],
      index: -1,
      ref: null,
      written: null,
      y: Number.NaN,
      width: -1,
      selected: null,
    };
  }

  /**
   * The cells of shown columns `columns` in a row (null: the header), in
   * order: cells already showing a column keep it, the others are reused or
   * made. Newly assigned cells have `placed` null.
   */
  #mountCells(
    parent: HTMLElement,
    row: Row | null,
    current: Cell[],
    columns: number[],
    layout: readonly GridColumnLayout[],
  ): Cell[] {
    const ids = columns.map((column) => layout[column]!.id);
    if (
      current.length === columns.length &&
      current.every((cell, k) => cell.column === columns[k] && cell.id === ids[k])
    )
      return current;
    // Cells keep their column by id, so the focused one stays when columns move.
    const byId = new Map(current.map((cell) => [cell.id, cell]));
    const cells: (Cell | undefined)[] = ids.map((id) => {
      const cell = byId.get(id);
      byId.delete(id);
      return cell;
    });
    const free = [...byId.values()];
    for (let k = 0; k < cells.length; k++) {
      const cell = cells[k] ?? free.pop() ?? this.#cell(row);
      if (!cells[k] || cell.column !== columns[k]) cell.placed = null;
      cell.id = ids[k]!;
      cell.column = columns[k]!;
      cells[k] = cell;
    }
    for (const cell of free) {
      this.#host.release(cell);
      cell.element.remove();
    }
    const mounted = cells as Cell[];
    arrange(
      parent,
      mounted.map(({ element }) => element),
      this.#holder(parent),
    );
    return mounted;
  }

  #cell(row: Row | null): Cell {
    const document = this.root.ownerDocument;
    const element = document.createElement("div");
    element.setAttribute("role", row ? "gridcell" : "columnheader");
    element.tabIndex = -1;
    const text = document.createTextNode("");
    element.append(text);
    let sort: Text | undefined;
    if (!row) {
      const mark = document.createElement("span");
      mark.className = "hg-sort";
      mark.setAttribute("aria-hidden", "true");
      sort = document.createTextNode("");
      mark.append(sort);
      // For pointers: the keys and the context menu do what these do.
      const button = document.createElement("span");
      button.className = "hg-menu-button";
      button.setAttribute("aria-hidden", "true");
      const edge = document.createElement("span");
      edge.className = "hg-resize";
      edge.setAttribute("aria-hidden", "true");
      element.append(mark, button, edge);
    }
    const cell: Cell = {
      held: null,
      content: null,
      kinds: Number.NaN,
      fill: undefined,
      color: undefined,
      themed: 0,
      element,
      text,
      sort,
      controls: null,
      row,
      id: "",
      column: -1,
      placed: null,
    };
    this.#cells.set(element, cell);
    return cell;
  }

  /**
   * Places a cell for its column; whether it was not placed for it already.
   * Cells of columns held at an edge are in the row's flow and stick there
   * (sticky offsets are their distances from the edge); the others are
   * placed absolutely, and scroll under them.
   */
  #place(cell: Cell, column: GridColumnLayout, layout: readonly GridColumnLayout[]): boolean {
    if (cell.placed === column) return false;
    cell.placed = column;
    const index = cell.column;
    placeCell(cell.element, column, layout, index, index + 1, this.model.width);
    setAttribute(cell.element, "aria-colindex", String(index + 1));
    return true;
  }

  /** The child of `parent` holding the page's focus, which must not move: moving it would drop the focus. */
  #holder(parent: HTMLElement): Element | null {
    const active = (this.root.getRootNode() as Document | ShadowRoot).activeElement;
    let at: Element | null = active;
    while (at && at.parentElement !== parent) at = at.parentElement;
    return at;
  }

  /**
   * The tab stop's tab index: in the page's tab order, but not inside
   * another grid's cell, whose keys move into it and out of it (as a
   * composite cell's), and which takes its controls out of the order.
   */
  #tabStop(): number {
    return this.root.parentElement?.closest(".herceg-grid") ? -1 : 0;
  }

  /**
   * Gives the focused cell the tab stop, and the page's focus when the grid
   * holds it: its element, or what in it takes the focus (a link, a control).
   */
  #placeFocus(focus: GridFocus | null, holding: boolean) {
    const cell = focus ? this.#cellAt(focus) : null;
    const target = cell ? this.#host.target(cell) : null;
    if (target !== this.#active) {
      this.#active?.setAttribute("tabindex", "-1");
      this.#active = target;
    }
    const stop = this.#tabStop();
    // A renderer's update may have taken its control out of the tab order.
    if (target && target.tabIndex !== stop) target.tabIndex = stop;
    // Without a mounted focused cell, the grid itself is the tab stop.
    this.#scroller.tabIndex = target ? -1 : stop;
    if (!holding) return;
    const root = this.root.getRootNode() as Document | ShadowRoot;
    const active = root.activeElement;
    // A composite cell's controls keep the focus they were given.
    if (
      target &&
      active !== target &&
      (active === cell!.element || !cell!.element.contains(active))
    )
      target.focus({ preventScroll: true });
    else if (!target && !this.#scroller.contains(root.activeElement))
      this.#scroller.focus({ preventScroll: true });
  }

  /**
   * A framework drew a focused cell's content: what takes its focus now
   * (a control cell's control, which may be another element than before)
   * takes the tab stop, and the page's focus where the cell had it: on the
   * cell, or lost as the framework removed or hid what held it (a control,
   * a composite's control, content suspending again); not where the user
   * has gone since.
   */
  #shown(cell: Cell) {
    const focus = this.model.focus;
    if (!focus || this.#cellAt(focus) !== cell) return;
    const target = this.#host.target(cell);
    const before = this.#active;
    const root = this.root.getRootNode() as Document | ShadowRoot;
    const active = root.activeElement;
    // No focusout says the focus left the grid: what held it went, or is
    // hidden and about to lose it.
    const away = active === null || active === cell.element.ownerDocument.body;
    const lost =
      this.#focused &&
      [before, this.#lastFocused].some(
        (one) => one !== null && (one === active || away) && !canFocus(one),
      );
    if (before !== target) {
      if (before?.isConnected && before.tabIndex !== -1) before.tabIndex = -1;
      this.#active = target;
    }
    const stop = this.#tabStop();
    if (target.tabIndex !== stop) target.tabIndex = stop;
    if ((active === cell.element || lost) && active !== target)
      target.focus({ preventScroll: true });
  }

  #cellAt({ rowIndex, columnIndex }: GridFocus): Cell | null {
    const cells =
      rowIndex < 0
        ? this.#headerCells
        : rowIndex >= this.model.rowCount
          ? this.#totals.cells
          : this.#rows.find(({ index }) => index === rowIndex)?.cells;
    return cells?.find(({ column }) => column === columnIndex) ?? null;
  }

  /** The mounted cell holding `element` (or being it), and whether the element is its link's or controls'. */
  #holding(element: Element | null): { cell: Cell; owner: ReturnType<CellHost["owns"]> } | null {
    for (let at = element; at && at !== this.#scroller; at = at.parentElement) {
      const cell = this.#cells.get(at);
      if (cell) return { cell, owner: element ? this.#host.owns(element, cell) : null };
    }
    return null;
  }

  #listen() {
    const scroller = this.#scroller;
    const listeners = [
      ["scroll", this.#onScroll],
      ["keydown", this.#onKeyDown],
      ["mousedown", this.#onMouseDown],
      ["click", this.#onClick],
      ["focusin", this.#onFocusIn],
      ["focusout", this.#onFocusOut],
    ] as const;
    for (const [type, listener] of listeners)
      scroller.addEventListener(type, listener as EventListener, { passive: type === "scroll" });
    // Detached elements can outlive the grid (browsers remember where the focus was).
    this.#stops.push(() => {
      for (const [type, listener] of listeners)
        scroller.removeEventListener(type, listener as EventListener);
    });
  }

  #onScroll = () => {
    const scroller = this.#scroller;
    this.#scrollTop = scroller.scrollTop;
    this.#scrollLeft = scroller.scrollLeft;
    // At the offset last drawn, the scroll was the grid's own (or along x
    // only): the model's top, which may have moved on since, stays.
    if (this.#scrollTop === this.#expected?.physical) {
      this.model.scrollTo({ left: this.#scrollLeft });
      return;
    }
    this.#expected = null;
    this.model.scrollTo({ top: this.#scrollTop * this.#ratio, left: this.#scrollLeft });
  };

  #onKeyDown = (event: KeyboardEvent) => {
    // Keys a cell's own content took (a nested grid's, a control's, a popup's Escape).
    if (event.defaultPrevented) return;
    const holding = this.#holding(event.target as Element);
    const owner = holding?.owner;
    const key = event.key;
    if (owner === "composite") {
      // Inside a composite cell the keys are its controls', but Escape goes
      // back to the cell, and Tab leaves the grid as from the cell.
      if (key === "Escape" || key === "Tab") holding!.cell.element.focus({ preventScroll: true });
      if (key === "Escape") event.preventDefault();
      return;
    }
    // A link's Enter is its own, and a control's Enter and Space; arrows stay the grid's.
    if (
      (owner === "link" && key === "Enter") ||
      (owner === "control" && (key === "Enter" || key === " "))
    )
      return;
    if (
      !owner &&
      holding &&
      (key === "Enter" || key === "F2") &&
      !event.altKey &&
      this.#host.enter(holding.cell)
    ) {
      event.preventDefault();
      return;
    }
    const model = this.model;
    const focus = model.focus;
    if (focus && focus.rowIndex < 0 && this.#controls.keyDown(event, focus.column)) return;
    if (!focus || event.altKey) return;
    const command = event.ctrlKey || event.metaKey;
    if (Object.hasOwn(MOVES, key)) {
      const move = MOVES[key as keyof typeof MOVES];
      const target =
        command && move === "rowStart" ? "first" : command && move === "rowEnd" ? "last" : move;
      // Shift extends the selection with moves between rows.
      const across =
        target === "left" || target === "right" || target === "rowStart" || target === "rowEnd";
      const before = model.selectionRevision;
      const expansion = this.#expansion(focus.rowIndex);
      model.moveFocus(target, { extend: event.shiftKey && !across });
      if (model.selectionRevision !== before) this.#announceSelection();
      // Left and Right expand and collapse groups on their first cell.
      expansion(true);
    } else if ((key === " " || key === "Enter") && focus.rowIndex < 0) {
      // Columns without a field have nothing to sort by.
      if (model.columnLayout[focus.columnIndex]?.field === null) return;
      model.cycleSort(focus.column, { additive: event.shiftKey });
      this.#announceSort();
    } else if ((key === " " || key === "Enter") && focus.rowIndex >= model.rowCount) {
      // The totals row neither selects nor is clicked.
    } else if (key === "Enter" && this.#groupAt(focus.rowIndex)) {
      const { key: groupKey, expanded } = this.#groupAt(focus.rowIndex)!;
      const expansion = this.#expansion(focus.rowIndex);
      model.setExpanded(groupKey, !expanded);
      expansion(false);
    } else if (key === "Enter") {
      // Enter on a row's cell is a click on it, without selecting (Space selects).
      this.#clicked(model.row(focus.rowIndex).ref, focus.column, "keyboard");
    } else if (key === " ") {
      model.select(focus.rowIndex, "toggle");
      this.#announceSelection();
    } else if (command && key.toLowerCase() === "a") {
      model.selectAll();
      this.#announceSelection();
    } else if (key === "Escape" && model.clearSelection()) {
      this.#announceSelection();
    } else return;
    event.preventDefault();
    this.#focusRequested = true;
    this.render();
  };

  #onMouseDown = (event: MouseEvent) => {
    // Presses on a cell's link or control are its own (a Shift click opens a link in a window).
    if (this.#holding(event.target as Element)?.owner) {
      this.#press = null;
      return;
    }
    this.#press = { x: event.clientX, y: event.clientY };
    // Shift and click selects rows, not text.
    if (event.shiftKey) event.preventDefault();
  };

  #onClick = (event: MouseEvent) => {
    const press = this.#press;
    this.#press = null;
    // Drags of headers, their edges, and their menu buttons are not clicks on cells.
    if (this.#controls.click(event)) return;
    // A press that moved selected text.
    if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_SLOP) return;
    const clicked = event.target as Element;
    const holding = this.#holding(clicked);
    // A press on a cell's link or control neither selects its row nor is a click on the grid.
    if (holding?.owner) return;
    const cell = holding?.cell.element ?? null;
    let target = this.#cellOf(cell);
    if (!target) return;
    const model = this.model;
    // Focus first: listeners of the sort or the selection may change the
    // rows, so the cell is found again after (or the click goes nowhere).
    model.focusCell(target.rowIndex, target.column);
    target = this.#cellOf(cell);
    if (!target) return;
    const { rowIndex, column } = target;
    const group = this.#groupAt(rowIndex);
    if (rowIndex < 0) {
      if (model.columnLayout[model.columnIndex(column)]?.field !== null) {
        model.cycleSort(column, { additive: event.shiftKey });
        this.#announceSort();
      }
    } else if (rowIndex >= model.rowCount) {
      // The totals row is focused, never selected or clicked.
    } else if (group && clicked.closest(".hg-toggle")) {
      const expansion = this.#expansion(rowIndex);
      model.setExpanded(group.key, !group.expanded);
      expansion(false);
    } else if (clicked.closest(".hg-check")) {
      model.select(rowIndex, "toggle");
      this.#announceSelection();
    } else {
      // The row, named before selecting: listeners of the selection may move it.
      const { ref } = model.row(rowIndex);
      const command = event.ctrlKey || event.metaKey;
      if (!command && !event.shiftKey) model.click(rowIndex);
      else model.select(rowIndex, command ? (event.shiftKey ? "addRange" : "toggle") : "range");
      this.#announceSelection();
      this.#focusRequested = true;
      this.render();
      this.#clicked(ref, column, "pointer");
      return;
    }
    this.#focusRequested = true;
    this.render();
  };

  #onFocusIn = (event: FocusEvent) => {
    this.#focused = true;
    this.#lastFocused = event.target as Element;
    if (this.#rendering) return;
    const model = this.model;
    // The focus on a cell's link or control is its cell's.
    const cell = this.#cellOf(this.#holding(event.target as Element)?.cell.element ?? null);
    const focus = model.focus;
    if (cell) {
      if (focus?.rowIndex !== cell.rowIndex || focus.column !== cell.column)
        model.focusCell(cell.rowIndex, cell.column);
    } else if (event.target === this.#scroller && focus) {
      // Tabbing in goes to the focused cell, wherever it was scrolled.
      model.reveal(focus.rowIndex, focus.column);
      this.render();
    }
  };

  #onFocusOut = (event: FocusEvent) => {
    const to = event.relatedTarget as Node | null;
    if (to !== null) {
      if (!this.#scroller.contains(to)) this.#leave();
    } else {
      // Chrome says the focus went out as a focused element is removed,
      // hidden, or disabled (a framework replacing a control, content
      // suspending), which is not the user leaving: they left only if the
      // element can still hold the focus.
      const from = event.target as Element;
      queueMicrotask(() => {
        if (canFocus(from)) this.#leave();
      });
    }
    // Once the focus has left, the focused cell need not stay mounted.
    if (!this.#rendering) this.#invalidate();
  };

  /** The user took the page's focus out of the grid. */
  #leave() {
    this.#focused = false;
    this.#lastFocused = null;
  }

  /**
   * The cell an element shows, as the model has it now, which may have
   * changed since the element was drawn; null when its row or column is gone.
   */
  #cellOf(element: Element | null): { rowIndex: number; column: string } | null {
    const cell = element && this.#cells.get(element);
    // A column id now naming another field is another column.
    const column = cell && this.model.columnLayout[this.model.columnIndex(cell.id)];
    if (!cell || !column || column.field !== cell.placed?.field) return null;
    const { row } = cell;
    if (!row) return { rowIndex: -1, column: cell.id };
    if (row === this.#totals)
      return this.model.totalsRow ? { rowIndex: this.model.rowCount, column: cell.id } : null;
    const rowIndex = row.ref ? this.model.indexOf(row.ref) : -1;
    return rowIndex < 0 ? null : { rowIndex, column: cell.id };
  }

  /** The group whose header is at `rowIndex`, as it is now; null for other rows. */
  #groupAt(rowIndex: number): (ShownRow & { kind: "group" }) | null {
    if (rowIndex < 0 || rowIndex >= this.model.rowCount || !this.model.grouped) return null;
    const row = this.model.row(rowIndex);
    return row.kind === "group" ? row : null;
  }

  /**
   * What says, after a command, whether the group at `rowIndex` (named as it
   * is now: listeners of the command may move it) expanded or collapsed;
   * with `changed`, only if it did.
   */
  #expansion(rowIndex: number): (changed: boolean) => void {
    const group = this.#groupAt(rowIndex);
    if (!group) return () => {};
    const name = this.model.textAt(rowIndex, 0);
    return (changed) => {
      const expanded = this.model.isExpanded(group.key);
      if (!changed || expanded !== group.expanded)
        this.#say(`${name} ${expanded ? "expanded" : "collapsed"}`);
    };
  }

  #announceSort() {
    const model = this.model;
    const title = (field: string) => {
      const column = model.columns.find((column) => column.field === field);
      return column ? model.columnTitle(column.id ?? field) : field;
    };
    const keys = model.sort;
    this.#say(
      keys.length === 0
        ? "Not sorted"
        : `Sorted by ${keys.map(({ field, order }) => `${title(field)}, ${order ?? "ascending"}`).join(", then ")}`,
    );
  }

  #announceSelection() {
    const count = this.model.selectedCount;
    this.#say(
      count === null
        ? "Matching rows selected"
        : count === 0
          ? "No rows selected"
          : count === 1
            ? "1 row selected"
            : `${count} rows selected`,
    );
  }

  #say(text: string) {
    // The same words again are a new announcement.
    this.#live.textContent = this.#live.textContent === text ? `${text} ` : text;
  }
}

/** A grid in `container`; see `Grid`. */
export function createGrid<S extends Schema>(
  container: HTMLElement,
  options: GridOptions<S>,
): Grid<S> {
  return new Grid(container, options);
}

function element(document: Document, className?: string): HTMLDivElement {
  const div = document.createElement("div");
  if (className) div.className = className;
  return div;
}

/**
 * The shown columns to mount, in order: those held at the left edge, the
 * scrolling ones in range (with the focused cell's column when outside it),
 * and those held at the right edge.
 */
function columnsOf(
  { columnStart: start, columnEnd: end }: GridRange,
  keep: GridFocus | null,
  layout: readonly GridColumnLayout[],
): number[] {
  const indices: number[] = [];
  let left = 0;
  while (left < layout.length && layout[left]!.pinned === "left") indices.push(left++);
  let right = layout.length;
  while (right > left && layout[right - 1]!.pinned === "right") right--;
  const index = keep?.columnIndex ?? -1;
  const extra = index >= left && index < right && (index < start || index >= end) ? index : -1;
  if (extra >= 0 && extra < start) indices.push(extra);
  for (let i = start; i < end; i++) indices.push(i);
  if (extra >= end) indices.push(extra);
  for (let i = right; i < layout.length; i++) indices.push(i);
  return indices;
}
