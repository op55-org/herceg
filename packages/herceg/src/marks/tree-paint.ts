// The paint of trees' items (treemaps and sunbursts): each item's fill, its
// color group's color (none above the color field's level), and its fill
// opacity, the mark's default unless `fillOpacity` gives a number or reads
// an item measure through a range, with the `leaf` or `branch` look over
// both, property by property.

import type { Hierarchy } from "../data/hierarchy.ts";
import { ChartError } from "../spec/errors.ts";
import type { Frozen, ItemMeasure, TreeLook, TreeOpacity } from "../spec/spec.ts";
import type { PaintReader } from "../theme.ts";

/**
 * What tree marks' options say of their items' paint and levels (see
 * `TreePaintStyle` in the spec): `color`, a category field `F` of the path.
 */
export interface TreePaintOptions<F extends string> {
  /** A field of the path whose values color the items at its level and below; each top-level node's color by default. */
  color?: F;
  /** How items without children look, over the mark's paint. */
  leaf?: TreeLook;
  /** How items with children look, over the mark's paint. */
  branch?: TreeLook;
  /** A fill opacity, or one read from an item measure through a range: `{ measure: "share", range: [0.4, 1] }`. */
  fillOpacity?: TreeOpacity;
  /** Siblings largest first ("value", the default), or in the data's order ("input"); the legend lists colors so too. */
  sort?: "value" | "input";
  /** Levels drawn below the tree's root (the drill root); every level by default. */
  levels?: number;
  /** Breadcrumbs above the tree: while the chart drills it or it is drilled (by default), never (`false`), or always (`true`). */
  breadcrumbs?: boolean;
}

/** Refuses `levels`, `sort`, and `breadcrumbs` a tree cannot take, as `checkTreePaint` does. */
export function checkTreeLevels(
  spec: { readonly levels?: unknown; readonly sort?: unknown; readonly breadcrumbs?: unknown },
  role: string,
): void {
  const fail = (path: string, message: string) =>
    new ChartError({ code: "invalid-option", path, message: `${role} ${path}: ${message}` });
  const { levels, sort, breadcrumbs } = spec;
  if (levels !== undefined && !(Number.isInteger(levels) && (levels as number) >= 1))
    throw fail(
      "levels",
      `expected a whole number of at least 1; received ${JSON.stringify(levels)}`,
    );
  if (sort !== undefined && sort !== "value" && sort !== "input")
    throw fail("sort", `expected "value" or "input"; received ${JSON.stringify(sort)}`);
  if (breadcrumbs !== undefined && typeof breadcrumbs !== "boolean")
    throw fail("breadcrumbs", `expected true or false; received ${JSON.stringify(breadcrumbs)}`);
}

/** What a tree's spec says of its items' paint. */
export interface TreePaintSpec {
  readonly fillOpacity?: TreeOpacity;
  readonly leaf?: TreeLook;
  readonly branch?: TreeLook;
}

const MEASURES: readonly ItemMeasure[] = ["share", "value", "depth"];
const LOOK_KEYS = ["fill", "fillOpacity", "opacity"];

/**
 * Refuses paint options a tree cannot draw, naming the option as `role`
 * does ("treemap"), for options given without types and for specs.
 */
export function checkTreePaint(spec: TreePaintSpec, role: string): void {
  const fail = (path: string, message: string) =>
    new ChartError({ code: "invalid-option", path, message: `${role} ${path}: ${message}` });
  const fraction = (value: unknown, path: string) => {
    if (typeof value !== "number" || !(value >= 0 && value <= 1))
      throw fail(path, `expected a number from 0 to 1; received ${JSON.stringify(value)}`);
  };
  const { fillOpacity } = spec;
  if (typeof fillOpacity === "object" && fillOpacity !== null) {
    const { measure, range } = fillOpacity as { measure?: unknown; range?: unknown };
    if (!MEASURES.includes(measure as ItemMeasure))
      throw fail(
        "fillOpacity measure",
        `expected "share", "value", or "depth"; received ${JSON.stringify(measure)}`,
      );
    if (!Array.isArray(range) || range.length !== 2)
      throw fail("fillOpacity range", `expected [from, to]; received ${JSON.stringify(range)}`);
    for (const [i, value] of range.entries()) fraction(value, `fillOpacity range[${i}]`);
  } else if (fillOpacity !== undefined) fraction(fillOpacity, "fillOpacity");
  for (const name of ["leaf", "branch"] as const) {
    const look = spec[name];
    if (look === undefined) continue;
    if (typeof look !== "object" || look === null || Array.isArray(look))
      throw fail(
        name,
        `expected a look such as { fillOpacity: 0.4 }; received ${JSON.stringify(look)}`,
      );
    for (const key of Object.keys(look))
      if (!LOOK_KEYS.includes(key))
        throw fail(
          `${name}.${key}`,
          `${role} items draw no outline and no ${key}; give fill, fillOpacity, or opacity`,
        );
    if (look.fill !== undefined && typeof look.fill !== "string")
      throw fail(`${name}.fill`, `expected a color; received ${JSON.stringify(look.fill)}`);
    if (look.fillOpacity !== undefined) fraction(look.fillOpacity, `${name}.fillOpacity`);
    if (look.opacity !== undefined) fraction(look.opacity, `${name}.opacity`);
  }
}

/** What measures read across a mark's items: the largest value and the deepest level. */
export interface MeasureDomain {
  value: number;
  depth: number;
}

/**
 * What measures read across `view` with the totals `shown` (hidden colors'
 * items counting as nothing): the largest value of an item below the root
 * (a top-level one, values being totals), and the deepest level with a
 * value, at most `levels`.
 */
export function measureDomain(
  view: { tree: Hierarchy },
  shown: Float64Array,
  levels: number,
): MeasureDomain {
  const { tree } = view;
  let value = 0;
  for (let c = tree.childStart[0]!; c < tree.childStart[1]!; c++)
    value = Math.max(value, shown[tree.children[c]!]!);
  let depth = 0;
  for (let node = 1; node < tree.size; node++)
    if (shown[node]! > 0) depth = Math.max(depth, tree.depth[node]!);
  return { value, depth: Math.min(depth, levels) };
}

/** What items' paint reads across one drawing: measures' domain, and the looks' fills as renderers read colors. */
export interface PaintContext extends MeasureDomain {
  leaf: string | undefined;
  branch: string | undefined;
}

/**
 * Each item's fill and fill opacity: `fill` its color group's color (none
 * above the color field's level), `opacity` the mark's `fillOpacity` (or
 * `fallback`'s, the mark's default), with its leaf or branch look over
 * them. Branches are items with children of a value in `values` (the
 * panel's tree, before the legend hides any), whatever is drawn.
 */
export class TreePaint {
  readonly #spec: Frozen<TreePaintSpec>;

  constructor(spec: Frozen<TreePaintSpec>) {
    this.#spec = spec;
  }

  /** Whether item opacities come from a measure, which varies from item to item. */
  get measured(): boolean {
    return typeof this.#spec.fillOpacity === "object";
  }

  /**
   * What `of` reads across one drawing: `domain`, and the looks' fills read
   * with `paint` (CSS variables and theme colors resolved), refusals naming
   * `role`'s options.
   */
  context(domain: MeasureDomain, paint: PaintReader, role: string): PaintContext {
    const { leaf, branch } = this.#spec;
    return {
      ...domain,
      leaf: leaf?.fill === undefined ? undefined : paint(leaf.fill, `${role} leaf.fill`),
      branch: branch?.fill === undefined ? undefined : paint(branch.fill, `${role} branch.fill`),
    };
  }

  /**
   * Node `node`'s fill (undefined: not filled) and opacity in `tree`, whose
   * values before and after hiding are `values` and `shown`; `color` its
   * group's color, `fallback` the mark's default opacity for it, and
   * `context` what measures and looks read across the drawing.
   */
  of(
    tree: Hierarchy,
    values: Float64Array,
    shown: Float64Array,
    node: number,
    color: string | undefined,
    fallback: number,
    context: PaintContext,
  ): { fill: string | undefined; opacity: number } {
    const { fillOpacity, leaf, branch } = this.#spec;
    let opacity = fallback;
    if (typeof fillOpacity === "number") opacity = fillOpacity;
    else if (fillOpacity) {
      const parent = tree.parent[node]!;
      const [from, to] = fillOpacity.range;
      const t =
        fillOpacity.measure === "share"
          ? parent < 0
            ? 1
            : shown[parent]! > 0
              ? shown[node]! / shown[parent]!
              : 0
          : fillOpacity.measure === "value"
            ? context.value > 0
              ? shown[node]! / context.value
              : 0
            : context.depth > 1
              ? (tree.depth[node]! - 1) / (context.depth - 1)
              : 0;
      // Whole steps of an 8-bit alpha: items as close are drawn together.
      opacity = Math.round((from + Math.min(1, Math.max(0, t)) * (to - from)) * 255) / 255;
    }
    const children = hasChildren(tree, values, node);
    const look = children ? branch : leaf;
    return {
      fill: (children ? context.branch : context.leaf) ?? color,
      opacity: (look?.fillOpacity ?? opacity) * (look?.opacity ?? 1),
    };
  }
}

/** Whether `node` has children with a value in `values`. */
export function hasChildren(tree: Hierarchy, values: Float64Array, node: number): boolean {
  for (let c = tree.childStart[node]!; c < tree.childStart[node + 1]!; c++)
    if (values[tree.children[c]!]! > 0) return true;
  return false;
}
