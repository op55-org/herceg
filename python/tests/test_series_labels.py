"""Labels following series, as Python writes and draws them: ``labels`` on
lines and areas (``hg.SeriesLabels``), text following another mark's series
(``text(from_=hg.MarkAnchor(...))``), and labels made of parts
(``hg.LabelPart``) on bars and annotations."""

import re
from datetime import datetime, timedelta, timezone

import pytest

import herceg as hg

DATA = {
    "t": [0, 1, 2, 0, 1, 2],
    "v": [1.0, 2, 3, 2, 3, 4],
    "region": ["eu", "eu", "eu", "us", "us", "us"],
}


def texts(chart: hg.Chart) -> list[str]:
    """The text a chart's SVG writes, in order."""
    return re.findall(r"<text[^>]*>([^<]*)</text>", chart.to_svg())


def test_lines_label_their_series_where_they_end():
    chart = hg.Chart(DATA, legend=False).line(
        x="t", y="v", color="region", labels=hg.SeriesLabels(at="last")
    )
    assert {"eu", "us"} <= set(texts(chart))
    spec, _ = chart.to_spec()
    assert spec["marks"][0]["labels"] == {"at": "last"}


def test_labels_write_their_parts():
    chart = hg.Chart(DATA, legend=False).line(
        x="t",
        y="v",
        color="region",
        labels=hg.SeriesLabels(
            at="last",
            content=[
                hg.LabelPart(series=True),
                ": ",
                hg.LabelPart(value=True, format=hg.Format(number=".1f")),
            ],
        ),
    )
    assert {"eu: 3.0", "us: 4.0"} <= set(texts(chart))


def test_areas_label_a_bands_edge():
    rows = {"t": [0, 1, 2], "low": [1.0, 2, 1], "high": [3.0, 4, 5]}
    chart = hg.Chart(rows, legend=False).area(
        x="t",
        y1="low",
        y2="high",
        labels=hg.SeriesLabels(at="last", edge="y2", content=["top"]),
    )
    assert "top" in texts(chart)
    with pytest.raises(hg.ChartError, match="give edge"):
        hg.Chart(rows).area(x="t", y1="low", y2="high", labels=hg.SeriesLabels(at="last")).to_svg()


def test_text_follows_another_marks_series():
    chart = (
        hg.Chart(DATA, legend=False)
        .line(x="t", y="v", color="region", id="sales")
        .text(
            label=hg.Label(content=[hg.LabelPart(series=True), " now"]),
            from_=hg.MarkAnchor(mark="sales", at="last"),
        )
    )
    assert {"eu now", "us now"} <= set(texts(chart))
    spec, _ = chart.to_spec()
    assert spec["marks"][1]["from"] == {"mark": "sales", "at": "last"}


def test_text_following_a_series_is_placed_with_its_series_labels():
    chart = hg.Chart(DATA).line(x="t", y="v", color="region", id="sales")
    anchor = hg.MarkAnchor(mark="sales", at="last")
    # They move by default, as series labels do, so a leader needs no overlap.
    followed = chart.text(label=hg.Label(text="x", leader=True), from_=anchor)
    assert followed.to_spec()[0]["marks"][1]["label"] == {"text": "x", "leader": True}
    with pytest.raises(
        hg.ChartError,
        match="^text label overlap_group: series labels already keep apart across marks; "
        "drop overlap_group$",
    ):
        chart.text(label=hg.Label(text="x", overlap_group="notes"), from_=anchor)
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(DATA).text(label="x", from_=hg.MarkAnchor(mark="none", at="last")).to_svg()
    assert raised.value.code == "unknown-reference"


def test_bars_and_annotations_write_labels_of_parts():
    chart = (
        hg.Chart(DATA, legend=False)
        .bar(x="region", y="v", labels=hg.BarLabels(content=["n = ", hg.LabelPart(value=True)]))
        .rule(y=2.5, label=hg.Label(content=["SLO ", hg.LabelPart(value=True)]))
    )
    written = texts(chart)
    assert "SLO 2.5" in written
    assert any(text.startswith("n = ") for text in written)


def test_annotations_of_parts_read_their_columns_and_name_no_entry():
    with pytest.raises(hg.ChartError) as raised:
        hg.Chart(DATA).rule(y=2.5, label=hg.Label(content=[hg.LabelPart(field="nope")]))
    assert raised.value.code == "unknown-field"
    with pytest.raises(hg.ChartError, match="a label of parts has neither"):
        hg.Chart(DATA).rule(y=2.5, label=hg.Label(content=["SLO"]), legend=True)


def test_series_labels_go_where_they_follow():
    with pytest.raises(ValueError, match="drop attachment"):
        hg.SeriesLabels(at="last", place=hg.LabelPlace(attachment="end"))


ROWS = {
    "t": [0, 1, 2],
    "v": [1.0, 2, 3],
    "note": ["first", "middle", "last"],
    "extra": [7, 8, 9],
}


def test_labels_send_the_columns_their_parts_read():
    chart = hg.Chart(ROWS, legend=False).line(
        x="t", y="v", labels=hg.SeriesLabels(at="last", content=[hg.LabelPart(field="note")])
    )
    spec, _ = chart.to_spec()
    columns = next(iter(spec["data"].values()))["columns"]
    assert "note" in columns
    assert "extra" not in columns
    assert "last" in texts(chart)


def test_text_following_a_mark_reads_its_columns():
    # The data is the line's alone: the text has none of its own.
    chart = (
        hg.Chart(legend=False)
        .line(data=ROWS, id="l", x="t", y="v")
        .text(
            from_=hg.MarkAnchor(mark="l", at="last"),
            label=hg.Label(content=["at ", hg.LabelPart(field="note")]),
        )
    )
    spec, _ = chart.to_spec()
    assert "note" in next(iter(spec["data"].values()))["columns"]
    assert "data" not in spec["marks"][1]
    assert "at last" in texts(chart)
    with pytest.raises(hg.ChartError, match="no column 'missing'"):
        hg.Chart(legend=False).line(data=ROWS, id="l", x="t", y="v").text(
            from_=hg.MarkAnchor(mark="l", at="last"), label=hg.Label(field="missing")
        )
    with pytest.raises(ValueError, match="drop data"):
        hg.Chart(legend=False).line(data=ROWS, id="l", x="t", y="v").text(
            from_=hg.MarkAnchor(mark="l", at="last"), label="x", data=ROWS
        )


def test_times_are_written_as_dates():
    # A line of times: following text reads a time column, a value part writes the time drawn.
    day = datetime(2026, 10, 25, 23, tzinfo=timezone.utc)
    rows = {"t": [0, 1], "when": [day - timedelta(days=1), day]}
    dates = {"year": "numeric", "month": "2-digit", "day": "2-digit"}
    chart = (
        hg.Chart(legend=False, time_zone="Asia/Tokyo")
        .line(
            data=rows,
            id="l",
            x="t",
            y="when",
            labels=hg.SeriesLabels(at="last", content=[hg.LabelPart(value=True, format=dates)]),
        )
        .text(
            from_=hg.MarkAnchor(mark="l", at="last"),
            label=hg.Label(field="when", format=dates),
        )
    )
    assert texts(chart).count("10/26/2026") == 2


def test_text_following_a_mark_goes_outside_the_plot():
    chart = (
        hg.Chart(ROWS, legend=False)
        .line(id="l", x="t", y="v")
        .text(
            from_=hg.MarkAnchor(mark="l", at="last"),
            label=hg.Label(text="end", place=hg.LabelPlace(outside=True)),
        )
    )
    spec, _ = chart.to_spec()
    assert spec["marks"][1]["label"]["place"] == {"outside": True}
    assert "end" in texts(chart)
    with pytest.raises(ValueError, match="drop attachment"):
        hg.Chart(ROWS).line(id="l", x="t", y="v").text(
            from_=hg.MarkAnchor(mark="l", at="last"),
            label=hg.Label(text="end", place=hg.LabelPlace(attachment="end")),
        )


@pytest.mark.contract("labels.attach.view-edge.python")
def test_labels_stand_where_the_line_meets_the_views_edge():
    rows = {"t": [0, 1, 2, 3], "v": [0.0, 10, 20, 30], "note": ["a", "b", "c", "d"]}
    parts = [hg.LabelPart(field="note"), " ", hg.LabelPart(value=True)]
    chart = hg.Chart(rows, legend=False, x={"domain": [0.25, 2.5], "nice": False}).line(
        x="t", y="v", id="v", labels=hg.SeriesLabels(at="view-end", content=parts)
    )
    # Where the line meets the right edge, between minutes 2 and 3: the
    # value there, and the nearer observation's fields (the earlier on a tie).
    assert "c 25" in texts(chart)
    spec, _ = chart.to_spec()
    assert spec["marks"][0]["labels"] == {
        "at": "view-end",
        "content": [{"field": "note"}, " ", {"value": True}],
    }
    following = chart.text(
        label=hg.Label(content=parts), from_=hg.MarkAnchor(mark="v", at="view-start")
    )
    assert "a 2.5" in texts(following)
    assert following.to_spec()[0]["marks"][1]["from"] == {"mark": "v", "at": "view-start"}


def test_labels_name_the_places_they_take():
    places = '"first", "last", "visible-start", "visible-end", "view-start", or "view-end"'
    received = '; received "view-middle"'
    with pytest.raises(
        hg.ChartError, match=re.escape(f"SeriesLabels at: expected {places}{received}")
    ):
        hg.SeriesLabels(at="view-middle")  # type: ignore[arg-type]
    with pytest.raises(
        hg.ChartError, match=re.escape(f"MarkAnchor at: expected {places}{received}")
    ):
        hg.MarkAnchor(mark="v", at="view-middle")  # type: ignore[arg-type]


def _plot_right(chart: hg.Chart) -> float:
    """Where the chart's plot ends along x, as its SVG clips it."""
    import xml.etree.ElementTree as ET

    root = ET.fromstring(chart.to_svg())
    rect = root.find(".//{http://www.w3.org/2000/svg}clipPath/{http://www.w3.org/2000/svg}rect")
    assert rect is not None
    return float(rect.attrib["x"]) + float(rect.attrib["width"])


@pytest.mark.contract("labels.attach.room.python")
def test_names_outside_the_plot_take_a_room():
    rows = {"t": [0, 1, 2], "auth": [1.0, 2, 3], "recommendations-engine": [3.0, 2, 1]}

    def chart(names: list[str], room: object = 64) -> hg.Chart:
        place = hg.LabelPlace(outside=True, offset=8, room=room)
        return hg.Chart(rows, legend=False, width=600).line(
            x="t", y=names, labels=hg.SeriesLabels(at="last", place=place)
        )

    # A fixed room holds the plot whatever the names measure, and shortens longer ones.
    assert _plot_right(chart(["auth"])) == _plot_right(chart(["recommendations-engine"]))
    written = texts(chart(["auth", "recommendations-engine"]))
    assert "auth" in written
    assert "recommendations-engine" not in written
    assert any(text.startswith("recomm") and text.endswith("…") for text in written)
    # Bounds: a least alone never shortens.
    assert "recommendations-engine" in texts(chart(["recommendations-engine"], room=(10, None)))
    spec, _ = chart(["auth"], room=(60, None)).to_spec()
    place = spec["marks"][0]["labels"]["place"]
    assert place == {"outside": True, "offset": 8, "room": {"min": 60}}
    spec, _ = chart(["auth"]).to_spec()
    assert spec["marks"][0]["labels"]["place"]["room"] == 64
    # A dict of the options builds the same place.
    labels = hg.SeriesLabels(at="last", place={"outside": True, "room": (None, 40)})
    assert labels._spec()["place"] == {"outside": True, "room": {"max": 40}}
    # Text following a series and horizontal rules' labels take one too.
    following = (
        hg.Chart(rows, legend=False, width=600)
        .line(x="t", y="auth", id="m")
        .text(
            label=hg.Label(
                text="a long note", place=hg.LabelPlace(outside=True, offset=8, room=64)
            ),
            from_=hg.MarkAnchor(mark="m", at="last"),
        )
    )
    assert _plot_right(following) == _plot_right(chart(["auth"]))
    ruled = (
        hg.Chart(rows, legend=False, width=600)
        .line(x="t", y="auth")
        .rule(y=2, label=hg.Label(text="SLO", place=hg.LabelPlace(outside=True, offset=8, room=64)))
    )
    assert _plot_right(ruled) == _plot_right(chart(["auth"]))


@pytest.mark.contract("labels.attach.room.refused.python")
def test_rooms_are_refused_where_no_track_is_kept():
    refusals = {
        "LabelPlace room: labels that keep no room take none; drop room, or reserve": lambda: (
            hg.LabelPlace(outside=True, reserve=False, room=72)
        ),
        "LabelPlace room: labels inside the plot take no room; place them outside": lambda: (
            hg.LabelPlace(room=72)
        ),
        "LabelPlace room: expected finite pixels of at least 0, or (least, most), None for no "
        "bound; received -4": lambda: hg.LabelPlace(outside=True, room=-4),
        "region label place room: a region's labels stand in it, where no track is kept; "
        "drop room": lambda: hg.Chart(DATA).region(
            y1=0, y2=1, label=hg.Label(text="Budget", place=hg.LabelPlace(outside=True, room=64))
        ),
        "rule label place room: a vertical rule's labels stand above or below the plot, where "
        "no track is kept; drop room": lambda: hg.Chart(DATA).rule(
            x=1, label=hg.Label(text="deploy", place=hg.LabelPlace(outside=True, room=64))
        ),
        "BarLabels place: bars' labels take attachment, outside, and offset; drop room": lambda: (
            hg.BarLabels(place={"outside": True, "room": 64})
        ),
    }
    for message, make in refusals.items():
        with pytest.raises(hg.ChartError, match=f"^{re.escape(message)}"):
            make()
    with pytest.raises(hg.ChartError, match="^LabelPlace room: labels inside the plot"):
        hg.SeriesLabels(at="last", place={"outside": False, "room": 40})
