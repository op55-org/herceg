"""Each drawn contract case (packages/herceg/test/fixtures/contracts.json)
made through Python's other surfaces makes the chart its methods make: the
one-call helpers (``hg.line``) and a panel's methods spell its options the
same, and the notebook widget, Streamlit, and web pages carry its spec as
it is, for herceg's JavaScript to draw (python/js/test/surfaces.test.ts
draws each case through those front ends)."""

import base64
import json
import re
import struct
from typing import Any

import pytest
from test_contracts import CONTRACTS, built, made

import herceg as hg
from herceg import streamlit as hg_streamlit
from herceg import web

DRAWN = [case for case in CONTRACTS["cases"] if "code" not in case and "builder" in case]


def drawn(surface: str, keep: Any = lambda case: True) -> list[Any]:
    return [
        pytest.param(
            case, id=case["name"], marks=pytest.mark.contract(f"{case['contract']}.{surface}")
        )
        for case in DRAWN
        if keep(case)
    ]


def by_methods(case: dict[str, Any]) -> hg.Chart:
    builder = case["builder"]
    chart = hg.Chart(CONTRACTS["data"], **built(builder.get("chart", {})))
    for call in builder["calls"]:
        getattr(chart, call["method"])(**built(call["args"]))
    return chart


#: The chart's options a helper spells its own way, beside its mark's x and y.
HELPER_AXES = {"x": "x_axis", "y": "y_axis", "z": "z_axis"}


def one_helper(case: dict[str, Any]) -> bool:
    """Whether the case is one mark that has a helper, without bars'
    ``width``: a helper's width is its chart's (see test_chart.py)."""
    calls = case["builder"]["calls"]
    return (
        len(calls) == 1
        and callable(getattr(hg, calls[0]["method"], None))
        and not (calls[0]["method"] == "bar" and "width" in calls[0]["args"])
    )


@pytest.mark.parametrize("case", drawn("helper", one_helper))
def test_helpers_spell_the_options_as_the_methods_do(case):
    builder = case["builder"]
    (call,) = builder["calls"]
    helper = getattr(hg, call["method"])
    options = {HELPER_AXES.get(key, key): value for key, value in builder.get("chart", {}).items()}
    chart = helper(CONTRACTS["data"], **built(call["args"]), **built(options))
    assert chart.to_spec() == by_methods(case).to_spec()


def unpanelled(case: dict[str, Any]) -> bool:
    """Whether the case's chart has no panels of its own to draw in."""
    options = case["builder"].get("chart", {})
    calls = case["builder"]["calls"]
    return "panels" not in options and all("panel" not in call["args"] for call in calls)


@pytest.mark.parametrize("case", drawn("panel", unpanelled))
def test_panels_take_the_options_as_the_chart_does(case):
    builder = case["builder"]
    chart = hg.Chart(CONTRACTS["data"], **built(builder.get("chart", {})))
    [cell] = chart.columns(1)
    panel = cell.panel("only")
    for call in builder["calls"]:
        getattr(panel, call["method"])(**built(call["args"]))
    spec, _ = chart.to_spec()
    marks = spec["marks"]
    # The panel's marks are the chart's, drawn in it; annotations read no table.
    assert {mark.pop("panel") for mark in marks} == {"only"}
    assert {mark.pop("data", "data") for mark in marks} == {"data"}
    assert marks == made(case)["marks"]


def decoded(payload: bytes) -> tuple[dict[str, Any], list[bytes]]:
    """A binary payload's header and buffers (see ``herceg._payload``)."""
    (length,) = struct.unpack_from("<I", payload)
    header = json.loads(payload[4 : 4 + length])
    start = -(-(4 + length) // 8) * 8
    return header, [payload[start + at : start + at + size] for at, size in header["buffers"]]


@pytest.mark.parametrize("case", drawn("transport"))
def test_widgets_streamlit_and_pages_carry_the_spec_as_it_is(case):
    chart = by_methods(case)
    spec, buffers = chart.to_spec()
    header, carried = decoded(web.payload(chart))
    assert (header["spec"], carried) == (spec, buffers)
    header, carried = decoded(hg_streamlit._payload(spec, buffers, []))
    assert (header["spec"], carried) == (spec, buffers)
    page = re.search(r"<template data-herceg-payload>(.*?)</template>", web.fragment(chart), re.S)
    assert page is not None
    inline = json.loads(
        page.group(1).replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    )
    assert inline["spec"] == spec
    assert [base64.b64decode(buffer) for buffer in inline["buffers"]] == buffers
    widget = pytest.importorskip("herceg.widget")
    snapshot = widget.ChartWidget(chart)._snapshot()
    assert (snapshot["spec"], snapshot["buffers"]) == (spec, buffers)
