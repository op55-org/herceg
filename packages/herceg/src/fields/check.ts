// Checks of field displays (spec/fields.ts): what is malformed whatever the
// data, and which settings a field's kind takes. A rule naming fields or
// kinds refuses settings they cannot take; broader rules give each field
// only what it takes (fields/rules.ts). Spec validation shares the
// messages (spec/validate.ts).

import { intlWrites, NUMBER_OPTIONS, TIME_OPTIONS } from "../format/intl-options.ts";
import { type FormatKit, type FormName, formatWriter, formOf } from "../format/patterns.ts";
import type { DisplayedKind } from "../spec/fields.ts";

export const KINDS: readonly DisplayedKind[] = ["number", "time", "category"];

/** A display's settings; a rule's are these and `match`. */
export const SETTINGS = [
  "label",
  "description",
  "format",
  "min",
  "max",
  "missing",
  "mappings",
  "thresholds",
  "link",
] as const;
export type Setting = (typeof SETTINGS)[number];

/** The settings of each form beside its key: what else a format of it may give. */
const FORM_SETTINGS: Readonly<Record<Exclude<FormName, "intl">, readonly string[]>> = {
  number: ["prefix", "suffix"],
  time: [],
  duration: ["maxUnits", "decimals"],
  si: ["decimals"],
  binary: ["decimals"],
};

/** Whether a checked `format` can write `kind`: a form writes its own; Intl options as `intlWrites` says. */
export function writes(format: object, kind: "number" | "time"): boolean {
  const form = formOf(format, "");
  return form === "intl" ? intlWrites(format, kind) : (form === "time") === (kind === "time");
}

/** What holds a rule's values, for messages: a named field and its kind. */
export function holds(name: string, kind: DisplayedKind): string {
  return `${JSON.stringify(name)} holds ${kind === "category" ? "categories" : `${kind}s`}`;
}

/** What a rule matching kinds matches, for messages: `this rule matches kind "time"`. */
export function matchesKinds(kinds: readonly DisplayedKind[]): string {
  return `this rule matches kind ${kinds.map((kind) => JSON.stringify(kind)).join(" or ")}`;
}

/**
 * Why a field of `kind` cannot take `setting` given as `value` (checked to
 * be well formed): where under the setting (".mappings[2].between"), and
 * the message after what holds the values (`holds`, `matchesKinds`); or
 * undefined where it takes it.
 */
export function misfit(
  kind: DisplayedKind,
  setting: Setting,
  value: unknown,
): { at: string; problem(subject: string): string } | undefined {
  if (value === undefined || value === false) return undefined;
  const problem = (at: string, fix: (subject: string) => string) => ({ at, problem: fix });
  if (setting === "format") {
    if (kind === "category")
      return problem("", (s) => `${s}; formats are for numbers and times; drop format`);
    if (!writes(value as object, kind))
      return problem("", (s) =>
        kind === "time" ? `${s}; give { time } or Intl date options` : `${s}; give a number format`,
      );
  }
  if ((setting === "min" || setting === "max") && kind !== "number")
    return problem("", (s) => `${s}; bounds are for numbers; drop ${setting}`);
  if (setting === "thresholds" && kind !== "number")
    return problem(
      "",
      (s) =>
        `${s}; thresholds are for number fields; ${kind === "category" ? "color categories with mappings" : "drop thresholds"}`,
    );
  if (setting === "mappings")
    for (const [i, mapping] of (value as readonly Record<string, unknown>[]).entries()) {
      if (mapping.between !== undefined && kind === "category")
        return problem(`[${i}].between`, (s) => `${s}; map them by value or regex`);
      if (mapping.regex !== undefined && kind !== "category")
        return problem(`[${i}].regex`, (s) => `${s}; map them by value or between`);
      const text = kind === "category";
      if (mapping.value !== undefined && (typeof mapping.value === "string") !== text)
        return problem(
          `[${i}].value`,
          (s) => `${s}; expected ${text ? "text" : "a number"}; received ${shown(mapping.value)}`,
        );
    }
  return undefined;
}

/**
 * Refuses, naming the path `at` of a rule matching `kinds` (and naming no
 * field), settings none of them takes.
 */
export function checkKinds(
  settings: Readonly<Record<string, unknown>>,
  kinds: readonly DisplayedKind[],
  at: string,
): void {
  for (const setting of SETTINGS) {
    const misfits = kinds.map((kind) => misfit(kind, setting, settings[setting]));
    const first = misfits[0];
    if (first && misfits.every((one) => one !== undefined))
      throw new Error(`${at}.${setting}${first.at}: ${first.problem(matchesKinds(kinds))}`);
  }
}

/** The problem with `pattern` as a JavaScript regular expression, or undefined where it compiles. */
export function regexProblem(pattern: string): string | undefined {
  try {
    new RegExp(pattern);
    return undefined;
  } catch (error) {
    // Engines say why after the pattern: "Invalid regular expression: /(/: Unterminated group".
    const reason = (error as Error).message.split(": ").at(-1)!.toLowerCase();
    return `${JSON.stringify(pattern)} is not a regular expression (${reason}); give a JavaScript one`;
  }
}

/** The problem with a mapping's range `[from, to]` (null for an open end), or undefined. */
export function rangeProblem(between: unknown): string | undefined {
  const end = (value: unknown) => value === null || Number.isFinite(value);
  if (!Array.isArray(between) || between.length !== 2 || !between.every(end))
    return `expected [from, to], null for an open end; received ${shown(between)}`;
  const [from, to] = between as [number | null, number | null];
  if (from !== null && to !== null && from > to)
    return `${from} is above ${to}; give from, then to`;
  return undefined;
}

/** Refuses `value` at `at`, saying what was `expected`. */
function expected(at: string, what: string, value: unknown): never {
  throw new Error(`${at}: expected ${what}; received ${shown(value)}`);
}

/** `value` as an object of settings among `keys`, refused otherwise, naming `at` and what it is. */
function settingsOf(
  value: unknown,
  at: string,
  what: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    expected(at, what, value);
  for (const key of Object.keys(value))
    if (!keys.includes(key))
      throw new Error(`${at}.${key}: unknown setting; use ${keys.join(", ")}`);
  return value as Record<string, unknown>;
}

/**
 * Refuses a display (or, with `rule`, a rule) that is malformed whatever
 * the data, naming its path `at`: settings it does not have, values of the
 * wrong type, formats their writers refuse, mappings matching two ways or
 * none, regular expressions that do not compile, and a rule's match.
 * Formats are checked with the writers `kit` hands.
 */
export function checkDisplay(display: unknown, at: string, kit: FormatKit, rule: boolean): void {
  const settings = settingsOf(
    display,
    at,
    "an object of settings",
    rule ? ["match", ...SETTINGS] : SETTINGS,
  );
  for (const key of SETTINGS) {
    const value = settings[key];
    const where = `${at}.${key}`;
    if (value === undefined || value === false) continue;
    if (key === "format") checkFormat(value, where, kit);
    else if (key === "mappings") checkMappings(value, where);
    else if (key === "thresholds") checkThresholds(value, where);
    else if (key === "missing" && typeof value === "object") {
      const { text, color } = settingsOf(value, where, "text, or { text, color }", [
        "text",
        "color",
      ]);
      if (text === undefined && color === undefined)
        throw new Error(`${where}: give text, color, or both`);
      if (text !== undefined && typeof text !== "string") expected(`${where}.text`, "text", text);
      if (color !== undefined) checkColor(color, `${where}.color`);
    } else if (key === "link") {
      const { url, text } = settingsOf(value, where, "{ url, text }", ["url", "text"]);
      if (typeof url !== "string") checkParts(url, `${where}.url`);
      if (text !== undefined) checkParts(text, `${where}.text`);
    } else if (key === "min" || key === "max") {
      if (!Number.isFinite(value)) expected(where, "a number", value);
    } else if (typeof value !== "string") expected(where, "text", value);
  }
  const { min, max } = settings;
  if (typeof min === "number" && typeof max === "number" && !(min < max))
    throw new Error(`${at}.min: ${min} is not below max ${max}; give min below max`);
  if (rule && settings.match !== undefined) {
    const kinds = checkMatch(settings.match, `${at}.match`);
    const named =
      typeof settings.match === "string" ||
      (settings.match as { field?: unknown }).field !== undefined;
    if (kinds && !named) checkKinds(settings, kinds, at);
  }
}

/** Refuses a format its writers refuse, naming its path `at`. */
export function checkFormat(format: unknown, at: string, kit: FormatKit): void {
  if (typeof format !== "object" || format === null || Array.isArray(format))
    expected(at, 'a format such as { number: ",.2f" }', format);
  try {
    const form = formOf(format, at);
    // Writers and Intl pass over settings they do not read, so those are refused here
    // (a fiscal year where it does not go, by the writers).
    for (const [key, value] of Object.entries(format)) {
      if (key === "fiscal" || key === form || value === undefined) continue;
      if (form === "intl" && !NUMBER_OPTIONS.includes(key) && !TIME_OPTIONS.includes(key))
        throw new Error(`${at}.${key}: not an Intl format option`);
      if (form !== "intl" && !FORM_SETTINGS[form].includes(key))
        throw new Error(`${at}.${key}: not a setting of { ${form} }; drop it`);
    }
    formatWriter(kit, format, !writes(format, "number"), "UTC", undefined, at);
  } catch (error) {
    // Intl's own refusals do not name the format.
    const message = (error as Error).message;
    throw new Error(message.startsWith(at) ? message : `${at}: ${message}`);
  }
}

function checkMappings(mappings: unknown, at: string): void {
  if (!Array.isArray(mappings)) expected(at, "a list of mappings", mappings);
  mappings.forEach((mapping: unknown, i) => {
    const where = `${at}[${i}]`;
    const { value, between, regex, text, color } = settingsOf(
      mapping,
      where,
      "{ value, text, color }",
      ["value", "between", "regex", "text", "color"],
    );
    if ([value, between, regex].filter((way) => way !== undefined).length !== 1)
      throw new Error(`${where}: a mapping matches by value, between, or regex; give one`);
    if (text === undefined && color === undefined)
      throw new Error(`${where}: give text, color, or both`);
    if (text !== undefined && typeof text !== "string") expected(`${where}.text`, "text", text);
    if (color !== undefined) checkColor(color, `${where}.color`);
    if (value !== undefined && typeof value !== "string" && !Number.isFinite(value))
      expected(`${where}.value`, "text or a number", value);
    const problem =
      between !== undefined
        ? rangeProblem(between)
        : regex === undefined
          ? undefined
          : typeof regex === "string"
            ? regexProblem(regex)
            : `expected text; received ${shown(regex)}`;
    if (problem)
      throw new Error(`${where}.${between !== undefined ? "between" : "regex"}: ${problem}`);
  });
}

/** Refuses a color that is not text, naming its path `at`: surfaces read it as CSS. */
function checkColor(color: unknown, at: string): void {
  if (typeof color !== "string" || color === "") expected(at, "a color", color);
}

/** Refuses malformed thresholds, naming their path `at`: steps ascend, each with a color. */
function checkThresholds(thresholds: unknown, at: string): void {
  const { mode, base, steps } = settingsOf(thresholds, at, "{ steps }", ["mode", "base", "steps"]);
  if (mode !== undefined && mode !== "absolute" && mode !== "percent")
    expected(`${at}.mode`, '"absolute" or "percent"', mode);
  if (base !== undefined) checkColor(base, `${at}.base`);
  if (!Array.isArray(steps) || steps.length === 0)
    expected(`${at}.steps`, "a list of steps, { value, color } each", steps);
  steps.forEach((step: unknown, i) => {
    const where = `${at}.steps[${i}]`;
    const { value, color } = settingsOf(step, where, "{ value, color }", ["value", "color"]);
    if (!Number.isFinite(value)) expected(`${where}.value`, "a finite number", value);
    const previous = i > 0 ? (steps[i - 1] as { value: number }).value : undefined;
    if (previous !== undefined && !((value as number) > previous))
      throw new Error(
        `${where}.value: steps ascend; ${value} follows ${previous}; order the steps by value`,
      );
    checkColor(color, `${where}.color`);
  });
}

/** A link's URL or text as parts: text, `{ field }`, or `{ value: true }`. */
function checkParts(parts: unknown, at: string): void {
  if (!Array.isArray(parts)) expected(at, "text or a list of parts", parts);
  parts.forEach((part: unknown, i) => {
    if (typeof part === "string") return;
    const where = `${at}[${i}]`;
    const { field, value } = settingsOf(part, where, "a part", ["field", "value"]);
    if ((field === undefined) === (value === undefined))
      throw new Error(`${where}: a part is text, { field }, or { value: true }; give one`);
    if (field !== undefined && typeof field !== "string")
      expected(`${where}.field`, "a field's name", field);
    if (value !== undefined && value !== true) expected(`${where}.value`, "true", value);
  });
}

/** Refuses a malformed match, naming its path `at`; returns the kinds it names. */
function checkMatch(match: unknown, at: string): readonly DisplayedKind[] | undefined {
  if (typeof match === "string") return undefined;
  const { field, regex, kind } = settingsOf(match, at, "a name or { field, regex, kind, table }", [
    "field",
    "regex",
    "kind",
    "table",
  ]);
  if (Object.keys(match as object).length === 0)
    throw new Error(`${at}: {} matches every field; drop match for that`);
  const names = Array.isArray(field) ? field : [field];
  if (field !== undefined && !(names.length > 0 && names.every((n) => typeof n === "string")))
    expected(`${at}.field`, "a name or names", field);
  if (regex !== undefined) {
    const problem = typeof regex === "string" ? regexProblem(regex) : "expected text";
    if (problem) throw new Error(`${at}.regex: ${problem}`);
  }
  if (kind === undefined) return undefined;
  const kinds = Array.isArray(kind) ? kind : [kind];
  if (kinds.length === 0 || !kinds.every((one) => KINDS.includes(one)))
    expected(`${at}.kind`, '"number", "time", or "category"', kind);
  return kinds;
}

/** A field's name as a path's key: `.latency`, or `["p.99"]`. */
export function keyPath(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? `.${name}` : `[${JSON.stringify(name)}]`;
}

export function shown(value: unknown): string {
  if (value === undefined) return "nothing";
  if (typeof value === "function") return "a function";
  return typeof value === "string" || typeof value === "object"
    ? JSON.stringify(value)
    : String(value);
}
