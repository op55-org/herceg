# Changelog

All published packages share one version: `herceg`, `@herceg/react`,
`@herceg/vue`, `@herceg/svelte`, and the Python package `herceg`. Before 1.0,
a minor version may change APIs; each such change is listed here with what
to do about it.

## Unreleased

The first release.

- **`herceg`**: the engine, with tables, marks, layouts, interaction,
  chart state (state options, conditional writes, selections of items and
  series, pinned tooltips), rendering, and export; optional parts as
  subpaths (`herceg/spec`, `herceg/fields`, `herceg/pdf`, `herceg/image`,
  `herceg/fonts`, `herceg/grid`, `herceg/web`, ...). See
  [Getting started](docs/guide/getting-started.md).
- **`@herceg/react`, `@herceg/vue`, `@herceg/svelte`**: components over the
  same engine. See [React, Vue, and Svelte](docs/guide/frameworks.md).
- **`herceg` for Python**: charts from pandas, Polars, PyArrow, and NumPy,
  with notebook widgets, Streamlit, `herceg.express`, and web pages. See
  [Herceg for Python](docs/guide/python/README.md).

What each mark supports is in [the support table](docs/guide/support.md)
and the [capability matrix](docs/capabilities.md), which the package also
publishes as `herceg/capabilities.json` beside the spec's JSON Schema,
`herceg/spec.schema.json` (`hg.spec_schema()` in Python), for chart
editors; what is planned, in the [roadmap](docs/roadmap.md).

Formats write numbers (Intl options, d3-like patterns with text around
them, durations, SI and binary prefixes) and times (Intl options, strftime
patterns, fiscal years) on every option that takes one. [Field
displays](docs/guide/fields.md) name fields and write their values once,
for every surface: charts' `fields` (TypeScript, the adapters, specs, and
`hg.Chart(fields=...)`) write axes, legends, series' names, tooltips,
labels, gauges, color ramps, the text alternative, and layout marks'
names and amounts (pies, funnels, trees, Sankey diagrams, networks, maps,
radars) through them, grids take them as charts do (headers, cells,
group rows, and pivots; `model.update({ fields })` changes them), a
`compileFields(rules)` result is one compilation charts and grids share,
and `herceg/fields` reads them for application code. Grid columns take
every format form, by their field's kind. Grid cells take looks: a
column's `encode`, a grid's `encode` of whole rows, and a column's
`aggregateEncode` of group rows color backgrounds and text through the
channels marks' colors take (display colors, the grid's `scales` with
gradients and scales of categories, conditions, rank tests, and lists),
with black or white text over fills by WCAG contrast, in pivots and remote
grids too; `model.update({ scales, encode })` changes them. Grid cells draw
more than text: linked fields' cells hold their links, columns take cell
kinds (`barCell`, `chipCell`, and `symbolCell`, whose shapes `encode.symbol`
gives), `createGrid`'s `cells` takes custom renderers by column id (text,
control, or composite cells, with signals and declared fields), and columns
without fields write their `text` (literal text and fields), which a
renderer draws more for, or draw `sparklineCell`: a line or area per row
of another table's rows matching the row's key by raw value, over an x
window the column shares, at most four points a device pixel with gaps
narrower than a pixel joined, its text a summary that screen readers and
`cellAt` (`sparkline`) read, kept current through appends. React's `<Grid>` and `<RemoteGrid>`
(`@herceg/react/grid/remote`) take `cells` as render functions by column
id, typed by the model's fields: rendered through portals in the
component's tree, their state kept per row, each in an error and
Suspense boundary drawing the cell's text, and committed before the grid
paints; `<PivotGrid>` (`@herceg/react/grid/pivot`) shows pivots. Series marks' `label`
and axes' `title` take parts (`{ series: true }`, `{ field }`,
`{ label }`, text). Displays also color values: a number field's
`thresholds`, and colors of mappings and missing values, color bars,
lines, areas, and regions colored by the field without a scale, points and
heatmaps without a ramp of their own, series of category fields, gauges'
bands, and tooltip fields' swatches, with a key in the legend; rules and
regions stand at a field's thresholds (`{ thresholds: "p99" }`,
`hg.AtThresholds` in Python). A display's `link` (`hg.Link` in Python)
makes a link of each value from the row's values, URL-encoded: pinned
tooltips draw tooltip fields' links and grid cells their fields' (http,
https, mailto, and relative URLs only), events carry them
(`InspectedField.link`), and `displayOf` gives them to application code.

Channels in `encode` (and points' flat `color`, `size`, `fillOpacity`, and
`symbol`) also take a list of channels tried in order, each drawn item
taking the first output, and conditions without `otherwise` (no output
where they fail) or with a rank test as their condition (`{ top: n, field }`,
`{ bottom: n, field }`: the n largest or smallest values of the mark's
rows, ties in, followed as rows stream). In Python, a list of channels,
`hg.when(condition, then)`, and `hg.top(n, field)` / `hg.bottom(n, field)`.
Lists split no series; one ending in the series' colors keeps their
legend entries and toggles, and scales read in a list show their key.
Custom marks read lists through `encoded(channel, row, series)`. Heatmaps
take no `encode`.
