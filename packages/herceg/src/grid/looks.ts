// Grid looks: how a grid's cells look by their rows' values (docs/guide/
// grids.md, "Looks"). A column's `encode` colors its cells on table rows,
// its `aggregateEncode` its cells on group rows, and a model's `encode`
// whole table rows where a column's own channel gives no output. Channels
// take the forms marks' colors take and are compiled by the code charts
// share (encoding/channels.ts), once per change of the grid's columns,
// scales, displays, or encodings, against each table they read: the
// records, each group level's table, a pivot's tables, a remote window.
// The grid's scales are shared by every table: a channel scale's domain,
// unless given, spans every (table, field) read through it, and a rank test
// ranks the records. Both are brought up to date as their tables change
// (`LookScales.update`), never while cells are read. A row a channel gives
// no output has no look.

import type { Expression, Fields } from "../data/expression.ts";
import type { NamedAggregate } from "../data/groups.ts";
import type { MarkRows } from "../data/row-view.ts";
import type { Schema, Table } from "../data/table.ts";
import { type CategoryScale, OrdinalScale } from "../encoding/category-scales.ts";
import { ChannelScale, channelScaleProblem } from "../encoding/channel-scales.ts";
import {
  type Channel,
  type Check,
  channelRevision,
  compileChannel,
  IDENTITY,
  keyPath,
  NO_OUTPUT,
  type RankRead,
  type RowReader,
  rowReader,
  type ScaleOf,
  scalePath,
  type ValueColors,
} from "../encoding/channels.ts";
import { Rank } from "../encoding/ranks.ts";
import { type CompiledFields, type DisplayedField, hasColors } from "../fields/display.ts";
import type { RowColorChannels } from "../marks/encoding.ts";
import type {
  ChannelScaleSpec,
  ChannelSpec,
  IdentityScaleSpec,
  OrdinalScaleSpec,
} from "../spec/encoding.ts";
import type { DisplayedKind } from "../spec/fields.ts";
import { expressionFields } from "./query.ts";

/** A cell's look: its background (`fill`) and its text's color, as given (CSS variables unresolved). */
export interface CellLook {
  readonly fill?: string;
  readonly color?: string;
}

/**
 * How cells look, by row: `fill` is a cell's background, `color` its text's
 * color (without one, text over a fill takes black or white, whichever
 * contrasts more). Each takes a channel as marks' colors do, or channels
 * tried in order, the first giving a row an output winning: a field's
 * display colors (a number field without a scale: its thresholds' and
 * mappings' colors; a category field without one: the grid's "color"
 * scale, else its mappings' colors), a field through a scale of the grid's
 * `scales`, a constant, or a condition (an expression over the row, or a
 * rank test of the records). A row a channel gives no output has no look.
 */
export interface CellEncodings<S extends Schema = Schema> {
  fill?: RowColorChannels<S> | undefined;
  color?: RowColorChannels<S> | undefined;
}

/**
 * A scale of a grid's `scales`: a channel scale (a gradient along a number
 * or time field, through hex colors), a scale of categories (its values'
 * colors by `map`, else the theme's palette by their place in its domain,
 * else `unknown`), or an identity scale (a field of colors as they are).
 */
export type GridScale = GridGradient | GridCategories | IdentityScaleSpec;

/** A channel scale of a grid's: a gradient through two or more hex colors. */
export interface GridGradient extends Omit<ChannelScaleSpec, "range"> {
  /** Hex colors, two or more. @minItems 2 */
  range: readonly string[];
}

/** A scale of categories of a grid's: colors by value, the theme's palette else, then `unknown`. */
export interface GridCategories extends Omit<OrdinalScaleSpec, "scope" | "map" | "unknown"> {
  map?: Readonly<Record<string, string>>;
  /** For values outside an explicit `domain`. */
  unknown?: string;
}

/**
 * A grid's scales by name, as charts' `scales` take them: shared by every
 * channel naming one, in columns' and rows' looks alike. A channel scale's
 * domain, unless given, is the extent of every field read through it (the
 * records', a group level's aggregates', a pivot's), so a scale shared by
 * records and their sums spans both.
 */
export type GridScales = Readonly<Record<string, GridScale>>;

/**
 * A palette place, as looks give it: the renderer's theme gives place `n`
 * its palette's color at `n` (cycled), so the model holds no theme.
 */
const PALETTE = (place: number) => `var(--hg-palette-${place})`;

/** Hex colors, which gradients mix without a page. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/**
 * Whether `value` is a CSS color: as the browser parses colors, or without
 * one, as colors are written (hex with or without alpha, a function, a name).
 */
function isColor(value: string): boolean {
  const css = (globalThis as { CSS?: { supports?(property: string, value: string): boolean } }).CSS;
  return css?.supports
    ? css.supports("color", value)
    : /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value) ||
        /^[a-z-]+\(.*\)$/i.test(value) ||
        /^[a-z]+$/i.test(value);
}

/** Refuses an output that is not a color, at `path`. */
const check: Check = (value, path) => {
  if (typeof value !== "string" || !isColor(value))
    throw new TypeError(`${path}: expected a CSS color; received ${JSON.stringify(value)}`);
};

/** Values of a field read as colors (an identity scale's) that are not colors give no output. */
const lenient: Check = (value) => {
  if (typeof value !== "string" || !isColor(value)) throw NO_OUTPUT;
};

/**
 * A channel compiled against one table, reading its rows for the table
 * version, and the domains and ranks it reads, as last read.
 */
export class LookChannel {
  readonly channel: Channel<string>;
  #table: Fields | undefined;
  #version = -1;
  #revision = -1;
  #reader: RowReader<string> | undefined;

  constructor(channel: Channel<string>) {
    this.channel = channel;
  }

  /** Row `row`'s output of `table` (the table compiled against, or a remote window of its fields); undefined for none. */
  output(table: Fields, row: number): string | undefined {
    const version = (table as Partial<Table>).version ?? 0;
    // A filter moves a gradient's domain without changing its table.
    const revision = channelRevision([this.channel]);
    if (this.#table !== table || this.#version !== version || this.#revision !== revision) {
      this.#table = table;
      this.#version = version;
      this.#revision = revision;
      this.#reader = rowReader(
        this.channel,
        table as Table,
        PALETTE,
        undefined as unknown as string,
        lenient,
        "",
        false,
      );
    }
    return this.#reader!.output(row);
  }
}

/**
 * A plain copy of channels as given: expressions built with `col` as their
 * JSON form, other values as they are (numbers that JSON cannot carry
 * included, so the expression compiler refuses them as charts' does).
 */
export function plain(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const json = (value as { toJSON?: unknown }).toJSON;
  if (typeof json === "function") return plain(json.call(value));
  if (Array.isArray(value)) return value.map(plain);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)]));
}

/**
 * A copy of `owner` (a column, a pivot's aggregate's options) with its
 * encodings copied as given, so a caller's later changes to it, encodings
 * added included, reach the grid only when given again.
 */
export function withEncodingsCopied<T extends { encode?: unknown; aggregateEncode?: unknown }>(
  owner: T,
): T {
  const copy: { encode?: unknown; aggregateEncode?: unknown } = { ...owner };
  if (owner.encode !== undefined) copy.encode = plain(owner.encode);
  if (owner.aggregateEncode !== undefined) copy.aggregateEncode = plain(owner.aggregateEncode);
  return copy as T;
}

/** A column's (or a row's) channels compiled against one table. */
export interface Look {
  readonly fill: LookChannel | undefined;
  readonly color: LookChannel | undefined;
}

/**
 * Row `row`'s look of `table` by a column's channels (`own`), each channel
 * the row's (`row`) where the column's gives no output; undefined for none.
 */
export function lookOf(
  table: Fields,
  row: number,
  own: Look | undefined,
  rows?: Look | undefined,
): CellLook | undefined {
  const fill = own?.fill?.output(table, row) ?? rows?.fill?.output(table, row);
  const color = own?.color?.output(table, row) ?? rows?.color?.output(table, row);
  if (fill === undefined) return color === undefined ? undefined : { color };
  return color === undefined ? { fill } : { fill, color };
}

/**
 * A table looks read, and what reading it takes: `rows`, the rows domains
 * span (undefined where the grid holds none: a remote grid's); `rank`, the
 * rank tests of its rows, or why it takes none; `aggregates`, the
 * aggregates among its fields, whose display colors are their field's
 * where the operation keeps its units; `source`, the field of the grid's
 * table whose display a field of this table takes (itself by default).
 */
export interface LookTable {
  readonly table: Fields;
  readonly rows?: (() => MarkRows) | undefined;
  readonly rank: ((field: string, count: number, top: boolean) => RankRead & Updating) | string;
  readonly aggregates?: readonly NamedAggregate[] | undefined;
}

/** Something brought up to date before cells are read: a rank test. */
export interface Updating {
  update(): void;
}

/** What looks are compiled with: how the grid names itself, its scales, and its displays. */
export interface LookSettings {
  readonly surface: string;
  readonly scales: LookScales;
  readonly fields: CompiledFields | undefined;
  /** What displays' rules naming tables match: the grid's table, or a remote source's name. */
  readonly source: Table | string | undefined;
  /** The kinds of the grid's own fields, whose displays its tables' fields take. */
  readonly kinds: Pick<Fields, "has" | "kind">;
}

/**
 * `given` (an `encode` or `aggregateEncode`, named `path`) compiled against
 * `of`; undefined without channels. `partial`: only the entries reading
 * fields `of`'s table has (see `within`). Throws where it cannot be read
 * there.
 */
export function compileEncodings(
  given: unknown,
  of: LookTable,
  settings: LookSettings,
  path: string,
  partial = false,
): Look | undefined {
  if (given === undefined) return undefined;
  if (typeof given !== "object" || given === null || Array.isArray(given))
    throw new TypeError(
      `${path}: expected channels such as { fill, color }; received ${JSON.stringify(given)}`,
    );
  for (const key of Object.keys(given))
    if (key !== "fill" && key !== "color")
      throw new TypeError(`${path}.${key}: unknown channel; cells take fill and color`);
  const { fill, color } = given as { fill?: unknown; color?: unknown };
  const look = (channel: unknown, name: string) =>
    compileLook(partial ? within(channel, of.table) : channel, of, settings, `${path}.${name}`);
  const compiled = { fill: look(fill, "fill"), color: look(color, "color") };
  return compiled.fill || compiled.color ? compiled : undefined;
}

/**
 * The channel `given` (a `fill` or `color` of `encode` or
 * `aggregateEncode`, named `path`) compiled against `of`; undefined
 * without one. Throws where it cannot be read there.
 */
export function compileLook(
  given: unknown,
  of: LookTable,
  settings: LookSettings,
  path: string,
): LookChannel | undefined {
  if (given === undefined) return undefined;
  const copied = plain(given);
  const entries = Array.isArray(copied) ? copied : [copied];
  entries.forEach((entry, i) => {
    refuse(entry, of, settings.surface, Array.isArray(copied) ? `${path}[${i}]` : path);
  });
  const channel = compileChannel<string>(
    copied as ChannelSpec<string>,
    of.table as Table,
    settings.scales.scaleOf(of, settings),
    "color",
    check,
    path,
  );
  return new LookChannel(channel);
}

/** The keys each form of a cell's channel takes, and what the form is called. */
const FORMS: Readonly<Record<string, readonly [string, ...string[]]>> = {
  field: ["a field's channel", "field", "scale"],
  value: ["a constant", "value"],
  condition: ["a condition", "condition"],
};

/**
 * Refuses what a grid's channel cannot be, at `at`: anything but one of
 * the forms cells take, the series' names, ranks where rows are not
 * ranked, colors of sums. (A list's nesting and emptiness are the channel
 * compiler's to refuse.)
 */
function refuse(entry: unknown, of: LookTable, surface: string, at: string): void {
  if (Array.isArray(entry)) return;
  const expected = `expected a channel: { field, scale? }, { value }, or { condition: { when, then, otherwise? } }; received ${JSON.stringify(entry)}`;
  if (typeof entry !== "object" || entry === null) throw new TypeError(`${at}: ${expected}`);
  const spec = entry as {
    series?: unknown;
    field?: unknown;
    scale?: unknown;
    condition?: { when?: unknown };
  };
  if ("series" in spec)
    throw new TypeError(
      `${at}: a ${surface} has no series; give a field, a constant, or a condition`,
    );
  const forms = Object.keys(FORMS).filter((form) => form in spec);
  if (forms.length !== 1) throw new TypeError(`${at}: ${expected}`);
  const [form, ...keys] = FORMS[forms[0]!]!;
  for (const key of Object.keys(spec))
    if (!keys.includes(key))
      throw new TypeError(`${at}.${key}: unknown key; ${form} takes ${keys.join(" and ")}`);
  const { scale, condition } = spec;
  if (
    typeof scale === "object" &&
    (scale === null ||
      (scale as { type?: unknown }).type !== "identity" ||
      Object.keys(scale).length !== 1)
  )
    throw new TypeError(
      `${at}.scale: expected the name of one of the ${surface}'s scales, or { type: "identity" }; received ${JSON.stringify(scale)}`,
    );
  if (condition !== undefined) {
    const parts = typeof condition === "object" && condition !== null ? Object.keys(condition) : [];
    if (
      !parts.includes("when") ||
      !parts.includes("then") ||
      parts.some((key) => key !== "when" && key !== "then" && key !== "otherwise")
    )
      throw new TypeError(
        `${at}.condition: expected { when, then, otherwise? }; received ${JSON.stringify(condition)}`,
      );
  }
  const when = spec.condition?.when;
  if (typeof of.rank === "string" && typeof when === "object" && when && !Array.isArray(when))
    throw new TypeError(`${at}.condition.when: ${of.rank}`);
  const aggregate = of.aggregates?.find(({ name }) => name === spec.field);
  if (aggregate && spec.scale === undefined && (aggregate.op === "sum" || aggregate.op === "count"))
    throw new TypeError(
      `${at}: aggregate "${aggregate.name}" is a ${aggregate.op}, which is not in ${aggregate.field === undefined ? "a field's" : "the field's"} units, so fields give it no colors; name a scale`,
    );
}

/**
 * `given` with only the entries whose fields `table` has: what a table
 * lacking some of the fields the channel reads (a group level above the
 * deepest, which lacks the grouping fields below it) reads; undefined
 * where none is left.
 */
export function within(given: unknown, table: Pick<Fields, "has">): unknown {
  if (given === undefined) return undefined;
  const copied = plain(given);
  const reads = (entry: unknown) => entryFields(entry).every((field) => table.has(field));
  if (!Array.isArray(copied)) return reads(copied) ? copied : undefined;
  const kept = copied.filter(reads);
  return kept.length > 0 ? kept : undefined;
}

/** The fields channels of `given` (an `encode`) read: their fields, and their conditions'. */
export function lookFields(given: unknown): string[] {
  if (typeof given !== "object" || given === null) return [];
  const copied = plain(given) as Record<string, unknown>;
  return Object.values(copied).flatMap((channel) =>
    (Array.isArray(channel) ? channel : [channel]).flatMap(entryFields),
  );
}

/** The fields a channel reads: its field, and its condition's. */
function entryFields(entry: unknown): string[] {
  if (typeof entry !== "object" || entry === null) return [];
  const spec = entry as { field?: unknown; condition?: { when?: unknown } };
  const fields: unknown[] = [spec.field];
  const when = spec.condition?.when;
  if (Array.isArray(when)) fields.push(...expressionFields(when as unknown as Expression));
  else if (typeof when === "object" && when) fields.push((when as { field?: unknown }).field);
  return fields.filter((field): field is string => typeof field === "string");
}

/**
 * A grid's scales, made from its `scales` (checked as they are taken) and
 * shared by the channels of every table its looks read; made again with the
 * looks, scales of categories keeping the places their values took.
 */
export class LookScales {
  readonly #surface: string;
  readonly #remote: boolean;
  readonly #names: readonly string[];
  readonly #channel = new Map<string, ChannelScale>();
  readonly #ordinal = new Map<string, OrdinalScale>();
  readonly #identity = new Set<string>();
  /** Rank tests of the looks, brought up to date with the channel scales. */
  readonly #ranks: (RankRead & Updating)[] = [];
  /** Display colors by field and kind, for the displays of the looks' compilation. */
  readonly #colors = new Map<string, DisplayedField | null>();
  /**
   * What the domains and ranks were last, and how many times that or the
   * looks changed: counted on from the scales before, so it only grows.
   */
  #seen = -1;
  #revision: number;

  /**
   * `given` as the grid's `scales` (`surface` names the grid in messages);
   * a remote grid's (`remote`) need domains. `previous`, the scales before,
   * hands its scales of categories' places to those of the same settings.
   */
  constructor(
    given: GridScales | undefined,
    surface: string,
    remote: boolean,
    previous?: LookScales,
  ) {
    this.#surface = surface;
    this.#remote = remote;
    this.#revision = previous ? previous.#revision + 1 : 0;
    if (
      given !== undefined &&
      (typeof given !== "object" || given === null || Array.isArray(given))
    )
      throw new TypeError(
        `${surface} scales: expected scales by name; received ${JSON.stringify(given)}`,
      );
    for (const [name, taken] of Object.entries(given ?? {})) {
      const at = `${surface} ${scalePath(name)}`;
      if (typeof taken !== "object" || taken === null)
        throw new TypeError(`${at}: expected a scale; received ${JSON.stringify(taken)}`);
      // A copy, so a scale object the caller changes and gives again is compared as it was.
      const spec = plain(taken) as GridScale;
      if ("range" in spec) {
        const problem = channelScaleProblem(spec);
        if (problem)
          throw new TypeError(
            `${at}${problem.at}: expected ${problem.expected}; received ${JSON.stringify(problem.value)}`,
          );
        (spec.range as readonly unknown[]).forEach((stop, i) => {
          if (typeof stop === "string" && !HEX.test(stop))
            throw new TypeError(
              `${at}.range[${i}]: a gradient mixes hex colors; give "#rrggbb", not ${JSON.stringify(stop)}`,
            );
        });
        if (name === "color")
          throw new TypeError(
            `${at}: "color" is the scale category fields are read through by default, which a scale with a range does not map; give the channel scale another name`,
          );
        this.#channel.set(name, new ChannelScale(name, spec));
      } else if (spec.type === "identity") {
        this.#identity.add(name);
      } else if (spec.type === "ordinal") {
        this.#ordinal.set(name, this.#ordinalScale(name, spec, at, previous));
      } else {
        throw new TypeError(
          `${at}: expected a channel scale ({ type, range }), a scale of categories (type: "ordinal"), or { type: "identity" }; received ${JSON.stringify(spec)}`,
        );
      }
    }
    this.#names = Object.keys(given ?? {});
  }

  #ordinalScale(
    name: string,
    spec: Omit<OrdinalScaleSpec, "scope">,
    at: string,
    previous: LookScales | undefined,
  ): OrdinalScale {
    if ((spec as OrdinalScaleSpec).scope !== undefined)
      throw new TypeError(`${at}.scope: a ${this.#surface} has no panels; drop scope`);
    const { domain, map } = spec;
    if (
      domain !== undefined &&
      !(Array.isArray(domain) && domain.every((v) => typeof v === "string"))
    )
      throw new TypeError(`${at}.domain: expected labels; received ${JSON.stringify(domain)}`);
    if (this.#remote) {
      // Windows carry dictionaries of their own: places by first appearance would follow load order.
      if (!domain)
        throw new TypeError(
          `${at}: a remote grid's categories arrive block by block, so palette places would depend on load order; give the scale a domain (values outside it take unknown)`,
        );
      for (const value of Object.keys(map ?? {}))
        if (!domain.includes(value))
          throw new TypeError(
            `${at}.map${keyPath("", value)}: ${JSON.stringify(value)} is not in the scale's domain; add it to domain, or drop it from map`,
          );
    }
    const before = previous ? previous.#ordinal.get(name) : undefined;
    const same = before && JSON.stringify(before.spec) === JSON.stringify(spec);
    return new OrdinalScale(name, spec as OrdinalScaleSpec, same ? before : undefined);
  }

  /** What channels of table `of` read values through, as `settings` say. */
  scaleOf(of: LookTable, settings: LookSettings): ScaleOf {
    const surface = this.#surface;
    const scales = (name: string, path: string, field?: string): CategoryScale | ChannelScale => {
      if (this.#identity.has(name)) return IDENTITY;
      const channel = this.#channel.get(name);
      if (channel) {
        if (this.#remote && !channel.spec.domain)
          throw new TypeError(
            `${path}: "${name}" finds its domain from every row, which a remote grid does not hold; give the scale a domain`,
          );
        if (field !== undefined && of.rows && of.table.has(field)) channel.read(of.rows, field);
        return channel;
      }
      const ordinal = this.#ordinal.get(name);
      if (ordinal) return ordinal;
      // A category field without a scale: the grid's "color" scale, else its mappings' colors.
      if (name === "color" && field !== undefined && of.table.has(field)) {
        const display = this.#display(of, settings, field, "category");
        if (display) {
          const color = colorsOf(display);
          return {
            name: "color",
            spec: undefined,
            read() {},
            place: () => undefined,
            output: <V>(value: string, _: unknown, fallback: V) =>
              (color(value) as V | undefined) ?? fallback,
            missing: () => color(null),
          };
        }
        throw new TypeError(
          `${path.replace(/\.scale$/, "")}: field "${field}" has no colors: fields give it no mapping colors, and the ${surface} declares no "color" scale; give ${keyPath("fields", field)} mappings with colors, or name a scale`,
        );
      }
      const names = this.#names.map((n) => `"${n}"`).join(", ");
      throw new Error(
        `${path}: no scale "${name}"; ${names ? `the ${surface}'s scales are ${names}` : `the ${surface} has no scales; add it to scales`}`,
      );
    };
    return Object.assign(scales, {
      owner: surface,
      colors: (field: string): ValueColors | undefined => {
        const display = this.#display(of, settings, field, "number");
        return display && valueColors(display);
      },
      rank: (field: string, count: number, top: boolean) => {
        const rank = (of.rank as Exclude<LookTable["rank"], string>)(field, count, top);
        this.#ranks.push(rank);
        return rank;
      },
    });
  }

  /**
   * The display whose colors a field of `of`'s table takes, where it gives
   * some: the grid's own field's, or for an aggregate keeping its field's
   * units (a mean, a minimum, a maximum), its field's.
   */
  #display(
    of: LookTable,
    { fields, source, kinds }: LookSettings,
    field: string,
    kind: DisplayedKind,
  ): DisplayedField | undefined {
    if (!fields) return undefined;
    const aggregate = of.aggregates?.find(({ name }) => name === field);
    const name = aggregate ? aggregate.field : field;
    if (name === undefined || aggregate?.op === "sum" || aggregate?.op === "count")
      return undefined;
    if (!kinds.has(name) || kinds.kind(name) !== kind) return undefined;
    const key = `${kind}\u0000${name}`;
    let display = this.#colors.get(key);
    if (display === undefined) {
      const shown = fields.displayOf({ field: name, kind, table: source } as {
        field: string;
        kind: DisplayedKind;
      });
      display = hasColors(shown) ? shown : null;
      this.#colors.set(key, display);
    }
    return display ?? undefined;
  }

  /** Brings the domains found from data, and rank tests, up to date with their tables. */
  update(): void {
    let sum = 0;
    for (const scale of this.#channel.values()) {
      // Ranges are hex, read as they are.
      scale.update((value) => value, `${this.#surface} ${scalePath(scale.name)}`);
      sum += scale.revision;
    }
    for (const scale of this.#ordinal.values()) scale.update();
    for (const rank of this.#ranks) {
      rank.update();
      sum += rank.revision;
    }
    if (sum !== this.#seen) {
      this.#seen = sum;
      this.#revision++;
    }
  }

  /**
   * Counts changes of what looks are compiled from, the domains found from
   * data, and rank tests' nth values, as of the last `update`.
   */
  get revision(): number {
    return this.#revision;
  }
}

/**
 * A display's colors, read once each: fields take any text as a color
 * (surfaces read it as CSS), so one that is not a color gives no output,
 * as a field of colors' values do.
 */
function colorsOf(display: DisplayedField): (value: number | string | null) => string | undefined {
  const read = new Map<string, boolean>();
  return (value) => {
    const color = display.color(value as never);
    if (color === undefined) return undefined;
    let ok = read.get(color);
    if (ok === undefined) {
      ok = isColor(color);
      read.set(color, ok);
    }
    return ok ? color : undefined;
  };
}

/** A number field's display colors as channels read them: each color a place, taken as values first show it. */
function valueColors(display: DisplayedField): ValueColors {
  const colors: string[] = [];
  const places = new Map<string, number>();
  return {
    colors,
    index(value) {
      const color = display.color(value);
      if (color === undefined) return Number.isNaN(value) ? -1 : 0;
      let place = places.get(color);
      if (place === undefined) {
        // Fields take any text as a color; one that is not gives no output (see `colorsOf`).
        place = isColor(color) ? colors.push(color) : 0;
        places.set(color, place);
      }
      return place;
    },
  };
}

/** A rank test over `rows`, brought up to date with the scales. */
export function rankOf(rows: () => MarkRows): (field: string, count: number, top: boolean) => Rank {
  return (field, count, top) => new Rank(rows, field, count, top);
}
