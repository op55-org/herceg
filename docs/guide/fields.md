# Field displays

A field display says how a field is named, how its values are written, and
how they are colored: its label, description, format, bounds, missing
text, value mappings, and thresholds. It is given once, for every surface
that writes or colors the field, by field name or as rules matching fields
by name, regular expression, kind, and table.

- [What works today](#what-works-today)
- [Displays](#displays)
- [Rules](#rules)
- [How a value is written](#how-a-value-is-written)
- [Mappings](#mappings)
- [Colors](#colors)
- [Charts](#charts)
- [Axes](#axes)
- [Names](#names)
- [Tooltips, labels, and gauges](#tooltips-labels-and-gauges)
- [Layout marks](#layout-marks)
- [Grids](#grids)
- [Reading displays in TypeScript](#reading-displays-in-typescript)
- [Specs](#specs)
- [Python](#python)
- [Errors](#errors)

## What works today

- `herceg/fields` resolves displays for application code: `displayOf`
  gives a field's label, description, bounds, and each value's text;
  `compileFields` checks rules once for many fields; `fieldsOf` writes rules
  for a table's fields, typed by its schema.
- Charts take `fields`: `createChart`, the React, Vue, and Svelte
  `<Chart>`, specs, and Python's `hg.Chart(fields=...)`. Axes, legends,
  series names, tooltips, labels, gauges, color ramps, and the text
  alternative write fields through their displays ([Charts](#charts)), and
  so do pies, funnels, treemaps, sunbursts, Sankey diagrams, networks,
  maps, and radars ([Layout marks](#layout-marks)).
- Grids take `fields: compileFields(rules)`: headers, descriptions, cells,
  group keys, and aggregates ([Grids](#grids)).
- Specs carry `fields`, and `validateSpec` checks it, with paths.
- Displays color values ([Colors](#colors)): thresholds and mapping colors
  color bars, lines, areas, and regions colored by a number field without a
  scale, points and heatmaps without a ramp of their own, series and bars
  of a category field, gauges' bands and dials, and tooltip fields'
  swatches; legends show a key of the colors; rules and regions stand at a
  field's thresholds.
- Python builds and checks `hg.FieldDisplay`, `hg.Match`, `hg.Mapping`,
  `hg.Thresholds`, and `hg.AtThresholds`.
- Links from displays are planned ([roadmap](../roadmap.md)).
- Every format form a display takes (durations, SI and binary prefixes,
  text around number patterns) works today wherever charts take a format:
  see [Formats](axes-and-legends.md#formats).

## Displays

| Setting | What it says |
| --- | --- |
| `label` | The field's name where surfaces name it: "Latency" for `latency`. |
| `description` | A sentence about the field, for surfaces that describe fields. |
| `format` | How values are written, in any [format](axes-and-legends.md#formats) form: number forms for number fields, time forms for times. Categories take none. |
| `min`, `max` | A number field's bounds, for surfaces that show a value against them. Never an axis' domain. |
| `missing` | The text of missing values (null, NaN, and missing times): "–" by default; or `{ text, color }`, either or both. |
| `mappings` | Values written as given text, colored in a given color, or both (see [Mappings](#mappings)). |
| `thresholds` | A number field's colors by step (see [Colors](#colors)). |
| `link` | A link built from the row's values. Typed and checked; no surface draws links yet. |

Every setting also takes `false`, which resets it to its default, as if no
earlier rule had given it.

```ts
const fields = {
  latency: { label: "Latency", description: "Time to the last byte.", format: { duration: "millisecond" }, min: 0, max: 120_000 },
  bytes: { label: "Response size", format: { binary: "B" }, missing: "not sent" },
  status: { mappings: [{ value: "200", text: "OK" }, { regex: "^5(\\d\\d)$", text: "Server error $1", color: "#c62828" }] },
  p99: { format: { duration: "millisecond" }, thresholds: { base: "#2e7d32", steps: [{ value: 200, color: "#f9a825" }, { value: 500, color: "#c62828" }] } },
};
```

## Rules

Displays by field name are a rule per field. A list of rules applies in
order, a later rule's settings over an earlier one's, setting by setting.
`match` says which fields a rule applies to; a rule without it applies to
every field.

| `match` | Matches |
| --- | --- |
| `"bytes_out"` | The field of that name. |
| `{ field: ["bytes_in", "bytes_out"] }` | Fields of those names. |
| `{ regex: "^bytes_" }` | Fields whose names match a JavaScript regular expression, unanchored. |
| `{ kind: "number" }` | Fields of a kind, or of several: `"number"`, `"time"`, `"category"`. |
| `{ table: hosts }` | Fields of a table, of its row views, and of tables derived from it that pass them through unchanged (filters, sorts, and an aggregate's `by` fields), not the fields those tables calculate. Specs name tables by their name. |

A rule matches a field when every key it gives does: `{ table: quotas,
field: "bytes_in" }` is `bytes_in` of `quotas` alone.

```ts
const rules = [
  { match: { kind: "number" }, format: { number: ",.1f" }, missing: "–" },
  { match: { regex: "^bytes_" }, format: { binary: "B" } },
  { match: "bytes_out", label: "Sent" },
  { match: { table: quotas, field: "bytes_in" }, label: "Quota" },
  { match: "bytes_quota", format: false },
];
```

`bytes_out` takes the binary format and the label "Sent"; `bytes_quota`
takes no format, and is written as numbers are by default.

- A rule naming fields refuses what their kinds cannot take: a format for
  a category field, bounds for a time field. A rule matching kinds refuses
  what none of its kinds takes. Broad rules (by regular expression or
  table, or matching every field) skip what a field cannot take, so one
  `missing` or `format` rule serves fields of every kind.
- Names and tables that match no field are left unused, so one list of
  rules serves several tables and charts.
- Settings that clash once merged are refused, naming the rules that gave
  them: `min` from one rule above `max` from a later one.

## How a value is written

Every surface writes a value in the same order:

1. A missing value is written as `missing` ("–" by default).
2. Otherwise, the first mapping that matches the value gives its text.
3. Otherwise, the format writes it; without one, numbers are written as
   charts write numbers, times as dates with times of day, and categories
   as they are.

## Mappings

| Mapping | Matches |
| --- | --- |
| `{ value: "200", text: "OK" }` | One value: text for category fields, a number for number fields, epoch milliseconds for time fields. |
| `{ between: [0.9, null], text: "Healthy" }` | Numbers or times from the first end to the second, both included; `null` leaves an end open. |
| `{ regex: "^5(\\d\\d)$", text: "Server error $1" }` | Categories matching a JavaScript regular expression; `$1` to `$9` in `text` write its groups. |

A mapping gives one of `value`, `between`, and `regex`, and `text`,
`color`, or both. Category fields take values and regular expressions;
number and time fields take values and ranges. A mapping without `text`
leaves the value written as it would be, and colors it.

## Colors

A value's display color is, in order: a missing value's `missing` color;
the first matching mapping's color; for number fields, its threshold step's
color. Values none of these colors have no display color.

```ts
thresholds: {
  mode: "absolute",           // or "percent": step values are percents of the field's min to max
  base: "#2e7d32",            // values below the first step; none without it
  steps: [{ value: 200, color: "#f9a825" }, { value: 500, color: "#c62828" }],
}
```

Values from a step's value up to the next step's take its color, so 200 is
the 200 step's. Steps ascend by value. Percent steps need the field's `min`
and `max`; filters, streaming, and the viewport never move them. Thresholds
are for number fields; categories take colors from mappings.

| Surface | Takes display colors |
| --- | --- |
| Bars, lines, areas, regions | `encode.color` (or `fill`, `stroke`) `: { field: "p99" }`, a number field without a scale: bars and regions per row, lines and areas along their length, each piece in the color of the observation it arrives at. Values without a display color take the theme's muted color, as values a channel scale leaves unmapped do. A field without display colors is refused, naming both fixes. |
| Points, heatmaps | `color: "p99"` where the mark gives none of `colors`, `colorDomain`, and `colorMidpoint` (those keep its ramp). Points without a display color take the theme's muted color; heatmap cells without one are transparent. Points and cells missing the value are not drawn, as with a ramp. A heatmap's `reduce: "sum"` keeps its ramp, as sums are not the field's values. |
| Series and bars of a category field | Mapping colors give their values' colors (`series: "status"`, `color: "status"`) where no declared scale colors the field; values without a mapping color take the palette's, and bars and regions missing the value `missing`'s color. |
| Gauges | Without `bands`, a band per step within the gauge's ends, and the dial in its value's step's color. |
| Tooltips | A tooltip field's value color, as a swatch beside it, and `InspectedField.color`. |
| Legends | A mark coloring by display colors lists a key of them (below). |
| Application code | `displayOf(...).color(value)` (see [Reading displays](#reading-displays-in-typescript)). |

A declared color scale (`scales.color`) colors its values whole, display
colors or not, and a mark's own paint (`color: "#hex"`, `stroke`) wins.
Field displays of one value must agree on its color: two displays giving
`"503"` of `status` different colors, as a table and a table derived from
it can, are refused as a drawing error naming both rules.

**Keys.** A mark coloring by display colors shows a key in its legend, as
marks show keys of sizes and shapes: an entry per color a value can take.
Number fields list color mappings first, then steps, each written by its
mapping's text, else by what of its range earlier mappings leave it, in
the display's format ("< 200ms", "200ms – 500ms", "≥ 500ms", or "> 500ms"
after a mapping of values up to 500). Category fields list each value a mapping
colors, by its text. Keys explain colors; their entries hide and select
nothing, and `getLegend()` does not list them. Missing values are left
out of keys.

**Threshold places.** Rules and regions stand at a field's steps:

```ts
rule({ y: { thresholds: "p99" }, dash: "--", contributeDomain: true })   // a rule at each step
region({ y: { thresholds: "p99" }, fillOpacity: 0.12 })                 // a band from each step to the next
```

Each rule or band is in its step's color unless the mark gives `stroke`
(rules) or `fill` (regions). Bands run from each step to the next, the last
to the plot's end, and from the plot's start to the first step where the
thresholds give a `base`. The steps are those of the field's display in
the tables the chart's marks read (a field of no table where none reads
it); where tables give the field different steps (percent steps with
different bounds), the place names its table, `{ thresholds: "p99", table:
latency }` (specs: the table's name), and a table without the field is
refused. Label parts' `{ value: true }` write the step's value through the
field's display ("500ms"); a base band's writes nothing. `contributeDomain`
adds the steps' values, never the bands' open ends. Each rule or band is
keyed by its step's value as written (a percent step by its percent; the
base band by `"base"`), so adding a step renames no other: events report
them as items of their mark, `item: '["slo","500"]'` for a rule with id
"slo", with no rows. Rules at thresholds cannot be dragged.

## Charts

A chart's `fields` applies to every mark it draws. Each surface writes a
field through its display, and its own option wins for that surface alone.

```ts
createChart(el, {
  fields: {
    latency: { label: "Latency", format: { duration: "millisecond" } },
    service: { label: "Service", mappings: [{ value: "api", text: "Public API" }] },
  },
  marks: [line(requests, { x: "time", y: "latency", series: "service" })],
});
```

The y axis writes "1s 500ms", the legend and tooltips name the series
"Public API", and tooltips write each value as the display does.

| Surface | What it reads |
| --- | --- |
| Number axes | The format of the fields on the axis, where they agree: ticks, crosshair labels, tooltip headers, `chart.formatValue`. |
| Time axes | The format of the fields on the axis for values; ticks keep their calendar labels. |
| Category axes | Each category's mapped text, where the fields on the axis agree on their mappings; bands of numbers or times (a heatmap's `xBanded`) written from their values in the format and mappings their fields agree on. |
| Axis titles | `{ label }` parts: a field's label. |
| Legends | Series' names; entries several series share through a color field, and a declared color domain's entries without rows, by the value's text (as the marks holding the value write it); keys of category fields, and color ramps, by the field's label and text. |
| Tooltips | Series' names, each series' values through its value field (each end of a range through its own; a box plot's statistics through the field it summarizes), the fields points encode as size, color, opacity, and shape, a candle's prices and a cell's edges through their fields, and tooltip fields' labels and text. |
| Labels | `{ field }` and `{ value: true }` parts; bars' value labels and annotations' labels of a field. |
| Gauges | `label`, `format`, `min`, `max`; bands and the dial's color from `thresholds`. |
| Color ramps | A number field's `min` and `max` as the ramp's default domain (points, heatmaps, contours), an end it does not give from the data; colorbars write the field's format, a time field's as times; contours name their levels through their color field. |
| Text alternative | Series' names, their values, and a value field's `description`, once, after its first series. |

From lowest to highest, a value is written by Herceg's default, then
`fields`, then the surface's own option: an axis' `format` and
`tooltipFormat`, a tooltip field's `label` and `format`, a label part's
`format`, a mark's `label`, a gauge's `min`, `max`, `label`, and `format`,
and a mark's `colorDomain`. Where an axis' formats and its fields meet:

| Surface | Format, the first that applies |
| --- | --- |
| Tick labels | the axis' `format`; the format its fields agree on (number axes); the default |
| Crosshair labels, tooltip headers, `chart.formatValue` | the axis' `tooltipFormat`; its `format`; the format its fields agree on; the default |
| A series' value in a tooltip | the axis' `tooltipFormat`; the value field's format; the axis' `format`; the default |
| A tooltip field | the field's own `format`; its display's; for times on a time x axis, the x axis' values' format; the default |

A mark in every subplot (`panel: "*"`) takes the `tooltipFormat` of the
subplot inspected. Values of several fields in one tooltip (a candle's
prices, a cell's edges, a precomputed box's statistics, a custom mark's
ranges) are each written through their own field's display, in the same
order. Times without a format are written as dates with times of day, as
charts write them. A stack to its shares (`stack: "fill"`) writes the
shares as its axis does, and each layer's value in its field's display;
its value labels write the shares.

Mappings and missing text apply whatever the format. Display text never
keys anything: legend entries, colors, hidden series, selections, and
events' values stay raw, so a series renamed by a display keeps its color
and visibility.

A chart given `fields`, or a mark's `label` of parts, loads the code that
writes displays before its first frame (`chart.loading` settles then), as
charts with pattern formats or encodings load theirs. Charts without them
load none of it. Static output (SVG, PNG, PDF) and `herceg/spec` bring it.

## Axes

The fields marks place on a position scale agree when they have the same
format (number axes) or the same mappings and missing text (category
axes); then the axis writes through them. Where they disagree (latency in
milliseconds and memory in bytes on one y axis), the axis writes as it does
without displays, and its own `format` is the way to choose.

Agreement is per scale name, over the whole chart: facets draw the same
fields in every panel, so every panel's axis writes their format; subplots
placing fields that disagree on `y` write the default on every subplot's y
axis, even one whose own fields agree. Give such an axis its `format`.

Axis titles take parts: text and `{ label }`, a field's label (its name
without one).

```ts
y: { title: [{ label: "latency" }, " (p99)"] } // "Latency (p99)"
```

A subplot's own axis title (`panels`) and a 3D chart's `z` title are text.

## Names

A series is named, in order, by:

1. Its mark's `label`, text or parts.
2. Its value field's label, for one series or wide data (`y: ["p50",
   "p99"]` names "Median" and "99th percentile"); a box plot's or a
   histogram's, the field it summarizes.
3. Its series value through the series field's display, for long data
   (`series: "service"` names "Public API").

A series mark's `label` takes parts:

| Part | Writes |
| --- | --- |
| `"text"` | Itself. |
| `{ series: true }` | The series' default name. |
| `{ field }` | A field constant within each series, through its display: the mark's series field, or for lines and areas, its color field. |
| `{ label }` | A field's label, its name without one. |

```ts
line(metrics, { x: "time", y: "p99", series: "host", color: "region",
  label: [{ series: true }, " (", { field: "region" }, ") p99"] }); // "db-1 (Ireland) p99"
```

A legend entry one series has is named by the series' name. An entry
several series share through a color field is named by the color value
through its field's display ("Ireland") where every mark sharing the
entry writes that value alike, else by the value itself; each series
keeps its own name in tooltips, labels, the keyboard, and the text
alternative. A name
field that stops being constant within a series is the chart's drawing
error (an `error` event, drawn in place), not the table's: the write
succeeds, and the chart draws again once the field is constant.

Parts that join identities join by their raw form: a line and its band
given `[{ label: "latency" }]` share one legend entry, keyed by "latency",
whatever `fields.latency.label` says.

## Tooltips, labels, and gauges

- Tooltip fields (`tooltip.fields`) take their label and text from their
  displays, under the entry's own `label` and `format`. A format of the
  wrong kind for its field is refused, as displays refuse it.
- Label parts: `{ field }` is written through the field's display (its
  part's `format` over the display's; mappings and missing text stay),
  `{ value: true }` through the labeled series' value field, numbers and
  times alike (a band's labels through the field of the edge they follow),
  and `{ label }` writes a field's label. Bars' value labels and annotations' labels of a field
  write through the displays without parts.
- Tooltip fields take their value's display color as a swatch beside the
  value (`InspectedField.color`).
- Gauges take the value field's `label`, `format`, `min`, and `max`, each
  under the gauge's own; an end the gauge does not give comes from the
  display, and ends that cross are refused, naming where each is given.
  Without `bands` of their own, they take a band per threshold step within
  their ends, and the dial takes its value's step's color.

## Layout marks

Layout marks write their items' names through the displays of the fields
they read them from, sums in their value field's format, and fields by
their labels, in legends, drawn labels, tooltips, breadcrumbs, the text
alternative, and the inspections events carry.

| Mark | Names | Amounts | Labels of |
| --- | --- | --- | --- |
| Pie, funnel | Slices and stages, through `category` | Sums through `value` | `category` and `value`, in the summary and selected shares |
| Treemap, sunburst | Each level's nodes through its `path` field (deeper levels through the last; `id` for id and parent trees) | Values through `value` | the path fields and `value` |
| Sankey | Nodes, through `source` and `target` where their displays write the name alike | Flows and totals through `value` | `value` |
| Network | Nodes, through `source`, `target`, and `node` where they agree; groups through `color`; link labels through `linkLabelField` | Links and totals through `value`; sizes through `size` | `value`, `color`, `size` |
| Map regions and points | Through `labelField`; legend entries of a category `color` through it | Values through `color`; sizes through `size`, in the size key | `color` (the ramp's title) and `size` (the key's) |
| Radar | Spokes through `category`, or `fields` by their labels; series through `series` | Values through `value` | `category` and `value` |

Sums, totals, and means are written in the value field's format and missing
text, without its mappings, which name single values. Label parts of
treemaps and sunbursts take `{ field }` and `{ value: true }` as series
marks' labels do.

Names never key anything: items' keys, legend entries, hiding, selections,
`rowsOf`, and drills stay raw. `setDrillRoot(["eu"])` and `drill` events
name nodes by their raw paths, while the breadcrumbs draw "Europe".

## Grids

Grids take displays through `herceg/fields` alone, compiled once:
`createGridModel({ ..., fields: compileFields(rules) })`, then
`model.setFields(...)` to change them. Headers read fields' labels and
descriptions, cells write through the displays, and group rows write keys
and aggregates by operation and kind. Grids without `fields` load none of
it. See [Grids](grids.md#field-displays).

## Reading displays in TypeScript

`herceg/fields` is its own entry: charts that do not import it pay
nothing for it.

```ts
import { compileFields, displayOf, fieldsOf } from "herceg/fields";

const latency = displayOf(fields, { table: requests, field: "latency" });
latency.label; // "Latency"
latency.text(66_000); // "1m 6s"
latency.text(Number.NaN); // "–"
latency.color(66_000); // its step's color, or undefined

// A field by name and kind, of a table by name, as specs name them.
const quota = [{ match: { table: "quotas", field: "bytes_in" }, label: "Quota" }];
displayOf(quota, { field: "bytes_in", kind: "number", table: "quotas" }).label; // "Quota"
```

- `displayOf(fields, of, settings?)` takes a table's field (`{ table,
  field }`, its kind the table's, typed by its schema) or a field by name
  and kind (`{ field, kind, table? }`). `settings` gives the `locale`, the
  `timeZone` times are written in ("local" by default), a surface's own
  `format`, which replaces the field's while its mappings and missing text
  still apply, and the surface's own `missing` text, for fields whose
  displays give none ("–" by default).
- A display's `text(value)` writes a value, and `color(value)` gives its
  display color (undefined for none); `format(value)` writes a value
  computed from the field's values (a sum, a mean) in its format and
  missing text, without the mappings. `settings.defaultFormat` gives a
  surface's format where neither its own nor the field's applies (grids'
  times, to the second).
- `compileFields(fields)` checks the rules once and returns their
  `displayOf`, for surfaces resolving many fields, and `column(...)`, what
  a grid column shows through them (`ColumnDisplay`), which grids call.
- `fieldsOf(table, displays)` writes rules for a table's fields, each
  display typed by its field's kind and checked against the schema; the
  rules match that table's fields wherever they are drawn.

```ts
const fields = fieldsOf(requests, {
  latency: { label: "Latency", format: { duration: "millisecond" } },
  service: { label: "Service", mappings: [{ value: "api", text: "Public API" }] },
});
```

A display of the wrong kind is a type error (`format: { si: "B" }` on a
time field), and the call refuses it with its path.

## Specs

```json
{
  "data": { "requests": { "columns": { "time": [0, 60000], "latency": [450, 66000] } } },
  "fields": [
    { "match": { "kind": "number" }, "missing": "–" },
    { "match": "latency", "label": "Latency", "format": { "duration": "millisecond" }, "min": 0, "max": 120000 }
  ],
  "marks": [{ "type": "line", "data": "requests", "x": "time", "y": "latency" }]
}
```

`validateSpec` checks `fields` as `herceg/fields` does, with paths
(`fields[1].format`). What needs a column's kind, such as a time format
given a column of numbers here or in a tooltip's fields, is checked as
`loadSpec` reads the data. Tables are named by their names in the spec's
`data`. Charts drawn from the spec write through its `fields`, and marks'
`label` and axes' `title` take parts as in TypeScript.

## Python

```python
fields = [
    hg.FieldDisplay(match=hg.Match(kind="number"), format=hg.Format(number=",.1f"), missing="–"),
    hg.FieldDisplay(match=hg.Match(regex="^bytes_"), format=hg.Format(binary="B")),
    hg.FieldDisplay(match="bytes_out", label="Sent"),
    hg.FieldDisplay(match="bytes_quota", format=False),
]
status = hg.FieldDisplay(label="Status", mappings=[
    hg.Mapping(value="200", text="OK"),
    hg.Mapping(regex=r"^5(\d\d)$", text="Server error $1"),
])
health = hg.FieldDisplay(mappings=[hg.Mapping(between=(0.9, None), text="Healthy")])
p99 = hg.FieldDisplay(
    format=hg.Format(duration="millisecond"),
    missing={"text": "no data", "color": "#9e9e9e"},
    thresholds=hg.Thresholds(base="#2e7d32", steps=[(200, "#f9a825"), (500, "#c62828")]),
)
```

- Each setting takes `False`, which resets it.
- `hg.Mapping(between=(from, to))` takes numbers or datetimes, `None` for
  an open end; `value` takes text, a number, or a datetime.
- Regular expressions are JavaScript's, passed through as given.
- `hg.Chart(fields=...)` takes displays (a dict by column, or a list of
  rules) for every mark of the chart, layout marks too
  (`hg.Chart(sales, fields=...).pie("region", "revenue")` names slices
  through the region's display); widgets and Streamlit carry them. Grids
  are TypeScript's alone.
- `hg.Match(table=)` takes data the chart draws, written as the chart's
  table name, or a spec table's name.
- `hg.Mapping(color=...)` colors values, with or without `text`;
  `missing=` takes text, or a dict of `text` and `color`;
  `hg.Thresholds(steps=[(value, color), ...], base=..., mode="percent")`
  takes steps as pairs or dicts.
- `rule(y=hg.AtThresholds("p99"))` and `region(y=hg.AtThresholds("p99"))`
  stand at a column's steps; `hg.AtThresholds("p99", table=data)` names
  whose, as `hg.Match(table=)` does.
- Marks' `label=` and axes' `title=` take parts: text and
  `hg.LabelPart(series=True)`, `hg.LabelPart(field=...)`, and
  `hg.LabelPart(label=...)`. `herceg.express` names single series and
  titles axes by `hg.LabelPart(label=column)` when given `fields=`, so
  the displays' labels name them.
- Links (`hg.Link`) come with the surfaces that draw them.

```python
chart = hg.Chart(requests, fields={"latency": hg.FieldDisplay(label="Latency", format=hg.Format(duration="millisecond"))})
chart.line(x="time", y="latency", label=[hg.LabelPart(label="latency"), " p99"])
```

## Errors

Displays are checked where they are given, and messages say where, what is
wrong, and what to give instead.

| Case | Message |
| --- | --- |
| A format a category field cannot take | `displayOf fields.host.format: "host" holds categories; formats are for numbers and times; drop format` |
| A number format for a time field | `fieldsOf fields.time.format: "time" holds times; give { time } or Intl date options` |
| Bounds a rule's kinds cannot take | `fields[0].min: this rule matches kind "category"; bounds are for numbers; drop min` |
| An empty match | `fields[0].match: {} matches every field; drop match for that` |
| A malformed regular expression | `fields[0].match.regex: "(" is not a regular expression (unterminated group); give a JavaScript one` |
| A mapping matching two ways | `fields.status.mappings[0]: a mapping matches by value, between, or regex; give one` |
| A range whose ends cross | `fields.score.mappings[0].between: 0.9 is above 0.5; give from, then to` |
| A value part in a series' name | `line (mark 0) label[1]: a series' name has no value; use { series: true }, { field }, or { label }` |
| A name field that does not split series | `line (mark 0) label[0].field: "zone" does not split the series; a name reads the series field or the color field ("host" or "region")` |
| A name field that changes within a series (the chart's drawing error) | `line (mark 0) label[2].field: "region" changes within series "db-2"; a name reads a field constant within each series` |
| A tooltip field's format of the wrong kind | `tooltip.fields[0].format: "time" holds times; give { time } or Intl date options` |
| Steps out of order | `chart fields.p99.thresholds.steps[1].value: steps ascend; 200 follows 500; order the steps by value` |
| A step without a color | `chart fields.p99.thresholds.steps[0].color: expected a color; received nothing` |
| Percent steps without bounds | `chart fields.cpu: percent thresholds (fields[1]) need min and max; give both` |
| Thresholds on a category field | `chart fields.status.thresholds: "status" holds categories; thresholds are for number fields; color categories with mappings` |
| A mapping with neither text nor color | `chart fields.status.mappings[0]: give text, color, or both` |
| A color channel on a number field with no display colors | `bar (mark 0) encode.color.field: field "p99" holds numbers, and fields give it no colors; name a channel scale (a scale of the chart's with a range), take its values as colors (scale: { type: "identity" }), or give fields.p99 thresholds or mappings with colors` |
| One value, two colors (the chart's drawing error) | `chart fields: "503" of "status" is "#c62828" (fields[0]) and "#ff0000" (fields[1]); one value has one color` |
| A place at a field without thresholds | `rule (mark 1) y.thresholds: fields give "p99" no thresholds; give fields.p99.thresholds, or place the rule at a value` |
| A place where tables disagree | `rule "hot" y.thresholds: "cpu" of "a" and of "b" take different thresholds; give table` |
| A place naming a table without the field | `rule (mark 1) y.thresholds: table "other" has no field "p99"; give a table whose p99 has thresholds` |
| Python | `FieldDisplay min: 120000 is not below max 0; give min below max`; `Match kind: expected "number", "time", or "category"; received "geometry"`; `Mapping: give value, between, or regex, one of them`; `Thresholds steps[1]: steps ascend; 200 follows 500; order the steps by value`; `AtThresholds field: expected a column name; received 3` |
