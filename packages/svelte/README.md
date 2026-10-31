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
- **Tooltips** of your own render in a `renderTooltip` snippet.
- **Errors** show in the chart's place, or with `errorMode="throw"` are
  thrown to the nearest `<svelte:boundary>`.
- **Server rendering**: `initial={hydration(snapshot)}` adopts markup from
  `renderToSnapshot` without drawing again.

## Documentation

- [React, Vue, and Svelte](https://github.com/op55-org/herceg/blob/main/docs/guide/frameworks.md): the full guide
  to the adapters
- [Getting started](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md) and the
  [documentation index](https://github.com/op55-org/herceg/blob/main/docs/README.md)

## License

MIT
