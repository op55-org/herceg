# React, Vue, and Svelte

`@herceg/react`, `@herceg/vue` (Vue 3), and `@herceg/svelte` (Svelte 5) are
thin adapters over the same engine: a `<Chart>` component whose props are
the chart's options and whose children are mark components. Data updates
bypass the framework entirely.

- [A chart](#a-chart)
- [Marks as components](#marks-as-components)
- [Events and the chart handle](#events-and-the-chart-handle)
- [Chart state](#chart-state)
- [Live data](#live-data)
- [Layouts](#layouts)
- [Tooltips](#tooltips)
- [Anchors](#anchors)
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
  takes links as `data` and nodes as `nodes`. Series marks (`Line`,
  `Area`, `Bar`, `Point`, `Rug`, `Heatmap`, `ErrorBar`, `Candlestick`,
  `Histogram`, `BoxPlot`, `Boxen`, `Violin`) also take a
  [row view](data.md#row-views) of a table, checked against its columns
  alike: `<Histogram data={rowView(flights, { filter })} x="distance" />`.
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
| Events | `onViewport`, `onSelect`, `onHover`, `onClick`, `onContextMenu`, `onEdge`, `onRowSelection`, `onCamera`, `onDrill`, `onItemMove`, `onPin`, `onVisibility`, `onRender`, `onError` | `@viewport`, `@select`, `@hover`, `@click`, `@context-menu`, `@edge`, `@row-selection`, `@camera`, `@drill`, `@item-move`, `@pin`, `@visibility`, `@render`, `@error` | `onviewport`, `onselect`, `onhover`, `onclick`, `oncontextmenu`, `onedge`, `onrowselection`, `oncamera`, `ondrill`, `onitemmove`, `onpin`, `onvisibility`, `onrender`, `onerror` |
| The chart handle | `ref` | template ref's `.chart` (null until mounted) | `bind:chart` (null until mounted) |

The events are the engine's ([Events](interaction.md#events)); the latest
handler is called, so inline functions do not resubscribe. A chart listens
for `hover`, `click`, and `contextMenu` only while a handler is given: only
then does it load what reads what input is on, and, for `contextMenu`, keep
the browser's menu off its plots. In Vue these three are props
(`@hover`, `@click`, and `@context-menu` pass `onHover`, `onClick`, and
`onContextMenu`), so event modifiers such as `.once` do not apply to them.
The handle is
herceg's `Chart`, for `setViewport`, `select`, `toPixel`, `setVisibility`,
`toSVG`, `toPNG`, `renderToPDF(chart)`, `renderToImage(chart)`, and the
rest ([Getting started](getting-started.md#the-chart-handle)).

```vue
<script setup lang="ts">
import type { SelectEvent } from "herceg";
import { shallowRef, useTemplateRef } from "vue";

const view = useTemplateRef("view");
const range = shallowRef<readonly [number, number] | null>(null);
const exportSvg = () => view.value?.chart?.toSVG();
const brushed = ({ selection, phase }: SelectEvent) => {
  if (phase === "commit") range.value = selection?.kind === "brush" ? selection.x : null;
};
</script>

<template>
  <Chart ref="view" :interaction="{ brush: 'x' }" @select="brushed">
    <Line :data="metrics" x="time" y="p50" />
  </Chart>
</template>
```

A `rowSelection` binding made again each render is the same binding while
it binds the same stores and channels, so it neither updates nor
resubscribes the chart.

## Chart state

The chart's [state options](interaction.md#chart-state), `selection`,
`viewport`, `visibility`, and `drillRoot`, are props. A state prop sets
the chart's state when its value changes (by value), and the user's input
changes it too: writing what the chart reports back into the prop
changes nothing and never loops. When only state props change, the chart
is told of those alone, and neither rebuilds nor redraws its marks.

```tsx
function Explorer() {
  const [selection, setSelection] = useState<ChartSelection | null>(null);
  const [viewport, setViewport] = useState<ViewportState>();
  return (
    <Chart
      interaction={{ brush: "x", zoom: "x" }}
      selection={selection}
      viewport={viewport}
      onSelect={(event) => event.phase === "commit" && setSelection(event.selection)}
      onViewport={(event) => setViewport(event.state)}
    >
      <Line data={metrics} x="time" y="p50" />
    </Chart>
  );
}
```

```vue
<Chart v-model:selection="selection" v-model:viewport="viewport" :interaction="{ brush: 'x', zoom: 'x' }">
  <Line :data="metrics" x="time" y="p50" />
</Chart>
```

```svelte
<Chart bind:selection bind:viewport interaction={{ brush: "x", zoom: "x" }}>
  <Line data={metrics} x="time" y="p50" />
</Chart>
```

Vue's `v-model:selection`, `v-model:viewport`, `v-model:visibility`, and
`v-model:drill-root`, and Svelte's `bind:` of the same props, follow each
change as it commits; a brush's previews come as `select` events. In
React, keep previews out of state that re-renders the page: they arrive
once a frame while a brush moves.

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
content for what the tooltip is at renders, when that changes. Content
renders only of an inspection of the marks and data rendered now: when a
render replaces a table (a filter) or a table changed in place, the box
stays empty until the chart inspects the new data, on its next frame, so
`table.value(field, inspection.points[0].row)` always reads a row of the
table it names.

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

## Anchors

`<Anchor>` holds its content at a place in the chart's data, moving it with
every frame and hiding it while the place is out of view, as the engine's
`anchor` does ([Anchors](interaction.md#anchors)): its props are
`anchor`'s options. It goes among the chart's children; inside a `<Panel>`
or an `<Inset>`, it is in that panel. Changing its props moves it from the
next frame; unmounting it removes it. Its content is the framework's, with
the application's context: React renders it through a portal, Vue
teleports the slot, and Svelte renders the children into the element the
chart holds. `<Anchor>` imports the engine's anchors, so an application
that uses only `<Chart>` does not load them.

```tsx
// React
<Chart onClick={({ target }) => setOpen(target?.kind === "item" ? target.item : null)}>
  <Region data={incidents} id="downtime" x1="start" x2="end" itemKey="id" />
  {open && (
    <Anchor at={{ item: open }} side="top" align="start">
      <IncidentCard id={open} />
    </Anchor>
  )}
</Chart>
```

```vue
<!-- Vue -->
<Chart :interaction="{ zoom: 'x' }">
  <Line :data="metrics" x="time" y="latency" />
  <Anchor :at="{ x: peak.time, y: peak.value }" side="top" :offset="8">
    <button @click="investigate">Investigate</button>
  </Anchor>
</Chart>
```

```svelte
<!-- Svelte -->
<Chart interaction={{ zoom: "x" }}>
  <Line data={metrics} x="time" y="latency" />
  <Anchor at={{ x: peak.time, y: peak.value }} side="top" offset={8}>
    <button onclick={investigate}>Investigate</button>
  </Anchor>
</Chart>
```

React's and Vue's `<Anchor>` render nothing on the server and in the first
render of a hydrated chart; Svelte's renders its children hidden, with the
chart's other children, until the chart holds them.

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

Each adapter has `<Grid>` in `/grid` (`@herceg/react/grid`,
`@herceg/vue/grid`, `@herceg/svelte/grid`), `<RemoteGrid>` in
`/grid/remote`, and `<PivotGrid>` in `/grid/pivot`, each over a model the
application makes. Their props are the same: `model`, `ariaLabel`,
`theme`, `headerHeight`, `copy`, and `cells`, with the grid's events as
each framework hears them. See [Grids](grids.md#in-react-vue-and-svelte).

```tsx
// React
import { Grid } from "@herceg/react/grid";

<Grid
  model={model}
  ariaLabel="Services"
  cells={{
    trend: { fields: ["service"], render: (cell) => <Sparkline service={cell.read("service")} /> },
  }}
/>;
```

```vue
<!-- Vue -->
<Grid :model="model" aria-label="Services" :cells="{ trend: { fields: ['service'] } }">
  <template #cell-trend="{ cell }"><Sparkline :service="cell.read('service')" /></template>
</Grid>
```

```svelte
<!-- Svelte -->
{#snippet trend(cell: GridCellContext<Services>)}
  <Sparkline service={cell.read("service")} />
{/snippet}

<Grid {model} ariaLabel="Services" cells={{ trend: { fields: ["service"], render: trend } }} />
```

`<Grid>` and `<RemoteGrid>` take `cells`, framework cells by column id:
React and Vue render functions of the cell, or Svelte snippets, or `{
render, fields, interaction }`. In Vue a scoped slot `#cell-<id>="{ cell
}"` draws a column too, `cells` then giving only its `fields` and
`interaction`; a column drawn by both, or a slot for no column, is an
error naming them. `fields` and `read` take only names the model has, and
`read` gives each field's kind.

- **Where they render.** Each cell renders into the element the grid
  gives it, inside the component's tree: React through a portal, Vue
  through a teleport, Svelte mounted with the component's contexts
  (`getAllContexts`). Providers, `provide` and `inject`, and `setContext`
  reach cells. Only mounted cells render; built-in cells, data changes,
  and scrolling never go through the framework.
- **State.** A cell's component is its row's: it keeps its state while the
  cell shows that row (as the row's selection or values change) and
  mounts again when the cell's element shows another row, as scrolling
  recycles elements. Keep state that must outlive scrolling outside the
  cell.
- **When they commit.** The grid's first frame commits its cells before
  the page paints: in React's layout effect that makes the grid, in Vue's
  flush after the component mounts, and in Svelte's effect that makes it.
  Later frames commit theirs before the page paints: React and Svelte at
  once (`flushSync`) in the grid's own animation frame, before it places
  the focus; Vue in the microtask after the frame's callback, after the
  grid placed the focus, and a focused control cell's acknowledgement then
  moves it into the control. A cell whose row changed shows its text until
  its content commits, never another row's content.
  The render event hears of the first frame once its cells are committed,
  and of the grid's own frames after their commits; a frame drawn by a
  call (`render()`, `focusCell`, from an effect or a handler) is heard at
  once (in Vue, once a commit still pending is done), and its cells
  commit in the grid's next frame.
- **Reading the row.** Read fields in the render function, slot, or
  snippet (`cell.read("service")`), which runs again with each update. An
  update is superseded (`cell.signal`) by the next, or by a draw called
  from code, which hands the next over in the grid's next frame. After
  that, a React cell's `read` throws, and React leaves the cell as it is
  meanwhile; a Vue or Svelte cell's `read` gives the values of `fields` as
  it last read them (or as they were when it was handed over), so content
  that renders again on its own (state of its own or of the page changed)
  draws the row it shows and keeps its state.
- **Boundaries.** Each cell has an error boundary of its own drawing the
  cell's text: an error is reported once (`reportError`) until the cell
  shows another row. React cells also have a Suspense boundary of their
  own, which reveals on its own; a focused control cell takes the focus as
  it reveals, unless the user has moved it elsewhere. Vue and Svelte cells
  have no pending boundary: content that loads draws its own placeholder.
  Errors in a cell's event handlers are not caught; they go to the
  framework's handlers as any component's.
- **Keys.** `interaction: "control"` and `"composite"` work as for
  [custom renderers](grids.md#cells): a cell's button takes the grid's
  focus, or Enter moves into its controls.
- **Cost.** A React cell is a portal, and React listens for every event it
  handles on each portal's element: about 34 KB of memory per mounted
  React cell (~5 MB for a screen of five React columns), held while the
  element shows its column and let go of with it. A Vue or Svelte cell
  holds about 15 KB. Each grows with the cells mounted, not with the rows.
  Mounting, scrolling, and memory against TanStack Table's React cells
  are in the [comparison](../comparison.md#framework-cells).

**Types.** Each grid component is generic in its model's schema: `cells`'
`fields` and `read`, and the exposed `grid` (`ref`, a Vue template ref's
`grid`, Svelte's `bind:grid`), are typed by the model. Where the
frameworks fall short:

- Vue slots are typed by name pattern (`cell-${string}`), so a slot's
  name is not checked against the columns (React's and Svelte's `cells`
  keys are not either; a wrong id is an error when the grid mounts).
  Templates (vue-tsc) and TSX infer the schema from `model`; `h()` does
  not take generic components, so cast `h(Grid as Component, props)` and
  type the cells apart (`VueGridCells<S>`). Templates write the accessible
  name `aria-label` (the prop is `ariaLabel`; one of the two is required).
- Svelte snippets declared in markup are typed by their parameter's
  annotation (`cell: GridCellContext<Services>`, the model's schema), not
  inferred from where they are passed.
