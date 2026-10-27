# Output from Python

Saving charts as HTML, SVG, images, and PDF; errors; and charts in the web
pages a Python application serves (Flask, Django, FastAPI).

- [Saving and showing](#saving-and-showing)
- [Errors](#errors)
- [Static export](#static-export)
- [Web pages](#web-pages)
- [Flask, Django, and FastAPI](#flask-django-and-fastapi)

## Saving and showing

```python
chart  # displays in Jupyter, JupyterLab, and VS Code
chart.show()  # notebook display, or a browser tab outside notebooks
chart.save("chart.html")  # a self-contained page: the engine and data embedded
chart.save("chart.svg")
chart.save("chart.png")  # the chart's size at 96 dpi
chart.save("figure.jpg", size=(6, 4), unit="in", dpi=300)
chart.save("chart.pdf")
hg.save(chart, "chart.webp", dpi=192)  # the same dispatch as chart.save
chart.to_html(full_page=False)  # a <div> and script, the engine inlined
chart.to_spec()  # (spec dict, list of binary buffers)
chart.to_snapshot(id_prefix="latency")  # markup a web page hydrates
chart.widget()  # a live notebook chart
```

- HTML and notebook output embed the engine (about 1.1 MiB, 430 KiB
  gzipped), so they work offline. For a page of several charts, use
  [`herceg.web`](#web-pages), which loads the engine once.
- `save` picks the format by extension (`.html`, `.svg`, `.png`, `.jpg`,
  `.jpeg`, `.webp`, `.pdf`).
- Live notebook charts and Streamlit: see
  [Notebooks and Streamlit](notebooks-and-streamlit.md).

## Errors

What Herceg refuses raises `hg.ChartError`, a `ValueError` with the
engine's fields in Python's spelling.

```python
try:
    chart.to_svg()
except hg.ChartError as error:
    print(error.code, error.path)  # series-varies marks[0].color
```

| Field | Is |
| --- | --- |
| `code` | `"unknown-field"`, `"field-type"`, `"series-varies"`, `"invalid-option"`, `"unsupported"` (a valid option not drawn in that combination, with what to give instead), ... |
| `path` | Where, in Python's names: `marks[1].color`, `theme.tokens.palette`, `charts[1].x.padding.px` |
| `mark`, `panel`, `phase` | Which mark and panel, and when |
| `info()` | All of them as a dict |

**When.** Columns, kinds, and series are checked as each mark is added
(`chart.line(x="t", y="p90")` raises at once, listing the columns the data
has); references as the chart is output; what only the engine can check
(rows `hg.derive` makes) as it draws SVG, PNG, or PDF. A chart that cannot
draw in HTML, a notebook, a widget, or Streamlit shows a box in its place
saying why.

**What.** Values of the wrong type are refused at their place among nested
options; option objects refuse as they are made (`hg.Tokens(palette=5)` at
`palette`); outputs and layouts refuse at their own arguments
(`to_png(dpi=None)` at `dpi`). Lists accept tuples, NumPy arrays, and
pandas or Polars Series (by position); iterators are refused where a list
goes, since checking would use them up. NumPy scalars are taken as Python
numbers. An unknown keyword is a `TypeError` naming what was likely meant,
including common matplotlib names.

## Static export

SVG, PNG, JPEG, WebP, and PDF need the `export` extra (`pip install
'herceg[export]'`). The settings are the [Export guide](../export.md)'s, in
Python's spelling:

```python
svg = chart.to_svg(sizing="fluid", preserve_aspect_ratio="none", stroke_scaling="fixed")
jpeg = chart.to_image(format="jpeg", size=(16, 10), unit="in", dpi=150, quality=90)
png = chart.to_png(dpi=192, fonts=fonts)
pdf = hg.to_pdf([latency, throughput], page_size="A4", title="Report", fonts=fonts, fallback=["Symbols"])
hg.save([latency, throughput], "report.pdf", page_size="A4")  # a list needs a .pdf path
```

| Output | Made by |
| --- | --- |
| SVG | The engine's DOM-free renderer in an embedded V8 (`mini-racer`): the browser's chart, with Helvetica estimates for text unless `fonts` are given. |
| PNG, JPEG, WebP | That SVG rasterized by `resvg` (system fonts by default, only the given faces with `fonts`) and encoded by Pillow. |
| PDF | The engine's `renderToPDF` in the same V8. |

- `fonts=` is a mapping of family to a path or bytes, or to `{"normal":
  ..., "bold": ...}` ([Fonts](../export.md#fonts)). `fallback` and
  `missing_glyph` are PDF only; for SVG and PNG, put covering families in
  the theme's font.
- A widget has no `to_png()` of what it shows: Python draws the chart as
  it built it (configured domains, not a zoom made in the browser).
- Express charts export like any other.

## Web pages

`herceg.web` puts charts in pages without repeating the engine in each:
the page loads the engine once, and each chart is a fragment holding its
spec and data, or naming a route that returns them.

```python
from herceg import web

head = web.assets(base_url="/static/herceg", nonce=nonce)  # once per page
body = web.fragment(chart, id="latency", nonce=nonce)  # each chart

@app.get("/charts/requests.bin")
def requests_data():
    return Response(web.payload(requests_chart()), mimetype="application/octet-stream")

web.fragment(requests_chart(), id="requests", data_url="/charts/requests.bin")
```

| Function | Does |
| --- | --- |
| `web.assets(base_url, nonce=None)` | Tags loading the engine from where the application serves `web.manifest()`'s files (`web.manifest().directory`; `web.asset_path(name)` finds one). |
| `web.fragment(chart, id=None, nonce=None, data_url=None)` | An element the script mounts, holding the chart's spec and columns (base64), or with `data_url` only its size and title. |
| `web.payload(chart)` | The spec and columns as one [binary payload](../export.md#payloads-and-page-fragments), which the browser views without parsing or copying. |

- **Caching.** Files are named by a hash of their content: serve them with
  `Cache-Control: public, max-age=31536000, immutable`. A page fetches the
  engine once (330 KiB gzipped, then modules as charts need them). Ten
  fragments of a 200-point line are 61 KB of HTML; ten
  `to_html(full_page=False)` outputs are 10.7 MB.
- **Routes** are the application's: Herceg never adds one, so the
  application decides caching and access. A million-point line's payload
  is 16 MB.
- **Mounting.** The script mounts every fragment when it loads and every
  one inserted later (HTMX swaps); removed fragments are destroyed. A
  replaced fragment mounts afresh, without its zoom or selection. Charts of
  separate fragments sync as charts of one page do.
- **Content Security Policy.** Fragments hold no script, so they work under
  `script-src 'nonce-...'` (with or without `'strict-dynamic'`), without
  `'unsafe-inline'` or `'unsafe-eval'`. Give the nonce to `web.assets` and
  `web.fragment`. A policy restricting styles too needs `style-src-attr
  'unsafe-inline'` for a few inline style attributes; `data_url` needs
  `connect-src`.
- Without JavaScript, a fragment says the chart needs it.

**Events.** Fragments dispatch `herceg:ready`, `herceg:error`,
`herceg:click`, `herceg:select`, `herceg:viewport`, `herceg:edge`,
`herceg:rowselection`, and `herceg:visibility`, with JSON details
([details](../export.md#payloads-and-page-fragments)). Python reads what a
page posts back: `web.selection`, `web.inspection`, and `web.viewport` give
`hg.Selection`, `hg.Inspection`, and `hg.Viewport`; `web.select_event`,
`web.viewport_event`, `web.edge`, and `web.visibility` read a whole
`detail` as a widget's callbacks hear it. Each raises `ValueError` for
anything else.

With HTMX, a form posts a chart's selection; a capture-phase listener fills
the field before HTMX sends it:

```html
<form hx-post="/summary" hx-trigger="herceg:select" hx-target="#summary">
  <input type="hidden" name="selection">
  {{ herceg_chart(chart, id="latency") }}
</form>
<script type="module" nonce="{{ nonce }}">
  document.addEventListener("herceg:select", (event) => {
    const field = event.target.closest("form")?.elements.namedItem("selection");
    if (field) field.value = JSON.stringify(event.detail.selection);
  }, { capture: true });
</script>
```

```python
@app.post("/summary")
def summary():
    selection = web.selection(request.form["selection"])
    ...
```

A page's own modules import the engine's script from `base_url` followed
by `web.manifest().entry`, for its JavaScript API (`getChart(element)`).

The server cannot update a chart it sent: send a new fragment.

## Flask, Django, and FastAPI

`herceg.flask.init_app(app, url_prefix="/_herceg")` (`pip install
'herceg[flask]'`) serves the engine's files, cached for good, and gives
templates `herceg_assets(nonce=None)` and `herceg_chart(chart, id=None,
nonce=None, data_url=None)`:

```python
from herceg.flask import init_app

app = Flask(__name__)
init_app(app)
```

```jinja
<head>{{ herceg_assets(nonce=csp_nonce) }}</head>
<body>{{ herceg_chart(chart, id="latency", nonce=csp_nonce) }}</body>
```

Fragments and tags are safe for Jinja's and Django's templates (the
`__html__` protocol), so they need no `|safe`.

- **Django.** List `web.manifest().directory` in `STATICFILES_DIRS` (as
  `("herceg", web.manifest().directory)`) and collect the files unchanged:
  a storage must not rewrite their hashed names.
- Keep a deployment's earlier files until pages opened before it are gone.

Complete apps: [Flask](../../../python/examples/flask_app.py) (a strict
policy, a chart from a route, HTMX posting a selection, charts added
later), [Django](../../../python/examples/django_app.py), and
[FastAPI](../../../python/examples/fastapi_app.py).
