// `color` on marks drawing series of summaries and observations (histograms,
// box plots, boxen plots, violins, error bars, rugs): as on lines, areas,
// and bars, a category field names the series, whose values color them,
// and a color is the mark's primary paint (a fill, or an error bar's or a
// rug's stroke). Map and 3D points tell colors from fields as these do
// (`pointColor`).

import type { Table } from "../data/table.ts";
import { refuseRamp } from "../scale/color.ts";
import { ChartError } from "../spec/errors.ts";
import { CATEGORY, requireField } from "./mark.ts";

/**
 * How marks tell colors from fields where the page cannot (CSS.supports):
 * as static output reads colors, the feature compiler's way there, which
 * static output sets as it loads (render/compilers.ts).
 */
export const staticColors: { isColor?(value: string): boolean } = {};

interface Colored {
  readonly type: string;
  readonly color?: string | undefined;
  readonly series?: string | undefined;
  readonly fill?: string | undefined;
  readonly stroke?: string | undefined;
}

/**
 * `spec` with its `color` read: a field's as its `series` (another series
 * field is refused), a color's as its `paint` unless that is set. A name
 * that is neither a field nor a color, or both, is refused where the
 * browser can tell colors (CSS.supports).
 */
export function colored<T extends Colored>(spec: T, table: Table, paint: "fill" | "stroke"): T {
  const { color, type } = spec;
  if (color === undefined) return spec;
  if (namesColor(type, color, table, `give series: "${color}", or ${paint}: "${color}"`))
    return spec[paint] === undefined ? { ...spec, [paint]: color } : spec;
  requireField(table, color, CATEGORY, `${type} color`);
  if (spec.series !== undefined && spec.series !== color)
    throw colorError(
      type,
      "colors the series, so it names their field; give series or color, or the same field for both",
    );
  return { ...spec, series: color };
}

/**
 * Whether `color`, a `type` mark's `color`, is a color rather than one of
 * `table`'s fields. A name that is neither, or both, is refused where
 * colors can be told: by the browser (CSS.supports), or as static output
 * reads them; `both` is how to say which.
 */
export function namesColor(type: string, color: string, table: Table, both: string): boolean {
  const css = globalThis.CSS?.supports("color", color) ?? staticColors.isColor?.(color);
  if (table.has(color)) {
    if (css) throw colorError(type, `"${color}" names both a field and a color; ${both}`);
    return false;
  }
  if (css === false)
    throw colorError(
      type,
      `"${color}" is neither a field nor a color; the table has ${table
        .fields()
        .map((f) => `"${f}"`)
        .join(", ")}, and colors are hex, rgb(), hsl(), var(), or CSS names`,
    );
  return true;
}

/**
 * How map and 3D points read their `color`: a number field's tones
 * (`tone`); a color, their fill unless `fill` is set; or the category field
 * naming their series. `what` names the points in messages.
 */
export function pointColor(
  spec: {
    readonly type: string;
    readonly color?: string | undefined;
    readonly series?: string | undefined;
    readonly fill?: string | undefined;
    readonly colors?: unknown;
    readonly colorDomain?: unknown;
    readonly colorMidpoint?: unknown;
  },
  table: Table,
  what: string,
): { tone?: string; fill?: string | undefined } {
  const { type, color, fill } = spec;
  if (color === undefined) return { fill };
  const css = namesColor(
    type,
    color,
    table,
    `give fill: "${color}" for the color, or rename the field`,
  );
  if (!css) requireField(table, color, ["number", "category"], `${type} color`);
  if (!css && table.kind(color) === "number") return { tone: color, fill };
  // A fill wins over the color, as on points along axes, ramp and all.
  if (fill === undefined)
    refuseRamp(
      spec,
      type,
      css
        ? "a ramp colors a number field"
        : `"${color}" is a category field, colored by the theme's palette`,
    );
  // Points color by one category field, their series': it gives their colors, legend entries, and hiding.
  if (!css && color !== spec.series && fill === undefined)
    throw colorError(
      type,
      `"${color}" holds categories, which color ${what} by series; leave series out (or give series: "${color}"), or color by a number field`,
    );
  return { fill: fill ?? (css ? color : undefined) };
}

const colorError = (type: string, message: string) =>
  new ChartError({ code: "invalid-option", path: "color", message: `${type} color: ${message}` });

/**
 * Refuses `color` on a mark that chooses its colors itself (`series`: by
 * series), as specs refuse it, for callers whose options have no types.
 */
export function refuseColor(options: object, type: string, series = false): void {
  if ((options as { color?: unknown }).color !== undefined)
    throw new ChartError({
      code: "invalid-option",
      path: "color",
      message: `${type} color: ${
        series
          ? "the mark colors by series; give series, the field naming them"
          : "the mark chooses its colors itself; remove it (fill or stroke, where it takes them, set one)"
      }`,
    });
}
