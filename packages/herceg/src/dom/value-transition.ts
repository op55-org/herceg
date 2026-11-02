// Moving marks from the values a chart showed to changed ones (`animation:
// { values: true }`): bars, pie slices, a gauge's value, points, small
// lines and areas, labels, lists drawn in row order (error bars, candles,
// regions), and heatmaps' cells, in every panel, with the axes when the
// change moves their domains or reorders their categories. Charts load this
// module only when they ask for it. The data is current at once; what moves
// is a picture of the change. When a table's values change, the chart keeps
// a copy of what is on screen, a scene or a frame between two, matched by
// item names (docs/architecture/marks.md "Items") to the next scene's;
// frames between draw that scene with its marks, axes, and grid lines
// between the two. A change that moves a plot, changes the bands, or moves
// anything that cannot move with the axes, or that adds or drops rows,
// shows at once.

import type { TableChange } from "../data/table.ts";
import type { MeasureText } from "../layout/text.ts";
import type { ItemInfo } from "../marks/layout-mark.ts";
import type { Mark, MarkKey } from "../marks/mark.ts";
import type { planAxis } from "../model/axis.ts";
import type { axisGuide } from "../model/axis-guide.ts";
import type { ChartConfig, ChartModel, DrawnPanel } from "../model/model.ts";
import type { PositionScale } from "../scale/scale.ts";
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
  SunburstSectors,
  TextGeometry,
} from "../scene/scene.ts";
import type { AnimationSpec } from "../spec/spec.ts";
import { lastFrameTime } from "./scheduler.ts";
import { barsAt, copyBars, type MovingBars, moveBars, type ShownBars } from "./value-bars.ts";
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
  copyLabels,
  labelsAt,
  type MovingLabels,
  moveLabels,
  named,
  type ShownLabels,
} from "./value-labels.ts";
import {
  type AxesMotion,
  type Axis,
  axesAt,
  blendAt,
  motionOf,
  planAt,
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
import { countOf, type MovingSunburst, moveSunburst, sunburstAt } from "./value-sectors.ts";
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

/** A pie as drawn: its slices are made afresh for each scene, so they are kept as they are. */
interface ShownPie {
  items: readonly PieSlice[];
  ends: Float64Array;
  r: number;
  labeled: boolean;
}

/**
 * What can move of one geometry as drawn: a series' bars, points, line, or
 * area, a rule, labels, a list drawn in row order, or a raster.
 */
type ShownItem =
  | ShownBars
  | ShownPoints
  | ShownTrace
  | ShownRule
  | ShownLabels
  | ShownList
  | ShownRaster;

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
  /** A sunburst's sectors as drawn (each scene's and frame's own, never written over). */
  sunburst: SunburstSectors | undefined;
  /**
   * In a frame between two scenes, each category's place along a category
   * axis whose categories changed order, which its scale does not give.
   */
  places: Places | undefined;
}

/** Categories' places in pixels, by name, along the category axes they stand on. */
type Places = Partial<Record<Axis, ReadonlyMap<string, number>>>;

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
  placed: PieSlices["placed"];
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
  /** It plays a drill, the tree's view, which the pointer does not stop. */
  drill?: boolean;
  /** What frames place axes with. */
  builders: Builders;
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
  labels: MovingLabels[];
  /** Category axes whose categories changed order: each axis' place among the panel's, and its ticks' places before. */
  bands: { index: number; from: Float64Array }[];
  /** On those axes, whether drawn or not: their categories, in the new order, and each one's place at both ends. */
  places: { axis: Axis; names: readonly string[]; from: Float64Array; to: Float64Array }[];
  points: MovingPoints[];
  traces: MovingTrace[];
  /** Layers of monotone bands and stacks, which frames curve together. */
  stacks: MovingStack[];
  rules: MovingRule[];
  lists: MovingList[];
  rasters: MovingRaster[];
  pie: MovingPie | undefined;
  dial: MovingDial | undefined;
  sunburst: MovingSunburst | undefined;
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
  /** That frame, and how far into its change it is: a change arriving now moves on from it. */
  #frame: { scene: Scene; elapsed: number } | undefined;
  /** The scene or frame the chart drew last, which a drill moves from. */
  #last: Scene | undefined;
  /** What was shown is copied for a drill: the pointer does not stop the change it plays. */
  #drill = false;

  /**
   * `drawn`: the chart's last scene, if it shows its current options and
   * hidden keys, which a drill before the next frame moves from.
   */
  constructor(
    model: ChartModel,
    window: Window | null,
    drawn: Scene | undefined,
    builders: Builders,
  ) {
    this.#model = model;
    this.#builders = builders;
    this.#reducedMotion = window?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    if (drawn) {
      this.#drawn = drawnWith(model);
      this.#last = drawn;
    }
    model.drilled = () => this.#drilled();
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
    const duration = durationOf(this.#model.config.animation);
    // Rows streaming in, out, or into place, a view's rows changing, and
    // changes soon after, show at once until the data has been still for a
    // change's duration. Changes of values while values move move on from
    // the frame on screen.
    const busy =
      now < this.#quiet ||
      !change ||
      change.appended > 0 ||
      change.dropped > 0 ||
      !!change.inserted;
    if (busy) this.#quiet = now + duration;
    if (busy || !scene || this.#still(frameTime)) {
      this.#ended();
      this.#shown = undefined;
      this.#blocked = true;
      return;
    }
    this.#copy(scene, now);
  }

  /**
   * Whether a change now shows at once: the chart does not animate values,
   * its options or hidden series changed since its last scene, it is
   * linked, has a navigator, prefers reduced motion, or draws slowly (its
   * frames took `frameTime`).
   */
  #still(frameTime: number): boolean {
    const model = this.#model;
    const { config } = model;
    return (
      durationOf(config.animation) === 0 ||
      config !== this.#drawn?.config ||
      drawnWith(model).hidden !== this.#drawn.hidden ||
      !!config.interaction?.sync ||
      // A navigator's strip draws the marks over the whole x domain, which does not move.
      !!config.navigator ||
      !!this.#reducedMotion?.matches ||
      frameTime > SLOW_FRAME ||
      lastFrameTime() > SLOW_FRAME
    );
  }

  /**
   * Copies `scene`, the scene or frame on screen, once until the next scene
   * is drawn: the next scene moves from it. A frame between two scenes is
   * copied with its scales as it drew them, and the change it played ends.
   */
  #copy(scene: Scene, now: number): void {
    const tween = this.#tween;
    const frame = this.#frame;
    this.#ended();
    if (this.#blocked || this.#shown) return;
    const between = tween && frame?.scene === scene;
    const panels = this.#model.panels();
    this.#shown = between
      ? snapshot(scene, panelsAt(tween, frame.elapsed, panels), now, placesAt(tween, frame.elapsed))
      : snapshot(scene, panels, now);
    if (this.#shown) this.#shown.cost = performance.now() - now;
    else this.#blocked = true;
  }

  /**
   * Hears that a tree's drill root is about to change: the next scene moves
   * from what is drawn, which the pointer and the click that drilled do not
   * stop (a drill is the tree's view).
   */
  #drilled(): void {
    const scene = this.#last;
    if (!scene || this.#still(0)) return;
    this.#copy(scene, performance.now());
    this.#drill = this.#shown !== undefined;
  }

  /**
   * The scene the chart draws next: a frame of a change playing, or else
   * the scene `build` makes, moving to it from what was shown if it can.
   */
  frame(build: () => Scene, frameTime: number): Scene {
    this.#last = this.step(frameTime) ?? this.start(build(), frameTime);
    return this.#last;
  }

  /**
   * The chart built `scene`: what to draw first, which moves to it from
   * what was shown when the data changed, if it can. `frameTime` is how
   * long the chart's last frame took.
   */
  start(scene: Scene, frameTime: number): Scene {
    const shown = this.#shown;
    const drill = this.#drill;
    this.#shown = undefined;
    this.#drill = false;
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
    if (this.#tween) this.#tween.drill = drill;
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
      this.#ended();
      this.#between = false;
      return stale ? undefined : scene;
    }
    this.#between = true;
    const frame = frameAt(tween, elapsed);
    this.#frame = { scene: frame, elapsed };
    // While a drill plays, the pointer reads the items as its frames draw them.
    const items = this.#model.items;
    if (tween.drill && items) {
      items.transitionItems = new Map(
        frame.panels.flatMap(({ key, items }) => (items?.pick ? [[key, items.pick]] : [])),
      );
      items.transitionRecords = new Map(
        frame.panels.flatMap(({ key, items }) => (items?.records ? [[key, items.records]] : [])),
      );
    }
    return frame;
  }

  /** Forgets the change playing, and the frames' items the pointer read. */
  #ended(): void {
    this.#tween = undefined;
    this.#frame = undefined;
    const items = this.#model.items;
    if (items) items.transitionItems = items.transitionRecords = undefined;
  }

  /** Whether a drill plays, which the pointer passing does not stop. */
  get drilling(): boolean {
    return this.#tween?.drill === true;
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
    this.#ended();
    this.#shown = undefined;
    this.#drill = false;
    return between;
  }

  /** Ends what plays and lets go of the scene drawn last, for a chart destroyed. */
  dispose(): void {
    this.settle();
    this.#last = undefined;
    this.#model.drilled = undefined;
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
  if (named(mark)) return copyLabels(mark);
  if (listed(mark)) return copyList(mark);
  switch (mark.kind) {
    case "rect":
      return copyBars(mark as RectGeometry);
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
  places?: ReadonlyMap<string, Places>,
): Shown | undefined {
  if (!movable(scene.panels)) return undefined;
  const shown = scene.panels.map((drawn) =>
    shownOf(drawn, panelOf(panels, drawn), places?.get(drawn.key)),
  );
  return { time, cost: 0, theme: scene.theme, panels: shown };
}

/** The panel of `panels` that placed what `drawn` draws. */
function panelOf(panels: readonly DrawnPanel[], drawn: Panel): DrawnPanel | undefined {
  return panels.find(({ key }) => key === drawn.key);
}

function shownOf(
  drawn: Panel,
  panel: DrawnPanel | undefined,
  places: Places | undefined,
): ShownPanel {
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
  return { key, plot, panel, axes, items, keys, pie, dial, sunburst: drawer?.sectors, places };
}

/** The sectors of a pie, a gauge, or a sunburst in its panel, which draw all of it again for each frame. */
function drawerOf(panel: Panel): ArcGeometry | undefined {
  return panel.marks.find(draws);
}

function draws(mark: Geometry): mark is ArcGeometry {
  const { slices, dial, sectors } = mark as ArcGeometry;
  return (
    mark.kind === "arc" && (slices !== undefined || dial !== undefined || sectors !== undefined)
  );
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
      items += mark.slices?.items.length ?? (mark.sectors ? countOf(mark.sectors) : 1);
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
  // Points, and bars, at most in a frame across the chart, with those still and going.
  const budget = {
    bars: 0,
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
  return moves ? { start: shown.time, duration, builders, scene, panels: tweens } : undefined;
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
  budget: { bars: number; points: number },
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
  // Category axes whose categories changed order move their ticks to their new places.
  const bands = bandsOf(shown, drawn, panel);
  if (!bands) return undefined;
  // Categories in another order, whether an axis shows them or not: what
  // matches by order or stands at fixed places cannot follow them.
  const places = placesOf(shown, panel);
  const reordered = places.length > 0;
  // Marks that cannot move show their new values, unless axes move: they would stand apart.
  const moving = scales || reordered;
  const tween: PanelTween = {
    motions,
    axes: axes || undefined,
    bars: [],
    labels: [],
    bands,
    places,
    points: [],
    traces: [],
    stacks: [],
    rules: [],
    lists: [],
    rasters: [],
    pie: undefined,
    dial: undefined,
    sunburst: undefined,
  };
  // A pie, a gauge, or a sunburst draws its panel again for each frame, from its slices, value, or sectors.
  const drawer = drawerOf(drawn);
  if (drawer?.sectors) {
    const moving =
      shown.sunburst && moveSunburst(shown.sunburst, drawer.sectors, MOVING_ITEMS - budget.bars);
    if (!moving) return undefined;
    // Sectors count toward the chart's budget, as bars do.
    budget.bars += moving.sunburst.sectors.length;
    tween.sunburst = moving.sunburst;
    return { tween, moves: moving.moves };
  }
  if (drawer?.slices) {
    const moving = shown.pie && movePie(shown.pie, drawer.slices);
    // Slices, those going too, count toward the chart's budget, as bars do.
    if (!moving || moving.pie.items.length > MOVING_ITEMS - budget.bars) return undefined;
    budget.bars += moving.pie.items.length;
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
  let moves = moving;
  // Labels, by the mark (or bar series, `of`) whose labels they are: matched among them all.
  const labels = new Map<string, { index: number; mark: TextGeometry | LabelsGeometry }[]>();
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
    if (named(mark) && !followed(of)) {
      const pool = mark.named!.of ?? mark.key;
      labels.set(pool, [...(labels.get(pool) ?? []), { index, mark }]);
      continue;
    }
    if (
      mark.kind === "rect" &&
      (mark as RectGeometry).bars &&
      (item?.kind === "bars" || (!item && !shown.keys.has(mark.key)))
    ) {
      // A series that came has its bars come.
      const bars = moveBars(
        index,
        item as ShownBars | undefined,
        mark as RectGeometry,
        motions,
        side,
        MOVING_ITEMS - budget.bars,
      );
      if (bars) {
        budget.bars += bars.moving.count;
        tween.bars.push(bars.moving);
      }
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
    } else if (
      item?.kind === "trace" &&
      (mark.kind === "line" || mark.kind === "area") &&
      !reordered
    ) {
      // Lines move along their values' axis only: points along their
      // positions' would need other rows, and categories changing order
      // other positions.
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
    } else if (item?.kind === "rule" && mark.kind === "rule" && budget.bars < MOVING_ITEMS) {
      const rule = moveRule(index, item, mark as RuleGeometry, side);
      if (rule) {
        budget.bars++;
        tween.rules.push(rule.moving);
      }
      moved = rule;
    } else if (item?.kind === "list" && listed(mark) && !reordered) {
      // Lists match by order, which reordered categories would not keep.
      const list = moveList(index, item, mark, side);
      if (list) tween.lists.push(list.moving);
      moved = list;
    } else if (item?.kind === "raster" && mark.kind === "raster" && !reordered) {
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
    if (moving || (tracked(mark) && !shown.keys.has(mark.key))) return undefined;
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
  const keys = new Set(drawn.marks.map(({ key }) => key));
  for (const key of shown.keys) {
    if (keys.has(key)) continue;
    const item = shown.items.get(key);
    // Bars and labels of a series that went go; other series that went have nothing to move to.
    if (item?.kind === "labels") continue;
    if (item?.kind !== "bars") return undefined;
    const bars = moveBars(
      -1,
      item,
      undefined,
      motions,
      sides(key) ?? "y",
      MOVING_ITEMS - budget.bars,
    );
    if (!bars) return undefined;
    budget.bars += bars.moving.count;
    tween.bars.push(bars.moving);
    moves = true;
  }
  // Labels last, as bars' labels come and go with their bars.
  const pools = new Set(labels.keys());
  const shownLabels = new Map<string, ShownLabels[]>();
  for (const [key, item] of shown.items) {
    if (item.kind !== "labels" || followed(item.mark.of ?? key)) continue;
    const pool = item.of ?? key;
    shownLabels.set(pool, [...(shownLabels.get(pool) ?? []), item]);
    pools.add(pool);
  }
  for (const pool of pools) {
    const next = labels.get(pool) ?? [];
    const side = sides(pool);
    if (!side) return undefined;
    const bars = tween.bars.find(({ mark }) => mark.key === pool);
    const moved = moveLabels(
      shownLabels.get(pool) ?? [],
      next,
      motions.x,
      motions[side],
      side,
      bars,
    );
    tween.labels.push(...moved.moving);
    moves ||= moved.moves;
  }
  return { tween, moves };
}

/**
 * The category axes of `drawn` whose ticks stand elsewhere than in `shown`
 * (their categories changed order), each with its ticks' places in `shown`,
 * found by their categories (a category not labeled there, on an axis
 * thinning its labels, by its band); undefined when one cannot move so:
 * other categories, an axis the guides list, or grid lines along it that
 * moved.
 */
function bandsOf(
  shown: ShownPanel,
  drawn: Panel,
  panel: DrawnPanel | undefined,
): PanelTween["bands"] | undefined {
  const bands: PanelTween["bands"] = [];
  for (const [index, guide] of drawn.axes.entries()) {
    const axis = guide.scale as Axis;
    const before = shown.axes.find(({ key }) => key === guide.key);
    const [was, is] = [shown.panel?.[axis]?.categories, panel?.[axis]?.categories];
    if (!before || !was || !is || panel![axis]!.type !== "band") continue;
    const at = new Map(before.ticks.map((tick) => [was[tick.value], tick.position]));
    // Ticks stand as far from their categories' places as each other.
    const place = placeOf(shown, axis);
    const first = before.ticks[0];
    const offset = first ? first.position - place(was[first.value]!) : Number.NaN;
    const from = Float64Array.from(guide.ticks, (tick) => {
      const name = is[tick.value]!;
      return at.get(name) ?? place(name) + offset;
    });
    if (from.length === before.ticks.length && from.every((p, i) => p === guide.ticks[i]!.position))
      continue;
    const along = guide.side === "top" || guide.side === "bottom" ? "x" : "y";
    const gridded = drawn.grids.some((batch) => batch.along === along && batch.at.length > 0);
    if (guide.layers || gridded || from.some(Number.isNaN)) return undefined;
    bands.push({ index, from });
  }
  return bands;
}

/**
 * Where `shown` drew each category along `axis` (its scale's place for
 * the category, or in a frame between two scenes, the place it had then).
 */
function placeOf(shown: ShownPanel, axis: Axis): (name: string) => number {
  const places = shown.places?.[axis];
  const scale = shown.panel![axis]!;
  const index = new Map(scale.categories?.map((name, i) => [name, i]));
  return (name) => places?.get(name) ?? scale.map(index.get(name) ?? Number.NaN);
}

/**
 * The category axes of `panel`, drawn or not, whose categories are those
 * `shown` drew in another order, or still on their way to their places
 * (`shown` a frame of a change reordering them): each one's categories in
 * the new order, and their places before and after.
 */
function placesOf(shown: ShownPanel, panel: DrawnPanel | undefined): PanelTween["places"] {
  const places: PanelTween["places"] = [];
  for (const axis of ["x", "y", "yRight"] as const) {
    const [was, is] = [shown.panel?.[axis]?.categories, panel?.[axis]?.categories];
    const moving = shown.places?.[axis] !== undefined;
    if (!was || !is || (!moving && !was.some((name, i) => is[i] !== name))) continue;
    const place = placeOf(shown, axis);
    const scale = panel![axis]!;
    const from = Float64Array.from(is, (name) => place(name));
    places.push({ axis, names: is, from, to: Float64Array.from(is, (_, i) => scale.map(i)) });
  }
  return places;
}

/** Categories' places along axes whose categories change order, `elapsed` ms into a change, by panel. */
export function placesAt(tween: Tween, elapsed: number): Map<string, Places> {
  const t = progress(tween, elapsed);
  const byPanel = new Map<string, Places>();
  tween.scene.panels.forEach(({ key }, i) => {
    const list = tween.panels[i]?.places ?? [];
    if (list.length === 0) return;
    const places: Places = {};
    for (const { axis, names, from, to } of list)
      places[axis] = new Map(names.map((name, j) => [name, from[j]! + (to[j]! - from[j]!) * t]));
    byPanel.set(key, places);
  });
  return byPanel;
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
    placed: next.placed,
  };
  return { pie, moves };
}

/** Eased progress `elapsed` ms into a change. */
function progress(tween: Tween, elapsed: number): number {
  return ease(Math.min(1, Math.max(0, elapsed / tween.duration)));
}

/**
 * The panels a frame `elapsed` ms into a change drew with: `panels`, the
 * new scene's, with the scales and axis plans of moving axes between. A
 * change arriving then moves on from them.
 */
export function panelsAt(
  tween: Tween,
  elapsed: number,
  panels: readonly DrawnPanel[],
): DrawnPanel[] {
  const t = progress(tween, elapsed);
  return panels.map((panel) => {
    const at = tween.scene.panels.findIndex(({ key }) => key === panel.key);
    const axes = tween.panels[at]?.axes;
    if (!axes) return panel;
    const plans = { ...panel.plans };
    const moved: Partial<Record<Axis, PositionScale>> = {};
    for (const axis of ["x", "y", "yRight"] as const) {
      const after = panel.plans[axis];
      if (!axes.motions[axis].moves || !after) continue;
      const plan = planAt(axes, axis, t);
      plans[axis] = plan;
      if (panel.plans.grid === after) plans.grid = plan;
      moved[axis] = plan.scale;
    }
    return { ...panel, ...moved, plans };
  });
}

/**
 * The scene `elapsed` ms into a change: the new one, with its marks on their
 * way, and the axes and grid lines of moving scales between.
 */
export function frameAt(tween: Tween, elapsed: number): Scene {
  const t = progress(tween, elapsed);
  const { scene } = tween;
  const panels = scene.panels.map((panel, i) =>
    panelAt(panel, tween.panels[i]!, t, tween.builders),
  );
  // Insets paint panels in an order of their own.
  const moved = new Map(scene.panels.map((panel, i) => [panel, panels[i]!]));
  const painted = scene.painted?.map((panel) => moved.get(panel) ?? panel);
  return { ...scene, panels, ...(painted && { painted }) };
}

/** A panel at eased progress `t` of its tween, `builders` placing its axes. */
function panelAt(panel: Panel, tween: PanelTween, t: number, builders: Builders): Panel {
  const { x, y, yRight } = tween.motions;
  const blends = { x: blendAt(x, t), y: blendAt(y, t), yRight: blendAt(yRight, t) };
  const { pie, dial, sunburst } = tween;
  let { items } = panel;
  let marks: Geometry[];
  if (sunburst) {
    const [drawn, placed, pick] = sunburstAt(sunburst, t);
    const decorated = items?.decorate?.(drawn, placed);
    items = items && { ...items, list: placed, pick, records: decorated?.records };
    marks = decorated?.marks ?? drawn;
  } else if (pie) {
    const [drawn, placed] = pieAt(pie, t);
    // Its items as this frame draws them, and what is placed by them over them.
    items = items && { ...items, list: placed };
    marks = items?.decorate?.(drawn, placed).marks ?? drawn;
  } else if (dial) {
    const drawn = dial.draw(dial.from + (dial.to - dial.from) * t);
    marks = items?.decorate?.(drawn, undefined).marks ?? drawn;
  } else marks = panel.marks.slice();
  // What went is drawn after the panel's own geometry, in its paint order too.
  const gone: Geometry[] = [];
  const put = (index: number, geometry: Geometry) => {
    if (index < 0) gone.push(geometry);
    else marks[index] = geometry;
  };
  for (const bars of tween.bars)
    put(bars.index, barsAt(bars, blends[bars.along], blends[bars.place]));
  for (const labels of tween.labels)
    put(labels.index, labelsAt(labels, t, blends.x, blends[labels.side]));
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
  let guides = tween.axes && axesAt(panel, tween.axes, t);
  if (tween.bands.length > 0) {
    // Category axes' ticks move from their places to their new ones.
    const axes = (guides?.axes ?? panel.axes).slice();
    for (const { index, from } of tween.bands) {
      const guide = axes[index]!;
      const ticks = guide.ticks.map((tick, i) => ({
        ...tick,
        position: from[i]! + (tick.position - from[i]!) * t,
      }));
      axes[index] = builders.axisGuide(
        guide.key,
        guide.scale,
        guide,
        ticks,
        guide.title,
        builders.measure,
      );
    }
    guides = { axes, grids: guides?.grids ?? panel.grids };
  }
  let { paint } = panel;
  if (gone.length > 0 && paint) {
    const first = panel.grids.length + marks.length;
    paint = [...paint, ...gone.map((_, i) => first + i)];
  }
  return { ...panel, ...guides, marks: [...marks, ...gone], items, ...(paint && { paint }) };
}

/** Starts quickly and settles without overshooting (cubic ease-out), as views move. */
function ease(t: number): number {
  return 1 - (1 - t) ** 3;
}

/** A pie's geometry at eased progress `t`, and the items it draws. */
function pieAt(moving: MovingPie, t: number): [Geometry[], () => readonly ItemInfo[]] {
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
  const at = ends.subarray(0, items.length);
  const r = r0 + (r1 - r0) * t;
  // Placed, when something reads them, from a copy of the ends: the next frame writes over them.
  const ends0 = at.slice();
  let placed: readonly ItemInfo[] | undefined;
  return [
    moving.draw(items, at, r, moving.labeled),
    () => (placed ??= moving.placed(items, ends0, r)),
  ];
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}
