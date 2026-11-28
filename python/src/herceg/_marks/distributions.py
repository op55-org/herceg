"""Distribution marks: histograms, box plots, boxen plots, and violins."""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal, TypedDict

from .._derive import BinSpec, bin_spec
from .._encoding import LabelPart, fraction_option, name_spec
from .._errors import ChartError, is_integer, is_number, keys_shown, shown
from .._style import Look, look_spec
from .common import (
    _NUMERIC,
    Clip,
    _check_method_options,
    _clip,
    _colors,
    _flag,
    _mark_facet,
    _mark_legend,
    _midpoint,
    _range,
)

if TYPE_CHECKING:
    from .._chart import Chart


HistogramNormalize = Literal["count", "frequency", "probability", "percent", "density"]
HistogramElement = Literal["bars", "step", "poly"]


class BinsByAxis(TypedDict, total=False):
    """A 2D histogram's bins along each axis (each left out takes the default)."""

    x: BinSpec | None
    y: BinSpec | None


@_check_method_options
def histogram(
    self,  # type: Chart
    x: str | None = None,
    *,
    y: str | None = None,
    bins: BinSpec | BinsByAxis | None = None,
    series: str | None = None,
    color: str | None = None,
    weight: str | None = None,
    normalize: HistogramNormalize | None = None,
    common_norm: bool = False,
    cumulative: bool = False,
    dodge: bool = False,
    stack: bool | Literal["fill"] = False,
    element: HistogramElement | None = None,
    data: Any = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    colors: str | Sequence[str] | None = None,
    color_domain: tuple[float, float] | None = None,
    color_midpoint: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
) -> Chart:
    """Counts of a number or time field in bins: of ``x`` (vertical bars) or
    of ``y`` (horizontal bars), or of both, a 2D histogram's cells.

    Bins are an approximate count, a step/start dict, or exact increasing
    edges; a 2D histogram takes those for both axes, or a dict of them
    for each, ``{"x": ..., "y": ...}``. Each row counts as 1, or as its
    ``weight`` (a number column; rows missing a weight, or with a
    negative one, are not counted). ``normalize`` measures each series'
    bins: counts, ``"frequency"`` (counts per unit of the binned axis,
    or of bin area in 2D), or ``"probability"``, ``"percent"``, and
    ``"density"`` of its counts; common_norm weights its share of finite
    values in the panel (including hidden series and values outside
    bins). Cumulative density integrates widths. Stack stacks series,
    and ``stack="fill"`` as shares of each bin; dodge places visible
    series side by side and excludes stack. ``element="step"`` draws
    each series as an area stepping across its bins, and ``"poly"`` as
    one through their centers.

    A 2D histogram counts the rows whose ``x`` and ``y`` both fall in a
    bin of each, colored by ``colors`` (a scheme name or hex colors)
    from 0 to the fullest cell, or over ``color_domain``; cells holding
    nothing are left empty. It takes no series (facet instead), stacks,
    dodges, cumulative counts, or elements.
    """
    if x is None and y is None:
        raise ChartError("histogram: needs x, y, or both")
    if normalize not in (None, "count", "frequency", "probability", "percent", "density"):
        raise ChartError(
            'histogram normalize: expected "count", "frequency", "probability", "percent", '
            f'or "density"; received {shown(normalize)}'
        )
    table = self._mark_table(data)
    self._require(table, weight, ("number",), "histogram weight")
    if x is not None and y is not None:
        bars = {
            "series": series,
            "color": color,
            "common_norm": common_norm or None,
            "cumulative": cumulative or None,
            "dodge": _flag(dodge, "histogram dodge") or None,
            "stack": stack or None,
            "element": element,
            "fill": fill,
            "fill_opacity": fill_opacity,
        }
        given = next((name for name, value in bars.items() if value is not None), None)
        if label is not None and not isinstance(label, str):
            raise ChartError(
                "histogram label: a 2D histogram's label titles its colorbar; give text"
            )
        if given == "series":
            raise ChartError(
                "histogram series: a 2D histogram of x and y counts one distribution; "
                "facet by the column instead"
            )
        if given is not None:
            raise ChartError(
                f"histogram {given}: for bars of x or y; a 2D histogram of both takes none, "
                "so drop it"
            )
        if axis == "right":
            raise ChartError(
                'histogram axis: a 2D histogram places cells, on no right axis; drop axis="right"'
            )
        self._require(table, x, _NUMERIC, "histogram x")
        self._require(table, y, _NUMERIC, "histogram y")
        return self._add(
            {
                "type": "histogram",
                "x": x,
                "y": y,
                "bins": _bins_2d(bins),
                "weight": weight,
                "normalize": normalize,
                "colors": _colors(colors, "histogram colors"),
                "colorDomain": _range(color_domain, "histogram color_domain"),
                "colorMidpoint": _midpoint(color_midpoint, color_domain, "histogram"),
                "label": label,
                "legend": _mark_legend(legend, "histogram"),
                "facet": _mark_facet(facet, "histogram"),
                "panel": panel,
                "clip": _clip(clip, "histogram"),
                "zIndex": z_index,
                "pick": pick,
                "selected": look_spec(selected, "histogram selected"),
                "unselected": look_spec(unselected, "histogram unselected"),
                "partial": look_spec(partial, "histogram partial"),
                "inspect": inspect,
                "id": id,
            },
            table,
        )
    cells = next(
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
    if cells is not None:
        raise ChartError(
            f"histogram {cells}: colors the cells of 2D histograms of x and y; bars take fill"
        )
    if y is not None and axis == "right":
        raise ChartError(
            'histogram axis: a horizontal histogram (y) has no right axis; drop axis="right"'
        )
    for name, flag in (
        ("common_norm", common_norm),
        ("cumulative", cumulative),
        ("dodge", dodge),
    ):
        if not isinstance(flag, bool):
            raise ChartError(f"histogram {name}: expected True or False; received {shown(flag)}")
    if not isinstance(stack, bool) and stack != "fill":
        raise ChartError(
            f'histogram stack: expected True, False, or "fill"; received {shown(stack)}'
        )
    if dodge and stack:
        raise ChartError("histogram dodge: dodge or stack, not both; drop one")
    if element not in (None, "bars", "step", "poly"):
        raise ChartError(
            f'histogram element: expected "bars", "step", or "poly"; received {shown(element)}'
        )
    if dodge and element not in (None, "bars"):
        raise ChartError(
            "histogram dodge: places bars side by side in each bin; drop dodge, or draw "
            'element="bars"'
        )
    if isinstance(bins, Mapping) and ("x" in bins or "y" in bins):
        raise ChartError(
            'histogram bins: {"x": ..., "y": ...} bins both axes of a 2D histogram; '
            f"give one bin definition for {'x' if x is not None else 'y'}"
        )
    spec_bins = None if bins is None else bin_spec(bins, "histogram bins")
    self._require(
        table,
        y if y is not None else x,
        _NUMERIC,
        "histogram y" if y is not None else "histogram x",
    )
    self._require(table, series, ("category",), "histogram series")
    self._color_series(table, series, color, "histogram")
    return self._add(
        {
            "type": "histogram",
            "x": x,
            "y": y,
            "bins": spec_bins,
            "series": series,
            "color": color,
            "weight": weight,
            "normalize": normalize,
            "commonNorm": common_norm or None,
            "cumulative": cumulative or None,
            "dodge": _flag(dodge, "histogram dodge") or None,
            "stack": stack or None,
            "element": element,
            "fill": fill,
            "fillOpacity": fraction_option(fill_opacity, "histogram fill_opacity"),
            "label": name_spec(label, "histogram"),
            "legend": _mark_legend(legend, "histogram"),
            "axis": axis,
            "facet": _mark_facet(facet, "histogram"),
            "panel": panel,
            "clip": _clip(clip, "histogram"),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "histogram selected"),
            "unselected": look_spec(unselected, "histogram unselected"),
            "partial": look_spec(partial, "histogram partial"),
            "inspect": inspect,
            "id": id,
        },
        table,
    )


@_check_method_options
def boxplot(
    self,  # type: Chart
    x: str | None = None,
    y: str | None = None,
    *,
    data: Any = None,
    low: str | None = None,
    q1: str | None = None,
    median: str | None = None,
    q3: str | None = None,
    high: str | None = None,
    count: str | None = None,
    whiskers: Literal["tukey", "range"] | float | None = None,
    notch: bool | None = None,
    outliers: bool | None = None,
    series: str | None = None,
    color: str | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
) -> Chart:
    """Box plots of a number column's values per category.

    One of ``x`` and ``y`` is a category column, the other the values:
    a category ``y`` lays the boxes along the y axis. Boxes span the
    quartiles with a line at the median; whiskers reach the most extreme
    values within 1.5 interquartile ranges, and values beyond are dots.
    ``series`` puts a box per value of a category column side by side;
    ``color`` names that column too, or gives every box one color, as
    ``fill`` does.
    Instead of raw values, name ``low``, ``q1``, ``median``, ``q3``, and
    ``high`` columns with just a category ``x`` or ``y``: one box per row,
    no outliers. ``count`` is optional unless ``notch=True``. Notches
    extend 1.57 IQR / sqrt(count) from the median, without clamping.
    Raw ``whiskers`` are "tukey" (default), "range", or a nonnegative
    IQR multiple; precomputed boxes already give their whisker ends.
    ``outliers=False`` draws no dots beyond the whiskers (tooltips still
    count them), and leaves them out of the value axis' extent.
    """
    statistics = {"low": low, "q1": q1, "median": median, "q3": q3, "high": high}
    precomputed = any(value is not None for value in statistics.values()) or count is not None
    if precomputed:
        if x is not None and y is not None:
            raise ChartError(
                "boxplot: raw x and y values or precomputed statistics "
                "(low, q1, median, q3, high, count), not both; drop one"
            )
        if x is None and y is None:
            raise ChartError("boxplot: precomputed boxes need a category x or y")
        missing = [name for name, value in statistics.items() if value is None]
        if missing:
            raise ChartError(
                f"boxplot {missing[0]}: precomputed boxes need low, q1, median, q3, and high; "
                f"give {', '.join(missing)}"
            )
        if whiskers is not None:
            raise ChartError(
                "boxplot whiskers: low and high already give precomputed boxes their "
                "whisker ends; drop whiskers"
            )
        if notch and count is None:
            raise ChartError("boxplot notch: precomputed boxes need count to notch; give count")
        if outliers is not None:
            raise ChartError("boxplot outliers: precomputed boxes have none to draw; drop outliers")
    elif x is None or y is None:
        raise ChartError(f"boxplot {'x' if x is None else 'y'}: raw values need both x and y")
    if (
        whiskers is not None
        and whiskers not in ("tukey", "range")
        and not (
            is_number(whiskers)
            and not isinstance(whiskers, bool)
            and math.isfinite(whiskers)
            and whiskers >= 0
        )
    ):
        raise ChartError(
            'boxplot whiskers: expected "tukey", "range", or a finite nonnegative IQR '
            f"multiple; received {shown(whiskers)}"
        )
    if is_number(whiskers):
        whiskers = float(whiskers)
    if notch is not None and not isinstance(notch, bool):
        raise ChartError(f"boxplot notch: expected True or False; received {shown(notch)}")
    if outliers is not None and not isinstance(outliers, bool):
        raise ChartError(f"boxplot outliers: expected True or False; received {shown(outliers)}")
    return self._distribution(
        {
            "type": "boxplot",
            "color": color,
            "fill": fill,
            **statistics,
            "count": count,
            "whiskers": whiskers,
            "notch": notch,
            "outliers": outliers,
            "legend": _mark_legend(legend, "boxplot"),
            "clip": _clip(clip, "boxplot"),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "boxplot selected"),
            "unselected": look_spec(unselected, "boxplot unselected"),
            "partial": look_spec(partial, "boxplot partial"),
            "inspect": inspect,
        },
        x,
        y,
        data,
        series,
        fill_opacity,
        label,
        axis,
        facet,
        panel,
        id,
    )


@_check_method_options
def boxen(
    self,  # type: Chart
    x: str,
    y: str,
    *,
    data: Any = None,
    series: str | None = None,
    color: str | None = None,
    depth: Literal["tukey", "proportion", "trustworthy", "full"] | int | None = None,
    outlier_proportion: float | None = None,
    trust_alpha: float | None = None,
    width_method: Literal["exponential", "linear", "area"] | None = None,
    outliers: bool | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
) -> Chart:
    """Letter-value ("boxen") plots of a number column's values per category.

    One of ``x`` and ``y`` is a category column, the other the values:
    a category ``y`` lays the boxes along the y axis. Each group draws
    nested boxes between its letter values, its quartiles, eighths,
    sixteenths, ... out from the median, each level narrower and lighter
    than the one inside it, and dots at the values beyond the outermost
    boxes unless ``outliers=False``. ``depth`` chooses the levels:
    "tukey" (the default) leaves 5 to 8 values in each tail,
    "proportion" about ``outlier_proportion`` (0.007) of them,
    "trustworthy" stops where a letter value's confidence interval at
    ``trust_alpha`` (0.05) would overlap the next, "full" reaches every
    value, or a whole number gives the levels (1 is the quartile box).
    ``width_method`` narrows each level by half ("exponential", the
    default), by equal steps ("linear"), or to its share of the values
    over its height ("area"). ``series`` puts a group per value of a
    category column side by side (``color`` names it too); ``fill`` gives
    every box one color.
    """
    if depth is not None and depth not in ("tukey", "proportion", "trustworthy", "full"):
        if not (is_integer(depth) and not isinstance(depth, bool) and depth >= 1):
            raise ChartError(
                'boxen depth: expected "tukey", "proportion", "trustworthy", "full", or a '
                f"whole number of levels from 1; received {shown(depth)}"
            )
        depth = int(depth)
    for name, value in (
        ("outlier_proportion", outlier_proportion),
        ("trust_alpha", trust_alpha),
    ):
        if value is not None and not (
            is_number(value) and not isinstance(value, bool) and 0 < value < 1
        ):
            raise ChartError(
                f"boxen {name}: expected a number between 0 and 1; received {shown(value)}"
            )
    if width_method is not None and width_method not in ("exponential", "linear", "area"):
        raise ChartError(
            'boxen width_method: expected "exponential", "linear", or "area"; '
            f"received {shown(width_method)}"
        )
    if outliers is not None and not isinstance(outliers, bool):
        raise ChartError(f"boxen outliers: expected True or False; received {shown(outliers)}")
    return self._distribution(
        {
            "type": "boxen",
            "color": color,
            "fill": fill,
            "depth": depth,
            "outlierProportion": outlier_proportion,
            "trustAlpha": trust_alpha,
            "widthMethod": width_method,
            "outliers": outliers,
            "legend": _mark_legend(legend, "boxen"),
            "clip": _clip(clip, "boxen"),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "boxen selected"),
            "unselected": look_spec(unselected, "boxen unselected"),
            "partial": look_spec(partial, "boxen partial"),
            "inspect": inspect,
        },
        x,
        y,
        data,
        series,
        fill_opacity,
        label,
        axis,
        facet,
        panel,
        id,
    )


@_check_method_options
def violin(
    self,  # type: Chart
    x: str,
    y: str,
    *,
    data: Any = None,
    series: str | None = None,
    color: str | None = None,
    bandwidth: float | None = None,
    split: bool | None = None,
    inner: Literal["box", "quartiles", "none"] | None = None,
    fill: str | None = None,
    fill_opacity: float | None = None,
    label: str | Sequence[str | LabelPart] | None = None,
    legend: Literal[False] | None = None,
    axis: Literal["left", "right"] | None = None,
    facet: Literal["repeat"] | None = None,
    panel: str | None = None,
    clip: Clip | None = None,
    z_index: float | None = None,
    pick: bool | None = None,
    selected: Look | Mapping[str, Any] | None = None,
    unselected: Look | Mapping[str, Any] | None = None,
    partial: Look | Mapping[str, Any] | None = None,
    inspect: bool | None = None,
    id: str | None = None,
) -> Chart:
    """Violins of a number column's values per category.

    One of ``x`` and ``y`` is a category column, the other the values:
    a category ``y`` lays the violins along the y axis. Each violin is
    its values' Gaussian kernel density mirrored about its center,
    reaching two bandwidths past the extreme values, with the quartiles
    as a narrow box and the median as a dot inside. Every violin is as
    wide at its densest. ``bandwidth`` sets the kernel's standard
    deviation in data units for every violin; by default each has its
    own by Silverman's rule of thumb. ``series`` puts a violin per value
    of a category column side by side (``color`` names it too). ``fill`` gives every violin one
    color instead of the palette's. ``split=True`` shares the category
    center between two series (first left, or below horizontally); a
    missing partner leaves its half empty. ``inner`` selects the default
    "box", dashed "quartiles" with a solid median, or "none".
    """
    if bandwidth is not None and not (
        is_number(bandwidth)
        and not isinstance(bandwidth, bool)
        and math.isfinite(bandwidth)
        and bandwidth > 0
    ):
        raise ChartError(
            f"violin bandwidth: expected a positive number; received {shown(bandwidth)}"
        )
    if split is not None and not isinstance(split, bool):
        raise ChartError(f"violin split: expected True or False; received {shown(split)}")
    if inner is not None and inner not in ("box", "quartiles", "none"):
        raise ChartError(
            f'violin inner: expected "box", "quartiles", or "none"; received {shown(inner)}'
        )
    return self._distribution(
        {
            "type": "violin",
            "color": color,
            "bandwidth": bandwidth,
            "fill": fill,
            "split": split,
            "inner": inner,
            "legend": _mark_legend(legend, "violin"),
            "clip": _clip(clip, "violin"),
            "zIndex": z_index,
            "pick": pick,
            "selected": look_spec(selected, "violin selected"),
            "unselected": look_spec(unselected, "violin unselected"),
            "partial": look_spec(partial, "violin partial"),
            "inspect": inspect,
        },
        x,
        y,
        data,
        series,
        fill_opacity,
        label,
        axis,
        facet,
        panel,
        id,
    )


def _distribution(
    self,  # type: Chart
    spec: dict[str, Any],
    x: str | None,
    y: str | None,
    data: Any,
    series: str | None,
    fill_opacity: float | None,
    label: str | Sequence[str | LabelPart] | None,
    axis: Literal["left", "right"] | None,
    facet: Literal["repeat"] | None,
    panel: str | None,
    id: str | None,
) -> Chart:
    """Adds a box plot, boxen, or violin mark: a category column on one
    axis, values on the other."""
    kind = spec["type"]
    table = self._mark_table(data)
    precomputed = spec.get("median") is not None
    if precomputed:
        horizontal = x is None
    else:
        assert x is not None and y is not None
        horizontal = self._kind(table, y) == "category" and self._kind(table, x) != "category"
    category, values = (y, x) if horizontal else (x, y)
    self._require(table, category, ("category",), f"{kind} {'y' if horizontal else 'x'}")
    if precomputed:
        for name in ("low", "q1", "median", "q3", "high"):
            self._require(table, spec[name], _NUMERIC, f"boxplot {name}")
        self._require(table, spec.get("count"), ("number",), "boxplot count")
    else:
        self._require(table, values, _NUMERIC, f"{kind} {'x' if horizontal else 'y'}")
    self._require(table, series, ("category",), f"{kind} series")
    split = self._color_series(table, series, spec.get("color"), kind)
    if spec.get("split") and split is None:
        raise ChartError("violin split: halves each category between two series; give series")
    if horizontal and axis == "right":
        noun = {"boxplot": "box plots", "boxen": "boxen plots", "violin": "violins"}[kind]
        raise ChartError(f'{kind} axis: horizontal {noun} have no right axis; drop axis="right"')
    if fill_opacity is not None and not (
        is_number(fill_opacity) and not isinstance(fill_opacity, bool) and 0 <= fill_opacity <= 1
    ):
        raise ChartError(
            f"{kind} fill_opacity: expected a number from 0 to 1; received {shown(fill_opacity)}"
        )
    return self._add(
        {
            "type": kind,
            "x": x,
            "y": y,
            "series": series,
            **{key: value for key, value in spec.items() if key != "type"},
            "fillOpacity": fraction_option(fill_opacity, f"{kind} fill_opacity"),
            "label": name_spec(label, kind),
            "axis": axis,
            "facet": _mark_facet(facet, kind),
            "panel": panel,
            "id": id,
        },
        table,
    )


def _bins_2d(bins: Any) -> Any:
    """A 2D histogram's bins: one definition for both axes, or ``{"x": ..., "y": ...}``."""
    if bins is None:
        return None
    if isinstance(bins, Mapping) and "step" not in bins:
        unknown = set(bins) - {"x", "y"}
        if unknown:
            raise ChartError(
                "histogram bins: a 2D histogram's bins are one definition or "
                f'{{"x": ..., "y": ...}}; received {keys_shown(unknown)}'
            )
        # Axes left out take their default bins; with neither, so do both.
        each = {
            axis: bin_spec(bins[axis], f"histogram bins[{axis!r}]")
            for axis in ("x", "y")
            if bins.get(axis) is not None
        }
        return each or None
    return bin_spec(bins, "histogram bins")
