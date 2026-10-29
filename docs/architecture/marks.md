# Marks architecture

How marks resolve series, identities, and colors, how the feature compiler
adds encodings, and how each specialized mark is built. For using marks,
see the [marks guide](../guide/marks.md).

- [Series keys](#series-keys)
- [Identity and color](#identity-and-color)
- [Encodings](#encodings)
- [Band axes](#band-axes)
- [Lines and areas along y](#lines-and-areas-along-y)
- [Bars](#bars)
- [Heatmap cells](#heatmap-cells)
- [Contours](#contours)
- [2D histograms](#2d-histograms)
- [Dendrograms](#dendrograms)
- [Annotations](#annotations)
- [Custom marks](#custom-marks)
- [Layout marks](#layout-marks)
- [Maps](#maps)
- [3D charts](#3d-charts)

## Series keys

Each series has a key built from its mark's `id` (or index) and its source
(a y field or a category) as JSON, so no combination of names can collide.
Series keys identify what is drawn: geometry buffers, caches, inspection,
and the keyboard, so two marks never write into each other's buffers.

Lines, areas, bars, and points split series by a category `color` field
when they have no `series` (`seriesOf`, `marks/mark.ts`); `series: false`,
a mark's own `stroke` or `fill`, or an identity scale keep that from
happening. Map and 3D points do too (`withSeries`, `marks/layout-mark.ts`),
and histograms, box plots, boxen, violins, error bars, and rugs read
`color` as their series field or their paint (`marks/colored.ts`). The
fixtures in `packages/herceg/test/fixtures` (`series-inference.json`,
`color-identity.json`, `chart-errors.json`) pin inference, identities, and
errors for the engine and Python alike.

## Identity and color

What a series stands for is its **identity** (`model/identity.ts`), a value
in a scope with a JSON key:

| Identity | Key |
| --- | --- |
| A category field's value | `{"field":"region","value":"eu"}` |
| A value field or band label in a table | `{"table":"data","value":"p99"}` |
| A value through a named scale | `{"scale":"regions","value":"eu"}` (with `"panel"` for a scale of each panel's own) |

- **One name, one meaning.** A category field is named by its name alone
  within a chart, so `site`'s values take one color and legend entry in
  every mark, table, panel, facet, and inset. Different names stay apart; a
  named scale read by both joins them.
- **Value fields stay within their table.** A table is named by its root
  (`rootOf`, `data/origin.ts`: derived tables, views, and spec tables with
  `origin` lead back to their source while fields pass through), by its
  `name` (two tables of one name are refused), or by the place of the first
  mark reading it (`{"mark":0}`), kept between configurations. So a server
  snapshot and the browser name tables alike, and a framework re-render
  that rebuilds a table in place keeps its colors. Charts name tables
  themselves in the common case (`simpleNames`); collisions load the
  feature compiler, which names them all (`tableNames`), keeping the first
  chunk small.
- **Value identities are tagged apart** from category values, so a measure
  named `eu` never meets a site called `eu`.
- **Layout marks** report their items' sources (`LayoutMark.identity`,
  `ItemSources`), so pie slices, tree branches, radar series, map regions,
  network groups, and 3D groups take their values' colors and entries.

**Palette slots.** One allocator per chart assigns slots to identity keys
the first time they appear and keeps them for the chart's lifetime, so a
value keeps its color while others appear, disappear, or hide. The first
time a value of a category field asks for a slot, every value of the
field's dictionaries takes one, in dictionary order and the order marks
read the tables, used or not: a value's slot is its place in the
dictionary whether its color splits series, colors rows, or colors items.
Values a stream adds take slots after; after a rolling window compacts a
dictionary (its `revision`), values without slots take them in order.
Explicit colors register the series but take no slot.

**Visibility.** A series counts as hidden when its key or its identity's
is, so code that reads visibility by series key sees an entry's state
without knowing identities. Hidden identity keys stay while a mark draws
their scope. Dodging marks place series by their partition, so error bars
stand on the bars of the same field's values even where one mark lacks some.

Colors by value come from scales of categories, not palette slots: a series
or row colored by a field takes its value's output in the `"color"` scale
(or the one `encode.color.scale` names).

## Encodings

What marks draw beyond constant paint belongs to the **feature compiler**
(`marks/features/`): channels by field, scale, or condition; scales of
categories; looks by series or row (`style.by`); markers; runs
(`continuity`, `where`); label patterns. A live chart loads it before
drawing a configuration that uses any of it, as it loads the guide
compiler; static output brings both (`render/compilers.ts`). The hooks in
the core cost the line entry about 870 bytes gzip; the compiler chunk is
about 13 KB gzip.

**The contract** (`model/features.ts`):

- A mark asks for the compiler with `Mark.featured` (options only the
  compiler draws, or a `color` naming a field). `needsFeatures(config)`
  adds scales other than x, y, and yRight.
- `model.lacks()` says which compilers a configuration needs;
  `model.use(guides, features, page)` hands them over. `dom/chart.ts`
  imports what is lacking once per page and keeps the last frame (or none)
  until it has; a compiler that fails to load or refuses the configuration
  rejects `chart.loading`.
- `FeatureCompiler.compile(config, marks, previous)` runs when the model
  configures, keeping unchanged scales. Each frame,
  `CompiledFeatures.update(theme)` runs before series resolve, and
  `of(mark)` gives `MarkFeatures` (`palette`, `attach`, `format`).
- `SeriesFeatures` are hooks the core calls where present: `geometry`,
  `trace`, `band`, `extent`, `across`, `drawn`, `markerRows`, `pathEnds`,
  `curved`, `takeTrace`, `shown`, `rows`, `points`, `key`, `swatch`.
- The compiler imports code only from modules no line chart imports
  (`data/expression.ts`, `draw/symbol-shapes.ts`, `format/patterns.ts`);
  the chart's code reaches it through `FeatureKit`. A module imported by
  both would become a chunk of its own, which `test/architecture.test.ts`
  prevents.

### Channels

Every channel compiles through `compileChannel` into one of: a constant; a
category field through an `OrdinalScale` (outputs per dictionary code, so a
row's value is an array lookup); an identity scale (values as they are); the
series' names through a scale; or a condition, compiled once and read per
row.

- Every output is checked against the channel drawing it (`outputProblem`
  in `spec/channels.ts`): constants, both branches of a condition, a named
  scale's `map` and `unknown` for each channel reading it, and identity
  values as rows give them.
- Identity scales infer no series and make no legend entries.
- A scale's domain is its explicit `domain` (closed: others take
  `unknown`), or the fields' dictionaries in the order marks read them. A
  value keeps its place once it has one, and scales read whole tables, so
  colors resolve before facets split rows and streaming never recolors.
- The default scales (`"color"`, `"symbol"`, `"dash"`) are made when first
  read.

### Looks and style runs

- **Per series** (`series-styles.ts`): from channels that do not read rows.
  A `style.by` field must be constant within a series (`series-varies`
  otherwise), checked once per table version, then over appended rows.
- **Style runs** (`runs.ts`): channels that read rows give a series runs,
  each the row it ends at and its look, interned by content (no row arrays;
  16 bytes a run). A piece of line takes the look of the observation it
  arrives at; a step's hold takes the look of the value it holds.
- **Drawing runs** (`run-paths.ts`): each run is reduced apart
  (`reduceRuns`), so level of detail keeps every run; curves and steps are
  built over the whole path, so tangents are shared. Where runs meet on two
  straight segments (turning at most 120°, longer than the cut), each
  stroke goes half a stroke past the boundary and leaves out a square
  cutting the corner (`Drawing.holes`: SVG `clipPath`s, canvas and PDF
  even-odd clips), so the join is painted once and translucent looks do not
  darken seams. Elsewhere the later run paints over the earlier. Dashes
  carry across boundaries (`LineGeometry.dashOffset`).
- **Bars** (`row-styles.ts`): a look per row numbered in mixed radix (an
  `Int32Array`), one rectangle geometry per distinct look.
- **Points** (`points.ts`): `PointLooks` give each row's color index, area,
  opacity, and shape.

### Runs

`continuity.ts` keeps a flag per row (drawn or not); appends test only new
rows. Each series' runs are found once per table version: neighbors break
past `maxGap` or across a `breakBy` boundary. `tracePath` reduces each run
apart, so reduced lines never bridge a break and nearest-point indexes skip
rows not drawn. A `where` crossing is placed where its comparison changes
sign, interpolated on linear curves and at the end of the held interval on
steps, in drawn coordinates (logs on log scales, time shown across breaks),
so bands and lines meet. Runs keep a byte per row and 12 bytes a run.
Streaming 100 rows a tick into a 100,000-row window costs about 0.4–0.5 ms
with `where` or calendar breaks, 0.17 ms without (Node).

### Markers and provenance

Markers stand at the observations the reduced line keeps. The reducers name
the series position of each point they keep (`PointSink.push`), and where
markers, runs, or series labels need it, the compiler traces through a
recorder (`marks/features/provenance.ts`) that keeps those positions (4
bytes a point), so markers know their rows, series know which rows end
their paths, and labels know which observation owns each edge point.

## Band axes

A categorical field on a position channel puts the axis on a band scale of
category indices. The labels are the union of what the marks on that axis
contribute, in order of appearance. Bands are identified by raw value, so
values whose formatted labels coincide stay separate. Each row's band index
is computed once per table version (4 bytes per row). Labels thin to every
k-th band when neighbors would overlap; the widest label is measured once
per band list. A categorical axis cannot be shared with marks placing
numbers along it.

- **Lines and areas on bands** draw rows in band order: rows already
  ascending keep their order, others are sorted into a 4-byte-per-row
  permutation kept while the bands and rows are the same. The series is
  then sorted along its positions, so binary search, level of detail, and
  min/max indexes serve it.
- **Dodge and jitter.** Points, error bars, lines, and areas spread series
  across each band with grouped bars' arithmetic; jitter uses a hash of the
  row's identity and a seed, so placement survives redraws and drops. A
  dodged line is traced on a frame whose position scale is shifted by its
  slot, in pixels. Marks record each series' slot (`BandShares`), and
  picking and inspection read the same slots (`displace`,
  `maxDisplacement`). Marks of a legend group take slots from the group's
  roster (`Frame.groups`), so grouped bars, boxes, violins, and dodged
  points stand alike when one lacks a name.
- **Swarms** (`marks/swarm.ts`) lay points out per panel in pixels, low
  value to high, each at the free offset nearest the center: placed points
  within reach block spans of offsets, both ends sorted and swept. A point
  with no free place stands at the edge and does not join the window,
  which holds at most 512 points: O(n k log k) per band. Offsets are cached
  per panel with the inputs that made them. `herceg.express`'s `swarmplot`
  runs a Python port of the layout to warn when points do not fit,
  cross-checked against a fixture of this one's output.

## Lines and areas along y

A line or area with `orient: "y"` keeps the chart's x and y in its series
(`values` is x, positions y; `ySorted` says whether y ascends). The mark
traces it with the x-tracing code on a transposed view and frame, then
swaps coordinates back, so level of detail reduces by pixel rows, monotone
curves are monotone in y, and `"step-after"` holds a value up to the next
position (as an ECDF of y needs). An area along y closes at x = 0 through a
lower edge of its own. Tooltips default to `"nearest-y"`, which scans each
series (no index serves y yet). Such marks use the left axis only, as
horizontal bars do.

## Bars

Bars are horizontal when their `y` is a category, as in Plotly Express: the
mark keeps series in chart coordinates (lengths in `x`, band indices in
`y`, stack bases in `x0`), so extents, picking, and inspection need no
notion of orientation. An x axis measuring bar lengths takes the y axis'
defaults (includes zero, rounds its ends, draws grid lines). Category
labels longer than 30% of the chart's width are shortened.

On number or time x, bars are 80% as wide as the smallest gap between
neighboring distinct x values in view (capped at 64 px), found from values
sorted once per table version. Stacked series split by a category share one
pair of table-sized top and base arrays. `width: { px }` bars are that
thick through dodging; drawing, picking, the navigator, and exports read the
same rectangles. Outlines on chosen sides are a mask per rectangle
(`sideMask`, `draw/rect.ts`) that every renderer traces (`traceSides`);
regions use the same outlines.

## Heatmap cells

A heatmap's number or time axis holds cells (`marks/heatmap-cells.ts`): one
per distinct finite value, found once per table version and ordered.

- **Edges.** Without a step, a boundary lies halfway between neighbors,
  computed once and shared, so no value falls between cells; the ends
  reach as far out as in. With a step, a cell reaches half a step, or
  halfway to a closer neighbor. A lone value spans the room `usableDomain`
  gives it, so a stream's first row draws. Edges depend on data and breaks,
  never the view.
- **Lattices.** Values within a millionth of a cell of an even lattice are
  its slots, drawn per slot (see [Heatmap rasters](rendering.md#heatmap-rasters)).
- **Bounded cells** (`x1`/`x2`): a cell per distinct lower edge reaching to
  the upper edge its rows share; inconsistent edges or overlaps are refused.
- **Reduce.** Rows sharing a cell combine through the cell index: each
  cell's value is written at its last row with a value and the others read
  as missing, in a copy of the values (8 bytes a row) made only when some
  cell has several rows. Faceted sums share one ramp over every panel
  (`Mark.splitPanels`).
- **Extents.** The y extent of an x range reads each x cell's lowest and
  highest y cell (two Int32 per x cell), so automatic y follows x without
  scanning rows. Heatmaps are `tight`: automatic domains end at cell edges.
- **Breaks.** Values inside breaks have no cell; others are placed in the
  time shown (`Breaks.collapse`), so cells meet at seams.
- **Calendars** (`marks/heatmap-calendar.ts`) convert each distinct instant
  to its wall-clock day once. By weeks, x cells run from each week's start
  to the next (a lattice only when every week is seven days, as in UTC) and
  y has seven weekday bands; by months, a band per month and a column per
  day. Calendar bands carry keys of their own (`weekday:mon`, `day:1`).
  Brushes select a calendar's rows by cell centers, as a row set.

## Contours

`marks/contour.ts` reads a rectilinear grid (from a table's distinct x and
y, refusing grids under a quarter full, or a matrix as it is).
`marks/contour-trace.ts` traces marching squares in grid units (an index
and a fraction), so uneven spacing interpolates by distance and projection
comes later.

- **Cells** with four finite corners are traced; others are holes. Saddles
  are resolved by the bilinear interpolant at the saddle (the asymptotic
  decider), decided from corner differences scaled to the largest, so
  shifting or scaling a field changes no topology; overflowing differences
  use halves.
- **Lines** are stitched through a node id per grid point and edge, so
  neighbors meet on the same crossing without comparing coordinates; higher
  values lie on the left.
- **Bands** are the rings at or above the lower threshold with those of the
  upper, filled even-odd: disjoint polygons with holes, without polygon
  clipping. Where both ring sets run along the grid's ends or holes, those
  rings are taken apart into chains and stretches, cancelled where both
  cover a line in opposite directions, and joined into the band's own rings
  (`bandRings`), so each piece is counted and anchored apart.
- **Skipping.** 16 × 16 blocks keep their value range, so a threshold
  outside a block skips it; tracing costs what the contours cross.
- **Storage.** Float32 points in grid units, 8 bytes a point and 29 per
  ring or line. Traces are kept per grid and thresholds until the table
  changes; zooming only projects, caching projected points per scale and
  leaving out rings whose boxes are out of view.
- **Picking.** Regions are anchored on a crossed cell edge; an index of
  16 × 16 blocks lists the rings and lines crossing each, for even-odd tests
  and nearest-line search. Opaque bands are outlined half a pixel in their
  own color to hide antialiasing seams.

## 2D histograms

`marks/histogram2d.ts` bins x and y with the one-dimensional bins
(`data/bins.ts`) and counts in one pass into a dense Float64 per cell (at
most 1,000 bins per axis). Cells holding something become the series, with
centers as positions and measures as values, painted through the heatmap's
raster code (`AxisCells`) and found through a `CellIndex`. The color scale
runs from 0 to the fullest cell of every panel, so facets compare.

## Dendrograms

A dendrogram reads a SciPy-layout linkage. Its module validates the tree
and caches the band order (first child before second) until the table
changes; traversal and placement are iterative and linear in merges. It has
no series, legend, or inspection; `describe` reports leaf and merge counts
and the height range. Heights are the mark's extent on the height axis,
placed through its scale when linear, so views move them. With `side` top
or right, the mark asks for a descending automatic domain
(`Mark.descends`). Over a band or log axis, heights normalize in plot
pixels. Geometry is three packed segments per merge.

## Annotations

Rules, regions, and text share one model (`marks/annotation.ts`). Each
place is a value, a field, or a coordinate (`spec/place.ts`: `data`,
`field`, `fraction`, `px`, each with `offset`), resolved through
`coordinateAt` (`layout/position.ts`). With constants only, a mark draws
one item and reads no table; any field makes one item per row. The spec
loader binds a table only to annotations that read one.

- **Domains.** Only `contributeDomain: true` counts; otherwise extents
  count only where no other mark has one (`Mark.domainFallback`).
- **Room.** A rule label outside the plot asks for a track beside the y axes
  (`Mark.room`); `Frame.outside` says where labels go.
- **Drawing.** Regions are rectangles drawn with data, cut to the plot
  unless their `clip` says otherwise. Rules and text are guides: SVG above
  the data, not cut, and left out while their place in data is outside the
  view; at pixels or a share of a frame they draw wherever they are, and a
  `clip` cuts them instead of leaving them out. Plain rule labels are placed by every renderer from the same plot
  (`ruleLabel`, `RuleGeometry.labelIn`), so SVG, Canvas, PNG, and PDF agree.
  `scale/css-color.ts` parses colors without DOM APIs for static output.
- **Placement.** `shiftInside` (`layout/place.ts`) mirrors a rule's label
  across the rule, then moves any label in. `overlap` places labels
  greedily in row order, filing boxes in a grid (`layout/label-boxes.ts`)
  so each checks its neighbors; moved labels try eight spots, then farther
  ones with a leader line.
- **Description.** Annotations have no series. The text alternative lists
  them (up to ten items each) after the series summaries, per panel in
  charts with panels (up to twenty panels).
- On a category axis a constant is a band index (as in Plotly) and
  `{ data: "Feb" }` a band by value.

## Custom marks

`custom()` emits paths (SVG path syntax) and text, which become one
`shapes` geometry drawn as SVG elements or through `Path2D`, so custom
shapes follow renderer choice, clipping, and export. Over one x field and y
fields, the mark builds series as a line does (`SeriesSplitter`,
`buildSeries`), so legends, hiding, tooltips, events, the keyboard, facet
splits, domains, and summaries come from the chart's series code; there is
no inspection code of its own. `draw` receives read-only series views made
per draw. `zero` puts zero in the domain through `Mark.zero`. Since shapes
between points are unknown, y extents take in the points just past the
view. Specs hold only the type, id, and series fields, so Python cannot
make custom marks and adapters rebuild them on every render. Custom marks
implement the internal `Mark` interface with a spec of only a type and an
id (`MarkIdentity`).

## Layout marks

Layout marks (pies, treemaps, sunbursts, gauges, funnels, radars, Sankey
diagrams, networks, maps, and 3D charts) place their own geometry in a
**room**. The model gives one a `LayoutFrame` (bounds, the rows to draw,
theme, text measurement, hidden keys, stable colors per item key) and draws
the `LayoutResult` it returns (geometry, an item lookup by pixel, items in
reading order, a summary). The room is the space below the chart's title
and legend, or a panel's plot in facets and subplots. A panel holds marks
along axes or one layout mark, never both.

What a tooltip or keyboard cursor is on is an `Inspection`: an axis
inspection (a position and each series' point there) or an item inspection
(an item's key, value, label, and an SVG outline for the hover highlight).
Arrow keys step through items in reading order.

| Mark | Data | Layout and drawing |
| --- | --- | --- |
| Pie | Totals per category, cached per table version | Arc geometry, six floats per sector, drawn as SVG `A`, canvas `arc`, PDF cubics of at most a quarter turn. Gaps move each slice's sides inward, so they show what is behind. Labels spread per side (`layout/pie-labels.ts`). |
| Treemap, sunburst | Packed tree arrays over the rows (`data/hierarchy.ts`): parent, depth, children offsets, a parents-first order, each row's node | Squarified (`layout/treemap.ts`) or adjacency partition (`layout/partition.ts`), writing packed boxes or spans; rebuilt only when the table changes. |
| Gauge | The last finite value, scanned back from the last row each scene (no state) | Arc geometry; the track is drawn only beyond the value, since antialiased edges under the value's arc would fringe it. |
| Funnel | Stage totals per table version | One rectangle geometry over a shapes path of connectors. |
| Radar | Packed arrays of the values rows give, by series and spoke, rebuilt on change | Existing geometry kinds (lines, shapes, points), so renderers need no radar code. The radius is the largest leaving room for spoke labels, each label's outward edge bounding it linearly (`layout/radar-labels.ts`). |
| Sankey | One pass: names to nodes once per dictionary code, rows of a pair adding to one link | `layout/sankey.ts` follows d3-sankey (cycle links dropped by depth-first search, longest-path columns, six relaxation passes). Link stacks re-sort once per column and keep offsets in both stacks, so a hub of thousands of links costs milliseconds, not quadratic time. Values are fractions of the largest link, so sums near the largest double stay finite. Links are bands of two cubics; picking solves the curve's x with Newton steps. |

### Networks

A network (`graph`) reads two tables, links and optional nodes. Layout
marks list extra tables in `otherTables`, and `tablesOf(mark)` gives all of
them to whatever follows changes (the DOM chart's subscriptions and
descriptions, and the adapters' comparison of rebuilt marks). The network
is built in one pass over each table.

**Force layout** (`layout/force.ts`) runs d3-force's simulation with its
defaults: springs of length 30 (strength the inverse of the smaller
degree), many-body repulsion of -30 (exact up to 150 nodes, else a
Barnes–Hut quadtree in flat typed arrays, theta 0.9, 1.2 above 5,000 nodes),
alpha from 1 to 0.001 over 300 ticks, velocity decay 0.4. Two departures,
both for the picture:

- Nodes start from **pivot MDS** (`layout/pivot-mds.ts`, after Brandes and
  Pich: distances from up to 50 pivots, double centered, the top two
  eigenvectors), so the start already follows network distances; from d3's
  spiral, rings and long chains settle folded.
- **Components are packed** in rows of their bounding boxes
  (`layout/components.ts`) before and after the simulation instead of a
  pull toward the center: components started inside one another never
  separate under 1/r repulsion, and the pull squeezes large ones.

The simulation is a generator of steps (pivot MDS in steps of about 2^18
operations; repulsion in chunks of 2,048 nodes), so it stops at a deadline
and resumes, ending where an uninterrupted run would. It can also run from
given positions with some nodes held.

**Circular** (`layout/circular.ts`) puts nodes on one circle a link length
apart by group, then degree, input order, or name. **Layered**
(`layout/layered.ts`, after Sugiyama, Tagawa, and Toda) reads constraints
from each link's rows, turns back edges around for placing only, assigns
longest-path layers, adds bend points (at most 500,000), orders layers with
four barycenter sweeps keeping the order of fewest crossings (counted with a
Fenwick tree, as Barth, Jünger, and Mutzel do), and places vertices over
their neighbors' span, each layer fitted by weighted isotonic regression. It
yields every 16,384 vertices.

**Node positions** are per chart state (`marks/node-positions.ts`,
`NodePositions`; facet panels share one), in three sets: the layout's own,
the settled (the layout's own with nodes near moved ones settled around
them), and the shown (easing to the settled over 300 ms). The settled
positions are a function of the layout's own and the held nodes, not of the
order of moves (a settle simulates from the layout's own positions with
moved nodes held and nodes within two links or two link lengths moving, at
most 1,000, from alpha 0.3 for 40 ticks), so views of one widget and a chart
restored from saved moves draw the same. After a data change, positions
are seeded by name: remaining nodes start where they were, new ones beside
their placed neighbors (offset by a hash of their name), new components by
pivot MDS beside the rest, and nodes within two links of a change move.
Work is never thrown away by a data change, so streams cannot starve it.
`carryNodePositions(from, to)` hands a replaced chart's states over.

**Scheduling.** Layout work runs in `NodePositions.update` with a 12 ms
deadline per frame (`ItemViews`); model-only charts and page-less exports
run to the end. Frames that do not draw do layout work only
(`ItemViews.workLayouts`) and ask for a drawing frame every frame up to
20,000 nodes and links, four times a second above. This is chunking on the
main thread rather than a worker: a worker would need its own module URL in
npm, a bundled one in the Python widget and Streamlit, CSP allowances in
notebooks, and a synchronous path for Python's embedded V8 anyway.
`chart.loading` waits for a frame with no layout work left.

**Drawing and picking.** Nodes are a point geometry (largest first, ringed
in the surface color); links a segments geometry per width and color, so a
frame that moves a node writes typed arrays. Directed pairs bow as quadratic
curves with chevrons at the target's ring. Pointer candidates come from
packed 32-pixel grids built lazily for nodes and links separately
(`layout/hit-grid.ts`), in the fitted layout's pixels before any zoom, so
panning and zooming keep them; exact distances and drawing ranks decide.
Dragging a node in a network of 5,000 nodes and 20,000 links takes about
1.1 ms a scene (Node).

**Plane navigation.** Networks expose `LayoutResult.plane` as maps do
(`layout/graph-view.ts`): base pixels invert through the fit into layout
units, then project through the view; radii and widths stay in pixels.
The network controller composes plane navigation, node dragging, and one
toolbar; a pointer press owns its gesture until it ends. Python front ends
keep plane views apart from axis views and compare resolved projection
parameters before keeping a map's ranges and lassos.

## Maps

A map's layers (`geoshape`, `geopoint`) share a chart and its projection.
Layout marks offering `join` (only map layers) are drawn as one mark: the
model's `validate()` replaces them with the `GeoMap` the first one's `join`
returns (`marks/geo.ts`), which fits every layer into the room and lets each
draw with the same transform. Layers keep their own identity, legends, and
color scales, since fields of one name in two layers may measure different
things.

**Projections** (`geo/projection.ts`) are d3-geo's raw forward projections
(Equal Earth, Natural Earth I, Mercator, equirectangular, Albers' conic
equal-area). Only longitude rotation is supported, so there is no horizon
and no spherical clipping. Edges are straight in longitude and latitude, as
GeoJSON defines them, so cutting at the map's edges is plane clipping
(`geo/clip.ts`): each 360° window a ring reaches is cut out and moved back,
and latitudes are cut at Mercator's limit. Cuts follow the cutting line
between crossings paired in order, so a concave ring cut in several places
becomes several rings without zero-width connectors. Edges longer than a
degree are divided, then halved in pixels (at most 16 times) until the
projected midpoint is within a quarter pixel of the chord, as d3-geo
resamples.

**Fitting and caching** (`geo/project.ts`, `geo/shapes.ts`). The fit box
does not depend on values or hidden categories, so recoloring never moves
the map. Shapes are projected per geometry set, shared by every mark and
chart drawing it: a plane box per geometry and projection, and pixels per
projection and fit (the four most recent). Points within 0.35 px of the
last kept are dropped. Changes of values, colors, the legend, or the theme
reuse pixels and SVG path data.

**Drawing.** Regions are a `polygons` geometry (Float32 pixels and ring
offsets, even-odd fill, one SVG path per shape, so a color change only
changes fill attributes). Points are one point geometry drawn largest first.
The pointer finds a point through a grid of centers, else a region through
a 32-pixel grid of polygon boxes and an even-odd crossing test.

**Zoom.** A zoomed map projects shapes at a level (`zoomedTransform`: the
next power of 2^(1/4) above the scale shown, origin on a 2^18-pixel grid by
the view, keeping Float32 pixels precise) and draws them moved and scaled
down by at most a level (`PolygonGeometry.transform`; SVG uses a `matrix`
transform and divides border widths). A pan reuses every shape until it
leaves the grid cell; shapes are culled by their plane boxes before
projecting. Lassos select regions by a plane anchor per geometry
(`planeAnchor`), the same at any zoom.

## 3D charts

`point3d`, `line3d`, and `surface` layers join (as map layers do) into a
`Plot3D` (`marks/plot3d.ts`) that plans the axes, fits the box, and draws
every layer together: as one `faces` geometry drawn back to front (so SVG,
Canvas, PDF, and export need no 3D code), or as batches for a GPU painter.

- **Axes** are planned with `planAxis` over -1 to 1 and scaled by
  `boxAspect`. The camera (`three/camera.ts`) is an eye direction from
  azimuth and elevation; projection is orthographic or perspective from five
  half-sides away. The box is fitted by bounds that hold at every angle, so
  it keeps its size as it turns. Tick labels go along the lowest edges on
  screen (z along the leftmost), thinned against each other.
- **Camera state** lives in `ItemViews` per owner (the chart, or each 3D
  subplot). An update with a different configured camera (compared after
  defaults) replaces it, so adapters re-rendering with the same props keep
  the user's view. `dom/orbit.ts` loads with the first 3D mark.
- **Items** come from the data, not from what was drawn (`Layer3D.items`),
  cached per planned axes, table version, and series shown, so turning the
  camera reads nothing again and summaries never project or sort.
- **Faces** (`three/faces.ts`, `draw/faces.ts`) are packed vertices with
  depths, corner indices, a style index, and a sort key. Two 16-bit counting
  passes per key sort them stably. Consecutive opaque faces of one style
  fill as one path of at most 64 faces (Chrome fills one path of thousands
  of arcs slower than many short ones). Opaque cells are outlined half a
  pixel in their own color to close antialiasing seams.
- **Order.** Points alone draw by depth. One surface with points is exact:
  a height field can hide only what lies farther along both grid axes, so
  cells are ranked row by row from the far side, and points take the rank
  of the cell they lie over (verified against a per-pixel nearest-triangle
  test from many angles). Several surfaces sort by mean depth, which can be
  wrong where they cross. Lines are cut at the walls (and at a single
  surface's columns and rows) and ranked by their middles: approximate.
  Discs are then placed among the faces they overlap on screen, so a point
  shows as a marker cut only by faces in front of it (10,000 points over a
  100 × 100 grid take 15–25 ms a scene in Node).
- **Surfaces.** The grid is built once per table version and refused
  before allocation past 1,048,576 points; the CPU draws at most 250,000.
  A matrix's ascending coordinates are used as they are, with no index from
  grid points to rows. Each chart keeps each grid point's exact height (8
  bytes), since points on the surface and cells cut at the walls are
  decided by it: a 1001 × 1001 surface keeps about 8.7 MB beside its 8 MB of
  values. Cells past the box are cut triangle by triangle
  (Sutherland–Hodgman). Shading is flat per cell in 16 steps.
- **Picking** (`FaceIndex`): a uniform grid of 6–24 px cells; items are keyed
  by row identity, so keys survive a stream's drops.
- **Subplots** use CPU faces only. Each `Plot3D` caches its latest CPU
  result; the faces drawing caches one raster per panel and canvas, so
  unchanged panels composite without reprojecting.

### 3D on the GPU

A chart is drawn by the GPU when every layer gives a batch
(`Layer3D.batch`: opaque points, opaque lines, opaque surfaces without
wireframes in grid order) and the CPU would draw at least 20,000 faces
(`GPU_FACES_3D`; a cell counts two). The threshold was measured: turning a
50 × 50 surface costs 2.6 ms on the CPU and 0.5 ms on the GPU, 200 × 200
29 ms against 0.2 ms; below 10,000 cells the CPU frame is under about 7 ms
and stays vector and antialiased.

- The painter (`render/webgl3d.ts`) loads only for a 3D chart's first
  batch, through the page's shared context (`render/webgl.ts`). Every batch
  draws into one depth buffer per chart, then copies into the chart's
  canvas in mark order.
- One homogeneous projection matches `View.project`; perspective depth is
  written as 1.5 w − 1.5 so interpolation across triangles is exact.
  Surfaces draw eight depth steps back (polygon offset), so points and lines
  on a surface show over it.
- **Points** are sprites from float32 columns mapped about their domains'
  centers, uploaded once per table version (again only if domains move far
  enough to cost a quarter pixel), with a color byte per row into a palette
  texture. Uploads are shared by charts drawing the same columns.
- **Surfaces** are indexed triangles taking flat color and normal from
  their provoking vertex; the shader picks the CPU's shading step and reads
  colors from a 256 × 16 texture filled with the CPU's arithmetic, so GPU
  and CPU colors match. A million cells upload 49 MB.
- **Lines** are instanced ribbons of constant screen width, cut at the box
  in float64 (Liang–Barsky), with depth per fragment (`gl_FragDepth`).
- Turning the camera uploads nothing (the view, light, and mappings are
  uniforms). A lost context drops uploads; the chart draws on the CPU
  meanwhile.
- **Picking** follows the data: a surface walks the pointer's ray through
  the cells it crosses (`three/hit.ts`, about a millisecond at a million
  cells, no index); points and segments are projected once per view into a
  screen grid. Depths are compared as the 24-bit buffer holds them.
