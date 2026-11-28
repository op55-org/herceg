// Row views over a million rows: positions only, no column copies.

import { col } from "../../src/data/expr.ts";
import { type RowQuery, rowView } from "../../src/data/row-view.ts";
import { type Table, table } from "../../src/data/table.ts";
import { measure, millionPoints, N } from "./shared.ts";

export async function run(): Promise<void> {
  const { x, y } = millionPoints();
  // Row views over a million rows: positions only, no column copies.
  const hosts = Array.from({ length: 200 }, (_, i) => `host-${(i * 7919) % 1000}`);
  const rows = table({
    t: x,
    v: y,
    host: Array.from({ length: N }, (_, i) => hosts[(i * 31) % hosts.length]!),
  });
  // Views are disposed once read: a view no one keeps is collected only after
  // this synchronous loop ends, so samples would hold every earlier view.
  const viewOnce = (query: RowQuery) => {
    const view = rowView(rows as unknown as Table, query);
    view.read();
    view.dispose();
  };
  measure("row view: sort 1M rows by a number", () => viewOnce({ sort: [{ field: "v" }] }), {
    warmup: 2,
    samples: 7,
  });
  measure(
    "row view: sort 1M rows by a category, then a number",
    () => viewOnce({ sort: [{ field: "host" }, { field: "v", order: "descending" }] }),
    { warmup: 2, samples: 7 },
  );
  const ascending = Float64Array.from(y).sort();
  for (const share of [0.01, 0.5, 0.99]) {
    // The threshold keeping this share of rows, and the share it really keeps.
    const threshold = ascending[Math.floor(N * (1 - share))]!;
    const kept = ascending.length - ascending.findIndex((value) => value >= threshold);
    measure(
      `row view: filter 1M rows, keeping ${((100 * kept) / N).toFixed(1)}%`,
      () => viewOnce({ filter: col("v").ge(threshold) }),
      { warmup: 3, samples: 15 },
    );
  }
  const window = table({ t: x, v: y }, { maxRows: N });
  const sorted = rowView(window, { sort: [{ field: "v" }] });
  sorted.read();
  let arrival = N;
  measure(
    "row view: append 1,000 rows to a sorted 1M-row window",
    () => {
      const t = Float64Array.from({ length: 1000 }, (_, i) => arrival + i);
      window.append({ t, v: t.map((value) => Math.sin(value / 1000) * 100) });
      arrival += 1000;
      sorted.read();
    },
    { warmup: 5, samples: 30 },
  );
}
