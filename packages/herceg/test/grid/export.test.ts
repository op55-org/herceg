// Exports of what grids show (`exportGrid`): CSV and TSV against an
// independent writer and parser, formulas escaped in every kind of text,
// raw values by kind, which rows and columns, totals, and how an export
// meets rows changing under it, for local, grouped, pivot, and remote grids.

import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";
import { count, mean, sum } from "../../src/data/aggregations.ts";
import { category, time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { selectRows, selectWhere } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import { exportGrid, GridExportError, type GridExportOptions } from "../../src/grid/export.ts";
import { EXPORT_ROWS } from "../../src/grid/export-rows.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridModel } from "../../src/grid/model.ts";
import { createPivotGridModel } from "../../src/grid/pivot.ts";
import { createRemoteGridModel } from "../../src/grid/remote.ts";
import type { GridSource, RowsRequest, RowsWindow } from "../../src/grid/source.ts";
import { sparklineCell } from "../../src/grid/sparklines.ts";

// An independent RFC 4180 writer and parser, character by character.

function reference(rows: readonly (readonly string[])[], separator: string): string {
  const field = (cell: string) => {
    let special = false;
    for (const char of cell)
      if (char === separator || char === '"' || char === "\r" || char === "\n") special = true;
    if (!special) return cell;
    let out = '"';
    for (const char of cell) out += char === '"' ? '""' : char;
    return `${out}"`;
  };
  return rows.map((row) => `${row.map(field).join(separator)}\r\n`).join("");
}

function parse(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
    } else cell += char;
  }
  return rows;
}

const read = async (blob: Blob) => blob.text();
const lines = async (blob: Blob, separator = ",") => parse(await read(blob), separator);

const STRINGS = [
  "plain",
  "a,b",
  'say "hi"',
  "two\nlines",
  "carriage\rreturn",
  "crlf\r\nend",
  "tab\there",
  "日本語のテキスト",
  "مرحبا بالعالم",
  "emoji 😀 ok",
  " leading and trailing ",
];

function services(locale = "en-US") {
  const t = table({
    service: category(["auth", "search", "billing", "auth"]),
    latency: [120, 85.5, null, 240],
    requests: [1204, 30, 7, 99],
    at: time([Date.UTC(2026, 0, 1), Date.UTC(2026, 0, 2, 12), Number.NaN, 9e15]),
  });
  const view = rowView(t);
  const model = createGridModel({
    data: view,
    columns: [
      { field: "service" },
      { field: "latency", heading: "Latency" },
      { field: "requests", heading: ["Traffic", "Count"] },
      { field: "at" },
    ],
    locale,
    timeZone: "UTC",
  });
  return { t: t as unknown as Table, view, model };
}

describe("exportGrid's CSV and TSV", () => {
  it("quotes separators, quotes, and line breaks, and keeps any text, as an independent writer does", async () => {
    for (const [format, separator] of [
      ["csv", ","],
      ["tsv", "\t"],
    ] as const) {
      const t = table({ label: category(STRINGS), n: STRINGS.map((_, i) => i) });
      const model = createGridModel({
        data: rowView(t),
        columns: [{ field: "label", title: "Label, quoted" }, { field: "n" }],
        locale: "en-US",
      });
      const text = await read(await exportGrid(model, { format }));
      const rows = [["Label, quoted", "n"], ...STRINGS.map((label, i) => [label, String(i)])];
      expect(text).toBe(reference(rows, separator));
      expect(parse(text, separator)).toEqual(rows);
    }
  });

  it("writes headers as titles after their headings, as ids, or not at all", async () => {
    const { model } = services();
    expect((await lines(await exportGrid(model)))[0]).toEqual([
      "service",
      "Latency, latency",
      "Traffic, Count, requests",
      "at",
    ]);
    expect((await lines(await exportGrid(model, { headers: "ids" })))[0]).toEqual([
      "service",
      "latency",
      "requests",
      "at",
    ]);
    const bare = await lines(await exportGrid(model, { headers: false }));
    expect(bare).toHaveLength(4);
    expect(bare[0]![0]).toBe("auth");
  });

  it("writes text as cells show it, or raw values by their kind", async () => {
    const { model } = services();
    expect((await lines(await exportGrid(model))).slice(1)).toEqual([
      ["auth", "120", "1,204", "Jan 1, 2026, 00:00:00"],
      ["search", "85.5", "30", "Jan 2, 2026, 12:00:00"],
      ["billing", "", "7", ""],
      // A time past the ends of dates is written as its number in text, missing raw.
      ["auth", "240", "99", "9,000,000,000,000,000"],
    ]);
    expect((await lines(await exportGrid(model, { values: "raw" }))).slice(1)).toEqual([
      ["auth", "120", "1204", "2026-01-01T00:00:00.000Z"],
      ["search", "85.5", "30", "2026-01-02T12:00:00.000Z"],
      ["billing", "", "7", ""],
      ["auth", "240", "99", ""],
    ]);
  });

  it("writes infinities as text shows them, and as JavaScript writes them raw", async () => {
    const t = table({ v: [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN] });
    const model = createGridModel({ data: rowView(t), columns: [{ field: "v" }], locale: "en-US" });
    // "-∞" is no number a spreadsheet reads: it is escaped.
    expect(await lines(await exportGrid(model, { headers: false }))).toEqual([
      ["∞"],
      ["'-∞"],
      [""],
    ]);
    expect(await lines(await exportGrid(model, { headers: false, values: "raw" }))).toEqual([
      ["Infinity"],
      ["-Infinity"],
      [""],
    ]);
  });

  it("writes a byte order mark first when asked, and UTF-8 throughout", async () => {
    const { model } = services();
    const bytes = new Uint8Array(await (await exportGrid(model, { bom: true })).arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const plain = new Uint8Array(await (await exportGrid(model)).arrayBuffer());
    expect(plain[0]).toBe("s".charCodeAt(0));
    const blob = await exportGrid(model, { format: "tsv" });
    expect(blob.type).toBe("text/tab-separated-values;charset=utf-8");
    expect((await exportGrid(model)).type).toBe("text/csv;charset=utf-8");
  });
});

describe("exportGrid's formula escaping", () => {
  const exported = async (
    model: Parameters<typeof exportGrid>[0],
    options: GridExportOptions = {},
  ) => (await lines(await exportGrid(model, { headers: false, ...options }))).map((row) => row[0]);

  it("escapes text starting as a formula, in labels, titles, and columns' text", async () => {
    const t = table({
      label: category(["=1+2", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx", "\nx", "＝1", "ok", "-"]),
    });
    // Importers drop NUL and may trim spaces before what they read: a formula after them is one.
    const hidden = table({
      label: category(["\0=1+2", " =1+2", "\u00a0\u200b@x", " ok", "  -5", "\0-1,204.5", "=١+٢"]),
    });
    const after = createGridModel({
      data: rowView(hidden),
      columns: [{ field: "label", title: "\0=Title" }],
      locale: "en-US",
    });
    for (const format of ["csv", "tsv"] as const)
      expect(
        (await lines(await exportGrid(after, { format }), format === "csv" ? "," : "\t")).map(
          (row) => row[0],
        ),
      ).toEqual([
        "'\0=Title",
        "'\0=1+2",
        "' =1+2",
        "'\u00a0\u200b@x",
        " ok",
        "  -5",
        "\0-1,204.5",
        "'=١+٢",
      ]);
    const model = createGridModel({
      data: rowView(t),
      columns: [{ field: "label", title: "=Title" }],
      locale: "en-US",
    });
    const rows = await lines(await exportGrid(model));
    expect(rows.map((row) => row[0])).toEqual([
      "'=Title",
      "'=1+2",
      "'+cmd",
      "'-2+3",
      "'@SUM(A1)",
      "'\tx",
      "'\rx",
      "'\nx",
      "'＝1",
      "ok",
      "'-",
    ]);
    // Raw labels are text too.
    expect((await exported(model, { values: "raw" }))[0]).toBe("'=1+2");
    expect((await exported(model, { escapeFormulas: false }))[0]).toBe("=1+2");
    // Columns without a field write their text, escaped.
    const own = createGridModel({
      data: rowView(t),
      columns: [{ id: "note", text: ["=", { field: "label" }] }],
      locale: "en-US",
    });
    expect((await exported(own))[8]).toBe("'=ok");
  });

  it("escapes a format's prefix and a time pattern's text that start as formulas", async () => {
    const t = table({ n: [42], at: time([Date.UTC(2026, 4, 1)]) });
    const model = createGridModel({
      data: rowView(t),
      columns: [
        { field: "n", format: { number: ".0f", prefix: "=1+" } },
        { field: "at", format: { time: "=%Y" } },
      ],
      locale: "en-US",
      timeZone: "UTC",
    });
    expect(await lines(await exportGrid(model, { headers: false }))).toEqual([
      ["'=1+42", "'=2026"],
    ]);
  });

  it("spares negative and signed numbers as each locale writes them, and never escapes raw numbers", async () => {
    const formats = [
      { maximumFractionDigits: 1 },
      { signDisplay: "always", maximumFractionDigits: 1 },
      { style: "percent", maximumFractionDigits: 1 },
      { notation: "scientific" },
      // sv-SE and fa-IR write an exponent's minus as U+2212.
      { notation: "scientific", signDisplay: "always" },
    ] as const;
    const values = [-1234567.5, 3.5, -0.125, -0.00000012, 0.00000012];
    // sv-SE writes a minus (U+2212), which starts no formula.
    // tr-TR writes the percent sign first ("-%12,5"); ar-EG, bn-BD, and fa-IR their own digits,
    // after a direction mark in ar-EG.
    for (const locale of [
      "en-US",
      "de-DE",
      "fr-FR",
      "de-CH",
      "en-IN",
      "es-ES",
      "sv-SE",
      "tr-TR",
      "ar-EG",
      "bn-BD",
      "fa-IR",
    ]) {
      const t = table({
        a: [values[0]!],
        b: [values[1]!],
        c: [values[2]!],
        d: [values[3]!],
        e: [values[4]!],
      });
      const model = createGridModel({
        data: rowView(t),
        columns: (["a", "b", "c", "d", "e"] as const).map((field, i) => ({
          field,
          format: formats[i]!,
        })),
        locale,
      } as never) as GridModel;
      const [row] = await lines(await exportGrid(model, { headers: false }));
      expect(row, locale).toEqual(
        values.map((value, i) => new Intl.NumberFormat(locale, formats[i]).format(value)),
      );
    }
    // A number pattern written past what a number reads as is escaped.
    const t = table({ v: [-5] });
    const model = createGridModel({
      data: rowView(t),
      columns: [{ field: "v", format: { number: ".0f", suffix: "+1" } }],
      locale: "en-US",
    });
    expect(await exported(model)).toEqual(["'-5+1"]);
    expect(await exported(model, { values: "raw" })).toEqual(["-5"]);
  });
});

describe("exportGrid's rows", () => {
  function grouped() {
    const t = table({
      host: category(["web", "api", "web", "db", "api"]),
      ms: [10, 20, 30, 40, 50],
      at: time([0, 1000, 2000, 3000, 4000]),
    });
    const view = rowView(t);
    const ops = { n: count(), ms: mean("ms"), seen: count("at") };
    const model = createGridModel({
      data: view,
      groups: groupRows(view, { by: ["host"], ops }),
      totals: rowTotals(view, { ops }),
      columns: [
        { field: "host" },
        { field: "ms", aggregate: "ms" },
        { field: "at", aggregate: "seen" },
      ],
      locale: "en-US",
      timeZone: "UTC",
    });
    return { t: t as unknown as Table, view, model };
  }

  it("writes the rows the grid lists, group rows as written and expanded groups' rows, then the totals", async () => {
    const { model } = grouped();
    model.setExpanded(["api"], true);
    expect(await lines(await exportGrid(model))).toEqual([
      ["host", "ms", "at"],
      ["web (2)", "20", "2"],
      ["api (2)", "35", "2"],
      ["api", "20", "Jan 1, 1970, 00:00:01"],
      ["api", "50", "Jan 1, 1970, 00:00:04"],
      ["db (1)", "40", "1"],
      ["Total", "30", "5"],
    ]);
    // Counts in a time column are numbers, raw too.
    expect(await lines(await exportGrid(model, { values: "raw", headers: false }))).toEqual([
      ["web", "20", "2"],
      ["api", "35", "2"],
      ["api", "20", "1970-01-01T00:00:01.000Z"],
      ["api", "50", "1970-01-01T00:00:04.000Z"],
      ["db", "40", "1"],
      ["Total", "30", "5"],
    ]);
    expect(await lines(await exportGrid(model, { totals: false, headers: false }))).toHaveLength(5);
  });

  it("writes the view's records in its order, without group rows, and the selected ones", async () => {
    const { t, model } = grouped();
    expect(
      (await lines(await exportGrid(model, { rows: "records", headers: false }))).map(
        (row) => row[1],
      ),
    ).toEqual(["10", "20", "30", "40", "50"]);
    // Totals of the same rows, when asked for.
    expect(
      (await lines(await exportGrid(model, { rows: "records", totals: true }))).at(-1),
    ).toEqual(["Total", "30", "5"]);
    // Nothing selected: no rows.
    expect(await lines(await exportGrid(model, { rows: "selected", headers: false }))).toEqual([]);
    model.selectionStore.set("grid-rows", selectRows(new RowSet(t).add(3).add(1)) as never);
    expect(
      (await lines(await exportGrid(model, { rows: "selected", headers: false }))).map(
        (row) => row[1],
      ),
    ).toEqual(["20", "40"]);
    // A condition selects too, in the view's order.
    model.data.setQuery({ sort: [{ field: "ms", order: "descending" }] });
    model.selectionStore.set("grid-rows", selectWhere(col("ms").gt(25)));
    expect(
      (await lines(await exportGrid(model, { rows: "selected", headers: false }))).map(
        (row) => row[1],
      ),
    ).toEqual(["50", "40", "30"]);
    await expect(exportGrid(model, { rows: "selected", totals: true })).rejects.toThrow(
      'exportGrid totals: the totals are of every row the grid shows, not the selection; drop totals, or give rows: "shown"',
    );
  });

  it("writes a pivot's rows and its totals row, and refuses its records", async () => {
    const t = table({
      region: category(["eu", "us", "eu", "us"]),
      service: category(["api", "api", "web", "web"]),
      ms: [10, 20, 30, 40],
    });
    const model = createPivotGridModel({
      data: pivotRows(rowView(t), {
        rows: "region",
        pivot: "service",
        ops: { ms: mean("ms") },
        totals: { row: true },
      }),
      locale: "en-US",
    });
    const rows = await lines(await exportGrid(model));
    // A pivot of one aggregate titles its columns by value.
    expect(rows[0]).toEqual(["region", "api", "web"]);
    expect(rows.slice(1)).toEqual([
      ["eu", "10", "30"],
      ["us", "20", "40"],
      ["Total", "15", "35"],
    ]);
    await expect(exportGrid(model, { rows: "records" })).rejects.toThrow(
      'exportGrid rows: a pivot grid exports the rows it shows, not its records or selection; give rows: "shown"',
    );
  });

  it("writes the shown columns, or columns by id (hidden ones too), and refuses what it cannot write", async () => {
    const { model } = services();
    model.setColumnVisible("latency", false);
    expect((await lines(await exportGrid(model, { headers: "ids" })))[0]).toEqual([
      "service",
      "requests",
      "at",
    ]);
    expect(
      (
        await lines(await exportGrid(model, { columns: ["latency", "service"], headers: false }))
      )[0],
    ).toEqual(["120", "auth"]);
    await expect(exportGrid(model, { columns: ["service", "latncy"] })).rejects.toThrow(
      'exportGrid columns[1]: no column "latncy"; the columns are "service", "latency", "requests", "at"',
    );
    await expect(exportGrid(model, { columns: ["at", "at"] })).rejects.toThrow(
      'exportGrid columns[1]: column "at" is given twice; give it once',
    );
    await expect(exportGrid(model, { columns: [] })).rejects.toThrow(
      'exportGrid columns: expected "shown" or a list of column ids; received []',
    );
    // A column without a field and without text has nothing to write.
    model.setColumns([...model.columns, { id: "open" }] as never);
    expect((await lines(await exportGrid(model, { headers: "ids" })))[0]).toEqual([
      "service",
      "requests",
      "at",
    ]);
    await expect(exportGrid(model, { columns: ["service", "open"] })).rejects.toThrow(
      'exportGrid columns[1]: column "open" has no text to export; give it text, or leave it out',
    );
    // Text given, even empty, is text.
    model.setColumns([...model.columns.slice(0, -1), { id: "open", text: [] }] as never);
    expect((await lines(await exportGrid(model, { headers: "ids" })))[0]).toContain("open");
  });

  it("refuses options it does not take, as they are given", async () => {
    const { model } = services();
    const refused: [GridExportOptions, string][] = [
      [{ format: "xlsx" as "csv" }, 'exportGrid format: expected "csv", "tsv"; received "xlsx"'],
      [
        { values: "formatted" as "raw" },
        'exportGrid values: expected "text", "raw"; received "formatted"',
      ],
      [{ totals: true }, "exportGrid totals: the grid shows no totals row; drop totals"],
      [{ separator: ";" } as GridExportOptions, "exportGrid separator: unknown option"],
    ];
    for (const [options, message] of refused)
      await expect(exportGrid(model, options)).rejects.toThrow(message);
    await expect(exportGrid({} as GridModel)).rejects.toThrow(
      "exportGrid: expected a grid model (createGridModel, createPivotGridModel, or createRemoteGridModel)",
    );
  });

  it("stops with the signal's reason", async () => {
    const { model } = services();
    const stop = new AbortController();
    stop.abort(new Error("enough"));
    await expect(exportGrid(model, { signal: stop.signal })).rejects.toThrow("enough");
    const later = new AbortController();
    const reason = new Error("stopped while writing");
    await expect(
      exportGrid(model, { signal: later.signal, onProgress: () => later.abort(reason) }),
    ).rejects.toBe(reason);
  });

  it("writes in chunks that yield to the page, telling of the rows written", async () => {
    const length = 200_000;
    const t = table({
      a: Float64Array.from({ length }, (_, i) => i),
      b: Float64Array.from({ length }, (_, i) => -i),
    });
    const model = createGridModel({
      data: rowView(t),
      columns: [{ field: "a" }, { field: "b" }],
      locale: "en-US",
    });
    const heard: [number, number | null][] = [];
    let yielded = false;
    setTimeout(() => {
      yielded = true;
    }, 0);
    const blob = await exportGrid(model, {
      values: "raw",
      onProgress: (rows, total) => heard.push([rows, total]),
    });
    expect(heard.length).toBeGreaterThan(1);
    expect(heard.at(-1)).toEqual([length, length]);
    expect(yielded).toBe(true);
    const text = await read(blob);
    expect(text.endsWith(`${length - 1},-${length - 1}\r\n`)).toBe(true);
  });
});

describe("exportGrid while rows change", () => {
  /** An export that changes the data as it reports its first chunk, and how it ended. */
  const during = async (
    model: Parameters<typeof exportGrid>[0],
    change: () => void,
    options: GridExportOptions = {},
  ): Promise<string | GridExportError> => {
    let changed = false;
    try {
      const blob = await exportGrid(model, {
        headers: false,
        ...options,
        onProgress: () => {
          if (changed) return;
          changed = true;
          change();
        },
      });
      return await read(blob);
    } catch (error) {
      if (error instanceof GridExportError) return error;
      throw error;
    }
  };

  it("goes on through appends where it writes records, which they neither move nor change", async () => {
    const { t, model } = services();
    const append = () =>
      t.append({ service: ["new"], latency: [1], requests: [1], at: [0] } as never);
    const text = await during(model, append);
    expect(parse(text as string, ",")).toHaveLength(4);
    // A grouped grid's records and selection too.
    const view = rowView(t);
    const groups = groupRows(view, { by: ["service"], ops: { n: count() } });
    const tree = createGridModel({
      data: view,
      groups,
      columns: [{ field: "service" }],
      locale: "en-US",
    });
    const records = await during(tree, append, { rows: "records" });
    expect(parse(records as string, ",")).toHaveLength(5);
    tree.selectAll();
    const selected = await during(tree, append, { rows: "selected" });
    expect(parse(selected as string, ",")).toHaveLength(6);
    // A grouped grid's rows shown are its groups, which appends change.
    const shown = await during(tree, append);
    expect(shown).toBeInstanceOf(GridExportError);
    expect((shown as GridExportError).code).toBe("view-changed");
    expect((shown as GridExportError).message).toBe(
      "exportGrid: the grid's rows changed while exporting (the table was reset, rows were dropped or written, or the view changed); export again",
    );
  });

  it("fails on writes, drops, resets, inserts, and query changes", async () => {
    const changes: [string, (t: Table, view: ReturnType<typeof services>["view"]) => void][] = [
      ["a write", (t) => t.replace(0, { latency: [1] })],
      ["a drop", (t) => t.dropFirst(1)],
      [
        "a reset",
        (t) => t.reset({ service: ["x"], latency: [1], requests: [1], at: [0] } as never),
      ],
      ["a query", (_, view) => view.setQuery({ filter: col("latency").gt(100) })],
    ];
    for (const [name, change] of changes) {
      const { t, view, model } = services();
      const ended = await during(model, () => change(t, view));
      expect(ended, name).toBeInstanceOf(GridExportError);
    }
    // Rows an ordered table takes in before its last move the others.
    const ordered = orderedTable({ at: time([0, 2000]), v: [1, 2] }, { orderBy: "at" });
    const model = createGridModel({
      data: rowView(ordered),
      columns: [{ field: "v" }],
      locale: "en-US",
    });
    const ended = await during(model, () => ordered.append({ at: [1000], v: [3] } as never));
    expect(ended).toBeInstanceOf(GridExportError);
  });

  it("refuses to start in a transaction that wrote to the table, and fails on its writes after it starts", async () => {
    // Totals (and groups) follow the rows once the transaction ends: an export of them now would mix two states.
    const { t, view, model } = services();
    model.update({ totals: rowTotals(view, { ops: { requests: count() } }) });
    for (const write of [
      () => t.replace(0, { requests: [10] }),
      () => t.append({ service: ["new"], latency: [1], requests: [1], at: [0] } as never),
    ]) {
      let refused: Promise<Blob> | undefined;
      t.transaction(() => {
        write();
        refused = exportGrid(model);
      });
      await expect(refused!).rejects.toThrow(
        "exportGrid: the grid's table is in a transaction that has written to it; export once the transaction ends",
      );
    }
    // Started before the transaction wrote: a write in place fails it, appends leave records to go on.
    let exported: Promise<Blob> | undefined;
    t.transaction(() => {
      exported = exportGrid(model, { rows: "records" });
      t.replace(1, { latency: [2] });
      t.replace(2, { latency: [3] });
    });
    await expect(exported!).rejects.toThrow(GridExportError);
    let appended: Promise<Blob> | undefined;
    const before = t.length;
    t.transaction(() => {
      appended = exportGrid(model, { rows: "records", headers: false });
      t.append({ service: ["new"], latency: [1], requests: [1], at: [0] } as never);
    });
    expect(await lines(await appended!)).toHaveLength(before);
  });

  it("refuses in a transaction that wrote before its model was made, or before its view's query changed", async () => {
    const refusal =
      "exportGrid: the grid's table is in a transaction that has written to it; export once the transaction ends";
    const columns = [{ field: "id" }, { field: "v", aggregate: "v" }] as const;
    const ops = { v: sum("v") };
    // Groups and totals made before the transaction, a model for them in it (a grid mounted then).
    const models: [string, (view: RowView) => () => GridModel][] = [
      ["plain", (view) => () => createGridModel({ data: view, columns, locale: "en-US" } as never)],
      [
        "grouped",
        (view) => {
          const groups = groupRows(view, { by: ["id"], ops });
          return () => createGridModel({ data: view, groups, columns, locale: "en-US" } as never);
        },
      ],
      [
        "with totals",
        (view) => {
          const totals = rowTotals(view, { ops });
          return () => createGridModel({ data: view, totals, columns, locale: "en-US" } as never);
        },
      ],
    ];
    for (const [name, make] of models) {
      const t = table({ id: category(["a", "b"]), v: [1, 2] });
      const create = make(rowView(t as unknown as Table));
      let model: GridModel | undefined;
      let refused: Promise<Blob> | undefined;
      t.transaction(() => {
        t.replace(0, { v: [10] });
        model = create();
        refused = exportGrid(model);
      });
      await expect(refused!, name).rejects.toThrow(refusal);
      // Once it ends, the totals follow the rows.
      if (name === "with totals")
        expect(await lines(await exportGrid(model!, { headers: false }))).toEqual([
          ["a", "10"],
          ["b", "2"],
          ["Total", "12"],
        ]);
    }
    // A model made before: its view telling it of a new query in the transaction tells nothing of the writes.
    const t = table({ id: category(["a", "b"]), v: [1, 2] });
    const view = rowView(t);
    const model = createGridModel({
      data: view,
      totals: rowTotals(view, { ops }),
      columns,
      locale: "en-US",
    } as never);
    let refused: Promise<Blob> | undefined;
    t.transaction(() => {
      t.replace(0, { v: [10] });
      view.setQuery({ sort: [{ field: "v", order: "descending" }] });
      refused = exportGrid(model);
    });
    await expect(refused!).rejects.toThrow(refusal);
  });

  it("fails when a sparkline's data changes: its table appended to, its view's query changed, or the grid's own table", async () => {
    const make = () => {
      const series = table(
        { service: category(["auth", "search", "auth"]), x: [0, 1, 2], y: [1, 2, 3] },
        { name: "series" },
      );
      const view = rowView(series);
      const t = table({ service: category(["auth", "search"]), ms: [1, 2] });
      const own = rowView(t);
      const model = createGridModel({
        data: own,
        columns: [
          { field: "service" },
          { id: "trend", cell: sparklineCell({ data: view, key: "service", x: "x", y: "y" }) },
          { id: "self", cell: sparklineCell({ data: t, key: "service", x: "ms", y: "ms" }) },
        ],
        locale: "en-US",
      });
      return { series, view, t, model };
    };
    {
      const { series, model } = make();
      const ended = await during(
        model,
        () => series.append({ service: ["auth"], x: [3], y: [4] }),
        {
          columns: ["service", "trend"],
        },
      );
      expect((ended as Error).message).toBe(
        'exportGrid: column "trend" summarizes "series", which changed while exporting; export again, or leave the column out',
      );
    }
    {
      const { view, model } = make();
      const ended = await during(model, () => view.setQuery({ filter: col("y").gt(1) }), {
        columns: ["service", "trend"],
      });
      expect(ended).toBeInstanceOf(GridExportError);
    }
    {
      // Appends to the grid's own table change the summaries of a sparkline over it.
      const { t, model } = make();
      const append = () => t.append({ service: ["auth"], ms: [5] });
      const ended = await during(model, append, { columns: ["service", "self"] });
      expect((ended as Error).message).toContain('column "self" summarizes its data');
      // Without that column, appends leave the export of records alone.
      expect(typeof (await during(model, append, { columns: ["service", "trend"] }))).toBe(
        "string",
      );
    }
  });

  it("writes the columns and displays it started with, whatever the grid changes to", async () => {
    const { model } = services();
    // Titles and headings too, changed before the export wrote its first line.
    const titled = exportGrid(model);
    model.update({ fields: { latency: { label: "After" } } });
    model.setColumns(model.columns.map((column) => ({ ...column, heading: "New" })));
    expect((await lines(await titled))[0]).toEqual([
      "service",
      "Latency, latency",
      "Traffic, Count, requests",
      "at",
    ]);
    expect(model.columnTitle("latency")).toBe("New, After");
    const ended = await during(model, () => {
      model.setColumnVisible("service", false);
      model.update({ fields: { latency: { format: { number: ".2f" } } } });
    });
    expect(parse(ended as string, ",")[0]).toEqual([
      "auth",
      "120",
      "1,204",
      "Jan 1, 2026, 00:00:00",
    ]);
  });
});

describe("exportGrid of a remote grid", () => {
  const settle = async () => {
    for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  /** The answer with no rows: a window past the end of its list. */
  const emptied = (answer: RowsWindow): RowsWindow =>
    ({
      ...answer,
      length: 0,
      columns: Object.fromEntries(
        Object.entries(answer.columns).map(([field, column]) => [
          field,
          column instanceof Float64Array
            ? column.subarray(0, 0)
            : { ...column, codes: column.codes.subarray(0, 0) },
        ]),
      ),
    }) as RowsWindow;

  function remote(
    length = 700,
    blockSize = 128,
    change: (request: RowsRequest, answer: RowsWindow) => RowsWindow = (_, answer) => answer,
  ) {
    const data = table({
      id: Float64Array.from({ length }, (_, i) => i),
      ms: Float64Array.from({ length }, (_, i) => i % 10),
      host: category(Array.from({ length }, (_, i) => ["web", "api", "db"][i % 3]!)),
    });
    const memory = memorySource(data, { key: "id", snapshots: 64 });
    const released: string[] = [];
    const asked: RowsRequest[] = [];
    const answered: string[] = [];
    /** `delay`: ms an answer takes, so requests overlap. */
    const flight = {
      now: 0,
      most: 0,
      afterAbort: 0,
      totals: 0,
      delay: (_: RowsRequest) => 0,
    };
    /** While set, requests wait for it. */
    const gate: { held: Promise<void> | null; open(): void } = {
      held: null,
      open() {},
    };
    const hold = () => {
      gate.held = new Promise((resolve) => {
        gate.open = () => {
          gate.held = null;
          resolve();
        };
      });
    };
    const source: GridSource = {
      schema: memory.schema,
      rows: async (request, signal) => {
        asked.push(request);
        if (signal?.aborted) flight.afterAbort++;
        flight.most = Math.max(flight.most, ++flight.now);
        try {
          if (gate.held) await gate.held;
          const delay = flight.delay(request);
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          const answer = change(request, await memory.rows(request, signal));
          answered.push(answer.snapshot);
          return answer;
        } finally {
          flight.now--;
        }
      },
      totals: async (request, signal) => {
        flight.totals++;
        if (gate.held) await gate.held;
        return memory.totals(request, signal);
      },
      release: (snapshot) => {
        released.push(snapshot);
        memory.release(snapshot);
      },
    };
    const model = createRemoteGridModel({
      source,
      blockSize,
      columns: [{ field: "id" }, { field: "host" }, { field: "ms", aggregate: "ms" }],
      locale: "en-US",
    } as never);
    model.setViewport(600, 300);
    return { data, memory, source, model, released, asked, answered, flight, gate, hold };
  }

  it("reads every row of the grid's snapshot, two requests at most at a time", async () => {
    const { model, asked, answered, flight } = remote();
    await settle();
    const before = asked.length;
    flight.most = 0;
    const rows = await lines(await exportGrid(model, { headers: false, values: "raw" }));
    expect(rows).toHaveLength(700);
    expect(rows[699]).toEqual(["699", "web", "9"]);
    const ours = asked.slice(before);
    expect(ours).toHaveLength(6);
    expect(ours.every((request) => request.snapshot === answered[0])).toBe(true);
    expect(flight.most).toBeLessThanOrEqual(2);
  });

  it("shares a held snapshot among exports, released once the last ends", async () => {
    const { model, released, gate, hold } = remote();
    await settle();
    hold();
    const first = exportGrid(model, { headers: false });
    const second = exportGrid(model, { headers: false, values: "raw" });
    model.refresh();
    await settle();
    expect(released).toHaveLength(0);
    gate.open();
    expect(await lines(await first)).toHaveLength(700);
    await settle();
    expect(await lines(await second)).toHaveLength(700);
    await settle();
    expect(released).toHaveLength(1);
  });

  it("holds the snapshot across a new query, released once the export ends", async () => {
    const { model, released, answered, gate, hold } = remote();
    await settle();
    hold();
    const exported = exportGrid(model, { headers: false });
    model.setQuery({ filter: ["==", ["field", "host"], "db"] });
    await settle();
    expect(released).toHaveLength(0);
    gate.open();
    const rows = await lines(await exported);
    // Of the snapshot the grid showed as the export began.
    expect(new Set(answered).size).toBe(2);
    expect(rows).toHaveLength(700);
    await settle();
    expect(released).toHaveLength(1);
  });

  it("fails when the source no longer has the snapshot", async () => {
    const { data, model } = remote();
    await settle();
    const exported = exportGrid(model, { headers: false });
    // The memory source expires every snapshot as its table changes.
    data.append({ id: [700], ms: [1], host: ["web"] } as never);
    await expect(exported).rejects.toMatchObject({
      code: "snapshot-expired",
      message: "exportGrid: the source no longer has the rows' snapshot; export again",
    });
  });

  it("writes groups as shown, the rows of those expanded, and totals asked of the source", async () => {
    const { model } = remote(9, 4);
    model.setQuery({
      group: { by: ["host"], aggregate: [{ op: "mean", field: "ms", as: "ms" }] },
    });
    model.update({ totals: [{ op: "mean", field: "ms", as: "ms" }] });
    await settle();
    model.setExpanded(["api"], true);
    await settle();
    const rows = await lines(await exportGrid(model));
    expect(rows).toEqual([
      ["id", "host", "ms"],
      ["api (3)", "api", "4"],
      ["1", "api", "1"],
      ["4", "api", "4"],
      ["7", "api", "7"],
      ["db (3)", "db", "5"],
      ["web (3)", "web", "3"],
      ["Total", "", "4"],
    ]);
    // As the grid shows them.
    const shown = Array.from({ length: model.rowCount }, (_, row) =>
      model.columnLayout.map((_, column) => model.textAt(row, column)),
    );
    expect(rows.slice(1, -1)).toEqual(shown);
    await expect(exportGrid(model, { rows: "selected" })).rejects.toThrow(
      'exportGrid rows: a remote grid exports the rows it shows, not its records or selection; give rows: "shown"',
    );
  });

  it("starts a snapshot of its own for a grid still waiting for its first rows, and releases it", async () => {
    const { model, released } = remote(10);
    const rows = await lines(await exportGrid(model, { headers: false }));
    expect(rows).toHaveLength(10);
    await settle();
    expect(released.length).toBeGreaterThanOrEqual(1);
    model.dispose();
  });

  it("stops its requests when stopped, and rejects with the signal's reason", async () => {
    const { model, asked, flight } = remote(2000, 50);
    await settle();
    const before = asked.length;
    const stop = new AbortController();
    const reason = new Error("stopped");
    const exported = exportGrid(model, { signal: stop.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop.abort(reason);
    await expect(exported).rejects.toBe(reason);
    await settle();
    expect(asked.length - before).toBeLessThan(5);
    expect(flight.now).toBe(0);
    // Nothing is asked once it ended.
    expect(flight.afterAbort).toBe(0);
  });

  it("ends at once when stopped, whatever its source does with the signal, and lets go of the snapshot", async () => {
    const { model, released, gate, hold, answered } = remote();
    await settle();
    // The source answers nothing until the gate opens, stopped or not.
    hold();
    const stop = new AbortController();
    const reason = new Error("stopped");
    const exported = exportGrid(model, { signal: stop.signal });
    await settle();
    stop.abort(reason);
    await expect(exported).rejects.toBe(reason);
    model.refresh();
    await settle();
    expect(released).toEqual([answered[0]]);
    gate.open();
  });

  it("lets go of the signal when stopped while its source never answers rows or totals", async () => {
    const listeners = (signal: AbortSignal) => getEventListeners(signal, "abort").length;
    // Rows: no window answers.
    const rows = remote();
    await settle();
    rows.hold();
    const stop = new AbortController();
    const exported = exportGrid(rows.model, { signal: stop.signal });
    await settle();
    // Waiting: its own listener and the wait's.
    expect(listeners(stop.signal)).toBe(2);
    stop.abort();
    await expect(exported).rejects.toMatchObject({ name: "AbortError" });
    expect(listeners(stop.signal)).toBe(0);
    rows.gate.open();
    // Totals: the rows answer, and the totals, the grid's and the export's own, never do.
    const totals = remote(10);
    totals.source.totals = () => new Promise(() => {});
    totals.model.update({ totals: [{ op: "mean", field: "ms", as: "ms" }] } as never);
    await settle();
    const later = new AbortController();
    const waiting = exportGrid(totals.model, { signal: later.signal });
    await settle();
    expect(listeners(later.signal)).toBe(2);
    later.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(listeners(later.signal)).toBe(0);
  });

  it("ends the requests it queued as it ends, though those out never answer", async () => {
    const { model, source } = remote(9, 2);
    model.setQuery({
      group: { by: ["host"], aggregate: [{ op: "mean", field: "ms", as: "ms" }] },
    });
    await settle();
    model.setExpanded(["api"], true);
    // The totals, the grid's and the export's, never answer.
    source.totals = () => new Promise(() => {});
    model.update({ totals: [{ op: "mean", field: "ms", as: "ms" }] });
    await settle();
    // The export's first window answers; the one asked ahead never does, so the expanded
    // group's rows wait behind it and the totals.
    const rows = source.rows;
    let calls = 0;
    source.rows = (request, signal) =>
      ++calls === 1 ? rows(request, signal) : new Promise(() => {});
    // The reader's waits, as the export reads.
    const waits: string[] = [];
    const read = model[EXPORT_ROWS].bind(model);
    model[EXPORT_ROWS] = (request) =>
      read(request).then((reader) => {
        const next = reader.next;
        reader.next = (cells, plain) => {
          const more = next(cells, plain);
          if (typeof more === "boolean") return more;
          const at = waits.push("waiting") - 1;
          more.then(
            () => {
              waits[at] = "answered";
            },
            () => {
              waits[at] = "ended";
            },
          );
          return more;
        };
        return reader;
      });
    const stop = new AbortController();
    const exported = exportGrid(model, { signal: stop.signal });
    await settle();
    expect(calls).toBe(2);
    expect(waits).toEqual(["answered", "waiting"]);
    stop.abort();
    await expect(exported).rejects.toMatchObject({ name: "AbortError" });
    await settle();
    expect(waits).toEqual(["answered", "ended"]);
    // The group's rows never reached the source.
    expect(calls).toBe(2);
  });

  it("asks nothing once stopped before its reader loaded, totals included", async () => {
    const { model, asked, flight, hold, gate } = remote();
    await settle();
    // The grid's totals still loading: an export would ask for its own.
    hold();
    model.update({ totals: [{ op: "mean", field: "ms", as: "ms" }] });
    await settle();
    const before = { rows: asked.length, totals: flight.totals };
    const stop = new AbortController();
    const exported = exportGrid(model, { signal: stop.signal });
    stop.abort();
    await expect(exported).rejects.toMatchObject({ name: "AbortError" });
    await settle();
    expect([asked.length, flight.totals]).toEqual([before.rows, before.totals]);
    gate.open();
  });

  it("asks at most two windows at a time through groups of groups, writing them as shown", async () => {
    const { model, flight } = remote(60, 2);
    model.setColumns([{ field: "id" }, { field: "host" }, { field: "ms" }] as never);
    model.setQuery({ group: { by: ["ms", "host"], aggregate: [{ op: "count", as: "n" }] } });
    await settle();
    for (let ms = 0; ms < 10; ms++) model.setExpanded([ms], true);
    await settle();
    for (let ms = 0; ms < 10; ms++)
      for (const host of ["web", "api", "db"]) model.setExpanded([ms, host], true);
    await settle();
    flight.most = 0;
    // The first level's windows answer slowly: one asked ahead is still out as the export goes
    // into a group, and into a group of it.
    flight.delay = (request) => (request.parent.length === 0 ? 20 : 1);
    const rows = await lines(await exportGrid(model, { headers: false }));
    expect(flight.most).toBeLessThanOrEqual(2);
    // Ten values of ms, three hosts under each, and the 60 rows, as the grid shows those it loaded.
    expect(rows).toHaveLength(100);
    const shown = Array.from({ length: 8 }, (_, row) =>
      model.columnLayout.map((_, column) => model.textAt(row, column)),
    );
    expect(rows.slice(0, 8)).toEqual(shown);
  });

  it("fails on answers whose totals contradict the rows the list's answers hold", async () => {
    // A full window with no total, then one past it saying the list is empty.
    const { model } = remote(300, 128, (request, answer) =>
      request.offset === 0
        ? { ...answer, total: null }
        : request.offset === 128
          ? { ...emptied(answer), total: 0 }
          : answer,
    );
    await settle();
    await expect(exportGrid(model)).rejects.toMatchObject({
      code: "invalid-response",
      message: expect.stringContaining("short of their rows"),
    });
  });

  it("releases a snapshot it started whose first answer it refused", async () => {
    let first = true;
    let started = "";
    const { model, released } = remote(10, 128, (request, answer) => {
      if (request.snapshot !== null) return answer;
      // The grid's first request starts its snapshot; the export's, another, with a field of the wrong kind.
      if (first) {
        first = false;
        return answer;
      }
      started = answer.snapshot;
      return {
        ...answer,
        columns: { ...answer.columns, ms: new Int32Array(answer.length) },
      } as never;
    });
    await expect(exportGrid(model)).rejects.toMatchObject({ code: "invalid-response" });
    await settle();
    expect(started).not.toBe("");
    expect(released).toContain(started);
    model.dispose();
  });
});
