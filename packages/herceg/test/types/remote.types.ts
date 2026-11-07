// Compile-time tests: checked by `npm run typecheck`, never executed.
// biome-ignore-all lint/suspicious/noThenProperty: conditions' branches, as specs name them.
import { expectTypeOf } from "vitest";
import { category, time } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { createRemoteGrid } from "../../src/dom/grid-remote.ts";
import { exportGrid } from "../../src/grid/export.ts";
import { memorySource } from "../../src/grid/memory.ts";
import type { GridAggregate } from "../../src/grid/query.ts";
import { createRemoteGridModel, type RemoteGridModel } from "../../src/grid/remote.ts";
import type { RemoteTotal, TotalsAnswer, TotalsRequest } from "../../src/grid-remote.ts";

const requests = table({
  id: new Float64Array(3),
  at: time(new Float64Array(3)),
  host: category(["a", "b", "c"]),
});
const source = memorySource(requests, { key: "id" });

const model = createRemoteGridModel({
  source,
  query: { sort: [{ field: "at", order: "descending" }] },
  columns: [{ field: "at", format: { timeStyle: "short" } }, { field: "host" }],
});
expectTypeOf(model).toEqualTypeOf<
  RemoteGridModel<{ id: "number"; at: "time"; host: "category" }>
>();
const grid = createRemoteGrid(document.body, { model, ariaLabel: "Requests" });
expectTypeOf(grid.model).toEqualTypeOf(model);
expectTypeOf(exportGrid(model, { headers: "ids" })).toEqualTypeOf<Promise<Blob>>();

createRemoteGridModel({
  source,
  // @ts-expect-error unknown field
  columns: [{ field: "missing" }],
});
createRemoteGridModel({
  source,
  // @ts-expect-error categories take no format
  columns: [{ field: "host", format: { maximumFractionDigits: 1 } }],
});
createRemoteGridModel({
  source,
  columns: [{ field: "host" }],
  // @ts-expect-error sort keys are the source's fields
  query: { sort: [{ field: "missing" }] },
});
model.setSort([{ field: "host" }]);
// @ts-expect-error sort keys are the source's fields
model.setSort([{ field: "nope" }]);

// Aggregates other than count need a field.
const sum: GridAggregate = { op: "sum", field: "latency", as: "total" };
// @ts-expect-error a sum needs a field
const fieldless: GridAggregate = { op: "sum", as: "total" };
void sum;
void fieldless;

// Looks read the source's fields; scales are the grid's.
createRemoteGridModel({
  source,
  columns: [{ field: "host", encode: { fill: { field: "host", scale: "hosts" } } }],
  scales: { hosts: { type: "ordinal", domain: ["a", "b"], map: { a: "#00aa00" } } },
  encode: { color: { condition: { when: ["==", ["field", "host"], "c"], then: "#888" } } },
});
createRemoteGridModel({
  source,
  // @ts-expect-error unknown field
  columns: [{ field: "host", encode: { fill: { field: "missing" } } }],
});

// Remote totals: aggregates of number and time fields, asked of the source.
{
  const totaled = createRemoteGridModel({
    source,
    totals: [
      { op: "count", as: "n" },
      { op: "mean", field: "at", as: "at" },
    ],
    columns: [{ field: "at", aggregate: "at" }],
  });
  totaled.update({ totals: [{ op: "max", field: "id", as: "last" }] });
  totaled.update({ totals: null });
  // @ts-expect-error a total of a category field
  totaled.update({ totals: [{ op: "mean", field: "host", as: "host" }] });
  // @ts-expect-error a total needs a name
  totaled.update({ totals: [{ op: "count" }] });
}

// A source's totals typed through the public entry, `herceg/grid/remote`.
{
  const answer = async (request: TotalsRequest): Promise<TotalsAnswer> => ({
    revision: request.revision,
    snapshot: request.snapshot,
    columns: Object.fromEntries(request.aggregate.map(({ as }) => [as, Float64Array.of(0)])),
  });
  const total: RemoteTotal<{ id: "number"; at: "time"; host: "category" }> = {
    op: "max",
    field: "at",
    as: "latest",
  };
  void answer;
  void total;
}
