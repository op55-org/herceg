// Points moving to changed values (value-transition.ts): matched by row
// identity or explicit key values, their centers moving with the scales,
// their encoded size, color, and opacity changing with them, and points that come or go
// growing from or shrinking to nothing. A key missing or shared by points
// of the series at either end matches nothing: those points show at once,
// on the frame's scales.

import type { PointGeometry, PointItems } from "../scene/scene.ts";
import { after, type Blend, before, blend, type ScaleMotion } from "./value-motion.ts";

/** A new point's match: none, so it grows from nothing, or none it may have, so it shows at once. */
const COMES = -1;
const AT_ONCE = -2;

/** One series' points as drawn, owned: centers, rows, and what they encode. */
export interface ShownPoints {
  kind: "points";
  count: number;
  /** x, y per point. */
  coords: Float32Array;
  /** Row identities or explicit key values, in drawing order. */
  ids: PointItems["ids"];
  key: PointItems["key"];
  table: object;
  generation: number;
  radius: number;
  radii: Float32Array | undefined;
  /** Indexes into `palette`: bytes, or floats for more colors than bytes hold. */
  tones: Uint8ClampedArray | Float32Array | undefined;
  palette: readonly string[] | undefined;
  /** Tones are a category field's colors, which change at once, not along a ramp. */
  categorical: boolean;
  opacities: Float32Array | undefined;
  symbols: Uint8ClampedArray | undefined;
}

/** A copy of a series' points with animation identity (not clouds or sampled points). */
export function copyPoints(mark: PointGeometry): ShownPoints | undefined {
  return pointsOf(mark, true);
}

/** A series' points, copied (`own`) or read in place for as long as the scene holds them. */
function pointsOf(mark: PointGeometry, own: boolean): ShownPoints | undefined {
  const { items, count } = mark;
  if (!items || mark.cloud) return undefined;
  const take = <T extends Float32Array | Float64Array | Uint8ClampedArray>(
    values: T | undefined,
    length = count,
  ): T | undefined => values && ((own ? values.slice(0, length) : values.subarray(0, length)) as T);
  return {
    kind: "points",
    count,
    coords: take(mark.coords, count * 2)!,
    ids:
      items.ids instanceof Float64Array
        ? take(items.ids)!
        : own
          ? items.ids.slice(0, count)
          : items.ids,
    key: items.key,
    table: items.table,
    generation: items.generation,
    radius: mark.radius,
    radii: take(mark.radii),
    tones: take(mark.colors?.index),
    palette: mark.colors?.palette,
    categorical: mark.colors?.categorical === true,
    opacities: take(mark.opacities),
    symbols: take(mark.symbols),
  };
}

/**
 * One series' points moving, those of the new scene in its order, then those
 * that went: per point its center before and after (x, y), and its radius,
 * color, and opacity before and after where they change.
 */
export interface MovingPoints {
  /** The geometry's place among its panel's. */
  index: number;
  mark: PointGeometry;
  /** The y scale the points are on. */
  side: "y" | "yRight";
  count: number;
  from: Float32Array;
  to: Float32Array;
  /** Before and after per point, side by side. */
  radii: Float32Array | undefined;
  tones: Float32Array | undefined;
  opacities: Float32Array | undefined;
  /** What a frame draws: centers, and radii, colors, opacities, and shapes where they vary. */
  out: Pick<PointGeometry, "coords" | "radii" | "colors" | "opacities" | "symbols">;
  /** Each point's key in frames, which a change arriving then moves on from. */
  items: PointItems;
}

/**
 * How `shown` moves to `mark`, its series in the new scene, along scales
 * moving as `x` and `y` do; undefined when its points cannot be matched to
 * their identity (a different key, an unkeyed reset, a cloud, sampled points) or
 * show them otherwise (other encodings or shapes). Points of rows that came
 * grow from nothing, and of rows that went shrink to nothing, where those
 * rows' values are, as they move with the scales.
 */
export function movePoints(
  index: number,
  shown: ShownPoints,
  mark: PointGeometry,
  side: "y" | "yRight",
  x: ScaleMotion,
  y: ScaleMotion,
  budget: number,
): { moving: MovingPoints; moves: boolean } | undefined {
  const next = pointsOf(mark, false);
  if (
    !next ||
    !sameIdentity(shown, next) ||
    !next.tones !== !shown.tones ||
    next.categorical !== shown.categorical ||
    !next.opacities !== !shown.opacities ||
    !next.symbols !== !shown.symbols ||
    !samePalette(next.palette, shown.palette)
  )
    return undefined;
  const was = indexOf(shown);
  const is = indexOf(next);
  // Keys missing or shared at either end match nothing, and their points show at once.
  const shared = was.shared.size + is.shared.size > 0;
  const unique = (key: number | string | undefined): key is number | string =>
    validKey(key) && !(shared && (was.shared.has(key) || is.shared.has(key)));
  // Each new point's match among those shown: its index, COMES, or AT_ONCE.
  const source = new Int32Array(next.count).fill(AT_ONCE);
  const taken = new Uint8Array(shown.count);
  let enters = 0;
  for (let j = 0; j < next.count; j++) {
    const key = next.ids[j];
    if (!unique(key)) continue;
    const i = was.at.get(key);
    if (i === undefined) {
      source[j] = COMES;
      enters++;
    } else {
      source[j] = i;
      taken[i] = 1;
    }
  }
  let exits = 0;
  for (let i = 0; i < shown.count; i++) if (!taken[i] && unique(shown.ids[i])) exits++;
  const count = next.count + exits;
  if (count > budget) return undefined;
  const from = new Float32Array(count * 2);
  const to = new Float32Array(count * 2);
  // Points that come or go change size, whether or not their sizes are encoded,
  // as do those of a frame where points came or went.
  const radii =
    next.radii || shown.radii || enters > 0 || exits > 0 ? new Float32Array(count * 2) : undefined;
  const tones = next.tones && new Float32Array(count * 2);
  const opacities = next.opacities && new Float32Array(count * 2);
  const symbols = next.symbols && new Uint8ClampedArray(count);
  // Each point's key in frames, so that a later change moves from them.
  const ids =
    next.ids instanceof Float64Array
      ? new Float64Array(count)
      : new Array<string | undefined>(count);
  const radiusOf = (points: ShownPoints, i: number) => points.radii?.[i] ?? points.radius;
  for (let j = 0; j < next.count; j++) {
    const i = source[j]!;
    const px = next.coords[j * 2]!;
    const py = next.coords[j * 2 + 1]!;
    to[j * 2] = px;
    to[j * 2 + 1] = py;
    ids[j] = next.ids[j] as never;
    if (radii) radii[j * 2 + 1] = radiusOf(next, j);
    if (tones) tones[j * 2 + 1] = next.tones![j]!;
    if (opacities) opacities[j * 2 + 1] = next.opacities![j]!;
    if (symbols) symbols[j] = next.symbols![j]!;
    if (i < 0) {
      // Where its values were on the scales before: from nothing, or at once as it is.
      from[j * 2] = before(x, px);
      from[j * 2 + 1] = before(y, py);
      if (radii && i === AT_ONCE) radii[j * 2] = radii[j * 2 + 1]!;
      if (tones) tones[j * 2] = next.tones![j]!;
      if (opacities) opacities[j * 2] = next.opacities![j]!;
      continue;
    }
    // A row whose point changed shape or category color is drawn otherwise: it does not move.
    if (symbols && shown.symbols![i] !== symbols[j]) return undefined;
    if (next.categorical && shown.tones![i] !== next.tones![j]) return undefined;
    from[j * 2] = shown.coords[i * 2]!;
    from[j * 2 + 1] = shown.coords[i * 2 + 1]!;
    if (radii) radii[j * 2] = radiusOf(shown, i);
    if (tones) tones[j * 2] = shown.tones![i]!;
    if (opacities) opacities[j * 2] = shown.opacities![i]!;
  }
  let k = next.count;
  for (let i = 0; i < shown.count; i++) {
    const key = shown.ids[i];
    if (taken[i] || !unique(key)) continue;
    ids[k] = key as never;
    // To nothing, where its values are on the scales after.
    const px = shown.coords[i * 2]!;
    const py = shown.coords[i * 2 + 1]!;
    from[k * 2] = px;
    from[k * 2 + 1] = py;
    to[k * 2] = after(x, px);
    to[k * 2 + 1] = after(y, py);
    radii![k * 2] = radiusOf(shown, i);
    if (tones) tones[k * 2] = tones[k * 2 + 1] = shown.tones![i]!;
    if (opacities) opacities[k * 2] = opacities[k * 2 + 1] = shown.opacities![i]!;
    if (symbols) symbols[k] = shown.symbols![i]!;
    k++;
  }
  const differs = (pairs: ArrayLike<number> | undefined) => {
    if (!pairs) return false;
    for (let p = 0; p < pairs.length; p += 2) if (pairs[p] !== pairs[p + 1]) return true;
    return false;
  };
  const moves =
    enters > 0 ||
    exits > 0 ||
    x.moves ||
    y.moves ||
    from.some((value, p) => value !== to[p]) ||
    differs(radii) ||
    differs(tones) ||
    differs(opacities);
  const out: MovingPoints["out"] = {
    coords: new Float32Array(count * 2),
    radii: radii && new Float32Array(count),
    colors: tones && {
      index: new Float32Array(count),
      palette: next.palette!,
      ...(next.categorical && { categorical: true as const }),
    },
    opacities: opacities && new Float32Array(count),
    symbols,
  };
  const items = { ...mark.items!, ids } as PointItems;
  const moving = { index, mark, side, count, from, to, radii, tones, opacities, out, items };
  return { moving, moves };
}

/** Each key's point, and the keys of more than one point, which match nothing. */
function indexOf(points: ShownPoints): {
  at: Map<number | string, number>;
  shared: Set<number | string>;
} {
  const at = new Map<number | string, number>();
  const shared = new Set<number | string>();
  for (let i = 0; i < points.count; i++) {
    const key = points.ids[i];
    if (!validKey(key)) continue;
    if (at.has(key)) shared.add(key);
    else at.set(key, i);
  }
  return { at, shared };
}

/** Explicit keys supersede row identity; neither side can silently change its key. */
function sameIdentity(a: ShownPoints, b: ShownPoints): boolean {
  if (a.key || b.key)
    return (
      a.key !== undefined &&
      b.key !== undefined &&
      a.key.field === b.key.field &&
      a.key.kind === b.key.kind
    );
  return a.table === b.table && a.generation === b.generation;
}

function validKey(key: number | string | undefined): key is number | string {
  return typeof key === "string" || (typeof key === "number" && Number.isFinite(key));
}

/** Colors of two continuous scales, alike when their colors are, whatever their domains. */
function samePalette(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (!a || !b) return a === b;
  return a === b || (a.length === b.length && a.every((color, i) => color === b[i]));
}

/** The points at eased progress `t`, with the frame's x and y scales. */
export function pointsAt(moving: MovingPoints, t: number, x: Blend, y: Blend): PointGeometry {
  const { mark, count, from, to, radii, tones, opacities, out } = moving;
  const coords = out.coords;
  for (let i = 0; i < count * 2; i += 2) {
    coords[i] = blend(x, from[i]!, to[i]!);
    coords[i + 1] = blend(y, from[i + 1]!, to[i + 1]!);
  }
  let radius = mark.radius;
  if (radii) {
    for (let i = 0; i < count; i++) {
      const r = radii[i * 2]! + (radii[i * 2 + 1]! - radii[i * 2]!) * t;
      out.radii![i] = r;
      if (r > radius) radius = r;
    }
  }
  if (tones) {
    // Colors move along the scale's ramp.
    const index = out.colors!.index;
    for (let i = 0; i < count; i++)
      index[i] = Math.round(tones[i * 2]! + (tones[i * 2 + 1]! - tones[i * 2]!) * t);
  }
  if (opacities) {
    for (let i = 0; i < count; i++)
      out.opacities![i] = opacities[i * 2]! + (opacities[i * 2 + 1]! - opacities[i * 2]!) * t;
  }
  return { ...mark, ...out, count, radius, items: moving.items };
}
