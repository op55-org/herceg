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

Picking takes the nearest stroke or point within reach, measured to its
edge, down to the first fill the pointer is inside, in every chart family;
where the pointer is inside several strokes, the one whose centre line is
nearest, so a click where crossing lines overlap takes the line aimed at,
not the one drawn over it; pieces of lines and areas out of reach are not
measured, so picking among many lines takes about a third of the time it
did. A click among lines a
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

Listed axes' labels take `ends` (and their layers' labels): `"room"`, the
default, widens the margin for a first or last label crossing the chart's
edge, as before; `"hide"` leaves that label out, judged as painted (turned,
outlined, haloed), and keeps the margin, so the plots of races, streams,
and zoomed dashboards keep their width. Between facets and subplots a
label crossing its plot's side counts as crossing; tick marks and grid
lines stay. Python takes `hg.TickLabels(ends="hide")`, and
`herceg.express` through `guides`; colorbars refuse it. The margins that
x end labels widen now make room for their outlines and halos too.

Log axes tick and label as d3's log scales do: every digit of each decade
(1 to 9 × 10ⁿ) where the domain spans fewer decades than the axis' count,
else powers of ten every 1, 2, 5, ... decades, where they ticked 1, 2, and
5 and labelled every tick. Labels go on the ticks whose leading digit fits
the count, the others keep their tick marks and grid lines, and `format`
writes the labelled values only; `ticks: 10` labels as d3 does. Short log
spans gain grid lines, and default labels write each value with its own
decimals ("0.2", "1", "1,000", not "1.0" and "1,000.000"). Axes' `overlap:
"hide"` keeps every n-th label among the labelled ticks, `"wrap"` measures
room to the labels either side, past blank ticks, and the navigator's strip
ticks the labelled ones.

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

Custom marks have `redraw()` (`custom` returns a `CustomMark`), for a
`draw` that reads state of the application's own: the charts drawing the
mark draw it again on their next frame, at a new revision, and input picks
what that frame draws. A change of values playing plays on, each frame
drawn by `draw` as it is then, a mark that drew nothing among them, and
ends on what `draw` paints at its end. `<Custom>` in React, Vue, and
Svelte keeps one mark while its props other than `draw` and `pointText`
are the same (a `pointText` given where there was none, or dropped, makes
a new one), calling the latest ones, once the chart takes the update, and
drawing again when they change: an inline `draw` no longer ends a
transition or rebuilds the mark each render, and a render React discards
or props the chart refuses install nothing. In Vue and Svelte, make the
draw where it reads reactive state (a `computed`, `$derived`); `{#key}` is
no longer needed. See [Custom marks](docs/guide/frameworks.md#custom-marks).

`chart.update()` returns whether the chart took the options: options it
refuses leave it as it was, and are reported as before.

Fixed: no value transition moved a mark over a row view (bars, points,
lines, areas, error bars, candlesticks, heatmaps): the view's report of
its table's write showed every change at once. They move as marks over
tables do; a view's own query or restriction changing still shows at
once.

Transitions are judged by their own frames. A change of values or of view
still ends early when its frames take over 10 ms, or the page's frames do,
but building its destination, done once in its first frame (a value
transition's new scene and its plan, a view transition's plan of the view
asked for), no longer counts; that frame's moving and painting do. A large
chart that takes 12 ms to build its new scene and 2 ms a frame to move
plays its transition, where it ended after one frame. A page's frame after
one that left such work out counts it in full, so a page rebuilding every
frame is still judged by its builds.

The keyboard does what the pointer does. Every series shown is a stop,
whatever the inspection reads (marks with `inspect: false` have none), so
twelve lines of one table no longer need `inspection: { mode: "nearest" }`
to reach each one. Up and Down go in screen order at the cursor's place,
by where each series is drawn there (steps, curves, and folded paths as
drawn), left to right for series along y, and keep that order while they
follow, so crossing lines are each reached once; past the last series,
they go on to the next panel. The cursor reads what the pointer would at
its point, under the chart's `mode`, `snap`, and `within`. Each move
announces the cursor's series where it changes, with its place in the
order ("api, 2 of 12: 304 ms at 10:00"), and names it again where Up or
Down can go no further ("auth, 1 of 12"); `i` reads every series the
tooltip lists.
The cursor, its ring, and its tooltip follow the row, cell, or layout
item it is on where data changes move it within its series; when that
goes (dropped, filtered out, moved to another series) or the legend
hides its series or item, there is none (`hover` listeners hear that
nothing is hovered) until the next key hands it to its neighbour (in a
series alone, its nearest point; for a layout item, its panel's items).
The chart's description names `i` where it has series.
Fixed: the keyboard's tooltip stood at the plot's middle, away from the
point it read (a custom range item's among them); it stands at the
cursor's point in every family, which a ring marks, with the cursor's
series in bold, and at the middle only where that point is out of view
and for cursors other charts share.

`hover` reports every move of the pointer over the chart, margins and axes
included, once a frame with its latest place and values, and what a hover
listener changes synchronously (a table it writes, an option it sets, of
its own chart or another) is drawn in the frame of the move: each frame
reads every chart's pointer against the frame on screen first, then reports,
then draws. A pointer at rest still reports again when what it reads
changes, after the draw, and what listeners change then draws in the next
frame, so a listener that changes what it reads every time runs once a
frame. Where data changed since the frame on screen, the pointer is read
after its draw, as before. React's `onHover`, Vue's `@hover`, and Svelte's
`onhover` are the same listeners: what they change in a table or through
the chart's handle draws with the move.

`anchor(chart, element, { at, side, align, offset, panel, fit })` holds
an element of the application (a button, a popover) at a place in the
chart's data: a point (values, categories, dates, `{ data, scale }`,
`{ fraction }`, `{ px }`) or an item by key or reference, at its box as
each frame draws it, cut to what is in view. It moves with every frame
the chart draws (zoom, pan, resize, streaming, value transitions) and is
hidden while its place is out of view, its item not drawn, or its panel
not drawn; its input, keys, and focus stay its own, and exports leave it
out. It stays inside the chart's box (`fit`, `"flip"` by default): on
the other side of its place where its side has no room, just inside an
item's edge where neither side has (a popover over a band as tall as the
plot), then slid along to stay inside, a place it fits on kept while it
fits; `"shift"` keeps its side and slides, `"none"` places it as told. The side used is `anchor.side` and
its wrapper's `data-side`, for CSS; a `ResizeObserver` measures fitted
elements, so frames read no layout. An empty anchor with `fit: "none"`
is the reference for the application's own popovers. React's, Vue's, and Svelte's `<Anchor>` render their content into it
through a portal, a teleport, and the component's children. It is a
module of its own: applications that never anchor load none of it. See
[Anchors](docs/guide/interaction.md#anchors).

The pointer cursor shows where the chart's own click acts: over a tree's
node that drills and a drilled tree's middle, an item `interaction.select`
selects, an item a click pins, an item whose rows a row selection's clicks
select, and a legend entry; elsewhere the chart sets none, and a rule with
`drag` keeps its resize cursor. Such a chart reads what the pointer is on
as an inspecting chart does, so a move shows values playing at their end
and a resting pointer keeps changed values from moving.
`interaction.toolbar: false` (`hg.Chart(toolbar=False)`) leaves out the
buttons of trees, maps, networks, and 3D charts, keeping their keys and
gestures. Sunburst labels take `minAngle` (`hg.SunburstLabels(min_angle=...)`):
every sector at least that many degrees wide is named whole, fitting or
not, and no narrower one. An inspection's point of a pie slice, a funnel
stage, or a tree's node carries `names`, its raw names from the top (a
node's path below the whole tree's root), in tooltips, events,
`chart.inspect`, the adapters, and Python's events.

A mark's `tooltip.content` (`hg.Tooltip(content=...)`) writes each of its
points as one line of label parts, in place of its name and value: text,
`{ series: true }`, `{ value: true }`, `{ field }` of its row, and
`{ label }`, each with its own `style`, values and fields with a `format`
(a value's says whether it is a time).
The tooltip draws each part in its style beside the swatch, with `fields`
under it; the keyboard's announcements and `i`, SVG titles, and
inspections read it (`point.content`, each part's text and style, in
events, `chart.inspect`, the adapters, `herceg/web` pages, notebook
widgets, Streamlit, and Python's `hg.InspectedPoint.content`). What writes
`fields` and `content` loads as the first frame of a chart whose marks
have them draws, which does not wait for it; tooltips, announcements, and
`ready` do, so `chart.inspect()` after `ready` carries both, and no other
chart loads it. See [Content](docs/guide/interaction.md#content).

A tooltip's heading row, the place it reads, can change. The chart's
`tooltip: { heading: false }` (`hg.Chart(tooltip=hg.Tooltip(heading=False))`)
leaves it out of every tooltip: shared readings, items, pinned tooltips,
the keyboard's, and other panels'. A mark's `tooltip.heading` takes label
parts, as `content` does, and heads a tooltip showing one of its points
alone (inspection "nearest", an item, one series read) in place of the
place: a range item headed by its id or its ends. Tooltips of several
points keep the place; the keyboard announces the place, and a point's
heading where it reads one point alone. Other panels' tooltips
(`sync.panels.tooltip`) draw fields, styled content, and headings as the
chart's own does. Inspected
points carry the heading their mark wrote (`point.heading`) in events,
`renderTooltip`, `chart.inspect`, `herceg/web` pages, notebook widgets,
Streamlit, and Python's `hg.InspectedPoint.heading`; static SVG titles
are headed alike. Python's one-call helpers give `heading=False` to their
chart and heading parts to their mark, and `herceg.express` takes
`heading=False` as a chart option. Python sends the columns tooltip
content and headings read along with the data. See
[Headings](docs/guide/interaction.md#headings).

Selections are announced once per gesture, in the same words for the
pointer and the keyboard. A click or Enter that selects says the item as
its mark's tooltip writes it (its heading and content line, else its
series and place) or the series' name, with a count where several are
selected ("C-12 rates: 21.4 – 22.8 selected. 3 items selected.", "C-12 …
deselected. 2 items selected."), or "Selection cleared." The name is the
target's own, taken before `select` listeners run, and items of marks
with `inspect: false` are named too. Escape and clear bindings say
"Selection cleared." ("Brush cleared." where a brush went and bound rows
are still selected); brushes and lassos keep their range wording and add
the rows they wrote where those are a set of rows ("… 214 rows."); clicks
selecting bound rows say how many as Space does. What is said is decided
once the gesture and every listener it fires have returned; what
listeners' later writes cause is the application's to say. Legend entries
keep their pressed state; `chart.select`, synced charts, grids, previews,
and cancelled drags say nothing. See
[Selections](docs/guide/accessibility.md#selections).

Stacked areas take `where`. A condition on the series field alone picks
the layers, so one table can feed lines of all its series and a stack of
some (`where: col("series").isIn(...)`), stacked as a table of those
series would be. Other conditions test rows: a row left out between a
series' kept rows along x breaks the whole stack there, rows left out at
a series' ends shorten it, and a series with none kept is no layer.
Streaming stacks still restack only what appends, drops, and late rows
touch; stacks of fields offset (fill, center, wiggle) only the rows kept.
See [Areas and stacks](docs/guide/marks.md#areas-and-stacks).

Series labels take `at: "view-start"` and `"view-end"`: where each line,
as drawn (curves, steps, gaps), crosses the view's edge, so labels at a
zoomed or panned edge keep the order the lines cross in. `{ value: true }`
writes the value at the crossing and `{ field }` reads the observation
drawn nearer it. Text following a series (`from: { mark, at }`), specs,
Python's `hg.SeriesLabels(at="view-end")`, and the adapters take them.
Leaders of moved series labels are judged by where the text is painted,
not by how far its block moved: a label draws one where its painted
middle is more than 6 pixels from its point, by the font's metrics
(Helvetica's in PDF, Arial's in static SVG and with supplied fonts). Bar
value labels and lines' and areas' series labels and leaders paint above
grid lines raised over their mark (`grid: { zIndex }`), and are picked
there; text marks keep their own `zIndex`. See [Labels that follow
series](docs/guide/marks.md#labels-that-follow-series) and [Paint
order](docs/guide/styling.md#paint-order).

Fixed: pages kept the memory of every distinct string their charts
measured. Chrome's 2D context keeps what it shaped of each (1 to 1.6 KB,
about 30 MB before it levels off) for as long as it lives, and each
document's measuring canvas lived as long as the document, so a bar chart
race with counting labels of parts held 12 MB more than with a text mark,
most of it after its charts were gone. The measuring canvas is replaced
every 1,000 strings it measures; widths stay exact (they are the same on
any canvas of the page), and charts lay out frame for frame as before.

The theme's `inspectionOutline` role (`theme.style.inspectionOutline`, a
line: `hg.Style(inspection_outline=hg.StrokeStyle(...))` in Python, and
`theme=` in `herceg.express`; specs, React, Vue, and Svelte through
`theme`) styles the outline of the slice, sector, node, or stage the
pointer or the pinned tooltip is on: the text color at 2 pixels by
default, and nothing with `stroke: "none"`, a zero width, or a zero
opacity. The keyboard's cursor always draws the default outline, as its
ring on series points, whatever the role says. It marks its point or
item wherever it is: also where the inspection there reads nothing
(beyond `within`, or `snap: "previous"` before a series' first point),
and with `tooltip: false`, where it draws its outline or ring and
nothing else. See [Role
styles](docs/guide/styling.md#role-styles) and
[Keyboard](docs/guide/accessibility.md#keyboard).
