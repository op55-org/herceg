# Field displays

A field display says how a field is named and how its values are written:
its label, description, format, bounds, missing text, and value mappings.
It is given once, for every surface that writes the field, by field name or
as rules matching fields by name, regular expression, kind, and table.

- [What works today](#what-works-today)
- [Displays](#displays)
- [Rules](#rules)
- [How a value is written](#how-a-value-is-written)
- [Mappings](#mappings)
- [Reading displays in TypeScript](#reading-displays-in-typescript)
- [Specs](#specs)
- [Python](#python)
- [Errors](#errors)

## What works today

- `herceg/fields` resolves displays for application code: `displayOf`
  gives a field's label, description, bounds, and each value's text;
  `compileFields` checks rules once for many fields; `fieldsOf` writes rules
  for a table's fields, typed by its schema.
- Specs carry `fields`, and `validateSpec` checks it, with paths.
- Python builds and checks `hg.FieldDisplay`, `hg.Match`, and `hg.Mapping`.
- Charts do not read `fields` yet: `createChart` and the adapters do not
  take it, Python's `hg.Chart` does not take `fields=`, and a spec's
  `fields` changes nothing it draws. Axes, tooltips, legends, labels, and
  gauges reading it, grids and layout marks taking it, colors and
  thresholds, and links are planned ([roadmap](../roadmap.md)).
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
| `missing` | The text of missing values (null, NaN, and missing times): "–" by default. |
| `mappings` | Values written as given text (see [Mappings](#mappings)). |
| `link` | A link built from the row's values. Typed and checked; no surface draws links yet. |

Every setting also takes `false`, which resets it to its default, as if no
earlier rule had given it.

```ts
const fields = {
  latency: { label: "Latency", description: "Time to the last byte.", format: { duration: "millisecond" }, min: 0, max: 120_000 },
  bytes: { label: "Response size", format: { binary: "B" }, missing: "not sent" },
  status: { mappings: [{ value: "200", text: "OK" }, { regex: "^5(\\d\\d)$", text: "Server error $1" }] },
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

A mapping gives one of `value`, `between`, and `regex`, and `text`.
Category fields take values and regular expressions; number and time
fields take values and ranges.

## Reading displays in TypeScript

`herceg/fields` is its own entry: charts that do not import it pay
nothing for it.

```ts
import { compileFields, displayOf, fieldsOf } from "herceg/fields";

const latency = displayOf(fields, { table: requests, field: "latency" });
latency.label; // "Latency"
latency.text(66_000); // "1m 6s"
latency.text(Number.NaN); // "–"

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
- `compileFields(fields)` checks the rules once and returns their
  `displayOf`, for surfaces resolving many fields.
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
(`fields[1].format`). Tables are named by their names in the spec's
`data`. Charts drawn from the spec do not read `fields` yet.

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
```

- Each setting takes `False`, which resets it.
- `hg.Mapping(between=(from, to))` takes numbers or datetimes, `None` for
  an open end; `value` takes text, a number, or a datetime.
- Regular expressions are JavaScript's, passed through as given.
- `hg.Match(table=)` names a spec table in this version.
- `hg.Chart` does not take `fields=` yet; links (`hg.Link`) come with the
  surfaces that draw them.

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
| Python | `FieldDisplay min: 120000 is not below max 0; give min below max`; `Match kind: expected "number", "time", or "category"; received "geometry"`; `Mapping: give value, between, or regex, one of them` |
