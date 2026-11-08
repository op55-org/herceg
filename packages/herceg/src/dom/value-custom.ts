// Custom marks moving to changed values (value-transition.ts). Their shapes
// are what their `draw` makes, which frames cannot interpolate; what moves
// is their data. The chart keeps the fields each custom mark declares (its
// x and y fields and those its `encode` reads) as its scenes drew them, by
// source row, one copy per source table; a change matches the mark's items
// by `itemKey`, else by row identity, and each frame calls the mark's own
// `draw` again over a table of the values between, on the frame's scales.
// Items that come, go, change series or category, share a key, or miss a
// value at either end show their new values at once. Charts load this
// module only when they have custom marks and animate values; until it
// loads, their changes show at once. Value transitions call it to keep
// what scenes drew (`keepCustom`), to plan a change (`ShownCustom.plan`),
// to draw frames (`CustomFrames.at`), and to move on from a frame
// (`CustomMotion.shown`).

import type { CategoryField, NumericField, ReadonlyTable, Table } from "../data/table.ts";
import type { DrawnPanel } from "../model/model.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { CustomRedraw, Geometry, Scene, ShapesGeometry } from "../scene/scene.ts";
import type { Sides } from "./value-transition.ts";

/** A category column as drawn: each row's code (-1 for none), and the names codes stand for. */
interface Names {
  codes: ArrayLike<number>;
  dictionary: readonly string[];
}

/** Columns of a table as drawn, by source row. */
interface Columns {
  /** The table copied, at its version: a copy kept is reused while the table keeps it. */
  table: Table;
  version: number;
  generation: number;
  /** The table's `rowOffset` then: a row's identity is it plus the row. */
  offset: number;
  length: number;
  numbers: Map<string, ArrayLike<number>>;
  names: Map<string, Names>;
}

/** The rows a mark drew in each panel, by panel key: 1 per row drawn; undefined for every row. */
type Drawn = Map<string, Uint8Array | undefined>;

/** What a mark's values move by: its fields that move, its items' key, and the fields that class them. */
interface Declared {
  /** Number and time fields: x, y, and those `encode` reads, the key's left out. */
  moving: string[];
  /** Category fields whose change shows an item at once: the series field, and those x, y, and `encode` read. */
  classes: string[];
  key: string | undefined;
}

/** What a chart's custom marks showed: where a change of their values moves from. */
export class ShownCustom {
  /** Each mark's columns: of its table as kept (one copy per table), or a frame's of its own. */
  readonly columns: ReadonlyMap<object, Columns>;
  /** The rows each mark drew in each panel. */
  readonly drawn: ReadonlyMap<object, Drawn>;

  constructor(columns: ReadonlyMap<object, Columns>, drawn: ReadonlyMap<object, Drawn>) {
    this.columns = columns;
    this.drawn = drawn;
  }

  /** Bytes its copies hold, each once. */
  get bytes(): number {
    let bytes = 0;
    for (const { numbers, names } of new Set(this.columns.values()))
      for (const values of [...numbers.values(), ...[...names.values()].map((n) => n.codes)])
        bytes += (values as Float64Array | Int32Array).byteLength;
    return bytes;
  }

  /**
   * How the custom marks of `scene`, whose panels `panels` placed (`sides`
   * saying which y scale places each geometry), move from what was shown:
   * their tables' rows matched by key (else identity) and checked. Marks
   * without a table, or with nothing kept, draw their new values on the
   * frames' scales, as do marks whose tables now hold over `limit` rows.
   * Their tables move once for all their panels.
   */
  plan(scene: Scene, panels: readonly DrawnPanel[], sides: Sides, limit: number): CustomMotion {
    const tables = new Map<object, MovingTable>();
    const frames = new Map<Geometry, CustomFrames>();
    for (const [mark, geometries] of redrawsOf(scene)) {
      const table = this.#move(geometries, panels, sides, limit);
      if (table) tables.set(mark, table);
      for (const { geometry } of geometries)
        frames.set(geometry, new CustomFrames(geometry, table));
    }
    return new CustomMotion(frames, tables);
  }

  /** How a mark's table moves, drawn as `geometries`; undefined for none. */
  #move(
    geometries: readonly Redrawn[],
    panels: readonly DrawnPanel[],
    sides: Sides,
    limit: number,
  ): MovingTable | undefined {
    const { redraw } = geometries[0]!;
    const { table } = redraw;
    const from = this.columns.get(redraw.mark);
    const was = this.drawn.get(redraw.mark);
    if (!table || !from || !was || table.length > limit) return undefined;
    const { moving: fields, classes, key: itemKey } = declared(redraw)!;
    const drawn: Drawn = new Map(geometries.map((each) => [each.panel, rowsDrawn(each.redraw)]));
    // An axis is logarithmic for the mark where it is in every panel it is drawn in.
    const log = (side: "x" | "y") =>
      geometries.every(({ geometry, panel: key }) => {
        const panel = panels.find((p) => p.key === key);
        return panel?.[side === "x" ? "x" : (sides(geometry.key) ?? "y")]?.type === "log";
      });
    const axes = { x: log("x"), y: log("y") };
    // Fields move evenly in log space only where every axis they are on is
    // logarithmic (channels reading them follow).
    const logs = new Set(
      fields.filter((field) => {
        const [x, y] = [redraw.x.includes(field), redraw.y.includes(field)];
        return (x || y) && (!x || axes.x) && (!y || axes.y);
      }),
    );
    // The new keys and classes: what rows match and are checked by, and
    // what a change arriving later moves on from.
    const names = new Set(classes);
    if (itemKey !== undefined && table.kind(itemKey as never) === "category") names.add(itemKey);
    const to = copyOf(table, itemKey !== undefined && !names.has(itemKey) ? [itemKey] : [], names);
    const source = match(from, was, to, drawn, itemKey);
    check(source, from, was, to, table, drawn, fields, classes, logs);
    return new MovingTable(table, fields, logs, source, from, to, drawn);
  }
}

/** How a scene's custom marks move: each geometry's frames, and their tables between. */
export class CustomMotion {
  readonly #frames: ReadonlyMap<Geometry, CustomFrames>;
  readonly #tables: ReadonlyMap<object, MovingTable>;

  constructor(
    frames: ReadonlyMap<Geometry, CustomFrames>,
    tables: ReadonlyMap<object, MovingTable>,
  ) {
    this.#frames = frames;
    this.#tables = tables;
  }

  /** The frames of a custom mark's geometry in the scene. */
  framesOf(geometry: Geometry): CustomFrames | undefined {
    return this.#frames.get(geometry);
  }

  /** What the frame drawn last shows, which a change arriving then moves on from. */
  shown(): ShownCustom {
    const columns = new Map<object, Columns>();
    const drawn = new Map<object, Drawn>();
    for (const [mark, table] of this.#tables) {
      columns.set(mark, table.shown());
      drawn.set(mark, table.drawn);
    }
    return new ShownCustom(columns, drawn);
  }
}

/** A custom mark's geometry in a panel, which each frame draws again. */
export class CustomFrames {
  readonly #geometry: ShapesGeometry;
  /** Its table's values between; undefined when it has none, or none kept: it draws its new values. */
  readonly #table: MovingTable | undefined;

  constructor(geometry: ShapesGeometry, table: MovingTable | undefined) {
    this.#geometry = geometry;
    this.#table = table;
  }

  /** Whether its values move. */
  get moves(): boolean {
    return this.#table?.moves ?? false;
  }

  /**
   * The geometry at eased progress `t`, on the frame's scales (`x` and
   * `y`; undefined for the scene's): its `draw` again, over the values
   * between where its rows move.
   */
  at(t: number, x: PositionScale | undefined, y: PositionScale | undefined): ShapesGeometry {
    const geometry = this.#geometry;
    const drawn = geometry.redraw!.draw(this.#table?.at(t), x, y) ?? { ...geometry, shapes: [] };
    // Painted as the scene's, and counted as it is by a change arriving now.
    const { clip, zIndex, redraw } = geometry;
    return Object.assign(drawn, { clip, zIndex, redraw });
  }
}

/** A custom mark's geometry in a panel of a scene, and the panel's key. */
interface Redrawn {
  geometry: ShapesGeometry;
  redraw: CustomRedraw;
  panel: string;
}

/** The custom marks' geometry in a scene's panels, by mark. */
function redrawsOf(scene: Scene): Map<object, Redrawn[]> {
  const byMark = new Map<object, Redrawn[]>();
  for (const { key, marks } of scene.panels)
    for (const geometry of marks) {
      const redraw = (geometry as ShapesGeometry).redraw;
      if (geometry.kind !== "shapes" || !redraw) continue;
      const drawn = { geometry: geometry as ShapesGeometry, redraw, panel: key };
      byMark.set(redraw.mark, [...(byMark.get(redraw.mark) ?? []), drawn]);
    }
  return byMark;
}

/**
 * What `scene`'s custom marks drew of their tables, to keep until their
 * values change: `previous`'s copies where tables have not changed since,
 * else copies made now. Nothing of a table over `limit` rows, or that
 * changed since the scene drew it; undefined for a scene without custom
 * marks.
 */
export function keepCustom(
  scene: Scene,
  previous: ShownCustom | undefined,
  limit: number,
): ShownCustom | undefined {
  const fields = new Map<Table, { numbers: Set<string>; names: Set<string> }>();
  const marks = new Map<object, Table>();
  const drawn = new Map<object, Drawn>();
  const redraws = redrawsOf(scene);
  if (redraws.size === 0) return undefined;
  for (const [mark, geometries] of redraws) {
    const { table, version } = geometries[0]!.redraw;
    if (!table || table.version !== version || table.length > limit) continue;
    const { moving, classes, key } = declared(geometries[0]!.redraw)!;
    const need = fields.get(table) ?? { numbers: new Set(), names: new Set() };
    fields.set(table, need);
    for (const field of moving) need.numbers.add(field);
    for (const field of classes) need.names.add(field);
    if (key !== undefined) need[table.kind(key) === "category" ? "names" : "numbers"].add(key);
    marks.set(mark, table);
    drawn.set(mark, new Map(geometries.map(({ redraw, panel }) => [panel, rowsDrawn(redraw)])));
  }
  // One copy per table, the previous one while it holds what is needed
  // and the table's rows where they were (a transaction's writes leave the
  // version as it was until it ends).
  const copies = new Map<Table, Columns>();
  const kept = [...new Set(previous?.columns.values())];
  for (const [table, need] of fields) {
    const known = kept.find(
      (c) =>
        c.table === table &&
        c.version === table.version &&
        table.modifiedVersion <= c.version &&
        c.generation === table.generation &&
        c.offset === table.rowOffset &&
        c.length === table.length &&
        [...need.numbers].every((f) => c.numbers.has(f)) &&
        [...need.names].every((f) => c.names.has(f)),
    );
    copies.set(table, known ?? copyOf(table, need.numbers, need.names));
  }
  return new ShownCustom(
    new Map([...marks].map(([mark, table]) => [mark, copies.get(table)!])),
    drawn,
  );
}

function copyOf(table: Table, numbers: Iterable<string>, names: Iterable<string>): Columns {
  return {
    table,
    version: table.version,
    generation: table.generation,
    offset: table.rowOffset,
    length: table.length,
    numbers: new Map(
      [...numbers].map((f) => [f, Float64Array.from(table.numbers(f as NumericField<never>))]),
    ),
    names: new Map(
      [...names].map((f) => {
        const { codes, dictionary } = table.categories(f as CategoryField<never>);
        return [f, { codes: codes.slice(), dictionary: dictionary.slice() }];
      }),
    ),
  };
}

/** The rows a geometry drew, 1 each by row (none without series); undefined when a series holds every row. */
function rowsDrawn({ series, table }: CustomRedraw): Uint8Array | undefined {
  if (!table || series.some(({ rows }) => !rows)) return undefined;
  const drawn = new Uint8Array(table.length);
  for (const { rows, length } of series) for (let k = 0; k < length; k++) drawn[rows![k]!] = 1;
  return drawn;
}

/** Fields a channel spec reads: its `field`s, and its expressions' `["field", name]`. */
function fieldsIn(spec: unknown): string[] {
  if (Array.isArray(spec))
    return spec[0] === "field" && typeof spec[1] === "string" ? [spec[1]] : spec.flatMap(fieldsIn);
  if (!spec || typeof spec !== "object") return [];
  return Object.entries(spec).flatMap(([name, value]) =>
    name === "field" && typeof value === "string" ? [value] : fieldsIn(value),
  );
}

function declared({ table, spec, x, y }: CustomRedraw): Declared | undefined {
  if (!table) return undefined;
  const key = spec.itemKey;
  const read = [...new Set([...x, ...y, ...fieldsIn(spec.encode)])].filter(
    (field) => table.has(field) && field !== key,
  );
  const kind = (field: string) => table.kind(field as never);
  return {
    moving: read.filter((field) => kind(field) === "number" || kind(field) === "time"),
    classes: [...new Set([spec.series, ...read])].filter(
      (field): field is string =>
        field !== undefined && field !== key && table.has(field) && kind(field) === "category",
    ),
    key,
  };
}

/** The name a category column gives `row`; undefined for none. */
function nameAt({ codes, dictionary }: Names, row: number): string | undefined {
  return codes[row]! < 0 ? undefined : dictionary[codes[row]!];
}

/** A row's key in `columns`: its name, or its number if finite; undefined for none. */
function keyAt(columns: Columns, key: string, row: number): string | number | undefined {
  const names = columns.names.get(key);
  if (names) return nameAt(names, row);
  const value = columns.numbers.get(key)![row]!;
  return Number.isFinite(value) ? value : undefined;
}

/** For each row of `to`, its row in `from` with the same key (else identity), drawn at both ends; -1 for none. */
function match(
  from: Columns,
  was: Drawn,
  to: Columns,
  drawn: Drawn,
  key: string | undefined,
): Int32Array {
  const source = new Int32Array(to.length).fill(-1);
  const before = union(was, from.length);
  const after = union(drawn, to.length);
  if (key === undefined) {
    // Rows keep their identity while the table keeps its generation.
    if (from.generation !== to.generation) return source;
    const shift = to.offset - from.offset;
    for (let row = 0; row < to.length; row++) {
      const old = row + shift;
      if (after(row) && old >= 0 && old < from.length && before(old)) source[row] = old;
    }
    return source;
  }
  // A key shared by rows at either end matches nothing.
  const shared = new Set<string | number>();
  const rowsOf = (columns: Columns, drawn: (row: number) => boolean) => {
    const rows = new Map<string | number, number>();
    for (let row = 0; row < columns.length; row++) {
      const name = drawn(row) ? keyAt(columns, key, row) : undefined;
      if (name === undefined) continue;
      if (rows.has(name)) shared.add(name);
      else rows.set(name, row);
    }
    return rows;
  };
  const old = rowsOf(from, before);
  for (const [name, row] of rowsOf(to, after))
    if (!shared.has(name) && old.has(name)) source[row] = old.get(name)!;
  return source;
}

/** Whether a row is drawn in any panel of `drawn`. */
function union(drawn: Drawn, length: number): (row: number) => boolean {
  const rows = [...drawn.values()];
  if (rows.some((each) => !each)) return (row) => row < length;
  return (row) => rows.some((each) => each![row] === 1);
}

/**
 * Leaves out of `source` the rows that show their new values at once: drawn
 * in a panel that did not draw them before, of another series or category,
 * or missing a value (or, moving in log space, a positive one) at either end.
 */
function check(
  source: Int32Array,
  from: Columns,
  was: Drawn,
  to: Columns,
  table: Table,
  drawn: Drawn,
  fields: readonly string[],
  classes: readonly string[],
  logs: ReadonlySet<string>,
): void {
  for (const [panel, rows] of drawn) {
    const before = was.get(panel);
    if (!was.has(panel)) {
      for (let row = 0; row < source.length; row++) if (!rows || rows[row]) source[row] = -1;
    } else if (before)
      for (let row = 0; row < source.length; row++)
        if ((!rows || rows[row]) && source[row]! >= 0 && !before[source[row]!]) source[row] = -1;
  }
  for (const field of classes) {
    const [old, now] = [from.names.get(field)!, to.names.get(field)!];
    for (let row = 0; row < source.length; row++)
      if (source[row]! >= 0 && nameAt(old, source[row]!) !== nameAt(now, row)) source[row] = -1;
  }
  for (const field of fields) {
    const old = from.numbers.get(field)!;
    const now = table.numbers(field as never);
    const usable = logs.has(field)
      ? (value: number) => value > 0 && value < Infinity
      : Number.isFinite;
    for (let row = 0; row < source.length; row++)
      if (source[row]! >= 0 && !(usable(old[source[row]!]!) && usable(now[row]!))) source[row] = -1;
  }
}

/**
 * A custom mark's table moving, read through the values of a frame between
 * two scenes: the moving fields' values there, the rest the table's own.
 * `draw` and the mark's channels read it; `at` rewrites it for each frame.
 */
export class MovingTable implements ReadonlyTable {
  /** Whether any row's values change. */
  readonly moves: boolean;
  /** The rows the mark draws in each panel of the new scene. */
  readonly drawn: Drawn;
  readonly #table: Table;
  /** Per moving field, its values in the frame written last. */
  readonly #values: Map<string, Float64Array>;
  /** Moving fields that move evenly in log space (along log axes only). */
  readonly #log: ReadonlySet<string>;
  /** Each row's row in `from`; -1 where its new values show at once. */
  readonly #source: Int32Array;
  readonly #from: Columns;
  /** The new keys and classes. */
  readonly #to: Columns;
  /** The progress the values hold. */
  #at = Number.NaN;
  /** Extents and order of the frame's values, as asked for since they were last written. */
  readonly #extents = new Map<string, readonly [number, number] | undefined>();
  readonly #sorted = new Map<string, boolean>();

  constructor(
    table: Table,
    fields: readonly string[],
    log: ReadonlySet<string>,
    source: Int32Array,
    from: Columns,
    to: Columns,
    drawn: Drawn,
  ) {
    this.#table = table;
    this.#values = new Map(fields.map((field) => [field, new Float64Array(table.length)]));
    this.#log = log;
    this.#source = source;
    this.#from = from;
    this.#to = to;
    this.drawn = drawn;
    let moves = false;
    for (const field of fields) {
      const [before, after] = [from.numbers.get(field)!, table.numbers(field as never)];
      for (let row = 0; row < source.length && !moves; row++)
        moves = source[row]! >= 0 && before[source[row]!] !== after[row];
    }
    this.moves = moves;
  }

  /** The table at eased progress `t`: its values written once per frame. */
  at(t: number): this {
    if (this.#at === t) return this;
    this.#at = t;
    const source = this.#source;
    for (const [field, out] of this.#values) {
      const [before, after] = [this.#from.numbers.get(field)!, this.#table.numbers(field as never)];
      const logs = this.#log.has(field);
      for (let row = 0; row < source.length; row++) {
        const old = source[row]!;
        const value = after[row]!;
        // Values that do not change stay exact; others are weighted, so
        // values between the largest finite ones do not overflow.
        if (old < 0 || before[old] === value) out[row] = value;
        else if (!logs) out[row] = before[old]! * (1 - t) + value * t;
        else {
          const a = Math.log10(before[old]!);
          out[row] = 10 ** (a + (Math.log10(value) - a) * t);
        }
      }
    }
    this.#extents.clear();
    this.#sorted.clear();
    return this;
  }

  /** What the frame written last shows, which a change arriving now moves on from. */
  shown(): Columns {
    // Its buffers are no longer written: the change they played has ended.
    const numbers = new Map<string, ArrayLike<number>>([...this.#to.numbers, ...this.#values]);
    return { ...this.#to, version: Number.NaN, numbers };
  }

  get length(): number {
    return this.#table.length;
  }

  get generation(): number {
    return this.#table.generation;
  }

  fields(): string[] {
    return this.#table.fields();
  }

  has(field: string): field is string {
    return this.#table.has(field);
  }

  kind(field: string) {
    return this.#table.kind(field);
  }

  identity(position: number): number {
    return this.#table.identity(position);
  }

  positionOf(identity: number, generation: number): number {
    return this.#table.positionOf(identity, generation);
  }

  numbers(field: string): ArrayLike<number> {
    return this.#values.get(field) ?? this.#table.numbers(field);
  }

  categories(field: string) {
    return this.#table.categories(field);
  }

  geometries(field: string) {
    return this.#table.geometries(field);
  }

  value(field: string, row: number) {
    // The table's own reading checks the row.
    const value = this.#table.value(field, row);
    const values = this.#values.get(field);
    if (!values) return value;
    return Number.isNaN(values[row]!) ? null : values[row]!;
  }

  extent(field: string): readonly [number, number] | undefined {
    const values = this.#values.get(field);
    if (!values) return this.#table.extent(field);
    if (!this.#extents.has(field)) {
      let [min, max] = [Infinity, -Infinity];
      for (const value of values) {
        if (value < min && value > -Infinity) min = value;
        if (value > max && value < Infinity) max = value;
      }
      this.#extents.set(field, min <= max ? [min, max] : undefined);
    }
    return this.#extents.get(field);
  }

  isSorted(field: string): boolean {
    const values = this.#values.get(field);
    if (!values) return this.#table.isSorted(field);
    let sorted = this.#sorted.get(field);
    if (sorted === undefined) {
      sorted = true;
      for (let row = 0; row < values.length && sorted; row++)
        sorted = !Number.isNaN(values[row]!) && (row === 0 || values[row]! >= values[row - 1]!);
      this.#sorted.set(field, sorted);
    }
    return sorted;
  }
}
