"""Selections of three kinds and the chart's first state: in the spec, from
the browser, and written back conditionally."""

import datetime as dt

import numpy as np
import pytest

import herceg as hg
import herceg.express as hx
from herceg._events import decode_selection, encode_selection, same_values

T0 = dt.datetime(2026, 1, 1)
MS0 = (T0 - dt.datetime(1970, 1, 1)).total_seconds() * 1000
DATA = {"t": np.array([0.0, 1.0, 2.0]), "v": np.array([1.0, 3.0, 2.0]), "s": ["a", "b", "a"]}


def spec(chart: hg.Chart) -> dict:
    return chart.to_spec()[0]


def test_state_options_are_the_charts_first_state():
    chart = hg.Chart(
        DATA,
        selection=hg.BrushSelection(x=(T0, T0 + dt.timedelta(minutes=1))),
        viewport=hg.Viewport(x=(0.0, 1.0), y_right=(2.0, 3.0)),
        visibility=['["0","b"]'],
        drill_root=('[0,"a"]',),
    ).line(x="t", y="v", series="s")
    out = spec(chart)
    assert out["selection"] == {"kind": "brush", "x": [MS0, MS0 + 60_000], "y": None, "lasso": None}
    assert out["viewport"] == {"x": [0.0, 1.0], "yRight": [2.0, 3.0]}
    assert out["visibility"] == {"hidden": ['["0","b"]']}
    assert out["drillRoot"] == '[0,"a"]'
    # Items and series by their keys or references; left out, no state is given.
    items = hg.ItemSelection((hg.ItemReference("dots", ("row", np.int64(1))), '["dots","x"]'))
    chosen = spec(hg.Chart(DATA, selection=items).point(x="t", y="v", id="dots"))
    assert chosen["selection"] == {
        "kind": "items",
        "items": [{"mark": "dots", "item": ["row", 1]}, '["dots","x"]'],
    }
    assert "selection" not in spec(hg.Chart(DATA).line(x="t", y="v"))


def test_state_options_refuse_what_they_cannot_say():
    with pytest.raises(hg.ChartError, match="Chart selection: expected an hg.BrushSelection") as e:
        hg.Chart(DATA, selection=5)  # type: ignore[arg-type]
    assert e.value.path == "selection"
    with pytest.raises(hg.ChartError, match="a brush over categories is set on a live chart"):
        hg.Chart(DATA, selection=hg.BrushSelection(x=("a", "b")))
    with pytest.raises(hg.ChartError, match="Chart visibility: expected an hg.VisibilityState"):
        hg.Chart(DATA, visibility="v")  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError, match="SeriesSelection series\\[0\\]: expected a key"):
        encode_selection(hg.SeriesSelection((hg.ItemReference("m", ("a",)),)))  # type: ignore[arg-type]


def test_clicks_select_items_or_series_in_their_looks():
    chart = hg.Chart(DATA, select="series", brush=hg.Brush("x", edit=True, clear="double-click"))
    chart.point(x="t", y="v", selected=hg.Look(fill="#c00", radius=4), unselected={"opacity": 0.1})
    out = spec(chart)
    assert out["interaction"] == {
        "select": "series",
        "brush": {"shape": "x", "edit": True, "clear": "double-click"},
    }
    assert out["marks"][0]["selected"] == {"fill": "#c00", "radius": 4}
    assert out["marks"][0]["unselected"] == {"opacity": 0.1}
    with pytest.raises(hg.ChartError, match="a lasso is not moved or resized"):
        hg.Chart(DATA, brush=hg.Brush("lasso", edit=True))
    with pytest.raises(hg.ChartError, match='Chart select: expected "items" or "series"'):
        hg.Chart(DATA, select="rows")  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError, match="Look opacity: expected a number from 0 to 1"):
        hg.Look(opacity=2)


def test_brushes_are_edited_and_cleared_by_bindings_too():
    bindings = [
        hg.Binding(hg.DragGesture(button=2), hg.EditBrushAction()),
        hg.Binding(hg.KeyGesture("Delete"), hg.ClearBrushAction()),
    ]
    out = spec(hg.Chart(DATA, brush="x", bindings=bindings).line(x="t", y="v"))
    assert [binding["action"] for binding in out["interaction"]["bindings"]] == [
        {"type": "editBrush"},
        {"type": "clearBrush"},
    ]
    with pytest.raises(hg.ChartError, match="a PinchGesture performs"):
        hg.Chart(DATA, bindings=[hg.Binding(hg.PinchGesture(), hg.ClearBrushAction())])


def test_row_selections_hear_previews_when_live():
    chart = hg.Chart(DATA, brush="x", row_selection=hg.SelectionBinding("focus", live=True))
    assert spec(chart.line(x="t", y="v"))["rowSelection"]["live"] is True


def test_pairplot_takes_a_brush_and_its_points_looks():
    chart = hx.pairplot(DATA, vars=["t", "v"], brush="xy", unselected=hg.Look(opacity=0.1))
    out = spec(chart)
    assert out["interaction"]["brush"] == "xy"
    points = [mark for mark in out["marks"] if mark["type"] == "point"]
    assert points and all(mark["unselected"] == {"opacity": 0.1} for mark in points)


class Browser:
    def __init__(self, widget):
        self.widget = widget

    def reply(self, content):
        self.widget._handle_custom_msg(content, [])


def test_widgets_hear_every_phase_and_write_back_conditionally():
    widget = hg.Chart(DATA, brush="x").line(x="t", y="v").widget()
    browser = Browser(widget)
    events: list[hg.SelectEvent] = []
    widget.on_select(events.append)
    preview = {"kind": "brush", "x": [0.0, 1.0], "y": None, "lasso": None, "time": []}
    browser.reply({"type": "select", "selection": preview, "phase": "preview", "basis": "c:3"})
    # The commit of what the preview showed is heard too.
    browser.reply({"type": "select", "selection": preview, "phase": "commit", "basis": "c:4"})
    assert [(event.phase, event.basis) for event in events] == [
        ("preview", "c:3"),
        ("commit", "c:4"),
    ]
    assert widget.selection == hg.BrushSelection(x=(0.0, 1.0))
    # An answer on an older report changes nothing, and is told the selection again.
    widget.select((1.0, 2.0), expected="c:3")
    assert widget.selection == hg.BrushSelection(x=(0.0, 1.0))
    assert events[-1] == hg.SelectEvent(hg.BrushSelection(x=(0.0, 1.0)), basis="c:4")
    widget.select((1.0, 2.0), expected="c:4")
    assert widget.selection == hg.BrushSelection(x=(1.0, 2.0))
    # Python's own write is newer than every report before it.
    widget.select((0.0, 2.0), expected="c:4")
    assert widget.selection == hg.BrushSelection(x=(1.0, 2.0))
    # Items and series come by their keys.
    items = {"kind": "items", "items": ['[0,"row",1]']}
    browser.reply({"type": "select", "selection": items, "phase": "commit", "basis": "c:5"})
    assert widget.selection == hg.ItemSelection(('[0,"row",1]',))
    assert decode_selection({"kind": "series", "series": ['[0,"v"]']}) == hg.SeriesSelection(
        ('[0,"v"]',)
    )


def test_widgets_start_from_the_charts_first_state():
    first = hg.BrushSelection(x=(0.0, 1.0))
    widget = hg.Chart(DATA, selection=first, visibility=['[0,"v"]']).line(x="t", y="v").widget()
    assert widget.selection == first
    assert widget.hidden_keys == ('[0,"v"]',)
    tree = {"a": ["x", "x", "y"], "b": ["p", "q", "r"], "v": [1.0, 2.0, 3.0]}
    drilled = hg.Chart(tree, drill_root='["x"]').sunburst(path=["a", "b"], value="v").widget()
    assert drilled.drill_root == ('["x"]',)


def test_widgets_tell_selections_of_items_and_series_apart():
    items = encode_selection(hg.ItemSelection(('[0,"a"]', '[0,"b"]')))
    same = encode_selection(hg.ItemSelection(('[0,"b"]', '[0,"a"]')))
    series = encode_selection(hg.SeriesSelection(('[0,"a"]', '[0,"b"]')))
    assert same_values(items, same)
    assert not same_values(items, series)
    assert not same_values(items, None)
    widget = hg.Chart(DATA, select="items").point(x="t", y="v").widget()
    heard: list[hg.SelectEvent] = []
    widget.on_select(heard.append)
    widget.selection = hg.ItemSelection(('[0,"a"]',))
    widget.selection = None
    assert [event.selection for event in heard] == [hg.ItemSelection(('[0,"a"]',)), None]
    assert widget.selection is None


def test_widgets_give_references_back_as_references():
    widget = hg.Chart(DATA, select="items").point(x="t", y="v", id="dots").widget()
    heard: list[hg.SelectEvent] = []
    widget.on_select(heard.append)
    items = hg.ItemSelection((hg.ItemReference("dots", ("row", 1)), '["dots","x"]'))
    widget.selection = items
    assert widget.selection == items
    assert heard[-1].selection == items
    # What is read is written back as it is.
    widget.selection = widget.selection
    series = hg.SeriesSelection((hg.SeriesReference("dots", "v"),))
    widget.selection = series
    assert widget.selection == series


def test_keys_from_events_read_as_references():
    chart = (
        hg.Chart(DATA)
        .line(x="t", y="v", series="s", id="lines")
        .bar(x="t", y="v", id="bars")
        .point(x="t", y="v")
    )
    assert chart.reference_of("series", '["lines","a"]') == hg.SeriesReference("lines", "a")
    assert chart.reference_of("item", '["bars","row",1]') == hg.ItemReference("bars", ("row", 1))
    # A bin's interval is a tuple, as references hold it.
    assert chart.reference_of("item", '["bars",[0,5]]') == hg.ItemReference("bars", ((0, 5),))
    # The kind says what the key is: a series key and an item key can be one text.
    assert chart.reference_of("item", '["lines","a"]') == hg.ItemReference("lines", ("a",))
    # Of no mark of the chart, of a mark without an id, or no key at all: None.
    for key in (
        '["other","a"]',
        '[2,"v"]',
        '["lines"]',
        '["lines","a","b"]',
        "not json",
        "{}",
        '[[],"a"]',
        '[{},"a"]',
    ):
        assert chart.reference_of("series", key) is None, key
    assert chart.reference_of("item", '["bars"]') is None
    # What JSON.parse refuses, as TypeScript's chart.referenceOf does.
    assert chart.reference_of("item", '["bars",NaN]') is None
    with pytest.raises(
        hg.ChartError, match='Chart.reference_of kind: expected "series" or "item"; received "row"'
    ):
        chart.reference_of("row", '["lines","a"]')  # type: ignore[call-overload]
    with pytest.raises(
        hg.ChartError, match="Chart.reference_of key: expected a string; received 3"
    ):
        chart.reference_of("series", 3)  # type: ignore[call-overload]


def test_widgets_read_keys_as_references_of_the_chart_they_show():
    widget = hg.Chart(DATA, select="series").line(x="t", y="v", series="s", id="lines").widget()
    assert widget.reference_of("series", '["lines","b"]') == hg.SeriesReference("lines", "b")
    assert widget.reference_of("item", '["lines","row",0]') == hg.ItemReference("lines", ("row", 0))
    assert widget.reference_of("series", '["bars","b"]') is None
    with pytest.raises(
        hg.ChartError, match='widget.reference_of kind: expected "series" or "item"'
    ):
        widget.reference_of("rows", '["lines","b"]')  # type: ignore[call-overload]
    with pytest.raises(
        hg.ChartError, match="widget.reference_of key: expected a string; received 3"
    ):
        widget.reference_of("series", 3)  # type: ignore[call-overload]
