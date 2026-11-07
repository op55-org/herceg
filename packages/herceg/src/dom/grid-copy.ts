// Copy in a grid (dom/grid.ts): Ctrl+C or Cmd+C (or the browser's Copy)
// while the grid holds the page's focus writes, in the `copy` event, the
// selected rows or else the focused cell, as TSV that spreadsheets paste,
// within limits. The model says which rows and what their cells say, as
// exports read them (grid/export-rows.ts).

import type { BaseGridModel } from "../grid/base.ts";
import type { PlacedColumn } from "../grid/columns.ts";
import { fieldWriter } from "../grid/delimited.ts";
import { COPY_ROWS } from "../grid/export-rows.ts";

/**
 * What Ctrl+C (Cmd+C) copies at most (100,000 cells and 10 MiB of UTF-8
 * by default), and whether it escapes formulas as exports do (true by
 * default); false leaves the key to the page.
 */
export type GridCopyOptions =
  | false
  | {
      readonly maxCells?: number | undefined;
      readonly maxBytes?: number | undefined;
      readonly escapeFormulas?: boolean | undefined;
    };

/** Copy's settings, checked. */
export interface CopySettings {
  readonly maxCells: number;
  readonly maxBytes: number;
  readonly escapeFormulas: boolean;
}

const TOO_MANY = "Too many cells to copy; export the grid instead";

/** `given` checked (named `at` in messages), with defaults; null for no copy. */
export function copySettings(given: GridCopyOptions | undefined, at: string): CopySettings | null {
  if (given === false) return null;
  if (given !== undefined && (typeof given !== "object" || given === null))
    throw new TypeError(
      `${at} copy: expected false or { maxCells, maxBytes, escapeFormulas }; received ${JSON.stringify(given)}`,
    );
  const {
    maxCells = 100_000,
    maxBytes = 10 * 2 ** 20,
    escapeFormulas = true,
    ...rest
  } = given ?? {};
  for (const key of Object.keys(rest))
    throw new Error(`${at} copy.${key}: unknown option; use maxCells, maxBytes, or escapeFormulas`);
  for (const [name, value] of [
    ["maxCells", maxCells],
    ["maxBytes", maxBytes],
  ] as const)
    if (!(Number.isInteger(value) && value > 0))
      throw new RangeError(
        `${at} copy.${name}: expected a positive whole number; received ${value}`,
      );
  if (typeof escapeFormulas !== "boolean")
    throw new TypeError(
      `${at} copy.escapeFormulas: expected true or false; received ${JSON.stringify(escapeFormulas)}`,
    );
  return { maxCells, maxBytes, escapeFormulas };
}

/**
 * What copy writes of `model` now, as `settings` say, and what the grid
 * says of it: the selected records the view shows (shown columns, text,
 * no header), or with none selected the focused cell's text; nothing past
 * the limits, of rows a remote grid has not loaded, or of a pivot's rows.
 */
export function copied(
  model: BaseGridModel,
  { maxCells, maxBytes, escapeFormulas }: CopySettings,
): { text?: string; say: string } {
  const columns = (model.columnLayout as readonly PlacedColumn[]).filter(
    ({ content }) => !content.textless,
  );
  const field = fieldWriter("\t", escapeFormulas, model.locale);
  // UTF-8 takes at least a byte a code unit, and at most three.
  const fits = (text: string) =>
    text.length <= maxBytes &&
    (text.length * 3 <= maxBytes || new TextEncoder().encode(text).length <= maxBytes);
  const limit = Math.floor(maxCells / Math.max(1, columns.length));
  const rows = columns.length > 0 ? model[COPY_ROWS](columns, limit) : null;
  if (typeof rows === "string") return { say: rows };
  if (rows) {
    const count = rows.total;
    if (count === 0) return { say: "No selected rows in this view" };
    if (count > limit) return { say: TOO_MANY };
    const cells = columns.map(() => "");
    let text = "";
    for (let row = 0; rows.next(cells); row++) {
      if (row > 0) text += "\r\n";
      text += cells.map((cell) => field(cell, false)).join("\t");
      if (text.length > maxBytes) return { say: TOO_MANY };
    }
    if (!fits(text)) return { say: TOO_MANY };
    return { text, say: count === 1 ? "Copied 1 row" : `Copied ${count} rows` };
  }
  const focus = model.focus;
  if (!focus) return { say: "Nothing to copy" };
  const { rowIndex, columnIndex } = focus;
  const column = model.columnLayout[columnIndex] as PlacedColumn;
  let text: string;
  if (rowIndex < 0) text = column.title;
  else if (column.content.textless) return { say: "The cell has no text to copy" };
  else {
    const totals = rowIndex === model.rowCount ? model.totalsRow : null;
    const cell = totals ? totals.cellAt(columnIndex) : model.cellAt(rowIndex, columnIndex);
    if (cell.state === "loading") return { say: "The cell is still loading" };
    if (cell.state === "failed") return { say: "The cell could not load" };
    text = cell.text;
  }
  text = field(text, false);
  if (!fits(text)) return { say: TOO_MANY };
  return { text, say: rowIndex < 0 ? "Copied column heading" : "Copied cell" };
}
