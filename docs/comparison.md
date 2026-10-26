# Comparison with other chart libraries

This page compares Herceg with Apache ECharts, TanStack Charts, Chart.js, and
Plotly. uPlot is included in the measurements as a reference point for fast
time-series rendering.

Herceg preserves isolated finite line and area rows as stroke-sized dots
across SVG, Canvas, and PDF, and bars colored by their own category retain
full bands and value labels. Time axes remove repeated formatted tick
labels. Text halos choose the surface at 3:1 contrast or higher and accept
`halo: false` on every halo-drawing mark and the navigator. These are
correctness guarantees; equivalent competitor behavior has not been measured
in the performance scenarios below.

Herceg's Python legends and colorbars accept panel-scoped side placement,
matching the engine. Browser drag gestures prevent native text selection
while static chart text remains selectable. These behaviors are covered by
regression tests; equivalent behavior in ECharts, TanStack Charts, Chart.js,
and Plotly has not been compared.

Each entry is one of:

- **Measured** — produced by the benchmark suite in `benchmarks/`; raw data is
  in `benchmarks/results/*.json`. Methodology: `benchmarks/README.md`.
- **Documented** — taken from the library's official documentation, not
  measured here.
- **Not implemented** / **Not measured** — stated as such.

Measurements come from one machine, mostly in Chrome, with the browser suite
repeated in WebKit and Firefox. They describe relative behavior under the
stated configuration, not universal speedups.

Python helpers and `Chart` mark methods give option hints for common
matplotlib spellings, restricted to each callable's supported options.
The [Python porting table](../python/README.md#from-matplotlib) covers calls
and limits. Lines, rules, and JavaScript custom shape styles accept the
four matplotlib dash strings, scaled by stroke width using matplotlib's
default patterns; numeric dash arrays remain pixels.

## Status

Herceg renders line, area, bar, point (scatter), heatmap, contour, rug, dendrogram, error bar,
candlestick (and OHLC bar), histogram (1D and 2D), pie, box plot, violin, treemap, sunburst, gauge, funnel, radar, Sankey, network (graph), map (geoshape and geopoint), and 3D (point3d, line3d, and surface) marks, rule, region, and text annotations, and custom marks, on time axes that can leave out breaks.
Dendrograms draw a precomputed hierarchical linkage with its leaves on a
heatmap's categories in subplots; Python's `herceg.express` computes the
clustering for its `clustermap` (see [Statistical charts](#statistical-charts)).
Rug and dendrogram performance has not been compared with competitors.
uPlot has no bar, scatter, or heatmap support comparable to the scenarios, and
Chart.js has no built-in heatmap; those cells are marked n/a.

## Summary

| Area | Herceg | ECharts | TanStack Charts | Chart.js | Plotly |
| --- | --- | --- | --- | --- | --- |
| Initial render | Measured. Fast at every size measured: ~0.7 ms for 4 x 200 line points (uPlot: ~0.5 ms), ~2.4 ms for 10 x 5,000, ~4.9 ms for 1M points (uPlot: ~6.4 ms), ~38 ms for 10M points (uPlot: ~47 ms). Bars ~1.4 ms for 100 x 4; scatter ~2.5 ms for 10k points on Canvas, ~4.3 ms for 200k and ~17 ms for 1M with WebGL; heatmaps ~1.5 ms for 100 x 100 and ~13 ms for 500 x 500 cells, drawn as one image. Lines are reduced to at most four points per pixel column; SVG below 4,000 drawn points or cells, Canvas above. | Measured. Canvas; fast for small charts, ~170 ms for a 1M-point line with `minmax` sampling. Scatter and heatmap series render progressively: a 500x500 heatmap shows its first frame after ~50 ms and completes after ~5 s. | Measured. Fast small SVG charts; cost grows with rows because every row becomes a scene node (~0.72 s for 1M points on Canvas). | Measured. Fast for small and medium charts; min-max decimation makes 1M points cheap once the `{x, y}` objects exist. | Measured. Slowest small charts; SVG scatter is expensive at 10k points, WebGL traces handle large data. |
| Incremental update | Measured. Tables support append, drop, range replace, and reset; charts re-render once on the next frame. Replacing 10 x 5,000 line points takes ~1.2 ms (uPlot ~1.2 ms), 1M points ~3.5 ms (uPlot ~5.7 ms), 10k scatter points ~1.8 ms, 100 x 100 heatmap cells ~0.6 ms. | Measured. `setOption` re-processes the series; no rolling-window append. | Measured. Updates rebuild the definition and scene. | Measured. Mutate arrays and `update('none')`; cheap. | Measured. `extendTraces` with `maxPoints` gives a documented rolling window, but each tick costs ~20–30 ms here (~270 ms in a million-point window). |
| Streaming | Measured. ~1.2 ms per tick for 15 series x 3,000 points (uPlot: ~0.9 ms); keeps up in every paced scenario, including the ten-chart dashboard at 10 Hz. A million-point rolling window takes ~1.5 ms per 10,000-point tick (uPlot: ~5.8 ms), because min/max indexes are kept current as rows arrive. Rolling windows via `maxRows`. | Measured. ~10 ms per tick for 15 series x 3,000 points; keeps up with 100 Hz ingestion for one chart but drops frames for a 10-chart dashboard at 10 Hz. | Measured. ~31 ms per tick; at 60–100 Hz ingestion only ~33 updates per second get through. | Measured. ~3.5 ms per tick; keeps up in every paced scenario. | Measured. ~20 ms per tick; ~56 updates per second at 100 Hz, ~6 Hz for the 10-chart dashboard. |
| Memory | Measured. ~0.24 MB retained for 1M points (uPlot ~0.18 MB): source typed arrays are used in place and geometry buffers are bounded. Ten-chart dashboard ~5.9 MB, its traced lines growing no further than the points they can keep (uPlot ~2.8 MB; its paths are browser `Path2D` objects, outside the measured heap); 100 small charts ~9 MB and no canvas backing stores, because small charts render to SVG. | Measured. ~240 MB retained for 1M points (internal storage plus per-point structures). | Measured. ~600 MB retained for 1M points (row objects, Dates, scene nodes). | Measured. ~49 MB for 1M points (one `{x, y}` object per point). | Measured. ~110 MB for 1M points with WebGL. |
| Bundle size (line chart, gzip) | Measured. ~61 KiB (62,392 B) before the first frame for a time-series line chart with tooltip, events, and brushing, and its interaction controller (tooltips, the pointer, the wheel, keys; ~12.4 KiB, 12,720 B) loaded right after it; styles, positioned guides, and layout options are plain values in TypeScript as in specs and Python, so every chart carries their code, about 7 KiB of it (the style cascade of theme tokens and role styles for axes, legends, titles, and subplots, guides built as positioned items every renderer draws, titles and legends placed on any side or inside a plot with explicit padding, text boxes and halos, per-panel scale instances, clipping per mark, fluid SVG export, and the hooks for supplied fonts; monotone curves, which line charts carry whether they use them, are ~1 KiB of it, the four built-in themes with page-following themes about 2 KiB, the dispatch to layout marks such as pies about 1 KiB, y and xy zoom, rectangle and lasso brushes, and synced selections about 1.4 KiB, and facet headers, per-panel y scales, subplot routing, and weighted rows, which the model plans for any chart, about 1.1 KiB, x scales of panels' own (planned per group for any chart, with zoom, selections, and events per scale in the browser runtime) about 1.5 KiB, categories of panels' own (band axes planned per group, and category positions and values read through each panel's band places in tooltips and keyboard reads, and the chart's bands handed to summaries) about 0.1 KiB, the hooks that start view transitions and value transitions, whose code loads separately, about 0.6 KiB, the hooks that let a map's layers share a chart and tables hold geometry columns, about 0.1 KiB, the hooks for time axis breaks (whose code comes only with `timeBreaks`) and crosshair labels (loaded on demand), about 1.2 KiB, the camera API and the hooks that load 3D turning (`camera`, `setCamera`, the camera event, presses kept to their pointer), about 0.6 KiB, the hooks of row selections (`rowSelection`, whose code comes with `rowSelection()`), about 0.15 KiB, the hooks that load tooltip fields and content of the application's own (`tooltip.fields`, `renderTooltip`) and check fields as marks are made, about 0.3 KiB, exports of a mounted chart (`toPNG`, and the hook `renderToPDF(chart)` uses), about 0.1 KiB, and times read from ISO 8601 strings, numbers as categories, and values converted before a table changes, about 0.15 KiB; the pie, the maps, the breaks and their seam drawing, and the 3D marks themselves are not included). Each mark brings its own drawing code, so a line chart carries no bar, point, symbol, heatmap, or text drawing, color schemes are separate exports, and facets and the code that copies traces through independent panel bands or time breaks are only bundled when used; the chart model still includes band-axis, legend-layout (series, color, size, and shape keys), horizontal-bar inspection, right-axis, and panel-layout logic, and min/max indexes for large lines add ~1 KiB. The WebGL painter for large point series (~3.5 KiB; 3D charts add their ~4.2 KiB programs for points, lines, and surfaces, a separate chunk where the build splits them), 3D turning (~2 KiB), animation of views (~1 KiB) and of values (~6.5 KiB), crosshair labels (~1 KiB), tooltip fields and content of the application's own (~1.1 KiB), and PNG export (~0.4 KiB) load only when a chart needs them, and text is measured with the browser's canvas, so the static text estimator is not bundled. | Measured. ~167 KiB tree-shaken, ~371 KiB full. | Measured. ~44 KiB including `d3-scale` for time. | Measured. ~64 KiB with time scale and date adapter. | Measured. ~391 KiB basic bundle, ~1.4 MiB full. |
| Line | Line, step lines, smooth monotone curves, several y fields or a long-format series field, gaps for missing values, log and time axes, level of detail for large series. Area (stacked, band) and rule marks. | Documented. Time axes, sampling, area fill, step lines. | Documented. `lineY`/`lineX`, gaps, curves. | Documented. Line, stepped, filled; decimation plugin. | Documented. `scatter`/`scattergl` lines, rich hover. |
| Stacked areas and bars | Areas and bars stack several fields row by row, or the series of a category field: areas on every x any shown series has (a series without a row there counts as zero, or with `stackGaps: "interpolate"` as the line between its rows, zero beyond its ends; several rows at one x pair up by occurrence), bars by position, positive values up and negative down. Edges are typed arrays aligned on that union of x; tooltips, the keyboard, events, and summaries read each series' own rows, at its layer's top; hidden series leave the stack; facets stack each panel apart; on log axes area stacks stand on the axis' low end; monotone curves and value animation move the layers together. Streaming restacks only what appended and dropped rows touch. One-off measurements (not a committed scenario; Chrome 154, macOS 27, Apple M6, 800 x 400 at DPR 2, three runs interleaved with the version before; the stacks' own cost is in `npm run bench:core`): bars of 10 series x 10,000 positions in a rolling window, a position per tick at 60 Hz, take ~4.0 ms of JavaScript a frame (p95 ~5.8) instead of ~6.4 (p95 ~8.4), with no dropped frames either way, against ~3.6 ms for the same bars grouped; areas of a series field stacked the same way ~3.7 ms. At 10 Hz frames alternate between two clock states for every variant (~4.4 against ~7.6 ms in the fast one). The edges cost 16 bytes per layer and x, so series sharing few x cost up to the number of series times their rows. Areas and bars also normalize nonnegative values per position with `stack: "fill"`, as histograms normalize per bin; area `"center"` and `"wiggle"` offsets retain raw thickness, with optional `stackOrder: "inside-out"`. Both orientations, legend renormalization, facets/subplots, zoom, static export, and share/raw keyboard readings use the same engine across TypeScript, Python, React, Vue, and Svelte. Mixed signs require ordinary stacks; new modes keep per-layer missing gaps. Fill/center in input order retain incremental updates; wiggle and inside-out rebuild the retained window, with inside-out value updates immediate. Comparative timing of these new modes is not yet measured; the measurements above concern ordinary stacks. | Documented. `stack` groups series, `stackStrategy` (same sign, all, positive, negative) and `stackOrder`; series are matched by category on category axes and by data index otherwise, so series on time or value axes must share their x in order, and a series without a value at a position is skipped rather than filled (from its source, 6.1). | Documented. `areaY` stacks implicitly at repeated x by series (`z`), with `stack()` layouts for order, offset (diverging, normalize, center, wiggle), and reversal; a missing position and series pair counts as zero for the layout without a point of its own, so each area is drawn through its own rows. | Documented. `stacked: true` on the value scale stacks datasets matched by their index-scale value; filled lines (`fill: "stack"` or `"-1"`) run through each dataset's own points, so a dataset missing an x adds nothing there and its fill joins its neighbors (from its source, 4.5). | Documented. `stackgroup` on scatter traces with `stackgaps` "infer zero" (the default) or "interpolate" (constant beyond a trace's ends), `groupnorm` for fraction or percent stacks, and orientation; bars with `barmode: "stack"` or "relative". |
| Scatter | Point mark with per-series color, radius, and opacity; every point is drawn. Series of 100,000+ points use WebGL (loaded on demand): ~17 ms to mount 1M points, ~3.7 ms per zoom step, both ahead of Plotly's WebGL. Nearest-point hover through a spatial grid index (~0.4 ms per move at 10k points). Streaming clouds, whole columns or split by a series field, upload only new points (a million points in two series at 1,000 rows per tick: ~3 ms of JavaScript per frame instead of ~13 ms before). Size (bubbles), continuous color (named sequential and diverging schemes, midpoints), category color (the theme's palette per value), opacity, and eight symbol shapes by field, with size, shape, and color keys; outlines (`stroke`, `strokeWidth`); encoded and outlined points are drawn on the CPU, not WebGL. Points on category axes (strip and dot plots, on either axis or both, over bars too), in facets and subplots with each panel's own categories; these are always drawn on the CPU; series dodge within a band, and points jitter by a hash of each row and a seed or pack as a beeswarm (`swarm`: in order of value without overlap, laid out again on resize and zoom; bounded, about 2 ms for 10,000 points in a band). | Documented. `large` mode for big scatter. | Documented. `dot` mark; one scene node per point. | Documented. Scatter/bubble. | Documented. SVG and WebGL scatter. |
| Heatmap | Heatmap mark over category, number, or time fields, drawn as one image (Canvas `drawImage`, PNG inside SVG), with a color legend and cell tooltips. Number and time fields place cells along number and time axes that zoom, pan, and brush like other marks' axes and that other marks share: edges halfway between distinct values, or a fixed `xStep` / `yStep` that leaves gaps where values are missing, computed from the data, never the view; boundaries between local days fall halfway in elapsed time across clock changes (calendar weeks end at the zone's midnights); on time axes with breaks, cells either side of a break meet at its seam. `xBanded` / `yBanded` give one band per distinct value instead, and `x1`/`x2` (`y1`/`y2`) place cells between each row's edges, as binned data has them. Rows sharing a cell combine by `reduce` (last, mean, sum, min, or max), the same at every zoom. Calendar heatmaps of a date field in the chart's time zone: weeks along a zoomable time axis by weekday (any first day of the week), or months by day of the month, with missing and nonexistent days empty. Named sequential and diverging schemes, fixed color domains, and midpoints. No cell limit: a grid larger than the plot is drawn at the plot's device resolution, each pixel the mean (or with `sampling.reduce`, the max or min) of its block of cells, weighted by area where cells are unevenly spaced, and tooltips and the keyboard still find the single cell under the pointer (by binary search: at 10M cells a keyboard step along a row, or down a column within 32 rows, takes microseconds, where it scanned every cell, ~0.3 s; longer jumps still scan); memory follows the table's rows and the plot's pixels, not the cell count. Measured in a one-off run outside the committed suite (headless Chrome 154, Apple M6, 800 x 400 chart at DPR 2; competitors not run at these sizes): a sparse 4,000 x 4,000 grid of 200,000 rows mounts in ~42 ms and keeps ~15 MB beyond the source arrays, a dense one (16M rows) mounts in ~0.28 s, and 10M rows over 10,000 x 10,000 cells in ~0.22 s; band indices and the tooltip index take up to 12 bytes per row, and the first tooltip after a change builds that index (~0.1 s at 10M rows). Scene construction in Node (one-off, same chart, medians of 5 runs, interleaved A/B against banded number fields, which could not zoom): a dense 2,000 x 2,000 grid builds its first scene in ~90 ms either way and repaints a zoomed view in ~22 ms (a repaint took ~34 ms); 10M rows over 10,000 x 10,000 cells take ~380 ms (~375 ms) and ~93 ms per zoomed view (~85 ms per repaint); the first tooltip takes the same ~8 ms and ~170 ms (building the index); unevenly spaced cells cost more, ~175 ms for 2,000 x 2,000 (~105 ms banded), which also builds the tooltip index, and ~55 ms per zoomed view. Split by facets (each panel's cells from its own rows, never merged with another panel's), with x and y categories or number and time scales shared or each panel's, row's, or column's own, in facets and subplots, and one color scale across panels. No binning of its own (2D histograms bin rows; see below), no log axes yet, and calendar month labels are the time axis' ticks rather than labels aligned to week columns. | Documented. Heatmap series on a Cartesian grid of two category axes (its development build refuses others), on a matrix, on maps, or on a calendar coordinate system. | Documented. `cell` mark with a D3 color scale. | No built-in heatmap (third-party `chartjs-chart-matrix`). | Documented. Heatmap traces rendered as an image, at cell coordinates (`x` and `y`, or `x0` and `dx`) on zoomable number, date, or category axes, with `xgap` / `ygap`. |
| Candlestick | Measured. Candlestick mark over number, time, or category x: rising candles hollow, falling ones filled, all four prices in tooltips. ~0.9 ms for 200 candles. With more candles than pixel columns, each column's candles merge into one (the first open, highest high, lowest low, and last close): ~7.5 ms for 100,000, where merged candles show direction by color only. OHLC bars are a `variant` of the same mark (not measured separately); a volume pane is a subplot sharing x. | Measured. Built-in `candlestick` series: ~2.4 ms for 200 candles; its `large` mode draws high-low lines without bodies, ~52 ms for 100,000. | No built-in candlestick. | No built-in candlestick (third-party `chartjs-chart-financial`, not measured). | Measured. Built-in `candlestick` and `ohlc` traces, drawing every candle: ~4.3 ms for 200, ~640 ms for 100,000. |
| Financial charts | Time axes that leave out breaks (`timeBreaks`): days of the week, daily clock spans, calendar dates, and spans of instants, in the chart's time zone with clock changes; ticks never fall inside a break and move to the session that opens after it, labeled by the day or month that begins; data inside breaks is hidden while lines join across; zoom, pan, brushes, tooltips, and level of detail work in time shown. One-off measurement (Node, scene construction, a 1M-point line over ten years of New York sessions): ~4 ms to mount (~2.4 ms without breaks), ~0.5 ms per zoomed view (~0.1 ms), ~1.2 ms per streamed tick of 1,000 points (~0.6 ms). Candlesticks and OHLC bars (`variant: "ohlc"`), and crosshair labels on the axes (`tooltip.axisLabels`). A range navigator (`rangeNavigator`): a strip under the plot drawing its lines, areas, points (sampled to one per pixel), bars, and candlesticks over the whole x axis, whose window pans and zooms by dragging (dragging elsewhere selects, a double click resets) and is three keyboard sliders with value texts; it follows breaks, streaming data, wheel zoom, brushes, and synced charts, and SVG, PDF, and PNG export draw it. With facets or subplots that share x, one strip under all the panels draws every panel's marks (each panel's part apart, over that panel's y scale) and moves the x range they share; x scales per panel are refused. One-off measurement (Chrome, JavaScript per frame): dragging the window over a 1M-point line ~2.6–2.9 ms a move, as panning without one; with a zoomed 100,000-point rolling window streaming, ~2.3–2.4 ms a frame instead of ~1.5–1.6 ms; under 12 facet panels of a 100,000-row line ~0.5–0.6 ms a move (~0.2–0.3 ms panning without), under 4 subplots of 100,000 rows with a dense volume panel, column reduction takes drag p50/p95 from 2.550/2.820 to 0.340/0.445 ms and retained overview buffers from 2.40 MiB to 223 KiB; a single 1M-bar chart goes from 21.970/23.090 to 0.420/0.475 ms and 22.89 MiB to 110 KiB. Overview rebuild p50 is 1.225 → 1.700 ms and 6.930 → 10.650 ms respectively: checking placed rectangle footprints adds rebuild work, while dragging reuses the bounded geometry. A separate minified Node measurement of 1M rows with only 20 usable bars takes p50 5.944–6.086 → 2.505–2.775 ms after combining density and exact geometry in one source scan. The drag and dense rebuild figures use one-off before/after production Canvas measurements in Chrome 154, DPR 1, three alternating rounds; methodology and p95 rebuilds are in [Range navigator](architecture.md#range-navigator). Dense bars cover every CSS column their placed rectangles intersect, including wide bars and clipped edges, and keep each column's extreme per sign, with the extreme bar's color (ties: first series, then row); stacks retain the segments at the most extreme position per sign. Subpixel gaps fill, shorter bars' colors can disappear, and stack proportions show the chosen positions. Sparse bars stay exact; missing, zero-area, and wholly clipped rectangles do not count toward density. Opt-in dashed seam markers (`x.seams`) behind data in SVG, Canvas, and PDF, thinned in chronological order to a minimum CSS-pixel spacing (default 40); the navigator draws none. No technical indicators beyond derived rolling windows, no drawing tools; dense navigator bars still require a full scan to rebuild after data changes; candlesticks remain one glyph per row. | Documented. Axis breaks since 6.0 (`xAxis.breaks`): each break an explicit `start` and `end` with a visual `gap`, on value, log, and time axes (not category), so recurring weekends and sessions are listed one by one; its candlestick examples use a category axis of trading days instead. `axisPointer` labels values on the axes (by default with the `cross` pointer). OHLC bars through a custom series (an example), not a built-in style. `dataZoom` of type `slider`: a strip with a shadow of one series (a line and an area), handles that label their values, dragging across the shadow to select (`brushSelect`), along x or y and on category axes, controlling one axis or several grids' (`xAxisIndex` as a list); no keyboard operation documented. | No candlesticks, axis breaks, axis pointer labels, or range navigator documented. | Documented. The `timeseries` scale spreads data points equidistant, which closes gaps between them (not breaks of time); candlesticks and OHLC bars only through the third-party `chartjs-chart-financial`; no axis labels at the crosshair; no range navigator (`chartjs-plugin-zoom` zooms and pans without an overview). | Documented. `rangebreaks` on date axes: `bounds` with a `pattern` of "day of week" or "hour", or `values` with a `dvalue` size; `candlestick` and `ohlc` traces; spike lines (`showspikes`) across the plot or to the axes, with no documented labels on the axes. `xaxis.rangeslider`: the traces drawn again in a strip (`thickness`, 15% of the plot by default), shown by default under candlestick and OHLC charts, with `yaxis.rangemode` for its y range; no keyboard operation documented. |
| Histogram | Measured. Histogram mark binning a number or time field into round or calendar bins (or a fixed step), overlaid or stacked by series, as counts, percent, or probability density. On the same fixed grid as Plotly: ~0.8 ms for 10,000 values, ~10 ms for 1,000,000. Split by facets, each panel counts its own rows, in bins chosen from the rows of the panels sharing its binned axis (one set of bins, or each panel's, row's, or column's own), with percent and density over each panel's counts and stacks within each panel. Bins are recomputed when the data changes. Vertical or horizontal with exact explicit edges, probability, common normalization including hidden series, cumulative bars (density integrates widths), and opaque dodged series; these additions are correctness-tested in SVG, Canvas, static SVG, and PDF, but their performance has not been compared. 2D histograms of x and y are in the next row. | No built-in histogram (bin with a dataset transform or by hand). | No built-in histogram. | No built-in histogram. | Measured. `histogram` trace with automatic or fixed bins and many normalizations: ~3.7 ms for 10,000 values, ~77 ms for 1,000,000. |
| Contours and 2D histograms | Measured in Node only (`npm run bench:core`, Apple M6; competitors not run). `contour` mark over a rectilinear grid of rows (evenly spaced or not) or a matrix table (`fromMatrix`: coordinates once each, not per grid point): lines at thresholds, or disjoint filled bands with holes, by marching squares with the asymptotic decider for saddles; missing values leave holes; a stepped legend of bands; tooltips at the pointer inside a band region or near a line, keyboard reading of bands and their regions, a text summary per band; facets. Tracing ten thresholds of a smooth 1,000 x 1,000 grid takes ~14 ms, of uniform noise (each cell crossing six of the ten on average, 7.6M points) ~550 ms; tracing is kept, so recoloring redraws in ~0.25 ms (noise: ~7 ms) and zooming projects again in ~2 ms (noise: ~75 ms). Exports keep every traced point (no simplification): ten bands of a smooth 200 x 200 grid are ~200 KB of SVG (~41 KB gzipped). No contour labels, smoothing, log axes, or time breaks; scattered points need binning or a density estimate first (Python's `herceg.express.kdeplot` makes one). 2D histograms (`histogram` with `x` and `y`): the 1D bins along each axis (counts, explicit edges, steps, calendar bins), weights, counts matching NumPy's `histogram2d`, frequency, probability, percent, and density per unit of bin area, drawn as one image with heatmap tooltips and keyboard steps; a million points in 50 x 50 bins are counted and drawn in ~12 ms. No hexagonal bins, `histfunc`-style averages, or 2D histogram contours. | Not built in: no contour series (ECharts-GL's surface draws wireframes, not contour lines), and 2D histograms are heatmaps of counts binned by hand (ecStat's histogram transform is one-dimensional). | Not implemented. | Not implemented (no built-in heatmap; contours need a plugin or a custom chart). | Documented. `contour` trace (z on a grid with x and y, filled, line, or heatmap coloring, contour labels, gap connection, line smoothing), `histogram2d` (count, sum, average, min, or max per bin; several normalizations), and `histogram2dcontour`; Plotly Express `density_heatmap` and `density_contour` (contours of a 2D histogram rather than a kernel density). Not measured here. Others: Observable Plot has `contour` and `density` marks (d3-contour's marching squares over a regular grid, each threshold's region drawn over the lower ones rather than as disjoint bands) and `hexbin` and 2D `bin` transforms; Vega has `isocontour` and `kde2d` transforms. |
| Pie and donut | Pie mark with an inner radius for donuts: slices sum a value (or count rows) per category, largest first, with 2 px gaps that work on any background, labels beside the pie with leader lines (the smallest dropped when they do not fit), legend toggling that gives the rest the circle, and slice tooltips, hover outlines, and arrow-key reading. Drawn as SVG and Canvas arcs, and as cubic curves in PDF. Pies draw in each facet panel (each its panel's rows, with one legend and one color per category) or in a subplot of their own beside panels with axes. No labels inside slices, no rose or half-circle layouts yet. | Documented. `pie` series with `radius` for donuts, `roseType`, label lines, selected offsets, start angle, and many label layouts. | Documented. `pie` in `@tanstack/charts/polar`, with radial arcs and bars. | Documented. `pie` and `doughnut` chart types; labels inside or outside need a plugin. | Documented. `pie` trace with `hole`, `textposition` inside or outside, pulled slices, and subplot domains for several pies. |
| Box plot | Raw values per category or one precomputed box per row (`low`, `q1`, `median`, `q3`, `high`, optional `count`): vertical or horizontal, grouped by series, with statistic tooltips, keyboard reading, summaries, and facet-local categories. Raw whiskers use Tukey's 1.5 IQR, the full range, or a nonnegative IQR multiple; precomputed endpoints are supplied, with no outliers. Notches use median ± 1.57 IQR / √count (precomputed count required), without clamping, in SVG, Canvas, static SVG, and PDF. Raw statistics recompute and sort when data changes; precomputed input reads columns without expanding counts or creating observation objects. No means yet; box plot performance has not been compared. | Documented. `boxplot` series over precomputed summaries, or the `boxplot` dataset transform; outliers as a separate scatter series. | Documented. `boxX`, `boxY`, and `boxRows` with a summary transform (quartiles, Tukey whiskers, outliers). | No built-in box plot (`@sgratzl/chartjs-chart-boxplot` plugin). | Documented. `box` trace computing statistics from raw values, with notches, means, standard deviations, and points; `violin` traces. |
| Violin | Violin mark over raw values: Gaussian kernel densities (Silverman bandwidth per group, or one bandwidth for all), independently as wide at their peaks, reaching two bandwidths past the extreme values. Vertical or horizontal, grouped side by side or split into halves for at most two observed series values (first left/below, second right/above); missing or hidden partners leave their half empty. Inner box (default), dashed quartiles with a solid median, or none; separate colors, legend entries, statistic tooltips, keyboard stops, and summaries. Facets with per-panel categories, SVG, Canvas, static SVG, and PDF. Each group copies and sorts values for statistics; density uses linear binning and a convolution of at most 512 points, recomputed when data changes. No count or area scaling, points, means, or hard span yet; violin performance against competitors is not measured. | No built-in violin series; drawn with a custom series. | Documented. `violinX` and `violinY` draw mirrored profiles from prepared, normalized widths; densities and statistics are computed by the application. | No built-in violin (`@sgratzl/chartjs-chart-boxplot` plugin). | Documented. `violin` trace computing a kernel density from raw values (Silverman's rule by default), with soft, hard, or manual spans, width or count scaling, split sides, an inner box, a mean line, and points. |
| Treemap and sunburst | Treemap and sunburst marks over a tree from path fields or node and parent fields, sized by summed values or row counts: squarified rectangles with group headers, or rings by depth; colored by top-level group, legend toggling of groups, names where they fit, tooltips with each node's path and share, and depth-first keyboard reading. Weights must be finite and non-negative. Drill-down with the shared `interaction.zoom`: click or Enter on a node lays out its subtree (keys and colors kept), Backspace, a sunburst's middle, and a breadcrumb strip (drawn in exports, with native buttons for the pointer, Tab, and screen readers) go back; `setDrillRoot` and `getDrillRoot` with a `drill` event (React `onDrill`, Vue `@drill`, Svelte `ondrill`). A click selects a node's rows through `rowSelection` (then Enter drills). One-off measurement (Chrome): drilling into a region of 10,000 leaves ~1.5 ms a frame, back out ~2.2 ms. Drilling in facet panels (which share one root) and subplots (each its own) too; no icicle layout or level styles yet. | Documented. `treemap` series (drill-down, breadcrumb, level styles) and `sunburst` series (root navigation, level styles), with visual mapping of values. | Documented. `hierarchy/treemap`, `hierarchy/sunburst`, and `hierarchy/tree` marks. | No built-in treemap or sunburst (`chartjs-chart-treemap` plugin). | Documented. `treemap` (with a path bar), `sunburst`, and `icicle` traces from ids and parents, with branch values and click-to-zoom. |
| Gauge | Gauge mark: the last finite value of a number field on a 240-degree dial (0 to 100 by default), so appending rows moves it; optional colored bands as a ring outside the track, the value's arc in its band's color, Intl number formats, values past the ends filling the dial while the text shows them as they are, and an item for tooltips, hover and click events, and keyboard reading. Drawn as SVG and Canvas arcs and in PDF. One value per dial; no needle, ticks, threshold marker, or bullet layout yet. Not benchmarked. | Documented. `gauge` series: progress bar, pointer, axis line colored by ranges, ticks and labels, several pointers per dial, start and end angles, and a formatted `detail` value. | Documented as a composition, not a mark: `pie` over a partial angle range with `radialArc` and `radialText` (`@tanstack/charts/polar`); needles from further marks. | No built-in gauge; a `doughnut` with `circumference` and `rotation` draws a partial ring (plugins such as `chartjs-gauge` add needles). | Documented. `indicator` trace in `gauge` mode: angular or bullet shape, a value bar, colored `steps`, a `threshold` line, and number and delta displays. |
| Funnel | Funnel mark: a centered bar per category whose width is proportional to its summed value (or row count) relative to the largest stage, in input or value order, with faint connectors that carry no data, stage names, and each stage's value and share of the first stage on or beside its bar; tooltips add the share of the previous stage. One color for all stages; no area-proportional (trapezoid) layout, per-stage colors, or legend yet. Not benchmarked. | Documented. `funnel` series of trapezoids, sorted ascending, descending, or as given, with gaps, label positions, and size and alignment options. | Documented as a composition, not a mark: one `areaX` trapezoid per stage from derived endpoints. | No built-in funnel (`chartjs-chart-funnel` plugin). | Documented. `funnel` trace (bars with connectors; text with percent of the initial, previous, or total) and `funnelarea` trace (stacked trapezoids). |
| Radar | Radar mark from long data (a category field for spokes and a value field) or wide data (a number field per spoke, a row per polygon), 3 to 100 spokes and a polygon per series with a translucent fill, outline, and dots; one linear scale for every spoke (round by default, or a fixed domain, with values beyond it drawn at the rim and flagged in tooltips), polygon rings labeled along the first spoke where labels fit, spoke names outside the rim that shrink the radar (to a limit) and are shortened or dropped when they do not fit, outlines broken and fills left out at missing values, legend toggling, and tooltips, hover outlines, and keyboard reading per value. No per-spoke scales, circular grids, value labels, or stacked or rose layouts yet; not benchmarked. | Documented. `radar` component with an `indicator` per spoke, each with its own `max` (and `min`), polygon or circle shapes, split areas, and `radar` series with area styles and symbols. | Documented. Composed in `@tanstack/charts/polar` from `radialGrid` (polygon rings), `angleGrid`, and `radialArea` and `radialLine` with a closed curve; values normalized by the application. | Documented. Built-in `radar` chart type on a `radialLinear` scale, with point labels, backdrop tick labels, filled datasets, and circular or polygon grids. | Documented. `scatterpolar` traces with `fill: "toself"` on polar axes (category angular axis), with line, marker, and per-trace hover options; any polar axis styling. |
| Sankey | Sankey mark over one table of flows: source and target category fields, links summing a value or counting rows. Columns by longest path with sinks in the last column and six passes of relaxation, as d3-sankey does; translucent bands in the source node's color; names and values beside the nodes, inside the diagram, shortened or left out when they do not fit; tooltips, hover outlines, clicks, and keyboard reading of nodes and links. Links that would close a cycle are left out and counted in the chart's description. Not benchmarked. No draggable or hand-placed nodes, vertical orientation, circular links, or highlighting of a node's links yet; the layout is recomputed whenever the table changes. | Documented. `sankey` series from `nodes` and `links`: `nodeAlign` (justify, left, right), horizontal or vertical `orient`, `nodeWidth`, `nodeGap`, `layoutIterations`, draggable nodes, per-depth `levels` styles, links colored by source, target, or a gradient, edge labels, and adjacency or trajectory emphasis. Cyclic data is an error. | Documented. `sankeyDiagram` in `@tanstack/charts/network/sankey` (bundling d3-sankey) lays out separate `nodes` and `links` and composes ordinary marks (`link`, `rect`, `text`) over the positioned node and link rows; alignment, node and link sorting, responsive `nodeWidth`, `nodePadding`, and `inset`, and iterations are options. Cycles, negative values, and duplicate node keys are errors. | No built-in Sankey (the `chartjs-chart-sankey` plugin). | Documented. `sankey` trace (full bundle, not `plotly-basic`) from node and link arrays: `arrangement` (snap, perpendicular, freeform, fixed), nodes placed by `x` and `y`, draggable nodes, node and link hover, and circular links for cyclic data. |
| Network graph | Graph mark over a table of links (source and target category fields; an optional value summed per pair of nodes, either way round, setting link widths) and an optional table of nodes (a category `color` field coloring nodes, with a legend that toggles categories without moving the rest, and a size field by area). Three layouts (`layout`): `"force"`, d3-force's simulation and defaults (springs, many-body repulsion with a Barnes–Hut quadtree above 150 nodes, 300 ticks) started from pivot MDS rather than a spiral, so rings and chains do not fold, connected components packed in rows; `"circular"`, by group then degree, input order, or name, labels outside; and `"layered"` (Sugiyama: longest-path layers along each link's source-to-target direction, depth-first cycle breaking with reversed links drawn as they are and counted, barycenter sweeps keeping the fewest crossings, barycentric coordinates with order-keeping least squares, curved links through bend points, four directions). Every layout is deterministic for the same data and changes (in a page, data changing during layout work carries the progress so far). Positions persist by node: after a data change nodes that remain start where they were and new ones beside their neighbors, and only nodes within two links of the change move (force); a circle turns to move nodes least; a layered layout keeps its order. Ringed nodes, translucent links tinted by category, names beside the most connected nodes where they cover no other node or name; tooltips, hover outlines, clicks, and keyboard reading of nodes and links; SVG, Canvas, and PDF. Directed links (`directed`: a link per ordered pair, bowed apart both ways, arrowheads at the target's ring) and link labels (`linkLabelField`). Nodes dragged with the shared `interaction.drag` (Shift-arrow keys, or Alt+Shift with zoom on; Escape cancels a drag), with `setItemPosition` and an `itemMove` event; in a force layout the nodes near a dropped node settle around it over 0.3 s (at once with reduced motion; `settle: false` turns it off), the settled picture depending only on where nodes are held, not the order of moves. Moves stay while their node does, across data changes, adapter re-renders, Python widget updates, and Streamlit reruns (`carryNodePositions` in `herceg/spec` for any app that remakes charts from specs). Layout work runs on the main thread in steps of a few milliseconds, in frames that do not draw, so pages stay at 60 frames a second but for the frames that draw a large network's progress (four a second, 50–80 ms at 200,000 links); a network draws at most 50,000 nodes and 200,000 links (refused with an error beyond). One-off Chrome measurements (below): force layout ~1.2 s at 5,000 nodes / 20,000 links and ~12 s at 50,000 / 200,000; circular ~30 ms and ~110 ms; layered ~0.1 s and ~1 s; pan and zoom frames ~2 ms at 5,000 / 20,000 and ~20–47 ms at 50,000 / 200,000 on Canvas; hover ~0.1 ms. Zoom and pan through `interaction.zoom` (true or "xy"), with the same wheel, drag, double-click, Shift-arrow, plus/minus/0, toolbar, and viewport API as maps, in layout coordinates; nodes keep their pixel radii. Lassos select visible nodes' rows and dim other nodes and links; nodes and links select their rows of the nodes or links table through `rowSelection`. React, Vue, Svelte, Python widgets and Streamlit share these options and view events. Networks draw in facet panels (one layout of the whole network, each panel its rows' links, totaled there) and subplots (each its own layout, view, and moves). No WebGL nodes or links, given positions, parallel labeled links, or neighbor highlighting yet. | Documented. `graph` series from `nodes` and `links` with `layout` `none` (given positions, also on cartesian, polar, or geo coordinates), `circular` (with `rotateLabel`), or `force` (`repulsion`, `gravity`, `edgeLength`, `friction`, `initLayout`, an animated or instant layout); `categories` with a legend, draggable nodes (an animated force layout keeps running, the dragged node fixed), roam (zoom and pan), edge arrows and labels, curved parallel edges, and adjacency emphasis on hover. No layered layout (the separate `tree` series lays out trees only). Its force layout (6.1.0) sums repulsion over every pair of nodes at each step, so large networks call for precomputed positions; not benchmarked here. | Documented. `forceLayout` in `@tanstack/charts/network/force` runs a stopped d3-force simulation synchronously and deterministically with explicit forces (link, many-body, center, collide, x, y, or custom d3 forces) and returns node and link rows with padded domains, drawn with ordinary marks (`link`, `dot`, `text`); resizing remaps without another simulation. Not a live simulation: dragging is left to the application. | No built-in network (the `chartjs-chart-graph` plugin adds graph and force-directed graph charts). | Documented. No network trace and no layout: the documentation draws networks as a `scatter` trace of nodes and one of line segments for links, with positions computed elsewhere (networkx in Python), so dragging nodes, layouts, and persistence across updates are the application's. |
| Geographic maps | `geoshape` regions (choropleths by a number field on a continuous scale, or by category with a legend that grays categories out) and `geopoint` points and bubbles (sized by area, colored by series or a number field, ringed, largest first) on one projection: Equal Earth, Natural Earth, Mercator, equirectangular, or Albers' conic equal-area, with a central meridian and a fit to the data, the world, or a box of degrees. Shapes are a packed geometry column (GeoArrow-style offsets, binary in specs, codes per row shared by derived tables) from GeoJSON, GeoPandas, or Shapely without per-vertex objects; edges are planar in longitude and latitude, cut at the seam and the Mercator limit. Tooltips, hover outlines, clicks, keyboard reading, and a summary; SVG, Canvas, static SVG, and PDF; React, Vue, Svelte, and Python (with a Plotly-style `geojson`/`locations` join). Zoom and pan through the shared `interaction.zoom` and viewport (ranges of the projection's plane, `viewport` events, `setViewport`): wheel at the pointer, drag, double-click, Shift-arrow keys, plus and minus, and a toolbar; tooltips, keyboard reading, and `toSVG()` follow the view. Lasso (`brush: "lasso"`) and click selection of regions and points as rows through `rowSelection`, dimming the rest. Small multiples of maps (layers split by a facet field or repeated as a base map, every panel fitted alike and zoomed together) and maps in subplots, each with its own view. Not benchmarked against other libraries: one-off timings in Node for 200 regions of 1,000 vertices and 10,000 bubbles are ~20–30 ms for the first drawing, ~11 ms at a new size, ~2 ms to redraw after a value change, ~2 µs to find the region under the pointer; in Chrome, a pan frame of 200 regions of 1,000 vertices takes ~0.6 ms of the main thread (shapes reused, moved) and a zoom step to a new projection level ~5 ms on Canvas, ~9 ms in SVG. No base maps, globes (orthographic) or other spherical rotation, lines (routes), labels on regions, custom projections, or views synced between charts yet. | Documented. `map` series and the `geo` component over GeoJSON or SVG registered with `registerMap`, colored through `visualMap`; `scatter`, `effectScatter`, `lines`, and `heatmap` series on geo coordinates; `roam` zoom and pan, region labels and emphasis, and a `projection` of `project`/`unproject` functions (or a d3-geo projection stream). No bundled base maps. | Documented. `geoShape` in the opt-in `@tanstack/charts/geo` entry draws GeoJSON (polygons, lines, and points sized by a value) through any d3-geo projection factory fitted to the plot, including globes, with sphere and graticule layers; boundaries are the application's own GeoJSON. | No built-in maps (the `chartjs-chart-geo` plugin adds choropleth and bubble map charts). | Documented. `choropleth` and `scattergeo` traces with built-in base maps (countries, US states) and `locationmode`, or GeoJSON with `locations` and `featureidkey`; many projections (including orthographic and Albers USA), `fitbounds`, zoom and pan; tile-based maps (`choroplethmap`, `scattermap`) as well. |
| 3D charts | `point3d` scatter (series colors or a number field on a color scale), `line3d` lines (a path per series through its rows in table order, broken where a row has no value, a constant width on screen), and `surface` height fields over a grid of rows (number, time, or category x and y; irregular spacing; holes for missing values; up to 1,048,576 grid points, 250,000 on the CPU), sharing one box with x, y, and z axes (linear, log, time), a cube or a given aspect, and an orthographic (default) or perspective camera. Large charts (20,000 points, 10,000 surface cells, or 20,000 line segments, opaque, surfaces without wireframes) are drawn by WebGL with one depth test for every mark, so crossings are exact: points as sprites, lines as round-capped ribbons, cells as triangles with the CPU's flat colors and shading; nothing is uploaded while turning, and the pointer, keyboard, and description read the data. Everything else, and every export, is drawn back to front as ordinary SVG, Canvas, and PDF geometry: exactly for points and one surface with points, approximately for lines (cut over a surface's cells and sorted by depth) and for several surfaces. Drag to turn, wheel zoom (opt-in), double-click reset, Shift+arrow keys and +/− to turn and zoom, buttons for people who cannot drag, a `camera` event and `getCamera`/`setCamera` (targeted by `{ panel }`, subplot events carry `panels`); CPU-rendered subplots beside other panels, with independent cameras and cached geometry and Canvas rasters (standalone charts retain WebGL); tooltips and keyboard reading of every point, line sample, and grid point with their values. Measured (see 3D charts below): turning a 1001 x 1001 surface (a million cells) ~0.4 ms of JavaScript, 60 frames a second turned every frame (Plotly: ~67 ms, 15 frames a second); mounting it ~0.15 s (Plotly ~0.46 s); 100,000 cells ~0.3 ms (Plotly ~12 ms; Herceg on the CPU ~92 ms); 1,000,000 points ~0.4 ms (Plotly failed to allocate); 10,000 points ~1.4 ms (Plotly ~5.2 ms). Memory at a million cells from a matrix table (`fromMatrix`): ~8.7 MB of heap (each grid point's height in the box) and 49 MB of GPU buffers; Plotly ~1.2 MB of heap (its GPU memory not measured). No meshes, parametric surfaces, isosurfaces, volumes, contours, 3D text or bars, translucent or wireframed surfaces on the GPU, color-scaled lines, or specular lighting; GPU edges are not antialiased; labels stay horizontal; flat shading only. | Documented. [ECharts-GL](https://github.com/ecomfe/echarts-gl/blob/master/test/grid3D-viewport.html) (a separate package) supports multiple `grid3D` viewports routed with `grid3DIndex`: `scatter3D`, `bar3D`, `line3D` (polylines through points, with width and color by value), `lines3D`, `surface` (including parametric surfaces from equations or sampled grids, with wireframes), `polygons3D`, `map3D`, and `globe`, all in WebGL with realistic shading, post effects, and antialiasing; mouse orbit, zoom, and pan; no SVG or vector export of 3D scenes; not measured here (its compatibility with ECharts 6 was not checked). | Not implemented. | Not implemented (no 3D chart types). | Documented. [3D subplots via scenes](https://plotly.com/javascript/3d-subplots/) (`scene`, `scene2`, …), each with its own camera. `scatter3d` (markers, lines with width and color scales, and text), `surface` (with contours and lighting, including parametric x and y from 2D arrays), `mesh3d` (vertices and triangle indices, or a Delaunay or alpha-shape triangulation, colored per vertex or face), `cone`, `streamtube`, `isosurface`, and `volume`, all WebGL (gl3d), with orbit, turntable, zoom, and pan modes and camera relayout; no SVG or vector PDF of 3D scenes (static export rasterizes them). Measured below: as fast as Herceg's GPU path at 100,000 cells turned every frame, slower at a million. |
| Data preparation | Derived tables in the spec and in TypeScript (`derive`) and Python (`hg.derive`): filter and calculate with portable expressions, bin, aggregate (count, sum, mean, median, quantiles, min, max, stdev, variance, distinct, first, last), rolling windows, sort. Computed in the browser over typed columns and kept current as the source streams (incrementally for row-by-row steps): ~15 ms to filter and calculate 1M rows, ~9 ms to aggregate them by 20 groups, ~10 µs to follow a 100-row append (`npm run bench:core`). Row pivots (`herceg/pivot`): a view's rows as a crosstab whose long table of observed combinations charts read (see Data grid). No joins or calendar bins yet. | Documented. `dataset.transform` with filter, sort, and registered external transforms (ecStat for regression and clustering). | Data is prepared by the application. | Data is prepared by the application. | Documented. Plotly.js `transforms` (filter, groupby, aggregate, sort) are deprecated; Plotly Express prepares data in pandas. |
| Data grid | `herceg/grid`: a DOM grid over a row view that mounts only the rows and columns in view, sorts by header clicks (several keys with Shift) through the view, and selects rows into a selection store other views can read; it follows the WAI grid pattern (one tab stop, a focused cell kept mounted while scrolled away, polite announcements) and takes the charts' themes. Nested groups (a level per grouping field) from `groupRows`, whose aggregate tables (count, sum, mean, min, max at every level, a parent's from its rows, never from its groups' means; updated incrementally as rows are appended and as a rolling window drops them) charts draw too: header rows with aggregates at every level, expansion by key path, each level's groups sorted among their siblings by key or aggregate and rows within their group, group selection of every row below into the same row set with mixed checkboxes, and the WAI tree grid pattern with levels. Columns resize and move by dragging headers (previewed once a frame, Escape to cancel), by keys on a focused header, or from a column menu that also pins them left or right, hides them, and shows hidden ones; the layout is the model's column list, which applications can save and restore. Pinned columns stick to the edges in the same row elements (one row of cells in visual order for screen readers), and scroll with the others in grids too narrow to hold them. ~32 KiB gzip with the data layer it needs, and row groups about 7 KiB more (one-off single-bundle measurement), none of it in a chart's bundle. Measured against TanStack Table with TanStack Virtual, AG Grid Community, and Glide Data Grid (see [Grids](#grids)): over 100k rows by 20 fields, mounting from the table's typed columns takes ~3.4 ms (TanStack ~77 ms and AG Grid ~75 ms with the conversion to row objects they need, Glide ~1.7 ms), sorting by a number ~16 ms to the correct frame (TanStack and AG Grid ~80 ms), and the mounted grid keeps ~2 MB of heap without copying the data (TanStack ~54 MB and AG Grid ~27 MB on top of ~62 MB of row objects); it keeps up with 1,000-row appends at 10 Hz under a sort at every size, as fast as plain typed-array code at 1M rows, and mounts 1M x 100 fields, where the tabs of TanStack and AG Grid crash. Weaker than Glide's canvas on scroll steps (~2.5–5.5 ms against ~1 ms), and than plain typed-array code on filtering at 100k rows. Grouping 1M rows by a category (five aggregates, sums compensated with error bounds) ~16–21 ms against ~35–50 ms for a derived table's aggregate (which also copies filtered columns), and following a 1,000-row append ~0.1 ms (one-off Node measurements); over 100k rows by 20 fields in one to three levels (100 or 1,000 last-level groups, uniform or skewed), a 100-row append and a grouped grid's frame of model work take ~0.05–0.11 ms collapsed and ~0.16–0.2 ms expanded (~0.5 ms when each change listed the groups' rows again; ~0.22 against ~3.3 ms at 1M rows), and in a rolling window of 100k rows (batches of 500 through two turnovers) ~0.12–0.4 ms at the median and ~0.4–0.8 ms at the 99th percentile, where computing the groups again took ~2.5–6 ms (~0.2 against ~55 ms at 1M rows), ~1.2 ms for a sorted and filtered view (~3.9 ms before), and ~0.75 ms for minimums and maximums of a rising field, which leave with every batch (~2.8 ms before), keeping 8 bytes per row for each aggregated field; with nearly unique keys, whose groups vanish with every batch, ~13 ms collapsed (~38 ms before) and no faster fully expanded (~36 ms) (interleaved Node A/B runs). With two columns pinned left and one right, 100k x 20 and 1M x 100 grids scrolled to their middle mount the same 588 cells as without pins; a scroll step of ten rows takes ~1.0 and ~1.1 ms including style and layout either way, a step of one column across ~0.6 and ~0.95 ms (without pins ~0.65 and ~0.95–1.0 ms, against ~0.64 and ~0.94 ms before column layout existed), and a resize preview frame ~0.6 ms, writing no cell's text. Row pivots (`herceg/pivot`, shown by `herceg/grid/pivot`): one rows field by one pivot field with count, sum, mean, min, and max, as row groups by the two fields (a long table of observed combinations, a table of rows with their totals, and a dense or sparse index between them, absent combinations told from missing values); generated columns named by stable ids that layout, focus, and sorting follow as values stream in, values heading their aggregates in a second header row (`aria-colspan`), row selection of the source rows; limits on generated columns, combinations, and estimated bytes (1,024, 1M, 128 MiB by default), refused before the groups grow, never by dropping values. ~40 ms to pivot 1M rows by 100 row keys (as long as grouping them), ~0.7–1.3 ms to follow a 1,000-row append, and ~46 KiB gzip for a pivot grid (~21 KiB the pivot alone); `herceg/grid` grows ~400 B for it (one-off Node measurements, see [Grids](#grids)). Remote grids (`herceg/grid/remote`): a portable query of filters, sorts, and groups with aggregates that the source runs where the data lives, blocks of typed columns from one snapshot loaded as they scroll into view (placeholders marked busy, failures shown and announced), focus and selection by key or condition, an in-memory reference source, and conformance fixtures for servers; over ten million synthetic rows they show rows after a jump as soon as AG Grid's infinite row model does and, asking for the block ahead, kept every frame loaded while scrolling at 1,000 rows a second where AG Grid's showed placeholders in 96% of frames at 100 ms latency (see [Remote grids](#remote-grids)); AG Grid's server-side row model, which groups and pivots on the server, is Enterprise, and TanStack Table's manual pagination and Glide's async cells leave fetching and caching to the application. ~31 KiB gzip for a remote grid; `herceg/grid` grows ~400 B for the model code it shares (and for fixes of its own to commands that listeners interrupt). No column groups but a pivot's values, several pivot fields, subtotals, sizing to content, remote pivots, or editing yet; grouping, pivots, and column layout are not compared. | Documented. No data grid; the toolbox's `dataView` shows (and lets users edit) the chart's data as text. | No data grid; TanStack Table and TanStack Virtual are separate libraries, compared in [Grids](#grids). | No data grid. | Documented. `table` trace with cell values, formats, fills, and column order; no sorting or selection documented. |
| Interaction | Pan and zoom along x, y, or both through presets (`pan`, `zoom`, `brush`) of gesture bindings (see Embedding in scrolling pages); view limits per scale with `edge` events; brushing along x or y, by rectangle, or by lasso (selections, or drag-to-zoom along zoomed axes); crosshair labels on the axes (`tooltip.axisLabels`); keyboard navigation with Shift-arrow range selection along the axis it steps along (rectangles and lassos are pointer-only); sync channels for cursors, views, and selections (see Synced charts); every facet panel, subplot, layout cell, and inset takes the same gestures on its own scale instances (a subplot's `interaction` overrides the chart's there), with panels sharing a scale following; and `viewport` (one transaction per change: the scale instances it moved and every panel drawing them), `edge`, `select` (with what the selection belongs to), `hover`, and `click` events (also React props, Vue events, and Svelte callback props, and Python widget callbacks with the same payloads); hovered and clicked points name their mark and the row of its table (none for bins, groups, and other points summarizing rows). Tooltips write values with axes' `format` or tooltip-only `tooltipFormat`, show more of the row with marks' `tooltip.fields` (portable, in specs and Python; read by events and the keyboard too), and take content of the application's own with `renderTooltip` (text or a node, React, Vue, and Svelte content in the adapters) inside the built-in box. Linked selections: charts bound to a channel of a selection store (`rowSelection`) write the rows their brushes (as conditions on the marks' fields, which rows streamed in later meet), lassos, clicks, and Space on the keyboard cursor select (a histogram bin's rows by its edges, a box plot's group), and highlight the rows the channel holds, whoever selected them, so charts and grids sharing a channel show one selection; points, bars, lines, areas, error bars, candlesticks, rugs, map regions and points, and network nodes and links dim the rest, and summaries show the selected rows against the whole: a histogram bin's selected part of its bar (normalized as the bar), the selected values' own box or boxen shape over the whole one and their density inside the whole violin, a heatmap or 2D histogram cell's selected share as a square in it, and the selected share of each pie slice, funnel stage, treemap or sunburst node, and Sankey link (pies, funnels, and Sankey diagrams select their items' rows too), each in facet panels and subplots, with "12 of 42 rows selected" in tooltips and the keyboard and the selection in the text alternative (see [Linked selections](#linked-selections)). `select`, `click`, and `rowSelection` events, adapter props, and Python widget and Streamlit callbacks carry the rows. One-off measurement (Chrome, JavaScript per frame, 1,000 rows streamed into a 100,000-row window, interleaved): highlighting a live condition that leaves ~15,000 runs of selected rows takes WebGL points from ~0.3 to ~0.8 ms and a line from ~0.2 to ~1.7 ms (lines cost per run: one run adds ~0.15 ms). A range navigator under the plot (see Financial charts). Maps, treemaps and sunbursts, and networks take the same options: `interaction.zoom` pans and zooms maps' and networks' planes (reported as viewports) and drills into trees (`drill` events), `brush: "lasso"` lassos maps and networks, `interaction.drag` moves networks' nodes (`itemMove` events), and `rowSelection` selects regions, points, tree nodes' rows, and network nodes and links, each with keyboard equivalents (lassos aside, which are pointer-only) and a toolbar of named buttons; 3D charts turn as before. Layout controls and item-change notifications load through the optional item runtime; the ordinary line entry adds 50 B gzip over the version before layout interaction, with its public methods and behavior retained. Brushing, linked selections, the navigator, and these controls are not benchmarked against other libraries yet. | Documented. `dataZoom` (inside, slider), brush component (rectangle, polygon, x or y ranges) whose `brushLink` links selected items across series of one chart and whose `outOfBrush` styles the items outside it, and an event API (`click`, `datazoom`, `brushSelected`, ...). | Documented. Optional controls bound to application state through controlled signals: `keyedSelection` (one point by key, by click, Enter, or Space) with `whenSelected` overlay marks, `brushX` (a horizontal range with keyboard handles), `zoomX`, `continuousCursor`, and synchronized focus cursors; linking charts and what a range selects in them is the application's. | Documented. `onClick`/`onHover` callbacks; zoom, pan, and drag-to-zoom through `chartjs-plugin-zoom`; no selection of data. | Documented. Zoom, pan, box and lasso selection with `selected`/`unselected` styles and `selectedpoints` per trace, and events (`plotly_click`, `plotly_hover`, `plotly_selected`, `plotly_relayout`); linking charts is the application's (in Python, Dash callbacks). |
| Embedding in scrolling pages | The vertical wheel scrolls the page over a chart by default; Ctrl or ⌘ with the wheel (as trackpad pinches send it) and touch pinches zoom, the horizontal wheel pans. `pan` pans without zooming. Bindings change any of it (the plain wheel only while the chart has the focus, a touch drag that scrubs the cursor, `pageScroll` to hand a gesture back to the page), the same in axis charts, maps, networks, trees, and 3D charts, and `touch-action` follows them. `limits` keeps views inside an extent, and `edge` events with hysteresis let a page load history as the reader pans back while the view holds (tested while dragging). Input before the deferred controller loads is kept: a first hover as the chart mounts shows its tooltip ~5 ms later (~2 ms without the deferral, in a run of 2026-10-15), ~105 ms with 100 ms of network latency (see Bundle size). | Documented. `dataZoom` of type inside zooms on the wheel by default (`zoomOnMouseWheel`: `true`, `false`, `"shift"`, `"ctrl"`, or `"alt"`), with `moveOnMouseWheel`, `moveOnMouseMove`, and `preventDefaultMouseMove`; spans limited by `minSpan`/`maxSpan` and `minValueSpan`/`maxValueSpan`; `datazoom` events, no edge event. | Documented. `zoomX` takes the wheel only once the plot has the focus by default; `wheelActivation: "modifier"` takes Ctrl or ⌘ with the wheel at once, `"always"` every wheel; an `extent` clamps the domain, and changes are proposals the application applies. | Documented. Through `chartjs-plugin-zoom`: wheel zoom optionally behind a modifier key (`wheel.modifierKey`), pan behind one, and `limits` per scale (`min`, `max`, `minRange`); `onZoom`/`onPan` callbacks, no edge event. | Documented. `scrollZoom` is off for 2D axes by default (on for 3D, geo, and maps); `fixedrange` freezes an axis, `minallowed`/`maxallowed` bound ranges; `plotly_relayout` events, no edge event. |
| Synced charts | `sync: "group"` shares the cursor, the x range, and the selection; `{ cursor, viewport, selection }` sets each channel's group and scale (a cursor alone, or another chart's x followed along this one's y). Values travel as data (categories by name), received values are never shared again, and `showCursor`/`hideCursor` show a cursor from application code; in charts of several panels a channel shares the scale every panel shares, or a named panel's (`panel`). In Python, notebook outputs are separate iframes, so `sync` reaches only charts of one HTML page. | Documented. `echarts.connect(group)` links charts' tooltips and axis pointers, data zoom, and legend selections, matched by series and data index. | Documented. A shared `createChartCursor` controller syncs focus cursors by value (`match: "x"` or `"y"`); views and selections are linked through application state. | Documented. None built in; plugins or application code. | Documented. None built in: applications forward `plotly_hover` and `plotly_relayout` events (`Fx.hover`, `relayout`); Dash callbacks in Python. |
| Animation | Opt-in (`animation`): the axes move to a view asked for (`setViewport`, zooming to a brush, double-click reset) over 250 ms by default, eased without overshoot, in log space on log axes; tooltips follow the moving axes. With `values: true`, marks move to changed values (in-place updates and resets) and axes whose automatic domains change move with them: each frame interpolates the domains and plans ticks and grid lines for the domain between, and draws marks through those scales, so a value that stays moves only with its axis. Unstacked bars (by category or position, through their base when values change sign), pie slices (sharing boundaries, opening and closing as categories come and go), points (by row or by an explicit `animationKey` across reordered resets, using finite numbers or category labels; missing or duplicate keys show that series at once; with encoded size, color, and opacity; growing from and shrinking to nothing as rows start and stop being drawn; keyed replacements animate in notebook widgets and JavaScript apps, while Streamlit remounts when data changes and shows points at once), lines and areas whose x positions stay and which level of detail leaves whole (stack layers and band edges together, monotone curves curved again each frame through the values between), and horizontal and vertical rules. A change shows at once when the plot or categories change, when a mark that cannot move (stacked or labeled bars, lines and areas labels follow, text, heatmaps, custom marks, a line whose x changed, unkeyed points across a reset) shares a moving axis, and for appends and drops, frequent changes, more than 2,000 bars, slices, and rules, 10,000 points including exits across all series, or 10,000 line points, clouds, and inspected charts (pointer and keyboard read the new values first). Wheel zoom, panning, resizes, and export show at once; charts with several panels, linked charts, and pages preferring reduced motion do not animate, nor do charts whose frames would take over 10 ms of JavaScript, alone or together (a heuristic from earlier frames). No entrance animations or general path morphing. Frame costs measured outside the benchmark suite (Chrome): about 0.2 to 0.7 ms of JavaScript a frame for up to 2,000 bars, 0.2 to 0.6 ms for 1,000 points and 0.5 to 0.6 ms for 10,000, 0.2 ms for a 2,000-point line. | Documented. On by default: entrance animations, transitions of updated values (`animationDurationUpdate`, 500 ms, `animationEasingUpdate`, `cubicInOut`), and `universalTransition` morphing between series; series of more than `animationThreshold` (2,000) items do not animate. Checked in Chrome (one-off, ECharts 6.1, SVG renderer): when new values grow the y axis, the new tick set shows at once and labels the two axes share slide to their new places. | Not verified here. | Documented. On by default (1,000 ms, `easeOutQuart`): data updates animate per property (`animations`), with modes for show, hide, active, and resize (`transitions`); `animation: false` turns it off. Checked in Chrome (one-off, Chart.js 4.5.1): when new values grow the y axis, the axis takes its new ticks at once and bars move from their old pixels to their new ones over the second, so a bar part way does not read on the axis shown. | Documented. Off by default: `Plotly.animate` with frames and a `transition` (duration, easing) for data and layout, and `layout.transition` for `Plotly.react` updates. |
| Composition | Line, area, bar, point, heatmap, rug, error bar, and rule marks share scales, axes, tooltip, and legend in one chart; bars are vertical or horizontal, and lines and areas run along x or y (`orient`), over number, time, or category axes (a line through a bar chart's months, dodged beside grouped bars). Rugs show individual numeric or time observations as short ticks fixed to a plot edge, in either orientation, with row tooltips, keyboard reading, facets, and legend toggles; their performance against competitors is not yet measured. Rule, region, and text annotations from constants or one per table row (deploy markers, incident windows, labels), placed by values, fields, fractions of the plot, or pixels with offsets, mixed per axis (text at 3% of the width and a data y, as matplotlib's blended transforms place it), labeled by label objects with text styles and places (a threshold's name outside the plot beside the y axis, in room kept for it), and counting toward the domains only when they say so, with text labels hidden or moved around their points where they would overlap, farther ones with leader lines that cross no other label, point, or line. Marks and grid lines paint in `zIndex` order within a panel (a band under the lines, a line over the bars; ties keep the order given), and the pointer and clicks find the mark on top; axes, legends, and tooltips stay above the plot's layers. Marks of rows place rows by the same coordinates: a field moved some pixels along its axis, a field on a position scale of the chart's own with its axis on the right or the top, or a field read as a share of the plot or as pixels from its edge (event lanes at fixed heights over a value axis); rows moved into view are drawn, inspected, and brushed where they are drawn. Custom marks draw shapes with the chart's scales through the same SVG, Canvas, and static renderers; over x and y fields they show series with legend entries, tooltips at their points (custom text optional), keyboard stops, facet splits, and summaries (JavaScript only; no hit testing of the drawn shapes). Bars can write their values, or shares for normalized stacks. Lines and areas label their series directly, at their first or last observation drawn or where they enter or leave the view (in the series' color, inside the plot or beside the axis in room kept for them, a band along the edge it names), text follows another mark's series, and labels of bars, rules, regions, and texts are written from parts (text, a field, the series' name, the value labeled, each formatted) (ECharts has `endLabel` on each line series; Plotly places annotations by hand). Normalized stacks and area stream baselines resolve within each panel and reuse unchanged boundaries across redraws. Center requires nonnegative thicknesses, unlike d3's signed silhouette inputs or its separate diverging offset; composing raw values and shares on one axis requires an explicit choice of domains or a separate value axis. A second y axis on the right for marks with `axis: "right"`, in every facet panel or subplot drawing them, its scale shared or scoped per panel, row, or column (`yRight.scope`, by default as y; subplots take their own `yRight` settings). Small multiples by a category field wrapped into rows, or a grid with a row per value of one field and a column per value of another, and subplots: panels each drawing the marks that name them, placed by a layout of nested columns, rows, and grid cells that span tracks (`herceg/layout`; Python's `chart.columns([2, 1])` and each cell's `panel(...)`, `grid`, and `mosaic`; adapters' `<Columns>`, `<Rows>`, `<Grid>`, `<Cell>`, and `<Panel>`), tracks weighted, fixed in pixels, or weighted with a least size, the plots' edges lined up across tracks, and insets drawn over a panel's plot with scales of their own and an indicator of their ranges joined to them (matplotlib's `inset_axes` and `indicate_inset_zoom`; Plotly places extra axes by domain, ECharts extra grids by position, without a box tying them to a parent). x and y are shared or scoped per panel, row, column, named grid, or list of panels (`scope` on the scale; facets share both by default, subplots neither; each subplot's x and y may be linear, log, time, or categories, whatever the other subplots show), and each x scale zooms, pans, brushes, and resets on its own, also in live notebook widgets and Streamlit, which report each panel's view. A panel may have a legend of its own, which hides and shows its series there only, beside the chart's, which shows an entry hidden in some panels as mixed. Facets do not go in layout cells yet. A category axis of any mark may be resolved per panel, row, or column too, each holding only the categories its panels' rows hold; stacked bars stack, heatmap cells resolve, and histograms, box plots, and violins summarize within each facet panel (histograms in bins chosen per binned axis); annotations over a table draw each row in its own row's panel (labels placed, and the panel described and announced, apart; 50 panels over 100,000 rows draw in the time one panel of them takes). Charts with categories per panel cannot be synced yet, facets with right y scales of their own do not zoom along y, and range navigators need panels that share x (one strip under all of them); no nested facets yet. Pies, treemaps, sunbursts, gauges, funnels, radars, Sankey diagrams, maps, and networks draw in each facet panel, from that panel's rows, with one legend whose toggles hide a category in every panel, or fill a subplot of their own beside panels with axes (a dashboard row of a pie beside a line), with tooltips, keyboard reading, and summaries per panel; their panels have no axes to zoom or brush. A map's layers split by the facet field or repeat (a base map), every panel fitted alike; a network's facet panels share one layout of the whole network. Trees drill, maps and networks pan, zoom, and lasso, nodes move, and rows are selected in panels as in charts of their own: facet panels share one drill root, view, and set of moved nodes (one zoom moves all of them), and each subplot has its own, addressed by `panel` and reported with `panels` (one-off Node scene timings: a drill of 12 facet panels of 10,000 leaves about 1.9 ms, a pan of one of six map subplots of 200 regions about 0.4 ms). 3D layers share CPU-rendered subplots with independent cameras, toolbars, and scoped events; 3D facets are refused. Dendrograms of a precomputed linkage stand on a heatmap's category bands in subplots (`herceg.express.clustermap` computes the clustering). | Documented. Many series types in one grid, `markLine`/`markArea`, `custom` series. | Documented. Grammar of marks; strongest composition model of the group. | Documented. Mixed chart types; annotations via plugin. | Documented. Traces, layout shapes and annotations, subplots. |
| Encodings and styles | `color` (a field through the chart's scale of categories, or a color; a category field splits lines, areas, and bars into series, as Plotly Express's `color=` does) and `encode` channels by field, named scale, constant, or condition (portable expressions) for color, fill, stroke, dash, stroke width, and opacity on lines, areas, and bars; `scales: { color: { type: "ordinal", domain, map, unknown } }` fixes a value's color in every mark and panel, panels showing subsets included, and streaming never recolors; without one, a value of one table's field (or of tables made from it) has one color and one legend entry across marks and panels, and a named scale joins unrelated tables by value. `style.by` maps series or bars' rows to looks by value (an "Average" line dashed), shown in legends that draw marks' looks; markers on lines; bars outlined, labeled inside or past their ends in styles of their own, white or black by contrast. `continuity` (`defined`, `maxGap`, calendar `breakBy`) and `where` decide which observations connect before reduction, and conditional bands meet their lines exactly on step curves. Points take symbol and size by field but not yet `encode`; lines and areas take one look per series (no per-segment colors). | Documented. Styles per series (`itemStyle`, `lineStyle`) and per data item; `visualMap` maps values or categories to colors (piecewise or continuous), also over line segments; no named category scale shared across charts. `connectNulls` and `null` gaps; no gap by distance or calendar. | Documented. Style callbacks per series and per datum (`getSeriesStyle`, `getDatumStyle`), JavaScript only; no category scales with fixed maps, no annotations. | Documented. Styles per dataset, scriptable options (functions per point) and `segment` styles for conditional line colors, `spanGaps` with a maximum gap, `fill` with `above` and `below` colors; functions are JavaScript only. | Documented. `marker.color` arrays, `color_discrete_map` and `category_orders` in Plotly Express for fixed category colors, `legendgroup`; `connectgaps`; no conditional fill without splitting traces. |
| Axes, legends, and colorbars | Automatic axes and one legend from the short forms (`x`, `y`, `yRight`, `legend`); `scales` and `guides` add or replace them. Ticks are a count, steps (calendar steps in the chart's time zone that stay put as the view moves, such as `{ every: "6 hours" }`, or numbers from an anchor), explicit values, or a function; labels are Intl options, d3-like number patterns (`",.2f"`, `"+.0f"`), strftime time patterns (`"%a %b %-d"`), or a function; a label that would repeat the one before it is left out unless asked, and automatic ticks step coarser rather than repeat. Axes take tick layers (minor ticks, a row of day boundaries under hourly labels) with tick direction and length, label rows, rotation candidates, and collision policies (hide, stagger, wrap); tick labels inside the plot (`labels: { inside: true }`) or a `gap` from their ticks, and flat labels standing at their ticks where their style sets `align` or `verticalAlign`; x axes on top and y axes on the right, each styled on its own. Position scales take `padding`: by default room for markers and bars' widths at the ends of domains fitted to data (explicit domains and views stay exact), or a share of the span or pixels at each end. Legends show the scales they name, in fixed columns or rows, with titles, swatches drawn like their marks, custom entries, one entry per value across marks and panels (one legend of three columns under a grid of subplots, a bar and its error bars toggled together) without an option or a legend group, never merged by label alone, and `legend: false` on marks; toggling and keyboard use keep working. Colorbars stand beside or lie below the plots, with ticks over the scale's real domain (a diverging midpoint where it falls), titles and formats, and steps for contour bands; one serves every panel its scale colors. Functions are TypeScript only: specs and Python take the portable forms. One axis per side, no legend scrolling, no colorbar handles, no log color scales. Python's `hg.Ticks`, `hg.Format`, `hg.axis`, `hg.legend`, and `hg.colorbar` cover what matplotlib's locators, formatters, `twinx`, `fig.legend(ncols=...)`, and `fig.colorbar(ax=axs)` do for these figures, as specs; matplotlib has more locators (log minor ticks, `ConciseDateFormatter`), axes anywhere (`secondary_xaxis`, spines at data positions), and legends of arbitrary artists. | Documented. Arrays of `xAxis` and `yAxis` with `position` and `offset`, so several axes per side; `axisTick` (`interval`, `inside`, `length`), `minorTick`, `axisLabel` (`formatter` templates or functions, leveled time formats, `rotate`, `interval`, `hideOverlap`); time in local time or UTC, not another zone. Several `legend` components, `scroll` legends, custom entries with icons; `visualMap` continuous (draggable range handles that filter) and piecewise color guides. | Documented. A registry of named scales; several axes per side stack outward. `axis.ticks` (count, spacing, values, a format function), tick label rotation and collision thinning. One `colorLegend` per chart from the color scale: swatches, a sampled ramp, or bins; hidden from the accessibility tree; `interactiveColorLegend` toggles series. | Documented. Scales by id with `position`; `ticks.stepSize`, `maxTicksLimit`, `callback` labels, `autoSkip`, rotation limits, time `unit` and `displayFormats` through a date adapter, major ticks. One legend plugin per chart (`generateLabels`, `filter`, `position`); no colorbar without a plugin. | Documented. `dtick` (numbers, months as `"M3"`), `tick0`, `tickvals` and `ticktext`, d3 `tickformat` for numbers and times, `tickformatstops` by zoom, minor ticks, `tickangle`, period labels; `yaxis2` overlaying on either side, more with `anchor: "free"` and shifting. Several legends (`legend2`, ...); a `colorbar` per trace or a shared `coloraxis` across subplots, vertical or horizontal. |
| Themes | Light (the default), dark, high-contrast light and dark, each on a surface of its own, and `auto` (transparent, matching the surface the chart sits on, or `prefers-color-scheme`, and switching with it). Objects extend a theme with 10 color tokens (surface, text, muted text, grid, axis, palette, ramps, rise and fall) and role styles for 14 roles (base text, title, panel title, axis title, tick label, legend label and title, plot surface and border, grid lines, axis lines, ticks, and lines', bars', and tooltips' defaults); axes, legends, titles, and subplots restyle their own roles over the theme's (font, size, weight, color, opacity, alignment, halo, background box; stroke, width, dash). Colors and fonts may be CSS variables in any CSS color syntax, read from the page and re-read when its root or body element changes; static output uses the fallbacks. Categorical palettes are checked for color-blind separation between neighbors. Does not follow `forced-colors` yet; no theme gallery. | Documented. 36 bundled themes (`echarts/theme`), registered JSON themes, and an online theme builder; `setTheme` switches at runtime. Colors are canvas color strings, so the app reads CSS variables itself. | Documented. Styled through `--ts-chart-*` CSS custom properties, resolved for canvas painting; follows `prefers-color-scheme` and forced colors and re-renders when the theme changes. | Documented. Global and per-chart defaults (`Chart.defaults.color`, `borderColor`, `font`); no built-in dark or high-contrast theme; the app reads CSS variables and updates charts. | Documented. Python ships named templates (`plotly_white`, `plotly_dark`, `ggplot2`, `seaborn`, `simple_white`, ...); plotly.js takes a template object in `layout.template`. No CSS variables. |
| TypeScript | Field options are typed from the table schema: a categorical field passed as a numeric encoding is a compile error. Compile-time tests guard this. | Documented. Large option types; tree-shaken `ComposeOption` types. | Documented. Fields and callbacks inferred from row types. | Documented. Typed configuration generics. | Community `@types/plotly.js`, not first-party. |
| React | First-party `@herceg/react`: `<Chart>` with mark elements typed against the table's schema; no React element per data point, and data updates go through tables without rendering React. Measured: mounting adds up to ~0.3 ms per chart where the difference exceeds the noise, streaming and hover are within noise of plain herceg, each chart's React root retains ~35 KB, and the adapter adds ~2.3 KiB gzip. | Community wrappers (for example `echarts-for-react`). | First-party adapters for React and other frameworks. | Community `react-chartjs-2`. | `react-plotly.js`. |
| Vue and Svelte | First-party `@herceg/vue` and `@herceg/svelte`: `<Chart>` with mark components typed against the table's schema in templates checked by vue-tsc or svelte-check. Vue's `<Chart>` reads marks from its slot without mounting them; Svelte's mark components mount and render one empty `<template>` each. No component per data point, and data updates go through tables without Vue or Svelte. The adapters add ~2.4 KiB (Vue) and ~2.8 KiB (Svelte, with the entry's compiled component) gzip; their runtime cost is not measured yet. | Community `vue-echarts`; Svelte wrappers not verified here. | First-party Vue and Svelte adapters (`@tanstack/charts/vue`, `@tanstack/charts/svelte`). | Community `vue-chartjs`; Svelte wrappers not verified here. | No first-party Vue or Svelte component. |
| Python | First-party `herceg` package: `hg.line(df, x=..., y=...)` one-liners and a chainable `hg.Chart` for pandas, Polars, PyArrow, and NumPy data. Columns travel as binary buffers (no JSON number lists); output to notebooks, self-contained HTML, SVG, PNG, and PDF, and live notebook charts (see Notebooks). `herceg.streamlit.chart` shows charts in Streamlit apps (components v2, one binary payload per run) and returns the whole selection (ranges and lasso), the clicked data, with its rows, a row selection's rows or condition, tree `drill_root` paths, and manual network `item_positions` to the script (with `on_drill` and `on_item_move` reruns; positions and node places survive reruns that change the data or styles, but for nodes the data no longer has); `on_viewport` reports pan and zoom as an `hg.Viewport`, including networks' layout coordinates and maps' projected plane ranges. Hover is not reported there. | Community `pyecharts`; community `streamlit-echarts` for Streamlit. | None. | None. | First-class Plotly Python and Plotly Express; Streamlit's built-in `st.plotly_chart` returns point, box, and lasso selections. |
| Statistical charts | `herceg.express` (Python): Seaborn-named functions computing their statistics in NumPy (bootstrap intervals that reproduce Seaborn's for a seed, with repeated-measures units and weights, any estimator; polynomial, logistic, robust, and lowess fits; SciPy-compatible kernel densities, ECDFs, Seaborn's histogram bins, letter values, hierarchical clustering) and drawing ordinary marks: bar, point (joined by lines over the categories), and line estimates with intervals, regression and residual plots, histograms (bars, steps, or polygons; filled stacks; weights), densities and ECDFs along x or y, rugs, strip, swarm (the point mark's bounded beeswarm layout, with Seaborn's warning), box, letter-value (the core's boxen mark), and violin plots, bivariate densities as contour lines or bands at Seaborn's levels, 2D histograms, pair, joint, and cluster maps. Charts compute again from new data (`hx.recompute`, notebook widgets' `append` and `replace`), reusing unchanged groups' bootstrap results. No TypeScript counterpart of the estimation yet; see [Statistical charts](#statistical-charts). | Documented. The `ecStat` extension (regression, histogram, clustering) and dataset transforms; no Seaborn-like API. | None. | None (community plugins for box plots and others). | Documented. Plotly Express: `histogram` with marginals, `ecdf`, `box`, `violin`, `strip`, `density_heatmap` and `density_contour`, OLS and lowess `trendline`s (statsmodels), and `scatter_matrix`; figure factory dendrograms. No bootstrap intervals or clustermap. |
| Notebooks | Static display: an isolated iframe with the engine and the data embedded, so it works offline. Live charts (`chart.widget()`, on anywidget): Python appends rows (with a rolling window), replaces data, and changes options without re-sending the chart, as binary buffers over the widget's connection; brushing (ranges and lassos), zooming (x and both y axes), hovering, and clicks (with the rows under the pointer) come back as properties and callbacks, with datetimes on time axes, and a chart's row selection (`row_selection=`) reports the rows selected, by position in the data after rows streamed in and out, or a brush's condition, and takes rows or a condition from Python. Live widgets also report tree `drill_root` paths and manual network `item_positions`, with `on_drill` and `on_item_move`, Python assignments and resets, and restoration across displays; network data changes keep the moves and places of nodes that remain. Tested in JupyterLab 4 only; update latency through the kernel not measured. | Community `pyecharts` renders notebook HTML; no first-party widget. | None. | None. | Documented. `fig.show()` in notebooks and `go.FigureWidget` (anywidget-based since Plotly.py 6), which updates traces from Python and calls Python on click, hover, and selection. |
| Web pages | `herceg.web` in Python (`herceg/web` in JavaScript): a page loads the engine once from content-hashed files served with immutable caching (871 KiB minified, 330 KiB gzip on the first page: the spec loader with every mark family, then chunks loaded as charts need them; later pages take it from the cache), and each chart is a fragment holding its spec and base64 columns, or naming an application route that returns `web.payload(chart)`, the spec and columns as one binary payload (16 MB for a million-point line, made in about 3 ms, viewed in the browser without copying the columns). Ten 200-point line fragments are 61 KB of HTML, against 10.7 MB for ten self-contained `to_html(full_page=False)` outputs. Fragments hold no script: a strict Content Security Policy (`script-src 'nonce-...'`, with or without `'strict-dynamic'`) needs only the nonce. Fragments inserted later (HTMX) mount themselves, removed ones are destroyed with their fetches aborted, and charts of separate fragments sync. `herceg:click`, `herceg:select`, `herceg:viewport`, `herceg:ready`, and `herceg:error` DOM events carry JSON that `web.selection()` and the like read back in Python. A Flask helper (`herceg.flask.init_app`: the files' blueprint and `herceg_assets`/`herceg_chart` template globals); Django and FastAPI through the same functions (examples). Tested through a running Flask app in Chrome, Firefox, and WebKit. No live updates pushed from the server yet; the first load is larger than a one-family bundle. | Documented. A JavaScript library: a page loads it once and calls `echarts.init(element).setOption(options)` per chart in its own script; `renderToSVGString` renders on a server. Community `pyecharts` writes chart HTML, also for Flask and Django templates, loading ECharts from a CDN; no binary data path or DOM events beyond its JavaScript API. | A JavaScript library for an application's own pages; no server-side format or Python helper. | A JavaScript library: a page loads it once and creates each chart in script; no server-side format or Python helper. | Documented. `fig.to_html(include_plotlyjs="cdn", full_html=False)` writes a `<div>` and an inline script per chart, plotly.js loaded from a CDN once (inline scripts need `'unsafe-inline'` or a nonce added by hand; data inline in the page); `include_plotlyjs=False` leaves loading plotly.js to the page. Events are plotly.js's (`plotly_click`, `plotly_selected`) in page scripts. Dash is a framework of its own (on Flask) with callbacks from the browser to Python, rather than charts dropped into an existing app's templates. |
| Accessibility | Focusable figure with a generated data summary, arrow-key navigation announced through a live region, legend entries as toggle buttons, generated summary in static SVG `desc`; a range navigator adds its overview of the whole x range, formatted visible range, and control of every panel's shared x to the summary, refreshed at most once a second without live pan announcements (the sliders announce politely); tagged PDF with one Figure for the whole chart (including facets), title and generated summary as alternative text, decorative backgrounds/grid lines as artifacts, and document language from the supplied locale. PDF labels remain inside the Figure; no PDF/UA conformance claim or screen-reader PDF testing yet. Automated axe-core audits (WCAG 2.1 A/AA and best practices) find nothing to fix in every chart family, both renderers, facets, subplots, all four themes, static SVG, and grids, in Chrome, Firefox, and WebKit; tests check the accessibility tree each of the three engines gives screen readers (name, description read once, legend states, live announcements, grid headers, rows, and selection), but not yet tried with screen readers themselves. Firefox drops the levels of grouped grid rows (it ignores `aria-level` in grids that number their rows). The keyboard reaches every series (Up and Down between them) and walks heatmaps cell by cell. | Documented. `aria` option generates descriptions; decal patterns. | Documented. Required accessible name, keyboard focus navigation. | Canvas only; the application supplies fallback content. | Limited; no keyboard navigation of data. |
| Export | A mounted chart as it is now (size, zoom, hidden series, highlighted row selection): standalone SVG (`toSVG`), PNG (`toPNG({ dpi })`, drawn from the SVG in a module loaded on first use), and PDF (`renderToPDF(chart)` from `herceg/pdf`). Images for documents: PNG, JPEG, and WebP (`renderToImage` from `herceg/image` in browsers, through their canvas; Python `to_image`), laid out at a size in pixels, inches, centimeters, millimeters, or points and drawn at a dpi the file records (PNG `pHYs`, JPEG JFIF density, WebP EXIF), JPEG on the chart's background or white, limits refused before allocating; no Node raster backend. Static SVG takes the same `size` and `unit`, and `tooltip: "title"` gives bars, points, and line observations native `<title>` tooltips (up to 5,000). Without a DOM, SVG (`renderToSVG`, heatmaps embedded as PNG) and tagged vector PDF, both drawing the selections a chart's `rowSelection` stores hold (a spec's binding, and Python's `SelectionBinding(selection=...)`, can start with one), without dependencies (`herceg/pdf`, about 122 KiB gzip including scene compilation and a line mark, bundled only when imported; synchronous single-chart exports also retain list handling and fitting): paths, selectable text, heatmaps as images, and a chart-level Figure alternative. `renderToPDF` and `specToPDF` (one chart/spec or a list), and Python `hg.to_pdf` / `hg.save` (one chart or a sequence), export one chart per page (`hg.save` also delegates single charts to `Chart.save` for HTML/SVG/PNG; sequences require a `.pdf` path), with A4/Letter portrait or landscape, point margins, fitted and centered vector charts clipped to their own rectangles, title/subject/language metadata with single-chart defaults preserved, visible chart locale scopes nested under English alternatives, one Document with a Figure per chart, and fonts subset once across pages; several views on one page use subplots and panel titles. Standard fonts use Windows-1252; optional supplied static TrueType fonts add subsetting and Unicode copy/search maps (about 131 KiB gzip with them, ~9 KiB more, excluding font bytes), with conservative script coverage and no complex shaping. Both font paths emit the structure tree, marked content, ParentTree, artifacts, and locale language; no PDF/UA conformance claim. Python saves SVG and PDF (same renderers, embedded V8) and PNG, JPEG, and WebP (resvg and Pillow) without a browser, choosing the format by the path's extension. A shared `fonts=` mapping accepts TrueType paths or bytes for SVG/PNG/PDF: the PDF resolver measures all three, PNG loads the supplied faces with family aliases, and SVG references the families without embedding font files. Default SVG estimates and system-font PNG rendering remain available; supplied-font measurement shares PDF's format and text restrictions, and resvg shaping can differ from PDF glyph advances. | Documented. PNG/SVG from the browser, server-side SVG strings; no built-in PDF. | Documented. Static SVG, SSR, browser raster export. | PNG via `toBase64Image`; no built-in PDF. | Documented. PNG/SVG/JPEG/WebP; Kaleido for Python, which also writes PDF. |
| Server rendering | `renderToSnapshot` renders a chart's SVG markup without a DOM, with deterministic ids, fonts (or Helvetica estimates), locale, and time zone, and the state to adopt it; `hydrateChart` and the adapters' `initial={hydration(snapshot)}` take the nodes over without drawing them again, redrawing only what differs, refuse markup that does not match, and keep the markup up until Canvas or GPU charts draw; Python `to_snapshot`. Tested with `renderToString` and `hydrateRoot` (React), `renderToString` and `createSSRApp` (Vue), and Svelte's server render and `hydrate`, without mismatch warnings. The snapshot's text measurement holds until the chart's size or options change, after which the browser's own may move tick labels. Not benchmarked. | Documented. `ssr: true` with `renderToSVGString()` writes SVG on a server; in the browser a 1.3 KiB gzip client (`echarts/ssr/client`) reports `click`, `mouseover`, and `mouseout` on it with series and data indexes; tooltips and zoom need the chart created again in the browser, which draws anew. | Documented. Its framework adapters render the accessible SVG on the server at `initialWidth` and adopt and reconcile it on mount, with ids kept stable through hydration (`useId`); Canvas marks emit shells that paint after mount. | None: Canvas in the browser only. | None: plotly.js needs a DOM; servers write static images (Kaleido) or HTML that renders in the browser. |
| Ease of use | Shortest or tied in 11 of 12 [common tasks](#common-tasks) (several series, tooltip content, annotations, synced charts, streaming, 100k points, themes, export, and a line over bars' categories take one option, mark, or call); field names checked at compile time, and runtime errors that name the field and the fix (Python helpers name themselves, with the closest option), as one `ChartError` shape with a code and an option path in every surface; a chart that cannot draw says so in its place instead of drawing nothing. Tooltip fields are laid out in rows, not a template of the application's own (that takes `renderTooltip`, in JavaScript), and custom marks state their baseline. | Every task through options; `connect` syncs charts in one call; misspelled fields and theme names fail silently. | Typed as strictly as Herceg; zoom windows, visible rows, rolling windows, and annotation extents are application code; no drawn titles. | Simple for standard charts; annotations and zoom need plugins, large data five settings; canvas only. | Shortest tooltips (`hovertemplate`) and Python (Plotly Express); synced charts need event plumbing. |

Network picking has a separate one-off measurement (2026-10-10, Node
22.23.3, Darwin 27, Apple M6; 2048 × 1024, labels off). It uses the actual
network geometry and picker with deterministic positions replacing the
force simulation, identical data and queries before and after, five warmup
batches and fifteen measured batches of 512 queries. Values below are
medians and p95 of batch-average milliseconds per query, not individual
pointer-event percentiles. Uniform queries over 5,000 nodes / 20,000 links
fall from 0.834 / 0.889 to 0.019 / 0.023 ms. At 50,000 / 200,000 they fall
from 0.677 / 0.776 to 0.0023 / 0.0024 ms, but 508 of 512 queries hit nodes
and avoid links. Queries in the gap between two node clusters exercise
links instead: 1.116 / 1.178 to 0.029 / 0.030 ms at 5,000 / 20,000, and
12.219 / 18.206 to 0.268 / 0.305 ms at 50,000 / 200,000. Picked-key
checksums match in every fixture. The larger size was then above the
network limit, raised since to 50,000 / 200,000.

The index has costs: first link lookup in the clustered fixture rises from
7.6 to 34.7 ms at the supported cap, and 15.3 to 228.6 ms at the synthetic
larger size. Packed candidate storage uses 4.33 and 42.89 MB respectively;
uniform fixtures use 3.46 and 33.91 MB. It is allocated lazily and retained
across selection redraws, then rebuilt after positions change; it is kept
in the fitted layout's pixels before any zoom, so panning and zooming keep it.
Interleaved runs of the existing 5,000 / 20,000 drag scene show about 0.6 ms
extra redraw cost in Node (roughly 5.0 to 5.6 ms), accepted for navigation
and selection support. These results compare Herceg with its previous
picker, not competitors; network interaction has not been benchmarked
against ECharts, TanStack Charts, Chart.js plugins, or Plotly compositions.
The network controls remain optional; the line entry has no added code.

Network layouts have a second one-off measurement (2026-10-14, Chrome
155.0.8059.79 through Playwright, macOS 27.0.1, Apple M6, a 1200 × 800
chart at device pixel ratio 1, Canvas unless noted, the built package, one
run each on a machine running other work, but three of the 50,000 / 200,000
force layout: 11.9, 12.0, and 12.4 s). Networks are communities of 50
nodes on a spanning tree with the rest of the links mostly inside
communities (force, circular) and directed acyclic networks of short-span
links (layered). Times are from `createChart` to `chart.loading`; frame gaps
are requestAnimationFrame intervals meanwhile; retained heap is after
garbage collection, beside the links table's own; pan, zoom, and whole are
`setViewport` plus a synchronous `render()`; hovers are `chart.inspect` at
spread points (the first builds the index).

| Network | Layout | Laid out | Frame gaps (median / p95 / max) | Retained heap (table) | Pan (median / p95) | Zoom | Whole | Hover (median / max) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 5,000 / 20,000 | force | 1.25 s | 16.7 / 22.1 / 30.8 ms | 2.5 MB (2.7 MB) | 2.5 / 4.5 ms | 1.8 ms | 2.0 ms | 0.0 / 0.2 ms |
| 5,000 / 20,000 | force, SVG | 1.39 s | 16.7 / 33.3 / 46.8 ms | 2.9 MB (2.7 MB) | 13.2 / 19.4 ms | 14.3 ms | 12.5 ms | 0.0 / 0.3 ms |
| 5,000 / 20,000 | circular | 0.03 s | 24 ms (one frame) | 2.2 MB (2.7 MB) | 2.1 / 6.3 ms | 1.9 ms | 2.4 ms | 0.1 / 0.5 ms |
| 5,000 / 20,000 | layered | 0.13 s | 16.7 / 24.3 / 24.3 ms | 7.3 MB (2.7 MB) | 13.5 / 27.6 ms | 14.0 ms | 11.8 ms | 0.0 / 36 ms |
| 50,000 / 200,000 | force | 12.0 s | 17.0 / 56.0 / 76.4 ms | 18.3 MB (6.2 MB) | 42.1 / 55.4 ms | 21.2 ms | 41.5 ms | 0.0 / 66 ms |
| 50,000 / 200,000 | circular | 0.11 s | 105 ms (one frame) | 17.8 MB (6.2 MB) | 19.8 / 51.9 ms | 18.7 ms | 22.9 ms | 0.5 / 3.3 ms |
| 50,000 / 200,000 | layered | 1.02 s | 16.7 / 24.7 / 84.4 ms | 22.0 MB (6.1 MB) | 47.1 / 86.6 ms | 24.6 ms | 46.7 ms | 0.0 / 94 ms |

The 50,000 / 200,000 force layout's p95 frame gap is one of the frames
that draw its progress, four a second (48 of 626 frames in a profiled run,
which spent 9.5 s simulating and 1.8 s drawing); the frames between take
about 17 ms. Before layout work moved to frames that do not draw, it took
43.9 s, drawing every frame (~60 ms frame gaps); the
layered row's pan was 69 ms before large layered networks wrote their
segments without per-link route objects. At 200,000 nodes and a million
links, beyond the limit, Node 22.23.3 times the kernels at pivot MDS 5.4 s
and 177 ms a force tick (about a minute in all), a circle 11 ms, and a
layered tree of 200,000 nodes 0.2 s, while that many short-span links need
more than 500,000 bend points. Nodes are drawn by Canvas: the WebGL point
painter draws one radius and one color per cloud without rings, so it
cannot draw sized, ringed, or highlighted nodes as they are, and links,
which cost more, would stay on the CPU. These runs compare Herceg with
itself; no other library's network layout is measured here.

## Environment

<!-- results:environment -->
- Date: 2026-10-26, commit d42d5d65
- Machine: Apple M6, 12 cores, 32 GB, Darwin 27.0.0
- Browser: Chrome 155.0.8059.86 through Playwright 1.63.0 (installed Google Chrome), GPU ANGLE (Apple, ANGLE Metal Renderer: Apple M6, Unspecified Version), headed, idle frames every 16.8 ms
- Viewport 1280x1400, device pixel ratio 2
- Libraries: herceg 0.0.0 (d42d5d65), echarts 6.1.0, chartjs 4.5.1, plotly 4.1.2, tanstack 1.0.0, uplot 1.6.32
- Renderers (normal / large config): herceg: auto (svg below 4,000 drawn points, canvas above; 3D charts on WebGL from 20,000 points or 10,000 surface cells) / auto; echarts: canvas / canvas (sampling: minmax, large: true); chartjs: canvas / canvas (parsing: false, min-max decimation); plotly: svg / webgl (scattergl); tanstack: svg / canvas (mountCanvasChart); uplot: canvas / canvas
<!-- /results:environment -->

## Bundle size

Entries mount charts or grids, bundled for production with tree shaking
(`benchmarks/src/size/entries/`). The line entries render the same time-series
chart with a tooltip.
`herceg-react-line` renders it through `@herceg/react` and leaves React and
React DOM out, since an application using the adapter already ships them;
`herceg-vue-line` and `herceg-svelte-line` do the same through `@herceg/vue`
and `@herceg/svelte` and leave Vue and Svelte's runtime out. Sizes are what
a page loads before the chart renders: the entry chunk and every chunk it
imports statically, each compressed on its own (Herceg's scheduler is one
such chunk, shared with its lazily loaded painters). Herceg's interaction
controller (tooltips, the pointer, the wheel, and keys), which every chart
loads right after its first frame, is listed apart, as loaded after the
first frame. Other chunks reached only by dynamic imports are listed as
optional chunks: every chunk the entry could
load for some chart (WebGL points, animation, crosshair labels, map and tree
controls), not what this chart downloads, which for these entries is
nothing more until a feature that needs one is used. `herceg-grid` is not a
chart: it mounts a two-column grid (`herceg/grid`) over the same data, with
its model, row view, and selection store; no other library here has a grid
to compare it with. `herceg-bar` (bars stacked by a series field),
`herceg-area` (areas stacked by a series field), and `herceg-scatter`
(points) track what each mark adds to Herceg's bundle. `herceg-heatmap`
mounts a heatmap over a number x field and a category y field; it includes
continuous cell placement and synchronous calendar placement. These mark
entries have no counterparts among the other libraries' entries. `herceg-pivot`
pivots the same data by a field of four values (`herceg/pivot`, no DOM), and
`herceg-grid-pivot` shows that pivot in its grid (`herceg/grid/pivot`), and
`herceg-grid-remote` shows the same data as a remote grid
(`herceg/grid/remote`) over a source answering from the page's arrays.

The PDF size entries also measure one buffered portable spec
(`herceg-spec-pdf`) and a two-chart A4 report (`herceg-pdf-document`).
Unified PDF exports (one chart or a list, on fitted pages) cost the line
PDF 815 B gzip and the embedded-font entry 793 B (excluding font bytes)
over a single-page implementation, measured against it at `38452a4c`
(Node 22.23.3, esbuild 0.28.2, the method above): normal tree shaking
retains fitting and list handling at single-chart call sites. This is an
intentional cost for a consistent export vocabulary. These PDF entry
workloads have no equivalent export entry for competitors; the figures
establish bundle cost, not a comparative performance win.

The interaction controller is a chunk loaded after the first frame
(12,720 B gzip, 31,887 B minified). Deferring it saved 2,400 B gzip of
`herceg-line` before the first frame when measured against the commit
before it, with gesture bindings, view limits, sync channels with
snapping, page-wide sync groups and the frame relay's loader, the cursor
API, and the constructors' seams for hydration added; it saved 2.2 KB of
`herceg-react-line`, `herceg-vue-line`, and `herceg-svelte-line`, and 2.3
to 2.5 KB of the other chart entries. Pages that hydrate server markup add
about 1.6 KB with `hydration`, and `herceg-spec-pdf` carries
`specToSnapshot` (2,696 B gzip).

The controller costs a first hover made while it loads
(`npm run bench:first-hover`, `benchmarks/results/first-hover.json`):
5.1 ms from a pointer move as `createChart` returns to the tooltip shown
(2.6 ms with the chunk cached), 10.1 ms for one 10 ms later, and about
105 ms with 100 ms of network latency; without the added latency, from
25 ms after mounting, as in every other measurement here, the controller
has loaded and the tooltip shows in 1.8 to 1.9 ms. A run on 2026-10-15
that also built the commit before the deferral measured that chart's first
hover at 1.3 to 3.2 ms, and no difference from 25 ms on.

The ordinary time-line entry retains category-position and y-orientation
support because the same `line()` accepts these options at runtime, and
`table()` infers categories from string arrays. Swarm placement and point-view
copying for independent panel bands or time breaks are excluded from its
initial bundle; the placement providers carry the synchronous copying path.

<!-- results:size -->
| Entry | Version | Minified KiB | Gzip KiB | Brotli KiB | Required CSS, gzip KiB | After the first frame, gzip KiB | Optional chunks, gzip KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| chartjs-auto | 4.5.1 | 246.8 | 79.9 | 69.3 | - | - | - |
| chartjs-line | 4.5.1 | 196.4 | 63.7 | 56.0 | - | - | - |
| echarts-full | 6.1.0 | 1107.9 | 370.5 | 302.3 | - | - | - |
| echarts-line | 6.1.0 | 490.7 | 166.8 | 142.7 | - | - | - |
| herceg-area | 0.0.0 (00800ca5) | 183.9 | 70.9 | 63.1 | - | 12.4 | 105.1 |
| herceg-bar | 0.0.0 (00800ca5) | 181.6 | 71.0 | 63.2 | - | 12.4 | 104.5 |
| herceg-contour | 0.0.0 (00800ca5) | 170.4 | 66.7 | 59.4 | - | 12.4 | 102.2 |
| herceg-grid-pivot | 0.0.0 (00800ca5) | 133.7 | 45.9 | 41.1 | - | - | - |
| herceg-grid-remote | 0.0.0 (00800ca5) | 89.7 | 31.1 | 28.0 | - | - | - |
| herceg-grid | 0.0.0 (00800ca5) | 90.6 | 31.9 | 28.7 | - | - | - |
| herceg-heatmap | 0.0.0 (00800ca5) | 174.0 | 68.0 | 60.6 | - | 12.4 | 102.2 |
| herceg-image | 0.0.0 (00800ca5) | 293.7 | 116.8 | 104.9 | - | - | 2.9 |
| herceg-line | 0.0.0 (00800ca5) | 156.3 | 60.9 | 54.4 | - | 12.4 | 105.1 |
| herceg-pdf-document | 0.0.0 (00800ca5) | 309.1 | 121.9 | 109.3 | - | - | 2.9 |
| herceg-pdf-fonts | 0.0.0 (00800ca5) | 332.2 | 130.9 | 117.1 | - | - | 2.9 |
| herceg-pdf | 0.0.0 (00800ca5) | 309.1 | 121.8 | 109.2 | - | - | 2.9 |
| herceg-pivot | 0.0.0 (00800ca5) | 60.5 | 20.5 | 18.7 | - | - | - |
| herceg-react-line | 0.0.0 (00800ca5) | 162.0 | 63.2 | 56.5 | - | 12.4 | 105.1 |
| herceg-scatter | 0.0.0 (00800ca5) | 180.1 | 70.6 | 62.9 | - | 12.4 | 104.3 |
| herceg-spec-pdf | 0.0.0 (00800ca5) | 989.8 | 375.7 | 314.4 | - | - | 2.9 |
| herceg-svelte-line | 0.0.0 (00800ca5) | 163.6 | 63.8 | 57.0 | - | 12.4 | 105.1 |
| herceg-vue-line | 0.0.0 (00800ca5) | 162.4 | 63.3 | 56.5 | - | 12.4 | 105.1 |
| herceg-web | 0.0.0 (00800ca5) | 871.3 | 329.9 | 272.6 | - | 11.0 | 97.8 |
| plotly-basic | 4.1.2 | 1184.3 | 391.4 | 325.2 | - | - | - |
| plotly-full | 4.1.2 | 4699.6 | 1432.7 | 1084.5 | - | - | - |
| tanstack-line | 1.0.0 | 125.5 | 44.4 | 39.4 | - | - | - |
| uplot | 1.6.32 | 50.9 | 22.5 | 20.4 | 0.7 | - | - |
<!-- /results:size -->

## Initial render

Time from calling the library until rendering is complete and the next frame
has been produced. Libraries that need a different input format convert the
shared typed-array dataset inside the timed operation, as an application with
columnar data would. Scenarios marked large use each library's documented
large-data configuration (see the renderer line under Environment). Libraries
that render progressively (ECharts scatter and heatmap series) show part of
the chart early; the first-frame time is given in parentheses when it is
much lower than the time to complete rendering.

<!-- results:init -->
| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| line-small-init (4 series x 200 points) | 0.72 ± 0.13 | 1.51 ± 0.15 | 1.36 ± 0.24 | 3.13 ± 0.32 | 1.07 ± 0.20 | 0.54 ± 0.14 |
| line-medium-init (10 series x 5,000 points) | 2.44 ± 0.19 | 12.1 ± 1.14 | 5.83 ± 0.92 | 24.2 ± 3.07 | 39.7 ± 3.77 | 2.50 ± 0.20 |
| line-large-init (1 series x 1,000,000 points) | 4.93 ± 0.23 | 172 ± 21.6 | 16.7 ± 3.68 | 308 ± 10.5 | 719 ± 43.9 | 6.36 ± 0.50 |
| area-medium-init (3 filled series x 5,000 points) | 1.06 ± 0.12 | 5.88 ± 0.48 | 2.96 ± 0.20 | 10.5 ± 0.65 | 17.1 ± 0.71 | 1.18 ± 0.21 |
| bar-small-init (12 categories x 3 series) | 0.62 ± 0.16 | 1.32 ± 0.31 | 0.77 ± 0.12 | 2.79 ± 0.41 | 0.62 ± 0.14 | n/a |
| bar-medium-init (100 categories x 4 series) | 1.38 ± 0.15 | 2.85 ± 0.38 | 2.22 ± 0.28 | 7.87 ± 0.39 | 2.82 ± 0.15 | n/a |
| scatter-medium-init (10,000 points) | 2.54 ± 0.31 | 68.3 ± 2.43 (first frame 5.07) | 4.52 ± 0.62 | 75.9 ± 4.61 | 26.7 ± 2.75 | n/a |
| scatter-large-init (200,000 points) | 4.31 ± 0.24 | 59.5 ± 10.1 (first frame 42.6) | 71.9 ± 4.18 | 49.3 ± 3.39 | 235 ± 7.39 | n/a |
| heatmap-medium-init (100 x 100 cells) | 1.50 ± 0.19 | 25.7 ± 2.31 (first frame 5.17) | n/a | 3.80 ± 0.41 | 34.2 ± 1.12 | n/a |
| heatmap-large-init (500 x 500 cells) | 13.1 ± 0.82 | 4975 ± 18.1 (first frame 50.1) | n/a | 29.3 ± 3.16 | 461 ± 48.9 | n/a |
| candlestick-small-init (200 candles, each drawn by every library) | 0.89 ± 0.16 | 2.39 ± 0.29 | n/a | 4.29 ± 0.45 | n/a | n/a |
| candlestick-large-init (100,000 candles; each library's large-data strategy) | 7.49 ± 0.47 | 52.3 ± 3.39 (first frame 38.6) | n/a | 638 ± 15.4 | n/a | n/a |
| bubble-medium-init (10,000 points sized and colored by two fields) | 3.35 ± 0.32 | 71.7 ± 1.64 (first frame 6.04) | 65.0 ± 2.72 | 101 ± 2.50 | n/a | n/a |
| histogram-medium-init (10,000 values in bins 5 wide from 25, x from 25 to 175) | 0.79 ± 0.17 | n/a | n/a | 3.74 ± 0.30 | n/a | n/a |
| histogram-large-init (1,000,000 values in bins 5 wide from 25, x from 25 to 175) | 10.2 ± 1.40 | n/a | n/a | 77.0 ± 11.0 | n/a | n/a |
| line-massive-init (1 series x 10,000,000 points) | 38.3 ± 1.80 | 2096 ± 96.7 | 103 ± 5.28 | 2669 ± 11.2 | error | 46.6 ± 1.71 |
| scatter-massive-init (1,000,000 points) | 16.6 ± 1.89 | 309 ± 13.9 (first frame 176) | 429 ± 4.25 | 177 ± 6.49 | 1198 ± 26.0 | n/a |
<!-- /results:init -->

## Full data replacement

<!-- results:update -->
| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| line-medium-update (replace 10 x 5,000 points) | 1.16 ± 0.10 | 11.8 ± 1.36 | 4.12 ± 0.36 | 19.6 ± 0.81 | 37.7 ± 2.28 | 1.24 ± 0.19 |
| line-large-update (replace 1,000,000 points) | 3.53 ± 0.21 | 189 ± 14.1 | 14.9 ± 1.92 | 277 ± 3.24 | 695 ± 67.5 | 5.74 ± 0.07 |
| bar-medium-update (replace 100 x 4 bars) | 0.70 ± 0.08 | 1.83 ± 0.29 | 1.51 ± 0.12 | 6.04 ± 0.47 | 2.63 ± 0.33 | n/a |
| scatter-medium-update (replace 10,000 points) | 1.81 ± 0.31 | 80.6 ± 2.08 (first frame 19.4) | 4.44 ± 0.37 | 69.4 ± 5.07 | 41.9 ± 2.59 | n/a |
| heatmap-medium-update (replace 100 x 100 cells) | 0.65 ± 0.09 | 41.0 ± 0.99 (first frame 19.4) | n/a | 3.66 ± 0.50 | 45.1 ± 2.25 | n/a |
<!-- /results:update -->

## Streaming

One tick appends points to every series, drops the oldest points to keep the
window size, and waits for the next frame. Each library uses its documented
live-data path: `setOption` (ECharts), array mutation plus `update('none')`
(Chart.js), `extendTraces` with `maxPoints` (Plotly), a new definition
(TanStack Charts), and `setData` (uPlot).

<!-- results:stream -->
| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stream-dashboard-chart (15 series, 3,000-point window, +1 point per tick) | 1.20 ± 0.14 | 10.4 ± 0.57 | 3.46 ± 0.41 | 19.6 ± 0.81 | 30.7 ± 1.41 | 0.88 ± 0.08 |
| stream-large (1 series, 100,000-point window, +100 points per tick) | 0.68 ± 0.11 | 18.1 ± 1.48 | 3.06 ± 0.34 | 29.4 ± 0.62 | 55.9 ± 2.78 | 0.99 ± 0.07 |
| stream-massive (1 series, 1,000,000-point window, +10,000 points per tick) | 1.45 ± 0.12 | 156 ± 1.57 | 19.1 ± 0.50 | 270 ± 2.41 | 636 ± 28.3 | 5.79 ± 0.17 |
<!-- /results:stream -->

### Paced ingestion

A timer appends data at a fixed rate for five seconds while the display runs
at its normal refresh rate; each library decides when to render. A frame
interval spanning k refresh periods counts as k - 1 dropped frames. When a
library blocks the main thread, the timer fires less often and the achieved
ingestion rate drops below the target.

<!-- results:ingest -->
| Scenario (frame interval p50 / p95 / p99, dropped frames, achieved ingest rate) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ingest-chart-10hz (15 series, 3,000-point window, +1 point at 10 Hz) | 16.7 / 16.7 / 17.4 ms, 0 dropped, 10 Hz | 16.7 / 17.0 / 17.6 ms, 0 dropped, 10 Hz | 16.7 / 16.8 / 17.5 ms, 0 dropped, 10 Hz | 16.7 / 16.7 / 17.2 ms, 1 dropped, 10 Hz | 16.7 / 17.0 / 17.4 ms, 2 dropped, 10 Hz | 16.7 / 16.7 / 17.4 ms, 0 dropped, 10 Hz |
| ingest-chart-60hz (15 series, 3,000-point window, +1 point at 60 Hz) | 16.7 / 17.0 / 17.6 ms, 0 dropped, 62 Hz | 16.7 / 16.7 / 17.4 ms, 0 dropped, 62 Hz | 16.7 / 17.1 / 17.5 ms, 0 dropped, 62 Hz | 16.7 / 33.3 / 33.3 ms, 19 dropped, 56 Hz | 33.3 / 33.5 / 34.2 ms, 131 dropped, 34 Hz | 16.7 / 17.2 / 17.6 ms, 0 dropped, 62 Hz |
| ingest-chart-100hz (15 series, 3,000-point window, +1 point at 100 Hz) | 16.7 / 17.2 / 17.5 ms, 0 dropped, 100 Hz | 16.7 / 17.2 / 17.4 ms, 0 dropped, 100 Hz | 16.7 / 17.3 / 17.6 ms, 0 dropped, 100 Hz | 16.7 / 33.3 / 33.3 ms, 21 dropped, 56 Hz | 33.3 / 33.7 / 43.2 ms, 130.5 dropped, 34 Hz | 16.7 / 17.3 / 17.6 ms, 0 dropped, 100 Hz |
| ingest-large-100hz (1 series, 100,000-point window, +10 points at 100 Hz) | 16.7 / 17.3 / 17.6 ms, 0 dropped, 100 Hz | 16.7 / 16.7 / 17.4 ms, 0 dropped, 60 Hz | 16.7 / 17.1 / 17.6 ms, 0 dropped, 100 Hz | 33.3 / 33.3 / 34.0 ms, 125.5 dropped, 35 Hz | 50.0 / 66.7 / 83.3 ms, 210 dropped, 18 Hz | 16.7 / 17.2 / 17.5 ms, 0 dropped, 100 Hz |
| ingest-dashboard-10hz (10 charts x 15 series x 3,000 points, +1 point per series at 10 Hz) | 16.7 / 17.0 / 17.6 ms, 0.5 dropped, 10 Hz | 16.7 / 83.3 / 100.0 ms, 166 dropped, 10 Hz | 16.7 / 16.7 / 17.5 ms, 2 dropped, 10 Hz | 167 / 167 / 184 ms, 264.5 dropped, 6 Hz | 283 / 333 / 342 ms, 291 dropped, 3 Hz | 16.7 / 17.1 / 17.5 ms, 0 dropped, 10 Hz |
<!-- /results:ingest -->

## Interaction

Real pointer moves (Chrome DevTools Protocol input) aimed at data points, to
the end of the next frame, with tooltips enabled. Moves are spaced 70 ms apart
so throttled hover handlers run for each event. Zoom scenarios change the x
range through each library's documented zoom path (see
`benchmarks/README.md`); Plotly keeps its full-data y range while zooming,
the others rescale y to the visible points. "error" means the library's tab
crashed (out of memory) or the scenario timed out.

<!-- results:interaction -->
| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hover-line-medium (pointer moves over 10 x 5,000 points) | 0.56 ± 0.21 | 10.7 ± 1.19 | 0.89 ± 0.44 | 10.1 ± 1.44 | 14.8 ± 5.00 | 0.46 ± 0.25 |
| hover-line-large (pointer moves over 1,000,000 points) | 0.36 ± 0.07 | 0.80 ± 0.33 | 0.44 ± 0.11 | 445 ± 184 | 90.8 ± 1.59 | 0.23 ± 0.04 |
| hover-scatter-medium (pointer moves over 10,000 points) | 0.41 ± 0.22 | 7.13 ± 1.08 | 1.85 ± 0.67 | 15.5 ± 1.08 | 3.89 ± 1.97 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom-line-large (x ranges of 50%, 10%, and 1% of 1,000,000 points, panning) | 0.77 ± 0.27 | 6.15 ± 0.49 | 1.89 ± 0.61 | 0.99 ± 0.25 | 56.4 ± 49.2 | 1.02 ± 0.68 |
| zoom-line-massive (x ranges of 50%, 10%, and 1% of 10,000,000 points, panning) | 1.49 ± 0.52 | 47.9 ± 2.02 | 6.81 ± 4.88 | 0.86 ± 0.08 | error | 4.81 ± 3.96 |
| zoom-scatter-massive (x ranges of 50%, 10%, and 1% of 1,000,000 points, panning) | 3.74 ± 0.22 | 36.6 ± 16.7 | 193 ± 26.3 | 7.33 ± 0.33 | 169 ± 145 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| resize-line-medium (resize 800x400 <-> 600x300) | 1.26 ± 0.14 | 3.53 ± 0.35 | 4.18 ± 0.24 | 11.8 ± 1.20 | 35.2 ± 1.59 | 1.43 ± 0.32 |
<!-- /results:interaction -->

## Linked selections

Herceg's charts bound to one selection store (`rowSelection`) show the same
rows wherever they are drawn, summaries included: brushing a scatter dims
the rows it leaves out in another scatter, draws the brushed part of each
histogram bar and the brushed values' own box over each box plot's, and a
grid of the same table shows them selected. Measured in Node only
(`npm run bench:core`, Apple M6): brushing a scatter of 1,000,000 points
with a histogram and a box plot following takes ~10 ms a step, ~1.7 ms of it
testing the brush's condition over the rows (column by column; ~21 ms row by
row before), the rest each chart's scene; none of the other libraries has an
equivalent to measure against, so this is not a comparison.

- **ECharts.** The brush component (rectangles, polygons, x and y ranges,
  started from the toolbox or the API) styles items in and out of it
  (`inBrush`, `outOfBrush`) and links series of one chart whose data indices
  correspond (`brushLink`). It does not map raw rows into summaries drawn
  from them: a histogram or box plot built from the data shows no selected
  part unless the application filters, aggregates again, and draws another
  series. An instance's image export captures the rendered state, brush
  included; a chart made again from its options needs the brush restored
  by the application.
- **Plotly.** Box and lasso selections set `selectedpoints` on scatter, bar,
  and histogram traces, styled through `selected` and `unselected` (a
  histogram's bars by the bins selected); box traces style their sample
  points only, without quartiles of the selection, and selections link
  charts only through callbacks (Dash in Python). Static export draws what
  the figure carries, so a Python figure needs the browser's selection sent
  back first. Its crossfilter examples filter and redraw rather than show a
  selected part of each summary.
- **TanStack Charts.** `keyedSelection` selects one point by a key (click,
  Enter, or Space) through a controlled signal the application owns, and
  `whenSelected` paints a second, decorative copy of a mark filtered to
  the selected key; `brushX` is a controlled horizontal range with
  keyboard handles, kept in static SVG. Linking charts means sharing that
  state, and what a brushed range selects in another chart, summaries
  included, is the application's to compute and draw.
- **Chart.js** has no selection of data to link (it zooms and pans through
  a plugin).
- **Vega-Lite**, not in the benchmark, draws a crossfilter as two layers: the
  whole data's bars behind bars aggregated after filtering by the
  selection, which is the same picture for histograms; its selection
  parameters take an initial value in the spec, as Herceg's bindings take
  a `selection`.

Herceg's own limits: lassos select none of a summary's rows, contours (a
field sampled on a grid) do not show selections, tables a derived table
aggregates are not linked to its rows, and summaries recount their selected
parts with each change of the selection rather than following a brush's
moves incrementally.

## Dashboard

Ten 600x250 line charts, each with 15 series of 3,000 points (450,000 points).
"Refresh" replaces the data of all ten charts in one task.

<!-- results:dashboard -->
| Mount all charts (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dashboard (10 charts x 15 series x 3,000 points) | 19.1 ± 0.61 | 84.6 ± 2.89 | 44.9 ± 6.20 | 178 ± 6.03 | 313 ± 8.13 | 16.6 ± 1.03 |

| Refresh all charts (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dashboard (10 charts x 15 series x 3,000 points) | 11.1 ± 0.51 | 108 ± 1.18 | 37.0 ± 1.60 | 180 ± 5.19 | 334 ± 30.1 | 10.7 ± 1.60 |
<!-- /results:dashboard -->

## Memory

Retained heap is the increase in V8 heap, Blink heap, and ArrayBuffer backing
stores after mounting, measured after forced garbage collection. Canvas bytes
are estimated from canvas dimensions (width x height x 4) and are not part of
the heap number. Source data is created before the baseline and is not
included.

<!-- results:memory -->
| Scenario | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| memory-line-large (1 chart, 1,000,000 points; source 16 MB) | 0.2 MB heap, 5.1 MB canvas, 35 nodes | 243 MB heap, 5.1 MB canvas, 4 nodes | 49 MB heap, 5.1 MB canvas, 3 nodes | 111 MB heap, 15 MB canvas, 135 nodes | 600 MB heap, 26 MB canvas, 8 nodes | 0.2 MB heap, 5.1 MB canvas, 24 nodes |
| memory-dashboard (10 charts x 15 series x 3,000 points; source 3.9 MB) | 5.9 MB heap, 24 MB canvas, 762 nodes | 115 MB heap, 24 MB canvas, 40 nodes | 57 MB heap, 24 MB canvas, 30 nodes | 48 MB heap, 0.0 MB canvas, 2257 nodes | 273 MB heap, 0.0 MB canvas, 814 nodes | 2.8 MB heap, 24 MB canvas, 1080 nodes |
| memory-small-100 (100 charts x 2 series x 100 points; source 0.3 MB) | 9.2 MB heap, 0.0 MB canvas, 3679 nodes | 24 MB heap, 72 MB canvas, 400 nodes | 31 MB heap, 72 MB canvas, 300 nodes | 28 MB heap, 0.0 MB canvas, 13061 nodes | 21 MB heap, 0.0 MB canvas, 2274 nodes | 11 MB heap, 72 MB canvas, 3000 nodes |
<!-- /results:memory -->

## 3D charts

3D layers also compose into subplots beside other chart families. Each
subplot has its own camera, orbit toolbar, keyboard turning, and scoped
camera event; 3D facets are refused. Subplots use CPU rendering and retain
one latest geometry and Canvas raster per panel. Standalone charts retain
the WebGL paths measured below. Plotly provides [3D subplots via scenes](https://plotly.com/javascript/3d-subplots/),
and ECharts GL provides [multiple grid3D viewports](https://github.com/ecomfe/echarts-gl/blob/master/test/grid3D-viewport.html);
TanStack Charts and Chart.js have no built-in 3D families. Competitor
subplot timings have not been measured.

A dedicated [two-panel workload](../benchmarks/results/3d-panels.json)
(Chrome 155.0.8059.86, Apple M6, production build, DPR 1,
1000 × 500 px, two separate 50,000-point tables, five samples of 120 turns
after 30 warmup turns) measures turning one panel on Canvas. The setter
and synchronous paint take 4.55 ± 0.06 ms across sample means;
per-turn p50/p95/p99 are 4.51/4.75/5.00 ms. Paced frame intervals are
16.7 ms at all three percentiles. A separate instrumented turn sorts one
panel, projects 50,000 points plus 83 box guides, and traces 50,000 discs;
the other panel only composites cached pixels. Source columns are 2.4 MB;
CDP backing storage rises by 10.72 MB over the empty page, stays unchanged
through 600 further turns, and returns within 1.3 kB of baseline after
destruction and two idle frames. JavaScript heap rises about 2.68 MB;
canvas pixel storage is separate (about 1.80 MB of panel rasters plus
2.00 MB of main canvas). No camera-history cache is retained. These are
Herceg workload measurements, with no relative performance claim.
Reproduce with `node --experimental-strip-types benchmarks/src/three-panels/run.ts --out PATH`.

3D state and controls stay out of charts that do not use them: in a
same-base check, 3D subplots left the basic line entry 113 bytes gzip
smaller and the grid and pivot entries unchanged, while the full-spec PDF
entry, which includes every mark, grew by 1,189 bytes gzip for subplot
camera state, controls, and CPU caches.

Mounting a 3D chart, and turning its camera through a sequence of angles
(steps of 7 degrees around, tilting between 10 and 50 degrees above the
floor), each to the end of the next frame, in a run of these scenarios alone
(`npm run bench -- --lib herceg,herceg-cpu,plotly --scenario ... --out results/three.json`).
Both libraries project orthographically with a cube box, points 7 px across
of one color, and surfaces colored by height and shaded (their defaults).
Plotly draws every 3D chart with WebGL (gl3d) and turns it through
`relayout` of `scene.camera.eye`. Herceg draws on the GPU (WebGL) from
20,000 points or 10,000 surface cells (a 200 x 200 surface and up), and
below that on a canvas (SVG for small surfaces); `herceg-cpu` is Herceg with
WebGL2 unavailable, so every chart is drawn on the CPU, the baseline its GPU
path is measured against (it refuses surfaces over 250,000 grid points,
so its 1001 x 1001 rows below are refusals). `rotate` timings end with the next frame's script, so they
leave out the GPU's own work, for Plotly as for Herceg; `orbit` turns the
camera a step every frame with the display's refresh on (60 Hz) and
reports the intervals between frames, which include it. Memory is the retained heap after
mounting; GPU buffers are not in it (Herceg's are 49 MB at a million cells).
Herceg's benchmark adapter gives surfaces a matrix table (`fromMatrix`), x
and y once each and z as the grid's heights, as Plotly takes them, so a
surface keeps no row per grid point. ECharts (through ECharts-GL) is not
included.

<!-- results:three -->
- Date: 2026-10-26, commit 00800ca5
- Machine: Apple M6, 12 cores, 32 GB, Darwin 27.0.0
- Browser: Chrome 155.0.8059.86 through Playwright 1.63.0 (installed Google Chrome), GPU ANGLE (Apple, ANGLE Metal Renderer: Apple M6, Unspecified Version), headed, idle frames every 17.7 ms
- Viewport 1280x1400, device pixel ratio 2
- Libraries: herceg 0.0.0 (00800ca5), herceg-cpu 0.0.0 (00800ca5), plotly 4.1.2
- Renderers (normal / large config): herceg: auto (svg below 4,000 drawn points, canvas above; 3D charts on WebGL from 20,000 points or 10,000 surface cells) / auto; herceg-cpu: auto without WebGL2 (svg below 4,000 drawn points, canvas above) / auto without WebGL2; plotly: svg / webgl (scattergl)

| Scenario (ms, median ± MAD) | herceg | herceg-cpu | plotly |
| --- | ---: | ---: | ---: |
| scatter3d-10k-init (10,000 points in 3D) | 2.76 ± 0.16 | 2.60 ± 0.19 | 36.6 ± 2.95 |
| surface-100-init (100 x 100 grid surface) | 10.6 ± 1.47 | 11.9 ± 1.00 | 41.8 ± 2.95 |
| surface-317-init (317 x 317 grid surface (99,856 cells)) | 20.4 ± 2.60 | 100 ± 4.43 | 71.1 ± 2.50 |
| surface-1001-init (1001 x 1001 grid surface (1,000,000 cells)) | 148 ± 2.72 | error | 460 ± 21.0 |

| Scenario (ms, median ± MAD) | herceg | herceg-cpu | plotly |
| --- | ---: | ---: | ---: |
| rotate-scatter3d-10k (10,000 points in 3D) | 1.39 ± 0.19 | 1.42 ± 0.19 | 5.17 ± 0.27 |
| rotate-scatter3d-100k (100,000 points in 3D) | 0.29 ± 0.08 | 13.5 ± 2.28 | 10.4 ± 0.37 |
| rotate-scatter3d-1m (1,000,000 points in 3D) | 0.35 ± 0.06 | 203 ± 6.38 | error |
| rotate-surface-50 (50 x 50 grid surface) | 2.70 ± 0.47 | 2.72 ± 0.31 | 4.61 ± 0.20 |
| rotate-surface-200 (200 x 200 grid surface) | 0.39 ± 0.08 | 27.7 ± 2.15 | 6.90 ± 0.33 |
| rotate-surface-317 (317 x 317 grid surface (99,856 cells)) | 0.35 ± 0.07 | 92.2 ± 2.33 | 11.5 ± 0.38 |
| rotate-surface-1001 (1001 x 1001 grid surface (1,000,000 cells)) | 0.38 ± 0.03 | error | 66.6 ± 0.75 |

| Frame interval (ms, median) | herceg | herceg-cpu | plotly |
| --- | ---: | ---: | ---: |
| orbit-surface-317 (317 x 317 grid surface (99,856 cells), turned every frame) | 16.7 (p95 17.0), 0 of 60 late | 66.7 (p95 66.7), 60 of 60 late | 16.7 (p95 16.7), 0 of 60 late |
| orbit-surface-1001 (1001 x 1001 grid surface (1,000,000 cells), turned every frame) | 16.7 (p95 16.8), 0 of 60 late | error | 66.7 (p95 66.7), 60 of 60 late |

| Scenario | herceg | herceg-cpu | plotly |
| --- | ---: | ---: | ---: |
| memory-surface-1001 (1001 x 1001 grid surface (1,000,000 cells); source 8.0 MB) | 8.7 MB heap, 5.1 MB canvas, 56 nodes | error | 1.2 MB heap, 4.6 MB canvas, 78 nodes |
<!-- /results:three -->

## Grids

Herceg's grid (`herceg/grid`, and the same grid through
`@herceg/react/grid`) against TanStack Table 9 with TanStack Virtual, AG Grid
Community 36, and Glide Data Grid 6, from `npm run bench:grid` (methodology:
`benchmarks/README.md`, "Grids"). Every grid shows the same seeded table (16
number, 2 time, and 2 category fields per 20, with missing values, ties, and
duplicated rows) in 1200 x 600 pixels with 28 px rows, a 32 px header,
120 px columns, and the same cell text. A timing ends at the first frame
whose rows, cells, selection, and row count match an independent reference,
read just before the frame paints; a grid that never shows the right result
is reported incorrect, not timed. Latency scenarios start from an idle page
with the frame rate limit off; scroll traces and streaming run with vsync.

Read these with the configurations in mind:

- TanStack Table and AG Grid take row objects, so "from the columns" includes
  converting the shared typed columns into them; "from native input" starts
  from objects already made. Herceg reads the columns in place and Glide
  through `getCellContent`.
- Glide has no row model. Its sort and filter rows measure Glide drawing the
  result of adapter code (a typed-array index sort and scan), labeled
  external; they are not Glide's own processing. Glide draws on a canvas, and
  what it shows is read from what it reports drawing, not from pixels. The
  suite uses its 6.0.4 prerelease, the first to support React 19.
- AG Grid Community has no set filter, so category membership goes through
  its external filter; sorting uses a comparator that keeps missing values
  last, with delta sorting for transactions.
- Grouping, pivots, a grid linked to a chart, keyboard and screen reader
  behavior, and bundle sizes are not compared here.

<!-- results:grid -->
- Date: 2026-10-26, commit d42d5d65
- Machine: Apple M6, 12 cores, 32 GB, Darwin 27.0.0
- Browser: Chrome 155.0.8059.86, GPU ANGLE (Apple, ANGLE Metal Renderer: Apple M6, Unspecified Version), headed, viewport 1280x720, device pixel ratio 1
- Libraries: herceg 0.0.0 (d42d5d65); herceg-react 0.0.0 (d42d5d65) (react 19.3.0, react-dom 19.3.0); tanstack-table 9.2.8 (@tanstack/react-virtual 3.14.13, react 19.3.0, react-dom 19.3.0); ag-grid 36.2.0; glide 6.0.4-alpha24 (react 19.3.0, react-dom 19.3.0)
- herceg: DOM rows and cells (10 rows and 2 columns of overscan); sort native (row view); filter native (row view, expression)
- herceg-react: DOM rows and cells, mounted through @herceg/react/grid (React 19); sort native (row view); filter native (row view, expression)
- tanstack-table: DOM table, React 19 (TanStack Virtual rows with 10 overscan, columns with 3); sort native (sorted row model); filter native (filtered row model)
- ag-grid: DOM rows and cells (rowBuffer 10, column virtualization), Quartz theme; sort native (comparator keeping missing values last, delta sort); filter native number filter; external filter for category membership
- glide: Canvas 2D, React 19 (pixel scrolling, no row markers); sort external: adapter code (typed-array index sort, merge on append); filter external: adapter code (typed-array scan)

| Mount (ms, median ± MAD) | herceg | herceg-react | tanstack-table | ag-grid | glide |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k x 20: from native input | 3.29 ± 0.12 | 3.47 ± 0.27 | 7.60 ± 0.25 | 12.5 ± 0.36 | 1.77 ± 0.18 (3 frames) |
| 10k x 20: from the columns, conversion included | 3.36 ± 0.26 | 3.55 ± 0.07 | 10.8 ± 0.49 | 15.9 ± 0.74 | 1.68 ± 0.16 |
| 10k x 20: conversion alone | 0.07 ± 0.01 | 0.06 ± 0.01 | 3.26 ± 0.17 | 3.37 ± 0.19 | 0.00 ± 0.00 |
| 10k x 20: destroy | 0.58 ± 0.06 | 0.57 ± 0.04 | 0.60 ± 0.04 | 1.13 ± 0.03 | 0.15 ± 0.02 |
| 100k x 20: from native input | 3.25 ± 0.13 | 3.51 ± 0.25 | 40.0 ± 0.77 | 36.1 ± 0.37 | 1.67 ± 0.22 (3 frames) |
| 100k x 20: from the columns, conversion included | 3.43 ± 0.26 | 3.62 ± 0.27 | 77.4 ± 1.12 | 75.1 ± 0.48 | 1.68 ± 0.15 |
| 100k x 20: conversion alone | 0.15 ± 0.03 | 0.14 ± 0.02 | 40.2 ± 0.29 | 39.5 ± 0.36 | 0.00 ± 0.00 |
| 100k x 20: destroy | 0.58 ± 0.04 | 0.56 ± 0.04 | 0.33 ± 0.00 | 1.10 ± 0.02 | 0.14 ± 0.03 |
| 1M x 20: from native input | 3.43 ± 0.07 | 3.74 ± 0.09 | 436 ± 62.7 | 308 ± 0.49 | 2.52 ± 0.50 (3 frames) |
| 1M x 20: from the columns, conversion included | 4.38 ± 0.20 | 4.88 ± 0.33 | 1126 ± 28.7 | 703 ± 3.08 | 2.22 ± 0.02 |
| 1M x 20: conversion alone | 0.88 ± 0.00 | 1.25 ± 0.01 | 692 ± 6.92 | 394 ± 1.93 | 0.00 ± 0.00 |
| 1M x 20: destroy | 0.56 ± 0.00 | 0.63 ± 0.02 | 0.40 ± 0.01 | 1.23 ± 0.00 | 0.16 ± 0.05 |
| 1M x 100: from native input | 3.35 ± 0.15 | 3.74 ± 0.19 | error [1] | error [2] | 2.26 ± 0.69 (3 frames) |
| 1M x 100: from the columns, conversion included | 7.57 ± 0.35 | 7.67 ± 0.23 | error [1] | error [2] | 2.09 ± 0.18 |
| 1M x 100: conversion alone | 4.11 ± 0.13 | 4.10 ± 0.02 | error [1] | error [2] | 0.01 ± 0.00 |
| 1M x 100: destroy | 0.60 ± 0.08 | 0.57 ± 0.08 | error [1] | error [2] | 0.17 ± 0.04 |

| Scroll a step to its correct frame (ms) | herceg | herceg-react | tanstack-table | ag-grid | glide |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k x 20: a screen down | 3.63 ± 0.36 | 3.44 ± 0.38 | 4.77 ± 0.60 | 3.54 ± 0.44 | 0.69 ± 0.06 (2 frames) |
| 10k x 20: three columns across | 2.73 ± 0.80 | 2.58 ± 0.78 | 3.08 ± 0.32 | 2.74 ± 0.31 | 0.69 ± 0.16 (2 frames) |
| 10k x 20: both | 4.88 ± 0.39 | 5.05 ± 0.51 | 6.69 ± 1.20 | 6.47 ± 1.28 | 0.91 ± 0.16 (2 frames) |
| 10k x 20: to the last row and back | 2.47 ± 0.32 | 2.68 ± 0.32 | 4.25 ± 0.33 | 5.54 ± 1.05 | 0.78 ± 0.15 (2 frames) |
| 100k x 20: a screen down | 3.94 ± 0.20 | 3.70 ± 0.34 | 4.96 ± 0.36 | 4.08 ± 0.30 | 0.78 ± 0.12 (2 frames) |
| 100k x 20: three columns across | 3.10 ± 0.89 | 2.93 ± 0.98 | 2.79 ± 0.29 | 3.03 ± 0.33 | 0.68 ± 0.14 (2 frames) |
| 100k x 20: both | 5.07 ± 0.46 | 4.76 ± 0.40 | 6.06 ± 0.85 | 5.59 ± 0.34 | 1.10 ± 0.16 (2 frames) |
| 100k x 20: to the last row and back | 2.62 ± 0.28 | 2.84 ± 0.29 | 3.71 ± 0.37 | 5.00 ± 0.40 | 0.84 ± 0.19 (2 frames) |
| 1M x 20: a screen down | 3.45 ± 0.56 | 3.37 ± 0.41 | 3.23 ± 0.08 | 5.89 ± 0.70 | 1.02 ± 0.13 (2 frames) |
| 1M x 20: to the last row and back | 3.32 ± 0.11 | 2.30 ± 0.26 | 4.77 ± 0.41 | 7.06 ± 0.41 | 1.00 ± 0.13 (2 frames) |
| 1M x 100: a screen down | 3.76 ± 0.16 | 2.89 ± 0.13 | error [3] | error [4] | 1.07 ± 0.20 (2 frames) |
| 1M x 100: to the last row and back | 3.38 ± 0.32 | 2.47 ± 0.28 | error [5] | error [6] | 1.19 ± 0.22 (2 frames) |

| Continuous scrolling for 3 s with vsync (frame interval p50 / p95 / p99 ms; dropped frames; incomplete frames) | herceg | herceg-react | tanstack-table | ag-grid | glide |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k x 20: down, offset set every frame | 16.7 / 16.9 / 17.6; 0 dropped; 0 of 180.5 incomplete | 16.7 / 17.1 / 17.5; 0 dropped; 0 of 181 incomplete | 16.7 / 16.9 / 17.3; 0 dropped; 0 of 180.5 incomplete | 16.7 / 16.9 / 17.6; 0 dropped; 0 of 180 incomplete | 16.7 / 16.8 / 17.4; 0 dropped; 179.5 of 180.5 incomplete |
| 10k x 20: down and across, offset set every frame | 16.7 / 16.7 / 17.4; 0 dropped; 0 of 181 incomplete | 16.7 / 17.0 / 17.5; 0 dropped; 0 of 181 incomplete | 16.7 / 17.0 / 17.5; 0 dropped; 0 of 180 incomplete | 16.7 / 16.7 / 17.5; 0 dropped; 0 of 180.5 incomplete | 16.7 / 17.1 / 17.5; 0 dropped; 180 of 181 incomplete |
| 10k x 20: down, browser wheel events | 16.7 / 17.2 / 17.5; 0 dropped; 0 of 180 incomplete; 170 wheel events, 8.7k px | 16.7 / 17.4 / 17.6; 0 dropped; 0 of 180 incomplete; 173 wheel events, 8.8k px | 16.7 / 17.3 / 17.6; 0 dropped; 0 of 180 incomplete; 174.5 wheel events, 8.8k px | 16.7 / 17.4 / 33.3; 3 dropped; 0 of 178 incomplete; 160 wheel events, 8.7k px | 16.7 / 17.0 / 17.6; 0 dropped; 116.5 of 180.5 incomplete; 175.5 wheel events, 8.8k px |
| 100k x 20: down, offset set every frame | 16.7 / 16.9 / 17.4; 0 dropped; 0 of 180.5 incomplete | 16.7 / 16.8 / 17.4; 0 dropped; 0 of 180 incomplete | 16.7 / 16.9 / 17.6; 0 dropped; 0 of 180 incomplete | 16.7 / 17.0 / 17.5; 0 dropped; 0 of 180 incomplete | 16.7 / 17.0 / 17.6; 0 dropped; 179 of 180 incomplete |
| 100k x 20: down and across, offset set every frame | 16.7 / 17.0 / 17.5; 0 dropped; 0 of 181 incomplete | 16.7 / 16.7 / 17.4; 0 dropped; 0 of 180.5 incomplete | 16.7 / 16.7 / 17.3; 0 dropped; 0 of 180.5 incomplete | 16.7 / 17.1 / 17.6; 0 dropped; 0 of 180.5 incomplete | 16.7 / 16.8 / 17.4; 0 dropped; 179.5 of 180.5 incomplete |
| 100k x 20: down, browser wheel events | 16.7 / 17.3 / 17.6; 0 dropped; 0 of 180.5 incomplete; 172.5 wheel events, 8.8k px | 16.7 / 17.3 / 17.6; 0 dropped; 0 of 180.5 incomplete; 170 wheel events, 8.8k px | 16.7 / 17.2 / 17.6; 0 dropped; 0 of 180.5 incomplete; 176.5 wheel events, 8.9k px | 16.7 / 17.3 / 33.3; 4.5 dropped; 0 of 176.5 incomplete; 167.5 wheel events, 8.8k px | 16.7 / 17.0 / 17.5; 0 dropped; 117 of 180 incomplete; 174 wheel events, 8.7k px |

| Sort and filter to the correct frame (ms; time inside the call) | herceg | herceg-react | tanstack-table | ag-grid | glide |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k x 20: sort a number ascending | 3.90 ± 0.08; 0.04 in call | 4.32 ± 0.52; 0.03 in call | 9.17 ± 0.30; 6.55 in call | 9.83 ± 0.32; 7.14 in call | 2.87 ± 0.28; 2.62 in call |
| 10k x 20: sort a number descending | 3.85 ± 0.09; 0.03 in call | 3.95 ± 0.13; 0.03 in call | 9.07 ± 0.09; 6.48 in call | 10.2 ± 0.59; 7.39 in call | 2.60 ± 0.17; 2.35 in call |
| 10k x 20: sort by category, then number | 5.11 ± 0.13; 0.04 in call | 5.12 ± 0.08; 0.04 in call | 12.1 ± 0.19; 9.53 in call | 11.7 ± 0.23; 9.00 in call | 3.18 ± 0.09; 2.95 in call |
| 10k x 20: number range, ~1% kept | 2.88 ± 0.16; 0.05 in call | 3.00 ± 0.21; 0.05 in call | 4.22 ± 0.19; 1.61 in call | 6.07 ± 0.25; 3.45 in call | 1.02 ± 0.15; 0.70 in call |
| 10k x 20: number range, ~50% kept | 2.45 ± 0.12; 0.05 in call | 2.47 ± 0.12; 0.05 in call | 3.50 ± 0.18; 1.74 in call | 4.70 ± 0.44; 3.04 in call | 1.06 ± 0.12; 0.78 in call |
| 10k x 20: number range, ~99% kept | 0.89 ± 0.06; 0.04 in call | 0.89 ± 0.06; 0.05 in call | 1.99 ± 0.16; 1.38 in call | 2.16 ± 0.25; 1.31 in call | 1.22 ± 0.16; 0.85 in call |
| 10k x 20: category membership, ~1% kept | 2.84 ± 0.09; 0.07 in call | 3.01 ± 0.18; 0.08 in call | 4.32 ± 0.12; 1.79 in call | 5.99 ± 0.65; 3.36 in call | 0.99 ± 0.19; 0.72 in call |
| 10k x 20: category membership, ~50% kept | 2.68 ± 0.18; 0.12 in call | 2.64 ± 0.10; 0.12 in call | 3.22 ± 0.19; 1.69 in call | 4.04 ± 0.62; 2.38 in call | 1.74 ± 0.13; 1.45 in call |
| 10k x 20: category membership, ~99% kept | 1.13 ± 0.12; 0.15 in call | 1.10 ± 0.10; 0.15 in call | 2.34 ± 0.24; 1.62 in call | 1.74 ± 0.22; 1.07 in call | 3.78 ± 0.21; 3.49 in call |
| 100k x 20: sort a number ascending | 15.7 ± 0.13; 0.03 in call | 15.9 ± 0.20; 0.04 in call | 80.7 ± 2.02; 78.0 in call | 78.0 ± 1.74; 75.3 in call | 14.9 ± 0.20; 14.6 in call |
| 100k x 20: sort a number descending | 16.0 ± 0.20; 0.04 in call | 15.7 ± 0.17; 0.04 in call | 81.0 ± 1.72; 78.4 in call | 78.5 ± 1.36; 75.8 in call | 14.9 ± 0.12; 14.7 in call |
| 100k x 20: sort by category, then number | 24.7 ± 0.28; 0.04 in call | 25.2 ± 0.59; 0.03 in call | 91.9 ± 1.08; 89.4 in call | 78.4 ± 2.95; 75.7 in call | 24.0 ± 0.16; 23.7 in call |
| 100k x 20: number range, ~1% kept | 3.57 ± 0.36; 0.05 in call | 3.63 ± 0.32; 0.06 in call | 8.88 ± 0.43; 6.31 in call | 11.6 ± 0.44; 9.11 in call | 1.06 ± 0.15; 0.77 in call |
| 100k x 20: number range, ~50% kept | 3.66 ± 0.27; 0.05 in call | 3.62 ± 0.52; 0.06 in call | 11.3 ± 1.09; 9.11 in call | 12.1 ± 0.29; 10.4 in call | 1.36 ± 0.13; 1.07 in call |
| 100k x 20: number range, ~99% kept | 1.71 ± 0.17; 0.04 in call | 1.72 ± 0.22; 0.05 in call | 8.63 ± 0.43; 7.99 in call | 8.35 ± 0.25; 7.62 in call | 1.18 ± 0.22; 0.89 in call |
| 100k x 20: category membership, ~1% kept | 3.65 ± 0.33; 0.07 in call | 3.52 ± 0.20; 0.08 in call | 9.29 ± 0.36; 6.69 in call | 8.55 ± 0.67; 6.04 in call | 1.10 ± 0.15; 0.81 in call |
| 100k x 20: category membership, ~50% kept | 3.84 ± 0.53; 0.12 in call | 3.81 ± 0.43; 0.12 in call | 11.3 ± 0.90; 9.76 in call | 9.08 ± 1.04; 7.52 in call | 2.12 ± 0.16; 1.82 in call |
| 100k x 20: category membership, ~99% kept | 1.86 ± 0.34; 0.15 in call | 1.93 ± 0.37; 0.16 in call | 9.99 ± 0.66; 9.33 in call | 7.03 ± 1.44; 5.81 in call | 4.29 ± 0.41; 4.00 in call |
| 1M x 20: sort a number descending | 165 ± 1.96; 0.06 in call | 165 ± 1.41; 0.06 in call | 1528 ± 2.03; 1525 in call | 1461 ± 8.39; 1458 in call | 171 ± 0.50; 171 in call |
| 1M x 20: number range, ~50% kept | 7.51 ± 0.43; 0.07 in call | 6.08 ± 1.13; 0.07 in call | 108 ± 0.65; 106 in call | 86.8 ± 0.01; 84.9 in call | 6.81 ± 0.30; 6.41 in call |
| 1M x 100: sort a number descending | 161 ± 1.06; 0.02 in call | 162 ± 0.92; 0.03 in call | error [7] | error [8] | 170 ± 0.02; 170 in call |
| 1M x 100: number range, ~50% kept | 6.16 ± 1.22; 0.07 in call | 6.12 ± 0.03; 0.07 in call | error [9] | error [10] | 6.18 ± 0.95; 5.87 in call |

| Select rows, sorted (ms to the correct frame) | herceg | herceg-react | tanstack-table | ag-grid | glide |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k x 20: one row | 0.79 ± 0.10 | 0.93 ± 0.06 | 1.18 ± 0.12 | 0.92 ± 0.08 | 0.88 ± 0.14 |
| 10k x 20: half the rows in display order | 1.01 ± 0.12 | 1.00 ± 0.12 | 2.31 ± 0.28 | 3.03 ± 0.14 | 0.83 ± 0.08 |
| 10k x 20: read the selection back | 0.08 ± 0.01 | 0.08 ± 0.01 | 0.52 ± 0.08 | 0.17 ± 0.01 | 0.10 ± 0.01 |
| 100k x 20: one row | 0.84 ± 0.11 | 0.80 ± 0.10 | 1.33 ± 0.11 | 0.94 ± 0.11 | 0.98 ± 0.14 |
| 100k x 20: half the rows in display order | 1.09 ± 0.12 | 1.26 ± 0.18 | 7.67 ± 0.34 | 17.1 ± 1.62 | 1.07 ± 0.11 |
| 100k x 20: read the selection back | 0.55 ± 0.01 | 0.56 ± 0.02 | 4.25 ± 0.21 | 1.90 ± 0.16 | 1.06 ± 0.13 |

| Streaming: ticks offered at 10 Hz for 5 s with vsync (tick to correct frame p50 / p95 ms, first tick; time in call; dropped frames; ticks delivered of those offered) | herceg | herceg-react | tanstack-table | ag-grid | glide |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k x 20: append 1,000 rows | 9.23 / 18.6 (first 17.2); 0.55 in call; 0 dropped; 50/50 delivered | 8.92 / 18.7 (first 16.2); 0.54 in call; 0 dropped; 50/50 delivered | 28.3 / 35.9 (first 13.6); 27.7 in call; 1 dropped; 50/50 delivered | 12.7 / 17.0 (first 17.2); 8.99 in call; 0 dropped; 50/50 delivered | 6.98 / 15.1 (first 15.9); 2.73 in call; 0 dropped; 50/50 delivered |
| 10k x 20: append 1,000 rows, sorted | 11.5 / 17.8 (first 18.1); 2.55 in call; 0 dropped; 50/50 delivered | 11.1 / 19.3 (first 17.9); 2.69 in call; 0 dropped; 50/50 delivered | 37.1 / 61.6 (first 13.9); 36.5 in call; 31.5 dropped; 50/50 delivered | 30.1 / 37.1 (first 10.2); 28.7 in call; 3.5 dropped; 50/50 delivered | 7.73 / 14.8 (first 15.8); 5.69 in call; 0 dropped; 50/50 delivered |
| 10k x 20: append 1,000, evict 1,000 | 19.7 / 29.7 (first 28.8); 0.66 in call; 0.5 dropped; 50/50 delivered | 20.5 / 28.9 (first 26.5); 0.66 in call; 0.5 dropped; 50/50 delivered | 27.0 / 29.5 (first 15.4); 22.6 in call; 0.5 dropped; 50/50 delivered | 26.8 / 31.0 (first 18.6); 22.8 in call; 0 dropped; 50/50 delivered | 6.30 / 14.8 (first 15.7); 3.17 in call; 0 dropped; 50/50 delivered |
| 10k x 20: append 1,000, evict 1,000, sorted | 16.0 / 24.2 (first 19.2); 1.77 in call; 0 dropped; 50/50 delivered | 16.5 / 24.4 (first 19.8); 1.77 in call; 0 dropped; 50/50 delivered | 29.2 / 35.1 (first 16.8); 28.0 in call; 2 dropped; 50/50 delivered | 26.7 / 30.3 (first 10.1); 23.6 in call; 0.5 dropped; 50/50 delivered | 6.65 / 13.9 (first 15.6); 5.00 in call; 0 dropped; 50/50 delivered |
| 10k x 20: change 100 rows, display field | 10.6 / 20.8 (first 20.7); 0.15 in call; 0 dropped; 50/50 delivered | 11.5 / 20.0 (first 16.8); 0.14 in call; 0 dropped; 50/50 delivered | 17.4 / 19.8 (first 12.6); 14.7 in call; 0.5 dropped; 50/50 delivered | 10.6 / 18.7 (first 18.0); 4.30 in call; 0 dropped; 50/50 delivered | 6.19 / 17.0 (first 15.6); 0.36 in call; 0 dropped; 50/50 delivered |
| 10k x 20: change 100 rows, sort key | 18.2 / 26.8 (first 25.1); 0.76 in call; 1 dropped; 50/50 delivered | 19.0 / 28.3 (first 24.3); 0.76 in call; 0.5 dropped; 50/50 delivered | 30.0 / 33.9 (first 16.3); 28.4 in call; 1.5 dropped; 50/50 delivered | 25.1 / 26.9 (first 13.2); 21.6 in call; 0 dropped; 50/50 delivered | 7.37 / 15.0 (first 15.5); 5.86 in call; 0 dropped; 50/50 delivered |
| 10k x 20: change 100 rows, filtered field | 18.1 / 27.1 (first 28.8); 0.44 in call; 0 dropped; 50/50 delivered | 18.6 / 28.1 (first 28.0); 0.44 in call; 0 dropped; 50/50 delivered | 23.6 / 26.5 (first 16.6); 20.6 in call; 0 dropped; 50/50 delivered | 20.5 / 22.6 (first 12.8); 16.7 in call; 0 dropped; 50/50 delivered | 6.79 / 14.3 (first 15.8); 4.56 in call; 0 dropped; 50/50 delivered |
| 100k x 20: append 1,000 rows | 9.51 / 18.8 (first 18.4); 0.58 in call; 0 dropped; 50/50 delivered | 9.58 / 19.5 (first 16.5); 0.59 in call; 0 dropped; 50/50 delivered | 44.3 / 50.2 (first 36.1); 43.8 in call; 38 dropped; 50/50 delivered | 22.2 / 26.5 (first 11.6); 19.9 in call; 0 dropped; 50/50 delivered | 7.25 / 17.2 (first 15.6); 2.77 in call; 0 dropped; 50/50 delivered |
| 100k x 20: append 1,000 rows, sorted | 9.90 / 18.6 (first 14.8); 5.53 in call; 0 dropped; 50/50 delivered | 10.4 / 18.1 (first 14.4); 5.69 in call; 0 dropped; 50/50 delivered | 155 / 186 (first 145); 155 in call; 185.5 dropped; 24.5/50 delivered | 36.5 / 46.6 (first 30.4); 36.0 in call; 14 dropped; 50/50 delivered | 11.0 / 14.9 (first 16.1); 9.65 in call; 0 dropped; 50/50 delivered |
| 100k x 20: append 1,000, evict 1,000 | 21.5 / 30.0 (first 23.4); 0.72 in call; 0 dropped; 50/50 delivered | 19.8 / 28.4 (first 27.5); 0.72 in call; 0.5 dropped; 50/50 delivered | 38.3 / 40.1 (first 38.9); 37.1 in call; 19 dropped; 50/50 delivered | 29.8 / 33.5 (first 14.0); 27.4 in call; 0.5 dropped; 50/50 delivered | 6.98 / 14.8 (first 15.6); 3.14 in call; 0 dropped; 50/50 delivered |
| 100k x 20: append 1,000, evict 1,000, sorted | 9.99 / 19.5 (first 15.9); 5.02 in call; 0 dropped; 50/50 delivered | 10.1 / 19.7 (first 16.0); 5.01 in call; 0 dropped; 50/50 delivered | 132 / 138 (first 137); 131 in call; 154 dropped; 25/50 delivered | 31.8 / 36.0 (first 31.2); 31.3 in call; 2 dropped; 50/50 delivered | 16.4 / 17.9 (first 15.4); 15.5 in call; 0 dropped; 50/50 delivered |
| 100k x 20: change 100 rows, display field | 10.6 / 20.0 (first 20.4); 0.17 in call; 0 dropped; 50/50 delivered | 11.0 / 19.0 (first 21.0); 0.15 in call; 0 dropped; 50/50 delivered | 34.7 / 37.0 (first 36.6); 34.0 in call; 7 dropped; 50/50 delivered | 18.9 / 21.8 (first 13.5); 16.2 in call; 0 dropped; 50/50 delivered | 6.14 / 14.6 (first 15.8); 0.36 in call; 0 dropped; 50/50 delivered |
| 100k x 20: change 100 rows, sort key | 18.1 / 27.3 (first 18.2); 5.06 in call; 0.5 dropped; 50/50 delivered | 18.2 / 28.0 (first 18.6); 5.07 in call; 1 dropped; 50/50 delivered | 130 / 139 (first 135); 129 in call; 150.5 dropped; 25/50 delivered | 35.3 / 38.7 (first 37.7); 34.3 in call; 8.5 dropped; 50/50 delivered | 22.5 / 25.0 (first 15.6); 21.7 in call; 0 dropped; 50/50 delivered |
| 100k x 20: change 100 rows, filtered field | 18.5 / 28.9 (first 23.7); 1.40 in call; 0 dropped; 50/50 delivered | 18.0 / 26.6 (first 23.1); 1.40 in call; 1 dropped; 50/50 delivered | 41.9 / 47.3 (first 47.2); 41.1 in call; 31 dropped; 50/50 delivered | 30.8 / 35.6 (first 14.4); 29.4 in call; 3 dropped; 50/50 delivered | 15.7 / 17.8 (first 15.8); 14.7 in call; 0 dropped; 50/50 delivered |
| 1M x 20: append 1,000 rows, sorted | 31.1 / 34.8 (first 13.5); 30.6 in call; 0 dropped; 50/50 delivered | 28.8 / 33.7 (first 15.7); 27.8 in call; 0 dropped; 50/50 delivered | 2575 / 2575 (first 2569); 2573 in call; 304 dropped; 2/50 delivered; 190 ms to drain | 415 / 418 (first 414); 415 in call; 230 dropped; 10/50 delivered | 31.2 / 37.3 (first 15.8); 30.8 in call; 3 dropped; 50/50 delivered |
| 1M x 100: append 1,000 rows, sorted | 29.7 / 33.9 (first 42.2); 28.7 in call; 0 dropped; 50/50 delivered | 29.8 / 35.9 (first 42.3); 28.9 in call; 0 dropped; 50/50 delivered | error [11] | error [12] | 31.3 / 37.2 (first 42.7); 30.9 in call; 4 dropped; 50/50 delivered |

| Memory with the grid mounted (retained heap, and growth of the reserved heap while mounting; native input; DOM nodes; canvas) | herceg | herceg-react | tanstack-table | ag-grid | glide |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k x 20: mounted | 2.2 MB (reserved +4.3); input 0.0 MB; 461 nodes | 2.1 MB (reserved +4.3); input 0.0 MB; 462 nodes | 8.5 MB (reserved +18); input 6.2 MB; 500 nodes | 7.8 MB (reserved +16); input 6.2 MB; 744 nodes | 1.5 MB (reserved +3.1); input 0.0 MB; 12 nodes; canvas 3.0 MB |
| 100k x 20: mounted | 2.2 MB (reserved +4.5); input 0.0 MB; 461 nodes | 2.1 MB (reserved +4.5); input 0.0 MB; 462 nodes | 54 MB (reserved +136); input 62 MB; 500 nodes | 27 MB (reserved +59); input 62 MB; 744 nodes | 1.5 MB (reserved +3.1); input 0.0 MB; 12 nodes; canvas 3.0 MB |
| 1M x 20: mounted | 2.2 MB (reserved +4.3); input 0.0 MB; 461 nodes | 2.3 MB (reserved +4.5); input 0.0 MB; 462 nodes | 515 MB (reserved +784); input 621 MB; 500 nodes | 224 MB (reserved +307); input 621 MB; 744 nodes | 1.5 MB (reserved +3.4); input 0.0 MB; 17 nodes; canvas 3.0 MB |
| 1M x 100: mounted | 2.2 MB (reserved +4.8); input 0.1 MB; 461 nodes | 2.3 MB (reserved +4.8); input 0.1 MB; 462 nodes | error [13] | error [14] | 1.5 MB (reserved +3.1); input 0.0 MB; 17 nodes; canvas 3.0 MB |

| Heap kept 1 s after destroying the grid (after one mount / after five more); growth per further mount; kept after releasing the data too | herceg | herceg-react | tanstack-table | ag-grid | glide |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10k x 20: destroy and remount | 0.7 / 0.7 MB; 0.0 MB per mount; 0.9 MB after release | 0.7 / 1.0 MB; 0.0 MB per mount; 1.3 MB after release | 1.2 / 6.6 MB; 0.0 MB per mount; 13 MB after release | 2.3 / 2.6 MB; 0.1 MB per mount; 3.2 MB after release | 1.8 / 2.1 MB; 0.0 MB per mount; 3.9 MB after release |
| 100k x 20: destroy and remount | 0.7 / 0.7 MB; 0.0 MB per mount; 0.9 MB after release | 0.7 / 1.0 MB; 0.0 MB per mount; 1.3 MB after release | 1.2 / 51 MB; 0.0 MB per mount; 113 MB after release | 2.3 / 2.6 MB; 0.1 MB per mount; 3.2 MB after release | 2.2 / 2.1 MB; 0.0 MB per mount; 18 MB after release |
| 1M x 20: destroy and remount | 0.7 / 0.7 MB; 0.0 MB per mount; 0.9 MB after release | 0.7 / 1.0 MB; 0.0 MB per mount; 1.3 MB after release | 1.2 / 493 MB; 0.0 MB per mount; 1115 MB after release | 2.3 / 2.6 MB; 0.1 MB per mount; 3.2 MB after release | 5.8 / 2.1 MB; 0.0 MB per mount; 154 MB after release |
| 1M x 100: destroy and remount | 0.7 / 0.7 MB; 0.0 MB per mount; 0.9 MB after release | 0.7 / 1.0 MB; 0.0 MB per mount; 1.4 MB after release | error [13] | error [14] | 5.8 / 2.2 MB; 0.0 MB per mount; 762 MB after release |

1. tanstack-table, grid-1m-wide-mount: page.evaluate: Target crashed 
2. ag-grid, grid-1m-wide-mount: page.evaluate: Target crashed 
3. tanstack-table, grid-1m-wide-scroll-vertical: page.evaluate: Target crashed 
4. ag-grid, grid-1m-wide-scroll-vertical: page.evaluate: Target crashed 
5. tanstack-table, grid-1m-wide-scroll-end: page.evaluate: Target crashed 
6. ag-grid, grid-1m-wide-scroll-end: page.evaluate: Target crashed 
7. tanstack-table, grid-1m-wide-sort-number-desc: page.evaluate: Target crashed 
8. ag-grid, grid-1m-wide-sort-number-desc: page.evaluate: Target crashed 
9. tanstack-table, grid-1m-wide-filter-range-50: page.evaluate: Target crashed 
10. ag-grid, grid-1m-wide-filter-range-50: page.evaluate: Target crashed 
11. tanstack-table, grid-1m-wide-append-sorted: page.evaluate: Target crashed 
12. ag-grid, grid-1m-wide-append-sorted: page.evaluate: Target crashed 
13. tanstack-table, grid-1m-wide-memory: page.evaluate: Target crashed 
14. ag-grid, grid-1m-wide-memory: page.evaluate: Target crashed 
<!-- /results:grid -->

### Pivots

Of the grids compared, only AG Grid pivots, and only in its Enterprise
edition (the `PivotModule`; AG Grid Community, measured here, has none);
it can stop generating columns past `pivotMaxGeneratedColumns`, with no
limit by default. TanStack Table groups and aggregates rows but has no
pivot, and Glide Data Grid has no row model. Of the chart libraries, none
has a grid that pivots (Plotly's `table` trace shows given cells). So no
pivot is benchmarked against another library; Herceg's measurements are
its own, in Node:

| Pivot of 1M rows, 3 aggregates | Row keys × values | Combinations | Build | Kept |
| --- | ---: | ---: | ---: | ---: |
| Dense, 100 row keys | 100 × 10 | 1,000 | ~40 ms | ~4 MiB |
| Dense, 100 row keys | 100 × 100 | 10,000 | ~43 ms | ~6 MiB |
| Sparse, two values per row key | 100,000 × 100 | ~200,000 | ~0.16–0.28 s | ~73 MiB |

Grouping the same rows by the same two fields takes as long within the
variance; the index is at most ~5 ms of it. The source holds ~23 MiB. A
1,000-row append, with the view and groups following it, takes ~0.7–1.3 ms
into existing combinations of 100,000 rows, ~2–3 ms when it adds
combinations to a sparse index of 70,000–80,000 (built again), and up to
~6.6 ms in a rolling window whose groups vanish with every batch; a pivot
grid's frame of model work after one is ~0.1–0.4 ms over 100 rows and
~1.9 ms over 10,000 rows sorted by a generated column (one-off Node
measurements, Apple M6, other work on the machine). With 1,000 values of
three aggregates a pivot passes the default limit of 1,024 generated
columns, and is refused.

### Remote grids

Over data that lives elsewhere, AG Grid has two row models: the infinite
row model (Community: blocks of rows loaded by a datasource as they scroll
into view, `cacheBlockSize`, `maxBlocksInCache`, `blockLoadDebounceMillis`,
`maxConcurrentDatasourceRequests`, and an unknown row count until the last
block) and the server-side row model (Enterprise: grouping, aggregation,
pivoting, sorting, and filtering passed to the server in `getRows`
requests, child blocks loaded under each expanded group, transactions and
refreshes, and selection of all rows matching kept on the server's terms).
TanStack Table leaves remote data to the application: `manualPagination`,
`manualSorting`, and `manualFiltering` with a `pageCount` hand the state to
code that fetches pages, and infinite scrolling is built from TanStack
Virtual and a fetching library. Glide Data Grid draws whatever
`getCellContent` returns, including loading cells, and its examples page
data in on demand (an async data source hook kept by the application),
with no cache or query of its own. Herceg's remote grid
(`herceg/grid/remote`) sends a portable query (filter, sort, groups with
aggregates) and asks for blocks of typed columns from one snapshot, with
grouped results as windows of siblings under a key path; focus and
selection follow keys or conditions; conformance fixtures say what a
server must answer.

`npm run bench:grid-remote` (methodology: `benchmarks/README.md`, "Remote
grids") compares Herceg with AG Grid's infinite row model, set to the same
block size, requests, and cache, over a synthetic source of ten million
rows computed in the page (so the page's memory is the grid's), each answer
after 0, 20, or 100 ms:

| Median over 40 jumps or 3 traces | Herceg 0 ms | 20 ms | 100 ms | AG Grid 0 ms | 20 ms | 100 ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Jump to every row in view loaded, ms | 56 | 85 | 173 | 56 | 88 | 168 |
| The same with `settleDelay` 0, ms | 2.7 | 36.0 | 119.0 | 5.7 | 38.4 | 125.1 |
| Requests per jump | 2 | 2 | 2 | 1 | 1 | 1 |
| Requests per second, 100 rows/s | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 | 0.5 |
| Requests per second, 1,000 rows/s | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 | 7.5 |
| Frames with rows not loaded, 1,000 rows/s | 0% | 0% | 0% | 29% | 42% | 96% |
| The same with `settleDelay` 0 | 0% | 0% | 0% | 0% | 4% | 68% |

- 2026-10-26, commit d42d5d65; Apple M6, 12 cores, 32 GB, Darwin 27.0.0; Chrome 155.0.8059.86, headed, viewport 1280x720; herceg 0.0.0 (d42d5d65), ag-grid-community 36.2.0; raw results in `benchmarks/results/grid-remote.json`.
- Memory, after mounting and jumping to 50 places: Herceg retains 1.1 MiB of heap (46 KiB of it the blocks cached, 188 DOM nodes), AG Grid 3.2 MiB (300 DOM nodes); destroyed and mounted again, each round leaves a median of 38 KiB (Herceg) and 95 KiB (AG Grid), within the run-to-run swing of a few hundred KiB.

Herceg and AG Grid take the same time to show rows after a jump: the
latency and the 50 ms both wait for scrolling to settle (with `settleDelay` 0,
~2.7 ms against ~5.7 ms at 0 ms latency, and the latency plus about a frame
otherwise). They make the same requests a second while scrolling. Scrolling
fast, Herceg asks for the block ahead before it comes into view, so no
frame showed rows still loading at 1,000 rows a second even at 100 ms,
where AG Grid, which asks for the blocks of the rows it renders, showed
placeholders in 96% of frames (68% without its debounce, which delays every
block it loads); on a jump that block costs Herceg a second request, where
AG Grid makes one. Ten million rows cost either grid about what one screen
of them does: Herceg holds 46 KiB of rows in its cache and ~1.1 MiB of heap
in all, AG Grid ~3.2 MiB. Grouped queries, focus restoration, and selections
are not compared (AG Grid's server-side model, which has them, is
Enterprise).

### What the grid results show

- **Data held twice.** TanStack Table and AG Grid need one object per row: at
  100k x 20 converting the columns takes ~40 ms and ~62 MB, and at 1M x 20
  ~0.4–0.7 s and ~620 MB. With the grid mounted they keep ~54 MB (TanStack)
  and ~27 MB (AG Grid) more at 100k rows, ~0.5 GB and ~0.2 GB at 1M. At
  1M x 100 their tabs crash. Herceg (its table adopts the typed columns) and
  Glide (reading them through a callback) mount every size in ~2–3.5 ms from
  their native input and keep ~2 MB; from the shared columns Herceg takes
  ~4–8 ms at 1M rows, where building its table checks every category code.
- **Sorting and filtering.** Herceg sorts 100k rows by a number in ~16 ms to
  the correct frame and 1M in ~0.16–0.17 s, against ~80 ms and ~1.5 s
  for TanStack Table and AG Grid, whose comparators read row objects. Glide over
  a plain typed-array sort is as fast as Herceg; over a plain typed-array
  scan it filters 100k rows faster unless nearly every row passes (~1–2.5 ms
  against ~3.5–4 ms for Herceg's filter expressions). At 1M rows a range
  filter takes ~6–7.5 ms in both, as Herceg compares a number field with a
  constant by reading its array directly (and tests category membership by
  codes). TanStack and AG Grid filter 100k rows in ~7–12 ms.
- **Streaming.** Under a sort, Herceg merges appended rows into its view: a
  1,000-row append at 10 Hz shows in ~10 ms at 100k rows (mostly the wait
  for the next frame), with every tick delivered at every size. AG Grid's
  delta sort takes ~37 ms per tick at 100k and gets 10 of 50 ticks through at
  1M; TanStack Table re-sorts every row on each change, ~155 ms per tick at
  100k, and receives half the ticks (2 of 50 at 1M). At 1M rows a sorted
  append takes ~30 ms per tick for Herceg and Glide's adapter alike. When
  100 rows change their sort key at 100k, Herceg's view moves only those
  rows, as Glide's adapter does: ~5 ms in the call and ~18 ms to the correct
  frame, against ~22 ms for Glide's adapter, ~35 ms for AG Grid, and
  ~130 ms for TanStack Table; 100 changed filtered values take ~1.4 ms in
  the call (Glide's adapter ~15 ms), and both show them ~16–19 ms after the
  tick. A rolling window at 100k (1,000 rows in and out per tick) costs
  Herceg ~0.7 ms in the call, but its correct frame comes ~22 ms after the
  tick, a frame after Glide's adapter's (~7 ms); sorted, Herceg shows it in
  ~10 ms (~5 ms in the call) and Glide's adapter in ~16 ms.
- **Scrolling.** Every DOM grid shows a scroll step in its first frame:
  ~2.5–5.5 ms for Herceg, ~3–7 ms for TanStack Table and AG Grid (about
  the same for all three on horizontal steps, AG Grid slowest at 1M rows).
  Glide redraws its canvas in ~1 ms but in a React update after the frame
  the scroll happened in, so its content trails the scroll position by a
  frame: in three seconds of wheel scrolling about two frames in three
  showed content for an earlier offset, against none for the DOM grids.
  With the offset set every frame no grid dropped a frame; with wheel
  events AG Grid dropped 3 to 5 in three seconds and the others none.
- **Selection.** Selecting half of 100k sorted rows takes ~1 ms in Herceg
  and Glide (a row set, or one range), ~8 ms in TanStack Table (an object of
  ids), and ~17 ms in AG Grid.
- **React.** Herceg through `@herceg/react/grid` measures like the plain
  grid (data, sorting, and scrolling bypass React).
- **After destroying.** A second after being destroyed, Herceg and AG Grid
  have released their grids. TanStack Table keeps its last table, with its
  row objects, reachable until another is created (~50 MB at 100k), and
  Glide the last data it drew from.

## WebKit

The same suite in WebKit, the engine of Safari, through Playwright's WebKit
build (`npm run bench -- --browser webkit --headless`; not Safari itself, and
headless, since headed windows behind others get throttled frames). WebKit cannot
produce frames faster than the display, so every timing below is the latency
from the operation to the next frame, including the wait for it: operations
start wherever in a frame they are issued (pointer moves from the event), and
differences smaller than a frame (the idle cadence below) are noise. Compare
libraries within these tables, not with the Chrome tables above, which
disable the frame rate limit. Memory is not measured (it needs Chrome's
DevTools protocol), nor are long frames.

<!-- results:webkit -->
- Date: 2026-10-26, commit d42d5d65
- Machine: Apple M6, 12 cores, 32 GB, Darwin 27.0.0
- Browser: WebKit 26.6 through Playwright 1.63.0 (webkit revision 2359), GPU Apple GPU, headless, idle frames every 16.7 ms
- Viewport 1280x1400, device pixel ratio 2
- Libraries: herceg 0.0.0 (d42d5d65), echarts 6.1.0, chartjs 4.5.1, plotly 4.1.2, tanstack 1.0.0, uplot 1.6.32
- Renderers (normal / large config): herceg: auto (svg below 4,000 drawn points, canvas above; 3D charts on WebGL from 20,000 points or 10,000 surface cells) / auto; echarts: canvas / canvas (sampling: minmax, large: true); chartjs: canvas / canvas (parsing: false, min-max decimation); plotly: svg / webgl (scattergl); tanstack: svg / canvas (mountCanvasChart); uplot: canvas / canvas

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| line-small-init (4 series x 200 points) | 17.5 ± 0.17 | 14.4 ± 0.98 | 14.1 ± 0.19 | 16.9 ± 0.13 | 16.8 ± 0.08 | 16.9 ± 0.10 |
| line-medium-init (10 series x 5,000 points) | 16.8 ± 0.05 | 15.3 ± 0.32 | 15.3 ± 0.20 | 30.8 ± 0.12 | 32.3 ± 0.43 | 16.8 ± 0.02 |
| line-large-init (1 series x 1,000,000 points) | 16.7 ± 0.12 | 75.3 ± 2.84 | 16.6 ± 0.08 | 308 ± 16.3 | 601 ± 44.2 | 16.3 ± 0.38 |
| area-medium-init (3 filled series x 5,000 points) | 16.9 ± 0.12 | 16.7 ± 0.05 | 15.4 ± 0.20 | 17.4 ± 0.02 | 17.0 ± 0.25 | 16.7 ± 0.11 |
| bar-small-init (12 categories x 3 series) | 17.2 ± 0.21 | 15.3 ± 1.18 | 14.5 ± 0.55 | 16.7 ± 0.10 | 16.8 ± 0.08 | n/a |
| bar-medium-init (100 categories x 4 series) | 17.2 ± 0.18 | 16.7 ± 0.24 | 15.7 ± 0.13 | 16.9 ± 0.04 | 16.8 ± 0.14 | n/a |
| scatter-medium-init (10,000 points) | 16.8 ± 0.01 | 400 ± 0.97 (first frame 18.5) | 15.7 ± 0.10 | 67.2 ± 2.17 | 32.9 ± 0.59 | n/a |
| scatter-large-init (200,000 points) | 17.2 ± 0.32 | 115 ± 16.0 (first frame 24.8) | 53.2 ± 1.10 | 41.6 ± 1.76 | 206 ± 8.52 | n/a |
| heatmap-medium-init (100 x 100 cells) | 16.9 ± 0.05 | 394 ± 18.0 (first frame 16.9) | n/a | 16.7 ± 0.05 | 44.7 ± 2.55 | n/a |
| heatmap-large-init (500 x 500 cells) | 16.8 ± 0.22 | 11212 ± 76.4 (first frame 45.7) | n/a | 112 ± 1.82 | 343 ± 8.72 | n/a |
| candlestick-small-init (200 candles, each drawn by every library) | 17.4 ± 0.20 | 15.2 ± 0.21 | n/a | 17.3 ± 0.10 | n/a | n/a |
| candlestick-large-init (100,000 candles; each library's large-data strategy) | 17.1 ± 0.06 | 199 ± 36.3 (first frame 37.5) | n/a | 844 ± 16.4 | n/a | n/a |
| bubble-medium-init (10,000 points sized and colored by two fields) | 16.8 ± 0.05 | 406 ± 8.37 (first frame 18.1) | 49.0 ± 0.61 | 83.5 ± 1.90 | n/a | n/a |
| histogram-medium-init (10,000 values in bins 5 wide from 25, x from 25 to 175) | 16.8 ± 0.35 | n/a | n/a | 16.8 ± 0.02 | n/a | n/a |
| histogram-large-init (1,000,000 values in bins 5 wide from 25, x from 25 to 175) | 17.0 ± 0.40 | n/a | n/a | 64.9 ± 1.82 | n/a | n/a |
| line-massive-init (1 series x 10,000,000 points) | 16.9 ± 0.20 | 761 ± 18.2 | 75.3 ± 2.48 | 2735 ± 22.3 | 11326 ± 2718 | 61.4 ± 0.92 |
| scatter-massive-init (1,000,000 points) | 17.2 ± 0.08 | 367 ± 0.78 (first frame 77.4) | 327 ± 3.92 | 161 ± 5.00 | 1077 ± 43.1 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| line-medium-update (replace 10 x 5,000 points) | 16.7 ± 0.25 | 16.6 ± 0.04 | 16.7 ± 0.02 | 29.7 ± 0.64 | 31.7 ± 3.25 | 16.6 ± 0.07 |
| line-large-update (replace 1,000,000 points) | 16.5 ± 0.12 | 92.5 ± 5.64 | 16.4 ± 3.80 | 337 ± 4.92 | 590 ± 20.2 | 16.6 ± 0.04 |
| bar-medium-update (replace 100 x 4 bars) | 16.7 ± 0.27 | 16.7 ± 0.06 | 16.6 ± 0.10 | 16.6 ± 0.10 | 16.7 ± 0.09 | n/a |
| scatter-medium-update (replace 10,000 points) | 16.7 ± 0.17 | 400 ± 0.67 (first frame 20.1) | 16.7 ± 0.28 | 60.5 ± 0.27 | 50.3 ± 3.71 | n/a |
| heatmap-medium-update (replace 100 x 100 cells) | 16.8 ± 1.00 | 400 ± 0.15 (first frame 18.6) | n/a | 16.6 ± 0.07 | 54.6 ± 3.11 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stream-dashboard-chart (15 series, 3,000-point window, +1 point per tick) | 16.7 ± 0.35 | 16.7 ± 0.06 | 16.6 ± 0.10 | 29.5 ± 2.24 | 27.1 ± 2.67 | 16.7 ± 0.10 |
| stream-large (1 series, 100,000-point window, +100 points per tick) | 16.6 ± 0.28 | 16.7 ± 0.03 | 16.7 ± 0.16 | 35.5 ± 0.68 | 51.2 ± 2.02 | 16.6 ± 0.12 |
| stream-massive (1 series, 1,000,000-point window, +10,000 points per tick) | 16.7 ± 0.48 | 112 ± 2.95 | 16.6 ± 0.09 | 339 ± 4.93 | 644 ± 27.7 | 16.7 ± 0.04 |

| Scenario (frame interval p50 / p95 / p99, dropped frames, achieved ingest rate) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ingest-chart-10hz (15 series, 3,000-point window, +1 point at 10 Hz) | 16.7 / 17.4 / 18.1 ms, 0 dropped, 9 Hz | 16.7 / 39.0 / 44.2 ms, 55.5 dropped, 9 Hz | 16.7 / 28.4 / 33.7 ms, 25 dropped, 9 Hz | 16.7 / 40.7 / 46.2 ms, 62 dropped, 9 Hz | 16.7 / 39.6 / 44.8 ms, 60 dropped, 9 Hz | 16.7 / 23.5 / 28.7 ms, 10 dropped, 9 Hz |
| ingest-chart-60hz (15 series, 3,000-point window, +1 point at 60 Hz) | 16.7 / 17.3 / 17.7 ms, 0 dropped, 50 Hz | 16.7 / 20.3 / 21.1 ms, 1 dropped, 50 Hz | 16.7 / 20.3 / 21.1 ms, 1 dropped, 50 Hz | 25.4 / 28.9 / 29.9 ms, 141 dropped, 39 Hz | 24.3 / 27.3 / 31.3 ms, 58 dropped, 40 Hz | 16.7 / 20.0 / 20.6 ms, 0 dropped, 50 Hz |
| ingest-chart-100hz (15 series, 3,000-point window, +1 point at 100 Hz) | 16.7 / 17.5 / 17.7 ms, 0 dropped, 72 Hz | 16.3 / 22.1 / 22.5 ms, 0.5 dropped, 83 Hz | 16.7 / 20.8 / 21.4 ms, 0.5 dropped, 83 Hz | 25.6 / 29.7 / 30.5 ms, 148 dropped, 38 Hz | 24.2 / 27.4 / 29.0 ms, 62.5 dropped, 40 Hz | 16.7 / 20.2 / 21.1 ms, 0.5 dropped, 83 Hz |
| ingest-large-100hz (1 series, 100,000-point window, +10 points at 100 Hz) | 16.7 / 17.7 / 17.8 ms, 0 dropped, 78 Hz | 12.1 / 36.5 / 37.3 ms, 41.5 dropped, 82 Hz | 16.7 / 20.1 / 21.3 ms, 0 dropped, 83 Hz | 33.6 / 37.7 / 39.6 ms, 149 dropped, 29 Hz | 93.8 / 99.4 / 102 ms, 256 dropped, 21 Hz | 16.7 / 20.7 / 21.2 ms, 0 dropped, 83 Hz |
| ingest-dashboard-10hz (10 charts x 15 series x 3,000 points, +1 point per series at 10 Hz) | 16.7 / 37.0 / 39.6 ms, 50 dropped, 9 Hz | 16.6 / 66.2 / 70.2 ms, 132 dropped, 9 Hz | 16.7 / 44.0 / 48.5 ms, 71 dropped, 9 Hz | 233 / 243 / 246 ms, 275 dropped, 4 Hz | 259 / 393 / 465 ms, 279 dropped, 4 Hz | 16.7 / 42.6 / 47.7 ms, 66 dropped, 9 Hz |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hover-line-medium (pointer moves over 10 x 5,000 points) | 4.04 ± 0.45 | 13.9 ± 0.93 | 6.76 ± 0.27 | 14.8 ± 0.42 | 16.8 ± 1.95 | 3.67 ± 0.20 |
| hover-line-large (pointer moves over 1,000,000 points) | 2.83 ± 0.35 | 9.15 ± 0.41 | 3.03 ± 0.32 | 454 ± 190 | 84.6 ± 2.81 | 3.39 ± 0.29 |
| hover-scatter-medium (pointer moves over 10,000 points) | 3.58 ± 0.23 | 25.9 ± 1.39 | 9.36 ± 0.21 | 8.89 ± 0.66 | 15.1 ± 0.60 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom-line-large (x ranges of 50%, 10%, and 1% of 1,000,000 points, panning) | 16.5 ± 0.95 | 16.7 ± 0.07 | 16.7 ± 0.07 | 16.7 ± 0.10 | 53.7 ± 45.8 | 16.6 ± 0.17 |
| zoom-line-massive (x ranges of 50%, 10%, and 1% of 10,000,000 points, panning) | 16.3 ± 0.46 | 16.6 ± 0.24 | 16.7 ± 3.12 | 17.4 ± 1.62 | 660 ± 605 | 13.3 ± 6.64 |
| zoom-scatter-massive (x ranges of 50%, 10%, and 1% of 1,000,000 points, panning) | 16.9 ± 0.46 | 84.1 ± 65.0 | 131 ± 12.4 | 16.6 ± 0.08 | 178 ± 72.5 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| resize-line-medium (resize 800x400 <-> 600x300) | 16.7 ± 0.50 | 17.0 ± 0.50 | 16.6 ± 0.35 | 17.7 ± 1.29 | 31.3 ± 2.83 | 16.7 ± 0.12 |

| Mount all charts (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dashboard (10 charts x 15 series x 3,000 points) | 32.7 ± 1.26 | 56.4 ± 3.96 | 37.3 ± 2.98 | 237 ± 5.42 | 245 ± 7.64 | 27.3 ± 0.28 |

| Refresh all charts (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dashboard (10 charts x 15 series x 3,000 points) | 22.9 ± 0.96 | 59.9 ± 4.82 | 36.6 ± 0.50 | 262 ± 11.7 | 284 ± 24.5 | 20.3 ± 0.40 |
<!-- /results:webkit -->

## Firefox

The same suite in Firefox, through Playwright's Firefox build
(`npm run bench -- --browser firefox`, headed; not the released Firefox
itself). Latency scenarios run with `layout.frame_rate` 0, so frames are not
held to the display, and paced ingestion runs in a second Firefox at the
default frame rate. Firefox has neither `performance.memory` nor Chrome's heap
measurement, so memory scenarios are omitted (the JSON's `method.memory` says
why), and it reports no long animation frames, so ingestion results omit
`longFrames`. Compare libraries within these tables rather than with Chrome's.

<!-- results:firefox -->
- Date: 2026-10-26, commit d42d5d65
- Machine: Apple M6, 12 cores, 32 GB, Darwin 27.0.0
- Browser: Firefox 155.0 through Playwright 1.63.0 (firefox revision 1543), GPU Apple M1, or similar, headed, idle frames every 0.00 ms
- Viewport 1280x1400, device pixel ratio 2
- Libraries: herceg 0.0.0 (d42d5d65), echarts 6.1.0, chartjs 4.5.1, plotly 4.1.2, tanstack 1.0.0, uplot 1.6.32
- Renderers (normal / large config): herceg: auto (svg below 4,000 drawn points, canvas above; 3D charts on WebGL from 20,000 points or 10,000 surface cells) / auto; echarts: canvas / canvas (sampling: minmax, large: true); chartjs: canvas / canvas (parsing: false, min-max decimation); plotly: svg / webgl (scattergl); tanstack: svg / canvas (mountCanvasChart); uplot: canvas / canvas

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| line-small-init (4 series x 200 points) | 1.54 ± 0.20 | 3.83 ± 0.53 | 3.06 ± 0.49 | 6.32 ± 0.65 | 2.48 ± 0.24 | 1.34 ± 0.12 |
| line-medium-init (10 series x 5,000 points) | 4.19 ± 0.14 | 16.8 ± 1.45 | 11.3 ± 0.73 | 35.5 ± 5.98 | 49.5 ± 3.34 | 4.06 ± 0.30 |
| line-large-init (1 series x 1,000,000 points) | 9.78 ± 0.58 | 122 ± 1.46 | 19.1 ± 2.66 | 370 ± 5.06 | 1194 ± 46.0 | 7.76 ± 0.12 |
| area-medium-init (3 filled series x 5,000 points) | 1.92 ± 0.14 | 10.8 ± 1.40 | 6.61 ± 0.58 | 20.9 ± 1.12 | 27.6 ± 2.54 | 1.83 ± 0.17 |
| bar-small-init (12 categories x 3 series) | 1.37 ± 0.17 | 3.04 ± 0.54 | 1.81 ± 0.30 | 5.61 ± 0.43 | 1.60 ± 0.11 | n/a |
| bar-medium-init (100 categories x 4 series) | 2.28 ± 0.37 | 6.10 ± 1.11 | 3.29 ± 0.29 | 13.8 ± 0.49 | 5.73 ± 0.49 | n/a |
| scatter-medium-init (10,000 points) | 2.35 ± 0.18 | 80.1 ± 0.94 (first frame 7.91) | 15.9 ± 0.64 | 122 ± 0.43 | 41.8 ± 2.66 | n/a |
| scatter-large-init (200,000 points) | 9.16 ± 0.20 | 142 ± 5.16 (first frame 31.7) | 185 ± 2.10 | 73.4 ± 11.1 | 293 ± 24.2 | n/a |
| heatmap-medium-init (100 x 100 cells) | 1.89 ± 0.17 | 36.0 ± 1.07 (first frame 8.03) | n/a | 6.44 ± 0.27 | 54.3 ± 1.26 | n/a |
| heatmap-large-init (500 x 500 cells) | 16.8 ± 0.64 | 14457 ± 329 (first frame 48.1) | n/a | 39.2 ± 0.90 | 610 ± 7.46 | n/a |
| candlestick-small-init (200 candles, each drawn by every library) | 1.77 ± 0.09 | 6.27 ± 0.94 | n/a | 8.95 ± 0.25 | n/a | n/a |
| candlestick-large-init (100,000 candles; each library's large-data strategy) | 10.8 ± 0.76 | 72.6 ± 17.2 (first frame 56.8) | n/a | 1128 ± 9.36 | n/a | n/a |
| bubble-medium-init (10,000 points sized and colored by two fields) | 44.4 ± 3.58 | 95.4 ± 1.58 (first frame 8.33) | 53.6 ± 0.46 | 148 ± 0.97 | n/a | n/a |
| histogram-medium-init (10,000 values in bins 5 wide from 25, x from 25 to 175) | 1.31 ± 0.14 | n/a | n/a | 8.28 ± 0.62 | n/a | n/a |
| histogram-large-init (1,000,000 values in bins 5 wide from 25, x from 25 to 175) | 10.4 ± 0.48 | n/a | n/a | 78.2 ± 4.50 | n/a | n/a |
| line-massive-init (1 series x 10,000,000 points) | 40.2 ± 0.28 | 1391 ± 5.90 | 184 ± 59.0 | 3459 ± 6.58 | error | 41.1 ± 0.22 |
| scatter-massive-init (1,000,000 points) | 23.2 ± 0.74 | 695 ± 6.10 (first frame 125) | 1008 ± 35.9 | 203 ± 4.02 | 1673 ± 27.0 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| line-medium-update (replace 10 x 5,000 points) | 4.04 ± 0.55 | 15.1 ± 2.76 | 6.13 ± 0.33 | 29.1 ± 1.24 | 48.5 ± 2.32 | 3.42 ± 0.16 |
| line-large-update (replace 1,000,000 points) | 8.10 ± 0.36 | 153 ± 1.14 | 13.7 ± 1.16 | 342 ± 0.08 | 1001 ± 2.26 | 7.08 ± 0.00 |
| bar-medium-update (replace 100 x 4 bars) | 1.56 ± 0.33 | 4.43 ± 0.35 | 2.20 ± 0.25 | 12.1 ± 0.43 | 6.31 ± 0.47 | n/a |
| scatter-medium-update (replace 10,000 points) | 1.90 ± 0.20 | 77.0 ± 2.33 (first frame 8.28) | 15.6 ± 0.46 | 119 ± 0.42 | 56.1 ± 1.23 | n/a |
| heatmap-medium-update (replace 100 x 100 cells) | 1.18 ± 0.17 | 35.1 ± 1.78 (first frame 8.60) | n/a | 6.44 ± 0.41 | 71.8 ± 1.98 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stream-dashboard-chart (15 series, 3,000-point window, +1 point per tick) | 4.89 ± 0.63 | 8.11 ± 0.28 | 4.35 ± 0.33 | 29.1 ± 1.16 | 43.0 ± 1.34 | 4.23 ± 0.31 |
| stream-large (1 series, 100,000-point window, +100 points per tick) | 2.00 ± 0.44 | 14.0 ± 0.75 | 2.15 ± 0.20 | 36.3 ± 0.80 | 76.5 ± 1.26 | 1.22 ± 0.08 |
| stream-massive (1 series, 1,000,000-point window, +10,000 points per tick) | 2.52 ± 0.45 | 139 ± 2.98 | 4.71 ± 0.11 | 341 ± 2.19 | 992 ± 23.7 | 5.42 ± 0.06 |

| Scenario (frame interval p50 / p95 / p99, dropped frames, achieved ingest rate) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| ingest-chart-10hz (15 series, 3,000-point window, +1 point at 10 Hz) | 16.7 / 17.2 / 17.6 ms, 0 dropped, 9 Hz | 16.7 / 33.3 / 33.6 ms, 38 dropped, 9 Hz | 16.7 / 17.6 / 33.3 ms, 10 dropped, 9 Hz | 16.7 / 33.3 / 33.3 ms, 37 dropped, 9 Hz | 16.7 / 33.3 / 50.0 ms, 58 dropped, 9 Hz | 16.7 / 17.2 / 17.6 ms, 0.5 dropped, 9 Hz |
| ingest-chart-60hz (15 series, 3,000-point window, +1 point at 60 Hz) | 16.7 / 17.1 / 17.6 ms, 0 dropped, 52 Hz | 16.7 / 17.0 / 17.6 ms, 0 dropped, 56 Hz | 16.7 / 17.0 / 17.5 ms, 0 dropped, 54 Hz | 83.3 / 84.1 / 100 ms, 235.5 dropped, 37 Hz | 83.3 / 84.0 / 100 ms, 236 dropped, 25 Hz | 16.7 / 17.1 / 17.6 ms, 0 dropped, 53 Hz |
| ingest-chart-100hz (15 series, 3,000-point window, +1 point at 100 Hz) | 16.7 / 17.0 / 17.4 ms, 0 dropped, 83 Hz | 16.7 / 17.3 / 17.5 ms, 0 dropped, 93 Hz | 16.7 / 17.4 / 17.6 ms, 0 dropped, 88 Hz | 83.3 / 83.5 / 100 ms, 236 dropped, 37 Hz | 83.3 / 83.4 / 100 ms, 236.5 dropped, 25 Hz | 16.7 / 17.3 / 17.6 ms, 0 dropped, 87 Hz |
| ingest-large-100hz (1 series, 100,000-point window, +10 points at 100 Hz) | 16.7 / 17.2 / 17.6 ms, 0 dropped, 81 Hz | 66.7 / 83.3 / 84.1 ms, 226.5 dropped, 71 Hz | 16.7 / 17.3 / 17.6 ms, 0 dropped, 89 Hz | 66.7 / 83.3 / 84.1 ms, 230.5 dropped, 27 Hz | 83.3 / 83.3 / 100.0 ms, 237.5 dropped, 13 Hz | 16.7 / 17.4 / 17.6 ms, 0 dropped, 87 Hz |
| ingest-dashboard-10hz (10 charts x 15 series x 3,000 points, +1 point per series at 10 Hz) | 16.7 / 16.8 / 17.6 ms, 2.5 dropped, 9 Hz | 16.7 / 83.3 / 109 ms, 178 dropped, 9 Hz | 16.7 / 33.3 / 50.0 ms, 57 dropped, 9 Hz | 250 / 267 / 267 ms, 280.5 dropped, 4 Hz | 425 / 450 / 460 ms, 303 dropped, 2 Hz | 16.7 / 33.3 / 33.3 ms, 20 dropped, 9 Hz |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| hover-line-medium (pointer moves over 10 x 5,000 points) | 2.88 ± 0.18 | 14.2 ± 0.42 | 5.91 ± 0.25 | 21.1 ± 0.66 | 17.1 ± 1.28 | 2.12 ± 0.15 |
| hover-line-large (pointer moves over 1,000,000 points) | 1.97 ± 0.15 | 5.61 ± 0.39 | 2.17 ± 0.17 | 572 ± 237 | 127 ± 1.55 | 1.26 ± 0.08 |
| hover-scatter-medium (pointer moves over 10,000 points) | 1.94 ± 0.13 | 16.1 ± 0.91 | 13.9 ± 0.29 | 28.2 ± 0.40 | 25.0 ± 1.45 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| zoom-line-large (x ranges of 50%, 10%, and 1% of 1,000,000 points, panning) | 2.40 ± 0.34 | 2.92 ± 0.67 | 3.12 ± 0.85 | 1.36 ± 0.20 | 114 ± 31.0 | 3.09 ± 0.74 |
| zoom-line-massive (x ranges of 50%, 10%, and 1% of 10,000,000 points, panning) | 1.92 ± 0.30 | 42.3 ± 29.0 | 5.16 ± 3.52 | 1.84 ± 0.52 | error | 4.50 ± 3.72 |
| zoom-scatter-massive (x ranges of 50%, 10%, and 1% of 1,000,000 points, panning) | 9.52 ± 0.64 | 95.2 ± 89.3 | 249 ± 46.6 | 10.4 ± 0.30 | 856 ± 258 | n/a |

| Scenario (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| resize-line-medium (resize 800x400 <-> 600x300) | 4.03 ± 0.90 | 5.38 ± 0.34 | 6.51 ± 1.05 | 17.4 ± 2.01 | 46.7 ± 1.69 | 3.37 ± 0.41 |

| Mount all charts (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dashboard (10 charts x 15 series x 3,000 points) | 37.3 ± 1.46 | 75.7 ± 2.58 | 55.7 ± 6.94 | 269 ± 2.00 | 439 ± 1.88 | 32.8 ± 0.68 |

| Refresh all charts (ms, median ± MAD) | herceg | echarts | chartjs | plotly | tanstack | uplot |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| dashboard (10 charts x 15 series x 3,000 points) | 17.1 ± 0.20 | 90.5 ± 1.38 | 35.9 ± 1.58 | 262 ± 5.74 | 448 ± 8.10 | 22.5 ± 0.40 |
<!-- /results:firefox -->

In Firefox, Herceg mounts most charts fastest: 1M-point scatters in ~23 ms
(Plotly ~200 ms), 500 x 500 heatmaps in ~17 ms (Plotly ~39 ms), 100,000
candles in ~11 ms (ECharts ~73 ms), and 10M-point lines in ~40 ms (uPlot
~41 ms). uPlot mounts 1M-point lines faster (~8 ms against ~10 ms), and
Herceg's bubbles take ~44 ms, against ~3 ms in Chrome (Chart.js ~54 ms).
On the 15-series, 3,000-point chart a streamed tick takes ~4.9 ms (uPlot
~4.2 ms, Chart.js ~4.4 ms, ECharts ~8 ms) and replacing 10 x 5,000 points
~4.0 ms (uPlot ~3.4 ms). Paced ingestion into it drops no frames at 60 and
100 Hz, with ~52 and ~83 appends a second getting through (uPlot ~53 and
~87, Chart.js ~54 and ~88, ECharts ~56 and ~93), and the ten-chart
dashboard at 10 Hz drops 2 to 3 frames in five seconds at ~9.4 updates a
second (uPlot ~20, Chart.js ~57, ECharts ~178). Refreshing all ten charts'
data at once is fastest in Herceg (~17 ms; uPlot ~23 ms), and one-series
windows stream well (~2.0 ms a tick at 100,000 points, uPlot ~1.2 ms;
~2.5 ms at a million, the fastest). Hover over a 1M-point line takes
~2.0 ms (uPlot ~1.3 ms, Chart.js ~2.2 ms), and over 10 x 5,000 points
~2.9 ms (uPlot ~2.1 ms). Scatter hover (~1.9 ms) and zooming 1M scatter
points (~9.5 ms) are fastest.

uPlot leads on line hover and drops at most a frame in every paced
scenario but the dashboard (20 dropped), with ~53 and ~87 appends a second
getting through into the 15-series chart at 60 and 100 Hz. Chart.js
streams that chart in ~4.4 ms and drops no frames at 60 and 100 Hz (~54 and
~88 appends a second), but takes ~0.18 s for 200,000 scatter points and
~1 s for a million. ECharts streams that chart in ~8 ms and shows
progressive first frames early, but completes a 500 x 500 heatmap after
~15 s and drops 226 frames ingesting 10 points at 100 Hz into a
100,000-point window. Plotly zooms lines fastest (~1.4–1.8 ms; Herceg
~1.9–2.4 ms), but takes over half a second per hover over 1M points and
gets ~37 updates a second through at 60 and 100 Hz. TanStack Charts is the
slowest in most scenarios and fails on 10M-point lines, as in Chrome.

## React integration

Herceg through `@herceg/react` next to plain herceg, from `npm run bench:react`.
Mounting and resizing go through React props; data replacement and streaming
change the table and bypass React. Each chart is its own React root, so
per-root setup is counted for every chart. The React wrappers of the other
libraries are not measured.

<!-- results:react -->
Measured 2026-10-26 at commit d42d5d65 with react 19.3.0, react-dom 19.3.0, same environment as above.

| Scenario (median) | herceg | herceg via @herceg/react |
| --- | ---: | ---: |
| line-small-init (4 series x 200 points) | 0.71 ± 0.11 ms | 0.74 ± 0.15 ms |
| line-medium-init (10 series x 5,000 points) | 2.28 ± 0.21 ms | 2.13 ± 0.13 ms |
| line-large-init (1 series x 1,000,000 points) | 5.25 ± 0.18 ms | 5.51 ± 0.54 ms |
| area-medium-init (3 filled series x 5,000 points) | 1.28 ± 0.25 ms | 1.50 ± 0.23 ms |
| line-massive-init (1 series x 10,000,000 points) | 36.0 ± 3.68 ms | 34.2 ± 2.39 ms |
| line-medium-update (replace 10 x 5,000 points) | 1.19 ± 0.13 ms | 1.18 ± 0.09 ms |
| line-large-update (replace 1,000,000 points) | 4.06 ± 0.08 ms | 3.82 ± 0.13 ms |
| stream-dashboard-chart (15 series, 3,000-point window, +1 point per tick) | 1.27 ± 0.12 ms | 1.23 ± 0.12 ms |
| stream-large (1 series, 100,000-point window, +100 points per tick) | 0.68 ± 0.09 ms | 0.65 ± 0.09 ms |
| stream-massive (1 series, 1,000,000-point window, +10,000 points per tick) | 1.49 ± 0.12 ms | 1.44 ± 0.11 ms |
| ingest-chart-10hz (15 series, 3,000-point window, +1 point at 10 Hz) | 0 dropped, 10 Hz | 0 dropped, 10 Hz |
| ingest-chart-60hz (15 series, 3,000-point window, +1 point at 60 Hz) | 0 dropped, 62 Hz | 0 dropped, 62 Hz |
| ingest-chart-100hz (15 series, 3,000-point window, +1 point at 100 Hz) | 0 dropped, 100 Hz | 0 dropped, 100 Hz |
| ingest-large-100hz (1 series, 100,000-point window, +10 points at 100 Hz) | 0 dropped, 100 Hz | 0 dropped, 100 Hz |
| ingest-dashboard-10hz (10 charts x 15 series x 3,000 points, +1 point per series at 10 Hz) | 1 dropped, 10 Hz | 0.5 dropped, 10 Hz |
| hover-line-medium (pointer moves over 10 x 5,000 points) | 0.53 ± 0.19 ms | 0.63 ± 0.38 ms |
| hover-line-large (pointer moves over 1,000,000 points) | 0.33 ± 0.07 ms | 0.35 ± 0.06 ms |
| zoom-line-large (x ranges of 50%, 10%, and 1% of 1,000,000 points, panning) | 0.78 ± 0.32 ms | 0.77 ± 0.27 ms |
| zoom-line-massive (x ranges of 50%, 10%, and 1% of 10,000,000 points, panning) | 1.48 ± 0.57 ms | 1.53 ± 0.65 ms |
| resize-line-medium (resize 800x400 <-> 600x300) | 1.22 ± 0.09 ms | 1.35 ± 0.18 ms |
| dashboard (10 charts x 15 series x 3,000 points) | mount 18.0 ms, refresh 10.5 ms | mount 19.9 ms, refresh 11.3 ms |
| memory-line-large (1 chart, 1,000,000 points) | 0.2 MB heap, 35 nodes | 0.4 MB heap, 36 nodes |
| memory-dashboard (10 charts x 15 series x 3,000 points) | 5.9 MB heap, 762 nodes | 6.3 MB heap, 772 nodes |
| memory-small-100 (100 charts x 2 series x 100 points) | 9.2 MB heap, 3679 nodes | 13 MB heap, 3779 nodes |
<!-- /results:react -->

## Statistical charts

`herceg.express` against Seaborn 0.13, function by function. Statistics were
checked against Seaborn, SciPy, and statsmodels (python/tests); charts are
herceg charts, so they are interactive, export to SVG, PNG, and PDF, and
work in notebooks and Streamlit, where Seaborn draws Matplotlib figures.

| Seaborn | herceg.express | Lacks |
| --- | --- | --- |
| `barplot`, `pointplot` | Mean, median, sum, min, max, or any function per category and series, with `("ci", level)` bootstrap intervals (Seaborn's resamples for a seed, and with `units` its structured bootstrap of repeated measures), `"pi"`, `"se"`, `"sd"`, or an interval function; weighted means (`weight`); series dodged; facets (`facet_row`, `facet_column`) with estimates per panel; `pointplot` joins its estimates with lines over the category axis (broken where a series has none), with `linestyles` or `linestyle="none"`. | Pandas aggregation names beyond the five, `"se"` about other estimators than the mean; `pointplot`'s `markers` and Seaborn's small dodge (herceg dodges as grouped bars do). |
| `lineplot` | Estimate per distinct x with bands or error bars, weighted means, or rows as they are (`estimator=None`), with `units` a line per unit; time x. | `style`, `size`. |
| `regplot`, `lmplot` | Polynomial least squares (`order`, weighted by `weight`), `logistic` and `robust` fits (statsmodels' GLM and RLM in NumPy, without statsmodels), `logx`, lowess (statsmodels' algorithm in NumPy), bootstrap bands (by rows, or `units`); `x_estimator` and `x_bins` estimates with `x_ci`; `x_partial`, `y_partial`, `fit_reg`, `truncate`; series and facets. | `x_jitter`, `y_jitter` (refused: they would move points off their values); `truncate=False` reaches the data's range, not the axes' limits. |
| `residplot` | Residuals of a polynomial or `robust` fit, with an optional lowess line; partials. | — |
| `histplot` | Seaborn's bins (`bins`, `binwidth`, `binrange`, `discrete`), `normalize` as the histogram mark's (count, frequency, probability, percent, or density), `weight` (Seaborn's `weights`, with its warning for "auto" bins), `cumulative`, `common_norm` (off by default, as in the mark), layered, stacked, filled (`multiple="fill"`), or dodged series, bars, steps, or polygons (`element`), x or y, KDE overlays on layered bars (along y over horizontal ones); bivariate histograms of x and y (Seaborn's bins per axis, counts checked against NumPy's `histogram2d`) as the 2D histogram mark. | KDE over stacked, filled, or dodged series, unfilled steps (`fill=False`); bivariate `thresh`, `pthresh`, `pmax`, `cbar`, and series. |
| `kdeplot` | 1D lines or `filled` areas, along x or (for `y` alone) along y, read by y in tooltips and the keyboard, with Scott's, Silverman's, or a given factor, `bw_adjust`, `cut`, `clip`, `common_norm` (off by default), `cumulative`, `weight`; 2D as contour lines or `filled` bands at Seaborn's `levels` and `thresh` (iso-proportions of the density's mass, resolved in NumPy and checked against Seaborn's), facets with levels shared by every panel. | `multiple`, bivariate series, per-facet levels, contour labels. |
| `ecdfplot` | `normalize` probability (Seaborn's proportion), percent, or count, complementary, `weight`, along x or y; a series of one distinct value shows as a point. | Seaborn's riser from 0 (or 1) before the first value: every point drawn is an observation's step, as tooltips and the keyboard read them. Along y, a lone value's point is read as points are, x (its share) first. |
| `rugplot` | Ticks of a length in pixels at the plot's edge, with tooltips and keyboard reading. | Height as a share of the axes. |
| `stripplot` | Jitter as the point mark's (a fraction of the band, or an `hg.Jitter`), by a hash of each row and a seed (points keep their places as data streams), dodge. | — |
| `swarmplot` | The point mark's `swarm`: each category's points packed without overlap in order of value, laid out again in the browser as the chart resizes and zooms (bounded: about 2 ms for 10,000 points in a band, 21 ms for 100,000), dodged by `series`; Seaborn's warning when more than `warn_thresh` of a category's points cannot be placed, from the same layout run in Python at the chart's size. | Exact Seaborn placement (its candidates stand 5% farther out); the warning estimates the plot's size, which a chart filling its container may not have. |
| `boxplot` | herceg's box plot mark, its outliers shown or hidden (`outliers`); `whiskers` ("tukey", "range", or an IQR multiple), notches. | Percentile whiskers. |
| `boxenplot` | herceg's boxen mark (TypeScript and every adapter too): Seaborn's letter values and depth rules (`depth` "tukey", "proportion", "trustworthy", "full", or a number), `outlier_proportion`, `trust_alpha`, `width_method` ("exponential", "linear", "area"), `outliers`; series side by side, facets. | Seaborn's lightened palette per level (herceg lightens by fill opacity); `gap`, `linecolor`. |
| `violinplot` | herceg's violin mark, series side by side or `split` into halves (a series of at most two levels), `inner` box, quartiles, or none. | Seaborn's Scott bandwidth and area normalization (violins are as wide at their densest, with Silverman's rule), `inner="stick"` and `"point"`. |
| `pairplot` | Scatter plots of every pair with histograms or densities on the diagonal, `corner`. | Shared y axes per row through the diagonal; other `kind`s. |
| `jointplot` | Scatter (or `kind="reg"`) with marginal histograms sharing its scales; `kind="kde"` (density contours, `filled`, with marginal densities) and `kind="hist"` (a 2D histogram with marginal histograms). | `kind="hex"`; series with the kde and hist kinds, marginal densities with series. |
| `clustermap` | Average (or single, complete, weighted, ward) linkage of rows and columns, z-scores or min-max scaling, dendrograms in side panels. | Row and column color annotations, masks. |
| `countplot`, `catplot`, `displot`, `relplot` | — | Not in express (`hg.bar`, `hg.histogram`, and facets cover some). |

Seaborn draws a figure of what it computed; to show new data, the plot is
drawn again. An express chart remembers its call: `hx.recompute(chart,
data)` makes it again from new data with the same arguments and seed,
reusing the bootstrap results of groups whose values did not change (a
lineplot of 1,000 timepoints given one more resamples one group), and a
notebook widget of one recomputes on `append` and `replace`, sending only
the tables that changed when its marks are the same and keeping the
displays' zoom, brush, and legend. Plotly Express charts are figures of
data too; their trendlines and marginals are computed again by calling
the function again.

Timings from `npm run bench:express` (raw samples, versions, and inputs in
`benchmarks/results/express.json`): Apple M6, Python 3.13, NumPy 2.5, SciPy
1.18, Seaborn 0.13.2, statsmodels 0.15; medians of 3 to 10 runs after a
warmup, with the peak Python memory of one more run, on an otherwise idle
machine. "Compute" times the numerical routine alone, "chart" the express
function and `to_spec()`, "recompute" `hx.recompute` of a chart and
`to_spec()`, and "SVG" static export of a chart already built.

| Workload | herceg.express | Reference |
| --- | --- | --- |
| Bootstrap, 1,000 means of 100,000 values (compute) | ~200 ms, 3.1 MiB | Seaborn's `bootstrap`: ~280 ms, 2.3 MiB |
| Bootstrap, 1,000 medians of 100,000 values (compute) | ~765 ms, 4.6 MiB | Seaborn's `bootstrap`: ~865 ms, 2.3 MiB |
| Bootstrap, 1,000 means of 1,000 values in 20 units (compute) | ~11 ms | Seaborn's structured `bootstrap`: ~31 ms |
| `barplot`, 100,000 rows, 4 groups, 95% CI (chart) | ~245 ms | — |
| `lineplot`, 1,000 x values of 10 rows, 95% CI (chart; recompute after one more x value) | ~54 ms; ~4 ms | — |
| Logistic fit and 95% band, 1,000 rows, 1,000 resamples (compute) | ~160 ms | Seaborn with statsmodels' GLM: ~640 ms |
| Robust fit and 95% band, 1,000 rows, 1,000 resamples (compute) | ~310 ms | Seaborn with statsmodels' RLM: ~1.2 s |
| `pairplot`, 10,000 rows x 5 columns, series (chart; SVG) | ~30 ms; SVG ~52 ms more | — |
| `clustermap`, 500 x 50 (chart, SciPy's linkage) | ~3.4 ms | — |
| Average linkage, 500 x 50, the NumPy fallback (compute) | ~67 ms, 10 MiB | SciPy's `linkage`: well under ~3.4 ms (inside the chart time above) |
| Lowess, 10,000 rows, `delta=0` (compute; Seaborn's default) | ~0.8 s | statsmodels: ~1.2 s |
| Lowess, 10,000 rows, `delta` 1% of the x range (compute) | ~10 ms | statsmodels: ~13 ms |

Resampling a chunk of resamples at a time makes the bootstraps faster than
Seaborn's one-resample loop; chunks take about 8 MiB of arrays (or one
resample, when that is larger), as fast as the 64 MiB chunks they replaced,
so the peak memory of 1,000 resamples of 100,000 values fell from 41 MiB to
3.1 MiB (medians from 62 MiB to 4.6 MiB), near Seaborn's 2.3 MiB, and the
NumPy linkage's from 66 MiB to 10 MiB. Logistic and robust fits iterate
every resample of a chunk together, where Seaborn fits one statsmodels model
per resample. Lowess, in NumPy, computes each chunk of local fits with BLAS
dot products and is faster than statsmodels' compiled loop (it was 2.5 times
slower). A recompute reuses
the intervals of groups whose values did not change (one new x value
resamples one group of 1,001). Seaborn's own pair plots draw 20 Matplotlib
scatter plots of 10,000 points on the CPU, while herceg sends the columns
once and draws them in the browser, so the two totals are not compared.

## Common tasks

The same twelve tasks written with each library, as an experienced user of
it would write them from its documentation, over identical data
([benchmarks/src/ease](../benchmarks/src/ease), one directory per task and a
file per library, with React and Python versions where they are natural).
`benchmarks/src/ease/samples.test.tsx` mounts every TypeScript sample in Chrome
and checks what it draws (series, axes, annotations, the tooltip under the
pointer, the synced chart, the rolling window, the exported files), and
`python/tests/test_ease_samples.py` runs the Python ones, so the samples keep
working as the libraries change. The same test checks the mistakes the tables
report that happen at runtime (compile errors are checked by type-checking
the samples).

Versions: ECharts 6.1.0, TanStack Charts 1.0.0 (with d3-scale 4.0.2 for time
scales), Chart.js 4.5.1 (with chartjs-adapter-date-fns 3.0.0), Plotly.js 4.1.2
(`plotly.js-dist-min`), React 19.3.0, and Herceg at this commit. Not installed,
so not used: chartjs-plugin-annotation and chartjs-plugin-zoom, the community
React wrappers (echarts-for-react, react-chartjs-2, react-plotly.js),
pyecharts, and jsPDF. The Chart.js samples of tasks 4 and 5 therefore draw
annotations and zoom with code of their own, which an experienced user would
leave to those plugins: their line counts and concepts do not represent
Chart.js with its plugins. Plotly Python and Kaleido are not in the test environment either: the
Plotly Express samples follow Plotly's documentation and are skipped by
pytest, and the message quoted for task 11 is Plotly Express's, not run here.

How to read the tables:

- **Lines** are lines that are not blank, not comments, and not the import of
  the shared data, after formatting (biome, ruff); `node
  --experimental-strip-types benchmarks/src/ease/lines.ts` counts them.
  Imports count. The samples import whole bundles (`echarts`,
  `chart.js/auto`, `plotly.js-dist-min`); their tree-shaken setups add about
  ten lines of registration (`echarts.use([...])`, `Chart.register(...)`).
  Herceg's and TanStack's imports are tree-shaken already.
- **Concepts** are what a newcomer has to learn for the task, beyond the
  previous tasks.
- **Mistake** is one plausible error and what the library does with it, as
  observed in these samples: a type error, a runtime message, or a silently
  wrong chart.
- Every chart shows a tooltip at the nearest x, which is Herceg's default;
  the others need `tooltip: { trigger: "axis" }` (ECharts), `interaction: {
  mode: "index", intersect: false }` (Chart.js), `hovermode: "x"` with
  several series (Plotly), and `focus: "group-x"` with the `tooltip`
  extension (TanStack). TanStack Charts draws no title (the page's heading
  and the required `ariaLabel` name a chart).

Line counts favor libraries whose idioms are short to write, not those that
are easiest to get right; the concepts and mistakes columns matter more.

### 1. A basic line chart

Daily latency over 60 days with a title, a time x axis, and a y axis title.
[01-line](../benchmarks/src/ease/01-line)

| Library | Lines | Concepts | Mistake: a misspelled field (`"latncy"`) |
| --- | --- | --- | --- |
| Herceg | 9; React 10 | `table` of columns, `time()`, a mark function (`line`), `createChart` options (`title`, `y: { title }`) | Compile error; in JavaScript, `line y: no field "latncy"; the table has "time", "p50"`. |
| ECharts | 13 | `init` and `setOption`, the option object, `dataset` and `encode`, axis `type: "time"`, the tooltip component | `encode: { y: "latncy" }`: no error or warning; the series falls back to the dataset's first value column, so a typo for another column draws the wrong one. |
| TanStack Charts | 19; React 18 | `defineChart`, marks (`lineY`), scale factories (d3's `scaleUtc`, with `Date` values), `mountChart` and its required `ariaLabel`, focus strategies, the `tooltip` extension | Compile error (fields are inferred from the rows); in JavaScript, no error and no line. |
| Chart.js | 15 | a `<canvas>`, `type` with `data.labels` and `datasets`, the time scale and its date adapter, `interaction` | The sample's arrays have no field names. With object rows and `parsing: { yAxisKey: "latncy" }`, as in task 2's sample, nothing is parsed or drawn, without a warning. |
| Plotly | 12 | traces (`type`, `mode`), layout, axis `type: "date"`, `newPlot` (a promise) | It takes arrays, so the mistake is a property read that TypeScript catches. Leaving out `xaxis.type: "date"` shows epoch milliseconds as "1.77T" without a warning. |

Herceg and TanStack Charts check field names against the data's type;
ECharts and Chart.js take field names as plain strings, which a typo leaves
silently wrong. Epoch milliseconds
need saying in every library: `time()` in Herceg (a number column is a
number axis, whatever the field is named; `time()` also takes Dates and
ISO 8601 strings), `type: "time"` in ECharts and Chart.js, `type: "date"` in
Plotly, and `Date` objects in TanStack.

### 2. A multi-series chart

Three services' latency from a long table (a row per service and day), one
line per service with a legend. [02-multi-series](../benchmarks/src/ease/02-multi-series)

| Library | Lines | Concepts | Mistake: the series field holds numbers (HTTP status codes) |
| --- | --- | --- | --- |
| Herceg | 9; React 10 | `series` field | Compile error; in JavaScript, `line series: field "status" holds number values; expected category; give its values as strings, or numbers wrapped in category()`. |
| ECharts | 20 | the `legend` component; a series per group, grouped by hand (or with `dataset` filter transforms) | Works: groups are built in application code. |
| TanStack Charts | 20 | the `color` channel groups lines; `colorLegend` | Works: two lines and a legend. |
| Chart.js | 22 | a dataset per group, grouped by hand; `parsing` keys | Works. |
| Plotly | 20 | a trace per group, grouped by hand; `hovermode` | Works. |

Splitting long data is one option in Herceg and TanStack Charts; the others
make the application group the rows. Herceg is the strict one about kinds:
categories come from strings, so numeric codes need `category(codes)`.
Herceg's samples take columns; from the rows, `fromRows(serviceRows, {
types: { time: "time" } })` reads them, the epoch milliseconds as times (a
concept more).

### 3. A custom tooltip

The tooltip shows the date as "Wed, Jan 21", the value with "ms", and the
day's request count, a field that is not plotted. [03-tooltip](../benchmarks/src/ease/03-tooltip)

| Library | Lines | Concepts | Mistake |
| --- | --- | --- | --- |
| Herceg | 12; React 16 | a mark's `tooltip: { fields }` for the request count, axes' `tooltipFormat` (Intl options) for the date and the unit, the chart's `locale` and `timeZone` | A misspelled field: compile error; in JavaScript, `line tooltip.fields[0]: no field "reqeusts"; the table has "time", "p99", "requests"`. |
| ECharts | 27 | `tooltip.formatter`, its params (an array with `trigger: "axis"`), `EChartsOption` typing and casts of `params.data` | Formatters return HTML: text from data containing `<` is parsed as markup. |
| TanStack Charts | 29; React 40 | `tooltip: { use, format }` with typed rows; in React, `renderTooltipBody` from `@tanstack/charts/react/tooltip` | Passing `renderTooltipBody` to the `Chart` of `@tanstack/charts/react`: compile error (that component lacks the prop). |
| Chart.js | 33 | `plugins.tooltip.callbacks` (`title`, `label`), tooltip items (`parsed`, `dataIndex`) | Without `intersect: false`, the tooltip shows only with the pointer on a point. |
| Plotly | 17 | `hovertemplate` syntax (`%{x\|%a, %b %-d}`, d3-format), `customdata`, `<extra></extra>` | Leaving out `<extra></extra>`: a second box with the trace's name appears beside the tooltip. |

Herceg and Plotly describe the content as data, which their Python
packages and specs share: Herceg names more fields of the row
(`tooltip=hg.Tooltip(fields=["requests"])` in Python, where Plotly Express
takes `hover_data`) and formats values per axis, Plotly writes a template.
Herceg's tooltip keeps a row per series, so its layout is the built-in one
("Wed, Jan 21", then "p99 304 ms" and "requests 12,480") rather than the
sentence the other samples write; the keyboard's announcements read the
same fields. For content of its own, `renderTooltip` (JavaScript only;
React content in `@herceg/react`) draws in the built-in box, keeping its
placement and crosshair, as the other formatters do. ECharts' formatters
return HTML, TanStack's typed rows, and Chart.js's callbacks lines of text.

### 4. An annotation

A threshold rule labeled "SLO" and a labeled band over an incident window.
[04-annotation](../benchmarks/src/ease/04-annotation)

| Library | Lines | Concepts | Mistake: the band's dates as ISO strings (`"2026-01-21"`) |
| --- | --- | --- | --- |
| Herceg | 13; React 12 | `rule` and `region` marks with constant positions; mark order (regions first to shade underneath) | Compile error; in JavaScript, `region x1: "2026-01-21" names a field, and fields need a table; pass the table first, or give a number or Date`. |
| ECharts | 23 | `markLine` and `markArea` on a series, their data formats (`[{ yAxis }]`, `[[start, end]]`) | Works: ECharts parses date strings on time axes. |
| TanStack Charts | 44 | `ruleY`, `rect` with explicit y extents (rects span values, not the plot), `text` marks for labels | `TypeError: A temporal scale factory requires Date channel values`. |
| Chart.js | 40, without its plugin | a plugin of your own with canvas drawing and `scale.getPixelForValue` (chartjs-plugin-annotation, not installed, takes options instead) | `getPixelForValue` takes parsed numbers: the band is not drawn, without a warning. |
| Plotly | 37 | `layout.shapes`, `xref`/`yref` (`"paper"` spans the plot), shape `label`s | Works: Plotly takes date strings. |

Annotations are marks in Herceg, sharing the chart's scales, and count
toward the axis domains; TanStack composes them from general marks, ECharts
attaches them to a series, Plotly lays them out in paper or data coordinates,
and Chart.js has an annotation plugin. With it (documented, not run here),
the plugin of the sample becomes options, about half the lines:

```ts
import annotationPlugin from "chartjs-plugin-annotation";
Chart.register(annotationPlugin);
// options.plugins:
annotation: {
  annotations: {
    incident: { type: "box", xMin: incident.start, xMax: incident.end, label: { display: true, content: "Incident" } },
    slo: { type: "line", yMin: SLO, yMax: SLO, label: { display: true, content: "SLO" } },
  },
},
```

### 5. Two synchronized charts

Latency and request charts whose cursors and zoomed x ranges follow each
other. [05-sync](../benchmarks/src/ease/05-sync)

| Library | Lines | Concepts | Mistake: zoom turned on in only one chart |
| --- | --- | --- | --- |
| Herceg | 17; React 16 | `interaction: { zoom: "x", sync: "name" }` | The other chart still follows the zoom; it just does not zoom by its own wheel. |
| ECharts | 19 | `echarts.connect`, `dataZoom` (`type: "inside"`) | The chart without `dataZoom` does not follow, without a warning. |
| TanStack Charts | 46, partly | `createChartCursor` and `cursorHost` (`match: "x"`), `zoomX` with a `controlledSignal`, an application-owned window that rebuilds both definitions, visible rows and `clip` | Not applicable: the application applies the window to both charts. |
| Chart.js | 42, without its plugin | `onHover`, `setActiveElements` on the other chart and its tooltip, scale `min`/`max`, wheel handling by hand (chartjs-plugin-zoom is not installed) | Not applicable: all of it is application code. |
| Plotly | 40 | `plotly_relayout` and `plotly_hover` events, `Plotly.relayout` with only the x axis' keys, `Plotly.Fx.hover` (missing from @types/plotly.js), a guard against echoes | Not applicable: as for Chart.js. |

One option in Herceg, one call in ECharts, and event plumbing elsewhere
(chartjs-plugin-zoom would replace the Chart.js sample's wheel code, not its
cursor code). The TanStack sample does half the task: in TanStack Charts
1.0.0, `zoomX`'s surface takes the pointer, so over a zoomable plot the
tooltip and the shared cursor do not follow it (the samples' test checks only
the shared zoom there). Plotly charts that can share one figure are simpler
as subplots with matching x axes.

### 6. Streaming with a rolling window

A reading every 100 ms, keeping the newest 300.
[06-streaming](../benchmarks/src/ease/06-streaming)

| Library | Lines | Concepts | Mistake: changing the data without telling the chart |
| --- | --- | --- | --- |
| Herceg | 11; React 16 | a table's `maxRows`, `appendRow` (tables redraw their charts once a frame) | Tables are changed through their methods, which redraw. Writing into a typed array the table borrowed shows nothing until something else redraws. |
| ECharts | 20 | trimming by hand, `setOption` with the new data | Pushing to the array without `setOption`: the chart stays as it was. |
| TanStack Charts | 24; React 29 | trimming by hand, a new definition per change (`host.update`, or state and `useMemo` in React) | Mutating the rows without a new definition: the chart stays as it was. |
| Chart.js | 25 | trimming by hand, `chart.update()`, `animation: false` | Without `update()`: the chart stays as it was. |
| Plotly | 14 | `extendTraces` with its `maxPoints` argument | Mutating the trace's arrays: the plot stays as it was until a redraw. |

Herceg's tables and Plotly's `extendTraces` own the window; elsewhere the
application trims and resubmits data. In React, Herceg's chart never
re-renders for data, while TanStack's re-renders through React state on each
reading.

### 7. A line of 100,000 points

[07-large](../benchmarks/src/ease/07-large)

| Library | Lines | Concepts | Mistake: leaving out the large-data settings |
| --- | --- | --- | --- |
| Herceg | 8 | none new: typed arrays are used as they are, and level of detail is automatic | Nothing to leave out. |
| ECharts | 15 | `sampling: "lttb"`, `showSymbol: false` | Without them, every point is drawn, symbols too where they fit, which is slower to render and hover. |
| TanStack Charts | 20 | `mountCanvasChart`, a row object per point | The SVG host draws it too, as one path; the documented route for dense signals is an envelope the application computes. |
| Chart.js | 22 | `parsing: false` with points as `{ x, y }`, `normalized`, the `decimation` plugin, `animation: false`, `pointRadius: 0` | With defaults, every point is parsed, animated, and drawn as a dot; decimation silently does nothing while `parsing` is on, as its documentation says. |
| Plotly | 9 | `scattergl` | Plain `scatter` draws it too, since Plotly simplifies SVG line paths; `scattergl` is the documented choice for large data. |

[Initial render](#initial-render) and [Interaction](#interaction) measure
these libraries' large lines with the same settings (ECharts there samples
with `minmax`).

### 8. A custom mark

A lollipop per day: a stem from zero and a dot at the value.
[08-custom-mark](../benchmarks/src/ease/08-custom-mark)

| Library | Lines | Concepts | Mistake: forgetting that the stems start at zero |
| --- | --- | --- | --- |
| Herceg | 24 | `custom` with fields and `draw` (the scales, shape functions, `series` and `rowAt`), the mark's `zero: "y"` | Leaving out `zero: "y"`: the y axis fits the values only; stems are cut at the plot's bottom, without a warning. |
| ECharts | 31 | a `custom` series, `renderItem` with `api.coord`, `api.value`, and `api.visual`, graphic elements | Value axes include zero by default. |
| TanStack Charts | 72 | `createMark`: channels (which set the domains), `render` returning keyed scene nodes and the `ChartPoint`s the pointer, keyboard, and tooltip find, the theme's palette | Without `includeZero`, stems run out of the plot, over the axis and the page below. |
| Chart.js | 35 | dots as a scatter dataset, a plugin drawing stems from the dataset's elements, `interaction` | Without `beginAtZero`, stems run over the x axis. |
| Plotly | 22 | no custom marks: a `layout.shapes` line per row beside a marker trace, `rangemode: "tozero"`, `hovermode` | Shapes count toward autorange, so they stay in view. |

Herceg's custom mark gets tooltips, keyboard reading, the legend, and the
text alternative from its fields; ECharts' custom series takes part in the
axis tooltip through `encode`; TanStack's answers the pointer only through
the points its `render` returns, which is most of its sample's length;
Chart.js and Plotly draw beside a built-in dataset or trace, which carries
the tooltips.

### 9. A theme

The multi-series chart, dark, with a brand palette, on a light page.
[09-theme](../benchmarks/src/ease/09-theme)

| Library | Lines | Concepts | Mistake: a misspelled theme name (`"drak"`) |
| --- | --- | --- | --- |
| Herceg | 10; React 11 | `theme: { extends, tokens: { palette } }`; named themes paint their own background, `"auto"` the page's | Compile error; in JavaScript, the chart shows `theme: no theme "drak"; use "light", "dark", "high-contrast", "high-contrast-dark", "auto"` in its place and logs it (or reports it to `onError`); in Python, the spec's check refuses it when the chart is displayed or exported. |
| ECharts | 21 | a built-in theme named at `init`, `color` in the option | Draws in the default theme, without a warning. |
| TanStack Charts | 27 | `theme` tokens in the definition (or CSS variables and `color`) | No named themes. |
| Chart.js | 35 | no themes: colors per dataset, scale, and title, and a CSS background for the canvas | No named themes. |
| Plotly | 25 | `paper_bgcolor`, `plot_bgcolor`, `font`, `gridcolor`, `colorway` | `template: "plotly_dark"` (Plotly Python's) is ignored in plotly.js, without a warning; plotly.js bundles no named templates. |

Herceg's and ECharts' dark themes paint their own surfaces, so they read the
same on a light page; Herceg's `"auto"` (or `background: "transparent"`)
shows the page instead, for charts on tinted cards. Chart.js, Plotly.js,
and TanStack Charts take the colors from the application.

### 10. Export

SVG, PNG, and PDF of the basic line chart, in the browser (Python below).
[10-export](../benchmarks/src/ease/10-export)

| Library | Lines | SVG / PNG / PDF | Mistake: exporting right after creating the chart |
| --- | --- | --- | --- |
| Herceg | 16 | `chart.toSVG()` / `chart.toPNG({ dpi })` (a promise of a `Blob`) / `renderToPDF(chart)` from `herceg/pdf` | No animation by default; exports render the chart's state at once. |
| ECharts | 24 | a second, SVG-renderer instance (`ssr: true`, `renderToSVGString`) / `getDataURL` / none | With animation on (the default), the PNG caught the line half drawn (a data URL of 17.7k characters instead of 29.4k). |
| TanStack Charts | 20 | `serializeChartSvg` / `renderChartImage` / none | No animation by default. |
| Chart.js | 16 | none / `toBase64Image` / none | With animation on (the default), the PNG was nearly empty (7.1k characters instead of 55.1k). |
| Plotly | 17 | `Plotly.toImage` as a data URL, decoded / `Plotly.toImage` / none in the browser | Both calls are promises; forgetting `await` gives a promise, not an image. |

Herceg is the only one with a PDF in the browser. Its three exports show the
mounted chart as it is (zoomed, with series hidden); `renderToSVG` and
`renderToPDF(options)` draw options without a DOM. Chart.js exports at its
canvas' resolution (`devicePixelRatio`); the others were asked for twice the
chart's size. In Python, a live widget has no PNG of what it shows: a cell
cannot wait for the browser's reply, so `chart.save` draws the chart as
Python built it. Python saves all three by file
extension (`chart.save("latency.png", dpi=192)`, 5 lines), as Plotly Python does
through Kaleido (`fig.write_image`, 5 lines).

### 11. A Python notebook chart

Task 2's chart from a pandas DataFrame in a notebook cell.
[11-notebook](../benchmarks/src/ease/11-notebook)

| Library | Lines | Concepts | Mistake: a misspelled column |
| --- | --- | --- | --- |
| Herceg | 10 | `hg.line(df, x=, y=, series=, title=, y_axis=hg.AxisOptions(title=))`; the chart displays itself | `KeyError: "line y: no column 'latncy'; the data has 'time', 'service', 'latency'"` when the chart is built. |
| Plotly Express | 10 | `px.line(df, x=, y=, color=, title=, labels=)`; the figure displays itself | `ValueError: Value of 'y' is not the name of a column in 'data_frame'. Expected one of ['time', 'service', 'latency'] but received: latncy`. |

The two are alike: one call over a DataFrame, named columns, and an error
that lists the columns. Plotly Express names series `color` and relabels
axes through `labels`; Herceg names them `series`, as its TypeScript does,
and takes axes as `x_axis`/`y_axis` in one-call helpers, since `x` and `y`
name columns. ECharts (through the community pyecharts), TanStack Charts,
and Chart.js have no Python packages.

### 12. Bars and a line over categories

Monthly revenue bars with a target line over the same months.
[12-bar-line](../benchmarks/src/ease/12-bar-line)

| Library | Lines | Concepts | Mistake: the line's values in another month order than the bars' |
| --- | --- | --- | --- |
| Herceg | 9 | `bar` and `line` over one category axis | Categories match by value. |
| ECharts | 17 | a category axis, series of two types | With `xAxis.data` and value arrays, values pair by position: misaligned without a warning. |
| TanStack Charts | 21 | `barY` and `lineY` over one band scale | Categories match by value. |
| Chart.js | 20 | a mixed chart (a dataset's own `type`) | `labels` and data pair by position: misaligned without a warning. |
| Plotly | 11 | a bar trace and a scatter trace on one category axis | Categories match by value. |

### What the tasks show

- Herceg's samples are the shortest, or tied, in 11 of the 12 tasks: several
  series from long data, tooltip content, annotations, synced charts,
  streaming, 100,000 points, themes, export, and bars with a line over
  their categories each take one option, mark, or call, and field names are checked at compile time in TypeScript and
  React, with runtime messages that name the field and the fix.
- Its custom marks need a stated baseline (`zero`), as other libraries'
  axes do, and its tooltip lays fields out in rows rather than in a
  template of the application's own.
- TanStack Charts is typed as strictly, but leaves zoom windows, visible
  rows, rolling windows, and annotation extents to the application, and in
  1.0.0 its zoom control and pointer tooltips exclude each other.
- ECharts covers every task with options, but misspelled fields and theme
  names fail silently, and `setOption` checks nothing unless the option is
  annotated as `EChartsOption`.
- Chart.js leaves annotations and zoom to plugins (not measured here), and
  needs the most settings for large data; animated charts export their first
  frame.
- Plotly is the most concise for tooltips and, through Plotly Express, in
  Python, and needs event plumbing for synced charts and `type: "date"` for
  epoch milliseconds.

## Findings so far

- uPlot sets the bar for time-series speed and memory: it renders typed arrays
  in place, so retained memory for 1M points is a fraction of a megabyte, and
  it keeps up with every paced ingestion scenario. Herceg nearly matches its
  memory for large series (~0.24 MB vs ~0.18 MB at 1M points) and matches
  its pacing under streaming, mounts and replaces large line charts faster
  (1M points: ~4.9 ms vs ~6.4 ms to mount, ~3.5 ms vs ~5.7 ms to replace),
  and streams a million-point window faster (~1.5 ms vs ~5.8 ms a tick).
  uPlot is ahead on small charts (~0.5 ms vs ~0.7 ms for 4 x 200 points), on
  streaming the 15-series chart (~0.9 ms vs ~1.2 ms a tick), on hover
  (~0.5 ms vs ~0.6 ms over 10 x 5,000 points, ~0.2 ms vs ~0.4 ms over 1M),
  on mounting the ten-chart dashboard (~17 ms vs ~19 ms; refreshing it,
  ~11 ms each, is even), and on dashboard memory (~2.8 MB vs ~5.9 MB for
  ten charts; uPlot's paths are browser `Path2D` objects, outside the
  measured heap).
- Scatter from typed columns: at 10,000 points the libraries that render in
  one pass (Herceg ~2.5 ms on Canvas, Chart.js ~4.5 ms) are far ahead of
  ECharts and Plotly (~65–80 ms). Large point series are where GPU rendering
  pays: Herceg's WebGL path mounts 200,000 points in ~4.3 ms and 1M in
  ~17 ms (uploading the data each time; the GPU finishes a few milliseconds
  after the measured frame), against ~180 ms for Plotly's WebGL `scattergl`,
  ~310 ms for ECharts, ~430 ms for Chart.js, and ~1.2 s for TanStack Charts
  at 1M. Zooming 1M points takes ~4 ms in Herceg and ~7 ms in Plotly, whose
  data both stay on the GPU, against ~37 ms for ECharts and ~170–200 ms for
  TanStack Charts and Chart.js.
- Heatmaps drawn as one image scale with cell count at a few bytes per cell:
  500 x 500 cells take ~13 ms in Herceg and ~30 ms in Plotly, against ~460 ms
  for TanStack Charts (one scene node per cell) and ~5 s for ECharts to
  complete its progressive render.
- Of the comparison libraries, only Plotly draws contours and 2D histograms
  (ECharts, TanStack Charts, and Chart.js have neither). Plotly's contours
  are further along in presentation: labels along lines, smoothing, and
  contours of 2D histograms. Herceg's trace saddles by the bilinear field
  rather than a fixed rule, fill disjoint bands with holes, read matrices
  without a coordinate per grid point, and keep what they traced, so a
  recolor or zoom only projects it; the two have not been timed against
  each other, and Herceg's exports hold every traced point.
- Linked selections reach summaries only in Herceg among these libraries: a
  brush over one chart draws its rows' part of every histogram bar, box
  plot, violin, heatmap cell, pie slice, and Sankey link bound to the same
  store, in exports too. ECharts styles items in and out of a brush and
  links series whose indices correspond, and Plotly styles selected points,
  bars, and histogram bins of the trace selected, leaving linking and
  summaries of a selection to the application. Not timed against them: a
  million-row brush followed by a histogram and a box plot takes ~10 ms a
  step in Node.
- Massive data separates the libraries that keep data in typed arrays.
  Mounting a 10M-point line takes ~38 ms in Herceg and ~47 ms in uPlot,
  ~100 ms in Chart.js, and 2.1–2.7 s in ECharts and Plotly; TanStack Charts
  runs out of memory (its tab crashes). Zooming into 10M points takes
  ~0.9 ms in Plotly, whose WebGL traces keep data on the GPU and do not
  rescale y, ~1.5 ms in Herceg, whose min/max index answers each pixel
  column without rescanning, ~5–7 ms in Chart.js and uPlot, and ~48 ms in
  ECharts.
- Bars at these sizes (up to 400 bars) take 0.6–7.9 ms in every library;
  differences are not noticeable to users.
- In WebKit, where every timing includes waiting for the display's next
  frame, the picture holds: Herceg shows every scenario in about one frame
  (16–18 ms; the ten-chart dashboard in ~33 ms to mount and ~23 ms to
  refresh, uPlot ~27 and ~20 ms), including 10M-point lines and 1M-point
  scatters, where ECharts, Plotly, and TanStack Charts take hundreds of
  milliseconds to seconds. Hover is within a few milliseconds for Herceg,
  uPlot, and Chart.js. Ingesting into ten charts at 10 Hz drops frames in
  every library (50 for Herceg, ~66–71 for uPlot and Chart.js, ~132 for
  ECharts, over 270 for Plotly and TanStack Charts). Into one chart at
  100 Hz Herceg drops no frames, but its timer gets ~72–78 appends a second
  through, against ~82–83 for uPlot, Chart.js, and ECharts.
- In Firefox, Herceg mounts most charts fastest and refreshes the ten-chart
  dashboard fastest (~17 ms; uPlot ~23 ms). Its 15-series chart takes
  ~4.9 ms per streamed tick (uPlot ~4.2 ms, Chart.js ~4.4 ms), and paced
  ingestion into it drops no frames. Its widest gaps there are zooming a
  1M-point line (~2.4 ms; Plotly ~1.4 ms), streaming a 100,000-point
  window (~2.0 ms; uPlot ~1.2 ms), and hover over a 1M-point line
  (~2.0 ms; uPlot ~1.3 ms); see [Firefox](#firefox).
- Going through `@herceg/react` costs little because React only describes
  the chart: mounting adds up to ~0.3 ms per chart where the difference
  exceeds the noise, and streaming, data
  replacement, and hover never render React. The other measurable cost is
  memory for React roots: 100 small charts, each its own root, retain ~13 MB
  instead of ~9 MB.
- Small charts rendered as SVG avoid canvas backing stores entirely: Herceg's
  100 small charts use ~9 MB of heap and no canvas memory, while the Canvas
  libraries need ~72 MB of canvas pixels for the same charts.
- Libraries that need one object per point (TanStack Charts rows, Chart.js
  `{x, y}`, ECharts pairs) retain 3–40x the source data size at 1M points.
- For many small charts, Canvas backing stores dominate: 100 300x150 charts at
  DPR 2 need ~72 MB of canvas pixels, more than the JavaScript heap of any
  library. The SVG libraries have no backing stores but create thousands of DOM
  nodes.
- Rebuilding on every update limits streaming: TanStack Charts (new
  definition per update) and Plotly (`extendTraces`) cannot sustain 60 Hz
  ingestion on a 15-series chart, and fall to a few frames per second on a
  ten-chart dashboard at 10 Hz.
- Progressive rendering keeps ECharts responsive for large scatter and heatmap
  series, but the complete picture can take seconds.
- Plotly's WebGL hover over 1M points takes hundreds of milliseconds per move;
  its SVG scatter is slower to mount at 10k points than its WebGL scatter is at
  200k.
- Grids over shared typed columns (Herceg, and Glide reading them through a
  callback) mount any size in a few milliseconds and keep ~2 MB, where
  TanStack Table and AG Grid first build ~620 MB of row objects for 1M rows
  and crash at 1M x 100. Herceg's row views sort 100k rows in ~16 ms
  against ~80 ms for their comparators over row objects, and keep sorted
  grids current under 10 Hz appends at 1M rows, as fast as plain
  typed-array code (Glide's external adapter) there; that code still
  filters 100k rows faster than Herceg's views (on par at 1M) and shows
  an unsorted rolling window a frame sooner, and Glide's canvas is fastest
  per scroll step but shows content a frame behind the scroll position.
  See [Grids](#grids).
