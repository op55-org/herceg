# Export architecture

How static SVG, images, PDF, fonts, server snapshots, and web payloads are
built. For using them, see the [Export guide](../guide/export.md).

- [One export plan](#one-export-plan)
- [Static SVG](#static-svg)
- [Images](#images)
- [PDF](#pdf)
- [Fonts](#fonts)
- [Text admission](#text-admission)
- [Server rendering](#server-rendering)
- [Web pages](#web-pages)

## One export plan

Exports take the chart (mounted or static options) first and how to write
the file second: `renderToSVG(target, settings)`, `specToSVG(spec, buffers,
settings)`, `renderToImage(target, settings)`, and Python's `to_svg`,
`to_image`, `to_png`, and `save`, whose keywords are the settings.

One planner checks settings for every output (`spec/export-plan.ts`:
`planWith`, wrapped as `planExport`; Python's `plan_export` makes the same
plans):

- a layout size in a unit, rounded to 1e-4 CSS pixels;
- image pixels at `dpi`, `floor(length * dpi / 96 + 0.5)`, refused past
  `EXPORT_LIMITS` before anything is allocated;
- the settings each format refuses (quality for PNG, dpi for SVG, titles
  for images and PDF), located at the export's name.

Layout happens once, at the layout size; dpi decides only how many pixels
draw it. A mounted chart is exported at its own size: other sizes and fonts
are refused rather than faked by resizing it.

Every export of a mounted chart goes through one method keyed by a symbol
(`render/export-scene.ts`), which draws what is pending and hands a scene
of the current state (size, views, hidden series, highlighted rows) and
the model to a writer.

## Static SVG

- `SvgSizing`: `sizing: "fluid"` leaves out width and height,
  `preserveAspectRatio` is written as given, and `strokeScaling: "fixed"`
  gives every element `vector-effect: non-scaling-stroke`.
- `tooltip: "title"` reuses `titlesOf` (`render/titles.ts`) over the
  export's scene, refusing charts whose other tooltip marks would be left
  without titles.
- The root has `role="img"`, `<title>`, and `<desc>` with the generated
  summary.
- Python renders SVG with the same DOM-free renderer in an embedded V8
  (`mini-racer`), so it matches the browser's chart except for text
  measurement without fonts.

## Images

Browsers draw images through a canvas (`image/raster.ts`): the SVG at the
image's pixels, painted over the base color (a JPEG's opaque base: the
theme's background, else white, or black under light text; then
`background`), encoded by `toBlob`, its MIME type and signature checked
(WebKit on macOS writes PNG when asked for WebP, which is refused), and the
resolution written into the bytes (`image/metadata.ts`: PNG `pHYs`, a JFIF
APP0, or WebP `VP8X` and `EXIF`). The canvas is emptied at once.

The raster module refers to no `ChartError` (it is handed a `Fail`, and
the planner a `Refuse`), so the chunk `toPNG` loads shares nothing with
the core bundle. Python draws the same SVG with resvg and encodes it with
Pillow.

## PDF

`renderPdf` (`render/pdf.ts`) draws a scene into a PDF page; `drawPdfPage`
is the page part; the public `renderToPDF` (`src/pdf.ts`, `herceg/pdf`)
takes a mounted chart, DOM-free options, or a nonempty list, one chart per
page. Pages default to the chart's size in points (0.75 per CSS pixel);
`render/pdf-paper.ts` adds A4 and Letter, portrait or landscape, uniform
margins (36 pt by default), scaling to fit, and centering. A chart-boundary
clip follows the fitting transform. Transform numbers are fixed-point; a
factor that rounds to zero is refused.

**PDF switches on geometry kinds.** Every other renderer calls the drawing
attached to the geometry. PDF does not: a `pdf` member on each drawing
would ship PDF code in every chart bundle, while PDF export is rare and
mostly runs on servers and in Python. The switch is checked against the
built-in geometry union (`MarkGeometry`), so a new kind does not compile
until PDF draws it; an unknown third-party kind is refused. PDF reuses the
drawings' path tracing (`traceLine`, `traceArea`), so outlines match the
canvas.

- Marks, axes, and legends are vector paths (circles as Béziers; custom
  marks' SVG path data converted, arcs included).
- Opacities are graphics states.
- Heatmaps are RGB images with a soft mask for missing cells, each cell
  repeated to about two image pixels per CSS pixel (at most 4,194,304
  pixels), because some viewers (macOS Preview) smooth images regardless
  and would blur cells together.
- The color legend's ramp is an axial shading.

**The writer** (`render/pdf-document.ts`, `PdfWriter`) owns objects,
compressed streams, page and structure references, and font ids. Pages are
serialized as they complete, releasing their scenes and rasters. Font
programs and Unicode maps are written after every page has contributed
glyphs, so each face is subset once. Each export makes a fresh resolver, so
glyph usage never leaks between documents. Single and list exports share
orchestration code, which single-chart bundles keep.

**Metadata.** A single chart's document defaults its title, subject, and
language to the chart's title, description, and locale; multi-chart
documents default to English with no title. Export settings override
`title`, `subject`, and `language`. The Figure alternative is the chart's
title and `describeChart(model)` summary.

**Tagged PDF.** Both font paths produce `/MarkInfo << /Marked true >>`,
`/Lang`, and a `StructTreeRoot` whose `Document` holds a `Figure` per chart
(MCID 0 on its page, with a ParentTree entry per page). Backgrounds and grid
lines are `/Artifact` content; labels, legends, and annotations are inside
the Figure. Facets and subplots share one Figure, since they share a title,
legends, and description. This is chart-level tagging, not PDF/UA. The
generated summary is English (tagged `/Lang (en)` unless the catalog is
English); `locale` changes number and date formats only.

**Compression and determinism.** Streams use a small built-in deflate
(fixed Huffman codes with LZ77; zlib's dynamic codes would make text about
30% smaller), because output is built synchronously wherever the engine
runs, including the V8 embedded in Python, which has no compression API.
Output has no creation date or random file id.

**Bundling.** PDF export is its own entry point, `herceg/pdf`, so charts
that do not import it carry none of it. Single-chart PDF bundles keep the
list and paper-sizing code, shared with multi-chart exports. The
`herceg-pdf`, `herceg-pdf-document`, `herceg-spec-pdf`, and
`herceg-pdf-fonts` [size entries](../comparison.md#bundle-size) track them.

## Fonts

Without supplied fonts, PDF text uses the six standard faces
(regular and bold Helvetica, Times, Courier) with WinAnsi and exact Adobe
AFM advances, and static SVG measures with Helvetica estimates.

`prepareFonts(sources)` (`herceg/fonts`) gives a resolver that both layout
and drawing use: `src/pdf.ts` asks it for an export-scoped
`PdfFontResolver` (with the export's `fallback` and `missingGlyph`), passes
its measurer into `model.scene()`, and the same resolver into
`renderPdf()`. Family, weight, and coverage resolve into glyph runs.
Advances from `hmtx` are rounded once (six decimals in 1/1000 em) and used
identically in layout and `/W`; there is no kerning or shaping. A fallback
string is anchored as a whole before spans are placed (rotated text and
halos included). Cap heights come from OS/2 (hhea ascent otherwise).

**The registry** (`fonts/registry.ts`) holds faces parsed once
(`fonts/sfnt.ts`, `fonts/binary.ts`) and resolves text into glyph runs: the
faces of a CSS family list and weight in order, each grapheme cluster
(`fonts/clusters.ts`) in one face. Its `measure` (cached by font and text)
is what every output lays out with when a chart has `fonts`, and every
output sets text as it measures. Measuring reads only metrics and the
character map (`head`, `hhea`, `hmtx`, `maxp`, `cmap`, `OS/2`), so CFF
faces measure and browsers and resvg draw them; only PDF embedding needs
TrueType outlines. Variable fonts are refused everywhere: their widths
follow axes the default instance would not. The registry holds no export
state: each PDF export asks it, through `EMBED_FONTS`, for its own
`PdfFontResolver` (`render/pdf-font-embed.ts`).

**Coverage.** `renderToSVG` and `specToSVG` measure every text the scene
draws before writing (`render/coverage.ts`), so uncovered text is refused
as PDF refuses it rather than drawn as boxes by a rasterizer; a mounted
chart's `toSVG()` and `toPNG()` check their scene too (`PageFonts.check`).
A live chart never refuses text: it falls back to the page's fonts.

**In the browser**, fonts come through `USE_FONTS` (`fonts/prepared.ts`),
code that ships with the registry rather than the chart. Fonts claim their
faces on the page, one per family and weight (`dom/font-claims.ts` refuses
another file for one), register with the document once (`dom/fonts.ts`),
and measure uncovered text as the page draws it. Whenever faces load in a
document, its measurers are made again and every chart there lays out and
draws again (`dom/measurers.ts`, the small part in the core bundle). Text
in charts with fonts is drawn unkerned and without ligatures; canvases in
Firefox and Safari keep ligatures (and Safari kerning) in mark labels, so
those can be slightly narrower than measured. Prepared fonts serialize to
a name of their own (`toJSON`), so adapters comparing options as JSON never
walk their bytes. PDF slants italic text 12 degrees, as the faces it draws
with have no italics.

| Part | Does |
| --- | --- |
| `fonts/truetype.ts` | Validates static sfnt TrueType `glyf` faces and cmap formats 4 and 12, with table and glyph bounds and composite-cycle checks. |
| `render/pdf-font-subset.ts` | Rebuilds `glyf`, `loca`, `hmtx`, `cmap`, names, checksums, and headers after drawing, keeping `.notdef` and composite components. |
| Prepared fonts | Snapshot sources and fallback lists, borrow bytes read-only, parse each face once (family cache bounded at 256 entries). Each document owns its CID maps and subsets. |
| Writer | FontFile2 with Type0/CIDFontType2, Identity-H, `/W`, an explicit CIDToGIDMap, and ToUnicode maps to the original scalars and sequences. Descriptor flags classify the embedded repertoire against Adobe's standard Latin set. |

Limits and checks: fonts up to 32 MiB, registries up to 64 faces; OS/2
lengths checked per version; fsType-restricted and bitmap-only faces are
refused for embedding (they still measure), no-subsetting faces embed whole;
input checksums are not checked (real fonts often have wrong ones). CFF
outlines are refused for embedding; collections, WOFF, and variable fonts
everywhere. Composite
glyphs are bounded (64 nesting levels, 4,096 direct components, 65,536
expanded instances, 65,535 points or contours per glyph, 262,144 references
per font).

**Bundling.** Plain PDF exports bundle no parser, resolver, or subsetter;
using `prepareFonts` brings them. `renderToPDF` imports only types and the
key (`EMBED_FONTS`); the document writer calls a face's writer through its
`reserve`/`object`/`stream` interface. The `herceg-pdf` and
`herceg-pdf-fonts` size entries track both paths.

**Python** reads family-to-path or bytes mappings (`_render.py`), checks
face counts and sizes (32 MiB per path read), sends bytes as base64, and
`python/js/static.ts` calls `prepareFonts` with Python's fallback options.
`to_svg`, `to_image`, and `to_png` with `fonts=` measure with the same
resolver, so supplied-font layouts match PDF's advances. SVG references the
families without embedding them. PNG loads the font files into resvg under
the mapping's names, with system font discovery off, and removes the
temporary files afterwards; resvg may shape text differently from PDF's
unkerned runs.

## Text admission

Supplied-font export admits text by an allowlist, not a list of refused
scripts:

- Scripts: Latin, Greek, Cyrillic, Armenian, Georgian, Han, Hiragana,
  Katakana, and Hangul as precomposed syllables (U+AC00–U+D7A3).
- Common and Inherited scalars must fall in the ranges below and have
  `Script_Extensions` among those scripts or Common/Inherited (so Arabic
  punctuation and Vedic marks stay out).

| Common/Inherited purpose | Inclusive ranges |
| --- | --- |
| Basic punctuation, digits, Latin-1 symbols | U+0020–007E, U+00A0–00FF |
| Spacing modifiers and combining accents | U+02B0–02E4, U+02EA–036F, U+1AB0–1AFF, U+1DC0–1DFF |
| Punctuation, superscripts, currency, mathematical, technical, enclosed, geometric symbols, dingbats | U+2000–27FF, U+2900–2BFF, U+2E00–2E7F |
| CJK punctuation, shared kana signs, annotation, strokes, enclosed and compatibility symbols | U+3000–3030, U+3036–303F, U+3099–309C, U+30A0–30FF, U+3190–33FF |
| Modifier tone letters and small form variants | U+A700–A711, U+A717–A71F, U+FE50–FE6F |
| Fullwidth and halfwidth forms, excluding halfwidth Hangul | U+FF01–FF9F, U+FFE0–FFEE |
| Tai Xuan Jing symbols and mathematical alphanumerics | U+1D300–1D37F, U+1D400–1D7FF |
| Mahjong, dominoes, cards, enclosed symbols, pictographs, individual emoji, legacy computing symbols | U+1F000–1FAFF, U+1FB00–1FBFF |

Refused: every other script; private-use, unassigned, and surrogate
scalars; controls (format controls included); line and paragraph
separators; default-ignorables; emoji modifier, flag, tag, and ZWJ
sequences; joiners and variation sequences; the contour tone letters
(U+02E5–02E9, U+A712–A716, which ligate); the vertical kana repeat marks
(U+3031–3035); Hangul Jamo, halfwidth Hangul, Braille, vertical
presentation forms, and ideographic description characters. Admission
follows the runtime's Unicode tables, so an older runtime refuses what it
considers unassigned.

Clusters are kept in one face. They come from `Intl.Segmenter` where
available (browsers, Node, MiniRacer 0.14.1); without it, a conservative
grouping appends Marks, `Grapheme_Extend` characters (the halfwidth voiced
marks U+FF9E/U+FF9F and variation selectors included), emoji modifiers, and
ZWJ plus its next scalar. This fallback covers admitted text; it is not
full [UAX #29](https://www.unicode.org/reports/tr29/) segmentation. Simple
accents use NFC precomposition (the face must cover the source scalars and
the composed glyph, and ToUnicode keeps the original sequence); other
combining sequences are refused. Halfwidth kana clusters use one face and
one advancing glyph per scalar. Missing coverage is an error unless a
covered replacement scalar is supplied (`missingGlyph`).

## Server rendering

`renderToSnapshot` (`render/snapshot.ts`) runs the browser runtime's own
SVG layer and legend over a small DOM of plain objects (`ShimDocument`), so
the server's nodes are the ones a mounted chart would make, not a second
writer's. Its model is the static exports' (`staticCompilers()`), laid out
at the given size, measured with the given fonts or Helvetica estimates.
Ids start with `idPrefix`, never a counter, so the same options give the
same markup everywhere.

The snapshot (`render/snapshot-format.ts`) is JSON: markup, size, ids,
locale, time zone, measurement (`"estimate"` or a fingerprint of the
fonts), and the state adoption needs: per panel, each geometry's key, kind,
and element count (or markup hash), hashes of what is drawn under the data
and of the guides, and the legend's entries.

`hydrateChart` (`dom/hydrate.ts`) adopts the markup before constructing
the chart (`dom/adopt.ts`): it walks the element in the order the layers
wrote it and checks every part against the state, throwing with nothing
changed at the first difference. Adopted parts go into the constructors
(`MountedChart`'s `adopted`, `SvgLayer`'s parts, the `Legend`), which take
the nodes over, so the first frame redraws only geometry whose drawing
differs. The chart keeps the snapshot's measurement and size until its
options or host size change.

The adapters write `initial.html` into a host element in their first
render, on the server and in the browser alike, so frameworks hydrate their
own markup without mismatch, then hydrate the chart from that host on
mount. They take `hydration(snapshot)`, which brings `hydrateChart` with
it, so the adoption code is only in pages that hydrate; `createChart`
carries only the constructors' seams for adopted parts.

## Web pages

`herceg/web` (`src/web/`) moves charts between servers and pages; Python's
`herceg.web` builds on it. It is a subpath, so no chart made with
`createChart` carries it.

**Payloads** (`web/payload.ts`, Python's `_payload.py`). The header is an
envelope, `{ protocol: 1, kind: "chart", spec, buffers }`, versioned apart
from the spec: a change of framing is a new protocol, a change of grammar a
new spec version. Makers may add fields (the Streamlit component's events
and epochs) but not replace the envelope's. Reading checks everything
before viewing bytes (length, header bounds, fatal UTF-8 and JSON,
protocol, kind, each range's integers, alignment, and bounds) and refuses
with `load-failed` errors located in the payload; bytes that start like
markup or JSON are named as a response of another kind (a login page). One
copy aligns a view that starts unaligned, as Streamlit hands one over.

Fragments hold the same envelope as JSON with base64 buffers: in a page,
text is what can be held, and large data goes through a route. Herceg
never picks a route by size: `data_url` is the application's, which owns
caching and authentication.

**Fragments** (`web/mount.ts`, `web/observe.ts`). A fragment has its size
in data attributes, a style element reserving it (nonce'd when the page has
one), a fallback, and its payload in an inert `<template>` (which HTMX
keeps) or a URL in `data-herceg-src`. It holds no executable script, so a
page's content security policy needs nothing for it.

- `mount` takes the host once (a `WeakMap` by element, never by id),
  removes runtime markup restored from history, moves the size into the
  host's CSSOM style, loads under an `AbortController`, and draws into a
  `data-herceg-runtime` element of its own. Unmounting rejects a pending
  `mount` with an `AbortError`.
- `observe` uses one `MutationObserver` for every root and one registry of
  hosts, so outcomes never depend on which root's records came first.
  Records arrive after the change, so a host moved within the observed
  roots keeps its chart, and a host whose content was replaced in place is
  mounted afresh. Changes inside runtime elements are skipped.
- Python's page script mounts at `DOMContentLoaded`, after the page's other
  deferred and module scripts, so their listeners hear every chart's
  events.

**Events** are bubbling, composed `CustomEvent`s whose details are JSON
(`web/events.ts`, shared with the Python widget and Streamlit component):
times as epoch ms with the axes holding them named, categories as labels,
rows as positions in the data drawn. There is no revision: a fragment sent
again is a new chart.

**Assets** (`python/js/build.mjs`). The pages' script is an ES module built
with code splitting, every file named by a hash of its content. A manifest
lists the entry, its static imports (preloaded with `modulepreload`), and
every file. `herceg.web.assets` writes the preloads and module script with
the page's nonce, which a module's imports inherit, so `script-src
'nonce-...'` alone admits them. The entry's static closure is the spec
loader, which imports every mark a spec can name; the interaction
controller and other chunks load as charts need them. `Chart.to_html`
stays self-contained, with the single-file bundle inlined.
