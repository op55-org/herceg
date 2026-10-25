"""Export one chart, or a sequence of charts as a PDF document."""

from __future__ import annotations

import sys
from collections.abc import Sequence
from os import PathLike
from pathlib import Path
from typing import Any

from . import _render
from ._chart import Chart, in_python
from ._data import listlike
from ._errors import ChartError, checks_hints, refusing, renamed, shown, unknown_option

if sys.version_info >= (3, 11):
    from typing import Unpack
else:
    from typing_extensions import Unpack


@checks_hints("to_pdf")
def to_pdf(
    charts: Chart | Sequence[Chart],
    *,
    page_size: _render.PdfPageSize | None = None,
    orientation: _render.PdfOrientation | None = None,
    margin: float | None = None,
    title: str | None = None,
    subject: str | None = None,
    language: str | None = None,
    fonts: _render.Fonts | None = None,
    fallback: Sequence[str] = (),
    missing_glyph: str | None = None,
) -> bytes:
    """Return vector PDF bytes, with one chart per page (requires the export extra).

    Chart-sized pages default to zero margin; A4 and Letter default to 36
    points (72 per inch). Fonts are subset once across all pages. Use
    subplots for several views on one page. Metadata leaves chart titles intact.
    """
    with refusing(("to_pdf",), _TO_PDF):
        return _pdf(
            charts,
            page_size=page_size,
            orientation=orientation,
            margin=margin,
            title=title,
            subject=subject,
            language=language,
            fonts=fonts,
            fallback=fallback,
            missing_glyph=missing_glyph,
        )


def _pdf(charts: Chart | Sequence[Chart], **settings: Any) -> bytes:
    # A chart alone refuses as its own export does; charts in a sequence at their index.
    alone = isinstance(charts, Chart)
    items = _charts(charts, "to_pdf")
    pages = []
    for i, chart in enumerate(items):
        try:
            pages.append(chart.to_spec())
        except ChartError as error:
            raise _of_chart(error, i, alone) from None
    try:
        return _render.pdf(
            [spec for spec, _ in pages], [buffers for _, buffers in pages], **settings
        )
    except ChartError as error:
        raise _of_page(error, items, pages, settings, alone) from None


def _of_page(
    error: ChartError,
    charts: Sequence[Chart],
    pages: list[tuple[dict[str, Any], list[bytes]]],
    settings: dict[str, Any],
    alone: bool,
) -> ChartError:
    """The engine's refusal of a chart's page (its spec, or its layout) in
    Python's names, as the chart's own export says it, at the chart's
    index; the document's settings' refusals (``to_pdf margin: ...``) as
    they are. The engine does not say which chart of several it refused: it
    is the first whose page alone it refuses the same."""
    # The document's settings' and fonts' refusals say so (see `_render.pdf`).
    if str(error).startswith("to_pdf "):
        return error
    if len(charts) == 1:
        return _of_chart(in_python(error, charts[0]), 0, alone)
    for i, (chart, (spec, buffers)) in enumerate(zip(charts, pages, strict=True)):
        try:
            _render.pdf(spec, buffers, **settings)
        except ChartError as refused:
            if str(refused) == str(error):
                return _of_chart(in_python(refused, chart), i, alone)
    return error


def _of_chart(error: ChartError, index: int, alone: bool) -> ChartError:
    """A refusal of the chart at ``index`` of those given to ``to_pdf``,
    saying which (``to_pdf charts[1] description: ...``), unless it was
    given alone."""
    if alone:
        return error
    info = {**error.info(), "path": f"charts[{index}]" + (f".{error.path}" if error.path else "")}
    where, found, problem = str(error).partition(": ")
    if not found:
        # Said of the chart as a whole ("PDF export cannot read the color ...").
        return ChartError.from_info(info, f"to_pdf charts[{index}]: {error}")
    # The engine's layout refusals name the chart in lowercase ("chart x.padding.px").
    where = where.removeprefix("Chart ").removeprefix("chart ")
    return ChartError.from_info(info, f"to_pdf charts[{index}] {where}: {problem}")


#: What ``to_pdf`` takes besides the charts.
_TO_PDF = frozenset(
    ("charts", "page_size", "orientation", "margin", "title", "subject", "language", "fonts")
    + ("fallback", "missing_glyph")
)


@checks_hints("save")
def save(
    charts: Chart | Sequence[Chart],
    path: str | PathLike[str],
    **options: Unpack[_render.SaveOptions],
) -> None:
    """Save a chart by extension, as ``Chart.save`` does with the same options,
    or a nonempty sequence to a .pdf path with to_pdf's options."""
    for name in options:
        if name not in _render.SaveOptions.__optional_keys__:
            raise unknown_option("save", name, _render.SaveOptions.__optional_keys__)
    with refusing(("save",), {"path", *_render.SaveOptions.__optional_keys__}):
        _save(charts, path, options)


def _charts(charts: Any, owner: str) -> list[Chart]:
    """The charts of a document: one chart, or a nonempty list of them."""
    if isinstance(charts, Chart):
        return [charts]
    if not isinstance(charts, Sequence) or isinstance(charts, str):
        raise ChartError(
            f"{owner} charts: expected an hg.Chart or a list of them; received {shown(charts)}",
            path="charts",
        )
    if not charts:
        raise ChartError(
            f"{owner} charts: expected at least one chart; supply a nonempty list", path="charts"
        )
    for i, chart in enumerate(charts):
        if not isinstance(chart, Chart):
            raise ChartError(
                f"{owner} charts[{i}]: expected an hg.Chart; received {shown(chart)}",
                path=f"charts[{i}]",
            )
    return list(charts)


def _save(charts: Chart | Sequence[Chart], path: Any, options: Any) -> None:
    if isinstance(charts, Chart):
        charts.save(path, **options)
        return
    _charts(charts, "save")
    if _render.file_path(path).suffix.lower() != ".pdf" or options.get("format") not in (
        None,
        "pdf",
    ):
        raise ChartError(
            "save path: a sequence of charts requires PDF export; "
            "use a .pdf extension or save each chart separately"
        )
    # Options left at None are not given, whichever format they belong to.
    given = {
        name: value for name, value in options.items() if name != "format" and value is not None
    }
    _render.check_save_options(
        "pdf",
        [name for name, value in given.items() if not (listlike(value) and len(value) == 0)],
    )
    try:
        content = to_pdf(charts, **given)
    except ChartError as error:
        # The settings are save's: the location says so (charts' own refusals keep theirs).
        raise renamed(error, "to_pdf", "save") from None
    Path(path).write_bytes(content)
