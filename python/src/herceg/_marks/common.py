"""What several mark families share: the decorator of mark methods, and
checks and spec helpers of options many marks take."""

from __future__ import annotations

import difflib
import functools
import inspect
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import is_dataclass
from typing import TYPE_CHECKING, Any, Literal, ParamSpec, TypeVar, cast

from .._data import listlike
from .._encoding import dash_spec
from .._errors import (
    Arguments,
    ChartError,
    UnknownOption,
    check_hints,
    hints_of,
    is_number,
    listed,
    python_values,
    refusing,
    shown,
)
from .._style import HaloOption, halo_spec, vertical_align_problem

if TYPE_CHECKING:
    from .._chart import Chart

_P = ParamSpec("_P")
_R = TypeVar("_R")


Dash = Sequence[float] | Literal["-", "--", ":", "-."]
# What a mark's drawing is cut to: its plot, the whole chart, or nothing.
Clip = Literal["plot", "chart", False]

_NUMERIC = ("number", "time")
# Columns a label part writes: numbers, times, and categories.
_ANY = ("category", "number", "time")

_WEEKDAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")

# Named color schemes: sequential, diverging, then categorical.
SCHEMES = (
    *("viridis", "magma", "inferno", "plasma", "cividis", "turbo"),
    *("blues", "greens", "greys", "oranges", "purples", "reds", "ylgnbu", "ylorrd"),
    *("rdbu", "rdylbu", "brbg", "piyg", "prgn", "puor", "spectral"),
    *("tableau10", "category10", "set2", "dark2"),
)


#: Where each mark's label takes a style placing it by a point, "baseline" too.
_LABEL_STYLES = {
    **dict.fromkeys(("text", "rule", "region"), ("label", "style")),
    **dict.fromkeys(("line", "area"), ("labels", "style")),
}


def _own_options(function: Callable[..., Any]) -> set[str]:
    return {
        name
        for name, parameter in inspect.signature(function).parameters.items()
        if name != "self" and parameter.kind is not parameter.VAR_KEYWORD
    }


def _check_method_options(function: Callable[_P, _R]) -> Callable[_P, _R]:
    """Keep method signatures while reporting unknown options like helpers do."""
    # Mark methods are written in their family's module and bound in Chart's
    # body: they are Chart's methods, as Python's own errors and help() name them.
    function.__qualname__ = f"Chart.{function.__name__}"
    owner = "Chart" if function.__name__ == "__init__" else function.__name__

    # What the method takes, read at its first call rather than as herceg is
    # imported: reading a signature costs about as much as importing a module.
    @functools.cache
    def parameters() -> tuple[set[str], Arguments]:
        return _own_options(function), Arguments(function)

    @functools.wraps(function)
    def checked(*args: _P.args, **kwargs: _P.kwargs) -> _R:
        known, arguments = parameters()
        for name in kwargs:
            if name not in known:
                raise UnknownOption(_unknown_option(function, name, known))
        given = arguments.of(args, kwargs)
        if given is None or "self" not in given:
            return function(*args, **kwargs)  # Python says what the call gets wrong
        chart = cast("Chart", given["self"])
        # Text styles' vertical_align is checked where it is given, "baseline"
        # only in the style of a mark's label. Styles are in dicts and options
        # objects (and the guides' list), never in data, scales, or other
        # lists, which may be long.
        label = _LABEL_STYLES.get(function.__name__)
        for name, value in kwargs.items():
            styled = isinstance(value, Mapping) or is_dataclass(value) or name == "guides"
            problem = (
                vertical_align_problem(value, (name,), label)
                if styled and name not in ("data", "scales")
                else None
            )
            if problem:
                at = (
                    name
                    if function.__name__ == "__init__"
                    else f"marks[{len(chart._marks)}].{name}"
                )
                raise ChartError(f"{at}{problem[0]}: {problem[1]}", path=f"{at}{problem[0]}")
        # Refusals are ChartErrors at the option they name: the chart's own
        # (``x``), or the mark's, at the place it takes (``marks[2].color``).
        # NumPy's scalars are taken as Python's; other values the method's own
        # checks let through are refused after them (theirs say more).
        hints = hints_of(function)
        if function.__name__ == "__init__":
            with refusing(("Chart",), known):
                changed, later = python_values(owner, given, hints)
                taken, named = arguments.replaced(args, kwargs, changed)
                function(*taken, **named)
                check_hints(owner, given, later)
                return cast("_R", None)
        index = len(chart._marks)
        mark, panel = kwargs.get("id"), kwargs.get("panel")
        with refusing(
            (function.__name__,),
            known,
            f"marks[{index}]",
            mark=mark if isinstance(mark, str) else index,
            panel=panel if isinstance(panel, str) else None,
        ):
            changed, later = python_values(owner, given, hints)
            taken, named = arguments.replaced(args, kwargs, changed)
            # Refused as the mark is added (see `_add`).
            outer, chart._unchecked = chart._unchecked, (owner, given, later)
            try:
                return function(*taken, **named)
            finally:
                chart._unchecked = outer

    return checked


#: Names other libraries give options herceg names otherwise (Plotly
#: Express, Seaborn, matplotlib), and the options a helper may take instead.
_ELSEWHERE: dict[str, tuple[str, ...]] = {
    "alpha": ("opacity", "fill_opacity"),
    "linewidth": ("stroke_width",),
    "lw": ("stroke_width",),
    "linestyle": ("dash",),
    "ls": ("dash",),
    "marker": ("symbol", "markers"),
    "markersize": ("radius", "size"),
    "ms": ("radius", "size"),
    "c": ("color", "stroke", "fill"),
    "edgecolor": ("stroke",),
    "facecolor": ("fill",),
    "label": ("name",),
    "cmap": ("colors",),
    "vmin": ("color_domain",),
    "vmax": ("color_domain",),
    "color": ("series", "stroke", "fill"),
    "colour": ("color", "series", "stroke", "fill"),
    "hue": ("series",),
    "hue_order": ("series_order",),
    "row": ("facet_row",),
    "col": ("facet_column",),
    "facet_col": ("facet_column",),
    "col_wrap": ("facet_columns",),
    "facet_col_wrap": ("facet_columns",),
    "template": ("theme",),
    "labels": ("x_axis", "y_axis"),
    # Seaborn's statistical options herceg names as its marks do.
    "weights": ("weight",),
    "stat": ("normalize",),
    "whis": ("whiskers",),
    "showfliers": ("outliers",),
    "k_depth": ("depth",),
    "outlier_prop": ("outlier_proportion",),
    "fill": ("filled",),
    "err_style": ("error_style",),
    "kde_kws": ("kde_options",),
    "gridsize": ("grid_size",),
}


def _unknown_option(function: Callable[..., Any], name: str, known: set[str]) -> str:
    method = function.__qualname__.startswith("Chart.")
    constructor = method and function.__name__ == "__init__"
    location = "Chart" if constructor else function.__name__
    where = "herceg.express" if function.__module__.startswith("herceg.express") else "herceg"
    help_name = "Chart" if constructor else function.__qualname__ if method else location
    suggested = [option for option in _ELSEWHERE.get(name, ()) if option in known]
    if name in ("markersize", "ms") and "radius" in suggested:
        suggested = ["radius"]
    # A known foreign option with no equivalent must not get an unrelated fuzzy match.
    if name not in _ELSEWHERE:
        suggested += difflib.get_close_matches(name, sorted(known), n=1, cutoff=0.7)
    hint = (
        f"did you mean {' or '.join(repr(option) for option in suggested)}?"
        if suggested
        else f"see help({where}.{help_name}) for the options it takes"
    )
    if name == "zorder":
        hint = (
            "did you mean 'z_index'? marks draw in the order given, or by z_index"
            if "z_index" in known
            else "marks draw in the order given; add the mark later to draw it on top"
        )
    elif name == "color" and method and not constructor:
        # Marks without color choose theirs: by series, by category, or one of their own.
        hint = (
            "it colors by series; give series=, the column naming them"
            if "series" in known
            else "it chooses its colors itself (fill or stroke, where it takes them, set one)"
        )
    elif name == "density" and "normalize" in known:
        hint = 'did you mean normalize="density"?'
    elif name in ("xlim", "ylim"):
        axis = name[0]
        if constructor:
            hint = f"did you mean {axis}=hg.AxisOptions(domain=...)?"
        elif f"{axis}_axis" in known:
            hint = f"did you mean {axis}_axis=hg.AxisOptions(domain=...)?"
        elif method:
            hint = f"set the chart's domain with hg.Chart({axis}=hg.AxisOptions(domain=...))"
    return f"{location}: no option {name!r}; {hint}"


def _dash(value: Dash | None, mark: str) -> str | list[float] | None:
    return dash_spec(value, f"{mark} dash")


def _clip(clip: Clip | None, mark: str) -> Clip | None:
    """A mark's ``clip``: what its drawing is cut to."""
    if not (clip is None or clip is False or clip in ("plot", "chart")):
        raise ChartError(f'{mark} clip: expected "plot", "chart", or False; received {shown(clip)}')
    return clip


def _mark_facet(facet: str | None, mark: str) -> str | None:
    """A mark's ``facet``: None, or ``"repeat"`` to draw all its rows in every
    facet panel instead of splitting them by the facet fields."""
    if facet not in (None, "repeat"):
        raise ChartError(f'{mark} facet: expected "repeat" or None; received {shown(facet)}')
    return facet


def _mark_legend(legend: Any, mark: str) -> Literal[False] | None:
    """A mark's ``legend``: ``False`` leaves it out of the chart's legends."""
    if legend is not None and legend is not False:
        raise ChartError(
            f"{mark} legend: expected False, which leaves the mark out of the legends; "
            f"received {shown(legend)}"
        )
    return legend


def _check_size(radius: float | None, size: str | None, mark: str) -> None:
    """Refuses a radius that is not a positive number of pixels, or a radius
    with a size column."""
    if radius is not None and size is not None:
        raise ChartError(f"{mark} radius: a constant radius or a size column, not both; drop one")
    if radius is not None and not (_finite(radius) and radius > 0):
        raise ChartError(
            f"{mark} radius: expected a positive number of pixels; received {shown(radius)}"
        )


_SIDES = ("top", "right", "bottom", "left")


def _sides(value: Any, role: str) -> list[str] | None:
    """Sides of a rectangle, each once, such as those its outline draws."""
    if value is None:
        return None
    if not listlike(value):
        raise ChartError(
            f'{role}: expected sides, each once, such as ["top", "bottom"]; received {shown(value)}'
        )
    for side in value:
        if not isinstance(side, str) or side not in _SIDES:
            raise ChartError(f"{role}: expected {listed(_SIDES)}; received {shown(side)}")
    if len(set(value)) != len(value):
        raise ChartError(
            f'{role}: expected sides, each once, such as ["top", "bottom"]; received {shown(value)}'
        )
    return list(value)


def _entries(at: str, channel: Any) -> list[tuple[str, Any]]:
    """A channel's spec with its place, or a list's entries with theirs
    (``encode.color[1]``)."""
    if isinstance(channel, list):
        return [(f"{at}[{i}]", entry) for i, entry in enumerate(channel)]
    return [(at, channel)]


def _part_fields(label: Any) -> list[tuple[str, Any]]:
    """The columns a label's parts name (``field``, ``label``), by their
    places in its content (``"[1].field"``)."""
    content = label.get("content") if isinstance(label, dict) else None
    return [
        (f"[{i}].{name}", part[name])
        for i, part in enumerate(content or ())
        for name in ("field", "label")
        if isinstance(part, dict) and part.get(name) is not None
    ]


def _colors(colors: str | Sequence[str] | None, role: str) -> str | list[str] | None:
    """A scheme name, checked, or a list of colors."""
    if isinstance(colors, str):
        if colors not in SCHEMES:
            raise ChartError(
                f"{role}: unknown scheme {shown(colors)}; name one of {listed(SCHEMES)}"
            )
        return colors
    if colors is None:
        return None
    if not listlike(colors):
        raise ChartError(
            f"{role}: expected a scheme's name or a list of colors; received {shown(colors)}"
        )
    for i, color in enumerate(colors):
        if not isinstance(color, str):
            raise ChartError(f"{role}[{i}]: expected a color; received {shown(color)}")
    return list(colors)


def _range(
    values: tuple[float, float] | None, role: str, *, minimum: float = -math.inf
) -> list[float] | None:
    """Two finite ascending numbers, at least ``minimum``, as a list."""
    if values is None:
        return None
    bound = "" if minimum == -math.inf else f", from {minimum:g} up"
    try:
        low, high = values
        if not all(_finite(v) for v in (low, high)):
            raise ValueError
    except (TypeError, ValueError):
        raise ChartError(
            f"{role}: expected two finite numbers, ascending{bound}; received {shown(values)}"
        ) from None
    if not minimum <= low < high:
        raise ChartError(
            f"{role}: expected two finite numbers, ascending{bound}; received {values!r}"
        )
    return [float(low), float(high)]


def _midpoint(
    midpoint: float | None, domain: tuple[float, float] | None, role: str
) -> float | None:
    """A finite color midpoint, inside the color domain when there is one."""
    if midpoint is None:
        return None
    if not _finite(midpoint):
        raise ChartError(
            f"{role} color_midpoint: expected a finite number; received {shown(midpoint)}"
        )
    if domain is not None and not domain[0] <= midpoint <= domain[1]:
        raise ChartError(
            f"{role} color_midpoint: expected a value inside color_domain {domain!r}; "
            f"received {midpoint!r}"
        )
    return float(midpoint)


def _finite(value: Any) -> bool:
    """A real, finite number; booleans are not numbers here."""
    return is_number(value) and not isinstance(value, bool) and math.isfinite(value)


def _flag(value: Any, role: str) -> bool | None:
    if value is not None and not isinstance(value, bool):
        raise ChartError(f"{role}: expected True or False; received {shown(value)}")
    return value


def _halo(value: HaloOption | None, location: str) -> Any:
    return halo_spec(value, location)
