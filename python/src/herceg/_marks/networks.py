"""Networks: graphs of nodes and links, laid out by herceg."""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from typing import TYPE_CHECKING, Any, Literal, TypedDict

import numpy as np

from .._data import Column
from .._errors import ChartError, listed, located, shown
from .._style import HaloOption
from .common import _check_method_options, _flag, _halo

if TYPE_CHECKING:
    from .._chart import Chart


class ForceLayout(TypedDict, total=False):
    """A network placed by a force simulation; ``settle`` (True by default)
    lets the nodes near one moved by hand settle around it."""

    type: Literal["force"]
    settle: bool


class _Circular(TypedDict):
    type: Literal["circular"]


class CircularLayout(_Circular, total=False):
    """A network on one circle, by group, then by ``sort``."""

    sort: Literal["degree", "input", "name"]


class _Layered(TypedDict):
    type: Literal["layered"]


class LayeredLayout(_Layered, total=False):
    """A network in layers along its links' ``direction``."""

    direction: Literal["down", "right", "up", "left"]


#: How a network's nodes are placed: a layout's name, or its settings.
GraphLayout = Literal["force", "circular", "layered"] | ForceLayout | CircularLayout | LayeredLayout


#: The most nodes and links a graph lays out, as the browser enforces.
MAX_NODES = 50_000
MAX_LINKS = 200_000

#: Each graph layout's options and their choices (None for true or false).
_GRAPH_LAYOUTS: dict[str, dict[str, tuple[str, ...] | None]] = {
    "force": {"settle": None},
    "circular": {"sort": ("degree", "input", "name")},
    "layered": {"direction": ("down", "right", "up", "left")},
}


@_check_method_options
def graph(
    self,  # type: Chart
    source: str,
    target: str,
    value: str | None = None,
    *,
    nodes: Any = None,
    node: str | None = None,
    color: str | None = None,
    size: str | None = None,
    data: Any = None,
    labels: bool | None = None,
    directed: bool | None = None,
    link_label_field: str | None = None,
    layout: GraphLayout | None = None,
    panel: str | None = None,
    halo: HaloOption | None = None,
    id: str | None = None,
) -> Chart:
    """A network: a row per link between the nodes named in ``source`` and
    ``target``, links as wide as the sum of ``value`` over their rows when
    given.

    ``layout`` places the nodes: ``"force"`` (the default), a force
    simulation whose nodes near a moved node settle around it
    (``{"type": "force", "settle": False}`` moves only the node);
    ``"circular"``, one circle by group, then by ``"sort"``: ``"degree"``
    (the default), ``"input"``, or ``"name"``; or ``"layered"``, layers
    in the links' direction, from source to target, for trees and
    directed acyclic networks, with ``"direction"`` ``"down"`` (the
    default), ``"right"``, ``"up"``, or ``"left"``. Nodes that remain
    keep their places as the data changes.

    Links have no direction (rows either way between two nodes are one
    link) unless ``directed``, which draws them from source to target
    with arrowheads, a pair's links each way bowed apart. Rows without a
    positive value and links from a node to itself are left out.
    ``link_label_field`` names a category column written along the links
    with room (none where a link's rows name it differently). ``nodes`` is
    a second data source with a row per node, named in its ``node``
    column, which adds nodes without links and colors nodes by the
    category column ``color`` (with a legend) or sizes them by ``size``;
    nodes only links name have no color of their own. A network draws at
    most 50,000 nodes and 200,000 links. It has its chart to itself, each
    facet panel (drawing the panel's links, and the nodes they join, where
    one layout of the whole network puts them), or the panel ``panel``
    names; ``Chart(drag=True)`` lets its nodes be dragged.
    """
    self._layout_place("graph")
    table = self._mark_table(data)
    self._require(table, source, ("category",), "graph source")
    self._require(table, target, ("category",), "graph target")
    self._require(table, value, ("number",), "graph value")
    self._require(table, link_label_field, ("category",), "graph link_label_field")
    layout_spec = _graph_layout(layout)
    node_table = None
    if nodes is not None:
        node_table = located("nodes", lambda: self._table(nodes))
        if node is None:
            raise ChartError(
                "graph node: a nodes table needs node, the column naming each row's node"
            )
        self._require(node_table, node, ("category",), "graph node")
        self._require(node_table, color, ("category",), "graph color")
        self._require(node_table, size, ("number",), "graph size")
    elif node is not None or color is not None or size is not None:
        given = "node" if node is not None else "color" if color is not None else "size"
        raise ChartError(
            f"graph {given}: node, color, and size are columns of a nodes table; give nodes"
        )
    _flag(directed, "graph directed")
    nodes_count, links_count = self._network_size(
        table, source, target, value, node_table, node, directed=directed is True
    )
    if nodes_count > MAX_NODES or links_count > MAX_LINKS:
        raise ChartError(
            f"graph: draws at most {MAX_NODES:,} nodes and {MAX_LINKS:,} links; "
            f"this network has {nodes_count:,} nodes and {links_count:,} links"
        )
    self._add(
        {
            "type": "graph",
            "halo": _halo(halo, "graph"),
            "source": source,
            "target": target,
            "value": value,
            "node": node,
            "color": color,
            "size": size,
            "labels": _flag(labels, "graph labels"),
            "directed": directed,
            "linkLabelField": link_label_field,
            "layout": layout_spec,
            "panel": panel,
            "id": id,
        },
        table,
    )
    if node_table is not None:
        self._node_tables[len(self._marks) - 1] = node_table
    return self


def _network_size(
    self,  # type: Chart
    table: int,
    source: str,
    target: str,
    value: str | None,
    node_table: int | None,
    node: str | None,
    *,
    directed: bool = False,
) -> tuple[int, int]:
    """How many nodes and links a network draws, counted as the browser
    counts them: the names in the nodes table and in rows the links keep,
    and one link per pair of different names (either way round, unless
    ``directed``) whose values sum to a finite total."""
    links = self._tables[table][1]
    found, links_count = network_nodes(
        links.column(source),
        links.column(target),
        None if value is None else links.column(value),
        None if node_table is None else self._tables[node_table][1].column(node or ""),
        directed=directed,
    )
    return len(found), links_count


def _graph_layout(layout: GraphLayout | None) -> str | dict[str, Any] | None:
    """A graph's ``layout`` as the spec takes it, checked with Python's spellings."""
    if layout is None:
        return None
    if not isinstance(layout, (str, Mapping)):
        raise ChartError(
            f"graph layout: expected {listed(list(_GRAPH_LAYOUTS))}, or a dict of its type "
            f"and options; received {shown(layout)}"
        )
    given: dict[str, Any] = {"type": layout} if isinstance(layout, str) else dict(layout)
    kind = given.get("type", "force") if not isinstance(layout, str) else layout
    if kind not in _GRAPH_LAYOUTS:
        raise ChartError(
            f"graph layout: expected {listed(list(_GRAPH_LAYOUTS))}; received {shown(kind)}"
        )
    for option, value in given.items():
        if option == "type":
            continue
        owner = next((name for name, options in _GRAPH_LAYOUTS.items() if option in options), None)
        if owner is None:
            raise ChartError(f'graph layout["{option}"]: not an option of a {kind} layout; drop it')
        if owner != kind:
            raise ChartError(
                f'graph layout["{option}"]: only a {owner} layout takes it; drop it, '
                f'or use "type": "{owner}"'
            )
        choices = _GRAPH_LAYOUTS[kind][option]
        if choices is None and not isinstance(value, bool):
            raise ChartError(
                f'graph layout["{option}"]: expected True or False; received {value!r}'
            )
        if choices is not None and value not in choices:
            raise ChartError(
                f'graph layout["{option}"]: expected {listed(choices)}; received {shown(value)}'
            )
    return layout if isinstance(layout, str) else {"type": kind, **given}


def remaining_moves(
    positions: Mapping[str, Any],
    marks: Sequence[Mapping[str, Any]],
    tables: Mapping[str, Mapping[str, Column]],
    derived: Mapping[str, Any],
    default: str | None,
) -> dict[str, Any]:
    """Moved network nodes (by item key) without those of nodes their
    network's data no longer has, as the browser lets them go (networks too
    large to draw too). Networks of derived tables, whose rows Python does
    not have, keep theirs: a browser that has drawn the change reports which
    it let go of."""
    found: dict[Any, set[str] | None] = {}

    def nodes_of(mark_id: Any) -> set[str] | None:
        mark = next((m for m in marks if m.get("id") == mark_id), None)
        if mark is None and isinstance(mark_id, int) and 0 <= mark_id < len(marks):
            mark = marks[mark_id]
        if mark is None or mark["type"] != "graph":
            return None
        links, node_table = mark.get("data", default), mark.get("nodes")
        if links is None:
            return None
        if links in derived or node_table in derived:
            return None
        columns = tables[links]
        return network_names(
            columns[mark["source"]],
            columns[mark["target"]],
            columns[mark["value"]] if mark.get("value") is not None else None,
            tables[node_table][mark["node"]] if node_table is not None else None,
        )

    kept: dict[str, Any] = {}
    for key, place in positions.items():
        try:
            mark_id, name = json.loads(key)
        except (ValueError, TypeError):
            mark_id = name = None
        # Keys of another shape name no node, and go, as the browser lets them go.
        if (
            not isinstance(mark_id, (int, str))
            or isinstance(mark_id, bool)
            or not isinstance(name, str)
        ):
            continue
        if mark_id not in found:
            found[mark_id] = nodes_of(mark_id)
        names = found[mark_id]
        if names is None or name in names:
            kept[key] = place
    return kept


def network_nodes(
    source: Column,
    target: Column,
    value: Column | None,
    node: Column | None,
    *,
    directed: bool = False,
) -> tuple[set[str], int]:
    """A network's node names and how many links it draws, as the browser
    finds them: the names in the nodes table and in link rows with both
    ends and (with ``value``) a positive, finite value, and one link per pair
    of different names (either way round, unless ``directed``) whose values
    sum to a finite total."""
    keep = _drawn_rows(source, target, value)
    values = None if value is None else value.values
    # Derived tables have no rows here, and their empty codes are floats.
    a, b = (
        np.asarray(column.dictionary, dtype=object)[column.values[keep].astype(np.intp)]
        for column in (source, target)
    )
    names, ids = np.unique(np.concatenate([a, b]), return_inverse=True)
    starts, ends = ids[: len(a)], ids[len(a) :]
    low = starts if directed else np.minimum(starts, ends)
    high = ends if directed else np.maximum(starts, ends)
    distinct = low != high
    pairs, rows = np.unique((low * len(names) + high)[distinct], return_inverse=True)
    links_count = len(pairs)
    if values is not None:
        # Pairs whose values sum past the largest double are left out, as in the browser.
        with np.errstate(over="ignore"):
            totals = np.bincount(rows, weights=values[keep][distinct], minlength=len(pairs))
        links_count = int(np.count_nonzero(np.isfinite(totals)))
    found = {str(name) for name in names}
    if node is not None:
        found.update(_names(node, node.values >= 0))
    return found, links_count


def network_names(
    source: Column, target: Column, value: Column | None, node: Column | None
) -> set[str]:
    """The node names of `network_nodes`, found from the codes rows use
    rather than from a name per row."""
    keep = _drawn_rows(source, target, value)
    found = _names(source, keep) | _names(target, keep)
    if node is not None:
        found |= _names(node, node.values >= 0)
    return found


def _drawn_rows(source: Column, target: Column, value: Column | None) -> np.ndarray:
    """Link rows the browser draws: with both ends and (with ``value``) a
    positive, finite value."""
    keep = (source.values >= 0) & (target.values >= 0)
    if value is not None:
        keep &= (value.values > 0) & (value.values < math.inf)
    return keep


def _names(column: Column, rows: np.ndarray) -> set[str]:
    """The names a category column gives the rows `rows` selects."""
    codes = np.unique(column.values[rows].astype(np.intp))
    return {str(name) for name in np.asarray(column.dictionary, dtype=object)[codes]}
