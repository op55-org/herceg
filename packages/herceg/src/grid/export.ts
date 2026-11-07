// Export of what a grid shows (`exportGrid`): its rows as CSV or TSV, read
// through the model's own reader (export-rows.ts) from one state of its
// rows, in chunks of about 8 ms that yield to the page. The model says
// which rows and what each cell holds; this writes them.

import type { BaseGridModel, Column } from "./base.ts";
import type { ColumnContent, PlacedColumn } from "./columns.ts";
import { fieldWriter } from "./delimited.ts";
import { readLocal } from "./export-local.ts";
import { CONTENTS, EXPORT_ROWS, type RowsRead } from "./export-rows.ts";
import type { GridModel } from "./model.ts";
import type { PivotGridModel } from "./pivot.ts";
import type { RemoteGridModel } from "./remote.ts";

export { GridExportError } from "./export-read.ts";

/** What `exportGrid` writes, and how. */
export interface GridExportOptions {
  /** "csv" (the default), or "tsv". */
  format?: "csv" | "tsv";
  /**
   * The text cells show ("text", the default: formats, mappings, missing
   * text, links' text), or raw values by their kind ("raw"): numbers as
   * JavaScript writes them, times in ISO 8601 UTC, categories' labels,
   * missing values empty. A count on a group row is a number, in a time
   * column too; columns without a field write their text.
   */
  values?: "text" | "raw";
  /**
   * The rows the grid lists ("shown", the default): group rows as written
   * and the rows of expanded groups, in the order shown; the view's records
   * alone, in its order, collapsed groups' too ("records"); or the selected
   * records among them, in that order ("selected"). Pivot and remote grids
   * export the rows they show.
   */
  rows?: "shown" | "records" | "selected";
  /**
   * The shown columns in their order ("shown", the default; columns without
   * a field and without text left out), or columns by id, hidden ones too.
   */
  columns?: "shown" | readonly string[];
  /** A header line of titles after their headings ("Latency, p99"; true or "titles", the default), of ids, or none. */
  headers?: boolean | "titles" | "ids";
  /**
   * The totals row, last: by default where the grid shows one and `rows`
   * is "shown"; with "records" too when asked for, never with "selected".
   */
  totals?: boolean;
  /**
   * Writes text starting with =, +, -, @, a tab, or a line break after a
   * `'`, so spreadsheets read it as text rather than run it, unless it is
   * wholly a number as the grid's locale writes one ("-1,204", "+3.5%");
   * raw numbers and times are never escaped. True by default.
   */
  escapeFormulas?: boolean;
  /** A byte order mark first, which Excel needs to read UTF-8; false by default. */
  bom?: boolean;
  /** Stops the export: it rejects with the signal's reason. */
  signal?: AbortSignal | undefined;
  /** Hears how many rows were written after each chunk, and of how many (null while not known). */
  onProgress?: ((rows: number, total: number | null) => void) | undefined;
}

/** A grid model of any kind and schema: local, pivot, or remote. */
// biome-ignore lint/suspicious/noExplicitAny: models of any schema.
type AnyGridModel = GridModel<any> | PivotGridModel<any> | RemoteGridModel<any>;

const OPTIONS = [
  "format",
  "values",
  "rows",
  "columns",
  "headers",
  "totals",
  "escapeFormulas",
  "bom",
  "signal",
  "onProgress",
];
/** How long a chunk writes before yielding, and how much text it holds at most. */
const CHUNK_MS = 8;
const CHUNK_TEXT = 1 << 20;

/**
 * Writes what `model`'s grid shows as CSV (RFC 4180) or TSV, UTF-8, from
 * the state its rows are in as the export starts: in chunks that yield to
 * the page, failing with a `GridExportError` ("view-changed") where the
 * rows change under it (appends to a table whose records are exported
 * excepted: they are not in the export), or ("snapshot-expired") where a
 * remote source dropped the rows' snapshot.
 */
export async function exportGrid(
  grid: AnyGridModel,
  options: GridExportOptions = {},
): Promise<Blob> {
  const at = "exportGrid";
  const model = grid as unknown as BaseGridModel;
  if (typeof (model as Partial<BaseGridModel>)?.[EXPORT_ROWS] !== "function")
    throw new TypeError(
      `${at}: expected a grid model (createGridModel, createPivotGridModel, or createRemoteGridModel); received ${String(model)}`,
    );
  if (typeof options !== "object" || options === null)
    throw new TypeError(`${at}: expected options such as { format: "csv" }`);
  for (const key of Object.keys(options))
    if (!OPTIONS.includes(key))
      throw new Error(`${at} ${key}: unknown option; use ${OPTIONS.join(", ")}`);
  const {
    format = "csv",
    values = "text",
    rows = "shown",
    headers = true,
    escapeFormulas = true,
    bom = false,
    signal,
    onProgress,
  } = options;
  choice(format, ["csv", "tsv"], `${at} format`);
  choice(values, ["text", "raw"], `${at} values`);
  choice(rows, ["shown", "records", "selected"], `${at} rows`);
  choice(headers, [true, false, "titles", "ids"], `${at} headers`);
  choice(escapeFormulas, [true, false], `${at} escapeFormulas`);
  choice(bom, [true, false], `${at} bom`);
  const shows = model.totalsRow !== null;
  if (options.totals !== undefined) {
    choice(options.totals, [true, false], `${at} totals`);
    if (options.totals && !shows)
      throw new Error(`${at} totals: the grid shows no totals row; drop totals`);
    if (options.totals && rows === "selected")
      throw new Error(
        `${at} totals: the totals are of every row the grid shows, not the selection; drop totals, or give rows: "shown"`,
      );
  }
  const totals = options.totals ?? (shows && rows === "shown");
  const columns = exportedColumns(model, options.columns ?? "shown", at);
  signal?.throwIfAborted();
  // What the rows are read from is taken here, as the export starts.
  const request = { rows, columns, raw: values === "raw", totals, at } as const;
  const state = model[EXPORT_ROWS](request);
  // A local grid's rows are captured here; a remote grid's were, by its model.
  const asked = "then" in state ? state : readLocal(state, request);
  let reader: RowsRead | null = null;
  const stop = () => reader?.close();
  signal?.addEventListener("abort", stop);
  // Stopped, the export ends at once, whatever a source it waits for does;
  // each wait hears the signal only until it ends or the signal fires
  // (a source may never answer).
  const until = signal
    ? <T>(waited: T | Promise<T>) =>
        new Promise<T>((resolve, reject) => {
          const abort = () => reject(signal.reason);
          if (signal.aborted) return abort();
          signal.addEventListener("abort", abort, { once: true });
          Promise.resolve(waited)
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", abort));
        })
    : <T>(waited: T | Promise<T>) => waited;
  try {
    reader = await until(asked);
    return await write(reader, columns, model, until, {
      separator: format === "csv" ? "," : "\t",
      escapeFormulas,
      headers,
      bom,
      signal,
      onProgress,
      type: format === "csv" ? "text/csv;charset=utf-8" : "text/tab-separated-values;charset=utf-8",
    });
  } catch (error) {
    // Stopped: as `fetch` does, whatever the reads it stopped then said.
    throw signal?.aborted ? signal.reason : error;
  } finally {
    signal?.removeEventListener("abort", stop);
    if (reader) reader.close();
    // A remote reader the export stopped waiting for is closed as it comes.
    else if ("then" in asked)
      asked.then(
        (late) => late.close(),
        () => {},
      );
  }
}

async function write(
  reader: RowsRead,
  columns: readonly PlacedColumn[],
  model: BaseGridModel,
  until: <T>(waited: T | Promise<T>) => T | Promise<T>,
  options: {
    separator: "," | "\t";
    escapeFormulas: boolean;
    headers: boolean | "titles" | "ids";
    bom: boolean;
    signal: AbortSignal | undefined;
    onProgress: GridExportOptions["onProgress"];
    type: string;
  },
): Promise<Blob> {
  const { signal, onProgress } = options;
  const field = fieldWriter(options.separator, options.escapeFormulas, model.locale);
  const count = columns.length;
  const cells = columns.map(() => "");
  let plain: Uint8Array = new Uint8Array(count);
  const line = () => {
    let text = field(cells[0]!, plain[0] === 1);
    for (let c = 1; c < count; c++) text += options.separator + field(cells[c]!, plain[c] === 1);
    return `${text}\r\n`;
  };
  // Each chunk's text becomes a Blob as it is written, so no one step encodes the whole output.
  const parts: Blob[] = [];
  let text = options.bom ? "﻿" : "";
  const flush = () => {
    if (text) parts.push(new Blob([text]));
    text = "";
  };
  if (options.headers !== false) {
    // Titles as the columns had them when the export started, as `columnTitle` writes them.
    columns.forEach(({ id, content }, c) => {
      cells[c] =
        options.headers === "ids"
          ? id
          : [...content.headings.map(({ title }) => title), content.title].join(", ");
    });
    text += line();
  }
  let written = 0;
  for (let done = false; !done; ) {
    signal?.throwIfAborted();
    reader.check();
    const end = performance.now() + CHUNK_MS;
    for (let n = 1; ; n++) {
      let more = reader.next(cells, plain);
      if (typeof more !== "boolean") {
        flush();
        more = await until(more);
        signal?.throwIfAborted();
        reader.check();
      }
      if (!more) {
        done = true;
        break;
      }
      text += line();
      written++;
      if (n % 32 === 0 && (performance.now() > end || text.length > CHUNK_TEXT)) break;
    }
    flush();
    onProgress?.(written, reader.total);
    if (!done) await pause();
  }
  const totals = reader.totals;
  if (totals) {
    totals.cells.forEach((cell, c) => {
      cells[c] = cell;
    });
    plain = totals.plain;
    text += line();
  }
  signal?.throwIfAborted();
  reader.check();
  flush();
  return new Blob(parts, { type: options.type });
}

/** The columns `given` names, checked: the shown ones with text, or those of the ids given. */
function exportedColumns(
  model: BaseGridModel,
  given: "shown" | readonly string[],
  at: string,
): PlacedColumn[] {
  if (given === "shown") {
    const shown = (model.columnLayout as readonly PlacedColumn[]).filter(
      ({ content }) => !content.textless,
    );
    if (shown.length === 0)
      throw new Error(
        `${at} columns: the grid shows no column with text to export; show one, or give columns by id`,
      );
    return shown;
  }
  if (!Array.isArray(given) || given.length === 0)
    throw new TypeError(
      `${at} columns: expected "shown" or a list of column ids; received ${JSON.stringify(given)}`,
    );
  const columns = model.columns as readonly Column[];
  const ids = columns.map(({ id }) => id);
  const contents = model[CONTENTS];
  return given.map((id, i) => {
    const column = typeof id === "string" ? columnOf(model, columns, contents, id) : undefined;
    if (!column)
      throw new Error(
        `${at} columns[${i}]: no column ${JSON.stringify(id)}; the columns are ${ids.map((one) => JSON.stringify(one)).join(", ")}`,
      );
    if (given.indexOf(id) < i)
      throw new Error(
        `${at} columns[${i}]: column ${JSON.stringify(id)} is given twice; give it once`,
      );
    if (column.content.textless)
      throw new Error(
        `${at} columns[${i}]: column ${JSON.stringify(id)} has no text to export; give it text, or leave it out`,
      );
    return column;
  });
}

/** Column `id`, shown or hidden, placed as exports read it; undefined for an id the grid lacks. */
function columnOf(
  model: BaseGridModel,
  columns: readonly Column[],
  contents: ReadonlyMap<string, ColumnContent>,
  id: string,
): PlacedColumn | undefined {
  const shown = model.columnLayout.find((column) => column.id === id);
  if (shown) return shown as PlacedColumn;
  const column = columns.find((other) => other.id === id);
  const content = contents.get(id);
  return (
    column &&
    content && {
      id,
      field: column.field ?? null,
      kind: content.kind,
      title: content.title,
      headings: content.headings,
      x: 0,
      width: column.width ?? 0,
      align: content.align,
      pinned: null,
      content,
    }
  );
}

/** Refuses a value that is none of `choices`. */
function choice(value: unknown, choices: readonly unknown[], at: string) {
  if (!choices.includes(value))
    throw new TypeError(
      `${at}: expected ${choices.map((one) => JSON.stringify(one)).join(", ")}; received ${JSON.stringify(value)}`,
    );
}

/** Lets the page run: the scheduler's yield where there is one, else a message, which no timer clamps. */
function pause(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler?.yield) return scheduler.yield();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}
