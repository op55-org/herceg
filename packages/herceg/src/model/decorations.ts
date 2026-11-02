// Decorations: text, rules, regions, and custom marks beside a layout mark
// in its panel, placed only by its items (`{ item, at }`, text `from` an
// item) or in pixels. They have no scales; they draw after the layout mark
// in the same frame, reading its items as drawn, so they never lag a frame,
// during a transition either (dom/value-transition.ts draws them again over
// the items of each frame). Charts reach this module through their layout
// marks (model/item-views.ts).

import type { PanelDrawing } from "../layout/placer.ts";
import type { DrawnMark } from "../marks/drawn.ts";
import type { DrawnItems, ItemInfo, LayoutMark } from "../marks/layout-mark.ts";
import type { Frame, Mark, MarkKey, RowParts } from "../marks/mark.ts";
import type { PositionScale } from "../scale/scale.ts";
import type { Geometry, Rect } from "../scene/scene.ts";
import { ChartError } from "../spec/errors.ts";

/** A decoration as a panel draws it: the mark, its key among the chart's marks, and its rows there. */
export interface Decoration {
  readonly mark: Mark;
  readonly key: MarkKey;
  readonly rows: RowParts | undefined;
}

/** What decorations drew in a panel: their geometry, and their records. */
export interface Decorated {
  geometry: Geometry[];
  records: (DrawnMark & PanelDrawing)[];
}

/**
 * The panel's geometry: the layout mark's (`under`), then the decorations',
 * in order of their `zIndex` (the layout mark's is 0), ties as listed.
 */
export function painted(under: readonly Geometry[], over: readonly Geometry[]): Geometry[] {
  const all = [...under, ...over];
  return over.some((g) => g.zIndex) ? all.sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0)) : all;
}

const ARTICLE = /^[aeiou]/;

/** "a treemap", "an area"; a 3D box's layers, "a 3D plot". */
function named(type: string): string {
  const name = type === "plot3d" ? "3D plot" : type;
  return `${ARTICLE.test(name) ? "an" : "a"} ${name}`;
}

/**
 * Checks the marks `marks` beside the layout marks `drawn` of a panel (a
 * chart of one, facet panels, or subplot `panel`): each is placed only by
 * items or in pixels, and follows layout marks of the panel that give
 * their items' geometry (`LayoutMark.publishes`). `all` are the chart's
 * marks, which name the marks followed.
 */
export function checkDecorations(
  marks: readonly Mark[],
  drawn: readonly LayoutMark[],
  all: readonly { spec: { type: string; id?: string | undefined } }[],
  room: { facets?: boolean; panel?: string | undefined } = {},
): void {
  const layout = drawn[0]!.spec.type;
  const { facets, panel } = room;
  // Marks follow the items of layout marks that give their geometry; any, in pixels.
  const by = drawn[0]!.publishes ? `by the ${layout}'s items or in pixels` : "in pixels";
  for (const mark of marks) {
    const { type } = mark.spec;
    const at = all.indexOf(mark);
    const where = { mark: mark.spec.id ?? at, path: `marks[${at}]` };
    const others = `place text, rules, regions, or custom marks ${by}`;
    if (!mark.follows)
      throw new ChartError({
        code: "unsupported",
        ...where,
        message: ["text", "rule", "region", "custom"].includes(type)
          ? `${type}: ${named(layout)}'s ${facets ? "facet panels have" : panel === undefined ? "chart has" : "panel has"} no x and y scales; place it ${drawn[0]!.publishes ? `by the ${layout}'s items ({ item: { mark, item } }) or in pixels` : "in pixels"}`
          : panel === undefined
            ? `${type}: ${named(layout)}'s ${facets ? "facet panels have" : "chart has"} no x and y scales; draw the ${type} in another chart, or ${others}`
            : `${type} panel: panel "${panel}" draws ${named(layout)}, which has no x and y scales; name another panel, or ${others}`,
      });
    for (const id of mark.follows) {
      const source = all.find((other) => other.spec.id === id);
      const own = drawn.find(
        (other) => other.spec.id === id || other.layers?.some((layer) => layer.spec.id === id),
      );
      const problem = !source
        ? `no mark has id "${id}"; give the id of the ${layout} it follows`
        : !own
          ? !("layout" in source)
            ? `"${id}" is ${named(source.spec.type)}, which has no layout items; give a layout mark's id`
            : `"${id}" is drawn in another panel; draw the ${type} in its panel`
          : !own.publishes
            ? `"${id}" is ${named(own.spec.type)}, whose items give no geometry to place by; follow a pie, funnel, treemap, or sunburst`
            : undefined;
      if (problem)
        throw new ChartError({
          code: source ? "invalid-option" : "unknown-reference",
          ...where,
          message: `${type} item mark: ${problem}`,
        });
    }
  }
}

/** The items `items` as marks placed by them look them up: by their names from the top. */
export function drawnItems(items: readonly ItemInfo[]): DrawnItems {
  let byNames: Map<string, ItemInfo> | undefined;
  return {
    all: items,
    named(names) {
      if (!byNames) {
        byNames = new Map();
        // Items sharing names (none do today) are found as the first drawn.
        for (const item of items) {
          const key = JSON.stringify(item.names);
          if (!byNames.has(key)) byNames.set(key, item);
        }
      }
      return byNames.get(JSON.stringify(names));
    },
  };
}

/**
 * A position scale decorations do not have: places on it are refused,
 * naming the way in. Its range is the plot's, which custom marks read.
 */
function noScale(axis: "x" | "y", plot: Rect, what: string): PositionScale {
  const refuse = (): never => {
    throw new ChartError({
      code: "unsupported",
      path: axis,
      message: `${axis}: ${what}'s chart has no ${axis} scale; place shapes in pixels, or by its items (context.items)`,
    });
  };
  const range: readonly [number, number] =
    axis === "x" ? [plot.x, plot.x + plot.width] : [plot.y + plot.height, plot.y];
  return {
    type: "linear",
    domain: [Number.NaN, Number.NaN],
    range,
    map: refuse,
    invert: refuse,
    ticks: () => [],
    mapping: refuse,
  };
}

/**
 * Draws `marks` beside the layout mark `layout` in a panel with `frame`
 * (whose scales they do not have), its items `items` (undefined for a mark
 * that gives none; made when first looked up) looked up by the marks placed
 * by them: their geometry,
 * cut to nothing unless their `clip` says otherwise and painted at their
 * `zIndex`, and their records for the picker, at `revision` and current
 * while `current(mark)` says so, picked only within the panel's box
 * `keep` (in facets and subplots) as they draw only there.
 */
export function decorate(
  marks: readonly Decoration[],
  layout: { readonly id: MarkKey; readonly type: string },
  items: (() => readonly ItemInfo[]) | undefined,
  frame: Omit<Frame, "x" | "y" | "items">,
  revision: number,
  current: (mark: Mark) => () => boolean,
  keep?: Readonly<Rect>,
): Decorated {
  let lookup: DrawnItems | undefined;
  const what = named(layout.type);
  const own: Frame = {
    ...frame,
    x: noScale("x", frame.plot, what),
    y: noScale("y", frame.plot, what),
    items(id) {
      if (id !== layout.id || !items) return undefined;
      lookup ??= drawnItems(items());
      return lookup;
    },
    // Cut to nothing unless they say otherwise, though kept to their panel's box.
    clip: false,
    // Decorations follow their items as they move; they animate no values of their own.
    keyed: false,
  };
  const records = marks.map(({ mark, key, rows }) => ({
    mark: key,
    panel: frame.panel ?? "",
    frame: own,
    geometry: mark.geometry([], own, key, rows),
    series: [],
    revision,
    current: current(mark),
    of: mark,
    rows,
    keep,
  }));
  // Labels kept apart are placed together, as in panels with axes (layout/placer.ts).
  records.find((record) => record.of.placer)?.of.placer?.(records, frame.features);
  const geometry: Geometry[] = [];
  for (const { of: mark, geometry: drawn } of records) {
    // Cut to the panel's box (where it keeps one), not the layout's room, unless said otherwise.
    const { clip = false, zIndex } = mark.spec;
    for (const g of drawn) Object.assign(g, { clip, zIndex });
    geometry.push(...drawn);
  }
  return { geometry, records };
}
