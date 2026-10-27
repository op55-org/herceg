# Grids

`herceg/grid` shows the rows of a table in a virtualized grid: a million
rows mount only what is in view. Grids share tables, views, and selections
with charts, so a grid and a chart can link both ways without copying
data. Grids are TypeScript and React only; Python has none.

- [A grid](#a-grid)
- [Sorting and selecting](#sorting-and-selecting)
- [Columns](#columns)
- [Linking a grid and a chart](#linking-a-grid-and-a-chart)
- [Grouped rows](#grouped-rows)
- [Pivots](#pivots)
- [Remote grids](#remote-grids)
- [Accessibility](#accessibility)
- [In React](#in-react)
- [Limits](#limits)

## A grid

```ts
import { rowView } from "herceg";
import { createGrid, createGridModel } from "herceg/grid";

const model = createGridModel({
  data: rowView(requests),
  columns: [
    { field: "time", format: { timeStyle: "medium" } },
    { field: "service", title: "Service" },
    { field: "latency", title: "Latency (ms)", format: { maximumFractionDigits: 1 } },
  ],
  timeZone: "UTC",
});
const grid = createGrid(document.querySelector("#requests")!, { model, ariaLabel: "Requests" });
```

The **model** (also its own DOM-free entry, `herceg/grid/model`) holds
what the grid shows apart from the rows, which the [row
view](data.md#row-views) chooses and orders: the columns, the scroll
position, the focused cell, and the selection. One model serves one grid;
grids of the same rows share the view and the selection store.

| Column option | Means |
| --- | --- |
| `field`, `title` | The field shown, and its header (the field's name by default). |
| `format` | Intl options for the field's kind (none for categories). Numbers align to the end. |
| `width` | Pixels: 120 by default, at least 32. |
| `aggregate` | In a [grouped grid](#grouped-rows), the group's value to show. |

| Model option | Means |
| --- | --- |
| `data` | A row view. |
| `columns` | The columns, as above. |
| `timeZone`, `locale` | How times and numbers are written (the runtime's locale and `"local"` zone by default). |
| `rowHeight` | Pixels per row; 28 by default. |
| `missing` | Text for missing values (empty by default). |
| `selectionStore`, `channel` | Where selected rows go (`"grid-rows"` by default). |
| `groups` | Row groups to show (see [below](#grouped-rows)). |

The grid follows its table and view as they change:

- Rows appended below those in view cost nothing to draw.
- When rows drop out of a rolling window, or sorted rows arrive above the
  top row, the rows in view stay where they are.
- The focused cell keeps to its row through sorting and streaming, or goes
  to the row taking its place.

The model, view, and table belong to the application. `grid.destroy()`
leaves them; `model.dispose()` stops the model following the view, as it
does on its own once nothing keeps the model. Without a height of its own,
a grid's container gets 320 pixels. Grids take the charts'
[themes](styling.md#themes) (`theme`).

## Sorting and selecting

- **Sorting.** Clicking a header sorts by its field: ascending, descending,
  then not at all. Shift adds the field to the other keys.
  `model.setSort(keys)` does the same. Sorting goes through the view,
  keeping its filter.
- **Selecting.** Clicking a row selects it; Ctrl or Cmd toggles it; Shift
  selects the range from the last one clicked, in the grid's order.
- **The selection** is a row set in the model's
  [selection store](data.md#row-sets-and-selection-stores) under its
  channel, where an application or a chart can read it. A condition put in
  that channel shows as selected rows too.

## Columns

Columns are resized, moved, pinned, and hidden by model commands naming
them by id, or from the headers.

```ts
model.resizeColumn("latency", 160); // at least MIN_COLUMN_WIDTH, 32 pixels
model.moveColumn("service", "time"); // before "time"; null puts it last
model.pinColumn("time", "left"); // or "right"; null unpins
model.setColumnVisible("service", false);

localStorage.layout = JSON.stringify(model.columns); // keep the user's layout
model.setColumns(JSON.parse(localStorage.layout));
```

- **Pointer.** Drag a header's edge to resize; drag the header to move it
  among columns pinned to the same side. Escape puts it back; a drag never
  sorts.
- **Keys on a focused header.** Shift+Left/Right moves the column;
  Alt+Left/Right resizes it by 16 pixels; Alt+Down, Shift+F10, or a right
  click opens its menu (move, resize, pin, unpin, hide, and show any
  column).
- **Pinned columns** show first (left) or last (right) and stay in place
  as the others scroll. They must leave the others 120 pixels
  (`MIN_SCROLLING_WIDTH`): `pinColumn` refuses a column without room
  (`model.canPin(id)` asks first). `setColumns` takes pins as given; in a
  grid too narrow for them, pinned columns scroll with the others until it
  widens.

## Linking a grid and a chart

A grid and a chart over one table, each with a view of its own: the grid's
selected rows restrict the chart, and the chart's brush filters the grid.

```ts
import { col, createChart, point, rowView, selectionStore } from "herceg";
import { createGrid, createGridModel } from "herceg/grid";

const store = selectionStore(requests);
const gridRows = rowView(requests);
const chartRows = rowView(requests);
createGrid(gridElement, { model: createGridModel({ data: gridRows, columns, selectionStore: store }), ariaLabel: "Requests" });
const chart = createChart(chartElement, {
  marks: [point(chartRows, { x: "time", y: "latency" })],
  interaction: { brush: "x" },
});

store.subscribe(() => {
  const picked = store.get("grid-rows");
  chartRows.restrict(picked?.kind === "rows" ? picked.rows : null); // none selected: all rows
});
chart.on("select", ({ x }) =>
  gridRows.setQuery({ ...gridRows.query, filter: x ? col("time").ge(x[0]).and(col("time").le(x[1])) : true }),
);
```

How they link is the application's choice; nothing filters automatically.
To highlight rather than filter, bind charts and the grid to one channel
instead ([Selected rows](interaction.md#selected-rows)).

## Grouped rows

Given [row groups](data.md#row-groups) as `groups`, the grid shows a
header row per group, followed when expanded by the groups of the level
below or, on the last level, by its rows.

```ts
import { bar, count, groupRows, mean, rowView } from "herceg";

const view = rowView(requests);
const traffic = groupRows(view, { by: ["region", "service"], ops: { n: count(), latency: mean("latency") } });
const model = createGridModel({
  data: view,
  groups: traffic,
  columns: [
    { field: "service" },
    { field: "region" },
    { field: "time" },
    { field: "latency", aggregate: "latency", format: { maximumFractionDigits: 1 } },
  ],
});
bar(traffic.tableOf("region"), { x: "region", y: "latency" }); // the same groups, charted
```

- A header names its group and counts its rows ("api (1,204)"), indented
  by level. A grouping field's column shows the key; a column with an
  `aggregate` shows the group's value.
- Groups start collapsed. `model.setExpanded(["eu", "api"], true)`,
  `expandAll()`, and `collapseAll()`; expansion is kept by key as rows
  stream and through resets.
- Clicking a header sorts each group's rows by its field, and groups among
  their siblings by the column's aggregate (or key, for grouping fields).
  `model.setGroupSort` orders groups by any field of the groups' tables.
- Selecting a header selects every row of the group the view shows; its
  checkbox is mixed when some are (`model.selectionState(i)`). Rows
  appended to a group later are not selected.
- `model.row(i)` tells a group header (`kind: "group"`) from a table row
  (`kind: "row"`); each has a `version` and a `ref` that
  `model.indexOf(ref)` finds again.

## Pivots

A [row pivot](data.md#row-pivots) shows in a grid from `herceg/grid/pivot`,
which grids without one never load.

```ts
import { createPivotGrid, createPivotGridModel } from "herceg/grid/pivot";

const model = createPivotGridModel({
  data: traffic,
  rowColumn: { title: "Region", width: 100 },
  aggregates: { latency: { title: "Latency (ms)", format: { maximumFractionDigits: 1 } } },
});
createPivotGrid(element, { model, ariaLabel: "Requests by region and service" });
model.pinColumn("region", "left");
```

- A row per pivot row; columns for the rows field, each value and
  aggregate, and the totals. With several aggregates, a header row of
  values spans their aggregates' columns.
- Absent combinations are blank; a missing key reads "(missing)".
- Generated columns take the usual commands by id, with full titles
  ("api, Latency (ms)") as their accessible names. A value streaming in
  later gets columns of its own without moving the columns in view.
- Clicking a header sorts the rows by its column (absent and missing last),
  without touching the view's order.
- Selecting a row selects its rows of the view, so a chart restricted to
  them shows them.
- A pivot that stopped at its limit says so in a notice under the grid.

## Remote grids

`herceg/grid/remote` shows rows that live elsewhere: a database behind an
API, or a table served from a worker. The page holds the rows in view and
a few around them; filters, sorts, and groups run where the data is.

```ts
import { createRemoteGrid, createRemoteGridModel } from "herceg/grid/remote";

const model = createRemoteGridModel({
  source,
  query: {
    filter: ["==", ["field", "status"], "error"],
    sort: [{ field: "time", order: "descending" }],
  },
  columns: [{ field: "time", format: { timeStyle: "medium" } }, { field: "service" }, { field: "latency" }],
});
createRemoteGrid(element, { model, ariaLabel: "Failed requests" });
```

**The query** (`GridQuery`) is plain JSON a server can run: a version (1),
the source's name, a filter (a portable expression, as `col(...)`
builds), sort keys, and optional groups with aggregates (`count`, `sum`,
`mean`, `min`, `max`). Layout and user state stay in the model.
`validateGridQuery(query, schema)` checks one and refuses unknown
properties. Its semantics are the local grid's: missing values sort last
both ways, labels by UTF-16 code units, ties by the source's key; times are
epoch ms, and queries cannot bin them.

**The source** (`GridSource`) has a `schema` (field kinds and a unique,
unchanging key field) and answers `rows(request, signal)`: `limit` rows or
groups from `offset` under a parent group's key path, as typed columns
(`Float64Array` numbers and times with NaN missing; categories as codes
into a window dictionary), with the total.

- **Snapshots.** A query's first request has `snapshot: null`; the answer
  names a snapshot later requests ask for, so rows do not shift between
  windows while data changes. The grid calls `release` for each snapshot
  it stops reading. A source that cannot keep one rejects with
  `GridSourceError("snapshot-expired")`.
- **Stale answers** (old revisions, windows, or groups no longer shown) are
  dropped and their requests aborted through `signal`.
- **`locate`**, if the source has it, lets the focus follow its record to a
  new query.

A source over HTTP, with the server sending columns as JSON arrays:

```ts
import { type GridSource, GridSourceError, type WindowColumn } from "herceg/grid/remote";

type Values = readonly (number | string | null)[];
const numbers = (values: Values) => Float64Array.from(values, (v) => (v === null ? Number.NaN : +v));
function labels(values: Values): WindowColumn {
  const dictionary = [...new Set(values.filter((v) => v !== null).map(String))];
  return { codes: Int32Array.from(values, (v) => (v === null ? -1 : dictionary.indexOf(String(v)))), dictionary };
}

const source: GridSource = {
  schema: {
    source: "requests",
    version: "3",
    fields: { id: "number", time: "time", service: "category", latency: "number" },
    key: "id",
  },
  async rows(request, signal) {
    const response = await fetch("/api/rows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    const body = await response.json();
    if (!response.ok) throw new GridSourceError(body.code ?? "unavailable", body.message);
    const kinds = this.schema.fields as Record<string, string>;
    const columns = Object.fromEntries(
      Object.entries(body.columns as Record<string, Values>).map(([field, values]) => [
        field,
        kinds[field] === "category" ? labels(values) : numbers(values),
      ]),
    );
    if (body.kind === "rows") return { ...body, columns };
    return { ...body, columns, rowCounts: numbers(body.rowCounts), childCounts: numbers(body.childCounts) };
  },
};
```

| Entry | Gives |
| --- | --- |
| `herceg/grid/memory` | `memorySource(table, { key: "id", latency: 20 })`: a source over a Herceg table that answers as a server would, for tests, trials, and workers. |
| `herceg/grid/conformance` | Fixtures a server must answer alike (missing values, string order, times, group sorts, pagination within a snapshot), and `checkGridSource(driver)` to run them. |

**Loading.** Rows not loaded are placeholders ("Loading…", `aria-busy`).
Failures are announced, with a notice offering to retry (`model.retry()`;
`model.refresh()` reads the query again). `model.status` says what is
loading, what failed, and what is cached.

| Model option | Default | Means |
| --- | --- | --- |
| `blockSize` | 128 | Rows per request. |
| `maxRequests` | 2 | Requests at a time. |
| `cachedBlocks`, `cacheBytes` | 16, 8 MiB | Blocks kept besides those in view. |
| `settleDelay` | 50 ms | Wait while a scrollbar is dragged far (asking at least every 150 ms). |
| `maxExpanded` | 256 | Groups expanded at once. |

**Selections** are keys or conditions, never positions, in a
`RemoteSelectionStore` (`remoteSelectionStore(schema)`): clicks select by
key; Shift ranges need every row between loaded; Ctrl+A selects the
query's filter as a condition; a group header selects rows matching the
group. `selectionCondition(selection, key)` turns a selection into a filter
a server can run; `model.selectedCount` is null for conditions.

**Groups** are asked for as they expand (`setExpanded(key, true)`); headers
read row counts and aggregates from the source (a column's `aggregate`
naming the query's `as`). There is no `expandAll`.

## Accessibility

- A grid is one tab stop (`role="grid"`; `role="treegrid"` when grouped).
  Arrows, Page Up/Down, Home/End, and Ctrl+Home/End move the focus,
  scrolling the cell into view.
- Space toggles the focused row's selection, Shift+arrows extend it,
  Ctrl+A (Cmd+A) selects every row, Escape clears; Enter or Space on a
  header sorts by it.
- In grouped grids, a row's first cell stands for the row: Right expands,
  Left collapses or goes to the parent group; Enter on any header cell
  toggles it.
- Sorting, selecting, and column changes are announced. Rows say their
  index and selection; grouped rows their level and place.
- Forced-colors mode uses system colors.

## In React

`<Grid>` from `@herceg/react/grid` shows a model the application makes and
owns; data, scrolling, focus, selection, sorting, and column layout go
through the model, never through React.

```tsx
import { rowView } from "herceg";
import { createGridModel } from "herceg/grid";
import { Grid } from "@herceg/react/grid";

function Requests({ data }: { data: typeof requests }) {
  const model = useMemo(
    () => createGridModel({ data: rowView(data), columns: [{ field: "time" }, { field: "latency" }] }),
    [data],
  );
  return <Grid model={model} ariaLabel="Requests" style={{ height: 400 }} />;
}
```

A new `model` makes a new grid; `ariaLabel`, `theme`, and `headerHeight`
change in place. A model no one keeps stops following its view, so one
made with `useMemo` needs no cleanup. Vue and Svelte have no grid
component; call `createGrid` on an element.

## Limits

- Rows have one height (`rowHeight`, 28 pixels by default); columns have
  explicit widths. Rows taller together than 8 million pixels scroll
  scaled (a pixel scrolled moves more than one).
- Not available: column groups other than a pivot's values, sizing columns
  to content, moving columns by touch (the menu moves them), custom cell
  content, editing, and copying. Remote grids have no pivots and no bins
  in queries.
- Only mounted rows are in the DOM, so text selection, the browser's find,
  and screen readers reach only those. Announcements are in English, and
  grids have not been tried with screen readers themselves.
- Firefox drops the levels of grouped rows (it ignores `aria-level` in
  grids that number their rows).
- Grids are not part of the portable spec, so Python and payloads do not
  carry them.

Benchmarks against TanStack Table, AG Grid, and Glide Data Grid are in the
[comparison](../comparison.md#grids).
