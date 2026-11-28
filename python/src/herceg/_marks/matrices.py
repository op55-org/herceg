"""Matrix marks: heatmaps, contours, and dendrograms, and ``hg.matrix``."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal, TypedDict

import numpy as np

from .._data import Matrix, listlike
from .._encoding import pixels_option
from .._errors import ChartError, is_number, listed, shown
from .._style import Look, look_spec
from .common import (
    _NUMERIC,
    _WEEKDAYS,
    Clip,
    _check_method_options,
    _clip,
    _colors,
    _finite,
    _mark_facet,
    _mark_legend,
    _midpoint,
    _range,
)
from .tooltips import Tooltip

if TYPE_CHECKING:
    from .._chart import Chart


#: How rows sharing a heatmap's cell combine into its value.
CellReduce = Literal["last", "mean", "sum", "min", "max"]


class HeatmapSampling(TypedDict, total=False):
    """How a pixel showing several heatmap cells colors them: by their
    ``"mean"``, ``"max"``, or ``"min"``."""

    reduce: Literal["mean", "max", "min"] | None


def matrix(columns: Mapping[str, Any], *, x: str, y: str) -> Matrix:
    """A matrix data source: values at every ``x`` crossed with every ``y``.

    ``columns`` maps names to arrays, as ``hg.Chart`` takes them: the
    columns named by ``x`` and ``y`` hold the coordinates (one per column of
    the matrix, and one per row), and every other column a value at each
    pair, as a 2D array of shape (len(y), len(x)), row ``i`` and column
    ``j`` at ``y[i]`` and ``x[j]``, or flattened in that order. It reads as
    a table of a row per pair; contours and heatmaps draw it, and its
    coordinates travel once each rather than once per row::

        density = hg.matrix({"x": xs, "y": ys, "density": grid}, x="x", y="y")
        hg.Chart(density).contour("x", "y", "density", variant="bands")
    """
    return Matrix(columns, x, y)


@_check_method_options
def heatmap(
    self,  # type: Chart
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
    data: Any = None,
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
    legend: Literal[False] | None = None,
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
    """A grid of cells colored by the numeric column ``color``: cells at ``x`` and ``y``, or the
    days of a time column ``date`` laid out as a calendar. With a 2D array ``color`` (as in
    ``go.Heatmap(z=...)``), row ``i`` and column ``j`` is the cell at ``y[i]`` and ``x[j]``
    (positions 0, 1, 2, ... without them), sent as a matrix (``hg.matrix``).

    Category columns give one column (or row) per category. Number and
    time columns place a cell at each distinct value along a number or
    time axis, which zooms and pans: each cell reaches halfway to the
    values beside it, or with ``x_step`` / ``y_step`` (milliseconds for
    times) is that wide around its value, never past halfway to a
    closer neighbor, so values further apart leave gaps. ``x_banded`` /
    ``y_banded`` give one column (or row) per distinct number or time
    instead, as categories have.

    A calendar lays the days out in the chart's ``time_zone``: with
    ``calendar="weeks"`` (the default), a column per week along a time
    axis and a row per day of the week, from ``week_start`` (``"mon"``
    by default) down; with ``calendar="months"``, a row per month, from
    the first day's month to the last's, and a column per day of the
    month. Days without rows are empty; rows sharing a day share a cell.

    ``x1`` and ``x2`` (or ``y1`` and ``y2``), number or time columns,
    place each row's cell between two edges instead, as the bins of
    ``hg.derive(...).bin(..., end=...)`` give them; cells of one first
    edge have one second edge, and must not overlap.

    ``colors`` is a scheme name such as ``"viridis"`` or a list of hex
    colors, low to high; with ``color_midpoint``, the theme's diverging
    ramp is the default and the midpoint takes its middle color. Rows
    sharing a cell combine into its value by ``reduce``: ``"last"`` (the
    default), the last of them with a value, or their ``"mean"``,
    ``"sum"``, ``"min"``, or ``"max"``, the same at every zoom. Grids
    with more columns or rows than the plot has pixels draw each pixel
    from a block of cells, colored by ``sampling={"reduce": ...}`` of
    their values: ``"mean"`` (the default), ``"max"``, or ``"min"``.
    """
    if reduce not in (None, "last", "mean", "sum", "min", "max"):
        raise ChartError(
            'heatmap reduce: expected "last", "mean", "sum", "min", or "max"; '
            f"received {shown(reduce)}"
        )
    sampled = _sampling(sampling)
    if color is None:
        raise ChartError("heatmap color: needs the numeric column that colors the cells")
    if not isinstance(color, str):
        placed = next(
            (
                name
                for name, value in (("data", data), ("date", date), ("x1", x1), ("y1", y1))
                if value is not None
            ),
            None,
        )
        if placed is not None:
            raise ChartError(
                f"heatmap {placed}: a color matrix places its cells itself; drop {placed}, or "
                "name columns"
            )
        data = _matrix_of(color, x, y, "value", "heatmap", "color")
        x, y, color = "x", "y", "value"
    table = self._mark_table(data)
    self._require(table, color, _NUMERIC, "heatmap color")
    shared = {
        "type": "heatmap",
        "color": color,
        "colors": _colors(colors, "heatmap colors"),
        "colorDomain": _range(color_domain, "heatmap color_domain"),
        "colorMidpoint": _midpoint(color_midpoint, color_domain, "heatmap"),
        "reduce": reduce,
        "sampling": sampled,
        "label": label,
        "legend": _mark_legend(legend, "heatmap"),
        "facet": _mark_facet(facet, "heatmap"),
        "panel": panel,
        "clip": _clip(clip, "heatmap"),
        "tooltip": self._mark_tooltip(table, tooltip, "heatmap"),
        "zIndex": z_index,
        "pick": pick,
        "selected": look_spec(selected, "heatmap selected"),
        "unselected": look_spec(unselected, "heatmap unselected"),
        "partial": look_spec(partial, "heatmap partial"),
        "inspect": inspect,
        "id": id,
    }
    if date is not None:
        grid = {
            "x": x,
            "y": y,
            "x1": x1,
            "x2": x2,
            "y1": y1,
            "y2": y2,
            "x_step": x_step,
            "y_step": y_step,
        }
        given = [name for name, option in grid.items() if option is not None]
        given += [name for name, on in (("x_banded", x_banded), ("y_banded", y_banded)) if on]
        if given:
            raise ChartError(
                f"heatmap {given[0]}: a calendar (date) places its days itself; drop {given[0]}"
            )
        if calendar not in (None, "weeks", "months"):
            raise ChartError(
                f'heatmap calendar: expected "weeks" or "months"; received {shown(calendar)}'
            )
        if week_start is not None and week_start not in _WEEKDAYS:
            raise ChartError(
                f"heatmap week_start: expected {listed(_WEEKDAYS)}; received {shown(week_start)}"
            )
        if calendar == "months" and week_start is not None:
            raise ChartError(
                "heatmap week_start: applies to calendars of weeks; "
                'drop it, or give calendar="weeks"'
            )
        self._require(table, date, ("time",), "heatmap date")
        return self._add(
            {**shared, "date": date, "calendar": calendar, "weekStart": week_start}, table
        )
    edges: dict[str, Any] = {}
    for axis, one, low, high, step, bands in (
        ("x", x, x1, x2, x_step, x_banded),
        ("y", y, y1, y2, y_step, y_banded),
    ):
        if one is not None and (low is not None or high is not None):
            raise ChartError(
                f"heatmap {axis}1: {axis} places cells at values, {axis}1 and {axis}2 "
                "between edges; give one form"
            )
        if (low is None) != (high is None):
            missing = f"{axis}1" if low is None else f"{axis}2"
            raise ChartError(
                f"heatmap {missing}: missing; cells between edges need {axis}1 and {axis}2"
            )
        if one is None and low is None:
            raise ChartError(
                "heatmap: needs x and y (or x1 and x2, y1 and y2), or a date to lay out "
                "as a calendar"
            )
        if low is not None and high is not None:
            option = f"{axis}_step" if step is not None else f"{axis}_banded" if bands else None
            if option is not None:
                raise ChartError(
                    f"heatmap {option}: cells between {axis}1 and {axis}2 take their edges "
                    f"from them; drop {option}"
                )
            self._require(table, low, _NUMERIC, f"heatmap {axis}1")
            self._require(table, high, _NUMERIC, f"heatmap {axis}2")
            if self._kind(table, low) != self._kind(table, high):
                raise ChartError(
                    f"heatmap {axis}2: {high!r} holds {self._kind(table, high)} values and "
                    f"{axis}1's {low!r} {self._kind(table, low)} values; give edges of one kind"
                )
            edges[f"{axis}1"], edges[f"{axis}2"] = low, high
    if calendar is not None or week_start is not None:
        option = "calendar" if calendar is not None else "week_start"
        raise ChartError(
            f"heatmap {option}: applies to calendars of a date; give date or drop {option}"
        )
    self._require(table, x, ("number", "time", "category"), "heatmap x")
    self._require(table, y, ("number", "time", "category"), "heatmap y")

    def placement(
        axis: str, field: str | None, step: float | None, bands: bool
    ) -> tuple[float | None, bool | None]:
        """The spec's step and banded option along one axis."""
        if not isinstance(bands, bool):
            raise ChartError(
                f"heatmap {axis}_banded: expected True or False; received {shown(bands)}"
            )
        category = field is not None and self._kind(table, field) == "category"
        if step is not None:
            if not (_finite(step) and step > 0):
                raise ChartError(
                    f"heatmap {axis}_step: expected a positive number; received {shown(step)}"
                )
            if category or bands:
                raise ChartError(
                    f"heatmap {axis}_step: sizes cells along a number or time {axis} axis; "
                    + (
                        f"{field!r} holds categories, so drop {axis}_step"
                        if category
                        else f"{axis}_banded bands it, so drop one"
                    )
                )
            step = float(step)
        return step, True if bands else None

    x_step, x_bands = placement("x", x, x_step, x_banded)
    y_step, y_bands = placement("y", y, y_step, y_banded)
    return self._add(
        {
            **shared,
            "x": x,
            "y": y,
            "xStep": x_step,
            "yStep": y_step,
            "xBanded": x_bands,
            "yBanded": y_bands,
            **edges,
        },
        table,
    )


@_check_method_options
def contour(
    self,  # type: Chart
    x: Any = None,
    y: Any = None,
    color: Any = None,
    *,
    data: Any = None,
    thresholds: int | Sequence[float] | np.ndarray[Any, Any] | None = None,
    variant: Literal["lines", "bands"] | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    fill_opacity: float | None = None,
    label: str | None = None,
    legend: Literal[False] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    inspect: bool | None = None,
    id: str | None = None,
) -> Chart:
    """Contours of a field sampled on a grid: lines where it crosses each
    threshold, or with ``variant="bands"``, bands filled from each up to
    the next, colored on the ``colors`` ramp.

    With column names, each row is a grid point: number or time columns
    ``x`` and ``y`` place it on a rectilinear grid (every distinct x with
    every distinct y), and the number column ``color`` is the field's
    value there; an ``hg.matrix`` holds such a grid as it is. With a 2D
    array ``color`` (as in ``go.Contour(z=...)``), row ``i`` and column
    ``j`` is the value at ``y[i]`` and ``x[j]`` (positions 0, 1, 2, ...
    without them), sent as a matrix. Values are interpolated linearly
    between grid points; points without a value leave holes, and contours
    end where the grid does.

    ``thresholds`` is about how many round values across the field (10
    by default; for bands, round edges covering it), or the values,
    increasing (at least two for bands). Lines take ``stroke`` (one color
    for all) and ``stroke_width``; bands ``fill_opacity``.
    """
    if variant not in (None, "lines", "bands"):
        raise ChartError(f'contour variant: expected "lines" or "bands"; received {shown(variant)}')
    bands = variant == "bands"
    if color is None:
        raise ChartError("contour color: needs the number column, or a 2D array, of the field")
    if not isinstance(color, str):
        color = _grid_of(color, "contour", "color")
        if data is not None:
            raise ChartError(
                "contour data: a color matrix holds the field itself; drop data, or name "
                "columns of it"
            )
        data = _matrix_of(color, x, y, "value", "contour", "color")
        x, y, color = "x", "y", "value"
    elif not (isinstance(x, str) and isinstance(y, str)):
        axis, value = ("x", x) if not isinstance(x, str) else ("y", y)
        raise ChartError(
            f"contour {axis}: expected a column name, as color names a column; "
            f"received {shown(value)}"
        )
    given = ("stroke", stroke) if stroke is not None else ("stroke_width", stroke_width)
    if bands and given[1] is not None:
        raise ChartError(
            f"contour {given[0]}: draws lines; bands take colors and fill_opacity, so drop "
            f'{given[0]} or use variant="lines"'
        )
    if not bands and fill_opacity is not None:
        raise ChartError(
            "contour fill_opacity: fills bands; lines take stroke and stroke_width, so drop "
            'it or use variant="bands"'
        )
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            f"contour stroke_width: expected a number of at least 0; received {shown(stroke_width)}"
        )
    if fill_opacity is not None and not (_finite(fill_opacity) and 0 <= fill_opacity <= 1):
        raise ChartError(
            f"contour fill_opacity: expected a number from 0 to 1; received {shown(fill_opacity)}"
        )
    table = self._mark_table(data)
    self._require(table, x, _NUMERIC, "contour x")
    self._require(table, y, _NUMERIC, "contour y")
    self._require(table, color, ("number",), "contour color")
    return self._add(
        {
            "type": "contour",
            "x": x,
            "y": y,
            "color": color,
            "thresholds": _thresholds(thresholds, bands),
            "variant": variant,
            "colors": _colors(colors, "contour colors"),
            "colorDomain": _range(color_domain, "contour color_domain"),
            "colorMidpoint": _midpoint(color_midpoint, color_domain, "contour"),
            "stroke": stroke,
            "strokeWidth": None if stroke_width is None else float(stroke_width),
            "fillOpacity": None if fill_opacity is None else float(fill_opacity),
            "label": label,
            "legend": _mark_legend(legend, "contour"),
            "facet": _mark_facet(facet, "contour"),
            "panel": panel,
            "clip": _clip(clip, "contour"),
            "zIndex": z_index,
            "pick": pick,
            "inspect": inspect,
            "id": id,
        },
        table,
    )


@_check_method_options
def dendrogram(
    self,  # type: Chart
    first: str,
    second: str,
    height: str,
    *,
    leaves: Sequence[str],
    side: Literal["bottom", "top", "left", "right"] | None = None,
    data: Any = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    label: str | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    inspect: bool | None = None,
    id: str | None = None,
) -> Chart:
    """A SciPy-layout linkage tree with leaves on category bands.

    ``leaves[i]`` labels leaf id i. ``side`` is the plot edge at height
    zero (bottom by default); heights are values on the other axis, whose
    automatic domain descends for ``"top"`` and ``"right"``.
    With facets, pass ``facet="repeat"`` to draw the whole tree in each.
    """
    if side not in (None, "bottom", "top", "left", "right"):
        raise ChartError(
            f'dendrogram side: expected "bottom", "top", "left", or "right"; received {shown(side)}'
        )
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            "dendrogram stroke_width: expected a finite number of at least 0; "
            f"received {shown(stroke_width)}"
        )
    table = self._mark_table(data)
    options = ("first", "second", "height")
    fields = (first, second, height)
    for option, field in zip(options, fields, strict=True):
        self._require(table, field, ("number",), f"dendrogram {option}")
    if not listlike(leaves):
        raise ChartError(f"dendrogram leaves: expected a list of labels; received {shown(leaves)}")
    labels = list(leaves)
    seen: set[str] = set()
    for i, leaf in enumerate(labels):
        if not isinstance(leaf, str):
            raise ChartError(
                f"dendrogram leaves[{i}]: expected a label (a string); received {shown(leaf)}"
            )
        if leaf in seen:
            raise ChartError(
                f"dendrogram leaves[{i}]: {shown(leaf)} labels an earlier leaf too; "
                "give each leaf its own label"
            )
        seen.add(leaf)
    columns = [self._tables[table][1].column(field).values for field in fields]
    rows = len(columns[0])
    n = rows + 1
    if len(labels) != n:
        raise ChartError(
            f"dendrogram leaves: expected {n} labels, for {rows} merge rows; received {len(labels)}"
        )
    used = bytearray(n + rows)
    for row in range(rows):
        for channel, column in enumerate(columns):
            value = float(column[row])
            at = f"dendrogram {options[channel]}, row {row}"
            if channel == 2:
                if not np.isfinite(value) or value < 0:
                    raise ChartError(
                        f"{at}: expected a finite height of at least 0; received {value}"
                    )
            else:
                if not np.isfinite(value) or not value.is_integer() or not 0 <= value < n + row:
                    raise ChartError(
                        f"{at}: expected a whole number naming a leaf or an earlier merge; "
                        f"received {value}"
                    )
                cluster = int(value)
                if used[cluster]:
                    raise ChartError(
                        f"{at}: cluster {cluster} is merged more than once; merge it once"
                    )
                used[cluster] = 1
    return self._add(
        {
            "type": "dendrogram",
            "first": first,
            "second": second,
            "height": height,
            "leaves": labels,
            "side": side,
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "dendrogram stroke_width"),
            "label": label,
            "facet": _mark_facet(facet, "dendrogram"),
            "panel": panel,
            "clip": _clip(clip, "dendrogram"),
            "zIndex": z_index,
            "pick": pick,
            "inspect": inspect,
            "id": id,
        },
        table,
    )


def _matrix_of(values: Any, x: Any, y: Any, name: str, mark: str, option: str) -> Matrix:
    """A 2D array of values, given as the mark's `option`, as a matrix: row
    i, column j at ``y[i]``, ``x[j]`` (positions 0, 1, 2, ... without
    them), in columns "x", "y", and `name`."""
    grid = _grid_of(values, mark, option)
    rows, columns = grid.shape

    def positions(given: Any, count: int, axis: str) -> Any:
        if given is None:
            return np.arange(count, dtype=np.float64)
        if isinstance(given, str):
            raise ChartError(
                f"{mark} {axis}: expected positions along the {name} matrix; "
                f"received the column name {shown(given)}"
            )
        array = np.asarray(given)
        if array.ndim != 1 or len(array) != count:
            side = "column" if axis == "x" else "row"
            received = len(array) if array.ndim == 1 else f"an array of shape {array.shape}"
            raise ChartError(
                f"{mark} {axis}: expected {count} values, one per matrix {side}; "
                f"received {received}"
            )
        return given

    return Matrix(
        {"x": positions(x, columns, "x"), "y": positions(y, rows, "y"), name: grid},
        x="x",
        y="y",
    )


def _grid_of(values: Any, mark: str, option: str) -> np.ndarray:
    """A 2D array of numbers, given as the mark's `option`."""
    try:
        grid = np.asarray(values, dtype=np.float64)
    except (TypeError, ValueError):
        raise ChartError(
            f"{mark} {option}: expected a 2D matrix of numbers, rows of equal length; "
            f"received {type(values).__name__}"
        ) from None
    if grid.ndim != 2:
        raise ChartError(f"{mark} {option}: expected a 2D matrix; received shape {grid.shape}")
    return grid


def _thresholds(thresholds: Any, bands: bool) -> int | list[float] | None:
    """A contour's thresholds as the spec takes them: a count, or increasing values."""
    if thresholds is None:
        return None
    if is_number(thresholds) and not isinstance(thresholds, (bool, np.bool_)):
        count = float(thresholds) if _finite(thresholds) else math.nan
        if not (count.is_integer() and 1 <= count <= 1000):
            raise ChartError(
                "contour thresholds: expected a whole number from 1 to 1000, or values; "
                f"received {shown(thresholds)}"
            )
        return int(count)
    if not listlike(thresholds):
        raise ChartError(
            "contour thresholds: expected a count or a list of values; "
            f"received {shown(thresholds)}"
        )
    least = 2 if bands else 1
    if not least <= len(thresholds) <= 1000:
        raise ChartError(
            f"contour thresholds: expected {least} to 1000 values"
            + (", a band between each two" if bands else "")
            + f"; received {len(thresholds)}"
        )
    values: list[float] = []
    for i, value in enumerate(thresholds):
        if not _finite(value):
            raise ChartError(
                f"contour thresholds[{i}]: expected a finite number; received {shown(value)}"
            )
        if values and not float(value) > values[-1]:
            raise ChartError(
                f"contour thresholds[{i}]: expected a value above {values[-1]:g}, the one "
                f"before; received {float(value):g}"
            )
        values.append(float(value))
    return values


def _sampling(sampling: Any) -> dict[str, str] | None:
    """A heatmap's sampling as the spec takes it: ``{"reduce": "mean" | "max" | "min"}``."""
    if sampling is None:
        return None
    if not isinstance(sampling, Mapping) or set(sampling) - {"reduce"}:
        raise ChartError(
            'heatmap sampling: expected {"reduce": "mean", "max", or "min"}; '
            f"received {shown(sampling)}"
        )
    reduce = sampling.get("reduce")
    if reduce not in (None, "mean", "max", "min"):
        raise ChartError(
            f'heatmap sampling reduce: expected "mean", "max", or "min"; received {shown(reduce)}'
        )
    return {"reduce": reduce} if reduce is not None else {}
