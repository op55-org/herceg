"""Links of field displays (``hg.Link``): their specs, what they refuse in
Python's names, the columns charts send for them (through derived tables,
and none for rules matching no column sent), events' ``InspectedField.link``,
and export, where tooltips are not drawn."""

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
DATA = {
    "t": [0, 1, 2],
    "p99": [120.0, 340.0, 250.0],
    "trace": ["4bf92f35", "a b", "c"],
    "span": ["s1", "s2", "s3"],
    "host": ["db-1", "db-2", "db-1"],
}
TRACE = hg.Link(
    url=["https://traces.example.com/", hg.LabelPart(value=True), "?span=", {"field": "span"}],
    text=["Trace ", hg.LabelPart(value=True)],
)


def columns(chart: hg.Chart, table: str = "data") -> set[str]:
    return set(chart.to_spec()[0]["data"][table]["columns"])


def test_links_write_in_the_specs_names():
    spec = fields_spec(
        {"trace": hg.FieldDisplay(label="Trace", link=TRACE), "host": {"link": {"url": "/hosts"}}},
        "Chart fields",
    )
    assert spec == {
        "trace": {
            "label": "Trace",
            "link": {
                "url": [
                    "https://traces.example.com/",
                    {"value": True},
                    "?span=",
                    {"field": "span"},
                ],
                "text": ["Trace ", {"value": True}],
            },
        },
        "host": {"link": {"url": "/hosts"}},
    }
    assert fields_spec([hg.FieldDisplay(match="trace", link=False)], "f") == [
        {"match": "trace", "link": False}
    ]
    chart = hg.Chart(DATA, fields={"trace": hg.FieldDisplay(link=TRACE)}).line(x="t", y="p99")
    jsonschema.validate(chart.to_spec()[0], SCHEMA)


@pytest.mark.parametrize(
    ("make", "message"),
    [
        (
            lambda: hg.Link(url="javascript:alert(1)"),
            'Link url: "javascript:alert(1)" has a scheme links do not take; '
            "give an http, https, mailto, or relative URL",
        ),
        (lambda: hg.Link(url=[" JavaScript:", hg.LabelPart(value=True)]), "has a scheme"),
        (lambda: hg.Link(url="\x01data:text/html,x"), "has a scheme"),
        (lambda: hg.Link(url="java\tscript:x"), "has a scheme"),
        (lambda: hg.Link(url=3), "Link url: expected a list of parts; received 3"),
        (
            lambda: hg.Link(url="/a", text="Open"),
            'Link text: expected a list of parts; received "Open"',
        ),
        (
            lambda: hg.Link(url=["/t/", hg.LabelPart(series=True)]),
            "Link url[1]: a link's part is text, a column (field=), or the value (value=True)",
        ),
        (
            lambda: hg.Link(url=["/t/", hg.LabelPart(value=True, format=hg.Format(number=".1f"))]),
            "Link url[1] format: URLs take values raw, and text through their displays; "
            "drop format",
        ),
        (lambda: hg.Link(url=["/t/", 3]), "Link url[1]: expected text or an hg.LabelPart"),
        (lambda: hg.Link(url=["/t/", {"column": "x"}]), 'Link url[1]: unknown key "column"'),
        (lambda: hg.FieldDisplay(link="/t"), "FieldDisplay link: expected an hg.Link"),
    ],
)
def test_links_refuse_in_pythons_names(make, message):
    with pytest.raises(ValueError, match=re.escape(message)):
        make()


@pytest.mark.parametrize(
    "url", ["https://x.example", "HTTP://x", "mailto:ops@example.com", "/t", "a/b:c", "//x/t", "#a"]
)
def test_links_take_http_https_mailto_and_relative_urls(url):
    assert hg.Link(url=url).url == url


def test_charts_send_the_columns_links_read_of_columns_they_send():
    fields = {"trace": hg.FieldDisplay(link=TRACE)}
    shown = hg.Chart(DATA, fields=fields).line(x="t", y="p99", tooltip=hg.Tooltip(fields=["trace"]))
    assert columns(shown) == {"t", "p99", "trace", "span"}
    # Nothing shows the trace: its link reads nothing.
    assert columns(hg.Chart(DATA, fields=fields).line(x="t", y="p99")) == {"t", "p99"}
    # Rules matching by kind, expression, and table; one matching nothing adds nothing.
    rules = [
        hg.FieldDisplay(match=hg.Match(kind="time"), link=hg.Link(url=[{"field": "host"}])),
        hg.FieldDisplay(match=hg.Match(regex="^p\\d+$"), link=hg.Link(url=[{"field": "span"}])),
        hg.FieldDisplay(match=hg.Match(table="elsewhere"), link=hg.Link(url=[{"field": "trace"}])),
    ]
    chart = hg.Chart(DATA, fields=rules).line(x="t", y="p99")
    assert columns(chart) == {"t", "p99", "span"}
    # A table's name, or its data, matches its columns.
    named = [hg.FieldDisplay(match=hg.Match(table=DATA), link=hg.Link(url=[{"field": "host"}]))]
    assert columns(hg.Chart(DATA, fields=named).line(x="t", y="p99")) == {"t", "p99", "host"}
    # Columns the table lacks are the engine's to refuse, where a tooltip reads the link.
    lacking = {"p99": hg.FieldDisplay(link=hg.Link(url=[{"field": "nothing"}]))}
    assert columns(hg.Chart(DATA, fields=lacking).line(x="t", y="p99")) == {"t", "p99"}


def test_charts_send_the_columns_links_read_through_derived_tables():
    fast = hg.derive(DATA).filter(hg.col("p99") < 300)
    fields = {"trace": hg.FieldDisplay(link=TRACE)}
    chart = hg.Chart(fast, fields=fields).point(
        x="t", y="p99", tooltip=hg.Tooltip(fields=["trace"])
    )
    spec = chart.to_spec()[0]
    sent = {name for table in spec["data"].values() for name in table.get("columns", {})}
    assert {"trace", "span"} <= sent
    assert "host" not in sent


def test_export_reads_link_columns_and_draws_no_links():
    fields = {"trace": hg.FieldDisplay(link=TRACE)}
    chart = hg.Chart(DATA, fields=fields).bar(
        x="span", y="p99", tooltip=hg.Tooltip(fields=["trace"])
    )
    svg = chart.to_svg()
    assert "<a " not in svg
    assert "traces.example.com" not in svg
    assert chart.to_pdf().startswith(b"%PDF")


def test_inspections_read_tooltip_fields_links():
    from herceg._events import decode_inspection

    field = {"field": "trace", "label": "trace", "kind": "category", "value": "c", "text": "c"}
    point = {"label": "p99", "value": 250, "text": "250", "mark": 0, "key": "p99"}
    payload = {"axis": "x", "label": "", "points": [{**point, "fields": [field]}]}
    link = {"url": "https://traces.example.com/c?span=s3", "text": "Trace c"}
    linked = {**payload, "points": [{**point, "fields": [{**field, "link": link}]}]}
    assert decode_inspection(payload).points[0].fields[0].link is None  # type: ignore[union-attr]
    assert decode_inspection(linked).points[0].fields[0].link == hg.RowLink(**link)  # type: ignore[union-attr]


def test_link_columns_skip_literal_symbols():
    rules = [
        hg.FieldDisplay(match=hg.Match(kind="category"), link=hg.Link(url=[{"field": "span"}]))
    ]
    chart = hg.Chart(DATA, fields=rules).point(x="t", y="p99", symbol="circle")
    assert columns(chart) == {"t", "p99"}


def test_link_columns_follow_javascripts_regular_expressions():
    # JavaScript's \b is ASCII: "^trace\b" matches "traceé", which Python's does not.
    data = {"t": [0, 1], "v": [1, 2], "traceé": ["a", "b"], "span": ["s", "t"]}
    rules = [
        hg.FieldDisplay(match=hg.Match(regex=r"^trace\b"), link=hg.Link(url=[{"field": "span"}]))
    ]
    chart = hg.Chart(data, fields=rules).line(x="t", y="v", tooltip=hg.Tooltip(fields=["traceé"]))
    assert "span" in columns(chart)


def test_link_columns_follow_the_last_link_a_column_surely_takes():
    data = {**DATA, "notes": [object(), object(), object()]}
    tooltip = hg.Tooltip(fields=["trace"])
    first = hg.FieldDisplay(match="trace", link=hg.Link(url=["/n/", {"field": "notes"}]))
    for later in (
        hg.FieldDisplay(match="trace", link=False),
        hg.FieldDisplay(match=hg.Match(field="trace"), link=hg.Link(url="/traces")),
    ):
        chart = hg.Chart(data, fields=[first, later]).line(x="t", y="p99", tooltip=tooltip)
        assert columns(chart) == {"t", "p99", "trace"}
    # A later rule that may not match (its expression is the engine's) keeps the earlier link.
    maybe = hg.FieldDisplay(match=hg.Match(regex="^tr"), link=False)
    spanned = hg.FieldDisplay(match="trace", link=hg.Link(url=["/s/", {"field": "span"}]))
    chart = hg.Chart(DATA, fields=[spanned, maybe]).line(x="t", y="p99", tooltip=tooltip)
    assert columns(chart) == {"t", "p99", "trace", "span"}


def test_express_charts_send_link_columns_of_tables_made_from_their_data():
    pd = pytest.importorskip("pandas")
    import herceg.express as hx

    df = pd.DataFrame({"t": [0, 1, 2], "v": [1.0, 2.0, 3.0]})
    raw = pd.DataFrame({"t": [0, 1, 2], "v": [1.5, 2.5, 3.5], "span": ["a", "b", "c"]})
    rules = [
        hg.FieldDisplay(
            match=hg.Match(table=df, field="v"), link=hg.Link(url=["/s/", {"field": "span"}])
        )
    ]
    # The raw data's table stands for the express chart's, whose rules it takes.
    chart = hx.lineplot(df, x="t", y="v", fields=rules).point(
        data=raw, x="t", y="v", tooltip=hg.Tooltip(fields=["v"])
    )
    spec = chart.to_spec()[0]
    added = spec["marks"][-1]["data"]
    assert "span" in spec["data"][added]["columns"]


def test_link_columns_stop_where_a_derived_table_replaces_the_column():
    data = {**DATA, "notes": [object(), object(), object()]}
    doubled = hg.derive(data).calculate("p99", hg.col("p99") * 2)
    rules = [
        hg.FieldDisplay(
            match=hg.Match(table=data, field="p99"), link=hg.Link(url=[{"field": "notes"}])
        )
    ]
    tooltip = hg.Tooltip(fields=["p99"])
    chart = hg.Chart(doubled, fields=rules).line(x="t", y="p99", tooltip=tooltip)
    sent = {
        name for table in chart.to_spec()[0]["data"].values() for name in table.get("columns", {})
    }
    assert "notes" not in sent
    # A column passing through unchanged takes its source's rules.
    passed = hg.derive(DATA).filter(hg.col("p99") > 0)
    rules = [
        hg.FieldDisplay(
            match=hg.Match(table=DATA, field="trace"), link=hg.Link(url=[{"field": "span"}])
        )
    ]
    chart = hg.Chart(passed, fields=rules).line(
        x="t", y="p99", tooltip=hg.Tooltip(fields=["trace"])
    )
    sent = {
        name for table in chart.to_spec()[0]["data"].values() for name in table.get("columns", {})
    }
    assert "span" in sent


def test_live_charts_send_the_columns_their_links_read_and_refuse_others():
    from herceg._live import LiveChart

    chart = hg.Chart(DATA).line(x="t", y="p99", tooltip=hg.Tooltip(fields=["trace"]))
    fields = {"trace": hg.FieldDisplay(link=TRACE)}
    # A chart made again keeps the displays an update gave, and sends what their links read.
    assert set(LiveChart(chart, {"fields": fields})._tables["data"]) == {
        "t",
        "p99",
        "trace",
        "span",
    }
    # A live chart's tables hold the columns it sent: a link reading another is refused.
    widget = chart.widget()
    with pytest.raises(
        ValueError,
        match=re.escape(
            "widget.update fields: a link reads column 'span', which the chart did not send; "
            "give the chart these fields when it is made"
        ),
    ):
        widget.update(fields=fields)
    # Links reading what was sent, and rules matching other tables, are taken.
    widget.update(
        fields={"trace": hg.FieldDisplay(link=hg.Link(url=["/t/", hg.LabelPart(value=True)]))}
    )
    other = hg.FieldDisplay(match=hg.Match(table="other"), link=hg.Link(url=[{"field": "span"}]))
    widget.update(fields=[other])


def test_live_updates_check_links_of_derived_tables_by_what_they_compute():
    derived = (
        hg.derive(DATA).calculate("twice", hg.col("p99") * 2).calculate("half", hg.col("p99") / 2)
    )
    widget = hg.Chart(derived).line(x="t", y="p99", tooltip=hg.Tooltip(fields=["twice"])).widget()
    with pytest.raises(ValueError, match=re.escape("a link reads column 'span'")):
        widget.update(fields={"twice": hg.FieldDisplay(link=hg.Link(url=[{"field": "span"}]))})
    # A calculated sibling is computed from columns sent.
    widget.update(fields={"twice": hg.FieldDisplay(link=hg.Link(url=["/h/", {"field": "half"}]))})


def test_live_updates_take_rules_that_match_no_column_shown():
    pd = pytest.importorskip("pandas")
    import herceg.express as hx

    df = pd.DataFrame({"t": [0, 1, 2], "v": [1.0, 2.0, 3.0]})
    raw = pd.DataFrame({"t": [0, 1], "v": [1.5, 2.5], "trace": ["a", "b"], "span": ["s", "u"]})
    chart = hx.lineplot(df, x="t", y="v").point(
        data=raw, x="t", y="v", tooltip=hg.Tooltip(fields=["trace"])
    )
    widget = chart.widget()
    # The express chart's data has no trace: the raw data's trace is not its.
    rule = hg.FieldDisplay(
        match=hg.Match(table=df, field="trace"), link=hg.Link(url=[{"field": "span"}])
    )
    widget.update(fields=[rule])


def test_link_columns_follow_resets_through_tables_a_column_passes():
    data = {**DATA, "notes": [object(), object(), object()]}
    passed = hg.derive(data).filter(hg.col("p99") > 0)
    rules = [
        hg.FieldDisplay(
            match=hg.Match(table=data, field="trace"), link=hg.Link(url=[{"field": "notes"}])
        ),
        hg.FieldDisplay(match=hg.Match(table=data, field="trace"), link=False),
    ]
    chart = hg.Chart(passed, fields=rules).line(
        x="t", y="p99", tooltip=hg.Tooltip(fields=["trace"])
    )
    sent = {
        name for table in chart.to_spec()[0]["data"].values() for name in table.get("columns", {})
    }
    assert "notes" not in sent


def test_shapes_own_no_links():
    square = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]
    data = {
        "shape": [{"type": "Polygon", "coordinates": [square]}],
        "unused": [object()],
    }
    rules = [hg.FieldDisplay(link=hg.Link(url=[{"field": "unused"}]))]
    spec = hg.Chart(data, fields=rules).geoshape("shape").to_spec()[0]
    assert set(spec["data"]["data"]["columns"]) == {"shape"}


def test_live_updates_judge_what_new_displays_add_not_marks_added_since():
    chart = hg.Chart(DATA).line(x="t", y="p99", tooltip=hg.Tooltip(fields=["trace"]))
    widget = chart.widget()
    # The builder goes on, reading span; the widget's chart does not.
    chart.point(x="t", y="p99", color="span")
    widget.update(fields={"trace": hg.FieldDisplay(label="Trace")})
