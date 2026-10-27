# Accessibility

What every chart gives keyboard and screen-reader users, the options that
shape it, and how it is tested.

- [What every chart has](#what-every-chart-has)
- [Keyboard](#keyboard)
- [Color and motion](#color-and-motion)
- [Static output](#static-output)
- [Testing and limits](#testing-and-limits)

## What every chart has

A chart is a focusable figure named by its `title` and described by a
summary of what it shows, with your `description` first. The summary is
read once, as the figure's description, and refreshes at most once a
second.

```ts
createChart(element, {
  title: "Request latency",
  description: "p99 latency per service over the last day.",
  marks: [line(latency, { x: "time", y: ["api", "web"] })],
});
```

```python
hg.line(latency, x="time", y=["api", "web"], title="Request latency",
        description="p99 latency per service over the last day.")
```

- **The summary** gives the series count and, per series, its point count,
  range, and last value. Heatmaps, histograms, layout marks, and others
  write their own; color scales and size and shape keys are described
  because their legends are drawn. Marks also say here what they leave out
  (links to missing nodes, spokes past a radar's limit), and Python's
  statistical charts what they computed.
- **Values** reached with the keyboard are announced whole through a polite
  live region, as the tooltip shows them. The tooltip and the drawing
  itself are hidden from assistive technology, so nothing is read twice.
- **Legend entries** are toggle buttons (`aria-pressed`) in a group named
  "Legend".
- **A toolbar** of named buttons (zoom, pan, turn, drill out) appears in
  maps, networks, 3D charts, and trees that drill, while the pointer or
  focus is in the chart.
- **A range navigator's** window and edges are sliders; the summary
  describes the overview and the range in view.
- **Trees** drilled into show their path as a navigation landmark of
  buttons.
- **Grids** are ARIA grids; see [Grids](grids.md#accessibility).

## Keyboard

| Keys | Do |
| --- | --- |
| Left, Right | Step through a series; through a layout mark's items (slices, nodes, stages) |
| Home, End, Page Up, Page Down | Jump within the series |
| Up, Down | Next or previous series; past the last, the next panel |
| Shift + arrows | Select a range along the axis the keys step along |
| Enter | Zoom to the selected range where zoom is on; drill into a tree node |
| Escape | Clear the selection; end a drag |
| Backspace | Drill out of a tree |
| `+`, `-`, `0` | Zoom in, out, and reset |
| Shift + arrows (3D, maps, networks) | Turn the chart, pan the plane, move the focused node |
| Space | Select the row at the cursor, with a bound [row selection](interaction.md#selected-rows) |

- Fields of one table drawn as lines, areas, or bars are one stop: each
  announcement names every series at the cursor's x. Series of points and
  series at other places are stops of their own.
- Heatmaps step cell by cell across rows and columns as drawn, skipping
  empty cells; points and cells outside a zoomed view are reached too.
- Arriving in a facet panel or subplot, the cursor names it and reads the
  annotations that panel alone draws.
- The chart's description names these keys, and each change is announced.
  [Bindings](interaction.md#bindings) can add keys of your own.

## Color and motion

- **Themes.** `"high-contrast"` and `"high-contrast-dark"` are built in, and
  `"auto"` follows the reader's color scheme ([Themes](styling.md#themes)).
- **Direction without color.** Candlesticks that rise are hollow and those
  that fall are filled; lines can take dashes and markers, and points
  shapes ([Marks](marks.md)).
- **Motion.** Animation is off unless asked for, and pages preferring
  reduced motion show changes at once
  ([Animation](interaction.md#animation)).

## Static output

- **SVG** (`toSVG`, `renderToSVG`, Python `to_svg`) has `role="img"`, a
  `<title>`, and a `<desc>` with the generated summary after your
  description.
- **PDF** (`renderToPDF`, Python `to_pdf`) is tagged with one Figure for the
  chart, facets and subplots included, whose alternative text is the title
  and summary. Backgrounds and grid lines are artifacts; labels stay in the
  Figure. The document language comes from `locale`.

## Testing and limits

Browser tests in Chrome, Firefox, and WebKit run axe-core audits (WCAG 2.1
A and AA, and best practices) over every chart family, both renderers,
facets, subplots, the four built-in themes, a shown tooltip with the
keyboard cursor on a point, static SVG, and grids. The same tests read the
accessibility tree each engine gives screen readers: the figure's name and
description, legend buttons and states, what the live region says as the
keyboard moves, and grids' headers, rows, levels, and selection.

- Charts have not been tried with screen readers themselves; the tests
  check what a screen reader receives, not how it speaks it.
- PDFs make no PDF/UA conformance claim.
- Firefox drops the levels of grouped grid rows: it ignores `aria-level` in
  grids that number their rows.
