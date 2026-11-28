// Tables: appends to a live table, and derived tables over a million rows.

import { count, mean } from "../../src/data/aggregations.ts";
import { derive } from "../../src/data/derive.ts";
import { col } from "../../src/data/expr.ts";
import { table } from "../../src/data/table.ts";
import { measure, millionPoints, N } from "./shared.ts";

export async function run(): Promise<void> {
  const { x, y } = millionPoints();
  const columns: Record<string, Float64Array> = { t: new Float64Array(3000) };
  for (let s = 0; s < 15; s++) columns[`s${s}`] = new Float64Array(3000);
  const live = table(columns, { maxRows: 3000 });
  const row: Record<string, number> = { t: 0 };
  for (let s = 0; s < 15; s++) row[`s${s}`] = 1;
  measure(
    "table: appendRow, 16 fields, 3,000-row window",
    () => {
      row.t = (row.t ?? 0) + 1;
      live.appendRow(row as never);
    },
    { repeat: 1000 },
  );
  const batch: Record<string, Float64Array> = { t: new Float64Array(100) };
  for (let s = 0; s < 15; s++) batch[`s${s}`] = new Float64Array(100);
  measure(
    "table: append 100 rows, 16 fields, 3,000-row window",
    () => live.append(batch as never),
    {
      repeat: 100,
    },
  );

  // Derived tables over 1M rows: a filter with a calculation, an aggregate by a
  // category of 20 values, a rolling mean, and appends through a row-by-row pipeline.
  const sites = Array.from({ length: N }, (_, i) => `site ${i % 20}`);
  const readings = table({ t: x, v: y, site: sites });
  measure(
    "derive: filter + calculate, 1M rows",
    () => {
      derive(readings).filter(col("v").gt(0)).calculate("w", col("v").mul(2)).table();
    },
    { warmup: 3, samples: 10 },
  );
  measure(
    "derive: aggregate mean by 20 sites, 1M rows",
    () => {
      derive(readings)
        .aggregate({ by: ["site"], ops: { mean: mean("v"), n: count() } })
        .table();
    },
    { warmup: 3, samples: 10 },
  );
  measure(
    "derive: rolling mean of 100 rows, 1M rows",
    () => {
      derive(readings)
        .rolling({ size: 100, ops: { avg: { op: "mean", field: "v" } } })
        .table();
    },
    { warmup: 3, samples: 10 },
  );
  const stream = table({ t: x.slice(0, 100_000), v: y.slice(0, 100_000) }, { maxRows: 100_000 });
  derive(stream).filter(col("v").gt(0)).calculate("w", col("v").mul(2)).table();
  let next = 100_000;
  measure("derive: append 100 rows to a following filter, 100k window", () => {
    const t = Float64Array.from({ length: 100 }, (_, i) => next + i);
    stream.append({ t, v: t.map((value) => Math.sin(value)) });
    next += 100;
  });
}
