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
every format form, by their field's kind. Series marks' `label`
and axes' `title` take parts (`{ series: true }`, `{ field }`,
`{ label }`, text). Displays also color values: a number field's
`thresholds`, and colors of mappings and missing values, color bars,
lines, areas, and regions colored by the field without a scale, points and
heatmaps without a ramp of their own, series of category fields, gauges'
bands, and tooltip fields' swatches, with a key in the legend; rules and
regions stand at a field's thresholds (`{ thresholds: "p99" }`,
`hg.AtThresholds` in Python). A display's `link` (`hg.Link` in Python)
makes a link of each value from the row's values, URL-encoded: pinned
tooltips draw tooltip fields' links (http, https, mailto, and relative
URLs only), events carry them (`InspectedField.link`), and `displayOf`
gives them to application code.
