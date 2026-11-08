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
- [Selections](#selections)
- [Chart state](#chart-state)
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
| `brush` | `"x"`, `"y"`, `"xy"`, `"lasso"`, or `{ shape, edit?, clear? }` | Dragging selects a range, rectangle, or freehand region (`select` events); a click clears. Where `zoom` covers its axes, it zooms instead (a lasso still selects), and Shift-drag pans. Its settings ([Selections](#selections)) let it be moved and resized. |
| `select` | `"items"`, `"series"`, `false` | A click or Enter selects the item, or its series ([Selections](#selections)). |
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

- Escape during a drag ends it: a brush goes back to the selection before
  it, a pan returns, a moved node goes back.
- Brushes and lassos are painted in the theme's `brush` role
  ([Styling](styling.md#role-styles)).
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
| `wheel` (`hg.WheelGesture`) | `axis` (`"x"`, `"y"`), `focused` | `pan`, `zoom`, `pageScroll`, `editBrush` |
| `drag` (`hg.DragGesture`) | `button` (0, 1, 2), `pointer` (`"mouse"`, `"touch"`, `"pen"`) | `pan`, `brush`, `cursor`, `orbit`, `moveItem`, `pageScroll`, `editBrush` |
| `pinch` (`hg.PinchGesture`) | | `zoom`, `pageScroll` |
| `key` (`hg.KeyGesture`) | `key` as `KeyboardEvent.key` names it | `pan`, `zoom`, `reset`, `clearBrush` |
| `doubleClick` (`hg.DoubleClickGesture`) | | `zoom`, `reset`, `clearBrush` |

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
| `editBrush` (`hg.EditBrushAction`) | | Moves the brush (a drag inside it) or resizes it (a drag on its edges or corners, the wheel over it); elsewhere later bindings are tried |
| `clearBrush` (`hg.ClearBrushAction`) | | Clears the brush; without one, later bindings are tried |
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
| `snap` | Which point of each series it reads, as [`inspection.snap`](#inspection) says; by default the chart's own. `"previous"` suits charts at other frequencies: a 10:37 cursor shows an hourly chart's 10:00 reading. |
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
  apply with it, in the order they were set; until then a panel's view
  (`getViewport({ panel })`) reads as the calls waiting ask for it. What synced charts
  share before then takes its place in the same order (selections, whose
  categories that frame draws, always wait for it), and is not shared
  back. The frame reports and shares each state as it is then: a
  selection cleared before it is shared as cleared, and a map's or
  network's view is reported as it is, like the axes' views.
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
- **Hover events.** A chart showing a cursor another chart shares, or one
  `showCursor` shows, reports a `hover` with cause `"sync"` or `"api"`
  once it has drawn it.

## Inspection

`inspection` says what the pointer reads: the points the tooltip lists,
the crosshair, and the `inspection` of hover and click events.

```ts
createChart(element, {
  marks: [
    line(metrics, { x: "time", y: ["auth", "api"] }),
    point(annotations, { x: "time", y: "value", inspect: false, pick: false }), // decoration
  ],
  inspection: { mode: "nearest-x", snap: "each", within: { milliseconds: 30_000 } },
});
```

```python
chart = hg.Chart(metrics, inspection=hg.InspectionOptions(
    mode="nearest-x", snap="each", within=timedelta(seconds=30)))
chart.point(x="time", y="value", data=annotations, pick=False, inspect=False)
```

| Option | Does |
| --- | --- |
| `mode` | `"nearest-x"` reads each series along x, `"nearest-y"` along y (bars along y), `"nearest"` the one point nearest the pointer on screen. Left out, the marks choose: `"nearest-y"` for marks along y, `"nearest"` for points, else `"nearest-x"`. Charts of items alone (pies, trees, maps, networks, 3D) refuse the axis modes. |
| `snap` | Along an axis, which point of each series is read (table below). |
| `within` | How far from the pointer a point read may be, in the mode's units: a number in the axis' units, `{ milliseconds }` on a time axis (Python: a `timedelta`), or for `"nearest"`, `{ px }` (Python: `hg.Pixels(n)`). No limit by default. |

| `snap` | Each series reads | The crosshair |
| --- | --- | --- |
| `"shared"` (default) | its point at the value nearest the pointer that any series has | at that value |
| `"each"` | its own point nearest the pointer, ties to the earlier | at the pointer |
| `"previous"` | its last point at or before the pointer | at the latest point read |
| `"next"` | its first point at or after the pointer | at the earliest point read |

- **`within`** is measured from the pointer's value: with `"shared"` the
  shared value must be within it, with the others each series' point.
- **Gaps.** A series reads nothing at a value inside a gap its
  `continuity` leaves, under every `snap`.
- **Unsorted series** are read by a scan; `"previous"` and `"next"` leave
  them out. Heatmap cells and layout items are read under the pointer
  whatever `snap` says.
- **`inspection: false`** has the pointer read nothing: no tooltip, no
  crosshair, and hover and click events without an `inspection` (their
  `pointer` and `target` remain). The keyboard still reads and announces
  points, so hiding inspection never removes keyboard access.
- **Marks that stay out.** `inspect: false` keeps a mark's points out of
  what inspection reads; `pick: false` keeps its items from being event
  targets (and from `clickedRows`), so a click passes through decoration
  to what is under it.
- **Errors.** `within` needs a `mode`, whose units it is in. `"nearest"`
  takes `{ px }` and no `snap`; the axis modes take a number or
  `{ milliseconds }`, which needs a time axis (reported once the chart
  draws: `inspection.within: the x axis is not a time axis; give a
  number`).

## Tooltips

The tooltip shows what is at the pointer or keyboard cursor: the position
(the x value, or y, or an item's name), then a row per series or item,
written as the axis' `format` writes it, or as the series' value field's
[display](fields.md#charts) does.

| Option | Does |
| --- | --- |
| `tooltip` | `true` (default), `false`, or `{ axisLabels, pin }`. What it lists is what [`inspection`](#inspection) reads; `false` hides the box and the pointer's crosshair, the application's to draw; inspection goes on for hover and click events. |
| `tooltip.axisLabels` | Labels the crosshair on the axes. |
| `tooltip.pin` | `"click"`: a click or Enter pins the tooltip ([Pinned tooltips](#pinned-tooltips)). |
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

- **Fields** are checked against the mark's table. Each is labeled and
  written as its [field display](fields.md#tooltips-labels-and-gauges)
  says, under the entry's own `label` and `format`; without one, numbers
  are written as the chart's other numbers, times as the x axis writes
  them, missing values as "–". A format of the wrong kind for its field
  (a number format for a time field) is refused. Marks whose points are rows take fields (lines, areas, bars,
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

## Pinned tooltips

With `tooltip: { pin: "click" }`, a click on what the tooltip shows pins
it there, and Enter pins it at the keyboard cursor. A pinned tooltip
stays as the pointer moves on, takes the pointer and the focus, so links
and buttons in `renderTooltip` content work, and is a group named
"Pinned tooltip". Tooltip fields whose [field display](fields.md#links)
gives a link are links there, opening in a new tab or window. Content
drawn again as the data changes keeps the focus: on the control it was
on where the new content has that control, else on the link in its
place, else on the tooltip. Escape, a click outside it (off the data, or outside
the chart), or a second click where it is pinned lets it go, and the
focus goes back to the chart.

```ts
const chart = createChart(element, {
  marks: [line(sales, { id: "sales", x: "day", y: ["east", "west"] })],
  tooltip: { pin: "click" },
  renderTooltip: (inspection) => {
    const link = document.createElement("a");
    link.href = `/days/${inspection.value}`;
    link.textContent = "Open the day";
    return link;
  },
});
chart.on("pin", ({ at, cause }) => cause !== "api" && saveView({ pinned: at }));
chart.pin({ value: Date.UTC(2025, 3, 1), axis: "x" }); // restores a pin the page saved
```

```python
chart = hg.line(sales, x="day", y=["east", "west"], tooltip=hg.Tooltip(pin="click"))
widget = chart.widget()
widget.on_pin(lambda pinned: print(pinned))
widget.pin(value=datetime(2025, 4, 1), axis="x")
```

- **What it is pinned to.** With the inspection's mode `"nearest"`, or
  on a layout item (a slice, a node), the item itself: it follows the item
  by its key as data changes and goes when the item does. With
  `"nearest-x"` or `"nearest-y"`, the value on that axis the tooltip read
  where it was clicked (`{ value, axis, panel }`; Enter's, at the keyboard
  cursor), even where the line clicked is nearer another of its points:
  every series is read there again as data changes. Either hides while out of view, zoomed or panned away, and
  shows again with it; meanwhile no other tooltip shows. A change of the
  inspection's mode lets it go.
- **What pins.** An item the inspection reads: a series' point, a layout
  item, a custom mark's item. Annotations and marks with `inspect: false`
  pin nothing, nor do a map's regions and points and 3D points and lines,
  which the tooltip reads; a click there, or off the data, lets a pin go. Along an
  axis, an item the inspection at its value does not read (a heatmap's
  cell, a point placed in the plot's own units, a right-axis point under
  `"nearest-y"` beside left-axis series) pins nothing.
- **From the application.** `chart.pin({ item } | { value, axis?, panel? }
  | null)` pins or lets go as a click would, reported as a `pin` event
  with cause `"api"`; `chart.pinned` reads where it is. `item` takes a key
  from an event or a reference (`{ mark: "sales", item: [...] }`);
  `value`, a number, epoch ms on time axes, or a category's name; `axis`
  is the inspection's by default; `panel`, needed in charts of several, a
  panel's key. Pins asked for before the first frame wait for it, and
  `pinned` reads them at once; one that then finds nothing to read is
  reported let go. A pin at a value nothing reads lets any pin go.
- **Options.** `tooltip.pin` with `inspection: false` is refused: nothing
  is inspected to pin.

## Dragging rules

A rule at a value with `drag: true` can be dragged along its axis. While
it moves, it is drawn at the pointer and the chart reports `itemMove`
with `phase: "preview"` once a frame; on release, `"commit"`; on Escape
or a lost pointer, `"cancel"`, and the rule goes back. Its `position` is
the value in data (`{ y }` for a horizontal rule, `{ x }` for a vertical
one; epoch ms on time axes), `markId` the rule's `id`; a rule on the
right axis adds `axis: "right"`, and one in a subplot or facet `panels:
[id]` (every report of the drag, its cancel too, names the panel it began
in). A
press on a dragged rule neither pans nor brushes nor clicks, and touches
on it move it rather than scroll the page. The drag is its pointer's:
another finger neither moves nor ends it. A rule that the options take
away, or whose subplot or facet goes, goes back with a cancel.

The value stays the application's: a rule has no state of its own. After
a commit the next frame draws the rule where its options say: where the
listener set it (accepted), back where it was (rejected), or nowhere (the
rule removed).

```ts
let threshold = 250;
const marks = () => [line(latency, { x: "time", y: "p99" }), rule({ id: "threshold", y: threshold, drag: true })];
const chart = createChart(element, { marks: marks() });
chart.on("itemMove", ({ markId, phase, position }) => {
  if (markId !== "threshold" || phase !== "commit" || position?.y === undefined) return;
  threshold = Math.round(position.y); // accepted, rounded
  chart.update({ marks: marks() });
});
```

```python
chart = hg.Chart(latency).line(x="time", y="p99").rule(y=250, id="threshold", drag=True)
widget = chart.widget()
widget.on_item_move(lambda move: move.phase == "commit" and widget.update_rule("threshold", y=move.position.y))
```

Rules over a table move with their rows and refuse `drag`
(`rule drag: rules over a table move with their rows; drag a rule of a
value`); so do rules placed by a share of the plot or by pixels. The
pointer over a dragged rule shows the resize cursor along its axis.

## What a click does

A click or Enter on a chart does at most one of the chart's own actions,
in this order, so one click is never two that conflict:

1. inside a pinned tooltip: its content's own (a link, a button), nothing
   of the chart's;
2. on a legend entry: the legend's `action`;
3. on a tree's item where `zoom` drills: drilling;
4. otherwise, about the item picked: the selection (`interaction.select`)
   and the pin (`tooltip.pin`), each as it would alone, so a chart with
   both selects and pins the same point with one click. A click that
   picks no item clears the selection and lets the pin go.

A leaf of a tree, which drills nowhere, is selected and pinned as other
items are. The `click` event follows in every case.

## Events

`on(event, listener)` returns a function that stops listening. Events
report changes only.

```ts
const stop = chart.on("select", ({ selection, phase }) => {
  if (phase === "commit" && selection?.kind === "brush" && selection.x) detail.setViewport(selection.x);
});
chart.on("viewport", ({ views, cause }) => cause !== "sync" && save(views));
chart.on("click", ({ target }) => {
  if (target?.kind === "item" && target.markId === "orders" && target.row !== undefined)
    openOrder(orders.value("id", target.row));
  if (target?.kind === "axisLabel" && target.layer === "major") zoomToDay(target.value);
});
chart.on("contextMenu", ({ pointer }) => pointer.inPlot && addAnnotation(pointer.values));
```

| Event | Reports |
| --- | --- |
| `viewport` | One whole change of view: `viewRevision`, `cause`, `revision`, `panel`, the scale instances changed (`scales`), each panel's whole view (`views`), and the chart's whole view as the option takes it (`state`). A map's or network's view is its plane's ranges. |
| `select` | The `selection` ([Selections](#selections)), its `phase` (`"preview"`, `"commit"`, `"cancel"`), a brush's `owner` (scale instances and panels), `cause`, `revision`, the selection committed (`state`), `conditions` (each table's condition, and its `source` through [derived tables](data.md#derived-tables)), and with `rowSelection`, `rows` per table. |
| `hover` | What the pointer or keyboard cursor is on, or what inspection reads there, changed: an input event (below). A cursor another chart shares (cause `"sync"`) or `showCursor` shows (`"api"`) reports once drawn. |
| `click` | A press released without moving on a plot, an item, an axis label, or a legend entry, or Enter on the keyboard cursor (cause `"keyboard"`): an input event; with `rowSelection`, `rows`. |
| `contextMenu` | A secondary press (a right click, a long press): an input event with its `pointer`. While a listener listens, the browser's own menu stays off the plots and items (not off axes or legends). |
| `edge` | A view near an end of its extent: `scale`, `instance`, `panels`, `side`, `domain`, `bound`, `cause`. |
| `rowSelection` | A bound channel changed, by any writer: `table`, `channel`, `selection`, `phase` (the writing gesture's, another chart's live brush's too), `cause` (this chart's gesture, click, or key, or `"sync"` for another writer), and `revision`. |
| `visibility` | Series hidden or shown: `hiddenKeys`, `cause`, `revision`, `panels` for panels' own legends, and the whole state (`state`). |
| `camera`, `drill`, `itemMove` | A 3D chart turned; a tree drilled (with its whole `state`); a network node moved, or a [rule dragged](#dragging-rules) (`markId`, `phase`), each with `cause` and `revision`. Subplots' carry `panels: [id]`. They also follow `setCamera`, `setDrillRoot`, `setItemPosition`. |
| `pin` | The tooltip was [pinned](#pinned-tooltips) or let go: `at` (null when let go), its `inspection`, `cause`, `revision`. |
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
revision of the frame the pointer or key acted on. Each state event also
carries the `basis` a [conditional write](#chart-state) gives as
`expected`. A change is on screen
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

**Input events** carry `pointer`, `target`, `inspection`, `cause`, and
`revision`:

- `pointer`: `x` and `y` in the chart's pixels, the `panel` it is over,
  `inPlot`, and its `values` on the panel's axes (epoch ms on time axes,
  through breaks; a fractional band index on category axes, whose
  `categories` name the band). Undefined for the keyboard and for cursors
  other charts share.
- `target`: what input addresses there, picked as described below, by
  `kind`:

  | `kind` | Fields |
  | --- | --- |
  | `"item"` | `mark` (its index), `markId`, `item` (a key that stays the item's from frame to frame), `series`, `row`, `panel`, `box` |
  | `"axisLabel"` | `panel`, `scale`, `layer` (`"major"` or a tick layer's id), `value`, `category`, `text`, `box` |
  | `"legendEntry"` | `key`, `label`, `panel` (a subplot's legend), `references` (the series and layout items it stands for) |
  | `"plot"` | `panel`: a plot where no item is |

- `inspection`: what [`inspection`](#inspection) reads there; undefined
  where it reads nothing, and for the pointer with `inspection: false`.
- `revision`: the frame the input acted on, what the user saw.

**What a clicked item stands for.** On `click`, `contextMenu`, and Enter
(never on `hover`), an item target also carries `provenance` and `rows()`,
taken as the input found them:

```ts
const days = table({ day: dayStarts, region, revenue }, { name: "days" });
const monthly = derive(days)
  .bin("day", { bins: monthStarts, as: "month" })
  .aggregate({ by: ["month", "region"], ops: { revenue: sum("revenue") } })
  .table();
const chart = createChart(element, { marks: [bar(monthly, { x: "month", y: "revenue", series: "region" })] });
chart.on("click", ({ target }) => {
  if (target?.kind !== "item" || !target.provenance) return;
  const { groups, condition, source } = target.provenance;
  // groups: [{ field: "month", value: <Feb 1> }, { field: "region", value: "North" }]
  // source: { table: "days", condition: ["and", ["and", [">=", ["field", "day"], <Feb 1>],
  //   ["<", ["field", "day"], <Mar 1>]], ["==", ["field", "region"], "North"]] }
  if (source?.condition) drillToDays(source.condition); // a product's query
  else if (condition) detail.setQuery({ filter: condition }); // a row view of the same table
  const { table, positions } = target.rows!();
});
```

- `groups`: what the item groups by on its mark's table, `{ field, value }`
  or an interval `{ field, from, to, closed? }` (`from` included, `to`
  excluded, and included too where `closed`: the last bin of a binning),
  with `time: true` where the field holds times (epoch ms):

  | Item | Groups |
  | --- | --- |
  | A bar without `itemKey` | its position's value, then its series field's value |
  | A row of a mark with `itemKey` | its `itemKey` value |
  | Any other row | none (its condition is null) |
  | A histogram's bin | its interval (a cumulative bin's from the first edge), its series' value, and with `weight`, the usable weights (0 up to the largest number); none where facet panels bin it differently |
  | A 2D histogram's cell | its bin along `x` and along `y`, and with `weight`, the usable weights |
  | A heatmap's cell | its `x` and `y` values, and finite `color` values (the largest negative number up to the largest); cells between `x1` and `x2` and calendars' days have none |
  | A box, violin, or boxen shape | its category, its series' value, and finite values of the field the statistics count (a precomputed box's five statistics; none where other boxes share its category) |
  | A pie's slice | its category, and with `value`, positive values (the least positive number up to the largest) |
  | A funnel's stage | its category |
  | A treemap's or sunburst's node | each level's field at its name, from the top (trees of `node` and `parent` fields have none) |
  | A Sankey link | its `source` and `target` names, and with `value`, positive values; a node has none |

  In a facet's panel the facet's values follow, where the facet splits the
  mark. With the view's filter, groups say the item's rows exactly; where
  none do, `groups` is empty (a row without `itemKey`, a bin facet panels
  bin differently, a Sankey node).
- `condition`: exactly the item's rows of its mark's table, as a portable
  expression: its groups and its mark's view's filter, and for a Sankey
  node, the links drawn into and out of it. Null where no condition says
  which rows: a row without `itemKey`, a view restricted to a row set, a
  calendar's day. A condition is never approximated.
- `source`: where the mark's table is [derived](data.md#derived-tables), the
  condition written on the table it was derived from first of all, by
  that table's `name`, through each step; null there where no condition
  says the rows (a rolling window's). Undefined for a table not derived.
- `rows()`: the item's rows of its table now, `{ table, positions }`: its
  row; every row sharing its `itemKey` value, or its bar's position in its
  series; an aggregate's, a cell's, or a layout item's rows as a click
  selects them (a network node's of its nodes table); each within its
  panel and view, with or without a condition. They are kept by identity: rows appended since are not among
  them, rows dropped since are left out, and after a reset there are none.

Provenance is worked out once per click, by code that loaded with
picking; hover never computes it. The `select` event's `conditions` say
items, series, and brushes the same way, each with its `source` where its
table is derived. `herceg/web` pages and Python receive the same
expressions (`event.target.provenance`); `rows()` stays in the browser.

Items are picked as the frame on screen drew them, by one rule: the
nearest stroke or point within reach, down to the first fill the pointer
is inside. Marks are searched from the top of the paint order (`zIndex`,
then as listed, the last painted first). Lines, rules, outlines, error
bars, and points within reach are candidates: within a point's radius
plus 4 px (8 px for touch), within half a line's stroke plus 4 px of a
segment drawn, within 4 px of a rule. The first fill holding the pointer
(a bar, bin, box, cell, filled candle body, region, area, slice, or
text; a hollow candle body is reached at its outline) ends the search
and is picked unless a candidate above it was found; a fill's edge near
the pointer counts as a candidate only where no fill holds it.
Of candidates, the nearest wins, ties going to the topmost. So a click
among lines a pixel apart takes the one under the pointer, a line over a
band is reached from inside the band, and an area's outline is reached
over its own fill. A draggable rule within reach is taken before anything else. Nothing outside a mark's clip is
picked, and strokes are reached only where the clip shows them; lines
and rules of no width draw nothing and are not reached, though a rule's
label is. A line's item is the observation it draws nearest the pointer
along its axis, also where it is drawn reduced or stepped. Input that
arrives after the data changed and before the next frame waits for that
frame, and names what it drew; a target's `row` follows the row picked.
Marks with `pick: false` are passed over. Picking loads with the first
listener of `hover`, `click`, or `contextMenu`, or a row selection taking
clicks.

**Inspection points.** Each point of an inspection has `mark` (the mark's
index), `markId`, `key` (an opaque series or item key), `label`, `row`
(the position of the row in the mark's table, which `table.value(field,
row)` reads and a `RowSet` adds), and `fields`. Points that are no one row
(bins, box groups, slices, stages, tree nodes, network and Sankey nodes and
links) have no `row`. Positions shift as a stream drops rows, so read a row
in the listener that receives it.

**Keyboard selections.** Shift with the arrow keys selects a range along
the axis the keys step along; Enter zooms to it where zoom is on; Escape
clears. Selections are announced. Without a selection to zoom to, Enter
is a `click` on the keyboard cursor's point (cause `"keyboard"`, no
`pointer`).

## Selections

A chart has one selection at a time (`ChartSelection`), of one of three
kinds; each replaces the others.

| `kind` | Made by | Holds |
| --- | --- | --- |
| `"brush"` | Dragging with `interaction.brush`, Shift with the arrow keys, `select` | `x` and `y` ranges in data values (epoch ms on time axes, band indices on category axes), a lasso's outline (`lasso`), and the `panel` it was drawn in where panels have scales of their own |
| `"items"` | A click or Enter with `interaction.select: "items"` | `items`: the keys of bars, points, a line's observations, bins, cells, and layout items |
| `"series"` | A click or Enter on an item with `interaction.select: "series"` | `series`: series keys |

```ts
import { createChart, point } from "herceg";

const chart = createChart(element, {
  marks: [
    point(cars, {
      id: "cars",
      x: "weight",
      y: "mpg",
      series: "origin",
      selected: { stroke: "#111", strokeWidth: 2 },
      unselected: { opacity: 0.1 },
    }),
  ],
  interaction: { select: "series", brush: { shape: "xy", edit: true, clear: "double-click" } },
});
chart.on("select", ({ selection, phase }) => {
  if (phase === "commit" && selection?.kind === "series") showOrigins(selection.series);
});
chart.select({ kind: "series", series: [{ mark: "cars", series: "Europe" }] });
```

```python
chart = hg.Chart(cars, select="series", brush=hg.Brush("xy", edit=True, clear="double-click"))
chart.point(x="weight", y="mpg", series="origin", id="cars",
            selected=hg.Look(stroke="#111", stroke_width=2), unselected=hg.Look(opacity=0.1))
```

- **Clicks.** With `select`, a click selects the item under the pointer,
  or its series, alone; Shift with a click adds or removes it. A click on
  the only one selected, or off the data, clears (a brush is cleared as
  its own `clear` says). Enter on the keyboard cursor's point does what a
  click does. An item is only its mark's: another mark's point of the
  same row is not selected.
- **Legends.** With `legend: { action: "select" }` (or a guide legend's
  `action`), a legend entry selects the series it names instead of hiding
  them: alone, or with Shift added or removed; a press on the one selected
  clears. Entries show which are selected (`aria-pressed`) and dim the
  others. `action: false` makes entries do nothing of the chart's own,
  `click` still reporting them.
- **Setting it.** `chart.select` takes a selection of any kind; a brush's
  x range alone may be a pair (`chart.select([from, to])`). Items and
  series are named by the keys events give (`target.item`,
  `target.series`), or by references to a mark's `id`:
  `{ mark: "bars", item: ["Coca-Cola"] }` (a bar keyed by its category),
  `{ mark: "delays", item: [[0, 10]] }` (a histogram's bin from 0 to 10),
  `{ mark: "cars", series: "Europe" }`. The chart keeps and reports keys,
  in one order; an empty list is no selection.
  `chart.referenceOf("series", key)` and `chart.referenceOf("item", key)`
  read a key from an event as such a reference: undefined for a mark
  without an `id` and for groups of networks, maps, and 3D points. Legend
  entries list theirs (`references` on `getLegend()`'s entries and on
  `legendEntry` targets): a series name an area and a line draw is two.
- **Looks.** A mark's `selected` and `unselected` looks (`fill`,
  `stroke`, `strokeWidth`, `dash`, `opacity`, `fillOpacity`,
  `strokeOpacity`, and a point's `radius`) are laid over its paint where
  a selection holds its items or series, and where a
  [row selection](#selected-rows) highlights its rows. What is not
  selected is drawn at a quarter of its opacity by default; marks the
  selection names nothing of are drawn as they are. A look's paint
  replaces the mark's own (a line's `opacity` too), and its `stroke`
  outlines points and bars that have no outline of their own (a pixel
  wide unless it gives `strokeWidth`). A brush draws its
  outline and changes no mark's look unless it writes rows. Lines, areas,
  bars, points, rugs, error bars, candlesticks, histograms, heatmaps,
  box plots, boxen, and violins take looks; annotations, contours, and
  dendrograms take none, layout marks (pies, trees, maps, networks) draw
  a selected item's share and dim the rest, and custom marks read
  `ctx.selection(series, row)`. Heatmaps and 2D histograms draw their
  selected cells in the `selected` look over the others. What is selected
  paints over what is not, as clicks find it: a line's selected parts
  over every series' dimmed lines, points' selected glyphs over every
  series' others; areas keep their stack's order, each layer's selected
  part over its own.

**Phases.** A gesture reports the changes it makes as it goes: a brush
being drawn, moved, or resized reports `select` with `phase: "preview"`
once a frame (the first move after a frame at once, so the charts it
reaches draw it on the next), then `"commit"` on release, or `"cancel"`
on Escape, a lost pointer, or a release where it began, which goes back
to the selection before it. Every other change is a `"commit"`. `chart.selection` stays the committed selection
while a gesture previews another. Listeners that query a server or write
rows wait for the commit; row selections hear only commits unless bound
`live`:

```ts
chart.on("select", ({ selection, phase }) => {
  if (phase === "preview") drawCount(selection); // cheap, once a frame
  else if (phase === "commit") runQuery(selection);
});
```

**Editing a brush.** `brush: { shape, edit, clear }` gives a brush its
settings. With `edit: true`, a drag inside the brush moves it, one on its
edges or corners resizes it, and the wheel over it resizes it about the
pointer; elsewhere drags and the wheel do what they did. Lassos are not
edited. `clear` says what clears it: a click off it (`"click"`, the
default), a double click (`"double-click"`), or neither (`false`); Escape
always does. Both are [bindings](#bindings) (`editBrush`, `clearBrush`),
which `bindings` can give other gestures.

## Chart state

A chart's state is what its user changes: the selection, the view, what
is hidden, a tree's drill root, and the pinned tooltip. Charts report it
in events, take it as options, and take writes that apply only if the
user has not changed it meanwhile:

```ts
import { createChart } from "herceg";

createChart(element, {
  marks,
  viewport: { x: saved.range },
  visibility: { hidden: saved.hidden },
});
```

**State options.** `selection`, `viewport`, `visibility`, and `drillRoot`
set the chart's first state. They are not values the chart holds to: the
user's input changes the state. An option given again applies only when
its value is not the one last given (compared by value, key lists as
sets), as the matching method would (`select`, `setViewport`,
`setHiddenKeys`, `setDrillRoot`) with cause `"options"`; a gesture
changing that state ends with a `cancel`. A value equal to what the chart
last reported changes nothing, so writing what events report back into
the options never loops. Given as `undefined`, an option is forgotten.

| Option | Takes | Reported by |
| --- | --- | --- |
| `selection` | A `ChartSelection`, or null | `select`: `selection`, with previews; `state`, the selection committed |
| `viewport` | `{ x?, y?, yRight? }` (ranges; null for not zoomed), or `{ panels: { [key]: view } }` | `viewport`'s `state` |
| `visibility` | `{ hidden, panels? }`: keys hidden, and per subplot what its legend hid and showed | `visibility`'s `state` |
| `drillRoot` | An item key or a path of names, null for the whole tree, or `{ panels }` | `drill`'s `state` |

State events carry the whole state as its option takes it (`state`).
Drill roots apply once the first frame has drawn the trees. The pinned
tooltip has no option: `chart.pin` sets it, with `expected` too, and
`chart.pinned` reads it.

**Conditional writes.** Each state event carries a `basis`, and
`chart.basis` names the chart's state now. Given as `expected`, a setter
applies only if the state it writes, where it writes it (the views it
sets, the selection, what is hidden), has not changed since, whether that
change has been reported yet or not (before the first frame, inside a
listener); otherwise it changes nothing and the chart reports that state
again, with cause `"api"` (or the change's own report, still to come,
does). An answer that took time, a server's or a Python kernel's, never
undoes what the user did in the meantime:

```ts
chart.on("select", async ({ selection, phase, basis }) => {
  if (phase !== "commit" || selection?.kind !== "brush") return;
  const snapped = await server.snap(selection);
  chart.select(snapped, { expected: basis }); // dropped if the user brushed again
});
```

A basis of another chart, or of one since destroyed, is refused.

**Conditions.** A `select` event's `conditions` say what the selection
holds on each table its marks read, as a condition on that table's fields:
a brush's ranges on the fields its marks place along the brushed axes
(and in a facet's panel, its facet's values), items by what names them (their `itemKey`, a bar's category and
series, what an aggregate groups by), series by their field's value;
of a mark over a row view, within the view's filter. A
table whose rows no condition says exactly (a lasso's, a stack's tops, a
view restricted to a row set) gets none. A
[row view](data.md#row-views) or a query takes one:

```ts
// A chart of one table: its condition filters a row view of the table.
chart.on("select", ({ conditions, phase }) => {
  if (phase === "commit") list.setQuery({ filter: conditions[0]?.condition ?? true });
});
```

A table is left out where no condition says exactly which rows the
selection holds: lassos, stacks' tops, summaries' statistics, and items
named only by their row.

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
| `live` | The channel hears a brush's previews while it moves, and its cancel, which gives back what the channel held before the gesture; commits only by default. |
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
- **Items and series** ([Selections](#selections)) write the rows they
  stand for: an item's rows (a layout item's, such as a slice's or a
  node's subtree's, in every panel it is drawn in), a series' condition on
  its field, or for a series of a mark's several value fields, every row
  the mark draws (its row view's).

Lassos and clicks write `RowSet`s, which keep their rows while others are
appended and dropped. What a chart writes, the store freezes; a click with
Shift or Ctrl writes a copy of the channel's rows with its own added or
removed. A grid bound to the channel reports each of the chart's writes as a
`select` with cause `"sync"` ([Grids](grids.md#events)): a live brush's
previews, its commit or cancel, and its clear. `chart.select(selection, { rows: false })` shows a
selection without writing rows, as when mirroring another view's brush.

### How marks highlight

Rows the channel does not hold are dimmed to a quarter of their opacity,
or drawn in the mark's `unselected` look and the rows it holds in its
`selected` look ([Selections](#selections)); an empty selection dims every
row.

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
move with them, those the guides list too (on other sides, with tick
layers or labels of their own), laid out for the domains between.

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

A bar race is bars keyed by `itemKey` on a rank axis, reset each keyframe,
moving at an even pace from one to the next:

```ts
const race = createChart(element, {
  marks: [bar(brands, { itemKey: "brand", orient: "y", x: "value", y: "rank", labels: true })],
  y: { domain: [11.5, -0.5] }, // ranks 0 to 11 shown, the first at the top
  x: { place: { side: "top" } },
  animation: { values: true, duration: 250, easing: "linear" },
});
brands.reset(nextKeyframe); // bars change places, come and go past the last rank, labels count
```

`easing` says how views, values, and drills move over the duration, as
d3's curves of these names (not CSS's timing functions, which are other
curves):

| `easing` | Moves | For |
| --- | --- | --- |
| `"cubic-out"` (default) | fast, then settling: `1 - (1 - t)^3` | most changes |
| `"linear"` | at an even pace | races and streams of keyframes |
| `"cubic-in-out"` | speeding up, then settling | d3's default for transitions |

A spec writes it as a string (`"animation": { "easing": "linear" }`), and
Python as `hg.Animation(easing="linear")`; React, Vue, and Svelte take it
in `animation` too. One easing serves the whole chart. The types and the
spec refuse other names (`animation.easing: expected "cubic-out",
"linear", or "cubic-in-out"; received "bounce"`). Plain JavaScript given
one moves by `"cubic-out"` and tells of it once per `animation` option, as
`onError`, "error" listeners, or the console hear of other options
refused (the error's `path` is `animation.easing`), without keeping the
chart from drawing or failing `chart.ready`.

| Mark | Moves |
| --- | --- |
| Bars (stacked, labeled, histograms') | Matched within their series by `itemKey`, else by position (a category's name, a number, a time). Bars move between places on a category axis whose categories change order (its labels move with them) and along a continuous position axis. Bars keyed by `itemKey` come in and go out past the end of the position axis (below the last rank above); others grow from and shrink to their base. A bar changing sign passes through the baseline. |
| Value labels, text | A bar's label moves with its bar. Text is matched by `itemKey`, else by row. Labels writing a number count through the values between, in their format. |
| Pie slices, gauges | Slices turn to new sizes, always making a whole pie; a gauge turns its dial. |
| Sunbursts | Sectors matched by path move their angles and rings, new ones growing out of their parent; drilling moves the rings to the new root ([drilling](hierarchy-and-flow.md#drilling-into-trees)). Labels fade in and out where they are drawn at one end only. |
| Points | Matched by row, or with `itemKey: "id"` by a number, time, or category field (across `reset` and reordered data). |
| Lines, areas along x | When both scenes draw every row through the same positions (no level of detail, missing values, or breaks). |
| Error bars, candlesticks, regions | When both scenes draw as many at the same places along one axis. |
| Heatmap and 2D histogram cells | Fade to new colors over the same grid. |
| Custom marks | `draw` runs again each frame over a table of the fields the mark declares (`x`, `y`, and those `encode` reads) between their values, on the frame's scales ([custom marks](marks.md#animating-custom-marks)). Items match by `itemKey`, else by row. |

A bar or text label whose key is missing matches its row while the table
keeps its rows (not across `reset`); a point whose key is missing, and
items sharing a key, show at once while the rest of their series moves.

A change arriving while values move moves on from what is on screen:
bars, points, labels, and sectors keep moving from where they are, so a
reset every 250 ms with a 750 ms duration plays as one motion. The picture
then trails the data until changes stop.

**Refused.** Box plots, boxen, violins, rugs, contours, dendrograms,
treemaps, funnels, radars, Sankey diagrams, networks, maps, and 3D marks
refuse `values` with a `ChartError` (`unsupported`, path
`animation.values`).

**Shown at once instead:** appended and dropped rows, and changes until
data has been still for a change's duration after them (so streams never
animate forever); changes of options or hidden series; category axes
gaining or losing categories, and lines and areas over categories that
change order, and custom marks over categories that change order; pies
whose kept slices change order; scenes over 2,000 bars, slices, sectors,
rules, and custom marks' rows or 10,000 points (of points or lines),
counting items going; point clouds, sampled points; a row view's own
changes (`setQuery`, `restrict`; its table's values changing in place move
as a table's do); changes before the code that moves them has loaded (it
loads with the chart's first frames: `await chart.loading`; charts with
custom marks load theirs a request later); charts with a navigator or
`sync`, off screen, read by the pointer or keyboard, or slow (over 10 ms a
frame); pages preferring reduced motion. A pointer reads a chart unless it
has `inspection: false` and no hover listener; drills play on under it.
Charts of several panels or with `sync` do not animate their views. Only
the drawing moves: data, tooltips, and events have the new values at once
(during a drill, the pointer reads the sectors as drawn).

## Hiding series

Legend entries hide and show what they name; the chart's methods do too.

```ts
const [first] = chart.getLegend(); // { key, label, color, references } per entry
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
