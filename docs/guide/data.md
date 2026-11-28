# Data

Charts and grids read **tables**: named columns of equal length, stored as
typed arrays. This guide covers building tables, changing them while charts
show them, preparing data with derived tables, and choosing, grouping, and
totalling, and pivoting rows without copying them.

- [Tables](#tables)
- [Field kinds](#field-kinds)
- [Changing data and streaming](#changing-data-and-streaming)
- [Rows that arrive late](#rows-that-arrive-late)
- [Derived tables](#derived-tables)
- [Row views](#row-views)
- [Row sets and selection stores](#row-sets-and-selection-stores)
- [Row groups](#row-groups)
- [Totals](#totals)
- [Groups highlighting their rows](#groups-highlighting-their-rows)
- [Cross-filtering](#cross-filtering)
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

**Columns built by name.** `ColumnInput` is any of these inputs. To build
columns in a loop, give the record that type, so the table knows its
fields only at run time: options then take any field name, and marks check
each one as they are made.

```ts
import { area, type ColumnInput, table, time } from "herceg";

const columns: Record<string, ColumnInput> = { time: time(hours) };
bands.forEach((values, band) => {
  columns[`band${band}`] = values; // a Float64Array per band
});
const folded = table(columns);
area(folded, { x: "time", y: "band0" }); // a field it lacks throws here
```

Reads are typed by what the record allows: any field may be a category,
so `folded.value("band0", 0)` is `string | number | null`. To read a
number column typed, take its numbers: `folded.numbers("band0")` is a
typed array view of its live rows, as above (it throws for a category
field).

A record built without that type (`{ time, ...Object.fromEntries(pairs) }`)
leaves the table knowing only the fields written out, and options refuse
the others at compile time.

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

**Back to the source rows.** A derived table remembers its source and
steps, so a condition on its fields can be written on the source's: a
clicked item's [provenance](interaction.md#events) and a selection's
`conditions` carry it as `source`, to forward to a query of the rows
behind a bar or a bin. Each step rewrites the condition exactly or gives
null:

| Step | The condition on the source |
| --- | --- |
| Filter | the condition and the filter |
| Calculate | the calculated field replaced by its expression |
| Bin | a comparison of the bin start with a number as one of the field with bin edges (`>=` a start, `<` the next, `<=` the last edge for edges and counts of bins), with missing values and values out of the bins where they belong; null where the condition reads the bin's `end` |
| Aggregate | unchanged on `by` fields; null on an aggregate's outputs |
| Sort | unchanged |
| Rolling window | null |

A table computed from another outside `derive` (a spec table naming its
`origin`, a model's fit) is not derived: conditions on it stay on its own
fields.

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
| `query`, `setQuery(query)` | The filter, sort, and channels followed, as given; change one and keep the others with `setQuery({ ...view.query, sort })`. |
| `filter`, `restricted` | What the view applies now: its own filter joined with the conditions of the channels it follows (undefined for none), and whether row sets restrict it. |
| `restrict(rowSet)` | Shows only a row set's rows (`null` for all). |
| `indexOf(position)` | Where a table row shows in the view, or -1. |
| `subscribe(listener)`, `dispose()` | Told when the view goes out of date; stop following the table and the store. |

Views follow their table. A change marks them out of date at once, and the
next `read` catches up: appended rows are filtered and merged into the
order, rows that left a rolling window are dropped, and a change to a field
the view filters or sorts by re-sorts the changed rows. Sorts are stable,
with missing values last in either direction and categories by label.

**Following a selection store.** With `selection`, a view shows only the
rows the channels of a [selection store](#row-sets-and-selection-stores)
of its table hold too, and filters again as they change:

```ts
const filters = selectionStore(requests);
const slow = rowView(requests, { filter: col("latency").gt(250), selection: { store: filters } });
const others = rowView(requests, { selection: { store: filters, excluding: "services" } });
```

- **Which channels.** Every channel the store holds, those set later too;
  `channels` lists some (`[]` follows none), or `excluding` leaves some
  out, as a [cross-filtered](#cross-filtering) panel leaves out its own.
  Not both.
- **Conditions and row sets.** A channel's condition joins the view's own
  `filter`, and rows appended later meet it or not; a channel's row set
  restricts the view as `restrict` does, intersected with the view's own
  and with other channels' sets, and holds no row appended later. A
  channel holding nothing adds nothing.
- **What it costs.** A channel's change filters every row of the table
  again when the view is next read (groups and totals of the view read it
  at once), and tells the view's listeners only when what the view applies
  changed. Appends are filtered as before, only the new rows.
- **One table.** The store must be of the view's table: types refuse a
  store of another, and so does the view at run time (`rowView
  selection.store: a store of "visits"; this view shows "sales", so give a
  store of "sales"`).
- **Writing.** A gesture on a chart of the view (a brush, a selected
  item, through a binding or in the `select` event's conditions) is
  written within the view's own filter and restriction, not those of the
  channels it follows: they are other panels' filters, so channels never
  copy one another's conditions.

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
  entries are the table's, so filtering never recolors a series, and so
  is the order of a category axis' bands: a sorted view does not reorder
  bars ([How bands are ordered](axes-and-legends.md#how-bands-are-ordered)).
  Give an axis a `domain` to keep it still as the filter changes.
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
with `sort` as `[{ "field": "latency", "order": "descending" }]` and
`selection` as `{ "excluding": "services" }` (or `{ "channels": [...] }`,
or `{}` for every channel): it follows the store `loadSpec` makes for its
table, the one the spec's `rowSelection` binds, or the one given in
`loadSpec`'s `stores`. In Python, `hg.view(requests, filter=hg.col("latency")
> 250, sort="time", selection=hg.Channels(excluding="services"))`.

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

const brushed = rowView(trips, { selection: { store, channels: ["brush"] } });
```

`store.condition(channels)` is the conjunction of those channels'
conditions. `store.subscribe` listeners hear each change as it is made
(`{ channel, selection, revision }`), even one made while others hear an
earlier change: a change a listener makes while another is delivered
reaches the listeners after it first.

**Selections never change.** A store freezes the selection it is given, in
place: the selection, its row set (`rows.freeze()`), and a condition's
expression through. `selectRows` and `selectWhere` return frozen
selections too. Changing a frozen set throws ("RowSet: the set is frozen,
as selections hold it; change a copy, rows.copy()"), so a selection a
listener or an event kept still names the rows selected then. A
selection's `rows` are typed `ReadonlyRowSet`; to change them, select a
copy:

```ts
const held = store.get("picked");
if (held?.kind === "rows") store.set("picked", selectRows(held.rows.copy().add(12)));
```

`copy()` copies the set's words, not its rows (125 KB for a million rows;
over an ordered table, only the words that hold members); a copy of a set
from before a reset is empty. Freezing copies nothing. Positions, `size`,
and `current` still follow the table: a frozen set's rows leave as the table
drops them, and none are left after a reset. Views follow the channels
they name ([Following a selection store](#row-views);
[Cross-filtering](#cross-filtering) shows a dashboard's), and grids and
charts bound to a channel write and highlight it (see
[Selected rows](interaction.md#selected-rows)).

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
  not the groups. A group whose rows all leave (a filter, a rolling
  window) leaves the tables, and comes back in its place when rows
  return, so bars of groups and a line of days keep their order as
  filters change. A group's place is remembered as long as its key is,
  as tables forget labels no row holds: past about twice as many keys as
  the table has rows, those no row of the table holds are forgotten (a
  rolling window's old days), and a group whose key was forgotten comes
  back last, as a new one. A key that first
  appears after the others comes last too, so draw a line of groups whose
  rows arrive out of order through a view sorted by its x, and give a
  category axis a `domain` to keep a band where a group left
  ([How bands are ordered](axes-and-legends.md#how-bands-are-ordered)).
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

## Totals

`rowTotals` keeps one row of aggregates over every row a view shows, with
row groups' operations and semantics: a grid's totals row, a KPI tile, a
rule at the mean.

```ts
import { col, count, gauge, mean, rowTotals, rowView, sum } from "herceg";

const view = rowView(requests, { filter: col("region").eq("eu") });
const totals = rowTotals(view, { ops: { n: count(), latency: mean("latency"), bytes: sum("bytes") } });
totals.table.value("latency", 0); // the mean latency of the rows the view shows
gauge(totals.table, { value: "latency" });
```

- **Over no rows**, counts and sums are 0, the others missing.
- **The table** has one row, its fields named by the ops and typed as
  groups' tables are (a mean of times is a time); `aggregates` lists them.
  Reading `revision` (or the table, through a grid) brings the totals up to
  date with the view.
- **Following the view** works as groups' does: appends add their rows,
  rows a rolling window drops are taken away (a minimum or maximum that
  left is found again from the rows), and anything else (a value changed
  in place, a new filter, a reset) computes the totals again. Sums are
  compensated, and summed again exactly from the rows where cancelling
  values leave them beyond their accuracy.
- `subscribe(listener)` hears each change; `dispose()` stops following. Held
  weakly by what they follow, totals no one keeps stop on their own.

Memory: one row; for tables that drop rows, 8 bytes per row for each field
the totals read (the values to take away), and for a view that leaves rows
out (a filter or restriction) a byte per row saying which rows it showed.
1,000 rows appended to a million update the totals in about 0.07 ms, and
drops from a rolling window in about 0.09 ms; one value changed in place
computes them again, about 10 ms over a million rows (Node, Apple M6).

## Groups highlighting their rows

A chart of a table made from another (groups of `sales`, a derived
table's aggregates, totals) can be bound to a selection store of the
table it was made from. It then highlights how much of each group's rows
the channel holds, and its clicks select those rows of the source, so a
bar of revenue by region follows a brush of the sales themselves:

```ts
import {
  bar,
  createChart,
  groupRows,
  lineage,
  point,
  rowSelection,
  rowView,
  selectionStore,
  sum,
} from "herceg";

const focus = selectionStore(sales);
const byRegion = groupRows(rowView(sales), { by: ["region"], ops: { revenue: sum("revenue") } });

createChart(salesElement, {
  marks: [point(sales, { x: "time", y: "revenue" })],
  interaction: { brush: "x" },
  rowSelection: rowSelection({ store: focus, channel: "focus" }),
});
createChart(regionsElement, {
  marks: [bar(byRegion.table, { x: "region", y: "revenue" })],
  rowSelection: rowSelection({ store: focus, channel: "focus", lineage }),
});
```

- **`lineage`** is the code that finds each group's rows and what the
  channel holds of them. A binding of a table the chart does not draw
  takes it; without it, the chart is refused with the import named.
  Bindings of the tables a chart draws need none, and charts that bind
  only those load none of it. Specs, Python, notebook widgets, Streamlit,
  and `herceg/web` bring it themselves.
- **Bars of counts and sums** draw each bar's selected part from its base
  (in stacks, from its segment's base), lit, and the rest of it dimmed
  above: a region whose rows the channel holds 30 of 60 of revenue is
  lit to half its height.
- **The partial look.** Where no selected part can be drawn, a bar some of
  whose rows are selected is drawn in the mark's `partial` look: means,
  minimums and maximums, sums with a contribution below zero, sums of a
  calculated field, aggregates of aggregates, and rolling windows. By
  default it is the unselected look outlined in the bar's color, 1.5 px.
  Groups all of whose rows are selected are drawn selected, and those
  none of whose rows are, unselected; points draw in the same three
  looks, and lines and areas draw a group as selected while any of the
  rows behind their value is.
- **Layout marks** (pies, funnels, treemaps, sunbursts, Sankey links) draw
  an item's selected share of a count or sum, and dim the rest. Their
  items add their rows' counts, so they are refused a table whose rows
  share contributors (rolling aggregates).
- **Text.** Tooltips and the keyboard say how many of a group's rows the
  channel holds, and for counts and sums what they measure ("60; 2 of 3
  rows selected, revenue 30 of 60"); the text alternative counts the
  source's rows ("4 of 6 rows of sales selected."). Bands and error bars
  count the rows behind both their ends. An inspected point
  carries the same as `coverage`: `selected`, `total`, `state`
  (`"none"`, `"partial"`, `"all"`), `channel`, and for a count or sum its
  `measure`.
- **Grids** of a groups' table take the source's store as charts do:
  `createGridModel({ data: rowView(byRegion.table), columns,
  selectionStore: focus, channel: "focus", lineage })`. A click selects
  the rows behind the row clicked, a row all of whose rows are selected
  is selected (`aria-selected`), and one partly selected has
  `data-selection="some"` and says how many in its description ("2 of 3
  rows selected"). The model keeps the store's schema
  (`GridModel<S, R>`, `R` the source's), so its `select` events give
  selections of the source's rows. Grids showing groups of their own
  (`groups`, or `setGroups` later) are refused a store of another table
  yet.

What gestures write through lineage is in
[the interaction guide](interaction.md#selected-rows-through-lineage).

**Budgets.** Following a selection through lineage keeps indexes beside
the tables: the rows behind each group, the channel's rows as bytes, and
each group's counts and sums. A binding may keep `budget` bytes of them,
16 a row of its table by default and at least 64 KiB; past it, the chart
is refused when made (`"unsupported"`, at `rowSelection.budget`, saying
how much it needs), and a chart whose tables grow past it later stops
highlighting them, reports it through `onError` (phase `"render"`), and
says so in its text alternative. A binding that draws nothing
(`effect: "none"`) is checked as the tables its gestures walked grow, and
lets go of what they keep once past it. Grids keep the default budget: past it
`createGridModel` throws, and a grid whose tables grow past it later
shows no rows selected and reports it through `reportError` (or
`console.error`). Clicks still write the rows behind what they select
once highlighting stops, keeping nothing they find. Destroying the chart
or grid, or giving the chart another binding, lets go of the indexes at
once.

**Where it stops.** A chart's table may come from one bound table: a mark
whose table and its source both have bound stores is refused, as is a
store of a table no mark's rows come from. Marks that draw shapes of
their own for a selection (histograms, 2D histograms, contours, box
plots, violins, boxen plots, candlesticks, and heatmaps) are refused a store
through lineage yet; bind a store of the table they draw. Selected parts
of means, minimums, maximums, and quantiles are not drawn yet.

In Python, a binding's `data` may be the data of a derived table the chart
draws: `hg.Chart(hg.derive(df).aggregate(by="region", revenue=("revenue",
"sum")), row_selection=hg.SelectionBinding("focus", data=df))`.

## Cross-filtering

A cross-filtered dashboard draws one table in several panels, and each
panel's filter narrows the others: brushing a time range shows only those
days everywhere else, and clicking a region's bar shows only that region.
The pieces above declare it, with no listeners and no table rebuilt: a
selection store holds a channel for each panel, each panel draws a row
view that follows every channel but its own, the panels that sum draw
groups of their view, and each chart's row selection writes its brush or
its clicked bar to its own channel. As a channel changes, the views and
groups follow it in place, and the marks keep the tables they were given.

The example has four panels over a row a day and region (`time`, `region`,
`month` as `"2025-03"`, `revenue`, `orders`): revenue per region over time,
orders a day, revenue per region, and revenue per month.

```ts
import {
  bar,
  createChart,
  groupRows,
  line,
  lineage,
  rowSelection,
  rowView,
  type SelectionGesture,
  selectionStore,
  sum,
} from "herceg";

// The filters: a channel for each panel, which filters the others.
const filters = selectionStore(sales);

/** The rows a panel shows: those every other panel's channel leaves. */
const rowsFor = (panel: string) =>
  rowView(sales, { selection: { store: filters, excluding: panel } });

/** A panel's brushes or clicks set its channel to rows of `sales`, through its groups. */
const filtering = (channel: string, events: SelectionGesture[]) =>
  rowSelection({ store: filters, channel, events, lineage });

// Panels that sum draw groups of their rows, which follow the view.
const byDay = groupRows(rowsFor("orders"), { by: ["time"], ops: { orders: sum("orders") } });
const byRegion = groupRows(rowsFor("regions"), {
  by: ["region"],
  ops: { revenue: sum("revenue") },
});
const byMonth = groupRows(rowsFor("months"), { by: ["month"], ops: { revenue: sum("revenue") } });

const revenueChart = createChart(revenueElement, {
  marks: [line(rowsFor("revenue"), { x: "time", y: "revenue", color: "region" })],
  interaction: { brush: "x" },
  rowSelection: filtering("revenue", ["brush"]),
});
const ordersChart = createChart(ordersElement, {
  marks: [line(byDay.table, { x: "time", y: "orders" })],
  interaction: { brush: "x" },
  rowSelection: filtering("orders", ["brush"]),
});
// The axis lists the regions: a bar a filter empties keeps its band.
const regionsChart = createChart(regionsElement, {
  x: { domain: ["North", "South", "East", "West"] },
  marks: [bar(byRegion.table, { x: "region", y: "revenue", color: "region" })],
  interaction: { select: "items" },
  rowSelection: filtering("regions", ["click"]),
});
const monthsChart = createChart(monthsElement, {
  marks: [bar(byMonth.table, { x: "month", y: "revenue" })],
  interaction: { select: "items" },
  rowSelection: filtering("months", ["click"]),
});
```

- **One store, a channel for each panel.** `rowView(sales, { selection:
  { store, excluding } })` shows the rows every other channel holds: their
  conditions joined, their row sets intersected
  ([Following a selection store](#row-views)). A panel is never filtered
  by its own channel, so it keeps its brush or its selected bar in place.
- **Bindings write the channels.** A brush writes its range as a
  condition on `time`; a bar of groups, through `lineage`, the condition
  of its group's key (`region == "West"`); the orders' brush, along its
  groups' axis, a condition on the rows' times
  ([Selected rows through lineage](interaction.md#selected-rows-through-lineage)).
  Each condition holds for rows that arrive later. Each chart highlights
  what its own channel holds.
- **Groups follow their view, and keep their places.** Their tables stay
  the same objects as the groups change, so the marks keep drawing them.
  A group a filter empties leaves its table, and comes back in its place
  when its rows do ([Row groups](#row-groups)): the line of days stays in
  order of time, and the months' bars in theirs. The regions' axis lists
  its bands in `domain`, so a bar a filter empties keeps its band, empty;
  the months' axis has a band for each month that has rows.

**In a spec**, a panel is the same entries: a view following the channels,
groups of it, and a binding of the table. The regions' panel:

```json
{
  "version": 1,
  "data": {
    "sales": {
      "columns": {
        "region": ["North", "South"],
        "month": ["2025-03", "2025-03"],
        "revenue": [4200, 5100]
      }
    },
    "shown": { "source": "sales", "view": { "selection": { "excluding": "regions" } } },
    "byRegion": {
      "source": "shown",
      "groups": { "by": ["region"], "ops": { "revenue": { "op": "sum", "field": "revenue" } } }
    }
  },
  "x": { "domain": ["North", "South", "East", "West"] },
  "marks": [
    { "type": "bar", "data": "byRegion", "x": "region", "y": "revenue", "color": "region" }
  ],
  "interaction": { "select": "items" },
  "rowSelection": { "data": "sales", "channel": "regions", "events": ["click"] }
}
```

`loadSpec` makes one store for each table the spec's bindings and views
name. Panels loaded from several specs filter each other through one table
and one store given to each: `loadSpec(spec, buffers, { tables: { sales },
stores: { sales: filters } })`.

**In Python**, `hg.view(..., selection=hg.Channels(excluding=...))`,
`hg.group_rows`, and a `hg.SelectionBinding` of the data make the same
specs:

```python
import herceg as hg


def shown(panel):
    """The rows a panel shows: those every other panel's channel leaves."""
    return hg.view(sales, selection=hg.Channels(excluding=panel))


def filtering(channel, events):
    """A panel's brushes or clicks set its channel to rows of sales."""
    return hg.SelectionBinding(channel, data=sales, events=events)


revenue = hg.Chart(shown("revenue"), brush="x", row_selection=filtering("revenue", ["brush"]))
revenue.line(x="time", y="revenue", color="region")

by_day = hg.group_rows(shown("orders"), by="time", orders=("orders", "sum"))
orders = hg.Chart(by_day, brush="x", row_selection=filtering("orders", ["brush"]))
orders.line(x="time", y="orders")

by_region = hg.group_rows(shown("regions"), by="region", revenue=("revenue", "sum"))
regions = hg.Chart(
    by_region,
    x=hg.AxisOptions(domain=["North", "South", "East", "West"]),
    select="items",
    row_selection=filtering("regions", ["click"]),
)
regions.bar(x="region", y="revenue", color="region")

by_month = hg.group_rows(shown("months"), by="month", revenue=("revenue", "sum"))
months = hg.Chart(by_month, select="items", row_selection=filtering("months", ["click"]))
months.bar(x="month", y="revenue")
```

Each Python chart holds the store of its own copy of `sales`, as separate
notebook outputs and widgets do (sharing one across a page is on the
[roadmap](../roadmap.md#python-and-live-integration)). A chart's view
follows its own binding's channels, and a channel set from Python
(`hg.SelectionBinding(..., selection=hg.col("month") == "2025-03")`, or a
widget's `row_selection`) filters its views in static output too. The four
specs filter each other where a page loads them over one table and store,
as above.

**A grid among the panels** shows a view following the others' channels
and writes the rows selected in it to a channel of its own, which the
other panels' views intersect with their conditions:

```ts
import { createGridModel } from "herceg/grid";

const model = createGridModel({
  data: rowView(sales, { selection: { store: filters, excluding: "grid" } }),
  columns: [{ field: "time" }, { field: "region" }, { field: "revenue" }],
  selectionStore: filters,
  channel: "grid",
});
```

A filter step is a new query of the grid's view: at its first row, the
grid shows the rows a cleared filter brings back from the top; scrolled
down, it keeps its scroll offset ([how a grid follows its
view](grids.md#a-grid)).

**What a filter step costs.** A channel's change tells the views that
follow it. Groups follow their view at once: within the `set` call, the
view filters every row of the table again and the groups compute again
from it, then write their table in place (the values that differ and the
groups added, or the whole table when a group leaves or comes back). A
view no groups follow, as the revenue lines', filters when its chart reads
it. Each chart draws once, in the next frame. No table is made or
replaced: the marks hold the same tables throughout. Keeping the views and
groups up to date takes about 0.08 ms a step over 2,924 rows (two years
of days in four regions) and 8 ms over 365,000, the same as listeners
setting each view's filter would take, before the charts draw. The
charts' part over 365,000 rows is about 6 ms more, most of it the four
charts' scenes (5 ms). Each chart highlights what its own channel holds,
so the orders' line counts the selected rows of its 91,250 days as it
draws: the whole step takes about 14 ms, and 13 ms with charts that
highlight nothing (Node, Apple M6).

**Streaming.** Rows appended to the table go through the same path, but
only the new rows rather than the whole table: each view filters them by
its channels' conditions (a brush's condition holds for rows that arrive
later; a grid's row set holds none of them), the groups add them to the
groups they join or start new ones, and each chart draws once a frame.
1,000 rows take about 0.25 ms before drawing, whether every view takes
them or a brush leaves them out. A day's late rows join its group in its
place, and a new month's bar comes after the others. Rows a rolling
window drops leave the views and groups the same way.

**Where it stops.**

- A new filter is not incremental: each view filters every row again, and
  its groups compute again. A step grows with the table and the number of
  panels.
- Groups give counts, sums, means, minimums, and maximums. A distinct
  count, a median, or a quantile per group needs a derived table's
  aggregate, which takes a table rather than a view: each filter step
  makes a new table, and each change computes it again whole.
- Orders by value: groups keep the order they appeared in, so ranked bars
  need a view of the groups sorted by their value and a new `domain` each
  step (the [ranked-bars recipe](axes-and-legends.md#how-bands-are-ordered)).
- A panel's totals (`rowTotals` of its view) follow its filters; a share of
  the unfiltered total needs a second totals over a view without them.
- A grid of a panel's groups selects rows of the groups' table, in a
  store of its own; grids showing groups of their own are refused a
  store of the source yet.
- Drilling into a panel (years, then a year's months) changes what it
  groups by, which is new groups and a new table for the mark: a drill
  step rebuilds that panel; a filter step does not.

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
| `columns` | The generated columns: each value's aggregates, then a total per aggregate with total columns. Ids are JSON of the field, the value with its kind, and the aggregate, so they stay stable as values come and go. |
| `columnTotal(index, aggregate)` | With a totals row: an aggregate of every row with value `index` (-1: of every row). |

**Totals.** `totals: true` gives both kinds; `{ columns: true }` or
`{ row: true }` gives one:

- **Total columns**: a column per aggregate with each row's aggregates over
  all its values (`rowTable`).
- **A totals row**: each value's aggregates over every row with that value,
  and every row's, folded from the pivot's own combinations and rows. A
  mean is the sum of its rows over their count, never a mean of means; a
  sum folding left beyond its accuracy is summed again from its rows. It
  holds nothing per row, is counted in the pivot's limits, and stops with
  the pivot. Folded again when read after the pivot changed, in
  O(combinations): 1,000 rows appended to a pivot of 200 × 20
  combinations and its totals row read take about 0.5 ms.

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
  and `hg.view(data, filter=, sort=, descending=, selection=)` a
  [row view](#row-views) for series marks, following the channels
  `hg.Channels(...)` names of the store the chart's bindings of the data
  write; both pass where a chart or mark takes data.
- `hg.group_rows(data, by=, **operations)` is [row groups](#row-groups) of
  a view or data, with operations as pandas' named aggregation takes them
  (`n="count"`, `revenue=("revenue", "sum")`; counts, sums, means,
  minimums, and maximums). It is the table of the last grouping column's
  groups; `.level("region")` is an upper level's, and charts of both levels
  share one grouping. `hg.row_totals(data, **operations)` is
  [totals](#totals). Both compute in the browser and follow their view.

Selection stores other than charts' bindings, and pivots, are TypeScript
only.
Live notebook charts stream rows from Python (see
[Notebooks and Streamlit](python/notebooks-and-streamlit.md)).
