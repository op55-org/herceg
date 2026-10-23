"""Scales and guides in Python: ticks, formats, axes, legends, and colorbars,
their specs, their errors in Python's names, and their output."""

import datetime as dt
import xml.etree.ElementTree as ET

import pytest

import herceg as hg

HOURS = [dt.datetime(2026, 9, 28) + dt.timedelta(hours=i) for i in range(49)]
WEEK = {"t": HOURS, "v": [i % 7 for i in range(49)]}


@pytest.mark.parametrize(
    "options",
    [
        {"side": "right", "scope": "panel"},
        {"side": "left", "scope": "panel", "panel": "heat", "align": "end", "offset": 0},
        {"inside": "top-right", "scope": "panel", "panel": "heat", "inset": 0},
        # The engine accepts panel strings independently of scope, even empty strings.
        {"side": "bottom", "scope": "chart", "panel": ""},
        {"inside": "left", "scope": "chart", "panel": "heat"},
        {"side": "top", "panel": "heat"},
    ],
)
def test_place_accepts_the_engines_side_and_inside_options(options):
    guide = hg.colorbar(place=hg.Place(**options))
    chart = hg.Chart(WEEK, guides=[guide]).line(x="t", y="v")
    assert spec_of(chart)["guides"][0]["place"] == options


@pytest.mark.parametrize(
    ("options", "message"),
    [
        ({}, "Place: give a side or inside"),
        ({"side": "right", "inside": "top"}, "Place: give a side or inside"),
        ({"side": "right", "inset": 2}, "Place inset: places inside a plot only"),
        ({"inside": "top", "align": "start"}, "Place align: places on a side only"),
        ({"inside": "top", "offset": 0}, "Place offset: places on a side only"),
        ({"side": "middle"}, "Place side: expected"),
        ({"inside": "middle"}, "Place inside: expected"),
        ({"side": "right", "align": "middle"}, "Place align: expected"),
        ({"side": "right", "scope": "plot"}, "Place scope: expected"),
        ({"side": "right", "panel": 1}, "Place panel: expected a string"),
        ({"side": "right", "offset": -1}, "Place offset: expected a number of at least 0"),
        ({"side": "right", "offset": float("inf")}, "Place offset: expected a number"),
        ({"inside": "top", "inset": float("nan")}, "Place inset: expected a number"),
        ({"inside": "top", "inset": True}, "Place inset: expected a number"),
    ],
)
def test_place_refuses_the_same_invalid_options_as_the_engine(options, message):
    with pytest.raises((ValueError, TypeError), match=message):
        hg.Place(**options)


@pytest.mark.parametrize("named_panel", [False, True])
def test_colorbar_renders_beside_one_panel(named_panel):
    place = hg.Place(side="right", scope="panel", panel="heat" if named_panel else None)
    chart = hg.Chart(
        {"x": [0, 1, 0, 1], "y": [0, 0, 1, 1], "v": [0, 2, 5, 10]},
        width=640,
        height=600,
        legend=False,
        guides=[hg.colorbar(title="Score", place=place)],
    )
    top, bottom = chart.rows([1, 1])
    # The named target is second; without a name placement defaults to the first.
    top.panel("trend").line(x="x", y="v")
    bottom.panel("heat").heatmap(x="x", y="y", color="v")
    assert spec_of(chart)["guides"][0]["place"] == {
        "side": "right",
        "scope": "panel",
        **({"panel": "heat"} if named_panel else {}),
    }
    root = ET.fromstring(chart.to_svg())
    ns = {"s": "http://www.w3.org/2000/svg"}
    plots = root.findall("s:defs/s:clipPath/s:rect", ns)
    assert len(plots) == 2
    target = plots[1 if named_panel else 0]
    ramp = next(r for r in root.findall(".//s:rect", ns) if "ramp" in r.get("fill", ""))
    assert float(ramp.attrib["x"]) > float(target.attrib["x"]) + float(target.attrib["width"])
    assert float(target.attrib["y"]) <= float(ramp.attrib["y"])
    assert float(ramp.attrib["y"]) + float(ramp.attrib["height"]) <= float(
        target.attrib["y"]
    ) + float(target.attrib["height"])


def test_panel_legend_accepts_a_panel_scoped_side_place():
    chart = hg.Chart({"x": [0, 1], "y": [1, 2]}, width=640, height=600, legend=False)
    top, bottom = chart.rows([1, 1])
    top.panel("other").line(x="x", y="y")
    panel = bottom.panel("trend").line(x="x", y="y", label="Trend")
    panel.legend(place={"side": "right", "scope": "panel"})
    assert spec_of(chart)["guides"][0] == {
        "type": "legend",
        "panel": "trend",
        "place": {"side": "right", "scope": "panel"},
    }
    root = ET.fromstring(chart.to_svg())
    ns = {"s": "http://www.w3.org/2000/svg"}
    target = root.findall("s:defs/s:clipPath/s:rect", ns)[1]
    label = next(t for t in root.findall(".//s:text", ns) if t.text == "Trend")
    assert float(label.attrib["x"]) > float(target.attrib["x"]) + float(target.attrib["width"])
    assert (
        float(target.attrib["y"])
        <= float(label.attrib["y"])
        <= float(target.attrib["y"]) + float(target.attrib["height"])
    )


def spec_of(chart: hg.Chart) -> dict:
    return {key: value for key, value in chart.to_spec()[0].items() if key != "data"}


def test_ticks_and_formats_write_the_specs_canonical_forms():
    chart = hg.Chart(
        WEEK,
        x=hg.AxisOptions(ticks=hg.Ticks(every="6 hours"), format=hg.Format(time="%H:%M")),
        y=hg.AxisOptions(ticks=hg.Ticks(values=[1, 5]), tooltip_format=hg.Format(number=".1f")),
    ).line(x="t", y="v")
    spec = spec_of(chart)
    assert spec["x"] == {
        "ticks": {"every": {"unit": "hour", "step": 6}},
        "format": {"time": "%H:%M"},
    }
    assert spec["y"] == {"ticks": {"values": [1.0, 5.0]}, "tooltipFormat": {"number": ".1f"}}
    # A count alone is the short form; elapsed time is a timedelta; times are epoch milliseconds.
    assert hg.Ticks(count=4)._spec() == 4
    assert hg.Ticks(every="day")._spec() == {"every": {"unit": "day"}}
    assert hg.Ticks(every=dt.timedelta(hours=6))._spec() == {"every": {"milliseconds": 21_600_000}}
    assert hg.Ticks(values=[dt.datetime(1970, 1, 2)])._spec() == {"values": [86_400_000]}


def test_ticks_and_formats_refuse_what_they_cannot_say_in_python_names():
    with pytest.raises(ValueError, match="Ticks: give one of count, every, or values"):
        hg.Ticks(count=4, every=2)
    with pytest.raises(
        ValueError, match="Ticks anchor: calendar steps start at calendar boundaries"
    ):
        hg.Ticks(every="day", anchor=3)
    with pytest.raises(ValueError, match='Ticks every: "fortnight" is not a time interval'):
        hg.Ticks(every="fortnight")._spec()
    with pytest.raises(ValueError, match="Format: give number or time, one of them"):
        hg.Format()
    with pytest.raises(ValueError, match='Format number: ",.2q" is not a number pattern'):
        hg.Format(number=",.2q")
    with pytest.raises(ValueError, match='Format time: "%U" at character 4 of "%H %U"'):
        hg.Format(time="%H %U")
    with pytest.raises(TypeError, match="AxisOptions format: Python functions cannot travel"):
        hg.Chart(WEEK, y=hg.AxisOptions(format=lambda v: str(v))).line(x="t", y="v").to_spec()


def test_scales_and_guides_write_their_specs():
    chart = (
        hg.Chart(
            WEEK,
            scales={"y_right": hg.Scale(domain=(0, 10)), "y": {"zero": False}},
            guides=[
                hg.axis(
                    "x",
                    tick=hg.Tick(direction="in", length=6),
                    labels=hg.TickLabels(rotation=[0, -45], collision="hide"),
                    layers=[
                        hg.TickLayer(
                            id="day",
                            ticks=hg.Ticks(every="day"),
                            format=hg.Format(time="%b %-d"),
                            labels=hg.TickLabels(row=1),
                        )
                    ],
                ),
                hg.axis("y_right", line=True),
                hg.legend(scales=[hg.ScaleRef(mark="a", channel="series")], columns=3),
                hg.colorbar(place=hg.Place(side="bottom"), ticks=5),
            ],
        )
        .line(x="t", y="v", id="a")
        .line(x="t", y="v", axis="right", legend=False)
    )
    spec = spec_of(chart)
    assert spec["scales"] == {"yRight": {"domain": [0.0, 10.0]}, "y": {"zero": False}}
    axis, right, legend, colorbar = spec["guides"]
    assert axis == {
        "type": "axis",
        "scale": "x",
        "tick": {"direction": "in", "length": 6},
        "labels": {"rotation": {"candidates": [0, -45]}, "collision": "hide"},
        "layers": [
            {
                "id": "day",
                "ticks": {"every": {"unit": "day"}},
                "format": {"time": "%b %-d"},
                "labels": {"row": 1},
            }
        ],
    }
    assert right == {"type": "axis", "scale": "yRight", "line": True}
    assert legend == {
        "type": "legend",
        "columns": 3,
        "scales": [{"mark": "a", "channel": "series"}],
    }
    assert colorbar == {"type": "colorbar", "place": {"side": "bottom"}, "ticks": 5}
    assert spec["marks"][1]["legend"] is False


def test_guides_refuse_what_they_cannot_say_in_python_names():
    with pytest.raises(
        ValueError, match='axis scale: expected "x", "y", or "y_right"; received "z"'
    ):
        hg.axis("z")
    with pytest.raises(ValueError, match='TickLayer id: expected a name other than "" and "major"'):
        hg.TickLayer(id="major")
    with pytest.raises(ValueError, match="legend rows: columns or rows, not both"):
        hg.Chart(WEEK, guides=[hg.legend(columns=2, rows=2)]).line(x="t", y="v").to_spec()
    with pytest.raises(TypeError, match=r"Chart guides\[0\]: expected hg.axis\(...\)"):
        hg.Chart(WEEK, guides=[{"type": "axis"}]).line(x="t", y="v").to_spec()
    with pytest.raises(
        ValueError, match="Chart scales temperature: expected an hg.OrdinalScale, a scale of"
    ):
        hg.Chart(WEEK, scales={"temperature": hg.Scale()}).line(x="t", y="v").to_spec()
    with pytest.raises(ValueError, match="line legend: expected False"):
        hg.Chart(WEEK).line(x="t", y="v", legend=True)
    with pytest.raises(ValueError, match="LegendEntry: a swatch or a sample, not both"):
        hg.LegendEntry(key="a", label="A", swatch=hg.Swatch(type="rect", fill="#eee"), sample="a")
    with pytest.raises(
        ValueError, match='axis place: y_right axes go on the "right" side; received "left"'
    ):
        hg.axis("y_right", place=hg.Place(side="left"))
    with pytest.raises(ValueError, match='Ticks every: "0 hours" steps by 0; give a count of 1'):
        hg.Ticks(every="0 hours")._spec()
    with pytest.raises(ValueError, match="TickLabels rotation: expected degrees from -90"):
        hg.TickLabels(rotation=[0, 270])
    with pytest.raises(ValueError, match='Swatch size: a rect swatch takes "fill", "stroke", or'):
        hg.Swatch(type="rect", fill="#eee", size=4)


def test_scales_scope_the_chart_as_the_short_forms_do():
    from herceg._chart import axis_scope

    settings = {"x": hg.AxisOptions(scope="chart"), "scales": {"x": hg.Scale(scope="panel")}}
    assert axis_scope(settings, "x") == "panel"
    assert axis_scope({"scales": {"y": {"scope": "row"}}}, "y") == "row"
    assert axis_scope({"x": {"scope": "column"}}, "x") == "column"
    with pytest.raises(ValueError, match="Chart navigator: needs one x scale shared by every"):
        hg.Chart(
            WEEK,
            panels=[hg.Panel(id="a"), hg.Panel(id="b")],
            scales={"x": hg.Scale(scope="panel")},
            navigator=True,
        )


def test_axes_with_layers_and_other_sides_render():
    chart = hg.Chart(
        WEEK,
        width=640,
        height=320,
        time_zone="UTC",
        x=hg.AxisOptions(ticks=hg.Ticks(every="6 hours"), format=hg.Format(time="%H:%M")),
        guides=[
            hg.axis(
                "x",
                layers=[
                    hg.TickLayer(
                        id="day",
                        ticks=hg.Ticks(every="day"),
                        format=hg.Format(time="%b %-d"),
                        labels=hg.TickLabels(row=1),
                    )
                ],
            ),
            hg.axis("y", place=hg.Place(side="right")),
        ],
    ).line(x="t", y="v")
    svg = chart.to_svg()
    assert ">06:00<" in svg and ">Sep 29<" in svg
    assert chart.to_pdf()[:5] == b"%PDF-"


def test_legends_and_colorbars_render():
    sites = hg.Chart(
        {"t": [0, 1, 0, 1], "site": ["A", "A", "B", "B"], "v": [1, 2, 3, 4]},
        width=480,
        height=300,
        legend=hg.LegendOptions(columns=2, title="Sites", place=hg.Place(side="bottom")),
    ).line(x="t", y="v", series="site")
    assert ">Sites<" in sites.to_svg()
    cells = hg.Chart(
        {"x": [0, 1, 0, 1], "y": ["a", "a", "b", "b"], "v": [-8.55, 2, 5, 12.3]},
        width=480,
        height=300,
        guides=[hg.colorbar(title="Gain", format=hg.Format(number="+.0f"))],
    ).heatmap(x="x", y="y", color="v")
    svg = cells.to_svg()
    assert ">Gain<" in svg and ">+10<" in svg and 'y1="1"' in svg


def test_guides_naming_a_mark_show_it_whatever_its_legend_setting():
    cells = hg.Chart(
        {"x": [0, 1, 0, 1], "y": [0, 0, 1, 1], "v": [1, 2, 3, 4]},
        width=480,
        height=300,
        guides=[hg.colorbar(title="Gain", scale=hg.ScaleRef(mark="h", channel="color"))],
    ).heatmap(x="x", y="y", color="v", id="h", legend=False)
    assert ">Gain<" in cells.to_svg()
    data = {"t": [0, 1, 0, 1], "site": ["A", "A", "B", "B"], "v": [1, 2, 3, 4]}
    # A color splitting series is the series' colors: either channel names them.
    for channel in ["color", "series"]:
        chart = hg.Chart(
            data,
            width=480,
            height=300,
            guides=[hg.legend(title="Sites", scales=[hg.ScaleRef(mark="curves", channel=channel)])],
        ).line(x="t", y="v", color="site", id="curves")
        svg = chart.to_svg()
        assert ">Sites<" in svg and ">A<" in svg and ">B<" in svg
    lone = hg.Chart(
        data,
        width=480,
        height=300,
        guides=[hg.legend(scales=[hg.ScaleRef(mark="curves", channel="size")])],
    ).line(x="t", y="v", color="site", id="curves")
    with pytest.raises(Exception, match='mark "curves" has no "size" scale; name one it has'):
        lone.to_svg()
