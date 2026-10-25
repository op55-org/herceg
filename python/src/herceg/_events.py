"""Interaction reported by the browser: viewports, selections, and the data under the pointer.

The browser sends plain JSON: numbers, with times as epoch milliseconds on the
axes it names in ``time``, and category positions as their labels. These
functions turn it into Python values, with datetimes for times, and back.
"""

from __future__ import annotations

import datetime as _dt
import math
from collections.abc import Mapping
from dataclasses import dataclass, replace
from types import MappingProxyType
from typing import Any, Literal, TypeVar

from ._data import _time_ms, listlike
from ._errors import (
    ChartError,
    Hint,
    check_hints,
    hints_of,
    is_number,
    located,
    python_values,
    shown,
)

#: A position on an axis as Python sees it: a number, a datetime on time
#: axes (naive, in UTC, like the datetimes herceg reads), or a category label.
Value = float | _dt.datetime | str

#: A range on an axis: its two ends, ascending (category labels in axis order).
Range = tuple[Value, Value]

#: Item keys from the top level through a tree's current drill root.
DrillRoot = tuple[str, ...]
#: Manual network node positions, in layout units rather than pixels.
ItemPositions = dict[str, tuple[float, float]]

_EPOCH = _dt.datetime(1970, 1, 1)


@dataclass(frozen=True)
class Viewport:
    """What a chart shows when zoomed: the visible ``x`` range and the ranges of
    the left (``y``) and right (``y_right``) y axes, each None when that axis
    is not zoomed and shows its configured domain or its data."""

    x: Range | None = None
    y: Range | None = None
    y_right: Range | None = None


@dataclass(frozen=True)
class Selection:
    """What is brushed: the ``x`` and ``y`` ranges (None along an axis the brush
    leaves alone; a lasso's extent) and a ``lasso``'s outline as ``(x, y)``
    points. The outline's points are numbers or datetimes; on a category axis
    they are band positions, the first category at 0. ``panels`` names the
    subplot of a map's or network's lasso; None for the chart's own."""

    x: Range | None = None
    y: Range | None = None
    lasso: tuple[tuple[float | _dt.datetime, float | _dt.datetime], ...] | None = None
    panels: tuple[str, ...] | None = None


@dataclass(frozen=True)
class ViewEdge:
    """The view came near an end of what the chart's ``limits`` let a scale show
    (``widget.on_edge``): the ``scale`` ("x", "y", or "y_right") and its
    ``instance`` (see ``hg.ScaleInstance``), the ``side`` ("start", its low
    values, or "end"), what the view shows (``domain``), the ``bound`` it is
    near (the extent's end, or the data's), the panels drawing the instance
    (``panels``, ``("",)`` in a chart of one panel), and what moved the view
    there (``cause``: "pointer", "wheel", "keyboard", "api", "sync", "data",
    or "options")."""

    scale: str
    instance: str
    side: str
    domain: Range
    bound: float | _dt.datetime
    cause: str
    panels: tuple[str, ...]


def decode_edge(payload: Any) -> ViewEdge:
    """An edge event from the browser (``EdgePayload``), with datetimes on
    time axes. Raises ValueError for one of another shape."""
    if not isinstance(payload, Mapping):
        raise ValueError(f"an edge event is an object, not {payload!r}")
    scale, instance, panels, time = _scale_instance(payload)
    side, cause, ends = (payload.get(key) for key in ("side", "cause", "domain"))
    bound: Any = payload.get("bound")
    if side not in ("start", "end") or cause not in _CAUSES:
        raise ValueError(f"an edge has a side and a cause, not {side!r} and {cause!r}")
    if not (isinstance(ends, list) and len(ends) == 2 and all(map(_finite, [*ends, bound]))):
        raise ValueError(f"an edge's domain and bound are finite numbers: {payload!r}")
    low, high = ends
    return ViewEdge(
        scale=scale,
        instance=instance,
        side=side,
        domain=(_time(float(low), time), _time(float(high), time)),
        bound=_time(float(bound), time),
        cause=cause,
        panels=panels,
    )


@dataclass(frozen=True)
class InspectedField:
    """A column of the row a tooltip is at that its mark's tooltip shows
    (``hg.Tooltip(fields=...)``)."""

    field: str
    #: What the tooltip names it by.
    label: str
    #: "number", "time", or "category".
    kind: str
    #: A number, a datetime for times, a category, or None when missing.
    value: Value | None
    #: The value as the tooltip writes it.
    text: str


@dataclass(frozen=True)
class InspectedPoint:
    """One point under the pointer: a series' value, or a pie slice, a tree's node,
    and other items of charts without axes."""

    #: What the tooltip names the point by: its series' name, a heatmap cell's
    #: row category, or an item's name.
    label: str
    #: None for a missing value.
    value: float | None
    #: The value as the tooltip shows it.
    text: str
    #: The point's row in its mark's data, as the chart holds it (``df.iloc[row]``
    #: of the dataframe given, or of a derived table's result; a choropleth's
    #: feature joined by ``geojson=``). None where no one row is the point:
    #: histogram bins, box plot and violin groups, pie slices, funnel stages,
    #: tree nodes, and network and Sankey nodes and links. Rows of live charts
    #: streaming with ``max_rows`` renumber as old rows are dropped.
    row: int | None = None
    #: The point's mark: its index among the chart's marks, in the order they were added.
    mark: int = 0
    #: The mark's ``id``, when it has one.
    mark_id: str | None = None
    #: Identifies the point's series (or item) in the chart.
    key: str = ""
    #: The columns of ``row`` its mark's tooltip shows besides its value.
    fields: tuple[InspectedField, ...] = ()


@dataclass(frozen=True)
class Inspection:
    """The data under the pointer, as the tooltip shows it.

    ``value`` is the snapped position on the inspected axis: x, or y for
    horizontal bars (``axis == "y"``). For a pie slice (``axis == "item"``),
    it is the slice's value, and ``label`` names what the values measure.
    """

    axis: Literal["x", "y", "item"]
    value: Value | None
    #: ``value`` as the axis labels it.
    label: str
    points: tuple[InspectedPoint, ...]
    #: The facet value of the panel, in charts with facets; with ``facet_row``
    #: and ``facet_column``, both values as a JSON array, as in ``'["North","A"]'``.
    panel: str | None = None
    #: A 3D chart's point by column: numbers (datetimes as epoch milliseconds)
    #: and category labels; None for other charts.
    values: dict[str, float | str] | None = None


def decode_viewport(payload: Any) -> Viewport:
    """A viewport from the browser: ``{"x", "y", "yRight", "time"}``, or null for no zoom."""
    if not payload:
        return Viewport()
    time = payload.get("time", ())
    return Viewport(
        x=_range(payload.get("x"), "x" in time),
        y=_range(payload.get("y"), "y" in time),
        y_right=_range(payload.get("yRight"), "yRight" in time),
    )


#: What changed a view: a drag or pinch ("pointer"), the wheel, a key, a
#: call (``set_viewport``), a synced chart, the chart's data, or its options.
ViewCause = Literal["pointer", "wheel", "keyboard", "api", "sync", "data", "options"]
_CAUSES = ("pointer", "wheel", "keyboard", "api", "sync", "data", "options")

#: A position scale: ``"x"``, or the left (``"y"``) or right (``"y_right"``) y axis.
ScaleName = Literal["x", "y", "y_right"]
#: The scales by the names the browser writes.
_SCALES: dict[str, ScaleName] = {"x": "x", "y": "y", "yRight": "y_right"}


@dataclass(frozen=True)
class ScaleInstance:
    """One instance of a position scale: the panels sharing a domain, and a
    view, along it (the ``scope`` of the chart's ``x``, ``y``, and
    ``y_right``). ``instance`` names it among its scale's instances: compare
    it, never read it, and do not keep it, since a chart drawn again names
    them anew. ``panels`` are the keys of the panels drawing with it, in
    reading order (``""`` in a chart of one panel). A map's or network's
    plane is an instance of x and one of y."""

    scale: ScaleName
    instance: str
    panels: tuple[str, ...]


@dataclass(frozen=True)
class ScaleView(ScaleInstance):
    """A scale instance's view after a change: its range, ascending, or None
    where it is fitted (to its domain or its data)."""

    view: Range | None


@dataclass(frozen=True)
class ViewportEvent:
    """One change of view: zooming, panning, a reset, ``set_viewport``, a
    synced chart, or new data or options moving the view.

    ``scales`` are the scale instances whose views changed, each once;
    ``views`` the whole view of each panel still drawing one of them, by
    panel key in reading order. An instance no longer drawn (the panels of
    a facet value whose rows went, say, or panels now sharing scales
    otherwise) is reported fitted with the panels it had, of which those
    gone have no view in ``views``. ``panel`` is the panel the change was
    made in (a gesture's, a call's ``panel``, a sync channel's), None for
    changes naming none; ``cause`` says what made it; ``view_revision``
    counts the changes of view of the chart as one display draws it."""

    view_revision: int
    cause: ViewCause
    panel: str | None
    scales: tuple[ScaleView, ...]
    views: Mapping[str, Viewport]


@dataclass(frozen=True)
class SelectionOwner:
    """What a selection belongs to: the scale instances it has ranges on (an
    x brush's x, a y brush's y, a rectangle's or a lasso's both), and the
    panels drawing all of them, which show it."""

    scales: tuple[ScaleInstance, ...]
    panels: tuple[str, ...]


@dataclass(frozen=True)
class SelectEvent:
    """A change of what is brushed: the ``selection``, None once cleared, and
    its ``owner`` (for a cleared selection, what it belonged to)."""

    selection: Selection | None
    owner: SelectionOwner


@dataclass(frozen=True)
class PanelVisibility:
    """What a panel's legend hid and showed in that panel unlike in the rest of the chart."""

    hidden: tuple[str, ...]
    shown: tuple[str, ...]


@dataclass(frozen=True)
class VisibilityState:
    """What the chart's legends hide, as series, item, and identity keys:
    ``hidden_keys`` in the whole chart, and by panel key, what a panel's
    legend hid and showed there unlike in the rest (``panels``)."""

    hidden_keys: tuple[str, ...]
    panels: Mapping[str, PanelVisibility]


def decode_viewport_event(payload: Any) -> ViewportEvent:
    """A viewport event from the browser (``ViewportEventPayload``), with
    datetimes on time axes. Raises ValueError for one of another shape."""
    if not isinstance(payload, Mapping):
        raise ValueError(f"a viewport event is an object, not {payload!r}")
    revision = payload.get("viewRevision")
    if not (isinstance(revision, int) and not isinstance(revision, bool) and revision >= 0):
        raise ValueError(f"viewRevision is a whole number, not {revision!r}")
    cause = payload.get("cause")
    if cause not in _CAUSES:
        raise ValueError(f"cause is one of {', '.join(_CAUSES)}, not {cause!r}")
    panel = payload.get("panel")
    if panel is not None and not isinstance(panel, str):
        raise ValueError(f"panel is a panel key, not {panel!r}")
    scales, views = payload.get("scales"), payload.get("views")
    if not isinstance(scales, list) or not isinstance(views, list):
        raise ValueError("a viewport event lists its scales and views")
    decoded: dict[str, Viewport] = {}
    for view in views:
        key = view.get("panel") if isinstance(view, Mapping) else None
        if not isinstance(key, str) or key in decoded:
            raise ValueError(f"a view names a panel of its own, not {view!r}")
        decoded[key] = decode_viewport(checked("viewport", dict(view)))
    return ViewportEvent(
        view_revision=revision,
        cause=cause,
        panel=panel,
        scales=tuple(_scale_view(scale) for scale in scales),
        views=MappingProxyType(decoded),
    )


def checked_views(payload: Any) -> dict[str, Any] | None:
    """What a display's chart shows, as the widget's browser side reports it
    (``ViewsPayload``: its axes' views as the engine reads them, and each
    map's or network's subplot's plane), checked whole. Raises ValueError
    for one of another shape."""
    if payload is None:
        return None
    if not isinstance(payload, Mapping) or not isinstance(payload.get("axes"), Mapping):
        raise ValueError(f"views are of axes and planes, not {payload!r}")
    axes, planes = payload["axes"], payload.get("planes", {})
    if not isinstance(planes, Mapping):
        raise ValueError(f"planes map panel keys to views, not {planes!r}")
    scales, views = axes.get("scales"), axes.get("views")
    if not isinstance(scales, list) or not isinstance(views, list):
        raise ValueError("a state of views lists its scales and views")
    for scale in scales:
        _scale_view(scale)
        if not isinstance(scale.get("identity"), str):
            raise ValueError(f"a scale in a state of views has an identity: {scale!r}")
    for view in [*views, *planes.values(), *([axes["view"]] if "view" in axes else [])]:
        checked("viewport", view)
        if view is not None and not isinstance(view, Mapping):
            raise ValueError(f"a view is an object, not {view!r}")
    if not all(isinstance(view.get("panel"), str) for view in views):
        raise ValueError("each view of a state names its panel")
    return {"axes": dict(axes), "planes": dict(planes)}


def same_views(a: Mapping[str, Any] | None, b: Mapping[str, Any] | None) -> bool:
    """Whether two states of views (see `checked_views`) show the same: the
    revisions displays count are their own."""

    def shown(views: Mapping[str, Any] | None) -> Any:
        return views and ({**views["axes"], "viewRevision": 0}, views["planes"])

    return bool(shown(a) == shown(b))


def views_of(views: Mapping[str, Any] | None) -> dict[str, Viewport]:
    """Each panel's whole view in a state of views, by panel key: of its
    axes, or a map's or network's subplot's plane."""
    if views is None:
        return {}
    shown = {view["panel"]: decode_viewport(view) for view in views["axes"]["views"]}
    return {**shown, **{panel: decode_viewport(view) for panel, view in views["planes"].items()}}


def chart_view(views: Mapping[str, Any] | None) -> Viewport | None:
    """A state of views' view without a panel: along each axis, of the
    instance every panel shares, or the only one; None where that needs a
    panel (maps' and networks' subplots), or before any state."""
    if views is None or "view" not in views["axes"]:
        return None
    return decode_viewport(views["axes"]["view"])


def encode_view_change(view: Any, axes: Mapping[str, Any], role: str) -> dict[str, Any] | None:
    """A change of view set from Python (``set_viewport``), as the browser
    takes it: a ``Viewport`` (`view`) sets every axis, a pair x alone, and
    None resets every axis; or the axes given (``axes``: x, y, y_right, each
    a range or None to reset it), the others kept. None for a reset of every
    axis. `role` names the method in refusals."""
    if view is not _UNSET and axes:
        raise ChartError(
            f"{role} {next(iter(axes))}: give a view, or the axes to change, not both; drop one"
        )
    if view is _UNSET and not axes:
        raise ChartError(
            f"{role} view: expected a view, or the axes to change; give hg.Viewport(...), "
            "a (start, end) x range, None to reset every axis, or x=, y=, y_right="
        )
    if view is None:
        return None
    if isinstance(view, Viewport):
        # Its refusals are at its fields, within the view.
        return located("view", lambda: encode_viewport(view), "Viewport")
    names = {"x": "x", "y": "y", "y_right": "yRight"}
    ranges = axes if view is _UNSET else {"view": view}
    change: dict[str, Any] = {"time": []}
    for name, ends in ranges.items():
        axis = names.get(name, "x")
        change[axis], time = _encode_range(ends, f"{role} {name}")
        if time:
            change["time"].append(axis)
    return change


#: An argument left out, where None means something (a reset).
_UNSET: Any = type("_Unset", (), {"__repr__": lambda self: "<unset>"})()


def _scale_instance(payload: Any) -> tuple[ScaleName, str, tuple[str, ...], bool]:
    """A scale instance's fields from the browser (``ScaleInstancePayload``),
    with whether its values are times."""
    if not isinstance(payload, Mapping):
        raise ValueError(f"a scale instance is an object, not {payload!r}")
    name = payload.get("scale")
    scale = _SCALES.get(name) if isinstance(name, str) else None
    instance, time = payload.get("instance"), payload.get("time")
    if scale is None or not isinstance(instance, str) or not isinstance(time, bool):
        raise ValueError(f"expected a scale, its instance, and whether it holds times: {payload!r}")
    return scale, instance, _keys(payload.get("panels")), time


def _scale_view(payload: Any) -> ScaleView:
    """A scale instance's view from the browser (``ScaleViewPayload``): its
    ends, low to high, or null where it is fitted."""
    scale, instance, panels, time = _scale_instance(payload)
    if "view" not in payload:
        raise ValueError(f"a scale's view is its ends or null, never missing: {payload!r}")
    ends = _checked_range(payload["view"])
    if ends is not None and not isinstance(ends[0], str) and ends[0] > ends[1]:
        raise ValueError(f"a scale's view runs from low to high, not {ends!r}")
    return ScaleView(scale, instance, panels, _range(ends, time))


def _keys(value: Any, what: str = "panel keys") -> tuple[str, ...]:
    if not (isinstance(value, list) and all(isinstance(key, str) for key in value)):
        raise ValueError(f"expected a list of {what}, not {value!r}")
    return tuple(value)


def decode_select_event(payload: Any) -> SelectEvent:
    """A select event from the browser (``SelectEventPayload``). Raises
    ValueError for one of another shape."""
    if not isinstance(payload, Mapping) or not isinstance(payload.get("owner"), Mapping):
        raise ValueError(f"a select event has an owner, not {payload!r}")
    owner = payload["owner"]
    scales = owner.get("scales")
    if not isinstance(scales, list):
        raise ValueError(f"an owner lists its scales, not {scales!r}")
    instances = []
    for scale in scales:
        name, instance, panels, _ = _scale_instance(scale)
        instances.append(ScaleInstance(name, instance, panels))
    return SelectEvent(
        selection=decode_selection(checked("select", payload.get("selection"))),
        owner=SelectionOwner(tuple(instances), _keys(owner.get("panels"))),
    )


def decode_visibility(payload: Any) -> VisibilityState:
    """A visibility event from the browser (``VisibilityPayload``). Raises
    ValueError for one of another shape."""
    if not isinstance(payload, Mapping):
        raise ValueError(f"a visibility event is an object, not {payload!r}")
    panels = payload.get("panels", {})
    if not isinstance(panels, Mapping):
        raise ValueError(f"panels map panel keys to what their legends set, not {panels!r}")
    decoded = {}
    for key, own in panels.items():
        if not isinstance(key, str) or not isinstance(own, Mapping):
            raise ValueError(f"a panel's visibility is an object, not {own!r}")
        decoded[key] = PanelVisibility(
            _keys(own.get("hidden"), "keys"), _keys(own.get("shown"), "keys")
        )
    return VisibilityState(_keys(payload.get("hiddenKeys"), "keys"), MappingProxyType(decoded))


def decode_drill_root(payload: dict[str, Any] | None) -> DrillRoot | None:
    return tuple(payload["path"]) if payload else None


def encode_drill_root(
    value: DrillRoot | None, name: str = "widget.drill_root"
) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, tuple) or not all(isinstance(key, str) for key in value):
        raise ChartError(
            f"{name}: expected a tuple of item keys or None; use the path reported by on_drill"
        )
    return {"path": list(value)} if value else None


def decode_item_positions(payload: dict[str, Any] | None) -> ItemPositions:
    return {key: (float(x), float(y)) for key, (x, y) in (payload or {}).items()}


def encode_item_positions(
    value: Mapping[str, tuple[float, float]], name: str = "widget.item_positions"
) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ChartError(f"{name}: expected item keys mapped to (x, y) pairs; use {{}} to reset")
    out: dict[str, Any] = {}
    for key, pair in value.items():
        if not isinstance(key, str):
            raise ChartError(f"{name}: item keys must be strings; use inspection keys")
        valid = (
            isinstance(pair, (tuple, list))
            and len(pair) == 2
            and all(is_number(v) and not isinstance(v, bool) for v in pair)
        )
        try:
            coordinates = [float(v) for v in pair] if valid else []
        except OverflowError:
            coordinates = []
        if not coordinates or not all(math.isfinite(v) for v in coordinates):
            raise ChartError(f"{name}: expected two finite coordinates per key; use (x, y) pairs")
        out[key] = coordinates
    return out


def encode_viewport(value: Any) -> dict[str, Any]:
    """A viewport set from Python, as the browser takes it: a ``Viewport``, an x
    range, or None for no zoom."""
    if value is None:
        value = Viewport()
    elif not isinstance(value, Viewport):
        value = Viewport(x=value)
    value, later = _fields_taken(value)
    axes = {"x": value.x, "y": value.y, "yRight": value.y_right}
    names = {"x": "Viewport x", "y": "Viewport y", "yRight": "Viewport y_right"}
    encoded = {axis: _encode_range(ends, names[axis]) for axis, ends in axes.items()}
    check_hints("Viewport", vars(value), later)
    return {
        **{axis: ends for axis, (ends, _) in encoded.items()},
        "time": [axis for axis, (_, time) in encoded.items() if time],
    }


def decode_selection(payload: Any) -> Selection | None:
    """A selection from the browser: ``{"x", "y", "lasso", "time"}``, or null for none."""
    if not payload:
        return None
    time = payload.get("time", ())
    lasso = payload.get("lasso")
    panels = payload.get("panels")
    return Selection(
        x=_range(payload.get("x"), "x" in time),
        y=_range(payload.get("y"), "y" in time),
        lasso=None
        if lasso is None
        else tuple((_time(x, "x" in time), _time(y, "y" in time)) for x, y in lasso),
        panels=None if panels is None else tuple(panels),
    )


def encode_selection(value: Any) -> dict[str, Any] | None:
    """A selection set from Python, as the browser takes it: a ``Selection``, an x
    range, or None for none (as is a selection of nothing)."""
    if value is None:
        return None
    if not isinstance(value, Selection):
        value = Selection(x=value)
    value, later = _fields_taken(value)
    x, x_time = _encode_range(value.x, "Selection x")
    y, y_time = _encode_range(value.y, "Selection y")
    lasso = None
    if value.lasso is not None:
        if not listlike(value.lasso):
            raise ChartError(
                f"Selection lasso: expected a list of (x, y) points; received {shown(value.lasso)}"
            )
        points = [_vertex(point) for point in value.lasso]
        if len(points) < 3:
            raise ChartError(f"Selection lasso: expected at least 3 points; received {len(points)}")
        lasso = [[px, py] for (px, _), (py, _) in points]
        x_time = x_time or any(px_time for (_, px_time), _ in points)
        y_time = y_time or any(py_time for _, (_, py_time) in points)
    panels = tuple(value.panels) if listlike(value.panels) else value.panels
    if panels is not None and not (
        isinstance(panels, tuple) and panels and all(isinstance(p, str) for p in panels)
    ):
        raise ChartError(
            "Selection panels: expected a tuple of panel ids, or None for the chart's own; "
            f"received {shown(panels)}"
        )
    check_hints("Selection", vars(value), later)
    if x is None and y is None and lasso is None:
        return None
    time = [axis for axis, flag in (("x", x_time), ("y", y_time)) if flag]
    return {
        "x": x,
        "y": y,
        "lasso": lasso,
        "time": time,
        **({"panels": list(panels)} if panels else {}),
    }


#: The axes each kind of state has ranges on.
_AXES = {"select": ("x", "y"), "viewport": ("x", "y", "yRight")}


def checked(event: str, payload: Any) -> dict[str, Any] | None:
    """Interaction state from the browser, checked and normalized before it
    is kept. Raises ValueError for a payload of another shape."""
    if payload is None and event == "itemMove":
        raise ValueError("expected item keys mapped to coordinate pairs")
    if payload is None:
        return None
    if not isinstance(payload, dict):
        raise ValueError(f"expected an object, not {payload!r}")
    if event == "camera":
        from ._chart import Camera

        try:
            return Camera(**payload)._spec()
        except (TypeError, ValueError) as error:
            raise ChartError(f"camera: invalid settings; {error}") from error
    if event == "drill":
        path = payload.get("path")
        if not isinstance(path, list) or not all(isinstance(key, str) for key in path):
            raise ValueError("expected a path of item keys")
        return {"path": list(path)} if path else None
    if event == "itemMove":
        return encode_item_positions(payload)
    if event == "click":
        return _checked_inspection(payload)
    axes = _AXES[event]
    out: dict[str, Any] = {axis: _checked_range(payload.get(axis)) for axis in axes}
    time = payload.get("time", [])
    if not (isinstance(time, list) and all(axis in axes for axis in time)):
        raise ValueError(f"time names axes among {axes}, not {time!r}")
    if event == "select":
        out["lasso"] = _checked_lasso(payload.get("lasso"))
        if all(out[key] is None for key in ("x", "y", "lasso")):
            return None
        # Which categories a lasso's band positions refer to, kept for browsers.
        if payload.get("categories") is not None:
            out["categories"] = payload["categories"]
        panels = payload.get("panels")
        if panels is not None:
            if not (isinstance(panels, list) and all(isinstance(p, str) for p in panels)):
                raise ValueError(f"panels are panel ids, not {panels!r}")
            out["panels"] = panels
    out["time"] = time
    return out


def _checked_inspection(payload: dict[str, Any]) -> dict[str, Any]:
    """An inspection as the browser writes it (python/js's ``inspectionPayload``)."""

    def text(value: Any) -> bool:
        return isinstance(value, str)

    def number(value: Any) -> bool:
        return value is None or _finite(value)

    def index(value: Any) -> bool:
        return isinstance(value, int) and not isinstance(value, bool) and value >= 0

    if payload.get("axis") not in ("x", "y", "item"):
        raise ValueError(f'axis is "x", "y", or "item", not {payload.get("axis")!r}')
    if not text(payload.get("label")) or not isinstance(payload.get("time", False), bool):
        raise ValueError("expected a label and whether the value is a time")
    if not (number(payload.get("value")) or text(payload.get("value"))):
        raise ValueError(f"value is a number or a label, not {payload.get('value')!r}")
    if payload.get("panel") is not None and not text(payload["panel"]):
        raise ValueError(f"panel is a panel key, not {payload['panel']!r}")
    points = payload.get("points")
    if not isinstance(points, list):
        raise ValueError("expected a list of points")
    for i, point in enumerate(points):
        if not (
            isinstance(point, dict)
            and index(point.get("mark"))
            and all(text(point.get(name)) for name in ("key", "label", "text"))
            and (point.get("markId") is None or text(point["markId"]))
            and (point.get("row") is None or index(point["row"]))
            and number(point.get("value"))
            and isinstance(point.get("fields", []), list)
        ):
            raise ChartError(
                f"points[{i}]: expected mark, key, label, text, and value as the browser "
                f"writes them, not {point!r}"
            )
        for j, field in enumerate(point.get("fields", [])):
            if not (
                isinstance(field, dict)
                and all(text(field.get(name)) for name in ("field", "label", "kind", "text"))
                and "value" in field
                and (number(field["value"]) or text(field["value"]))
            ):
                raise ChartError(
                    f"points[{i}].fields[{j}]: expected field, label, kind, text, and value, "
                    f"not {field!r}"
                )
    values = payload.get("values")
    if values is not None and not (
        isinstance(values, dict)
        and all(text(key) and (number(v) or text(v)) for key, v in values.items())
    ):
        raise ValueError(f"values map columns to numbers or labels, not {values!r}")
    return payload


def _checked_range(ends: Any) -> list[Any] | None:
    if ends is None:
        return None
    if not (isinstance(ends, list) and len(ends) == 2):
        raise ValueError(f"a range is two ends, not {ends!r}")
    if all(isinstance(end, str) for end in ends) or all(_finite(end) for end in ends):
        return ends
    raise ValueError(f"a range's ends are finite numbers or category labels, not {ends!r}")


def _checked_lasso(points: Any) -> list[Any] | None:
    if points is None:
        return None
    if not (isinstance(points, list) and len(points) >= 3):
        raise ValueError(f"a lasso is at least 3 points, not {points!r}")
    for point in points:
        if not (isinstance(point, list) and len(point) == 2 and all(map(_finite, point))):
            raise ValueError(f"a lasso's points are pairs of finite numbers, not {point!r}")
    return points


def _finite(value: Any) -> bool:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    try:
        return math.isfinite(value)
    except OverflowError:
        # An integer too large for a float, as JSON may give one.
        return False


def same_values(a: dict[str, Any] | None, b: dict[str, Any] | None) -> bool:
    """Whether two encoded selections or viewports hold the same values, whichever
    axes hold times: a no-zoom viewport is no viewport."""

    def values(payload: dict[str, Any] | None) -> list[Any]:
        return [(payload or {}).get(key) for key in ("x", "y", "yRight", "lasso", "panels")]

    return values(a) == values(b)


def decode_inspection(payload: Any) -> Inspection | None:
    if not payload:
        return None
    time = bool(payload.get("time"))
    return Inspection(
        axis=payload["axis"],
        value=_value(payload.get("value"), time),
        label=payload["label"],
        points=tuple(
            InspectedPoint(
                label=point["label"],
                value=point.get("value"),
                text=point["text"],
                row=point.get("row"),
                mark=point["mark"],
                mark_id=point.get("markId"),
                key=point["key"],
                fields=tuple(
                    InspectedField(
                        field=field["field"],
                        label=field["label"],
                        kind=field["kind"],
                        value=_value(field["value"], field["kind"] == "time"),
                        text=field["text"],
                    )
                    for field in point.get("fields", ())
                ),
            )
            for point in payload.get("points", ())
        ),
        panel=payload.get("panel"),
        values=payload.get("values"),
    )


_Set = TypeVar("_Set", Viewport, Selection)


def _fields_taken(value: _Set) -> tuple[_Set, dict[str, Hint]]:
    """A viewport or selection set from Python with its fields as their hints
    take them (NumPy's scalars as Python's, pairs from arrays), and the hints
    of those its encoding judges first, refused after it (see `python_values`)."""
    kind: Any = type(value)  # a class, which mypy does not count as hashable
    changed, later = python_values(kind.__name__, vars(value), hints_of(kind))
    return (replace(value, **changed) if changed else value), later


def _range(ends: Any, time: bool) -> Range | None:
    if ends is None:
        return None
    start, end = (_value(value, time) for value in ends)
    # A range has both ends; the browser never sends a half.
    if start is None or end is None:
        return None
    return start, end


def _encode_range(value: Any, role: str) -> tuple[list[Any] | None, bool]:
    """A range as the browser takes it, and whether it holds times: numbers in
    ascending order, datetimes as epoch milliseconds, category labels as given."""
    if value is None:
        return None, False
    try:
        if isinstance(value, str):
            raise TypeError
        start, end = value
    except (TypeError, ValueError):
        raise ChartError(
            f"{role}: expected a (start, end) pair or None; received {shown(value)}"
        ) from None
    if isinstance(start, str) or isinstance(end, str):
        if not (isinstance(start, str) and isinstance(end, str)):
            raise ChartError(
                f"{role}: a range of categories needs two category labels; received {value!r}"
            )
        return [start, end], False
    ends = [_milliseconds(start, role), _milliseconds(end, role)]
    time = not any(is_number(end) for end in (start, end))
    return sorted(ends), time


def _vertex(point: Any) -> tuple[tuple[float, bool], tuple[float, bool]]:
    """A lasso point as the browser takes it, with whether each coordinate is a time."""
    try:
        x, y = point
    except (TypeError, ValueError):
        raise ChartError(
            f"Selection lasso: expected (x, y) pairs; received {shown(point)}"
        ) from None
    return (
        (_milliseconds(x, "Selection lasso"), not is_number(x)),
        (_milliseconds(y, "Selection lasso"), not is_number(y)),
    )


def _value(value: Any, time: bool) -> Value | None:
    if value is None or not time or isinstance(value, str):
        return value
    return _time(value, time)


def _time(value: float, time: bool) -> float | _dt.datetime:
    if not time:
        return value
    try:
        return _EPOCH + _dt.timedelta(milliseconds=value)
    except OverflowError:
        # Beyond the years datetime holds; the milliseconds are still exact.
        return float(value)


def _milliseconds(value: Any, role: str) -> float:
    if is_number(value):
        number = float(value)
    else:
        try:
            number = _time_ms(value)
        except TypeError:
            raise ChartError(
                f"{role}: expected numbers or datetimes; received {shown(value)}"
            ) from None
    if not math.isfinite(number):
        raise ChartError(f"{role}: expected finite values; received {value!r}")
    return number
