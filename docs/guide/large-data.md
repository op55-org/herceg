# Large data and streaming

Herceg shows all of the data by default. Lines, areas, heatmaps, and
candlesticks are reduced to what the plot's pixels can show, so what they
draw follows the plot's size rather than the row count (reducing still
reads the rows in view, unless an index answers); points are all drawn,
so their cost grows with the points in view, and large point series go to
the GPU. This guide covers how renderers are chosen, what
level of detail does, when the GPU draws, and how to keep streaming charts
fast.

- [Renderers](#renderers)
- [Lines and areas: level of detail](#lines-and-areas-level-of-detail)
- [Points: canvas and WebGL](#points-canvas-and-webgl)
- [Heatmaps, histograms, candlesticks](#heatmaps-histograms-candlesticks)
- [Streaming](#streaming)
- [Many charts on a page](#many-charts-on-a-page)
- [Limits](#limits)

## Renderers

| `renderer` | Draws marks in |
| --- | --- |
| `"auto"` (default) | SVG until a scene draws more than 4,000 points (line vertices, bars, points, or heatmap cells, after level of detail), Canvas from then on, back to SVG below 2,000. |
| `"svg"` | SVG always. |
| `"canvas"` | Canvas always; axes, labels, and the legend stay SVG and HTML. |

SVG keeps small charts crisp and cheap in memory (no canvas backing
store). The count depends on width and device pixel ratio: a dense line at
800 px stays in SVG at DPR 1 and moves to Canvas at DPR 2.

`renderer` does not choose the GPU. In the browser, point series of 100,000
points or more, and standalone 3D charts of 20,000 points, 10,000 surface
cells, or 20,000 line segments, are drawn with WebGL2, loaded the first time
a chart needs it. Without WebGL2, after a lost context, with
`renderer: "svg"`, and in exports, the CPU draws them.

```ts
const chart = createChart(element, { marks: [point(cloud, { x: "x", y: "y" })] });
await chart.loading; // settles once the WebGL painter has drawn the points
```

## Lines and areas: level of detail

Lines and areas over sorted x are reduced before drawing (M4): within each
device-pixel column, only the first, lowest, highest, and last points of an
unbroken run are kept. A million-point series draws as a few thousand
points and keeps every column's extremes, so peaks never disappear.

- Reduction runs every frame over the rows in view, so zooming in shows
  more detail without any setting.
- Whole columns and long-format series of 4,096 points or more keep a
  min/max index, so zooming into ten million points takes about 1.5 ms.
- Missing values split a line into runs reduced separately: data with very
  many gaps reduces less.
- Dash patterns can shift slightly, since intermediate points are removed.
- On a time axis with breaks, columns are columns of time shown.
- Unsorted x is drawn point by point, without reduction.

How the reduction and indexes work is in
[architecture: level of detail](../architecture/data.md#level-of-detail).

## Points: canvas and WebGL

| Points per series | Drawn |
| --- | --- |
| Under 4,000 drawn points in the chart | SVG (with `renderer: "auto"`) |
| Up to 100,000 | Canvas |
| 100,000 or more | WebGL2 (one shared context per page), placed on the GPU so zooming and panning only change shader uniforms |

- `sampling: "pixel"` draws opaque points whose centers land on the same
  device pixel once (above 4,096 points per series): faster for dense
  scatter plots, but it can drop subpixel edge coverage.
- Tooltips find the nearest point through a spatial grid index, on every
  renderer.
- Points on category axes, points of a row view, and points on a time axis
  with breaks are placed on the CPU.

## Heatmaps, histograms, candlesticks

| Mark | Bounded by |
| --- | --- |
| Heatmaps, 2D histograms | One image of at most the plot's device pixels, whatever the number of cells. Cells smaller than a pixel are averaged (`sampling: { reduce: "max" }` or `"min"` keeps extremes). |
| Contours | Traced once per grid and projected again as the view moves. |
| Histograms | At most a thousand bars; bins are counted, values not kept. |
| Candlesticks, OHLC | With more candles than pixel columns, one candle per column: first open, last close, highest high, lowest low. |

## Streaming

Tables change in place (see [Changing data](data.md#changing-data-and-streaming)),
and charts redraw once per animation frame however many changes arrived.

```ts
const live = table({ time: time([]), cpu: [] as number[] }, { maxRows: 3_000 });
const chart = createChart(element, { marks: [line(live, { x: "time", y: "cpu" })] });
setInterval(() => live.append({ time: [Date.now()], cpu: [readCpu()] }), 100);
```

What stays incremental as rows arrive and leave a rolling window:

- min/max indexes of whole columns and of long-format series;
- grouping of long-format rows by series;
- stacks of fields, bars stacked by series, and areas stacked by series
  (input-order zero, fill, and center offsets; `"wiggle"` and
  `order: "inside-out"` recompute the window);
- GPU point uploads, which write only new points;
- derived tables of filters, calculations, and fixed bins; row views; row
  groups; pivots;
- late rows of an [ordered table](data.md#rows-that-arrive-late): min/max
  indexes, series grouping, and areas stacked by series redo the rows from
  the first one a merge moved.

A million-point rolling window takes about 1.5 ms per 10,000-point tick in
Chrome, and a 15-series, 3,000-point line chart about 1.2 ms per tick (see
[Streaming results](../comparison.md#streaming)).

Areas stacked by a series field keep an edge for every layer at every x any
layer has: 16 bytes per layer and x, plus 16 per row. Series with few x
positions in common cost more than their rows.

In Firefox, most of a streaming SVG line's cost is the browser repainting
the changed path; `renderer: "canvas"` avoids it (see
[Firefox results](../comparison.md#other-browsers)).

## Many charts on a page

- All charts share one animation-frame loop, so a dashboard redraws once
  per frame.
- Charts outside the viewport do not draw until they scroll into view.
- Charts reading one table share its storage and indexes; nothing is
  copied per chart.
- Each chart loads its interaction code right after its first frame, so a
  page of charts shows before any of it arrives.

## Limits

- Lines whose x does not ascend are not reduced.
- Points of a row view stay on the CPU.
- The renderer thresholds have not been tuned with benchmarks.
- Areas stacked by series with little x overlap use more memory than their
  rows (above).
- Geometry is stored as single-precision pixel coordinates: zoomed to a
  millionth of the data's range or less (neighboring points more than about
  10^7 pixels outside the plot), lines between them can be visibly
  displaced.
- In 2D charts the GPU draws only large point series; lines, areas, bars,
  heatmaps, and contours use Canvas or SVG. Standalone 3D charts of 20,000 faces or
  more draw their points, lines, and surfaces on the GPU
  ([3D charts](three-dimensional.md#rendering-gpu-and-cpu)).
