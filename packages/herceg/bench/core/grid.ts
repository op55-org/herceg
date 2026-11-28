// Grids: looks over 100,000 and 1,000,000 rows, and a selection over a million rows.

import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectRows } from "../../src/data/selection.ts";
import { type Table, table } from "../../src/data/table.ts";
import { wholeTable } from "../../src/encoding/channel-scales.ts";
import { Rank } from "../../src/encoding/ranks.ts";
import { compileFields } from "../../src/fields.ts";
import { createGridModel } from "../../src/grid/model.ts";
import { measure } from "./shared.ts";

export async function run(): Promise<void> {
  // Grid looks over 100,000 and 1,000,000 rows: compiling a grid's looks (two
  // threshold fills through field displays, a gradient, a label's color, a
  // rank test, and a row condition), a screen of cells' looks read after a
  // rolling window moved (the rank and the gradient's domain brought up to
  // date first), and against the same grid without looks. Then the rank
  // alone: an append (only the rows appended are read) and an eviction of
  // one of the 100 (every row read again). Last, the heap a scale of
  // categories without a domain keeps as new categories stream through a
  // rolling window, against one with a domain.
  const lookTable = (rows: number) =>
    table({
      id: Float64Array.from({ length: rows }, (_, i) => i),
      tier: category(Array.from({ length: rows }, (_, i) => ["gold", "silver", "bronze"][i % 3]!)),
      a: Float64Array.from({ length: rows }, (_, i) => (i * 7919) % 1000),
      b: Float64Array.from({ length: rows }, (_, i) => (i * 104_729) % 100),
      c: Float64Array.from({ length: rows }, (_, i) => Math.sin(i / 300) * 100),
      d: Float64Array.from({ length: rows }, (_, i) => (i * 31) % 100_003),
      e: Float64Array.from({ length: rows }, (_, i) => (i * 13) % 2000),
    });
  const LOOK_DISPLAYS = compileFields({
    a: { thresholds: { base: "#e8f5e9", steps: [{ value: 500, color: "#1565c0" }] } },
    b: { thresholds: { steps: [{ value: 50, color: "#bbdefb" }] } },
    tier: { mappings: [{ value: "gold", color: "#b8860b" }] },
  });
  const lookOptions = (t: ReturnType<typeof lookTable>, looks: boolean) => ({
    data: rowView(t),
    columns: [
      { field: "id" as const },
      { field: "tier" as const, ...(looks && { encode: { color: { field: "tier" as const } } }) },
      { field: "a" as const, ...(looks && { encode: { fill: { field: "a" as const } } }) },
      { field: "b" as const, ...(looks && { encode: { fill: { field: "b" as const } } }) },
      {
        field: "c" as const,
        ...(looks && { encode: { fill: { field: "c" as const, scale: "heat" } } }),
      },
      {
        field: "d" as const,
        ...(looks && {
          encode: {
            // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
            fill: { condition: { when: { top: 100, field: "d" as const }, then: "#ffd54f" } },
          },
        }),
      },
      { field: "e" as const },
    ],
    fields: LOOK_DISPLAYS,
    ...(looks && {
      scales: { heat: { type: "linear" as const, range: ["#ffffff", "#ef9a9a"] } },
      // biome-ignore lint/suspicious/noThenProperty: a condition's branch, as specs name it.
      encode: { fill: { condition: { when: col("e").gt(1900), then: "#fff8e1" } } },
    }),
  });
  for (const rows of [100_000, 1_000_000]) {
    const shape = rows === 100_000 ? "100k" : "1M";
    const made = lookTable(rows);
    for (const looks of [false, true])
      measure(
        `grid looks: ${shape} rows, make a model ${looks ? "with six looks" : "without looks"}`,
        () => createGridModel(lookOptions(made, looks)).dispose(),
        { warmup: 5, samples: 30 },
      );
    for (const looks of [false, true]) {
      const t = lookTable(rows);
      const model = createGridModel(lookOptions(t, looks));
      model.setViewport(1200, 600);
      let next = rows;
      const batch = () => {
        const ids = Float64Array.from({ length: 1000 }, () => next++);
        return {
          id: ids,
          tier: Array.from(ids, (i) => ["gold", "silver", "bronze"][i % 3]!),
          a: ids.map((i) => (i * 7919) % 1000),
          b: ids.map((i) => (i * 104_729) % 100),
          c: ids.map((i) => Math.sin(i / 300) * 100),
          d: ids.map((i) => (i * 31) % 100_003),
          e: ids.map((i) => (i * 13) % 2000),
        };
      };
      measure(
        `grid looks: ${shape} rows, roll 1,000 and read a screen ${looks ? "with" : "without"} looks`,
        () => {
          t.dropFirst(1000);
          t.append(batch());
          for (let row = 0; row < 22; row++)
            for (let column = 0; column < 7; column++) {
              model.textAt(row, column);
              if (looks) model.lookAt(row, column);
            }
        },
        { warmup: 5, samples: 40 },
      );
      model.dispose();
    }
  }
  {
    const t = lookTable(1_000_000);
    const rank = new Rank(() => wholeTable(t as unknown as Table), "d", 100, true);
    rank.update();
    let next = 1_000_000;
    measure(
      "grid looks: rank of 100 over 1M rows, append 1,000",
      () => {
        const ids = Float64Array.from({ length: 1000 }, () => next++);
        t.append({
          id: ids,
          tier: Array.from(ids, () => "gold"),
          a: ids,
          b: ids,
          c: ids,
          d: ids.map((i) => (i * 31) % 100_003),
          e: ids,
        });
        rank.update();
      },
      { warmup: 5, samples: 40 },
    );
    measure(
      "grid looks: rank of 100 over 1M rows, an eviction of one of them",
      () => {
        // The largest value's row leaves: every row is read again.
        t.replace(0, { d: Float64Array.of(1e9) });
        rank.update();
        t.dropFirst(1);
        rank.update();
      },
      { warmup: 2, samples: 10 },
    );
  }
  {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) console.log("grid looks: category churn heap (run with --expose-gc)");
    for (const domain of [false, true]) {
      const labels = (from: number, count: number) =>
        Array.from({ length: count }, (_, i) => `host-${from + i}`);
      const t = table({ host: category(labels(0, 10_000)) });
      const model = createGridModel({
        data: rowView(t),
        columns: [{ field: "host", encode: { fill: { field: "host", scale: "hosts" } } }],
        scales: {
          hosts: { type: "ordinal", ...(domain && { domain: labels(0, 10) }), unknown: "#eeeeee" },
        },
      });
      model.setViewport(1200, 600);
      const read = () => {
        for (let row = 0; row < 22; row++) model.lookAt(row, 0);
      };
      read();
      gc?.();
      const before = process.memoryUsage().heapUsed;
      // 100,000 new categories through a rolling window of 10,000 rows.
      for (let k = 1; k <= 100; k++) {
        t.dropFirst(1000);
        t.append({ host: labels(10_000 + k * 1000, 1000) });
        read();
      }
      gc?.();
      const grown = process.memoryUsage().heapUsed - before;
      console.log(
        `${`grid looks: category churn heap, ${domain ? "a domain of 10" : "no domain"}`.padEnd(48)} ${(grown / 1024).toFixed(0)} KiB after 100k new categories`,
      );
      model.dispose();
    }
  }

  // A grid's selection over a million rows: each toggle is a command
  // publishing a copy of the selected set, which stores freeze. Over an ordered
  // table after late insertions and rolling drops, the copy is of the words
  // where members are (a thousand rows selected a thousand apart); over a plain
  // table, of its bits (half its rows selected).
  {
    const ROWS = 1_000_000;
    const ordered = orderedTable(
      { t: Float64Array.from({ length: ROWS }, (_, i) => i * 10), v: new Float64Array(ROWS) },
      { orderBy: "t", maxRows: ROWS },
    );
    for (let k = 0; k < 20; k++) {
      // A thousand late rows among the others; as many of the oldest drop.
      const late = Float64Array.from(
        { length: 1000 },
        (_, i) => ((i * 9973 + k * 31) % ROWS) * 10 + 5,
      );
      ordered.append({ t: late, v: late });
      ordered.append({ t: Float64Array.of(ROWS * 10 + k), v: Float64Array.of(0) });
    }
    const plain = table({ v: new Float64Array(ROWS) });
    for (const [name, t, every] of [
      ["1,000 of 1M ordered rows, after late rows and drops", ordered, 1000],
      ["500k of 1M rows", plain, 2],
    ] as const) {
      const model = createGridModel({ data: rowView(t as Table), columns: [{ field: "v" }] });
      const rows = new RowSet(t as Table);
      for (let row = 0; row < ROWS; row += every) rows.add(row);
      model.selectionStore.set(model.channel, selectRows(rows));
      let at = 499;
      measure(
        `grid selection: toggle a row, ${name} selected`,
        () => {
          model.select(at, "toggle");
          at = (at + 7919) % ROWS;
        },
        { warmup: 20, samples: 200 },
      );
      model.dispose();
    }
  }
}
