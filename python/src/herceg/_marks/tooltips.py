"""Tooltip options: what the tooltips of every mark (its ``tooltip``) and of
the chart (its default) show."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal

from .._data import listlike
from .._encoding import LabelPart, choice_option, content_spec
from .._errors import ChartError, Role, located, refuses, shown
from .._fields import writes
from .._guides import _NUMBER_FORMAT, _TIME_FORMAT, FORMS, Format, _check_format, format_spec
from .common import _flag


@refuses
@dataclass(frozen=True)
class TooltipField:
    """A column a mark's tooltips show of the row they are at, besides its
    values: ``field`` names it, ``label`` names it in the tooltip (the
    column's name by default), and ``format`` writes it, as
    ``AxisOptions.format`` takes formats: an ``hg.Format``
    (``hg.Format(binary="B")``) or Intl format options
    (``{"maximumFractionDigits": 0}``, ``{"weekday": "short"}``), number
    forms for numbers and time forms for times. Without a format, numbers
    are written as the chart's other numbers, times as the x axis writes
    them when it is a time axis (else as dates and times), and categories
    as they are."""

    field: str
    label: str | None = None
    format: Format | dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.field, str):
            raise ChartError(
                f"TooltipField field: expected a column name; received {shown(self.field)}"
            )
        if isinstance(self.format, dict) and not set(self.format) & FORMS:
            _check_format(self.format, "TooltipField format", _NUMBER_FORMAT | _TIME_FORMAT)
        elif self.format is not None:
            format_spec(self.format, "TooltipField format")

    def _spec(self) -> dict[str, Any]:
        spec = {
            "field": self.field,
            "label": self.label,
            "format": format_spec(self.format, "TooltipField format"),
        }
        return {key: value for key, value in spec.items() if value is not None}


@refuses
@dataclass
class TooltipTotal:
    """A mark's row after its points in a reading along an axis, the sum of
    the values the reading lists of the mark (see ``hg.Tooltip``'s
    ``total``): under ``label`` ("Total" by default), written in ``format``,
    a number format, else as the points' values are::

        chart.line(x="time", y="revenue", series="region", tooltip=hg.Tooltip(
            total=hg.TooltipTotal(label="All regions", format=hg.Format(number=",.0f"))))
    """

    label: str | None = None
    format: Format | dict[str, Any] | None = None

    def __post_init__(self) -> None:
        if self.label is not None and not isinstance(self.label, str):
            raise ChartError(f"TooltipTotal label: expected text; received {shown(self.label)}")
        self._spec()

    def _spec(self) -> dict[str, Any]:
        written = format_spec(self.format, "TooltipTotal format")
        if written is not None and not writes(written, "number"):
            raise ChartError("TooltipTotal format: totals are numbers; give a number format")
        spec = {"label": self.label, "format": written}
        return {key: value for key, value in spec.items() if value is not None}


#: Marks whose tooltips total a reading's points.
_TOTALS = ("line", "area", "bar", "point")


@refuses
@dataclass
class Tooltip:
    """Tooltip options: ``axis_labels`` labels the crosshair on the axes, as
    financial charts do: the inspected value on the axis it follows and the
    pointer's position on the other. What the tooltip reads is the chart's
    ``inspection`` (see ``hg.InspectionOptions``).

    ``fields`` are columns of the row a tooltip is at that it shows besides a
    mark's values, such as a count that is not plotted: column names or
    ``hg.TooltipField``. They belong to marks whose points or items are rows
    (lines, areas, bars, points, heatmaps, maps, 3D points, lines, and
    surfaces, radars, and gauges; pie slices, funnel stages, tree nodes, and
    Sankey links that are one row): give them to the mark,
    ``chart.line(..., tooltip=hg.Tooltip(fields=["requests"]))``, or to a
    one-call helper, ``hg.line(..., tooltip=...)``, whose one mark
    takes them. The keyboard's announcements and hover events read them too.

    ``content`` writes each point's row as one line of parts, in place of
    its name and value, as labels' parts do (see ``hg.LabelPart``): text,
    ``hg.LabelPart(series=True)`` (what the tooltip names the point by),
    ``(value=True)`` (its value as the tooltip writes it, or in its
    ``format``, a time where that is a time pattern or Intl date options),
    ``(field=...)`` of its row ("–" where no one row is the
    point, as for a slice of several rows), or ``(label=...)``, each in its
    ``style``. The swatch stays, ``fields`` follow under it, and the keyboard
    and hover events read the same text. It belongs to the marks that take
    ``fields``::

        row = [hg.LabelPart(series=True), " ",
               hg.LabelPart(value=True, format=hg.Format(number=".1f")), " ",
               hg.LabelPart(field="time", format=hg.Format(time="%H:%M:%S.%L"))]
        chart.line(x="time", y="value", series="series", tooltip=hg.Tooltip(content=row))

    ``heading`` is the tooltip's first row, the place it reads by default
    (the x value, or what an item's values measure). On the chart,
    ``heading=False`` leaves it out of every tooltip, shared, pinned, and
    the keyboard's, so the rows follow at once. On a mark, parts as
    ``content`` takes them head a tooltip showing one of its points alone
    (``mode`` "nearest", an item, or one series read), such as a range's
    id; tooltips of several points keep the place, and the keyboard
    announces the place, and the heading before the point::

        hg.Chart(observations, tooltip=hg.Tooltip(heading=False)).line(
            x="time", y="value", series="series", tooltip=hg.Tooltip(content=row))
        chart.custom(..., tooltip=hg.Tooltip(heading=[hg.LabelPart(field="id")]))

    Treemaps' and sunbursts' ``content`` and ``heading`` take
    ``hg.LabelPart(path=True, separator=...)`` too, a node's levels from the
    top of the whole tree, each as its column's display writes it::

        chart.sunburst(path=["level1", "level2", "level3"], value="size", tooltip=hg.Tooltip(
            content=["flare/", hg.LabelPart(path=True, separator="/")]))

    ``total=True`` (or an ``hg.TooltipTotal`` with its ``label`` and
    ``format``), on lines, filled areas, bars, and points of number values,
    adds a row after the mark's points in a reading along an axis (any
    ``mode`` but "nearest"), one point too: the sum of the values the
    reading lists of the mark. Hidden series and series reading nothing
    there are left out; a stack's points carry their own values, a
    normalized stack's (``stack="fill"``) their raw ones; under
    ``snap="each"`` the points may stand at different places. It is
    written as the points' values are (their column's display over the
    axis' ``tooltip_format``; the axis' alone where the mark's value
    columns' displays differ), or in its ``format``; a sum too large for a
    float shows no row. Category and datetime values, and bands, have no
    total. Inspections carry it (``hg.Inspection.totals``), and the
    keyboard's ``i`` reads it after the points::

        chart.line(x="time", y="revenue", series="region", tooltip=hg.Tooltip(total=True))

    ``pin="click"`` pins the tooltip where a click (or Enter on the keyboard
    cursor) inspects: it stays, takes the pointer and focus so its links
    work, and goes on Escape, a click outside, or another click. Pinned at
    a point it follows that point (``mode`` "nearest"), else the value on
    the inspection's axis, read again as data changes; a widget's
    ``pin()`` pins from Python and ``on_pin`` hears of pins.
    """

    axis_labels: bool = False
    fields: Sequence[str | TooltipField] | None = None
    pin: Literal["click"] | None = None
    content: Sequence[str | LabelPart | Mapping[str, Any]] | None = None
    heading: Literal[False] | Sequence[str | LabelPart | Mapping[str, Any]] | None = None
    total: Literal[True] | TooltipTotal | None = None

    def _spec(self) -> dict[str, Any]:
        if self.fields is not None:
            raise ChartError(
                "Chart tooltip fields: belong to the marks whose rows they show; give "
                "them to a mark, as in chart.line(..., tooltip=hg.Tooltip(fields=[...]))"
            )
        if self.content is not None:
            raise ChartError(
                "Chart tooltip content: belongs to the marks whose rows it writes; give it "
                "to a mark, as in chart.line(..., tooltip=hg.Tooltip(content=[...]))"
            )
        if self.total is not None:
            raise ChartError(
                "Chart tooltip total: belongs to the marks whose points it sums; give it to a "
                "mark, as in chart.line(..., tooltip=hg.Tooltip(total=True))"
            )
        spec: dict[str, Any] = {}
        if _flag(self.axis_labels, "Tooltip axis_labels"):
            spec["axisLabels"] = True
        if self.pin is not None:
            spec["pin"] = choice_option(self.pin, ("click",), "Tooltip pin")
        if self.heading is False:
            spec["heading"] = False
        elif listlike(self.heading) and not isinstance(self.heading, str):
            raise ChartError(
                "Chart tooltip heading: parts belong to the mark whose points they head; give "
                "them to a mark, as in chart.line(..., tooltip=hg.Tooltip(heading=[...]))"
            )
        elif self.heading is not None:
            raise ChartError(
                "Chart tooltip heading: expected False (no heading), or nothing for the "
                f"place; received {shown(self.heading)}"
            )
        return spec

    def _mark_spec(self, mark: str) -> dict[str, Any]:
        """The tooltip of mark ``mark``: its fields, content, heading, and total."""
        role = Role(mark).field("tooltip")
        for name in ("axis_labels", "pin"):
            if getattr(self, name):
                raise role.field(name).error("is the chart's; give it to the chart's tooltip")
        if self.heading is False:
            raise role.field("heading").error(
                "False is the chart's; give it to the chart's tooltip"
            )
        spec: dict[str, Any] = {}
        tree = mark in ("treemap", "sunburst")
        if self.content is not None:
            spec["content"] = located(
                role.field("content"),
                lambda: content_spec(self.content, f"{mark} tooltip content", tree),
            )
        if self.heading is not None:
            spec["heading"] = located(
                role.field("heading"),
                lambda: content_spec(self.heading, f"{mark} tooltip heading", tree),
            )
        if self.total is not None:
            at = role.field("total")
            if mark == "segment":
                raise at.error("a segment's points are ranges, which have no total; drop total")
            if mark not in _TOTALS:
                raise at.error(
                    "only lines, filled areas, bars, and points total their points; drop total"
                )
            if isinstance(self.total, TooltipTotal):
                spec["total"] = located(at, self.total._spec) or True
            elif self.total is True:
                spec["total"] = True
            else:
                raise at.error(f"expected True or an hg.TooltipTotal; received {shown(self.total)}")
        if self.fields is None:
            return spec
        at = role.field("fields")
        if isinstance(self.fields, str) or not listlike(self.fields):
            raise at.error(f"expected a list of columns; received {shown(self.fields)}")
        fields: list[Any] = []
        for i, entry in enumerate(self.fields):
            if isinstance(entry, TooltipField):
                fields.append(located(at.index(i), entry._spec))
            elif isinstance(entry, str):
                fields.append(entry)
            else:
                raise at.index(i).error(
                    f"expected a column name or an hg.TooltipField; received {shown(entry)}"
                )
        return {**spec, "fields": fields}
