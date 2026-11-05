"""Field displays' colors: mapping colors, missing colors, and thresholds
(``hg.Mapping(color=...)``, ``hg.Thresholds``), rules and regions at a
column's thresholds (``hg.AtThresholds``): their specs, what they refuse in
Python's names, what charts draw with them, and the schema taking the specs
Python writes."""

import json
import re
from pathlib import Path

import jsonschema
import pytest

import herceg as hg
from herceg._fields import fields_spec

SCHEMA = json.loads(
    (Path(__file__).parents[2] / "packages" / "herceg" / "spec.schema.json").read_text()
)
GREEN, AMBER, RED = "#2e7d32", "#f9a825", "#c62828"
LATENCY = {"t": [0, 1, 2], "p99": [100, 250, 640]}
STEPS = hg.Thresholds(base=GREEN, steps=[(200, AMBER), (500, RED)])


def test_colors_write_in_the_specs_names():
    spec = fields_spec(
        {
            "p99": hg.FieldDisplay(thresholds=STEPS, missing={"text": "n/a", "color": "#9e9e9e"}),
            "cpu": hg.FieldDisplay(
                min=0,
                max=100,
                thresholds={"mode": "percent", "steps": [{"value": 70, "color": RED}]},
            ),
            "status": hg.FieldDisplay(
                mappings=[
                    hg.Mapping(value="200", text="OK", color=GREEN),
                    hg.Mapping(regex=r"^5", color=RED),
                ]
            ),
        },
        "fields",
    )
    assert spec["p99"] == {
        "missing": {"text": "n/a", "color": "#9e9e9e"},
        "thresholds": {
            "base": GREEN,
            "steps": [{"value": 200, "color": AMBER}, {"value": 500, "color": RED}],
        },
    }
    assert spec["cpu"]["thresholds"] == {"mode": "percent", "steps": [{"value": 70, "color": RED}]}
    assert spec["status"]["mappings"] == [
        {"value": "200", "text": "OK", "color": GREEN},
        {"regex": "^5", "color": RED},
    ]
    chart = {"marks": [{"type": "line", "x": "t", "y": "p99"}], "fields": spec}
    jsonschema.validate(json.loads(json.dumps(chart)), SCHEMA)


@pytest.mark.parametrize(
    ("make", "message"),
    [
        (lambda: hg.Mapping(value="1", color=3), "Mapping color: expected a color; received 3"),
        (
            lambda: hg.Thresholds(steps=[]),
            "Thresholds steps: give at least one (value, color) step",
        ),
        (
            lambda: hg.Thresholds(steps=[(500, RED), (200, AMBER)]),
            "Thresholds steps[1]: steps ascend; 200 follows 500; order the steps by value",
        ),
        (
            lambda: hg.Thresholds(steps=[(200, None)]),
            "Thresholds steps[0][1]: expected a string; received None",
        ),
        (
            lambda: hg.Thresholds(steps=[("high", RED)]),
            'Thresholds steps[0] value: expected a finite number; received "high"',
        ),
        (
            lambda: hg.Thresholds(steps=[200]),
            "Thresholds steps[0]: expected (value, color); received 200",
        ),
        (
            lambda: hg.Thresholds(steps=[(1, RED)], mode="relative"),
            'Thresholds mode: expected "absolute" or "percent"; received "relative"',
        ),
        (
            lambda: hg.FieldDisplay(missing={}),
            "FieldDisplay missing: give text, color, or both",
        ),
        (
            lambda: hg.FieldDisplay(missing={"text": "n/a", "colour": RED}),
            'FieldDisplay missing: unknown key "colour"; name text or color',
        ),
        (
            lambda: hg.FieldDisplay(match=hg.Match(kind="category"), thresholds=STEPS),
            'FieldDisplay thresholds: this rule matches kind "category"; thresholds are for '
            "number fields; color categories with mappings",
        ),
        (lambda: hg.AtThresholds(3), "AtThresholds field: expected a column name; received 3"),
    ],
)
def test_colors_refuse_what_is_malformed_in_python_names(make, message):
    with pytest.raises(ValueError, match=re.escape(message)):
        make()


def test_threshold_places_name_their_tables_and_draw_in_their_steps_colors():
    fields = {"p99": hg.FieldDisplay(format=hg.Format(duration="millisecond"), thresholds=STEPS)}
    chart = (
        hg.Chart(LATENCY, fields=fields, width=600, height=300)
        .line(x="t", y="p99")
        .rule(y=hg.AtThresholds("p99", table=LATENCY), contribute_domain=True)
        .region(y=hg.AtThresholds("p99"), fill_opacity=0.12)
    )
    spec = chart.to_spec()[0]
    assert spec["marks"][1:] == [
        {"type": "rule", "y": {"thresholds": "p99", "table": "data"}, "contributeDomain": True},
        {"type": "region", "y": {"thresholds": "p99"}, "fillOpacity": 0.12},
    ]
    jsonschema.validate(json.loads(json.dumps(spec)), SCHEMA)
    svg = chart.to_svg()
    for color in (GREEN, AMBER, RED):
        assert color in svg


def test_threshold_places_refuse_rows_ranges_and_data_the_chart_does_not_draw():
    chart = hg.Chart(LATENCY).line(x="t", y="p99")
    with pytest.raises(ValueError, match=re.escape("rule y: rules at thresholds stand for steps")):
        chart.rule(y=hg.AtThresholds("p99"), label=hg.Label(field="t"), data=LATENCY)
    with pytest.raises(
        ValueError,
        match=re.escape("region: y places bands at thresholds, and y1 and y2 a range; give one"),
    ):
        chart.region(y=hg.AtThresholds("p99"), y1=0, y2=1)
    with pytest.raises(ValueError, match=re.escape("region: bands at thresholds go along x or")):
        chart.region(x=hg.AtThresholds("t"), y=hg.AtThresholds("p99"))
    with pytest.raises(ValueError, match=re.escape("region y: places bands at a column's")):
        chart.region(y=5)  # type: ignore[arg-type]
    elsewhere = hg.Chart(LATENCY).line(x="t", y="p99").rule(y=hg.AtThresholds("p99", table={}))
    with pytest.raises(
        ValueError, match=re.escape("AtThresholds table: the chart and its marks draw no such data")
    ):
        elsewhere.to_spec()
    with pytest.raises(ValueError, match=re.escape("a dragged rule stands at a number or a date")):
        chart.rule(y=hg.AtThresholds("p99"), drag=True)


def test_inspections_read_tooltip_fields_colors():
    from herceg._events import decode_inspection

    field = {"field": "p99", "label": "p99", "kind": "number", "value": 200, "text": "200ms"}
    point = {"label": "p99", "value": 200, "text": "200ms", "mark": 0, "key": "p99"}
    payload = {"axis": "x", "label": "", "points": [{**point, "fields": [field]}]}
    colored = {**payload, "points": [{**point, "fields": [{**field, "color": AMBER}]}]}
    assert decode_inspection(payload).points[0].fields[0].color is None  # type: ignore[union-attr]
    assert decode_inspection(colored).points[0].fields[0].color == AMBER  # type: ignore[union-attr]


def test_threshold_places_send_the_columns_they_read():
    data = {"t": [0, 1, 2], "v": [1, 2, 3], "limit": [10, 20, 30]}
    fields = {"limit": hg.FieldDisplay(thresholds=hg.Thresholds(steps=[(15, RED)]))}
    for place in (hg.AtThresholds("limit"), hg.AtThresholds("limit", table=data)):
        chart = (
            hg.Chart(data, fields=fields).line(x="t", y="v").rule(y=place, contribute_domain=True)
        )
        spec = chart.to_spec()[0]
        assert set(spec["data"]["data"]["columns"]) == {"t", "v", "limit"}
        assert RED in chart.to_svg()


def test_threshold_places_name_data_frames_among_several_tables():
    pd = pytest.importorskip("pandas")
    latency = pd.DataFrame(LATENCY)
    baseline = pd.DataFrame({"t": [0, 1, 2], "p99": [90, 150, 210]})
    fields = {"p99": hg.FieldDisplay(thresholds=STEPS)}
    chart = (
        hg.Chart(latency, fields=fields)
        .line(x="t", y="p99")
        .line(data=baseline, x="t", y="p99")
        .rule(y=hg.AtThresholds("p99", table=baseline), contribute_domain=True)
    )
    spec = chart.to_spec()[0]
    assert spec["marks"][2]["y"] == {"thresholds": "p99", "table": spec["marks"][1]["data"]}
    assert RED in chart.to_svg()


def test_threshold_places_follow_express_charts_made_again():
    pd = pytest.importorskip("pandas")
    import herceg.express as hx

    first = pd.DataFrame({"t": [0, 1, 2], "v": [1.0, 5.0, 9.0]})
    chart = hx.lineplot(first, x="t", y="v").rule(y=hg.AtThresholds("v", table=first))
    second = pd.DataFrame({"t": [0, 1, 2], "v": [2.0, 3.0, 8.0]})
    again = hx.recompute(chart, second)
    rule = again.to_spec()[0]["marks"][-1]
    assert rule == {"type": "rule", "y": {"thresholds": "v", "table": "data"}}
    assert again._marks[-1][0]["y"].table is second
    # Data a mark added later draws stays that data, in places as in the mark.
    drawn = (
        hx.lineplot(first, x="t", y="v")
        .line(data=first, x="t", y="v")
        .rule(y=hg.AtThresholds("v", table=first))
    )
    again = hx.recompute(drawn, second)
    assert again._marks[-1][0]["y"].table is first
    marks = again.to_spec()[0]["marks"]
    assert marks[-1]["y"]["table"] == marks[-2]["data"]
