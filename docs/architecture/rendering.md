# Rendering architecture

How scenes become pixels or markup, how frames are scheduled, and how
changes animate. For choosing a renderer as a user, see
[Large data](../guide/large-data.md).

- [Drawings](#drawings)
- [Renderers](#renderers)
- [Choosing a renderer](#choosing-a-renderer)
- [Layers in the browser](#layers-in-the-browser)
- [Paint order and picking](#paint-order-and-picking)
- [Points](#points)
- [Heatmap rasters](#heatmap-rasters)
- [Continuous and categorical color](#continuous-and-categorical-color)
- [Scheduling](#scheduling)
- [Animated views](#animated-views)
- [Animated values](#animated-values)

## Drawings

Geometry carries its drawing (`Drawing` in `scene/scene.ts`,
implementations in `src/draw/`): its SVG markup, optionally the same output
as a few SVG elements with attributes, its size (for choosing a renderer),
and its canvas painter. The mark that emits the geometry attaches the
drawing, so:

- the SVG and Canvas renderers know no geometry kinds;
- a bundle contains drawing code only for the marks it imports (a line
  chart carries no bar, point, raster, or text drawing);
- each geometry type is checked against its drawing's type at compile time
  (the `Geometry` base type renderers hold erases the pairing).

Guide drawings (rules, text, labels) are not cut to the plot unless their
mark says so (`defaultClip: false`). A drawing without a canvas painter
keeps its chart's scene in SVG, where everything paints in order. PDF is
the exception that switches on geometry kinds (see
[PDF](export.md#pdf)).

## Renderers

| Renderer | Output | Notes |
| --- | --- | --- |
| `renderSvg` | A standalone SVG document | Server, export, tests. |
| `SvgLayer` | Retained SVG DOM | Keeps each geometry's nodes by key. Drawings that describe themselves as elements (lines, areas, bars, opaque points, rasters) update attribute by attribute, several times cheaper than reparsing; others (translucent points, rules, text) are a group rewritten when its markup hash changes. Axes and grid are rebuilt only when their markup changes. Bars and points are one `path` per series. |
| `paintCanvas` | Canvas 2D at the device pixel ratio | Point drawings hand clouds, and 3D faces their batches, to the WebGL painter when loaded. |
| `renderPdf` | A PDF page or document | See [PDF](export.md#pdf). |

Browser-specific choices in the SVG layer and canvas:

- Panels' grid lines and geometry take no pointer events; the chart finds
  what the pointer is over itself.
- A plot of one rectangle is cut by a `path()` shape in the view box, not a
  clip path. Firefox otherwise tests the pointer against stroked outlines on
  every move and recomputes clipped stroke bounds on every DOM change (a few
  milliseconds for a line of 3,000 points). Plots with insets over them use
  clip paths, as static SVG does.
- Firefox stops accelerating a canvas whose frames are mostly paths it has
  not drawn before and rasterizes it on the main thread, which makes a
  streamed tick of 15 lines of 3,000 points about four times slower. Since
  Firefox counts a solid fill as an ordinary draw, each frame ends with two
  transparent 1-pixel fills per path painted.

## Choosing a renderer

`renderer: "auto"` (the default) uses SVG until a scene has more than 4,000
drawn points (line vertices, bars, points, or heatmap cells, after level of
detail) and returns to SVG below 2,000; the gap prevents flapping while data
streams. SVG keeps small charts crisp, accessible, and free of canvas
backing stores, which dominate memory for many small charts. The count
depends on width, device pixel ratio, data shape, and series count: a dense
line at 800 px is under the threshold at DPR 1 and over it at DPR 2. The
thresholds have not been tuned with benchmarks.

The GPU is not a `renderer` value: point clouds and large 3D charts go to a
WebGL2 painter by size, inside Canvas or automatic rendering (see
[Points](#points) and [3D on the GPU](marks.md#3d-on-the-gpu)).

## Layers in the browser

Bottom to top: an optional canvas for marks; the SVG layer (grid and marks
when not on canvas, guides, axes, title, pointer overlay); the HTML legend;
the tooltip; visually hidden text for assistive technology.

- Pointer feedback touches only the overlay, so hovering never repaints
  data.
- Scheduled frames read no layout (which would force layout of the previous
  frame's DOM writes). The container is measured when a `ResizeObserver`
  reports a change, for the first frame (not at all when `width` and
  `height` are both given), and on explicit `render()` and `toSVG()`.
- Legend entries are rewritten only when what they show changes, and the
  assistive data summary only when data or options change, not on zoom.

## Paint order and picking

Every renderer paints a panel in one order (`scene/paint.ts`): its grid
batches (`GridBatch`, one per axis, at `grid: { zIndex }`, -1 by default)
and its geometry (at its mark's `zIndex`, 0 by default), lower first, ties
as listed, grid before geometry. The order is local to the panel, like a CSS
stacking context, and separate from clipping and from the logical order
the keyboard, descriptions, and tooltips keep.

- A panel has a paint plan (`Panel.paint`) only where `zIndex` values
  reorder it. Charts that give a `zIndex` load the plan with the guide
  compiler, so a line chart's first chunk carries only the shared walk
  (`eachPainted`).
- Panels paint one after another, each with its background and then its
  plan, so insets paint over their parents. The chart background is under
  every panel; plot borders, axes, and pointer overlays are over all.
- Rules, text, and labels have canvas painters, so a canvas paints the plan
  on one plane without a second backing store for annotations.

**Picking takes the topmost target.** Hover and clicks visit marks in paint
order and series in theirs; of equally near points, the one painted last
wins (opaque points paint color by color; `Mark.paintsOver` says which
paints over the other). Targets within a thousandth of a pixel of the
nearest count as equally near (`model/nearest.ts`), since points are placed
in 32-bit floats and lines in doubles. With a selection highlighted, its
rows paint over the rest and win ties. Overlapping bars are clicked as they
paint: by series, look by look, then by row.

## Points

Points are drawn per series into a packed coordinate buffer.

- **Opaque points** (a hex, `rgb()`, `hsl()`, or named fill at
  `fillOpacity` 1) fill as one path per series; translucent ones fill one by
  one so overlaps darken.
- **`sampling: "pixel"`**, above 4,096 points per series, draws opaque
  points whose centers share a device pixel once, through a reusable
  occupancy buffer.
- **Picking** uses a uniform grid index over the points drawn in the plot
  (two `Uint32Array`s), built on the first pointer query after a frame, per
  chart.
- **Domains** leave room for the radius: after rounding to nice values, the
  domain widens by the radius in pixels, and ticks are chosen in the
  rounded domain (choosing in the widened one could take a coarser step).
- **Points on category axes** sit at their bands' centers, always placed on
  the CPU (a GPU cloud uploads raw columns, and a category axis has none).
- **Encoded points** fill per-point arrays beside their coordinates: radii
  (`Float32Array`), color lookup indexes and symbol codes (bytes), and
  opacities. Opaque encoded points draw one path per color after a counting
  sort by color index. Symbols are polygons with the area of the circle of
  the same radius. Points without encodings keep the single-style fast
  paths.

### GPU point clouds

Point series of at least 100,000 visible points are drawn by the GPU in the
browser. The mark emits a **point cloud** instead of pixel coordinates:
references to its source columns, the axis mappings, and the table version.

- A WebGL2 painter loads with a dynamic `import()` the first time a scene
  holds a cloud. One WebGL context serves every chart on the page (browsers
  allow few); each cloud is drawn into a plot-sized canvas and copied into
  the chart's 2D canvas at its place in paint order.
- Each coordinate is normalized to [0, 1] over its axis' data range and
  split into a float32 and its float32 remainder (about 48 bits), so zooming
  and panning change only shader uniforms. Uploads take 16 bytes a point,
  belong to the charts that draw them, and are released when no longer
  drawn.
- **Streaming.** Clouds of whole columns are keyed by table and field pair
  (charts drawing the same columns share an upload) and carry `rowOffset`
  and `modifiedVersion`; clouds of a series' rows follow their group. The
  first change uploads with room for half again and a normalized range
  reaching half the span past each end; later appends and drops write only
  new points (`bufferSubData`) and draw from a later first point, until the
  buffers fill, a point falls outside the range, or the window shrinks
  under a quarter. Streaming 10,000 points per tick into a million-point
  window costs about 0.1 ms of JavaScript a frame (Chrome; GPU time not
  included).
- **CPU fallback.** The CPU places points when the GPU cannot represent them
  faithfully (a range that overflows, position error above a quarter pixel
  at the current zoom, points larger than the largest point sprite),
  without WebGL2, after a lost context, with `renderer: "svg"`, for points
  on broken time axes, and in `toSVG()` and `renderToSVG`. Picking always
  uses the CPU grid index. Until the painter loads, clouds are not drawn
  (`chart.loading` settles once they are).

## Heatmap rasters

Heatmaps and 2D histograms rasterize into an RGBA image (colors from a
lookup table) that renderers stretch over the cells in view: Canvas with
`drawImage`, SVG as an embedded PNG (the browser's canvas encodes it;
`renderToSVG` uses a small bundled encoder only server bundles include).
Placement is decided per frame along each axis
(`marks/heatmap-raster.ts`), in buffers kept between frames, one value per
band or cell, never per table row.

| Axes | Image |
| --- | --- |
| **Lattices** on both axes (bands, or cells one width apart) | A pixel per slot while slots fit the plot's device pixels (`rasterRatio`: the device ratio on screen, 2 for static SVG and PDF). With more slots, as many pixels as fit (each at least a device pixel, so nearest-neighbor drawing never skips a block's only hot cell): slot `s` of `n` lands in pixel `floor(s * pixels / n)`, and one pass accumulates each pixel's sum and count (or max or min with `sampling.reduce`). |
| **Spans** (uneven values, or a lattice reaching more than two plot lengths past the plot in a deep zoom) | The plot at device resolution; each cell is its projected edges, snapped within a millionth of a pixel. Painting goes cell by cell, adding each cell to the pixels it covers weighted by area, so a pixel within one cell shows that cell and a pixel across several their area-weighted mean. The image, sums, and last values take 20 bytes per device pixel. |

Sums are Float64; a block whose sum overflows is summed again scaled by
2^-64. The image and its placement are reused until the table, the band
order, the panel's rows, the scales, the plot, the raster ratio, the theme,
or the mark changes, so a legend toggle or brush neither places nor paints a
cell. Each zoom or pan paints again in one pass.

**Cell index.** Tooltips report the cell under the pointer even where its
pixel shows a block: the scale maps the pointer to a band, or the inverse
finds the cell whose span holds the value (binary search over edges), and a
cell index (`lod/cell-index.ts`) finds the row. The index is the series'
positions sorted by cell row and column with two counting sorts (taken as
they are when already in order), at most 4 bytes per row; a lookup is a
binary search. The keyboard steps through it the same way.

## Continuous and categorical color

Continuous color (heatmaps, points with a number `color`) maps values
through a 255-entry lookup table interpolated from the ramp's stops: odd, so
a diverging midpoint has an exact middle entry, and under 256, so a point's
color is one byte. With a midpoint, each side maps onto its half. Named
schemes are separate exports; only the spec loader holds the table of
names, so TypeScript charts bundle only the schemes they import. Ramps are
`#rgb` or `#rrggbb`, checked when the mark or theme is made.

Category fields encoding a point's `symbol` or `color` take places in a
cycle in order of first appearance (`marks/appearance.ts`). A value keeps
its place while it stays in the table, though compaction renumbers codes,
so a streaming chart's points do not change shape or color.

## Scheduling

All charts share one `requestAnimationFrame` loop. Table changes, resizes,
option updates, and pointer moves mark a chart dirty; the next frame
renders each dirty chart once, however many changes arrived. Charts outside
the viewport (IntersectionObserver) stay dirty and render when visible. A
chart's first frame renders synchronously when it is created.

Charts that share an `interaction.sync` name share the cursor and viewport
through the same loop (see [Sync](interaction.md#sync-channels)).

## Animated views

With `animation`, a view asked for (`setViewport`, zooming to a brush,
double-click reset, a map's or network's plane) is shown gradually by
`dom/transition.ts`, which loads the first time options ask for animation.

- The model takes the new view at once and the `viewport` event reports it
  once. The transition plans its end by building, but never painting, the
  scene of the new view, so it includes nice rounding and glyph room.
- Each frame sets the model's transition domains, eased (in log space on
  log axes). Every frame is an ordinary scene, so tooltips and brushes read
  what is on screen. Intermediate frames keep the new view's margins, so
  passing tick labels never move the plot.
- Anything that must show at once ends the transition: table changes,
  resizes, option updates, legend toggles, wheel zoom and panning, presses,
  `render()`, and export. Charts with several panels, linked charts, and
  pages preferring reduced motion skip it.
- **Frame budget.** Costs are estimated from earlier frames' JavaScript
  time (a chart's first frame counts as none, since it measures text and
  compiles once). Transitions starting in one scheduler frame form a batch,
  which jumps when twice its charts' last frame times exceed 10 ms; a
  playing transition ends once its chart's frame, or the scheduler's whole
  frame, takes over 10 ms.

## Animated values

With `animation: { values: true }`, `dom/value-transition.ts` (with
`value-motion.ts`, `value-points.ts`, `value-traces.ts`, `value-items.ts`)
also moves marks to changed values, and their axes. It loads separately.
The data is current at once; what moves is a picture of the change.

**Identity.** Scenes of such charts carry what identifies each item: bars
(`BarItems`: position and pixel root and tip), points (`PointItems`: the
table generation and row identity, or an `itemKey` field's values),
pie slices (`PieSlices`), and gauge dials (`GaugeDial`). Traced polylines
say whether they are `whole` (every row traced). Panels keep their axis
plans (`PanelPlans`). The lazy module imports no engine code; the chart
hands it `planAxis`, `Polyline`, and `monotonePolyline`, since esbuild would
otherwise split shared modules into chunks that compress worse.

**Snapshot and match.** When a table reports values changed in place or a
reset, the chart copies, in pixels, the frame's bars, slices, points, whole
lines and areas, rules, lists drawn in row order (error bars, candles,
regions, annotations), and rasters, with each panel's scales, because the
model reuses geometry buffers and the table has already changed. The next
frame builds the new scene once and matches:

| Item | Matched by |
| --- | --- |
| Bars | Series key and position (a series repeating a position shows at once) |
| Points | Series key and row identity within one generation, or equal explicit keys (numbers without coercion, labels as strings, times numerically; missing or duplicate keys show at once) |
| Lines, areas | Series key, when both scenes trace the same position pixels in the same runs |
| Lists | Geometry key, when both draw as many items at the same places along one axis |
| Rasters | The same grid in the same place; colors move in RGB |
| Rules, slices | Key (slices in one order merging both pies') |

**Moving scales.** A scale both scenes draw with the same type and range
(and unchanged bands and breaks) moves its domain evenly in mapped terms.
Something at `p0` before and `p1` after is drawn at
`r0 + a(p0 - r0) + b(p1 - r0)`, with `a = (1 - t) S0 / S(t)` and
`b = t S1 / S(t)` (`S` the domains' spans, `r0` the range's start): the
value between, placed by the scale between, without reading data. Axes
are planned anew each frame with `planAxis`, so ticks are those the chart
would choose for that domain. Bars move roots and tips (a bar changing sign
shrinks to the baseline and grows past it); slices move widths, so they
always make a whole turn; points move centers, radii, opacities, and ramp
positions, growing from or shrinking to nothing as they appear or go;
monotone curves are curved again each frame (stacks jointly). A mark's
areas, or a series' pieces, move together or not at all.

**When a change shows at once.** Different panels, theme, or series; a scale
that cannot move while geometry in its panel cannot follow; appended or
dropped rows; row view changes; changes until the data has been still for
a change's duration (so streaming never animates forever); charts that are
inspected, off screen, linked, with a navigator, or slow; endpoint scenes
over 2,000 bars, slices, and rules, 10,000 points, or 10,000 points of lines
and areas, or holding a point cloud. One transition plays at a time; input
settles values first.

Marks that cannot move to changed values (box plots, boxen, violins, rugs,
contours, dendrograms, custom marks, layout marks other than pies and
gauges) refuse `animation.values` as they draw (`marks/still.ts`, a
`ChartError` with code `unsupported`, path `animation.values`): a check in
the model would put code in every chart's first chunk.

**Cost.** Preparing a change takes about 0.03 ms for 100 bars, 0.2–0.3 ms
for 2,000, 0.1 ms for 1,000 points, 0.9 ms for 10,000, and 0.02 ms for a
2,000-point line (Node). Each later frame takes about 0.2–0.7 ms of
JavaScript for 10 to 2,000 bars, 0.3–0.9 ms for 5 to 100 slices, 0.2–0.6 ms
for 1,000 points, and 0.5–0.6 ms for 10,000 on a canvas (headless Chrome,
Apple M6, DPR 1), about what the change costs drawn at once. The limits come
from these measurements: 10,000 points take less JavaScript a frame than the
change drawn at once. Copies and frame buffers hold about 40 bytes a point
(56 with sizes), 28 a point of a line, and 76 a bar, released when the
change ends; marks bound each series before keeping anything for it.
