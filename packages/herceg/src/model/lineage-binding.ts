// Bindings through lineage: which bound store the rows a mark draws reach.
// A binding's store is of a table the chart draws, or of a table such a
// table comes from through what its producer recorded
// (data/contributor-records.ts: derived tables, row groups, totals,
// pivots): a bar of `byRegion.table` reaches a store of `sales`. Routes are
// found here for every binding by walking those records, which costs no
// code beyond the walk. What a route through lineage reads and draws
// (relations, coverage, budgets, bars' parts, contributors written as rows)
// is the lineage kit's (model/lineage-kit.ts), which a binding takes as
// `lineage` (`import { lineage } from "herceg"`): charts binding only the
// tables they draw load none of it.

import { contributorsOf } from "../data/contributor-records.ts";
import type { SelectionStore } from "../data/selection.ts";
import type { Table } from "../data/table.ts";
import type { LayoutMark } from "../marks/layout-mark.ts";
import type { Mark, MarkKey } from "../marks/mark.ts";
import { ChartError } from "../spec/errors.ts";
import type { LineageKit, LineageRoute } from "./lineage-kit.ts";

declare const LINEAGE: unique symbol;

/**
 * The lineage reader, which a binding through lineage takes:
 * `rowSelection({ store, channel, lineage })` with `import { lineage }
 * from "herceg"`. Bindings of the tables their charts draw need none.
 */
export interface SelectionLineage {
  readonly [LINEAGE]: true;
}

/** What routes are found for: a bound store's channel and its options. */
export interface RouteBinding {
  readonly store: SelectionStore;
  readonly table: Table;
  readonly channel: string;
  readonly lineage: SelectionLineage | undefined;
  readonly budget: number | undefined;
  /** The binding's path, as messages name it. */
  readonly at: string;
  /** Whether no option gives it another budget than the default (a grid's). */
  readonly fixed?: boolean;
}

/** A mark reading a table, as routes name it: "bar (mark 0)". */
export interface Reader {
  readonly table: Table;
  readonly mark: Mark | LayoutMark;
  readonly name: string;
  /** The mark's key in the chart, which its series' and items' keys start with. */
  readonly key: MarkKey;
}

/** How the rows of a table the chart draws reach a bound store: its own, or an ancestor's through lineage. */
export interface Route<B extends RouteBinding = RouteBinding> {
  readonly bound: B;
  /** For a table the bound one is an ancestor of: what the kit made of their relation. */
  readonly through: LineageRoute | undefined;
}

/** A chart's routes, by each table its marks read that reaches a binding. */
export type Resolution<B extends RouteBinding = RouteBinding> = ReadonlyMap<Table, Route<B>>;

/** The lineage kit a binding was given, as it is at run time. */
export function kitOf(bound: RouteBinding | undefined): LineageKit | undefined {
  return bound?.lineage as unknown as LineageKit | undefined;
}

/** Tables whose rows reach one of `bindings` in `resolution`. */
export function tablesOf<B extends RouteBinding>(
  resolution: Resolution<B>,
  bindings: readonly B[],
): Set<Table> {
  const tables = new Set<Table>();
  for (const [table, route] of resolution) if (bindings.includes(route.bound)) tables.add(table);
  return tables;
}

/** A table as messages name it: its name, or what it is. */
export function named(table: Table, otherwise = "its table"): string {
  return table.name === undefined ? otherwise : JSON.stringify(table.name);
}

/**
 * The routes of `readers`' tables to `bindings`: each table to the one
 * binding of itself or of a table it comes from. Refuses a route through
 * lineage of a binding without the reader, and a binding no table reaches;
 * the kit refuses a table reaching two bindings and what passes a budget.
 */
export function resolve<B extends RouteBinding>(
  bindings: readonly B[],
  readers: readonly Reader[],
): Resolution<B> {
  const routes = new Map<Table, Route<B>>();
  for (const reader of readers) {
    const target = reader.table;
    if (routes.has(target)) continue;
    // The bindings of the table and of every table it comes from, nearest first.
    const reached: B[] = [];
    let steps = 0;
    for (let at: Table | undefined = target; at && steps++ < 64; at = contributorsOf(at)?.source) {
      const bound = bindings.find((b) => b.table === at);
      if (bound) reached.push(bound);
    }
    const [bound, other] = reached;
    if (!bound) continue;
    const kit = kitOf(bound) ?? kitOf(other);
    const through = other ?? (bound.table !== target ? bound : undefined);
    if (through && !kit)
      throw new ChartError({
        code: "invalid-option",
        path: `${through.at}.lineage`,
        message: `rowSelection lineage: ${reader.name} reads ${named(target)}, which comes from ${named(through.table)}; give rowSelection({ store, channel, lineage }), with import { lineage } from "herceg"`,
      });
    if (other) kit!.ambiguous(reader, bound.table, other.table);
    const readersOf = readers.filter((r) => r.table === target);
    routes.set(target, {
      bound,
      through: bound.table === target ? undefined : kit!.route(target, bound, readersOf),
    });
  }
  for (const bound of bindings) {
    if ([...routes.values()].some((route) => route.bound === bound)) continue;
    // Named tables say which no lineage connects.
    const reader = readers.find(({ table }) => table.name !== undefined);
    if (reader && bound.table.name !== undefined)
      throw new ChartError({
        code: "invalid-option",
        path: "rowSelection",
        message: `rowSelection store: ${reader.name} reads ${named(reader.table)}, whose rows no lineage connects to ${named(bound.table)}; bind a store of ${named(reader.table)} (channel "${bound.channel}")`,
      });
    throw new ChartError({
      code: "invalid-option",
      path: "rowSelection",
      message: `rowSelection store: no mark reads its table (channel "${bound.channel}"); bind a table the chart draws`,
    });
  }
  // What every route of a binding builds, within its budget.
  for (const bound of bindings) {
    const made = [...routes.values()].flatMap((route) =>
      route.bound === bound && route.through ? [route.through] : [],
    );
    if (made.length > 0) kitOf(bound)!.admit(made, bound);
  }
  return routes;
}
