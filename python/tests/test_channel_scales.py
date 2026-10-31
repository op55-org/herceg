"""Channel scales (``hg.ChannelScale``): number columns read onto widths,
opacities, sizes, and colors through the chart's ``scales``, and regions
painted per row with ``encode``: their spec, what they draw, and their
errors in Python names."""

import re

import pytest

import herceg as hg

ROWS = {
    "x": [0.0, 1.0, 2.0, 3.0, 4.0],
    "y": [1.0, 2.0, 3.0, 4.0, 5.0],
    "age": [0.0, 10.0, 20.0, 30.0, 40.0],
    "share": [0.0, 0.25, 0.5, 0.75, 1.0],
}


def spec_of(chart):
    spec, _ = chart.to_spec()
    return spec


@pytest.mark.contract("channel.scale.continuous.python")
def test_channel_scales_map_number_columns_onto_widths_opacities_and_colors():
    chart = hg.Chart(
        ROWS,
        scales={
            "fade": hg.ChannelScale(domain=(0, 30), range=(1, 0.4)),
            "heat": hg.ChannelScale(range=("#000000", "#ffffff")),
            "widths": {"type": "sqrt", "range": [1, 4], "clamp": True},
        },
    ).point(
        x="x",
        y="y",
        series=False,
        encode=hg.Encodings(
            opacity=hg.Channel(field="age", scale="fade"),
            color=hg.Channel(field="share", scale="heat"),
        ),
    )
    spec = spec_of(chart)
    assert spec["scales"] == {
        "fade": {"type": "linear", "domain": [0.0, 30.0], "range": [1.0, 0.4]},
        "heat": {"type": "linear", "range": ["#000000", "#ffffff"]},
        "widths": {"type": "sqrt", "range": [1.0, 4.0], "clamp": True},
    }
    svg = chart.to_svg()
    # Opacities past the domain's end extend it, kept from 0 to 1; colors ramp.
    opacities = [float(o) for o in re.findall(r'fill-opacity="([\d.]+)"', svg)]
    assert [round(o, 3) for o in opacities[:5]] == [1, 0.8, 0.6, 0.4, 0.2]
    assert '"#808080"' in svg or 'fill="#808080"' in svg
    # Lines and bars take number columns through them too.
    widths = hg.Chart(ROWS, scales={"widths": hg.ChannelScale(range=(1, 5))}).line(
        x="x", y="y", encode=hg.Encodings(stroke_width=hg.Channel(field="age", scale="widths"))
    )
    assert spec_of(widths)["marks"][0]["encode"] == {
        "strokeWidth": {"field": "age", "scale": "widths"}
    }
    assert "stroke-width" in widths.to_svg()


def test_channel_scales_are_checked_in_python_names():
    with pytest.raises(hg.ChartError, match=r"ChannelScale type: expected"):
        hg.ChannelScale(type="pow", range=(0, 1))  # type: ignore[arg-type]
    with pytest.raises(
        hg.ChartError, match=r"ChannelScale range: a range of numbers is \(low, high\)"
    ):
        hg.ChannelScale(range=(0, 1, 2))
    with pytest.raises(
        hg.ChartError, match=r"ChannelScale range: expected two numbers, or two or more colors"
    ):
        hg.ChannelScale(range=("red", "#ffffff"))
    with pytest.raises(
        hg.ChartError, match=r"ChannelScale domain: expected two different positive finite numbers"
    ):
        hg.ChannelScale(type="log", domain=(0, 10), range=(0, 1))
    with pytest.raises(hg.ChartError, match=r"ChannelScale clamp: expected True or False"):
        hg.ChannelScale(range=(0, 1), clamp="yes")  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError, match=r"Chart scales x: places values on an axis"):
        hg.Chart(ROWS, scales={"x": hg.ChannelScale(range=(0, 1))}).line(x="x", y="y").to_spec()
    # The engine refuses outputs the channel cannot draw, at the scale.
    chart = hg.Chart(ROWS, scales={"s": hg.ChannelScale(range=(0, 2))}).point(
        x="x", y="y", encode=hg.Encodings(opacity=hg.Channel(field="age", scale="s"))
    )
    with pytest.raises(hg.ChartError, match=r"expected a number from 0 to 1; received 2"):
        chart.to_svg()


CELLS = {
    "start": [0.0, 0.0, 10.0, 10.0],
    "end": [10.0, 10.0, 25.0, 25.0],
    "bottom": [0.0, 0.4, 0.0, 0.7],
    "top": [0.4, 1.0, 0.7, 1.0],
    "segment": ["Veg", "Nut", "Veg", "Nut"],
    "share": [0.4, 0.6, 0.7, 0.3],
}


@pytest.mark.contract("region.encode.rows.python")
def test_regions_of_rows_take_paint_per_row():
    chart = hg.Chart(
        x=hg.AxisOptions(domain=(0, 25), nice=False),
        y=hg.AxisOptions(domain=(0, 1), nice=False),
        scales={"segments": hg.OrdinalScale(map={"Veg": "#1b9e77", "Nut": "#7570b3"})},
    ).region(
        data=CELLS,
        x1="start",
        x2="end",
        y1="bottom",
        y2="top",
        fill_opacity=1,
        encode=hg.Encodings(
            fill=hg.Channel(field="segment", scale="segments"),
            opacity=hg.Channel(field="share", scale=hg.IdentityScale()),
        ),
    )
    mark = spec_of(chart)["marks"][0]
    assert mark["encode"] == {
        "fill": {"field": "segment", "scale": "segments"},
        "opacity": {"field": "share", "scale": {"type": "identity"}},
    }
    svg = chart.to_svg()
    painted = re.findall(r'fill="(#1b9e77|#7570b3)" fill-opacity="([\d.]+)"', svg)
    assert painted == [
        ("#1b9e77", "0.4"),
        ("#7570b3", "0.6"),
        ("#1b9e77", "0.7"),
        ("#7570b3", "0.3"),
    ]


def test_region_encode_reads_the_charts_data_too():
    chart = hg.Chart(
        CELLS,
        x=hg.AxisOptions(domain=(0, 25)),
        scales={"segments": hg.OrdinalScale(map={"Veg": "#1b9e77", "Nut": "#7570b3"})},
    ).region(
        x1="start",
        x2="end",
        encode=hg.Encodings(fill=hg.Channel(field="segment", scale="segments")),
    )
    assert spec_of(chart)["marks"][0]["data"] == "data"
    assert 'fill="#7570b3"' in chart.to_svg()


def test_region_encode_is_refused_where_it_cannot_read_rows():
    with pytest.raises(hg.ChartError, match=r"region encode: channels read the rows of a table"):
        hg.Chart().region(x1=0, x2=1, encode=hg.Encodings(fill=hg.Channel(value="#000000")))
    with pytest.raises(hg.ChartError, match=r"region encode: has no stroke_width channel"):
        hg.Chart().region(
            data=CELLS,
            x1="start",
            x2="end",
            encode=hg.Encodings(stroke_width=hg.Channel(value=2)),
        )
    with pytest.raises(hg.ChartError, match=r"region encode.fill.field"):
        hg.Chart().region(
            data=CELLS, x1="start", x2="end", encode=hg.Encodings(fill=hg.Channel(field="share"))
        )


def test_region_encode_refuses_the_series_names():
    with pytest.raises(hg.ChartError, match=r"region encode.fill: regions have no series"):
        hg.Chart().region(
            data=CELLS,
            x1="start",
            x2="end",
            encode=hg.Encodings(fill=hg.Channel(series=True, scale="segments")),
        )


def test_an_empty_region_encode_is_no_reader_of_rows():
    chart = hg.Chart().region(x1=0, x2=1, encode=hg.Encodings())
    mark = spec_of(chart)["marks"][0]
    assert "encode" not in mark and "data" not in mark


def test_channel_scale_colors_are_spelled_as_the_engine_reads_them():
    with pytest.raises(hg.ChartError, match=r"ChannelScale range: expected two numbers"):
        hg.ChannelScale(range=(" #000000", "#ffffff "))
    chart = hg.Chart(
        ROWS, scales={"heat": hg.ChannelScale(range=("#000000", "var(--end, #ffffff)"))}
    ).point(x="x", y="y", encode=hg.Encodings(color=hg.Channel(field="share", scale="heat")))
    assert "<svg" in chart.to_svg()
