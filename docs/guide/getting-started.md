# Getting started

This guide shows a first chart on every surface, the chart options, the
handle a mounted chart returns, and what happens when a chart cannot draw.

- [Install](#install)
- [A first chart](#a-first-chart)
- [Chart options](#chart-options)
- [The chart handle](#the-chart-handle)
- [Updating a chart](#updating-a-chart)
- [Views and selections](#views-and-selections)
- [When a chart cannot draw](#when-a-chart-cannot-draw)
- [More examples](#more-examples)

## Install

Herceg is not yet published to npm or PyPI. Build it from a checkout
(Node.js 22.12 or newer; [uv](https://docs.astral.sh/uv/) for Python):

```sh
git clone https://github.com/op55-org/herceg && cd herceg
npm ci
npm run build                # packages/*/dist: herceg and the adapters
npm run build:python && pip install ./python
```

Once released, the packages install as:

```sh
npm install herceg
npm install @herceg/react     # or @herceg/vue, @herceg/svelte
pip install herceg            # extras: pandas, polars, arrow, export, notebook, streamlit, flask, stats
```

## A first chart

**TypeScript**

```ts
import { createChart, line, rule, table, time } from "herceg";

const metrics = table({
  time: time(timestamps), // Float64Array of epoch ms, Date[], or ISO 8601 strings
  p50: p50Latency, // Float64Array or number[]
  p99: p99Latency,
});

const chart = createChart(document.querySelector("#latency")!, {
  title: "Request latency",
  marks: [line(metrics, { x: "time", y: ["p50", "p99"] }), rule({ y: 250, label: "SLO" })],
  y: { title: "ms" },
});
```

A chart is a list of **marks** over **tables**. Field names are checked
against the table at compile time. The chart fills its container's width.

**React** (Vue and Svelte are alike; see [Frameworks](frameworks.md))

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

**Python**

```python
import herceg as hg

hg.line(df, x="time", y=["p50", "p99"], title="Request latency")  # pandas, Polars, PyArrow
hg.Chart(df, title="Request latency").line(x="time", y="p50").rule(y=250, label="SLO")
```

A one-call helper (`hg.line`, `hg.bar`, ...) makes a chart of one kind;
`hg.Chart(data)` composes marks. See the [Python guide](python/README.md).

## Chart options

Every surface takes the same options: TypeScript and the spec in
camelCase, adapter components as props, Python in snake_case.

| Option | What it sets | Guide |
| --- | --- | --- |
| `marks` | Marks to draw, in paint order | [Marks](marks.md) |
| `title`, `description` | Accessible name and description; the title is drawn | [Axes and legends](axes-and-legends.md#titles-and-padding), [Accessibility](accessibility.md) |
| `width`, `height`, `padding` | Fixed size (omitted dimensions follow the container, 320 px tall when it has no height; in Firefox give it a block container, as a chart in a `<span>` keeps its first width); whitespace around the chart | [Axes and legends](axes-and-legends.md#titles-and-padding) |
| `x`, `y`, `yRight`, `scales`, `guides`, `legend` | Position scales and their axes, other scales, guides, the legend | [Axes and legends](axes-and-legends.md) |
| `facet`, `panels`, `navigator` | Small multiples, subplots, a range navigator | [Layout](layout.md), [Interaction](interaction.md#range-navigator) |
| `tooltip`, `renderTooltip` | Tooltip mode and content | [Interaction](interaction.md#tooltips) |
| `interaction` | Pan, zoom, brush, bindings, view limits, sync | [Interaction](interaction.md) |
| `rowSelection` | Selection stores that brushes and clicks write and the chart highlights | [Interaction](interaction.md#selected-rows) |
| `animation` | Gradual changes of view and of values | [Interaction](interaction.md#animation) |
| `theme`, `fonts`, `locale`, `timeZone` | Look, fonts for measuring and drawing, formatting | [Styling](styling.md), [Export](export.md#fonts) |
| `renderer` | `"auto"`, `"svg"`, or `"canvas"` | [Large data](large-data.md#renderers) |
| `projection` | Map projection | [Maps](maps.md) |
| `z`, `camera`, `boxAspect` | 3D axes, view, and box | [3D charts](three-dimensional.md) |
| `errorMode`, `onError` | What the chart does when it cannot draw | [below](#when-a-chart-cannot-draw) |

`renderTooltip` and `fonts` are JavaScript only (functions and loaded font
files cannot travel in a spec).

## The chart handle

`createChart` returns a `Chart`. React gives it through a `ref`, Vue
through a template ref, Svelte through `bind:chart`; Python widgets have
methods of their own (see [Notebooks](python/notebooks-and-streamlit.md)).

| Member | Does |
| --- | --- |
| `root` | The chart's element. |
| `update(options)` | Changes options ([below](#updating-a-chart)). |
| `render()` | Draws now instead of on the next frame. |
| `destroy()` | Removes the chart and frees its resources. |
| `ready` | A promise of the first frame, rejected with what kept it from drawing. |
| `loading` | A promise while code loads (compilers a configuration needs before it draws; after the first frame, interaction, the GPU painter, animation, controls, fonts); `undefined` otherwise. |
| `on(event, listener)` | Listens to events; returns a function that stops listening ([Events](interaction.md#events)). |
| `setViewport`, `getViewport` | The view of the axes ([below](#views-and-selections)). |
| `select`, `selection`, `selectionOwner` | The brushed or lassoed selection. |
| `getLegend`, `getHiddenKeys`, `setHiddenKeys`, `setVisibility` | Series shown and hidden ([Interaction](interaction.md#hiding-series)). |
| `getPanels`, `toPixel`, `fromPixel`, `formatValue`, `inspect` | Panels and pixel mapping ([Interaction](interaction.md#panels-and-pixels)). |
| `showCursor`, `hideCursor` | Move the cursor from outside ([Sync](interaction.md#sync)). |
| `getCamera`, `setCamera` | 3D charts' view. |
| `getDrillRoot`, `setDrillRoot` | Treemaps' and sunbursts' drilled node. |
| `getItemPositions`, `setItemPosition` | Networks' moved nodes. |
| `toSVG(sizing?)`, `toPNG({ dpi }?)` | Exports of what the chart shows ([Export](export.md)). |

Methods that address one panel take `{ panel }` (see
[Layout](layout.md#working-with-panels)).

Input that arrives before the interaction code has loaded is kept and
handled once it loads. Tests that check what input does right after
creating a chart should `await chart.loading` first.

## Updating a chart

`update` takes a `ChartUpdate`. Each option given replaces the chart's
whole (an axis, `interaction`, `tooltip`), so pass every setting to keep;
an option given as `undefined` returns to its default; options left out are
unchanged.

```ts
chart.update({ y: { title: "ms", domain: [0, 500] } });
chart.update({ legend: undefined }); // back to the default
```

Adapter props are the whole configuration: a prop left out or `undefined`
takes its default. Data changes go through tables, not `update` (see
[Changing data](data.md#changing-data-and-streaming)).

## Views and selections

A `Viewport` is `{ x, y, yRight }`: the visible ranges in data values
(epoch ms on time axes), each `null` for an axis that is not zoomed.

```ts
chart.setViewport({ y: [0, 100] }); // zoom y alone; keep x
chart.setViewport([t0, t1]); // a pair is an x range
chart.setViewport(null); // reset every axis
const saved = chart.getViewport();
chart.setViewport(saved);
```

One `setViewport` call is one change of view: one animation and one
`viewport` event. In charts whose panels have scales of their own, pass
`{ panel }`. A range on a category axis is refused.

`chart.selection` is `{ x, y, lasso }` or null, in data values: the brushed
ranges (null along an axis the brush leaves alone) and a lasso's outline as
`[x, y]` pairs. `selectionOwner` says which scale instances and panels it
belongs to. `chart.select(selection | [from, to] | null)` sets it.

## When a chart cannot draw

Refused options, a field the data lacks, a line whose color changes within
a series, code that fails to load, and a frame that fails to draw are
`ChartError`s, with the same shape on every surface:

| Field | Holds |
| --- | --- |
| `code` | `"invalid-option"`, `"unknown-field"`, `"field-type"`, `"series-varies"`, `"series-with-values"`, `"unknown-reference"`, `"unsupported"` (a valid option the chart does not draw, saying what to give instead), `"layout-failed"`, `"load-failed"`, `"render-failed"` |
| `phase` | `"validate"`, `"compile"`, `"load"`, `"layout"`, `"render"` |
| `path` | Where: `"marks[1].color"`, in the caller's spelling (snake_case in Python) |
| `mark`, `panel` | The mark's `id` (else its index) and the panel, where known |
| `message` | "location: problem; correction" |

Mark functions throw for their own options at once
(`line(table, { y: "p90" })` with no such field).

| `errorMode` | Behavior |
| --- | --- |
| `"inline"` (default) | `createChart` and `update` do not throw. A chart that drew nothing shows a box of its size saying "Chart could not be rendered" and why; a refused update keeps the last frame under a banner; a frame that fails on new data shows the box until data that draws arrives. Each is an alert read out as it appears. |
| `"throw"` | Nothing is shown: `createChart` and `update` throw what they refuse; later failures go to `onError` and `error` listeners. Adapters throw in render, for error boundaries. |

Each failure is reported once: to `onError`, to `"error"` listeners, or,
with neither, to the console. Exports (`toSVG`, `toPNG`) throw what keeps a
frame from drawing.

```ts
const chart = createChart(element, { marks, onError: (error) => report(error.code, error.path) });
await chart.ready; // the first frame is on screen, or the error that kept it off
const strict = createChart(other, { marks, errorMode: "throw" });
```

`errorInfo(error)` gives a JSON-safe `ChartErrorInfo`; `showFailure(element,
error)` draws the box for errors of your own.

In Python, refusals raise `hg.ChartError`, a `ValueError` with the same
fields and `info()`:

```python
try:
    chart.to_svg()
except hg.ChartError as error:
    print(error.code, error.path)  # series-varies marks[0].color
```

Python checks columns, kinds, and series as each mark is added, references
as the chart is output, and what only the engine knows (rows `hg.derive`
makes) as it draws. Values of the wrong type are refused at their place
among nested options (`theme.tokens.palette`, `x.ticks.count`). A keyword a
function does not take is a `TypeError` naming the likely one. See
[Python errors](python/output.md#errors).

## More examples

Twelve common tasks (a basic line, several series, a custom tooltip,
annotations, synced charts, streaming, 100,000 points, a custom mark, a
theme, export, a Python notebook chart, bars with a target line) are in
[benchmarks/src/ease](../../benchmarks/src/ease), one directory per task,
beside the same task in ECharts, TanStack Charts, Chart.js, and Plotly. A
browser test keeps every sample drawing; [the comparison](../comparison.md#common-tasks)
sets them side by side.
