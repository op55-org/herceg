# Marks

A **mark** is one visual layer of a chart: lines, areas, bars, points,
heatmaps, annotations, and more. Marks in one chart share its scales, axes,
legend, tooltips, and interaction. This guide covers the marks along x and
y axes, the options they share, encodings, annotations, and custom marks.

- [Choosing a mark](#choosing-a-mark)
- [Options marks share](#options-marks-share)
- [Lines](#lines)
- [Areas and stacks](#areas-and-stacks)
- [Line breaks and conditional bands](#line-breaks-and-conditional-bands)
- [Bars](#bars)
- [Points](#points)
- [Heatmaps](#heatmaps)
- [Encodings](#encodings)
- [Placing rows by pixels or fractions](#placing-rows-by-pixels-or-fractions)
- [Annotations](#annotations)
- [Custom marks](#custom-marks)

## Choosing a mark

| To show | TypeScript | Python | Guide |
| --- | --- | --- | --- |
| Values over time or a sequence | `line`, `area` | `hg.line`, `hg.area` | this page |
| Values by category | `bar` | `hg.bar` | this page |
| Two numbers per row | `point` | `hg.scatter` | this page |
| A value over two axes | `heatmap`, `contour`, `histogram` (x and y) | `hg.heatmap`, `hg.contour`, `hg.histogram` | this page, [Statistical charts](statistical-charts.md) |
| Distributions | `histogram`, `boxplot`, `boxen`, `violin`, `rug`, `errorbar` | same names; `herceg.express` | [Statistical charts](statistical-charts.md) |
| Clustering trees | `dendrogram` | `Chart.dendrogram` | [Statistical charts](statistical-charts.md#dendrograms) |
| Prices | `candlestick` | `hg.candlestick` | [Financial charts](financial-charts.md) |
| Parts of a whole, trees, flows, networks | `pie`, `treemap`, `sunburst`, `gauge`, `funnel`, `radar`, `sankey`, `graph` | same names | [Hierarchy and flow](hierarchy-and-flow.md) |
| Places on a map | `geoshape`, `geopoint` | `hg.choropleth`, `hg.scatter_geo` | [Maps](maps.md) |
| Three dimensions | `point3d`, `line3d`, `surface` | `hg.scatter_3d`, `hg.line_3d`, `hg.surface` | [3D charts](three-dimensional.md) |
| Thresholds, spans, notes | `rule`, `region`, `text` | `Chart.rule`, `.region`, `.text` | [Annotations](#annotations) |
| Anything else | `custom` | (JavaScript only) | [Custom marks](#custom-marks) |

What each mark supports (facets, zoom, brushing, legend toggles, animation,
...) is in [one table](support.md).

In TypeScript a mark is a function of a table and options:
`line(table, { x, y })`. In Python, a helper makes a chart of one mark
(`hg.line(df, x=, y=)`), and `hg.Chart(df)` composes marks with methods
(`.line(x=, y=)`), each returning the chart. Python spells options in
snake_case; the meaning is the same.

## Options marks share

Most marks take these; where only some do, the row says which, and
[What each mark supports](support.md) lists the rest.

| Option | Means |
| --- | --- |
| `x`, `y` | Fields placed along the axes. Several value fields (`y: ["p50", "p99"]`) draw a series each. |
| `series` | A category field: a series per value (long format). `false` for none. |
| `color` | A category field through the chart's color scale, which splits series as `series` does unless `series` is given, or a CSS color (see [Styling](styling.md#colors)). |
| `stroke`, `fill`, `strokeWidth`, `dash`, `opacity`, `fillOpacity`, `strokeOpacity` | Constant paint; `stroke` and `fill` win over `color`. `opacity` is the whole mark's. |
| `dodge` | Series side by side within each band (bars by default; points, lines, areas, error bars with `true`). |
| `stack` | Series piled up at each position: bars, areas, and histograms. |
| `id` | A name other marks and events refer to. |
| `itemKey` | A category, number, or time field naming each row's item, on marks whose items are rows (lines, areas, bars, points, rugs, error bars, candlesticks, rules, regions, and text over tables, map layers, 3D points and lines, custom marks) ([Item keys](#item-keys)). Python: `item_key`. |
| `label` | The series' name in the legend and tooltips for a single series. |
| `legend: false` | Left out of the chart's legends while still drawn. |
| `axis: "right"` | Draw on the second y axis ([Axes](axes-and-legends.md#a-second-y-axis)): marks with a y value axis; horizontal marks and lines along y stay on the left. |
| `panel`, `facet` | Which subplot it draws in; `facet: "repeat"` draws all rows in every facet panel ([Layout](layout.md)). |
| `clip` | What the drawing is cut to: `"plot"` (data's and regions' default), `"chart"`, or `false` for nothing, so markers at the plot's edge show whole. Rules and text have their own default ([Annotations](#annotations)). |
| `zIndex` | Paint order ([Styling](styling.md#paint-order)). |
| `pick: false`, `inspect: false` | Not an event target (clicks pass through to what is under it), and not read by inspection: tooltips, the crosshair, hover events ([Interaction](interaction.md#inspection)). |
| `tooltip: { fields }` | More of the row in tooltips ([Interaction](interaction.md#tooltips)); marks that summarize rows (histograms, box plots, boxen, violins, contours) and networks refuse it. |

### Item keys

An *item* is one thing a mark draws: a point, a bar, a line's
observation, an annotation's row, or a layout mark's slice or node.
Without `itemKey`, a row's item is that row, the same through appends and
drops but not through `reset`; a bar is named by its series and position.
With it, the field's value names the item, across resets and replaced
tables. Points' value transitions match points by it; the
[roadmap](../roadmap.md) lists what will address items next (clicks,
selections, a pinned tooltip, every mark's transitions):

```ts
bar(ranked, { id: "brands", itemKey: "brand", x: "value", y: "rank" });
point(data, { x: "x", y: "y", itemKey: "id" }); // points move to their new place when values animate
```

```python
chart.bar(x="value", y="rank", item_key="brand", id="brands")
```

Rows sharing a value are one item, and a missing value names the row by
its identity. `itemKey` neither splits series nor colors; give the mark an
`id` when its items must be followed while other marks come and go. Marks
whose items aggregate rows (histograms' bins, box plots' boxes, pies'
slices, trees' nodes) name their items by what they group, and refuse it,
as does an annotation placed by constants alone: it reads no rows to name.

**Dash** takes a pixel array or a matplotlib string: `"-"` (solid), `"--"`,
`":"`, `"-."`. String patterns are `[3.7, 1.6]`, `[1, 1.65]`, and
`[6.4, 1.6, 1, 1.6]` times the stroke width; arrays stay in CSS pixels.
`line(t, { x, y, strokeWidth: 2, dash: "--" })` draws `[7.4, 3.2]`.

## Lines

```ts
line(metrics, { x: "time", y: ["p50", "p99"] }); // a line per field
line(requests, { x: "time", y: "latency", series: "service" }); // a line per service
line(requests, { x: "time", y: "latency", color: "service" }); // the same
line(metrics, { x: "time", y: "p50", curve: "monotone", markers: true });
line(casts, { x: "temperature", y: "depth", orient: "y" }); // along y: a depth profile
```

```python
hg.line(df, x="time", y="latency", series="service")
hg.Chart(df).line(x="time", y="p50", curve="monotone", markers=True)
hg.line(casts, x="temperature", y="depth", orient="y")
```

| Option | Values |
| --- | --- |
| `curve` | `"linear"` (default), `"step"`, `"step-before"`, `"step-after"`, `"monotone"`: smooth through every point, never past a point's value between two points; points under 2 pixels apart are joined straight. |
| `markers` | `true` or a symbol name: a point at each observation the line keeps after level of detail. Styled by `style.marker` (`symbol`, `radius` 3 by default, `fill`, `stroke`, `strokeWidth`, `opacity`). |
| `orient` | `"x"` or `"y"`: the axis of positions. A category `y` with values on `x` lays a line along y. |
| `labels` | Series labels at `"first"`, `"last"`, `"visible-start"`, or `"visible-end"` ([below](#labels-that-follow-series)). |

- **Category positions.** On a category axis each row sits at its band's
  center and a series runs through the bands in order, whatever the row
  order, so a line follows a bar chart's months. With `dodge: true` and a
  `series`, each series runs through its share of the bands, beside grouped
  bars.
- **Lines along y** are traced and reduced along y, use the left axis only,
  and default to `"nearest-y"` tooltips. Zooming y does not rescale x.
- **Isolated rows.** A finite row with no finite neighbor is a dot as wide
  as the stroke, on every curve and renderer.
- **Gaps.** A missing value breaks the line.

## Areas and stacks

```ts
area(usage, { x: "time", y: "user" }); // filled to zero
area(usage, { x: "time", y: ["user", "system"], stack: true });
area(responses, { x: "minute", y: "count", series: "status", stack: true }); // long format
area(metrics, { x: "time", y1: "p50", y2: "p99" }); // a band between two fields
area(casts, { y: "depth", x1: "low", x2: "high" }); // a band along y
area(usage, { x: "time", y: ["user", "system"], stack: { offset: "wiggle", order: "inside-out" } });
bar(sales, { x: "region", y: ["q1", "q2"], stack: "fill", labels: { format: { style: "percent" } } });
```

```python
hg.area(df, x="time", y=["user", "system"], stack=True)
hg.area(df, x="time", y1="p25", y2="p75")
hg.area(cpu, x="time", y="load", series="host", stack=hg.Stack(gaps="interpolate"))
hg.area(usage, x="time", y=["user", "system"], stack=hg.Stack(offset="wiggle", order="inside-out"))
```

A single area is outlined along its top in its own color; stacks and bands
are not, unless `line: true`. `stroke` or `strokeWidth` styles the outline
and turns it on; `line: false` or a width of 0 turns it off.

| `stack` | Areas | Bars | Means |
| --- | --- | --- | --- |
| `false` | ✓ | ✓ | Overlaid (bars: side by side). |
| `true` | ✓ | ✓ | Signed stacking: positive up, negative down. |
| `"fill"` | ✓ | ✓ | Shares of each position's visible total, on a 0–1 axis. Set the axis' `format: { style: "percent" }` for percents. |
| `"center"` | ✓ | | Symmetric about zero (silhouette). |
| `"wiggle"` | ✓ | | The Byron–Wattenberg stream baseline, as d3's wiggle offset. |
| `{ offset, order, gaps }` | ✓ | | `offset` is `"zero"` or one of the above; `order: "inside-out"` balances layers by their peaks (fill, center, wiggle); `gaps` below. |

- **Order.** The first layer is at the bottom: fields in the order given,
  series in legend order. `"inside-out"` keeps legend order and colors.
- **Nonnegative values.** Fill, center, and wiggle refuse negative values;
  use `stack: true` for signed data. NaN and infinities draw no segment and
  count as zero. An all-zero position has zero thickness.
- **Series fields.** Areas split by `series` stack on every x any shown
  series has. Where a series has no row it counts as zero
  (`gaps: "zero"`, right for counts a query leaves out) or, with
  `gaps: "interpolate"`, the line between its neighbors (right for series
  sampled at different times). Interpolation does not bridge explicit
  missing values.
- **Readings.** Tooltips and the keyboard read each series' own rows; fill
  shows the share and the raw value. Bar labels show shares for fill.
- **Visibility.** Hiding a legend layer restacks the visible ones. Zoom
  changes the view, not the totals or baselines. Facets and subplots stack
  on their own.
- **Log axes.** Stacks stand on the axis' low end. Center and wiggle refuse
  log axes. Bands and stacks on log y are drawn straight.
- **Limits.** Bars take only `true` and `"fill"`. Stacked areas refuse
  `where` and `continuity`.

Histograms take `stack: "fill"` with the same meaning (see
[Statistical charts](statistical-charts.md#histograms)).

## Line breaks and conditional bands

`continuity` decides which neighboring observations a line or area
connects, before it is reduced, so neither level of detail nor the nearest
point search bridges a break. `where` leaves rows out and ends each run
where its condition changes, so a conditional band meets the line it is
drawn against.

```ts
line(sensors, {
  x: "time",
  y: "value",
  continuity: { defined: col("quality").ge(0.8), maxGap: { milliseconds: 3_600_000 }, breakBy: "day" },
});
area(plant, {
  x: "time",
  y1: "efficiency",
  y2: "limit",
  curve: "step-after",
  where: col("efficiency").lt(col("limit")),
});
```

```python
hg.line(df, x="time", y="value", continuity=hg.Continuity(
    defined=hg.col("quality") >= 0.8, max_gap=hg.Duration(hours=1), break_by="day"))
hg.Chart(df).area(x="time", y1="efficiency", y2="limit", curve="step-after",
                  where=hg.col("efficiency") < hg.col("limit"))
```

| TypeScript | Python | Means |
| --- | --- | --- |
| `continuity.defined` | `hg.Continuity(defined=)` | Rows where the expression fails are gaps. |
| `continuity.maxGap` | `max_gap=` | Neighbors farther apart are not connected: a number in the positions' units, or `{ milliseconds }` (Python: `hg.Duration`, `timedelta`). |
| `continuity.breakBy` | `break_by=` | A calendar unit (`"minute"` to `"year"`, in the chart's time zone) or a field (`{ field }`; Python `hg.col(name)`) whose change breaks the line. |
| `where` | `where=` | Rows where it fails are gaps; runs end where it changes, interpolated on linear curves and exact on steps. |

A run of one observation draws a dot. Tooltips, the keyboard, and the text
alternative skip left-out rows. The values' domain leaves them out; the
positions' domain spans every row, so a streaming axis does not jump.
Monotone curves refuse `where`.

## Bars

```ts
bar(sales, { x: "region", y: ["q1", "q2"] }); // grouped
bar(sales, { x: "month", y: "units", series: "region", dodge: false }); // overlapping
bar(sales, { x: "q1", y: "region" }); // a category y gives horizontal bars
bar(requests, { x: "time", y: "latency" }); // bars centered on time values
bar(sales, { x: "month", y: "units", color: "region" }); // one bar a month, in its region's color
bar(sales, {
  x: "month",
  y: "units",
  stroke: "#1b3a6b",
  labels: { format: { number: ",.0f" }, minLength: 24, place: { outside: false } },
});
```

```python
hg.bar(sales, x="region", y=["q1", "q2"])
hg.bar(sales, x="q1", y="region")
hg.bar(sales, x="region", y="q1", labels=hg.BarLabels(format={"style": "percent"}, min_length=24))
```

- **Grouping.** `series` stands bars side by side unless `dodge: false` or
  `stack`. When `series` is the band field itself, each bar takes the whole
  band and categories keep their colors and legend entries.
- **Orientation.** A category `y` makes horizontal bars, which default to
  `"nearest-y"` tooltips. Categories on a y axis run top to bottom.
- **Number and time x.** Bars are 80% as wide as the smallest gap between
  neighboring values in view (at most 64 px). `width: { px: 8 }` makes
  every bar that many pixels thick, in either orientation.
- **Outlines.** `stroke`, `strokeWidth`, `strokeOpacity`, and `dash` outline
  each bar; `strokeSides: ["top"]` outlines only the named sides as they
  stand on screen (such bars keep square ends).
- **Picking.** The pointer reads the bar it is in (a stack's segment), and
  off the bars, the bar whose end is nearest.

| `labels` (Python `hg.BarLabels`) | Means |
| --- | --- |
| `true` | Each bar's value at its end (inside each segment of a stack). |
| `field` | Another field's value instead. |
| `content` | Text and parts (`{ value: true }`, `{ field }`, `{ series: true }`), each with a `format`. |
| `format` | Intl options, or `{ number: ",.0f" }` / `{ time }` patterns. |
| `style` | A text style. Inside bars, white or black by contrast (white wherever it reaches 3:1) unless `style.color` is set. |
| `minLength` | Bars shorter than this many pixels get no label. |
| `place` | `{ outside: false, attachment }` puts labels inside at `"start"`, `"center"`, or `"end"` (default). By default they go past the bar's end, just inside where that would leave the plot. |

Labels that do not fit are left out.

## Points

```ts
point(cars, { x: "weight", y: "mpg", series: "origin", radius: 3 });
point(countries, { x: "gdp", y: "life", size: "population", series: "continent" }); // bubbles
point(stations, { x: "lon", y: "lat", color: "temperature", colors: viridis });
point(cars, { x: "weight", y: "mpg", symbol: "origin" }); // a shape per origin
point(tips, { x: "day", y: "tip", series: "sex", dodge: true, jitter: { width: 0.5 } }); // strips
point(tips, { x: "day", y: "tip", swarm: true }); // a beeswarm
```

```python
hg.scatter(cars, x="weight", y="mpg", series="origin", radius=3)
hg.scatter(countries, x="gdp", y="life", size="population", series="continent")
hg.scatter(stations, x="lon", y="lat", color="anomaly", colors="rdbu", color_midpoint=0)
hg.scatter(tips, x="day", y="tip", swarm=True)
```

| Option | Means |
| --- | --- |
| `radius` | Every point's radius in pixels (2.5 by default). |
| `size` | A number field sizing points by area, from zero (or the least value) at `radiusRange[0]` to the largest at `radiusRange[1]` (default `[2, 12]`), with a size key. Takes the place of `radius`. |
| `color` | A number or time field on a continuous scale with a color legend, or a category field through the color scale. |
| `fillOpacity` | A constant, or a field mapped from 0.15 to opaque. |
| `symbol` | A shape (`"circle"`, `"square"`, `"triangle"`, `"diamond"`, `"cross"`, `"star"`, `"wye"`, `"triangle-down"`, `"x"`) or a category field through the `"symbol"` scale (the first eight by default). Every shape has the area of the circle of the same radius. A name that is both a shape and a field is refused; write `{ field }`. |
| `stroke`, `strokeWidth` | Outlines: `stroke` alone is 1 pixel; `strokeWidth` alone uses the chart's background, keeping overlapping points apart. |
| `dodge`, `jitter`, `swarm` | On a category axis: series side by side; spread across the band by `width` (0 to 1) using a hash of each row's identity and `seed`, so points stay put as the chart redraws and streams; or packed without overlap. |
| `sampling: "pixel"` | Draw opaque points sharing a device pixel once (above 4,096 per series). |

- **Category axes.** Points sit at their bands' centers. Rows without a
  category are left out. Along a category y, a point's reported value is
  its band index.
- **Swarms** place points low to high, each at the free place nearest the
  band's center; points that find no room stand at the band's edge, as
  Seaborn's do. Each point tests at most 512 neighbors. The layout depends
  on pixels and is redone on resize and zoom; 10,000 points in one band
  take about 2 ms. `swarm` refuses `jitter` and `sampling: "pixel"`.
- **Rendering.** Points missing an encoded value are not drawn. Encoded and
  outlined points are drawn on the CPU; plain point series of 100,000 or
  more use WebGL ([Large data](large-data.md#points-canvas-and-webgl)).
- **Item keys.** `itemKey: "id"` names each point by a field, so that
  points match across replaced data ([Animation](interaction.md#animation)).
  Every mark whose items are rows takes it ([Item keys](#item-keys)).

## Heatmaps

```ts
heatmap(load, { x: "hour", y: "host", color: "cpu" }); // cells along a time axis
heatmap(load, { x: "hour", y: "host", color: "cpu", xStep: 3_600_000 }); // an hour wide; gaps where missing
heatmap(load, { x: "hour", y: "host", color: "cpu", xBanded: true }); // a column per distinct hour
heatmap(spectrum, { x: "time", y: "frequency", color: "power", sampling: { reduce: "max" } });
heatmap(events, { date: "day", color: "count", reduce: "sum" }); // a calendar, a day's rows summed
heatmap(commits, { date: "day", color: "count", calendar: "months" });
heatmap(cells, { x1: "x0", x2: "x1", y1: "y0", y2: "y1", color: "n" }); // cells between edges
```

```python
hg.heatmap(load, x="hour", y="host", color="cpu", colors="viridis")
hg.heatmap(commits, date="day", color="count", calendar="months")
hg.heatmap(color=grid, x=xs, y=ys)  # a 2D array: row i, column j at y[i], x[j]
```

| Placement | Cells |
| --- | --- |
| Category fields | One band per category; banded axes do not zoom. |
| Number or time fields | Each distinct value is a cell reaching halfway to its neighbors (the ends as far past as toward their neighbor). Edges come from the data, so zooming never moves them. The axes zoom, pan, and brush. |
| `xStep`, `yStep` | Each cell that wide around its value (milliseconds for times), never past halfway to a closer neighbor, so missing values leave gaps. |
| `xBanded`, `yBanded` | One column or row per distinct value, in ascending order. |
| `x1`/`x2`, `y1`/`y2` | Cells between two edge fields, as `bin(..., { end })` gives them. Rows of one first edge must share a second; cells must not overlap. |
| `date` | A calendar in the chart's time zone: `calendar: "weeks"` (a column per week along a time axis, a row per weekday from `weekStart`, `"mon"` by default) or `"months"` (a row per month, a column per day). |

- **Shared cells.** Rows in one cell combine by `reduce`: `"last"` (default)
  with a value, or `"mean"`, `"sum"`, `"min"`, `"max"`. Clicks and brushes
  select every row of a cell.
- **Large grids.** A grid with more cells than device pixels draws each
  pixel as the mean of its block (`sampling: { reduce: "max" }` or `"min"`
  keeps hot cells). Memory follows the rows and pixels, so there is no cell
  limit. Tooltips still report the single cell under the pointer.
- **Colors.** `colors`, `colorDomain`, and `colorMidpoint` set the color
  scale ([Styling](styling.md#continuous-color)). Heatmaps show a color
  legend or a colorbar instead of series entries.
- **Time breaks.** Rows inside breaks are not drawn; cells either side meet
  at the seam.
- **Limits.** Heatmaps refuse log axes. Calendars take no `x`, `y`, steps,
  bands, or time breaks. Edge cells take no steps, bands, or time breaks.

## Encodings

`color` and the flat paint options are short forms. Channels beyond them
go in `encode`: a field through a named scale, a constant, or a condition
on each row.

```ts
bar(sites, {
  x: "site",
  y: "gain",
  encode: {
    color: { field: "site", scale: "sites" },
    opacity: { condition: { when: col("provisional").eq(1), then: 0.45, otherwise: 1 } }, // a 0/1 field
  },
});
line(sales, {
  x: "month",
  y: "units",
  encode: { dash: { condition: { when: col("forecast").eq(1), then: "--", otherwise: "-" } } },
});
```

```python
hg.Chart(sales).line(x="month", y="units", encode=hg.Encodings(
    dash=hg.when(hg.col("forecast") == 1, "--", "-")))  # booleans become 0 and 1
```

| Channel form | Python | Means |
| --- | --- | --- |
| `{ field, scale? }` | `hg.Channel(field=, scale=)` | A category field through a named scale (`"color"`, `"dash"`, `"symbol"` by default). |
| `{ field, scale: { type: "identity" } }` | `scale=hg.IdentityScale()` | Values as they are: colors, dashes, shapes from category fields; widths, sizes, opacities from numbers. Splits no series, makes no legend entries. |
| `{ series: true, scale }` | `hg.Channel(series=True, scale=)` | The series' names through a scale, for series that are not a field's values. |
| `{ value }` | `hg.Channel(value=)` | A constant. |
| `{ condition: { when, then, otherwise } }` | `hg.when(cond, then, otherwise)` | `then` where the expression holds, `otherwise` elsewhere. |

| Mark | Channels |
| --- | --- |
| Lines | `color`, `stroke`, `dash`, `strokeWidth`, `opacity` |
| Bars | `color`, `fill`, `stroke`, `strokeWidth`, `opacity` |
| Areas | `color`, `fill`, `stroke`, `opacity` |
| Points | `color`, `fill`, `size` (square pixels), `opacity`, `symbol` |

Every output is checked against the channel that draws it: a scale mapping
shapes read as colors is refused.

**Looks along a line.** Bars and points read each row's look. A line or
area stays one series while its look changes: where a channel reads rows, a
piece of line takes the look of the observation it arrives at, so a
forecast flagged on its own rows is dashed from the last observation on.
Tangents and dashes carry across, joins are painted once, and the legend
lists the series once, in its first look. Lines whose positions do not
ascend, and stack layers, refuse looks that change.

**Looks by series.** `style.by` gives series looks by value:

```ts
line(sites, {
  x: "time",
  y: "gain",
  series: "site",
  style: { by: { map: { Average: { stroke: "#222222", strokeWidth: 3, dash: "--" } } } },
});
line(metrics, { x: "time", y: ["mean", "p95"], style: { by: { map: { p95: { dash: ":" } } } } });
```

| `style` (Python `hg.MarkStyle`) | Means |
| --- | --- |
| `by: { field?, map }` (`hg.StyleMap`) | Looks by value (`stroke`, `strokeWidth`, `dash`, `opacity`, `fill`, `fillOpacity`, `strokeOpacity`, and for lines `marker`). Without `field`, series are named by their series value or value field. Bars read each row. |
| `marker` (`hg.MarkerStyle`) | Line markers' `symbol`, `radius`, `fill`, `stroke`, `strokeWidth`, `opacity`. |
| `leader` | Text labels' lines back to moved labels. |

Legends with `swatches: "mark"` draw each series' look: dash, width, marker,
fill.

Charts using channels beyond constants and scales of categories, looks by
value, markers, continuity, `where`, label patterns, or coordinates load a
feature compiler, once per page, and draw their first frame when it has
loaded (`chart.loading` settles then). Other charts never load it.

## Placing rows by pixels or fractions

Marks of rows (lines, areas, bars, points, error bars) take coordinates for
each row's place as well as field names:

```ts
point(events, { x: "time", y: { fraction: { field: "lane" } } }); // lanes by share of the plot
line(latency, { x: { field: "time", offset: 4 }, y: "p99" }); // moved 4 pixels right
line(depths, { x: "time", y: { field: "depth", scale: "depth" } }); // a scale of its own
```

| Coordinate | Means |
| --- | --- |
| `{ field, offset }` | Each row moved `offset` pixels along the axis (right, down). |
| `{ fraction: { field }, frame? }` | A share of the plot (or `frame: "chart"`): 0 at the left or bottom, 1 at the right or top. |
| `{ px: { field }, frame? }` | Pixels from the plot's left or top. |
| `{ field, scale }` | A position scale of the chart's own (`scales: { depth: { type: "linear" } }`, with an axis from `guides`). |

Rows in a frame or on a scale of their own count toward no axis' domain.
Offsets move what is drawn, not what scales fit. A scale of the chart's own
(`"linear"`, `"log"`, `"time"`) fits what marks place on it, does not zoom,
and draws no grid lines.

## Annotations

Rules, regions, and text mark thresholds, spans, and notes. Each takes
places along the axes: a value (a number, or a `Date` on a time axis), a
field (one item per row of the table given), or a coordinate.

```ts
rule({ y: 250, label: { text: "Threshold", place: { attachment: "start", outside: true } } });
rule({ y: 300, span: [{ fraction: 0.5 }, { fraction: 1 }], strokeOpacity: 0.5 });
rule(deploys, { x: "time", label: { field: "version" } }); // a vertical rule per deploy
region({ x1: start, x2: end, label: { text: "Maintenance", place: { side: "bottom" } } });
region({ y1: 200, y2: 300 }); // a y range; with x1 and x2 too, a rectangle
text({ at: { x: { fraction: 0.03 }, y: { data: 1.7 } }, label: "Note" });
text(peaks, {
  x: "time",
  y: { field: "value", offset: -10 },
  label: { field: "value", format: { number: ".1f" } },
  overlap: "move",
});
```

```python
(
    hg.Chart(df)
    .line(x="time", y="ms")
    .rule(y=250, label=hg.Label(text="Threshold", place=hg.LabelPlace(attachment="start", outside=True)))
    .region(x1=start, x2=end, label=hg.Label(text="Incident", place={"side": "bottom"}))
    .text(at=hg.Position(x=hg.Fraction(0.03), y=1.7), label="Peak")
    .text(data=peaks, x="time", y=hg.DataPosition(field="ms", offset=-8), label=hg.Label(field="name"))
)
```

| Place | Python | Means |
| --- | --- | --- |
| A value or field | the same | On the axis' scale; one item per row for a field. A category field puts each row in its band. |
| `{ data, scale?, offset? }` | `hg.DataPosition(value or field=, offset=)` | A value on the axis' scale; a string is a category. |
| `{ field, offset? }` | `hg.DataPosition(field=, offset=)` | Each row's value. |
| `{ fraction, frame?, offset? }` | `hg.Fraction(f, frame=, offset=)` | A share of the plot or chart. |
| `{ px, frame?, offset? }` | `hg.Pixels(px, frame=, offset=)` | Pixels from the left or top. |

A rule takes a place on one axis and a `span` along the other (the plot by
default); a region one or two pairs of places; text `at: { x, y }` or `x`
and `y`. On a category axis a number is a band index (0 is the first band's
center), and a category (`{ data: "pear" }`, or a category field's rows) is
its band's center. Annotations add no bands: a category no other mark
draws has no place.

| `label` (Python `hg.Label`) | Means |
| --- | --- |
| `"text"`, `text`, `field`, `content` | Constant text, each row's value, or parts (`{ value: true }`, `{ field }`, `{ series: true }`, each with a `format`). |
| `format` | Intl options, or `{ number }` / `{ time }` patterns. |
| `style` | `fontSize`, `fontWeight`, `color`, `halo`, `background` (`fill`, `stroke`, `radius`), `padding`, `align`, `verticalAlign`. |
| `place.attachment` | Where along a rule or region side: `"start"`, `"center"`, `"end"` (default). |
| `place.side` | The region edge the label follows (top by default). |
| `place.outside` | A rule's label beside the axis, in room the chart keeps unless `reserve: false`. |
| `place.offset` | Pixels away from its place. |

- **Domains.** Annotations count toward the axes' domains only with
  `contributeDomain: true`, so thresholds do not stretch the data's axes.
  An annotation alone in a chart gives the axes its values.
- **Outside the plot.** Without `clip`, rules and text are drawn whole and
  left out while a place in data (a value, field, or category, before its
  offset) is out of the plot's view, so panning hides them; at pixels or a
  share of a frame (`{ px: 10, frame: "chart" }` above the plot) they are
  drawn wherever they are. With `clip`, nothing is left out before it
  cuts: `false` draws everything, `"chart"` and `"plot"` cut to the chart
  or plot. Regions are cut to the plot unless `clip` is `"chart"` or
  `false`.
- **Staying inside.** Labels in the plot stay inside it in every output: a
  label at the edge flips to the rule's other side or moves in. Labels of
  rules and regions outside the plot stay inside the chart.
- **Overlap.** Text labels that would cover an earlier label of the same
  mark are drawn anyway by default; `overlap: "hide"` leaves them out;
  `overlap: "move"` tries nearby places, then farther ones with a leader
  line, and leaves out labels with no free place. Text is meant for a few
  hundred labels.
- **Legend.** `legend: true` lists an annotation by its label (a rule as a
  line, a region as a box) and its entry hides it.
- **Outlines.** Regions take `stroke`, `strokeWidth`, and `strokeSides`.
- **Paint order.** Annotations paint in mark order: list a region first to
  shade under the data.
- **Facets.** Annotations over a table draw each row in its own panel.
- **Measurement.** Placement measures text with the browser's fonts on
  screen and with estimates in static SVG and PDF, so the two can place
  labels differently (supply [fonts](export.md#fonts) to make them agree).

### Labels that follow series

Lines and areas label each series with `labels`, in the series' color, at
its `"first"` or `"last"` observation drawn, or where it enters or leaves
the view. Labels stay inside the plot (shortened with an ellipsis when too
wide), or go beside the axis with `place: { outside: true }`. A band names
the edge they follow (`edge: "y2"`). Text follows another mark's series
with `from`:

```ts
line(services, {
  id: "latency",
  x: "time",
  y: "ms",
  color: "service",
  labels: { at: "last", content: [{ series: true }, " ", { value: true }] },
});
text({ from: { mark: "latency", at: "visible-end" }, label: "now" });
```

```python
hg.Chart(df, legend=False).line(
    x="time", y="ms", color="service", id="latency",
    labels=hg.SeriesLabels(at="last", content=[hg.LabelPart(series=True), " ", hg.LabelPart(value=True)]),
).text(label="now", from_=hg.MarkAnchor(mark="latency", at="visible-end"))
```

Where the view cuts a stack split by a series field, labels at the view's
edges write series and values, not fields.

## Custom marks

When no mark fits, `custom` draws shapes with the chart's scales on every
frame, in SVG or on a canvas, clipped to the plot, and in static SVG and
PDF. With a table, its `x` and `y` fields count toward the axes' domains,
and with one `x` field the `y` fields are series, as for `line`: they get
legend entries, tooltips, events, keyboard stops, and sentences in the text
alternative, and split by facet panel.

```ts
custom(requests, {
  x: "time",
  y: "latency",
  series: "service",
  description: "Request latency per service.",
  pointText: (row, format, s) => `${format.y(s.y[row]!)} ms`, // tooltip text
  zero: "y", // stems stand on zero, so the y axis includes it
  draw({ series, x, y, line, circle }) {
    for (const s of series) {
      for (let k = 0; k < s.length; k++) {
        const row = s.rowAt(k);
        const [px, py] = [x(s.x[row]!), y(s.y[row]!)];
        line(px, y(0), px, py, { stroke: s.color });
        circle(px, py, 4, { fill: s.color });
      }
    }
  },
});
```

| `draw` receives | |
| --- | --- |
| `x`, `y` | Data value to pixel (band index on category axes). |
| `domain`, `bandwidth`, `plot`, `theme` | The scales' domains, band width, plot rectangle, theme. |
| `path`, `rect`, `circle`, `line`, `text` | Shapes, each with an optional style (`fill`, `stroke`, `strokeWidth`, `opacity`, `dash`); they paint the same in SVG and on a canvas. |
| `table`, `series` | With a table: the series to draw (hidden ones left out), each with `label`, `color`, `x` and `y` columns, `length`, `rows`, and `rowAt(k)`. |

- The y axis fits the series' values in view and the points just past its
  edges. `zero: "y"` (or `"x"`) includes zero, as bars do.
- Glyphs drawn from several fields of a row (ranges from `low` to `high`)
  take `series: false`: their fields only count toward the domains. Such
  marks need `facet: "repeat"` in facets.
- Custom marks take `tooltip: { fields }` with series.
- **Limits.** JavaScript only (a spec cannot hold a function); found by
  their points rather than their shapes; meant for shapes in the thousands,
  not millions; no value animation. The built-in marks' internals (series
  resolution, picking, layout) are not a public extension API.
