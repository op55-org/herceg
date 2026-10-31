# Styling

How charts choose colors, and how to change their look: themes, role
styles, text halos, and paint order.

- [Colors](#colors)
- [Colors follow what series stand for](#colors-follow-what-series-stand-for)
- [Scales of categories](#scales-of-categories)
- [Continuous color](#continuous-color)
- [Themes](#themes)
- [Role styles](#role-styles)
- [CSS variables](#css-variables)
- [Text halos](#text-halos)
- [Paint order](#paint-order)

## Colors

`color` is a mark's primary paint: a line's stroke, a bar's, area's, or
point's fill. It names a category field, whose values color the marks
through the chart's `"color"` scale, or gives a CSS color. `stroke` and
`fill` set those paints themselves and win over `color`.

On every mark that draws series, a category `color` field names the series
too: `color: "service"` draws a line per service, as `series: "service"`
does, unless the mark gives `series` (another field, or `false`) or its own
`stroke` or `fill`. This holds for lines, areas, bars, points (on axes, maps,
and in 3D), histograms, box plots, boxen, violins, error bars, and rugs.

- A line or area has one color per series: a color field that changes
  within a series is refused with a `ChartError` naming the series.
- Bars and points with `series: false` take each row's color (bars keep
  their whole band). Map and 3D points color by series alone.
- Marks without `color` choose their colors themselves (radars by series,
  pies by category, networks by their nodes' `color` field, candlesticks by
  rise and fall) and refuse it, naming what to give instead.

## Colors follow what series stand for

A series stands for a value, and a value has **one color and one legend
entry** in every mark and panel of the chart, keeping it while data
streams and while series are hidden.

- **Order.** Colors follow the field's dictionary order (a `category()`
  column's, a pandas Categorical's, an Arrow dictionary's; first appearance
  for strings), used values or not: a Categorical of `["A", "B", "C"]`
  holding only `"C"` gives it the palette's third color.
- **Shared across marks.** Lines, areas, bars, and points colored by the
  same table's `"site"` agree, and so do layout marks' items: pie slices,
  top-level treemap and sunburst branches, radar series, map regions and
  points, network node groups, and 3D points and lines.
- **Shared across derived data.** Derived tables, row views, and spec tables
  naming the table as their `origin` count as the same table. An unrelated
  table's `"site"` has colors of its own, unless both marks read colors
  through one named scale.
- **Value fields** (`y: ["p50", "p99"]`) stand for their labels, so a line
  of p50 and a band labelled `"p50"` share an entry.
- **Shared visibility.** A bar and its error bars, a line and its band, or
  points and their fit hide and show together, and the legend swatch shows
  every mark the entry stands for.

## Scales of categories

Fix colors (or shapes, dashes, numbers) by value with a scale of
categories. Two charts given the same scale color each value alike.

```ts
const scales = {
  color: { type: "ordinal", map: { "Site A": "#00ab41", Average: "#222222" } },
} as const;
createChart(element, {
  scales,
  facet: facet("region", { columns: 3 }),
  marks: [line(gains, { x: "time", y: "gain", series: "site", color: "site" })],
});
createChart(other, { scales, marks: [bar(totals, { x: "site", y: "gain", color: "site" })] });
```

```python
sites = hg.OrdinalScale(map={"Site A": "#00ab41", "Average": "#222222"})
hg.Chart(df, scales={"color": sites}, facet="region", facet_columns=3).line(
    x="time", y="gain", series="site", color="site")
hg.Chart(totals, scales={"color": sites}).bar(x="site", y="gain", color="site")
```

| `{ type: "ordinal", ... }` (Python `hg.OrdinalScale`) | Means |
| --- | --- |
| `map` | Outputs by value: colors, shapes, dashes, or numbers. Values left out take the theme's palette by their place in the domain. |
| `domain` | The values in order, and only those; others take `unknown`. Legends list it whole, drawn or not. Default: the fields' values, dictionary order first, then first seen. |
| `unknown` | Output for values outside `domain`; the theme's muted color by default. |

A value keeps its place once it has one, so streaming never recolors.
Under `scales.color`, every mark's colors go through the scale. A named
scale (`"sites"`) is read by channels (`encode.color: { field, scale:
"sites" }`, see [Encodings](marks.md#encodings)): every mark reading it gives
a value one color and one legend entry, whatever table it reads.

## Continuous color

Heatmaps, 2D histograms, contours, and points with a number or time
`color` map values through a continuous scale.

```ts
import { rdbu, viridis } from "herceg";

heatmap(load, { x: "hour", y: "host", color: "cpu", colors: viridis });
point(stations, { x: "lon", y: "lat", color: "anomaly", colors: rdbu, colorMidpoint: 0 });
```

```python
hg.scatter(stations, x="lon", y="lat", color="anomaly", colors="rdbu", color_midpoint=0)
```

| Option | Means |
| --- | --- |
| `colors` | A ramp of `#rgb` or `#rrggbb` colors, low to high, or a named scheme. Default: the theme's `sequential` (or `diverging` with a midpoint). |
| `colorDomain` | The values at the ramp's ends; others are clamped. |
| `colorMidpoint` | The value at the ramp's middle color, each side on its own half. A midpoint outside the data widens the scale; with `colorDomain`, it must lie inside. |

| Schemes | |
| --- | --- |
| Sequential | `viridis`, `magma`, `inferno`, `plasma`, `cividis`, `turbo`, `blues`, `greens`, `greys`, `oranges`, `purples`, `reds`, `ylgnbu`, `ylorrd` |
| Diverging | `rdbu`, `rdylbu`, `brbg`, `piyg`, `prgn`, `puor`, `spectral` |
| Categorical (for a theme's `palette`) | `tableau10`, `category10`, `set2`, `dark2` |

TypeScript imports schemes one by one, so a bundle carries only those it
uses; specs and Python name them as strings (`"viridis"`). A color scale is
explained by a color legend or a [colorbar](axes-and-legends.md#colorbars).

## Themes

| Theme | Surface |
| --- | --- |
| `"light"` (default) | white |
| `"dark"` | `#12151c` |
| `"high-contrast"` | white |
| `"high-contrast-dark"` | black |
| `"auto"` | Transparent; light or dark to match the surface the chart sits on |

- Each built-in theme paints its own surface, so a chart reads the same on
  any page and in every export.
- `"auto"` reads the background around the chart (through translucent
  layers and shadow roots) or, without one, the user's
  `prefers-color-scheme` where the page's `color-scheme` allows dark. It
  switches when that changes. A chart in a frame judges the frame's page.
  Static output treats `"auto"` as light.
- `tokens: { background: "transparent" }` shows the page under any theme.
- The categorical palettes keep adjacent series apart for the common forms
  of color blindness, and every color reaches 3:1 against its theme's
  surface (4.5:1 for the high-contrast palettes).

A theme object starts from `extends` (light by default) and changes tokens
and role styles:

```ts
createChart(element, {
  theme: {
    extends: "auto",
    tokens: { background: "transparent", text: "var(--ink, #1c2333)", palette: ["var(--brand)", "#ec6a2c"] },
    style: { text: { font: "Inter, sans-serif" }, title: { align: "center" }, grid: { dash: [2, 3] }, bar: { radius: 0 } },
  },
  marks: [bar(sales, { x: "region", y: "total" })],
});
```

```python
hg.Chart(data, theme=hg.Theme(
    extends="dark",
    tokens=hg.Tokens(palette=["#5b8def", "#dc6f3a"]),
    style=hg.Style(title=hg.TextStyle(align="center"), bar=hg.BarStyle(radius=0)),
))
```

| Token | Colors |
| --- | --- |
| `background`, `text`, `muted`, `grid`, `axis` | Chart surface; titles and legend text; tick labels; grid lines; axis lines and ticks. Roles without a color of their own take these. |
| `palette` | Series colors, in order. |
| `sequential`, `diverging` | Hex ramps for color scales. |
| `rise`, `fall` | Candlestick colors. |

## Role styles

Each kind of text and line is a **role** with a style. The theme gives every
role's style; an axis' `style`, the legend's, the title's, and a subplot's
change their own, property by property, so the most specific wins: theme,
then the chart's axis, title, or legend, then the subplot, then the
subplot's axis.

| Role (Python) | Kind | Styles |
| --- | --- | --- |
| `text` | text | The base of every text role. |
| `title`, `panelTitle` (`panel_title`) | text | The chart's title; subplot titles and facet headers. |
| `axisTitle`, `tickLabel` (`axis_title`, `tick_label`) | text | Axis titles; tick labels and color legends' values. |
| `legendLabel`, `legendTitle` | text | Legend entries; titles of color and size legends. |
| `grid`, `axisLine`, `tick` | line | Grid lines, axis lines, tick marks. |
| `crosshair` | line | The line the pointer's, the keyboard's, and other charts' cursors draw across a plot. |
| `plot` | plot | `fill` behind the plot, `stroke` and `strokeWidth` around it. |
| `line`, `bar`, `tooltip` | marks | Lines' default `strokeWidth`, bars' corner `radius`, the tooltip's `fill` and `stroke`. |

| Style | Properties |
| --- | --- |
| Text (`hg.TextStyle`) | `font`, `fontSize`, `fontWeight` (100–900), `fontStyle`, `color`, `opacity`, `lineHeight` (a multiple of the size), `align` (`"start"`, `"center"`, `"end"`), `halo`, `background` (`{ fill, stroke?, strokeWidth?, radius? }`) with `padding` |
| Line (`hg.StrokeStyle`) | `stroke`, `strokeWidth`, `dash`, `opacity` |

Text is colored by `color`, never `fill`. Marks keep their own `stroke`,
`fill`, and `strokeWidth`, which win over the theme's `line` and `bar`
defaults.

```ts
createChart(element, {
  title: { text: "Latency by service", style: { align: "center", fontWeight: 600 } },
  y: { title: "ms", style: { tickLabel: { color: "#3266d6" } } }, // match the series it measures
  theme: { style: { plot: { fill: "#f6f8fb" }, grid: { stroke: "#ffffff", strokeWidth: 2 } } },
  marks: [/* ... */],
});
```

How labels break into lines is in
[Axes and legends](axes-and-legends.md#titles-and-padding).

## CSS variables

Colors and fonts may be CSS variables, such as
`"var(--brand, #3266d6)"`, in themes, styles, and every color option of
marks, scales, channels, looks by value, markers, legends, and custom
marks.

- Charts in a page read them, and colors in any CSS syntax, from the page,
  so canvas, GPU, tooltips, and hover dots match SVG. They read again when
  the class, style, or data attributes of the root or body element change;
  call `update({})` after other theme changes.
- Static output (SVG, PNG, PDF) has no page: each variable takes its
  fallback, and one without a fallback is refused, naming the option.
  Exported SVG holds no `var()`.
- Python notebook outputs are isolated frames that do not see the
  notebook's variables, so they use the fallback too.
- PDF reads hex, `rgb()`, `hsl()`, and named colors. PDF pages are white: a
  transparent theme with light text gets the dark surface it was meant for.

## Text halos

Text drawn over data has a halo, an outline in the color of what it is
drawn on, so it stays readable over lines.

| `halo` | Draws |
| --- | --- |
| `"auto"` (default) | The surface's color (the plot's `fill` or the chart's background), whatever the text's color. Under a transparent background: black behind light text, white behind dark. |
| `false` | None. |
| `{ color, width?, opacity? }` (Python `hg.Halo`) | One of your own, 3 pixels wide by default. |

`text`, `region`, `bar`, `funnel`, `radar`, `sankey`, `graph` (node and link
labels), and the range navigator take `halo`. Guide text (tick labels,
titles, legends) takes a style's `halo`, off by default. Halos are the same
in static SVG and PDF.

## Paint order

A panel paints its grid lines and marks in one order in every renderer
(SVG, Canvas, PDF, PNG): each at its `zIndex` (marks 0, grid lines -1),
lower first, ties in the order listed, grid lines before marks.

```ts
createChart(element, {
  marks: [region({ y1: 200, y2: 300 }), line(metrics, { x: "time", y: "p99" }), rule({ y: 250, zIndex: 1 })],
  y: { grid: { zIndex: 1 } }, // grid lines over the data
});
```

- `zIndex: 1` lifts a mark over those declared after it.
- The order is the panel's own (insets paint over their parents), and
  separate from the order the keyboard, descriptions, and tooltips read.
- Hovering and clicking find what is on top: the mark painted last.
- 3D marks refuse `zIndex`; a 3D box draws by depth.
