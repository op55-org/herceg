// Channels: what each mark takes, and what each channel draws. A mark's
// channel options come in several forms: a constant (`fill: "#d62728"`), a
// field's name (`color: "region"`), a field through a scale (`{ field,
// scale }`, a scale of the chart's by name or `{ type: "identity" }`), the
// series' names through a scale, a condition, and the same in `encode`.
// The feature compiler compiles each to one channel
// (marks/features/channels.ts), checking its outputs here, and the
// validator reads the table of the channels each mark takes in `encode`.
//
// Rules every reader keeps (see docs/architecture/marks.md, "Channels"):
// - `fill` and `stroke` win over `color`, the primary paint.
// - A channel set directly and in `encode` is refused, as is a string that
//   is both a field of the table and an output (a color, a shape's name):
//   `{ field }` or `{ value }` says which.
// - Identity scales infer no series and make no legend entries; their
//   values are the outputs, checked as constants are (`outputProblem`).
// - A row whose field has no value takes the channel's fallback (the
//   mark's own paint, the theme's muted color); points, which leave out
//   rows missing a value they encode, leave those out.
// - Size is area in square pixels. A mark's constant `radius` and a size
//   channel exclude each other.
// - A named scale's outputs (its `map` and `unknown`, used or not) are
//   checked against every channel reading it.

import { SYMBOLS } from "../draw/symbol-shapes.ts";
import type { EncodingsSpec, SymbolName } from "./encoding.ts";
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

/** The channels each mark takes in `encode`. */
export const MARK_CHANNELS: Readonly<
  Partial<Record<MarkSpec["type"], { readonly encode: readonly (keyof EncodingsSpec)[] }>>
> = {
  line: { encode: ["color", "stroke", "dash", "strokeWidth", "opacity"] },
  area: { encode: ["color", "fill", "stroke", "opacity"] },
  bar: { encode: ["color", "fill", "stroke", "strokeWidth", "opacity"] },
  point: { encode: ["color", "fill", "stroke", "strokeWidth", "opacity", "symbol", "size"] },
};

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
