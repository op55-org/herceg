// Item anchors (see dom/anchors.ts): where the frame on screen drew the
// item an anchor names, read from drawn records as picking reads them,
// with picking's code (model/pick.ts), which the first item anchor loads.
// Items' rows are found once per change of their table, every key's in
// one pass over its rows; after an append, over the rows appended alone.

import type { Table, TableChange } from "../data/table.ts";
import type { DrawnPart } from "../marks/drawn.ts";
import type { PartReader } from "../marks/drawn-parts.ts";
import type { ItemInfo } from "../marks/layout-mark.ts";
import type { Frame, Mark, MarkKey } from "../marks/mark.ts";
import type { ItemResolver, KeyPart } from "../model/items.ts";
import type { ChartModel } from "../model/model.ts";
import type { PickKit } from "../model/pick.ts";
import type {
  Geometry,
  LabelsGeometry,
  PointGeometry,
  Rect,
  RectGeometry,
  RuleGeometry,
  Scene,
  SegmentGeometry,
  TextGeometry,
} from "../scene/scene.ts";
import type { SymbolName } from "../spec/encoding.ts";
import type { ChartErrorCode } from "../spec/errors.ts";
import type { ItemReference } from "../spec/state.ts";
import type { AnchorHost } from "./anchors.ts";
import type { FrameDrawing } from "./value-transition.ts";

type Picking = typeof import("../model/pick.ts");
type ItemSector = NonNullable<ItemInfo["sector"]>;
type Reading = Picking & PartReader & { kit: PickKit };

/** Item anchors' lookups for one chart. */
export class AnchorItems {
  readonly #host: AnchorHost;
  readonly #error: (path: string, message: string, code: ChartErrorCode) => Error;
  /** Picking's functions, with the readers of drawn parts made with the chart's kit. */
  readonly #reading: Reading;
  /** Names items, for the marks it was made of. */
  #resolver: { marks: readonly unknown[]; resolver: ItemResolver } | undefined;
  readonly #rows = new AnchorRows();

  /** `kit`: the chart's picking kit; `pick`: picking's module, loaded; `error` makes the refusals anchors tell of. */
  constructor(
    host: AnchorHost,
    kit: PickKit,
    pick: Picking,
    error: (path: string, message: string, code: ChartErrorCode) => Error,
  ) {
    this.#host = host;
    this.#error = error;
    this.#reading = { ...pick, ...pick.partReader(kit), kit };
  }

  /** The key `item` names: its own, or a reference's; refused for a reference to no mark. */
  keyOf(item: string | ItemReference): string {
    if (typeof item === "string") return item;
    const key = this.#items().keyOfReference(item);
    if (key !== undefined) return key;
    const ids = this.#host.model.config.marks.flatMap(({ spec }) =>
      spec.id === undefined ? [] : [JSON.stringify(spec.id)],
    );
    throw this.#error(
      "at.item",
      `no mark ${JSON.stringify(item.mark)} in the chart; ${ids.length ? `marks with ids are ${ids.join(", ")}` : "give the mark an id"}`,
      "unknown-reference",
    );
  }

  /** Notes that an anchor is at the item keyed `key` in this placement, whose rows `update` finds. */
  want(key: string): void {
    const mark = this.#markOf(key);
    if (mark?.table && !this.#laidOut(key)) this.#rows.want(mark.table, key);
  }

  /** Finds the rows of the items noted since the last update. */
  update(): void {
    this.#rows.update(this.#items(), (key) => this.#markOf(key)!);
  }

  /**
   * Where the frame on screen drew the item keyed `key`, by panel: a
   * layout mark's item at its box there (a sector at its middle, as its
   * bounding box's may be off it); another mark's as `boxesOf` finds it.
   * Undefined for a key of no mark the chart has now.
   */
  boxes(
    key: string,
    scene: Scene,
    drawing: FrameDrawing | undefined,
  ): Map<string, Rect> | undefined {
    const mark = this.#markOf(key);
    if (!mark) return undefined;
    if (this.#laidOut(key)) {
      const named = (JSON.parse(key) as KeyPart[])[0];
      const boxes = new Map<string, Rect>();
      for (const { key: panel, items } of scene.panels) {
        const found =
          items && items.mark === named
            ? items.list?.().find((item) => item.key === key)
            : undefined;
        if (found) boxes.set(panel, found.sector ? middleOf(found.sector) : found.box);
      }
      return boxes;
    }
    const rows = mark.table && this.#rows.get(mark.table, key);
    if (mark.table && !rows) return undefined;
    const items = this.#items();
    return boxesOf(this.#reading, this.#host.model, mark, items, key, rows, drawing?.geometry);
  }

  /** Lets go of the tables it listens to. */
  dispose(): void {
    this.#rows.dispose();
  }

  /** The mark of the chart an item key names, or undefined. */
  #markOf(key: string): Mark | undefined {
    const named = (JSON.parse(key) as KeyPart[])[0] as MarkKey;
    const marks = this.#host.model.config.marks as readonly Mark[];
    return marks[typeof named === "number" ? named : marks.findIndex((m) => m.spec.id === named)];
  }

  /** Whether an item key names a layout mark's item (a slice, a node): of a mark drawn by a layout. */
  #laidOut(key: string): boolean {
    const named = (JSON.parse(key) as KeyPart[])[0];
    return this.#host.model.drawnMarks().some((drawn) => drawn.layout && drawn.mark === named);
  }

  /** The item resolver for the chart's marks now. */
  #items(): ItemResolver {
    const { marks } = this.#host.model.config;
    if (this.#resolver?.marks !== marks)
      this.#resolver = {
        marks,
        resolver: this.#reading.itemResolver(
          marks.map((mark, i) => ({ mark: mark as Mark, key: (mark.spec.id ?? i) as MarkKey })),
        ),
      };
    return this.#resolver.resolver;
  }
}

/**
 * Where `model`'s last frame drew the item keyed `key` of `mark`, by
 * panel: what draws it there, each piece cut to what its geometry shows
 * (its clip, and a decoration's panel box) and then joined. A line's or
 * area's observation, and a point cloud's point, is where its row is
 * placed; a custom mark's item, what its shapes paint (`Mark.itemBox`);
 * others, the primitives whose part is the item: a row of `rows` (the
 * table rows the key names) keyed `key`, or a group keyed `key` (a bin).
 * `framed` gives the geometry a frame between two scenes draws in place of
 * the scene's, whose primitives are in the scene's order: boxes are read
 * from it where it gives one.
 */
function boxesOf(
  reading: Reading,
  model: ChartModel,
  mark: Mark,
  items: ItemResolver,
  key: string,
  rows: ArrayLike<number> | undefined,
  framed: ((geometry: Geometry) => Geometry | undefined) | undefined,
): Map<string, Rect> {
  const { partOf, seriesOf, positionOf, clipBox, madeIn, rowsOfDrawn, pointBox, ascends, kit } =
    reading;
  const boxes = new Map<string, Rect>();
  const named = (JSON.parse(key) as KeyPart[])[0] as MarkKey;
  const table = mark.table;
  // The item's rows ascend, as the resolver finds them.
  const listed = (row: number) => !rows || rows[lowerBound(rows, row, rows.length)] === row;
  // Whether a drawn part is the item: a row of it, of its key, or its group.
  const is = (part: DrawnPart | undefined) =>
    part?.kind === "row"
      ? listed(part.position) &&
        items.keyOfRow(named, {
          table: part.table,
          position: part.position,
          series: part.series?.series,
        }) === key
      : part?.kind === "group" && part.key === key;
  for (const drawn of model.drawnMarks()) {
    const { frame, panel } = drawn;
    if (drawn.mark !== named || !frame || drawn.layout || !drawn.current()) continue;
    drawn.geometry.forEach((geometry, g) => {
      const clip = clipBox(geometry.clip ?? geometry.draw.defaultClip ?? "plot", frame);
      const shown = drawn.keep ? within(clip, drawn.keep) : clip;
      const at = framed?.(geometry) ?? geometry;
      const add = (box: Rect | undefined) => {
        const piece = box && shown && within(box, shown);
        const had = boxes.get(panel);
        if (piece) boxes.set(panel, had ? joined(had, piece) : piece);
      };
      const cloud = geometry.kind === "point" && (geometry as PointGeometry).cloud;
      if (mark.itemBox || cloud || geometry.kind === "line" || geometry.kind === "area") {
        // Rows at their places: each series' that holds them, as keyed.
        let trace: DrawnPart | undefined | false;
        for (const s of mark.itemBox ? drawn.series : [seriesOf(drawn, geometry)])
          for (let k = 0; s && table && rows && k < rows.length; k++) {
            const row = rows[k]!;
            // The key first: a row is searched for only in the series it is an item of.
            if (!is({ kind: "row", table, position: row, series: { series: s, position: 0 } }))
              continue;
            if (positionOf(s, row) < 0) continue;
            trace ??= !mark.itemBox && partOf(mark, drawn, g, 0);
            if (trace && trace.kind === "trace" && !trace.eligible(row)) continue;
            if (mark.itemBox) add(mark.itemBox(at, row, s));
            else {
              const box = pointBox(kit, s, row, frame, mark);
              const r = cloud ? (geometry as PointGeometry).radius : 0;
              add(box && { x: box.x - r, y: box.y - r, width: 2 * r, height: 2 * r });
            }
          }
        return;
      }
      const count = countOf(geometry);
      const ask = (i: number, own?: true) => {
        if (own || is(partOf(mark, drawn, g, i))) add(boxAt(reading, at, i, frame));
      };
      // Bars and points record the row each primitive draws: only the item's
      // are asked, found by search where those rows ascend, else in one pass.
      // A primitive drawing one of the item's rows draws the item; but a wide
      // mark's row draws an item per value field, so the geometry's series
      // (one field's) is asked once whether it draws the item's.
      const own = rows && madeIn(geometry, 0)[0] === geometry ? rowsOfDrawn(geometry) : undefined;
      const s = own && mark.wide ? seriesOf(drawn, geometry) : undefined;
      const series = s && { series: s, position: 0 };
      if (series && !is({ kind: "row", table: table!, position: rows![0] ?? -1, series })) return;
      if (!own || (mark.wide && !s)) for (let i = 0; i < count; i++) ask(i);
      else if (!ascends(own, count)) {
        for (let i = 0; i < count; i++) if (listed(own[i]!)) ask(i, true);
      } else
        for (let k = 0; k < rows!.length; k++)
          for (let i = lowerBound(own, rows![k]!, count); i < count && own[i] === rows![k]; i++)
            ask(i, true);
    });
  }
  return boxes;
}

/**
 * Each symbol's box about its centre per unit of radius (left, top, right,
 * bottom), in SYMBOLS' order (spec/symbols.ts), as draw/symbol-shapes.ts
 * draws them, to a thousandth (a unit test holds them equal): written
 * here, so that anchors load no shapes.
 */
export const GLYPHS: readonly (readonly [SymbolName, number, number, number, number])[] = [
  ["circle", -1, -1, 1, 1],
  ["square", -0.886, -0.886, 0.886, 0.886],
  ["triangle", -1.347, -1.555, 1.347, 0.778],
  ["diamond", -1.253, -1.253, 1.253, 1.253],
  ["cross", -1.189, -1.189, 1.189, 1.189],
  ["star", -1.591, -1.673, 1.591, 1.353],
  ["wye", -1.307, -1.031, 1.307, 1.233],
  ["triangle-down", -1.347, -0.778, 1.347, 1.555],
  ["x", -1.121, -1.121, 1.121, 1.121],
];

/** The first place of ascending `sorted`'s first `length` holding `value` or more. */
function lowerBound(sorted: ArrayLike<number>, value: number, length: number): number {
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** How many primitives of `geometry` have a box of their own (`boxAt`); 0 for other kinds. */
function countOf(geometry: Geometry): number {
  const { kind } = geometry;
  if (kind === "rule") return 1;
  if (kind === "labels") return (geometry as LabelsGeometry).items.length;
  return kind === "rect" || kind === "point" || kind === "segments" || kind === "text"
    ? (geometry as PointGeometry).count
    : 0;
}

/**
 * The box primitive `i` of `geometry` is drawn at, as picking reads it
 * (model/pick.ts): a rectangle, a point's glyph (its symbol at its radius,
 * its outline half its width past that), a rule's or segment's span, or
 * text as placed.
 */
function boxAt({ textBox }: Picking, geometry: Geometry, i: number, frame: Frame): Rect {
  switch (geometry.kind) {
    case "rect": {
      const { rects, edge } = geometry as RectGeometry;
      // Its outline reaches half its width past each side it draws (draw/rect.ts's
      // bits: top 1, right 2, bottom 4, left 8).
      const half = (edge?.width ?? 0) / 2;
      const sides = typeof edge?.sides === "object" ? edge.sides[i]! : (edge?.sides ?? 15);
      const past = (side: number) => (sides & side ? half : 0);
      return {
        x: rects[i * 4]! - past(8),
        y: rects[i * 4 + 1]! - past(1),
        width: rects[i * 4 + 2]! + past(8) + past(2),
        height: rects[i * 4 + 3]! + past(1) + past(4),
      };
    }
    case "point": {
      const { coords, radius, radii, symbol, symbols, ring } = geometry as PointGeometry;
      const [, left, top, right, bottom] = symbols
        ? GLYPHS[symbols[i]!]!
        : GLYPHS.find(([name]) => name === symbol)!;
      const r = radii ? radii[i]! : radius;
      const outline = (ring?.width ?? 0) / 2;
      return {
        x: coords[i * 2]! + left * r - outline,
        y: coords[i * 2 + 1]! + top * r - outline,
        width: (right - left) * r + 2 * outline,
        height: (bottom - top) * r + 2 * outline,
      };
    }
    case "rule": {
      const { x1, y1, x2, y2 } = geometry as RuleGeometry;
      return span(x1, y1, x2, y2);
    }
    case "segments": {
      const { coords } = geometry as SegmentGeometry;
      return span(coords[i * 4]!, coords[i * 4 + 1]!, coords[i * 4 + 2]!, coords[i * 4 + 3]!);
    }
    case "text": {
      const { coords, labels, anchor } = geometry as TextGeometry;
      // Text marks write in the theme's text, as drawn.
      const paint = frame.theme.style.text;
      const [x, y] = [coords[i * 2]!, coords[i * 2 + 1]!];
      return textBox(
        { text: labels[i]!, x, y, anchor, baseline: "middle", angle: 0, paint },
        frame,
        true,
      );
    }
    default:
      return textBox((geometry as LabelsGeometry).items[i]!, frame);
  }
}

/** A sector's middle, halfway along its ring and between its angles (clockwise from 12 o'clock): a box of no size. */
function middleOf({ cx, cy, innerRadius, outerRadius, startAngle, endAngle }: ItemSector): Rect {
  const angle = (startAngle + endAngle) / 2;
  const r = (innerRadius + outerRadius) / 2;
  return { x: cx + r * Math.sin(angle), y: cy - r * Math.cos(angle), width: 0, height: 0 };
}

/** The box two corners span. */
function span(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    width: Math.abs(x2 - x1),
    height: Math.abs(y2 - y1),
  };
}

/**
 * The part of `box` inside `shown`, edges included: a box of no size along
 * an axis is in it on its edge; one with a size must overlap it.
 */
function within(box: Readonly<Rect>, shown: Readonly<Rect>): Rect | undefined {
  const x0 = Math.max(box.x, shown.x);
  const y0 = Math.max(box.y, shown.y);
  const x1 = Math.min(box.x + box.width, shown.x + shown.width);
  const y1 = Math.min(box.y + box.height, shown.y + shown.height);
  return (box.width > 0 ? x0 < x1 : x0 <= x1) && (box.height > 0 ? y0 < y1 : y0 <= y1)
    ? { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    : undefined;
}

/** The box around two boxes. */
function joined(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * The table rows anchors' row items name, found once per change of their
 * tables or of their marks' views' questions: in full after most changes,
 * and after rows are appended and dropped from the front, in the rows
 * appended alone, those kept moving forward. What draws them is the
 * frame's to say.
 */
class AnchorRows {
  readonly #tables = new Map<Table, TableRows>();

  /** Notes that an anchor names `key`, of `table`'s rows, in this placement. */
  want(table: Table, key: string): void {
    let entry = this.#tables.get(table);
    if (!entry) {
      const created: TableRows = {
        stop: table.subscribe((change: TableChange) => {
          const was = created.change;
          // Rows appended and dropped from the front leave the others' order.
          created.change =
            was === "all" || change.reset || change.inserted || change.updated
              ? "all"
              : {
                  dropped: (was?.dropped ?? 0) + change.dropped,
                  appended: (was?.appended ?? 0) + change.appended,
                };
        }),
        rows: new Map(),
        change: undefined,
        resolver: undefined,
        asked: new Set(),
      };
      entry = created;
      this.#tables.set(table, entry);
    }
    entry.asked.add(key);
  }

  /**
   * Finds the rows of the keys noted since the last update, `markOf` giving
   * each key's mark; forgets keys no anchor named, and the tables of none.
   */
  update(resolver: ItemResolver, markOf: (key: string) => Mark): void {
    for (const [table, entry] of this.#tables) {
      const { asked, rows } = entry;
      if (asked.size === 0) {
        entry.stop();
        this.#tables.delete(table);
        continue;
      }
      // Another resolver names items by other marks.
      const change = entry.resolver === resolver ? entry.change : "all";
      entry.resolver = resolver;
      entry.change = undefined;
      // Keys found anew, and those whose rows were kept, from where rows were appended.
      const fresh: string[] = [];
      const kept = new Map<string, Uint32Array>();
      const from = typeof change === "object" ? Math.max(0, table.length - change.appended) : 0;
      for (const key of asked) {
        // The resolver keeps the rows the mark's view shows, which another question changes.
        const found = rows.get(key);
        const had =
          found && found.query === markOf(key).view?.queryRevision ? found.rows : undefined;
        if (had && change === undefined) continue;
        if (!had || change === "all") {
          fresh.push(key);
          continue;
        }
        const { dropped } = change!;
        const left = had.filter((row) => row >= dropped && row - dropped < from);
        for (let i = 0; i < left.length; i++) left[i] = left[i]! - dropped;
        kept.set(key, left);
      }
      const query = (key: string) => markOf(key).view?.queryRevision;
      // All keys' rows in a pass over the table, and the kept keys' in one over the rows appended.
      for (const [key, found] of rowsNamed(resolver, markOf, fresh, table, 0))
        rows.set(key, { rows: found, query: query(key) });
      const added =
        from < table.length ? rowsNamed(resolver, markOf, kept.keys(), table, from) : undefined;
      for (const [key, left] of kept) {
        const more = added?.get(key) ?? NONE;
        rows.set(key, { rows: more.length > 0 ? concat(left, more) : left, query: query(key) });
      }
      for (const key of rows.keys()) if (!asked.has(key)) rows.delete(key);
      asked.clear();
    }
  }

  /** The rows of `table` that `key` names, as last updated; undefined before. */
  get(table: Table, key: string): Uint32Array | undefined {
    return this.#tables.get(table)?.rows.get(key)?.rows;
  }

  dispose(): void {
    for (const { stop } of this.#tables.values()) stop();
    this.#tables.clear();
  }
}

/** A table's rows that anchors name, and what changed since they were found. */
interface TableRows {
  stop: () => void;
  /** By key, its rows, and the question of its mark's view they were found for. */
  rows: Map<string, { rows: Uint32Array; query: number | undefined }>;
  /** Rows dropped from the front and appended since, or anything else ("all"). */
  change: { dropped: number; appended: number } | "all" | undefined;
  /** The resolver the rows were found with. */
  resolver: ItemResolver | undefined;
  /** Keys anchors named since the last update. */
  asked: Set<string>;
}

/**
 * The rows from `from` on of `table` that each of `keys` names, of its
 * mark (`markOf`): for keys naming rows by fields' values, as the item
 * resolver reads them (model/items.ts `rowsNamed`: an item key's value, or
 * a bar's position in a series), those holding them, categories compared
 * as codes and only to names, all found in one pass over the rows for
 * each field first tested; others (an identity, an aggregate's groups) as
 * the resolver finds them.
 */
export function rowsNamed(
  resolver: ItemResolver,
  markOf: (key: string) => Mark,
  keys: Iterable<string>,
  table: Table,
  from: number,
): Map<string, Uint32Array> {
  const out = new Map<string, Uint32Array>();
  const found = new Map<string, number[]>();
  // By the column first tested, its value: the keys holding it, with the rest of their tests.
  const byColumn = new Map<ArrayLike<number>, Map<number, [string, Test[]][]>>();
  for (const key of keys) {
    const tests = testsOf(markOf(key), key, table);
    if (!tests) {
      out.set(
        key,
        resolver.rowsOf(key, table).filter((row) => row >= from),
      );
      continue;
    }
    found.set(key, []);
    const [[column, value], ...rest] = tests as [Test, ...Test[]];
    const values = byColumn.get(column) ?? new Map<number, [string, Test[]][]>();
    byColumn.set(column, values);
    values.set(value, [...(values.get(value) ?? []), [key, rest]]);
  }
  for (const [column, values] of byColumn)
    for (let row = from; row < table.length; row++)
      for (const [key, rest] of values.get(column[row]!) ?? [])
        if (rest.every(([other, value]) => other[row] === value)) found.get(key)!.push(row);
  for (const [key, rows] of found) out.set(key, Uint32Array.from(rows));
  return out;
}

/** A column of numbers or category codes, and the value rows hold there (NaN: none). */
type Test = [values: ArrayLike<number>, value: number];

/** The fields' values `key` names rows of `mark` by, as tests of `table`'s columns; undefined for other keys. */
function testsOf(mark: Mark, key: string, table: Table): Test[] | undefined {
  const parts = JSON.parse(key) as KeyPart[];
  const { identity } = mark;
  const wide = mark.wide === true;
  const field = (mark.spec as { itemKey?: string }).itemKey;
  const named = wide ? 3 : 2;
  // What each pair of a field and a value says, where the key names rows by them.
  let held: [string, KeyPart][] | undefined;
  if ((wide && !identity?.values.includes(parts[1] as string)) || mark.groupsOf?.(key))
    held = undefined;
  else if (field !== undefined)
    held = parts.length === named ? [[field, parts[named - 1]!]] : undefined;
  else if (mark.itemPosition !== undefined && parts.length === 3) {
    const split = identity?.field;
    // Its series is a value field the mark draws now, or a series field's value.
    if (split !== undefined)
      held = [
        [mark.itemPosition, parts[2]!],
        [split, parts[1]!],
      ];
    else if (identity?.values.includes(parts[1] as string)) held = [[mark.itemPosition, parts[2]!]];
  }
  return held?.map(([name, value]): Test => {
    if (!table.has(name)) return [[], Number.NaN];
    if (table.kind(name) !== "category")
      return [table.numbers(name as never), typeof value === "number" ? value : Number.NaN];
    const { codes, dictionary } = table.categories(name as never);
    const code = typeof value === "string" ? dictionary.indexOf(value) : -1;
    return [codes, code < 0 ? Number.NaN : code];
  });
}

const NONE = /* @__PURE__ */ new Uint32Array(0);

function concat(a: Uint32Array, b: Uint32Array): Uint32Array {
  const out = new Uint32Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
