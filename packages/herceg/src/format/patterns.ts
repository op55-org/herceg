// Portable format patterns, which specs and Python carry as strings: numbers
// in a subset of d3-format (`{ number: ",.2f" }`) and times in a subset of
// strftime (`{ time: "%b %d %H:%M" }`). Digits, separators, and names are
// the chart locale's, written with Intl; times are written in the scale's
// time zone. The patterns used last are kept compiled. They write with the
// chart's formatters and zone arithmetic, handed in (see `GuideKit`), as
// every form `formatWriter` tells apart does.

import type { FiscalSpec, NumberPatternFormat } from "../spec/guides.ts";
import type { Formatter, NumberFormat, TimeFormat } from "./format.ts";
import { minusSign, type UnitFormat, unitWriter } from "./units.ts";
import type { TimeZone } from "./zone.ts";

/**
 * What format writers use of the chart's code, handed in (see `GuideKit`):
 * its kept Intl formatters and its time zone arithmetic.
 */
export interface FormatKit {
  numberFormatter(options: NumberFormat, locale?: string): Formatter;
  timeFormatter(options: TimeFormat, zone: TimeZone, locale?: string): Formatter;
  toWall(zone: TimeZone, t: number): number;
}

/** The keys that tell formats' forms apart; a format without one is Intl options. */
const FORMS = ["number", "time", "duration", "si", "binary"] as const;
export type FormName = (typeof FORMS)[number] | "intl";

/** Whether `format` gives a form's key, being a pattern, a duration, or a unit, not Intl options. */
export function formed(format: object | undefined): boolean {
  return FORMS.some((key) => (format as Record<string, unknown> | undefined)?.[key] !== undefined);
}

/** Settings of some forms only, the forms that take each, and the correction for others. */
const OWN: readonly [key: string, forms: readonly FormName[], fix: string][] = [
  ["maxUnits", ["duration"], "describes durations; give duration, or drop maxUnits"],
  [
    "decimals",
    ["duration", "si", "binary"],
    'goes with duration, si, or binary; a number pattern gives its precision (".2f"), Intl options maximumFractionDigits',
  ],
  [
    "prefix",
    ["number"],
    'text around numbers goes with a number pattern; give { number: ",.0f", prefix }',
  ],
  [
    "suffix",
    ["number"],
    'text around numbers goes with a number pattern; give { number: ",.0f", suffix }',
  ],
];

/**
 * Which form `format` is: the one of `FORMS` whose key it gives, or Intl
 * options. Throws, naming its path `at`, for a format of two forms and for
 * another form's settings (`maxUnits` beside `si`).
 */
export function formOf(format: object, at: string): FormName {
  const settings = format as Record<string, unknown>;
  const given = FORMS.filter((key) => settings[key] !== undefined);
  if (given.length > 1)
    throw new Error(
      `${at}: give one of number, time, duration, si, binary, or Intl options; received ${given.join(" and ")}`,
    );
  const form = given[0] ?? "intl";
  for (const [key, forms, fix] of OWN)
    if (settings[key] !== undefined && !forms.includes(form))
      throw new Error(`${at}.${key}: ${fix}`);
  return form;
}

/**
 * Writes values as `format` says, in any of its forms: Intl options
 * (dates' where `time`, numbers' otherwise), a number or time pattern, a
 * duration, or a unit after a prefix. Throws, naming its path `at`, as
 * `formOf` and each form's writer do.
 */
export function formatWriter(
  kit: FormatKit,
  format: object,
  time: boolean,
  zone: TimeZone,
  locale: string | undefined,
  at: string,
): Formatter {
  const form = formOf(format, at);
  if (form === "number") return numberPattern(kit, format as NumberPatternFormat, locale, at);
  if (form === "time") return timePattern(kit, format as TimePattern, zone, locale, at);
  if (form === "intl")
    return time
      ? kit.timeFormatter(intlOptions(format, at), zone, locale)
      : kit.numberFormatter(intlOptions(format, at), locale);
  return unitWriter(kit, format as UnitFormat, locale, at).value;
}

/** How many compiled patterns are kept: the ones used last, as a page's charts use a few. */
const KEPT = 64;
const compiled = new Map<string, Formatter>();

function cached(key: string, make: () => Formatter): Formatter {
  let formatter = compiled.get(key);
  if (formatter) compiled.delete(key);
  else formatter = make();
  // The Map's order is the order of use: the first key was used longest ago.
  compiled.set(key, formatter);
  if (compiled.size > KEPT) compiled.delete(compiled.keys().next().value!);
  return formatter;
}

// [sign][,][.precision][~][type]
const NUMBER = /^([-+( ])?(,)?(?:\.(\d{1,2}))?(~)?([defgs%]?)$/;
const PREFIXES = [
  "y",
  "z",
  "a",
  "f",
  "p",
  "n",
  "µ",
  "m",
  "",
  "k",
  "M",
  "G",
  "T",
  "P",
  "E",
  "Z",
  "Y",
];

/**
 * Writes numbers as a d3-format pattern says: a sign ("-" for negative
 * numbers only, the default; "+" for both; "(" for parentheses around
 * negative ones; " " for a space before positive ones), "," to group
 * thousands, ".precision", "~" to trim trailing zeros, and a type: d
 * (whole numbers), f (fixed decimals), e (exponent), g (significant
 * digits), s (significant digits with an SI prefix), % (percent), or none
 * (as "~g" with 12 digits); with the format's `prefix` before and `suffix`
 * after finite numbers, inside their sign ("-$5", "($5)"). Throws, naming
 * the format's path `at`, for other patterns, and for a fiscal year, which
 * numbers have none.
 */
export function numberPattern(
  kit: FormatKit,
  format: { number: string; prefix?: string; suffix?: string; fiscal?: unknown },
  locale: string | undefined,
  at: string,
): Formatter {
  if (format.fiscal !== undefined)
    throw new Error(`${at}.fiscal: numbers have no fiscal year; give time, or drop fiscal`);
  const { number: pattern, prefix = "", suffix = "" } = format;
  for (const [key, text] of [
    ["prefix", prefix],
    ["suffix", suffix],
  ])
    if (typeof text !== "string")
      throw new Error(`${at}.${key}: expected text; received ${JSON.stringify(text)}`);
  const where = `${at}.number`;
  return cached(JSON.stringify(["n", locale, pattern, prefix, suffix]), () => {
    const match = NUMBER.exec(pattern);
    if (!match)
      throw new Error(
        `${where}: "${pattern}" is not a number pattern herceg reads; write [sign][,][.precision][~][type] with type d, f, e, g, s, or %, such as ",.2f" or ".1%"`,
      );
    const [, sign = "-", comma, given, tilde, kind] = match;
    const type = kind || "g";
    const trim = tilde !== undefined || !kind;
    const precision = given !== undefined ? Number(given) : kind ? 6 : 12;
    if ((type === "g" || type === "s") && precision === 0)
      throw new Error(`${where}: "${pattern}" asks for 0 significant digits; give 1 or more`);
    const digits = (value: number, options: Intl.NumberFormatOptions) =>
      kit.numberFormatter({ useGrouping: !!comma, ...options }, locale)(value);
    const significant = {
      minimumSignificantDigits: trim ? 1 : precision,
      maximumSignificantDigits: precision,
    };
    const fixed = (p: number) => ({
      minimumFractionDigits: trim ? 0 : p,
      maximumFractionDigits: p,
    });
    /** A mantissa and exponent as toExponential writes them, the mantissa in the locale ("1.2e+4"). */
    const exponential = (text: string) => {
      const [mantissa, exponent] = text.split("e");
      const decimals = mantissa!.split(".")[1]?.length ?? 0;
      return `${digits(Number(mantissa), fixed(decimals))}e${exponent}`;
    };
    /** |value| as the type writes it, and the value its digits show (for the sign). */
    const body = (x: number): [string, number] => {
      switch (type) {
        case "d":
          return [digits(Math.round(x), { maximumFractionDigits: 0 }), Math.round(x)];
        case "f":
          return [digits(x, fixed(precision)), Number(x.toFixed(precision))];
        case "%":
          return [`${digits(x * 100, fixed(precision))}%`, Number((x * 100).toFixed(precision))];
        case "e": {
          const text = x.toExponential(precision);
          return [exponential(text), Number(text)];
        }
        case "s": {
          const shown = x === 0 ? 0 : Number(x.toPrecision(precision));
          const k = shown === 0 ? 0 : Math.max(-8, Math.min(8, Math.floor(Math.log10(shown) / 3)));
          return [digits(shown / 10 ** (3 * k), significant) + PREFIXES[k + 8]!, shown];
        }
        default: {
          // Exponential where toPrecision writes one, as d3-format does.
          const text = x.toPrecision(precision);
          const shown = Number(text);
          return [text.includes("e") ? exponential(text) : digits(shown, significant), shown];
        }
      }
    };
    const minus = minusSign(locale);
    return (value) => {
      if (!Number.isFinite(value)) return digits(value, {});
      // The text around the number goes inside its sign, as d3-format's "$" does: "-$5".
      const [written, shown] = body(Math.abs(value));
      const text = prefix + written + suffix;
      // Values that round to zero are written without a minus sign.
      if (value < 0 && shown !== 0) return sign === "(" ? `(${text})` : minus + text;
      return (sign === "+" ? "+" : sign === " " ? " " : "") + text;
    };
  });
}

const DIRECTIVE = /%(-?)(.?)/g;
const NAMES = "aAbBp";
const NUMBERS = "YymdeHIMSLq";

/** Intl options `format`, refusing a fiscal year, which they do not write; `at` names them in the message. */
export function intlOptions<T extends object>(format: T & { fiscal?: unknown }, at: string): T {
  if (format.fiscal !== undefined)
    throw new Error(
      `${at}.fiscal: Intl options write no fiscal year; give { time: "%Y Q%q" } with fiscal, or drop fiscal`,
    );
  return format;
}

/** A time pattern, and the fiscal year its years and quarters count in. */
export interface TimePattern {
  time: string;
  fiscal?: FiscalSpec | undefined;
}

/**
 * The month (0 to 11) a fiscal year starts in, and whether it is named by
 * the year it ends in. Throws, naming `where`, for anything else.
 */
export function fiscalOf(fiscal: FiscalSpec, where: string): [shift: number, ends: boolean] {
  const { start, name = "end" } = fiscal as { start: unknown; name?: unknown };
  if (!(Number.isInteger(start) && (start as number) >= 1 && (start as number) <= 12))
    throw new Error(
      `${where}.start: expected a month from 1 to 12; received ${JSON.stringify(start)}`,
    );
  if (name !== "end" && name !== "start")
    throw new Error(`${where}.name: expected "end" or "start"; received ${JSON.stringify(name)}`);
  return [(start as number) - 1, name === "end"];
}

/**
 * Writes times as a strftime pattern says, in `zone`: %Y %y %m %d %e %H %I
 * %M %S %L (milliseconds), %q (the quarter, 1 to 4), %p, %a %A %b %B
 * (names in the chart's locale), %z (the zone's offset, +hhmm), and %% for
 * "%"; "-" after % drops a number's padding ("%-d"). With `fiscal`, %Y,
 * %y, and %q write the fiscal year and its quarter. Throws, naming `where`
 * (the format's path) and the directive's place, for anything else.
 */
export function timePattern(
  kit: FormatKit,
  { time: pattern, fiscal }: TimePattern,
  zone: TimeZone,
  locale: string | undefined,
  where: string,
): Formatter {
  const [shift, ends] = fiscal ? fiscalOf(fiscal, `${where}.fiscal`) : [0, false];
  return cached(`t|${locale}|${zone}|${shift}|${ends}|${pattern}`, () => {
    for (const { 0: whole, 1: flag, 2: directive = "", index } of pattern.matchAll(DIRECTIVE)) {
      const number = directive !== "" && NUMBERS.includes(directive);
      const known = number || (directive !== "" && `${NAMES}z%`.includes(directive));
      if (!known || (flag && !number))
        throw new Error(
          `${where}.time: "${whole}" at character ${index + 1} of "${pattern}" is not a time directive herceg reads; use %Y %y %q %m %d %e %H %I %M %S %L %p %a %A %b %B %z, "-" for no padding (%-d), and %% for "%"`,
        );
    }
    // Names read the wall time as if it were UTC, as calendar math does;
    // only the formatters the pattern uses are made.
    const used = (directive: string) => pattern.includes(`%${directive}`);
    const named = (directive: string, options: Intl.DateTimeFormatOptions) => {
      if (!used(directive)) return undefined;
      const format = new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" });
      return (wall: number) => format.format(wall);
    };
    const period = used("p")
      ? new Intl.DateTimeFormat(locale, { hour: "numeric", hour12: true, timeZone: "UTC" })
      : undefined;
    const names: Record<string, ((wall: number) => string) | undefined> = {
      a: named("a", { weekday: "short" }),
      A: named("A", { weekday: "long" }),
      b: named("b", { month: "short" }),
      B: named("B", { month: "long" }),
      p:
        period &&
        ((wall) =>
          period.formatToParts(wall).find((part) => part.type === "dayPeriod")?.value ?? ""),
    };
    return (t) => {
      if (!Number.isFinite(t)) return "";
      const wall = kit.toWall(zone, t);
      const date = new Date(wall);
      const hours = date.getUTCHours();
      const month = date.getUTCMonth();
      // The year counted from its first month (January, or the fiscal year's), named by its start or end.
      const year = date.getUTCFullYear() - (month < shift ? 1 : 0) + (shift > 0 && ends ? 1 : 0);
      // Each number and the width it is padded to.
      const numbers: Record<string, [number, number]> = {
        Y: [year, 0],
        y: [year % 100, 2],
        q: [Math.floor(((month - shift + 12) % 12) / 3) + 1, 1],
        m: [month + 1, 2],
        d: [date.getUTCDate(), 2],
        e: [date.getUTCDate(), 2],
        H: [hours, 2],
        I: [hours % 12 || 12, 2],
        M: [date.getUTCMinutes(), 2],
        S: [date.getUTCSeconds(), 2],
        L: [date.getUTCMilliseconds(), 3],
      };
      return pattern.replace(DIRECTIVE, (_, flag: string, directive: string) => {
        if (directive === "%") return "%";
        if (directive === "z") {
          const minutes = Math.round((wall - t) / 60_000);
          const at = Math.abs(minutes);
          return `${minutes < 0 ? "-" : "+"}${pad(Math.floor(at / 60), 2, "0")}${pad(at % 60, 2, "0")}`;
        }
        const number = numbers[directive];
        if (!number) return names[directive]!(wall);
        return flag ? String(number[0]) : pad(number[0], number[1], directive === "e" ? " " : "0");
      });
    };
  });
}

function pad(value: number, width: number, filler: string): string {
  const text = String(value);
  return text.length >= width ? text : filler.repeat(width - text.length) + text;
}
