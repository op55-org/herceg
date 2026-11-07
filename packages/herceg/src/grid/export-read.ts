// What the readers of exports (export-local.ts, remote-export.ts) share:
// how a read fails, how raw values and the totals row are written. Kept
// apart from the models' accessors (export-rows.ts), so that it loads only
// with what exports.

import { NO_TOTAL, TOTAL, type TotalsSource } from "./base.ts";
import type { PlacedColumn } from "./columns.ts";

/** Why an export failed: its rows changed under it, or a remote source dropped its snapshot. */
export class GridExportError extends Error {
  readonly code: "view-changed" | "snapshot-expired";

  constructor(code: GridExportError["code"], message: string) {
    super(message);
    this.name = "GridExportError";
    this.code = code;
  }
}

/** The export failure for rows that changed, by who read them. */
export function rowsChanged(at: string): GridExportError {
  return new GridExportError(
    "view-changed",
    `${at}: the grid's rows changed while exporting (the table was reset, rows were dropped or written, or the view changed); export again`,
  );
}

/**
 * What fails a read when the data a sparkline column of `columns`
 * summarizes changes (its table written to, its view's query changed): a
 * sparkline over the grid's own table too, whose summaries appends change.
 */
export function summariesOf(columns: readonly PlacedColumn[], at: string): () => void {
  const followed = columns.flatMap(({ id, content: { sparkline } }) =>
    sparkline ? [{ id, sparkline, revision: sparkline.revision }] : [],
  );
  return () => {
    for (const { id, sparkline, revision } of followed) {
      if (sparkline.revision === revision) continue;
      // A view's data is named by its table.
      const data = sparkline.data as {
        readonly source?: { name?: string };
        readonly name?: string;
      };
      const { name } = data.source ?? data;
      throw new GridExportError(
        "view-changed",
        `${at}: column ${JSON.stringify(id)} summarizes ${name === undefined ? "its data" : JSON.stringify(name)}, which changed while exporting; export again, or leave the column out`,
      );
    }
  };
}

/**
 * Writes a raw value into cell `c`: a number as JavaScript writes it, a
 * time as ISO 8601 in UTC, a label as it is, missing values (null, NaN,
 * times past the ends of dates) empty.
 */
export function rawCell(
  cells: string[],
  plain: Uint8Array,
  c: number,
  value: number | string | null | undefined,
  kind: "number" | "time" | "category" | null,
): void {
  const number = typeof value === "number" && kind !== "category";
  const missing =
    value === null ||
    value === undefined ||
    (number && (kind === "time" ? !(Math.abs(value) <= 8.64e15) : Number.isNaN(value)));
  cells[c] = missing
    ? ""
    : kind === "time"
      ? new Date(value as number).toISOString()
      : String(value);
  plain[c] = !missing && number ? 1 : 0;
}

/**
 * The cells of a totals row read by `of`, for `columns` as they are now:
 * each total's text (or raw value), and "Total" in the first column
 * without one. Exports keep them, so they say what the rows exported do.
 */
export function totalsCells(
  of: Pick<TotalsSource, "writer" | "read">,
  columns: readonly PlacedColumn[],
  raw: boolean,
): { cells: string[]; plain: Uint8Array } {
  const cells: string[] = [];
  const plain = new Uint8Array(columns.length);
  const writers = columns.map((column) => of.writer(column));
  const label = writers.indexOf(null);
  columns.forEach((column, c) => {
    const write = writers[c];
    const { value, kind } = write ? of.read(column) : NO_TOTAL;
    if (c === label) cells[c] = TOTAL;
    else if (raw) rawCell(cells, plain, c, value, kind);
    else cells[c] = write && kind ? write((value as number | null) ?? Number.NaN) : "";
  });
  return { cells, plain };
}
