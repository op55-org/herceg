// Sparklines in grid cells (docs/guide/grids.md, "Sparklines"): a line or
// an area per row, of another table's rows matching the row by key. The
// descriptor carries the options; describing its column makes a
// `Sparkline` of that grid's column, which buckets the data's rows by key
// on the first read after the data changes and reads each row's series
// through the column's window: a summary as the cell's text (what screen
// readers, copy, and `cellAt` read) and a path of at most four points per
// device-pixel column, which the cell's view draws.

import type { NumericArray } from "../data/column.ts";
import type { Fields } from "../data/expression.ts";
import type { RowView } from "../data/row-view.ts";
import {
  type NumberField,
  type NumericField,
  type PositionField,
  type Schema,
  type Table,
  writesOf,
} from "../data/table.ts";
import { traceLine, traceRun } from "../draw/line.ts";
import { SvgPath } from "../draw/markup.ts";
import { nextRevision } from "../encoding/channel-scales.ts";
import { columnDisplay } from "../fields/grid.ts";
import { numberFormatter } from "../format/format.ts";
import { type Mapping, mapValue } from "../lod/m4.ts";
import { m4Joined } from "../lod/m4-joined.ts";
import { Polyline } from "../lod/polyline.ts";
import { type CellKind, KIND, type UnboundCell } from "./cells.ts";
import { type FormatSettings, valueFormatter } from "./columns.ts";
import { type IndexedFields, SparklineIndex } from "./sparkline-index.ts";

/** What a sparkline's rows match by: a field of that name in both tables, or the grid's (`row`) and the data's (`data`). */
export type SparklineKey<D extends Schema = Schema> =
  | PositionField<D>
  | { readonly row: string; readonly data: PositionField<D> };

/**
 * `sparklineCell`'s options. Options written out of the call name their
 * key (`SparklineOptions<Log, "service">`), so a grid's column can check
 * its rows have it.
 */
export interface SparklineOptions<
  D extends Schema = Schema,
  K extends SparklineKey<D> = SparklineKey<D>,
> {
  /** The rows to draw: a table, or a view of one, holding the key, `x`, and `y`. */
  data: Table<D> | RowView<D>;
  /**
   * What rows match by, raw values compared (labels, never codes): a field
   * of that name in both tables, or the grid's field (`row`) and the data's
   * (`data`), of one kind.
   */
  key: K;
  /** A number or time field of the data, shared by the column: every row's series over the same window. */
  x: NumericField<D>;
  /** A number field of the data, per row. */
  y: NumberField<D>;
  /** "line" by default; an area fills down to the domain's low end. */
  mark?: "line" | "area" | undefined;
  /** y at the cell's bottom and top: given, else each end from the y field's display min and max, else from what the row draws. */
  domain?: readonly [number, number] | undefined;
  /** x at the cell's start and end: given (a fixed window), else the extent of every data row's x. */
  xDomain?: readonly [number, number] | undefined;
}

/** A sparkline's portable form; `data` names its table, where the table has a name. */
export interface SparklineCellSpec {
  readonly kind: "sparkline";
  readonly data?: string;
  readonly key: string | { readonly row: string; readonly data: string };
  readonly x: string;
  readonly y: string;
  readonly mark?: "line" | "area";
  readonly domain?: readonly [number, number];
  readonly xDomain?: readonly [number, number];
}

/** What a sparkline cell draws, as `cellAt` reads it (`GridCellRead.sparkline`): plain numbers. */
export interface SparklineRead {
  /** The grid row's key, raw (a label, a number, a time's milliseconds); null for a row without one. */
  readonly key: string | number | null;
  /** The observations with a value inside the window. */
  readonly count: number;
  /**
   * The least and greatest values drawn and the last, the line's values
   * where it crosses the window's ends included; undefined when nothing
   * is drawn.
   */
  readonly low: number | undefined;
  readonly high: number | undefined;
  readonly last: number | undefined;
  /** y at the cell's bottom and top; undefined when nothing is drawn. */
  readonly domain: readonly [number, number] | undefined;
  /** x at the cell's start and end, shared by the column: its window; undefined while the data has no x. */
  readonly xDomain: readonly [number, number] | undefined;
}

/**
 * A line or area per row of another table's rows matched by key (see
 * `SparklineOptions`), in a column without a field: x shared by the
 * column, y per row. The cell's text, hidden, is a summary of what it
 * draws ("120 values, 3ms to 900ms, last 45ms"), which names it for
 * screen readers and is what copy and export write.
 */
export function sparklineCell<
  D extends Schema,
  const K extends PositionField<D>,
  const R extends string,
>(options: SparklineOptions<D, { row: R; data: K }>): UnboundCell<R>;
export function sparklineCell<D extends Schema, const K extends PositionField<D>>(
  options: SparklineOptions<D, K>,
): UnboundCell<K>;
/** Options whose key is not named: grids' columns take only cells of keys they have. */
export function sparklineCell<D extends Schema>(options: SparklineOptions<D>): UnboundCell<string>;
export function sparklineCell(options: SparklineOptions): UnboundCell {
  const { data, key, x, y, mark, domain, xDomain } = options;
  // Taken as given now: what checks, draws, and serializes it is one copy.
  const ends = (value: unknown) =>
    Array.isArray(value) ? (Object.freeze([...value]) as unknown as [number, number]) : value;
  const given = {
    data,
    key: typeof key === "object" && key !== null ? Object.freeze({ ...key }) : key,
    x,
    y,
    mark,
    domain: ends(domain),
    xDomain: ends(xDomain),
  } as Given;
  const source = tableOf(given.data);
  const spec = Object.freeze({
    kind: "sparkline",
    ...(source?.name !== undefined && { data: source.name }),
    key: given.key,
    x,
    y,
    ...(mark !== undefined && { mark }),
    ...(given.domain !== undefined && { domain: given.domain }),
    ...(given.xDomain !== undefined && { xDomain: given.xDomain }),
  }) as SparklineCellSpec;
  const area = mark === "area";
  const kind: CellKind = {
    name: "sparkline",
    text: false,
    sized: true,
    check(_field, _kind, at) {
      throw new TypeError(
        `${at}: sparklineCell() draws another table's rows in a column without a field; drop field, and give id`,
      );
    },
    describe(table, column, settings, at) {
      if (column.text !== undefined)
        throw new TypeError(`${at}.text: a sparkline's text is its summary; drop text`);
      const sparkline = new Sparkline(given, table, settings, `${at}.cell`);
      return {
        text: (fields, position) => sparkline.text(fields, position),
        reads: [sparkline.rowKey],
        sparkline,
      };
    },
    css: `${G} .hg-spark{position:absolute;left:8px;top:4px;overflow:hidden}
${G} .hg-spark-line{fill:none;stroke:var(--hg-spark-color,var(--hg-accent));stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
${G} .hg-spark-area{fill:var(--hg-spark-color,var(--hg-accent));fill-opacity:0.25}
@media (forced-colors:active){${G} .hg-spark-line{stroke:CanvasText}${G} .hg-spark-area{fill:CanvasText}}`,
    mount(element) {
      const node = (name: string) =>
        element.ownerDocument.createElementNS("http://www.w3.org/2000/svg", name);
      const svg = node("svg");
      svg.setAttribute("class", "hg-spark");
      svg.setAttribute("aria-hidden", "true");
      const fill = area ? node("path") : null;
      fill?.setAttribute("class", "hg-spark-area");
      const line = node("path");
      line.setAttribute("class", "hg-spark-line");
      if (fill) svg.append(fill);
      svg.append(line);
      element.append(svg);
      element.dataset.cell = "sparkline";
      const page = element.ownerDocument.defaultView;
      // What the paths were last traced for, whether they are empty, and the size the svg was given.
      let traced: {
        series: Sparkline;
        revision: number;
        key: string | number | null;
        ratio: number;
      } | null = null;
      let blank = true;
      let size = "";
      let color: string | undefined;
      // Written only when traced again, so the cell keeps no copy of its paths.
      const draw = (d: string, area: string) => {
        line.setAttribute("d", d);
        fill?.setAttribute("d", area);
        blank = !d && !area;
      };
      return {
        write(cell, paint, column, height) {
          const read = cell?.sparkline;
          const series = column.content.sparkline;
          // The box inside the cell's padding, as the stylesheet places it.
          const width = Math.max(0, column.width - 16);
          const tall = Math.max(0, height - 9);
          const box = `${width} ${tall}`;
          if (box !== size) {
            size = box;
            svg.setAttribute("width", String(width));
            svg.setAttribute("height", String(tall));
            traced = null;
          }
          const ratio = page?.devicePixelRatio || 1;
          if (!read || !series) {
            traced = null;
            if (!blank) draw("", "");
          } else if (
            traced?.series !== series ||
            traced.revision !== series.revision ||
            traced.key !== read.key ||
            traced.ratio !== ratio
          ) {
            // The same key over the same data draws the same series, whichever row shows it.
            traced = { series, revision: series.revision, key: read.key, ratio };
            const paths = series.trace(read, width, tall, ratio);
            draw(paths.line, paths.area);
          }
          const next = paint.color(cell?.look?.color);
          if (next !== color) {
            color = next;
            if (next === undefined) svg.style.removeProperty("--hg-spark-color");
            else svg.style.setProperty("--hg-spark-color", next);
          }
        },
        remove() {
          svg.remove();
          delete element.dataset.cell;
        },
      };
    },
  };
  return Object.freeze({ spec, [KIND]: kind }) as unknown as UnboundCell;
}

const G = ".herceg-grid";

/** The options as `sparklineCell` took them. */
interface Given {
  readonly data: Table | RowView;
  readonly key: unknown;
  readonly x: string;
  readonly y: string;
  readonly mark: unknown;
  readonly domain: unknown;
  readonly xDomain: unknown;
}

/** A sparkline's data's table: its own, or its view's; undefined for anything else. */
function tableOf(data: unknown): Table | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const view = data as Partial<RowView>;
  const table = typeof view.read === "function" ? view.source : (data as Table);
  return typeof table?.numbers === "function" && typeof table.version === "number"
    ? table
    : undefined;
}

/** A cell's box: CSS pixels, and device pixels to a CSS pixel. */
interface Box {
  readonly width: number;
  readonly height: number;
  readonly ratio: number;
}

/** A key's summary and paths made before the frame drawing them, in a box. */
interface Prepared extends Box {
  readonly summary: Summary;
  readonly line: string;
  readonly area: string;
}

/** What a row's series draws in the window: its read, and where its rows and crossings are. */
interface Summary {
  readonly read: SparklineRead;
  readonly text: string;
  /** The rows inside the window, as places in the index's rows. */
  readonly from: number;
  readonly to: number;
  /** The line's values where it crosses the window's start and end; NaN where it does not. */
  readonly enter: number;
  readonly exit: number;
}

const SVG_PADDING = 1.5;
/** The most keys a change prepares: more than a grid shows at once. */
const DRAWN = 256;
/** Points traced into, reused: drawing is synchronous. */
const POINTS = /* @__PURE__ */ new Polyline();
/** Stops sparklines no one keeps from following their data. */
const followers = /* @__PURE__ */ new FinalizationRegistry<() => void>((stop) => stop());

/**
 * One grid column's sparklines: the options checked against the grid's
 * table and the data, the y field's display, and the index of the data,
 * built on the first read after the data changes. The model has it follow
 * the data while the column's content is the model's, and let go of the
 * index once it is not (`follow`).
 */
export class Sparkline {
  /** What the grid follows: the table or view whose changes redraw the column. */
  readonly data: Table | RowView;
  /** The grid's field matched. */
  readonly rowKey: string;
  readonly #table: Table;
  readonly #view: RowView | undefined;
  readonly #keyKind: "number" | "time" | "category";
  readonly #indexed: IndexedFields;
  readonly #area: boolean;
  readonly #low: number | undefined;
  readonly #high: number | undefined;
  readonly #write: (value: number) => string;
  readonly #count: (count: number) => string;
  /** The data's state the index is of (the table's writes, a transaction's each), and what moves as it changes. */
  #writes = -1;
  #viewRevision = -1;
  #revision = nextRevision();
  #index: SparklineIndex | null = null;
  /** The last row summarized, at a revision: a cell's text and read come one after the other. */
  #last: { revision: number; key: string | number | null; summary: Summary } | null = null;
  /** The keys cells last drew at revision `#drawnAt`, and the box they drew in: what a change prepares. */
  #drawn = new Set<string | number | null>();
  #drawnAt = -1;
  #box: Box = { width: 0, height: 0, ratio: 0 };
  /** Summaries and paths made for those keys at revision `#preparedAt`, until cells draw them. */
  #prepared = new Map<string | number | null, Prepared>();
  #preparedAt = -1;
  /** Whether a microtask will prepare them. */
  #preparing = false;
  /** What stops following the data; null while the sparkline does not. */
  #stop: (() => void) | null = null;

  constructor(
    given: Given,
    grid: Pick<Fields, "has" | "kind">,
    settings: FormatSettings,
    at: string,
  ) {
    const table = tableOf(given.data);
    if (!table)
      throw new TypeError(
        `${at}.data: expected a table or a row view; received ${shown(given.data)}`,
      );
    this.data = given.data;
    this.#table = table;
    this.#view = given.data === table ? undefined : (given.data as RowView);
    // Key fields of one kind in both tables, matched by raw value.
    const { key } = given;
    const pair = typeof key === "object" && key !== null;
    const row = pair ? (key as { row?: unknown }).row : key;
    const own = pair ? (key as { data?: unknown }).data : key;
    if (typeof row !== "string" || typeof own !== "string")
      throw new TypeError(
        `${at}.key: expected a field name, or { row, data } naming a field of each; received ${shown(key)}`,
      );
    const rowAt = pair ? `${at}.key.row` : `${at}.key`;
    const dataAt = pair ? `${at}.key.data` : `${at}.key`;
    if (!grid.has(row) || grid.kind(row) === "geometry")
      throw new Error(
        `${rowAt}: no field ${JSON.stringify(row)} in the grid's table; give key: { row, data } naming a field of each`,
      );
    const kind = grid.kind(row) as "number" | "time" | "category";
    const theirs = this.#field(own, dataAt);
    if (theirs === "geometry")
      throw new TypeError(`${dataAt}: ${JSON.stringify(own)} holds geometry; key by a value field`);
    if (theirs !== kind)
      throw new TypeError(
        `${at}.key: ${JSON.stringify(own)} holds ${plural(theirs)} in the data and ${plural(kind)} in the grid; give fields of one kind`,
      );
    this.rowKey = row;
    this.#keyKind = kind;
    const xKind = this.#field(given.x, `${at}.x`);
    if (xKind !== "number" && xKind !== "time")
      throw new TypeError(
        `${at}.x: ${JSON.stringify(given.x)} holds ${plural(xKind)}; sparklines place numbers and times along x`,
      );
    const yKind = this.#field(given.y, `${at}.y`);
    if (yKind !== "number")
      throw new TypeError(
        `${at}.y: ${JSON.stringify(given.y)} holds ${plural(yKind)}; sparklines draw numbers`,
      );
    if (given.mark !== undefined && given.mark !== "line" && given.mark !== "area")
      throw new TypeError(`${at}.mark: expected "line" or "area"; received ${shown(given.mark)}`);
    this.#area = given.mark === "area";
    const domain = ends(given.domain, `${at}.domain`, "the line's");
    this.#indexed = {
      key: own,
      category: kind === "category",
      x: given.x,
      y: given.y,
      xDomain: ends(given.xDomain, `${at}.xDomain`, "x's"),
    };
    // Values through the y field's display, as aggregates are written (no mappings).
    const display =
      settings.fields &&
      columnDisplay(settings.fields, { field: given.y }, "number", table, settings);
    this.#low = domain?.[0] ?? display?.min;
    this.#high = domain?.[1] ?? display?.max;
    this.#write = display ? display.amount : valueFormatter("number", settings);
    this.#count = numberFormatter({ maximumFractionDigits: 0 }, settings.locale);
  }

  /** Changes whenever the data may draw otherwise. */
  get revision(): number {
    this.#catchUp();
    return this.#revision;
  }

  /**
   * Follows the data while the column's content is a model's: as the data
   * changes, the index of what it was goes, and `changed` tells the model,
   * saying whether it is still kept (else the sparkline lets go). With
   * false, the content is no longer the model's: it stops following, and
   * lets go of the index.
   */
  follow(changed: (() => boolean) | false): void {
    if (!changed) {
      this.#release();
      return;
    }
    if (this.#stop) return;
    // Held weakly by the data, so a sparkline no one keeps stops following on its own.
    const ref = new WeakRef(this);
    const stop = (this.data as { subscribe(listener: () => void): () => void }).subscribe(() => {
      const sparkline = ref.deref();
      if (!sparkline) {
        stop();
        return;
      }
      sparkline.#catchUp(true);
      if (!changed()) sparkline.#release();
    });
    this.#stop = stop;
    followers.register(this, stop, this);
  }

  /** The text of the cell of row `position` of the grid's rows (`fields`: a table, or a remote window). */
  text(fields: Fields, position: number): string {
    return this.#summary(fields, position).text;
  }

  /** What the cell of row `position` draws, read whole. */
  read(fields: Fields, position: number): SparklineRead {
    return this.#summary(fields, position).read;
  }

  #release(): void {
    this.#stop?.();
    this.#stop = null;
    followers.unregister(this);
    this.#index = null;
    this.#last = null;
    this.#drawn.clear();
    this.#prepared.clear();
  }

  /**
   * The paths of a cell's series (`read`, as the model read it) in a box
   * `width` by `height` CSS pixels, reduced per device pixel at `ratio`:
   * the line, and the area's fill (empty for a line).
   */
  trace(
    read: SparklineRead,
    width: number,
    height: number,
    ratio: number,
  ): { line: string; area: string } {
    const index = this.#current();
    const revision = this.#revision;
    const { key } = read;
    const drawn = this.#drawn;
    if (this.#drawnAt !== revision) {
      drawn.clear();
      this.#drawnAt = revision;
    }
    // The latest last, so rows scrolled past at one revision are not all prepared.
    drawn.delete(key);
    drawn.add(key);
    if (drawn.size > DRAWN) drawn.delete(drawn.values().next().value!);
    const box = this.#box;
    if (box.width !== width || box.height !== height || box.ratio !== ratio)
      this.#box = { width, height, ratio };
    const prepared = this.#preparedAt === revision ? this.#prepared.get(key) : undefined;
    if (
      prepared &&
      prepared.width === width &&
      prepared.height === height &&
      prepared.ratio === ratio
    ) {
      this.#prepared.delete(key);
      return { line: prepared.line, area: prepared.area };
    }
    return this.#paths(index, this.#of(index, key), this.#box);
  }

  /** The paths of `summary`'s series in `index`, in `box`. */
  #paths(
    index: SparklineIndex,
    summary: Summary,
    { width, height, ratio }: Box,
  ): { line: string; area: string } {
    const { xDomain } = index;
    const domain = summary.read.domain;
    if (!xDomain || !domain || !(width > 0 && height > 0)) return { line: "", area: "" };
    const [x0, x1] = xDomain;
    // A window, or domain, of no extent or one numbers cannot span (its
    // factor overflowing) draws at the middle: from 0, so no value overflows.
    const xFactor = width / (x1 - x0);
    const xMap: Mapping =
      xFactor > 0 && xFactor < Infinity
        ? { origin: x0, offset: 0, factor: xFactor, log: false }
        : { origin: 0, offset: width / 2, factor: 0, log: false };
    const [low, high] = domain;
    const bottom = height - SVG_PADDING;
    const yFactor = (height - 2 * SVG_PADDING) / (high - low);
    const level = !(yFactor > 0 && yFactor < Infinity);
    const yMap: Mapping = level
      ? { origin: 0, offset: height / 2, factor: 0, log: false }
      : { origin: low, offset: bottom, factor: -yFactor, log: false };
    const points = POINTS;
    points.reset();
    const { enter, exit, from, to } = summary;
    if (!Number.isNaN(enter)) points.push(0, mapValue(yMap, enter));
    m4Joined(index.x, index.y, index.rows, from, to, xMap, yMap, ratio, points);
    if (!Number.isNaN(exit)) points.push(width, mapValue(yMap, exit));
    // Values far past a given domain stay far outside the box, as numbers path data takes.
    const c = points.coords;
    for (let i = 1; i < points.count * 2; i += 2) c[i] = Math.min(1e6, Math.max(-1e6, c[i]!));
    const line = new SvgPath();
    traceLine(line, points);
    let fill = "";
    if (this.#area) {
      // Each run down to the domain's low end, apart, so gaps stay open.
      const area = new SvgPath();
      const base = level ? height / 2 : bottom;
      for (let run = 0; run < points.starts.length; run++) {
        const start = points.starts[run]!;
        const end = points.runEnd(run);
        if (end - start < 2) continue;
        area.moveTo(c[start * 2]!, c[start * 2 + 1]!);
        traceRun(area, points, start, end, true);
        area.lineTo(c[(end - 1) * 2]!, base);
        area.lineTo(c[start * 2]!, base);
        area.closePath();
      }
      fill = area.d;
    }
    return { line: line.d, area: fill };
  }

  /** The kind of field `name` of the data, or an error naming the data's fields at `at`. */
  #field(name: unknown, at: string): string {
    const table = this.#table;
    if (typeof name !== "string" || !table.has(name))
      throw new Error(
        `${at}: no field ${shown(name)} in the data; the data has ${table
          .fields()
          .map((one) => JSON.stringify(one))
          .join(", ")}`,
      );
    return table.kind(name);
  }

  /**
   * Moves the revision once the data changed, and brings the index up to
   * date: rows only appended are taken in at once (the data's listener
   * runs this, so frames find it whole), other changes build it again when
   * next read. Told by the data (`told`), when cells drew since the last
   * change, it prepares what they draw next, before the next frame.
   */
  #catchUp(told = false) {
    const writes = writesOf(this.#table);
    const viewRevision = this.#view ? this.#view.revision : 0;
    if (writes === this.#writes && viewRevision === this.#viewRevision) return;
    this.#writes = writes;
    this.#viewRevision = viewRevision;
    const drew = this.#drawnAt === this.#revision;
    this.#revision = nextRevision();
    this.#last = null;
    this.#prepared.clear();
    const index = this.#index;
    if (index && !this.#view && index.grown) index.extend();
    else this.#index = null;
    if (!told || !drew || this.#preparing) return;
    // Once the task that changed the data has run (its later changes in
    // it taken in too), so that the frame drawing them only writes them.
    this.#preparing = true;
    queueMicrotask(() => this.#prepare());
  }

  /** Makes the summaries and paths of the keys drawn last as the data is now, unless the sparkline let go. */
  #prepare() {
    this.#preparing = false;
    if (!this.#stop) return;
    const index = this.#current();
    const revision = this.#revision;
    const box = this.#box;
    for (const key of this.#drawn) {
      const summary = this.#summarize(index, key);
      this.#prepared.set(key, { summary, ...this.#paths(index, summary, box), ...box });
    }
    this.#preparedAt = revision;
  }

  #current(): SparklineIndex {
    this.#catchUp();
    if (this.#index) return this.#index;
    const snapshot = this.#view?.read();
    this.#index = new SparklineIndex(
      this.#table,
      this.#indexed,
      snapshot?.indices,
      snapshot ? snapshot.length : this.#table.length,
    );
    return this.#index;
  }

  #summary(fields: Fields, position: number): Summary {
    const index = this.#current();
    return this.#of(index, keyOf(fields, this.rowKey, this.#keyKind, position));
  }

  /** The summary of `key`'s series in `index`, kept for the next read of the same key. */
  #of(index: SparklineIndex, key: string | number | null): Summary {
    const last = this.#last;
    const revision = this.#revision;
    if (last?.revision === revision && last.key === key) return last.summary;
    const prepared = this.#preparedAt === revision ? this.#prepared.get(key) : undefined;
    const summary = prepared?.summary ?? this.#summarize(index, key);
    this.#last = { revision, key, summary };
    return summary;
  }

  /**
   * What `key`'s series draws in the window: the rows inside it (x within
   * its ends, both included) and the line where it crosses an end, between
   * the rows either side of that end when both have a value; and its
   * summary, of those.
   */
  #summarize(index: SparklineIndex, key: string | number | null): Summary {
    const { xDomain, rows, x, y } = index;
    const bucket = key === null ? undefined : index.keys.get(key);
    const nothing = (text: string): Summary => ({
      read: Object.freeze({
        key,
        count: 0,
        low: undefined,
        high: undefined,
        last: undefined,
        domain: undefined,
        xDomain,
      }),
      text,
      from: 0,
      to: 0,
      enter: Number.NaN,
      exit: Number.NaN,
    });
    if (bucket === undefined || !xDomain || index.values[bucket] === 0) return nothing("No values");
    const start = index.starts[bucket]!;
    const end = start + index.counts[bucket]!;
    const [x0, x1] = xDomain;
    const from = firstAtOrPast(x, rows, start, end, x0);
    const to = firstPast(x, rows, from, end, x1);
    // Where the line between two neighboring rows crosses `at`, or NaN.
    const cross = (before: number, after: number, at: number) => {
      if (before < start || after >= end) return Number.NaN;
      const a = rows[before]!;
      const b = rows[after]!;
      const ya = y[a]!;
      const yb = y[b]!;
      const xa = x[a]!;
      const xb = x[b]!;
      if (!(Number.isFinite(ya) && Number.isFinite(yb)) || xb === at) return Number.NaN;
      // In halves where the span overflows.
      const span = xb - xa;
      const t = span < Infinity ? (at - xa) / span : (at / 2 - xa / 2) / (xb / 2 - xa / 2);
      if (!(t >= 0 && t <= 1)) return Number.NaN;
      // From the difference, so the line keeps its direction (weighted
      // where the difference overflows), and between the two values, so
      // rounding never widens an automatic domain.
      const rise = yb - ya;
      const value = Math.abs(rise) < Infinity ? ya + rise * t : ya * (1 - t) + yb * t;
      return ya < yb ? Math.min(Math.max(value, ya), yb) : Math.min(Math.max(value, yb), ya);
    };
    // A row exactly at an end is the line's there.
    const enter = from < to && x[rows[from]!]! === x0 ? Number.NaN : cross(from - 1, from, x0);
    const exit = from < to && x[rows[to - 1]!]! === x1 ? Number.NaN : cross(to - 1, to, x1);
    let count = 0;
    let low = Number.POSITIVE_INFINITY;
    let high = Number.NEGATIVE_INFINITY;
    let last = Number.NaN;
    for (let k = from; k < to; k++) {
      const value = y[rows[k]!]!;
      if (!Number.isFinite(value)) continue;
      count++;
      if (value < low) low = value;
      if (value > high) high = value;
      last = value;
    }
    for (const value of [enter, exit]) {
      if (Number.isNaN(value)) continue;
      if (value < low) low = value;
      if (value > high) high = value;
    }
    if (!Number.isNaN(exit)) last = exit;
    if (!(low <= high)) return nothing("No values in this range");
    // Each end given, else the display's, else what is drawn; a domain of no height draws level.
    const bottom = this.#low ?? low;
    const domain = Object.freeze([bottom, Math.max(bottom, this.#high ?? high)] as const);
    const write = this.#write;
    const values = `${this.#count(count)} ${count === 1 ? "value" : "values"}`;
    const text =
      count === 0
        ? `No values in this range; interpolated line from ${write(enter)} to ${write(exit)}`
        : low === high
          ? `${values}, ${count === 1 ? "" : "all "}${write(low)}`
          : `${values}, ${write(low)} to ${write(high)}, last ${write(last)}`;
    return {
      read: Object.freeze({ key, count, low, high, last, domain, xDomain }),
      text,
      from,
      to,
      enter,
      exit,
    };
  }
}

/** The key of row `position` of the grid's rows, raw; null for a missing one. */
function keyOf(
  fields: Fields,
  field: string,
  kind: "number" | "time" | "category",
  position: number,
): string | number | null {
  if (kind === "category") {
    const { codes, dictionary } = fields.categories(field);
    const code = codes[position]!;
    return code < 0 ? null : dictionary[code]!;
  }
  const value = fields.numbers(field)[position]!;
  return Number.isFinite(value) ? value : null;
}

/** The first of the places [start, end) of `rows`, ascending in x, whose x is at least `value`. */
function firstAtOrPast(
  x: NumericArray,
  rows: Uint32Array,
  start: number,
  end: number,
  value: number,
): number {
  let lo = start;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x[rows[mid]!]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The first of the places [start, end) of `rows`, ascending in x, whose x is past `value`. */
function firstPast(
  x: NumericArray,
  rows: Uint32Array,
  start: number,
  end: number,
  value: number,
): number {
  let lo = start;
  let hi = end;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (x[rows[mid]!]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Two finite numbers, low first, at `at` (`what`: whose ends, in messages); undefined when not given. */
function ends(value: unknown, at: string, what: string): readonly [number, number] | undefined {
  if (value === undefined) return undefined;
  if (!(Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)))
    throw new TypeError(`${at}: expected two finite numbers, low first; received ${shown(value)}`);
  if (!(value[0] < value[1]))
    throw new RangeError(
      `${at}: ${value[0]} is not below ${value[1]}; give ${what} ends, low first`,
    );
  return value as unknown as readonly [number, number];
}

function plural(kind: string): string {
  return kind === "category"
    ? "categories"
    : kind === "time"
      ? "times"
      : kind === "number"
        ? "numbers"
        : kind;
}

function shown(value: unknown): string {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.prototype.toString.call(value)
    : (JSON.stringify(value) ?? String(value));
}
