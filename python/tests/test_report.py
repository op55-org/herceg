"""The report acceptance fixture: a weekly PDF report a matplotlib user moved
to herceg, rebuilt from their two rounds of feedback.

The report has twelve figures, exported as 150 dpi JPEGs at 8 by 5 inches
in a brand font with CFF outlines and a fallback font, and as PDF in
TrueType fonts. The data is a deterministic reconstruction, not the user's:
each figure is small and diagnostic, and its checks read the exported SVG's
geometry (plot clips, swatches, paths, tick labels) against facts computed
here from the data, independently of the chart. Raster checks cover what
structure cannot (glyph fallback, painted markers), and the same charts in
SVG, PNG, and PDF are compared drawn."""

from __future__ import annotations

import functools
import io
import re
import xml.etree.ElementTree as ET
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

import herceg as hg

pytest.importorskip("py_mini_racer")
Image = pytest.importorskip("PIL.Image")

ROOT = Path(__file__).resolve().parents[2]
FONTS = ROOT / "packages/herceg/test/fixtures/pdf-fonts"
# The brand face has CFF outlines; Symbols covers the star no brand glyph does.
BRAND = {"Brand": FONTS / "sans-cff.otf", "Symbols": FONTS / "symbols.ttf"}
# PDF embeds TrueType outlines: the same faces as glyf.
TRUETYPE = {"Brand": FONTS / "sans.ttf", "Symbols": FONTS / "symbols.ttf"}
THEME = hg.Theme(style=hg.Style(text=hg.TextStyle(font="Brand, Symbols")))

SITES = ["Site A", "Site B", "Site C"]
COLORS = {"Site A": "#00ab41", "Site B": "#0073ff", "Site C": "#f88c3b"}
DAYS = 7


def _hourly() -> pd.DataFrame:
    """A week of hourly readings per site, in time order: efficiency swings
    daily around a mean that rises by site, under a limit of its own."""
    hours = pd.date_range("2026-09-28", periods=DAYS * 24, freq="h")
    phase = np.arange(len(hours)) / 24 * 2 * np.pi
    frames = [
        pd.DataFrame(
            {
                "t": hours,
                "site": site,
                "efficiency": np.round(70 + 3 * i + 8 * np.sin(phase + i), 1),
                "limit": 68.0 + 2 * i,
                "temp": np.round(18 + 6 * np.sin(phase - 1), 1),
                "humidity": np.round(55 + 10 * np.cos(phase), 1),
                "kwh": np.round(40 + 10 * np.cos(phase / DAYS + i), 1),
            }
        )
        for i, site in enumerate(SITES)
    ]
    data = pd.concat(frames).sort_values(["t", "site"], kind="stable", ignore_index=True)
    data["site"] = pd.Categorical(data["site"], categories=SITES)
    return data


HOURLY = _hourly()
DAILY = (
    HOURLY.assign(day=HOURLY["t"].dt.floor("D"))
    .groupby(["day", "site"], observed=True, as_index=False)
    .agg(kwh=("kwh", "sum"))
)


def _site(name: str) -> pd.DataFrame:
    return HOURLY[HOURLY["site"] == name].reset_index(drop=True)


def _chart(data: object, **options: object) -> hg.Chart:
    """A report figure: 8 by 5 inches (768 by 480 CSS pixels) in the brand font."""
    return hg.Chart(data, width=768, height=480, theme=THEME, time_zone="UTC", **options)


# The figures -------------------------------------------------------------


def overview() -> hg.Chart:
    """A grid of a panel per site and one of all, with one legend under it."""
    panels = [hg.Panel(site, title=site) for site in SITES] + [hg.Panel("all", title="All")]
    chart = _chart(
        HOURLY,
        title="Weekly efficiency",
        panels=panels,
        layout=hg.Grid(columns=2),
        legend=hg.LegendOptions(place=hg.Place(side="bottom"), columns=3),
        scales={"color": hg.OrdinalScale(map=COLORS)},
    )
    for site in SITES:
        chart = chart.line(data=_site(site), x="t", y="efficiency", color="site", panel=site)
    return chart.line(x="t", y="efficiency", color="site", panel="all")


TEMPERATURE, HUMIDITY = "#d6336c", "#1c7ed6"


def twin_axes() -> hg.Chart:
    """Temperature on the left axis and humidity on the right, each axis's
    labels in its series' color."""
    return (
        _chart(
            _site("Site A"),
            title="Temperature and humidity",
            y=hg.AxisOptions(title="Temperature", style={"tick_label": {"color": TEMPERATURE}}),
            y_right=hg.AxisOptions(title="Humidity (%)", style={"tick_label": {"color": HUMIDITY}}),
        )
        .line(x="t", y="temp", stroke=TEMPERATURE)
        .line(x="t", y="humidity", stroke=HUMIDITY, axis="right")
    )


STEPS = "#2f9e44"
DAYTIME = (6, 18)


def day_steps() -> hg.Chart:
    """Daytime hours as steps, broken at each day without rows between days."""
    daytime = _site("Site B")
    daytime = daytime[daytime["t"].dt.hour.between(*DAYTIME)]
    return _chart(daytime, title="Daytime efficiency").line(
        x="t",
        y="efficiency",
        curve="step-after",
        continuity=hg.Continuity(break_by="day"),
        stroke=STEPS,
    )


SHADE, EFFICIENCY = "#e03131", "#343a40"


def shading() -> hg.Chart:
    """The stretches where efficiency is under the limit, shaded between them."""
    return (
        _chart(_site("Site A"), title="Below the limit")
        .area(
            x="t",
            y1="efficiency",
            y2="limit",
            where=hg.col("efficiency") < hg.col("limit"),
            fill=SHADE,
            fill_opacity=0.3,
            label="Below limit",
        )
        .line(x="t", y="efficiency", stroke=EFFICIENCY)
        .line(x="t", y="limit", stroke=SHADE, dash="--")
    )


def heat_and_line() -> hg.Chart:
    """A heatmap of load by hour and weekday beside its trend, the colorbar
    beside the heatmap's panel only."""
    load = _site("Site C").assign(
        day=lambda d: d["t"].dt.strftime("%a"), hour=lambda d: d["t"].dt.hour
    )
    return (
        _chart(
            load,
            title="Load by hour",
            panels=[hg.Panel("heat", title="Hour by day"), hg.Panel("trend", title="Trend")],
            layout=hg.Grid(columns=2),
            guides=[
                hg.colorbar(title="kWh", place=hg.Place(side="right", scope="panel", panel="heat"))
            ],
        )
        .heatmap(x="hour", y="day", color="kwh", panel="heat")
        .line(x="t", y="kwh", panel="trend")
    )


def stacked() -> hg.Chart:
    """Each day's energy, stacked by site in the sites' order."""
    return _chart(DAILY, title="Energy by day", scales={"color": hg.OrdinalScale(map=COLORS)}).bar(
        x="day", y="kwh", color="site", stack=True
    )


LIMITS = pd.DataFrame(
    {"site": SITES, "limit": [68.0, 70.0, 72.0], "name": ["Min A", "Min B", "Min C"]}
)


def facets() -> hg.Chart:
    """A panel per site, each with its own limit drawn and named."""
    return (
        _chart(HOURLY, title="Efficiency per site", facet="site")
        .line(x="t", y="efficiency")
        .rule(data=LIMITS, y="limit", label=hg.Label(field="name"))
    )


TARGET = 1000.0


def labels() -> hg.Chart:
    """Labels of two lines: the target's outside the plot at its start, and
    a note centered over a point; the title needs the fallback font."""
    energy = DAILY[DAILY["site"] == "Site A"].reset_index(drop=True)
    return (
        _chart(energy, title="Energy ★ target")
        .line(x="day", y="kwh", markers=True)
        .rule(
            y=TARGET,
            label=hg.Label(
                text="Target\n1,000 kWh", place=hg.LabelPlace(attachment="start", outside=True)
            ),
        )
        .text(
            x=energy["day"].iloc[3],
            y=energy["kwh"].iloc[3],
            label=hg.Label(
                text="mid-week\nreview", style={"align": "center", "vertical_align": "bottom"}
            ),
        )
    )


MARKERS = "#7048e8"


def clearance() -> hg.Chart:
    """Markers on every day, the first and last at the plot's ends."""
    energy = DAILY[DAILY["site"] == "Site B"]
    return _chart(energy, title="Daily energy").line(x="day", y="kwh", markers=True, stroke=MARKERS)


def dictionary_colors(data: pd.DataFrame | None = None) -> hg.Chart:
    """Sites B and C, rows reversed: colors follow the sites' categories,
    not the rows, so A, absent, keeps its color for later."""
    part = DAILY[DAILY["site"] != "Site A"].iloc[::-1] if data is None else data
    return _chart(part, title="Sites B and C").line(x="day", y="kwh", color="site")


SELECTED = "#1971c2"
BINS = list(range(60, 88, 2))
# The live chart's window: six days of rows, after the seventh streamed in.
WINDOW = 6 * 24 * len(SITES)


@functools.cache
def streamed_selection() -> tuple[pd.DataFrame, hg.RowSelection, np.ndarray]:
    """What a live chart holds selected after its data streamed on: the rows
    a browser selected in the first six days (Site C's above 82), reported
    again once the seventh day streamed in and the window dropped the first.
    Returns the chart's data then, its selection, and, computed here, the
    positions of the selected rows in that data."""
    pytest.importorskip("anywidget")
    first = HOURLY.iloc[:WINDOW]
    chart = hg.Chart(first, row_selection=hg.SelectionBinding("focus"))
    widget = chart.histogram(x="efficiency", bins=BINS).widget()
    widget.comm.send = lambda *_, **__: None
    picked = np.flatnonzero((first["site"] == "Site C") & (first["efficiency"] > 82))

    def report(rows: np.ndarray) -> None:
        # The browser names rows by their number since the table was sent.
        content = {"type": "rowSelection", "table": "data", "channel": "focus", "origin": "b1"}
        selection = {"kind": "rows", "generation": 0}
        buffers = [np.asarray(rows, dtype="<f8").tobytes()]
        widget._handle_custom_msg({**content, "selection": selection}, buffers)

    report(picked)
    widget.append(HOURLY.iloc[WINDOW:], max_rows=WINDOW)
    report(picked)
    dropped = len(HOURLY) - WINDOW
    expected = picked[picked >= dropped] - dropped
    return HOURLY.iloc[dropped:].reset_index(drop=True), widget.row_selection, expected


def current_selection() -> hg.Chart:
    """The histogram of efficiency with what a live chart holds selected now,
    exported as it is: each bin's selected rows against its whole."""
    data, selection, _ = streamed_selection()
    binding = hg.SelectionBinding("focus", selection=selection)
    return _chart(data, title="Selected now", row_selection=binding).histogram(
        x="efficiency", bins=BINS, fill=SELECTED
    )


# Wednesday's and Thursday's daytime rows.
CHOSEN = (HOURLY["t"].dt.dayofweek.isin([2, 3]) & HOURLY["t"].dt.hour.between(*DAYTIME)).to_numpy()


def partial_statistics(selection: object = CHOSEN) -> hg.Chart:
    """A box plot per site and a heatmap of hours by site, each drawing the
    chosen rows against the whole: the chosen values' own boxes over the
    sites' boxes, and in each cell a square of its chosen share."""
    binding = hg.SelectionBinding("focus", selection=selection)
    return (
        _chart(
            HOURLY.assign(hour=HOURLY["t"].dt.hour),
            title="Wednesday and Thursday daytime",
            panels=[hg.Panel("box", title="Efficiency"), hg.Panel("heat", title="By hour")],
            layout=hg.Grid(columns=2),
            row_selection=binding,
            legend=False,
        )
        .boxplot(x="site", y="efficiency", fill=SELECTED, panel="box")
        .heatmap(x="hour", y="site", color="efficiency", panel="heat")
    )


# Reading the SVG ---------------------------------------------------------

_SVG = "{http://www.w3.org/2000/svg}"


@dataclass(frozen=True)
class Box:
    left: float
    top: float
    right: float
    bottom: float

    def contains(self, other: Box, slack: float = 0.5) -> bool:
        return (
            other.left >= self.left - slack
            and other.right <= self.right + slack
            and other.top >= self.top - slack
            and other.bottom <= self.bottom + slack
        )


@dataclass(frozen=True)
class Text:
    lines: tuple[str, ...]
    x: float
    ys: tuple[float, ...]
    anchor: str
    fill: str | None

    @property
    def content(self) -> str:
        return "\n".join(self.lines)


class Drawing:
    """An exported SVG as the checks read it: plots (the clip rectangle of
    each panel), texts, and paths and rectangles by their paint."""

    def __init__(self, svg: str) -> None:
        self.root = ET.fromstring(svg)
        # Exports draw at absolute coordinates, but for rotated text (axis
        # titles); a transform elsewhere would move what these checks read.
        assert all(
            element.get("transform") is None or element.tag == _SVG + "text"
            for element in self.root.iter()
        )
        self.width = float(self.root.get("width") or self.root.get("viewBox", "").split()[2])
        self.height = float(self.root.get("height") or self.root.get("viewBox", "").split()[3])

    def all(self, tag: str) -> list[ET.Element]:
        return list(self.root.iter(_SVG + tag))

    @property
    def plots(self) -> list[Box]:
        return [_box(rect) for clip in self.all("clipPath") for rect in clip.iter(_SVG + "rect")]

    @property
    def texts(self) -> list[Text]:
        """Text elements, with the anchor and fill they take from their groups."""
        found: list[Text] = []

        def visit(element: ET.Element, anchor: str, fill: str | None) -> None:
            anchor = element.get("text-anchor", anchor)
            fill = element.get("fill", fill)
            if element.tag != _SVG + "text":
                for child in element:
                    visit(child, anchor, fill)
                return
            spans = element.findall(_SVG + "tspan")
            y = float(element.get("y", "0"))
            lines = tuple(span.text or "" for span in spans) if spans else (element.text or "",)
            ys = tuple(float(span.get("y", y)) for span in spans) if spans else (y,)
            found.append(Text(lines, float(element.get("x", "0")), ys, anchor, fill))

        visit(self.root, "start", None)
        return found

    def text(self, content: str) -> Text:
        (found,) = [text for text in self.texts if text.content == content]
        return found

    def paths(self, **paint: str) -> list[ET.Element]:
        return [
            path
            for path in self.all("path")
            if all(path.get(name.replace("_", "-")) == value for name, value in paint.items())
        ]

    def rects(self, **paint: str) -> list[Box]:
        """Rectangles of a paint: elements, and paths of them (bars)."""
        return [
            _box(rect)
            for rect in self.all("rect")
            if all(rect.get(name.replace("_", "-")) == value for name, value in paint.items())
        ] + [box for path in self.paths(**paint) for box in rectangles(path)]

    def axis(self, plot: Box, side: str = "left") -> Callable[[float], float]:
        """The pixel of a value along a plot's y axis on `side`, from where
        the axis's tick labels are: what the reader of the chart reads."""
        ticks = []
        for text in self.texts:
            beside = text.x < plot.left if side == "left" else text.x > plot.right
            within = plot.top - 1 <= text.ys[0] <= plot.bottom + 1
            value = _number(text.content)
            if beside and within and value is not None:
                ticks.append((value, text.ys[0]))
        assert len(ticks) >= 2, f"no {side} axis labels beside {plot}"
        values, pixels = np.array(ticks).T
        slope, intercept = np.polyfit(values, pixels, 1)
        assert np.allclose(values * slope + intercept, pixels, atol=0.6), ticks
        return lambda value: float(value * slope + intercept)


def _box(rect: ET.Element) -> Box:
    x, y = float(rect.get("x", "0")), float(rect.get("y", "0"))
    return Box(x, y, x + float(rect.get("width", "0")), y + float(rect.get("height", "0")))


def _number(text: str) -> float | None:
    try:
        return float(text.replace(",", "").replace("−", "-"))
    except ValueError:
        return None


_COMMANDS = re.compile(r"([MLHVZmlhvzaA])([^MLHVZmlhvzaA]*)")


def subpaths(path: ET.Element) -> list[list[tuple[float, float]]]:
    """The points of a path's subpaths, of absolute moves, lines, and closes."""
    found: list[list[tuple[float, float]]] = []
    x = y = 0.0
    for command, arguments in _COMMANDS.findall(path.get("d", "")):
        numbers = [float(n) for n in re.findall(r"-?[\d.]+(?:e-?\d+)?", arguments)]
        if command == "M":
            x, y = numbers[:2]
            found.append([(x, y)])
            numbers = numbers[2:]
            command = "L"
        if command == "L":
            for i in range(0, len(numbers), 2):
                x, y = numbers[i : i + 2]
                found[-1].append((x, y))
        elif command == "H":
            for x in numbers:
                found[-1].append((x, y))
        elif command == "V":
            for y in numbers:
                found[-1].append((x, y))
        elif command not in "Zz":
            raise AssertionError(f"unexpected path command {command}")
    return found


def rectangles(path: ET.Element) -> list[Box]:
    """The rectangles of a path of them, each ``M x y h w v h h -w Z``."""
    return [
        Box(min(x, x + w), min(y, y + h), max(x, x + w), max(y, y + h))
        for x, y, w, h in (
            map(float, found)
            for found in re.findall(
                r"M(-?[\d.]+) (-?[\d.]+)h(-?[\d.]+)v(-?[\d.]+)h-?[\d.]+Z", path.get("d", "")
            )
        )
    ]


def segments(path: ET.Element) -> list[tuple[float, float, float, float]]:
    """The straight segments of a path of them, each ``M x1 y1 L x2 y2``."""
    return [
        tuple(map(float, found))  # type: ignore[misc]
        for found in re.findall(r"M(-?[\d.]+) (-?[\d.]+)L(-?[\d.]+) (-?[\d.]+)", path.get("d", ""))
    ]


def markers(path: ET.Element) -> list[Box]:
    """The boxes of circular markers drawn as two arcs from their left edge."""
    return [
        Box(float(x), float(y) - float(r), float(x) + 2 * float(r), float(y) + float(r))
        for x, y, r in re.findall(r"M(-?[\d.]+) (-?[\d.]+)a([\d.]+)", path.get("d", ""))
    ]


def _svg(chart: hg.Chart) -> Drawing:
    return Drawing(chart.to_svg(fonts=BRAND))


# The report as documents take it -----------------------------------------

FIGURES = [overview, twin_axes, day_steps, shading, heat_and_line, stacked, facets, labels]
FIGURES += [clearance, dictionary_colors]


@pytest.mark.contract("report.figures.jpeg.python")
def test_every_figure_is_a_150_dpi_jpeg_of_8_by_5_inches_in_the_brand_font():
    for figure in FIGURES + [current_selection, partial_statistics]:
        image = figure().to_image(format="jpeg", size=(8, 5), unit="in", dpi=150, fonts=BRAND)
        picture = Image.open(io.BytesIO(image))
        assert (picture.format, picture.size) == ("JPEG", (1200, 750)), figure.__name__
        assert picture.info["dpi"] == (150, 150), figure.__name__
        # Drawn, not blank: plenty of ink on the background.
        pixels = np.asarray(picture.convert("L"))
        assert (pixels < 230).mean() > 0.01, figure.__name__


@pytest.mark.contract("report.fonts.cff-pdf.python")
def test_the_brand_font_draws_svg_and_png_and_pdf_says_it_needs_truetype():
    svg = labels().to_svg(fonts=BRAND)
    assert 'font-family="Brand, Symbols"' in svg
    with pytest.raises(hg.ChartError, match="CFF outlines; PDF embedding needs"):
        labels().to_pdf(fonts=BRAND)
    assert labels().to_pdf(fonts=TRUETYPE).startswith(b"%PDF")


@pytest.mark.contract("report.fonts.fallback.python")
def test_text_the_brand_font_lacks_is_drawn_in_the_fallback():
    # The star is the Symbols face's only glyph but one: without the fallback
    # in the theme's font list, every export refuses the title.
    with pytest.raises(hg.ChartError, match="do not cover U\\+2605"):
        labels().to_png(fonts={"Brand": BRAND["Brand"]})
    # A title of the star alone draws it where the title starts, and nothing
    # else on the title's row.
    star = _chart(DAILY, title="★").line(x="day", y="kwh")
    picture = np.asarray(Image.open(io.BytesIO(star.to_png(fonts=BRAND))).convert("L"))
    title = _svg(star).text("★")
    rows = picture[int(title.ys[0]) - 8 : int(title.ys[0]) + 8]
    ink = np.flatnonzero((rows < 128).any(axis=0))
    assert len(ink) > 6
    assert ink.min() >= title.x - 1 and ink.max() <= title.x + 16


# The figures' checks -----------------------------------------------------


@pytest.mark.contract("report.legend.below-grid.python")
def test_one_legend_lists_the_sites_under_the_grid_of_panels():
    drawing = _svg(overview())
    plots = drawing.plots
    assert len(plots) == 4
    swatches = [box for color in COLORS.values() for box in drawing.rects(fill=color)]
    below = max(plot.bottom for plot in plots)
    names = [t for t in drawing.texts if t.content in SITES and t.ys[0] > below]
    # One entry per site, in the categories' order along one row.
    assert [t.content for t in sorted(names, key=lambda t: t.x)] == SITES
    assert len(swatches) == 3 and len({t.ys[0] for t in names}) == 1
    for swatch in swatches:
        assert swatch.top > below + 16  # under the x axis's labels too
        assert Box(0, 0, drawing.width, drawing.height).contains(swatch)
    # Each site's panel draws its own line in its color; "All" draws the three.
    for color in COLORS.values():
        assert len(drawing.paths(stroke=color)) == 2


@pytest.mark.contract("report.axes.twin.python")
def test_twin_axes_place_each_series_on_its_own_side_and_domain():
    drawing = _svg(twin_axes())
    (plot,) = drawing.plots
    data = _site("Site A")
    for column, color, side in (("temp", TEMPERATURE, "left"), ("humidity", HUMIDITY, "right")):
        to_pixel = drawing.axis(plot, side)
        labels = [text for text in drawing.texts if _number(text.content) is not None]
        beside = [t for t in labels if (t.x < plot.left if side == "left" else t.x > plot.right)]
        assert beside and all(text.fill == color for text in beside)
        (path,) = drawing.paths(stroke=color)
        (points,) = subpaths(path)
        ys = np.array([y for _, y in points])
        expected = np.array([to_pixel(value) for value in data[column]])
        assert ys.shape == expected.shape
        assert np.allclose(ys, expected, atol=0.6)


@pytest.mark.contract("report.steps.day-breaks.python")
def test_daytime_steps_break_at_every_day_without_joining_the_nights():
    drawing = _svg(day_steps())
    (path,) = drawing.paths(stroke=STEPS)
    days = subpaths(path)
    assert len(days) == DAYS
    first, last = DAYTIME
    hours = last - first
    width = days[0][-1][0] - days[0][0][0]
    pixels_per_hour = width / hours
    to_y = drawing.axis(drawing.plots[0])
    daytime = _site("Site B")
    daytime = daytime[daytime["t"].dt.hour.between(*DAYTIME)]
    for i, (day, (_, rows)) in enumerate(
        zip(days, daytime.groupby(daytime["t"].dt.day), strict=True)
    ):
        start = day[0][0]
        # Each hour's value held flat until the next hour, then a rise or
        # fall to the next value: two corners per hour after the first.
        values = rows["efficiency"].to_list()
        steps = [(start, to_y(values[0]))]
        for hour in range(1, len(values)):
            x = start + hour * pixels_per_hour
            steps += [(x, to_y(values[hour - 1])), (x, to_y(values[hour]))]
        drawn = [(x, y) for k, (x, y) in enumerate(day) if k == 0 or (x, y) != day[k - 1]]
        assert len(drawn) == len(steps) and np.allclose(drawn, steps, atol=0.6), i
        if i:
            night = start - days[i - 1][-1][0]
            assert night == pytest.approx((24 - hours) * pixels_per_hour, abs=0.3)


def _crossings(
    times: np.ndarray, values: np.ndarray, limit: np.ndarray
) -> list[tuple[float, float]]:
    """The intervals of time where the values are under the limit, with the
    ends where the straight lines between rows cross it."""
    below = values < limit
    intervals = []
    start = None
    for i in range(len(values)):
        if below[i] and start is None:
            start = times[0] if i == 0 else _cross(times, values - limit, i - 1)
        if start is not None and (i == len(values) - 1 or not below[i + 1]):
            end = times[-1] if i == len(values) - 1 else _cross(times, values - limit, i)
            intervals.append((start, end))
            start = None
    return intervals


def _cross(times: np.ndarray, difference: np.ndarray, i: int) -> float:
    a, b = difference[i], difference[i + 1]
    return float(times[i] + (times[i + 1] - times[i]) * a / (a - b))


@pytest.mark.contract("report.area.conditional-band.python")
def test_shading_fills_only_where_efficiency_is_under_the_limit():
    drawing = _svg(shading())
    data = _site("Site A")
    hours = (data["t"] - data["t"].iloc[0]).dt.total_seconds().to_numpy() / 3600
    expected = _crossings(hours, data["efficiency"].to_numpy(), data["limit"].to_numpy())
    (line,) = drawing.paths(stroke=EFFICIENCY)
    (points,) = subpaths(line)
    left, right = points[0][0], points[-1][0]
    to_x = lambda hour: left + (right - left) * hour / hours[-1]  # noqa: E731
    (band,) = drawing.paths(fill=SHADE)
    shaded = subpaths(band)
    assert len(shaded) == len(expected) == DAYS
    to_y = drawing.axis(drawing.plots[0])
    limit_y = to_y(data["limit"].iloc[0])
    # The efficiency line where the data puts it, between rows as drawn.
    line_x = np.array([to_x(hour) for hour in hours])
    line_y = np.array([to_y(value) for value in data["efficiency"]])
    for polygon, (start, end) in zip(shaded, expected, strict=True):
        xs = np.array([x for x, _ in polygon])
        ys = np.array([y for _, y in polygon])
        assert xs.min() == pytest.approx(to_x(start), abs=0.6)
        assert xs.max() == pytest.approx(to_x(end), abs=0.6)
        # Every corner on the limit or on the line under it.
        on_line = np.abs(ys - np.interp(xs, line_x, line_y)) < 0.6
        assert np.all(on_line | (np.abs(ys - limit_y) < 0.6))
        # And all the area between them: the line's sag under the limit.
        within = (line_x > to_x(start)) & (line_x < to_x(end))
        sag_x = np.concatenate(([to_x(start)], line_x[within], [to_x(end)]))
        sag_y = np.concatenate(([limit_y], line_y[within], [limit_y]))
        depth = sag_y - limit_y
        area = float(np.sum((depth[1:] + depth[:-1]) / 2 * np.diff(sag_x)))
        shoelace = 0.5 * abs(np.dot(xs, np.roll(ys, -1)) - np.dot(ys, np.roll(xs, -1)))
        assert area > 100 and shoelace == pytest.approx(area, rel=0.02)


@pytest.mark.contract("report.colorbar.beside-panel.python")
def test_the_colorbar_stands_beside_the_heatmap_panel_only():
    drawing = _svg(heat_and_line())
    heat, trend = sorted(drawing.plots, key=lambda plot: plot.left)
    (bar,) = [
        _box(rect) for rect in drawing.all("rect") if (rect.get("fill") or "").startswith("url(")
    ]
    assert bar.left > heat.right and bar.right < trend.left
    assert heat.top <= bar.top and bar.bottom <= heat.bottom
    # Its labels, the data's ends rounded to ticks, sit between it and the trend's labels.
    load = _site("Site C")["kwh"]
    ticks = [
        t
        for t in drawing.texts
        if bar.right < t.x < trend.left - 30 and _number(t.content) is not None
    ]
    values = sorted(_number(t.content) for t in ticks)
    assert values[0] <= load.min() and values[-1] >= load.max()
    trend_labels = [
        t for t in drawing.texts if t.anchor == "end" and abs(t.x - (trend.left - 8)) < 1
    ]
    assert max(t.x for t in ticks) + 20 < min(t.x for t in trend_labels)


@pytest.mark.contract("report.bars.stacked.python")
def test_stacked_bars_pile_the_sites_in_order_to_each_days_total():
    drawing = _svg(stacked())
    (plot,) = drawing.plots
    to_y = drawing.axis(plot)
    days = DAILY.pivot(index="day", columns="site", values="kwh")
    bars = {
        site: sorted(
            (box for box in drawing.rects(fill=COLORS[site]) if plot.contains(box)),
            key=lambda box: box.left,
        )
        for site in SITES
    }
    assert all(len(found) == DAYS for found in bars.values())
    for i, (_, energy) in enumerate(days.iterrows()):
        base = to_y(0)
        for site in SITES:
            bar = bars[site][i]
            # Each site's part sits on the one before, its height its energy.
            assert bar.bottom == pytest.approx(base, abs=0.6)
            assert bar.top == pytest.approx(to_y(energy[:site].sum()), abs=0.6)
            base = bar.top
        assert base == pytest.approx(to_y(energy.sum()), abs=0.6)


@pytest.mark.contract("report.facets.reference-lines.python")
def test_each_facet_draws_its_own_limit_and_names_it():
    drawing = _svg(facets())
    plots = drawing.plots
    assert len(plots) == 3
    rules = [
        (float(line.get("x1")), float(line.get("y1")), float(line.get("x2")))
        for line in drawing.all("line")
        if line.get("stroke-dasharray")
    ]
    assert len(rules) == 3
    for plot, (_, limit, name) in zip(plots, LIMITS.itertuples(index=False), strict=True):
        (rule,) = [
            (x1, y, x2)
            for x1, y, x2 in rules
            if plot.left - 0.5 <= x1 and x2 <= plot.right + 0.5 and plot.top <= y <= plot.bottom
        ]
        # Panels on a row share y, so a panel without labels reads its row's first.
        first = min((p for p in plots if abs(p.top - plot.top) < 1), key=lambda p: p.left)
        assert rule[1] == pytest.approx(drawing.axis(first)(limit), abs=0.6)
        label = drawing.text(name)
        assert plot.left <= label.x <= plot.right + 0.5 and plot.top <= label.ys[0] <= plot.bottom


@pytest.mark.contract("report.labels.multiline.python")
def test_labels_of_two_lines_keep_their_lines_aligned_and_clear_of_what_they_label():
    drawing = _svg(labels())
    (plot,) = drawing.plots
    to_y = drawing.axis(plot)
    target = drawing.text("Target\n1,000 kWh")
    # Outside the plot at the rule's start: right-aligned lines, left of the
    # axis labels, centered on the rule as a block.
    assert target.anchor == "end" and target.x < plot.left
    axis_labels = [
        t for t in drawing.texts if t.anchor == "end" and t.x < plot.left and t is not target
    ]
    assert target.x <= min(t.x for t in axis_labels) + 0.5
    middle = sum(target.ys) / 2
    assert middle == pytest.approx(to_y(TARGET), abs=2)
    assert target.ys[1] - target.ys[0] > 10
    note = drawing.text("mid-week\nreview")
    energy = DAILY[DAILY["site"] == "Site A"]["kwh"].iloc[3]
    # Centered over its point, its last line above it.
    assert note.anchor == "middle"
    assert note.ys[-1] < to_y(energy) - 4


@pytest.mark.contract("report.markers.clearance.python")
def test_markers_at_the_ends_are_drawn_whole():
    drawing = _svg(clearance())
    (plot,) = drawing.plots
    (dots,) = drawing.paths(fill=MARKERS)
    boxes = sorted(markers(dots), key=lambda box: box.left)
    assert len(boxes) == DAYS
    for box in (boxes[0], boxes[-1]):
        assert plot.contains(box)
    # Painted whole in the image: as much of the first marker's color left of
    # its center as right of it.
    png = np.asarray(Image.open(io.BytesIO(clearance().to_png(fonts=BRAND))).convert("RGB"))
    first = boxes[0]
    row = png[int((first.top + first.bottom) / 2)]
    center = (first.left + first.right) / 2
    purple = (np.abs(row.astype(int) - (0x70, 0x48, 0xE8)).sum(axis=1) < 60).nonzero()[0]
    near = purple[np.abs(purple - center) <= 4]
    assert near.min() <= center - 2 and near.max() >= center + 2


@pytest.mark.contract("report.colors.dictionary.python")
def test_colors_follow_the_categories_whatever_rows_are_drawn():
    every = _site_colors(_svg(dictionary_colors(DAILY)), SITES)
    some = _site_colors(_svg(dictionary_colors()), ["Site B", "Site C"])
    # B and C keep the colors they have beside A, in lines and legend alike.
    assert len(set(every.values())) == 3
    assert some == {site: every[site] for site in ("Site B", "Site C")}


def _site_colors(drawing: Drawing, sites: list[str]) -> dict[str, str]:
    """Each site's color: its line's, known by where the line runs (each
    site's daily energy), which its legend swatch must show too."""
    (plot,) = drawing.plots
    to_y = drawing.axis(plot)
    colors = {}
    lines = [path for path in drawing.all("path") if path.get("stroke-width") == "2"]
    assert len(lines) == len(sites)
    for path in lines:
        (points,) = subpaths(path)
        ys = [y for _, y in sorted(points)]
        (site,) = [
            site
            for site in sites
            if np.allclose(ys, [to_y(v) for v in DAILY[DAILY["site"] == site]["kwh"]], atol=0.6)
        ]
        colors[site] = path.get("stroke")
    swatches = [box for box in drawing.rects() if box.bottom < plot.top]
    for site in sites:
        (name,) = [t for t in drawing.texts if t.content == site and t.ys[0] < plot.top]
        swatch = max((b for b in swatches if b.right <= name.x), key=lambda b: b.right)
        assert abs((swatch.top + swatch.bottom) / 2 - name.ys[0]) < 1
        (fill,) = [rect.get("fill") for rect in drawing.all("rect") if _box(rect) == swatch]
        assert fill == colors[site], site
    return colors


@pytest.mark.contract("report.selection.current.python")
def test_the_selection_exported_is_what_the_live_chart_holds_now():
    data, selection, expected = streamed_selection()
    # Python's selection moved with the window: the rows it names now.
    assert selection.rows.tolist() == expected.tolist()
    assert len(expected) and len(data) == WINDOW
    drawing = _svg(current_selection())
    to_y = drawing.axis(drawing.plots[0])
    chosen = np.zeros(len(data), dtype=bool)
    chosen[expected] = True
    selected = {
        round(box.left): box
        for path in drawing.paths(fill=SELECTED, fill_opacity="1")
        for box in rectangles(path)
    }
    whole, _ = np.histogram(data["efficiency"], bins=BINS)
    part, _ = np.histogram(data["efficiency"][chosen], bins=BINS)
    assert len(selected) == np.count_nonzero(part)
    # Each bin's selected part rises from its base to its selected count.
    lefts = sorted(selected)
    for left, count in zip(lefts, part[part > 0], strict=True):
        assert selected[left].bottom == pytest.approx(to_y(0), abs=0.6)
        assert selected[left].top == pytest.approx(to_y(count), abs=0.6)
    dimmed = [
        box
        for path in drawing.paths(fill=SELECTED, fill_opacity="0.25")
        for box in rectangles(path)
    ]
    assert len(dimmed) == np.count_nonzero(whole - part)


def _dimmed(drawing: Drawing) -> set[ET.Element]:
    return {
        element
        for group in drawing.all("g")
        if group.get("opacity") == "0.25"
        for element in group.iter()
    }


@pytest.mark.contract("report.selection.partial-statistics.python")
def test_boxes_and_cells_draw_the_chosen_rows_against_the_whole():
    drawing = _svg(partial_statistics())
    box_plot, heat = sorted(drawing.plots, key=lambda plot: plot.left)
    to_y = drawing.axis(box_plot)
    dimmed = _dimmed(drawing)
    (outlines,) = [
        path for path in drawing.paths(stroke=SELECTED) if path not in dimmed and segments(path)
    ]
    # Each site's chosen values make a box of their own quartiles.
    horizontal = [(x1, y1, x2) for x1, y1, x2, y2 in segments(outlines) if y1 == y2 and x2 > x1]
    for i, site in enumerate(SITES):
        values = HOURLY.loc[CHOSEN & (HOURLY["site"] == site).to_numpy(), "efficiency"]
        width = box_plot.right - box_plot.left
        band = (box_plot.left + width * i / 3, box_plot.left + width * (i + 1) / 3)
        own = [s for s in horizontal if band[0] <= s[0] and s[2] <= band[1]]
        widest = max(x2 - x1 for x1, _, x2 in own)
        lines = sorted({round(y, 1) for x1, y, x2 in own if x2 - x1 == pytest.approx(widest)})
        q1, median, q3 = np.quantile(values, [0.25, 0.5, 0.75])
        assert lines == pytest.approx([to_y(q3), to_y(median), to_y(q1)], abs=0.6)
    _check_chosen_cells(drawing, box_plot, heat)


def _check_chosen_cells(drawing: Drawing, box_plot: Box, heat: Box) -> None:
    """Each cell of a chosen hour holds two of its week's rows: a square of
    that share of its area at the cell's middle, where the heatmap's tick
    labels say the site and the hour are."""
    cell_width = (heat.right - heat.left) / 24
    cell_height = (heat.bottom - heat.top) / len(SITES)
    squares = [
        box
        for path in drawing.all("path")
        if path.get("fill-opacity") == "1" and heat.contains(Box(*_bounds(path)))
        for box in rectangles(path)
    ]
    # The sites' labels left of the heatmap, its hours' under it.
    rows = {
        text.content: text.ys[0]
        for text in drawing.texts
        if text.content in SITES and box_plot.right < text.x < heat.left
    }
    hours = [
        (value, text.x)
        for text in drawing.texts
        if (value := _number(text.content)) is not None
        and heat.left - 1 <= text.x <= heat.right + 1
        and text.ys[0] > heat.bottom
    ]
    assert sorted(rows) == SITES and len(hours) >= 2
    slope, intercept = np.polyfit(*np.array(hours).T, 1)
    drawn = set()
    for square in squares:
        middle = ((square.left + square.right) / 2, (square.top + square.bottom) / 2)
        site = min(rows, key=lambda name: abs(rows[name] - middle[1]))
        hour = round((middle[0] - intercept) / slope)
        assert abs(rows[site] - middle[1]) < cell_height / 4
        assert abs(hour * slope + intercept - middle[0]) < cell_width / 4
        share = (
            (square.right - square.left) * (square.bottom - square.top) / (cell_width * cell_height)
        )
        assert share == pytest.approx(2 / DAYS, abs=0.02)
        drawn.add((site, hour))
    chosen_hours = range(DAYTIME[0], DAYTIME[1] + 1)
    assert len(squares) == len(drawn)
    assert drawn == {(site, hour) for site in SITES for hour in chosen_hours}


def _bounds(path: ET.Element) -> tuple[float, float, float, float]:
    boxes = rectangles(path)
    return (
        min(b.left for b in boxes),
        min(b.top for b in boxes),
        max(b.right for b in boxes),
        max(b.bottom for b in boxes),
    )


@pytest.mark.contract("report.selection.none-empty-all.python")
def test_no_selection_dims_nothing_an_empty_one_everything_and_a_whole_one_nothing():
    rows = len(HOURLY)
    cases = {"none": None, "empty": [], "all": np.ones(rows, dtype=bool)}
    for name, selection in cases.items():
        drawing = _svg(partial_statistics(selection))
        dimmed = _dimmed(drawing)
        chosen_boxes = [p for p in drawing.paths(stroke=SELECTED) if p not in dimmed]
        if name == "none":
            # Nothing is dimmed and no box is drawn twice.
            assert not dimmed and len(chosen_boxes) == 1
        elif name == "empty":
            assert dimmed and not any(segments(p) for p in chosen_boxes if p.get("fill") == "none")
        else:
            # Every row chosen: the chosen boxes are the whole's.
            assert dimmed
            (outlines,) = [p for p in chosen_boxes if segments(p)]
            whole = [p for p in drawing.paths(stroke=SELECTED) if p in dimmed and segments(p)]
            ys = lambda path: sorted({y1 for _, y1, _, y2 in segments(path) if y1 == y2})  # noqa: E731
            assert ys(outlines) == ys(whole[0])


# The same report in SVG, PNG, and PDF ------------------------------------


@pytest.mark.contract("report.export.consistency.python")
def test_svg_png_and_pdf_draw_the_same_report():
    pdfium = pytest.importorskip("pypdfium2")
    figures = FIGURES + [current_selection, partial_statistics]
    charts = [figure() for figure in figures]
    report = hg.to_pdf(charts, fonts=TRUETYPE, title="Weekly report")
    # One document of a page per figure, each face embedded once for all.
    assert report.count(b"/FontFile2") == len(TRUETYPE)
    document = pdfium.PdfDocument(report)
    assert len(document) == len(figures)
    for figure, chart, page in zip(figures, charts, document, strict=True):
        name = figure.__name__
        svg = chart.to_svg(fonts=TRUETYPE)
        png = Image.open(io.BytesIO(chart.to_png(dpi=150, fonts=TRUETYPE))).convert("RGB")
        # 8 by 5 inches everywhere: 768 by 480 CSS pixels, 576 by 360 points,
        # and 1200 by 750 pixels at 150 dpi.
        assert 'width="768" height="480"' in svg
        assert page.get_size() == pytest.approx((576, 360))
        drawn = page.render(scale=150 / 72).to_pil().convert("RGB")
        assert png.size == drawn.size == (1200, 750)
        difference = np.abs(np.asarray(png, dtype=int) - np.asarray(drawn, dtype=int)).max(axis=2)
        # The same geometry and paint; text antialiases its own way in each.
        assert difference.mean() < 2, name
        assert (difference > 96).mean() < 0.01, name
        # The same text: every line the SVG sets is in the PDF's text.
        written = re.sub(r"\s+", " ", page.get_textpage().get_text_range())
        for line in (line for t in Drawing(svg).texts for line in t.lines):
            assert line in written, (name, line)
