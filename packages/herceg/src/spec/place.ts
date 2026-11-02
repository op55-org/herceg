// Portable placement types: where titles, legends, and other chart furniture
// go (`Place`), and where a point is (`Position`, a `Coordinate` on each
// axis). Pixels are CSS pixels.

/** A side of the chart or of a panel's plot. */
export type Side = "top" | "right" | "bottom" | "left";

/** A corner or the middle of an edge of a plot or of the chart, inside it. */
export type Inside =
  | "top-left"
  | "top"
  | "top-right"
  | "right"
  | "bottom-right"
  | "bottom"
  | "bottom-left"
  | "left";

/**
 * Outside the plots, on a side: in a track of its own, the room it takes
 * kept from the plots. With `scope: "chart"` (the default) it is beside the
 * whole figure, every panel included; with `scope: "panel"` beside the plot
 * of panel `panel` (the first one by default).
 */
export interface SidePlace {
  side: Side;
  /** Where along the side: its start (left or top), center, or end. */
  align?: "start" | "center" | "end";
  /** Pixels between it and what it is beside, more than the usual gap. */
  offset?: number;
  scope?: "chart" | "panel";
  /** With `scope: "panel"`, the key of the panel (a subplot's id, a facet's value). */
  panel?: string;
}

/**
 * Inside a plot, over what it draws, taking no room from it: at a corner or
 * the middle of an edge, `inset` pixels in (8 by default). With `scope:
 * "panel"` (the default) inside the plot of panel `panel` (the first one by
 * default); with `scope: "chart"`, inside the area every panel shares.
 */
export interface InsidePlace {
  inside: Inside;
  inset?: number;
  scope?: "chart" | "panel";
  /** With `scope: "panel"`, the key of the panel (a subplot's id, a facet's value). */
  panel?: string;
}

/** Where a guide goes: outside on a side, or inside a plot. */
export type Place = SidePlace | InsidePlace;

/**
 * A place along one axis. `data` is a value on a scale (a number, a time in
 * epoch milliseconds, or a category's value); `field` reads each row's
 * value; `fraction` is a share of a frame, 0 at its left or bottom and 1 at
 * its right or top, as in plots; `px` counts pixels from a frame's left or
 * top edge, down for y, as on screens. A fraction or pixel count may be
 * each row's value of a number field (`{ fraction: { field } }`), and
 * shares outside 0 to 1 are places beyond the frame, which clipping
 * decides about. `scale` names the scale of `data` and `field`: "x", "y",
 * "yRight", or a position scale of the chart's `scales` with no axis of
 * its own (by default the axis' own). `frame` is the box of `fraction` and
 * `px` ("plot" by default). `offset` moves the result by that many pixels,
 * right for x and down for y. Only `data` and `field` count toward a
 * scale's domain.
 */
export type Coordinate =
  | { data: number | string; scale?: string; offset?: number }
  | { field: string; scale?: string; offset?: number }
  | { fraction: number | { field: string }; frame?: Frame; offset?: number }
  | { px: number | { field: string }; frame?: Frame; offset?: number };

/**
 * A place each row of a mark of rows has along an axis, read from its own
 * value: a field on a scale (the axis' own by default), or a number field's
 * share of a frame or pixels from its edge, as in `Coordinate`.
 */
export type RowCoordinate =
  | { field: string; scale?: string; offset?: number }
  | { fraction: { field: string }; frame?: Frame; offset?: number }
  | { px: { field: string }; frame?: Frame; offset?: number };

/** A constant share of a frame or pixels from its edge: where furniture such as an inset is placed. */
export type FrameCoordinate =
  | { fraction: number; frame?: Frame; offset?: number }
  | { px: number; frame?: Frame; offset?: number };

/** The boxes `fraction` and `px` coordinates are measured in: a panel's plot, or the whole chart. */
export type Frame = "plot" | "chart";

/** A point: a coordinate on each axis, which may mix kinds (a data y at a fraction of the plot's width). */
export interface Position {
  x: AnnotationCoordinate;
  y: AnnotationCoordinate;
}

/** A place an annotation's point or span takes along an axis: a coordinate, or one on a layout item's box. */
export type AnnotationCoordinate = Coordinate | ItemCoordinate;

/**
 * One of a layout item's names, from the top: a category's value, or each
 * row's value of a category field of the mark placed by it.
 */
export type ItemName = string | { field: string };

/**
 * An item a layout mark (a pie, funnel, treemap, or sunburst) drew in the
 * panel: the mark's `id`, and the item's names from the top (a tree node's
 * path, a slice's or a stage's category).
 */
export interface ItemRef {
  mark: string;
  item: readonly ItemName[];
}

/**
 * A place along one axis on a layout item's box, as the frame drew it: its
 * start (left or top, the default), middle, or end, moved by `offset`
 * pixels, right for x and down for y. A row whose item is not drawn (none
 * of its names, hidden, or too small) is left out.
 */
export interface ItemCoordinate {
  item: ItemRef;
  at?: "start" | "center" | "end";
  offset?: number;
}

/** A point of a box: a corner, the middle of an edge, or its center. */
export type BoxAnchor =
  | "top-left"
  | "top"
  | "top-right"
  | "left"
  | "center"
  | "right"
  | "bottom-left"
  | "bottom"
  | "bottom-right";

/**
 * Text that follows a layout item: at the anchor `at` of its box, moved by
 * `offset` pixels right and down; its label's block is aligned to the
 * anchor (its top left corner at "top-left") unless its style says
 * otherwise.
 */
export interface ItemAnchor extends ItemRef {
  at: BoxAnchor;
  offset?: { x?: number; y?: number };
}
