"""Text styles' vertical_align: a block's top, middle, or bottom at its point,
or for a mark's label, its first line's baseline."""

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
    with pytest.raises(ValueError, match='expected "top", "middle", "bottom", or "baseline"'):
        hg.TextStyle(vertical_align="alphabetic")


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


def text_element(chart: hg.Chart, text: str) -> str:
    """The SVG text element writing `text` (a line of it) in the chart's SVG."""
    match = re.search(rf"<text[^>]*>(?:<tspan[^>]*>)?{text}<", chart.to_svg())
    assert match is not None
    return match.group(0)


@pytest.mark.contract("label.baseline.python")
def test_marks_labels_are_placed_by_their_baseline():
    baseline = hg.TextStyle(vertical_align="baseline", line_height=1.2)
    chart = (
        hg.Chart(DATA, width=400, height=300, legend=False)
        .line(x="t", y="v", labels=hg.SeriesLabels(at="last", style=baseline))
        .text(x=5, y=5, label=hg.Label(text="peak", style=baseline))
        .rule(y=5, label={"text": "SLO", "style": {"vertical_align": "baseline"}})
        .region(y1=2, y2=8, label=hg.Label(text="band", style=baseline))
    )
    spec, _ = chart.to_spec()
    assert spec["marks"][0]["labels"]["style"] == {"lineHeight": 1.2, "verticalAlign": "baseline"}
    assert spec["marks"][2]["label"]["style"] == {"verticalAlign": "baseline"}
    # Drawn by their alphabetic baselines, at their points.
    for text in ("peak", "SLO", "band"):
        assert "dominant-baseline" not in text_element(chart, text)
    middle = label_y(
        hg.Chart(DATA, width=400, height=300, legend=False)
        .line(x="t", y="v")
        .text(x=5, y=5, label="peak"),
        "peak",
    )
    # A point's own y: the middle of plain text placed there.
    assert label_y(chart, "peak") == pytest.approx(middle, abs=0.01)


@pytest.mark.contract("label.baseline.refused.python")
def test_baseline_is_refused_where_text_is_not_a_marks_label():
    baseline = hg.TextStyle(vertical_align="baseline")
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(DATA, theme={"style": {"text": {"vertical_align": "baseline"}}})
    assert str(raised.value) == (
        'theme.style.text.vertical_align: "baseline" places a mark\'s label by a point; '
        "give it in the label's style"
    )
    assert raised.value.path == "theme.style.text.vertical_align"
    # In the spec's spelling too.
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(DATA, theme={"style": {"tickLabel": {"verticalAlign": "baseline"}}})
    assert str(raised.value) == (
        'theme.style.tickLabel.verticalAlign: "baseline" places a mark\'s label by a point; '
        'tick labels align "top", "middle", or "bottom" at their ticks'
    )
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(DATA, y=hg.AxisOptions(style={"tick_label": baseline}))
    assert str(raised.value) == (
        'y.style.tick_label.vertical_align: "baseline" places a mark\'s label by a point; '
        'tick labels align "top", "middle", or "bottom" at their ticks'
    )
    first, second = hg.Chart(DATA).columns(2)
    first.panel("a")
    with pytest.raises(hg.ChartError) as raised:
        second.panel("b", y={"style": {"tick_label": baseline}})
    assert raised.value.path == "panels[1].y.style.tick_label.vertical_align"
    # The same style a text mark's label takes, refused by a bar's labels and a title.
    chart = hg.Chart(DATA).text(x=1, y=1, label=hg.Label(text="ok", style=baseline))
    with pytest.raises(hg.ChartError) as raised:
        chart.bar(x="t", y="v", labels=hg.BarLabels(style=baseline))
    assert str(raised.value) == (
        'marks[1].labels.style.vertical_align: expected "top", "middle", or "bottom"; '
        'received "baseline"'
    )
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(DATA, title={"text": "T", "style": baseline})
    assert raised.value.path == "title.style.vertical_align"
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(DATA).text(
            x=1, y=1, label={"text": "A", "style": {"vertical_align": "alphabetic"}}
        )
    assert str(raised.value) == (
        'marks[0].label.style.vertical_align: expected "top", "middle", "bottom", or '
        '"baseline"; received "alphabetic"'
    )
