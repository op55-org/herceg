// Which observation each point of a traced path is. Reducers name the
// position in the series traced of each point they keep (`PointSink`), and
// `Topology` the row each crossing of `where` arrives at (`crossingOwner`);
// a recorder writes the points on to the path and keeps their positions,
// -1 for points written to it otherwise. Markers read
// their rows from it, highlights where paths end (`PathEnds`), and labels
// following a series which observation owns their point (`TracedEdge`).

import type { NumericArray } from "../../data/column.ts";
import type { PointSink, Polyline } from "../../lod/polyline.ts";
import type { Series } from "../series.ts";
import type { TraceFrame } from "../trace.ts";

/**
 * A crossing of `where`'s place in a recorder's positions: below -1,
 * naming the position of the row the series arrives at through it; and
 * back, that position from its place.
 */
export function crossingOwner(position: number): number {
  return -2 - position;
}

/** The table row of position `k` of a series, or of a copy of its points (`sources`). */
export function tableRow(s: Series, k: number): number {
  return s.sources ? s.sources[k]! : s.rows ? s.rows[k]! : k;
}

/**
 * Writes the points reducers keep on to a path, keeping each one's
 * position in the series traced (a crossing's, `crossingOwner`), by the
 * point's index in the path (`positions`); points written to the path
 * otherwise are no observation's (-1). One records a trace at a time.
 */
export class Recorder implements PointSink {
  positions: Int32Array = new Int32Array(0);
  #path: Polyline | undefined;
  #buffer: (length: number) => Int32Array = (length) => new Int32Array(length);
  /** Points of the path whose positions are set. */
  #settled = 0;

  /**
   * Records the points written to `path` from now on, into buffers
   * `buffer` gives, of at least a length (`positionBuffer`: kept from
   * frame to frame).
   */
  start(path: Polyline, buffer: (length: number) => Int32Array): void {
    this.#path = path;
    this.#buffer = buffer;
    this.#settled = path.count;
    this.positions = buffer(path.count + 64);
  }

  push(x: number, y: number, position: number): void {
    const path = this.#path!;
    if (this.#settled < path.count) this.settle();
    this.#reserve(this.#settled + 1);
    path.push(x, y);
    this.positions[this.#settled++] = position;
  }

  break(): void {
    this.#path!.break();
  }

  /** Sets the positions of points written to the path since, by others: none. */
  settle(): void {
    const count = this.#path!.count;
    this.#reserve(count);
    this.positions.fill(-1, this.#settled, count);
    this.#settled = count;
  }

  #reserve(length: number): void {
    if (length <= this.positions.length) return;
    const grown = this.#buffer(length * 2);
    grown.set(this.positions.subarray(0, this.#settled));
    this.positions = grown;
  }
}

/**
 * Buffers of positions for a recorder of series `key`'s `stage` in
 * `frame`: its pooled floats, read as 32-bit integers, so a trace drawn
 * again reuses them.
 */
export function positionBuffer(
  frame: TraceFrame,
  key: string,
  stage: string,
): (length: number) => Int32Array {
  return (length) => {
    const floats = frame.floats(key, `${stage}-positions`, length);
    return new Int32Array(floats.buffer, floats.byteOffset, floats.length);
  };
}

/** The table rows that start runs of a path (`first`) and end them (`last`). */
export interface PathEnds {
  readonly first: ReadonlySet<number>;
  readonly last: ReadonlySet<number>;
}

/**
 * Where `path`, traced from `series` and recorded by `recorder`, stops: the
 * rows of the observations at its runs' ends. A run ending at a crossing
 * of `where` goes on past its last observation, which ends none.
 */
export function pathEnds(path: Polyline, recorder: Recorder, series: Series): PathEnds {
  recorder.settle();
  const { positions } = recorder;
  const first = new Set<number>();
  const last = new Set<number>();
  const runs = path.starts.length;
  for (let r = 0; r < runs; r++) {
    const [a, b] = [path.starts[r]!, path.runEnd(r) - 1];
    if (b < a) continue;
    if (positions[a]! >= 0) first.add(tableRow(series, positions[a]!));
    if (positions[b]! >= 0) last.add(tableRow(series, positions[b]!));
  }
  return { first, last };
}

/**
 * A series' edge as its last trace drew it, for labels following it
 * (attach.ts): the series as traced (positions as x, a copy's rows in
 * `sources`), the edge's values as drawn and a band's other edge, the
 * frame it was traced on (along y, x and y swapped, a dodged series'
 * shift in its positions' mapping), the path traced before steps and
 * curves, and each of its points' position in the series (as `Recorder`
 * keeps them).
 */
export interface TracedEdge {
  readonly series: Series;
  readonly values: NumericArray;
  readonly other: NumericArray | undefined;
  readonly frame: TraceFrame;
  readonly path: Polyline;
  readonly positions: Int32Array;
}
