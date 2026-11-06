// A view's totals: one row of groups' aggregates over every row the view
// shows, kept current as the table streams, drops, and changes.
import { describe, expect, it } from "vitest";
import { count, max, mean, min, sum } from "../../src/data/aggregations.ts";
import { time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { type RowView, rowView } from "../../src/data/row-view.ts";
import { type Schema, type Table, table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";

const OPS = {
  n: count(),
  finite: count("ms"),
  total: sum("ms"),
  avg: mean("ms"),
  low: min("ms"),
  high: max("ms"),
};

/** A one-row table's row, missing values as null. */
const row = <S extends Schema>(t: Table<S>) =>
  Object.fromEntries(t.fields().map((field) => [field, t.value(field, 0)]));

/** Requests with missing and infinite latencies. */
const requests = (options?: { maxRows?: number }) =>
  table(
    {
      host: ["web", "api", "web", "db", "api", "db", "web", "api"],
      ms: [10, 20, Number.NaN, 5, Number.POSITIVE_INFINITY, 7.5, -2, 0.1],
      at: time([5, 1, 4, 2, 8, 3, 7, 6]),
    },
    options,
  );

/** The totals of `view` computed from scratch now, to compare a following one with. */
const fresh = <S extends Schema>(view: RowView<S>) => {
  const totals = rowTotals(view as unknown as RowView, { ops: OPS });
  const values = row(totals.table);
  totals.dispose();
  return values;
};

/** `actual` as `expected`, sums and means to within rounding. */
const same = (actual: Record<string, unknown>, expected: Record<string, unknown>) => {
  for (const [field, value] of Object.entries(expected)) {
    const got = actual[field];
    if (typeof value === "number" && typeof got === "number" && Number.isFinite(value))
      expect(got, field).toBeCloseTo(value, 9);
    else expect(got, field).toEqual(value);
  }
};

describe("row totals", () => {
  it("aggregate every row the view shows as groups aggregate a group's", () => {
    const t = requests();
    const view = rowView(t);
    const totals = rowTotals(view, { ops: OPS });
    expect(row(totals.table)).toEqual({
      n: 8,
      finite: 6,
      total: 40.6,
      avg: 40.6 / 6,
      low: -2,
      high: 20,
    });
    // One group of everything agrees with the totals.
    const all = groupRows(rowView(table({ g: Array(8).fill("x"), ms: t.numbers("ms") })), {
      by: ["g"],
      ops: {
        n: count(),
        finite: count("ms"),
        total: sum("ms"),
        avg: mean("ms"),
        low: min("ms"),
        high: max("ms"),
      },
    });
    const { g: _, ...grouped } = Object.fromEntries(
      all.table.fields().map((field) => [field, all.table.value(field as never, 0)]),
    );
    expect(row(totals.table)).toEqual(grouped);
  });

  it("are 0 for counts and sums, and missing for the rest, over no rows", () => {
    const empty = rowTotals(rowView(requests(), { filter: false }), { ops: OPS });
    expect(row(empty.table)).toEqual({
      n: 0,
      finite: 0,
      total: 0,
      avg: null,
      low: null,
      high: null,
    });
    const none = rowTotals(rowView(table({ ms: [] as number[] })), {
      ops: { n: count(), s: sum("ms") },
    });
    expect(row(none.table)).toEqual({ n: 0, s: 0 });
  });

  it("give times as times for means and extremes of times, numbers for counts and sums", () => {
    const totals = rowTotals(rowView(requests()), {
      ops: { first: min("at"), n: count("at"), avg: mean("at"), total: sum("at") },
    });
    expect(totals.table.fields().map((f) => totals.table.kind(f as never))).toEqual([
      "time",
      "number",
      "time",
      "number",
    ]);
    expect(row(totals.table)).toEqual({ first: 1, n: 8, avg: 4.5, total: 36 });
  });

  it("read the rows a view shows: filtered, restricted, or sorted", () => {
    const t = requests();
    same(row(rowTotals(rowView(t, { filter: col("ms").lt(15) }), { ops: OPS }).table), {
      n: 5,
      finite: 5,
      total: 20.6,
      low: -2,
      high: 10,
    });
    const restricted = new RowSet(t);
    restricted.addAll([0, 1]);
    const view = rowView(t, { sort: [{ field: "ms", order: "descending" }] });
    view.restrict(restricted);
    expect(row(rowTotals(view, { ops: OPS }).table)).toMatchObject({ n: 2, total: 30 });
  });

  it("refuse what groups refuse, located", () => {
    const view = rowView(requests());
    const make = (ops: unknown) => () => rowTotals(view, { ops } as never);
    expect(make({ s: sum("host" as never) })).toThrow(
      'rowTotals ops.s: field "host" is a category, not numbers',
    );
    expect(make({ s: { op: "sum" } })).toThrow("rowTotals ops.s: sum needs a field");
    expect(make({ s: { op: "median", field: "ms" } })).toThrow(
      'rowTotals ops.s: no operation "median"',
    );
    expect(make({ s: sum("nope" as never) })).toThrow('rowTotals ops.s: unknown field "nope"');
    expect(() => rowTotals(view, undefined as never)).toThrow(
      "rowTotals options: expected { ops }",
    );
    expect(make({})).toThrow("rowTotals ops: expected at least one aggregate");
  });
});

describe("row totals following their view", () => {
  it("add appended rows, as one change of their table", () => {
    const t = requests();
    const view = rowView(t);
    const totals = rowTotals(view, { ops: OPS });
    const changes: unknown[] = [];
    totals.table.subscribe((change) => changes.push(change));
    let told = 0;
    totals.subscribe(() => told++);
    t.append({ host: ["web", "db"], ms: [30, -5], at: [9, 10] });
    same(row(totals.table), fresh(view));
    expect(row(totals.table)).toMatchObject({ n: 10, finite: 8, low: -5, high: 30 });
    expect(changes).toHaveLength(1);
    expect(told).toBe(1);
    // Rows the filter leaves out are not added.
    const filtered = rowView(t, { filter: col("host").eq("web") });
    const web = rowTotals(filtered, { ops: OPS });
    t.append({ host: ["api", "web"], ms: [100, 1], at: [11, 12] });
    same(row(web.table), fresh(filtered));
    same(row(totals.table), fresh(view));
  });

  it("take away rows a rolling window drops, and compute again an extreme that leaves", () => {
    const t = requests({ maxRows: 8 });
    const views = [
      rowView(t),
      rowView(t, { filter: col("ms").gt(0) }),
      rowView(t, { sort: [{ field: "ms" }] }),
      rowView(t, {
        filter: col("host").isIn("web", "db"),
        sort: [{ field: "at", order: "descending" }],
      }),
    ];
    const totals = views.map((view) => rowTotals(view, { ops: OPS }));
    // The first row (10 ms, web's maximum) leaves; then rising values push every old row out.
    for (let step = 0; step < 12; step++) {
      t.append({ host: [["web", "api", "db"][step % 3]!], ms: [step * 3 - 4], at: [20 + step] });
      totals.forEach((one, i) => {
        same(row(one.table), fresh(views[i]!));
      });
    }
    // A batch larger than the window drops every row there was, and some of its own.
    t.append({
      host: Array(10).fill("web"),
      ms: Array.from({ length: 10 }, (_, i) => i),
      at: Array(10).fill(50),
    });
    totals.forEach((one, i) => {
      same(row(one.table), fresh(views[i]!));
    });
    expect(row(totals[0]!.table)).toMatchObject({ n: 8, low: 2, high: 9 });
  });

  it("compute again when a value they or the filter read changes in place, or the query changes", () => {
    const t = requests();
    const view = rowView(t, { filter: col("host").eq("web") });
    const totals = rowTotals(view, { ops: OPS });
    t.set("ms", 0, 1000);
    same(row(totals.table), fresh(view));
    t.set("host", 1, "web");
    same(row(totals.table), fresh(view));
    view.setQuery({ filter: col("host").eq("api") });
    same(row(totals.table), fresh(view));
    const before = totals.revision;
    // A field neither reads changes nothing.
    t.set("at", 0, 99);
    expect(totals.revision).toBe(before);
    t.reset({ host: ["api"], ms: [3], at: [1] });
    expect(row(totals.table)).toMatchObject({ n: 1, total: 3 });
  });

  it("keep sums accurate as large values cancel", () => {
    const t = table({ ms: [1e16, 1, -1e16, 1] }, { maxRows: 4 });
    const view = rowView(t);
    const totals = rowTotals(view, { ops: { total: sum("ms"), avg: mean("ms") } });
    expect(row(totals.table)).toEqual({ total: 2, avg: 0.5 });
    // Each append drops the oldest row: 1e16 leaves, then 1, -1e16, 1.
    const sums = [
      [1e16, 2],
      [3, 4],
      [-1e16, 4],
      [0.5, 3.5],
    ] as const;
    for (const [value, total] of sums) {
      t.append({ ms: [value] });
      expect(totals.table.value("total", 0)).toBe(total);
    }
  });

  it("stop once disposed, keeping their last values, and keep only what drops need", () => {
    const t = requests();
    const totals = rowTotals(rowView(t), { ops: OPS });
    // A table that never dropped rows keeps nothing per row.
    const bytes = totals.byteLength;
    t.append({ host: Array(1000).fill("web"), ms: Array(1000).fill(1), at: Array(1000).fill(1) });
    expect(totals.byteLength).toBe(bytes);
    totals.dispose();
    t.append({ host: ["web"], ms: [1000], at: [1] });
    expect(totals.table.value("high", 0)).toBe(20);
    expect(totals.table.value("n", 0)).toBe(1008);
    const rolling = requests({ maxRows: 8 });
    const filtered = rowTotals(rowView(rolling, { filter: col("ms").gt(0) }), { ops: OPS });
    rolling.append({ host: ["web"], ms: [3], at: [1] });
    // 8 bytes a row of the field read, and a byte a row for which rows show, with room.
    expect(filtered.byteLength).toBeGreaterThanOrEqual(8 * 9 + 9);
  });
});
