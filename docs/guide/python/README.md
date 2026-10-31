# Herceg for Python

The `herceg` Python package builds charts with a Pythonic API and renders
them with the same engine as the TypeScript library: the same marks,
tooltips, zooming, and large-data handling, in notebooks, HTML, static
files, Streamlit, and web pages. Charts travel as the portable spec with
binary columns, never as per-point Python objects.

- [Install](#install)
- [Charts in one call](#charts-in-one-call)
- [Composing charts](#composing-charts)
- [Coming from matplotlib](#coming-from-matplotlib)
- [Where to go next](#where-to-go-next)
- [Limits](#limits)

## Install

Not yet on PyPI: build from a checkout ([Install](../getting-started.md#install)).
Python 3.10 or newer, with NumPy. Extras:

| Extra | For |
| --- | --- |
| `pandas`, `polars`, `arrow` | Reading those tables (the package reads them without the extra if they are installed) |
| `export` | SVG, PNG, JPEG, WebP, and PDF (`mini-racer`, `resvg-py`, Pillow) |
| `notebook` | Live notebook charts (`anywidget`) |
| `streamlit` | `herceg.streamlit` (Streamlit 1.51 or newer) |
| `flask` | `herceg.flask` |
| `stats` | SciPy clustering in `herceg.express.clustermap` (NumPy otherwise) |

## Charts in one call

One function makes a chart of one kind, taking a table and column names:

```python
import herceg as hg

hg.line(df, x="time", y=["p50", "p99"], title="Request latency")
hg.area(df, x="time", y=["user", "system"], stack=True)
hg.bar(sales, x="region", y=["q1", "q2"])  # grouped
hg.scatter(cars, x="weight", y="mpg", series="origin")
hg.heatmap(load, x="hour", y="host", color="cpu", colors="viridis")
hg.histogram(requests, x="latency", series="region", bins={"step": 10})
hg.boxplot(requests, x="region", y="latency")
hg.candlestick(prices, x="day", open="open", high="high", low="low", close="close")
hg.pie(sales, "region", "revenue", inner_radius=0.6)
hg.treemap(sales, ["region", "country"], "revenue")
hg.sankey(energy, "source", "target", "twh")
hg.graph(talks, "from", "to", nodes=people, node="name", color="team")
hg.choropleth(countries_gdf, "gdp", projection="equal-earth")
hg.scatter_3d(iris, x="sepal_length", y="sepal_width", z="petal_length", series="species")
```

Helpers take the chart's options too (`title`, `width`, `height`,
`x_axis`, `y_axis`, `zoom`, `brush`, `theme`, `facet`, `navigator`, ...).
Every helper, its options, and its TypeScript counterpart are in the
[topic guides](#where-to-go-next).

## Composing charts

`hg.Chart` composes marks on shared scales; each mark method returns the
chart.

```python
chart = (
    hg.Chart(df, title="Request latency", y=hg.AxisOptions(title="ms"), zoom=True)
    .line(x="time", y=["p50", "p99"])
    .rule(y=250, label="SLO")
)

hg.Chart(sales, facet="region").pie("product", "revenue")  # small multiples

dashboard = hg.Chart(sales, zoom="x")  # subplots
trend, share = dashboard.columns([2, 1])
trend.panel("trend").line(x="week", y="revenue")
share.panel("share").pie("region", "revenue", inner_radius=0.6)
```

- **Data** is pandas, Polars, PyArrow, a mapping of names to arrays or
  lists, or a list of records ([Data in Python](../data.md#data-in-python)).
  `hg.derive` filters, bins, aggregates, and rolls in the browser.
- **Options** are dataclasses (`hg.AxisOptions`, `hg.InspectionOptions`,
  `hg.Tooltip`, `hg.Theme`, ...) or dicts of the same fields. Names have one spelling,
  snake_case where TypeScript has camelCase.
- **Errors** are `hg.ChartError`, raised as early as Python can check
  ([Errors](output.md#errors)).

## Coming from matplotlib

Herceg takes tables and column names. Start with `data = {"x": xs, "y":
ys}`.

| matplotlib | Herceg |
| --- | --- |
| `ax.plot(xs, ys)` | `hg.line(data, x="x", y="y")`, or `chart.line("x", "y")` |
| `ax.scatter(xs, ys)` | `hg.scatter(data, x="x", y="y")`, or `chart.point("x", "y")` |
| `ax.bar(categories, heights)` | `hg.bar(data, x="category", y="height")` |
| `ax.fill_between(xs, low, high)` | `chart.area(x="x", y1="low", y2="high")` |
| `ax.axhline(v)` / `ax.axvline(v)` | `chart.rule(y=v)` / `chart.rule(x=v)` |
| `ax.text(x, y, s)` | `chart.text(x=x, y=y, label=s)` |
| `plt.subplots(1, 2, width_ratios=[2, 1])` | `left, right = chart.columns([2, 1])`, then `left.panel("a").line(...)` |
| `plt.subplot_mosaic([["a", "c"], ["b", "c"]])` | `cells = chart.mosaic([["a", "c"], ["b", "c"]])` |
| `ax.inset_axes(...)`, `indicate_inset_zoom` | `panel.inset("detail", width=hg.Fraction(0.35), height=hg.Fraction(0.35), indicator=True)` |
| `ax.twinx()` | `hg.Chart(data, y_right=hg.AxisOptions(...))`, marks with `axis="right"` |
| `fig.legend(ncol=3, loc="lower center")` | `legend=hg.LegendOptions(columns=3, place=hg.Place(side="bottom", align="center"))` |
| `fig.colorbar(m, label="°C")` | `guides=[hg.colorbar(title="°C")]` |
| `HourLocator(interval=6)`, `MultipleLocator(10)` | `hg.AxisOptions(ticks=hg.Ticks(every="6 hours"))`, `hg.Ticks(every=10)` |
| `DateFormatter("%H:%M")`, `StrMethodFormatter("{x:,.2f}")` | `hg.Format(time="%H:%M")`, `hg.Format(number=",.2f")` |
| `ax.set_xlim(...)` | `hg.Chart(data, x=hg.AxisOptions(domain=(low, high)))`; helpers use `x_axis` |
| `fig.savefig(path)` | `chart.save(path)` |
| `linewidth`, `linestyle`, `alpha` | `stroke_width`, `dash` (`"-"`, `"--"`, `":"`, `"-."`), `opacity` |
| `marker`, `markersize` | `symbol`, `radius` (CSS pixels); lines take `markers=True` |
| `color`, `edgecolor`, `facecolor` | `color` (a CSS color or a column), `stroke`, `fill` |
| `cmap`, `vmin`/`vmax` | `colors="viridis"`, `color_domain=(low, high)` |
| `zorder` | Marks draw in the order added |

Unknown options that are common matplotlib names suggest the Herceg
option. There is no pyplot state, format strings (`"ro--"`), annotation
arrows, second x scale (`twiny`), formatter callbacks (write an
`hg.Format` pattern), or artist and transform API.

## Where to go next

| Topic | Guide |
| --- | --- |
| Line, area, bar, point, heatmap, annotations | [Marks](../marks.md) |
| Histograms, box plots, violins, contours | [Statistical charts](../statistical-charts.md) |
| Seaborn-style statistics in one call | [herceg.express](express.md) |
| Pies, treemaps, Sankey, networks | [Hierarchy and flow](../hierarchy-and-flow.md) |
| Maps; 3D; candlesticks | [Maps](../maps.md), [3D](../three-dimensional.md), [Financial](../financial-charts.md) |
| Facets, subplots, insets | [Layout](../layout.md) |
| Axes, legends, colorbars | [Axes and legends](../axes-and-legends.md) |
| Colors, themes, styles | [Styling](../styling.md) |
| Zoom, brush, sync, tooltips | [Interaction](../interaction.md) |
| HTML, SVG, PNG, PDF, web pages | [Output](output.md), [Export](../export.md) |
| Live notebook charts, Streamlit | [Notebooks and Streamlit](notebooks-and-streamlit.md) |

## Limits

- Static output (a cell's value, HTML files) neither updates nor talks
  back; use `chart.widget()`. Web fragments report to the page, but the
  server cannot update a chart it sent.
- A widget has no `to_png()` of what it shows; `chart.to_png()` draws the
  chart as Python built it.
- Live charts need a running kernel; where widgets are not rendered
  (GitHub, nbviewer) they show nothing. They are tested in JupyterLab 4;
  Notebook 7, VS Code, and Colab support anywidget but are not tested here.
- Separate widgets do not share a row selection channel (each loads its
  own engine); link them from Python:
  `a.on_row_selection(lambda picked: setattr(b, "row_selection", picked))`.
  Live charts refuse to bind row selections of a derived table.
- Python keeps a live chart's data so later browsers can draw it, and
  `append` copies the read columns on each call.
- A point's `row` is its position when the browser reported it; with
  `max_rows`, rows dropped before the callback runs renumber the rest.
- Express plots drawn in a panel of another chart do not compute again in
  a live chart. They take tables, not `hg.ordered` or `hg.view`, which go
  to `hg.Chart`.
- In Streamlit, a chart that changes between runs is sent whole, engine
  included (about 430 KiB gzipped); unchanged charts are not resent. Hover
  is not reported, nor pan and zoom without `on_viewport`.
- Row groups, pivots, and grids are TypeScript only. `hg.view` sends a
  filter and sort for the browser to apply; Python does not compute the
  view's rows.
