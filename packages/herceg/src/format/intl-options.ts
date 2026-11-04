// The options Intl.NumberFormat and Intl.DateTimeFormat take, by name. Intl
// ignores others, so checks refuse or list them; and Intl options write a
// kind of value only where its formatter takes every option they give.

export const NUMBER_OPTIONS = [
  "localeMatcher",
  "numberingSystem",
  "style",
  "currency",
  "currencyDisplay",
  "currencySign",
  "unit",
  "unitDisplay",
  "notation",
  "compactDisplay",
  "signDisplay",
  "useGrouping",
  "minimumIntegerDigits",
  "minimumFractionDigits",
  "maximumFractionDigits",
  "minimumSignificantDigits",
  "maximumSignificantDigits",
  "roundingMode",
  "roundingPriority",
  "roundingIncrement",
  "trailingZeroDisplay",
];
export const TIME_OPTIONS = [
  "localeMatcher",
  "numberingSystem",
  "calendar",
  "timeZone",
  "hour12",
  "hourCycle",
  "formatMatcher",
  "dateStyle",
  "timeStyle",
  "weekday",
  "era",
  "year",
  "month",
  "day",
  "dayPeriod",
  "hour",
  "minute",
  "second",
  "fractionalSecondDigits",
  "timeZoneName",
];

/** Whether Intl options `format` can write `kind`: its formatter takes every option given ({} writes either). */
export function intlWrites(format: object, kind: "number" | "time"): boolean {
  const options = kind === "time" ? TIME_OPTIONS : NUMBER_OPTIONS;
  return Object.keys(format).every((key) => options.includes(key));
}
