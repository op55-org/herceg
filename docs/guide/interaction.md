# Interaction

What dragging, the wheel, touch, and keys do; how charts share cursors,
views, and selections; tooltips; events; linked row selections; the range
navigator; animation; and reading panels and pixels.

- [Pan, zoom, and brush](#pan-zoom-and-brush)
- [Bindings](#bindings)
- [View limits](#view-limits)
- [Sync](#sync)
- [Tooltips](#tooltips)
- [Events](#events)
- [Selected rows](#selected-rows)
- [Range navigator](#range-navigator)
- [Animation](#animation)
- [Hiding series](#hiding-series)
- [Panels and pixels](#panels-and-pixels)

## Pan, zoom, and brush

`interaction` (Python: `pan=`, `zoom=`, `brush=` and the others as chart
options) says what input does. Its presets cover the common cases:

| Option | Values | Does |
| --- | --- | --- |
| `pan` | `true` (x), `"x"`, `"y"`, `"xy"`, `false` | Dragging pans; the horizontal wheel (or Shift with the wheel) pans x; double-click resets. Category axes do not pan. |
| `zoom` | `true` (x), `"x"`, `"y"`, `"xy"` | The wheel with Ctrl or ⌘, a pinch, and `+`/`-` zoom; `0` and double-click reset; dragging pans unless `pan: false`. Maps and networks zoom both ways (with the wheel and keys), 3D charts magnify, treemaps and sunbursts drill into nodes. |
| `brush` | `"x"`, `"y"`, `"xy"`, `"lasso"` | Dragging selects a range, rectangle, or freehand region (a `select` event); a click clears. Where `zoom` covers its axes, it zooms instead (a lasso still selects), and Shift-drag pans. |
| `bindings` | `[{ gesture, action }]` | Gestures of your own ([below](#bindings)). |
| `limits` | `{ x?, y?, yRight? }` | How far views may go ([below](#view-limits)). |
| `sync` | a group's name, or channels | What the chart shares ([below](#sync)). |
| `rotate` | `true` (default), `false` | Dragging turns 3D charts. |
| `drag` | `true` | Dragging a network's node moves it. |

```ts
createChart(element, { marks, interaction: { zoom: "x" } }); // drag pans, Ctrl/⌘+wheel or pinch zooms
createChart(element, { marks, interaction: { pan: "x" } }); // pan only
createChart(element, { marks, interaction: { pan: "x", brush: "x" } }); // drag selects, Shift-drag pans
createChart(element, { marks, interaction: { zoom: "x", brush: "x" } }); // drag zooms to a range
```

```python
hg.Chart(df, zoom="x")
hg.Chart(df, pan="x", brush="x")
```

**Pages scroll past charts.** Without a modifier, the vertical wheel
scrolls the page wherever the pointer is; a chart takes the wheel only with
Ctrl or ⌘ held (which trackpads send for a pinch) or sideways. Touch swipes
along an axis the chart does not pan or brush scroll the page; pinches zoom the page
unless the chart zooms. Maps and networks take every touch.

- Escape during a drag ends it: a brush is dropped, a pan returns, a moved
  node goes back.
- Interaction code loads right after the first frame; input arriving
  earlier is kept and handled in order once it loads.
- Drags prevent page text selection; static chart text stays selectable.
- Zoom, pan, and brushes work on number and time axes, in every panel and
  inset, on the scales of the panel they start in. Charts without axes
  refuse `limits` and `pan`, except on maps' and networks' planes.

## Bindings

A binding is a gesture and the action it performs. `bindings` are tried in
order before the presets'.

```ts
createChart(element, {
  marks,
  interaction: {
    zoom: "x",
    bindings: [
      // The plain wheel zooms while the chart has the keyboard focus.
      { gesture: { type: "wheel", axis: "y", focused: true }, action: { type: "zoom", axes: "x" } },
      // Touch scrubs the cursor instead of panning.
      { gesture: { type: "drag", pointer: "touch" }, action: { type: "cursor" } },
      // The right button pans y.
      { gesture: { type: "drag", button: 2 }, action: { type: "pan", axes: "y" } },
      // Alt+Page Down pans a page right.
      { gesture: { type: "key", key: "PageDown", modifiers: ["alt"] }, action: { type: "pan", step: [1, 0] } },
    ],
  },
});
```

```python
hg.Chart(df, zoom="x", bindings=[
    hg.Binding(hg.WheelGesture(axis="y", focused=True), hg.ZoomAction(axes="x")),
    hg.Binding(hg.DragGesture(pointer="touch"), hg.CursorAction()),
])
```

| Gesture (Python) | Options | Actions |
| --- | --- | --- |
| `wheel` (`hg.WheelGesture`) | `axis` (`"x"`, `"y"`), `focused` | `pan`, `zoom`, `pageScroll` |
| `drag` (`hg.DragGesture`) | `button` (0, 1, 2), `pointer` (`"mouse"`, `"touch"`, `"pen"`) | `pan`, `brush`, `cursor`, `orbit`, `moveItem`, `pageScroll` |
| `pinch` (`hg.PinchGesture`) | | `zoom`, `pageScroll` |
| `key` (`hg.KeyGesture`) | `key` as `KeyboardEvent.key` names it | `pan`, `zoom`, `reset` |
| `doubleClick` (`hg.DoubleClickGesture`) | | `zoom`, `reset` |

Every gesture but a pinch takes `modifiers`, matched exactly (`["shift"]`,
`["ctrl"]`, `["alt"]`, `["meta"]`). A gesture may be bound once. Keys the
keyboard cursor uses (arrows, Home, End, Page Up and Down, Escape, Enter)
can be bound only with Ctrl, Alt, or Meta.

| Action (Python) | Options | Does |
| --- | --- | --- |
| `pan` (`hg.PanAction`) | `axes` (`"x"` default; a plane both ways), `step` for keys (`[0.1, 0]`) | Moves the view |
| `zoom` (`hg.ZoomAction`) | `axes`, `factor` (2 for double clicks, 1.25 for keys) | Zooms about the pointer, or keys about the plot's middle |
| `brush` (`hg.BrushAction`) | `shape` (`"x"`, `"y"`, `"xy"`, `"lasso"`), `zoom: true` | Selects, or zooms to the range on release |
| `reset` (`hg.ResetAction`) | | The configured view |
| `cursor` (`hg.CursorAction`) | | Moves the cursor and tooltip with the drag |
| `orbit`, `moveItem` | | Turns a 3D chart; moves a network node |
| `pageScroll` (`hg.PageScrollAction`) | | Leaves the gesture to the page |

The presets stand for these bindings, tried after the chart's own:

| Preset | Gesture | Action |
| --- | --- | --- |
| `brush` | drag; also Shift-drag in a chart that does not pan | brush, zooming where `zoom` covers it |
| `drag` | drag on a network's node | move the node |
| `pan`, `zoom` | drag (with no brush, or a lasso), Shift-drag | pan |
| `rotate` | drag | turn a 3D chart |
| `pan`, `zoom` along x | horizontal wheel, Shift+wheel | pan x |
| `zoom` | Ctrl/⌘+wheel, pinch; `+`/`=` and `-`; `0` | zoom about the pointer; zoom by 1.25; reset |
| `pan`, `zoom` | double-click | reset |

A brush that zooms cannot write rows, so such a binding is refused in a
chart whose brushes select rows.

## View limits

`limits` sets, per scale, how far its view may go and when nearing its ends
is reported.

| Option (Python `hg.ViewLimits`) | Does |
| --- | --- |
| `extent` | `[from, to]`, either `null` for no end (epoch ms on time axes). Every view asked for stays inside, however it is asked for. A pan keeps its span and stops at the end; a view wider than the extent shows the extent. |
| `edge` | `true` or `{ threshold?, hysteresis? }` (Python `hg.Edge`): an `edge` event when the view comes within `threshold` (0.1 of its span) of an end of the extent (or of the data, on a shared x without an end), and again only after moving `hysteresis` (0.05) away or the end moving. |

Only a view set (zoomed, panned, synced, or by `setViewport`) comes near an
end; a scale fitted to its data reports none. A chart of recent prices that
loads older ones as the reader pans back:

```ts
const prices = table({ at: time(recent.at), close: recent.close });
let oldest = recent.at[0];
const interaction = () => ({ pan: "x" as const, limits: { x: { extent: [oldest, null] as const, edge: true } } });
const chart = createChart(element, { marks: [line(prices, { x: "at", y: "close" })], interaction: interaction() });
chart.on("edge", async ({ side }) => {
  if (side !== "start") return;
  const older = await fetchBefore(oldest); // the application's loader
  oldest = older.at[0];
  prices.reset({
    at: time(Float64Array.from([...older.at, ...prices.numbers("at")])),
    close: Float64Array.from([...older.close, ...prices.numbers("close")]),
  });
  chart.update({ interaction: interaction() }); // the view stays where it is
});
```

```python
live = hg.Chart(recent, pan="x", limits={"x": hg.ViewLimits(extent=(first, None), edge=True)})
```

## Sync

`sync` shares the cursor, the view, and the selection with other charts on
the page. A group's name shares all three along x; the object form sets
each channel on its own.

```ts
createChart(a, { marks: cpu, interaction: { zoom: "x", sync: "hosts" } }); // cursor, x range, selection
createChart(b, { marks: memory, interaction: { zoom: "x", sync: "hosts" } });
createChart(c, { marks: errors, interaction: { zoom: "x", sync: { cursor: "hosts" } } }); // cursor only
createChart(d, { marks: byHour, interaction: { sync: { cursor: { group: "hosts", scale: "y" } } } }); // horizontal bars
```

```python
hg.Chart(df, zoom="x", sync="hosts")
hg.Chart(df, sync=hg.Sync(cursor="hosts"))
hg.Chart(df, sync=hg.Sync(cursor=hg.SyncChannel("hosts", scale="y")))
```

| Channel | Values | Shares |
| --- | --- | --- |
| `cursor` | a group, or `{ group, scale?, panel?, snap?, tooltip? }` | The pointer's or keyboard's position along `scale` (x by default), shown elsewhere as a crosshair and the points there. |
| `viewport` | a group, or `{ group, scale?, panel? }` | The range in view. |
| `selection` | a group, or `{ group, scale?: "x" \| "y" \| "xy", panel? }` | Brushed ranges; `"xy"` (default) shares rectangles and lassos too. |
| `panels` | `true`, `false`, or `{ snap?, tooltip? }` | The cursor across the chart's own panels: on by default for panels sharing x; `true` also for panels with x scales of their own. |

How a chart shows a cursor that is not its pointer's:

| Option | Does |
| --- | --- |
| `snap` | `"nearest"` (default): the nearest x and each series' point there. `"previous"`: each series' last point at or before the value (a 10:37 cursor shows an hourly chart's 10:00 reading). `"next"`: the first at or after. |
| `tooltip` | `true` shows the chart's tooltip at the crosshair. |

```ts
const cursor = { group: "ops", snap: "previous", tooltip: true } as const;
createChart(recent, { marks: [line(minutes, { x: "at", y: "load" })], interaction: { zoom: "x", sync: { cursor } } });
createChart(month, { marks: [line(hours, { x: "at", y: "load" })], interaction: { zoom: "x", sync: { cursor } } });
```

- **Values travel as data**: numbers, epoch ms, and categories by name, so
  charts with other categories show the one the other chart is on. A
  selection of categories arrives as the range between the first and last
  the receiving chart has, which can take in categories between them.
- **Panels.** In a chart of several panels, a channel shares the scale
  every panel shares, or `panel`'s. A chart whose panels have scales of
  their own shares no views or selections unless it names a panel.
- **Showing a cursor from outside.** `chart.showCursor({ x: order.time })`
  shows the cursor where an application says, and `hideCursor()` hides
  it; both reach the chart's cursor channel unless `{ broadcast: false }`.
- **Before the first frame.** A view or selection set right after
  mounting, while the chart still loads code its first frame needs,
  applies at once (`getViewport` and `selection` read it); its `viewport`
  or `select` event and what synced charts receive follow with that frame,
  naming the panels it draws. On a chart of facets, subplots, maps, or
  networks, whose panels and planes that frame draws, views and selections
  apply with it, in the order they were set; reading a panel's back
  (`getViewport({ panel })`) waits for `chart.ready`. What synced charts
  share before then takes its place in the same order.
- **Groups.** Each channel's groups are its own: `{ cursor: "all",
  viewport: "pair" }` shares the cursor with every chart of "all" and the
  view with those of "pair".
- **Across copies and frames.** Groups are the page's: charts sync
  whichever copy of herceg made them. Static notebook outputs, each in a
  sandboxed frame, sync through a relay that posts what sync carries to the
  other frames.
- **Limits.** Charts inspected along y measure values on x and neither
  share nor follow an x cursor; linking them by category needs
  `scale: "y"`. Charts with panels of their own categories refuse synced
  selections and cursors along y.

## Tooltips

The tooltip shows what is at the pointer or keyboard cursor: the position
(the x value, or y, or an item's name), then a row per series or item,
written as the axis' `format` writes it.

| Option | Does |
| --- | --- |
| `tooltip` | `true` (default), `false`, or `{ mode, axisLabels }`. Modes: `"nearest-x"` (every series at the nearest x), `"nearest-y"`, `"nearest"` (the closest point on screen). Left out, the mode suits the marks. Charts of items alone (pies, trees, maps, networks, 3D) refuse the axis modes. |
| `tooltip.axisLabels` | Labels the crosshair on the axes. |
| axis `tooltipFormat` | How tooltips, the keyboard, and crosshair labels write values, without changing ticks. |
| mark `tooltip: { fields }` | More of the row: field names, or `{ field, label?, format? }`. |
| `renderTooltip` | JavaScript only: content of your own, text or a node. |

```ts
createChart(element, {
  locale: "en-US",
  marks: [line(latency, { x: "time", y: "p99", tooltip: { fields: [{ field: "requests", label: "Requests" }] } })],
  x: { tooltipFormat: { weekday: "short", month: "short", day: "numeric" } }, // "Wed, Jan 21"
  y: { title: "ms", tooltipFormat: { style: "unit", unit: "millisecond" } }, // "304 ms"
});
createChart(other, {
  marks: [line(latency, { x: "time", y: "p99" })],
  renderTooltip: ({ points }) => `${points[0]?.text ?? ""} ms`,
});
```

```python
hg.line(daily, x="time", y="p99",
        tooltip=hg.Tooltip(fields=[hg.TooltipField("requests", label="Requests")]),
        y_axis=hg.AxisOptions(tooltip_format={"style": "unit", "unit": "millisecond"}))
hg.Chart(daily).line(x="time", y="p99", tooltip=hg.Tooltip(fields=["requests"]))
```

- **Fields** are checked against the mark's table. Numbers are written as
  the chart's other numbers, times as the x axis writes them, missing values
  as "–". Marks whose points are rows take fields (lines, areas, bars,
  points, rugs, error bars, candlesticks, heatmaps, map regions and points,
  3D points, lines, and surfaces, radars, gauges, custom marks with
  series); pies, funnels, trees, and Sankey links show them for items of
  one row. Histograms, box plots, boxen, violins, and contours refuse
  fields; networks take none. A Python helper's `tooltip` is its chart's,
  with fields for its one mark.
- **`renderTooltip`** text is shown as text, never parsed as markup. It is
  called when what the tooltip is at changes, or the chart's data or
  options do, not on every move; the box keeps its placement, the
  crosshair, and the keyboard's announcements. An inspection's rows are
  rows of the tables as they were when it was made: once the data or
  marks change, the chart inspects them again before calling it.
  React, Vue, and Svelte render their own components there
  ([Frameworks](frameworks.md#tooltips)).

## Events

`on(event, listener)` returns a function that stops listening. Events
report changes only.

```ts
const stop = chart.on("select", ({ x }) => x && detail.setViewport(x));
chart.on("viewport", ({ views, cause }) => cause !== "sync" && save(views));
chart.on("click", ({ inspection }) => {
  const point = inspection?.points[0];
  if (point?.markId === "orders" && point.row !== undefined) openOrder(orders.value("id", point.row));
});
```

| Event | Reports |
| --- | --- |
| `viewport` | One whole change of view: `viewRevision`, `cause`, `revision`, `panel`, the scale instances changed (`scales`), and each panel's whole view (`views`). A map's or network's view is its plane's ranges. |
| `select` | The selection (`x`, `y`, `lasso`), its `owner` (scale instances and panels), `cause`, `revision`, and with `rowSelection`, `rows` per table. |
| `hover`, `click` | An `inspection` ([below](#panels-and-pixels)), `cause`, and the `revision` of the frame acted on; with `rowSelection`, `click` carries `rows`. |
| `edge` | A view near an end of its extent: `scale`, `instance`, `panels`, `side`, `domain`, `bound`, `cause`. |
| `rowSelection` | A bound channel changed, by any writer: `table`, `channel`, `selection`, `cause` (this chart's gesture, click, or key, or `"sync"` for another writer), and `revision`. |
| `visibility` | Series hidden or shown: `hiddenKeys`, `cause`, `revision`, and `panels` for panels' own legends. |
| `camera`, `drill`, `itemMove` | A 3D chart turned; a tree drilled; a network node moved, each with `cause` and `revision`. Subplots' carry `panels: [id]`. They also follow `setCamera`, `setDrillRoot`, `setItemPosition`. |
| `render` | A frame of the data, or a selection over it, was drawn, for overlays that follow the panels: the `revision` on screen. |
| `error` | A `ChartError`, once per failed change. |

**Causes and revisions.** A `cause` says what made a change:
`"pointer"` (a drag, pinch, or click), `"wheel"`, `"keyboard"`, `"api"`
(a call such as `setViewport` or `showCursor`), `"sync"` (another chart in
the group, or another writer of a bound row selection), `"data"`, or
`"options"`. A brush whose written rows another change replaces goes with
that change's cause: a click's, a key's, or `"sync"`. `chart.revision` counts changes of options, data, and state
(views, selection, bound row selections, visibility, drill roots,
cameras, moved nodes); each state event carries the revision its change
made, `render` the revision a frame drew, and `hover` and `click` the
revision of the frame the pointer or key acted on. A change is on screen
once a `render` of its revision or a later one arrives
(`chart.drawnRevision` reads the last, undefined until a frame draws; a
change that fails to draw never renders):

```ts
chart.on("select", ({ revision }) => {
  const stop = chart.on("render", (frame) => {
    if (frame.revision < revision) return;
    stop();
    saveSnapshot(chart); // the selection is drawn
  });
});
```

**Inspection points.** Each point of an inspection has `mark` (the mark's
index), `markId`, `key` (an opaque series or item key), `label`, `row`
(the position of the row in the mark's table, which `table.value(field,
row)` reads and a `RowSet` adds), and `fields`. Points that are no one row
(bins, box groups, slices, stages, tree nodes, network and Sankey nodes and
links) have no `row`. Positions shift as a stream drops rows, so read a row
in the listener that receives it.

**Keyboard selections.** Shift with the arrow keys selects a range along
the axis the keys step along; Enter zooms to it where zoom is on; Escape
clears. Selections are announced.

## Selected rows

A chart bound to a channel of a [selection store](data.md#row-sets-and-selection-stores)
writes the rows its brushes, lassos, and clicks select there, and
highlights the rows the channel holds, whoever selected them. Brushing one
chart highlights the same records in other charts and grids sharing the
channel, and keeps highlighting them while rows stream in.

```ts
import { createChart, line, point, rowSelection, rowView, selectionStore } from "herceg";
import { createGrid, createGridModel } from "herceg/grid";

const focus = selectionStore(trips);
createChart(scatter, {
  marks: [point(trips, { x: "distance", y: "fare" })],
  interaction: { brush: "xy" },
  rowSelection: rowSelection({ store: focus, channel: "focus" }),
});
createChart(timeline, {
  marks: [line(trips, { x: "pickup", y: "fare" })],
  rowSelection: rowSelection({ store: focus, channel: "focus", events: [] }), // highlights only
});
createGrid(list, {
  model: createGridModel({ data: rowView(trips), columns, selectionStore: focus, channel: "focus" }),
  ariaLabel: "Trips",
});
```

In Python, `row_selection=hg.SelectionBinding("focus")` binds a live
notebook chart or Streamlit chart (see
[Notebooks](python/notebooks-and-streamlit.md#selected-rows)).

| Binding option | Means |
| --- | --- |
| `store`, `channel` | The store and channel to write and highlight. One binding per table the marks read. |
| `events` | Gestures that write: `"brush"`, `"lasso"`, `"click"` (all by default); `[]` highlights only. |
| `effect` | `"none"` writes without dimming. |
| `selection` | (specs) The channel's starting selection. |

A brush that writes rows selects rather than zooms (Ctrl/⌘+wheel, pinches,
and Shift-drags still zoom and pan). Marks over tables without a binding
neither write nor dim. To start with a selection, set the store's channel
before drawing: `store.set("focus", selectWhere(col("fare").gt(20)))`.

### What gestures select

- **Brushes** write a condition on the marks' fields, so rows appended
  later that meet it are selected too. On category axes it lists labels.
  A mark's several y fields are its series: a row is in when any shown one
  is. Each table gets its own condition; nothing joins tables.
- **Stacks** are brushed at their drawn tops: a brush selects the rows drawn
  inside it, as a row set.
- **Lassos** select rows whose drawn point is inside (a point's center, a
  line's vertex, a bar end's middle, a candle's close, a cell's center).
- **Clicks** select the row under the pointer; a histogram bin's rows; a box
  or violin group; a heatmap cell's rows. Shift adds, Ctrl or Cmd toggles,
  a click off the data clears. With the keyboard cursor on a point, Space
  acts as a click and announces the count.

Lassos and clicks write `RowSet`s, which keep their rows while others are
appended and dropped. `chart.select(selection, { rows: false })` shows a
selection without writing rows, as when mirroring another view's brush.

### How marks highlight

Rows the channel does not hold are dimmed to a quarter of their opacity; an
empty selection dims every row.

| Mark | Highlight |
| --- | --- |
| Points, bars, error bars, candlesticks, rugs | Each row drawn once, dimmed or not, in its place. Large WebGL point series stay on the GPU. |
| Lines, areas | The same curve, solid within the x spans of runs of selected rows, dimmed outside. Lines whose x does not ascend draw selected values over the dimmed line. |
| Histograms | Each bin's selected part from its base, with the whole bar's normalization. |
| Box plots, boxen | The selected values' own shape over the dimmed whole, 0.6 as wide. |
| Violins | The selected values' density inside the whole violin. |
| Heatmaps, 2D histograms | A square in each cell, in its color, covering the selected share (cells under 4 px, or more than 20,000 selected cells, show whole). |
| Contours | Unchanged: they draw a field, not rows. |
| Pies, funnels, treemaps, sunbursts, Sankey links | Each item's selected share; the rest dimmed. |
| Maps, networks | Items without selected rows dimmed. |

Tooltips and the keyboard say how much is selected ("10 – 20: 42; 12 of 42
rows selected"), and the text alternative says "42 of 120 rows selected."
Exports draw the selection the stores hold when called.

### Limits

- Histograms are brushed along their bins, box plots and violins along their
  categories; lassos select none of their rows.
- Contours take brushes only; bind with `events: ["brush"], effect: "none"`.
- Annotations of a table and dendrograms select no rows; a binding of a
  table only they read is refused.
- Gauges, radars, and 3D charts refuse a binding; select their rows in a
  chart of the same table along x and y.
- A chart of a derived table's aggregates binds the derived table's own
  store, whose rows are its groups.

Charts showing one selection share a byte per row. Brushing a scatter of a
million rows with a histogram and a box plot following takes about 10 ms a
step (Node).

## Range navigator

`navigator: rangeNavigator()` adds a strip under the plot that draws the
chart's marks small over the whole x axis, with a window over the range in
view.

```ts
import { createChart, line, rangeNavigator } from "herceg";

createChart(element, {
  marks: [line(prices, { x: "time", y: "close", id: "close" })],
  navigator: rangeNavigator({ height: 40, marks: ["close"] }),
});
```

```python
hg.line(prices, x="time", y="close", id="close", navigator=hg.Navigator(marks=["close"]))
hg.line(sales, x="week", y="units", facet="region", navigator=True)
```

| Option | Means |
| --- | --- |
| `height` | 40 px by default; at least 16, at most a third of the height the plots and strip share. A chart too short for 16 px has none. |
| `marks` | Mark ids to draw; by default every line, area, point, vertical bar, and candlestick (never annotations). |
| `panel` | The facet panel or subplot whose x it moves (with the panels sharing it). |
| `halo` | The strip labels' [halo](styling.md#text-halos). |

- **Gestures.** Dragging the window pans, dragging an edge zooms, dragging
  elsewhere shows the range dragged over, a double click shows all of x.
  The window follows every other change of view and its changes are
  ordinary views: `viewport` events, synced, shown at once.
- **Streaming.** A range set with the navigator stays put while the strip
  grows with the data; unzoomed, the window spans everything.
- **Drawing.** Lines and areas reduced per pixel column, bars and candles as
  the plot draws them (dense bars as each pixel column's extremes, dropping
  labels), points sampled one per pixel, over the data's whole y range.
  It follows the axis' breaks but draws no seams.
- **Panels.** With facets or subplots, one strip goes under all the panels
  and moves the x they share; each panel's marks are drawn apart, on its
  own y scale.
- **Keyboard and screen readers.** The window's left edge, the window, and
  its right edge are sliders after the legend in tab order: arrows move by a
  hundredth, Page keys by a tenth, Home and End to the ends; Shift+arrows
  widen or narrow the window; Escape cancels or shows all. The text
  alternative describes the overview and the range in view.
- **Exports** show the strip and window without the sliders. The sliders'
  announcements are in English.
- **Limits.** Not with layout marks, category x axes, or marks placed along
  y (horizontal bars). Without `panel`, panels must share x
  (`x.scope: "chart"`).

## Animation

`animation: true`, or `{ duration }` (250 ms by default), moves the axes
gradually to a view asked for: `setViewport`, zooming to a brush,
double-click reset, a map's or network's plane. With `values: true`, marks
also move to new values when a table changes in place or is reset (`set`,
`replace`, `setColumn`, `reset`), and axes whose automatic domains change
move with them.

```ts
const chart = createChart(element, {
  marks: [bar(sales, { x: "region", y: "revenue" }), rule({ y: 50 })],
  animation: { values: true },
});
sales.setColumn("revenue", next); // the bars, the y axis, and the rule move
```

```python
chart = hg.scatter(data, "x", "y", item_key="id", animation=hg.Animation(values=True))
widget = chart.widget()
widget.replace(next_data)  # points with matching ids move, even reordered
```

| Mark | Moves |
| --- | --- |
| Bars (stacked, labeled, histograms') | Matched by series and position; appearing bars grow from the base, a bar changing sign passes through the baseline. |
| Pie slices, gauges | Slices turn to new sizes, always making a whole pie; a gauge turns its dial. |
| Points | Matched by row, or with `itemKey: "id"` by a number, time, or category field (across `reset` and reordered data). Missing or duplicate keys show that series at once. |
| Lines, areas along x | When both scenes draw every row through the same positions (no level of detail, missing values, or breaks). |
| Error bars, candlesticks, regions, text | When both scenes draw as many at the same places along one axis. |
| Heatmap and 2D histogram cells | Fade to new colors over the same grid. |

**Refused.** Box plots, boxen, violins, rugs, contours, dendrograms, custom
marks, treemaps, sunbursts, funnels, radars, Sankey diagrams, networks,
maps, and 3D marks refuse `values` with a `ChartError` (`unsupported`,
path `animation.values`).

**Shown at once instead:** appended and dropped rows; changes while values
move and until data has been still for a change's duration (so streams
never animate forever); changes of options or hidden series; scenes over
2,000 bars, slices, and rules or 10,000 points (of points or lines); point
clouds, sampled points, marks over row views; charts with a navigator or
`sync`, off screen, under the pointer or keyboard, or slow (over 10 ms a
frame); pages preferring reduced motion. Charts of several panels or with `sync`
do not animate their views. Only the drawing moves: data, tooltips, and events have the
new values at once.

## Hiding series

Legend entries hide and show what they name; the chart's methods do too.

```ts
const [first] = chart.getLegend(); // { key, label, color } per entry
chart.setVisibility(first!.key, false); // or a list of keys
chart.setVisibility(first!.key, true, { panel: "latency" }); // shown there only
const hidden = chart.getHiddenKeys();
chart.setHiddenKeys([]); // show everything, in every panel
```

- Keys are opaque. A legend key names what a series stands for, so hiding
  it hides it in every mark and panel.
- Hidden series are not drawn, inspected, or visited, and fitted value axes
  leave them out. Each change reports one `visibility` event.
- Keys of series not drawn now (a stream moved past them) stay hidden for
  when they return. A mark's own keys go with the mark (its `id`, else its
  index), so give marks ids when their order changes.

## Panels and pixels

`getPanels()` describes the panels of the last frame drawn, in reading
order: `key`, `label`, `plot`, an inset's `parent`, and its `x`, `y`, and
`yRight` axes (`type`, `domain`, `range`, `categories`, `bandwidth`,
`group`, `canSetViewport`). A layout mark's panel has no axes.

```ts
const box = chart.root.getBoundingClientRect();
const [x, y] = [event.clientX - box.left, event.clientY - box.top]; // the chart's CSS pixels
const at = { panel: "North", axis: "x" } as const; // panel only with several panels
const px = chart.toPixel(Date.UTC(2026, 0, 5), at); // where a time is, or undefined
const value = chart.fromPixel(x, at); // the value at a pixel
const label = value === undefined ? "" : chart.formatValue(value, at); // as tooltips write it
const found = chart.inspect(x, y); // what the tooltip would show there
```

- Pixels are CSS pixels from the top left of `chart.root`.
- Values are numbers, epoch ms on time axes, fractional band indices on
  category axes. `toPixel` gives undefined for what the axis cannot show
  (non-finite values, nonpositive values on log axes, times inside breaks).
- These describe the last frame drawn: after changing a table, call
  `render()` before inspecting. `inspect` moves no cursor and emits no
  event.
