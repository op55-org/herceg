// Bars moving to changed values (value-transition.ts), matched within their
// series by name (scene.ts BarItems): their `itemKey` value, else their
// position's. A matched bar moves along its position axis, in pixels on a
// category axis whose categories changed order and with the scale on a
// continuous one, and moves its root and tip with the value axis. Bars
// named by position grow from their root as they come and shrink to it as
// they go; bars named by `itemKey` come in and go out past the end of the
// position axis. A name shared by bars of the series at either end matches
// nothing: those bars show at once, on the frame's scales.

import type { BarItems, RectGeometry } from "../scene/scene.ts";
import { type Axis, after, type Blend, before, blend, type ScaleMotion } from "./value-motion.ts";

/**
 * One series' bars as drawn, owned: per bar its name, and where it starts
 * along the position axis, its thickness, root, and tip; which end is
 * rounded (draw/rect.ts), if any is.
 */
export interface ShownBars {
  kind: "bars";
  /** The geometry drawn, for the paint of bars whose series went: never its buffers, which later scenes write over. */
  mark: RectGeometry;
  horizontal: boolean;
  count: number;
  names: readonly (string | number)[];
  keyed: BarItems["keyed"];
  parts: Float32Array;
  ends: Uint8ClampedArray | undefined;
}

/** A copy of a bar geometry's bars, a scene's or a frame's. */
export function copyBars(mark: RectGeometry): ShownBars {
  const { count, rects } = mark;
  const { horizontal, names, keyed, span } = mark.bars!;
  // Bars stand along x, unless horizontal.
  const along = horizontal ? 1 : 0;
  const parts = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    parts[i * 4] = rects[i * 4 + along]!;
    parts[i * 4 + 1] = rects[i * 4 + 2 + along]!;
    parts[i * 4 + 2] = span[i * 2]!;
    parts[i * 4 + 3] = span[i * 2 + 1]!;
  }
  const ends = mark.rounded?.ends.slice(0, count);
  return {
    kind: "bars",
    mark,
    horizontal,
    count,
    names: names.slice(0, count),
    keyed,
    parts,
    ends,
  };
}

/**
 * One series' bars moving: per bar of both scenes, start along the
 * position axis, thickness, root, and tip at each end, and the rounded end
 * at each; with what a frame draws, and the record frames keep of them.
 */
export interface MovingBars {
  /** The geometry's place among its panel's; -1 for bars whose series went, drawn after the panel's geometry. */
  index: number;
  /** The geometry drawn: the new scene's, or for bars whose series went the old one's. */
  mark: RectGeometry;
  /** The scales bars stand on (`place`) and measure their lengths on (`along`). */
  place: Axis;
  along: Axis;
  count: number;
  from: Float32Array;
  to: Float32Array;
  rounded: Uint8ClampedArray | undefined;
  /** A frame's rectangles, rounded ends, and roots and tips. */
  rects: Float32Array;
  ends: Uint8ClampedArray | undefined;
  span: Float32Array;
  /** Each bar's name in frames, so that a later change moves from them. */
  names: (string | number)[];
  /** The names bars going had in the old scene, which their labels follow them by. */
  left: (string | number)[];
  /** Where keyed bars cross the position axis' end, at each end of the change. */
  keyed: BarItems["keyed"];
  end: readonly [number, number];
}

/** A bar's name made of its row identity (scene.ts NAMELESS), not imported so as to share no chunk. */
const nameless = (name: string | number) => typeof name === "string" && name[0] === "\u0000";

/** Each name's bar, and the names given to more than one, which match nothing. */
function indexOf(bars: ShownBars | undefined): {
  at: Map<string | number, number>;
  shared: Set<string | number>;
} {
  const at = new Map<string | number, number>();
  const shared = new Set<string | number>();
  for (let i = 0; i < (bars?.count ?? 0); i++) {
    const name = bars!.names[i]!;
    if (at.has(name)) shared.add(name);
    else at.set(name, i);
  }
  return { at, shared };
}

/**
 * How `shown` (undefined for a series that came) moves to `mark` (undefined
 * for one that went), on the panel's scales moving as `motions` say, the
 * bars on the y scale `side`; at most `budget` bars a frame. Undefined when
 * they cannot: turned the other way, or too many.
 */
export function moveBars(
  index: number,
  shown: ShownBars | undefined,
  mark: RectGeometry | undefined,
  motions: Record<Axis, ScaleMotion>,
  side: "y" | "yRight",
  budget: number,
): { moving: MovingBars; moves: boolean } | undefined {
  const next = mark?.bars ? copyBars(mark) : undefined;
  if (shown && next && shown.horizontal !== next.horizontal) return undefined;
  const { horizontal } = (next ?? shown)!;
  const place: Axis = horizontal ? side : "x";
  const along: Axis = horizontal ? "x" : side;
  const value = motions[along];
  const position = motions[place];
  const was = indexOf(shown);
  const is = indexOf(next);
  // Names of row identities match within one table generation only.
  const rows =
    shown?.keyed?.table === next?.keyed?.table &&
    shown?.keyed?.generation === next?.keyed?.generation;
  const shared =
    was.shared.size + is.shared.size > 0
      ? (name: string | number) => was.shared.has(name) || is.shared.has(name)
      : () => false;
  // Each new bar's match among those shown (-1 for none), and those matched.
  const source = new Int32Array(next?.count ?? 0).fill(-1);
  const taken = new Uint8Array(shown?.count ?? 0);
  for (let j = 0; j < source.length; j++) {
    const name = next!.names[j]!;
    if (shared(name) || (!rows && nameless(name))) continue;
    const i = was.at.get(name);
    if (i === undefined) continue;
    source[j] = i;
    taken[i] = 1;
  }
  // Bars that went and match nothing go; those of shared names, at once.
  const exits: number[] = [];
  for (let i = 0; i < taken.length; i++) if (!taken[i] && !shared(shown!.names[i]!)) exits.push(i);
  const count = source.length + exits.length;
  if (count > budget) return undefined;
  const keyed = next?.keyed ?? shown?.keyed;
  // Keyed bars come in from past the end the old scene drew and go out past the new one's.
  const end = [shown?.keyed?.end ?? keyed?.end ?? 0, next?.keyed?.end ?? keyed?.end ?? 0] as const;
  const outline = (mark ?? shown!.mark).edge?.width ?? 0;
  const past = (edge: number, thickness: number) =>
    keyed!.out > 0 ? edge + outline / 2 + 1 : edge - thickness - outline / 2 - 1;
  const from = new Float32Array(count * 4);
  const to = new Float32Array(count * 4);
  const ends = next?.ends ?? shown?.ends;
  const rounded = ends && new Uint8ClampedArray(count * 2);
  const names = new Array<string | number>(count);
  const left: (string | number)[] = [];
  let moves = exits.length > 0 || value.moves || position.moves;
  // Bars of the new scene in its order, then those that went, drawn last.
  for (let j = 0; j < source.length; j++) {
    const target = next!.parts.subarray(j * 4, j * 4 + 4);
    to.set(target, j * 4);
    names[j] = next!.names[j]!;
    const i = source[j]!;
    if (i >= 0) {
      from.set(shown!.parts.subarray(i * 4, i * 4 + 4), j * 4);
    } else {
      moves = true;
      // Where its values were on the scales before, so it shows at once with them.
      from[j * 4] = before(position, target[0]!);
      from[j * 4 + 1] = target[1]!;
      from[j * 4 + 2] = before(value, target[2]!);
      from[j * 4 + 3] = before(value, target[3]!);
      if (!shared(next!.names[j]!)) {
        // Coming: past the axis' end, or from its root.
        if (keyed) from[j * 4] = past(end[0], target[1]!);
        else from[j * 4 + 3] = from[j * 4 + 2]!;
      }
    }
    if (rounded) {
      rounded[j * 2] = (i >= 0 && shown!.ends?.[i]) || next!.ends?.[j] || 0;
      rounded[j * 2 + 1] = next!.ends?.[j] ?? 0;
    }
  }
  let k = source.length;
  for (const i of exits) {
    const source = shown!.parts.subarray(i * 4, i * 4 + 4);
    from.set(source, k * 4);
    to[k * 4] = after(position, source[0]!);
    to[k * 4 + 1] = source[1]!;
    to[k * 4 + 2] = after(value, source[2]!);
    to[k * 4 + 3] = after(value, source[3]!);
    // Going: past the axis' end, or to its root.
    if (keyed) to[k * 4] = past(end[1], source[1]!);
    else to[k * 4 + 3] = to[k * 4 + 2]!;
    const name = shown!.names[i]!;
    left.push(name);
    // A row identity of another generation names nothing in frames.
    names[k] = nameless(name) && !rows ? `\u0000-${k}` : name;
    if (rounded) rounded.fill(shown!.ends?.[i] ?? 0, k * 2, k * 2 + 2);
    k++;
  }
  if (!moves) for (let p = 0; p < count * 4 && !moves; p++) moves = from[p] !== to[p];
  const moving: MovingBars = {
    index,
    mark: (mark ?? shown!.mark) as RectGeometry,
    place,
    along,
    count,
    from,
    to,
    rounded,
    rects: new Float32Array(count * 4),
    ends: rounded && new Uint8ClampedArray(count),
    span: new Float32Array(count * 2),
    names,
    left,
    keyed,
    end,
  };
  return { moving, moves };
}

/**
 * Bars at eased progress `t`: their places on the frame's position scale
 * `position`, their roots and tips on its value scale `value`.
 */
export function barsAt(moving: MovingBars, value: Blend, position: Blend): RectGeometry {
  const { mark, count, from, to, rounded, rects, ends, span } = moving;
  const horizontal = moving.place !== "x";
  for (let i = 0; i < count; i++) {
    const at = i * 4;
    // Places and thicknesses mix as the scale's pixels do (its weights add to 1).
    const along = blend(position, from[at]!, to[at]!);
    const thickness = position.a * from[at + 1]! + position.b * to[at + 1]!;
    // Roots and tips move rather than tops and heights: a bar changing sign
    // shrinks to its root and grows on the other side.
    const root = blend(value, from[at + 2]!, to[at + 2]!);
    const tip = blend(value, from[at + 3]!, to[at + 3]!);
    span[i * 2] = root;
    span[i * 2 + 1] = tip;
    const low = Math.min(root, tip);
    const length = Math.abs(tip - root);
    rects[at] = horizontal ? low : along;
    rects[at + 1] = horizontal ? along : low;
    rects[at + 2] = horizontal ? length : thickness;
    rects[at + 3] = horizontal ? thickness : length;
    // The rounded end is at the tip: the new scene's once the tip has
    // passed to the side of the root it ends on, until then the old one's.
    if (ends) ends[i] = rounded![i * 2 + ((tip - root) * (to[at + 3]! - to[at + 2]!) > 0 ? 1 : 0)]!;
  }
  const corners = ends && { radius: mark.rounded?.radius ?? 0, ends };
  const { keyed, end } = moving;
  // Frames keep what scenes do, so a change arriving now moves from here.
  const bars: BarItems = {
    horizontal,
    names: moving.names,
    keyed: keyed && { ...keyed, end: blend(position, end[0], end[1]) },
    span,
  };
  return { ...mark, rects, count, rounded: corners, bars };
}
