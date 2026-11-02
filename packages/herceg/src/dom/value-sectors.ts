// A sunburst moving to changed values or another drill root
// (value-transition.ts): its sectors matched by item key (the path from the
// top), each moving its angles and ring depths, its radii following its
// depths through ring widths between the two scenes'. Through a drill, one
// projection places every sector of either scene in the other's partition:
// the new root's sector before (drilling in), or the old root's after
// (drilling out), maps angles and depths, so siblings squeeze to the edges
// and sectors entering the rings drawn slide in from outside them. Without
// one, a sector coming starts inside its nearest ancestor drawn in both,
// at its outer edge, and one going ends inside it. Labels move with their
// sectors, fading in or out where only one scene draws them. Frames are
// drawn, listed, and picked here, with the engine code the sunburst's
// record hands over (scene.ts SunburstKit).

import type { RingGeometry } from "../draw/rings.ts";
import type { ItemInfo, LayoutItem } from "../marks/layout-mark.ts";
import type {
  Geometry,
  LabelsGeometry,
  Sector,
  SectorNodes,
  SunburstSectors,
  SunburstShape,
  TextItem,
} from "../scene/scene.ts";

/** Where a sector is: its angles (fractions of the turn) and ring depths. */
interface Place {
  start: number;
  end: number;
  inner: number;
  outer: number;
}

/** A sunburst moving: per sector of both scenes, where it is, how opaque, and how shown its label at each end. */
export interface MovingSunburst {
  /** The new scene's record, which frames draw with. */
  next: SunburstSectors;
  /** The sector each draws: the new scene's, then those going. */
  sectors: readonly Sector[];
  /** Per sector: start, end, inner, outer, opacity, label shown, and how radial, at each end. */
  from: Float64Array;
  to: Float64Array;
  /** Where the sunburst is drawn at each end. */
  shapes: readonly [SunburstShape, SunburstShape];
}

const FIELDS = 7;

/** Angles as sunbursts draw them: radians clockwise from 12 o'clock. */
const START = -Math.PI / 2;
const TAU = 2 * Math.PI;

/** A fraction of the turn within one turn. */
const clamp = (fraction: number) => Math.min(1, Math.max(0, fraction));

/**
 * The radius of a ring depth (the middle disc from 0 to 1, the first ring
 * from 1 to 2) for a middle `hole` and rings `ring` wide, at most `radius`.
 */
function radiusOf({ radius, hole, ring }: SunburstShape): (depth: number) => number {
  return (depth) =>
    Math.min(radius, depth <= 1 ? Math.max(0, depth) * hole : hole + (depth - 1) * ring);
}

/** How many sectors a record draws. */
export function countOf({ sectors }: SunburstSectors): number {
  return "nodes" in sectors ? sectors.nodes.length : sectors.length;
}

/** A record's sectors: a frame's, or those of a scene's nodes. */
export function sectorsOf(record: SunburstSectors): readonly Sector[] {
  const { sectors, root } = record;
  if (!("nodes" in sectors)) return sectors;
  const { nodes, spans, depth, parent, fills, opacities, labels, above, key, info, item } =
    sectors as SectorNodes;
  // Parents' keys are their own sectors', made once.
  const keys = new Map<number, string>();
  const keyOf = (node: number) => {
    let made = keys.get(node);
    if (made === undefined) {
      made = key(node);
      keys.set(node, made);
    }
    return made;
  };
  return nodes.map((node): Sector => {
    const middle = node === 0;
    const up = parent[node]!;
    const label = labels.get(node);
    return {
      key: keyOf(node),
      // The middle's parent is its own in the whole tree; the first ring's, the middle.
      parent: middle ? above : up > 0 ? keyOf(up) : root,
      start: middle ? 0 : spans[node * 2]!,
      end: middle ? 1 : spans[node * 2 + 1]!,
      inner: middle ? 0 : depth[node]!,
      outer: middle ? 1 : depth[node]! + 1,
      fill: fills[node],
      opacity: opacities[node]!,
      label,
      shown: 1,
      radial: label?.turns ? 1 : 0,
      info: () => info(node),
      item: () => item(node),
    };
  });
}

function placeOf({ start, end, inner, outer }: Place): Place {
  return { start, end, inner, outer };
}

/**
 * Maps places of the old scene's partition into the new one's (`forth`)
 * and back, through a drill: undefined without one, or when neither root
 * is drawn in the other scene.
 */
function drillOf(
  was: Map<string, Sector>,
  is: Map<string, Sector>,
  shown: SunburstSectors,
  next: SunburstSectors,
): { forth: (place: Place) => Place; back: (place: Place) => Place } | undefined {
  if (shown.root === next.root) return undefined;
  // Into `inside`, the whole of the other partition: angles over its span, depths from its inner edge.
  const into =
    (inside: Place) =>
    (p: Place): Place => {
      const span = inside.end - inside.start || 1;
      return {
        start: (p.start - inside.start) / span,
        end: (p.end - inside.start) / span,
        inner: p.inner - inside.inner,
        outer: p.outer - inside.inner,
      };
    };
  const out =
    (inside: Place) =>
    (p: Place): Place => {
      const span = inside.end - inside.start;
      return {
        start: inside.start + p.start * span,
        end: inside.start + p.end * span,
        inner: p.inner + inside.inner,
        outer: p.outer + inside.inner,
      };
    };
  const deeper = next.root === undefined ? undefined : was.get(next.root);
  if (deeper) return { forth: into(deeper), back: out(deeper) };
  const higher = shown.root === undefined ? undefined : is.get(shown.root);
  if (higher) return { forth: out(higher), back: into(higher) };
  return undefined;
}

/**
 * Where `sector` would be in the other scene, inside its nearest ancestor
 * drawn in both (`self`: the scene it is of; `other`: the other), or the
 * shared root; collapsed at the ancestor's outer edge. Undefined for none.
 */
function within(
  sector: Sector,
  self: Map<string, Sector>,
  other: Map<string, Sector>,
  root: boolean,
): Place | undefined {
  let parent = sector.parent;
  let mine: Place | undefined;
  let theirs: Place | undefined;
  while (parent !== undefined) {
    const a = self.get(parent);
    const b = other.get(parent);
    if (a && b) {
      [mine, theirs] = [a, b];
      break;
    }
    parent = a?.parent;
    if (!a) break;
  }
  if (!mine && root) mine = theirs = { start: 0, end: 1, inner: 0, outer: 1 };
  if (!mine || !theirs) return undefined;
  const span = mine.end - mine.start || 1;
  const along = (f: number) =>
    theirs!.start + ((f - mine!.start) / span) * (theirs!.end - theirs!.start);
  const depth = theirs.outer + (sector.inner - mine.outer);
  return { start: along(sector.start), end: along(sector.end), inner: depth, outer: depth };
}

/** Where `sunburst` is drawn. */
function shapeOf({ cx, cy, radius, hole, ring }: SunburstShape): SunburstShape {
  return { cx, cy, radius, hole, ring };
}

/**
 * How the sunburst `shown` drew moves to `next`, drawing at most `budget`
 * sectors a frame; undefined when it would draw more.
 */
export function moveSunburst(
  shown: SunburstSectors,
  next: SunburstSectors,
  budget: number,
): { sunburst: MovingSunburst; moves: boolean } | undefined {
  // Neither scene's sectors are made past the budget.
  if (countOf(shown) > budget || countOf(next) > budget) return undefined;
  const [before, after] = [sectorsOf(shown), sectorsOf(next)];
  const was = new Map(before.map((sector) => [sector.key, sector]));
  const is = new Map(after.map((sector) => [sector.key, sector]));
  let going = 0;
  for (const { key } of before) if (!is.has(key)) going++;
  if (after.length + going > budget) return undefined;
  const drill = drillOf(was, is, shown, next);
  const root = shown.root === next.root;
  const sectors: Sector[] = [];
  const from: number[] = [];
  const to: number[] = [];
  const push = (
    sector: Sector,
    [a, b]: [Place, Place],
    [opacityA, opacityB]: [number, number],
    [shownA, shownB]: [number, number],
    [radialA, radialB]: [number, number],
  ) => {
    sectors.push(sector);
    from.push(a.start, a.end, a.inner, a.outer, opacityA, shownA, radialA);
    to.push(b.start, b.end, b.inner, b.outer, opacityB, shownB, radialB);
  };
  const shownOf = (sector: Sector | undefined) => (sector?.label ? sector.shown : 0);
  // A sector coming from the middle, or going there, of a scene that draws
  // nothing there (`center: false`) fades in or out.
  const middle = (sectors: readonly Sector[]) => sectors.some(({ inner }) => inner <= 0);
  const [middleBefore, middleAfter] = [middle(before), middle(after)];
  for (const sector of after) {
    const old = was.get(sector.key);
    // Coming: through the drill, inside its ancestor, or at once.
    const start = old
      ? placeOf(old)
      : (drill?.back(sector) ?? within(sector, is, was, root) ?? placeOf(sector));
    // Its label as drawn after, or before when only then, turning from how it lay before.
    const label = sector.label ?? old?.label;
    const radial: [number, number] = sector.label
      ? [old?.label ? old.radial : sector.radial, sector.radial]
      : [old?.radial ?? 0, old?.radial ?? 0];
    push(
      label === sector.label ? sector : { ...sector, label },
      [start, placeOf(sector)],
      [old?.opacity ?? (start.inner <= 0 && !middleBefore ? 0 : sector.opacity), sector.opacity],
      [shownOf(old), sector.label ? 1 : 0],
      radial,
    );
  }
  for (const sector of before) {
    if (is.has(sector.key)) continue;
    // Going: through the drill, or inside its ancestor; others go at once.
    const end = drill?.forth(sector) ?? within(sector, was, is, root);
    if (end)
      push(
        sector,
        [placeOf(sector), end],
        [sector.opacity, end.inner <= 0 && !middleAfter ? 0 : sector.opacity],
        [shownOf(sector), 0],
        [sector.radial, sector.radial],
      );
  }
  const sunburst: MovingSunburst = {
    next,
    sectors,
    from: Float64Array.from(from),
    to: Float64Array.from(to),
    shapes: [shapeOf(shown), shapeOf(next)],
  };
  const moves =
    sectors.length !== after.length ||
    (["cx", "cy", "radius", "hole", "ring"] as const).some((key) => shown[key] !== next[key]) ||
    sunburst.from.some((value, i) => value !== sunburst.to[i]);
  return { sunburst, moves };
}

/**
 * The sunburst at eased progress `t`: its geometry, the items it draws
 * (made when something reads them), and the item drawn at a point, as the
 * pointer reads it; the geometry keeps the frame's record, so a change
 * arriving then moves on from it.
 */
export function sunburstAt(
  moving: MovingSunburst,
  t: number,
): [Geometry[], () => readonly ItemInfo[], (px: number, py: number) => LayoutItem | undefined] {
  const { next, from, to } = moving;
  const mix = (k: number) => from[k]! + (to[k]! - from[k]!) * t;
  const sectors = moving.sectors.map((sector, i): Sector => {
    const k = i * FIELDS;
    return {
      ...sector,
      start: mix(k),
      end: mix(k + 1),
      inner: mix(k + 2),
      outer: mix(k + 3),
      opacity: mix(k + 4),
      shown: mix(k + 5),
      radial: mix(k + 6),
    };
  });
  // Where it is drawn moves too: breadcrumbs coming or going move its center and size.
  const [a, b] = moving.shapes;
  const mixed = (key: keyof SunburstShape) => a[key] + (b[key] - a[key]) * t;
  const shape: SunburstShape = {
    cx: mixed("cx"),
    cy: mixed("cy"),
    radius: mixed("radius"),
    hole: mixed("hole"),
    ring: mixed("ring"),
  };
  const drawn = [...next.crumbs, ...drawSectors(next, sectors, shape)];
  const record: SunburstSectors = { ...next, ...shape, sectors };
  const rings = drawn.find((mark) => mark.kind === "arc");
  if (rings) Object.assign(rings, { sectors: record });
  let placed: readonly ItemInfo[] | undefined;
  return [
    drawn,
    () => (placed ??= placedSectors(next, sectors, shape)),
    (px, py) => sectorAt(next, sectors, shape, px, py),
  ];
}

/**
 * The sectors and labels of the sunburst `record` describes as a frame
 * draws `sectors` at `shape`: angles and depths clamped as drawn, each
 * label moved (and turned, along the radius) with its sector's middle.
 */
export function drawSectors(
  { id, gap, ringGap, kit }: SunburstSectors,
  sectors: readonly Sector[],
  shape: SunburstShape,
): Geometry[] {
  const { cx, cy } = shape;
  const radius = radiusOf(shape);
  // Runs of one opacity and color, painted in order: those drawn later
  // are on top, as `sectorAt` reads them.
  const batches: { opacity: number; fill: string; arcs: number[] }[] = [];
  const labels: TextItem[] = [];
  // Inner sectors first, as rings are drawn, and in their order at one depth.
  const order = sectors.map((_, i) => i).sort((a, b) => sectors[a]!.inner - sectors[b]!.inner);
  for (const i of order) {
    const { start, end, inner, outer, fill, opacity, label, shown } = sectors[i]!;
    const [a0, a1] = [START + clamp(start) * TAU, START + clamp(end) * TAU];
    const r0 = inner <= 0 ? 0 : radius(inner) + ringGap / 2;
    const r1 = radius(outer) - ringGap / 2;
    const drawn = r1 > r0 && a1 > a0;
    if (fill !== undefined && drawn) {
      let batch = batches.at(-1);
      if (batch?.opacity !== opacity || batch.fill !== fill) {
        batch = { opacity, fill, arcs: [] };
        batches.push(batch);
      }
      batch.arcs.push(cx, cy, r0, r1, a0, a1);
    }
    // A sector shown nowhere (past the turn's end, as it squeezes out) shows no label.
    if (!label || !(shown > 0) || !drawn) continue;
    // Its middle, drawn into the center as it becomes it.
    const mid = (a0 + a1) / 2;
    const along = ((r0 + r1) / 2) * Math.min(1, Math.max(0, inner));
    const [x, y] = [cx + along * Math.cos(mid), cy + along * Math.sin(mid)];
    // Along the radius as far as `radial` says, upright at the frame's
    // angle (within a quarter turn of level), from its angle as drawn.
    const upright = (angle: number) => angle - Math.PI * Math.round(angle / Math.PI);
    const turn = sectors[i]!.radial * upright(mid) - (label.turns ? upright(label.angle) : 0);
    const [cos, sin] = [Math.cos(turn), Math.sin(turn)];
    for (const item of label.items) {
      const [dx, dy] = [item.x - label.x, item.y - label.y];
      const at = { x: x + cos * dx - sin * dy, y: y + sin * dx + cos * dy };
      const { box } = item;
      labels.push({
        ...item,
        ...at,
        angle: item.angle + (turn * 180) / Math.PI,
        opacity: (item.opacity ?? 1) * Math.min(1, shown),
        box: box && { ...box, x: box.x + at.x - item.x, y: box.y + at.y - item.y },
      });
    }
  }
  const geometry: Geometry[] = batches.map(({ opacity, fill, arcs }, k) => {
    const count = arcs.length / 6;
    const rings: RingGeometry = {
      kind: "arc",
      draw: kit.rings,
      key: `${id}-sunburst-moving-${k}`,
      arcs: Float32Array.from(arcs),
      count,
      colors: [fill],
      colorIndex: new Uint32Array(count),
      fillOpacity: opacity,
      gap,
      cuts: new Uint8Array(count).fill(kit.whole),
      ringGap,
    };
    return rings;
  });
  if (labels.length > 0) {
    const names: LabelsGeometry = {
      kind: "labels",
      draw: kit.labels,
      key: `${id}-sunburst-names`,
      items: labels,
    };
    geometry.push(names);
  }
  return geometry;
}

/**
 * The items of the sectors a frame draws (see `PanelItems`): not those past
 * the turn's end or squeezed to nothing between the gaps.
 */
function placedSectors(
  { ringGap, kit }: SunburstSectors,
  sectors: readonly Sector[],
  shape: SunburstShape,
): ItemInfo[] {
  const radius = radiusOf(shape);
  return sectors.flatMap(({ info, start, end, inner, outer }) => {
    const [a0, a1] = [START + clamp(start) * TAU, START + clamp(end) * TAU];
    const [r0, r1] = [radius(inner), radius(outer)];
    const painted = (inner <= 0 ? 0 : r0 + ringGap / 2) < r1 - ringGap / 2;
    return info && a1 > a0 && painted
      ? [{ ...info(), ...kit.sectorInfo(shape.cx, shape.cy, r0, r1, a0, a1) }]
      : [];
  });
}

/**
 * The item a frame draws at (px, py), as the pointer reads it: of sectors
 * there, the one painted last (the outermost, the last at one depth),
 * pointed at and outlined where it is drawn.
 */
export function sectorAt(
  { gap, ringGap, kit }: SunburstSectors,
  sectors: readonly Sector[],
  shape: SunburstShape,
  px: number,
  py: number,
): LayoutItem | undefined {
  const { cx, cy } = shape;
  const radius = radiusOf(shape);
  let found: LayoutItem | undefined;
  let depth = Number.NEGATIVE_INFINITY;
  for (const { item, fill, start, end, inner, outer } of sectors) {
    if (!item || fill === undefined || inner < depth) continue;
    const r0 = inner <= 0 ? 0 : radius(inner) + ringGap / 2;
    const r1 = radius(outer) - ringGap / 2;
    const [a0, a1] = [START + clamp(start) * TAU, START + clamp(end) * TAU];
    // The middle disc, whole, has no gap around it.
    const disc = inner <= 0 && a1 - a0 >= TAU;
    const angular = disc ? 0 : gap;
    if (!kit.inSector(px, py, cx, cy, r0, r1, a0, a1, angular)) continue;
    const outline = new kit.ArcPath();
    kit.traceSector(outline, cx, cy, r0, r1, a0, a1, angular);
    const [mid, along] = [(a0 + a1) / 2, disc ? 0 : (r0 + r1) / 2];
    found = {
      ...item(),
      px: cx + along * Math.cos(mid),
      py: cy + along * Math.sin(mid),
      outline: outline.d,
    };
    depth = inner;
  }
  return found;
}
