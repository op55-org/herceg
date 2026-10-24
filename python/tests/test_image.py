"""Images for documents: ``to_image``, ``to_png``, and ``save`` by extension.
Pixel sizes come from the layout size and dpi; each file records its
resolution (read here by a parser of its own, not Pillow's); dpi never
changes the layout; JPEG is drawn on an opaque surface; text is drawn in the
fonts it was measured with; and limits and contradictions are refused."""

import io
import struct
from pathlib import Path

import numpy as np
import pytest
from PIL import Image

import herceg as hg

ROOT = Path(__file__).parents[2]
FONT_FIXTURES = ROOT / "packages/herceg/test/fixtures/pdf-fonts"
DATA = {"t": [0, 1, 2, 3, 4], "v": [3, 1, 4, 1, 5]}


def chart(**options):
    return hg.Chart(DATA, title="Load", width=400, height=200, **options).line(x="t", y="v")


def density(data: bytes) -> tuple[float, float] | None:
    """Dots per inch a PNG, JPEG, or WebP file records, read from its bytes."""
    if data[1:4] == b"PNG":
        at = 8
        while at < len(data):
            (length,) = struct.unpack(">I", data[at : at + 4])
            if data[at + 4 : at + 8] == b"pHYs" and data[at + 16] == 1:
                x, y = struct.unpack(">II", data[at + 8 : at + 16])
                return (x * 0.0254, y * 0.0254)
            at += 12 + length
        return None
    if data[:2] == b"\xff\xd8":
        at = 2
        while data[at] == 0xFF and data[at + 1] != 0xDA:
            (length,) = struct.unpack(">H", data[at + 2 : at + 4])
            if data[at + 1] == 0xE0 and data[at + 4 : at + 9] == b"JFIF\0" and data[at + 11] == 1:
                return struct.unpack(">HH", data[at + 12 : at + 16])
            at += 2 + length
        return None
    at = 12
    while at + 8 <= len(data):
        kind = data[at : at + 4]
        (length,) = struct.unpack("<I", data[at + 4 : at + 8])
        if kind == b"EXIF":
            tiff = data[at + 8 : at + 8 + length]
            order = "<" if tiff[:2] == b"II" else ">"
            (ifd,) = struct.unpack(order + "I", tiff[4:8])
            (count,) = struct.unpack(order + "H", tiff[ifd : ifd + 2])
            values = {}
            for i in range(count):
                entry = ifd + 2 + i * 12
                tag, kind_, _, value = struct.unpack(order + "HHII", tiff[entry : entry + 12])
                if kind_ == 5:
                    values[tag] = struct.unpack(order + "II", tiff[value : value + 8])
                elif kind_ == 3:
                    values[tag] = struct.unpack(order + "H", tiff[entry + 8 : entry + 10])[0]
            if values.get(296) != 2:
                return None
            return tuple(n / d for n, d in (values[282], values[283]))  # type: ignore[return-value]
        at += 8 + length + (length & 1)
    return None


def picture(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


@pytest.mark.contract("export.image.python")
def test_a_figure_in_inches_lays_out_once_and_is_drawn_at_its_dpi():
    item = chart()
    jpeg = item.to_image(format="jpeg", size=(16, 10), unit="in", dpi=150)
    assert picture(jpeg).format == "JPEG"
    assert picture(jpeg).size == (2400, 1500)
    assert density(jpeg) == (150, 150)
    png = item.to_image(size=(16, 10), unit="in", dpi=150)
    assert picture(png).size == (2400, 1500)
    assert density(png) == pytest.approx((150, 150), abs=0.02)
    webp = item.to_image(format="webp", size=(16, 10), unit="in", dpi=150)
    assert picture(webp).format == "WEBP"
    assert picture(webp).size == (2400, 1500)
    assert density(webp) == (150, 150)
    # The chart's own size at 96 dpi: a pixel per CSS pixel.
    assert picture(item.to_png()).size == (400, 200)
    assert density(item.to_png(dpi=192)) == pytest.approx((192, 192), abs=0.02)
    assert picture(item.to_png(dpi=192)).size == (800, 400)


def test_the_dpi_never_moves_what_the_layout_placed():
    item = chart()
    low = np.asarray(picture(item.to_png(size=(6, 3), unit="in", dpi=96)).convert("L"), float)
    high = picture(item.to_png(size=(6, 3), unit="in", dpi=192)).convert("L")
    halved = np.asarray(high.resize(low.shape[::-1], Image.Resampling.BOX), float)
    # The same drawing at twice the pixels, averaged back: ink in the same places.
    assert np.mean(np.abs(low - halved)) < 3
    assert item.to_svg(size=(16, 10), unit="in").startswith(
        '<svg xmlns="http://www.w3.org/2000/svg" width="16in" height="10in" viewBox="0 0 1536 960"'
    )


def test_jpeg_is_drawn_on_the_charts_background_or_white_or_black():
    def corner(item, **settings):
        return picture(item.to_image(format="jpeg", **settings)).convert("RGB").getpixel((2, 2))

    def near(color, expected):
        assert all(abs(a - b) < 8 for a, b in zip(color, expected, strict=True)), color

    near(corner(chart()), (255, 255, 255))
    near(corner(chart(theme="dark")), (0x12, 0x15, 0x1C))
    transparent = {"tokens": {"background": "transparent"}}
    near(corner(chart(theme=transparent)), (255, 255, 255))
    near(
        corner(chart(theme={"tokens": {"background": "transparent", "text": "#eeeeee"}})), (0, 0, 0)
    )
    near(corner(chart(theme=transparent), background="var(--paper, #00ff00)"), (0, 255, 0))
    # Channels of hsl() are fractions, drawn as the nearest bytes.
    near(corner(chart(theme=transparent), background="hsl(200 50% 50%)"), (64, 149, 191))
    assert picture(chart(theme=transparent).to_png(background="hsl(200 50% 50% / 0.5)")).getpixel(
        (2, 2)
    )[3] in (127, 128)
    # PNG keeps the transparency, unless given a background.
    assert picture(chart(theme=transparent).to_png()).getpixel((2, 2))[3] == 0
    assert picture(chart(theme=transparent).to_png(background="#0000ff")).getpixel((2, 2)) == (
        0,
        0,
        255,
        255,
    )


def test_numpy_numbers_are_settings_like_any_other():
    item = chart()
    jpeg = item.to_image(
        format="jpeg",
        size=(np.int64(6), np.int64(4)),
        unit="in",
        dpi=np.float32(150),
        quality=np.int64(80),
    )
    assert picture(jpeg).size == (900, 600)
    assert 'width="4in"' in item.to_svg(size=(np.int64(4), np.float64(2)), unit="in")


def test_quality_compresses_jpeg_and_webp():
    item = chart()
    for format in ("jpeg", "webp"):
        assert len(item.to_image(format=format, quality=10)) < len(
            item.to_image(format=format, quality=95)
        )
        # 0 is a quality, not the default (90).
        assert item.to_image(format=format, quality=0) != item.to_image(format=format)
        assert item.to_image(format=format, quality=90) == item.to_image(format=format)


def test_text_is_drawn_in_the_fonts_it_was_measured_with():
    fonts = {"Fixture": FONT_FIXTURES / "sans.ttf"}
    title = "WMWMWM"
    item = hg.Chart(
        DATA,
        title=hg.Title(title, style=hg.TextStyle(font_size=40, font_weight=400, color="#000000")),
        width=400,
        height=200,
        legend=False,
        theme={"style": {"text": {"font": "Fixture, monospace"}}},
    ).line(x="t", y="v")

    def ink(dpi, **settings):
        pixels = np.asarray(picture(item.to_png(dpi=dpi, **settings)).convert("L"))
        rows = pixels[: round(60 * dpi / 96)]
        columns = np.nonzero((rows < 128).any(axis=0))[0]
        return (columns[-1] - columns[0] + 1) * 96 / dpi

    drawn = ink(96, fonts=fonts)
    assert abs(ink(192, fonts=fonts) - drawn) <= 1
    # Without them, resvg's own monospace, narrower than the face measured.
    assert ink(96) < drawn - 40


def test_settings_are_refused_where_they_are_wrong():
    item = chart()
    with pytest.raises(hg.ChartError) as raised:
        item.to_image(size=(16, 10), unit="in", dpi=600)
    assert (raised.value.code, raised.value.path) == ("invalid-option", "dpi")
    assert str(raised.value).startswith(
        "to_image dpi: 9600 by 6000 pixels is more than PNG exports draw (16384 a side"
    )
    # PNG takes no quality, and SVG no dpi.
    with pytest.raises(TypeError, match="quality"):
        item.to_png(quality=80)  # type: ignore[call-arg]
    with pytest.raises(TypeError, match="dpi"):
        item.to_svg(dpi=300)  # type: ignore[call-arg]
    with pytest.raises(hg.ChartError, match="to_image quality: compresses JPEG and WebP; PNG"):
        item.to_image(quality=80)
    with pytest.raises(hg.ChartError, match="to_image unit: says what size is measured in"):
        item.to_image(unit="in")
    with pytest.raises(hg.ChartError, match='to_image format: writes "png", "jpeg", or "webp"'):
        item.to_image(format="svg")  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError) as raised:
        item.to_image(background="paper")
    assert (raised.value.path, str(raised.value)) == (
        "background",
        'to_image background: expected a CSS color; received "paper"',
    )


def test_save_writes_the_format_of_its_extension(tmp_path):
    item = chart()
    for name, format in [
        ("a.png", "PNG"),
        ("a.jpg", "JPEG"),
        ("a.jpeg", "JPEG"),
        ("a.webp", "WEBP"),
    ]:
        item.save(tmp_path / name, dpi=150)
        written = (tmp_path / name).read_bytes()
        assert picture(written).format == format
        assert density(written) == pytest.approx((150, 150), abs=0.02)
    item.save(tmp_path / "plain", format="jpeg", quality=80)
    assert picture((tmp_path / "plain").read_bytes()).format == "JPEG"
    item.save(tmp_path / "same.jpg", format="jpeg")
    with pytest.raises(ValueError, match='save format: "png" contradicts the path\'s .jpg'):
        item.save(tmp_path / "other.jpg", format="png")
    assert not (tmp_path / "other.jpg").exists()
    with pytest.raises(ValueError, match="save dpi: an option of image export; save to a .png"):
        item.save(tmp_path / "a.svg", dpi=300)
    with pytest.raises(ValueError, match="save quality: an option of JPEG and WebP export"):
        item.save(tmp_path / "b.png", quality=80)
    with pytest.raises(ValueError, match="save tooltip: an option of SVG export; save to a .svg"):
        item.save(tmp_path / "c.png", tooltip="title")
    item.save(tmp_path / "titled.svg", tooltip="title", size=(160, 80), unit="mm")
    titled = (tmp_path / "titled.svg").read_text()
    assert 'width="160mm" height="80mm"' in titled
    assert titled.count('pointer-events="all"><title>') == 5
    with pytest.raises(ValueError, match="save size: an option of SVG and image export"):
        item.save(tmp_path / "d.pdf", size=(4, 2), unit="in")
    with pytest.raises(hg.ChartError, match="save unit: expected"):
        item.save(tmp_path / "g.png", size=(4, 2), unit="")  # type: ignore[arg-type]
    with pytest.raises(hg.ChartError) as raised:
        item.save(tmp_path / "h.png", background="var(--paper)")
    assert (raised.value.path, str(raised.value)) == (
        "background",
        "save background: is the CSS variable var(--paper), which only a chart in a page can "
        "read; give a fallback, as var(--name, #2a78d6)",
    )
    # Options left at None are not given, for one chart or several.
    item.save(tmp_path / "e.pdf", dpi=None, quality=None)
    hg.save([item, item], tmp_path / "f.pdf", dpi=None, tooltip=None)
    assert (tmp_path / "f.pdf").read_bytes().startswith(b"%PDF-")


def test_native_titles_in_svg_are_refused_where_they_cannot_go():
    with pytest.raises(hg.ChartError) as raised:
        chart().area(x="t", y="v").to_svg(tooltip="title")
    assert (raised.value.code, raised.value.path) == ("unsupported", "tooltip")
    assert str(raised.value).startswith(
        'to_svg tooltip: "title" goes on bars, points, and lines, and marks[1] (area) is none'
    )
    with pytest.raises(hg.ChartError, match='to_svg tooltip: expected "title"'):
        chart().to_svg(tooltip="native")  # type: ignore[arg-type]
