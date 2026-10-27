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

## In brief

- **Props are options**, in camelCase or kebab-case, with bare boolean
  attributes (`<Area stack />`). Removing a prop restores its default.
- **Marks read `data`**, so vue-tsc checks field names against the
  table's columns. Marks may sit in `v-if` and `v-for`, not in components
  of your own; pass reusable groups as `marks`.
- **Live data.** Keep the table in a plain `const`, `shallowRef`, or
  `markRaw` (deep proxies cannot reach its private fields) and change it
  directly: `data.appendRow(...)` draws on the next frame.
- **Events** are Vue events (`@select`, `@viewport`, `@hover`, `@click`,
  ...); a template ref's `chart` is herceg's chart handle.
- **Tooltips** of your own render in the `renderTooltip` slot.
- **Errors** show in the chart's place, or with `error-mode="throw"` are
  thrown for `onErrorCaptured` or the app's `errorHandler`.
- **Server rendering**: `:initial="hydration(snapshot)"` adopts markup
  from `renderToSnapshot` without drawing again.

## Documentation

- [React, Vue, and Svelte](https://github.com/op55-org/herceg/blob/main/docs/guide/frameworks.md): the full guide
  to the adapters
- [Getting started](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md) and the
  [documentation index](https://github.com/op55-org/herceg/blob/main/docs/README.md)

## License

MIT
