# Notebooks and Streamlit

Charts display in notebooks as they are. `chart.widget()` makes a live
chart that Python keeps updating and that reports what the user does;
`herceg.streamlit.chart` does the same in a Streamlit app.

- [Static notebook output](#static-notebook-output)
- [Live charts](#live-charts)
- [Views, selections, and events](#views-selections-and-events)
- [Trees, networks, and 3D](#trees-networks-and-3d)
- [Selected rows](#selected-rows)
- [Streamlit](#streamlit)

## Static notebook output

A chart as a cell's value displays in Jupyter, JupyterLab, and VS Code;
`chart.show()` displays it, or opens a browser tab outside notebooks. Each
chart shows in an isolated frame with the Herceg bundle embedded, so it
works offline. Static outputs [sync](../interaction.md#sync) with each
other across frames. They report nothing to Python.

## Live charts

`chart.widget()` runs on [anywidget](https://anywidget.dev), in
JupyterLab, Jupyter Notebook 7, VS Code, and Colab (`pip install
'herceg[notebook]'`).

```python
live = hg.Chart(df, title="CPU", zoom=True, brush="x").line(x="time", y="cpu").widget()
live  # display it

live.append(new_rows, max_rows=10_000)  # stream rows, keeping the last 10,000
live.replace(today)  # replace every row
live.update(title="CPU, today", theme="dark")
live.set_viewport((start, end))  # zoom x, keeping y; None fits every axis
live.set_viewport(hg.Viewport(x=(start, end), y=(0, 100)))
live.selection = (start, end)  # brush an x range; None clears it
```

- `append` takes a table like the chart's data, or one row as a mapping;
  `replace` a table. Rows need every column the chart reads, with the same
  kinds. Only new rows travel, as binary buffers, and the chart redraws
  once on the next frame. `max_rows` keeps a rolling window.
- A mark reading its own data takes `data=`: `live.append(rows,
  data=events)`.
- `update` takes `hg.Chart`'s options except data and facets; `None`
  restores a default.
- A widget displayed in several cells is one chart: updates and brushing
  reach every output. A browser opening the notebook later draws the
  current data. A chart displayed again, or redrawn by `update` or
  `replace`, keeps its views and hidden series where it still draws them.
- [Express charts](express.md#new-data) compute again on `append` and
  `replace`.
- Over [ordered data](../data.md#rows-that-arrive-late)
  (`hg.ordered(df, by="time")`), `append` takes rows in any order and
  merges late ones into place, in the browser and in Python's copy alike;
  `max_rows` keeps the last rows in time order. Rows keep their identity
  as late rows move them, so selections stay on their observations, and
  `RowSelection.rows` counts positions in order.

## Views, selections, and events

```python
live.selection  # an hg.BrushSelection, hg.ItemSelection, hg.SeriesSelection, or None
live.get_viewport()  # an hg.Viewport: x, y, y_right, each None when not zoomed
live.hidden_keys  # what the legends hide

live.on_select(lambda event: print(event.phase, event.selection))
live.on_viewport(lambda event: print(event.cause, event.views[""].x))
live.on_visibility(lambda state: print(state.hidden_keys))
live.on_hover(lambda event: print(event.target, event.inspection))
live.on_context_menu(lambda event: add_annotation(event.pointer.values))


def show_row(event):
    # A row of the data, not an aggregate (a bin), an axis label, or the plot.
    if isinstance(event.target, hg.ItemTarget) and event.target.row is not None:
        print(df.iloc[event.target.row])


live.on_click(show_row)
live.on_click(show_row, remove=True)  # stop calling it


def drill(event):
    # What a clicked bar or bin stands for, and through hg.derive the rows behind it.
    provenance = getattr(event.target, "provenance", None)
    if provenance is not None and provenance.source is not None:
        print(provenance.groups)  # (hg.ValueGroup(field="month", value=datetime(2025, 2, 1)),)
        print(provenance.source.condition)  # its days, as an hg.Expr on the source table


live.on_click(drill)
live.on_edge(lambda edge: print(edge.side, edge.bound))  # near an end of `limits`
live.on_error(lambda error: print(error))  # what a browser refused
live.show_cursor(x=when)  # hide_cursor() hides it
live.pin(value=when, axis="x")  # pins the tooltip there; pin() lets it go
live.on_pin(lambda pinned: print(pinned))  # clicks with hg.Tooltip(pin="click") too
```

| Value | Holds |
| --- | --- |
| `hg.Viewport` | `x`, `y`, `y_right` ranges, None where not zoomed. A pair sets x alone. |
| `hg.BrushSelection` | Brushed `x` and `y` ranges, a `lasso` outline, and the `panels` it is in. |
| `hg.ItemSelection`, `hg.SeriesSelection` | Items or series a click selected (`select="items"` or `"series"`), by their keys; set them by keys or by `hg.ItemReference(mark, item)` and `hg.SeriesReference(mark, series)` naming a mark's `id`. |
| `hg.SelectEvent` | What `on_select` hears: the `selection`, its `phase` (`"preview"` while a brush moves, then `"commit"` or `"cancel"`), `owner`, and the `basis` to write back on. |
| `hg.ViewportEvent` | One change of view: `scales` changed, every panel's `views` (by panel key, `""` for one panel), `cause` (`"pointer"`, `"wheel"`, `"keyboard"`, `"api"`, `"sync"`, `"data"`, `"options"`), and `panel`. |
| `hg.ViewEdge` | `scale`, `side`, `domain`, `bound`, `panels`, `cause`. |
| `hg.InputEvent` | What `on_hover`, `on_click`, and `on_context_menu` hear: `pointer` (`hg.Pointer`: `x`, `y`, `panel`, `in_plot`, its `values` by axis, datetimes on time axes, and `categories`; None for the keyboard), `target` (`hg.ItemTarget`, `hg.AxisLabelTarget`, `hg.LegendEntryTarget`, or `hg.PlotTarget`, by `kind`; None over nothing), `inspection`, `cause`, and `revision`. |
| `hg.Provenance` | What a clicked item stands for (`event.target.provenance` on clicks, secondary presses, and Enter; None on hover): its `groups` on its mark's data (`hg.ValueGroup`: `field`, `value`; `hg.IntervalGroup`: `field`, `start`, `end`, `closed`), the `condition` its rows meet there (an `hg.Expr`; None where none says them exactly, as for a row without `item_key`), and `source` (`hg.ProvenanceSource`: `table`, `condition`), that condition through `hg.derive` on the table derived from, None for data not derived. See [Events](../interaction.md#events). |
| `hg.Inspection` | What the inspection reads: `axis`, `value`, `label`, `panel`, and `points` (`hg.InspectedPoint`: `label`, `value`, `text`, `fields`, `row`, `mark`, `mark_id`, `key`). |
| `hg.PinTarget` | Where the tooltip is pinned (`live.pinned`, what `on_pin` hears): an `item` by its key, or a `value` on an `axis`, in a `panel`. Assign one to `live.pinned`, or call `live.pin(...)`; None lets it go. |
| `hg.ItemMove` | What `on_item_move` hears: a network node or a dragged rule moved, by `key` and `mark_id`, its `position` (`hg.ItemPosition`: a node's `x` and `y`, or a rule's value on its axis), `phase` (`"preview"` while a rule moves, `"commit"`, `"cancel"`), `cause`, and `revision`. |

- Values are Python values: datetimes on time axes (naive, in UTC),
  category labels on category axes, numbers otherwise.
- `row` is the point's position in its mark's data as the chart holds it
  (`df.iloc[row]`); None for points that summarize rows (bins, boxes,
  slices, tree nodes). A 3D inspection also has `values` by column.
- Hover, zoom, and selection reach Python at most every 100 ms, ending
  with the latest. Hover and click are sent only while a callback listens.
  Selection and viewport callbacks run for Python's own changes too.
- **Writing back.** `live.select(value, expected=event.basis)` applies
  only if the selection has not changed since that report, so an answer
  that took time never undoes what the user brushed meanwhile; refused, it
  changes nothing and `on_select` hears the selection as it is.
- `set_viewport` asks every browser showing the widget; what one refuses
  comes to `on_error` as an `hg.ChartError`.
- **Pins** reach every output and survive redisplay; a pin at an item the
  data removed lets go, and `on_pin` hears so.
- **Dragged rules** (`chart.rule(y=250, id="threshold", drag=True)`) go
  back where they were unless Python moves them:
  `live.on_item_move(lambda move: move.phase == "commit" and live.update_rule("threshold", y=move.position.y))`.
  `update_rule` moves a rule at a value in every output and in what later
  outputs draw; the browser draws the rule back until Python's answer
  arrives.
- **Panels.** `get_viewport(panel="latency")`, `panel_viewports`,
  `set_viewport(..., panel=)`, and `on_viewport(..., panel=)` address a
  panel's scales. A chart of map or network subplots alone needs `panel`.

Loading history as the reader pans back:

```python
shown_rows = df
first = df["time"].min()


def load_older(edge):
    global first, shown_rows
    if edge.side != "start":
        return
    older = fetch_before(first)  # the application's loader
    first = older["time"].min()
    shown_rows = pd.concat([older, shown_rows])  # older rows first
    live.replace(shown_rows)  # the view stays
    live.update(limits={"x": hg.ViewLimits(extent=(first, None), edge=True)})


live.on_edge(load_older)
```

## Trees, networks, and 3D

| Chart | State | Callback | Per panel |
| --- | --- | --- | --- |
| Treemap, sunburst (`zoom=True`) | `drill_root`: a tuple of item keys, None for the whole tree | `on_drill` | `panel_drill_roots`, `on_drill(..., panel=)` |
| Network (`drag=True`) | `item_positions`: moved nodes' `(x, y)` in layout units | `on_item_positions` (each move: `on_item_move`) | `panel_item_positions`, `on_item_positions(..., panel=)` |
| 3D | `camera`: an `hg.Camera` | `on_camera` | `panel_cameras`, `on_camera(..., panel=)` |

```python
tree = hg.treemap(sales, path=["region", "country"], value="revenue", zoom=True).widget()
tree.on_drill(lambda root: print(root))
saved_root = tree.drill_root  # for example, ('[0,"Europe"]',)
tree.drill_root = None  # the whole tree
tree.drill_root = saved_root  # back to that branch

network = hg.graph(links, "source", "target", drag=True).widget()
positions = network.item_positions  # a copy: edit it and assign it back
network.item_positions = {}  # reset every moved node
```

- Keys are the opaque keys inspections report, not labels; the browser
  checks them and shows an error for unknown ones.
- Assigning `item_positions` replaces the whole mapping; omitted nodes go
  back to their computed places. Changed data keeps the overrides of nodes
  it still has.
- These states reach every output, survive redisplay and reload, and run
  their callbacks for Python's assignments too. A tree whose data removed
  the drilled branch restores its nearest surviving ancestor.
- Camera reports are throttled while dragging; `update(camera=...)`
  resets the cameras whose defaults change.

## Selected rows

`row_selection=hg.SelectionBinding("focus")` binds a chart to a channel of
a selection of its rows, as [selected rows](../interaction.md#selected-rows)
do in TypeScript.

```python
live = (
    hg.Chart(trips, brush="xy", row_selection=hg.SelectionBinding("focus"))
    .point(x="distance", y="fare")
    .widget()
)
live.on_row_selection(lambda picked: print(picked.rows, picked.condition))
live.row_selection  # an hg.RowSelection
live.row_selection = [3, 8]  # rows by position (or a boolean mask)
live.row_selection = hg.col("fare") > 20  # a condition; None clears

picked = hg.SelectionBinding("focus", selection=hg.col("fare") > 20)
hg.Chart(trips, row_selection=picked).histogram(x="distance").to_svg()  # drawn highlighted
```

| `SelectionBinding` option | Means |
| --- | --- |
| `events` | Gestures that select (`["click"]`; `[]` shows only) |
| `effect="none"` | Select without dimming |
| `data` | The table (the chart's data by default); a list binds several |
| `fields` | Columns to send beyond those marks read, for conditions set from Python |
| `selection` | What the channel holds when drawn: a condition, positions, a mask, or a widget's `row_selection` |

- An `hg.RowSelection` holds `channel`, `data`, and either `rows`
  (positions in the data as the chart holds it now) or a brush's
  `condition` (an `hg.Expr`).
- Rows keep naming the same records through `append` and dropped rows; a
  `replace` lets them go.
- `live.selection` draws a brush without selecting rows; set
  `row_selection` for that.
- Static HTML highlights in the browser and reports nothing; SVG, PNG, and
  PDF draw the binding's `selection`.

## Streamlit

`herceg.streamlit.chart(chart)` shows a chart in a
[Streamlit](https://streamlit.io) app (Streamlit 1.51 or newer; `pip
install 'herceg[streamlit]'`) and returns what the user did.

```python
import herceg as hg
import herceg.streamlit as hst

chart = hg.Chart(df, brush="x").line(x="time", y="latency")
state = hst.chart(chart, key="latency", on_select="rerun", on_click="rerun")

if isinstance(state.selection, hg.BrushSelection) and state.selection.x:
    start, end = state.selection.x
    st.dataframe(df[df["time"].between(start, end)])
if state.click and state.click.inspection:
    st.write(state.click.inspection.label, state.click.inspection.points)
```

| Reaction | State | Reports |
| --- | --- | --- |
| `on_select` | `state.selection` (`hg.BrushSelection`, `hg.ItemSelection`, or `hg.SeriesSelection`) | Brushes and clicks that select, once released; a rerun that redraws the chart keeps them, but items named only by their rows (marks without `item_key`) |
| `on_click` | `state.click` (`hg.InputEvent`, this run only) | Clicks |
| `on_viewport` | `state.viewport`, `state.panel_viewports` | Pan and zoom |
| `on_row_selection` | `state.row_selection` (`hg.RowSelection`) | Rows of one `row_selection` binding |
| `on_drill` | `state.drill_root`, `state.panel_drill_roots` | Tree navigation |
| `on_item_move` | `state.item_positions`, `state.panel_item_positions` | Moved network nodes |
| `on_camera` | `state.camera`, `state.panel_cameras` | 3D turns |

Each reaction takes `"ignore"` (the default: kept in the browser),
`"rerun"` (rerun the script so `chart(...)` returns it), or a function of
no arguments, called before the rerun.

- **Reruns.** The chart is a components-v2 custom component in a shadow
  root, its spec and columns one binary payload. A rerun sending the same
  chart leaves it alone; changed data or options remount it in place,
  restoring zoom, hidden series, the brush where its values still are,
  drill roots, node positions, and cameras. Runs that change only how the
  chart looks keep clicked and lassoed rows.
- Give a chart a `key` to keep its selection when its data changes, and to
  show several charts with the same content.
- Inside `st.form`, a selection reaches the script on submit; clicks do
  not (Streamlit sends none from forms).
- Maps keep their view and lasso only while the resolved projection stays
  the same.
- Charts without a theme follow the app's light or dark theme.
- Points with `item_key` show at once on remount; keyed replacements
  animate in widgets and JavaScript apps.

[examples/streamlit_app.py](../../../python/examples/streamlit_app.py) is
a complete app.
