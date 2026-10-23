// Channels in one form. A mark's channel options come in several: a
// constant (`fill: "#d62728"`), a field's name (`color: "region"`), a
// field through a scale (`{ field, scale }`, a scale of the chart's by name
// or `{ type: "identity" }`), the series' names through a scale, a
// condition, and the same in `encode`. Binding them gives each channel one
// `ChannelBinding`, which the feature compiler and the marks read, and
// keeps the option it came from for messages. Binding reads no scale: a
// field's binding names the scale it reads, or leaves the channel's default
// to be chosen where the chart's scales and the field's kind are known.
//
// Rules every reader keeps (see docs/architecture.md, "Channels"):
// - `fill` and `stroke` win over `color`, the primary paint.
// - A channel set directly and in `encode` is refused, as is a string that
//   is both a field of the table and an output (a color, a shape's name):
//   `{ field }` or `{ value }` says which.
// - Identity bindings infer no series and make no legend entries; their
//   values are the outputs, checked as constants are (`outputProblem`).
// - A row whose field has no value takes the channel's fallback (the
//   mark's own paint, the theme's muted color, no symbol drawn); a value
//   present but not an output is refused.
// - Size is area in square pixels. A mark's constant `radius` and a size
//   binding exclude each other.
// - A named scale's outputs (its `map` and `unknown`, used or not) are
//   checked against every channel reading it.

import type { Expression } from "../data/expression.ts";
import { SYMBOLS } from "../draw/symbol-shapes.ts";
import type { ChannelSpec, EncodingsSpec, SymbolName } from "./encoding.ts";
import { ChartError } from "./errors.ts";
import type { Dash, MarkSpec } from "./spec.ts";

/** What each channel's values are. */
export interface ChannelValues {
  color: string;
  fill: string;
  stroke: string;
  dash: Dash;
  symbol: SymbolName;
  strokeWidth: number;
  /** Area in square pixels. */
  size: number;
  opacity: number;
  fillOpacity: number;
}

export type ChannelName = keyof ChannelValues;

/**
 * The scale a field reads through: the channel's default for the field's
 * kind (chosen where the chart's scales are known), one of the chart's
 * `scales` by name, or none, its values being the outputs.
 */
export type ScaleBinding =
  | { readonly kind: "default" }
  | { readonly kind: "named"; readonly name: string }
  | { readonly kind: "identity" };

/**
 * A channel bound: a constant, a field through a scale, the series' names
 * through a named scale, or a condition choosing between two constants.
 * `path` is the option it came from, as the caller wrote it (`color`,
 * `encode.fill`, `symbol`), for messages.
 */
export type ChannelBinding<V> = { readonly path: string } & (
  | { readonly kind: "constant"; readonly value: V }
  | { readonly kind: "field"; readonly field: string; readonly scale: ScaleBinding }
  | { readonly kind: "series"; readonly scale: string }
  | {
      readonly kind: "condition";
      readonly when: Expression;
      readonly then: V;
      readonly otherwise: V;
    }
);

/** A mark's channels, each bound once. */
export type BoundChannels = {
  readonly [K in ChannelName]?: ChannelBinding<ChannelValues[K]>;
};

/**
 * The channels each mark takes: in `encode`, as options of their own whose
 * strings name a field or an output (`short`: `color: "region"` or
 * `color: "#d62728"`), and as options of their own that are constants
 * (`constant`: `stroke: "#d62728"`, `dash: [4, 2]`).
 */
export const MARK_CHANNELS: Readonly<
  Partial<
    Record<
      MarkSpec["type"],
      {
        readonly encode: readonly (keyof EncodingsSpec)[];
        readonly short: readonly ChannelName[];
        readonly constant: readonly ChannelName[];
      }
    >
  >
> = {
  line: {
    encode: ["color", "stroke", "dash", "strokeWidth", "opacity"],
    short: ["color"],
    constant: ["stroke", "strokeWidth", "dash", "opacity"],
  },
  area: {
    encode: ["color", "fill", "stroke", "opacity"],
    short: ["color"],
    constant: ["fill", "fillOpacity", "stroke", "strokeWidth", "opacity"],
  },
  bar: {
    encode: ["color", "fill", "stroke", "strokeWidth", "opacity"],
    short: ["color"],
    constant: ["fill", "fillOpacity", "stroke", "strokeWidth", "dash", "opacity"],
  },
  point: {
    encode: ["color", "fill", "stroke", "strokeWidth", "opacity", "symbol", "size"],
    short: ["color", "symbol", "size", "fillOpacity"],
    constant: ["fill", "stroke", "strokeWidth"],
  },
};

/**
 * How a mark's short forms read: whether a string names a field of its
 * table, and whether it is an output of the channel (a color, a shape's
 * name). Callers hand in what tells a color, so binding loads no CSS color
 * reader of its own.
 */
export interface ShortForms {
  hasField(name: string): boolean;
  isOutput(channel: ChannelName, value: string): boolean;
}

function refuse(path: string, problem: string): never {
  throw new ChartError({ code: "invalid-option", path, message: `${path}: ${problem}` });
}

/** A channel's object form bound, at `path`. */
function bindSpec<V>(spec: ChannelSpec<V>, path: string): ChannelBinding<V> {
  if ("value" in spec) return { kind: "constant", value: spec.value, path };
  if ("series" in spec) return { kind: "series", scale: spec.scale, path };
  if ("field" in spec) {
    const { scale } = spec;
    return {
      kind: "field",
      field: spec.field,
      scale:
        scale === undefined
          ? { kind: "default" }
          : typeof scale === "string"
            ? { kind: "named", name: scale }
            : { kind: "identity" },
      path,
    };
  }
  const { when, then, otherwise } = spec.condition;
  return { kind: "condition", when, then, otherwise, path };
}

/**
 * Binds the channels of a mark's `spec`: those it sets as options of its
 * own (`channels.short` and `channels.constant`) and in `encode`. A short
 * form's string reads as a field of the table or as an output (see
 * `ShortForms`); a channel set both ways, and a string both or neither,
 * are refused.
 */
export function bindChannels(
  spec: Readonly<Record<string, unknown>> & { readonly encode?: EncodingsSpec | undefined },
  channels: { readonly short: readonly ChannelName[]; readonly constant: readonly ChannelName[] },
  forms: ShortForms,
): BoundChannels {
  const bound: Partial<Record<ChannelName, ChannelBinding<unknown>>> = {};
  for (const name of channels.constant)
    if (spec[name] !== undefined) bound[name] = { kind: "constant", value: spec[name], path: name };
  for (const name of channels.short) {
    const value = spec[name];
    if (value === undefined) continue;
    if (typeof value === "object" && value !== null) {
      bound[name] = bindSpec(value as ChannelSpec<unknown>, name);
      continue;
    }
    if (typeof value !== "string") {
      bound[name] = { kind: "constant", value, path: name };
      continue;
    }
    const field = forms.hasField(value);
    const output = forms.isOutput(name, value);
    if (field && output)
      refuse(
        name,
        `"${value}" names a field and is a ${name === "symbol" ? "shape" : "color"} too; give { field: "${value}" } or { value: "${value}" }`,
      );
    if (!field && !output)
      refuse(
        name,
        `no field "${value}", and not a ${name === "symbol" ? "shape's name" : "color"}; name a field of the table, or give a ${name === "symbol" ? "shape" : "color"}`,
      );
    bound[name] = field
      ? { kind: "field", field: value, scale: { kind: "default" }, path: name }
      : { kind: "constant", value, path: name };
  }
  for (const [name, value] of Object.entries(spec.encode ?? {}) as [
    ChannelName,
    ChannelSpec<unknown>,
  ][]) {
    if (value === undefined) continue;
    if (bound[name]) refuse(`encode.${name}`, `set as ${name} and as encode.${name}; give one`);
    bound[name] = bindSpec(value, `encode.${name}`);
  }
  return bound as BoundChannels;
}

/** Whether `value` is a matplotlib dash style or a list of dash lengths. */
function isDash(value: unknown): boolean {
  return Array.isArray(value)
    ? value.every((n) => typeof n === "number" && n >= 0 && Number.isFinite(n))
    : value === "-" || value === "--" || value === ":" || value === "-.";
}

/**
 * Why `value` cannot be an output of `channel` (what the channel takes),
 * or undefined where it can: a constant, a condition's branch, a named
 * scale's `map` entry or `unknown`, or a row's value read through an
 * identity scale. `isColor` tells a CSS color.
 */
export function outputProblem(
  channel: ChannelName,
  value: unknown,
  isColor: (value: string) => boolean,
): string | undefined {
  switch (channel) {
    case "color":
    case "fill":
    case "stroke":
      return typeof value === "string" && isColor(value) ? undefined : "a CSS color";
    case "symbol":
      return SYMBOLS.includes(value as SymbolName) ? undefined : `a shape: ${SYMBOLS.join(", ")}`;
    case "dash":
      return isDash(value) ? undefined : 'a dash: "-", "--", ":", "-.", or pixel lengths';
    case "strokeWidth":
    case "size":
      return typeof value === "number" && value >= 0 && Number.isFinite(value)
        ? undefined
        : channel === "size"
          ? "an area of 0 or more square pixels"
          : "0 or more pixels";
    default:
      return typeof value === "number" && value >= 0 && value <= 1
        ? undefined
        : "a number from 0 to 1";
  }
}
