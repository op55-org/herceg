"""Maps, networks, and trees in facets and subplots: what charts take, and the
interaction state live charts keep per subplot."""

from datetime import datetime

import pytest

import herceg as hg
from herceg._events import decode_selection, encode_selection

SALES = {
    "year": ["2023", "2023", "2024", "2024"],
    "region": ["Europe", "Asia", "Europe", "Asia"],
    "country": ["France", "Japan", "Spain", "India"],
    "revenue": [40.0, 30.0, 20.0, 60.0],
}
LINKS = {
    "year": ["2023", "2023", "2024"],
    "source": ["a", "b", "a"],
    "target": ["b", "c", "c"],
}
SQUARE = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "properties": {"name": name, "year": year},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[x, 0], [x + 10, 0], [x + 10, 10], [x, 10], [x, 0]]],
            },
        }
        for name, year, x in (("A", "2023", 0), ("B", "2024", 20))
    ],
}
CITIES = {"lon": [5.0, 25.0], "lat": [5.0, 5.0], "year": ["2023", "2024"]}


def test_maps_split_their_layers_in_facets_or_repeat_them():
    chart = (
        hg.Chart(CITIES, facet="year", zoom=True, brush="lasso")
        .geoshape(data=SQUARE, label_field="name", facet="repeat")
        .geopoint("lon", "lat")
    )
    spec, _ = chart.to_spec()
    assert [mark.get("facet") for mark in spec["marks"]] == ["repeat", None]
    assert spec["interaction"] == {"zoom": True, "brush": "lasso"}
    assert chart.to_svg().count("<path") > 0
    with pytest.raises(ValueError, match="geoshape facet: every layer of the map repeats"):
        hg.Chart(CITIES, facet="year").geoshape(data=SQUARE, facet="repeat").to_spec()


def test_maps_and_networks_fill_subplots_of_their_own():
    chart = (
        hg.Chart(CITIES, panels=["map", "net"], layout=hg.Grid(columns=2), zoom=True, drag=True)
        .geoshape(data=SQUARE, panel="map")
        .geopoint("lon", "lat", panel="map")
        .graph("source", "target", data=LINKS, panel="net")
    )
    spec, _ = chart.to_spec()
    assert [mark["panel"] for mark in spec["marks"]] == ["map", "map", "net"]
    # Panels drawing only maps and networks pan and zoom them both ways, and lasso them.
    lassoed = (
        hg.Chart(CITIES, panels=["a", "b"], zoom="xy", brush="lasso")
        .geopoint("lon", "lat", panel="a")
        .geopoint("lon", "lat", panel="b")
    )
    assert lassoed.to_spec()[0]["interaction"] == {"zoom": "xy", "brush": "lasso"}
    beside = (
        hg.Chart(CITIES, panels=["line", "map"], brush="lasso")
        .line("lon", "lat", panel="line")
        .geopoint("lon", "lat", panel="map")
    )
    # A lasso is drawn in the panel it starts in, a map's or one with axes.
    assert beside.to_spec()[0]["interaction"] == {"brush": "lasso"}
    with pytest.raises(ValueError, match='geopoint panel: a pie has panel "a" to itself'):
        hg.Chart(SALES, panels=["a"]).pie("region", panel="a").geopoint(
            "lon", "lat", data=CITIES, panel="a"
        )


def test_panels_without_axes_refuse_scoping_scales():
    message = "Chart x scope: every panel draws a geopoint or another mark without axes"
    with pytest.raises(ValueError, match=message):
        hg.Chart(CITIES, panels=["a"], x=hg.AxisOptions(scope="panel")).geopoint(
            "lon", "lat", panel="a"
        ).to_spec()
    with pytest.raises(ValueError, match="Chart y scope: every panel draws a geoshape"):
        hg.Chart(CITIES, facet="year", y=hg.AxisOptions(scope="panel")).geoshape(
            data=SQUARE, facet="repeat"
        ).geopoint("lon", "lat").to_spec()
    # Shared, as the panels' scales would be, they take.
    shared = hg.Chart(CITIES, panels=["a"], x=hg.AxisOptions(scope="chart")).geopoint(
        "lon", "lat", panel="a"
    )
    assert shared.to_spec()[0]["x"] == {"scope": "chart"}
    # Beside panels with axes, those scales are scoped.
    beside = (
        hg.Chart(CITIES, panels=["line", "map"], y=hg.AxisOptions(scope="panel"))
        .line("lon", "lat", panel="line")
        .geopoint("lon", "lat", panel="map")
    )
    assert beside.to_spec()[0]["y"] == {"scope": "panel"}


def test_trees_in_facets_drill_and_select_rows():
    chart = hg.Chart(
        SALES, facet="year", zoom=True, row_selection=hg.SelectionBinding("picked")
    ).treemap(["region", "country"], "revenue")
    spec, _ = chart.to_spec()
    assert spec["interaction"] == {"zoom": True}
    with pytest.raises(ValueError, match="Chart zoom: a treemap drills with zoom=True"):
        hg.Chart(SALES, facet="year", zoom="x").treemap(["region"])


def test_a_lasso_names_the_subplot_it_is_drawn_in():
    selection = hg.Selection(lasso=((0.0, 0.0), (1.0, 0.0), (1.0, 1.0)), panels=("map",))
    encoded = encode_selection(selection)
    assert encoded is not None and encoded["panels"] == ["map"]
    assert decode_selection(encoded) == selection
    with pytest.raises(ValueError, match="Selection panels: expected a tuple of panel ids"):
        encode_selection(hg.Selection(lasso=selection.lasso, panels=("map", 1)))  # type: ignore[arg-type]


pytest.importorskip("anywidget")


class Browser:
    """Records what a widget sends, and replies as a browser would."""

    def __init__(self, widget):
        self.widget = widget
        self.sent = []
        widget.comm.send = lambda data=None, buffers=None, **_: self.sent.append((data, buffers))

    def reply(self, content):
        self.widget._handle_custom_msg(content, [])

    @property
    def messages(self):
        return [data["content"] for data, _ in self.sent if data["method"] == "custom"]


def two_trees():
    return (
        hg.Chart(SALES, panels=["a", "b"], zoom=True)
        .treemap(["region", "country"], "revenue", panel="a")
        .sunburst(["region"], "revenue", panel="b")
        .widget()
    )


def test_widgets_keep_each_subplot_trees_root():
    widget = two_trees()
    browser = Browser(widget)
    assert widget.panel_drill_roots == {"a": None, "b": None}
    with pytest.raises(ValueError, match="widget.drill_root: the chart's treemap or sunburst"):
        _ = widget.drill_root
    heard = {"a": [], "b": []}
    widget.on_drill(heard["a"].append, panel="a")
    widget.on_drill(heard["b"].append, panel="b")
    widget.panel_drill_roots = {"b": ('[1,"Asia"]',)}
    assert widget.panel_drill_roots == {"a": None, "b": ('[1,"Asia"]',)}
    assert browser.messages[-1] == {
        "type": "drill",
        "drill_root": {"path": ['[1,"Asia"]']},
        "panel": "b",
        "revision": 1,
    }
    # The browser drills the other one.
    browser.reply(
        {"type": "drill", "drill_root": {"path": ['[0,"Europe"]']}, "panel": "a", "revision": 1}
    )
    assert heard == {"a": [('[0,"Europe"]',)], "b": [('[1,"Asia"]',)]}
    # A panel without a tree of its own, and its callbacks, are refused.
    with pytest.raises(ValueError, match="widget.panel_drill_roots: no panel 'c' of its kind"):
        widget.panel_drill_roots = {"c": None}
    with pytest.raises(ValueError, match="widget.on_drill panel: no panel 'c'"):
        widget.on_drill(print, panel="c")
    with pytest.raises(ValueError, match="widget.drill_root: the chart's treemap or sunburst"):
        widget.on_drill(print)
    state = widget.get_state()["_chart"]
    assert state["panel_states"]["drill"] == {
        "a": {"path": ['[0,"Europe"]']},
        "b": {"path": ['[1,"Asia"]']},
    }


def plane_views(panel, x, y):
    """The views a browser reports of a chart whose subplots are maps or networks."""
    view = {"x": x, "y": y, "yRight": None, "time": []}
    return {"axes": {"viewRevision": 1, "scales": [], "views": []}, "planes": {panel: view}}


def test_widgets_keep_each_subplot_networks_moves_and_views():
    widget = (
        hg.Chart(LINKS, panels=["a", "b"], drag=True, zoom=True)
        .graph("source", "target", panel="a")
        .graph("source", "target", panel="b")
        .widget()
    )
    browser = Browser(widget)
    widget.panel_item_positions = {"a": {'[0,"a"]': (1, 2)}}
    assert widget.panel_item_positions == {"a": {'[0,"a"]': (1.0, 2.0)}, "b": {}}
    events = []
    widget.on_viewport(events.append, panel="b")
    view = {"panel": "b", "x": [0, 10], "y": [0, 5], "yRight": None, "time": []}
    scales = [
        {"scale": axis, "instance": "b", "time": False, "panels": ["b"], "view": ends}
        for axis, ends in (("x", [0, 10]), ("y", [0, 5]))
    ]
    browser.reply(
        {
            "type": "viewport",
            "views": plane_views("b", [0, 10], [0, 5]),
            "event": {"viewRevision": 1, "cause": "wheel", "panel": "b", "scales": scales}
            | {"views": [view]},
            "revision": 1,
        }
    )
    assert widget.panel_viewports == {"b": hg.Viewport(x=(0.0, 10.0), y=(0.0, 5.0))}
    assert widget.get_viewport(panel="b") == hg.Viewport(x=(0.0, 10.0), y=(0.0, 5.0))
    assert [event.views["b"] for event in events] == [hg.Viewport(x=(0.0, 10.0), y=(0.0, 5.0))]
    # Each subplot's plane has its own view: none is the chart's.
    with pytest.raises(hg.ChartError, match="widget.get_viewport: each map or network subplot"):
        widget.get_viewport()
    # New data keeps the moves of nodes it still has, and lets the others go.
    widget.replace(LINKS, data=None)
    assert widget.panel_item_positions == {"a": {'[0,"a"]': (1.0, 2.0)}, "b": {}}
    widget.replace({"source": ["b"], "target": ["c"]}, data=None)
    assert widget.panel_item_positions == {"a": {}, "b": {}}


def test_widgets_keep_moves_of_networks_whose_data_did_not_change():
    nodes = {"name": ["a", "b", "c"], "team": ["x", "x", "y"]}
    widget = (
        hg.Chart(CITIES, panels=["map", "net"], drag=True)
        .geopoint("lon", "lat", panel="map")
        .graph("source", "target", data=LINKS, nodes=nodes, node="name", panel="net")
        .widget()
    )
    Browser(widget)
    heard = []
    widget.on_item_move(heard.append, panel="net")
    moved = {'[1,"a"]': (1.0, 2.0)}
    widget.panel_item_positions = {"net": moved}
    # New places for the map leave the network be.
    widget.append({"lon": [1.0], "lat": [2.0]})
    assert widget.panel_item_positions == {"net": moved}
    # New links, or new nodes, keep the moves of the nodes they still have.
    widget.replace(LINKS, data=LINKS)
    assert widget.panel_item_positions == {"net": moved}
    widget.replace({"name": ["b", "c"], "team": ["x", "y"]}, data=nodes)
    assert widget.panel_item_positions == {"net": moved}
    widget.replace({"source": ["b"], "target": ["c"]}, data=LINKS)
    assert widget.panel_item_positions == {"net": {}}
    assert heard == [moved, {}]


def test_widgets_check_layout_marks_options_when_made_and_updated():
    with pytest.raises(ValueError, match="Chart y scope: every panel draws a geopoint"):
        hg.Chart(CITIES, panels=["a"], y=hg.AxisOptions(scope="panel")).geopoint(
            "lon", "lat", panel="a"
        ).widget()
    widget = hg.Chart(CITIES, facet="year").geopoint("lon", "lat").widget()
    with pytest.raises(ValueError, match="Chart y scope: every panel draws a geopoint"):
        widget.update(y=hg.AxisOptions(scope="panel"))
    with pytest.raises(ValueError, match='Chart zoom: expected True or "xy"'):
        widget.update(zoom="x")
    with pytest.raises(ValueError, match="Chart sync: a geopoint has no x axis"):
        widget.update(sync="dashboard")
    subplots = (
        hg.Chart(CITIES, panels=["a", "b"])
        .geopoint("lon", "lat", panel="a")
        .graph("source", "target", data=LINKS, panel="b")
        .widget()
    )
    with pytest.raises(ValueError, match="Chart brush: every panel draws a geopoint"):
        subplots.update(brush="x")
    subplots.update(zoom=True, brush="lasso")
    maps = hg.Chart(CITIES, panels=["a"]).geopoint("lon", "lat", panel="a").widget()
    with pytest.raises(ValueError, match="Chart drag: moves a network's nodes, and the chart"):
        maps.update(drag=True)
    beside = (
        hg.Chart(CITIES, panels=["line", "map"])
        .line("lon", "lat", panel="line")
        .geopoint("lon", "lat", panel="map")
        .widget()
    )
    # A map beside axes zooms both ways, and the axes as the chart says.
    beside.update(zoom="xy", brush="lasso")
    beside.update(zoom="y", brush="xy")


def test_widgets_of_map_subplots_alone_set_each_view():
    widget = (
        hg.Chart(CITIES, panels=["a", "b"], zoom=True)
        .geopoint("lon", "lat", panel="a")
        .geopoint("lon", "lat", panel="b")
        .widget()
    )
    browser = Browser(widget)
    with pytest.raises(ValueError, match="a map or network has no right y axis; drop y_right"):
        widget.set_viewport(hg.Viewport(x=(0.0, 1.0), y_right=(0.0, 1.0)), panel="a")
    for ends in (("A", "B"), (datetime(2024, 1, 1), 1.0), (False, True)):
        with pytest.raises(ValueError, match=r"set_viewport x(\[0\])?: expected .*finite number"):
            widget.set_viewport(x=ends, panel="a")
    with pytest.raises(ValueError, match="widget.set_viewport panel: no panel 'c'"):
        widget.set_viewport((0.0, 1.0), panel="c")
    widget.set_viewport((0.0, 1.0), panel="a")
    assert browser.messages[-1]["panel"] == "a"


def test_widgets_set_a_facet_map_view_in_its_plane_units():
    widget = hg.Chart(CITIES, facet="year", zoom=True).geopoint("lon", "lat").widget()
    browser = Browser(widget)
    with pytest.raises(ValueError, match="widget.set_viewport y_right: a map or network has no"):
        widget.set_viewport(hg.Viewport(x=(0.0, 1.0), y_right=(0.0, 1.0)))
    with pytest.raises(ValueError, match="widget.set_viewport x: expected finite numbers"):
        widget.set_viewport((datetime(2024, 1, 1), 1.0))
    widget.set_viewport(hg.Viewport(x=(0.0, 1.0), y=(2.0, 3.0)))
    assert browser.messages[-1]["viewport"] == {
        "x": [0.0, 1.0],
        "y": [2.0, 3.0],
        "yRight": None,
        "time": [],
    }


def test_widgets_share_one_state_across_facet_panels():
    widget = hg.Chart(SALES, facet="year", zoom=True).treemap(["region"], "revenue").widget()
    browser = Browser(widget)
    widget.drill_root = ('[0,"Asia"]',)
    assert browser.messages[-1]["type"] == "drill" and "panel" not in browser.messages[-1]
    assert widget.panel_drill_roots == {}


def test_streamlit_state_holds_each_subplot_state():
    hst = pytest.importorskip("herceg.streamlit")
    state = hst._state(
        {
            "drill_root": {"root": None, "panels": {"b": {"path": ['[1,"Asia"]']}}},
            "item_positions": {
                "epoch": "layout",
                "positions": {},
                "panels": {"n": {'[2,"a"]': [1, 2]}},
            },
            "viewport": {
                "x": None,
                "y": None,
                "yRight": None,
                "panels": {"m": {"x": [0, 1], "y": [2, 3], "yRight": None}},
            },
        },
        item_epoch="layout",
    )
    assert state.drill_root is None
    assert state.panel_drill_roots == {"b": ('[1,"Asia"]',)}
    assert state.panel_item_positions == {"n": {'[2,"a"]': (1.0, 2.0)}}
    assert state.panel_viewports == {"m": hg.Viewport(x=(0.0, 1.0), y=(2.0, 3.0))}


LATENCY = {
    "t": [0.0, 1.0, 2.0, 3.0],
    "p99": [120.0, 180.0, 150.0, 130.0],
    "errors": [3.0, 5.0, 2.0, 4.0],
}


def two_panels(**options):
    """Two subplots side by side, each with an x scale of its own."""
    chart = hg.Chart(LATENCY, zoom="x", brush="x", **options)
    left, right = chart.columns([2, 1])
    left.panel("latency").line(x="t", y="p99")
    right.panel("errors").line(x="t", y="errors")
    return chart


def view(x):
    return {"x": x, "y": None, "yRight": None, "time": []}


def own_views(**panels):
    """What a browser reports of subplots each with an x scale of its own: by panel, its x range."""
    shown = {key: {"panel": key} | view(x) for key, x in panels.items()}
    scales = [
        {"scale": "x", "instance": f'["{key}"]', "time": False, "panels": [key], "view": x}
        | {"identity": f'["x","linear","[\\"{key}\\"]"]'}
        for key, x in panels.items()
    ]
    return {
        "axes": {"viewRevision": 1, "scales": scales, "views": list(shown.values())},
        "planes": {},
    }


def test_live_subplots_keep_each_panels_view_and_selection():
    widget = two_panels().widget()
    browser = Browser(widget)
    assert widget.panel_viewports == {}
    heard = []
    widget.on_viewport(heard.append, panel="errors")
    # Zooming a panel in a browser changes that panel's view only.
    reported = own_views(latency=[0, 1], errors=None)
    event = {"viewRevision": 1, "cause": "wheel", "panel": "latency", "scales": [], "views": []}
    browser.reply({"type": "viewport", "views": reported, "event": event})
    assert widget.panel_viewports == {
        "latency": hg.Viewport(x=(0.0, 1.0)),
        "errors": hg.Viewport(),
    }
    assert heard == []
    # Python asks for a change of one panel's view; the browsers make it.
    widget.set_viewport(x=(0.5, 1.5), y=(100.0, 200.0), panel="latency")
    sent = browser.messages[-1]
    assert (sent["type"], sent["panel"], sent["viewport"]) == (
        "setViewport",
        "latency",
        {"x": [0.5, 1.5], "y": [100.0, 200.0], "time": []},
    )
    with pytest.raises(ValueError, match="widget.selection panels: no panel 'p50'"):
        widget.selection = hg.Selection(x=(0.0, 1.0), panels=("p50",))
    # A brush in a panel is the selection, of that panel; Python brushes another.
    selections = []
    widget.on_select(selections.append)
    brushed = {"x": [1, 2], "y": None, "lasso": None, "panels": ["errors"], "time": []}
    browser.reply({"type": "select", "selection": brushed})
    assert widget.selection == hg.Selection(x=(1.0, 2.0), panels=("errors",))
    widget.selection = hg.Selection(y=(100.0, 150.0), panels=("latency",))
    assert browser.messages[-1]["selection"]["panels"] == ["latency"]
    assert selections == [
        hg.Selection(x=(1.0, 2.0), panels=("errors",)),
        hg.Selection(y=(100.0, 150.0), panels=("latency",)),
    ]


def test_live_views_refuse_reports_from_before_their_scales_changed():
    widget = two_panels().widget()
    browser = Browser(widget)
    # The panels of a row share a scale now; a browser's zoom from before arrives.
    widget.update(x=hg.AxisOptions(scope="row"))
    browser.reply(
        {
            "type": "viewport",
            "views": own_views(latency=[1.0, 2.0], errors=None),
            "origin": "old",
            "revision": 0,
        }
    )
    assert widget.panel_viewports == {}


def test_live_facet_panels_take_x_scales_of_their_own():
    data = LATENCY | {"g": ["a", "a", "b", "b"]}
    for facet in ({"facet": "g"}, {"facet_row": "g"}):
        chart = hg.Chart(data, **facet, x=hg.AxisOptions(scope="panel"), zoom="xy", brush="y")
        widget = chart.line(x="t", y="p99").widget()
        widget.update(x=hg.AxisOptions(scope="row"))
        widget.set_viewport(y=(100.0, 200.0), panel="a")


def test_streamlit_state_holds_each_panels_view():
    hst = pytest.importorskip("herceg.streamlit")
    assert hst.chart(two_panels(), on_select="rerun", on_viewport="rerun") == hst.ChartState()
    # As the component reports it: no x scale every panel shares, so no chart-wide x view.
    state = hst._state(
        {
            "viewport": {
                **view(None),
                "panels": {"latency": view([0, 1]), "errors": view([2, 3])},
            }
        },
        item_epoch=None,
    )
    assert state.viewport == hg.Viewport()
    assert state.panel_viewports == {
        "latency": hg.Viewport(x=(0.0, 1.0)),
        "errors": hg.Viewport(x=(2.0, 3.0)),
    }
