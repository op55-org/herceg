# Packages and adapters

How the npm packages and the Python package are split, and how the
framework adapters and Python's live charts sit on the engine. For using
them, see [Frameworks](../guide/frameworks.md) and the
[Python guide](../guide/python/README.md).

- [Package layout](#package-layout)
- [React](#react)
- [Vue](#vue)
- [Svelte](#svelte)
- [The Python package](#the-python-package)
- [Keeping the core DOM-free](#keeping-the-core-dom-free)

## Package layout

The `herceg` npm package holds the engine, renderers, and browser runtime
as ES modules with `sideEffects: false`, so bundlers drop what a chart does
not use. Optional pieces are subpaths, so unbundled imports (a CDN, Node)
do not load them either:

| Subpath | Holds |
| --- | --- |
| `herceg` | Tables, marks, `createChart`, `renderToSVG`, snapshots |
| `herceg/layout` | Subplot layout helpers |
| `herceg/spec` | Loading, validating, and exporting portable specs |
| `herceg/pdf`, `herceg/image`, `herceg/fonts` | PDF, raster images, supplied fonts |
| `herceg/grid`, `herceg/grid/model`, `herceg/grid/pivot`, `herceg/grid/remote`, `herceg/grid/memory`, `herceg/grid/conformance` | Grids |
| `herceg/pivot` | Row pivots |
| `herceg/web` | Payloads and page fragments |

Framework adapters are separate packages because their dependencies
differ; one engine package avoids version skew between its pieces. The
engine, adapters, and Python package share one `X.Y.Z` version, checked
against their metadata and exact engine dependencies; the release
procedure is in [AGENTS.md](../../AGENTS.md#releasing). All distributions
include the MIT license text.

## React

`@herceg/react` is a thin layer over the engine.

- `<Chart>` creates one chart in a layout effect and destroys it on
  unmount. Mark elements render nothing and are read as mark specs, so
  there is no React element per data point.
- Props are the whole configuration: changes reach the chart through
  `chart.update` in a layout effect, removed options reset to defaults, and
  updates are skipped when no option, spec, or table changed (compared as
  JSON with sorted keys). Unchanged marks keep their identity, so their
  caches survive re-renders.
- Data changes go through the table and the chart's own frame scheduler,
  without rendering React.
- `<Grid>` (`@herceg/react/grid`) creates the grid in a layout effect,
  applies `ariaLabel`, `theme`, and `headerHeight` with `update`, and
  renders React for none of the grid's changes.

## Vue

`@herceg/vue` follows the same model in Vue's terms.

- `<Chart>` reads its mark components from the default slot during render
  without mounting them, so Vue tracks the state options and marks read.
  The chart is created in `onMounted` and updated in `onUpdated`.
- Option arrays and objects are copied out of reactive proxies as they are
  read, so in-place changes are seen; tables are unwrapped (their private
  fields cannot be reached through a proxy).
- Errors building marks are caught during render and thrown again from
  those hooks, because a render that throws makes Vue replace the
  container, and the chart with it.
- Vue does not tell a component which listeners it has, so the chart
  always listens and computes hover and click payloads.
- Annotation and custom mark components are generic in the table rather
  than its schema, so vue-tsc infers the table from `data` before typing
  `draw`.

## Svelte

A Svelte snippet is opaque, so `@herceg/svelte` mounts its mark
components.

- Each builds its mark in a `$derived` from its props and adds itself to
  the enclosing `<Chart>` through context.
- Each renders one empty `<template>` in a hidden element of the chart,
  and the chart orders marks by those elements' document positions, so
  marks added by `{#if}`, `{#each}`, or the application's components draw
  in template order. A mutation observer re-sorts them when a keyed
  `{#each}` moves them.
- One effect reads the options and every mark and applies them with the
  same comparison as React; the chart is created the first time it runs,
  after the marks have added themselves.
- The package is built with `svelte-package` and checked with
  svelte-check, which need TypeScript's JavaScript API, so it keeps
  TypeScript 6 beside the repository's TypeScript 7.

Each adapter's components are checked at compile time to take exactly
what their engine functions take (`props.types.tsx`, `props.types.ts`,
`props.ts` in each adapter's tests).

## The Python package

`python/` emits specs with binary buffers and ships bundles of the engine
built by `npm run build:python`: a classic script for HTML output, a
DOM-free script for export in an embedded V8, and ES modules for live
charts and web pages.

**Live notebook charts** (`chart.widget()`, an anywidget) keep the current
data in Python and send each change as one message: appended or replaced
columns as binary buffers, changed options as JSON.

- Messages carry a revision number. A browser that connects late, reloads,
  or misses a message asks for the whole chart, which Python builds from
  its current data under the lock that orders updates; it is not stored in
  widget state, so updates never resend it.
- A range brushed or zoomed in one browser goes through Python to the
  others, marked with its origin; a report made before a newer change is
  dropped. Views of one widget share its tables in the browser, so an
  update is decoded once however many outputs show it.
- Drill roots, node positions, and cameras use the same revision and
  origin protocol, per panel where subplots have their own. Node moves are
  combined once a frame; a change of a network's data lets go of the moves
  of nodes it no longer has, on both sides, as each front end draws it.
- Express charts remember their call, so `hx.recompute` makes them again;
  bootstrap results are memoized by a digest of their inputs. A widget of
  an express chart sends changed tables in one message when its marks and
  layout stay the same, else the whole spec, which the browser loads
  without touching zoom or brush.

**Streamlit** (`herceg.streamlit.chart`, components v2) has no connection
that outlives a script run, so every run sends the whole chart as one
[binary payload](export.md#web-pages). Equal bytes keep the drawn chart;
changed bytes remount it in the same container, restoring zoom, brush,
drill roots, node positions (through `carryNodePositions`), and cameras
where they still apply. Charts without a theme read the app's from the CSS
variables Streamlit gives components.

## Keeping the core DOM-free

`test/architecture.test.ts` keeps the core directories (`data`, `geo`,
`grid`, `scale`, `format`, `lod`, `marks`, `model`, `scene`, `spec`,
`three`) free of DOM access, and checks that everything
`herceg/grid/model` imports is in them. Marks import their drawings
(`draw`), which write SVG without a DOM and paint canvases through the
context they are handed; only raster painting reaches the DOM, creating an
offscreen canvas when `OffscreenCanvas` is unavailable.
