"""Scales' padding: automatic room for marks, a share, pixels, or none."""

import re

import pytest

import herceg as hg

DATA = {"t": [0.0, 5.0, 10.0], "v": [1.0, 3.0, 2.0]}


def first_x(chart: hg.Chart) -> float:
    """The x of the line's first vertex in the chart's SVG."""
    match = re.search(r'<path d="M([\d.]+) [\d.]+L', chart.to_svg())
    assert match is not None
    return float(match.group(1))


@pytest.mark.contract("scale.padding.pixels.svg")
def test_padding_is_written_and_drawn():
    def chart(**x):
        return hg.Chart(DATA, width=400, height=200, legend=False, x=x).line(x="t", y="v")

    spec, _ = chart(padding=hg.Pixels(20)).to_spec()
    assert spec["x"]["padding"] == {"px": 20}
    spec, _ = chart(padding=0.1).to_spec()
    assert spec["x"]["padding"] == 0.1
    # Pixels push the first point in from where a plain line starts.
    assert first_x(chart(padding=hg.Pixels(20))) == pytest.approx(first_x(chart()) + 20, abs=0.6)
    with pytest.raises(hg.ChartError) as refused:
        hg.Chart(DATA, x={"padding": 0.5})
    assert refused.value.path == "x.padding"
