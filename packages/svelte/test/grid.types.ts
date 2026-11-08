// Compile-time tests of the grid components, run by `npm run typecheck`
// (svelte-check). Markup is checked through the same component signatures
// these calls use: the schema is inferred from `model`, and `cells`'
// snippets, `fields`, and the bound `grid` follow it.
import { count, rowTotals, rowView, table } from "herceg";
import { createGridModel, type GridCellContext, type Grid as HercegGrid } from "herceg/grid";
import { createPivotGridModel } from "herceg/grid/pivot";
import { createRemoteGridModel, type GridSource } from "herceg/grid/remote";
import { pivotRows } from "herceg/pivot";
import type { Snippet } from "svelte";
import { PivotGrid } from "../src/grid/pivot.js";
import { RemoteGrid } from "../src/grid/remote.js";
import { Grid } from "../src/grid.js";

/** Svelte's own first argument of a component. */
declare const internals: never;

const requests = table({ latency: new Float64Array(3), host: ["a", "b", "c"] });
type Requests = { latency: "number"; host: "category" };
const model = createGridModel({
  data: rowView(requests),
  columns: [{ field: "host" }, { field: "latency" }, { id: "open", title: "" }],
});
// Snippets declared in markup are typed by their parameter's annotation.
declare const open: Snippet<[GridCellContext<Requests>]>;
declare const other: Snippet<[GridCellContext<{ other: "number" }>]>;
declare const bound: HercegGrid<Requests> | null;

Grid(internals, {
  model,
  ariaLabel: "Requests",
  theme: "dark",
  copy: { maxCells: 1000 },
  grid: bound,
  cells: {
    open: { fields: ["host", "latency"], interaction: "control", render: open },
    host: open,
  },
  onrowclick: ({ ref }) => ref.id,
  onrender: ({ revision }) => revision,
  onselect: ({ selection, cause }) => {
    // A local grid's selection is of its table's rows, read-only.
    if (selection?.kind === "rows") selection.rows.copy().add(0);
    // @ts-expect-error a reported selection's rows are read-only: change a copy
    if (selection?.kind === "rows") selection.rows.add(0);
    return cause;
  },
});
// @ts-expect-error grids need an accessible name
Grid(internals, { model });
// @ts-expect-error copy is false or its limits
Grid(internals, { model, ariaLabel: "Requests", copy: true });
Grid(internals, {
  model,
  ariaLabel: "Requests",
  cells: {
    // @ts-expect-error a field the grid's table lacks
    open: { fields: ["hots"], render: open },
    // @ts-expect-error the three ways a cell takes the keyboard
    host: { interaction: "button", render: open },
  },
});
// @ts-expect-error a snippet of another schema's cells
Grid(internals, { model, ariaLabel: "Requests", cells: { open: other } });
declare const otherGrid: HercegGrid<{ other: "number" }> | null;
// @ts-expect-error the bound grid is of the model's schema
Grid(internals, { model, ariaLabel: "Requests", grid: otherGrid });

declare const source: GridSource<Requests>;
RemoteGrid(internals, {
  model: createRemoteGridModel({ source, columns: [{ field: "host" }] }),
  ariaLabel: "Requests",
  cells: { host: { fields: ["latency"], render: open } },
});

const pivot = createPivotGridModel({
  data: pivotRows(rowView(requests), { rows: "host", pivot: "host", ops: { n: count() } }),
});
PivotGrid(internals, { model: pivot, ariaLabel: "Requests by host" });
// @ts-expect-error pivot grids take no Svelte cells
PivotGrid(internals, { model: pivot, ariaLabel: "Requests by host", cells: {} });

// Totals rows and headings are the model's: <Grid> draws what the model holds.
const view = rowView(requests);
Grid(internals, {
  model: createGridModel({
    data: view,
    totals: rowTotals(view, { ops: { n: count() } }),
    columns: [
      { field: "host", heading: "Who" },
      { field: "latency", heading: ["Speed", { id: "p", title: "Latency" }], aggregate: "n" },
    ],
  }),
  ariaLabel: "Requests",
});
