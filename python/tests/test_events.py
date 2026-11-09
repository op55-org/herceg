"""The browser's interaction events as Python reads them: every event of the
engine's shared fixture decodes, and payloads of other shapes are refused."""

from __future__ import annotations

import copy
import json
from datetime import timedelta
from pathlib import Path

import pytest

from herceg import ItemReference, SeriesReference
from herceg._events import (
    _EPOCH,
    IntervalGroup,
    LegendEntryTarget,
    Provenance,
    ScaleView,
    ValueGroup,
    decode_input_event,
    decode_inspection,
    decode_viewport_event,
)

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "packages/herceg/test/fixtures/viewport-events.json").read_text())


#: The fixture's cases the capability matrix holds Python to (test/contracts/interaction.json).
DECLARED = set(json.loads((ROOT / "test/contracts/interaction.json").read_text())["fixture"])


def _events_of(case: dict) -> list[dict]:
    return [event for action in case["actions"] for event in action.get("events", [])]


def _events() -> list[dict]:
    return [event for case in FIXTURE["cases"] for event in _events_of(case)]


@pytest.mark.parametrize(
    "case",
    [
        pytest.param(
            case,
            id=case["contract"],
            marks=[pytest.mark.contract(f"{case['contract']}.python")]
            if case["contract"] in DECLARED
            else [],
        )
        for case in FIXTURE["cases"]
    ],
)
def test_every_event_of_the_engines_fixture_decodes(case):
    events = _events_of(case)
    assert events
    for payload in events:
        event = decode_viewport_event(payload)
        assert event.view_revision == payload["viewRevision"]
        assert event.cause == payload["cause"]
        assert [(s.scale, s.instance) for s in event.scales] == [
            ({"yRight": "y_right"}.get(s["scale"], s["scale"]), s["instance"])
            for s in payload["scales"]
        ]
        assert all(isinstance(s, ScaleView) for s in event.scales)
        assert set(event.views) == {view["panel"] for view in payload["views"]}


def _event() -> dict:
    return copy.deepcopy(_events()[0])


@pytest.mark.parametrize(
    "broken",
    [
        lambda e: e["scales"][0].update(scale=[]),
        lambda e: e["scales"][0].update(scale="z"),
        lambda e: e["scales"][0].pop("view"),
        lambda e: e["scales"][0].update(view=[3, 1]),
        lambda e: e["scales"][0].update(view=[1]),
        lambda e: e["scales"][0].update(panels="a"),
        lambda e: e.update(cause="drag"),
        lambda e: e.update(viewRevision=-1),
        lambda e: e.update(views={}),
    ],
)
def test_payloads_of_other_shapes_are_refused(broken):
    payload = _event()
    broken(payload)
    with pytest.raises(ValueError):
        decode_viewport_event(payload)


PROVENANCE = json.loads((ROOT / "packages/herceg/test/fixtures/provenance-events.json").read_text())


def _clicked(provenance: dict) -> dict:
    """A click's payload whose target carries `provenance`, as the browser writes it."""
    target = {
        "kind": "item",
        "mark": 0,
        "markId": None,
        "item": "[0]",
        "series": None,
        "row": None,
        "panel": "",
        "box": {"x": 0, "y": 0, "width": 1, "height": 1},
        "provenance": provenance,
    }
    return {
        "pointer": None,
        "target": target,
        "inspection": None,
        "cause": "pointer",
        "revision": 1,
    }


@pytest.mark.parametrize(
    "case",
    [
        pytest.param(
            case,
            id=case["contract"],
            marks=[pytest.mark.contract(f"{case['contract']}.python")]
            if case["contract"] in DECLARED
            else [],
        )
        for case in PROVENANCE["cases"]
    ],
)
def test_provenance_reads_the_expressions_the_browser_writes(case):
    written = case["provenance"]
    provenance = decode_input_event(_clicked(written)).target.provenance
    assert isinstance(provenance, Provenance)
    assert provenance.condition is not None
    assert provenance.condition.to_json() == written["condition"]
    if written["source"] is None:
        assert provenance.source is None
    else:
        assert provenance.source.table == written["source"]["table"]
        condition = provenance.source.condition
        assert (None if condition is None else condition.to_json()) == written["source"][
            "condition"
        ]
    for group, json_group in zip(provenance.groups, written["groups"], strict=True):
        assert group.field == json_group["field"]
        if "value" in json_group:
            assert isinstance(group, ValueGroup)
            if json_group.get("time"):
                assert group.value == _EPOCH + timedelta(milliseconds=json_group["value"])
            else:
                assert group.value == json_group["value"]
        else:
            assert isinstance(group, IntervalGroup)
            assert (group.start, group.end, group.closed) == (
                json_group["from"],
                json_group["to"],
                json_group.get("closed", False),
            )


def test_hover_targets_carry_no_provenance():
    payload = _clicked({"groups": [], "condition": None, "source": None})
    del payload["target"]["provenance"]
    assert decode_input_event(payload).target.provenance is None
    with pytest.raises(ValueError):
        decode_input_event(_clicked({"groups": [{"field": 1}], "condition": None, "source": None}))


@pytest.mark.contract("inspection.names.python")
def test_inspected_layout_items_carry_their_names():
    point = {"mark": 0, "key": '[0,"Europe","France"]', "label": "Europe / France", "text": "40"}
    inspection = {"axis": "item", "value": 40, "label": "revenue", "points": [point]}
    named = {**inspection, "points": [{**point, "names": ["Europe", "France"]}]}
    assert decode_inspection(named).points[0].names == ("Europe", "France")  # type: ignore[union-attr]
    # Points of series, and of other layouts, have none.
    assert decode_inspection(inspection).points[0].names is None  # type: ignore[union-attr]


def _legend_click(references: object) -> dict:
    """A click on a legend entry, as the browser writes it."""
    target = {"kind": "legendEntry", "key": '["lines","v"]', "label": "v", "panel": None}
    return {
        "pointer": None,
        "target": {**target, "references": references},
        "inspection": None,
        "cause": "pointer",
        "revision": 1,
    }


def test_legend_entry_targets_name_what_they_stand_for():
    # The payload the front ends' tests read from a line and an area of one series
    # (python/js/test/surfaces.test.ts), and a pie's slice.
    written = [
        {"mark": "bands", "series": "v"},
        {"mark": "lines", "series": "v"},
        {"mark": "shares", "item": ["slice", [0, 5]]},
    ]
    target = decode_input_event(_legend_click(written)).target
    assert isinstance(target, LegendEntryTarget)
    assert target.references == (
        SeriesReference("bands", "v"),
        SeriesReference("lines", "v"),
        ItemReference("shares", ("slice", (0, 5))),
    )
    assert decode_input_event(_legend_click([])).target.references == ()
    for broken in (None, [{"series": "v"}], ["lines"]):
        with pytest.raises(ValueError, match="legendEntry target references"):
            decode_input_event(_legend_click(broken))
