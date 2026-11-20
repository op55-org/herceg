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


EDGES = {"x": [0.0, 1000.0], "v": [0.0, 1.0]}


def edge_to_edge(ends: str | None = None) -> hg.Chart:
    """Values from 0 to 1000 across a chart without padding or a y axis,
    whose first and last labels cross its edges."""
    labels = hg.TickLabels(ends=ends) if ends else None  # type: ignore[arg-type]
    guides = [hg.axis("x", ticks=hg.Ticks(values=[0, 250, 500, 750, 1000]), labels=labels)]
    return hg.Chart(
        EDGES,
        width=800,
        height=300,
        padding=0,
        legend=False,
        x=hg.AxisOptions(nice=False),
        y=hg.AxisOptions(show=False, grid=False),
        guides=guides,
    ).line(x="x", y="v")


@pytest.mark.contract("axis.tick-labels.ends.svg")
def test_end_labels_crossing_the_edge_are_left_out_and_keep_the_plot():
    spec, _ = edge_to_edge("hide").to_spec()
    assert spec["guides"][0]["labels"] == {"ends": "hide"}
    shown = re.findall(r">([\d,]+)</text>", edge_to_edge().to_svg())
    assert shown == ["0", "250", "500", "750", "1,000"]
    # The plot spans the chart: the end labels are left out instead.
    assert re.findall(r">([\d,]+)</text>", edge_to_edge("hide").to_svg()) == ["250", "500", "750"]
    assert plot_x(edge_to_edge("hide")) == 0
    assert plot_x(edge_to_edge()) > 0
    with pytest.raises(
        hg.ChartError, match=r'^TickLabels ends: expected "room" or "hide"; received "drop"$'
    ):
        hg.TickLabels(ends="drop")  # type: ignore[arg-type]
    for colorbar, at, path in [
        (
            hg.colorbar(labels=hg.TickLabels(ends="hide")),
            "colorbar labels ends",
            "guides[0].labels.ends",
        ),
        (
            hg.colorbar(layers=[hg.TickLayer(id="m", labels={"ends": "hide"})]),
            "colorbar layers[0] labels ends",
            "guides[0].layers[0].labels.ends",
        ),
    ]:
        with pytest.raises(hg.ChartError) as raised:
            hg.Chart(EDGES, guides=[colorbar]).heatmap(x="x", y="v", color="v").to_spec()
        assert str(raised.value) == f"{at}: a colorbar's labels stand beside its ramp; drop ends"
        assert raised.value.path == path


def test_express_charts_take_axes_leaving_out_their_end_labels():
    import herceg.express as hx

    chart = hx.lineplot(
        EDGES, x="x", y="v", guides=[hg.axis("x", labels=hg.TickLabels(ends="hide"))]
    )
    spec, _ = chart.to_spec()
    assert spec["guides"] == [{"type": "axis", "scale": "x", "labels": {"ends": "hide"}}]
