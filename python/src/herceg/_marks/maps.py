"""Map marks: shapes and points of a projection."""

from __future__ import annotations

from collections.abc import Sequence
from typing import TYPE_CHECKING, Any, Literal

import numpy as np

from .. import _geo
from .._data import Column, Table
from .._encoding import fraction_option, pixels_option
from .._errors import ChartError, shown
from .common import (
    _check_method_options,
    _check_size,
    _colors,
    _finite,
    _mark_facet,
    _midpoint,
    _range,
)
from .tooltips import Tooltip

if TYPE_CHECKING:
    from .._chart import Chart, _Columns


@_check_method_options
def geoshape(
    self,  # type: Chart
    geometry: str | None = None,
    *,
    data: Any = None,
    label_field: str | None = None,
    color: str | None = None,
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
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    tooltip: Tooltip | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Regions of a map: each row's shape, filled by ``color``, a numeric column
    on a continuous scale (a choropleth) or a category column with a color per
    value, whose legend grays its regions out.

    The data holds the shapes in its ``geometry`` column (by default the one
    named "geometry", or a GeoDataFrame's): a GeoDataFrame, a GeoJSON
    FeatureCollection (its properties become columns), or any table whose
    column holds GeoJSON geometries or objects with ``__geo_interface__``.
    Shapes are polygons and multipolygons in longitude and latitude.

    Or, as in Plotly, the values come from ``data`` and the shapes from
    ``geojson``: each row's ``locations`` value names its feature by
    ``feature_id_key`` (``"id"`` or ``"properties.<name>"``; Plotly's
    ``featureidkey``), compared as text.
    Every feature is drawn; those no row names have no value.
    ``label_field`` names a category column labeling regions in tooltips,
    keyboard reading, and the summary.
    Geoshape and geopoint marks share a chart, projected by its
    ``projection``: with facets, every layer splits its rows by the facet
    column unless ``facet="repeat"`` draws it whole in each panel (a base
    map); with panels, the layers naming a ``panel`` are its map.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    self._map_place("geoshape")
    if geojson is not None:
        if locations is None:
            raise ChartError(
                "geoshape geojson: needs locations, the column naming each row's feature"
            )
        values = self._mark_table(data)
        # Layers joining the same rows to the same features share their table.
        same = next(
            (
                index
                for index, join in self._joins.items()
                if join.made_from(self._tables[values][0], geojson, locations, feature_id_key)
            ),
            None,
        )
        if same is None:
            joined = _JoinedShapes(self, values, geojson, locations, feature_id_key)
            table = self._table(joined, joined.table)
            self._joins[table] = joined
        else:
            table = same
    else:
        if locations is not None:
            raise ChartError("geoshape locations: needs geojson, the shapes the rows name")
        table = self._mark_table(data)
    if geometry is None:
        geometry = _geometry_column(self._tables[table][0], self._tables[table][1])
    self._require(table, geometry, ("geometry",), "geoshape geometry")
    self._require(table, label_field, ("category",), "geoshape label_field")
    self._require(table, color, ("number", "category"), "geoshape color")
    self._check_category_color(table, color, colors, color_domain, color_midpoint, "geoshape")
    ramp = next(
        (
            name
            for name, value in (
                ("colors", colors),
                ("color_domain", color_domain),
                ("color_midpoint", color_midpoint),
            )
            if value is not None
        ),
        None,
    )
    if color is None and ramp is not None:
        raise ChartError(f"geoshape {ramp}: colors by a numeric color column; give color")
    if fill_opacity is not None and not (_finite(fill_opacity) and 0 <= fill_opacity <= 1):
        raise ChartError(
            f"geoshape fill_opacity: expected a number from 0 to 1; received {shown(fill_opacity)}"
        )
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            f"geoshape stroke_width: expected 0 or more pixels; received {shown(stroke_width)}"
        )
    return self._add(
        {
            "type": "geoshape",
            "geometry": geometry,
            "labelField": label_field,
            "color": color,
            "colors": _colors(colors, "geoshape colors"),
            "colorDomain": _range(color_domain, "geoshape color_domain"),
            "colorMidpoint": _midpoint(color_midpoint, color_domain, "geoshape"),
            "fill": fill,
            "fillOpacity": fraction_option(fill_opacity, "geoshape fill_opacity"),
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "geoshape stroke_width"),
            "label": label,
            "facet": _mark_facet(facet, "geoshape"),
            "panel": panel,
            "tooltip": self._mark_tooltip(table, tooltip, "geoshape"),
            "itemKey": self._item_key(table, item_key, "geoshape"),
            "id": id,
        },
        table,
    )


@_check_method_options
def geopoint(
    self,  # type: Chart
    longitude: str,
    latitude: str,
    *,
    data: Any = None,
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
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    tooltip: Tooltip | None = None,
    item_key: str | None = None,
    id: str | None = None,
) -> Chart:
    """Points of a map at ``longitude`` and ``latitude`` columns (degrees):
    places of one ``radius`` in pixels, or bubbles sized by area by a
    numeric ``size`` column within ``radius_range``.

    ``series`` gives a color and legend entry per category, ``color`` colors
    points by a numeric column (or a category column, which names the
    series too unless ``series`` is given or ``False``, as
    ``Chart.point``'s), or is a CSS color for every point (``fill`` wins
    over it). Points are drawn largest first, each ringed in the
    background color (``stroke``, ``stroke_width``). For a
    GeoDataFrame of points, add the columns first:
    ``gdf.assign(lon=gdf.geometry.x, lat=gdf.geometry.y)``. Layers share a
    map as ``Chart.geoshape`` says, also in facets and panels.
    ``item_key`` names a numeric, datetime, or category column whose value
    names each row's item, which selections and transitions follow across
    replaced data.
    """
    self._map_place("geopoint")
    table = self._mark_table(data)
    self._require(table, longitude, ("number",), "geopoint longitude")
    self._require(table, latitude, ("number",), "geopoint latitude")
    self._require(table, label_field, ("category",), "geopoint label_field")
    # A category color names the series, as on points along axes; series=False keeps one.
    split = self._series_of(table, series, color, None, fill, "fill", "geopoint")
    if (
        color is not None
        and fill is None
        and self._kind(table, color) == "category"
        and split != color
    ):
        raise ChartError(
            f"geopoint color: {color!r} holds categories, which color "
            "map points by series; leave series out "
            f"(or give series={color!r}), or color by a numeric column",
            path=self._path("geopoint", "color"),
        )
    _check_size(radius, size, "geopoint")
    self._require(table, size, ("number",), "geopoint size")
    self._check_point_color(
        table,
        color,
        fill,
        colors,
        color_domain,
        color_midpoint,
        "geopoint",
        ("number",),
        f"give fill={color!r} for the color, or rename the column",
    )
    if fill_opacity is not None and not (_finite(fill_opacity) and 0 <= fill_opacity <= 1):
        raise ChartError(
            f"geopoint fill_opacity: expected a number from 0 to 1; received {shown(fill_opacity)}"
        )
    if stroke_width is not None and not (_finite(stroke_width) and stroke_width >= 0):
        raise ChartError(
            f"geopoint stroke_width: expected 0 or more pixels; received {shown(stroke_width)}"
        )
    return self._add(
        {
            "type": "geopoint",
            "longitude": longitude,
            "latitude": latitude,
            "labelField": label_field,
            "series": series,
            "radius": radius,
            "size": size,
            "radiusRange": _range(radius_range, "geopoint radius_range", minimum=0),
            "color": color,
            "colors": _colors(colors, "geopoint colors"),
            "colorDomain": _range(color_domain, "geopoint color_domain"),
            "colorMidpoint": _midpoint(color_midpoint, color_domain, "geopoint"),
            "fill": fill,
            "fillOpacity": fraction_option(fill_opacity, "geopoint fill_opacity"),
            "stroke": stroke,
            "strokeWidth": pixels_option(stroke_width, "geopoint stroke_width"),
            "label": label,
            "facet": _mark_facet(facet, "geopoint"),
            "panel": panel,
            "tooltip": self._mark_tooltip(table, tooltip, "geopoint"),
            "itemKey": self._item_key(table, item_key, "geopoint"),
            "id": id,
        },
        table,
    )


def _geometry_column(source: Any, columns: Any) -> str:
    """The column of shapes when a geoshape names none: "geometry", or a GeoDataFrame's."""
    active = getattr(source, "_geometry_column_name", None)
    for name in ("geometry", active):
        if name is not None and name in columns.names:
            return name
    raise ChartError(
        'geoshape geometry: the data has no "geometry" column; name the column holding the shapes'
    )


class _JoinedShapes:
    """A GeoJSON collection's features, with the values of the rows naming them,
    as Plotly's ``locations`` and ``featureidkey`` join them: a row per feature,
    with missing values where no row names it. Live charts join new rows the
    same way (``rejoin``)."""

    def __init__(self, chart: Chart, table: int, geojson: Any, locations: str, key: str) -> None:
        if table in chart._derived:
            raise ChartError(
                "geoshape data: joins the rows of a table to the shapes, and a derived table's "
                "rows are computed in the browser; join before deriving"
            )
        interface = getattr(geojson, "__geo_interface__", geojson)
        if not _geo.is_feature_collection(interface):
            raise ChartError(
                "geoshape geojson: expected a GeoJSON FeatureCollection; "
                f"received {type(geojson).__name__}"
            )
        _geo.check_crs(geojson)
        chart._require(table, locations, ("category", "number"), "geoshape locations")
        self.source = chart._tables[table][0]
        self._geojson = geojson
        self._locations = locations
        self._key = key
        self._keys = [_geo.key_text(_geo.feature_key(f, key)) for f in interface["features"]]
        self._shapes = Table(interface)
        self.table = self.rejoin(chart._tables[table][1])

    def made_from(self, source: Any, geojson: Any, locations: str, key: str) -> bool:
        """Whether this join is of the same rows and features, by the same keys."""
        return (
            self.source is source
            and self._geojson is geojson
            and (self._locations, self._key) == (locations, key)
        )

    def rejoin(self, source: _Columns) -> _Joined:
        """The features joined with the rows of `source`."""
        if self._locations not in source.names:
            raise ChartError(
                f"geoshape locations: the rows have no column {self._locations!r}",
                code="unknown-field",
            )
        located = source.column(self._locations)
        if located.kind not in ("category", "number"):
            raise ChartError(
                f"geoshape locations: column {self._locations!r} holds {located.kind} values; "
                "expected category or number"
            )
        values = (
            [None if code < 0 else located.dictionary[code] for code in located.values]
            if located.kind == "category"
            else located.values.tolist()
        )
        row_of: dict[str, int] = {}
        for row, value in enumerate(values):
            text = _geo.key_text(value)
            if text is None:
                continue
            if text in row_of:
                raise ChartError(
                    f"geoshape locations: {shown(text)} names a feature twice; "
                    "aggregate the rows to one per feature"
                )
            row_of[text] = row
        keys = self._keys
        rows = np.array([-1 if k is None else row_of.get(k, -1) for k in keys], dtype=np.intp)
        if values and not (rows >= 0).any():
            raise ChartError(
                f"geoshape locations: no value of {self._locations!r} matches a feature's "
                f"{self._key} (features: {keys[:3]!r}; rows: "
                f"{[_geo.key_text(v) for v in values[:3]]!r}); check feature_id_key"
            )
        if "geometry" in source.names:
            raise ChartError(
                'geoshape data: has a column named "geometry", as the joined shapes are; rename it'
            )
        return _Joined(source, rows, self._shapes)


class _Joined:
    """The joined rows' columns, converted when a mark first reads them: the
    data's taken at each feature's row, then the features' own."""

    def __init__(self, source: _Columns, rows: np.ndarray, shapes: Table) -> None:
        self._source = source
        self._rows = rows
        self._shapes = shapes
        self.names = (*source.names, *(n for n in shapes.names if n not in source.names))
        self._columns: dict[str, Column] = {}

    def column(self, name: str) -> Column:
        column = self._columns.get(name)
        if column is None:
            if name in self._source.names:
                column = _take(self._source.column(name), self._rows)
            else:
                column = self._shapes.column(name)
            self._columns[name] = column
        return column


def _take(column: Column, rows: np.ndarray) -> Column:
    """A column's values at `rows`, missing where a row is -1."""
    missing = rows < 0
    picked = (
        column.values[np.where(missing, 0, rows)]
        if len(column.values)
        else np.zeros(len(rows), dtype=column.values.dtype)
    )
    if column.kind in ("category", "geometry"):
        values = np.where(missing, -1, picked).astype("<i4")
        return Column(column.kind, values, column.dictionary, column.shapes)
    return Column(column.kind, np.where(missing, np.nan, picked).astype(column.values.dtype))
