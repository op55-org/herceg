"""What keeps a chart from drawing, as every herceg runtime reports it."""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from typing import Any, Literal, TypeVar

_T = TypeVar("_T")

#: What kind of problem it is (see ``ChartError``).
ChartErrorCode = Literal[
    "invalid-option",
    "unknown-field",
    "field-type",
    "series-varies",
    "series-with-values",
    "unknown-reference",
    "unsupported",
    "layout-failed",
    "load-failed",
    "render-failed",
]
#: When it happened: checking options, compiling them, loading code, laying
#: the chart out, or drawing a frame of its data.
ChartErrorPhase = Literal["validate", "compile", "load", "layout", "render"]


class ChartError(ValueError):
    """Options or data a chart refuses: herceg's errors, in one shape in Python,
    TypeScript, and the browser, raised where a mark is added, a chart is
    output, or the JavaScript engine draws it.

    ``code`` says what kind of problem it is: ``"invalid-option"``,
    ``"unknown-field"`` (a column the data does not have), ``"field-type"``
    (a column whose values an option cannot take), ``"series-varies"`` (a
    line's or area's color changing within one of its series),
    ``"series-with-values"`` (several value columns and a series column),
    ``"unknown-reference"`` (a panel or scale the chart does not have),
    ``"unsupported"`` (a well-formed option the chart cannot draw, with what
    to do instead), ``"layout-failed"``, ``"load-failed"`` (code or data the
    chart needs could not be loaded, such as a web page's payload), or
    ``"render-failed"``.
    ``path`` is where in the chart's options (``"marks[1].color"``, or for
    a mark's own options ``"color"``), ``mark`` the mark (its ``id``, or its
    index among the chart's marks), ``panel`` the panel, and ``phase`` when
    it happened: ``"validate"``, ``"compile"``, ``"load"``, ``"layout"``,
    or ``"render"``. The message is shaped "location: problem; correction".
    """

    code: ChartErrorCode
    path: str | None
    mark: str | int | None
    panel: str | None
    phase: ChartErrorPhase

    def __init__(
        self,
        message: str,
        *,
        code: ChartErrorCode = "invalid-option",
        path: str | None = None,
        mark: str | int | None = None,
        panel: str | None = None,
        phase: ChartErrorPhase = "validate",
    ) -> None:
        super().__init__(message)
        self.code = code
        self.path = path
        self.mark = mark
        self.panel = panel
        self.phase = phase

    @property
    def message(self) -> str:
        return str(self)

    def info(self) -> dict[str, Any]:
        """The error as the spec's ``ChartErrorInfo``: JSON-safe, as other runtimes take it."""
        info: dict[str, Any] = {"code": self.code, "message": self.message, "phase": self.phase}
        for name in ("path", "mark", "panel"):
            value = getattr(self, name)
            if value is not None:
                info[name] = value
        return info

    @classmethod
    def from_info(cls, info: Mapping[str, Any], message: str | None = None) -> ChartError:
        """An error the JavaScript engine reported (``ChartErrorInfo``), its
        path in Python's spelling: option names in snake_case."""
        path = info.get("path")
        return cls(
            info["message"] if message is None else message,
            code=info.get("code", "invalid-option"),
            path=python_path(path) if isinstance(path, str) else None,
            mark=info.get("mark"),
            panel=info.get("panel"),
            phase=info.get("phase", "validate"),
        )


# Segments after these name what the chart's author named (scales, tables,
# columns), which keep their spelling.
_NAMED = {"scales", "data", "columns", "map", "panels"}


# A path's parts: names, dots, and indices or quoted keys in brackets.
_PART = re.compile(r'\[(?:\d+|"(?:[^"\\]|\\.)*")\]|\.|[^.\[]+')


#: Keys written after a dot in paths; others go in brackets, quoted (``scales["p.99"]``).
_NAME = re.compile(r"^[A-Za-z_$][\w$]*$", re.ASCII)


def located(path: str, make: Callable[[], _T]) -> _T:
    """``make()``, refusing what it raises as a ChartError at ``path``
    (``guides[0]``), unless the error names a place of its own."""
    try:
        return make()
    except ChartError as error:
        if error.path is not None:
            raise
        raise ChartError(str(error), code=error.code, path=path) from None
    except (ValueError, TypeError) as error:
        raise ChartError(str(error), path=path) from None


def key_path(at: str, key: str) -> str:
    """The path of ``key`` under ``at``: after a dot, or for a key that is no
    name, quoted in brackets, so the path keeps it whole (``scales["p.99"]``)."""
    return f"{at}.{key}" if _NAME.match(key) else f"{at}[{json.dumps(key)}]"


def python_path(path: str) -> str:
    """A spec path (``marks[1].strokeWidth``) in Python's spelling
    (``marks[1].stroke_width``): option names in snake_case, never the
    names of columns, scales, tables, or ids, nor keys in brackets
    (``map["usEast"]``)."""
    out = []
    named = False
    for part in _PART.findall(path):
        if part == ".":
            out.append(part)
        elif part.startswith("["):
            out.append(part)
            named = False
        else:
            out.append(part if named else _snake(part))
            named = part in _NAMED
    return "".join(out)


def _snake(name: str) -> str:
    return re.sub(r"(?<=[a-z0-9])([A-Z])", lambda m: f"_{m.group(1).lower()}", name)
