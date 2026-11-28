"""One-call helpers (``hg.line``, ``hg.bar``, ...): one call, one chart."""

from __future__ import annotations

import functools
import re
import sys
from collections.abc import Callable, Mapping, Sequence
from typing import Any, Literal, ParamSpec, TypeVar, cast

import numpy as np

from ._chart import Chart, HelperOptions, RadarOptions, SegmentOptions
from ._derive import BinSpec, Expr
from ._encoding import (
    BarLabels,
    Caps,
    ChannelOption,
    Continuity,
    Encodings,
    LabelPart,
    MarkStyle,
    Measure,
    RowPosition,
    SegmentWidth,
    SegmentWidthOption,
    SeriesLabels,
    SunburstLabels,
    SymbolName,
    TreemapLabels,
)
from ._errors import ChartError, Role, UnknownOption, refusing
from ._guides import Format
from ._marks.common import Clip, Dash, _own_options, _unknown_option
from ._marks.distributions import BinsByAxis, HistogramElement, HistogramNormalize
from ._marks.matrices import CellReduce, HeatmapSampling
from ._marks.networks import GraphLayout
from ._marks.series import AreaStack, BarStack, Curve, Jitter, Orient
from ._marks.tooltips import Tooltip
from ._style import HaloOption, Look, Side

# Annotations read at runtime (typing.get_type_hints) need Unpack too.
if sys.version_info >= (3, 11):
    from typing import Unpack
else:
    from typing_extensions import Unpack

_P = ParamSpec("_P")
_R = TypeVar("_R")


#: Helpers whose mark's points or items are rows of the data, which tooltip fields read.
_ROW_HELPERS = frozenset(
    ("line", "area", "bar", "scatter", "scatter_3d", "line_3d", "heatmap", "segment")
    + ("choropleth", "scatter_geo", "candlestick", "surface", "radar", "gauge")
    + ("pie", "funnel", "treemap", "sunburst", "sankey")
)


def helper(function: Callable[_P, _R]) -> Callable[_P, _R]:
    """Makes a one-call helper (``hg.line``, ``hx.barplot``, ...) refuse
    keyword arguments it does not take by its own name, suggesting those it
    does: otherwise Python's error would name ``Chart.__init__``, which the
    helper passes its chart options to."""
    express = function.__module__.startswith("herceg.express")
    rows = not express and function.__name__ in _ROW_HELPERS

    # Read at the helper's first call, as a mark method's options are (see
    # `_check_method_options`).
    @functools.cache
    def options() -> set[str]:
        return _own_options(function) | HelperOptions.__optional_keys__

    @functools.wraps(function)
    def checked(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        known = options()
        for name in kwargs:
            if name not in known:
                raise UnknownOption(_unknown_option(function, name, known))
        tooltip = kwargs.get("tooltip")
        with refusing((function.__name__,), known):
            if not rows and isinstance(tooltip, Tooltip) and tooltip.fields is not None:
                raise (
                    Role(function.__name__)
                    .field("tooltip")
                    .field("fields")
                    .error(
                        "express charts draw tables they compute, without the data's other "
                        "columns; draw the chart with hg.Chart and give fields to its marks"
                        if express
                        else "its points summarize rows, so they have no row's fields to show; "
                        "drop fields"
                    )
                )
            # Parts written from a row, and totals of rows; a heading of False is the
            # chart's, which they keep.
            for name in ("content", "heading", "total"):
                parts = getattr(tooltip, name, None) if isinstance(tooltip, Tooltip) else None
                if rows or parts is None or parts is False:
                    continue
                raise (
                    Role(function.__name__)
                    .field("tooltip")
                    .field(name)
                    .error(
                        "express charts write their own statistics in their tooltips; draw the "
                        f"chart with hg.Chart and give {name} to its marks"
                        if express
                        else "its points summarize rows, and its tooltips write each summary as "
                        f"it is; drop {name}"
                    )
                )
            try:
                return function(*args, **kwargs)
            except ChartError as error:
                raise _helper_axis(error, function.__name__) from None

    return checked


def _helper_axis(error: ChartError, name: str) -> ChartError:
    """A refusal of a helper's chart's ``x``, ``y``, or ``z`` (see
    `_chart_of`) as the helper ``name`` takes it, as ``x_axis``."""
    path = error.path or ""
    axis = re.split(r"[.\[]", path, maxsplit=1)[0]
    if axis not in ("x", "y", "z"):
        return error
    message = str(error)
    if re.match(rf"Chart {axis}[ :]", message):
        message = f"{name} {axis}_axis{message[len(f'Chart {axis}') :]}"
    refused = ChartError(
        message,
        code=error.code,
        path=f"{axis}_axis{path[len(axis) :]}",
        mark=error.mark,
        panel=error.panel,
        phase=error.phase,
    )
    return refused


def _rows_chart_of(data: Any, options: RadarOptions) -> tuple[Chart, Tooltip | None]:
    """The chart of a helper whose mark's points are rows, and the mark's
    tooltip: the ``fields``, ``content``, heading parts, and ``total`` of
    the helper's ``tooltip``, which are the mark's; ``heading=False`` is the
    chart's."""
    tooltip = options.get("tooltip")
    if not isinstance(tooltip, Tooltip):
        return _chart_of(data, options), None
    parts = None if tooltip.heading is False else tooltip.heading
    if (
        tooltip.fields is None
        and tooltip.content is None
        and parts is None
        and tooltip.total is None
    ):
        return _chart_of(data, options), None
    # The chart keeps the rest, or its default tooltip without any.
    heading: Literal[False] | None = False if tooltip.heading is False else None
    shared = (
        Tooltip(axis_labels=tooltip.axis_labels, pin=tooltip.pin, heading=heading)
        if tooltip.axis_labels or tooltip.pin is not None or heading is False
        else None
    )
    chart = _chart_of(data, {**options, "tooltip": shared})
    return chart, Tooltip(
        fields=tooltip.fields, content=tooltip.content, heading=parts, total=tooltip.total
    )


def _chart_of(data: Any, options: RadarOptions) -> Chart:
    """A helper's chart: its ``x_axis``, ``y_axis``, and ``z_axis`` are the chart's
    ``x``, ``y``, and ``z``."""
    settings: dict[str, Any] = dict(options)
    for axis in ("x", "y", "z"):
        if f"{axis}_axis" in settings:
            settings[axis] = settings.pop(f"{axis}_axis")
    return Chart(data, **settings)


@helper
def line(
    data: Any,
    x: str | Sequence[str] | RowPosition,
    y: str | Sequence[str] | RowPosition,
    *,
    orient: Orient | None = None,
    series: str | Literal[False] | None = None,
    dodge: bool = False,
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
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A line chart, along x, or along y with ``orient="y"`` (see ``Chart.line``).
    Remaining keyword arguments are chart options (``HelperOptions``)."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.line(
        x,
        y,
        orient=orient,
        series=series,
        dodge=dodge,
        color=color,
        stroke=stroke,
        stroke_width=stroke_width,
        dash=dash,
        opacity=opacity,
        stroke_opacity=stroke_opacity,
        encode=encode,
        style=style,
        markers=markers,
        continuity=continuity,
        where=where,
        curve=curve,
        label=label,
        labels=labels,
        axis=axis,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        tooltip=tooltip,
        item_key=item_key,
        id=id,
    )


@helper
def area(
    data: Any,
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
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """An area chart, stacked with ``True``, ``"fill"``, ``"center"``,
    ``"wiggle"``, or an ``hg.Stack``, or the band between ``y1`` and ``y2``
    (along y, ``x1`` and ``x2``; see ``Chart.area``).

    Stacked by a ``series`` column, every series is drawn on every position
    any of them has: ``hg.Stack(gaps=...)`` says what a series counts as
    where it has no row, ``"zero"`` (the default) or ``"interpolate"``.
    """
    chart, tooltip = _rows_chart_of(data, options)
    return chart.area(
        x,
        y,
        y1=y1,
        y2=y2,
        x1=x1,
        x2=x2,
        orient=orient,
        series=series,
        stack=stack,
        dodge=dodge,
        color=color,
        fill=fill,
        fill_opacity=fill_opacity,
        line=line,
        stroke=stroke,
        stroke_width=stroke_width,
        opacity=opacity,
        stroke_opacity=stroke_opacity,
        encode=encode,
        style=style,
        continuity=continuity,
        where=where,
        curve=curve,
        label=label,
        labels=labels,
        axis=axis,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        tooltip=tooltip,
        item_key=item_key,
        id=id,
    )


@helper
def bar(
    data: Any,
    x: str | Sequence[str] | RowPosition,
    y: str | Sequence[str] | RowPosition,
    *,
    series: str | Literal[False] | None = None,
    stack: BarStack = False,
    dodge: bool | None = None,
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
    labels: bool | BarLabels | Mapping[str, Any] = False,
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    halo: HaloOption | None = None,
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
    **options: Unpack[HelperOptions],
) -> Chart:
    """A bar chart: series side by side (overlapping with ``dodge=False``) or
    stacked; horizontal when ``y`` is a category, or with ``orient="y"``
    (see ``Chart.bar``)."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.bar(
        x,
        y,
        series=series,
        stack=stack,
        dodge=dodge,
        color=color,
        fill=fill,
        fill_opacity=fill_opacity,
        stroke=stroke,
        stroke_width=stroke_width,
        stroke_opacity=stroke_opacity,
        dash=dash,
        opacity=opacity,
        encode=encode,
        style=style,
        label=label,
        labels=labels,
        axis=axis,
        panel=panel,
        clip=clip,
        tooltip=tooltip,
        halo=halo,
        stroke_sides=stroke_sides,
        orient=orient,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        item_key=item_key,
        id=id,
    )


@helper
def scatter(
    data: Any,
    x: str | RowPosition,
    y: str | RowPosition,
    *,
    series: str | Literal[False] | None = None,
    item_key: str | None = None,
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
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A scatter plot; ``size``, ``color``, and ``symbol`` can encode columns
    (see ``Chart.point``)."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.point(
        x,
        y,
        series=series,
        item_key=item_key,
        radius=radius,
        size=size,
        radius_range=radius_range,
        fill=fill,
        fill_opacity=fill_opacity,
        stroke=stroke,
        stroke_width=stroke_width,
        color=color,
        colors=colors,
        color_domain=color_domain,
        color_midpoint=color_midpoint,
        symbol=symbol,
        encode=encode,
        sampling=sampling,
        dodge=dodge,
        jitter=jitter,
        swarm=swarm,
        label=label,
        axis=axis,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        tooltip=tooltip,
        id=id,
    )


@helper
def scatter_3d(
    data: Any,
    x: str,
    y: str,
    z: str,
    *,
    series: str | Literal[False] | None = None,
    label_field: str | None = None,
    radius: float | None = None,
    color: str | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    label: str | None = None,
    panel: str | None = None,
    item_key: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A 3D scatter plot (see ``Chart.point_3d``). Remaining keyword arguments
    are chart options (``HelperOptions``), such as ``camera``; ``z_axis`` is
    the chart's ``z``."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.point_3d(
        x,
        y,
        z,
        series=series,
        label_field=label_field,
        radius=radius,
        color=color,
        colors=colors,
        color_domain=color_domain,
        color_midpoint=color_midpoint,
        fill=fill,
        fill_opacity=fill_opacity,
        label=label,
        tooltip=tooltip,
        panel=panel,
        item_key=item_key,
        id=id,
    )


@helper
def line_3d(
    data: Any,
    x: str,
    y: str,
    z: str,
    *,
    series: str | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    label: str | None = None,
    panel: str | None = None,
    item_key: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """Lines in 3D (see ``Chart.line_3d``): each ``series`` category's rows, in
    order, are one path. Remaining keyword arguments are chart options
    (``HelperOptions``), such as ``camera``; ``z_axis`` is the chart's ``z``::

        hg.line_3d(df, x="east", y="north", z="altitude", series="flight")
    """
    chart, tooltip = _rows_chart_of(data, options)
    return chart.line_3d(
        x,
        y,
        z,
        series=series,
        stroke=stroke,
        stroke_width=stroke_width,
        label=label,
        tooltip=tooltip,
        panel=panel,
        item_key=item_key,
        id=id,
    )


@helper
def surface(
    data: Any = None,
    x: Any = None,
    y: Any = None,
    z: Any = None,
    *,
    color: str | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    fill_opacity: float | None = None,
    shading: bool | None = None,
    wireframe: bool | None = None,
    label: str | None = None,
    panel: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A 3D surface from a grid of rows or a matrix (see ``Chart.surface``).
    Remaining keyword arguments are chart options (``HelperOptions``);
    ``z_axis`` is the chart's ``z``::

        hg.surface(df, x="east", y="north", z="height")
        hg.surface(z=heights, x=eastings, y=northings)
    """
    chart, tooltip = _rows_chart_of(data, options)
    return chart.surface(
        x,
        y,
        z,
        color=color,
        colors=colors,
        color_domain=color_domain,
        color_midpoint=color_midpoint,
        fill_opacity=fill_opacity,
        shading=shading,
        wireframe=wireframe,
        label=label,
        tooltip=tooltip,
        panel=panel,
        id=id,
    )


@helper
def heatmap(
    data: Any = None,
    x: Any = None,
    y: Any = None,
    color: Any = None,
    *,
    x1: str | None = None,
    x2: str | None = None,
    y1: str | None = None,
    y2: str | None = None,
    date: str | None = None,
    calendar: Literal["weeks", "months"] | None = None,
    week_start: Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"] | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    reduce: CellReduce | None = None,
    sampling: HeatmapSampling | None = None,
    x_step: float | None = None,
    y_step: float | None = None,
    x_banded: bool = False,
    y_banded: bool = False,
    label: str | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A heatmap of columns of ``data``, or with a 2D array ``color``, of the matrix (see
    ``Chart.heatmap``); ``colors`` is a scheme name or a list of hex colors."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.heatmap(
        x,
        y,
        color,
        date=date,
        calendar=calendar,
        week_start=week_start,
        colors=colors,
        color_domain=color_domain,
        color_midpoint=color_midpoint,
        reduce=reduce,
        sampling=sampling,
        x1=x1,
        x2=x2,
        y1=y1,
        y2=y2,
        x_step=x_step,
        y_step=y_step,
        x_banded=x_banded,
        y_banded=y_banded,
        label=label,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        tooltip=tooltip,
        id=id,
    )


@helper
def contour(
    data: Any = None,
    x: Any = None,
    y: Any = None,
    color: Any = None,
    *,
    thresholds: int | Sequence[float] | np.ndarray[Any, Any] | None = None,
    variant: Literal["lines", "bands"] | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    fill_opacity: float | None = None,
    label: str | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    inspect: bool | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """Contours of a field on a grid (see ``Chart.contour``): of columns of
    ``data``, or with a 2D array ``color``, of the matrix, at ``x`` and ``y``."""
    return _chart_of(data, options).contour(
        x,
        y,
        color,
        thresholds=thresholds,
        variant=variant,
        colors=colors,
        color_domain=color_domain,
        color_midpoint=color_midpoint,
        stroke=stroke,
        stroke_width=stroke_width,
        fill_opacity=fill_opacity,
        label=label,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        inspect=inspect,
        id=id,
    )


@helper
def histogram(
    data: Any,
    x: str | None = None,
    *,
    y: str | None = None,
    bins: BinSpec | BinsByAxis | None = None,
    series: str | None = None,
    color: str | None = None,
    weight: str | None = None,
    normalize: HistogramNormalize | None = None,
    common_norm: bool = False,
    cumulative: bool = False,
    dodge: bool = False,
    stack: bool | Literal["fill"] = False,
    element: HistogramElement | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A histogram of ``x`` or ``y``, or with both a 2D histogram's cells (see
    ``Chart.histogram``)."""
    return _chart_of(data, options).histogram(
        x,
        y=y,
        bins=bins,
        series=series,
        color=color,
        weight=weight,
        normalize=normalize,
        common_norm=common_norm,
        cumulative=cumulative,
        dodge=dodge,
        stack=stack,
        element=element,
        fill=fill,
        fill_opacity=fill_opacity,
        colors=colors,
        color_domain=color_domain,
        color_midpoint=color_midpoint,
        label=label,
        axis=axis,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        id=id,
    )


@helper
def pie(
    data: Any,
    category: str,
    value: str | None = None,
    *,
    inner_radius: float | None = None,
    sort: Literal["value", "input"] | None = None,
    labels: bool | None = None,
    panel: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A pie, or with ``inner_radius`` a donut, of ``value`` per ``category``."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.pie(
        category,
        value,
        inner_radius=inner_radius,
        sort=sort,
        labels=labels,
        tooltip=tooltip,
        panel=panel,
        id=id,
    )


@helper
def gauge(
    data: Any,
    value: str,
    *,
    min: float | None = None,
    max: float | None = None,
    bands: Sequence[float | tuple[float, str]] | None = None,
    label: str | None = None,
    format: Format | dict[str, Any] | None = None,
    panel: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A gauge of the last finite value of ``value``, on a dial from ``min`` to ``max``."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.gauge(
        value,
        min=min,
        max=max,
        bands=bands,
        label=label,
        format=format,
        tooltip=tooltip,
        panel=panel,
        id=id,
    )


@helper
def funnel(
    data: Any,
    category: str,
    value: str | None = None,
    *,
    sort: Literal["input", "value"] | None = None,
    labels: bool | None = None,
    panel: str | None = None,
    halo: HaloOption | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A funnel of ``value`` (or row counts) per stage of ``category``, top to bottom."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.funnel(
        category,
        value,
        sort=sort,
        labels=labels,
        tooltip=tooltip,
        panel=panel,
        halo=halo,
        id=id,
    )


@helper
def boxplot(
    data: Any,
    x: str | None = None,
    y: str | None = None,
    *,
    low: str | None = None,
    q1: str | None = None,
    median: str | None = None,
    q3: str | None = None,
    high: str | None = None,
    count: str | None = None,
    whiskers: Literal["tukey", "range"] | float | None = None,
    notch: bool | None = None,
    outliers: bool | None = None,
    series: str | None = None,
    color: str | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """Box plots of ``y`` per category of ``x``, or of ``x`` per category of ``y``."""
    return _chart_of(data, options).boxplot(
        x,
        y,
        low=low,
        q1=q1,
        median=median,
        q3=q3,
        high=high,
        count=count,
        whiskers=whiskers,
        notch=notch,
        outliers=outliers,
        series=series,
        color=color,
        fill=fill,
        fill_opacity=fill_opacity,
        label=label,
        axis=axis,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        id=id,
    )


@helper
def boxen(
    data: Any,
    x: str,
    y: str,
    *,
    series: str | None = None,
    color: str | None = None,
    depth: Literal["tukey", "proportion", "trustworthy", "full"] | int | None = None,
    outlier_proportion: float | None = None,
    trust_alpha: float | None = None,
    width_method: Literal["exponential", "linear", "area"] | None = None,
    outliers: bool | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """Letter-value plots of ``y`` per category of ``x``, or of ``x`` per category of ``y``."""
    return _chart_of(data, options).boxen(
        x,
        y,
        series=series,
        color=color,
        depth=depth,
        outlier_proportion=outlier_proportion,
        trust_alpha=trust_alpha,
        width_method=width_method,
        outliers=outliers,
        fill=fill,
        fill_opacity=fill_opacity,
        label=label,
        axis=axis,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        id=id,
    )


@helper
def violin(
    data: Any,
    x: str,
    y: str,
    *,
    series: str | None = None,
    color: str | None = None,
    bandwidth: float | None = None,
    split: bool | None = None,
    inner: Literal["box", "quartiles", "none"] | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """Violins of ``y`` per category of ``x``, or of ``x`` per category of ``y``."""
    return _chart_of(data, options).violin(
        x,
        y,
        series=series,
        color=color,
        bandwidth=bandwidth,
        split=split,
        inner=inner,
        fill=fill,
        fill_opacity=fill_opacity,
        label=label,
        axis=axis,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        id=id,
    )


@helper
def treemap(
    data: Any,
    path: Sequence[str] | None = None,
    value: str | None = None,
    *,
    node: str | None = None,
    parent: str | None = None,
    labels: bool | TreemapLabels | Mapping[str, Any] | None = None,
    tile: Literal["squarify", "slice-dice"] | None = None,
    sort: Literal["value", "input"] | None = None,
    gap: float | None = None,
    levels: int | None = None,
    color: str | None = None,
    fill_opacity: float | Measure | Mapping[str, Any] | None = None,
    leaf: Look | Mapping[str, Any] | None = None,
    branch: Look | Mapping[str, Any] | None = None,
    breadcrumbs: bool | None = None,
    panel: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A treemap of a tree given by ``path`` columns, or ``node`` and ``parent``."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.treemap(
        path,
        value,
        node=node,
        parent=parent,
        labels=labels,
        tile=tile,
        sort=sort,
        gap=gap,
        levels=levels,
        color=color,
        fill_opacity=fill_opacity,
        leaf=leaf,
        branch=branch,
        breadcrumbs=breadcrumbs,
        tooltip=tooltip,
        panel=panel,
        id=id,
    )


@helper
def sunburst(
    data: Any,
    path: Sequence[str] | None = None,
    value: str | None = None,
    *,
    node: str | None = None,
    parent: str | None = None,
    labels: bool | SunburstLabels | Mapping[str, Any] | None = None,
    levels: int | None = None,
    inner_radius: float | None = None,
    center: bool | None = None,
    gap: float | tuple[float, float] | None = None,
    sort: Literal["value", "input"] | None = None,
    color: str | None = None,
    fill_opacity: float | Measure | Mapping[str, Any] | None = None,
    leaf: Look | Mapping[str, Any] | None = None,
    branch: Look | Mapping[str, Any] | None = None,
    breadcrumbs: bool | None = None,
    panel: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A sunburst of a tree given by ``path`` columns, or ``node`` and ``parent``."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.sunburst(
        path,
        value,
        node=node,
        parent=parent,
        labels=labels,
        levels=levels,
        inner_radius=inner_radius,
        center=center,
        gap=gap,
        sort=sort,
        color=color,
        fill_opacity=fill_opacity,
        leaf=leaf,
        branch=branch,
        breadcrumbs=breadcrumbs,
        tooltip=tooltip,
        panel=panel,
        id=id,
    )


@helper
def radar(
    data: Any,
    category: str | None = None,
    value: str | None = None,
    *,
    fields: Sequence[str] | None = None,
    series: str | None = None,
    domain: tuple[float, float] | None = None,
    fill_opacity: float | None = None,
    points: bool | None = None,
    label: str | None = None,
    panel: str | None = None,
    halo: HaloOption | None = None,
    id: str | None = None,
    **options: Unpack[RadarOptions],
) -> Chart:
    """A radar of ``value`` per ``category``, or of the columns ``fields`` per row."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.radar(
        category,
        value,
        fields=fields,
        series=series,
        domain=domain,
        fill_opacity=fill_opacity,
        points=points,
        label=label,
        tooltip=tooltip,
        panel=panel,
        halo=halo,
        id=id,
    )


@helper
def sankey(
    data: Any,
    source: str,
    target: str,
    value: str | None = None,
    *,
    labels: bool | None = None,
    node_width: float | None = None,
    sort: Literal["input", "value"] | None = None,
    panel: str | None = None,
    halo: HaloOption | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A Sankey diagram of flows from ``source`` to ``target``, sized by ``value``."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.sankey(
        source,
        target,
        value,
        labels=labels,
        node_width=node_width,
        sort=sort,
        tooltip=tooltip,
        panel=panel,
        halo=halo,
        id=id,
    )


@helper
def graph(
    data: Any,
    source: str,
    target: str,
    value: str | None = None,
    *,
    nodes: Any = None,
    node: str | None = None,
    color: str | None = None,
    size: str | None = None,
    labels: bool | None = None,
    directed: bool | None = None,
    link_label_field: str | None = None,
    layout: GraphLayout | None = None,
    panel: str | None = None,
    halo: HaloOption | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A network of links from ``source`` to ``target``, with ``nodes`` for colors and sizes,
    placed by ``layout`` (``"force"``, ``"circular"``, or ``"layered"``)."""
    return _chart_of(data, options).graph(
        source,
        target,
        value,
        nodes=nodes,
        node=node,
        color=color,
        size=size,
        labels=labels,
        directed=directed,
        link_label_field=link_label_field,
        layout=layout,
        panel=panel,
        halo=halo,
        id=id,
    )


@helper
def choropleth(
    data: Any,
    color: str | None = None,
    *,
    geometry: str | None = None,
    label_field: str | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    label: str | None = None,
    geojson: Any = None,
    locations: str | None = None,
    feature_id_key: str = "id",
    panel: str | None = None,
    item_key: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A map of regions colored by ``color`` (see ``Chart.geoshape``): shapes from
    ``data`` (a GeoDataFrame or GeoJSON FeatureCollection), or values from ``data``
    joined to the features of ``geojson`` by ``locations`` and ``feature_id_key``.
    Remaining keyword arguments are chart options (title, projection, ...)."""
    joined = geojson is not None
    chart, tooltip = _rows_chart_of(None if joined else data, options)
    return chart.geoshape(
        data=data if joined else None,
        color=color,
        geometry=geometry,
        label_field=label_field,
        colors=colors,
        color_domain=color_domain,
        color_midpoint=color_midpoint,
        fill=fill,
        fill_opacity=fill_opacity,
        stroke=stroke,
        stroke_width=stroke_width,
        label=label,
        geojson=geojson,
        locations=locations,
        feature_id_key=feature_id_key,
        panel=panel,
        tooltip=tooltip,
        item_key=item_key,
        id=id,
    )


@helper
def scatter_geo(
    data: Any,
    longitude: str,
    latitude: str,
    *,
    label_field: str | None = None,
    series: str | Literal[False] | None = None,
    radius: float | None = None,
    size: str | None = None,
    radius_range: tuple[float, float] | None = None,
    color: str | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    label: str | None = None,
    panel: str | None = None,
    item_key: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """Points or bubbles on a map at ``longitude`` and ``latitude`` (see ``Chart.geopoint``)."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.geopoint(
        longitude,
        latitude,
        label_field=label_field,
        series=series,
        radius=radius,
        size=size,
        radius_range=radius_range,
        color=color,
        colors=colors,
        color_domain=color_domain,
        color_midpoint=color_midpoint,
        fill=fill,
        fill_opacity=fill_opacity,
        stroke=stroke,
        stroke_width=stroke_width,
        label=label,
        panel=panel,
        tooltip=tooltip,
        item_key=item_key,
        id=id,
    )


@helper
def candlestick(
    data: Any,
    x: str,
    open: str,
    high: str,
    low: str,
    close: str,
    *,
    variant: Literal["candlestick", "ohlc"] | None = None,
    rise: str | None = None,
    fall: str | None = None,
    label: str | None = None,
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
    **options: Unpack[HelperOptions],
) -> Chart:
    """A candlestick chart of open, high, low, and close prices; OHLC bars with
    ``variant="ohlc"``."""
    chart, tooltip = _rows_chart_of(data, options)
    return chart.candlestick(
        x,
        open,
        high,
        low,
        close,
        variant=variant,
        rise=rise,
        fall=fall,
        label=label,
        axis=axis,
        panel=panel,
        clip=clip,
        z_index=z_index,
        pick=pick,
        selected=selected,
        unselected=unselected,
        partial=partial,
        inspect=inspect,
        tooltip=tooltip,
        item_key=item_key,
        id=id,
    )


@helper
def segment(
    data: Any,
    x: str | tuple[str, str],
    y: str | tuple[str, str],
    *,
    series: str | None = None,
    color: str | None = None,
    width: SegmentWidthOption | SegmentWidth | None = None,
    caps: Caps | Mapping[str, Any] | None = None,
    encode: Encodings | Mapping[str, Any] | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    axis: Literal["left", "right"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
    **options: Unpack[SegmentOptions],
) -> Chart:
    """A chart of segments, each row from one place to another (see
    ``Chart.segment``): dumbbells, arrows, comets. ``width`` is the
    segments'; give the chart's as ``hg.Chart(data, width=800).segment(...)``."""
    chart, tooltip = _rows_chart_of(data, cast("RadarOptions", options))
    return chart.segment(
        x,
        y,
        series=series,
        color=color,
        width=width,
        caps=caps,
        encode=encode,
        label=label,
        axis=axis,
        panel=panel,
        clip=clip,
        tooltip=tooltip,
        z_index=z_index,
        pick=pick,
        inspect=inspect,
        item_key=item_key,
        id=id,
    )
