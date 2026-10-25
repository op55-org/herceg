"""The Flask app the web tests drive (web.test.ts): the example app
(examples/flask_app.py) with pages and routes of the tests' own under /test.

    python web-test/app.py   # prints "ready <port>" once it serves
"""

from __future__ import annotations

import logging
import sys
import time
from collections import Counter
from collections.abc import Callable
from pathlib import Path
from typing import Any

import numpy as np
from flask import Response, g, render_template_string, request
from werkzeug.serving import make_server

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "examples"))

from flask_app import app, latency_chart  # noqa: E402

import herceg as hg  # noqa: E402
from herceg import web  # noqa: E402

#: Requests by path, for what the browser fetched and what it cached.
hits: Counter[str] = Counter()

T0 = np.datetime64("2026-01-01T00:00", "m")


def series(n: int = 200, seed: int = 0) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    return {
        "time": T0 + np.arange(n),
        "value": np.cumsum(rng.normal(0, 1, n)),
        "region": np.where(np.arange(n) % 2 == 0, "eu", "us"),
    }


def square(x: float, y: float) -> list[list[float]]:
    return [[x, y], [x + 4, y], [x + 4, y + 4], [x, y + 4], [x, y]]


def layout() -> hg.Chart:
    chart = hg.Chart(series(), height=400, title="Layout")
    left, right = chart.columns([2, 1])
    left.panel("latency", title="Latency").line(x="time", y="value", series="region")
    right.panel("share", title="Share").pie("region", "value")
    return chart


def inset() -> hg.Chart:
    chart = hg.Chart(series(), height=300, title="Inset")
    parent = chart.columns([1])[0].panel("main")
    parent.line(x="time", y="value", series="region")
    detail = parent.inset("detail", width=hg.Fraction(0.4), height=hg.Fraction(0.4))
    detail.line(x="time", y="value", series="region")
    return chart


def regions() -> dict[str, Any]:
    return {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": name, "rate": rate},
                "geometry": {"type": "Polygon", "coordinates": [square(x, 0)]},
            }
            for name, rate, x in (("A", 1.0, 0), ("B", 2.0, 5))
        ],
    }


LINKS = {"source": ["a", "a", "b"], "target": ["b", "c", "c"], "value": [1.0, 2.0, 3.0]}
SHARES = {"region": ["eu", "us", "apac"], "requests": [5.0, 3.0, 2.0]}

#: A chart of each kind a fragment can hold.
KINDS: dict[str, Callable[[], hg.Chart]] = {
    "line": lambda: hg.line(series(), x="time", y="value", series="region", title="Line"),
    "bar": lambda: hg.bar(SHARES, x="region", y="requests", title="Bar"),
    "area": lambda: hg.area(series(), x="time", y="value", title="Area"),
    "scatter": lambda: hg.scatter(series(), x="time", y="value", color="region"),
    "heatmap": lambda: hg.Chart({"x": ["a", "b"], "y": ["c", "d"], "v": [1.0, 2.0]}).heatmap(
        x="x", y="y", color="v"
    ),
    "facets": lambda: hg.Chart(series(), facet="region").line(x="time", y="value"),
    "layout": layout,
    "inset": inset,
    "map": lambda: hg.choropleth(regions(), "rate", label_field="name"),
    "network": lambda: hg.graph(LINKS, "source", "target"),
    "sankey": lambda: hg.sankey(LINKS, "source", "target", "value"),
    "treemap": lambda: hg.treemap(SHARES, path=["region"], value="requests"),
    "three": lambda: hg.Chart({"x": [0.0, 1.0], "y": [1.0, 0.0], "z": [2.0, 1.0]}).point_3d(
        "x", "y", "z"
    ),
}


def chart(kind: str, **options: Any) -> hg.Chart:
    if kind == "synced":
        return hg.Chart(series(), height=200, sync="page", **options).line(x="time", y="value")
    if kind == "large":
        n = 1_000_000
        return hg.Chart(
            {"x": np.arange(n, dtype="float64"), "y": np.sin(np.arange(n) / 5000)}, height=240
        ).line(x="x", y="y")
    if kind == "brush":
        return hg.Chart(series(), height=240, brush="x").line(x="time", y="value")
    if kind == "malicious":
        # Labels that would end the payload's template or run a script if not escaped.
        evil = "</template><script>window.pwned = 1</script><img src=x onerror=window.pwned=2>"
        return hg.Chart(
            {"x": [1.0, 2.0], "y": [3.0, 4.0], "s": [evil, "ok"]},
            title=evil,
            description=evil,
        ).line(x="x", y="y", series="s")
    return KINDS[kind]()


PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Test</title>
{% if assets %}{{ herceg_assets(nonce=g.nonce) }}{% endif %}
<script type="module" nonce="{{ g.nonce }}">
  // What the tests read: the hosts' events.
  window.events = [];
  for (const type of ["ready", "error", "click", "select", "viewport"])
    document.addEventListener(`herceg:${type}`, (event) => {
      window.events.push({ type: event.type, detail: event.detail });
      if (event.type === "herceg:error" && {{ quiet }}) event.preventDefault();
    });
</script>
</head>
<body>
{% for fragment in fragments %}{{ fragment }}
{% endfor %}
<div id="more"></div>
</body>
</html>"""


@app.before_request
def count() -> None:
    hits[request.path] += 1


def policy(response: Response) -> Response:
    """The test pages' policy, by ?csp=: none, "nonce" (scripts by nonce
    alone), "dynamic" (and 'strict-dynamic'), or "styles" (styles by nonce too)."""
    csp = request.args.get("csp", "nonce")
    nonce = f"'nonce-{g.nonce}'"
    policies = {
        "none": None,
        "nonce": f"script-src {nonce}; object-src 'none'; base-uri 'none'",
        "dynamic": f"script-src {nonce} 'strict-dynamic'; object-src 'none'; base-uri 'none'",
        "styles": f"default-src 'self'; script-src {nonce}; style-src {nonce}; "
        "img-src 'self' data: blob:; object-src 'none'; base-uri 'none'",
    }
    if request.path.startswith("/test/") and request.args.get("csp") in policies:
        value = policies[csp]
        if value is None:
            del response.headers["Content-Security-Policy"]
        else:
            response.headers["Content-Security-Policy"] = value
    return response


# After the example's own policy, which Flask's last registered hook would precede.
app.after_request_funcs.setdefault(None, []).insert(0, policy)


@app.get("/test/page")
def test_page() -> str:
    """Fragments of `kinds` (a comma-separated list, repeated `n` times), with
    data in the page or, with ?data=url, from payload routes; and of `bad`,
    whose data_url answers with what is not a payload."""
    names = [name for name in request.args.get("kinds", "line").split(",") if name]
    n = int(request.args.get("n", "1"))
    by_url = request.args.get("data") == "url"
    fragments = []
    for i in range(n):
        for name in names:
            options: dict[str, Any] = {"id": f"{name}-{i}", "nonce": g.nonce}
            if by_url:
                options["data_url"] = f"/test/payload/{name}.bin"
            fragments.append(web.fragment(chart(name), **options))
    for name in request.args.get("bad", "").split(","):
        if name:
            fragments.append(
                web.fragment(chart("line"), id=f"bad-{name}", data_url=f"/test/bad/{name}.bin")
            )
    quiet = "true" if request.args.get("quiet") else "false"
    assets = request.args.get("assets") != "0"
    return render_template_string(PAGE, fragments=fragments, quiet=quiet, assets=assets)


FORM = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Form</title>
{{ herceg_assets(nonce=g.nonce) }}
<script type="module" nonce="{{ g.nonce }}">
  window.events = [];
  for (const type of ["ready", "click", "select"])
    document.addEventListener(`herceg:${type}`, (event) =>
      window.events.push({ type: event.type, detail: event.detail }));
  // As the example app does: the selection goes into the form's field first.
  document.addEventListener("herceg:select", (event) => {
    const field = event.target.closest("form")?.elements.namedItem("selection");
    if (field) field.value = JSON.stringify(event.detail.selection);
  }, { capture: true });
  // What a form posting on herceg:select (HTMX's hx-trigger) would send.
  window.posted = [];
  const form = document.querySelector("form");
  form.addEventListener("herceg:select", () => window.posted.push(form.elements.selection.value));
</script>
</head>
<body>
<form>
  <input type="hidden" name="selection">
  {{ herceg_chart(chart, id="latency", nonce=g.nonce) }}
</form>
</body>
</html>"""


@app.get("/test/form")
def test_form() -> str:
    """The example's latency chart in a form, as the example's page has it."""
    return render_template_string(FORM, chart=latency_chart())


@app.get("/test/fragment/<name>")
def test_fragment(name: str) -> str:
    """A fragment to insert, with data in it, from its payload route
    (?data=url), or from another route (?src=)."""
    options: dict[str, Any] = {"id": request.args.get("id")}
    if request.args.get("data") == "url":
        options["data_url"] = f"/test/payload/{name}.bin"
    if request.args.get("src"):
        options["data_url"] = request.args["src"]
    return web.fragment(chart(name), **options)


@app.get("/test/payload/<name>.bin")
def test_payload(name: str) -> Response:
    return Response(web.payload(chart(name)), mimetype="application/octet-stream")


@app.get("/test/bad/<name>.bin")
def test_bad(name: str) -> Response:
    """Answers a fragment's data_url with what is not a chart's payload."""
    if name == "html":
        return Response("<!doctype html><title>Sign in</title>", mimetype="text/html")
    if name == "missing":
        return Response("not here", status=404)
    if name == "garbage":
        return Response(bytes(range(256)) * 4, mimetype="application/octet-stream")
    if name == "slow":
        time.sleep(3)
        return test_payload("line")
    raise ValueError(name)


@app.post("/test/read/<event>")
def test_read(event: str) -> dict[str, Any]:
    """What herceg.web reads of an event's detail the page posts, as JSON."""
    detail = request.get_data(as_text=True)
    if event == "viewport":
        change = web.viewport_event(detail)
        view = change.views[""].x
        return {
            "cause": change.cause,
            "scales": [[s.scale, s.instance, list(s.panels)] for s in change.scales],
            "x": [end.isoformat() for end in view] if view else None,
        }
    if event == "select":
        selected = web.select_event(detail)
        x = selected.selection.x if selected.selection else None
        return {
            "panels": list(selected.owner.panels),
            "scales": [[s.scale, s.instance, list(s.panels)] for s in selected.owner.scales],
            "x": [end.isoformat() for end in x] if x else None,
        }
    raise ValueError(event)


@app.get("/test/hits")
def test_hits() -> dict[str, int]:
    return dict(hits)


@app.post("/test/hits/reset")
def test_reset() -> str:
    hits.clear()
    return ""


if __name__ == "__main__":
    logging.getLogger("werkzeug").setLevel(logging.ERROR)
    server = make_server("127.0.0.1", 0, app, threaded=True)
    print(f"ready {server.server_port}", flush=True)
    server.serve_forever()
