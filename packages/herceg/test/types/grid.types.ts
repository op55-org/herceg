// Compile-time tests: checked by `npm run typecheck`, never executed.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { expectTypeOf } from "vitest";
import { count, max, mean, median, min, sum } from "../../src/data/aggregations.ts";
import { time } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { type GroupKey, groupRows, type RowGroups } from "../../src/data/groups.ts";
import { rowView } from "../../src/data/row-view.ts";
import { selectionStore } from "../../src/data/selection.ts";
import { type Schema, Table, table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import { createGrid, type Grid } from "../../src/dom/grid.ts";
import { compileFields } from "../../src/fields.ts";
import {
  type CellLook,
  createGridModel,
  type GridColumn,
  type GridModel,
} from "../../src/grid/model.ts";
import { bar } from "../../src/marks/bar.ts";
import { point } from "../../src/marks/point.ts";

const requests = table({
  at: time(new Float64Array(3)),
  latency: new Float64Array(3),
  host: ["a", "b", "c"],
});

const model = createGridModel({
  data: rowView(requests),
  columns: [
    { field: "at", format: { timeStyle: "short" } },
    { field: "latency", format: { maximumFractionDigits: 1 }, align: "center" },
    { field: "host", title: "Host" },
  ],
});
expectTypeOf(model).toEqualTypeOf<GridModel<{ at: "time"; latency: "number"; host: "category" }>>();
const grid = createGrid(document.body, { model, ariaLabel: "Requests" });
expectTypeOf(grid.model).toEqualTypeOf(model);

createGridModel({
  data: rowView(requests),
  // @ts-expect-error unknown field
  columns: [{ field: "missing" }],
});
createGridModel({
  data: rowView(requests),
  // @ts-expect-error categories take no format
  columns: [{ field: "host", format: { maximumFractionDigits: 1 } }],
});
createGridModel({
  data: rowView(requests),
  // @ts-expect-error a number field takes number formats, not date formats
  columns: [{ field: "latency", format: { dateStyle: "medium" } }],
});
// Columns' own formats take every form axes take, by the field's kind.
const displayed = createGridModel({
  data: rowView(requests),
  columns: [
    { field: "latency", format: { duration: "millisecond", maxUnits: 1 } },
    { field: "latency", id: "pattern", format: { number: ",.1f", suffix: " ms" } },
    { field: "latency", id: "si", format: { si: "s", decimals: 1 } },
    { field: "at", format: { time: "%Y Q%q", fiscal: { start: 4 } } },
  ],
  fields: compileFields({ latency: { label: "Latency", format: { duration: "millisecond" } } }),
});
createGridModel({
  data: rowView(requests),
  // @ts-expect-error a time field takes time formats
  columns: [{ field: "at", format: { duration: "millisecond" } }],
});
createGridModel({
  data: rowView(requests),
  // @ts-expect-error categories take no format
  columns: [{ field: "host", format: { number: ",.0f" } }],
});
createGridModel({
  data: rowView(requests),
  // @ts-expect-error numbers have no fiscal years
  columns: [{ field: "latency", format: { number: ",.0f", fiscal: { start: 4 } } }],
});
// Field displays: rules as charts take them, or compiled once and shared.
createGridModel({
  data: rowView(requests),
  columns: [{ field: "latency" }],
  fields: { latency: { label: "Latency" } },
});
createGridModel({
  data: rowView(requests),
  columns: [{ field: "latency" }],
  fields: [{ match: { kind: "number" }, missing: "–" }],
});
const shared = compileFields([{ match: "latency", format: { duration: "millisecond" } }]);
createChart(document.body, { fields: shared, marks: [point(requests, { x: "at", y: "latency" })] });
displayed.update({ fields: shared });
displayed.update({ fields: [{ match: { kind: "number" }, missing: "–" }] });
displayed.update({ fields: undefined });
displayed.update({});
// @ts-expect-error update takes the presentation, not columns
displayed.update({ columns: [] });
// @ts-expect-error setFields is update({ fields })
displayed.setFields(undefined);
createGridModel({
  data: rowView(requests),
  columns: [{ field: "latency" }],
  // @ts-expect-error a display's settings are checked
  fields: { latency: { lable: "Latency" } },
});
expectTypeOf(displayed.columnTitle("latency")).toEqualTypeOf<string>();
model.setSort([{ field: "latency", order: "descending" }]);
// @ts-expect-error sort keys are the table's fields
model.setSort([{ field: "missing" }]);

// Column layout: pins are a side, and the commands name columns by id.
createGridModel({
  data: rowView(requests),
  columns: [{ field: "at", pin: "left" }, { field: "latency" }, { field: "host", pin: "right" }],
});
createGridModel({
  data: rowView(requests),
  // @ts-expect-error columns pin to the left or the right
  columns: [{ field: "at", pin: "top" }],
});
model.resizeColumn("latency", 160);
model.moveColumn("host", null);
model.pinColumn("at", "left");
model.pinColumn("at", null);
// @ts-expect-error columns pin to the left or the right
model.pinColumn("at", "top");
model.setColumnVisible("host", false);
expectTypeOf(model.canPin("at")).toEqualTypeOf<boolean>();
expectTypeOf(model.columnLayout[0]!.pinned).toEqualTypeOf<"left" | "right" | null>();
// What the model gives back, it takes again.
model.setColumns(model.columns);

// Tables whose fields are only known at runtime take any field and either format.
const loose = new Table({ x: [1] });
const columns: GridColumn<Schema>[] = [{ field: "anything", format: { dateStyle: "medium" } }];
createGridModel({ data: rowView(loose), columns });

// Helpers over grids of any table are generic: models and grids follow their schema exactly.
function focusFirst<S extends Schema>(target: Grid<S>) {
  const first = target.model.columnLayout[0];
  if (first) target.focusCell(0, first.id);
}
focusFirst(grid);

// The grids guide's grid and chart linked both ways.
{
  const store = selectionStore(requests);
  const gridRows = rowView(requests);
  const chartRows = rowView(requests);
  createGrid(document.body, {
    model: createGridModel({
      data: gridRows,
      columns: [{ field: "at" }, { field: "latency" }],
      selectionStore: store,
    }),
    ariaLabel: "Requests",
  });
  const chart = createChart(document.body, {
    marks: [point(chartRows, { x: "at", y: "latency" })],
    interaction: { brush: "x" },
  });
  store.subscribe(() => {
    const picked = store.get("grid-rows");
    chartRows.restrict(picked?.kind === "rows" ? picked.rows : null);
  });
  chart.on("select", ({ selection }) => {
    const x = selection?.kind === "brush" ? selection.x : null;
    gridRows.setQuery({
      ...gridRows.query,
      filter: x ? col("at").ge(x[0]).and(col("at").le(x[1])) : true,
    });
  });
}

// Groups of a view's rows: a table of their aggregates, typed for charts,
// that grids show as group rows.
{
  const view = rowView(requests);
  const byHost = groupRows(view, {
    by: ["host"],
    ops: { n: count(), shown: count("latency"), avg: mean("latency"), since: min("at") },
  });
  expectTypeOf(byHost).toExtend<RowGroups<{ at: "time"; latency: "number"; host: "category" }>>();
  expectTypeOf(byHost.table.kind)
    .parameter(0)
    .toEqualTypeOf<"host" | "n" | "shown" | "avg" | "since">();
  bar(byHost.table, { x: "host", y: "avg" });
  // @ts-expect-error the groups' table has no "latency"
  bar(byHost.table, { x: "host", y: "latency" });
  expectTypeOf(byHost.keyOf(0)).toEqualTypeOf<GroupKey>();
  // @ts-expect-error unknown grouping field
  groupRows(view, { by: ["missing"] });
  // @ts-expect-error groups have no medians
  groupRows(view, { by: ["host"], ops: { m: median("latency") } });
  // @ts-expect-error categories have no sums
  groupRows(view, { by: ["host"], ops: { s: sum("host") } });
  // @ts-expect-error nor maximums
  groupRows(view, { by: ["at"], ops: { s: max("host") } });

  const grouped = createGridModel({
    data: view,
    groups: byHost,
    columns: [{ field: "host" }, { field: "latency", aggregate: "avg" }],
  });
  const row = grouped.row(0);
  if (row.kind === "group") expectTypeOf(row.key).toEqualTypeOf<GroupKey>();
  else expectTypeOf(row.position).toEqualTypeOf<number>();
  expectTypeOf(grouped.selectionState(0)).toEqualTypeOf<"all" | "some" | "none">();
  grouped.setGroups(groupRows(view, { by: ["at", "host"] }));
  grouped.setGroups(null);
  // @ts-expect-error groups of another table's rows
  grouped.setGroups(groupRows(rowView(table({ x: [1] })), { by: ["x"] }));
}

// Nested groups: each level's table has the grouping fields down to it.
{
  const view = rowView(requests);
  const nested = groupRows(view, {
    by: ["host", "at"],
    ops: { n: count(), worst: max("latency") },
  });
  bar(nested.tableOf("host"), { x: "host", y: "n" });
  // @ts-expect-error the first level's table has no "at"
  bar(nested.tableOf("host"), { x: "at", y: "n" });
  bar(nested.tableOf("at"), { x: "at", y: "worst", series: "host" });
  expectTypeOf(nested.tableOf("host").kind).parameter(0).toEqualTypeOf<"host" | "n" | "worst">();
  expectTypeOf(nested.tableOf("at").kind)
    .parameter(0)
    .toEqualTypeOf<"host" | "at" | "n" | "worst">();
  // @ts-expect-error not a grouping field
  nested.tableOf("latency");
  expectTypeOf(nested.keyOf(0, 0)).toEqualTypeOf<GroupKey>();
  expectTypeOf(nested.childrenOf(0, 0)).toEqualTypeOf<Int32Array>();
  // Grids take nested groups as any others.
  const model = createGridModel({ data: view, groups: nested, columns: [{ field: "host" }] });
  const row = model.row(0);
  if (row.kind === "group") expectTypeOf(row.level).toEqualTypeOf<number>();
  // Without a tuple of fields, their order is unknown: a level's table has its own grouping field only.
  const fields: ("host" | "at")[] = ["host", "at"];
  const loose = groupRows(view, { by: fields, ops: { n: count() } });
  bar(loose.tableOf("at"), { x: "at", y: "n" });
  // @ts-expect-error "host" may come after "at"
  bar(loose.tableOf("at"), { x: "host", y: "n" });
  // A field known only as one of them: neither may be in its table.
  const either = fields[0]!;
  bar(loose.tableOf(either), { x: "n", y: "n" });
  // @ts-expect-error the table of "host" lacks "at"
  loose.tableOf(either).numbers("at");
  // In a tuple, the first field is in every level's table.
  expectTypeOf(nested.tableOf(either).kind).parameter(0).toEqualTypeOf<"host" | "n" | "worst">();
}

// The grids guide's row groups and grouped grid.
{
  const log = table({
    time: time(new Float64Array(3)),
    status: [200, 500, 503],
    service: ["api", "web", "api"],
    latency: new Float64Array(3),
  });
  const failed = rowView(log, { filter: col("status").ge(500) });
  const byService = groupRows(failed, {
    by: ["service"],
    ops: { errors: count(), latency: mean("latency"), worst: max("latency") },
  });
  bar(byService.table, { x: "service", y: "errors" });
  const view = rowView(log);
  const grouped = groupRows(view, {
    by: ["service"],
    ops: { n: count(), latency: mean("latency") },
  });
  createGridModel({
    data: view,
    groups: grouped,
    columns: [
      { field: "service" },
      { field: "time" },
      { field: "latency", aggregate: "latency", format: { maximumFractionDigits: 1 } },
    ],
  });
  bar(grouped.table, { x: "service", y: "latency" });
}

// Looks: channels of fill and color over the rows' fields, as marks' colors
// take them, without the series' names; aggregate looks over the groups'
// aggregates by name.
{
  const view = rowView(requests);
  const looked = createGridModel({
    data: view,
    columns: [
      { field: "latency", encode: { fill: { field: "latency", scale: "heat" } } },
      { field: "latency", id: "shown", encode: { fill: { field: "latency" } } },
      { field: "host", encode: { color: [{ field: "host", scale: "hosts" }, { value: "#333" }] } },
      {
        field: "at",
        encode: { fill: { condition: { when: { top: 3, field: "latency" }, then: "gold" } } },
      },
    ],
    scales: {
      heat: { type: "linear", range: ["#ffffff", "#ff0000"] },
      hosts: { type: "ordinal", map: { a: "#00aa00" } },
    },
    encode: { fill: { condition: { when: col("latency").gt(100), then: "#fdd" } } },
  });
  expectTypeOf(looked.lookAt(0, 0)).toEqualTypeOf<CellLook | undefined>();
  looked.update({ scales: {}, encode: { color: { value: "#000" } } });
  createGridModel({
    data: view,
    // @ts-expect-error unknown field
    columns: [{ field: "host", encode: { fill: { field: "missing" } } }],
  });
  createGridModel({
    data: view,
    // @ts-expect-error a grid has no series
    columns: [{ field: "host", encode: { fill: { series: true, scale: "s" } } }],
  });
  createGridModel({
    data: view,
    // @ts-expect-error symbols are named
    columns: [{ field: "host", encode: { symbol: { value: "circel" } } }],
  });
  createGridModel({
    data: view,
    columns: [
      {
        field: "host",
        // @ts-expect-error ranks are of numbers and times
        encode: { fill: { condition: { when: { top: 1, field: "host" }, then: "red" } } },
      },
    ],
  });
  createGridModel({
    data: view,
    columns: [{ field: "host" }],
    // @ts-expect-error scales of categories have no panels in a grid
    scales: { hosts: { type: "ordinal", scope: "panel" } },
  });

  const groups = groupRows(view, { by: ["host"], ops: { n: count(), slow: max("latency") } });
  createGridModel({
    data: view,
    groups,
    columns: [
      { field: "host" },
      {
        field: "latency",
        aggregate: "slow",
        aggregateEncode: {
          fill: [
            { field: "slow", scale: "heat" },
            { field: "n", scale: "heat" },
          ],
        },
      },
    ],
    scales: { heat: { type: "linear", range: ["#ffffff", "#ff0000"] } },
  });
  createGridModel({
    data: view,
    groups,
    columns: [
      {
        field: "latency",
        aggregate: "slow",
        // @ts-expect-error aggregate looks read the groups' table, which has no "latency"
        aggregateEncode: { fill: { field: "latency" } },
      },
    ],
  });
}
