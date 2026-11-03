// The rows an item stands for, as a condition on its mark's table's fields:
// what it groups by (an aggregate's mark says, `Mark.groupsOf`; an
// `itemKey` value; a bar's position and series), as a layout's item says
// (`LayoutResult.conditionOf`), with its panel's facet values and its
// mark's view. Selections' conditions (model/conditions.ts) and clicks'
// provenance (model/provenance.ts) read items through it. It imports no
// code, so the picking chunk takes it without sharing a module with charts'
// first chunks.

import type { Expression } from "../data/expression.ts";
import type { Mark } from "../marks/mark.ts";
import type { ProvenanceGroup } from "./items.ts";
import type { ChartModel } from "./model.ts";

const field = (name: string) => ["field", name] as const;

/** Conditions joined: true where any of them is. */
export const any = (parts: readonly Expression[]): Expression =>
  parts.length === 1 ? parts[0]! : ["or", ...parts];

/** The facet values of panel `key` that `mark`'s rows there have, where the facet splits it. */
export function facetsOf(model: ChartModel, key: string, mark: Mark): ProvenanceGroup[] {
  const facet = model.config.facet;
  if (!facet?.splits(mark)) return [];
  const fields = facet.fields;
  // One field's panels are keyed by its value; a grid's by both, as a list.
  const values = fields.length === 1 ? [key] : (JSON.parse(key) as string[]);
  return fields.map((name, i) => ({ field: name, value: values[i]! }));
}

/**
 * `condition` on the rows `mark` draws in panel `key`: those of its facet
 * values, where the facet splits it, and of its view (see `viewed`).
 */
export function within(
  model: ChartModel,
  key: string,
  mark: Mark,
  condition: Expression | null | undefined,
): Expression | undefined {
  const facets = facetsOf(model, key, mark);
  return viewed(
    mark,
    condition != null && facets.length > 0 ? ["and", condition, ...matching(facets)] : condition,
  );
}

/**
 * `condition` on the rows `mark` shows: within its view's filter;
 * undefined where its view shows rows a set of them names, which no
 * condition says.
 */
export function viewed(
  mark: Mark,
  condition: Expression | null | undefined,
): Expression | undefined {
  const view = mark.view;
  if (condition == null || view?.restriction) return undefined;
  const filter = view?.query.filter;
  if (filter === undefined || filter === true) return condition;
  const shown =
    filter !== null && typeof filter === "object" && "expression" in filter
      ? filter.expression
      : filter;
  return ["and", condition, shown];
}

/**
 * The rows the item keyed `key` (parsed as `parts`) of `mark` stands for,
 * within its view: in panel `panel`, where given, with its facet values;
 * else in every panel. A layout mark's items as each panel's layout says
 * (`LayoutResult.conditionOf`), others by what they group by.
 */
export function itemCondition(
  model: ChartModel,
  mark: Mark,
  key: string,
  parts: readonly unknown[],
  panel?: string,
): Expression | undefined {
  const table = mark.table;
  const laid = model
    .drawnMarks()
    .filter((d) => d.layout && d.mark === parts[0] && (panel ?? d.panel) === d.panel);
  const grouped = (): Expression | undefined => {
    const groups = groupsOf(mark, key, parts);
    return groups && and(matching(groups));
  };
  if (table && laid.length > 0) {
    const each = laid.map(({ layout, panel: at }) => {
      const given = layout!.conditionOf?.(key, table);
      return within(model, at, mark, given === undefined ? grouped() : given);
    });
    return each.includes(undefined) ? undefined : any(each as Expression[]);
  }
  return panel === undefined ? viewed(mark, grouped()) : within(model, panel, mark, grouped());
}

const and = (parts: readonly Expression[]): Expression =>
  parts.length === 0 ? true : parts.length === 1 ? parts[0]! : ["and", ...parts];

/** Each group as a condition on its field. */
function matching(groups: readonly ProvenanceGroup[]): Expression[] {
  return groups.map(
    (group): Expression =>
      "value" in group
        ? ["==", field(group.field), group.value]
        : [
            "and",
            [">=", field(group.field), group.from],
            [group.closed ? "<=" : "<", field(group.field), group.to],
          ],
  );
}

/**
 * What the item keyed `key` (parsed as `parts`) of `mark` groups by: what
 * an aggregate's mark says (`Mark.groupsOf`); an `itemKey` value; a bar's
 * position's value and its series' value. Undefined for a row named by its
 * identity, and for keys of no item.
 */
export function groupsOf(
  mark: Mark,
  key: string,
  parts: readonly unknown[],
): readonly ProvenanceGroup[] | undefined {
  const groups = mark.groupsOf?.(key);
  if (groups) return groups;
  const wide = mark.wide ? 1 : 0;
  const name = parts[1 + wide] as string | number;
  const itemKey = (mark.spec as { itemKey?: string }).itemKey;
  if (itemKey !== undefined)
    return parts.length === 2 + wide ? [{ field: itemKey, value: name }] : undefined;
  // A bar by its position's value, in its series.
  const position = mark.itemPosition;
  if (position === undefined || parts.length !== 3) return undefined;
  const split = wide ? undefined : mark.identity?.field;
  return [
    { field: position, value: parts[2] as string | number },
    ...(split !== undefined && typeof parts[1] === "string"
      ? [{ field: split, value: parts[1] }]
      : []),
  ];
}
