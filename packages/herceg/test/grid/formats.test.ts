// Grid formats and field displays: columns' own formats in every form axes
// take, refused by kind; `fields` given as rules or compiled displays, and
// one compilation shared with charts; pivot grids' titles, headings, and
// cells through displays; and `update`, which keeps the grid's state and
// changes nothing when it is refused.
import { describe, expect, it } from "vitest";
import { count, max, mean, sum } from "../../src/data/aggregations.ts";
import { category, time } from "../../src/data/column.ts";
import { groupRows } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { chartFieldsOf } from "../../src/fields/compile.ts";
import { compileFields, type FieldDisplays } from "../../src/fields.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridColumn } from "../../src/grid/model.ts";
import { createPivotGridModel } from "../../src/grid/pivot.ts";
import { createRemoteGridModel } from "../../src/grid/remote.ts";
import { estimateText } from "../../src/layout/text.ts";
import { point } from "../../src/marks/point.ts";
import { GUIDE_KIT } from "../../src/model/guides.ts";
import { type ChartConfig, ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import type { AxisGuide } from "../../src/scene/scene.ts";

const HOUR = 3_600_000;

/** Requests: a latency in milliseconds, sizes in bytes, counts, and times, with a missing row. */
const requests = () =>
  table(
    {
      at: time([Date.UTC(2026, 4, 1, 9, 30), Date.UTC(2026, 0, 2, 23), Number.NaN, 9e15]),
      ms: [66_000, 450, Number.NaN, 0.5],
      bytes: [1_572_864, 1023, Number.NaN, 3 * 2 ** 40],
      n: [1234, -0.0001, Number.NaN, 2e6],
      region: category(["eu", "us", null, "eu"]),
      status: category(["200", "503", "503", null]),
    },
    { name: "requests" },
  );

type Requests = ReturnType<typeof requests> extends Table<infer S> ? S : never;

function cells(
  model: {
    rowCount: number;
    textAt(row: number, column: number): string;
    columnIndex(id: string): number;
  },
  id: string,
) {
  return Array.from({ length: model.rowCount }, (_, row) =>
    model.textAt(row, model.columnIndex(id)),
  );
}

const local = <S extends Schema>(
  columns: readonly GridColumn<S>[],
  fields?: FieldDisplays,
  timeZone = "UTC",
) =>
  createGridModel({
    data: rowView(requests()) as never,
    columns: columns as never,
    locale: "en-US",
    timeZone,
    ...(fields && { fields }),
  });

describe("grid columns' formats", () => {
  it("write numbers in every form axes take, missing values empty", () => {
    const model = local<Requests>([
      { field: "n", id: "intl", format: { maximumFractionDigits: 0 } },
      { field: "n", id: "pattern", format: { number: ",.2f", prefix: "$", suffix: " req" } },
      { field: "n", id: "si", format: { number: ".3~s" } },
      { field: "ms", format: { duration: "millisecond" } },
      { field: "ms", id: "decimals", format: { duration: "second", maxUnits: 1, decimals: 1 } },
      { field: "bytes", format: { binary: "B" } },
      { field: "bytes", id: "prefixed", format: { si: "B", decimals: 2 } },
    ]);
    expect(cells(model, "intl")).toEqual(["1,234", "0", "", "2,000,000"]);
    expect(cells(model, "pattern")).toEqual([
      "$1,234.00 req",
      "$0.00 req",
      "",
      "$2,000,000.00 req",
    ]);
    expect(cells(model, "si")).toEqual(["1.23k", "-100µ", "", "2M"]);
    expect(cells(model, "ms")).toEqual(["1m 6s", "450ms", "", "500µs"]);
    expect(cells(model, "decimals")).toEqual(["18.3h", "7.5m", "", "500.0ms"]);
    expect(cells(model, "bytes")).toEqual(["1.5 MiB", "1,023 B", "", "3 TiB"]);
    expect(cells(model, "prefixed")).toEqual(["1.57 MB", "1.02 kB", "", "3.30 TB"]);
  });

  it("write times in Intl options and patterns, with fiscal years, in the grid's zone", () => {
    const model = local<Requests>([
      { field: "at", id: "default" },
      { field: "at", id: "intl", format: { dateStyle: "medium" } },
      { field: "at", id: "pattern", format: { time: "%Y-%m-%d %H:%M" } },
      { field: "at", id: "fiscal", format: { time: "FY%Y Q%q", fiscal: { start: 4 } } },
    ]);
    expect(cells(model, "default").slice(0, 3)).toEqual([
      "May 1, 2026, 09:30:00",
      "Jan 2, 2026, 23:00:00",
      "",
    ]);
    expect(cells(model, "intl").slice(0, 2)).toEqual(["May 1, 2026", "Jan 2, 2026"]);
    expect(cells(model, "pattern").slice(0, 2)).toEqual(["2026-05-01 09:30", "2026-01-02 23:00"]);
    expect(cells(model, "fiscal").slice(0, 2)).toEqual(["FY2027 Q1", "FY2026 Q4"]);
    // Past the dates Intl writes: the number itself, in every form.
    expect(
      new Set(["default", "intl", "pattern", "fiscal"].map((id) => cells(model, id)[3])),
    ).toEqual(new Set(["9,000,000,000,000,000"]));
  });

  it("refuse formats their fields' kinds cannot take, and malformed ones, naming the column", () => {
    const refused = (column: object, message: string) =>
      expect(() => local([{ field: "n" }, column] as never)).toThrow(message);
    refused(
      { field: "region", format: { number: ",.0f" } },
      'grid columns[1].format: "region" holds categories; formats are for numbers and times; drop format',
    );
    refused(
      { field: "at", format: { duration: "millisecond" } },
      'grid columns[1].format: "at" holds times; give { time } or Intl date options',
    );
    refused(
      { field: "ms", format: { time: "%H" } },
      'grid columns[1].format: "ms" holds numbers; give a number format',
    );
    refused(
      { field: "ms", format: { duration: "ms" } },
      "grid columns[1].format.duration: expected",
    );
    refused(
      { field: "ms", format: { number: "q" } },
      'grid columns[1].format.number: "q" is not a number pattern',
    );
    refused(
      { field: "ms", format: { si: "B", maxUnits: 2 } },
      "grid columns[1].format.maxUnits: describes durations",
    );
    refused(
      { field: "ms", format: { maximumDigits: 2 } },
      "grid columns[1].format.maximumDigits: not an Intl format option",
    );
    refused(
      { field: "at", format: { dateStyle: "short", fiscal: { start: 4 } } },
      "grid columns[1].format.fiscal: Intl options write no fiscal year",
    );
  });

  it("refuse patterns past Intl's bounds as columns are described, not as cells are read", () => {
    expect(() => local([{ field: "n", format: { number: ".22g" } }])).toThrow(
      'grid columns[0].format.number: ".22g" asks for 22 significant digits; give 1 to 21',
    );
    const view = rowView(requests());
    const pivot = pivotRows(view, { rows: "region", pivot: "status", ops: { avg: mean("ms") } });
    expect(() =>
      createPivotGridModel({ data: pivot, aggregates: { avg: { format: { number: ",.21f" } } } }),
    ).toThrow('pivot grid aggregates.avg.format.number: ",.21f" asks for 21 decimals');
    // Group keys of a field no column shows, through an update.
    const groups = groupRows(view, { by: ["n"], ops: { c: count() } });
    const model = createGridModel({ data: view, groups, columns: [{ field: "ms" }] });
    expect(() => model.update({ fields: { n: { format: { number: ".22g" } } } })).toThrow(
      'grid fields.n.format.number: ".22g" asks for 22 significant digits',
    );
    expect(model.textAt(0, 0)).toBe("1,234 (1)");
  });

  it("write every value without throwing: infinities, extremes, and the ends of dates in any zone", () => {
    const extremes = [
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1e308,
      -1e308,
      5e-324,
      -0,
    ];
    const ends = [8.64e15, -8.64e15, 8.64e15 - 1, Number.POSITIVE_INFINITY];
    const numberForms = [
      { maximumFractionDigits: 0 },
      { number: ",.2f", prefix: "$" },
      { number: ".3~s" },
      { number: ".2e" },
      { duration: "millisecond" },
      { si: "B" },
      { binary: "B" },
    ];
    const timeForms = [
      undefined,
      { dateStyle: "medium" },
      { time: "%b %d %Y" },
      { time: "%Y Q%q", fiscal: { start: 4 } },
    ];
    for (const timeZone of ["Asia/Tokyo", "America/Los_Angeles", "UTC"]) {
      const data = table({
        n: [...extremes, ...extremes.slice(0, 4)],
        at: time([...ends, ...ends, 0, 0]),
      });
      const columns = [
        ...numberForms.map((format, i) => ({ field: "n", id: `n${i}`, format })),
        ...timeForms.map((format, i) => ({ field: "at", id: `t${i}`, ...(format && { format }) })),
      ];
      for (const fields of [undefined, { at: { format: { time: "%b" } } }]) {
        const model = createGridModel({
          data: rowView(data),
          columns: columns as never,
          timeZone,
          locale: "en-US",
          ...(fields && { fields }),
        });
        for (let row = 0; row < model.rowCount; row++)
          for (let column = 0; column < columns.length; column++) model.textAt(row, column);
      }
      // A pivot over such times takes displays that write them.
      const pivot = pivotRows(rowView(data), { rows: "n", pivot: "at", ops: { c: count() } });
      const model = createPivotGridModel({ data: pivot, timeZone, locale: "en-US" });
      model.update({ fields: { at: { format: { time: "%b" } } } });
      expect(model.columnLayout.length).toBeGreaterThan(1);
    }
  });

  it("refuse a time zone that is none as the grid is made", () => {
    expect(() => local([{ field: "at", format: { time: "%Y" } }], undefined, "Not/AZone")).toThrow(
      'grid timeZone: "Not/AZone" is not a time zone; give "UTC", "local", or an IANA zone such as "Europe/Belgrade"',
    );
    const source = memorySource(requests(), { name: "requests" });
    expect(() =>
      createRemoteGridModel({ source, columns: [{ field: "ms" }], timeZone: "Mars/Olympus" }),
    ).toThrow('remote grid timeZone: "Mars/Olympus" is not a time zone');
  });

  it("are checked as remote grids take them, naming the remote grid", () => {
    const source = memorySource(requests(), { name: "requests" });
    const make = (columns: object[]) => () =>
      createRemoteGridModel({ source, columns: columns as never, locale: "en-US" });
    expect(make([{ field: "region", format: { number: ",.0f" } }])).toThrow(
      'remote grid columns[0].format: "region" holds categories',
    );
    expect(make([{ field: "ms", format: { duration: "millisecond" } }])).not.toThrow();
  });
});

const RULES: FieldDisplays = [
  { match: { kind: "number" }, missing: "–" },
  { match: "ms", label: "Latency", format: { duration: "millisecond" } },
  { match: "status", label: "Status", mappings: [{ value: "503", text: "Unavailable" }] },
  { match: { table: "requests", field: "region" }, label: "Region", missing: "nowhere" },
];

describe("grid fields", () => {
  it("take rules as charts do, or displays compiled once, alike", () => {
    const columns: GridColumn<Requests>[] = [
      { field: "ms" },
      { field: "ms", id: "own", format: { number: ",.1f", suffix: " ms" } },
      { field: "status" },
      { field: "region" },
    ];
    const given = local(columns, RULES);
    const compiled = local(columns, compileFields(RULES) as never);
    for (const model of [given, compiled]) {
      expect(model.columnLayout.map(({ title }) => title)).toEqual([
        "Latency",
        "Latency",
        "Status",
        "Region",
      ]);
      expect(cells(model, "ms")).toEqual(["1m 6s", "450ms", "–", "500µs"]);
      // A column's own format replaces the field's; its missing text stays.
      expect(cells(model, "own")).toEqual(["66,000.0 ms", "450.0 ms", "–", "0.5 ms"]);
      expect(cells(model, "status")).toEqual(["200", "Unavailable", "Unavailable", ""]);
      expect(cells(model, "region")).toEqual(["eu", "us", "nowhere", "eu"]);
    }
  });

  it("refuse malformed rules, naming them as the grid's", () => {
    expect(() => local([{ field: "ms" }], [{ match: { regex: "^ms(" } }])).toThrow(
      'grid fields[0].match.regex: "^ms(" is not a regular expression',
    );
    expect(() => local([{ field: "ms" }], { ms: { format: { duration: "ms" } } } as never)).toThrow(
      "grid fields.ms.format.duration: expected",
    );
    // A rule naming a field refuses what its kind cannot take, as the column is described.
    expect(() => local([{ field: "region" }], { region: { format: { number: ",.0f" } } })).toThrow(
      'grid fields.region.format: "region" holds categories',
    );
    const source = memorySource(requests(), { name: "requests" });
    expect(() =>
      createRemoteGridModel({
        source,
        columns: [{ field: "ms" }],
        fields: [{ match: { kind: "nothing" } }] as never,
      }),
    ).toThrow('remote grid fields[0].match.kind: expected "number", "time", or "category"');
  });

  it("share one compilation among grids and charts", () => {
    const compiled = compileFields(RULES);
    const grid = local([{ field: "ms" }], compiled as never);
    expect(cells(grid, "ms")[0]).toBe("1m 6s");
    // Charts compile the displays with their own code once, whichever form they are given in.
    const shown = chartFieldsOf(compiled, GUIDE_KIT as never, "en-US", "UTC");
    expect(chartFieldsOf(compiled.displays, GUIDE_KIT as never, "en-US", "UTC")).toBe(shown);
    const data = table({ t: time([0, HOUR, 2 * HOUR]), ms: [1000, 60_000, 120_000] });
    const ticks = (fields: ChartConfig["fields"]) => {
      const model = new ChartModel(
        { locale: "en-US", timeZone: "UTC", fields, marks: [point(data, { x: "t", y: "ms" })] },
        undefined,
        staticCompilers(),
      );
      model.setSize(400, 300, 1);
      const scene = model.scene(estimateText);
      const axis = scene.panels[0]!.axes.find(
        (a): a is AxisGuide => a.kind === "axis" && a.scale === "y",
      )!;
      return axis.ticks.map(({ label }) => label);
    };
    const labels = ticks(compiled);
    expect(labels).toContain("1m");
    expect(ticks(RULES)).toEqual(labels);
  });
});

describe("pivot grids' fields", () => {
  /** Requests by region and status: a count, a mean latency, the latest time, and a sum of times. */
  function pivoted(options: object = {}) {
    const view = rowView(requests());
    const pivot = pivotRows(view, {
      rows: "region",
      pivot: "status",
      ops: { n: count(), avg: mean("ms"), last: max("at"), total: sum("at") },
    });
    const model = createPivotGridModel({
      data: pivot,
      locale: "en-US",
      timeZone: "UTC",
      fields: RULES,
      ...options,
    });
    model.setViewport(2000, 200);
    return model;
  }
  const titles = (model: ReturnType<typeof pivoted>) =>
    model.columnLayout.map((column) => model.columnTitle(column.id));
  const row = (model: ReturnType<typeof pivoted>, index: number) =>
    model.columnLayout.map((_, column) => model.textAt(index, column));

  it("title the rows column by its field's label, and head values by their mapped text", () => {
    const model = pivoted();
    expect(model.columnLayout[0]!.title).toBe("Region");
    expect(titles(model).slice(1, 5)).toEqual(["200, n", "200, avg", "200, last", "200, total"]);
    // Mapped text heads the value's columns; ids keep the raw value.
    expect(titles(model)).toContain("Unavailable, avg");
    expect(titles(model)).toContain("(missing), n");
    const ids = model.columnLayout.map(({ id }) => id).filter((id) => id.includes('"503"'));
    expect(ids.length).toBe(4);
  });

  it("write cells by operation and kind: a field's own in its format, counts and changed kinds plainly", () => {
    const model = pivoted();
    const at = (title: string) =>
      model.columnLayout.findIndex((column) => model.columnTitle(column.id) === title);
    const texts = row(model, 0);
    expect(texts[0]).toBe("eu");
    expect(texts[at("200, n")]).toBe("1");
    expect(texts[at("200, avg")]).toBe("1m 6s");
    expect(texts[at("200, last")]).toBe("May 1, 2026, 09:30:00");
    // A sum of times is no time: a plain number.
    expect(texts[at("200, total")]).toBe("1,777,627,800,000");
    // A missing key is a row of its own, written by its field's missing text.
    const keys = Array.from({ length: model.rowCount }, (_, i) => model.textAt(i, 0));
    expect(keys).toEqual(["eu", "us", "nowhere"]);
  });

  it("take formats in every form: the rows column's, aggregates', and valueFormat, over displays", () => {
    const model = pivoted({
      rowColumn: { title: "Where" },
      aggregates: {
        avg: { format: { number: ",.0f", suffix: " ms" } },
        last: { format: { time: "%H:%M" } },
      },
    });
    const at = (title: string) =>
      model.columnLayout.findIndex((column) => model.columnTitle(column.id) === title);
    expect(model.columnLayout[0]!.title).toBe("Where");
    expect(row(model, 0)[at("200, avg")]).toBe("66,000 ms");
    expect(row(model, 0)[at("200, last")]).toBe("09:30");
    expect(() => pivoted({ aggregates: { n: { format: { time: "%H" } } } })).toThrow(
      'pivot grid aggregates.n.format: "n" holds numbers; give a number format',
    );
    expect(() => pivoted({ valueFormat: { number: ",.0f" } })).toThrow(
      'pivot grid valueFormat: "status" holds categories; formats are for numbers and times; drop valueFormat',
    );
    expect(() => pivoted({ rowColumn: { format: { si: "B" } } })).toThrow(
      'pivot grid rowColumn.format: "region" holds categories',
    );
  });

  it("head time values in valueFormat, and write without displays as other grids do", () => {
    const view = rowView(requests());
    const pivot = pivotRows(view, { rows: "status", pivot: "at", ops: { n: count() } });
    const model = createPivotGridModel({
      data: pivot,
      locale: "en-US",
      timeZone: "UTC",
      valueFormat: { time: "%b %d" },
    });
    // Times ascending, the one past what dates hold as a number, and the missing one last.
    expect(model.columnLayout.slice(1).map(({ title }) => title)).toEqual([
      "Jan 02",
      "May 01",
      "9,000,000,000,000,000",
      "(missing)",
    ]);
    const keys = Array.from({ length: model.rowCount }, (_, i) => model.textAt(i, 0));
    expect(keys).toContain("(missing)");
  });

  it("take new displays with update, refusing a bad one whole", () => {
    const model = pivoted();
    model.resizeColumn("region", 200);
    const before = row(model, 0);
    const revision = model.revision;
    expect(() =>
      model.update({ fields: [{ match: "ms", format: { duration: "ms" } }] as never }),
    ).toThrow("pivot grid fields[0].format.duration");
    expect(model.revision).toBe(revision);
    expect(row(model, 0)).toEqual(before);
    model.update({ fields: undefined });
    expect(model.columnLayout[0]!.title).toBe("region");
    expect(model.columnLayout[0]!.width).toBe(200);
    expect(model.textAt(2, 0)).toBe("(missing)");
    expect(titles(model)).toContain("503, avg");
  });

  it("catch up with the pivot before writing its columns anew", () => {
    const data = table({
      code: [10, 20, 30, 40, 50],
      region: category(["a", "b", "a", "b", "a"]),
      ms: [1, 2, 3, 4, 5],
    });
    const pivot = pivotRows(rowView(data), { rows: "region", pivot: "code", ops: { n: count() } });
    const model = createPivotGridModel({ data: pivot, locale: "en-US" });
    model.setViewport(250, 100);
    const idOf = (title: string) => model.columnLayout.find((column) => column.title === title)!.id;
    const [ten, twenty] = [idOf("10"), idOf("20")];
    const onScreen = (id: string) =>
      model.columnLayout.find((column) => column.id === id)!.x - model.left;
    model.setSort([{ field: ten, order: "descending" }]);
    // "20" is the first column in view.
    model.scrollTo({ left: 240 });
    expect(onScreen(twenty)).toBe(0);
    // Value 10 leaves with its row; the updates come before anything reads the model.
    data.dropFirst(1);
    // One refused changes nothing, not even catching up, which reads do.
    expect(() => model.update({ fields: { region: { format: { number: ",.0f" } } } })).toThrow(
      'pivot grid fields.region.format: "region" holds categories',
    );
    expect(model.left).toBe(240);
    model.update({ fields: { n: { label: "Requests" } } });
    expect(model.sort).toEqual([]);
    expect(model.columnLayout.map(({ title }) => title)).toEqual([
      "region",
      "20",
      "30",
      "40",
      "50",
    ]);
    expect(onScreen(twenty)).toBe(0);
    expect(() => model.cycleSort(twenty, { additive: true })).not.toThrow();
  });
});

describe("update", () => {
  function grouped() {
    const data = table({
      host: category(["web", "api", "web", "db", "api", "web"]),
      id: Float64Array.from({ length: 6 }, (_, i) => i),
      ms: [10, 20, 30, 1980, 50, 60],
    });
    const view = rowView(data);
    const groups = groupRows(view, { by: ["host"], ops: { avg: mean("ms") } });
    const model = createGridModel({
      data: view,
      groups,
      columns: [
        { field: "host", width: 150, pin: "left" },
        { field: "id", hidden: true },
        { field: "ms", aggregate: "avg", width: 400 },
        { field: "ms", id: "again", width: 400 },
      ],
      locale: "en-US",
      rowHeight: 10,
    });
    model.setViewport(400, 30);
    model.setExpanded(["web"], true);
    model.setExpanded(["db"], true);
    model.setSort([{ field: "ms", order: "descending" }]);
    model.select(2, "only");
    model.scrollTo({ top: 20, left: 100 });
    model.focusCell(4, "ms");
    return model;
  }
  const state = (model: ReturnType<typeof grouped>) => ({
    columns: model.columns,
    sort: model.sort,
    top: model.top,
    left: model.left,
    focus: model.focus,
    selected: model.selectedCount,
    expanded: [model.isExpanded(["web"]), model.isExpanded(["db"]), model.isExpanded(["api"])],
    rows: model.rowCount,
  });

  it("keeps layout, sort, groups, selection, focus, and scroll, telling listeners once", () => {
    const model = grouped();
    const before = state(model);
    let heard = 0;
    model.subscribe(() => heard++);
    model.update({
      fields: { ms: { format: { duration: "millisecond" } }, host: { label: "Host" } },
    });
    expect(heard).toBe(1);
    expect(state(model)).toEqual(before);
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["Host", "ms", "ms"]);
    const rows = Array.from({ length: model.rowCount }, (_, i) => model.textAt(i, 2));
    expect(rows).toContain("1s 980ms");
    // Left out, fields stay; an empty update changes nothing.
    model.update({});
    expect(heard).toBe(1);
  });

  it("changes nothing when refused: the whole update is checked first", () => {
    const model = grouped();
    model.update({ fields: { ms: { label: "Latency" } } });
    const before = state(model);
    const texts = Array.from({ length: model.rowCount }, (_, i) => model.textAt(i, 0));
    const revision = model.revision;
    let heard = 0;
    model.subscribe(() => heard++);
    // A rule its field's kind refuses fails as the columns are described, after compiling.
    expect(() => model.update({ fields: { host: { format: { number: ",.0f" } } } })).toThrow(
      'grid fields.host.format: "host" holds categories',
    );
    expect(() => model.update({ fields: [{ match: { regex: "(" } }] })).toThrow(
      "grid fields[0].match.regex",
    );
    expect(() => model.update({ columns: [] } as never)).toThrow(
      "grid update.columns: unknown option; use fields",
    );
    expect(() => model.update(null as never)).toThrow(
      "grid update: expected options such as { fields }",
    );
    expect(heard).toBe(0);
    expect(model.revision).toBe(revision);
    expect(state(model)).toEqual(before);
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["host", "Latency", "Latency"]);
    expect(Array.from({ length: model.rowCount }, (_, i) => model.textAt(i, 0))).toEqual(texts);
  });

  it("checks the keys of grouping fields no column shows, as grids are made and regrouped too", () => {
    const data = table({ host: category(["web", "api"]), ms: [1, 2] });
    const view = rowView(data);
    const groups = groupRows(view, { by: ["host"], ops: { n: count() } });
    const model = createGridModel({ data: view, groups, columns: [{ field: "ms" }] });
    const revision = model.revision;
    const refused = { host: { format: { number: ",.0f" } } } as never;
    expect(() => model.update({ fields: refused })).toThrow(
      'grid fields.host.format: "host" holds categories',
    );
    expect(model.revision).toBe(revision);
    expect(model.textAt(0, 0)).toBe("web (1)");
    expect(() =>
      createGridModel({ data: view, groups, columns: [{ field: "ms" }], fields: refused }),
    ).toThrow('grid fields.host.format: "host" holds categories');
    const displayed = createGridModel({ data: view, columns: [{ field: "ms" }], fields: refused });
    expect(() => displayed.setGroups(groups)).toThrow(
      'grid fields.host.format: "host" holds categories',
    );
    expect(displayed.groups).toBe(null);
  });

  it("checks remote grids' grouping keys before a query or an update is taken", async () => {
    const source = memorySource(requests(), { name: "requests" });
    const refused = { region: { format: { number: ",.0f" } } } as never;
    const model = createRemoteGridModel({
      source,
      columns: [{ field: "ms" }],
      fields: refused,
      locale: "en-US",
    });
    const group = { group: { by: ["region"], aggregate: [] } } as never;
    expect(() => model.setQuery(group)).toThrow(
      'remote grid fields.region.format: "region" holds categories',
    );
    expect(model.query.group).toBe(undefined);
    model.update({ fields: undefined });
    model.setQuery(group);
    expect(() => model.update({ fields: refused })).toThrow(
      'remote grid fields.region.format: "region" holds categories',
    );
    model.dispose();
  });

  it("takes displays on remote grids too", async () => {
    const source = memorySource(requests(), { name: "requests" });
    const model = createRemoteGridModel({
      source,
      columns: [{ field: "ms" }, { field: "region" }],
      locale: "en-US",
    });
    model.setViewport(400, 200);
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cells(model, "ms")).toEqual(["66,000", "450", "", "0.5"]);
    model.update({ fields: RULES });
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["Latency", "Region"]);
    expect(cells(model, "ms")).toEqual(["1m 6s", "450ms", "–", "500µs"]);
    expect(cells(model, "region")).toEqual(["eu", "us", "nowhere", "eu"]);
    model.dispose();
  });
});
