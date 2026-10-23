"""Marks placed by coordinates their columns give: shares of the plot,
pixels from its edge, offsets, and position scales of the chart's own."""

import re

import pytest

import herceg as hg

DATA = {
    "t": [0.0, 1.0, 2.0, 3.0],
    "v": [10.0, 20.0, 30.0, 40.0],
    "lane": [0.25, 0.25, 0.75, 0.75],
    "d": [100.0, 400.0, 250.0, 900.0],
    "kind": ["a", "b", "a", "b"],
}


def chart(**options):
    return hg.Chart(DATA, width=400, height=200, legend=False, **options)


@pytest.mark.contract("position.fraction.rows.python")
def test_rows_are_placed_by_the_shares_their_columns_give():
    lanes = chart().line(x="t", y="v").point(x="t", y=hg.Fraction(field="lane"))
    spec, _ = lanes.to_spec()
    assert spec["marks"][1]["y"] == {"fraction": {"field": "lane"}}
    # Drawn in every format (the engine's tests check where).
    assert lanes.to_svg().startswith("<svg")
    assert lanes.to_png().startswith(b"\x89PNG")
    assert lanes.to_pdf().startswith(b"%PDF")


@pytest.mark.contract("position.scale.own.python")
def test_scales_of_the_chart_own_place_values_and_take_an_axis():
    depth = (
        chart(
            scales={"depth": hg.Scale(type="linear")},
            guides=[hg.axis(scale="depth", place={"side": "right"}, title="Depth")],
        )
        .line(x="t", y="v")
        .line(x="t", y=hg.DataPosition(field="d", scale="depth"))
    )
    spec, _ = depth.to_spec()
    assert spec["marks"][1]["y"] == {"field": "d", "scale": "depth"}
    svg = depth.to_svg()
    assert "Depth" in svg and re.search(r">1,000<", svg)


@pytest.mark.contract("position.row.refused.python")
def test_row_coordinates_are_checked_as_the_engine_checks_them():
    with pytest.raises(hg.ChartError) as refused:
        chart().line(x="t", y=hg.Fraction(0.5))
    assert (refused.value.code, refused.value.path) == ("invalid-option", "marks[0].y.fraction")
    with pytest.raises(hg.ChartError) as refused:
        chart().line(x="t", y=hg.Fraction(field="kind"))
    assert (refused.value.code, refused.value.path) == ("field-type", "marks[0].y.fraction.field")
    with pytest.raises(hg.ChartError) as refused:
        chart().area(x="t", y1=hg.Fraction(field="lane"), y2="v")
    assert (refused.value.code, refused.value.path) == ("unsupported", "marks[0].y2")
    with pytest.raises(hg.ChartError) as refused:
        chart().line(x="t", y=hg.DataPosition(field="v", scale="x"))
    assert (refused.value.code, refused.value.path) == ("invalid-option", "marks[0].y.scale")
    with pytest.raises(hg.ChartError) as refused:
        chart().error_bar(x="t", y=hg.Fraction(field="lane"), y_error="v")
    assert (refused.value.code, refused.value.path) == ("invalid-option", "marks[0].y")


@pytest.mark.contract("position.fraction.annotations.python")
def test_annotations_take_shares_from_columns():
    ruled = chart().line(x="t", y="v").rule(y=hg.Fraction(field="lane"))
    spec, _ = ruled.to_spec()
    assert spec["marks"][1]["y"] == {"fraction": {"field": "lane"}}
    assert ruled.to_svg().count("<line") >= 4


@pytest.mark.contract("position.scale.unknown.python")
def test_places_name_position_scales_the_chart_has():
    for scales in (None, {"kind": hg.OrdinalScale()}):
        named = "missing" if scales is None else "kind"
        made = chart(scales=scales).line(x="t", y=hg.DataPosition(field="v", scale=named))
        with pytest.raises(hg.ChartError) as refused:
            made.to_spec()
        assert (refused.value.code, refused.value.path) == ("unknown-reference", "marks[0].y.scale")
        assert f'no position scale "{named}"' in str(refused.value)
    ruled = chart().line(x="t", y="v").rule(y=hg.DataPosition(3, scale="depth"))
    with pytest.raises(hg.ChartError) as refused:
        ruled.to_spec()
    assert refused.value.path == "marks[1].y.scale"
