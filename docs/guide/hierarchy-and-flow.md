# Hierarchy, flow, and part-to-whole charts

Pies, treemaps, sunbursts, gauges, funnels, radars, Sankey diagrams, and
networks. These **layout marks** place their own geometry in a panel
instead of using x and y scales, so each has its chart, each facet panel,
or a subplot to itself (see [Layout](layout.md#layout-marks-in-panels)).

- [Pies and donuts](#pies-and-donuts)
- [Treemaps and sunbursts](#treemaps-and-sunbursts)
- [Gauges](#gauges)
- [Funnels](#funnels)
- [Radars](#radars)
- [Sankey diagrams](#sankey-diagrams)
- [Networks](#networks)
- [What layout marks share](#what-layout-marks-share)

## Pies and donuts

```ts
pie(sales, { category: "region", value: "revenue" });
pie(sales, { category: "region", value: "revenue", innerRadius: 0.6 }); // a donut
pie(visits, { category: "browser" }); // counts rows
```

```python
hg.pie(sales, "region", "revenue", inner_radius=0.6)
```

- A slice per category, sized by the sum of `value` (or the row count);
  negative and missing values count as nothing.
- Slices go largest first, clockwise from the top (`sort: "input"` keeps
  the categories' order), 2 px apart.
- Labels sit beside the pie with leader lines where there is room; those
  that do not fit, smallest first, are left out (`labels: false` turns
  them off).
- The legend toggles slices; the rest fill the circle. Tooltips report a
  slice's value and share of the slices shown.
- Pies animate value changes (`animation: { values: true }`).

## Treemaps and sunbursts

```ts
treemap(sales, { path: ["region", "country"], value: "revenue" });
sunburst(sales, { path: ["region", "country", "city"], value: "revenue" });
treemap(org, { node: "team", parent: "parentTeam", value: "cost" });
```

```python
hg.treemap(sales, ["region", "country"], "revenue")
hg.sunburst(org, node="team", parent="parent_team", value="cost")
```

| Tree from | Means |
| --- | --- |
| `path` | Category fields from the outermost group in. A row ends at its first missing one; its value belongs to the node there. |
| `node`, `parent` | Each row's node and parent. Rows without a parent are top-level; duplicate nodes, unknown parents, and cycles are errors. |

- A node's value is the sum of `value` over its rows and descendants (or
  their count). Negative or infinite values are errors.
- **Treemaps** fill the room with nested rectangles (squarified, largest
  first), groups named in a strip along their top. **Sunbursts** draw a
  ring per depth, each node's angle its share of its parent's.
- Nodes take their top-level group's color (deeper sunburst rings lighter),
  and the legend toggles top-level groups.
- Names go inside shapes with room for at least three characters. Tooltips
  report a node's path, value, and share; the arrow keys visit nodes depth
  first. Items keep their keys (a node's path or name) as the tree changes.

### Drilling into trees

```ts
const chart = createChart(element, {
  marks: [treemap(sales, { path: ["region", "country", "city"], value: "revenue" })],
  interaction: { zoom: true }, // click or Enter opens a node
});
chart.on("drill", ({ key, path }) => console.log(key, path.map((step) => step.label)));
chart.setDrillRoot(["Europe", "France"]); // by names from the top, or by item key
chart.getDrillRoot(); // { key: '[0,"Europe","France"]', path: [{ key, label: "Europe" }, ...] }
chart.setDrillRoot(null); // the whole tree
```

```python
hg.Chart(sales, zoom=True).treemap(path=["region", "country"], value="revenue")
```

- With `interaction.zoom: true`, a click on a node with children lays out
  its subtree in the room. Nodes keep their keys and colors; tooltips give
  shares of the node drilled into ("12% in Europe").
- A breadcrumb strip ("All / Europe / France") is part of the chart, so
  exports show it, with a native button over each step. A sunburst also
  puts the drilled node in its middle, where a click goes up.
- Keys: Enter opens, Backspace goes up, 0 shows the whole tree; a toolbar
  has Up and whole-tree buttons. Each change is announced.
- When a row selection takes clicks, a click selects the node's rows and
  Enter still drills.
- `setDrillRoot` works with or without `interaction.zoom` and is followed by
  a `drill` event, which also reports when the data loses the drilled node
  and the tree shows its nearest remaining ancestor.
- Facet panels share one drill root; each subplot's tree has its own.
  Drilling shows the new layout at once (no animation).

## Gauges

```ts
gauge(metrics, { value: "cpu", label: "CPU", format: { style: "unit", unit: "percent" } });
gauge(sensors, { value: "temp", max: 120, bands: [{ to: 60 }, { to: 90 }, { to: 120, color: "#e0464f" }] });
```

```python
hg.gauge(metrics, "cpu", bands=[70, 90, (100, "#e0464f")])
```

A gauge shows the **last finite value** of a number field, so appending
rows moves it. Its dial is a 240° arc from `min` to `max` (0 to 100 by
default, as in ECharts).

| Option | Means |
| --- | --- |
| `label` | The text under the value (the field's name by default). |
| `format` | Intl.NumberFormat options for the value and the ends. |
| `bands` | Ascending band ends, each from the previous end; a thin ring outside the track, colored by `color` or the palette. The value's arc takes its band's color. |

Values beyond the dial fill it to that end and are written as they are;
without a value, the track is empty and reads "–". Gauges animate value
changes. They take no row selection. A gauge shows one value, with no
needle, ticks, or threshold marker.

## Funnels

```ts
funnel(signups, { category: "stage", value: "users" });
```

```python
hg.funnel(signups, "stage", "users")
```

- A centered bar per category, top to bottom in the field's order
  (`sort: "value"` puts the largest first), as wide as its value is to the
  largest stage's. Connectors between bars only lead the eye.
- Names go left of the bars (at most 35% of the width); each stage's value
  and share of the first stage go on or beside its bar (`labels: false`
  leaves them out).
- Tooltips report a stage's value and its share of the first and previous
  stages. All stages take the palette's first color; there is no legend.
- There is no trapezoid (area-proportional) layout.

## Radars

```ts
radar(scores, { category: "skill", value: "score", series: "player" });
radar(players, { fields: ["speed", "power", "range", "stamina"], series: "name" });
```

```python
hg.radar(scores, "skill", "score", series="player")
hg.radar(players, fields=["speed", "power", "range"], series="name")
```

| Spokes from | Means |
| --- | --- |
| `category` and `value` | A spoke per category (in dictionary order), a row per series and spoke. |
| `fields` | A spoke per number field, each row a polygon named by `series`. |

- A polygon per series, filled at `fillOpacity` (0.15 by default), with a
  dot at each value (`points: false` leaves them out). 3 to 100 spokes.
- Values are measurements, not counts: a later row replaces an earlier one
  for the same series and spoke. Without `series`, all rows are one
  polygon named `label`.
- Every spoke shares one linear scale from the center (0, or the least
  value, to a round number above the largest shown), or `domain`. Values
  beyond it sit at the rim or center, and tooltips say so.
- Missing values leave their vertex out; the outline breaks and the polygon
  goes unfilled.
- Spoke names go outside the rim; the radar shrinks to 60% to fit them,
  then shortens or drops names.
- In facet panels every radar has the table's spokes and series, each
  scaled to its own panel unless `domain` is given.

## Sankey diagrams

```ts
sankey(energy, { source: "from", target: "to", value: "twh" });
sankey(sessions, { source: "page", target: "next" }); // counts rows
```

```python
hg.sankey(energy, "source", "target", "twh")
```

- Nodes are the names in `source` and `target`. A link is as thick as the
  sum of `value` (or the row count).
- Rows with missing names or nonpositive or infinite values, self-links,
  and links that would close a cycle are left out; the chart's description
  says how many.
- Nodes stand in columns by their longest path from a node nothing flows
  into, as d3-sankey's "justify" alignment does, and settle near the nodes
  they connect to (`sort: "input"` or `"value"` instead). `nodeWidth` sets
  the bars' width (12 px).
- Links are translucent bands in their source's color. Labels show a node's
  name and value inside the diagram, dropping values, then shortening
  names, then hiding labels that overlap a larger node's.
- Tooltips report a node's inflow and outflow or a link's value. There is
  no legend. The layout is recomputed whenever the table changes.
- Links spanning several columns pass behind the nodes between. Nodes
  cannot be placed by hand, and hovering a node does not highlight its
  links.

## Networks

```ts
graph(friendships, { source: "a", target: "b" });
graph(messages, {
  source: "from",
  target: "to",
  value: "count", // link widths
  nodes: people, // a table with a row per node
  node: "name",
  color: "team", // colors and the legend
  size: "followers", // node areas
});
graph(reports, { source: "manager", target: "report", layout: "layered" }); // a tree, in layers
graph(friendships, { source: "a", target: "b", layout: { type: "circular", sort: "name" } });
```

```python
hg.graph(talks, "from", "to", nodes=people, node="name", color="team")
hg.graph(reports, "manager", "employee", layout={"type": "layered", "direction": "right"})
```

**Nodes and links**

- Nodes are the names in `source` and `target`, and with `nodes`, the
  `node` field's names, so nodes without links draw too. A later nodes row
  for the same node replaces its color and size.
- Links are undirected unless `directed: true`, which draws arrowheads and
  bows a pair's two links apart. Link width follows the sum of `value` (1
  to 6 px). Invalid rows and self-links are left out and counted in the
  description.
- `linkLabelField` writes a category at the middle of the heaviest links
  where it covers nothing.
- Nodes are circles of 5 px, or sized by area with `size` (3 to 14 px),
  ringed in the background color. With `color`, nodes and the links within
  a category take its color, and the legend toggles categories.
- Names stand beside the most connected nodes (all of up to 50), never
  covering another node or name (`labels: false` turns them off).

**Layouts**

| `layout` | Places nodes |
| --- | --- |
| `"force"` (default) | A force simulation after d3-force, starting from pivot MDS positions so rings come out round and trees unfold; separate pieces pack in rows. `{ type: "force", settle: false }` keeps other nodes still when one is moved. |
| `"circular"` | One circle, by group then `sort`: `"degree"` (default), `"input"`, or `"name"`. Links are chords. |
| `"layered"` | Layers from source to target (Sugiyama), for trees and directed acyclic networks, `direction` `"down"` (default), `"right"`, `"up"`, `"left"`. Links closing a cycle are turned around for placing only. |

- Every layout is deterministic. Static exports lay a network out to the
  end at once; in the browser a layout spreads over animation frames (about
  12 ms each), so the page stays responsive, and `chart.loading` settles
  once it is drawn.
- Nodes keep their places as data changes: remaining nodes start where they
  were, new ones beside their neighbors, and a short simulation moves only
  nodes within two links of the change.
- A force layout of 5,000 nodes and 20,000 links takes about 1.2 s; at the
  limit of 50,000 nodes and 200,000 links about 12 s (Chrome, Apple M6).
  Circular layouts take milliseconds.

**Navigating and moving nodes**

```ts
const chart = createChart(element, {
  marks: [graph(messages, { source: "from", target: "to", directed: true, linkLabelField: "kind" })],
  interaction: { drag: true, zoom: true },
});
chart.on("itemMove", ({ key, position }) => save(key, position));
chart.setItemPosition('[0,"Ana"]', { x: 40, y: -12 }); // layout units
chart.setItemPosition('[0,"Ana"]', null); // back where the layout puts it
chart.getItemPositions(); // the nodes moved
```

```python
hg.Chart(talks, zoom=True, drag=True).graph("from", "to", directed=True, link_label_field="kind")
```

| Option | Does |
| --- | --- |
| `interaction.pan: true` | Pans by dragging. |
| `interaction.zoom: true` (or `"xy"`) | Map gestures: wheel with Ctrl or ⌘ (trackpad pinch) at the pointer, drag to pan, double-click or 0 to reset, Shift+arrows, plus and minus, and a toolbar. The viewport is in layout units, y down; node sizes stay in pixels. |
| `interaction.drag: true` | Dragging moves a node; in a force layout, nearby nodes settle around it once dropped (about 0.3 s). Escape puts it back. Shift+arrows moves the node read (Alt+Shift+arrows with zoom on); 0 or the toolbar puts every node back. |
| `interaction.brush: "lasso"` | Selects nodes at their centers through a `rowSelection` bound to the nodes table. With zoom, Shift-drag pans. |

- Moves are kept in layout units, so they follow resizes and zoom, and last
  while their node remains. `getItemPositions` and `itemMove` report only
  nodes moved, never those that settled.
- Where nodes settle depends only on which nodes were moved where, so a
  chart given saved moves draws the same picture.
- Facet panels share one layout and its moves; each subplot has its own.
- An application that rebuilds a chart from a changed spec (as Streamlit
  does on each run) keeps node places with `carryNodePositions`:

```ts
import { carryNodePositions, chartFromSpec } from "herceg/spec";

const next = chartFromSpec(element, changedSpec, buffers);
carryNodePositions(previous, next); // before the old chart is destroyed
previous.destroy();
```

**Limits.** At most 50,000 nodes and 200,000 links: `graph()` refuses
more, and a network that grows past them draws nothing until it shrinks
(its description says why). Layered layouts needing more than 500,000 bend
points draw nothing. Networks take no `tooltip.fields`. Filter or
aggregate larger networks first. At the limits, pans and zooms of 200,000
Canvas links take 20 to 50 ms a frame (networks have no GPU path). Labels go
to at most the 50 most connected nodes, hovering a node does not highlight
its neighbors, links of a pair named differently have no label, and
settling after a move reaches at most 1,000 nodes.

## What layout marks share

- **One per panel.** A layout mark shares no panel with other marks; it
  does not zoom along axes, brush ranges, or sync. Maps and networks pan
  and zoom their own plane; trees drill.
- **Colors** follow what items stand for: pie slices, top-level branches,
  radar series, and network groups share colors and legend entries with
  other marks of the same field ([Styling](styling.md#colors-follow-what-series-stand-for)).
- **Selection.** Pies, funnels, treemaps, sunbursts, Sankey diagrams, and
  networks take a `rowSelection`: clicks select an item's rows, and items
  draw their selected share ([Selected rows](interaction.md#selected-rows)).
  Gauges and radars refuse one.
- **Tooltips** read the item under the pointer; charts of items alone refuse
  `"nearest-x"` and `"nearest-y"` tooltips. `tooltip.fields` show more of an
  item's row where the item is one row (slices, stages, nodes, links of one
  row); items summing several rows show none.
- **Animation.** Pies and gauges animate changed values; the others show
  them at once.
- **Facets and subplots.** See [Layout](layout.md#layout-marks-in-panels).
