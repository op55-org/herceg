// Totals rows in grid models: a local grid's (its texts, label, focus, and
// checks, while rows stream, drop, and filter), with groups, a pivot's, and
// a remote grid's asked of its source; and columns' headings.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.

import { describe, expect, it } from "vitest";
import { count, max, mean, sum } from "../../src/data/aggregations.ts";
import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { type Table, table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import type { BaseGridModel } from "../../src/grid/base.ts";
import { memorySource } from "../../src/grid/memory.ts";
import { createGridModel, type GridColumn, type GridModel } from "../../src/grid/model.ts";
import { createPivotGridModel } from "../../src/grid/pivot.ts";
import { createRemoteGridModel, type RemoteGridModel } from "../../src/grid/remote.ts";
import {
  type GridSource,
  GridSourceError,
  type GridSourceErrorCode,
  type TotalsAnswer,
  type TotalsRequest,
} from "../../src/grid/source.ts";

/** Requests: a host, a latency, and bytes. */
const requests = (options?: { maxRows?: number }) =>
  table(
    {
      host: category(["web", "api", "web", "db"]),
      ms: [10, 20, 30, 40],
      bytes: [1000, 2000, 3000, 4000],
    },
    options,
  );

const OPS = { n: count(), ms: mean("ms"), bytes: sum("bytes"), worst: max("ms") };

const COLUMNS = [
  { field: "host" },
  { field: "ms", aggregate: "ms" },
  { field: "bytes", aggregate: "bytes" },
  { field: "ms", id: "n", aggregate: "n" },
];

function grid(
  columns: readonly object[] = COLUMNS,
  options: { maxRows?: number; groups?: boolean } = {},
) {
  const t = requests(options);
  const view = rowView(t);
  const totals = rowTotals(view, { ops: OPS });
  const model = createGridModel({
    data: view,
    totals,
    ...(options.groups && { groups: groupRows(view, { by: ["host"], ops: OPS }) }),
    columns: columns as GridColumn[],
    locale: "en-US",
  } as never) as GridModel;
  model.setViewport(800, 400);
  return { t: t as unknown as Table, view: view as unknown as RowView, totals, model };
}

/** The totals row's text in each shown column. */
const texts = (model: Pick<BaseGridModel, "columnLayout" | "totalsRow">) =>
  model.columnLayout.map((_, c) => model.totalsRow!.textAt(c));

describe("a grid's totals row", () => {
  it("writes each column's total as group rows write aggregates, and Total in the first column without one", () => {
    const { model } = grid();
    expect(texts(model)).toEqual(["Total", "25", "10,000", "4"]);
    const row = model.totalsRow!;
    expect(row.label).toBe(0);
    expect(row.state).toBe("loaded");
    expect(row.cellAt(1)).toMatchObject({ state: "value", value: 25, kind: "number", text: "25" });
    expect(row.cellAt(0)).toMatchObject({ state: "empty", value: undefined, kind: null });
    // The label goes where the first column without a total goes.
    model.moveColumn("host", null);
    expect(model.totalsRow!.label).toBe(3);
    expect(texts(model)).toEqual(["25", "10,000", "4", "Total"]);
    // With a total in every shown column, no cell says it: the row is named so.
    model.setColumnVisible("host", false);
    expect(model.totalsRow!.label).toBe(-1);
    expect(texts(model)).toEqual(["25", "10,000", "4"]);
  });

  it("follows appends, drops, changes in place, and filters, over no rows too", () => {
    const { t, view, model } = grid(COLUMNS, { maxRows: 5 });
    const version = model.totalsRow!.version;
    t.append({ host: ["api"], ms: [50], bytes: [5000] });
    expect(texts(model)).toEqual(["Total", "30", "15,000", "5"]);
    expect(model.totalsRow!.version).toBeGreaterThan(version);
    // A rolling window drops the first row.
    t.append({ host: ["db"], ms: [60], bytes: [6000] });
    expect(texts(model)).toEqual(["Total", "40", "20,000", "5"]);
    t.replace(0, { ms: [0] });
    expect(texts(model)).toEqual(["Total", "36", "20,000", "5"]);
    view.setQuery({ filter: col("host").eq("db") });
    expect(texts(model)).toEqual(["Total", "50", "10,000", "2"]);
    view.setQuery({ filter: col("host").eq("none") });
    expect(texts(model)).toEqual(["Total", "", "0", "0"]);
    expect(model.totalsRow!.cellAt(1)).toMatchObject({ state: "missing", value: null });
  });

  it("keeps the focus on the totals row as rows come and go, and selects nothing from it", () => {
    const { t, model } = grid();
    model.focusCell(3, "ms");
    model.moveFocus("down");
    expect(model.focus).toMatchObject({ rowIndex: 4, column: "ms" });
    t.append({ host: ["api"], ms: [1], bytes: [1] });
    expect(model.focus).toMatchObject({ rowIndex: 5, column: "ms" });
    model.moveFocus("down");
    expect(model.focus!.rowIndex).toBe(5);
    model.moveFocus("up", { extend: true });
    expect(model.focus!.rowIndex).toBe(4);
    expect(model.selectedCount).toBe(0);
    model.moveFocus("first");
    model.moveFocus("last");
    expect(model.focus).toMatchObject({ rowIndex: 5, column: "n" });
    // Without the row, the focus goes to the last row.
    model.update({ totals: null });
    expect(model.totalsRow).toBeNull();
    expect(model.focus!.rowIndex).toBe(4);
    expect(() => model.focusCell(5, "ms")).toThrow(RangeError);
  });

  it("takes the focus to the totals row with PageDown, and keeps it there", () => {
    const { view, model } = grid();
    model.focusCell(0, "ms");
    for (const rowIndex of [3, 4, 4]) {
      model.moveFocus("pageDown");
      expect(model.focus!.rowIndex).toBe(rowIndex);
    }
    // Without rows: from the header to the totals row.
    view.setQuery({ filter: col("host").eq("none") });
    model.focusCell(-1, "ms");
    for (const _ of [1, 2]) {
      model.moveFocus("pageDown");
      expect(model.focus!.rowIndex).toBe(0);
    }
  });

  it("is one with groups: an aggregate of either, one operation of one field, looks of its own", () => {
    const { model } = grid(
      [
        { field: "host" },
        {
          field: "ms",
          aggregate: "ms",
          aggregateEncode: { color: { condition: { when: col("worst").gt(30), then: "#ff0000" } } },
        },
      ],
      { groups: true },
    );
    // Group rows (api, db, web) and the totals row read their own tables.
    expect(model.textAt(0, 1)).toBe("20");
    expect(texts(model)).toEqual(["Total", "25"]);
    expect(model.totalsRow!.lookAt(1)).toEqual({ color: "#ff0000" });
    expect(model.lookAt(0, 1)).toBeUndefined();
    const t = requests();
    const view = rowView(t);
    const totals = rowTotals(view, { ops: OPS });
    const make = (ops: object, columns: object[]) => () =>
      createGridModel({
        data: view,
        groups: groupRows(view, { by: ["host"], ops } as never),
        totals,
        columns,
      } as never);
    expect(make({ ms: max("ms") }, [{ field: "ms", aggregate: "ms" }])).toThrow(
      'grid totals: "ms" is mean("ms") in the totals and max("ms") in the groups; make them one operation of one field',
    );
    expect(make({ top: max("ms") }, [{ field: "ms", aggregate: "p95" }])).toThrow(
      'grid columns[0].aggregate: no aggregate "p95" in the totals or the groups; they have "n", "ms", "bytes", "worst", "top"',
    );
    // A field in neither table is refused; one in either looks where it is.
    expect(
      make({ top: max("ms") }, [{ field: "ms", aggregateEncode: { fill: { field: "p95" } } }]),
    ).toThrow(/columns\[0\]\.aggregateEncode\.fill.*p95/);
  });

  it("changes with update({ totals }), all of the update or none of it", () => {
    const t = requests();
    const view = rowView(t);
    const model = createGridModel({ data: view, columns: COLUMNS as GridColumn[] } as never);
    expect(model.totalsRow).toBeNull();
    const totals = rowTotals(view, { ops: OPS });
    model.update({ totals } as never);
    expect(model.totals).toBe(totals);
    expect(model.totalsRow!.textAt(2)).toBe("10,000");
    // Refused: totals of another view, and with them anything else given.
    const other = rowTotals(rowView(t), { ops: OPS });
    expect(() => model.update({ totals: other } as never)).toThrow(
      "grid totals: expected rowTotals(data, { ops }) of the grid's view",
    );
    expect(() => model.update({ totals: null, scales: 1 } as never)).toThrow(/scales/);
    expect(model.totals).toBe(totals);
    // Totals lacking a column's aggregate.
    const fewer = rowTotals(view, { ops: { n: count() } });
    expect(() => model.update({ totals: fewer } as never)).toThrow(
      'grid columns[1].aggregate: no aggregate "ms" in the totals; they have "n"',
    );
    model.update({ totals: undefined } as never);
    expect(model.totalsRow).toBeNull();
  });
});

describe("a pivot's totals row", () => {
  /** Requests by host and region: a pivot of hosts by region, with totals. */
  function pivoted(totals: unknown) {
    const t = table({
      host: category(["web", "api", "web", "db"]),
      region: category(["eu", "eu", "us", "us"]),
      ms: [10, 20, 30, 40],
    });
    const pivot = pivotRows(rowView(t), {
      rows: "host",
      pivot: "region",
      ops: { ms: mean("ms") },
      totals,
    } as never);
    return { t, model: createPivotGridModel({ data: pivot, locale: "en-US" } as never) };
  }

  it("holds each value's aggregate of every row with it, and every row's, not means of means", () => {
    const { t, model } = pivoted(true);
    // host, eu, us, Total (each row's).
    expect(model.columnLayout.map(({ title }) => title)).toEqual(["host", "eu", "us", "Total"]);
    expect(texts(model)).toEqual(["Total", "15", "35", "25"]);
    t.append({ host: ["api"], region: ["us"], ms: [100] });
    expect(texts(model)).toEqual(["Total", "15", "56.67", "40"]);
    expect(model.totalsRow!.cellAt(3)).toMatchObject({ state: "value", value: 40 });
  });

  it("follows its groups' aggregates where none the pivot publishes changed", () => {
    // Means only: a row equal to its combination's mean changes neither mean.
    const t = table({ host: category(["a", "b"]), region: category(["x", "x"]), ms: [1, 3] });
    const pivot = pivotRows(rowView(t), {
      rows: "host",
      pivot: "region",
      ops: { ms: mean("ms") },
      totals: { row: true },
    });
    const model = createPivotGridModel({ data: pivot, locale: "en-US" });
    expect(pivot.read().columnTotal(0, "ms")).toBe(2);
    const version = model.totalsRow!.version;
    t.append({ host: ["a"], region: ["x"], ms: [1] });
    expect(pivot.read().columnTotal(0, "ms")).toBeCloseTo(5 / 3, 12);
    expect(pivot.read().columnTotal(-1, "ms")).toBeCloseTo(5 / 3, 12);
    expect(model.totalsRow!.version).toBeGreaterThan(version);
    expect(texts(model)).toEqual(["Total", "1.67"]);
  });

  it("keeps the totals of where a pivot stopped, its sums exact where they were read", () => {
    const values = [1e40, 1e20, 1, -1e40, -1e20];
    const stopped = (read: boolean) => {
      const t = table(
        {
          host: category(["a", "b", "c", "d", "e"]),
          region: category(["x", "x", "x", "x", "x"]),
          v: values,
        },
        { maxRows: 5 },
      );
      const pivot = pivotRows(rowView(t), {
        rows: "host",
        pivot: "region",
        ops: { v: sum("v") },
        totals: { row: true },
        limits: { generatedColumns: 1 },
      });
      if (read) expect(pivot.read().columnTotal(-1, "v")).toBe(1);
      // A second value would pass the limit: the pivot stops where it was, as the window drops a row.
      t.append({ host: ["f"], region: ["y"], v: [7] });
      expect(pivot.failure).not.toBeNull();
      return pivot.read().columnTotal(-1, "v");
    };
    expect(stopped(true)).toBe(1);
    // Folded first after it stopped, from its groups as they were: within their compensated sums.
    expect(Math.abs(stopped(false) - 1)).toBeLessThanOrEqual(1);
  });

  it("keeps exact totals once disposed, read first after", () => {
    const t = table({
      host: category(["a", "b", "c", "d", "e"]),
      region: category(["x", "x", "x", "x", "x"]),
      v: [1e40, 1e20, 1, -1e40, -1e20],
    });
    const pivot = pivotRows(rowView(t), {
      rows: "host",
      pivot: "region",
      ops: { v: sum("v") },
      totals: { row: true },
    });
    pivot.dispose();
    expect(pivot.read().columnTotal(0, "v")).toBe(1);
    expect(pivot.read().columnTotal(-1, "v")).toBe(1);
  });

  it("counts its folds in the pivot's bytes", () => {
    const t = table({
      host: category(["web", "api"]),
      region: category(["eu", "us"]),
      ms: [10, 20],
    });
    const make = (row: boolean) =>
      pivotRows(rowView(t), {
        rows: "host",
        pivot: "region",
        ops: { ms: mean("ms") },
        totals: { row },
      });
    const [without, withRow] = [make(false), make(true)];
    withRow.read().columnTotal(-1, "ms");
    without.read();
    expect(withRow.byteLength).toBeGreaterThan(without.byteLength);
  });

  it("is there only with totals: true or { row: true }, and refuses totals given to the grid", () => {
    expect(pivoted({ columns: true }).model.totalsRow).toBeNull();
    const { model } = pivoted({ row: true });
    expect(texts(model)).toEqual(["Total", "15", "35"]);
    expect(() => model.update({ totals: {} } as never)).toThrow(
      "pivot grid totals: a pivot's totals row is its own; give pivotRows totals: { row: true }",
    );
  });
});

describe("a remote grid's totals row", () => {
  /** The reference source over requests, whose totals answer when told (or at once). */
  function remote(options: { now?: boolean } = {}) {
    const data = table({
      id: Float64Array.from({ length: 300 }, (_, i) => i),
      ms: Float64Array.from({ length: 300 }, (_, i) => i % 10),
      host: category(Array.from({ length: 300 }, (_, i) => ["web", "api", "db"][i % 3]!)),
    });
    const memory = memorySource(data, { key: "id" });
    const asked: { request: TotalsRequest; signal: AbortSignal; answer(): Promise<void> }[] = [];
    const answers: Promise<TotalsAnswer>[] = [];
    const source: GridSource = {
      schema: memory.schema,
      rows: (request, signal) => memory.rows(request, signal),
      totals: (request, signal) => {
        if (options.now) return memory.totals(request, signal);
        return new Promise((resolve, reject) => {
          asked.push({
            request,
            signal,
            answer: async () => {
              const answer = memory.totals(request, new AbortController().signal);
              answers.push(answer);
              answer.then(resolve, reject);
              await answer;
            },
          });
        });
      },
    };
    return { data, memory, source, asked };
  }

  const settle = async () => {
    for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const TOTALS = [
    { op: "count", as: "n" },
    { op: "mean", field: "ms", as: "ms" },
  ] as const;

  function model(source: GridSource, totals: unknown = TOTALS) {
    const made = createRemoteGridModel({
      source,
      totals,
      columns: [
        { field: "host" },
        { field: "ms", aggregate: "ms" },
        { field: "id", aggregate: "n" },
      ],
      locale: "en-US",
    } as never);
    made.setViewport(600, 300);
    return made;
  }

  it("asks the source once per snapshot, after the first window names it", async () => {
    const { source, asked } = remote();
    const grid = model(source);
    expect(grid.totalsRow!.state).toBe("loading");
    expect(grid.status.totals).toBe("loading");
    await settle();
    expect(asked).toHaveLength(1);
    const { request } = asked[0]!;
    expect(typeof request.snapshot).toBe("string");
    expect(request.aggregate).toEqual(TOTALS);
    expect(grid.totalsRow!.cellAt(1)).toMatchObject({ state: "loading", text: "" });
    await asked[0]!.answer();
    await settle();
    expect(grid.totalsRow!.state).toBe("loaded");
    expect(texts(grid)).toEqual(["Total", "4.5", "300"]);
    // Scrolling and more windows ask no more.
    grid.scrollTo({ top: 2000 });
    await settle();
    expect(asked).toHaveLength(1);
    // A refresh is a new snapshot, asked again.
    grid.refresh();
    expect(grid.totalsRow!.state).toBe("loading");
    await settle();
    expect(asked).toHaveLength(2);
    grid.dispose();
  });

  it("drops answers for a query or totals since replaced, and aborts their requests", async () => {
    const { source, asked } = remote();
    const grid = model(source);
    await settle();
    grid.setQuery({ filter: ["==", ["field", "host"], "api"] });
    await settle();
    expect(asked).toHaveLength(2);
    expect(asked[0]!.signal.aborted).toBe(true);
    // The first query's answer comes late: dropped.
    await asked[0]!.answer();
    await settle();
    expect(grid.totalsRow!.state).toBe("loading");
    await asked[1]!.answer();
    await settle();
    expect(texts(grid)).toEqual(["Total", "4.5", "100"]);
    // Other totals: asked for the same snapshot.
    grid.update({ totals: [{ op: "max", field: "ms", as: "ms" }] } as never);
    await settle();
    expect(asked).toHaveLength(3);
    expect(asked[2]!.request.snapshot).toBe(asked[1]!.request.snapshot);
    expect(asked[1]!.signal.aborted).toBe(false);
    await asked[2]!.answer();
    await settle();
    expect(texts(grid)).toEqual(["Total", "9", ""]);
    grid.update({ totals: null } as never);
    expect(grid.totalsRow).toBeNull();
    expect(grid.status.totals).toBeNull();
    grid.dispose();
  });

  it("fails as windows do: said in the status, asked again on retry", async () => {
    const { source } = remote({ now: true });
    let fail = true;
    const failing: GridSource = {
      ...source,
      totals: (request, signal) =>
        fail
          ? Promise.reject(new GridSourceError("unavailable", "The server is down"))
          : source.totals!(request, signal),
    };
    const grid = model(failing);
    await settle();
    expect(grid.status.totals).toBe("failed");
    expect(grid.status.failed).toBe(0);
    expect(grid.status.error?.message).toBe("The server is down");
    expect(grid.totalsRow!.cellAt(1)).toMatchObject({ state: "failed", text: "" });
    fail = false;
    grid.retry();
    await settle();
    expect(grid.status.totals).toBe("loaded");
    expect(texts(grid)).toEqual(["Total", "4.5", "300"]);
    // An answer of the wrong shape is refused as windows' are.
    const wrong: GridSource = {
      ...source,
      totals: async (request) => ({
        revision: request.revision,
        snapshot: request.snapshot,
        columns: {},
      }),
    };
    const refused = model(wrong);
    await settle();
    expect(refused.status.error).toMatchObject({
      code: "invalid-response",
      message: 'The totals answer lacks "n"',
    });
    grid.dispose();
    refused.dispose();
  });

  it("forgets a failure of totals replaced or dropped, keeping the rows'", async () => {
    const { source } = remote({ now: true });
    const failing: GridSource = {
      ...source,
      totals: (request, signal) =>
        request.aggregate.some(({ op }) => op === "count")
          ? Promise.reject(new GridSourceError("unavailable", "The totals are down"))
          : source.totals!(request, signal),
    };
    const grid = model(failing);
    await settle();
    expect(grid.status.error?.message).toBe("The totals are down");
    grid.update({ totals: [{ op: "max", field: "ms", as: "ms" }] } as never);
    await settle();
    expect(grid.status.totals).toBe("loaded");
    expect(grid.status.error).toBeNull();
    grid.update({ totals: TOTALS } as never);
    await settle();
    expect(grid.status.totals).toBe("failed");
    grid.update({ totals: null } as never);
    expect(grid.status.error).toBeNull();
    grid.dispose();
  });

  it("keeps a snapshot the totals found expired failed until a refresh, whatever the totals", async () => {
    const { source } = remote({ now: true });
    let calls = 0;
    const expiring: GridSource = {
      ...source,
      totals: () => {
        calls++;
        return Promise.reject(
          calls === 1
            ? new GridSourceError("snapshot-expired", "The snapshot expired")
            : new GridSourceError("unavailable", "The server is down"),
        );
      },
    };
    const grid = model(expiring);
    await settle();
    expect(grid.status.error?.message).toBe("The snapshot expired");
    // Other totals are not asked of an expired snapshot, then none: the failure stays.
    grid.update({ totals: [{ op: "max", field: "ms", as: "ms" }] } as never);
    await settle();
    expect(calls).toBe(1);
    expect(grid.status.totals).toBe("failed");
    grid.update({ totals: null } as never);
    await settle();
    expect(grid.status.error?.message).toBe("The snapshot expired");
    grid.dispose();
  });

  /**
   * A remote grid over a source whose requests wait to be settled by hand:
   * rows after a query's first window (which starts its snapshot), and totals.
   */
  function held() {
    const { memory } = remote();
    type Held = {
      signal: AbortSignal;
      settled: boolean;
      fail(code: GridSourceErrorCode): void;
      answer(): void;
    };
    let rows: Held[] = [];
    let totals: Held[] = [];
    const hold = <T>(list: Held[], signal: AbortSignal, ask: () => Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        const one: Held = {
          signal,
          settled: false,
          fail: (code) => {
            one.settled = true;
            reject(new GridSourceError(code, `The source said ${code}`));
          },
          answer: () => {
            one.settled = true;
            ask().then(resolve, reject);
          },
        };
        list.push(one);
      });
    const unsignalled = () => new AbortController().signal;
    const source: GridSource = {
      schema: memory.schema,
      rows: (request, signal) =>
        request.snapshot === null
          ? memory.rows(request, signal)
          : hold(rows, signal, () => memory.rows(request, unsignalled())),
      totals: (request, signal) =>
        hold(totals, signal, () => memory.totals(request, unsignalled())),
    };
    const grid = createRemoteGridModel({
      source,
      totals: TOTALS,
      columns: [
        { field: "host" },
        { field: "ms", aggregate: "ms" },
        { field: "id", aggregate: "n" },
      ],
      blockSize: 32,
      settleDelay: 0,
      locale: "en-US",
    } as never);
    grid.setViewport(600, 300);
    // The requests still waited for: neither settled nor aborted.
    const live = (list: Held[]) => list.filter((one) => !one.settled && !one.signal.aborted);
    return {
      grid,
      rows: () => (rows = live(rows)),
      totals: () => (totals = live(totals)),
    };
  }

  for (const order of ["rows, then totals", "totals, then rows"] as const)
    it(`keeps a snapshot's expiry the grid's failure through late failures (${order}) until a retry refreshes`, async () => {
      const { grid, rows, totals } = held();
      await settle();
      expect(totals()).toHaveLength(1);
      grid.scrollTo({ top: grid.rowHeight * 200 });
      await settle();
      const asked = rows().length;
      expect(asked).toBeGreaterThan(1);
      const expired = () => {
        expect(grid.status.error?.message).toBe("The source said snapshot-expired");
        expect(grid.status.starting).toBe(false);
      };
      if (order === "rows, then totals") {
        rows()[0]!.fail("snapshot-expired");
        await settle();
        expired();
        totals()[0]!.fail("unavailable");
      } else {
        totals()[0]!.fail("unavailable");
        await settle();
        expect(grid.status.error?.message).toBe("The source said unavailable");
        rows()[0]!.fail("snapshot-expired");
      }
      await settle();
      expired();
      expect(grid.status.totals).toBe("failed");
      // Rows failing after it do not hide it either.
      for (const one of rows()) one.fail("unavailable");
      await settle();
      expect(grid.status.failed).toBe(asked);
      expired();
      // Other totals are not asked of the expired snapshot, then none: the expiry stays.
      grid.update({ totals: [{ op: "max", field: "ms", as: "ms" }] } as never);
      await settle();
      expect(totals()).toHaveLength(0);
      expect(grid.status.totals).toBe("failed");
      expired();
      grid.update({ totals: null } as never);
      await settle();
      expect(grid.status.totals).toBeNull();
      expired();
      // A retry refreshes: a new snapshot's rows and totals.
      grid.update({ totals: TOTALS } as never);
      grid.retry();
      for (let round = 0; round < 4; round++) {
        await settle();
        for (const one of [...rows(), ...totals()]) one.answer();
      }
      await settle();
      expect(grid.status).toMatchObject({ error: null, failed: 0, totals: "loaded" });
      expect(texts(grid)).toEqual(["Total", "4.5", "300"]);
      grid.dispose();
    });

  /**
   * A remote grid whose source logs what it is asked, and whether the grid
   * had ended the revision asked of (`current` is the test's count of
   * them) or found its snapshot expired when it asked. Rows after a
   * query's first window, and totals, wait to be failed by hand; first
   * windows after the first query's, to be answered by hand (`firsts`).
   */
  function logged() {
    const { memory } = remote();
    const state = { current: 1, disposed: false };
    const asked: { what: string; revision: number; stale: boolean }[] = [];
    const rows: ((error: Error) => void)[] = [];
    const firsts: (() => void)[] = [];
    let grid!: RemoteGridModel;
    const log = (what: string, revision: number) =>
      asked.push({
        what,
        revision,
        stale:
          state.disposed ||
          revision !== state.current ||
          (grid.status.error as GridSourceError | null)?.code === "snapshot-expired",
      });
    const source: GridSource = {
      schema: memory.schema,
      rows: (request, signal) => {
        log("rows", request.revision);
        if (request.snapshot === null) {
          const answer = memory.rows(request, signal);
          if (request.revision === 1) return answer;
          // Aborted unanswered, when the grid moved on first.
          answer.catch(() => {});
          return new Promise((resolve) => firsts.push(() => resolve(answer)));
        }
        return new Promise((_, reject) => rows.push(reject));
      },
      totals: (request) => {
        log("totals", request.revision);
        return new Promise(() => {});
      },
      locate: (request, signal) => {
        log("locate", request.revision);
        return memory.locate!(request, signal);
      },
    };
    grid = createRemoteGridModel({
      source,
      totals: TOTALS,
      columns: [
        { field: "host" },
        { field: "ms", aggregate: "ms" },
        { field: "id", aggregate: "n" },
      ],
      blockSize: 32,
      settleDelay: 0,
      locale: "en-US",
    } as never);
    grid.setViewport(600, 300);
    const microtasks = async (count: number) => {
      for (let k = 0; k < count; k++) await Promise.resolve();
    };
    return { grid, state, asked, rows, firsts, microtasks };
  }

  it("asks nothing of a snapshot it found expired, however soon after the ask was queued", async () => {
    for (let soon = 0; soon < 6; soon++) {
      const { grid, asked, rows, microtasks } = logged();
      await settle();
      expect(rows.length).toBeGreaterThan(0);
      rows[0]!(new GridSourceError("snapshot-expired", "The snapshot expired"));
      await microtasks(soon);
      // Other totals and other rows, asked about when the expiry arrives.
      grid.update({ totals: [{ op: "max", field: "ms", as: "ms" }] } as never);
      grid.scrollTo({ top: grid.rowHeight * 200 });
      await settle();
      expect(asked.filter(({ stale }) => stale)).toEqual([]);
      expect(grid.status).toMatchObject({ totals: "failed" });
      expect((grid.status.error as GridSourceError).code).toBe("snapshot-expired");
      grid.dispose();
    }
  });

  it("asks nothing for a revision it ended or a grid it disposed, however soon after the ask was queued", async () => {
    let located = 0;
    for (let soon = 0; soon < 8; soon++) {
      const { grid, state, asked, firsts, microtasks } = logged();
      await settle();
      // Rows and totals queued, then a refresh: none of them asked of the old snapshot.
      grid.focusCell(3, "ms");
      grid.scrollTo({ top: grid.rowHeight * 200 });
      grid.update({ totals: [{ op: "max", field: "ms", as: "ms" }] } as never);
      await microtasks(soon);
      grid.refresh();
      state.current = 2;
      // The refresh's first window queues the focus's locate; another refresh ends it.
      await settle();
      firsts.shift()!();
      await microtasks(soon);
      grid.refresh();
      state.current = 3;
      await microtasks(soon);
      grid.update({ totals: TOTALS } as never);
      grid.dispose();
      state.disposed = true;
      await settle();
      expect(asked.filter(({ stale }) => stale)).toEqual([]);
      located += asked.filter(({ what }) => what === "locate").length;
    }
    // The focus's record was looked for where the refresh came late enough.
    expect(located).toBeGreaterThan(0);
  });

  it("lets go of an expired snapshot's failure as a refresh or dispose ends it", async () => {
    const { grid, rows, firsts } = logged();
    await settle();
    rows[0]!(new GridSourceError("snapshot-expired", "The snapshot expired"));
    await settle();
    expect(grid.status.error).not.toBeNull();
    // Its totals still pending: the new revision has no failure of the old one.
    grid.refresh();
    expect(grid.status.error).toBeNull();
    await settle();
    firsts.shift()!();
    await settle();
    rows.shift()!(new GridSourceError("snapshot-expired", "The snapshot expired"));
    for (const reject of rows.splice(0)) reject(new GridSourceError("unavailable", "late"));
    await settle();
    expect(grid.status.error).not.toBeNull();
    grid.dispose();
    expect(grid.status).toMatchObject({ error: null, failed: 0, totals: null });
  });

  it("gives back the rows' failure when a totals failure after it goes with its totals", async () => {
    const { grid, rows, totals } = held();
    await settle();
    grid.scrollTo({ top: grid.rowHeight * 200 });
    await settle();
    rows()[0]!.fail("unavailable");
    await settle();
    const failure = grid.status.error;
    expect(failure?.message).toBe("The source said unavailable");
    totals()[0]!.fail("unavailable");
    await settle();
    expect(grid.status.error).not.toBe(failure);
    grid.update({ totals: null } as never);
    expect(grid.status).toMatchObject({ error: failure, failed: 1, totals: null });
    grid.retry();
    for (let round = 0; round < 4; round++) {
      await settle();
      for (const one of rows()) one.answer();
    }
    expect(grid.status).toMatchObject({ error: null, failed: 0 });
    grid.dispose();
  });

  it("checks the totals row's looks as they are given, not as answers come", async () => {
    const { memory } = remote();
    const grid = createRemoteGridModel({
      source: memory,
      totals: [{ op: "mean", field: "ms", as: "ms" }],
      scales: { heat: { type: "linear", domain: [0, 10], range: ["#ffffff", "#ff0000"] } },
      columns: [
        { field: "host" },
        { field: "ms", aggregate: "ms", aggregateEncode: { fill: { field: "ms", scale: "heat" } } },
      ],
      locale: "en-US",
    } as never);
    grid.setViewport(600, 300);
    await settle();
    expect(grid.totalsRow!.cellAt(1).look).toBeDefined();
    expect(() => grid.update({ scales: undefined })).toThrow(/heat/);
    expect(grid.totalsRow!.cellAt(1).look).toBeDefined();
    grid.dispose();
  });

  it("holds its own copy of the totals answered", async () => {
    const { source } = remote({ now: true });
    const answered: TotalsAnswer[] = [];
    const sharing: GridSource = {
      ...source,
      totals: async (request, signal) => {
        const answer = await source.totals!(request, signal);
        answered.push(answer);
        return answer;
      },
    };
    const grid = model(sharing);
    await settle();
    expect(texts(grid)).toEqual(["Total", "4.5", "300"]);
    answered[0]!.columns.ms![0] = 99;
    grid.update({ encode: undefined });
    expect(texts(grid)).toEqual(["Total", "4.5", "300"]);
    grid.dispose();
  });

  it("keeps its totals through other updates while their array changes", async () => {
    const { source, asked } = remote();
    const totals: { op: string; field?: string; as: string }[] = [...TOTALS];
    const grid = model(source, totals);
    await settle();
    expect(asked).toHaveLength(1);
    totals[1] = { op: "max", field: "ms", as: "ms" };
    grid.update({ encode: undefined });
    await settle();
    expect(asked).toHaveLength(1);
    expect(grid.totalsRow!.cellAt(1)).toMatchObject({ state: "loading" });
    await asked[0]!.answer();
    await settle();
    expect(texts(grid)).toEqual(["Total", "4.5", "300"]);
    grid.dispose();
  });

  it("asks again for totals changed in their own array, not for an equal one", async () => {
    const { source, asked } = remote({ now: false });
    const totals: { op: string; field?: string; as: string }[] = [
      { op: "count", as: "n" },
      { op: "mean", field: "ms", as: "ms" },
    ];
    const grid = model(source, totals);
    await settle();
    expect(asked).toHaveLength(1);
    grid.update({ totals: [...totals] } as never);
    await settle();
    expect(asked).toHaveLength(1);
    totals[1] = { op: "max", field: "ms", as: "ms" };
    grid.update({ totals } as never);
    await settle();
    expect(asked).toHaveLength(2);
    await asked[1]!.answer();
    await settle();
    expect(texts(grid)).toEqual(["Total", "9", "300"]);
    grid.dispose();
  });

  it("refuses totals the source cannot answer, of categories, or named for another group aggregate", () => {
    const { memory } = remote();
    const rowsOnly: GridSource = { schema: memory.schema, rows: (r, s) => memory.rows(r, s) };
    expect(() => model(rowsOnly)).toThrow(
      "remote grid totals: the source answers no totals; give the source totals(request, signal), or drop totals",
    );
    expect(() => model(memory, [{ op: "mean", field: "host", as: "x" }])).toThrow(
      'remote grid totals: Aggregate "x" needs a number or time field, not "host"',
    );
    expect(() => model(memory, { op: "count", as: "n" })).toThrow(
      'remote grid totals: expected aggregates such as [{ op: "count", as: "n" }], or null for no totals row; received {"op":"count","as":"n"}',
    );
    expect(() => model(memory, [{ op: "sum", field: ["ms"], as: "x" }])).toThrow(
      'remote grid totals: Aggregate "x" needs a number or time field, not ["ms"]',
    );
    expect(() =>
      model(memory, null).setQuery({
        group: { by: ["host"], aggregate: [{ op: "sum", field: ["ms"] as never, as: "x" }] },
      }),
    ).toThrow('Aggregate "x" needs a number or time field, not ["ms"]');
    expect(() => model(memory, [])).toThrow(
      'remote grid totals: expected aggregates such as [{ op: "count", as: "n" }], or null for no totals row; received []',
    );
    const grid = model(memory);
    expect(() =>
      grid.setQuery({
        group: { by: ["host"], aggregate: [{ op: "max", field: "ms", as: "ms" }] },
      }),
    ).toThrow(
      'remote grid totals: "ms" is mean(ms) in the totals and max(ms) in the query\'s groups; make them one operation of one field',
    );
    grid.dispose();
  });

  it("keeps the focus on the totals row across queries", async () => {
    const { source } = remote({ now: true });
    const grid = model(source);
    await settle();
    grid.focusCell(grid.rowCount, "ms");
    grid.setQuery({ filter: ["==", ["field", "host"], "db"] });
    await settle();
    expect(grid.focus).toMatchObject({ rowIndex: grid.rowCount, column: "ms" });
    expect(grid.rowCount).toBe(100);
    grid.dispose();
  });
});

describe("columns' headings", () => {
  const t = () => table({ a: [1], b: [2], c: [3] });

  it("take a title, an id and a title, or a list of them from the top, and name columns with them", () => {
    const model = createGridModel({
      data: rowView(t()),
      columns: [
        { field: "a", heading: "Latency" },
        { field: "b", heading: ["Traffic", { id: "in", title: "In" }] },
        { field: "c", title: "Count" },
      ],
    });
    expect(model.columnLayout.map(({ headings }) => headings)).toEqual([
      [{ id: "Latency", title: "Latency" }],
      [
        { id: "Traffic", title: "Traffic" },
        { id: "in", title: "In" },
      ],
      [],
    ]);
    expect(model.columnTitle("b")).toBe("Traffic, In, b");
    expect(model.columnTitle("c")).toBe("Count");
  });

  it("refuse other forms, and an id titled two ways at one level, hidden columns' too", () => {
    const make = (columns: object[]) => () =>
      createGridModel({ data: rowView(t()), columns } as never);
    expect(make([{ field: "a", heading: 1 }])).toThrow(
      "grid columns[0].heading: expected a title or { id, title }; received 1",
    );
    expect(make([{ field: "a", heading: ["x", { id: "y" }] }])).toThrow(
      'grid columns[0].heading[1]: expected a title or { id, title }; received {"id":"y"}',
    );
    expect(
      make([
        { field: "a", heading: { id: "g", title: "Group" } },
        { field: "b", hidden: true, heading: [{ id: "g", title: "Other" }] },
      ]),
    ).toThrow(
      'grid columns[1].heading[0]: "g" is titled "Other" here and "Group" in columns[0]; give one title',
    );
    // At another level, the same id is another heading.
    expect(
      make([
        { field: "a", heading: { id: "g", title: "Group" } },
        { field: "b", heading: ["x", { id: "g", title: "Other" }] },
      ]),
    ).not.toThrow();
  });
});
