"""Herceg charts in a FastAPI app, through ``herceg.web``.

    pip install herceg 'fastapi[standard]'
    fastapi dev python/examples/fastapi_app.py

A route serves herceg's script, each file cached for good since its name
changes with its content; the page loads it once and shows each chart as a
fragment, one holding its data and one fetching it from a route.
"""

import numpy as np
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse, Response

import herceg as hg
from herceg import web

app = FastAPI()


def latency_chart() -> hg.Chart:
    rng = np.random.default_rng(7)
    time = np.arange("2026-01-01", "2026-01-02", dtype="datetime64[m]")
    p50 = 40 + 15 * np.sin(np.linspace(0, 2 * np.pi, len(time))) + rng.normal(0, 3, len(time))
    return hg.line(
        {"time": time, "p50": p50, "p99": p50 * 2.5 + rng.gamma(2, 8, len(time))},
        x="time",
        y=["p50", "p99"],
        title="Latency by minute",
        sync="ops",
        time_zone="UTC",
    )


@app.get("/", response_class=HTMLResponse)
def page(request: Request) -> str:
    # The assets are the entry's neighbors, wherever the app is mounted.
    entry = request.url_for("herceg_asset", name=web.manifest().entry).path
    latency = web.fragment(latency_chart(), id="latency")
    requests = web.fragment(
        latency_chart(), id="requests", data_url=request.url_for("requests_data").path
    )
    return f"""<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Latency</title>{web.assets(entry.rsplit("/", 1)[0])}</head>
<body>
{latency}
{requests}
</body>
</html>"""


@app.get("/herceg/{name}")
def herceg_asset(name: str) -> FileResponse:
    try:
        file = web.asset_path(name)
    except FileNotFoundError:
        raise HTTPException(404) from None
    return FileResponse(
        file,
        media_type="text/javascript",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


@app.get("/requests.bin")
def requests_data() -> Response:
    # The app decides how chart data is cached and who may read it.
    return Response(web.payload(latency_chart()), media_type="application/octet-stream")
