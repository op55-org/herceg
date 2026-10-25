"""Every public callable of herceg is in a closed inventory below: each has a
valid call, and each of its arguments, given values of no type it takes, is
refused as a ChartError at that argument (or taken, where a value may be);
NumPy's forms of the valid values are taken as Python's are."""

from __future__ import annotations

import dataclasses
import inspect
import json
import re
import sys
import typing
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest
from flask import Flask
from malformed import arguments, malformed, misplaced, refusal, said, twins

import herceg as hg
import herceg.express as hx
import herceg.flask as flask
import herceg.streamlit as hst
import herceg.web as web
from herceg._errors import UnknownOption
from herceg.widget import ChartWidget

DATA = {
    "t": [0.0, 1.0, 2.0, 3.0],
    "v": [1.0, 2.0, 3.0, 4.0],
    "w": [2.0, 3.0, 4.0, 5.0],
    "s": ["a", "b", "a", "b"],
    "u": ["b", "c", "c", "a"],
}
TREE = {"first": [0, 2, 5], "second": [1, 3, 4], "height": [1.0, 2.0, 4.0]}
LEAVES = ["a", "b", "c", "d"]
GRID = {"x": [0.0, 1.0, 0.0, 1.0], "y": [0.0, 0.0, 1.0, 1.0], "z": [1.0, 2.0, 3.0, 4.0]}
MATRIX = {"x": [0.0, 1.0], "y": [0.0, 1.0], "z": [1.0, 2.0, 3.0, 4.0]}
SHAPES = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "id": "01",
            "properties": {"zone": "N", "gdp": 10.0},
            "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]},
        }
    ],
}

# A panel's settings, which are the chart's panels' whichever method makes it.
PANEL_SETTINGS = [field.name for field in dataclasses.fields(hg.Panel) if field.init]

# Each mark with what it needs to be drawn, from the columns above.
MARKS: dict[str, dict[str, Any]] = {
    "area": {"x": "t", "y": "v"},
    "bar": {"x": "s", "y": "v"},
    "boxen": {"x": "s", "y": "v"},
    "boxplot": {"x": "s", "y": "v"},
    "candlestick": {"x": "t", "open": "v", "high": "w", "low": "v", "close": "w"},
    "contour": {"x": "x", "y": "y", "color": "z", "data": GRID},
    "dendrogram": {
        "first": "first",
        "second": "second",
        "height": "height",
        "leaves": LEAVES,
        "data": TREE,
    },
    "errorbar": {"x": "t", "y1": "v", "y2": "w"},
    "funnel": {"category": "s", "value": "v"},
    "gauge": {"value": "v"},
    "geopoint": {"longitude": "t", "latitude": "v"},
    "geoshape": {"color": "gdp", "data": SHAPES},
    "graph": {"source": "s", "target": "u"},
    "heatmap": {"x": "s", "y": "u", "color": "v"},
    "histogram": {"x": "v"},
    "line": {"x": "t", "y": "v"},
    "line_3d": {"x": "t", "y": "v", "z": "w"},
    "pie": {"category": "s", "value": "v"},
    "point": {"x": "t", "y": "v"},
    "point_3d": {"x": "t", "y": "v", "z": "w"},
    "radar": {"category": "u", "value": "v"},
    "region": {"x1": 0.0, "x2": 1.0},
    "rug": {"x": "v"},
    "rule": {"y": 1.0},
    "sankey": {"source": "s", "target": "u", "value": "v"},
    "sunburst": {"path": ["s", "u"], "value": "v"},
    "surface": {"x": "x", "y": "y", "z": "z", "data": GRID},
    "text": {"label": "s", "x": "t", "y": "v"},
    "treemap": {"path": ["s", "u"], "value": "v"},
    "violin": {"x": "s", "y": "v"},
}

# Arguments that replace others of the mark's above, given with what they need instead.
ALONE: dict[tuple[str, str], dict[str, Any]] = {
    ("radar", "fields"): {},
    ("text", "from_"): {"label": "s"},
    ("area", "x1"): {"x2": "w", "y": "v"},
    ("area", "x2"): {"x1": "t", "y": "v"},
    ("area", "y1"): {"x": "t", "y2": "w"},
    ("area", "y2"): {"x": "t", "y1": "v"},
    ("errorbar", "x_error"): {"x": "t", "y": "v"},
    ("errorbar", "y_error"): {"x": "t", "y": "v"},
    ("heatmap", "date"): {"color": "v"},
    ("heatmap", "x1"): {"x2": "w", "y": "u", "color": "v"},
    ("heatmap", "x2"): {"x1": "t", "y": "u", "color": "v"},
    ("heatmap", "y1"): {"x": "s", "y2": "w", "color": "v"},
    ("heatmap", "y2"): {"x": "s", "y1": "t", "color": "v"},
    ("region", "y1"): {"x1": 0.0, "x2": 1.0, "y2": 1.0},
    ("region", "y2"): {"x1": 0.0, "x2": 1.0, "y1": 0.0},
    ("rug", "y"): {},
    ("rule", "x"): {},
    ("treemap", "node"): {"parent": "u", "value": "v"},
    ("treemap", "parent"): {"node": "s", "value": "v"},
    ("sunburst", "node"): {"parent": "u", "value": "v"},
    ("sunburst", "parent"): {"node": "s", "value": "v"},
    ("geoshape", "geojson"): {"data": {"zone": ["N"], "id": ["01"]}, "locations": "id"},
    ("geoshape", "locations"): {"data": {"zone": ["N"], "id": ["01"]}, "geojson": SHAPES},
}
# Express options read only of two columns, given those.
_PAIR = {"data": DATA, "x": "t", "y": "v"}
EXPRESS_ALONE = {
    "kdeplot": {"levels": _PAIR, "thresh": _PAIR, "filled": _PAIR},
    "histplot": {"binwidth": _PAIR, "binrange": _PAIR, "discrete": _PAIR},
}
# Marks' options that take a matrix of values in place of a column.
MATRICES = {
    "contour": frozenset({"color"}),
    "heatmap": frozenset({"color"}),
    "surface": frozenset({"z"}),
}
# A box plot of statistics, given in place of raw values.
STATISTICS = {"x": "s", "low": "v", "q1": "v", "median": "v", "q3": "w", "high": "w", "count": "v"}
ALONE |= {("boxplot", name): STATISTICS for name in STATISTICS if name != "x"}


@dataclasses.dataclass(frozen=True)
class Call:
    """A valid call of a public callable, ``make(**given)``. An argument's
    refusal is at ``at`` and its name, and one of the options it unpacks at
    ``options_at`` and theirs."""

    make: Callable[..., Any]
    given: Mapping[str, Any] = dataclasses.field(default_factory=dict)
    at: str = ""
    options_at: str = ""
    # The function whose arguments these are, where ``make`` wraps it.
    function: Callable[..., Any] | None = None
    # Where the one argument is, for a property set to it.
    setting: str | None = None
    # Arguments at paths of their own (a helper's data is its chart's).
    paths: Mapping[str, str] = dataclasses.field(default_factory=dict)
    # Arguments whose malformed dicts or lists other arguments reading them
    # may be blamed for (a matrix's columns lacking those its x and y name;
    # a matrix of values where the call's data and x name columns).
    relational: frozenset[str] = frozenset()
    # Arguments that take tables (see `malformed`).
    tables: frozenset[str] = frozenset({"data", "nodes"})
    # Arguments made afresh for each call.
    fresh: Mapping[str, Callable[[], Any]] = dataclasses.field(default_factory=dict)

    def arguments(self, given: Mapping[str, Any]) -> dict[str, Any]:
        """`given`, with what is made afresh for each call made again."""
        return {**{name: make() for name, make in self.fresh.items()}, **given}

    alone: Mapping[str, Mapping[str, Any]] = dataclasses.field(default_factory=dict)


def _line() -> hg.Chart:
    return hg.Chart(DATA).line(x="t", y="v")


def _panel() -> hg.Panel:
    return hg.Chart(DATA).columns(2)[0].panel("a")


def _method(owner: Callable[[], Any], name: str) -> Callable[..., Any]:
    return lambda **given: getattr(owner(), name)(**given)


def _setter(owner: Callable[[], Any], name: str) -> Callable[..., Any]:
    def assign(value: Any) -> None:
        setattr(owner(), name, value)

    return assign


def _streamlit_chart(**given: Any) -> Any:
    import logging

    logging.getLogger("streamlit").setLevel(logging.ERROR)
    return hst.chart(**given)


def _widget() -> ChartWidget:
    return hg.Chart(DATA, brush="xy").line(x="t", y="v", series="s").widget()


def _tree() -> ChartWidget:
    return hg.Chart(DATA).treemap(path=["s", "u"], value="v").widget()


def _network() -> ChartWidget:
    return hg.Chart(DATA).graph(source="s", target="u").widget()


def _box() -> ChartWidget:
    return hg.Chart(DATA).point_3d(x="t", y="v", z="w").widget()


# The widget each method and property is of: one drawing what it reads or sets.
WIDGETS = {
    "on_drill": _tree,
    "drill_root": _tree,
    "panel_drill_roots": _tree,
    "on_item_move": _network,
    "item_positions": _network,
    "panel_item_positions": _network,
    "on_camera": _box,
    "camera": _box,
    "panel_cameras": _box,
}


def _calls(tmp: Path) -> dict[str, Call]:
    calls: dict[str, Call] = {
        "hg.Chart": Call(
            lambda data=DATA, **given: hg.Chart(data, **given).line(x="t", y="v"),
            function=hg.Chart.__init__,
        ),
    }
    for name, needs in MARKS.items():
        calls[f"Chart.{name}"] = Call(
            _method(lambda: hg.Chart(DATA), name),
            needs,
            "marks[0].",
            function=getattr(hg.Chart, name),
            relational=MATRICES.get(name, frozenset()),
            alone={given: needed for (mark, given), needed in ALONE.items() if mark == name},
        )
    # A panel of a layout takes marks through its methods, as the chart does.
    for name, needs in MARKS.items():
        if name not in vars(hg.Panel):
            continue
        calls[f"Panel.{name}"] = Call(
            _method(_panel, name),
            needs,
            "marks[0].",
            function=getattr(hg.Panel, name),
            relational=MATRICES.get(name, frozenset()),
            alone={given: needed for (mark, given), needed in ALONE.items() if mark == name},
        )
    # A panel's own settings are the chart's panels' (an inset is the second).
    calls["Panel.inset"] = Call(
        _method(_panel, "inset"),
        {"id": "detail"},
        function=hg.Panel.inset,
        paths={name: f"panels[1].{name}" for name in PANEL_SETTINGS},
        # An anchor places an inset at a position.
        alone={
            "anchor": {"id": "detail", "place": hg.Position(hg.Fraction(0.5), hg.Fraction(0.5))}
        },
    )
    calls["Panel.legend"] = Call(_method(_panel, "legend"), {}, function=hg.Panel.legend)
    # Helpers: a mark's arguments, and options of the chart.
    helpers = {
        name: needs
        for name, needs in MARKS.items()
        if name in vars(hg) and name not in ("line_3d", "geoshape")
    }
    helpers |= {
        "line_3d": MARKS["line_3d"],
        "scatter": MARKS["point"],
        "scatter_3d": MARKS["point_3d"],
        "scatter_geo": MARKS["geopoint"],
        "choropleth": {"color": "gdp", "data": SHAPES},
    }
    for name, needs in helpers.items():
        given = {"data": DATA, **needs}
        calls[f"hg.{name}"] = Call(
            getattr(hg, name),
            given,
            "marks[0].",
            paths={"data": "data"},
            relational=MATRICES.get(name, frozenset()),
            alone={
                key: {"data": given["data"], **needed}
                for (mark, key), needed in ALONE.items()
                if mark == {"scatter": "point", "scatter_3d": "point_3d"}.get(name, name)
            },
        )
    calls |= {
        "hg.axis": Call(hg.axis, {"scale": "x"}),
        "hg.legend": Call(hg.legend),
        "hg.colorbar": Call(hg.colorbar),
        "hg.col": Call(hg.col, {"name": "v"}),
        "hg.when": Call(hg.when, {"condition": hg.col("v") > 1, "then": 1, "otherwise": 2}),
        "hg.derive": Call(hg.derive, {"data": DATA}),
        "hg.matrix": Call(
            hg.matrix,
            {"columns": MATRIX, "x": "x", "y": "y"},
            relational=frozenset({"columns"}),
        ),
        "hg.to_pdf": Call(hg.to_pdf, {"charts": _line()}),
        "hg.save": Call(hg.save, {"charts": _line(), "path": tmp / "chart.svg"}),
    }
    # Outputs of a chart.
    for name, given in {
        "to_svg": {},
        "to_png": {},
        "to_image": {},
        "to_pdf": {},
        "to_html": {},
        "to_snapshot": {"id_prefix": "c"},
        "save": {"path": tmp / "chart.svg"},
    }.items():
        calls[f"Chart.{name}"] = Call(
            _method(_line, name),
            given,
            function=getattr(hg.Chart, name),
            alone={"quality": {"format": "jpeg"}} if name == "to_image" else {},
        )
    # Layouts of panels, and their cells.
    layouts: dict[str, tuple[Callable[[], Any], dict[str, Any]]] = {
        "Chart.grid": (lambda: hg.Chart(DATA), {"rows": 2, "columns": 2}),
        "Chart.columns": (lambda: hg.Chart(DATA), {"widths": 2}),
        "Chart.rows": (lambda: hg.Chart(DATA), {"heights": 2}),
        "Chart.mosaic": (lambda: hg.Chart(DATA), {"layout": [["a", "b"]]}),
        "Cell.grid": (lambda: hg.Chart(DATA).columns(2)[0], {"rows": 2, "columns": 2}),
        "Cell.columns": (lambda: hg.Chart(DATA).columns(2)[0], {"widths": 2}),
        "Cell.rows": (lambda: hg.Chart(DATA).columns(2)[0], {"heights": 2}),
        "Cell.panel": (lambda: hg.Chart(DATA).columns(2)[0], {"id": "a"}),
        "GridCells.cell": (
            lambda: hg.Chart(DATA).grid(rows=2, columns=2),
            {"row": 0, "column": 0},
        ),
    }
    for name, (owner, given) in layouts.items():
        kind, method = name.split(".")
        calls[name] = Call(
            _method(owner, method),
            given,
            function=getattr(getattr(hg, kind), method),
            paths={setting: f"panels[0].{setting}" for setting in PANEL_SETTINGS}
            if name == "Cell.panel"
            else {},
        )
    # Transform steps.
    for name, given in {
        "aggregate": {"by": "s", "n": "count"},
        "bin": {"column": "v"},
        "calculate": {"name": "x", "value": hg.col("v") * 2},
        "filter": {"condition": hg.col("v") > 1},
        "rolling": {"size": 2, "m": ("v", "mean")},
        "sort": {"column": "v"},
        "source_columns": {"used": ["v"]},
    }.items():
        calls[f"Derived.{name}"] = Call(
            _method(lambda: hg.derive(DATA), name), given, function=getattr(hg.Derived, name)
        )
    # Express: what each draws of the columns above.
    two = {"data": DATA, "x": "s", "y": "v"}
    for name, given in {
        "barplot": two,
        "boxenplot": two,
        "boxplot": two,
        "clustermap": {"data": {"a": [1.0, 2.0, 3.0], "b": [2.0, 1.0, 0.0], "c": [0.0, 1.0, 2.0]}},
        "ecdfplot": {"data": DATA, "x": "v"},
        "histplot": {"data": DATA, "x": "v"},
        "jointplot": {"data": DATA, "x": "t", "y": "v"},
        "kdeplot": {"data": DATA, "x": "v"},
        "lineplot": {"data": DATA, "x": "t", "y": "v", "n_boot": 10},
        "pairplot": {"data": {"a": DATA["t"], "b": DATA["v"], "c": DATA["w"]}},
        "pointplot": {**two, "n_boot": 10},
        "regplot": {"data": DATA, "x": "t", "y": "v", "n_boot": 10},
        "residplot": {"data": DATA, "x": "t", "y": "v"},
        "rugplot": {"data": DATA, "x": "v"},
        "stripplot": two,
        "swarmplot": two,
        "violinplot": two,
    }.items():
        calls[f"hx.{name}"] = Call(getattr(hx, name), given, alone=EXPRESS_ALONE.get(name, {}))
    calls |= {
        "hx.statistics": Call(hx.statistics, {"chart": hx.histplot(DATA, x="v")}),
        "hx.recompute": Call(
            lambda **given: hx.recompute(**given),
            {"chart": hx.histplot(DATA, x="v"), "data": DATA},
            function=hx.recompute,
        ),
        "web.fragment": Call(web.fragment, {"chart": _line()}),
        # Outside a script run, Streamlit shows nothing and says so.
        "streamlit.chart": Call(_streamlit_chart, {"chart": _line()}, function=hst.chart),
        "flask.init_app": Call(
            lambda **given: flask.init_app(**given),
            {"app": Flask("herceg-test")},
            function=flask.init_app,
            # A new app each call: an app registers a blueprint once.
            fresh={"app": lambda: Flask("herceg-test")},
        ),
        "web.payload": Call(web.payload, {"chart": _line()}),
        "web.assets": Call(web.assets, {"base_url": "/static"}),
        "web.asset_path": Call(web.asset_path, {"name": web.manifest().entry}),
        "web.selection": Call(web.selection, {"value": None}),
        "web.inspection": Call(web.inspection, {"value": None}),
        "web.viewport": Call(web.viewport, {"value": None}),
        "web.viewport_event": Call(
            web.viewport_event,
            {"value": {"viewRevision": 0, "cause": "api", "scales": [], "views": []}},
        ),
        "web.select_event": Call(
            web.select_event, {"value": {"owner": {"scales": [], "panels": []}, "selection": None}}
        ),
        "web.edge": Call(
            web.edge,
            {
                "value": {
                    "scale": "x",
                    "instance": "",
                    "time": False,
                    "panels": [""],
                    "side": "end",
                    "domain": [0, 1],
                    "bound": 1,
                    "cause": "api",
                }
            },
        ),
        "web.visibility": Call(web.visibility, {"value": {"hiddenKeys": []}}),
    }
    # A widget's methods and what may be set of it.
    for name, given in {
        "append": {"rows": {"t": [4.0], "v": [5.0], "s": ["a"]}},
        "replace": {"rows": DATA},
        "update": {},
        "show_cursor": {"x": 1.0},
        "hide_cursor": {},
        "on_select": {"callback": print},
        "on_viewport": {"callback": print},
        "get_viewport": {},
        "set_viewport": {"view": (0.0, 1.0)},
        "on_visibility": {"callback": print},
        "on_error": {"callback": print},
        "on_row_selection": {"callback": print},
        "on_drill": {"callback": print},
        "on_item_move": {"callback": print},
        "on_hover": {"callback": print},
        "on_click": {"callback": print},
        "on_edge": {"callback": print},
        "on_camera": {"callback": print},
    }.items():
        calls[f"ChartWidget.{name}"] = Call(
            _method(WIDGETS.get(name, _widget), name),
            given,
            function=getattr(ChartWidget, name),
            tables=frozenset({"rows", "data"}),
        )
    calls["ChartWidget"] = Call(ChartWidget, fresh={"chart": _line}, function=ChartWidget.__init__)
    for name, member in vars(ChartWidget).items():
        if isinstance(member, property) and member.fset is not None:
            calls[f"ChartWidget.{name}="] = Call(
                _setter(WIDGETS.get(name, _widget), name),
                {},
                function=inspect.unwrap(member.fset),
                setting=name,
            )
    return calls


# Callables no corpus above calls, and why.
EXCLUDED = {
    "hg.Cell": "made by a chart's or a cell's layout methods",
    "hg.GridCells": "made by grid()",
    "hg.Derived": "made by hg.derive",
    "hg.Expr": "made by hg.col and hg.when",
    "hg.Matrix": "made by hg.matrix",
    "Matrix.column": "looks a converted column up by name, a KeyError for one it lacks",
    "Expr.is_in": "takes values positionally; test_derive refuses them at their index",
    "ChartWidget.send_state": "ipywidgets' protocol, called by the notebook",
}


def _public() -> set[str]:
    """Every public function, constructor, method, and settable property."""
    names = set()

    def members(owner: type, label: str) -> None:
        for name, member in vars(owner).items():
            if name.startswith("_"):
                continue
            if callable(member) and not inspect.isclass(member):
                names.add(f"{label}.{name}")
            elif isinstance(member, property) and member.fset is not None:
                names.add(f"{label}.{name}=")

    for module, label in (
        (hg, "hg"),
        (hx, "hx"),
        (web, "web"),
        (hst, "streamlit"),
        (flask, "flask"),
    ):
        for name in module.__all__:
            value = getattr(module, name)
            if not getattr(value, "__module__", "").startswith("herceg"):
                continue  # a type's alias
            if callable(value) and not inspect.isclass(value):
                names.add(f"{label}.{name}")
            elif inspect.isclass(value) and not typing.is_typeddict(value):
                if issubclass(value, Exception):
                    continue
                # Objects of options are made as test_errors makes them; their methods are here.
                if not dataclasses.is_dataclass(value):
                    names.add(f"{label}.{name}")
                members(value, name)
    names.add("ChartWidget")
    members(ChartWidget, "ChartWidget")
    return names


def _without_arguments(name: str) -> bool:
    """Whether a callable takes nothing a caller could get wrong."""
    owner, _, member = name.rpartition(".")
    value = getattr(getattr(hg, owner, None) or getattr(web, owner, None), member, None)
    if owner == "ChartWidget":
        value = getattr(ChartWidget, member, None)
    if value is None or not callable(value):
        return False
    return not [
        parameter
        for parameter in inspect.signature(value).parameters.values()
        if parameter.name != "self"
    ]


def test_every_public_callable_has_a_valid_call_or_a_reason():
    public = _public()
    called = set(_calls(Path("unused")))
    missing = {name for name in public - called - set(EXCLUDED) if not _without_arguments(name)}
    assert missing == set()
    assert (called | set(EXCLUDED)) - public == set()


def _cases(calls: dict[str, Call]) -> typing.Iterator[tuple[str, Call, str, Any, str]]:
    """Each call with one argument of it given a malformed value, and the path
    the refusal must be at."""
    for label, call in calls.items():
        for argument in arguments(call.function or call.make):
            at = (
                call.setting
                or call.paths.get(argument.name)
                or (call.options_at if argument.unpacked else call.at) + argument.name
            )
            table = argument.name in call.tables
            held = call.given.get(argument.name, DATA if table and call.at else None)
            for case in malformed(argument.hint, held, table=table):
                if argument.name in call.relational and isinstance(
                    case.value, (Mapping, list, np.ndarray)
                ):
                    case = case._replace(within=("*",))
                given = call.arguments(
                    {**call.alone.get(argument.name, call.given), argument.name: case.value}
                )
                yield label, call, at, given, case


@pytest.mark.contract("errors.options.chart-error.python")
def test_every_argument_of_every_callable_refuses_at_itself(tmp_path):
    wrong = []
    for label, call, at, given, case in _cases(_calls(tmp_path)):
        error = refusal(call.make, **given)
        if misplaced(error, at, case):
            name = at.rpartition(".")[2]
            wrong.append(f"{label} {name}={case.value!r}: {said(error)}")
    assert wrong == [], f"{len(wrong)}\n" + "\n".join(wrong)


def _drawn(made: Any) -> Any:
    if isinstance(made, hg.Chart):
        return json.dumps(made.to_spec()[0], sort_keys=True)
    if isinstance(made, str) and made.startswith("<svg"):
        return re.sub(r"herceg-svg-\d+", "herceg-svg", made)  # each drawing's ids are its own
    if hasattr(made, "_node"):
        return repr(made._node.__dict__)  # a grid's cells: their tracks and gaps
    return made if isinstance(made, (str, bytes, type(None))) else repr(made)


def test_numpy_forms_of_valid_arguments_are_taken_alike(tmp_path):
    wrong = []
    for label, call in _calls(tmp_path).items():
        signature = inspect.signature(call.function or call.make)
        for argument in arguments(call.function or call.make):
            parameter = signature.parameters.get(argument.name)
            value = call.given.get(argument.name)
            if value is None and parameter is not None and parameter.default is not inspect._empty:
                value = parameter.default
            for twin in twins(value):
                given = {**call.given, argument.name: twin}
                try:
                    made = call.make(**call.arguments(given))
                    if isinstance(made, hg.Chart):
                        made.to_svg()
                except Exception as error:  # noqa: BLE001 - reported
                    wrong.append(f"{label} {argument.name}={twin!r}: {said(error)}")
                    continue
                if isinstance(made, hg.Chart) and _drawn(made) != _drawn(
                    call.make(**call.arguments({**call.given, argument.name: value}))
                ):
                    wrong.append(f"{label} {argument.name}={twin!r}: drawn otherwise")
    assert wrong == [], f"{len(wrong)}\n" + "\n".join(wrong)


# Fixed-length tuples a call takes, with what else it needs: each is read
# alike from a list, an array, a Series (by position), and an iterator.
PAIRS: dict[tuple[str, str], tuple[Any, dict[str, Any]]] = {
    ("Chart.rule", "span"): ((1.0, 2.0), {}),
    ("Chart.point", "radius_range"): ((2.0, 8.0), {"size": "w"}),
    ("Chart.heatmap", "color_domain"): ((0.0, 5.0), {}),
    ("hg.radar", "domain"): ((0.0, 10.0), {}),
    ("hg.scatter_3d", "box_aspect"): ((1.0, 1.0, 0.5), {}),
    ("Chart.grid", "gap"): ((4.0, 8.0), {}),
    ("Chart.to_svg", "size"): ((300.0, 200.0), {}),
    ("hx.kdeplot", "clip"): ((0.0, 5.0), {}),
    ("hx.histplot", "binrange"): ((0.0, 5.0), {}),
    ("hx.histplot", "binwidth"): ((1.0, 1.0), {"x": "t", "y": "v"}),
    ("hx.lineplot", "errorbar"): (("ci", 90.0), {}),
}


def test_pairs_are_read_from_arrays_series_and_iterators(tmp_path):
    calls = _calls(tmp_path)
    wrong = []
    for (label, name), (pair, needs) in PAIRS.items():
        call = calls[label]
        given = {**call.given, **needs}
        made = call.make(**call.arguments({**given, name: pair}))
        for twin in (
            list(pair),
            # Not text: NumPy writes a pair of a word and a number as two words.
            np.array(pair, dtype=object if any(isinstance(v, str) for v in pair) else None),
            pd.Series(pair, index=range(10, 10 + len(pair))),
            iter(pair),
        ):
            try:
                drawn = call.make(**call.arguments({**given, name: twin}))
            except Exception as error:  # noqa: BLE001 - reported
                wrong.append(f"{label} {name}={twin!r}: {said(error)}")
                continue
            if _drawn(drawn) != _drawn(made):
                wrong.append(f"{label} {name}={twin!r}: drawn otherwise")
    assert wrong == [], "\n".join(wrong)


def _typed_dicts(hint: Any) -> typing.Iterator[Any]:
    """The TypedDicts a hint names, at any depth."""
    if typing.is_typeddict(hint):
        yield hint
        for inner in typing.get_type_hints(hint).values():
            yield from _typed_dicts(inner)
    for arg in typing.get_args(hint):
        yield from _typed_dicts(arg)


def test_typed_dicts_of_public_hints_resolve(tmp_path):
    # A TypedDict's names resolve in its own module, whatever namespace is
    # given: one imported there only for type checking is an error.
    found = set()
    for call in _calls(tmp_path).values():
        for argument in arguments(call.function or call.make):
            found |= set(_typed_dicts(argument.hint))
    for name in dir(hg):
        kind = getattr(hg, name)
        if isinstance(kind, type) and dataclasses.is_dataclass(kind):
            names = {**vars(hg), **vars(sys.modules[kind.__module__])}
            for hint in typing.get_type_hints(kind, globalns=names).values():
                found |= set(_typed_dicts(hint))
    assert len(found) >= 10
    for kind in found:
        typing.get_type_hints(kind)


def test_unknown_keywords_are_unknown_options(tmp_path):
    wrong = []
    for label, call in _calls(tmp_path).items():
        parameters = inspect.signature(call.function or call.make).parameters.values()
        if not any(parameter.kind is parameter.VAR_KEYWORD for parameter in parameters):
            continue
        if label.startswith("Derived."):
            continue  # their keywords name output columns
        try:
            call.make(**call.arguments({**call.given, "colour": 1}))
        except UnknownOption:
            continue
        except Exception as error:  # noqa: BLE001 - reported
            wrong.append(f"{label}: {said(error)}")
            continue
        wrong.append(f"{label}: accepted")
    assert wrong == [], "\n".join(wrong)
