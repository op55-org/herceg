// Moving marks from the values a chart showed to changed ones (`animation:
// { values: true }`): bars, pie slices, a gauge's value, points, small
// lines and areas, lists drawn in row order (error bars, candles, regions,
// text), and heatmaps' cells, in every panel, with the axes when the change
// moves their domains. Charts load this module only when they ask for it.
// The data is current at once; what moves is a picture of the change. When
// a table's values change, the chart keeps a copy of what is on screen,
// matched by identity to the next scene's; frames between draw that scene
// with its marks, axes, and grid lines between the two. A change that moves
// a plot, the bands, or anything that cannot move with the axes, or that
// adds or drops rows, shows at once.

import type { TableChange } from "../data/table.ts";
import type { MeasureText } from "../layout/text.ts";
import type { Mark, MarkKey } from "../marks/mark.ts";
import type { planAxis } from "../model/axis.ts";
import type { axisGuide } from "../model/axis-guide.ts";
import type { ChartConfig, ChartModel, DrawnPanel } from "../model/model.ts";
import type {
  ArcGeometry,
  AreaGeometry,
  AxisGuide,
  GaugeDial,
  Geometry,
  LabelsGeometry,
  LineGeometry,
  Panel,
  PieSlice,
  PieSlices,
  PointGeometry,
  RasterGeometry,
  Rect,
  RectGeometry,
  RuleGeometry,
  Scene,
  TextGeometry,
} from "../scene/scene.ts";
import type { AnimationSpec } from "../spec/spec.ts";
import { lastFrameTime } from "./scheduler.ts";
import {
  copyList,
  copyRaster,
  listAt,
  listed,
  type MovingList,
  type MovingRaster,
  moveList,
  moveRaster,
  rasterAt,
  type ShownList,
  type ShownRaster,
} from "./value-items.ts";
import {
  type AxesMotion,
  type Axis,
  after,
  axesAt,
  type Blend,
  before,
  blend,
  blendAt,
  motionOf,
  plannable,
  type ScaleMotion,
} from "./value-motion.ts";
import {
  copyPoints,
  type MovingPoints,
  movePoints,
  pointsAt,
  type ShownPoints,
} from "./value-points.ts";
import {
  copyRule,
  copyTrace,
  type Lines,
  type MovingRule,
  type MovingStack,
  type MovingTrace,
  moveRule,
  moveStacks,
  moveTrace,
  ruleAt,
  type ShownRule,
  type ShownTrace,
  stackAt,
  traceAt,
} from "./value-traces.ts";

/**
 * Code of the chart's own that value transitions build with: axis plans,
 * polylines, and monotone curves. The chart passes it in, as this module
 * loads apart: bundlers such as esbuild move code that both import into
 * chunks of their own, which compress worse than the chart's bundle they
 * come from.
 */
export interface Builders extends Lines {
  planAxis: typeof planAxis;
  axisGuide: typeof axisGuide;
  /** How the chart measures text, for labels' boxes. */
  measure: MeasureText;
}

/** How long a change takes without a `duration`, in milliseconds. */
const DURATION = 250;
/**
 * Charts whose frames take longer than this, in milliseconds, alone or with
 * every chart drawing beside them, show changes at once (as views do).
 */
const SLOW_FRAME = 10;
/**
 * Bars, slices, and rules at most in either scene of a change: more show
 * it at once. Each frame rebuilds their paths, which at this many takes
 * about a millisecond (docs/architecture/rendering.md, "Animated values").
 * Marks bound each series' bars
 * alike (scene.ts MOVING_BARS, which this module does not import, so as to
 * share no chunk with the chart's bundle).
 */
export const MOVING_ITEMS = 2000;
/**
 * Points at most in a frame, including exits: a frame of this many takes
 * less JavaScript than drawing the change at once, and the copies about 40
 * bytes a point (docs/architecture/rendering.md, "Animated values"). Marks
 * bound each series alike
 * (scene.ts MOVING_POINTS).
 */
export const MOVING_POINTS = 10_000;
/**
 * Points of lines, areas, and other geometry at most in either scene of a
 * change (docs/architecture/rendering.md, "Animated values").
 */
export const MOVING_VERTICES = 10_000;

/**
 * One series' bars as drawn, owned: per bar its position, and along,
 * thickness, root, tip; and which end is rounded (draw/rect.ts), if any is.
 */
interface ShownBars {
  kind: "bars";
  horizontal: boolean;
  count: number;
  at: Float64Array;
  parts: Float32Array;
  ends: Uint8ClampedArray | undefined;
}

/** A pie as drawn: its slices are made afresh for each scene, so they are kept as they are. */
interface ShownPie {
  items: readonly PieSlice[];
  ends: Float64Array;
  r: number;
  labeled: boolean;
}

/**
 * What can move of one geometry as drawn: a series' bars, points, line, or
 * area, a rule, a list drawn in row order, or a raster.
 */
type ShownItem = ShownBars | ShownPoints | ShownTrace | ShownRule | ShownList | ShownRaster;

/** What a chart showed when its data changed: where a change of values starts. */
export interface Shown {
  /** When the change was made; it moves from then. */
  time: number;
  /** Milliseconds copying it took, which count toward the first frame. */
  cost: number;
  /** The theme: a change of it shows at once. */
  theme: Scene["theme"];
  /** What each panel showed, in the scene's order: a change bringing or taking away panels shows at once. */
  panels: ShownPanel[];
}

/** What one panel showed when its chart's data changed. */
interface ShownPanel {
  /** The panel's key and plot: a change moving either shows at once. */
  key: string;
  plot: Rect;
  /** The scales and axes the marks were drawn with; undefined for a layout mark's. */
  panel: DrawnPanel | undefined;
  /** The axes drawn: one that moves keeps its labels or its lack of them. */
  axes: readonly AxisGuide[];
  /** Copies of what can move, by geometry key. */
  items: Map<string, ShownItem>;
  /**
   * Keys of the geometry that can move, copied or not: a change that brings
   * or takes away any shows at once.
   */
  keys: Set<string>;
  pie: ShownPie | undefined;
  /** A gauge's value as drawn. */
  dial: number | undefined;
}

/**
 * One series' bars moving: per bar of both scenes, along, thickness, root,
 * and tip at each end, and the rounded end at each.
 */
interface MovingBars {
  /** The geometry's place among its panel's. */
  index: number;
  mark: RectGeometry;
  /** The scale bars' lengths are on: x for horizontal bars. */
  along: Axis;
  count: number;
  from: Float32Array;
  to: Float32Array;
  rounded: Uint8ClampedArray | undefined;
  rects: Float32Array;
  ends: Uint8ClampedArray | undefined;
}

/** A pie moving: the slices of both scenes in one order, with their widths and values at each end. */
interface MovingPie {
  items: readonly PieSlice[];
  from: Float64Array;
  to: Float64Array;
  /** Values at the start and end, which decide whose labels go when they do not all fit. */
  values: Float64Array;
  ends: Float64Array;
  r: readonly [number, number];
  labeled: boolean;
  draw: PieSlices["draw"];
}

/** A gauge moving: its value at each end, and how it draws one. */
interface MovingDial {
  from: number;
  to: number;
  draw: GaugeDial["draw"];
}

/** A change of values playing. */
export interface Tween {
  start: number;
  duration: number;
  /** The scene of the new values, which the last frame shows as it is. */
  scene: Scene;
  /** How each panel's marks and axes move, in the scene's order. */
  panels: PanelTween[];
}

/** One panel's marks and axes moving. */
export interface PanelTween {
  /** How the panel's scales move: frames place marks and plan axes with them. */
  motions: Record<Axis, ScaleMotion>;
  /** The axes moving, when any scale does. */
  axes: AxesMotion | undefined;
  bars: MovingBars[];
  points: MovingPoints[];
  traces: MovingTrace[];
  /** Layers of monotone bands and stacks, which frames curve together. */
  stacks: MovingStack[];
  rules: MovingRule[];
  lists: MovingList[];
  rasters: MovingRaster[];
  pie: MovingPie | undefined;
  dial: MovingDial | undefined;
}

/**
 * Moves one chart's marks and axes to changed values. The chart says when
 * its data changes and when it built a scene, and draws what `step` gives.
 */
export class ValueAnimation {
  readonly #model: ChartModel;
  readonly #builders: Builders;
  readonly #reducedMotion: MediaQueryList | null;
  /** What the chart showed when its data first changed since its last scene. */
  #shown: Shown | undefined;
  /** Something since the last scene showed at once: changes until the next scene do too. */
  #blocked = false;
  /**
   * The options and hidden keys the last scene was built with: a change
   * made under others shows at once, as option and visibility changes do.
   */
  #drawn: { config: unknown; hidden: string } | undefined;
  /** Until then, changes show at once: the data changes too often to move. */
  #quiet = Number.NEGATIVE_INFINITY;
  #tween: Tween | undefined;
  /** The last scene the chart was given is a frame between two scenes, not one the model built. */
  #between = false;

  /** `drawn`: whether the chart's last scene shows its current options and hidden keys. */
  constructor(model: ChartModel, window: Window | null, drawn: boolean, builders: Builders) {
    this.#model = model;
    this.#builders = builders;
    this.#reducedMotion = window?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    if (drawn) this.#drawn = drawnWith(model);
  }

  get playing(): boolean {
    return this.#tween !== undefined;
  }

  /**
   * Hears of a change of the data, before the chart draws it: `change`,
   * or undefined for a row view's. The new values may move from `scene`,
   * the last frame, when the chart can show the motion (undefined when it
   * cannot: off screen, inspected, or moving its view); `frameTime` is how
   * long that frame took.
   */
  changed(scene: Scene | undefined, change: TableChange | undefined, frameTime: number): void {
    const now = performance.now();
    const { config } = this.#model;
    const duration = durationOf(config.animation);
    // Rows streaming in, out, or into place, and changes while values move or soon after,
    // show at once until the data has been still for a change's duration.
    const busy =
      this.#tween !== undefined ||
      now < this.#quiet ||
      !change ||
      change.appended > 0 ||
      change.dropped > 0 ||
      !!change.inserted;
    if (busy) this.#quiet = now + duration;
    this.#tween = undefined;
    const current = drawnWith(this.#model);
    if (
      busy ||
      !scene ||
      duration === 0 ||
      config !== this.#drawn?.config ||
      current.hidden !== this.#drawn.hidden ||
      config.interaction?.sync ||
      // A navigator's strip draws the marks over the whole x domain, which does not move.
      config.navigator ||
      this.#reducedMotion?.matches ||
      frameTime > SLOW_FRAME ||
      lastFrameTime() > SLOW_FRAME
    ) {
      this.#shown = undefined;
      this.#blocked = true;
      return;
    }
    if (this.#blocked || this.#shown) return;
    this.#shown = snapshot(scene, this.#model.panels(), now);
    if (this.#shown) this.#shown.cost = performance.now() - now;
    else this.#blocked = true;
  }

  /**
   * The scene the chart draws next: a frame of a change playing, or else
   * the scene `build` makes, moving to it from what was shown if it can.
   */
  frame(build: () => Scene, frameTime: number): Scene {
    return this.step(frameTime) ?? this.start(build(), frameTime);
  }

  /**
   * The chart built `scene`: what to draw first, which moves to it from
   * what was shown when the data changed, if it can. `frameTime` is how
   * long the chart's last frame took.
   */
  start(scene: Scene, frameTime: number): Scene {
    const shown = this.#shown;
    this.#shown = undefined;
    this.#blocked = false;
    this.#between = false;
    this.#drawn = drawnWith(this.#model);
    // Copying what was shown counts toward this frame, as building the scene does.
    if (!shown || frameTime + shown.cost > SLOW_FRAME) return scene;
    const { config } = this.#model;
    const duration = durationOf(config.animation);
    this.#tween = plan(
      shown,
      scene,
      this.#model.panels(),
      duration,
      this.#builders,
      sidesOf(config),
      followedOf(config),
      positionsOf(config),
    );
    return this.step(frameTime) ?? scene;
  }

  /**
   * The next frame of a change playing, its last the new scene; undefined
   * when none plays, or the chart was resized or its theme changed since,
   * which the chart then draws afresh.
   */
  step(frameTime: number): Scene | undefined {
    const tween = this.#tween;
    if (!tween) return undefined;
    const { scene } = tween;
    const model = this.#model;
    const elapsed = performance.now() - tween.start;
    const stale =
      scene.width !== model.width ||
      scene.height !== model.height ||
      scene.pixelRatio !== model.pixelRatio ||
      scene.theme !== model.theme;
    // Slow frames, and a page switching to reduced motion, end it at once.
    if (
      stale ||
      elapsed >= tween.duration ||
      frameTime > SLOW_FRAME ||
      lastFrameTime() > SLOW_FRAME ||
      this.#reducedMotion?.matches
    ) {
      this.#tween = undefined;
      this.#between = false;
      return stale ? undefined : scene;
    }
    this.#between = true;
    return frameAt(tween, elapsed);
  }

  /**
   * Ends a change playing and forgets what was shown, so the next scene
   * shows its values at once. Whether the chart shows a frame between two
   * scenes, which it should draw afresh before anything reads it: one of a
   * change playing, or of one a later change or option ended. Until the
   * next scene, no change moves from it.
   */
  settle(): boolean {
    const between = this.#between;
    if (between || this.#shown) this.#blocked = true;
    this.#tween = undefined;
    this.#shown = undefined;
    return between;
  }
}

/** The options and hidden keys a model draws with now. */
function drawnWith(model: ChartModel): { config: unknown; hidden: string } {
  return { config: model.config, hidden: JSON.stringify([...model.hidden]) };
}

/** Milliseconds a change of values takes; 0 when off or unusable. */
function durationOf(animation: boolean | AnimationSpec | undefined): number {
  if (typeof animation !== "object" || !animation.values) return 0;
  const duration = animation.duration ?? DURATION;
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/**
 * Which y scale places a geometry, by its key; "y" when it is not known to
 * be on the right; undefined for a mark placed otherwise (in a frame, on a
 * scale of the chart's own, or moved by pixels), which no scale moving
 * between scenes moves.
 */
type Sides = (key: string) => "y" | "yRight" | undefined;

/** The y scale of each mark's geometry, by its key (see `ownerOf`). */
export function sidesOf(config: Pick<ChartConfig, "marks">): Sides {
  const right = new Set<MarkKey>();
  const placed = new Set<MarkKey>();
  config.marks.forEach((mark, i) => {
    const { spec, bound, scaled } = mark as Mark;
    // Coordinates naming only a field, or x or y, place rows as plain ones do.
    if (bound?.x || bound?.y || scaled) placed.add(spec.id ?? i);
    else if (spec.axis === "right") right.add(spec.id ?? i);
  });
  if (right.size === 0 && placed.size === 0) return () => "y";
  return (key) => {
    const owner = ownerOf(key) as MarkKey;
    return placed.has(owner) ? undefined : right.has(owner) ? "yRight" : "y";
  };
}

/**
 * Whether a geometry, by its key, is of a mark labels follow (its own
 * `labels`, or text `from` it), or of such text: such marks show their new
 * values at once, with the labels, which stand where a series is drawn,
 * not where it moves.
 */
export function followedOf(config: Pick<ChartConfig, "marks">): (key: string) => boolean {
  const followed = new Set<unknown>();
  config.marks.forEach((mark, i) => {
    const spec = (mark as Mark).spec as Mark["spec"] & {
      labels?: unknown;
      from?: { mark: string };
    };
    if ((spec.type === "line" || spec.type === "area") && spec.labels !== undefined)
      followed.add(spec.id ?? i);
    if (spec.from) followed.add(spec.from.mark).add(spec.id ?? i);
  });
  return (key) => followed.size > 0 && followed.has(ownerOf(key));
}

/**
 * The axis a line's positions are on, by its geometry's key: y for lines
 * along y (`orient: "y"`, or over a category y), whose values move along x.
 */
export function positionsOf(config: Pick<ChartConfig, "marks">): (key: string) => "x" | "y" {
  const alongY = new Set<unknown>();
  config.marks.forEach((mark, i) => {
    if (mark.spec.type === "line" && (mark as Mark).tooltip === "y") alongY.add(mark.spec.id ?? i);
  });
  return (key) => (alongY.size > 0 && alongY.has(ownerOf(key)) ? "y" : "x");
}

/**
 * The identity of the mark a geometry key belongs to: series keys are JSON
 * arrays starting with it (marks/mark.ts), which a series' parts follow
 * with "|" and the part (a look's bars, text's leaders), and rules' keys
 * its JSON before a colon and the rule's row; a highlight's pieces add
 * "\u0001" and the piece (model/highlight.ts).
 */
function ownerOf(geometryKey: string): unknown {
  const key = seriesOf(geometryKey);
  const json = key.startsWith("[")
    ? key.slice(0, key.lastIndexOf("]") + 1)
    : `[${key.slice(0, key.lastIndexOf(":"))}]`;
  try {
    return (JSON.parse(json) as unknown[])[0];
  } catch {
    return undefined;
  }
}

/** The series a geometry's key (or `of`) names, without a highlight's suffix (model/highlight.ts). */
function seriesOf(geometryKey: string): string {
  return geometryKey.split("\u0001")[0]!;
}

/** Whether a change that brings or takes away this geometry shows at once. */
function tracked(mark: Geometry): boolean {
  return (
    mark.kind === "rect" ||
    mark.kind === "point" ||
    mark.kind === "line" ||
    mark.kind === "area" ||
    mark.kind === "rule" ||
    mark.kind === "raster" ||
    listed(mark)
  );
}

/** A copy of what can move of a geometry, if any can. */
function copyOf(mark: Geometry): ShownItem | undefined {
  if (listed(mark)) return copyList(mark);
  switch (mark.kind) {
    case "rect":
      return barsOf(mark as RectGeometry);
    case "raster":
      return copyRaster(mark as RasterGeometry);
    case "point":
      return copyPoints(mark as PointGeometry);
    case "line":
    case "area":
      return copyTrace(mark as LineGeometry | AreaGeometry);
    case "rule":
      return copyRule(mark as RuleGeometry);
    default:
      return undefined;
  }
}

/**
 * Copies of what `scene` shows that can move, with the panels whose scales
 * placed them (`panels`, by key); undefined when nothing can, or too much would.
 */
export function snapshot(
  scene: Scene,
  panels: readonly DrawnPanel[],
  time: number,
): Shown | undefined {
  if (!movable(scene.panels)) return undefined;
  const shown = scene.panels.map((drawn) => shownOf(drawn, panelOf(panels, drawn)));
  return { time, cost: 0, theme: scene.theme, panels: shown };
}

/** The panel of `panels` that placed what `drawn` draws. */
function panelOf(panels: readonly DrawnPanel[], drawn: Panel): DrawnPanel | undefined {
  return panels.find(({ key }) => key === drawn.key);
}

function shownOf(drawn: Panel, panel: DrawnPanel | undefined): ShownPanel {
  const items = new Map<string, ShownItem>();
  const keys = new Set<string>();
  // A pie or a gauge is kept as its slices or its value, from which frames draw it all.
  const drawer = drawerOf(drawn);
  for (const mark of drawer ? [] : drawn.marks) {
    if (tracked(mark)) keys.add(mark.key);
    const item = copyOf(mark);
    if (item) items.set(mark.key, item);
  }
  const slices = drawer?.slices;
  const pie = slices && {
    items: slices.items,
    ends: slices.ends,
    r: slices.r,
    labeled: slices.labeled,
  };
  const dial = drawer?.dial?.value;
  const { key, plot, axes } = drawn;
  return { key, plot, panel, axes, items, keys, pie, dial };
}

/** The sectors of a pie or of a gauge in its panel, which draw all of it again for each frame. */
function drawerOf(panel: Panel): ArcGeometry | undefined {
  return panel.marks.find(draws);
}

function draws(mark: Geometry): mark is ArcGeometry {
  const { slices, dial } = mark as ArcGeometry;
  return mark.kind === "arc" && (slices !== undefined || dial !== undefined);
}

/**
 * Whether panels have something that can move (bars, slices, rules, points
 * that say which rows they show, lines and areas traced whole, lists, or
 * rasters), and not too much to draw every frame: all their bars, slices,
 * rules, rectangles, and labels, all their points, and all else they draw,
 * whether or not it moves. Clouds never move, and nothing moves beside them.
 */
function movable(panels: readonly Panel[]): boolean {
  let items = 0;
  let points = 0;
  let vertices = 0;
  // A pie with no slices yet can fill.
  let any = false;
  for (const mark of panels.flatMap((panel) => panel.marks)) {
    if (mark.kind === "point") {
      const { cloud, items: rows, count } = mark as PointGeometry;
      if (cloud) return false;
      points += count;
      any ||= rows !== undefined;
    } else if (mark.kind === "rect") {
      items += (mark as RectGeometry).count;
      any = true;
    } else if (mark.kind === "text" || mark.kind === "labels") {
      items +=
        mark.kind === "text" ? (mark as TextGeometry).count : (mark as LabelsGeometry).items.length;
      any = true;
    } else if (mark.kind === "rule") {
      items++;
      any = true;
    } else if (draws(mark)) {
      items += mark.slices?.items.length ?? 1;
      any = true;
    } else {
      vertices += mark.draw.size(mark);
      any ||= mark.kind === "segments" || mark.kind === "raster";
      const edges =
        mark.kind === "line"
          ? [(mark as LineGeometry).path]
          : mark.kind === "area"
            ? [(mark as AreaGeometry).upper, (mark as AreaGeometry).lower]
            : [];
      any ||= edges.length > 0 && edges.every((edge) => !edge || edge.whole);
    }
  }
  return any && items <= MOVING_ITEMS && points <= MOVING_POINTS && vertices <= MOVING_VERTICES;
}

/** A copy of a bar geometry's bars: position, along, thickness, root, tip, rounded end. */
function barsOf(mark: RectGeometry): ShownBars {
  const { count, rects } = mark;
  const { horizontal, at, span } = mark.bars!;
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
  return { kind: "bars", horizontal, count, at: at.slice(0, count), parts, ends };
}

/** How each scale of a panel moves between two scenes; undefined when one cannot. */
function motionsOf(
  shown: DrawnPanel | undefined,
  panel: DrawnPanel | undefined,
): Record<Axis, ScaleMotion> | undefined {
  const x = motionOf(shown?.x, panel?.x);
  const y = motionOf(shown?.y, panel?.y);
  const yRight = motionOf(shown?.yRight, panel?.yRight);
  return x && y && yRight && { x, y, yRight };
}

/** What says how each geometry moves: its y scale, whether labels follow it, and a line's positions' axis. */
interface Roles {
  sides: Sides;
  followed: (key: string) => boolean;
  positions: (key: string) => "x" | "y";
}

/**
 * How what was shown moves to `scene`, whose panels `panels` placed its
 * marks (by key), over `duration` ms, with `sides` saying which y scale
 * places each geometry, `followed` which show their new values at once, and
 * `positions` which axis each line's positions are on; undefined when it
 * cannot (panels, plots, or bands changed, a series came or went, a scale
 * moved that something drawn cannot move with, or retained slices changed
 * order) or nothing moves. Every panel moves, or none does.
 */
export function plan(
  shown: Shown,
  scene: Scene,
  panels: readonly DrawnPanel[],
  duration: number,
  builders: Builders,
  sides: Sides = () => "y",
  followed: (key: string) => boolean = () => false,
  positions: (key: string) => "x" | "y" = () => "x",
): Tween | undefined {
  if (
    duration === 0 ||
    scene.theme !== shown.theme ||
    scene.panels.length !== shown.panels.length ||
    !movable(scene.panels)
  )
    return undefined;
  const roles = { sides, followed, positions };
  // Points at most in a frame across the chart, with those still and going.
  const budget = {
    points: scene.panels.reduce(
      (count, { marks }) =>
        marks.reduce(
          (n, mark) => n + (mark.kind === "point" ? (mark as PointGeometry).count : 0),
          count,
        ),
      0,
    ),
  };
  const tweens: PanelTween[] = [];
  let moves = false;
  for (const [i, drawn] of scene.panels.entries()) {
    const panel = panelOf(panels, drawn);
    const planned = planPanel(shown.panels[i]!, drawn, panel, builders, roles, budget);
    if (!planned) return undefined;
    tweens.push(planned.tween);
    moves ||= planned.moves;
  }
  return moves ? { start: shown.time, duration, scene, panels: tweens } : undefined;
}

/**
 * How what a panel showed moves to `drawn`, which `panel` placed: whether
 * anything does; undefined when it cannot.
 */
function planPanel(
  shown: ShownPanel,
  drawn: Panel,
  panel: DrawnPanel | undefined,
  builders: Builders,
  { sides, followed, positions }: Roles,
  budget: { points: number },
): { tween: PanelTween; moves: boolean } | undefined {
  // A panel of another facet value, or drawn elsewhere or otherwise, is another picture.
  const same = drawn.key === shown.key;
  const motions = motionsOf(shown.panel, panel);
  if (!same || !sameRect(drawn.plot, shown.plot) || !motions) return undefined;
  const scales = motions.x.moves || motions.y.moves || motions.yRight.moves;
  const axes = scales && {
    motions,
    before: shown.panel!.plans,
    after: panel!.plans,
    planAxis: builders.planAxis,
    axisGuide: builders.axisGuide,
    measure: builders.measure,
  };
  // Labels coming or going (as an axis gets something to label) would appear at the start.
  const labeled = (list: readonly AxisGuide[]) =>
    list.map(({ side, ticks }) => `${side}${ticks.length > 0}`).join();
  if (axes && (!plannable(axes) || labeled(shown.axes) !== labeled(drawn.axes))) return undefined;
  // Axes the guides list plan their layers with the scene; they cannot follow
  // a moving scale, nor one of the chart's own, which moves on its own.
  if (drawn.axes.some((guide) => guide.layers && (motions[guide.scale as Axis]?.moves ?? true)))
    return undefined;
  const tween: PanelTween = {
    motions,
    axes: axes || undefined,
    bars: [],
    points: [],
    traces: [],
    stacks: [],
    rules: [],
    lists: [],
    rasters: [],
    pie: undefined,
    dial: undefined,
  };
  // A pie or a gauge draws its panel again for each frame, from its slices or its value.
  const drawer = drawerOf(drawn);
  if (drawer?.slices) {
    const moving = shown.pie && movePie(shown.pie, drawer.slices);
    if (!moving) return undefined;
    tween.pie = moving.pie;
    return { tween, moves: moving.moves };
  }
  if (drawer?.dial) {
    const moving = shown.dial !== undefined ? moveDial(shown.dial, drawer.dial) : undefined;
    if (!moving) return undefined;
    tween.dial = moving.dial;
    return { tween, moves: moving.moves };
  }
  const zero = (axis: Axis) =>
    [shown.panel?.[axis]?.map(0) ?? Number.NaN, panel?.[axis]?.map(0) ?? Number.NaN] as const;
  // A mark's areas move together or not at all: a stack's layers share edges.
  const areas = new Map<unknown, { moving: MovingTrace; moves: boolean }[]>();
  const still = new Set<unknown>();
  // Series a geometry of which shows its new values, which all of theirs do.
  const atOnce = new Set<string>();
  // Whether points and lines move, read once those shown at once are left out.
  const pieceMoves = new Map<MovingPoints | MovingTrace, boolean>();
  // Moving scales move the axes and grid lines, whatever marks do.
  let moves = scales;
  for (const [index, mark] of drawn.marks.entries()) {
    // Seams of time breaks (scale/breaks.ts names them) follow x alone: they
    // stay put while only y moves.
    if (mark.key === "time-break-seams") {
      if (motions.x.moves) return undefined;
      continue;
    }
    // Pieces of a series (outlines, markers, a highlight's) are its mark's.
    const of = mark.of ?? mark.key;
    const item = followed(of) ? undefined : shown.items.get(mark.key);
    const side = sides(of);
    // Marks placed otherwise change at once, and what moves beside them with them.
    if (!side) return undefined;
    let moved: { moves: boolean } | undefined;
    if (item?.kind === "bars" && mark.kind === "rect" && (mark as RectGeometry).bars) {
      const bars = moveBars(index, item, mark as RectGeometry, motions, side);
      if (bars) tween.bars.push(bars.moving);
      moved = bars;
    } else if (item?.kind === "points" && mark.kind === "point") {
      const target = mark as PointGeometry;
      const points = movePoints(
        index,
        item,
        target,
        side,
        motions.x,
        motions[side],
        MOVING_POINTS - budget.points + target.count,
      );
      if (points) {
        // Still points and exits count toward the budget across the chart.
        budget.points += points.moving.count - target.count;
        tween.points.push(points.moving);
        pieceMoves.set(points.moving, points.moves);
        continue;
      }
    } else if (item?.kind === "trace" && (mark.kind === "line" || mark.kind === "area")) {
      // Lines move along their values' axis only: points along their
      // positions' would need other rows.
      const trace = mark as LineGeometry | AreaGeometry;
      const along = positions(of);
      const values: Axis = along === "x" ? side : "x";
      const scale = { side: values, motion: motions[values], zero: zero(values) };
      const moving =
        !motions[along === "x" ? "x" : side].moves &&
        moveTrace(index, item, trace, scale, builders, along);
      if (moving && mark.kind === "area") {
        const owner = ownerOf(of);
        areas.set(owner, [...(areas.get(owner) ?? []), moving]);
        continue;
      }
      if (moving) {
        tween.traces.push(moving.moving);
        pieceMoves.set(moving.moving, moving.moves);
        continue;
      }
    } else if (item?.kind === "rule" && mark.kind === "rule") {
      const rule = moveRule(index, item, mark as RuleGeometry, side);
      if (rule) tween.rules.push(rule.moving);
      moved = rule;
    } else if (item?.kind === "list" && listed(mark)) {
      const list = moveList(index, item, mark, side);
      if (list) tween.lists.push(list.moving);
      moved = list;
    } else if (item?.kind === "raster" && mark.kind === "raster") {
      const raster = moveRaster(index, item, mark as RasterGeometry);
      if (raster) tween.rasters.push(raster.moving);
      moved = raster;
    }
    if (moved) {
      moves ||= moved.moves;
      continue;
    }
    // What cannot move shows its new values, unless the axes move: it
    // would stand apart from them. Series that came have nothing to move from.
    if (scales || (tracked(mark) && !shown.keys.has(mark.key))) return undefined;
    atOnce.add(seriesOf(of));
    if (mark.kind === "area") still.add(ownerOf(of));
  }
  const pieceOf = ({ of, key }: Geometry) => seriesOf(of ?? key);
  for (const [owner, layers] of areas) {
    // Areas beside one that shows its new values do too.
    const traces = layers.map(({ moving }) => moving);
    if (still.has(owner) || traces.some(({ mark }) => atOnce.has(pieceOf(mark)))) {
      still.add(owner);
      continue;
    }
    const curved = (traces[0]!.mark as AreaGeometry).curve !== undefined;
    const stacks = curved ? moveStacks(traces, builders) : undefined;
    if (curved && !stacks) {
      if (scales) return undefined;
      still.add(owner);
      continue;
    }
    if (stacks) tween.stacks.push(...stacks);
    else tween.traces.push(...traces);
    moves ||= layers.some((layer) => layer.moves);
  }
  // Pieces of a series (a highlight's dots, markers) move with it, or show
  // its new values with it.
  const shownAtOnce = ({ mark }: { mark: Geometry }) =>
    atOnce.has(pieceOf(mark)) || still.has(ownerOf(pieceOf(mark)));
  tween.points = tween.points.filter((points) => !shownAtOnce(points));
  tween.traces = tween.traces.filter((trace) => !shownAtOnce(trace));
  for (const piece of [...tween.points, ...tween.traces]) moves ||= pieceMoves.get(piece) ?? false;
  // Series that went have nothing to move to.
  const keys = new Set(drawn.marks.map(({ key }) => key));
  for (const key of shown.keys) if (!keys.has(key)) return undefined;
  return { tween, moves };
}

/**
 * How a series' bars move: matched by position, their lengths along the
 * scale `along` (as it moves), across a scale that must stay.
 */
function moveBars(
  index: number,
  shown: ShownBars,
  mark: RectGeometry,
  motions: Record<Axis, ScaleMotion>,
  side: "y" | "yRight",
): { moving: MovingBars; moves: boolean } | undefined {
  const next = barsOf(mark);
  if (next.horizontal !== shown.horizontal) return undefined;
  const along = next.horizontal ? "x" : side;
  const value = motions[along];
  // Bars whose positions move would need slots of their own.
  if (motions[next.horizontal ? side : "x"].moves) return undefined;
  const was = new Map<number, number>();
  for (let i = 0; i < shown.count; i++) {
    if (was.has(shown.at[i]!)) return undefined;
    was.set(shown.at[i]!, i);
  }
  const kept = new Set<number>();
  for (let j = 0; j < next.count; j++) {
    if (kept.has(next.at[j]!)) return undefined;
    kept.add(next.at[j]!);
  }
  let exits = 0;
  for (let i = 0; i < shown.count; i++) if (!kept.has(shown.at[i]!)) exits++;
  const count = next.count + exits;
  const from = new Float32Array(count * 4);
  const to = new Float32Array(count * 4);
  const rounded = next.ends && new Uint8ClampedArray(count * 2);
  // Bars of the new scene in its order, matched by position; new ones grow
  // from their root, where it was on the scale before. Bars that went shrink
  // to theirs, where it is after, drawn last.
  for (let j = 0; j < next.count; j++) {
    const target = next.parts.subarray(j * 4, j * 4 + 4);
    to.set(target, j * 4);
    const i = was.get(next.at[j]!);
    if (i === undefined) {
      from.set(target, j * 4);
      from[j * 4 + 2] = from[j * 4 + 3] = before(value, target[2]!);
    } else {
      from.set(shown.parts.subarray(i * 4, i * 4 + 4), j * 4);
    }
    if (rounded) {
      rounded[j * 2] = (i !== undefined && shown.ends?.[i]) || next.ends![j]!;
      rounded[j * 2 + 1] = next.ends![j]!;
    }
  }
  let k = next.count;
  for (let i = 0; i < shown.count; i++) {
    if (kept.has(shown.at[i]!)) continue;
    const source = shown.parts.subarray(i * 4, i * 4 + 4);
    from.set(source, k * 4);
    to.set(source, k * 4);
    to[k * 4 + 2] = to[k * 4 + 3] = after(value, source[2]!);
    if (rounded) rounded.fill(shown.ends?.[i] ?? 0, k * 2, k * 2 + 2);
    k++;
  }
  const moves = exits > 0 || value.moves || from.some((part, i) => part !== to[i]);
  const ends = rounded && new Uint8ClampedArray(count);
  const rects = new Float32Array(count * 4);
  return { moving: { index, mark, along, count, from, to, rounded, rects, ends }, moves };
}

/** How a gauge moves from the value `shown` to its dial's; undefined when it gains or loses one. */
function moveDial(
  shown: number,
  { value, draw }: GaugeDial,
): { dial: MovingDial | undefined; moves: boolean } | undefined {
  if (Object.is(shown, value)) return { dial: undefined, moves: false };
  if (!(Number.isFinite(shown) && Number.isFinite(value))) return undefined;
  return { dial: { from: shown, to: value, draw }, moves: true };
}

function movePie(shown: ShownPie, next: PieSlices): { pie: MovingPie; moves: boolean } | undefined {
  const nextKeys = new Set(next.items.map(({ key }) => key));
  const shownKeys = new Set(shown.items.map(({ key }) => key));
  const items: PieSlice[] = [];
  const from: number[] = [];
  const to: number[] = [];
  const values: number[] = [];
  const width = (ends: Float64Array, k: number) => ends[k]! - (k > 0 ? ends[k - 1]! : 0);
  // Slices of both scenes in one order: those kept in theirs, with those
  // that went and came where they were and are. Between two kept slices,
  // ones that went come first.
  let i = 0;
  let j = 0;
  while (i < shown.items.length || j < next.items.length) {
    const old = shown.items[i];
    const now = next.items[j];
    if (old && !nextKeys.has(old.key)) {
      items.push(old);
      from.push(width(shown.ends, i));
      to.push(0);
      values.push(old.value, 0);
      i++;
    } else if (now && !shownKeys.has(now.key)) {
      items.push(now);
      from.push(0);
      to.push(width(next.ends, j));
      values.push(0, now.value);
      j++;
    } else if (old && now && old.key === now.key) {
      items.push(now);
      from.push(width(shown.ends, i));
      to.push(width(next.ends, j));
      values.push(old.value, now.value);
      i++;
      j++;
    } else {
      // Kept slices changed order (sorted by value): they would cross.
      return undefined;
    }
  }
  const moves =
    shown.r !== next.r ||
    items.length !== next.items.length ||
    from.some((width, k) => width !== to[k]);
  const pie: MovingPie = {
    items,
    from: Float64Array.from(from),
    to: Float64Array.from(to),
    values: Float64Array.from(values),
    ends: new Float64Array(items.length),
    r: [shown.r, next.r],
    labeled: next.items.length > 0 ? next.labeled : shown.labeled,
    draw: next.draw,
  };
  return { pie, moves };
}

/**
 * The scene `elapsed` ms into a change: the new one, with its marks on their
 * way, and the axes and grid lines of moving scales between.
 */
export function frameAt(tween: Tween, elapsed: number): Scene {
  const t = ease(Math.min(1, Math.max(0, elapsed / tween.duration)));
  const { scene } = tween;
  const panels = scene.panels.map((panel, i) => panelAt(panel, tween.panels[i]!, t));
  // Insets paint panels in an order of their own.
  const moved = new Map(scene.panels.map((panel, i) => [panel, panels[i]!]));
  const painted = scene.painted?.map((panel) => moved.get(panel) ?? panel);
  return { ...scene, panels, ...(painted && { painted }) };
}

/** A panel at eased progress `t` of its tween. */
function panelAt(panel: Panel, tween: PanelTween, t: number): Panel {
  const { x, y, yRight } = tween.motions;
  const blends = { x: blendAt(x, t), y: blendAt(y, t), yRight: blendAt(yRight, t) };
  const { pie, dial } = tween;
  const marks = pie
    ? pieAt(pie, t)
    : dial
      ? dial.draw(dial.from + (dial.to - dial.from) * t)
      : panel.marks.slice();
  for (const bars of tween.bars) marks[bars.index] = barsAt(bars, t, blends[bars.along]);
  for (const points of tween.points)
    marks[points.index] = pointsAt(points, t, blends.x, blends[points.side]);
  for (const trace of tween.traces)
    marks[trace.index] = traceAt(trace, blends[trace.scale.side], panel.plot);
  for (const stack of tween.stacks) {
    const { pieces } = stack;
    stackAt(stack, blends[pieces[0]!.scale.side]).forEach((piece, j) => {
      marks[pieces[j]!.index] = piece;
    });
  }
  for (const rule of tween.rules) marks[rule.index] = ruleAt(rule, blends[rule.along]);
  for (const list of tween.lists) marks[list.index] = listAt(list, blends.x, blends[list.side]);
  for (const raster of tween.rasters) marks[raster.index] = rasterAt(raster, t);
  const guides = tween.axes && axesAt(panel, tween.axes, t);
  return { ...panel, ...guides, marks };
}

/** Starts quickly and settles without overshooting (cubic ease-out), as views move. */
function ease(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** Bars at eased progress `t`, their roots and tips on the frame's scale `value`. */
function barsAt(moving: MovingBars, t: number, value: Blend): RectGeometry {
  const { mark, count, from, to, rounded, rects, ends } = moving;
  const horizontal = mark.bars!.horizontal;
  for (let i = 0; i < count; i++) {
    const at = i * 4;
    const along = from[at]! + (to[at]! - from[at]!) * t;
    const thickness = from[at + 1]! + (to[at + 1]! - from[at + 1]!) * t;
    // Roots and tips move rather than tops and heights: a bar changing sign
    // shrinks to its root and grows on the other side.
    const root = blend(value, from[at + 2]!, to[at + 2]!);
    const tip = blend(value, from[at + 3]!, to[at + 3]!);
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
  // A frame's bars are not the scene's: nothing moves from them.
  const corners = ends && { radius: mark.rounded!.radius, ends };
  return { ...mark, rects, count, rounded: corners, bars: undefined };
}

function pieAt(moving: MovingPie, t: number): Geometry[] {
  const { from, to, values, ends } = moving;
  // Widths move, so neighbors share their boundary throughout and the
  // slices of two pies always make a whole turn. Slices with no width yet
  // (or any more) are left out, with their labels.
  const items: PieSlice[] = [];
  let sum = 0;
  moving.items.forEach((item, k) => {
    const width = from[k]! + (to[k]! - from[k]!) * t;
    if (!(width > 0)) return;
    sum += width;
    ends[items.length] = sum;
    const value = values[k * 2]! + (values[k * 2 + 1]! - values[k * 2]!) * t;
    items.push({ ...item, value });
  });
  const [r0, r1] = moving.r;
  return moving.draw(items, ends.subarray(0, items.length), r0 + (r1 - r0) * t, moving.labeled);
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
