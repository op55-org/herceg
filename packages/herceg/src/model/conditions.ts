// What a chart's selection stands for in each table its marks read: a
// condition on that table's fields, which a product forwards to its queries
// and a row view filters by (the `conditions` of `select` events), with the
// condition through derived tables. Made at once, as `select` reports, with
// state support. Where no condition says exactly which rows the selection
// holds (a lasso, a stack's tops, a summary's statistics, rows named by
// their identity), the table has none: a condition is never approximated.

import type { Expression } from "../data/expression.ts";
import { type SourceCondition, sourceOf } from "../data/lineage.ts";
import type { Table } from "../data/table.ts";
import type { Frame, Mark } from "../marks/mark.ts";
import { rowField } from "../marks/row-bindings.ts";
import type { BrushSelection, ChartSelection } from "../spec/state.ts";
import { any, itemCondition, viewed, within } from "./item-conditions.ts";
import type { ChartModel } from "./model.ts";
import type { SelectionOwner } from "./selected-rows.ts";

/** A selection's meaning on one table its marks read. */
export interface SelectionCondition {
  readonly table: Table;
  /** On `table`'s fields: true for the rows the selection holds. */
  readonly condition: Expression;
  /**
   * Where `table` is derived (or made from another), the condition written
   * on the table it comes from first of all; its condition is null where
   * none says those rows exactly.
   */
  readonly source?: SourceCondition | undefined;
}

const field = (name: string) => ["field", name] as const;

/**
 * The conditions of `selection` (owned by `owner`, for a brush) on each
 * table of the marks it covers: a brush's ranges on the fields its marks
 * place on the brushed axes, in the panels it is drawn in; items' names
 * (`itemKey` values, a bar's position and series, what an aggregate groups
 * by); series as their field's values.
 */
export function conditionsOf(
  model: ChartModel,
  selection: ChartSelection | null,
  owner: SelectionOwner | null,
): SelectionCondition[] {
  // Each table's conditions, by their text so a mark of several panels counts once; null where one cannot say.
  const found = new Map<Table, Map<string, Expression> | null>();
  const add = (mark: Mark | undefined, condition: Expression | null | undefined) => {
    const table = mark?.table;
    if (!table) return;
    const kept = found.get(table);
    if (condition == null || kept === null) found.set(table, null);
    else found.set(table, (kept ?? new Map()).set(JSON.stringify(condition), condition));
  };
  if (selection?.kind === "brush") {
    if (selection.lasso) return [];
    for (const key of owner?.panels ?? [])
      for (const { mark, frame } of model.inspectorOf(key)?.marks ?? [])
        add(mark, within(model, key, mark, brushed(mark, frame, selection)));
  } else if (selection) {
    const marks = model.config.marks as readonly Mark[];
    for (const key of selection.kind === "items" ? selection.items : selection.series) {
      let parts: unknown[];
      try {
        parts = JSON.parse(key as string);
      } catch {
        continue;
      }
      const owned = parts[0];
      const mark =
        typeof owned === "number" ? marks[owned] : marks.find((m) => m.spec.id === owned);
      add(
        mark,
        mark &&
          (selection.kind === "items"
            ? itemCondition(model, mark, key as string, parts)
            : viewed(mark, of(mark, parts[1]))),
      );
    }
  }
  return [...found].flatMap(([table, kept]) => {
    if (!kept) return [];
    const condition = any([...kept.values()]);
    const source = sourceOf(table, condition);
    return [source ? { table, condition, source } : { table, condition }];
  });
}

/** The rows of `mark` a brush's ranges hold: its fields' values in them along each brushed axis. */
function brushed(mark: Mark, frame: Frame, selection: BrushSelection): Expression | undefined {
  const parts: Expression[] = [];
  for (const axis of ["x", "y"] as const) {
    const range = selection[axis];
    if (!range) continue;
    const fields = rowField((mark.spec as unknown as Record<string, unknown>)[axis]);
    const values = axis !== (mark.tooltip === "y" ? "y" : "x");
    // Rows placed off the axis, a summary's statistics, and a stack's tops hold no field's values there.
    if (
      fields === undefined ||
      mark.bound ||
      (values && (mark.summarizes || (mark.spec as { stack?: unknown }).stack))
    )
      return undefined;
    const scale = frame[axis];
    const each: Expression[] = [];
    for (const name of [fields].flat()) {
      if (typeof name !== "string") return undefined;
      if (scale.type !== "band")
        each.push(["and", [">=", field(name), range[0]], ["<=", field(name), range[1]]]);
      // Categories by name; bands of numbers or times name no field's values.
      else if (mark.table?.kind(name) === "category")
        each.push(["in", field(name), ...(scale.categories ?? []).slice(range[0], range[1] + 1)]);
      else return undefined;
    }
    parts.push(any(each));
  }
  return parts.length === 1 ? parts[0] : ["and", ...parts];
}

/** The rows a series of `mark` named `source` holds: those of its value of the series field. */
function of(mark: Mark, source: unknown): Expression | undefined {
  const split = mark.identity?.field;
  return split !== undefined && typeof source === "string"
    ? ["==", field(split), source]
    : undefined;
}
