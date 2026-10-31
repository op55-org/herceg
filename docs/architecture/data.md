# Data architecture

How tables store data, follow changes, and feed derived structures. For
using them, see the [data guide](../guide/data.md).

- [Tables](#tables)
- [Ordered tables](#ordered-tables)
- [Memory amplification](#memory-amplification)
- [Series rows and stacks](#series-rows-and-stacks)
- [Derived tables](#derived-tables)
- [Row views, row sets, and selection stores](#row-views-row-sets-and-selection-stores)
- [Row groups](#row-groups)
- [Row pivots](#row-pivots)
- [Level of detail](#level-of-detail)

## Tables

Tables are columnar (`data/table.ts`). A number or time column is one typed
array; a category column is `Int32Array` codes (-1 for missing) and a string
dictionary. Nothing in the pipeline creates an object per row.

| Decision | Why |
| --- | --- |
| **Zero-copy input, copy-on-write.** Typed arrays given to `table()` are used in place; the first mutation copies them into buffers the table owns. | Large inputs cost nothing to wrap, and the caller's arrays are never written. |
| **Kinds from values or tags**, never names or magnitudes (`time()`, `category()`). | Guessing from "1.77e12" or a field called `year` is wrong often enough to surprise. |
| **Writes check before they write.** `append` and `replace` validate every value first (of an oversized batch, only rows kept), allocating nothing. | A failed write leaves the table as it was; one-row streaming pays nothing extra. |
| **Contiguous storage.** Live rows are one slice of each buffer. Appends write after it; drops move its start. At the end of the buffer, rows move to the front if that frees a third, otherwise buffers grow to 1.5x the live rows (at least 64). An explicit drop that leaves a buffer under a quarter full shrinks it. | Every reader gets plain contiguous typed arrays. A ring buffer would avoid the headroom but make every consumer handle two segments. |
| **Rolling windows** (`maxRows`) drop rows before compaction. | Dropped rows are never copied. |
| **Change events.** Each write, or each transaction, bumps `version` and reports what changed (dropped, appended, inserted, an updated range and its fields, or a reset). `identity(position)` is a row's stable identity, which `positionOf(identity, generation)` finds again; `generation` counts resets; `modifiedVersion` is the last change to values already present. `TableChange` (`data/table.ts`) states the invariants every cache relies on. | Caches key on versions; incremental structures follow the details. Identities go through the table, so tables that keep rows in order and insert before their end can store them. |
| **One change per transaction.** `replace(start, values)` writes several fields as one change; `transaction(change)` reports the writes made in it as one change when it returns: drops, then the span of rows updated, then appends. It does not roll back: writes are checked before they write instead. A transaction made in a listener is reported when it returns, as any write made there is, so later listeners hear it before the change being reported. | Readers never see some fields written and others not, and a merge, append, and drop reach every cache once. Undoing writes would mean copying what they overwrite. |
| **Cached derived state.** Sortedness and extents per field, updated cheaply on append. | Scales and lookups need them every frame. |
| **Rolling categories.** A dictionary holding more than twice the live rows (plus 64) drops unused entries and renumbers codes, bumping `categories(field).revision`. | Long streams over changing categories stay bounded. Consumers key categories by label, not code. |

**Geometry columns** (`data/geometry.ts`) store shapes as categories store
labels: an `Int32Array` code per row into a shared set of polygons packed
as GeoArrow packs multipolygons (float64 longitude, latitude pairs; int32
offsets of rings, polygons, and geometries). The set is checked once
(monotone offsets, coordinates within ±540° longitude and ±90° latitude,
which catches projected data) and never written. Tables move, filter, and
sort 4 bytes per row; derived tables share the set; appended rows name
existing shapes by code; new shapes need `reset`. `byteLength` counts the
codes and `geometryBytes` the set once. Tables do not import the geometry
module, so line charts do not bundle it.

**Matrix tables** (`data/matrix.ts`) keep `nx` × `ny` values over two
coordinate arrays. The coordinate fields are deferred columns
(`Column.deferred`), made on first read, until then counted as the arrays
they come from. Contours and surfaces read the matrix itself
(`matrixOf`), so a million-point surface holds its values and two arrays
of a thousand. The matrix lives in a `WeakMap` by table and is forgotten
on any append, drop, reset, or coordinate change.

## Ordered tables

`orderedTable` (`data/ordered.ts`) keeps rows in ascending order of a number
or time field, so a feed's late rows land where they belong. It is its own
module: tables that do not order carry none of it.

| Decision | Why |
| --- | --- |
| **A merge per batch.** `append` writes the batch at the end as any table does, finds where its first late row goes by binary search, and merges the rows from there in one pass per field (ties: rows already there first, then the batch's order). Rows at or after the last append with no merge. | A late row costs moving the rows after it once, however many rows the batch holds; in-order feeds pay one comparison per row. |
| **Identities are arrival ordinals** (`Float64Array`, 8 bytes a row) that move with their rows. `identity(position)` reads them; `positionOf(identity)` searches them. | Row sets, selections, and highlights hold identities, so they stay on their observations as rows move. |
| **Changes say where rows were inserted.** A merge is one change with `inserted: { start, count }`: rows before `start` are the rows that were there, and rows from `start` on may be others. In a transaction, rows an earlier write took in count as there, since they may have been read before a later write moved them. `changedFrom(version)` gives the first position that moved or changed since a version, from a log of the last 16 changes. | Consumers redo what follows `start`, or follow a cache's own version through several changes, instead of starting over. |
| **Drops by order.** `maxRows` and `dropBefore` drop from the first row up. Batch rows the window would drop at once never enter, though each takes its ordinal. | A window keeps the newest observations, not the newest arrivals; a change counts only rows that were there or stay, and Python, which numbers every arrival, agrees. |
| **Merges outside the table.** The base table exposes a module-private hook (`moved`) that tells it rows from a position were rewritten in place: min/max indexes update from there, sortedness of other fields is found again, and `modifiedVersion` moves when rows listeners knew moved. | `data/table.ts`, eager in every chart, carries no merge code. |

How each consumer follows an insertion:

| Consumer | Follows it by |
| --- | --- |
| Min/max indexes | updating blocks from `start` |
| Extents | extending, as for appends: a merge adds values and removes none |
| Series rows (`SplitRows`) | cutting each group at the first row from `start` and filing the rows after it again |
| Areas stacked by a series field | restacking from the x before the first changed position |
| Stacks of fields | restacking |
| Row views | treating `[start, length)` as updated rows, merged back |
| Row sets | nothing: they hold identities |
| Highlights, row groups, derived tables | recomputing (a derived table recomputed is reset) |

## Memory amplification

Over the source data, Herceg adds:

| Structure | Cost |
| --- | --- |
| Reserved capacity in growing tables | About 0.5x the live rows after growth; at most 0.5x `maxRows` for rolling windows; up to about 6x live rows after drops until an explicit drop shrinks the buffer. |
| Long-format grouping (`SplitRows`) | 4–6 bytes per row (each group's positions, with room for half again, at least 16). |
| Min/max indexes for lines and areas | About 0.16 bytes per row per indexed field (up to twice that while growing, about four times after rows shrink). |
| Stacks of fields | Two `Float64Array`s per layer (top and base), with up to 0.5x room. |
| Bars stacked by a series field | 28 bytes per row, 29 per position plus its `Map` entry. |
| Areas stacked by a series field | 16 bytes per row and per layer and x position, plus 8 per x. |
| Geometry buffers | Bounded by the plot width (see [Level of detail](#level-of-detail)). |
| A mark's rows of a row view | 4 bytes per row the view shows (see [Marks' rows](#marks-rows)); heatmap cells and calendars over a view, 8 bytes per table row for each value field. |
| Rows of drawn bars and points | 4 bytes per drawn bar or point, in each frame's pooled buffers (see [Drawn marks](marks.md#drawn-marks)). |
| Ordered tables' identities | 8 bytes per row, with the table's room: a 20-byte row (time, value, category) holds 28 bytes. |
| Row sets over ordered tables | 12 bytes per 32-row word holding a member: a member in every 32 rows costs three times a dense set, one in every 100 about the same. |

## Marks' rows

A mark drawing series of a table (lines, areas, bars, points, histograms,
2D histograms, box plots, violins, boxen, error bars, candlesticks,
heatmaps, rugs, custom marks) reads it through one provider, `rowsOf`
(`marks/rows.ts`). It gives `MarkRows`: the table, the positions drawn
(undefined for every row in table order, with no copy), and a `revision`
that changes whenever the rows may (the table's version, and a view's
revision).

- **One reading.** Series splitting, category and value bands, bins and
  their extents, facet panels (found from the rows marks read) and
  summaries (a facet panel's too: its rows that the mark draws), slots,
  heatmap cells, calendars, size, color, and opacity
  domains, and points' identity values (checked, keyed, and padded for)
  read the mark's rows and nothing around them, so a mark over a row view
  draws as it draws a table of the view's rows.
- **Caches by revision.** `rowsOf` returns the last answer while the rows
  are unchanged, so caches keyed by the rows object or its revision
  (`MarkRowsCache`) last until a change, and a mark's helpers compare one
  key instead of a table version and a view revision each.
- **A copy for views.** A view rewrites its positions as it catches up, so
  the mark keeps its own copy (4 bytes a row) for the frame's readers. An
  answer says the view it is of (`MarkRows.view`), so a table's or another
  view's answer is never taken for its own, however alike their revisions.
  The view gives it (`RowView.markRows`), so charts of tables alone carry
  no view code. Extents of a view's rows are kept with the answer, since
  some readers ask per point (a lasso, each point's size).
- **Looks too.** Lines' and areas' style maps and channels read by rows
  (`SeriesStyles`, `StyleRuns`) read on from the table only while the mark
  draws every row; rows a view or provider gives, in whatever order, they
  read whole, by position, whenever their revision or their order (which
  another mark's bands can change) changes; a band keeps the order of the
  rows a provider gives. Bars' looks
  and color keys (`RowStyles`) read and check only the rows drawn, again
  whenever their revision changes.
- **Not yet through it.** Contours read matrix grids, dendrograms their
  own clustering, and selected rows' view filters still read tables or
  views directly. Custom marks take views, and hand `draw` series of the
  view's rows; what `draw` reads of their table beyond them is its own.

## Series rows and stacks

**Series rows.** Rows of a whole table split by a series field are grouped
once and kept current (`SplitRows`, `marks/split.ts`). Appended rows are
filed into their groups; rows a rolling window drops leave the front of
each group by binary search, the rest moving down. Rows given out are never
rewritten, since scenes and other charts may still read them; appends only
write past their end. Groups are keyed by name (a window can renumber
codes). Each group counts the rows it lost, which lets GPU uploads follow it
incrementally, and keeps min/max indexes of the fields lines and areas read.
Rows an ordered table merges in cut each group at its first row from the
merge's start, so groups keep what came before and file the rest again.
The module loads the first time a chart groups a whole table; until then,
or if it fails to load, rows are grouped again on each change with the same
result. A row view's rows are grouped from scratch.

**Stack offsets** (`marks/stack-offset.ts`) are imported by the area and bar
stacking modules only, never by the line entry. Bars take fill alone, so
they carry no stream-baseline code.

| Offset | Rule |
| --- | --- |
| `true` (zero) | Signed stacking: positive up, negative down. |
| `"fill"` | Shares of each position's total, from source values divided by a kept total per row (not differences of rounded boundaries). Zero totals have zero thickness. |
| `"center"` | Symmetric about zero. |
| `"wiggle"` | Byron–Wattenberg weighted-slope recurrence in position order, starting at zero. |
| `order: "inside-out"` | Layers balanced by peak position, keeping series identity and legend order; ties in order of occurrence. |

Fill, center, and wiggle need nonnegative finite contributions; NaN and
infinities are per-layer gaps that count as zero for other layers. Every
cumulative boundary must stay finite; overflow asks the caller to rescale.
Center and wiggle refuse log scales. Wiggle and inside-out recompute after
a window change; input-order zero, fill, and center restack only what
changed. Every renderer and export reads the same boundaries.

**Stacks of fields** sharing rows (`marks/stack.ts`) stack appended rows on
their own and drop rows from the front by row identity and
`modifiedVersion`; a replace, reset, or visibility change restacks
everything. From 262,144 rows they keep min/max indexes over tops and
bases, so extents and tracing read a few blocks per pixel column. Bars of
several fields stack incrementally only when positions strictly increase.

**Bars stacked by a series field** (`marks/position-stack.ts`) link each row
to the next at its position (positions numbered through a `Map` and a free
list), so a rolling window's dropped rows lead their positions' lists.
Appends and drops mark their positions, and only those restack; values
replaced in place, a reset, or a series shown, hidden, added, or removed
restack all. When fewer than a quarter of numbered positions are live, they
are renumbered so arrays shrink. Ten series over 10,000 positions take
about 0.09 ms per appended position (`npm run bench:core`).

**Areas stacked by a series field** (`marks/union-stack.ts`) stack on the
union of their x positions: each shown layer has a top and base at every x
any layer has, and each row also keeps its layer's top and base, so
tooltips and the keyboard read real rows while geometry and extents read
the edges (`Series.edges`). A layer with no row at an x counts as zero there
or, with `gaps: "interpolate"`, the line between its neighbors. Several
rows of a layer at one x pair with other layers' by occurrence. Layers
whose x does not ascend merge through a private order, which pickers read
too (`LayerEdges.positionOrder`), and restack from scratch. Otherwise an
append restacks from the first x it changes (from the layer's previous x
when gaps are interpolated, support is an intersection, or continuity
applies, since those read a neighbor), drops restack up to the new first
x, and an ordered table's merge restacks from the x before its first
changed position.

**Support.** Where the stack has no support, every layer's top and base
are `NaN`, the form every reader of edges already takes as a gap, so
drawing, inspection, labels, domains, and level of detail agree without a
structure of their own. A position lacks support where a layer's run
breaks (its `continuity` leaves the row out, or does not join it to its
neighbor) and, with `support: "intersection"`, before a layer's first row
and after its last. Where a layer's run ends between two supported
positions, an extra entry with `NaN` edges at the earlier position stops
the band there. Continuity reaches the stack as `Connections` (`drawn(row)`,
`joins(a, xa, b, xb)`), which the compiled features give union stacks
instead of tracing each layer. Unions of 262,144 positions or more
keep min/max indexes of their edges. Cost is O(kU) for k layers over U
positions: the table's size when series share x, up to k times it when
they share none.

Facet panels stack their own rows from scratch into table-sized arrays the
panels share, cached by table version, panel rows, visibility, and category
positions.

## Derived tables

A data entry with `source` and `transform` derives rows from another table
(`data/derive.ts`).

- **Expressions** are JSON trees with the operator first
  (`[">", ["field", "temp"], 30]`), so specs stay data and Python builds
  them with operators. They compile per evaluation into closures, comparing
  a category with a string literal by dictionary code.
- **Steps run over columns.** Filters and sorts gather rows into new typed
  arrays, calculations add columns, bins replace values with their bin's
  start, aggregates group by values (codes for categories) in order of
  appearance. Columns still read from the source are copied at the end, so
  a derived table never shares a buffer the source may overwrite.
- **Rolling windows** keep a two-stack sliding window of partial aggregates
  (count, mean, squared deviations, min, max) combined with Chan's pairwise
  update: O(1) amortized per row, without the cancellation of running sums.
- **Following the source.** When every step works row by row (filters,
  calculations, bins of a step or edges), appended rows run through the
  steps alone and each derived row remembers its source row's identity, so
  drops remove exactly the rows they produced; a source change's drops and
  appends reach the derived table's listeners as one change. Otherwise the
  table recomputes with `reset`. A write made in another listener reaches
  the derived table before the change that listener heard, so it keeps
  the source version it holds: a change it holds already is skipped, and
  one heard out of turn is computed again from the source.
- **Lifetime.** A `WeakMap` from derived to source (`data/origin.ts`) keeps
  chains alive; the source's subscription holds the derived table through a
  `WeakRef`, removed by a `FinalizationRegistry`. The same map records which
  fields pass through unchanged, which [identities](marks.md#identity-and-color)
  follow back to the source.
- The spec loader loads tables in dependency order and rejects unknown
  sources and cycles.

## Row views, row sets, and selection stores

A row view (`data/row-view.ts`) holds a `Uint32Array` of positions into its
table and no column. It is lazy but invalidated eagerly: a table change
bumps its revision and notifies listeners at once; `read()` catches up.

Catching up works from row identities, so several changes merge:

| Change | Cost |
| --- | --- |
| Rows left a rolling window | Dropped, the rest rebased: O(kept). |
| Rows appended | Filtered, sorted on their own, merged: O(kept + a log a). |
| Values updated in a field the query reads | Changed rows leave and re-merge: O(kept + c log c), with a byte per row over the updated span. |
| Updates over an eighth of the rows, a reset, a new query | Rebuild: O(rows) plus the sort. |

Filters compile when they run, since arrays move and codes change as rows
drop. The comparator (`data/order.ts`, shared with derived tables' sort)
puts missing values last in either direction, orders infinities, ranks
categories by label once per sort, and breaks ties by position, so orders
are stable and settle the same way after updates.

A row's identity across resets is its table, `generation`, and
`identity(position)` (in tables that only append, the position plus
`rowOffset`, the rows dropped before it). `RowSet`s (`data/row-set.ts`) are bitsets over identities from
the first row they could hold, bound to a generation; dropped rows' bits are
trimmed as the set is read. Over an ordered table, the span from the lowest
identity kept to the highest grows without end once an early-arriving row
stays while rows numbered after it drop, so its sets hold sparse words
instead: sorted word numbers and their bits, only where a member is.
Dropped rows' bits leave as the set is counted or listed, or once a quarter
of the table's rows have dropped since. `SelectionStore` (`data/selection.ts`) keeps
selections by channel as portable conditions or local row sets; readers
choose which channels they read and whether to filter or highlight, so a
chart's brush need not filter the chart that drew it.

Series marks over a view keep the view's table as their table and the view
as `mark.view`, and read the view's rows as every mark reads its rows
([Marks' rows](#marks-rows)): series, extents, bins, stacks, category
bands, and size, color, and opacity domains come from the rows shown, and
facets split them by panel. Stacks over a view restack when its query
changes (`queryRevision`) and otherwise follow its table's changes. Specs
name a view as a data entry with `source` and `view` (`filter`, `sort`);
there, annotation and layout marks, derived tables, and row selections
refuse a view, naming its table instead. The WebGL painter uploads whole columns,
so view points stay on the CPU.

## Row groups

Row groups (`data/groups.ts`; level state in `data/group-levels.ts`; member
lists in `data/group-members.ts`) group a view's rows level by level: level
`d` groups by the first `d + 1` fields.

**Tables per level.** Group `g` of a level is row `g` of that level's table.
One table per level gives each level its own schema (its grouping fields,
then aggregates), which charts read as any table and TypeScript types by
`by`. A single table with a depth column would leave deeper fields missing
on parents' rows (indistinguishable from missing values) and make charts
filter it.

**Finding groups.** Each grouping field gives values ids in order of first
appearance (category codes through an `Int32Array` per dictionary; numbers
through a `Map` where NaN is one key and -0 joins 0). Below the first level,
a map per level takes `parent × 2^26 + id` to the group. Each table row's
last-level group is kept in an `Int32Array` window that slides as the table
drops rows.

**Aggregates.** Running `Float64Array`s per level and aggregate. A full
computation visits rows in table order and adds them to last-level groups,
whose aggregates add up into each level above, so a parent's mean is its
rows' sum over their count. Sums are compensated (Neumaier, with Knuth's
two-sum for the remainder). Once a batch is in, a group whose accumulated
loss passes an ulp of its sum (values cancelling) is recomputed exactly
from its rows (Shewchuk's partials, as Python's `math.fsum`). So a group's
sum stays within about an ulp of its rows' exact sum whatever came and
went; fuzzing over values spanning 40 orders of magnitude in a rolling
window held every level within an ulp. An overflowing sum is infinite until
a row leaves it.

**Following changes.** Appends and front drops (no reset, query change, or
update of a field the groups read) are added to or taken from their group
at every level: O((appended + dropped) × levels × aggregates). Taking a row
away needs its values after the table dropped them, so groups over tables
that drop rows keep each aggregated field's values per table row. A group
whose min or max left is recomputed from its rows. Dictionary compaction
renumbers codes, so groups forget code ids when rows drop and find them by
label. Anything else recomputes everything from the same ids, so surviving
groups keep their numbers; empty groups are dropped and the rest
renumbered.

**Writing tables.** Each level's table gets a `replace` per run of changed
groups (runs closer than 64 merge) and an `append` of new groups; a level
that lost a group resets. The tables are a `Table` subclass whose
listeners hear all of a change at once, after every level is written, so a
grid reading the first level from a listener sees every level's final
aggregates. (A general multi-field `Table` write would do the same, but
every chart would bundle it.)

**Member lists.** A last-level group's rows, in view order, are listed only
when a reader asks (an expanded grid group, a selection, a stale minimum):
one packed `Uint32Array` of runs, each with a quarter more room, as
identities less a base so front drops move nothing. Appends write into
their run's room (sorted views merge from the back); a full run moves to
the end with half again of room. A new query, a reset, or an update of a
read field drops the lists. Members' identities are positions plus
`rowOffset`, which holds for tables that only append and drop; tables
whose rows move will need the lists to follow `Table.identity`.

**Keys.** A group's key is its path of values (labels, numbers, or null);
its id is the key as JSON with infinities as text. Readers name groups by
key, never by number or code, which change on renumbering and compaction.

Memory: 4 bytes per table row (each row's group); for tables that drop
rows, 8 bytes per row per aggregated field; about 6 bytes per shown row once
listed; and per group and level, 8 bytes per running value and 24 more per
sum or mean. `byteLength` counts the typed arrays, not keys and maps. A
million rows into a thousand groups take 4 MiB and about 20 ms to group, and
1,000 appended rows about 0.1 ms (Node, Apple M6). Finding groups through
the maps dominates; nearly unique keys (groups vanishing with every batch)
are the slow case.

## Row pivots

A row pivot (`data/pivot.ts`, `herceg/pivot`) is row groups by its rows
field and pivot field, made with bounds, plus an index. It has no
aggregation of its own: the first level's groups are the pivot's rows
(`rowTable`, holding totals), and the second level's groups are the observed
combinations, whose long table charts read. A wide table with a field per
value would change schema with every new value and cost rows × values ×
aggregates; the long table costs only the combinations that exist.

**The crosstab index** (`data/pivot-index.ts`) gives values slots in order
of first appearance and orders slots for columns (categories by dictionary
place, numbers and times ascending, missing last). It maps a row and slot
to the combination's position:

- dense, an `Int32Array` of rows × slots with room for half again, while
  that is at most 2^20 entries (twice that for an index already dense, so
  it does not flip back and forth) or no larger than sparse;
- sparse otherwise: compressed rows of ascending slots, built by two
  counting sorts and searched by bisection.

Appends extend the snapshot (a dense index in place when it has room); a
renumbering rebuilds it. What the next read would rebuild is released as
soon as the groups follow the change, so a pivot never holds a stale index.
Aggregates are read from the long table on demand.

**Generated column ids** are JSON arrays of a tag, the pivot field, the
value's kind and value (numbers as text, so infinities stay apart from
labels) or a missing or total tag, and the aggregate's name, operation, and
field. They hold no place, code, or display label, so layouts can key on
them.

**Bounds.** Before groups change they are asked what the change would make
them (`GroupBounds`): table rows tracked, and per level groups and values.
Groups being built ask as they grow, so a refusal comes as the limit is
passed. Groups following a view count first without changing anything, so
a refused change leaves them exactly as last published: they stop
following and answer from their own record of each row's group. Owned bytes
count the groups' typed arrays now, what growth would take under their
policies, the most readers can still make them take (every group's rows
listed, a sorted view's order, children lists), the index, the tables, and
fixed allowances per map entry, key, and generated column. A randomized test
of appends, drops, resets, filters, updates, and listings holds the typed
arrays within the limit at every step. The bound is an estimate, not a heap
cap: long labels and object overhead can exceed the allowances, and peaks
during reallocation are not counted.

A million rows by 100 row keys and 10 or 100 values builds in about 40 ms,
about as long as grouping by the two fields; the index takes at most about
5 ms. 100,000 row keys of two values each (about 200,000 combinations) take
0.16–0.28 s and 73 MiB, 39 MiB of it typed arrays (Node, Apple M6).

## Level of detail

Lines and areas over sorted x use **M4 aggregation**: within each
device-pixel column only the first, minimum, maximum, and last points of an
unbroken run are kept, at their real positions and in order. A line through
those points covers each pixel column over the same vertical extent as the
full line, unlike LTTB or averaging, which can drop peaks. Dropping
intermediate points shortens the path, so dash patterns can shift.

- **Bounded output.** At most four points per device-pixel column per run
  (step curves add a corner per point). Traced polylines
  (`lod/polyline.ts`, 8 bytes a point, reused between frames) grow by
  doubling but no further than the rows in view or four points per pixel
  column, then by an eighth at a time, so a series that keeps one more
  point each frame does not reallocate every frame.
- **Gaps** split a line into runs reduced separately, so data alternating
  between values and gaps reduces less. Inside time-axis breaks, points are
  left out without ending a run; columns are columns of time shown.
- **Cost.** The reduction scans the visible index range (found by binary
  search) every frame: O(visible points), about 0.8 ms per million
  (`npm run bench:core`). On linear scales, x is compared with a threshold
  just left of each column's right edge instead of being mapped; points at
  or past it get the exact test, and because the floating-point mapping
  never decreases, the result equals mapping every point. Long-format
  series scan through their rows with a loop of their own
  (`lod/m4-rows.ts`, loaded with the grouping); log scales and other row
  subsets use a per-point loop. Unsorted x is drawn point by point.
- **Y domains** come from the same visible range, so whole columns reduce to
  a min/max scan.

**Monotone curves** (Steffen's method, as d3's `curveMonotoneX`) bend lines
between the points LOD keeps, in pixels. Segments under 2 pixels wide stay
straight. A curved segment is one cubic Bézier whose control points the
polyline keeps (`Polyline.curveTo`), drawn as SVG `C`, canvas
`bezierCurveTo`, or PDF `c`, so curves add no vertices. Tracing reaches two
distinct x values past each edge of the view, so zooming does not change a
curve through unreduced data; where LOD reduces data, curves follow the
reduced points. Automatic y domains include the points just outside the
view, which bounds what a monotone segment draws. Bands and stacks are
reduced jointly (each column keeps its first and last rows and every
boundary's extremes) and curve each boundary once, shared by the layers on
either side; a segment where two boundaries could cross is straight for all,
so layers never overlap. Bands and stacks on log y are drawn straight.

### Min/max indexes

Lines, and areas filled to zero, over whole columns of at least 4,096 points
use a **min/max index** of their y field. It stores the positions of the
lowest and highest finite values of every 64-value block, and of every 512,
4,096, ... values above, plus whether a block holds a gap: about 1.4 MB for
ten million points, built in about 1.3 ms per million. With it, M4 finds each
column's end by binary search and its extremes by index query, and the y
domain is a query too. Columns containing gaps are scanned, and data where
most blocks hold gaps skips the index; the output is identical either way.

- The **table owns column indexes** and keeps them current: appends
  recompute trailing blocks, drops leave the index valid (it covers the
  whole buffer), small in-place updates recompute their blocks, and moving
  rows (compaction or growth) rebuilds it, O(1) amortized per appended row.
  A reset or a replace of at least a quarter of the rows drops it. Charts
  sharing a table share its indexes.
- A mark asks for an index only when nothing replaced the data wholesale
  since that chart's previous draw: zooming, panning, and streaming build
  one; data replaced before every draw never does.
- **Long-format series** of at least 4,096 rows use an index per group and
  y field (`RowsIndex`, `lod/rows-index.ts`), owned by the grouping and
  shared by every chart drawing the mark. It reads values through the rows
  (`y[rows[k]]`), copying none. Blocks are numbered from the group's first
  row ever, so a window's drops discard the blocks they empty and summarize
  the one they cut instead of moving every block. It costs about 0.16 bytes
  a row (up to twice that while growing, about four times after rows
  shrink) beside the rows' 4 to 6 bytes; without it, extents read every row
  in view at about 2.5 ns each. A change in place or a reset regroups the
  rows, and the indexes go with the old groups.
- Bands are not indexed; long stacks have their own (see
  [Series rows and stacks](#series-rows-and-stacks)).

Zooming into ten million points takes about 1.5 ms. Streaming 10,000 points
per tick into a million-point window takes a median of about 1.5 ms (whole
columns) or 2.1 ms (five long-format series), with ticks that move the
window's storage rebuilding the index (up to about 5 ms) (Node, Apple M6).

### Summaries that bound their own output

- **Histograms** keep bins, not values: on every table change one pass finds
  the extremes and another counts each series' values (by division for
  even edges, binary search for calendar ones; weights where given). At
  most a thousand bars are drawn. Measures follow from counts (frequencies,
  shares, fill per bin). Step and polygon elements are built from the bins'
  pixels, not through LOD. Faceted histograms count each panel's rows in one
  pass by series code.
- **Candlesticks** (and OHLC bars) merge rather than sample: with more
  candles in view than pixel columns, each column draws one candle with the
  first open, the last close, the highest high, and the lowest low, so no
  price extreme is lost.
- **Heatmaps and 2D histograms** draw one image of at most the plot's device
  pixels (see [Heatmap rasters](rendering.md#heatmap-rasters)).
- **Points** draw every point; `sampling: "pixel"` draws opaque points
  sharing a device pixel once, and large clouds go to the GPU (see
  [Points](rendering.md#points)).
