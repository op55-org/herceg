// Row selection in specs: the stores of tables' selected rows, which views
// follow and bindings write, one per table and seeded by what the bindings
// naming it hold (`selection`), and the bindings of a spec's `rowSelection`
// (spec/load-with.ts asks for them when a spec has some).

import { RowSet } from "../../data/row-set.ts";
import type { RowView } from "../../data/row-view.ts";
import {
  type DataSelection,
  type SelectionStore,
  selectionStore,
  selectRows,
  selectWhere,
} from "../../data/selection.ts";
import type { Table } from "../../data/table.ts";
import { tablesOf } from "../../marks/layout-mark.ts";
import type { ChartMark } from "../../marks/mark.ts";
import type { SelectionLineage } from "../../model/lineage-binding.ts";
import { type RowSelection, rowSelection } from "../../model/row-selection.ts";
import { within } from "../errors.ts";
import { binary, nameOf, names, type SpecBuffer } from "../load-with.ts";
import type { RowSelectionSpec, SelectionSpec } from "../spec.ts";

/**
 * A spec's tables' selection stores, one per table, whatever names name it
 * (tables given twice, entries sharing a groups' level table): the one
 * given for any of its names, or one made and given at once what the
 * bindings naming the table hold (`selection`), so views following them
 * and their groups start from it. `tableNamed` gives the tables loaded so
 * far and those given. A binding that names no table is given its table's
 * store, and seeds a store made, once its table is found from the marks:
 * then only views no mark draws can have been made before it.
 */
export function storesOf(
  bindings: readonly RowSelectionSpec[],
  listed: boolean,
  given: ReadonlyMap<string, SelectionStore> | undefined,
  buffers: readonly SpecBuffer[],
  tableNamed: (name: string) => Table | undefined,
) {
  const made = new Map<string, SelectionStore>();
  const byTable = new Map<Table, SelectionStore>();
  /** The store given for a name of `table`; two given for its names must be one. */
  const givenFor = (table: Table) => {
    const of = given ? [...given].filter(([, store]) => store.source === table) : [];
    const other = of.find(([, store]) => store !== of[0]![1]);
    if (other)
      throw new Error(
        `stores.${other[0]}: "${other[0]}" and "${of[0]![0]}" name one table, and their stores given differ; give them one store`,
      );
    return of[0]?.[1];
  };
  const own = new Set<SelectionStore>();
  const seeded = new Set<number>();
  const seed = (store: SelectionStore, table: Table, i: number) => {
    const { channel, selection: spec } = bindings[i]!;
    if (!own.has(store) || seeded.has(i) || !spec) return;
    seeded.add(i);
    const at = `${listed ? `rowSelection[${i}]` : "rowSelection"}.selection`;
    const held = loadSelection(spec, table, buffers, at);
    try {
      store.set(channel, held);
    } catch (error) {
      // A condition of fields the table lacks, or not true or false.
      throw within(`${at}.expression`, error);
    }
  };
  return {
    made,
    /** Table `name`'s store, seeded by the bindings naming it, and by binding `found`, whose table it is. */
    of(name: string, table: Table, found?: number): SelectionStore {
      let store = made.get(name);
      if (!store) {
        const offered = given?.get(name);
        if (offered && offered.source !== table)
          throw new Error(
            `stores.${name}: the store given is of another table; give a store of table "${name}"`,
          );
        store = byTable.get(table) ?? givenFor(table);
        if (!store) {
          store = selectionStore(table);
          own.add(store);
        }
        made.set(name, store);
        byTable.set(table, store);
      }
      bindings.forEach(({ data }, i) => {
        const named = data === name || (data !== undefined && tableNamed(data) === table);
        if (named || i === found) seed(store!, table, i);
      });
      return store;
    },
  };
}

export type Stores = ReturnType<typeof storesOf>;

/**
 * A spec's row selection, its bindings' tables resolved by name (or, left
 * out, the one table the marks read) and their stores taken from `stores`;
 * `lineage` is the reader bindings take for marks of tables made from theirs.
 */
export function loadRowSelection(
  bindings: readonly RowSelectionSpec[],
  listed: boolean,
  tables: ReadonlyMap<string, Table>,
  views: ReadonlyMap<string, RowView>,
  marks: readonly ChartMark[],
  stores: Stores,
  lineage: SelectionLineage | undefined,
): RowSelection {
  const read = [...new Set(marks.flatMap((mark) => tablesOf(mark)))];
  return rowSelection(
    ...bindings.map(({ data, channel, events, effect, live, budget }, i) => {
      const path = listed ? `rowSelection[${i}]` : "rowSelection";
      let name = data;
      if (name === undefined) {
        if (read.length !== 1)
          throw new Error(`${path}.data: missing; the marks read several tables, so name one`);
        name = [...tables].find(([, table]) => table === read[0])?.[0];
      }
      const table = name === undefined ? undefined : tables.get(name);
      const view = name === undefined ? undefined : views.get(name);
      if (view)
        throw new Error(
          `${path}.data: "${name}" is a view of "${nameOf(view.source, tables)}"; bind the store of "${nameOf(view.source, tables)}"`,
        );
      if (!table)
        throw new Error(
          `${path}.data: no table ${JSON.stringify(name)} in data; name one of ${names(tables)}`,
        );
      const store = stores.of(name!, table, i);
      // Marks of tables derived from the bound one highlight it through lineage.
      return {
        store,
        channel,
        ...(lineage && { lineage }),
        budget,
        ...(events && { events }),
        ...(effect && { effect }),
        ...(live !== undefined && { live }),
      };
    }),
  );
}

/** A spec's selection of `table`'s rows: its condition, or its rows by position. */
function loadSelection(
  spec: SelectionSpec,
  table: Table,
  buffers: readonly SpecBuffer[],
  path: string,
): DataSelection {
  if (spec.kind === "predicate") return selectWhere(spec.expression);
  const positions =
    typeof spec.rows === "number" ? binary("uint32", spec.rows, buffers) : spec.rows;
  for (let i = 0; i < positions.length; i++) {
    const row = positions[i]!;
    if (!(Number.isInteger(row) && row >= 0 && row < table.length))
      throw new RangeError(
        `${path}.rows[${i}]: expected a position among the table's ${table.length} rows; received ${row}`,
      );
  }
  return selectRows(new RowSet(table).addAll(positions));
}
