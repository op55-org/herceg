"""Export settings, as the engine's spec/export.ts plans them: what file a
chart is written to, apart from the chart itself. Layout size (the CSS
pixels a chart is laid out in), raster resolution (image pixels per CSS
pixel, from dots per inch), and encoding are separate, so a figure 16 by 10
inches at 150 dpi lays out at 1536 by 960 CSS pixels whatever its dpi and is
drawn 2400 by 1500 pixels."""

from __future__ import annotations

import math
import numbers
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from ._data import shown
from ._errors import ChartError

ExportFormat = Literal["svg", "png", "jpeg", "webp"]
LengthUnit = Literal["px", "in", "cm", "mm", "pt"]

#: CSS pixels per unit.
UNITS: dict[str, float] = {"px": 1, "in": 96, "cm": 96 / 2.54, "mm": 96 / 25.4, "pt": 96 / 72}

#: The largest exports herceg draws (as the engine's ``EXPORT_LIMITS``): no
#: side longer than 16,384 pixels (WebP's format allows 16,383), no more
#: than 16.7 million pixels in all, and 1 to 1200 dots per inch.
SIDE = 16384
WEBP_SIDE = 16383
PIXELS = 16_777_216
DPI = (1, 1200)


@dataclass(frozen=True)
class ExportPlan:
    """What an export draws: the chart laid out at ``width`` by ``height``
    CSS pixels, written as ``pixels`` image pixels (for SVG, the layout
    size), at ``dpi``, with ``quality`` for JPEG and WebP."""

    format: ExportFormat
    width: float
    height: float
    pixels: tuple[float, float]
    dpi: float
    quality: float | None
    background: str | None
    tooltip: Literal["title"] | None


def _refuse(path: str, message: str, code: str = "invalid-option") -> ChartError:
    return ChartError(f"{path}: {message}", code=code, path=path)  # type: ignore[arg-type]


def _number(value: Any) -> bool:
    return isinstance(value, numbers.Real) and not isinstance(value, bool) and math.isfinite(value)


def _positive(value: Any, path: str) -> float:
    if not _number(value) or not value > 0:
        raise _refuse(path, f"expected a positive number; received {shown(value)}")
    return float(value)


def _css_pixels(length: float, unit: str) -> float:
    """``length`` in ``unit`` as CSS pixels, to a ten-thousandth (as the
    engine rounds it), so that 254 mm lays out at 960 pixels."""
    return math.floor(length * UNITS[unit] * 1e4 + 0.5) / 1e4


def _pixels_of(length: float, dpi: float, path: str) -> int:
    """A dimension of ``length`` CSS pixels in image pixels at ``dpi``: rounded half up, never 0."""
    pixels = math.floor(length * dpi / 96 + 0.5)
    if pixels < 1:
        raise _refuse(
            path, f"{length} CSS pixels at {dpi} dpi is less than a pixel; give a larger size"
        )
    return pixels


def plan_export(
    chart: tuple[float, float],
    *,
    format: str = "png",
    size: Sequence[float] | None = None,
    unit: str = "px",
    dpi: float | None = None,
    quality: float | None = None,
    background: str | None = None,
    tooltip: str | None = None,
) -> ExportPlan:
    """Checks export settings for a chart of ``chart`` CSS pixels (width,
    height) and says what the export draws, or raises ``hg.ChartError``
    naming the setting at fault."""
    if format not in ("svg", "png", "jpeg", "webp"):
        raise _refuse(
            "format", f'expected "svg", "png", "jpeg", or "webp"; received {shown(format)}'
        )
    if not isinstance(unit, str) or unit not in UNITS:
        raise _refuse("unit", f'expected "px", "in", "cm", "mm", or "pt"; received {shown(unit)}')
    if size is not None and (
        isinstance(size, str) or not isinstance(size, Sequence) or len(size) != 2
    ):
        raise _refuse("size", f"expected a width and a height; received {shown(size)}")
    if size is None and unit != "px":
        raise _refuse("unit", "says what size is measured in; give size, or drop unit")
    width = _css_pixels(_positive(size[0], "size[0]"), unit) if size is not None else chart[0]
    height = _css_pixels(_positive(size[1], "size[1]"), unit) if size is not None else chart[1]
    if not max(width, height) <= SIDE:
        raise _refuse(
            "size",
            f"{width} by {height} CSS pixels is larger than an export lays out ({SIDE} a side); "
            "give a smaller size",
        )
    raster = format != "svg"
    if dpi is not None:
        if not raster:
            raise _refuse(
                "dpi", "sets image pixels, which SVG has none of; drop dpi", "unsupported"
            )
        _positive(dpi, "dpi")
        if not DPI[0] <= dpi <= DPI[1]:
            raise _refuse("dpi", f"expected {DPI[0]} to {DPI[1]}; received {shown(dpi)}")
    if quality is not None:
        if format not in ("jpeg", "webp"):
            raise _refuse(
                "quality",
                f"compresses JPEG and WebP; {format.upper()} keeps every pixel, so drop quality",
                "unsupported",
            )
        if not _number(quality) or not 0 <= quality <= 100:
            raise _refuse("quality", f"expected a number from 0 to 100; received {shown(quality)}")
    if background is not None and (not isinstance(background, str) or not background):
        raise _refuse("background", f"expected a CSS color; received {shown(background)}")
    if tooltip is not None:
        if tooltip != "title":
            raise _refuse("tooltip", f'expected "title"; received {shown(tooltip)}')
        if raster:
            raise _refuse(
                "tooltip",
                f'"title" writes tooltips into SVG, which a {format.upper()} image cannot hold; '
                "export SVG, or drop tooltip",
                "unsupported",
            )
    resolution = float(dpi) if dpi is not None else 96.0
    pixels: tuple[float, float] = (
        (_pixels_of(width, resolution, "size"), _pixels_of(height, resolution, "size"))
        if raster
        else (width, height)
    )
    side = WEBP_SIDE if format == "webp" else SIDE
    if raster and (max(pixels) > side or pixels[0] * pixels[1] > PIXELS):
        raise _refuse(
            "dpi" if dpi is not None else "size",
            f"{pixels[0]} by {pixels[1]} pixels is more than {format.upper()} exports draw "
            f"({side} a side, {PIXELS} in all); lower the dpi or the size",
        )
    return ExportPlan(
        format=format,  # type: ignore[arg-type]
        width=width,
        height=height,
        pixels=pixels,
        dpi=resolution if raster else 96.0,
        quality=(quality if quality is not None else 90) if format in ("jpeg", "webp") else None,
        background=background,
        tooltip="title" if tooltip is not None else None,
    )
