import { describe, expect, it } from "vitest";
import { Table } from "../../src/data/table.ts";
import { GLYPHS, rowsNamed } from "../../src/dom/anchor-items.ts";
import { vertices } from "../../src/draw/symbol-shapes.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import type { Mark } from "../../src/marks/mark.ts";
import { point } from "../../src/marks/point.ts";
import { itemResolver } from "../../src/model/items.ts";
import { SYMBOLS } from "../../src/spec/symbols.ts";

/**
 * That anchors' scan of the rows from `from` on finds, for every key, what
 * the item resolver finds of all rows, from `from` on, all keys found together.
 */
function expectAsResolved(mark: Mark, table: Table, keys: readonly string[]) {
  const resolver = itemResolver([{ mark, key: (mark.spec.id ?? 0) as string }]);
  // Keys of rows, not only of none.
  expect(keys.filter((key) => resolver.rowsOf(key, table).length > 0).length).toBeGreaterThan(1);
  for (const from of [0, 1, table.length - 1, table.length]) {
    // All keys at once, as anchors find them.
    const found = rowsNamed(resolver, () => mark, keys, table, from);
    for (const key of keys) {
      const resolved = Array.from(resolver.rowsOf(key, table)).filter((row) => row >= from);
      expect(Array.from(found.get(key)!), `${key} from ${from}`).toEqual(resolved);
    }
  }
}

describe("anchors' glyphs", () => {
  it("are every symbol's box as its shape draws it, in SYMBOLS' order", () => {
    expect(GLYPHS.map(([name]) => name)).toEqual(SYMBOLS);
    for (const [name, ...box] of GLYPHS) {
      const v = name === "circle" ? [-1, -1, 1, 1] : vertices(name);
      const [xs, ys] = [v.filter((_, i) => i % 2 === 0), v.filter((_, i) => i % 2 === 1)];
      const drawn = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      for (let k = 0; k < 4; k++)
        expect(Math.abs(box[k]! - drawn[k]!), `${name} ${k}`).toBeLessThanOrEqual(0.0005);
    }
  });
});

describe("anchors' rows", () => {
  it("are those the resolver names, for item keys of categories and numbers", () => {
    const rows = new Table({ t: [1, 2, 3, 4], v: [4, 5, 6, 7], id: ["x", "y", "x", null] });
    const named = point(rows, { id: "dots", x: "t", y: "v", itemKey: "id" }) as unknown as Mark;
    const identity = itemResolver([{ mark: named, key: "dots" }]).keyOfRow("dots", {
      table: rows,
      position: 3,
    });
    expectAsResolved(named, rows, [
      '["dots","x"]',
      '["dots","y"]',
      '["dots","z"]',
      '["dots",1]',
      identity,
    ]);
    const byTime = point(rows, { id: "dots", x: "t", y: "v", itemKey: "t" }) as unknown as Mark;
    expectAsResolved(byTime, rows, ['["dots",3]', '["dots",1]', '["dots","3"]', '["dots",9]']);
  });

  it("are those the resolver names, for bars by position, in a series field or wide", () => {
    const split = new Table({ x: ["p", "q", "p"], v: [4, 5, 6], g: ["1", "2", "2"] });
    const bars = bar(split, { id: "b", x: "x", y: "v", series: "g" }) as unknown as Mark;
    expectAsResolved(bars, split, [
      '["b","1","p"]',
      '["b","2","p"]',
      '["b",1,"p"]',
      '["b","3","p"]',
    ]);
    const sales = new Table({ region: ["N", "S", "N"], sales: [1, 2, 3], cost: [4, 5, 6] });
    const wide = bar(sales, { id: "w", x: "region", y: ["sales", "cost"] }) as unknown as Mark;
    expectAsResolved(wide, sales, ['["w","sales","N"]', '["w","cost","S"]', '["w","profit","N"]']);
  });

  it("are those the resolver names, for a wide line's items keyed by a field", () => {
    const rows = new Table({ t: [1, 2, 3], auth: [5, 6, 7], api: [1, 2, 3] });
    const lines = line(rows, {
      id: "lines",
      x: "t",
      y: ["auth", "api"],
      itemKey: "t",
    }) as unknown as Mark;
    expectAsResolved(lines, rows, [
      '["lines","auth",2]',
      '["lines","api",3]',
      '["lines","host",2]',
    ]);
  });
});
