// Runtime checks of chart specs written outside TypeScript (the Python
// package, stored JSON), where the type checker cannot help: structure,
// enumerations, booleans, finite numbers, and field references. Errors are
// ChartErrors with the offending property's path, saying what was
// expected, as in
// `marks[2].inner: expected "box", "quartiles", or "none"; received "quart"`.
// Properties the format does not have are refused by default, naming the
// property meant where one is close, so misspellings do not go unnoticed.

import { checkBins } from "../data/bins.ts";
import { numberPattern, timePattern } from "../format/patterns.ts";
import { calendarInterval } from "../guides/ticks.ts";
import { areaFormError } from "../marks/area.ts";
import { boxPlotFormError } from "../marks/boxplot-input.ts";
import { contourFormError } from "../marks/contour-input.ts";
import { checkLeaves, checkLinkage } from "../marks/dendrogram-data.ts";
import { errorBarForm } from "../marks/errorbar.ts";
import { heatmapFormError } from "../marks/heatmap.ts";
import { histogramFormError, perAxisBins } from "../marks/histogram-input.ts";
import { pointSizeForm } from "../marks/point.ts";
import { regionFormError } from "../marks/region.ts";
import { ruleFormError } from "../marks/rule.ts";
import { treeFormError } from "../marks/tree-data.ts";
import { Bindings } from "../model/bindings.ts";
import { GUIDE_KIT } from "../model/guides.ts";
import { panelInteraction } from "../model/panel-interaction.ts";
import { checkBreaks } from "../scale/breaks.ts";
import { MARK_CHANNELS } from "./channels.ts";
import type {
  AreaLabelsSpec,
  BarLabelPlaceSpec,
  BarLabelsSpec,
  ContinuitySpec,
  EncodingsSpec,
  IdentityScaleSpec,
  LabelPart,
  LabelPlaceSpec,
  LabelSpec,
  MarkAnchorSpec,
  MarkerStyle,
  MarkStyleSpec,
  OrdinalScaleSpec,
  SeriesStyle,
  StackSpec,
  StyleMapSpec,
} from "./encoding.ts";
import { ChartError, type ChartErrorCode } from "./errors.ts";
import {
  type AnimationSpec,
  type AxisGuideSpec,
  type AxisSpec,
  type BinaryColumnSpec,
  type CameraSpec,
  type CategoryColumnSpec,
  type ChartAxisSpec,
  type ChartSpec,
  type ColorbarSpec,
  type ColumnsSpec,
  type CursorShowSpec,
  type DerivedSpec,
  type GeometryColumnSpec,
  type GridFacetSpec,
  type GridLayoutSpec,
  type GridLinesSpec,
  type InsetIndicatorSpec,
  type InsetSpec,
  type InsidePlace,
  type InteractionSpec,
  type LayoutCellSpec,
  type LegendEntrySpec,
  type LegendGuideSpec,
  type LegendInclude,
  type LegendSpec,
  type LegendTarget,
  type MarkSpec,
  type NavigatorSpec,
  type PanelInteractionSpec,
  type PanelLayoutSpec,
  type PanelSpec,
  type PanelTitleSpec,
  type PlotStyle,
  type ProjectionSpec,
  type RowSelectionSpec,
  type ScaleLimitsSpec,
  type ScaleSpec,
  type SidePlace,
  SPEC_VERSION,
  type StrokeStyle,
  type StyleRoles,
  type SyncSpec,
  type TextBox,
  type TextLabelSpec,
  type TextStyle,
  type ThemeSpec,
  type ThemeTokens,
  type TickLabelsSpec,
  type TickLayerSpec,
  type TickMarkSpec,
  type TimeColumnSpec,
  type TitleSpec,
  type TooltipSpec,
  type ViewLimitsSpec,
  type WrappedFacetSpec,
  type XAxisSpec,
} from "./spec.ts";

type Check = (value: unknown, path: string) => void;

/** Every property of any form of `T`. */
type AllKeys<T> = T extends unknown ? keyof T : never;
/**
 * A check for each property of `T`, so that adding a property to a spec
 * without checking it here fails to compile.
 */
type ChecksOf<T> = Record<AllKeys<T>, Check>;

/** A property no check knows, with the properties its object may have. */
export interface UnknownProperty {
  path: string;
  known: readonly string[];
}

/** The properties no check knows, collected while `checkSpec` runs. */
let unknownPaths: UnknownProperty[] | undefined;

/**
 * The error refusing what is at `path` (as checks walk the spec:
 * `marks[2].inner`, or `spec.data` for the chart's own options), saying
 * `problem`: at its path in the spec (`data`), in the message too, as the
 * chart's options are refused wherever they are; the spec itself at "spec".
 */
function refusal(
  path: string,
  problem: string,
  code: ChartErrorCode = "invalid-option",
): ChartError {
  const at = inSpec(path);
  return new ChartError({ code, path: at, message: `${at ?? "spec"}: ${problem}` });
}

/** A path as checks walk the spec (`spec.title`), as the spec names it (`title`); undefined for the spec itself. */
function inSpec(path: string): string | undefined {
  return path.replace(/^spec(\.|$)/, "") || undefined;
}

/**
 * An error a check at `path` delegated to, whose message names its place
 * itself, given the path as checks walk the spec (see `refusal`).
 */
function delegated(path: string, error: unknown): ChartError {
  const refused = refusal(path, "");
  refused.message = (error as Error).message.replace(/^spec\./, "");
  return refused;
}

function fail(path: string, expected: string, value: unknown): never {
  throw refusal(path, `expected ${expected}; received ${describe(value)}`);
}

/** Choices in prose: "a", "a or b", or "a, b, or c". */
export function either(choices: readonly string[]): string {
  if (choices.length < 3) return choices.join(" or ");
  return `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}`;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "string")
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  if (typeof value === "object") return "an object";
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const string: Check = (v, path) => {
  if (typeof v !== "string") fail(path, "a string", v);
};
const field: Check = (v, path) => {
  if (typeof v !== "string") fail(path, "a field name", v);
};
const integer: Check = (v, path) => {
  if (!Number.isInteger(v)) fail(path, "a whole number", v);
};
/** A series field, or false for none: lines, areas, and bars infer one from a `color` field. */
const seriesField: Check = (v, path) => {
  if (typeof v !== "string" && v !== false) fail(path, "a field name, or false", v);
};
const fields: Check = (v, path) => {
  if (Array.isArray(v)) {
    if (v.length === 0) fail(path, "at least one field name", v);
    for (const [i, item] of v.entries()) field(item, `${path}[${i}]`);
  } else {
    field(v, path);
  }
};
const boolean: Check = (v, path) => {
  if (typeof v !== "boolean") fail(path, "true or false", v);
};
const finite: Check = (v, path) => {
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "a finite number", v);
};
const positive: Check = (v, path) => {
  if (typeof v !== "number" || !(v > 0) || !Number.isFinite(v)) fail(path, "a positive number", v);
};
/** Grid lines: true or false, or { zIndex }, where they are painted among the marks. */
const grid: Check = (v, path) => {
  if (typeof v === "boolean") return;
  if (!isRecord(v)) fail(path, "true, false, or { zIndex }", v);
  properties(v, path, { zIndex: finite } satisfies ChecksOf<GridLinesSpec>);
};
const count: Check = (v, path) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
    fail(path, "a whole number of at least 1", v);
};
/** Colors as a list, or a scheme's name (resolved when the spec is loaded). */
const ramp: Check = (v, path) => {
  if (typeof v === "string") return;
  strings(v, path);
};
/** Two finite numbers, the first below the second. */
const range: Check = (v, path) => {
  if (
    !Array.isArray(v) ||
    v.length !== 2 ||
    !v.every((x) => typeof x === "number" && Number.isFinite(x)) ||
    !(v[0] < v[1])
  )
    fail(path, "two finite numbers, ascending", v);
};
/** A constant position or a field name. */
const position: Check = (v, path) => {
  if (typeof v !== "string" && (typeof v !== "number" || !Number.isFinite(v)))
    fail(path, "a finite number or a field name", v);
};
const width: Check = (v, path) => {
  if (typeof v !== "number" || !(v >= 0) || !Number.isFinite(v))
    fail(path, "a number of at least 0", v);
};
/** Pixels as a length: `{ px }`, 0 or more. */
const pixels: Check = (v, path) => {
  if (!isRecord(v)) fail(path, "{ px }, a length in pixels", v);
  checkProperties(v, path, ["px"], { px: width });
};
/** Room a scale keeps around its data: "auto", a share of its domain, or `{ px }`. */
const padding: Check = (v, path) => {
  if (v === "auto") return;
  if (typeof v === "number") {
    if (!(v >= 0 && v < 0.5)) fail(path, "a share of the domain from 0 up to 0.5, not 0.5", v);
    return;
  }
  if (!isRecord(v)) fail(path, '"auto", a share of the domain from 0 up to 0.5, or { px }', v);
  pixels(v, path);
};
const fraction: Check = (v, path) => {
  if (typeof v !== "number" || !(v >= 0 && v <= 1)) fail(path, "a number from 0 to 1", v);
};
/** A number strictly between 0 and 1. */
const share: Check = (v, path) => {
  if (typeof v !== "number" || !(v > 0 && v < 1)) fail(path, "a number between 0 and 1", v);
};
const strings: Check = (v, path) => {
  if (!Array.isArray(v)) fail(path, "an array of strings", v);
  for (const [i, item] of v.entries()) string(item, `${path}[${i}]`);
};
const numbers: Check = (v, path) => {
  if (!Array.isArray(v)) fail(path, "an array of numbers", v);
  for (const [i, item] of v.entries()) finite(item, `${path}[${i}]`);
};
const dash: Check = (v, path) => {
  if (typeof v === "string") oneOf("-", "--", ":", "-.")(v, path);
  else numbers(v, path);
};
/** Rows by position: a buffer index, or a list of whole numbers from 0. */
const positions: Check = (v, path) => {
  if (typeof v === "number") {
    if (!Number.isInteger(v) || v < 0) fail(path, "a buffer index or a list of row positions", v);
    return;
  }
  if (!Array.isArray(v)) fail(path, "a buffer index or a list of row positions", v);
  for (const [i, item] of v.entries())
    if (!Number.isInteger(item) || item < 0)
      fail(`${path}[${i}]`, "a row position, 0 or more", item);
};
const object: Check = (v, path) => {
  if (!isRecord(v)) fail(path, "an object", v);
};

function oneOf(...values: readonly string[]): Check {
  return (v, path) => {
    if (!values.includes(v as string)) fail(path, either(values.map((x) => JSON.stringify(x))), v);
  };
}

/**
 * Checks the listed properties of `value` that are present, and notes any
 * property neither listed nor among `others`, which are checked elsewhere.
 */
function properties(
  value: Record<string, unknown>,
  path: string,
  checks: Record<string, Check>,
  others: readonly string[] = [],
) {
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(checks, key) && !others.includes(key))
      unknownPaths?.push({
        path: inSpec(`${path}.${key}`)!,
        known: [...Object.keys(checks), ...others],
      });
  }
  for (const [key, check] of Object.entries(checks)) {
    if (value[key] !== undefined) check(value[key], `${path}.${key}`);
  }
}

/** A property of `value` outside `known` that looks like a misspelling of `key`. */
function misspelling(
  value: Record<string, unknown>,
  key: string,
  known: readonly string[],
): string | undefined {
  return Object.keys(value).find((name) => !known.includes(name) && closest(name, [key]) === key);
}

/** The error for a missing `key`, naming its misspelling when there is one. */
function missing(path: string, key: string, typo: string | undefined): ChartError {
  return refusal(
    `${path}.${key}`,
    typo === undefined
      ? "required"
      : `required; rename "${typo}", which is not a property, to "${key}"`,
  );
}

/**
 * Refuses a value missing any of `keys`. With the properties it may have
 * (`known`), a missing key's misspelling among the others is named.
 */
function required(
  value: Record<string, unknown>,
  path: string,
  keys: readonly string[],
  known?: readonly string[],
) {
  for (const key of keys) {
    if (value[key] === undefined) throw missing(path, key, known && misspelling(value, key, known));
  }
}

/** Refuses an object missing any of `keys`, then checks its properties. */
function checkProperties(
  value: Record<string, unknown>,
  path: string,
  keys: readonly string[],
  checks: Record<string, Check>,
) {
  required(value, path, keys, Object.keys(checks));
  properties(value, path, checks);
}

/** `pan` and `zoom`: on, off, or the axes they act on. */
const axesPreset: Check = (v, path) => {
  if (typeof v !== "boolean" && v !== "x" && v !== "y" && v !== "xy")
    fail(path, 'true, false, "x", "y", or "xy"', v);
};
const modifiers: Check = (v, path) => {
  if (!Array.isArray(v)) fail(path, "a list of keys held", v);
  for (const [i, key] of v.entries()) oneOf("shift", "ctrl", "alt", "meta")(key, `${path}[${i}]`);
};

/** The actions each gesture can perform (see `BindingSpec`). */
const ACTIONS: Record<string, readonly string[]> = {
  wheel: ["pan", "zoom", "pageScroll"],
  drag: ["pan", "brush", "pageScroll", "cursor", "orbit", "moveItem"],
  pinch: ["zoom", "pageScroll"],
  key: ["pan", "zoom", "reset"],
  doubleClick: ["zoom", "reset"],
};

const binding: Check = (v, path) => {
  object(v, path);
  const b = v as Record<string, unknown>;
  required(b, path, ["gesture", "action"], ["gesture", "action"]);
  properties(b, path, { gesture: object, action: object });
  const gesture = b.gesture as Record<string, unknown>;
  const type = gesture.type as string;
  const takes = ACTIONS[type];
  if (!takes) fail(`${path}.gesture.type`, either(Object.keys(ACTIONS).map((t) => `"${t}"`)), type);
  const checks: Record<string, Record<string, Check>> = {
    wheel: { axis: oneOf("x", "y"), modifiers, focused: boolean },
    drag: { button: oneOfNumbers(0, 1, 2), pointer: oneOf("mouse", "touch", "pen"), modifiers },
    pinch: {},
    key: { key: string, modifiers },
    doubleClick: { modifiers },
  };
  checkProperties(gesture, `${path}.gesture`, type === "key" ? ["key"] : [], {
    type: string,
    ...checks[type],
  });
  const action = b.action as Record<string, unknown>;
  const kind = action.type as string;
  if (!takes.includes(kind))
    fail(
      `${path}.action.type`,
      `an action a ${type} gesture performs: ${either(takes.map((t) => `"${t}"`))}`,
      kind,
    );
  const step: Check = (s, at) => {
    if (!Array.isArray(s) || s.length !== 2 || !s.every((x) => Number.isFinite(x)))
      fail(at, "two fractions of the view, across and up", s);
  };
  const actionChecks: Record<string, Record<string, Check>> = {
    pan: { axes: oneOf("x", "y", "xy"), step },
    zoom: { axes: oneOf("x", "y", "xy"), factor: positive },
    brush: { shape: oneOf("x", "y", "xy", "lasso"), zoom: boolean },
  };
  properties(action, `${path}.action`, { type: string, ...actionChecks[kind] });
};

function oneOfNumbers(...values: readonly number[]): Check {
  return (v, path) => {
    if (!values.includes(v as number)) fail(path, either(values.map(String)), v);
  };
}

const scaleLimits: Check = (v, path) => {
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    extent: (e, at) => {
      const end = (x: unknown) => x === null || (typeof x === "number" && Number.isFinite(x));
      if (
        !Array.isArray(e) ||
        e.length !== 2 ||
        !e.every(end) ||
        (e[0] !== null && e[1] !== null && !(e[0] < e[1]))
      )
        fail(at, "two finite numbers, ascending, either of them null for no end", e);
    },
    edge: (e, at) => {
      if (typeof e === "boolean") return;
      object(e, at);
      properties(e as Record<string, unknown>, at, { threshold: width, hysteresis: width });
    },
  } satisfies ChecksOf<ScaleLimitsSpec>);
};

const cursorShow = {
  snap: oneOf("nearest", "previous", "next"),
  tooltip: boolean,
} satisfies ChecksOf<CursorShowSpec>;

function syncChannel(cursor: boolean, ...scales: readonly string[]): Check {
  return (v, path) => {
    if (typeof v === "string") return;
    object(v, path);
    checkProperties(v as Record<string, unknown>, path, ["group"], {
      group: string,
      scale: oneOf(...scales),
      panel: string,
      ...(cursor && cursorShow),
    });
  };
}

/** What a chart's `interaction` and a panel's own check alike: all but `sync`, the chart's. */
const interactionChecks = {
  pan: axesPreset,
  zoom: axesPreset,
  brush: oneOf("x", "y", "xy", "lasso"),
  bindings: (v, at) => {
    if (!Array.isArray(v)) fail(at, "a list of bindings", v);
    for (const [k, item] of v.entries()) binding(item, `${at}[${k}]`);
  },
  limits: (v, at) => {
    object(v, at);
    properties(v as Record<string, unknown>, at, {
      x: scaleLimits,
      y: scaleLimits,
      yRight: scaleLimits,
    } satisfies ChecksOf<ViewLimitsSpec>);
  },
  rotate: boolean,
  drag: boolean,
} satisfies ChecksOf<PanelInteractionSpec>;

const curve = oneOf("linear", "step", "step-before", "step-after", "monotone");

/** A portable expression: a literal, or an array of an operator and its operands. */
const expression: Check = (v, path) => {
  if (v === null || typeof v === "number" || typeof v === "string" || typeof v === "boolean")
    return;
  if (!Array.isArray(v) || typeof v[0] !== "string")
    fail(path, 'an expression: a literal or ["operator", ...operands]', v);
  for (let i = 1; i < v.length; i++) expression(v[i], `${path}[${i}]`);
};

const AGGREGATE_OPS = [
  "count",
  "sum",
  "mean",
  "median",
  "min",
  "max",
  "q1",
  "q3",
  "stdev",
  "variance",
  "distinct",
  "first",
  "last",
] as const;
const ROLLING_OPS = ["count", "sum", "mean", "min", "max", "stdev"] as const;

/** A list of operations, each `{ op, field?, as }`. */
function operations(ops: readonly string[], needsField: boolean): Check {
  return (v, path) => {
    if (!Array.isArray(v)) fail(path, "a list of operations", v);
    for (const [i, item] of v.entries()) {
      const at = `${path}[${i}]`;
      object(item, at);
      const operation = item as Record<string, unknown>;
      checkProperties(operation, at, needsField ? ["op", "field", "as"] : ["op", "as"], {
        op: oneOf(...ops),
        field,
        as: field,
      });
    }
  };
}

/** Bins along one axis: a count, `{ step, start }`, or edges. */
const binSpec: Check = (v, path) => {
  if (typeof v === "number" || Array.isArray(v)) {
    checkBins(v, path);
    return;
  }
  if (!isRecord(v)) fail(path, "a bin count, { step, start }, or a list of edges", v);
  checkProperties(v, path, ["step"], { step: positive, start: finite });
};

/** The keys a transform of each kind takes. */
const TRANSFORMS: Record<string, { required: string[]; checks: Record<string, Check> }> = {
  filter: { required: [], checks: { filter: expression } },
  calculate: { required: ["as"], checks: { calculate: expression, as: field } },
  bin: {
    required: [],
    checks: { bin: field, bins: binSpec, as: field, end: field },
  },
  aggregate: {
    required: [],
    checks: { aggregate: operations(AGGREGATE_OPS, false), by: fields },
  },
  rolling: {
    required: ["size"],
    checks: { rolling: operations(ROLLING_OPS, true), size: count, by: fields },
  },
  sort: { required: [], checks: { sort: field, order: oneOf("ascending", "descending") } },
};

/** The steps of a derived table. */
const transforms: Check = (v, path) => {
  if (!Array.isArray(v)) fail(path, "a list of transforms", v);
  for (const [i, item] of v.entries()) {
    const at = `${path}[${i}]`;
    object(item, at);
    const step = item as Record<string, unknown>;
    const kind = Object.keys(TRANSFORMS).find((name) => step[name] !== undefined);
    if (!kind) fail(at, `a transform (${Object.keys(TRANSFORMS).join(", ")})`, item);
    const { required: keys, checks } = TRANSFORMS[kind]!;
    required(step, at, keys, Object.keys(checks));
    // A step naming two transforms is ambiguous; other keys are unknown.
    const other = Object.keys(step).find((key) => key !== kind && Object.hasOwn(TRANSFORMS, key));
    if (other) throw refusal(`${at}.${other}`, `a step is one transform, here ${kind}`);
    properties(step, at, checks);
  }
};

/** Options only number or only date formatting reads, to tell which a format is for. */
const NUMBER_FORMAT =
  /^(m(ax|in)imum|notation|style|currency|unit|compactDisplay|signDisplay|useGrouping|roundingMode)/;
const TIME_FORMAT =
  /^(year|month|day|hour|minute|second|weekday|era|timeZoneName|hour12|hourCycle|dateStyle|timeStyle|fractionalSecondDigits|dayPeriod)$/;

/** Checks an axis' Intl format options by constructing the formatter they are for. */
function format(type: unknown): Check {
  return (v, path) => {
    object(v, path);
    const keys = Object.keys(v as object);
    const time =
      type === "time" || (type === undefined && keys.some((key) => TIME_FORMAT.test(key)));
    const number =
      type !== "time" && (type !== undefined || keys.some((key) => NUMBER_FORMAT.test(key)));
    try {
      if (time) new Intl.DateTimeFormat(undefined, v as Intl.DateTimeFormatOptions);
      if (number) new Intl.NumberFormat(undefined, v as Intl.NumberFormatOptions);
    } catch (error) {
      throw refusal(path, (error as Error).message);
    }
    // Intl ignores options it does not know, so misspelled ones are noted here.
    // Without an axis type, either kind of option may be meant.
    const known = [
      ...(type !== "linear" && type !== "log" ? TIME_OPTIONS : []),
      ...(type !== "time" ? NUMBER_OPTIONS : []),
    ];
    for (const key of keys)
      if (!known.includes(key)) unknownPaths?.push({ path: inSpec(`${path}.${key}`)!, known });
  };
}

const NUMBER_OPTIONS = [
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
const TIME_OPTIONS = [
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

/** The checks of an axis' options. */
function axisChecks(spec: Record<string, unknown>): ChecksOf<AxisSpec> {
  return {
    type: oneOf("linear", "log", "time"),
    domain: (d, p) => {
      numbers(d, p);
      if ((d as unknown[]).length !== 2) fail(p, "two numbers", d);
    },
    nice: boolean,
    zero: boolean,
    title: string,
    grid,
    padding,
    ticks: ticks(spec.type),
    format: axisFormat(spec.type),
    tooltipFormat: axisFormat(spec.type),
    show: boolean,
    style: axisStyle,
  };
}

/** A function where a spec holds data: JavaScript only, never serializable. */
function noFunction(v: unknown, path: string, instead: string): void {
  if (typeof v === "function") throw refusal(path, `a function cannot be in a spec; ${instead}`);
}

/**
 * Which ticks an axis of `type` draws: a count, `{ count }`, `{ every,
 * anchor }`, or `{ values }`.
 */
function ticks(type: unknown): Check {
  return (v, path) => {
    noFunction(v, path, "give a count, { every }, or { values }");
    if (typeof v === "number") return positive(v, path);
    if (!isRecord(v)) fail(path, "a count, or an object with count, every, or values", v);
    if ("count" in v) return checkProperties(v, path, ["count"], { count: positive });
    if ("values" in v)
      return checkProperties(v, path, ["values"], {
        values: (list, at) => {
          if (!Array.isArray(list)) fail(at, "a list of values", list);
          list.forEach((value, i) => {
            if (
              !(typeof value === "string" || (typeof value === "number" && Number.isFinite(value)))
            )
              fail(`${at}[${i}]`, "a finite number, epoch milliseconds, or a category", value);
          });
        },
      });
    if (!("every" in v)) fail(path, "an object with count, every, or values", v);
    const every = v.every;
    const calendar = typeof every === "string" || (isRecord(every) && "unit" in every);
    checkProperties(v, path, ["every"], {
      every: (e, at) => {
        if (typeof e === "number") {
          positive(e, at);
          if (type === "time")
            fail(
              at,
              'a time interval on a time axis, such as "6 hours" or { milliseconds: 3600000 }',
              e,
            );
          if (type === "log")
            fail(at, "a count or values on a log axis, which has no even steps", e);
          return;
        }
        if (type === "linear" || type === "log") fail(at, `a number on a ${type} axis`, e);
        if (isRecord(e) && "milliseconds" in e)
          return checkProperties(e, at, ["milliseconds"], { milliseconds: positive });
        if (isRecord(e)) checkProperties(e, at, ["unit"], { unit: string, step: count });
        else if (typeof e !== "string")
          fail(at, 'a number, a time interval such as "6 hours", or { milliseconds }', e);
        try {
          calendarInterval(e as string, at);
        } catch (error) {
          throw delegated(at, error);
        }
      },
      anchor: (a, at) => {
        finite(a, at);
        if (calendar)
          fail(at, "no anchor with a calendar interval, which starts at calendar boundaries", a);
      },
    });
  };
}

/**
 * How an axis of `type` writes values: Intl options, or a pattern, `{ number }`
 * (d3-format) or `{ time }` (strftime), alone.
 */
function axisFormat(type: unknown): Check {
  const intl = format(type);
  return (v, path) => {
    noFunction(v, path, 'give Intl options, { number: ",.2f" }, or { time: "%H:%M" }');
    if (!isRecord(v) || !("number" in v || "time" in v)) return intl(v, path);
    const key = "number" in v ? "number" : "time";
    checkProperties(v, path, [key], { [key]: string });
    if (key === "number" && type === "time")
      fail(`${path}.number`, '{ time: "..." } or Intl date options on a time axis', v.number);
    if (key === "time" && (type === "linear" || type === "log"))
      fail(`${path}.time`, '{ number: "..." } or Intl number options on a number axis', v.time);
    try {
      if (key === "number")
        numberPattern(GUIDE_KIT, v.number as string, undefined, `${path}.number`);
      else timePattern(GUIDE_KIT, v.time as string, "UTC", undefined, `${path}.time`);
    } catch (error) {
      throw delegated(`${path}.${key}`, error);
    }
  };
}

/** Tick marks: their direction and length. */
const tickMark: Check = (v, path) => {
  if (v === false) return;
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    direction: oneOf("out", "in", "cross"),
    length: width,
  } satisfies ChecksOf<TickMarkSpec>);
};

/** A turn of labels: degrees from -90 (reading up) to 90 (reading down). */
const angle: Check = (v, path) => {
  if (typeof v !== "number" || !(v >= -90 && v <= 90)) fail(path, "degrees from -90 to 90", v);
};

/** Tick labels: rotation, collision policy, row, priority, and repeats. */
const tickLabels: Check = (v, path) => {
  if (v === false) return;
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    rotation: (r, at) => {
      if (typeof r === "number") return angle(r, at);
      object(r, at);
      checkProperties(r as Record<string, unknown>, at, ["candidates"], {
        candidates: (c, where) => {
          if (!Array.isArray(c) || c.length === 0) fail(where, "a list of angles", c);
          for (const [i, turn] of c.entries()) angle(turn, `${where}[${i}]`);
        },
      });
    },
    collision: oneOf("show", "hide", "stagger", "wrap"),
    row: (r, at) => {
      if (!Number.isInteger(r) || (r as number) < 0) fail(at, "a row: 0, 1, 2, ...", r);
    },
    priority: finite,
    duplicates: oneOf("hide", "show"),
    inside: boolean,
    gap: width,
  } satisfies ChecksOf<TickLabelsSpec>);
};

/**
 * Which panels share a scale: a name, the rows or columns of a layout
 * grid, or panels by id (checked against the layout as panels load).
 */
const scope: Check = (v, path) => {
  if (typeof v === "string") return oneOf("chart", "panel", "row", "column")(v, path);
  if (!isRecord(v))
    fail(path, '"chart", "panel", "row", "column", { layout, by }, or { panels }', v);
  if ("panels" in v) return checkProperties(v, path, ["panels"], { panels: strings });
  checkProperties(v, path, ["layout", "by"], { layout: string, by: oneOf("row", "column") });
};
/** Where panels sharing a scale label it. */
const labelRepeat = oneOf("outer", "all");

/**
 * A y axis (`chart`, the chart's y or yRight, whose scale panels may share),
 * or a panel's or a 3D chart's axis.
 */
function anyAxis(v: unknown, path: string, chart: boolean): void {
  object(v, path);
  const spec = v as Record<string, unknown>;
  // Only the x axis has breaks: refuse them elsewhere rather than ignore them.
  if (spec.breaks !== undefined)
    fail(`${path}.breaks`, "breaks on the chart's x axis only", spec.breaks);
  if (spec.seams !== undefined)
    fail(`${path}.seams`, "seams on the chart's x axis only", spec.seams);
  if (chart)
    properties(spec, path, {
      ...axisChecks(spec),
      scope,
      repeat: labelRepeat,
    } satisfies ChecksOf<ChartAxisSpec>);
  else {
    if (spec.scope !== undefined)
      fail(`${path}.scope`, "scope on the chart's x, y, or yRight only", spec.scope);
    if (spec.repeat !== undefined)
      fail(`${path}.repeat`, "repeat on the chart's x, y, or yRight only", spec.repeat);
    properties(spec, path, axisChecks(spec));
  }
}

const axis: Check = (v, path) => anyAxis(v, path, false);
const chartAxis: Check = (v, path) => anyAxis(v, path, true);

const xAxis: Check = (v, path) => {
  object(v, path);
  const spec = v as Record<string, unknown>;
  properties(spec, path, {
    ...axisChecks(spec),
    scope,
    repeat: labelRepeat,
    // Whether any x scale is a time scale shows only once panels are planned.
    breaks: (v, at) => {
      checkBreaks(v, at);
      // Each break is of one kind, whose keys are the only ones it takes.
      for (const [i, rule] of (v as Record<string, unknown>[]).entries()) {
        const kind = ["weekdays", "hours", "dates"].find((key) => rule[key] !== undefined);
        properties(rule, `${at}[${i}]`, {}, kind ? [kind] : ["from", "to"]);
      }
    },
    seams: (v, at) => {
      if (typeof v !== "boolean") {
        object(v, at);
        properties(v as Record<string, unknown>, at, { minSpacing: positive });
      }
      if (v !== false && spec.breaks === undefined)
        fail(at, "time-axis breaks when seams are enabled", v);
    },
  } satisfies ChecksOf<XAxisSpec>);
};

const THEMES = ["light", "dark", "high-contrast", "high-contrast-dark", "auto"];

/** Space around a box: one number of pixels, or one per side. */
const insets: Check = (v, path) => {
  if (typeof v === "number") return width(v, path);
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    top: width,
    right: width,
    bottom: width,
    left: width,
  });
};

const halo: Check = (v, path) => {
  if (v === false || v === "auto") return;
  if (!isRecord(v)) fail(path, '"auto", false, or an object with a color', v);
  checkProperties(v, path, ["color"], { color: string, width, opacity: fraction });
};

const textBox: Check = (v, path) => {
  if (v === false) return;
  if (!isRecord(v)) fail(path, "false or an object with fill", v);
  checkProperties(v, path, ["fill"], {
    fill: string,
    stroke: string,
    strokeWidth: width,
    radius: width,
  } satisfies ChecksOf<TextBox>);
};

const textStyle: Check = (v, path) => {
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    font: string,
    fontSize: positive,
    fontWeight: (w, at) => {
      if (typeof w !== "number" || !Number.isInteger(w) || w < 1 || w > 1000)
        fail(at, "a whole number from 1 to 1000, such as 400 or 600", w);
    },
    fontStyle: oneOf("normal", "italic"),
    color: string,
    opacity: fraction,
    lineHeight: positive,
    align: oneOf("start", "center", "end"),
    verticalAlign: oneOf("top", "middle", "bottom"),
    halo,
    background: textBox,
    padding: insets,
  } satisfies ChecksOf<TextStyle>);
};

const strokeChecks = {
  stroke: string,
  strokeWidth: width,
  dash,
  opacity: fraction,
} satisfies ChecksOf<StrokeStyle>;

const strokeStyle: Check = (v, path) => {
  object(v, path);
  properties(v as Record<string, unknown>, path, strokeChecks);
};

/** The checks of each style role. */
const ROLES = {
  text: textStyle,
  title: textStyle,
  panelTitle: textStyle,
  axisTitle: textStyle,
  tickLabel: textStyle,
  legendLabel: textStyle,
  legendTitle: textStyle,
  plot: (v, path) => {
    object(v, path);
    properties(v as Record<string, unknown>, path, {
      fill: string,
      stroke: string,
      strokeWidth: width,
    } satisfies ChecksOf<PlotStyle>);
  },
  grid: strokeStyle,
  axisLine: strokeStyle,
  tick: strokeStyle,
  line: (v, path) => {
    object(v, path);
    properties(v as Record<string, unknown>, path, { strokeWidth: positive });
  },
  bar: (v, path) => {
    object(v, path);
    properties(v as Record<string, unknown>, path, { radius: width });
  },
  tooltip: (v, path) => {
    object(v, path);
    properties(v as Record<string, unknown>, path, { fill: string, stroke: string });
  },
} satisfies ChecksOf<StyleRoles>;

/** Styles of `roles` only: a guide's or a panel's, which style what it draws. */
function rolesOf<K extends keyof StyleRoles>(roles: readonly K[]): Check {
  const checks = Object.fromEntries(roles.map((role) => [role, ROLES[role]])) as Record<K, Check>;
  return (v, path) => {
    object(v, path);
    properties(v as Record<string, unknown>, path, checks);
  };
}

const AXIS_ROLES = ["axisLine", "tick", "tickLabel", "axisTitle", "grid"] as const;
const axisStyle = rolesOf(AXIS_ROLES);

const theme: Check = (v, path) => {
  if (typeof v === "string") return oneOf(...THEMES)(v, path);
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    extends: oneOf(...THEMES),
    tokens: (t, at) => {
      object(t, at);
      properties(t as Record<string, unknown>, at, {
        background: string,
        text: string,
        muted: string,
        grid: string,
        axis: string,
        palette: strings,
        sequential: strings,
        diverging: strings,
        rise: string,
        fall: string,
      } satisfies ChecksOf<ThemeTokens>);
    },
    style: (r, at) => {
      object(r, at);
      properties(r as Record<string, unknown>, at, ROLES);
    },
  } satisfies ChecksOf<ThemeSpec>);
};

const sides = oneOf("top", "right", "bottom", "left");
/** Sides of a rectangle, each once, such as those of its outline that are drawn. */
const sideList: Check = (v, path) => {
  if (!Array.isArray(v)) fail(path, 'a list of sides, such as ["top", "bottom"]', v);
  for (const [i, side] of v.entries()) sides(side, `${path}[${i}]`);
  if (new Set(v).size !== v.length) fail(path, "each side once", v);
};

/** Where a guide goes: on a side outside the plots, or inside a plot. */
const place: Check = (v, path) => {
  object(v, path);
  const spec = v as Record<string, unknown>;
  const where = { scope: oneOf("chart", "panel"), panel: string };
  if (spec.inside !== undefined) {
    if (spec.side !== undefined) fail(path, "side or inside, not both", v);
    properties(spec, path, {
      inside: oneOf(
        "top-left",
        "top",
        "top-right",
        "right",
        "bottom-right",
        "bottom",
        "bottom-left",
        "left",
      ),
      inset: width,
      ...where,
    } satisfies ChecksOf<InsidePlace>);
    return;
  }
  checkProperties(spec, path, ["side"], {
    side: sides,
    align: oneOf("start", "center", "end"),
    offset: width,
    ...where,
  } satisfies ChecksOf<SidePlace>);
};

/** A chart's title: its text, or its text with its place and style. */
const title: Check = (v, path) => {
  if (typeof v === "string") return;
  if (!isRecord(v)) fail(path, "a string or an object with text", v);
  checkProperties(v, path, ["text"], {
    text: string,
    place: (p, at) => {
      object(p, at);
      checkProperties(p as Record<string, unknown>, at, ["side"], {
        side: oneOf("top", "bottom"),
      });
    },
    style: textStyle,
  } satisfies ChecksOf<TitleSpec>);
};

const panelTitle: Check = (v, path) => {
  if (typeof v === "string") return;
  if (!isRecord(v)) fail(path, "a string or an object with text", v);
  checkProperties(v, path, ["text"], {
    text: string,
    style: textStyle,
  } satisfies ChecksOf<PanelTitleSpec>);
};

const legend: Check = (v, path) => {
  if (typeof v === "boolean") return;
  if (!isRecord(v)) fail(path, "true, false, or an object", v);
  properties(v, path, legendOptions(v, path) satisfies ChecksOf<LegendSpec>);
};

/** A legend's title: its text, or its text and style. */
const legendTitle: Check = (v, path) => {
  if (typeof v === "string") return;
  if (!isRecord(v)) fail(path, "a string or an object with text", v);
  checkProperties(v, path, ["text"], { text: string, style: textStyle });
};

/**
 * A scale a guide shows (a mark's, by its id and the channel, or one of
 * the chart's `scales` by name) or, where `whole`, a mark whole by its id.
 */
function reference(whole: boolean): Check {
  return (v, path) => {
    object(v, path);
    const ref = v as Record<string, unknown>;
    const named = "scale" in ref;
    if (named && ("mark" in ref || "channel" in ref))
      fail(path, "a mark's scale, { mark, channel }, or a scale's name, { scale }; not both", v);
    const required = named
      ? ["scale"]
      : whole && !("channel" in ref)
        ? ["mark"]
        : ["mark", "channel"];
    checkProperties(ref, path, required, {
      mark: string,
      channel: oneOf("series", "color", "size", "symbol"),
      scale: string,
    } satisfies ChecksOf<LegendInclude>);
  };
}
const scaleRef = reference(false);

/** A legend entry's swatch: a line, a box, a symbol, or several. */
const swatch: Check = (v, path) => {
  object(v, path);
  const spec = v as Record<string, unknown>;
  const opacity = { opacity: fraction };
  switch (spec.type) {
    case "line":
      return checkProperties(spec, path, ["stroke"], {
        type: string,
        stroke: string,
        strokeWidth: width,
        dash,
        ...opacity,
      });
    case "rect":
      return checkProperties(spec, path, ["fill"], {
        type: string,
        fill: string,
        stroke: string,
        ...opacity,
      });
    case "symbol":
      return checkProperties(spec, path, ["fill"], {
        type: string,
        symbol: symbolName,
        fill: string,
        stroke: string,
        size: positive,
        ...opacity,
      });
    case "composite":
      return checkProperties(spec, path, ["parts"], {
        type: string,
        parts: (parts, at) => {
          if (!Array.isArray(parts) || parts.length === 0) fail(at, "a list of swatches", parts);
          for (const [i, part] of parts.entries()) swatch(part, `${at}[${i}]`);
        },
      });
    default:
      fail(`${path}.type`, '"line", "rect", "symbol", or "composite"', spec.type);
  }
};

/** A legend entry of your own. */
const legendEntry: Check = (v, path) => {
  object(v, path);
  const spec = v as Record<string, unknown>;
  checkProperties(spec, path, ["key", "label"], {
    key: string,
    label: string,
    swatch,
    sample: (s, at) => {
      object(s, at);
      checkProperties(s as Record<string, unknown>, at, ["mark"], { mark: string });
      if (spec.swatch !== undefined) fail(at, "a swatch or a sample, not both", s);
    },
    targets: (t, at) => {
      if (!Array.isArray(t)) fail(at, "a list of targets, such as { mark }", t);
      for (const [i, target] of t.entries()) {
        const where = `${at}[${i}]`;
        object(target, where);
        const spec = target as Record<string, unknown>;
        if ("scale" in spec && ("mark" in spec || "field" in spec))
          fail(
            where,
            "a mark's rows, { mark, field, values }, or a scale's, { scale, values }; not both",
            target,
          );
        checkProperties(
          spec,
          where,
          "scale" in spec
            ? ["scale", "values"]
            : "field" in spec || "values" in spec
              ? ["mark", "field", "values"]
              : ["mark"],
          { mark: string, field, values: strings, scale: string } satisfies ChecksOf<LegendTarget>,
        );
      }
    },
  } satisfies ChecksOf<LegendEntrySpec>);
};

/** The checks of a legend's layout options, as the short form and legend guides take them. */
function legendOptions(spec: Record<string, unknown>, path: string) {
  if (spec.columns !== undefined && spec.rows !== undefined)
    fail(`${path}.rows`, "columns or rows, not both", spec.rows);
  return {
    place,
    columns: count,
    rows: count,
    order: oneOf("row", "column"),
    title: legendTitle,
    include: (v: unknown, at: string) => {
      if (!Array.isArray(v)) fail(at, "a list of scales or marks, such as { mark, channel }", v);
      for (const [i, ref] of v.entries()) include(ref, `${at}[${i}]`);
    },
    entries: (v: unknown, at: string) => {
      if (!Array.isArray(v)) fail(at, "a list of entries", v);
      const keys = new Set<unknown>();
      for (const [i, entry] of v.entries()) {
        legendEntry(entry, `${at}[${i}]`);
        const key = (entry as LegendEntrySpec).key;
        if (keys.has(key)) fail(`${at}[${i}].key`, "a key no other entry has", key);
        keys.add(key);
      }
    },
    swatches: oneOf("mark"),
    style: rolesOf(["legendLabel", "legendTitle", "tickLabel"]),
  };
}

/**
 * The chart's guides: axes, legends, and colorbars, each with an id no
 * other has; axes of x go above or below the plots, of y beside them.
 * `typeOf` gives the type the chart declares for a scale.
 */
function guideList(typeOf: (scale: unknown) => unknown): Check {
  return (v, path) => {
    if (!Array.isArray(v)) fail(path, "a list of guides", v);
    const ids = new Set<unknown>();
    for (const [i, item] of v.entries()) {
      const at = `${path}[${i}]`;
      object(item, at);
      const guide = item as Record<string, unknown>;
      if (guide.id !== undefined) {
        if (ids.has(guide.id)) fail(`${at}.id`, "an id no other guide has", guide.id);
        ids.add(guide.id);
      }
      // A scale is looked up by its name only (`axisGuide` refuses others).
      if (guide.type === "axis")
        axisGuide(guide, at, typeof guide.scale === "string" ? typeOf(guide.scale) : undefined);
      else if (guide.type === "legend")
        properties(guide, at, {
          ...legendOptions(guide, at),
          type: string,
          id: string,
          panel: string,
          show: boolean,
        } satisfies ChecksOf<LegendGuideSpec>);
      else if (guide.type === "colorbar")
        properties(guide, at, {
          type: string,
          id: string,
          scale: scaleRef,
          place,
          title: legendTitle,
          ticks: ticks("linear"),
          format: axisFormat("linear"),
          tick: tickMark,
          labels: tickLabels,
          layers: tickLayers("linear"),
          length: positive,
          thickness: positive,
          show: boolean,
          style: rolesOf(["tick", "tickLabel", "legendTitle"]),
        } satisfies ChecksOf<ColorbarSpec>);
      else fail(`${at}.type`, '"axis", "legend", or "colorbar"', guide.type);
    }
  };
}

const include = reference(true);

/** An axis guide: its scale, side, ticks and their layers, and look. */
function axisGuide(guide: Record<string, unknown>, path: string, type: unknown): void {
  required(guide, path, ["scale"], Object.keys(guide));
  const scale = guide.scale;
  // A position scale of the chart's own, which has no side of its own.
  const own = !["x", "y", "yRight"].includes(scale as string);
  if (own && typeof scale === "string" && ["linear", "log", "time"].includes(type as string))
    required(guide, path, ["place"], Object.keys(guide));
  checkProperties(guide, path, ["scale"], {
    type: string,
    id: string,
    scale: (v, at) => {
      // A name, before the scale it names is looked up.
      if (typeof v !== "string" || (own && !["linear", "log", "time"].includes(type as string)))
        fail(at, '"x", "y", "yRight", or a position scale of the chart\'s scales', v);
    },
    place: (p, at) => {
      object(p, at);
      checkProperties(p as Record<string, unknown>, at, ["side"], { side: sides });
      const side = (p as { side: string }).side;
      const across = side === "top" || side === "bottom";
      if (!own && across !== (scale === "x"))
        fail(
          `${at}.side`,
          scale === "x" ? '"top" or "bottom" for an x axis' : '"left" or "right" for a y axis',
          side,
        );
    },
    title: string,
    ticks: ticks(type),
    format: axisFormat(type),
    tick: tickMark,
    labels: tickLabels,
    line: boolean,
    grid,
    layers: tickLayers(type),
    show: boolean,
    repeat: labelRepeat,
    style: axisStyle,
  } satisfies ChecksOf<AxisGuideSpec>);
}

/** A row or column of a layout grid: a weight, a weight with a least size, or pixels. */
const track: Check = (v, path) => {
  if (typeof v === "number") return positive(v, path);
  if (!isRecord(v)) fail(path, "a weight, { weight, min }, or { px }", v);
  if ("px" in v) return checkProperties(v, path, ["px"], { px: positive });
  checkProperties(v, path, ["weight"], { weight: positive, min: width });
};
const tracks: Check = (v, path) => {
  if (!Array.isArray(v) || v.length === 0) fail(path, "a list of tracks", v);
  for (const [i, item] of v.entries()) track(item, `${path}[${i}]`);
};
const wholeFromZero: Check = (v, path) => {
  if (!Number.isInteger(v) || (v as number) < 0) fail(path, "a whole number from 0", v);
};
const insetSize: Check = (v, path) => {
  if (!isRecord(v)) fail(path, "{ fraction } or { px }", v);
  if ("px" in v) return checkProperties(v, path, ["px"], { px: positive });
  checkProperties(v, path, ["fraction"], {
    fraction: (f, at) => {
      if (typeof f !== "number" || !(f > 0 && f <= 1)) fail(at, "a fraction above 0, at most 1", f);
    },
  });
};
/** Where an inset goes: inside its parent's plot, or with an anchor at a position of fractions or pixels. */
const insetPlace: Check = (v, path) => {
  object(v, path);
  const spec = v as Record<string, unknown>;
  if (spec.inside !== undefined)
    return checkProperties(spec, path, ["inside"], {
      inside: oneOf(
        "top-left",
        "top",
        "top-right",
        "right",
        "bottom-right",
        "bottom",
        "bottom-left",
        "left",
      ),
      inset: width,
    });
  const coordinate: Check = (c, at) => {
    if (!isRecord(c) || !("fraction" in c || "px" in c))
      fail(at, "{ fraction } or { px }, of the plot or the chart", c);
    const frame = oneOf("plot", "chart");
    if ("px" in c) return checkProperties(c, at, ["px"], { px: finite, frame, offset: finite });
    checkProperties(c, at, ["fraction"], { fraction: finite, frame, offset: finite });
  };
  checkProperties(spec, path, ["at"], {
    at: (p, at) => {
      object(p, at);
      checkProperties(p as Record<string, unknown>, at, ["x", "y"], {
        x: coordinate,
        y: coordinate,
      });
    },
    anchor: oneOf("top-left", "top-right", "bottom-left", "bottom-right", "center"),
  });
};
const insetList: Check = (v, path) => {
  if (!Array.isArray(v)) fail(path, "a list of insets", v);
  for (const [i, item] of v.entries()) {
    const at = `${path}[${i}]`;
    object(item, at);
    checkProperties(item as Record<string, unknown>, at, ["panel"], {
      panel: string,
      place: insetPlace,
      width: insetSize,
      height: insetSize,
      indicator: (d, where) => {
        if (typeof d === "boolean") return;
        object(d, where);
        properties(d as Record<string, unknown>, where, {
          connectors: boolean,
          style: strokeStyle,
        } satisfies ChecksOf<InsetIndicatorSpec>);
      },
      insets: insetList,
    } satisfies ChecksOf<InsetSpec>);
  }
};
/** A layout: a grid of cells, or one panel with its insets. */
const layoutNode: Check = (v, path) => {
  object(v, path);
  const node = v as Record<string, unknown>;
  if (node.type === "panel")
    return checkProperties(node, path, ["panel"], {
      type: string,
      panel: string,
      insets: insetList,
    } satisfies ChecksOf<PanelLayoutSpec>);
  if (node.type !== "grid") fail(`${path}.type`, '"grid" or "panel"', node.type);
  properties(node, path, {
    type: string,
    id: string,
    rows: tracks,
    columns: tracks,
    cells: (c, at) => {
      if (!Array.isArray(c)) fail(at, "a list of cells", c);
      for (const [i, cell] of c.entries()) {
        object(cell, `${at}[${i}]`);
        checkProperties(
          cell as Record<string, unknown>,
          `${at}[${i}]`,
          ["row", "column", "content"],
          {
            row: wholeFromZero,
            column: wholeFromZero,
            rowSpan: count,
            columnSpan: count,
            content: layoutNode,
          } satisfies ChecksOf<LayoutCellSpec>,
        );
      }
    },
    gap: (g, at) => {
      if (typeof g === "number") return width(g, at);
      object(g, at);
      properties(g as Record<string, unknown>, at, { row: width, column: width });
    },
  } satisfies ChecksOf<GridLayoutSpec>);
};

/** An axis' or colorbar's tick layers on a scale of `type`, each with an id of its own. */
function tickLayers(type: unknown): Check {
  return (v, at) => {
    if (!Array.isArray(v)) fail(at, "a list of tick layers", v);
    const ids = new Set<unknown>(["major"]);
    for (const [i, layer] of v.entries()) {
      const where = `${at}[${i}]`;
      object(layer, where);
      checkProperties(layer as Record<string, unknown>, where, ["id"], {
        id: string,
        ticks: ticks(type),
        format: axisFormat(type),
        tick: tickMark,
        labels: tickLabels,
        style: rolesOf(["tick", "tickLabel"]),
      } satisfies ChecksOf<TickLayerSpec>);
      const id = (layer as { id: unknown }).id;
      if (ids.has(id))
        fail(
          `${where}.id`,
          id === "major" ? 'a name other than "major", the own ticks' : "a name no other layer has",
          id,
        );
      ids.add(id);
    }
  };
}

/** A position scale's settings in `scales`. */
const scaleSettings: Check = (v, path) => {
  object(v, path);
  const spec = v as Record<string, unknown>;
  properties(spec, path, {
    type: oneOf("linear", "log", "time"),
    domain: (d, p) => {
      numbers(d, p);
      if ((d as unknown[]).length !== 2) fail(p, "two numbers", d);
    },
    nice: boolean,
    zero: boolean,
    scope,
    padding,
    tooltipFormat: axisFormat(spec.type),
  } satisfies ChecksOf<ScaleSpec>);
};

/**
 * A scale of the chart's own: of categories ("ordinal"), of values that
 * are their own outputs ("identity"), or of positions, its `type` given.
 */
const namedScale: Check = (v, path) => {
  object(v, path);
  const { type } = v as { type?: unknown };
  if (type === "identity")
    return checkProperties(v as Record<string, unknown>, path, ["type"], {
      type: string,
    } satisfies ChecksOf<IdentityScaleSpec>);
  if (type === "linear" || type === "log" || type === "time") return scaleSettings(v, path);
  ordinalScale(v, path);
};

/** A scale of categories in `scales`: its domain, fixed outputs, and output for others. */
const ordinalScale: Check = (v, path) => {
  object(v, path);
  const output: Check = (o, at) => {
    if (typeof o !== "string" && typeof o !== "number" && !Array.isArray(o))
      fail(at, "a color, a shape, a dash, or a number", o);
    if (Array.isArray(o)) numbers(o, at);
  };
  const type = (t: unknown, at: string) => {
    if (t !== "ordinal")
      fail(at, '"ordinal", "identity", or a position scale\'s "linear", "log", or "time"', t);
  };
  type((v as { type?: unknown }).type, `${path}.type`);
  properties(v as Record<string, unknown>, path, {
    type,
    scope: oneOf("chart", "panel"),
    domain: strings,
    map: (m, at) => {
      object(m, at);
      for (const [key, value] of Object.entries(m as Record<string, unknown>))
        output(value, `${at}.${JSON.stringify(key)}`);
    },
    unknown: output,
  } satisfies ChecksOf<OrdinalScaleSpec>);
};

/** A tree's fields: a path of category fields, or node and parent fields. */
function hierarchyChecks(): Record<
  "path" | "node" | "parent" | "value" | "labels" | "panel" | "tooltip",
  Check
> {
  return {
    panel: string,
    tooltip,
    path: (v, path) => {
      if (!Array.isArray(v) || v.length === 0) fail(path, "a list of at least one field", v);
      for (const [i, item] of (v as unknown[]).entries()) field(item, `${path}[${i}]`);
    },
    node: field,
    parent: field,
    value: field,
    labels: boolean,
  };
}

/** Properties `mark` checks for every mark. */
type CommonKey = "type" | "data" | "id";

/** Placement properties of the marks whose specs have them. */
const side = oneOf("left", "right");
const repeat = oneOf("repeat");
/** What a mark's drawing is cut to. */
const clip: Check = (v, path) => {
  if (v !== "plot" && v !== "chart" && v !== false) fail(path, '"plot", "chart", or false', v);
};
/**
 * Where a mark draws. Heatmaps, contours, and 2D histograms take `axis`
 * here though their specs leave it out, so that their marks refuse the
 * right axis with why.
 */
const placement = { axis: side, facet: repeat, panel: string, clip, zIndex: finite };
/**
 * A 3D mark's `zIndex`, which its spec leaves out: read, so that its mark
 * refuses any but 0 with why (checkDepthOrder).
 */
const depthOrder = { zIndex: finite };
/** A mark's `legend`: only `false`, which leaves it out of the legends. */
const legended: Check = (v, path) => {
  if (v !== false) fail(path, "false, which leaves the mark out of the legends", v);
};

/** What a mark's tooltips show of its rows: fields, by name or with a label and format. */
const tooltip: Check = (v, path) => {
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    fields: (list, at) => {
      if (!Array.isArray(list)) fail(at, "an array of fields", list);
      list.forEach((entry, i) => {
        if (typeof entry === "string") return;
        if (!isRecord(entry)) fail(`${at}[${i}]`, "a field name or an object", entry);
        checkProperties(entry, `${at}[${i}]`, ["field"], {
          field,
          label: string,
          format: format(undefined),
        });
      });
    },
  });
};

/** A coordinate's share of a frame, or its pixels: a number, or a number field's `{ field }`. */
const amount: Check = (v, path) => {
  if (!isRecord(v)) return finite(v, path);
  checkProperties(v, path, ["field"], { field });
};

/**
 * A coordinate: a value on a scale, a field, a fraction of a frame, or
 * pixels (each a constant or a field's), with an offset.
 */
const coordinate: Check = (v, path) => {
  object(v, path);
  const c = v as Record<string, unknown>;
  const kind = ["data", "field", "fraction", "px"].filter((key) => key in c);
  if (kind.length !== 1)
    fail(path, "one of { data }, { field }, { fraction }, or { px }, with an offset", v);
  const frame = oneOf("plot", "chart");
  properties(c, path, {
    data: (d, at) => {
      if (typeof d !== "string" && !(typeof d === "number" && Number.isFinite(d)))
        fail(at, "a number or a category's value", d);
    },
    field,
    fraction: amount,
    px: amount,
    scale: string,
    frame,
    offset: finite,
  });
  if ((kind[0] === "data" || kind[0] === "field") && "frame" in c)
    fail(`${path}.frame`, "absent for values on a scale", c.frame);
  if ((kind[0] === "fraction" || kind[0] === "px") && "scale" in c)
    fail(`${path}.scale`, "absent for fractions and pixels", c.scale);
};

/** An annotation's place along an axis: a value, a field's name, or a coordinate. */
const annotationPlace: Check = (v, path) => (isRecord(v) ? coordinate(v, path) : position(v, path));

/** Where a label goes beside what it labels. */
const labelPlace: Check = (p, at) => {
  object(p, at);
  properties(p as Record<string, unknown>, at, {
    attachment: oneOf("start", "center", "end"),
    side: oneOf("top", "right", "bottom", "left"),
    outside: boolean,
    reserve: boolean,
    offset: finite,
  } satisfies ChecksOf<LabelPlaceSpec>);
};

/** A part of a label's text: literal text, a field's value, the series' name, or the value. */
const labelPart: Check = (v, path) => {
  if (typeof v === "string") return;
  object(v, path);
  const part = v as Record<string, unknown>;
  if (["field", "series", "value"].filter((key) => key in part).length !== 1)
    fail(path, "text, { field }, { series: true }, or { value: true }", v);
  const yes: Check = (t, at) => {
    if (t !== true) fail(at, "true", t);
  };
  properties(part, path, {
    field,
    series: yes,
    value: yes,
    format: axisFormat(undefined),
  } satisfies ChecksOf<Exclude<LabelPart, string>>);
  if ("series" in part && "format" in part)
    fail(`${path}.format`, "no format: a series' name is written as it is", part.format);
};

/** A label's text made of parts, at least one. */
const labelContent: Check = (v, path) => {
  if (!Array.isArray(v) || v.length === 0)
    fail(path, 'a list of parts, such as ["Peak: ", { value: true }]', v);
  for (const [i, part] of v.entries()) labelPart(part, `${path}[${i}]`);
};

/** Text written with `content` has a format for each part, and none of its own. */
function contentAlone(l: Record<string, unknown>, path: string): void {
  if ("content" in l && "format" in l)
    fail(`${path}.format`, "no format beside content: give each part its own", l.format);
}

/** Where text following a series puts its label: outside the plot or not, and its offset. */
const textLabelPlace: Check = (p, at) => {
  object(p, at);
  const place = p as Record<string, unknown>;
  for (const option of ["attachment", "side"])
    if (place[option] !== undefined)
      throw refusal(
        `${at}.${option}`,
        `text is drawn at its place, or at from.at on its series; drop ${option}`,
      );
  properties(place, at, {
    outside: boolean,
    reserve: boolean,
    offset: finite,
  } satisfies ChecksOf<NonNullable<TextLabelSpec["place"]>>);
};

/** A label: its text, or a label object (text, field, or content; format, style, place). */
function labelOf(place: Check): Check {
  return (v, path) => {
    if (typeof v === "string") return;
    object(v, path);
    const l = v as Record<string, unknown>;
    if (["text", "field", "content"].filter((key) => key in l).length !== 1)
      fail(path, "a label with one of text, field, and content", v);
    contentAlone(l, path);
    properties(l, path, {
      text: string,
      field,
      content: labelContent,
      format: axisFormat(undefined),
      style: textStyle,
      place,
    } satisfies ChecksOf<LabelSpec>);
  };
}

const label = labelOf(labelPlace);

/** Which point of a series a label follows. */
const labelAt = oneOf("first", "last", "visible-start", "visible-end");
/** The edge of a band (`y1` and `y2`, or `x1` and `x2`) labels follow. */
const bandEdge = oneOf("y1", "y2", "x1", "x2");

/** Labels following each series of a line, or with `edge`, of an area's band. */
function seriesLabels(band: boolean): Check {
  return (v, path) => {
    object(v, path);
    const spec = v as Record<string, unknown>;
    if (!band && "edge" in spec)
      fail(`${path}.edge`, "no edge: a line's labels follow the line", spec.edge);
    checkProperties(spec, path, ["at"], {
      at: labelAt,
      content: labelContent,
      edge: bandEdge,
      place: labelPlace,
      style: textStyle,
    } satisfies ChecksOf<AreaLabelsSpec>);
  };
}

/** A place on another mark's series: its id, where along each series, and a band's edge. */
const markAnchor: Check = (v, path) => {
  object(v, path);
  checkProperties(v as Record<string, unknown>, path, ["mark", "at"], {
    mark: string,
    at: labelAt,
    edge: bandEdge,
  } satisfies ChecksOf<MarkAnchorSpec>);
};

/**
 * A coordinate a mark of rows places each row by: a field's, or a number
 * field's share or pixels. One place for every row is a rule's or text's.
 */
const rowCoordinate: Check = (v, path) => {
  coordinate(v, path);
  const c = v as Record<string, unknown>;
  for (const key of ["data", "fraction", "px"])
    if (key in c && !isRecord(c[key]))
      fail(
        key === "data" ? path : `${path}.${key}`,
        key === "data"
          ? "{ field }, { fraction: { field } }, or { px: { field } }: each row is placed by its own value"
          : "{ field }: each row is placed by its own value",
        key === "data" ? v : c[key],
      );
};

/** A mark's place for each row along an axis: a field's name, or a coordinate a field gives. */
const rowPosition: Check = (v, path) => (isRecord(v) ? rowCoordinate(v, path) : field(v, path));
/** As `rowPosition`, or several fields drawn side by side. */
const rowPositions: Check = (v, path) => (isRecord(v) ? rowCoordinate(v, path) : fields(v, path));

/** The shapes points and markers take. */
const SYMBOL_NAMES = [
  "circle",
  "square",
  "triangle",
  "diamond",
  "cross",
  "star",
  "wye",
  "triangle-down",
  "x",
];
const symbolName = oneOf(...SYMBOL_NAMES);

/** What each channel's values are. */
const CHANNEL_VALUES = {
  color: string,
  fill: string,
  stroke: string,
  dash,
  symbol: symbolName,
  strokeWidth: width,
  size: width,
  opacity: fraction,
} satisfies ChecksOf<EncodingsSpec>;

/**
 * A channel of values `value` checks: a field through a scale, the
 * series' names through one, a constant, or a condition.
 */
function channel(value: Check): Check {
  return (v, path) => {
    object(v, path);
    const c = v as Record<string, unknown>;
    if ("field" in c)
      checkProperties(c, path, ["field"], {
        field,
        scale: (s, at) => {
          if (typeof s === "string") return;
          if (!isRecord(s)) fail(at, 'a scale\'s name, or { type: "identity" }', s);
          checkProperties(s, at, ["type"], { type: oneOf("identity") });
        },
      });
    else if ("series" in c) {
      checkProperties(c, path, ["series"], {
        series: (s, at) => {
          if (s !== true) fail(at, "true, the series' names through a scale", s);
        },
        scale: string,
      });
      // As the feature compiler refuses it (marks/features/channels.ts).
      if (c.scale === undefined)
        throw refusal(
          `${path}.scale`,
          "required, as the channel names series through a scale; give scale, the name of one of the chart's scales",
        );
    } else if ("value" in c) checkProperties(c, path, ["value"], { value });
    else if ("condition" in c)
      checkProperties(c, path, ["condition"], {
        condition: (w, at) => {
          object(w, at);
          checkProperties(w as Record<string, unknown>, at, ["when", "then", "otherwise"], {
            when: expression,
            // A condition's branch, not a promise's: specs hold no functions.
            // biome-ignore lint/suspicious/noThenProperty: the spec's name for the branch.
            then: value,
            otherwise: value,
          });
        },
      });
    else {
      // `{ fiel: "kind" }` is a field misspelled, which the error names.
      const typo = misspelling(c, "field", ["scale"]);
      if (typo !== undefined) throw missing(path, "field", typo);
      fail(
        path,
        "{ field }, { series: true }, { value }, or { condition: { when, then, otherwise } }",
        v,
      );
    }
  };
}

/** A mark's `encode`, of the channels `names` it takes. */
function encodings(names: readonly (keyof EncodingsSpec)[]): Check {
  const checks = Object.fromEntries(names.map((name) => [name, channel(CHANNEL_VALUES[name])]));
  return (v, path) => {
    object(v, path);
    properties(v as Record<string, unknown>, path, checks);
  };
}

const markerStyle: Check = (v, path) => {
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    symbol: symbolName,
    radius: positive,
    fill: string,
    stroke: string,
    strokeWidth: width,
    opacity: fraction,
  } satisfies ChecksOf<MarkerStyle>);
};

const seriesStyle: Check = (v, path) => {
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    ...strokeChecks,
    fill: string,
    fillOpacity: fraction,
    strokeOpacity: fraction,
    marker: markerStyle,
  } satisfies ChecksOf<SeriesStyle>);
};

/**
 * A mark's `style`, of the parts `parts` it has, and with `by` looks by
 * value; marks of one look (text) refuse those.
 */
function markStyle(by: boolean, ...parts: readonly Exclude<keyof MarkStyleSpec, "by">[]): Check {
  const checks: Record<string, Check> = {
    by: (v, path) => {
      if (!by)
        throw refusal(path, "this mark draws one look, not looks by value; drop by", "unsupported");
      object(v, path);
      checkProperties(v as Record<string, unknown>, path, ["map"], {
        field,
        map: (m, at) => {
          object(m, at);
          for (const [key, style] of Object.entries(m as Record<string, unknown>))
            seriesStyle(style, `${at}.${JSON.stringify(key)}`);
        },
      } satisfies ChecksOf<StyleMapSpec>);
    },
  };
  for (const part of parts) checks[part] = part === "marker" ? markerStyle : strokeStyle;
  return (v, path) => {
    object(v, path);
    properties(v as Record<string, unknown>, path, checks);
  };
}

const continuity: Check = (v, path) => {
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    defined: expression,
    maxGap: (g, at) => {
      if (typeof g === "number") return width(g, at);
      object(g, at);
      checkProperties(g as Record<string, unknown>, at, ["milliseconds"], { milliseconds: width });
    },
    breakBy: (b, at) => {
      if (typeof b === "string")
        return oneOf("minute", "hour", "day", "week", "month", "year")(b, at);
      object(b, at);
      checkProperties(b as Record<string, unknown>, at, ["field"], { field });
    },
  } satisfies ChecksOf<ContinuitySpec>);
};

const markers: Check = (v, path) => {
  if (typeof v !== "boolean") symbolName(v, path);
};

/**
 * The properties each mark takes, typed against its spec so that adding a
 * property to a spec without checking it here fails to compile.
 */
type MarkChecks = {
  [K in MarkSpec["type"]]: {
    required: AllKeys<Extract<MarkSpec, { type: K }>>[];
    checks: Record<Exclude<AllKeys<Extract<MarkSpec, { type: K }>>, CommonKey>, Check>;
  };
};

const MARKS: MarkChecks = {
  line: {
    required: ["x", "y"],
    checks: {
      itemKey: field,
      tooltip,
      ...placement,
      legend: legended,
      x: rowPositions,
      y: rowPositions,
      orient: oneOf("x", "y"),
      series: seriesField,
      dodge: boolean,
      stroke: string,
      strokeWidth: width,
      dash,
      opacity: fraction,
      strokeOpacity: fraction,
      curve,
      label: string,
      labels: seriesLabels(false),
      color: string,
      encode: encodings(MARK_CHANNELS.line!.encode),
      style: markStyle(true, "marker"),
      markers,
      continuity,
      where: expression,
    },
  },
  area: {
    required: [],
    checks: {
      itemKey: field,
      tooltip,
      ...placement,
      legend: legended,
      x: rowPositions,
      y: rowPositions,
      y1: rowPosition,
      y2: rowPosition,
      x1: rowPosition,
      x2: rowPosition,
      orient: oneOf("x", "y"),
      series: seriesField,
      dodge: boolean,
      stack: (v, path) => {
        if (isRecord(v)) {
          properties(v, path, {
            offset: oneOf("zero", "fill", "center", "wiggle"),
            order: oneOf("input", "inside-out"),
            gaps: oneOf("zero", "interpolate"),
          } satisfies ChecksOf<StackSpec>);
          return;
        }
        if (typeof v !== "boolean" && v !== "fill" && v !== "center" && v !== "wiggle")
          throw refusal(
            path,
            'expected true, false, "fill", "center", "wiggle", or { offset, order, gaps }; choose a supported stack',
          );
      },
      fill: string,
      fillOpacity: fraction,
      line: boolean,
      stroke: string,
      strokeWidth: width,
      strokeOpacity: fraction,
      opacity: fraction,
      curve,
      label: string,
      labels: seriesLabels(true),
      color: string,
      encode: encodings(MARK_CHANNELS.area!.encode),
      style: markStyle(true),
      continuity,
      where: expression,
    },
  },
  dendrogram: {
    required: ["first", "second", "height", "leaves"],
    checks: {
      facet: repeat,
      panel: string,
      clip,
      zIndex: finite,
      first: field,
      second: field,
      height: field,
      leaves: (v, path) => {
        try {
          checkLeaves(v as string[]);
        } catch (error) {
          // The message names the leaves itself.
          throw refusal(path.slice(0, path.lastIndexOf(".")), (error as Error).message);
        }
      },
      side: oneOf("bottom", "top", "left", "right"),
      stroke: string,
      strokeWidth: width,
      label: string,
    },
  },
  rule: {
    required: [],
    checks: {
      itemKey: field,
      ...placement,
      x: annotationPlace,
      y: annotationPlace,
      stroke: string,
      strokeWidth: width,
      dash,
      strokeOpacity: fraction,
      span: (v, path) => {
        if (!Array.isArray(v) || v.length !== 2) fail(path, "two coordinates", v);
        for (const [i, c] of v.entries()) coordinate(c, `${path}[${i}]`);
      },
      label,
      contributeDomain: boolean,
      legend: boolean,
    },
  },
  region: {
    required: [],
    checks: {
      itemKey: field,
      halo,
      ...placement,
      x1: annotationPlace,
      x2: annotationPlace,
      y1: annotationPlace,
      y2: annotationPlace,
      fill: string,
      fillOpacity: fraction,
      stroke: string,
      strokeWidth: width,
      strokeSides: sideList,
      label,
      contributeDomain: boolean,
      legend: boolean,
    },
  },
  text: {
    required: ["label"],
    checks: {
      itemKey: field,
      halo,
      ...placement,
      x: annotationPlace,
      y: annotationPlace,
      at: (v, path) => {
        object(v, path);
        checkProperties(v as Record<string, unknown>, path, ["x", "y"], {
          x: coordinate,
          y: coordinate,
        });
      },
      from: markAnchor,
      label: labelOf(textLabelPlace),
      overlap: oneOf("show", "hide", "move"),
      style: markStyle(false, "leader"),
      contributeDomain: boolean,
      legend: boolean,
    },
  },
  bar: {
    required: ["x", "y"],
    checks: {
      itemKey: field,
      halo,
      tooltip,
      ...placement,
      legend: legended,
      x: rowPositions,
      y: rowPositions,
      series: seriesField,
      stack: (v, path) => {
        if (typeof v !== "boolean" && v !== "fill")
          throw refusal(
            path,
            'expected true, false, or "fill"; use an area for "center" or "wiggle"',
          );
      },
      dodge: boolean,
      fill: string,
      fillOpacity: fraction,
      stroke: string,
      strokeWidth: width,
      strokeOpacity: fraction,
      strokeSides: sideList,
      width: pixels,
      dash,
      opacity: fraction,
      color: string,
      encode: encodings(MARK_CHANNELS.bar!.encode),
      style: markStyle(true),
      label: string,
      labels: (v, path) => {
        if (typeof v === "boolean") return;
        object(v, path);
        const l = v as Record<string, unknown>;
        if ("content" in l && "field" in l)
          fail(`${path}.field`, "no field beside content: give it as a part, { field }", l.field);
        contentAlone(l, path);
        properties(l, path, {
          field,
          content: labelContent,
          format: axisFormat(undefined),
          style: textStyle,
          minLength: width,
          place: (p, at) => {
            object(p, at);
            properties(p as Record<string, unknown>, at, {
              attachment: oneOf("start", "center", "end"),
              outside: boolean,
            } satisfies ChecksOf<BarLabelPlaceSpec>);
          },
        } satisfies ChecksOf<BarLabelsSpec>);
      },
    },
  },
  point: {
    required: ["x", "y"],
    checks: {
      tooltip,
      ...placement,
      legend: legended,
      x: rowPosition,
      y: rowPosition,
      series: seriesField,
      itemKey: field,
      radius: positive,
      size: (v, path) => (isRecord(v) ? channel(width)(v, path) : field(v, path)),
      radiusRange: range,
      fill: string,
      fillOpacity: (v, path) =>
        typeof v === "string"
          ? field(v, path)
          : isRecord(v)
            ? channel(fraction)(v, path)
            : fraction(v, path),
      stroke: string,
      strokeWidth: width,
      color: (v, path) => (isRecord(v) ? channel(string)(v, path) : field(v, path)),
      colors: ramp,
      colorDomain: range,
      colorMidpoint: finite,
      symbol: (v, path) => {
        if (typeof v === "string") return;
        if (!isRecord(v)) fail(path, 'a shape\'s name or { field: "..." }', v);
        // An object of none of a channel's forms is a symbol field's, `{ field }`.
        if (!["field", "series", "value", "condition"].some((key) => key in v))
          throw missing(path, "field", misspelling(v, "field", ["scale"]));
        channel(symbolName)(v, path);
      },
      encode: encodings(MARK_CHANNELS.point!.encode),
      sampling: oneOf("none", "pixel"),
      label: string,
      dodge: boolean,
      jitter: (v, path) => {
        object(v, path);
        checkProperties(v as Record<string, unknown>, path, ["width"], {
          width: fraction,
          seed: integer,
        });
      },
      swarm: boolean,
    },
  },
  histogram: {
    required: [],
    checks: {
      color: string,
      ...placement,
      legend: legended,
      x: field,
      y: field,
      bins: (v, path) => {
        if (!perAxisBins(v)) return binSpec(v, path);
        properties(v as Record<string, unknown>, path, { x: binSpec, y: binSpec });
      },
      series: field,
      weight: field,
      normalize: oneOf("count", "frequency", "probability", "percent", "density"),
      stack: (v, path) => {
        if (typeof v !== "boolean" && v !== "fill") fail(path, 'true, false, or "fill"', v);
      },
      commonNorm: boolean,
      cumulative: boolean,
      dodge: boolean,
      element: oneOf("bars", "step", "poly"),
      fill: string,
      fillOpacity: fraction,
      colors: ramp,
      colorDomain: range,
      colorMidpoint: finite,
      label: string,
    },
  },
  treemap: { required: [], checks: hierarchyChecks() },
  sunburst: { required: [], checks: hierarchyChecks() },
  sankey: {
    required: ["source", "target"],
    checks: {
      halo,
      panel: string,
      source: field,
      target: field,
      value: field,
      labels: boolean,
      nodeWidth: positive,
      sort: oneOf("input", "value"),
      tooltip,
    },
  },
  graph: {
    required: ["source", "target"],
    checks: {
      halo,
      source: field,
      target: field,
      value: field,
      directed: boolean,
      linkLabelField: field,
      nodes: string,
      node: field,
      color: field,
      size: field,
      labels: boolean,
      layout: (v, path) => {
        const types = oneOf("force", "circular", "layered");
        if (typeof v === "string") return types(v, path);
        object(v, path);
        const layout = v as Record<string, unknown>;
        types(layout.type, `${path}.type`);
        checkProperties(layout, path, ["type"], {
          type: string,
          ...(layout.type === "force" && { settle: boolean }),
          ...(layout.type === "circular" && { sort: oneOf("degree", "input", "name") }),
          ...(layout.type === "layered" && { direction: oneOf("down", "right", "up", "left") }),
        });
      },
      panel: string,
    },
  },
  pie: {
    required: ["category"],
    checks: {
      panel: string,
      category: field,
      value: field,
      innerRadius: (v, path) => {
        if (typeof v !== "number" || !(v >= 0 && v < 1))
          fail(path, "a fraction at least 0 and below 1", v);
      },
      sort: oneOf("value", "input"),
      labels: boolean,
      tooltip,
    },
  },
  gauge: {
    required: ["value"],
    checks: {
      panel: string,
      value: field,
      min: finite,
      max: finite,
      bands: (v, path) => {
        if (!Array.isArray(v)) fail(path, "a list of bands", v);
        // Bands must also lie within the dial, which the mark checks.
        let previous = Number.NEGATIVE_INFINITY;
        for (const [i, item] of v.entries()) {
          const at = `${path}[${i}]`;
          object(item, at);
          const band = item as Record<string, unknown>;
          checkProperties(band, at, ["to"], { to: finite, color: string });
          const to = band.to as number;
          if (!(to > previous))
            fail(`${at}.to`, `an end above the previous band's (${previous})`, to);
          previous = to;
        }
      },
      label: string,
      format: format("linear"),
      tooltip,
    },
  },
  funnel: {
    required: ["category"],
    checks: {
      halo,
      panel: string,
      category: field,
      value: field,
      sort: oneOf("input", "value"),
      labels: boolean,
      tooltip,
    },
  },
  radar: {
    required: [],
    checks: {
      halo,
      panel: string,
      category: field,
      value: field,
      fields: (v, path) => {
        if (!Array.isArray(v)) fail(path, "a list of field names", v);
        for (const [i, item] of v.entries()) field(item, `${path}[${i}]`);
      },
      series: field,
      domain: range,
      fillOpacity: fraction,
      points: boolean,
      label: string,
      tooltip,
    },
  },
  boxplot: {
    required: [],
    checks: {
      color: string,
      ...placement,
      legend: legended,
      x: field,
      y: field,
      low: field,
      q1: field,
      median: field,
      q3: field,
      high: field,
      count: field,
      whiskers: (v, path) => {
        if (v === "tukey" || v === "range") return;
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0)
          fail(path, '"tukey", "range", or a finite nonnegative IQR multiple', v);
      },
      notch: boolean,
      outliers: boolean,
      series: field,
      fill: string,
      fillOpacity: fraction,
      label: string,
    },
  },
  boxen: {
    required: ["x", "y"],
    checks: {
      color: string,
      ...placement,
      legend: legended,
      x: field,
      y: field,
      series: field,
      depth: (v, path) => {
        if (["tukey", "proportion", "trustworthy", "full"].includes(v as string)) return;
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1)
          fail(path, '"tukey", "proportion", "trustworthy", "full", or a whole number from 1', v);
      },
      outlierProportion: share,
      trustAlpha: share,
      widthMethod: oneOf("exponential", "linear", "area"),
      outliers: boolean,
      fill: string,
      fillOpacity: fraction,
      label: string,
    },
  },
  violin: {
    required: ["x", "y"],
    checks: {
      color: string,
      ...placement,
      legend: legended,
      x: field,
      y: field,
      series: field,
      split: boolean,
      inner: oneOf("box", "quartiles", "none"),
      bandwidth: positive,
      fill: string,
      fillOpacity: fraction,
      label: string,
    },
  },
  candlestick: {
    required: ["x", "open", "high", "low", "close"],
    checks: {
      itemKey: field,
      tooltip,
      ...placement,
      legend: legended,
      x: field,
      open: field,
      high: field,
      low: field,
      close: field,
      variant: oneOf("candlestick", "ohlc"),
      rise: string,
      fall: string,
      label: string,
    },
  },
  rug: {
    required: [],
    checks: {
      itemKey: field,
      color: string,
      tooltip,
      ...placement,
      legend: legended,
      x: field,
      y: field,
      series: field,
      length: positive,
      side: oneOf("bottom", "top", "left", "right"),
      stroke: string,
      strokeWidth: width,
      label: string,
    },
  },
  errorbar: {
    required: [],
    checks: {
      itemKey: field,
      color: string,
      tooltip,
      ...placement,
      legend: legended,
      x: rowPosition,
      y: rowPosition,
      x1: rowPosition,
      x2: rowPosition,
      y1: rowPosition,
      y2: rowPosition,
      xError: field,
      yError: field,
      series: field,
      stroke: string,
      strokeWidth: width,
      cap: width,
      label: string,
      dodge: boolean,
    },
  },
  geoshape: {
    required: [],
    checks: {
      itemKey: field,
      tooltip,
      geometry: field,
      labelField: field,
      color: field,
      colors: ramp,
      colorDomain: range,
      colorMidpoint: finite,
      fill: string,
      fillOpacity: fraction,
      stroke: string,
      strokeWidth: width,
      label: string,
      facet: repeat,
      panel: string,
    },
  },
  geopoint: {
    required: ["longitude", "latitude"],
    checks: {
      itemKey: field,
      tooltip,
      longitude: field,
      latitude: field,
      labelField: field,
      series: seriesField,
      radius: positive,
      size: field,
      radiusRange: range,
      color: field,
      colors: ramp,
      colorDomain: range,
      colorMidpoint: finite,
      fill: string,
      fillOpacity: fraction,
      stroke: string,
      strokeWidth: width,
      label: string,
      facet: repeat,
      panel: string,
    },
  },
  heatmap: {
    required: ["color"],
    checks: {
      tooltip,
      ...placement,
      legend: legended,
      x: field,
      y: field,
      x1: field,
      x2: field,
      y1: field,
      y2: field,
      date: field,
      calendar: oneOf("weeks", "months"),
      weekStart: oneOf("sun", "mon", "tue", "wed", "thu", "fri", "sat"),
      color: field,
      xStep: positive,
      yStep: positive,
      xBanded: boolean,
      yBanded: boolean,
      colors: ramp,
      colorDomain: range,
      colorMidpoint: finite,
      reduce: oneOf("last", "mean", "sum", "min", "max"),
      sampling: (v, path) => {
        object(v, path);
        properties(v as Record<string, unknown>, path, { reduce: oneOf("mean", "max", "min") });
      },
      label: string,
    },
  },
  contour: {
    required: ["x", "y", "color"],
    checks: {
      ...placement,
      legend: legended,
      x: field,
      y: field,
      color: field,
      thresholds: (v, path) => {
        if (typeof v === "number") return count(v, path);
        numbers(v, path);
        const list = v as number[];
        for (let i = 1; i < list.length; i++)
          if (!(list[i]! > list[i - 1]!))
            fail(`${path}[${i}]`, `a value above ${list[i - 1]}, the one before`, list[i]);
      },
      variant: oneOf("lines", "bands"),
      colors: ramp,
      colorDomain: range,
      colorMidpoint: finite,
      stroke: string,
      strokeWidth: width,
      fillOpacity: fraction,
      label: string,
    },
  },
  point3d: {
    required: ["x", "y", "z"],
    checks: {
      itemKey: field,
      panel: string,
      ...depthOrder,
      tooltip,
      x: field,
      y: field,
      z: field,
      series: seriesField,
      labelField: field,
      radius: positive,
      color: field,
      colors: ramp,
      colorDomain: range,
      colorMidpoint: finite,
      fill: string,
      fillOpacity: fraction,
      label: string,
    },
  },
  line3d: {
    required: ["x", "y", "z"],
    checks: {
      itemKey: field,
      panel: string,
      ...depthOrder,
      tooltip,
      x: field,
      y: field,
      z: field,
      series: field,
      stroke: string,
      strokeWidth: positive,
      label: string,
    },
  },
  surface: {
    required: ["x", "y", "z"],
    checks: {
      panel: string,
      ...depthOrder,
      x: field,
      y: field,
      z: field,
      color: field,
      colors: ramp,
      colorDomain: range,
      colorMidpoint: finite,
      fillOpacity: fraction,
      shading: boolean,
      wireframe: boolean,
      label: string,
      tooltip,
    },
  },
};

const camera: Check = (v, path) => {
  object(v, path);
  properties(v as Record<string, unknown>, path, {
    azimuth: finite,
    elevation: (e, at) => {
      if (typeof e !== "number" || !(e >= -90 && e <= 90)) fail(at, "degrees from -90 to 90", e);
    },
    zoom: (z, at) => {
      if (typeof z !== "number" || !(z >= 0.5 && z <= 10)) fail(at, "a number from 0.5 to 10", z);
    },
    perspective: boolean,
  } satisfies ChecksOf<CameraSpec>);
};

/** Three positive numbers: the relative lengths of a 3D box's sides. */
const boxAspect: Check = (v, path) => {
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    !v.every((x) => typeof x === "number" && x > 0 && Number.isFinite(x))
  )
    fail(path, "three positive numbers", v);
};

const PROJECTIONS = [
  "equal-earth",
  "natural-earth",
  "mercator",
  "equirectangular",
  "conic-equal-area",
] as const;
/** A longitude, latitude pair: within ±540 and ±90 degrees, as geometry is. */
const lonLat: Check = (v, path) => {
  if (
    !Array.isArray(v) ||
    v.length !== 2 ||
    !v.every((x) => typeof x === "number" && Number.isFinite(x)) ||
    !(Math.abs(v[0]) <= 540 && Math.abs(v[1]) <= 90)
  )
    fail(path, "[longitude, latitude] in degrees", v);
};
const projection: Check = (v, path) => {
  if (typeof v === "string") return oneOf(...PROJECTIONS)(v, path);
  object(v, path);
  const spec = v as Record<string, unknown>;
  checkProperties(spec, path, ["type"], {
    type: oneOf(...PROJECTIONS),
    centralMeridian: finite,
    parallels: (p, at) => {
      range(p, at);
      if (!(p as number[]).every((x) => Math.abs(x) <= 90))
        fail(at, "two latitudes from -90 to 90", p);
    },
    fit: (f, at) => {
      if (f === "data" || f === "world") return;
      if (!Array.isArray(f) || f.length !== 2)
        fail(at, '"data", "world", or [[west, south], [east, north]]', f);
      lonLat(f[0], `${at}[0]`);
      lonLat(f[1], `${at}[1]`);
      const [[west, south], [east, north]] = f as [number[], number[]];
      if (!(south! < north!)) fail(`${at}[1][1]`, "a north above the south", north);
      if (west === east) fail(`${at}[1][0]`, "an east apart from the west", east);
    },
  } satisfies ChecksOf<ProjectionSpec>);
};

/** A buffer index into the buffers delivered with the spec. */
const bufferIndex: Check = (v, path) => {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0) fail(path, "a buffer index", v);
};
/** A buffer index, or the values as a JSON array. */
const bufferOrArray: Check = (v, path) => {
  if (!Array.isArray(v)) bufferIndex(v, path);
};
const array: Check = (v, path) => {
  if (!Array.isArray(v)) fail(path, "an array", v);
};

/** The forms of column objects: their required properties and checks. */
const COLUMNS = {
  values: {
    required: ["values"],
    checks: { type: oneOf("time"), values: array } satisfies ChecksOf<TimeColumnSpec>,
  },
  binary: {
    required: ["dtype", "buffer"],
    checks: {
      type: oneOf("number", "time"),
      dtype: oneOf("float64", "float32", "int32", "uint32", "int16", "uint16", "int8", "uint8"),
      buffer: bufferIndex,
    } satisfies ChecksOf<BinaryColumnSpec>,
  },
  category: {
    required: ["codes", "dictionary"],
    checks: {
      type: oneOf("category"),
      codes: bufferOrArray,
      dictionary: strings,
    } satisfies ChecksOf<CategoryColumnSpec>,
  },
  geometry: {
    required: ["coordinates", "ringOffsets", "polygonOffsets", "geometryOffsets"],
    checks: {
      type: oneOf("geometry"),
      coordinates: bufferOrArray,
      ringOffsets: bufferOrArray,
      polygonOffsets: bufferOrArray,
      geometryOffsets: bufferOrArray,
      codes: bufferOrArray,
    } satisfies ChecksOf<GeometryColumnSpec>,
  },
};
const COLUMN_KEYS = [
  ...new Set(Object.values(COLUMNS).flatMap((form) => Object.keys(form.checks))),
];

/**
 * A column's form and the types of its properties. Inline values are
 * checked row by row when the table is built.
 */
const column: Check = (v, path) => {
  if (Array.isArray(v)) return;
  object(v, path);
  const spec = v as Record<string, unknown>;
  const form =
    spec.type === "category" || spec.type === "geometry"
      ? COLUMNS[spec.type]
      : spec.type === "time" && spec.values !== undefined
        ? COLUMNS.values
        : spec.type === "number" || spec.type === "time"
          ? COLUMNS.binary
          : undefined;
  if (!form) {
    const typo = spec.type === undefined ? misspelling(spec, "type", COLUMN_KEYS) : undefined;
    if (typo !== undefined) throw missing(path, "type", typo);
    fail(`${path}.type`, '"number", "time", "category", or "geometry"', spec.type);
  }
  checkProperties(spec, path, form.required, form.checks);
};

/** Why a point's size is in no single form: a constant radius and a size field both. */
function sizeFormError(spec: Record<string, unknown>, type: string): string | undefined {
  return spec.radius !== undefined && spec.size !== undefined
    ? `${type} radius: a constant radius or a size field, not both; drop one`
    : undefined;
}

/** Marks whose properties come in forms that exclude each other: why a spec has no single one. */
const FORMS: Partial<
  Record<MarkSpec["type"], (spec: Record<string, unknown>) => string | undefined>
> = {
  area: areaFormError,
  heatmap: heatmapFormError,
  boxplot: boxPlotFormError,
  contour: contourFormError,
  histogram: histogramFormError,
  rule: ruleFormError,
  region: regionFormError,
  rug: (spec) => {
    if ((spec.x !== undefined) === (spec.y !== undefined))
      return "rug: needs exactly one of x and y";
    const sides = spec.x !== undefined ? ["bottom", "top"] : ["left", "right"];
    if (spec.side !== undefined && !sides.includes(spec.side as string))
      return `rug side: expected "${sides.join('" or "')}"; received ${JSON.stringify(spec.side)}`;
    if (spec.y !== undefined && spec.axis === "right")
      return 'rug axis: a y rug has no right axis; drop axis: "right"';
    return undefined;
  },
  errorbar: (spec) => {
    const form = errorBarForm(spec);
    if (typeof form === "string") return form;
    // A symmetric interval's center is a field, as its error is.
    const across = form.horizontal ? "x" : "y";
    return form.symmetric && typeof spec[across] !== "string"
      ? `errorbar ${across}: a center with ${across}Error is a field; give a field's name`
      : undefined;
  },
  point: (spec) => pointSizeForm(spec)?.message,
  text: (spec) =>
    spec.from !== undefined &&
    (spec.at !== undefined || spec.x !== undefined || spec.y !== undefined)
      ? "text from: a place on another mark, or at, or x and y; one of them"
      : undefined,
  geopoint: (spec) => sizeFormError(spec, "geopoint"),
  treemap: (spec) => treeFormError(spec, "treemap"),
  sunburst: (spec) => treeFormError(spec, "sunburst"),
};

/** What the items of marks summarizing rows stand for, which tooltips cannot read fields of. */
const SUMMARIES: Record<string, string> = {
  histogram: "a histogram's bins count rows",
  boxplot: "a boxplot's boxes summarize rows",
  boxen: "a boxen's boxes summarize rows",
  violin: "a violin's shapes summarize rows",
  contour: "a contour's bands summarize its grid",
};

const mark: Check = (v, path) => {
  object(v, path);
  const spec = v as Record<string, unknown>;
  const kind: { required: readonly string[]; checks: Record<string, Check> } | undefined =
    Object.hasOwn(MARKS, spec.type as string) ? MARKS[spec.type as MarkSpec["type"]] : undefined;
  if (!kind)
    fail(
      `${path}.type`,
      Object.keys(MARKS)
        .map((k) => JSON.stringify(k))
        .join(" or "),
      spec.type,
    );
  const checks = { ...kind.checks, data: field, id: string };
  required(spec, path, kind.required, [...Object.keys(checks), "type"]);
  properties(spec, path, checks, ["type"]);
  if (spec.type === "dendrogram" && spec.axis !== undefined)
    throw refusal(
      `${path}.axis`,
      "a dendrogram's heights are plot-relative, on no y axis; drop axis",
    );
  // A summary's items stand for many rows, which have no one value of a field.
  const summary = SUMMARIES[spec.type as string];
  if (summary && spec.tooltip !== undefined)
    throw refusal(
      `${path}.tooltip${(spec.tooltip as { fields?: unknown } | null)?.fields !== undefined ? ".fields" : ""}`,
      `${summary}, so a field has no one value to read; brush them to select their rows, and read the rows' fields in a chart that draws them`,
      "unsupported",
    );
  const problem = FORMS[spec.type as MarkSpec["type"]]?.(spec);
  if (problem) throw refusal(path, problem);
  if (spec.type === "text" && spec.from === undefined && (spec.label as TextLabelSpec).place)
    throw refusal(
      `${path}.label.place`,
      "text at a place is drawn there; drop place, or follow a series with from",
    );
};

/**
 * Throws a ChartError naming the first property of `spec` that is not valid,
 * or that the spec format does not have (`checkSpec` returns those instead).
 */
export function validateSpec(spec: unknown): asserts spec is ChartSpec {
  const unknown = findUnknown(spec);
  if (unknown.length > 0) throw unknownRefusal(unknown);
}

/**
 * Checks `spec` like `validateSpec`, but returns the paths of the
 * properties it does not know, such as `marks[0].strokeWidht`, rather than
 * refusing them.
 */
export function checkSpec(spec: unknown): string[] {
  return findUnknown(spec).map(({ path }) => path);
}

/** Checks `spec`, throwing for what is not valid, and returns the properties it does not know. */
export function findUnknown(spec: unknown): UnknownProperty[] {
  const found: UnknownProperty[] = [];
  const outer = unknownPaths;
  unknownPaths = found;
  try {
    checkChart(spec);
    checkDendrogramData(spec);
  } finally {
    unknownPaths = outer;
  }
  return found;
}

/** An unknown property's path and, when a known one is close, the name it likely meant. */
export function describeUnknown({ path, known }: UnknownProperty): string {
  const name = path.slice(path.lastIndexOf(".") + 1);
  const meant = closest(name, known);
  return meant === undefined ? path : `${path} (did you mean "${meant}"?)`;
}

/** The error refusing a spec's unknown properties, at the first one's path. */
export function unknownRefusal(unknown: readonly UnknownProperty[]): ChartError {
  return new ChartError({
    code: "invalid-option",
    path: unknown[0]!.path,
    message: unknownError(unknown),
  });
}

/** Why a spec with unknown properties is refused, and what to do instead. */
export function unknownError(unknown: readonly UnknownProperty[]): string {
  const [first, ...rest] = unknown;
  const name = first!.path.slice(first!.path.lastIndexOf(".") + 1);
  const meant = closest(name, first!.known);
  const fix =
    meant !== undefined
      ? `did you mean "${meant}"?`
      : // Marks without color choose theirs: by series, by category, or one of their own.
        name === "color" && first!.known.includes("type")
        ? first!.known.includes("series")
          ? "the mark colors by series; give series, the field naming them"
          : "the mark chooses its colors itself; remove it (fill or stroke, where it takes them, set one)"
        : 'remove it, or load with { unknown: "warn" } or "ignore"';
  const more = rest.length > 0 ? ` (also unknown: ${rest.map(describeUnknown).join(", ")})` : "";
  return `${first!.path}: not a property of herceg's spec format; ${fix}${more}`;
}

/** The known name a misspelling most likely means: one or two edits away, or the same but for case. */
function closest(name: string, known: readonly string[]): string | undefined {
  let best: string | undefined;
  let distance = name.length < 4 ? 1 : 2;
  for (const candidate of known) {
    if (candidate.toLowerCase() === name.toLowerCase()) return candidate;
    const d = edits(name, candidate, distance);
    if (d <= distance && (best === undefined || d < distance)) {
      best = candidate;
      distance = d;
    }
  }
  return best;
}

/** Levenshtein distance between `a` and `b`, or more than `limit` once it surely is. */
function edits(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        row[j]! + 1,
        next[j - 1]! + 1,
        row[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return row[b.length]!;
}

/** Check inline linkage rows here; the loader checks binary and derived data. */
function checkDendrogramData(spec: ChartSpec): void {
  spec.marks.forEach((mark, i) => {
    if (mark.type !== "dendrogram") return;
    const path = `marks[${i}]`;
    if (spec.facet && mark.facet !== "repeat")
      throw refusal(
        `${path}.facet`,
        'missing; a dendrogram is drawn whole in every facet panel, so give it facet: "repeat"',
      );
    const names = Object.keys(spec.data ?? {});
    const name = mark.data ?? (names.length === 1 ? names[0] : undefined);
    const data =
      name !== undefined && Object.hasOwn(spec.data ?? {}, name) ? spec.data![name] : undefined;
    if (!data) throw refusal(`${path}.data`, "no table for the dendrogram; name one of spec.data");
    if ("source" in data) return;
    const fields = [mark.first, mark.second, mark.height] as const;
    const columns = fields.map((field, channel) => {
      const column = Object.hasOwn(data.columns, field) ? data.columns[field] : undefined;
      if (column === undefined)
        throw refusal(
          `${path}.${["first", "second", "height"][channel]}`,
          `no field "${field}" in the dendrogram's table`,
          "unknown-field",
        );
      if (Array.isArray(column)) {
        const bad = column.findIndex((value) => value !== null && typeof value !== "number");
        if (bad >= 0)
          throw refusal(
            path,
            `dendrogram row ${bad}, field "${field}": expected a number; received ${describe(column[bad])}`,
          );
        return column as readonly (number | null)[];
      }
      if ((column as { type: string }).type !== "number")
        throw refusal(path, `dendrogram field "${field}": expected a number column`);
      return undefined;
    });
    const rows = columns.find((column) => column !== undefined)?.length;
    if (rows === undefined) return;
    for (const [channel, column] of columns.entries())
      if (column && column.length !== rows)
        throw refusal(
          path,
          `dendrogram row ${Math.min(rows, column.length)}, field "${fields[channel]}": the fields have different row counts; give each one row per merge`,
        );
    try {
      checkLinkage(rows, mark.leaves, fields, (channel, row) => {
        const column = columns[channel];
        return column ? (column[row] ?? NaN) : undefined;
      });
    } catch (error) {
      throw refusal(path, (error as Error).message);
    }
  });
}

function checkChart(spec: unknown): asserts spec is ChartSpec {
  object(spec, "spec");
  const chart = spec as Record<string, unknown>;
  // Later versions may mean what this herceg cannot draw, so they are refused.
  const version = chart.version;
  if (version !== undefined && version !== SPEC_VERSION)
    fail("version", `${SPEC_VERSION}, the version this herceg reads`, version);
  if (!Array.isArray(chart.marks)) fail("marks", "an array of marks", chart.marks);
  for (const [i, item] of chart.marks.entries()) mark(item, `marks[${i}]`);
  properties(
    chart,
    "spec",
    {
      title,
      description: string,
      width: positive,
      height: positive,
      data: (data, path) => {
        object(data, path);
        for (const [name, table] of Object.entries(data as Record<string, unknown>)) {
          const at = `${path}.${name}`;
          object(table, at);
          const entry = table as Record<string, unknown>;
          if (entry.source !== undefined) {
            checkProperties(entry, at, ["transform"], {
              source: string,
              transform: transforms,
            } satisfies ChecksOf<DerivedSpec>);
          } else {
            required(entry, at, ["columns"], ["columns", "matrix", "origin"]);
            object(entry.columns, `${at}.columns`);
            const fields = Object.keys(entry.columns as object);
            properties(entry, at, {
              columns: () => {},
              origin: (v, where) => {
                if (typeof v !== "string" || !Object.hasOwn(data as object, v) || v === name)
                  fail(where, "the name of another table in data", v);
              },
              matrix: (m, where) => {
                object(m, where);
                const coordinate: Check = (v, path) => {
                  field(v, path);
                  if (!fields.includes(v as string))
                    fail(
                      path,
                      `a column of the table (${fields.map((f) => `"${f}"`).join(", ")})`,
                      v,
                    );
                };
                checkProperties(m as Record<string, unknown>, where, ["x", "y"], {
                  x: coordinate,
                  y: coordinate,
                });
              },
            } satisfies ChecksOf<ColumnsSpec>);
            for (const [name, values] of Object.entries(entry.columns as object))
              column(values, `${at}.columns.${name}`);
          }
        }
      },
      x: xAxis,
      y: chartAxis,
      yRight: chartAxis,
      panels: (p, path) => {
        if (!Array.isArray(p)) fail(path, "a list of panels", p);
        const ids = new Set<string>();
        for (const [i, item] of p.entries()) {
          const at = `${path}[${i}]`;
          object(item, at);
          const panel = item as Record<string, unknown>;
          checkProperties(panel, at, ["id"], {
            id: string,
            title: panelTitle,
            style: rolesOf(["plot", "panelTitle", ...AXIS_ROLES]),
            camera,
            x: axis,
            y: axis,
            yRight: axis,
            interaction: (v, at) => {
              object(v, at);
              properties(v as Record<string, unknown>, at, interactionChecks);
            },
          } satisfies ChecksOf<PanelSpec>);
          const id = panel.id as string;
          if (id === "" || id === "*") fail(`${at}.id`, 'a name other than "" and "*"', id);
          if (ids.has(id)) fail(`${at}.id`, "a name no other panel has", id);
          ids.add(id);
        }
      },
      layout: layoutNode,
      facet: (f, path) => {
        object(f, path);
        const spec = f as Record<string, unknown>;
        if ("field" in spec) {
          properties(spec, path, { field, columns: count } satisfies ChecksOf<WrappedFacetSpec>);
          if ("row" in spec || "column" in spec)
            fail(path, "a field to wrap, or row and column fields, not both", f);
          return;
        }
        properties(spec, path, { row: field, column: field } satisfies ChecksOf<GridFacetSpec>);
        if (spec.row === undefined && spec.column === undefined)
          fail(path, "a field, or a row or column field", f);
        // A grid's columns are its column field's values.
        if ("columns" in spec)
          fail(`${path}.columns`, "absent in a grid of row and column fields", spec.columns);
      },
      legend,
      scales: (v, path) => {
        object(v, path);
        for (const [name, scale] of Object.entries(v as Record<string, unknown>)) {
          if (scale === undefined) continue;
          // A name that is not an identifier stays whole: `scales["p.99"]`.
          const at = /^[A-Za-z_$][\w$]*$/.test(name)
            ? `${path}.${name}`
            : `${path}[${JSON.stringify(name)}]`;
          (["x", "y", "yRight"].includes(name) ? scaleSettings : namedScale)(scale, at);
        }
      },
      guides: guideList((scale) => {
        const name = scale as "x" | "y" | "yRight";
        const scales = chart.scales as Record<string, { type?: unknown } | undefined> | undefined;
        const short = ["x", "y", "yRight"].includes(name) ? chart[name] : undefined;
        return scales?.[name]?.type ?? (short as { type?: unknown } | undefined)?.type;
      }),
      padding: insets,
      tooltip: (t, path) => {
        if (typeof t === "boolean") return;
        object(t, path);
        properties(t as Record<string, unknown>, path, {
          mode: oneOf("nearest-x", "nearest-y", "nearest"),
          axisLabels: boolean,
        } satisfies ChecksOf<TooltipSpec>);
      },
      interaction: (i, path) => {
        object(i, path);
        properties(i as Record<string, unknown>, path, {
          ...interactionChecks,
          sync: (v, at) => {
            if (typeof v === "string") return;
            object(v, at);
            properties(v as Record<string, unknown>, at, {
              cursor: syncChannel(true, "x", "y"),
              viewport: syncChannel(false, "x", "y"),
              selection: syncChannel(false, "x", "y", "xy"),
              panels: (p, path) => {
                if (typeof p === "boolean") return;
                object(p, path);
                properties(p as Record<string, unknown>, path, cursorShow);
              },
            } satisfies ChecksOf<SyncSpec>);
          },
        } satisfies ChecksOf<InteractionSpec>);
      },
      navigator: (v, path) => {
        if (typeof v === "boolean") return;
        object(v, path);
        properties(v as Record<string, unknown>, path, {
          height: (h, at) => {
            if (typeof h !== "number" || !(h >= 16) || !Number.isFinite(h))
              fail(at, "a height of at least 16 pixels", h);
          },
          marks: (m, at) => {
            strings(m, at);
            const ids = m as string[];
            ids.forEach((id, i) => {
              if (ids.indexOf(id) !== i) fail(`${at}[${i}]`, "a mark id not listed before", id);
            });
          },
          halo,
          panel: string,
        } satisfies ChecksOf<NavigatorSpec>);
      },
      animation: (a, path) => {
        if (typeof a === "boolean") return;
        object(a, path);
        properties(a as Record<string, unknown>, path, {
          duration: (v, at) => {
            if (typeof v !== "number" || !(v >= 0) || !Number.isFinite(v))
              fail(at, "milliseconds, at least 0", v);
          },
          values: boolean,
        } satisfies ChecksOf<AnimationSpec>);
      },
      rowSelection: (v, path) => {
        const bindings = Array.isArray(v) ? v : [v];
        if (bindings.length === 0) fail(path, "a binding or a list of them", v);
        bindings.forEach((binding, i) => {
          const at = Array.isArray(v) ? `${path}[${i}]` : path;
          object(binding, at);
          const b = binding as Record<string, unknown>;
          checkProperties(b, at, ["channel"], {
            data: string,
            channel: (c, where) => {
              if (typeof c !== "string" || c === "") fail(where, "a channel's name", c);
            },
            events: (e, where) => {
              strings(e, where);
              const gesture = oneOf("brush", "lasso", "click");
              for (const [k, event] of (e as string[]).entries()) gesture(event, `${where}[${k}]`);
            },
            effect: oneOf("highlight", "none"),
            selection: (selection, where) => {
              object(selection, where);
              const kind = (selection as { kind?: unknown }).kind;
              const checks: Record<string, Check> | undefined =
                kind === "rows"
                  ? { kind: string, rows: positions }
                  : kind === "predicate"
                    ? { kind: string, expression }
                    : undefined;
              if (!checks) fail(`${where}.kind`, '"predicate" or "rows"', kind);
              checkProperties(
                selection as Record<string, unknown>,
                where,
                kind === "rows" ? ["rows"] : ["expression"],
                checks,
              );
            },
          } satisfies ChecksOf<RowSelectionSpec>);
        });
      },
      renderer: oneOf("auto", "svg", "canvas"),
      theme,
      locale: string,
      timeZone: string,
      projection,
      z: (v, path) => {
        if (isRecord(v) && v.style !== undefined)
          fail(`${path}.style`, "no style on a 3D chart's axes, which take the theme's", v.style);
        axis(v, path);
      },
      camera,
      boxAspect,
    } satisfies ChecksOf<Omit<ChartSpec, "marks" | "version">>,
    ["marks", "version"],
  );
  for (const [i, item] of (chart.marks as Record<string, unknown>[]).entries()) {
    if (item.type === "violin" && item.split === true && item.series === undefined)
      fail(`marks[${i}].split`, "a series field for split violins", item.split);
    if (item.type === "heatmap")
      for (const axis of ["x", "y"])
        if (item[`${axis}Step`] !== undefined && item[`${axis}Banded`] === true)
          fail(`marks[${i}].${axis}Step`, `no ${axis}Step with ${axis}Banded`, item[`${axis}Step`]);
  }
  // Dragging moves a network's nodes; a chart of other marks has none.
  const interaction = chart.interaction as { drag?: unknown } | undefined;
  if (
    interaction?.drag === true &&
    !(chart.marks as Record<string, unknown>[]).some(({ type }) => type === "graph")
  )
    fail("interaction.drag", "a spec with a graph mark, whose nodes dragging moves", true);
  for (const [i, panel] of ((chart.panels ?? []) as PanelSpec[]).entries())
    if (
      panel.interaction?.drag === true &&
      !(chart.marks as Record<string, unknown>[]).some(
        (mark) => mark.type === "graph" && (mark.panel === panel.id || mark.panel === "*"),
      )
    )
      fail(
        `panels[${i}].interaction.drag`,
        "a panel with a graph mark, whose nodes dragging moves",
        true,
      );
  // Gestures bound twice, keys the keyboard cursor takes, and brushes that
  // zoom where they select rows, as charts refuse them.
  const rows = [chart.rowSelection ?? []].flat() as RowSelectionSpec[];
  const brushesRows = rows.some(({ events }) => !events || events.includes("brush"));
  const bind = (settings: InteractionSpec | undefined, path: string) => {
    try {
      if (settings) new Bindings(settings, brushesRows, path);
    } catch (error) {
      throw delegated(path, error);
    }
  };
  bind(chart.interaction as InteractionSpec | undefined, "interaction");
  // A subplot's own settings, over the chart's, as charts compile them.
  for (const [i, panel] of ((chart.panels ?? []) as PanelSpec[]).entries())
    bind(
      panel.interaction &&
        panelInteraction(chart.interaction as InteractionSpec, panel.interaction),
      `panels[${i}].interaction`,
    );
  // A projection places maps' marks; a chart of other marks has nothing to project.
  if (
    chart.projection !== undefined &&
    !(chart.marks as Record<string, unknown>[]).some(
      ({ type }) => type === "geoshape" || type === "geopoint",
    )
  )
    fail(
      "projection",
      "a spec with geoshape or geopoint marks: a projection needs geoshape or geopoint marks",
      chart.projection,
    );
  // A 3D chart's options mean nothing to other charts, which an older
  // reader might draw without them.
  const threeD = (chart.marks as Record<string, unknown>[]).some(
    ({ type }) => type === "point3d" || type === "line3d" || type === "surface",
  );
  for (const name of ["z", "camera", "boxAspect"])
    if (chart[name] !== undefined && !threeD)
      fail(name, "a spec with point3d, line3d, or surface marks", chart[name]);
  const solid = (chart.marks as Record<string, unknown>[]).find(
    ({ type }) => type === "point3d" || type === "line3d" || type === "surface",
  );
  if (chart.facet !== undefined && solid)
    throw refusal(
      "facet",
      `${solid.type} cannot split into facets; draw each group's marks in a panel of their own`,
      "unsupported",
    );
  // Marks name panels the chart has; with panels, every mark names one.
  const panels = chart.panels as { id: string }[] | undefined;
  if (chart.layout !== undefined && !panels) fail("layout", "a spec with panels", chart.layout);
  if (chart.facet !== undefined && panels)
    throw refusal(
      "facet",
      "a chart with panels cannot also split into facets; put each group's marks in a panel of the layout, or facet a chart of its own",
      "unsupported",
    );
  const ids = new Set(panels?.map(({ id }) => id));
  for (const [i, item] of (chart.marks as Record<string, unknown>[]).entries()) {
    const panel = item.panel;
    if (!panels && panel !== undefined) fail(`marks[${i}].panel`, "a spec with panels", panel);
    if (panels && panel !== "*" && !ids.has(panel as string))
      fail(`marks[${i}].panel`, `"*" or the id of one of the panels`, panel);
  }
}
