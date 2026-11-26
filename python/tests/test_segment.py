import re
import zlib

import pytest

import herceg as hg

DATA = {
    "id": ["F-1", "F-2", "F-3"],
    "start": [20.0, 80.0, 25.0],
    "end": [70.0, 30.0, -12.0],
    "confidence": [1.0, 0.0, 0.5],
    "age": [0.0, 30.0, 15.0],
    "category": ["energy", "metals", "energy"],
}
SCALES = {
    "widths": hg.ChannelScale(domain=(0, 1), range=(2, 7)),
    "fade": hg.ChannelScale(domain=(0, 30), range=(1, 0.35)),
}


def comets(**options):
    return hg.Chart(DATA, scales=SCALES).segment(
        x=("start", "end"),
        y="id",
        color="category",
        item_key="id",
        width=hg.SegmentWidth(start=hg.Channel(field="confidence", scale="widths"), end=1),
        caps=hg.Caps(start=hg.Dot(radius=3), end=hg.Arrow(length=10, width=8)),
        encode=hg.Encodings(opacity=hg.Channel(field="age", scale="fade")),
        **options,
    )


def mark_of(chart):
    return chart.to_spec()[0]["marks"][0]


def test_spec_writes_start_and_end_as_from_and_to():
    assert mark_of(comets(tooltip=hg.Tooltip(fields=["confidence"]))) == {
        "type": "segment",
        "x": ["start", "end"],
        "y": "id",
        "series": "category",
        "color": "category",
        "width": {"from": {"field": "confidence", "scale": "widths"}, "to": 1.0},
        "caps": {"from": {"dot": {"radius": 3.0}}, "to": {"arrow": {"length": 10.0, "width": 8.0}}},
        "encode": {"opacity": {"field": "age", "scale": "fade"}},
        "tooltip": {"fields": ["confidence"]},
        "itemKey": "id",
        "data": "data",
    }
    # Dumbbells and arrows: caps by name, one width, lists as pairs.
    arrows = hg.Chart(DATA).segment(
        x=["start", "end"], y="id", width=2, caps=hg.Caps(start="dot", end="arrow")
    )
    assert mark_of(arrows) == {
        "type": "segment",
        "x": ["start", "end"],
        "y": "id",
        "width": 2.0,
        "caps": {"from": "dot", "to": "arrow"},
        "data": "data",
    }
    # Sizes left out take their defaults; dicts make the options objects.
    defaults = hg.Chart(DATA).segment(
        x="start",
        y=("start", "end"),
        width={"start": 4, "end": hg.Channel(field="confidence", scale="widths")},
        caps={"end": hg.Arrow(length=12)},
    )
    assert mark_of(defaults)["caps"] == {"to": {"arrow": {"length": 12.0}}}
    assert mark_of(defaults)["width"] == {
        "from": 4.0,
        "to": {"field": "confidence", "scale": "widths"},
    }


def test_helper_takes_the_segments_width_and_the_charts_options():
    chart = hg.segment(
        DATA,
        x=("start", "end"),
        y="id",
        width=3,
        caps=hg.Caps(end="arrow"),
        title="Forecasts",
        tooltip=hg.Tooltip(fields=["age"]),
    )
    spec, _ = chart.to_spec()
    assert spec["title"] == "Forecasts"
    assert spec["marks"][0]["width"] == 3.0
    assert spec["marks"][0]["tooltip"] == {"fields": ["age"]}
    assert "width" not in spec
    # The chart's width is the chart's own.
    sized = hg.Chart(DATA, width=500).segment(x=("start", "end"), y="id", width=3)
    assert sized.to_spec()[0]["width"] == 500


def test_engine_draws_python_segments_as_outlines():
    svg = comets().to_svg()
    paths = re.findall(r'<path d="([^"]+)" fill="#[0-9a-f]{6}"[^>]*/>', svg)
    outlines = [d for d in paths if "a3 3 0 1 1" in d]
    # A body, a head, and a dot each.
    assert len(outlines) == 3
    for d in outlines:
        assert d.count("M") == 3
    pdf = comets().to_pdf()
    streams = re.findall(rb"stream\n(.*?)\nendstream", pdf, re.S)
    content = b"\n".join(zlib.decompress(stream) for stream in streams)
    # Each outline one nonzero fill of its three pieces.
    fills = re.findall(rb"((?:[^\n]* m\n(?:[^\n]* [lc]\n)+h\n){3})f\n", content)
    assert len(fills) == 3


@pytest.mark.parametrize(
    "make, message",
    [
        (
            lambda: hg.Chart(DATA).segment(x="start", y="id"),
            "segment x, y: a segment goes from one place to another; give x or y a pair of "
            'columns, x=("start", "end")',
        ),
        (
            lambda: hg.Caps(end="triangle"),
            'Caps end: expected "dot", "arrow", an hg.Dot, or an hg.Arrow; received "triangle"',
        ),
        (
            lambda: hg.Arrow(width=-8),
            "Arrow width: expected a number of at least 0; received -8",
        ),
        (lambda: hg.Dot(radius=-1), "Dot radius: expected a number of at least 0; received -1"),
        (
            lambda: hg.Chart(DATA).segment(x=("start", "end"), y="id", width=-2),
            "segment width: expected a number of at least 0; received -2",
        ),
        (
            lambda: hg.Chart(DATA).segment(
                x=("start", "end"), y="id", tooltip=hg.Tooltip(total=True)
            ),
            "segment tooltip total: a segment's points are ranges, which have no total; drop total",
        ),
        (
            lambda: hg.Chart(DATA).segment(x=("start", "end", "age"), y="id"),
            "segment x: expected a column's name, or a pair of them (start, end); received "
            "('start', 'end', 'age')",
        ),
        (
            lambda: hg.Chart(DATA).segment(x=("start", "category"), y="id"),
            "segment x[1]: column 'category' holds category values; expected number or time",
        ),
        (
            lambda: hg.Chart(DATA).segment(
                x=("start", "end"), y="id", width=hg.Channel(series=True, scale="widths")
            ),
            "segment width: each row has a width of its own; give a field, a value, or a condition",
        ),
        (
            lambda: hg.Chart(DATA).segment(
                x=("start", "end"), y="id", width=hg.Channel(field="missing")
            ),
            "segment width: no column 'missing'",
        ),
        (
            lambda: hg.Chart(DATA).segment(
                x=("start", "end"), y="id", encode=hg.Encodings(stroke_width=hg.Channel(value=2))
            ),
            "segment encode: has no stroke_width channel",
        ),
        (
            lambda: hg.Chart(DATA).segment(x=("start", "end"), y="id", width=hg.Channel(value=-2)),
            "segment width.value: expected 0 or more pixels; received -2",
        ),
        (
            lambda: hg.Chart(DATA).segment(
                x=("start", "end"),
                y="id",
                width=hg.SegmentWidth(start=3, end=hg.when(hg.col("age") > 10, -2, 1)),
            ),
            "segment width.to.condition.then: expected 0 or more pixels; received -2",
        ),
        (
            lambda: hg.Chart(DATA, scales=SCALES).segment(
                x=("start", "end"),
                y="id",
                encode=hg.Encodings(opacity=hg.Channel(series=True, scale="fade")),
            ),
            "segment encode.opacity: each row has an opacity of its own; give a field, a value, "
            "or a condition",
        ),
    ],
)
def test_refusals(make, message):
    with pytest.raises(hg.ChartError) as refused:
        make()
    assert str(refused.value).startswith(message)


def test_channels_read_columns_of_any_kind_through_their_scales():
    # A category through an ordinal scale gives each row its width, as on other marks.
    scales = {"thick": hg.OrdinalScale(domain=["energy", "metals"], map={"energy": 6, "metals": 2})}
    chart = hg.Chart(DATA, scales=scales).segment(
        x=("start", "end"), y="id", width=hg.Channel(field="category", scale="thick")
    )
    assert mark_of(chart)["width"] == {"field": "category", "scale": "thick"}
    # Each body's first and last corners are its start's two sides.
    bodies = [d.split("Z")[0] for d in re.findall(r'<path d="(M[^"]+)" fill="#', chart.to_svg())]
    across = set()
    for body in bodies:
        points = [[float(n) for n in p.split()] for p in re.split("[ML]", body) if p]
        across.add(round(abs(points[0][1] - points[-1][1]), 1))
    assert across == {6.0, 2.0}
