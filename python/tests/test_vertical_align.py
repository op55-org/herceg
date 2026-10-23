"""Text styles' vertical_align: a block's top, middle, or bottom at its point."""

import re

import pytest

import herceg as hg

DATA = {"t": [0.0, 10.0], "v": [0.0, 10.0]}


def label_y(chart: hg.Chart, text: str) -> float:
    """The y of the label `text` in the chart's SVG."""
    match = re.search(rf'<text[^>]* y="([\d.-]+)"[^>]*>{text}</text>', chart.to_svg())
    assert match is not None
    return float(match.group(1))


@pytest.mark.contract("text.vertical-align.svg")
def test_text_is_aligned_across_its_lines():
    def chart(**style):
        return (
            hg.Chart(DATA, width=400, height=300, legend=False)
            .line(x="t", y="v")
            .text(x=5, y=5, label=hg.Label(text="peak", style=hg.TextStyle(**style)))
        )

    spec, _ = chart(vertical_align="bottom").to_spec()
    assert spec["marks"][1]["label"]["style"] == {"verticalAlign": "bottom"}
    middle = label_y(chart(), "peak")
    # A line 15 pixels tall: its bottom at the point puts it half a line higher.
    assert label_y(chart(vertical_align="bottom"), "peak") == pytest.approx(middle - 7.5, abs=0.1)
    assert label_y(chart(vertical_align="top"), "peak") == pytest.approx(middle + 7.5, abs=0.1)
    with pytest.raises(ValueError, match='expected "top", "middle", or "bottom"'):
        hg.TextStyle(vertical_align="baseline")


@pytest.mark.contract("rule.label.vertical-align.svg")
def test_rule_labels_go_below_or_on_their_rule():
    def chart(align):
        style = hg.TextStyle(vertical_align=align) if align else None
        return (
            hg.Chart(DATA, width=400, height=300, legend=False)
            .line(x="t", y="v")
            .rule(y=5, label=hg.Label(text="SLO", style=style))
        )

    above = label_y(chart("bottom"), "SLO")
    on = label_y(chart("middle"), "SLO")
    below = label_y(chart("top"), "SLO")
    assert above < on < below
    assert on - above == pytest.approx(below - on, abs=0.1)


@pytest.mark.contract("region.label.vertical-align.svg")
def test_region_labels_go_below_on_or_above_their_edge():
    def chart(align):
        return (
            hg.Chart(DATA, width=400, height=300, legend=False)
            .line(x="t", y="v")
            .region(
                y1=2, y2=8, label=hg.Label(text="band", style=hg.TextStyle(vertical_align=align))
            )
        )

    below = label_y(chart("top"), "band")
    on = label_y(chart("middle"), "band")
    above = label_y(chart("bottom"), "band")
    assert above < on < below
    assert on - above == pytest.approx(below - on, abs=0.1)


@pytest.mark.contract("axis.tick-labels.align.svg")
def test_tick_labels_stand_at_their_ticks_as_their_style_aligns_them():
    def chart(**style):
        y = hg.AxisOptions(style={"tick_label": hg.TextStyle(**style)}) if style else None
        return hg.Chart(DATA, width=400, height=300, legend=False, y=y).line(x="t", y="v")

    def y_label(chart: hg.Chart) -> float:
        """The y of the y axis' label 6, which ends at the axis."""
        match = re.search(
            r'<text[^>]* y="([\d.-]+)" text-anchor="end"[^>]*>6</text>', chart.to_svg()
        )
        assert match is not None
        return float(match.group(1))

    centered = y_label(chart())
    # A line 15 pixels tall: its top at the tick puts it half a line lower.
    assert y_label(chart(vertical_align="top")) == pytest.approx(centered + 7.5, abs=0.1)
    assert y_label(chart(vertical_align="bottom")) == pytest.approx(centered - 7.5, abs=0.1)
