// Where the keyboard cursor stops in a panel, and how it steps through
// cells, read from what the panel's inspector drew. The interaction
// controller (dom/interaction.ts) uses these, handing in the code it shares
// with the chart (see `InteractionKit`), so that they load with it.

import type { placeAt, rowOf, Series, samePositions } from "../marks/series.ts";
import type { AxisInspection, Inspector } from "./inspect.ts";
import type { ChartModel } from "./model.ts";

/**
 * The series of a panel the keyboard stops at, in order. An inspection
 * along x (or y) reports every series with a point at exactly that place,
 * so series inspected along an axis share a stop when they share their
 * positions along it (several fields of one table); every other shown
 * series, each placed off that axis (read alone), and each inspected
 * point by point or cell by cell, is a stop of its own, as is every
 * series where the inspection reads one point (mode "nearest").
 */
export function keyboardStops(
  inspector: Inspector | undefined,
  same: typeof samePositions,
): Series[] {
  const shared: { axis: "x" | "y"; series: Series }[] = [];
  const alone = inspector?.mode === "nearest";
  return (inspector?.marks ?? []).flatMap(({ mark, visible: series }) =>
    series.filter((s) => {
      const axis = mark.tooltip;
      if (alone || (axis !== "x" && axis !== "y")) return true;
      const bound = mark.bound?.[axis];
      if (bound !== undefined && bound.kind !== "axis") return true;
      if (shared.some((p) => p.axis === axis && same(p.series, s, axis))) return false;
      shared.push({ axis, series: s });
      return true;
    }),
  );
}

/**
 * For series the keyboard reads cell by cell (heatmaps): the position of
 * the cell `columns` to the right and `rows` up from the one at `position`
 * in the series keyed `key`, as the panel draws them, or undefined when
 * there is none.
 */
export function stepCell(
  inspector: Inspector | undefined,
  key: string,
  position: number,
  columns: number,
  rows: number,
): number | undefined {
  const found = inspector?.marks.find(({ series }) => series.some((s) => s.key === key));
  const s = found?.series.find((part) => part.key === key);
  return s && found!.mark.stepCell?.(s, position, columns, rows, inspector!.frame);
}

/**
 * The axis a panel's data is placed along, which a cursor follows: y when
 * its marks are placed along y (horizontal bars), otherwise x.
 */
export function cursorAxis(inspectors: readonly (Inspector | undefined)[]): "x" | "y" {
  return inspectors.some((inspector) =>
    inspector?.marks.some(({ mark, series }) => mark.tooltip === "y" && series.length > 0),
  )
    ? "y"
    : "x";
}

/** What `inspectPosition` reads series with, handed in (see `InteractionKit`). */
export interface SeriesReaders {
  placeAt: typeof placeAt;
  rowOf: typeof rowOf;
}

/**
 * The field a position reads, a name or a coordinate's (`{ field }`,
 * `{ fraction: { field } }`, `{ px: { field } }`), as `rowField` reads it:
 * a copy, so that this module shares no code with the chart (see the top).
 */
function placedBy(position: unknown): unknown {
  if (typeof position !== "object" || position === null) return position;
  const coordinate = position as {
    field?: unknown;
    fraction?: { field?: unknown };
    px?: { field?: unknown };
  };
  return coordinate.field ?? (coordinate.fraction ?? coordinate.px)?.field;
}

/** Keys that step through a stop's points: by how many, or to its ends. */
const POINT_STEPS: Record<string, number> = {
  ArrowLeft: -1,
  ArrowRight: 1,
  Home: Number.NEGATIVE_INFINITY,
  End: Number.POSITIVE_INFINITY,
};

/**
 * Where a key (Left, Right, Page Up and Down, Home, End) moves the
 * keyboard cursor from position `current` of `series` (-1 arriving at it),
 * stepping through the points in order along the axis the series follows:
 * its positions' order, or on a category axis band by band (rows of one
 * band in theirs), as bars, boxes, and points are drawn whatever their
 * rows' order. A mark whose series are the axis' categories (box plots of
 * `x: "kind", series: "kind"`, bars colored by their x) draws them side by
 * side along it: the keys step through all of them, from series to series.
 */
export function stepPoint(
  inspector: Inspector,
  series: Series,
  current: number,
  key: string,
  { placeAt, rowOf }: SeriesReaders,
): { series: Series; position: number } {
  const owner = inspector.marks.find(({ series: all }) => all.includes(series));
  const axis = owner?.mark.tooltip === "y" ? "y" : "x";
  const field = owner?.mark.identity?.field;
  const spec = owner?.mark.spec as Record<string, unknown> | undefined;
  const parts =
    field !== undefined && placedBy(spec?.[axis]) === field && owner!.visible.includes(series)
      ? owner!.visible
      : [series];
  // The parts' points numbered one after another, and sorted by place where they are not in order.
  const starts: number[] = [];
  let length = 0;
  for (const part of parts) {
    starts.push(length);
    length += part.length;
  }
  let order: Uint32Array | undefined;
  if (parts.length > 1 || (owner?.frame ?? inspector.frame)[axis].type === "band") {
    const places = new Float64Array(length);
    let sorted = true;
    parts.forEach((part, i) => {
      for (let k = 0; k < part.length; k++) {
        const place = placeAt(part, axis, rowOf(part, k));
        const at = starts[i]! + k;
        places[at] = Number.isFinite(place) ? place : Number.POSITIVE_INFINITY;
        if (at > 0 && places[at]! < places[at - 1]!) sorted = false;
      }
    });
    if (!sorted) {
      order = new Uint32Array(length);
      for (let k = 0; k < length; k++) order[k] = k;
      order.sort((a, b) => (places[a]! < places[b]! ? -1 : places[a]! > places[b]! ? 1 : a - b));
    }
  }
  const own = starts[parts.indexOf(series)]!;
  const page = Math.max(1, Math.round(length / 10));
  const step = key === "PageUp" ? -page : key === "PageDown" ? page : (POINT_STEPS[key] ?? 0);
  let rank = current < 0 ? 0 : order ? order.indexOf(own + current) : own + current;
  // Right arrives at the first point; the other keys step from it.
  if (current >= 0 || key !== "ArrowRight") rank += step;
  rank = Math.min(length - 1, Math.max(0, rank));
  const at = order ? order[rank]! : rank;
  // The part holding point `at`: the last starting at or before it.
  let i = parts.length - 1;
  while (i > 0 && starts[i]! > at) i--;
  return { series: parts[i]!, position: at - starts[i]! };
}

/**
 * Inspects one point of a series, identified by its position, plus the
 * other visible series at its x (or its y, for marks inspected along y),
 * in panel `panel` (the first by default). The keyboard reads so, as it
 * must reach every point even where values repeat.
 */
export function inspectPosition(
  model: ChartModel,
  key: string,
  position: number,
  panel: string | undefined,
  { placeAt, rowOf }: SeriesReaders,
): AxisInspection | undefined {
  const at = panel ?? model.panels()[0]?.key;
  const inspector = at === undefined ? undefined : model.inspectorOf(at);
  if (!inspector) return undefined;
  const series = inspector.marks.flatMap(({ visible }) => visible);
  const ownerOf = (s: Series) => inspector.marks.find(({ series }) => series.includes(s))!;
  const anchor = series.find((s) => s.key === key);
  if (!anchor || position < 0 || position >= anchor.length) return undefined;
  const owner = ownerOf(anchor);
  const axis = owner.mark.tooltip === "y" ? "y" : "x";
  const value = placeAt(anchor, axis, rowOf(anchor, position));
  // A point placed off the axis (in a frame, on a scale of the chart's own) is read alone.
  const off = (s: Series) => {
    const bound = ownerOf(s).mark.bound?.[axis];
    return bound !== undefined && bound.kind !== "axis";
  };
  // The cursor needs a place along its axis; a point that is not drawn
  // there (a zero on a log axis, say) leaves the other series' points.
  const scale = (off(anchor) ? owner.frame : inspector.frame)[axis];
  if (!Number.isFinite(scale.map(value)) || (scale.type === "band" && value < 0)) return undefined;
  // Where the inspection reads one point (mode "nearest"), the cursor reads its series' alone.
  const along =
    inspector.mode === "nearest"
      ? [anchor]
      : series.filter((s) => ownerOf(s).mark.tooltip === axis && !off(s));
  const inspection = inspector.inspectAt(
    axis,
    value,
    along.includes(anchor) ? along : [anchor],
    undefined,
    anchor,
    position,
  );
  // Nothing drawn at this position: no tooltip rather than an empty one.
  if (inspection.points.length === 0) return undefined;
  return model.namesPanels ? { ...inspection, panel: at! } : inspection;
}
