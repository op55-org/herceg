"""Layouts: where a chart's panels go.

A layout is a grid of rows and columns whose cells hold panels, or grids of
their own, and insets drawn over a panel's plot. ``layout=hg.Grid(columns=2)``
places a chart's ``panels`` in rows of columns, in order; the chart's
``columns``, ``rows``, ``grid``, and ``mosaic`` methods build a layout cell by
cell, making panels where they go::

    left, right = chart.columns([2, 1])
    left.panel("latency", weight=2, title="p99").line(x="time", y="p99")
    left.panel("errors").bar(x="time", y="errors")
    right.panel("share").pie("region", "requests")

Tracks (rows and columns) are weights, shares of the room left, or fixed
sizes in pixels (``hg.Pixels(220)``), or ``hg.Weight(1, min=180)``; they
size the panels' plots, titles and axes beside them, as matplotlib's ratios do.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Literal, TypedDict

import numpy as np

from ._data import listlike
from ._encoding import Fraction, Pixels, Position
from ._errors import (
    ChartError,
    Role,
    is_integer,
    is_number,
    keys_shown,
    located,
    refuses,
    shown,
    tuplable,
    tupled,
)
from ._style import StrokeStyle

if TYPE_CHECKING:
    from ._chart import AxisOptions, Camera, Panel
    from ._interaction import Binding, ViewLimits
    from ._style import Style, Title


@refuses
@dataclass(frozen=True)
class Weight:
    """A row's or column's share of the room flexible tracks share, by
    weight, its plots at least ``min`` pixels long."""

    value: float
    min: float | None = None

    def __post_init__(self) -> None:
        _weight(self.value, Role("Weight").field("value"))
        if self.min is not None and not _pixels(self.min, zero=True):
            raise ChartError(
                f"Weight min: expected pixels of at least 0; received {shown(self.min)}"
            )


#: A row or column: a weight, an ``hg.Weight`` with a least size, or ``hg.Pixels``.
Track = float | Weight | Pixels

#: What sizes tracks: how many of weight 1, or a size each.
Tracks = int | Sequence[Track]


def _number(value: Any) -> bool:
    """Whether `value` is a number: no flag, and no NumPy duration (an integer
    of its unit)."""
    return is_number(value) and not isinstance(value, (bool, np.timedelta64))


def _weight(value: Any, role: Role) -> float:
    if not _number(value) or not (0 < float(value) < math.inf):
        raise role.error(f"expected a weight greater than 0; received {shown(value)}")
    return float(value)


def _whole(value: Any) -> bool:
    """Whether `value` is a whole number, a float of one too (no flag, no
    NumPy duration)."""
    return _number(value) and math.isfinite(value) and float(value).is_integer()


def _pixels(value: Any, *, zero: bool = False) -> bool:
    if not _number(value):
        return False
    pixels = float(value)
    return math.isfinite(pixels) and (pixels >= 0 if zero else pixels > 0)


def track_spec(track: Any, role: Role) -> Any:
    """A track as the spec takes it: a weight, ``{"weight", "min"}``, or ``{"px"}``."""
    if isinstance(track, Weight):
        return (
            {"weight": float(track.value), "min": float(track.min)}
            if track.min
            else float(track.value)
        )
    if isinstance(track, Pixels):
        if track.field is not None or track.frame is not None or track.offset is not None:
            raise role.error("a track's pixels take no field, frame, or offset; drop them")
        if track.value is None or not _pixels(track.value):
            raise role.error(f"expected pixels greater than 0; received {shown(track.value)}")
        return {"px": float(track.value)}
    if isinstance(track, Fraction):
        raise role.error(
            "a track is a weight, hg.Weight, or hg.Pixels; a fraction of the "
            "chart is a weight: give its share as a number"
        )
    return _weight(track, role)


def tracks_spec(tracks: Any, role: Role) -> list[Any]:
    """Tracks as the spec takes them: ``n`` of weight 1, or each one's size."""
    if isinstance(tracks, (bool, np.timedelta64)):
        raise role.error(f"expected a whole number or a list of sizes; received {shown(tracks)}")
    if is_integer(tracks):
        if tracks < 1:
            raise role.error(f"expected a whole number of at least 1; received {tracks}")
        return [1.0] * int(tracks)
    # NumPy arrays of weights are sizes too.
    sizes = list(tracks) if listlike(tracks) else None
    if not sizes:
        raise role.error(
            "expected a whole number or a list of sizes (weights, hg.Weight, "
            f"hg.Pixels); received {shown(tracks)}"
        )
    return [track_spec(track, role.index(i)) for i, track in enumerate(sizes)]


def _gap(gap: Any, role: Role, *, pairs: bool = True) -> Any:
    """A grid's gap: pixels between tracks, or with `pairs` ``(row, column)``
    (a row or a column of cells has one gap)."""
    if gap is None:
        return None
    if pairs and not is_number(gap) and tuplable(gap):
        gap = tupled(gap, (2,))
    if isinstance(gap, tuple) and pairs:
        if len(gap) != 2 or not all(_pixels(g, zero=True) for g in gap):
            raise role.error(f"expected (row, column) pixels; received {shown(gap)}")
        return {"row": float(gap[0]), "column": float(gap[1])}
    if not _pixels(gap, zero=True):
        raise role.error(f"expected pixels of at least 0; received {shown(gap)}")
    return float(gap)


@refuses
@dataclass
class Grid:
    """``layout=``: the chart's ``panels`` in rows of ``columns``, in order:
    ``columns`` as a count or each column's size (weights, ``hg.Weight``,
    ``hg.Pixels``), ``rows`` the same (as many as the panels need when left
    out), ``gap`` the pixels between tracks (12 by default; or ``(row,
    column)``), and ``id`` the grid's name for scale scopes."""

    columns: Tracks = 1
    rows: Tracks | None = None
    gap: float | tuple[float, float] | None = None
    id: str | None = None

    def _spec(self) -> dict[str, Any]:
        spec: dict[str, Any] = {
            "type": "grid",
            "id": _id(self.id, _GRID.field("id")),
            "rows": tracks_spec(self.rows, _GRID.field("rows")) if self.rows is not None else None,
            "columns": tracks_spec(self.columns, _GRID.field("columns")),
            "gap": _gap(self.gap, _GRID.field("gap")),
        }
        return {key: value for key, value in spec.items() if value is not None}


_GRID = Role("Grid")


def _id(value: Any, role: Role) -> str | None:
    if value is not None and (not isinstance(value, str) or value == ""):
        raise role.error(f"expected a name; received {shown(value)}")
    return value


#: Where an inset goes: a corner or edge of its parent's plot, or a position.
InsetAnchor = Literal["top-left", "top-right", "bottom-left", "bottom-right", "center"]


@dataclass
class _Inset:
    """An inset over a panel: its panel (with the insets over it) and how it is placed."""

    panel: Panel
    spec: dict[str, Any]

    def _spec(self) -> dict[str, Any]:
        spec = {"panel": self.panel.id, **self.spec}
        if self.panel._insets:
            spec["insets"] = [inset._spec() for inset in self.panel._insets]
        return spec


class InsetIndicator(TypedDict, total=False):
    """How an inset's indicator draws: ``connectors`` (lines from its box to
    the inset's corners, True by default) and ``style`` (an
    ``hg.StrokeStyle``)."""

    connectors: bool
    style: StrokeStyle | Mapping[str, Any] | None


def inset_spec(
    place: Any,
    anchor: InsetAnchor | None,
    width: Fraction | Pixels | None,
    height: Fraction | Pixels | None,
    indicator: bool | InsetIndicator | None,
    role: str,
) -> dict[str, Any]:
    """How an inset is placed, as the spec takes it."""
    from ._style import Place, _built, _spec

    spec: dict[str, Any] = {}
    if isinstance(place, Place):
        if place.inside is None or place.scope is not None or place.panel is not None:
            raise ChartError(
                f"{role} place: an inset goes inside its parent's plot; give "
                'hg.Place(inside="top-right"), or a position with hg.Position'
            )
        spec["place"] = {"inside": place.inside}
        if place.inset is not None:
            spec["place"]["inset"] = float(place.inset)
    elif isinstance(place, Position):
        at = located(Role(role).field("place"), place._spec)
        for axis, coordinate in at.items():
            if not isinstance(coordinate, dict) or not (
                "fraction" in coordinate or "px" in coordinate
            ):
                raise ChartError(
                    f"{role} place: insets go at fractions or pixels of the plot or the chart, "
                    f"and {axis} is {shown(getattr(place, axis))}; use hg.Fraction or hg.Pixels"
                )
            if isinstance(coordinate.get("fraction", coordinate.get("px")), dict):
                raise ChartError(
                    f"{role} place: an inset goes at one place, not at a column's values; "
                    f"give {axis} a number"
                )
        spec["place"] = {"at": at}
        if anchor is not None:
            spec["place"]["anchor"] = anchor
    elif place is not None:
        raise ChartError(f"{role} place: expected hg.Place or hg.Position; received {shown(place)}")
    if anchor is not None and not isinstance(place, Position):
        raise ChartError(
            f"{role} anchor: anchors an inset placed at a position; give place=hg.Position(...)"
        )
    if anchor is not None and anchor not in (
        "top-left",
        "top-right",
        "bottom-left",
        "bottom-right",
        "center",
    ):
        raise ChartError(
            f'{role} anchor: expected "top-left", "top-right", "bottom-left", "bottom-right", '
            f'or "center"; received {shown(anchor)}'
        )
    for name, size in (("width", width), ("height", height)):
        if size is None:
            continue
        if isinstance(size, Fraction):
            if (
                size.value is None
                or not (0 < size.value <= 1)
                or size.frame is not None
                or size.offset is not None
            ):
                raise ChartError(
                    f"{role} {name}: expected a fraction of the parent's plot above 0, at most 1; "
                    f"received {shown(size)}"
                )
            spec[name] = {"fraction": float(size.value)}
        elif isinstance(size, Pixels):
            if (
                size.value is None
                or not _pixels(size.value)
                or size.frame is not None
                or size.offset is not None
            ):
                raise ChartError(
                    f"{role} {name}: expected pixels greater than 0; received {shown(size)}"
                )
            spec[name] = {"px": float(size.value)}
        else:
            raise ChartError(
                f"{role} {name}: expected hg.Fraction or hg.Pixels; received {shown(size)}"
            )
    if indicator is not None:
        if isinstance(indicator, bool):
            spec["indicator"] = indicator
        elif isinstance(indicator, Mapping):
            option = Role(role).field("indicator")
            unknown = [key for key in indicator if key not in ("connectors", "style")]
            if unknown:
                raise option.error(f"expected connectors and style; received {keys_shown(unknown)}")
            out: dict[str, Any] = {}
            if "connectors" in indicator:
                connectors = indicator["connectors"]
                if not isinstance(connectors, (bool, np.bool_)):
                    raise option.field("connectors").error(
                        f"expected True or False; received {shown(connectors)}"
                    )
                out["connectors"] = bool(connectors)
            if indicator.get("style") is not None:
                style = option.field("style")
                out["style"] = located(
                    style, lambda: _spec(_built(indicator["style"], StrokeStyle, style.label))
                )
            spec["indicator"] = out
        else:
            raise ChartError(
                f"{role} indicator: expected True, False, or a dict of connectors and style; "
                f"received {shown(indicator)}"
            )
    return spec


class _Stack:
    """A cell's panels from top to bottom, each with its row's weight."""

    def __init__(self) -> None:
        self.panels: list[tuple[Panel, Any]] = []

    def _spec(self) -> dict[str, Any]:
        # One panel of a weight fills its cell; one of pixels or a least size keeps its row.
        if len(self.panels) == 1 and not isinstance(self.panels[0][1], dict):
            return self.panels[0][0]._layout_spec()
        return {
            "type": "grid",
            "rows": [weight for _, weight in self.panels],
            "columns": [1.0],
            "cells": [
                {"row": i, "column": 0, "content": panel._layout_spec()}
                for i, (panel, _) in enumerate(self.panels)
            ],
        }


class _GridNode:
    """A grid in a cell: its tracks, gap, id, and the cells placed on it."""

    def __init__(self, rows: list[Any], columns: list[Any], gap: Any, id: str | None) -> None:
        self.rows = rows
        self.columns = columns
        self.gap = gap
        self.id = id
        self.cells: list[tuple[int, int, int, int, Cell]] = []

    def _spec(self) -> dict[str, Any]:
        cells = []
        for row, column, row_span, column_span, cell in self.cells:
            content = cell._content_spec()
            if content is None:
                continue
            spec: dict[str, Any] = {"row": row, "column": column, "content": content}
            if row_span != 1:
                spec["rowSpan"] = row_span
            if column_span != 1:
                spec["columnSpan"] = column_span
            cells.append(spec)
        spec = {
            "type": "grid",
            "id": self.id,
            "rows": self.rows,
            "columns": self.columns,
            "gap": self.gap,
            "cells": cells,
        }
        return {key: value for key, value in spec.items() if value is not None}


class Cell:
    """A cell of a chart's layout: it holds panels stacked from the top
    (``panel``), or a grid of cells of its own (``columns``, ``rows``,
    ``grid``), one or the other. Make cells with the chart's ``columns``,
    ``rows``, ``grid``, and ``mosaic``."""

    def __init__(self, make: Callable[..., Panel], role: str) -> None:
        self._make = make
        self._role = role
        self._content: _Stack | _GridNode | None = None

    def panel(
        self,
        id: str | None = None,
        *,
        weight: Track = 1,
        title: str | Title | dict[str, Any] | None = None,
        x: AxisOptions | dict[str, Any] | None = None,
        y: AxisOptions | dict[str, Any] | None = None,
        y_right: AxisOptions | dict[str, Any] | None = None,
        camera: Camera | dict[str, Any] | None = None,
        style: Style | dict[str, Any] | None = None,
        zoom: bool | Literal["x", "y", "xy"] | None = None,
        pan: bool | Literal["x", "y", "xy"] | None = None,
        brush: Literal["x", "y", "xy", "lasso"] | None = None,
        bindings: Sequence[Binding] | None = None,
        limits: Mapping[str, ViewLimits] | None = None,
        rotate: bool | None = None,
        drag: bool | None = None,
    ) -> Panel:
        """A panel in the cell, below those already there, ``weight`` its
        share of the cell's height; it takes marks through its methods
        (``panel.line(...)``). ``id`` names the panel for scale scopes,
        legends, events, and sync, and is ``"panel-1"``, ``"panel-2"``, ...
        by the order panels are made when left out; ``title``, ``x``, ``y``,
        ``y_right``, ``camera``, ``style``, and how it answers input
        (``zoom``, ``pan``, ``brush``, ``bindings``, ``limits``, ``rotate``,
        ``drag``) as ``hg.Panel`` takes them."""
        if isinstance(self._content, _GridNode):
            raise ChartError(
                f"{self._role}.panel: the cell holds a grid of cells; add the panel to one of them"
            )
        size = track_spec(weight, Role(f"{self._role}.panel").field("weight"))
        made = self._make(
            id,
            title=title,
            x=x,
            y=y,
            y_right=y_right,
            camera=camera,
            style=style,
            zoom=zoom,
            pan=pan,
            brush=brush,
            bindings=bindings,
            limits=limits,
            rotate=rotate,
            drag=drag,
        )
        if self._content is None:
            self._content = _Stack()
        self._content.panels.append((made, size))
        return made

    def columns(
        self, widths: Tracks, *, gap: float | None = None, id: str | None = None
    ) -> list[Cell]:
        """Divides the cell into columns of ``widths`` (a count, or each
        one's size: weights, ``hg.Weight``, ``hg.Pixels``), left to right."""
        grid = self._grid(1, widths, gap, id, "columns", ("rows", "widths"))
        return [grid.cell(0, column) for column in range(len(grid._node.columns))]

    def rows(
        self, heights: Tracks, *, gap: float | None = None, id: str | None = None
    ) -> list[Cell]:
        """Divides the cell into rows of ``heights``, from the top."""
        grid = self._grid(heights, 1, gap, id, "rows", ("heights", "columns"))
        return [grid.cell(row, 0) for row in range(len(grid._node.rows))]

    def grid(
        self,
        *,
        rows: Tracks,
        columns: Tracks,
        gap: float | tuple[float, float] | None = None,
        id: str | None = None,
    ) -> GridCells:
        """Divides the cell into a grid of ``rows`` and ``columns``, whose
        cells span tracks as ``cell(row, column, row_span=, column_span=)`` says."""
        return self._grid(rows, columns, gap, id, "grid")

    def _grid(
        self,
        rows: Any,
        columns: Any,
        gap: Any,
        id: Any,
        method: str,
        names: tuple[str, str] = ("rows", "columns"),
    ) -> GridCells:
        """A grid of the cell, made by ``method`` from ``rows`` and
        ``columns``, which its caller `names` (``columns`` names its
        columns ``widths``)."""
        role = f"{self._role}.{method}"
        at = Role(role)
        if self._content is not None:
            what = "panels" if isinstance(self._content, _Stack) else "a grid of cells"
            raise ChartError(
                f"{role}: the cell holds {what} already; lay out an empty cell, or the cells "
                "it was divided into"
            )
        node = _GridNode(
            tracks_spec(rows, at.field(names[0])),
            tracks_spec(columns, at.field(names[1])),
            _gap(gap, at.field("gap"), pairs=method in ("grid", "mosaic")),
            _id(id, at.field("id")),
        )
        self._content = node
        return GridCells(node, self._make, role)

    def _content_spec(self) -> dict[str, Any] | None:
        return None if self._content is None else self._content._spec()


class GridCells:
    """A grid's cells, made with ``cell(row, column)``: each spans
    ``row_span`` rows and ``column_span`` columns (1 each by default), and
    may not overlap another."""

    def __init__(self, node: _GridNode, make: Callable[..., Panel], role: str) -> None:
        self._node = node
        self._make = make
        self._role = role
        self._made: dict[tuple[int, int, int, int], Cell] = {}

    def cell(self, row: int, column: int, *, row_span: int = 1, column_span: int = 1) -> Cell:
        """The cell at ``row`` and ``column`` (from 0), spanning ``row_span``
        rows and ``column_span`` columns; the same cell when asked again."""
        rows, columns = len(self._node.rows), len(self._node.columns)
        at = Role(f"{self._role}.cell")
        given = {"row": row, "column": column, "row_span": row_span, "column_span": column_span}
        for name, value in given.items():
            if name.endswith("_span") and not (_whole(value) and value >= 1):
                raise at.field(name).error(
                    f"expected a whole number of at least 1; received {shown(value)}"
                )
            if not (_whole(value) and value >= 0):
                raise at.field(name).error(
                    f"expected a whole number from 0; received {shown(value)}"
                )
        # As Python's ints before the sums below, which NumPy's would overflow,
        # and as the spec and the cells made are keyed by them.
        row, column, row_span, column_span = (int(v) for v in given.values())
        for name, index, count in (("row", row, rows), ("column", column, columns)):
            if index >= count:
                raise at.field(name).error(
                    f"{index} is past the grid's {count} {name}s; add {name}s or move the cell"
                )
        for name, span, start, count in (
            ("row_span", row_span, row, rows),
            ("column_span", column_span, column, columns),
        ):
            if start + span > count:
                raise at.field(name).error(f"reaches past the grid's {count} tracks; span fewer")
        key = (row, column, row_span, column_span)
        if key in self._made:
            return self._made[key]
        for r0, c0, rs, cs, _ in self._node.cells:
            if (
                r0 < row + row_span
                and row < r0 + rs
                and c0 < column + column_span
                and column < c0 + cs
            ):
                raise ChartError(
                    f"{self._role}.cell: the cell at row {row}, column {column} overlaps the one "
                    f"at row {r0}, column {c0}; cells of a grid cannot overlap; use an inset to "
                    "draw a panel over another"
                )
        made = Cell(self._make, f"{self._role}.cell")
        self._node.cells.append((row, column, row_span, column_span, made))
        self._made[key] = made
        return made


def mosaic_cells(
    layout: Sequence[Sequence[str | None]], role: str
) -> list[tuple[str, int, int, int, int]]:
    """The cells of a mosaic: each id's rectangle of rows of ids, ``None``
    for empty cells; ids must cover rectangles."""
    at = Role(role).field("layout")
    if not listlike(layout) or not all(listlike(row) for row in layout):
        raise at.error(f"expected rows of panel ids; received {shown(layout)}")
    rows = [list(row) for row in layout]
    if not rows or not rows[0]:
        raise at.error(f"expected rows of panel ids; received {shown(layout)}")
    width = len(rows[0])
    for i, row in enumerate(rows):
        if len(row) != width:
            raise at.index(i).error(
                f"expected {width} cells, as the first row has; received {len(row)}"
            )
        for j, value in enumerate(row):
            if value is not None and (not isinstance(value, str) or value == ""):
                raise (
                    at.index(i)
                    .index(j)
                    .error(f"expected a panel's id or None; received {shown(value)}")
                )
    cells: list[tuple[str, int, int, int, int]] = []
    seen: set[str] = set()
    for r0, row in enumerate(rows):
        for c0, value in enumerate(row):
            if value is None or value in seen:
                continue
            seen.add(value)
            c1 = c0
            while c1 + 1 < width and row[c1 + 1] == value:
                c1 += 1
            r1 = r0
            while r1 + 1 < len(rows) and rows[r1 + 1][c0] == value:
                r1 += 1
            for r, line in enumerate(rows):
                for c, other in enumerate(line):
                    inside = r0 <= r <= r1 and c0 <= c <= c1
                    if (other == value) != inside:
                        raise at.error(
                            f"panel {shown(value)} occupies a region that is not a "
                            "rectangle; give each panel a rectangle of cells"
                        )
            cells.append((value, r0, c0, r1 - r0 + 1, c1 - c0 + 1))
    return cells


__all__ = [
    "Cell",
    "Grid",
    "GridCells",
    "Track",
    "Tracks",
    "Weight",
    "inset_spec",
    "mosaic_cells",
    "track_spec",
    "tracks_spec",
]
