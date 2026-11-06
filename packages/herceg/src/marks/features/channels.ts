// What charts do with compiled channels (encoding/channels.ts) that grids
// do not: a list's series tail, the display colors a mark's legend lists,
// `color` short forms, outputs checked against every channel a mark draws
// (spec/channels.ts), and a field channel's outputs by dictionary code.

import type { Table } from "../../data/table.ts";
import { type Channel, type Check, fieldsOf } from "../../encoding/channels.ts";
import { type ChannelName, outputProblem } from "../../spec/channels.ts";
import type { ChannelSpec } from "../../spec/encoding.ts";

/**
 * A list's entries apart from the one ending it that colors the series
 * (`tail`: the series' names, or `series`, the mark's series field):
 * series take its output, and rows no other entry gives one. For a channel
 * that is not a list, itself and no tail.
 */
export function seriesTail<V>(
  channel: Channel<V> | undefined,
  series: string | undefined,
): [rows: Channel<V> | undefined, tail: Channel<V> | undefined] {
  if (channel?.kind !== "list") return [channel, undefined];
  const { entries } = channel;
  const last = entries[entries.length - 1]!;
  if (!(last.kind === "series" || (last.kind === "field" && last.field === series)))
    return [channel, undefined];
  const rest = entries.slice(0, -1);
  return [rest.length === 0 ? undefined : { kind: "list", entries: rest }, last];
}

/** The fields whose display colors `channel` reads, in a list's entries too. */
export function displayFields(channel: Channel<unknown> | undefined): string[] {
  if (channel?.kind === "display") return [channel.field];
  return channel?.kind === "list" ? channel.entries.flatMap(displayFields) : [];
}

/** The check of `channel`'s outputs, with `isColor` telling colors (see `FeatureKit`). */
export function outputCheck(channel: ChannelName, isColor: (value: string) => boolean): Check {
  return (value, path) => {
    const problem = outputProblem(channel, value, isColor);
    if (problem)
      throw new TypeError(`${path}: expected ${problem}; received ${JSON.stringify(value)}`);
  };
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
