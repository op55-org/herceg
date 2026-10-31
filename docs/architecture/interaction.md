# Interaction architecture

How charts answer input, keep views, share them, select rows, and expose
themselves to applications and assistive technology. For what users can
do, see the [Interaction guide](../guide/interaction.md).

- [Inspection](#inspection)
- [Picking](#picking)
- [The interaction controller](#the-interaction-controller)
- [Bindings](#bindings)
- [Views](#views)
- [Brushes](#brushes)
- [Sync channels](#sync-channels)
- [Tooltips and crosshair labels](#tooltips-and-crosshair-labels)
- [Layout controls](#layout-controls)
- [Selected rows](#selected-rows)
- [Accessibility](#accessibility)
- [Revisions and causes](#revisions-and-causes)
- [The chart handle](#the-chart-handle)
- [Chart errors](#chart-errors)

## Inspection

Tooltips, hover and click events, the keyboard, and `inspect()` all read
the model's `inspect()`.

| Mode | Search |
| --- | --- |
| `nearest-x` | Binary search for the nearest x in each sorted series (O(log n) per series), reporting every visible series there. Only points inside the visible x range count. |
| `nearest-y` | The same along y, for horizontal bars (few per band axis, so scanned). |
| `nearest` | The closest point on screen: outward from the nearest x until points are farther away horizontally than the best match. Points, heatmaps, 2D histograms, and contours answer with their own index. |

- Marks only choose the default mode: `nearest-x` when every mark is drawn
  along x, `nearest-y` when every mark is drawn along y, else `nearest`.
- **Policy** (`Inspector` in `model/inspect.ts`, from the chart's
  `inspection`). Along an axis, `snap` says which point each series reads:
  `shared` finds the value nearest the pointer that any series has and
  reads every series there (`inspectAt`); `each`, `previous`, and `next`
  read each series' own nearest point, last at or before, or first at or
  after, by the same binary search, and the crosshair stands at the
  pointer, the latest, or the earliest read. `within` narrows each search
  to the pointer's value plus or minus it (pixels for `nearest`). A sorted
  series reads nothing between two drawn points its path ends between
  (`SeriesFeatures.pathEnds`: continuity gaps, `where`); unsorted series
  are scanned, and left out by `previous` and `next`. Marks with
  `inspect: false` show no series to read.
- `inspection: false` is the controller's: the pointer reads nothing, while
  the model's inspector stays, so the keyboard reads as before.
- Heatmaps and 2D histograms always report the cell under the pointer, and
  contours the band or line there; overlapping cells report the mark
  drawn last.
- An inspected point carries its identity: the mark's index in the chart,
  its `id`, the series key, and the row (`rowOf(series, position)`). Marks
  whose series index summaries (`summarizes`: histograms, box plots, boxen,
  violins) give no row; layout items give one where an item is one row.
  This costs three fields and one map lookup per point.
- Keyboard navigation keeps a position within a series, so repeated x
  values are each reachable. Other series are read at the first point each
  draws at the cursor's x, except where a mark pairs rows of its series
  (`Mark.alongside`, as stacked areas do).

## Picking

What input is on (an event's `target`, `clickedRows`, the keyboard
cursor's target) is found by one picker, `model/pick.ts`, which tests what
the frame on screen drew (the `DrawnMark` records of `marks/drawn.ts`),
never geometry made again from current data.

- **Order and reach.** Panels from the topmost (insets over their parent),
  marks by `zIndex` then as listed, each geometry as painted, the last
  painted first; the first within reach wins: containment for rectangles,
  areas, and text (an area's fill as drawn: its closed outline by nonzero
  winding across the axis it runs along, curves on the curve, the outline
  itself inside); a point's edge, a stroke's half
  width (an outlined area's upper edge too), or a rule's line plus the
  query's `slop` (4 px, 8 px for touch; a press resolved later reaches as
  its own pointer did). Points are found through their mark's index; of
  points as near, the highlighted, then the later. Nothing outside a
  geometry's or lookup mark's clip is picked, and a stroke is measured to
  what the clip shows of it (its segments cut to the clip widened by half
  its width); strokes of no width are not reached, though a rule's label
  is (`ruleDrawing.labelBox`). A query may name a
  series (a keyboard cursor's), and then reaches only that series' items.
  Marks with `pick: false` are passed over.
- **Paths to rows.** A line's or area's hit segment is resolved in its
  logical series (`drawn-parts.ts` builds the trace part): for sorted
  series, the eligible observation nearest the pointer along the axis
  among those inside the segment's span and the two bracketing it, in the
  run the segment draws (on a panel's own categories, by their places);
  for unsorted lines and areas, the path point's own position, which `drawn-parts.ts` finds by walking the series as it was
  traced (rows the trace cannot draw end a run, rows a break hides are
  left out, steps add their corners) when first asked.
- **Lookups.** Marks whose geometry says too little (candlesticks,
  distributions, heatmaps, 2D histograms, contours, error bars, rugs) pick
  their own items (`Mark.pickItem`), through the lookups the picker hands
  them in the query (`marks/lookups.ts`), so their picking code loads with
  the picker rather than with every chart. Layout marks pick through
  `LayoutResult.itemAt`. Custom marks pick the items their `item` calls
  drew by their shapes (`Mark.pickItem`, through a grid of the items'
  boxes), or, drawing none, their series' nearest point within 3 px plus
  the slop; ranges drawing none are not picked.
- **Loading.** The picker is a chunk of its own, loaded by the controller
  once a `hover`, `click`, or `contextMenu` listener is added or a row
  selection taking clicks needs it; until it loads, input that needs it
  waits, and is resolved, in order, once it is here (each Enter on what
  the keyboard cursor was on when it was pressed: a row by its identity
  in the table its mark reads, an aggregate or cell by its place,
  categories by name; nothing for one gone since). Once one chart on a page has
  loaded it, later charts take it at once. What it reads series with
  comes from the chart in a kit (`PickKit`), so the chunk shares no
  module with a chart's first chunk.
- **Input resolution.** A record is current while the tables and views it
  read keep their versions and the chart's options and marks are
  unchanged. Clicks and context menus arriving while it is not wait; the
  chart resolves them in `#finishFrame` right after the next frame draws
  (`Interaction.resolve`), capturing the payload before any listener runs,
  and the controller emits them after drawing. A target's `row` resolves
  the row picked when read. Each input event keeps the panels drawn as it
  was captured, so writing it as JSON later (`web/events.ts`) reads the
  axes it acted on.

## The interaction controller

What answers input is one module, `dom/interaction.ts`, loaded with a
dynamic `import()` right after a chart's first frame (an animation frame
and a task later; at once in a hidden page) or at its first input. It holds
the pointer's inspection and hover events, the tooltip's DOM, crosshairs
and outlines, the keyboard cursor and announcements, the wheel, drags,
pinches, keys, edge reports, and synced cursors. Its chunk also holds the
bindings (`model/bindings.ts`) and keyboard stepping (`model/keyboard.ts`).

What a chart *is* stays synchronous in `dom/chart.ts`: options and state,
`inspect`, pixel mapping, formatting, viewport, visibility, and selection
methods and their events, the description, the legend, and selection
highlighting. The controller changes the chart through a host
(`InteractionHost`) and receives the chart's few shared helpers as a kit,
so it imports nothing in a chart's initial chunks and bundlers split no
shared chunk out of them.

**Input before the controller.** A gate on the chart's root (`#gate`)
keeps input until the controller attaches: the latest of consecutive
pointer moves (all of them while a press is held, up to 256), and keys,
presses, releases, wheels, double clicks, and blurs in order. It decides in
the original event what must be decided there: drag bindings match the
press, accepted drags capture the pointer and prevent text selection, and
wheels and keys a binding takes have their defaults prevented. The
controller replays what was kept through its own handlers, so an early
drag goes on and an early hover shows its tooltip.

**Failure.** If the import fails or the controller refuses the options
(bindings it cannot compile), the chart reports a [chart
error](#chart-errors), releases captured presses, drops kept input, and
takes no input, while drawing and answering its methods as before.
`chart.loading` includes the import.

**Python** single-file bundles inline the controller, so they fetch
nothing; its web assets split it into a chunk as npm builds do.

The controller's chunk size is in the [size
results](../comparison.md#bundle-size); what deferring it costs a first
hover is measured by `npm run bench:first-hover`
([methodology](../../benchmarks/README.md#first-hover)).

## Bindings

Input means what the chart's bindings say (`model/bindings.ts`): a list of
gestures (wheel, drag, pinch, key, double click, with modifiers matched
exactly) and actions (pan, zoom, brush, reset, cursor, orbit, moveItem,
pageScroll).

- **Presets are short forms.** `pan`, `zoom`, `brush`, `rotate`, and `drag`
  compile to bindings once per configuration (`new Bindings(interaction)`),
  after `interaction.bindings`. The form is portable: specs and Python
  write the same bindings.
- **Matching** takes the first binding whose gesture fits and whose action
  applies where the input happens (`match(type, event, applies)`): pans
  and brushes over a plot, orbits over a 3D panel, moves on a node.
  `pageScroll` matches and does nothing, so the page keeps the input.
- **One list everywhere.** The axis controller, the layout controls, and
  the input gate match the same list, so `zoom` means the same in every
  chart. Subplots with settings of their own (`panels[i].interaction`) get
  lists of their own.
- **Refusals** (a gesture bound twice, the keyboard cursor's keys without
  Ctrl, Alt, or Meta, a zooming brush where brushes select rows) are made
  by the compiler, which the spec validator also runs, so specs and code
  refuse the same.
- **Touch policy.** `touch-action` on the root follows the bindings: the
  axis a touch drag moves along is the chart's, the other the page's, and
  pinches the page's unless a binding zooms with them.
- **Pixels, not values.** Pans and zooms work in pixel space through the
  scales, so they behave the same on log and broken time axes. Wheel
  steps, pinch moves, and keys between frames add up without drawing, each
  acting on the view the one before asked for (`#shown`).
- A press becomes its drag's action after 3 px; one that does not move is
  a click. Escape ends a drag, putting a pan back if nothing else moved the
  view meanwhile.

## Views

Views live in one store keyed by scale instance (`viewKey(scale,
instance)` in `ChartModel`). Each position scale (x, y, right y) has an
instance per group of panels sharing it (`ScaleInstance`): `""` for the
one every panel shares, else one named by its panels' keys. A gesture acts
on the instances of the panel it starts in; every panel drawing them
follows. Only what has no meaning is refused: ranges on category axes, and
axes a panel lacks.

**Transactions.** Every change of view (`setViewport`, a wheel step, a pan
move, a brush zoomed to, a reset, a synced range) runs in one
`#changeView`: snapshot, change, then one `viewport` event carrying the
`viewRevision`, the cause, the panel, each instance changed, and every
panel drawing one with its whole view. A listener's own change is the next
transaction, delivered once this one reached every listener. A map's or
network's plane is an x and a y instance joining the same transactions.
Instances a new scene no longer draws are reported fitted. `setViewport`
checks the whole change before changing anything; its refusals are
`ChartError`s with the scale or `"panel"` as `path`.

**Limits** (`ChartModel.#limit`, in `setView` and for views kept by
`update`) keep each instance inside its extent, so every way of asking for
a view is limited the same. Log axes compare ratios. A fitted view is not
limited: that would need the fitted domain, which only planning the scene
finds. Panels sharing an instance must agree on its limits.

**Edges** are reported by the controller after each frame
(`#reportEdges`): a latch per instance and side, set within `threshold` of
an end and cleared at `threshold + hysteresis`, keeping the bound it was
set at, so a view held near an end reports once, and again when the end
moves. Fitted instances report no edge: otherwise a page loading history
on edges would load, widen the extent, refit, and hear of the new end
without end. Ends of the data bound only an x every panel shares.

**Restoring state.** A chart mounted in place of another (a Streamlit
rerun, a widget drawn again) takes its state back:
`viewportStatePayload` lists every instance's view with an opaque
identity; `restoreViewportState` (`herceg/web`) gives a new chart the
views of instances it draws again and fits the others, as one transaction
of cause `"options"`. `visibilityState` and `restoreVisibility`
(`herceg/spec`) do the same for hidden series.

## Brushes

A brush selects a range, a rectangle, or a lasso (thinned past 400
points); rectangles and lassos need 3 px each way. Selections are kept in
data values, so they stay on their data as the chart zooms or resizes, and
drawn in the pointer overlay, clipped to each plot.

- The chart keeps the selection and its rules (`dom/brushed.ts`); the drag
  and its drawing (`dom/brush.ts`) load when a chart can brush or first has
  a selection to show. The brush receives the rules from the chart rather
  than importing them, so no shared chunk splits out.
- When zoom covers every axis a selection has a range on, releasing the
  brush (or Enter) sets the viewport instead; lassos never zoom, and
  brushes that write rows never zoom.
- With `tooltip.axisLabels`, crosshair labels come from
  `dom/axis-labels.ts` ([below](#tooltips-and-crosshair-labels)).

## Sync channels

`interaction.sync` names a group per channel (`dom/sync.ts`): the cursor,
the view, and the selection, each on one of the chart's scales.

- **Endpoints.** A channel's endpoint is a scale instance (`#endpoint`):
  the named panel's, else the one every panel shares. A chart without one
  shares and receives no views or selections on that channel. A cursor is
  a value along an axis, not a view, so without `panel` it goes from the
  hovered panel and shows in every panel.
- **Delivery** is synchronous within a page: a member hears a broadcast
  before `setViewport` returns. Members apply what they receive
  (`SyncMember.receive`) without sharing it again; a broadcast that a
  receiver's listener supersedes stops, so no member ends on the older
  value.
- **Before the first frame**, while a chart loads code that frame needs,
  views and selections set on it apply at once, and their reports and
  shares wait for the frame (`#early` and `#reports` in `dom/chart.ts`).
  On charts of facets, subplots, maps, or networks, whose panels and
  planes that frame draws, calls and what synced charts share wait too,
  and the frame makes them in order. The reports come after them,
  sharing each channel's state then, so a newer value a synced chart
  sent is not overwritten by an older local one.
- **Values as data.** Numbers and times as they are, categories by name
  (`#encode`, `#decode` in `dom/chart.ts`), so charts with other
  categories show the same one. A chart shares and shows cursors along the
  axis its data is placed on (`cursorAxis`).
- **What the pointer shares** is the value its crosshair is drawn at (a
  line's nearest point, a cell), so peers show what its readout shows.
  The inspection is read once per scene and place (`Interaction.#read`).
- **Snapping** of shown cursors: a received cursor is read by the
  inspector's policy (see [Inspection](#inspection)) with the channel's
  `snap`, by default the chart's own. Once drawn, it is reported as a
  `hover` with cause `"sync"` (or `"api"` for `showCursor`).
- **Across panels** (`sync.panels`, `#across`), the cursor shows at the
  hovered x in panels sharing the x scale, and with `panels` on, in panels
  with their own.
- **Across copies.** The registry (groups' members and broadcast
  revisions) lives on the global object under
  `Symbol.for("herceg.sync/1")`, so charts made by separate copies of the
  engine (notebook widgets each importing their own) join the same groups.
  Members meet only through `receive` and plain values.
- **Across frames.** Charts in a frame of opaque origin (sandboxed static
  notebook outputs) load a relay (`dom/relay.ts`) that greets every frame of
  the page's tree, posts what its charts share to frames that answer
  (tagged `herceg.sync/1`), checks what it hears (numbers, names up to
  1,000 characters, selections up to 100,000 names or lasso points), and
  broadcasts it in its frame as their member. Tested in Chrome, Firefox,
  and WebKit with sibling and nested frames; not yet tried inside JupyterLab,
  Notebook 7, VS Code, or Colab.

## Tooltips and crosshair labels

- The built-in tooltip keeps its rows from one move to the next, writing
  only text and colors that changed.
- Values are written with the axis' `tooltipFormat`, else its `format`, the
  same formatter `formatValue` and the keyboard use.
- **Fields.** Marks check `tooltip.fields` against their tables when made
  (`marks/tooltip-fields.ts`). Reading and writing them
  (`dom/tooltip-content.ts`) loads the first time a chart has fields or
  `renderTooltip`: the chart gives the model a reader per panel, in its
  locale and time zone, and inspections carry the fields. Layout items
  read fields at their row, or at the one row `rowsOf` gives.
- **`renderTooltip`** content is asked for when what the tooltip is at
  changes (compared as JSON, with the theme and renderer) or the chart's
  revision does (data or options), and never of an inspection the data
  changed since: the controller drops one a hover or edge listener's
  change made stale, and the adapters render content only while the marks
  and their tables' versions are those it was made on. A resize
  observer places the box again as its content changes size, so the
  adapters render into it after the call: React through a portal, Vue
  through a teleport, Svelte into an element of its markup.
- **Crosshair labels** (`dom/axis-labels.ts`) are HTML boxes placed by CSS
  transforms (`clamp()` and `calc()` over the box's own size), so moving
  the cursor measures no text and lays nothing out in script. The module
  imports no code, so loading it moves nothing out of a chart's bundle.
- Hover listeners receive inspections even with the built-in tooltip off,
  which is how an application draws its own.

## Layout controls

Layout marks are navigated by controls of their family, each its own lazy
chunk:

| Family | Module | Does |
| --- | --- | --- |
| 3D charts | `dom/orbit.ts` | Turn the camera |
| Maps (and network planes) | `dom/map-controls.ts` | Pan, zoom, lasso |
| Treemaps, sunbursts | `dom/drill.ts` | Drill in and out, with breadcrumbs |
| Networks | `dom/node-drag.ts` | Move nodes |

- A mark names the controls its options turn on
  (`LayoutMark.controls(config)`, with the sentence the description adds
  about its keys) and the parts of `interaction` it takes
  (`LayoutMark.interactions`); `ItemViews.interactions` refuses the rest.
- The chart loads `dom/layout-controls.ts` with one `import()` when its
  marks ask for controls, which loads each family once and mounts it with a
  host (`dom/controls.ts`). The optional `ItemViews` runtime owns active
  controls, their pending import, and their latest scene, with no browser
  imports. Promise identity rejects obsolete imports.
- Controls match the chart's bindings (`ControlsHost.bindings()`), listen
  on the root with their keys in the capture phase, and change the chart
  through its public methods or the item state behind `setDrillRoot` and
  `setItemPosition`.
- Each command starts from the pending state, so presses faster than
  frames add up. Node moves name the layout they were made in, so a move on
  a network whose data changed and is not drawn again is dropped rather
  than misplaced.
- They share a toolbar (`dom/toolbar.ts`) of named buttons, focusable while
  hidden. Ordinary line charts carry only the public setters and small
  bridges for loading, drawing, and events.

## Selected rows

A chart's `rowSelection` binds it to channels of selection stores, one per
table its marks read (`model/row-selection.ts`). The binding is an object
made by `rowSelection()`, so its code comes only with charts that import
it; charts without one carry the hooks that call it and the sentence of
how many rows are selected.

**Binding.** The model calls the binding's `check` as it validates
(refusing gauges, radars, 3D marks, stores of tables no selectable mark
reads, and brushes over summaries' statistics), and the mounted chart
calls `mount`, which returns a `RowLink`: store subscriptions, what the
chart's gestures wrote, and the model's `highlight` hook. The chart calls
the link where gestures end. Selections from synced charts and
`select(…, { rows: false })` write nothing. The link handles Space and
Escape after the chart's own keys. The model directory stays free of the
DOM: the link reads the chart through a structural interface.

**What a gesture selects** (`model/selected-rows.ts`) comes from what the
last scene drew, so rows not drawn (outside bands, in breaks, unplaceable)
are never selected by lassos, clicks, or keys.

| Gesture | Writes |
| --- | --- |
| Range brush | Per table, the disjunction over marks in its panels of each mark's condition: its places along the brushed axes in range (category ranges as label lists), joined with a series field's shown series, a row view's filter, and the facet panels covered. Stacks brushed along values select their drawn tops as rows. |
| Lasso | Each row's anchor tested against the outline in pixels, after its bounding box (bars through `BarMark.placement`). |
| Click | The picker's topmost item under the pointer among marks of bound tables ([Picking](#picking)): its row, or a summarized point's rows through `Mark.summarized`. |
| Layout items | The mark's own `rowsOf` (a slice's counted rows, a subtree's rows, a link's rows) and `lassoed`. An item standing for no bound row changes nothing. |

Results are computed for every table before any channel changes.

**Membership** (`model/highlight.ts`) is a byte per table row, kept per
table and selection in weak maps (so charts showing one selection share
it) while the table's version is the same. When a table only appended or
dropped rows, kept rows keep their bytes and only new rows are tested, so a
live condition over a rolling window costs the new rows. Brush conditions
are tested a column at a time (a range in one branch-free pass); other
conditions row by row through the compiled condition.

**Highlighting** replaces a mark's geometry through the model's hook while
its table's channel holds a selection.

- Glyph-per-row marks draw twice through their own geometry: unselected
  rows dimmed (`fillOpacity` × 0.25) and selected rows, under keys of their
  own (`\u0001off`, `\u0001on`) so they draw into buffers of their own.
- Lines and areas draw whole and dimmed outside the pixel spans of runs of
  selected rows and as drawn inside them (an SVG `clipPath` or a canvas
  clip), so the highlighted part is the very curve, level of detail, and
  stack the mark drew, and each pixel is painted once. Where no span tells
  rows apart, selected values are drawn over the dimmed line at an opacity
  that composites to the original color.
- Large GPU point series draw as two clouds that stream as their cloud does
  (`PointCloud.stream`), so the selection stays on the GPU.
- Summaries draw their own selection (`Mark.selectedGeometry`) through what
  the highlighter lends (`SelectionDrawing`): histograms bin the selected
  rows' weight, distribution marks summarize the selected values
  (`Summary.whole`, `partWidth`, `partDensity`), heatmaps and 2D histograms
  draw squares (`marks/cell-selection.ts`) or a second image when cells are
  tiny or many.
- Layout marks highlight through their frame (`LayoutFrame.selected`): maps
  and networks dim what is not selected; pies, funnels, trees, and Sankey
  links draw each item's selected share (`sectorShareRadius` in
  `draw/arc.ts` for slices).
- Exports read the highlight from geometry (`Drawing.opacity`,
  `Drawing.clip`), which SVG, canvas, and the PDF painter apply.

**Python numbering.** A widget's rows are numbered as Python numbers them:
the browser reports row-set identities with the drops and replaces Python
has seen, so Python maps them to its current positions and ignores reports
of an earlier generation. Streamlit remounts a chart when its payload
changes, so its positions are qualified by a digest of the data: a run that
only restyles keeps the clicked and lassoed rows. Conditions Python sets
must test columns the chart sends (a binding's `fields` adds others).

## Accessibility

- The chart root is a focusable `figure` named by the title and described
  by a generated summary, refreshed at most once a second, in a hidden
  element so it is read once. A range navigator adds its overview and
  range to the summary; its sliders announce through their own polite live
  region.
- Keyboard values are announced whole through a polite, atomic live
  region. The tooltip and drawings are hidden from assistive technology.
- Keyboard stops come from `ChartModel.keyboardStops` per panel: series
  sharing their positions share a stop, as one inspection reports them all.
  Heatmaps step through `Mark.stepCell`.
- Legend entries are buttons with `aria-pressed` in a group named "Legend".
- Static SVG has `role="img"`, `<title>`, and `<desc>`; PDF alternative
  text is the same summary.
- `test/browser/accessibility.test.ts` runs axe-core and reads each
  engine's accessibility tree ([Browser tests](../contributing.md#browser-tests)).

## Revisions and causes

`chart.revision` (`MountedChart.#revision`) counts changes of options,
data, and state: views, the selection, hidden keys, drill roots, cameras,
and moved nodes. Every change follows one order:

1. It applies, and the revision increments once for it: a write to a
   table once, however many of the chart's views of it show it (their own
   changes counted by `RowView.queryRevision`, a write made by a listener
   during another included), and a view's own change (a new query or
   restriction) once. Options the chart refuses count nothing.
2. Its event reports it with its `cause` (`ChangeCause`: `"pointer"`,
   `"wheel"`, `"keyboard"`, `"api"`, `"sync"`, `"data"`, `"options"`) and
   the revision it made (`StateChange`); views report as transactions
   ([Views](#views)), and cameras once per frame, each with the revision
   counted when it was set, whatever changes follow before its report (a
   camera options replace before then is reported as theirs). Controls of
   layout marks select with their gesture's cause (`ControlsHost.select`:
   a map's lasso `"pointer"`, Escape `"keyboard"`). What a listener changes in turn (drilling elsewhere
   when the data took its root away, say) is a change of its own:
   `"api"`, with its own revision.
3. The next frame draws it: the scene records the revision it was built
   at (`ChartModel.revision`, set as the scene is planned), which its
   drawn-mark records and the `render` event carry. A selection is drawn
   over the last scene without building one: once no scene and no brush
   code waits, that frame renders with the chart's latest revision,
   unless the chart's content is failing to draw (what is on screen stays
   the revision before it, until a frame draws).

So a change at revision *r* is on screen once a `render` of *r* or later
arrives; `chart.drawnRevision` reads the revision on screen (undefined
until a frame draws). The adapters tell their `render` handlers of the
first frame, drawn as the chart is created before they listen, with that
revision, and of a first frame still waiting for code when it draws.
`hover`, `click`, and `contextMenu` carry an `InputEvent`: the pointer
(its panel, whether in the plot, and its values and categories on the
panel's axes), the target picked, the inspection, the input's cause
(`"pointer"`, `"keyboard"`, `"sync"`, or `"api"` for `showCursor`), and
the revision of the frame the input acted on, which may be older than
`chart.revision` while a change waits for its frame; a hover the next frame reads again (the pointer resting while the
data changes) carries that frame's. Gestures of layout controls pass their cause: a button of a legend, a
toolbar, or breadcrumbs pressed from the keyboard clicks with no count and
is `"keyboard"`, and a hover cleared with nothing to read (Escape, the
pointer leaving) keeps the cause of what read last. A drill root the data or
options took away is `"data"` or `"options"`, counted with that change (the
frame's revision, taken before listeners run, as a camera options replaced). The `viewRevision` of views is a
count of its own; failure reports and tooltip staleness keep counting
options and data alone (`#content`). Python's widget reports state without
the cause and revision; the browser's `herceg/web` events carry both.

## The chart handle

`createChart` returns `Chart`, an interface (`dom/handle.ts`) rather than
the class behind it (`MountedChart` in `dom/chart.ts`), so what
applications call is a deliberate list. The adapters hand out the same
interface. The model, the chart's frame-loop entry, and its sync membership
are private.

- **Snapshots.** `getPanels()` gives copies of the last scene's panels, not
  the engine's scales, so scales and their tick and break machinery stay
  free to change. Pixel mapping, formatting, legend entries, and
  inspection read the last scene too and never draw, so pointer handlers
  cost no frame. The model caches its panel list per scene, so mapping
  many values allocates nothing.
- **Export** goes through one method keyed by a symbol
  (`render/export-scene.ts`), which draws what is pending and hands a scene
  of the current state to a writer: `toSVG`, `toPNG` (through
  `image/raster.ts`, loaded on first use), and `renderToPDF` in
  `herceg/pdf`. The chart carries no PDF code and the handle no PDF method.
- **Hiding series** has one path: legend buttons, `setVisibility`,
  `setHiddenKeys`, and updates removing marks all change the model's hidden
  set and report one `visibility` event. Hidden keys outlive their series
  but not what owns them.
- **Batching.** Changes of view mark the chart dirty without marking its
  panels changed, so several `setViewport` and `select` calls draw once.
  Changes that may change the panels, their scale sharing, or category
  axes (`#shapeChanged`) draw before a call naming a panel.
- **Marks are opaque.** Mark functions return `ChartMark`, whose `spec` is
  public; a type-only brand keeps charts to marks those functions made.
  What marks implement (`Mark`, `LayoutMark`, `Frame`, series, geometry) is
  internal: publishing it would commit to buffer reuse, scene counters,
  GPU decisions, and the layout of series. `custom()` is the extension API
  ([Marks](marks.md#custom-marks)); a lower-level one would follow
  demonstrated needs.

## Chart errors

What keeps a chart from drawing has one shape everywhere
(`spec/errors.ts`): `ChartErrorInfo`, JSON-safe.

| Field | Is |
| --- | --- |
| `code` | What programs react to (`invalid-option`, `unsupported`, `layout-failed`, `load-failed`, ...) |
| `phase` | `validate`, `compile`, `load`, `layout`, or `render` |
| `message` | "location: problem; correction", starting at the path |
| `path`, `mark`, `panel` | Where, when known (`marks[1].color`; the mark's `id` or index) |

- The engine throws `ChartError`, an `Error` with that info. Mark functions
  give paths within their options and the spec loader and chart place them
  (`within`). Python raises `herceg.ChartError`, a `ValueError` with the
  same fields in Python's spelling (`Chart facet: ...`, `line
  stroke_width: ...`), and checks what it can before the engine.
- A mounted chart reports through one path (`MountedChart.#fail`), once per
  change of options or data: `ready` rejects if nothing was drawn,
  `onError` and `"error"` listeners hear it, else the console.
- With `errorMode: "inline"` (default), the chart shows a box of its size
  in its place, or a banner over the last frame for a refused update
  (`dom/errors.ts`; styling in `dom/failure-style.ts`, loaded with the first
  failure). A refused update changes nothing: the model configures
  transactionally. With `"throw"`, creation and `update` throw.
- Adapters with `errorMode="throw"` throw in the framework's render, so
  error boundaries catch it. Python's HTML, widgets, Streamlit, and web
  fragments show the same box.
