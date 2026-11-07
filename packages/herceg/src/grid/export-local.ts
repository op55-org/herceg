// Reading a local grid's rows for an export (export.ts): its rows (or a
// pivot's) as they are when the export starts, captured then (positions in
// the view's order, 4 bytes a row, or the groups as shown, and the
// totals), and checked between chunks against the table, the view, the
// groups, and every table a sparkline column summarizes.

import { untold, writesOf } from "../data/table.ts";
import { cellText, type PlacedColumn } from "./columns.ts";
import { rawCell, rowsChanged, summariesOf, totalsCells } from "./export-read.ts";
import type { LocalRows, ReadRequest, RowsRead } from "./export-rows.ts";
import { groupCell, headerTexts } from "./grouped.ts";

/** The rows `state` shows, as `request` asks for them. */
export function readLocal(
  state: LocalRows,
  { rows, columns, raw, totals, at }: ReadRequest,
): RowsRead {
  const { table, view, pivot, snapshot, layout } = state;
  if (pivot && rows !== "shown")
    throw new Error(
      `${at} rows: a pivot grid exports the rows it shows, not its records or selection; give rows: "shown"`,
    );
  // Its groups and totals follow the rows once the transaction ends.
  if (untold(table))
    throw new Error(
      `${at}: the grid's table is in a transaction that has written to it; export once the transaction ends`,
    );
  const grouped = rows === "shown" ? state.grouped : null;
  // Records in the view's order: positions, or every row of the table in order without them.
  const positions =
    rows === "selected"
      ? (state.selected(Number.POSITIVE_INFINITY) ?? new Uint32Array(0))
      : grouped
        ? undefined
        : snapshot.indices?.slice();
  const length = positions?.length ?? (grouped ? state.length : snapshot.length);
  const records = columns.map((column) => recordWriter(table, column, raw));
  const groups = grouped && !pivot ? grouped.groups : null;
  const texts = groups && !raw ? headerTexts(groups, layout, state.settings, table, columns) : [];
  const label = layout[0]?.id;
  const headers = columns.map(
    (column, c) => (cells: string[], plain: Uint8Array, group: number, depth: number) => {
      if (!raw && !pivot) {
        cells[c] = texts[c]!(group, depth);
        plain[c] = 0;
        return;
      }
      const { value, kind } = pivot
        ? pivot.read(column.id, group)
        : groupCell(groups!, table, group, depth, column, column.id === label);
      if (raw) rawCell(cells, plain, c, value, kind);
      else {
        cells[c] = column.content.text(pivot!.rows, group);
        plain[c] = 0;
      }
    },
  );
  // The state read: appends leave records read to go on, which they neither move nor change.
  const stamp = {
    generation: table.generation,
    offset: table.rowOffset,
    modified: table.modifiedVersion,
    writes: writesOf(table),
    query: view.queryRevision,
    groups: grouped?.groups.revision,
    pivot: pivot?.revision,
  };

  const summaries = summariesOf(columns, at);
  let row = 0;
  let header = 0;
  return {
    total: length,
    totals: totals && state.totals ? totalsCells(state.totals, columns, raw) : null,
    next(cells, plain) {
      if (row >= length) return false;
      if (grouped) {
        const { starts, count, heads, depths } = grouped;
        while (header + 1 < count && starts[header + 1]! <= row) header++;
        const group = heads[header]!;
        const offset = row - starts[header]!;
        if (offset === 0)
          for (let c = 0; c < columns.length; c++)
            headers[c]!(cells, plain, group, depths[header]!);
        else {
          const position = grouped.groups.memberAt(group, offset - 1);
          for (let c = 0; c < columns.length; c++) records[c]!(cells, plain, c, position);
        }
      } else {
        const position = positions ? positions[row]! : row;
        for (let c = 0; c < columns.length; c++) records[c]!(cells, plain, c, position);
      }
      row++;
      return true;
    },
    check() {
      if (
        table.generation !== stamp.generation ||
        table.rowOffset !== stamp.offset ||
        view.queryRevision !== stamp.query ||
        (writesOf(table) !== stamp.writes &&
          (grouped || table.modifiedVersion !== stamp.modified)) ||
        (grouped && grouped.groups.revision !== stamp.groups) ||
        (pivot && pivot.revision !== stamp.pivot)
      )
        throw rowsChanged(at);
      summaries();
    },
    close() {},
  };
}

/**
 * What writes `column`'s cell of the table's row at a position: its text
 * (a link's where linked), or its raw value by kind.
 */
function recordWriter(
  table: LocalRows["table"],
  { field, kind, content }: PlacedColumn,
  raw: boolean,
): (cells: string[], plain: Uint8Array, c: number, position: number) => void {
  if (raw && field !== null)
    return (cells, plain, c, position) =>
      rawCell(
        cells,
        plain,
        c,
        table.value(field as never, position) as number | string | null,
        kind,
      );
  return (cells, plain, c, position) => {
    cells[c] = cellText(content, table, position);
    plain[c] = 0;
  };
}
