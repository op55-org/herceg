"""How labels keep apart, as Python writes them: ``overlap``,
``overlap_group``, ``leader``, and ``priority`` on ``hg.Label`` (text, rule,
and region labels) and ``hg.SeriesLabels``, ``overlap`` on
``hg.BarLabels``, and what each kind refuses."""

import re

import pytest

import herceg as hg


def x_of(svg: str, text: str) -> float:
    """Where the SVG draws ``text``: its x."""
    match = re.search(rf'<text[^>]* x="([\d.-]+)"[^>]*>{text}</text>', svg)
    assert match, text
    return float(match.group(1))


def events(group: str | None, priorities: tuple[float, float] = (0, 0)) -> hg.Chart:
    """Two event rules close together whose labels move where they would meet."""
    chart = hg.Chart(x=hg.AxisOptions(domain=(0, 10)), width=400, height=240)
    for at, name, priority in ((5, "Black Friday", priorities[0]), (5.2, "Outage", priorities[1])):
        chart = chart.rule(
            x=at,
            dash="--",
            label=hg.Label(text=name, overlap="move", overlap_group=group, priority=priority),
        )
    return chart


@pytest.mark.contract("label.group.priority.python")
def test_rule_labels_of_a_group_keep_apart_by_priority():
    spec, _ = events("events", (0, 1)).to_spec()
    assert spec["marks"][1]["label"] == {
        "text": "Outage",
        "overlap": "move",
        "overlapGroup": "events",
        "priority": 1,
    }
    alone = events(None).to_svg()
    plain = events("events").to_svg()
    ranked = events("events", (0, 1)).to_svg()
    # Without a group each keeps its place; in one, the earlier mark's label
    # stays, unless the later one's priority is higher.
    assert x_of(plain, "Black Friday") == x_of(alone, "Black Friday")
    assert x_of(plain, "Outage") < x_of(alone, "Outage")
    assert x_of(ranked, "Outage") == x_of(alone, "Outage")
    assert x_of(ranked, "Black Friday") < x_of(alone, "Black Friday")


def test_leaders_are_written_as_the_spec_takes_them():
    look = hg.Label(
        text="a", overlap="move", leader=hg.StrokeStyle(stroke="#999", stroke_width=0.5)
    )
    assert look._spec()["leader"] == {"stroke": "#999", "strokeWidth": 0.5}
    assert hg.Label(text="a", overlap="move", leader={"dash": "--"})._spec()["leader"] == {
        "dash": "--"
    }
    labels = hg.SeriesLabels(at="last", leader=True, priority=2, overlap="move")
    assert labels._spec() == {"at": "last", "overlap": "move", "leader": True, "priority": 2}
    assert hg.BarLabels(overlap="hide")._spec() == {"overlap": "hide"}


def test_bar_labels_that_would_cover_an_earlier_one_go_inside_or_are_left_out():
    # Two series drawn over each other: their labels meet at nearly one place.
    rows = {"g": ["a", "a", "b", "b"], "v": [10, 10.2, 20, 20.1], "s": ["x", "y", "x", "y"]}

    def places(overlap: str) -> dict[str, tuple[float, float]]:
        chart = hg.Chart(rows, legend=False).bar(
            x="g", y="v", color="s", dodge=False, labels=hg.BarLabels(overlap=overlap)
        )
        found = re.findall(
            r'<text[^>]* x="([\d.]+)" y="([\d.]+)"[^>]*>([\d.]+)</text>', chart.to_svg()
        )
        return {text: (float(x), float(y)) for x, y, text in found if text in ("10.2", "20.1")}

    shown, hidden = places("show"), places("hide")
    # Shown, the later label sits a pixel or two from the earlier one; hidden,
    # it goes inside its bar, a line further down.
    assert hidden["10.2"][1] - shown["10.2"][1] > 10
    assert hidden["20.1"][1] - shown["20.1"][1] > 10


@pytest.mark.contract("label.refused.python")
def test_each_kind_refuses_what_it_does_not_do():
    chart = hg.Chart({"t": [0, 1], "v": [1.0, 2]})
    with pytest.raises(
        hg.ChartError,
        match='^SeriesLabels overlap: "stagger" is for tick labels; use "show", "hide", or "move"$',
    ):
        hg.SeriesLabels(at="last", overlap="stagger")  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError, match='unknown key "overlap_group"'):
        chart.line(x="t", y="v", labels={"at": "last", "overlap_group": "a"})
    with pytest.raises(
        hg.ChartError,
        match="^SeriesLabels leader: labels that show are drawn at their place and draw none; "
        'use overlap="move"$',
    ):
        hg.SeriesLabels(at="last", overlap="show", leader=True)
    # Annotation labels show by default: a leader needs them to move.
    with pytest.raises(
        hg.ChartError,
        match="^rule label leader: labels that show are drawn at their place and draw none; "
        'use overlap="move"$',
    ):
        chart.rule(y=1, label=hg.Label(text="a", leader=True))
    with pytest.raises(
        hg.ChartError,
        match="^region label leader: region labels slide along their side and draw none; "
        "drop leader$",
    ):
        chart.region(y1=1, y2=2, label=hg.Label(text="a", overlap="move", leader=True))
    with pytest.raises(hg.ChartError, match="^Label overlap_group: expected a group's name"):
        hg.Label(text="a", overlap_group="")
    with pytest.raises(hg.ChartError, match="^Label priority: expected a number"):
        hg.Label(text="a", priority=float("nan"))
    with pytest.raises(
        hg.ChartError,
        match="^BarLabels overlap: bar labels fit at their bar or are left out; "
        'use "show" or "hide"$',
    ):
        hg.BarLabels(overlap="move")  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError, match='unknown key "leader"'):
        chart.bar(x="t", y="v", labels={"leader": True})


@pytest.mark.contract("label.parts.python")
def test_parts_of_a_label_take_looks_of_their_own():
    # b6.04: each bar's name in bold over its value at 0.7 opacity.
    rows = {"name": ["Alpha", "Beta"], "value": [80, 60]}
    labels = hg.BarLabels(
        content=[
            hg.LabelPart(field="name", style=hg.TextStyle(font_weight=700)),
            "\n",
            hg.LabelPart(value=True, style={"opacity": 0.7}),
        ],
        place=hg.LabelPlace(outside=False),
    )
    chart = hg.Chart(rows, legend=False, width=400, height=200).bar(
        x="value", y="name", labels=labels
    )
    spec, _ = chart.to_spec()
    assert spec["marks"][0]["labels"]["content"] == [
        {"field": "name", "style": {"fontWeight": 700}},
        "\n",
        {"value": True, "style": {"opacity": 0.7}},
    ]
    svg = chart.to_svg()
    # Each part is a text of its own, in its own look.
    assert re.search(r'<text[^>]*font-weight="700"[^>]*>Alpha</text>', svg)
    assert re.search(r'<text[^>]*opacity="0.7"[^>]*>80</text>', svg)
    with pytest.raises(
        hg.ChartError, match="^LabelPart style: halo is the label's; give it in the label's style$"
    ):
        hg.LabelPart(value=True, style=hg.TextStyle(halo=False))
    with pytest.raises(hg.ChartError, match="LabelPart style: padding is the label's"):
        hg.Label(content=[hg.LabelPart(field="name", style={"padding": 2})])
