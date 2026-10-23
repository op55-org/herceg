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


def refuse_mark(spec: Mapping[str, Any], role: str, at: str) -> None:
    """Refuses what a mark's ``spec`` asks before round 2 draws it; ``role``
    names the mark as its method does, ``at`` is its place (``marks[2]``)."""

    def option(name: str, stream: Stream, instead: str) -> None:
        path = python_path(f"{at}.{name}")
        refuse(f"{role} {path[len(at) + 1 :]}", stream, instead, path)

    kind = spec["type"]
    if kind in ("line", "area") and spec.get("labels") is not None:
        option("labels", "C", "drop labels")
    if kind == "bar":
        labels = spec.get("labels")
        if _object(labels) and labels.get("content") is not None:
            option("labels.content", "C", "give a field or the value")
    if kind in ("rule", "region", "text"):
        label = spec.get("label")
        if _object(label) and label.get("content") is not None:
            option("label.content", "C", "give text or a field")
        if spec.get("legend") is True:
            option("legend", "C", "drop legend")
    if kind == "text" and spec.get("from") is not None:
        option("from", "C", "give at, or x and y")


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


def refuse_chart(spec: Mapping[str, Any]) -> None:
    """Refuses what a chart's ``spec`` asks of its scales, axes, guides,
    and text before round 2 draws it."""

    def option(path: str, stream: Stream, instead: str) -> None:
        refuse(python_path(path), stream, instead, python_path(path))

    scales = spec.get("scales") or {}
    at_scale = {name: key_path("scales", name) for name in scales}

    for name, scale in scales.items():
        at = at_scale[name]
        kind = scale.get("type")
        if kind == "identity":
            option(at, "C", "name an hg.OrdinalScale")
        elif kind == "ordinal" and scale.get("scope") is not None:
            option(f"{at}.scope", "C", "drop scope")
    for i, guide in enumerate(spec.get("guides") or ()):
        at = f"guides[{i}]"
        kind = guide.get("type")
        if kind == "legend":
            # A legend shown nowhere is not drawn, so asks nothing yet.
            if guide.get("show") is not False:
                _legend(guide, at)
            continue
        if kind == "colorbar" and _object(guide.get("scale")) and "scale" in guide["scale"]:
            option(f"{at}.scale", "C", "name a mark's color scale")
    if _object(spec.get("legend")):
        _legend(spec["legend"], "legend")
