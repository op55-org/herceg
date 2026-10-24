"""Export one chart, or a sequence of charts as a PDF document."""

from __future__ import annotations

import sys
from collections.abc import Sequence
from os import PathLike
from pathlib import Path

from . import _render
from ._chart import Chart

if sys.version_info >= (3, 11):
    from typing import Unpack
else:
    from typing_extensions import Unpack


def to_pdf(
    chart_or_charts: Chart | Sequence[Chart],
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
    items = [chart_or_charts] if isinstance(chart_or_charts, Chart) else chart_or_charts
    if not isinstance(items, Sequence):
        raise TypeError(
            "to_pdf charts: expected a Chart or sequence of Charts; supply herceg charts"
        )
    if not items:
        raise ValueError("to_pdf charts: expected at least one chart; supply a nonempty sequence")
    for i, chart in enumerate(items):
        if not isinstance(chart, Chart):
            raise TypeError(f"to_pdf charts[{i}]: expected a Chart; supply herceg charts")
    pages = [chart.to_spec() for chart in items]
    return _render.pdf(
        [spec for spec, _ in pages],
        [buffers for _, buffers in pages],
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


def save(
    chart_or_charts: Chart | Sequence[Chart],
    path: str | PathLike[str],
    **options: Unpack[_render.SaveOptions],
) -> None:
    """Save a chart by extension, as ``Chart.save`` does with the same options,
    or a nonempty sequence to a .pdf path with to_pdf's options."""
    if isinstance(chart_or_charts, Chart):
        chart_or_charts.save(path, **options)
        return
    if Path(path).suffix.lower() != ".pdf" or options.get("format") not in (None, "pdf"):
        raise ValueError(
            "save path: a sequence of charts requires PDF export; "
            "use a .pdf extension or save each chart separately"
        )
    # Options left at None are not given, whichever format they belong to.
    given = {
        name: value for name, value in options.items() if name != "format" and value is not None
    }
    _render.check_save_options("pdf", [name for name, value in given.items() if value != ()])
    try:
        content = to_pdf(chart_or_charts, **given)  # type: ignore[arg-type]
    except (ValueError, TypeError) as error:
        raise type(error)(str(error).replace("to_pdf", "save")) from None
    Path(path).write_bytes(content)
