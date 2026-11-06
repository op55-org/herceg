// The index sparklines read their data through: buckets by key in x order,
// taken in through appends with room to grow, against the rows they should
// hold read off the table.

import { describe, expect, it } from "vitest";
import { category } from "../../src/data/column.ts";
import { type Table, table } from "../../src/data/table.ts";
import { SparklineIndex } from "../../src/grid/sparkline-index.ts";

const fields = { key: "service", category: true, x: "time", y: "latency", xDomain: undefined };

/** Each key's rows as the index should hold them: rows with a key and a finite x, stably by x. */
function expected(data: Table): Map<string, number[]> {
  const { codes, dictionary } = data.categories("service" as never);
  const x = data.numbers("time" as never);
  const out = new Map<string, number[]>();
  for (let i = 0; i < data.length; i++) {
    if (codes[i]! < 0 || !Number.isFinite(x[i]!)) continue;
    const label = dictionary[codes[i]!]!;
    if (!out.has(label)) out.set(label, []);
    out.get(label)!.push(i);
  }
  for (const rows of out.values()) rows.sort((a, b) => x[a]! - x[b]!);
  return out;
}

function held(index: SparklineIndex): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const [key, b] of index.keys) {
    const start = index.starts[b]!;
    out.set(String(key), Array.from(index.rows.subarray(start, start + index.counts[b]!)));
  }
  return out;
}

/** Tables are typed loosely here, as the index reads any table. */
const loose = (data: unknown) => data as Table;

const log = () =>
  loose(
    table({ service: category(["a", "b", "a", "c"]), time: [0, 1, 2, 3], latency: [1, 2, 3, 4] }),
  );

describe("SparklineIndex", () => {
  it("buckets rows by key in x order, leaving out rows without a key or x", () => {
    const data = loose(
      table({
        service: category(["a", null, "b", "a", "a"]),
        time: [5, 0, 1, Number.NaN, 2],
        latency: [1, 2, Number.NaN, 4, 5],
      }),
    );
    const index = new SparklineIndex(data, fields, undefined, data.length);
    expect(held(index)).toEqual(
      new Map([
        ["a", [4, 0]],
        ["b", [2]],
      ]),
    );
    expect([index.values[index.keys.get("a")!], index.values[index.keys.get("b")!]]).toEqual([
      2, 0,
    ]);
    // Every finite x widens the window, a row's key or not.
    expect(index.xDomain).toEqual([0, 5]);
  });

  it("take in appends as a fresh index reads them: every key growing, one key growing, keys new, rows out of order", () => {
    const data = log();
    const index = new SparklineIndex(data, fields, undefined, data.length);
    let time = 4;
    const check = () => {
      expect(index.grown).toBe(true);
      index.extend();
      expect(held(index)).toEqual(expected(data));
      const fresh = new SparklineIndex(data, fields, undefined, data.length);
      expect(Array.from(index.values.subarray(0, index.keys.size))).toEqual(
        Array.from(fresh.values.subarray(0, fresh.keys.size)),
      );
      expect(index.xDomain).toEqual(fresh.xDomain);
    };
    for (let tick = 0; tick < 60; tick++) {
      data.append({ service: ["a", "b", "c"], time: [time, time, time], latency: [1, 2, 3] });
      time++;
      check();
    }
    for (let tick = 0; tick < 300; tick++) {
      data.append({ service: ["b"], time: [time++], latency: [tick % 7 ? tick : Number.NaN] });
      check();
    }
    for (let k = 0; k < 40; k++) {
      data.append({ service: [`new${k}`, `new${k}`], time: [time, time + 1], latency: [k, k] });
      time += 2;
      check();
    }
    // Earlier x, ties, and missing x among appends.
    data.append({
      service: ["a", "a", "b", "c"],
      time: [1, 1, Number.NaN, time],
      latency: [9, 8, 7, 6],
    });
    check();
    // Rows kept to about 1.4 times what the buckets hold, and room for each.
    expect(index.rows.length).toBeLessThanOrEqual(1.41 * data.length + 10 * index.keys.size);
  });

  it("give each key room of at least 8 rows once appended to", () => {
    const keys = Array.from({ length: 1000 }, (_, k) => `k${k}`);
    const data = loose(
      table({ service: category(keys), time: keys.map((_, k) => k), latency: keys.map(() => 1) }),
    );
    const index = new SparklineIndex(data, fields, undefined, data.length);
    expect(index.rows.length).toBe(1000);
    data.append({ service: ["k0"], time: [1000], latency: [1] });
    index.extend();
    expect(held(index)).toEqual(expected(data));
    // Room for 9 rows a key, and an eighth spare: 36 bytes a key over the 4 of its row.
    expect(index.rows.length).toBe(Math.floor(9 * 1000 * 1.125));
  });

  it("are not extended past a reset, a drop, a change in place, or a transaction's change in place", () => {
    const changes: ((data: Table) => void)[] = [
      (data) => data.reset({ service: category(["a"]), time: [0], latency: [1] }),
      (data) => data.dropFirst(1),
      (data) => data.set("latency" as never, 0, 5 as never),
    ];
    for (const change of changes) {
      const data = log();
      const index = new SparklineIndex(data, fields, undefined, data.length);
      change(data);
      expect(index.grown).toBe(false);
    }
    const data = log();
    let index: SparklineIndex | undefined;
    data.transaction(() => {
      data.set("latency" as never, 0, 5 as never);
      index = new SparklineIndex(data, fields, undefined, data.length);
      data.append({ service: ["a"], time: [9], latency: [1] });
    });
    expect(index!.grown).toBe(false);
  });
});
