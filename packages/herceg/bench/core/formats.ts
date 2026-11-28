// Formats: writing values in each form a format takes, and axis ticks.

import { formatWriter } from "../../src/format/patterns.ts";
import { unitWriter } from "../../src/format/units.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { measure } from "./shared.ts";

export async function run(): Promise<void> {
  // Writing 10,000 values in each form a format takes, as tooltips, labels,
  // and grids write them one at a time: Intl options and d3-like patterns
  // (the baselines), text around a pattern, durations, and prefixed units;
  // and an axis' ticks in the forms that pick their decimals from the step.
  const latencies = Float64Array.from({ length: 10_000 }, (_, i) => (i * 7_919.3) % 4_000_000);
  const sizes = Float64Array.from({ length: 10_000 }, (_, i) => (i * 104_729.7) % 5e12);
  const times = Float64Array.from({ length: 10_000 }, (_, i) => Date.UTC(2026, 0, 1) + i * 61_234);
  const forms: [string, object, boolean, Float64Array][] = [
    ["Intl number options", { maximumFractionDigits: 1 }, false, sizes],
    ["number pattern ,.1f", { number: ",.1f" }, false, sizes],
    ["number pattern .3~s with a suffix", { number: ".3~s", suffix: " req/s" }, false, sizes],
    ["duration in ms", { duration: "millisecond" }, false, latencies],
    [
      "duration in ms, 3 units, 1 decimal",
      { duration: "millisecond", maxUnits: 3, decimals: 1 },
      false,
      latencies,
    ],
    ["SI prefixes", { si: "B" }, false, sizes],
    ["binary prefixes", { binary: "B" }, false, sizes],
    ["Intl date options", { month: "short", day: "numeric", hour: "2-digit" }, true, times],
    ["time pattern %b %d %H:%M", { time: "%b %d %H:%M" }, true, times],
  ];
  for (const [name, format, time, values] of forms) {
    const write = formatWriter(GUIDE_KIT, format, time, "UTC", "en-US", "bench");
    measure(`format: 10k values, ${name}`, () => {
      for (let i = 0; i < values.length; i++) write(values[i]!);
    });
  }
  const ticks = Array.from({ length: 8 }, (_, i) => i * 250_000);
  for (const format of [{ duration: "millisecond" }, { si: "B" }] as const) {
    const writer = unitWriter(GUIDE_KIT, format, "en-US", "bench");
    measure(
      `format: 8 ticks, ${"duration" in format ? "duration" : "SI prefixes"}`,
      () => writer.ticks(ticks),
      {
        repeat: 100,
      },
    );
  }
}
