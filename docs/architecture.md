# Architecture

How Herceg is built and why: the vocabulary code and docs share, the
pipeline from a chart's options to pixels, and an index of the subsystem
pages. For using Herceg, see the [guides](README.md).

- [Vocabulary](#vocabulary)
- [Pipeline](#pipeline)
- [Spec and API](#spec-and-api)
- [Subsystems](#subsystems)

## Vocabulary

One name per concept, used the same way in code and docs.

| Term | Meaning |
| --- | --- |
| **Table** | Columnar data: named columns of equal length (`Table`). |
| **Field** | The name of a column in a table. Encodings refer to fields. |
| **Column** | The typed storage behind a field: numbers, times (epoch ms), dictionary-encoded categories, or geometries (codes into a shared set of shapes). |
| **Matrix table** | A table of values at every x crossed with every y (`fromMatrix`): its coordinates are kept as given, one value per column of the matrix and one per row, and a column of each row's x or y is made only for a reader that asks for one. |
| **Bins** | How histograms and the `bin` transform cut a number or time axis into intervals (`BinSpec`): about a count of round bins, a step from a start, or the edges themselves. |
| **Threshold** | A value a contour is drawn at: a line runs where the field crosses it, and bands fill from one threshold up to the next. |
| **Encoding** | How a visual property follows the data. A **channel** (`encode.color`, `.fill`, `.stroke`, `.dash`, `.strokeWidth`, `.opacity`) is a field's value through a scale (`{ field, scale }`), a constant (`{ value }`), or a condition on each row (`{ condition: { when, then, otherwise } }`); `color`, a mark's primary paint (a line's stroke, a bar's, area's, or point's fill), is short for `encode.color` with a field or a color. Points also take `size` (area, within `radiusRange`), a number or time `color` on a continuous scale, `fillOpacity`, and `symbol` as fields. Constant counterparts name what they set: `radius` in pixels, `fill` and `stroke` for paint. |
| **Run** | Neighboring observations a line or area connects: `continuity` (`defined`, `maxGap`, `breakBy`) and `where` end runs, before the line is reduced. |
| **Text roles** | `label` is constant text (a series' or mark's name), or for annotations a label object (`text` or `field`, `format`, `style`, `place`, and how it keeps apart from others: `overlap`, `overlapGroup`, `leader`, `priority`); `labelField` names a field with each record's text (maps, pies); `title` heads a chart, a panel, or an axis; `labels` turns drawn labels on or off, or is bars' label object. Python spells every option in snake_case (`label_field`), and `herceg.express` takes the marks' names (`series`, `whiskers`, `normalize`). |
| **Mark** | One visual layer of a chart (`line`, `area`, `bar`, `point`, `heatmap`, `contour`, `rug`, `dendrogram`, `errorbar`, `candlestick`, `histogram`, `boxplot`, `boxen`, `violin`, the annotations `rule`, `region`, `text`, and JavaScript-only `custom` marks). A mark pairs a spec with the table it reads; a network (`graph`) also reads a table of nodes. Layout marks (`pie`, `treemap`, `sunburst`, `gauge`, `funnel`, `radar`, `sankey`, `graph`, the map layers `geoshape` and `geopoint`, and the 3D layers `point3d` and `surface`) place their own geometry instead of using x and y scales. |
| **Item** | One thing a mark draws: a row's point, bar, or annotation; an aggregate such as a histogram's bin or a heatmap's cell; or a layout mark's pie slice, tree node, gauge dial, funnel stage, radar value on one spoke, Sankey or network node or link, map region or point, or 3D point or surface grid point. Its **item key** names it (`model/items.ts`); a row's item is named by the row's identity or by an `itemKey` field. |
| **Inspection** | What the pointer or keyboard cursor reads of the data: the points the tooltip lists and hover and click events carry, found as the chart's `inspection` says (`mode`, `snap`, `within`). |
| **Target** | What input is on (`InputEvent.target`): a mark's item, an axis label, a legend entry, or a plot, picked from what the frame on screen drew (`model/pick.ts`). |
| **Projection** | Maps longitudes and latitudes to the plane a map is drawn in (`projection`, a chart option): Equal Earth, Natural Earth, Mercator, equirectangular, or conic equal-area. |
| **Camera** | Where a 3D chart is seen from: an azimuth about the vertical axis, an elevation above the floor, a zoom, and orthographic or perspective projection (`camera`, a chart option for the first view; then chart state the pointer and keyboard change). |
| **Series** | One drawn line, area, bar set, or point set within a mark: one y field, or one category of a `series` field (or of a category `color` field, which lines, areas, and bars split series by without one). Tooltip rows are series. |
| **Identity** | What a series or a layout mark's item stands for: a value of a table's category field (following derived tables back to their source), a value field's or band's label in a table, or a value through a named scale (`model/identity.ts`). Colors, legend entries, and visibility follow identities; each mark's series keys stay its own. |
| **Orient** | The axis a line or area runs along (`orient`, "x" or "y"): the axis of its positions, which it is traced, reduced, and read along; its values are on the other. Bars lie along y when their positions are a category y, histograms when they bin `y`. |
| **Scale** | Maps data values to pixels: linear, log, time, or band. A band scale maps category indices to evenly spaced bands. A scale of categories (`type: "ordinal"` in `scales`) maps a field's values to outputs: colors, shapes, dashes, or numbers. |
| **Break** | A span of time a time axis leaves out (nights, weekends, holidays): the axis measures the time it shows, and data inside a break is not drawn. |
| **Axis** | The visual guide of a position scale. In specs, a scale's short form (`x`, `y`, `yRight`) holds its scale and axis options in one object; `scales` holds scale options alone. |
| **Guide** | What explains a scale beside the data: an axis, a legend, or a colorbar. The automatic guides follow the short forms; `guides` lists more, each naming the scale it explains. |
| **Tick layer** | One set of an axis' ticks: "major" (its ticks) and those its `layers` add, such as day boundaries under hourly ticks, each with its tick marks, label row, and styles. |
| **Colorbar** | A guide drawing a continuous color scale's colors along its values, with ticks, beside or below the plots. |
| **Viewport** | What a chart shows when zoomed: `{ x, y, yRight }`, the visible x range (one per x scale when panels have x scales of their own) and the left and right y axes' ranges; null for an axis that is not zoomed, which shows its configured domain or its data. A map's are ranges of its projection's plane; a network's are ranges of its layout, with y increasing downwards. |
| **Drill root** | The node a treemap or sunburst is drilled into, whose subtree it lays out (`getDrillRoot`, chart state that clicks, keys, and `setDrillRoot` change, shared by facet panels and each subplot's own); null for the whole tree. |
| **Controls** | What a chart of a 3D, map, tree, or network mark loads to turn, pan and zoom, drill, or move nodes by pointer, keyboard, and toolbar (`dom/controls.ts`). |
| **Spec** | The portable, JSON-serializable description of a chart (`ChartSpec`). |
| **Scene** | The render plan for one frame: panels, title, and legend in CSS pixels, with no data references. |
| **Panel** | A plotting area of a scene: its plot rectangle, grid, axes, and geometry. Data is clipped to the plot; guides (rules, text) are not. A chart has one, or one per facet value or subplot, and with a navigator, the strip under them is a panel of the scene too, though not one the chart inspects or zooms. |
| **Layout** | Where a chart's subplots go (`layout` in specs, `LayoutSpec`; the helpers of `herceg/layout`): a tree of grids of **tracks** (rows and columns sized by weight, by weight with a least size, or in pixels) whose **cells** hold panels or grids and may span tracks. A layout grid is not a Grid (the data grid), and a layout mark (a pie) lays out its own items, not panels. |
| **Inset** | A panel drawn over another panel's plot (its parent), with scales of its own unless a scope names it, and optionally an **indicator** of its ranges on the parent. |
| **Navigator** | A strip under the plot (under every panel, with facets or subplots) drawing a chart's marks over its whole x axis, with a window over the x range in view (the viewport) that the pointer and keyboard move and resize (`navigator`, a chart option made by `rangeNavigator`). |
| **Geometry** | A mark's part of the scene: packed polylines (lines, areas, contour lines), rectangles (bars, regions), segments (rugs, error bars, candle wicks, dendrogram links, network links and arrowheads), points (network nodes too), a raster (heatmaps, 2D histograms), arcs (pie slices, gauge dials), polygons (a map's regions, contour bands), rules, text, shapes (custom marks, a gauge's value, funnel connectors, a directed network's bowed links), or faces (a 3D chart's surface cells and points, in drawing order). Geometry columns of tables are shapes in longitude and latitude, not scene geometry. |
| **Renderer** | Turns a scene into pixels or markup: SVG markup, retained SVG DOM, Canvas 2D, PDF. |
| **Chart** | A mounted, interactive chart in the browser (`createChart`), and the handle applications hold to it (`Chart`). |
| **Revision** | The count of a chart's changes of options, data, and state (`chart.revision`), which state events carry with their **cause** (`ChangeCause`) and frames with what they drew. A view's `viewRevision` counts changes of view alone. |
| **Ordered table** | A table kept in ascending order of a number or time field (`orderedTable`): rows that arrive late merge into place, keeping their identity. |
| **Row view** | A table's rows filtered, restricted to a row set, and sorted, as positions into the table (`RowView`); no column is copied. Series marks draw a view's rows as they would a table of them. |
| **Row groups** | A row view's rows grouped by the values of some fields, level by level (`RowGroups`, made by `groupRows`): each group's key path (its value of each field down to its level), its parent and children, the positions of its rows, and per level a table with one row of aggregates per group. |
| **Row pivot** | A row view's rows as a crosstab (`RowPivot`, made by `pivotRows`): a row per value of one field and a column per value of another and aggregate, over row groups by the two fields, with an index from each row and value to their combination's aggregates. A combination none of the rows holds is absent. |
| **Grid** | A mounted grid in the browser (`createGrid`) showing a row view's rows, or its row groups as header rows each followed by its groups below (or its rows) when expanded, or a row pivot's rows (`createPivotGrid`), or a grid source's rows (`createRemoteGrid`), drawn from a grid model (`GridModel`, `RemoteGridModel`), which holds its columns, scroll position, expansion, focus, and selection without a DOM. |
| **Grid query** | What a remote grid asks of a grid source, as portable JSON (`GridQuery`): a filter expression, sort keys, and optionally groups with aggregates; never layout or interaction. |
| **Grid source** | Rows that live elsewhere (a server, a worker) behind `GridSource`: it answers a grid query in windows of typed columns, from a snapshot the query's first answer starts. |
| **Grid column** | A column a grid shows, with its id, title, width, alignment, and format: a field (`GridColumn`), or a column a row pivot generates for a value and an aggregate (or a total), named by an id of those. Not a table's column (its storage). |

## Pipeline

```
TypeScript API: line(table, {...}), bar(...), point(...), heatmap(...), ...
React, Vue, Svelte components        Python builders  ->  spec + buffers
        |  marks = portable spec + bound table            |  loadSpec
        v                                                 v
ChartModel (DOM-free)
  axes       categorical channels give band axes, time fields time axes
  series     resolve fields, split long-format rows, map categories to
             band indices, assign colors by identity
  domains    x from data or viewport; y from data visible in x, per y axis
  layout     panels, ticks, labels, margins, legends
  geometry   per mark, level-of-detail reduction into reused buffers
        |
        v
Scene  ->  renderSvg()      standalone SVG (server, export, snapshots, tests)
       ->  renderPdf()      PDF pages (herceg/pdf)
       ->  SvgLayer         retained SVG DOM
       ->  paintCanvas()    Canvas 2D for dense marks
       ->  WebGL2           large point clouds and 3D
        |
        v
Chart (browser runtime): scheduler, pointer and keyboard, tooltip,
legend, zoom, sync, row selections, layout controls
```

The model never touches the DOM, so the same code produces server-rendered
SVG and browser charts. Text measurement is injected: the browser measures
with a canvas, static rendering with Helvetica metrics (an even 0.6 em per
glyph for monospace fonts) padded by 10%, or with supplied fonts.

## Spec and API

`ChartSpec` (`src/spec/spec.ts`) is plain JSON: field names, constants,
Intl format options, and expression trees; no functions or typed arrays.

- **Marks carry their implementation.** `line(table, options)` returns a
  `ChartMark` whose `spec` is a frozen copy of what built it, since the
  mark's caches depend on it; charts change by taking new marks. Mark
  implementations are attached to mark objects rather than looked up in a
  registry, so unused mark types are tree shaken away.
- **Typed fields.** Field options are typed from the table's schema:
  numeric encodings accept number or time fields, positions also take
  categories, and `series` only categories. Options whose forms exclude
  each other (an area's `y` or `y1` and `y2`) are unions kept apart in mark
  options and specs alike, and marks refuse mixed forms from untyped
  callers. Tables built with `new Table` rather than `table()` have no
  inferred schema, so marks check fields at runtime.
- **Loading specs** (`herceg/spec`, a separate entry so TypeScript
  applications do not bundle it). The validator checks structure,
  enumerations, finite numbers, field references, and column payloads,
  with errors shaped `location: problem; correction`; its checks are typed
  against the spec's types, so a property without a check fails to
  compile. Binary columns become typed-array views of the delivered bytes,
  copied only when misaligned. A table may name its `origin`, the table it
  was computed from, so its values keep that table's colors.
- **One spelling of each value.** `dash` is a pixel array or one of
  `"-"`, `"--"`, `":"`, `"-."`, resolved with matplotlib's default patterns
  and the final stroke width, so SVG, Canvas, and PDF agree.
- **Version.** Specs carry `version: 1` (`SPEC_VERSION`); the loader
  refuses later versions. The format changes in place until the first
  published release, from which its compatibility promise starts.
- **Contracts** keep the spec, the mark functions, the adapters, and
  Python in step ([Contributing](contributing.md#contracts)).

## Subsystems

| Page | Covers |
| --- | --- |
| [Data](architecture/data.md) | Tables and columns, memory amplification, series rows and stacks, derived tables, row views and selections, row groups, pivots, level of detail |
| [Marks](architecture/marks.md) | Series keys, identity and color, encodings and channels, band axes, bars, heatmaps, contours, annotations, custom marks, layout marks, networks, maps, 3D |
| [Rendering](architecture/rendering.md) | Drawings, renderers and how one is chosen, browser layers, paint order and picking, points and GPU clouds, rasters, scheduling, animation |
| [Layout](architecture/layout.md) | Scale instances, positions, chart layout, guides, legends, facets and subplots, insets, two y axes, text, themes and styles, time breaks, the range navigator |
| [Interaction](architecture/interaction.md) | Inspection, picking, the lazy interaction controller, bindings, views and limits, brushes, sync, tooltips, layout controls, selected rows, accessibility, the chart handle, errors |
| [Export](architecture/export.md) | The export plan, static SVG, images, PDF, fonts and text admission, server snapshots, web payloads and fragments |
| [Grids](architecture/grids.md) | Grid models, columns, grouped rows, pivots, selection, the virtualized DOM grid, remote grids |
| [Packages](architecture/packages.md) | Package layout, the React, Vue, and Svelte adapters, the Python package's live charts and Streamlit, the DOM-free core |
