"""3D marks: points, lines, and surfaces in a box."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Literal

from .._encoding import fraction_option, pixels_option
from .._errors import ChartError, shown
from .common import (
    _NUMERIC,
    _check_method_options,
    _check_size,
    _colors,
    _finite,
    _midpoint,
    _range,
)
from .matrices import _grid_of, _matrix_of
from .tooltips import Tooltip

if TYPE_CHECKING:
    from .._chart import Chart


@_check_method_options
def point_3d(
    self,  # type: Chart
    x: str,
    y: str,
    z: str,
    *,
    data: Any = None,
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
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Points in a 3D chart at the numeric or datetime columns ``x``, ``y``,
    and ``z`` (z is vertical).

    ``series`` gives a color and legend entry per category, ``color``
    colors points by a numeric column (or a category column, which names
    the series too unless ``series`` is given or ``False``, as
    ``Chart.point``'s) or is a CSS color for every point (``fill`` wins
    over it), and ``label_field`` names a
    category column labeling each point in tooltips. ``radius`` is the
    radius in pixels (3.5 by default). 3D marks share their chart or subplot, its
    box, and its ``camera``.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    self._check_3d("point_3d")
    table = self._mark_table(data)
    for axis, field in (("x", x), ("y", y), ("z", z)):
        self._require(table, field, _NUMERIC, f"point_3d {axis}")
    # A category color names the series, as on points along axes; series=False keeps one.
    split = self._series_of(table, series, color, None, fill, "fill", "point_3d")
    if (
        color is not None
        and fill is None
        and self._kind(table, color) == "category"
        and split != color
    ):
        raise ChartError(
            f"point_3d color: {color!r} holds categories, which color "
            "3D points by series; leave series out "
            f"(or give series={color!r}), or color by a numeric column",
            path=self._path("point_3d", "color"),
        )
    self._require(table, label_field, ("category",), "point_3d label_field")
    self._check_point_color(
        table,
        color,
        fill,
        colors,
        color_domain,
        color_midpoint,
        "point_3d",
        ("number",),
        f"give fill={color!r} for the color, or rename the column",
    )
    _check_size(radius, None, "point_3d")
    if fill_opacity is not None and not (_finite(fill_opacity) and 0 <= fill_opacity <= 1):
        raise ChartError(
            f"point_3d fill_opacity: expected a number from 0 to 1; received {shown(fill_opacity)}"
        )
    return self._add(
        {
            "type": "point3d",
            "x": x,
            "y": y,
            "z": z,
            "series": series,
            "labelField": label_field,
            "radius": radius,
            "color": color,
            "colors": _colors(colors, "point_3d colors"),
            "colorDomain": _range(color_domain, "point_3d color_domain"),
            "colorMidpoint": _midpoint(color_midpoint, color_domain, "point_3d"),
            "fill": fill,
            "fillOpacity": fraction_option(fill_opacity, "point_3d fill_opacity"),
            "label": label,
            "tooltip": self._mark_tooltip(table, tooltip, "point_3d"),
            "panel": panel,
            "itemKey": self._item_key(table, item_key, "point_3d"),
            "id": id,
        },
        table,
    )


@_check_method_options
def line_3d(
    self,  # type: Chart
    x: str,
    y: str,
    z: str,
    *,
    data: Any = None,
    series: str | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    label: str | None = None,
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Lines in a 3D chart through the numeric or datetime columns ``x``,
    ``y``, and ``z`` (z is vertical).

    Each ``series`` category's rows, in table order, are one path with its
    color and legend entry (all rows are one path without it); a row
    missing a value breaks its path. ``stroke_width`` is in pixels (2 by
    default) and stays the same however near or far the line is. 3D marks
    share their chart or subplot, its box, and its ``camera``.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    self._check_3d("line_3d")
    table = self._mark_table(data)
    for axis, field in (("x", x), ("y", y), ("z", z)):
        self._require(table, field, _NUMERIC, f"line_3d {axis}")
    self._require(table, series, ("category",), "line_3d series")
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width > 0):
        raise ChartError(
            "line_3d stroke_width: expected a positive number of pixels; "
            f"received {shown(stroke_width)}"
        )
    return self._add(
        {
            "type": "line3d",
            "x": x,
            "y": y,
            "z": z,
            "series": series,
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "line_3d stroke_width"),
            "label": label,
            "tooltip": self._mark_tooltip(table, tooltip, "line_3d"),
            "panel": panel,
            "itemKey": self._item_key(table, item_key, "line_3d"),
            "id": id,
        },
        table,
    )


@_check_method_options
def surface(
    self,  # type: Chart
    x: Any = None,
    y: Any = None,
    z: Any = None,
    *,
    data: Any = None,
    color: str | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    fill_opacity: float | None = None,
    shading: bool | None = None,
    wireframe: bool | None = None,
    label: str | None = None,
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    id: str | None = None,
) -> Chart:
    """A surface in a 3D chart, from a grid of rows or from a matrix.

    With column names, each row is a grid point: ``x`` and ``y`` (numbers,
    datetimes, or categories) pick its place, and ``z`` is its height;
    points without a value leave holes. With a 2D array ``z`` (as in
    ``go.Surface(z=...)``), row ``i`` and column ``j`` is the height at
    ``y[i]`` and ``x[j]``, where ``x`` and ``y`` are optional sequences
    (positions 0, 1, 2, ... by default), sent as a matrix (``hg.matrix``)
    of columns ``"x"``, ``"y"``, and ``"z"``.

    The surface is colored by height, or by a numeric ``color`` column,
    and shaded by how it faces a light (``shading=False`` keeps colors as
    the legend shows them); ``wireframe=True`` draws its grid lines.
    ``tooltip=hg.Tooltip(fields=[...])`` shows more of a grid point's row.
    """
    self._check_3d("surface")
    if z is None:
        raise ChartError(
            "surface z: expected a column name or a 2D array of heights; received None"
        )
    if not isinstance(z, str):
        z = _grid_of(z, "surface", "z")
        if data is not None or color is not None:
            option = "data" if data is not None else "color"
            raise ChartError(
                f"surface {option}: a z matrix takes no data or color column; drop {option}"
            )
        data = _matrix_of(z, x, y, "z", "surface", "z")
        x, y, z = "x", "y", "z"
    elif not (isinstance(x, str) and isinstance(y, str)):
        axis, value = ("x", x) if not isinstance(x, str) else ("y", y)
        raise ChartError(
            f"surface {axis}: expected a column name, as z names a column; received {shown(value)}"
        )
    table = self._mark_table(data)
    self._require(table, x, (*_NUMERIC, "category"), "surface x")
    self._require(table, y, (*_NUMERIC, "category"), "surface y")
    self._require(table, z, ("number",), "surface z")
    self._require(table, color, ("number",), "surface color")
    if fill_opacity is not None and not (_finite(fill_opacity) and 0 <= fill_opacity <= 1):
        raise ChartError(
            f"surface fill_opacity: expected a number from 0 to 1; received {shown(fill_opacity)}"
        )
    return self._add(
        {
            "type": "surface",
            "x": x,
            "y": y,
            "z": z,
            "color": color,
            "colors": _colors(colors, "surface colors"),
            "colorDomain": _range(color_domain, "surface color_domain"),
            "colorMidpoint": _midpoint(color_midpoint, color_domain, "surface"),
            "fillOpacity": fraction_option(fill_opacity, "surface fill_opacity"),
            "shading": shading,
            "wireframe": wireframe,
            "label": label,
            "tooltip": self._mark_tooltip(table, tooltip, "surface"),
            "panel": panel,
            "id": id,
        },
        table,
    )
