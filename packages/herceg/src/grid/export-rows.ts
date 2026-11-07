// What exports (export.ts) and copy (dom/grid.ts) read of grid models,
// through members keyed by symbols no public entry exports, so models have
// no public method of theirs: small accessors, while the reading itself
// (export-local.ts, remote-export.ts) loads only with `exportGrid`.

import type { RowSnapshot, RowView } from "../data/row-view.ts";
import type { Table } from "../data/table.ts";
import type { TotalsSource } from "./base.ts";
import type { FormatSettings, PlacedColumn } from "./columns.ts";
import type { Projection } from "./grouped.ts";
import type { GridPivot } from "./model.ts";

/** A model's columns' contents by id, hidden ones' too, for exports naming columns. */
export const CONTENTS: unique symbol = Symbol("herceg grid contents");
/** What an export reads of a model (see `LocalRows`, `ReadRequest`). */
export const EXPORT_ROWS: unique symbol = Symbol("herceg grid export");
/** The selected rows copy writes (see `CopiedRows`). */
export const COPY_ROWS: unique symbol = Symbol("herceg grid copy");

/** What an export asks a model for. */
export interface ReadRequest {
  /**
   * The rows the grid lists ("shown": group rows and the rows of expanded
   * groups, in the order shown), the view's records in its order without
   * group rows ("records"), or the selected records among them ("selected").
   */
  readonly rows: "shown" | "records" | "selected";
  readonly columns: readonly PlacedColumn[];
  /** Raw values by their kind, in place of the text cells show. */
  readonly raw: boolean;
  /** Whether to read the totals row. */
  readonly totals: boolean;
  /** Who asks, in messages. */
  readonly at: string;
}

/**
 * What a local model (or a pivot's) gives an export: what it shows now,
 * which the export's reader (export-local.ts) captures as it starts.
 */
export interface LocalRows {
  readonly table: Table;
  readonly view: RowView;
  readonly snapshot: RowSnapshot;
  /** The groups as shown (a pivot's rows), or null. */
  readonly grouped: Projection | null;
  /** Rows the grid shows. */
  readonly length: number;
  readonly pivot: GridPivot | null;
  readonly settings: FormatSettings;
  readonly layout: readonly PlacedColumn[];
  readonly totals: TotalsSource | null;
  /** The selected records the view shows (see `GridModel`'s selection), or null with none selected. */
  selected(limit: number): Uint32Array | null;
}

/** The rows a model gives, read in order from the state they were asked in. */
export interface RowsRead {
  /** How many rows there are to read, where known. */
  readonly total: number | null;
  /** The totals row's cells, read as the rows were asked for; null without one. */
  readonly totals: { readonly cells: readonly string[]; readonly plain: Uint8Array } | null;
  /**
   * Reads the next row into `cells` (each column's text, or raw value as
   * written) and `plain` (1 where a cell is a raw number or time, which
   * formula escaping spares): true, or false past the last row; a promise
   * of either while the row loads.
   */
  next(cells: string[], plain: Uint8Array): boolean | Promise<boolean>;
  /** Throws a `GridExportError` where what the rows are read from changed since they were asked for. */
  check(): void;
  /** Lets go of what the read holds (a remote snapshot). */
  close(): void;
}

/**
 * What a model gives copy (`[COPY_ROWS](columns, limit)`): each selected
 * row's texts (`total` past `limit` refuses the copy), null where nothing
 * is selected (the focused cell is copied), or why it copies no rows.
 */
export type CopiedRows = { readonly total: number; next(cells: string[]): boolean } | string | null;
