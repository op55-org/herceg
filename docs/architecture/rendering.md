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

**Picking takes the nearest target above the first fill under the
pointer.** The picker ([Interaction](interaction.md#picking)) visits the
frame's records in paint order, the last painted first, and the inspection's `"nearest"`
mode visits marks in paint order and series in theirs; of equally near
points, the one painted last wins (opaque points paint color by color; `Mark.paintsOver` says which
paints over the other). Targets within a thousandth of a pixel of the
nearest count as equally near (`model/nearest.ts`), since points are placed
in 32-bit floats and lines in doubles. With a selection highlighted, its
rows paint over the rest and win ties: a line mark's selected parts over
every series' dimmed ones, as marks of a glyph per row draw theirs
(`litOverSeries`); an area's over its own layer, a stack keeping its
order. A line drawn whole and dimmed with copies of its selected values
over it (x not ascending) moves with them, since a translucent copy
shows its color only straight over its own dimmed line. Overlapping bars are clicked as they
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
- Each frame sets the model's transition domains, eased by the chart's
  `easing` (d3's cubic-out, linear, and cubic-in-out curves, which value
  transitions and drills move by too), in log space on log axes. Every
  frame is an ordinary scene, so tooltips and brushes read what is on
  screen. Intermediate frames keep the new view's margins, so passing tick
  labels never move the plot.
- The types, the spec's validator, and Python refuse other easings. Given
  one from JavaScript, `ViewAnimation.easing` moves by cubic-out and tells
  of it once per `animation` option, as it loads and as options change:
  a `ChartError` (code `invalid-option`, path `animation.easing`, phase
  `validate`) to `onError`, "error" listeners, or the console, which
  neither keeps the chart from drawing nor fails `ready`.
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
`value-motion.ts` for scales, `value-bars.ts`, `value-labels.ts`,
`value-sectors.ts`, `value-points.ts`, `value-traces.ts`, and
`value-items.ts`) also moves marks to changed values, and their axes. It
loads separately. What moves custom marks (`value-custom.ts`) loads apart
again, only for charts with custom marks: value transitions load it as
they load, or once custom marks come, so it arrives a request after them.
`chart.loading` waits for both. Until they load, and until view
transitions (`dom/transition.ts`), whose easing values move by, have
loaded, changes show at once. The data is current at once; what moves is
a picture of the change.

**Identity.** Scenes of such charts (`frame.keyed`) carry what names each
item: bars (`BarItems`: each bar's name, its pixel root and tip, and for
bars keyed by `itemKey` where the position axis ends), points
(`PointItems`: the table generation and row identity, or an `itemKey`
field's values), labels (`LabelItems`: each label's name, the bar series
it belongs to, and the number it writes, with how to write another), a
sunburst's sectors (`SunburstSectors`: the nodes drawn, with the mark's
own arrays of angles, depths, and paint, each node's label as drawn, and
where the sunburst is drawn), pie slices (`PieSlices`), gauge dials
(`GaugeDial`), and custom marks' shapes (`CustomRedraw`: the mark, its
fields, table, and the table's version drawn, the rows its series hold
and how many, and how it draws the panel again over other values on
other scales). Marks record only what drawing knows (names, the numbers
labels show, where their text starts, labels' places); the lazy module
makes sectors of a sunburst's nodes and draws, lists, and picks its
frames. A name is the `itemKey` value, else a bar's position value (a
category's name, not its band) or a text row's identity; a missing one
is NAMELESS and the row's identity, which matches only within one table
generation (`marks/item-names.ts`). Traced polylines say whether they are
`whole` (every row traced). Panels keep their axis plans (`PanelPlans`).
Custom marks' shapes are their `draw`'s and do not interpolate, so the
chart keeps their data instead: after each scene it shows that is not a
frame between, `keepCustom` copies the fields each custom mark declares
(number and time `x`, `y`, and `encode` fields; the key and the series
and category fields as codes and names), by row, once per source table,
for tables of at most 2,000 rows drawn at their current version, and none
past the frame budget. A copy is reused while its table keeps its version,
its rows where they were, and no replaced value waiting in a transaction
(whose writes leave the version as it was until it ends); a table grown
past 2,000 rows since shows its change at once. Value transitions reach custom marks' motion at
four points, importing only its types: keeping (`keepCustom`), planning
(`ShownCustom.plan`), frames (`CustomFrames.at`), and moving on from a
frame (`CustomMotion.shown`). The lazy module imports no engine code; the
chart hands it `planAxis`, `Polyline`, and `monotonePolyline`, and a
sunburst's record the arc and label code its frames need (`SunburstKit`),
since esbuild would otherwise split shared modules into chunks that
compress worse.

**Snapshot and match.** When a table reports values changed in place or a
reset, the chart copies, in pixels, what is on screen that can move, with
each panel's scales, because the model reuses geometry buffers and the
table has already changed. The next frame builds the new scene once and
matches:

| Item | Matched by |
| --- | --- |
| Bars | Name within their series' geometry; a bar whose series changes leaves one and enters the other |
| Labels | Name, within a text mark's labels or a bar series' value labels across their groups |
| Points | Row identity within one generation, or equal explicit keys (numbers without coercion, labels as strings, times numerically), within their series |
| Sunburst sectors | Item key (the path from the top) |
| Lines, areas | Series key, when both scenes trace the same position pixels in the same runs |
| Lists | Geometry key, when both draw as many items at the same places along one axis |
| Rasters | The same grid in the same place; colors move in RGB |
| Rules, slices | Key (slices in one order merging both pies') |
| Custom marks' rows | `itemKey`, else row identity within one generation, among the rows the mark drew; drawn in the same panel, of the same series and categories (the category fields of `x`, `y`, and `encode`), with every declared value finite at both ends |

A name shared by items at either end matches nothing: those items show at
once, placed on the frame's scales, and the rest of their series moves. So
do points whose key is missing (their ids hold key values only).

**Moving scales.** A scale both scenes draw with the same type and range
(and unchanged bands and breaks) moves its domain evenly in mapped terms.
Something at `p0` before and `p1` after is drawn at
`r0 + a(p0 - r0) + b(p1 - r0)`, with `a = (1 - t) S0 / S(t)` and
`b = t S1 / S(t)` (`S` the domains' spans, `r0` the range's start): the
value between, placed by the scale between, without reading data. Axes
are planned anew each frame with `planAxis`, so ticks are those the chart
would choose for that domain. A band scale whose categories are the same
set in another order stays still: bars on it move in pixels, and its
ticks move from their categories' old places (a category the axis did
not label before, as it thins its labels, from its band). Bars move their
places along the position axis, roots, and tips (a bar changing sign
shrinks to the baseline and grows past it); slices move widths, so they
always make a whole turn; points move centers, radii, opacities, and ramp
positions; monotone curves are curved again each frame (stacks jointly).
A custom mark's frames call its `draw` again (`CustomRedraw.draw`) over a
`MovingTable`, a `ReadonlyTable` whose declared fields read their values
between from buffers of the mark's own (evenly in log space for fields on
log axes in every panel drawing the mark), on the frame's scales; channels
through scales read those values (their readers kept apart for each frame
table, so they go when the transition ends), others the new ones. Its rows
that cannot move take their new values; frames record their shapes' items
but not the shapes input reads, which stay the new scene's.
A mark's areas, or a series' pieces, move together or not at all.

**Coming and going.** Bars named by position grow from their root and
shrink to it; bars keyed by `itemKey` slide in from past the end of their
position axis and out past it (the end where its domain's last value is
drawn, so reversed ranges are respected), clipped by the plot. Points grow
from and shrink to nothing. A bar's value label comes and goes with its
bar, keeping its place on it (between root and tip, or past the tip), cut
to the plot as scenes leave out labels outside it; one moving inside or
outside its bar keeps where its text starts (`LabelItems.starts`); a
text mark's label without a match shows or goes at once (labels are not
attached to other marks' items by equal names). Labels writing a
finite number at both ends write the values between through their own
format each frame, measured again. A sunburst's sectors move their angles
and depths; radii follow depths through each frame's shape (the center
disc is depth 0 to 1): its center, outer radius, middle, and ring width,
between the two scenes' (breadcrumbs coming or going move it). Through a
drill, the new root's old sector (drilling in) or the old root's new
sector (drilling out) maps every sector of either scene into the other's
partition, so siblings squeeze to the edges; otherwise a sector coming starts at the outer edge of its
nearest ancestor drawn in both, and one going ends there. Angles and
depths stay unclamped in frames and are clamped as drawn, in one order,
which picking follows. Labels drawn at one end only fade, a sector shown
nowhere (past the turn's end) shows none, and a label turns between along
the radius and level as its sector takes or leaves the middle.

**Retargeting.** Frames keep the records scenes do (names, roots and tips,
point keys, label numbers, sectors) in buffers of their own, and each
category's place along axes whose categories change order; custom marks'
frames keep their values, with the new scene's keys, categories, and
rows drawn, copied as the transition starts. A change
arriving while values move copies the frame on screen once, with its
scales as it drew them (`panelsAt`), and the next scene moves from that
copy: positions stay continuous, speeds do not. At most one transition and
one copy exist. There is no timing threshold, since timing cannot tell a
stream of values from keyframes.

**Drills.** A sunburst's drill root changing calls `model.drilled` before
the state changes, which copies what is drawn; `dom/drill.ts` announces
the drill once the first frame draws. While a drill plays the pointer and
clicks do not stop it: `ItemViews.transitionItems` holds each frame's
`PanelItems.pick`, which picking and inspection read, giving the sector
drawn under the pointer as its own scene describes it, pointed at and
outlined where the frame draws it, and decorations as the frame draws
them. Sectors leaving are items while drawn, standing for the rows (and
tooltip fields) the layout before the drill gave them, and a click on one
drills into it as the whole tree has it. `getItems` and decorations
placed by items (`PanelItems.decorate`) read a pie's or sunburst's frame.

**Input.** In charts along axes, input that picks or inspects draws the
new values first, then reads the frame on screen; no map from destination
geometry to frame geometry is kept. A pointer over a chart with
`inspection: false` and no hover listener reads nothing and lets values
move. Static SVG, PNG, and PDF draw the destination.

**When a change shows at once.** Different panels or theme; series coming
or going other than bars'; a scale that cannot move while geometry in its
panel cannot follow; a band scale gaining or losing categories; lines,
areas, lists, rasters, and custom marks over categories that change order;
appended or dropped rows; a row view's own changes (a view telling of its
table's write is left to the table's own report, which says what changed);
changes until the data has been still for a change's duration after those
(so streaming never animates forever); charts that are read by the pointer
or keyboard, off screen, linked, with a navigator, or slow; frames over
2,000 bars, slices, sectors, rules, and custom marks' rows, 10,000 points
(both counting items going), or 10,000 points of lines and areas, or
holding a point cloud. Marks keep no records for a series over those; a
sunburst's record holds only arrays the mark keeps anyway, and no sectors
are made of one over them.

Marks that cannot move to changed values (box plots, boxen, violins, rugs,
contours, dendrograms, layout marks other than pies, sunbursts, and
gauges) refuse `animation.values` as they draw
(`marks/still.ts`, a `ChartError` with code `unsupported`, path
`animation.values`): a check in the model would put code in every chart's
first chunk.

**Cost.** Preparing a change (copying and matching) takes about 0.04 ms
for 100 bars, 0.2 ms for 2,000, 0.07 ms for 100 bars changing order on a
category axis, 0.03 ms for a 40-bar race with 40 labels, 0.06 ms for 1,000
keyed points, 0.7 ms for 10,000, 0.17 ms for a 240-leaf sunburst, and
0.12 ms for its drill, which make both scenes' sectors (Node). In headless Chrome (Apple M6, DPR 1, an
800×500 chart) each later frame takes about 0.6 ms of JavaScript for 100
bars, 2.8 ms for 2,000, 1.1 ms for 100 bars changing order, 0.7 ms for
the race, 0.7 ms for 1,000 points and 2.5 ms for 10,000 on a canvas, and
1.9 ms for the sunburst; the first frame, which builds the new scene too,
takes about 1 to 3 ms more than drawing the change at once. The limits
come from these measurements. Copies hold about 25 bytes a bar and 16 a
point; a transition's buffers and frame records about 67 a bar, 32 a
point, and with value labels about 150 a bar, released when the change
ends (a retarget holds one copy and one transition).

Custom marks (A2's comets, Node) cost more a frame, since each frame runs
their `draw`: keeping their fields after a scene takes about 0.008 ms for
300 comets and 0.01 ms for 2,000 on two numeric axes; preparing a change
0.15 and 0.3 ms; a frame 0.25 and 1.8 ms, a little less than an
application's own frame takes that writes the values between and builds a
scene (0.44 and 1.9 ms). Copies hold 8 bytes a row for
each declared number field and 4 for the key and each category field (40
bytes a row for A2's comets, 56 on two numeric axes); a transition adds 8
a row for each moving field and 4 for the row matched, the key, and each
category field (44 and 60), released when it ends.
