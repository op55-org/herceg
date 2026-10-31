"""Live charts in notebooks: ``chart.widget()``.

A :class:`ChartWidget` draws a chart with herceg through anywidget (Jupyter
Notebook, JupyterLab, VS Code, and Colab), takes data and option updates from
Python without re-sending the chart, and reports zooming, brushing, hovering,
clicks, drills, and node moves back to Python. Needs the ``notebook`` extra.
"""

from __future__ import annotations

import functools
import inspect
import math
import threading
from collections.abc import Callable, Mapping, Sequence
from typing import TYPE_CHECKING, Any

try:
    import anywidget
    import ipywidgets
    import traitlets
except ImportError as error:  # pragma: no cover - depends on the environment
    raise ImportError(
        "Live notebook charts need the `notebook` extra: pip install 'herceg[notebook]'"
    ) from error

import numpy as np

from . import _render
from ._chart import Camera, Chart, ChartUpdate, Unpack
from ._data import listlike
from ._derive import Expr, _fields_of
from ._errors import (
    ChartError,
    Role,
    checks_hints,
    hints_of,
    is_number,
    listed,
    refusing,
    shown,
    take,
)
from ._events import (
    _UNSET,
    DrillRoot,
    InputEvent,
    Inspection,
    ItemPositions,
    PanelVisibility,
    Range,
    Selection,
    Value,
    ViewEdge,
    Viewport,
    ViewportEvent,
    VisibilityState,
    _fields_taken,
    _milliseconds,
    chart_view,
    checked,
    checked_views,
    decode_drill_root,
    decode_edge,
    decode_input_event,
    decode_item_positions,
    decode_selection,
    decode_viewport_event,
    decode_visibility,
    encode_drill_root,
    encode_item_positions,
    encode_selection,
    encode_view_change,
    same_values,
    same_views,
    views_of,
)
from ._interaction import SNAPS, Snap
from ._live import ExpressData, LiveChart, Message
from ._rows import RowSelection, decode, encode
from .express._common import call_of

if TYPE_CHECKING:
    from ._chart import Chart

__all__ = [
    "ChartWidget",
    "DrillRoot",
    "Inspection",
    "ItemPositions",
    "RowSelection",
    "Selection",
    "Viewport",
]

#: The key of each event's state in messages and the snapshot.
_STATE_KEYS = {
    "select": "selection",
    "viewport": "views",
    "drill": "drill_root",
    "itemMove": "item_positions",
    "camera": "camera",
    "visibility": "visibility",
}
#: Events whose state each subplot's tree, network, or 3D marks have of their own.
_PANEL_EVENTS = ("drill", "itemMove", "camera")
#: The panel mapping property naming each event's subplot states, for messages.
_PANEL_NAMES = {
    "drill": "panel_drill_roots",
    "itemMove": "panel_item_positions",
    "camera": "panel_cameras",
}
#: A state's key: its event, and its subplot's id ("" for the chart's own).
StateKey = tuple[str, str]


class ChartWidget(anywidget.AnyWidget):
    """A chart displayed in a notebook that Python can update and observe.

    Make one with ``chart.widget()`` and display it as the last expression of
    a cell::

        live = hg.line(df, x="time", y="cpu", zoom=True).widget()
        live

    then update it from later cells or a background loop::

        live.append(new_rows, max_rows=10_000)
        live.update(title="CPU, live")
        live.on_select(lambda selection: print(selection and selection.x))

    The data of a ``herceg.express`` chart is the data its function was
    given: ``append`` and ``replace`` change those rows, and the function
    computes the chart again from them, keeping its arguments, its seed, and
    what ``update`` changed.

    Several outputs of one widget show the same chart and stay in step.
    """

    _esm = _render.asset_path("herceg-widget.js")
    # The whole chart, as a browser draws it when it connects. It is built
    # from the current data each time it is sent, so a browser that connects
    # or reloads after updates draws them; the updates themselves travel as
    # small messages and never re-send this.
    _chart = traitlets.Dict().tag(sync=True, to_json=lambda _value, widget: widget._snapshot())
    # Events with Python callbacks; the browser does not send the others.
    _listening = traitlets.List(traitlets.Unicode()).tag(sync=True)

    def __init__(self, chart: Chart) -> None:
        if not isinstance(chart, Chart):
            raise ChartError(
                f"ChartWidget chart: expected an hg.Chart; received {shown(chart)}", path="chart"
            )
        self._live = LiveChart(chart)
        call = call_of(chart)
        # An express chart's rows, which updates change and compute again from.
        self._express = ExpressData(chart, call) if call is not None else None
        # Counts the changes sent to browsers, so a browser that missed one
        # (it was not open yet, say) asks for the whole chart again.
        self._revision = 0
        # Interaction state, as last set here or in a browser: the chart's own
        # (panel ""), and each subplot's tree, network, or 3D marks', by panel.
        # The views are as a browser last reported them (None before any
        # did), with Python's changes of view no browser has made yet.
        keys: list[StateKey] = [("select", ""), ("viewport", ""), ("visibility", "")]
        for event in _PANEL_EVENTS:
            keys += [(event, panel) for panel in self._live.state_panels(event)]
        self._states: dict[StateKey, dict[str, Any] | None] = {
            key: {} if key[0] == "itemMove" else None for key in keys
        }
        # Who changed each (a browser's origin, None for Python) and at which
        # revision. A browser's report based on an earlier revision than
        # someone else's change was made without seeing it, and is dropped.
        self._state_changes: dict[StateKey, tuple[str | None, int]] = {
            key: (None, 0) for key in keys
        }
        # The revision of the last data change that may have taken nodes from
        # each network state: moves reported before it are taken without them.
        self._moves_data: dict[StateKey, int] = {}
        self._view_requests: list[dict[str, Any]] = []
        self._requests = 0
        # Whether what the legends hide was agreed on for a chart drawn before this one.
        self._visibility_carried = False
        # What a browser last refused of what Python asked.
        self._error: ChartError | None = None
        names: list[str | StateKey] = [
            *keys,
            "hover",
            "click",
            "contextMenu",
            "rowSelection",
            "edge",
            "error",
        ]
        self._callbacks = {name: ipywidgets.CallbackDispatcher() for name in names}
        # What each bound channel holds, by table name and channel, in Python's
        # terms: rows by position in the data as it is now.
        # Python numbers rows as the data holds them: a binding's selection starts there.
        self._rows: dict[tuple[str, str], RowSelection] = {
            (name, channel): binding._initial(data, self._live.length(name))
            for (name, channel, data), binding in zip(
                self._live.bound, chart._row_selection, strict=True
            )
        }
        # Who last changed each channel (a browser's origin, None for Python) and
        # at which revision: a browser's report made before another's change is
        # dropped, as for the selection and the viewport.
        self._row_changes: dict[tuple[str, str], tuple[str | None, int]] = {
            key: (None, 0) for key in self._rows
        }
        # Updates may come from a background thread while the kernel's thread
        # sends the whole chart: each change and its message happen together.
        self._lock = threading.RLock()
        super().__init__()
        self.on_msg(self._receive)

    # Updates ---------------------------------------------------------------

    def append(self, rows: Any, *, data: Any = None, max_rows: int | None = None) -> None:
        """Adds rows to the chart's data, for streaming.

        ``rows`` is a table like the chart's data (a dataframe, a mapping of
        column names to arrays, a list of records) or one row as a mapping of
        column names to values. It needs every column the chart reads, with
        the same kinds of values. ``max_rows`` keeps a rolling window: the
        oldest rows are dropped beyond it. ``data`` chooses the table: the
        object a mark read with ``data=``; by default, the chart's data. For
        an express chart, the rows join its function's data, and the chart's
        statistics are computed again.
        """
        if self._express is not None:
            self._refuse_data(data, "widget.append")
            # The rows join the current ones under the lock, so appends
            # from several threads all take part.
            with self._lock:
                changed = self._recompute(self._express.appended(rows, max_rows))
            for key in changed:
                self._callbacks[key](_decoded(key[0], self._states[key]))
            return
        with self._lock:
            before = self._live.numbering()
            message = self._live.append(rows, data, max_rows)
            self._push(message)
            # Rows added take no node from a network; rows dropped or moved may.
            name = message[0]["table"] if message is not None else None
            shrank = name is not None and (
                self._live.dropped[name] > before[name][0] or name in self._live.ordinals
            )
            moved = self._follow_positions(message) if shrank else []
            self._follow_rows(before)
        for key in moved:
            self._callbacks[key](decode_item_positions(self._states[key]))

    def replace(self, rows: Any, *, data: Any = None) -> None:
        """Replaces all rows of the chart's data (or of ``data``, as in
        :meth:`append`); an express chart's statistics are computed again."""
        if self._express is not None:
            self._refuse_data(data, "widget.replace")
            with self._lock:
                changed = self._recompute(self._express.replaced(rows))
            for key in changed:
                self._callbacks[key](_decoded(key[0], self._states[key]))
            return
        with self._lock:
            before = self._live.numbering()
            generations = dict(self._live.generation)
            message = self._live.replace(rows, data)
            self._push(message)
            moved = self._follow_positions(message)
            self._follow_rows(before, generations)
        for key in moved:
            self._callbacks[key](decode_item_positions(self._states[key]))

    def _refuse_data(self, data: Any, method: str) -> None:
        if data is not None:
            assert self._express is not None
            raise ChartError(
                f"{method} data: the {self._express.call.function.__name__} chart is computed "
                "from its function's data, which rows change; drop data="
            )

    def _recompute(self, columns: dict[str, Any]) -> list[StateKey]:
        """Makes the express chart again from `columns` and shows it: its new
        tables replace the old ones at once where its marks are the same, and
        otherwise the whole chart is sent, every display keeping its zoom,
        selection, and legend. Nothing changes if the chart cannot be made.
        Moved network nodes reading tables that changed follow them, as
        after any data change; changed camera defaults reset their views. The states
        that changed are returned. Called with the
        lock held, since `columns` were made from the rows it holds."""
        assert self._express is not None
        chart = self._express.make(columns)
        live = LiveChart(chart, self._live.overrides)
        self._express.keep(columns, chart)
        if not self._live.drawn_alike(live):
            cameras = self._replace_live(live)
            return [*cameras, *self._release_moves(None)]
        before = self._live.numbering()
        generations = dict(self._live.generation)
        message = self._live.adopt(live)
        self._push(message)
        self._follow_rows(before, generations)
        return self._release_moves(list(message[0]["tables"])) if message else []

    def _replace_live(self, live: LiveChart) -> list[StateKey]:
        """Shows another chart in place of this one, sent whole in one message
        that keeps zoom, brush, and cameras with unchanged defaults. Rows
        selected in its tables go, as its tables are new. Returns the camera
        states reset by changed defaults. Called with the lock held."""
        cameras = self._live.configured_cameras()
        self._live = live
        # Changes of view asked for the chart replaced go; what the legends
        # hide was agreed on for its marks, which browsers prune as they draw.
        self._view_requests = []
        self._visibility_carried = True
        self._state_changes[("viewport", "")] = (None, self._revision + 1)
        self._rows = {
            (name, channel): RowSelection(channel, data) for name, channel, data in live.bound
        }
        self._row_changes = {key: (None, self._revision + 1) for key in self._rows}
        spec, buffers = live.to_spec()
        # Python numbers the new tables' rows from their first.
        rows = {name: [0, 0] for name, _, _ in live.bound}
        self._push(({"type": "chart", "spec": spec, "rows": rows}, buffers))
        return self._reconcile_cameras(cameras)

    def _reconcile_cameras(self, previous: dict[str, dict[str, Any]]) -> list[StateKey]:
        """Resets changed defaults and removes departed owners, with the lock held."""
        configured = self._live.configured_cameras()
        changed = []
        for panel, camera in configured.items():
            key = ("camera", panel)
            if key not in self._states:
                self._states[key] = None
                self._state_changes[key] = (None, self._revision)
                self._callbacks[key] = ipywidgets.CallbackDispatcher()
            if panel in previous and previous[panel] != camera:
                if self._change(key, camera, None):
                    changed.append(key)
                # Reject reports based on defaults from before the option update,
                # even when the stored camera already equals the new defaults.
                self._state_changes[key] = (None, self._revision)
        for panel in previous.keys() - configured.keys():
            key = ("camera", panel)
            self._states.pop(key, None)
            self._state_changes.pop(key, None)
        return changed

    def _follow_positions(self, message: Message | None) -> list[StateKey]:
        """Follows a data change in the moves of the networks reading the
        table it changed (see `_release_moves`); the states that changed.
        Called with the lock held."""
        if message is None:
            return []
        return self._release_moves([message[0]["table"]])

    def _release_moves(self, tables: list[str] | None) -> list[StateKey]:
        """Lets go of the moved nodes that the networks reading `tables` no
        longer have, and keeps the rest; for None (a chart made again, with
        new marks), of every network's. The browsers let go of the same
        moves as they draw the change, so nothing is sent; they report moves
        Python has not heard of (not sent before the change, or of networks
        of derived tables, whose rows Python lacks) at the change's revision,
        and reports made before it are taken without the nodes it took. The
        states that changed. Called with the lock held."""
        if tables is None:
            keys = [key for key in self._states if key[0] == "itemMove"]
        else:
            panels = [panel for t in tables for panel in self._live.state_panels("itemMove", t)]
            keys = [("itemMove", panel) for panel in dict.fromkeys(panels)]
        moved = []
        for key in keys:
            positions = self._states[key] or {}
            remaining = {} if tables is None else self._live.remaining_moves(positions)
            if remaining != positions:
                self._states[key] = remaining
                moved.append(key)
            if tables is None:
                # Reports made before were made on other marks.
                self._state_changes[key] = (None, self._revision)
            else:
                self._moves_data[key] = self._revision
        return moved

    def _follow_rows(
        self,
        before: dict[str, tuple[int, np.ndarray | None]],
        generations: dict[str, int] | None = None,
    ) -> None:
        """Keeps selected rows' positions on their rows as rows are dropped from
        the front of their table (or move, in an ordered table), and lets them
        go when it is replaced, as the browser's row sets do. `before` is how
        rows were numbered (`LiveChart.numbering`). Called with the lock held."""
        for (name, channel), current in self._rows.items():
            if current.rows is None:
                continue
            if generations is not None and generations[name] != self._live.generation[name]:
                self._rows[(name, channel)] = RowSelection(channel, current.data)
                continue
            rows = self._live.follow(name, current.rows, before[name])
            self._rows[(name, channel)] = RowSelection(channel, current.data, rows=rows)

    def update(self, **options: Unpack[ChartUpdate]) -> None:
        """Changes chart options, as given to ``hg.Chart``: ``title``, ``x``, ``y``,
        ``theme``, ``zoom``, ``tooltip``, and the rest except data and facets.
        ``None`` restores an option's default."""
        with self._lock:
            cameras = self._live.configured_cameras()
            message = self._live.update(options)
            self._push(message)
            if message is not None:
                # Changes of view asked for before may be of other scales now;
                # the browsers report what the options do to the views, and
                # reports made before were of the scales before.
                self._view_requests = []
                self._state_changes[("viewport", "")] = (None, self._revision)
            changed_cameras = self._reconcile_cameras(cameras)
        for key in changed_cameras:
            self._callbacks[key](_decoded("camera", self._states[key]))

    @property
    def selection(self) -> Selection | None:
        """What is brushed (x and y ranges, a lasso's outline), with the panels
        it was brushed in, or None. Setting a ``Selection``, or an x range as a
        ``(start, end)`` pair, brushes the chart: in the panel ``panels``
        names first (a subplot's id, or a facet panel's key), on the scales it
        draws, or without one on those every panel shares; None clears it.
        What the browser cannot brush comes back as an error (see
        ``on_error``). In a chart with ``row_selection``, setting it draws the
        brush only: set ``row_selection`` to select rows."""
        return decode_selection(self._states[("select", "")])

    @selection.setter
    def selection(self, value: Selection | Range | None) -> None:
        payload = encode_selection(value)
        for panel in payload.get("panels", []) if payload else []:
            self._check_panel(panel, "widget.selection panels")
        self._set(("select", ""), payload)

    def get_viewport(self, *, panel: str | None = None) -> Viewport | None:
        """What the chart shows along each axis, None along an axis not
        zoomed, as a browser showing the widget last reported it; None before
        any did. Without a panel, along each axis the instance every panel
        shares (or the only one) shows, and None along the others (see
        ``hg.ScaleInstance``); with ``panel`` (a subplot's id, or a facet
        panel's key), what that panel shows, or a map's or network's
        subplot's plane, in its units."""
        views = self._states[("viewport", "")]
        if panel is None:
            if views is not None and "view" not in views["axes"]:
                raise ChartError(
                    "widget.get_viewport: each map or network subplot has a view of its own; "
                    "give its panel",
                    path="panel",
                )
            return chart_view(views)
        self._check_panel(panel, "widget.get_viewport panel")
        shown = views_of(views)
        if views is not None and panel not in shown:
            listed = ", ".join(repr(key) for key in shown) or "none"
            raise ChartError(
                f"widget.get_viewport panel: the chart shows no panel {panel!r}; "
                f"the panels are {listed}",
                path="panel",
                code="unknown-reference",
            )
        return shown.get(panel)

    def set_viewport(
        self,
        view: Viewport | Range | None = _UNSET,
        *,
        x: Range | None = _UNSET,
        y: Range | None = _UNSET,
        y_right: Range | None = _UNSET,
        panel: str | None = None,
    ) -> None:
        """Zooms the chart in every browser showing it: an ``hg.Viewport``
        sets every axis (None in it fits that axis), an x range as a
        ``(start, end)`` pair sets x, and None fits every axis; or ``x``,
        ``y``, and ``y_right`` set the axes given (None fits one) and keep
        the others. With ``panel`` (a subplot's id, or a facet panel's key),
        of the scale instances that panel draws, which the panels sharing
        them follow; without, of those every panel shares (or the only one;
        None without a panel fits every one). A map's or network's subplot's
        plane takes ranges in its units, with its ``panel``.

        The browser makes the change as its chart takes it (within the
        chart's ``limits``): ``get_viewport`` and ``on_viewport`` say what it
        shows once a browser reports it, and what it cannot make (an axis the
        panel lacks, a category axis, a panel the chart lacks) comes back as
        an error (see ``on_error``)."""
        axes = {
            name: given
            for name, given in (("x", x), ("y", y), ("y_right", y_right))
            if given is not _UNSET
        }
        change = encode_view_change(view, axes, "widget.set_viewport")
        if panel is not None:
            self._check_panel(panel, "widget.set_viewport panel")
        if change is not None and self._live.plane(panel):
            ranges = axes
            if isinstance(view, Viewport):
                given = _fields_taken(view)[0]
                ranges = {"x": given.x, "y": given.y, "y_right": given.y_right}
            elif view is not _UNSET:
                ranges = {"x": view}
            _check_plane(ranges, "widget.set_viewport", panel)
        with self._lock:
            self._requests += 1
            request = {
                "request": self._requests,
                "viewport": change,
                **({"panel": panel} if panel is not None else {}),
            }
            self._view_requests.append(request)
            self._push(({"type": "setViewport", **request}, []))
            # Reports made before it were made without it.
            self._state_changes[("viewport", "")] = (None, self._revision)

    @property
    def panel_viewports(self) -> dict[str, Viewport]:
        """What each panel shows, by panel key (a subplot's id, a facet
        panel's key, ``""`` in a chart of one panel), as a browser last
        reported it: every panel with axes, and each map's or network's
        subplot's plane, in its units; empty before any browser reported.
        Change views with ``set_viewport``. The returned mapping is a copy."""
        return views_of(self._states[("viewport", "")])

    def _check_panel(self, panel: Any, name: str) -> None:
        """Refuses, naming `name`, a panel other than a subplot's id of a
        chart with subplots; which facet panels a chart has, its data says."""
        if not isinstance(panel, str):
            raise ChartError(f"{name}: expected a panel's id or key; received {shown(panel)}")
        ids = self._live.panel_ids
        if ids and panel not in ids:
            listed = ", ".join(repr(p) for p in ids)
            raise ChartError(
                f"{name}: no panel {panel!r}; the panels are {listed}", code="unknown-reference"
            )

    @property
    def hidden_keys(self) -> tuple[str, ...]:
        """The keys of the series and items the chart's legends hide in every
        panel (as ``Inspection`` points and ``chart.legend_entries`` key
        them). Setting keys hides those and shows the others, in every
        browser; what subplots' own legends hid or showed goes (set
        ``visibility`` to keep it)."""
        state = self._states[("visibility", "")]
        return tuple(state["hiddenKeys"]) if state else ()

    @hidden_keys.setter
    def hidden_keys(self, value: Sequence[str]) -> None:
        if not listlike(value) or not all(isinstance(key, str) for key in value):
            raise ChartError(
                f"widget.hidden_keys: expected a list of keys; received {shown(value)}"
            )
        self._set(("visibility", ""), {"hiddenKeys": list(value)})
        self._visibility_carried = False

    @property
    def visibility(self) -> VisibilityState:
        """What the legends hide: ``hidden_keys`` in every panel, and what each
        subplot's own legend hid and showed there (``panels``). Setting a
        state (one ``on_visibility`` reported, say) hides it in one change."""
        return decode_visibility(self._states[("visibility", "")] or {"hiddenKeys": []})

    @visibility.setter
    def visibility(self, value: VisibilityState) -> None:
        if not isinstance(value, VisibilityState):
            raise ChartError(
                f"widget.visibility: expected an hg.VisibilityState; received {shown(value)}"
            )
        keys = {"hidden_keys": value.hidden_keys}
        panels = {}
        for panel, own in value.panels.items():
            self._check_panel(panel, "widget.visibility panels")
            if not isinstance(own, PanelVisibility):
                raise ChartError(
                    f"widget.visibility panels[{panel!r}]: expected an hg.PanelVisibility; "
                    f"received {shown(own)}"
                )
            keys |= {f"panels[{panel!r}].hidden": own.hidden, f"panels[{panel!r}].shown": own.shown}
            panels[panel] = {"hidden": list(own.hidden), "shown": list(own.shown)}
        for name, given in keys.items():
            if not listlike(given) or not all(isinstance(key, str) for key in given):
                raise ChartError(
                    f"widget.visibility {name}: expected a list of keys; received {shown(given)}"
                )
        state = {"hiddenKeys": list(value.hidden_keys), **({"panels": panels} if panels else {})}
        self._set(("visibility", ""), state)
        self._visibility_carried = False

    @property
    def error(self) -> ChartError | None:
        """What a browser last refused of what Python asked (a change of view,
        a selection, keys to hide, an update it could not apply), or None."""
        return self._error

    @property
    def drill_root(self) -> DrillRoot | None:
        """Item keys from the top level through the current root, or None for
        the whole tree: of the chart's treemap or sunburst (every facet panel's,
        which share one root). Assign a reported path to drill; None resets it.
        Subplots' trees drill apart: see ``panel_drill_roots``."""
        return decode_drill_root(self._states.get(self._own("drill", "widget.drill_root", True)))

    @drill_root.setter
    def drill_root(self, value: DrillRoot | None) -> None:
        self._set(self._own("drill", "widget.drill_root"), encode_drill_root(value))

    @property
    def panel_drill_roots(self) -> dict[str, DrillRoot | None]:
        """Each treemap or sunburst subplot's drill root, by panel id. Assigning a
        mapping drills the panels it names; a panel left out keeps its root.
        The returned mapping is a copy."""
        return {
            panel: decode_drill_root(self._states[("drill", panel)])
            for panel in self._panels("drill", "widget.panel_drill_roots")
        }

    @panel_drill_roots.setter
    def panel_drill_roots(self, value: Mapping[str, DrillRoot | None]) -> None:
        self._set_panels(
            "drill",
            "widget.panel_drill_roots",
            value,
            lambda _panel, root: encode_drill_root(root, "widget.panel_drill_roots"),
        )

    @property
    def item_positions(self) -> ItemPositions:
        """Manual network-node positions by item key, as (x, y) in layout
        units: of the chart's network (every facet panel's, which share one
        layout). Assignment replaces all overrides; {} resets them. Data
        changes reset them too. The returned mapping is a copy. Subplots'
        networks move apart: see ``panel_item_positions``."""
        key = self._own("itemMove", "widget.item_positions", True)
        return decode_item_positions(self._states.get(key))

    @item_positions.setter
    def item_positions(self, value: Mapping[str, tuple[float, float]]) -> None:
        key = self._own("itemMove", "widget.item_positions")
        self._set(key, encode_item_positions(value))

    @property
    def panel_item_positions(self) -> dict[str, ItemPositions]:
        """Each network subplot's manual node positions, by panel id, as
        ``item_positions`` holds the chart's. Assigning a mapping replaces the
        positions of the panels it names; a panel left out keeps its own.
        The returned mapping is a copy."""
        return {
            panel: decode_item_positions(self._states[("itemMove", panel)])
            for panel in self._panels("itemMove", "widget.panel_item_positions")
        }

    @panel_item_positions.setter
    def panel_item_positions(self, value: Mapping[str, Mapping[str, tuple[float, float]]]) -> None:
        self._set_panels(
            "itemMove",
            "widget.panel_item_positions",
            value,
            lambda _panel, positions: encode_item_positions(
                positions, "widget.panel_item_positions"
            ),
        )

    def _own(self, event: str, name: str, reading: bool = False) -> StateKey:
        """The key of the chart's own state of `event`; raises, naming the
        property `name`, for charts whose subplots have theirs, and (unless
        `reading`, which reads it as empty) for charts without any."""
        panels = self._live.state_panels(event)
        if panels == [""] or (reading and not panels):
            return (event, "")
        what = {"drill": "treemap or sunburst", "itemMove": "network", "camera": "3D camera"}[event]
        if not panels:
            does = (
                "only treemaps and sunbursts drill"
                if event == "drill"
                else "only 3D marks have cameras"
                if event == "camera"
                else "only networks' nodes move"
            )
            raise ChartError(f"{name}: the chart has no {what}; {does}")
        mapping = _PANEL_NAMES[event].replace("panel_", "widget.panel_")
        raise ChartError(f"{name}: the chart's {what} subplots each have their own; use {mapping}")

    def _panels(self, event: str, name: str) -> list[str]:
        """The subplots with states of `event` of their own; [] for charts without any."""
        return [panel for panel in self._live.state_panels(event) if panel != ""]

    def _set_panels(
        self,
        event: str,
        name: str,
        value: Mapping[str, Any],
        encode_one: Callable[[str, Any], dict[str, Any] | None],
    ) -> None:
        """Sets the subplot states `value` names, all or none: a panel without
        such a state, or a value of another shape, changes nothing."""
        if not isinstance(value, Mapping):
            raise ChartError(f"{name}: expected panel ids mapped to their states")
        panels = self._panels(event, name)
        encoded = {}
        for panel, one in value.items():
            if panel not in panels:
                listed = ", ".join(repr(p) for p in panels) or "none"
                raise ChartError(f"{name}: no panel {panel!r} of its kind; the panels are {listed}")
            encoded[panel] = encode_one(panel, one)
        for panel, payload in encoded.items():
            self._set((event, panel), payload)

    @property
    def row_selection(self) -> RowSelection | None:
        """What the channel of the chart's row selection holds (see
        ``hg.SelectionBinding``): rows by position in the data as it is now, or
        a brush's condition. None for a chart without one. Setting rows (whole
        numbers, or a boolean mask), a condition (``hg.col("fare") > 20``), or
        None selects them in the browser."""
        if not self._rows:
            return None
        return self._only_binding()

    @row_selection.setter
    def row_selection(self, value: Any) -> None:
        current = self._only_binding()
        name = next(name for (name, channel) in self._rows if channel == current.channel)
        condition = value.condition if isinstance(value, RowSelection) else value
        if isinstance(condition, Expr):
            for field in sorted(_fields_of(condition._json) - self._live.columns(name)):
                raise ChartError(
                    f"widget.row_selection: the chart sends no column {field!r} to the browser "
                    f"for a condition to test; name it in hg.SelectionBinding(..., "
                    f"fields=[{field!r}])"
                )
        with self._lock:
            selection, buffers = encode(value, self._live.length(name))
            stored = _held(current, selection, buffers)
            self._rows[(name, current.channel)] = stored
            message = {"type": "rows", "table": name, "channel": current.channel}
            self._push(({**message, "selection": selection}, buffers))
            self._row_changes[(name, current.channel)] = (None, self._revision)
        self._callbacks["rowSelection"](stored)

    def _only_binding(self) -> RowSelection:
        if len(self._rows) != 1:
            raise ChartError(
                "widget.row_selection: the chart binds several row selections; "
                "read them with on_row_selection"
                if self._rows
                else "widget.row_selection: the chart has none; give hg.Chart a row_selection"
            )
        return next(iter(self._rows.values()))

    # Events ----------------------------------------------------------------

    def on_row_selection(
        self, callback: Callable[[RowSelection], Any], remove: bool = False
    ) -> None:
        """Calls ``callback(selection)`` when a channel of the chart's row
        selection changes in a browser: rows selected by a click or lasso (by
        position in the data as it is now), a brush's condition, or nothing."""
        self._listen("rowSelection", callback, remove)

    def on_select(self, callback: Callable[[Selection | None], Any], remove: bool = False) -> None:
        """Calls ``callback(selection)`` when what is brushed changes."""
        self._listen(("select", ""), callback, remove)

    def on_viewport(
        self,
        callback: Callable[[ViewportEvent], Any],
        remove: bool = False,
        *,
        panel: str | None = None,
    ) -> None:
        """Calls ``callback(event)`` when what the chart shows changes, as a
        browser reports it (zooming, panning, a reset, ``set_viewport``, new
        data or options moving the view): an ``hg.ViewportEvent`` of the
        scale instances that changed and the whole view of each panel showing
        one. With ``panel``, only for changes ``event.views`` names it in.
        Reports reach Python at most every 100 ms, changes meanwhile as one."""
        if panel is not None:
            self._check_panel(panel, "widget.on_viewport panel")
        key = ("viewport", panel or "")
        self._callbacks.setdefault(key, ipywidgets.CallbackDispatcher())
        self._listen(key, callback, remove)

    def on_visibility(
        self, callback: Callable[[VisibilityState], Any], remove: bool = False
    ) -> None:
        """Calls ``callback(state)`` when what the legends hide changes, in a
        browser or from Python (see ``visibility``)."""
        self._listen(("visibility", ""), callback, remove)

    def on_error(self, callback: Callable[[ChartError], Any], remove: bool = False) -> None:
        """Calls ``callback(error)`` when a browser refuses what Python asked: a
        change of view (``set_viewport``), a selection, keys to hide, or an
        update it could not apply. The call that asked has returned by then,
        so the error comes here (and to ``error``) instead of being raised."""
        self._listen("error", callback, remove)

    def on_drill(
        self,
        callback: Callable[[DrillRoot | None], Any],
        remove: bool = False,
        *,
        panel: str | None = None,
    ) -> None:
        """Calls callback(root) when drilling changes, including Python
        assignments; with ``panel``, of that subplot's tree (see
        ``panel_drill_roots``)."""
        self._listen(self._key("drill", panel, "widget.on_drill"), callback, remove)

    def on_item_move(
        self,
        callback: Callable[[ItemPositions], Any],
        remove: bool = False,
        *,
        panel: str | None = None,
    ) -> None:
        """Calls callback(positions) with all overrides after a move or reset;
        with ``panel``, of that subplot's network (see ``panel_item_positions``)."""
        self._listen(self._key("itemMove", panel, "widget.on_item_move"), callback, remove)

    def _key(self, event: str, panel: str | None, name: str) -> StateKey:
        """The key of the state a callback hears of: the chart's own, or the
        subplot `panel` names; raises, naming `name`, for one of neither."""
        if panel is None:
            self._own(event, name if event == "camera" else f"widget.{_STATE_KEYS[event]}")
            return (event, "")
        panels = self._panels(event, name)
        if panel not in panels:
            listed = ", ".join(repr(p) for p in panels) or "none"
            raise ChartError(
                f"{name} panel: no panel {panel!r} of its kind; the panels are {listed}"
            )
        return (event, panel)

    def on_hover(self, callback: Callable[[InputEvent], Any], remove: bool = False) -> None:
        """Calls ``callback(event)`` (an ``hg.InputEvent``) when the pointer
        moves, or what it or a cursor is on, or the data the inspection reads
        there, changes: ``event.pointer``, ``event.target``, and
        ``event.inspection`` (None off the data)."""
        self._listen("hover", callback, remove)

    def on_click(self, callback: Callable[[InputEvent], Any], remove: bool = False) -> None:
        """Calls ``callback(event)`` (an ``hg.InputEvent``) when a plot, an
        item, an axis label, or a legend entry is clicked, or Enter is
        pressed on the keyboard cursor (``event.cause == "keyboard"``)."""
        self._listen("click", callback, remove)

    def on_context_menu(self, callback: Callable[[InputEvent], Any], remove: bool = False) -> None:
        """Calls ``callback(event)`` (an ``hg.InputEvent``) on a secondary press
        (a right click, a long press): where, and what it is on. While a
        callback listens, the browser's own menu stays off the plots."""
        self._listen("contextMenu", callback, remove)

    def on_edge(self, callback: Callable[[ViewEdge], Any], remove: bool = False) -> None:
        """Calls ``callback(edge)`` when the view comes near an end of what the
        chart's ``limits`` let it show (see ``hg.ViewLimits``), as it nears it:
        to load older data, say, append it, and widen the extent."""
        self._listen("edge", callback, remove)

    def show_cursor(
        self,
        *,
        x: Value | None = None,
        y: Value | None = None,
        broadcast: bool = True,
        snap: Snap | None = None,
        tooltip: bool | None = None,
    ) -> None:
        """Shows the cursor at a value on ``x`` or ``y`` (a datetime on time
        axes, a category's name on category axes) in every browser showing the
        widget, as a synced chart's cursor shows: a crosshair and the points
        there. ``snap`` and ``tooltip`` say which points it reads and whether
        with the tooltip (see ``hg.SyncChannel``; the cursor channel's by
        default, else the chart's inspection's and none). Shared with the charts of its
        cursor channel unless ``broadcast`` is False."""
        if x is None and y is None:
            raise ChartError(
                "widget.show_cursor x: expected x or y, one of them; give one", path="x"
            )
        if x is not None and y is not None:
            raise ChartError(
                "widget.show_cursor y: expected x or y, one of them; drop one", path="y"
            )
        axis, value = ("x", x) if x is not None else ("y", y)
        if not isinstance(value, str):
            value = _milliseconds(value, f"widget.show_cursor {axis}")
        if snap is not None and snap not in SNAPS:
            raise ChartError(
                f"widget.show_cursor snap: expected {listed(SNAPS)}; received {shown(snap)}"
            )
        if tooltip is not None and not isinstance(tooltip, bool):
            raise ChartError(
                f"widget.show_cursor tooltip: expected True or False; received {tooltip!r}"
            )
        message: dict[str, Any] = {
            "type": "cursor",
            "position": {axis: value},
            "broadcast": bool(broadcast),
        }
        if snap is not None:
            message["snap"] = snap
        if tooltip is not None:
            message["tooltip"] = tooltip
        self.send(message)

    def hide_cursor(self, *, broadcast: bool = True) -> None:
        """Hides the cursor ``show_cursor`` or a synced chart shows."""
        self.send({"type": "cursor", "position": None, "broadcast": bool(broadcast)})

    @property
    def camera(self) -> Camera | None:
        """The chart's current 3D camera; subplots use ``panel_cameras``."""
        return _decode_camera(self._states.get(self._own("camera", "widget.camera", True)))

    @camera.setter
    def camera(self, value: Camera | None) -> None:
        self._set(self._own("camera", "widget.camera"), _encode_camera(value, "widget.camera"))

    @property
    def panel_cameras(self) -> dict[str, Camera | None]:
        """Each 3D subplot's current camera. Assign a mapping to change those panels;
        None restores its configured camera. Panels left out keep their views."""
        return {
            panel: _decode_camera(self._states[("camera", panel)])
            for panel in self._panels("camera", "widget.panel_cameras")
        }

    @panel_cameras.setter
    def panel_cameras(self, value: Mapping[str, Camera | None]) -> None:
        self._set_panels(
            "camera",
            "widget.panel_cameras",
            value,
            lambda _panel, camera: _encode_camera(camera, "widget.panel_cameras"),
        )

    def on_camera(
        self,
        callback: Callable[[Camera | None], Any],
        remove: bool = False,
        *,
        panel: str | None = None,
    ) -> None:
        """Calls callback(camera) when camera state changes, for the subplot named
        by panel or the standalone chart, including the first browser's resolved
        camera. Reports are throttled while dragging."""
        self._listen(self._key("camera", panel, "widget.on_camera"), callback, remove)

    # Internals -------------------------------------------------------------

    def _snapshot(self) -> dict[str, Any]:
        with self._lock:
            spec, buffers = self._live.to_spec()
            # Python's numbering of bound tables' rows: drops and replaces,
            # and for an ordered table, its rows' identities as Python holds
            # them (a buffer) and the next one's.
            numbering: dict[str, list[int]] = {}
            for name, _, _ in self._live.bound:
                numbering[name] = [self._live.dropped[name], self._live.generation[name]]
                if name in self._live.ordinals:
                    numbering[name] += [len(buffers), self._live.next_ordinal[name]]
                    buffers = [*buffers, self._live.ordinals[name].astype("<f8").tobytes()]
            # What the bound channels hold, rows as buffers after the columns'.
            held = []
            for (name, channel), current in self._rows.items():
                selection, extra = encode(current, self._live.length(name))
                if selection is not None and extra:
                    selection = {**selection, "rows": len(buffers)}
                    buffers = [*buffers, *extra]
                held.append({"table": name, "channel": channel, "selection": selection})
            own = {
                event: self._states.get((event, ""), {} if event == "itemMove" else None)
                for event in _STATE_KEYS
            }
            visibility = own["visibility"]
            panels: dict[str, dict[str, Any]] = {}
            for (event, panel), state in self._states.items():
                if panel:
                    panels.setdefault(event, {})[panel] = state
            return {
                "revision": self._revision,
                "spec": spec,
                "buffers": buffers,
                "selection": own["select"],
                "viewport": own["viewport"],
                "viewportRequests": self._view_requests,
                "visibility": visibility
                and {"state": visibility, "carried": self._visibility_carried},
                "drill_root": own["drill"],
                "item_positions": own["itemMove"],
                "camera": own["camera"],
                "panel_states": panels,
                "rows": numbering,
                "rowSelections": held,
            }

    def send_state(self, key: Any = None) -> None:
        # The state is built from the current data when it is sent; holding
        # the lock until then keeps a later update from overtaking it.
        with self._lock:
            super().send_state(key)

    def _push(self, message: Message | None) -> None:
        """Sends a change to every browser; called with the lock held."""
        if message is None:
            return
        content, buffers = message
        self._revision += 1
        self.send({**content, "revision": self._revision}, buffers)

    def _set(self, key: StateKey, payload: dict[str, Any] | None) -> None:
        with self._lock:
            changed = self._change(key, payload, None)
        if changed:
            self._callbacks[key](_decoded(key[0], payload))

    def _change(self, key: StateKey, payload: dict[str, Any] | None, origin: str | None) -> bool:
        """Records interaction state and sends it to every browser, unless its
        values are unchanged. Called with the lock held; the browser it came from
        (`origin`) ignores it."""
        event, panel = key
        stored = self._states[key]
        exact = ("drill", "itemMove", "camera", "visibility")
        same = (
            same_views(payload, stored)
            if event == "viewport"
            else payload == stored
            if event in exact
            else same_values(payload, stored)
        )
        if same:
            if event in (*exact, "viewport"):
                return False
            # The same values: only what is said of them may be news (which
            # axes hold times, the categories a lasso is over), and a lasso's
            # categories stay known when assigned again from Python.
            if payload is not None:
                kept = (
                    {} if stored is None else {k: v for k, v in stored.items() if k == "categories"}
                )
                self._states[key] = {**kept, **payload}
            return False
        self._states[key] = payload
        message = {
            "type": event,
            _STATE_KEYS[event]: payload,
            **({"panel": panel} if panel else {}),
        }
        self._push(({**message, "origin": origin} if origin else message, []))
        self._state_changes[key] = (origin, self._revision)
        return True

    def _viewport_changed(self, event: ViewportEvent | None) -> None:
        """Calls the viewport callbacks of a change a browser drew: those of
        every change, and those of a panel it shows."""
        if event is None:
            return
        for listened, calls in list(self._callbacks.items()):
            if isinstance(listened, tuple) and listened[0] == "viewport":
                if listened[1] == "" or listened[1] in event.views:
                    calls(event)

    def _listen(self, name: str | StateKey, callback: Callable[..., Any], remove: bool) -> None:
        self._callbacks[name].register_callback(callback, remove=remove)
        # The browser sends the events Python listens for (hover, clicks, the camera).
        self._listening = list(
            dict.fromkeys(
                key[0] if isinstance(key, tuple) else key
                for key, calls in self._callbacks.items()
                if calls.callbacks
            )
        )

    def _receive(self, _widget: Any, content: dict[str, Any], buffers: list[Any]) -> None:
        kind = content.get("type")
        if kind == "ready":
            # A browser that connected after updates catches up.
            with self._lock:
                if content.get("revision") != self._revision:
                    self.send_state("_chart")
        elif kind == "resync":
            # A browser that missed an update.
            self.send_state("_chart")
        elif kind in _STATE_KEYS:
            panel = content.get("panel", "") if kind in _PANEL_EVENTS else ""
            key = (kind, panel)
            # A state the chart has (a subplot's tree, network, or map's, say).
            if key not in self._states:
                return
            try:
                payload = _checked_state(kind, content.get(_STATE_KEYS[kind]))
                # The changes of view that made the views reported, if a display drew them.
                event = (
                    decode_viewport_event(content["event"])
                    if kind == "viewport" and "event" in content
                    else None
                )
            except ValueError:
                # Nothing this module reads; the state stays as it was.
                return
            origin = content.get("origin")
            with self._lock:
                changer, revision = self._state_changes[key]
                made = content.get("revision", 0)
                stale = changer != origin and revision > made
                if not stale and kind == "itemMove" and self._moves_data.get(key, 0) > made:
                    # Moves made before a data change, without the nodes it took,
                    # as the browser that made them lets go of them drawing it.
                    payload = self._live.remaining_moves(payload or {})
                changed = not stale and self._change(key, payload, origin)
                if changed and kind == "visibility":
                    self._visibility_carried = False
            if changed and kind == "viewport":
                self._viewport_changed(event)
            elif changed:
                self._callbacks[key](_decoded(kind, payload))
        elif kind == "applied":
            with self._lock:
                # Made in a browser, so not asked again of one that connects.
                done = content.get("request")
                self._view_requests = [
                    request
                    for request in self._view_requests
                    if not (isinstance(done, int) and request["request"] <= done)
                ]
        elif kind == "error":
            error = _browser_error(content.get("error"))
            if error is None:
                return
            with self._lock:
                done = content.get("request")
                self._view_requests = [
                    request for request in self._view_requests if request["request"] != done
                ]
                self._error = error
            self._callbacks["error"](error)
        elif kind == "edge":
            try:
                edge = decode_edge(content.get("edge"))
            except ValueError:
                return
            self._callbacks["edge"](edge)
        elif kind in ("hover", "click", "contextMenu"):
            try:
                input_event = decode_input_event(content.get("event"))
            except (ValueError, ChartError):
                return
            self._callbacks[kind](input_event)
        elif kind == "rowSelection":
            name = content.get("table")
            with self._lock:
                key = (name, content.get("channel"))
                if not isinstance(name, str) or key not in self._rows:
                    return
                origin = content.get("origin")
                changer, revision = self._row_changes[key]
                if changer != origin and revision > content.get("revision", 0):
                    return
                # Rows are numbered as Python numbers them, so rows appended or
                # dropped since the browser selected them are accounted for;
                # rows of data replaced since are not reported.
                try:
                    selection = decode(
                        content,
                        buffers,
                        self._rows[key].data,
                        self._live.dropped[name],
                        self._live.generation[name],
                        self._live.length(name),
                        (lambda rows: self._live.positions(name, rows))
                        if name in self._live.ordinals
                        else None,
                    )
                except ValueError:
                    return
                self._rows[key] = selection
                # Other browsers of the widget show it too; the one it came from has it.
                encoded, extra = encode(selection, self._live.length(name))
                message = {"type": "rows", "table": name, "channel": key[1], "selection": encoded}
                self._push(({**message, "origin": origin}, extra))
                self._row_changes[key] = (origin, self._revision)
            self._callbacks["rowSelection"](selection)


def _refuse_where_given(cls: type[ChartWidget]) -> None:
    """Makes the widget's refusals ChartErrors where they were given: a
    method's at its argument (``widget.append max_rows`` at ``max_rows``,
    ``widget.update``'s at the chart's option), and a property's at its
    name (``widget.viewport = ...`` at ``viewport``)."""
    for name, member in list(vars(cls).items()):
        if name.startswith("_") or name == "send_state":
            continue
        if isinstance(member, property) and member.fset is not None:
            setattr(cls, name, member.setter(_setting(name, member.fset)))
        elif inspect.isfunction(member):
            setattr(cls, name, _method(name, member))


def _method(name: str, function: Callable[..., Any]) -> Callable[..., Any]:
    owner = f"widget.{name}"
    signature = inspect.signature(function)
    options = set(signature.parameters) - {"self"}
    owners: tuple[str, ...] = (owner,)
    if name == "update":
        # The chart's options, refused as the chart refuses them ("Chart title: ...").
        options |= ChartUpdate.__optional_keys__
        owners = (owner, "Chart")
    hinted = checks_hints(owner)(function)

    @functools.wraps(function)
    def method(*args: Any, **kwargs: Any) -> Any:
        with refusing(owners, options):
            if "callback" in options:
                try:
                    callback = signature.bind(*args, **kwargs).arguments.get("callback")
                except TypeError:
                    callback = print  # Python says what the call lacks
                if not callable(callback):
                    raise ChartError(
                        f"{owner} callback: expected a function; received {shown(callback)}",
                        path="callback",
                    )
            return hinted(*args, **kwargs)

    return method


def _setting(name: str, set: Callable[[Any, Any], None]) -> Callable[[Any, Any], None]:
    # The value is taken by its hint (NumPy's scalars as Python's, a pair
    # from an array), at the property's name; a refusal of a viewport's or
    # selection's field is at the field within it.
    hint = hints_of(set).get("value")
    at = Role(f"widget.{name}")  # placed at the name by the frame below

    @functools.wraps(set)
    def setting(self: Any, value: Any) -> None:
        fields = (type(value).__name__,) if isinstance(value, (Viewport, Selection)) else ()
        with refusing((f"widget.{name}", *fields), None, name):
            set(self, value if hint is None else take(at, hint, value))

    return setting


_refuse_where_given(ChartWidget)


def _held(
    current: RowSelection, selection: dict[str, Any] | None, buffers: list[bytes]
) -> RowSelection:
    """What a channel holds once Python set `selection` (encoded) on it."""
    if selection is None:
        return RowSelection(current.channel, current.data)
    if selection["kind"] == "predicate":
        return RowSelection(current.channel, current.data, condition=Expr(selection["expression"]))
    rows = np.frombuffer(buffers[0], dtype="<u4").astype(np.int64)
    return RowSelection(current.channel, current.data, rows=rows)


def _decoded(
    event: str, payload: dict[str, Any] | None
) -> Selection | DrillRoot | ItemPositions | Camera | VisibilityState | None:
    """Interaction state as Python reads it."""
    if event == "camera":
        return _decode_camera(payload)
    if event == "drill":
        return decode_drill_root(payload)
    if event == "itemMove":
        return decode_item_positions(payload)
    if event == "visibility":
        return decode_visibility(payload or {"hiddenKeys": []})
    return decode_selection(payload)


def _check_plane(ranges: Mapping[str, Any], name: str, panel: str | None) -> None:
    """Refuses, naming `name`, a change of a map's or network's plane other
    than in its units: finite numbers along x and y (`ranges`, by axis), and
    no right y."""
    if ranges.get("y_right") is not None:
        raise ChartError(f"{name} y_right: a map or network has no right y axis; drop y_right")
    for axis in ("x", "y"):
        ends = ranges.get(axis)
        if ends is not None and not all(_plane_number(end) for end in ends):
            where = f" of {panel!r}" if panel else ""
            raise ChartError(
                f"{name} {axis}: expected finite numbers in the plane's units{where}; "
                f"received {shown(ends)}"
            )


def _plane_number(value: Any) -> bool:
    """Whether a view's end is a finite number (not a time, a label, or a bool)."""
    return is_number(value) and not isinstance(value, (bool, np.bool_)) and math.isfinite(value)


def _checked_state(event: str, payload: Any) -> dict[str, Any] | None:
    """A state a browser reports, checked as `checked` checks states: the
    views (see `checked_views`), and what the legends hide."""
    if event == "viewport":
        return checked_views(payload)
    if event == "visibility":
        decode_visibility(payload)
        return dict(payload)
    return checked(event, payload)


def _browser_error(info: Any) -> ChartError | None:
    """What a browser refused, as the engine says it (``ChartErrorInfo``), in
    Python's spelling: a change of view as ``widget.set_viewport y_right:
    ...``; None for a report of another shape."""
    if not isinstance(info, Mapping) or not isinstance(info.get("message"), str):
        return None
    error = ChartError.from_info(info)
    # The engine's location is its method's ("setViewport panel: ..."): Python names its own.
    method, located, problem = error.message.partition(": ")
    if not (located and method.split(" ")[0] == "setViewport"):
        return error
    at = f" {error.path}" if error.path else ""
    return ChartError(
        f"widget.set_viewport{at}: {problem}",
        code=error.code,
        path=error.path,
        panel=error.panel,
        phase=error.phase,
    )


def _decode_camera(payload: dict[str, Any] | None) -> Camera | None:
    return Camera(**payload) if payload is not None else None


def _encode_camera(value: Camera | None, name: str) -> dict[str, Any] | None:
    if value is None:
        return None
    if not isinstance(value, Camera):
        raise ChartError(f"{name}: expected hg.Camera or None; use hg.Camera")
    return value._spec()
