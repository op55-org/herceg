# Export

Static SVG, PNG, JPEG, WebP, and PDF; fonts for identical layout
everywhere; server rendering with hydration; charts as portable specs
and binary payloads; and the spec's JSON Schema and the marks'
capabilities, for editors.

- [Exporting a chart](#exporting-a-chart)
- [SVG size and scaling](#svg-size-and-scaling)
- [Images for documents](#images-for-documents)
- [PDF documents](#pdf-documents)
- [Fonts](#fonts)
- [Server rendering](#server-rendering)
- [Charts from specs](#charts-from-specs)
- [Schema and capabilities for editors](#schema-and-capabilities-for-editors)
- [Payloads and page fragments](#payloads-and-page-fragments)

## Exporting a chart

A mounted chart exports what it shows now: its size, zoom, hidden series,
selected items, and highlighted rows. Static options export the same way without a DOM, on
servers, in workers, and in build scripts.

```ts
import { renderToSVG } from "herceg";
import { renderToImage } from "herceg/image";
import { renderToPDF } from "herceg/pdf";

const svg = chart.toSVG(); // standalone SVG document
const png = await chart.toPNG({ dpi: 192 }); // Blob, 2 pixels per CSS pixel
const pdf = renderToPDF(chart); // Uint8Array

const options = { width: 640, height: 320, marks: [line(metrics, { x: "time", y: "p99" })] };
const staticSvg = renderToSVG(options); // no DOM needed
const staticPdf = renderToPDF(options);
const jpeg = await renderToImage(options, { format: "jpeg", dpi: 150 }); // browser only
```

```python
chart.save("chart.svg")
chart.save("chart.png")  # 96 dpi at the chart's size
chart.save("chart.pdf")
chart.save("chart.html")  # self-contained page
svg = chart.to_svg()
png = chart.to_png(dpi=192)
pdf = chart.to_pdf()
```

| Function | Output | Where |
| --- | --- | --- |
| `chart.toSVG()` | SVG text | Browser |
| `chart.toPNG({ dpi })` | PNG `Blob`, drawn from the SVG | Browser |
| `renderToSVG(chartOrOptions, settings)` | SVG text | Anywhere |
| `renderToImage(chartOrOptions, settings)` (`herceg/image`) | PNG, JPEG, or WebP `Blob` | Browser |
| `renderToPDF(chartsOrOptions, settings)` (`herceg/pdf`) | PDF bytes | Anywhere |
| `specToSVG`, `specToPDF`, `specToSnapshot` (`herceg/spec`) | The same from a [spec](#charts-from-specs) | Anywhere |
| Python `to_svg`, `to_png`, `to_image`, `to_pdf`, `save`; `hg.to_pdf`, `hg.save` | The same, through an embedded V8 | Python, with the `export` extra |

- In PDF, marks, axes, and legends are vectors, heatmaps are compressed
  images, and text is selectable.
- PNG and WebP stay transparent where the chart is unless given a
  `background`; JPEG is drawn on `background`, else the chart's
  background, else white.
- With `rowSelection`, static exports draw what its stores hold, as a
  mounted chart would.
- Static options draw the first view, hidden series, and drill root their
  [state options](interaction.md#chart-state) give. They refuse a
  `selection`, which they do not draw: export selected rows through
  `rowSelection`.
- Node has no raster backend: on a server, write SVG or PDF, or images
  from Python. See the [roadmap](../roadmap.md).
- Python's images are rasterized by resvg and encoded by Pillow (`pip
  install 'herceg[export]'`); see [Python output](python/output.md).

## SVG size and scaling

An SVG is the chart's size by default. Settings are the second argument of
`renderToSVG` (third of `specToSVG`) and the argument of `chart.toSVG`.

| Setting (Python) | Does |
| --- | --- |
| `sizing: "fluid"` | Leaves out width and height, so CSS or the container sizes it and the viewBox scales the chart. |
| `preserveAspectRatio` (`preserve_aspect_ratio`) | `"none"` stretches to any box; or an alignment such as `"xMidYMid meet"`. |
| `strokeScaling: "fixed"` (`stroke_scaling`) | Keeps lines their width in pixels however it scales. |
| `size`, `unit` | Lays it out at a size in `"px"`, `"in"`, `"cm"`, `"mm"`, or `"pt"`, and says so in its width and height. |
| `tooltip: "title"` | Gives each bar, point, and line observation its tooltip text as a `<title>` (up to 5,000; charts whose other marks have tooltips are refused). |

```ts
const sparkline = renderToSVG(
  {
    width: 140, height: 48, padding: 0, legend: false,
    x: { show: false, nice: false }, y: { show: false, nice: false },
    marks: [line(metrics, { x: "time", y: "p99", clip: false })],
  },
  { sizing: "fluid", preserveAspectRatio: "none", strokeScaling: "fixed" },
);
const figure = renderToSVG(options, { size: [160, 100], unit: "mm", tooltip: "title" });
```

```python
svg = chart.to_svg(sizing="fluid", preserve_aspect_ratio="none", stroke_scaling="fixed")
svg = chart.to_svg(size=(160, 100), unit="mm", tooltip="title")
```

A file cannot lay itself out again, so no export keeps text at its pixel
size while the rest scales. Choose a fixed size, a fluid SVG that scales as
a picture (text too), or a [snapshot](#server-rendering) that a page
hydrates and the engine lays out at every size.

## Images for documents

A figure's size on the page and its resolution are separate settings:
`size` and `unit` lay the chart out, and `dpi` (96 by default) is pixels
per inch. 16 × 10 in at 150 dpi lays out at 1536 × 960 CSS pixels and
draws 2400 × 1500 pixels; another dpi changes pixels only, never wrapping,
ticks, or text size on the page. The file records its resolution (PNG
`pHYs`, JPEG JFIF density, WebP EXIF).

```ts
const figure = await renderToImage(options, {
  format: "jpeg", size: [16, 10], unit: "in", dpi: 150, quality: 90,
}); // 2400 × 1500 pixels
const shown = await renderToImage(chart, { format: "webp", dpi: 192 }); // a mounted chart as it is
```

```python
jpeg = chart.to_image(format="jpeg", size=(16, 10), unit="in", dpi=150, quality=90)
chart.save("figure.webp", size=(160, 100), unit="mm", dpi=300)  # format from the extension
```

- `quality` (0 to 100) compresses JPEG and WebP; PNG refuses it.
- A mounted chart is drawn at its own size; to export another size, export
  its options.
- Refused before anything is allocated: more than 16,384 pixels a side
  (16,383 for WebP), more than 16,777,216 pixels, or a dpi outside 1 to
  1,200. Browsers that do not write WebP (Safari) are refused with that
  reason.
- Python's `save` picks the format by extension (`.png`, `.jpg`, `.jpeg`,
  `.webp`, `.svg`, `.pdf`, `.html`) and refuses a contradicting `format` or
  another format's options.

## PDF documents

`renderToPDF` takes one chart (mounted or options) or a list, one chart
per page; `specToPDF` takes specs or `{ spec, buffers }` entries.

```ts
import { renderToPDF } from "herceg/pdf";
import { specToPDF } from "herceg/spec";

const report = renderToPDF([chart, options, anotherChart], {
  pageSize: "A4", orientation: "landscape", margin: 36,
  title: "Performance report", subject: "Service performance", language: "en-GB", fonts,
});
const fromSpecs = specToPDF([{ spec: spec1, buffers: buffers1 }, spec2], { pageSize: "Letter" });
```

```python
pdf_bytes = hg.to_pdf([latency, throughput, errors], page_size="A4", orientation="landscape",
                      margin=36, title="Performance report", language="en-GB")
hg.save([latency, throughput], "report.pdf", page_size="A4")
chart.save("page.pdf", page_size="Letter", margin=36, title="Report")
```

| Setting (Python) | Does |
| --- | --- |
| `pageSize` (`page_size`) | `"A4"` or `"Letter"`: portrait, 36 pt margin, each chart scaled uniformly to fit and centered. Without it, each page is its chart's size at 0.75 pt per CSS pixel. |
| `orientation` | `"landscape"` rotates a named paper size. |
| `margin` | Uniform, in points (72 per inch). |
| `title`, `subject` | Document metadata; for one chart, its title and description by default. |
| `language` | Document language; the single chart's `locale`, else `"en"`. |
| `fonts`, `fallback`, `missingGlyph` (`missing_glyph`) | [Fonts](#fonts) for the document, subset once across pages. |

- For several views with captions on one page, use
  [subplots](layout.md#subplots) and panel titles.
- PDFs are tagged with one Figure per chart (see
  [Accessibility](accessibility.md#static-output)).
- Output is deterministic: no creation date or random file id.

## Fonts

Without `fonts`, a browser chart measures with its canvas in the page's
fonts, static SVG estimates widths from Helvetica, and PDF uses Helvetica,
Times, or Courier with Windows-1252 (other characters print as "?"). For
the same layout in every output, and Unicode in PDF, prepare static
OpenType fonts whose families match the theme's font and give them to the
chart and its exports.

```ts
import { prepareFonts } from "herceg/fonts";

const fonts = prepareFonts([
  { family: "Inter", data: regularBytes }, // Uint8Array or Node Buffer
  { family: "Inter", weight: "bold", data: boldBytes },
  { family: "Symbols", data: symbolBytes },
]);
const theme = { style: { text: { font: '"Inter", Symbols, sans-serif' } } };
const chart = createChart(element, { ...options, theme, fonts }); // measured and drawn with them
const pdf = renderToPDF(chart); // embeds subsets of the chart's fonts
const fromSpec = specToPDF({ spec, buffers }, { fonts, missingGlyph: "?" });
```

```python
from pathlib import Path

theme = hg.Theme(style=hg.Style(text=hg.TextStyle(font="Inter, Symbols")))
fonts = {
    "Inter": {"normal": Path("Inter-Regular.ttf"), "bold": Path("Inter-Bold.ttf")},
    "Symbols": Path("Symbols.ttf").read_bytes(),
}
chart.to_pdf(fonts=fonts, fallback=["Symbols"])
chart.to_png(fonts=fonts, dpi=192)
```

| Output | With fonts |
| --- | --- |
| Browser chart | Measures with them where they cover the text; registers the faces with the page once. `chart.loading` waits for them. |
| SVG | Names the families; viewers need the fonts installed. |
| PNG (`toPNG`) | Embeds the faces in the SVG it draws. Python loads them into resvg. |
| PDF | Embeds subsets of the faces used (TrueType outlines only). |

- **Faces.** Static TrueType (`glyf`) fonts work everywhere; CFF outlines
  (most `.otf`) work except in PDF, which refuses them. WOFF, collections,
  and variable fonts are refused. `weight` is `"normal"` or `"bold"`; a
  missing weight uses the other face, without synthetic bold. Fonts over
  32 MiB and more than 64 faces are refused.
- **Coverage.** Text is set in the family list's faces in order, a
  grapheme cluster per face, unkerned and without ligatures. Every export
  refuses text the fonts do not cover, naming the character; PDF can fall
  back to `fallback` families or replace it with `missingGlyph`.
- **Scripts.** Embedded text admits Latin, Greek, Cyrillic, Armenian,
  Georgian, Han, kana, precomposed Hangul, and common punctuation and
  symbols ([exact allowlist](../architecture/export.md#text-admission)).
  Other scripts, emoji sequences, joiners, and text needing shaping are
  refused; export such labels without `fonts`.
- **Pages.** A page has one face per family and weight: charts giving one
  family different files are refused.
- Fonts are export options, never part of a spec, and are not loaded from
  CSS, installed fonts, or URLs. Their bytes are read, not copied, so they
  must not change afterward.
- Right-to-left pages: charts draw text left to right as they lay it out;
  right-to-left text keeps its own order.
- PDF pages are white paper: dark themes need a background color. Colors
  must be hex, `rgb()`, `hsl()`, or CSS names. Readers that ignore
  replacement text (macOS Preview) read halos of labels twice.
- Canvas-drawn mark labels keep ligatures in Firefox and Safari (and
  kerning in Safari), so they can be slightly narrower than measured; SVG
  text, guides, and exports are drawn as measured.

## Server rendering

`renderToSnapshot(options, env)` renders a chart without a DOM. The page
shows it before any script runs, and `hydrateChart` takes it over in the
browser without drawing again, so nothing flashes or reflows.

```ts
import { hydrateChart, renderToSnapshot } from "herceg";

// Server: the same options the browser's chart gets.
const initial = renderToSnapshot(options, { width: 640, height: 320, idPrefix: "latency" });
// Send initial.html in the page and initial (JSON) as page data.

// Browser, with initial.html inside host:
const chart = hydrateChart(host, options, initial);
```

```python
snapshot = chart.to_snapshot(id_prefix="latency")
```

| `env` option | Does |
| --- | --- |
| `width`, `height` | The layout size, kept until the host's size differs. |
| `idPrefix` | Starts every id in the markup (`[A-Za-z][\w-]*`), so server and browser agree. |
| `fonts` | Fonts to measure with (Helvetica estimates by default); the browser's chart must get the same. |
| `locale`, `timeZone` | Used where options set none: `"en-US"` and `"UTC"` by default. `"local"` is refused. |

- The snapshot is plain JSON: `html`, its size, ids, locale, time zone, how
  it measured text, and `state`. Send it as other page data (frameworks
  serialize it safely); written into a `<script>` by hand, escape every `<`
  as `\u003c` (`JSON.stringify(snapshot).replaceAll("<", "\\u003c")`), or
  a category named `</script>` ends the script.
- The same options and environment give the same markup. Hydration keeps
  nodes that would be drawn the same and redraws only what differs; markup
  the snapshot does not describe is refused and left as it is.
- Canvas charts swap the server's SVG for their canvas in the same task;
  GPU charts keep the markup until they draw.
- Specs: `specToSnapshot(spec, buffers, env)` (`herceg/spec`), hydrated
  with `hydrateChart(host, loadSpec(spec, buffers).config, initial)`.
- Adapters take the snapshot as `initial={hydration(snapshot)}` (see
  [Frameworks](frameworks.md#server-rendering)).

## Charts from specs

A spec is a chart as JSON plus binary buffers: what Python writes, and
what any language can. `herceg/spec` loads and exports them.

```ts
import { createChart } from "herceg";
import { chartFromSpec, loadSpec, specToSVG, validateSpec } from "herceg/spec";

chartFromSpec(element, spec, buffers); // buffers: ArrayBuffers for binary columns
const svg = specToSVG(spec, buffers);

const value: unknown = await response.json();
validateSpec(value); // narrows to ChartSpec, or throws naming the property
const { config, stores, unknown } = loadSpec(value);
createChart(element, config);
```

```python
spec, buffers = chart.to_spec()
```

- **Columns** are JSON arrays, `{ type: "time", values }`, binary columns
  (`{ type: "number" | "time", dtype: "float64" | "float32" | "int32" | ...,
  buffer: <index> }`), dictionary categories (`{ type: "category", codes,
  dictionary }`), or geometries (coordinates and offsets as buffers). A
  table with `"matrix": { "x": "lon", "y": "lat" }` holds a grid's
  coordinates once each.
- **Marks** are the same objects as a TypeScript mark's `spec`, with `data`
  naming their table. A mark's `spec` is frozen: to change a mark, build a
  new one and `update({ marks })`.
- **State options** (`selection`, `viewport`, `visibility`, `drillRoot`)
  give the chart's [first state](interaction.md#chart-state).
- **Row selections** are bindings with `data` naming the table:
  `{ "data": "trips", "channel": "focus", "events": ["brush", "click"] }`,
  optionally with a starting `selection` (a condition, or rows by
  position). `loadSpec` makes a store per bound table (returned in
  `stores`), or takes `{ tables, stores }` so several specs share rows and
  selections.
- **Checking.** Errors name the property, what was expected, and what was
  received (`marks[2].inner: expected "box", "quartiles", or "none";
  received "quart"`). Unknown properties are refused with the closest
  name; `{ unknown: "warn" }` or `"ignore"` loads the rest.
- **Version.** Specs carry `version: 1` (`SPEC_VERSION`), the default when
  left out; later versions are refused.
- `carryNodePositions(old, new)` keeps a network's node positions when a
  changed spec replaces a chart
  ([Networks](hierarchy-and-flow.md#networks)).

## Schema and capabilities for editors

Products that build charts from forms, or offer the marks that can do
something (be clicked, drill, take a selection), read two JSON files the
package publishes beside its code. No bundle includes them.

- `herceg/spec.schema.json` is a [JSON Schema](https://json-schema.org)
  (draft 2020-12) of the spec: `ChartSpec` and every option it reaches,
  generated from the spec's TypeScript types. Each option has a `title`
  made from its name, the `description` its documentation gives, its type
  and choices (`enum`, `const`; `examples` of an open string's usual
  values, a pattern, an interval, or a time), its `default` where the
  engine has one, and its bounds (`minimum`, `exclusiveMinimum`,
  `maximum`, `minItems`, `maxItems`; `integer` types; a `pattern` for
  dates and times of day). Objects take no other names, as `validateSpec` refuses them;
  marks are an `anyOf` of their forms, each with its `type`. Python
  returns the same schema from `hg.spec_schema()`, a dict, without a
  JSON Schema package.
- `herceg/capabilities.json` is the [capability matrix](../capabilities.md)
  of the marks: each row's state of every capability (works, unproved,
  refused with the error and what works instead, or not applicable with
  the reason), and what each row `emits`, the chart events its proved
  capabilities report (`click`, `select`, `rowSelection`, `pin`,
  `drill`, `itemMove`, `hover`, `viewport`), and `consumes`, the spec
  options through which it takes something in: another view's row
  selection (`rowSelection`), a synced cursor, view, or selection
  (`interaction.sync`), values that animate as they change
  (`animation.values`), and a renderer (`renderer`). Each capability has
  its `direction`, the `events` its tests observe, and the `options`
  that ask for it.

```ts
import Ajv2020 from "ajv/dist/2020.js"; // or any draft 2020-12 validator
import capabilities from "herceg/capabilities.json" with { type: "json" };
import schema from "herceg/spec.schema.json" with { type: "json" };
import { validateSpec } from "herceg/spec";

const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
if (!check(draft)) showFieldErrors(check.errors); // as the user types
validateSpec(draft); // then the engine's checks, which say more (below)

const drills = Object.entries(capabilities.marks)
  .filter(([, row]) => row.emits.includes("drill"))
  .map(([name]) => name); // ["treemap", "sunburst"]
```

```python
schema = hg.spec_schema()  # validate with jsonschema, or any draft 2020-12 validator
```

`validateSpec` and `loadSpec` also check what a JSON Schema cannot say,
listed in the schema's own description too:

- Fields name columns of the table an option reads, of the kind it needs: numbers, times, categories, or geometry (dodged, jittered, and swarmed points and dodged lines need a category position; a tree's color is a field of its path), and the values a channel takes as they are (a scale of type identity) are what the channel takes.
- A string that may be a field or a constant (a color, a shape) names exactly one of them: a field of the table, or a color or shape that is no field.
- A mark of several value fields takes no series field, and what is read once per series (a style map's field, a legend entry's field) does not change within one.
- Names refer to what the spec declares: a mark's data, a derived table's source, and a table's origin to a table of data (which a mark of a spec of several tables names); a panel to one of panels; a scale to x, y, yRight, or one of scales, of the kind the option needs; a mark to a mark's id; a colorbar to a color scale of the chart's marks; a view's or visibility's axis and panels to the chart's; a buffer to one delivered with the spec.
- Rules and regions at a field's thresholds need the chart's fields to give that field thresholds, in a table the chart's marks read.
- Tables hold what their columns' types say, and what counts their rows agrees with them: columns are of one length; times are epoch milliseconds or ISO 8601 times; category codes lie within their dictionary; geometry is nested as GeoArrow nests it (offsets start at 0, ascend, and end at the count of what they divide), at longitudes within ±540 and latitudes within ±90 degrees; a selection's rows are positions among its table's; and a dendrogram labels one leaf more than it has merges.
- A layout's cells lie within its rows and columns and do not overlap, and every panel is placed once.
- Ranges ascend (domains, colorDomain, radiusRange, a view's extent, a gauge's and a field display's min and max, a fit box's south and north, a time break's from and to, a value mapping's between), as do bin edges, thresholds, and a gauge's bands within its range.
- Options of a kind of chart need its marks: projection geographic marks; z, camera, and boxAspect 3D marks, whose box takes no zIndex or padding, and whose axes take a count of ticks and Intl formats; drillRoot a tree; a chart's or a panel's drag a graph.
- Options that go together or exclude each other beyond the forms here: text at a place or following a mark, once; a radar's category and value, or its fields; dodging with neither bands nor stacks; a contour's lines or bands, and two thresholds a band; a band's labels along one of its edges; itemKey with data; a rule in the legend with a label; a dragged rule at a value; a graph's node fields with a nodes table; color options of a map with a number color field; a facet's field, or row and column; an operation's field; a range's two ends (an area's, an error bar's) placed alike; a label's leader only where labels move (overlap "move"); points' outline (stroke, strokeWidth) of one value; an option given once, not also through encode; series' names (series: true) only for channels that read them; a list of channels' entries only up to the first that always gives an output; a series label's attachment, side, and edge only where it does not follow its series; several value fields only along the mark's direction (several x fields with orient "y"); a label's content that writes its value or names its series only where the label has one; a guide's room only on y axes, whose labels an ellipsis shortens; an axis guide's side along its axis (top or bottom for x, left or right for y); a stack's inside-out order only for shares or a stream; ticks' fiscal years only by months or years, and their anchor only by elapsed time.
- Colors are CSS colors (hex, rgb(), hsl(), var(), or names), a colors option names a known scheme, and color ramps (a theme's sequential and diverging, a scale's range of colors) are "#rgb" or "#rrggbb" colors.
- Conditions (filter, where) give true or false, and each operator takes the number and kinds of operands it reads (["field", name], numbers for "+").
- A scale of scales named other than x, y, or yRight gives its type.
- locale is a language tag, and timeZone a time zone, the JavaScript engine knows, and Intl's options (digits, currencies, units, calendars, numbering systems) are what its Intl takes.
- Number patterns (",.2f") and time intervals ("6 hours") are written as herceg reads them; a break's dates ("YYYY-MM-DD") are days of the calendar, "24:00" ends its hours but starts none, and its weekdays and hours leave time to show (not every day, not a span of no time or of a whole day).
- Options of a kind of value need values of that kind, which the data decides: times (time formats and intervals, breaks and seams, and a line's gaps and breaks of time) a time axis, and numbers (number formats, steps, and tick values) a linear one, or a tree's labels, which write numbers.
- Charts are large enough for what they hold: a scale's padding in pixels leaves room in its plot, a facet's panels and a layout's tracks fit its chart, and static exports (SVG, PNG, PDF) lay out at most 16384 pixels a side and draw no selection.

The schema is stricter than `validateSpec` in five places, where it
refuses what the engine takes:

- A 2D histogram's axis: its type has none, and validateSpec takes "left", where it draws anyway.
- Intl's options, which herceg hands to Intl as given: the schema takes the values their TypeScript types name, while Intl converts others (hour12 "true") and a format leaves out what it does not read (a date's options in a number's).
- Dash lengths below 0, which validateSpec takes in an option's dash (not in a dash channel's).
- A 3D mark's zIndex of 0, the default, which its type leaves out and validateSpec takes.
- An expression's operators, which herceg checks as it draws: where a mark does not read the option holding the expression (a region's encode.color beside its fill), it takes an operator the schema does not name.

Both files are generated in herceg's repository and tested: the schema
against `validateSpec`, on every spec of the tests, the specs these
guides give, Python's specs, and each option given every kind of value;
the capabilities by the tests the matrix names.

## Payloads and page fragments

`herceg/web` moves charts between a server and a page.

```ts
import { encodePayload, loadPayload, observe } from "herceg/web";

const bytes = encodePayload(spec, buffers); // on a server
const options = await loadPayload("/charts/latency.bin", { signal });
createChart(element, options); // or <Chart {...options} /> in an adapter
observe(); // mounts every [data-herceg] fragment, now and later
```

**Payload format.** A little-endian uint32 header length; the UTF-8 JSON
header `{ protocol: 1, kind: "chart", spec, buffers }` (each buffer's
`[offset, length]`); padding to 8 bytes; then the buffers, each 8-byte
aligned so typed arrays view them in place. `protocol` versions the payload
apart from the spec. `loadPayload` rejects anything else with a
`ChartError` (`load-failed`) before viewing it, naming the problem (a page
answering instead, a byte range past the end, an unknown protocol).

**Fragments** are elements with `data-herceg` holding a payload in a
`<template data-herceg-payload>` (base64 buffers) or naming one in
`data-herceg-src`. Python's `herceg.web.fragment` writes them
([Web pages](python/output.md#web-pages)).

| Function | Does |
| --- | --- |
| `observe(root?)` | Mounts every fragment in `root` and those inserted later (an HTMX swap), unmounts removed ones, keeps moved ones; returns a function that stops. |
| `mount(element, { src? })` | Mounts one; resolves with its chart after the first frame. |
| `unmount(element)` | Destroys its chart and aborts a fetch. |
| `getChart(element)` | Its chart. |

Importing `herceg/web` changes nothing until one of these is called.
Fragments report through DOM events that bubble and cross shadow roots
(typed in `HercegEventMap`), with JSON details:

| Event | Detail |
| --- | --- |
| `herceg:ready` | `{ id }` |
| `herceg:error` | `{ id, error }`; `preventDefault()` keeps it out of the console |
| `herceg:click` | `{ id, panel?, pointer, target, inspection, cause, revision }`: an input event ([Events](interaction.md#events)), its axis values in `pointer.time` and an axis label's in `target.time` marked as times |
| `herceg:select` | `{ id, owner, selection, phase, cause, revision, basis }`, once a selection is committed (not while a brush moves): a brush's (`kind: "brush"`, ranges as below) or items or series by their keys |
| `herceg:viewport` | `{ id, viewRevision, revision, cause, panel?, scales, views }` |
| `herceg:edge` | `{ id, scale, instance, time, panels, side, domain, bound, cause }` |
| `herceg:rowselection` | `{ id, data, channel, selection, cause, revision }` |
| `herceg:visibility` | `{ id, hiddenKeys, cause, revision, panels? }` |

Ranges are numbers (epoch ms on time scales) or labels on category axes;
causes and revisions are as the chart's events give them
([Events](interaction.md#events)). `viewportStatePayload(chart)` and
`restoreViewportState(chart, state)` carry the views a chart shows to one
mounted in its place. Payloads carry
charts only; grids have no spec.
