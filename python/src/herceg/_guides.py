"""Scales and guides: builders of the spec's tick, format, scale, axis,
legend, and colorbar types, in Python's names.

``hg.axis``, ``hg.legend``, and ``hg.colorbar`` make the guides a chart's
``guides`` lists; ``hg.Ticks``, ``hg.Format``, ``hg.Tick``, ``hg.TickLabels``,
and ``hg.TickLayer`` say how axes and colorbars draw their ticks. Anywhere a
builder is taken, a dict of the same keyword names works too."""

from __future__ import annotations

import datetime as _dt
import functools
import math
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, fields
from typing import TYPE_CHECKING, Any, ClassVar, Literal, TypedDict, Union

import numpy as np

from ._data import _time_ms, duration_ms, listlike
from ._errors import (
    ChartError,
    Role,
    is_number,
    key_path,
    listed,
    located,
    placed,
    refuses,
    shown,
    unknown_option,
)
from ._style import (
    AXIS_ROLES,
    LEGEND_ROLES,
    Place,
    Style,
    TextStyle,
    _built,
    _camel,
    _choice,
    _fraction,
    _number,
    _spec,
    built_list,
    built_spec,
    style_spec,
)

if TYPE_CHECKING:
    from ._encoding import Pixels, SymbolName


class LayoutScope(TypedDict):
    """A scale shared by the panels of each row or column of a layout's
    grid: ``{"layout": "main", "by": "column"}``."""

    layout: str
    by: Literal["row", "column"]


class PanelsScope(TypedDict):
    """A scale shared by the panels it names: ``{"panels": ["latency", "errors"]}``."""

    panels: Sequence[str]


#: Which panels share one instance of a scale (``AxisOptions.scope``,
#: ``Scale.scope``): a name, a layout grid's rows or columns, or panels by id.
Scope = Literal["chart", "panel", "row", "column"] | LayoutScope | PanelsScope
Collision = Literal["show", "hide", "stagger", "wrap"]
Channel = Literal["series", "color", "size", "symbol"]

_UNITS = ("millisecond", "second", "minute", "hour", "day", "week", "month", "year")
_INTERVAL = re.compile(r"^(?:(\d+) )?([a-z]+?)s?$")
_NUMBER = re.compile(r"^([-+( ])?(,)?(?:\.(\d{1,2}))?(~)?([defgs%]?)$")
_DIRECTIVE = re.compile(r"%(-?)(.?)")
_NUMBER_DIRECTIVES = "YymdeHIMSL"
_NAME_DIRECTIVES = "aAbBpz%"


def _fields(builder: Any) -> dict[str, Any]:
    """A builder's set options in camelCase, each as the spec takes it."""
    return {
        _camel(f.name): _spec(getattr(builder, f.name))
        for f in fields(builder)
        if getattr(builder, f.name) is not None
    }


def _instant(value: Any, role: str) -> float:
    """A number, or a time as epoch milliseconds (naive datetimes are UTC)."""
    if isinstance(value, (_dt.datetime, _dt.date)) or type(value).__name__ in (
        "datetime64",
        "Timestamp",
    ):
        ms = _time_ms(value)
        if not math.isfinite(ms):
            raise ChartError(f"{role}: expected a datetime; received {shown(value)}, no time")
        return ms
    if isinstance(value, bool) or not is_number(value) or not math.isfinite(value):
        raise ChartError(f"{role}: expected a finite number or a datetime; received {shown(value)}")
    return float(value)


def _interval(value: Any, role: str) -> Any:
    """A time interval as the spec takes it: calendar steps, or elapsed milliseconds."""
    if isinstance(value, np.timedelta64):
        # Of a fixed length alone (months and years are calendar steps),
        # straight to milliseconds: a timedelta keeps whole microseconds alone.
        milliseconds = duration_ms(value)
        if milliseconds is None:
            raise ChartError(
                f"{role}: expected an elapsed time; received {shown(value)}; give months and "
                'years as calendar steps ("month", "3 months")'
            )
        if not milliseconds > 0:
            raise ChartError(f"{role}: expected a positive elapsed time; received {shown(value)}")
        return {"milliseconds": milliseconds}
    if isinstance(value, _dt.timedelta):
        milliseconds = value / _dt.timedelta(milliseconds=1)
        if not milliseconds > 0:
            raise ChartError(f"{role}: expected a positive timedelta; received {value!r}")
        return {"milliseconds": milliseconds}
    if isinstance(value, str):
        match = _INTERVAL.match(value.strip())
        if not match or match.group(2) not in _UNITS:
            raise ChartError(
                f'{role}: {shown(value)} is not a time interval; write a unit ("hour", "day", '
                '"week", "month", "year"), a count and a unit ("6 hours", "15 minutes"), '
                "or a timedelta for elapsed time"
            )
        step = int(match.group(1) or 1)
        unit = match.group(2)
        if step < 1:
            raise ChartError(
                f"{role}: {shown(value)} steps by {step}; give a count of 1 or more, "
                'such as "6 hours"'
            )
        return {"unit": unit, "step": step} if step != 1 else {"unit": unit}
    _number(value, role, positive=True)
    return value


@refuses
@dataclass
class Ticks:
    """Which ticks an axis draws: about ``count`` round values; one ``every``
    so often (a number on number axes, from ``anchor``; on time axes a
    calendar interval in the chart's time zone, ``"day"`` or ``"6 hours"``,
    or a ``timedelta`` of elapsed time); or exactly ``values`` (numbers or
    datetimes). Category axes take a count only. Give one of them::

        hg.Ticks(every="6 hours")
        hg.Ticks(values=[15, 95])
    """

    count: int | None = None
    every: float | str | _dt.timedelta | np.timedelta64 | None = None
    anchor: float | _dt.datetime | None = None
    values: Sequence[Any] | None = None

    def __post_init__(self) -> None:
        given = [name for name in ("count", "every", "values") if getattr(self, name) is not None]
        if len(given) != 1:
            raise ChartError(
                f"Ticks: give one of count, every, or values; received {listed(given) or 'none'}"
            )
        if self.count is not None:
            _number(self.count, "Ticks count", positive=True)
        if self.anchor is not None and self.every is None:
            raise ChartError("Ticks anchor: starts the steps of every; give every or drop anchor")
        if isinstance(self.every, str) and self.anchor is not None:
            raise ChartError(
                "Ticks anchor: calendar steps start at calendar boundaries; drop anchor, "
                "or step by a timedelta"
            )

    def _spec(self) -> Any:
        if self.count is not None:
            return self.count
        if self.values is not None:
            if isinstance(self.values, (str, bytes)) or not isinstance(self.values, Sequence):
                raise ChartError(f"Ticks values: expected a list; received {shown(self.values)}")
            return {
                "values": [
                    value if isinstance(value, str) else _instant(value, f"Ticks values[{i}]")
                    for i, value in enumerate(self.values)
                ]
            }
        spec: dict[str, Any] = {"every": _interval(self.every, "Ticks every")}
        if self.anchor is not None:
            spec["anchor"] = _instant(self.anchor, "Ticks anchor")
        return spec


def ticks_spec(value: Any, role: str) -> Any:
    """Ticks as the spec takes them: a count, or an ``hg.Ticks`` (or a dict of its options)."""
    if value is None:
        return None
    if callable(value):
        raise ChartError(
            f"{role}: Python functions cannot travel in a chart; give a count or hg.Ticks"
        )
    if is_number(value) and not isinstance(value, bool):
        _number(value, role, positive=True)
        return value
    return built_spec(value, Ticks, role)


def _check_number_pattern(pattern: str, role: str) -> None:
    match = _NUMBER.match(pattern)
    if not match:
        raise ChartError(
            f"{role}: {shown(pattern)} is not a number pattern herceg reads; write "
            '[sign][,][.precision][~][type] with type d, f, e, g, s, or %, such as ",.2f"'
        )
    if match.group(5) in ("g", "s") and match.group(3) == "0":
        raise ChartError(f"{role}: {shown(pattern)} asks for 0 significant digits; give 1 or more")


def _check_time_pattern(pattern: str, role: str) -> None:
    for found in _DIRECTIVE.finditer(pattern):
        flag, directive = found.group(1), found.group(2)
        number = directive != "" and directive in _NUMBER_DIRECTIVES
        if not (number or (directive != "" and directive in _NAME_DIRECTIVES)) or (
            flag and not number
        ):
            raise ChartError(
                f"{role}: {shown(found.group(0))} at character {found.start() + 1} of "
                f"{shown(pattern)} is not a time directive herceg reads; use %Y %y %m %d %e "
                '%H %I %M %S %L %p %a %A %b %B %z, "-" for no padding (%-d), and %% for "%"'
            )


@refuses
@dataclass
class Format:
    """How values are written by pattern: ``number``, a d3-format pattern
    (``",.2f"``, ``".1%"``, ``"~s"``), or ``time``, a strftime pattern
    (``"%b %d %H:%M"``, ``"%-d %b"``) in the chart's time zone. Intl options
    are a dict of their own names, ``{"maximumFractionDigits": 1}``."""

    number: str | None = None
    time: str | None = None

    def __post_init__(self) -> None:
        if (self.number is None) == (self.time is None):
            raise ChartError("Format: give number or time, one of them")
        for name in ("number", "time"):
            value = getattr(self, name)
            if value is not None and not isinstance(value, str):
                raise ChartError(
                    f"Format {name}: expected a pattern string; received {shown(value)}"
                )
        if self.number is not None:
            _check_number_pattern(self.number, "Format number")
        if self.time is not None:
            _check_time_pattern(self.time, "Format time")

    def _spec(self) -> dict[str, str]:
        return {"number": self.number} if self.number is not None else {"time": self.time or ""}


def _flags(options: Any, owner: str, names: Sequence[str]) -> None:
    """Refuses those of an object's options `names` that are not None, True, or False."""
    for name in names:
        value = getattr(options, name)
        if value is not None and not isinstance(value, bool):
            raise ChartError(f"{owner} {name}: expected True or False; received {shown(value)}")


def format_spec(value: Any, role: str) -> Any:
    """A format as the spec takes it: Intl options (a dict of Intl names), or an ``hg.Format``."""
    if value is None:
        return None
    if callable(value):
        raise ChartError(
            f"{role}: Python functions cannot travel in a chart; give hg.Format or Intl options"
        )
    if isinstance(value, Format):
        return placed(role, value._spec)
    if isinstance(value, Mapping) and set(value) & {"number", "time"}:
        return placed(role, lambda: _built(value, Format, role)._spec())
    if isinstance(value, Mapping):
        # Intl's options, each a word, a number, or a flag.
        for key, option in value.items():
            if not isinstance(key, str) or not (
                isinstance(option, (str, bool)) or (is_number(option) and math.isfinite(option))
            ):
                raise ChartError(
                    f"{role}: Intl options are names of text, numbers, or True or False; "
                    f"received {shown(key)}: {shown(option)}"
                )
        return dict(value)
    raise ChartError(
        f"{role}: expected hg.Format or a dict of Intl options; received {shown(value)}"
    )


@refuses
@dataclass
class Tick:
    """Tick marks: ``direction`` out from the plot (``"out"``, the default),
    in over it (``"in"``), or across the axis line (``"cross"``), and their
    ``length`` in pixels."""

    direction: Literal["out", "in", "cross"] | None = None
    length: float | None = None

    def __post_init__(self) -> None:
        if self.direction is not None:
            _choice(self.direction, ("out", "in", "cross"), "Tick direction")
        if self.length is not None:
            _number(self.length, "Tick length")


@refuses
@dataclass
class TickLabels:
    """How tick labels are placed: ``rotation`` in degrees clockwise, from
    -90 to 90 (a list tries each angle in turn, keeping the first at which
    labels fit), what
    labels that would overlap do (``collision``: ``"show"``, ``"hide"``,
    ``"stagger"``, ``"wrap"``), their ``row`` (0 by the axis line, 1
    beyond), ``priority`` where they collide, and whether labels repeating
    the one before them show (``duplicates``). ``inside=True`` draws them
    inside the plot beside their ticks, taking no room outside it. Flat
    labels, inside or out, stand at their ticks along the axis as
    ``style``'s ``tick_label`` aligns them: its ``align`` on x, its
    ``vertical_align`` on y; centered by default. ``gap``
    is the pixels between them and their tick's end on their side (the
    axis line where the tick does not reach it). Colorbars take neither."""

    rotation: float | Sequence[float] | None = None
    collision: Collision | None = None
    row: int | None = None
    priority: float | None = None
    duplicates: Literal["hide", "show"] | None = None
    inside: bool | None = None
    gap: float | None = None

    def __post_init__(self) -> None:
        if self.inside is not None and not isinstance(self.inside, bool):
            raise ChartError(
                f"TickLabels inside: expected True or False; received {shown(self.inside)}"
            )
        if self.gap is not None:
            _number(self.gap, "TickLabels gap")
        if self.collision is not None:
            _choice(self.collision, ("show", "hide", "stagger", "wrap"), "TickLabels collision")
        if self.duplicates is not None:
            _choice(self.duplicates, ("hide", "show"), "TickLabels duplicates")
        if self.row is not None and (
            isinstance(self.row, bool) or not isinstance(self.row, int) or self.row < 0
        ):
            raise ChartError(f"TickLabels row: expected 0, 1, 2, ...; received {shown(self.row)}")
        if self.priority is not None and not (
            is_number(self.priority)
            and not isinstance(self.priority, bool)
            and math.isfinite(self.priority)
        ):
            raise ChartError(
                f"TickLabels priority: expected a number; received {shown(self.priority)}"
            )
        turns = (
            self.rotation
            if isinstance(self.rotation, Sequence) and not isinstance(self.rotation, str)
            else [self.rotation]
        )
        for turn in turns:
            if turn is not None and not (
                is_number(turn) and not isinstance(turn, bool) and -90 <= turn <= 90
            ):
                raise ChartError(
                    "TickLabels rotation: expected degrees from -90 (reading up) to 90 "
                    f"(reading down); received {shown(turn)}"
                )

    def _spec(self) -> dict[str, Any]:
        spec = _fields(self)
        rotation = self.rotation
        # A list of angles is tried in turn.
        if isinstance(rotation, Sequence):
            spec["rotation"] = {"candidates": list(rotation)}
        return spec


def _marks(value: Any, kind: type[Any], role: str) -> Any:
    """Tick marks or labels as the spec takes them: ``False`` for none, or the builder's spec."""
    if value is None or value is False:
        return value
    built = _built(value, kind, role)
    return built._spec() if hasattr(built, "_spec") else _spec(built)


@refuses
@dataclass
class TickLayer:
    """A layer of an axis' ticks, beside its own: minor ticks, or a row of
    day boundaries. ``id`` names it ("major" is the axis' own); ``ticks``,
    ``format``, ``tick``, and ``labels`` as an axis takes them (``False``
    for no tick marks or labels), and ``style`` its ``tick`` and
    ``tick_label`` roles::

        hg.TickLayer(id="day", ticks=hg.Ticks(every="day"),
                     format=hg.Format(time="%b %-d"), labels=hg.TickLabels(row=1))
    """

    id: str
    ticks: int | Ticks | Mapping[str, Any] | None = None
    format: Format | Mapping[str, Any] | None = None
    tick: Tick | Literal[False] | Mapping[str, Any] | None = None
    labels: TickLabels | Literal[False] | Mapping[str, Any] | None = None
    style: Style | Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.id, str) or self.id in ("", "major"):
            raise ChartError(
                f'TickLayer id: expected a name other than "" and "major", the axis\' own ticks; '
                f"received {shown(self.id)}"
            )

    def _spec(self) -> dict[str, Any]:
        spec = {
            "id": self.id,
            "ticks": ticks_spec(self.ticks, "TickLayer ticks"),
            "format": format_spec(self.format, "TickLayer format"),
            "tick": _marks(self.tick, Tick, "TickLayer tick"),
            "labels": _marks(self.labels, TickLabels, "TickLayer labels"),
            "style": style_spec(self.style, "TickLayer style", ("tick", "tick_label")),
        }
        return {key: value for key, value in spec.items() if value is not None}


def scope_spec(scope: Any, role: str) -> Any:
    """A scale's scope as the spec takes it: a name, or a dict naming a
    layout grid and how (``{"layout": "main", "by": "column"}``) or panels
    (``{"panels": ["latency", "errors"]}``)."""
    if scope is None or isinstance(scope, str):
        if scope is not None and scope not in ("chart", "panel", "row", "column"):
            raise ChartError(
                f'{role}: expected "chart", "panel", "row", "column", {{"layout": id, "by": '
                f'"row" or "column"}}, or {{"panels": [ids]}}; received {shown(scope)}'
            )
        return scope
    if isinstance(scope, Mapping):
        at = Role(role, "scope")
        if set(scope) == {"panels"}:
            panels = scope["panels"]
            if not listlike(panels):
                raise at.field("panels").error(
                    f"expected a list of panel ids; received {shown(panels)}"
                )
            for i, panel in enumerate(panels):
                if not isinstance(panel, str):
                    raise (
                        at.field("panels")
                        .index(i)
                        .error(f"expected a panel's id; received {shown(panel)}")
                    )
            return {"panels": list(panels)}
        if set(scope) == {"layout", "by"}:
            layout, by = scope["layout"], scope["by"]
            if not isinstance(layout, str):
                raise at.field("layout").error(f"expected a grid's id; received {shown(layout)}")
            if not (isinstance(by, str) and by in ("row", "column")):
                raise at.field("by").error(f'expected "row" or "column"; received {shown(by)}')
            return {"layout": layout, "by": by}
    raise ChartError(
        f'{role}: expected "chart", "panel", "row", "column", {{"layout": id, "by": "row" or '
        f'"column"}}, or {{"panels": [ids]}}; received {shown(scope)}'
    )


#: Room a scale keeps around its data: ``"auto"`` (the default), a share of
#: its domain on each side, or ``hg.Pixels(n)``; 0 for none.
Padding = Union[Literal["auto"], float, "Pixels"]


def padding_spec(value: Any, role: str) -> Any:
    """A scale's ``padding`` as the spec takes it."""
    if value is None or value == "auto":
        return value
    if is_number(value) and not isinstance(value, bool):
        if not 0 <= float(value) < 0.5:
            raise ChartError(
                f"{role}: expected a share of the domain from 0 up to 0.5, not 0.5; "
                f"received {shown(value)}"
            )
        return float(value)
    from ._encoding import length_spec

    return length_spec(value, role)


@refuses
@dataclass
class Scale:
    """A position scale's settings in the chart's ``scales``: ``"x"``,
    ``"y"``, and ``"y_right"``, over the short forms ``x=``, ``y=``,
    ``y_right=``, and position scales of the chart's own under other
    names (with a ``type``), which marks name in ``hg.DataPosition``.
    ``padding`` is the room it keeps around its data: ``"auto"`` (the
    default) as much as marks draw past their data (points' and markers'
    radius and outline, bar labels and widths; plain lines none), a share
    of the domain at each end (``0.05``), ``hg.Pixels(n)`` at each end, or
    ``0`` for none. Padding given also widens a ``domain`` set and a zoomed
    view; ``"auto"`` leaves those exact. Scales of categories are
    ``hg.OrdinalScale``."""

    type: Literal["linear", "log", "time"] | None = None
    domain: Sequence[Any] | None = None
    nice: bool | None = None
    zero: bool | None = None
    scope: Scope | None = None
    padding: Padding | None = None
    tooltip_format: Format | Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.type is not None:
            _choice(self.type, ("linear", "log", "time"), "Scale type")
        padding_spec(self.padding, "Scale padding")
        scope_spec(self.scope, "Scale scope")
        if self.domain is not None and (not listlike(self.domain) or len(self.domain) != 2):
            raise ChartError(
                f"Scale domain: a position scale's domain is (low, high); received "
                f"{shown(self.domain)}"
            )
        for name in ("nice", "zero"):
            value = getattr(self, name)
            if value is not None and not isinstance(value, bool):
                raise ChartError(f"Scale {name}: expected True or False; received {shown(value)}")

    def _spec(self) -> dict[str, Any]:
        domain = self.domain
        spec = {
            "type": self.type,
            "domain": [_instant(v, f"Scale domain[{i}]") for i, v in enumerate(domain)]
            if domain is not None
            else None,
            "nice": self.nice,
            "zero": self.zero,
            "scope": scope_spec(self.scope, "Scale scope"),
            "padding": padding_spec(self.padding, "Scale padding"),
            "tooltipFormat": format_spec(self.tooltip_format, "Scale tooltip_format"),
        }
        return {key: value for key, value in spec.items() if value is not None}


@refuses
@dataclass
class OrdinalScale:
    """A scale of categories in the chart's ``scales``, which gives every
    value one output (a color, shape, dash, or number) in every mark and
    panel reading it, from any data, and keeps it while the data streams.

    Under the name ``"color"`` it colors every mark's series and color
    columns. Under another, marks read it by name:
    ``color=hg.Channel(field="region", scale="region")`` for a column's
    values, ``hg.Channel(series=True, scale="fit")`` for the series' names
    (which joins marks of different data, a line and the band around it,
    in one legend entry). Without ``scales``, a value's color follows its
    column of its data, in every mark and panel reading it.

    ``map`` fixes outputs by value; others take the theme's palette by
    their place in the ``domain``: the given values in that order (others
    take ``unknown``), or else the columns' values, a categorical's own
    order first. With ``scope="panel"``, each panel maps its own values."""

    domain: Sequence[str] | None = None
    map: Mapping[str, Any] | None = None
    unknown: Any = None
    scope: Literal["chart", "panel"] | None = None

    def __post_init__(self) -> None:
        if self.scope is not None:
            _choice(self.scope, ("chart", "panel"), "OrdinalScale scope")
        if self.domain is not None and (
            not listlike(self.domain) or any(not isinstance(v, str) for v in self.domain)
        ):
            raise ChartError(
                "OrdinalScale domain: a scale of categories' domain is their values, "
                f'such as ["A", "B"]; received {shown(self.domain)}'
            )
        if self.map is not None and not isinstance(self.map, Mapping):
            raise ChartError(
                'OrdinalScale map: expected a dict of outputs by value, such as {"A": "#00ab41"}; '
                f"received {shown(self.map)}"
            )

    def _spec(self) -> dict[str, Any]:
        out: dict[str, Any] = {"type": "ordinal"}
        if self.scope is not None:
            out["scope"] = self.scope
        if self.domain is not None:
            out["domain"] = list(self.domain)
        if self.map is not None:
            out["map"] = {str(key): _output(value) for key, value in self.map.items()}
        if self.unknown is not None:
            out["unknown"] = _output(self.unknown, "OrdinalScale unknown")
        return out


@dataclass(frozen=True)
class IdentityScale:
    """A scale that maps nothing: each row's value is the channel's output
    (a color for colors, a shape's name, an area in square pixels for
    sizes, 0 to 1 for opacities), checked as constants are. Its values split
    no series and make no legend entries. Under a name in the chart's
    ``scales``, or in place as ``hg.Channel(field=..., scale=hg.IdentityScale())``."""

    def _spec(self) -> dict[str, Any]:
        return {"type": "identity"}


def _output(value: Any, role: str = "OrdinalScale map") -> Any:
    """A scale's output: a color, a shape, a dash, or a number."""
    if isinstance(value, (list, tuple)):
        if not all(is_number(step) and not isinstance(step, bool) for step in value):
            raise ChartError(f"{role}: a dash is a list of lengths; received {shown(value)}")
        return [float(step) for step in value]
    if isinstance(value, bool) or not (isinstance(value, str) or is_number(value)):
        raise ChartError(
            f"{role}: expected a color, a shape, a dash, or a number; received {shown(value)}"
        )
    return value


def scales_spec(value: Any) -> Any:
    """A chart's ``scales`` as the spec takes them: ``hg.Scale`` for the
    positions ``"x"``, ``"y"``, and ``"y_right"``; under other names
    ``hg.OrdinalScale`` (or a dict of its options) for scales of
    categories, ``hg.IdentityScale``, or an ``hg.Scale`` of a ``type``."""
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ChartError(
            f'Chart scales: expected a dict such as {{"y": hg.Scale(...)}}; received {shown(value)}'
        )
    names = {"x": "x", "y": "y", "y_right": "yRight"}
    out = {}
    for name, scale in value.items():
        if not isinstance(name, str) or not name:
            raise ChartError(
                f"Chart scales: expected scales' names; received the key {shown(name)}"
            )
        key = names.get(name, name)
        out[key] = located(key_path(None, name), functools.partial(_scale_spec, name, scale))
    return out


def _scale_spec(name: str, scale: Any) -> Any:
    """One of a chart's ``scales`` as the spec takes it (see `scales_spec`)."""
    role = f"Chart scales {name}"
    if name in ("x", "y", "y_right"):
        if isinstance(scale, OrdinalScale):
            raise ChartError(
                f"{role}: places values on an axis; give an hg.Scale, or name the "
                "OrdinalScale otherwise"
            )
        return built_spec(scale, Scale, role)
    if isinstance(scale, IdentityScale) or (
        isinstance(scale, Mapping) and scale.get("type") == "identity"
    ):
        if isinstance(scale, Mapping) and set(scale) != {"type"}:
            raise ChartError(f"{role}: an identity scale has no settings; give hg.IdentityScale()")
        return IdentityScale()._spec()
    if isinstance(scale, Scale) or (
        isinstance(scale, Mapping) and scale.get("type") in ("linear", "log", "time")
    ):
        scale = _built(scale, Scale, role)
        if scale.type is None:
            raise ChartError(
                f"{role}: a position scale of the chart's own says its type; give "
                'type="linear", "log", or "time", or an hg.OrdinalScale for categories'
            )
        return scale._spec()
    return built_spec(scale, OrdinalScale, role)


@refuses
@dataclass
class ScaleRef:
    """A scale a guide shows: one a mark owns, by the mark's ``id``
    (``mark``) and the ``channel`` (``"series"`` colors, a ``"color"``
    field's ramp or colors, which are its series' where ``color=`` splits
    them, ``"size"``, or ``"symbol"``), or one of the chart's ``scales`` by
    name (``scale``), with every value any mark reads through it. Guides
    naming a mark show it whatever its ``legend`` setting."""

    mark: str | None = None
    channel: Channel | None = None
    scale: str | None = None

    def __post_init__(self) -> None:
        if self.scale is not None:
            if self.mark is not None or self.channel is not None:
                raise ChartError(
                    "ScaleRef: a mark's scale (mark, channel) or a scale's name, not both"
                )
            if not isinstance(self.scale, str) or not self.scale:
                raise ChartError(
                    f"ScaleRef scale: expected a scale's name; received {shown(self.scale)}"
                )
            return
        if not isinstance(self.mark, str) or not self.mark:
            raise ChartError(f"ScaleRef mark: expected a mark's id; received {shown(self.mark)}")
        _choice(self.channel, ("series", "color", "size", "symbol"), "ScaleRef channel")


@refuses
@dataclass(frozen=True)
class MarkRef:
    """A mark a legend lists whole, by its ``id``: its series, or for an
    annotation, what its label names."""

    mark: str

    def __post_init__(self) -> None:
        if not isinstance(self.mark, str) or not self.mark:
            raise ChartError(f"MarkRef mark: expected a mark's id; received {shown(self.mark)}")


def include_spec(value: Any, role: str) -> Any:
    """A legend's ``include`` as the spec takes it: ``hg.ScaleRef`` and
    ``hg.MarkRef`` (or dicts of their options), in order; ``[]`` for its
    own entries alone."""
    if value is None:
        return None
    if isinstance(value, (str, Mapping)) or not isinstance(value, Sequence):
        raise ChartError(
            f"{role}: expected a list of hg.ScaleRef and hg.MarkRef; received {shown(value)}"
        )
    out = []
    for i, ref in enumerate(value):
        marked = isinstance(ref, MarkRef) or (isinstance(ref, Mapping) and set(ref) == {"mark"})
        out.append(_spec(_built(ref, MarkRef if marked else ScaleRef, f"{role}[{i}]")))
    return out


@refuses
@dataclass(frozen=True)
class LegendTarget:
    """What a legend entry of your own hides and shows besides whole marks
    (named by id): the rows of ``mark`` whose ``field`` holds one of
    ``values``, or with ``scale`` (and no mark), the ``values`` of one of
    the chart's scales in every mark reading it."""

    values: Sequence[str]
    mark: str | None = None
    field: str | None = None
    scale: str | None = None

    def __post_init__(self) -> None:
        # A list, not an iterator, which checking would use up.
        if (
            isinstance(self.values, (str, bytes))
            or not isinstance(self.values, Sequence)
            or any(not isinstance(v, str) for v in self.values)
        ):
            raise ChartError(
                f"LegendTarget values: expected a list of values; received {shown(self.values)}"
            )
        for name in ("mark", "field", "scale"):
            value = getattr(self, name)
            if value is not None and not (isinstance(value, str) and value):
                raise ChartError(f"LegendTarget {name}: expected a name; received {shown(value)}")
        if (self.scale is None) == (self.mark is None) or (self.mark is not None) != (
            self.field is not None
        ):
            raise ChartError("LegendTarget: give mark and field, or scale, with values")

    def _spec(self) -> dict[str, Any]:
        spec: dict[str, Any] = (
            {"scale": self.scale}
            if self.scale is not None
            else {"mark": self.mark, "field": self.field}
        )
        spec["values"] = list(self.values)
        return spec


@refuses
@dataclass
class Swatch:
    """A legend entry's swatch: a ``"line"`` (``stroke``, ``stroke_width``,
    ``dash``), a ``"rect"`` (``fill``, and ``stroke`` for an outline), a
    ``"symbol"`` (a point's ``symbol``, ``"circle"`` by default, with
    ``fill``, ``stroke``, and ``size``, pixels across), or a ``"composite"``
    of ``parts``; ``opacity`` from 0 to 1. An entry shows a mark's look by
    its ``sample``, a mark that draws it."""

    type: Literal["line", "rect", "symbol", "composite"]
    stroke: str | None = None
    fill: str | None = None
    stroke_width: float | None = None
    dash: str | Sequence[float] | None = None
    symbol: SymbolName | None = None
    size: float | None = None
    opacity: float | None = None
    parts: Sequence[Swatch | Mapping[str, Any]] | None = None

    def __post_init__(self) -> None:
        _choice(self.type, tuple(_SWATCH_FIELDS), "Swatch type")
        if self.symbol is not None:
            from ._encoding import SYMBOLS

            _choice(self.symbol, SYMBOLS, "Swatch symbol")
        needs = {"line": "stroke", "rect": "fill", "symbol": "fill", "composite": "parts"}[
            self.type
        ]
        if getattr(self, needs) is None:
            raise ChartError(f"Swatch {needs}: a {self.type} swatch needs {needs}; give it")
        takes = _SWATCH_FIELDS[self.type]
        for name in (
            "stroke",
            "fill",
            "stroke_width",
            "dash",
            "symbol",
            "size",
            "opacity",
            "parts",
        ):
            if getattr(self, name) is not None and name not in takes:
                raise ChartError(
                    f"Swatch {name}: a {self.type} swatch takes {listed(takes)}; drop {name}"
                )
        for name in ("stroke_width", "size"):
            if getattr(self, name) is not None:
                _number(getattr(self, name), f"Swatch {name}")
        if self.opacity is not None:
            _fraction(self.opacity, "Swatch opacity")
        if self.dash is not None:
            from ._encoding import dash_spec

            dash_spec(self.dash, "Swatch dash")
        self.parts = built_list(self.parts, Swatch, "Swatch parts")

    def _spec(self) -> dict[str, Any]:
        spec = _fields(self)
        if self.dash is not None and not isinstance(self.dash, str):
            spec["dash"] = list(self.dash)
        return spec


#: What each type of swatch takes.
_SWATCH_FIELDS: dict[str, tuple[str, ...]] = {
    "line": ("stroke", "stroke_width", "dash", "opacity"),
    "rect": ("fill", "stroke", "opacity"),
    "symbol": ("symbol", "fill", "stroke", "size", "opacity"),
    "composite": ("parts",),
}


@refuses
@dataclass
class LegendEntry:
    """A legend entry of your own: its ``key`` and ``label``, a ``swatch``
    (an ``hg.Swatch``) or ``sample``, the id of a mark whose look it shows,
    and ``targets``, what clicking it hides and shows: marks by id, or
    ``hg.LegendTarget`` for rows by value."""

    key: str
    label: str
    swatch: Swatch | Mapping[str, Any] | None = None
    sample: str | None = None
    targets: Sequence[str | LegendTarget | Mapping[str, Any]] | None = None

    def __post_init__(self) -> None:
        for name in ("key", "label"):
            if not isinstance(getattr(self, name), str):
                raise ChartError(
                    f"LegendEntry {name}: expected a string; received {shown(getattr(self, name))}"
                )
        if self.swatch is not None and self.sample is not None:
            raise ChartError("LegendEntry: a swatch or a sample, not both")
        self.swatch = _built(self.swatch, Swatch, "LegendEntry swatch")

    def _spec(self) -> dict[str, Any]:
        spec: dict[str, Any] = {"key": self.key, "label": self.label}
        if isinstance(self.swatch, Swatch):
            spec["swatch"] = self.swatch._spec()
        if self.sample is not None:
            spec["sample"] = {"mark": self.sample}
        if self.targets is not None:
            spec["targets"] = [
                {"mark": target}
                if isinstance(target, str)
                else built_spec(target, LegendTarget, f"LegendEntry targets[{i}]")
                for i, target in enumerate(self.targets)
            ]
        return spec


class _TitleText(TypedDict):
    text: str


class LegendTitle(_TitleText, total=False):
    """A legend's or a colorbar's title with a style of its own:
    ``{"text": "Region", "style": hg.TextStyle(weight="bold")}``."""

    style: TextStyle | Mapping[str, Any] | None


def _title(value: Any, role: str) -> Any:
    """A guide's title as the spec takes it, refused at paths within it."""
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, Mapping):
        value = dict(value)
        text = value.pop("text", None)
        style = value.pop("style", None)
        if value or not isinstance(text, str):
            raise ChartError(f"{role}: expected a string, or a dict with text and style")
        if style is None:
            return {"text": text}
        role = f"{role} style"
        return {
            "text": text,
            "style": located("style", lambda: _spec(_built(style, TextStyle, role))),
        }
    raise ChartError(f"{role}: expected a string; received {shown(value)}")


def legend_layout(builder: Any, role: str) -> dict[str, Any]:
    """The layout options of a legend (the chart's ``legend=``, or an
    ``hg.legend``), as the spec takes them."""
    if builder.columns is not None and builder.rows is not None:
        raise ChartError(f"{role} rows: columns or rows, not both; drop one")
    for name in ("columns", "rows"):
        value = getattr(builder, name)
        if value is not None and (
            isinstance(value, bool) or not isinstance(value, int) or value < 1
        ):
            raise ChartError(
                f"{role} {name}: expected a whole number of at least 1; received {shown(value)}"
            )
    if builder.order is not None:
        _choice(builder.order, ("row", "column"), f"{role} order")
    if builder.swatches is not None:
        _choice(builder.swatches, ("mark",), f"{role} swatches")
    entries = builder.entries
    if entries is not None and (not listlike(entries)):
        raise ChartError(
            f"{role} entries: expected a list of hg.LegendEntry; received {shown(entries)}"
        )
    made = (
        [built_spec(entry, LegendEntry, f"{role} entries[{i}]") for i, entry in enumerate(entries)]
        if entries is not None
        else None
    )
    spec = {
        "place": _spec(_built(builder.place, Place, f"{role} place")),
        "columns": builder.columns,
        "rows": builder.rows,
        "order": builder.order,
        "title": located("title", lambda: _title(builder.title, f"{role} title")),
        "include": include_spec(builder.include, f"{role} include"),
        "entries": made,
        "swatches": builder.swatches,
        "style": style_spec(builder.style, f"{role} style", LEGEND_ROLES),
    }
    return {key: value for key, value in spec.items() if value is not None}


@refuses
@dataclass
class AxisGuide:
    """An axis the chart's ``guides`` lists (see ``hg.axis``)."""

    _spelled: ClassVar = ("axis",)

    scale: str
    id: str | None = None
    place: Place | Mapping[str, Any] | None = None
    title: str | None = None
    ticks: int | Ticks | Mapping[str, Any] | None = None
    format: Format | Mapping[str, Any] | None = None
    tick: Tick | Literal[False] | Mapping[str, Any] | None = None
    labels: TickLabels | Literal[False] | Mapping[str, Any] | None = None
    line: bool | None = None
    grid: bool | GridLines | Mapping[str, Any] | None = None
    layers: Sequence[TickLayer | Mapping[str, Any]] | None = None
    show: bool | None = None
    repeat: Literal["outer", "all"] | None = None
    style: Style | Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.scale, str) or not self.scale:
            raise ChartError(
                "axis scale: expected x, y, y_right, or a scale's name; "
                f"received {shown(self.scale)}"
            )
        own = self.scale not in ("x", "y", "y_right")
        if own and self.place is None:
            raise ChartError(
                f"axis place: an axis of the chart's own scale {shown(self.scale)} has no side "
                "of its own; give place=hg.Place(side=...)"
            )
        if self.repeat is not None:
            _choice(self.repeat, ("outer", "all"), "axis repeat")
        _flags(self, "axis", ("line", "show"))
        self.place = _built(self.place, Place, "axis place")
        if isinstance(self.place, Place):
            sides = {"x": ("bottom", "top"), "y": ("left", "right"), "y_right": ("right",)}
            side = self.place.side
            if side is None:
                raise ChartError("axis place: an axis goes on a side; give side")
            if not own and side not in sides[self.scale]:
                raise ChartError(
                    f"axis place: {self.scale} axes go on the {listed(sides[self.scale])} "
                    f"side; received {shown(side)}"
                )
        self.layers = built_list(self.layers, TickLayer, "axis layers")

    def _spec(self) -> dict[str, Any]:
        spec = {
            "type": "axis",
            "id": self.id,
            "scale": "yRight" if self.scale == "y_right" else self.scale,
            "place": {"side": self.place.side} if isinstance(self.place, Place) else None,
            "title": self.title,
            "ticks": ticks_spec(self.ticks, "axis ticks"),
            "format": format_spec(self.format, "axis format"),
            "tick": _marks(self.tick, Tick, "axis tick"),
            "labels": _marks(self.labels, TickLabels, "axis labels"),
            "line": self.line,
            "grid": grid_spec(self.grid, "axis grid"),
            "layers": [
                built_spec(layer, TickLayer, f"axis layers[{i}]")
                for i, layer in enumerate(self.layers)
            ]
            if self.layers is not None
            else None,
            "show": self.show,
            "repeat": self.repeat,
            "style": style_spec(self.style, "axis style", AXIS_ROLES),
        }
        return {key: value for key, value in spec.items() if value is not None}


@refuses
@dataclass(frozen=True)
class GridLines:
    """Grid lines across the plot at an axis' major ticks: ``z_index``
    places them among the marks (-1, under marks of the default 0, by
    default)."""

    z_index: float | None = None

    def __post_init__(self) -> None:
        if self.z_index is not None:
            _finite(self.z_index, "GridLines z_index")


def _finite(value: Any, role: str) -> None:
    if isinstance(value, bool) or not is_number(value) or not math.isfinite(value):
        raise ChartError(f"{role}: expected a finite number; received {shown(value)}")


def grid_spec(value: Any, role: str) -> Any:
    """An axis' ``grid`` as the spec takes it: a boolean, or ``hg.GridLines``."""
    if value is None or isinstance(value, bool):
        return value
    built = _built(value, GridLines, role)
    return {} if built.z_index is None else {"zIndex": float(built.z_index)}


def axis(scale: str, **options: Any) -> AxisGuide:
    """An axis of ``scale`` (``"x"``, ``"y"``, ``"y_right"``, or a position
    scale of the chart's own ``scales``, which then needs ``place``), for the chart's
    ``guides``: on its scale's default side it takes the place of the
    automatic axis, its unset settings taken from ``x=``, ``y=``, or
    ``y_right=``; elsewhere (``place=hg.Place(side="top")``) it is drawn too.
    ``ticks``, ``format``, ``tick``, and ``labels`` are its own ticks';
    ``layers`` adds layers of ticks; ``line`` draws its line; ``repeat``
    says where panels sharing its scale draw it (``"outer"`` or ``"all"``, as
    ``hg.AxisOptions``)::

        hg.axis("x", layers=[hg.TickLayer(id="day", ticks=hg.Ticks(every="day"),
                                          labels=hg.TickLabels(row=1))])
    """
    _known_options("axis", options, AxisGuide)
    return AxisGuide(scale=scale, **options)


@refuses
@dataclass
class LegendOptions:
    """The chart's legend (``legend=``): where it goes (``place``, an
    ``hg.Place``; above the plots by default), its entries in ``columns`` or
    ``rows`` (filled by ``order``, ``"row"`` or ``"column"``) under a
    ``title``, what it ``include``s (``hg.ScaleRef`` and ``hg.MarkRef``;
    everything by default, ``[]`` for nothing), ``entries`` of your own
    after those, swatches that look like the marks (``swatches="mark"``:
    of every mark showing an entry's value), and how it looks (``style``,
    an ``hg.Style`` of its ``legend_label``, ``legend_title``, and
    ``tick_label`` roles). Giving one shows the legend, also for a single
    series."""

    place: Place | Mapping[str, Any] | None = None
    columns: int | None = None
    rows: int | None = None
    order: Literal["row", "column"] | None = None
    title: str | LegendTitle | None = None
    include: Sequence[ScaleRef | MarkRef | Mapping[str, Any]] | None = None
    entries: Sequence[LegendEntry | Mapping[str, Any]] | None = None
    swatches: Literal["mark"] | None = None
    style: Style | Mapping[str, Any] | None = None

    def _spec(self) -> dict[str, Any]:
        return legend_layout(self, "LegendOptions")


def legend_spec(legend: Any) -> Any:
    """A chart's legend as the spec takes it: a boolean, or an object."""
    if legend is None or isinstance(legend, bool):
        return legend
    return built_spec(legend, LegendOptions, "Chart legend")


@refuses
@dataclass
class LegendGuide:
    """A legend the chart's ``guides`` lists (see ``hg.legend``)."""

    _spelled: ClassVar = ("legend",)

    include: Sequence[ScaleRef | MarkRef | Mapping[str, Any]] | None = None
    id: str | None = None
    place: Place | Mapping[str, Any] | None = None
    columns: int | None = None
    rows: int | None = None
    order: Literal["row", "column"] | None = None
    title: str | LegendTitle | None = None
    entries: Sequence[LegendEntry | Mapping[str, Any]] | None = None
    swatches: Literal["mark"] | None = None
    show: bool | None = None
    style: Style | Mapping[str, Any] | None = None
    panel: str | None = None

    def _spec(self) -> dict[str, Any]:
        _flags(self, "legend", ("show",))
        spec: dict[str, Any] = {"type": "legend", **legend_layout(self, "legend")}
        if self.id is not None:
            spec["id"] = self.id
        if self.panel is not None:
            if not isinstance(self.panel, str) or self.panel in ("", "*"):
                raise ChartError(
                    f"legend panel: expected a panel's id; received {shown(self.panel)}"
                )
            spec["panel"] = self.panel
        if self.show is not None:
            spec["show"] = self.show
        return spec


def legend(**options: Any) -> LegendGuide:
    """A legend for the chart's ``guides``: of what ``include`` names
    (``hg.ScaleRef(mark=..., channel=...)``, ``hg.ScaleRef(scale=...)``,
    ``hg.MarkRef(mark=...)``; ``[]`` for nothing), or of all the chart's, in
    place of the automatic legend; laid out in ``columns`` or ``rows`` under
    a ``title``, with ``entries`` of your own after those, and ``swatches="mark"`` for
    swatches that look like the marks. Legends list one entry per value a
    chart's series stand for, whichever marks and panels show it. With
    ``panel``, it lists what that panel draws (above the panel by default),
    and its entries hide and show it there."""
    _known_options("legend", options, LegendGuide)
    return LegendGuide(**options)


@refuses
@dataclass
class Colorbar:
    """A colorbar the chart's ``guides`` lists (see ``hg.colorbar``)."""

    _spelled: ClassVar = ("colorbar",)

    scale: ScaleRef | Mapping[str, Any] | None = None
    id: str | None = None
    place: Place | Mapping[str, Any] | None = None
    title: str | LegendTitle | None = None
    ticks: int | Ticks | Mapping[str, Any] | None = None
    format: Format | Mapping[str, Any] | None = None
    tick: Tick | Literal[False] | Mapping[str, Any] | None = None
    labels: TickLabels | Literal[False] | Mapping[str, Any] | None = None
    layers: Sequence[TickLayer | Mapping[str, Any]] | None = None
    length: float | None = None
    thickness: float | None = None
    show: bool | None = None
    style: Style | Mapping[str, Any] | None = None

    def __post_init__(self) -> None:
        for name in ("length", "thickness"):
            if getattr(self, name) is not None:
                _number(getattr(self, name), f"colorbar {name}", positive=True)
        _flags(self, "colorbar", ("show",))
        self.layers = built_list(self.layers, TickLayer, "colorbar layers")

    def _spec(self) -> dict[str, Any]:
        spec = {
            "type": "colorbar",
            "id": self.id,
            "scale": _spec(_built(self.scale, ScaleRef, "colorbar scale")),
            "place": _spec(_built(self.place, Place, "colorbar place")),
            "title": located("title", lambda: _title(self.title, "colorbar title")),
            "ticks": ticks_spec(self.ticks, "colorbar ticks"),
            "format": format_spec(self.format, "colorbar format"),
            "tick": _marks(self.tick, Tick, "colorbar tick"),
            "labels": _marks(self.labels, TickLabels, "colorbar labels"),
            "layers": [
                built_spec(layer, TickLayer, f"colorbar layers[{i}]")
                for i, layer in enumerate(self.layers)
            ]
            if self.layers is not None
            else None,
            "length": self.length,
            "thickness": self.thickness,
            "show": self.show,
            "style": style_spec(
                self.style, "colorbar style", ("tick", "tick_label", "legend_title")
            ),
        }
        return {key: value for key, value in spec.items() if value is not None}


def colorbar(**options: Any) -> Colorbar:
    """A colorbar for the chart's ``guides``: a color scale's colors along
    its values, of the scale ``scale`` names (``hg.ScaleRef(mark=...,
    channel="color")``) or the chart's only one; beside the plots by default
    (``place=hg.Place(side="right")``), with ``ticks``, a ``format``, a
    ``title``, and tick ``layers`` as axes take them."""
    _known_options("colorbar", options, Colorbar)
    return Colorbar(**options)


def _known_options(owner: str, options: Mapping[str, Any], kind: type) -> None:
    known = {field.name for field in fields(kind) if field.init} - {"scale", "type"}
    if owner == "colorbar":
        known.add("scale")
    for name in options:
        if name not in known:
            raise unknown_option(owner, name, known)


#: A guide the chart's ``guides`` lists.
Guide = AxisGuide | LegendGuide | Colorbar


def guide_problem(guide: Any) -> tuple[str, str] | None:
    """Where a guide's or legend's settings given as dicts are malformed in
    what round 2 adds (grid lines' ``z_index``, tick labels' ``gap`` and
    ``inside``, a legend's ``include`` and its entries' ``targets``), as the engine's validator
    finds it: the place within it (``labels.gap``) and what it expected, or
    None. Its classes check the rest as they are made."""

    def get(owner: Any, key: str) -> Any:
        return owner.get(key) if isinstance(owner, Mapping) else getattr(owner, key, None)

    grid = get(guide, "grid")
    z = grid.get("z_index") if isinstance(grid, Mapping) else None
    if z is not None and (isinstance(z, bool) or not is_number(z) or not math.isfinite(z)):
        return "grid.z_index", f"expected a finite number; received {shown(z)}"
    labels = [("labels", get(guide, "labels"))]
    layers = get(guide, "layers")
    if layers is not None and (not listlike(layers)):
        return "layers", f"expected a list of tick layers; received {shown(layers)}"
    for k, layer in enumerate(() if layers is None else layers):
        labels.append((f"layers[{k}].labels", get(layer, "labels")))
    for at, tick_labels in labels:
        if not isinstance(tick_labels, Mapping):
            continue
        gap, inside = tick_labels.get("gap"), tick_labels.get("inside")
        number = is_number(gap) and not isinstance(gap, bool)
        if gap is not None and not (number and 0 <= gap < math.inf):
            return f"{at}.gap", f"expected a number of at least 0; received {shown(gap)}"
        if inside is not None and not isinstance(inside, bool):
            return f"{at}.inside", f"expected True or False; received {shown(inside)}"
    entries = get(guide, "entries")
    if entries is not None and (not listlike(entries)):
        return "entries", f"expected a list of hg.LegendEntry; received {shown(entries)}"
    for k, entry in enumerate(() if entries is None else entries):
        targets = get(entry, "targets")
        if targets is not None and (not listlike(targets)):
            return f"entries[{k}].targets", f"expected a list of targets; received {shown(targets)}"
        for t, target in enumerate(() if targets is None else targets):
            if not isinstance(target, Mapping):
                continue
            at = f"entries[{k}].targets[{t}]"
            for key in ("mark", "field", "scale"):
                if key in target and not (isinstance(target[key], str) and target[key]):
                    return f"{at}.{key}", f"expected a name; received {shown(target[key])}"
            values = target.get("values", ())
            if isinstance(values, (str, bytes)) or not isinstance(values, Sequence):
                return f"{at}.values", f"expected a list of values; received {shown(values)}"
            for v, value in enumerate(values):
                if not isinstance(value, str):
                    return f"{at}.values[{v}]", f"expected text; received {shown(value)}"
    include = get(guide, "include")
    if isinstance(include, Sequence) and not isinstance(include, (str, bytes)):
        for k, ref in enumerate(include):
            if not isinstance(ref, Mapping):
                continue
            for key in ("mark", "scale", "channel"):
                if key in ref and not (isinstance(ref[key], str) and ref[key]):
                    return f"include[{k}].{key}", f"expected a name; received {shown(ref[key])}"
    return None


def guides_spec(value: Any, start: int = 0) -> Any:
    """A chart's ``guides`` as the spec takes them, refused at their index
    in the list (the spec's, from ``start``, for panels' legends after the
    chart's guides)."""
    if value is None:
        return None
    if isinstance(value, (str, bytes, Mapping)) or not isinstance(value, Sequence):
        raise ChartError(
            "Chart guides: expected a list of hg.axis, hg.legend, and hg.colorbar guides; "
            f"received {shown(value)}"
        )
    out = []
    for i, guide in enumerate(value, start):
        at = Role("Chart guides").index(i)
        if not isinstance(guide, (AxisGuide, LegendGuide, Colorbar)):
            raise at.error(
                "expected hg.axis(...), hg.legend(...), or hg.colorbar(...); "
                f"received {type(guide).__name__}"
            )
        out.append(located(at, guide._spec))
    return out
