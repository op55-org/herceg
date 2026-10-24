"""Encodings, scales of categories, styles by series, continuity, annotation
places, and labels: their spec, the columns they send, and their errors in
Python names."""

import datetime as dt

import numpy as np
import pytest

import herceg as hg

SITES = {
    "t": [0.0, 1.0, 2.0, 0.0, 1.0, 2.0],
    "gain": [1.0, 2.0, 3.0, 2.0, 1.0, 0.5],
    "site": ["A", "A", "A", "Average", "Average", "Average"],
    "region": ["n", "n", "s", "n", "s", "s"],
    "quality": [1.0, 0.2, 1.0, 1.0, 1.0, 1.0],
    "unused": [0.0] * 6,
}


def marks(chart):
    spec, _ = chart.to_spec()
    return spec["marks"]


def columns(chart):
    spec, _ = chart.to_spec()
    return sorted(spec["data"]["data"]["columns"])


def test_colors_by_column_go_through_the_charts_color_scale():
    scale = hg.OrdinalScale(map={"Average": "#222222"}, unknown="#999999")
    chart = hg.Chart(SITES, scales={"color": scale}).line(
        x="t", y="gain", series="site", color="site"
    )
    spec, _ = chart.to_spec()
    assert spec["scales"] == {
        "color": {"type": "ordinal", "map": {"Average": "#222222"}, "unknown": "#999999"}
    }
    assert marks(chart)[0]["color"] == "site"
    assert 'stroke="#222222"' in chart.to_svg()
    domain = hg.OrdinalScale(domain=["Average", "A"])._spec()
    assert domain == {"type": "ordinal", "domain": ["Average", "A"]}


def test_ordinal_scales_are_scales_of_categories_and_position_scales_place_values():
    with pytest.raises(TypeError, match="unexpected keyword argument 'nice'"):
        hg.OrdinalScale(nice=True)  # type: ignore[call-arg]
    with pytest.raises(TypeError, match="OrdinalScale domain: a scale of categories' domain is"):
        hg.OrdinalScale(domain=[1, 2])  # type: ignore[list-item]
    with pytest.raises(TypeError, match="unexpected keyword argument 'map'"):
        hg.Scale(map={"A": "#000"})  # type: ignore[call-arg]
    with pytest.raises(hg.ChartError, match="Chart scales y: places values on an axis"):
        hg.Chart(SITES, scales={"y": hg.OrdinalScale()}).to_spec()
    with pytest.raises(
        hg.ChartError, match="Chart scales sites: a position scale of the chart's own says its type"
    ):
        hg.Chart(SITES, scales={"sites": hg.Scale()}).to_spec()
    spec, _ = hg.Chart(SITES, scales={"sites": hg.Scale(type="linear")}).to_spec()
    assert spec["scales"]["sites"] == {"type": "linear"}
    # A dict of a name other than a position's is an ordinal scale's options.
    spec, _ = hg.Chart(SITES, scales={"sites": {"map": {"A": "#000000"}}}).to_spec()
    assert spec["scales"]["sites"] == {"type": "ordinal", "map": {"A": "#000000"}}


def test_channels_take_columns_constants_and_conditions():
    encode = hg.Encodings(
        stroke_width=hg.Channel(value=3),
        opacity=hg.when(hg.col("site") == "Average", 1, 0.4),
        dash={"field": "site", "scale": "dashes"},
    )
    chart = hg.Chart(
        SITES, scales={"dashes": hg.OrdinalScale(map={"Average": "--", "A": [4, 2]})}
    ).line(x="t", y="gain", series="site", encode=encode)
    assert marks(chart)[0]["encode"] == {
        "dash": {"field": "site", "scale": "dashes"},
        "strokeWidth": {"value": 3},
        "opacity": {
            "condition": {"when": ["==", ["field", "site"], "Average"], "then": 1, "otherwise": 0.4}
        },
    }
    spec, _ = chart.to_spec()
    assert spec["scales"]["dashes"]["map"]["A"] == [4.0, 2.0]
    assert "<path" in chart.to_svg()


def test_channels_are_checked_in_python_names():
    with pytest.raises(hg.ChartError, match="Channel: give field, value, or series=True, one of"):
        hg.Channel()
    with pytest.raises(hg.ChartError, match="Channel scale: maps a column's values or the series'"):
        hg.Channel(value="#000", scale="color")
    with pytest.raises(hg.ChartError, match="Channel series: names series through a scale"):
        hg.Channel(series=True)
    assert hg.Channel(series=True, scale="fit")._spec() == {"series": True, "scale": "fit"}
    with pytest.raises(TypeError, match="Encodings opacity: an expression gives a channel only"):
        hg.Encodings(opacity=hg.col("gain"))
    with pytest.raises(TypeError, match="Encodings color: a condition's then is a constant"):
        hg.Encodings(color=hg.when(hg.col("gain") > 1, hg.col("site"), "#000"))
    with pytest.raises(ValueError, match="area encode: has no dash channel; give"):
        hg.Chart(SITES).area(x="t", y="gain", encode=hg.Encodings(dash=hg.Channel(value="--")))
    with pytest.raises(ValueError, match="line style: has no leader; give"):
        hg.Chart(SITES).line(x="t", y="gain", style=hg.MarkStyle(leader={"stroke": "#000"}))
    with pytest.raises(ValueError, match="line markers: expected True, False, or a shape"):
        hg.Chart(SITES).line(x="t", y="gain", markers="hexagon")


def test_styles_by_series_markers_and_conditions_send_the_columns_they_read():
    # A style map gives each series one look: its column is one value per series.
    sites = {**SITES, "region": ["n", "n", "n", "s", "s", "s"]}
    chart = hg.Chart(sites).line(
        x="t",
        y="gain",
        series="site",
        style=hg.MarkStyle(
            by=hg.StyleMap(
                field="region",
                map={"s": hg.SeriesStyle(dash="--", marker=hg.MarkerStyle(symbol="x"))},
            ),
            marker={"radius": 4},
        ),
        markers=True,
        continuity=hg.Continuity(defined=hg.col("quality") >= 0.5),
        where=hg.col("gain") < 3,
    )
    mark = marks(chart)[0]
    assert mark["style"] == {
        "by": {"field": "region", "map": {"s": {"dash": "--", "marker": {"symbol": "x"}}}},
        "marker": {"radius": 4},
    }
    assert mark["markers"] is True
    assert mark["continuity"] == {"defined": [">=", ["field", "quality"], 0.5]}
    assert mark["where"] == ["<", ["field", "gain"], 3]
    assert columns(chart) == ["gain", "quality", "region", "site", "t"]


def test_continuity_takes_durations_calendar_units_and_columns():
    hour = hg.Continuity(max_gap=hg.Duration(hours=1, minutes=30))._spec()
    assert hour == {"maxGap": {"milliseconds": 5_400_000}}
    assert hg.Continuity(max_gap=dt.timedelta(seconds=2))._spec() == {
        "maxGap": {"milliseconds": 2000}
    }
    assert hg.Continuity(max_gap=np.timedelta64(3, "s"))._spec() == {
        "maxGap": {"milliseconds": 3000}
    }
    assert hg.Continuity(max_gap=2, break_by="day")._spec() == {"maxGap": 2.0, "breakBy": "day"}
    chart = hg.Chart(SITES).line(
        x="t", y="gain", continuity=hg.Continuity(break_by=hg.col("region"))
    )
    assert marks(chart)[0]["continuity"] == {"breakBy": {"field": "region"}}
    assert "region" in columns(chart)
    with pytest.raises(ValueError, match="Continuity break_by: expected"):
        hg.Continuity(break_by="fortnight")
    with pytest.raises(TypeError, match="Continuity break_by: expected a calendar unit"):
        hg.Continuity(break_by=hg.col("a") > 1)
    with pytest.raises(ValueError, match="Continuity max_gap: expected a positive number"):
        hg.Continuity(max_gap=0)
    with pytest.raises(ValueError, match="Duration: expected a positive time"):
        hg.Duration()


def test_conditional_bands_shade_where_the_condition_holds():
    data = {"t": [0, 1, 2, 3, 4], "e": [0.0, 0.5, 1.5, 1.5, 0.5], "limit": [1.0] * 5}
    chart = (
        hg.Chart(data, width=300, height=150)
        .area(x="t", y1="e", y2="limit", where=hg.col("e") < hg.col("limit"), curve="step-after")
        .line(x="t", y="e", curve="step-after")
    )
    assert marks(chart)[0]["where"] == ["<", ["field", "e"], ["field", "limit"]]
    assert "<path" in chart.to_svg()
    with pytest.raises(ValueError, match="area where: stacked areas cannot leave rows out yet"):
        hg.Chart(SITES).area(x="t", y="gain", series="site", stack=True, where=hg.col("gain") > 1)


def test_bars_group_unless_asked_to_overlap_and_take_outlines_and_label_objects():
    sales = {"month": ["Jan", "Jan", "Feb", "Feb"], "v": [1.0, 2.0, 3.0, 4.0], "r": [*"abab"]}
    grouped = marks(hg.bar(sales, x="month", y="v", series="r"))[0]
    assert "dodge" not in grouped
    overlapping = marks(hg.bar(sales, x="month", y="v", series="r", dodge=False))[0]
    assert overlapping["dodge"] is False
    labels = hg.BarLabels(
        format=hg.Format(number=".1f"), style=hg.TextStyle(font_size=10), min_length=20
    )
    chart = hg.bar(
        sales,
        x="month",
        y="v",
        series="r",
        dodge=True,
        stroke="#222222",
        stroke_width=1,
        labels=labels,
        width=300,
        height=150,
    )
    mark = marks(chart)[0]
    assert (mark["dodge"], mark["stroke"], mark["strokeWidth"]) == (True, "#222222", 1)
    assert mark["labels"] == {
        "format": {"number": ".1f"},
        "style": {"fontSize": 10},
        "minLength": 20,
    }
    assert 'stroke="#222222"' in chart.to_svg()
    with pytest.raises(ValueError, match="bar dodge: stacked bars pile up in one slot"):
        hg.bar(sales, x="month", y="v", series="r", dodge=True, stack=True)
    with pytest.raises(TypeError, match="BarLabels style: expected an hg.TextStyle"):
        hg.BarLabels(style="percent")
    inside = hg.BarLabels(place=hg.LabelPlace(attachment="center", outside=False))
    assert inside._spec() == {"place": {"attachment": "center", "outside": False}}
    with pytest.raises(ValueError, match="BarLabels place: bars' labels take attachment"):
        hg.BarLabels(place={"side": "top"})


def test_bars_color_by_column_as_series_or_each_bar_with_series_false():
    sales = {"month": ["Jan", "Feb"], "v": [1.0, 3.0], "good": ["yes", "no"]}
    chart = hg.Chart(sales, scales={"color": hg.OrdinalScale(map={"no": "#c00000"})})
    grouped = chart.bar(x="month", y="v", color="good")
    assert marks(grouped)[0]["color"] == "good"
    assert "series" not in marks(grouped)[0]
    assert "good" in columns(grouped)
    assert "#c00000" in grouped.to_svg()
    each = hg.Chart(sales).bar(x="month", y="v", color="good", series=False)
    assert marks(each)[0]["series"] is False
    assert "<path" in each.to_svg()


def test_annotation_places_mix_values_fractions_pixels_and_offsets():
    chart = (
        hg.Chart(SITES, width=300, height=150)
        .line(x="t", y="gain")
        .rule(
            y=hg.DataPosition(2, offset=-1),
            span=(hg.Fraction(0.25), 2),
            label=hg.Label(text="Goal", place=hg.LabelPlace(attachment="start", outside=True)),
            stroke_opacity=0.5,
        )
        .region(
            x1=hg.Pixels(10),
            x2=hg.Fraction(0.5, frame="chart"),
            label=hg.Label(text="early", place={"side": "bottom"}),
            contribute_domain=True,
        )
        .text(
            at=hg.Position(x=hg.Fraction(0.03), y=1.7),
            label=hg.Label(text="Peak", style=hg.TextStyle(font_weight=600)),
        )
    )
    rule, region, text = marks(chart)[1:]
    assert rule == {
        "type": "rule",
        "y": {"data": 2.0, "offset": -1.0},
        "span": [{"fraction": 0.25}, {"data": 2.0}],
        "strokeOpacity": 0.5,
        "label": {"text": "Goal", "place": {"attachment": "start", "outside": True}},
    }
    assert region["x1"] == {"px": 10.0}
    assert region["x2"] == {"fraction": 0.5, "frame": "chart"}
    assert region["contributeDomain"] is True
    assert text["at"] == {"x": {"fraction": 0.03}, "y": {"data": 1.7}}
    svg = chart.to_svg()
    assert ">Goal</text>" in svg and ">Peak</text>" in svg
    assert 'font-weight="600"' in svg
    assert chart.to_pdf().startswith(b"%PDF")


def test_annotations_read_columns_for_places_and_labels():
    events = {"at": [1.0, 2.0], "name": ["deploy", "rollback"], "unused": [0.0, 0.0]}
    chart = (
        hg.Chart(SITES)
        .line(x="t", y="gain")
        .rule(x="at", label=hg.Label(field="name"), data=events)
        .text(
            data=events,
            at=hg.Position(x="at", y=hg.Fraction(0.9)),
            label={"field": "name", "style": {"align": "end"}},
        )
    )
    spec, _ = chart.to_spec()
    assert sorted(spec["data"]["data2"]["columns"]) == ["at", "name"]
    spans = hg.Chart(SITES).line(x="t", y="gain").rule(y=2, span=("t", 2), data=SITES)
    assert marks(spans)[1]["span"] == [{"field": "t"}, {"data": 2.0}]
    assert "svg" in spans.to_svg()
    assert spec["marks"][2]["at"] == {"x": {"field": "at"}, "y": {"fraction": 0.9}}
    assert ">rollback</text>" in chart.to_svg()
    with pytest.raises(ValueError, match="text: needs a place; give x and y, or at="):
        hg.Chart(SITES).text(x=1, label="a")
    with pytest.raises(ValueError, match="DataPosition: give a value or field, one of them"):
        hg.DataPosition()
    with pytest.raises(ValueError, match="LabelPlace attachment: expected"):
        hg.LabelPlace(attachment="middle")  # type: ignore[arg-type]


def test_stack_objects_say_offset_order_and_gaps():
    usage = {"t": [0, 1, 2], "a": [1.0, 2.0, 1.0], "b": [2.0, 1.0, 2.0]}
    chart = hg.area(usage, x="t", y=["a", "b"], stack=hg.Stack(offset="wiggle", order="inside-out"))
    assert marks(chart)[0]["stack"] == {"offset": "wiggle", "order": "inside-out"}
    assert marks(hg.area(usage, x="t", y=["a", "b"], stack={"offset": "fill"}))[0]["stack"] == {
        "offset": "fill"
    }
    with pytest.raises(ValueError, match="Stack offset: expected"):
        hg.Stack(offset="silhouette")  # type: ignore[arg-type]


EVENTS = {
    "t": [0.0, 1.0, 2.0, 3.0],
    "v": [1.0, 2.0, 3.0, 4.0],
    "kind": ["Optimal", "Threshold", "Optimal", "Other"],
    "badge": ["#d62728", "#1f77b4", "teal", "#d62728"],
    "area": [16.0, 64.0, 36.0, 100.0],
}


def test_points_take_channels_through_named_and_identity_scales():
    chart = hg.Chart(
        EVENTS,
        scales={
            "badges": hg.IdentityScale(),
            "shapes": hg.OrdinalScale(map={"Optimal": "circle", "Threshold": "triangle-down"}),
            "sizes": hg.OrdinalScale(map={"Optimal": 36, "Threshold": 64}, unknown=16),
        },
    ).point(
        x="t",
        y="v",
        series=False,
        color=hg.Channel(field="badge", scale="badges"),
        symbol=hg.Channel(field="kind", scale="shapes"),
        size=hg.Channel(field="kind", scale="sizes"),
    )
    mark = marks(chart)[0]
    assert mark["color"] == {"field": "badge", "scale": "badges"}
    assert mark["symbol"] == {"field": "kind", "scale": "shapes"}
    assert mark["size"] == {"field": "kind", "scale": "sizes"}
    # Colors a column holds are drawn as they are, read as static output reads CSS.
    assert 'fill="#008080"' in chart.to_svg()
    # Areas a column holds, colors by a condition, and opacities in encode.
    chart = hg.Chart(EVENTS).point(
        x="t",
        y="v",
        size=hg.Channel(field="area", scale=hg.IdentityScale()),
        color=hg.when(hg.col("v") > 2, "#d62728", "#999999"),
        encode=hg.Encodings(opacity=hg.Channel(value=0.5), stroke=hg.Channel(value="#000")),
    )
    mark = marks(chart)[0]
    assert mark["size"] == {"field": "area", "scale": {"type": "identity"}}
    assert mark["encode"] == {"stroke": {"value": "#000"}, "opacity": {"value": 0.5}}
    assert "<path" in chart.to_svg()


def test_points_refuse_what_their_channels_cannot_read():
    points = hg.Chart(EVENTS)
    with pytest.raises(hg.ChartError, match="point color.value: expected a CSS color"):
        points.point(x="t", y="v", color=hg.Channel(value="garbage"))
    with pytest.raises(hg.ChartError, match="point size.value: expected an area of 0 or more"):
        points.point(x="t", y="v", size=hg.Channel(value=-1))
    with pytest.raises(
        hg.ChartError, match="point size.field: column 'kind' holds categories, which sizes"
    ):
        points.point(x="t", y="v", size=hg.Channel(field="kind"))
    with pytest.raises(
        hg.ChartError, match="point encode.opacity: set as fill_opacity and as encode.opacity"
    ):
        points.point(
            x="t", y="v", fill_opacity=0.5, encode=hg.Encodings(opacity=hg.Channel(value=1))
        )
    with pytest.raises(hg.ChartError, match="point encode.stroke: points of a mark draw one"):
        points.point(x="t", y="v", encode=hg.Encodings(stroke=hg.Channel(field="badge")))
    with pytest.raises(ValueError, match="point colors: a ramp colors a number column"):
        points.point(x="t", y="v", color=hg.Channel(field="kind"), colors="viridis")


def test_point_conditions_carry_the_columns_they_read():
    data = {"t": [0.0, 1.0], "v": [1.0, 2.0], "flag": [0.0, 1.0], "other": [5.0, 6.0]}
    chart = hg.Chart(data).point(
        x="t", y="v", color=hg.when(hg.col("flag") > 0, "#d62728", "#1f77b4")
    )
    spec, _ = chart.to_spec()
    columns = next(iter(spec["data"].values()))["columns"]
    assert "flag" in columns
    assert "other" not in columns
    assert 'fill="#d62728"' in chart.to_svg()


def test_point_channels_name_scales_the_chart_has():
    chart = hg.Chart(EVENTS).point(x="t", y="v", color=hg.Channel(field="kind", scale="missing"))
    with pytest.raises(hg.ChartError, match="point color scale: the chart has no scale 'missing'"):
        chart.to_spec()


def test_point_colors_a_column_holds_split_no_series():
    chart = hg.Chart(EVENTS).point(
        x="t", y="v", color=hg.Channel(field="badge", scale=hg.IdentityScale())
    )
    spec, _ = chart.to_spec()
    assert "series" not in spec["marks"][0]
    # A category channel's column names the series, as the column's name does.
    chart = hg.Chart(EVENTS).point(x="t", y="v", color=hg.Channel(field="kind"))
    assert len(chart.to_svg().split(">Optimal<")) == 2


def test_line_looks_change_along_a_series_where_channels_read_rows():
    forecast = {
        "t": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
        "v": [1.0, 3.0, 2.0, 4.0, 5.0, 6.0],
        "estimated": [0, 0, 0, 0, 1, 1],
    }
    chart = hg.Chart(forecast).line(
        x="t",
        y="v",
        encode=hg.Encodings(
            dash=hg.when(hg.col("estimated") > 0, ":", "-"),
            opacity=hg.when(hg.col("estimated") > 0, 0.5, 1),
        ),
    )
    # One series, drawn in two looks: the observed and the estimated.
    svg = chart.to_svg()
    assert svg.count('<clipPath id="herceg-cut-') == 2
    spec, _ = chart.to_spec()
    assert "series" not in spec["marks"][0]
