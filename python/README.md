# herceg for Python

Interactive charts for pandas, Polars, PyArrow, and NumPy data, rendered by
the [Herceg](https://github.com/op55-org/herceg) engine: zooming,
tooltips, linked selections, and large data in notebooks, HTML, SVG, PNG,
PDF, Streamlit, and web pages.

> Not yet published to PyPI. Build it from a checkout
> ([Install](https://github.com/op55-org/herceg/blob/main/docs/guide/getting-started.md#install)). Python 3.10 or
> newer.

```python
import herceg as hg

hg.line(df, x="time", y=["p50", "p99"], title="Request latency")
```

## Examples

```python
import herceg as hg
import herceg.express as hx

# One call per chart
hg.bar(sales, x="region", y=["q1", "q2"])
hg.scatter(cars, x="weight", y="mpg", series="origin", zoom="xy")
hg.heatmap(load, x="hour", y="host", color="cpu", colors="viridis")
hg.treemap(sales, ["region", "country"], "revenue")

# Marks composed on shared axes
chart = (
    hg.Chart(df, title="Request latency", y=hg.AxisOptions(title="ms"), zoom=True)
    .line(x="time", y=["p50", "p99"])
    .rule(y=250, label="SLO")
)

# Output
chart.save("latency.html")  # self-contained page
chart.save("latency.pdf")  # vector PDF (the export extra)
chart.save("figure.png", size=(6, 4), unit="in", dpi=300)

# Seaborn-style statistics, computed with NumPy
hx.lineplot(fmri, x="timepoint", y="signal", series="event", errorbar=("se", 1))

# A live notebook chart that streams rows and reports brushing
live = hg.Chart(df, brush="x").line(x="time", y="cpu").widget()
live.append(new_rows, max_rows=10_000)
live.on_select(lambda selection: print(selection.x))
```

In Streamlit:

```python
import herceg.streamlit as hst

state = hst.chart(chart, key="latency", on_select="rerun")
```

## What it does

- **Charts**: line, area, bar, scatter, heatmap, contour, histogram, box
  plot, boxen, violin, error bars, rug, candlestick, dendrogram, pie,
  treemap, sunburst, gauge, funnel, radar, Sankey, network, maps, and 3D
  points, lines, and surfaces; rules, regions, and text annotations; small
  multiples, subplots, and insets.
- **Data** travels as binary columns beside the chart's portable spec, not
  as JSON lists or Python objects per value. `hg.derive` filters and
  aggregates in the browser, `hg.view` filters and sorts rows for series
  marks without a copy, and `hg.ordered` keeps rows in time order as late
  ones stream in.
- **Output**: notebooks (Jupyter, JupyterLab, VS Code), HTML, SVG, PNG,
  JPEG, WebP, and PDF; live widgets (anywidget); Streamlit; fragments for
  Flask, Django, and FastAPI pages.
- **Errors** are `hg.ChartError`, raised as early as Python can check,
  naming the option and what was meant.

## Extras

| Extra | For |
| --- | --- |
| `export` | SVG, PNG, JPEG, WebP, and PDF |
| `notebook` | Live notebook charts |
| `streamlit` | `herceg.streamlit` |
| `flask` | `herceg.flask` |
| `stats` | SciPy clustering in `herceg.express` |
| `pandas`, `polars`, `arrow` | Those table libraries |

## Documentation

- [Herceg for Python](https://github.com/op55-org/herceg/blob/main/docs/guide/python/README.md): the API, coming
  from matplotlib, and limits
- [herceg.express](https://github.com/op55-org/herceg/blob/main/docs/guide/python/express.md),
  [Output](https://github.com/op55-org/herceg/blob/main/docs/guide/python/output.md), and
  [Notebooks and Streamlit](https://github.com/op55-org/herceg/blob/main/docs/guide/python/notebooks-and-streamlit.md)
- The [topic guides](https://github.com/op55-org/herceg/blob/main/docs/README.md), each with Python examples

## Development

From the repository root:

```sh
npm run build:python   # bundle the engine into python/src/herceg/static
npm run test:python    # build, then run pytest in a uv environment
npm run lint:python    # ruff and mypy
```

## License

MIT
