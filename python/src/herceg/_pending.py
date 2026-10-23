"""Options the spec takes before herceg draws them, refused as the engine
refuses them (marks/pending.ts and the compilers). Round 2 freezes its
contracts first (the spec's types, the engine's validator, the TypeScript
factories, and these builders), and its streams then add the behavior: R
rendering, placement, and painting; C channels, labels, and legends; S
output. Until a stream lands, a chart refuses its options here, by name,
rather than ignoring them, and the stream deletes its refusals as it adds
each. Marks' options are refused as a mark is added, the chart's as its
spec is made, all through ``refuse`` (which tests of the specs these
options make set aside)."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal, TypeGuard

from ._errors import ChartError, key_path, python_path

Stream = Literal["R", "C", "S"]


def refuse(location: str, stream: Stream, instead: str, path: str | None) -> None:
    """Refuses the option at ``location`` until ``stream`` draws it."""
    raise ChartError(
        f"{location}: not drawn as given yet (round 2 stream {stream} adds it); {instead}",
        code="unsupported",
        path=path,
    )


def _object(value: Any) -> TypeGuard[Mapping[str, Any]]:
    return isinstance(value, Mapping)


def _from_field(place: Any) -> str | None:
    """Which of a coordinate's share and pixels a column gives, if either."""
    if _object(place):
        for key in ("fraction", "px"):
            if _object(place.get(key)):
                return key
    return None


def refuse_mark(spec: Mapping[str, Any], role: str, at: str) -> None:
    """Refuses what a mark's ``spec`` asks before round 2 draws it; ``role``
    names the mark as its method does, ``at`` is its place (``marks[2]``)."""

    def option(name: str, stream: Stream, instead: str) -> None:
        path = python_path(f"{at}.{name}")
        refuse(f"{role} {path[len(at) + 1 :]}", stream, instead, path)

    kind = spec["type"]
    z = spec.get("zIndex")
    if z is not None and z != 0:
        option("zIndex", "R", "drop z_index")
    if kind in ("line", "area") and spec.get("labels") is not None:
        option("labels", "C", "drop labels")
    if kind == "bar":
        for key in ("width", "strokeSides"):
            if spec.get(key) is not None:
                option(key, "R", f"drop {python_path(key)}")
        labels = spec.get("labels")
        if _object(labels) and labels.get("content") is not None:
            option("labels.content", "C", "give a field or the value")
    if kind in ("rule", "region", "text"):
        label = spec.get("label")
        if _object(label) and label.get("content") is not None:
            option("label.content", "C", "give text or a field")
        if spec.get("legend") is True:
            option("legend", "C", "drop legend")
        places = {name: spec.get(name) for name in ("x", "y", "x1", "x2", "y1", "y2")}
        for i, place in enumerate(spec.get("span") or ()):
            places[f"span[{i}]"] = place
        for axis, place in (spec.get("at") or {}).items():
            places[f"at.{axis}"] = place
        for name, place in places.items():
            share = _from_field(place)
            if share:
                option(f"{name}.{share}", "R", "give a number")
    if kind == "region":
        for key in ("stroke", "strokeWidth", "strokeSides"):
            if spec.get(key) is not None:
                option(key, "R", f"drop {python_path(key)}")
    if kind == "text" and spec.get("from") is not None:
        option("from", "C", "give at, or x and y")


def _labels(guide: Mapping[str, Any], at: str) -> list[tuple[str, Any]]:
    """A guide's tick labels and its layers', by their places."""
    found = [(f"{at}.labels", guide.get("labels"))]
    for k, layer in enumerate(guide.get("layers") or ()):
        found.append((f"{at}.layers[{k}].labels", layer.get("labels")))
    return found


def _legend(options: Mapping[str, Any], at: str) -> None:
    include = options.get("include")
    entries = options.get("entries")
    if entries is not None and include != []:
        path = f"{at}.entries"
        refuse(python_path(path), "C", "give include=[] for your entries alone", python_path(path))
    for k, entry in enumerate(entries or ()):
        for t, target in enumerate(entry.get("targets") or ()):
            if set(target) != {"mark"}:
                path = python_path(f"{at}.entries[{k}].targets[{t}]")
                refuse(path, "C", "target a mark whole", path)
    for k, ref in enumerate(include or ()):
        if "channel" not in ref:
            path = python_path(f"{at}.include[{k}]")
            refuse(path, "C", "name a mark's scale, as hg.ScaleRef(mark=..., channel=...)", path)


def _vertical_align(value: Any, at: str, keys: tuple[str, ...] = ()) -> None:
    """Refuses ``verticalAlign`` in the text styles under ``value``: a
    ``style`` (a label's, a title's) or a role of one (an axis' or a
    theme's ``style.tick_label``). Keys of the user's own (a scale's name,
    a ``map``'s categories) are not looked under: scales hold no text."""
    if isinstance(value, Mapping):
        if "verticalAlign" in value and "style" in keys[-2:]:
            path = python_path(f"{at}.verticalAlign")
            refuse(path, "R", "drop vertical_align", path)
        for key, item in value.items():
            if key != "map":
                _vertical_align(item, f"{at}.{key}", (*keys, key))
    elif isinstance(value, list):
        for k, item in enumerate(value):
            _vertical_align(item, f"{at}[{k}]", keys)


def refuse_chart(spec: Mapping[str, Any]) -> None:
    """Refuses what a chart's ``spec`` asks of its scales, axes, guides,
    and text before round 2 draws it."""

    def option(path: str, stream: Stream, instead: str) -> None:
        refuse(python_path(path), stream, instead, python_path(path))

    # 3D boxes refuse their own axes' settings for good (_chart.py,
    # _refuse_depth): a chart's when its marks are 3D, a panel's when its marks are.
    boxes = [
        mark.get("panel")
        for mark in spec.get("marks") or ()
        if mark.get("type") in ("point3d", "line3d", "surface")
    ]
    panels = spec.get("panels")
    scales = spec.get("scales") or {}
    at_scale = {name: key_path("scales", name) for name in scales}

    # Scales' settings first, as the short forms hold them too, then their
    # kinds; a chart without panels whose marks are 3D has its box's x and y.
    def box(name: str) -> bool:
        return not panels and bool(boxes) and name in ("x", "y")

    axes: list[tuple[str, Any]] = []
    axes += [(at_scale[name], scale) for name, scale in scales.items() if not box(name)]
    axes += [(name, spec.get(name)) for name in ("x", "y", "yRight") if not box(name)]
    for i, panel in enumerate(panels or ()):
        if panel.get("id") not in boxes:
            axes += [(f"panels[{i}].{name}", panel.get(name)) for name in ("x", "y", "yRight")]
    for at, axis in axes:
        if not _object(axis):
            continue
        padding = axis.get("padding")
        if padding is not None and padding != "auto":
            option(f"{at}.padding", "R", 'drop padding, or give "auto"')
        grid = axis.get("grid")
        if _object(grid) and grid.get("zIndex", -1) != -1:
            option(f"{at}.grid.zIndex", "R", "drop z_index")
    for name, scale in scales.items():
        at = at_scale[name]
        kind = scale.get("type")
        if kind == "identity":
            option(at, "C", "name an hg.OrdinalScale")
        elif kind == "ordinal" and scale.get("scope") is not None:
            option(f"{at}.scope", "C", "drop scope")
        elif kind != "ordinal" and name not in ("x", "y", "yRight"):
            option(at, "R", "place values on x, y, and y_right")
    for i, guide in enumerate(spec.get("guides") or ()):
        at = f"guides[{i}]"
        kind = guide.get("type")
        if kind == "legend":
            # A legend shown nowhere is not drawn, so asks nothing yet.
            if guide.get("show") is not False:
                _legend(guide, at)
            continue
        if kind == "axis":
            if guide.get("scale") not in ("x", "y", "yRight"):
                option(f"{at}.scale", "R", "name x, y, or y_right")
            grid = guide.get("grid")
            if _object(grid) and grid.get("zIndex", -1) != -1:
                option(f"{at}.grid.zIndex", "R", "drop z_index")
        if kind == "colorbar" and _object(guide.get("scale")) and "scale" in guide["scale"]:
            option(f"{at}.scale", "C", "name a mark's color scale")
        for path, labels in _labels(guide, at):
            if _object(labels):
                if labels.get("inside") is True:
                    option(f"{path}.inside", "R", "drop inside")
                if labels.get("gap") is not None:
                    option(f"{path}.gap", "R", "drop gap")
    if _object(spec.get("legend")):
        _legend(spec["legend"], "legend")
    for key, value in spec.items():
        if key not in ("data", "scales"):
            _vertical_align(value, key, (key,))
