// Lengths of time and values with SI or binary prefixes: the format forms
// `{ duration }` ("1m 6s"), `{ si }` ("1.5 MB"), and `{ binary }`
// ("1.5 MiB"). Unit symbols and prefixes are fixed; digits, separators,
// and the minus sign are the locale's, written with Intl through the kit
// (as patterns are), so that server and browser output agree wherever
// their locale data does.

import type { BinaryFormat, DurationFormat, DurationUnit, SiFormat } from "../spec/guides.ts";
import type { Formatter } from "./format.ts";
import type { FormatKit } from "./patterns.ts";

/** A format of lengths of time or of a unit with prefixes. */
export type UnitFormat = DurationFormat | SiFormat | BinaryFormat;

/** A writer of single values, and of ticks, which tell their neighbors apart. */
export interface UnitWriter {
  value: Formatter;
  ticks(values: readonly number[]): string[];
}

/** Units of time from the largest, their symbols, and their lengths in nanoseconds. */
const UNITS: readonly DurationUnit[] = [
  "day",
  "hour",
  "minute",
  "second",
  "millisecond",
  "microsecond",
  "nanosecond",
];
const SYMBOLS = ["d", "h", "m", "s", "ms", "µs", "ns"];
const NANOS = [864e11, 36e11, 6e10, 1e9, 1e6, 1e3, 1];
/** SI prefixes from 1000^-3 to 1000^6, and binary ones from 1024^0 to 1024^6. */
const SI = ["n", "µ", "m", "", "k", "M", "G", "T", "P", "E"];
const BINARY = ["", "Ki", "Mi", "Gi", "Ti", "Pi", "Ei"];

/**
 * Writes values as `format` says: lengths of time, or a unit after an SI
 * or binary prefix. Ticks without `decimals` given tell their neighbors
 * apart, as number ticks do: lengths of time are written down to the unit
 * their spacing is in (past `maxUnits`), and both take the decimals their
 * spacing needs, zeros kept. Throws, naming the format's path `at`, for
 * settings out of range.
 */
export function unitWriter(
  kit: FormatKit,
  format: UnitFormat,
  locale: string | undefined,
  at: string,
): UnitWriter {
  if (format.fiscal !== undefined)
    throw new Error(`${at}.fiscal: numbers have no fiscal year; give time, or drop fiscal`);
  const given =
    format.decimals === undefined
      ? undefined
      : whole(format.decimals, 0, 20, `${at}.decimals`, "a whole number from 0 to 20");
  // A form's key given undefined is not given, as `formOf` reads it.
  const write =
    "duration" in format && format.duration !== undefined
      ? durations(kit, format, given, locale, at)
      : prefixed(kit, format as SiFormat | BinaryFormat, given, locale, at);
  const plain = kit.numberFormatter({}, locale);
  // Non-finite values are written as Intl writes them, without a unit.
  const value = (v: number, step?: number) =>
    Number.isFinite(v) ? write(Math.abs(v), v < 0, step) : plain(v);
  return {
    value: (v) => value(v),
    ticks: (values) => {
      let step = Infinity;
      for (let i = 1; i < values.length; i++)
        step = Math.min(step, Math.abs(values[i]! - values[i - 1]!));
      return values.map((v) => value(v, given === undefined && step < Infinity ? step : undefined));
    },
  };
}

/** Writes a size (`|value|`), negative or not, given the spacing of ticks it is one of. */
type Write = (size: number, negative: boolean, step?: number) => string;

function durations(
  kit: FormatKit,
  format: DurationFormat,
  given: number | undefined,
  locale: string | undefined,
  at: string,
): Write {
  const unit = UNITS.indexOf(format.duration);
  if (unit < 0)
    throw new Error(
      `${at}.duration: expected one of ${[...UNITS]
        .reverse()
        .map((one) => JSON.stringify(one))
        .join(", ")}; received ${shown(format.duration)}`,
    );
  const most = whole(
    format.maxUnits === undefined ? 2 : format.maxUnits,
    1,
    7,
    `${at}.maxUnits`,
    "a whole number of units from 1 to 7",
  );
  const minus = minusSign(locale);
  const digits = (n: number, decimals: number) =>
    kit.numberFormatter(
      { minimumFractionDigits: decimals, maximumFractionDigits: decimals },
      locale,
    )(n);
  return (size, negative, step) => {
    // From the largest unit the value has one of (the smallest, for less).
    let first = 0;
    while (first < 6 && amount(size, unit, first) < 1) first++;
    // Ticks are written down to the unit their spacing is in.
    let fine = 0;
    if (step !== undefined) while (fine < 6 && amount(step, unit, fine) < 1) fine++;
    for (;;) {
      const last = Math.max(Math.min(first + most - 1, 6), step === undefined ? 0 : fine);
      const decimals = given ?? (step === undefined ? 0 : decimalsOf(amount(step, unit, last)));
      const rounded = Number(amount(size, unit, last).toFixed(decimals));
      // Rounding that reaches a larger unit starts from it: 59,999.6 ms is "1m".
      if (first > 0 && rounded >= NANOS[first - 1]! / NANOS[last]!) {
        first--;
        continue;
      }
      if (rounded === 0) return digits(0, decimals) + SYMBOLS[unit];
      // Units that round to zero after the first are left out ("1h", not "1h 0m").
      const parts: string[] = [];
      let rest = rounded;
      for (let i = first; i < last; i++) {
        const length = NANOS[i]! / NANOS[last]!;
        const count = Math.floor(rest / length);
        rest -= count * length;
        if (count > 0) parts.push(digits(count, 0) + SYMBOLS[i]);
      }
      if (Number(rest.toFixed(decimals)) > 0) parts.push(digits(rest, decimals) + SYMBOLS[last]);
      return (negative ? minus : "") + parts.join(" ");
    }
  };
}

/** `value` in units `from` as an amount of units `to` (indices into UNITS), by their whole ratio. */
function amount(value: number, from: number, to: number): number {
  return from <= to ? value * (NANOS[from]! / NANOS[to]!) : value / (NANOS[to]! / NANOS[from]!);
}

function prefixed(
  kit: FormatKit,
  format: SiFormat | BinaryFormat,
  given: number | undefined,
  locale: string | undefined,
  at: string,
): Write {
  const binary = "binary" in format && format.binary !== undefined;
  const unit = binary ? format.binary : (format as SiFormat).si;
  if (typeof unit !== "string")
    throw new Error(
      `${at}.${binary ? "binary" : "si"}: expected the unit's symbol, such as "B" or "W"; received ${shown(unit)}`,
    );
  const [base, lowest, symbols] = binary ? [1024, 0, BINARY] : [1000, -3, SI];
  const highest = symbols.length - 1 + lowest;
  /** `size` over `base` to the `k`, multiplying by whole powers below 1. */
  const scaled = (size: number, k: number) => (k < 0 ? size * base ** -k : size / base ** k);
  return (size, negative, step) => {
    let k = 0;
    if (size > 0) {
      const log = binary ? Math.log2(size) / 10 : Math.log10(size) / 3;
      k = Math.max(lowest, Math.min(highest, Math.floor(log)));
      // A logarithm a little over a whole number.
      if (k > lowest && scaled(size, k) < 1) k--;
    }
    for (;;) {
      // Given decimals exactly; ticks' as their spacing needs; else up to 1.
      const [fewest, most] =
        given !== undefined
          ? [given, given]
          : step !== undefined
            ? [decimalsOf(scaled(step, k)), decimalsOf(scaled(step, k))]
            : [0, 1];
      const rounded = Number(scaled(size, k).toFixed(most));
      // The prefix is chosen after rounding: 999,960 B is "1 MB", not "1,000 kB".
      if (rounded >= base && k < highest) {
        k++;
        continue;
      }
      const text = kit.numberFormatter(
        { minimumFractionDigits: fewest, maximumFractionDigits: most },
        locale,
      )(negative ? -rounded : rounded);
      const symbol = symbols[k - lowest]! + unit;
      return symbol ? `${text} ${symbol}` : text;
    }
  };
}

/** Decimals that write `step` exactly, at most 15, as number ticks choose theirs (`stepDecimals`). */
function decimalsOf(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0;
  for (let decimals = 0; decimals < 15; decimals++) {
    const scaled = step * 10 ** decimals;
    if (Math.abs(scaled - Math.round(scaled)) <= 1e-9 * scaled) return decimals;
  }
  return 15;
}

/** `value`, a whole number from `min` to `max`; refused, naming `at`, otherwise. */
function whole(value: unknown, min: number, max: number, at: string, expected: string): number {
  if (!(Number.isInteger(value) && (value as number) >= min && (value as number) <= max))
    throw new Error(`${at}: expected ${expected}; received ${shown(value)}`);
  return value as number;
}

function shown(value: unknown): string {
  return typeof value === "string" || (typeof value === "object" && value !== null)
    ? JSON.stringify(value)
    : String(value);
}

/** The locale's minus sign, as Intl writes negative numbers. */
export function minusSign(locale: string | undefined): string {
  const parts = new Intl.NumberFormat(locale).formatToParts(-1);
  return parts.find((part) => part.type === "minusSign")?.value ?? "-";
}
