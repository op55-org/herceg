"""Formats of durations, SI and binary prefixes, and text around number
patterns (``hg.Format``), and field displays (``hg.FieldDisplay``,
``hg.Match``, ``hg.Mapping``): their specs, what they refuse in Python's
names, what charts draw with the formats, and the schema taking the specs
Python writes."""

import datetime as dt
import json
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import jsonschema
import numpy as np
import pytest

import herceg as hg
from herceg._fields import fields_spec

USAGE = {"t": [0, 1, 2, 3], "ms": [450, 66_000, 95_000, 120_000], "bytes": [0, 1e6, 2e6, 1_572_864]}
SCHEMA = json.loads(
    (Path(__file__).parents[2] / "packages" / "herceg" / "spec.schema.json").read_text()
)


def texts(chart: hg.Chart) -> list[str]:
    root = ET.fromstring(chart.to_svg())
    return [t.text or "" for t in root.iter("{http://www.w3.org/2000/svg}text")]


def test_formats_write_each_forms_settings_in_the_specs_names():
    assert hg.Format(duration="millisecond", max_units=3, decimals=1)._spec() == {
        "duration": "millisecond",
        "maxUnits": 3,
        "decimals": 1,
    }
    assert hg.Format(si="B")._spec() == {"si": "B"}
    assert hg.Format(binary="B", decimals=2)._spec() == {"binary": "B", "decimals": 2}
    assert hg.Format(number=".3~s", prefix="~", suffix=" req/s")._spec() == {
        "number": ".3~s",
        "prefix": "~",
        "suffix": " req/s",
    }


def test_formats_draw_on_axes_tooltip_fields_and_gauges():
    chart = hg.Chart(
        USAGE, width=600, height=300, y=hg.AxisOptions(format=hg.Format(duration="millisecond"))
    ).line(
        x="t",
        y="ms",
        tooltip=hg.Tooltip(fields=[hg.TooltipField("bytes", format=hg.Format(binary="B"))]),
    )
    assert {"0ms", "20s", "1m", "1m 20s", "2m"} <= set(texts(chart))
    spec = chart.to_spec()[0]
    assert spec["marks"][0]["tooltip"]["fields"] == [{"field": "bytes", "format": {"binary": "B"}}]
    # Dicts of a form's settings, in the spec's names, are formats as well.
    dial = hg.Chart(USAGE).gauge(value="bytes", max=4e6, format={"si": "B"})
    assert dial.to_spec()[0]["marks"][0]["format"] == {"si": "B"}
    assert {"1.6 MB", "0 B", "4 MB"} <= set(texts(dial))


def test_formats_refuse_mixed_forms_and_other_forms_settings_in_python_names():
    with pytest.raises(ValueError, match="Format: give number, time, duration, si, or binary"):
        hg.Format(number=".2f", duration="second")
    with pytest.raises(
        ValueError, match="Format max_units: describes durations; give duration, or drop max_units"
    ):
        hg.Format(si="B", max_units=2)
    with pytest.raises(ValueError, match="Format suffix: "):
        hg.Format(binary="B", suffix="/s")
    with pytest.raises(ValueError, match='Format duration: expected one of "nanosecond", '):
        hg.Format(duration="ms")  # type: ignore[arg-type]
    with pytest.raises(ValueError, match="Format max_units: expected a whole number of units"):
        hg.Format(duration="second", max_units=0)
    with pytest.raises(ValueError, match="gauge format: a gauge writes numbers"):
        hg.Chart(USAGE).gauge(value="bytes", format=hg.Format(time="%H"))
    # Dicts of hg.Format's arguments are checked as hg.Format is, where they are given.
    with pytest.raises(ValueError, match="Format max_units: describes durations"):
        hg.AxisOptions(format={"si": "B", "max_units": 2})
    with pytest.raises(ValueError, match='TooltipField format: unknown key "maxUnits"'):
        hg.TooltipField("ms", format={"duration": "second", "maxUnits": 2})


def test_displays_write_rules_and_records_in_the_specs_names():
    rules = fields_spec(
        [
            hg.FieldDisplay(
                match=hg.Match(kind="number"), format=hg.Format(number=",.1f"), missing="–"
            ),
            hg.FieldDisplay(
                match=hg.Match(regex="^bytes_", kind=["number"]), format={"binary": "B"}
            ),
            hg.FieldDisplay(match="bytes_out", label="Sent"),
            {"match": {"table": "quotas", "field": ["bytes_in"]}, "label": "Quota"},
            hg.FieldDisplay(match="bytes_quota", format=False, label=False, mappings=False),
            {"missing": "n/a"},
        ],
        "fields",
    )
    assert rules == [
        {"match": {"kind": "number"}, "format": {"number": ",.1f"}, "missing": "–"},
        {"match": {"regex": "^bytes_", "kind": ["number"]}, "format": {"binary": "B"}},
        {"match": "bytes_out", "label": "Sent"},
        {"match": {"field": ["bytes_in"], "table": "quotas"}, "label": "Quota"},
        {"match": "bytes_quota", "label": False, "format": False, "mappings": False},
        {"missing": "n/a"},
    ]
    record = fields_spec(
        {
            "latency": hg.FieldDisplay(
                label="Latency",
                description="Time to the last byte.",
                format=hg.Format(duration="millisecond"),
                min=0,
                max=120_000,
            ),
            "status": {
                "mappings": [
                    hg.Mapping(value="200", text="OK"),
                    hg.Mapping(regex=r"^5(\d\d)$", text="Server error $1"),
                ]
            },
            "score": hg.FieldDisplay(mappings=[hg.Mapping(between=(0.9, None), text="Healthy")]),
            "t": hg.FieldDisplay(
                mappings=[hg.Mapping(value=dt.datetime(2026, 1, 1), text="New year")]
            ),
        },
        "fields",
    )
    assert record["latency"] == {
        "label": "Latency",
        "description": "Time to the last byte.",
        "format": {"duration": "millisecond"},
        "min": 0,
        "max": 120_000,
    }
    assert record["status"]["mappings"][1] == {"regex": r"^5(\d\d)$", "text": "Server error $1"}
    assert record["score"] == {"mappings": [{"between": [0.9, None], "text": "Healthy"}]}
    # Times are epoch milliseconds, as everywhere in the spec.
    assert record["t"]["mappings"][0]["value"] == 1_767_225_600_000
    # The schema takes what Python writes.
    for fields in (rules, record):
        spec = {"marks": [{"type": "line", "x": "t", "y": "v"}], "fields": fields}
        jsonschema.validate(json.loads(json.dumps(spec)), SCHEMA)


@pytest.mark.parametrize(
    ("make", "message"),
    [
        (
            lambda: hg.FieldDisplay(min=120_000, max=0),
            "FieldDisplay min: 120000 is not below max 0",
        ),
        (
            lambda: hg.FieldDisplay(match=3),
            "FieldDisplay match: expected a column name or an hg.Match",
        ),
        (
            lambda: hg.FieldDisplay(label=3),
            "FieldDisplay label: expected text or False; received 3",
        ),
        (
            lambda: hg.FieldDisplay(mappings="OK"),
            'FieldDisplay mappings: expected a list of hg.Mapping, or False; received "OK"',
        ),
        (lambda: hg.Match(kind="geometry"), 'Match kind: expected "number", "time", or "category"'),
        (lambda: hg.Match(), "Match: matches every column; give field, regex, kind, or table"),
        (
            lambda: hg.Mapping(value="1", regex="1", text="a"),
            "Mapping: give value, between, or regex, one of them",
        ),
        (
            lambda: hg.Mapping(between=0.9, text="a"),
            "Mapping between: expected (from, to), None for an open end; received 0.9",
        ),
        (
            lambda: hg.Mapping(between=(0.9, 0.5), text="a"),
            "Mapping between: 0.9 is above 0.5; give from, then to",
        ),
        (lambda: hg.Mapping(value="1"), "Mapping text: expected text; received None"),
        (
            lambda: hg.FieldDisplay(
                match=hg.Match(kind="time"), format=hg.Format(duration="second")
            ),
            'FieldDisplay format: this rule matches kind "time"; give hg.Format',
        ),
        (
            lambda: hg.FieldDisplay(match=hg.Match(kind="category"), min=0),
            'FieldDisplay min: this rule matches kind "category"; bounds are for numbers',
        ),
        (
            lambda: hg.FieldDisplay(
                match=hg.Match(kind="number"), mappings=[hg.Mapping(regex="x", text="y")]
            ),
            'FieldDisplay mappings[0] regex: this rule matches kind "number"',
        ),
        (
            lambda: fields_spec({"x": hg.FieldDisplay(match="x")}, "fields"),
            "fields.x: a display by column name has no match; give rules as a list",
        ),
        (
            lambda: fields_spec("latency", "fields"),
            "fields: expected displays by column name, or a list of hg.FieldDisplay",
        ),
    ],
)
def test_displays_refuse_what_is_malformed_in_python_names(make, message):
    with pytest.raises(ValueError, match=re.escape(message)):
        make()


def test_matches_mappings_and_formats_refuse_what_typescript_refuses():
    for kind in ([], 1, ["number", "geometry"]):
        with pytest.raises(ValueError, match="Match kind: expected"):
            hg.Match(kind=kind)  # type: ignore[arg-type]
    # A missing time matches nothing: missing= says how missing values read.
    with pytest.raises(ValueError, match="Mapping value: a missing time matches nothing"):
        hg.Mapping(value=np.datetime64("NaT", "ms"), text="none")
    with pytest.raises(ValueError, match="Mapping between: a missing time matches nothing"):
        hg.Mapping(between=(np.datetime64("NaT", "ms"), None), text="none")
    with pytest.raises(ValueError, match='"maximumFractionDigts" is not an Intl format option'):
        hg.FieldDisplay(format={"maximumFractionDigts": 1})
    # Intl options take the kinds whose formatters take every option given.
    assert hg.FieldDisplay(match=hg.Match(kind="time"), format={"timeZone": "UTC"})._spec()
    with pytest.raises(ValueError, match='this rule matches kind "number"; give a number format'):
        hg.FieldDisplay(match=hg.Match(kind="number"), format={"timeZone": "UTC"})


def test_tooltip_fields_take_their_kinds_formats():
    data = {"t": [dt.datetime(2026, 1, 1)], "ms": [66_000.0], "service": ["api"]}
    for field, format, message in (
        ("t", hg.Format(duration="millisecond"), '"t" holds times; give hg.Format(time=...)'),
        ("ms", hg.Format(time="%H:%M"), '"ms" holds numbers; give a number format'),
        ("service", {"maximumFractionDigits": 0}, '"service" holds categories; formats are'),
    ):
        tooltip = hg.Tooltip(fields=[hg.TooltipField(field, format=format)])
        with pytest.raises(
            ValueError, match=re.escape(f"line tooltip fields[0] format: {message}")
        ):
            hg.Chart(data).line(x="t", y="ms", tooltip=tooltip)


def test_kind_rules_refuse_only_what_none_of_their_kinds_takes():
    # Bounds are for numbers, so a rule matching numbers or categories may give them.
    rule = hg.FieldDisplay(match=hg.Match(kind=["category", "number"]), min=0)
    assert rule._spec() == {"match": {"kind": ["category", "number"]}, "min": 0}
    # A rule naming columns is checked against the data, not here.
    named = hg.FieldDisplay(match=hg.Match(field="host", kind="category"), min=0)
    assert named._spec()["min"] == 0
