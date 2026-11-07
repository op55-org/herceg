// Compile-time tests of the grid components, run by `npm run typecheck`.
// Vue's template checker (vue-tsc) checks a component in a template by
// constructing it with the props written there (`new Grid({ ... })`, with
// `aria-*` attributes as written, kebab-case) and reads its slots' props
// from the instance's `$slots` and a template ref's type from the instance,
// so these lines check what templates check: the schema is inferred from
// `model`, and `cells`, `read`, the slots' `cell`, and the exposed `grid`
// follow it. (h() cannot infer a generic component's schema: cast to
// `Component` there, or write templates or TSX.)
import { count, rowTotals, rowView, table } from "herceg";
import { createGridModel, type Grid as HercegGrid } from "herceg/grid";
import { createPivotGridModel, type PivotGrid as PivotGridHandle } from "herceg/grid/pivot";
import {
  createRemoteGridModel,
  type GridSource,
  type RemoteGrid as RemoteGridHandle,
} from "herceg/grid/remote";
import { pivotRows } from "herceg/pivot";
import { type Component, h } from "vue";
import { PivotGrid } from "../src/grid/pivot.ts";
import { RemoteGrid } from "../src/grid/remote.ts";
import { Grid } from "../src/grid.ts";

const requests = table({ latency: new Float64Array(3), host: ["a", "b", "c"] });
type Requests = { latency: "number"; host: "category" };
const model = createGridModel({
  data: rowView(requests),
  columns: [{ field: "host" }, { field: "latency" }, { id: "open", title: "" }],
});

const grid = new Grid({ model, ariaLabel: "Requests", theme: "dark", headerHeight: 36 });
// The exposed grid is of the model's schema (a template ref's `grid`).
const exposed: HercegGrid<Requests> | null = grid.grid;
// @ts-expect-error the exposed grid is of the model's schema
const other: HercegGrid<{ other: "number" }> | null = grid.grid;

// Slots draw columns' cells; their `cell` reads the model's fields.
const slot = grid.$slots["cell-open"]!;
type SlotCell = Parameters<typeof slot>[0]["cell"];
declare const cell: SlotCell;
const latency: number | null = cell.read("latency");
// @ts-expect-error read gives a field's own kind
const wrong: string | null = cell.read("latency");
// @ts-expect-error a field the grid's table lacks
cell.read("hots");

new Grid({
  model,
  ariaLabel: "Requests",
  copy: { maxCells: 1000, escapeFormulas: false },
  cells: {
    host: (cell) => cell.text,
    open: {
      fields: ["host", "latency"],
      interaction: "control",
      render: (cell) => {
        const host: string | null = cell.read("host");
        // @ts-expect-error a field the grid's table lacks
        cell.read("hots");
        return h("button", { type: "button" }, `${host}`);
      },
    },
    // A slot draws it: `cells` gives its settings alone.
    latency: { fields: ["latency"], interaction: "composite" },
  },
  onRowClick: ({ ref }) => ref.id,
  onRender: ({ revision }) => revision,
});

// As a template writes it: `<Grid :model="model" aria-label="Requests" />`.
new Grid({ model, "aria-label": "Requests" });
// @ts-expect-error grids need an accessible name
new Grid({ model });
// @ts-expect-error one accessible name
new Grid({ model, ariaLabel: "Requests", "aria-label": "Requests" });
// @ts-expect-error copy is false or its limits
new Grid({ model, ariaLabel: "Requests", copy: true });
new Grid({
  model,
  ariaLabel: "Requests",
  cells: {
    // @ts-expect-error a field the grid's table lacks
    host: { fields: ["hots"] },
    // @ts-expect-error the three ways a cell takes the keyboard
    latency: { interaction: "button" },
  },
});

declare const source: GridSource<Requests>;
const remote = new RemoteGrid({
  model: createRemoteGridModel({ source, columns: [{ field: "host" }] }),
  ariaLabel: "Requests",
  cells: { host: { fields: ["latency"], render: (cell) => cell.read("latency") } },
});
const remoteGrid: RemoteGridHandle<Requests> | null = remote.grid;

const pivot = new PivotGrid({
  model: createPivotGridModel({
    data: pivotRows(rowView(requests), { rows: "host", pivot: "host", ops: { n: count() } }),
  }),
  ariaLabel: "Requests by host",
});
const pivotGrid: PivotGridHandle<Requests> | null = pivot.grid;
new PivotGrid({
  model: createPivotGridModel({
    data: pivotRows(rowView(requests), { rows: "host", pivot: "host", ops: { n: count() } }),
  }),
  ariaLabel: "Requests by host",
  // @ts-expect-error pivot grids take no Vue cells
  cells: {},
});

// Totals rows and headings are the model's: <Grid> draws what the model holds.
const view = rowView(requests);
new Grid({
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

// In render functions, h() takes the component cast, as for mark components.
h(Grid as Component, { model, ariaLabel: "Requests" });

void [exposed, other, latency, wrong, remoteGrid, pivotGrid];
