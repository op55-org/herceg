// Scale identity. A chart's position scales are named: the short forms `x`,
// `y`, and `yRight` define the scales "x", "y", and "yRight" and their axes.
// A scale's `scope` says which panels share one instance of it, with one
// domain (each panel keeps its own pixel range). An instance's type comes
// from the marks its own panels draw on it, found after marks are assigned
// to panels, so one subplot can put categories on its y axis while another
// puts numbers on its own.

import type { ChartAxisOptions } from "../guides/options.ts";
import type { Mark } from "../marks/mark.ts";
import type { AxisSpec, ScaleScope } from "../spec/spec.ts";
import type { AxisType } from "./axis.ts";

/** The position scales the short forms define: x, the left y, and the right y. */
export type ScaleName = "x" | "y" | "yRight";

/** Each position scale's scope. */
export type Scopes = Readonly<Record<ScaleName, ScaleScope>>;

/** The scales' settings a chart's scopes are read from. */
export interface ScaledConfig {
  readonly x?: ChartAxisOptions | undefined;
  readonly y?: ChartAxisOptions | undefined;
  readonly yRight?: ChartAxisOptions | undefined;
  /** A range navigator, which moves an x range every panel shares. */
  readonly navigator?: object | undefined;
}

/**
 * The scope of each position scale: its own, or by default `own` for x and
 * y (each panel of subplots, the whole chart in facets), and y's for yRight;
 * a navigator's chart shares x.
 */
export function scopesOf(config: ScaledConfig, own: ScaleScope): Scopes {
  const y = config.y?.scope ?? own;
  const x = config.x?.scope ?? (config.navigator ? "chart" : own);
  return { x, y, yRight: config.yRight?.scope ?? y };
}

/** Which scale an instance is of, and in subplots, how numbers placed with another's categories are refused. */
export interface InstanceOf {
  scale: ScaleName;
  /** The error for `numbers` on an instance where `categories` places categories (see `mixedPanels`). */
  mixed?: ((numbers: Mark, categories: Mark) => Error) | undefined;
}

/** The categories a position `domain` lists, in their bands' order; undefined for two ends, or none. */
export function listedCategories(domain: AxisSpec["domain"]): readonly string[] | undefined {
  return typeof domain?.[0] === "string" ? (domain as readonly string[]) : undefined;
}

/** A position `domain`'s two ends; undefined for none, or for categories. */
export function domainEnds(domain: AxisSpec["domain"]): readonly [number, number] | undefined {
  return typeof domain?.[0] === "number" ? (domain as readonly [number, number]) : undefined;
}

/**
 * The error for the position domain at `path` ("chart x") not of its axis'
 * form: categories (`listed`) along an axis of numbers or times, or of
 * bands of them (`banded`), or two ends along one of categories.
 */
export function unsuitedDomain(path: string, listed: boolean, banded = false): Error {
  const [shows, give] = !listed
    ? ["categories", "list them in order, or "]
    : banded
      ? ["bands of numbers or times", ""]
      : ["numbers or times", "give its two ends, or "];
  return new Error(`${path}.domain: the axis shows ${shows}; ${give}drop domain`);
}

/**
 * The type of one instance of a scale, from the marks its panels draw on it
 * and its `declared` type: a band scale when they place categories along it
 * (then every mark placing a field there must), otherwise the declared
 * type, else time when one places times, else linear. A declared domain
 * must suit it: categories for a band scale, two ends for the others.
 */
export function instanceType(
  marks: readonly Mark[],
  declared: Pick<AxisSpec, "type" | "domain"> | undefined,
  where: InstanceOf,
): AxisType {
  const { scale } = where;
  const channel = scale === "x" ? "x" : "y";
  const kinds = marks.map((mark) => mark.channelKind(channel));
  const banding = kinds.indexOf("category");
  if (banding >= 0) {
    if (scale === "yRight") throw new Error('axis: "right" takes no category y values');
    // Every mark with a field on this channel must band it.
    const index = kinds.findIndex((kind) => kind !== undefined && kind !== "category");
    if (index >= 0) {
      const numbers = marks[index]!;
      throw (
        where.mixed?.(numbers, marks[banding]!) ??
        new Error(`${numbers.spec.type} ${channel}: numbers cannot share a category axis`)
      );
    }
    if (declared?.type)
      throw new Error(`chart ${scale}.type: the axis shows categories; drop "${declared.type}"`);
    if (domainEnds(declared?.domain)) throw unsuitedDomain(`chart ${scale}`, false);
    return "band";
  }
  if (listedCategories(declared?.domain)) throw unsuitedDomain(`chart ${scale}`, true);
  return declared?.type ?? (kinds.includes("time") ? "time" : "linear");
}

/**
 * In subplots, the error for numbers placed on a scale instance another
 * mark places categories on: when the two draw in different panels
 * (`panelOf` says which; undefined for every panel), scales of their own
 * would part them.
 */
export function mixedPanels(
  numbers: Mark,
  categories: Mark,
  scale: ScaleName,
  panelOf: (mark: Mark) => string | undefined,
): Error {
  const channel = scale === "x" ? "x" : "y";
  const [here, there] = [panelOf(numbers), panelOf(categories)];
  return new Error(
    here === undefined || there === undefined || here === there
      ? `${numbers.spec.type} ${channel}: numbers cannot share a category axis`
      : `${numbers.spec.type} ${channel}: numbers in panel "${here}" cannot share scale "${scale}" with the categories of the ${categories.spec.type} in panel "${there}"; give ${scale} scope "panel"`,
  );
}
