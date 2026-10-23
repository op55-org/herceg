"""The spec's contracts the Python package and the engine both keep, read
from the engine's fixture (packages/herceg/test/fixtures/contracts.json):
the same charts made with the builders refuse what the engine refuses, by
the same code and path, and otherwise make the engine's spec; and export
settings plan what the engine's plan."""

import datetime as dt
import json
import math
from pathlib import Path
from typing import Any

import pytest

import herceg as hg
from herceg import _pending
from herceg._export import plan_export

FIXTURE = Path(__file__).parents[2] / "packages" / "herceg" / "test" / "fixtures" / "contracts.json"
CONTRACTS = json.loads(FIXTURE.read_text())


def built(value: Any) -> Any:
    """``value`` with each ``{"hg": name, "args": ...}`` made into herceg's ``name``."""
    if isinstance(value, dict):
        if "hg" in value:
            return getattr(hg, value["hg"])(**built(value["args"]))
        return {key: built(item) for key, item in value.items()}
    if isinstance(value, list):
        return [built(item) for item in value]
    return value


def cases(group: str) -> list[Any]:
    return [
        pytest.param(
            case, id=case["name"], marks=pytest.mark.contract(f"{case['contract']}.python")
        )
        for case in CONTRACTS[group]
        if group == "exports" or "builder" in case
    ]


def made(case: dict[str, Any]) -> dict[str, Any]:
    """The spec the case's chart makes in Python."""
    builder = case["builder"]
    chart = hg.Chart(CONTRACTS["data"], **built(builder.get("chart", {})))
    for call in builder["calls"]:
        getattr(chart, call["method"])(**built(call["args"]))
    spec, _ = chart.to_spec()
    # Python's marks of rows name their table, the engine's default one here.
    for mark in spec["marks"]:
        assert mark.pop("data", "data") == "data"
    return spec


@pytest.mark.parametrize("case", cases("cases"))
def test_spec_contracts(case, monkeypatch):
    if "code" in case:
        with pytest.raises(hg.ChartError) as raised:
            made(case)
        error = raised.value
        assert (error.code, error.path) == (case["code"], case.get("python_path", case["path"]))
        assert case["python"] in str(error)
        if "pending" not in case or case.get("builder_spec") is False:
            return
        assert f"(round 2 stream {case['pending']} adds it)" in str(error)
        # What it refuses for now, the builders already write as the engine reads it.
        monkeypatch.setattr(_pending, "refuse", lambda *_: None)
    spec = made(case)
    for key, value in case["spec"].items():
        assert spec[key] == value, key


@pytest.mark.parametrize("case", cases("exports"))
def test_export_settings(case):
    if "plan" not in case:
        with pytest.raises(hg.ChartError) as raised:
            plan_export(tuple(case["chart"]), **case["settings"])
        error = raised.value
        assert (error.code, error.path) == (case["code"], case["path"])
        assert case["message"] in str(error)
        return
    plan = plan_export(tuple(case["chart"]), **case["settings"])
    for key, value in case["plan"].items():
        made = getattr(plan, key)
        if isinstance(value, list):
            assert list(made) == pytest.approx(value), key
        elif isinstance(value, float | int) and not isinstance(value, bool):
            assert math.isclose(made, value, abs_tol=1e-9), key
        else:
            assert made == value, key


@pytest.mark.contract("scale.settings.malformed.python")
def test_malformed_settings_are_refused_at_their_paths():
    # What the fixture's JSON cannot hold, and settings of subplots.
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(CONTRACTS["data"], x={"grid": {"z_index": math.nan}})
    assert (raised.value.code, raised.value.path) == ("invalid-option", "x.grid.z_index")
    first, second = hg.Chart(CONTRACTS["data"]).columns(2)
    first.panel("a")
    with pytest.raises(hg.ChartError) as raised:
        second.panel("b", y={"padding": 0.7})
    assert (raised.value.code, raised.value.path) == ("invalid-option", "panels[1].y.padding")


@pytest.mark.contract("scale.scope.forms.python")
def test_scales_take_their_scopes_alike_as_dicts_and_objects():
    # Positions take layouts' rows and columns; categories a chart or a panel.
    for scope in ("row", "column", {"panels": ["a"]}):
        as_dict = hg.Chart(CONTRACTS["data"], scales={"y": {"scope": scope}})
        as_object = hg.Chart(CONTRACTS["data"], scales={"y": hg.Scale(scope=scope)})
        assert as_dict._options["scales"] == as_object._options["scales"]
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(CONTRACTS["data"], scales={"regions": {"scope": "row"}})
    assert (raised.value.code, raised.value.path) == ("invalid-option", "scales.regions.scope")


@pytest.mark.contract("label.part.flag-forms.python")
def test_label_parts_take_true_itself_as_a_flag():
    # 1 equals True, but is no flag: as objects and as dicts alike.
    for flag in ("value", "series"):
        with pytest.raises(TypeError, match=f"LabelPart {flag}: expected True"):
            hg.LabelPart(**{flag: 1})
        with pytest.raises(hg.ChartError) as raised:
            hg.Chart(CONTRACTS["data"]).bar("region", "v", labels={"content": [{flag: 1}]})
        assert raised.value.path == f"marks[0].labels.content[0].{flag}"


@pytest.mark.contract("position.coordinate.malformed.python")
def test_coordinates_and_targets_refuse_what_they_cannot_be_as_they_are_made():
    # Before any chart, so before what round 2 does not draw yet is refused.
    with pytest.raises(TypeError, match="DataPosition field: expected a column name"):
        hg.DataPosition(field=3)
    for value in (True, math.nan, math.inf, [1]):
        with pytest.raises(TypeError, match="DataPosition value: expected a"):
            hg.DataPosition(value=value)
    hg.DataPosition(value="eu")
    hg.DataPosition(value=dt.datetime(2026, 1, 1))
    for make in (hg.Fraction, hg.Pixels):
        with pytest.raises(TypeError, match="offset: expected a finite number of pixels"):
            make(field="v", offset=math.nan)
    # A list of values, not an iterator that checking them would use up.
    with pytest.raises(TypeError, match="LegendTarget values: expected a list of values"):
        hg.LegendTarget(scale="s", values=iter(["eu"]))


@pytest.mark.contract("text.vertical-align.panels.python")
def test_panels_styles_are_checked_at_their_paths():
    # Panels given to the chart, and panels its layout makes.
    bad = {"text": "A", "style": {"vertical_align": "bad"}}
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(CONTRACTS["data"], panels=[hg.Panel("a", title=bad)])
    assert raised.value.path == "panels[0].title.style.vertical_align"
    first, second = hg.Chart(CONTRACTS["data"]).columns(2)
    first.panel("a")
    with pytest.raises(hg.ChartError) as raised:
        second.panel("b", y={"style": {"tick_label": {"vertical_align": "bad"}}})
    assert raised.value.path == "panels[1].y.style.tick_label.vertical_align"
