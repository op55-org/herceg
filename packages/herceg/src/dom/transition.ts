// Moving a chart's axes, or a map's or network's plane, gradually to a view
// asked for (the `animation` option). Charts load this module only when
// they animate.

import type { Breaks } from "../lod/m4.ts";
import type { ItemViews } from "../model/item-views.ts";
import type { ChartModel, DrawnPanel, ViewDomains } from "../model/model.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { ChartError } from "../spec/errors.ts";
import type { AnimationSpec, Easing } from "../spec/spec.ts";
import { frameCount, lastFrameTime } from "./scheduler.ts";

/** How long `animation: true` takes, in milliseconds. */
const DURATION = 250;
/**
 * Charts whose frames would take longer than this, in milliseconds, alone or
 * with every chart moving or drawing beside them, jump to a new view rather
 * than move there.
 */
const SLOW_FRAME = 10;

/** Planes' ranges across their rooms, by state (see `planesOf`). */
type Planes = ReadonlyMap<string, { x: readonly [number, number]; y: readonly [number, number] }>;

/** Where a change of view starts: the ranges drawn before it, and which axes are logarithmic. */
export interface ViewStart {
  domains: ViewDomains;
  /** Log axes move evenly in log space. */
  log: { x: boolean; y: boolean; yRight: boolean };
  /** An x axis with breaks moves evenly in the time it shows. */
  breaks?: Breaks | undefined;
}

/** A change of view playing: of a panel's axes, of maps' and networks' planes, or both. */
export interface Transition {
  /** Where the axes start, in a chart drawing a panel of them. */
  axes: ViewStart | undefined;
  /** The planes' ranges drawn before it. */
  planes: Planes | undefined;
  /** The transitions asked for with it, which play together or not at all. */
  batch: Batch;
  /** Planned on its first frame, once every change asked for before it is in. */
  to: { domains: ViewDomains | undefined; planes: Planes | undefined } | undefined;
  start: number;
  duration: number;
  /** The `easing` it moves with, from 0 to 1 over its duration. */
  ease: (t: number) => number;
}

/**
 * Transitions whose first frame is the same, such as an application moving
 * every chart of a dashboard: what each chart's first frame would take.
 */
interface Batch {
  frame: number;
  costs: Map<ViewAnimation, number>;
  /** Decided by the first member to draw, for all: charts move together or not at all. */
  jump?: boolean;
}

let batch: Batch | undefined;

/** The batch of transitions starting on the next frame, with `animation`'s cost in it. */
function joinBatch(animation: ViewAnimation, cost: number): Batch {
  const frame = frameCount();
  if (batch?.frame !== frame) batch = { frame, costs: new Map() };
  batch.costs.set(animation, cost);
  return batch;
}

function costOf(batch: Batch): number {
  let cost = 0;
  for (const each of batch.costs.values()) cost += each;
  return cost;
}

/**
 * Moves one chart's axes, or its planes, to the views asked for. The chart
 * says where a change starts, and calls `step` before drawing each frame.
 */
export class ViewAnimation {
  readonly #model: ChartModel;
  readonly #reducedMotion: MediaQueryList | null;
  readonly #report: (error: ChartError) => void;
  readonly #ChartError: typeof ChartError;
  /** The `animation` option whose `easing` was last told of. */
  #told: unknown;
  #transition: Transition | undefined;

  /**
   * `report`: how the chart tells of options it refuses that do not keep it
   * from drawing, as `ChartError`s (the chart's class, which this module
   * takes rather than imports: a module both imported would move into a
   * chunk of its own).
   */
  constructor(
    model: ChartModel,
    window: Window | null,
    report: (error: ChartError) => void,
    errors: typeof ChartError,
  ) {
    this.#model = model;
    this.#reducedMotion = window?.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    this.#report = report;
    this.#ChartError = errors;
    this.easing();
  }

  /**
   * The curve the chart's views and values move along: its `easing`'s, by
   * default cubic-out. A name that is none moves as by default, and is
   * told of once per `animation` option: only JavaScript can give one
   * (the types and specs refuse it). The chart asks as its options change.
   */
  easing(): (t: number) => number {
    const { animation } = this.#model.config;
    const name = typeof animation === "object" ? (animation.easing ?? "cubic-out") : "cubic-out";
    if (Object.hasOwn(EASINGS, name)) return EASINGS[name];
    if (animation !== this.#told) {
      this.#told = animation;
      this.#report(
        new this.#ChartError({
          code: "invalid-option",
          path: "animation.easing",
          message: `animation.easing: expected "cubic-out", "linear", or "cubic-in-out"; received ${JSON.stringify(name)}`,
        }),
      );
    }
    return EASINGS["cubic-out"];
  }

  get playing(): boolean {
    return this.#transition !== undefined;
  }

  /**
   * Moves from what `from`, a panel drawn before a change of view, shows to
   * the view now asked for, or from what the planes of maps and networks
   * drawn show, over the `animation` option's duration; `frameTime` is how
   * long the chart's last frame took. Whether it started.
   */
  start(
    from: DrawnPanel | undefined,
    animation: boolean | AnimationSpec | undefined,
    frameTime: number,
  ): boolean {
    const duration = durationOf(animation);
    const planes = planesOf(this.#model.items);
    if (duration === 0 || this.#reducedMotion?.matches || !(from || planes)) return false;
    this.#transition = {
      axes: from && startOf(from),
      planes,
      // The first frame also plans the new view: about another frame's work.
      batch: joinBatch(this, 2 * frameTime),
      to: undefined,
      start: performance.now(),
      duration,
      ease: this.easing(),
    };
    return true;
  }

  /**
   * Sets the ranges the frame about to be drawn shows, or ends the
   * transition; whether another frame follows. `plan` builds the scene of
   * the view asked for, which is never painted, and returns its panel.
   */
  step(plan: () => DrawnPanel | undefined, frameTime: number): boolean {
    const transition = this.#transition;
    if (!transition) return false;
    const model = this.#model;
    if (!transition.to) {
      // Charts whose first frame together would be slow jump instead,
      // before planning where they would go.
      const { batch } = transition;
      batch.jump ??= costOf(batch) > SLOW_FRAME;
      if (batch.jump) return this.settle();
      model.setTransitionDomains(null);
      this.#setViews(undefined);
      const panel = plan();
      const planes = transition.planes && planesOf(model.items);
      const domains = transition.axes && panel && domainsOf(panel);
      if (!domains && !planes) return this.settle();
      transition.to = { domains, planes };
    }
    const elapsed = performance.now() - transition.start;
    // Slow frames, of this chart or of every chart together, and a page
    // switching to reduced motion end it at once.
    if (
      elapsed >= transition.duration ||
      frameTime > SLOW_FRAME ||
      lastFrameTime() > SLOW_FRAME ||
      this.#reducedMotion?.matches
    )
      return this.settle();
    const { domains, planes } = transition.to;
    if (domains) model.setTransitionDomains(domainsAt(transition, domains, elapsed));
    if (planes) this.#setViews(planesAt(transition, planes, elapsed));
    return true;
  }

  /** Ends a transition playing, so the next scene shows the view asked for; false. */
  settle(): false {
    // A transition ended before its first frame costs that frame nothing.
    this.#transition?.batch.costs.delete(this);
    this.#transition = undefined;
    this.#model.setTransitionDomains(null);
    this.#setViews(undefined);
    return false;
  }

  /** Has frames draw planes at `views`, by state, or at their own. */
  #setViews(views: Planes | undefined): void {
    const items = this.#model.items;
    if (items) items.transitionViews = views;
  }
}

/**
 * What each plane the last frame drew (a map's or a network's) shows across
 * its room, by state: x and y ranges in its units, ascending; undefined
 * without planes.
 */
function planesOf(items: ItemViews | undefined): Planes | undefined {
  const ranges = new Map<string, { x: readonly [number, number]; y: readonly [number, number] }>();
  for (const { result, state } of items?.panels ?? []) {
    const { plane } = result;
    if (plane && !ranges.has(state))
      ranges.set(state, { x: rangeOf(plane.x)!, y: rangeOf(plane.y)! });
  }
  return ranges.size > 0 ? ranges : undefined;
}

/** Milliseconds an `animation` option takes; 0 when off or unusable. */
export function durationOf(animation: boolean | AnimationSpec | undefined): number {
  if (!animation) return 0;
  const duration = animation === true ? DURATION : (animation.duration ?? DURATION);
  return Number.isFinite(duration) && duration > 0 ? duration : 0;
}

/** Where a change of view from what `panel` draws starts. */
function startOf(panel: DrawnPanel): ViewStart {
  return {
    domains: domainsOf(panel),
    log: {
      x: panel.x.type === "log",
      y: panel.y.type === "log",
      yRight: panel.yRight?.type === "log",
    },
    breaks: panel.x.breaks,
  };
}

/** The ranges a panel draws, ascending, and those its ticks are in; null for category axes. */
function domainsOf(panel: DrawnPanel): ViewDomains {
  const { x, y, yRight } = panel.plans;
  return {
    x: rangeOf(panel.x),
    y: rangeOf(panel.y),
    yRight: panel.yRight ? rangeOf(panel.yRight) : null,
    ticks: {
      x: rangeOf(panel.x, x.within),
      y: rangeOf(panel.y, y.within),
      yRight: panel.yRight ? rangeOf(panel.yRight, yRight?.within) : null,
    },
  };
}

/** A continuous scale's domain (or `range` in it), ascending. */
function rangeOf(
  scale: PositionScale,
  range = scale.domain as readonly number[],
): readonly [number, number] | null {
  if (scale.type === "band") return null;
  const [a, b] = range as readonly [number, number];
  return a <= b ? [a, b] : [b, a];
}

/**
 * The views of planes `elapsed` milliseconds into a transition: the ranges
 * each shows, between those it showed and those it shows at the end. A
 * plane that came since moves from nowhere: it shows where it ends.
 */
function planesAt(
  transition: Pick<Transition, "planes" | "duration" | "ease">,
  to: Planes,
  elapsed: number,
): Planes {
  const t = transition.ease(Math.min(1, Math.max(0, elapsed / transition.duration)));
  const views = new Map<string, { x: readonly [number, number]; y: readonly [number, number] }>();
  for (const [state, end] of to) {
    const start = transition.planes?.get(state) ?? end;
    views.set(state, {
      x: between(start.x, end.x, t, false)!,
      y: between(start.y, end.y, t, false)!,
    });
  }
  return views;
}

/** The ranges of the axes `elapsed` milliseconds into a transition of them. */
export function domainsAt(transition: Transition, to: ViewDomains, elapsed: number): ViewDomains {
  const t = transition.ease(Math.min(1, Math.max(0, elapsed / transition.duration)));
  const { domains: from, log, breaks } = transition.axes!;
  const ranges = (a: Omit<ViewDomains, "ticks">, b: Omit<ViewDomains, "ticks">) => ({
    x: between(a.x, b.x, t, log.x, breaks),
    y: between(a.y, b.y, t, log.y),
    yRight: between(a.yRight, b.yRight, t, log.yRight),
  });
  // Ticks move with the ranges, inside their padding.
  const ticks = from.ticks && to.ticks && ranges(from.ticks, to.ticks);
  return { ...ranges(from, to), ...(ticks && { ticks }) };
}

/**
 * The curves of `animation.easing`, d3's of these names (easeCubicOut,
 * easeLinear, easeCubicInOut): progress from 0 at the start to 1 at the
 * end, without overshooting. Value transitions move with them too.
 */
const EASINGS: Readonly<Record<Easing, (t: number) => number>> = {
  "cubic-out": (t) => 1 - (1 - t) ** 3,
  linear: (t) => t,
  "cubic-in-out": (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2),
};

function between(
  from: readonly [number, number] | null,
  to: readonly [number, number] | null,
  t: number,
  log: boolean,
  breaks?: Breaks,
): readonly [number, number] | null {
  if (!from || !to) return to;
  // A log axis whose ranges are not both positive cannot move through log space.
  if (log && !(from[0] > 0 && to[0] > 0)) return to;
  const lerp = (a: number, b: number) => {
    if (log) return 10 ** (Math.log10(a) + (Math.log10(b) - Math.log10(a)) * t);
    if (!breaks) return a + (b - a) * t;
    const start = breaks.collapse(a);
    return breaks.expand(start + (breaks.collapse(b) - start) * t);
  };
  return [lerp(from[0], to[0]), lerp(from[1], to[1])];
}
