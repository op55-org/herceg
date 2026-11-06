// Cell kinds: what a grid column draws per row besides its text
// (docs/guide/grids.md, "Cells"). Each is made by a function that carries
// its implementation, as marks are, so a grid loads only the kinds it
// names. The function only builds a descriptor: its model part checks the
// column and finds what the kind reads of the rows (a bar's domain), and
// its DOM part runs only when a grid mounts it, reaching the page only
// through the cell element it is given, so models and exports work
// without a document. Sparklines, which draw another table's rows in
// columns without a field, are grid/sparklines.ts's.

import type { Fields } from "../data/expression.ts";
import type { MarkRows } from "../data/row-view.ts";
import { type SymbolName, vertices } from "../draw/symbol-shapes.ts";
import { nextRevision } from "../encoding/channel-scales.ts";
import type { FormatSettings, PlacedColumn } from "./columns.ts";
import type { Sparkline, SparklineCellSpec, SparklineRead } from "./sparklines.ts";

/** The kinds of field a cell can draw. */
export type CellFieldKind = "number" | "time" | "category";

/** A bar from `base` to each value: a data bar, or with `track`, a progress bar. */
export interface BarCellOptions {
  /**
   * The values at the cell's ends: given, else each end from the field's
   * display `min` and `max`, else from the extent of the records with
   * `base` included. Values past an end fill to it.
   */
  domain?: readonly [number, number] | undefined;
  /** Where bars start; 0 by default, held within the domain. */
  base?: number | undefined;
  /** Draws the rest of the domain in the theme's line color: a progress bar. */
  track?: boolean | undefined;
  /** Writes the value's text over the bar; true by default. Without it, the text still names the cell. */
  text?: boolean | undefined;
}

/** A symbol per value, its shape by `encode.symbol` and its fill by `encode.color`. */
export interface SymbolCellOptions {
  /** The symbol's area in square pixels; 64 by default. */
  size?: number | undefined;
  /** Writes the value's text after the symbol; true by default. Without it, the text still names the cell. */
  text?: boolean | undefined;
}

/** A cell kind's portable form, as a grid spec would carry it. */
export type GridCellSpec =
  | ({ readonly kind: "bar" } & Readonly<BarCellOptions>)
  | { readonly kind: "chip" }
  | ({ readonly kind: "symbol" } & Readonly<SymbolCellOptions>)
  | SparklineCellSpec;

/**
 * What a column's cells draw besides their text: made by `barCell`,
 * `chipCell`, or `symbolCell`.
 * `draws` says which kinds of field it takes (types only); `spec` is its
 * portable form.
 */
export interface GridCell<K extends CellFieldKind = CellFieldKind> {
  readonly spec: GridCellSpec;
  readonly draws?: (kind: K) => void;
  readonly reads?: never;
}

/**
 * What a column without a field draws: made by `sparklineCell`. `reads` is
 * the grid's field it matches rows by (types only).
 */
export interface UnboundCell<K extends string = string> {
  readonly spec: GridCellSpec;
  readonly reads?: K;
  readonly draws?: never;
}

/** Where a descriptor keeps its implementation, apart from what it serializes. */
export const KIND: unique symbol = Symbol("herceg cell kind");

/** What the theme gives a kind's drawing: its colors as the page reads them, and text's ink over one. */
export interface CellPaint {
  /** A look's color as the page reads it (palette places resolved); undefined for none. */
  color(color: string | undefined): string | undefined;
  /**
   * Black or white text in `color` (as the page reads it; without one, a
   * chip's faint default) over the cell's `fill` (its look's, or the
   * surface without one), whichever contrasts more: in plain rows and in
   * selected rows.
   */
  inks(color: string | undefined, fill: string | undefined): readonly [string, string];
}

/** A cell element's drawing of a kind, made when the element is given its column and kept across rows. */
export interface CellView {
  /**
   * Draws a row's cell (see `KindRead`; null for a row the kind draws
   * nothing for, a group's) of `column`, in a row `height` CSS pixels tall.
   */
  write(cell: KindRead | null, paint: CellPaint, column: PlacedColumn, height: number): void;
  /** Takes its parts out of the element, leaving it as it was given. */
  remove(): void;
}

/** What a kind's drawing reads of a cell: its state, its look's color and symbol, and a bar's ends. */
export interface KindRead {
  readonly state: string;
  readonly look:
    | {
        readonly fill?: string | undefined;
        readonly color?: string | undefined;
        readonly symbol?: SymbolName | undefined;
      }
    | undefined;
  /** A bar's ends, as fractions of the cell from its start; undefined for none. */
  readonly bar?: readonly [number, number] | undefined;
  /** A sparkline's series, as the model read it; undefined for none. */
  readonly sparkline?: SparklineRead | undefined;
}

/**
 * A kind's implementation: its model part (`check` and `bind` for columns
 * of a field, `describe` for columns without one) and its DOM part (`css`,
 * `mount`).
 */
export interface CellKind {
  readonly name: GridCellSpec["kind"];
  /** Whether its cells show their text; without, the text names them only. */
  readonly text: boolean;
  /**
   * Whether what it draws depends on the cell's size or the pixel ratio:
   * its view is then given every frame its cell is drawn in, with the last
   * read when nothing else changed, and keeps what it drew at.
   */
  readonly sized?: boolean;
  /**
   * Refuses a field of kind `kind` (named `field`), at `at`, that it does
   * not draw; a kind of columns without a field refuses every field.
   */
  check(field: string, kind: CellFieldKind, at: string): void;
  /**
   * For a kind of columns without a field (a sparkline): checks the column
   * (at `at`) against the grid's fields (`table`) as `settings` say, and
   * says what its cells write and draw from.
   */
  describe?(
    table: Pick<Fields, "has" | "kind">,
    column: { readonly text?: unknown },
    settings: FormatSettings,
    at: string,
  ): UnboundContent;
  /**
   * What it reads of the rows for a column of `field`, where it reads any
   * (a bar's domain): its bounds from the field's display, and the records
   * (none for a remote grid's).
   */
  bind?(
    field: string,
    bounds: { readonly min?: number | undefined; readonly max?: number | undefined },
    rows: (() => MarkRows) | undefined,
    at: string,
  ): CellBinding;
  /** Its stylesheet, which a grid adds once it mounts the kind. */
  readonly css: string;
  /** Draws in `element`, a cell element holding the cell's `text`. */
  mount(element: HTMLElement, text: Text): CellView;
}

/**
 * What a kind of columns without a field makes of one grid's column: its
 * cells' text, the grid's fields that text reads (which remote grids ask
 * for), and the sparkline it draws from.
 */
export interface UnboundContent {
  text(fields: Fields, position: number): string;
  readonly reads: readonly string[];
  readonly sparkline: Sparkline;
}

/** What a kind reads of the rows for one column, brought up to date as they change (`update`), never as cells are read. */
export interface CellBinding {
  update(): void;
  /** Changes whenever what the kind draws for a row may, other than with the row. */
  readonly revision: number;
  /** A bar's ends for a value, as fractions of the cell; undefined for none. */
  bar(value: number | null): readonly [number, number] | undefined;
}

/** The implementation of a descriptor, or undefined for anything else. */
export function kindOf(cell: unknown): CellKind | undefined {
  return typeof cell === "object" && cell !== null
    ? (cell as { [KIND]?: CellKind })[KIND]
    : undefined;
}

/** Whether a column's cells are a symbol cell's, which take `encode.symbol`. */
export function drawsSymbols(column: { readonly cell?: unknown }): boolean {
  return kindOf(column.cell)?.name === "symbol";
}

/** A descriptor of `spec` (copied and frozen), carrying `kind`. */
function descriptor<K extends CellFieldKind>(spec: GridCellSpec, kind: CellKind): GridCell<K> {
  const domain = "domain" in spec ? spec.domain : undefined;
  const copy = Object.freeze({
    ...spec,
    ...(domain && { domain: Object.freeze([...domain]) as readonly [number, number] }),
  });
  return Object.freeze({ spec: copy, [KIND]: kind });
}

/** Refuses an option that is not a boolean, at `at`. */
function checkFlag(value: unknown, at: string) {
  if (value !== undefined && typeof value !== "boolean")
    throw new TypeError(`${at}: expected true or false; received ${JSON.stringify(value)}`);
}

const G = ".herceg-grid";

/**
 * A bar from `base` (0) to each value, in the column's `encode.color` (the
 * theme's accent by default), translucent behind the value's text; with
 * `track`, the rest of the domain in the line color: a progress bar. A
 * missing value draws no bar.
 */
export function barCell(options: BarCellOptions = {}): GridCell<"number"> {
  const { base = 0, track = false, text = true } = options;
  // Taken as given now: what checks, draws, and serializes it is one array.
  const domain = Array.isArray(options.domain)
    ? (Object.freeze([...options.domain]) as unknown as readonly [number, number])
    : options.domain;
  return descriptor(
    { kind: "bar", ...options, ...(domain && { domain }) },
    {
      name: "bar",
      text,
      check(field, kind, at) {
        if (kind !== "number")
          throw new TypeError(
            `${at}: bar cells draw numbers; ${JSON.stringify(field)} holds ${kind === "time" ? "times" : "categories"}; give a number field, or chipCell()`,
          );
        if (!Number.isFinite(base))
          throw new TypeError(`${at}.base: expected a finite number; received ${base}`);
        if (domain !== undefined) {
          if (!(Array.isArray(domain) && domain.length === 2 && domain.every(Number.isFinite)))
            throw new TypeError(
              `${at}.domain: expected two finite numbers, low first; received ${JSON.stringify(domain)}`,
            );
          if (!(domain[0] < domain[1]))
            throw new RangeError(
              `${at}.domain: ${domain[0]} is not below ${domain[1]}; give the bar's ends, low first`,
            );
        }
      },
      bind: (field, bounds, rows, at) =>
        new BarDomain(field, domain?.[0] ?? bounds.min, domain?.[1] ?? bounds.max, base, rows, at),
      css: `${G} [data-cell=bar]{isolation:isolate}
${G} .hg-bar{position:absolute;z-index:-1;top:4px;bottom:4px;left:calc(8px + var(--hg-bar-start)*(100% - 16px));width:calc((var(--hg-bar-end) - var(--hg-bar-start))*(100% - 16px));background:color-mix(in srgb,var(--hg-bar-color,var(--hg-accent)) 40%,transparent)}
${G} [data-track]::before{content:"";position:absolute;z-index:-1;top:4px;bottom:4px;left:8px;right:8px;background:var(--hg-line)}
${G} [data-track]>.hg-bar{background:var(--hg-bar-color,var(--hg-accent))}`,
      mount(element, _text) {
        const bar = element.ownerDocument.createElement("span");
        bar.className = "hg-bar";
        bar.setAttribute("aria-hidden", "true");
        element.prepend(bar);
        element.dataset.cell = "bar";
        if (track) element.dataset.track = "";
        const style = bar.style;
        // The ends drawn: null before the first write.
        let drawn: readonly [number, number] | undefined | null = null;
        let color: string | undefined;
        return {
          write(cell, paint) {
            const ends = cell?.bar;
            if (ends !== drawn) {
              bar.hidden = !ends;
              if (ends && (!drawn || ends[0] !== drawn[0] || ends[1] !== drawn[1])) {
                style.setProperty("--hg-bar-start", String(ends[0]));
                style.setProperty("--hg-bar-end", String(ends[1]));
              }
              drawn = ends;
            }
            const next = paint.color(cell?.look?.color);
            if (next !== color) {
              color = next;
              if (next === undefined) style.removeProperty("--hg-bar-color");
              else style.setProperty("--hg-bar-color", next);
            }
          },
          remove() {
            bar.remove();
            delete element.dataset.cell;
            delete element.dataset.track;
          },
        };
      },
    },
  );
}

/**
 * A bar column's domain: each end given (`low`, `high`: the cell's own
 * domain, else the field's display bounds), else found from the records'
 * extent with `base` included, when their rows change. A remote grid holds
 * no records, so it needs both ends given.
 */
class BarDomain implements CellBinding {
  readonly #field: string;
  readonly #low: number | undefined;
  readonly #high: number | undefined;
  readonly #base: number;
  readonly #rows: (() => MarkRows) | undefined;
  #seen: string | undefined;
  /** The domain's ends, and where `base` falls between them; undefined for an empty domain. */
  #ends: { low: number; span: number; wide: boolean; base: number } | undefined;
  revision = nextRevision();

  constructor(
    field: string,
    low: number | undefined,
    high: number | undefined,
    base: number,
    rows: (() => MarkRows) | undefined,
    at: string,
  ) {
    this.#field = field;
    this.#low = low;
    this.#high = high;
    this.#base = base;
    this.#rows = rows;
    if (!rows && (low === undefined || high === undefined))
      throw new TypeError(
        `${at}: a bar's ends come from every row, which a remote grid does not hold; give domain, or fields.${field} min and max`,
      );
    if (low !== undefined && high !== undefined) this.#take(low, high);
  }

  update(): void {
    if (this.#low !== undefined && this.#high !== undefined) return;
    const rows = this.#rows!();
    if (rows.revision === this.#seen) return;
    this.#seen = rows.revision;
    const extent = extentOf(rows, this.#field);
    const base = this.#base;
    // Bars grow from the base, so it is within the domain found.
    const low = this.#low ?? Math.min(base, extent ? extent[0] : base);
    const high = this.#high ?? Math.max(base, extent ? extent[1] : base);
    this.#take(low, high);
  }

  #take(low: number, high: number) {
    const before = this.#ends;
    // In halves only where the span is past the largest double, so tiny spans keep their precision.
    const wide = !Number.isFinite(high - low);
    const span = wide ? high / 2 - low / 2 : high - low;
    const ends =
      span > 0
        ? {
            low,
            span,
            wide,
            base: Math.min(
              1,
              Math.max(0, (wide ? this.#base / 2 - low / 2 : this.#base - low) / span),
            ),
          }
        : undefined;
    if (ends?.low !== before?.low || ends?.span !== before?.span || ends?.wide !== before?.wide) {
      this.#ends = ends;
      this.revision = nextRevision();
    }
  }

  bar(value: number | null): readonly [number, number] | undefined {
    const ends = this.#ends;
    if (!ends || value === null || Number.isNaN(value)) return undefined;
    const offset = ends.wide ? value / 2 - ends.low / 2 : value - ends.low;
    const at = Math.min(1, Math.max(0, offset / ends.span));
    return at < ends.base ? [at, ends.base] : [ends.base, at];
  }
}

/** The least and greatest finite values of `field` at `rows`. */
function extentOf(rows: MarkRows, field: string): readonly [number, number] | undefined {
  const { table, positions } = rows;
  if (!positions) return table.extent(field as never);
  const values = table.numbers(field as never);
  let min = Infinity;
  let max = -Infinity;
  for (let k = 0; k < positions.length; k++) {
    const value = values[positions[k]!]!;
    if (!Number.isFinite(value)) continue;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return min <= max ? [min, max] : undefined;
}

/**
 * Each value's text in a chip filled by the column's `encode.color` (the
 * theme's muted color, faint, by default; `currentColor` the grid's text
 * color), its text black or white, whichever contrasts more over the
 * cell's fill. A missing value writes its text without one.
 */
export function chipCell(): GridCell<"number" | "category"> {
  return descriptor(
    { kind: "chip" },
    {
      name: "chip",
      text: true,
      check(field, kind, at) {
        if (kind === "time")
          throw new TypeError(
            `${at}: chip cells draw numbers and categories; ${JSON.stringify(field)} holds times; give a number or category field`,
          );
      },
      css: `${G} .hg-chip{padding:2px 8px;border-radius:9px;background:var(--hg-chip,color-mix(in srgb,var(--hg-muted) 22%,transparent));color:var(--hg-chip-ink,inherit)}
${G} [data-selection=all] .hg-chip{color:var(--hg-chip-ink-selected,inherit)}
${G} .hg-chip[data-none]{padding:0;background:none;color:inherit}
@media (forced-colors:active){${G} [role=row] .hg-chip{background:none;color:inherit}}`,
      mount(element, text) {
        const chip = element.ownerDocument.createElement("span");
        chip.className = "hg-chip";
        text.replaceWith(chip);
        chip.append(text);
        const style = chip.style;
        let color: string | undefined;
        let inks: readonly [string, string] | undefined;
        return {
          write(cell, paint) {
            // A chip of nothing, for a missing value or a row without one, reads as text.
            chip.toggleAttribute("data-none", cell?.state !== "value");
            const given = cell?.look?.color;
            // currentColor is the cell's text color, not the chip's own (its ink).
            const next =
              given !== undefined && /^\s*currentcolor\s*$/i.test(given)
                ? "var(--hg-text)"
                : paint.color(given);
            // Inks follow what the chip is drawn over: the cell's fill, the theme.
            const over = paint.inks(next, cell?.look?.fill);
            if (next === color && over[0] === inks?.[0] && over[1] === inks?.[1]) return;
            color = next;
            inks = over;
            if (next === undefined) style.removeProperty("--hg-chip");
            else style.setProperty("--hg-chip", next);
            style.setProperty("--hg-chip-ink", over[0]);
            style.setProperty("--hg-chip-ink-selected", over[1]);
          },
          remove() {
            chip.replaceWith(text);
          },
        };
      },
    },
  );
}

/**
 * A symbol per value before its text: its shape by the column's
 * `encode.symbol` (a circle by default), its fill by `encode.color` (the
 * theme's accent by default). A missing value draws none.
 */
export function symbolCell(options: SymbolCellOptions = {}): GridCell<CellFieldKind> {
  const { size = 64, text = true } = options;
  // Paths by shape, of this cell's size.
  const paths = new Map<SymbolName, string>();
  const radius = Math.sqrt(size / Math.PI);
  return descriptor(
    { kind: "symbol", ...options },
    {
      name: "symbol",
      text,
      check(_field, _kind, at) {
        if (!(Number.isFinite(size) && size > 0))
          throw new TypeError(
            `${at}.size: expected an area above 0 square pixels; received ${size}`,
          );
        checkFlag(options.text, `${at}.text`);
      },
      css: `${G} .hg-symbol{vertical-align:middle;overflow:visible;fill:var(--hg-symbol-color,var(--hg-accent))}
${G} [data-cell=symbol] .hg-symbol{margin-inline-end:6px}`,
      mount(element) {
        const node = (name: string) =>
          element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", name);
        const svg = node("svg");
        svg.setAttribute("class", "hg-symbol");
        svg.setAttribute("aria-hidden", "true");
        const side = String(Math.ceil(radius * 2.5));
        svg.setAttribute("width", side);
        svg.setAttribute("height", side);
        svg.setAttribute("viewBox", `${-radius * 1.25} ${-radius * 1.25} ${side} ${side}`);
        const path = node("path");
        svg.append(path);
        element.prepend(svg);
        if (text) element.dataset.cell = "symbol";
        let shape: SymbolName | null | undefined = null;
        let color: string | undefined;
        return {
          write(cell, paint) {
            const next = cell?.state === "value" ? (cell.look?.symbol ?? "circle") : undefined;
            if (next !== shape) {
              shape = next;
              svg.style.visibility = next ? "" : "hidden";
              if (next) path.setAttribute("d", pathOf(next));
            }
            const fill = paint.color(cell?.look?.color);
            if (fill !== color) {
              color = fill;
              if (fill === undefined) svg.style.removeProperty("--hg-symbol-color");
              else svg.style.setProperty("--hg-symbol-color", fill);
            }
          },
          remove() {
            svg.remove();
            delete element.dataset.cell;
          },
        };
      },
    },
  );

  function pathOf(shape: SymbolName): string {
    let d = paths.get(shape);
    if (d === undefined) {
      d = symbolPath(shape, radius);
      paths.set(shape, d);
    }
    return d;
  }
}

/** SVG path data of a symbol of radius `r` about the origin (see draw/symbols.ts). */
function symbolPath(shape: SymbolName, r: number): string {
  const n = (value: number) => String(Math.round(value * 100) / 100);
  if (shape === "circle")
    return `M${n(-r)} 0a${n(r)} ${n(r)} 0 1 1 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 1 ${n(-2 * r)} 0`;
  const v = vertices(shape);
  let d = `M${n(v[0]! * r)} ${n(v[1]! * r)}`;
  for (let i = 2; i < v.length; i += 2) d += `L${n(v[i]! * r)} ${n(v[i + 1]! * r)}`;
  return `${d}Z`;
}
