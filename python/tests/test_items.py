"""Marks placed by a layout mark's items (``hg.ItemCoordinate``, text
``from_=hg.ItemAnchor``) beside it, as decorations, and bars along y."""

import re

import pandas as pd
import pytest

import herceg as hg

# B8's Marimekko: markets as columns, segments as their cells.
SALES = pd.DataFrame(
    {
        "market": ["Auburn, AL", "Auburn, AL", "Birmingham, AL"],
        "segment": ["Almond lovers", "Berry buyers", "Almond lovers"],
        "value": [3840.0, 1920.0, 1600.0],
    }
)
MARKETS = pd.DataFrame({"market": ["Auburn, AL", "Birmingham, AL"], "total": [5760.0, 1600.0]})


def cells() -> hg.Chart:
    return hg.Chart(padding={"top": 28}, legend=False).treemap(
        data=SALES, path=["market", "segment"], value="value", id="cells", labels=False
    )


def names_above(chart: hg.Chart) -> hg.Chart:
    return chart.text(
        data=MARKETS,
        from_=hg.ItemAnchor("cells", [hg.col("market")], at="top-left", offset=(3, -16)),
        label=hg.Label(field="market"),
        id="names",
    )


def test_item_places_go_into_the_spec_as_the_engine_reads_them():
    chart = names_above(cells()).rule(
        data=MARKETS, x=hg.ItemCoordinate("cells", [hg.col("market")], at="start"), id="edges"
    )
    spec, _ = chart.to_spec()
    names, edges = spec["marks"][1:]
    assert names["from"] == {
        "mark": "cells",
        "item": [{"field": "market"}],
        "at": "top-left",
        "offset": {"x": 3.0, "y": -16.0},
    }
    assert edges["x"] == {"item": {"mark": "cells", "item": [{"field": "market"}]}, "at": "start"}
    # One name is a list of one; offsets and constant names pass through.
    one = hg.ItemCoordinate("cells", "Auburn, AL", at="end", offset=-2)
    region = cells().region(x1=hg.ItemCoordinate("cells", "Auburn, AL"), x2=one)
    assert region.to_spec()[0]["marks"][1]["x2"] == {
        "item": {"mark": "cells", "item": ["Auburn, AL"]},
        "at": "end",
        "offset": -2.0,
    }


def test_names_above_columns_and_rules_at_their_edges_draw_in_static_svg():
    chart = names_above(cells()).rule(
        data=MARKETS, x=hg.ItemCoordinate("cells", [hg.col("market")]), stroke="black"
    )
    svg = chart.to_svg(size=(600, 400))
    # Both names, hung above the plot's top (the treemap fills the plot).
    found = re.findall(r'<text x="([\d.]+)" y="([\d.]+)"[^>]*>(Auburn, AL|Birmingham, AL)<', svg)
    assert [name for *_, name in found] == ["Auburn, AL", "Birmingham, AL"]
    assert float(found[0][0]) < float(found[1][0])
    assert all(float(y) < 40 for _, y, _ in found)
    # And a black rule at each column's left edge.
    assert len(re.findall(r'stroke="#000000"', svg)) == 2
    assert chart.to_pdf().startswith(b"%PDF")


def test_labels_of_text_by_items_are_those_of_text_at_a_place():
    label = hg.Label(text="note", overlap="hide", overlap_group="notes")
    chart = cells().text(from_=hg.ItemAnchor("cells", ["Auburn, AL"], at="center"), label=label)
    assert ">note<" in chart.to_svg(size=(600, 400))
    with pytest.raises(hg.ChartError, match="text label: text goes where at says; drop place"):
        cells().text(
            from_=hg.ItemAnchor("cells", ["Auburn, AL"], at="center"),
            label=hg.Label(text="note", place=hg.LabelPlace(outside=True)),
        )


def test_names_of_items_read_category_columns():
    with pytest.raises(hg.ChartError, match=r"text from_\.item\[0\]: column 'total' holds number"):
        cells().text(
            data=MARKETS,
            from_=hg.ItemAnchor("cells", [hg.col("total")], at="top"),
            label="x",
        )
    with pytest.raises(hg.ChartError, match=r"rule x\.item\[0\]: no column 'nope'"):
        cells().rule(data=MARKETS, x=hg.ItemCoordinate("cells", [hg.col("nope")]))


@pytest.mark.parametrize(
    ("make", "message"),
    [
        (lambda: hg.ItemCoordinate("", ["a"]), "ItemCoordinate mark: expected a layout mark's id"),
        (lambda: hg.ItemCoordinate("cells", []), "ItemCoordinate item: expected an item's names"),
        (lambda: hg.ItemCoordinate("cells", [3]), r"ItemCoordinate item\[0\]: expected a name"),
        (
            lambda: hg.ItemCoordinate("cells", [hg.col("a") > 1]),
            r"ItemCoordinate item\[0\]: expected a name, or hg.col\(column\)",
        ),
        (lambda: hg.ItemCoordinate("cells", ["a"], at="middle"), "ItemCoordinate at: expected"),
        (lambda: hg.ItemAnchor("cells", ["a"], at="top-start"), "ItemAnchor at: expected"),
        (
            lambda: hg.ItemAnchor("cells", ["a"], at="top", offset=(1, float("nan"))),
            r"ItemAnchor offset\[1\]: expected a finite number of pixels",
        ),
    ],
)
def test_malformed_item_places_are_refused_where_they_are_made(make, message):
    with pytest.raises(hg.ChartError, match=message):
        make()


def test_marks_beside_a_layout_mark_are_placed_by_its_items_or_in_pixels():
    with pytest.raises(
        hg.ChartError,
        match=r"text: a treemap's chart has no x and y scales; place it by the treemap's items "
        r"\(hg.ItemCoordinate, or text from_=hg.ItemAnchor\) or in pixels",
    ):
        cells().text(data=MARKETS, x="total", y="total", label="x")
    # The other way round, at the layout mark.
    with pytest.raises(hg.ChartError, match="line: a treemap's chart has no x and y scales"):
        hg.Chart().line(data=MARKETS, x="total", y="total").treemap(
            data=SALES, path=["market"], value="value"
        )
    # In pixels, beside any layout mark: a gauge's, a map's.
    gauge = (
        hg.Chart({"cpu": [0.4]}).gauge("cpu").text(x=hg.Fraction(0.5), y=hg.Pixels(10), label="CPU")
    )
    assert [mark["type"] for mark in gauge.to_spec()[0]["marks"]] == ["gauge", "text"]
    with pytest.raises(
        hg.ChartError,
        match='text item mark: "g" is a gauge, whose items give no geometry to place by; '
        "follow a pie, funnel, treemap, or sunburst",
    ):
        hg.Chart({"cpu": [0.4]}).gauge("cpu", id="g").text(
            x=hg.ItemCoordinate("g", "cpu"), y=hg.Pixels(10), label="CPU"
        )
    with pytest.raises(
        hg.ChartError, match='text item mark: no mark has id "cell"; give the id of the treemap'
    ):
        cells().text(x=hg.ItemCoordinate("cell", "Auburn, AL"), y=hg.Pixels(4), label="A")


def test_item_places_need_the_layout_mark_beside_them():
    chart = (
        hg.Chart()
        .line(data=MARKETS, x="total", y="total")
        .rule(x=hg.ItemCoordinate("cells", "Auburn, AL"))
    )
    with pytest.raises(
        hg.ChartError,
        match='rule item mark: no layout mark has id "cells"; draw the rule beside the pie, '
        "funnel, treemap, or sunburst it follows",
    ):
        chart.to_spec()
    # Beside positions on scales too, which no layout mark draws beside.
    with pytest.raises(hg.ChartError, match='text item mark: no layout mark has id "missing"'):
        hg.Chart().text(x=hg.ItemCoordinate("missing", "a"), y=1, label="X").to_spec()


def test_subplots_draw_marks_placed_by_items_in_the_layout_marks_panel():
    chart = hg.Chart(panels=["a", "b"]).treemap(
        data=SALES, path=["market"], value="value", id="cells", panel="b"
    )
    chart.rule(x=hg.ItemCoordinate("cells", "Auburn, AL"), panel="b")
    assert [mark.get("panel") for mark in chart.to_spec()[0]["marks"]] == ["b", "b"]
    with pytest.raises(
        hg.ChartError, match='text item mark: "cells" is drawn in panel "b"; draw the text there'
    ):
        chart.text(x=hg.ItemCoordinate("cells", "Auburn, AL"), y=hg.Pixels(4), label="A", panel="a")
    # Added before the layout mark, too.
    early = hg.Chart(panels=["a", "b"]).text(
        x=hg.ItemCoordinate("cells", "Auburn, AL"), y=hg.Pixels(4), label="A", panel="a"
    )
    with pytest.raises(hg.ChartError, match='"cells" is drawn in panel "b"; draw the text there'):
        early.treemap(data=SALES, path=["market"], value="value", id="cells", panel="b")
    with pytest.raises(
        hg.ChartError,
        match='line panel: panel "b" draws a treemap, which has no x and y scales; name another '
        "panel, or place text, rules, or regions by the treemap's items or in pixels",
    ):
        chart.line(data=MARKETS, x="total", y="total", panel="b")


def test_bars_stand_on_any_y_with_orient():
    ranked = pd.DataFrame(
        {"brand": ["IBM", "Apple", "Coca-Cola"], "value": [53.0, 40.0, 70.0], "rank": [1, 2, 0]}
    )
    chart = hg.Chart(ranked).bar("value", "rank", orient="y")
    mark = chart.to_spec()[0]["marks"][0]
    assert (mark["orient"], mark["x"], mark["y"]) == ("y", "value", "rank")
    assert chart.to_svg(size=(400, 200)).count('fill="#') >= 3
    assert hg.bar(ranked, "value", "rank", orient="y").to_spec()[0]["marks"][0]["orient"] == "y"
    with pytest.raises(
        hg.ChartError,
        match=r"bar orient: \"y\" makes x the lengths, and 'brand' holds categories; "
        r"give orient=\"x\", or a number column as x",
    ):
        hg.Chart(ranked).bar("brand", "rank", orient="y")
    with pytest.raises(hg.ChartError, match=r'bar orient: expected "x" or "y"; received "up"'):
        hg.Chart(ranked).bar("value", "rank", orient="up")  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError, match="bar y: bars along y stand on one column"):
        hg.Chart(ranked).bar("value", ["rank", "value"], orient="y")


def test_columns_only_item_names_read_travel_with_the_chart():
    # A table of its own, whose names column no label or other mark reads.
    spots = pd.DataFrame({"name": ["Auburn, AL", "Birmingham, AL"]})
    chart = cells().text(
        data=spots, from_=hg.ItemAnchor("cells", [hg.col("name")], at="center"), label="•"
    )
    chart.rule(data=spots, x=hg.ItemCoordinate("cells", [hg.col("name")]))
    spec, _ = chart.to_spec()
    table = spec["marks"][1]["data"]
    assert "name" in spec["data"][table]["columns"]
    assert chart.to_svg(size=(600, 400)).count(">•<") == 2
