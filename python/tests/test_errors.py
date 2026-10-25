"""What the chart's builder cannot take is a ChartError at the option it names,
on every surface: the chart's and its marks' options, objects of options,
outputs' settings, and the engine's own refusals, in Python's spelling."""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
import subprocess
import sys
import typing
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import polars as pl
import pytest
from malformed import malformed, misplaced, refusal, said

import herceg as hg
import herceg.express as hx

DATA = {
    "t": [0.0, 1.0, 2.0, 3.0],
    "v": [1.0, 2.0, 3.0, 4.0],
    "w": [2.0, 3.0, 4.0, 5.0],
    "s": ["a", "b", "a", "b"],
    "u": ["b", "c", "c", "a"],
}

FONT = Path(__file__).resolve().parents[2] / "packages/herceg/test/fixtures/pdf-fonts/sans.ttf"

TIMES = {
    "t": np.array(["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"], dtype="datetime64[ms]"),
    "v": [1.0, 2.0, 3.0, 4.0],
}


def _line(**options: Any) -> hg.Chart:
    return hg.Chart(DATA).line(x="t", y="v", **options)


def _chart(**options: Any) -> hg.Chart:
    return hg.Chart(DATA, **options).line(x="t", y="v")


def _annotated(**options: Any) -> hg.Chart:
    return _line().text(x="t", y="v", label="s", **options)


def _undescribed() -> hg.Chart:
    """A chart whose spec the engine refuses, at ``description``, where
    Python would refuse the description given to it sooner."""
    chart = _line()
    chart._options = {**chart._options, "description": 5}
    return chart


def _bound(gesture: Any, action: Any) -> hg.Chart:
    return hg.Chart(DATA, bindings=[hg.Binding(gesture, action)]).line(x="t", y="v")


def _panelled(**options: Any) -> hg.Chart:
    panels = [hg.Panel("a"), hg.Panel("b")]
    return hg.Chart(DATA, panels=panels, **options).line(x="t", y="v", panel="*")


def _styled(role: str) -> Any:
    return lambda o: _line().__class__(DATA, theme=hg.Theme(style={role: o})).line(x="t", y="v")


# Each object of options in a place the chart takes it, the path of that
# place, and what the object needs to be made.
SLOTS: dict[str, tuple[str, Any, dict[str, Any]]] = {
    "AxisOptions": ("x", lambda o: hg.Chart(DATA, x=o).line(x="t", y="v"), {}),
    "LegendOptions": (
        "legend",
        lambda o: hg.Chart(DATA, legend=o).line(x="t", y="v", color="s"),
        {},
    ),
    "Navigator": ("navigator", lambda o: hg.Chart(DATA, navigator=o).line(x="t", y="v"), {}),
    "Animation": ("animation", lambda o: hg.Chart(DATA, animation=o).line(x="t", y="v"), {}),
    "Title": ("title", lambda o: hg.Chart(DATA, title=o).line(x="t", y="v"), {"text": "T"}),
    "Tooltip": ("tooltip", lambda o: hg.Chart(DATA, tooltip=o).line(x="t", y="v"), {}),
    "Theme": ("theme", lambda o: hg.Chart(DATA, theme=o).line(x="t", y="v"), {}),
    "Tokens": (
        "theme.tokens",
        lambda o: hg.Chart(DATA, theme=hg.Theme(tokens=o)).line(x="t", y="v"),
        {},
    ),
    "Style": (
        "theme.style",
        lambda o: hg.Chart(DATA, theme=hg.Theme(style=o)).line(x="t", y="v"),
        {},
    ),
    "TextStyle": ("theme.style.text", _styled("text"), {}),
    "PlotStyle": ("theme.style.plot", _styled("plot"), {}),
    "StrokeStyle": ("theme.style.axis_line", _styled("axis_line"), {}),
    "Scale": ("scales.x", lambda o: hg.Chart(DATA, scales={"x": o}).line(x="t", y="v"), {}),
    "OrdinalScale": (
        "scales.c",
        lambda o: hg.Chart(DATA, scales={"c": o}).line(
            x="t", y="v", encode=hg.Encodings(color=hg.Channel("s", scale="c"))
        ),
        {},
    ),
    "Ticks": (
        "x.ticks",
        lambda o: hg.Chart(DATA, x=hg.AxisOptions(ticks=o)).line(x="t", y="v"),
        {"count": 4},
    ),
    "Place": (
        "guides[0].place",
        lambda o: hg.Chart(DATA, guides=[hg.legend(place=o)]).line(x="t", y="v", color="s"),
        {"side": "top"},
    ),
    "Sync": ("sync", lambda o: hg.Chart(DATA, sync=o).line(x="t", y="v"), {}),
    "SyncChannel": (
        "sync.cursor",
        lambda o: hg.Chart(DATA, sync=hg.Sync(cursor=o)).line(x="t", y="v"),
        {"group": "g"},
    ),
    "ViewLimits": ("limits.x", lambda o: hg.Chart(DATA, limits={"x": o}).line(x="t", y="v"), {}),
    "Edge": (
        "limits.x.edge",
        lambda o: hg.Chart(DATA, limits={"x": hg.ViewLimits(edge=o)}).line(x="t", y="v"),
        {},
    ),
    "Jitter": ("marks[0].jitter", lambda o: hg.Chart(DATA).point(x="s", y="v", jitter=o), {}),
    "Encodings": ("marks[0].encode", lambda o: _line(encode=o), {}),
    "MarkStyle": ("marks[0].style", lambda o: _line(style=o), {}),
    "MarkerStyle": (
        "marks[0].style.marker",
        lambda o: _line(markers=True, style=hg.MarkStyle(marker=o)),
        {},
    ),
    "Continuity": ("marks[0].continuity", lambda o: _line(continuity=o), {}),
    "Stack": (
        "marks[0].stack",
        lambda o: hg.Chart(DATA).area(x="t", y="v", color="s", stack=o),
        {},
    ),
    "Label": ("marks[1].label", lambda o: _line().rule(y=1.0, label=o), {"text": "L"}),
    "BarLabels": ("marks[0].labels", lambda o: hg.Chart(DATA).bar(x="s", y="v", labels=o), {}),
    "SeriesLabels": ("marks[0].labels", lambda o: _line(color="s", labels=o), {"at": "last"}),
    "Halo": ("marks[1].halo", lambda o: _annotated(halo=o), {"color": "white"}),
    "TextBox": (
        "marks[1].label.style.background",
        lambda o: _line().rule(y=1.0, label=hg.Label(text="L", style=hg.TextStyle(background=o))),
        {"fill": "white"},
    ),
    "SelectionBinding": (
        "row_selection",
        lambda o: hg.Chart(DATA, row_selection=o).line(x="t", y="v"),
        {"channel": "c"},
    ),
    "BarStyle": ("theme.style.bar", _styled("bar"), {}),
    "LineStyle": ("theme.style.line", _styled("line"), {}),
    "TooltipStyle": ("theme.style.tooltip", _styled("tooltip"), {}),
    "Binding": (
        "bindings[0]",
        lambda o: hg.Chart(DATA, bindings=[o]).line(x="t", y="v"),
        {"gesture": hg.DragGesture(), "action": hg.PanAction()},
    ),
    "WheelGesture": ("bindings[0].gesture", lambda o: _bound(o, hg.ZoomAction()), {}),
    "DragGesture": ("bindings[0].gesture", lambda o: _bound(o, hg.PanAction()), {}),
    "KeyGesture": ("bindings[0].gesture", lambda o: _bound(o, hg.ZoomAction()), {"key": "+"}),
    "DoubleClickGesture": ("bindings[0].gesture", lambda o: _bound(o, hg.ResetAction()), {}),
    "PanAction": ("bindings[0].action", lambda o: _bound(hg.KeyGesture("a"), o), {}),
    "ZoomAction": ("bindings[0].action", lambda o: _bound(hg.WheelGesture(), o), {}),
    "BrushAction": ("bindings[0].action", lambda o: _bound(hg.DragGesture(), o), {}),
    "Break": (
        "x.breaks[0]",
        lambda o: hg.Chart(TIMES, x=hg.AxisOptions(breaks=[o])).line(x="t", y="v"),
        {"weekdays": ["sat", "sun"]},
    ),
    "Camera": (
        "camera",
        lambda o: hg.Chart(DATA, camera=o).point_3d(x="t", y="v", z="w"),
        {},
    ),
    "Channel": (
        "marks[0].size",
        lambda o: hg.Chart(DATA).point(x="t", y="v", size=o),
        {"field": "w"},
    ),
    "DataPosition": ("marks[1].y", lambda o: _line().rule(y=o), {"value": 1.0}),
    "Fraction": ("marks[1].y", lambda o: _line().rule(y=o), {"value": 0.5}),
    "Pixels": ("marks[1].y", lambda o: _line().rule(y=o), {"value": 10}),
    "Position": (
        "marks[1].at",
        lambda o: _line().text(label="L", at=o),
        {"x": hg.Fraction(0.5), "y": hg.Fraction(0.5)},
    ),
    "Duration": (
        "marks[0].continuity.max_gap",
        lambda o: hg.Chart(TIMES).line(x="t", y="v", continuity=hg.Continuity(max_gap=o)),
        {"hours": 1},
    ),
    "Format": (
        "x.format",
        lambda o: hg.Chart(DATA, x=hg.AxisOptions(format=o)).line(x="t", y="v"),
        {"number": ",.1f"},
    ),
    "Grid": ("layout", lambda o: _panelled(layout=o), {}),
    "Weight": (
        "layout.columns[0]",
        lambda o: _panelled(layout=hg.Grid(columns=[o, 1])),
        {"value": 2},
    ),
    "GridLines": (
        "x.grid",
        lambda o: hg.Chart(DATA, x=hg.AxisOptions(grid=o)).line(x="t", y="v"),
        {},
    ),
    "Tick": ("guides[0].tick", lambda o: _chart(guides=[hg.axis("x", tick=o)]), {}),
    "TickLabels": ("guides[0].labels", lambda o: _chart(guides=[hg.axis("x", labels=o)]), {}),
    "TickLayer": (
        "guides[0].layers[0]",
        lambda o: _chart(guides=[hg.axis("x", layers=[o])]),
        {"id": "minor"},
    ),
    "LabelPart": (
        "marks[1].label.content[1]",
        lambda o: _line().rule(y=1.0, label={"content": ["at ", o]}),
        {"value": True},
    ),
    "LabelPlace": (
        "marks[1].label.place",
        lambda o: _line().rule(y=1.0, label=hg.Label(text="L", place=o)),
        {},
    ),
    "LegendEntry": (
        "legend.entries[0]",
        lambda o: _chart(legend=hg.LegendOptions(entries=[o])),
        {"key": "k", "label": "L"},
    ),
    "LegendTarget": (
        "legend.entries[0].targets[0]",
        lambda o: hg.Chart(
            DATA, legend=hg.LegendOptions(entries=[hg.LegendEntry("k", "L", targets=[o])])
        ).line(x="t", y="v", color="s", id="l"),
        {"values": ["a"], "mark": "l", "field": "s"},
    ),
    "Swatch": (
        "legend.entries[0].swatch",
        lambda o: _chart(legend=hg.LegendOptions(entries=[hg.LegendEntry("k", "L", swatch=o)])),
        {"type": "line", "stroke": "red"},
    ),
    "MarkRef": (
        "legend.include[0]",
        lambda o: hg.Chart(DATA, legend=hg.LegendOptions(include=[o])).line(
            x="t", y="v", color="s", id="l"
        ),
        {"mark": "l"},
    ),
    "MarkAnchor": (
        "marks[1].from_",
        lambda o: hg.Chart(DATA).line(x="t", y="v", id="l").text(label="s", from_=o),
        {"mark": "l", "at": "last"},
    ),
    "Panel": (
        "panels[0]",
        lambda o: hg.Chart(DATA, panels=[o]).line(x="t", y="v", panel="a"),
        {"id": "a"},
    ),
    "Projection": (
        "projection",
        lambda o: hg.Chart(DATA, projection=o).geopoint("t", "v"),
        {},
    ),
    "ScaleRef": (
        "guides[0].scale",
        lambda o: hg.Chart(DATA, guides=[hg.colorbar(scale=o)]).point(
            x="t", y="v", color="w", id="p"
        ),
        {"mark": "p", "channel": "color"},
    ),
    "StyleMap": (
        "marks[0].style.by",
        lambda o: _line(color="s", style=hg.MarkStyle(by=o)),
        {"map": {"a": {"stroke": "red"}}},
    ),
    "SeriesStyle": (
        "marks[0].style.by.map.a",
        lambda o: _line(color="s", style=hg.MarkStyle(by=hg.StyleMap({"a": o}))),
        {},
    ),
    "TooltipField": (
        "marks[0].tooltip.fields[0]",
        lambda o: _line(tooltip=hg.Tooltip(fields=[o])),
        {"field": "w"},
    ),
    "AxisGuide": ("guides[0]", lambda o: _chart(guides=[o]), {"scale": "x"}),
    "LegendGuide": (
        "guides[0]",
        lambda o: hg.Chart(DATA, guides=[o]).line(x="t", y="v", color="s"),
        {},
    ),
    "Colorbar": (
        "guides[0]",
        lambda o: hg.Chart(DATA, guides=[o]).point(x="t", y="v", color="w"),
        {},
    ),
}

# What Python reads of a chart (its events and inspection), which no chart takes.
READ = {"InspectedField", "InspectedPoint", "Inspection", "RowSelection", "Selection"}
READ |= {"Viewport", "ViewEdge", "ViewportEvent", "ScaleInstance", "ScaleView"}
READ |= {"SelectEvent", "SelectionOwner", "VisibilityState", "PanelVisibility"}


# Fields that replace what an object is given above, which are refused together.
REPLACING = {("Ticks", "every"), ("Ticks", "values"), ("Place", "inside"), ("Label", "content")}
# And fields of which an object takes one, given one above.
REPLACING |= {("Channel", "value"), ("Channel", "series"), ("LabelPart", "field")}
REPLACING |= {("LabelPart", "series")}
REPLACING |= {("Break", "start"), ("Break", "end"), ("Label", "field"), ("ScaleRef", "scale")}
REPLACING |= {("DataPosition", "field"), ("Fraction", "field"), ("Pixels", "field")}
# Fields given in place of those of the object above they exclude.
INSTEAD = {
    ("Break", "hours"): {"weekdays"},
    ("Break", "dates"): {"weekdays"},
    ("Format", "time"): {"number"},
    ("LegendTarget", "scale"): {"mark", "field"},
    ("Ticks", "values"): {"count"},
}


def test_every_object_of_options_has_a_place_above():
    kinds = [getattr(hg, name) for name in dir(hg) if not name.startswith("_")]
    taken = {
        kind.__name__
        for kind in kinds
        if isinstance(kind, type)
        and dataclasses.is_dataclass(kind)
        and any(field.init for field in dataclasses.fields(kind))
    }
    assert taken - READ - set(SLOTS) == set()


def test_objects_of_options_above_are_taken_where_they_are_placed():
    wrong = []
    for name, (_, take, needs) in SLOTS.items():
        error = refusal(take, getattr(hg, name)(**needs))
        if error != "accepted":
            wrong.append(f"{name}: {said(error)}")
    assert wrong == [], "\n".join(wrong)


@pytest.mark.contract("errors.option-objects.chart-error.python")
def test_objects_of_options_refuse_at_their_place_in_the_chart():
    wrong = []
    for name, (at, take, needs) in SLOTS.items():
        kind = getattr(hg, name)
        # Names modules import only for type checking are herceg's.
        hints = typing.get_type_hints(
            kind, globalns={**vars(hg), **vars(sys.modules[kind.__module__])}
        )
        for field in dataclasses.fields(kind):
            if not field.init or (name, field.name) in REPLACING:
                continue
            seed = {
                key: value
                for key, value in needs.items()
                if key not in INSTEAD.get((name, field.name), ())
            }
            for case in malformed(hints.get(field.name)):
                # As the object is made, at its field; as the chart takes it, at its place.
                try:
                    made = kind(**{**seed, field.name: case.value})
                except Exception as error:  # noqa: BLE001 - what is not a ChartError is reported
                    refused = error if isinstance(error, hg.ChartError) else repr(error)
                    if misplaced(refused, field.name, case._replace(refused=True)):
                        wrong.append(f"{name}({field.name}={case.value!r}): {said(error)}")
                    continue
                error = refusal(take, made)
                if misplaced(error, f"{at}.{field.name}", case):
                    wrong.append(f"{name} {field.name}={case.value!r}: {said(error)}")
    assert wrong == [], "\n".join(wrong)


# Fixed-length tuples of objects of options: each is read alike from a list,
# an array, a Series (by position), and an iterator.
PAIR_FIELDS = {
    ("AxisOptions", "domain"): (0.0, 10.0),
    ("Projection", "parallels"): (20.0, 50.0),
    ("Projection", "fit"): ((0.0, 0.0), (10.0, 10.0)),
    ("Break", "hours"): ("16:00", "09:30"),
    ("ViewLimits", "extent"): (0.0, 10.0),
    ("PanAction", "step"): (0.1, 0.2),
    ("Grid", "gap"): (4.0, 8.0),
}


# Lists of objects of options, valid where SLOTS places them: each is read
# alike from a tuple, an array, a pandas Series (by position), and for
# words and numbers a Polars Series.
LIST_FIELDS: dict[tuple[str, str], list[Any]] = {
    ("Ticks", "values"): [0.0, 2.0],
    ("TickLabels", "rotation"): [0.0, 45.0],
    ("Break", "weekdays"): ["sat", "sun"],
    ("Break", "dates"): ["2026-01-06"],
    ("DragGesture", "modifiers"): ["shift"],
    ("LegendTarget", "values"): ["a"],
    ("Scale", "domain"): [0.0, 10.0],
    ("OrdinalScale", "domain"): ["a", "b"],
    ("Tokens", "palette"): ["#d1495b", "#00798c"],
    ("StrokeStyle", "dash"): [4.0, 2.0],
    ("Grid", "columns"): [1.0, 2.0],
    ("AxisOptions", "breaks"): [hg.Break(weekdays=["sat", "sun"])],
    ("LegendOptions", "entries"): [hg.LegendEntry("k", "L")],
}


def test_lists_of_objects_of_options_are_read_from_arrays_and_series():
    wrong = []
    for (name, field), values in LIST_FIELDS.items():
        _, take, needs = SLOTS[name]
        kind = getattr(hg, name)
        excluded = {field, *INSTEAD.get((name, field), ())}
        seed = {key: value for key, value in needs.items() if key not in excluded}
        if name == "AxisOptions":
            take = lambda o: hg.Chart(TIMES, x=o).line(x="t", y="v")  # noqa: E731 - breaks need times
        expected = _spec_of(take(kind(**{**seed, field: values})))
        scalars = all(isinstance(value, (str, float)) for value in values)
        twins = [
            tuple(values),
            np.array(values, dtype=None if scalars else object),
            pd.Series(values, index=range(10, 10 + len(values))),
            *([pl.Series(values)] if scalars else []),
        ]
        for twin in twins:
            try:
                if _spec_of(take(kind(**{**seed, field: twin}))) != expected:
                    wrong.append(f"{name}({field}={twin!r}): drawn otherwise")
            except Exception as error:  # noqa: BLE001 - reported
                wrong.append(f"{name}({field}={twin!r}): {said(error)}")
    assert wrong == [], "\n".join(wrong)


def test_missing_values_are_refused_where_options_take_values():
    times = {"t": pd.date_range("2026-01-05", periods=4), "v": [1.0, 2.0, 3.0, 4.0]}
    refused = {
        "x.ticks.values[0]": lambda: hg.Chart(
            times, x=hg.AxisOptions(ticks=hg.Ticks(values=pd.Series([pd.NaT])))
        ).line(x="t", y="v"),
        "x.domain[0]": lambda: hg.Chart(
            times,
            x=hg.AxisOptions(domain=np.array(["NaT", "2026-01-06"], dtype="datetime64[ms]")),
        ).line(x="t", y="v"),
        # Refused as it is made, at its field.
        "value": lambda: hg.DataPosition(np.datetime64("NaT", "ms")),
        "events[1]": lambda: hg.SelectionBinding(
            "focus", events=pd.Series(["click", pd.NA], dtype="string")
        ),
        "bindings[0].gesture.modifiers[1]": lambda: hg.Chart(
            DATA, bindings=[hg.Binding(hg.DragGesture(modifiers=["shift", pd.NA]), hg.PanAction())]
        ).line(x="t", y="v"),
        "x.breaks[0].weekdays[1]": lambda: hg.Chart(
            times, x=hg.AxisOptions(breaks=[hg.Break(weekdays=["sat", pd.NA])])
        ).line(x="t", y="v"),
        "order[0]": lambda: hx.barplot(
            times, x="t", y="v", order=pd.Series([pd.NaT]), errorbar=None
        ),
    }
    wrong = []
    for path, make in refused.items():
        error = refusal(make)
        if not isinstance(error, hg.ChartError) or error.path != path:
            wrong.append(f"{path}: {said(error)}")
    assert wrong == [], "\n".join(wrong)


def test_dicts_of_settings_take_none_where_it_means_the_default():
    data = {"x": [0.0, 1.0, 2.0], "y": [1.0, 2.0, 3.0], "v": [1.0, 2.0, 3.0]}
    chart = hg.Chart(data)
    chart.columns(1)[0].panel("a").line(x="x", y="y").inset("b", indicator={"style": None})
    for made in (
        hg.histogram(data, "x", bins={"step": 1.0, "start": None}),
        hg.histogram(data, "x", y="y", bins={"x": None, "y": 5}),
        hg.heatmap(data, "x", "y", "v", sampling={"reduce": None}),
        hg.line(data, "x", "y", legend={"title": {"text": "Region", "style": None}}),
        chart,
    ):
        assert made.to_svg().startswith("<svg")


def _spec_of(chart: hg.Chart) -> str:
    return json.dumps(chart.to_spec()[0], sort_keys=True)


def test_pairs_of_objects_of_options_are_read_from_arrays_series_and_iterators():
    wrong = []
    for (name, field), pair in PAIR_FIELDS.items():
        _, take, needs = SLOTS[name]
        kind = getattr(hg, name)
        seed = {key: value for key, value in needs.items() if key not in ("weekdays",)}

        expected = _spec_of(take(kind(**{**seed, field: pair})))
        for twin in (list(pair), np.array(pair), pd.Series(pair, index=[10, 11]), iter(pair)):
            try:
                if _spec_of(take(kind(**{**seed, field: twin}))) != expected:
                    wrong.append(f"{name}({field}={twin!r}): drawn otherwise")
            except Exception as error:  # noqa: BLE001 - reported
                wrong.append(f"{name}({field}={twin!r}): {said(error)}")
    assert wrong == [], "\n".join(wrong)


@pytest.mark.contract("errors.settings.chart-error.python")
def test_outputs_and_express_functions_refuse_at_the_setting(tmp_path):
    chart = _line()
    refused = {
        "sizing": lambda: chart.to_svg(sizing="wide"),
        "dpi": lambda: chart.to_png(dpi=-1),
        "margin": lambda: chart.to_pdf(margin=-1),
        "full_page": lambda: chart.to_html(full_page=3),
        "format": lambda: chart.to_image(format="tiff"),
        "orientation": lambda: hg.to_pdf([chart], orientation="sideways"),
        "palette": lambda: hx.lineplot(DATA, x="t", y="v", palette="red"),
        "binwidth": lambda: hx.histplot(DATA, x="v", binwidth=-1),
        "kde_options": lambda: hx.histplot(DATA, x="v", kde=True, kde_options=5),
    }
    for setting, output in refused.items():
        with pytest.raises(hg.ChartError) as raised:
            output()
        assert raised.value.path == setting, raised.value
    # A setting refused as a chart is saved is save's, by its own name.
    with pytest.raises(hg.ChartError, match="save sizing: ") as raised:
        chart.save(tmp_path / "chart.svg", sizing="wide")
    assert raised.value.path == "sizing"
    with pytest.raises(hg.ChartError, match="save margin: ") as raised:
        hg.save([chart], tmp_path / "charts.pdf", margin=-1)
    assert raised.value.path == "margin"
    with pytest.raises(hg.ChartError, match="save margin: ") as raised:
        chart.save(tmp_path / "chart.pdf", margin=-1)
    assert raised.value.path == "margin"
    # A chart's own refusal keeps its fields as it is saved.
    unscaled = _line(encode=hg.Encodings(color=hg.Channel(field="s", scale="nope")))
    with pytest.raises(hg.ChartError) as raised:
        unscaled.save(tmp_path / "chart.pdf")
    assert (raised.value.code, raised.value.path, raised.value.mark) == (
        "unknown-reference",
        "marks[0].encode.color.scale",
        0,
    )
    # Families as an array are a list, through save as through to_pdf.
    families = {"fonts": {"Brand": FONT}, "fallback": np.array(["Brand", "Brand"])}
    chart.save(tmp_path / "fallback.pdf", **families)
    hg.save([chart], tmp_path / "fallbacks.pdf", **families)
    assert (tmp_path / "fallback.pdf").read_bytes().startswith(b"%PDF")
    with pytest.raises(hg.ChartError) as raised:
        chart.to_pdf(fallback=np.array(["Brand"]))
    assert raised.value.path == "fallback"
    # A keyword a function does not take is Python's TypeError, with what was meant.
    with pytest.raises(TypeError, match="lineplot: no option 'markers'"):
        hx.lineplot(DATA, x="t", y="v", markers=3)


@pytest.mark.contract("errors.paths.nested.python")
def test_refusals_within_lists_and_nested_options_are_at_their_whole_path():
    good = _line()
    padded = _chart(x={"padding": hg.Pixels(1000)})
    swatch = {"type": "composite", "parts": [{"type": "symbol", "fill": "red", "symbol": "?"}]}
    cases = {
        "marks[0].size.value": lambda: hg.Chart(DATA).point(
            x="t", y="v", size=hg.Channel(value=object())
        ),
        "panels[0].x.domain": lambda: hg.Chart(
            DATA, panels=[hg.Panel("a", x=hg.AxisOptions(domain=object()))]
        ).line(x="t", y="v", panel="a"),
        "theme.tokens.palette": lambda: _chart(theme={"tokens": {"palette": 5}}),
        "x.ticks.count": lambda: _chart(x={"ticks": {"count": -1}}),
        "bindings[0]": lambda: _chart(bindings=[5]),
        "bindings[0].gesture.button": lambda: _chart(
            bindings=[hg.Binding(hg.DragGesture(button=7), hg.PanAction())]
        ),
        "sync.cursor.snap": lambda: _chart(sync=hg.Sync(cursor=hg.SyncChannel("g", snap="x"))),
        "limits.x.edge.threshold": lambda: _chart(
            limits={"x": hg.ViewLimits(edge=hg.Edge(threshold=-1))}
        ),
        # A column's name in a refusal is no option within the one refused.
        "marks[0].stack": lambda: hg.Chart({**DATA, "v": [1.0, -2.0, 3.0, 4.0]}).area(
            x="t", y="v", color="s", stack="fill"
        ),
        "tooltip.fields": lambda: hg.histogram(DATA, x="v", tooltip=hg.Tooltip(fields=["w"])),
        "legend.place.side": lambda: _chart(legend=hg.LegendOptions(place={"side": "wrong"})),
        "legend.entries[0].key": lambda: _chart(
            legend=hg.LegendOptions(entries=[{"key": 5, "label": "x"}])
        ),
        "guides[0].entries[0].key": lambda: _chart(
            guides=[hg.legend(entries=[{"key": 5, "label": "x"}])]
        ),
        "guides[0].ticks.count": lambda: _chart(guides=[hg.axis("x", ticks={"count": -1})]),
        "guides[0].layers[0].ticks.count": lambda: _chart(
            guides=[hg.axis("x", layers=[{"id": "day", "ticks": {"count": -1}}])]
        ),
        "padding.top": lambda: _chart(padding={"top": -1}),
        "charts[1]": lambda: hg.to_pdf([good, 5]),  # type: ignore[list-item]
        # A chart in a sequence is at its index, as one alone is not.
        "charts[0].description": lambda: hg.to_pdf([_undescribed()]),
        "description": lambda: hg.to_pdf(_undescribed()),
        "charts[1].marks[0].encode.color.scale": lambda: hg.to_pdf(
            [good, _line(encode=hg.Encodings(color=hg.Channel(field="s", scale="nope")))]
        ),
        "charts[1].description": lambda: hg.to_pdf([good, _undescribed()]),
        "x.format.number": lambda: _chart(x={"format": {"number": 5}}),
        "legend.title.style.font_size": lambda: _chart(
            legend={"title": {"text": "Sites", "style": {"font_size": -1}}}
        ),
        "legend.entries[0]": lambda: _chart(legend={"entries": [None]}),
        "legend.entries[0].swatch.parts[0].symbol": lambda: _chart(
            legend={"entries": [{"key": "a", "label": "A", "swatch": swatch}]}
        ),
        "limits.x.extent": lambda: _chart(limits={"x": hg.ViewLimits(extent=("soon", 1))}),
        "marks[0].jitter.width": lambda: hg.Chart(DATA).point(
            x="s", y="v", jitter=hg.Jitter(width=2)
        ),
        "kde_options.bw_adjust": lambda: hx.histplot(
            DATA, x="v", kde=True, kde_options={"bw_adjust": -1}
        ),
        "charts[0].x.padding.px": lambda: hg.to_pdf([padded]),
        "charts[1].x.padding.px": lambda: hg.to_pdf([good, padded]),
        "x.padding.px": lambda: hg.to_pdf(padded),
        'marks[0].style.by.map["a/b"]': lambda: _line(style={"by": {"map": {"a/b": 5}}}),
        'marks[0].style.by.map["a: b"]': lambda: _line(style={"by": {"map": {"a: b": 5}}}),
        'scales["a/b"]': lambda: _chart(scales={"a/b": 5}),
        "marks[1].label.content[1].field": lambda: _line(id="l").text(
            from_=hg.MarkAnchor("l", "last"),
            label=hg.Label(content=["at ", hg.LabelPart(field="absent")]),
        ),
        "marks[1].at.x": lambda: _line().text(label="L", at=hg.Position(object(), 0.5)),
        "fonts": lambda: hg.to_pdf([good], fonts={"Brand": b"no font"}),
        "fallback": lambda: hg.to_pdf([good], fonts={"Brand": FONT}, fallback=["Elsewhere"]),
        "row_selection.selection": lambda: hg.Chart(
            DATA, row_selection=hg.SelectionBinding("c", selection=[99])
        ).line(x="t", y="v"),
        "row_selection[0].fields[0]": lambda: hg.Chart(
            DATA, row_selection=[hg.SelectionBinding("c", fields=["absent"])]
        ).line(x="t", y="v"),
        'marks[0].style.by.map["North South"].stroke_width': lambda: _line(
            color="s", style={"by": {"map": {"North South": {"stroke_width": -1}}}}
        ),
        "legend.include[0].channel": lambda: _chart(
            legend={"include": [{"mark": "a", "channel": "bogus"}]}
        ),
        "marks[1].label.content[1].format.number": lambda: _line().rule(
            y=1, label={"content": ["x", {"value": True, "format": {"number": 5}}]}
        ),
        "marks[0].tooltip.fields[0]": lambda: _line(tooltip=hg.Tooltip(fields=["absent"])),
        "marks[0].label.field": lambda: hg.Chart(DATA).text(
            x="t", y="v", label=hg.Label(field="absent")
        ),
        "scales": lambda: _chart(scales={5: {}}),
        "bindings[0].action.step": lambda: _bound(hg.KeyGesture("a"), hg.PanAction(step=5)),
    }
    # Paths more than one case above reaches.
    again = [
        (
            "guides[0].layers[0].ticks.count",
            lambda: _chart(guides=[hg.colorbar(layers=[{"id": "a", "ticks": {"count": -1}}])]),
        ),
    ]
    for path, make in [*cases.items(), *again]:
        with pytest.raises(hg.ChartError) as raised:
            result = make()
            if isinstance(result, hg.Chart):
                result.to_spec()
        assert raised.value.path == path, raised.value
    # An object of options made alone refuses within itself, by its maker's name.
    for path, make in {
        "size.value": lambda: hg.Encodings(size=hg.Channel(value=object())),
        "scale": lambda: hg.axis(5),  # type: ignore[arg-type]
        "layers[0]": lambda: hg.axis("x", layers=[{"ticks": {"count": 4}}]),
        "layers": lambda: hg.axis("x", layers=5),  # type: ignore[arg-type]
        "parts[0].parts[1].size": lambda: hg.Swatch(
            "composite",
            parts=[
                {
                    "type": "composite",
                    "parts": [
                        {"type": "symbol", "fill": "red"},
                        {"type": "line", "stroke": "red", "size": 2},
                    ],
                }
            ],
        ),
        "parts[0].parts[0].symbol": lambda: hg.Swatch("composite", parts=[swatch]),
    }.items():
        with pytest.raises(hg.ChartError) as raised:
            make()
        assert raised.value.path == path, raised.value
    # A page another page's failure does not take the blame for its own.
    padded = _chart(x=hg.AxisOptions(padding=hg.Pixels(1000)))
    with pytest.raises(hg.ChartError) as raised:
        hg.to_pdf([padded, _undescribed()])
    assert raised.value.path == "charts[1].description"


def test_what_python_takes_besides_its_types():
    # Seaborn's per-axis forms, NumPy pairs among them.
    two = {"x": "t", "y": "v"}
    for given in (
        {"discrete": (True, False)},
        {"binwidth": np.array([1.0, 1.0])},
        {"binrange": np.array([[0.0, 3.0], [1.0, 4.0]])},
    ):
        assert hx.histplot(DATA, **two, **given).to_svg().startswith("<svg")
    # A panel's camera sets only what it names, from any mapping.
    from types import MappingProxyType

    chart = hg.Chart(
        {**DATA, "z": DATA["w"]},
        camera={"elevation": 60, "zoom": 2},
        panels=[hg.Panel("p", camera=MappingProxyType({"azimuth": 45}))],
    ).point_3d("t", "v", "z", panel="p")
    assert [panel["camera"] for panel in chart.to_spec()[0]["panels"]] == [{"azimuth": 45.0}]


def test_options_take_subclasses_and_numpy_times_as_they_are():
    import enum
    from fractions import Fraction

    def spec(chart: hg.Chart) -> Any:
        return chart.to_spec()[0]

    # NumPy's times keep their units, whatever they are.
    day = dt.datetime(2026, 1, 1)
    for unit in ("D", "ms", "ns"):
        given = hg.Chart(DATA).rule(x=np.datetime64("2026-01-01", unit))
        assert spec(given) == spec(hg.Chart(DATA).rule(x=day))

    # Text of a str enum, a float's subclass, and a fraction are what they stand for.
    class Renderer(str, enum.Enum):
        SVG = "svg"

    class Width(float):
        pass

    assert spec(_chart(renderer=Renderer.SVG)) == spec(_chart(renderer="svg"))
    assert spec(_line(stroke_width=Width(1.5))) == spec(_line(stroke_width=1.5))
    assert hg.Weight(Fraction(3, 2)).value == Fraction(3, 2)
    assert _line(stroke_width=Width(1.5)).to_svg().startswith("<svg")


def test_paths_do_not_depend_on_what_was_imported_first():
    # A refusal before herceg.express is imported, then one of express's own.
    script = """
import herceg as hg
for make in (
    lambda: hg.Chart({"v": [1.0, 2.0]}, padding={"top": -1}),
    lambda: __import__("herceg.express").express.histplot(
        {"v": [1.0, 2.0, 3.0]}, x="v", kde=True, kde_options={"bw_adjust": -1}
    ),
):
    try:
        make()
    except hg.ChartError as error:
        print(error.path)
"""
    done = subprocess.run(
        [sys.executable, "-c", script], capture_output=True, text=True, check=True
    )
    assert done.stdout.split() == ["padding.top", "kde_options.bw_adjust"]


@pytest.mark.contract("errors.derive.paths.python")
def test_transform_steps_refuse_at_their_argument():
    rows = hg.derive(DATA)
    cases = {
        "column": lambda: rows.sort("missing"),
        "condition": lambda: rows.filter(hg.col("v")),
        "value": lambda: rows.calculate("x", hg.when(hg.col("v") > 1, "a", 1)),
        "by": lambda: rows.aggregate(by=5, n="count"),
        "avg": lambda: rows.aggregate(avg=5),
        "mean": lambda: rows.rolling(3, mean="mean"),
        "name": lambda: rows.calculate([], hg.col("v")),  # type: ignore[arg-type]
        "end": lambda: rows.bin("v", end=5),  # type: ignore[arg-type]
        "descending": lambda: rows.sort("t", descending="False"),  # type: ignore[arg-type]
        # Outputs are named by keyword, which may be no name; values are positional.
        '["mean value"]': lambda: rows.aggregate(**{"mean value": 5}),
        "m": lambda: rows.aggregate(m=("v", np.array([1, 2]))),
        "by[1]": lambda: rows.aggregate(by=["s", 5], n="count"),  # type: ignore[list-item]
        "values[1]": lambda: hg.col("v").is_in(1, object()),
    }
    for path, make in cases.items():
        with pytest.raises(hg.ChartError) as raised:
            make()
        assert raised.value.path == path, raised.value
    with pytest.raises(hg.ChartError, match=r"bin column: expected a string; received \['v'\]"):
        rows.bin(["v"])  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError, match="expected a column name"):
        rows.rolling(2, avg=(["v"], "mean"))
    with pytest.raises(hg.ChartError) as raised:
        rows.filter(object())  # type: ignore[arg-type]
    assert raised.value.path == "condition"
    with pytest.raises(hg.ChartError) as raised:
        rows.bin(5)  # type: ignore[arg-type]
    assert (raised.value.path, str(raised.value)) == (
        "column",
        "bin: expected a column name; received 5",
    )


def test_arrays_are_lists_where_options_take_lists():
    import numpy as np
    import pandas as pd

    ends = np.array([0.0, 3.0])
    colors = np.array(["#111111", "#222222"])
    charts = [
        _chart(x=hg.AxisOptions(domain=ends)),
        _chart(scales={"x": hg.Scale(domain=ends)}),
        _chart(limits={"x": hg.ViewLimits(extent=ends)}),
        _chart(theme=hg.Theme(tokens=hg.Tokens(palette=colors))),
        hx.lineplot(DATA, x="t", y="v", series="s", palette=pd.Series(colors)),
    ]
    rows = hg.derive(DATA)
    charts += [
        hg.Chart(DATA, panels=np.array(["a", "b"])).line(x="t", y="v", panel="*"),
        hg.Chart(rows.aggregate(by=np.array(["s"]), n="count")).bar(x="s", y="n"),
        hg.Chart(rows.rolling(2, by=pd.Series(["s"]), m=("v", "mean"))).line(x="t", y="m"),
        _chart(guides=[hg.legend(entries=np.array([hg.LegendEntry(key="k", label="L")]))]),
    ]
    for chart in charts:
        spec, _ = chart.to_spec()
        json.dumps(spec)


def test_durations_are_no_numbers_in_arrays_ranges_and_cells():
    # A NumPy duration is an integer of its unit: where numbers go, it is refused
    # at its place, not read as a count of seconds or nanoseconds.
    seconds = np.array([0, 1, 5], dtype="timedelta64[s]")
    nanoseconds = seconds.astype("timedelta64[ns]")
    grid = {"x": [0.0, 1.0, 0.0, 1.0], "y": [0.0, 0.0, 1.0, 1.0], "z": [1.0, 2.0, 3.0, 4.0]}
    cases = [
        (lambda edges: hg.histogram(DATA, "v", bins=edges), "marks[0].bins[0]"),
        (lambda edges: hg.Chart(hg.derive(DATA).bin("v", bins=edges)), "bins[0]"),
        (lambda edges: hg.contour(grid, "x", "y", "z", thresholds=edges), "marks[0].thresholds[0]"),
        (lambda edges: hx.histplot(DATA, x="v", bins=edges), "bins[0]"),
    ]
    for make, path in cases:
        for edges in (seconds, nanoseconds, list(seconds)):
            with pytest.raises(hg.ChartError) as raised:
                make(edges).to_spec()
            assert raised.value.path == path, (path, edges)
    with pytest.raises(hg.ChartError, match=r"histplot bins\[1\]\[1\]: expected a finite number"):
        hx.histplot(DATA, x="v", y="w", bins=([0, 1], [0, np.timedelta64(5, "s")]))
    # A tick interval goes straight to milliseconds, below a microsecond too.
    for every, milliseconds in (
        (np.timedelta64(5, "ns"), 5e-6),
        (np.timedelta64(1500, "ns"), 0.0015),
    ):
        spec, _ = _chart(x={"ticks": {"every": every}}).to_spec()
        assert spec["x"]["ticks"]["every"] == {"milliseconds": milliseconds}
    with pytest.raises(hg.ChartError, match="Ticks every: expected a positive elapsed time"):
        _chart(x={"ticks": {"every": np.timedelta64(-1, "s")}}).to_spec()
    # A cell's span is a Python int before the grid's bounds are summed.
    with pytest.raises(hg.ChartError, match="row_span: reaches past the grid's 2 tracks"):
        hg.Chart().grid(rows=2, columns=1).cell(1, 0, row_span=np.int64(2**63 - 1))


def test_widget_viewports_and_selections_take_their_fields_by_their_hints():
    widget = hg.Chart(DATA, brush="xy").line(x="t", y="v").widget()
    sent: list[dict[str, Any]] = []
    widget.comm.send = lambda data=None, buffers=None, **_: sent.append(data["content"])
    for unit in ("s", "ns"):
        with pytest.raises(hg.ChartError) as raised:
            widget.set_viewport(hg.Viewport(x=(0, np.timedelta64(5, unit))))
        assert raised.value.path == "view.x[1]"
        with pytest.raises(hg.ChartError) as raised:
            widget.set_viewport(y=(0, np.timedelta64(5, unit)))
        assert raised.value.path == "y[1]"
    with pytest.raises(hg.ChartError) as raised:
        widget.selection = hg.Selection(lasso=5)
    assert (raised.value.path, str(raised.value)) == (
        "selection.lasso",
        "Selection lasso: expected a list of (x, y) points; received 5",
    )
    lasso = [(0, 0), (1, np.timedelta64(1, "s")), (2, 0)]
    with pytest.raises(hg.ChartError) as raised:
        widget.selection = hg.Selection(lasso=lasso)
    assert raised.value.path == "selection.lasso[1][1]"
    # NumPy's numbers and arrays are taken as Python's.
    widget.set_viewport(hg.Viewport(x=np.array([0, 2.0]), y=(np.int64(1), np.float32(3))))
    assert sent[-1]["viewport"] == {"x": [0.0, 2.0], "y": [1.0, 3.0], "yRight": None, "time": []}
    widget.selection = hg.Selection(x=(np.float64(0), np.int64(1)))
    assert widget.selection == hg.Selection(x=(0.0, 1.0))


def test_options_given_as_users_compute_them_are_read_alike():
    # Edges as a tuple are edges; of two columns, two counts (floats too) are x's and y's.
    tupled, _ = hx.histplot(DATA, x="v", bins=(0.5, 1.5, 4.5)).to_spec()
    listed, _ = hx.histplot(DATA, x="v", bins=[0.5, 1.5, 4.5]).to_spec()
    assert tupled["marks"][0]["bins"] == listed["marks"][0]["bins"] == [0.5, 1.5, 4.5]
    for counts in ([3.0, 4.0], np.array([3.0, 4.0]), (3, 4)):
        spec, _ = hx.histplot(DATA, x="v", y="w", bins=counts).to_spec()
        assert [len(spec["marks"][0]["bins"][axis]) for axis in ("x", "y")] == [4, 5]
    with pytest.raises(hg.ChartError) as raised:
        hx.histplot(DATA, x="v", y="w", bins=[0.5, 1.5])
    assert raised.value.path == "bins[0]"
    assert "(of two columns, bins for x and y); received 0.5" in str(raised.value)
    with pytest.raises(hg.ChartError) as raised:
        hg.graph({"a": ["x"], "b": ["y"]}, "a", "b", layout=True).to_spec()
    assert raised.value.path == "marks[0].layout"
    widget = hg.Chart(DATA, panels=["p"], brush="x").line(x="t", y="v", panel="p").widget()
    widget.selection = hg.Selection(x=(0, 1), panels=["p"])
    assert widget.selection == hg.Selection(x=(0.0, 1.0), panels=("p",))
