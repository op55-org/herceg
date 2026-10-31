# herceg

Framework-independent charts for analytics applications: columnar data,
streaming updates, level-of-detail rendering, SVG, Canvas, and WebGL
output, and SVG, image, and PDF export. React, Vue, and Svelte components
and a Python package sit on the same engine.

> Early development; not yet published to npm. Build it from a checkout
> ([Install](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md#install)). The API may change
> before the first release.

## Quick start

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
  interaction: { zoom: "x" },
});

metrics.appendRow({ time: Date.now(), p50: 120, p99: 300 }); // drawn on the next frame
```

Field names are checked against the table at compile time: `y` accepts
number and time fields, `series` category fields.

## More examples

```ts
import { bar, heatmap, point, selectionStore, rowSelection } from "herceg";

bar(sales, { x: "region", y: ["q1", "q2"] }); // grouped bars
point(cars, { x: "weight", y: "mpg", color: "origin", size: "power" });
heatmap(load, { x: "hour", y: "host", color: "cpu" });

// Brushing one chart highlights the same rows in another.
const focus = selectionStore(cars);
createChart(a, { marks: [point(cars, { x: "weight", y: "mpg" })], interaction: { brush: "xy" },
  rowSelection: rowSelection({ store: focus, channel: "focus" }) });
createChart(b, { marks: [bar(cars, { x: "origin", y: "mpg" })],
  rowSelection: rowSelection({ store: focus, channel: "focus" }) });
```

```ts
import { renderToSVG } from "herceg";
import { renderToPDF } from "herceg/pdf";

const svg = renderToSVG({ width: 640, height: 320, marks }); // no DOM needed
const pdf = renderToPDF(chart); // a mounted chart as it is shown
```

## Entry points

| Import | Gives |
| --- | --- |
| `herceg` | Tables, marks, `createChart`, `renderToSVG`, server snapshots and hydration |
| `herceg/layout` | Subplot layouts: columns, rows, grids, panels, insets |
| `herceg/spec` | Charts from portable JSON specs: `loadSpec`, `validateSpec`, `chartFromSpec`, `specToSVG`, `specToPDF` |
| `herceg/pdf` | `renderToPDF` |
| `herceg/image` | `renderToImage`: PNG, JPEG, and WebP for documents |
| `herceg/fonts` | `prepareFonts`: supplied fonts for identical layout everywhere |
| `herceg/grid`, `herceg/grid/model`, `herceg/grid/pivot`, `herceg/grid/remote`, `herceg/grid/memory`, `herceg/grid/conformance` | Grids |
| `herceg/pivot` | Row pivots |
| `herceg/web` | Binary payloads and page fragments |

Optional pieces are subpaths and the package has no side effects, so a
line chart bundles none of PDF, grids, or specs, and code for interaction,
WebGL, and other features loads when a chart needs it.

## Documentation

| Guide | Covers |
| --- | --- |
| [Getting started](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md) | Options, the chart handle, updates, errors |
| [Data](https://github.com/op55-org/herceg/blob/main/docs/guide/data.md) | Tables, streaming, derived tables, row views, selections, groups, pivots |
| [Marks](https://github.com/op55-org/herceg/blob/main/docs/guide/marks.md), [Statistical charts](https://github.com/op55-org/herceg/blob/main/docs/guide/statistical-charts.md), [Hierarchy and flow](https://github.com/op55-org/herceg/blob/main/docs/guide/hierarchy-and-flow.md), [Maps](https://github.com/op55-org/herceg/blob/main/docs/guide/maps.md), [3D](https://github.com/op55-org/herceg/blob/main/docs/guide/three-dimensional.md), [Financial](https://github.com/op55-org/herceg/blob/main/docs/guide/financial-charts.md) | Every mark |
| [Layout](https://github.com/op55-org/herceg/blob/main/docs/guide/layout.md), [Axes and legends](https://github.com/op55-org/herceg/blob/main/docs/guide/axes-and-legends.md), [Styling](https://github.com/op55-org/herceg/blob/main/docs/guide/styling.md) | Panels, guides, themes |
| [Interaction](https://github.com/op55-org/herceg/blob/main/docs/guide/interaction.md), [Accessibility](https://github.com/op55-org/herceg/blob/main/docs/guide/accessibility.md) | Zoom, brush, sync, inspection and tooltips, events and what they pick, selections, keyboard |
| [Export](https://github.com/op55-org/herceg/blob/main/docs/guide/export.md), [Large data](https://github.com/op55-org/herceg/blob/main/docs/guide/large-data.md), [Grids](https://github.com/op55-org/herceg/blob/main/docs/guide/grids.md) | Output, performance, grids |

The [documentation index](https://github.com/op55-org/herceg/blob/main/docs/README.md) lists everything, including
the [comparison](https://github.com/op55-org/herceg/blob/main/docs/comparison.md) with other libraries and the
[roadmap](https://github.com/op55-org/herceg/blob/main/docs/roadmap.md).

## License

MIT
