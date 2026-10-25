"""Proofs of the capability matrix's Express cells (test/contracts/express.json
at the repository root): each recipe, all the marks it draws, against a
capability, as ``<recipe>.<capability>.python``."""

import json
from pathlib import Path
from typing import Any

import numpy as np
import pytest

import herceg as hg
import herceg.express as hx

EXPRESS = json.loads(
    (Path(__file__).parents[2] / "test" / "contracts" / "express.json").read_text()
)

#: Two observations of each t, so the estimate has an interval.
DATA = {"t": [0, 0, 1, 1, 2, 2], "v": [1.0, 3.0, 2.0, 4.0, 3.0, 5.0]}


def declared(capability: str, recipe: str) -> str:
    """The recipe's declared state of ``capability``: works, unproved, refused, or na."""
    cells = EXPRESS["recipes"][recipe]
    for state, listed in (
        ("works", cells.get("works", [])),
        ("unproved", cells.get("unproved", [])),
        ("refused", cells.get("refused", {})),
        ("na", cells.get("na", {})),
    ):
        if capability in listed:
            return state
    raise AssertionError(f"express.json: {recipe} declares no {capability}")


def without_panel(marks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {key: value for key, value in mark.items() if key not in ("panel", "data")}
        for mark in marks
    ]


@pytest.mark.contract("lineplot.placement.panel.python")
def test_lineplot_draws_its_estimate_and_interval_in_a_named_panel():
    assert declared("placement.panel", "lineplot") == "works"
    chart = hg.Chart(DATA)
    left, right = chart.columns(2)
    beside, drawn = left.panel("a"), right.panel("b")
    beside.line(x="t", y="v")
    assert hx.lineplot(DATA, x="t", y="v", panel=drawn) is chart
    spec, _ = chart.to_spec()
    single = hx.lineplot(DATA, x="t", y="v")
    alone, _ = single.to_spec()
    ours = [mark for mark in spec["marks"] if mark["panel"] == "b"]
    # Both of the recipe's marks, the interval and the estimate, are in its
    # panel, as they are drawn alone, over the same computed table.
    assert [mark["type"] for mark in ours] == ["area", "line"]
    assert without_panel(ours) == without_panel(alone["marks"])
    assert {mark["data"] for mark in ours} == {"data2"}
    computed, apart = hx.statistics(chart, panel="b").tables, hx.statistics(single).tables
    assert computed.keys() == apart.keys()
    for name, columns in computed.items():
        assert columns.keys() == apart[name].keys()
        for field, values in columns.items():
            np.testing.assert_array_equal(values, apart[name][field])
    # The other panel keeps its own line alone.
    assert [mark for mark in spec["marks"] if mark["panel"] != "b"] == [
        {"type": "line", "x": "t", "y": "v", "panel": "a", "data": "data"}
    ]
    assert chart.to_svg().startswith("<svg")


#: The recipes that draw several panels, each called on data it takes.
ARRANGED = {
    "pairplot": lambda data, **options: hx.pairplot(data, vars=["a", "b"], **options),
    "jointplot": lambda data, **options: hx.jointplot(data, x="a", y="b", **options),
    "clustermap": lambda data, **options: hx.clustermap(data, index="g", **options),
}
#: Numbers in two columns and a label for each row.
GRID = {"a": [1.0, 2, 3, 4, 5, 6], "b": [2.0, 1, 4, 3, 6, 5], "g": ["p", "q", "r", "s", "t", "u"]}


@pytest.mark.parametrize(
    "recipe",
    [
        pytest.param(
            recipe, id=recipe, marks=pytest.mark.contract(f"{recipe}.placement.panel.python")
        )
        for recipe in ARRANGED
    ],
)
def test_recipes_of_several_panels_refuse_a_named_panel(recipe):
    assert declared("placement.panel", recipe) == "refused"
    refusal = EXPRESS["recipes"][recipe]["refused"]["placement.panel"]["error"]
    chart = hg.Chart(GRID)
    [cell] = chart.columns(1)
    with pytest.raises(hg.ChartError) as raised:
        ARRANGED[recipe](GRID, panel=cell.panel("p"))
    assert (raised.value.code, raised.value.path, str(raised.value)) == (
        refusal["code"],
        refusal["path"],
        refusal["message"],
    )
    # Nothing was drawn in the chart asked.
    assert chart.to_spec()[0]["marks"] == []


@pytest.mark.parametrize(
    "recipe",
    [
        pytest.param(recipe, id=recipe, marks=pytest.mark.contract(f"{recipe}.own-chart.python"))
        for recipe in ARRANGED
    ],
)
def test_recipes_of_several_panels_draw_a_chart_of_their_own(recipe):
    spec, _ = ARRANGED[recipe](GRID).to_spec()
    panels = {panel["id"] for panel in spec["panels"]}
    # Every mark in one of the chart's own panels, which more than one mark shares.
    assert spec["marks"]
    assert {mark["panel"] for mark in spec["marks"]} <= panels
    assert len({mark["panel"] for mark in spec["marks"]}) > 1


@pytest.mark.contract("clustermap.legend.toggle.python")
def test_a_clustermap_draws_no_series_a_legend_entry_could_hide():
    assert declared("legend.toggle", "clustermap") == "na"
    spec, _ = hx.clustermap(GRID, index="g").to_spec()
    # Cells colored by their value, which a colorbar explains, and trees: no series.
    assert [mark["type"] for mark in spec["marks"]] == ["heatmap", "dendrogram", "dendrogram"]
    assert all("series" not in mark for mark in spec["marks"])
    assert spec["marks"][0]["color"] == "value"


@pytest.mark.contract("express.statistics.panels.python")
def test_statistics_by_panel_are_the_plot_drawn_there():
    chart = hg.Chart(DATA)
    left, right = chart.columns(2)
    hx.lineplot(DATA, x="t", y="v", panel=left.panel("a"))
    histograms = right.panel("b")
    hx.histplot(DATA, x="v", panel=histograms)
    # By id or by the panel itself.
    assert hx.statistics(chart, panel="a").function == "lineplot"
    assert hx.statistics(chart, panel=histograms).function == "histplot"
    # The chart's own statistics are its panels', which the refusal names.
    with pytest.raises(hg.ChartError) as raised:
        hx.statistics(chart)
    assert raised.value.path == "chart"
    assert str(raised.value) == (
        "hx.statistics chart: the chart's express plots are in its panels; "
        "name one with panel= ('a', 'b')"
    )


@pytest.mark.contract("express.statistics.refused.python")
def test_statistics_refuse_a_chart_no_recipe_made():
    with pytest.raises(hg.ChartError) as raised:
        hx.statistics(hg.Chart(DATA).line(x="t", y="v"))
    assert raised.value.path == "chart"
    assert str(raised.value) == (
        "hx.statistics chart: the chart was not made by a herceg.express function; "
        "give one an express function made"
    )
