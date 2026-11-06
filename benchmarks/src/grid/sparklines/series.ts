// The sparkline benchmark's data, and its own drawing of a series (see
// benchmarks/README.md, "Sparklines"): 1,000 keys of 1,000 points each,
// interleaved in time order (a million series rows), each key's values a
// random walk; with gaps, every other value of each series missing. The
// competitors' cells draw with the functions here, written for the
// benchmark, not Herceg's: each key's rows in time order, M4 per
// device-pixel column with gaps narrower than a pixel joined (what Herceg's
// sparklines promise), and SVG path data rounded to a tenth of a pixel. The
// frame checks read each drawn row's last point against the row's series.

import { random } from "../../datasets.ts";

export const KEYS = 1000;
export const POINTS = 1000;
/** The sparkline column's width, and the box drawn in: inside 8 px of padding, 4 px from the top and bottom of a 28 px row. */
export const COLUMN = 160;
export const BOX = { width: COLUMN - 16, height: 28 - 9 } as const;
/** How far lines stay from the box's top and bottom, so a stroke at either end shows. */
export const PADDING = 1.5;

export interface Series {
  /** The keys' names: the grid rows' keys. */
  readonly names: string[];
  /** Each row's key, as an index into `names`, its x, and its y, up to `length`; room for ticks after. */
  readonly key: Int32Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  length: number;
  /** Each key's last value, which the next tick's walk starts from. */
  readonly last: Float64Array;
  readonly gaps: boolean;
  readonly pick: () => number;
}

/** Ticks a series has room for. */
export const TICKS = 100;

export function makeSeries(seed: number, gaps: boolean): Series {
  const pick = random(seed);
  const length = KEYS * POINTS;
  const room = KEYS * (POINTS + TICKS);
  const key = new Int32Array(room);
  const x = new Float64Array(room);
  const y = new Float64Array(room);
  const last = Float64Array.from({ length: KEYS }, () => 100 + pick() * 400);
  for (let i = 0; i < length; i++) {
    const k = i % KEYS;
    const t = Math.floor(i / KEYS);
    last[k] = Math.max(0, last[k]! + (pick() - 0.5) * 20);
    key[i] = k;
    x[i] = t;
    y[i] = gaps && t % 2 === 1 ? Number.NaN : last[k]!;
  }
  const names = Array.from({ length: KEYS }, (_, k) => `s${String(k).padStart(4, "0")}`);
  return { names, key, x, y, length, last, gaps, pick };
}

/** One tick's rows, a point of every key at time `time`, which the series takes in. */
export function tick(
  series: Series,
  time: number,
): { key: Int32Array; x: Float64Array; y: Float64Array } {
  const at = series.length;
  if (at + KEYS > series.x.length)
    throw new Error(`sparklines: no room for more than ${TICKS} ticks`);
  for (let k = 0; k < KEYS; k++) {
    const walked = Math.max(0, series.last[k]! + (series.pick() - 0.5) * 20);
    series.last[k] = walked;
    series.key[at + k] = k;
    series.x[at + k] = time;
    series.y[at + k] = series.gaps && time % 2 === 1 ? Number.NaN : walked;
  }
  series.length = at + KEYS;
  return {
    key: series.key.subarray(at, at + KEYS),
    x: series.x.subarray(at, at + KEYS),
    y: series.y.subarray(at, at + KEYS),
  };
}

/**
 * Each key's rows in time order, and its least, greatest, and last finite
 * values: what the competitors' cells read, and what frames are checked
 * against. Kept as rows arrive, as an application's code would.
 */
export class KeyIndex {
  readonly rows: number[][] = Array.from({ length: KEYS }, () => []);
  readonly low = new Float64Array(KEYS).fill(Number.POSITIVE_INFINITY);
  readonly high = new Float64Array(KEYS).fill(Number.NEGATIVE_INFINITY);
  readonly lastX = new Float64Array(KEYS).fill(Number.NaN);
  readonly lastY = new Float64Array(KEYS).fill(Number.NaN);
  /** The window: every row's x. */
  start = Number.POSITIVE_INFINITY;
  end = Number.NEGATIVE_INFINITY;
  #seen = 0;

  readonly series: Series;

  constructor(series: Series) {
    this.series = series;
    this.update();
  }

  /** Takes in the rows the series gained. */
  update(): void {
    const { key, x, y, length } = this.series;
    for (let i = this.#seen; i < length; i++) {
      const k = key[i]!;
      this.rows[k]!.push(i);
      const xv = x[i]!;
      if (xv < this.start) this.start = xv;
      if (xv > this.end) this.end = xv;
      const value = y[i]!;
      if (!Number.isFinite(value)) continue;
      if (value < this.low[k]!) this.low[k] = value;
      if (value > this.high[k]!) this.high[k] = value;
      this.lastX[k] = xv;
      this.lastY[k] = value;
    }
    this.#seen = length;
  }

  /** Where key `k`'s line ends in the box: its last value's point; null without one. */
  expected(k: number): readonly [number, number] | null {
    const lastY = this.lastY[k]!;
    if (Number.isNaN(lastY)) return null;
    const span = this.end - this.start;
    const x = span > 0 ? ((this.lastX[k]! - this.start) / span) * BOX.width : BOX.width / 2;
    const low = this.low[k]!;
    const high = this.high[k]!;
    const y =
      high > low
        ? BOX.height - PADDING - ((lastY - low) / (high - low)) * (BOX.height - 2 * PADDING)
        : BOX.height / 2;
    return [x, y];
  }

  /**
   * Key `k`'s line in the box at pixel ratio `ratio`: the first, lowest,
   * highest, and last point of each device-pixel column, runs broken where
   * a missing value falls between columns (NaN pairs between runs).
   */
  points(k: number, ratio: number): number[] {
    const { x, y } = this.series;
    const rows = this.rows[k]!;
    const out: number[] = [];
    const low = this.low[k]!;
    const high = this.high[k]!;
    if (!(low <= high)) return out;
    const span = this.end - this.start;
    const fx = span > 0 ? BOX.width / span : 0;
    const ox = span > 0 ? 0 : BOX.width / 2;
    const fy = high > low ? -(BOX.height - 2 * PADDING) / (high - low) : 0;
    const oy = high > low ? BOX.height - PADDING : BOX.height / 2;
    const push = (i: number) => out.push(ox + (x[i]! - this.start) * fx, oy + (y[i]! - low) * fy);
    let column = Number.NaN;
    let first = -1;
    let least = -1;
    let most = -1;
    let latest = -1;
    let gap = false;
    // In traversal order, as M4 keeps them.
    const emit = () => {
      const a = least < most ? least : most;
      const b = least < most ? most : least;
      push(first);
      if (a !== first && a !== latest) push(a);
      if (b !== first && b !== latest && b !== a) push(b);
      if (latest !== first) push(latest);
    };
    for (const i of rows) {
      const value = y[i]!;
      if (!Number.isFinite(value)) {
        gap = true;
        continue;
      }
      const c = Math.floor((ox + (x[i]! - this.start) * fx) * ratio);
      if (c !== column) {
        if (first >= 0) {
          emit();
          if (gap) out.push(Number.NaN, Number.NaN);
        }
        column = c;
        first = least = most = latest = i;
        gap = false;
        continue;
      }
      gap = false;
      latest = i;
      if (value < y[least]!) least = i;
      else if (value > y[most]!) most = i;
    }
    if (first >= 0) emit();
    return out;
  }
}

/** SVG path data of `points` (runs between NaN pairs), a lone point as a dot. */
export function svgPath(points: readonly number[]): string {
  const n = (value: number) => String(Math.round(value * 10) / 10);
  let d = "";
  let run = 0;
  for (let i = 0; i < points.length; i += 2) {
    const px = points[i]!;
    if (Number.isNaN(px)) {
      if (run === 1) d += "l0.02 0";
      run = 0;
      continue;
    }
    d += `${run === 0 ? "M" : "L"}${n(px)} ${n(points[i + 1]!)}`;
    run++;
  }
  if (run === 1) d += "l0.02 0";
  return d;
}

/** The last point of SVG path data; null for none. */
export function lastOfPath(d: string | null): readonly [number, number] | null {
  if (!d) return null;
  const at = Math.max(d.lastIndexOf("M"), d.lastIndexOf("L"));
  const match = /^(-?[\d.]+) (-?[\d.]+)(?:l0\.02 0)?$/.exec(d.slice(at + 1));
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** The last point of `points`; null for none. */
export function lastOfPoints(points: readonly number[]): readonly [number, number] | null {
  return points.length >= 2 ? [points[points.length - 2]!, points[points.length - 1]!] : null;
}

/** Whether a drawn line's end `got` is where the series says (`want`), within path data's rounding. */
export function ends(
  got: readonly [number, number] | null,
  want: readonly [number, number] | null,
) {
  if (!got || !want) return got === want;
  return Math.abs(got[0] - want[0]) <= 0.11 && Math.abs(got[1] - want[1]) <= 0.11;
}
