// Grid looks without a DOM: cells colored through encodings (`encode` of a
// column or of the grid's rows, `aggregateEncode` of group rows, pivots'
// aggregates) in every channel form, lists, precedence, the grid's scales
// and their domains as data streams, rank tests, display colors, `update`,
// `cellAt`, refusals, and remote grids' looks.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { afterEach, describe, expect, it } from "vitest";
import { count, max, mean, sum } from "../../src/data/aggregations.ts";
import { category, time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { compileFields } from "../../src/fields.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridModel, type GridModelOptions } from "../../src/grid/model.ts";
import { createPivotGridModel } from "../../src/grid/pivot.ts";
import { createRemoteGridModel, type RemoteGridModelOptions } from "../../src/grid/remote.ts";
import type { GridSource, RowsRequest } from "../../src/grid/source.ts";

/** Six requests: a host (one missing), a latency (one missing), a color of each, and a time. */
const requests = () =>
  table({
    id: Float64Array.from({ length: 6 }, (_, i) => i),
    host: category(["web", "api", "web", "db", null, "api"]),
    ms: [10, 50, Number.NaN, 100, 30, 70],
    tint: category(["#123456", "nope", null, "red", "#abc", "var(--x)"]),
    at: time(Float64Array.from({ length: 6 }, (_, i) => Date.UTC(2026, 0, 1, i))),
  });

type Requests = ReturnType<typeof requests> extends Table<infer S> ? S : never;

const SCALES = {
  hosts: { type: "ordinal", map: { web: "#00aa00" } },
  heat: { type: "linear", range: ["#ffffff", "#ff0000"] },
} as const;

/** Latency colored by step, and "db" by a mapping. */
const FIELDS = compileFields({
  ms: {
    thresholds: {
      base: "#2e7d32",
      steps: [
        { value: 50, color: "#f9a825" },
        { value: 90, color: "#c62828" },
      ],
    },
  },
  host: { mappings: [{ value: "db", color: "#333333" }] },
});

function grid(options: Partial<GridModelOptions<Requests>> = {}, t = requests()) {
  const model = createGridModel({
    data: rowView(t),
    columns: [{ field: "id" }],
    scales: SCALES,
    fields: FIELDS,
    locale: "en-US",
    ...options,
  } as GridModelOptions<Requests>);
  model.setViewport(2000, 1000);
  return { t, model };
}

/** Every row's looks of column `column`, null for none. */
const looks = <S extends Schema>(model: GridModel<S>, column = 0) =>
  Array.from({ length: model.rowCount }, (_, row) => model.lookAt(row, column) ?? null);

const fills = <S extends Schema>(model: GridModel<S>, column = 0) =>
  looks(model, column).map((look) => look?.fill ?? null);

describe("grid looks", () => {
  it("color cells by a constant, a scale of categories, a gradient, a field of colors, a condition, and a rank", () => {
    const { model } = grid({
      columns: [
        { field: "id", encode: { fill: { value: "#eeeeee" } } },
        { field: "host", encode: { fill: { field: "host", scale: "hosts" } } },
        { field: "ms", encode: { fill: { field: "ms", scale: "heat" } } },
        { field: "tint", encode: { color: { field: "tint", scale: { type: "identity" } } } },
        {
          field: "ms",
          id: "slow",
          encode: { fill: { condition: { when: col("ms").gt(40), then: "#ffdddd" } } },
        },
        {
          field: "ms",
          id: "top",
          encode: {
            fill: {
              condition: { when: { top: 2, field: "ms" }, then: "#ffd700", otherwise: "#f0f0f0" },
            },
          },
        },
      ],
    });
    expect(model.hasLooks).toBe(true);
    expect(fills(model, 0)).toEqual(Array(6).fill("#eeeeee"));
    // "web" by the scale's map, the others by their places in its domain (the
    // DOM grid's theme gives each its palette color); missing values none.
    expect(fills(model, 1)).toEqual([
      "#00aa00",
      "var(--hg-palette-1)",
      "#00aa00",
      "var(--hg-palette-2)",
      null,
      "var(--hg-palette-1)",
    ]);
    // From 10 to 100; a missing latency has no look.
    expect(fills(model, 2)).toEqual(["#ffffff", "#ff8e8e", null, "#ff0000", "#ffc6c6", "#ff5555"]);
    // Colors as they are; a missing value none. (Without a page, any word passes for a name.)
    expect(looks(model, 3).map((look) => look?.color ?? null)).toEqual([
      "#123456",
      "nope",
      null,
      "red",
      "#abc",
      "var(--x)",
    ]);
    // A condition without `otherwise` gives other rows no look.
    expect(fills(model, 4)).toEqual([null, "#ffdddd", null, "#ffdddd", null, "#ffdddd"]);
    expect(fills(model, 5)).toEqual([
      "#f0f0f0",
      "#f0f0f0",
      "#f0f0f0",
      "#ffd700",
      "#f0f0f0",
      "#ffd700",
    ]);
  });

  it("take fields' display colors without a scale: thresholds for numbers, mappings for categories", () => {
    const { model } = grid({
      columns: [
        { field: "ms", encode: { fill: { field: "ms" } } },
        { field: "host", encode: { color: { field: "host" } } },
      ],
    });
    expect(fills(model, 0)).toEqual(["#2e7d32", "#f9a825", null, "#c62828", "#2e7d32", "#f9a825"]);
    expect(looks(model, 1).map((look) => look?.color ?? null)).toEqual([
      null,
      null,
      null,
      "#333333",
      null,
      null,
    ]);
  });

  it("give no look from display colors that are not colors, as fields take any text", () => {
    const { model } = grid({
      columns: [
        { field: "ms", encode: { fill: [{ field: "ms" }, { value: "#eeeeee" }] } },
        { field: "host", encode: { color: { field: "host" } } },
      ],
      fields: compileFields({
        ms: { thresholds: { base: "bad color!", steps: [{ value: 50, color: "#f9a825" }] } },
        host: { mappings: [{ value: "db", color: "not a color either" }] },
      }),
    });
    // Below 50 the base is no color, so the list's next entry gives the fill.
    expect(fills(model, 0)).toEqual([
      "#eeeeee",
      "#f9a825",
      "#eeeeee",
      "#f9a825",
      "#eeeeee",
      "#f9a825",
    ]);
    expect(looks(model, 1).every((look) => look === null)).toBe(true);
  });

  it("refuse a field that gives no colors, naming what would", () => {
    expect(() =>
      grid({ fields: undefined, columns: [{ field: "ms", encode: { fill: { field: "ms" } } }] }),
    ).toThrow(
      'grid columns[0].encode.fill.field: field "ms" holds numbers, and fields give it no colors; name a channel scale (a scale of the grid\'s with a range), take its values as colors (scale: { type: "identity" }), or give fields.ms thresholds or mappings with colors',
    );
    expect(() =>
      grid({ columns: [{ field: "tint", encode: { fill: { field: "tint" } } }] }),
    ).toThrow(
      'grid columns[0].encode.fill: field "tint" has no colors: fields give it no mapping colors, and the grid declares no "color" scale; give fields.tint mappings with colors, or name a scale',
    );
  });

  it("read the grid's rows' encode where a column's own channel gives a cell none, fill and color apart", () => {
    const { model } = grid({
      columns: [
        { field: "id" },
        {
          field: "ms",
          encode: { fill: { condition: { when: col("ms").gt(60), then: "#ff0000" } } },
        },
      ],
      encode: {
        fill: { condition: { when: col("host").eq("web"), then: "#e0f0ff" } },
        color: { value: "#222222" },
      },
    });
    expect(looks(model, 0)).toEqual([
      { fill: "#e0f0ff", color: "#222222" },
      { color: "#222222" },
      { fill: "#e0f0ff", color: "#222222" },
      { color: "#222222" },
      { color: "#222222" },
      { color: "#222222" },
    ]);
    // The column's fill wins where it gives one; its rows' color still applies.
    expect(looks(model, 1)).toEqual([
      { fill: "#e0f0ff", color: "#222222" },
      { color: "#222222" },
      { fill: "#e0f0ff", color: "#222222" },
      { fill: "#ff0000", color: "#222222" },
      { color: "#222222" },
      { fill: "#ff0000", color: "#222222" },
    ]);
  });

  it("try a list's channels in order, the first giving an output winning, transparent included", () => {
    const { model } = grid({
      columns: [
        {
          field: "host",
          encode: {
            fill: [
              { condition: { when: col("ms").gt(60), then: "transparent" } },
              { field: "host", scale: "known" },
              { value: "#cccccc" },
            ],
          },
        },
      ],
      scales: { known: { type: "ordinal", domain: ["web"], map: { web: "#00aa00" } } },
    });
    // Rows over 60 take "transparent", a color like any other; "web" its
    // mapping; values outside the domain and missing ones fall through.
    expect(fills(model)).toEqual([
      "#00aa00",
      "#cccccc",
      "#00aa00",
      "transparent",
      "#cccccc",
      "transparent",
    ]);
  });

  it("refuse what cells cannot take, naming the grid", () => {
    const refused = (options: Partial<GridModelOptions<Requests>>) => () => grid(options);
    expect(
      refused({ columns: [{ field: "id", encode: { symbol: { value: "circle" } } as never }] }),
    ).toThrow(
      "grid columns[0].encode.symbol: symbol cells draw shapes; give the column cell: symbolCell(), or drop symbol",
    );
    expect(
      refused({
        columns: [{ field: "id", encode: { fill: { series: true, scale: "hosts" } } as never }],
      }),
    ).toThrow(
      "grid columns[0].encode.fill: a grid has no series; give a field, a constant, or a condition",
    );
    expect(
      refused({ columns: [{ field: "id", encode: { fill: { value: "bad color!" } } }] }),
    ).toThrow('grid columns[0].encode.fill.value: expected a CSS color; received "bad color!"');
    expect(
      refused({ columns: [{ field: "id", encode: { fill: { field: "ms", scale: "nope" } } }] }),
    ).toThrow(
      'grid columns[0].encode.fill.scale: no scale "nope"; the grid\'s scales are "hosts", "heat"',
    );
    expect(refused({ scales: { heat: { type: "linear", range: ["red", "blue"] } } })).toThrow(
      'grid scales.heat.range[0]: expected a "#rrggbb" color; received "red"',
    );
    // Charts read variables through their theme; a grid's model has none.
    expect(
      refused({ scales: { heat: { type: "linear", range: ["var(--cold)", "#ff0000"] } } }),
    ).toThrow(
      'grid scales.heat.range[0]: a gradient mixes hex colors; give "#rrggbb", not "var(--cold)"',
    );
    expect(
      refused({ scales: { color: { type: "linear", range: ["#000000", "#ffffff"] } } }),
    ).toThrow(
      'grid scales.color: "color" is the scale category fields are read through by default, which a scale with a range does not map; give the channel scale another name',
    );
    expect(refused({ scales: { hosts: { type: "ordinal", scope: "panel" } as never } })).toThrow(
      "grid scales.hosts.scope: a grid has no panels; drop scope",
    );
  });

  it("refuse channels of no form cells take, naming the entry", () => {
    const refused = (fill: unknown) => () =>
      grid({ columns: [{ field: "ms", encode: { fill } as never }] });
    const forms =
      "expected a channel: { field, scale? }, { value }, or { condition: { when, then, otherwise? } }";
    expect(refused("#ff0000")).toThrow(`grid columns[0].encode.fill: ${forms}; received "#ff0000"`);
    expect(refused({ field: "ms", value: "#ffffff" })).toThrow(
      `grid columns[0].encode.fill: ${forms}; received {"field":"ms","value":"#ffffff"}`,
    );
    expect(refused([{ field: "ms", scale: "heat" }, null])).toThrow(
      `grid columns[0].encode.fill[1]: ${forms}; received null`,
    );
    expect(refused({ value: "#ffffff", scale: "heat" })).toThrow(
      "grid columns[0].encode.fill.scale: unknown key; a constant takes value",
    );
    expect(refused({ field: "ms", sclae: "heat" })).toThrow(
      "grid columns[0].encode.fill.sclae: unknown key; a field's channel takes field and scale",
    );
    expect(refused({ field: "ms", scale: { type: "linear" } })).toThrow(
      'grid columns[0].encode.fill.scale: expected the name of one of the grid\'s scales, or { type: "identity" }; received {"type":"linear"}',
    );
    expect(
      refused({ condition: { when: col("ms").gt(1), then: "#ffffff", else: "#000000" } }),
    ).toThrow(
      /^grid columns\[0\]\.encode\.fill\.condition: expected \{ when, then, otherwise\? \}; received /,
    );
    expect(refused({ condition: { when: col("ms").gt(1) } })).toThrow(
      /^grid columns\[0\]\.encode\.fill\.condition: expected \{ when, then, otherwise\? \}/,
    );
  });

  it("take colors with alpha in constants and scales of categories", () => {
    const { model } = grid({
      columns: [
        { field: "id", encode: { fill: { value: "#ff000080" } } },
        { field: "host", encode: { fill: { field: "host", scale: "hosts" } } },
      ],
      scales: { hosts: { type: "ordinal", map: { web: "#0f08" } } },
    });
    expect(fills(model)[0]).toBe("#ff000080");
    expect(fills(model, 1)[0]).toBe("#0f08");
  });

  it("keep a value's palette place as values come and go, and take updates of scales and encode", () => {
    const { t, model } = grid({
      columns: [{ field: "host", encode: { fill: { field: "host", scale: "palette" } } }],
      scales: { palette: { type: "ordinal" } },
    });
    expect(fills(model)).toEqual([
      "var(--hg-palette-0)",
      "var(--hg-palette-1)",
      "var(--hg-palette-0)",
      "var(--hg-palette-2)",
      null,
      "var(--hg-palette-1)",
    ]);
    t.dropFirst(2);
    t.append({ id: [6], host: ["cache"], ms: [1], tint: [null], at: [0] });
    // "web" and "api" keep theirs; "cache" takes the next.
    expect(fills(model).slice(-1)).toEqual(["var(--hg-palette-3)"]);
    expect(fills(model)[0]).toBe("var(--hg-palette-0)");
    const revision = model.looksRevision;
    model.update({ encode: { fill: { value: "#fafafa" } } });
    // Compiled again: the revision moves, and the scale keeps its places.
    expect(model.looksRevision).toBeGreaterThan(revision);
    expect(fills(model)[0]).toBe("var(--hg-palette-0)");
  });

  it("change nothing when an update is refused", () => {
    const { model } = grid({
      columns: [{ field: "ms", encode: { fill: { field: "ms", scale: "heat" } } }],
    });
    const before = fills(model);
    const revision = model.looksRevision;
    expect(() => model.update({ scales: {} })).toThrow(
      'grid columns[0].encode.fill.scale: no scale "heat"; the grid has no scales; add it to scales',
    );
    expect(() => model.update({ rowHeight: 20 } as never)).toThrow(
      "grid update.rowHeight: unknown option; use fields, scales, or encode",
    );
    expect(fills(model)).toEqual(before);
    expect(model.looksRevision).toBe(revision);
    model.update({ scales: { heat: { type: "linear", range: ["#000000", "#ffffff"] } } });
    expect(fills(model)[0]).toBe("#000000");
  });

  it("keep looks as taken while the caller's objects change, until given again", () => {
    const fill = { value: "#eeeeee" };
    const own = { value: "#dddddd" };
    const scales = { heat: { type: "linear" as const, range: ["#ffffff", "#ff0000"] } };
    const { model } = grid({
      columns: [
        { field: "id", encode: { fill: own } },
        { field: "ms", encode: { fill: { field: "ms", scale: "heat" } } },
      ],
      scales,
      encode: { fill },
    });
    fill.value = "bad color!";
    expect(() => model.update({ encode: { fill } })).toThrow(
      'grid encode.fill.value: expected a CSS color; received "bad color!"',
    );
    own.value = "#000000";
    scales.heat.range[1] = "#0000ff";
    // An update of something else compiles the looks as they were taken.
    model.update({ fields: FIELDS });
    expect(fills(model, 0)[0]).toBe("#dddddd");
    expect(fills(model, 1)[3]).toBe("#ff0000");
  });

  it("compare a scale object changed in place and given again with what it was", () => {
    const scales = { places: { type: "ordinal" as const, domain: ["web", "api", "db"] } };
    const { model } = grid({
      columns: [{ field: "host", encode: { fill: { field: "host", scale: "places" } } }],
      scales,
    });
    expect(fills(model)[0]).toBe("var(--hg-palette-0)");
    scales.places.domain.reverse();
    model.update({ scales });
    // A new domain, so new places: "web" is now third.
    expect(fills(model)[0]).toBe("var(--hg-palette-2)");
  });

  it("find gradients' domains from the rows the grid shows, extended as rows stream in", () => {
    const { t, model } = grid({
      columns: [{ field: "ms", encode: { fill: { field: "ms", scale: "heat" } } }],
    });
    expect(fills(model)[3]).toBe("#ff0000");
    const revision = model.looksRevision;
    t.append({ id: [6], host: ["web"], ms: [190], tint: [null], at: [0] });
    // 100 is now halfway from 10 to 190.
    expect(fills(model)[3]).toBe("#ff7f7f");
    expect(fills(model)[6]).toBe("#ff0000");
    expect(model.looksRevision).toBeGreaterThan(revision);
    // An append within the domain moves nothing.
    const after = model.looksRevision;
    t.append({ id: [7], host: ["web"], ms: [40], tint: [null], at: [0] });
    expect(model.lookAt(7, 0)).toEqual({ fill: "#ffd4d4" });
    expect(model.looksRevision).toBe(after);
  });

  it("span a shared gradient's domain over every field read through it", () => {
    const { model } = grid({
      columns: [
        { field: "id", encode: { fill: { field: "id", scale: "heat" } } },
        { field: "ms", encode: { fill: { field: "ms", scale: "heat" } } },
      ],
    });
    // Ids from 0 to 5 and latencies from 10 to 100: one domain, 0 to 100.
    expect(fills(model, 0)[5]).toBe("#fff2f2");
    expect(fills(model, 1)[0]).toBe("#ffe5e5");
  });

  it("find a gradient's domain again when the filter changes, the table unchanged", () => {
    const t = requests();
    const view = rowView(t);
    const model = createGridModel({
      data: view,
      columns: [{ field: "ms", encode: { fill: { field: "ms", scale: "heat" } } }],
      scales: SCALES,
    });
    model.setViewport(2000, 1000);
    expect(fills(model)[1]).toBe("#ff8e8e");
    view.setQuery({ filter: col("ms").ge(50) });
    // 50, 100, 70 shown: 50 is the domain's low end now.
    expect(fills(model)).toEqual(["#ffffff", "#ff0000", "#ff9999"]);
    view.restrict(null);
    view.setQuery({});
    expect(fills(model)[1]).toBe("#ff8e8e");
  });

  it("try a list's next channel where a field of colors holds something else", () => {
    const colors = table({
      id: [0, 1, 2],
      host: category(["web", "web", "web"]),
      ms: [1, 2, 3],
      tint: category(["#123456", "bad color!", null]),
      at: time([0, 0, 0]),
    });
    const { model } = grid(
      {
        columns: [
          {
            field: "tint",
            encode: {
              fill: [{ field: "tint", scale: { type: "identity" } }, { value: "#cccccc" }],
            },
          },
        ],
      },
      colors as never,
    );
    expect(fills(model)).toEqual(["#123456", "#cccccc", "#cccccc"]);
  });

  it("refuse expressions comparing with numbers JSON cannot carry, as charts do", () => {
    expect(() =>
      grid({
        columns: [
          {
            field: "ms",
            encode: { fill: { condition: { when: col("ms").gt(Number.NaN), then: "#ff0000" } } },
          },
        ],
      }),
    ).toThrow(/grid columns\[0\]\.encode\.fill\.condition\.when: .*finite/);
  });

  it("rank the rows the grid shows, again as rows stream in or the filter changes", () => {
    const t = requests();
    const view = rowView(t);
    const model = createGridModel({
      data: view,
      columns: [
        {
          field: "ms",
          encode: { fill: { condition: { when: { bottom: 1, field: "ms" }, then: "#00ff00" } } },
        },
      ],
    });
    model.setViewport(2000, 1000);
    expect(fills(model)).toEqual(["#00ff00", null, null, null, null, null]);
    t.append({ id: [6], host: ["web"], ms: [5], tint: [null], at: [0] });
    expect(fills(model)).toEqual([null, null, null, null, null, null, "#00ff00"]);
    view.setQuery({ filter: col("ms").gt(20) });
    // Of the rows shown, 30 is the smallest.
    expect(fills(model)).toEqual([null, null, "#00ff00", null]);
  });

  it("read a cell's state, value, text, and look", () => {
    const { model } = grid({
      columns: [{ field: "ms", encode: { fill: { field: "ms", scale: "heat" } } }],
    });
    expect(model.cellAt(0, 0)).toEqual({
      state: "value",
      value: 10,
      kind: "number",
      text: "10",
      look: { fill: "#ffffff" },
      link: undefined,
    });
    expect(model.cellAt(2, 0)).toMatchObject({ state: "missing", text: "", look: undefined });
  });

  it("leave grids without looks as they were", () => {
    const { model } = grid({ columns: [{ field: "id" }, { field: "ms" }] });
    expect(model.hasLooks).toBe(false);
    expect(looks(model, 1)).toEqual(Array(6).fill(null));
  });
});

describe("group rows' looks", () => {
  function grouped(columns: GridModelOptions<Requests>["columns"], scales: object = SCALES) {
    const t = requests();
    const view = rowView(t);
    const groups = groupRows(view, {
      by: ["host"],
      ops: { n: count(), total: sum("ms"), avg: mean("ms"), last: max("at") },
    });
    const model = createGridModel({
      data: view,
      groups,
      columns,
      scales: scales as never,
      fields: FIELDS,
    } as GridModelOptions<Requests>);
    model.setViewport(2000, 1000);
    return { t, view, model };
  }

  it("read aggregates by their names: a mean in its field's colors, sums and counts through scales", () => {
    const { model } = grouped(
      [
        { field: "host" },
        { field: "ms", aggregate: "avg", aggregateEncode: { fill: { field: "avg" } } },
        {
          field: "ms",
          id: "total",
          aggregate: "total",
          aggregateEncode: { fill: { field: "total", scale: "totals" } },
        },
        {
          field: "at",
          aggregate: "last",
          aggregateEncode: { fill: { field: "last", scale: "times" } },
        },
      ],
      {
        totals: { type: "linear", range: ["#ffffff", "#000000"] },
        times: { type: "linear", range: ["#000000", "#ffffff"] },
      },
    );
    // web (10, NaN: 10), api (50, 70: 60), db (100), missing (30).
    expect(model.rowCount).toBe(4);
    expect(fills(model, 1)).toEqual(["#2e7d32", "#f9a825", "#c62828", "#2e7d32"]);
    // Sums from 10 to 120 (api's 50 + 70).
    expect(fills(model, 2)).toEqual(["#ffffff", "#000000", "#2e2e2e", "#d1d1d1"]);
    // The last times, as their epoch milliseconds: from web's 2:00 to api's 5:00.
    expect(fills(model, 3)).toEqual(["#000000", "#ffffff", "#555555", "#aaaaaa"]);
  });

  it("read missing aggregates and keys as null", () => {
    const t = table({
      host: category(["web", "web", "db", null]),
      ms: [1, 2, Number.NaN, 4],
    });
    const view = rowView(t);
    const model = createGridModel({
      data: view,
      groups: groupRows(view, { by: ["host"], ops: { avg: mean("ms") } }),
      columns: [{ field: "host" }, { field: "ms", aggregate: "avg" }],
    });
    model.setViewport(2000, 1000);
    const db = Array.from({ length: model.rowCount }, (_, i) => i).find((i) =>
      model.textAt(i, 0).startsWith("db"),
    )!;
    expect(model.cellAt(db, 1)).toMatchObject({ state: "missing", value: null, kind: "number" });
    const missing = Array.from({ length: model.rowCount }, (_, i) => i).find((i) =>
      model.textAt(i, 0).startsWith("(missing)"),
    )!;
    expect(model.cellAt(missing, 0)).toMatchObject({ state: "missing", value: null });
  });

  it("refuse display colors of sums and counts, whose values are not in their field's units", () => {
    expect(() =>
      grouped([
        { field: "host" },
        { field: "ms", aggregate: "total", aggregateEncode: { fill: { field: "total" } } },
      ]),
    ).toThrow(
      'grid columns[1].aggregateEncode.fill: aggregate "total" is a sum, which is not in the field\'s units, so fields give it no colors; name a scale',
    );
    expect(() =>
      grouped([
        { field: "host" },
        { field: "id", aggregate: "n", aggregateEncode: { fill: { field: "n" } } },
      ]),
    ).toThrow(
      'grid columns[1].aggregateEncode.fill: aggregate "n" is a count, which is not in a field\'s units, so fields give it no colors; name a scale',
    );
  });

  it("refuse rank tests of group rows", () => {
    expect(() =>
      grouped([
        { field: "host" },
        {
          field: "ms",
          aggregate: "avg",
          aggregateEncode: {
            fill: { condition: { when: { top: 1, field: "avg" }, then: "#ff0000" } },
          },
        },
      ]),
    ).toThrow(
      "grid columns[1].aggregateEncode.fill.condition.when: ranks read table rows; group rows take no rank",
    );
  });

  it("share a gradient's domain between the records and their aggregates", () => {
    const { model } = grouped([
      { field: "host" },
      {
        field: "ms",
        aggregate: "total",
        encode: { fill: { field: "ms", scale: "heat" } },
        aggregateEncode: { fill: { field: "total", scale: "heat" } },
      },
    ]);
    // From the records' 10 to api's sum of 120: web's 10 is white, api's 120 red.
    expect(fills(model, 1)).toEqual(["#ffffff", "#ff0000", "#ff2e2e", "#ffd1d1"]);
    model.setExpanded(["db"], true);
    // db's row of 100 among them, read through the same domain.
    expect(model.lookAt(3, 1)).toEqual({ fill: "#ff2e2e" });
  });

  it("give rows of upper levels no look from fields only lower levels have", () => {
    const t = requests();
    const view = rowView(t);
    const groups = groupRows(view, { by: ["host", "tint"], ops: { n: count() } });
    const model = createGridModel({
      data: view,
      groups,
      columns: [
        {
          field: "host",
          aggregateEncode: {
            fill: [
              { condition: { when: col("tint").eq("red"), then: "#ff0000" } },
              { condition: { when: col("host").eq("web"), then: "#0000ff" } },
            ],
          },
        },
      ],
    });
    model.setViewport(2000, 1000);
    model.expandAll();
    const rows = Array.from({ length: model.rowCount }, (_, i) =>
      model.row(i).kind === "group" ? `${model.textAt(i, 0)}: ${model.lookAt(i, 0)?.fill}` : "",
    ).filter((row) => row !== "");
    // Hosts take only the entry reading "host"; their tints both; records none.
    expect(rows).toEqual([
      "web (2): #0000ff",
      "#123456 (1): #0000ff",
      "(missing) (1): #0000ff",
      "api (2): undefined",
      "nope (1): undefined",
      "var(--x) (1): undefined",
      "db (1): undefined",
      "red (1): #ff0000",
      "(missing) (1): undefined",
      "#abc (1): undefined",
    ]);
    expect(model.lookAt(2, 0)).toBeUndefined();
  });

  it("refuse groups lacking an aggregate looks read, changing nothing", () => {
    const { view, model } = grouped([
      { field: "host" },
      {
        field: "ms",
        aggregate: "n",
        aggregateEncode: { fill: { field: "avg", scale: "heat" } },
      },
    ]);
    const before = fills(model, 1);
    expect(() => model.setGroups(groupRows(view, { by: ["host"], ops: { n: count() } }))).toThrow(
      'grid columns[1].aggregateEncode.fill.field: no field "avg"; the table has "host", "n"',
    );
    expect(fills(model, 1)).toEqual(before);
  });
});

describe("pivot cells' looks", () => {
  /** Requests by region and service: totals per combination eu/api 10, us/web 20, eu/web 40, ap/api 5, us/api 7, eu/db 3. */
  const pivoted = (aggregates: object, totals = false) => {
    const t = table({
      region: category(["eu", "us", "eu", "ap", "us", "eu"]),
      service: category(["api", "web", "web", "api", "api", "db"]),
      ms: [10, 20, 40, 5, 7, 3],
    });
    const pivot = pivotRows(rowView(t), {
      rows: "region",
      pivot: "service",
      ops: { avg: mean("ms"), total: sum("ms") },
      totals,
    } as never);
    const model = createPivotGridModel({
      data: pivot,
      aggregates: aggregates as never,
      scales: { heat: { type: "linear", range: ["#ffffff", "#ff0000"] } },
    });
    model.setViewport(3000, 1000);
    /** Each row's fills in the column of `value` (a service; null for the totals) and aggregate. */
    const column = (value: string | null, aggregate: "avg" | "total") => {
      const op = aggregate === "avg" ? "mean" : "sum";
      const id = JSON.stringify(
        value === null
          ? ["pivot", "service", "total", aggregate, op, "ms"]
          : ["pivot", "service", "category", value, aggregate, op, "ms"],
      );
      const index = model.columnLayout.findIndex((placed) => placed.id === id);
      expect(index).toBeGreaterThan(0);
      return Array.from(
        { length: model.rowCount },
        (_, row) => model.lookAt(row, index)?.fill ?? null,
      );
    };
    return { t, model, column };
  };

  it("color each combination's cell by its aggregates, ranking within a pivot value's column", () => {
    const { t, model, column } = pivoted({
      avg: {
        encode: {
          fill: [
            { condition: { when: { top: 1, field: "avg" }, then: "#ffd700" } },
            { field: "total", scale: "heat" },
          ],
        },
      },
    });
    // Rows eu, us, ap. Each service's top is its own; totals span 3 to 40.
    expect(model.rowCount).toBe(3);
    expect(column("api", "avg")).toEqual(["#ffd700", "#ffe3e3", "#fff1f1"]);
    expect(column("web", "avg")).toEqual(["#ffd700", "#ff8a8a", null]);
    expect(column("db", "avg")).toEqual(["#ffd700", null, null]);
    // The totals column has no look of its own.
    expect(column("api", "total")).toEqual([null, null, null]);
    // A new top of the api column moves the looks' revision.
    const revision = model.looksRevision;
    t.append({ region: ["ap"], service: ["api"], ms: [100] });
    expect(model.looksRevision).toBeGreaterThan(revision);
    expect(column("api", "avg").map((fill) => fill === "#ffd700")).toEqual([false, false, true]);
  });

  it("color totals columns by their row's totals, without what reads the pivot field", () => {
    const { column } = pivoted(
      {
        avg: {
          encode: { fill: { condition: { when: { top: 1, field: "avg" }, then: "#ffd700" } } },
        },
        total: {
          encode: {
            fill: [
              { condition: { when: col("service").eq("api"), then: "#0000ff" } },
              { field: "total", scale: "heat" },
            ],
          },
        },
      },
      true,
    );
    expect(column("api", "total")).toEqual(["#0000ff", "#0000ff", "#0000ff"]);
    // Cells' totals and rows' totals share the domain: 3 to 53.
    expect(column("web", "total")).toEqual(["#ff4242", "#ffa8a8", null]);
    expect(column(null, "total")).toEqual(["#ff0000", "#ff8585", "#fff5f5"]);
    // Rows' means ranked among the rows' totals: eu's 17.67 tops 13.5 and 5.
    expect(column(null, "avg")).toEqual(["#ffd700", null, null]);
  });

  it("keep aggregates' options as taken, encodings added after included", () => {
    const avg: { encode?: object } = {};
    const { model, column } = pivoted({ avg });
    avg.encode = { fill: { value: "bad color!" } };
    // An update of something else compiles the looks as they were taken: none.
    model.update({ fields: undefined });
    expect(column("api", "avg")).toEqual([null, null, null]);
    expect(model.hasLooks).toBe(false);
  });

  it("refuse a model's encode: cells take looks by aggregate", () => {
    const t = table({ region: category(["eu"]), service: category(["api"]), ms: [1] });
    const pivot = pivotRows(rowView(t), {
      rows: "region",
      pivot: "service",
      ops: { avg: mean("ms") },
    } as never);
    expect(() =>
      createPivotGridModel({ data: pivot, encode: { fill: { value: "#ff0000" } } } as never),
    ).toThrow(
      "pivot grid encode: a pivot's cells take looks by aggregate (aggregates.<name>.encode); drop encode",
    );
  });
});

describe("remote grids' looks", () => {
  const settle = async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };
  const models: { dispose(): void }[] = [];
  afterEach(() => {
    for (const m of models.splice(0)) m.dispose();
  });

  function remote(options: Partial<RemoteGridModelOptions> = {}) {
    const memory = memorySource(requests(), { key: "id" });
    const asked: RowsRequest[] = [];
    const source: GridSource = {
      ...memory,
      rows: (request, signal) => {
        asked.push(request);
        return memory.rows(request, signal);
      },
    };
    const model = createRemoteGridModel({
      source,
      columns: [{ field: "id" }] as never,
      blockSize: 50,
      ...options,
    } as RemoteGridModelOptions);
    model.setViewport(2000, 1000);
    models.push(model);
    return { model, asked };
  }

  it("color loaded rows, asking for the fields looks read", async () => {
    const { model, asked } = remote({
      columns: [
        { field: "id", encode: { fill: { field: "ms", scale: "heat" } } },
        { field: "host" },
      ] as never,
      encode: { color: { condition: { when: col("tint").eq("red"), then: "#ff0000" } } } as never,
      scales: { heat: { type: "linear", domain: [0, 100], range: ["#ffffff", "#ff0000"] } },
    });
    // Nothing is loaded yet: no looks, and cells are loading.
    expect(model.lookAt(0, 0)).toBeUndefined();
    expect(model.cellAt(0, 0)).toMatchObject({ state: "loading", look: undefined });
    await settle();
    expect(asked[0]!.fields).toEqual(expect.arrayContaining(["id", "host", "ms", "tint"]));
    expect(model.lookAt(0, 0)).toEqual({ fill: "#ffe5e5" });
    expect(model.lookAt(3, 1)).toEqual({ color: "#ff0000" });
  });

  it("compile blocks from encodings as taken, not as their objects change after", async () => {
    const fill = { value: "#eeeeee" };
    const encode = { fill };
    const { model } = remote({ encode } as never);
    await settle();
    expect(model.lookAt(0, 0)).toEqual({ fill: "#eeeeee" });
    fill.value = "bad color!";
    expect(() => model.update({ encode } as never)).toThrow(
      'remote grid encode.fill.value: expected a CSS color; received "bad color!"',
    );
    // A new block compiles the looks as they were taken.
    model.setSort([{ field: "id", order: "descending" }] as never);
    await settle();
    expect(model.lookAt(0, 0)).toEqual({ fill: "#eeeeee" });
  });

  it("refuse what a remote grid cannot find: domains from every row, and ranks", () => {
    expect(() =>
      remote({
        columns: [{ field: "ms", encode: { fill: { field: "ms", scale: "heat" } } }] as never,
        scales: { heat: { type: "linear", range: ["#ffffff", "#ff0000"] } },
      }),
    ).toThrow(
      'remote grid columns[0].encode.fill.scale: "heat" finds its domain from every row, which a remote grid does not hold; give the scale a domain',
    );
    expect(() => remote({ scales: { hosts: { type: "ordinal" } } })).toThrow(
      "remote grid scales.hosts: a remote grid's categories arrive block by block, so palette places would depend on load order; give the scale a domain (values outside it take unknown)",
    );
    expect(() =>
      remote({ scales: { hosts: { type: "ordinal", domain: ["web"], map: { api: "#ff0000" } } } }),
    ).toThrow(
      'remote grid scales.hosts.map.api: "api" is not in the scale\'s domain; add it to domain, or drop it from map',
    );
    expect(() =>
      remote({
        columns: [
          {
            field: "ms",
            encode: { fill: { condition: { when: { top: 3, field: "ms" }, then: "#ff0000" } } },
          },
        ] as never,
      }),
    ).toThrow(
      "remote grid columns[0].encode.fill.condition.when: a rank reads every row, which a remote grid does not hold; compare with a value",
    );
  });

  it("give values outside a scale's domain its unknown, whatever block they arrive in", async () => {
    const { model } = remote({
      columns: [{ field: "host", encode: { fill: { field: "host", scale: "hosts" } } }] as never,
      scales: {
        hosts: {
          type: "ordinal",
          domain: ["web", "api"],
          map: { web: "#00aa00" },
          unknown: "#cccccc",
        },
      },
    });
    await settle();
    // web, api, web, db, (missing), api: api takes the palette's second place, db the unknown.
    expect(Array.from({ length: 6 }, (_, i) => model.lookAt(i, 0)?.fill ?? null)).toEqual([
      "#00aa00",
      "var(--hg-palette-1)",
      "#00aa00",
      "#cccccc",
      null,
      "var(--hg-palette-1)",
    ]);
  });

  it("give group rows no look from aggregates a query lacks", async () => {
    const { model } = remote({
      columns: [
        { field: "host" },
        { field: "ms", aggregateEncode: { fill: { field: "avg", scale: "heat" } } },
      ] as never,
      scales: { heat: { type: "linear", domain: [0, 100], range: ["#ffffff", "#ff0000"] } },
    });
    model.setQuery({ group: { by: ["host"], aggregate: [{ op: "count", as: "n" }] } } as never);
    await settle();
    expect(model.rowCount).toBe(4);
    expect(Array.from({ length: 4 }, (_, i) => model.lookAt(i, 1))).toEqual(
      Array(4).fill(undefined),
    );
  });

  it("color group rows by the query's aggregates", async () => {
    const { model } = remote({
      columns: [
        { field: "host" },
        {
          field: "ms",
          aggregate: "avg",
          aggregateEncode: { fill: { field: "avg", scale: "heat" } },
        },
      ] as never,
      scales: { heat: { type: "linear", domain: [0, 100], range: ["#ffffff", "#ff0000"] } },
    });
    model.setQuery({
      group: { by: ["host"], aggregate: [{ op: "mean", field: "ms", as: "avg" }] },
    } as never);
    await settle();
    const rows = Array.from({ length: model.rowCount }, (_, i) => [
      model.textAt(i, 0),
      model.lookAt(i, 1)?.fill ?? null,
    ]);
    expect(rows).toContainEqual(["db (1)", "#ff0000"]);
    expect(rows).toContainEqual(["api (2)", "#ff6666"]);
  });
});
