// Axis breaks' rules as specs write them (weekdays, hours, dates, ranges),
// parsed with errors that name the rule: by TimeBreaks (breaks.ts) and by
// spec validation (spec/validate.ts), which checks them without loading
// what resolves them.

import type { Weekday } from "../spec/spec.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
/** Days in `getUTCDay` order. */
const WEEKDAYS: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export type Rule =
  | { kind: "weekdays"; days: readonly boolean[] }
  /** Milliseconds after midnight; `end` before `start` wraps past midnight. */
  | { kind: "hours"; start: number; end: number }
  /** Wall-clock midnights (calendar dates as UTC). */
  | { kind: "dates"; days: readonly number[] }
  | { kind: "range"; from: number; to: number };

function fail(path: string, expected: string, value: unknown): never {
  const shown = typeof value === "string" ? JSON.stringify(value) : String(value);
  throw new TypeError(`${path}: expected ${expected}; received ${shown}`);
}

/** "HH:MM" as milliseconds after midnight; "24:00" only as an end. */
function clock(value: unknown, path: string, end: boolean): number {
  const match = typeof value === "string" ? /^(\d{1,2}):(\d{2})$/.exec(value) : null;
  const hours = Number(match?.[1]);
  const minutes = Number(match?.[2]);
  const valid = match && minutes < 60 && (hours < 24 || (end && hours === 24 && minutes === 0));
  if (!valid) fail(path, `a time of day, "HH:MM"${end ? ' (or "24:00")' : ""}`, value);
  return hours * HOUR + minutes * MINUTE;
}

/** An ISO date, "YYYY-MM-DD", as its midnight in wall-clock milliseconds. */
function date(value: unknown, path: string): number {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const [year, month, day] = [Number(match?.[1]), Number(match?.[2]), Number(match?.[3])];
  // setUTCFullYear, unlike Date.UTC, does not read years 0 to 99 as 1900 to 1999.
  const check = new Date(0);
  check.setUTCFullYear(year, month - 1, day);
  // Dates roll over (February 30 is March 2); a real date reads back the same.
  const real =
    check.getUTCFullYear() === year &&
    check.getUTCMonth() === month - 1 &&
    check.getUTCDate() === day;
  if (!match || !real) fail(path, 'a date, "YYYY-MM-DD"', value);
  return check.getTime();
}

function parseRule(spec: unknown, path: string): Rule {
  if (typeof spec !== "object" || spec === null || Array.isArray(spec))
    fail(path, "a break: { weekdays }, { hours }, { dates }, or { from, to }", spec);
  const rule = spec as Record<string, unknown>;
  const kinds = ["weekdays", "hours", "dates", "from"].filter((key) => rule[key] !== undefined);
  if (kinds.length !== 1 && !(kinds.length === 0 && rule.to !== undefined))
    throw new TypeError(
      `${path}: expected one of weekdays, hours, dates, or from and to; received ${kinds.length === 0 ? "none" : kinds.join(" and ")}`,
    );
  if (rule.weekdays !== undefined) {
    const list = rule.weekdays;
    if (!Array.isArray(list) || list.length === 0) fail(`${path}.weekdays`, "a list of days", list);
    const days = WEEKDAYS.map(() => false);
    for (const [i, day] of list.entries()) {
      const index = WEEKDAYS.indexOf(day as Weekday);
      if (index < 0) fail(`${path}.weekdays[${i}]`, '"mon", "tue", ..., or "sun"', day);
      days[index] = true;
    }
    if (days.every(Boolean))
      throw new RangeError(`${path}.weekdays: every day leaves no time to show; drop a day`);
    return { kind: "weekdays", days };
  }
  if (rule.hours !== undefined) {
    const span = rule.hours;
    if (!Array.isArray(span) || span.length !== 2)
      fail(`${path}.hours`, 'two times of day, ["HH:MM", "HH:MM"]', span);
    const start = clock(span[0], `${path}.hours[0]`, false);
    const end = clock(span[1], `${path}.hours[1]`, true);
    if (start === end || (start === 0 && end === DAY))
      throw new RangeError(
        `${path}.hours: ${JSON.stringify(span)} leaves out ${start === end ? "no time, or every hour" : "every hour"}`,
      );
    return { kind: "hours", start, end: end === DAY ? 0 : end };
  }
  if (rule.dates !== undefined) {
    const list = rule.dates;
    if (!Array.isArray(list) || list.length === 0)
      fail(`${path}.dates`, 'a list of dates, "YYYY-MM-DD"', list);
    return { kind: "dates", days: list.map((d, i) => date(d, `${path}.dates[${i}]`)) };
  }
  const { from, to } = rule;
  const whole = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v);
  if (!whole(from)) fail(`${path}.from`, "whole epoch milliseconds", from);
  if (!whole(to)) fail(`${path}.to`, "whole epoch milliseconds", to);
  if (!((to as number) > (from as number)))
    throw new RangeError(`${path}.to: expected a time after from, ${from}; received ${to}`);
  return { kind: "range", from: from as number, to: to as number };
}

/** Parses break rules, with errors that name the offending rule by `path`. */
export function parseRules(rules: unknown, path: string): Rule[] {
  if (!Array.isArray(rules)) fail(path, "a list of breaks", rules);
  return rules.map((rule, i) => parseRule(rule, `${path}[${i}]`));
}

/** Checks the breaks of a spec's x axis; used by the spec validator. */
export function checkBreaks(rules: unknown, path: string): void {
  parseRules(rules, path);
}
