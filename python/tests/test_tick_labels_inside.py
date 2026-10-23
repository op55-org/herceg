"""Tick labels inside the plot (``inside=True``) and apart from their ticks (``gap``)."""

import re

import pytest

import herceg as hg

DATA = {"t": [0.0, 100.0], "v": [0.0, 10.0]}


def y_axis(labels: hg.TickLabels | None = None) -> hg.Chart:
    guides = [hg.axis(scale="y", labels=labels)] if labels else None
    return hg.Chart(DATA, width=400, height=300, legend=False, guides=guides).line(x="t", y="v")


def label_at(chart: hg.Chart, text: str) -> tuple[float, str]:
    """The x of the label `text` in the chart's SVG, and its anchor."""
    match = re.search(rf"<text ([^>]*)>{text}</text>", chart.to_svg())
    assert match is not None
    x = re.search(r'\bx="([\d.-]+)"', match.group(1))
    anchor = re.search(r'text-anchor="(\w+)"', match.group(1))
    assert x is not None
    return float(x.group(1)), anchor.group(1) if anchor else "start"


def plot_x(chart: hg.Chart) -> float:
    """Where the chart's plot starts: its clip's left edge."""
    match = re.search(r'<clipPath [^>]*><rect x="([\d.]+)"', chart.to_svg())
    assert match is not None
    return float(match.group(1))


@pytest.mark.contract("axis.tick-labels.inside.svg")
def test_labels_go_inside_the_plot_and_give_back_its_room():
    spec, _ = y_axis(hg.TickLabels(inside=True)).to_spec()
    assert spec["guides"][0]["labels"] == {"inside": True}
    outside_x, outside_anchor = label_at(y_axis(), "10")
    inside_x, inside_anchor = label_at(y_axis(hg.TickLabels(inside=True)), "10")
    assert outside_anchor == "end"
    # Beside their ticks within the plot, which takes the room they kept.
    assert inside_anchor == "start"
    assert inside_x == plot_x(y_axis(hg.TickLabels(inside=True))) + 4
    assert plot_x(y_axis(hg.TickLabels(inside=True))) < outside_x


@pytest.mark.contract("axis.tick-labels.gap.svg")
def test_gap_sets_labels_apart_from_their_ticks():
    spec, _ = y_axis(hg.TickLabels(gap=20)).to_spec()
    assert spec["guides"][0]["labels"] == {"gap": 20}
    # Labels end 20 pixels from the axis line, not the default 8: the plot
    # moves right by the difference, the labels stay inside the chart.
    assert plot_x(y_axis(hg.TickLabels(gap=20))) == plot_x(y_axis()) + 12
    assert label_at(y_axis(hg.TickLabels(gap=20)), "10") == label_at(y_axis(), "10")
    with pytest.raises(ValueError, match="TickLabels gap"):
        hg.TickLabels(gap=-1)
