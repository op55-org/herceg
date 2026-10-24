// Channels compiled against a mark's table: a constant, a category field's
// values through an ordinal scale (by dictionary code, so reading a row is
// an array lookup), a field's values as they are (an identity scale's,
// checked as constants are), the series' names through a scale, or a
// condition on each row. Every output is checked against the channel that
// draws it (`outputProblem`, spec/channels.ts): a constant, a scale's map
// and `unknown`, used or not, and the values an identity scale reads.

import { compileExpression, type Expression } from "../../data/expression.ts";
import type { Table } from "../../data/table.ts";
import { type ChannelName, outputProblem } from "../../spec/channels.ts";
import type { ChannelSpec, IdentityScaleSpec } from "../../spec/encoding.ts";
import type { CategoryScale } from "./scales.ts";

export type Channel<V> =
  | { readonly kind: "value"; readonly value: V }
  | { readonly kind: "field"; readonly field: string; readonly scale: CategoryScale }
  /** A field's values as they are: a category field's by code, a number field's by row. */
  | { readonly kind: "identity"; readonly field: string; readonly numbers: boolean }
  /** The series' names through a scale (`{ series: true, scale }`). */
  | { readonly kind: "series"; readonly scale: CategoryScale }
  | {
      readonly kind: "condition";
      readonly when: (row: number) => boolean;
      readonly then: V;
      readonly otherwise: V;
    };

/**
 * Finds the chart's ordinal scales by name, making the default ones as
 * marks read them; a `field` read through the default "color" scale where
 * the chart declares none takes the colors of what its values stand for.
 * An identity scale of the chart's is `IDENTITY`.
 */
export type ScaleOf = (name: string, path: string, field?: string) => CategoryScale;

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

/** The check of `channel`'s outputs, with `isColor` telling colors (see `FeatureKit`). */
export function outputCheck(channel: ChannelName, isColor: (value: string) => boolean): Check {
  return (value, path) => {
    const problem = outputProblem(channel, value, isColor);
    if (problem)
      throw new TypeError(`${path}: expected ${problem}; received ${JSON.stringify(value)}`);
  };
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
        kind === "category"
          ? `${path}: field "${field}" holds ${held} values; channels read categories, through a scale`
          : `${path}: field "${field}" holds ${held} values; this channel's values are numbers, so name a number field`,
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
 * default.
 */
export function compileChannel<V>(
  spec: ChannelSpec<V>,
  table: Table | undefined,
  scales: ScaleOf,
  scale: string,
  check: Check,
  path: string,
  name: ChannelName = "color",
): Channel<V> {
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
    if (named === IDENTITY)
      throw new TypeError(
        `${path}.scale: "${spec.scale}" is an identity scale, which maps no series' names; name an ordinal scale`,
      );
    checkOutputs(named, check, path);
    return { kind: "series", scale: named };
  }
  if ("field" in spec) {
    const given = spec.scale as string | IdentityScaleSpec | undefined;
    // The field first: a scale reads what is there.
    if (table?.has(spec.field) && given === undefined && table.kind(spec.field) === "number")
      throw new TypeError(
        `${path}.field: field "${spec.field}" holds numbers, which ${name} reads as they are through scale: { type: "identity" }; give that, or a category field`,
      );
    const numbers = NUMBERS.includes(name);
    if (typeof given === "object" || !table?.has(spec.field)) {
      const field = categoryField(
        table,
        spec.field,
        `${path}.field`,
        numbers && typeof given === "object" ? "number" : "category",
      );
      if (typeof given === "object") return { kind: "identity", field, numbers };
    }
    const named = scales(given ?? scale, `${path}.scale`, spec.field);
    if (named === IDENTITY) {
      const field = categoryField(
        table,
        spec.field,
        `${path}.field`,
        numbers ? "number" : "category",
      );
      return { kind: "identity", field, numbers };
    }
    const field = categoryField(table, spec.field, `${path}.field`);
    checkOutputs(named, check, path);
    named.read(table!, field);
    return { kind: "field", field, scale: named };
  }
  const { when, then, otherwise } = spec.condition;
  check(then, `${path}.condition.then`);
  check(otherwise, `${path}.condition.otherwise`);
  return {
    kind: "condition",
    when: predicate(table, when, `${path}.condition.when`),
    then,
    otherwise,
  };
}

/**
 * A scale's place in the chart's options: `scales.color`, or for a name
 * that is not an identifier, `scales["regions:v1"]`, which error paths keep whole.
 */
export function scalePath(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `scales.${name}` : `scales[${JSON.stringify(name)}]`;
}

/** Checks that a scale's fixed outputs are what the channel at `path` takes. */
export function checkOutputs(scale: CategoryScale, check: Check, path: string): void {
  const at = `chart ${scalePath(scale.name)}`;
  for (const [value, output] of Object.entries(scale.spec?.map ?? {}))
    check(output, `${at}.map[${JSON.stringify(value)}] (read by ${path})`);
  if (scale.spec?.unknown !== undefined)
    check(scale.spec.unknown, `${at}.unknown (read by ${path})`);
}

/**
 * The channel a `color` short form names: a field of the table, or a
 * color (a name both is refused before, in compile.ts); a string that is
 * neither is refused.
 */
export function colorShortForm(
  value: string,
  table: Table | undefined,
  path: string,
  isColor: (value: string) => boolean,
): ChannelSpec<string> {
  if (table?.has(value)) return { field: value };
  if (isColor(value)) return { value };
  throw new Error(
    `${path}: "${value}" is neither a field nor a color; ${table ? `the table has ${fieldsOf(table)}` : "the mark has no table"}, and colors are hex, rgb(), hsl(), var(), or CSS names`,
  );
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
 * field's values are counted (`counted`) by a pass over the rows, which
 * readers of appended rows alone leave out.
 */
export function rowReader<V>(
  channel: Channel<V> | undefined,
  table: Table,
  defaults: readonly V[],
  fallback: V,
  check: Check,
  path: string,
  counted = true,
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
  if (channel.kind === "identity" && channel.numbers) {
    const values = table.numbers(channel.field as never);
    const output = (row: number) => {
      const value = values[row]!;
      if (Number.isNaN(value)) return undefined;
      check(value, `${path}.field (row ${table.rowOffset + row})`);
      return value as V;
    };
    if (!counted) return { count: 0, at: (row) => values[row]!, output };
    // Each distinct value is a look of its own.
    const numbered = new Map<number, number>();
    for (let row = 0; row < table.length; row++) {
      const value = values[row]!;
      if (!Number.isNaN(value) && !numbered.has(value)) numbered.set(value, numbered.size + 1);
    }
    return { count: numbered.size + 1, at: (row) => numbered.get(values[row]!) ?? 0, output };
  }
  const { codes, dictionary } = table.categories(channel.field as never);
  // Each value's output, as rows first ask for it.
  const outputs: (V | undefined)[] = [];
  return {
    count: dictionary.length + 1,
    at: (row) => codes[row]! + 1,
    output(row) {
      const code = codes[row]!;
      if (code < 0) return undefined;
      if (!(code in outputs)) {
        const value = dictionary[code]!;
        if (channel.kind === "identity") check(value, `${path}.field`);
        outputs[code] =
          channel.kind === "identity"
            ? (value as V)
            : channel.scale.output(value, defaults, fallback);
      }
      return outputs[code];
    },
  };
}

/**
 * Each dictionary code's output of a field channel, for the table's
 * current version: rows read their code's.
 */
export class CodeOutputs<V> {
  readonly #channel: Extract<Channel<V>, { kind: "field" }>;
  #table: Table | undefined;
  #version = -1;
  #outputs: V[] = [];

  constructor(channel: Extract<Channel<V>, { kind: "field" }>) {
    this.#channel = channel;
  }

  /** Each code's output, through the channel's scale with `defaults` and `fallback`. */
  read(table: Table, defaults: readonly V[], fallback: V): readonly V[] {
    if (this.#table !== table || this.#version !== table.version) {
      const { dictionary } = table.categories(this.#channel.field as never);
      this.#outputs = dictionary.map((value) =>
        this.#channel.scale.output(value, defaults, fallback),
      );
      this.#table = table;
      this.#version = table.version;
    }
    return this.#outputs;
  }
}
