// Options the spec takes before Herceg draws them. Round 2 freezes its
// contracts first (the spec's types, the validator, the factories, and
// Python's builders) and its streams then add the behavior: R rendering,
// placement, and painting; C channels, labels, and legends; S export.
// Until a stream lands, a chart refuses its options here, by name, rather
// than ignoring them, and the stream deletes its entries as it adds each.

import { ChartError } from "../spec/errors.ts";
import type { Coordinate, Frozen } from "../spec/spec.ts";

/**
 * An option not drawn yet: its path in a mark's spec ("labels.content"),
 * the stream that adds it, what to do meanwhile, and which of its values
 * are refused (every value by default).
 */
export type Pending = readonly [
  path: string,
  stream: "R" | "C" | "S",
  instead: string,
  refused?: (value: unknown) => boolean,
];

/** Refuses the first of `pending` a `type` mark's `spec` sets. */
export function refusePending(spec: object, type: string, pending: readonly Pending[]): void {
  for (const [path, stream, instead, refused] of pending) {
    let value: unknown = spec;
    for (const key of path.split("."))
      value = (value as Record<string, unknown> | undefined)?.[key];
    if (value !== undefined && (!refused || refused(value)))
      throw new ChartError({
        code: "unsupported",
        path,
        message: `${type} ${path}: not drawn as given yet (round 2 stream ${stream} adds it); ${instead}`,
      });
  }
}

/** An object, not a list: a coordinate where fields were, or a channel object. */
export const OBJECT = (value: unknown): boolean =>
  typeof value === "object" && !Array.isArray(value);

/** Positions `keys` given as coordinates, which stream R places rows by. */
export function coordinates(...keys: readonly string[]): Pending[] {
  return keys.map((key) => [key, "R", "give a field", OBJECT]);
}

/**
 * A spec whose positions are fields, as marks of rows read them while
 * they refuse coordinates (`coordinates`).
 */
export type FieldPositions<S> = { readonly [K in keyof S]: Exclude<S[K], Frozen<Coordinate>> };

/**
 * Refuses marks painted out of their order (`zIndex` other than 0), which
 * stream R paints, and orders that are no finite number, for good.
 */
export function refuseZIndex(
  marks: readonly { readonly spec: { readonly zIndex?: number | undefined } }[],
): void {
  marks.forEach(({ spec: { zIndex } }, i) => {
    if (zIndex === undefined || zIndex === 0) return;
    const path = `marks[${i}].zIndex`;
    throw new ChartError(
      Number.isFinite(zIndex)
        ? {
            code: "unsupported",
            path,
            mark: i,
            message: `${path}: not drawn as given yet (round 2 stream R adds it); drop zIndex`,
          }
        : {
            code: "invalid-option",
            path,
            mark: i,
            message: `${path}: expected a finite number; received ${zIndex}`,
          },
    );
  });
}

/**
 * Refuses `verticalAlign`, which stream R draws, in the text styles of
 * `value` at `path`: a `style` or a role of one (a theme's, an axis', a
 * mark's label's), never under a scale's `map` of the user's own values.
 */
export function refuseVerticalAlign(value: unknown, path: string, keys: readonly string[]): void {
  if (Array.isArray(value))
    for (const [i, item] of value.entries()) refuseVerticalAlign(item, `${path}[${i}]`, keys);
  else if (value && Object.getPrototypeOf(value) === Object.prototype) {
    const style = value as Record<string, unknown>;
    if (style.verticalAlign !== undefined && keys.slice(-2).includes("style"))
      throw new ChartError({
        code: "unsupported",
        path: `${path}.verticalAlign`,
        message: `${path}.verticalAlign: not drawn as given yet (round 2 stream R adds it); drop verticalAlign`,
      });
    for (const key in style)
      if (key !== "map") refuseVerticalAlign(style[key], `${path}.${key}`, [...keys, key]);
  }
}
