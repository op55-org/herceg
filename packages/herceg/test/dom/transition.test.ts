import { describe, expect, it, vi } from "vitest";
import { domainsAt, durationOf, type Transition, ViewAnimation } from "../../src/dom/transition.ts";
import type { ChartModel, DrawnPanel, ViewDomains } from "../../src/model/model.ts";
import { ChartError } from "../../src/spec/errors.ts";
import type { AnimationSpec, Easing } from "../../src/spec/spec.ts";

// Frames are counted by the scheduler, which runs none in Node; the page's
// last frame time, and the one-off work left out of the frame running.
const clock = vi.hoisted(() => ({ frames: 0, page: 0, left: [] as number[] }));
vi.mock("../../src/dom/scheduler.ts", () => ({
  frameCount: () => clock.frames,
  lastFrameTime: () => clock.page,
  leaveOut: (ms: number) => clock.left.push(ms),
}));

/**
 * View transitions of a fresh module, whose record of the page's work left
 * out (`ViewAnimation.spare`) is empty, whatever tests ran before.
 */
async function fresh(): Promise<typeof ViewAnimation> {
  vi.resetModules();
  return (await import("../../src/dom/transition.ts")).ViewAnimation;
}

/** The curve a chart with `animation` moves along, and what it told of. */
function easingOf(animation: boolean | AnimationSpec | undefined, told: string[] = []) {
  const model = { config: { animation } } as unknown as ChartModel;
  return new ViewAnimation(model, null, (error) => told.push(error.message), ChartError).easing();
}

const transition = (domains: ViewDomains, log = false, ease = easingOf(undefined)): Transition => ({
  batch: { frame: 0, costs: new Map() },
  axes: { domains, log: { x: false, y: log, yRight: false } },
  planes: undefined,
  to: undefined,
  start: 0,
  duration: 200,
  ease,
});

describe("easings", () => {
  // d3's easeCubicOut, easeLinear, and easeCubicInOut, as d3-ease writes them.
  const d3 = {
    "cubic-out": (t: number) => --t * t * t + 1,
    linear: (t: number) => +t,
    "cubic-in-out": (t: number) => {
      const u = t * 2;
      return (u <= 1 ? u * u * u : (u - 2) * (u - 2) * (u - 2) + 2) / 2;
    },
  };

  it("are d3's curves of their names, from 0 to 1 without overshooting", () => {
    for (const [name, reference] of Object.entries(d3)) {
      const curve = easingOf({ easing: name as Easing });
      expect(curve(0), name).toBe(0);
      expect(curve(1), name).toBe(1);
      let previous = 0;
      for (let t = 0; t <= 1; t += 1 / 64) {
        expect(curve(t), `${name} at ${t}`).toBeCloseTo(reference(t), 12);
        expect(curve(t)).toBeGreaterThanOrEqual(previous);
        previous = curve(t);
      }
    }
    expect(easingOf({ easing: "cubic-out" })(0.5)).toBe(0.875);
    expect(easingOf({ easing: "linear" })(0.5)).toBe(0.5);
    expect(easingOf({ easing: "cubic-in-out" })(0.25)).toBe(0.0625);
    expect(easingOf({ easing: "cubic-in-out" })(0.5)).toBe(0.5);
  });

  it("are read from the animation option, cubic-out by default", () => {
    const cubicOut = easingOf({ easing: "cubic-out" });
    expect(easingOf(undefined)).toBe(cubicOut);
    expect(easingOf(true)).toBe(cubicOut);
    expect(easingOf({ duration: 300 })).toBe(cubicOut);
    expect(easingOf({ values: true, easing: "cubic-in-out" })).not.toBe(cubicOut);
    // Specs and the types refuse other names; JavaScript given one moves as
    // by default, and is told of.
    for (const name of ["bounce", "toString", ""]) {
      const told: string[] = [];
      expect(easingOf({ easing: name as never }, told)).toBe(cubicOut);
      expect(told).toEqual([
        `animation.easing: expected "cubic-out", "linear", or "cubic-in-out"; received ${JSON.stringify(name)}`,
      ]);
    }
  });
});

describe("view transitions", () => {
  it("take 250 ms when on, a given duration, or none", () => {
    expect(durationOf(undefined)).toBe(0);
    expect(durationOf(false)).toBe(0);
    expect(durationOf(true)).toBe(250);
    expect(durationOf({})).toBe(250);
    expect(durationOf({ duration: 0 })).toBe(0);
    expect(durationOf({ duration: 400 })).toBe(400);
  });

  it("ease out from the start to the end without overshooting", () => {
    const moving = transition({ x: [0, 100], y: [0, 10], yRight: null });
    const to = { x: [50, 60], y: [0, 20], yRight: null } as const;
    expect(domainsAt(moving, to, 0)).toEqual({ x: [0, 100], y: [0, 10], yRight: null });
    // Cubic ease-out: seven eighths of the way at half time.
    const half = domainsAt(moving, to, 100);
    expect(half.x![0]).toBeCloseTo(43.75);
    expect(half.x![1]).toBeCloseTo(65);
    let previous = 0;
    for (let elapsed = 0; elapsed <= 300; elapsed += 10) {
      const [lo] = domainsAt(moving, to, elapsed).x!;
      expect(lo).toBeGreaterThanOrEqual(previous);
      expect(lo).toBeLessThanOrEqual(50);
      previous = lo;
    }
    expect(domainsAt(moving, to, 500).x).toEqual([50, 60]);
    // A linear transition is half way at half time; cubic in-out too, slower at first.
    const even = transition(
      { x: [0, 100], y: [0, 10], yRight: null },
      false,
      easingOf({ easing: "linear" }),
    );
    expect(domainsAt(even, to, 100).x).toEqual([25, 80]);
    expect(domainsAt(even, to, 50).x).toEqual([12.5, 90]);
    const d3 = transition(
      { x: [0, 100], y: [0, 10], yRight: null },
      false,
      easingOf({ easing: "cubic-in-out" }),
    );
    expect(domainsAt(d3, to, 100).x).toEqual([25, 80]);
    expect(domainsAt(d3, to, 50).x![0]).toBeCloseTo(3.125);
  });

  it("start with the chart's easing", () => {
    // A frame of its own: no batch of another test's.
    clock.frames++;
    const scale = (domain: number[]) => ({ type: "linear", domain }) as unknown as DrawnPanel["x"];
    const plans = { x: {}, y: {} } as DrawnPanel["plans"];
    const panel = { x: scale([0, 100]), y: scale([0, 10]), plans } as DrawnPanel;
    const set: unknown[] = [];
    const moving = new ViewAnimation(
      {
        config: { animation: { duration: 200, easing: "linear" } },
        setTransitionDomains: (domains: unknown) => set.push(domains),
      } as unknown as ChartModel,
      null,
      () => {},
      ChartError,
    );
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    expect(moving.start(panel, { duration: 200, easing: "linear" }, 1)).toBe(true);
    clock.frames++;
    now.mockReturnValue(100);
    const to = () => ({ x: scale([50, 60]), y: scale([0, 20]), plans }) as DrawnPanel;
    expect(moving.step(to, 1)).toBe(true);
    expect((set.at(-1) as ViewDomains).x).toEqual([25, 80]);
    now.mockRestore();
  });

  it("tell of an easing that is none once per option", () => {
    const model = { config: { animation: { easing: "bounce" } } } as unknown as ChartModel;
    const told: string[] = [];
    const animation = new ViewAnimation(
      model,
      null,
      (error) => told.push(error.message),
      ChartError,
    );
    animation.easing();
    expect(told).toEqual([
      'animation.easing: expected "cubic-out", "linear", or "cubic-in-out"; received "bounce"',
    ]);
    // Another option is checked again.
    (model as { config: unknown }).config = { animation: { easing: "toString" } };
    animation.easing();
    (model as { config: unknown }).config = { animation: { easing: "linear" } };
    animation.easing();
    expect(told).toHaveLength(2);
    expect(told[1]).toMatch(/received "toString"$/);
  });

  it("move log axes evenly in log space, and snap axes they cannot move", () => {
    const moving = transition({ x: [0, 1], y: [1, 10], yRight: null }, true);
    const at = domainsAt(moving, { x: [0, 1], y: [1, 1000], yRight: [5, 6] }, 100);
    expect(at.y![1]).toBeCloseTo(10 ** 2.75);
    // A right axis appearing has nothing to move from.
    expect(at.yRight).toEqual([5, 6]);
    const unusable = transition({ x: [0, 1], y: [0, 10], yRight: null }, true);
    expect(domainsAt(unusable, { x: [0, 1], y: [1, 100], yRight: null }, 100).y).toEqual([1, 100]);
  });

  it("never leave out work twice, within other work left out or beside it", async () => {
    clock.left = [];
    const Fresh = await fresh();
    const views = new Fresh({ config: {} } as unknown as ChartModel, null, () => {}, ChartError);
    // Work one after another is left out whole.
    views.spare(0, 10);
    views.spare(20, 30);
    expect(clock.left).toEqual([10, 10]);
    // A build from 100 to 150 ms drew another chart at once, whose build
    // (110 to 120) was left out first: the build around it counts whole,
    // with what the other drew after its build.
    views.spare(110, 120);
    views.spare(100, 150);
    expect(clock.left).toEqual([10, 10, 10]);
    // So does work ending before work left out after it.
    views.spare(200, 210);
    views.spare(180, 195);
    expect(clock.left).toEqual([10, 10, 10, 10]);
    clock.left = [];
  });

  it("leave planning out of the page's frame, once, when the view moves on", async () => {
    clock.left = [];
    const Fresh = await fresh();
    const left = () => clock.left.reduce((sum, ms) => sum + ms, 0);
    let time = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => time);
    const scale = (domain: number[]) => ({ type: "linear", domain }) as unknown as DrawnPanel["x"];
    const plans = { x: {}, y: {} } as DrawnPanel["plans"];
    const panel = { x: scale([0, 100]), y: scale([0, 10]), plans } as DrawnPanel;
    // Planning builds the scene of the view asked for: here, 30 ms.
    const plan = () => {
      time += 30;
      return { x: scale([20, 40]), y: scale([0, 5]), plans } as DrawnPanel;
    };
    const model = { config: {}, setTransitionDomains() {} } as unknown as ChartModel;
    const animation = new Fresh(model, null, () => {}, ChartError);
    clock.frames++;
    expect(animation.start(panel, true, 1)).toBe(true);
    expect(animation.step(plan, 1)).toBe(true);
    expect(left()).toBe(30);
    // The chart's own frames never counted it; slow ones still end it.
    time += 16;
    expect(animation.step(plan, 1)).toBe(true);
    time += 16;
    expect(animation.step(plan, 11)).toBe(false);
    expect(left()).toBe(30);
    // A plan whose view jumps at once (here, after a slow page frame) is not left out.
    clock.frames++;
    clock.page = 12;
    expect(animation.start(panel, true, 1)).toBe(true);
    expect(animation.step(plan, 1)).toBe(false);
    expect(left()).toBe(30);
    clock.page = 0;
    clock.left = [];
    vi.restoreAllMocks();
  });

  it("count each chart once toward the first frame of the charts moving together", () => {
    const model = { config: {}, setTransitionDomains() {} } as unknown as ChartModel;
    const scale = (domain: number[]) => ({ type: "linear", domain }) as unknown as DrawnPanel["x"];
    const plans = { x: {}, y: {} } as DrawnPanel["plans"];
    const panel = { x: scale([0, 100]), y: scale([0, 10]), plans } as DrawnPanel;
    const plan = () => ({ x: scale([20, 40]), y: scale([0, 5]), plans }) as DrawnPanel;
    const animation = new ViewAnimation(model, null, () => {}, ChartError);
    // Asked for twice before a frame, a 3 ms chart still plans one view and draws one frame.
    expect(animation.start(panel, true, 3)).toBe(true);
    expect(animation.start(panel, true, 3)).toBe(true);
    expect(animation.step(plan, 3)).toBe(true);
    // Three such charts moving together would take 18 ms: all jump, whichever
    // draws first.
    animation.settle();
    clock.frames++;
    const together = [
      animation,
      new ViewAnimation(model, null, () => {}, ChartError),
      new ViewAnimation(model, null, () => {}, ChartError),
    ];
    for (const each of together) each.start(panel, true, 3);
    expect(together.map((each) => each.step(plan, 3))).toEqual([false, false, false]);
    expect(durationOf({ duration: Number.POSITIVE_INFINITY })).toBe(0);
  });
});
