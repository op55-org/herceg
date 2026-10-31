# Data

Charts and grids read **tables**: named columns of equal length, stored as
typed arrays. This guide covers building tables, changing them while charts
show them, preparing data with derived tables, and choosing, grouping, and
pivoting rows without copying them.

- [Tables](#tables)
- [Field kinds](#field-kinds)
- [Changing data and streaming](#changing-data-and-streaming)
- [Rows that arrive late](#rows-that-arrive-late)
- [Derived tables](#derived-tables)
- [Row views](#row-views)
- [Row sets and selection stores](#row-sets-and-selection-stores)
- [Row groups](#row-groups)
- [Row pivots](#row-pivots)
- [Data in Python](#data-in-python)

## Tables

```ts
import { category, table, time } from "herceg";

const requests = table({
  time: time(["2026-01-21T09:30:00Z", "2026-01-21T09:31:00Z"]),
  latency: new Float64Array([120, 135]), // used in place, not copied
  service: ["api", "web"], // strings: a category field
  status: category([200, 503]), // numbers that name things: "200", "503"
});

requests.numbers("latency"); // Float64Array view of the live rows
requests.categories("service"); // { codes: Int32Array, dictionary: string[], revision }
requests.value("latency", 0); // 120 (null when missing)
requests.value("time", 0); // epoch milliseconds
requests.value("status", 1); // "503"
```

| Input | Becomes |
| --- | --- |
| `Float64Array`, `Float32Array`, other typed arrays | A number field, used without copying. The table copies it only on its first write (copy-on-write). |
| `number[]` | A number field, converted once. |
| `string[]` | A category field: `Int32Array` codes (-1 for missing) and a dictionary, in order of first appearance. |
| `time(values)` | A time field from epoch milliseconds, `Date`s, or ISO 8601 strings. |
| `category(values)` | A category field from numbers or strings, labeled as `String` writes them. |
| `encodedCategory(codes, dictionary)` | A category field that is already dictionary-encoded (Arrow dictionaries, pandas categoricals), used without decoding. |
| `geometry(set, codes?)` | A geometry field of shapes for maps (see [Maps](maps.md)). |

`fromGeoJSON(collection)` makes a whole table from GeoJSON features: a
geometry field and a field per property ([Maps](maps.md)).

Field names are checked at compile time against the table: an option that
reads values (a line's or bar's value axis, `size`, a numeric `color`)
accepts only number or time fields, and `series` only category fields;
position fields may be categories where the mark takes them (points, bars,
lines along y).

`fromRows(rows, { types })` converts row objects: `Date` properties become
time fields, numbers number fields, strings category fields. `types` reads a
property as another kind (`"time"` for epoch milliseconds or ISO strings,
`"category"` for numeric codes):

```ts
const rows = fromRows(records, { types: { at: "time", status: "category" } });
```

### Matrices

A field sampled on a grid (a density estimate, a simulation, an image) is a
matrix: a value at every x crossed with every y. `fromMatrix` keeps the
coordinates as given instead of a column of x and y per grid point. Values
are in rows of x: the i-th x and j-th y at `j * nx + i`, as a NumPy array of
shape `(y, x)` flattens.

```ts
const density = fromMatrix({ x: xs, y: ys, density: values }, { x: "x", y: "y" });
contour(density, { x: "x", y: "y", color: "density", variant: "bands" });
```

Contours and surfaces read the matrix as it is; other readers (a heatmap)
get a value of x and y per row, made the first time they read them.
Appending, dropping, resetting, or replacing coordinates turns the table
into an ordinary one; replacing values keeps the matrix.

## Field kinds

Herceg never guesses a field's kind from its name or magnitudes.

- **Times.** Epoch milliseconds given as plain numbers draw a number axis
  (ticks such as "1.77T"). Wrap them in `time()` for a time axis. `time()`
  reads strings as `Date.parse` does: a date alone is UTC midnight, and a
  date and time without an offset is local time, so give `Z` or an offset
  for instants.
- **Time axes.** A continuous axis is a time axis when any field a mark
  places on it holds times. Bar lengths and histogram counts stay numbers.
  Set `type: "linear"` on the axis to read times as plain numbers.
- **Categories.** Numbers that name things (years, status codes, ids) are
  categories with `category()`. Colors and legend order follow the
  dictionary order (see [Styling](styling.md#colors-follow-what-series-stand-for)).
- **Empty columns.** An empty array carries no element type at run time,
  whatever its TypeScript type, so `[]` (and an array of only missing
  values) makes a number field: `[] as number[]` starts a number column.
  Start a column of text with `category([])` and one of times with
  `time([])`. Appending text to a number field of a table with no rows yet
  says so: `append "label": row 0: expected a number; received "peak"; an
  empty array makes a number column, so start text with category([])`.
  Specs read a JSON `[]` the same way; an empty category column is
  `{ "type": "category", "codes": [], "dictionary": [] }`.

## Changing data and streaming

Tables are mutable. Charts reading a table draw again on the next animation
frame, once however many changes arrive.

```ts
const live = table(
  { time: time([]), cpu: [] as number[], mem: [] as number[] },
  { maxRows: 3_000 },
);
live.append({ time: [Date.now()], cpu: [0.42], mem: [3.1] }); // keeps the newest 3,000 rows
live.appendRow({ time: "2026-01-21T09:32:00Z", cpu: 0.4, mem: 3.2 });
live.set("cpu", 0, 0.5); // one value
live.replace(0, { cpu: [0.1, 0.2], mem: [3.5, 3.6] }); // rows 0 and 1 of two fields
live.setColumn("cpu", newValues); // every value of a field
live.dropFirst(10);
live.dropBefore("time", Date.now() - 60_000);
live.reset({ time: newTimes, cpu: newValues, mem: newMem }); // all data, same fields
live.transaction(() => {
  live.append(batch);
  live.dropBefore("time", Date.now() - 60_000);
}); // charts and listeners hear one change
```

| Method | Does |
| --- | --- |
| `append(batch)`, `appendRow(row)` | Adds rows at the end. With `maxRows`, drops the oldest first. |
| `set`, `replace`, `setColumn` | Changes values in place. |
| `dropFirst(n)`, `dropBefore(field, value)` | Drops rows from the front. |
| `reset(columns)` | Replaces all rows; fields keep their kinds. |
| `transaction(change)` | Runs `change`; its writes are reported as one change when it returns. |
| `subscribe(listener)` | Called after each change, with what changed. |
| `byteLength` | Bytes the table holds. |

- Change a typed array's values through the table. The table and the array
  share memory, but only the table's methods keep its cached extents and
  level-of-detail indexes current and redraw charts.
- A write that fails changes nothing: `append` and `replace` check every
  value (numbers, times that parse, category labels) before writing, and a
  value of the wrong kind throws with its row.
- `replace(start, values)` writes every field it is given as one change, so
  nothing reading the table sees some fields written and others not.
- A transaction batches what listeners hear; it does not roll back. If
  `change` throws, the writes it made stay, one change reports them, and
  the error is thrown on. A transaction inside another joins it. One made
  inside a listener is reported when it returns, as a write made there is:
  listeners after that one hear it before the change they were about to
  hear. Reads inside a transaction, of the table or of a view of it, see
  its writes so far.
- In a rolling window, a category dictionary stays bounded: once it holds
  more than twice as many entries as there are rows (and 64 more), unused
  values leave and codes are renumbered in order.
  `categories(field).revision` counts these renumberings.

How a streaming chart stays fast (min/max indexes, incremental stacks,
frame coalescing) is described in [Large data](large-data.md).

## Rows that arrive late

Feeds deliver some rows late: a sensor reconnects, a batch is held back. An
**ordered table** keeps its rows in ascending order of a number or time
field and merges rows that arrive late into place:

```ts
import { category, orderedTable, time } from "herceg";

const readings = orderedTable(
  { time: time([]), pump: category([]), value: new Float64Array(0) },
  { orderBy: "time", maxRows: 180_000 },
);
readings.append({ time: [t2, t0, t1], pump: ["a", "b", "a"], value: [1, 2, 3] }); // any order
```

- Rows at or after the last row append as in any table; earlier rows go
  into place, one merge per batch. Ties keep the order rows came in: after
  rows of the same value already there, and in the batch's order.
- `maxRows` and `dropBefore` drop from the first row in order, so a late row
  earlier than every row `maxRows` keeps is not kept.
- Every row needs its order value: `append "time": row 3: is missing; an
  ordered table needs every row's time`. `replace` and `set` refuse the
  order field, since its rows would move; drop and append them instead.
  `reset` sorts what it is given.
- Rows keep their identity as late rows move them, so row sets, selections,
  and highlights stay on their observations (see [Row
  sets](#row-sets-and-selection-stores)).
- Every mark follows a merge from the first row it moved: lines, stacks, and
  series redo that part, not the whole table.
- An ordered table holds 8 bytes a row more than a table, for the rows'
  identities. A late row costs moving the rows after it once per field; a
  feed of ten series at 10 Hz in a 180,000-row window, one row in 150 late
  by up to two minutes, merges and redraws lines and a stack in about 4 ms
  a tick (`npm run bench:core`).

In a spec, `orderBy` makes a columns entry an ordered table:
`{ "columns": { ... }, "orderBy": "time", "maxRows": 180000 }` (`maxRows`
alone keeps the newest rows of an ordinary table). In Python, pass
`hg.ordered(df, by="time", max_rows=180_000)` as a chart's data.

## Derived tables

`derive` prepares data: filters, calculated fields, bins, aggregates,
rolling windows, and sorting. Field names are checked at compile time
against what each step produces. The result is an ordinary table that
follows its source.

```ts
import { col, count, derive, heatmap, line, mean } from "herceg";

const hourly = derive(readings)
  .filter(col("temp").gt(-40).and(col("site").ne("test")))
  .calculate("f", col("temp").mul(1.8).add(32))
  .bin("time", { bins: { step: 3_600_000 }, as: "hour" })
  .aggregate({ by: ["hour", "site"], ops: { mean: mean("f"), n: count() } })
  .table();
line(hourly, { x: "hour", y: "mean", series: "site" });

derive(prices).rolling({ size: 20, ops: { ma: { op: "mean", field: "close" } } }).table();

// Rows counted in bins of x and y, drawn as a heatmap of cells.
const cells = derive(points)
  .bin("x", { bins: [0, 1, 2, 5, 10], as: "x0", end: "x1" })
  .bin("y", { bins: 20, as: "y0", end: "y1" })
  .aggregate({ by: ["x0", "x1", "y0", "y1"], ops: { n: count() } })
  .table();
heatmap(cells, { x1: "x0", x2: "x1", y1: "y0", y2: "y1", color: "n" });
```

```python
hourly = (
    hg.derive(df)
    .filter((hg.col("temp") > -40) & (hg.col("site") != "test"))
    .calculate("f", hg.col("temp") * 1.8 + 32)
    .bin("time", bins={"step": 3_600_000}, name="hour")
    .aggregate(by=["hour", "site"], mean=("f", "mean"), n="count")
)
hg.line(hourly, x="hour", y="mean", series="site")
hg.derive(prices).rolling(20, ma=("close", "mean"))
```

| Step | TypeScript | Python |
| --- | --- | --- |
| Filter | `.filter(expr)` | `.filter(expr)` |
| Calculate | `.calculate(name, expr)` | `.calculate(name, expr)` |
| Bin | `.bin(field, { bins, as, end })` | `.bin(column, bins=, name=, end=)` |
| Aggregate | `.aggregate({ by, ops: { name: mean("f") } })` | `.aggregate(by=, name=("f", "mean"))`, as pandas' named aggregation |
| Rolling window | `.rolling({ size, by, ops })` | `.rolling(size, by=, name=("f", "mean"))` |
| Sort | `.sort(field, "descending")` | `.sort(column, descending=True)` |

- **Expressions** (`col("x").gt(0)`, `.add`, `.mul`, `.and`, `.isIn`,
  `.isMissing`, `when`, and more) are portable JSON trees
  (`[">", ["field", "temp"], 30]`), so specs carry them and Python builds
  them with operators (`&`, `|`, `~`, `is_in`, `is_missing`). Missing
  values compare false except as unequal. Calculated fields are categories
  when they give text, numbers otherwise.
- **Bins** take what histograms take (`BinSpec`): about a count of round
  bins (10 by default), `{ step, start }`, or edges. `bin` replaces the
  field (or adds `as`) with each value's bin start and, with `end`, adds
  the bin's end. Time fields bin by a step in milliseconds.
- **Aggregates**: `count`, `sum`, `mean`, `median`, `min`, `max`, `q1`, `q3`,
  `stdev`, `variance` (sample statistics), `distinct`, `first`, and `last`,
  over finite values. `count()` counts rows, `count(field)` the field's
  finite values. Quantiles interpolate as NumPy and pandas do. Ungrouped
  aggregates give one row even for no rows.
- **Rolling windows** are trailing windows of rows (within `by` groups) with
  `count`, `sum`, `mean`, `min`, `max`, and `stdev`.

**Following the source.** Rows appended to the source run through filters,
calculations, and bins of a width or of edges on their own, and rows the
source drops take the rows they gave with them. Other changes, and
pipelines with aggregates, rolling windows, sorting, or bins of a count,
recompute the table. Treat derived tables as read-only. A derived table
keeps its source alive; the source holds it weakly, so one no longer
referenced stops following once collected.

TypeScript charts bundle the transforms only when they call `derive`;
`herceg/spec` includes them (about 4.9 KiB gzip) because specs may carry
them.

## Row views

A row view shows a table's rows filtered and sorted without copying a
column: it holds the positions of the rows it shows.

```ts
import { col, rowView } from "herceg";

const view = rowView(requests, {
  filter: col("latency").gt(250),
  sort: [{ field: "service" }, { field: "latency", order: "descending" }],
});
const { indices, length } = view.read(); // positions into `requests`, in view order
```

| Member | Does |
| --- | --- |
| `read()` | Brings the view current and returns its positions. |
| `query`, `setQuery(query)` | The filter and sort; change one and keep the other with `setQuery({ ...view.query, sort })`. |
| `restrict(rowSet)` | Shows only a row set's rows (`null` for all). |
| `indexOf(position)` | Where a table row shows in the view, or -1. |
| `subscribe(listener)`, `dispose()` | Told when the view goes out of date; stop following the table. |

Views follow their table. A change marks them out of date at once, and the
next `read` catches up: appended rows are filtered and merged into the
order, rows that left a rolling window are dropped, and a change to a field
the view filters or sorts by re-sorts the changed rows. Sorts are stable,
with missing values last in either direction and categories by label.

Series marks take a view where they take a table: lines, areas, bars,
points, rugs, error bars, box plots, boxen, violins, candlesticks, heatmaps,
histograms, and custom marks (whose series hold the view's rows). A mark draws what it would draw over a table of the view's
rows alone, and redraws as the view changes:

```ts
const slow = rowView(requests, { filter: col("latency").gt(250) });
histogram(slow, { x: "latency" }); // bins, scales, and stacks of the view's rows
line(rowView(requests, { filter: col("service").eq("api") }), { x: "time", y: "latency" });
```

- Lines and areas connect rows in the view's order, so a view sorted by
  something other than x draws as rows out of x order do.
- Histograms, box plots, and binned heatmaps aggregate the view's rows.
- Scales and stacks span the view's rows; category colors and legend
  entries are the table's, so filtering never recolors a series. Give an
  axis a `domain` to keep it still as the filter changes.
- Facets split a view's rows into their panels (`facet: "repeat"` repeats
  them).
- The mark's table is the view's table, so row selections and selection
  stores bind the table, not the view.
- A mark copies the view's positions it draws: 4 bytes a row shown.

Limits:

- Annotation marks (rules, text, regions), layout marks (pies, treemaps,
  graphs), and custom marks take tables only.
- Points of a view are drawn on the CPU, not with WebGL.
- Sorting runs on the main thread: about 0.13 s for a million rows by a
  number, 0.25 s by a category and a number.

In a spec, a view is a data entry naming its table:
`{ "source": "requests", "view": { "filter": [">", ["field", "latency"], 250] } }`,
with `sort` as `[{ "field": "latency", "order": "descending" }]`. In
Python, `hg.view(requests, filter=hg.col("latency") > 250, sort="time")`.

## Row sets and selection stores

A `RowSet` is a set of a table's rows by identity, one bit per row, such as
the rows picked in a grid. Its rows stay members as others are appended,
dropped, or merged before them; a reset of the table empties it. Over an
ordered table a set holds only the 32-row words that have a member (12
bytes each), so it stays bounded however long a row that arrived early
stays in the window.

A `SelectionStore` keeps one table's selections by **channel**. Each
channel is set and cleared by its owner, either as a condition
(`selectWhere(expr)`, which rows appended later meet or not) or as a row set
(`selectRows(set)`).

```ts
import { col, RowSet, rowView, selectionStore, selectRows, selectWhere } from "herceg";

const store = selectionStore(trips);
store.set("brush", selectWhere(col("fare").gt(20)));
store.set("picked", selectRows(new RowSet(trips).addAll([3, 7, 9])));

const filtered = rowView(trips, { filter: store.condition(["brush"]) });
store.subscribe(() => filtered.setQuery({ filter: store.condition(["brush"]) }));
```

`store.condition(channels)` is the conjunction of those channels'
conditions. `store.subscribe` listeners hear each change as it is made
(`{ channel, selection, revision }`), even one made while others hear an
earlier change. Nothing propagates on its own: the application decides which
views read which channels. Grids and charts bound to a channel write and
highlight it (see [Selected rows](interaction.md#selected-rows)).

## Row groups

`groupRows` groups the rows a view shows by the values of some fields and
keeps each group's aggregates in an ordinary table, one row per group, that
charts draw and grids show.

```ts
import { bar, col, count, groupRows, max, mean, rowView } from "herceg";

const failed = rowView(requests, { filter: col("status").isIn("500", "503") }); // categories, as text
const byService = groupRows(failed, {
  by: ["service"],
  ops: { errors: count(), latency: mean("latency"), worst: max("latency") },
});
bar(byService.table, { x: "service", y: "errors" });
```

With several fields, groups nest, and each level has a table of its own:

```ts
const traffic = groupRows(rowView(requests), {
  by: ["region", "service"],
  ops: { n: count(), latency: mean("latency") },
});
bar(traffic.tableOf("region"), { x: "region", y: "n" });
bar(traffic.table, { x: "service", y: "latency", series: "region" }); // the last level
```

- **Aggregates** are `count`, `sum`, `mean`, `min`, and `max`, with derived
  tables' semantics, leaving out missing and infinite values. A level's
  aggregates are of its own rows: a region's mean is the mean of its
  requests, not of its services' means.
- **Sums are compensated**, so a group's sum stays within about an ulp of
  the exact sum of its rows however rows came and went. It can differ from
  a derived table's plain sum in the last digits.
- **Order.** Groups come in the order they first appeared. The view's
  filter and restriction choose rows; its sort orders each group's rows,
  not the groups.
- **Typing.** `tableOf(field)` is typed by the fields `by` lists, so a chart
  of the regions' table cannot name `service`.

**Following the view.** Appended rows update the groups they join, at every
level, and add new groups. Rows a rolling window drops are taken away the
same way, except that a group whose minimum or maximum left is computed
again from its rows. Anything else (a value the groups read changed in
place, a new filter, a reset) computes the groups again. Each level's table
changes only where values differ, and listeners hear one change once every
level is written. `dispose()` stops following; the tables keep their last
values.

| Member | Gives |
| --- | --- |
| `table`, `tableOf(field)` | The last level's table, or a level's by its field. |
| `keyOf(g, depth?)` | A group's key: its path of values (a label, a number, or null). Keys name groups across changes and resets; numbers do not. |
| `indexOf(key)` | A group by its key. |
| `groupOf(position, depth)`, `parentOf`, `childrenOf` | Move between rows and levels. |
| `members(g, depth)`, `memberAt(g, i)` | A group's rows; the `i`th row of a last-level group in view order. |
| `subscribe(listener)` | Told once the groups have followed a change. |
| `byteLength` | The typed arrays the groups hold. |

Memory: 4 bytes per table row for each row's group; about 6 more per shown
row once a reader lists groups' rows; and, for tables that drop rows, 8
bytes per row for each aggregated field (the values to take away). Grouping
a million rows into a thousand groups takes about 20 ms; 1,000 appended
rows update them in about 0.1 ms (Node, Apple M6).

## Row pivots

`pivotRows`, from `herceg/pivot`, shows a view's rows as a crosstab: a row
per value of one field, and a column per value of another and aggregate.

```ts
import { bar, count, mean, rowView } from "herceg";
import { pivotRows } from "herceg/pivot";

const traffic = pivotRows(rowView(requests), {
  rows: "region",
  pivot: "service",
  ops: { requests: count(), latency: mean("latency") },
  totals: true,
});
bar(traffic.table, { x: "region", y: "requests", series: "service" });

const crosstab = traffic.read();
crosstab.values; // the services, in column order: ["api", "web", "db"]
crosstab.value(0, crosstab.indexOf("web"), "latency"); // first region's mean web latency
```

The aggregates are row groups by the two fields:

- `traffic.table` has a row per combination of region and service that some
  row has (a long table that charts read).
- `traffic.rowTable` has a row per region with its totals.
- `read()` gives the crosstab: rows in the order their values first
  appeared; `values` in column order (categories in dictionary order,
  numbers and times ascending, missing last).

| Crosstab member | Gives |
| --- | --- |
| `cell(row, index)` | The combination's position in `table`, or -1 where it is absent. |
| `value(row, index, aggregate)` | An aggregate; `undefined` where absent. With `zeroFill: "count"`, absent counts read 0. |
| `members(row)`, `cellMembers(row, value)` | The rows behind a row or a combination, to drill down. |
| `columns` | The generated columns: each value's aggregates, then a total per aggregate with `totals`. Ids are JSON of the field, the value with its kind, and the aggregate, so they stay stable as values come and go. |

The pivot follows its view as groups do; combinations and values left
without rows go.

**Limits.** Pivots are bounded. These are the defaults:

```ts
pivotRows(view, {
  rows: "region",
  pivot: "service",
  ops: { requests: count() },
  limits: { generatedColumns: 1024, observedCombinations: 1_000_000, ownedBytes: 128 * 2 ** 20 },
});
```

- Passing a limit throws a `PivotLimitError` naming the `limit`, the
  `observed` amount, and the `budget`, before the groups grow further.
- A pivot already following its view stops where it was instead: its
  tables and crosstab keep what they held, its listeners are told, and
  `failure` holds the error. Recreate it over a narrower view or with
  larger limits.
- No value is dropped to stay within a limit.
- `ownedBytes` bounds an estimate: the typed arrays stay within it, but long
  labels and the runtime's object overhead can take more. Measured, the
  estimate was 1.5 to 4.2 times the memory kept.

A million rows by 100 regions and 10 or 100 services with three aggregates
build in about 40 ms and keep 4–6 MiB, a sixth of the source. A thousand
services of three aggregates pass the default column limit. Grids show
pivots with `createPivotGrid` (see [Grids](grids.md#pivots)).

## Data in Python

Python charts take pandas, Polars, and PyArrow tables, mappings of column
names to arrays or lists, and lists of records. A column is converted the
first time a mark uses it, without building Python objects per value:

| Column | Sent as |
| --- | --- |
| integers, floats, booleans | float64 (float32 stays float32); missing values are NaN |
| datetimes, dates (any unit) | epoch milliseconds as float64, keeping fractions; naive values are UTC |
| strings, categoricals, Arrow dictionaries | int32 codes and a dictionary |

- Only columns that marks and derive steps use are sent, as little-endian
  binary buffers beside the chart spec, never as JSON number lists.
- Columns of Python objects (pandas `object` columns, lists) are typed by
  their values: all strings, all numbers, or all dates and datetimes.
  `None`, NaN, `pd.NA`, and `NaT` are missing.
- An empty or all-missing list or `object` column has no values to type it
  by and makes a number column, as `[]` does in JavaScript. Columns whose
  type says text (pandas `"string"` and `"str"`, NumPy `str`, Polars
  `pl.String`, Arrow `pa.string()`) make category columns even when empty,
  so start a live chart's column of text with one, such as
  `pd.Series([], dtype="string")`.
- Conversions that would silently change data are refused, naming the
  column: integers beyond ±2**53, columns mixing strings, numbers, and
  dates, and names or labels that collide as text (`1` and `"1"`).
- `hg.derive` runs in the browser, so a chart can send raw rows once and
  aggregate them there, and live charts aggregate rows as they stream in.
- `hg.matrix(columns, x=, y=)` makes a [matrix](#matrices): the `x` and `y`
  columns hold its coordinates once each, and every other column a 2D array
  of shape `(len(y), len(x))` (or flattened in that order). Live widgets'
  `append` and `replace` refuse matrices.

- `hg.ordered(data, by=, max_rows=)` is [an ordered table](#rows-that-arrive-late),
  and `hg.view(data, filter=, sort=, descending=)` a [row view](#row-views)
  for series marks; both pass where a chart or mark takes data.

Selection stores, row groups, and pivots are TypeScript only.
Live notebook charts stream rows from Python (see
[Notebooks and Streamlit](python/notebooks-and-streamlit.md)).
