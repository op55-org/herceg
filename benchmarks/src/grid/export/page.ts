// In-page side of the grid export benchmark (run.ts drives it). Both grids
// show the grid suite's fixture (fixture.ts: 20 fields, numbers, times, and
// categories with missing values), formatted as the grid suite formats it,
// and export every row as CSV:
//
// - Herceg: `exportGrid(model, { values })` with its defaults (titles as
//   the header, formulas escaped, chunks yielding to the page), to a Blob.
// - AG Grid Community: `api.getDataAsCsv()` turned into a Blob, as its
//   `exportDataAsCsv` does before downloading. Text: the columns'
//   `valueFormatter`, which exports use by default. Raw: a
//   `processCellCallback` writing times as ISO 8601 and missing values
//   empty, as Herceg's raw values are; numbers and labels as they are.
//   It quotes every value and escapes no formulas, as it does by default.
//
// Copy (Herceg only: AG Grid's clipboard is Enterprise): Ctrl+C over a
// selection of every row, timed from the key's copy event reaching the
// window to the grid's listener having set the clipboard's text.

import {
  ClientSideRowModelModule,
  CsvExportModule,
  createGrid as createAgGrid,
  type GridApi,
  ModuleRegistry,
  themeQuartz,
} from "ag-grid-community";
import { rowView, type Schema } from "herceg";
import { compileFields } from "herceg/fields";
import {
  createGrid,
  createGridModel,
  exportGrid,
  type Grid,
  type GridCopyOptions,
  type GridModel,
} from "herceg/grid";
import { type RowObject, rowObjects } from "../adapter.ts";
import { hercegTable } from "../adapters/herceg.ts";
import { FORMAT, formatValue, type GridTable, gridTable } from "../fixture.ts";

ModuleRegistry.registerModules([ClientSideRowModelModule, CsvExportModule]);

const WIDTH = 1200;
const HEIGHT = 600;

/** Every column's display: the grid suite's formats by kind, and its missing text. */
const FIELDS = compileFields([
  { missing: FORMAT.missing },
  { match: { kind: "number" }, format: FORMAT.number },
  { match: { kind: "time" }, format: FORMAT.time },
]);

let fixture: GridTable | null = null;
let container: HTMLElement | null = null;
let herceg: { model: GridModel<Schema>; grid: Grid<Schema> } | null = null;
let agGrid: GridApi<RowObject> | null = null;
/** The last export, kept until the next, as a page offering it for download would. */
let kept: Blob | null = null;
let copied: Promise<{ ms: number; chars: number; taken: boolean; said: string }> | null = null;
/** What the last copy put on the clipboard, read after its time was taken. */
let copiedText = "";

function stage(): HTMLElement {
  const element = document.createElement("div");
  element.style.cssText = `width:${WIDTH}px;height:${HEIGHT}px`;
  document.getElementById("stage")!.append(element);
  return element;
}

function mountHerceg(element: HTMLElement, copy?: GridCopyOptions) {
  const model = createGridModel({
    data: rowView(hercegTable(fixture!)),
    columns: fixture!.fields.map((field) => ({ field: field.name })),
    locale: FORMAT.locale,
    timeZone: FORMAT.timeZone,
    fields: FIELDS,
  });
  const grid = createGrid(element, {
    model,
    ariaLabel: "Export",
    ...(copy !== undefined && { copy }),
  });
  return { model, grid };
}

function mountAgGrid(element: HTMLElement): GridApi<RowObject> {
  return createAgGrid(element, {
    theme: themeQuartz,
    rowData: rowObjects(fixture!),
    getRowId: ({ data }) => String(data.id),
    columnDefs: fixture!.fields.map((field) => ({
      field: field.name,
      headerName: field.name,
      valueFormatter: ({ value }) => formatValue(field.kind, value as number | string | undefined),
    })),
    animateRows: false,
  });
}

/** AG Grid's CSV of every row, as a Blob: formatted, or raw values written as Herceg writes them. */
function agGridCsv(api: GridApi<RowObject>, values: "text" | "raw"): Blob {
  const times = new Set(fixture!.fields.filter((f) => f.kind === "time").map((f) => f.name));
  const csv =
    values === "text"
      ? api.getDataAsCsv()
      : api.getDataAsCsv({
          processCellCallback: ({ value, column }) =>
            value === undefined
              ? ""
              : times.has(column.getColId())
                ? new Date(value as number).toISOString()
                : value,
        });
  return new Blob([csv ?? ""], { type: "text/csv;charset=utf-8" });
}

/** The rows of an RFC 4180 CSV text, one at a time, for checking a grid's export cell by cell. */
function* csvRows(text: string): Generator<string[]> {
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') cell += char;
      else if (text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      yield row;
      row = [];
      cell = "";
      i++;
    } else cell += char;
  }
  if (cell || row.length > 0) {
    row.push(cell);
    yield row;
  }
}

export const exportBench = {
  /** The fixture's first `rows` rows of 20 fields. */
  prepare(rows: number, seed: number): void {
    fixture = gridTable({ rows, groups: 1 }, seed);
  },

  /** Mounts one library's grid over the fixture; Herceg's with `copy` options where given. */
  mount(library: "herceg" | "ag-grid", copy?: GridCopyOptions): void {
    container = stage();
    if (library === "herceg") herceg = mountHerceg(container, copy);
    else agGrid = mountAgGrid(container);
  },

  /** Exports every row as CSV from the grid mounted; its time, from the call to the Blob, and size. */
  async run(values: "text" | "raw"): Promise<{ ms: number; bytes: number }> {
    kept = null;
    const start = performance.now();
    performance.mark("hg-export-start");
    const blob = herceg ? await exportGrid(herceg.model, { values }) : agGridCsv(agGrid!, values);
    performance.mark("hg-export-end");
    const ms = performance.now() - start;
    kept = blob;
    return { ms, bytes: blob.size };
  },

  /**
   * One library's CSV of every row, parsed and checked cell by cell against
   * the fixture's own cells: the field names as the header; for text, the
   * grid suite's formats; for raw values, the values themselves (times as
   * ISO 8601, missing values empty). The rows it wrote, and the first cell
   * that differs, if any.
   */
  async check(
    library: "herceg" | "ag-grid",
    values: "text" | "raw",
  ): Promise<{ rows: number; wrong: string | null }> {
    const element = stage();
    let text: string;
    if (library === "herceg") {
      const mounted = mountHerceg(element);
      text = await (await exportGrid(mounted.model, { values })).text();
      mounted.grid.destroy();
    } else {
      const api = mountAgGrid(element);
      text = await agGridCsv(api, values).text();
      api.destroy();
    }
    element.remove();
    const { fields, length } = fixture!;
    const objects = rowObjects(fixture!);
    const cell = (field: (typeof fields)[number], value: number | string | undefined) =>
      values === "text"
        ? formatValue(field.kind, value)
        : value === undefined
          ? ""
          : field.kind === "time"
            ? new Date(value as number).toISOString()
            : String(value);
    let rows = 0;
    for (const row of csvRows(text)) {
      if (rows > length) return { rows, wrong: `more rows than the fixture's ${length}` };
      const expected =
        rows === 0
          ? fields.map((field) => field.name)
          : fields.map((field) => cell(field, objects[rows - 1]![field.name]));
      for (let c = 0; c < Math.max(row.length, expected.length); c++)
        if (row[c] !== expected[c])
          return {
            rows,
            wrong: `row ${rows}, column ${c}: ${JSON.stringify(row[c])}, not ${JSON.stringify(expected[c])}`,
          };
      rows++;
    }
    return { rows, wrong: rows === length + 1 ? null : `${rows} rows, not ${length + 1}` };
  },

  /** Selects every row of Herceg's grid and focuses its first cell, for Ctrl+C. */
  selectAll(): void {
    herceg!.model.selectAll();
    herceg!.grid.focusCell(0, fixture!.fields[0]!.name);
  },

  /**
   * Times the next copy event: from it reaching the window (before any
   * listener) to a listener after the grid's, with what it carried.
   */
  armCopy(): void {
    copied = new Promise((resolve) => {
      let start = 0;
      const begin = () => {
        start = performance.now();
      };
      const end = (event: ClipboardEvent) => {
        const ms = performance.now() - start;
        window.removeEventListener("copy", begin, true);
        document.removeEventListener("copy", end);
        const live = container!.querySelector(".herceg-grid > [aria-live]");
        copiedText = event.clipboardData!.getData("text/plain");
        resolve({
          ms,
          chars: copiedText.length,
          taken: event.defaultPrevented,
          said: live?.textContent?.trim() ?? "",
        });
      };
      window.addEventListener("copy", begin, true);
      document.addEventListener("copy", end);
    });
  },

  /** What the copy armed for heard. */
  copied: () => copied!,

  /**
   * What is wrong with the last copy, if anything: with `rows`, it must
   * hold those first rows of the fixture, every cell as the grid suite
   * formats it, tab-separated, a row a line (CRLF), no header, as the copy
   * of a selection writes them; with `refused`, nothing, the grid saying
   * the selection is too large to copy.
   */
  checkCopy(expected: { rows: number } | "refused", said: string): string | null {
    if (expected === "refused")
      return copiedText === "" && /too many/i.test(said)
        ? null
        : `copied ${copiedText.length} characters ("${said}"), not a refusal`;
    const { fields } = fixture!;
    const objects = rowObjects(fixture!);
    const lines = copiedText.split("\r\n");
    if (lines.length !== expected.rows) return `copied ${lines.length} rows, not ${expected.rows}`;
    for (let r = 0; r < expected.rows; r++) {
      const line = fields
        .map((field) => formatValue(field.kind, objects[r]![field.name]))
        .join("\t");
      if (lines[r] !== line)
        return `row ${r + 1}: ${JSON.stringify(lines[r])}, not ${JSON.stringify(line)}`;
    }
    return null;
  },

  destroy(): void {
    herceg?.grid.destroy();
    agGrid?.destroy();
    herceg = null;
    agGrid = null;
    kept = null;
    container?.remove();
    container = null;
  },

  /** The Blob kept, so it is not collected before memory is read. */
  keptBytes: (): number => kept?.size ?? 0,
};

declare global {
  interface Window {
    exportBench: typeof exportBench;
  }
}
window.exportBench = exportBench;
