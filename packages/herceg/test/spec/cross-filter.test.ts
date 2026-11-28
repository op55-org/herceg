// Specs' views by channels, groups, and totals entries: what the loader makes
// of them, in what order, and what it refuses.
import { describe, expect, it } from "vitest";
import { contributorsOf, type LinkedRecord } from "../../src/data/contributor-records.ts";
import { RemovalLog } from "../../src/data/removal-log.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { selectionStore, selectRows, selectWhere } from "../../src/data/selection.ts";
import type { Table } from "../../src/data/table.ts";
import { loadSpec } from "../../src/spec/load.ts";
import type { ChartSpec, DataSpec } from "../../src/spec/spec.ts";
import { validateSpec } from "../../src/spec/validate.ts";
import { contractTest } from "../helpers/contracts.ts";

const SALES = {
  columns: {
    region: ["North", "South", "North", "East", "South", "West"],
    service: ["api", "web", "web", "api", "api", "web"],
    day: [1, 1, 2, 2, 3, 3],
    revenue: [10, 20, 30, 40, 50, 60],
  },
};

const spec = (data: Record<string, DataSpec>, extra: Partial<ChartSpec> = {}): ChartSpec => ({
  data: { sales: SALES, ...data },
  marks: [],
  ...extra,
});

/** A table's rows as objects. */
const rows = (table: Table) =>
  Array.from({ length: table.length }, (_, i) =>
    Object.fromEntries(table.fields().map((field) => [field, table.value(field, i)])),
  );

describe("groups and totals entries in specs", () => {
  contractTest("spec.data.groups", () => {
    const loaded = loadSpec(
      spec({
        shown: { source: "sales", view: { filter: [">=", ["field", "day"], 2] } },
        byService: {
          source: "shown",
          groups: {
            by: ["region", "service"],
            ops: { revenue: { op: "sum", field: "revenue" }, n: { op: "count" } },
          },
        },
        byRegion: {
          source: "shown",
          groups: {
            by: ["region", "service"],
            ops: { revenue: { op: "sum", field: "revenue" }, n: { op: "count" } },
            level: "region",
          },
        },
        regions: { source: "sales", groups: { by: ["region"] } },
      }),
    );
    const { tables } = loaded;
    expect(rows(tables.get("byRegion")!)).toEqual([
      { region: "North", revenue: 30, n: 1 },
      { region: "East", revenue: 40, n: 1 },
      { region: "South", revenue: 50, n: 1 },
      { region: "West", revenue: 60, n: 1 },
    ]);
    expect(tables.get("byService")!.fields()).toEqual(["region", "service", "revenue", "n"]);
    // Entries of one source, by, and ops share their groups; tables are named by their entries.
    expect(tables.get("byRegion")!.name).toBe("byRegion");
    expect(tables.get("byService")!.name).toBe("byService");
    // A table's groups read every row; keys alone, with no ops.
    expect(rows(tables.get("regions")!)).toEqual([
      { region: "North" },
      { region: "South" },
      { region: "East" },
      { region: "West" },
    ]);
    // They follow the view and the table.
    loaded.views.get("shown")!.setQuery({ filter: [">=", ["field", "day"], 3] });
    expect(rows(tables.get("byRegion")!)).toEqual([
      { region: "South", revenue: 50, n: 1 },
      { region: "West", revenue: 60, n: 1 },
    ]);
    tables.get("sales")!.append({ region: ["North"], service: ["api"], day: [4], revenue: [70] });
    expect(rows(tables.get("byRegion")!).map(({ region }) => region)).toEqual([
      "North",
      "South",
      "West",
    ]);
  });

  it("share one groups for entries of one source, by, and ops", () => {
    const groups = { by: ["region", "service"], ops: { n: { op: "count" as const } } };
    const { tables } = loadSpec(
      spec({
        a: { source: "sales", groups },
        b: { source: "sales", groups: { ...groups, level: "region" } },
        c: { source: "sales", groups: { ...groups, ops: { m: { op: "count" } } } },
      }),
    );
    expect(["a", "b", "c"].map((name) => tables.get(name)!.length)).toEqual([6, 4, 6]);
    // a and b read one groups, whose levels share one log of dropped rows; c's are others.
    const groupsOf = (name: string) => contributorsOf(tables.get(name)!) as LinkedRecord;
    const release = groupsOf("a").hold(() => new RemovalLog(0, 64));
    expect(groupsOf("b").log).toBe(groupsOf("a").log);
    expect(groupsOf("c").log).toBeNull();
    release();
    expect(groupsOf("a").keys).toEqual(["region", "service"]);
    expect(groupsOf("b").keys).toEqual(["region"]);
    expect(tables.get("b")!.fields()).toEqual(["region", "n"]);
    expect(tables.get("c")!.fields()).toEqual(["region", "service", "m"]);
    expect(groupsOf("a").links()[0]!.targets).toBe(6);
  });

  it("share groups however their aggregates are written, and one store for one table's names", () => {
    const sum = { op: "sum", field: "revenue" } as const;
    const loaded = loadSpec(
      spec(
        {
          e: { source: "sales", groups: { by: ["region"], ops: { s: sum } } },
          v: { source: "e", view: { selection: {} } },
          byV: { source: "v", groups: { by: ["region"] } },
          // Listed after the view of e, and known with e as its table.
          f: {
            source: "sales",
            groups: { by: ["region"], ops: { s: { field: "revenue", op: "sum" } } },
          },
        },
        {
          marks: [{ type: "bar", data: "v", x: "region", y: "s" }],
          rowSelection: {
            data: "f",
            channel: "big",
            selection: { kind: "predicate", expression: [">", ["field", "s"], 50] },
          },
        },
      ),
    );
    expect(loaded.tables.get("f")).toBe(loaded.tables.get("e"));
    // The view of e follows the store the binding of f writes: they name one table.
    expect(loaded.stores.get("e")).toBe(loaded.stores.get("f"));
    expect(loaded.views.get("v")!.read().length).toBe(2);
    // Seeded before the groups of v first grouped: South and West, which it selects, come first.
    loaded.stores.get("f")!.set("big", null);
    expect(rows(loaded.tables.get("byV")!).map((row) => row.region)).toEqual([
      "South",
      "West",
      "North",
      "East",
    ]);
    // Two names given one table take one store: two given are refused.
    const t = loaded.tables.get("sales")!;
    expect(() =>
      loadSpec(
        {
          data: {
            a: { columns: {} },
            b: { columns: {} },
            va: { source: "a", view: { selection: {} } },
            vb: { source: "b", view: { selection: {} } },
          },
          marks: [],
        },
        [],
        { tables: { a: t, b: t }, stores: { a: selectionStore(t), b: selectionStore(t) } },
      ),
    ).toThrowError(
      'stores.b: "b" and "a" name one table, and their stores given differ; give them one store',
    );
  });

  it("take the store given for any name of a table, and seed it from the bindings of all its names", () => {
    const t = loadSpec(spec({})).tables.get("sales")!;
    const aliases = { a: { columns: {} }, b: { columns: {} } };
    const given = selectionStore(t);
    const follows = (data: Record<string, DataSpec>, extra: Partial<ChartSpec> = {}) =>
      loadSpec({ data: { ...aliases, ...data }, marks: [], ...extra }, [], {
        tables: { a: t, b: t },
        stores: { b: given },
      });
    // Given for b, it is a's store too, whichever name a view follows first.
    expect(follows({ va: { source: "a", view: { selection: {} } } }).stores.get("a")).toBe(given);
    const both = follows({
      va: { source: "a", view: { selection: {} } },
      vb: { source: "b", view: { selection: {} } },
    });
    expect([both.stores.get("a"), both.stores.get("b")]).toEqual([given, given]);
    // A binding of b's initial selection reaches a view of a before its groups first group:
    // South, which it selects, keeps the first place when the selection clears.
    const seeded = loadSpec(
      {
        data: {
          ...aliases,
          v: { source: "a", view: { selection: {} } },
          byRegion: { source: "v", groups: { by: ["region"] } },
        },
        marks: [],
        rowSelection: {
          data: "b",
          channel: "pick",
          selection: { kind: "predicate", expression: ["==", ["field", "region"], "South"] },
        },
      },
      [],
      { tables: { a: t, b: t } },
    );
    seeded.stores.get("b")!.set("pick", null);
    expect(rows(seeded.tables.get("byRegion")!).map((row) => row.region)).toEqual([
      "South",
      "North",
      "East",
      "West",
    ]);
  });

  it("say a binding's initial selection's errors at the binding, though a view makes its store", () => {
    expect(() =>
      loadSpec(
        spec(
          { shown: { source: "sales", view: { selection: {} } } },
          {
            rowSelection: {
              data: "sales",
              channel: "pick",
              selection: { kind: "predicate", expression: ["==", ["field", "nope"], 1] },
            },
          },
        ),
      ),
    ).toThrowError(/^rowSelection\.selection\.expression: /);
  });

  it("name a level's table by its entry, whatever its grouping field is called", () => {
    const loaded = loadSpec(
      spec({
        named: { columns: { constructor: ["a", "b", "a"], toString: [1, 2, 3] } },
        byConstructor: { source: "named", groups: { by: ["constructor"] } },
        byToString: { source: "named", groups: { by: ["toString"] } },
      }),
    );
    expect(loaded.tables.get("byConstructor")!.name).toBe("byConstructor");
    expect(loaded.tables.get("byToString")!.name).toBe("byToString");
  });

  contractTest("spec.data.totals", () => {
    const loaded = loadSpec(
      spec({
        shown: { source: "sales", view: { filter: ["==", ["field", "service"], "api"] } },
        total: {
          source: "shown",
          totals: { ops: { n: { op: "count" }, revenue: { op: "sum", field: "revenue" } } },
        },
      }),
    );
    expect(rows(loaded.tables.get("total")!)).toEqual([{ n: 3, revenue: 100 }]);
    expect(loaded.tables.get("total")!.name).toBe("total");
  });

  contractTest("spec.data.view-selection", () => {
    // A view following every channel but its panel's own, of the store the bindings write.
    const dashboard = spec(
      {
        shown: { source: "sales", view: { selection: { excluding: "regions" } } },
        byRegion: {
          source: "shown",
          groups: { by: ["region"], ops: { revenue: { op: "sum", field: "revenue" } } },
        },
      },
      {
        marks: [{ type: "bar", data: "byRegion", x: "region", y: "revenue" }],
        rowSelection: {
          data: "sales",
          channel: "regions",
          selection: { kind: "predicate", expression: ["==", ["field", "region"], "North"] },
        },
      },
    );
    expect(() => validateSpec(dashboard)).not.toThrow();
    const loaded = loadSpec(dashboard);
    const store = loaded.stores.get("sales")!;
    const byRegion = loaded.tables.get("byRegion")!;
    // The panel's own channel filters nothing of its own rows.
    expect(rows(byRegion).length).toBe(4);
    store.set("days", selectWhere(["<=", ["field", "day"], 2]));
    expect(rows(byRegion)).toEqual([
      { region: "North", revenue: 40 },
      { region: "South", revenue: 20 },
      { region: "East", revenue: 40 },
    ]);
    // A grid's rows intersect.
    store.set("grid", selectRows(new RowSet(store.source).addAll([0, 1, 4])));
    expect(rows(byRegion)).toEqual([
      { region: "North", revenue: 10 },
      { region: "South", revenue: 20 },
    ]);
    store.set("grid", null);
    store.set("days", null);
    expect(rows(byRegion).map(({ region }) => region)).toEqual(["North", "South", "East", "West"]);
  });

  it("make the stores the bindings and views name before what reads them, seeded once", () => {
    // The seed holds South only: groups made after it meet South first, so
    // North, appearing later, comes after it once the channel clears.
    const seeded = spec(
      {
        shown: { source: "sales", view: { selection: {} } },
        byRegion: { source: "shown", groups: { by: ["region"], ops: { n: { op: "count" } } } },
      },
      {
        marks: [{ type: "bar", data: "byRegion", x: "region", y: "n" }],
        rowSelection: {
          data: "sales",
          channel: "c",
          selection: { kind: "predicate", expression: ["==", ["field", "region"], "South"] },
        },
      },
    );
    const loaded = loadSpec(seeded);
    const store = loaded.stores.get("sales")!;
    expect(rows(loaded.tables.get("byRegion")!)).toEqual([{ region: "South", n: 2 }]);
    store.set("c", null);
    expect(rows(loaded.tables.get("byRegion")!).map(({ region }) => region)).toEqual([
      "South",
      "North",
      "East",
      "West",
    ]);
    // A store given keeps what it holds, and views follow it.
    const sales = loaded.tables.get("sales")!;
    const given = selectionStore(sales);
    given.set("c", selectWhere(["==", ["field", "region"], "West"]));
    const again = loadSpec(seeded, [], { tables: { sales }, stores: { sales: given } });
    expect(again.stores.get("sales")).toBe(given);
    expect(rows(again.tables.get("byRegion")!)).toEqual([{ region: "West", n: 1 }]);
    // A view's store is listed though no binding names it.
    const unbound = loadSpec(spec({ shown: { source: "sales", view: { selection: {} } } }));
    expect(unbound.stores.get("sales")?.source).toBe(unbound.tables.get("sales"));
  });

  contractTest("spec.binding.live", () => {
    const { config } = loadSpec(
      spec(
        {},
        {
          marks: [{ type: "point", data: "sales", x: "day", y: "revenue" }],
          interaction: { brush: "x" },
          rowSelection: { data: "sales", channel: "c", live: true },
        },
      ),
    );
    expect(config.rowSelection!.bindings[0]!.live).toBe(true);
  });

  it("refuse groups operations they do not keep, levels not grouped by, and channels with exclusions", () => {
    const refused = (data: Record<string, unknown>) => () =>
      validateSpec(spec(data as Record<string, DataSpec>));
    expect(
      refused({
        byRegion: {
          source: "sales",
          groups: { by: ["region"], ops: { p50: { op: "median", field: "revenue" } } },
        },
      }),
    ).toThrowError(
      'data.byRegion.groups.ops.p50.op: "median" is not one groups keep; use count, sum, mean, min, or max, or a derived table\'s aggregate',
    );
    expect(
      refused({
        t: { source: "sales", totals: { ops: { p50: { op: "median", field: "revenue" } } } },
      }),
    ).toThrowError('data.t.totals.ops.p50.op: "median" is not one totals keep; use count');
    expect(refused({ byRegion: { source: "sales", groups: { by: "region" } } })).toThrowError(
      'data.byRegion.groups.by: expected a list of field names; received "region"',
    );
    expect(refused({ byRegion: { source: "sales", groups: { by: [] } } })).toThrowError(
      "data.byRegion.groups.by: expected at least one field name",
    );
    expect(
      refused({ byRegion: { source: "sales", groups: { by: ["region"], level: "service" } } }),
    ).toThrowError(
      'data.byRegion.groups.level: "service" is not one of by ("region"); name one of them',
    );
    expect(
      refused({
        byRegion: { source: "sales", groups: { by: ["region"], ops: { s: { op: "sum" } } } },
      }),
    ).toThrowError("data.byRegion.groups.ops.s.field: required");
    expect(
      refused({
        shown: { source: "sales", view: { selection: { channels: ["a"], excluding: "b" } } },
      }),
    ).toThrowError("data.shown.view.selection: give channels or excluding, not both");
    expect(refused({ total: { source: "sales", totals: { ops: {} } } })).toThrow(
      /data\.total\.totals\.ops: expected at least one aggregate/,
    );
    // The loader refuses what the validator cannot know: fields, and cycles.
    expect(() => loadSpec(spec({ g: { source: "sales", groups: { by: ["nope"] } } }))).toThrowError(
      /^data\.g\.groups\.by\[0\]: no field "nope"; the rows have "/,
    );
    expect(() =>
      loadSpec(
        spec({
          g: {
            source: "sales",
            groups: { by: ["region"], ops: { s: { op: "sum", field: "nope" } } },
          },
        }),
      ),
    ).toThrowError(/^data\.g\.groups\.ops\.s\.field: no field "nope"; the rows have "/);
    expect(() =>
      loadSpec(
        spec({ t: { source: "sales", totals: { ops: { s: { op: "sum", field: "nope" } } } } }),
      ),
    ).toThrowError(/^data\.t\.totals\.ops\.s\.field: no field "nope"/);
    expect(() =>
      loadSpec(
        spec({
          v: { source: "g", view: {} },
          g: { source: "v", groups: { by: ["region"] } },
        }),
      ),
    ).toThrowError("data.g.source: the table is made from itself; make it from another");
    expect(() => loadSpec(spec({ g: { source: "nope", groups: { by: ["region"] } } }))).toThrow(
      /data\.g\.source: no table "nope" in data/,
    );
  });
});
