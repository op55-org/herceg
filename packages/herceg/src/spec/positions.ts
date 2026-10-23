// Positions in one form. A mark's position options come as a field's name,
// a number (annotations), or a `Coordinate`; binding gives each one
// `PositionBinding`, so that placement, domains, inspection, and selection
// read every form alike. Rules every reader keeps:
// - A data binding projects through the scale it names, the instance its
//   panel's scope gives that scale; a frame binding is a share of its frame
//   (0 at its left or bottom, 1 at its right or top, shares beyond placing
//   outside it) or pixels from its left or top edge (down for y). `offset`
//   moves the result after projection, right for x and down for y.
// - Only data bindings count toward their scale's domain (annotations only
//   when they ask to), move with zoom and pan, and select rows by brushes.
// - A frame binding's field is a number field. A row whose position is
//   missing or not finite is not drawn, whatever binds it.
// - Tooltips, the keyboard, and events read a data binding's value as its
//   scale writes it, and a frame binding's field's value as a number.

import type { Coordinate, Frame } from "./place.ts";

/**
 * A position bound: on a scale (`data`) or in a frame, read from each
 * row's `field` or a constant `value`. `path` is the option it came from,
 * as the caller wrote it (`x`, `at.y`, `span[1]`), for messages.
 */
export type PositionBinding = { readonly path: string; readonly offset: number } & (
  | { readonly kind: "data"; readonly scale: string; readonly field: string }
  | { readonly kind: "data"; readonly scale: string; readonly value: number | string }
  | {
      readonly kind: "frame";
      readonly unit: "fraction" | "px";
      readonly frame: Frame;
      readonly field: string;
    }
  | {
      readonly kind: "frame";
      readonly unit: "fraction" | "px";
      readonly frame: Frame;
      readonly value: number;
    }
);

/**
 * `position` bound, at option `path`: a field's name or a number reads on
 * `scale` (the axis' own), as `{ field }` and `{ data }` without a scale of
 * their own do.
 */
export function bindPosition(
  position: string | number | Coordinate,
  path: string,
  scale: string,
): PositionBinding {
  if (typeof position === "string")
    return { kind: "data", scale, field: position, path, offset: 0 };
  if (typeof position === "number")
    return { kind: "data", scale, value: position, path, offset: 0 };
  const offset = position.offset ?? 0;
  if ("field" in position)
    return { kind: "data", scale: position.scale ?? scale, field: position.field, path, offset };
  if ("data" in position)
    return { kind: "data", scale: position.scale ?? scale, value: position.data, path, offset };
  const [unit, given] =
    "fraction" in position
      ? (["fraction", position.fraction] as const)
      : (["px", position.px] as const);
  const frame = position.frame ?? "plot";
  return typeof given === "number"
    ? { kind: "frame", unit, frame, value: given, path, offset }
    : { kind: "frame", unit, frame, field: given.field, path, offset };
}
