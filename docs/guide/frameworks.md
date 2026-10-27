# React, Vue, and Svelte

`@herceg/react`, `@herceg/vue` (Vue 3), and `@herceg/svelte` (Svelte 5) are
thin adapters over the same engine: a `<Chart>` component whose props are
the chart's options and whose children are mark components. Data updates
bypass the framework entirely.

- [A chart](#a-chart)
- [Marks as components](#marks-as-components)
- [Events and the chart handle](#events-and-the-chart-handle)
- [Live data](#live-data)
- [Layouts](#layouts)
- [Tooltips](#tooltips)
- [When a chart cannot draw](#when-a-chart-cannot-draw)
- [Server rendering](#server-rendering)
- [Grids](#grids)

## A chart

```tsx
// React
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

```vue
<!-- Vue -->
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

```svelte
<!-- Svelte -->
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

- `<Chart>` takes every [chart option](getting-started.md#chart-options)
  as a prop (`title`, `x`, `y`, `legend`, `scales`, `guides`, `tooltip`,
  `interaction`, `navigator`, `renderer`, `theme`, `fonts`, `width`,
  `height`, ...). Vue also takes kebab-case (`:stroke-width="2"`) and bare
  boolean attributes (`<Area stack />`).
- The chart fills its container's width and is 320 px tall unless `width`,
  `height`, or a style says otherwise.
- **Props are the whole configuration**: removing a prop restores its
  default. They are compared on each render; when neither options nor any
  mark's spec or table changed, the chart is left alone, so inline objects
  are fine. Functions in options (formatters, tick generators) are compared
  by identity, so define them once.

## Marks as components

Every mark has a component, named as its function: `Line`, `Area`, `Bar`,
`Point`, `Rug`, `Heatmap`, `Contour`, `ErrorBar`, `Candlestick`,
`Histogram`, `BoxPlot`, `Boxen`, `Violin`, `Dendrogram`, `Pie`, `Treemap`,
`Sunburst`, `Gauge`, `Funnel`, `Radar`, `Sankey`, `Graph`, `GeoShape`,
`GeoPoint`, `Point3D`, `Line3D`, `Surface`, `Rule`, `Region`, `Text`, and
`Custom`. Their props are the [mark's options](marks.md).

- Each takes the table it reads as `data`, so the type checker (tsc,
  vue-tsc, svelte-check) checks field names against its columns. `Graph`
  takes links as `data` and nodes as `nodes`.
- Annotations (`Rule`, `Region`, `Text`) take `data` only when they draw
  an item per row: `<Rule data={deploys} x="time" label={{ field: "version" }} />`.
- Marks built with herceg's functions can be passed as a `marks` prop.
- **Where marks may sit.** The chart reads its children's props; it does
  not render them. React and Vue take marks in fragments, arrays, `v-if`,
  and `v-for`, but not inside components of your own (React throws).
  Svelte also takes them in `{#if}`, `{#each}`, and components of your own.
  To reuse a group of marks, build them with herceg's functions and pass
  them as `marks`, or in React call a function returning elements.

```tsx
<Chart title="Checkout" marks={[line(checkout, { x: "time", y: "p50" }), rule({ y: 250 })]} />
```

- **Custom marks** draw outside the framework's dependency tracking: in
  Vue, return `draw` from a `computed` that reads the reactive values it
  needs; in Svelte, rebuild the mark with `{#key}` when its state changes.

## Events and the chart handle

| | React | Vue | Svelte |
| --- | --- | --- | --- |
| Events | `onViewport`, `onSelect`, `onHover`, `onClick`, `onEdge`, `onRowSelection`, `onCamera`, `onDrill`, `onItemMove`, `onVisibility`, `onRender`, `onError` | `@viewport`, `@select`, `@hover`, `@click`, `@edge`, `@row-selection`, `@camera`, `@drill`, `@item-move`, `@visibility`, `@render`, `@error` | `onviewport`, `onselect`, `onhover`, `onclick`, `onedge`, `onrowselection`, `oncamera`, `ondrill`, `onitemmove`, `onvisibility`, `onrender`, `onerror` |
| The chart handle | `ref` | template ref's `.chart` (null until mounted) | `bind:chart` (null until mounted) |

The events are the engine's ([Events](interaction.md#events)); the latest
handler is called, so inline functions do not resubscribe. The handle is
herceg's `Chart`, for `setViewport`, `select`, `toPixel`, `setVisibility`,
`toSVG`, `toPNG`, `renderToPDF(chart)`, `renderToImage(chart)`, and the
rest ([Getting started](getting-started.md#the-chart-handle)).

```vue
<script setup lang="ts">
import { shallowRef, useTemplateRef } from "vue";

const view = useTemplateRef("view");
const range = shallowRef<readonly [number, number] | null>(null);
const exportSvg = () => view.value?.chart?.toSVG();
</script>

<template>
  <Chart ref="view" :interaction="{ brush: 'x' }" @select="({ x }) => (range = x)">
    <Line :data="metrics" x="time" y="p50" />
  </Chart>
</template>
```

A `rowSelection` binding made again each render is the same binding while
it binds the same stores and channels, so it neither updates nor
resubscribes the chart.

## Live data

Mark components never create an element per data point, and data updates
do not go through the framework. Keep the table outside reactive state and
change it directly; the chart draws on the next animation frame,
coalescing any number of changes.

```tsx
function Live() {
  const data = useMemo(() => table({ time: time([]), cpu: [] as number[] }, { maxRows: 3_000 }), []);
  useEffect(() => {
    const timer = setInterval(() => data.appendRow({ time: Date.now(), cpu: readCpu() }), 100);
    return () => clearInterval(timer);
  }, [data]);
  return (
    <Chart>
      <Line data={data} x="time" y="cpu" />
    </Chart>
  );
}
```

| | Keep the table in | Note |
| --- | --- | --- |
| React | Module scope, a ref, or `useMemo` | Changes apply in the layout phase, so a parent's layout effect can read them through `ref`. |
| Vue | A plain `const`, `shallowRef`, or `markRaw` | Tables keep private fields that deep proxies cannot reach: the chart unwraps a table given through `ref()` or `reactive()`, but `appendRow` on the proxy fails. Arrays and objects in props are copied, so changing reactive state in place updates the chart. |
| Svelte | A plain variable | `$state` does not proxy class instances. Each mark component renders one empty `<template>` to keep template order. Invalid props throw to the nearest `<svelte:boundary>`. |

See [Changing data and streaming](data.md#changing-data-and-streaming) for
the table's methods.

## Layouts

`@herceg/react/layout`, `@herceg/vue/layout`, and `@herceg/svelte/layout`
write a chart's [subplots](layout.md#subplots) as the tree they make:
`Columns` and `Rows` with relative `weights`, `Grid` of `rows` and
`columns` holding `Cell`s, `Panel` (whose props are its settings and
whose marks draw in it), and `Inset` inside a panel. `Legend` from the
`/guides` entry inside a panel is that panel's own legend.

```tsx
import { Bar, Chart, Line, Pie } from "@herceg/react";
import { Legend } from "@herceg/react/guides";
import { Columns, Inset, Panel, Rows } from "@herceg/react/layout";

<Chart height={600}>
  <Columns weights={[2, 1]}>
    <Rows weights={[2, 1]}>
      <Panel id="latency" title="p99">
        <Line data={data} x="time" y="p99" color="region" />
        <Legend place={{ inside: "top-left" }} />
        <Inset id="detail" x={{ domain: [start, end] }} indicator>
          <Line data={data} x="time" y="p99" color="region" />
        </Inset>
      </Panel>
      <Panel id="errors" title="Errors">
        <Bar data={data} x="time" y="errors" color="region" />
      </Panel>
    </Rows>
    <Panel id="share" title="By region">
      <Pie data={data} category="region" value="requests" />
    </Panel>
  </Columns>
</Chart>
```

- Refused: a mark in a panel naming another panel, a second layout element
  beside the first, `Cell` outside a `Grid`, `Inset` outside a panel, and
  layout elements together with the `panels` prop.
- Marks beside the layout element name their panel (`panel="*"` draws in
  all).
- 3D marks take `panel` to share a [3D subplot](three-dimensional.md)
  beside other panels; pass `panels(...)` with a `camera` per panel.
- React's layout `Grid` and the data grid's `Grid` share a name; import one
  under another name where a module uses both.

## Tooltips

Marks take `tooltip={{ fields: [...] }}`, and axes `tooltipFormat`, as in
the engine ([Tooltips](interaction.md#tooltips)). For content of your own,
each framework renders its own component in the chart's tooltip box, which
keeps its placement, crosshair, and keyboard announcements. Only the
content for what the tooltip is at renders, when that changes.

```tsx
// React: renderTooltip returns React content, rendered with the app's context
<Chart renderTooltip={(inspection) => <LatencyTip point={inspection.points[0]} />}>
  <Line data={latency} x="time" y="p99" tooltip={{ fields: ["requests"] }} />
</Chart>
```

```vue
<!-- Vue: the renderTooltip slot -->
<Chart>
  <Line :data="latency" x="time" y="p99" :tooltip="{ fields: ['requests'] }" />
  <template #renderTooltip="{ inspection }">
    <LatencyTip :point="inspection.points[0]" />
  </template>
</Chart>
```

```svelte
<!-- Svelte: the renderTooltip snippet -->
<Chart>
  <Line data={latency} x="time" y="p99" tooltip={{ fields: ["requests"] }} />
  {#snippet renderTooltip(inspection)}
    <LatencyTip point={inspection.points[0]} />
  {/snippet}
</Chart>
```

## When a chart cannot draw

A refused mark or prop, code that fails to load, or a frame that fails on
new data shows in the chart's place as the engine shows it
([Errors](getting-started.md#when-a-chart-cannot-draw)), and the error
event hears of each `ChartError`. With `errorMode="throw"` (Vue
`error-mode="throw"`), the chart shows nothing and throws in render, for
the framework's error handling:

```tsx
// React: an error boundary
<ErrorBoundary fallback={<p>Latency is unavailable</p>}>
  <Chart errorMode="throw" onError={(error) => report(error.code, error.path)}>
    <Line data={metrics} x="time" y="p99" color="region" />
  </Chart>
</ErrorBoundary>
```

```svelte
<!-- Svelte: a boundary -->
<svelte:boundary>
  <Chart errorMode="throw" onerror={(error) => report(error.code, error.path)}>
    <Line data={metrics} x="time" y="p99" color="region" />
  </Chart>
  {#snippet failed(error)}<p>Latency is unavailable</p>{/snippet}
</svelte:boundary>
```

Vue throws for a parent's `onErrorCaptured` or the app's `errorHandler`.

## Server rendering

`initial` takes a [snapshot](export.md#server-rendering) from
`renderToSnapshot` (or Python's `to_snapshot`) passed through
`hydration(snapshot)` from `herceg`, which brings the adoption code, so
pages that never hydrate carry none of it. The server render and the first
browser render write the snapshot's markup, so hydration finds no
mismatch; the chart then takes the markup over without drawing again.
Give `renderToSnapshot` the same options at the size the chart will have;
marks built with herceg's functions and passed as `marks` are the simplest
to share.

```tsx
// Server (a route's loader):
const marks = [line(metrics, { x: "time", y: ["p50", "p99"] })];
const initial = renderToSnapshot({ title: "Request latency", marks }, { width: 640, height: 320, idPrefix: "latency" });

// Component, rendered on the server and hydrated in the browser:
<Chart title="Request latency" marks={marks} width={640} height={320} initial={hydration(initial)} />;
```

`initial` is read when the chart mounts; later values are not. Tested with
React's `renderToString` and `hydrateRoot` (strict mode mounts afresh the
second time), Vue's `renderToString` and `createSSRApp` (as Nuxt does),
and Svelte's server render and `hydrate` (as SvelteKit does).

## Grids

React has `<Grid>` in `@herceg/react/grid`; Vue and Svelte call
`createGrid` on an element. See [Grids](grids.md#in-react).
