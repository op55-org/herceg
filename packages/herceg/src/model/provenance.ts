// What one item stands for in its data, for clicks (`ItemTarget.provenance`
// and `rows()`): what it groups by, the condition its rows meet on its
// mark's table (model/item-conditions.ts, as selections name items), that
// condition through derived tables, and its rows kept by identity. Where no
// condition says exactly which rows an item stands for (a row named by its
// identity, a restricted view, a rolling window), there is none: a
// condition is never approximated. It loads with picking, so it imports no
// code charts' first chunks hold.

import type { Expression } from "../data/expression.ts";
import { type SourceCondition, sourceOf } from "../data/lineage.ts";
import type { Table } from "../data/table.ts";
import type { Mark } from "../marks/mark.ts";
import type { Series } from "../marks/series.ts";
import { facetsOf, groupsOf, itemCondition } from "./item-conditions.ts";
import type { ItemResolver, ProvenanceGroup } from "./items.ts";
import type { ChartModel } from "./model.ts";
import { pointRows } from "./point-rows.ts";

export type { SourceCondition } from "../data/lineage.ts";
export type { ProvenanceGroup } from "./items.ts";

/**
 * What an item stands for in its data: what it groups by and its rows'
 * condition on its mark's table, and that condition written on the table
 * the mark's table was derived from.
 */
export interface Provenance {
  /**
   * What it groups by, on its mark's table: its position's category or
   * bin, its series' value, a node's path, its `itemKey` value, its facet
   * panel's values, and what rows need to count (a finite value, a usable
   * weight, a positive value); `time` on time fields. With the view's
   * filter, they say its rows exactly. Empty where no groups say them: a
   * row named by its identity, a Sankey node.
   */
  readonly groups: readonly ProvenanceGroup[];
  /** Exactly its rows of the mark's table, within its view's filter; null where no condition says them. */
  readonly condition: Expression | null;
  /** Through derived tables, on the table they come from; undefined where the mark's table is not derived. */
  readonly source: SourceCondition | undefined;
}

/**
 * What the item keyed `key` of `mark`, drawn in panel `panel`, stands for
 * (see `Provenance`): built for a click, as it is captured.
 */
export function provenanceOf(
  model: ChartModel,
  mark: Mark,
  key: string,
  panel: string,
): Provenance {
  const table = mark.table;
  const parts = JSON.parse(key) as unknown[];
  const condition = itemCondition(model, mark, key, parts, panel) ?? null;
  const own = groupsOf(mark, key, parts);
  return {
    groups: own ? [...own, ...facetsOf(model, panel, mark)].map((g) => timed(table, g)) : [],
    condition,
    source: table && sourceOf(table, condition),
  };
}

/** The epoch milliseconds a `Date` holds, either side of 1970. */
const DATES = 8.64e15;

/**
 * `group`, marked `time` where its field holds times and its values are
 * dates (not the bounds of every finite value), as the table is now: so
 * events written later say what was clicked.
 */
function timed(table: Table | undefined, group: ProvenanceGroup): ProvenanceGroup {
  if (!table?.has(group.field) || table.kind(group.field) !== "time") return group;
  const values = "value" in group ? [group.value] : [group.from, group.to];
  return values.every((v) => v === null || Math.abs(v as number) <= DATES)
    ? { ...group, time: true }
    : group;
}

/** Rows of a table, as an item's target reads them (`ItemTarget.rows`). */
export interface ItemRows {
  readonly table: Table;
  /** Positions in the table now, ascending. */
  readonly positions: Uint32Array;
}

/**
 * The rows of its table the item keyed `key` of `mark`, drawn in panel
 * `panel`, stands for (see `ItemTarget.rows`), kept by identity from now.
 * `picked` says what was picked: an aggregate's or a cell's point, whose
 * rows are those clicks select; "group" for a layout's item, whose rows
 * its items drawn give (a sector a drill leaves too), of whichever of the
 * mark's tables holds it (a network's nodes have their own); undefined for
 * a row's item, named by its key (`items`) with the panel's facet values.
 */
export function rowsOfItem(
  model: ChartModel,
  items: ItemResolver,
  mark: Mark,
  key: string,
  panel: string,
  picked?: { readonly series: Series; readonly position: number } | "group",
): (() => ItemRows) | undefined {
  const table = mark.table;
  if (!table) return undefined;
  if (picked === "group") {
    const owner = (JSON.parse(key) as unknown[])[0];
    if (model.drawnMarks().some((d) => d.layout && d.mark === owner && d.panel === panel)) {
      const others = (mark as { otherTables?: readonly Table[] }).otherTables ?? [];
      for (const of of [table, ...others]) {
        const rows = model.items?.rowsAt(key, of, panel);
        if (rows) return keptRows(of, rows);
      }
      return keptRows(table, []);
    }
  }
  const drawn = picked && picked !== "group" && model.panels().find(({ key }) => key === panel);
  if (drawn) {
    const { series, position } = picked as { series: Series; position: number };
    return keptRows(table, pointRows(model, mark, series, position, drawn));
  }
  const facets = facetsOf(model, panel, mark);
  return keptRows(
    table,
    items
      .rowsOf(key, table)
      .filter((row) => facets.every((f) => "value" in f && table.value(f.field, row) === f.value)),
  );
}

/**
 * `positions` of `table`, kept by their identities and read when asked, in
 * ascending order: rows dropped since are left out, and none survive a
 * reset.
 */
function keptRows(table: Table, positions: ArrayLike<number>): () => ItemRows {
  const generation = table.generation;
  const kept = Float64Array.from(positions, (position) => table.identity(position));
  return () => {
    const found: number[] = [];
    if (table.generation === generation) {
      // An ordered table finds an identity by a scan: one for all of them.
      if ("changedFrom" in table) {
        const wanted = new Set(kept);
        for (let p = 0; p < table.length; p++) if (wanted.has(table.identity(p))) found.push(p);
      } else
        for (const identity of kept) {
          const position = table.positionOf(identity, generation);
          if (position >= 0) found.push(position);
        }
    }
    return { table, positions: Uint32Array.from(found).sort() };
  };
}
