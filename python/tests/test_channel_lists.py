"""Channels' three forms beyond one channel, in Python's spelling: lists of
channels tried in order, ``hg.when`` without ``otherwise``, and rank tests
(``hg.top``, ``hg.bottom``); their spec, the columns they send (read only
inside a list or a rank too), static output, and their errors."""

import pytest

import herceg as hg

SERVICES = {
    "service": ["auth", "cart", "feed", "mail", "pay"],
    "p99": [5.0, 9.0, 9.0, 2.0, 7.0],
    "errors": [0.01, 0.2, 0.03, 0.1, 0.0],
    "tier": ["web", "web", "core", "core", "core"],
    "unused": [0.0] * 5,
}
RED, AMBER, GREY = "#c62828", "#ff9800", "#90a4ae"


def spec_of(chart):
    spec, _ = chart.to_spec()
    return spec


def ranked_bars(**options):
    return hg.Chart(SERVICES, **options).bar(
        x="service",
        y="p99",
        encode=hg.Encodings(
            color=[
                hg.when(hg.top(2, "p99"), RED),
                hg.when(hg.col("errors") > 0.05, AMBER),
                hg.Channel(value=GREY),
            ]
        ),
    )


@pytest.mark.contract("channel.list.python")
def test_lists_conditions_without_otherwise_and_ranks_write_the_specs_forms():
    assert spec_of(ranked_bars())["marks"][0]["encode"] == {
        "color": [
            {"condition": {"when": {"top": 2, "field": "p99"}, "then": RED}},
            {"condition": {"when": [">", ["field", "errors"], 0.05], "then": AMBER}},
            {"value": GREY},
        ]
    }
    # Dicts of hg.Channel's keywords, conditions with otherwise, and bottom ranks.
    chart = hg.Chart(SERVICES).point(
        x="errors",
        y="p99",
        color=[hg.when(hg.bottom(1, "p99"), RED, AMBER)],
        encode={"opacity": [hg.when(hg.col("errors") > 0.1, 0.4), {"value": 1}]},
    )
    mark = spec_of(chart)["marks"][0]
    assert mark["color"] == [
        {"condition": {"when": {"bottom": 1, "field": "p99"}, "then": RED, "otherwise": AMBER}}
    ]
    assert mark["encode"]["opacity"] == [
        {"condition": {"when": [">", ["field", "errors"], 0.1], "then": 0.4}},
        {"value": 1},
    ]
    assert repr(hg.top(3, "p99")) == "hg.top(3, 'p99')"
    # With both branches and an expression, hg.when stays an expression.
    assert isinstance(hg.when(hg.col("p99") > 5, 1, 0), hg.Expr)
    assert isinstance(hg.when(hg.col("p99") > 5, 1), hg.Condition)


@pytest.mark.contract("channel.list.fields.python")
def test_columns_read_only_in_lists_and_ranks_are_sent():
    chart = hg.Chart(SERVICES).bar(
        x="service",
        y="p99",
        encode=hg.Encodings(
            color=[hg.when(hg.top(1, "errors"), RED), hg.when(hg.col("tier") == "web", AMBER)]
        ),
    )
    spec = spec_of(chart)
    assert sorted(spec["data"]["data"]["columns"]) == ["errors", "p99", "service", "tier"]
    # Static output draws them: the top error rate in red, the other web service in amber.
    svg = chart.to_svg()
    assert f'fill="{RED}"' in svg and f'fill="{AMBER}"' in svg


@pytest.mark.contract("channel.list.unreachable.python")
def test_lists_refuse_entries_no_row_reaches_and_malformed_ranks_in_python_names():
    with pytest.raises(hg.ChartError) as raised:
        hg.Encodings(color=[hg.Channel(value=GREY), hg.when(hg.top(1, "p99"), RED)])
    assert str(raised.value) == (
        "Encodings color[1]: the channel before it always gives an output (a constant, the "
        "series' names, or a condition with otherwise); move it first, or drop it"
    )
    with pytest.raises(hg.ChartError, match=r"Encodings color\[1\]: the channel before"):
        hg.Encodings(color=[hg.when(hg.col("p99") > 1, RED, AMBER), hg.Channel(value=GREY)])
    with pytest.raises(hg.ChartError, match=r"Encodings color\[1\]: the channel before"):
        hg.Encodings(color=[hg.Channel(series=True, scale="s"), hg.Channel(value=GREY)])
    with pytest.raises(hg.ChartError, match="received an empty list"):
        hg.Encodings(color=[])
    with pytest.raises(hg.ChartError, match=r"give a dash pattern as hg.Channel\(value=\[4, 2\]\)"):
        hg.Encodings(dash=[4, 2])
    with pytest.raises(hg.ChartError, match="top n: expected a whole number of rows from 1"):
        hg.top(0, "p99")
    with pytest.raises(hg.ChartError, match="bottom field: expected a number or datetime"):
        hg.bottom(1, "")
    with pytest.raises(
        hg.ChartError,
        match=r"bar encode.color\[0\].condition.when.field: column 'tier' holds categories",
    ):
        hg.Chart(SERVICES).bar(
            x="service", y="p99", encode=hg.Encodings(color=[hg.when(hg.top(1, "tier"), RED)])
        )


def test_conditions_that_are_no_expressions_are_refused_where_expressions_are_read():
    with pytest.raises(hg.ChartError, match="a rank test reads the rows of a mark"):
        _ = (hg.col("p99") > 1) & hg.top(1, "p99")
    with pytest.raises(hg.ChartError, match="combines with no expression"):
        _ = hg.top(1, "p99") | (hg.col("p99") > 1)
    with pytest.raises(hg.ChartError, match="a condition without otherwise gives no value"):
        hg.derive(SERVICES).calculate("slow", hg.when(hg.col("p99") > 8, 1))
    with pytest.raises(hg.ChartError, match="when condition: expected an expression"):
        hg.when("p99", 1)  # type: ignore[call-overload]


def test_lists_split_no_series_and_regions_read_no_series_names():
    # A color column in a list colors rows; series stay those `series` names.
    chart = hg.Chart(SERVICES).bar(
        x="service", y="p99", encode={"color": [hg.when(hg.top(1, "p99"), RED), {"field": "tier"}]}
    )
    assert spec_of(chart)["marks"][0].get("series") is None
    with pytest.raises(hg.ChartError, match=r"region encode.fill\[1\]: regions have no series"):
        hg.Chart(SERVICES).region(
            data={"a": [0.0], "b": [1.0]},
            x1="a",
            x2="b",
            encode={"fill": [hg.when(hg.col("a") > 0, RED), hg.Channel(series=True, scale="s")]},
        )


@pytest.mark.contract("channel.list.live.python")
def test_live_appends_send_the_columns_lists_and_ranks_read():
    pytest.importorskip("anywidget")
    widget = ranked_bars().widget()
    sent = []
    widget.comm.send = lambda data=None, buffers=None, **_: sent.append(data)
    widget.append(
        {
            "service": ["queue"],
            "p99": [12.0],
            "errors": [0.0],
            "tier": ["core"],
            "unused": [1.0],
        }
    )
    content = [data["content"] for data in sent if data["method"] == "custom"][-1]
    assert content["type"] == "append"
    assert sorted(content["columns"]) == ["errors", "p99", "service"]


def test_points_flat_channels_take_any_sequence_of_channels():
    chart = hg.Chart(SERVICES).point(
        x="errors",
        y="p99",
        color=(hg.when(hg.top(1, "p99"), RED), hg.Channel(value=GREY)),
        size=(hg.Channel(value=20),),
    )
    mark = spec_of(chart)["marks"][0]
    assert mark["color"] == [
        {"condition": {"when": {"top": 1, "field": "p99"}, "then": RED}},
        {"value": GREY},
    ]
    assert mark["size"] == [{"value": 20}]
