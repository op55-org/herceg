"""Views by channels, row groups, and totals: what they write to the spec,
what they refuse, and the data guide's cross-filtered dashboard, whose
panels the engine's browser test loads over one table and store
(packages/herceg/test/fixtures/cross-filter.json)."""

import json
import re
from pathlib import Path

import pandas as pd
import pytest

import herceg as hg

ROOT = Path(__file__).parents[2]
FIXTURE = json.loads((ROOT / "packages/herceg/test/fixtures/cross-filter.json").read_text())


def sales():
    return pd.DataFrame(
        {
            "time": pd.to_datetime(["2024-12-01", "2024-12-01", "2025-01-01", "2025-01-01"]),
            "region": pd.Categorical(["North", "South", "North", "South"]),
            "month": ["2024-12", "2024-12", "2025-01", "2025-01"],
            "revenue": [10.0, 20.0, 30.0, 40.0],
            "orders": [1.0, 2.0, 3.0, 4.0],
        }
    )


def entries(chart):
    """The chart's data entries made from others: views, groups, totals."""
    spec, _ = chart.to_spec()
    return {name: entry for name, entry in spec["data"].items() if "source" in entry}


def guide_python():
    """The Python dashboard the data guide's "Cross-filtering" section prints."""
    guide = (ROOT / "docs/guide/data.md").read_text()
    section = guide[guide.index("## Cross-filtering") :]
    section = section[: section.index("\n## ", 1)]
    found = re.search(r"```python\n(.*?)```", section, re.S)
    assert found is not None
    return found.group(1)


@pytest.mark.contract("cross-filter.dashboard.python-spec")
def test_the_guides_dashboard_writes_the_panels_the_engine_runs():
    names = {"sales": sales()}
    exec(guide_python(), names)
    for panel in ("revenue", "orders", "regions", "months"):
        spec, _ = names[panel].to_spec()
        # The page gives the table every panel reads.
        spec["data"]["data"] = {"columns": {}}
        assert spec == FIXTURE["python"][panel], panel


@pytest.mark.contract("data.view.channels.python")
def test_views_follow_channels_of_their_datas_store():
    data = sales()
    for given, written in [
        (hg.Channels(), {}),
        (hg.Channels("regions"), {"channels": ["regions"]}),
        (hg.Channels(["a", "b"]), {"channels": ["a", "b"]}),
        (hg.Channels([]), {"channels": []}),
        (hg.Channels(excluding="regions"), {"excluding": "regions"}),
        (hg.Channels(excluding=["a", "b"]), {"excluding": ["a", "b"]}),
    ]:
        view = hg.view(data, filter=hg.col("revenue") > 0, sort="time", selection=given)
        assert entries(hg.Chart(view).line(x="time", y="revenue")) == {
            "data2": {
                "source": "data",
                "view": {
                    "filter": [">", ["field", "revenue"], 0],
                    "sort": [{"field": "time", "order": "ascending"}],
                    "selection": written,
                },
            }
        }
    with pytest.raises(hg.ChartError, match="Channels: give channels or excluding, not both"):
        hg.Channels("a", excluding="b")
    with pytest.raises(
        hg.ChartError,
        match="Channels excluding: expected a channel's name or a list of them; received 3",
    ):
        hg.Channels(excluding=3)  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError, match="view selection: expected"):
        hg.view(data, selection="regions")  # type: ignore[arg-type]


@pytest.mark.contract("data.groups.python")
def test_groups_and_their_levels_write_one_groups_entry_each():
    data = sales()
    shown = hg.view(data, selection=hg.Channels(excluding="months"))
    groups = hg.group_rows(
        shown, by=["region", "month"], n="count", revenue=("revenue", "sum"), top=("time", "max")
    )
    assert groups.columns == {
        "region": "category",
        "month": "category",
        "n": "number",
        "revenue": "number",
        "top": "time",
    }
    upper = groups.level("region")
    assert upper.columns == {
        "region": "category",
        "n": "number",
        "revenue": "number",
        "top": "time",
    }
    assert groups.level("month") is groups
    # A level gives the others too, the last one's columns again.
    assert upper.level("month").columns == groups.columns
    assert upper.level("region") is upper
    chart = (
        hg.Chart(groups)
        .bar(x="month", y="revenue", color="region")
        .line(x="region", y="revenue", data=upper)
    )
    ops = {
        "n": {"op": "count"},
        "revenue": {"op": "sum", "field": "revenue"},
        "top": {"op": "max", "field": "time"},
    }
    assert entries(chart) == {
        "data2": {"source": "data", "view": {"selection": {"excluding": "months"}}},
        "data3": {"source": "data2", "groups": {"by": ["region", "month"], "ops": ops}},
        "data4": {
            "source": "data2",
            "groups": {"by": ["region", "month"], "ops": ops, "level": "region"},
        },
    }
    # Groups of data, without a view, read it whole.
    assert entries(
        hg.Chart(hg.group_rows(data, by="region", n="count")).bar(x="region", y="n")
    ) == {"data2": {"source": "data", "groups": {"by": ["region"], "ops": {"n": {"op": "count"}}}}}
    with pytest.raises(hg.ChartError, match="bar x: no column 'month'"):
        hg.Chart(upper).bar(x="month", y="revenue")


@pytest.mark.contract("data.totals.python")
def test_totals_write_a_totals_entry():
    data = sales()
    totals = hg.row_totals(
        hg.view(data, selection=hg.Channels()), n="count", avg=("revenue", "mean")
    )
    assert totals.columns == {"n": "number", "avg": "number"}
    assert entries(hg.Chart(totals).point(x="n", y="avg")) == {
        "data2": {"source": "data", "view": {"selection": {}}},
        "data3": {
            "source": "data2",
            "totals": {"ops": {"n": {"op": "count"}, "avg": {"op": "mean", "field": "revenue"}}},
        },
    }


def test_groups_and_totals_refuse_in_pythons_words():
    data = sales()
    for call, message in [
        (
            lambda: hg.group_rows(data, by="region", p50=("revenue", "median")),
            'group_rows p50: "median" is not one groups keep; use "count", "sum", "mean", '
            '"min", or "max", or hg.derive(data).aggregate(...)',
        ),
        (
            lambda: hg.row_totals(data, p50=("revenue", "median")),
            'row_totals p50: "median" is not one totals keep; use "count", "sum", "mean", '
            '"min", or "max", or hg.derive(data).aggregate(...)',
        ),
        (
            lambda: hg.group_rows(data, by="region", x=("revenue", "mode")),
            'group_rows x: unknown operation "mode"; name one of "count", "sum", "mean", '
            '"min", or "max"',
        ),
        (
            lambda: hg.group_rows(data, by="region", revenue="sum"),
            'group_rows revenue: "sum" needs a column; give ("column", "sum")',
        ),
        (
            lambda: hg.group_rows(data, by=[], n="count"),
            "group_rows by: expected at least one column to group by",
        ),
        (
            lambda: hg.group_rows(data, by=["region", "region"], n="count"),
            "group_rows by: each column once",
        ),
        (
            lambda: hg.group_rows(data, by="region", region="count"),
            "group_rows region: an operation cannot have the name of a grouping column",
        ),
        (
            lambda: hg.group_rows(hg.group_rows(data, by="region", n="count"), by="n", m="count"),
            "group_rows data: groups or totals; group a view of their data, or derive from it",
        ),
        (
            lambda: hg.row_totals(data),
            'row_totals: needs at least one operation, such as n="count"',
        ),
        (
            lambda: hg.group_rows(data, by="region", n="count").level("service"),
            "RowGroups level: 'service' is not one of by ('region'); name one of them",
        ),
    ]:
        with pytest.raises(hg.ChartError, match=re.escape(message)):
            call()
    with pytest.raises(hg.ChartError, match="group_rows by: no column 'service'"):
        hg.group_rows(data, by="service", n="count")
    with pytest.raises(hg.ChartError, match="group_rows revenue"):
        hg.group_rows(data, by="region", revenue=("month", "sum"))


def test_static_output_draws_a_view_following_a_bindings_selection():
    pytest.importorskip("py_mini_racer")
    data = sales()
    december = hg.col("month") == "2024-12"
    focus = hg.SelectionBinding("focus", data=data, selection=december, events=[], effect="none")
    shown = hg.view(data, selection=hg.Channels())
    following = hg.Chart(
        hg.group_rows(shown, by="region", revenue=("revenue", "sum")), row_selection=focus
    ).bar(x="region", y="revenue")
    filtered = hg.Chart(
        hg.derive(data).filter(december).aggregate(by="region", revenue=("revenue", "sum"))
    ).bar(x="region", y="revenue")

    def drawn(chart):
        return re.sub(r"herceg-svg-\d+", "herceg-svg", chart.to_svg())

    assert drawn(following) == drawn(filtered)
    # Both levels of one grouping, and totals, draw from the spec.
    groups = hg.group_rows(shown, by=["region", "month"], revenue=("revenue", "sum"))
    svg = (
        hg.Chart(groups, row_selection=focus)
        .bar(x="month", y="revenue", color="region")
        .line(x="region", y="revenue", data=groups.level("region"))
        .to_svg()
    )
    assert "<svg" in svg
