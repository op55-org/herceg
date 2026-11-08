# @herceg/vue

Vue 3 components for [Herceg](https://github.com/op55-org/herceg) charts:
a `<Chart>` whose props are the chart's options and whose slot holds mark
components. Data updates bypass Vue, and no component is made per data
point.

> Not yet published to npm. Build it from a checkout
> ([Install](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md#install)). Needs Vue 3.5.

```vue
<script setup lang="ts">
import { Chart, Line, Rule } from "@herceg/vue";
import { table, time } from "herceg";

const metrics = table({ time: time(timestamps), p50, p99 });
</script>

<template>
  <Chart title="Request latency" :y="{ title: 'ms' }" :interaction="{ zoom: true }">
    <Line :data="metrics" x="time" :y="['p50', 'p99']" />
    <Rule :y="250" label="SLO" />
  </Chart>
</template>
```

## Entry points

| Import | Gives |
| --- | --- |
| `@herceg/vue` | `Chart` and a component per mark (`Line`, `Area`, `Bar`, `Point`, `Heatmap`, `Pie`, `Graph`, `GeoShape`, `Surface`, `Rule`, `Custom`, ...) |
| `@herceg/vue/layout` | `Columns`, `Rows`, `Grid`, `Cell`, `Panel`, `Inset` for subplots |
| `@herceg/vue/guides` | `Legend`, a panel's own legend |
| `@herceg/vue/grid` | `Grid`, the data grid over a `herceg/grid` model, with Vue cells |
| `@herceg/vue/grid/remote` | `RemoteGrid`, over a remote grid model, with Vue cells |
| `@herceg/vue/grid/pivot` | `PivotGrid`, over a pivot grid model |

## In brief

- **Props are options**, in camelCase or kebab-case, with bare boolean
  attributes (`<Area stack />`). Removing a prop restores its default.
- **Marks read `data`**, so vue-tsc checks field names against the
  table's columns. Marks may sit in `v-if` and `v-for`, not in components
  of your own; pass reusable groups as `marks`.
- **Live data.** Keep the table in a plain `const`, `shallowRef`, or
  `markRaw` (deep proxies cannot reach its private fields) and change it
  directly: `data.appendRow(...)` draws on the next frame.
- **Events** are Vue events (`@select`, `@viewport`, ...); input events
  (`@hover`, `@click`, `@context-menu`) are listener props, which the chart
  listens for only while given. A template ref's `chart` is herceg's chart
  handle.
- **State** binds with `v-model:selection`, `v-model:viewport`,
  `v-model:visibility`, and `v-model:drill-root`.
- **Tooltips** of your own render in the `renderTooltip` slot.
- **Errors** show in the chart's place, or with `error-mode="throw"` are
  thrown for `onErrorCaptured` or the app's `errorHandler`.
- **Server rendering**: `:initial="hydration(snapshot)"` adopts markup
  from `renderToSnapshot` without drawing again.
- **Grids** take a model the application owns (a plain `const` or
  `shallowRef`); data and scrolling bypass Vue. A scoped slot
  (`<template #cell-status="{ cell }">`) or a render function in `cells`
  draws a column's cells with Vue components, through teleports that keep
  `provide` and `inject`: each cell's state is its row's, a cell that
  throws draws its text, and cells commit before the grid paints, at
  about 15 KB a mounted cell. `h()` takes the generic `Grid` cast as
  `Component`; templates and TSX infer its model's schema. `@select` hears
  every change of the selection with its cause (a click, keys, the
  model's methods, or another writer), before `@row-click`.

## Documentation

- [React, Vue, and Svelte](https://github.com/op55-org/herceg/blob/main/docs/guide/frameworks.md): the full guide
  to the adapters
- [Getting started](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md) and the
  [documentation index](https://github.com/op55-org/herceg/blob/main/docs/README.md)
- [Grids](https://github.com/op55-org/herceg/blob/main/docs/guide/grids.md#in-react-vue-and-svelte)

## License

MIT
