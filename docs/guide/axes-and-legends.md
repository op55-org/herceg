# Axes, legends, and titles

Scales map data to pixels; guides explain them: axes, legends, and
colorbars. This guide covers scale options, ticks and formats, axes and
their labels, a second y axis, time axes with breaks, legends, colorbars,
titles, and padding.

- [Short forms and general forms](#short-forms-and-general-forms)
- [Scale options](#scale-options)
- [Ticks](#ticks)
- [Formats](#formats)
- [Axes](#axes)
- [Tick labels](#tick-labels)
- [A second y axis](#a-second-y-axis)
- [Time axis breaks](#time-axis-breaks)
- [Legends](#legends)
- [Colorbars](#colorbars)
- [Titles and padding](#titles-and-padding)

## Short forms and general forms

A chart's position scales and their guides have a general form, `scales`
and `guides`, of which `x`, `y`, `yRight`, and `legend` are short forms.
`x: { domain, title, ticks }` is a scale with its axis; `legend:
{ columns: 3 }` is the automatic legend laid out in three columns.

- `scales` sets a scale's settings over its short form's.
- An axis in `guides` replaces its scale's automatic axis on the same side,
  or adds one on another side.
- A legend or colorbar in `guides` shows the scales it names; the automatic
  legend shows the rest.

```ts
import { axis, createChart } from "herceg";

createChart(element, {
  timeZone: "UTC",
  x: { ticks: { every: "6 hours" }, format: { time: "%H:%M" } },
  guides: [
    axis({
      scale: "x",
      tick: { direction: "in" },
      layers: [{ id: "day", ticks: { every: "day" }, format: { time: "%a %b %-d" }, labels: { row: 1 } }],
    }),
    axis({ scale: "y", place: { side: "right" } }),
  ],
  marks: [line(metrics, { x: "time", y: "load" })],
});
```

```python
hg.Chart(df, time_zone="UTC",
    x=hg.AxisOptions(ticks=hg.Ticks(every="6 hours"), format=hg.Format(time="%H:%M")),
    guides=[
        hg.axis("x", tick=hg.Tick(direction="in"), layers=[hg.TickLayer(
            id="day", ticks=hg.Ticks(every="day"), format=hg.Format(time="%a %b %-d"),
            labels=hg.TickLabels(row=1))]),
        hg.axis("y", place=hg.Place(side="right")),
    ],
).line(x="time", y="load")
```

Charts asking for more than a tick count, Intl formats, and the automatic
axes and legend load a guide compiler, once per page, and draw their first
frame when it has loaded (`chart.loading` settles then). Static output
brings it along; other charts never load it.

## Scale options

`x`, `y`, and `yRight` (Python `hg.AxisOptions`, or a dict) take:

| Option | Means |
| --- | --- |
| `type` | `"linear"`, `"log"`, `"time"`. A continuous axis is a time axis when a mark places times on it. |
| `domain` | Fixed ends. |
| `nice`, `zero` | Round the ends to ticks; include zero (bars' value axes do by default). |
| `padding` | Room past the data: automatic for markers and bar labels, a share, or pixels (Python `hg.Pixels`). |
| `scope` | Which panels share the scale ([Layout](layout.md#sharing-scales)). |
| `repeat` | `"outer"` (default) or `"all"`: which panels sharing the scale label it. |
| `title`, `show`, `grid` | The axis title; hide the axis; grid lines (`{ zIndex }` to draw them over data). |
| `ticks`, `format` | [Ticks](#ticks) and [formats](#formats). |
| `tooltipFormat` | How tooltips, the keyboard, and crosshair labels write values, without changing tick labels. |
| `style` | The axis' roles: `tickLabel`, `axisTitle`, `axisLine`, `tick`, `grid` ([Styling](styling.md#role-styles)). |
| `breaks`, `seams` | Time x axes: [breaks](#time-axis-breaks). |

`scales` also holds scales of categories (`{ type: "ordinal", ... }`) that
channels read by name, and position scales of a mark's own (see
[Styling](styling.md#scales-of-categories) and
[Marks](marks.md#placing-rows-by-pixels-or-fractions)).

## Ticks

| `ticks` (Python `hg.Ticks`) | Ticks |
| --- | --- |
| `6`, `{ count: 6 }` | About six round values (default: a count from the axis' length). |
| `{ every: 10, anchor?: 5 }` | One every 10 on a number axis, from `anchor` (0). |
| `{ every: "6 hours" }`, `{ every: { unit, step? } }` | Calendar steps in the chart's `timeZone` (`"day"`, `"2 weeks"`, `"month"`; millisecond to year), at the same places whatever the view: weeks from a Monday, months within the year. |
| `{ every: { milliseconds: 21600000 }, anchor? }` | Elapsed time, the same length across daylight saving changes (Python: a `timedelta`). |
| `{ every: "3 months", fiscal: { start: 7 } }` | Steps of months and years counted from a fiscal year's first month (Python `hg.Fiscal(start=7)`), at local midnight on the first. |
| `{ values: [15, 95] }` | Exactly these, those inside the domain. |
| `(context) => values` | JavaScript only: from `{ scale, type, domain, pixels, count, timeZone, locale }`. |

- Log axes take a count or values; category axes label the categories that
  fit and take neither.
- Zoomed far out, steps closer than two pixels give way to coarser ones on
  the same boundaries.
- Ticks inside time-axis breaks are left out.

## Formats

| `format` (Python `hg.Format`) | Writes |
| --- | --- |
| Intl options | `Intl.NumberFormat` options on number axes, `Intl.DateTimeFormat` on time axes (Python: a dict of the camelCase names). |
| `{ number: ",.2f" }` | A d3-format pattern `[sign][,][.precision][~][type]`: sign `-`, `+`, `(`, or space; `,` groups thousands; `~` trims zeros; type `d`, `f`, `e`, `g`, `s` (SI, `"1.5k"`), `%`, or none. Digits and separators are the locale's. |
| `{ time: "%b %d %H:%M" }` | A strftime pattern in the chart's time zone: `%Y %y %q %m %d %e %H %I %M %S %L %p %a %A %b %B %z %%`, `%q` the quarter (1 to 4); `%-d` drops padding. |
| `{ time: "FY%y Q%q", fiscal: { start: 7, name? } }` | Years and quarters of a fiscal year starting on the first of month `start`, named by the year it ends in (`name: "end"`, the default) or starts in (`"start"`). Months and days stay the calendar's. |
| `(value, context) => string` | JavaScript only. `""` leaves a tick unlabeled. |

- A tick is its value, never its text: "Apr" of 2024 and "Apr" of 2025 are
  two ticks with their own grid lines. Where `format` writes neighboring
  automatic ticks alike, the axis takes a coarser interval that tells them
  apart, so a date-only format uses day ticks. A label still repeating the
  one before is left blank and its tick kept, on automatic and chosen ticks
  alike (`labels: { duplicates: "show" }` writes it).
- Specs and Python carry Intl options and patterns; functions stay in
  JavaScript, and `validateSpec` refuses them with their path.
- Only steps of months or years and `{ time }` patterns take `fiscal`; counts,
  values, number patterns, and Intl options are refused with it.
- A fiscal row under monthly ticks gives one object to both, so ticks and
  labels agree:

  ```ts
  const fiscal = { start: 7 };
  axis({
    scale: "x",
    layers: [{ id: "quarter", ticks: { every: "3 months", fiscal }, format: { time: "FY%y Q%q", fiscal }, labels: { row: 1 } }],
  });
  ```

  ```python
  fiscal = hg.Fiscal(start=7)
  hg.axis("x", layers=[hg.TickLayer(id="quarter", ticks=hg.Ticks(every="3 months", fiscal=fiscal),
                                    format=hg.Format(time="FY%y Q%q", fiscal=fiscal), labels=hg.TickLabels(row=1))])
  ```

## Axes

`axis({ scale, ...options })` (Python `hg.axis(scale, ...)`; in specs
`{ type: "axis", scale }`):

| Option | Means |
| --- | --- |
| `scale` | `"x"`, `"y"`, `"yRight"` (Python `"y_right"`). |
| `place` | `{ side }`: x `"bottom"` (default) or `"top"`; y `"left"` or `"right"`; yRight `"right"`. One axis per side. |
| `id` | A name of its own. |
| `title`, `ticks`, `format`, `grid`, `show`, `style` | As the short form's. Grid lines follow the axis on the default side. |
| `tick` | `{ direction: "out" \| "in" \| "cross", length }` or `false`. x axes draw 5 px ticks out by default, y axes none. |
| `labels` | [Tick labels](#tick-labels), or `false`. |
| `line` | Draw the axis line (x axes do, y axes do not, by default). |
| `layers` | More tick layers `[{ id, ticks, format, tick, labels, style }]`: minor ticks (`labels: false`), day boundaries in a second row. |
| `repeat` | `"all"` draws the axis by every panel sharing the scale. |
| `room` | y axes: the pixels their ticks and labels take beside the plot, so plots of charts and panels line up (`room: 28`), or bounds on what the labels need (`{ min, max }`, Python `(min, max)`). Labels wider than the room are shortened with an ellipsis; tick marks are not, so a room shorter than the outward ticks is refused. Refused on x axes and colorbars. |

An x axis on top needs panels without headers; a y axis on the right
beside each row's last panel needs rows that share y.

## Tick labels

| `labels` (Python `hg.TickLabels`) | Means |
| --- | --- |
| `rotation` | Degrees clockwise from -90 to 90 (`-45` reads upward to its tick), or `{ candidates: [0, -45, -90] }`: the first at which neighbors do not overlap. x axes. |
| `overlap` | `"show"` (default), `"hide"` (every n-th kept), and on x axes `"stagger"` (alternate rows) and `"wrap"` (at spaces, three lines at most). Category axes keep every n-th by default. |
| `row` | 0 by the axis line, 1 beyond it: rows for layers. x axes. |
| `priority` | Which labels of a row stay where they collide: the higher. |
| `duplicates` | `"hide"` (default) or `"show"` a label repeating the one before. |
| `inside` | Labels inside the plot beside their ticks, taking no room outside. Not on colorbars. |
| `gap` | Pixels from the labels to their tick's end. |

Flat labels stand at their ticks as `style.tickLabel` aligns them (`align`
on x, `verticalAlign` on y). Category labels longer than 30% of the
chart's width are shortened with an ellipsis.

## A second y axis

Marks with `axis: "right"` use a second y scale, drawn on the right and set
by `yRight` (the same options as `y`).

```ts
createChart(element, {
  marks: [
    line(traffic, { x: "time", y: "latency" }),
    line(traffic, { x: "time", y: "requests", axis: "right" }),
    rule({ y: 5000, label: "capacity", axis: "right" }),
  ],
  y: { title: "ms" },
  yRight: { title: "requests/s" },
});
```

```python
hg.Chart(traffic, y=hg.AxisOptions(title="ms"), y_right=hg.AxisOptions(title="requests/s")).line(
    x="time", y="latency").line(x="time", y="requests", axis="right")
```

- Each axis fits its own marks; tooltips format values by their axis. Grid
  lines follow the left axis (the right where every mark is on the right).
- Marks placed along y (horizontal bars, error bars and box plots along y,
  points on a category y, lines and areas along y, y rugs) stay on the left
  and refuse `axis: "right"`.
- In facets and subplots, every panel drawing marks on the right has a
  right axis, shared as y is unless `yRight.scope` says otherwise. A subplot
  whose marks are all on the right has no left axis.
- Zooming along y moves both axes over the same pixels;
  `setViewport({ yRight }, { panel })` names the panel. Brushes report y in
  the left axis' values.
- Two scales in one plot invite comparing heights that mean different
  things; for unrelated measures, two charts sharing x through
  [sync](interaction.md#sync) are often easier to read.

## Time axis breaks

A time x axis can leave out time, so trading sessions sit side by side.

```ts
import { candlestick, createChart, timeBreaks } from "herceg";

createChart(element, {
  marks: [candlestick(prices, { x: "time", open: "o", high: "h", low: "l", close: "c" })],
  timeZone: "America/New_York",
  x: {
    seams: true,
    breaks: timeBreaks([
      { weekdays: ["sat", "sun"] }, // whole days
      { hours: ["16:00", "09:30"] }, // every day, wrapping past midnight
      { dates: ["2025-12-25", "2026-01-01"] }, // holidays
      { from: Date.UTC(2025, 10, 28, 18), to: Date.UTC(2025, 11, 1, 14, 30) }, // instants
    ]),
  },
});
```

```python
sessions = hg.AxisOptions(seams=True, breaks=[
    hg.Break(weekdays=("sat", "sun")),
    hg.Break(hours=("16:00", "09:30")),
    hg.Break(dates=[datetime.date(2025, 12, 25)]),
])
hg.Chart(prices, x=sessions, time_zone="America/New_York").candlestick("time", "open", "high", "low", "close")
```

- **Wall-clock time.** Breaks follow the chart's `timeZone`: on the day
  clocks change, a night lasts an hour more or less. Starts are included,
  ends are not (a candle at 16:00 is inside a break from 16:00).
- **Drawing.** The axis measures the time it shows. Lines and areas join the
  points either side; points, bars, candles, and error bars inside a break
  are not drawn, counted, or shown in tooltips. Bars and candles are as wide
  as the gap between neighbors in time shown. Rules, regions, and text
  inside a break are drawn at its seam.
- **Ticks** fall on the calendar of the time shown: a tick in a break moves
  to the session that opens after it and reads as the day or month that
  begins there.
- **Interaction.** Zoom, pan, brushes, synced cursors, and transitions work
  in time shown. A view entirely inside a break widens to the hour shown on
  either side; a fixed `domain` like that is refused.
- **Seams.** `seams: true` marks boundaries with dashed lines (the theme's
  grid color, `[3, 3]`) behind the data, at least `minSpacing` CSS pixels
  apart (`{ minSpacing: 40 }`, the default). Seams need breaks.
- **Bundling.** `timeBreaks` brings the code that resolves breaks; in a
  spec, `breaks` is the same list of rules.
- **Limits.** Breaks need a time x axis. Heatmap calendars and edge cells,
  2D histograms, and contours refuse breaks.

## Legends

A legend is shown by default for two or more series; `true` or an object
shows it for one, `false` hides it. Entries toggle what they stand for.

```ts
createChart(element, {
  legend: { place: { side: "bottom", align: "center" }, columns: 3, swatches: "mark" },
  marks: [/* ... */],
});
```

```python
hg.Chart(df, legend=hg.LegendOptions(place=hg.Place(side="bottom", align="center"), columns=3))
```

| `legend` (Python `hg.LegendOptions`; `hg.legend` in `guides`) | Means |
| --- | --- |
| `place` | A side `{ side, align?, offset?, scope?, panel? }`, or inside a plot `{ inside, inset?, scope?, panel? }`: a corner or edge middle (`"top-left"`, `"top"`, ...), `inset` px in (8). Inside takes no room from the plots. |
| `columns`, `rows` | Entries in a grid of that many columns or rows. |
| `order` | `"row"` (default with `columns`) or `"column"` (default with `rows`). |
| `title` | Text, or `{ text, style }`. |
| `include` | What it lists: `{ mark, channel }` (`"series"`, `"color"`, `"size"`, `"symbol"`), `{ scale }` (a scale of categories), `{ mark }` (a mark whole); `[]` for `entries` alone. Every scale by default. |
| `entries` | Entries of your own: `{ key, label, swatch? \| sample?: { mark }, targets? }`. A `swatch` is a `line`, `rect`, `symbol`, or `composite`; `targets` (`{ mark }`, `{ mark, field, values }`, `{ scale, values }`) are what it hides; entries without targets explain. |
| `swatches` | `"mark"`: swatches that look like the marks (dash, width, markers, fill, symbol). |
| `style` | `legendLabel`, `legendTitle`, `tickLabel`. |
| `panel` | A [panel's own legend](layout.md#panels-legends). |
| `id`, `show` | (`legend()` only) A name; `false` draws none. |

- An entry stands for a value, across every mark and panel
  ([Styling](styling.md#colors-follow-what-series-stand-for)); entries never
  merge by label alone.
- A scale of categories lists its domain, in the automatic legend and in
  one naming it with `{ scale }`: a declared `domain` whole and in its
  order, whatever the marks draw now, so filtering rows never changes the
  key (values drawn outside it, in its `unknown` color, follow); without
  one, the values the marks draw. An entry of a value nothing draws yet
  hides that value's rows once they come. Marks left out of legends
  (`legend: false`) list it only in a legend naming them; a panel's own
  legend lists the domains of the scales its marks draw with, and a scale
  of each subplot (`scope: "panel"`) its own. Keys of the colors or shapes
  rows take list a declared domain the same way.
- A mark's `legend: false` leaves it out of legends and colorbars that name
  no mark; those naming it show it.
- Rules, regions, and text with `legend: true` are listed by their labels
  and hidden by their entries.
- Color scales show a ramp, sizes a key of round values, and category
  colors or symbols a key, below the series entries.
- Legends on one side stack in `guides` order, the first nearest the plots.

## Colorbars

`colorbar()` draws a color scale's colors along its values, with ticks as
an axis plans them, in place of its ramp in the legend.

```ts
createChart(element, {
  marks: [heatmap(cells, { x: "hour", y: "zone", color: "gain", colorMidpoint: 0 })],
  guides: [colorbar({ title: "Gain (%)", ticks: 6, format: { number: "+.0f" } })],
});
```

```python
hg.Chart(cells, guides=[hg.colorbar(title="Gain (%)", ticks=6, format=hg.Format(number="+.0f"))]
).heatmap(x="hour", y="zone", color="gain", color_midpoint=0)
```

| Option | Means |
| --- | --- |
| `scale` | `{ mark, channel: "color" }`; the chart's only color scale by default. |
| `place` | A side (`right` by default). Beside the plots it stands, low at the bottom; above or below it lies, low at the left. Panel scope as for legends. |
| `title`, `ticks`, `format`, `tick`, `labels`, `layers` | As an axis' along the bar. Ticks are rounded inside the domain, never the raw ends unless given as `values`. |
| `length`, `thickness` | Pixels along (most of the height, up to 240) and across (12). |
| `style`, `id`, `show` | As for legends. |

A diverging scale's middle color sits at its midpoint; a contour's bands
are boxes between their levels, ticked at them.

## Titles and padding

- **Title.** `title` is a string or `{ text, place: { side: "bottom" }, style
  }` (Python `hg.Title`): at the top by default, aligned by its style's
  `align`. `description` is read by assistive technology, not drawn.
- **Lines.** `"\n"` breaks any label into lines, laid out as a block, in
  every output. Names that layout marks fit to one line (pie slices,
  nodes, funnel stages, radar spokes) are shortened rather than broken.
- **Padding.** Without `padding`, spacing is automatic. With it (pixels, or
  `{ top, right, bottom, left }`; `0` included), it is the whitespace around
  everything the chart draws on its sides; sides `{ ... }` leaves out keep
  the automatic spacing (`{ right: 120 }` keeps room for labels on the
  right alone).
- **Sparklines** set `padding: 0`, hide their axes (`show: false`), and give
  exact domains (`nice: false`).

```ts
createChart(element, {
  title: { text: "Latency\nby service", style: { align: "center" } },
  legend: { place: { inside: "top-right" } },
  padding: { top: 4, right: 12 },
  marks: [/* ... */],
});
```

```python
hg.Chart(df, title=hg.Title("Latency\nby service", style=hg.TextStyle(align="center")),
         legend=hg.LegendOptions(place=hg.Place(inside="top-right")),
         padding={"top": 4, "right": 12}).line(x="time", y="latency", series="service")
```
