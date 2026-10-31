# What each mark supports

Which shared behaviors each mark takes part in. Marks along x and y axes
take part in everything; layout marks in less. ✓ supported, ◐ partly (see
the notes), — not yet (refused with an error), · not applicable.

For every option by surface (TypeScript, spec, Python, adapters, notebook
widget, Streamlit, web pages), with the tests that prove each cell, see
the generated [capability matrix](../capabilities.md).

| Marks | Facets | Subplots | Insets | Panel scales | Right axis | Zoom and pan | Brushes | Synced selection | Selected rows | Highlight | Legend toggle | Series from color | Colors by identity | Tooltip and keyboard | Tooltip fields | Value animation |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| line, area, bar (including normalized stacks and area stream offsets) | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ |
| point | ◐ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| histogram | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ◐ | · | ✓ |
| boxplot, boxen, violin | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ◐ | · | — |
| rug | ✓ | ✓ | ✓ | ✓ | — | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| errorbar, candlestick | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | ◐ | ✓ | ✓ | ✓ |
| dendrogram | ◐ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | — | · | · | · | · | · | · | — |
| heatmap | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ◐ | ✓ | · | · | · | ✓ | ✓ | ✓ |
| 2D histogram | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ◐ | ✓ | · | · | · | ✓ | · | ✓ |
| contour | ✓ | ✓ | ✓ | ✓ | · | ✓ | ✓ | ✓ | ◐ | · | · | · | · | ✓ | · | — |
| rule, region, text | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | · | · | · | · | ◐ | · | ✓ |
| custom | ◐ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — | ◐ | · | ✓ | ◐ | ◐ | — |
| pie | ✓ | ✓ | ✓ | · | · | — | — | — | ✓ | ✓ | ✓ | · | ✓ | ✓ | ◐ | ✓ |
| treemap, sunburst | ✓ | ✓ | ✓ | · | · | drilling | — | — | ✓ | ✓ | ✓ | · | ✓ | ✓ | ◐ | — |
| radar | ✓ | ✓ | ✓ | · | · | — | — | — | — | — | ✓ | · | ✓ | ✓ | ✓ | — |
| funnel, sankey | ✓ | ✓ | ✓ | · | · | — | — | — | ✓ | ✓ | · | · | · | ✓ | ◐ | — |
| gauge | ✓ | ✓ | ✓ | · | · | — | — | — | — | — | · | · | · | ✓ | ✓ | ✓ |
| graph (force, circular, layered) | ✓ | ✓ | ✓ | · | · | ✓ | ◐ | — | ✓ | ✓ | ◐ | · | ✓ | ✓ | — | — |
| geoshape, geopoint | ✓ | ✓ | ✓ | · | · | ✓ | ◐ | — | ✓ | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | — |
| point3d, line3d | — | ✓ | ✓ | · | · | turning | — | — | — | — | ✓ | ◐ | ✓ | ✓ | ✓ | — |
| surface | — | ✓ | ✓ | · | · | turning | — | — | — | — | · | · | · | ✓ | ✓ | — |


## Notes

- **Every mark** draws in SVG, Canvas, static SVG, PDF, and server
  snapshots, in insets, and in web page fragments; large point series and
  3D charts also draw with WebGL. Every mark has a React, Vue, and Svelte
  component, and every mark but `custom` (JavaScript only) a Python
  builder.
- **Facets.** Custom marks without series repeat in every panel instead
  of splitting; dendrograms repeat
  (`facet: "repeat"`); 3D facets are refused (use subplots).
  [Layout](layout.md)
- **Right axis.** Marks placed along y (horizontal bars, box plots, boxen,
  violins, histograms, error bars, points on a category y, lines and areas
  along y, rugs along y) stay on the left.
  [Axes](axes-and-legends.md#a-second-y-axis)
- **Zoom and pan** work on number and time axes in every panel and inset.
  Banded axes do not zoom. Maps and networks pan and zoom their plane;
  trees drill; 3D charts turn. [Interaction](interaction.md#pan-zoom-and-brush)
- **Brushes** on maps and networks are lassos. Summaries are brushed along
  their bins or categories, and lassos select none of their rows.
- **Selected rows and highlight.** Histograms, box plots, boxen, violins,
  heatmaps, and 2D histograms highlight the selected share; contours
  select by brush only and draw as they are; annotations of a table and
  dendrograms select no rows; gauges, radars, and 3D charts refuse a
  binding. [Selected rows](interaction.md#selected-rows)
- **Series from color.** A category `color` names series on lines, areas,
  bars, points, histograms, box plots, boxen, violins, error bars, rugs,
  map points, and 3D points; candlesticks color by rise and fall, and
  `line3d` takes `series` only. [Styling](styling.md#colors)
- **Colors by identity.** A field's value has one color and legend entry
  in every mark and panel, layout marks' items included; candlesticks,
  funnels, and Sankey nodes color by their own rules.
  [Styling](styling.md#colors-follow-what-series-stand-for)
- **Tooltip and keyboard.** Summaries on log axes have no stop for groups
  whose median is not positive; annotations are read in the chart's
  summary; custom marks through their series. Charts of items alone refuse
  the axis inspection modes. [Accessibility](accessibility.md#keyboard)
- **Tooltip fields** show more of the row a point or item is; items
  summing several rows (pie slices of several rows, inner tree nodes) show
  none, and networks take none. [Tooltips](interaction.md#tooltips)
- **Value animation.** Lines and areas move when no labels follow them and
  their rows stay; areas along y show changes at once.
  [Animation](interaction.md#animation)
- **Everywhere.** Marks on the chart's scales take `clip`, `zIndex`
  ([Paint order](styling.md#paint-order)), and `legend: false`; lines,
  rules, and custom shapes take the four dash strings; lines, areas, bars,
  points, and error bars take coordinates for their places
  ([Marks](marks.md)).
