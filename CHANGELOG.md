# Changelog

All published packages share one version: `herceg`, `@herceg/react`,
`@herceg/vue`, `@herceg/svelte`, and the Python package `herceg`. Before 1.0,
a minor version may change APIs; each such change is listed here with what
to do about it.

## Unreleased

The first release.

- **`herceg`**: the engine, with tables, marks, layouts, interaction,
  chart state (state options, conditional writes, selections of items and
  series, pinned tooltips), rendering, and export; optional parts as
  subpaths (`herceg/spec`, `herceg/fields`, `herceg/pdf`, `herceg/image`,
  `herceg/fonts`, `herceg/grid`, `herceg/web`, ...). See
  [Getting started](docs/guide/getting-started.md).
- **`@herceg/react`, `@herceg/vue`, `@herceg/svelte`**: components over the
  same engine. See [React, Vue, and Svelte](docs/guide/frameworks.md).
- **`herceg` for Python**: charts from pandas, Polars, PyArrow, and NumPy,
  with notebook widgets, Streamlit, `herceg.express`, and web pages. See
  [Herceg for Python](docs/guide/python/README.md).

What each mark supports is in [the support table](docs/guide/support.md)
and the [capability matrix](docs/capabilities.md), which the package also
publishes as `herceg/capabilities.json` beside the spec's JSON Schema,
`herceg/spec.schema.json` (`hg.spec_schema()` in Python), for chart
editors; what is planned, in the [roadmap](docs/roadmap.md).

Formats write numbers (Intl options, d3-like patterns with text around
them, durations, SI and binary prefixes) and times (Intl options, strftime
patterns, fiscal years) on every option that takes one. [Field
displays](docs/guide/fields.md) name fields and write their values once,
for every surface: charts' `fields` (TypeScript, the adapters, specs, and
`hg.Chart(fields=...)`) write axes, legends, series' names, tooltips,
labels, gauges, color ramps, the text alternative, and layout marks'
names and amounts (pies, funnels, trees, Sankey diagrams, networks, maps,
radars) through them, grids take them as charts do (headers, cells,
group rows, and pivots; `model.update({ fields })` changes them), a
`compileFields(rules)` result is one compilation charts and grids share,
and `herceg/fields` reads them for application code. Grid columns take
every format form, by their field's kind. Grid cells take looks: a
column's `encode`, a grid's `encode` of whole rows, and a column's
`aggregateEncode` of group rows color backgrounds and text through the
channels marks' colors take (display colors, the grid's `scales` with
gradients and scales of categories, conditions, rank tests, and lists),
with black or white text over fills by WCAG contrast, in pivots and remote
grids too; `model.update({ scales, encode })` changes them. Grid cells draw
more than text: linked fields' cells hold their links, columns take cell
kinds (`barCell`, `chipCell`, and `symbolCell`, whose shapes `encode.symbol`
gives), `createGrid`'s `cells` takes custom renderers by column id (text,
control, or composite cells, with signals and declared fields), and columns
without fields write their `text` (literal text and fields), which a
renderer draws more for, or draw `sparklineCell`: a line or area per row
of another table's rows matching the row's key by raw value, over an x
window the column shares, at most four points a device pixel with gaps
narrower than a pixel joined, its text a summary that screen readers and
`cellAt` (`sparkline`) read, kept current through appends. React's,
Vue's, and Svelte's `<Grid>` (`@herceg/react/grid`, `@herceg/vue/grid`,
`@herceg/svelte/grid`) and `<RemoteGrid>` (`/grid/remote`) take `cells`
by column id, typed by the model's fields: React render functions
through portals, Vue render functions or `#cell-<id>` slots through
teleports, and Svelte snippets mounted with the component's contexts,
each in the component's tree, its state kept per row, in an error
boundary drawing the cell's text (React's in a Suspense boundary too),
and committed before the grid paints; `<PivotGrid>` (`/grid/pivot`)
shows pivots.
`rowTotals(view, { ops })` keeps one row of aggregates over every row a view
shows, as row groups keep theirs (appends and rolling windows' drops
followed, sums compensated), for a grid's totals row (`totals`), a KPI, or
a chart; grids show it in a sticky footer row ("Total" in the first column
without an aggregate, looks by `aggregateEncode`, the focus kept on it as
rows stream), with groups as the grand total under their subtotals;
`pivotRows`' `totals` takes `{ columns, row }` for a pivot's totals row,
folded from its own combinations; remote grids ask their source
(`GridSource.totals`, which `memorySource` and the conformance fixtures
answer). Grid columns take `heading` (a title, `{ id, title }`, or a path of
them): runs of adjacent columns under the same path share a header, in as
many header rows as the longest path, and columns' names carry their
headings. `exportGrid(model, options)` writes what a grid shows as CSV or
TSV (a UTF-8 `Blob`; local, grouped, pivot, and remote grids): text or raw
values, the rows shown, the records, or the selection, titles with their
headings as the header, the totals row, and formulas escaped for
spreadsheets unless the text is wholly a number in the grid's locale; it
writes the state the rows were in when it started, in chunks that yield
to the page, failing with a `GridExportError` where they changed, and
reads a remote grid's rows from its snapshot, which it keeps until it
ends. Ctrl+C (Cmd+C) in a grid copies the selected rows, or the focused
cell, as TSV within limits (`createGrid`'s `copy`, the components' `copy` prop),
and announces what it copied. Grids report `select` (React `onSelect`, Vue
`@select`, Svelte `onselect`) after every change of their selection
store's channel, by any writer, with its cause (`"pointer"`, `"keyboard"`,
`"api"`, `"sync"`) and the model's revision: once per command, in the
order of the changes, before a click's `rowClick`, in local, pivot, and
remote grids. Selection stores freeze what they hold in place, so a
selection reported never changes (`RowSet.freeze()`, `rows.copy()`,
`ReadonlyRowSet`); remote stores hand their listeners each change. Series marks' `label`
and axes' `title` take parts (`{ series: true }`, `{ field }`,
`{ label }`, text). Displays also color values: a number field's
`thresholds`, and colors of mappings and missing values, color bars,
lines, areas, and regions colored by the field without a scale, points and
heatmaps without a ramp of their own, series of category fields, gauges'
bands, and tooltip fields' swatches, with a key in the legend; rules and
regions stand at a field's thresholds (`{ thresholds: "p99" }`,
`hg.AtThresholds` in Python). A display's `link` (`hg.Link` in Python)
makes a link of each value from the row's values, URL-encoded: pinned
tooltips draw tooltip fields' links and grid cells their fields' (http,
https, mailto, and relative URLs only), events carry them
(`InspectedField.link`), and `displayOf` gives them to application code.

Channels in `encode` (and points' flat `color`, `size`, `fillOpacity`, and
`symbol`) also take a list of channels tried in order, each drawn item
taking the first output, and conditions without `otherwise` (no output
where they fail) or with a rank test as their condition (`{ top: n, field }`,
`{ bottom: n, field }`: the n largest or smallest values of the mark's
rows, ties in, followed as rows stream). In Python, a list of channels,
`hg.when(condition, then)`, and `hg.top(n, field)` / `hg.bottom(n, field)`.
Lists split no series; one ending in the series' colors keeps their
legend entries and toggles, and scales read in a list show their key.
Custom marks read lists through `encoded(channel, row, series)`. Heatmaps
take no `encode`.

Picking takes the nearest stroke or point within reach, down to the first
fill the pointer is inside, in every chart family: a click among lines a
pixel apart takes the one under it, a line over a band is reached inside
the band, an area's outline over its own fill, a box plot's whisker as a
stroke, and draggable rules are grabbed first. A hollow candle's body is
reached at its outline; its inside picks what is under it. Selected parts
paint over the rest, a line's over every series' dimmed lines.
`chart.referenceOf("series" | "item", key)` (Python `reference_of` on
charts and widgets) reads a key from an event as a reference to a mark's
`id`, and legend entries carry
the series and items they stand for as `references` (`getLegend()`,
`legendEntry` targets, `hg.LegendEntryTarget`).

x axes take `room` as y axes do, the depth beside the plot before the
title, so plots of charts in a row and of panels end at one line: rows of
labels that do not fit are left out whole, the farthest from the plot
first, rotations deeper than the room are not tried, and wrapped labels
keep the lines that fit, the last ending with an ellipsis. The chart's `x`
and `y` take `place` (`x: { place: { side: "top" } }`) and every axis short
form takes `room`, as the axis guide they stand for, value animation
moving it too; Python's `hg.AxisOptions` takes both (`place=hg.Place(side="top")`,
`room=28` or `(least, most)`), and `herceg.express` through `x_axis` and
`y_axis`. Fixed: in subplots, a fixed y room did not line plots up, since
each panel's own labels' width was added to one shared extra; each panel
now takes exactly its room. x axes keep room for their labels' outlines
and halos, which were drawn past it, and an x axis listed in `guides` no
longer keeps the room of category labels' extra lines twice.

Points, map points, and 3D points take a CSS color in `color` as lines
do (`color="tomato"` in Python); a column name there still colors by its
values. Value animation moves every axis `guides` lists with its scale,
its layers and titles laid out between. A press that focuses a chart (a
click, a drag, a brush) draws no focus ring until a key is pressed;
keyboard focus draws one, also under a page's `:focus` reset. A clicked
tooltip pins the value its inspection read, and bar labels of several
lines align each line as `style.align` says.

Series labels at `"visible-start"` and `"visible-end"` stand at the first
and last observation in view (of the source rows, before level of
detail), through zoom, pan, and streaming, and write that observation's
fields, a series field's stack's too; a series with no observation in
view has none, and a label whose observation is outside the plot is not
drawn. Leaders take the color of what their label labels: a series', a
rule's stroke, a text mark's color, unless `leader.stroke` gives one, so
one line mark of many series draws each leader in its line's color. The
theme's `brush` role (`theme.style.brush`, a paint: `hg.Style(brush=hg.PaintStyle(...))`
in Python) paints brushes and lassos of charts, maps, and networks, and
high-contrast themes outline them. Fixed: a dodged line or area whose
category axis' positions have an `offset` drew from the second of two
rows at a category the dodge brings into the plot, leaving out the
first.

`animation.easing` takes `"cubic-out"` (the default, as before),
`"linear"`, or `"cubic-in-out"`, d3's curves of those names, for changes
of view, of values, and drills alike (`hg.Animation(easing="linear")` in
Python; specs, React, Vue, and Svelte through `animation`). An easing that
is none, given from JavaScript, moves by `"cubic-out"` and is reported
through `onError` and "error" listeners.

Custom marks move to changed values: with `animation: { values: true }`
their `draw` runs again each frame over a table of the fields they
declare (`x`, `y`, and those `encode` reads) between their two values,
matched by `itemKey` or row, its `encoded` widths, opacities, and ramp
colors between too; `draw`'s `table` is a `ReadonlyTable` with or without
animation. What moves custom marks loads only for charts that have them.

Fixed: no value transition moved a mark over a row view (bars, points,
lines, areas, error bars, candlesticks, heatmaps): the view's report of
its table's write showed every change at once. They move as marks over
tables do; a view's own query or restriction changing still shows at
once.
