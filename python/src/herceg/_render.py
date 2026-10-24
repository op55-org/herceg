"""Output: HTML with herceg embedded, notebook display, and static SVG, PNG, and PDF."""

from __future__ import annotations

import atexit
import base64
import difflib
import html as _html
import io
import json
import math
import numbers
import re
import tempfile
import uuid
import webbrowser
from collections.abc import Mapping, Sequence
from functools import cache
from importlib.resources import files
from os import PathLike
from pathlib import Path
from typing import TYPE_CHECKING, Any, Literal, TypedDict, cast

from ._data import shown
from ._errors import ChartError
from ._export import ExportPlan, plan_export

if TYPE_CHECKING:
    from ._chart import Chart

FontData = bytes | str | PathLike[str]
FontWeight = Literal["normal", "bold"]
Fonts = Mapping[str, FontData | Mapping[FontWeight, FontData]]
#: How a standalone SVG sizes: at the chart's size, or as CSS or its container says.
SvgSizing = Literal["fixed", "fluid"]
#: How SVG strokes scale with the SVG: with it, or keeping their width in pixels.
StrokeScaling = Literal["scale", "fixed"]
#: What ``to_image`` writes.
ImageFormat = Literal["png", "jpeg", "webp"]
#: What an export's ``size`` is measured in: CSS pixels (96 per inch), inches,
#: centimeters, millimeters, or points (72 per inch).
LengthUnit = Literal["px", "in", "cm", "mm", "pt"]
#: What ``save`` writes.
SaveFormat = Literal["html", "svg", "png", "jpeg", "webp", "pdf"]
PdfPageSize = Literal["A4", "Letter"]
PdfOrientation = Literal["portrait", "landscape"]
_FONT_LIMIT = 32 * 1024 * 1024


def asset_path(name: str) -> Path:
    """A JavaScript bundle shipped in the package (built by `npm run build:python`)."""
    path = Path(str(files("herceg") / "static" / name))
    if not path.is_file():
        raise RuntimeError(
            f"herceg's JavaScript bundle ({name}) is missing. In a source checkout, "
            "run `npm run build:python` from the repository root."
        )
    return path


def asset(name: str) -> str:
    return asset_path(name).read_text(encoding="utf-8")


def _encoded(buffers: list[bytes]) -> list[str]:
    return [base64.b64encode(buffer).decode("ascii") for buffer in buffers]


_SCRIPT_ESCAPES = {
    ord("<"): "\\u003c",
    ord(">"): "\\u003e",
    ord("&"): "\\u0026",
    0x2028: "\\u2028",
    0x2029: "\\u2029",
}


def _script_json(value: Any) -> str:
    """JSON safe inside a <script> element: no character can end or alter it."""
    return json.dumps(value, separators=(",", ":")).translate(_SCRIPT_ESCAPES)


def html(spec: dict[str, Any], buffers: list[bytes], *, full_page: bool = True) -> str:
    """HTML that renders the chart: the herceg bundle, the spec, and base64 buffers."""
    element = f"herceg-{uuid.uuid4().hex[:12]}"
    width = f"{spec['width']}px" if "width" in spec else "100%"
    height = f"{spec.get('height', 320)}px"
    # Fragments on one page share the first runtime, so charts with the same
    # `sync` name share cursor and zoom.
    body = (
        f'<div id="{element}" style="width:{width};height:{height}"></div>\n'
        f"<script>if (!window.hercegPython) {{\n{asset('herceg.js')}\n}}</script>\n"
        f"<script>hercegPython.render(document.getElementById({_script_json(element)}), "
        f"{_script_json(spec)}, {_script_json(_encoded(buffers))});</script>"
    )
    if not full_page:
        return body
    given = spec.get("title", "Chart")
    title = _html.escape(given["text"] if isinstance(given, dict) else given)
    return (
        '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n'
        f"<title>{title}</title>\n"
        "<style>body{margin:0;padding:8px;font-family:system-ui,sans-serif}</style>\n"
        f"</head>\n<body>\n{body}\n</body>\n</html>\n"
    )


def notebook_html(spec: dict[str, Any], buffers: list[bytes], *, height: int | None) -> str:
    """The chart in an isolated iframe, as notebooks display it."""
    page = html(spec, buffers)
    frame_height = (height or 320) + 20
    return (
        f'<iframe srcdoc="{_html.escape(page, quote=True)}" '
        f'style="width:100%;height:{frame_height}px;border:0" '
        'sandbox="allow-scripts"></iframe>'
    )


@cache
def _engine() -> Any:
    try:
        from py_mini_racer import MiniRacer
    except ImportError as error:
        raise ImportError(
            "Static SVG, PNG, and PDF export need the `export` extra: pip install 'herceg[export]'"
        ) from error
    engine = MiniRacer()
    # V8's thread must be stopped before interpreter shutdown, which
    # otherwise waits for it forever.
    atexit.register(engine.close)
    engine.eval(asset("herceg-static.js"))
    return engine


def _call(function: str, *args: Any) -> str:
    """Calls an export of the embedded renderer, which returns its output, or
    ``{"error": message, "info": ...}`` for what it refuses (a spec it does
    not accept, a font it cannot embed): raised here as a ChartError with
    herceg's message, code, and path. The engine's own failures (out of
    memory, a timeout) propagate as they are."""
    result = _engine().call(function, *args)
    if isinstance(result, str):
        return result
    raise ChartError.from_info(result["info"])


def _reworded(error: ChartError, message: str) -> ChartError:
    """`error` with a message in Python's words."""
    return ChartError.from_info(error.info(), message)


_ASPECT = re.compile(r"none|x(Min|Mid|Max)Y(Min|Mid|Max)( (meet|slice))?")


def _chart_size(spec: dict[str, Any]) -> tuple[float, float]:
    """The size a spec lays out at: its own, or 640 by 320 CSS pixels (as the engine's)."""
    return (spec.get("width", 640), spec.get("height", 320))


def _plan(location: str, spec: dict[str, Any], **settings: Any) -> ExportPlan:
    """``plan_export`` for the spec's chart, its refusals located at ``location``
    ("to_image dpi: expected 1 to 1200; ...")."""
    try:
        return plan_export(_chart_size(spec), **settings)
    except ChartError as error:
        raise _reworded(error, f"{location} {error}") from None


def svg(
    spec: dict[str, Any],
    buffers: list[bytes],
    *,
    fonts: Fonts | None = None,
    size: tuple[float, float] | None = None,
    unit: LengthUnit = "px",
    tooltip: Literal["title"] | None = None,
    sizing: SvgSizing | None = None,
    preserve_aspect_ratio: str | None = None,
    stroke_scaling: StrokeScaling | None = None,
    location: str = "to_svg",
) -> str:
    """Standalone SVG, rendered by herceg's DOM-free renderer in an embedded V8."""
    _plan(location, spec, format="svg", size=size, unit=unit, tooltip=tooltip)
    if sizing not in (None, "fixed", "fluid"):
        raise ValueError(
            f'{location} sizing: expected "fixed" or "fluid"; received {shown(sizing)}'
        )
    if preserve_aspect_ratio is not None and not (
        isinstance(preserve_aspect_ratio, str) and _ASPECT.fullmatch(preserve_aspect_ratio)
    ):
        raise ValueError(
            f'{location} preserve_aspect_ratio: expected "none" or an alignment such as '
            f'"xMidYMid meet"; received {shown(preserve_aspect_ratio)}'
        )
    if stroke_scaling not in (None, "scale", "fixed"):
        raise ValueError(
            f'{location} stroke_scaling: expected "scale" or "fixed"; '
            f"received {shown(stroke_scaling)}"
        )
    options = {
        "size": _plain(size),
        "unit": unit if unit != "px" else None,
        "tooltip": tooltip,
        "sizing": sizing,
        "preserveAspectRatio": preserve_aspect_ratio,
        "strokeScaling": stroke_scaling,
    }
    return _svg(
        spec,
        buffers,
        _font_faces(fonts, location),
        location=location,
        settings={key: value for key, value in options.items() if value is not None},
    )


def snapshot(
    spec: dict[str, Any],
    buffers: list[bytes],
    *,
    width: int | None,
    height: int | None,
    id_prefix: str,
    fonts: Fonts | None,
    locale: str | None,
    time_zone: str | None,
) -> dict[str, Any]:
    """A chart rendered for a page to show and a browser to hydrate (see
    ``Chart.to_snapshot``), by herceg's DOM-free renderer in an embedded V8."""
    if not isinstance(id_prefix, str) or not re.fullmatch(r"[A-Za-z][\w-]*", id_prefix):
        raise ValueError(
            "to_snapshot id_prefix: expected a name that starts ids, unique in the page "
            f'("latency"); received {shown(id_prefix)}'
        )
    for name, value in (("width", width), ("height", height)):
        if value is not None and not (
            isinstance(value, (int, float)) and not isinstance(value, bool) and value > 0
        ):
            raise ValueError(
                f"to_snapshot {name}: expected a size in CSS pixels; received {shown(value)}"
            )
    if time_zone == "local":
        raise ValueError(
            'to_snapshot time_zone: "local" is this machine\'s zone, which browsers may '
            'not share; give an IANA zone or "UTC"'
        )
    options = {
        "width": width,
        "height": height,
        "idPrefix": id_prefix,
        "locale": locale,
        "timeZone": time_zone,
        "fonts": _font_faces(fonts, "to_snapshot") or None,
    }
    try:
        result = _call(
            "hercegStatic.snapshot",
            json.dumps(spec),
            _encoded(buffers),
            json.dumps({key: value for key, value in options.items() if value is not None}),
        )
    except ChartError as error:
        message = str(error)
        raise _reworded(
            error,
            message.replace("renderToSnapshot ", "to_snapshot ").replace("timeZone", "time_zone"),
        ) from None
    snapshot: dict[str, Any] = json.loads(result)
    return snapshot


def _svg(
    spec: dict[str, Any],
    buffers: list[bytes],
    faces: list[dict[str, str]],
    *,
    location: str,
    settings: dict[str, Any] | None = None,
) -> str:
    try:
        return _call(
            "hercegStatic.svg",
            json.dumps(spec),
            _encoded(buffers),
            json.dumps(faces),
            False,
            json.dumps(settings or {}),
        )
    except ChartError as error:
        raise _reworded(error, _located(str(error), location)) from None


def _located(message: str, location: str) -> str:
    """An engine's message of an export, located at ``location`` in Python's names."""
    if message.startswith("fonts:"):
        return f"{location} {message}"
    return message.replace("specToSVG ", f"{location} ")


def _font_faces(fonts: Fonts | None, location: str) -> list[dict[str, str]]:
    """Validate and read the same font mapping for every static export."""
    sources = []
    for family, source in (fonts or {}).items():
        weights = source if isinstance(source, Mapping) else {"normal": source}
        for weight, data in weights.items():
            if weight not in ("normal", "bold"):
                raise ValueError(
                    f'{location} fonts: expected weights "normal" or "bold"; '
                    f"received {shown(weight)}"
                )
            sources.append((family, weight, data))
            if len(sources) > 64:
                raise ValueError(
                    f"{location} fonts: export supports at most 64 font faces; give fewer"
                )
    for family, weight, data in sources:
        if isinstance(data, bytes) and len(data) > _FONT_LIMIT:
            raise ValueError(
                f"{location} fonts: the {shown(family)} {weight} face exceeds the 32 MiB limit"
            )
    faces = []
    for family, weight, data in sources:
        if isinstance(data, bytes):
            raw = data
        else:
            with Path(data).open("rb") as font_file:
                raw = font_file.read(_FONT_LIMIT + 1)
            if len(raw) > _FONT_LIMIT:
                raise ValueError(
                    f"{location} fonts: the {shown(family)} {weight} face exceeds the 32 MiB limit"
                )
        faces.append(
            {"family": family, "weight": weight, "data": base64.b64encode(raw).decode("ascii")}
        )
    return faces


def pdf(
    spec: dict[str, Any] | list[dict[str, Any]],
    buffers: list[bytes] | list[list[bytes]],
    *,
    fonts: Fonts | None = None,
    fallback: Sequence[str] = (),
    missing_glyph: str | None = None,
    page_size: PdfPageSize | None = None,
    orientation: PdfOrientation | None = None,
    margin: float | None = None,
    title: str | None = None,
    subject: str | None = None,
    language: str | None = None,
) -> bytes:
    """Vector PDF, with one chart per page, rendered in embedded V8."""
    if page_size is not None and page_size not in ("A4", "Letter"):
        raise ValueError(
            'to_pdf page_size: expected "A4" or "Letter"; omit it for chart-sized pages'
        )
    if orientation is not None and (
        page_size is None or orientation not in ("portrait", "landscape")
    ):
        raise ValueError(
            'to_pdf orientation: expected "portrait" or "landscape" with page_size; '
            "supply a named paper size"
        )
    if margin is not None and (
        isinstance(margin, bool)
        or not isinstance(margin, (int, float))
        or not math.isfinite(margin)
        or margin < 0
    ):
        raise ValueError(
            "to_pdf margin: expected finite nonnegative points; supply zero or a positive margin"
        )
    faces = _font_faces(fonts, "to_pdf")
    if not faces and (fallback or missing_glyph is not None):
        raise ValueError(
            "to_pdf fallback and missing_glyph: choose among embedded fonts; "
            "supply fonts, or leave them out"
        )
    options: dict[str, Any] = {"fonts": faces, "fallback": list(fallback)}
    if missing_glyph is not None:
        options["missingGlyph"] = missing_glyph
    options.update(
        {
            key: value
            for key, value in {
                "pageSize": page_size,
                "orientation": orientation,
                "margin": margin,
                "title": title,
                "subject": subject,
                "language": language,
            }.items()
            if value is not None
        }
    )
    encoded_buffers = (
        [_encoded(page) for page in cast(list[list[bytes]], buffers)]
        if isinstance(spec, list)
        else _encoded(cast(list[bytes], buffers))
    )
    try:
        encoded = _call("hercegStatic.pdf", json.dumps(spec), encoded_buffers, json.dumps(options))
    except ChartError as error:
        message = str(error)
        # Text the fonts do not cover is refused as SVG and PNG export refuse it.
        if message.startswith("fonts do not cover"):
            message = "to_pdf fonts: " + message.removeprefix("fonts ")
        raise _reworded(
            error,
            message.replace("renderToPDF", "to_pdf")
            .replace("specToPDF", "to_pdf")
            .replace("pageSize", "page_size")
            .replace("missingGlyph", "missing_glyph"),
        ) from None
    return base64.b64decode(encoded)


def image(
    spec: dict[str, Any],
    buffers: list[bytes],
    *,
    format: ImageFormat = "png",
    size: tuple[float, float] | None = None,
    unit: LengthUnit = "px",
    dpi: float = 96,
    quality: float | None = None,
    background: str | None = None,
    fonts: Fonts | None = None,
    location: str = "to_image",
) -> bytes:
    """A PNG, JPEG, or WebP of the chart: laid out at ``size`` (or its own),
    drawn by resvg at ``dpi`` image pixels per inch, and encoded by Pillow
    with that resolution recorded (requires the ``export`` extra)."""
    if format == "svg":
        raise ChartError(
            f'{location} format: writes "png", "jpeg", or "webp" images; to_svg writes SVG',
            code="invalid-option",
            path="format",
        )
    plan = _plan(
        location,
        spec,
        format=format,
        size=size,
        unit=unit,
        dpi=dpi,
        quality=quality,
        background=background,
    )
    try:
        import resvg_py
        from PIL import Image
    except ImportError as error:
        raise ImportError(
            "Image export needs the `export` extra: pip install 'herceg[export]'"
        ) from error
    faces = _font_faces(fonts, location)
    settings = {
        "format": format,
        "size": _plain(size),
        "unit": unit,
        "dpi": _plain(dpi),
        "quality": _plain(quality),
        "background": background,
    }
    try:
        result = _call(
            "hercegStatic.image",
            json.dumps(spec),
            _encoded(buffers),
            json.dumps(faces),
            json.dumps({key: value for key, value in settings.items() if value is not None}),
            location,
        )
    except ChartError as error:
        raise _reworded(error, _located(str(error), location)) from None
    rendered = json.loads(result)
    width, height = (int(side) for side in plan.pixels)
    drawn = Image.open(io.BytesIO(_resvg(resvg_py, rendered, faces))).convert("RGBA")
    if drawn.size != (width, height):
        raise ChartError(
            f"{location}: resvg drew {drawn.size[0]} by {drawn.size[1]} pixels of the "
            f"{width} by {height} planned; report this as a bug",
            code="render-failed",
        )
    picture = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for color in rendered["under"]:
        picture.alpha_composite(Image.new("RGBA", (width, height), tuple(color)))
    picture.alpha_composite(drawn)
    del drawn
    return _encode(picture, plan)


def _resvg(resvg_py: Any, rendered: dict[str, Any], faces: list[dict[str, str]]) -> bytes:
    """resvg's PNG of the rendered SVG, its text in the supplied faces alone
    when there are any (resvg takes them as files, local to this export and
    removed on success or failure)."""
    if not faces:
        return bytes(resvg_py.svg_to_bytes(svg_string=rendered["svg"]))
    families = {}
    for face in faces:
        family = face["family"].strip().strip("\"'").strip()
        families[family.lower()] = family
    with tempfile.TemporaryDirectory(prefix="herceg-fonts-") as directory:
        paths = []
        for index, encoded in enumerate(rendered["fonts"]):
            path = Path(directory) / f"{index}.ttf"
            path.write_bytes(base64.b64decode(encoded))
            paths.append(str(path))
        return bytes(
            resvg_py.svg_to_bytes(
                svg_string=rendered["svg"],
                font_files=paths,
                skip_system_fonts=True,
                sans_serif_family=families.get("sans-serif"),
                serif_family=families.get("serif"),
                monospace_family=families.get("monospace"),
                cursive_family=families.get("cursive"),
                fantasy_family=families.get("fantasy"),
            )
        )


def _plain(value: Any) -> Any:
    """Planned numbers (NumPy's among them) as JSON writes them: floats, and a
    size as a list of floats."""
    if value is None:
        return None
    if isinstance(value, numbers.Real):
        return float(value)
    return [float(item) for item in value]


def _half_up(value: float) -> int:
    """``value`` rounded to a whole number, halves up (as the engine rounds)."""
    return math.floor(value + 0.5)


def _encode(picture: Any, plan: ExportPlan) -> bytes:
    """``picture`` (RGBA) in the plan's format, with its resolution recorded:
    PNG's pHYs, JPEG's JFIF density (whole dots per inch), and WebP's EXIF
    resolution. JPEG, which has no transparency, keeps every channel of
    color (no subsampling, which blurs a chart's thin colored lines)."""
    from PIL import Image

    out = io.BytesIO()
    if plan.format == "png":
        picture.save(out, "PNG", dpi=(plan.dpi, plan.dpi))
    elif plan.format == "jpeg":
        density = _half_up(plan.dpi)
        picture.convert("RGB").save(
            out,
            "JPEG",
            quality=_half_up(90 if plan.quality is None else plan.quality),
            dpi=(density, density),
            subsampling=0,
        )
    else:
        exif = Image.Exif()
        exif[282] = exif[283] = float(plan.dpi)  # XResolution, YResolution
        exif[296] = 2  # in inches
        # A WebP's EXIF chunk holds the TIFF header itself, without "Exif\0\0".
        picture.save(
            out,
            "WEBP",
            quality=_half_up(90 if plan.quality is None else plan.quality),
            lossless=False,
            exif=exif.tobytes()[6:],
        )
    return out.getvalue()


class SaveOptions(TypedDict, total=False):
    """``Chart.save``'s options, which ``hg.save`` takes too (see ``Chart.save``)."""

    format: SaveFormat | None
    size: tuple[float, float] | None
    unit: LengthUnit | None
    dpi: float | None
    quality: float | None
    background: str | None
    tooltip: Literal["title"] | None
    fonts: Fonts | None
    sizing: SvgSizing | None
    preserve_aspect_ratio: str | None
    stroke_scaling: StrokeScaling | None
    fallback: Sequence[str]
    missing_glyph: str | None
    page_size: PdfPageSize | None
    orientation: PdfOrientation | None
    margin: float | None
    title: str | None
    subject: str | None
    language: str | None


#: The format of each extension ``save`` knows.
_EXTENSIONS: dict[str, str] = {
    ".html": "html",
    ".svg": "svg",
    ".png": "png",
    ".jpg": "jpeg",
    ".jpeg": "jpeg",
    ".webp": "webp",
    ".pdf": "pdf",
}

#: The formats each of ``save``'s options is a setting of, and how to name them.
_SAVE_OPTIONS: dict[str, tuple[frozenset[str], str]] = {
    **{
        name: (frozenset({"svg", "png", "jpeg", "webp"}), "SVG and image")
        for name in ("size", "unit")
    },
    **{name: (frozenset({"png", "jpeg", "webp"}), "image") for name in ("dpi", "background")},
    "quality": (frozenset({"jpeg", "webp"}), "JPEG and WebP"),
    "fonts": (frozenset({"svg", "png", "jpeg", "webp", "pdf"}), "SVG, image, and PDF"),
    **{
        name: (frozenset({"svg"}), "SVG")
        for name in ("tooltip", "sizing", "preserve_aspect_ratio", "stroke_scaling")
    },
    **{
        name: (frozenset({"pdf"}), "PDF")
        for name in (
            "fallback",
            "missing_glyph",
            "page_size",
            "orientation",
            "margin",
            "title",
            "subject",
            "language",
        )
    },
}

#: Paths of each format, as messages name them.
_PATHS = {
    "html": ".html",
    "svg": ".svg",
    "png": ".png",
    "jpeg": ".jpg",
    "webp": ".webp",
    "pdf": ".pdf",
}


def save_format(path: str | PathLike[str], format: str | None) -> str:
    """The format ``save`` writes to ``path``: its extension's, which an explicit
    ``format`` must agree with, or ``format`` for a path without one of them."""
    suffix = Path(path).suffix.lower()
    by_extension = _EXTENSIONS.get(suffix)
    if format is not None:
        if format not in _PATHS:
            raise ValueError(
                'save format: expected "html", "svg", "png", "jpeg", "webp", or "pdf"; '
                f"received {shown(format)}"
            )
        if by_extension is not None and by_extension != format:
            raise ValueError(
                f'save format: "{format}" contradicts the path\'s {suffix} extension; '
                f"drop format, or save to a {_PATHS[format]} path"
            )
        return format
    if by_extension is None:
        raise ValueError(
            'save path: expected a ".html", ".svg", ".png", ".jpg", ".jpeg", ".webp", or '
            f'".pdf" file, or give format; received {shown(path)}'
        )
    return by_extension


def check_save_options(format: str, given: Sequence[str]) -> None:
    """Refuses options ``save`` was given that ``format`` does not take, and
    names it does not know."""
    for name in given:
        if name not in _SAVE_OPTIONS:
            close = difflib.get_close_matches(name, sorted(_SAVE_OPTIONS), n=1, cutoff=0.7)
            hint = (
                f"did you mean {close[0]!r}?"
                if close
                else "see help(herceg.save) for the options it takes"
            )
            raise TypeError(f"save: no option {name!r}; {hint}")
        formats, owners = _SAVE_OPTIONS[name]
        if format not in formats:
            paths = sorted({_PATHS[taker] for taker in formats}, key=list(_PATHS.values()).index)
            listed = paths[0] if len(paths) == 1 else ", ".join(paths[:-1]) + f", or {paths[-1]}"
            raise ValueError(
                f"save {name}: an option of {owners} export; save to a {listed} path or drop {name}"
            )


def show(chart: Chart) -> None:
    """Notebook display when running under IPython, otherwise a browser tab."""
    try:
        from IPython import get_ipython
        from IPython.display import display

        if get_ipython() is not None:
            display(chart)
            return
    except ImportError:
        pass
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, encoding="utf-8") as file:
        file.write(chart.to_html())
    webbrowser.open(f"file://{file.name}")
