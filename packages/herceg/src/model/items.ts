// Item keys: what names each thing a mark draws that input, selections, and
// transitions address (docs/architecture/marks.md "Items"). One resolver
// builds the keys and finds items again, so every reader names items alike.

import type { Table } from "../data/table.ts";
import type { Mark, MarkKey } from "../marks/mark.ts";
import type { Series } from "../marks/series.ts";

/** One part of an item key after the mark's key: a value field, a facet value, a name, or an interval. */
export type KeyPart = string | number | null | readonly [from: number, to: number];

/**
 * What a pin, a selection, or a target keeps beside a key to find its item
 * fast, never in it: a hint can change while the item stays the same.
 */
export interface ItemHint {
  /** A row item of a table kept in order: its order value, to search for. */
  readonly orderValue?: number;
  /** The generation its identity is from. */
  readonly generation?: number;
}

/**
 * One thing an aggregate item groups by on its mark's table: a value of a
 * field, or an interval of one, `from` included and `to` excluded (`to`
 * too where `closed`, as the last bin of a binning holds its right edge).
 */
export type LocalGroup =
  | { readonly field: string; readonly value: string | number | null }
  | { readonly field: string; readonly from: number; readonly to: number; readonly closed?: true };

/** A table row as a mark draws it: with its series where it has one (annotations' rows have none). */
export interface ItemRow {
  readonly table: Table;
  readonly position: number;
  readonly series?: Series | undefined;
}

/**
 * Names items and finds them again. Keys are JSON arrays starting with the
 * mark's key, as series keys do, so `keyOwner` reads their mark. A key names
 * a logical item; a mark drawn in several panels draws instances of it.
 */
export interface ItemResolver {
  /**
   * A table row's item: the mark's key, the value field where one row draws
   * several items (a wide mark's series), then its name: its `itemKey`
   * value; a bar without one, its series and its position's value; else,
   * and where the value is missing, the row's identity: its table's token
   * (one per table object, so a replaced table's rows are other items),
   * generation, and identity.
   */
  keyOfRow(mark: MarkKey, row: ItemRow): string;
  /** An aggregate's or layout item's: the mark's key, its parts (value field, facet values), then its names. */
  keyOfGroup(mark: MarkKey, parts: readonly KeyPart[], names: readonly KeyPart[]): string;
  /**
   * The positions now of `table`'s rows the key names, ascending, of the
   * rows its mark draws (a view's): its row, every row sharing its name, or
   * none once they are gone. Aggregates' keys name the rows their marks'
   * `groupsOf` gives (none until a mark has it).
   */
  rowsOf(key: string, table: Table, hint?: ItemHint): Uint32Array;
  /** The key an application's reference names (`{ mark, item }`, the parts after the mark's), or undefined for no such mark. */
  keyOfReference(reference: {
    readonly mark: string;
    readonly item: readonly KeyPart[];
  }): string | undefined;
}

/** The part a row named by its identity carries before its table's token, generation, and identity. */
const ROW = "row";

/** Tokens of the tables rows were named in, so that a key never names a row of another table. */
const tokens = new WeakMap<Table, number>();
let tables = 0;

function tokenOf(table: Table): number {
  let token = tokens.get(table);
  if (token === undefined) {
    token = ++tables;
    tokens.set(table, token);
  }
  return token;
}

const NONE = /* @__PURE__ */ new Uint32Array(0);

/** A resolver of the items of `marks`, each with its key in the chart (its `id`, else its index). */
export function itemResolver(
  marks: readonly { readonly mark: Mark; readonly key: MarkKey }[],
): ItemResolver {
  const byKey = new Map(marks.map(({ mark, key }) => [key, mark]));
  const byId = new Map(
    marks.flatMap(({ mark, key }) => (mark.spec.id === undefined ? [] : [[mark.spec.id, key]])),
  );
  const markOf = (key: MarkKey): Mark => {
    const mark = byKey.get(key);
    if (!mark) throw new RangeError(`item key: no mark ${JSON.stringify(key)} in the chart`);
    return mark;
  };
  return {
    keyOfRow(key, { table, position, series }) {
      const mark = markOf(key);
      const parts: KeyPart[] = [key];
      const source = series && sourceOf(series);
      if (source !== undefined && wide(mark)) parts.push(source);
      const field = itemField(mark);
      let name: KeyPart[] | undefined;
      if (field !== undefined) {
        const value = nameAt(table, field, position);
        if (value !== undefined) name = [value];
      } else if (mark.itemPosition !== undefined && source !== undefined) {
        const value = nameAt(table, mark.itemPosition, position);
        if (value !== undefined) name = wide(mark) ? [value] : [source, value];
      }
      parts.push(...(name ?? [ROW, tokenOf(table), table.generation, table.identity(position)]));
      return JSON.stringify(parts);
    },
    keyOfGroup: groupKey,
    rowsOf(itemKey, table) {
      const parts = JSON.parse(itemKey) as KeyPart[];
      const mark = byKey.get(parts[0] as MarkKey);
      if (!mark || mark.table !== table) return NONE;
      return drawnBy(mark, rowsNamed(mark, itemKey, parts, table));
    },
    keyOfReference({ mark, item }) {
      const key = byId.get(mark);
      return key === undefined ? undefined : JSON.stringify([key, ...item]);
    },
  };
}

/** The rows of `table` that `key` (parsed as `parts`) names, whether `mark` draws them or not. */
function rowsNamed(mark: Mark, key: string, parts: readonly KeyPart[], table: Table): Uint32Array {
  // A wide mark's items are of its value fields now, not of fields it drew before.
  if (wide(mark) && !mark.identity?.values.includes(parts[1] as string)) return NONE;
  // Aggregates first: their names may look like anything, "row" included.
  const groups = mark.groupsOf?.(key);
  if (groups) return rowsIn(table, groups);
  const named = wide(mark) ? 3 : 2;
  const field = itemField(mark);
  if (parts.length === named + 3 && parts[named - 1] === ROW) {
    if (parts[named] !== tokens.get(table)) return NONE;
    const position = table.positionOf(parts[named + 2] as number, parts[named + 1] as number);
    // A row named since (by its item field, or a bar's position) is that name's item now.
    const naming = field ?? mark.itemPosition;
    if (position < 0 || (naming !== undefined && nameAt(table, naming, position) !== undefined))
      return NONE;
    return Uint32Array.of(position);
  }
  if (field !== undefined && parts.length === named)
    return positionsOf(table, field, parts[named - 1] as string | number);
  if (field === undefined && mark.itemPosition !== undefined && parts.length === 3) {
    const at = positionsOf(table, mark.itemPosition, parts[2] as string | number);
    const split = mark.identity?.field;
    // Its series is a value field the mark draws now, or a series field's value.
    if (split === undefined) return mark.identity?.values.includes(parts[1] as string) ? at : NONE;
    const inSeries = positionsOf(table, split, parts[1] as string);
    return at.filter((position) => binaryHas(inSeries, position));
  }
  return NONE;
}

/** Of `found`, the rows `mark` draws: all of them for a table, a view's rows for a view. */
function drawnBy(mark: Mark, found: Uint32Array): Uint32Array {
  const shown = mark.rows?.().positions;
  if (!shown || found.length === 0) return found;
  const drawn = new Uint8Array(mark.table!.length);
  for (let k = 0; k < shown.length; k++) drawn[shown[k]!] = 1;
  return found.filter((position) => drawn[position] === 1);
}

/** An aggregate's or layout item's key: its mark's key, its parts, then its names. */
export function groupKey(
  mark: MarkKey,
  parts: readonly KeyPart[],
  names: readonly KeyPart[],
): string {
  return JSON.stringify([mark, ...parts, ...names]);
}

/** The field naming a mark's row items, if it has one. */
function itemField(mark: Mark): string | undefined {
  return (mark.spec as { itemKey?: string }).itemKey;
}

/** Whether one row of `mark` draws several items: a series per value field. */
function wide(mark: Mark): boolean {
  return mark.wide === true;
}

/** What a series is of: a value field, or a series field's value (the second part of its key). */
function sourceOf(series: Series): string | undefined {
  const parsed = JSON.parse(series.key) as unknown[];
  return typeof parsed[1] === "string" ? parsed[1] : undefined;
}

/** A row's name by `field`: a category, or a finite number; undefined where missing. */
function nameAt(table: Table, field: string, position: number): string | number | undefined {
  const value = table.value(field as never, position) as string | number | null;
  return value === null || (typeof value === "number" && !Number.isFinite(value))
    ? undefined
    : value;
}

/**
 * The positions of rows whose `field` holds `value`: categories compared as
 * codes, and only to names (a number never names a category, as keys keep
 * the two apart).
 */
function positionsOf(table: Table, field: string, value: string | number): Uint32Array {
  if (!table.has(field)) return NONE;
  const out: number[] = [];
  if (table.kind(field) === "category") {
    const { codes, dictionary } = table.categories(field as never);
    const code = typeof value === "string" ? dictionary.indexOf(value) : -1;
    if (code < 0) return NONE;
    for (let i = 0; i < codes.length; i++) if (codes[i] === code) out.push(i);
  } else {
    const values = table.numbers(field as never);
    for (let i = 0; i < values.length; i++) if (values[i] === value) out.push(i);
  }
  return Uint32Array.from(out);
}

/** The positions of rows in every one of `groups` (values compared as `positionsOf` does). */
function rowsIn(table: Table, groups: readonly LocalGroup[]): Uint32Array {
  const tests = groups.map((group): ((row: number) => boolean) => {
    if (!table.has(group.field)) return () => false;
    if ("value" in group) {
      const value = group.value;
      if (table.kind(group.field) === "category") {
        const { codes, dictionary } = table.categories(group.field as never);
        const code = typeof value === "string" ? dictionary.indexOf(value) : -1;
        return (row) => codes[row] === code && (code >= 0 || value === null);
      }
      const values = table.numbers(group.field as never);
      return (row) => (value === null ? Number.isNaN(values[row]!) : values[row] === value);
    }
    const values = table.numbers(group.field as never);
    const { from, to, closed } = group;
    return (row) => values[row]! >= from && (closed ? values[row]! <= to : values[row]! < to);
  });
  const out: number[] = [];
  for (let row = 0; row < table.length; row++) if (tests.every((test) => test(row))) out.push(row);
  return Uint32Array.from(out);
}

/** Whether ascending `sorted` holds `value`. */
function binaryHas(sorted: Uint32Array, value: number): boolean {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length && sorted[lo] === value;
}
