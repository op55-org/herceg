// Channels compiled against a table, for marks and grids alike: a
// constant, a category field's values through an ordinal scale (by
// dictionary code, so reading a row is an array lookup), a number field's
// values through a channel scale (channel-scales.ts) or, for colors
// without one, by the colors field displays give them, a field's values as
// they are (an identity scale's, checked as constants are), the series'
// names through a scale (which charts split, marks/features/channels.ts,
// and grids refuse), a condition on each row (an expression, or a rank
// test, ranks.ts), or a list of them tried in order. Every output is
// checked against what draws it (`Check`): a constant, a scale's map and
// `unknown`, used or not, a channel scale's range, and the values an
// identity scale reads. Messages name what holds the scales
// (`ScaleOf.owner`): a chart, or a grid (grid/looks.ts).

import { compileExpression, type Expression } from "../data/expression.ts";
import type { ReadonlyTable, Table } from "../data/table.ts";
import type { ChannelName } from "../spec/channels.ts";
import type { ChannelSpec, ChannelsSpec, IdentityScaleSpec, RankSpec } from "../spec/encoding.ts";
import type { CategoryScale, Defaults } from "./category-scales.ts";
import { ChannelScale, wholeTable } from "./channel-scales.ts";
import { Rank } from "./ranks.ts";

export type Channel<V> =
  | { readonly kind: "value"; readonly value: V }
  | { readonly kind: "field"; readonly field: string; readonly scale: CategoryScale }
  /** A number field's values through a channel scale, kept within what the channel takes (`limits`). */
  | ScaledChannel
  /** A field's values as they are: a category field's by code, a number field's by row. */
  | { readonly kind: "identity"; readonly field: string; readonly numbers: boolean }
  /** The series' names through a scale (`{ series: true, scale }`). */
  | { readonly kind: "series"; readonly scale: CategoryScale }
  /** A number field's values in their display colors (`ValueColors`), read without a scale. */
  | { readonly kind: "display"; readonly field: string; readonly colors: ValueColors }
  | {
      readonly kind: "condition";
      readonly when: (row: number) => boolean;
      /** The rank test `when` is, whose nth value moves with the rows it ranks. */
      readonly rank?: RankRead | undefined;
      readonly then: V;
      /** Undefined: no output where `when` fails. */
      readonly otherwise: V | undefined;
    }
  /** Channels tried in order: a row takes the first one's output it has (one or more). */
  | { readonly kind: "list"; readonly entries: readonly Channel<V>[] };

/** A number field's values through a channel scale. */
export interface ScaledChannel {
  readonly kind: "scaled";
  readonly field: string;
  readonly scale: ChannelScale;
  /** What the channel takes, which outputs past the range's ends stay within. */
  readonly limits: readonly [number, number];
}

/**
 * Finds the chart's scales by name, making the default ones as marks read
 * them; a `field` read through the default "color" scale where the chart
 * declares none takes the colors of what its values stand for. An identity
 * scale of the chart's is `IDENTITY`. A channel scale read for a `field`
 * reads that field of the mark's rows into its domain. `colors` gives a
 * number field's display colors, where the chart's field displays give it
 * some; `rank` a rank test over the mark's rows, which the chart brings up
 * to date before it draws. `owner` names what holds the scales in messages:
 * "chart" by default, "grid" for a grid's looks.
 */
export type ScaleOf = ((
  name: string,
  path: string,
  field?: string,
) => CategoryScale | ChannelScale) & {
  colors?(field: string): ValueColors | undefined;
  rank?(field: string, count: number, top: boolean): RankRead;
  owner?: string;
};

/**
 * A rank test as conditions read it (`Rank`, ranks.ts): whether a row's
 * value is among the n, and a revision that moves with the nth value.
 */
export interface RankRead {
  holds(row: number): boolean;
  readonly revision: number;
}

/**
 * A number field's display colors as channels read them: the colors its
 * values take, and which each value takes, one more than its place among
 * them (0 for none, which takes the mark's own paint; -1 for a missing
 * value without a color).
 */
export interface ValueColors {
  readonly colors: readonly string[];
  index(value: number): number;
}

/**
 * A channel's outputs by value through its channel scale: colors, or
 * numbers within the channel's limits; undefined for none. As the scale is
 * now: read again once its revision changes.
 */
export function scaledOutputs(
  channel: ScaledChannel,
): (value: number) => string | number | undefined {
  const { scale, limits } = channel;
  if (scale.colors) return scale.colorOutputs();
  const map = scale.numberOutputs(limits);
  return (value) => {
    const out = map(value);
    return Number.isNaN(out) ? undefined : out;
  };
}

/**
 * The sum of the revisions of what `channels` read beyond each row's own
 * values (channel scales' domains, rank tests' nth values), which changes
 * whenever one does.
 */
export function channelRevision(channels: readonly (Channel<unknown> | undefined)[]): number {
  let sum = 0;
  for (const c of channels)
    if (c?.kind === "scaled") sum += c.scale.revision;
    else if (c?.kind === "condition") sum += c.rank?.revision ?? 0;
    else if (c?.kind === "list") sum += channelRevision(c.entries);
  return sum;
}

/** Whether `channel` gives every row an output: a constant, the series' names, a condition with `otherwise`. */
function always(channel: ChannelSpec<unknown>): boolean {
  return (
    "value" in channel ||
    "series" in channel ||
    ("condition" in channel && channel.condition?.otherwise !== undefined)
  );
}

/** What a scale of `{ type: "identity" }` is among the chart's scales: no mapping. */
export const IDENTITY: CategoryScale = {
  name: "identity",
  spec: undefined,
  read() {},
  place: () => undefined,
  output: (value, _defaults, fallback) => (value as never) ?? fallback,
};

/** A check of what a channel draws (see `outputProblem`), throwing at `path`. */
export type Check = (value: unknown, path: string) => void;

/**
 * What a check throws for a value read as it is (an identity scale's) that
 * gives the row no output rather than an error: grids' cells draw nothing
 * for a field's value that is not a color, and a list reads its next entry.
 */
export const NO_OUTPUT = new Error("no output");

/** `value` where `check` takes it; undefined where it throws `NO_OUTPUT`. */
function checked<V>(check: Check, value: V, path: string): V | undefined {
  try {
    check(value, path);
    return value;
  } catch (error) {
    if (error === NO_OUTPUT) return undefined;
    throw error;
  }
}

/** The fields a table has, for messages. */
export function fieldsOf(table: Table): string {
  return table
    .fields()
    .map((f) => `"${f}"`)
    .join(", ");
}

/**
 * A field of `table` that holds `kind` values (categories by default), or
 * an error at `path` (with the code the compiler's ChartError takes, see
 * `placed` in compile.ts).
 */
export function categoryField(
  table: Table | undefined,
  field: string,
  path: string,
  kind: "category" | "number" = "category",
  owner = "chart",
): string {
  if (!table)
    throw new Error(
      `${path}: "${field}" names a field, and fields need a table; pass the table first`,
    );
  if (!table.has(field))
    throw Object.assign(
      new Error(`${path}: no field "${field}"; the table has ${fieldsOf(table)}`),
      { code: "unknown-field" },
    );
  const held = table.kind(field);
  if (held !== kind)
    throw Object.assign(
      new TypeError(
        kind !== "category"
          ? `${path}: field "${field}" holds ${held} values; this channel's values are numbers, so name a number field`
          : held === "number"
            ? `${path}: field "${field}" holds numbers, which scales of categories do not map; name a channel scale (a scale of the ${owner}'s with a range), or give a category field`
            : `${path}: field "${field}" holds ${held} values; channels read categories, through a scale`,
      ),
      { code: "field-type" },
    );
  return field;
}

/** A row predicate of an expression over `table`, or an error at `path`. */
export function predicate(
  table: Table | undefined,
  expression: Expression,
  path: string,
): (row: number) => boolean {
  if (!table)
    throw new Error(
      `${path}: an expression reads rows, and rows need a table; pass the table first`,
    );
  let compiled: ReturnType<typeof compileExpression>;
  try {
    compiled = compileExpression(expression, table);
  } catch (error) {
    throw new Error(`${path}: ${(error as Error).message}`);
  }
  if (compiled.type !== "boolean")
    throw new TypeError(
      `${path}: expected a condition (true or false); the expression gives a ${compiled.type}`,
    );
  // An expression reads the columns of the version it was compiled for:
  // appends and drops move them, so it is compiled again for each version.
  let { at } = compiled;
  let version = table.version;
  return (row) => {
    if (version !== table.version) {
      version = table.version;
      at = compileExpression(expression, table).at;
    }
    return at(row) === true;
  };
}

/** Channels whose values are numbers, which identity scales read from number fields. */
const NUMBERS: readonly ChannelName[] = ["strokeWidth", "size", "opacity", "fillOpacity"];

/**
 * Compiles channel `name` of a mark (`path` names it in messages). `check`
 * refuses values it cannot draw; `scale` names the scale a field reads by
 * default. A field read through scale `unread` leaves the scale's domain
 * to place its values as rows ask for them (see the list's).
 */
export function compileChannel<V>(
  given: ChannelsSpec<V>,
  table: Table | undefined,
  scales: ScaleOf,
  scale: string,
  check: Check,
  path: string,
  name: ChannelName = "color",
  unread?: string,
): Channel<V> {
  const { owner = "chart" } = scales;
  if (Array.isArray(given)) {
    if (given.length === 0)
      throw new TypeError(
        `${path}: expected a channel, or channels tried in order; received an empty list`,
      );
    // A list ending in the series' names through a scale: its other entries'
    // fields read through it place their values as rows ask, after the
    // series' names (which take theirs as series are made), so the series
    // keep the places they have through the scale alone.
    const last = given[given.length - 1] as ChannelSpec<V> | undefined;
    const series =
      last && "series" in last && typeof last.scale === "string" ? last.scale : undefined;
    // Every entry is checked, reached or not; one after an entry always giving an output is refused.
    const entries = given.map((entry, i) => {
      if (Array.isArray(entry))
        throw new TypeError(
          `${path}[${i}]: expected a channel; a list's entries are channels, so give them in one list`,
        );
      const at = `${path}[${i}]`;
      const compiled = compileChannel<V>(entry, table, scales, scale, check, at, name, series);
      if (i > 0 && always(given[i - 1]!))
        throw new TypeError(
          `${path}[${i}]: the channel before it always gives an output (a constant, the series' names, or a condition with otherwise); move it first, or drop it`,
        );
      return compiled;
    });
    // A list of one is still a list: it splits no series, and rows it gives no output take the mark's.
    return { kind: "list", entries };
  }
  const spec = given as ChannelSpec<V>;
  if ("value" in spec) {
    check(spec.value, `${path}.value`);
    return { kind: "value", value: spec.value };
  }
  if ("series" in spec) {
    if (spec.series !== true)
      throw new TypeError(
        `${path}.series: expected true, the series' names through a scale; received ${JSON.stringify(spec.series)}`,
      );
    if (spec.scale === undefined)
      throw new TypeError(
        `${path}.scale: required, as the channel names series through a scale; give scale, the name of one of the chart's scales`,
      );
    const named = scales(spec.scale, `${path}.scale`);
    if (named === IDENTITY || named instanceof ChannelScale)
      throw new TypeError(
        `${path}.scale: "${spec.scale}" is ${named === IDENTITY ? "an identity scale" : "a channel scale, mapping numbers"}, which maps no series' names; name an ordinal scale`,
      );
    checkOutputs(named, check, path, owner);
    return { kind: "series", scale: named };
  }
  if ("field" in spec) {
    const given = spec.scale as string | IdentityScaleSpec | undefined;
    // The field first: a scale reads what is there; colors without one, its display colors.
    if (table?.has(spec.field) && given === undefined && table.kind(spec.field) === "number") {
      const colors = scale === "color" ? scales.colors?.(spec.field) : undefined;
      if (colors) {
        for (const one of colors.colors)
          check(one, `${path}.field (a color fields give "${spec.field}")`);
        return { kind: "display", field: spec.field, colors };
      }
      throw new TypeError(
        scale === "color"
          ? `${path}.field: field "${spec.field}" holds numbers, and fields give it no colors; name a channel scale (a scale of the ${owner}'s with a range), take its values as colors (scale: { type: "identity" }), or give ${keyPath("fields", spec.field)} thresholds or mappings with colors`
          : `${path}.field: field "${spec.field}" holds numbers, which ${name} reads through a channel scale (a scale of the ${owner}'s with a range) or as they are (scale: { type: "identity" }); give scale, or a category field`,
      );
    }
    const numbers = NUMBERS.includes(name);
    if (typeof given === "object" || !table?.has(spec.field)) {
      const field = categoryField(
        table,
        spec.field,
        `${path}.field`,
        numbers && typeof given === "object" ? "number" : "category",
        owner,
      );
      if (typeof given === "object") return { kind: "identity", field, numbers };
    }
    const named = scales(given ?? scale, `${path}.scale`, spec.field);
    if (named instanceof ChannelScale) {
      if (table?.kind(spec.field) === "category")
        throw Object.assign(
          new TypeError(
            `${path}.field: field "${spec.field}" holds categories, and "${named.name}" is a channel scale, which maps numbers; give a number field, or name a scale of categories`,
          ),
          { code: "field-type" },
        );
      // Times map as their epoch milliseconds.
      const field =
        table?.kind(spec.field) === "time"
          ? spec.field
          : categoryField(table, spec.field, `${path}.field`, "number", owner);
      // Its outputs at the domain's ends are what the channel draws.
      named.spec.range.forEach((output, i) => {
        check(output, `${owner} ${scalePath(named.name)}.range[${i}] (read by ${path})`);
      });
      const fraction = name === "opacity" || name === "fillOpacity";
      return { kind: "scaled", field, scale: named, limits: [0, fraction ? 1 : Infinity] };
    }
    if (named === IDENTITY) {
      const field = categoryField(
        table,
        spec.field,
        `${path}.field`,
        numbers ? "number" : "category",
        owner,
      );
      return { kind: "identity", field, numbers };
    }
    const field = categoryField(table, spec.field, `${path}.field`, "category", owner);
    checkOutputs(named, check, path, owner);
    if (named.name !== unread) named.read(table!, field);
    return { kind: "field", field, scale: named };
  }
  const { when, then, otherwise } = spec.condition;
  check(then, `${path}.condition.then`);
  if (otherwise !== undefined) check(otherwise, `${path}.condition.otherwise`);
  const at = `${path}.condition.when`;
  if (typeof when === "object" && when !== null && !Array.isArray(when)) {
    const rank = rankTest(table, when as RankSpec, scales, at);
    return { kind: "condition", when: (row) => rank.holds(row), rank, then, otherwise };
  }
  return { kind: "condition", when: predicate(table, when as Expression, at), then, otherwise };
}

/** A rank test of `table`'s field over the mark's rows, or an error at `path`. */
function rankTest(
  table: Table | undefined,
  test: RankSpec,
  scales: ScaleOf,
  path: string,
): RankRead {
  const top = "top" in test;
  if (top === "bottom" in test)
    throw new TypeError(
      top
        ? `${path}: a rank test takes top or bottom, not both; drop one`
        : `${path}: expected an expression, or a rank test ({ top, field } or { bottom, field }); received ${JSON.stringify(test)}`,
    );
  const count = (top ? test.top : test.bottom) as number;
  const side = top ? "top" : "bottom";
  if (!(Number.isInteger(count) && count >= 1))
    throw new TypeError(
      `${path}.${side}: expected a whole number of rows from 1; received ${JSON.stringify(count)}`,
    );
  if (typeof test.field !== "string")
    throw new TypeError(
      `${path}.field: expected the name of a number or time field; received ${JSON.stringify(test.field)}`,
    );
  if (table?.has(test.field) && table.kind(test.field) === "category")
    throw Object.assign(
      new TypeError(
        `${path}.field: field "${test.field}" holds categories; ranks are of numbers and times`,
      ),
      { code: "field-type" },
    );
  const field = table?.has(test.field)
    ? test.field
    : categoryField(table, test.field, `${path}.field`, "number");
  return scales.rank?.(field, count, top) ?? new Rank(() => wholeTable(table!), field, count, top);
}

/**
 * A scale's place in the chart's options: `scales.color`, or for a name
 * that is not an identifier, `scales["regions:v1"]`, which error paths keep whole.
 */
export function scalePath(name: string): string {
  return keyPath("scales", name);
}

/** A key's place under `option`: `fields.p99`, or `fields["p.99"]` for a key that is not an identifier. */
export function keyPath(option: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${option}.${key}` : `${option}[${JSON.stringify(key)}]`;
}

/** Checks that a scale's fixed outputs are what the channel at `path` takes. */
export function checkOutputs(
  scale: CategoryScale,
  check: Check,
  path: string,
  owner = "chart",
): void {
  const at = `${owner} ${scalePath(scale.name)}`;
  for (const [value, output] of Object.entries(scale.spec?.map ?? {}))
    check(output, `${at}.map[${JSON.stringify(value)}] (read by ${path})`);
  if (scale.spec?.unknown !== undefined)
    check(scale.spec.unknown, `${at}.unknown (read by ${path})`);
}

/**
 * A channel as rows read it, for the table's current version: which value
 * a row takes (`at`: a category's code + 1, 0 for none; a number field's
 * number), and how many there are where they are counted (`count`), for
 * numbering looks, and a row's output (undefined for none: the channel's
 * fallback).
 */
export interface RowReader<V> {
  readonly count: number;
  at(row: number): number;
  output(row: number): V | undefined;
}

const ONE = { count: 1, at: () => 0 };

/**
 * Reads `channel`'s rows of `table` (now: call again for each table
 * version), with `defaults` and `fallback` for values a scale leaves to
 * them. Values an identity scale reads are checked with `check`, at `path`,
 * as a row's output is first asked for: a row without one takes the
 * fallback; one present that the channel cannot draw is refused. A number
 * field's values are counted (`counted`) by a pass over the rows (the
 * `drawn` rows, where given), which readers of appended rows alone leave
 * out.
 */
export function rowReader<V>(
  channel: Channel<V> | undefined,
  table: ReadonlyTable,
  defaults: Defaults<V>,
  fallback: V,
  check: Check,
  path: string,
  counted = true,
  drawn?: Uint32Array,
): RowReader<V> {
  // The series' names are the series': rows of one series look alike.
  if (!channel || channel.kind === "series") return { ...ONE, output: () => undefined };
  if (channel.kind === "value") return { ...ONE, output: () => channel.value };
  if (channel.kind === "condition")
    return {
      count: 2,
      at: (row) => (channel.when(row) ? 1 : 0),
      output: (row) => (channel.when(row) ? channel.then : channel.otherwise),
    };
  if (channel.kind === "list") {
    // Values an entry's scale leaves unmapped give no output, so the next entry is read.
    const readers = channel.entries.map((entry, i) =>
      rowReader(entry, table, defaults, undefined as V, check, `${path}[${i}]`, false),
    );
    const output = (row: number) => {
      for (const reader of readers) {
        const out = reader.output(row);
        if (out !== undefined) return out;
      }
      return undefined;
    };
    // Rows' looks are their outputs, numbered as rows first take them.
    const ids = new Map<V, number>();
    const key = (row: number) => {
      const out = output(row);
      if (out === undefined) return Number.NaN;
      let id = ids.get(out);
      if (id === undefined) {
        id = ids.size;
        ids.set(out, id);
      }
      return id;
    };
    if (!counted) return { count: 0, at: key, output };
    return { ...numbered(key, drawn, table.length), output };
  }
  if (channel.kind === "scaled") {
    const values = table.numbers(channel.field as never);
    const of = scaledOutputs(channel);
    const output = (row: number) => of(values[row]!) as V | undefined;
    // Rows' looks are their outputs (a ramp's, its steps), so a ramp's
    // rows take at most its steps' looks.
    const step = channel.scale.colors ? channel.scale.colorSteps() : undefined;
    const key = step
      ? (row: number) => step(values[row]!)
      : (row: number) => (output(row) as number | undefined) ?? Number.NaN;
    if (!counted) return { count: 0, at: key, output };
    return { ...numbered(key, drawn, table.length), output };
  }
  if (channel.kind === "display") {
    const values = table.numbers(channel.field as never);
    const { colors, index } = channel.colors;
    // Rows' looks are their colors; missing values and those without one take the fallback.
    const at = (row: number) => Math.max(0, index(values[row]!));
    return { count: colors.length + 1, at, output: (row) => colors[at(row) - 1] as V | undefined };
  }
  if (channel.kind === "identity" && channel.numbers) {
    const values = table.numbers(channel.field as never);
    const output = (row: number) => {
      const value = values[row]!;
      if (Number.isNaN(value)) return undefined;
      return checked(check, value as V, `${path}.field (row ${table.identity(row)})`);
    };
    if (!counted) return { count: 0, at: (row) => values[row]!, output };
    // By value: outputs are checked as rows ask for them.
    return { ...numbered((row) => values[row]!, drawn, table.length), output };
  }
  const { codes, dictionary } = table.categories(channel.field as never);
  // Each value's output, as rows first ask for it.
  const outputs: (V | undefined)[] = [];
  return {
    count: dictionary.length + 1,
    at: (row) => codes[row]! + 1,
    output(row) {
      const code = codes[row]!;
      // Missing values take the color fields' displays give them, where they give one.
      if (code < 0)
        return channel.kind === "identity"
          ? undefined
          : ((channel.scale as { missing?(): string | undefined }).missing?.() as V | undefined);
      if (!(code in outputs)) {
        const value = dictionary[code]!;
        outputs[code] =
          channel.kind === "identity"
            ? checked(check, value as V, `${path}.field`)
            : channel.scale.output(value, defaults, fallback);
      }
      return outputs[code];
    },
  };
}

/**
 * Rows numbered as looks by `by`: each distinct key one of its own (from
 * 1; a row without one, NaN, 0), over the `drawn` rows or `length`.
 */
function numbered(
  by: (row: number) => number,
  drawn: Uint32Array | undefined,
  length: number,
): { count: number; at(row: number): number } {
  const numbers = new Map<number, number>();
  const count = drawn ? drawn.length : length;
  for (let k = 0; k < count; k++) {
    const key = by(drawn ? drawn[k]! : k);
    if (!Number.isNaN(key) && !numbers.has(key)) numbers.set(key, numbers.size + 1);
  }
  return { count: numbers.size + 1, at: (row) => numbers.get(by(row)) ?? 0 };
}
