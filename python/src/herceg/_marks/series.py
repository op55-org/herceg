"""Series marks: lines, areas, bars, points, rugs, error bars, candlesticks,
and segments."""

from __future__ import annotations

import functools
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, cast, get_args

import numpy as np

from .._data import listlike
from .._derive import Condition, Expr
from .._encoding import (
    CENTERED_OFFSET,
    SYMBOLS,
    BarLabels,
    Caps,
    Channel,
    ChannelOption,
    Continuity,
    Encodings,
    LabelPart,
    LabelPlace,
    MarkStyle,
    Pixels,
    RowPosition,
    SegmentWidth,
    SegmentWidthOption,
    SeriesLabels,
    Stack,
    SymbolName,
    channel_spec,
    choice_option,
    condition_spec,
    encodings_spec,
    fraction_option,
    length_spec,
    mark_style_spec,
    name_spec,
    pixels_option,
    segment_width_spec,
)
from .._errors import ChartError, is_integer, is_number, listed, python_path, refuses, shown
from .._guides import _NUMBER_FORMAT, FORMS, _check_format
from .._style import HaloOption, Look, Side, _built, _camel, _spec, built_spec, look_spec
from .common import (
    _ANY,
    _NUMERIC,
    Clip,
    Dash,
    _check_method_options,
    _check_size,
    _clip,
    _colors,
    _dash,
    _entries,
    _finite,
    _flag,
    _halo,
    _mark_facet,
    _mark_legend,
    _midpoint,
    _range,
    _sides,
)
from .tooltips import Tooltip

if TYPE_CHECKING:
    from .._chart import Chart, _Columns


Curve = Literal["linear", "step", "step-before", "step-after", "monotone"]
BarStack = bool | Literal["fill"]
AreaStack = bool | Literal["fill", "center", "wiggle"] | Stack | Mapping[str, Any]
Orient = Literal["x", "y"]


@refuses
@dataclass
class Jitter:
    """How points in the bands of a category axis spread (``Chart.point``'s
    ``jitter``): across ``width``, a fraction from 0 to 1 of their band (or,
    with ``dodge``, of their series' share of it), by a hash of each row and
    ``seed``, so the same rows land in the same places on every draw, also
    as a live chart streams. ``jitter=0.4`` is ``Jitter(width=0.4)``."""

    width: float = 0.5
    seed: int = 0

    def _spec(self) -> dict[str, Any]:
        if isinstance(self.width, bool) or not (_finite(self.width) and 0 <= self.width <= 1):
            raise ChartError(
                f"Jitter width: expected a number from 0 to 1; received {shown(self.width)}"
            )
        if isinstance(self.seed, bool) or not is_integer(self.seed):
            raise ChartError(f"Jitter seed: expected a whole number; received {shown(self.seed)}")
        spec: dict[str, Any] = {"width": float(self.width)}
        if self.seed:
            spec["seed"] = int(self.seed)
        return spec


#: The channels each mark's ``encode`` takes.
_LINE_CHANNELS = ("color", "stroke", "dash", "stroke_width", "opacity")
_AREA_CHANNELS = ("color", "fill", "stroke", "opacity")
_BAR_CHANNELS = ("color", "fill", "stroke", "stroke_width", "opacity")
_POINT_CHANNELS = ("color", "fill", "stroke", "stroke_width", "opacity", "symbol", "size")


@_check_method_options
def line(
    self,  # type: Chart
    x: str | Sequence[str] | RowPosition,
    y: str | Sequence[str] | RowPosition,
    *,
    orient: Orient | None = None,
    series: str | Literal[False] | None = None,
    dodge: bool = False,
    data: Any = None,
    color: str | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    dash: Dash | None = None,
    opacity: float | None = None,
    stroke_opacity: float | None = None,
    encode: Encodings | Mapping[str, Any] | None = None,
    style: MarkStyle | Mapping[str, Any] | None = None,
    markers: bool | SymbolName | None = None,
    continuity: Continuity | Mapping[str, Any] | None = None,
    where: Expr | None = None,
    curve: Curve | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    labels: SeriesLabels | Mapping[str, Any] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    tooltip: Tooltip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Lines through x and y columns; several value columns or a series column give
    several lines.

    Lines run along x: positions in ``x`` (numbers, times, or categories,
    at their bands' centers in band order) and values in ``y``. With
    ``orient="y"``, or a category ``y``, they run along y instead
    (depth profiles), with values in ``x``, and tooltips and the
    keyboard read them by y. On a category axis, ``dodge=True`` places
    the series of a ``series`` column side by side in each band, as
    grouped bars and dodged points are.

    ``color`` is a CSS color, or a category column: a line per value
    (``series`` defaults to it; ``series=False`` keeps one line per value
    column, and another ``series`` splits the rows by that, each line
    then of one color). A value has one color in every mark and panel
    drawing that column of the data (``scales={"color":
    hg.OrdinalScale(map={...})}`` fixes them); ``stroke`` wins over it.
    ``encode`` gives channels by column, scale, or condition
    (``hg.Encodings``); ``style=hg.MarkStyle(by=hg.StyleMap(...))``
    styles series by value, such as an ``"Average"`` series dashed.
    ``markers=True`` (or a shape name) draws a point at each observation.
    ``continuity`` (``hg.Continuity``) says which neighbors connect, and
    ``where`` leaves rows out as gaps, meeting the line where the
    condition changes.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    places = self._places("line", {"x": x, "y": y}, axis == "right", needed=True)
    x, y = places.columns["x"], places.columns["y"]
    table = self._mark_table(data)
    self._check_places(table, "line", places)
    along, x_spec, y_spec = self._oriented(table, "line", x, y, orient)
    _left_along_y("line", along, axis)
    channels = encodings_spec(encode, _LINE_CHANNELS, "line")
    self._check_colors(table, color, channels, "line")
    split = self._series_of(table, series, color, channels, stroke, "stroke", "line")
    values = y_spec if along == "x" else x_spec
    self._single_or_series(values, split, "line", inferred=series is None)
    self._check_dodge(table, "line", dodge, along, x_spec if along == "x" else y_spec, split)
    positions = x_spec if along == "x" else y_spec
    style_spec = mark_style_spec(style, ("by", "marker"), "line")
    self._check_series_style(table, split, style_spec, "line", positions)
    return self._add(
        {
            "type": "line",
            "x": places.spec("x", x_spec),
            "y": places.spec("y", y_spec),
            "orient": orient,
            "series": series,
            "dodge": _flag(dodge, "line dodge") or None,
            "color": color,
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "line stroke_width"),
            "dash": _dash(dash, "line"),
            "opacity": fraction_option(opacity, "line opacity"),
            "strokeOpacity": fraction_option(stroke_opacity, "line stroke_opacity"),
            "encode": channels,
            "style": style_spec,
            "markers": _markers(markers),
            "continuity": _continuity(continuity, "line"),
            "where": condition_spec(where, "line where"),
            "curve": choice_option(curve, get_args(Curve), "line curve"),
            "label": name_spec(label, "line"),
            "labels": self._series_labels(labels, "line"),
            "legend": _mark_legend(legend, "line"),
            "axis": axis,
            "facet": _mark_facet(facet, "line"),
            "panel": panel,
            "clip": _clip(clip, "line"),
            "tooltip": self._mark_tooltip(
                table, tooltip, "line", ("y" if along == "x" else "x", values)
            ),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "line selected"),
            "unselected": look_spec(unselected, "line unselected"),
            "partial": look_spec(partial, "line partial"),
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "line"),
            "id": id,
        },
        table,
    )


@_check_method_options
def area(
    self,  # type: Chart
    x: str | Sequence[str] | RowPosition | None = None,
    y: str | Sequence[str] | RowPosition | None = None,
    *,
    y1: str | RowPosition | None = None,
    y2: str | RowPosition | None = None,
    x1: str | RowPosition | None = None,
    x2: str | RowPosition | None = None,
    orient: Orient | None = None,
    series: str | Literal[False] | None = None,
    stack: AreaStack = False,
    dodge: bool = False,
    data: Any = None,
    color: str | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    line: bool | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    opacity: float | None = None,
    stroke_opacity: float | None = None,
    encode: Encodings | Mapping[str, Any] | None = None,
    style: MarkStyle | Mapping[str, Any] | None = None,
    continuity: Continuity | Mapping[str, Any] | None = None,
    where: Expr | None = None,
    curve: Curve | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    labels: SeriesLabels | Mapping[str, Any] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    tooltip: Tooltip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Filled areas: down to zero, stacked, or the band between ``y1`` and ``y2``.

    Areas run along x, as lines do, or with ``orient="y"`` (or a category
    ``y``) along y, filled across x to zero; along y, ``x1`` and ``x2``
    give a band. ``stack=True`` stacks several value columns row by row,
    or the series of a ``series`` column on every position any of them
    has. There, a series counts as zero at a position where it has no
    row, or with ``stack=hg.Stack(gaps="interpolate")`` as the straight
    line between its rows on either side; ``hg.Stack(support=
    "intersection")`` stands the stack only where every shown series has
    a row or runs across, and a series' run that ``continuity`` breaks
    is a gap in the whole stack. ``where`` leaves rows out of a stack: one
    left out between a series' rows is a gap in the whole stack, those
    at a series' ends shorten it, and a series it leaves out wholly is no
    layer (``where=hg.col("series").is_in(...)`` stacks some of a table's
    series). On a category axis, ``dodge=True``
    places unstacked series side by side in each band.

    ``stack="fill"`` shows shares of each position's visible total.
    ``"center"`` centers raw thickness around zero; ``"wiggle"`` uses
    the Byron–Wattenberg stream baseline. These offsets require
    nonnegative values; ``hg.Stack(offset=..., order="inside-out")``
    reorders their layers geometrically.

    A single area has an outline along its top in its own color; stacked
    and band areas have none unless ``line=True``. ``stroke`` and
    ``stroke_width`` set the outline's color and width, and turn it on.
    ``color`` is a CSS color or a category column: an area (or band) per
    value, as for lines (``series`` defaults to it; ``fill`` wins over
    it); a ``series`` column splits bands too. ``encode``,
    ``style``, ``continuity``, and ``where`` work as for lines, with
    ``where`` shading only where its condition holds (a conditional
    band).
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    stacking = _built(stack, Stack, "area stack") if isinstance(stack, Mapping) else stack
    if isinstance(stacking, Stack):
        offset = stacking.offset or "zero"
        spread: Any = True if offset == "zero" else offset
        gaps, support = stacking.gaps, stacking.support
    else:
        _check_stack(stack, "area")
        spread, gaps, support = stack, None, None
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            f"area stroke_width: expected 0 or more pixels; received {shown(stroke_width)}"
        )
    places = self._places(
        "area", {"x": x, "y": y, "x1": x1, "x2": x2, "y1": y1, "y2": y2}, axis == "right"
    )
    x, y = places.columns.get("x"), places.columns.get("y")
    x1, x2 = places.column("x1"), places.column("x2")
    y1, y2 = places.column("y1"), places.column("y2")
    table = self._mark_table(data)
    self._check_places(table, "area", places)
    channels = encodings_spec(encode, _AREA_CHANNELS, "area")
    self._check_colors(table, color, channels, "area")
    split = self._series_of(table, series, color, channels, fill, "fill", "area")
    along_x = y1 is not None or y2 is not None
    along_y = x1 is not None or x2 is not None
    if along_x and along_y:
        raise ChartError("area: a band along x (y1, y2) or along y (x1, x2), not both")
    x_spec: str | list[str] | None
    y_spec: str | list[str] | None
    runs: Orient
    if along_x or along_y:
        low, high, values, position = ("y1", "y2", y, x) if along_x else ("x1", "x2", x, y)
        runs = "x" if along_x else "y"
        ends = (y1, y2) if along_x else (x1, x2)
        if ends[0] is None or ends[1] is None:
            missing = low if ends[0] is None else high
            raise ChartError(f"area {missing}: a band needs both {low} and {high}")
        if values is not None:
            other = "y" if along_x else "x"
            raise ChartError(f"area {other}: {other}, or {low} and {high}, not both; drop one")
        if spread:
            raise ChartError(f"area stack: a band ({low} and {high}) does not stack; drop stack")
        if orient is not None and orient != runs:
            raise ChartError(
                f"area orient: a band between {low} and {high} runs along {runs}; drop orient"
            )
        if position is None or not isinstance(position, str):
            raise ChartError(f"area {runs}: a band runs along one {runs} column; give it")
        self._require(table, position, (*_NUMERIC, "category"), f"area {runs}")
        self._require(table, ends[0], _NUMERIC, f"area {low}")
        self._require(table, ends[1], _NUMERIC, f"area {high}")
        if dodge:
            raise ChartError("area dodge: bands do not stand side by side; drop dodge")
        x_spec, y_spec = (position, None) if along_x else (None, position)
        _left_along_y("area", runs, axis)
    else:
        if x is None or y is None:
            raise ChartError(
                "area: needs x and y, or a band: y1 and y2 along x, or x1 and x2 along y"
            )
        runs, x_values, y_values = self._oriented(table, "area", x, y, orient)
        x_spec, y_spec = x_values, y_values
        _left_along_y("area", runs, axis)
        values = y_values if runs == "x" else x_values
        self._single_or_series(values, split, "area", inferred=series is None)
        if isinstance(spread, str):
            _check_stack_values(
                self._tables[table][1], y_values if runs == "x" else x_values, "area"
            )
        if dodge and spread:
            raise ChartError(
                "area dodge: a stack's layers stand on each other; drop dodge or stack"
            )
        self._check_dodge(table, "area", dodge, runs, x_spec if runs == "x" else y_spec, split)
    positions = x_spec if runs == "x" else y_spec
    style_spec = mark_style_spec(style, ("by",), "area")
    self._check_series_style(table, split, style_spec, "area", positions)
    for option, given in (("gaps", gaps), ("support", support)):
        if given is not None and split is None:
            raise ChartError(
                f"area stack {option}: for stacks by a series column; give series, or drop {option}"
            )
    return self._add(
        {
            "type": "area",
            "x": places.spec("x", x_spec),
            "y": places.spec("y", y_spec),
            "y1": places.spec("y1", y1),
            "y2": places.spec("y2", y2),
            "x1": places.spec("x1", x1),
            "x2": places.spec("x2", x2),
            "orient": orient,
            "series": series,
            "stack": _spec(stacking) if isinstance(stacking, Stack) else stack or None,
            "dodge": _flag(dodge, "area dodge") or None,
            "color": color,
            "fill": fill,
            "fillOpacity": fraction_option(fill_opacity, "area fill_opacity"),
            "line": _flag(line, "area line"),
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "area stroke_width"),
            "opacity": fraction_option(opacity, "area opacity"),
            "strokeOpacity": fraction_option(stroke_opacity, "area stroke_opacity"),
            "encode": channels,
            "style": style_spec,
            "continuity": _continuity(continuity, "area"),
            "where": condition_spec(where, "area where"),
            "curve": choice_option(curve, get_args(Curve), "area curve"),
            "label": name_spec(label, "area"),
            "labels": self._series_labels(labels, "area"),
            "legend": _mark_legend(legend, "area"),
            "axis": axis,
            "facet": _mark_facet(facet, "area"),
            "panel": panel,
            "clip": _clip(clip, "area"),
            "tooltip": self._mark_tooltip(
                table,
                tooltip,
                "area",
                ("y" if runs == "x" else "x", values),
                band=along_x or along_y,
            ),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "area selected"),
            "unselected": look_spec(unselected, "area unselected"),
            "partial": look_spec(partial, "area partial"),
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "area"),
            "id": id,
        },
        table,
    )


@_check_method_options
def bar(
    self,  # type: Chart
    x: str | Sequence[str] | RowPosition,
    y: str | Sequence[str] | RowPosition,
    *,
    series: str | Literal[False] | None = None,
    stack: BarStack = False,
    dodge: bool | None = None,
    data: Any = None,
    color: str | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    stroke_opacity: float | None = None,
    dash: Dash | None = None,
    opacity: float | None = None,
    encode: Encodings | Mapping[str, Any] | None = None,
    style: MarkStyle | Mapping[str, Any] | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    labels: bool | BarLabels | Mapping[str, Any] = False,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    tooltip: Tooltip | None = None,
    halo: HaloOption | None = None,
    width: Pixels | Mapping[str, float] | None = None,
    stroke_sides: Sequence[Side] | None = None,
    orient: Orient | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Bars: one band per category of x, or bars centered on number or time x.

    A category ``y`` makes the bars horizontal, with lengths in ``x``;
    ``orient`` says which axis bars stand on whatever the columns are
    (``orient="y"`` stands them on a number or time ``y``, such as ranks).
    Several series (a ``series`` column's values, or several ``y``
    columns) stand side by side at each position, as grouped bars, unless
    ``dodge=False`` overlaps them or ``stack`` piles them. A category
    column as ``color`` is the series column unless ``series`` says
    otherwise (``color="region"`` groups bars by region); with
    ``series=False`` it colors each bar and places nothing apart.
    ``stroke`` and ``stroke_width`` outline each bar; ``stroke_sides``
    draws only the sides it lists as they stand on screen
    (``["top"]`` caps every bar), and such bars have square ends.
    ``width=hg.Pixels(n)`` makes every bar ``n`` pixels thick whatever
    its band, centered in its slot when grouped.
    ``labels=True`` writes each value at its bar's end (inside each segment
    when stacked); ``hg.BarLabels`` formats, styles, and filters them
    (white or black text by contrast with the bar unless its style sets a
    color). ``stack="fill"`` normalizes nonnegative values per position,
    and labels show shares. Tooltip and keyboard text also report the raw
    values.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    _check_stack(stack, "bar")
    if dodge and stack:
        raise ChartError("bar dodge: stacked bars pile up in one slot; drop dodge or stack")
    # A width's pixels at their own path, as the spec's validator says
    # (pixels of a column, or offset, `length_spec` refuses as no length).
    px: Any = (
        (width.value if width.field is None else 0)
        if isinstance(width, Pixels)
        else width.get("px", 0)
        if isinstance(width, Mapping)
        else 0
    )
    if not (_finite(px) and px >= 0):
        raise ChartError(
            f"bar width.px: expected a number of at least 0; received {shown(px)}",
            path=self._path("bar", "width.px"),
        )
    value_labels: BarLabels | None = None
    if labels is not False and labels is not True:
        self._check_label_dict(labels, "bar", "labels", ("content",))
        value_labels = self._option("bar labels", lambda: _built(labels, BarLabels, "bar labels"))
        place = value_labels.place
        # Stacked bars' labels stand at their segment's middle unless attached at an end.
        if (
            stack
            and isinstance(place, LabelPlace)
            and place.offset is not None
            and place.attachment is None
        ):
            raise ChartError(
                f"bar labels place offset: {CENTERED_OFFSET}",
                path=self._path("bar", "labels.place.offset"),
            )
        pattern = value_labels.format
        if isinstance(pattern, Mapping) and not FORMS & set(pattern):
            self._option(
                "bar labels format",
                lambda: _check_format(dict(pattern), "bar labels format", _NUMBER_FORMAT),
            )
    for name, value in (("stroke_opacity", stroke_opacity), ("opacity", opacity)):
        fraction_option(value, f"bar {name}")
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            f"bar stroke_width: expected 0 or more pixels; received {shown(stroke_width)}"
        )
    places = self._places("bar", {"x": x, "y": y}, axis == "right", needed=True)
    x, y = places.columns["x"], places.columns["y"]
    table = self._mark_table(data)
    self._check_places(table, "bar", places)
    channels = encodings_spec(encode, _BAR_CHANNELS, "bar")
    self._check_colors(table, color, channels, "bar")
    split = self._series_of(table, series, color, channels, fill, "fill", "bar")
    if orient not in (None, "x", "y"):
        raise ChartError(f'bar orient: expected "x" or "y"; received {shown(orient)}')
    horizontal = (
        orient == "y"
        if orient is not None
        else isinstance(y, str) and self._kind(table, y) == "category"
    )
    if orient is not None:
        # Bars stand on one axis and measure their lengths along the other, in numbers.
        across = "x" if orient == "y" else "y"
        lengths = x if orient == "y" else y
        for name in [lengths] if isinstance(lengths, str) else lengths:
            if self._kind(table, name) == "category":
                raise ChartError(
                    f'bar orient: "{orient}" makes {across} the lengths, and {name!r} holds '
                    f'categories; give orient="{across}", or a number column as {across}'
                )
    if horizontal:
        if axis == "right":
            raise ChartError('bar axis: horizontal bars have no right axis; drop axis="right"')
        if not isinstance(y, str):
            raise ChartError(
                "bar y: bars along y stand on one column; give one y column, and several x"
            )
        self._require(table, y, ("number", "time", "category"), "bar y")
        xs = self._require_many(table, x, _NUMERIC, "bar x")
        self._single_or_series(xs, split, "bar", inferred=series is None)
        ys: str | list[str] = y
    else:
        if not isinstance(x, str):
            raise ChartError(
                "bar x: several columns need a category y, for horizontal bars; give one x column"
            )
        self._require(table, x, ("number", "time", "category"), "bar x")
        xs = x
        ys = self._require_many(table, y, _NUMERIC, "bar y")
        self._single_or_series(ys, split, "bar", inferred=series is None)
    if stack == "fill":
        _check_stack_values(self._tables[table][1], xs if horizontal else ys, "bar")
    return self._add(
        {
            "type": "bar",
            "halo": _halo(halo, "bar"),
            "x": places.spec("x", xs),
            "y": places.spec("y", ys),
            "series": series,
            "stack": stack or None,
            "dodge": _flag(dodge, "bar dodge"),
            "color": color,
            "fill": fill,
            "fillOpacity": fraction_option(fill_opacity, "bar fill_opacity"),
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "bar stroke_width"),
            "strokeOpacity": stroke_opacity,
            "dash": _dash(dash, "bar"),
            "opacity": opacity,
            "encode": channels,
            "style": mark_style_spec(style, ("by",), "bar"),
            "label": name_spec(label, "bar"),
            "legend": _mark_legend(legend, "bar"),
            "labels": self._option("bar labels", value_labels._spec)
            if value_labels
            else labels or None,
            "axis": axis,
            "facet": _mark_facet(facet, "bar"),
            "panel": panel,
            "clip": _clip(clip, "bar"),
            "tooltip": self._mark_tooltip(
                table, tooltip, "bar", ("x", xs) if horizontal else ("y", ys)
            ),
            "width": self._option("bar width", lambda: length_spec(width, "bar width")),
            "strokeSides": self._option(
                "bar stroke_sides", lambda: _sides(stroke_sides, "bar stroke_sides")
            ),
            "orient": orient,
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "bar selected"),
            "unselected": look_spec(unselected, "bar unselected"),
            "partial": look_spec(partial, "bar partial"),
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "bar"),
            "id": id,
        },
        table,
    )


@_check_method_options
def rug(
    self,  # type: Chart
    x: str | None = None,
    *,
    y: str | None = None,
    series: str | None = None,
    color: str | None = None,
    data: Any = None,
    length: float | None = None,
    side: Literal["bottom", "top", "left", "right"] | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    tooltip: Tooltip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """One tick per observation of exactly one number or time column.

    Ticks reach ``length`` CSS pixels into the plot (default 8), from
    bottom/top for ``x`` or left/right for ``y``. Their edges stay fixed
    during zoom and pan. Missing and nonfinite values are omitted.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    if (x is not None) == (y is not None):
        raise ChartError("rug: needs exactly one of x and y")
    sides = ("bottom", "top") if x is not None else ("left", "right")
    if side is not None and side not in sides:
        along = "x" if x is not None else "y"
        raise ChartError(
            f"rug side: expected {listed(sides)} for a rug along {along}; received {shown(side)}"
        )
    if y is not None and axis == "right":
        raise ChartError('rug axis: a rug along y has no right axis; drop axis="right"')
    if length is not None and not (_finite(length) and length > 0):
        raise ChartError(
            f"rug length: expected a finite, positive number of pixels; received {shown(length)}"
        )
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            "rug stroke_width: expected a finite number of at least 0; "
            f"received {shown(stroke_width)}"
        )
    table = self._mark_table(data)
    self._require(table, x, _NUMERIC, "rug x")
    self._require(table, y, _NUMERIC, "rug y")
    self._require(table, series, ("category",), "rug series")
    self._color_series(table, series, color, "rug")
    return self._add(
        {
            "type": "rug",
            "x": x,
            "y": y,
            "series": series,
            "color": color,
            "length": float(length) if length is not None else None,
            "side": side,
            "stroke": stroke,
            "strokeWidth": float(stroke_width) if stroke_width is not None else None,
            "label": name_spec(label, "rug"),
            "legend": _mark_legend(legend, "rug"),
            "axis": axis,
            "facet": _mark_facet(facet, "rug"),
            "panel": panel,
            "clip": _clip(clip, "rug"),
            "tooltip": self._mark_tooltip(table, tooltip, "rug"),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "rug selected"),
            "unselected": look_spec(unselected, "rug unselected"),
            "partial": look_spec(partial, "rug partial"),
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "rug"),
            "id": id,
        },
        table,
    )


@_check_method_options
def segment(
    self,  # type: Chart
    x: str | tuple[str, str],
    y: str | tuple[str, str],
    *,
    series: str | None = None,
    color: str | None = None,
    data: Any = None,
    width: SegmentWidthOption | SegmentWidth | None = None,
    caps: Caps | Mapping[str, Any] | None = None,
    encode: Encodings | Mapping[str, Any] | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    tooltip: Tooltip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Segments: each row from one place to another.

    ``x`` and ``y`` are each a column, the same at both ends (a category
    column places rows in its bands), or a pair ``(start, end)`` of
    numeric or datetime columns; at least one is a pair. Both ends count
    toward the axes' domains. ``width`` is pixels or a channel giving each
    row's (an ``hg.Channel`` through an ``hg.ChannelScale``, or
    ``hg.when``), or ``hg.SegmentWidth(start=..., end=...)``, tapering
    linearly between the body's ends (an arrowhead's base where an end has
    one); a line's width by default, and rows a channel gives no width are
    not drawn. ``caps=hg.Caps(start=..., end=...)`` draws ``"dot"``,
    ``"arrow"``, ``hg.Dot(radius=...)``, or ``hg.Arrow(length=...,
    width=...)`` at either end: a segment shorter than its arrowhead draws
    the head alone, two heads longer than it together each take half of
    it, and a segment of no length draws its dots and no arrowhead.

    A category ``color`` names the series (as ``series`` does); a CSS
    color paints every segment. ``encode=hg.Encodings(color=...,
    opacity=...)`` gives each row its own color and opacity. Rows are
    items, picked by their shapes; tooltips write their ends as ranges
    ("12 – 40", "(1, 2) – (3, 4)"), with ``tooltip`` fields and parts
    besides. ``item_key`` names the column whose value names each row's
    item, which selections and value animations follow. Meant for
    thousands of segments, not millions. ``start`` and ``end`` are the
    spec's ``from`` and ``to``.
    """
    table = self._mark_table(data)
    pairs: dict[str, tuple[str, str]] = {}
    for axis_name, given in (("x", x), ("y", y)):
        if isinstance(given, str):
            self._require(table, given, (*_NUMERIC, "category"), f"segment {axis_name}")
            continue
        pair = tuple(given) if listlike(given) and not isinstance(given, Mapping) else ()
        if len(pair) != 2:
            raise ChartError(
                f"segment {axis_name}: expected a column's name, or a pair of them "
                f"(start, end); received {shown(given)}",
                path=self._path("segment", axis_name),
            )
        for i, column in enumerate(pair):
            self._require(table, column, _NUMERIC, f"segment {axis_name}[{i}]")
        pairs[axis_name] = (pair[0], pair[1])
    if not pairs:
        raise ChartError(
            "segment x, y: a segment goes from one place to another; give x or y a pair "
            'of columns, x=("start", "end")',
            path=self._path("segment", "x"),
        )
    split = self._color_series(
        table, series, color, "segment", "encode=hg.Encodings(color=hg.Channel(value=...))"
    )
    self._require(table, split, ("category",), "segment series")
    width_spec: Any = None
    if isinstance(width, Mapping) and {"start", "end"} & set(width):
        width = _built(width, SegmentWidth, "segment width")
    if isinstance(width, SegmentWidth):
        width_spec = self._option("segment width", width._spec)
    elif width is not None:
        width_spec = self._option(
            "segment width", lambda: segment_width_spec(width, "segment width")
        )
    built_caps = _built(caps, Caps, "segment caps")
    encoded = self._option(
        "segment encode", lambda: encodings_spec(encode, ("color", "opacity"), "segment")
    )
    self._check_outputs(encoded or {}, "segment", "encode.")
    for where, channel in _entries("encode.opacity", (encoded or {}).get("opacity")):
        if isinstance(channel, dict) and "series" in channel:
            raise ChartError(
                f"segment {python_path(where)}: each row has an opacity of its own; give a "
                "field, a value, or a condition",
                path=self._path("segment", python_path(where)),
            )
    ends = width_spec if isinstance(width_spec, dict) and "from" in width_spec else None
    widths = {f"width.{end}": ends[end] for end in ("from", "to")} if ends else {}
    if not ends and isinstance(width_spec, (dict, list)):
        widths["width"] = width_spec
    # Widths' constants and branches are pixels, as strokeWidth's are; channels' columns exist
    # (their scales say what values they take, as on other marks).
    for at, given in widths.items():
        for where, channel in _entries(at, given):
            self._check_output("strokeWidth", channel, "segment", where)
    read = {**widths, **{f"encode.{name}": value for name, value in (encoded or {}).items()}}
    for at, given in read.items():
        for where, channel in _entries(at, given):
            if isinstance(channel, dict) and isinstance(channel.get("field"), str):
                self._require(table, channel["field"], _ANY, f"segment {python_path(where)}")
    return self._add(
        {
            "type": "segment",
            "x": list(pairs["x"]) if "x" in pairs else x,
            "y": list(pairs["y"]) if "y" in pairs else y,
            "series": split,
            "color": color,
            "label": name_spec(label, "segment"),
            "width": width_spec,
            "caps": (built_caps._spec() or None) if built_caps is not None else None,
            "encode": encoded,
            "legend": _mark_legend(legend, "segment"),
            "axis": axis,
            "facet": _mark_facet(facet, "segment"),
            "panel": panel,
            "clip": _clip(clip, "segment"),
            "tooltip": self._mark_tooltip(table, tooltip, "segment"),
            "zIndex": z_index,
            "pick": pick,
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "segment"),
            "id": id,
        },
        table,
    )


@_check_method_options
def errorbar(
    self,  # type: Chart
    *,
    x: str | RowPosition | None = None,
    y: str | RowPosition | None = None,
    x1: str | RowPosition | None = None,
    x2: str | RowPosition | None = None,
    y1: str | RowPosition | None = None,
    y2: str | RowPosition | None = None,
    x_error: str | None = None,
    y_error: str | None = None,
    series: str | None = None,
    color: str | None = None,
    dodge: bool = False,
    data: Any = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    cap: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    tooltip: Tooltip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Error bars at each ``x``, from ``y1`` to ``y2`` or ``y`` ± ``y_error``; or, at each
    ``y``, from ``x1`` to ``x2`` or ``x`` ± ``x_error``.

    ``cap`` is the width of the end caps in pixels (0 for none). Add points or bars
    to show the center. ``dodge=True`` places the series of a ``series``
    column side by side in each category, as grouped bars are, so each
    interval stands on its bar. Error bars of the series column of the bars
    they stand on share the bars' colors, legend entries, and places.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    vertical = y_error is not None or (y1 is not None and y2 is not None)
    horizontal = x_error is not None or (x1 is not None and x2 is not None)
    if vertical == horizontal:
        raise ChartError(
            "errorbar: needs x with y1 and y2 or with y and y_error (vertical), "
            "or y with x1 and x2 or with x and x_error (horizontal)"
        )
    if horizontal and axis == "right":
        raise ChartError(
            'errorbar axis: horizontal error bars have no right axis; drop axis="right"'
        )
    places = self._places(
        "errorbar", {"x": x, "y": y, "x1": x1, "x2": x2, "y1": y1, "y2": y2}, axis == "right"
    )
    # A symmetric interval's center is a column, as its error is.
    center_at = "x" if horizontal else "y"
    if (x_error if horizontal else y_error) is not None and center_at in places.specs:
        raise ChartError(
            f"errorbar {center_at}: a center with {center_at}_error is a column; "
            "give a column's name",
            code="invalid-option",
            path=self._path("errorbar", center_at),
        )
    x, y = places.column("x"), places.column("y")
    x1, x2 = places.column("x1"), places.column("x2")
    y1, y2 = places.column("y1"), places.column("y2")
    table = self._mark_table(data)
    self._check_places(table, "errorbar", places)
    along, other = ("y", "x") if horizontal else ("x", "y")
    position = y if horizontal else x
    if position is None:
        raise ChartError(f"errorbar {along}: needs the column the bars stand at")
    self._require(table, position, ("number", "time", "category"), f"errorbar {along}")
    error = x_error if horizontal else y_error
    if error is not None:
        center = x if horizontal else y
        if center is None:
            raise ChartError(
                f"errorbar {other}: {other}_error is measured from {other}; give {other}"
            )
        self._require(table, center, _NUMERIC, f"errorbar {other}")
        self._require(table, error, _NUMERIC, f"errorbar {other}_error")
    else:
        self._require(table, x1 if horizontal else y1, _NUMERIC, f"errorbar {other}1")
        self._require(table, x2 if horizontal else y2, _NUMERIC, f"errorbar {other}2")
    # A column of another form would be dropped, so it is refused.
    given = dict(x=x, y=y, x1=x1, x2=x2, y1=y1, y2=y2, x_error=x_error, y_error=y_error)
    used = (
        [along, other, f"{other}_error"] if error is not None else [along, f"{other}1", f"{other}2"]
    )
    extra = next(
        (name for name, column in given.items() if column is not None and name not in used),
        None,
    )
    if extra is not None:
        raise ChartError(
            f"errorbar {extra}: bars from {', '.join(used)} take no {extra}; drop {extra}"
        )
    self._require(table, series, ("category",), "errorbar series")
    split = self._color_series(table, series, color, "errorbar")
    if dodge:
        if split is None:
            raise ChartError("errorbar dodge: places series side by side; give series")
        if self._kind(table, position) != "category":
            raise ChartError(
                f"errorbar dodge: needs a category {along}; "
                f"column {position!r} holds {self._kind(table, position)} values"
            )
    return self._add(
        {
            "type": "errorbar",
            "x": places.spec("x", x),
            "y": places.spec("y", y),
            "x1": places.spec("x1", x1),
            "x2": places.spec("x2", x2),
            "y1": places.spec("y1", y1),
            "y2": places.spec("y2", y2),
            "xError": x_error,
            "yError": y_error,
            "series": series,
            "color": color,
            "dodge": _flag(dodge, "errorbar dodge") or None,
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "errorbar stroke_width"),
            "cap": pixels_option(cap, "errorbar cap"),
            "label": name_spec(label, "errorbar"),
            "legend": _mark_legend(legend, "errorbar"),
            "axis": axis,
            "facet": _mark_facet(facet, "errorbar"),
            "panel": panel,
            "clip": _clip(clip, "errorbar"),
            "tooltip": self._mark_tooltip(table, tooltip, "errorbar"),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "errorbar selected"),
            "unselected": look_spec(unselected, "errorbar unselected"),
            "partial": look_spec(partial, "errorbar partial"),
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "errorbar"),
            "id": id,
        },
        table,
    )


@_check_method_options
def point(
    self,  # type: Chart
    x: str | RowPosition,
    y: str | RowPosition,
    *,
    series: str | Literal[False] | None = None,
    item_key: str | None = None,
    data: Any = None,
    radius: float | None = None,
    size: str | ChannelOption | None = None,
    radius_range: tuple[float, float] | None = None,
    fill: str | None = None,
    fill_opacity: float | str | ChannelOption | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    color: str | ChannelOption | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    symbol: str | ChannelOption | None = None,
    encode: Encodings | Mapping[str, Any] | None = None,
    sampling: Literal["none", "pixel"] | None = None,
    dodge: bool = False,
    jitter: float | Jitter | None = None,
    swarm: bool = False,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    tooltip: Tooltip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
) -> Chart:
    """Scatter points.

    ``x`` and ``y`` are numeric, datetime, or category columns; a category
    column places points in its bands, as for strip and dot plots.
    ``radius`` is the radius in pixels of every point; ``size`` instead
    sizes points by area by a numeric column, within ``radius_range``
    (bubbles). ``fill_opacity`` is a number or a numeric
    column. ``stroke`` and ``stroke_width`` ring each point, in the
    background color by default. ``color`` colors points by a numeric
    column on ``colors``, a scheme name such as ``"viridis"`` or a list of
    hex colors, centered on ``color_midpoint`` for diverging schemes; or
    by a category column, a value of which has one color in every mark
    and panel drawing that column of the data (``scales={"color":
    hg.OrdinalScale(map={...})}`` fixes them), with a key in the legend;
    a category ``color`` names the series too (as ``series`` does),
    unless ``series`` names another column or is ``False``, which colors
    each point by its row; or a CSS color for every point, as a line's
    ``color`` is (``fill`` wins over it). ``symbol`` is a shape
    (``"circle"``, ``"square"``, ``"triangle"``, ...) or a category column
    with a shape per value: its name, or ``{"field": name}``, which a
    column named like a shape needs. ``sampling="pixel"`` draws opaque
    points whose centers share a device pixel once, which is faster for
    dense scatters.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each point, matching points across live replacements when
    ``Animation(values=True)`` is set.

    With a category ``x`` or ``y``, ``dodge=True`` places the series of a
    ``series`` column side by side in each category, as grouped bars are,
    and ``jitter`` (a width from 0 to 1 of the band, or ``hg.Jitter``)
    spreads points across their band, by row and seed; ``swarm=True``
    instead packs them across it without overlap, in order of their
    values (a beeswarm), laid out again as the chart resizes and zooms,
    with points that do not fit at the band's edges.
    """
    problem = _point_size_problem(radius, size, radius_range, encode)
    if problem:
        raise ChartError(problem[1], path=self._path("point", problem[0]))
    places = self._places("point", {"x": x, "y": y}, axis == "right", needed=True)
    x, y = cast("str", places.columns["x"]), cast("str", places.columns["y"])
    # Channels: a column's name or a constant, or a channel (an
    # hg.Channel, its dict, or hg.when) as the spec writes it; a symbol's
    # but a column's alone (hg.Channel(field=...) or {"field": ...}, as
    # points always took). Well formed first, as the engine checks a spec
    # before what it draws.
    forms = {"field", "scale", "value", "series", "condition"}
    if isinstance(symbol, Channel) and symbol.field is not None and symbol.scale is None:
        symbol = {"field": symbol.field}
    channels: dict[str, Any] = {}
    for option, value in (
        ("color", color),
        ("size", size),
        ("fill_opacity", fill_opacity),
        ("symbol", symbol),
    ):
        # A symbol's dict may map values to symbols; others' dicts are
        # channels; a list is channels tried in order.
        given = forms - {"field"} if option == "symbol" else forms
        if (
            isinstance(value, (Channel, Expr, Condition))
            or listlike(value)
            or (isinstance(value, Mapping) and (option != "symbol" or bool(set(value) & given)))
        ):
            self._check_channel_dict(value, "point", _camel(option))
            role = f"point {option}"
            channels[_camel(option)] = self._option(
                role, functools.partial(channel_spec, value, role)
            )
    for option, value, expected in (
        ("color", color, "a column's name, a color, or an hg.Channel"),
        ("size", size, "a column's name or an hg.Channel"),
        (
            "fill_opacity",
            fill_opacity,
            "a number from 0 to 1, a column's name, or an hg.Channel",
        ),
    ):
        constant = option == "fill_opacity" and _finite(value)
        if not (
            value is None
            or constant
            or isinstance(value, (str, Channel, Expr, Condition, Mapping))
            or listlike(value)
        ):
            raise ChartError(
                f"point {option}: expected {expected}; received {shown(value)}",
                path=self._path("point", option),
            )
    if isinstance(encode, Mapping):
        for name, item in encode.items():
            # Keys that are no channel's name are refused as encode is built.
            if isinstance(name, str):
                self._check_channel_dict(item, "point", f"encode.{_camel(name)}")
    encoded = self._option("point encode", lambda: encodings_spec(encode, _POINT_CHANNELS, "point"))
    self._check_outputs(channels, "point", "")
    self._check_outputs(encoded or {}, "point", "encode.")
    table = self._mark_table(data)
    self._check_point_channels(
        table,
        {"color": color, "fill": fill, "opacity": fill_opacity, "symbol": symbol},
        {"stroke": stroke, "strokeWidth": stroke_width},
        channels,
        encoded or {},
        (colors, color_domain, color_midpoint),
    )
    color = channels.get("color", color)
    self._check_places(table, "point", places)
    self._require(table, x, (*_NUMERIC, "category"), "point x")
    self._require(table, y, (*_NUMERIC, "category"), "point y")
    # A category color names the series, as on lines and bars; series=False keeps one.
    split = self._series_of(table, series, color, encoded, fill, "fill", "point")
    _check_size(radius, size if isinstance(size, str) else None, "point")
    if isinstance(size, str):
        self._require(table, size, _NUMERIC, "point size")
    if isinstance(fill_opacity, str):
        self._require(table, fill_opacity, _NUMERIC, "point fill_opacity")
    elif is_number(fill_opacity) and not 0 <= fill_opacity <= 1:
        raise ChartError(
            "point fill_opacity: expected a number from 0 to 1 or a column; "
            f"received {shown(fill_opacity)}"
        )
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            f"point stroke_width: expected 0 or more pixels; received {shown(stroke_width)}"
        )
    if isinstance(color, str):
        self._check_point_color(
            table, color, fill, colors, color_domain, color_midpoint, "point", _NUMERIC
        )
    symbol_spec = channels.get("symbol") or self._symbol(
        table, cast("str | Mapping[str, str] | None", symbol)
    )
    spread = Jitter(width=jitter) if is_number(jitter) and not isinstance(jitter, bool) else jitter
    if spread is not None and not isinstance(spread, Jitter):
        raise ChartError(
            f"point jitter: expected a width from 0 to 1 or an hg.Jitter; received {shown(jitter)}"
        )
    if not isinstance(swarm, bool):
        raise ChartError(f"point swarm: expected True or False; received {shown(swarm)}")
    if swarm and spread is not None:
        raise ChartError("point swarm: places points itself; drop jitter or swarm")
    if swarm and sampling == "pixel":
        raise ChartError('point sampling: a swarm places every point; drop sampling="pixel"')
    if dodge or spread is not None or swarm:
        option = "dodge" if dodge else "jitter" if spread is not None else "swarm"
        if (self._kind(table, x) == "category") == (self._kind(table, y) == "category"):
            raise ChartError(f"point {option}: needs exactly one category column, x or y")
        if dodge and split is None:
            raise ChartError("point dodge: places series side by side; give series")
    return self._add(
        {
            "type": "point",
            "x": places.spec("x", x),
            "y": places.spec("y", y),
            "series": series,
            "radius": radius,
            "size": channels.get("size", size),
            "radiusRange": _range(radius_range, "point radius_range", minimum=0),
            "fill": fill,
            "fillOpacity": channels.get("fillOpacity", fill_opacity),
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "point stroke_width"),
            "color": color,
            "colors": _colors(colors, "point colors"),
            "colorDomain": _range(color_domain, "point color_domain"),
            "colorMidpoint": _midpoint(color_midpoint, color_domain, "point"),
            "symbol": symbol_spec,
            "encode": encoded,
            "sampling": choice_option(sampling, ("none", "pixel"), "point sampling"),
            "dodge": _flag(dodge, "point dodge") or None,
            "jitter": self._option("point jitter", spread._spec) if spread is not None else None,
            "swarm": swarm or None,
            "label": name_spec(label, "point"),
            "legend": _mark_legend(legend, "point"),
            "axis": axis,
            "facet": _mark_facet(facet, "point"),
            "panel": panel,
            "clip": _clip(clip, "point"),
            "tooltip": self._mark_tooltip(table, tooltip, "point", ("y", y)),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "point selected"),
            "unselected": look_spec(unselected, "point unselected"),
            "partial": look_spec(partial, "point partial"),
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "point"),
            "id": id,
        },
        table,
    )


@_check_method_options
def candlestick(
    self,  # type: Chart
    x: str,
    open: str,
    high: str,
    low: str,
    close: str,
    *,
    data: Any = None,
    variant: Literal["candlestick", "ohlc"] | None = None,
    rise: str | None = None,
    fall: str | None = None,
    label: str | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    tooltip: Tooltip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Open-high-low-close candles at each ``x``, as for prices.

    Candles closing at or above their open are hollow in the ``rise``
    color, others filled in ``fall``; both default to the theme's.
    ``variant="ohlc"`` draws bars instead: a line from low to high with
    the open ticked to its left and the close to its right.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    if variant not in (None, "candlestick", "ohlc"):
        raise ChartError(
            f'candlestick variant: expected "candlestick" or "ohlc"; received {shown(variant)}'
        )
    table = self._mark_table(data)
    self._require(table, x, ("number", "time", "category"), "candlestick x")
    for role, field in (("open", open), ("high", high), ("low", low), ("close", close)):
        self._require(table, field, _NUMERIC, f"candlestick {role}")
    return self._add(
        {
            "type": "candlestick",
            "x": x,
            "open": open,
            "high": high,
            "low": low,
            "close": close,
            "variant": variant,
            "rise": rise,
            "fall": fall,
            "label": label,
            "legend": _mark_legend(legend, "candlestick"),
            "axis": axis,
            "facet": _mark_facet(facet, "candlestick"),
            "panel": panel,
            "clip": _clip(clip, "candlestick"),
            "tooltip": self._mark_tooltip(table, tooltip, "candlestick"),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "candlestick selected"),
            "unselected": look_spec(unselected, "candlestick unselected"),
            "partial": look_spec(partial, "candlestick partial"),
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "candlestick"),
            "id": id,
        },
        table,
    )


def _single_or_series(
    self,  # type: Chart
    fields: str | list[str],
    series: str | None,
    role: str,
    inferred: bool = False,
) -> None:
    if series is not None and not isinstance(fields, str):
        raise ChartError(
            f"{role} color: several value columns, and series by {series!r} from color; give "
            "one value column per mark, or series=False"
            if inferred
            else f"{role} series: several value columns or a series column, not both; drop one",
            code="series-with-values",
            path=self._path(role, "color" if inferred else "series"),
        )


def _series_labels(
    self,  # type: Chart
    labels: Any,
    mark: str,
) -> Any:
    """A line's or area's ``labels`` as the spec takes them, refused at
    their own paths: an area's band labels follow one ``edge``; a
    line's follow the line."""
    if labels is None:
        return None
    edge = labels.get("edge") if isinstance(labels, Mapping) else getattr(labels, "edge", None)
    if mark == "line" and edge is not None:
        raise ChartError(
            "line labels.edge: a line's labels follow the line; drop edge",
            path=self._path("line", "labels.edge"),
        )
    self._check_label_dict(labels, mark, "labels", ("at", "edge", "content"))
    return self._option(
        f"{mark} labels", lambda: built_spec(labels, SeriesLabels, f"{mark} labels")
    )


def _check_series_style(
    self,  # type: Chart
    table: int,
    series: str | None,
    style: Mapping[str, Any] | None,
    mark: str,
    position: Any = None,
) -> None:
    """Refuses a line or area whose style map's column changes within one
    of its series, where the data is here to check: a style map gives
    each series one look (the engine checks again as the data changes;
    looks that change along a series are channels in ``encode``). Rows
    without a category ``position`` are drawn in no series, as the engine
    leaves them out."""
    field = ((style or {}).get("by") or {}).get("field")
    if field is None or field == series or self._kind(table, field) != "category":
        return
    source = self._tables[table][1]
    try:
        values = source.column(field).values
        groups = (
            source.column(series).values if series is not None else np.zeros(len(values), np.int32)
        )
    except (KeyError, TypeError, ValueError, AttributeError):
        # A derived table's rows are made in the browser, which checks them.
        return
    known = (values >= 0) & (groups >= 0)
    if isinstance(position, str) and self._kind(table, position) == "category":
        known &= source.column(position).values >= 0
    pairs = np.unique(np.stack([groups[known], values[known]]), axis=1)
    repeated = np.flatnonzero(pairs[0][1:] == pairs[0][:-1])
    if repeated.size == 0:
        return
    if series is None:
        within, fix = f"the {mark}", "a series column"
    else:
        name = source.column(series).dictionary[int(pairs[0][repeated[0]])]
        within, fix = f"series {name!r} (by {series!r})", "another column"
    raise ChartError(
        f"{mark} style.by.field: column {field!r} changes within {within}; a style map "
        f"gives each series one look, so split them by {fix}, or give the looks in "
        "encode, where they change along a series",
        code="series-varies",
        path=self._path(mark, "style.by.field"),
    )


def _oriented(
    self,  # type: Chart
    table: int,
    mark: str,
    x: str | Sequence[str],
    y: str | Sequence[str],
    orient: Orient | None,
) -> tuple[Orient, str | list[str], str | list[str]]:
    """Which axis a line or area runs along (``orient``, or y for a
    category y with values on x, as bars lie along a category y), and its
    x and y as the spec writes them, checked: positions are one number,
    time, or category column; values one or several number columns."""
    if orient not in (None, "x", "y"):
        raise ChartError(f'{mark} orient: expected "x" or "y"; received {shown(orient)}')

    def kind(field: str | Sequence[str]) -> str | None:
        return self._kind(table, field) if isinstance(field, str) else None

    along: Orient = orient or ("y" if kind(y) == "category" and kind(x) != "category" else "x")
    position, values = (x, y) if along == "x" else (y, x)
    if not isinstance(position, str):
        if along == "x":
            raise ChartError(
                f"{mark} x: several columns are values along x of a {mark} along y; "
                'give orient="y", or one x column'
            )
        raise ChartError(
            f"{mark} y: a {mark} along y has one y column of positions; "
            'give one y column, or orient="x"'
        )
    if orient == "x" and kind(values) == "category":
        raise ChartError(
            f'{mark} orient: "x" makes y the values, and {values!r} holds categories; '
            'give orient="y", or a number column as y'
        )
    across = "y" if along == "x" else "x"
    self._require(table, position, (*_NUMERIC, "category"), f"{mark} {along}")
    spec_values = self._require_many(table, values, _NUMERIC, f"{mark} {across}")
    return (along, position, spec_values) if along == "x" else (along, spec_values, position)


def _check_dodge(
    self,  # type: Chart
    table: int,
    mark: str,
    dodge: bool,
    along: Orient,
    position: Any,
    series: str | None,
) -> None:
    """Dodged lines and areas need a category position and a series column."""
    if not isinstance(dodge, bool):
        raise ChartError(f"{mark} dodge: expected True or False; received {shown(dodge)}")
    if not dodge:
        return
    if self._kind(table, position) != "category":
        raise ChartError(
            f"{mark} dodge: places series side by side in the bands of a category {along}; "
            f"give a category column as {along}, or drop dodge"
        )
    if series is None:
        raise ChartError(f"{mark} dodge: places series side by side; give series")


def _require_many(
    self,  # type: Chart
    table: int,
    fields: str | Sequence[str],
    kinds: tuple[str, ...],
    role: str,
):
    if not (isinstance(fields, str) or listlike(fields)):
        raise ChartError(
            f"{role}: expected a column's name or a list of them; received {shown(fields)}",
            path=self._path(role),
        )
    if isinstance(fields, str):
        self._require(table, fields, kinds, role)
        return fields
    names = list(fields)
    for i, name in enumerate(names):
        self._require(table, name, kinds, f"{role}[{i}]", optional=False)
    return names[0] if len(names) == 1 else names


def _symbol(
    self,  # type: Chart
    table: int,
    symbol: str | Mapping[str, str] | None,
) -> Any:
    """A point's ``symbol`` as the spec writes it: a shape's name, or
    ``{"field": column}`` for a category column."""
    if isinstance(symbol, Mapping):
        if set(symbol) != {"field"} or not isinstance(symbol["field"], str):
            raise ChartError(
                'point symbol: expected a shape\'s name or {"field": column}; '
                f"received {shown(dict(symbol))}"
            )
        self._require(table, symbol["field"], ("category",), "point symbol")
        return {"field": symbol["field"]}
    if symbol is None:
        return None
    if symbol in SYMBOLS:
        if self._kind(table, symbol) is not None:
            raise ChartError(
                f"point symbol: {shown(symbol)} names both a shape and a column; "
                f'give {{"field": {shown(symbol)}}} to encode the column'
            )
        return symbol
    if self._kind(table, symbol) is None:
        raise ChartError(
            f"point symbol: expected a column or {listed(SYMBOLS)}; received {shown(symbol)}"
        )
    self._require(table, symbol, ("category",), "point symbol")
    return {"field": symbol}


def _check_point_channels(
    self,  # type: Chart
    table: int,
    flat: Mapping[str, Any],
    outline: Mapping[str, Any],
    channels: Mapping[str, Any],
    encoded: Mapping[str, Any],
    ramp: tuple[Any, Any, Any],
) -> None:
    """Refuses a point's channels as the engine does (marks/point.ts, and
    its feature compiler's points.ts): one set as an option and in
    ``encode``; an outline varying point by point; columns that are not
    there, or categories sized or made translucent without a scale
    mapping them; and a ramp's options without a number column to color."""
    options = {"opacity": "fill_opacity", "strokeWidth": "stroke_width"}
    for name, value in {**flat, **outline}.items():
        if value is not None and name in encoded:
            at = python_path(f"encode.{name}")
            raise ChartError(
                f"point {at}: set as {options.get(name, name)} and as {at}; give one",
                path=self._path("point", at),
            )
    for name in outline:
        if name in encoded and "value" not in encoded[name]:
            at = python_path(f"encode.{name}")
            raise ChartError(
                f"point {at}: points of a mark draw one outline; give "
                f"hg.Channel(value=...), or {python_path(name)}",
                code="unsupported",
                path=self._path("point", at),
            )
    given = [
        (at, name, entry)
        for name, channel in encoded.items()
        for at, entry in _entries(f"encode.{name}", channel)
    ] + [
        (at, "opacity" if name == "fillOpacity" else name, entry)
        for name, channel in channels.items()
        for at, entry in _entries(name, channel)
    ]
    for at, name, channel in given:
        if isinstance(channel, Mapping) and isinstance(
            (channel.get("condition") or {}).get("when"), dict
        ):
            self._check_channel_field(table, channel, "point", at)
        field = channel.get("field") if isinstance(channel, Mapping) else None
        if field is None:
            continue
        self._require(table, field, (*_NUMERIC, "category"), f"point {python_path(at)}.field")
        if (
            name in ("size", "opacity")
            and channel.get("scale") is None
            and self._kind(table, field) == "category"
        ):
            what = "sizes" if name == "size" else "opacities"
            raise ChartError(
                f"point {python_path(at)}.field: column {field!r} holds categories, which "
                f"{what} read through a scale mapping them; give scale, the name of one "
                "of the chart's scales",
                path=self._path("point", python_path(f"{at}.field")),
            )
    color = encoded.get("fill") or encoded.get("color") or channels.get("color")
    if color is not None and any(option is not None for option in ramp):
        # A list's colors are its entries'; a ramp colors a number column alone.
        field = color.get("field") if isinstance(color, Mapping) else None
        if not (
            field is not None
            and color.get("scale") is None
            and self._kind(table, field) in _NUMERIC
        ):
            self._refuse_ramp("point", "a ramp colors a number column", *ramp)


def _markers(value: Any) -> Any:
    """Lines' markers: True, False, or a shape name."""
    if value is None or isinstance(value, bool):
        return value
    if value not in SYMBOLS:
        raise ChartError(
            f"line markers: expected True, False, or a shape ({listed(SYMBOLS)}); "
            f"received {shown(value)}"
        )
    return value


def _continuity(value: Any, mark: str) -> Any:
    if value is None:
        return None
    return built_spec(value, Continuity, f"{mark} continuity")


def _check_stack(stack: AreaStack, mark: str) -> None:
    choices = ("fill", "center", "wiggle") if mark == "area" else ("fill",)
    if not isinstance(stack, bool) and stack not in choices:
        correction = (
            'choose True, False, "fill", "center", or "wiggle"'
            if mark == "area"
            else 'choose True, False, or "fill"; use an area for "center" or "wiggle"'
        )
        raise ChartError(f"{mark} stack: unsupported stack {shown(stack)}; {correction}")


def _check_stack_values(table: _Columns, fields: str | Sequence[str], mark: str) -> None:
    for field in [fields] if isinstance(fields, str) else fields:
        values = table.column(field).values
        if np.any(np.isfinite(values) & (values < 0)):
            raise ChartError(
                f"{mark} stack: column {field!r} has negative values, which have no "
                "nonnegative share or stream thickness; use stack=True for signed values"
            )


def _left_along_y(mark: str, along: Orient, axis: str | None) -> None:
    """Lines and areas along y use the left axis, as horizontal bars do."""
    if along == "y" and axis == "right":
        raise ChartError(
            f"{mark} axis: {mark}s along y use the left axis, as horizontal bars do; "
            'drop axis="right"'
        )


def _point_size_problem(
    radius: Any, size: Any, radius_range: Any, encode: Any
) -> tuple[str, str] | None:
    """Why a point's size is in no single form, and the option to blame, as
    the engine's validator checks before what it draws: a size channel
    (``size`` other than a column's name, or ``encode``'s) gives points'
    areas on its own scale, a radius one size for all."""
    if isinstance(encode, Encodings):
        encoded = encode.size is not None
    else:
        encoded = isinstance(encode, Mapping) and encode.get("size") is not None
    if (encoded or not isinstance(size, (str, type(None)))) and radius_range is not None:
        return "radius_range", (
            "point radius_range: a size channel's scale gives its areas; drop radius_range"
        )
    if encoded and (radius is not None or size is not None):
        given = "a constant radius" if radius is not None else "size"
        return "encode.size", f"point encode.size: a size channel, and {given} too; drop one"
    if radius is not None and size is not None:
        return "radius", "point radius: a constant radius or a size column, not both; drop one"
    return None
