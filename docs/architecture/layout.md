# Layout architecture

How a chart lays out its panels, scales, and guides, how themes and styles
resolve, and how facets, subplots, insets, time breaks, and the range
navigator fit in. For using them, see the [layout](../guide/layout.md) and
[axes](../guide/axes-and-legends.md) guides.

- [Scale instances](#scale-instances)
- [Positions and padding](#positions-and-padding)
- [Chart layout](#chart-layout)
- [Guides as scene items](#guides-as-scene-items)
- [The guide compiler](#the-guide-compiler)
- [Legends and visibility](#legends-and-visibility)
- [Panel layouts](#panel-layouts)
- [Small multiples](#small-multiples)
- [Layouts of panels](#layouts-of-panels)
- [Categories per panel](#categories-per-panel)
- [Layout marks in panels](#layout-marks-in-panels)
- [Two y axes](#two-y-axes)
- [Clipping](#clipping)
- [Text](#text)
- [Themes and styles](#themes-and-styles)
- [What every chart's bundle carries](#what-every-charts-bundle-carries)
- [Time axis breaks](#time-axis-breaks)
- [Range navigator](#range-navigator)

## Scale instances

The chart's `x`, `y`, and `yRight` are named scales with their axes. A
scale's `scope` says which panels share one **instance** of it
(`model/scales.ts`, `scopesOf`). A shared instance owns its domain,
categories, transform, and viewport; each panel owns its projection onto
its plot's pixels. Panel membership comes first, then each instance's type
(band, time, or linear) is inferred from the marks its panels draw
(`instanceType`), so one subplot can have a category axis and another a
number axis; one instance holding both is refused with the panels named
(`mixedPanels`). An instance with no marks takes band when other instances
of its scale are bands, so empty subplots draw no stray grid lines.

## Positions and padding

`Coordinate` (`spec/place.ts`) is a place along one axis: `data`, `field`,
`fraction` (0 at the left or bottom), or `px` (from the left or top), each
with a pixel `offset`, in the plot's or the chart's frame. Only `data` and
`field` count toward domains. `layout/position.ts` resolves them
(`coordinateAt`, `positionAt`) against a context the caller provides, so
the resolver knows no scale types. Categories are placed by value, never
by code.

Marks of rows take the same forms per row (`bindRows`,
`marks/row-bindings.ts`). The feature compiler draws each such mark in a
frame of its own (`boundFrame`, `marks/features/positions.ts`), running
over the plot's pixels, so tracing, culling, indexing, and inspection read
moved rows as any frame's. Directions placed off their axis count toward
no domain. Position scales of the chart's own (`guides/positions.ts`) have
a domain per instance from what marks draw on them, cached by mark, table
version, and shown series; nothing zooms them.

**Padding** is room between data and the plot's edges: `"auto"` leaves room
for what marks draw past their values (glyphs, `Mark.inset`; bar labels,
`Mark.headroom`), solved once for the plot's size (`clearDomain`,
`model/clearance.ts`); a share widens the domain in transformed space;
`{ px }` keeps pixels. What reads a drawn range back as a view (gestures,
the navigator, `edge` events) takes the padding off through
`model/view-padding.ts`. **y fits the x data window**: the rows whose x
values are in x's view or domain, before padding and offsets, so y depends
on no layout and every scene lays out once.

## Chart layout

What stands outside the plots asks for room along a side: a `TrackRequest`
(`layout/tracks.ts`) names who asks, the side, its thickness, and the gap
after it, and `stackTracks` stacks each side's requests inward from the
edge. `model.#furniture` makes the title's and legends' requests
(`Furniture`).

- Without `padding`, edges are the automatic spacing; with it, edges are
  that whitespace. Tick lengths and label gaps stay in both.
- A legend's place is a side (`SidePlace`) or inside a plot
  (`InsidePlace`). Legends above or below wrap in rows
  (`model/legend.ts`, `measureLegends`); inside legends take no room.
- Axis room, tick planning, and widening margins for labels at the plot's
  ends are monotonic passes bounded by a quarter of the chart's width.
  Margins grow freely but shrink only on resizes and option changes, so
  streaming data does not move the plot back and forth.
- Marks labelling outside their plots ask for room (`Mark.room`), the
  widest per side a track of its own, innermost (`Frame.outside`). Marks
  that measure as they place (`Mark.roomPlaced`) report after drawing; if a
  panel needs more than kept, the scene is laid out once more.
- Text measurement is injected: the browser measures with a canvas context;
  static rendering uses built-in Helvetica metrics (0.6 em per glyph for
  monospace fonts) padded by 10%, or supplied fonts (see
  [Fonts](export.md#fonts)).

## Guides as scene items

Guides are positioned scene items (`scene/scene.ts`): `AxisGuide`,
`TitleGuide`, `HeaderGuide` (panel titles, facet headers), `LegendGuide`,
`RampGuide`, `KeyGuide`, `ColorbarGuide`, `CaptionGuide`, each with `items`
of five kinds: text, segments, shapes, rectangles, and ramps. Every
renderer draws the items as they are (`render/svg.ts` `itemsMarkup`, PDF
`paintItems`, the live SVG layer); none computes a position or placement.

- An axis guide keeps its placement (`AxisPlacement`) and ticks, and
  `axisItems` (`model/axis-guide.ts`) turns them into items, so value
  transitions can plan ticks between two scenes: a guide holds data, never
  a closure.
- Text in a box is placed by its box: the box's edge goes where the text's
  own would, and the text moves in by its padding.
- The HTML legend reads the legend guide's entries and draws buttons; the
  guide's items, which only static output draws, are built when first read.
- Paint order: backgrounds, grid lines, each panel's data cut to its plot,
  then data not cut and guide drawings, then axes, plot borders, and the
  chart's guides.

## The guide compiler

`scales` merges into the short forms before anything reads a
configuration. What only some charts need is the **guide compiler**
(`guides/`), which loads with them: `needsGuides` (`model/guides.ts`, in
every bundle) says whether a configuration asks for it (ticks other than a
count, formats other than Intl options, `scales`, `guides`, legend settings
beyond `place` and `style`, or `zIndex`).

- A live chart imports it before drawing such a configuration: the first
  frame waits, exports refuse with "await chart.loading", updates keep the
  last frame. `renderToSVG`, PDF, the spec loader, and the Python bundle
  import it statically and pass it to the model. No global registry decides
  what is loaded.
- It imports only types from the chart's modules; what it uses is handed in
  as `GUIDE_KIT`. A module imported by both would split into a chunk of its
  own, which compresses worse; `test/architecture.test.ts` enforces this.
- `compile(config)` gives the model the configuration as it reads it (a
  listed axis on its default side folded into its short form), axis
  contexts with `plan` and `formatValue`, `axes` (room across and beside the
  plots, label ends, `fits`, each panel's axes), and `legends`.
- **Ticks** (`guides/ticks.ts`) are counts, steps (numbers from an anchor;
  calendar steps at the same places whatever the view; elapsed
  milliseconds), values, or functions. Steps closer than two pixels give way
  to coarser ones on the same boundaries, generated directly, so work
  follows ticks drawn. Formats are Intl options, patterns
  (`format/patterns.ts`: d3-format and strftime subsets, compiled once), or
  functions. A tick is its value, never its text (`writtenTicks` in
  `model/axis.ts`): where a format writes neighbors alike, a coarser step
  it tells apart takes their place, and a label still repeating the one
  before is left blank, its tick and grid line kept.
- **Listed axes** (`guides/axes.ts`) have layers ("major" first), each with
  tick marks, labels (rows, rotation, collision, priority, duplicates), and
  styles. Rotation tries candidates until neighbors' boxes do not overlap;
  "hide" keeps every n-th label for the least n that clears. Labels may go
  inside the plot (`inside`), giving back the room outside. Axes whose tick
  labels align by style are drawn as listed axes.
- **Colorbars** (`guides/colorbars.ts`) draw a mark's ramp or a contour's
  bands, with ticks planned as an axis' along the bar.

## Legends and visibility

**Legends** (`guides/legends.ts`) show what their `include` names: a scale
of categories, a mark's scale (`{ mark, channel }`), or a mark whole.
Listed legends claim what they include, colorbars their ramps, and the
automatic legend shows the rest. What a mark owns comes of its options, not
its rows (`Mark.legendScales`), so a reference to a scale a mark does not
declare is an error naming those it has. Entries are identities: the series
of every mark and panel standing for one value are one entry; labels alone
never merge entries. `swatches: "mark"` draws each entry from its marks'
settings (`SeriesFeatures.swatch`, else `sampleOf`). Custom entries target
marks, field values, or scale values (`LegendTarget`); entries that target
nothing are captions.

**Hidden keys overlap**: a series is hidden where any key naming it is (its
own, its identity's, its mark's whole key, a predicate over its rows).
Within a panel, its legend's settings win by how much a key names, then
the chart's (`HiddenKeys.hiddenIn`). Entries report what they name as
drawn (`guides/visibility.ts`): hidden, mixed (`aria-pressed="mixed"`), or
shown, and showing an entry lets go of everything still hiding any of it
(`LegendItem.shows`). Rows hidden by value are counted in one pass per
field for every value a legend names. A layout mark hidden whole keeps its
view and state and draws nothing (`hiddenWhole`).

## Panel layouts

A `PanelLayout` (`model/panel-layout.ts`) is what the model reads: a facet
or a `Panels`, each loaded only with charts that use it. Where panels go is
its `placement`: a facet's uniform grid (`model/uniform-grid.ts`) or
subplots' cells (`model/cells.ts`); a chart of one panel places itself.

- Each panel gets a frame whose scales are the shared plans moved to its
  row and column, with buffer pools of its own, so geometry code is the
  same as for one panel; each has its own inspector, and the chart routes
  the pointer to the panel under it.
- **Scale groups.** `PanelLayout.groups` groups panels per scale by scope;
  each group is planned as the single shared scale is (extent, view, nice,
  headroom, ticks, formatter), over the common plot width. A y extent reads
  each panel's series within that panel's x domain (`PanelLayout.across`),
  so a shared y follows every panel's own x view.
- **Views per instance.** An instance whose panels change (a new facet value
  wraps the panels anew) is a new one and fits its data; gestures act on
  the instances of the panel they start in. A chart keeps one selection,
  owned by the instances its brush ran along, cleared once they are not
  drawn.
- **Keyboard.** Left and Right step through a stop's points along its axis
  (`stepPoint`, `model/keyboard.ts`); Up and Down carry the cursor's value
  between panels sharing the scale, or its place across the plot.
- **Python** live widgets take the same view changes
  (`viewportEventPayload`) and restore them per panel
  (`restoreViewportState`).

## Small multiples

A facet draws a panel per value (or pair of values) in order of first
appearance; headers are scene text (`Scene.headers`), so every renderer
draws them.

- **Row-aligned marks** (lines, points, bands, unstacked bars, error bars,
  candlesticks) split after series resolve: the same columns read through a
  list of each panel's rows (4 bytes per row, computed in two passes, kept
  until the table changes). Series keep their keys, so colors, legend
  entries, and hidden state are shared.
- **Stacked bars and areas** resolve unstacked, then stack per panel
  (`stackPanels`) into shared table-sized arrays the panels' disjoint rows
  fill.
- **Summaries** (histograms, box plots, boxen, violins, contours) split
  before they combine: the splitter hands each panel its rows
  (`Mark.summarizePanels`, one partition per table version) with the x
  group of each panel, so a histogram bins per x group and counts each
  panel in one pass. Every panel lists every series, absent ones empty, so
  slots and keyboard stops agree.
- **Annotations over a table** get each panel's rows from the same
  partition (`RowParts`), and groups sharing a scale read their panels'
  parts without copying.
- **Subplots** take the same path, routing whole marks: every panel's list
  holds every mark in chart order, with series only where the mark's
  `panel` names it, so identities stay the chart's.

Fifty panels of two lines over 100,000 rows take about 1.6 ms a scene;
a rule, region, and label per row of 100,000 rows in 50 panels about 55 ms,
as one panel of the same rows does (Node).

## Layouts of panels

A chart's `layout` is a tree of grids of row and column tracks whose cells
hold panels or grids, and panels holding insets.

- `layout/compile.ts` checks it (overlapping cells, panels placed twice or
  nowhere, indexes past the tracks, each a `ChartError` at its path) and
  flattens it into reading and drawing order, each panel with its chain of
  footprints. Scopes are groups over that order (`scopeGroups`).
- `layout/grid.ts` sizes one axis at a time: tracks size **plots**, so each
  track's room before and after its plots is the most any cell on it needs;
  spanning cells span gaps; fixed tracks keep pixels; flexible ones share
  the rest by weight, none under its least size. A layout that does not fit
  returns the length it needs, reported as a `layout` error.
- `model/cells.ts` asks the model's measured needs per panel, places the
  plots, and places insets in their parents' plots (`layout/insets.ts`).
- **Insets** are panels with a `cover` that must stay inside the parent's
  plot. A parent with insets has `visible` rectangles and grid spans that
  keep clear of the boxes. Renderers draw the scene's `layers`: cells, then
  each inset over the chart's background. A parent's data, brushes, and
  hover marks are clipped to its visible rectangles; what it draws beyond
  them to the chart less the boxes (`keepPath`, even-odd). The pointer finds
  the topmost panel (`ChartModel.coveredAt`).
- **Panels' legends** list what their panel draws (`PanelLegends`,
  `model/panel-legends.ts`); a legend above a panel wraps at the width the
  last scene of the same layout used, and the scene is laid out again (at
  most twice) when it is wider than its plot.

All of this loads with `panels`; a chart without subplots carries hooks
only.

## Categories per panel

With a `scope` other than `"chart"` on a category axis, each group of
panels holds only the chart's bands that its rows hold, in the chart's
order. Series keep chart band indices; `PanelBands` finds each panel's
bands (a pass per row list, cached), unions them per group, and gives each
group **places**: where each chart band is among the group's. A group
holding the chart's first bands needs none; one spanning at most 4,096
chart bands (or eight times its own) uses an `Int32Array`; others search
their sorted bands, so places take at most 16 KiB or 32 bytes per band
held, never a table-sized array per panel. Panels' series are shallow
copies carrying places (`Series.places`); readers go through `placeAt` and
`valueAt`. A group's key changes with its bands, so selections on it clear
when they change. Synced charts and brushes along y of such categories are
refused.

## Layout marks in panels

`checkLayouts` owns the rules: with a facet, a layout mark is the chart's
only mark and splits its rows (a map's layers each split or repeat); with
subplots, it names one panel, which takes no axis settings and no other
mark. 3D marks refuse facets. `ItemViews.interactions` checks
`interaction` against what the layout marks take.

- The splitter marks such panels (`PanelSplit.items`); they get no axes,
  grid, or inspector, nor any part in scales. `model.allPanels()` lists
  every panel for `getPanels`, the keyboard, and the pointer.
- Each layout mark caches its work per table version and row list
  (`RowsCache`), so 50 panels keep 50 sets of sums. Trees keep each panel's
  part as a tree of its own (`pruneHierarchy`). Items keep their keys in
  every panel, so palettes and hidden keys apply everywhere.
- **Drilling** draws the subtree as a tree of its own (`subtreeOf`) whose
  nodes keep their whole-tree keys (`TreeView.prefix`) and colors. The path
  is two text geometries; the controls lay native buttons over each step's
  box. A treemap of 10,000 leaves drills in about 1.5 ms a frame.
- **Maps in panels** project at a scale level even when fitted, so panels of
  one size share one cached projection. **Networks** in facet panels share
  one layout, placed once per room size and moved to each room.
- **State** (`ItemViews`): a tree's drill root, a plane's view, and moved
  nodes, keyed `""` for facets or a chart of one layout mark, and by id for
  subplots. Methods resolve `{ panel }` to a state; without one, the chart's
  one state, or an error naming the panels. `ItemViews` loads only through
  layout marks.
- Fifty pies over 100,000 rows take about 1.4 ms for the first scene and
  0.2 ms to redraw; 50 treemaps of 2,000 leaves each keep about 11 MB of
  typed arrays, each panel's part rather than the whole tree 50 times.

## Two y axes

A mark's spec names its y axis (`axis: "right"`). The model computes each
side's domain from its own marks, plans ticks and margins per side, and
gives every mark a frame whose `y` is its side's scale, so geometry,
picking, and custom marks do not know their side. Tooltips format values
with each mark's axis; `"nearest-y"` compares values within one axis.
Marks inspected along y stay on the left; the model refuses them on the
right. An axis is shown when one of its marks places values along y,
whatever the data or hidden series, so the layout stays put. In panels,
the right side is planned by the same planner (`PanelLayout.groups`
filters by side); a y zoom moves both axes of the panel through the same
pixels.

## Clipping

A mark's `clip` (`"plot"`, `"chart"`, `false`) is copied onto each of its
geometries (`Geometry.clip`, read through `clipOf`). Every renderer draws
data cut to the plot first, then the rest above it: SVG with clip paths
(the chart's made only when used), canvas outside its plot clip, PDF per
box. Turning the clip off does not grow the chart.

## Text

`layout/text.ts` measures and lays out guide text. Measurers
(`MeasureText`: the canvas's, Helvetica estimates, the PDF standard fonts',
or [supplied fonts'](export.md#fonts)) measure multi-line text by its
widest line.

- **Lines.** `"\n"` breaks a label into lines, kept whole until drawn: SVG
  writes `tspan`s at absolute positions and PDF a run per line, so a line
  break never reaches a font's shaper. `textLines`, `textBox`, and
  `textItem` measure lines and make a guide's text item with its halo and
  box.
- **When.** Text is measured only for a box or a break, never on pointer
  movement. Titles, legends, headers, axis titles, and category labels
  reserve room for their lines; automatic number and time labels are one
  line; layout marks shorten names to one line (`oneLineText`).
- **Direction.** SVG layers, static SVG, snapshots, the canvas, and the
  legend are `direction: ltr`, since an SVG or canvas otherwise takes the
  page's direction and swaps `text-anchor` start and end. Right-to-left
  text keeps its own order within a label.
- **Blocks.** Text placed at a point is a block (`anchorBlock` in
  `layout/block.ts`): aligned by `align` along its lines and
  `verticalAlign` across them, then turned about the point. Text marks,
  rule and region labels with `verticalAlign`, aligned tick labels, and
  series labels are placed so.

**Labels following series.** Lines' and areas' `labels`, and text marks
with `from: { mark, at, edge }`, put a label per drawn series at its first
or last drawn observation, or where its edge enters or leaves the plot
(`visible-start`, `visible-end`; `marks/features/attach.ts`). The owner of
each point is as drawn: traces record which observation each edge point
is (`TracedEdge`), so a step's hold reads the row whose value it holds.
Where a series field's stack hides which row stands at a view's edge,
labels writing a field are refused (`checkOwners`). Content is a list of
parts (`writeContent`, `marks/features/content.ts`): text, `{ field }`,
`{ series: true }`, `{ value: true }`, each with a format; bar value labels
and annotation labels take the same parts.

**Placement** (`placeAttached` in `layout/attached.ts`). Inside the plot,
labels sit beside their point and slide along their row to stay within
the plot, shortened with an ellipsis (`fitText`) when wider than it, or
left out when only the ellipsis fits. Outside, they go in side tracks
(`Frame.outside`), reserving room unless `reserve` is false. Labels whose
extents meet are spread along y (`spread`), earlier points first; a label
is left out only when it cannot fit. Tops move continuously with their
points while the same labels meet, so labels do not jump as data streams.
Extents include halos and box outlines.

## Themes and styles

A theme (`theme.ts`) is **tokens** (`background`, `text`, `muted`, `grid`,
`axis`, `palette`, `sequential`, `diverging`, `rise`, `fall`) and **role
styles**. It is resolved once per configuration into `Theme`: tokens,
`roles` (every role merged with the chart's changes), and `style` (paints).
A role without its own color takes the base text's.

- **Cascade** (`style/style.ts`, `cascade`): theme role, then the chart's
  guide options, then a subplot's `style`, then the subplot's axis `style`,
  property by property; `false` turns a feature off, arrays replace.
  Resolving gives plain paints (`TextPaint`, `StrokePaint`) that renderers
  read. `model/styles.ts` resolves each axis', panel's, title's, and
  legend's paints once per configuration and theme, merging levels before
  reading colors, so an overridden `var()` needs no fallback.
- **Readings.** Every color and font that is not the theme's is read by one
  reader per chart (`Readings`): style paints, mark paints, palettes, ramp
  stops, legend samples, custom shapes, and the feature compiler's outputs.
  A scene is built while the reader is lent the page (`Readings.in`;
  `NO_PAGE` for static output, where variables take their fallbacks).
  Readings are kept by value, and hex, `transparent`, and `none` pass
  unread. When the page switches themes, kept values are read again
  (`Readings.again`) and the chart redraws only if one changed. Static
  output reads named colors as hex (`render/fallbacks.ts`), so Canvas, the
  GPU painter, and PDF parse the same values as SVG.
- **Following the page.** `"auto"` and CSS-variable tokens resolve through
  an environment the DOM chart passes: the nearest background color (else
  the page's color scheme) and computed values on a hidden probe, converted
  to sRGB hex. The chart watches the color scheme and attribute changes on
  the root and body.
- **Halos** (`haloOf`, `draw/label-halo.ts` `labelHalo`) resolve when marks
  build geometry, so geometry holds the resolved halo. The surface is the
  plot's fill (`Frame.surface`) or the chart's background; under a
  transparent background, `surface(theme)`.
- **Isolated dots.** The line tracer emits a 0.02-pixel segment for a
  one-vertex run (`dotAt`), since browsers paint zero-length strokes
  inconsistently; round caps then paint a dot of the stroke's diameter in
  SVG, Canvas, and PDF.

## What every chart's bundle carries

Role styles and their cascade, guides as positioned items and their shared
writer, title and legend tracks and places, text boxes and halos,
multi-line titles, clip modes, fluid SVG, page colors in guide styles, and
scale instances are in every chart's bundle. Each is an option a chart sets
as a plain value, in TypeScript as in specs and Python, and draws
synchronously; making them prepared objects that bring their code (as
`timeBreaks` does) would make TypeScript differ from specs and Python.
Renderers draw one kind of guide for every chart rather than a second,
smaller path for unstyled ones.

What only some charts need loads with them: the guide compiler, the
feature compiler, `herceg/fonts`, color ramps' SVG with the marks whose
legends have them, and the panel layout with subplots.

## Time axis breaks

`breaks` rules (`scale/breaks.ts`) name weekdays, daily wall-clock spans,
dates, or spans of instants. They are portable JSON; `timeBreaks(rules)`
returns a `TimeBreaks` carrying the code that resolves them (as `facet()`
and `panels()` carry theirs), so the model and level of detail reach breaks
only through an interface (`Breaks` in `lod/m4.ts`) and charts without
breaks bundle a few hooks. It serializes as its rules (`toJSON`), which
adapters compare and specs store.

- **Resolution.** A `Calendar` per breaks and time zone resolves rules over a
  span into sorted, disjoint, merged intervals [from, to) in
  `Float64Array`s with the break time before each (24 bytes per interval;
  about 60 KB for ten years of nights and weekends). Wall-clock rules follow
  the zone by membership, so across an offset change a span can be two
  intervals, and a date is a day of 23 or 25 hours. Offsets come from
  sampling the zone every four days and a binary search of quarter hours
  where samples differ (ten years: about a thousand zone queries, 0.7 ms).
  The span grows when a value outside it is asked about, by at least 28
  days or half its length, exactly, and is refused past 250,000 intervals.
- **Positions.** A value's position is the value less the break time before
  it; values inside a break sit at its seam. Positions are measured from a
  fixed start, so growing the span never moves one, and whole-millisecond
  times are exact. The inverse at a seam is the end of the break.
- **Scale.** `BrokenTimeScale` keeps its domain in epoch milliseconds and maps
  linearly over positions (`mapping()` gives the coefficients plus the
  calendar, so inlined mappings apply `collapse`). Ticks are calendar ticks
  chosen from the time shown; a tick inside a break moves to its end,
  labeled by the coarsest field that changes across it (`tickContexts`).
  Long breaks are checked for ticks by flooring their end, not walked.
- **Data inside breaks** does not count: `hides` filters points, bars,
  candles, and error bars; extents and LOD work over the shown ranges of
  sorted rows (`shown`, a galloping search per break); inspection jumps
  hidden runs by binary search (`shownFrom`, `shownBefore`).
- **Level of detail** stays in data space: the min/max index is queried over
  shown ranges, and M4 over breaks (`lod/m4-breaks.ts`) keeps a pixel column
  open across shown ranges, so a column holding a break still emits at most
  four points. A million minute bars over ten years of New York sessions
  reduce in about 1.6 ms (0.8 ms with the index) in Node.
- **Domains.** Room at the ends (half a slot, glyph insets) is applied in
  positions, since padding in time would vanish inside a break. A view
  entirely inside a break widens to an hour either side.
- **Seams** (`Calendar.seams`, drawn by `draw/seams.ts`, imported only by
  the break code) map merged intervals' ends to pixel centers, kept greedily
  `minSpacing` apart: O(log B + visible breaks). The model prepends ordinary
  `SegmentGeometry` to each panel, so data draws over seams.

## Range navigator

`navigator` (`rangeNavigator(options)`, a `Navigator`; in specs `true` or
`{ height?, marks?, panel? }`) adds a strip under the panels with one
window over an x range (`model/navigator.ts`). It is a prepared object, as
breaks and facets are, so a chart without one bundles about 110 bytes of
hooks. The strip's drawing is the model's, so `renderToSVG`, `toSVG`, and
PDF stay synchronous; only the browser's sliders load on demand.

- **Layout.** The strip's room (its height plus 12 px) comes from the height
  the rows of plots share, after titles, legends, headers, x labels, and the
  x title. It is at most a third of that, shorter where plots would keep
  under 30 px or less than the grid's rows need (`PanelGrid.least`), and
  absent when even 16 px would not leave them that. The strip spans from the
  leftmost plot's left edge to the rightmost's right edge. Its panel is
  appended to the scene (key `"navigator"`, with `~` added until unique), so
  every renderer draws it, while inspection, the keyboard, viewports,
  `getPanels`, and sync never see it.
- **Checks.** It refuses layout marks, category x axes, and marks placed
  along y; without `panel`, with facets or subplots, it refuses an `x.scope`
  other than `"chart"`.
- **Overview.** The rail is the unzoomed x domain of every panel's marks,
  planned as the plots' x is (rounding, glyph room, breaks), widening to
  hold a view past the data. Each panel's series are drawn apart, each on
  its panel's y group scale (`DrawnPanel.yGroup`, `yRightGroup`); a mark
  repeated in panels of one group draws once. Lines, areas, and candlesticks
  draw through their own `geometry` at the strip's width (M4 through the
  same min/max indexes), with buffers of the strip's own by stage, panel,
  and series key, so the plots' buffers are never overwritten. Points are
  sampled one per CSS pixel and drawn as small squares by the strip's own
  drawing (the point drawing's symbols would add 5 KiB to line charts).
- **Bars** (`model/navigator-bars.ts`) keep exact geometry below two nonempty
  rectangles per CSS column; denser bars draw, per column and side of zero,
  the most extreme tip with that bar's color (ties by series, then row),
  and stacks the most extreme position's whole stack. Density and geometry
  share one source scan, so buffers follow the strip's width, not rows. This
  keeps extremes but hides shorter bars and their colors, and drops labels.
- **Caching.** The overview is redrawn only when the rail, strip, pixel
  ratio, panels, hidden series, options, theme, text measurement, or table
  versions change: moving the window reuses it, while each streamed change
  rebuilds it. The window, outline, and grips are drawn every scene from the
  plot's x domain, so animations move it too.
- **Sliders** (`dom/navigator.ts`, importing no code so nothing moves into a
  shared chunk): an HTML group of three sliders (left edge, window, right
  edge) with hit areas leaving at least 6 px of a narrow window to panning.
  They read the strip the model last drew, format values with
  `formatValue`, and change the view with `setViewport` then `render()`, so
  drags are reported and synced as any viewport change. A drag keeps the
  rail it started on, so streaming data does not move the window under the
  pointer. Drags are pixel shifts through the rail, so log axes keep ratios
  and broken axes the time shown. Keys move by a hundredth (Page keys a
  tenth) of the strip; a polite live region reports where the window ends.
- **Description.** `Navigator.describe` writes the text alternative's
  sentence from the last drawn window; the DOM description refreshes it at
  most once a second, outside the live regions.
- **Cost.** Dragging over a million-point line takes about 2.6–2.9 ms of
  JavaScript a move, as much as panning without a navigator (Chrome). The
  overview of a 100,000-point line holds about 35 KiB. With dense bars,
  dragging four 100,000-row subplots takes about 0.34 ms a move and a
  million bars 0.42 ms; retained overview buffers are 223 KiB and 110 KiB.
