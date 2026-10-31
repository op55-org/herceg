"""Ordered tables (``hg.ordered``) and views (``hg.view``): what charts send,
what they refuse, and how live widgets number rows that arrive late."""

from __future__ import annotations

import re

import numpy as np
import pandas as pd
import pytest

import herceg as hg
from herceg import SelectionBinding


def data_entry(chart: hg.Chart, name: str = "data"):
    spec, buffers = chart.to_spec()
    return spec, buffers, spec["data"][name]


def numbers(spec, buffers, name, field):
    column = spec["data"][name]["columns"][field]
    return np.frombuffer(buffers[column["buffer"]], dtype=column.get("dtype", "<f8")).tolist()


def test_ordered_data_sends_its_rows_in_order_with_its_column():
    frame = pd.DataFrame({"t": [3.0, 1.0, 2.0, 1.0], "v": [30.0, 10.0, 20.0, 11.0]})
    spec, buffers, entry = data_entry(hg.Chart(hg.ordered(frame, by="t")).point(x="v", y="v"))
    assert entry["orderBy"] == "t" and "maxRows" not in entry
    # Ties keep the order given; the order column is sent though no mark reads it.
    assert numbers(spec, buffers, "data", "t") == [1.0, 1.0, 2.0, 3.0]
    assert numbers(spec, buffers, "data", "v") == [10.0, 11.0, 20.0, 30.0]
    spec, buffers, entry = data_entry(
        hg.Chart(hg.ordered(frame, by="t", max_rows=2)).line(x="t", y="v")
    )
    assert entry["maxRows"] == 2
    assert numbers(spec, buffers, "data", "v") == [20.0, 30.0]
    assert "<path" in hg.Chart(hg.ordered(frame, by="t")).line(x="t", y="v").to_svg()


def test_ordered_refuses_what_it_cannot_order():
    frame = pd.DataFrame({"t": [1.0, np.nan], "kind": ["a", "b"]})
    with pytest.raises(ValueError, match="ordered by: no column 'time'; the data has 't', 'kind'"):
        hg.ordered(frame, by="time")
    with pytest.raises(ValueError, match="ordered by: column 'kind' holds category values"):
        hg.ordered(frame, by="kind")
    with pytest.raises(ValueError, match="ordered by: row 1 is missing; an ordered table needs"):
        hg.ordered(frame, by="t")
    with pytest.raises(ValueError, match="ordered max_rows: expected a whole number of at least 1"):
        hg.ordered(frame.dropna(), by="t", max_rows=0)
    with pytest.raises(ValueError, match="ordered data: give a data source"):
        hg.ordered(hg.derive(frame), by="t")


def test_views_send_a_question_about_their_data():
    flights = pd.DataFrame(
        {"delay": [-30.0, 5.0, 40.0, 0.0], "distance": [100.0, 200.0, 300.0, 400.0]}
    )
    near = hg.view(flights, filter=hg.col("delay") >= -20, sort="distance", descending=True)
    chart = hg.Chart(flights).histogram(x="distance", data=near)
    spec, _ = chart.to_spec()
    assert spec["data"]["data2"] == {
        "source": "data",
        "view": {
            "filter": [">=", ["field", "delay"], -20],
            "sort": [{"field": "distance", "order": "descending"}],
        },
    }
    # The filter's column travels with the data, which the view reads.
    assert sorted(spec["data"]["data"]["columns"]) == ["delay", "distance"]
    assert spec["marks"][0]["data"] == "data2"
    # A view draws as a table of its rows would.
    kept = flights[flights["delay"] >= -20].sort_values("distance", ascending=False)

    def drawn(data):
        svg = hg.Chart(data).line(x="distance", y="delay").to_svg()
        return re.sub(r"herceg-svg-\d+", "herceg-svg", svg)

    assert drawn(near) == drawn(kept)


def test_views_are_refused_where_they_mean_nothing():
    flights = pd.DataFrame({"delay": [1.0, 2.0], "distance": [1.0, 2.0]})
    near = hg.view(flights, filter=hg.col("delay") > 1)
    with pytest.raises(ValueError, match="rule data: a view; rule marks take a table"):
        hg.Chart(flights).rule(y="delay", data=near)
    with pytest.raises(ValueError, match="SelectionBinding data: a view; selections hold rows"):
        hg.Chart(flights, row_selection=SelectionBinding("focus", data=near)).point(
            x="delay", y="distance", data=near
        ).to_spec()
    with pytest.raises(ValueError, match="view data: already a view"):
        hg.view(near)
    with pytest.raises(ValueError, match="no column 'speed'"):
        hg.view(flights, sort="speed")
    with pytest.raises(ValueError, match="view descending: one for each of the 2 sort columns"):
        hg.view(flights, sort=["delay", "distance"], descending=[True])
    with pytest.raises(ValueError, match="no column 'speed'"):
        hg.view(flights, filter=hg.col("speed") > 1)


def test_selections_over_views_hold_rows_of_their_data():
    flights = pd.DataFrame({"delay": [1.0, 2.0, 3.0], "distance": [1.0, 2.0, 3.0]})
    near = hg.view(flights, filter=hg.col("delay") > 1)
    for binding in (SelectionBinding("focus", data=flights), SelectionBinding("focus")):
        chart = hg.Chart(flights, row_selection=binding).point(x="delay", y="distance", data=near)
        spec, _ = chart.to_spec()
        assert spec["rowSelection"]["data"] == "data"
        assert "<svg" in chart.to_svg()
    # Without data of the chart's own, the view's data is the one table read.
    spec, _ = (
        hg.Chart(row_selection=SelectionBinding("focus"))
        .point(x="delay", y="distance", data=near)
        .to_spec()
    )
    assert spec["rowSelection"]["data"] == spec["marks"][0]["data"].removesuffix("2")
    # Brushes are checked against marks over views of the data.
    with pytest.raises(ValueError, match="a histogram's y axis holds statistics"):
        hg.Chart(flights, brush="xy", row_selection=SelectionBinding("focus")).histogram(
            x="delay", data=near
        ).to_spec()


def test_views_of_ordered_data_send_both():
    frame = pd.DataFrame({"t": [2.0, 1.0], "pump": ["a", "b"], "v": [1.0, 2.0]})
    pumps = hg.view(hg.ordered(frame, by="t"), filter=hg.col("pump") == "a")
    spec, _ = hg.Chart(pumps).area(x="t", y="v", series="pump", stack=True).to_spec()
    assert spec["data"]["data"]["orderBy"] == "t"
    assert spec["data"]["data2"]["source"] == "data"


pytest.importorskip("anywidget")


class Browser:
    """Stands in for the browser on a widget's comm."""

    def __init__(self, widget):
        self.widget = widget

    def report(self, identities, generation=0):
        content = {
            "type": "rowSelection",
            "table": "data",
            "channel": "focus",
            "origin": "b1",
            # Made after every change Python made.
            "revision": self.widget._revision,
            "selection": {"kind": "rows", "generation": generation},
        }
        buffers = [np.asarray(identities, dtype="<f8").tobytes()]
        self.widget._handle_custom_msg(content, buffers)


def ordered_widget(max_rows=None):
    frame = pd.DataFrame({"t": [5.0, 1.0, 3.0], "v": [50.0, 10.0, 30.0]})
    chart = hg.Chart(
        hg.ordered(frame, by="t", max_rows=max_rows), row_selection=SelectionBinding("focus")
    )
    widget = chart.point(x="t", y="v").widget()
    return widget, Browser(widget)


def held(widget, field="v"):
    return widget._live._tables["data"][field].values.tolist()


def test_widgets_select_rows_of_the_data_their_views_read():
    flights = pd.DataFrame({"delay": [1.0, 2.0, 3.0], "distance": [1.0, 2.0, 3.0]})
    near = hg.view(flights, filter=hg.col("delay") > 1)
    chart = hg.Chart(flights, row_selection=SelectionBinding("focus"))
    widget = chart.point(x="delay", y="distance", data=near).widget()
    selection = widget.row_selection
    assert selection.data is flights
    assert (selection.channel, selection.rows) == ("focus", None)


def test_widgets_merge_late_rows_into_place_as_the_browser_does():
    widget, _ = ordered_widget()
    assert held(widget) == [10.0, 30.0, 50.0]
    # Late rows go after rows of their time already there, in the order given.
    widget.append({"t": [3.0, 6.0, 0.5, 3.0], "v": [31.0, 60.0, 5.0, 32.0]})
    assert held(widget) == [5.0, 10.0, 30.0, 31.0, 32.0, 50.0, 60.0]
    # Each row's identity is the ordinal it arrived with: the data given numbers the first.
    assert widget._live.ordinals["data"].tolist() == [5, 1, 2, 3, 6, 0, 4]
    # A window keeps the last rows in order, whichever arrived last.
    widget.append({"t": [0.1, 7.0], "v": [1.0, 70.0]}, max_rows=4)
    assert held(widget) == [32.0, 50.0, 60.0, 70.0]
    with pytest.raises(ValueError, match="widget.append rows: column 't': row 1 is missing"):
        widget.append({"t": [8.0, np.nan], "v": [1.0, 2.0]})
    assert held(widget) == [32.0, 50.0, 60.0, 70.0]
    assert widget._live.ordinals["data"].tolist() == [6, 0, 4, 8]
    # Rows in order append as they are, numbered on.
    widget.append({"t": [8.0, 9.0], "v": [80.0, 90.0]}, max_rows=4)
    assert held(widget) == [60.0, 70.0, 80.0, 90.0]
    assert widget._live.ordinals["data"].tolist() == [4, 8, 9, 10]


def test_widgets_take_in_no_row_their_window_drops_at_once():
    frame = pd.DataFrame({"t": [10.0], "s": ["a"], "v": [1.0]})
    ordered = hg.ordered(frame, by="t", max_rows=1)
    widget = hg.Chart(ordered).point(x="t", y="v", color="s").widget()
    for i in range(5):
        widget.append({"t": [float(i)], "s": [f"late {i}"], "v": [0.0]})
    table = widget._live._tables["data"]
    # No label of a row the table's window never keeps joins Python's
    # dictionary, as none joins the browser table's.
    assert table["s"].dictionary == ("a",)
    assert widget._live.ordinals["data"].tolist() == [0]
    assert widget._live.next_ordinal["data"] == 6
    widget.append({"t": [11.0, 3.0], "s": ["b", "c"], "v": [2.0, 3.0]})
    assert table["s"].dictionary == ("a", "b")
    assert widget._live.ordinals["data"].tolist() == [6]
    # `max_rows` of one call trims after the rows are in, as the browser's
    # widget does: their labels join both dictionaries.
    widget = hg.Chart(hg.ordered(frame, by="t")).point(x="t", y="v", color="s").widget()
    widget.append({"t": [0.0, 11.0], "s": ["never", "b"], "v": [0.0, 2.0]}, max_rows=1)
    assert widget._live._tables["data"]["s"].dictionary == ("a", "never", "b")
    assert widget._live.ordinals["data"].tolist() == [2]


def test_widgets_number_ordered_rows_by_identity_through_late_rows():
    widget, browser = ordered_widget()
    reports = []
    widget.on_row_selection(reports.append)
    state = widget.get_state()["_chart"]
    dropped, generation, at, following = state["rows"]["data"]
    assert [dropped, generation, following] == [0, 0, 3]
    # The browser numbers the rows sent 0, 1, 2; Python, as they came: 1, 2, 0.
    assert np.frombuffer(state["buffers"][at], dtype="<f8").tolist() == [1.0, 2.0, 0.0]
    widget.append({"t": [2.0, 4.0], "v": [20.0, 40.0]})
    # The rows of t 1 and 4 (Python's identities 1 and 4) are at positions 0 and 3 now.
    browser.report([1, 4])
    assert reports[-1].rows.tolist() == [0, 3]
    # Rows Python selected stay on theirs as late rows move them.
    widget.row_selection = [1, 2]
    widget.append({"t": [0.5, 2.0], "v": [5.0, 21.0]})
    assert held(widget) == [5.0, 10.0, 20.0, 21.0, 30.0, 40.0, 50.0]
    assert widget.row_selection.rows.tolist() == [2, 4]
    # A replace numbers rows afresh, as given.
    widget.replace(pd.DataFrame({"t": [9.0, 8.0], "v": [90.0, 80.0]}))
    assert widget._live.ordinals["data"].tolist() == [1, 0]
    browser.report([0], generation=1)
    assert reports[-1].rows.tolist() == [1]
