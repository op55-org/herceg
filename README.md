# Herceg

Herceg is an open source charting library for analytics applications: one
engine for TypeScript, React, Vue, Svelte, and Python, built for charts
whose data is large or changes often.

- **Charts.** Line, area, bar, scatter, heatmap, contour, histogram, box
  plot, violin, error bar, candlestick, pie, treemap, sunburst, gauge,
  funnel, radar, Sankey, network, map, and 3D charts, with annotations and
  custom marks, composed on shared scales.
- **Layout.** Small multiples, subplots of nested rows and columns, insets,
  a second y axis, time axes that leave out nights and weekends, and a
  range navigator.
- **Data.** Columnar, typed-array tables with streaming appends and rolling
  windows, derived tables, row views, linked row selections, row groups,
  and pivots.
- **Large data.** Level-of-detail reduction for lines and areas, Canvas for
  dense marks, and WebGL for large point clouds and 3D, chosen per chart.
- **Interaction.** Zoom, pan, brushes and lassos, gesture bindings, synced
  cursors and views across charts, tooltips, keyboard navigation, and
  animated changes.
- **Output.** SVG, PNG, JPEG, WebP, and PDF, server rendering with
  hydration, a portable JSON spec with binary columns, and page fragments
  for server-rendered sites.
- **Grids.** A virtualized analytical grid with grouped rows, pivots, and
  remote data, sharing tables and selections with charts.
- **Python.** A Pythonic API over pandas, Polars, PyArrow, and NumPy, with
  notebook widgets, Streamlit, Seaborn-style statistics
  (`herceg.express`), and Flask, Django, and FastAPI pages.

## Status

Early development; not yet published to npm or PyPI. Build it from a
checkout ([Install](docs/guide/getting-started.md#install)). Behavior is
tested in Chrome, Firefox, and WebKit, and measured against Apache ECharts,
TanStack Charts, Chart.js, Plotly, and uPlot in a reproducible benchmark
suite.

## Examples

```ts
import { createChart, line, rule, table, time } from "herceg";

const latency = table({
  time: time(["2026-01-01", "2026-01-02", "2026-01-03"]),
  p50: [120, 135, 128],
  p99: [310, 290, 335],
});

const chart = createChart(document.querySelector("#chart")!, {
  title: "Request latency",
  marks: [line(latency, { x: "time", y: ["p50", "p99"] }), rule({ y: 300, label: "SLO" })],
  y: { title: "ms" },
  interaction: { zoom: "x" },
});

latency.appendRow({ time: Date.parse("2026-01-04"), p50: 131, p99: 302 }); // draws on the next frame
```

```tsx
import { Chart, Line, Rule } from "@herceg/react";

export function Latency() {
  return (
    <Chart title="Request latency" y={{ title: "ms" }} interaction={{ zoom: "x" }}>
      <Line data={latency} x="time" y={["p50", "p99"]} />
      <Rule y={300} label="SLO" />
    </Chart>
  );
}
```

```python
import herceg as hg

chart = (
    hg.Chart(df, title="Request latency", y=hg.AxisOptions(title="ms"), zoom="x")
    .line(x="time", y=["p50", "p99"])
    .rule(y=300, label="SLO")
)
chart.save("latency.html")
```

Vue and Svelte components work the same way
([React, Vue, and Svelte](docs/guide/frameworks.md)).

## At a glance

Bundle size of a line chart, minified and gzipped, from
[the size benchmark](docs/comparison.md#bundle-size):

| Library | Line chart, gzip KiB |
| --- | ---: |
| Herceg | 60.9, plus 12.4 loaded after the first frame |
| Herceg with React, Vue, or Svelte | 63.2 to 63.8, plus 12.4 |
| Chart.js | 63.7 |
| TanStack Charts | 44.4 |
| uPlot | 22.5 |
| ECharts | 166.8 |
| Plotly (basic) | 391.4 |

Rendering, updates, streaming, interaction, dashboards, memory, and ease
of use are compared, wins and losses alike, in
[the comparison](docs/comparison.md).

## Documentation

- [Documentation index](docs/README.md): every guide and reference page
- [Getting started](docs/guide/getting-started.md)
- [Herceg for Python](docs/guide/python/README.md)
- [What each mark supports](docs/guide/support.md) and the generated
  [capability matrix](docs/capabilities.md)
- [Comparison](docs/comparison.md) and [benchmarks](benchmarks/README.md)
- [Roadmap](docs/roadmap.md)
- [Architecture](docs/architecture.md) and
  [contributing](docs/contributing.md)
- [Changelog](CHANGELOG.md)

## Packages

| Package | Is |
| --- | --- |
| [`herceg`](packages/herceg/README.md) | The engine, renderers, and browser runtime; optional parts are subpaths (`herceg/pdf`, `herceg/grid`, `herceg/web`, ...) |
| [`@herceg/react`](packages/react/README.md), [`@herceg/vue`](packages/vue/README.md), [`@herceg/svelte`](packages/svelte/README.md) | Framework adapters |
| [`herceg` (Python)](python/README.md) | The Python package |

## Development

Node.js 22.12 or newer, Google Chrome and Playwright's Firefox and WebKit
for browser tests, and [uv](https://docs.astral.sh/uv/) for Python:

```sh
npm ci
npm run build
npm test
npm run test:browser
npm run test:python
```

See [contributing](docs/contributing.md) and [AGENTS.md](AGENTS.md) for
every command and the engineering rules.

## License

MIT
