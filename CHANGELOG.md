# Changelog

All published packages share one version: `herceg`, `@herceg/react`,
`@herceg/vue`, `@herceg/svelte`, and the Python package `herceg`. Before 1.0,
a minor version may change APIs; each such change is listed here with what
to do about it.

## Unreleased

The first release.

- **`herceg`**: the engine, with tables, marks, layouts, interaction,
  rendering, and export; optional parts as subpaths (`herceg/spec`,
  `herceg/state`, `herceg/fields`, `herceg/pdf`, `herceg/image`, `herceg/fonts`, `herceg/grid`,
  `herceg/web`, ...). See [Getting started](docs/guide/getting-started.md).
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
for every surface: `herceg/fields` and specs read them; charts do not yet.
