// Tables a spec's `data` makes from its tables: views of their rows,
// derived tables (`transform`), and row groups and totals, each loaded once
// what it is made from has (spec/load-with.ts loads tables of columns, and
// asks this for the others when a spec has some). Groups entries of one
// source, `by`, and `ops` share their groups, each entry a level's table.

import { deriveTable } from "../../data/derive.ts";
import { type GroupAggregate, RowGroups } from "../../data/groups.ts";
import { type RowView, rowView } from "../../data/row-view.ts";
import type { SelectionStore } from "../../data/selection.ts";
import type { Table } from "../../data/table.ts";
import { RowTotals } from "../../data/totals.ts";
import { within } from "../errors.ts";
import { names } from "../load-with.ts";
import type { DataSpec, DerivedSpec, GroupsSpec, TotalsSpec, ViewSpec } from "../spec.ts";

export { deriveTable, RowGroups, RowTotals, rowView };

/** An entry of `data` made from a table of it. */
export type MadeSpec = DerivedSpec | ViewSpec | GroupsSpec | TotalsSpec;

/** What the loader gives the entries made from tables (see load-with.ts). */
export interface DataLoading {
  readonly data: Record<string, DataSpec>;
  /** Tables given in place of entries (`LoadOptions.tables`). */
  readonly given: ReadonlyMap<string, Table> | undefined;
  readonly views: Map<string, RowView>;
  readonly tables: Map<string, Table>;
  /** Loads entry `name`, what it is made from first. */
  load(name: string): Table;
  /** Table `of`, as `at` names it, refusing a view. */
  tableAt(at: string, of: string): Table;
  /** The store of table `name`, which a view follows. */
  store(name: string, table: Table): SelectionStore;
}

/** How the entries of `data` made from tables load, with what loading gives them. */
export function madeTables({
  data,
  given,
  views,
  tables,
  load,
  tableAt,
  store: storeOf,
}: DataLoading): (name: string, entry: MadeSpec) => Table {
  const loading = new Set<string>();
  const entries = Object.entries(data);
  /** Groups by what they group (source, by, ops), and the names of their levels' tables. */
  const grouped = new Map<string, RowGroups>();
  const levelNames = new Map<string, Map<string, string>>();
  // Entries of one source, grouping, and aggregates share them, however their objects are written.
  const groupsKey = ({ source, groups }: GroupsSpec) =>
    JSON.stringify([
      source,
      groups.by,
      Object.entries(groups.ops ?? {})
        .map(([name, { op, field }]) => [name, op, field ?? null])
        .sort(([a], [b]) => (a! < b! ? -1 : 1)),
    ]);
  for (const [name, entry] of entries)
    if ("groups" in entry) {
      const named = levelNames.get(groupsKey(entry)) ?? new Map<string, string>();
      const level = entry.groups.level ?? entry.groups.by.at(-1)!;
      if (!named.has(level)) named.set(level, name);
      levelNames.set(groupsKey(entry), named);
    }
  /** Views of whole tables that groups and totals of a table read, one per table. */
  const whole = new Map<string, RowView>();
  /** The rows of `of`, a view or a table, as groups and totals read them. */
  const rowsAt = (at: string, of: string): RowView => {
    if (!Object.hasOwn(data, of))
      throw new Error(`${at}: no table "${of}" in data; name one of ${names(data)}`);
    load(of);
    const view = views.get(of);
    if (view) return view;
    const rows = whole.get(of) ?? rowView(tables.get(of)!);
    whole.set(of, rows);
    return rows;
  };
  return (name, entry) => {
    if ("view" in entry) {
      const known = views.get(name);
      if (known) return known.source;
      if (!Object.hasOwn(data, entry.source))
        throw new Error(
          `data.${name}.source: no table "${entry.source}" in data; name one of ${names(data)}`,
        );
      const of = tableAt(`data.${name}.source`, entry.source);
      const { selection, ...query } = entry.view;
      // Outside the view's errors: a binding's or a given store's say their own paths.
      const store = selection && storeOf(entry.source, of);
      try {
        views.set(
          name,
          rowView(of, {
            ...query,
            ...(selection && { selection: { ...selection, store } }),
          } as never),
        );
      } catch (error) {
        throw within(`data.${name}.view`, error);
      }
      return of;
    }
    if (loading.has(name))
      throw new Error(
        "transform" in entry
          ? `data.${name}.source: the table derives from itself; derive it from another`
          : `data.${name}.source: the table is made from itself; make it from another`,
      );
    loading.add(name);
    let made: Table;
    if ("groups" in entry) {
      const rows = rowsAt(`data.${name}.source`, entry.source);
      const { by, ops = {}, level = by.at(-1)! } = entry.groups;
      for (const [i, field] of by.entries())
        has(rows.source, field, `data.${name}.groups.by[${i}]`);
      fieldsOf(ops, rows.source, `data.${name}.groups.ops`);
      const key = groupsKey(entry);
      let groups = grouped.get(key);
      if (!groups) {
        try {
          groups = new RowGroups(
            rows,
            { by, ops: ops as Record<string, GroupAggregate> },
            undefined,
            `data.${name}.groups.ops`,
            levelNames.get(key),
          );
        } catch (error) {
          const { message } = error as Error;
          throw message.startsWith("data.") ? error : within(`data.${name}.groups.by`, error);
        }
        grouped.set(key, groups);
      }
      made = groups.tableOf(level);
      // The entries of the same groups are their levels' tables: known with this one, so a
      // binding naming an entry of the same level is known to name this table (`storesOf`).
      for (const [other, sibling] of entries)
        if ("groups" in sibling && other !== name && !tables.has(other) && !given?.has(other))
          if (groupsKey(sibling) === key)
            tables.set(other, groups.tableOf(sibling.groups.level ?? sibling.groups.by.at(-1)!));
    } else if ("totals" in entry) {
      const rows = rowsAt(`data.${name}.source`, entry.source);
      fieldsOf(entry.totals.ops, rows.source, `data.${name}.totals.ops`);
      made = new RowTotals(
        rows,
        { ops: entry.totals.ops as Record<string, GroupAggregate> },
        name,
        `data.${name}.totals.ops`,
      ).table;
    } else {
      if (!Object.hasOwn(data, entry.source))
        throw new Error(
          `data.${name}.source: no table "${entry.source}" in data; name one of ${names(data)}`,
        );
      const source = tableAt(`data.${name}.source`, entry.source);
      try {
        made = deriveTable(source, entry.transform, { name });
      } catch (error) {
        throw within(`data.${name}`, error);
      }
    }
    tables.set(name, made);
    return made;
  };
}

/** Refuses `field` where `table` lacks it, at `at`, as derived tables' steps do. */
function has(table: Table, field: string, at: string): void {
  if (!table.has(field))
    throw new Error(
      `${at}: no field "${field}"; the rows have ${table
        .fields()
        .map((f) => `"${f}"`)
        .join(", ")}`,
    );
}

/** Refuses the fields of groups' or totals' `ops` that `table` lacks. */
function fieldsOf(ops: Record<string, { field?: string }>, table: Table, at: string): void {
  for (const [name, { field }] of Object.entries(ops))
    if (field !== undefined) has(table, field, `${at}.${name}.field`);
}
