// Totals of a view's rows kept as rows stream, by groups, and a pivot's totals row.

import { count, max, mean, min, sum } from "../../src/data/aggregations.ts";
import { col } from "../../src/data/expr.ts";
import { groupRows } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { rowView } from "../../src/data/row-view.ts";
import { table } from "../../src/data/table.ts";
import { rowTotals } from "../../src/data/totals.ts";
import { measure, N } from "./shared.ts";

export async function run(): Promise<void> {
  // Totals of every row a view shows (a grid's totals row), kept as rows
  // stream: appends add the batch's rows, drops take theirs away from kept
  // values, other changes compute them again. A rolling window over rising
  // values drops its minimum on every append, which is found again from the
  // window; sums of values cancelling beyond their accuracy are summed again
  // exactly. Groups by a category of 20, and a pivot's totals row (folded from
  // its 200 x 20 combinations), for scale.
  {
    const OPS = { n: count(), total: sum("v"), avg: mean("v"), low: min("v"), high: max("v") };
    const values = (from: number, count: number, f: (i: number) => number) =>
      Float64Array.from({ length: count }, (_, i) => f(from + i));
    const wavy = (i: number) => Math.sin(i / 1000) * 100 + ((i * 7919) % 13);
    for (const size of [100_000, N]) {
      const label = size === N ? "1M" : "100k";
      for (const rolling of [false, true]) {
        const t = table({ v: values(0, size, wavy) }, rolling ? { maxRows: size } : {});
        const totals = rowTotals(rowView(t), { ops: OPS });
        let next = size;
        measure(
          `totals: append 1,000 rows to ${label}${rolling ? " (a rolling window)" : ""}`,
          () => {
            t.append({ v: values(next, 1000, wavy) });
            next += 1000;
            totals.revision;
          },
          { warmup: 5, samples: 30 },
        );
        totals.dispose();
      }
      const t = table({ v: values(0, size, wavy) });
      const totals = rowTotals(rowView(t), { ops: OPS });
      let k = 0;
      measure(
        `totals: change one of ${label} rows in place`,
        () => {
          t.replace(k++ % size, { v: [k] });
          totals.revision;
        },
        { warmup: 3, samples: 15 },
      );
      totals.dispose();
    }
    // A rolling window of rising values: each append drops the minimum.
    const rising = table({ v: values(0, 100_000, (i) => i) }, { maxRows: 100_000 });
    const risingTotals = rowTotals(rowView(rising), { ops: OPS });
    let up = 100_000;
    measure(
      "totals: append 1,000 rising rows to a 100k window",
      () => {
        rising.append({ v: values(up, 1000, (i) => i) });
        up += 1000;
        risingTotals.revision;
      },
      { warmup: 5, samples: 30 },
    );
    risingTotals.dispose();
    // Values of 1e16 and -1e16 with ones between: a running sum loses the ones.
    const cancelling = (i: number) => (i % 3 === 0 ? 1e16 : i % 3 === 1 ? -1e16 : 1);
    const cancel = table({ v: values(0, 100_000, cancelling) });
    const cancelTotals = rowTotals(rowView(cancel), { ops: OPS });
    let more = 100_000;
    measure(
      "totals: append 1,000 cancelling rows to 100k",
      () => {
        cancel.append({ v: values(more, 999, cancelling) });
        more += 999;
        cancelTotals.revision;
      },
      { warmup: 5, samples: 30 },
    );
    cancelTotals.dispose();
    // A filtered rolling window: dropped rows the view left out are not taken away.
    const filtered = table({ v: values(0, 100_000, wavy) }, { maxRows: 100_000 });
    const filteredTotals = rowTotals(rowView(filtered, { filter: col("v").gt(0) }), { ops: OPS });
    let after = 100_000;
    measure(
      "totals: append 1,000 rows to a filtered 100k window",
      () => {
        filtered.append({ v: values(after, 1000, wavy) });
        after += 1000;
        filteredTotals.revision;
      },
      { warmup: 5, samples: 30 },
    );
    filteredTotals.dispose();
    // For scale: groups of the same rows, and a pivot's totals row.
    const hosts = Array.from({ length: 200 }, (_, i) => `host-${i}`);
    const regions = Array.from({ length: 20 }, (_, i) => `region-${i}`);
    const labels = (from: number, count: number, of: string[]) =>
      Array.from({ length: count }, (_, i) => of[((from + i) * 7919) % of.length]!);
    // Regions independent of hosts: (host, region) is the row's place among the 4,000 pairs.
    const regionsOf = (from: number, count: number) =>
      Array.from(
        { length: count },
        (_, i) => regions[Math.floor(((from + i) * 7919) / hosts.length) % regions.length]!,
      );
    const grouped = table({ v: values(0, N, wavy), host: labels(0, N, regions) });
    const groups = groupRows(rowView(grouped), { by: ["host"], ops: OPS });
    let grows = N;
    measure(
      "groups: append 1,000 rows to 1M, by 20 values",
      () => {
        grouped.append({ v: values(grows, 1000, wavy), host: labels(grows, 1000, regions) });
        grows += 1000;
        groups.revision;
      },
      { warmup: 5, samples: 30 },
    );
    groups.dispose();
    const crossed = table({
      v: values(0, 100_000, wavy),
      host: labels(0, 100_000, hosts),
      region: regionsOf(0, 100_000),
    });
    const pivot = pivotRows(rowView(crossed), {
      rows: "host",
      pivot: "region",
      ops: { avg: mean("v"), total: sum("v") },
      totals: { row: true },
    });
    if (pivot.table.length !== hosts.length * regions.length)
      throw new Error(`The pivot has ${pivot.table.length} combinations, not 4,000`);
    let pivots = 100_000;
    measure(
      "pivot: append 1,000 rows, then its totals row (of 4,000 combinations)",
      () => {
        crossed.append({
          v: values(pivots, 1000, wavy),
          host: labels(pivots, 1000, hosts),
          region: regionsOf(pivots, 1000),
        });
        pivots += 1000;
        const crosstab = pivot.read();
        for (let index = -1; index < crosstab.values.length; index++)
          crosstab.columnTotal(index, "avg");
      },
      { warmup: 5, samples: 30 },
    );
    pivot.dispose();
  }
}
