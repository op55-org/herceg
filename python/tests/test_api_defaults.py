"""The API audit's defaults (test/contracts/fixtures/defaults.json), in
Python: a chart made without an option draws as one given its documented
default with Python's keyword, and otherwise than one given another value;
the keyword's own default leaves it to the spec (None) or is that value,
and the spec Python writes without it leaves the option out or gives the
default. The engine proves the same of its spec, in a local time zone
other than UTC (packages/herceg/test/contracts/defaults.test.ts)."""

import datetime as dt
import inspect
import json
import re
from pathlib import Path
from typing import Any

import pytest

import herceg as hg

FIXTURE = Path(__file__).parents[2] / "test" / "contracts" / "fixtures" / "defaults.json"
DEFAULTS = json.loads(FIXTURE.read_text())


def keyword(option: str) -> str:
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", option).lower()


def columns(table: str) -> dict[str, Any]:
    """The fixture's table, its time columns as datetimes."""
    return {
        name: [dt.datetime.fromisoformat(value) for value in column["values"]]
        if isinstance(column, dict)
        else column
        for name, column in DEFAULTS["tables"][table].items()
    }


def made(case: dict[str, Any], given: dict[str, Any]) -> hg.Chart:
    chart_options = given if case.get("at") == "chart" else {}
    chart = hg.Chart(columns(case["table"]), locale="en-US", **chart_options)
    call = case["python"]
    mark_options = {} if case.get("at") == "chart" else given
    getattr(chart, call["method"])(**call["args"], **mark_options)
    return chart


def drawn(case: dict[str, Any], given: dict[str, Any]) -> str:
    # Without the ids that tell one SVG's elements from another's.
    return re.sub(r"herceg-svg-\d+", "", made(case, given).to_svg())


@pytest.mark.parametrize(
    "case",
    [
        pytest.param(
            case, id=case["contract"], marks=pytest.mark.contract(f"{case['contract']}.python")
        )
        for case in DEFAULTS["defaults"]
    ],
)
def test_an_option_left_out_draws_as_its_default(case):
    name = keyword(case["option"])
    assert drawn(case, {}) == drawn(case, {name: case["value"]})
    assert drawn(case, {}) != drawn(case, {name: case["other"]})
    spec, _ = made(case, {}).to_spec()
    written = spec if case.get("at") == "chart" else spec["marks"][0]
    assert written.get(case["option"], case["value"]) == case["value"]
    takes = (
        hg.Chart.__init__
        if case.get("at") == "chart"
        else getattr(hg.Chart, case["python"]["method"])
    )
    own = inspect.signature(takes).parameters[name].default
    assert own is None or own == case["value"]
