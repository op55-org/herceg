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
second. Focus reached with the keyboard draws the browser's focus ring;
focus a click or drag gives the chart draws none until a key other than
a modifier is pressed there. The chart marks that focus with
`data-herceg-focus="pointer"` (`"keyboard"` once a key is pressed), which
a page's own focus styles can test. Herceg's rules for it weigh as an
attribute and `:focus` do, (0,2,0): they win over resets such as
`:focus { outline: none }`, and a more specific selector of the page's,
or `!important`, wins over them:

```css
/* The chart in #latency draws this outline whenever it has the focus, presses too. */
#latency > [role="figure"]:focus { outline: 2px solid royalblue; }
```

Controls of the page's inside a chart keep their own rings. A chart
loads its interaction code after it first draws; in Chrome and Firefox, a
key pressed after a press that came before that code loaded draws no
ring, and the next key does.

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
- **Values** reached with the keyboard are announced through a polite live
  region: the cursor's series and its value, and on request every series
  the tooltip lists. The tooltip and the drawing itself are hidden from
  assistive technology, so nothing is read twice.
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
| Up, Down | The series drawn next above or below at the cursor's place (left or right for series along y); past the last, the next panel |
| `i` | Read every series at the cursor's place, as the tooltip lists them |
| Shift + arrows | Select a range along the axis the keys step along |
| Enter | Zoom to the selected range where zoom is on; drill into a tree node; otherwise a `click` on the cursor's point (cause `"keyboard"`), which selects it where [`select`](interaction.md#selections) is on |
| Escape | Clear the selection; end a drag |
| Backspace | Drill out of a tree |
| `+`, `-`, `0` | Zoom in, out, and reset |
| Shift + arrows (3D, maps, networks) | Turn the chart, pan the plane, move the focused node |
| Space | Select the row at the cursor, with a bound [row selection](interaction.md#selected-rows) |

- **Every series shown is a stop**, whatever the inspection reads; series
  of marks with `inspect: false` are not.
- **Up and Down go in screen order** at the cursor's place along x: from
  the top series down, each where its drawn line or area crosses that
  place (nearest the cursor where it crosses more than once, as a folded
  path does), at its point nearest there. Series along y (profiles,
  horizontal bars) go left to right, Up to the left, and series along the
  other axis follow those along the cursor's. The order is taken at the
  first press and kept while Up and Down follow, so each series is reached
  once however the lines cross; any other key starts afresh.
- **Announcements** name the cursor's series where it changes, with its
  place in the order ("api, 2 of 12: 304 ms at 10:00"), then its value and
  where. Where Up or Down can go no further, the cursor names its series
  and place again ("auth, 1 of 12"), so the key is heard. `i` reads every
  series the tooltip lists ("12 series at 10:00: ..."), again when pressed
  again. What Enter selects is announced ("api selected", "Selection
  cleared").
- **The tooltip** stands at the cursor's point, which a ring marks, and
  shows the cursor's series in bold among those it lists. Where that point
  is out of view, it stands at the plot's middle, as in charts that follow
  the cursor through [sync](interaction.md#sync); where the pointer would
  read nothing there (beyond `within`), it shows none.
- **Data changes.** As each frame is drawn, the cursor, its ring, and
  its tooltip follow what the cursor is on where it can be found at once:
  a row that stays in its series (as a stream drops rows before it or
  appends after it, or its view is sorted again), a heatmap's cell at the
  same place, a bin or box at the same place, a layout mark's item (a
  pie's slice) of the same name. The cursor goes, rather than moves, when
  its row is dropped, filtered out of a view, or moved to another series,
  or a mark that orders rows its own way (a rug, oriented bands, a union
  stack) moves it; when its cell, bin, box, or item is no longer there;
  and when the legend hides its series or item. Then there is no
  cursor (`hover` listeners hear that nothing is hovered, and Space
  selects nothing) until the next key hands it to the series next to
  where it last stood: Down, Enter, and `i` to the one below, Up to the
  one above, and Left and Right step on from the one below. A series
  alone in its panel keeps it, at its point nearest there; a panel now
  holding a layout mark (a pie), or a layout mark's item gone, hands it
  to that mark's items, naming the panel (Up, Down, Enter, and `i` at the
  first, the other keys stepping in from the ends); a hidden series alone
  hands it on to the next panel. The key hands it on even where its
  series, row, cell, or item came back before it. Enter there announces
  where it went and clicks nothing. With nothing to hand it to, there is still none: Enter
  and `i` do nothing, and an arrow key starts afresh, as on first focus.
- With `inspection: false`, the keyboard still reads and announces points.
- Heatmaps step cell by cell across rows and columns as drawn, skipping
  empty cells; points and cells outside a zoomed view are reached too.
- Arriving in a facet panel or subplot, the cursor names it and reads the
  annotations that panel alone draws.
- The chart's description says to use the arrow keys, and `i` where it
  has series; this table is where Up and Down are explained.
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
