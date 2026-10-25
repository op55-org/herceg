"""Herceg charts in web pages served by Flask, Django, FastAPI, or anything else.

Put the engine on the page once, then a fragment per chart::

    from herceg import web

    head = web.assets(base_url="/static/herceg", nonce=nonce)
    body = web.fragment(chart, id="latency", nonce=nonce)

``assets`` loads herceg's script from where the application serves the files
of ``manifest()`` (each named by a hash of its content, so they can be cached
for good). A fragment holds its chart's data, or with ``data_url`` names a
route that returns ``payload(chart)``. The script mounts every fragment, also
those inserted later (HTMX), and tells the page what the user does with DOM
events (``herceg:click``, ``herceg:select``, ``herceg:viewport``,
``herceg:edge``, ``herceg:visibility``, ``herceg:rowselection``,
``herceg:ready``, ``herceg:error``); ``selection``, ``inspection``,
``viewport``, ``select_event``, ``viewport_event``, ``edge``, and
``visibility`` read what a page posts back of them. Fragments work under a
strict Content Security Policy: they hold no script, and the nonce goes on
the script and on the style element that reserves each chart's size.
``herceg.flask`` wires this into a Flask app.
"""

from __future__ import annotations

import html
import json
import re
import uuid
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from functools import cache
from importlib.resources import files
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypeVar

from ._errors import ChartError, shown
from ._events import (
    Inspection,
    SelectEvent,
    Selection,
    ViewEdge,
    Viewport,
    ViewportEvent,
    VisibilityState,
    checked,
    decode_edge,
    decode_inspection,
    decode_select_event,
    decode_selection,
    decode_viewport,
    decode_viewport_event,
    decode_visibility,
)
from ._payload import encode, inline

if TYPE_CHECKING:
    from ._chart import Chart

_T = TypeVar("_T")

__all__ = [
    "AssetManifest",
    "asset_path",
    "assets",
    "edge",
    "fragment",
    "inspection",
    "manifest",
    "payload",
    "select_event",
    "selection",
    "viewport",
    "viewport_event",
    "visibility",
]

#: The height in CSS pixels of a chart without one, as in HTML output.
_HEIGHT = 320
_ID = re.compile(r"[A-Za-z][A-Za-z0-9_-]*")
_NONCE = re.compile(r"[A-Za-z0-9+/_=-]+")


class _Html(str):
    """Markup herceg wrote, every given value escaped: Jinja's and Django's
    templates insert it as it is (the ``__html__`` protocol)."""

    __slots__ = ()

    def __html__(self) -> str:
        return self


@dataclass(frozen=True)
class AssetManifest:
    """The files of herceg's script for web pages, in ``directory``: serve them
    all from one URL (``assets(base_url=...)``), with long-lived caching, as
    each file's name changes with its content."""

    directory: Path
    #: The module the page loads.
    entry: str
    #: The modules it imports at once, which the page fetches beside it.
    preload: tuple[str, ...]
    #: Every file, the modules charts load as they need them included.
    files: tuple[str, ...]


@cache
def manifest() -> AssetManifest:
    """The web assets the package ships."""
    directory = Path(str(files("herceg") / "static" / "web"))
    try:
        listed = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        listed = None
    if listed is None or not all((directory / name).is_file() for name in listed["files"]):
        raise RuntimeError(
            "herceg's web assets are missing. In a source checkout, run "
            "`npm run build:python` from the repository root."
        )
    return AssetManifest(
        directory=directory,
        entry=listed["entry"],
        preload=tuple(listed["preload"]),
        files=tuple(listed["files"]),
    )


def asset_path(name: str) -> Path:
    """The file of a web asset, by the name ``manifest()`` lists: for a route that
    serves them. Other names raise ``FileNotFoundError``, so a route can answer 404."""
    if not isinstance(name, str):
        raise ChartError(
            f"web.asset_path name: expected a file's name from manifest().files; "
            f"received {shown(name)}",
            path="name",
        )
    found = manifest()
    if name not in found.files:
        raise FileNotFoundError(
            f"web.asset_path: no web asset named {shown(name)}; name one of manifest().files"
        )
    return found.directory / name


def assets(base_url: str, *, nonce: str | None = None) -> str:
    """The tags that load herceg's script, once per page (in its head, say):
    ``base_url`` is where the application serves the files of ``manifest()``,
    and ``nonce`` the page's Content Security Policy nonce."""
    if not isinstance(base_url, str) or not base_url.strip():
        raise ChartError(
            "web.assets base_url: expected the URL the files of web.manifest() are served "
            f'from ("/static/herceg"); received {shown(base_url)}',
            path="base_url",
        )
    found = manifest()
    base = base_url.rstrip("/") + "/"
    extra = f' crossorigin="anonymous"{_nonce(nonce, "web.assets")}'
    tags = [
        f'<link rel="modulepreload" href="{html.escape(base + name)}"{extra}>'
        for name in found.preload
    ]
    tags.append(f'<script type="module" src="{html.escape(base + found.entry)}"{extra}></script>')
    return _Html("\n".join(tags))


def fragment(
    chart: Chart,
    *,
    id: str | None = None,
    nonce: str | None = None,
    data_url: str | None = None,
) -> str:
    """The chart for a page that has ``assets()``: an element holding the
    chart's spec and data, which herceg's script mounts. With ``data_url``, the
    data stays on the server: the script fetches the chart from that URL, a
    route returning ``payload(chart)``, and the fragment holds only the size
    and title. ``id`` names the element (generated when omitted); ``nonce`` is
    the page's Content Security Policy nonce, for the style element that
    reserves the chart's size. Without JavaScript or ``assets()``, the
    fragment says so in the chart's place."""
    _check_chart(chart, "web.fragment")
    if id is None:
        element = f"herceg-{uuid.uuid4().hex[:12]}"
    elif isinstance(id, str) and _ID.fullmatch(id):
        element = id
    else:
        raise ChartError(
            "web.fragment id: expected a name that starts with a letter, then letters, "
            f'digits, "-" or "_" ("latency"); received {shown(id)}',
            path="id",
        )
    attributes = ""
    content = ""
    if data_url is None:
        spec, buffers = chart.to_spec()
        options = spec
        text = json.dumps(inline(spec, buffers), separators=(",", ":"), allow_nan=False)
        content = f"<template data-herceg-payload>{html.escape(text, quote=False)}</template>\n"
    elif isinstance(data_url, str) and data_url.strip():
        options = chart._options
        attributes = f' data-herceg-src="{html.escape(data_url)}"'
    else:
        raise ChartError(
            "web.fragment data_url: expected the URL of a route returning web.payload(chart) "
            f'("/charts/latency.bin"); received {shown(data_url)}',
            path="data_url",
        )
    width = options.get("width")
    height = options.get("height") or _HEIGHT
    if width is not None:
        attributes += f' data-herceg-width="{width:g}"'
    title = options.get("title")
    if isinstance(title, Mapping):
        title = title.get("text")
    description = options.get("description")
    named = f": {title}" if title else ""
    fallback = (
        f"<p>Chart not loaded yet{html.escape(named)}. It needs JavaScript, and "
        "herceg.web.assets() once in the page.</p>"
    )
    if description:
        fallback += f"<p>{html.escape(description)}</p>"
    size = f"width:{f'{width:g}px' if width is not None else '100%'};height:{height:g}px"
    return _Html(
        f'<div id="{element}" class="herceg-chart" data-herceg data-herceg-height="{height:g}"'
        f"{attributes}>\n"
        f"<style data-herceg-style{_nonce(nonce, 'web.fragment')}>"
        f"#{element}{{{size}}}</style>\n"
        f"<div data-herceg-fallback>{fallback}</div>\n"
        f"{content}</div>"
    )


def payload(chart: Chart) -> bytes:
    """The chart as one binary payload, for a route a fragment's ``data_url``
    names (``application/octet-stream``): the spec and its columns, which the
    browser views without parsing or copying."""
    _check_chart(chart, "web.payload")
    return encode(*chart.to_spec())


def _check_chart(chart: Any, location: str) -> None:
    from ._chart import Chart

    if not isinstance(chart, Chart):
        raise ChartError(
            f"{location} chart: expected an hg.Chart; received {shown(chart)}", path="chart"
        )


def selection(value: str | Mapping[str, Any] | None) -> Selection | None:
    """A selection a page posts back: a ``herceg:select`` event's
    ``detail.selection``, as JSON text or parsed; None for none."""
    return _read("web.selection", lambda value: decode_selection(checked("select", value)), value)


def inspection(value: str | Mapping[str, Any] | None) -> Inspection | None:
    """The data clicked, as a page posts it back: a ``herceg:click`` event's
    ``detail.inspection``, as JSON text or parsed; None off the data."""
    return _read("web.inspection", lambda value: decode_inspection(checked("click", value)), value)


def viewport(value: str | Mapping[str, Any] | None) -> Viewport:
    """A view a page posts back: a panel's, an entry of a ``herceg:viewport``
    event's ``detail.views``, as JSON text or parsed."""
    return _read("web.viewport", lambda value: decode_viewport(checked("viewport", value)), value)


def select_event(value: str | Mapping[str, Any]) -> SelectEvent:
    """A ``herceg:select`` event's ``detail`` as a page posts it back, JSON
    text or parsed: the selection, None once cleared, and what it belongs to."""
    return _read("web.select_event", decode_select_event, value)


def viewport_event(value: str | Mapping[str, Any]) -> ViewportEvent:
    """A ``herceg:viewport`` event's ``detail`` as a page posts it back, JSON
    text or parsed: one change of view, as ``widget.on_viewport`` hears it."""
    return _read("web.viewport_event", decode_viewport_event, value)


def edge(value: str | Mapping[str, Any]) -> ViewEdge:
    """A ``herceg:edge`` event's ``detail`` as a page posts it back, JSON text
    or parsed: the view came near an end of what the chart's limits let a
    scale show, as ``widget.on_edge`` hears it."""
    return _read("web.edge", decode_edge, value)


def visibility(value: str | Mapping[str, Any]) -> VisibilityState:
    """A ``herceg:visibility`` event's ``detail`` as a page posts it back, JSON
    text or parsed: what the chart's legends hide, as ``widget.visibility``
    holds it."""
    return _read("web.visibility", decode_visibility, value)


def _read(location: str, decode: Callable[[Any], _T], value: Any) -> _T:
    """An event's JSON as posted, checked as live charts check their states."""
    if isinstance(value, (str, bytes)):
        try:
            value = json.loads(value)
        except ValueError:
            raise ChartError(
                f"{location} value: expected JSON; received {shown(value)}; post the event's "
                "detail as JSON.stringify writes it",
                path="value",
            ) from None
    try:
        return decode(value)
    except ValueError as error:
        raise ChartError(
            f"{location} value: {error}; post the event's detail as herceg's script gives it",
            path="value",
        ) from None


def _nonce(nonce: str | None, location: str) -> str:
    """A nonce attribute, or nothing without one."""
    if nonce is None:
        return ""
    if not isinstance(nonce, str) or not _NONCE.fullmatch(nonce):
        raise ChartError(
            f"{location} nonce: expected the page's Content Security Policy nonce, "
            f"base64 text; received {shown(nonce)}",
            path="nonce",
        )
    return f' nonce="{nonce}"'
