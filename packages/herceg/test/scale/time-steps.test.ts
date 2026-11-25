// Sub-day time ticks step by their interval where its step divides its
// parent unit, and walk one unit at a time across offset changes and for
// steps that do not divide: the same ticks as walking every unit, seeded
// from absolute time, so a repeated hour draws its ticks.
import { describe, expect, it } from "vitest";
import { fromWall, toWall } from "../../src/format/zone.ts";
import { type TimeInterval, type TimeUnit, timeTicks } from "../../src/scale/time.ts";

const UNIT: Partial<Record<TimeUnit, number>> = {
  millisecond: 1,
  second: 1000,
  minute: 60_000,
  hour: 3_600_000,
};
const PARENT: Partial<Record<TimeUnit, number>> = {
  millisecond: 1000,
  second: 60_000,
  minute: 3_600_000,
  hour: 86_400_000,
};

/** Every unit walked from the wall time at `lo`, as ticks were found before stepping. */
function walked(lo: number, hi: number, interval: TimeInterval, zone: string): number[] {
  const unit = UNIT[interval.unit]!;
  const parent = PARENT[interval.unit]!;
  const ticks: number[] = [];
  let t = fromWall(zone, Math.floor(toWall(zone, lo) / unit) * unit);
  for (let guard = 0; t <= hi && guard < 100_000; guard++) {
    const wall = toWall(zone, t);
    if (wall % unit !== 0) {
      t = fromWall(zone, Math.ceil(wall / unit) * unit);
      continue;
    }
    const within = ((wall % parent) + parent) % parent;
    if (t >= lo && Math.round(within / unit) % interval.step === 0) ticks.push(t);
    t += unit;
  }
  return ticks;
}

const interval = (unit: TimeUnit, step: number): TimeInterval => ({
  unit,
  step,
  duration: UNIT[unit]! * step,
});

/** A seeded generator of numbers in [0, 1). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe("sub-day ticks by interval", () => {
  const steps: [TimeUnit, number][] = [
    ["millisecond", 1],
    ["millisecond", 20],
    ["millisecond", 100],
    ["millisecond", 200],
    ["millisecond", 500],
    ["second", 1],
    ["second", 5],
    ["second", 15],
    ["second", 30],
    ["minute", 1],
    ["minute", 10],
    ["minute", 30],
    ["hour", 1],
    ["hour", 2],
    ["hour", 3],
    ["hour", 5],
    ["hour", 6],
    ["hour", 12],
  ];
  // Offset changes in 2026: London's in March and October, New York's,
  // Lord Howe's half hours; and summer days, and Kolkata's +5:30 all year.
  const around = [
    Date.UTC(2026, 2, 29, 1),
    Date.UTC(2026, 9, 25, 1),
    Date.UTC(2026, 2, 8, 7),
    Date.UTC(2026, 10, 1, 6),
    Date.UTC(2026, 3, 4, 15),
    Date.UTC(2026, 9, 3, 15, 30),
    Date.UTC(2026, 5, 1),
  ];

  it.each(["UTC", "Europe/London", "America/New_York", "Asia/Kolkata", "Australia/Lord_Howe"])(
    "match every unit walked on windows across offset changes in %s",
    (zone) => {
      const next = random(zone.length);
      for (let n = 0; n < 1500; n++) {
        const [unit, step] = steps[Math.floor(next() * steps.length)]!;
        const size = UNIT[unit]! * step;
        const span = size * (2 + next() * 40);
        // Windows from whole and fractional instants, within the walk's reach.
        const lo =
          around[Math.floor(next() * around.length)]! - span * next() + (next() < 0.3 ? next() : 0);
        if (span / UNIT[unit]! > 50_000) continue;
        const ticks = timeTicks(lo, lo + span, interval(unit, step), zone);
        // Where a repeated hour starts a walk from its earlier instant, the walk runs out first.
        const walk = walked(lo, lo + span, interval(unit, step), zone);
        if (walk.length === 0 && ticks.length > 0 && unit === "millisecond") continue;
        expect(ticks, `${zone} ${unit} ${step} from ${lo}`).toEqual(walk);
      }
    },
  );

  it("draw a 1.2-second window in London's repeated hour", () => {
    // 01:30 GMT on 2026-10-25 came an hour after 01:30 BST: a walk from the
    // wall time started at the earlier and ran out before reaching the window.
    const lo = Date.UTC(2026, 9, 25, 1, 30);
    const ms100 = interval("millisecond", 100);
    expect(walked(lo, lo + 1200, ms100, "Europe/London")).toEqual([]);
    const ticks = timeTicks(lo, lo + 1200, ms100, "Europe/London");
    expect(ticks).toEqual(Array.from({ length: 13 }, (_, k) => lo + 100 * k));
    // The hour itself, twice: 01:00 BST, then 01:00 GMT.
    const hours = timeTicks(
      Date.UTC(2026, 9, 24, 23),
      Date.UTC(2026, 9, 25, 3),
      interval("hour", 1),
      "Europe/London",
    );
    expect(hours.map((t) => new Date(toWall("Europe/London", t)).getUTCHours())).toEqual([
      0, 1, 1, 2, 3,
    ]);
  });

  it("start steps that do not divide their parent again each day", () => {
    const ticks = timeTicks(
      Date.UTC(2026, 5, 1, 18),
      Date.UTC(2026, 5, 2, 12),
      interval("hour", 5),
      "UTC",
    );
    expect(ticks.map((t) => new Date(t).getUTCHours())).toEqual([20, 0, 5, 10]);
  });

  it("keep whole milliseconds from a fractional start, and stay bounded", () => {
    const ticks = timeTicks(
      1_700_000_000_000.3,
      1_700_000_001_000,
      interval("millisecond", 100),
      "Asia/Kolkata",
    );
    expect(ticks.every(Number.isInteger)).toBe(true);
    expect(ticks[0]).toBe(1_700_000_000_100);
    // A day of milliseconds: the guard bounds the ticks, as it bounded the walk.
    expect(timeTicks(0, 86_400_000, interval("millisecond", 1), "UTC").length).toBe(100_000);
  });
});
