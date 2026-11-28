"""Layout marks, which lay out their own chart: pies, gauges, funnels,
treemaps, sunbursts, radars, and Sankey diagrams."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal, cast

import numpy as np

from .._data import listlike
from .._encoding import Measure, SunburstLabels, TreemapLabels, choice_option, fraction_option
from .._errors import ChartError, is_number, shown, tuplable, tupled
from .._guides import _NUMBER_FORMAT, _TIME_FORMAT, FORMS, Format, _check_format, format_spec
from .._style import HaloOption, Look, _built, _spec, built_spec
from .common import _check_method_options, _finite, _flag, _halo, _part_fields, _range
from .tooltips import Tooltip

if TYPE_CHECKING:
    from .._chart import Chart


#: What only times are written with: a pattern, a fiscal year, or Intl.DateTimeFormat's own options.
_TIME_ONLY = (_TIME_FORMAT - _NUMBER_FORMAT) | {"time", "fiscal"}


@_check_method_options
def pie(
    self,  # type: Chart
    category: str,
    value: str | None = None,
    *,
    data: Any = None,
    inner_radius: float | None = None,
    sort: Literal["value", "input"] | None = None,
    labels: bool | None = None,
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    id: str | None = None,
) -> Chart:
    """A pie: a slice per value of ``category``, sized by the sum of
    ``value`` over its rows, or their count without it.

    ``inner_radius``, a fraction of the pie's radius below 1, makes a
    donut. Slices go largest first, clockwise from the top, unless
    ``sort="input"``. ``tooltip=hg.Tooltip(fields=[...])`` shows more of
    the row of a slice that is one row. A pie has its chart to itself; with facets, each
    panel, a pie of the panel's rows; with panels, the one ``panel`` names.
    """
    self._layout_place("pie")
    if inner_radius is not None and not (
        is_number(inner_radius) and not isinstance(inner_radius, bool) and 0 <= inner_radius < 1
    ):
        raise ChartError(
            "pie inner_radius: expected a fraction of at least 0 and below 1; "
            f"received {shown(inner_radius)}"
        )
    table = self._mark_table(data)
    self._require(table, category, ("category",), "pie category")
    self._require(table, value, ("number",), "pie value")
    return self._add(
        {
            "type": "pie",
            "category": category,
            "value": value,
            "innerRadius": inner_radius,
            "sort": choice_option(sort, ("value", "input"), "pie sort"),
            "labels": _flag(labels, "pie labels"),
            "tooltip": self._mark_tooltip(table, tooltip, "pie"),
            "panel": panel,
            "id": id,
        },
        table,
    )


@_check_method_options
def gauge(
    self,  # type: Chart
    value: str,
    *,
    data: Any = None,
    min: float | None = None,
    max: float | None = None,
    bands: Sequence[float | tuple[float, str]] | None = None,
    label: str | None = None,
    format: Format | dict[str, Any] | None = None,
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    id: str | None = None,
) -> Chart:
    """A gauge: the last finite value of the ``value`` column on a dial
    from ``min`` to ``max`` (0 to 100 by default), so rows appended to a
    live chart move it.

    ``bands`` color ranges of the dial by their upper ends, ascending,
    above ``min`` and at most ``max``: numbers, or ``(to, color)`` pairs.
    Each starts where the previous one ends, the first at ``min``; colors
    default to the theme's palette. ``format`` writes the value and the
    dial's ends: an ``hg.Format`` of numbers (``hg.Format(duration="millisecond")``)
    or Intl.NumberFormat options; ``tooltip=hg.Tooltip(fields=[...])``
    shows more of the row the needle shows. A gauge has its chart to
    itself; with facets, each panel, the last value of the panel's rows;
    with panels, the one ``panel`` names.
    """
    self._layout_place("gauge")
    written = format_spec(format, "gauge format")
    if isinstance(format, dict) and not set(format) & FORMS:
        _check_format(format, "gauge format", _NUMBER_FORMAT)
    if written is not None and "time" in written:
        raise ChartError(
            "gauge format: a gauge writes numbers; give a number format, "
            'such as hg.Format(number=",.0f")'
        )
    table = self._mark_table(data)
    self._require(table, value, ("number",), "gauge value")
    for name, end in (("min", min), ("max", max)):
        if end is not None and not _finite(end):
            raise ChartError(f"gauge {name}: expected a finite number; received {shown(end)}")
    # Ends the gauge does not give may come from the value column's
    # display, which the engine reads and checks them by; without
    # displays they are 0 and 100.
    displays = self._settings.get("fields") is not None
    low = min if min is not None else None if displays else 0.0
    high = max if max is not None else None if displays else 100.0
    if low is not None and high is not None and not low < high:
        raise ChartError(
            f"gauge min: expected a finite min below a finite max; received {low!r} and {high!r}"
        )
    return self._add(
        {
            "type": "gauge",
            "value": value,
            "min": None if min is None else float(min),
            "max": None if max is None else float(max),
            "bands": _gauge_bands(bands, low, high),
            "label": label,
            "format": written,
            "tooltip": self._mark_tooltip(table, tooltip, "gauge"),
            "panel": panel,
            "id": id,
        },
        table,
    )


@_check_method_options
def funnel(
    self,  # type: Chart
    category: str,
    value: str | None = None,
    *,
    data: Any = None,
    sort: Literal["input", "value"] | None = None,
    labels: bool | None = None,
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    halo: HaloOption | None = None,
    id: str | None = None,
) -> Chart:
    """A funnel: a centered bar per value of ``category``, top to bottom,
    as wide as the sum of ``value`` over its rows (or their count) is to
    the largest stage's. Missing, negative, and infinite values count as
    nothing.

    Stages keep the column's order unless ``sort="value"`` puts the
    largest first. ``labels=False`` leaves out the stage names and the
    values with their share of the first stage; ``tooltip=hg.Tooltip(fields=[...])``
    shows more of the row of a stage that is one row. A funnel has its chart to
    itself; with facets, each panel, a funnel of the panel's rows; with
    panels, the one ``panel`` names.
    """
    self._layout_place("funnel")
    table = self._mark_table(data)
    self._require(table, category, ("category",), "funnel category")
    self._require(table, value, ("number",), "funnel value")
    return self._add(
        {
            "type": "funnel",
            "halo": _halo(halo, "funnel"),
            "category": category,
            "value": value,
            "sort": choice_option(sort, ("value", "input"), "funnel sort"),
            "labels": _flag(labels, "funnel labels"),
            "tooltip": self._mark_tooltip(table, tooltip, "funnel"),
            "panel": panel,
            "id": id,
        },
        table,
    )


@_check_method_options
def treemap(
    self,  # type: Chart
    path: Sequence[str] | None = None,
    value: str | None = None,
    *,
    node: str | None = None,
    parent: str | None = None,
    data: Any = None,
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
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    id: str | None = None,
) -> Chart:
    """A treemap: nested rectangles for a tree, each leaf's area its share
    of the sum of ``value`` (or of the rows).

    The tree is ``path``, category columns from the outermost group in, or
    ``node`` and ``parent`` columns naming each row's node and its parent.
    Children fill their parent in rows kept close to square
    (``tile="squarify"``, the default), or sliced along x, theirs along y,
    and so on (``"slice-dice"``, a Marimekko's columns and cells); largest
    first (``sort="value"``) or in the data's order (``"input"``), ``gap``
    pixels apart (2 by default), ``levels`` deep below the root (all by
    default). Names go where they fit (``labels``, an ``hg.TreemapLabels``).

    Items take their top-level group's color, or with ``color`` (a column
    of the path) their value of it, those above its level unfilled; the
    legend toggles colors. ``fill_opacity`` is a number or an
    ``hg.Measure``; ``leaf`` and ``branch`` (``hg.Look``) are laid over
    items without and with children. ``breadcrumbs`` shows the path above
    a drilled tree (by default while the chart drills it or it is
    drilled), never (False), or always (True).
    ``tooltip=hg.Tooltip(fields=[...])`` shows more of the row of a node
    that is one row.
    A treemap has its chart to itself; with facets, each panel, a treemap
    of the panel's rows; with panels, the one ``panel`` names.
    """
    kind = "treemap"
    if gap is not None and not (
        is_number(gap) and not isinstance(gap, bool) and 0 <= gap < math.inf
    ):
        raise ChartError(f"treemap gap: expected pixels of at least 0; received {shown(gap)}")
    return self._tree(
        kind,
        path,
        value,
        node,
        parent,
        data,
        labels,
        tooltip,
        panel,
        id,
        {
            "tile": choice_option(tile, ("squarify", "slice-dice"), "treemap tile"),
            "gap": gap,
        },
        {
            "sort": sort,
            "levels": levels,
            "color": color,
            "fill_opacity": fill_opacity,
            "leaf": leaf,
            "branch": branch,
            "breadcrumbs": breadcrumbs,
        },
    )


@_check_method_options
def sunburst(
    self,  # type: Chart
    path: Sequence[str] | None = None,
    value: str | None = None,
    *,
    node: str | None = None,
    parent: str | None = None,
    data: Any = None,
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
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    id: str | None = None,
) -> Chart:
    """A sunburst: a tree as rings around a center, each node's angle its
    share of its parent's; the tree, and where it is drawn, as for
    ``treemap``.

    ``levels`` rings show below the root (all by default; with it, rings
    keep their width as the tree is drilled), around a center
    ``inner_radius`` of the radius wide (0.18 by default). A drilled root
    is painted in the center unless ``center=False``; a click there goes up
    either way. ``gap`` is the pixels between sectors and rings (2 by
    default), or ``(angular, radial)``. Names go across sectors, or along
    their radius with ``labels=hg.SunburstLabels(rotation="radial")``, where
    they fit or, with ``min_angle``, in every sector at least that many
    degrees wide. Colors, ``fill_opacity``, ``leaf``, ``branch``, ``sort``,
    and ``breadcrumbs`` as for ``treemap``."""
    if inner_radius is not None and not (
        is_number(inner_radius) and not isinstance(inner_radius, bool) and 0 <= inner_radius < 1
    ):
        raise ChartError(
            "sunburst inner_radius: expected a fraction of at least 0 and below 1; "
            f"received {shown(inner_radius)}"
        )

    def pixels(g: Any) -> bool:
        return is_number(g) and not isinstance(g, bool) and 0 <= g < math.inf

    spread: Any = gap
    pair = tupled(gap, (2,)) if gap is not None and not is_number(gap) and tuplable(gap) else None
    if pair is not None and len(pair) == 2 and all(map(pixels, pair)):
        spread = {"angular": float(pair[0]), "radial": float(pair[1])}
    elif gap is not None and (pair is not None or not pixels(gap)):
        raise ChartError(
            "sunburst gap: expected pixels of at least 0, or (angular, radial) pixels; "
            f"received {shown(gap)}"
        )
    return self._tree(
        "sunburst",
        path,
        value,
        node,
        parent,
        data,
        labels,
        tooltip,
        panel,
        id,
        {
            "innerRadius": inner_radius,
            "center": _flag(center, "sunburst center"),
            "gap": spread,
        },
        {
            "sort": sort,
            "levels": levels,
            "color": color,
            "fill_opacity": fill_opacity,
            "leaf": leaf,
            "branch": branch,
            "breadcrumbs": breadcrumbs,
        },
    )


def _tree(
    self,  # type: Chart
    kind: str,
    path: Sequence[str] | None,
    value: str | None,
    node: str | None,
    parent: str | None,
    data: Any,
    labels: Any,
    tooltip: Tooltip | None,
    panel: str | None,
    id: str | None,
    own: dict[str, Any],
    paint: dict[str, Any],
) -> Chart:
    self._layout_place(kind)
    table = self._mark_table(data)
    if path is not None and (node is not None or parent is not None):
        raise ChartError(f"{kind} path: a path, or node and parent, not both; drop one")
    if path is not None:
        if not listlike(path) or len(path) == 0:
            raise ChartError(
                f"{kind} path: expected a list of at least one column; received {shown(path)}"
            )
        for i, name in enumerate(path):
            self._require(table, name, ("category",), f"{kind} path[{i}]", optional=False)
    elif node is not None and parent is not None:
        self._require(table, node, ("category",), f"{kind} node")
        self._require(table, parent, ("category",), f"{kind} parent")
    else:
        raise ChartError(f"{kind}: needs a path of category columns, or node and parent")
    self._require(table, value, ("number",), f"{kind} value")
    color = paint["color"]
    if color is not None:
        if path is None:
            raise ChartError(
                f"{kind} color: a tree of node and parent columns is colored by its "
                "top-level nodes; give a path to color by one of its levels, or drop color"
            )
        if color not in path:
            raise ChartError(
                f"{kind} color: {color!r} is not a column of the path; use one of {', '.join(path)}"
            )
    levels = paint["levels"]
    if levels is not None and (
        isinstance(levels, bool) or not isinstance(levels, int) or levels < 1
    ):
        raise ChartError(
            f"{kind} levels: expected a whole number of at least 1; received {shown(levels)}"
        )
    fill_opacity = paint["fill_opacity"]
    if fill_opacity is not None and not is_number(fill_opacity):
        fill_opacity = built_spec(fill_opacity, Measure, f"{kind} fill_opacity")
    elif fill_opacity is not None:
        fraction_option(fill_opacity, f"{kind} fill_opacity")
    return self._add(
        {
            "type": kind,
            "path": list(path) if path is not None else None,
            "node": node,
            "parent": parent,
            "value": value,
            "labels": self._tree_labels(kind, table, path, node, parent, labels),
            **own,
            "sort": choice_option(paint["sort"], ("value", "input"), f"{kind} sort"),
            "levels": levels,
            "color": color,
            "fillOpacity": fill_opacity,
            "leaf": _tree_look(paint["leaf"], f"{kind} leaf"),
            "branch": _tree_look(paint["branch"], f"{kind} branch"),
            "breadcrumbs": _flag(paint["breadcrumbs"], f"{kind} breadcrumbs"),
            "tooltip": self._mark_tooltip(table, tooltip, kind),
            "panel": panel,
            "id": id,
        },
        table,
    )


def _tree_labels(
    self,  # type: Chart
    kind: str,
    table: int,
    path: Sequence[str] | None,
    node: str | None,
    parent: str | None,
    labels: Any,
) -> Any:
    """A tree's ``labels`` as the spec takes them: True, False, or an
    ``hg.TreemapLabels`` or ``hg.SunburstLabels``, refusing parts reading
    columns the table lacks."""
    if labels is None or isinstance(labels, bool):
        return labels
    kind_of = TreemapLabels if kind == "treemap" else SunburstLabels
    spec = built_spec(labels, kind_of, f"{kind} labels")
    for i, part in enumerate(spec.get("content") or ()):
        written = part.get("format") if isinstance(part, dict) else None
        if isinstance(written, dict) and _TIME_ONLY & written.keys():
            raise ChartError(
                f"{kind} labels.content[{i}].format: tree labels write numbers, which time "
                'formats do not; give a number format, such as hg.Format(number=",.0f")'
            )
    tree = {*(path or ()), node, parent}
    for at, field in _part_fields(spec):
        if field not in tree:
            self._require(table, field, ("category", "number"), f"{kind} labels.content{at}")
    return spec


@_check_method_options
def radar(
    self,  # type: Chart
    category: str | None = None,
    value: str | None = None,
    *,
    fields: Sequence[str] | None = None,
    series: str | None = None,
    data: Any = None,
    domain: tuple[float, float] | None = None,
    fill_opacity: float | None = None,
    points: bool | None = None,
    label: str | None = None,
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    halo: HaloOption | None = None,
    id: str | None = None,
) -> Chart:
    """A radar: spokes from a center, clockwise from the top, and a polygon
    per series through its value on each spoke.

    Spokes are the values of the ``category`` column, with ``value`` the
    number on each, or the distinct number columns ``fields``, each row a
    polygon named by its ``series`` value. A later row replaces an earlier
    one's values for the same series (and spoke); without ``series``, all
    rows are one polygon, so with ``fields`` the last row is drawn. A radar
    draws 3 to 100 spokes. Every spoke shares one scale: from 0 (or the
    smallest value) to a round number above the largest, or ``domain``;
    values outside it are drawn at the rim or the center. A missing value
    breaks the polygon's outline there and leaves it unfilled.
    ``tooltip=hg.Tooltip(fields=[...])`` shows more of the row each value
    is. A radar has its chart to itself; with facets, each panel, the values of the
    panel's rows on the table's spokes, each panel scaled to its own
    values unless ``domain`` is given; with panels, the one ``panel`` names.
    """
    self._layout_place("radar")
    table = self._mark_table(data)
    long = category is not None or value is not None
    if long == (fields is not None) or (long and (category is None or value is None)):
        raise ChartError(
            "radar: needs category and value columns (a spoke per category) "
            "or fields (a spoke per column), not both"
        )
    if fields is not None:
        if not listlike(fields):
            raise ChartError(f"radar fields: expected a list of columns; received {shown(fields)}")
        for i, name in enumerate(fields):
            self._require(table, name, ("number",), f"radar fields[{i}]", optional=False)
        repeated = next((i for i, name in enumerate(fields) if name in fields[:i]), None)
        if repeated is not None:
            raise ChartError(
                f"radar fields[{repeated}]: {fields[repeated]!r} is listed twice; "
                "list each column once"
            )
        _check_spokes(len(fields), "fields", "the fields make")
    else:
        self._require(table, category, ("category",), "radar category")
        self._require(table, value, ("number",), "radar value")
        assert category is not None
        codes = self._tables[table][1].column(category).values
        # Derived tables have no rows here; their spokes are checked when drawn.
        spokes = len(np.unique(codes[codes >= 0]))
        if spokes > 0:
            _check_spokes(spokes, "category", f"{category!r} has")
    self._require(table, series, ("category",), "radar series")
    if fill_opacity is not None and not (
        is_number(fill_opacity) and not isinstance(fill_opacity, bool) and 0 <= fill_opacity <= 1
    ):
        raise ChartError(
            f"radar fill_opacity: expected a number from 0 to 1; received {shown(fill_opacity)}"
        )
    return self._add(
        {
            "type": "radar",
            "halo": _halo(halo, "radar"),
            "category": category,
            "value": value,
            "fields": list(fields) if fields is not None else None,
            "series": series,
            "domain": _range(domain, "radar domain"),
            "fillOpacity": fraction_option(fill_opacity, "radar fill_opacity"),
            "points": _flag(points, "radar points"),
            "label": label,
            "tooltip": self._mark_tooltip(table, tooltip, "radar"),
            "panel": panel,
            "id": id,
        },
        table,
    )


@_check_method_options
def sankey(
    self,  # type: Chart
    source: str,
    target: str,
    value: str | None = None,
    *,
    data: Any = None,
    labels: bool | None = None,
    node_width: float | None = None,
    sort: Literal["input", "value"] | None = None,
    tooltip: Tooltip | None = None,
    panel: str | None = None,
    halo: HaloOption | None = None,
    id: str | None = None,
) -> Chart:
    """A Sankey diagram: a row per flow, from the node named in ``source``
    to the one named in ``target``, each link as thick as the sum of
    ``value`` over its rows, or their count without it.

    A name in both columns is one node. Rows without a positive value,
    links from a node to itself, and links that would close a cycle are
    left out. Nodes are ordered in their column to keep links short and
    crossings few, unless ``sort="input"`` keeps the order they first
    appear in or ``sort="value"`` puts the largest first. ``node_width``
    is in pixels; ``tooltip=hg.Tooltip(fields=[...])`` shows more of the
    row of a link that is one row. A Sankey diagram has its chart to
    itself; with facets,
    each panel, the flows of the panel's rows; with panels, the one
    ``panel`` names.
    """
    self._layout_place("sankey")
    if node_width is not None and not (
        is_number(node_width) and not isinstance(node_width, bool) and 0 < node_width < math.inf
    ):
        raise ChartError(
            f"sankey node_width: expected a positive number of pixels; received {shown(node_width)}"
        )
    if sort not in (None, "input", "value"):
        raise ChartError(f'sankey sort: expected "input" or "value"; received {shown(sort)}')
    table = self._mark_table(data)
    self._require(table, source, ("category",), "sankey source")
    self._require(table, target, ("category",), "sankey target")
    self._require(table, value, ("number",), "sankey value")
    return self._add(
        {
            "type": "sankey",
            "halo": _halo(halo, "sankey"),
            "source": source,
            "target": target,
            "value": value,
            "labels": _flag(labels, "sankey labels"),
            "nodeWidth": node_width,
            "sort": sort,
            "tooltip": self._mark_tooltip(table, tooltip, "sankey"),
            "panel": panel,
            "id": id,
        },
        table,
    )


def _check_spokes(spokes: int, option: str, what: str) -> None:
    """Refuses a radar of too few spokes to make a polygon, or too many to read;
    `what` says what makes them, as in "'k' has"."""
    if spokes < 3:
        raise ChartError(f"radar {option}: needs at least 3 spokes; {what} {spokes}")
    if spokes > 100:
        raise ChartError(f"radar {option}: draws at most 100 spokes; {what} {spokes}")


def _gauge_bands(
    bands: Sequence[float | tuple[float, str]] | None, low: float | None, high: float | None
) -> list[dict[str, Any]] | None:
    """Gauge bands as the spec takes them, checked as the engine checks them:
    against the dial's ends where they are known (``None`` for an end the
    value column's display may give, which the engine checks)."""
    if bands is None:
        return None
    if not listlike(bands):
        raise ChartError(
            f"gauge bands: expected a list of numbers or (to, color) pairs; received {shown(bands)}"
        )
    out: list[dict[str, Any]] = []
    previous = low
    for band in bands:
        if isinstance(band, (tuple, list)):
            if len(band) != 2:
                raise ChartError(
                    f"gauge bands: expected numbers or (to, color) pairs; received {shown(band)}"
                )
            to, color = band
        else:
            to, color = band, None
        if (
            not _finite(to)
            or (low is not None and not low < to)
            or (high is not None and to > high)
        ):
            ends = [
                *([f"above min ({low:g})"] if low is not None else []),
                *([f"at most max ({high:g})"] if high is not None else []),
            ]
            raise ChartError(
                f"gauge bands: expected {'ends ' + ' and '.join(ends) if ends else 'finite ends'}; "
                f"received {shown(to)}"
            )
        if previous is not None and not to > previous:
            raise ChartError(
                f"gauge bands: expected ends in ascending order; received {to:g} after {previous:g}"
            )
        out.append({"to": float(to)} if color is None else {"to": float(to), "color": color})
        previous = to
    return out


def _tree_look(look: Any, role: str) -> dict[str, Any] | None:
    """A tree's ``leaf`` or ``branch`` look as the spec takes it: of a
    ``Look``'s fields, trees draw ``fill``, ``fill_opacity``, and ``opacity``."""
    if look is None:
        return None
    built = _built(look, Look, role)
    for name in ("stroke", "stroke_width", "dash", "stroke_opacity", "radius"):
        if getattr(built, name) is not None:
            raise ChartError(
                f"{role}: a tree's look takes fill, fill_opacity, and opacity; drop {name}"
            )
    return cast("dict[str, Any]", _spec(built))
