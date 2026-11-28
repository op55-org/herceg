"""Annotation marks: rules, regions, and text."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal

from .._data import Matrix, Table
from .._derive import Derived, RowGroups, RowTotals
from .._encoding import (
    Coordinate,
    Encodings,
    Fraction,
    ItemAnchor,
    Label,
    MarkAnchor,
    Pixels,
    Position,
    coordinate_field,
    coordinate_spec,
    encodings_spec,
    fraction_option,
    item_fields,
    label_spec,
    pixels_option,
    tagged_spec,
)
from .._errors import ChartError, python_path, shown
from .._fields import AtThresholds
from .._style import HaloOption, Side, _built, built_spec
from .common import (
    _ANY,
    _NUMERIC,
    Clip,
    Dash,
    _check_method_options,
    _clip,
    _dash,
    _entries,
    _finite,
    _flag,
    _halo,
    _mark_facet,
    _part_fields,
    _sides,
)

if TYPE_CHECKING:
    from .._chart import Chart


#: The channels a region's ``encode`` takes.
_REGION_CHANNELS = ("color", "fill", "stroke", "opacity")


@_check_method_options
def rule(
    self,  # type: Chart
    *,
    x: Coordinate | AtThresholds | None = None,
    y: Coordinate | AtThresholds | None = None,
    span: tuple[Coordinate, Coordinate] | None = None,
    label: str | Label | Mapping[str, Any] | None = None,
    data: Any = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    stroke_opacity: float | None = None,
    dash: Dash | None = None,
    contribute_domain: bool | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    legend: bool | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
    drag: bool | None = None,
) -> Chart:
    """Reference lines: horizontal at ``y`` or vertical at ``x``.

    A number or datetime draws one rule; a column name draws one rule per
    row. ``hg.Fraction``, ``hg.Pixels``, and ``hg.DataPosition`` place a
    rule by a share of the plot, by pixels, or by a value moved by an
    offset. ``span`` (two such places) runs it along part of the other
    axis. ``label`` is text, or an ``hg.Label``: a column of labels
    (``field``), placed at the rule's start, center, or end, or outside
    the plot beside the axis (``hg.LabelPlace``), in a style of its own.
    ``hg.AtThresholds("p99")`` draws a rule at each step of the thresholds
    the chart's ``fields`` give the column, each in its step's color
    unless ``stroke`` is given.
    Rules count toward the axes' domains only with
    ``contribute_domain=True``; otherwise they show where the data is.
    Without ``clip``, a rule at a value is left out while the value is out
    of the plot's view, and one at pixels or a share of the chart is drawn
    wherever it is; ``clip=False`` draws every rule, and ``"plot"`` or
    ``"chart"`` cuts them to the plot or chart.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    ``drag=True`` lets the pointer move a rule at a number or datetime
    along its axis: a widget's ``on_item_move`` hears where it goes, and
    the rule stays only where your code then puts it with
    ``widget.update_rule`` (it goes back otherwise). Rules of the rows
    of ``data`` move with their rows: ``drag`` is refused for them.
    """
    if (x is None) == (y is None):
        raise ChartError("rule: needs exactly one of x and y")
    self._check_label_dict(label, "rule", "label", ("content",))
    label_json = self._option("rule label", lambda: label_spec(label, "rule"))
    place = label_json.get("place") if isinstance(label_json, dict) else None
    if x is not None and isinstance(place, dict) and place.get("room") is not None:
        raise ChartError(
            "rule label place room: a vertical rule's labels stand above or below the plot, "
            "where no track is kept; drop room",
            path=self._path("rule", "label.place.room"),
        )
    if span is not None and (not isinstance(span, (tuple, list)) or len(span) != 2):
        raise ChartError(
            "rule span: expected two places, such as (hg.Fraction(0.25), 10); "
            f"received {shown(span)}"
        )
    places = {"x": x, "y": y, **({"span[0]": span[0], "span[1]": span[1]} if span else {})}
    table = self._annotation_table(data, places, label_json, "rule")
    at = "x" if isinstance(x, AtThresholds) else "y" if isinstance(y, AtThresholds) else None
    if at is not None and table is not None:
        raise ChartError(
            f"rule {at}: rules at thresholds stand for steps, not rows; "
            "give span and label no columns"
        )
    # Places at thresholds name their tables once the chart's are known (`_mark_specs`).
    place = {
        name: value if isinstance(value, AtThresholds) else coordinate_spec(value, f"rule {name}")
        for name, value in (("x", x), ("y", y))
    }
    if _flag(drag, "rule drag"):
        if table is not None:
            raise ChartError(
                "rule drag: rules over a table move with their rows; drag a rule of a value"
            )
        axis_name = "x" if x is not None else "y"
        if isinstance(place[axis_name], bool) or not isinstance(place[axis_name], (int, float)):
            raise ChartError(
                "rule drag: a dragged rule stands at a number or a date along its axis; "
                f"give {axis_name} one"
            )
    return self._add(
        {
            "type": "rule",
            **place,
            "span": (
                [tagged_spec(place, "rule span") for place in span] if span is not None else None
            ),
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "rule stroke_width"),
            "strokeOpacity": fraction_option(stroke_opacity, "rule stroke_opacity"),
            "dash": _dash(dash, "rule"),
            "label": label_json,
            "contributeDomain": _flag(contribute_domain, "rule contribute_domain"),
            "axis": axis,
            "facet": _mark_facet(facet, "rule"),
            "panel": panel,
            "clip": _clip(clip, "rule"),
            "legend": self._option("rule legend", lambda: _flag(legend, "rule legend")),
            "zIndex": z_index,
            "pick": pick,
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "rule"),
            "id": id,
            "drag": drag or None,
        },
        table,
    )


@_check_method_options
def region(
    self,  # type: Chart
    *,
    x: AtThresholds | None = None,
    y: AtThresholds | None = None,
    x1: Coordinate | None = None,
    x2: Coordinate | None = None,
    y1: Coordinate | None = None,
    y2: Coordinate | None = None,
    label: str | Label | Mapping[str, Any] | None = None,
    data: Any = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    stroke: str | None = None,
    stroke_width: float | None = None,
    stroke_sides: Sequence[Side] | None = None,
    encode: Encodings | Mapping[str, Any] | None = None,
    contribute_domain: bool | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    halo: HaloOption | None = None,
    legend: bool | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Shaded regions: from ``x1`` to ``x2``, from ``y1`` to ``y2``, or both.

    Numbers or datetimes shade one region; column names shade one per
    row; ``hg.Fraction``, ``hg.Pixels``, and ``hg.DataPosition`` place
    an edge as they do rules. ``y=hg.AtThresholds("p99")`` (or ``x``)
    shades a band from each step of the thresholds the chart's
    ``fields`` give the column to the next, the last to the plot's end
    and the base from its start where the thresholds give a base color,
    each in its step's color unless ``fill`` is given. ``label`` is text or an ``hg.Label``,
    along the ``side`` its place names (top by default), inside or
    outside the region. ``stroke`` and ``stroke_width`` outline each
    region (in its fill's color, 1 pixel wide, by default), and
    ``stroke_sides`` draws only the sides it lists; edges the plot cuts
    and the sides of a span across the whole plot are never drawn. Add
    regions before the marks they highlight to draw them underneath, or
    give ``z_index``. Regions of the rows of ``data`` take ``encode``:
    color, fill, stroke, and opacity per row, through the chart's
    ``scales`` (an ``hg.ChannelScale`` for numbers), drawn in row order;
    rows without an output keep the mark's own paint. Regions count
    toward the axes' domains only with ``contribute_domain=True``.
    Regions are cut to the plot; with ``clip="chart"`` or ``False``, to
    the chart, so a band at pixels of the chart above the plot shows.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    if x is not None and y is not None:
        raise ChartError("region: bands at thresholds go along x or along y; give one")
    for steps, start, end, name in ((x, x1, x2, "x"), (y, y1, y2, "y")):
        if steps is not None and not isinstance(steps, AtThresholds):
            raise ChartError(
                f"region {name}: places bands at a column's thresholds, such as "
                f'hg.AtThresholds("p99"); give {name}1 and {name}2 for a range'
            )
        if steps is not None and (start is not None or end is not None):
            raise ChartError(
                f"region: {name} places bands at thresholds, and {name}1 and {name}2 a range; "
                "give one"
            )
        if (start is None) != (end is None):
            missing = f"{name}1" if start is None else f"{name}2"
            raise ChartError(f"region {missing}: needs both {name}1 and {name}2, or neither")
    if x1 is None and y1 is None and x is None and y is None:
        raise ChartError("region: needs x1 and x2, y1 and y2, or both")
    # Outlines are checked here, as the engine checks a spec.
    if stroke is not None and not isinstance(stroke, str):
        raise ChartError(
            f"region stroke: expected a color; received {shown(stroke)}",
            path=self._path("region", "stroke"),
        )
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            f"region stroke_width: expected 0 or more pixels; received {shown(stroke_width)}",
            path=self._path("region", "stroke_width"),
        )
    self._check_label_dict(label, "region", "label", ("content",))
    label_json = self._option("region label", lambda: label_spec(label, "region"))
    table = self._annotation_table(
        data, {"x1": x1, "x2": x2, "y1": y1, "y2": y2}, label_json, "region"
    )
    along = "x" if x is not None else "y" if y is not None else None
    if along is not None and (table is not None or encode is not None):
        raise ChartError(
            f"region {along}: regions at thresholds stand for steps, not rows; "
            "give the other places and label no columns, and drop encode"
        )
    channels = self._option(
        "region encode", lambda: encodings_spec(encode, _REGION_CHANNELS, "region")
    )
    if channels:
        for name, given in channels.items():
            for at, channel in _entries(f"encode.{name}", given):
                if isinstance(channel, Mapping) and "series" in channel:
                    raise ChartError(
                        f"region {python_path(at)}: regions have no series whose names "
                        "it could read; give hg.Channel(field=...) or value=..., or "
                        "hg.when(...)",
                        path=self._path("region", python_path(at)),
                    )
        # Channels paint each row of the mark's data, or the chart's.
        if table is None and data is None and self._default is None:
            raise ChartError(
                "region encode: channels read the rows of a table; give data, or drop encode",
                path=self._path("region", "encode"),
            )
        if table is None:
            table = self._mark_table(data)
        self._check_colors(table, None, channels, "region")
    return self._add(
        {
            "type": "region",
            "halo": _halo(halo, "region"),
            # Named once the chart's tables are known (`_mark_specs`).
            "x": x,
            "y": y,
            "x1": coordinate_spec(x1, "region x1"),
            "x2": coordinate_spec(x2, "region x2"),
            "y1": coordinate_spec(y1, "region y1"),
            "y2": coordinate_spec(y2, "region y2"),
            "fill": fill,
            "fillOpacity": fraction_option(fill_opacity, "region fill_opacity"),
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "region stroke_width"),
            "strokeSides": self._option(
                "region stroke_sides", lambda: _sides(stroke_sides, "region stroke_sides")
            ),
            "encode": channels or None,
            "label": label_json,
            "contributeDomain": _flag(contribute_domain, "region contribute_domain"),
            "axis": axis,
            "facet": _mark_facet(facet, "region"),
            "panel": panel,
            "clip": _clip(clip, "region"),
            "legend": self._option("region legend", lambda: _flag(legend, "region legend")),
            "zIndex": z_index,
            "pick": pick,
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "region"),
            "id": id,
        },
        table,
    )


@_check_method_options
def text(
    self,  # type: Chart
    *,
    label: str | Label | Mapping[str, Any],
    x: Coordinate | None = None,
    y: Coordinate | None = None,
    at: Position | None = None,
    from_: MarkAnchor | ItemAnchor | Mapping[str, Any] | None = None,
    data: Any = None,
    contribute_domain: bool | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    halo: HaloOption | None = None,
    legend: bool | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    inspect: bool | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Text ``label`` at ``(x, y)``, or at ``at``, an ``hg.Position``.

    ``label`` is constant text, or an ``hg.Label``: a column of text
    (``field``), numbers written with ``format``, in an ``hg.TextStyle``
    of its own (font size, weight, color, halo, a box behind it, and
    ``align`` its start, center, or end at the point). Column names for
    ``x`` or ``y`` draw one label per row; ``hg.Fraction``,
    ``hg.Pixels``, and ``hg.DataPosition`` mix shares of the plot,
    pixels, and values moved by offsets. Labels that would cover another
    are drawn anyway (``hg.Label(overlap="show")``, the default), left
    out (``"hide"``), or, where their place is taken or outside the plot,
    tried around their point and left out when nothing fits (``"move"``),
    with a line back to it (``leader=True``); ``overlap_group`` keeps them
    apart from other marks' labels. Text ``from_`` another mark is placed
    with that panel's series labels, as ``hg.SeriesLabels`` are; text
    ``from_`` an ``hg.ItemAnchor`` is placed at a point of a layout
    mark's item (a treemap's cell), each row's item by its names. Without
    ``clip``, labels stay inside the chart (one reaching past its edge
    goes to the other side of its point, else moves in; one of a point
    outside the chart is drawn where told), text at a value is left out
    while the value is out of the plot's view, and text at pixels or a
    share of the chart (above the plot, say) is drawn wherever it is;
    ``clip=False`` draws all of it exactly where told, and ``"plot"`` or
    ``"chart"`` cuts it to the plot or chart.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    anchor: dict[str, Any] | None = None
    on_item = isinstance(from_, ItemAnchor) or (isinstance(from_, Mapping) and "item" in from_)
    if from_ is not None:
        if at is not None or x is not None or y is not None:
            raise ChartError(
                "text from_: a place on another mark, or at, or x and y; one of them",
                path=f"marks[{len(self._marks)}]",
            )
        if on_item:
            item: ItemAnchor = self._option(
                "text from_", lambda: _built(from_, ItemAnchor, "text from_")
            )
            from_ = item
            anchor = self._option("text from_", item._spec)
        else:
            self._check_label_dict(from_, "text", "from_", ("mark", "at", "edge"))
            anchor = self._option("text from_", lambda: built_spec(from_, MarkAnchor, "text from_"))
    if at is not None and (x is not None or y is not None):
        raise ChartError(
            "text at: a place, or its short forms x and y, not both; drop at or x and y"
        )
    if from_ is None and at is None and (x is None or y is None):
        raise ChartError("text: needs a place; give x and y, or at=hg.Position(x=..., y=...)")
    if at is not None:
        at = _built(at, Position, "text at")
    if label is None:
        raise ChartError("text label: needs text or an hg.Label; give label")
    self._check_label_dict(label, "text", "label", ("content",))
    following = from_ is not None and not on_item
    label_json = self._option(
        "text label", lambda: label_spec(label, "text", places=following, following=following)
    )
    if following:
        # Its labels go where they follow their series, and read the source mark's columns.
        place = label_json.get("place") if isinstance(label_json, dict) else None
        for option in ("attachment", "side"):
            if (place or {}).get(option) is not None:
                raise ChartError(
                    f"text label place: labels go at from_.at on their series; drop {option}"
                )
        if data is not None:
            raise ChartError(
                "text data: text following another mark reads that mark's columns; drop data"
            )
        assert anchor is not None
        self._check_following_fields(anchor["mark"], label_json)
        table = None
    else:
        places = (
            {"from_": from_}
            if on_item
            else {"x": at.x, "y": at.y}
            if at is not None
            else {"x": x, "y": y}
        )
        table = self._annotation_table(data, places, label_json, "text")
    return self._add(
        {
            "type": "text",
            "from": anchor,
            "halo": _halo(halo, "text"),
            "x": coordinate_spec(x, "text x"),
            "y": coordinate_spec(y, "text y"),
            "at": self._option("text at", at._spec) if at is not None else None,
            "label": label_json,
            "contributeDomain": _flag(contribute_domain, "text contribute_domain"),
            "axis": axis,
            "facet": _mark_facet(facet, "text"),
            "panel": panel,
            "clip": _clip(clip, "text"),
            "legend": self._option("text legend", lambda: _flag(legend, "text legend")),
            "zIndex": z_index,
            "pick": pick,
            "inspect": inspect,
            "itemKey": self._item_key(table, item_key, "text"),
            "id": id,
        },
        table,
    )


def _check_following_fields(
    self,  # type: Chart
    mark: str,
    label: Any,
) -> None:
    """Checks the columns a label of text following mark ``mark`` reads,
    which are that mark's, where it is declared already (the chart
    refuses text following a mark declared after it)."""
    table = self._source_table(mark)
    if table is None:
        return
    text = label.get("field") if isinstance(label, dict) else None
    # Written as content parts are: times too, in the chart's zone.
    self._require(table, text, _ANY, "text label field")
    for at, field in _part_fields(label):
        self._require(table, field, _ANY, f"text label.content{at}")


def _annotation_table(
    self,  # type: Chart
    data: Any,
    positions: dict[str, Any],
    label: Any,
    role: str,
) -> int | None:
    """The table an annotation reads, when a place or its label is a column."""
    fields = {
        name: field
        for name, value in positions.items()
        if (field := coordinate_field(value)) is not None
    }
    text = label.get("field") if isinstance(label, dict) else None
    # A label of parts reads the columns its parts name.
    parts = _part_fields(label)
    # Items' names read category columns (hg.col).
    names = [
        (f"{name}.item[{k}]", field)
        for name, value in positions.items()
        for k, field in enumerate(item_fields(value))
    ]
    if not fields and text is None and not parts and not names:
        if data is not None and not isinstance(data, (Derived, RowGroups, RowTotals, Matrix)):
            Table(data)  # data it reads nothing of is still a table
        return None
    table = self._mark_table(data)
    for name, field in fields.items():
        # Shares and pixels are numbers; places on a scale, numbers, times,
        # or categories, which go to their bands.
        value = positions[name]
        if isinstance(value, (Fraction, Pixels)):
            share = "fraction" if isinstance(value, Fraction) else "px"
            self._require(table, field, ("number",), f"{role} {name}.{share}.field")
        else:
            self._require(table, field, (*_NUMERIC, "category"), f"{role} {name}")
    for at, field in names:
        self._require(table, field, ("category",), f"{role} {at}")
    self._require(table, text, ("category", "number"), f"{role} label field")
    for at, part in parts:
        self._require(table, part, _ANY, f"{role} label.content{at}")
    return table
