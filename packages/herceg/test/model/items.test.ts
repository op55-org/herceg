import { describe, expect, it } from "vitest";
import { rowView } from "../../src/data/row-view.ts";
import { Table } from "../../src/data/table.ts";
import { bar } from "../../src/marks/bar.ts";
import { errorbar } from "../../src/marks/errorbar.ts";
import { line } from "../../src/marks/line.ts";
import { keyOwner, type Mark, seriesKey } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { rule } from "../../src/marks/rule.ts";
import type { Series } from "../../src/marks/series.ts";
import { itemResolver } from "../../src/model/items.ts";

const series = (mark: string | number, source: string) =>
  ({ key: seriesKey(mark, source) }) as Series;

/** A key's parts, its table's token (a number per table object) matched by any number. */
const parsed = (key: string) => JSON.parse(key) as unknown[];
const identityKey = (...before: unknown[]) => [...before, "row", expect.any(Number)];

function metrics() {
  return new Table({ t: [1, 2, 3], auth: [5, 6, 7], api: [1, 2, 3], host: ["a", "b", "a"] });
}

describe("item keys", () => {
  it("name a row by its itemKey value across appends, drops, resets, and a replaced table", () => {
    const rows = new Table({ t: [1, 2, 3], v: [4, 5, 6], id: ["x", "y", "z"] }, { maxRows: 3 });
    const mark = point(rows, { id: "dots", x: "t", y: "v", itemKey: "id" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: "dots" }]);
    const key = items.keyOfRow("dots", { table: rows, position: 1 });
    expect(key).toBe('["dots","y"]');
    expect(keyOwner(key)).toBe("dots");
    rows.append({ t: [4], v: [7], id: ["w"] });
    expect(items.keyOfRow("dots", { table: rows, position: 0 })).toBe(key);
    rows.reset({ t: [9, 8], v: [1, 2], id: ["q", "y"] });
    expect(items.keyOfRow("dots", { table: rows, position: 1 })).toBe(key);
    expect(Array.from(items.rowsOf(key, rows))).toEqual([1]);
    // Another table of the same fields, in its place.
    const replaced = new Table({ t: [0], v: [0], id: ["y"] });
    const again = point(replaced, { id: "dots", x: "t", y: "v", itemKey: "id" }) as unknown as Mark;
    expect(
      itemResolver([{ mark: again, key: "dots" }]).keyOfRow("dots", {
        table: replaced,
        position: 0,
      }),
    ).toBe(key);
  });

  it("keep names of numbers and of categories apart, as keys do", () => {
    const numbers = new Table({ t: [1, 2], v: [4, 5], id: [1, 2] });
    const names = new Table({ t: [1, 2], v: [4, 5], id: ["1", "2"] });
    const keys = (rows: Table) => {
      const mark = point(rows, { id: "dots", x: "t", y: "v", itemKey: "id" }) as unknown as Mark;
      return itemResolver([{ mark, key: "dots" }]);
    };
    expect(keys(numbers).keyOfRow("dots", { table: numbers, position: 0 })).toBe('["dots",1]');
    expect(keys(names).keyOfRow("dots", { table: names, position: 0 })).toBe('["dots","1"]');
    // A number's key names no category's row, and a category's no number's.
    expect(keys(names).rowsOf('["dots",1]', names)).toHaveLength(0);
    expect(keys(numbers).rowsOf('["dots","1"]', numbers)).toHaveLength(0);
    expect(Array.from(keys(names).rowsOf('["dots","1"]', names))).toEqual([0]);
    // Bars by position name their series' value as the series field holds it.
    const split = new Table({ x: ["p", "q"], v: [4, 5], g: ["1", "2"] });
    const bars = bar(split, { id: "b", x: "x", y: "v", series: "g" }) as unknown as Mark;
    const items = itemResolver([{ mark: bars, key: "b" }]);
    const key = items.keyOfRow("b", { table: split, position: 0, series: series("b", "1") });
    expect(key).toBe('["b","1","p"]');
    expect(Array.from(items.rowsOf(key, split))).toEqual([0]);
    expect(items.rowsOf('["b",1,"p"]', split)).toHaveLength(0);
  });

  it("name a row without itemKey by its identity, through drops but not a reset", () => {
    const rows = new Table({ t: [1, 2, 3], v: [4, 5, 6] }, { maxRows: 3 });
    const mark = point(rows, { x: "t", y: "v" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: 0 }]);
    const key = items.keyOfRow(0, { table: rows, position: 2 });
    expect(parsed(key)).toEqual([...identityKey(0), 0, 2]);
    rows.append({ t: [4], v: [7] });
    expect(items.keyOfRow(0, { table: rows, position: 1 })).toBe(key);
    expect(Array.from(items.rowsOf(key, rows))).toEqual([1]);
    rows.append({ t: [5, 6], v: [8, 9] });
    // Dropped since: no rows.
    expect(items.rowsOf(key, rows)).toHaveLength(0);
    rows.reset({ t: [1, 2, 3], v: [4, 5, 6] });
    expect(items.keyOfRow(0, { table: rows, position: 2 })).not.toBe(key);
  });

  it("never name a row of another table by a row's identity", () => {
    const rows = new Table({ t: [1, 2, 3], v: [4, 5, 6] });
    const mark = point(rows, { id: "dots", x: "t", y: "v" }) as unknown as Mark;
    const key = itemResolver([{ mark, key: "dots" }]).keyOfRow("dots", {
      table: rows,
      position: 0,
    });
    // Another table of the same rows in its place, at the same generation.
    const replaced = new Table({ t: [1, 2, 3], v: [4, 5, 6] });
    const again = point(replaced, { id: "dots", x: "t", y: "v" }) as unknown as Mark;
    const items = itemResolver([{ mark: again, key: "dots" }]);
    expect(items.rowsOf(key, replaced)).toHaveLength(0);
    expect(items.keyOfRow("dots", { table: replaced, position: 0 })).not.toBe(key);
    expect(
      Array.from(items.rowsOf(items.keyOfRow("dots", { table: replaced, position: 0 }), replaced)),
    ).toEqual([0]);
  });

  it("find only rows the mark draws, of a view", () => {
    const rows = new Table({ t: [1, 2, 3], v: [4, 5, 6], id: ["a", "b", "a"] });
    const shown = rowView(rows, { filter: ["<", ["field", "t"], 3] });
    const mark = point(shown, { x: "t", y: "v", itemKey: "id" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: 0 }]);
    expect(Array.from(items.rowsOf('[0,"a"]', rows))).toEqual([0]);
    const hidden = itemResolver([
      { mark: point(rows, { x: "t", y: "v" }) as unknown as Mark, key: 1 },
    ]);
    const third = parsed(hidden.keyOfRow(1, { table: rows, position: 2 }));
    expect(items.rowsOf(JSON.stringify([0, ...third.slice(1)]), rows)).toHaveLength(0);
  });

  it("name a range mark's row once, though two fields bound it", () => {
    const rows = new Table({ t: [1, 2], low: [1, 2], high: [3, 4], id: ["a", "b"] });
    const mark = errorbar(rows, { id: "ranges", x: "t", y1: "low", y2: "high", itemKey: "id" });
    const items = itemResolver([{ mark: mark as unknown as Mark, key: "ranges" }]);
    const key = items.keyOfRow("ranges", {
      table: rows,
      position: 0,
      series: series("ranges", "high"),
    });
    expect(key).toBe('["ranges","a"]');
    expect(items.keyOfReference({ mark: "ranges", item: ["a"] })).toBe(key);
    expect(Array.from(items.rowsOf(key, rows))).toEqual([0]);
  });

  it("fall back to the row's identity where the name is missing", () => {
    const rows = new Table({ t: [1, 2], v: [3, 4], id: [7, Number.NaN] });
    const mark = point(rows, { x: "t", y: "v", itemKey: "id" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: 0 }]);
    expect(items.keyOfRow(0, { table: rows, position: 0 })).toBe("[0,7]");
    expect(parsed(items.keyOfRow(0, { table: rows, position: 1 }))).toEqual([
      ...identityKey(0),
      0,
      1,
    ]);
  });

  it("let a row's identity key go once the row has a name", () => {
    const rows = new Table({ t: [1, 2], v: [3, 4], id: [Number.NaN, 7] });
    const mark = point(rows, { x: "t", y: "v", itemKey: "id" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: "dots" }]);
    const fallback = items.keyOfRow("dots", { table: rows, position: 0 });
    expect(Array.from(items.rowsOf(fallback, rows))).toEqual([0]);
    // Named 7, as row 1 is: one item of both, which the old key no longer names.
    rows.replace("id", 0, [7]);
    expect(items.keyOfRow("dots", { table: rows, position: 0 })).toBe('["dots",7]');
    expect(Array.from(items.rowsOf(fallback, rows))).toEqual([]);
    expect(Array.from(items.rowsOf('["dots",7]', rows))).toEqual([0, 1]);
    // A bar named by its position, once its position is there.
    const bars = new Table({ c: [null, "b"], v: [1, 2] });
    const bare = bar(bars, { x: "c", y: "v" }) as unknown as Mark;
    const byPosition = itemResolver([{ mark: bare, key: "bars" }]);
    const unnamed = byPosition.keyOfRow("bars", {
      table: bars,
      position: 0,
      series: series("bars", "v"),
    });
    expect(Array.from(byPosition.rowsOf(unnamed, bars))).toEqual([0]);
    bars.replace("c", 0, ["b"]);
    expect(Array.from(byPosition.rowsOf(unnamed, bars))).toEqual([]);
  });

  it("name each item of a wide row by its value field", () => {
    const rows = metrics();
    const mark = line(rows, {
      id: "lines",
      x: "t",
      y: ["auth", "api"],
      itemKey: "t",
    }) as unknown as Mark;
    const items = itemResolver([{ mark, key: "lines" }]);
    const auth = items.keyOfRow("lines", {
      table: rows,
      position: 0,
      series: series("lines", "auth"),
    });
    const api = items.keyOfRow("lines", {
      table: rows,
      position: 0,
      series: series("lines", "api"),
    });
    expect([auth, api]).toEqual(['["lines","auth",1]', '["lines","api",1]']);
    // Without itemKey, the identity follows the value field.
    const bare = line(rows, { x: "t", y: ["auth", "api"] }) as unknown as Mark;
    const named = itemResolver([{ mark: bare, key: 1 }]).keyOfRow(1, {
      table: rows,
      position: 2,
      series: series(1, "api"),
    });
    expect(parsed(named)).toEqual([...identityKey(1, "api"), 0, 2]);
    expect(Array.from(itemResolver([{ mark: bare, key: 1 }]).rowsOf(named, rows))).toEqual([2]);
    // A field the mark no longer draws has no items.
    const fewer = line(rows, {
      id: "lines",
      x: "t",
      y: ["auth", "t"],
      itemKey: "t",
    }) as unknown as Mark;
    expect(itemResolver([{ mark: fewer, key: "lines" }]).rowsOf(api, rows)).toHaveLength(0);
  });

  it("name a row of a series field by its name alone, which says its series", () => {
    const rows = metrics();
    const mark = line(rows, { x: "t", y: "auth", series: "host", itemKey: "t" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: 0 }]);
    expect(items.keyOfRow(0, { table: rows, position: 1, series: series(0, "b") })).toBe("[0,2]");
  });

  it("treat rows sharing a name as one item", () => {
    const rows = metrics();
    const mark = point(rows, { x: "t", y: "auth", itemKey: "host" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: 0 }]);
    const a = items.keyOfRow(0, { table: rows, position: 0 });
    expect(items.keyOfRow(0, { table: rows, position: 2 })).toBe(a);
    expect(Array.from(items.rowsOf(a, rows))).toEqual([0, 2]);
    expect(items.rowsOf('[0,"zz"]', rows)).toHaveLength(0);
  });

  it("name bars without itemKey by their series and position, across a reset", () => {
    const rows = new Table({ region: ["N", "S"], sales: [1, 2], cost: [3, 4] });
    const mark = bar(rows, { id: "bars", x: "region", y: ["sales", "cost"] }) as unknown as Mark;
    const items = itemResolver([{ mark, key: "bars" }]);
    const key = items.keyOfRow("bars", {
      table: rows,
      position: 1,
      series: series("bars", "cost"),
    });
    expect(key).toBe('["bars","cost","S"]');
    rows.reset({ region: ["S", "N"], sales: [5, 6], cost: [7, 8] });
    expect(
      items.keyOfRow("bars", { table: rows, position: 0, series: series("bars", "cost") }),
    ).toBe(key);
    expect(Array.from(items.rowsOf(key, rows))).toEqual([0]);
    // Bars of a series field: its value is the series part.
    const long = new Table({ region: ["N", "N", "S"], kind: ["a", "b", "a"], v: [1, 2, 3] });
    const stacked = bar(long, { x: "region", y: "v", series: "kind" }) as unknown as Mark;
    const named = itemResolver([{ mark: stacked, key: 0 }]);
    const b = named.keyOfRow(0, { table: long, position: 1, series: series(0, "b") });
    expect(b).toBe('[0,"b","N"]');
    expect(Array.from(named.rowsOf(b, long))).toEqual([1]);
    // A value field the mark no longer draws names none; one it draws, alone now, its rows.
    const single = itemResolver([
      { mark: bar(rows, { id: "bars", x: "region", y: "sales" }) as unknown as Mark, key: "bars" },
    ]);
    const sales = single.keyOfRow("bars", {
      table: rows,
      position: 0,
      series: series("bars", "sales"),
    });
    expect(sales).toBe('["bars","sales","S"]');
    const redrawn = (y: string | string[]) =>
      itemResolver([
        { mark: bar(rows, { id: "bars", x: "region", y }) as unknown as Mark, key: "bars" },
      ]);
    expect(redrawn("cost").rowsOf(sales, rows)).toHaveLength(0);
    expect(Array.from(redrawn("cost").rowsOf('["bars","cost","S"]', rows))).toEqual([0]);
  });

  it("name annotation rows, which have no series", () => {
    const rows = new Table({ at: [1, 2], name: ["launch", "fix"] });
    const mark = rule(rows, { x: "at", itemKey: "name" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: 0 }]);
    expect(items.keyOfRow(0, { table: rows, position: 1 })).toBe('[0,"fix"]');
  });

  it("name aggregates by their parts and names, and references by the mark's id", () => {
    const rows = metrics();
    const mark = point(rows, { id: "dots", x: "t", y: "auth" }) as unknown as Mark;
    const items = itemResolver([{ mark, key: "dots" }]);
    expect(items.keyOfGroup("dots", ["auth"], [[0, 10]])).toBe('["dots","auth",[0,10]]');
    expect(items.keyOfReference({ mark: "dots", item: ["b"] })).toBe('["dots","b"]');
    expect(items.keyOfReference({ mark: "lines", item: ["b"] })).toBeUndefined();
    // Groups name rows through their marks' groupsOf: none without it.
    expect(items.rowsOf('["dots","auth",[0,10]]', rows)).toHaveLength(0);
    const binned = Object.assign(Object.create(mark) as unknown as Mark, {
      rows: () => mark.rows!(),
      groupsOf: (key: string) =>
        key === '["dots",[1,3]]'
          ? [
              { field: "t", from: 1, to: 3 },
              { field: "host", value: "a" },
            ]
          : undefined,
    });
    const grouped = itemResolver([{ mark: binned, key: "dots" }]);
    expect(Array.from(grouped.rowsOf('["dots",[1,3]]', rows))).toEqual([0]);
    // Names that look like a row's identity are the groups' they name.
    const tree = Object.assign(Object.create(mark) as unknown as Mark, {
      rows: () => mark.rows!(),
      groupsOf: (key: string) =>
        key === '["dots","row","b","c","d"]' ? [{ field: "host", value: "b" }] : undefined,
    });
    expect(
      Array.from(
        itemResolver([{ mark: tree, key: "dots" }]).rowsOf('["dots","row","b","c","d"]', rows),
      ),
    ).toEqual([1]);
    expect(() => items.keyOfRow("lines", { table: rows, position: 0 })).toThrow(
      'item key: no mark "lines" in the chart',
    );
  });
});
