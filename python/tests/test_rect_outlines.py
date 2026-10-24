"""Bars of a width in pixels, and outlines of some sides on bars and regions."""

import re
from io import BytesIO

import numpy as np
import pytest

import herceg as hg

DATA = {"x": [5.0], "y": [8.0]}


def capped(**options):
    return hg.Chart(
        DATA,
        width=400,
        height=300,
        legend=False,
        theme={"tokens": {"background": "transparent"}},
        x={"domain": [0, 10], "grid": False, "nice": False},
        y={"domain": [0, 10], "grid": False, "nice": False},
    ).bar(
        x="x",
        y="y",
        fill="#0000ff",
        stroke="#ff0000",
        stroke_width=4,
        width=hg.Pixels(20),
        **options,
    )


@pytest.mark.contract("bar.width.pixels.svg")
def test_bars_take_a_width_in_pixels():
    spec, _ = capped().to_spec()
    assert spec["marks"][0]["width"] == {"px": 20}
    # One path of the bar's fill, 20 pixels wide.
    svg = capped().to_svg()
    d = re.search(r'<path d="M([\d.]+) [\d.]+[^"]*"[^>]*fill="#0000ff"', svg)
    assert d is not None
    xs = [float(x) for x in re.findall(r"[ML]([\d.]+) ", d.group(0))]
    assert max(xs) - min(xs) == pytest.approx(20, abs=0.01)


@pytest.mark.contract("bar.stroke-sides.png")
def test_bars_are_capped_by_the_sides_they_list():
    image = pytest.importorskip("PIL.Image")
    spec, _ = capped(stroke_sides=["top"]).to_spec()
    assert spec["marks"][0]["strokeSides"] == ["top"]

    def pixels(chart):
        return np.asarray(image.open(BytesIO(chart.to_png())))

    # The bar's fill (blue) and outline (red) pixels.
    capped_png = pixels(capped(stroke_sides=["top"]))
    blue = np.argwhere((capped_png[:, :, 2] == 255) & (capped_png[:, :, 0] == 0))
    red = np.argwhere((capped_png[:, :, 0] == 255) & (capped_png[:, :, 2] == 0))
    left, right = blue[:, 1].min(), blue[:, 1].max()
    # The cap is red across the top; the sides are the fill's to their edge.
    assert red[:, 0].max() < blue[:, 0].min() + 3
    assert right - left + 1 == pytest.approx(20, abs=1)
    whole = pixels(capped())
    whole_red = np.argwhere((whole[:, :, 0] == 255) & (whole[:, :, 2] == 0))
    # Outlined on every side, the outline runs down the sides too.
    assert whole_red[:, 0].max() > red[:, 0].max() + 20


@pytest.mark.contract("region.stroke.svg")
def test_regions_are_outlined_on_their_own_edges():
    chart = (
        hg.Chart({"t": [0.0, 10.0], "v": [1.0, 2.0]}, width=400, height=200, legend=False)
        .line(x="t", y="v")
        .region(x1=2, x2=4, stroke="#ff0000", stroke_width=2)
    )
    spec, _ = chart.to_spec()
    assert spec["marks"][1]["stroke"] == "#ff0000"
    svg = chart.to_svg()
    # A band across the plot: its left and right edges, not the plot's top and bottom.
    outline = re.search(r'<path d="([^"]*)"[^>]*stroke="#ff0000"', svg)
    assert outline is not None and outline.group(1).count("M") == 2
    with pytest.raises(hg.ChartError) as refused:
        hg.Chart({"t": [0.0]}).region(x1=0, x2=1, stroke_sides=["middle"])
    assert refused.value.path == "marks[0].stroke_sides"
