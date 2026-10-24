import pytest

import herceg as hg
from herceg import web

pytest.importorskip("flask")

from flask import Flask, render_template_string  # noqa: E402

from herceg.flask import init_app  # noqa: E402


def app(**options):
    flask = Flask(__name__)
    init_app(flask, **options)
    return flask


def test_assets_are_served_cached_for_good():
    client = app().test_client()
    manifest = web.manifest()
    for name in (manifest.entry, *manifest.files):
        response = client.get(f"/_herceg/{name}")
        assert response.status_code == 200
        assert response.headers["Cache-Control"] == "public, max-age=31536000, immutable"
        assert response.mimetype == "text/javascript"
        assert response.data == web.asset_path(name).read_bytes()
    for name in ("manifest.json", "../web.py", "%2e%2e/web.py", "missing.js"):
        assert client.get(f"/_herceg/{name}").status_code == 404


def test_templates_get_the_assets_and_charts():
    flask = app(url_prefix="/static/hg")
    chart = hg.Chart({"x": [1.0, 2.0], "y": [3.0, 4.0]}, title="Latency").line(x="x", y="y")
    page = """{{ herceg_assets(nonce="n0nce") }}
{{ herceg_chart(chart, id="latency", nonce="n0nce") }}
{{ herceg_chart(chart, id="remote", data_url="/latency.bin") }}"""
    with flask.test_request_context("/"):
        out = render_template_string(page, chart=chart)
        assert out == "\n".join(
            [
                web.assets("/static/hg", nonce="n0nce"),
                web.fragment(chart, id="latency", nonce="n0nce"),
                web.fragment(chart, id="remote", data_url="/latency.bin"),
            ]
        )
    # Under an application mounted below the root, the assets' URLs are too.
    with flask.test_request_context("/", base_url="http://example.com/apps/ops/"):
        tags = render_template_string("{{ herceg_assets() }}")
        assert f'src="/apps/ops/static/hg/{web.manifest().entry}"' in tags
