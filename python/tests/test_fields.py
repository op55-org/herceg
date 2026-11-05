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


HOSTS = {
    "t": [0, 1, 2, 3],
    "ms": [450, 66_000, 95_000, 120_000],
    "host": ["a", "b", "a", "b"],
}
DISPLAYS = {
    "ms": hg.FieldDisplay(label="Latency", format=hg.Format(duration="millisecond")),
    "host": hg.FieldDisplay(mappings=[hg.Mapping(value="a", text="Alpha")]),
}


def test_charts_and_helpers_take_fields_and_draw_through_them():
    chart = hg.Chart(HOSTS, fields=DISPLAYS, width=500, height=300).line(
        x="t", y="ms", series="host"
    )
    assert chart.to_spec()[0]["fields"] == {
        "ms": {"label": "Latency", "format": {"duration": "millisecond"}},
        "host": {"mappings": [{"value": "a", "text": "Alpha"}]},
    }
    drawn = set(texts(chart))
    assert {"1m", "2m", "Alpha"} <= drawn
    assert "a" not in drawn
    helper = hg.line(HOSTS, x="t", y="ms", fields={"ms": {"label": "Latency"}})
    assert helper.to_spec()[0]["fields"] == {"ms": {"label": "Latency"}}
    # One series has no legend; the text alternative names it.
    assert "Latency: 4 points" in helper.to_svg()


def test_matches_name_data_as_the_charts_tables():
    other = {"t": [0, 1], "ms": [1, 2]}
    rule = hg.FieldDisplay(match=hg.Match(field="ms", table=other), label="Other")
    chart = hg.Chart(HOSTS, fields=[rule]).line(x="t", y="ms").line(x="t", y="ms", data=other)
    assert chart.to_spec()[0]["fields"] == [
        {"match": {"field": "ms", "table": "data2"}, "label": "Other"}
    ]
    unknown = hg.Chart(HOSTS, fields=[rule]).line(x="t", y="ms")
    with pytest.raises(hg.ChartError) as error:
        unknown.to_spec()
    assert str(error.value).startswith("Match table: the chart and its marks draw no such data")
    assert error.value.path == "fields[0].match.table"
    with pytest.raises(hg.ChartError, match=r"^FieldDisplay min: 5 is not below max 1") as bad:
        hg.Chart(HOSTS, fields=[{"min": 5, "max": 1}])
    assert bad.value.path == "fields[0].min"


def test_series_names_and_axis_titles_take_label_parts():
    chart = hg.Chart(
        HOSTS,
        fields=DISPLAYS,
        width=500,
        height=300,
        y=hg.AxisOptions(title=[hg.LabelPart(label="ms"), " (p99)"]),
    ).line(x="t", y="ms", series="host", label=[hg.LabelPart(series=True), " ", {"label": "ms"}])
    spec = chart.to_spec()[0]
    assert spec["y"]["title"] == [{"label": "ms"}, " (p99)"]
    assert spec["marks"][0]["label"] == [{"series": True}, " ", {"label": "ms"}]
    assert {"Latency (p99)", "Alpha Latency", "b Latency"} <= set(texts(chart))
    bar = hg.Chart(HOSTS, fields=DISPLAYS).bar(
        x="host", y="ms", labels={"content": [hg.LabelPart(label="ms"), ": ", {"value": True}]}
    )
    assert "Latency: 2m" in texts(bar)


@pytest.mark.parametrize(
    ("label", "message", "path"),
    [
        (
            [hg.LabelPart(value=True)],
            "line label[0]: a series' name has no value; use hg.LabelPart(series=True), "
            "(field=...), or (label=...)",
            "marks[0].label[0]",
        ),
        (
            [hg.LabelPart(label="nope")],
            "line label[0].label: no column 'nope'",
            "marks[0].label[0].label",
        ),
        (
            [hg.LabelPart(series=True, style={"color": "red"})],
            "line label[0] style: a name is written in the legend's and tooltip's look; drop style",
            "marks[0].label[0].style",
        ),
        ([], "line label: expected text, or a list of parts", "marks[0].label"),
    ],
)
def test_series_names_refuse_parts_a_name_cannot_read(label, message, path):
    with pytest.raises(hg.ChartError) as error:
        hg.Chart(HOSTS).line(x="t", y="ms", series="host", label=label)
    assert str(error.value).startswith(message)
    assert error.value.path == path


def test_axis_titles_send_the_columns_their_labels_name():
    data = {**HOSTS, "p50": [1, 2, 3, 4]}
    displays = {**DISPLAYS, "p50": hg.FieldDisplay(label="Median")}
    title = [hg.LabelPart(label="ms"), " and ", hg.LabelPart(label="p50")]
    for chart in (
        hg.Chart(data, fields=displays, y=hg.AxisOptions(title=title)).line(x="t", y="ms"),
        hg.Chart(data, fields=displays, guides=[hg.AxisGuide(scale="y", title=title)]).line(
            x="t", y="ms"
        ),
    ):
        assert "p50" in chart.to_spec()[0]["data"]["data"]["columns"]
        assert "Latency and Median" in texts(chart)
    # Without displays a label is the column's name, so the column stays home.
    plain = hg.Chart(data, y=hg.AxisOptions(title=title)).line(x="t", y="ms")
    assert "p50" not in plain.to_spec()[0]["data"]["data"]["columns"]


def test_tree_labels_refuse_columns_labels():
    with pytest.raises(hg.ChartError, match=r"TreemapLabels content\[0\]: tree labels write"):
        hg.TreemapLabels(content=[hg.LabelPart(label="v")])


def test_panel_and_z_axis_titles_are_text():
    part = [hg.LabelPart(label="ms"), " p99"]
    panel = hg.Panel(id="p", x=hg.AxisOptions(title=part))
    with pytest.raises(hg.ChartError, match="Panel x title: a panel's own axis title"):
        hg.Chart(HOSTS, panels=[panel]).line(x="t", y="ms", panel="p").to_spec()
    with pytest.raises(hg.ChartError, match="Chart z title: a panel's own axis title"):
        hg.Chart(HOSTS, z=hg.AxisOptions(title=part)).point_3d(x="t", y="ms", z="ms").to_spec()


def test_axis_titles_and_label_parts_refuse_what_they_cannot_read():
    with pytest.raises(hg.ChartError, match=r"^AxisOptions title\[0\]: an axis' title names"):
        hg.Chart(HOSTS, y=hg.AxisOptions(title=[hg.LabelPart(series=True)])).line(x="t", y="ms")
    with pytest.raises(hg.ChartError, match=r"^LabelPart format: a column's label is written"):
        hg.LabelPart(label="ms", format=hg.Format(number=".1f"))
    with pytest.raises(hg.ChartError, match=r"^LabelPart: give field, series=True, value=True, or"):
        hg.LabelPart(label="ms", field="ms")
    with pytest.raises(hg.ChartError, match=r"^radar fields"):
        hg.radar(HOSTS, fields={"ms": hg.FieldDisplay(label="Latency")})  # type: ignore[arg-type]


def test_express_titles_and_single_series_by_labels_where_the_chart_has_fields():
    import herceg.express as hx

    plain = hx.lineplot(HOSTS, x="t", y="ms").to_spec()[0]
    assert plain["y"]["title"] == "ms"
    labeled = hx.lineplot(HOSTS, x="t", y="ms", fields=DISPLAYS)
    spec = labeled.to_spec()[0]
    assert spec["y"]["title"] == [{"label": "ms"}]
    # The line and its band share one entry, keyed by the column whatever its label.
    assert [mark.get("label") for mark in spec["marks"]] == [[{"label": "ms"}]] * 2
    assert "Latency" in texts(labeled)


def test_live_charts_change_fields():
    from herceg._live import LiveChart

    live = LiveChart(hg.Chart(HOSTS, fields=DISPLAYS).line(x="t", y="ms"))
    message = live.update({"fields": {"ms": hg.FieldDisplay(label="p99")}})
    assert message == ({"type": "options", "options": {"fields": {"ms": {"label": "p99"}}}}, [])
    assert live.to_spec()[0]["fields"] == {"ms": {"label": "p99"}}


def test_live_charts_match_the_data_they_adopt():
    from herceg._live import LiveChart

    live = LiveChart(hg.Chart(HOSTS, fields=DISPLAYS).line(x="t", y="ms"))
    other = dict(HOSTS)
    assert live.adopt(LiveChart(hg.Chart(other, fields=DISPLAYS).line(x="t", y="ms"))) is None
    rules = [hg.FieldDisplay(match=hg.Match(table=other, field="ms"), label="Latency")]
    message = live.update({"fields": rules})
    assert message is not None
    assert message[0]["options"]["fields"][0]["match"]["field"] == "ms"
    with pytest.raises(hg.ChartError, match="draw no such data"):
        live.update({"fields": [hg.FieldDisplay(match=hg.Match(table=HOSTS), label="Old")]})


def test_express_applies_rules_naming_its_data_to_the_table_it_computes():
    import herceg.express as hx

    rules = [hg.FieldDisplay(match=hg.Match(table=HOSTS, field="ms"), label="Latency")]
    chart = hx.lineplot(HOSTS, x="t", y="ms", fields=rules)
    spec = chart.to_spec()[0]
    assert spec["fields"][0]["match"] == {"table": spec["marks"][0]["data"], "field": "ms"}
    assert "Latency" in texts(chart)
    # Recomputed from other data, the rules name the data they name.
    with pytest.raises(hg.ChartError, match="draw no such data"):
        hx.recompute(chart, dict(HOSTS)).to_spec()
    # Recomputed from the same data, they still name it: the call keeps it, uncopied.
    for rule in (rules[0], {"match": {"table": HOSTS, "field": "ms"}, "label": "Latency"}):
        again = hx.recompute(hx.lineplot(HOSTS, x="t", y="ms", fields=[rule]), HOSTS)
        assert again.to_spec()[0]["fields"][0]["label"] == "Latency"
    # A column named "table" is a display like any other, copied with the call.
    displays = {"table": {"label": "Original"}}
    made = hx.lineplot(HOSTS, x="t", y="ms", fields=displays)
    displays["table"]["label"] = "Changed"
    assert hx.recompute(made, HOSTS).to_spec()[0]["fields"] == {"table": {"label": "Original"}}


def test_gauges_check_bands_against_the_ends_their_value_column_may_give():
    loads = {"load": [1200.0, 3400.0]}
    displays = {"load": hg.FieldDisplay(min=0, max=5000)}
    spec = hg.Chart(loads, fields=displays).gauge("load", bands=[1000, 5000]).to_spec()[0]
    assert spec["marks"][0]["bands"] == [{"to": 1000.0}, {"to": 5000.0}]
    # Without displays, the dial runs from 0 to 100.
    with pytest.raises(hg.ChartError, match=r"at most max \(100\); received 1000"):
        hg.Chart(loads).gauge("load", bands=[1000, 5000])
    assert "5,000" in texts(hg.Chart(loads, fields=displays).gauge("load", bands=[1000, 5000]))
    # An end the gauge gives is checked against the other only where it gives both.
    assert (
        hg.Chart(loads, fields=displays).gauge("load", min=200).to_spec()[0]["marks"][0]["min"]
        == 200
    )
    with pytest.raises(hg.ChartError, match=r"^gauge min: expected a finite min below"):
        hg.Chart(loads, fields=displays).gauge("load", min=300, max=200)


SALES = {
    "region": ["eu", "as", "eu", "am"],
    "country": ["fr", "jp", "es", "us"],
    "revenue": [40_000, 30_000, 20_000, 10_000],
}
REGIONS = {
    "region": hg.FieldDisplay(
        label="Region",
        mappings=[
            hg.Mapping(value="eu", text="Europe"),
            hg.Mapping(value="as", text="Asia"),
            hg.Mapping(value="am", text="Americas"),
        ],
    ),
    "revenue": hg.FieldDisplay(label="Revenue", format=hg.Format(number=",.0f", prefix="$")),
}


def test_layout_marks_name_their_items_through_the_displays():
    pie = hg.Chart(SALES, fields=REGIONS, width=500, height=300).pie("region", "revenue")
    drawn = set(texts(pie))
    assert {"Europe", "Asia"} <= drawn
    assert "eu" not in drawn
    assert "Pie of Revenue by Region: 3 slices totaling $100,000." in pie.to_svg()
    tree = hg.Chart(SALES, fields=REGIONS, width=500, height=300).treemap(
        ["region", "country"], "revenue"
    )
    assert "Europe" in texts(tree)
    assert "Treemap of Revenue by Region / country" in tree.to_svg()
    flows = {"from": ["a", "a"], "to": ["b", "c"], "amount": [5, 3]}
    names = hg.FieldDisplay(
        match=hg.Match(field=["from", "to"]),
        mappings=[hg.Mapping(value="a", text="Coal"), hg.Mapping(value="b", text="Power")],
    )
    sankey = hg.Chart(flows, fields=[names], width=500, height=300).sankey("from", "to", "amount")
    assert {"Coal 8", "Power 5", "c 3"} <= set(texts(sankey))
