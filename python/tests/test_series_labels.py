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
