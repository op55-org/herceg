"""Proofs of the capability matrix's Express cells (test/contracts/express.json
at the repository root), cell by cell: each recipe, all the marks it draws,
against each capability, as ``<recipe>.<capability>.python``, on its fixture
(express_recipes.py).

Drawings are read as their reader reads them: an export is drawn (resvg
draws the SVG, MuPDF the PDF) at three pixels per CSS pixel, and each place
a recipe's statistics say a mark draws at, found through the axes its tick
and category labels show, must show that mark's color in a block of 2 by 2
pixels (within a few levels): an antialiased edge, a pixel across, would
pass for a translucent fill of its color."""

from __future__ import annotations

import io
import json
import re
import shutil
import subprocess
import xml.etree.ElementTree as ET
from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
import pytest
from express_recipes import (
    BACKGROUND,
    BESIDE,
    FONT,
    FONTS,
    GRID,
    RAMP,
    RECIPES,
    THEME,
    Along,
    Band,
    Measured,
    Mid,
    Place,
    Ramp,
    Recipe,
    Span,
    Tables,
    joined,
)

import herceg as hg
import herceg.express as hx

resvg_py = pytest.importorskip("resvg_py")
Image = pytest.importorskip("PIL.Image")

EXPRESS = json.loads(
    (Path(__file__).parents[2] / "test" / "contracts" / "express.json").read_text()
)
#: Pixels per CSS pixel, as the engine's export proofs read pictures.
SCALE = 3
#: How far from its place, in CSS pixels, a mark's color may show.
SLACK = 2.0
#: How near a color must be, in each channel, to count as it.
LEVELS = 10


def declared(capability: str, recipe: str) -> str:
    """The recipe's declared state of ``capability``: works, unproved, refused, or na."""
    cells = EXPRESS["recipes"][recipe]
    for state in ("works", "unproved", "refused", "na"):
        if capability in cells.get(state, ()):
            return state
    raise AssertionError(f"express.json: {recipe} declares no {capability}")


def test_every_recipe_has_a_fixture():
    assert list(RECIPES) == list(EXPRESS["recipes"])


# Pictures ----------------------------------------------------------------------------

_SVG = "{http://www.w3.org/2000/svg}"


@dataclass(frozen=True)
class Box:
    left: float
    top: float
    right: float
    bottom: float

    def side(self, axis: str) -> tuple[float, float]:
        return (self.left, self.right) if axis == "x" else (self.top, self.bottom)


def _rgb(color: str) -> np.ndarray:
    return np.array([int(color[i : i + 2], 16) for i in (1, 3, 5)], dtype=float)


def _near(pixels: np.ndarray, a: np.ndarray, b: np.ndarray, low: float, high: float) -> np.ndarray:
    """How far each pixel is, in its farthest channel, from the blends of
    `a` with between `low` and `high` of `b`."""
    t = np.clip(((pixels - a) @ (b - a)) / ((b - a) @ (b - a)), low, high)
    return np.abs(pixels - (a + t[..., None] * (b - a))).max(axis=2)


def _number(text: str) -> float | None:
    try:
        return float(text.replace(",", "").replace("−", "-"))
    except ValueError:
        return None


@dataclass(frozen=True)
class Text:
    """A text element: what it writes, where its anchor is drawn (by its
    own transform and its groups'), how it aligns there, and how far it is
    turned, in degrees."""

    content: str
    x: float
    y: float
    anchor: str
    baseline: str | None
    rotation: float


_STEP = re.compile(r"(\w+)\s*\(([^)]*)\)")


def _matrix(transform: str | None) -> np.ndarray:
    """An SVG transform as a matrix of homogeneous coordinates."""
    matrix = np.eye(3)
    for name, arguments in _STEP.findall(transform or ""):
        v = [float(value) for value in re.split(r"[\s,]+", arguments.strip()) if value]
        if name == "translate":
            step = np.array([[1, 0, v[0]], [0, 1, v[1] if len(v) > 1 else 0], [0, 0, 1]])
        elif name == "scale":
            step = np.diag([v[0], v[1] if len(v) > 1 else v[0], 1])
        elif name == "rotate":
            cos, sin = np.cos(np.radians(v[0])), np.sin(np.radians(v[0]))
            cx, cy = v[1:3] if len(v) == 3 else (0.0, 0.0)
            step = np.array(
                [
                    [cos, -sin, cx - cos * cx + sin * cy],
                    [sin, cos, cy - sin * cx - cos * cy],
                    [0, 0, 1],
                ]
            )
        elif name == "matrix":
            a, b, c, d, e, f = v
            step = np.array([[a, c, e], [b, d, f], [0, 0, 1]])
        else:
            raise AssertionError(f"a transform this reader does not apply: {transform}")
        matrix = matrix @ step
    return matrix


def texts_of(root: ET.Element, namespace: str = _SVG) -> list[Text]:
    """An SVG's texts, with the anchors and transforms their groups give them."""
    found: list[Text] = []

    def visit(element: ET.Element, anchor: str, matrix: np.ndarray) -> None:
        anchor = element.get("text-anchor", anchor)
        matrix = matrix @ _matrix(element.get("transform"))
        if element.tag == namespace + "text":
            x, y, _ = matrix @ [float(element.get("x", 0)), float(element.get("y", 0)), 1]
            rotation = round(float(np.degrees(np.arctan2(matrix[1, 0], matrix[0, 0]))), 1)
            baseline = element.get("dominant-baseline")
            found.append(
                Text(
                    element.text or "",
                    round(float(x), 3),
                    round(float(y), 3),
                    anchor,
                    baseline,
                    rotation,
                )
            )
            return
        for child in element:
            visit(child, anchor, matrix)

    visit(root, "start", np.eye(3))
    return found


class Picture:
    """An export as its reader sees it: its pixels, and from the SVG of its
    layout, each panel's plot (its clip rectangle), the labels beside it,
    and the colorbar, if any."""

    def __init__(self, svg: str, pixels: np.ndarray, panels: list[str]) -> None:
        root = ET.fromstring(svg)
        plots = [
            Box(x, y, x + float(rect.get("width", 0)), y + float(rect.get("height", 0)))
            for clip in root.iter(_SVG + "clipPath")
            for rect in clip.iter(_SVG + "rect")
            for x, y in [(float(rect.get("x", 0)), float(rect.get("y", 0)))]
        ]
        assert len(plots) == len(panels), "a plot for each panel"
        self.plots = dict(zip(panels, plots, strict=True))
        self.pixels = pixels.astype(np.int16)
        self.texts = texts_of(root)
        bars = [rect for rect in root.iter(_SVG + "rect") if "ramp" in rect.get("fill", "")]
        self.colorbar: Box | None = None
        if bars:
            x, y = float(bars[0].get("x", 0)), float(bars[0].get("y", 0))
            self.colorbar = Box(
                x, y, x + float(bars[0].get("width", 0)), y + float(bars[0].get("height", 0))
            )

    def labels(self, plot: Box, axis: str) -> list[tuple[str, float]]:
        """The labels along a plot's axis, and where each is: those under
        it, centered, or beside it, ending toward it; the nearest row or
        column of them, which a column or row of plots may share."""
        found = []
        for text in self.texts:
            x, y = text.x, text.y
            if text.rotation:
                continue
            if axis == "x" and text.anchor == "middle" and plot.left - 1 <= x <= plot.right + 1:
                if y > plot.bottom:
                    found.append((y - plot.bottom, text.content, x))
            elif axis == "y" and text.anchor == "end" and plot.top - 1 <= y <= plot.bottom + 1:
                found.append((min(abs(x - plot.left), abs(x - plot.right)), text.content, y))
        if not found:
            return []
        nearest = min(distance for distance, _, _ in found)
        return [(text, at) for distance, text, at in found if distance - nearest < 1]

    def scale(self, plot: Box, axis: str) -> Callable[[float], float]:
        """Where a value is along a numeric axis, from its tick labels."""
        ticks = [
            (value, at)
            for text, at in self.labels(plot, axis)
            if (value := _number(text)) is not None
        ]
        assert len(ticks) >= 2, f"no {axis} tick labels beside {plot}"
        values, pixels = np.array(ticks).T
        slope, intercept = np.polyfit(values, pixels, 1)
        assert np.allclose(values * slope + intercept, pixels, atol=0.6), ticks
        return lambda value: float(value * slope + intercept)

    def band(self, plot: Box, axis: str, label: str) -> tuple[float, float] | None:
        """A category's middle and its band's step, from the category labels; None if not shown."""
        found = self.labels(plot, axis)
        at = [position for text, position in found if text == label]
        if not at:
            return None
        positions = sorted(position for _, position in found)
        step = (
            float(np.diff(positions).min())
            if len(positions) > 1
            else plot.side(axis)[1] - plot.side(axis)[0]
        )
        return at[0], step

    def extent(self, coordinate: Any, axis: str, plot: Box) -> tuple[float, float] | None:
        """Where a coordinate is drawn along an axis, from its labels: a
        range of CSS pixels, or None where its category is not shown."""
        low, high = plot.side(axis)
        if coordinate is None:
            return low, high
        if isinstance(coordinate, Band):
            found = self.band(plot, axis, coordinate.label)
            if found is None:
                return None
            middle, step = found
            width = 0.8 * step
            half = width / 2
            if coordinate.series is not None:
                k, i = len(coordinate.shown), coordinate.shown.index(coordinate.series)
                middle += (i - (k - 1) / 2) * width / k
                half = width / (2 * k)
            half = half if coordinate.half is None else coordinate.half
            return middle - half, middle + half
        if isinstance(coordinate, Span):
            a, b = (self.scale(plot, axis)(value) for value in (coordinate.low, coordinate.high))
            return min(a, b), max(a, b)
        if isinstance(coordinate, Mid):
            ends = [self.extent(part, axis, plot) for part in (coordinate.first, coordinate.second)]
            if None in ends:
                return None
            middle = sum((a + b) / 2 for a, b in ends) / 2
            return middle, middle
        if isinstance(coordinate, Along):
            start = {"left": plot.left, "right": plot.right, "top": plot.top, "bottom": plot.bottom}
            inward = 1 if coordinate.edge in ("left", "top") else -1
            reach = (high - low) * coordinate.fraction + coordinate.inset
            at = start[coordinate.edge] + inward * reach
            return at, at
        at = self.scale(plot, axis)(float(coordinate))
        return at, at

    def colorbar_ends(self) -> tuple[tuple[float, float], tuple[np.ndarray, np.ndarray]]:
        """The values the colorbar's end labels name, and the colors it
        shows at its ends (inside their rounding)."""
        bar = self.colorbar
        assert bar is not None, "the chart has a colorbar"
        middle = (bar.top + bar.bottom) / 2
        ends = sorted(
            (text.x, number)
            for text in self.texts
            if abs(text.y - middle) < 1 and (number := _number(text.content)) is not None
        )
        assert len(ends) >= 2, "labels at the colorbar's ends"
        colors = (self._colorbar_at(bar.left + 1), self._colorbar_at(bar.right - 1))
        return (ends[0][1], ends[-1][1]), colors

    def _colorbar_at(self, x: float) -> np.ndarray:
        bar = self.colorbar
        assert bar is not None
        return self.pixels[int((bar.top + bar.bottom) / 2 * SCALE), int(x * SCALE)].astype(float)

    def ramp(self, value: float) -> np.ndarray:
        """The color the colorbar shows a value in."""
        bar = self.colorbar
        assert bar is not None, "the chart has a colorbar"
        (low, high), _ = self.colorbar_ends()
        x = bar.left + (value - low) / (high - low) * (bar.right - bar.left)
        return self._colorbar_at(min(max(x, bar.left + 1), bar.right - 1))

    def matching(
        self, region: np.ndarray, color: str | Ramp, opacity: float | None, layers: int = 1
    ) -> np.ndarray:
        """Which pixels show `color` at `opacity` over the background (or of
        up to `layers` such shapes over each other), within a few levels."""
        background = _rgb(BACKGROUND)
        rgb = self.ramp(color.value) if isinstance(color, Ramp) else _rgb(color)
        if opacity is None:
            return _near(region, background, rgb, 0.2, 0.95) <= LEVELS
        close = np.zeros(region.shape[:2], dtype=bool)
        for layer in range(1, layers + 1):
            alpha = 1 - (1 - opacity) ** layer
            target = rgb * alpha + background * (1 - alpha)
            close |= (np.abs(region - target) <= LEVELS).all(axis=2)
        return close

    def blocks(
        self,
        color: str | Ramp,
        opacity: float | None,
        box: Box,
        layers: int = 1,
        wide: int = 2,
    ) -> tuple[np.ndarray, int, int]:
        """Where blocks of `wide` by 2 pixels of a color are in `box` (CSS
        pixels): a mask whose entries are the blocks' top left pixels, and
        the picture's pixel at the mask's origin."""
        x0, y0 = max(int(np.floor(box.left * SCALE)), 0), max(int(np.floor(box.top * SCALE)), 0)
        x1, y1 = int(np.ceil(box.right * SCALE)) + 1, int(np.ceil(box.bottom * SCALE)) + 1
        close = self.matching(self.pixels[y0:y1, x0:x1], color, opacity, layers)
        tall = close[:-1] & close[1:]
        if tall.shape[1] < wide:
            return np.zeros((tall.shape[0], 0), dtype=bool), x0, y0
        return np.lib.stride_tricks.sliding_window_view(tall, wide, axis=1).all(axis=2), x0, y0

    def painted(self, box: Box) -> bool:
        """Whether anything but the background shows in a block of 2 by 2 pixels in `box`."""
        x0, y0 = max(int(np.floor(box.left * SCALE)), 0), max(int(np.floor(box.top * SCALE)), 0)
        x1, y1 = int(np.ceil(box.right * SCALE)) + 1, int(np.ceil(box.bottom * SCALE)) + 1
        far = (np.abs(self.pixels[y0:y1, x0:x1] - _rgb(BACKGROUND)) > LEVELS).any(axis=2)
        return bool((far[:-1, :-1] & far[1:, :-1] & far[:-1, 1:] & far[1:, 1:]).any())

    def region(self, place: Place) -> Box | None:
        plot = self.plots[place.panel]
        x, y = self.extent(place.x, "x", plot), self.extent(place.y, "y", plot)
        if x is None or y is None:
            return None
        return Box(x[0] - SLACK, y[0] - SLACK, x[1] + SLACK, y[1] + SLACK)

    def shows(self, place: Place) -> bool:
        box = self.region(place)
        if box is None:
            return False
        if place.inside is not None:
            ends = self.extent(place.inside, "y", self.plots[place.panel])
            assert ends is not None
            # Half a stroke and its antialiasing; the blocks reach a pixel above and two below.
            clear = 1.0
            assert (
                ends[0] + clear <= box.top - 1 / SCALE and box.bottom + 2 / SCALE <= ends[1] - clear
            ), f"{place.what} too thin to tell from its neighbours"
        wide = max(2, int(np.ceil(place.across * SCALE)))
        return bool(self.blocks(place.color, place.opacity, box, place.layers, wide)[0].any())

    def measure(self, place: Place) -> tuple[float, float] | None:
        """Where the place's color shows along its Measured axis, across the
        plot, at its other coordinate, and how sure that is: the far end of
        a bar's run, exactly; the middle of a line's run in the one pixel
        column (or row) at the place, give or take half that run, which a
        steep line makes long. None where it does not show."""
        plot = self.plots[place.panel]
        axis = "x" if isinstance(place.x, Measured) else "y"
        measured = place.x if axis == "x" else place.y
        assert isinstance(measured, Measured)
        other = self.extent(place.y if axis == "x" else place.x, "y" if axis == "x" else "x", plot)
        if other is None:
            return None
        if measured.bars:
            low, high = other[0] - SLACK, other[1] + SLACK
        else:
            low = high = (other[0] + other[1]) / 2
        if axis == "x":
            found, x0, y0 = self.blocks(
                place.color, place.opacity, Box(plot.left, low, plot.right, high)
            )
            along, origin = np.flatnonzero(found.any(axis=0)), x0
        else:
            box = Box(low, plot.top, high, plot.bottom)
            found, x0, y0 = self.blocks(
                place.color, place.opacity, box, wide=2 if measured.bars else 1
            )
            if not measured.bars:
                # The one column the place's x is in.
                column = int(np.floor(low * SCALE)) - x0
                found = found[:, column : column + 1]
            along, origin = np.flatnonzero(found.any(axis=1)), y0
        if len(along) == 0:
            return None
        if measured.bars:
            # Vertical bars rise from the bottom, horizontal ones from the left.
            return (origin + (along.max() if axis == "x" else along.min()) + 1) / SCALE, 0.0
        # A block's middle is the corner its pixels share.
        middle = (origin + float(np.median(along)) + 1) / SCALE
        return middle, (along.max() - along.min()) / SCALE / 2


def _drawn(svg: str, pixels: np.ndarray, chart: hg.Chart) -> Picture:
    spec, _ = chart.to_spec()
    return Picture(svg, pixels, [panel["id"] for panel in spec.get("panels", [])] or [""])


def svg_picture(chart: hg.Chart) -> tuple[str, Picture]:
    svg = chart.to_svg(fonts=FONTS)
    png = resvg_py.svg_to_bytes(
        svg_string=svg, zoom=SCALE, font_files=[str(FONT)], skip_system_fonts=True
    )
    return svg, _drawn(svg, np.asarray(Image.open(io.BytesIO(png)).convert("RGB")), chart)


def _tool(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        pytest.skip(f"{name} is not installed")
    return path


def pdf_picture(chart: hg.Chart, svg: str, directory: Path) -> tuple[Path, Picture]:
    """The chart's PDF, written in `directory`, and MuPDF's drawing of it,
    read through the SVG of the same layout."""
    file = directory / "chart.pdf"
    file.write_bytes(chart.to_pdf(fonts=FONTS))
    image = directory / "chart.ppm"
    subprocess.run(
        [
            _tool("mutool"),
            "draw",
            "-q",
            "-r",
            str(72 * SCALE * 4 / 3),
            "-F",
            "ppm",
            "-o",
            image,
            file,
        ],
        check=True,
        capture_output=True,
    )
    return file, _drawn(svg, np.asarray(Image.open(image).convert("RGB")), chart)


def is_measured(place: Place) -> bool:
    return isinstance(place.x, Measured) or isinstance(place.y, Measured)


def expect_ramp(picture: Picture, places: list[Place]) -> None:
    """Cells colored by value: the colorbar their colors are read from runs
    from the ramp's first color to its last, over the values' range."""
    values = [place.color.value for place in places if isinstance(place.color, Ramp)]
    if not values:
        return
    (low, high), ends = picture.colorbar_ends()
    assert (low, high) == (min(values), max(values)), "the colorbar's range"
    for color, at in zip(RAMP, ends, strict=True):
        assert (np.abs(at - _rgb(color)) <= LEVELS).all(), f"the colorbar ends in {at}, not {color}"


def expect_shown(picture: Picture, places: list[Place]) -> None:
    expect_ramp(picture, places)
    missing = [
        place.what for place in places if not is_measured(place) and not picture.shows(place)
    ]
    assert not missing, f"not drawn: {missing}"
    measured: dict[tuple[str, str], list[tuple[float, float, float, str, bool]]] = {}
    for place in places:
        for axis, coordinate in (("x", place.x), ("y", place.y)):
            if isinstance(coordinate, Measured):
                at = picture.measure(place)
                assert at is not None, f"not drawn: {place.what}"
                found = (coordinate.value, *at, place.what, coordinate.bars)
                measured.setdefault((place.panel, axis), []).append(found)
    # Values along an axis without labels: lines drawn by one linear map,
    # growing away from the axis's start; bars from the plot's edge, their
    # lengths in proportion to their values.
    for (panel, axis), found in measured.items():
        values, pixels, spreads = np.array([(v, p, d) for v, p, d, _, _ in found]).T
        plot = picture.plots[panel]
        if found[0][4]:
            lengths = pixels - plot.left if axis == "x" else plot.bottom - pixels
            assert len(np.unique(values)) >= 2, (panel, axis)
            slope = float(values @ lengths / (values @ values))
            off = np.abs(values * slope - lengths)
        else:
            assert len(np.unique(values)) >= 3, (panel, axis)
            slope, intercept = np.polyfit(values, pixels, 1)
            off = np.abs(values * slope + intercept - pixels)
            slope = slope if axis == "x" else -slope
        assert slope > 0, (panel, axis, slope)
        bad = [what for (*_, what, _), o, d in zip(found, off, spreads, strict=True) if o > 1.5 + d]
        assert not bad, f"drawn out of proportion: {bad}"


def expect_hidden(picture: Picture, recipe: Recipe, hidden: str, shown: tuple[str, ...]) -> None:
    """Series `hidden` left out of every plot, with each of its marks; the
    series `shown` drawn, after the axes and the dodging refit to them; and
    colors of no series only where the marks shown draw them."""
    tables = recipe.apart(recipe.rows)
    paints = {
        (place.color, place.opacity)
        for place in recipe.places(recipe.rows, tables, recipe.series)
        if place.series == hidden and place.color not in recipe.alone
    }
    assert paints, f"{hidden} draws nothing"
    for color, opacity in paints:
        for panel, plot in picture.plots.items():
            found = picture.blocks(color, opacity, plot)[0]
            at = "any opacity" if opacity is None else f"opacity {opacity}"
            assert not found.any(), f"{hidden}'s {color} at {at} in {panel or 'the plot'}"
    expect_shown(picture, recipe.places(recipe.rows, tables, shown))
    expect_alone(picture, recipe, shown)


def expect_alone(picture: Picture, recipe: Recipe, shown: tuple[str, ...]) -> None:
    """Colors of no series (error bars, a zero rule) only where the series `shown` draw them."""
    if recipe.extents is None:
        return
    extents = recipe.extents(recipe.rows, recipe.apart(recipe.rows), shown)
    for color in recipe.alone:
        for panel, plot in picture.plots.items():
            found, x0, y0 = picture.blocks(color, 1.0, plot)
            allowed = np.zeros_like(found)
            for place in extents:
                box = picture.region(place) if place.panel == panel else None
                if place.color != color or box is None:
                    continue
                left, top = (
                    int(np.floor(box.left * SCALE)) - x0,
                    int(np.floor(box.top * SCALE)) - y0,
                )
                right, bottom = (
                    int(np.ceil(box.right * SCALE)) - x0,
                    int(np.ceil(box.bottom * SCALE)) - y0,
                )
                allowed[max(top, 0) : bottom, max(left, 0) : right] = True
            stray = np.argwhere(found & ~allowed)
            where = [((x0 + x) / SCALE, (y0 + y) / SCALE) for y, x in stray[:3]]
            assert not len(stray), f"{color} drawn where no mark shown draws it, at {where}"


def expect_only(picture: Picture, panel: str, colors: list[str]) -> None:
    """Nothing in the panel's plot but the background and `colors`, and
    the blends of any two of them that antialiased edges draw."""
    plot = picture.plots[panel]
    # Within the plot's edges, where its axis lines are not.
    inner = Box(plot.left + 1, plot.top + 1, plot.right - 1, plot.bottom - 1)
    x0, y0 = int(np.ceil(inner.left * SCALE)), int(np.ceil(inner.top * SCALE))
    x1, y1 = int(np.floor(inner.right * SCALE)), int(np.floor(inner.bottom * SCALE))
    pixels = picture.pixels[y0:y1, x0:x1].astype(float)
    paints = [_rgb(BACKGROUND), *(_rgb(color) for color in colors)]
    nearest = np.full(pixels.shape[:2], np.inf)
    for i, a in enumerate(paints):
        for b in paints[i + 1 :]:
            nearest = np.minimum(nearest, _near(pixels, a, b, 0, 1))
    far = nearest > LEVELS
    stray = np.argwhere(far[:-1, :-1] & far[1:, :-1] & far[:-1, 1:] & far[1:, 1:])
    where = [((x0 + x) / SCALE, (y0 + y) / SCALE) for y, x in stray[:3]]
    assert not len(stray), f"{panel} draws more than {colors}, at {where}"


def expect_tables(got: Mapping[str, Mapping[str, Any]], expected: Tables) -> None:
    """Tables alike: names, columns, and their order; labels, counts, and
    row order exactly; numbers within rounding."""
    assert list(got) == list(expected)
    for name, columns in expected.items():
        assert list(got[name]) == list(columns), name
        for column, values in columns.items():
            actual, where = np.asarray(got[name][column]), f"{name} {column}"
            assert actual.shape == values.shape, where
            if values.dtype == object:
                assert list(actual) == list(values), where
            elif values.dtype.kind in "iu":
                assert actual.dtype.kind in "iu" and np.array_equal(actual, values), where
            else:
                np.testing.assert_allclose(actual, values, rtol=1e-9, atol=1e-12, err_msg=where)


# What a recipe draws, once per recipe ------------------------------------------------


class Drawn:
    """A recipe's charts and their pictures, made when a proof first asks."""

    def __init__(self, recipe: Recipe, directory: Path) -> None:
        self.recipe = recipe
        self.directory = directory
        self._made: dict[str, Any] = {}

    def _once(self, key: str, make: Callable[[], Any]) -> Any:
        if key not in self._made:
            self._made[key] = make()
        return self._made[key]

    @property
    def chart(self) -> hg.Chart:
        return self._once("chart", self.recipe.chart)

    @property
    def svg(self) -> tuple[str, Picture]:
        return self._once("svg", lambda: svg_picture(self.chart))

    @property
    def legend(self) -> tuple[str, list[str]]:
        """The legend's first button, as the live chart has it: its label,
        and the keys it hides."""

        def read() -> tuple[str, list[str]]:
            snapshot = self.chart.to_snapshot(id_prefix="express", fonts=FONTS)
            button = re.search(r'<button[^>]*title="Hide ([^"]*)"', snapshot["html"])
            assert button is not None, "the chart has a legend"
            entry = snapshot["state"]["legend"][0]
            return button[1], list(entry.get("targets", [entry["key"]]))

        return self._once("legend", read)

    @property
    def hidden_chart(self) -> hg.Chart:
        return self._once("hidden chart", lambda: self.recipe.chart(visibility=self.legend[1]))

    @property
    def hidden_svg(self) -> tuple[str, Picture]:
        return self._once("hidden svg", lambda: svg_picture(self.hidden_chart))

    def pdf(self, hidden: bool = False) -> tuple[Path, Picture]:
        chart, (svg, _) = (self.hidden_chart, self.hidden_svg) if hidden else (self.chart, self.svg)
        folder = self.directory / ("hidden" if hidden else "shown")
        folder.mkdir(exist_ok=True)
        return self._once(f"pdf {hidden}", lambda: pdf_picture(chart, svg, folder))


_DRAWN: dict[str, Drawn] = {}


@pytest.fixture
def drawn(request: pytest.FixtureRequest, tmp_path_factory: pytest.TempPathFactory) -> Drawn:
    """The recipe's drawings, kept while its cells run (they run together)."""
    recipe = RECIPES[request.node.callspec.params["recipe"]]
    if recipe.name not in _DRAWN:
        _DRAWN.clear()
        _DRAWN[recipe.name] = Drawn(recipe, tmp_path_factory.mktemp(recipe.name))
    return _DRAWN[recipe.name]


# The proofs --------------------------------------------------------------------------


def _hidden(drawn: Drawn) -> tuple[str, tuple[str, ...]]:
    """The series the legend's first button hides, and those left."""
    recipe = drawn.recipe
    label, _ = drawn.legend
    assert label == recipe.series[0], "the first entry names the first series"
    return label, recipe.series[1:]


#: The line beside a recipe.
BESIDE_ROWS = pd.DataFrame({"t": np.arange(6.0), "v": [1.0, 3.0, 2.0, 4.0, 3.0, 5.0]})


def _host(recipe: Recipe | None) -> hg.Chart:
    """A chart of two panels of one size: a line in "a", and the recipe, if any, in "b"."""
    host = hg.Chart(BESIDE_ROWS, theme=THEME, width=1000, height=360, legend=False)
    left, right = host.columns(2)
    left.panel("a").line(x="t", y="v", stroke=BESIDE)
    target = right.panel("b")
    if recipe is not None:
        assert recipe.draw(recipe.rows, panel=target) is host
    return host


def _without_panel(marks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {key: value for key, value in mark.items() if key not in ("panel", "data")}
        for mark in marks
    ]


def prove_placement(drawn: Drawn) -> None:
    """Every mark of the recipe in the panel named, as it draws alone, and
    drawn there at each of its places; the line in the other panel drawn,
    and nothing else there."""
    recipe = drawn.recipe
    host = _host(recipe)
    spec, _ = host.to_spec()
    ours = [mark for mark in spec["marks"] if mark.get("panel") == "b"]
    alone, _ = drawn.chart.to_spec()
    assert _without_panel(ours) == _without_panel(alone["marks"])
    expect_tables(hx.statistics(host, panel="b").tables, hx.statistics(drawn.chart).tables)
    assert [mark for mark in spec["marks"] if mark.get("panel") != "b"] == [
        {"type": "line", "x": "t", "y": "v", "stroke": BESIDE, "panel": "a", "data": "data"}
    ]
    _, picture = svg_picture(host)
    tables = recipe.apart(recipe.rows)
    expect_shown(
        picture,
        [replace(place, panel="b") for place in recipe.places(recipe.rows, tables, recipe.series)],
    )
    beside = [
        Place(f"the line at t={t:g}", t, v, BESIDE, panel="a")
        for t, v in BESIDE_ROWS.itertuples(index=False)
    ]
    expect_shown(picture, beside)
    expect_only(picture, "a", [BESIDE, GRID])


def prove_placement_refused(drawn: Drawn) -> None:
    recipe = drawn.recipe
    refusal = EXPRESS["recipes"][recipe.name]["refused"]["placement.panel"]["error"]
    chart = hg.Chart(recipe.rows)
    [cell] = chart.columns(1)
    with pytest.raises(hg.ChartError) as raised:
        recipe.draw(recipe.rows, panel=cell.panel("p"))
    assert (raised.value.code, raised.value.path, str(raised.value)) == (
        refusal["code"],
        refusal["path"],
        refusal["message"],
    )
    # Nothing was drawn in the chart asked.
    assert chart.to_spec()[0]["marks"] == []


def _unnumbered(svg: str) -> str:
    return re.sub(r"herceg-svg-\d+", "herceg-svg", svg)


def prove_toggle(drawn: Drawn) -> None:
    """The legend's first button, as the live chart draws it, hides every
    mark of what it names and nothing else, and its keys shown again draw
    it all as before. Its keys are those the button's click hides (the
    chart's hidden keys say so): the click itself is the browser's, proved
    for each of these marks by the engine's legend proofs."""
    recipe = drawn.recipe
    hidden, shown = _hidden(drawn)
    svg, picture = drawn.svg
    tables = recipe.apart(recipe.rows)
    expect_shown(picture, recipe.places(recipe.rows, tables, recipe.series))
    expect_hidden(drawn.hidden_svg[1], recipe, hidden, shown)
    # Its entry stays, to show it again: pressed no more.
    snapshot = drawn.hidden_chart.to_snapshot(id_prefix="express", fonts=FONTS)
    (button,) = re.findall(
        r'<button[^>]*title="Show ' + re.escape(hidden) + '"[^>]*>', snapshot["html"]
    )
    assert 'aria-pressed="false"' in button
    # Shown again, it is drawn as before (each export numbers its ids anew).
    again = recipe.chart(visibility=[]).to_svg(fonts=FONTS)
    assert _unnumbered(again) == _unnumbered(svg)


def prove_toggle_na(drawn: Drawn) -> None:
    """Cells colored by value, which a colorbar explains, and trees: no
    series, so no legend entry."""
    spec, _ = drawn.chart.to_spec()
    assert all("series" not in mark for mark in spec["marks"])
    assert drawn.chart.to_snapshot(id_prefix="express")["state"]["legend"] == []
    assert spec["marks"][0]["color"] == "value"


def _ink(text: Text) -> Box:
    """Where a text's glyphs are drawn, near its anchor and baseline."""
    if text.rotation:
        return Box(text.x - 5, text.y - 6, text.x + 5, text.y + 6)
    left = {"start": text.x, "middle": text.x - 4, "end": text.x - 8}[text.anchor]
    top = {"hanging": text.y, "middle": text.y - 4.5}.get(text.baseline or "", text.y - 9)
    return Box(left, top, left + 8, top + 9)


def live_texts(chart: hg.Chart) -> tuple[list[Text], list[tuple[str, float, float]]]:
    """The live chart's text, in the element the browser runtime builds for
    it (its snapshot): the texts it draws, and each legend button's label
    and place."""
    html = chart.to_snapshot(id_prefix="express", fonts=FONTS)["html"]
    drawing = re.search(r"<svg\b.*?</svg>", html, re.DOTALL)
    assert drawing is not None
    buttons = [
        (_decoded(re.findall(r">([^<>]+)</span>", inner)[-1]), float(left), float(top))
        for left, top, inner in re.findall(
            r"<button[^>]*?left:([\d.]+)px;top:([\d.]+)px[^>]*>(.*?)</button>", html, re.DOTALL
        )
    ]
    return texts_of(ET.fromstring(drawing[0]), ""), buttons


def expect_live_text(svg: str, picture: Picture, chart: hg.Chart) -> None:
    """The export writes the live chart's text, each in its place, and
    nothing else, and it is drawn there."""
    written = texts_of(ET.fromstring(svg))
    drawn, buttons = live_texts(chart)
    left = list(written)
    for text in drawn:
        assert text in left, f"the export leaves out the live chart's {text}"
        left.remove(text)
    # The legend's labels, beside their swatches.
    for label, x, y in buttons:
        found = [
            t for t in left if t.content == label and abs(t.y - y) < 0.5 and x <= t.x <= x + 20
        ]
        assert found, f"the export leaves out the legend's {label!r}"
        left.remove(found[0])
    assert not left, f"the export writes text the live chart does not: {left}"
    unseen = [
        text.content for text in written if text.content.strip() and not picture.painted(_ink(text))
    ]
    assert not unseen, f"texts not drawn: {unseen}"


def prove_svg(drawn: Drawn) -> None:
    """A well-formed SVG at the chart's size, drawing every mark at each of
    its places, with the live chart's text in its place, and leaving a
    hidden series out."""
    recipe = drawn.recipe
    svg, picture = drawn.svg
    root = ET.fromstring(svg)
    assert (root.get("width"), root.get("height")) == tuple(str(side) for side in recipe.size)
    tables = recipe.apart(recipe.rows)
    expect_shown(picture, recipe.places(recipe.rows, tables, recipe.series))
    expect_alone(picture, recipe, recipe.series)
    expect_live_text(svg, picture, drawn.chart)
    if recipe.series:
        hidden, shown = _hidden(drawn)
        svg, picture = drawn.hidden_svg
        expect_hidden(picture, recipe, hidden, shown)
        expect_live_text(svg, picture, drawn.hidden_chart)


_ENTITIES = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'"}


def _decoded(text: str) -> str:
    return re.sub(
        r"&(\w+|#x?[\da-f]+);",
        lambda m: (
            chr(int(m[1][2:], 16) if m[1].startswith("#x") else int(m[1][1:]))
            if m[1].startswith("#")
            else _ENTITIES[m[1]]
        ),
        text,
        flags=re.IGNORECASE,
    )


def _pdf_lines(file: Path, width: float) -> list[tuple[str, Box]]:
    """MuPDF's lines of text on a PDF's page (text reaching past it too),
    with their boxes in CSS pixels of a chart `width` across."""
    xml = subprocess.run(
        [_tool("mutool"), "draw", "-q", "-F", "stext", "-O", "clip=no", "-o", "-", file],
        check=True,
        capture_output=True,
    ).stdout.decode()
    page = re.search(r'<page [^>]*width="([\d.]+)"', xml)
    assert page is not None
    scale = width / float(page[1])
    lines = []
    for bbox, attributes, inner in re.findall(
        r'<line bbox="([^"]+)"([^>]*)>([\s\S]*?)</line>', xml
    ):
        # MuPDF 1.25 and later write a line's text; earlier ones only its characters.
        text = re.search(r'\btext="([^"]*)"', attributes)
        content = text[1] if text else "".join(re.findall(r'<char\b[^>]*?\bc="([^"]*)"', inner))
        x0, y0, x1, y1 = (float(v) * scale for v in bbox.split())
        lines.append((_decoded(content), Box(x0, y0, x1, y1)))
    return lines


def expect_pdf_text(file: Path, svg: str, picture: Picture, width: float) -> None:
    """Each text the SVG export writes, in MuPDF's text of the PDF, each
    occurrence in a line of its own place, and drawn there."""
    unread = _pdf_lines(file, width)
    for text in texts_of(ET.fromstring(svg)):
        content = text.content.strip()
        if not content:
            continue
        at = next(
            (
                i
                for i, (line, box) in enumerate(unread)
                if content in line
                and box.left - 4 <= text.x <= box.right + 4
                and box.top - 4 <= text.y <= box.bottom + 4
            ),
            None,
        )
        assert at is not None, f"the PDF leaves out {text}, or writes it elsewhere"
        line, box = unread[at]
        unread[at] = (line.replace(content, "", 1), box)
        assert picture.painted(_ink(text)), f"{content!r} not drawn in the PDF"


def prove_pdf(drawn: Drawn) -> None:
    """A document qpdf checks clean, at the chart's size, whose page MuPDF
    draws with every mark at each of its places, and with the text the SVG
    export writes, each where the SVG places it; and which leaves a hidden
    series out."""
    recipe = drawn.recipe
    width, height = recipe.size
    for hidden in (False, True) if recipe.series else (False,):
        file, picture = drawn.pdf(hidden)
        subprocess.run([_tool("qpdf"), "--check", file], check=True, capture_output=True)
        # A page of the chart's size: 3 pixels per CSS pixel, 3/4 of a point.
        box = re.search(rb"/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]", file.read_bytes())
        assert box is not None and [float(side) for side in box.groups()] == [
            width * 0.75,
            height * 0.75,
        ]
        assert picture.pixels.shape[:2] == (height * SCALE, width * SCALE)
        expect_pdf_text(file, (drawn.hidden_svg if hidden else drawn.svg)[0], picture, width)
        tables = recipe.apart(recipe.rows)
        if hidden:
            label, shown = _hidden(drawn)
            expect_hidden(picture, recipe, label, shown)
        else:
            expect_shown(picture, recipe.places(recipe.rows, tables, recipe.series))
            expect_alone(picture, recipe, recipe.series)


def prove_statistics(drawn: Drawn) -> None:
    """hx.statistics: what the recipe computed, as computed apart, alone
    and in a panel of another chart."""
    recipe = drawn.recipe
    expected = recipe.apart(recipe.rows)
    expect_tables(hx.statistics(drawn.chart).tables, expected)
    if declared("placement.panel", recipe.name) != "refused":
        expect_tables(hx.statistics(_host(recipe), panel="b").tables, expected)


def prove_recompute(drawn: Drawn) -> None:
    """hx.recompute from more rows: the statistics and every mark follow
    them, and a mark added to the chart reads the new table."""
    recipe = drawn.recipe
    data = joined(recipe.rows, recipe.more)
    again = hx.recompute(drawn.chart, data)
    tables = recipe.apart(data)
    expect_tables(hx.statistics(again).tables, tables)
    places = recipe.places(data, tables, recipe.series)
    _, picture = svg_picture(again)
    expect_shown(picture, places)
    # What changed shows: the chart before draws some of it nowhere.
    before = drawn.svg[1]
    labelled = [place for place in places if not is_measured(place)]
    assert not all(before.shows(place) for place in labelled), "the new rows changed nothing drawn"
    added = hx.recompute(recipe.added(recipe.chart()), data)
    _, picture = svg_picture(added)
    expect_shown(picture, recipe.added_places(recipe.more, tables))


#: Each capability's proof of each state a recipe declares it in.
PROOFS: dict[str, dict[str, Callable[[Drawn], None]]] = {
    "placement.panel": {"works": prove_placement, "refused": prove_placement_refused},
    "legend.toggle": {"works": prove_toggle, "na": prove_toggle_na},
    "export.svg": {"works": prove_svg},
    "export.pdf": {"works": prove_pdf},
    "express.statistics": {"works": prove_statistics},
    "express.recompute": {"works": prove_recompute},
}


@pytest.mark.parametrize(
    "recipe, capability",
    [
        pytest.param(
            recipe,
            capability,
            id=f"{RECIPES[recipe].id} {capability}",
            marks=pytest.mark.contract(f"{recipe}.{capability}.python"),
        )
        for recipe in EXPRESS["recipes"]
        for capability in EXPRESS["capabilities"]
    ],
)
def test_express_cell(recipe: str, capability: str, drawn: Drawn) -> None:
    state = declared(capability, recipe)
    assert state in PROOFS[capability], f"{recipe} {capability}: no proof of a cell {state}"
    PROOFS[capability][state](drawn)


# Charts of their own, and the statistics utility -------------------------------------


@pytest.mark.parametrize(
    "recipe",
    [
        pytest.param(name, id=name, marks=pytest.mark.contract(f"{name}.own-chart.python"))
        for name in ("pairplot", "jointplot", "clustermap")
    ],
)
def test_recipes_of_several_panels_draw_a_chart_of_their_own(recipe):
    spec, _ = RECIPES[recipe].chart().to_spec()
    panels = {panel["id"] for panel in spec["panels"]}
    # Every mark in one of the chart's own panels, which more than one mark shares.
    assert spec["marks"]
    assert {mark["panel"] for mark in spec["marks"]} <= panels
    assert len({mark["panel"] for mark in spec["marks"]}) > 1


#: Two observations of each t, so the estimate has an interval.
DATA = {"t": [0, 0, 1, 1, 2, 2], "v": [1.0, 3.0, 2.0, 4.0, 3.0, 5.0]}


@pytest.mark.contract("express.statistics.panels.python")
def test_statistics_by_panel_are_the_plot_drawn_there():
    chart = hg.Chart(DATA)
    left, right = chart.columns(2)
    hx.lineplot(DATA, x="t", y="v", panel=left.panel("a"))
    histograms = right.panel("b")
    hx.histplot(DATA, x="v", panel=histograms)
    # By id or by the panel itself.
    assert hx.statistics(chart, panel="a").function == "lineplot"
    assert hx.statistics(chart, panel=histograms).function == "histplot"
    # The chart's own statistics are its panels', which the refusal names.
    with pytest.raises(hg.ChartError) as raised:
        hx.statistics(chart)
    assert raised.value.path == "chart"
    assert str(raised.value) == (
        "hx.statistics chart: the chart's express plots are in its panels; "
        "name one with panel= ('a', 'b')"
    )


@pytest.mark.contract("express.statistics.refused.python")
def test_statistics_refuse_a_chart_no_recipe_made():
    with pytest.raises(hg.ChartError) as raised:
        hx.statistics(hg.Chart(DATA).line(x="t", y="v"))
    assert raised.value.path == "chart"
    assert str(raised.value) == (
        "hx.statistics chart: the chart was not made by a herceg.express function; "
        "give one an express function made"
    )
