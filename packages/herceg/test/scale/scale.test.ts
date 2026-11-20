import { describe, expect, it } from "vitest";
import { numberTickLabels, timeTickLabels } from "../../src/format/format.ts";
import { fromWall, toWall, zoneOffset } from "../../src/format/zone.ts";
import { alphaOf } from "../../src/scale/alpha.ts";
import { colorChannels, isLightColor } from "../../src/scale/color.ts";
import { BandScale, LinearScale, LogScale, niceLogDomain } from "../../src/scale/scale.ts";
import { linearTicks, niceDomain, tickStep } from "../../src/scale/ticks.ts";
import { chooseInterval, niceTimeDomain, TimeScale, timeTicks } from "../../src/scale/time.ts";

const utc = (iso: string) => Date.parse(`${iso}Z`);

describe("linear ticks", () => {
  it("uses 1, 2, 5 steps", () => {
    expect(tickStep(0, 10, 5)).toBe(2);
    expect(tickStep(0, 1, 10)).toBe(0.1);
    expect(tickStep(0, 100, 3)).toBe(50);
  });

  it("produces exact decimal ticks", () => {
    expect(linearTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(linearTicks(0.1, 0.35, 5)).toEqual([0.1, 0.15, 0.2, 0.25, 0.3, 0.35]);
    expect(linearTicks(-3, 3, 6)).toEqual([-3, -2, -1, 0, 1, 2, 3]);
  });

  it("handles degenerate input", () => {
    expect(linearTicks(5, 5, 5)).toEqual([5]);
    expect(linearTicks(0, Number.NaN, 5)).toEqual([]);
    expect(linearTicks(10, 0, 5)).toEqual([0, 2, 4, 6, 8, 10]);
  });

  it("terminates when the step is below the values' precision", () => {
    expect(linearTicks(1, 1 + Number.EPSILON, 10)).toEqual([1, 1 + Number.EPSILON]);
    expect(linearTicks(5e-324, 1e-323, 10).length).toBeGreaterThan(0);
  });

  it("handles very large and very small magnitudes", () => {
    expect(linearTicks(0, 3e12, 3)).toEqual([0, 1e12, 2e12, 3e12]);
    expect(linearTicks(0, 3e-9, 3)).toEqual([0, 1e-9, 2e-9, 3e-9]);
  });

  it("labels a zero tick without a minus sign", () => {
    // Math.ceil(-0.25) is -0, so ticks across zero can start at negative zero.
    const ticks = linearTicks(-0.5, 21.5, 10);
    expect(numberTickLabels(ticks, "en-US")[0]).toBe("0");
  });

  it("extends domains to nice values", () => {
    expect(niceDomain(0.13, 9.7, 10)).toEqual([0, 10]);
    expect(niceDomain(-12, 87, 5)).toEqual([-20, 100]);
    expect(niceDomain(9.7, 0.13, 10)).toEqual([10, 0]);
  });
});

describe("LinearScale", () => {
  it("maps and inverts", () => {
    const scale = new LinearScale([0, 10], [100, 0]);
    expect(scale.map(0)).toBe(100);
    expect(scale.map(5)).toBe(50);
    expect(scale.invert(25)).toBe(7.5);
  });

  it("keeps precision for narrow domains far from zero", () => {
    const scale = new LinearScale([1e15, 1e15 + 1], [0, 100]);
    expect(scale.map(1e15 + 1)).toBe(100);
    const zoomed = new LinearScale([1_767_225_600_000, 1_767_225_600_010], [0, 1000]);
    expect(zoomed.map(1_767_225_600_005)).toBe(500);
    expect(zoomed.invert(500)).toBe(1_767_225_600_005);
  });

  it("does not overflow for opposite extreme endpoints", () => {
    const scale = new LinearScale([-Number.MAX_VALUE, Number.MAX_VALUE], [0, 100]);
    expect(scale.map(0)).toBeCloseTo(50);
  });

  it("maps a zero-width domain to the middle of the range", () => {
    const scale = new LinearScale([3, 3], [0, 100]);
    expect(scale.map(3)).toBe(50);
    expect(scale.invert(10)).toBe(3);
  });
});

describe("LogScale", () => {
  it("maps decades evenly", () => {
    const scale = new LogScale([1, 1000], [0, 300]);
    expect(scale.map(10)).toBeCloseTo(100);
    expect(scale.invert(200)).toBeCloseTo(100);
    expect(scale.map(-1)).toBeNaN();
  });

  // Golden values from d3-scale 4's scaleLog: ticks(count), and the ticks
  // tickFormat(count) labels (with d3's count of 10 where they differ).
  const digits = (from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i) => from + i).flatMap((e) =>
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (e < 0 ? d / 10 ** -e : d * 10 ** e)),
    );
  const log = (domain: [number, number], count: number) => {
    const { ticks, labelled } = new LogScale(domain, [0, 1]).labelledTicks(count);
    return { ticks, shown: ticks.filter((_, k) => labelled?.[k] ?? true), labelled };
  };

  it("ticks every digit where the domain spans fewer decades than the count, as d3", () => {
    // Study B1: [1/k, k] for k = 6.54 at d3's count of 10.
    const b1 = log([1 / 6.54, 6.54], 10);
    expect(b1.ticks).toEqual([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, 3, 4, 5, 6]);
    expect(b1.shown).toEqual([0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 1, 2, 3, 4, 5, 6]);
    expect(log([1, 100], 10).ticks).toEqual(digits(0, 1).concat(100));
    expect(log([1, 100], 10).shown).toEqual([1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 100]);
    expect(log([1, 1000], 8).shown).toEqual([1, 2, 10, 20, 100, 200, 1000]);
    expect(log([1, 10], 10).shown).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(log([1, 10], 2).shown).toEqual([1, 2, 10]);
    // Six decades at 10: 55 ticks, labelled at powers of ten.
    const wide = log([1, 1e6], 10);
    expect(wide.ticks).toEqual(digits(0, 5).concat(1e6));
    expect(wide.shown).toEqual([1, 10, 100, 1e3, 1e4, 1e5, 1e6]);
  });

  it("labels the leading digits that fit the count, the ticks the same", () => {
    const b1 = (count: number) => log([1 / 6.54, 6.54], count);
    expect(b1(13).shown).toEqual(b1(13).ticks);
    expect(b1(7).ticks).toEqual(b1(10).ticks);
    expect(b1(7).shown).toEqual([0.2, 0.3, 0.4, 0.5, 1, 2, 3, 4, 5]);
    expect(log([1, 100], 5).shown).toEqual([1, 2, 10, 20, 100]);
  });

  it("ticks powers of ten at a round step of decades past the count, as d3", () => {
    const powers = log([1e-5, 1e7], 5);
    expect(powers.ticks).toEqual([1e-4, 0.01, 1, 100, 1e4, 1e6]);
    expect(powers.shown).toEqual(powers.ticks);
    expect(log([1e-5, 1e7], 10).ticks).toEqual([
      1e-5, 1e-4, 1e-3, 0.01, 0.1, 1, 10, 100, 1e3, 1e4, 1e5, 1e6, 1e7,
    ]);
    expect(log([1, 1e20], 10).ticks).toEqual(
      Array.from({ length: 11 }, (_, i) => Number(`1e${2 * i}`)),
    );
    // One power of ten, as d3 gives it, and at a count whose step passes
    // over every decade (as writtenTicks may ask), d3's retry at twice it.
    expect(log([2, 5000], 2).ticks).toEqual([100]);
    expect(log([2, 5000], 1).ticks).toEqual([100]);
    expect(log([2, 5000], 1.5).ticks).toEqual([100]);
    expect(log([2, 5000], 0.5).ticks).toEqual([100]);
    // Below 1, d3's step for the count itself (five decades), not for 1.
    expect(log([0.5, 500], 0.6).ticks).toEqual([1]);
    expect(log([1, 1e6], 0).ticks).toEqual([]);
  });

  it("ticks subnormal decades, every digit as the double nearest it", () => {
    const tiny = log([1e-310, 1e-307], 10);
    expect(tiny.ticks.slice(0, 3)).toEqual([1e-310, 2e-310, 3e-310]);
    expect(tiny.ticks).toHaveLength(28);
    expect(tiny.shown).toEqual([
      1e-310, 2e-310, 3e-310, 1e-309, 2e-309, 3e-309, 1e-308, 2e-308, 3e-308, 1e-307,
    ]);
    expect(log([1e-320, 1e-300], 2).ticks).toEqual([1e-320, 1e-310, 1e-300]);
    // Inexact logs of subnormal ends keep the decades at the ends.
    expect(log([1e-320, 1e-319], 10).ticks.at(-1)).toBe(1e-319);
    expect(log([1e-323, 1e-321], 2).ticks).toEqual([1e-323, 1e-322, 1e-321]);
    // Digits too close for a subnormal double are one tick each, labelled
    // as the least of them: 8e-324 rounds to 1e-323, a power of ten.
    const least = log([Number.MIN_VALUE, 1e-322], 10).ticks;
    expect(new Set(least).size).toBe(least.length);
    const powers = log([1e-323, 1e-321], 10);
    for (const power of [1e-323, 1e-322, 1e-321]) expect(powers.shown).toContain(power);
  });

  it("ticks reversed and sub-unit domains by the same rule, ascending", () => {
    const reversed = log([1000, 1], 10);
    expect(reversed.ticks).toEqual(log([1, 1000], 10).ticks);
    expect(reversed.shown).toEqual([1, 2, 3, 10, 20, 30, 100, 200, 300, 1000]);
    expect(log([6.54, 1 / 6.54], 10).shown).toEqual(log([1 / 6.54, 6.54], 10).shown);
    const small = log([0.001, 0.05], 10);
    expect(small.ticks).toEqual(digits(-3, -3).concat([0.01, 0.02, 0.03, 0.04, 0.05]));
    expect(small.shown).not.toContain(0.008);
    expect(small.shown).not.toContain(0.009);
    // Ends at exact digits are ticks, as the doubles nearest them.
    expect(log([0.3, 3], 5).ticks[0]).toBe(0.3);
    expect(log([0.3, 3], 5).shown).toEqual([0.3, 0.4, 0.5, 1, 2, 3]);
  });

  it("falls back to linear ticks, all labelled, where digits are fewer than half the count", () => {
    expect(log([3, 4], 5)).toEqual({
      ticks: [3, 3.2, 3.4, 3.6, 3.8, 4],
      shown: [3, 3.2, 3.4, 3.6, 3.8, 4],
      labelled: undefined,
    });
    // d3 applies the digit rule to these too and labels none of them.
    expect(log([7.6, 9], 10).shown).toHaveLength(15);
    expect(log([5, 5.5], 3).shown).toEqual([5, 5.2, 5.4]);
  });

  it("rejects non-positive and infinite domains", () => {
    expect(() => new LogScale([0, 10], [0, 1])).toThrow(/positive/);
    expect(() => new LogScale([1, Number.POSITIVE_INFINITY], [0, 1])).toThrow(/finite/);
  });

  it("falls back to linear ticks within a decade", () => {
    expect(new LogScale([3, 4], [0, 100]).ticks(5).length).toBeGreaterThanOrEqual(2);
  });

  it("extends reversed log domains outward", () => {
    expect(niceLogDomain(90, 2)).toEqual([100, 1]);
  });
});

describe("BandScale", () => {
  it("lays out equal bands with equal gaps", () => {
    const scale = new BandScale(["a", "b", "c"], [0, 310], 0.1);
    expect(scale.step).toBeCloseTo(100);
    expect(scale.bandwidth).toBeCloseTo(90);
    expect(scale.start(0)).toBeCloseTo(10);
    expect(scale.start(2) + scale.bandwidth).toBeCloseTo(300);
    expect(scale.map(1)).toBeCloseTo(155);
    expect(scale.index(55)).toBe(0);
    expect(scale.index(150)).toBe(1);
    expect(scale.index(400)).toBe(-1);
    expect(scale.invert(scale.map(2))).toBeCloseTo(2);
  });

  it("works on reversed ranges and thins ticks", () => {
    const scale = new BandScale(["a", "b", "c", "d"], [400, 0], 0);
    expect(scale.map(0)).toBeCloseTo(350);
    expect(scale.index(10)).toBe(3);
    expect(new BandScale(Array.from({ length: 100 }, String), [0, 1]).ticks(10)).toHaveLength(10);
  });
});

describe("time ticks", () => {
  it("chooses calendar intervals", () => {
    expect(chooseInterval(60_000, 6)).toMatchObject({ unit: "second", step: 10 });
    expect(chooseInterval(24 * 3_600_000, 8)).toMatchObject({ unit: "hour", step: 3 });
    expect(chooseInterval(365 * 86_400_000, 12)).toMatchObject({ unit: "month", step: 1 });
    expect(chooseInterval(50, 5)).toMatchObject({ unit: "millisecond", step: 10 });
  });

  it("aligns hour ticks to the day in UTC", () => {
    const start = utc("2026-03-01T01:20:00");
    const stop = utc("2026-03-01T13:00:00");
    const ticks = timeTicks(start, stop, { unit: "hour", step: 3, duration: 3 * 3_600_000 }, "UTC");
    expect(ticks.map((t) => new Date(t).toISOString().slice(11, 16))).toEqual([
      "03:00",
      "06:00",
      "09:00",
      "12:00",
    ]);
  });

  it("aligns day ticks to local midnight in a time zone", () => {
    const zone = "America/New_York";
    const ticks = timeTicks(
      utc("2026-03-01T00:00:00"),
      utc("2026-03-04T00:00:00"),
      chooseInterval(3 * 86_400_000, 3),
      zone,
    );
    // Midnight in New York is 05:00 UTC in winter.
    expect(ticks.map((t) => new Date(t).toISOString())).toEqual([
      "2026-03-01T05:00:00.000Z",
      "2026-03-02T05:00:00.000Z",
      "2026-03-03T05:00:00.000Z",
    ]);
  });

  it("keeps day ticks at midnight across a DST change", () => {
    const zone = "Europe/Belgrade";
    // DST starts 2026-03-29 02:00 local.
    const ticks = timeTicks(
      utc("2026-03-27T00:00:00"),
      utc("2026-03-31T00:00:00"),
      { unit: "day", step: 1, duration: 86_400_000 },
      zone,
    );
    expect(ticks.map((t) => toWall(zone, t) % 86_400_000)).toEqual([0, 0, 0, 0]);
    expect(ticks[2]! - ticks[1]!).toBe(23 * 3_600_000);
  });

  it("handles zones with 45-minute offsets", () => {
    const zone = "Asia/Kathmandu";
    expect(zoneOffset(zone, utc("2026-06-01T00:00:00"))).toBe((5 * 60 + 45) * 60_000);
    const ticks = timeTicks(
      utc("2026-06-01T00:00:00"),
      utc("2026-06-01T06:00:00"),
      { unit: "hour", step: 1, duration: 3_600_000 },
      zone,
    );
    expect(ticks.every((t) => toWall(zone, t) % 3_600_000 === 0)).toBe(true);
  });

  it("resolves skipped wall times forward and repeated ones to the earlier instant", () => {
    const zone = "America/New_York";
    // 2026-03-08 02:30 does not exist; clocks read 03:30 EDT.
    expect(new Date(fromWall(zone, utc("2026-03-08T02:30:00"))).toISOString()).toBe(
      "2026-03-08T07:30:00.000Z",
    );
    // 2026-11-01 01:30 happens twice; the first is EDT.
    expect(new Date(fromWall(zone, utc("2026-11-01T01:30:00"))).toISOString()).toBe(
      "2026-11-01T05:30:00.000Z",
    );
  });

  it("never repeats or reverses ticks across a spring-forward change", () => {
    const zone = "America/New_York";
    const halfHours = { unit: "minute" as const, step: 30, duration: 1_800_000 };
    const ticks = timeTicks(
      utc("2026-03-08T05:00:00"),
      utc("2026-03-08T09:00:00"),
      halfHours,
      zone,
    );
    for (let i = 1; i < ticks.length; i++) expect(ticks[i]!).toBeGreaterThan(ticks[i - 1]!);
    expect(ticks.map((t) => new Date(toWall(zone, t)).toISOString().slice(11, 16))).toEqual([
      "00:00",
      "00:30",
      "01:00",
      "01:30",
      "03:00",
      "03:30",
      "04:00",
      "04:30",
      "05:00",
    ]);
  });

  it("keeps both occurrences of a repeated hour when clocks fall back", () => {
    const zone = "America/New_York";
    const hours = { unit: "hour" as const, step: 1, duration: 3_600_000 };
    const ticks = timeTicks(utc("2026-11-01T04:00:00"), utc("2026-11-01T08:00:00"), hours, zone);
    expect(ticks.map((t) => new Date(toWall(zone, t)).toISOString().slice(11, 13))).toEqual([
      "00",
      "01",
      "01",
      "02",
      "03",
    ]);
  });

  it("round-trips wall times", () => {
    const zone = "Australia/Adelaide";
    const t = utc("2026-01-15T10:30:00");
    expect(fromWall(zone, toWall(zone, t))).toBe(t);
  });

  it("extends a time domain to interval boundaries", () => {
    const [lo, hi] = niceTimeDomain(
      utc("2026-01-01T00:07:00"),
      utc("2026-01-01T00:52:00"),
      6,
      "UTC",
    );
    expect(new Date(lo).toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(new Date(hi).toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });

  it("encloses times in the hour repeated when daylight saving time ends", () => {
    const zone = "America/New_York";
    // 06:00Z and 06:15Z are 01:00 and 01:15 EST, the second 1 o'clock hour.
    for (const [start, stop] of [
      ["2026-11-01T06:00:00", "2026-11-01T06:15:00"],
      ["2026-11-01T06:10:00", "2026-11-01T06:10:30"],
    ] as const) {
      const [lo, hi] = niceTimeDomain(utc(start), utc(stop), 6, zone);
      expect(lo).toBeLessThanOrEqual(utc(start));
      expect(hi).toBeGreaterThanOrEqual(utc(stop));
    }
  });

  it("uses year ticks for long spans", () => {
    const scale = new TimeScale(
      [utc("1900-01-01T00:00:00"), utc("2000-01-01T00:00:00")],
      [0, 1],
      "UTC",
    );
    expect(scale.ticks(5).map((t) => new Date(t).getUTCFullYear())).toEqual([
      1900, 1920, 1940, 1960, 1980, 2000,
    ]);
  });
});

describe("tick labels", () => {
  it("formats numbers with the decimals the step needs", () => {
    expect(numberTickLabels([0, 0.5, 1], "en-US")).toEqual(["0.0", "0.5", "1.0"]);
    expect(numberTickLabels([0, 2000, 4000], "en-US")).toEqual(["0", "2,000", "4,000"]);
    expect(numberTickLabels([0, 2.5e6, 5e6], "en-US")).toEqual(["0", "2.5M", "5M"]);
  });

  it("keeps tiny ticks distinguishable", () => {
    const labels = numberTickLabels([0, 1e-16, 2e-16], "en-US");
    expect(new Set(labels).size).toBe(3);
  });

  it("labels time ticks by alignment", () => {
    const ticks = [
      utc("2026-01-01T18:00:00"),
      utc("2026-01-02T00:00:00"),
      utc("2026-01-02T06:00:00"),
    ];
    expect(
      timeTickLabels(ticks, { unit: "hour", step: 6, duration: 6 * 3_600_000 }, "UTC", "en-US"),
    ).toEqual(["18:00", "Jan 2", "06:00"]);
    const months = [
      utc("2025-11-01T00:00:00"),
      utc("2025-12-01T00:00:00"),
      utc("2026-01-01T00:00:00"),
    ];
    expect(
      timeTickLabels(months, { unit: "month", step: 1, duration: 30 * 86_400_000 }, "UTC", "en-US"),
    ).toEqual(["Nov", "Dec", "2026"]);
  });
});

describe("alphaOf", () => {
  it("reads a color's own alpha, and takes colors it cannot read as opaque", () => {
    expect(
      ["transparent", "#f000", "#ff000000", "rgba(1, 2, 3, 0)", "rgb(1 2 3 / 0%)"].map(alphaOf),
    ).toEqual([0, 0, 0, 0, 0]);
    expect(alphaOf("oklch(0.5 0.1 200 / 0.25)")).toBe(0.25);
    expect(alphaOf("rgb(0, 0, 0)")).toBe(1);
    // Of a mix, only the mix's alpha would say; it is not read.
    expect(alphaOf("color-mix(in srgb, rgb(255 0 0 / 0), blue)")).toBe(1);
    expect(alphaOf("var(--series-1)")).toBe(1);
  });
});

describe("isLightColor", () => {
  it("reads hex, rgb(), and hsl() colors and leaves names undecided", () => {
    expect(isLightColor("#fff")).toBe(true);
    expect(isLightColor("#0b0b0b")).toBe(false);
    expect(isLightColor("rgb(255, 255, 255)")).toBe(true);
    expect(isLightColor("rgb(255 255 255 / 50%)")).toBe(true);
    expect(isLightColor("rgba(10, 10, 10, 0.5)")).toBe(false);
    expect(isLightColor("rgb(100%, 100%, 100%)")).toBe(true);
    expect(isLightColor("hsl(60, 100%, 50%)")).toBe(true);
    expect(isLightColor("hsl(240 100% 25%)")).toBe(false);
    expect(isLightColor("white")).toBeUndefined();
  });
});

describe("colorChannels", () => {
  it("reads hex, rgb(), and hsl() colors in degrees", () => {
    const blue = [0, 0, 255, 1];
    expect(colorChannels(" #0000FF ")).toEqual(blue);
    expect(colorChannels("rgb(0 128 255 / 0.5)")).toEqual([0, 128, 255, 0.5]);
    expect(colorChannels("rgba(0, 50%, 100%, 50%)")).toEqual([0, 127.5, 255, 0.5]);
    expect(colorChannels("hsl(240 100% 50%)")?.map(Math.round)).toEqual(blue);
    expect(colorChannels("hsl(600deg 100% 50%)")?.map(Math.round)).toEqual(blue);
  });

  it("leaves to the page what it would read differently", () => {
    expect(colorChannels("hsl(-120 100% 50%)")).toBeUndefined();
    expect(colorChannels("hsl(0.25turn 100% 40%)")).toBeUndefined();
    expect(colorChannels("hsl(0 150% 50%)")).toBeUndefined();
    expect(colorChannels("hsl(0 -50% 50%)")).toBeUndefined();
    // Numbers are percentages without the sign: 0.5 is 0.5%, not a half.
    expect(colorChannels("hsl(0 0 0.5)")).toBeUndefined();
    expect(colorChannels("rgb(300 -20 128)")).toBeUndefined();
    expect(colorChannels("#ff000080")).toBeUndefined();
    expect(colorChannels("var(--brand)")).toBeUndefined();
    expect(colorChannels("red")).toBeUndefined();
  });
});
