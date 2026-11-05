// Grids given field displays (`fields: compileFields(rules)`): headers
// titled and described by labels and descriptions, cells, missing values,
// group keys, and aggregates written through them; `setFields` keeping the
// grid's state; remote grids matching rules by their source's name; and
// category texts kept per dictionary as it grows, compacts, and resets.
import { describe, expect, it } from "vitest";
import { count, max, mean, sum } from "../../src/data/aggregations.ts";
import { category, time } from "../../src/data/column.ts";
import { groupRows } from "../../src/data/groups.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Schema, table } from "../../src/data/table.ts";
import { type CategoryFieldDisplay, compileFields, type FieldDisplays } from "../../src/fields.ts";
import type { PlacedColumn } from "../../src/grid/columns.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridModel } from "../../src/grid/model.ts";
import { createRemoteGridModel } from "../../src/grid/remote.ts";

/** Ten requests over three hosts and a missing one, at 1:00 to 10:00. */
const requests = () =>
  table(
    {
      id: Float64Array.from({ length: 10 }, (_, i) => i),
      host: category(["web", "api", "web", "db", "api", "web", null, "db", "web", "api"]),
      ms: [66_000, 0, 8, 100, Number.NaN, 20, 5, 70, 16, 25],
      at: time(Float64Array.from({ length: 10 }, (_, i) => Date.UTC(2026, 0, 1, i + 1))),
      tag: category(["a", null, "b", "a", "b", "a", "b", "a", "b", "a"]),
    },
    { name: "requests" },
  );

const RULES: FieldDisplays = [
  { match: { kind: "number" }, missing: "n/a" },
  {
    match: "ms",
    label: "Latency",
    description: "Time to the last byte.",
    format: { duration: "millisecond" },
    mappings: [{ value: 0, text: "none" }],
  },
  { match: "host", label: "Host", mappings: [{ value: "web", text: "Web" }], missing: "unknown" },
  { match: "at", format: { time: "%H:%M" } },
];

/** The shown columns' descriptions: the headers' titles and accessible descriptions. */
const descriptions = (model: { columnLayout: readonly unknown[] }) =>
  (model.columnLayout as readonly PlacedColumn[]).map(({ content }) => content.description);

const cells = <S extends Schema>(model: GridModel<S>, id: string) =>
  Array.from({ length: model.rowCount }, (_, i) => model.textAt(i, model.columnIndex(id)));

describe("grids given field displays", () => {
  it("title and describe headers by fields' labels and descriptions, a column's title first", () => {
    const model = createGridModel({
      data: rowView(requests()),
      columns: [
        { field: "ms" },
        { field: "host", title: "Server" },
        { field: "id" },
        { field: "tag", hidden: true },
      ],
      fields: compileFields([...(RULES as never[]), { match: "tag", label: "Tag" }]),
    });
    const layout = model.columnLayout;
    expect(layout.map(({ title }) => title)).toEqual(["Latency", "Server", "id"]);
    expect(descriptions(model)).toEqual(["Time to the last byte.", undefined, undefined]);
    // Hidden columns too, as menus list them.
    expect(model.columnTitle("tag")).toBe("Tag");
    expect(model.columnTitle("nothing")).toBe("nothing");
    // The columns as given: no title is written into them.
    expect(model.columns.map(({ title }) => title)).toEqual([
      undefined,
      "Server",
      undefined,
      undefined,
    ]);
  });

  it("write cells through the display: missing text, mappings, then the format", () => {
    const model = createGridModel({
      data: rowView(requests()),
      columns: [
        { field: "ms" },
        // A column's own format (Intl options) replaces the format only.
        { field: "ms", id: "raw", format: { maximumFractionDigits: 0 } },
        { field: "host" },
        { field: "at" },
        { field: "tag" },
      ],
      fields: compileFields(RULES),
      locale: "en-US",
      timeZone: "UTC",
    });
    expect(cells(model, "ms").slice(0, 5)).toEqual(["1m 6s", "none", "8ms", "100ms", "n/a"]);
    expect(cells(model, "raw").slice(0, 5)).toEqual(["66,000", "none", "8", "100", "n/a"]);
    expect(cells(model, "host").slice(5, 8)).toEqual(["Web", "unknown", "db"]);
    expect(cells(model, "at")[0]).toBe("01:00");
    // A field whose displays give no missing text keeps the grid's: empty.
    expect(cells(model, "tag").slice(0, 2)).toEqual(["a", ""]);
  });

  it("write times as grids do, to the second, where neither the column nor the field gives a format", () => {
    const model = createGridModel({
      data: rowView(requests()),
      columns: [{ field: "at" }],
      fields: compileFields({ at: { label: "Time" } }),
      locale: "en-US",
      timeZone: "UTC",
    });
    expect(cells(model, "at")[0]).toBe("Jan 1, 2026, 01:00:00");
  });

  it("refuse a column's format its field's kind cannot take, naming it", () => {
    const make = () =>
      createGridModel({
        data: rowView(requests()),
        columns: [{ field: "ms", format: { time: "%H" } as never }],
        fields: compileFields(RULES),
      });
    expect(make).toThrow('settings.format: "ms" holds numbers; give a number format');
  });

  it("write group keys through their fields' displays, and aggregates by operation and kind", () => {
    const view = rowView(requests());
    const groups = groupRows(view, {
      by: ["host"],
      ops: {
        n: count(),
        avg: mean("ms"),
        total: sum("ms"),
        late: max("at"),
        sumAt: sum("at"),
        meanId: mean("id"),
      },
    });
    const model = createGridModel({
      data: view,
      groups,
      columns: [
        { field: "id", aggregate: "meanId" },
        { field: "host" },
        { field: "ms", aggregate: "avg" },
        { field: "ms", id: "total", aggregate: "total", format: { minimumFractionDigits: 1 } },
        { field: "ms", id: "count", aggregate: "n" },
        { field: "at", aggregate: "late" },
        { field: "at", id: "sumAt", aggregate: "sumAt" },
        { field: "tag", aggregate: "avg" },
      ],
      fields: compileFields([
        ...(RULES as never[]),
        { match: "id", format: { number: ".2f" } },
        { match: "tag", missing: false },
      ]),
      locale: "en-US",
      timeZone: "UTC",
    });
    const header = (key: string | null) => {
      const index = model.rowIndexOfGroup([key]);
      return model.columnLayout.map((_, c) => model.textAt(index, c));
    };
    // Keys mapped, the missing key its field's missing text; a mean of 0 ms
    // is written in the field's format, not mapped as the value 0 would be.
    const api = header("api");
    expect(api.slice(0, 2)).toEqual(["api (3)", "api"]);
    expect(header("web").slice(0, 2)).toEqual(["Web (4)", "Web"]);
    expect(header(null).slice(0, 2)).toEqual(["unknown (1)", "unknown"]);
    // Of the column's own field, kind kept, not a count: the display's
    // format (the column's own first), so a mean of 0 and 25 is not "none".
    // A count, a sum of times (a number), and another field's aggregate are
    // written plainly.
    expect(api.slice(2)).toEqual(["12ms 500µs", "25.0", "3", "10:00", "5,301,738,000,000", "12.5"]);
    expect(header("web")[2]).toBe("16s 511ms");
    expect(header("db").slice(2, 4)).toEqual(["85ms", "170.0"]);
  });

  it("read keys of a field without a missing text as (missing), and with one as it says", () => {
    const header = (tag: CategoryFieldDisplay, shown: "tag"[] = []) => {
      const view = rowView(requests());
      const model = createGridModel({
        data: view,
        groups: groupRows(view, { by: ["tag"], ops: {} }),
        columns: [...shown.map((field) => ({ field })), { field: "id" }],
        fields: compileFields({ tag }),
      });
      return (key: string | null) => model.textAt(model.rowIndexOfGroup([key]), 0);
    };
    const mapped = header({ mappings: [{ value: "a", text: "A" }] });
    expect(mapped(null)).toBe("(missing) (1)");
    expect(mapped("a")).toBe("A (5)");
    expect(header({ missing: "none" })(null)).toBe("none (1)");
    // An empty missing text is the field's own, in a column showing the field too.
    expect(header({ missing: "" })(null)).toBe(" (1)");
    expect(header({ missing: "" }, ["tag"])(null)).toBe(" (1)");
  });

  it("write keys of a field named by the empty string through its display", () => {
    const view = rowView(table({ "": category(["a", null]), n: [1, 2] }));
    const model = createGridModel({
      data: view,
      groups: groupRows(view, { by: [""], ops: {} }),
      columns: [{ field: "n" }],
      fields: compileFields({ "": { missing: "Unknown", mappings: [{ value: "a", text: "A" }] } }),
    });
    expect(model.textAt(model.rowIndexOfGroup([null]), 0)).toBe("Unknown (1)");
    expect(model.textAt(model.rowIndexOfGroup(["a"]), 0)).toBe("A (1)");
  });

  it("take new displays with setFields, keeping layout, sort, groups, selection, and scroll", () => {
    const data = rowView(
      table({
        id: Float64Array.from({ length: 200 }, (_, i) => i),
        ms: Float64Array.from({ length: 200 }, (_, i) => i * 10),
        host: category(Array.from({ length: 200 }, (_, i) => ["web", "api"][i % 2]!)),
      }),
    );
    const groups = groupRows(data, { by: ["host"], ops: { avg: mean("ms") } });
    const model = createGridModel({
      data,
      groups,
      columns: [
        { field: "host", width: 90, pin: "left" },
        { field: "id", width: 300 },
        { field: "ms", aggregate: "avg" },
        { field: "id", id: "hidden", hidden: true },
      ],
      rowHeight: 10,
    });
    model.setViewport(300, 100);
    model.setExpanded(["web"], true);
    model.setSort([{ field: "ms", order: "descending" }]);
    model.select(3, "only");
    model.scrollTo({ top: 200, left: 50 });
    const before = {
      columns: model.columns,
      sort: model.sort,
      top: model.top,
      left: model.left,
      selected: model.selectedCount,
      expanded: model.isExpanded(["web"]),
    };
    const revision = model.revision;
    const row = model.rowIndexOfGroup(["web"]) + 1;
    expect(model.textAt(row, model.columnIndex("ms"))).toBe("1,980");

    model.setFields(
      compileFields({
        ms: { label: "Latency", format: { duration: "millisecond" } },
        host: { label: "Host" },
      }),
    );
    expect(model.revision).toBeGreaterThan(revision);
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["Host", "id", "Latency"]);
    expect(model.textAt(row, model.columnIndex("ms"))).toBe("1s 980ms");
    expect(model.textAt(model.rowIndexOfGroup(["web"]), 2)).toBe("990ms");
    expect({
      columns: model.columns,
      sort: model.sort,
      top: model.top,
      left: model.left,
      selected: model.selectedCount,
      expanded: model.isExpanded(["web"]),
    }).toEqual(before);

    model.setFields(undefined);
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["host", "id", "ms"]);
    expect(model.textAt(row, model.columnIndex("ms"))).toBe("1,980");
  });

  it("keep a category's texts per dictionary through growth, compaction, and resets", () => {
    const streamed = table({ host: category(["h0", "h1"]), ms: [0, 1] }, { maxRows: 4 });
    const fields = compileFields({ host: { mappings: [{ regex: "^h(\\d+)$", text: "Host $1" }] } });
    const model = createGridModel({
      data: rowView(streamed),
      columns: [{ field: "host" }],
      fields,
    });
    expect(cells(model, "host")).toEqual(["Host 0", "Host 1"]);
    // New hosts grow the dictionary; old rows drop out and it is compacted, renumbered.
    for (let i = 2; i < 200; i++) streamed.append({ host: [`h${i}`], ms: [i] });
    expect(streamed.categories("host").revision).toBeGreaterThan(0);
    expect(cells(model, "host")).toEqual(["Host 196", "Host 197", "Host 198", "Host 199"]);
    streamed.reset({ host: ["h7", "x"], ms: [1, 2] });
    expect(cells(model, "host")).toEqual(["Host 7", "x"]);
  });

  it("leave grids without displays as they were", () => {
    const model = createGridModel({
      data: rowView(requests()),
      columns: [{ field: "ms" }, { field: "host" }],
      locale: "en-US",
    });
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["ms", "host"]);
    expect(descriptions(model)).toEqual([undefined, undefined]);
    expect(cells(model, "ms").slice(0, 5)).toEqual(["66,000", "0", "8", "100", ""]);
  });
});

describe("remote grids given field displays", () => {
  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it("match rules naming a table by the source's name, in rows, keys, and aggregates", async () => {
    const source = memorySource(requests(), { key: "id", name: "requests" });
    const model = createRemoteGridModel({
      source,
      columns: [{ field: "id" }, { field: "ms" }, { field: "host" }],
      fields: compileFields([
        ...(RULES as never[]),
        { match: { table: "requests", field: "id" }, label: "Request" },
        { match: { table: "other", field: "host" }, label: "Elsewhere" },
      ]),
      locale: "en-US",
    });
    model.setViewport(400, 280);
    await settle();
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["Request", "Latency", "Host"]);
    expect([0, 1, 4].map((row) => model.textAt(row, 1))).toEqual(["1m 6s", "none", "n/a"]);
    expect(model.textAt(6, 2)).toBe("unknown");

    model.setQuery({
      group: { by: ["host"], aggregate: [{ op: "mean", field: "ms", as: "avg" }] },
    });
    model.setColumns([{ field: "host" }, { field: "ms", aggregate: "avg" }]);
    await settle();
    const texts = Array.from({ length: model.rowCount }, (_, i) => [
      model.textAt(i, 0),
      model.textAt(i, 1),
    ]);
    expect(texts).toContainEqual(["Web (4)", "16s 511ms"]);
    expect(texts).toContainEqual(["unknown (1)", "5ms"]);

    const revision = model.revision;
    model.setFields(undefined);
    expect(model.revision).toBeGreaterThan(revision);
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["host", "ms"]);
    model.dispose();
  });
});
