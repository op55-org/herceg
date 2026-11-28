"""The capability proofs' fixtures of herceg.express (test_capabilities.py):
one per recipe, with its data, the rows a recompute adds, the call (a hue
where the recipe takes one), its statistics computed apart with NumPy and
pandas, and the places its marks draw at, read from those statistics.

Every fixture's hue is the column h, of the series p and q, which lie far
apart in value, so that no mark of one is drawn over the other's and each
color tells its series. Error bars are Seaborn's standard deviation,
standard error, and percentile intervals, which need no resampling to
compute; regplot's band is a row bootstrap, drawn here as Seaborn draws it.
A place is a point (or a narrow region) in data space where a color must
show within a couple of CSS pixels: it says where a mark draws, not how the
engine draws it."""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from statistics import NormalDist
from typing import Any

import numpy as np
import pandas as pd

import herceg as hg
import herceg.express as hx

FONT = Path(__file__).resolve().parents[2] / "packages/herceg/test/fixtures/pdf-fonts/sans.ttf"
#: One TrueType face for SVG and PDF alike, so both exports lay out the same,
#: by its own name, which resvg finds it by.
FAMILY = "Noto Sans"
FONTS = {FAMILY: FONT}
#: The series' colors, the theme's palette in order.
COLORS = {"p": "#1f5fbf", "q": "#c2410c"}
#: The dark grey of Express's error bars and zero rule on a light theme (Seaborn's).
NEUTRAL = "#424242"
#: The dendrograms' color: the theme's muted token.
MUTED = "#5d6677"
#: The opacity of box plots' points beyond their whiskers or letter values.
OUTLIERS = 0.75
#: Colors no recipe draws: a line beside a recipe, and a mark added to one.
BESIDE = "#2b8a3e"
ADDED = "#9c36b5"
#: The two ends of the clustermap's color ramp.
RAMP = ("#a5d8ff", "#1c2a6b")
BACKGROUND = "#ffffff"
GRID = "#e8ebf0"
THEME = hg.Theme(
    tokens=hg.Tokens(palette=list(COLORS.values()), background=BACKGROUND, grid=GRID, muted=MUTED),
    style=hg.Style(text=hg.TextStyle(font=FAMILY)),
)

Tables = dict[str, dict[str, np.ndarray]]


# Places ----------------------------------------------------------------------------


@dataclass(frozen=True)
class Band:
    """A category's band on a category axis; with `series`, its slot among
    the series `shown`, which dodging marks share 80% of the band among (as
    Seaborn's ``width=.8``). `half` narrows it to that many CSS pixels
    either side of the band's (or slot's) middle."""

    label: str
    series: str | None = None
    shown: tuple[str, ...] = ()
    half: float | None = None


@dataclass(frozen=True)
class Span:
    """Anywhere between two values."""

    low: float
    high: float


@dataclass(frozen=True)
class Mid:
    """Halfway between where two coordinates are drawn."""

    first: Coordinate
    second: Coordinate


@dataclass(frozen=True)
class Along:
    """A fraction of the way across the plot from its `edge`, `inset` CSS
    pixels further in: what a mark laid out against the plot's edges
    (rugs, dendrograms) draws at."""

    fraction: float
    edge: str
    inset: float = 0.0


@dataclass(frozen=True)
class Measured:
    """A value along an axis drawn without labels (a pairplot's diagonal
    densities, a jointplot's marginal counts): where the color shows along
    it is measured (the end of its run farthest from the axis's start for
    bars, its middle for lines), and the places of a plot must be drawn
    there by one linear map of their values."""

    value: float
    bars: bool = False


Coordinate = float | str | Band | Span | Mid | Along | Measured | None


@dataclass(frozen=True)
class Ramp:
    """The color a value takes on the chart's colorbar."""

    value: float


@dataclass(frozen=True)
class Place:
    """Where `color` (at `opacity`, over the background) must show: a mark's
    series drawn at `x` and `y` in panel `panel` ("" for a chart of one
    plot). A coordinate of None is anywhere across the plot. An opacity of
    None is any from a fifth to almost all (boxen levels, lighter
    outwards). Shapes of one color drawn over each other darken it
    (outliers of one box), `layers` of them at most; `across` is how wide,
    in CSS pixels, the color must be (a box over a thinner line of its
    color)."""

    what: str
    x: Coordinate
    y: Coordinate
    color: str | Ramp
    opacity: float | None = 1.0
    panel: str = ""
    series: str | None = None
    layers: int = 1
    across: float = 0.0
    #: The values a fill spans along y, which its probe must lie within,
    #: clear of the strokes on its edges: a fill too thin for that, whose
    #: neighbours' paint would reach the probe, fails the fixture.
    inside: Span | None = None


@dataclass(frozen=True)
class Recipe:
    """A recipe's fixture.

    - ``draw(data, **options)`` makes it (``options``: the chart's, or
      ``panel=``), with the hue h where it takes one; `series` are what
      its legend lists, in order.
    - ``apart(data)`` is what ``hx.statistics`` must give, computed here.
    - ``places(data, tables, shown)`` are where its marks draw, from the
      tables ``apart`` computed, for the series `shown`.
    - ``extents`` are where colors of `alone` may show at all: marks drawn
      in a color of no series, which hiding a series must remove too.
    - ``added`` adds a mark reading the recipe's own table, which a
      recompute must make read the new one, and ``added_places`` are where
      it draws for the rows `more` adds.
    """

    name: str
    fixture: str
    rows: pd.DataFrame
    more: pd.DataFrame
    draw: Callable[..., hg.Chart]
    apart: Callable[[pd.DataFrame], Tables]
    places: Callable[[pd.DataFrame, Tables, tuple[str, ...]], list[Place]]
    added: Callable[[hg.Chart], hg.Chart]
    added_places: Callable[[pd.DataFrame, Tables], list[Place]]
    series: tuple[str, ...] = ("p", "q")
    extents: Callable[[pd.DataFrame, Tables, tuple[str, ...]], list[Place]] | None = None
    alone: frozenset[str] = frozenset()
    size: tuple[int, int] = (640, 320)
    #: Options of the chart it draws as a recipe of the chart's own; not given with panel=.
    chart_options: dict[str, Any] = field(default_factory=dict)

    @property
    def id(self) -> str:
        return f"{self.name}:{self.fixture}"

    def chart(self, data: pd.DataFrame | None = None, **options: Any) -> hg.Chart:
        """The recipe as a chart of its own, in the theme's font and colors."""
        width, height = self.size
        return self.draw(
            self.rows if data is None else data,
            theme=THEME,
            width=width,
            height=height,
            **self.chart_options,
            **options,
        )


def joined(rows: pd.DataFrame, more: pd.DataFrame) -> pd.DataFrame:
    return pd.concat([rows, more], ignore_index=True)


# Shared statistics, computed apart ------------------------------------------------


def levels(values: pd.Series) -> list[Any]:
    """A variable's levels as Seaborn orders them: numbers ascending,
    others in order of appearance."""
    unique = pd.unique(values)
    return sorted(unique) if pd.api.types.is_numeric_dtype(values) else list(unique)


def groups(frame: pd.DataFrame, by: Sequence[str]) -> list[tuple[tuple[Any, ...], pd.DataFrame]]:
    """The frame's groups by `by`, series first, each variable in its levels' order."""
    found = []

    def split(part: pd.DataFrame, rest: Sequence[str], key: tuple[Any, ...]) -> None:
        if not rest:
            found.append((key, part))
            return
        for level in levels(frame[rest[0]]):
            chosen = part[part[rest[0]] == level]
            if len(chosen):
                split(chosen, rest[1:], (*key, level))

    split(frame, by, ())
    return found


def labels(values: Sequence[Any]) -> np.ndarray:
    return np.array([str(value) for value in values], dtype=object)


def estimates(
    frame: pd.DataFrame, x: str, y: str, interval: Callable[[np.ndarray], tuple[float, float]]
) -> Tables:
    """Means of y by series and x, with an interval of each group's values."""
    keys, means, lows, highs, counts = [], [], [], [], []
    for key, part in groups(frame, ["h", x]):
        values = part[y].to_numpy(float)
        low, high = interval(values)
        keys.append(key)
        means.append(values.mean())
        lows.append(low)
        highs.append(high)
        counts.append(len(values))
    xs = [key[1] for key in keys]
    return {
        "estimates": {
            "h": labels([key[0] for key in keys]),
            x: labels(xs) if isinstance(xs[0], str) else np.array(xs, float),
            y: np.array(means),
            "low": np.array(lows),
            "high": np.array(highs),
            "n": np.array(counts, float),
        }
    }


def sd(values: np.ndarray) -> tuple[float, float]:
    half = values.std(ddof=1)
    return values.mean() - half, values.mean() + half


def se(values: np.ndarray) -> tuple[float, float]:
    half = values.std(ddof=1) / math.sqrt(len(values))
    return values.mean() - half, values.mean() + half


def middle_ninety(values: np.ndarray) -> tuple[float, float]:
    low, high = np.percentile(values, [5, 95])
    return float(low), float(high)


def tukey(values: np.ndarray) -> dict[str, float]:
    """A box: quartiles, whiskers at the extreme values within 1.5 IQR of
    it, and how many values lie beyond them."""
    q1, median, q3 = np.percentile(values, [25, 50, 75])
    reach = 1.5 * (q3 - q1)
    inside = values[(values >= q1 - reach) & (values <= q3 + reach)]
    low, high = inside.min(), inside.max()
    beyond = np.count_nonzero((values < low) | (values > high))
    return {
        "low": low,
        "q1": q1,
        "median": median,
        "q3": q3,
        "high": high,
        "n": float(len(values)),
        "outliers": float(beyond),
    }


def boxes(frame: pd.DataFrame, name: str) -> Tables:
    rows = [(key, tukey(part["v"].to_numpy(float))) for key, part in groups(frame, ["h", "g"])]
    table = {
        "h": labels([key[0] for key, _ in rows]),
        "g": labels([key[1] for key, _ in rows]),
    }
    for column in ("low", "q1", "median", "q3", "high", "n", "outliers"):
        table[column] = np.array([box[column] for _, box in rows])
    return {name: table}


def kde(values: np.ndarray, size: int = 200, cut: float = 3) -> tuple[np.ndarray, np.ndarray]:
    """A Gaussian kernel density with Scott's bandwidth (the sample's
    deviation times n^(-1/5)), on `size` points reaching `cut` bandwidths
    past the extreme values."""
    bandwidth = values.std(ddof=1) * len(values) ** (-1 / 5)
    grid = np.linspace(values.min() - cut * bandwidth, values.max() + cut * bandwidth, size)
    z = (grid[:, None] - values[None, :]) / bandwidth
    density = np.exp(-0.5 * z**2).sum(axis=1) / (len(values) * bandwidth * math.sqrt(2 * math.pi))
    return grid, density


def densities(frame: pd.DataFrame, column: str) -> dict[str, np.ndarray]:
    keys, grids, values = [], [], []
    for (level,), part in groups(frame, ["h"]):
        grid, density = kde(part[column].to_numpy(float))
        keys += [level] * len(grid)
        grids.append(grid)
        values.append(density)
    return {"h": labels(keys), column: np.concatenate(grids), "density": np.concatenate(values)}


def histogram_counts(values: np.ndarray, edges: np.ndarray) -> np.ndarray:
    return np.histogram(values, edges)[0].astype(float)


def peaks(
    table: dict[str, np.ndarray], column: str, series: str, every: int = 8, floor: float = 0.1
) -> list[tuple[float, float]]:
    """Points of a series' density curve where it rises above `floor` of
    its peak, a few grid points apart: away from the tails, where curves of
    both series run along the axis together."""
    chosen = table["h"] == series
    xs, ys = table[column][chosen], table["density"][chosen]
    keep = np.flatnonzero(ys >= floor * ys.max())[::every]
    return [(float(xs[i]), float(ys[i])) for i in keep]


def rows_of(frame: pd.DataFrame, shown: Sequence[str]) -> pd.DataFrame:
    return frame[frame["h"].isin(shown)]


# Data --------------------------------------------------------------------------------


def _categories(seed: int, per: int, effects: dict[str, float]) -> pd.DataFrame:
    """`per` values of v for each category and series: p near 3, q near 9,
    each category moving both."""
    random = np.random.default_rng(seed)
    frames = []
    for category, effect in effects.items():
        for series, center in (("p", 3.0), ("q", 9.0)):
            values = center + effect + random.normal(0, 0.7, per)
            frames.append(pd.DataFrame({"g": category, "h": series, "v": np.round(values, 3)}))
    return pd.concat(frames, ignore_index=True)


CATEGORIES = _categories(1, 32, {"a": 0.0, "b": 1.5, "c": -1.0})
# The greatest value of q in "b" moved far out: a box plot's outlier.
CATEGORIES.loc[CATEGORIES[(CATEGORIES.g == "b") & (CATEGORIES.h == "q")].v.idxmax(), "v"] = 14.5
#: A recompute's rows: a fourth category, and q of "a" moved up.
MORE_CATEGORIES = pd.concat(
    [
        _categories(2, 8, {"d": 0.5}),
        pd.DataFrame({"g": "a", "h": "q", "v": np.round(np.linspace(12.5, 13.5, 24), 3)}),
    ],
    ignore_index=True,
)


def _quantiles(
    per: int, effects: dict[str, float], centers: dict[str, float] | None = None
) -> pd.DataFrame:
    """`per` values of v for each category and series, at evenly spaced
    quantiles of a normal spread around p near 4 and q near 10, each
    category moving both: the boxes of a boxen plot of them, from a letter
    value to the next, all tall enough to tell apart."""
    frames = []
    for category, effect in effects.items():
        for series, center in (centers or {"p": 4.0, "q": 10.0}).items():
            quantile = NormalDist(center + effect, 1.3).inv_cdf
            values = [quantile((i + 0.5) / per) for i in range(per)]
            frames.append(pd.DataFrame({"g": category, "h": series, "v": np.round(values, 3)}))
    return pd.concat(frames, ignore_index=True)


QUANTILES = _quantiles(32, {"a": 0.0, "b": 1.5, "c": -1.0})
#: A recompute's rows: a fourth category, and more of q in "a", higher.
MORE_QUANTILES = pd.concat(
    [_quantiles(8, {"d": 0.5}), _quantiles(24, {"a": 4.0}, {"q": 10.0})], ignore_index=True
)


def _times(seed: int, ts: Sequence[float]) -> pd.DataFrame:
    random = np.random.default_rng(seed)
    frames = []
    for t in ts:
        for series, start, slope in (("p", 2.0, 0.6), ("q", 10.0, 0.4)):
            values = start + slope * t + random.normal(0, 1.0, 8)
            frames.append(pd.DataFrame({"t": float(t), "h": series, "v": np.round(values, 3)}))
    return pd.concat(frames, ignore_index=True)


TIMES = _times(4, range(6))
MORE_TIMES = _times(5, [6])


def _spread(seed: int, n: int, centers: dict[str, float]) -> pd.DataFrame:
    random = np.random.default_rng(seed)
    return pd.concat(
        [
            pd.DataFrame({"h": series, "v": np.round(random.normal(center, 0.8, n), 3)})
            for series, center in centers.items()
        ],
        ignore_index=True,
    )


VALUES = _spread(6, 60, {"p": 3.0, "q": 11.0})
MORE_VALUES = _spread(7, 20, {"q": 14.0})


def _pairs(seed: int, n: int, lines: dict[str, tuple[float, float]]) -> pd.DataFrame:
    random = np.random.default_rng(seed)
    frames = []
    for series, (start, slope) in lines.items():
        x = np.round(np.sort(random.uniform(0, 10, n)), 3)
        y = np.round(start + slope * x + random.normal(0, 0.6, n), 3)
        frames.append(pd.DataFrame({"x": x, "y": y, "h": series}))
    return pd.concat(frames, ignore_index=True)


PAIRS = _pairs(8, 25, {"p": (1.0, 0.5), "q": (12.0, 0.3)})
MORE_PAIRS = _pairs(9, 10, {"q": (14.0, 0.8)}).assign(x=lambda f: f.x + 10)

_curve = np.random.default_rng(10)
CURVED = pd.DataFrame({"x": np.round(np.sort(_curve.uniform(0, 10, 40)), 3)})
CURVED["y"] = np.round(0.3 * CURVED.x**2 + _curve.normal(0, 1.0, 40), 3)
MORE_CURVED = pd.DataFrame({"x": [11.0, 11.5, 12.0, 12.5], "y": [40.0, 42.0, 44.0, 46.0]})


def _clusters(seed: int, n: int, centers: dict[str, tuple[float, float]]) -> pd.DataFrame:
    random = np.random.default_rng(seed)
    return pd.concat(
        [
            pd.DataFrame(
                {
                    "a": np.round(random.normal(a, 0.6, n), 3),
                    "b": np.round(random.normal(b, 0.6, n), 3),
                    "h": series,
                }
            )
            for series, (a, b) in centers.items()
        ],
        ignore_index=True,
    )


CLUSTERS = _clusters(11, 30, {"p": (2.0, 3.0), "q": (8.0, 9.0)})
MORE_CLUSTERS = _clusters(12, 10, {"q": (11.0, 12.0)})
#: The same pairs as x and y, their least x first: a row the margins' edges depend on.
JOINT = CLUSTERS.rename(columns={"a": "x", "b": "y"}).sort_values("x", ignore_index=True)

#: A matrix without ties: rows r1 and r2 close, r3 and r4 close; columns a and c close.
MATRIX = pd.DataFrame(
    {
        "r": ["r1", "r2", "r3", "r4"],
        "a": [0.0, 1.0, 0.0, 0.0],
        "b": [0.0, 0.0, 5.0, 5.0],
        "c": [0.0, 0.0, 0.0, 2.0],
    }
)
MORE_MATRIX = pd.DataFrame({"r": ["r5"], "a": [1.0], "b": [6.0], "c": [3.0]})


# Clustering, computed apart ----------------------------------------------------------


def average_linkage(points: np.ndarray) -> np.ndarray:
    """Average linkage of euclidean distances, as SciPy's rows: the two
    clusters merged (the smaller id first; merge k makes cluster n + k),
    their distance, and the merged cluster's size."""
    clusters = {i: [i] for i in range(len(points))}
    distance = np.sqrt(((points[:, None, :] - points[None, :, :]) ** 2).sum(axis=2))
    merges = []
    for k in range(len(points) - 1):
        ids = sorted(clusters)
        _, first, second = min(
            (distance[np.ix_(clusters[i], clusters[j])].mean(), i, j)
            for n, i in enumerate(ids)
            for j in ids[n + 1 :]
        )
        height = distance[np.ix_(clusters[first], clusters[second])].mean()
        members = clusters.pop(first) + clusters.pop(second)
        clusters[len(points) + k] = members
        merges.append((first, second, height, len(members)))
    return np.array(merges, dtype=float)


def leaf_order(merges: np.ndarray, n: int) -> list[int]:
    """The leaves left to right, each merge's first cluster before its
    second (SciPy's leaves_list)."""

    def leaves(cluster: int) -> list[int]:
        if cluster < n:
            return [cluster]
        first, second = merges[cluster - n, :2].astype(int)
        return leaves(first) + leaves(second)

    return leaves(2 * n - 2)


def linkage_table(merges: np.ndarray) -> dict[str, np.ndarray]:
    return {
        "first": merges[:, 0].astype(np.int64),
        "second": merges[:, 1].astype(np.int64),
        "height": merges[:, 2],
        "size": merges[:, 3].astype(np.int64),
    }


def clustering(frame: pd.DataFrame) -> Tables:
    columns = ["a", "b", "c"]
    matrix = frame[columns].to_numpy(float)
    rows, cols = average_linkage(matrix), average_linkage(matrix.T)
    return {
        "matrix": {
            **{column: frame[column].to_numpy(float) for column in columns},
            "r": labels(frame["r"]),
        },
        "row order": {"r": labels(frame["r"].to_numpy()[leaf_order(rows, len(matrix))])},
        "column order": {"column": labels(np.array(columns)[leaf_order(cols, len(columns))])},
        "column linkage": linkage_table(cols),
        "row linkage": linkage_table(rows),
    }


# The recipes -----------------------------------------------------------------------


def _lineplot_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    places = []
    e = tables["estimates"]
    for i in np.flatnonzero(np.isin(e["h"], shown)):
        h, t, v, low = e["h"][i], e["t"][i], e["v"][i], e["low"][i]
        places.append(Place(f"{h}'s line at t={t:g}", t, v, COLORS[h], series=h))
        # The band halfway from its low end to the line through it.
        places.append(Place(f"{h}'s band at t={t:g}", t, (low + v) / 2, COLORS[h], 0.2, series=h))
    return places


def _bar_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    places = []
    e = tables["estimates"]
    for i in np.flatnonzero(np.isin(e["h"], shown)):
        h, g, v = e["h"][i], e["g"][i], e["v"][i]
        slot = Band(g, h, shown)
        places.append(Place(f"{h}'s bar of {g}", slot, v / 2, COLORS[h], series=h))
        stem = Band(g, h, shown, half=0)
        mid = (e["low"][i] + e["high"][i]) / 2
        places.append(Place(f"{h}'s error bar of {g}", stem, mid, NEUTRAL, series=h))
    return places


def _bar_extents(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    """Error bars and their caps, each on its series' bar."""
    e = tables["estimates"]
    return [
        Place(
            f"{e['h'][i]}'s error bar of {e['g'][i]}",
            Band(e["g"][i], e["h"][i], shown, half=6),
            Span(e["low"][i], e["high"][i]),
            NEUTRAL,
        )
        for i in np.flatnonzero(np.isin(e["h"], shown))
    ]


def _point_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    places = []
    e = tables["estimates"]
    for h in shown:
        chosen = np.flatnonzero(e["h"] == h)
        for i in chosen:
            g, color = e["g"][i], COLORS[h]
            places.append(
                Place(f"{h}'s estimate of {g}", Band(g, half=0), e["v"][i], color, series=h)
            )
            # The low cap, far enough below the point drawn at the estimate.
            cap = Band(g, half=3)
            places.append(Place(f"{h}'s error bar of {g}", cap, e["low"][i], color, series=h))
        for i, j in zip(chosen[:-1], chosen[1:], strict=True):
            between = Mid(Band(e["g"][i], half=0), Band(e["g"][j], half=0))
            what = f"{h}'s line from {e['g'][i]} to {e['g'][j]}"
            places.append(Place(what, between, Mid(e["v"][i], e["v"][j]), COLORS[h], series=h))
    return places


def _value_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    """Each row's point, anywhere across its category's band (jittered or packed)."""
    values = tables["values"]
    return [
        Place(f"{h}'s point {v:g} of {g}", Band(g), v, COLORS[h], series=h)
        for h, g, v in zip(values["h"], values["g"], values["v"], strict=True)
        if h in shown
    ]


def _outliers(frame: pd.DataFrame, h: str, g: str, low: float, high: float) -> np.ndarray:
    values = frame[(frame.h == h) & (frame.g == g)]["v"].to_numpy(float)
    return values[(values < low) | (values > high)]


def _box_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    places = []
    b = tables["boxes"]
    for i in np.flatnonzero(np.isin(b["h"], shown)):
        h, g = b["h"][i], b["g"][i]
        inside, stem = Band(g, h, shown, half=8), Band(g, h, shown, half=0)
        color = COLORS[h]
        q1, median, q3 = b["q1"][i], b["median"][i], b["q3"][i]
        places += [
            Place(f"{h}'s box of {g}", inside, (q1 + median) / 2, color, 0.25, series=h),
            Place(f"{h}'s median of {g}", inside, median, color, series=h),
            Place(f"{h}'s lower whisker of {g}", stem, (b["low"][i] + q1) / 2, color, series=h),
            Place(f"{h}'s upper whisker of {g}", stem, (q3 + b["high"][i]) / 2, color, series=h),
        ]
        for value in _outliers(frame, h, g, b["low"][i], b["high"][i]):
            what = f"{h}'s outlier {value:g} of {g}"
            places.append(Place(what, stem, value, color, OUTLIERS, series=h, layers=3))
    return places


def _letter_values(frame: pd.DataFrame) -> Tables:
    """Seaborn's letter values by Tukey's depth rule: log2(n) - 3 levels
    each side (at least 1), the 2^-(k+1) and 1 - 2^-(k+1) quantiles of
    level k; the boxes between each two letter values in turn, level 1
    the quartiles', and the values beyond the outermost."""
    boxes: dict[str, list[Any]] = {"h": [], "g": [], "level": [], "low": [], "high": []}
    found: dict[str, list[Any]] = {
        "h": [],
        "g": [],
        "median": [],
        "n": [],
        "levels": [],
        "outliers": [],
    }
    for (h, g), part in groups(frame, ["h", "g"]):
        values = part["v"].to_numpy(float)
        depth = max(int(np.log2(len(values))) - 3, 1)
        tails = 0.5 ** np.arange(depth + 1, 1, -1)
        letters = np.percentile(values, 100 * np.concatenate([tails, 1 - tails[::-1]]))
        for i in range(2 * depth - 1):
            level = depth - min(i, 2 * depth - 2 - i)
            for column, value in zip(
                boxes, (h, g, float(level), letters[i], letters[i + 1]), strict=True
            ):
                boxes[column].append(value)
        beyond = np.count_nonzero((values < letters[0]) | (values > letters[-1]))
        row = (h, g, float(np.median(values)), float(len(values)), float(depth), float(beyond))
        for column, value in zip(found, row, strict=True):
            found[column].append(value)

    def table(columns: dict[str, list[Any]]) -> dict[str, np.ndarray]:
        return {
            name: labels(values) if name in ("h", "g") else np.array(values)
            for name, values in columns.items()
        }

    return {"boxes": table(boxes), "groups": table(found)}


def _boxen_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    """Each box between two letter values, filled, and its edges; and the
    values beyond the outermost."""
    places = []
    b, found = tables["boxes"], tables["groups"]
    medians = dict(zip(zip(found["h"], found["g"], strict=True), found["median"], strict=True))
    for i in np.flatnonzero(np.isin(b["h"], shown)):
        h, g, level = b["h"][i], b["g"][i], int(b["level"][i])
        edge = Band(g, h, shown, half=2)
        low, high, median = b["low"][i], b["high"][i], medians[h, g]
        # The box the median's line crosses, below that line.
        high = median if low < median < high else high
        what = f"{h}'s level {level} box from {low:.2f} of {g}"
        fill = Place(
            what, edge, (low + high) / 2, COLORS[h], None, series=h, inside=Span(low, high)
        )
        places.append(fill)
        for end in ("low", "high"):
            what = f"{h}'s level {level} {end} edge of {g}"
            places.append(Place(what, edge, b[end][i], COLORS[h], series=h))
    for (h, g), _ in groups(rows_of(frame, shown), ["h", "g"]):
        chosen = (b["h"] == h) & (b["g"] == g)
        low, high = b["low"][chosen].min(), b["high"][chosen].max()
        for value in _outliers(frame, h, g, low, high):
            stem, what = Band(g, h, shown, half=0), f"{h}'s outlier {value:g} of {g}"
            places.append(Place(what, stem, value, COLORS[h], OUTLIERS, series=h, layers=3))
    return places


def _violin_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    places = []
    b = tables["quartiles"]
    for i in np.flatnonzero(np.isin(b["h"], shown)):
        h, g = b["h"][i], b["g"][i]
        color = COLORS[h]
        q1, median, q3 = b["q1"][i], b["median"][i], b["q3"][i]
        # The box's longer half, away from the dot at the median; wider than the whisker drawn
        # through it.
        inside = (q1 + median) / 2 if median - q1 >= q3 - median else (median + q3) / 2
        box = Band(g, h, shown, half=1)
        stem = Band(g, h, shown, half=0)
        places += [
            # The density across its slot at the median, around the box.
            Place(f"{h}'s density of {g}", Band(g, h, shown), median, color, 0.25, series=h),
            Place(f"{h}'s box of {g}", box, inside, color, series=h, across=3),
            Place(f"{h}'s whisker of {g}", stem, (b["low"][i] + q1) / 2, color, series=h),
        ]
    return places


def _histogram(frame: pd.DataFrame) -> Tables:
    values = frame["v"].to_numpy(float)
    edges = np.histogram_bin_edges(values, "auto")
    series, lefts, rights, heights = [], [], [], []
    for (h,), part in groups(frame, ["h"]):
        series += [h] * (len(edges) - 1)
        lefts.append(edges[:-1])
        rights.append(edges[1:])
        heights.append(histogram_counts(part["v"].to_numpy(float), edges))
    return {
        "edges": {"edges": edges},
        "bins": {
            "h": labels(series),
            "left": np.concatenate(lefts),
            "right": np.concatenate(rights),
            "height": np.concatenate(heights),
        },
    }


def overlaid(shown: tuple[str, ...]) -> float:
    """Histogram bars' opacity: series shown over each other are translucent."""
    return 0.5 if len(shown) > 1 else 1.0


def _histogram_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    b = tables["bins"]
    return [
        Place(
            f"{b['h'][i]}'s bin from {b['left'][i]:.2f}",
            (b["left"][i] + b["right"][i]) / 2,
            b["height"][i] / 2,
            COLORS[b["h"][i]],
            overlaid(shown),
            series=b["h"][i],
        )
        for i in np.flatnonzero(np.isin(b["h"], shown) & (b["height"] > 0))
    ]


def _kde_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    density = tables["density"]
    return [
        Place(f"{h}'s density at {x:.2f}", x, y, COLORS[h], series=h)
        for h in shown
        for x, y in peaks(density, "v", h)
    ]


def _ecdf(frame: pd.DataFrame) -> Tables:
    """Each series' distinct values, and the share of its values at or below each."""
    keys, xs, ps = [], [], []
    for (h,), part in groups(frame, ["h"]):
        values = part["v"].to_numpy(float)
        distinct = np.unique(values)
        keys += [h] * len(distinct)
        xs.append(distinct)
        ps.append(np.array([np.count_nonzero(values <= v) for v in distinct]) / len(values))
    return {"ecdf": {"h": labels(keys), "v": np.concatenate(xs), "Probability": np.concatenate(ps)}}


def _ecdf_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    """Each step after a value, halfway to the next."""
    e = tables["ecdf"]
    places = []
    for h in shown:
        chosen = np.flatnonzero(e["h"] == h)
        for i, j in zip(chosen[:-1], chosen[1:], strict=True):
            x = (e["v"][i] + e["v"][j]) / 2
            places.append(
                Place(f"{h}'s step at {e['v'][i]:.2f}", x, e["Probability"][i], COLORS[h], series=h)
            )
    return places


def _rug_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    """Each value's tick, whole: the axis leaves room past the least and
    greatest for theirs."""
    values = tables["values"]
    return [
        Place(f"{h}'s tick at {v:g}", v, Along(0, "bottom", inset=4), COLORS[h], series=h)
        for h, v in zip(values["h"], values["v"], strict=True)
        if h in shown
    ]


def _regression(frame: pd.DataFrame, n_boot: int = 100, seed: int = 3) -> Tables:
    """Least-squares lines by series on 100 points across each series' x,
    and 95% bands of the lines fit to `n_boot` resamples of the rows, drawn
    as Seaborn draws them: from a generator seeded alike for each series,
    each resample n draws of a row."""
    fit: dict[str, list[np.ndarray]] = {"h": [], "x": [], "y": [], "low": [], "high": []}
    coefficients: dict[str, list[float]] = {"group": [], "x^0": [], "x^1": []}
    for index, ((h,), part) in enumerate(groups(frame, ["h"])):
        x, y = part["x"].to_numpy(float), part["y"].to_numpy(float)
        grid = np.linspace(x.min(), x.max(), 100)
        slope, intercept = np.polyfit(x, y, 1)
        random = np.random.default_rng(seed)
        lines = np.empty((n_boot, len(grid)))
        for b in range(n_boot):
            rows = random.integers(0, len(x), len(x))
            lines[b] = np.polyval(np.polyfit(x[rows], y[rows], 1), grid)
        low, high = np.nanpercentile(lines, [2.5, 97.5], axis=0)
        for column, values in zip(
            fit, (labels([h] * len(grid)), grid, intercept + slope * grid, low, high), strict=True
        ):
            fit[column].append(values)
        coefficients["group"].append(index)
        coefficients["x^0"].append(intercept)
        coefficients["x^1"].append(slope)
    return {
        "fit": {column: np.concatenate(parts) for column, parts in fit.items()},
        "coefficients": {
            "group": np.array(coefficients["group"], dtype=np.int64),
            "x^0": np.array(coefficients["x^0"]),
            "x^1": np.array(coefficients["x^1"]),
        },
    }


def _regression_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    f, c = tables["fit"], tables["coefficients"]
    lines = dict(zip(pd.unique(frame.h), zip(c["x^0"], c["x^1"], strict=True), strict=True))
    # The points off the fit line drawn through them in their color.
    places = [
        Place(f"{h}'s point ({x:g}, {y:g})", x, y, COLORS[h], series=h)
        for x, y, h in frame[["x", "y", "h"]].itertuples(index=False)
        if h in shown and abs(y - lines[h][0] - lines[h][1] * x) >= 0.4
    ]
    for h in shown:
        xs = frame[frame.h == h]["x"].to_numpy(float)
        # Every fifth grid point well away from the series' points, which are drawn over both.
        for i in np.flatnonzero(f["h"] == h)[::5]:
            x = f["x"][i]
            if np.abs(xs - x).min() < 0.15:
                continue
            places.append(Place(f"{h}'s fit at {x:.2f}", x, f["y"][i], COLORS[h], series=h))
            band = (f["low"][i] + f["y"][i]) / 2
            places.append(Place(f"{h}'s band at {x:.2f}", x, band, COLORS[h], 0.2, series=h))
    return places


def _residuals(frame: pd.DataFrame) -> Tables:
    x, y = frame["x"].to_numpy(float), frame["y"].to_numpy(float)
    return {"residuals": {"x": x, "residual": y - np.polyval(np.polyfit(x, y, 1), x)}}


#: The residual points' legend entry, which names them as one series.
RESIDUALS = "y residual"


def _residual_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    r = tables["residuals"]
    places = [
        Place(f"the residual at {x:g}", x, y, COLORS["p"], series=RESIDUALS)
        for x, y in zip(r["x"], r["residual"], strict=True)
        if RESIDUALS in shown
    ]
    # The dashed zero rule, which hiding the residuals leaves, between the points.
    for x in np.linspace(r["x"].min(), r["x"].max(), 9)[1:-1]:
        if np.abs(r["x"] - x).min() >= 0.25:
            places.append(
                Place(f"the zero rule at {x:.2f}", Span(x - 0.05, x + 0.05), 0.0, NEUTRAL)
            )
    return places


def _residual_extents(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    return [Place("the zero rule", None, 0.0, NEUTRAL)]


def _pair_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    places = []
    for a, b, h in rows_of(frame, shown)[["a", "b", "h"]].itertuples(index=False):
        places.append(Place(f"{h}'s point ({a:g}, {b:g})", a, b, COLORS[h], panel="1,0", series=h))
        places.append(Place(f"{h}'s point ({b:g}, {a:g})", b, a, COLORS[h], panel="0,1", series=h))
    for column, panel in (("a", "0,0"), ("b", "1,1")):
        for h in shown:
            # Around the peak, where the curve is flat enough to measure its
            # height in the column of each place.
            for x, y in peaks(tables[f"{column} density"], column, h, every=3, floor=0.5):
                places.append(
                    Place(
                        f"{h}'s density of {column} at {x:.2f}",
                        x,
                        Measured(y),
                        COLORS[h],
                        panel=panel,
                        series=h,
                    )
                )
    return places


def _joint(frame: pd.DataFrame) -> Tables:
    return {
        f"{column} edges": {"edges": np.histogram_bin_edges(frame[column].to_numpy(float), "auto")}
        for column in ("x", "y")
    }


def _joint_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    places = [
        Place(f"{h}'s point ({x:g}, {y:g})", x, y, COLORS[h], panel="joint", series=h)
        for x, y, h in rows_of(frame, shown)[["x", "y", "h"]].itertuples(index=False)
    ]
    for column, panel in (("x", "x"), ("y", "y")):
        edges = tables[f"{column} edges"]["edges"]
        for h in shown:
            counts = histogram_counts(frame[frame.h == h][column].to_numpy(float), edges)
            for left, right, count in zip(edges[:-1], edges[1:], counts, strict=True):
                if count == 0:
                    continue
                at, height = (left + right) / 2, Measured(count, bars=True)
                x, y = (at, height) if column == "x" else (height, at)
                what = f"{h}'s {column} margin bin from {left:.2f}"
                places.append(Place(what, x, y, COLORS[h], overlaid(shown), panel=panel, series=h))
    return places


def _cluster_places(frame: pd.DataFrame, tables: Tables, shown: tuple[str, ...]) -> list[Place]:
    """Each cell in its value's color on the colorbar, and the trees: each
    leaf's branch at its band, and the lowest merge between its two leaves."""
    columns = ["a", "b", "c"]
    places = []
    for r, row in zip(frame["r"], frame[columns].to_numpy(float), strict=True):
        for column, value in zip(columns, row, strict=True):
            cell, color = f"the cell of {r} and {column}, {value:g}", Ramp(value)
            places.append(Place(cell, Band(column, half=4), Band(r, half=4), color, panel="matrix"))
    for linkage, panel, order, edge in (
        ("column linkage", "top", columns, "bottom"),
        ("row linkage", "left", list(frame["r"]), "right"),
    ):
        merges = tables[linkage]
        root = merges["height"].max()
        for leaf in order:
            leg = Along(0, edge, inset=3)
            where = (Band(leaf, half=0), leg) if edge == "bottom" else (leg, Band(leaf, half=0))
            places.append(Place(f"the {panel} tree's leaf {leaf}", *where, MUTED, panel=panel))
        first, second = order[merges["first"][0]], order[merges["second"][0]]
        between = Mid(Band(first, half=0), Band(second, half=0))
        height = Along(merges["height"][0] / root, edge)
        where = (between, height) if edge == "bottom" else (height, between)
        places.append(
            Place(f"the {panel} tree's merge of {first} and {second}", *where, MUTED, panel=panel)
        )
    return places


def _point_at(columns: tuple[str, str], panel: str | None = None) -> Callable[[hg.Chart], hg.Chart]:
    x, y = columns

    def add(chart: hg.Chart) -> hg.Chart:
        return chart.point(x=x, y=y, fill=ADDED, legend=False, panel=panel)

    return add


def _added_estimates(column: str) -> Callable[[pd.DataFrame, Tables], list[Place]]:
    def places(more: pd.DataFrame, tables: Tables) -> list[Place]:
        e = tables["estimates"]
        new = set(more[column])
        return [
            Place(
                f"the added point at {e[column][i]}",
                e[column][i] if column == "t" else Band(e[column][i], half=0),
                e["high"][i],
                ADDED,
            )
            for i in range(len(e["n"]))
            if e[column][i] in new
        ]

    return places


def _added_rows(
    x: str, y: str, panel: str = "", band: bool = False
) -> Callable[[pd.DataFrame, Tables], list[Place]]:
    def places(more: pd.DataFrame, tables: Tables) -> list[Place]:
        return [
            Place(
                f"the added point ({a}, {b:g})",
                Band(a, half=0) if band else a,
                b,
                ADDED,
                panel=panel,
            )
            for a, b in more[[x, y]].itertuples(index=False)
        ]

    return places


def _added_kde(more: pd.DataFrame, tables: Tables) -> list[Place]:
    density = tables["density"]
    chosen = density["h"] == "q"
    top = np.argmax(np.where(chosen, density["density"], -1))
    return [
        Place("the added point at q's new peak", density["v"][top], density["density"][top], ADDED)
    ]


def _added_ecdf(more: pd.DataFrame, tables: Tables) -> list[Place]:
    e = tables["ecdf"]
    new = set(more["v"])
    return [
        Place(f"the added point at {v:g}", v, p, ADDED)
        for v, p in zip(e["v"], e["Probability"], strict=True)
        if v in new
    ]


def _added_ticks(rule: bool) -> Callable[[pd.DataFrame, Tables], list[Place]]:
    def places(more: pd.DataFrame, tables: Tables) -> list[Place]:
        y = Along(0.5, "bottom") if rule else Along(0, "bottom", inset=4)
        # Whole at the greatest value of all too: the rug leaves room past it.
        return [Place(f"the added mark at {v:g}", v, y, ADDED) for v in more["v"]]

    return places


def _added_residuals(more: pd.DataFrame, tables: Tables) -> list[Place]:
    r = tables["residuals"]
    new = set(more["x"])
    return [
        Place(f"the added point at {x:g}", x, y, ADDED)
        for x, y in zip(r["x"], r["residual"], strict=True)
        if x in new
    ]


def _added_cells(more: pd.DataFrame, tables: Tables) -> list[Place]:
    return [
        Place(
            f"the added point of {r} and {column}",
            Band(column, half=0),
            Band(r, half=0),
            ADDED,
            panel="matrix",
        )
        for r in more["r"]
        for column in ("a", "b", "c")
    ]


def _categorical(
    name: str,
    places: Callable[[pd.DataFrame, Tables, tuple[str, ...]], list[Place]],
    apart: Callable[[pd.DataFrame], Tables],
    fixture: str = "x=g y=v hue=h",
    rows: pd.DataFrame = CATEGORIES,
    more: pd.DataFrame = MORE_CATEGORIES,
    size: tuple[int, int] = (640, 320),
) -> Recipe:
    """A recipe of one value by category and hue, on its defaults."""
    function = getattr(hx, name)
    return Recipe(
        name=name,
        fixture=fixture,
        rows=rows,
        more=more,
        size=size,
        draw=lambda data, **options: function(data, x="g", y="v", series="h", **options),
        apart=apart,
        places=places,
        added=_point_at(("g", "v")),
        added_places=_added_rows("g", "v", band=True),
    )


RECIPES: dict[str, Recipe] = {
    recipe.name: recipe
    for recipe in [
        Recipe(
            name="lineplot",
            fixture="x=t y=v hue=h errorbar=sd",
            rows=TIMES,
            more=MORE_TIMES,
            draw=lambda data, **options: hx.lineplot(
                data, x="t", y="v", series="h", errorbar="sd", **options
            ),
            apart=lambda frame: estimates(frame, "t", "v", sd),
            places=_lineplot_places,
            added=_point_at(("t", "high")),
            added_places=_added_estimates("t"),
        ),
        Recipe(
            name="barplot",
            fixture="x=g y=v hue=h errorbar=se",
            rows=CATEGORIES,
            more=MORE_CATEGORIES,
            draw=lambda data, **options: hx.barplot(
                data, x="g", y="v", series="h", errorbar="se", **options
            ),
            apart=lambda frame: estimates(frame, "g", "v", se),
            places=_bar_places,
            extents=_bar_extents,
            alone=frozenset({NEUTRAL}),
            added=_point_at(("g", "high")),
            added_places=_added_estimates("g"),
        ),
        Recipe(
            name="pointplot",
            fixture="x=g y=v hue=h errorbar=pi90",
            rows=CATEGORIES,
            more=MORE_CATEGORIES,
            draw=lambda data, **options: hx.pointplot(
                data, x="g", y="v", series="h", errorbar=("pi", 90), **options
            ),
            apart=lambda frame: estimates(frame, "g", "v", middle_ninety),
            places=_point_places,
            added=_point_at(("g", "high")),
            added_places=_added_estimates("g"),
        ),
        _categorical(
            "stripplot",
            _value_places,
            lambda frame: {
                "values": {"h": labels(frame.h), "g": labels(frame.g), "v": frame.v.to_numpy(float)}
            },
        ),
        _categorical(
            "swarmplot",
            _value_places,
            lambda frame: {
                "values": {"h": labels(frame.h), "g": labels(frame.g), "v": frame.v.to_numpy(float)}
            },
        ),
        _categorical("boxplot", _box_places, lambda frame: boxes(frame, "boxes")),
        _categorical(
            "boxenplot",
            _boxen_places,
            _letter_values,
            fixture="x=g y=v hue=h quantiles",
            rows=QUANTILES,
            more=MORE_QUANTILES,
            size=(640, 400),
        ),
        _categorical("violinplot", _violin_places, lambda frame: boxes(frame, "quartiles")),
        Recipe(
            name="histplot",
            fixture="x=v hue=h",
            rows=VALUES,
            more=MORE_VALUES,
            draw=lambda data, **options: hx.histplot(data, x="v", series="h", **options),
            apart=_histogram,
            places=_histogram_places,
            added=lambda chart: chart.rug(x="v", stroke=ADDED, legend=False),
            added_places=_added_ticks(rule=False),
        ),
        Recipe(
            name="kdeplot",
            fixture="x=v hue=h",
            rows=VALUES,
            more=MORE_VALUES,
            draw=lambda data, **options: hx.kdeplot(data, x="v", series="h", **options),
            apart=lambda frame: {"density": densities(frame, "v")},
            places=_kde_places,
            added=_point_at(("v", "density")),
            added_places=_added_kde,
        ),
        Recipe(
            name="ecdfplot",
            fixture="x=v hue=h",
            rows=VALUES,
            more=MORE_VALUES,
            draw=lambda data, **options: hx.ecdfplot(data, x="v", series="h", **options),
            apart=_ecdf,
            places=_ecdf_places,
            added=_point_at(("v", "Probability")),
            added_places=_added_ecdf,
        ),
        Recipe(
            name="rugplot",
            fixture="x=v hue=h",
            rows=VALUES,
            more=MORE_VALUES,
            draw=lambda data, **options: hx.rugplot(data, x="v", series="h", **options),
            apart=lambda frame: {"values": {"h": labels(frame.h), "v": frame.v.to_numpy(float)}},
            places=_rug_places,
            added=lambda chart: chart.rule(x="v", stroke=ADDED, legend=False),
            added_places=_added_ticks(rule=True),
        ),
        Recipe(
            name="regplot",
            fixture="x=x y=y hue=h n_boot=100",
            rows=PAIRS,
            more=MORE_PAIRS,
            draw=lambda data, **options: hx.regplot(
                data, x="x", y="y", series="h", n_boot=100, seed=3, **options
            ),
            apart=_regression,
            places=_regression_places,
            added=_point_at(("x", "y")),
            added_places=_added_rows("x", "y"),
        ),
        Recipe(
            name="residplot",
            fixture="x=x y=y legend",
            rows=CURVED,
            more=MORE_CURVED,
            draw=lambda data, **options: hx.residplot(data, x="x", y="y", **options),
            apart=_residuals,
            places=_residual_places,
            extents=_residual_extents,
            alone=frozenset({NEUTRAL}),
            series=(RESIDUALS,),
            # Its one series has no legend unless asked for.
            chart_options={"legend": True},
            added=_point_at(("x", "residual")),
            added_places=_added_residuals,
        ),
        Recipe(
            name="pairplot",
            fixture="vars=a,b hue=h",
            rows=CLUSTERS,
            more=MORE_CLUSTERS,
            draw=lambda data, **options: hx.pairplot(data, vars=["a", "b"], series="h", **options),
            apart=lambda frame: {
                "a density": densities(frame, "a"),
                "b density": densities(frame, "b"),
            },
            places=_pair_places,
            size=(560, 560),
            added=_point_at(("a", "b"), panel="1,0"),
            added_places=_added_rows("a", "b", panel="1,0"),
        ),
        Recipe(
            name="jointplot",
            fixture="x=x y=y hue=h",
            rows=JOINT,
            more=MORE_CLUSTERS.rename(columns={"a": "x", "b": "y"}),
            draw=lambda data, **options: hx.jointplot(data, x="x", y="y", series="h", **options),
            apart=_joint,
            places=_joint_places,
            size=(560, 560),
            added=_point_at(("x", "y"), panel="joint"),
            added_places=_added_rows("x", "y", panel="joint"),
        ),
        Recipe(
            name="clustermap",
            fixture="index=r columns=a,b,c",
            rows=MATRIX,
            more=MORE_MATRIX,
            draw=lambda data, **options: hx.clustermap(
                data, index="r", colors=list(RAMP), **options
            ),
            apart=clustering,
            places=_cluster_places,
            series=(),
            added=_point_at(("column", "r"), panel="matrix"),
            added_places=_added_cells,
        ),
    ]
}
