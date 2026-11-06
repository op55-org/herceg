// Compile-time tests of pivots: checked by `npm run typecheck`, never executed.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { expectTypeOf } from "vitest";
import { count, max, mean, median, sum } from "../../src/data/aggregations.ts";
import { time } from "../../src/data/column.ts";
import type { GroupAggregate } from "../../src/data/groups.ts";
import { pivotRows } from "../../src/data/pivot.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { createPivotGrid } from "../../src/dom/grid-pivot.ts";
import { createPivotGridModel, type PivotGridModel } from "../../src/grid/pivot.ts";
import { bar } from "../../src/marks/bar.ts";

const requests = table({
  at: time(new Float64Array(3)),
  latency: new Float64Array(3),
  host: ["a", "b", "c"],
  region: ["x", "y", "z"],
});
type Requests = { at: "time"; latency: "number"; host: "category"; region: "category" };

const pivot = pivotRows(rowView(requests), {
  rows: "region",
  pivot: "host",
  ops: { n: count(), avg: mean("latency"), last: max("at"), total: sum("latency") },
});
// The long table has both fields and every aggregate; a time's maximum stays a time.
expectTypeOf(pivot.table.kind)
  .parameter(0)
  .toEqualTypeOf<"region" | "host" | "n" | "avg" | "last" | "total">();
expectTypeOf(pivot.rowTable.kind)
  .parameter(0)
  .toEqualTypeOf<"region" | "n" | "avg" | "last" | "total">();
bar(pivot.table, { x: "region", y: "avg", series: "host" });
// @ts-expect-error the rows' table has no pivot field
bar(pivot.rowTable, { x: "host", y: "n" });

// @ts-expect-error unknown fields
pivotRows(rowView(requests), { rows: "missing", pivot: "host", ops: { n: count() } });
// @ts-expect-error pivots have no medians
pivotRows(rowView(requests), { rows: "region", pivot: "host", ops: { m: median("latency") } });
// @ts-expect-error categories have no sums
pivotRows(rowView(requests), { rows: "region", pivot: "host", ops: { s: sum("host") } });
pivotRows(rowView(requests), {
  rows: "region",
  pivot: "host",
  ops: { n: count() },
  // @ts-expect-error counts are the only zeros filled
  zeroFill: "sum",
});

const model = createPivotGridModel({
  data: pivot,
  aggregates: { avg: { title: "Latency", format: { maximumFractionDigits: 1 } }, n: { width: 80 } },
  selectionStore: selectionStore(requests),
});
expectTypeOf(model).toEqualTypeOf<PivotGridModel<Requests>>();
// Field displays, formats of every form by kind, and update, as other grids take them.
createPivotGridModel({
  data: pivot,
  fields: { latency: { format: { duration: "millisecond" } }, host: { label: "Host" } },
  rowColumn: { title: "Region" },
  aggregates: {
    avg: { format: { number: ",.1f", suffix: " ms" } },
    last: { format: { time: "%b %d" } },
    total: { format: { duration: "millisecond" } },
  },
});
createPivotGridModel({
  data: pivotRows(rowView(requests), { rows: "at", pivot: "latency", ops: { n: count() } }),
  rowColumn: { format: { time: "%Y-%m-%d" } },
  valueFormat: { binary: "B" },
});
createPivotGridModel({
  data: pivot,
  // @ts-expect-error the pivot field holds categories, which take no format
  valueFormat: { time: "%b %d" },
});
createPivotGridModel({
  data: pivot,
  // @ts-expect-error the rows field holds categories
  rowColumn: { format: { number: ",.0f" } },
});
createPivotGridModel({
  data: pivot,
  // @ts-expect-error a count is a number
  aggregates: { n: { format: { time: "%H" } } },
});
createPivotGridModel({
  data: pivot,
  // @ts-expect-error a time's maximum is a time
  aggregates: { last: { format: { number: ",.0f" } } },
});
// Widened aggregates may be of either kind: a time's maximum among them takes a time format.
const widened: Record<string, GroupAggregate<"at" | "latency">> = { last: max("at"), n: count() };
const either = pivotRows(rowView(requests), { rows: "region", pivot: "host", ops: widened });
createPivotGridModel({ data: either, aggregates: { last: { format: { time: "%b %d" } } } });
createPivotGridModel({ data: either, aggregates: { n: { format: { number: ",.0f" } } } });
model.update({ fields: [{ match: { kind: "number" }, missing: "–" }] });
createPivotGridModel({
  data: pivot,
  // @ts-expect-error missing text comes from field displays
  missing: "n/a",
});
createPivotGridModel({
  data: pivot,
  // @ts-expect-error aggregates by the pivot's names
  aggregates: { missing: { title: "?" } },
});
createPivotGridModel({
  data: pivot,
  // @ts-expect-error a store of another table
  selection: selectionStore(table({ x: [1] })),
});
// Sort keys and columns name the crosstab's fields: generated ids too.
model.setSort([{ field: '["pivot","host","category","a","n","count",null]', order: "descending" }]);
model.cycleSort("region");
// @ts-expect-error pivot grids have no groups to set
model.setGroups(null);
// @ts-expect-error nor table rows
model.rowAt(0);

const grid = createPivotGrid(document.body, { model, ariaLabel: "Requests" });
expectTypeOf(grid.model).toEqualTypeOf(model);

// Cells' looks by aggregate read their combination's row: the rows and
// pivot fields, and every aggregate.
createPivotGridModel({
  data: pivot,
  aggregates: {
    avg: {
      encode: {
        fill: [
          { condition: { when: { top: 1, field: "avg" }, then: "#ffd700" } },
          { field: "total", scale: "heat" },
        ],
        color: { field: "host", scale: "hosts" },
      },
    },
  },
  scales: {
    heat: { type: "linear", range: ["#ffffff", "#ff0000"] },
    hosts: { type: "ordinal", map: { a: "#00aa00" } },
  },
});
createPivotGridModel({
  data: pivot,
  // @ts-expect-error cells read the pivot's table, which has no "latency"
  aggregates: { avg: { encode: { fill: { field: "latency", scale: "heat" } } } },
});
