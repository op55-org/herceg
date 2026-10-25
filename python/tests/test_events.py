"""The browser's interaction events as Python reads them: every event of the
engine's shared fixture decodes, and payloads of other shapes are refused."""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from herceg._events import ScaleView, decode_viewport_event

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = json.loads((ROOT / "packages/herceg/test/fixtures/viewport-events.json").read_text())


def _events() -> list[dict]:
    return [
        event
        for case in FIXTURE["cases"]
        for action in case["actions"]
        for event in action.get("events", [])
    ]


def test_every_event_of_the_engines_fixture_decodes():
    events = _events()
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
