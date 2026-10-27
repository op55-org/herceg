# @herceg/react

React components for [Herceg](https://github.com/op55-org/herceg) charts:
a `<Chart>` whose props are the chart's options and whose children are
mark elements. Data updates bypass React, and no element is made per data
point.

> Not yet published to npm. Build it from a checkout
> ([Install](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md#install)). Needs React 19.

```tsx
import { Chart, Line, Rule } from "@herceg/react";
import { table, time } from "herceg";

const metrics = table({ time: time(timestamps), p50, p99 });

export function Latency() {
  return (
    <Chart title="Request latency" y={{ title: "ms" }} interaction={{ zoom: true }}>
      <Line data={metrics} x="time" y={["p50", "p99"]} />
      <Rule y={250} label="SLO" />
    </Chart>
  );
}
```

## Entry points

| Import | Gives |
| --- | --- |
| `@herceg/react` | `Chart` and a component per mark (`Line`, `Area`, `Bar`, `Point`, `Heatmap`, `Pie`, `Graph`, `GeoShape`, `Surface`, `Rule`, `Custom`, ...) |
| `@herceg/react/layout` | `Columns`, `Rows`, `Grid`, `Cell`, `Panel`, `Inset` for subplots |
| `@herceg/react/guides` | `Legend`, a panel's own legend |
| `@herceg/react/grid` | `Grid`, the data grid over a `herceg/grid` model |

## In brief

- **Props are options.** `<Chart>` takes every chart option as a prop;
  removing a prop restores its default. Unchanged options and marks leave
  the chart alone, so inline objects are fine.
- **Marks read `data`.** Each mark element takes its table as `data`, so
  TypeScript checks field names against its columns.
- **Live data.** Keep the table outside render (`useMemo`, a ref, module
  scope) and change it directly: `data.appendRow(...)` draws on the next
  frame without rendering React.
- **Events** are props (`onSelect`, `onViewport`, `onHover`, `onClick`,
  ...); a `ref` gives herceg's chart handle for `setViewport`, `toSVG`,
  and the rest.
- **Tooltips** of your own: `renderTooltip` returns React content,
  rendered with your app's context in the chart's tooltip box.
- **Errors** show in the chart's place, or with `errorMode="throw"` are
  thrown in render for an error boundary.
- **Server rendering**: `initial={hydration(snapshot)}` adopts markup from
  `renderToSnapshot` without drawing again.
- Mark elements cannot sit inside components of your own; pass reusable
  groups as `marks` or return them from a function.

## Documentation

- [React, Vue, and Svelte](https://github.com/op55-org/herceg/blob/main/docs/guide/frameworks.md): the full guide
  to the adapters
- [Getting started](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md) and the
  [documentation index](https://github.com/op55-org/herceg/blob/main/docs/README.md)
- [Grids](https://github.com/op55-org/herceg/blob/main/docs/guide/grids.md#in-react)

## License

MIT
