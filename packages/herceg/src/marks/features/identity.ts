// What series stand for where the chart's options say more than the core's
// default (model/identity.ts: a series field's values, or value fields): a
// scale they are colored through, declared in `scales` (by a channel naming
// it, or "color" for every mark when the chart declares it), and lines and
// areas colored by a field other than their series field, which stand for
// that field's value while every observation has it, and for themselves
// where it changes along them (drawn in runs, see runs.ts). Marks coloring
// rows by such a field (bars with
// `series: false`, points) keep their series' identities, and their rows
// take that field's colors (`rows`).

import type { Table } from "../../data/table.ts";
import type { FeatureKit } from "../../model/features.ts";
import type { TableName } from "../../model/identity.ts";
import type { Mark } from "../mark.ts";

/** What a mark's series and rows stand for, as prefixes of identity keys. */
export interface MarkScope {
  /** What the series' colors and legend entries follow. */
  readonly color: string;
  /** The declared scale the series' colors follow, if any. */
  readonly scale?: string | undefined;
  /** The option naming `scale` (`encode.stroke.scale`); undefined for the chart's "color". */
  readonly option?: string | undefined;
  /** What the colors of rows follow, for marks coloring rows by another field. */
  readonly rows?: string | undefined;
  /** What marks dodging by the same field place series by. */
  readonly partition?: string | undefined;
  /** The series stand for their names through a scale (`{ series: true, scale }`). */
  readonly named?: boolean | undefined;
  /** The field whose values color the series or rows, which a declared scale reads. */
  readonly field?: string | undefined;
}

/** The prefix of identity keys of a scale's values; with `panel`, of its values in that panel. */
export function scalePrefix(scale: string, panel?: string): string {
  return `${JSON.stringify(panel === undefined ? { scale } : { scale, panel }).slice(0, -1)},"value":`;
}

/**
 * A mark's scope, from what the core gives its series (`own`, undefined
 * for marks whose series stand for nothing), the prefix of a field's
 * values in its table (`by`), and of a scale's values (`prefixOf`,
 * undefined for an identity scale).
 */
export function scopeOfMark(
  mark: Mark,
  own: string | undefined,
  by: (field: string) => string,
  declared: boolean,
  prefixOf: (scale: string) => string | undefined,
): MarkScope | undefined {
  const identity = mark.identity;
  if (own === undefined || !identity || !mark.table) return undefined;
  const field = identity.field;
  type Channel = { field?: string; scale?: string | object; series?: boolean };
  const spec = mark.spec as {
    color?: string | Channel;
    stroke?: string;
    fill?: string;
    encode?: { color?: Channel; stroke?: Channel; fill?: Channel };
  };
  const { encode } = spec;
  // A point's color may be a channel itself, as encode's is.
  const flat = typeof spec.color === "object" ? spec.color : undefined;
  const given = encode?.color ?? flat;
  // What paints the series: the mark's own paint (a line's stroke, an area's,
  // bar's, or point's fill), flat or as a channel, wins over its color.
  const { type } = mark.spec;
  const primary =
    type === "line"
      ? "stroke"
      : type === "area" || type === "bar" || type === "point"
        ? "fill"
        : undefined;
  const painted = primary !== undefined && spec[primary] !== undefined;
  // Series named through a scale stand for their names whatever paints them.
  const named = given?.series ? given : undefined;
  const paint = named ?? ((primary && encode?.[primary]) || given);
  const channel = painted && !named ? undefined : paint;
  // Colors an identity scale reads stand for nothing: the series keep their own.
  if (typeof channel?.scale === "object" || (channel?.scale && !prefixOf(channel.scale)))
    return { color: own, partition: field === undefined ? undefined : own, field };
  const color =
    named || painted || (primary && encode?.[primary]) || flat ? undefined : (spec.color as string);
  const scale = (channel?.scale as string | undefined) ?? (declared ? "color" : undefined);
  const option =
    channel?.scale === undefined
      ? undefined
      : channel === flat
        ? "color.scale"
        : `encode.${channel === encode?.color ? "color" : primary}.scale`;
  const scaled = scale === undefined ? undefined : prefixOf(scale);
  const colored =
    channel?.field ?? (color !== undefined && mark.table.has(color) ? color : undefined);
  const partition = channel?.series ? scaled : field === undefined ? undefined : own;
  if (colored === undefined || colored === field) {
    const named = channel?.series;
    return {
      color: scaled ?? own,
      scale,
      option,
      partition,
      named,
      field: named ? undefined : field,
    };
  }
  // Lines and areas take one color per series; other marks color each row.
  const connected = mark.spec.type === "line" || mark.spec.type === "area";
  return connected
    ? { color: scaled ?? by(colored), scale, option, partition, field: colored }
    : { color: own, rows: scaled ?? by(colored), partition, field: colored };
}

/**
 * The names of `tables` as `simpleNames` (model/identity.ts) gives them,
 * where two would take one: tables with names of their own, or of the
 * configuration before (`last`), keep them, and the rest take their
 * places, with `n` where another table holds that place's name. Throws
 * for two tables of one name.
 */
export function tableNames(
  kit: FeatureKit,
  tables: readonly (Table | undefined)[],
  places: readonly (string | number)[],
  last: ReadonlyMap<Table, TableName> | undefined,
): (TableName | undefined)[] {
  const names = new Map<Table, TableName>();
  const taken = new Set<string>();
  const give = (table: Table, name: TableName) => {
    names.set(table, name);
    taken.add(JSON.stringify(name));
  };
  // Tables with names keep them before others are named.
  for (const [i, table] of tables.entries()) {
    const name = table && !names.has(table) ? (table.name ?? last?.get(table)) : undefined;
    if (name === undefined) continue;
    if (taken.has(JSON.stringify(name)))
      throw new kit.ChartError({
        code: "invalid-option",
        path: `marks[${i}]`,
        message: `marks[${i}]: its table is named "${name}", as another of the chart's tables is; give each table a name of its own`,
      });
    give(table!, name);
  }
  for (const [i, table] of tables.entries()) {
    if (!table || names.has(table)) continue;
    let n = 0;
    let name: TableName = { mark: places[i]! };
    while (taken.has(JSON.stringify(name))) name = { mark: places[i]!, n: ++n };
    give(table, name);
  }
  return tables.map((table) => table && names.get(table));
}
