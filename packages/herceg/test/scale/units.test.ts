// Lengths of time, SI and binary prefixes, and text around number patterns:
// the format forms beside Intl options and patterns, and how a format's form
// is told apart.
import { describe, expect, it } from "vitest";
import { formatWriter, formOf } from "../../src/format/patterns.ts";
import { type UnitFormat, unitWriter } from "../../src/format/units.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";

const write = (format: object, value: number, locale = "en-US") =>
  formatWriter(GUIDE_KIT, format, false, "UTC", locale, "y.format")(value);
const ticks = (format: object, values: number[], locale = "en-US") =>
  unitWriter(GUIDE_KIT, format as UnitFormat, locale, "y.format").ticks(values);

describe("durations", () => {
  it.each([
    ["millisecond", 66_000, "1m 6s"],
    ["millisecond", 450, "450ms"],
    ["millisecond", 3_600_000, "1h"],
    ["millisecond", 90_061_000, "1d 1h"],
    ["second", 0.5, "500ms"],
    ["second", 3725, "1h 2m"],
    ["minute", 1.5, "1m 30s"],
    ["hour", 25, "1d 1h"],
    ["day", 1.5, "1d 12h"],
    ["microsecond", 1500, "1ms 500µs"],
    ["nanosecond", 1500, "1µs 500ns"],
  ] as const)("writes %s values in their largest units", (unit, value, expected) => {
    expect(write({ duration: unit }, value)).toBe(expected);
  });

  it("writes at most maxUnits units, leaving out units that round to zero", () => {
    expect(write({ duration: "second", maxUnits: 3 }, 93_784)).toBe("1d 2h 3m");
    expect(write({ duration: "second", maxUnits: 1 }, 93_784)).toBe("1d");
    expect(write({ duration: "second", maxUnits: 7 }, 86_400.5)).toBe("1d 500ms");
    expect(write({ duration: "millisecond" }, 3_600_100)).toBe("1h");
    expect(write({ duration: "second", maxUnits: 3 }, 86_405)).toBe("1d");
  });

  it("rounds the last unit to decimals, carrying into larger units", () => {
    expect(write({ duration: "millisecond" }, 59_999.6)).toBe("1m");
    expect(write({ duration: "millisecond" }, 3_599_600)).toBe("1h");
    expect(write({ duration: "millisecond", decimals: 1 }, 65_500)).toBe("1m 5.5s");
    expect(write({ duration: "millisecond", decimals: 1 }, 66_000)).toBe("1m 6.0s");
    expect(write({ duration: "millisecond", decimals: 2 }, 450.125)).toBe("450ms 125.00µs");
    expect(write({ duration: "millisecond", decimals: 2, maxUnits: 1 }, 450.125)).toBe("450.13ms");
    expect(write({ duration: "second", decimals: 1, maxUnits: 1 }, 90)).toBe("1.5m");
  });

  it("writes zero, and values that round to zero, in the values' unit", () => {
    expect(write({ duration: "millisecond" }, 0)).toBe("0ms");
    expect(write({ duration: "millisecond", decimals: 1 }, 0)).toBe("0.0ms");
    expect(write({ duration: "nanosecond" }, 0.4)).toBe("0ns");
    expect(write({ duration: "millisecond" }, -1e-7)).toBe("0ms");
    expect(write({ duration: "millisecond" }, -0.0001)).toBe("-100ns");
  });

  it("writes negative lengths with the locale's minus sign, and non-finite values as Intl does", () => {
    expect(write({ duration: "millisecond" }, -66_000)).toBe("-1m 6s");
    expect(write({ duration: "millisecond" }, Number.NaN)).toBe("NaN");
    expect(write({ duration: "millisecond" }, Number.POSITIVE_INFINITY)).toBe("∞");
    expect(write({ duration: "millisecond" }, Number.NEGATIVE_INFINITY)).toBe("-∞");
  });

  it("writes the locale's digits beside fixed symbols", () => {
    expect(write({ duration: "millisecond", decimals: 1 }, 65_500, "de-DE")).toBe("1m 5,5s");
    expect(write({ duration: "day" }, 12_345, "de-DE")).toBe("12.345d");
  });
});

describe("prefixes", () => {
  it("writes SI prefixes by thousands, from n to E, after rounding", () => {
    expect(write({ si: "B" }, 1_500_000)).toBe("1.5 MB");
    expect(write({ si: "B" }, 999)).toBe("999 B");
    expect(write({ si: "B" }, 1000)).toBe("1 kB");
    expect(write({ si: "B" }, 999_960)).toBe("1 MB");
    expect(write({ si: "B" }, 999_940)).toBe("999.9 kB");
    expect(write({ si: "W" }, 0.45)).toBe("450 mW");
    expect(write({ si: "W" }, 0.000_002_5)).toBe("2.5 µW");
    expect(write({ si: "W" }, 0.999_96)).toBe("1 W");
    expect(write({ si: "B" }, 0)).toBe("0 B");
    expect(write({ si: "B" }, -1500)).toBe("-1.5 kB");
  });

  it("keeps the largest and smallest prefixes past them", () => {
    expect(write({ si: "B" }, 1e25)).toBe("10,000,000 EB");
    expect(write({ si: "W" }, 1e-12)).toBe("0 nW");
  });

  it("writes binary prefixes by 1,024s, none under 1,024", () => {
    expect(write({ binary: "B" }, 1_572_864)).toBe("1.5 MiB");
    expect(write({ binary: "B" }, 1023)).toBe("1,023 B");
    expect(write({ binary: "B" }, 1024)).toBe("1 KiB");
    expect(write({ binary: "B" }, 1_048_575)).toBe("1 MiB");
    expect(write({ binary: "B" }, 0.5)).toBe("0.5 B");
    expect(write({ binary: "B" }, 2 ** 70)).toBe("1,024 EiB");
  });

  it("keeps given decimals exactly, zeros too, and drops zeros of the default", () => {
    expect(write({ si: "b/s", decimals: 2 }, 12_345_678)).toBe("12.35 Mb/s");
    expect(write({ binary: "B", decimals: 1 }, 1_048_576)).toBe("1.0 MiB");
    expect(write({ si: "B", decimals: 0 }, 1_500_000)).toBe("2 MB");
    expect(write({ si: "B" }, 2_000_000)).toBe("2 MB");
  });

  it("writes a unit of no text as the prefix alone, and the locale's digits", () => {
    expect(write({ si: "" }, 1500)).toBe("1.5 k");
    expect(write({ si: "" }, 15)).toBe("15");
    expect(write({ si: "B" }, 1_500_000, "de-DE")).toBe("1,5 MB");
  });
});

describe("text around number patterns", () => {
  it("writes prefix and suffix inside the sign", () => {
    expect(write({ number: ".3~s", suffix: " req/s" }, 1234)).toBe("1.23k req/s");
    expect(write({ number: ".1f", suffix: "%" }, 42.5)).toBe("42.5%");
    expect(write({ number: ",.0f", prefix: "$" }, -1234)).toBe("-$1,234");
    expect(write({ number: "(,.0f", prefix: "$" }, -1234)).toBe("($1,234)");
    expect(write({ number: ".1f", suffix: "%" }, Number.NaN)).toBe("NaN");
  });
});

describe("ticks", () => {
  it("take the decimals their spacing needs in each value's prefix, zeros kept", () => {
    expect(ticks({ si: "B" }, [0, 200_000, 400_000, 1_000_000, 1_200_000])).toEqual([
      "0 B",
      "200 kB",
      "400 kB",
      "1.0 MB",
      "1.2 MB",
    ]);
    expect(ticks({ si: "B" }, [1_000_000, 1_020_000, 1_040_000])).toEqual([
      "1.00 MB",
      "1.02 MB",
      "1.04 MB",
    ]);
    expect(ticks({ binary: "B" }, [0, 524_288, 1_048_576, 1_572_864])).toEqual([
      "0 B",
      "512 KiB",
      "1.0 MiB",
      "1.5 MiB",
    ]);
  });

  it("write lengths of time down to the unit of their spacing", () => {
    expect(ticks({ duration: "millisecond" }, [0, 10_000, 60_000, 70_000])).toEqual([
      "0ms",
      "10s",
      "1m",
      "1m 10s",
    ]);
    expect(ticks({ duration: "millisecond" }, [3_600_000, 3_600_100, 3_600_200])).toEqual([
      "1h",
      "1h 100ms",
      "1h 200ms",
    ]);
    expect(ticks({ duration: "second" }, [60, 61.5, 63])).toEqual(["1m", "1m 1.5s", "1m 3.0s"]);
  });

  it("keep given decimals", () => {
    expect(ticks({ si: "B", decimals: 1 }, [1_000_000, 1_020_000])).toEqual(["1.0 MB", "1.0 MB"]);
    expect(ticks({ duration: "millisecond", maxUnits: 1 }, [0, 500, 1000])).toEqual([
      "0ms",
      "500ms",
      "1s",
    ]);
  });
});

describe("forms", () => {
  it("are told apart by their keys, and Intl options have none", () => {
    expect(formOf({ duration: "second" }, "y.format")).toBe("duration");
    expect(formOf({ si: "B", decimals: 1 }, "y.format")).toBe("si");
    expect(formOf({ maximumFractionDigits: 1 }, "y.format")).toBe("intl");
  });

  it("refuse a mix of forms, and settings of another form", () => {
    expect(() => formOf({ number: ".2f", duration: "second" }, "y.format")).toThrow(
      "y.format: give one of number, time, duration, si, binary, or Intl options; received number and duration",
    );
    expect(() => formOf({ si: "B", maxUnits: 2 }, "y.format")).toThrow(
      "y.format.maxUnits: describes durations; give duration, or drop maxUnits",
    );
    expect(() => formOf({ maximumFractionDigits: 1, suffix: "%" }, "y.format")).toThrow(
      'y.format.suffix: text around numbers goes with a number pattern; give { number: ",.0f", suffix }',
    );
    expect(() => formOf({ number: ".2f", decimals: 2 }, "y.format")).toThrow(
      /^y\.format\.decimals: goes with duration, si, or binary/,
    );
  });

  it("refuse settings out of range, naming them", () => {
    expect(() => write({ duration: "ms" }, 1)).toThrow(
      'y.format.duration: expected one of "nanosecond", "microsecond", "millisecond", "second", "minute", "hour", "day"; received "ms"',
    );
    expect(() => write({ duration: "second", maxUnits: 0 }, 1)).toThrow(
      "y.format.maxUnits: expected a whole number of units from 1 to 7; received 0",
    );
    expect(() => write({ si: "B", decimals: 1.5 }, 1)).toThrow(
      "y.format.decimals: expected a whole number from 0 to 20; received 1.5",
    );
    expect(() => write({ si: 1000 }, 1)).toThrow(
      'y.format.si: expected the unit\'s symbol, such as "B" or "W"; received 1000',
    );
    expect(() => write({ number: ".1f", suffix: 3 }, 1)).toThrow(
      "y.format.suffix: expected text; received 3",
    );
    expect(() => write({ binary: "B", fiscal: { start: 4 } }, 1)).toThrow(
      "y.format.fiscal: numbers have no fiscal year; give time, or drop fiscal",
    );
  });
});
