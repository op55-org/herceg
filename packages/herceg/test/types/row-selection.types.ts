// Compile-time tests: checked by `npm run typecheck`, never executed.
import { expectTypeOf } from "vitest";
import { sum } from "../../src/data/aggregations.ts";
import { groupRows } from "../../src/data/groups.ts";
import { type ReadonlyRowSet, RowSet } from "../../src/data/row-set.ts";
import { rowView } from "../../src/data/row-view.ts";
import { type DataSelection, selectionStore, selectRows } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { createChart } from "../../src/dom/chart.ts";
import { createGrid } from "../../src/dom/grid.ts";
import { createGridModel } from "../../src/grid/model.ts";
import { lineage } from "../../src/index.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { loadSpec } from "../../src/spec/load.ts";

declare const element: HTMLElement;
const trips = table({ km: [1, 2], fare: [5, 9], kind: ["a", "b"] });
const stops = table({ t: [0, 1], n: [3, 4] });
type Trips = { km: "number"; fare: "number"; kind: "category" };
const focus = selectionStore(trips);
const near = selectionStore(stops);

// Bindings of tables of different schemas, each typed by its own.
const chart = createChart(element, {
  marks: [point(trips, { x: "km", y: "fare" }), line(stops, { x: "t", y: "n" })],
  interaction: { brush: "xy" },
  rowSelection: rowSelection(
    { store: focus, channel: "focus" },
    { store: near, channel: "near", events: ["click"], effect: "none" },
  ),
});
chart.on("rowSelection", ({ table: changed, channel, selection }) => {
  changed.length satisfies number;
  channel satisfies string;
  if (selection?.kind === "rows") selection.rows.size satisfies number;
});
chart.on("select", ({ rows }) => rows?.[0]?.selection);
chart.on("click", ({ rows }) => rows?.length);
// A selection shown without writing its rows, as when mirroring another view.
chart.select([1, 2], { rows: false });

// A selection freezes the set it holds: a set, or a set already read-only, but not a
// look-alike that cannot be frozen.
const picked = selectRows(new RowSet(trips).add(0));
selectRows(picked.rows);
declare const lookalike: Omit<ReadonlyRowSet, "freeze">;
// @ts-expect-error a selection's set must freeze
selectRows(lookalike);

// @ts-expect-error gestures are brushes, lassos, and clicks
rowSelection({ store: focus, channel: "focus", events: ["drag"] });
// @ts-expect-error effects are highlight or none
rowSelection({ store: focus, channel: "focus", effect: "filter" });
// @ts-expect-error a binding names its channel
rowSelection({ store: focus });

// The loader takes tables and stores of any schema, by name, or another spec's.
loadSpec({ marks: [] }, [], { tables: { trips, stops }, stores: { trips: focus } });
const loaded = loadSpec({ marks: [] });
loadSpec({ marks: [] }, [], { tables: loaded.tables, stores: loaded.stores });
loadSpec({ marks: [] }, [], { stores: new Map([["trips", focus]]) });

// Through lineage: a bar of groups of trips, bound to a store of trips with
// the lineage reader, and a grid of the groups to the same store.
const byKind = groupRows(rowView(trips), { by: ["kind"], ops: { fare: sum("fare") } });
createChart(element, {
  marks: [bar(byKind.table, { x: "kind", y: "fare" })],
  rowSelection: rowSelection({ store: focus, channel: "focus", lineage, budget: 1 << 20 }),
});
const kinds = createGridModel({
  data: rowView(byKind.table),
  columns: [{ field: "kind" }, { field: "fare" }],
  selectionStore: focus,
  channel: "focus",
  lineage,
});
// The grid keeps its store's schema, of trips, and reports selections of them.
expectTypeOf(kinds.selectionStore).toEqualTypeOf(focus);
createGrid(element, { model: kinds, ariaLabel: "Kinds" }).on("select", ({ selection }) => {
  expectTypeOf(selection).toEqualTypeOf<DataSelection<Trips> | null>();
});
// @ts-expect-error the lineage reader is the one herceg exports
rowSelection({ store: focus, channel: "focus", lineage: {} });
// @ts-expect-error a budget is bytes
rowSelection({ store: focus, channel: "focus", lineage, budget: "1 MiB" });
