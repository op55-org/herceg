// Where a `Coordinate` is on screen: a scale's value, a share of a frame,
// pixels from its edge, or an edge of a layout item's box, then moved by
// its offset. Scales and items stay outside this module: the caller says
// where a value is on a named scale, and which box an item has.

import type { Rect } from "../scene/scene.ts";
import type { Coordinate, ItemCoordinate, ItemRef, Position } from "../spec/place.ts";

/** What coordinates are resolved against. */
export interface PositionContext {
  /** The plot the coordinates belong to, and the chart around it. */
  plot: Rect;
  chart: Rect;
  /** The scales of plain coordinates on each axis, such as "x" and "y" (or "yRight"). */
  scales: { x: string; y: string };
  /**
   * The pixel of `value` on scale `scale` along its axis; undefined where
   * the scale has no such value (a missing category, a value it cannot show).
   */
  at(scale: string, value: number | string): number | undefined;
  /** The value of field `field` of the row being placed; undefined when it has none. */
  field?(field: string): number | string | undefined;
  /** The box of the item `item` names for the row being placed; undefined where none is drawn. */
  box?(item: ItemRef): Rect | undefined;
}

/**
 * The pixel of `coordinate` along `axis`: x from the left, y from the top.
 * Fractions run up from a frame's bottom as plots do; pixels run down from
 * its top as screens do. Undefined when a value or field has no place.
 */
export function coordinateAt(
  coordinate: Coordinate | ItemCoordinate,
  axis: "x" | "y",
  context: PositionContext,
): number | undefined {
  let at: number | undefined;
  if ("item" in coordinate) {
    const box = context.box?.(coordinate.item);
    if (!box) return undefined;
    const [start, length] = axis === "x" ? [box.x, box.width] : [box.y, box.height];
    const { at: edge } = coordinate;
    at = start + (edge === "end" ? length : edge === "center" ? length / 2 : 0);
  } else if ("data" in coordinate)
    at = context.at(coordinate.scale ?? context.scales[axis], coordinate.data);
  else if ("field" in coordinate) {
    const value = context.field?.(coordinate.field);
    at =
      value === undefined ? undefined : context.at(coordinate.scale ?? context.scales[axis], value);
  } else {
    const box = coordinate.frame === "chart" ? context.chart : context.plot;
    const [start, length] = axis === "x" ? [box.x, box.width] : [box.y, box.height];
    const given = "fraction" in coordinate ? coordinate.fraction : coordinate.px;
    // A share or pixels a field gives (`{ fraction: { field } }`): the row's.
    const share = typeof given === "number" ? given : context.field?.(given.field);
    if (typeof share !== "number" || !Number.isFinite(share)) return undefined;
    at =
      "fraction" in coordinate
        ? start + (axis === "x" ? share : 1 - share) * length
        : start + share;
  }
  return at === undefined ? undefined : at + (coordinate.offset ?? 0);
}

/** The point of `position`, or undefined when either coordinate has no place. */
export function positionAt(
  position: Position,
  context: PositionContext,
): { x: number; y: number } | undefined {
  const x = coordinateAt(position.x, "x", context);
  const y = coordinateAt(position.y, "y", context);
  return x === undefined || y === undefined ? undefined : { x, y };
}
