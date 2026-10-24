import base64
import datetime as dt
import html
import json
import re
import struct

import pytest

import herceg as hg
from herceg import web


def chart(**options):
    data = {"x": [1.0, 2.0, 3.0], "y": [3.0, 1.0, 2.0]}
    return hg.Chart(data, **options).line(x="x", y="y")


def read(data: bytes):
    """Splits a payload as the browser does: header length, header, aligned buffers."""
    (length,) = struct.unpack_from("<I", data)
    header = json.loads(data[4 : 4 + length])
    start = -(-(4 + length) // 8) * 8
    buffers = [data[start + offset : start + offset + size] for offset, size in header["buffers"]]
    return header, buffers


def payload_of(fragment: str) -> dict:
    match = re.search(r"<template data-herceg-payload>(.*)</template>", fragment, re.S)
    assert match
    return json.loads(html.unescape(match[1]))


def test_payloads_are_the_spec_and_its_buffers_in_an_envelope():
    spec, buffers = chart().to_spec()
    header, read_buffers = read(web.payload(chart()))
    assert header == {
        "protocol": 1,
        "kind": "chart",
        "spec": spec,
        "buffers": [[0, 24], [24, 24]],
    }
    assert read_buffers == buffers


def test_assets_load_the_entry_and_preload_its_imports():
    manifest = web.manifest()
    tags = web.assets("/static/herceg/", nonce="r4nd0m+/=")
    lines = tags.splitlines()
    assert lines[-1] == (
        f'<script type="module" src="/static/herceg/{manifest.entry}" '
        'crossorigin="anonymous" nonce="r4nd0m+/="></script>'
    )
    assert [line.split('"')[3] for line in lines[:-1]] == [
        f"/static/herceg/{name}" for name in manifest.preload
    ]
    assert web.assets("https://cdn.example/h") == web.assets("https://cdn.example/h/")
    # Every file the manifest lists is there; others are not served.
    assert manifest.entry in manifest.files
    assert all(web.asset_path(name).is_file() for name in manifest.files)
    for name in ("manifest.json", "../web.py", "missing.js"):
        with pytest.raises(FileNotFoundError, match="no web asset named"):
            web.asset_path(name)


def test_fragments_hold_the_chart_and_say_what_it_needs():
    fragment = web.fragment(chart(title="Latency", height=240), id="latency", nonce="n0nce")
    assert fragment.startswith(
        '<div id="latency" class="herceg-chart" data-herceg data-herceg-height="240">\n'
        '<style data-herceg-style nonce="n0nce">#latency{width:100%;height:240px}'
        "</style>\n<div data-herceg-fallback><p>Chart not loaded yet: Latency. It needs "
        "JavaScript, and herceg.web.assets() once in the page.</p></div>\n"
    )
    spec, buffers = chart(title="Latency", height=240).to_spec()
    held = payload_of(fragment)
    assert held["spec"] == spec
    assert [base64.b64decode(buffer) for buffer in held["buffers"]] == buffers
    assert {key: held[key] for key in ("protocol", "kind")} == {"protocol": 1, "kind": "chart"}
    # Fragments mark themselves safe for Jinja and Django templates.
    assert fragment.__html__() == fragment
    # No script: the page's policy needs nothing of a fragment.
    assert "<script" not in fragment


def test_fragments_with_a_data_url_hold_only_its_size_and_title():
    fragment = web.fragment(
        chart(title="Requests", width=500, description="Every request."),
        id="requests",
        data_url="/charts/requests.bin?day=1&kind=all",
    )
    assert fragment == (
        '<div id="requests" class="herceg-chart" data-herceg data-herceg-height="320" '
        'data-herceg-src="/charts/requests.bin?day=1&amp;kind=all" data-herceg-width="500">\n'
        "<style data-herceg-style>#requests{width:500px;height:320px}</style>\n"
        "<div data-herceg-fallback><p>Chart not loaded yet: Requests. It needs JavaScript, and "
        "herceg.web.assets() once in the page.</p><p>Every request.</p></div>\n</div>"
    )
    generated = web.fragment(chart())
    assert re.match(r'<div id="herceg-[0-9a-f]{12}"', generated)


def test_labels_that_try_to_end_the_markup_stay_text():
    evil = '</template><script>alert(1)</script>"><img src=x onerror=alert(2)>'
    data = {"x": [1.0, 2.0], "y": [3.0, 4.0], "s": [evil, "ok"]}
    fragment = web.fragment(hg.Chart(data, title=evil).line(x="x", y="y", series="s"), id="x")
    assert "<script" not in fragment and "<img" not in fragment
    held = payload_of(fragment)
    assert held["spec"]["title"] == evil
    assert evil in held["spec"]["data"]["data"]["columns"]["s"]["dictionary"]
    linked = web.fragment(chart(), data_url='/x"><script>alert(1)</script>')
    assert "<script" not in linked and 'data-herceg-src="/x&quot;&gt;' in linked


def test_options_are_checked():
    with pytest.raises(ValueError, match=r'web\.fragment id: expected a name .* received "1st"'):
        web.fragment(chart(), id="1st")
    with pytest.raises(ValueError, match=r'web\.fragment id: .* received "a b"'):
        web.fragment(chart(), id="a b")
    with pytest.raises(ValueError, match=r"web\.fragment nonce: expected the page's Content"):
        web.fragment(chart(), nonce='x" onload="alert(1)')
    with pytest.raises(ValueError, match=r"web\.fragment data_url: expected the URL of a route"):
        web.fragment(chart(), data_url="")
    with pytest.raises(ValueError, match=r"web\.assets base_url: expected the URL"):
        web.assets("")
    with pytest.raises(ValueError, match=r"web\.assets nonce"):
        web.assets("/h", nonce="<")
    # The chart is checked as any output checks it.
    with pytest.raises(hg.ChartError, match="no column"):
        web.payload(hg.Chart({"x": [1.0]}).line(x="x", y="missing"))


def test_what_pages_post_back_reads_as_python_values():
    t0 = dt.datetime(2026, 1, 1)
    ms = (t0 - dt.datetime(1970, 1, 1)).total_seconds() * 1000
    selection = web.selection(
        json.dumps({"x": [ms, ms + 60_000], "y": None, "lasso": None, "time": ["x"]})
    )
    assert selection == hg.Selection(x=(t0, t0 + dt.timedelta(minutes=1)))
    assert web.selection("null") is None
    assert web.selection(None) is None
    assert web.viewport({"x": ["a", "c"], "y": None, "yRight": None}) == hg.Viewport(x=("a", "c"))
    clicked = web.inspection(
        {
            "axis": "x",
            "value": ms,
            "time": True,
            "label": "00:00",
            "points": [
                {
                    "mark": 0,
                    "markId": None,
                    "key": "p99",
                    "label": "p99",
                    "row": 3,
                    "value": 12.5,
                    "text": "12.5",
                }
            ],
        }
    )
    assert clicked is not None and clicked.value == t0 and clicked.points[0].row == 3
    assert web.inspection("null") is None


def test_what_pages_post_back_is_checked():
    with pytest.raises(ValueError, match=r'^web\.selection: expected JSON; received "\{x"'):
        web.selection("{x")
    with pytest.raises(ValueError, match=r"^web\.selection: expected an object, not \[1\]"):
        web.selection("[1]")
    # Integers too large for a float, as JSON text can hold them.
    huge = "1" + "0" * 400
    with pytest.raises(ValueError, match=r"^web\.selection: a range's ends are finite numbers"):
        web.selection(f'{{"x": [0, {huge}], "y": null, "lasso": null}}')
    with pytest.raises(ValueError, match=r"^web\.viewport: a range's ends are finite numbers"):
        web.viewport(f'{{"x": [{huge}, 1], "y": null, "yRight": null}}')
    with pytest.raises(ValueError, match=r"^web\.inspection: points\[0\]: expected"):
        web.inspection(
            f'{{"axis": "x", "label": "", "value": 1, "points": [{{"mark": 0, "key": "k", '
            f'"label": "l", "text": "t", "value": {huge}}}]}}'
        )
    with pytest.raises(ValueError, match=r"^web\.viewport: time names axes"):
        web.viewport({"x": [1, 2], "time": ["z"]})
    with pytest.raises(ValueError, match=r'^web\.inspection: axis is "x", "y", or "item"'):
        web.inspection({"axis": "z", "label": "", "points": []})
    with pytest.raises(ValueError, match=r"^web\.inspection: points\[0\]: expected mark, key"):
        web.inspection({"axis": "x", "label": "", "value": 1, "points": [{"mark": "0"}]})
    point = {"mark": 0, "key": "k", "label": "p99", "text": "1", "value": 1}
    field = {"field": "host", "label": "Host", "kind": "category", "text": "a"}
    with pytest.raises(ValueError, match=r"^web\.inspection: points\[0\]\.fields\[0\]: expected"):
        web.inspection({"axis": "x", "label": "", "points": [{**point, "fields": [field]}]})
    assert web.inspection(
        {"axis": "x", "label": "", "points": [{**point, "fields": [{**field, "value": "a"}]}]}
    )
