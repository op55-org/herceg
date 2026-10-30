"""Express forwards ``z_index``, ``encode``, and ``labels`` to the mark that
draws its result. They read the data's columns, and x, y, and the series as
the plot draws them, never other columns it computes, which it names apart
from the data's. It carries the columns they read into the tables it
computes: row for row where it draws rows, and per group where it draws a
summary, refused where a column varies within a group. Marks beside the
primary one take its color binding (a field or the series through a
scale), or a neutral color beside a color of its own, and nothing else."""

import numpy as np
import pytest

import herceg as hg
import herceg.express as hx

DATA = {
    "t": [0, 1, 2, 0, 1, 2, 0, 1, 2, 0, 1, 2],
    "v": [1.0, 2, 3, 2, 3, 4, 5, 4, 3, 6, 5, 4],
    "s": ["a", "a", "a", "b", "b", "b", "c", "c", "c", "d", "d", "d"],
    "site": ["n", "n", "n", "n", "n", "n", "s", "s", "s", "s", "s", "s"],
    "flag": [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
}
SITES = {"sites": hg.OrdinalScale(map={"n": "#ff0000", "s": "#0000ff"})}
BY_SITE = hg.Encodings(color=hg.Channel(field="site", scale="sites"))


def marks(chart):
    return chart.to_spec()[0]["marks"]


def test_lineplot_colors_its_lines_and_their_bands_by_a_column_of_one_value_per_line():
    chart = hx.lineplot(DATA, x="t", y="v", series="s", encode=BY_SITE, z_index=2, scales=SITES)
    band, line = marks(chart)
    assert line["encode"] == {"color": {"field": "site", "scale": "sites"}}
    assert line["zIndex"] == 2
    # The band stands for its line: the same channel and scale, at its own depth.
    assert band["encode"] == line["encode"] and "zIndex" not in band
    assert hx.statistics(chart).tables["estimates"]["site"].tolist() == ["n"] * 6 + ["s"] * 6
    svg = chart.to_svg()
    assert 'stroke="#ff0000"' in svg and 'stroke="#0000ff"' in svg
    # Error bars take no channels: neutral rather than in contradicting series colors.
    bars = hx.lineplot(
        DATA, x="t", y="v", series="s", encode=BY_SITE, scales=SITES, error_style="bars"
    )
    assert marks(bars)[0]["type"] == "errorbar" and marks(bars)[0]["stroke"] == "#424242"


def test_a_column_varying_within_an_estimate_is_refused_with_what_to_do():
    with pytest.raises(hg.ChartError) as raised:
        hx.lineplot(DATA, x="t", y="v", encode=BY_SITE, scales=SITES)
    assert (raised.value.path, str(raised.value)) == (
        "encode",
        "lineplot encode: column 'site' varies within the rows of t '0', which lineplot draws "
        "as one estimate; split the lines by it with series, precompute one value per series "
        "and x, or draw the rows with estimator=None and errorbar=None",
    )
    # Drawing the rows carries the column row for row, unit breaks and all.
    chart = hx.lineplot(
        DATA,
        x="t",
        y="v",
        estimator=None,
        errorbar=None,
        units="s",
        encode=hg.Encodings(stroke_width=hg.when(hg.col("flag") > 0, 3, 1)),
    )
    (line,) = marks(chart)
    assert line["encode"]["strokeWidth"]["condition"]["when"] == [">", ["field", "flag"], 0]
    # Each unit's rows in order of t, the same order within each.
    assert hx.statistics(chart).tables["rows"]["flag"].tolist() == DATA["flag"]


def test_barplot_options_read_the_data_and_never_what_it_computes():
    chart = hx.barplot(DATA, x="s", y="v", labels={"field": "site"}, encode=BY_SITE, scales=SITES)
    bars, errors = marks(chart)
    assert bars["labels"] == {"field": "site"} and bars["encode"] == BY_SITE._spec()
    assert errors["stroke"] == "#424242" and "encode" not in errors
    estimates = hx.statistics(chart).tables["estimates"]
    assert estimates["site"].tolist() == ["n", "n", "s", "s"]
    # The count is barplot's to name: reading it is refused, not guessed at.
    with pytest.raises(hg.ChartError) as raised:
        hx.barplot(DATA, x="s", y="v", labels={"field": "n"})
    assert (raised.value.path, str(raised.value)) == (
        "labels",
        'barplot labels: no column \'n\' in the data, which has "t", "v", "s", '
        '"site", or "flag"; read one of those (x, y, and the series read what barplot '
        "draws)",
    )
    # A column of the data named as a computed one is the data's; the count moves aside.
    named = {**DATA, "n": [7.0] * 12}
    chart = hx.barplot(named, x="s", y="v", labels={"field": "n"}, errorbar=None)
    estimates = hx.statistics(chart).tables["estimates"]
    assert estimates["n"].tolist() == [7.0] * 4 and estimates["n_"].tolist() == [3.0] * 4
    # Whether or not the options read it.
    plain = hx.statistics(hx.barplot(named, x="s", y="v", errorbar=None)).tables["estimates"]
    assert estimates["n_"].tolist() == plain["n_"].tolist() and "n" not in plain
    with pytest.raises(
        hg.ChartError,
        match="barplot encode: column 'flag' varies within the "
        "rows of s 'a', which barplot draws as one bar; split the bars",
    ):
        hx.barplot(DATA, x="s", y="v", encode={"opacity": hg.Channel(field="flag")})


def test_options_are_checked_where_the_express_call_gives_them():
    with pytest.raises(ValueError, match="barplot encode: has no symbol channel"):
        hx.barplot(DATA, x="s", y="v", encode={"symbol": hg.Channel(field="site")})
    with pytest.raises(hg.ChartError, match="lineplot z_index: expected a finite number"):
        hx.lineplot(DATA, x="t", y="v", z_index=float("nan"))
    with pytest.raises(hg.ChartError) as raised:
        hx.lineplot(DATA, x="t", y="v", series="s", encode={"color": hg.Channel(field="zone")})
    assert str(raised.value).startswith("lineplot encode: no column 'zone' in the data, ")
    with pytest.raises(hg.ChartError, match="lineplot labels.edge: its labels follow its line"):
        hx.lineplot(DATA, x="t", y="v", labels={"at": "last", "edge": "y1"})
    with pytest.raises(hg.ChartError, match="kdeplot encode: a bivariate density's contours"):
        hx.kdeplot(DATA, x="t", y="v", encode=BY_SITE)
    with pytest.raises(
        hg.ChartError, match="regplot encode: goes to the fit lines, and fit_reg=False draws none"
    ):
        hx.regplot(DATA, x="t", y="v", fit_reg=False, encode=BY_SITE)


def test_densities_and_distributions_carry_a_column_per_series():
    kde = hx.kdeplot(DATA, x="v", series="s", encode=BY_SITE, scales=SITES, z_index=-1)
    (curve,) = marks(kde)
    assert curve["type"] == "line" and curve["zIndex"] == -1
    sites = hx.statistics(kde).tables["density"]["site"]
    assert set(sites[:200]) == {"n"} and set(sites[-200:]) == {"s"}
    filled = hx.kdeplot(
        DATA, x="v", series="s", filled=True, encode={"fill": BY_SITE.color}, scales=SITES
    )
    assert marks(filled)[0]["type"] == "area" and "fill" in marks(filled)[0]["encode"]
    with pytest.raises(
        hg.ChartError,
        match="kdeplot encode: column 'site' varies within the "
        "rows of the plot, which kdeplot draws as one density",
    ):
        hx.kdeplot(DATA, x="v", encode=BY_SITE, scales=SITES)
    ecdf = hx.ecdfplot(DATA, x="v", series="s", encode=BY_SITE, scales=SITES, z_index=1)
    (steps,) = marks(ecdf)
    assert steps["encode"] == BY_SITE._spec() and steps["zIndex"] == 1
    # A group of one distinct value is a point standing in for its steps.
    single = {**DATA, "v": [1.0] * 3 + DATA["v"][3:]}
    ecdf = hx.ecdfplot(single, x="v", series="s", z_index=1)
    assert [(m["type"], m.get("zIndex")) for m in marks(ecdf)] == [
        ("point", 1),
        ("line", 1),
        ("line", 1),
        ("line", 1),
    ]


def test_a_data_column_named_as_a_computed_one_moves_the_computed_one_aside():
    named = {**DATA, "density": [7.0] * 12}
    bright = hg.Encodings(opacity=hg.when(hg.col("density") > 5, 1, 0.5))
    chart = hx.kdeplot(named, x="v", series="s", encode=bright)
    (curve,) = marks(chart)
    tables = hx.statistics(chart).tables["density"]
    # The curve draws the computed density; the data's column is carried beside it.
    assert curve["y"] == "density_" and set(tables["density"]) == {7.0}
    assert tables["density_"].max() < 1
    # Styling names nothing: the density is "density_" beside the data's own.
    (plain,) = marks(hx.kdeplot(named, x="v", series="s"))
    assert plain["y"] == "density_"
    ecdf = hx.ecdfplot({**DATA, "Probability": [0.0] * 12}, x="v", series="s")
    assert marks(ecdf)[0]["y"] == "Probability_"


def test_fits_take_the_options_and_their_points_and_bands_share_the_color():
    chart = hx.regplot(
        DATA, x="t", y="v", series="s", scatter=False, encode=BY_SITE, scales=SITES, z_index=4
    )
    band, line = marks(chart)
    assert line["encode"] == band["encode"] == BY_SITE._spec()
    assert line["zIndex"] == 4 and "zIndex" not in band
    assert set(hx.statistics(chart).tables["fit"]["site"]) == {"n", "s"}
    labelled = hg.SeriesLabels(at="last", content=[hg.LabelPart(field="flag")])
    chart = hx.regplot(
        {**DATA, "flag": [0] * 12},
        x="t",
        y="v",
        series="s",
        scatter=False,
        encode=BY_SITE,
        labels=labelled,
        scales=SITES,
    )
    fit = hx.statistics(chart).tables["fit"]
    assert set(fit["flag"]) == {0} and set(fit["site"]) == {"n", "s"}


def test_a_fit_checks_the_color_binding_of_the_estimates_it_draws_alone():
    # Series "b" has one distinct x, so no fit, and its site varies.
    rows = {
        "t": [0, 1, 2, 0, 0, 0],
        "v": [1.0, 2, 3, 1, 2, 3],
        "s": ["a", "a", "a", "b", "b", "b"],
        "site": ["n", "n", "n", "n", "s", "n"],
    }
    given = {"series": "s", "x_estimator": "mean", "encode": BY_SITE, "scales": SITES}
    chart = hx.regplot(rows, x="t", y="v", scatter=False, **given)
    assert [m["type"] for m in marks(chart)] == ["area", "line"]
    with pytest.raises(
        hg.ChartError,
        match="regplot encode: column 'site' varies within the rows of s 'b', which regplot "
        "draws as one series; split the series by it",
    ):
        hx.regplot(rows, x="t", y="v", **given)


def test_label_options_are_refused_where_the_chart_methods_refuse_them():
    for call, expected in (
        (
            lambda: hx.lineplot(DATA, x="t", y="v", labels={"at": "middle"}),
            (
                "labels.at",
                'lineplot labels.at: expected "first", "last", "visible-start", or '
                '"visible-end"; received "middle"',
            ),
        ),
        (
            lambda: hx.kdeplot(DATA, x="v", filled=True, labels={"at": "last", "edge": "top"}),
            (
                "labels.edge",
                'kdeplot labels.edge: expected "y1", "y2", "x1", or "x2"; received "top"',
            ),
        ),
        (
            lambda: hx.barplot(DATA, x="s", y="v", labels={"content": ["n = ", {"row": 1}]}),
            (
                "labels.content[1]",
                "barplot labels.content[1]: expected text, or "
                "hg.LabelPart(field=...), (series=True), or (value=True); received {'row': 1}",
            ),
        ),
        (
            lambda: hx.ecdfplot(DATA, x="v", labels={"at": "last", "place": {"bogus": 1}}),
            (
                "labels",
                'SeriesLabels place: unknown key "bogus"; name one of "attachment", '
                '"side", "outside", "reserve", or "offset"',
            ),
        ),
    ):
        with pytest.raises(hg.ChartError) as raised:
            call()
        assert (raised.value.path, str(raised.value)) == expected


def test_a_fit_of_a_column_against_itself_keeps_its_values_apart_from_carried_ones():
    rows = {"x": [0.0, 1, 2, 3], "x_": ["a"] * 4}
    chart = hx.regplot(rows, x="x", y="x", scatter=False, encode={"color": hg.Channel(field="x_")})
    fit = hx.statistics(chart).tables["fit"]
    assert set(fit["x_"]) == {"a"} and len(fit["x__"]) == 100


def test_a_color_of_the_primary_marks_own_leaves_the_marks_beside_it_neutral():
    north = hg.Encodings(color=hg.when(hg.col("site") == "n", "#ff0000", "#0000ff"))
    band, line = marks(hx.lineplot(DATA, x="t", y="v", series="s", encode=north))
    assert line["encode"] == north._spec()
    assert "encode" not in band and band["color"] == "#424242"
    chart = hx.pointplot(DATA, x="t", y="v", series="s", errorbar=None, encode=north)
    points, lines = marks(chart)
    assert points["encode"] == north._spec()
    assert "encode" not in lines and lines["color"] == "#424242"
    # Through the series' scale, the lines take the points' binding.
    by_series = hg.Encodings(color=hg.Channel(series=True, scale="sites"))
    shades = {"a": "#111111", "b": "#222222", "c": "#333333", "d": "#444444"}
    four = {"sites": hg.OrdinalScale(map=shades)}
    chart = hx.pointplot(
        DATA, x="t", y="v", series="s", errorbar=None, encode=by_series, scales=four
    )
    _, lines = marks(chart)
    assert lines["encode"] == by_series._spec()
    # A fit's points and estimates take one fill.
    for given in ({}, {"x_estimator": "mean"}):
        chart = hx.regplot(DATA, x="t", y="v", series="s", encode=north, **given)
        points = marks(chart)[0]
        assert points["type"] == "point" and points["fill"] == "#424242"
        assert "encode" not in points and "color" not in points
    # A fit's interval ends are regplot's, which the options do not read.
    with pytest.raises(hg.ChartError, match="regplot encode: no column 'low' in the data"):
        hx.regplot(DATA, x="t", y="v", encode={"color": hg.when(hg.col("low") > 0, "red", "blue")})
    # A group of one value stands in for its steps: their color channel, whole.
    single = {**DATA, "v": [1.0] * 3 + DATA["v"][3:]}
    ecdf = hx.ecdfplot(single, x="v", series="s", encode=north, z_index=2)
    point, *steps = marks(ecdf)
    assert point["type"] == "point" and point["zIndex"] == 2
    assert point["encode"] == north._spec()
    assert all(step["encode"] == north._spec() for step in steps)


def test_marks_without_channels_take_the_plot_depth():
    for chart in (
        hx.histplot(DATA, x="v", z_index=3),
        hx.histplot(DATA, x="t", y="v", z_index=3),
        hx.rugplot(DATA, x="v", z_index=3),
        hx.boxplot(DATA, x="s", y="v", z_index=3),
        hx.boxenplot(DATA, x="s", y="v", z_index=3),
        hx.violinplot(DATA, x="s", y="v", z_index=3),
        hx.kdeplot(DATA, x="t", y="v", z_index=3),
        hx.stripplot(DATA, x="s", y="v", z_index=3),
        hx.pointplot(DATA, x="s", y="v", z_index=3),
        hx.residplot(DATA, x="t", y="v", z_index=3),
    ):
        drawn = marks(chart)
        assert [m.get("zIndex") for m in drawn].count(3) == 1, drawn


def test_forwarded_options_are_those_of_the_mark_drawn_directly():
    """An express plot's primary mark is the chart method's, given the same
    options over the table the plot computed."""
    chart = hx.lineplot(
        DATA, x="t", y="v", series="s", errorbar=None, encode=BY_SITE, z_index=2, scales=SITES
    )
    table = {name: values for name, values in hx.statistics(chart).tables["estimates"].items()}
    direct = hg.Chart(table, scales=SITES).line("t", "v", series="s", encode=BY_SITE, z_index=2)
    (forwarded,) = marks(chart)
    assert forwarded == marks(direct)[0]


def test_recompute_reads_carried_columns_again_and_panels_take_the_options():
    chart = hx.lineplot(DATA, x="t", y="v", series="s", errorbar=None, encode=BY_SITE, scales=SITES)
    moved = {**DATA, "site": ["s"] * 6 + ["n"] * 6}
    again = hx.recompute(chart, moved)
    assert hx.statistics(again).tables["estimates"]["site"].tolist() == ["s"] * 6 + ["n"] * 6
    host = hg.Chart(DATA, scales=SITES)
    left, _ = host.columns(2)
    panel = left.panel("lines")
    hx.lineplot(DATA, x="t", y="v", series="s", encode=BY_SITE, z_index=5, panel=panel)
    drawn = [m for m in marks(host) if m.get("panel") == "lines"]
    assert [m.get("zIndex") for m in drawn] == [None, 5]
    assert np.all([m["encode"] == BY_SITE._spec() for m in drawn])


def test_chart_options_of_round_2_reach_the_chart_as_given():
    chart = hx.lineplot(
        DATA,
        x="t",
        y="v",
        series="s",
        x_axis=hg.AxisOptions(padding=0),
        y_axis={"padding": hg.Pixels(8)},
        theme={"style": {"title": {"vertical_align": "bottom"}}},
        title="Load",
    )
    spec, _ = chart.to_spec()
    # The axes keep their default titles beside the padding given.
    assert spec["x"] == {"title": "t", "padding": 0}
    assert spec["y"] == {"title": "v", "padding": {"px": 8}}
    assert spec["theme"] == {"style": {"title": {"verticalAlign": "bottom"}}}


def test_rugplot_names_each_tick_by_a_column_of_the_data():
    data = {"v": [1.0, None, 3.0], "id": ["a", "b", "c"]}
    for axis in ("x", "y"):
        chart = hx.rugplot(data, **{axis: "v"}, item_key="id")
        (rug,) = marks(chart)
        assert rug["itemKey"] == "id"
        # The missing value's tick is left out, and its name with it.
        assert hx.statistics(chart).tables["values"]["id"].tolist() == ["a", "c"]
