# @herceg/svelte

Svelte 5 components for [Herceg](https://github.com/op55-org/herceg)
charts: a `<Chart>` whose props are the chart's options and whose
children are mark components. Data updates bypass Svelte, and no element is
made per data point.

> Not yet published to npm. Build it from a checkout
> ([Install](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md#install)). Needs Svelte 5.29.

```svelte
<script lang="ts">
  import { Chart, Line, Rule } from "@herceg/svelte";
  import { table, time } from "herceg";

  const metrics = table({ time: time(timestamps), p50, p99 });
</script>

<Chart title="Request latency" y={{ title: "ms" }} interaction={{ zoom: true }}>
  <Line data={metrics} x="time" y={["p50", "p99"]} />
  <Rule y={250} label="SLO" />
</Chart>
```

## Entry points

| Import | Gives |
| --- | --- |
| `@herceg/svelte` | `Chart` and a component per mark (`Line`, `Area`, `Bar`, `Point`, `Heatmap`, `Pie`, `Graph`, `GeoShape`, `Surface`, `Rule`, `Custom`, ...) |
| `@herceg/svelte/layout` | `Columns`, `Rows`, `Grid`, `Cell`, `Panel`, `Inset` for subplots |
| `@herceg/svelte/guides` | `Legend`, a panel's own legend |
| `@herceg/svelte/grid` | `Grid`, the data grid over a `herceg/grid` model, with Svelte cells |
| `@herceg/svelte/grid/remote` | `RemoteGrid`, over a remote grid model, with Svelte cells |
| `@herceg/svelte/grid/pivot` | `PivotGrid`, over a pivot grid model |

## In brief

- **Props are options.** Removing a prop restores its default; unchanged
  options and marks leave the chart alone.
- **Marks read `data`**, so svelte-check checks field names against the
  table's columns. Marks may sit in `{#if}`, `{#each}`, and components of
  your own.
- **Live data.** Keep the table in a plain variable and change it
  directly: `data.appendRow(...)` draws on the next frame.
- **Events** are callback props (`onselect`, `onviewport`, `onhover`,
  `onclick`, `oncontextmenu`, ...); `bind:chart` gives herceg's chart handle.
  What `onhover` changes in a table or through the handle draws in the
  pointer's frame.
- **State** binds with `bind:selection`, `bind:viewport`, `bind:visibility`,
  and `bind:drillRoot`.
- **Tooltips** of your own render in a `renderTooltip` snippet; a tree
  node's point carries its path (`point.names`).
- **Anchors**: `<Anchor at={{ x, y }} side="top">` among the chart's
  children holds its children at a place in the data, moving with every
  frame and hidden out of view, with your component's contexts.
- **Errors** show in the chart's place, or with `errorMode="throw"` are
  thrown to the nearest `<svelte:boundary>`.
- **Server rendering**: `initial={hydration(snapshot)}` adopts markup from
  `renderToSnapshot` without drawing again.
- **Grids** take a model the application owns; data and scrolling bypass
  Svelte. `cells={{ status }}`, a snippet of the cell, draws a column's
  cells with Svelte components, each mounted with your component's
  contexts: each cell's state is its row's, a cell that throws draws its
  text, and cells commit before the grid paints, at about 15 KB a mounted
  cell. Type a snippet's parameter with the model's schema
  (`cell: GridCellContext<Services>`). `onselect` hears every change of
  the selection with its cause (a click, keys, the model's methods, or
  another writer), before `onrowclick`.

## Documentation

- [React, Vue, and Svelte](https://github.com/op55-org/herceg/blob/main/docs/guide/frameworks.md): the full guide
  to the adapters
- [Getting started](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md) and the
  [documentation index](https://github.com/op55-org/herceg/blob/main/docs/README.md)
- [Grids](https://github.com/op55-org/herceg/blob/main/docs/guide/grids.md#in-react-vue-and-svelte)

## License

MIT
