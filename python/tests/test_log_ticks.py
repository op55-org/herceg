"""Log axes tick every digit of a short span, labelling the leading digits that fit the count."""

import re

import pytest

import herceg as hg

K = 6.54
# Study B1: ratios to an index date on the fixed domain [1/k, k].
RATIOS = {"t": [0.0, 10.0], "v": [1 / K, K]}


def ratios(**axis: object) -> hg.Chart:
    y = hg.AxisOptions(type="log", domain=(1 / K, K), nice=False, **axis)  # type: ignore[arg-type]
    return hg.Chart(RATIOS, width=928, height=600, legend=False, y=y).line(x="t", y="v")


def texts(chart: hg.Chart) -> list[str]:
    return re.findall(r"<text[^>]*>([^<]*)</text>", chart.to_svg())


def grid_lines(chart: hg.Chart) -> int:
    """The horizontal grid lines in the chart's SVG: its first path's moves."""
    match = re.search(r'<path d="([^"]+)" stroke="[^"]+" fill="none"/>', chart.to_svg())
    assert match is not None
    return match.group(1).count("M")


@pytest.mark.contract("axis.log-ticks.svg")
def test_labels_go_on_the_leading_digits_that_fit_the_count():
    # d3's count of 10: 14 ticks, 0.8 and 0.9 without labels.
    chart = ratios(ticks=10, format=hg.Format(number="~g", suffix="×"))
    labels = [text for text in texts(chart) if text.endswith("×")]
    assert labels == [f"{v}×" for v in ("0.2", "0.3", "0.4", "0.5", "0.6", "0.7")] + [
        f"{v}×" for v in range(1, 7)
    ]
    assert grid_lines(chart) == 14
    # Herceg's count for 564 px of plot (13) labels every one.
    assert {"0.8", "0.9"} <= set(texts(ratios()))
    assert grid_lines(ratios()) == 14
