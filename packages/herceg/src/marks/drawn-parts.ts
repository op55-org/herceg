// What each primitive of a drawn-mark record draws (marks/drawn.ts): rows
// that bars and points record per primitive, a point cloud's positions,
// and through marks' own `partOf`, traces, groups, and annotations' rows.
// Pickers load this module; charts that draw without one never do.

import type { Table } from "../data/table.ts";
import { unmappable } from "../lod/m4.ts";
import { groupKey } from "../model/items.ts";
import type { PointGeometry } from "../scene/scene.ts";
import type { Curve } from "../spec/spec.ts";
import {
  type DrawnMark,
  type DrawnPart,
  madeIn,
  type PartBuilders,
  rowsOfDrawn,
  type TraceReading,
  tracedBy,
} from "./drawn.ts";
import type { Frame, Mark } from "./mark.ts";
import { copiesPoints, traceFrame, traceSeries } from "./orient.ts";
import { rowOf, type Series } from "./series.ts";
import { drawnRange } from "./trace.ts";

/**
 * What primitive `index` of `drawn.geometry[g]` draws, `mark` having drawn
 * it, followed back through copies to the geometry it was made in: the
 * row bars and points record for each, a cloud's row, a marker's
 * observation; what the mark says, where it says (`Mark.partOf`); else for
 * a line or area, a trace of its series along the mark's axis. Undefined
 * for primitives of no item.
 */
export function partOf(
  mark: Mark,
  drawn: DrawnMark,
  g: number,
  painted: number,
): DrawnPart | undefined {
  if (!drawn.geometry[g] || !(painted >= 0)) return undefined;
  const [geometry, index] = madeIn(drawn.geometry[g], painted);
  const rows = rowsOfDrawn(geometry);
  if (rows)
    return index < ((geometry as { count?: number }).count ?? 0)
      ? parts.row(drawn, geometry, mark.table!, rows[index]!)
      : undefined;
  const cloud = (geometry as PointGeometry).cloud;
  if (geometry.kind === "point" && cloud) {
    const position = cloud.start + index;
    if (position >= cloud.end) return undefined;
    // A cloud draws rows of its own (a highlight's), or its series' positions.
    const s = parts.seriesOf(drawn, geometry);
    const row = cloud.rows ? cloud.rows[position]! : s ? rowOf(s, position) : position;
    return parts.row(drawn, geometry, mark.table!, row);
  }
  const s = parts.seriesOf(drawn, geometry);
  const markers = s?.features?.markerRows?.(geometry);
  if (markers)
    return index < markers.length
      ? parts.row(drawn, geometry, mark.table!, markers[index]!)
      : undefined;
  if (mark.partOf) return mark.partOf(drawn, geometry, index, parts);
  const { frame } = drawn;
  const along = mark.tooltip;
  if (!s || !frame || (along !== "x" && along !== "y")) return undefined;
  // A highlight's selected values are traced from a masked copy of the series.
  const traced = tracedBy(geometry);
  if (geometry.kind === "area") {
    const stacked = Boolean((mark.spec as { stack?: unknown }).stack);
    const values = along === "x" ? frame.y : frame.x;
    const edges = traced ?? s;
    return tracePart(s, {
      along,
      frame,
      lower: along === "x" ? edges.y0 : edges.x0,
      lowZero: stacked && values.type === "log",
      traced,
    });
  }
  if (geometry.kind !== "line") return undefined;
  // Rows in bands are drawn in band order; a dodged series' shift moves no point out.
  const banded = frame[along].bandwidth !== undefined;
  const sorted = banded || (along === "x" ? s.sorted : (s.ySorted ?? false));
  const curve = (mark.spec as { curve?: Curve }).curve;
  return tracePart(s, { along, frame, unsorted: sorted ? undefined : { curve }, traced });
}

const parts: PartBuilders = {
  seriesOf(drawn, geometry) {
    const base = (geometry.of ?? geometry.key).split("\u0001")[0]!;
    return (
      drawn.series.find((s) => s.key === base) ??
      drawn.series.find((s) => s.key === base.slice(0, base.lastIndexOf("|")))
    );
  },
  row(drawn, geometry, table, row) {
    const s = parts.seriesOf(drawn, geometry);
    const position = s ? positionIn(s, row) : -1;
    return {
      kind: "row",
      table,
      position: row,
      series: s && position >= 0 ? { series: s, position } : undefined,
    };
  },
  annotation(drawn, table: Table | undefined, row) {
    return table
      ? { kind: "row", table, position: row }
      : { kind: "group", key: groupKey(drawn.mark, [], [row]) };
  },
  group(drawn, keyParts, names) {
    return { kind: "group", key: groupKey(drawn.mark, keyParts, names) };
  },
  trace: tracePart,
};

/** Where table row `row` is in `s`, or -1: by binary search where its rows ascend. */
function positionIn(s: Series, row: number): number {
  const { rows } = s;
  if (!rows) return row < s.length ? row : -1;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (rows[mid]! < row) lo = mid + 1;
    else hi = mid;
  }
  if (lo < s.length && rows[lo] === row) return lo;
  // A view's rows may be in an order of its own.
  for (let k = 0; k < s.length; k++) if (rows[k] === row) return k;
  return -1;
}

/**
 * The trace part of a line's or area's path drawing `s`: rows the series'
 * predicates keep and the frame can place, in runs nothing breaks, read
 * of the series as traced (`reading.traced`, else `s`).
 */
function tracePart(s: Series, reading: TraceReading): DrawnPart {
  const { along, frame, lower, lowZero, unsorted } = reading;
  const traced = reading.traced ?? s;
  const values = along === "x" ? frame.y : frame.x;
  // A value drawable on the axis of values: stacks on log axes draw zeros at its low end.
  const value = (v: number) => placeable(values, v) || (lowZero === true && v === 0);
  // Series hold the chart's x and y whichever way they run; positions in
  // bands are band indices, -1 for none.
  const drawable = (row: number) => {
    const x = traced.x[row]!;
    const y = traced.y[row]!;
    if (
      !(along === "x"
        ? frame.x.bandwidth !== undefined
          ? x >= 0
          : placeable(frame.x, x)
        : value(x))
    )
      return false;
    if (
      !(along === "y"
        ? frame.y.bandwidth !== undefined
          ? y >= 0
          : placeable(frame.y, y)
        : value(y))
    )
      return false;
    if (hidden(row)) return false;
    return lower === undefined || value(lower[row]!);
  };
  // Rows a break of the time axis hides: not drawn, but joining what is either side.
  const hidden = (row: number) => frame.x.breaks?.hides(s.x[row]!) === true;
  const kept = s.features?.drawn;
  const eligible = (row: number) => (kept ? kept(row) : true) && drawable(row);
  const ends = traced.features?.pathEnds?.(traced, frame);
  let positions: Int32Array | undefined;
  let worked = !unsorted;
  return {
    kind: "trace",
    series: s,
    along,
    eligible,
    sameRun(a, b) {
      let from = positionIn(s, a);
      let to = positionIn(s, b);
      if (from < 0 || to < 0) return false;
      if (from > to) [from, to] = [to, from];
      for (let k = from; k <= to; k++) {
        const row = rowOf(s, k);
        // Tracing passes over rows breaks hide, joining their neighbors.
        if (hidden(row)) continue;
        if (!eligible(row)) return false;
        if (k < to && ends?.(row, 1)) return false;
      }
      return true;
    },
    get positions() {
      if (!worked) positions = tracedPositions(traced, frame, along, unsorted!);
      worked = true;
      return positions;
    },
  };
}

function placeable(scale: Frame["x"], value: number): boolean {
  return Number.isFinite(value) && (scale.type !== "log" || value > 0);
}

/**
 * For a series traced unsorted (no level of detail), as `tracePath`
 * traces it: the position in the series of each point of its path, a
 * vertex a step inserts taking the position of the observation it leaves.
 * Undefined for monotone curves, copies of points (bands of a panel,
 * breaks along y), and series whose features trace them (`where` and
 * `continuity` add crossings).
 */
function tracedPositions(
  s: Series,
  frame: Frame,
  along: "x" | "y",
  { curve }: NonNullable<TraceReading["unsorted"]>,
): Int32Array | undefined {
  if (curve === "monotone" || s.features?.trace || copiesPoints(s, frame, along, true))
    return undefined;
  const view = traceFrame(frame, along, 0);
  const traced = traceSeries(s, frame, along, false);
  const steps = curve === "step" ? 2 : curve === "step-before" || curve === "step-after" ? 1 : 0;
  const xMap = view.x.mapping();
  const yMap = view.y.mapping();
  const [start, end] = drawnRange(traced, view);
  const out: number[] = [];
  // As polylineAll writes points: a value it cannot place ends the run.
  let previous = -1;
  for (let k = start; k < end; k++) {
    const row = rowOf(traced, k);
    const x = traced.x[row]!;
    if (xMap.breaks?.hides(x)) continue;
    if (unmappable(xMap, x) || unmappable(yMap, traced.y[row]!)) {
      previous = -1;
      continue;
    }
    if (previous >= 0) for (let step = 0; step < steps; step++) out.push(previous);
    out.push(k);
    previous = k;
  }
  return Int32Array.from(out);
}
