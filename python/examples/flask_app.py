"""Herceg charts in a Flask app, with HTMX: brush a time range to summarize it,
add charts to the page, and zoom them together.

    pip install 'herceg[flask]'
    flask --app python/examples/flask_app.py run

The page loads herceg's script once (``herceg_assets``) and shows each chart
as a fragment (``herceg_chart``): the latency chart holds its data in the
page; the request chart fetches its data from a route of the app's own
(``web.payload``). Both share a cursor and zoom (``sync``). The page has a
strict Content Security Policy: scripts need its nonce.
"""

from __future__ import annotations

import secrets

import numpy as np
from flask import Flask, Response, g, render_template_string, request

import herceg as hg
from herceg import web
from herceg.flask import init_app

app = Flask(__name__)
init_app(app)


def latency() -> dict[str, np.ndarray]:
    """A day of per-minute request latency percentiles."""
    rng = np.random.default_rng(7)
    time = np.arange("2026-01-01", "2026-01-02", dtype="datetime64[m]")
    daily = 40 + 15 * np.sin(np.linspace(0, 2 * np.pi, len(time)))
    p50 = daily + rng.normal(0, 3, len(time))
    return {"time": time, "p50": p50, "p99": p50 * 2.5 + rng.gamma(2, 8, len(time))}


def latency_chart() -> hg.Chart:
    return hg.Chart(
        latency(),
        title="Latency by minute",
        height=300,
        brush="x",
        sync="ops",
        y=hg.AxisOptions(title="ms"),
        time_zone="UTC",
    ).line(x="time", y=["p50", "p99"])


def requests_chart() -> hg.Chart:
    """A million requests' latencies: too much to hold in the page."""
    rng = np.random.default_rng(11)
    start = np.datetime64("2026-01-01", "ms").astype(np.int64)
    time = np.sort(rng.integers(start, start + 86_400_000, 1_000_000)).astype("datetime64[ms]")
    return hg.Chart(
        {"time": time, "ms": rng.lognormal(3.5, 0.6, len(time))},
        title="Every request",
        height=300,
        sync="ops",
        time_zone="UTC",
    ).point(x="time", y="ms", radius=1)


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Latency</title>
{{ herceg_assets(nonce=g.nonce) }}
<script src="https://unpkg.com/htmx.org@2.0.4" nonce="{{ g.nonce }}"></script>
<script type="module" nonce="{{ g.nonce }}">
  // A chart's selection goes into the hidden field of the chart's form
  // before the form, which HTMX posts on herceg:select, hears of it.
  document.addEventListener("herceg:select", (event) => {
    const field = event.target.closest("form")?.elements.namedItem("selection");
    if (field) field.value = JSON.stringify(event.detail.selection);
  }, { capture: true });
</script>
</head>
<body>
<form hx-post="{{ url_for('summary') }}" hx-trigger="herceg:select" hx-target="#summary">
  <input type="hidden" name="selection">
  {{ herceg_chart(latency, id="latency", nonce=g.nonce) }}
</form>
<p id="summary">Drag across the chart to summarize a time range.</p>
{{ herceg_chart(requests, id="requests", nonce=g.nonce, data_url=url_for("requests_data")) }}
<button hx-get="{{ url_for('another') }}" hx-target="#more" hx-swap="beforeend">Add a chart</button>
<div id="more"></div>
</body>
</html>"""


@app.before_request
def make_nonce() -> None:
    g.nonce = secrets.token_urlsafe(16)


@app.after_request
def restrict(response: Response) -> Response:
    response.headers["Content-Security-Policy"] = (
        f"script-src 'nonce-{g.nonce}'; object-src 'none'; base-uri 'none'"
    )
    return response


@app.get("/")
def page() -> str:
    return render_template_string(PAGE, latency=latency_chart(), requests=requests_chart())


@app.get("/requests.bin")
def requests_data() -> Response:
    # The app decides how chart data is cached and who may read it.
    return Response(web.payload(requests_chart()), mimetype="application/octet-stream")


@app.post("/summary")
def summary() -> str:
    selection = web.selection(request.form["selection"])
    if selection is None or selection.x is None:
        return "Drag across the chart to summarize a time range."
    start, end = (np.datetime64(end, "m") for end in selection.x)
    data = latency()
    inside = (data["time"] >= start) & (data["time"] <= end)
    median = np.median(data["p50"][inside])
    over = int((data["p99"][inside] > 150).sum())
    return f"{start} to {end}: median p50 {median:.0f} ms; {over} minutes over 150 ms."


@app.get("/another")
def another() -> str:
    # A fragment HTMX inserts later mounts itself, and goes when removed. It
    # holds no script, so the page's policy needs nothing of it.
    chart = hg.Chart(latency(), height=200, sync="ops", time_zone="UTC").area(x="time", y="p50")
    return web.fragment(chart)
