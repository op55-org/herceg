"""Charts: a Pythonic builder for the portable chart spec."""

from __future__ import annotations

import datetime as _dt
import functools
import inspect
import json
import math
import re
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from dataclasses import field as dataclass_field
from os import PathLike
from typing import (
    TYPE_CHECKING,
    Any,
    Concatenate,
    Literal,
    ParamSpec,
    Protocol,
    TypedDict,
    TypeVar,
    cast,
    get_args,
    overload,
)

import numpy as np

from . import _marks, _render
from ._colors import is_color
from ._data import UNTYPED, Column, Matrix, Table, listlike
from ._derive import (
    Derived,
    Expr,
    Ordered,
    RowGroups,
    RowTotals,
    View,
    _fields_of,
    _writes,
)
from ._encoding import (
    DataPosition,
    Duration,
    Fraction,
    LabelPart,
    Pixels,
    Position,
    axis_title_spec,
    choice_option,
    gap_spec,
    label_dict_problem,
    length_spec,
    output_problem,
)
from ._errors import (
    ChartError,
    Hint,
    Role,
    check_hints,
    checks_hints,
    hints_of,
    is_number,
    key_path,
    keys_shown,
    listed,
    located,
    python_path,
    refuses,
    refusing,
    renamed,
    shown,
)
from ._events import (
    ChartSelection,
    DrillRoot,
    ItemReference,
    SeriesReference,
    Viewport,
    VisibilityState,
    drill_root_option,
    reference_of,
    selection_option,
    viewport_option,
    visibility_option,
)
from ._fields import (
    AtThresholds,
    FieldDisplays,
    Match,
    TableName,
    fields_spec,
    link_needs,
    link_rules,
    writes,
)
from ._guides import (
    _NUMBER_FORMAT,
    _TIME_FORMAT,
    AXIS_SIDES,
    FORMS,
    ChannelScale,
    Format,
    GridLines,
    Guide,
    IdentityScale,
    LegendOptions,
    OrdinalScale,
    Padding,
    Room,
    Scale,
    Scope,
    Ticks,
    _check_format,
    axis_place,
    format_spec,
    grid_spec,
    guide_problem,
    guides_spec,
    legend_spec,
    padding_spec,
    position_domain,
    room_spec,
    scales_spec,
    scope_spec,
    ticks_spec,
)
from ._interaction import (
    SNAPS,
    Binding,
    Brush,
    Snap,
    Sync,
    ViewLimits,
    bindings_spec,
    brush_shape,
    brush_spec,
    limits_spec,
    panel_interaction_spec,
    preset_spec,
    select_spec,
    sync_spec,
)
from ._layout import (
    Cell,
    Grid,
    GridCells,
    InsetAnchor,
    InsetIndicator,
    Tracks,
    _gap,
    _Inset,
    inset_spec,
    mosaic_cells,
)
from ._marks.common import (
    _ANY,
    _NUMERIC,
    _WEEKDAYS,
    _check_method_options,
    _entries,
    _finite,
    _flag,
    _halo,
    _range,
)
from ._marks.maps import _JoinedShapes
from ._marks.networks import remaining_moves
from ._marks.tooltips import Tooltip
from ._rows import RowSelection, SelectionBinding
from ._rows import bindings as bindings_of
from ._series import series_of
from ._style import (
    AXIS_ROLES,
    PANEL_ROLES,
    HaloOption,
    Insets,
    Place,
    Style,
    Theme,
    ThemeName,
    Title,
    _built,
    insets,
    style_spec,
    theme_spec,
    title_spec,
    vertical_align_problem,
)

if TYPE_CHECKING:
    from .widget import ChartWidget

InspectionMode = Literal["nearest-x", "nearest-y", "nearest"]
Easing = Literal["cubic-out", "linear", "cubic-in-out"]


def _seams_spec(seams: Any) -> Any:
    """An axis's ``seams`` as the spec takes them."""
    if seams is None or isinstance(seams, bool):
        return seams
    if not isinstance(seams, Mapping) or any(key != "min_spacing" for key in seams):
        raise ChartError(
            "AxisOptions seams: expected True, False, or a dict with min_spacing; "
            f"received {shown(seams)}"
        )
    spacing = seams.get("min_spacing", 40)
    if (
        isinstance(spacing, bool)
        or not is_number(spacing)
        or not math.isfinite(spacing)
        or spacing <= 0
    ):
        raise (
            Role("AxisOptions")
            .field("seams")
            .field("min_spacing")
            .error(f"expected a finite, positive number of pixels; received {shown(spacing)}")
        )
    return {"minSpacing": float(seams["min_spacing"])} if seams else {}


class Seams(TypedDict, total=False):
    """How an axis marks its breaks: ``min_spacing``, the fewest pixels
    between two seams it draws (40 by default)."""

    min_spacing: float


#: Marks that draw a view's rows (``hg.view``); others take a table.
_VIEW_MARKS = frozenset(
    (
        *("line", "area", "bar", "point", "heatmap", "rug", "errorbar", "candlestick"),
        *("histogram", "boxplot", "boxen", "violin"),
    )
)


@dataclass(frozen=True)
class _RowPlaces:
    """A mark of rows' positions (see ``Chart._places``): the column each
    option reads, the coordinates given by option, and each direction's
    binding where it is not plainly its axis'."""

    columns: dict[str, str | Sequence[str]]
    specs: dict[str, dict[str, Any]]
    bound: dict[str, tuple[Any, ...]]

    def column(self, name: str) -> str | None:
        """The one column option ``name`` reads, if given: positions of several are values'."""
        return cast("str | None", self.columns.get(name))

    def spec(self, name: str, checked: Any) -> Any:
        """What the spec writes for option ``name``: its coordinate, or its checked column(s)."""
        return self.specs.get(name, checked)


# The spec format version charts are written in: the only one so far.
_SPEC_VERSION = 1


@refuses
@dataclass(frozen=True)
class Break:
    """Time a time axis leaves out, in the chart's ``time_zone``, so the time
    left (trading sessions) is drawn without gaps. Give exactly one of:

    - ``weekdays``: days of the week, ``("sat", "sun")``;
    - ``hours``: a daily span of wall-clock time, ``("16:00", "09:30")``
      (strings or ``datetime.time``), wrapping past midnight when it ends
      earlier than it starts; across a clock change, the instants whose
      wall-clock time is in it;
    - ``dates``: whole calendar days, as dates or ``"YYYY-MM-DD"`` strings;
    - ``start`` and ``end``: a span of instants (naive datetimes are UTC).

    Starts are included, ends are not. Data inside a break is not drawn;
    lines and areas join the points on either side.
    """

    weekdays: Sequence[str] | None = None
    hours: tuple[str | _dt.time, str | _dt.time] | None = None
    dates: Sequence[str | _dt.date] | None = None
    start: Any = None
    end: Any = None

    def _spec(self) -> dict[str, Any]:
        given = [
            name
            for name, value in (
                ("weekdays", self.weekdays),
                ("hours", self.hours),
                ("dates", self.dates),
                ("start", self.start),
            )
            if value is not None
        ]
        if len(given) != 1 and not (not given and self.end is not None):
            raise ChartError(
                "Break: expected one of weekdays, hours, dates, or start and end; "
                f"received {' and '.join(given) or 'none'}"
            )
        if self.weekdays is not None:
            days = (
                [self.weekdays]
                if isinstance(self.weekdays, str) or not listlike(self.weekdays)
                else list(self.weekdays)
            )
            bad = [day for day in days if day not in _WEEKDAYS]
            if not days or bad:
                raise ChartError(
                    f"Break weekdays: expected names from {listed(_WEEKDAYS)}; "
                    f"received {shown(self.weekdays)}"
                )
            return {"weekdays": days}
        if self.hours is not None:
            if not listlike(self.hours) or len(self.hours) != 2:
                raise ChartError(
                    'Break hours: expected two times of day, as ("16:00", "09:30"); '
                    f"received {shown(self.hours)}"
                )
            return {"hours": [_clock(value) for value in self.hours]}
        if self.dates is not None:
            dates: list[Any] = list(self.dates) if listlike(self.dates) else [self.dates]
            if not dates:
                raise ChartError(
                    f"Break dates: expected at least one date; received {shown(self.dates)}"
                )
            return {"dates": [_iso_date(value) for value in dates]}
        if self.start is None or self.end is None:
            raise ChartError("Break: a span of instants needs both start and end")
        start, end = _instant(self.start, "start"), _instant(self.end, "end")
        if not end > start:
            raise ChartError(
                f"Break end: expected an instant after start; received {shown(self.end)}"
            )
        return {"from": start, "to": end}


def _clock(value: str | _dt.time) -> str:
    """A time of day as "HH:MM"."""
    if isinstance(value, _dt.time):
        if value.second or value.microsecond:
            raise ChartError(f"Break hours: expected whole minutes; received {value!r}")
        return f"{value.hour:02d}:{value.minute:02d}"
    if not isinstance(value, str) or len(value.split(":")) != 2:
        raise ChartError(f'Break hours: expected times of day as "HH:MM"; received {shown(value)}')
    return value


def _iso_date(value: str | _dt.date) -> str:
    if isinstance(value, _dt.datetime):
        raise ChartError(f"Break dates: expected dates, not datetimes; received {value!r}")
    if isinstance(value, _dt.date):
        return value.isoformat()
    try:
        _dt.date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ChartError(
            f'Break dates: expected dates or "YYYY-MM-DD" strings; received {shown(value)}'
        ) from None
    if len(value) != 10:
        raise ChartError(
            f'Break dates: expected dates or "YYYY-MM-DD" strings; received {shown(value)}'
        )
    return value


def _instant(value: Any, role: str) -> int:
    """An instant as whole epoch milliseconds."""
    if is_number(value) and not isinstance(value, bool):
        ms = float(value)
    else:
        from ._data import _time_ms

        try:
            ms = _time_ms(value)
        except TypeError:
            raise ChartError(
                f"Break {role}: expected a number or a datetime; received {shown(value)}"
            ) from None
    if not (math.isfinite(ms) and ms == int(ms)):
        raise ChartError(f"Break {role}: expected a whole millisecond; received {shown(value)}")
    return int(ms)


def _break(rule: Break | dict[str, Any]) -> dict[str, Any]:
    if isinstance(rule, Break):
        return rule._spec()
    if isinstance(rule, dict):
        fields = dict(rule)
        # The spec's names for a span of instants, refused as they were given.
        aliased = "from" in fields or "to" in fields
        if aliased:
            fields["start"], fields["end"] = fields.pop("from", None), fields.pop("to", None)
        if any(key not in ("weekdays", "hours", "dates", "start", "end") for key in fields):
            raise ChartError(
                "AxisOptions breaks: expected keys weekdays, hours, dates, or from and to; "
                f"received {keys_shown(rule)}"
            )
        try:
            return Break(**fields)._spec()
        except ChartError as error:
            if not aliased:
                raise
            said = {"start": "from", "end": "to"}
            problem = str(error).split(": ", 1)[-1].replace("start and end", "from and to")
            role = Role("Break")
            raise (role.field(said[error.path]) if error.path in said else role).error(
                problem
            ) from None
    raise ChartError(
        f"AxisOptions breaks: expected hg.Break objects or dicts; received {shown(rule)}"
    )


@refuses
@dataclass
class AxisOptions:
    """Scale and axis options for x or y. Unset options use herceg's defaults.

    ``domain`` fixes the axis' ends, ``(low, high)`` (datetimes on a time
    axis), or on an axis of categories, the categories in the order their
    bands take. Each listed category keeps its band whether rows hold it or
    not, so bars stay in place as filters come and go; categories the list
    leaves out follow, in the order they take without it::

        hg.Chart(sales, x=hg.AxisOptions(domain=["North", "South", "East", "West"]))

    ``breaks``, on a time x axis only, leave out spans of time (see ``Break``)::

        hg.AxisOptions(
            breaks=[hg.Break(weekdays=("sat", "sun")), hg.Break(hours=("16:00", "09:30"))]
        )

    ``seams=True`` marks their collapsed boundaries with dashed vertical lines;
    ``seams={"min_spacing": 40}`` sets their minimum spacing in CSS pixels.

    ``format`` writes tick labels and tooltips' values, as Intl format options;
    ``tooltip_format`` writes one value of the axis in tooltips, the keyboard's
    announcements, and crosshair labels only, such as ``{"weekday": "short",
    "month": "short", "day": "numeric"}`` or ``{"style": "unit", "unit":
    "millisecond"}``.

    ``scope``, on the chart's ``x``, ``y``, and ``y_right`` only, says which
    facet panels or subplots share one instance of the axis' scale:
    ``"chart"`` (every panel but insets), ``"panel"`` (each its own),
    ``"row"`` or ``"column"`` (of a facet grid, or of the layout grid holding
    the subplots), ``{"layout": id, "by": "column"}`` (the subplots on the
    same columns, or rows, of the layout grid named ``id``), or
    ``{"panels": ["latency", "errors"]}``. By default subplots have scales of
    their own (x is the chart's with a ``navigator``), facets share them, and
    y_right is as y. A scale panels do not share takes its type from the
    marks of its own panels, so one subplot can show categories along y
    while another shows numbers. ``repeat`` says where panels sharing a
    scale label it: ``"outer"`` (the default) on the outer edge of panels
    lined up with each other, ``"all"`` on every panel. ``padding`` is the
    room the scale keeps around its data (see ``hg.Scale``), and ``grid``
    draws grid lines, or with ``hg.GridLines(z_index=...)`` places them
    among the marks.

    ``place``, on the chart's ``x`` and ``y`` only, moves the axis to the
    other side of the plots: ``hg.Place(side="top")`` for x,
    ``hg.Place(side="right")`` for y. ``room`` holds the axis' ticks and
    labels in that many pixels beside the plots, or ``(least, most)``, None
    for no bound (``(40, None)``): a y
    axis shortens labels wider than it with an ellipsis, and an x axis
    leaves out rows of labels that do not fit, the farthest from the plot
    first. A panel's own room holds its axis; unset, it is the chart's::

        hg.Chart(sales, x=hg.AxisOptions(place=hg.Place(side="top"), room=28))
    """

    type: Literal["linear", "log", "time"] | None = None
    domain: tuple[float | _dt.datetime, float | _dt.datetime] | Sequence[str] | None = None
    title: str | Sequence[str | LabelPart] | None = None
    nice: bool | None = None
    zero: bool | None = None
    padding: Padding | None = None
    grid: bool | GridLines | dict[str, Any] | None = None
    ticks: int | Ticks | dict[str, Any] | None = None
    format: Format | dict[str, Any] | None = None
    tooltip_format: Format | dict[str, Any] | None = None
    show: bool | None = None
    breaks: Sequence[Break | dict[str, Any]] | None = None
    seams: bool | Seams | None = None
    scope: Scope | None = None
    repeat: Literal["outer", "all"] | None = None
    place: Place | dict[str, Any] | None = None
    room: Room | None = None
    style: Style | dict[str, Any] | None = None

    def __post_init__(self) -> None:
        self.place = axis_place(self.place, "AxisOptions place", None)
        room_spec(self.room, "AxisOptions room")
        _seams_spec(self.seams)  # checked as made, before its hints are
        for name in ("format", "tooltip_format"):
            value = getattr(self, name)
            # Intl options as a dict of their names; other forms are hg.Format.
            if isinstance(value, dict) and not set(value) & FORMS:
                _check_format(value, f"AxisOptions {name}", _NUMBER_FORMAT | _TIME_FORMAT)
            elif isinstance(value, dict):
                format_spec(value, f"AxisOptions {name}")
        scope_spec(self.scope, "AxisOptions scope")
        padding_spec(self.padding, "AxisOptions padding")
        grid_spec(self.grid, "AxisOptions grid")
        if self.repeat is not None and self.repeat not in ("outer", "all"):
            raise ChartError(
                f'AxisOptions repeat: expected "outer" or "all"; received {shown(self.repeat)}'
            )

    def _spec(self) -> dict[str, Any]:
        seams = _seams_spec(self.seams)
        if seams is not None and seams is not False and self.breaks is None:
            raise ChartError(
                "AxisOptions seams: mark the breaks of a time x axis, and the axis has none; "
                "give breaks or drop seams"
            )
        if self.breaks is not None and (not listlike(self.breaks)):
            raise ChartError(
                f"AxisOptions breaks: expected a list of hg.Break; received {shown(self.breaks)}"
            )
        spec = {
            "type": choice_option(self.type, ("linear", "log", "time"), "AxisOptions type"),
            "domain": position_domain(self.domain, "AxisOptions domain", self.type),
            "title": axis_title_spec(self.title, "AxisOptions title"),
            "nice": _flag(self.nice, "AxisOptions nice"),
            "zero": _flag(self.zero, "AxisOptions zero"),
            "padding": padding_spec(self.padding, "AxisOptions padding"),
            "grid": grid_spec(self.grid, "AxisOptions grid"),
            "ticks": ticks_spec(self.ticks, "AxisOptions ticks"),
            "format": format_spec(self.format, "AxisOptions format"),
            "tooltipFormat": format_spec(self.tooltip_format, "AxisOptions tooltip_format"),
            "show": _flag(self.show, "AxisOptions show"),
            "breaks": [
                located(f"breaks[{i}]", functools.partial(_break, rule))
                for i, rule in enumerate(self.breaks)
            ]
            if self.breaks is not None
            else None,
            "seams": seams,
            "scope": scope_spec(self.scope, "AxisOptions scope"),
            "repeat": self.repeat,
            "place": {"side": self.place.side} if isinstance(self.place, Place) else None,
            "room": room_spec(self.room, "AxisOptions room"),
            "style": style_spec(self.style, "AxisOptions style", AXIS_ROLES),
        }
        return {key: value for key, value in spec.items() if value is not None}


ProjectionName = Literal[
    "equal-earth", "natural-earth", "mercator", "equirectangular", "conic-equal-area"
]
PROJECTIONS = ("equal-earth", "natural-earth", "mercator", "equirectangular", "conic-equal-area")


@refuses
@dataclass
class Projection:
    """How a map is projected (the chart's ``projection``).

    ``type`` is ``"equal-earth"`` (the default, for world maps),
    ``"natural-earth"``, ``"mercator"``, ``"equirectangular"``, or
    ``"conic-equal-area"`` (Albers, for countries and continents).
    ``central_meridian`` is the longitude at the map's center (0, or for the
    conic projection the middle of the data); ``parallels`` are the conic
    projection's standard parallels (by default a sixth of the data's
    latitudes in from either end). ``fit`` is what the map fits into its
    plot: ``"data"`` (the default), ``"world"``, or a box
    ``((west, south), (east, north))`` in degrees, whose west may lie east
    of its east to cross the antimeridian.
    """

    type: ProjectionName = "equal-earth"
    central_meridian: float | None = None
    parallels: tuple[float, float] | None = None
    fit: Literal["data", "world"] | tuple[tuple[float, float], tuple[float, float]] | None = None

    def _spec(self) -> dict[str, Any]:
        if self.type not in PROJECTIONS:
            raise ChartError(
                f"Projection type: expected {listed(PROJECTIONS)}; received {shown(self.type)}"
            )
        if self.central_meridian is not None and not _finite(self.central_meridian):
            raise ChartError(
                "Projection central_meridian: expected a finite longitude; "
                f"received {shown(self.central_meridian)}"
            )
        parallels = None
        if self.parallels is not None:
            parallels = _range(self.parallels, "Projection parallels", minimum=-90)
            if parallels is not None and parallels[1] > 90:
                raise ChartError(
                    "Projection parallels: expected latitudes from -90 to 90; "
                    f"received {self.parallels!r}"
                )
        fit: Any = self.fit
        if not (fit is None or (isinstance(fit, str) and fit in ("data", "world"))):
            try:
                (west, south), (east, north) = fit
                box = [[float(west), float(south)], [float(east), float(north)]]
            except (TypeError, ValueError):
                raise ChartError(
                    'Projection fit: expected "data", "world", or ((west, south), (east, north)); '
                    f"received {shown(fit)}"
                ) from None
            (west, south), (east, north) = box
            if not (
                all(map(math.isfinite, [west, south, east, north]))
                and abs(west) <= 540
                and abs(east) <= 540
                and -90 <= south < north <= 90
                and west != east
            ):
                raise ChartError(
                    "Projection fit: expected longitudes and latitudes in degrees, south below "
                    f"north and west apart from east; received {fit!r}"
                )
            fit = box
        spec = {
            "type": self.type,
            "centralMeridian": None
            if self.central_meridian is None
            else float(self.central_meridian),
            "parallels": parallels,
            "fit": fit,
        }
        return {key: value for key, value in spec.items() if value is not None}


@refuses
@dataclass
class InspectionOptions:
    """How the chart inspects: what the pointer reads, for the tooltip, the
    crosshair, and hover and click events (the chart's ``inspection``).

    ``mode`` "nearest-x" reads each series along x, "nearest-y" along y, and
    "nearest" the one point nearest the pointer on screen; by default one
    suited to the marks ("nearest-y" for bars along y, "nearest" for points,
    else "nearest-x"). Along an axis, ``snap`` says which point of each
    series is read: "shared" (the default), the value nearest the pointer
    that any series has, and every series' point there; "each", each
    series' own nearest point, the crosshair at the pointer; "previous",
    each series' last point at or before the pointer (an hourly series'
    10:00 for 10:37); "next", its first at or after it. ``within`` is how far
    from the pointer a point read may be, in the mode's units: along the
    axis, a number in its units or on a time axis a ``timedelta`` (or
    ``hg.Duration``); for "nearest", ``hg.Pixels(n)`` on screen. A series
    reads nothing inside a gap its ``continuity`` leaves. Cells (heatmaps)
    are read under the pointer whatever the mode::

        hg.Chart(metrics, inspection=hg.InspectionOptions(
            mode="nearest-x", snap="each", within=timedelta(seconds=30)))

    ``Chart(inspection=False)`` has the pointer read nothing; hover and click
    events still say what is under it, and the keyboard still reads and
    announces points.
    """

    mode: InspectionMode | None = None
    snap: Snap | None = None
    within: float | _dt.timedelta | np.timedelta64 | Duration | Pixels | None = None

    def __post_init__(self) -> None:
        choice_option(self.mode, get_args(InspectionMode), "InspectionOptions mode")
        choice_option(self.snap, SNAPS, "InspectionOptions snap")
        if self.mode == "nearest" and self.snap is not None:
            raise ChartError(
                'InspectionOptions snap: "nearest" reads one point; drop snap, or use '
                '"nearest-x" or "nearest-y"'
            )
        self._within()

    def _within(self) -> Any:
        role = "InspectionOptions within"
        if self.within is None:
            return None
        if self.mode is None:
            raise ChartError(
                f'{role}: its units are the mode\'s; give mode="nearest-x", "nearest-y", '
                'or "nearest"'
            )
        if self.mode == "nearest":
            if not isinstance(self.within, Pixels):
                raise ChartError(f'{role}: "nearest" measures on screen; give hg.Pixels(n)')
            return length_spec(self.within, role)
        if isinstance(self.within, Pixels):
            raise ChartError(
                f"{role}: {shown(self.mode)} measures along its axis; give a number, or a "
                "timedelta on a time axis"
            )
        return gap_spec(self.within, role, positive=False)

    def _spec(self) -> dict[str, Any]:
        spec = {"mode": self.mode, "snap": self.snap, "within": self._within()}
        return {key: value for key, value in spec.items() if value is not None}


@refuses
@dataclass
class Animation:
    """Animation options (the chart's ``animation``): ``duration`` in
    milliseconds, and ``values``, with which marks also move to changed
    values when a live chart's data is replaced, the axes with them, besides
    the axes moving to views asked for: bars (stacked, labeled, and
    histograms'), value labels and text, pie slices, gauges, sunbursts (and
    their drills), points, lines and areas along x (lines along y too) whose
    rows stay, error bars, candlesticks, regions, and heatmaps' and 2D
    histograms' cells, in every panel. Items are matched by ``item_key``,
    else by position (bars) or row: bars change places as categories change
    order or ranks change, keyed bars come and go past the end of their
    position axis, and labels count through the numbers between. A change
    arriving meanwhile moves on from what is drawn. Charts with box plots,
    boxen plots, violins, rugs, contours, dendrograms, treemaps, funnels,
    radars, Sankey diagrams, networks, maps, or 3D marks refuse ``values``
    as they draw. ``easing`` is how changes of view and of values, and
    drills, move over the duration, as d3's curves of these names:
    ``"cubic-out"`` (the default) starts fast and settles, ``"linear"``
    moves at an even pace (races, keyframes), and ``"cubic-in-out"`` speeds
    up, then settles. ``animation=True`` is ``Animation()``, and a number is
    a duration."""

    duration: float = 250
    values: bool = False
    easing: Easing = "cubic-out"

    def _spec(self) -> dict[str, Any]:
        if not (_finite(self.duration) and self.duration >= 0):
            raise ChartError(
                "Animation duration: expected milliseconds of at least 0; "
                f"received {shown(self.duration)}"
            )
        spec: dict[str, Any] = {"duration": self.duration}
        if _flag(self.values, "Animation values"):
            spec["values"] = True
        if self.easing not in get_args(Easing):
            raise ChartError(
                f"Animation easing: expected {listed(get_args(Easing))}; "
                f"received {shown(self.easing)}"
            )
        if self.easing != "cubic-out":
            spec["easing"] = self.easing
        return spec


@refuses
@dataclass
class Navigator:
    """A range navigator (the chart's ``navigator``): a strip under the plot
    drawing the chart's marks over the whole x axis, with a window showing
    the x range in view, which dragging and the keyboard move and resize.

    ``height`` is the strip's height in pixels (40 by default, at least 16,
    and at most a third of what the plots and the strip share; a chart too
    short to leave its plots room beside a 16-pixel strip has none);
    ``marks`` names the ``id`` of each mark the strip draws (by default every
    line, area, scatter, bar, and candlestick mark). ``navigator=True`` is
    ``Navigator()``. The chart needs a number or time x axis; with facets or
    panels, the strip goes under all of them and moves the x range they
    share, or with ``panel`` (a subplot's id, or a facet panel's key), that
    panel's x range, drawing the marks of the panels sharing it.
    """

    height: float | None = None
    marks: Sequence[str] | None = None
    halo: HaloOption | None = None
    panel: str | None = None

    def _spec(self) -> dict[str, Any]:
        spec: dict[str, Any] = {}
        if self.height is not None:
            if isinstance(self.height, bool) or not (_finite(self.height) and self.height >= 16):
                raise ChartError(
                    f"Navigator height: expected at least 16 pixels; received {shown(self.height)}"
                )
            spec["height"] = float(self.height)
        if self.marks is not None:
            if not listlike(self.marks) or not all(isinstance(m, str) for m in self.marks):
                raise ChartError(
                    f"Navigator marks: expected a list of mark ids; received {shown(self.marks)}"
                )
            ids = list(self.marks)
            repeated = next((m for i, m in enumerate(ids) if m in ids[:i]), None)
            if repeated is not None:
                raise ChartError(
                    f"Navigator marks: {shown(repeated)} is listed twice; list each mark once"
                )
            spec["marks"] = ids
        if self.halo is not None:
            spec["halo"] = _halo(self.halo, "Navigator")
        if self.panel is not None:
            if not isinstance(self.panel, str) or self.panel in ("", "*"):
                raise ChartError(
                    "Navigator panel: expected a panel's id (or a facet panel's key); "
                    f"received {shown(self.panel)}"
                )
            spec["panel"] = self.panel
        return spec


@refuses
@dataclass
class Camera:
    """Where a 3D chart is seen from at first (the chart's ``camera``).

    ``azimuth`` is the eye's direction around the vertical z axis, in degrees
    counterclockwise from +x seen from above; ``elevation`` its height above
    the floor, from -90 (from below) to 90 (from above). ``zoom`` magnifies
    the box (1 fits it in the chart; from 0.5 to 10), and ``perspective``
    draws nearer things larger instead of projecting orthographically.
    Dragging, the wheel (with ``zoom=True``), and the keyboard turn it after.
    """

    azimuth: float = -60
    elevation: float = 25
    zoom: float = 1
    perspective: bool = False

    def _spec(self) -> dict[str, Any]:
        if not _finite(self.azimuth):
            raise ChartError(
                "Camera azimuth: expected a finite number of degrees; "
                f"received {shown(self.azimuth)}"
            )
        if not (_finite(self.elevation) and -90 <= self.elevation <= 90):
            raise ChartError(
                "Camera elevation: expected degrees from -90 to 90; "
                f"received {shown(self.elevation)}"
            )
        if not (_finite(self.zoom) and 0.5 <= self.zoom <= 10):
            raise ChartError(
                f"Camera zoom: expected a number from 0.5 to 10; received {shown(self.zoom)}"
            )
        if not isinstance(self.perspective, bool):
            raise ChartError(
                f"Camera perspective: expected True or False; received {shown(self.perspective)}"
            )
        spec: dict[str, Any] = {
            "azimuth": float(self.azimuth),
            "elevation": float(self.elevation),
            "zoom": float(self.zoom),
        }
        if self.perspective:
            spec["perspective"] = True
        return spec


class _SharedButWidth(TypedDict, total=False):
    """The chart options every chart takes but ``width``, which ``hg.segment``'s
    segments take (see `SegmentOptions`)."""

    title: str | Title | dict[str, Any] | None
    description: str | None
    height: int | None
    y_right: AxisOptions | dict[str, Any] | None
    legend: bool | LegendOptions | dict[str, Any] | None
    scales: (
        Mapping[str, Scale | OrdinalScale | ChannelScale | IdentityScale | Mapping[str, Any]] | None
    )
    guides: Sequence[Guide] | None
    padding: float | Insets | None
    inspection: InspectionOptions | Literal[False] | None
    tooltip: bool | Tooltip | None
    zoom: bool | Literal["x", "y", "xy"] | None
    pan: bool | Literal["x", "y", "xy"] | None
    brush: Literal["x", "y", "xy", "lasso"] | Brush | None
    select: Literal["items", "series"] | None
    bindings: Sequence[Binding] | None
    limits: Mapping[str, ViewLimits] | None
    sync: str | Sync | None
    animation: bool | float | Animation | None
    renderer: Literal["auto", "svg", "canvas"] | None
    theme: ThemeName | Theme | dict[str, Any] | None
    locale: str | None
    time_zone: str | None
    projection: ProjectionName | Projection | dict[str, Any] | None
    camera: Camera | dict[str, Any] | None
    box_aspect: tuple[float, float, float] | None
    rotate: bool | None
    drag: bool | None
    toolbar: bool | None
    navigator: bool | Navigator | dict[str, Any] | None


class _SharedOptions(_SharedButWidth, total=False):
    width: int | None


class _DisplayOptions(TypedDict, total=False):
    """How the chart names columns and writes their values (``hg.FieldDisplay``)."""

    fields: FieldDisplays | None


class _LayoutOptions(TypedDict, total=False):
    facet: str | None
    facet_columns: int | None
    facet_row: str | None
    facet_column: str | None
    facet_header: bool | None
    facet_gap: float | tuple[float, float] | None
    panels: Sequence[Panel | str] | None


class _BindingOptions(TypedDict, total=False):
    row_selection: SelectionBinding | Sequence[SelectionBinding] | None


class _StateOptions(TypedDict, total=False):
    """The chart's first state, which its use changes: live, the widget's
    ``selection``, ``viewport``, ``hidden_keys``, and ``drill_root``."""

    selection: ChartSelection | None
    viewport: Viewport | None
    visibility: VisibilityState | Sequence[str] | None
    drill_root: DrillRoot | str | None


class ChartUpdate(_SharedOptions, _DisplayOptions, total=False):
    """Chart options a live chart can change (``widget.update``): those of
    ``Chart`` but data, facets, and panels. ``None`` takes an option's default."""

    x: AxisOptions | dict[str, Any] | None
    y: AxisOptions | dict[str, Any] | None
    z: AxisOptions | dict[str, Any] | None


class ChartOptions(ChartUpdate, _LayoutOptions, _BindingOptions, _StateOptions, total=False):
    """``Chart``'s keyword arguments. ``None`` takes an option's default."""

    layout: Grid | Mapping[str, Any] | None


class _HelperAxes(TypedDict, total=False):
    x_axis: AxisOptions | dict[str, Any] | None
    y_axis: AxisOptions | dict[str, Any] | None
    z_axis: AxisOptions | dict[str, Any] | None


class RadarOptions(
    _SharedOptions, _LayoutOptions, _BindingOptions, _StateOptions, _HelperAxes, total=False
):
    """Chart options as ``hg.radar`` takes them, after its own: the
    helpers' (``HelperOptions``) but ``fields``, which are its spokes; give
    the chart's field displays as ``hg.Chart(data, fields=...).radar(...)``."""


class SegmentOptions(
    _SharedButWidth,
    _LayoutOptions,
    _BindingOptions,
    _StateOptions,
    _HelperAxes,
    _DisplayOptions,
    total=False,
):
    """Chart options as ``hg.segment`` takes them, after its own: the
    helpers' (``HelperOptions``) but ``width``, which is its segments'; give
    the chart's as ``hg.Chart(data, width=...).segment(...)``."""


class HelperOptions(RadarOptions, _DisplayOptions, total=False):
    """Chart options as the one-call helpers (``hg.line``, ``hg.scatter``, ...)
    take them, after their own: ``x_axis``, ``y_axis``, and ``z_axis`` are the
    chart's ``x``, ``y``, and ``z``, since the helpers' ``x``, ``y``, and ``z``
    name columns."""


_P = ParamSpec("_P")
_R = TypeVar("_R")
_T = TypeVar("_T")


def _settings(owner: str) -> Callable[[Callable[_P, _R]], Callable[_P, _R]]:
    """Makes a method's refusals of its arguments (``Panel.inset width:
    ...``) ChartErrors at the argument, checked by their type hints first."""

    def decorate(function: Callable[_P, _R]) -> Callable[_P, _R]:
        settings = set(inspect.signature(function).parameters) - {"self"}
        hinted = checks_hints(owner)(function)

        @functools.wraps(function)
        def method(*args: _P.args, **kwargs: _P.kwargs) -> _R:
            with refusing((owner,), settings):
                return cast("_R", hinted(*args, **kwargs))

        return method

    return decorate


def _output_settings(function: Callable[_P, _R]) -> Callable[_P, _R]:
    """Makes an output's refusals of its settings (``to_svg sizing: ...``)
    ChartErrors at the setting they name, as the chart's of its options."""
    settings = set(inspect.signature(function).parameters) - {"self"}
    hinted = checks_hints(function.__name__)(function)

    @functools.wraps(function)
    def output(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        with refusing((function.__name__,), settings):
            try:
                return hinted(*args, **kwargs)
            except ChartError as error:
                raise in_python(error, cast(Chart, args[0])) from None

    return output


# Where the engine's refusals of a spec begin: at the path they refuse,
# description or marks[1].strokeWidth.
_SPEC_LOCATION = re.compile(r"(?:marks\[(\d+)\]\.?)?([^:]*): ")


def in_python(error: ChartError, chart: Chart) -> ChartError:
    """The engine's refusal of a chart's spec located as Python's own are:
    ``marks[1].strokeWidth: ...`` as ``line stroke_width: ...``, and
    ``description: ...`` as ``Chart description: ...``, for a message that
    starts at the path it refuses."""
    found = _SPEC_LOCATION.match(str(error))
    if found is None or python_path(found.group(0)[:-2]) != error.path:
        return error
    index, rest = found.groups()
    kinds = [spec["type"] for spec, _ in chart._marks]
    if index is None:
        where = f"Chart {python_path(rest)}"
    elif int(index) < len(kinds):
        where = " ".join(filter(None, (_method(kinds[int(index)]), python_path(rest))))
    else:
        return error
    return ChartError.from_info(error.info(), f"{where}: {str(error)[found.end() :]}")


class Chart:
    """A chart: data, marks drawn in order, and options.

    Marks are added with methods that return the chart, so calls chain::

        chart = (
            hg.Chart(df, title="Latency", y=hg.AxisOptions(title="ms"))
            .line(x="time", y=["p50", "p99"])
            .rule(y=250, label="SLO")
        )

    ``data`` is any table herceg reads (pandas, Polars, or PyArrow tables, a
    mapping of column names to arrays, or a list of records); marks use it
    unless they pass their own ``data``.
    """

    @_check_method_options
    def __init__(
        self,
        data: Any = None,
        *,
        title: str | Title | dict[str, Any] | None = None,
        description: str | None = None,
        fields: FieldDisplays | None = None,
        width: int | None = None,
        height: int | None = None,
        x: AxisOptions | dict[str, Any] | None = None,
        y: AxisOptions | dict[str, Any] | None = None,
        y_right: AxisOptions | dict[str, Any] | None = None,
        facet: str | None = None,
        facet_columns: int | None = None,
        facet_row: str | None = None,
        facet_column: str | None = None,
        facet_header: bool | None = None,
        facet_gap: float | tuple[float, float] | None = None,
        panels: Sequence[Panel | str] | None = None,
        layout: Grid | Mapping[str, Any] | None = None,
        legend: bool | LegendOptions | dict[str, Any] | None = None,
        scales: Mapping[
            str, Scale | OrdinalScale | ChannelScale | IdentityScale | Mapping[str, Any]
        ]
        | None = None,
        guides: Sequence[Guide] | None = None,
        padding: float | Insets | None = None,
        inspection: InspectionOptions | Literal[False] | None = None,
        tooltip: bool | Tooltip | None = True,
        zoom: bool | Literal["x", "y", "xy"] | None = False,
        pan: bool | Literal["x", "y", "xy"] | None = None,
        brush: Literal["x", "y", "xy", "lasso"] | Brush | None = None,
        select: Literal["items", "series"] | None = None,
        bindings: Sequence[Binding] | None = None,
        limits: Mapping[str, ViewLimits] | None = None,
        sync: str | Sync | None = None,
        animation: bool | float | Animation | None = False,
        renderer: Literal["auto", "svg", "canvas"] | None = None,
        theme: ThemeName | Theme | dict[str, Any] | None = None,
        locale: str | None = None,
        time_zone: str | None = None,
        projection: ProjectionName | Projection | dict[str, Any] | None = None,
        z: AxisOptions | dict[str, Any] | None = None,
        camera: Camera | dict[str, Any] | None = None,
        box_aspect: tuple[float, float, float] | None = None,
        rotate: bool | None = True,
        drag: bool | None = None,
        toolbar: bool | None = True,
        navigator: bool | Navigator | dict[str, Any] | None = None,
        row_selection: SelectionBinding | Sequence[SelectionBinding] | None = None,
        selection: ChartSelection | None = None,
        viewport: Viewport | None = None,
        visibility: VisibilityState | Sequence[str] | None = None,
        drill_root: DrillRoot | str | None = None,
    ) -> None:
        if facet_columns is not None and facet is None:
            raise ChartError("Chart facet_columns: wraps the panels of facet; give facet")
        for name, given in (("facet_header", facet_header), ("facet_gap", facet_gap)):
            if given is not None and facet is None and facet_row is None and facet_column is None:
                raise ChartError(
                    f"Chart {name}: spaces the panels of facet; give facet, facet_row, "
                    "or facet_column"
                )
        if facet_header is not None and not isinstance(facet_header, bool):
            raise ChartError(
                f"Chart facet_header: expected True or False; received {shown(facet_header)}"
            )
        if facet is not None and (facet_row is not None or facet_column is not None):
            raise ChartError(
                "Chart facet: facet, or facet_row and facet_column, not both; drop one"
            )
        if panels is not None and (
            not listlike(panels) or not all(isinstance(p, (str, Panel)) for p in panels)
        ):
            raise ChartError(
                f"Chart panels: expected a list of panel ids or hg.Panel; received {shown(panels)}"
            )
        given_panels = () if panels is None else panels
        panel_list = [Panel(p) if isinstance(p, str) else p for p in given_panels]
        for i, panel in enumerate(panel_list):
            _check_panel(panel, f"panels[{i}]")
        if panels is not None and not panel_list:
            raise ChartError(f"Chart panels: expected at least one panel; received {panels!r}")
        ids = [p.id for p in panel_list]
        bad = [i for i in ids if not isinstance(i, str) or i in ("", "*")]
        if bad:
            raise ChartError(
                'Chart panels: expected ids that are names other than "" and "*"; '
                f"received {shown(bad[0])}"
            )
        if len(set(ids)) != len(ids):
            repeated = next(i for n, i in enumerate(ids) if i in ids[:n])
            raise ChartError(
                f"Chart panels: {shown(repeated)} names two panels; give each panel its own id"
            )
        if layout is not None and not panel_list:
            raise ChartError(
                "Chart layout: places the chart's panels, and it has none; give panels, or "
                "lay panels out with chart.columns, rows, grid, or mosaic"
            )
        layout_spec = located("layout", lambda: _layout_option(layout))
        if panel_list and (facet is not None or facet_row is not None or facet_column is not None):
            raise ChartError("Chart panels: facets or panels, not both; drop one")
        axes = {"x": x, "y": y, "y_right": y_right, "scales": scales}
        # One window shows one x range: every panel's, or the named panel's.
        x_scope = axis_scope(axes, "x")
        strip = located("navigator", lambda: _navigator(navigator), "Navigator")
        targets = isinstance(strip, Mapping) and "panel" in strip
        if strip is not None and not targets and x_scope not in (None, "chart"):
            raise ChartError(
                "Chart navigator: moves the x scale every panel shares, and x's scope is "
                f"{shown(x_scope)}; name the panel whose x it moves, as "
                'hg.Navigator(panel="latency"), or give x scope "chart"'
            )
        located("animation", lambda: _animation(animation), "Animation")
        if facet_row is not None and facet_row == facet_column:
            raise ChartError(
                f"Chart facet_column: {facet_column!r} is facet_row too; "
                "facet rows and columns by different fields"
            )
        # bool is an int in Python, but True columns would be meaningless.
        if facet_columns is not None and not (
            isinstance(facet_columns, int)
            and not isinstance(facet_columns, bool)
            and facet_columns >= 1
        ):
            raise ChartError(
                "Chart facet_columns: expected a whole number of at least 1; "
                f"received {shown(facet_columns)}"
            )
        self._facet = facet
        self._facet_columns = facet_columns
        self._facet_row = facet_row
        self._facet_column = facet_column
        # Headers drawn unless False, and the gaps between panels: pixels, or (row, column).
        self._facet_spacing = {
            "header": facet_header,
            "gap": _gap(facet_gap, Role("Chart facet_gap", "facet_gap")),
        }
        # The fields that split rows into panels.
        self._facets = [f for f in (facet, facet_row, facet_column) if f is not None]
        self._panels = panel_list
        # The layout given (`layout=`), or the one the chart's methods build cell by cell.
        self._layout = layout_spec
        self._root: Cell | None = None
        # Legends of panels (`panel.legend`), after the chart's `guides`.
        self._panel_guides: list[Guide] = []
        # The options of the mark being added and their type hints, checked as it is added.
        self._unchecked: tuple[str, Mapping[str, Any], Mapping[str, Hint]] | None = None
        self._tables: list[tuple[Any, _Columns]] = []
        # Derived tables by index, with the index of the table they derive from.
        self._derived: dict[int, int] = {}
        # Tables made from another (statistics express computes), by index,
        # with the index of that table: their columns stand for its (the spec's `origin`).
        self._origins: dict[int, int] = {}
        # Whether tables marks add are made from the chart's data (express charts).
        self._made_from_data = False
        # Data the chart's table was computed from (an express function's input),
        # which field displays' matches name as that table.
        self._computed_from: Any = None
        self._default = self._table(data) if data is not None else None
        self._marks: list[tuple[dict[str, Any], int | None]] = []
        # The nodes table of each network, by the network's place in `_marks`.
        self._node_tables: dict[int, int] = {}
        # Tables of features joined with rows of data, by table, for live updates.
        self._joins: dict[int, _JoinedShapes] = {}
        # The keyword arguments as given, so live charts can change some later.
        self._settings: dict[str, Any] = {
            "title": title,
            "description": description,
            "fields": fields,
            "width": width,
            "height": height,
            "x": x,
            "y": y,
            "y_right": y_right,
            "legend": legend,
            "scales": scales,
            "guides": guides,
            "padding": padding,
            "inspection": inspection,
            "tooltip": tooltip,
            "zoom": zoom,
            "pan": pan,
            "brush": brush,
            "select": select,
            "bindings": bindings,
            "limits": limits,
            "sync": sync,
            "animation": animation,
            "renderer": renderer,
            "theme": theme,
            "locale": locale,
            "time_zone": time_zone,
            "projection": projection,
            "z": z,
            "camera": camera,
            "box_aspect": box_aspect,
            "rotate": rotate,
            "drag": drag,
            "toolbar": toolbar,
            "navigator": navigator,
            "selection": selection,
            "viewport": viewport,
            "visibility": visibility,
            "drill_root": drill_root,
        }
        self._options = spec_options(self._settings)
        # Bindings to channels of row selections, one per table (see SelectionBinding).
        self._row_selection = bindings_of(row_selection)
        # Bindings given in a list are refused at their index.
        self._bindings_listed = not isinstance(row_selection, SelectionBinding)
        # A brush bound to zoom cannot select rows too.
        bindings_spec(
            bindings,
            _CHART.field("bindings"),
            brushes_rows=any("brush" in binding.events for binding in self._row_selection),
        )

    # Layout ----------------------------------------------------------------

    @checks_hints("Chart.columns")
    def columns(
        self, widths: Tracks, *, gap: float | None = None, id: str | None = None
    ) -> list[Cell]:
        """Lays the chart's panels out in columns of ``widths`` (a count, or
        each column's size: weights, ``hg.Weight(2, min=200)``, or
        ``hg.Pixels(220)``), left to right; each cell returned holds the
        panels its ``panel()`` makes, from the top, or columns and rows of
        its own::

            left, right = chart.columns([2, 1])
            left.panel("latency", weight=2, title="p99").line(x="time", y="p99")
            left.panel("errors", title="Errors").bar(x="time", y="errors")
            right.panel("share", title="By region").pie("region", "requests")

        Sizes are of the panels' plots, as matplotlib's ratios are: titles,
        axes, and legends take room beside them. Panels have scales of their
        own unless a scale's ``scope`` shares them."""
        return self._lay_out("Chart.columns", lambda cell: cell.columns(widths, gap=gap, id=id))

    @checks_hints("Chart.rows")
    def rows(
        self, heights: Tracks, *, gap: float | None = None, id: str | None = None
    ) -> list[Cell]:
        """Lays the chart's panels out in rows of ``heights``, from the top
        (see ``columns``)."""
        return self._lay_out("Chart.rows", lambda cell: cell.rows(heights, gap=gap, id=id))

    @checks_hints("Chart.grid")
    def grid(
        self,
        *,
        rows: Tracks,
        columns: Tracks,
        gap: float | tuple[float, float] | None = None,
        id: str | None = None,
    ) -> GridCells:
        """Lays the chart's panels out in a grid of ``rows`` and
        ``columns`` (see ``columns`` for their sizes), whose cells span
        tracks::

            grid = chart.grid(rows=[2, 1], columns=[2, 1])
            grid.cell(0, 0).panel("latency")
            grid.cell(1, 0).panel("errors")
            grid.cell(0, 1, row_span=2).panel("share")
        """
        return self._lay_out(
            "Chart.grid", lambda cell: cell.grid(rows=rows, columns=columns, gap=gap, id=id)
        )

    @checks_hints("Chart.mosaic")
    def mosaic(
        self,
        layout: Sequence[Sequence[str | None]],
        *,
        rows: Tracks | None = None,
        columns: Tracks | None = None,
        gap: float | tuple[float, float] | None = None,
        id: str | None = None,
        panels: Mapping[str, Panel] | None = None,
    ) -> dict[str, Panel]:
        """Lays the chart's panels out as rows of panel ids, as matplotlib's
        ``subplot_mosaic`` does: an id repeated over a rectangle spans it,
        and ``None`` leaves a cell empty. Returns the panels by id; ``panels``
        gives some of them their settings (``hg.Panel`` objects, whose ids
        are the keys)::

            panels = chart.mosaic([["latency", "share"], ["errors", "share"]],
                                  rows=[2, 1], columns=[2, 1])
            panels["latency"].line(x="time", y="p99")
        """
        role = "Chart.mosaic"
        cells = mosaic_cells(layout, role)
        if panels is not None and not isinstance(panels, Mapping):
            raise ChartError(
                f"{role} panels: expected a dict of hg.Panel by their ids; "
                f"received {shown(panels)}",
                path="panels",
            )
        given = dict(panels or {})
        at = Role(role).field("panels")
        for key, panel in given.items():
            if not isinstance(panel, Panel):
                raise at.key(str(key)).error(f"expected an hg.Panel; received {shown(panel)}")
            if panel.id != key:
                raise at.key(key).error(
                    f"the panel's id is {shown(panel.id)}; give it the id of its key"
                )
        unknown = [key for key in given if key not in {cell[0] for cell in cells}]
        if unknown:
            raise at.key(unknown[0]).error(
                "is in no cell of the mosaic; place it or drop its settings",
                code="unknown-reference",
            )

        def lay(root: Cell) -> dict[str, Panel]:
            grid = root._grid(
                rows if rows is not None else len(layout),
                columns if columns is not None else len(layout[0]),
                gap,
                id,
                "mosaic",
            )
            out: dict[str, Panel] = {}
            for name, row, column, row_span, column_span in cells:
                cell = grid.cell(row, column, row_span=row_span, column_span=column_span)
                settings = given.get(name) or Panel(name)
                out[name] = cell.panel(
                    name,
                    title=settings.title,
                    x=settings.x,
                    y=settings.y,
                    y_right=settings.y_right,
                    camera=settings.camera,
                    style=settings.style,
                    zoom=settings.zoom,
                    pan=settings.pan,
                    brush=settings.brush,
                    bindings=settings.bindings,
                    limits=settings.limits,
                )
            return out

        return self._lay_out(role, lay)

    def _lay_out(self, role: str, lay: Callable[[Cell], _R]) -> _R:
        """What ``lay`` makes of the chart's layout, as cells to lay out:
        refused where the chart has facets, panels of its own, or a layout
        already. A layout refused leaves the chart as it was."""
        if self._facets:
            raise ChartError(
                f"{role}: lays out panels, and the chart has facets; facets or panels, not both"
            )
        if self._layout is not None or (self._panels and self._root is None):
            raise ChartError(
                f"{role}: the chart's panels and layout are given (panels=, layout=); lay them "
                "out there, or make every panel with the chart's columns, rows, grid, or mosaic"
            )
        if self._root is not None:
            raise ChartError(
                f"{role}: the chart is laid out already; lay out one of the cells it was "
                "divided into"
            )
        unplaced = next(
            (i for i, (mark, _) in enumerate(self._marks) if mark.get("panel") is None), None
        )
        if unplaced is not None:
            raise ChartError(
                f"{role}: the chart's {_method(self._marks[unplaced][0]['type'])} names no panel; "
                "lay out the panels first, then add marks through them (panel.line(...))"
            )
        root = Cell(self._new_panel, "Chart")
        try:
            out = lay(root)
        except BaseException:
            self._panels.clear()  # It had none: the panels it made are dropped.
            raise
        self._root = root
        return out

    def _new_panel(
        self,
        id: str | None,
        *,
        title: Any = None,
        x: Any = None,
        y: Any = None,
        y_right: Any = None,
        camera: Any = None,
        style: Any = None,
        zoom: Any = None,
        pan: Any = None,
        brush: Any = None,
        bindings: Any = None,
        limits: Any = None,
        rotate: Any = None,
        drag: Any = None,
    ) -> Panel:
        """A panel of the chart's layout, bound to it so that it takes marks;
        its id given, or its place among the chart's panels."""
        taken = {panel.id for panel in self._panels}
        if id is None:
            n = len(self._panels) + 1
            id = f"panel-{n}"
            k = 2
            while id in taken:
                id, k = f"panel-{n}-{k}", k + 1
        elif not isinstance(id, str) or id in ("", "*"):
            raise ChartError(
                f'Panel id: expected a name other than "" and "*"; received {shown(id)}',
                path=f"panels[{len(self._panels)}].id",
            )
        elif id in taken:
            raise ChartError(
                f"Panel id: {shown(id)} names two panels; give each panel its own id",
                path=f"panels[{len(self._panels)}].id",
            )
        made = located(
            f"panels[{len(self._panels)}]",
            lambda: Panel(
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
            ),
        )
        # Refuses settings the spec cannot take, here rather than at output.
        _check_panel(made, f"panels[{len(self._panels)}]")
        made._chart = self
        self._panels.append(made)
        return made

    # Marks -----------------------------------------------------------------
    # Each family's methods, and the helpers only they use, are written in its
    # module of herceg/_marks and bound here; a new mark's method is bound
    # here and on Panel (see _in_panel).

    # Series (_marks/series.py)
    line = _marks.series.line
    area = _marks.series.area
    bar = _marks.series.bar
    point = _marks.series.point
    rug = _marks.series.rug
    errorbar = _marks.series.errorbar
    candlestick = _marks.series.candlestick
    segment = _marks.series.segment
    _oriented = _marks.series._oriented
    _check_dodge = _marks.series._check_dodge
    _single_or_series = _marks.series._single_or_series
    _series_labels = _marks.series._series_labels
    _check_series_style = _marks.series._check_series_style
    _require_many = _marks.series._require_many
    _symbol = _marks.series._symbol
    _check_point_channels = _marks.series._check_point_channels

    # Distributions (_marks/distributions.py)
    histogram = _marks.distributions.histogram
    boxplot = _marks.distributions.boxplot
    boxen = _marks.distributions.boxen
    violin = _marks.distributions.violin
    _distribution = _marks.distributions._distribution

    # Matrices (_marks/matrices.py)
    heatmap = _marks.matrices.heatmap
    contour = _marks.matrices.contour
    dendrogram = _marks.matrices.dendrogram

    # Annotations (_marks/annotations.py)
    rule = _marks.annotations.rule
    region = _marks.annotations.region
    text = _marks.annotations.text
    _annotation_table = _marks.annotations._annotation_table
    _check_following_fields = _marks.annotations._check_following_fields

    # Layout marks (_marks/layouts.py)
    pie = _marks.layouts.pie
    gauge = _marks.layouts.gauge
    funnel = _marks.layouts.funnel
    treemap = _marks.layouts.treemap
    sunburst = _marks.layouts.sunburst
    radar = _marks.layouts.radar
    sankey = _marks.layouts.sankey
    _tree = _marks.layouts._tree
    _tree_labels = _marks.layouts._tree_labels

    # Networks (_marks/networks.py)
    graph = _marks.networks.graph
    _network_size = _marks.networks._network_size

    # Maps (_marks/maps.py)
    geoshape = _marks.maps.geoshape
    geopoint = _marks.maps.geopoint

    # 3D (_marks/three_d.py)
    point_3d = _marks.three_d.point_3d
    line_3d = _marks.three_d.line_3d
    surface = _marks.three_d.surface

    def _remaining_moves(self, positions: Mapping[str, Any]) -> dict[str, Any]:
        """Moved network nodes without those the chart's data no longer has (see
        `remaining_moves`)."""
        default = self._table_names()[self._default][1] if self._default is not None else None
        return remaining_moves(
            positions, self._mark_specs(), self._used_columns(), self._derived_specs(), default
        )

    # Where layout marks, maps, and 3D marks can draw: the chart's panels,
    # facets, and settings decide.

    def _layout_place(self, kind: str) -> None:
        """Layout marks (pies, treemaps, sunbursts, gauges, funnels, radars, Sankey
        diagrams, graphs) have no axes to zoom: they have their chart to
        themselves, or a facet panel each, or a panel of their own (see ``_add``).
        A treemap or sunburst drills with ``zoom=True``; a network pans and
        zooms its layout plane, lassos nodes, moves them with ``drag=True``,
        and selects rows. With panels, which options panels with axes take is
        checked once every mark is added (see ``to_spec``)."""
        if self._row_selection and kind not in _SELECTING_LAYOUT_MARKS:
            raise ChartError(
                f"Chart row_selection: a {kind} cannot select rows yet; marks along x "
                "and y can, as can maps, pies, funnels, treemaps, sunbursts, Sankey "
                "diagrams, and networks"
            )
        if not self._panels:
            _check_alone(self._settings, kind)

    def _map_place(self, kind: str) -> None:
        """Maps zoom and pan both ways (``zoom=True`` or ``"xy"``), take a
        ``"lasso"`` brush, select rows, and sync nothing; with panels, which
        options panels with axes take is checked once every mark is added."""
        if not self._panels:
            _check_alone(self._settings, kind)

    def _check_3d(self, kind: str) -> None:
        """3D marks use a chart or subplot; only standalone charts restrict axis interaction."""
        if self._facets:
            raise ChartError(
                f"{kind} facet: 3D marks cannot split into facets; use separate marks in panels"
            )
        if self._row_selection:
            raise ChartError(
                f"Chart row_selection: a {kind} cannot select rows yet; marks along x and y can"
            )
        if self._panels:
            return
        used = next(
            (name for name in ("pan", "brush", "limits", "sync") if self._settings.get(name)), None
        )
        if used is not None:
            raise ChartError(f"Chart {used}: a {kind} has no x axis to act on; drop {used}")
        if self._settings.get("zoom") not in (True, False, None):
            raise ChartError(
                "Chart zoom: 3D charts zoom their camera with zoom=True; "
                f"received {shown(self._settings['zoom'])}"
            )

    # Output ----------------------------------------------------------------

    @overload
    def reference_of(self, kind: Literal["series"], key: str) -> SeriesReference | None: ...
    @overload
    def reference_of(self, kind: Literal["item"], key: str) -> ItemReference | None: ...
    @checks_hints("Chart.reference_of")
    def reference_of(
        self, kind: Literal["series", "item"], key: str
    ) -> SeriesReference | ItemReference | None:
        """What a key from an event names, as references name it: a series
        key (a ``select`` event's series, a legend entry's) as
        ``hg.SeriesReference``, an item key (a target's ``item``, a ``select``
        event's items) as ``hg.ItemReference`` (a row without ``item_key``,
        its identity's parts). ``kind`` says which the key is: the two can be
        the same text. None for a key of no mark of the chart, of a mark
        without an ``id`` (references name marks by id), and for groups' keys
        (networks', maps', 3D points'). It decodes the key; it reads no
        data."""
        ids = {mark["id"] for mark, _ in self._marks if isinstance(mark.get("id"), str)}
        return reference_of(kind, key, ids, "Chart.reference_of")

    def to_spec(self) -> tuple[dict[str, Any], list[bytes]]:
        """The portable chart spec and the binary buffers its columns reference."""
        # What the chart checks of itself whole refuses as its options do.
        with refusing(("Chart",), OPTIONS):
            return self._whole_spec()

    def _whole_spec(self) -> tuple[dict[str, Any], list[bytes]]:
        self._check_spec()
        columns = self._used_columns()
        spec, buffers = assemble_spec(
            self._spec_options(),
            self._layout_spec(),
            columns,
            self._mark_specs(),
            self._derived_specs(),
            self._matrices(),
            {
                table_name(table): table_name(origin)
                for table, origin in self._origins.items()
                if table_name(table) in columns and table_name(origin) in columns
            },
            self._ordered_specs(),
        )
        _check_axes(spec)
        _check_legend_keys(spec)
        _check_colorbars(spec)
        if any(mark["type"] in _MARKS_3D for mark in spec["marks"]):
            _refuse_depth(spec)
        return spec, buffers

    def _layouts(self) -> list[dict[str, Any]]:
        """The specs of the chart's layout marks, in order."""
        return [mark for mark, _ in self._marks if mark["type"] in _LAYOUT_MARKS]

    def _check_spec(self) -> None:
        """What the browser checks of the whole chart once every mark is added,
        before a spec of it is made or a live chart shows it."""
        self._check_scale_references()
        if self._panels:
            loose = next((m for m, _ in self._marks if m.get("panel") is None), None)
            if loose is not None:
                raise ChartError(
                    f'{_method(loose["type"])} panel: expected the id of a panel, or "*" for every '
                    "panel; received None"
                )
        layouts = self._layouts()
        check_layout_options(self._settings, layouts, len(self._panels))
        # Marks placed by items need the layout mark drawn beside them.
        ids = {mark.get("id") for mark in layouts}
        for k, (mark, _) in enumerate(self._marks):
            missing = next((id for id in _item_marks(mark) if id not in ids), None)
            if missing is not None:
                method = _method(mark["type"])
                raise ChartError(
                    f"{method} item mark: no layout mark has id {shown(missing)}; draw the "
                    f"{method} beside the pie, funnel, treemap, or sunburst it follows, in its "
                    "chart or panel",
                    code="unknown-reference",
                    path=f"marks[{k}]",
                    mark=mark.get("id", k),
                )
        maps = [mark for mark in layouts if mark["type"] in _MAP_MARKS]
        if self._facets and maps and all(mark.get("facet") == "repeat" for mark in maps):
            raise ChartError(
                f"{maps[0]['type']} facet: every layer of the map repeats, so none splits into "
                'facet panels; drop facet="repeat" from one'
            )
        if self._settings.get("projection") is not None and not any(
            mark["type"] in _MAP_MARKS for mark, _ in self._marks
        ):
            raise ChartError(
                "Chart projection: projects geoshape and geopoint marks, and the chart has "
                "none; drop projection"
            )
        for i, panel in enumerate(self._panels):
            if panel.camera is not None and not any(
                mark["type"] in _MARKS_3D and mark.get("panel") == panel.id
                for mark, _ in self._marks
            ):
                raise ChartError(
                    f"Panel camera: panel {shown(panel.id)} has no 3D marks; "
                    "drop camera or add a point_3d, line_3d, or surface mark",
                    path=f"panels[{i}].camera",
                )
        three_d = any(mark["type"] in _MARKS_3D for mark, _ in self._marks)
        for name in ("z", "camera", "box_aspect"):
            if self._settings.get(name) is not None and not three_d:
                raise ChartError(
                    f"Chart {name}: an option of 3D charts, and the chart has no point_3d, "
                    f"line_3d, or surface marks; drop {name}"
                )

    def _check_scale_references(self) -> None:
        """Refuses a channel naming a scale the chart's ``scales`` does not
        have (the default ``"color"``, ``"symbol"``, and ``"dash"`` it makes),
        and a place naming a position scale it does not have."""
        declared = located("scales", lambda: scales_spec(self._settings.get("scales"))) or {}
        positions = [
            name
            for name, scale in declared.items()
            if isinstance(scale, Mapping) and scale.get("type") in ("linear", "log", "time")
        ]
        for index, (mark, _) in enumerate(self._marks):
            places = {name: mark.get(name) for name in ("x", "y", "x1", "x2", "y1", "y2")}
            places.update({f"span[{i}]": place for i, place in enumerate(mark.get("span") or ())})
            places.update({f"at.{name}": place for name, place in (mark.get("at") or {}).items()})
            for at, place in places.items():
                scale = place.get("scale") if isinstance(place, Mapping) else None
                if not isinstance(scale, str) or scale in ("x", "y", "yRight", *positions):
                    continue
                raise ChartError(
                    f"chart marks[{index}].{at}.scale: the chart has no position scale "
                    f'"{scale}"; name "x", "y", or "y_right", or add '
                    f'scales={{"{scale}": hg.Scale(type="linear")}}',
                    code="unknown-reference",
                    path=f"marks[{index}].{at}.scale",
                    mark=index if mark.get("id") is None else mark["id"],
                )
            # Channels in encode, and a point's color, size, opacity, and symbol of their own.
            channels = [
                entry
                for name, given in (mark.get("encode") or {}).items()
                for entry in _entries(f"encode.{name}", given)
            ]
            channels += [
                entry
                for name in ("color", "size", "fillOpacity", "symbol")
                if isinstance(mark.get(name), (dict, list))
                for entry in _entries(name, mark[name])
            ]
            for name, channel in channels:
                scale = channel.get("scale") if isinstance(channel, dict) else None
                if (
                    not isinstance(scale, str)
                    or scale in declared
                    or scale in ("color", "symbol", "dash")
                ):
                    continue
                named = [n for n in declared if n not in ("x", "y", "yRight")]
                choices = f", or name one of {listed(named)}" if named else ""
                method = _method(mark["type"])
                option = python_path(name)
                raise ChartError(
                    f"{method} {option.replace('.', ' ')} scale: the chart has no scale "
                    f"{scale!r}; add it to scales{choices}",
                    code="unknown-reference",
                    path=f"marks[{index}].{option}.scale",
                    mark=index if mark.get("id") is None else mark["id"],
                )

    def widget(self) -> ChartWidget:
        """A live notebook widget of this chart: Python can update it after display,
        and it reports zooming, brushing, hovering, and clicks back. Its view
        (``viewport``) is of the x scale its panels share; subplots with x
        scales of their own have a view each (``panel_viewports``), and facet
        panels must share x (x's scope ``"chart"``), as theirs come from the
        data.

        Needs the ``notebook`` extra (``pip install 'herceg[notebook]'``).
        """
        from .widget import ChartWidget

        return ChartWidget(self)

    @_output_settings
    def to_html(self, *, full_page: bool = True) -> str:
        """Self-contained HTML that renders the chart, with herceg and the data
        embedded: a page, or with ``full_page=False`` a ``<div>`` and script
        that repeat the engine in every chart. For pages of several charts,
        ``herceg.web`` loads the engine once (``web.assets`` and ``web.fragment``)."""
        _flag(full_page, "to_html full_page")
        return _render.html(*self.to_spec(), full_page=full_page)

    @_output_settings
    def to_svg(
        self,
        *,
        fonts: _render.Fonts | None = None,
        size: tuple[float, float] | None = None,
        unit: _render.LengthUnit = "px",
        tooltip: Literal["title"] | None = None,
        sizing: _render.SvgSizing | None = None,
        preserve_aspect_ratio: str | None = None,
        stroke_scaling: _render.StrokeScaling | None = None,
    ) -> str:
        """Standalone SVG, measured with supplied fonts and referencing their families.

        Requires the ``export`` extra. Font files are not embedded in the SVG.
        ``size`` lays the chart out at another size, a ``(width, height)`` in
        ``unit``: ``"px"`` (CSS pixels, the default), ``"in"``, ``"cm"``,
        ``"mm"``, or ``"pt"``, which the SVG's width and height then say, so
        documents place it at that size. ``tooltip="title"`` gives each bar,
        point, and observation of a line its tooltip's text as a ``<title>``,
        which viewers show under the pointer (charts with other marks the
        tooltip reads, and more than 5,000 of them, are refused); the
        chart's title and description stay what assistive technology reads.
        ``sizing="fluid"`` leaves out the width and height, so CSS or the
        container sizes the SVG and its viewBox scales the chart;
        ``preserve_aspect_ratio`` says how it fits a box of another shape
        (``"none"`` stretches it), and ``stroke_scaling="fixed"`` keeps lines
        their width in pixels however it scales. Scaling an SVG scales its
        text and geometry as laid out at the chart's size.
        """
        return _render.svg(
            *self.to_spec(),
            fonts=fonts,
            size=size,
            unit=unit,
            tooltip=tooltip,
            sizing=sizing,
            preserve_aspect_ratio=preserve_aspect_ratio,
            stroke_scaling=stroke_scaling,
        )

    @_output_settings
    def to_snapshot(
        self,
        *,
        id_prefix: str,
        width: int | None = None,
        height: int | None = None,
        fonts: _render.Fonts | None = None,
        locale: str | None = None,
        time_zone: str | None = None,
    ) -> dict[str, Any]:
        """The chart rendered for a web page to show at once and for its browser
        to hydrate: a dict of JSON values whose ``html`` is the chart's element
        as herceg's browser runtime builds it. Pass it to a JavaScript chart of
        the same spec (``<Chart initial={hydration(snapshot)}>`` in React,
        ``hydrateChart`` in TypeScript), which takes the element over without
        drawing it again. ``id_prefix`` starts the element's ids: unique in the
        page. The size is the chart's (640 x 320 when it has none) unless given;
        ``locale`` and ``time_zone`` are used where the chart sets none ("en-US"
        and "UTC"); ``fonts`` measure the text, which the browser's chart must
        be given too (requires the ``export`` extra)."""
        return _render.snapshot(
            *self.to_spec(),
            width=width,
            height=height,
            id_prefix=id_prefix,
            fonts=fonts,
            locale=locale,
            time_zone=time_zone,
        )

    @_output_settings
    def to_image(
        self,
        *,
        format: _render.ImageFormat = "png",
        size: tuple[float, float] | None = None,
        unit: _render.LengthUnit = "px",
        dpi: float = 96,
        quality: float | None = None,
        background: str | None = None,
        fonts: _render.Fonts | None = None,
    ) -> bytes:
        """A PNG, JPEG, or WebP image of the chart, for documents (requires the
        ``export`` extra).

        ``size`` lays the chart out at a ``(width, height)`` in ``unit``:
        ``"px"`` (CSS pixels, the default), ``"in"``, ``"cm"``, ``"mm"``, or
        ``"pt"``; the chart's own size by default. ``dpi`` (96 by default, a
        pixel per CSS pixel) sets the image's pixels and is recorded in the
        file (PNG's pHYs, JPEG's JFIF density, WebP's EXIF resolution); it
        never changes the layout, so ``size=(16, 10), unit="in", dpi=150``
        lays out at 1536 by 960 CSS pixels and draws 2400 by 1500 pixels.
        ``quality`` (0 to 100, 90 by default) compresses JPEG and WebP; PNG
        refuses it. ``background`` is a CSS color under the chart, which a
        transparent theme shows; JPEG, which has no transparency, is
        otherwise drawn on the chart's background, or under a transparent one
        on black (light text) or white. ``fonts`` measure and draw the text,
        as ``to_svg`` takes them. Images are at most 16,384 pixels a side and
        16.7 million pixels in all.
        """
        return _render.image(
            *self.to_spec(),
            format=format,
            size=size,
            unit=unit,
            dpi=dpi,
            quality=quality,
            background=background,
            fonts=fonts,
        )

    @_output_settings
    def to_png(
        self,
        *,
        size: tuple[float, float] | None = None,
        unit: _render.LengthUnit = "px",
        dpi: float = 96,
        background: str | None = None,
        fonts: _render.Fonts | None = None,
    ) -> bytes:
        """A PNG of the chart: ``to_image(format="png", ...)`` (requires the
        ``export`` extra)."""
        return _render.image(
            *self.to_spec(),
            format="png",
            size=size,
            unit=unit,
            dpi=dpi,
            background=background,
            fonts=fonts,
            location="to_png",
        )

    @_output_settings
    def to_pdf(
        self,
        *,
        fonts: _render.Fonts | None = None,
        fallback: Sequence[str] = (),
        missing_glyph: str | None = None,
        page_size: _render.PdfPageSize | None = None,
        orientation: _render.PdfOrientation | None = None,
        margin: float | None = None,
        title: str | None = None,
        subject: str | None = None,
        language: str | None = None,
    ) -> bytes:
        """Vector PDF on chart-sized or named paper (requires the ``export`` extra)."""
        return _render.pdf(
            *self.to_spec(),
            fonts=fonts,
            fallback=fallback,
            missing_glyph=missing_glyph,
            page_size=page_size,
            orientation=orientation,
            margin=margin,
            title=title,
            subject=subject,
            language=language,
        )

    @_output_settings
    def save(
        self,
        path: str | PathLike[str],
        *,
        format: _render.SaveFormat | None = None,
        size: tuple[float, float] | None = None,
        unit: _render.LengthUnit | None = None,
        dpi: float | None = None,
        quality: float | None = None,
        background: str | None = None,
        tooltip: Literal["title"] | None = None,
        fonts: _render.Fonts | None = None,
        sizing: _render.SvgSizing | None = None,
        preserve_aspect_ratio: str | None = None,
        stroke_scaling: _render.StrokeScaling | None = None,
        fallback: Sequence[str] = (),
        missing_glyph: str | None = None,
        page_size: _render.PdfPageSize | None = None,
        orientation: _render.PdfOrientation | None = None,
        margin: float | None = None,
        title: str | None = None,
        subject: str | None = None,
        language: str | None = None,
    ) -> None:
        """Writes ``.html``, ``.svg``, ``.png``, ``.jpg`` (or ``.jpeg``), ``.webp``,
        or ``.pdf``, chosen by the file extension.

        ``format`` names the format of a path without one of those
        extensions; given with one, it must agree. The other options are
        those of ``to_svg``, ``to_image``, and ``to_pdf``, each refused for
        a format that does not take it.
        """
        chosen = _render.save_format(path, format)
        given = {
            "size": size,
            "unit": unit,
            "dpi": dpi,
            "quality": quality,
            "background": background,
            "tooltip": tooltip,
            "fonts": fonts,
            "sizing": sizing,
            "preserve_aspect_ratio": preserve_aspect_ratio,
            "stroke_scaling": stroke_scaling,
            # No families is no fallback (an empty array too).
            "fallback": None if listlike(fallback) and len(fallback) == 0 else fallback,
            "missing_glyph": missing_glyph,
            "page_size": page_size,
            "orientation": orientation,
            "margin": margin,
            "title": title,
            "subject": subject,
            "language": language,
        }
        _render.check_save_options(
            chosen, [name for name, value in given.items() if value is not None]
        )
        content: str | bytes
        if chosen == "html":
            content = self.to_html()
        elif chosen == "svg":
            content = _render.svg(
                *self.to_spec(),
                fonts=fonts,
                size=size,
                unit="px" if unit is None else unit,
                tooltip=tooltip,
                sizing=sizing,
                preserve_aspect_ratio=preserve_aspect_ratio,
                stroke_scaling=stroke_scaling,
                location="save",
            )
        elif chosen == "pdf":
            try:
                content = self.to_pdf(
                    fonts=fonts,
                    fallback=fallback,
                    missing_glyph=missing_glyph,
                    page_size=page_size,
                    orientation=orientation,
                    margin=margin,
                    title=title,
                    subject=subject,
                    language=language,
                )
            except ChartError as error:
                raise renamed(error, "to_pdf", "save") from None
        else:
            content = _render.image(
                *self.to_spec(),
                format=cast("_render.ImageFormat", chosen),
                size=size,
                unit="px" if unit is None else unit,
                dpi=dpi if dpi is not None else 96,
                quality=quality,
                background=background,
                fonts=fonts,
                location="save",
            )
        if isinstance(content, bytes):
            with open(path, "wb") as binary:
                binary.write(content)
        else:
            with open(path, "w", encoding="utf-8") as text:
                text.write(content)

    def show(self) -> None:
        """Displays the chart in a notebook, or opens it in a browser elsewhere."""
        _render.show(self)

    def _repr_html_(self) -> str:
        return _render.notebook_html(*self.to_spec(), height=self._options.get("height"))

    # Internals -------------------------------------------------------------

    def _spec_options(self) -> dict[str, Any]:
        """The spec's chart options, with its field displays and row selection,
        whose tables are named once the marks are known."""
        options = self._options
        if self._settings.get("fields") is not None:
            options = {**options, "fields": self._fields_spec(self._settings["fields"])}
        if self._panel_guides:
            given = len(options.get("guides") or [])
            panel_guides = located("guides", lambda: guides_spec(self._panel_guides, given))
            options = {**options, "guides": [*(options.get("guides") or []), *panel_guides]}
        if not self._row_selection:
            return options
        names = [self._bound_table(binding) for binding in self._row_selection]
        if len(set(names)) < len(names):
            raise ChartError(
                "Chart row_selection: two bindings select rows of one table; "
                "give each table one binding"
            )
        for binding, name in zip(self._row_selection, names, strict=True):
            self._check_brush(binding, name)
        specs = [
            located(
                self._binding_path(binding),
                functools.partial(
                    binding._spec,
                    name,
                    self._bound_length(binding) if binding.selection is not None else None,
                ),
            )
            for binding, name in zip(self._row_selection, names, strict=True)
        ]
        return {**options, "rowSelection": specs[0] if len(specs) == 1 else specs}

    def _bound_length(self, binding: SelectionBinding) -> int | None:
        """How many rows the table a binding selects has; unknown (None) for a
        derived table, whose rows are computed in the browser."""
        index = self._bound_index(binding)
        if index in self._derived:
            return None
        columns = self._tables[index][1]
        if isinstance(columns, Matrix):
            return columns.shape[0] * columns.shape[1]
        return len(columns.column(_convertible(columns))) if columns.names else 0

    def _check_brush(self, binding: SelectionBinding, name: str) -> None:
        """Brushes along a summary's statistics (a histogram's counts, a box
        plot's values), and lassos over summaries, select no rows yet."""
        brush = brush_shape(self._settings["brush"])
        if brush is None or ("lasso" if brush == "lasso" else "brush") not in binding.events:
            return
        for mark, table in self._marks:
            kind = mark["type"]
            if table is None or table_name(self._selected(table)) != name:
                continue
            if brush == "lasso" and kind in ("histogram", "boxplot", "boxen", "violin"):
                raise ChartError(
                    f"SelectionBinding events: lassos cannot select the rows of {kind} marks "
                    'yet; leave out "lasso"',
                    path=self._binding_path(binding, "events"),
                )
            if kind == "rug":
                # A rug's ticks have a place along their own axis only.
                observed = "x" if mark.get("x") is not None else "y"
                other = "y" if observed == "x" else "x"
                if brush in (other, "xy"):
                    raise ChartError(
                        f"Chart brush: a rug's ticks have no {other} value, so its rows are "
                        f"brushed along {observed} only; received {shown(brush)}"
                    )
                continue
            if kind not in ("histogram", "boxplot", "boxen", "violin"):
                continue
            # A 2D histogram's cells place their rows along x and y both.
            if kind == "histogram" and mark.get("x") is not None and mark.get("y") is not None:
                continue
            # A summary's value axis holds statistics: a histogram's counts,
            # across its binned axis, and box plots' values, which may lie along x.
            y = mark.get("y")
            if kind == "histogram":
                categories = "y" if mark.get("x") is None else "x"
            else:
                categories = "y" if y is not None and self._kind(table, y) == "category" else "x"
            values = "y" if categories == "x" else "x"
            if brush in (values, "xy"):
                raise ChartError(
                    f"Chart brush: a {kind}'s {values} axis holds statistics, so its rows are "
                    f"brushed along {categories} only; received {shown(brush)}"
                )

    def _bound_table(self, binding: SelectionBinding) -> str:
        """The name of the table a binding selects rows of."""
        return table_name(self._bound_index(binding))

    def _selected(self, table: int) -> int:
        """The table selections of a table's rows hold rows of: a view's data."""
        return self._derived[table] if isinstance(self._tables[table][0], View) else table

    def _bound_index(self, binding: SelectionBinding) -> int:
        """The table a binding selects rows of: its ``data`` (a table the marks
        read, or one a derived table they read comes from), or else the chart's
        data, or the one table the marks read (a view's data, for views)."""
        read = sorted(
            {self._selected(table) for _, table in self._marks if table is not None}
            | set(self._node_tables.values())
        )
        if binding.data is None:
            default = self._default
            if default is not None and self._selected(default) in read:
                return self._selected(default)
            if len(read) != 1:
                raise ChartError(
                    "SelectionBinding data: the chart has no data of its own and its marks "
                    "read several tables; give data=, the object given to a mark",
                    path=self._binding_path(binding, "data"),
                )
            return read[0]
        found = next(
            (index for index, (source, _) in enumerate(self._tables) if source is binding.data),
            None,
        )
        if found is not None and isinstance(binding.data, View):
            raise ChartError(
                "SelectionBinding data: a view; selections hold rows of its data, so bind that",
                path=self._binding_path(binding, "data"),
            )
        if found is None or not any(found in self._lineage(table) for table in read):
            raise ChartError(
                "SelectionBinding data: expected an object given to one of the chart's marks, "
                "or the data of a derived table one draws",
                path=self._binding_path(binding, "data"),
            )
        return found

    def _lineage(self, table: int) -> list[int]:
        """A table and those it is derived from, nearest first: a binding of
        any of them reaches the rows its marks draw."""
        tables = [table]
        while tables[-1] in self._derived:
            tables.append(self._derived[tables[-1]])
        return tables

    def _binding_path(self, binding: SelectionBinding, option: str | None = None) -> str:
        """Where one of the chart's row selection bindings is, or an option of it."""
        at = "row_selection"
        if self._bindings_listed:
            index = next(i for i, bound in enumerate(self._row_selection) if bound is binding)
            at = f"row_selection[{index}]"
        return f"{at}.{option}" if option else at

    def _layout_spec(self) -> dict[str, Any]:
        """The spec's facet, or its panels and layout; nothing for one panel."""
        if self._facet is not None:
            return {
                "facet": {"field": self._facet, "columns": self._facet_columns}
                | self._facet_spacing
            }
        if self._facets:
            return {
                "facet": {"row": self._facet_row, "column": self._facet_column}
                | self._facet_spacing
            }
        if not self._panels:
            return {}
        spec: dict[str, Any] = {"panels": [p._spec() for p in self._panels]}
        layout = self._root._content_spec() if self._root is not None else self._layout
        if layout is not None:
            spec["layout"] = layout
        return spec

    def _used_fields(self, settings: Mapping[str, Any] | None = None) -> dict[int, set[str]]:
        """The columns each table must send: those marks read, those links of
        the field displays of ``settings`` (the chart's by default) read, and
        those derived tables need from their sources."""
        used: dict[int, set[str]] = {}
        for index, (spec, table) in enumerate(self._marks):
            # A network's node fields are columns of its nodes, not of its links.
            node_table = self._node_tables.get(index)
            links = spec
            if node_table is not None:
                links = {key: value for key, value in spec.items() if key not in _NODE_FIELDS}
            if table is not None:
                fields = used.setdefault(table, set())
                fields.update(_fields(links))
                if spec.get("facet") is None:
                    fields.update(self._facets)
            if node_table is not None:
                used.setdefault(node_table, set()).update(
                    spec[key] for key in _NODE_FIELDS if spec.get(key) is not None
                )
            # Text following another mark reads that mark's columns.
            following = spec.get("from")
            if spec.get("type") == "text" and isinstance(following, dict):
                source = self._source_table(str(following["mark"]))
                if source is not None:
                    used.setdefault(source, set()).update(_label_fields(spec))
        # Axes' titles name columns by their labels: those of the marks' tables.
        for name in self._titled_fields():
            for table, fields in used.items():
                if name in self._tables[table][1].names:
                    fields.add(name)
        # Places at thresholds read their column of the table they name, or of
        # every table the marks read that holds it.
        for spec, _ in self._marks:
            for place in (spec.get("x"), spec.get("y")):
                if not isinstance(place, AtThresholds):
                    continue
                for table, fields in used.items():
                    named = place.table
                    # Data objects match by identity: a DataFrame's == compares cells.
                    whose = (
                        named is None
                        or named is self._tables[table][0]
                        or (named is self._computed_from and table == self._default)
                        or (isinstance(named, str) and named == table_name(table))
                    )
                    if whose and place.field in self._tables[table][1].names:
                        fields.add(place.field)
        # Links of the displays of columns sent read other columns of their rows.
        self._add_link_fields(used, (settings or self._settings).get("fields"))
        # Columns row selections' conditions set from Python test, and those
        # of the conditions bindings start with.
        for binding in self._row_selection:
            condition = binding.selection
            if isinstance(condition, RowSelection):
                condition = condition.condition
            tested = sorted(_fields_of(condition._json)) if isinstance(condition, Expr) else []
            if not binding.fields and not tested:
                continue
            index = self._bound_index(binding)
            derived = index in self._derived
            names = self._tables[index][1].names
            for i, name in enumerate(binding.fields):
                if derived or name not in names:
                    raise ChartError(
                        f"SelectionBinding fields[{i}]: no column {name!r} in the data it selects",
                        code="unknown-field",
                        path=self._binding_path(binding, f"fields[{i}]"),
                    )
            for name in tested:
                if name not in names:
                    raise ChartError(
                        f"SelectionBinding selection: no column {name!r} in the data it selects",
                        code="unknown-field",
                        path=self._binding_path(binding, "selection"),
                    )
            used.setdefault(index, set()).update([*binding.fields, *tested])
        # Later tables derive from earlier ones, so needs flow back in one pass.
        for table in sorted(self._derived, reverse=True):
            if table not in used:
                continue
            source = self._derived[table]
            columns = self._tables[source][1]
            needs = used.setdefault(source, set())
            needs.update(self._tables[table][0].source_columns(used[table]))
            # A table sent without columns has no rows: send one, so counts
            # survive. Derived tables compute their rows whatever is read.
            if source not in self._derived and columns.names and not needs & set(columns.names):
                needs.add(_convertible(columns))
        # Ordered tables keep their rows in order of a column the browser needs.
        for table in used:
            if isinstance(source := self._tables[table][0], Ordered):
                used[table].add(source.by)
        return used

    def _add_link_fields(self, used: dict[int, set[str]], fields: Any) -> None:
        """Adds to each table's columns those the links of its columns sent
        read under ``fields``, where it has them: each column's link is the
        last rule's that surely matches it, or any rule's that may (regular
        expressions are JavaScript's), so the engine never lacks a column a
        link reads."""
        rules = located(None, lambda: link_rules(fields, "Chart fields"))
        if not rules:
            return
        for table, names in used.items():
            columns = self._tables[table][1].names
            reads: set[str] = set()
            # A point's symbol may name a shape rather than a column; shapes
            # have no displays.
            for name in [
                name
                for name in names
                if name in columns and self._tables[table][1].column(name).kind != "geometry"
            ]:
                reads |= link_needs(rules, functools.partial(self._matches, name=name, table=table))
            names.update(field for field in reads if field in columns)

    def _matches(self, match: str | Match | None, name: str, table: int) -> bool | None:
        """Whether a rule matching ``match`` applies to column ``name`` of
        table ``table``: True or False where Python can tell (names, kinds,
        the tables the column comes from unchanged), None where only the
        engine can (regular expressions)."""
        if match is None or isinstance(match, str):
            return match is None or match == name
        names = [match.field] if isinstance(match.field, str) else match.field
        kinds = match._kinds
        if (names is not None and name not in names) or (
            kinds is not None and self._tables[table][1].column(name).kind not in kinds
        ):
            return False
        sure = match.regex is None
        if match.table is None:
            return True if sure else None
        # The tables the column comes from unchanged: derived tables' sources
        # while it passes their steps, and the tables express made them from.
        line = [table]
        while True:
            one = line[-1]
            if one in self._derived and _passes(self._tables[one][0], name):
                line.append(self._derived[one])
            elif one in self._origins and name in self._tables[self._origins[one]][1].names:
                line.append(self._origins[one])
            else:
                break
        # Data objects match by identity: a DataFrame's == compares cells.
        named = [
            match.table is self._tables[one][0]
            or (match.table is self._computed_from and one == self._default)
            or (isinstance(match.table, str) and match.table == table_name(one))
            for one in line
        ]
        # The line holds the tables the column comes from unchanged, as the
        # engine's lineage does: a rule naming one of them matches it.
        if not any(named):
            return False
        return True if sure else None

    def _titled_fields(self) -> set[str]:
        """The columns axes' titles of parts name by their labels
        (``hg.LabelPart(label="ms")``), where field displays label them."""
        if self._settings.get("fields") is None:
            return set()
        named: set[str] = set()

        def read(value: Any) -> None:
            if isinstance(value, dict):
                title = value.get("title")
                if isinstance(title, list):
                    named.update(
                        part["label"]
                        for part in title
                        if isinstance(part, dict) and isinstance(part.get("label"), str)
                    )
                for item in value.values():
                    read(item)
            elif isinstance(value, list):
                for item in value:
                    read(item)

        # Chart axes, scales, and guides, and panels' own.
        read([self._options, guides_spec(self._panel_guides), self._layout_spec()])
        return named

    def _used_columns(
        self, settings: Mapping[str, Any] | None = None
    ) -> dict[str, dict[str, Column]]:
        """The columns sent, by spec table name, under ``settings`` (the
        chart's by default): those ``_sent_fields`` names."""
        return {
            name: {field: self._tables[table][1].column(field) for field in sorted(fields)}
            for name, (table, fields) in self._sent_fields(settings).items()
        }

    def _sent_fields(
        self, settings: Mapping[str, Any] | None = None
    ) -> dict[str, tuple[int, set[str]]]:
        """The names of the columns sent, by spec table name, with the
        table's index; other columns are never sent, but a matrix's
        coordinates always are: they say its shape."""
        used = self._used_fields(settings)
        for table, (source, _) in enumerate(self._tables):
            if isinstance(source, Matrix) and table in used:
                used[table] |= {source.x, source.y}
        return {
            # A point's symbol may name a shape rather than a column.
            table_name(table): (table, fields & set(self._tables[table][1].names))
            for table, fields in used.items()
            if table not in self._derived
        }

    def _matrices(self) -> dict[str, dict[str, str]]:
        """The coordinates of the matrix tables sent, by spec table name."""
        return {
            table_name(table): {"x": source.x, "y": source.y}
            for table, (source, _) in enumerate(self._tables)
            if isinstance(source, Matrix)
        }

    def _derived_specs(self) -> dict[str, dict[str, Any]]:
        """The derived tables, views, groups, and totals marks read, directly
        or through others."""
        used = self._used_fields()

        def entry(data: Any) -> dict[str, Any]:
            if isinstance(data, View):
                return {"view": data.query}
            if isinstance(data, (RowGroups, RowTotals)):
                return data._spec()
            return {"transform": list(data.steps)}

        return {
            table_name(table): {"source": table_name(source), **entry(self._tables[table][0])}
            for table, source in sorted(self._derived.items())
            if table in used
        }

    def _ordered_specs(self) -> dict[str, dict[str, Any]]:
        """What ordered tables sent add to their columns: the column their rows
        are kept in order of, and how many they keep."""
        return {
            table_name(table): {
                "orderBy": source.by,
                **({"maxRows": source.max_rows} if source.max_rows is not None else {}),
            }
            for table, (source, _) in enumerate(self._tables)
            if isinstance(source, Ordered)
        }

    def _mark_specs(self) -> list[dict[str, Any]]:
        def spec_of(index: int, key: str, value: Any) -> Any:
            # Places at thresholds name the tables the chart draws.
            if isinstance(value, AtThresholds):
                return located(
                    f"marks[{index}].{key}",
                    lambda: value._spec(self._name_of),
                    "AtThresholds",
                )
            return value

        return [
            {
                **{
                    key: spec_of(index, key, value)
                    for key, value in mark.items()
                    if value is not None
                },
                **({"data": table_name(table)} if table is not None else {}),
                **(
                    {"nodes": table_name(self._node_tables[index])}
                    if index in self._node_tables
                    else {}
                ),
            }
            for index, (mark, table) in enumerate(self._marks)
        ]

    def _fields_spec(self, fields: Any) -> Any:
        """``fields`` as the spec takes it, data matched as tables by the names of the chart's."""
        return located(None, lambda: fields_spec(fields, "Chart fields", self._name_of), "Chart")

    def _name_of(self, data: Any) -> str:
        """The spec's name of the table of ``data``, which the chart or a mark
        draws, or which an express function computed the chart's table from."""
        for index, (source, _) in enumerate(self._tables):
            if source is data:
                return table_name(index)
        if data is not None and data is self._computed_from and self._default is not None:
            return table_name(self._default)
        raise ChartError(
            "Match table: the chart and its marks draw no such data; give data they draw, "
            "or a table's name"
        )

    def _table_names(self) -> list[tuple[Any, str]]:
        """Each data source given to the chart or its marks, with its spec table name."""
        return [(source, table_name(index)) for index, (source, _) in enumerate(self._tables)]

    def _table(self, data: Any, converted: _Columns | None = None) -> int:
        for index, (source, _) in enumerate(self._tables):
            if source is data:
                return index
        if isinstance(data, (Derived, RowGroups, RowTotals)):
            source = self._table(data.source, data._table)
            self._tables.append((data, _DerivedColumns(data)))
            self._derived[len(self._tables) - 1] = source
        elif isinstance(data, View):
            # A view's columns are its data's: marks check fields against them.
            source = self._table(data.source, data._table)
            self._tables.append((data, self._tables[source][1]))
            self._derived[len(self._tables) - 1] = source
        elif isinstance(data, Ordered):
            self._tables.append((data, data.table))
        elif isinstance(data, Matrix):
            self._tables.append((data, data))
        else:
            self._tables.append((data, converted or Table(data)))
            if self._made_from_data and self._default is not None:
                self._origins[len(self._tables) - 1] = self._default
        return len(self._tables) - 1

    def _mark_table(self, data: Any) -> int:
        if data is not None:
            return self._table(data)
        if self._default is None:
            raise ChartError("Chart data: the chart has none; pass data to hg.Chart or to the mark")
        return self._default

    def _item_key(self, table: int | None, item_key: str | None, mark: str) -> str | None:
        """A mark's ``item_key``: a numeric, datetime, or category column whose
        value names each row's item."""
        if item_key is None:
            return None
        if table is None:
            raise ChartError(
                f"{mark} item_key: names the rows of the mark's data; "
                "give it data, or drop item_key",
                path=self._path(f"{mark} item_key"),
            )
        self._require(table, item_key, (*_NUMERIC, "category"), f"{mark} item_key")
        return item_key

    def _require(
        self,
        table: int,
        field: str | None,
        kinds: tuple[str, ...],
        role: str,
        *,
        optional: bool = True,
    ) -> None:
        """Refuses ``field`` unless it names a column of the table holding
        ``kinds`` of values; None is no column, where ``optional``."""
        if field is None and optional:
            return
        source = self._tables[table][1]
        path = self._path(role)
        if not isinstance(field, str):
            raise ChartError(
                f"{role}: expected a column's name; received {shown(field)}", path=path
            )
        if field not in source.names:
            available = ", ".join(repr(name) for name in source.names)
            raise ChartError(
                f"{role}: no column {field!r}; the data has {available}",
                code="unknown-field",
                path=path,
            )
        column = _read(source, field, role, path)
        kind = column.kind
        if kind not in kinds:
            # Categories come from strings, and times (only a heatmap's date takes
            # nothing else) from datetimes, so the usual fix is the column's type.
            if kinds[0] == "category":
                fix = (
                    UNTYPED
                    if column.untyped
                    else "; give its values as strings, or make it a categorical column"
                )
            elif kinds[0] == "time":
                fix = "; give datetimes"
            elif kind == "category" and "number" in kinds:
                fix = "; give numbers, not strings"
            else:
                fix = ""
            raise ChartError(
                f"{role}: column {field!r} holds {kind} values; expected {' or '.join(kinds)}{fix}",
                code="field-type",
                path=path,
            )

    def _mark_tooltip(
        self,
        table: int,
        tooltip: Tooltip | None,
        mark: str,
        values: tuple[str, str | Sequence[str] | None] | None = None,
        band: bool = False,
    ) -> dict[str, Any] | None:
        """The spec of a mark's ``tooltip``, its fields checked against its
        data, and a total against the mark's value columns (``values``: the
        axis they are on, and their names) or its ``band``."""
        if tooltip is None:
            return None
        if not isinstance(tooltip, Tooltip):
            raise ChartError(
                f"{mark} tooltip: expected an hg.Tooltip with fields, content, or a heading; "
                f"received {shown(tooltip)}"
            )
        spec = tooltip._mark_spec(mark)
        total = Role(mark).field("tooltip").field("total")
        if "total" in spec and band:
            raise total.error("a band's points are ranges, which have no total; drop total")
        if "total" in spec and values is not None:
            axis, columns = values
            for summed in [columns] if isinstance(columns, str) else (columns or ()):
                kind = self._kind(table, summed)
                if kind is not None and kind != "number":
                    raise total.error(
                        f"{axis} {summed!r} is a {kind} column, whose points have no sum; "
                        "drop total"
                    )
        parts = [
            (name, i, part)
            for name in ("content", "heading")
            for i, part in enumerate(spec.get(name, ()))
        ]
        for name, i, part in parts:
            column = part.get("field", part.get("label")) if isinstance(part, dict) else None
            if column is None:
                continue
            at = f"{mark} tooltip {name}[{i}] {'field' if 'field' in part else 'label'}"
            self._require(table, column, ("number", "time", "category"), at)
            kind = self._kind(table, column)
            if "field" in part and "format" in part and kind is not None:
                if kind == "category" or not writes(part["format"], kind):
                    fix = {
                        "category": "formats are for numbers and times; drop format",
                        "time": "give hg.Format(time=...) or Intl date options",
                        "number": "give a number format",
                    }[kind]
                    raise ChartError(
                        f"{mark} tooltip {name}[{i}] format: {shown(column)} holds "
                        f"{'categories' if kind == 'category' else kind + 's'}; {fix}"
                    )
        for i, entry in enumerate(spec.get("fields", ())):
            field = entry if isinstance(entry, str) else entry["field"]
            self._require(
                table, field, ("number", "time", "category"), f"{mark} tooltip fields[{i}]"
            )
            # A format writes its field's kind: numbers' forms, times', none for categories.
            kind = self._kind(table, field)
            if isinstance(entry, dict) and "format" in entry and kind is not None:
                if kind == "category" or not writes(entry["format"], kind):
                    fix = {
                        "category": "formats are for numbers and times; drop format",
                        "time": "give hg.Format(time=...) or Intl date options",
                        "number": "give a number format",
                    }[kind]
                    raise ChartError(
                        f"{mark} tooltip fields[{i}] format: {shown(field)} holds "
                        f"{'categories' if kind == 'category' else kind + 's'}; {fix}"
                    )
        return spec or None

    def _kind(self, table: int, field: str) -> str | None:
        """The kind of column `field`; None where the data lacks it, or its
        values cannot be read, which `_require` refuses at the option
        reading it."""
        source = self._tables[table][1]
        if field not in source.names:
            return None
        try:
            return source.column(field).kind
        except ChartError:
            return None

    def _path(self, role: str, option: str | None = None) -> str:
        """Where an option of the mark being added is (``marks[3].color``), from
        its role (``"line color"``), or a chart option's (``"Chart facet"``)."""
        mark, _, rest = role.partition(" ")
        name = option or rest.replace(" ", ".")
        return name if mark == "Chart" else f"marks[{len(self._marks)}].{name}"

    def _option(self, role: str, make: Callable[[], _T]) -> _T:
        """``make()``, its refusals at the option ``role`` names (``"bar
        labels"``), within the mark being added, or the chart's
        (``"Chart facet"``)."""
        return located(role.partition(" ")[2].replace(" ", "."), make)

    def _places(
        self, mark: str, places: Mapping[str, Any], right: bool = False, needed: bool = False
    ) -> _RowPlaces:
        """A mark of rows' positions by option (``x``, ``y1``, ...), checked as
        the engine checks them (marks/row-bindings.ts): a coordinate reads a
        column (``hg.Fraction(field=...)``, not ``hg.Fraction(0.5)``), on the
        axis' own scale or one of the chart's own, and positions along one
        direction are placed alike."""
        found: dict[str, tuple[str, tuple[Any, ...] | None]] = {}
        columns: dict[str, str | Sequence[str]] = {}
        specs: dict[str, dict[str, Any]] = {}
        bound: dict[str, tuple[Any, ...]] = {}
        for name, value in places.items():
            if value is None and needed:
                raise ChartError(
                    f"{mark} {name}: expected a column's name or a place of rows; received None",
                    path=self._path(mark, name),
                )
            if value is None:
                continue
            axis = name[0]
            binding: tuple[Any, ...] | None = None
            if isinstance(value, (Fraction, Pixels, DataPosition)):
                spec = value._spec()
                form = (
                    "field"
                    if isinstance(value, DataPosition)
                    else "fraction"
                    if isinstance(value, Fraction)
                    else "px"
                )
                if value.field is None:
                    # One place for every row is a rule's or text's.
                    at = name if form == "field" else f"{name}.{form}"
                    expected = (
                        "{ field }, { fraction: { field } }, or { px: { field } }"
                        if form == "field"
                        else "{ field }"
                    )
                    received = json.dumps(
                        spec if form == "field" else spec[form], separators=(",", ":")
                    )
                    raise ChartError(
                        f"{mark} {at}: expected {expected}: each row is placed by its own "
                        f"value; received {received}",
                        code="invalid-option",
                        path=self._path(mark, at),
                    )
                columns[name] = value.field
                specs[name] = spec
                offset = spec.get("offset", 0)
                own = "x" if axis == "x" else "yRight" if right else "y"
                if form != "field":
                    binding = ("frame", form, spec.get("frame", "plot"), offset)
                elif spec.get("scale", own) in ("x", "y", "yRight"):
                    scale = spec.get("scale", own)
                    if scale != own:
                        fix = 'give axis="right"' if scale == "yRight" else f'name "{own}"'
                        raise ChartError(
                            f'{mark} {name}.scale: "{scale}" is not this {axis} axis\' scale '
                            f'("{own}"); {fix}',
                            code="invalid-option",
                            path=self._path(mark, f"{name}.scale"),
                        )
                    binding = ("axis", offset) if offset else None
                else:
                    binding = ("scale", spec["scale"], offset)
            else:
                columns[name] = value
            first = found.setdefault(axis, (name, binding))
            if first[1] != binding:
                raise ChartError(
                    f"{mark} {name}: placed otherwise than {first[0]}; place {first[0]} and "
                    f"{name} alike, on one scale or in one frame, with one offset",
                    code="unsupported",
                    path=self._path(mark, name),
                )
            if binding is not None:
                bound[axis] = binding
        y = found.get("y")
        if right and y and y[1] and y[1][0] != "axis":
            raise ChartError(
                f'{mark} axis: "right" places y on yRight\'s scale, which {y[0]} is not on; '
                "drop axis",
                code="invalid-option",
                path=self._path(mark, "axis"),
            )
        return _RowPlaces(columns, specs, bound)

    def _check_places(self, table: int, mark: str, places: _RowPlaces) -> None:
        """Checks the columns placed off their axes: shares and pixels read
        numbers, a scale of the chart's own numbers and times."""
        for name in places.specs:
            binding = places.bound.get(name[0])
            if binding is None or binding[0] == "axis":
                continue
            frame = binding[0] == "frame"
            role = f"{mark} {name}.{binding[1]}.field" if frame else f"{mark} {name}.field"
            column = cast("str", places.columns[name])
            self._require(table, column, ("number",) if frame else _NUMERIC, role)

    def _series_of(
        self,
        table: int,
        series: str | Literal[False] | None,
        color: str | None,
        encode: dict[str, Any] | None,
        paint: str | None,
        paint_name: str,
        mark: str,
    ) -> str | None:
        """The column splitting a line's, area's, or bar's rows into series, as
        the engine finds it (see ``series_of``): ``series``, or without it the
        category column ``color`` (or ``encode``'s color channel) names, so
        that ``color="region"`` draws a series per region; none with
        ``series=False`` or where the mark's own paint (a line's ``stroke``,
        an area's or bar's ``fill``) overrides the color."""
        if series is False:
            return None
        if series is not None:
            if not isinstance(series, str):
                raise ChartError(
                    f"{mark} series: expected a column name, or False; received {shown(series)}"
                )
            self._require(table, series, ("category",), f"{mark} series")
            return series
        return series_of(color, encode, paint, paint_name, lambda field: self._kind(table, field))

    def _color_series(
        self,
        table: int,
        series: str | None,
        color: str | None,
        mark: str,
        paint: str = "the color as fill or stroke",
    ) -> str | None:
        """The series column of a mark of summaries or observations (a
        histogram, box plot, violin, boxen plot, error bar, or rug) given its
        ``color``: a category column names the series, as ``series`` does (which
        must then name it too); a color is the mark's paint."""
        if color is None:
            return series
        if not isinstance(color, str):
            raise ChartError(
                f"{mark} color: expected a column name or a color; received {shown(color)}"
            )
        names = self._tables[table][1].names
        if color not in names:
            if not is_color(color):
                raise ChartError(
                    f"{mark} color: {color!r} is neither a column nor a color; the data has "
                    f"{', '.join(repr(name) for name in names)}, and colors are hex, rgb(), "
                    "hsl(), var(), or CSS names",
                    path=self._path(mark, "color"),
                )
            return series
        if is_color(color):
            raise ChartError(
                f"{mark} color: {color!r} names both a column and a color; give "
                f"series={color!r}, or {paint}",
                path=self._path(mark, "color"),
            )
        self._require(table, color, ("category",), f"{mark} color")
        if series is not None and series != color:
            raise ChartError(
                f"{mark} color: colors the series, so it names their column; give series or "
                "color, or the same column for both",
                path=self._path(mark, "color"),
            )
        return color

    def _check_annotation_scales(self, spec: Mapping[str, Any]) -> None:
        """Refuses an annotation's place on another axis' scale, as the engine
        does: y_right needs axis="right". Scales of the chart's own are its
        own ``scales``'."""
        mark = spec["type"]
        own = {"x": "x", "y": "yRight" if spec.get("axis") == "right" else "y"}
        # A rule's span lies across it.
        across = "y" if mark == "rule" and spec.get("x") is not None else "x"
        places = {name: spec.get(name) for name in ("x", "y", "x1", "x2", "y1", "y2")}
        places.update({f"span[{i}]": place for i, place in enumerate(spec.get("span") or ())})
        places.update({f"at.{name}": place for name, place in (spec.get("at") or {}).items()})
        for name, place in places.items():
            scale = place.get("scale") if isinstance(place, Mapping) else None
            letter = name.removeprefix("at.")[0]
            axis = letter if letter in own else across
            if scale not in ("x", "y", "yRight") or scale == own[axis]:
                continue
            fix = 'give axis="right"' if scale == "yRight" else f'name "{own[axis]}"'
            raise ChartError(
                f'{mark} {name}.scale: "{python_path(scale)}" is not this {axis} axis\' scale '
                f'("{python_path(own[axis])}"); {fix}',
                code="invalid-option",
                path=self._path(mark, f"{name}.scale"),
            )

    def _check_label_dict(self, value: Any, mark: str, option: str, keys: tuple[str, ...]) -> None:
        """Refuses a label option given as a dict (``labels``, ``label``,
        ``from_``) whose ``keys`` are malformed, at their own paths, as the
        engine's validator does, before the dict makes its class."""
        problem = label_dict_problem(value, keys)
        if problem:
            path = self._path(mark, f"{option}.{problem[0]}")
            raise ChartError(f"{mark} {path.partition('.')[2]}: {problem[1]}", path=path)

    def _check_channel_dict(self, channel: Any, mark: str, at: str) -> None:
        """Refuses a channel given as a dict whose column name or constant is
        not one, at its own path (``at`` as the spec names it, ``encode.fill``),
        as the engine's validator does, before the dict makes an ``hg.Channel``;
        a list's dicts each, at theirs (``encode.fill[1]``)."""
        if listlike(channel):
            for i, entry in enumerate(channel):
                self._check_channel_dict(entry, mark, f"{at}[{i}]")
            return
        if not isinstance(channel, Mapping):
            return

        def refuse(key: str, expected: str) -> None:
            path = self._path(mark, python_path(f"{at}.{key}"))
            raise ChartError(
                f"{mark} {path.partition('.')[2]}: expected {expected}; "
                f"received {shown(channel[key])}",
                path=path,
            )

        if "field" in channel and not (isinstance(channel["field"], str) and channel["field"]):
            refuse("field", "a column's name")
        scale = channel.get("scale")
        if "scale" in channel and not (
            isinstance(scale, (str, IdentityScale))
            or (isinstance(scale, Mapping) and dict(scale) == {"type": "identity"})
        ):
            refuse("scale", "a scale's name, or hg.IdentityScale()")
        if "value" in channel:
            name = at.rpartition(".")[2].partition("[")[0]
            problem = output_problem(name, channel["value"], is_color)
            if problem:
                refuse("value", problem)

    def _check_outputs(self, channels: Mapping[str, Any], mark: str, prefix: str) -> None:
        """Refuses channels' constants and conditions' branches that are not
        what each channel draws, at their paths, as the engine does."""
        for name, given in channels.items():
            for at, channel in _entries(f"{prefix}{name}", given):
                self._check_output(name, channel, mark, at)

    def _check_output(self, name: str, channel: Any, mark: str, at: str) -> None:
        """Refuses a channel's constant or condition's branch that is not what
        channel ``name`` draws, at ``at``, as the engine does."""
        if isinstance(channel, Mapping):
            condition = channel.get("condition") or {}
            branches = (
                [("value", channel["value"])]
                if "value" in channel
                else [
                    (f"condition.{key}", condition[key])
                    for key in ("then", "otherwise")
                    if key in condition
                ]
            )
            for key, value in branches:
                problem = output_problem(name, value, is_color)
                if problem:
                    path = self._path(mark, python_path(f"{at}.{key}"))
                    raise ChartError(
                        f"{mark} {path.partition('.')[2]}: expected {problem}; "
                        f"received {shown(value)}",
                        path=path,
                    )

    def _check_colors(
        self,
        table: int,
        color: str | None,
        channels: dict[str, Any] | None,
        mark: str,
        kinds: tuple[str, ...] = ("category",),
        both: str | None = None,
    ) -> None:
        """Refuses a ``color`` that is neither a column nor a color, or names
        both (``both`` says how to tell them apart), or a column not of
        ``kinds``, and channels reading columns the data does not have or that
        hold no categories, as the engine would as it draws."""
        names = self._tables[table][1].names
        if color is not None and isinstance(color, str):
            column, css = color in names, is_color(color)
            if column and css:
                raise ChartError(
                    f"{mark} color: {color!r} names both a column and a color; "
                    + (
                        both
                        or f"give encode=hg.Encodings(color=hg.Channel(field={color!r})) or "
                        f"hg.Channel(value={color!r})"
                    ),
                    path=self._path(mark, "color"),
                )
            if not column and not css:
                raise ChartError(
                    f"{mark} color: {color!r} is neither a column nor a color; the data has "
                    f"{', '.join(repr(name) for name in names)}, and colors are hex, rgb(), "
                    "hsl(), var(), or CSS names",
                    path=self._path(mark, "color"),
                )
            # Lines, areas, and bars color by categories, through a scale; points by numbers too.
            if column:
                self._require(table, color, kinds, f"{mark} color")
        for name, given in (channels or {}).items():
            for at, channel in _entries(f"encode.{name}", given):
                self._check_channel_field(table, channel, mark, at)

    def _check_channel_field(self, table: int, channel: Any, mark: str, at: str) -> None:
        """Refuses a channel's column the data lacks, or holding values the
        channel does not read through its scale, and a rank test's column
        holding no numbers or times, as the engine would as it draws."""
        if not isinstance(channel, dict):
            return
        when = (channel.get("condition") or {}).get("when")
        if isinstance(when, dict):
            ranked = python_path(f"{at}.condition.when.field")
            self._require(table, when["field"], (*_NUMERIC, "category"), f"{mark} {ranked}")
            if self._kind(table, when["field"]) == "category":
                raise ChartError(
                    f"{mark} {ranked}: column {when['field']!r} holds categories; ranks are of "
                    "numbers and times",
                    code="field-type",
                    path=self._path(mark, ranked),
                )
        field = channel.get("field")
        if field is None:
            return
        option = python_path(f"{at}.field")
        # Through an identity scale (its own, or one of the chart's), a
        # number field's values are widths and opacities.
        scale = channel.get("scale")
        named = (self._options.get("scales") or {}).get(scale, {}) if isinstance(scale, str) else {}
        identity = isinstance(scale, Mapping) or named.get("type") == "identity"
        # A channel scale (one with a range) maps numbers and times.
        kinds = (
            _NUMERIC if "range" in named else ("category", "number") if identity else ("category",)
        )
        self._require(table, field, kinds, f"{mark} {option}")

    def _check_point_color(
        self,
        table: int,
        color: str | None,
        fill: str | None,
        colors: Any,
        color_domain: Any,
        color_midpoint: Any,
        mark: str,
        numbers: tuple[str, ...],
        both: str | None = None,
    ) -> None:
        """Refuses a points' ``color`` as the engine would: a column holding
        neither ``numbers`` nor categories, a name that is neither a column
        nor a color, or both, and a ramp's options for anything but a number
        column, unless ``fill``, which wins over the color, is given."""
        if color is None:
            return
        self._check_colors(table, color, None, mark, (*numbers, "category"), both)
        if fill is not None:
            return
        if color in self._tables[table][1].names:
            self._check_category_color(table, color, colors, color_domain, color_midpoint, mark)
        else:
            self._refuse_ramp(
                mark, "a ramp colors a number column", colors, color_domain, color_midpoint
            )

    def _check_category_color(
        self,
        table: int,
        color: str | None,
        colors: Any,
        color_domain: Any,
        color_midpoint: Any,
        mark: str,
    ) -> None:
        """Refuses a ramp's options for a category ``color``, which the theme's
        palette colors value by value."""
        if color is None or self._kind(table, color) != "category":
            return
        self._refuse_ramp(
            mark,
            f"{color!r} is a category column, colored by the theme's palette",
            colors,
            color_domain,
            color_midpoint,
        )

    def _refuse_ramp(
        self, mark: str, why: str, colors: Any, color_domain: Any, color_midpoint: Any
    ) -> None:
        """Refuses a ramp's options on a mark whose ``color`` reads no ramp,
        saying ``why``, at the first one given, as the engine's ``refuseRamp``
        does."""
        for name, option, value in (
            ("colors", "colors", colors),
            ("color_domain", "colorDomain", color_domain),
            ("color_midpoint", "colorMidpoint", color_midpoint),
        ):
            if value is not None:
                raise ChartError(
                    f"{mark} {name}: {why}; drop colors, color_domain, and color_midpoint",
                    path=self._path(mark, option),
                )

    def _source_table(self, mark: str) -> int | None:
        """The table of the mark of id ``mark`` declared so far, if it has one."""
        for spec, table in self._marks:
            if spec.get("id") == mark:
                return table
        return None

    def _add(self, spec: dict[str, Any], table: int | None) -> Chart:
        z = spec.get("zIndex")
        if z is not None and (isinstance(z, bool) or not is_number(z) or not math.isfinite(z)):
            raise ChartError(
                f"{_method(spec['type'])} z_index: expected a finite number, where the mark is "
                f"painted among its panel's marks; received {shown(z)}",
                path=f"marks[{len(self._marks)}].z_index",
            )
        if self._unchecked is not None:
            check_hints(*self._unchecked)
        # A series' name of parts reads columns of the mark's table.
        name = spec.get("label")
        if isinstance(name, list) and table is not None:
            for i, part in enumerate(name):
                for key in ("field", "label"):
                    if isinstance(part, dict) and part.get(key) is not None:
                        method = _method(spec["type"])
                        self._require(table, part[key], _ANY, f"{method} label[{i}].{key}")
        if (
            table is not None
            and isinstance(self._tables[table][0], View)
            and spec["type"] not in _VIEW_MARKS
        ):
            role = _method(spec["type"])
            raise ChartError(
                f"{role} data: a view; {role} marks take a table, so give the view's data, "
                "or derive one with its filter",
                path=f"marks[{len(self._marks)}].data",
                mark=len(self._marks),
            )
        mark_id = spec.get("id")
        if mark_id is not None and any(mark.get("id") == mark_id for mark, _ in self._marks):
            raise ChartError(
                f"{_method(spec['type'])} id: {shown(mark_id)} names another mark; "
                "give each mark an id of its own",
                path=f"marks[{len(self._marks)}].id",
                mark=len(self._marks),
            )
        if spec["type"] in ("rule", "region", "text"):
            self._check_annotation_scales(spec)
            label = spec.get("label")
            parts = isinstance(label, dict) and label.get("content") is not None
            if spec.get("legend") is True and (label is None or parts):
                role = _method(spec["type"])
                raise ChartError(
                    f"{role} legend: True lists the {role} by its label's text or column, and a "
                    "label of parts has neither; give text or a column, or drop legend"
                    if parts
                    else f"{role} legend: True lists the {role} by its label; give it a label, "
                    "or drop legend",
                    path=f"marks[{len(self._marks)}].legend",
                )
        kinds = [mark["type"] for mark, _ in self._marks]
        layouts = [kind for kind in kinds if kind in _LAYOUT_MARKS]
        # The layers of a map, and of a 3D chart, share their chart with each other only.
        layers = any(
            spec["type"] in group and set(kinds) <= set(group) for group in (_MAP_MARKS, _MARKS_3D)
        )
        method = _method(spec["type"])
        if self._panels:
            self._place_in_panels(spec)
        elif not layers and (layouts or (spec["type"] in _LAYOUT_MARKS and self._marks)):
            self._beside_layout(spec)
        if spec.get("axis") not in (None, "left", "right"):
            raise ChartError(
                f'{method} axis: expected "left" or "right"; received {shown(spec["axis"])}'
            )
        if self._panels:
            panel = spec.get("panel")
            ids = [p.id for p in self._panels]
            if panel is None:
                raise ChartError(
                    f'{method} panel: expected the id of a panel, or "*" for every panel; '
                    "received None"
                )
            if panel != "*" and panel not in ids:
                raise ChartError(
                    f"{method} panel: no panel {shown(panel)}; "
                    f"the chart has {', '.join(map(shown, ids))}",
                    code="unknown-reference",
                    path=f"marks[{len(self._marks)}].panel",
                    mark=len(self._marks) if spec.get("id") is None else spec["id"],
                )
        elif spec.get("panel") is not None:
            raise ChartError(f"{method} panel: the chart has no panels; drop panel")
        if self._facets and table is not None and spec.get("facet") is None:
            if spec["type"] == "dendrogram":
                raise ChartError(
                    "dendrogram facet: a tree cannot be split across facet panels; "
                    'give facet="repeat" to draw it whole in each'
                )
            for option, field in (
                ("facet", self._facet),
                ("facet_row", self._facet_row),
                ("facet_column", self._facet_column),
            ):
                self._require(table, field, ("category",), f"Chart {option}")
        self._check_categories(spec, table)
        self._marks.append((spec, table))
        return self

    def _beside_layout(self, spec: dict[str, Any]) -> None:
        """Refuses, as the browser does, a second layout mark in a chart (or its
        facet panels) that has one, and marks beside it other than text, rules,
        and regions placed by its items or in pixels (see `_check_decoration`)."""
        layout = next((mark for mark, _ in self._marks if mark["type"] in _LAYOUT_MARKS), spec)
        kind = layout["type"]
        # The layers of a map, and of a 3D chart, are drawn as one layout mark.
        group = next((group for group in (_MAP_MARKS, _MARKS_3D) if kind in group), ())
        if spec is not layout and spec["type"] in _LAYOUT_MARKS and spec["type"] not in group:
            where = "each facet panel" if self._facets else "its chart"
            raise ChartError(
                f"{_method(kind)}: has {where} to itself; draw other marks in another chart"
            )
        beside = [mark for mark, _ in self._marks] if spec is layout else [spec]
        for mark in beside:
            if mark["type"] not in group:
                self._check_decoration(mark, layout, None)

    def _drawn_elsewhere(self, mark: Mapping[str, Any], layouts: list[Mapping[str, Any]]) -> None:
        """Refuses, as the browser does, a mark in a panel with axes placed by
        the items of one of ``layouts``, which draw in panels of their own."""
        followed = next(iter(_item_marks(mark)), None)
        owner = next((layout for layout in layouts if layout.get("id") == followed), None)
        if followed is not None and owner is not None:
            method = _method(mark["type"])
            raise ChartError(
                f"{method} item mark: {shown(followed)} is drawn in panel "
                f"{shown(owner['panel'])}; draw the {method} there"
            )

    def _check_decoration(
        self, mark: Mapping[str, Any], layout: Mapping[str, Any], panel: str | None
    ) -> None:
        """Refuses, as the browser does, a mark beside layout mark ``layout`` in
        its chart, facet panels, or subplot ``panel`` that is not placed by its
        items (``hg.ItemCoordinate``, ``hg.ItemAnchor``) or in pixels, and items
        of marks other than ``layout`` (one that gives its items' geometry)."""
        named = _named(layout["type"])
        name = named.split(" ", 1)[1]
        publishes = layout["type"] in _PUBLISHING
        method = _method(mark["type"])
        at = next(
            (k for k, (other, _) in enumerate(self._marks) if other is mark), len(self._marks)
        )
        where = {"path": f"marks[{at}]", "mark": mark.get("id", at)}
        by = f"by the {name}'s items or in pixels" if publishes else "in pixels"
        follows = _follows(mark)
        if follows is None:
            room = (
                "facet panels have"
                if self._facets
                else "chart has"
                if panel is None
                else "panel has"
            )
            others = f"place text, rules, or regions {by}"
            if mark["type"] in ("text", "rule", "region"):
                how = (
                    f"by the {name}'s items (hg.ItemCoordinate, or text from_=hg.ItemAnchor) "
                    "or in pixels (hg.Pixels, hg.Fraction)"
                    if publishes
                    else "in pixels (hg.Pixels, hg.Fraction)"
                )
                message = f"{method}: {named}'s {room} no x and y scales; place it {how}"
            elif panel is None:
                message = (
                    f"{method}: {named}'s {room} no x and y scales; draw the {method} in "
                    f"another chart, or {others}"
                )
            else:
                message = (
                    f"{method} panel: panel {shown(panel)} draws {named}, which has no x and y "
                    f"scales; name another panel, or {others}"
                )
            raise ChartError(message, code="unsupported", **where)
        ids = {layout.get("id")}
        if layout["type"] in _MAP_MARKS + _MARKS_3D:
            group = _MAP_MARKS if layout["type"] in _MAP_MARKS else _MARKS_3D
            ids |= {other.get("id") for other, _ in self._marks if other["type"] in group}
        for id in follows:
            source: Mapping[str, Any] | None = next(
                (other for other, _ in self._marks if other.get("id") == id), None
            )
            if source is None and id in ids:
                source = layout
            problem = (
                f"no mark has id {shown(id)}; give the id of the {name} it follows"
                if source is None
                else f"{shown(id)} is {_named(source['type'])}, which has no layout "
                "items; give a layout mark's id"
                if source["type"] not in _LAYOUT_MARKS
                else f"{shown(id)} is drawn in another panel; draw the {method} in its panel"
                if id not in ids
                else f"{shown(id)} is {named}, whose items give no geometry to place by; "
                "follow a pie, funnel, treemap, or sunburst"
                if not publishes
                else None
            )
            if problem is not None:
                raise ChartError(
                    f"{method} item mark: {problem}",
                    code="unknown-reference" if source is None else "invalid-option",
                    **where,
                )

    def _place_in_panels(self, spec: dict[str, Any]) -> None:
        """Refuses, as the browser would, a layout mark (a pie) without a panel of
        its own, and marks drawing in a panel a layout mark has to itself."""
        kind, panel = spec["type"], spec.get("panel")
        method = _method(kind)
        layouts = {mark["panel"]: mark for mark, _ in self._marks if mark["type"] in _LAYOUT_MARKS}
        held = {key: _method(mark["type"]) for key, mark in layouts.items()}
        # Layers of a map or a 3D box can share their panel.
        layer = any(
            kind in group and held.get(panel) in {_method(item) for item in group}
            for group in (_MAP_MARKS, _MARKS_3D)
        )
        if kind not in _LAYOUT_MARKS:
            if panel == "*" and held:
                first = next(iter(held))
                raise ChartError(
                    f'{method} panel: "*" would draw in panel {shown(first)}, which a '
                    f"{held[first]} has to itself; give the id of a panel with axes"
                )
            if panel in layouts:
                # Beside it, marks placed by its items or in pixels.
                self._check_decoration(spec, layouts[panel], panel)
            else:
                self._drawn_elsewhere(spec, list(layouts.values()))
            return
        if panel is None or panel == "*":
            raise ChartError(
                f"{method} panel: expected the id of the panel it draws in; received {shown(panel)}"
            )
        if panel in held and not layer:
            raise ChartError(
                f"{method} panel: a {held[panel]} has panel {shown(panel)} to itself; "
                f"give the {method} a panel of its own"
            )
        for mark, _ in self._marks:
            other = _method(mark["type"])
            if mark.get("panel") == "*":
                raise ChartError(
                    f'{method} panel: the {other} with panel="*" draws in panel {shown(panel)} '
                    f"too, and a {method} has its panel to itself; give the {other} the id of "
                    "a panel with axes"
                )
            if mark.get("panel") == panel and not layer and mark["type"] in _LAYOUT_MARKS:
                raise ChartError(
                    f"{method} panel: a {other} draws in panel {shown(panel)}, and a {method} "
                    "has its panel to itself; give one of them another panel"
                )
            if mark.get("panel") == panel and not layer:
                self._check_decoration(mark, spec, panel)
            elif mark.get("panel") not in layouts:
                self._drawn_elsewhere(mark, [spec])
        own = next((p for p in self._panels if p.id == panel), None)
        if own is not None and (own.x is not None or own.y is not None or own.y_right is not None):
            axis = "x" if own.x is not None else "y" if own.y is not None else "y_right"
            raise ChartError(
                f"Panel {axis}: panel {shown(panel)} draws a {method}, which has no axes; "
                f"drop the panel's {axis}"
            )

    def _check_categories(self, spec: dict[str, Any], table: int | None) -> None:
        """Refuses, as the browser would, what panels with categories of their own
        (an x or y scope other than ``"chart"`` on a category axis) cannot do
        yet: sync, and brush along a y axis of such categories."""
        if table is None or not (self._facets or self._panels):
            return
        kind = spec["type"]
        for axis in ("x", "y"):
            scope = scope_of(self._settings, axis, subplots=bool(self._panels))
            field = spec.get(axis)
            # Calendars band days of the week, and in months days of the month too.
            calendar = kind == "heatmap" and spec.get("date") is not None
            leaf_axis = "y" if spec.get("side") in ("left", "right") else "x"
            banded = (
                (kind == "dendrogram" and axis == leaf_axis)
                or (kind == "heatmap" and spec.get(f"{axis}Banded") is True)
                or (calendar and (axis == "y" or spec.get("calendar") == "months"))
                or (isinstance(field, str) and self._kind(table, field) == "category")
            )
            if scope == "chart" or not banded:
                continue
            if self._settings["sync"] is not None:
                raise ChartError(
                    f"Chart sync: panels with categories of their own ({axis} scope "
                    f'{shown(scope)}) cannot sync yet; drop sync or give {axis} scope "chart"'
                )


# The families' methods return the chart, a class their modules import for
# type checking alone, since it is built from them. Each module holds it at
# runtime too, so that typing.get_type_hints reads their hints as it reads
# the chart's own.
for _family in _marks.FAMILIES:
    vars(_family)["Chart"] = Chart


_C = ParamSpec("_C")


def _in_panel(
    method: Callable[Concatenate[Chart, _C], Chart],
) -> Callable[Concatenate[Panel, _C], Panel]:
    """`method` of the chart, drawing in the panel it is called on."""
    name = method.__name__

    @functools.wraps(method)
    def call(self: Panel, *args: _C.args, **kwargs: _C.kwargs) -> Panel:
        chart = self._bound(name)
        given = kwargs.get("panel")
        if given is not None and not (isinstance(given, str) and given == self.id):
            raise ChartError(
                f"Panel.{name} panel: the mark draws in panel {shown(self.id)}, whose method it "
                f"is; drop panel={shown(given)}",
                path=f"marks[{len(chart._marks)}].panel",
            )
        kwargs["panel"] = self.id
        method(chart, *args, **kwargs)
        return self

    return call


@refuses
@dataclass
class Panel:
    """One of a chart's panels: marks with ``panel=id`` draw in it, and a
    panel the chart's ``columns``, ``rows``, ``grid``, or ``mosaic`` made
    takes marks through its methods, which return the panel::

        left, right = chart.columns([2, 1])
        latency = left.panel("latency", title="p99").line(x="time", y="p99")
        latency.legend(place=hg.Place(inside="top-left"))

    ``x``, ``y``, and ``y_right`` set the panel's own axes over the chart's
    ``x``, ``y``, and ``y_right`` (the right axis of its marks with
    ``axis="right"``); panels sharing a scale take the first one's.
    ``zoom``, ``pan``, ``brush``, ``bindings``, ``limits``, ``rotate``, and
    ``drag`` set how the panel answers input in place of the chart's
    settings, one by one: ``zoom=False`` turns the chart's zoom off there
    (``rotate=False`` stops a 3D panel turning, ``drag=True`` moves a
    network's nodes in a network panel), ``bindings`` replace the chart's
    list, and each scale's ``limits`` replace the chart's for that scale
    (``hg.ViewLimits()`` clears them); panels sharing a scale must agree on
    its limits. What the chart shares with other charts (``sync``) is the
    chart's.
    """

    id: str
    title: str | Title | dict[str, Any] | None = None
    y: AxisOptions | dict[str, Any] | None = None
    x: AxisOptions | dict[str, Any] | None = None
    y_right: AxisOptions | dict[str, Any] | None = None
    camera: Camera | dict[str, Any] | None = None
    style: Style | dict[str, Any] | None = None
    zoom: bool | Literal["x", "y", "xy"] | None = None
    pan: bool | Literal["x", "y", "xy"] | None = None
    brush: Literal["x", "y", "xy", "lasso"] | Brush | None = None
    bindings: Sequence[Binding] | None = None
    limits: Mapping[str, ViewLimits] | None = None
    rotate: bool | None = None
    drag: bool | None = None
    # The chart whose layout made the panel, and the insets drawn over it.
    _chart: Chart | None = dataclass_field(default=None, init=False, repr=False, compare=False)
    _insets: list[_Inset] = dataclass_field(
        default_factory=list, init=False, repr=False, compare=False
    )

    def _spec(self) -> dict[str, Any]:
        spec = {
            "id": self.id,
            "title": title_spec(self.title, "Panel title", placed=False),
            "style": style_spec(self.style, "Panel style", PANEL_ROLES),
            "x": _axis(self.x, "Panel x"),
            "y": _axis(self.y, "Panel y"),
            "yRight": _axis(self.y_right, "Panel y_right"),
            "camera": _camera(self.camera, "Panel camera", partial=True),
            "interaction": panel_interaction_spec(
                Role("Panel"),
                zoom=self.zoom,
                pan=self.pan,
                brush=self.brush,
                bindings=self.bindings,
                limits=self.limits,
                rotate=self.rotate,
                drag=self.drag,
            ),
        }
        return {key: value for key, value in spec.items() if value is not None}

    def _layout_spec(self) -> dict[str, Any]:
        spec: dict[str, Any] = {"type": "panel", "panel": self.id}
        if self._insets:
            spec["insets"] = [inset._spec() for inset in self._insets]
        return spec

    def _bound(self, method: str) -> Chart:
        if self._chart is None:
            raise ChartError(
                f"Panel.{method}: the panel belongs to no chart's layout; add marks with "
                f"chart.{method}(..., panel={self.id!r}), or make the panel with "
                "chart.columns(...)[0].panel(...)"
            )
        return self._chart

    def inset(
        self,
        id: str | None = None,
        *,
        place: Place | Position | None = None,
        anchor: InsetAnchor | None = None,
        width: Fraction | Pixels | None = None,
        height: Fraction | Pixels | None = None,
        indicator: bool | InsetIndicator | None = None,
        title: str | Title | dict[str, Any] | None = None,
        x: AxisOptions | dict[str, Any] | None = None,
        y: AxisOptions | dict[str, Any] | None = None,
        y_right: AxisOptions | dict[str, Any] | None = None,
        camera: Camera | dict[str, Any] | None = None,
        style: Style | dict[str, Any] | None = None,
        zoom: bool | Literal["x", "y", "xy"] | None = None,
        pan: bool | Literal["x", "y", "xy"] | None = None,
        brush: Literal["x", "y", "xy", "lasso"] | Brush | None = None,
        bindings: Sequence[Binding] | None = None,
        limits: Mapping[str, ViewLimits] | None = None,
        rotate: bool | None = None,
        drag: bool | None = None,
    ) -> Panel:
        """A panel drawn over this one's plot, with scales of its own unless
        a scope names it: at ``place`` (``hg.Place(inside="top-right")``,
        the default, or an ``hg.Position`` of fractions or pixels with its
        ``anchor`` there, its top-left corner by default), ``width`` and
        ``height`` (``hg.Fraction`` of this panel's plot, 0.35 by default, or
        ``hg.Pixels``). ``indicator=True`` draws a box on this panel around
        the inset's x and y ranges, with lines to the inset's corners; a dict
        of ``connectors`` and ``style`` (an ``hg.StrokeStyle``) changes how.
        ``camera`` (an inset of 3D marks), ``zoom``, ``pan``, ``brush``,
        ``bindings``, ``limits``, ``rotate``, and ``drag`` are its own, as
        ``hg.Panel`` takes them.
        It takes marks through its methods, as a panel does::

            detail = latency.inset("detail", x=hg.AxisOptions(domain=(start, end)),
                                   indicator=True)
            detail.line(x="time", y="p99", color="region")
        """
        chart = self._bound("inset")
        role = "Panel.inset"
        # How it is placed is the method's; its settings are the chart's panels' (see _new_panel).
        with refusing((role,), ("place", "anchor", "width", "height", "indicator")):
            placement: dict[str, Any] = {
                "place": place,
                "anchor": anchor,
                "width": width,
                "height": height,
                "indicator": indicator,
            }
            hints = hints_of(Panel.inset)
            placement |= check_hints(role, placement, {name: hints[name] for name in placement})
            spec = inset_spec(**placement, role=role)
        made = chart._new_panel(
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
        self._insets.append(_Inset(made, spec))
        return made

    @_settings("Panel.legend")
    def legend(
        self,
        *,
        place: Place | dict[str, Any] | None = None,
        columns: int | None = None,
        rows: int | None = None,
        order: Literal["row", "column"] | None = None,
        title: str | dict[str, Any] | None = None,
        swatches: Literal["mark"] | None = None,
        style: Style | dict[str, Any] | None = None,
    ) -> Panel:
        """A legend of what this panel draws, above it by default, or where
        ``place`` says (``hg.Place(inside="top-left")``); its entries hide and
        show what they name in this panel (the chart's legend, in every
        panel). The chart keeps its legend for what panels' legends leave
        out; ``legend=False`` on the chart leaves it out."""
        chart = self._bound("legend")
        from ._guides import legend as legend_guide

        guide = legend_guide(
            panel=self.id,
            place=place,
            columns=columns,
            rows=rows,
            order=order,
            title=title,
            swatches=swatches,
            style=style,
        )
        guide._spec()  # its options are refused here, not as the chart is output
        chart._panel_guides.append(guide)
        return self

    line = _in_panel(Chart.line)
    area = _in_panel(Chart.area)
    bar = _in_panel(Chart.bar)
    rug = _in_panel(Chart.rug)
    errorbar = _in_panel(Chart.errorbar)
    segment = _in_panel(Chart.segment)
    point = _in_panel(Chart.point)
    histogram = _in_panel(Chart.histogram)
    candlestick = _in_panel(Chart.candlestick)
    pie = _in_panel(Chart.pie)
    gauge = _in_panel(Chart.gauge)
    funnel = _in_panel(Chart.funnel)
    boxplot = _in_panel(Chart.boxplot)
    boxen = _in_panel(Chart.boxen)
    violin = _in_panel(Chart.violin)
    treemap = _in_panel(Chart.treemap)
    sunburst = _in_panel(Chart.sunburst)
    radar = _in_panel(Chart.radar)
    sankey = _in_panel(Chart.sankey)
    graph = _in_panel(Chart.graph)
    geoshape = _in_panel(Chart.geoshape)
    geopoint = _in_panel(Chart.geopoint)
    point_3d = _in_panel(Chart.point_3d)
    line_3d = _in_panel(Chart.line_3d)
    surface = _in_panel(Chart.surface)
    heatmap = _in_panel(Chart.heatmap)
    contour = _in_panel(Chart.contour)
    dendrogram = _in_panel(Chart.dendrogram)
    rule = _in_panel(Chart.rule)
    region = _in_panel(Chart.region)
    text = _in_panel(Chart.text)


def _layout_option(layout: Any) -> dict[str, Any] | None:
    """A chart's ``layout`` as the spec takes it: an ``hg.Grid``, or a dict of the spec's layout."""
    if layout is None:
        return None
    if isinstance(layout, Grid):
        return layout._spec()
    if isinstance(layout, Mapping):
        return dict(layout)
    raise ChartError(
        "Chart layout: expected an hg.Grid or a dict of a layout; lay panels out cell by cell "
        f"with chart.columns, rows, grid, or mosaic; received {shown(layout)}"
    )


#: Marks that lay out their own chart, with no axes.
_LAYOUT_MARKS = (
    *("pie", "treemap", "sunburst", "gauge", "funnel", "radar", "sankey", "graph"),
    *("geoshape", "geopoint", "point3d", "line3d", "surface"),
)

#: Layout marks whose charts select rows (maps too), in panels as well.
_SELECTING_LAYOUT_MARKS = ("pie", "funnel", "treemap", "sunburst", "sankey", "graph")

#: The layers of maps, which share a chart and its projection.
_MAP_MARKS = ("geoshape", "geopoint")

#: The layers of 3D charts, which share a chart, its box, and its camera.
_MARKS_3D = ("point3d", "line3d", "surface")

#: Chart methods whose names differ from the type of the mark they add.
_METHODS = {"point3d": "point_3d", "line3d": "line_3d"}

#: Layout marks whose items give the geometry other marks are placed by.
_PUBLISHING = ("pie", "funnel", "treemap", "sunburst")


def _named(kind: str) -> str:
    """A mark of a spec type as messages name it: "a treemap", "an area";
    the layers of a map, "a map", and of a 3D chart, "a 3D plot"."""
    name = "map" if kind in _MAP_MARKS else "3D plot" if kind in _MARKS_3D else _method(kind)
    return f"{'an' if name[0] in 'aeiou' else 'a'} {name}"


def _places(spec: Mapping[str, Any]) -> list[Any]:
    """The positions a text, rule, or region mark is placed by."""
    given = [spec.get(name) for name in ("x", "y", "x1", "x2", "y1", "y2")]
    given += [*(spec.get("span") or ()), *(spec.get("at") or {}).values()]
    return [place for place in given if place is not None]


def _item_marks(spec: Mapping[str, Any]) -> list[str]:
    """The ids of the marks whose items a mark names to be placed by."""
    if spec["type"] not in ("text", "rule", "region"):
        return []
    anchor = spec.get("from")
    places = [anchor] if anchor is not None and "item" in anchor else []
    places += [p["item"] for p in _places(spec) if isinstance(p, Mapping) and "item" in p]
    return list(dict.fromkeys(place["mark"] for place in places))


def _follows(spec: Mapping[str, Any]) -> list[str] | None:
    """The ids of the layout marks whose items a text, rule, or region mark
    is placed by, when it is placed only by items or in pixels (and so can
    draw beside a layout mark); None otherwise."""
    if spec["type"] not in ("text", "rule", "region"):
        return None
    anchor = spec.get("from")
    if anchor is not None:
        return [anchor["mark"]] if "item" in anchor else None
    if not all(
        isinstance(place, Mapping) and {"item", "fraction", "px"} & set(place)
        for place in _places(spec)
    ):
        return None
    return _item_marks(spec)


def _method(kind: str) -> str:
    """The Chart method that adds marks of a spec type, as messages name marks."""
    return _METHODS.get(kind, kind)


def _dropped(option: str) -> str:
    """The keyword to drop for an option as `_x_option` names it."""
    return "seams" if option == "x seams" else option


#: A graph's fields that are columns of its nodes.
_NODE_FIELDS = ("node", "color", "size")


#: Chart options a live chart can change after display: all but data and facets,
#: which decide the columns sent.
#: Where the chart's own options are, as their refusals say it.
_CHART = Role("Chart")

OPTIONS = (
    *("title", "description", "fields", "width", "height", "x", "y", "y_right", "legend"),
    "padding",
    *("scales", "guides"),
    *("inspection", "tooltip"),
    *("zoom", "pan", "brush", "select", "bindings", "limits", "sync", "animation"),
    *("renderer", "theme"),
    *("locale", "time_zone", "projection", "z", "camera", "box_aspect", "rotate", "navigator"),
    *("drag", "toolbar"),
)


def on_right_axis(spec: Mapping[str, Any]) -> bool:
    """Whether a mark places values on the right y axis: with ``axis="right"``,
    unless it is a rule at an x or a region across an x range, which have no y."""
    if spec.get("axis") != "right":
        return False
    return spec["type"] not in ("rule", "region") or any(
        spec.get(key) is not None for key in ("y", "y1", "y2")
    )


def check_layout_options(
    settings: Mapping[str, Any],
    layouts: Sequence[Mapping[str, Any]],
    subplots: int,
) -> None:
    """Checks what a chart's layout marks (``layouts``, their specs) take of its
    interaction options, as the browser does: in a chart of their own or facet
    panels, each kind its own; among ``subplots`` subplots, what panels with
    axes take beside them, or what they take when no panel has axes. Panels
    without axes have no scales to share."""
    if settings.get("drag") and not any(mark["type"] == "graph" for mark in layouts):
        raise ChartError(
            "Chart drag: moves a network's nodes, and the chart has no graph; drop drag"
        )
    # Standalone 3D charts check their options as marks are added.
    if not subplots:
        layouts = [mark for mark in layouts if mark["type"] not in _MARKS_3D]
    if not subplots:
        for kind in dict.fromkeys(mark["type"] for mark in layouts):
            _check_alone(settings, kind)
        if not layouts:
            return
    elif len({mark["panel"] for mark in layouts}) < subplots:
        # Maps and networks beside panels with axes pan and zoom as those do.
        return
    else:
        _check_subplots(settings, layouts)
    # Layout marks have a subplot each, and facet panels draw the same marks.
    scoped = next(
        (
            axis
            for axis in ("x", "y", "y_right")
            if axis_scope(settings, axis) not in (None, "chart")
        ),
        None,
    )
    if scoped is not None:
        raise ChartError(
            f"Chart {scoped} scope: every panel draws a {_method(layouts[0]['type'])} or another "
            f"mark without axes, so the panels have no scales to share; drop {scoped}'s scope"
        )


def _check_alone(settings: Mapping[str, Any], kind: str) -> None:
    """What a layout mark takes in a chart of its own or its facet panels: a
    treemap or sunburst drills with ``zoom=True``; maps and networks pan and
    zoom both ways (``zoom=True`` or ``"xy"``) and take a ``"lasso"`` brush;
    only a network's nodes drag; nothing syncs or has x seams."""
    zoom, brush, pan = settings.get("zoom"), brush_shape(settings.get("brush")), settings.get("pan")
    if kind in _MAP_MARKS:
        if zoom in ("x", "y"):
            raise ChartError(
                f'Chart zoom: expected True or "xy", as maps zoom both ways; received {shown(zoom)}'
            )
        if pan in ("x", "y"):
            raise ChartError(
                f'Chart pan: expected True or "xy", as maps pan both ways; received {shown(pan)}'
            )
        if brush not in (None, "lasso"):
            raise ChartError(f'Chart brush: expected "lasso" for maps; received {shown(brush)}')
    if settings.get("drag") and kind != "graph":
        raise ChartError(f"Chart drag: moves a network's nodes, and a {kind} has none; drop drag")
    drills = kind in ("treemap", "sunburst")
    if drills and zoom not in (True, False, None):
        raise ChartError(
            f"Chart zoom: a {kind} drills with zoom=True, not along an axis; received {shown(zoom)}"
        )
    if kind == "graph":
        if pan not in (True, False, None, "xy"):
            raise ChartError(
                f"Chart pan: a graph pans both ways, received {shown(pan)}; "
                "use pan=True or pan='xy'"
            )
        if zoom not in (True, False, None, "xy"):
            raise ChartError(
                f"Chart zoom: a graph pans and zooms both ways, received {shown(zoom)}; "
                "use zoom=True or zoom='xy'"
            )
        if brush not in (None, "lasso"):
            raise ChartError(
                f"Chart brush: a graph takes only a lasso, received {shown(brush)}; "
                "use brush='lasso'"
            )
    used = _x_option(
        settings,
        ("limits", "sync")
        if kind == "graph" or kind in _MAP_MARKS
        else ("pan", "brush", "limits", "sync")
        if drills
        else ("zoom", "pan", "brush", "limits", "sync"),
    )
    if used is not None:
        raise ChartError(f"Chart {used}: a {kind} has no x axis to act on; drop {_dropped(used)}")


def _check_subplots(settings: Mapping[str, Any], layouts: Sequence[Mapping[str, Any]]) -> None:
    """What subplots that all draw layout marks, so that no panel has axes,
    take: trees drill with ``zoom=True``; maps and networks pan and zoom both
    ways and take lassos."""
    zoom, brush, pan = settings.get("zoom"), brush_shape(settings.get("brush")), settings.get("pan")
    kinds = {mark["type"] for mark in layouts}
    planes = kinds & {"graph", *_MAP_MARKS}
    takes = {
        "zoom": zoom is True
        and bool(planes or kinds & {"treemap", "sunburst", *_MARKS_3D})
        or (zoom == "xy" and bool(planes)),
        "pan": pan in (True, "xy") and bool(planes),
        "brush": brush == "lasso" and bool(planes),
    }
    options = ("zoom", "pan", "brush", "limits", "sync")
    used = _x_option(settings, tuple(name for name in options if not takes.get(name, False)))
    if used is not None:
        raise ChartError(
            f"Chart {used}: every panel draws a {_method(layouts[0]['type'])} or another mark "
            f"without axes, so no panel has an x axis; drop {_dropped(used)}"
        )


def _x_option(settings: Mapping[str, Any], options: Sequence[str]) -> str | None:
    """The first of a chart's `options` that is set, or else "x seams" when the x
    axis marks seams: what acts on an x axis, as messages name it."""
    used = next((name for name in options if settings.get(name)), None)
    seams = (spec_options(dict(settings)).get("x") or {}).get("seams")
    return used or ("x seams" if seams not in (None, False) else None)


def _any_table(data: Any) -> str:
    """A table's name for data matched before the chart's tables are known: checked, not named."""
    return ""


def spec_options(settings: dict[str, Any], table_name: TableName = _any_table) -> dict[str, Any]:
    """The spec's chart options from Chart's keyword arguments, unset ones
    left out; data field displays match as tables named by ``table_name``."""
    tooltip = settings["tooltip"]
    animation = settings["animation"]
    for name in ("width", "height"):
        _size(settings[name], f"Chart {name}")
    if isinstance(tooltip, str) and tooltip in get_args(InspectionMode):
        raise ChartError(
            "Chart tooltip: the mode is the inspection's; give "
            f"inspection=hg.InspectionOptions(mode={shown(tooltip)})"
        )
    if not (tooltip is None or isinstance(tooltip, (bool, Tooltip))):
        raise ChartError(
            f"Chart tooltip: expected True, False, or an hg.Tooltip; received {shown(tooltip)}"
        )
    inspection = settings.get("inspection")
    if not (inspection is None or inspection is False or isinstance(inspection, InspectionOptions)):
        raise ChartError(
            "Chart inspection: expected an hg.InspectionOptions, or False; received "
            f"{shown(inspection)}"
        )
    if inspection is False and isinstance(tooltip, Tooltip) and tooltip.pin is not None:
        raise ChartError(
            "Chart tooltip pin: pins what the pointer inspects; drop inspection=False",
            path="tooltip.pin",
        )
    choice_option(settings["renderer"], ("auto", "svg", "canvas"), "Chart renderer")
    if isinstance(settings["theme"], str):
        choice_option(settings["theme"], get_args(ThemeName), "Chart theme")
    _flag(settings.get("rotate"), "Chart rotate")
    _flag(settings.get("drag"), "Chart drag")
    _flag(settings.get("toolbar"), "Chart toolbar")
    interaction: dict[str, Any] = {
        key: value
        for key, value in {
            "zoom": preset_spec(settings["zoom"], _CHART.field("zoom")) or None,
            "brush": brush_spec(settings["brush"], _CHART.field("brush")),
            "select": select_spec(settings.get("select"), _CHART.field("select")),
            "bindings": bindings_spec(settings.get("bindings"), _CHART.field("bindings")),
            "limits": limits_spec(settings.get("limits"), _CHART.field("limits")),
            "sync": sync_spec(settings["sync"], _CHART.field("sync")),
        }.items()
        if value
    }
    # False pans nothing, where zoom would.
    if settings.get("pan") is not None:
        interaction["pan"] = preset_spec(settings["pan"], _CHART.field("pan"))
    # Dragging turns 3D charts unless asked not to.
    if settings.get("rotate") is False:
        interaction["rotate"] = False
    # Dragging moves a network's nodes when asked to.
    if settings.get("drag"):
        interaction["drag"] = True
    # Controls show their buttons unless asked not to.
    if settings.get("toolbar") is False:
        interaction["toolbar"] = False
    # Axes', scales', and guides' new settings at their own paths, then each as a whole.
    for name in ("x", "y", "y_right", "z"):
        _check_axis_dict(settings.get(name), name)
    _check_scale_dicts(settings.get("scales"))
    guides = settings.get("guides")
    placed = [("legend", settings["legend"])] + (
        [(f"guides[{i}]", guide) for i, guide in enumerate(guides)]
        if isinstance(guides, Sequence) and not isinstance(guides, (str, bytes))
        else []
    )
    for at, guide in placed:
        problem = guide_problem(guide)
        if problem:
            raise ChartError(f"{at}.{problem[0]}: {problem[1]}", path=f"{at}.{problem[0]}")
    options = {
        "title": title_spec(settings["title"], "Chart title", placed=True),
        "description": settings["description"],
        "fields": located(
            None, lambda: fields_spec(settings.get("fields"), "Chart fields", table_name), "Chart"
        ),
        "width": settings["width"],
        "height": settings["height"],
        "x": _axis(settings["x"]),
        "y": _axis(settings["y"], "Chart y"),
        "yRight": _axis(settings["y_right"], "Chart y_right"),
        "legend": located("legend", lambda: legend_spec(settings["legend"]), "LegendOptions"),
        "scales": located("scales", lambda: scales_spec(settings.get("scales"))),
        "guides": located("guides", lambda: guides_spec(settings.get("guides"))),
        "padding": insets(settings.get("padding"), _CHART.field("padding")),
        "inspection": located("inspection", inspection._spec, "InspectionOptions")
        if isinstance(inspection, InspectionOptions)
        else inspection,
        "tooltip": located("tooltip", tooltip._spec, "Tooltip", "Chart tooltip")
        if isinstance(tooltip, Tooltip)
        else tooltip,
        "interaction": interaction or None,
        "animation": located("animation", lambda: _animation(animation), "Animation"),
        "renderer": settings["renderer"],
        "theme": located("theme", lambda: theme_spec(settings["theme"])),
        "locale": settings["locale"],
        "timeZone": settings["time_zone"],
        "projection": located("projection", lambda: _projection(settings.get("projection"))),
        "z": _axis(settings.get("z"), "Chart z"),
        "camera": located("camera", lambda: _camera(settings.get("camera"))),
        "boxAspect": _box_aspect(settings.get("box_aspect")),
        "navigator": located(
            "navigator", lambda: _navigator(settings.get("navigator")), "Navigator"
        ),
        # The first state, which the chart changes as it is used.
        "selection": located(
            "selection",
            lambda: selection_option(settings.get("selection")),
            "BrushSelection",
            "ItemSelection",
            "SeriesSelection",
        ),
        "viewport": located(
            "viewport", lambda: viewport_option(settings.get("viewport")), "Viewport"
        ),
        "visibility": located("visibility", lambda: visibility_option(settings.get("visibility"))),
        "drillRoot": located("drill_root", lambda: drill_root_option(settings.get("drill_root"))),
    }
    return {key: value for key, value in options.items() if value is not None}


def assemble_spec(
    options: dict[str, Any],
    layout: dict[str, Any],
    tables: dict[str, dict[str, Column]],
    marks: list[dict[str, Any]],
    derived: dict[str, dict[str, Any]] | None = None,
    matrices: dict[str, dict[str, str]] | None = None,
    origins: dict[str, str] | None = None,
    ordered: dict[str, dict[str, Any]] | None = None,
) -> tuple[dict[str, Any], list[bytes]]:
    """A spec and its buffers from chart options, columns by table name, mark
    specs, derived tables by name, the coordinates of matrix tables, the
    tables others are made from (`origin`), and ordered tables' `orderBy`
    and `maxRows`, by name."""
    buffers: list[bytes] = []
    spec: dict[str, Any] = {"version": _SPEC_VERSION, **options}
    for key, value in layout.items():
        spec[key] = (
            {k: v for k, v in value.items() if v is not None} if isinstance(value, dict) else value
        )
    if tables or derived:
        spec["data"] = {
            name: {
                "columns": columns_spec(columns, buffers),
                **({"matrix": matrices[name]} if matrices and name in matrices else {}),
                **({"origin": origins[name]} if origins and name in origins else {}),
                **(ordered.get(name, {}) if ordered else {}),
            }
            for name, columns in tables.items()
        }
        spec["data"].update(derived or {})
    # After the columns', so that a selection changes no column's buffer index.
    if "rowSelection" in options:
        spec["rowSelection"] = _selection_buffers(options["rowSelection"], buffers)
    spec["marks"] = marks
    return spec, buffers


def _selection_buffers(rows: Any, buffers: list[bytes]) -> Any:
    """A spec's row selection with the rows its bindings start with (bytes of
    uint32 positions) appended to `buffers`, which they then index."""

    def one(binding: dict[str, Any]) -> dict[str, Any]:
        selection = binding.get("selection")
        if selection is None or not isinstance(selection.get("rows"), bytes):
            return binding
        buffers.append(selection["rows"])
        return {**binding, "selection": {**selection, "rows": len(buffers) - 1}}

    return [one(binding) for binding in rows] if isinstance(rows, list) else one(rows)


def columns_spec(columns: dict[str, Column], buffers: list[bytes]) -> dict[str, Any]:
    """Spec columns whose values are appended to `buffers`, which they index."""
    return {field: _column_spec(column, buffers) for field, column in columns.items()}


class _Columns(Protocol):
    """What charts read of a table: its column names and, by name, its columns."""

    @property
    def names(self) -> tuple[str, ...]: ...

    def column(self, name: str) -> Column: ...


class _DerivedColumns:
    """A derived table's columns (or groups' or totals'), as charts check
    fields: names and kinds, no values."""

    def __init__(self, derived: Derived | RowGroups | RowTotals) -> None:
        self.names = tuple(derived._kinds)
        self._kinds = derived._kinds

    def column(self, name: str) -> Column:
        if name not in self._kinds:
            raise KeyError(name)
        return Column(self._kinds[name], np.empty(0))


def _convertible(columns: _Columns) -> str:
    """The first of a table's columns that converts, to send for its rows alone."""
    errors: list[Exception] = []
    for name in columns.names:
        try:
            columns.column(name)
        except (TypeError, ValueError) as error:
            errors.append(error)
            continue
        return name
    raise ChartError(
        "derive: counting the rows of this data needs one column of numbers, strings, "
        f"or dates; column {columns.names[0]!r} holds unsupported values"
    ) from errors[0]


def table_name(index: int) -> str:
    return "data" if index == 0 else f"data{index + 1}"


def _fields(spec: dict[str, Any]) -> set[str]:
    fields: set[str] = set()
    for key in (
        *("x", "y", "x1", "x2", "y1", "y2", "xError", "yError", "series", "value"),
        "weight",
        *("category", "fields", "date"),
        *("path", "node", "parent", "source", "target", "linkLabelField"),
        *("open", "high", "low", "close"),
        *("first", "second", "height"),
        *("q1", "median", "q3", "count"),
        *("size", "fillOpacity", "color", "symbol", "itemKey"),
        *("geometry", "labelField", "longitude", "latitude", "z"),
    ):
        value = spec.get(key)
        if isinstance(value, str):
            fields.add(value)
        elif isinstance(value, list):
            # Fields' names (a point's channel list is `_feature_fields`').
            fields.update(name for name in value if isinstance(name, str))
        elif (field := coordinate_field_spec(value)) is not None:
            # A column's place, or the share or pixels a column gives.
            fields.add(field)
    # Text's places in `at`, and a rule's span.
    for place in [*(spec.get("at") or {}).values(), *(spec.get("span") or ())]:
        field = coordinate_field_spec(place)
        if field is not None:
            fields.add(field)
    # Items' names that columns give, in places on items and text from an item.
    places = [spec.get(key) for key in ("x", "y", "x1", "x2", "y1", "y2")]
    places += [*(spec.get("at") or {}).values(), *(spec.get("span") or ())]
    refs = [place["item"] for place in places if isinstance(place, dict) and "item" in place]
    anchor = spec.get("from")
    if isinstance(anchor, dict) and "item" in anchor:
        refs.append(anchor)
    for ref in refs:
        fields.update(name["field"] for name in ref["item"] if isinstance(name, dict))
    # Columns only tooltips show travel too: their fields, and what their
    # content's and heading's parts read (a ``label`` part, the column's display).
    tooltip = spec.get("tooltip") or {}
    for entry in tooltip.get("fields", ()):
        fields.add(entry if isinstance(entry, str) else entry["field"])
    for part in [*tooltip.get("content", ()), *tooltip.get("heading", ())]:
        for name in ("field", "label"):
            if isinstance(part, dict) and isinstance(part.get(name), str):
                fields.add(part[name])
    fields |= _feature_fields(spec)
    return fields


def coordinate_field_spec(place: Any) -> str | None:
    """The column a place in a spec reads: its own, or its share's or pixels'."""
    if isinstance(place, str):
        return place
    if isinstance(place, dict):
        share = place.get("fraction", place.get("px", place))
        if isinstance(share, dict) and isinstance(share.get("field"), str):
            return cast("str", share["field"])
    return None


def _feature_fields(spec: dict[str, Any]) -> set[str]:
    """The columns a mark's encodings, conditions, styles by value, labels,
    and places read."""
    fields: set[str] = set()
    channels = list((spec.get("encode") or {}).values())
    # A point's color, size, opacity, and symbol may be channels themselves.
    channels += [
        spec[key]
        for key in ("color", "size", "fillOpacity", "symbol")
        if isinstance(spec.get(key), (dict, list))
    ]
    # A segment's widths: a channel for the whole segment, or each end's.
    width = spec.get("width") if spec.get("type") == "segment" else None
    ends = (
        [width.get("from"), width.get("to")]
        if isinstance(width, dict) and "from" in width
        else [width]
    )
    channels += [end for end in ends if isinstance(end, (dict, list))]
    # A list's entries each, and the column a rank test ranks by.
    for _, channel in [entry for given in channels for entry in _entries("", given)]:
        if "field" in channel:
            fields.add(channel["field"])
        elif "condition" in channel:
            when = channel["condition"]["when"]
            fields |= {when["field"]} if isinstance(when, dict) else _fields_of(when)
    fields |= _fields_of(spec.get("where"))
    continuity = spec.get("continuity") or {}
    fields |= _fields_of(continuity.get("defined"))
    if isinstance(continuity.get("breakBy"), dict):
        fields.add(continuity["breakBy"]["field"])
    by = (spec.get("style") or {}).get("by") or {}
    if isinstance(by.get("field"), str):
        fields.add(by["field"])
    fields |= _label_fields(spec)
    for place in [*(spec.get("at") or {}).values(), *(spec.get("span") or ())]:
        if isinstance(place, str):
            fields.add(place)
        elif isinstance(place, dict) and isinstance(place.get("field"), str):
            fields.add(place["field"])
    return fields


def _read(source: _Columns, field: str, role: str, path: str | None = None) -> Column:
    """Column `field` of `source`, its values refused at the option reading
    it (``line y: column 'v': expected numbers, ...``)."""
    try:
        return source.column(field)
    except ChartError as error:
        problem = str(error).removeprefix(f"Column {field!r}: ")
        raise ChartError(f"{role}: column {field!r}: {problem}", path=path) from None


def _passes(data: Any, name: str) -> bool:
    """Whether column ``name`` of the rows of ``data``, a derived table, a
    view, or groups or totals, is its source's unchanged, as the engine's
    lineage says: no step makes or replaces it, and an aggregate (groups)
    keeps it as a group."""
    if isinstance(data, RowGroups):
        return name in data.by
    if isinstance(data, RowTotals):
        return False
    if not isinstance(data, Derived):
        return True
    for step in data.steps:
        if "aggregate" in step:
            if name not in step.get("by", []) or any(o["as"] == name for o in step["aggregate"]):
                return False
        elif name in _writes(step):
            return False
    return True


def _label_fields(spec: dict[str, Any]) -> set[str]:
    """The columns a mark's labels and series' names read: their field, and
    their parts' (a ``label`` part reads the column's display)."""
    fields: set[str] = set()
    for key in ("label", "labels"):
        label = spec.get(key)
        # A series' name of parts, or a label's content.
        parts = label if isinstance(label, list) else []
        if isinstance(label, dict):
            if isinstance(label.get("field"), str):
                fields.add(label["field"])
            parts = label.get("content") or []
        for part in parts:
            for name in ("field", "label"):
                if isinstance(part, dict) and isinstance(part.get(name), str):
                    fields.add(part[name])
    return fields


def _column_spec(column: Column, buffers: list[bytes]) -> dict[str, Any]:
    if column.kind == "geometry":
        shapes = column.shapes
        assert shapes is not None
        arrays = {
            "coordinates": shapes.coordinates,
            "ringOffsets": shapes.ring_offsets,
            "polygonOffsets": shapes.polygon_offsets,
            "geometryOffsets": shapes.geometry_offsets,
        }
        # Row i holds geometry i unless rows name their shapes otherwise.
        if not np.array_equal(column.values, np.arange(len(column.values))):
            arrays["codes"] = column.values
        spec: dict[str, Any] = {"type": "geometry"}
        for key, array in arrays.items():
            buffers.append(array.tobytes())
            spec[key] = len(buffers) - 1
        return spec
    buffers.append(column.values.tobytes())
    index = len(buffers) - 1
    if column.kind == "category":
        return {"type": "category", "codes": index, "dictionary": list(column.dictionary)}
    dtype = "float32" if column.values.dtype.itemsize == 4 else "float64"
    return {"type": column.kind, "dtype": dtype, "buffer": index}


def _check_axis_dict(axis: Any, at: str) -> None:
    """Refuses an axis' settings given as a dict whose ``padding`` or grid
    lines' ``z_index`` is malformed, at its own path (``x.padding``), as the
    engine's validator does, before the dict makes an ``hg.AxisOptions``."""
    if not isinstance(axis, Mapping):
        return
    padding = axis.get("padding")
    px: Any = padding.get("px") if isinstance(padding, Mapping) else None
    if isinstance(padding, Mapping) and not (_finite(px) and px >= 0):
        raise ChartError(
            f"{at}.padding.px: expected a number of at least 0; received {shown(px)}",
            path=f"{at}.padding.px",
        )
    if padding is not None:
        located(f"{at}.padding", lambda: padding_spec(padding, f"{at}.padding"))
    grid = axis.get("grid")
    z = grid.get("z_index") if isinstance(grid, Mapping) else None
    if z is not None and not _finite(z):
        raise ChartError(
            f"{at}.grid.z_index: expected a finite number; received {shown(z)}",
            path=f"{at}.grid.z_index",
        )


def _check_panel(panel: Any, at: str) -> None:
    """Refuses a panel's settings the spec cannot take, at ``at``
    (``panels[1]``): new ones at their own paths (text styles'
    ``vertical_align``, axes' ``padding`` and grid lines), then the rest at
    the panel."""
    problem = vertical_align_problem(panel, ())
    if problem:
        raise ChartError(f"{at}{problem[0]}: {problem[1]}", path=f"{at}{problem[0]}")
    for name in ("x", "y", "y_right"):
        _check_axis_dict(getattr(panel, name, None), f"{at}.{name}")
    if isinstance(panel, Panel):
        with refusing(("Panel",), _PANEL_OPTIONS, at):
            panel._spec()


#: What a panel takes, as refusals name it (``Panel zoom: ...``).
_PANEL_OPTIONS = frozenset(
    ("id", "title", "x", "y", "y_right", "camera", "style")
    + ("zoom", "pan", "brush", "bindings", "limits")
)


def _check_scale_dicts(scales: Any) -> None:
    """Refuses scales given as dicts whose ``padding`` or ``scope`` is
    malformed, at its own path (``scales["p.99"].padding``), as
    ``_check_axis_dict`` does."""
    if not isinstance(scales, Mapping):
        return
    for name, scale in scales.items():
        at = key_path("scales", str(name))
        _check_axis_dict(scale, at)
        scope = scale.get("scope") if isinstance(scale, Mapping) else None
        if scope is None:
            continue
        # Positions take layouts' rows and columns too; categories a chart or a panel.
        if name in ("x", "y", "y_right") or scale.get("type") in ("linear", "log", "time"):
            located(f"{at}.scope", functools.partial(scope_spec, scope, f"{at}.scope"))
        elif scope not in ("chart", "panel"):
            raise ChartError(
                f'{at}.scope: expected "chart" or "panel"; received {shown(scope)}',
                path=f"{at}.scope",
            )


def _axis(
    axis: AxisOptions | dict[str, Any] | None, role: str = "Chart x"
) -> dict[str, Any] | None:
    """An axis's spec; `role` is where it was given, as "Chart y" or "Panel
    x", refused within the chart or the panel."""
    if axis is None:
        return None
    owner, _, option = role.partition(" ")
    at = Role(owner).field(option)
    if isinstance(axis, dict):
        given = axis
        axis = located(at, lambda: _built(given, AxisOptions, role))
    if not isinstance(axis, AxisOptions):
        raise at.error(
            f"expected an hg.AxisOptions or a dict of its options; received {shown(axis)}"
        )
    if role != "Chart x" and axis.breaks is not None:
        raise at.field("breaks").error("only the chart's x axis takes breaks; drop them")
    if role != "Chart x" and axis.seams is not None:
        raise at.field("seams").error("only the chart's x axis takes seams; drop them")
    if role == "Chart z" and axis.style is not None:
        raise at.field("style").error("a 3D chart's axes take the theme's styles; drop style")
    # A panel's own axis and a 3D chart's z are laid out before parts are written.
    if role.startswith("Panel") or role == "Chart z":
        if axis.title is not None and not isinstance(axis.title, str):
            raise at.field("title").error(
                "a panel's own axis title and a 3D chart's z title are text; give text, or "
                "the title of parts on the chart's axis"
            )
    for name in ("scope", "repeat"):
        if role not in ("Chart x", "Chart y", "Chart y_right") and getattr(axis, name) is not None:
            raise at.field(name).error(
                f"only the chart's x, y, and y_right take {name}; move it there"
            )
    if role == "Chart z" and (axis.place, axis.room) != (None, None):
        name = "place" if axis.place is not None else "room"
        raise at.field(name).error(f"a 3D chart's axes are drawn along its box; drop {name}")
    if isinstance(axis.place, Place):
        if owner == "Panel":
            raise at.field("place").error(
                f"a panel's axes are on the chart's sides; give place on the chart's {option}"
            )
        sides, rule = AXIS_SIDES[option]
        if option == "y_right":
            raise at.field("place").error(f"{rule}; drop place")
        if axis.place.side not in sides:
            raise at.field("place").error(f"{rule}; received {shown(axis.place.side)}")
    return located(at, axis._spec) or None


def axis_scope(settings: Mapping[str, Any], axis: str) -> Any:
    """The scope the chart sets for its ``x``, ``y``, or ``y_right`` scale
    (``axis``), if any: in ``scales``, or else in the axis' options."""
    scales = settings.get("scales")
    for given in (scales.get(axis) if isinstance(scales, Mapping) else None, settings.get(axis)):
        if given is None:
            continue
        scope = given.get("scope") if isinstance(given, Mapping) else getattr(given, "scope", None)
        if scope is not None:
            return scope
    return None


def scope_of(settings: Mapping[str, Any], axis: str, *, subplots: bool) -> Any:
    """Which panels share the chart's ``x``, ``y``, or ``y_right`` scale: its
    own scope, or by default each subplot's own (x is the whole chart's with
    a navigator) or the whole chart in facets, and y's for y_right."""
    own = "panel" if subplots else "chart"
    if axis == "x":
        navigated = settings.get("navigator") not in (None, False)
        return axis_scope(settings, "x") or ("chart" if navigated else own)
    y = axis_scope(settings, "y") or own
    return y if axis == "y" else axis_scope(settings, "y_right") or y


def _projection(projection: Any) -> Any:
    """A projection's spec from a name, a Projection, or a dict of its fields."""
    if projection is None:
        return None
    if isinstance(projection, str):
        # A name alone is the option itself.
        if projection not in PROJECTIONS:
            raise ChartError(
                f"Chart projection: expected {listed(PROJECTIONS)}, or an hg.Projection; "
                f"received {shown(projection)}"
            )
        projection = Projection(projection)  # type: ignore[arg-type]
    elif isinstance(projection, Mapping):
        projection = _built(projection, Projection, "Chart projection")
    if not isinstance(projection, Projection):
        raise ChartError(
            "Chart projection: expected a projection's name, an hg.Projection, or a dict of its "
            f"fields; received {shown(projection)}"
        )
    return projection._spec()


def _animation(animation: Any) -> bool | dict[str, Any] | None:
    """The spec's animation: True, a duration, or Animation's options; None when off."""
    if animation is None or isinstance(animation, bool):
        return animation or None
    if isinstance(animation, Animation):
        return animation._spec()
    if not (_finite(animation) and animation >= 0):
        raise ChartError(
            "Chart animation: expected True, False, milliseconds of at least 0, or an "
            f"hg.Animation; received {shown(animation)}"
        )
    return {"duration": animation}


def _navigator(navigator: Any) -> bool | dict[str, Any] | None:
    """The spec's navigator: True, or a Navigator's options; None when off."""
    if navigator is None or navigator is False:
        return None
    if navigator is True:
        return True
    if isinstance(navigator, Mapping):
        navigator = _built(navigator, Navigator, "Chart navigator")
    if not isinstance(navigator, Navigator):
        raise ChartError(
            "Chart navigator: expected True, False, an hg.Navigator, or a dict of its fields; "
            f"received {shown(navigator)}"
        )
    return navigator._spec() or True


def _camera(
    camera: Any, name: str = "Chart camera", *, partial: bool = False
) -> dict[str, Any] | None:
    """A camera's spec from a Camera or a dict of its fields."""
    if camera is None:
        return None
    given = set(camera) if partial and isinstance(camera, Mapping) else None
    if isinstance(camera, Mapping):
        camera = _built(camera, Camera, name)
    if not isinstance(camera, Camera):
        raise ChartError(
            f"{name}: expected an hg.Camera or a dict of its fields; received {shown(camera)}"
        )
    spec = camera._spec()
    return (
        {key: value for key, value in spec.items() if key in given} if given is not None else spec
    )


def _box_aspect(aspect: Any) -> list[float] | None:
    if aspect is None:
        return None
    try:
        sides = [float(side) for side in aspect]
    except (TypeError, ValueError):
        sides = []
    if len(sides) != 3 or not all(0 < side < math.inf for side in sides):
        raise ChartError(
            f"Chart box_aspect: expected three positive lengths; received {shown(aspect)}"
        )
    return sides


def _check_legend_keys(spec: Mapping[str, Any]) -> None:
    """Each legend's entries of its own have keys of their own, as the
    engine checks them: equal labels never merge, and keys never do."""
    legend = spec.get("legend")
    legends = [("legend", legend)] if isinstance(legend, Mapping) else []
    legends += [
        (f"guides[{i}]", guide)
        for i, guide in enumerate(spec.get("guides") or ())
        if guide.get("type") == "legend"
    ]
    for at, options in legends:
        keys: set[str] = set()
        for k, entry in enumerate(options.get("entries") or ()):
            if entry["key"] in keys:
                raise ChartError(
                    f'{at}.entries[{k}].key: "{entry["key"]}" is the key of another of the '
                    "legend's entries; give each a key of its own",
                    path=f"{at}.entries[{k}].key",
                )
            keys.add(entry["key"])


def _check_colorbars(spec: Mapping[str, Any]) -> None:
    """What colorbars name, as the engine checks it when it draws them: a
    mark's color ramp, never a scale by its name."""
    scales = spec.get("scales") or {}
    for i, guide in enumerate(spec.get("guides") or ()):
        if guide.get("type") != "colorbar" or guide.get("show") is False:
            continue
        scale = guide.get("scale")
        name = scale.get("scale") if isinstance(scale, Mapping) else None
        if name is None:
            continue
        categories = (scales.get(name) or {}).get("type") == "ordinal"
        what = (
            "is a scale of categories, whose values a legend lists, as "
            "include=[hg.ScaleRef(scale=...)]"
            if categories
            else "is no color ramp"
        )
        raise ChartError(
            f'guides[{i}].scale: a colorbar shows a mark\'s color ramp, and "{name}" {what}; '
            'name the mark, as hg.ScaleRef(mark=..., channel="color")',
            path=f"guides[{i}].scale",
        )


def _check_axes(spec: Mapping[str, Any]) -> None:
    """Refuses an axis guide of a scale that places no values: x, y, and
    y_right do, and the chart's own linear, log, and time scales."""
    scales = spec.get("scales") or {}
    for i, guide in enumerate(spec.get("guides") or ()):
        scale = guide.get("scale")
        if guide.get("type") != "axis" or scale in ("x", "y", "yRight"):
            continue
        if (scales.get(scale) or {}).get("type") not in ("linear", "log", "time"):
            raise ChartError(
                f'guides[{i}].scale: expected "x", "y", "y_right", or a position scale of the '
                f"chart's scales; received {shown(scale)}",
                path=f"guides[{i}].scale",
            )


def _refuse_depth(spec: Mapping[str, Any]) -> None:
    """Refuses for good what a 3D box's axes cannot do: it fits its data, and
    draws its grid lines by depth, as the engine's 3D charts say. A chart's
    axes are its box's when it has no panels (z always is); a panel's are
    when its marks are 3D."""
    boxes = [mark.get("panel") for mark in spec["marks"] if mark["type"] in _MARKS_3D]
    panels = spec.get("panels")
    scales = spec.get("scales") or {}
    axes = (
        [("z", spec.get("z"))]
        if panels
        else [
            ("scales.x", scales.get("x")),
            ("scales.y", scales.get("y")),
            *((name, spec.get(name)) for name in ("x", "y", "z")),
        ]
    )
    for i, panel in enumerate(panels or ()):
        if panel.get("id") in boxes:
            axes += [(f"panels[{i}].{name}", panel.get(name)) for name in ("x", "y", "z")]
    for at, axis in axes:
        if not isinstance(axis, Mapping):
            continue
        grid = axis.get("grid")
        if isinstance(grid, Mapping) and "zIndex" in grid:
            path = f"{at}.grid.z_index"
            raise ChartError(
                f"{path}: a 3D box draws its grid lines by depth, not in an order of their own; "
                "drop z_index",
                code="unsupported",
                path=path,
            )
        if axis.get("padding") not in (None, "auto"):
            path = f"{at}.padding"
            raise ChartError(
                f"{path}: a 3D box fits its data, padded as it is drawn; drop padding",
                code="unsupported",
                path=path,
            )


def _size(value: Any, role: str) -> None:
    """Refuses a chart's width or height unless a positive number of pixels."""
    if value is not None and not (_finite(value) and value > 0):
        raise ChartError(f"{role}: expected a positive number of pixels; received {shown(value)}")


# Express-style helpers: one call, one chart -----------------------------------
