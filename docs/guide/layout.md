# Layout

One chart can hold many panels: small multiples split by a field
(**facets**), different marks side by side (**subplots** placed by a
**layout**), and panels drawn over others (**insets**). This guide covers
all three, how panels share scales, and how to address one panel.

- [Small multiples](#small-multiples)
- [Subplots](#subplots)
- [Sharing scales](#sharing-scales)
- [Insets](#insets)
- [Panels' legends](#panels-legends)
- [Layout marks in panels](#layout-marks-in-panels)
- [Working with panels](#working-with-panels)

## Small multiples

`facet` draws the chart once per value of a category field, wrapped into
rows, or once per pair of values of two fields, in a grid.

```ts
import { facet } from "herceg";

createChart(element, {
  marks: [
    line(sales, { x: "week", y: "units" }), // each panel: that region's rows
    line(targets, { x: "week", y: "target", facet: "repeat" }), // whole, in every panel
    rule({ y: 100, label: "goal" }), // constants repeat
    rule(launches, { x: "week", label: { field: "product" } }), // each launch in its region's panel
  ],
  facet: facet("region", { columns: 3 }), // spec: { field: "region", columns: 3 }
});

createChart(element, {
  marks: [line(sales, { x: "week", y: "units" })],
  facet: facet({ row: "region", column: "product" }), // a grid; either may be left out
  y: { scope: "row" }, // a y scale per row of panels
});
```

```python
hg.Chart(sales, facet="region", facet_columns=3).line(x="week", y="units")
hg.Chart(sales, facet_row="region", facet_column="product").line(x="week", y="units")
hg.Chart(sales, facet="region").pie("product", "revenue")  # a pie per region
```

- **Order.** Panels follow the order values first appear. Rows without a
  value are left out. A grid has a panel for every pair, rows by columns,
  empty ones included; column values go above the top row, row values
  beside the last column.
- **Splitting.** Marks over a table split its rows by the facet fields
  unless `facet: "repeat"`; marks without a table repeat. Annotations over a
  table draw each row in its own row's panel.
- **Per panel.** Stacks stack, histograms count, and box plots summarize
  each panel's rows apart. Heatmap colors follow one scale across panels.
  Series keep their dodge slots in every panel.
- **Keys.** Panels are keyed by their value, or in a grid by both as a JSON
  array (`["North","A"]`), which inspections report as `panel`.
- **Interaction.** Pointer, brush, and zoom act on the scales of the panel
  they start in; panels sharing them follow. Up and Down move the keyboard
  between series and on to the next panel.
- **Limits.** A chart too small for its panels (under 20 px a side) throws,
  naming the grid. Points over a row view, and custom marks without series,
  repeat rather than split. 3D marks refuse facets.

## Subplots

`panels` draws different marks in different panels, placed by a layout
from `herceg/layout`.

```ts
import { columns, panel, panels, rows } from "herceg/layout";

createChart(element, {
  height: 600,
  panels: panels(
    columns([2, 1], [
      rows([2, 1], [
        panel({ id: "latency", title: "p99", y: { title: "ms" } }),
        panel({ id: "errors", title: "Errors" }),
      ]),
      panel({ id: "share", title: "By region" }),
    ]),
  ),
  marks: [
    line(data, { panel: "latency", x: "time", y: "p99", color: "region" }),
    bar(data, { panel: "errors", x: "time", y: "errors", color: "region" }),
    pie(data, { panel: "share", category: "region", value: "requests" }),
    rule({ x: deployedAt, label: "deploy", panel: "latency" }),
  ],
});
```

```python
chart = hg.Chart(df, height=600)
left, right = chart.columns([2, 1])
latency = left.panel("latency", weight=2, title="p99")
latency.line(x="time", y="p99", color="region")
left.panel("errors", title="Errors").bar(x="time", y="errors", color="region")
right.panel("share", title="By region").pie("region", "requests")
```

| Helper (`herceg/layout`) | Python | Places |
| --- | --- | --- |
| `columns(widths, children)`, `rows(heights, children)` | `chart.columns(widths)`, `chart.rows(heights)`, then `cell.panel(...)` | One row or column of cells; `widths` is a count of equal tracks or a size per track. |
| `grid({ rows, columns, gap, id }, cells)` with `cell({ row, column, rowSpan, columnSpan }, content)` | `chart.grid(rows=, columns=)`, `grid.cell(row=, column=, row_span=)` | Cells spanning tracks; without cells, panels fill row by row. |
| `mosaic([["a", "c"], ["b", "c"]], { rows })` | `chart.mosaic([["a", "c"], ["b", "c"]], rows=)` | A grid drawn as rows of ids; a repeated id spans, `null` (`None`) is empty. |
| `panel(settings, insets?)` | `cell.panel(id, weight=, title=, x=, y=, y_right=, style=)` | A panel with its settings: `id`, `title`, `x`, `y`, `yRight`, `style`, `camera`, `interaction`. |
| `inset(settings, options)` | `panel.inset(...)` | A panel over another's plot ([below](#insets)). |

- **Tracks** are weights (`2`), weights with a least size
  (`{ weight: 1, min: 200 }`, Python `hg.Weight(1, min=200)`), or pixels
  (`{ px: 220 }`, `hg.Pixels(220)`). Tracks size the panels' plots, as
  matplotlib's ratios do: titles, axes, and legends take room beside them.
  Plots line up across a track. `gap` is 12 px by default.
- **Marks** name their panel with `panel`, or `"*"` for all. In a chart
  with panels, a mark without one is an error.
- **Ids** may be left out (`"panel-1"`, `"panel-2"`, ...); give ids where
  something names the panel.
- **A layout that does not fit** is refused with the room it needs
  ("layout: needs at least 280 px of width for its panels' plots, titles,
  and axes, and has 200 px; ...").
- **Per-panel settings.** A panel's `x`, `y`, `yRight` replace the chart's
  for its own axes (one panel can be logarithmic); its `interaction`
  replaces the chart's there, setting by setting.
- **In a spec**, the layout is the chart's `layout`:

```json
{
  "panels": [{ "id": "latency" }, { "id": "errors" }],
  "layout": {
    "type": "grid",
    "rows": [2, 1],
    "cells": [
      { "row": 0, "column": 0, "content": { "type": "panel", "panel": "latency" } },
      { "row": 1, "column": 0, "content": { "type": "panel", "panel": "errors" } }
    ]
  },
  "x": { "scope": "chart" }
}
```

React, Vue, and Svelte write layouts as elements (`<Columns>`, `<Rows>`,
`<Grid>`, `<Cell>`, `<Panel>`, `<Inset>`; see
[Frameworks](frameworks.md#layouts)).

## Sharing scales

A scale's `scope` says which panels share one instance of it.

| `scope` | Shared by |
| --- | --- |
| `"chart"` | Every panel (insets keep their own). Facets' default. |
| `"panel"` | No other panel. Subplots' default (x is the chart's with a navigator). |
| `"row"`, `"column"` | The panels of a row or column of the grid holding them. |
| `{ layout: id, by: "row" }` | A named grid's tracks. |
| `{ panels: [...] }` | A list of panels (the way an inset shares a parent's scale). |

- A shared scale's labels go at the outer edge of the panels along it;
  `x: { repeat: "all" }` labels every panel.
- Panels sharing a scale must agree on its type, domain, `zero`, and
  `nice`, and take its first panel's settings.
- A scale of a panel's own fits what that panel draws and zooms, pans, and
  resets by itself. Double-clicking outside the panels resets every scale.
- A category axis panels do not share holds only the categories of that
  panel's rows, so a category's band index can differ between panels.
- A scale's zoom is kept while its panels stay the same; when facets wrap
  anew (a new value), it fits its data again.
- The right y axis is shared as y is unless `yRight.scope` says otherwise
  (see [A second y axis](axes-and-legends.md#a-second-y-axis)).

## Insets

An inset is a panel drawn over another panel's plot, as a zoomed view or
an overview: at the parent's top right, 8 px in, 35% of its plot by
default, with scales of its own.

```ts
import { inset, panel, panels } from "herceg/layout";

createChart(element, {
  panels: panels(
    panel({ id: "latency", title: "p99" }, [
      inset(
        { id: "detail", x: { domain: [start, end] } },
        { width: { fraction: 0.38 }, height: { fraction: 0.42 }, indicator: true },
      ),
    ]),
  ),
  marks: [
    line(data, { panel: "latency", x: "time", y: "p99", color: "region" }),
    line(data, { panel: "detail", x: "time", y: "p99", color: "region" }),
  ],
});
```

```python
detail = latency.inset("detail", place=hg.Place(inside="top-right"),
                       width=hg.Fraction(0.38), height=hg.Fraction(0.42),
                       x=hg.AxisOptions(domain=(start, end)), indicator=True)
detail.line(x="time", y="p99", color="region")
```

| Option | Means |
| --- | --- |
| `place` | `{ inside: "top-left" }` (a corner or edge middle, `inset` px in), or `{ at: { x, y }, anchor }` with fractions or pixels. |
| `width`, `height` | `{ fraction }` of the parent's plot or `{ px }`. |
| `indicator` | `true` or `{ connectors, style }`: boxes the inset's ranges on the parent with connecting lines. Needs number or time x and y of the same kind in both. |

- The box must stay inside the parent's plot; insets side by side may not
  overlap. A box too small for its axes and titles is refused with the room
  it needs.
- The inset draws over the parent's data, grid, and annotations; legends
  inside the plot go over it. It takes no room from the layout.
- Insets can hold insets. The pointer acts in the topmost panel; the
  keyboard reads a panel, then its insets. Screen readers hear "Detail,
  inset of p99".

## Panels' legends

`legend({ panel })` lists what one panel draws, and its entries hide and
show them in that panel only.

```ts
import { legend } from "herceg";

createChart(element, { panels, marks, guides: [legend({ panel: "latency", place: { inside: "top-left" } })] });
```

```python
latency.legend(place=hg.Place(inside="top-left"))
```

- Placed above the panel by default, or `{ inside }` in its plot,
  `{ side, scope: "panel" }` beside it, `{ side, scope: "chart" }` with the
  chart's legends.
- The chart's automatic legend lists what panels' legends leave out
  (`legend: true` keeps every entry there too). Marks drawn in every panel
  (`panel: "*"`) follow the chart's legend only.
- An entry hidden in some panels and shown in others is drawn half faded
  (`aria-pressed="mixed"`); its button shows it everywhere.

## Layout marks in panels

Pies, treemaps, sunbursts, gauges, funnels, radars, Sankey diagrams, maps,
and networks draw in panels too.

- **In facets**, a layout mark is the chart's only mark and draws each
  panel's rows. A pie sums its panel's rows; radars keep every spoke and
  series, each scaled to its panel unless `domain` is given.
- **In subplots**, it has the panel it names to itself (not `"*"`), beside
  panels with axes, which keep zooming and brushing.
- **Maps.** In facets each layer splits its rows unless `facet: "repeat"`
  (a base map), and every panel is fitted to all rows, so a place is at the
  same pixels in each panel.
- **Networks.** Facet panels share one layout; each draws its rows' links.
- **3D marks** share a subplot with other 3D layers, with their own camera
  (see [3D subplots](three-dimensional.md#3d-subplots)); 3D facets are
  refused.
- **State.** Facet panels share one drill root, one map or network view, and
  one set of moved nodes, with one event naming no panel. Each subplot has
  its own, set and read with `{ panel }` and reported with `panels: [id]`.

```ts
createChart(element, {
  marks: [
    geoshape(countries, { facet: "repeat" }),
    geopoint(stores, { longitude: "lon", latitude: "lat", size: "sales" }),
  ],
  facet: facet("year"),
  interaction: { zoom: true, brush: "lasso" }, // zooming one panel zooms them all
});
```

```python
(
    hg.Chart(stores, facet="year", zoom=True)
    .geoshape(data=countries, facet="repeat")
    .geopoint("lon", "lat", size="sales")
)
```

Items keep their keys in every panel, so a category has one color and one
legend entry. Values animate only in a chart of one layout mark.

## Working with panels

Methods that read or change one panel's state take `{ panel }`:

| Method | With `{ panel }` |
| --- | --- |
| `setViewport`, `getViewport` | The panel whose scales show the ranges. Without it, only scales every panel shares. |
| `select` | The panel the selection is made in. |
| `setVisibility`, `getHiddenKeys` | One panel's hidden series (with its own legend). |
| `getCamera`, `setCamera` | A 3D subplot's camera. |
| `getDrillRoot`, `setDrillRoot` | A subplot's tree. |
| `getItemPositions`, `setItemPosition` | A subplot's network. |

- Events name what they touched: `viewport` lists the scale instances and
  panels a change moved, `select` its `owner`, and subplot events carry
  `panels: [id]`.
- `getPanels()` describes every panel of the last frame, with its key, plot,
  axes, and an inset's `parent` (see
  [Panels and pixels](interaction.md#panels-and-pixels)).
- A selection whose panels go (their facet values leave the data) is
  cleared.
