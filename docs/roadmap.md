# Roadmap

Work Herceg intends to do, grouped by area. Nothing here has a date; items
move into the guides when they ship. What works today, and its limits, is
in the [guides](README.md).

- [Data and selections](#data-and-selections)
- [Performance and benchmarks](#performance-and-benchmarks)
- [Charts](#charts)
- [Axes, legends, and layout](#axes-legends-and-layout)
- [Grids](#grids)
- [Python and live integration](#python-and-live-integration)
- [Export and pages](#export-and-pages)
- [Accessibility](#accessibility)
- [Frameworks](#frameworks)
- [Before a first release](#before-a-first-release)
- [Proofs](#proofs)

## Data and selections

- **Selections through aggregates.** A chart of a derived table's groups
  (a bar per region of means) shows and writes its source's selected rows,
  so brushing raw points highlights their groups' share and clicking a
  group selects its rows.
- **Incremental statistics.** Histograms, box plots, and violins following
  a brush step by step instead of a pass over their rows each change.
- **Selecting a group including rows to come**, as a condition rather than
  the rows the group has now.

## Performance and benchmarks

- **Heavy marks updating in place.** Heatmaps repainting only changed
  cells, and contours with simplification and level of detail when zoomed.
- **Large networks** off the main thread or on the GPU, if measurements
  show the need.
- **Renderer thresholds** tuned with benchmarks (today they are fixed
  estimates).
- **A full benchmark campaign** on a quiet machine: first interaction as
  well as first render, dashboards, sustained updates, memory, and mobile
  hardware.
- **Process and GPU memory in Firefox and WebKit**, which the harness
  measures in Chrome only, and benchmarks on more machines.
- **Smaller spec loader**: mark families loaded as specs name them, so
  `herceg/web` pages fetch less up front.

## Charts

The long-term target covers the major chart families. Not yet available:

- **Cartesian:** waterfall charts, and drawing tools for financial charts
  (trend lines and the like).
- **Density:** hexagonal bins; heatmaps, contours, and 2D histograms on
  log axes; labels along contour lines; calendar month labels aligned to
  week columns.
- **Flow and relationships:** chord diagrams; highlighting a node's
  neighbors or links on hover.
- **Specialized:** parallel coordinates and polar charts (radars exist);
  gauges with needles, ticks, and threshold markers; funnels with an
  area-proportional layout; radars with a scale per spoke.
- **Maps:** base maps, globes, great-circle lines and routes, and labels
  on regions.
- **3D:** meshes, parametric surfaces, bars and text in 3D, isosurfaces,
  and volumes; translucent and wireframed surfaces on the GPU.
- **Statistics:** the Seaborn parameters `herceg.express` does not take
  yet, such as `lineplot`'s `size` and `style`, `dodge`, `fill`, `width`,
  and `gap` on categorical plots, and `clustermap`'s row and column colors
  and linkages.

## Axes, legends, and layout

- Animation of categories that come and go.
- More than one axis per side, log color scales, legend scrolling, and
  colorbar handles.
- Grapheme-aware shortening of long labels.

## Grids

- Column groups (headers over several columns) beyond pivots, sizing
  columns to their content, and moving columns by touch.
- Custom cell content, editing, and copying.
- Pivots and binned times in remote grids, a SQL generator for grid
  queries, and remote grids from Python.
- Grid components for Vue and Svelte.

## Python and live integration

- **Live sessions:** row selections shared by separate notebook widgets on
  a page without bridging them in Python, and charts in web pages updated
  from the server (Server-Sent Events).
- Live charts tested in Jupyter Notebook 7, VS Code, and Colab, beside
  JupyterLab.

## Export and pages

- Raster images (PNG, JPEG, WebP) from Node without a browser.
- Fonts shipped with the package, for Unicode PDF text without supplying
  font files; CFF fonts, bidirectional ordering, and shaping in PDF.
- Pages under a Content Security Policy that restricts styles by nonce,
  without allowing inline style attributes.

## Accessibility

- Charts and grids tried with screen readers themselves (tests check what
  each browser engine gives them).
- Tagged PDF beyond the chart-level Figure, toward PDF/UA.
- Announcements in languages other than English.

## Frameworks

- Adapters for frameworks beyond React, Vue, and Svelte.

## Before a first release

- An API review across TypeScript, the adapters, and Python, then the first
  published release of the npm and PyPI packages.

## Proofs

- Tests proving the capability cells declared to work but not yet proved
  (the notebook widget's, Streamlit's, web fragments', and most Express
  recipes'), shown as ○ in the [capability matrix](capabilities.md).
