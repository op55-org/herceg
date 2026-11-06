# Grids

`herceg/grid` shows the rows of a table in a virtualized grid: a million
rows mount only what is in view. Grids share tables, views, and selections
with charts, so a grid and a chart can link both ways without copying
data. Grids are TypeScript and React only; Python has none.

- [A grid](#a-grid)
- [Sorting and selecting](#sorting-and-selecting)
- [Events](#events)
- [Columns](#columns)
- [Formats](#formats)
- [Field displays](#field-displays)
- [Looks](#looks)
- [Cells](#cells)
- [Linking a grid and a chart](#linking-a-grid-and-a-chart)
- [Grouped rows](#grouped-rows)
- [Pivots](#pivots)
- [Remote grids](#remote-grids)
- [Accessibility](#accessibility)
- [In React](#in-react)
- [Limits](#limits)

## A grid

```ts
import { rowView } from "herceg";
import { createGrid, createGridModel } from "herceg/grid";

const model = createGridModel({
  data: rowView(requests),
  columns: [
    { field: "time", format: { timeStyle: "medium" } },
    { field: "service", title: "Service" },
    { field: "latency", title: "Latency (ms)", format: { maximumFractionDigits: 1 } },
  ],
  timeZone: "UTC",
});
const grid = createGrid(document.querySelector("#requests")!, { model, ariaLabel: "Requests" });
```

The **model** (also its own DOM-free entry, `herceg/grid/model`) holds
what the grid shows apart from the rows, which the [row
view](data.md#row-views) chooses and orders: the columns, the scroll
position, the focused cell, and the selection. One model serves one grid;
grids of the same rows share the view and the selection store.

| Column option | Means |
| --- | --- |
| `field`, `title` | The field shown, and its header (its [display's](#field-displays) label, else the field's name, by default). |
| `format` | How values are written, in any form axes take (see [Formats](#formats)); none for categories. Numbers align to the end. |
| `width` | Pixels: 120 by default, at least 32. |
| `aggregate` | In a [grouped grid](#grouped-rows), the group's value to show. |

| Model option | Means |
| --- | --- |
| `data` | A row view. |
| `columns` | The columns, as above. |
| `timeZone`, `locale` | How times and numbers are written (the runtime's locale and `"local"` zone by default); an unknown zone is refused as the model is made. |
| `rowHeight` | Pixels per row; 28 by default. |
| `fields` | [Field displays](#field-displays): rules as charts take them, or `compileFields(rules)` shared with other grids and charts; without them, missing values are empty. |
| `selectionStore`, `channel` | Where selected rows go (`"grid-rows"` by default). |
| `selection` | `{ click: "toggle" }`: a plain click on the one row selected clears it (`"only"`, the default, keeps it). |
| `groups` | Row groups to show (see [below](#grouped-rows)). |

The grid follows its table and view as they change:

- Rows appended below those in view cost nothing to draw.
- When rows drop out of a rolling window, or sorted rows arrive above the
  top row, the rows in view stay where they are.
- The focused cell keeps to its row through sorting and streaming, or goes
  to the row taking its place.

The model, view, and table belong to the application. `grid.destroy()`
leaves them; `model.dispose()` stops the model following the view, as it
does on its own once nothing keeps the model. Without a height of its own,
a grid's container gets 320 pixels. Grids take the charts'
[themes](styling.md#themes) (`theme`).

## Sorting and selecting

- **Sorting.** Clicking a header sorts by its field: ascending, descending,
  then not at all. Shift adds the field to the other keys.
  `model.setSort(keys)` does the same. Sorting goes through the view,
  keeping its filter.
- **Selecting.** Clicking a row selects it; Ctrl or Cmd toggles it; Shift
  selects the range from the last one clicked, in the grid's order.
- **The selection** is a row set in the model's
  [selection store](data.md#row-sets-and-selection-stores) under its
  channel, where an application or a chart can read it. A condition put in
  that channel shows as selected rows too.
- **Toggling.** With `selection: { click: "toggle" }`, a plain click on
  the row that is all the selection (or a group's header whose rows are)
  clears it, as dashboards' tables do; otherwise a plain click selects
  only its row.

## Events

`grid.on(event, listener)` returns what stops it.

| Event | Reports |
| --- | --- |
| `rowClick` | A body row clicked (a press released in place, after the click selected), or Enter on one of its cells: `ref`, the row as the model names it (`GridRef`: a table row by its identity, a group by its key), its `rowIndex` now, the `column` id, and `cause` (`"pointer"` or `"keyboard"`). A group's expand toggle and checkbox act alone and report nothing. |
| `cellClick` | The same click, as on its cell, after `rowClick`. |
| `render` | A frame drawn, with the model's `revision` it drew (`grid.drawnRevision` is the last; the first frame draws as the grid is made). |

```ts
const grid = createGrid(element, { model, ariaLabel: "Orders" });
grid.on("rowClick", ({ rowIndex, ref }) => {
  openOrder(orders.value("id", model.rowAt(rowIndex)));
  lastOpened = ref; // names the row however it is sorted later: model.indexOf(lastOpened)
});
grid.on("render", ({ revision }) => revision >= waitingFor && markReady());
```

`ref` follows its row through sorting, filtering, and scrolling
(`model.indexOf(ref)` finds it); `rowIndex` is where it is as listeners
hear of the click, -1 if the click's selection took it out of the rows
(a `select` listener filtering the view by the selection). `model.revision` counts the changes
the grid shows (rows, columns, sort, selection, scroll, focus). Enter on
a cell reports a click without selecting; Space selects.

## Columns

Columns are resized, moved, pinned, and hidden by model commands naming
them by id, or from the headers.

```ts
model.resizeColumn("latency", 160); // at least MIN_COLUMN_WIDTH, 32 pixels
model.moveColumn("service", "time"); // before "time"; null puts it last
model.pinColumn("time", "left"); // or "right"; null unpins
model.setColumnVisible("service", false);

localStorage.layout = JSON.stringify(model.columns); // keep the user's layout
model.setColumns(JSON.parse(localStorage.layout));
```

- **Pointer.** Drag a header's edge to resize; drag the header to move it
  among columns pinned to the same side. Escape puts it back; a drag never
  sorts.
- **Keys on a focused header.** Shift+Left/Right moves the column;
  Alt+Left/Right resizes it by 16 pixels; Alt+Down, Shift+F10, or a right
  click opens its menu (move, resize, pin, unpin, hide, and show any
  column).
- **Pinned columns** show first (left) or last (right) and stay in place
  as the others scroll. They must leave the others 120 pixels
  (`MIN_SCROLLING_WIDTH`): `pinColumn` refuses a column without room
  (`model.canPin(id)` asks first). `setColumns` takes pins as given; in a
  grid too narrow for them, pinned columns scroll with the others until it
  widens.

## Formats

A column's `format` takes every form axes take, by its field's kind, so a
column writes durations, bytes, and patterns as an axis does:

```ts
createGridModel({
  data: rowView(requests),
  columns: [
    { field: "time", format: { time: "%Y-%m-%d %H:%M" } },
    { field: "latency", format: { duration: "millisecond" } }, // "1m 6s"
    { field: "bytes", format: { binary: "B" } }, // "1.5 MiB"
    { field: "requests", format: { number: ".3~s", suffix: " req" } }, // "1.23k req"
  ],
});
```

| Field kind | `format` |
| --- | --- |
| Numbers | Intl options; `{ number }`, a d3-like pattern, with `prefix` and `suffix`; `{ duration }`; `{ si }` and `{ binary }` prefixes (see [Formats](axes-and-legends.md#formats)) |
| Times | Intl date options; `{ time }`, a strftime pattern, with a `fiscal` year |
| Categories | none: written as they are, or as their field's display maps them |

Without a format, numbers have up to two decimals (three significant
digits below 1), and times are written to the second. A format the field's
kind does not take is refused, in TypeScript and when the column is
described (`grid columns[1].format: "service" holds categories; formats are
for numbers and times; drop format`).

## Field displays

A grid given `fields`, [field displays](fields.md) by field name or as
rules, as charts take them, writes its fields as charts given the same
rules do. The model compiles them when it is given them;
`compileFields(rules)` from `herceg/fields` compiles them once for several
grids and charts to share.

```ts
import { compileFields } from "herceg/fields";

const fields = compileFields([
  { match: { kind: "number" }, missing: "—" },
  { match: "latency", label: "Latency", description: "Time to the last byte.", format: { duration: "millisecond" } },
  { match: "status", mappings: [{ value: "200", text: "OK" }, { regex: "^5", text: "Server error" }] },
]);
const model = createGridModel({ data: rowView(requests), columns: [{ field: "time" }, { field: "status" }, { field: "latency" }], fields });
createChart(element, { fields, marks: [line(requests, { x: "time", y: "latency" })] });
model.update({ fields: { latency: { format: { duration: "second" } } } }); // new text; layout, sort, groups, selection, and scroll stay
```

- **Headers** read the column's `title`, else the field's label. The
  field's description is the header's `title`: its tooltip and accessible
  description. Sorting and column changes are announced by these titles.
- **Cells** write a value as the display does: its missing text, then its
  mappings, then its format. A column's own `format` replaces the field's,
  while the mappings and missing text stay. Times without a format are
  written to the second, as grids write them without displays. A category
  value's text is written once, the first time a cell shows it.
- **Group rows** write keys through their fields' displays ("(missing)"
  where a display gives no missing text), and a column's `aggregate` by
  its operation and kind: the field's own `min`, `max`, `mean`, and `sum`
  in its format, without its mappings, which name single values; counts,
  and aggregates that change the kind (a sum of times), as plain numbers.
- **Remote grids** match rules naming a table (`{ match: { table:
  "requests" } }`) by the source's `schema.source` name.
- **`model.update({ fields })`** gives new displays, or none with
  `undefined`; what it leaves out stays. The whole update is checked and
  compiled before any of it applies, so one that is refused (a malformed
  rule, a format a field's kind cannot take) changes nothing, and
  listeners hear of one that applies once.
- Rules are checked as the grid is made and as `update` takes them
  (`grid fields[1].match.regex: ...`), as charts check theirs.

## Looks

Cells take looks from their rows' values: a background (`fill`) and a
text color (`color`), each a channel as [marks' colors](marks.md#encodings)
take them. A column's `encode` colors its cells, a grid's `encode` its
whole rows where a column's own channel gives a cell none, and a column's
`aggregateEncode` its cells on group rows.

```ts
import { col } from "herceg";
import { compileFields } from "herceg/fields";
import type { GridScales } from "herceg/grid";

const scales = {
  heat: { type: "linear", range: ["#ffffff", "#c62828"] },
  services: { type: "ordinal", domain: ["api", "web", "db"], map: { db: "#6a1b9a" } },
} satisfies GridScales;

const model = createGridModel({
  data: rowView(requests),
  fields: compileFields({ latency: { thresholds: { base: "#e8f5e9", steps: [{ value: 200, color: "#fff3cd" }, { value: 500, color: "#f8d7da" }] } } }),
  scales,
  columns: [
    { field: "time" },
    { field: "service", encode: { color: { field: "service", scale: "services" } } },
    { field: "latency", encode: { fill: { field: "latency" } } }, // the field's threshold colors
    { field: "bytes", encode: { fill: { field: "bytes", scale: "heat" } } }, // a gradient
    { field: "errors", encode: { fill: { condition: { when: { top: 10, field: "errors" }, then: "#ffd54f" } } } },
  ],
  encode: { fill: { condition: { when: col("status").ge(500), then: "#fdecea" } } }, // whole rows
});
// `scales` replaces them all, so keep the ones still named.
model.update({ scales: { ...scales, heat: { type: "linear", range: ["#ffffff", "#1565c0"] } } });
```

- **Channels** take the forms marks' colors take: a constant (`{ value }`);
  a field's [display colors](styling.md#display-colors) without a `scale`
  (a number field's thresholds, a category field's mapping colors, or the
  grid's `"color"` scale where it declares one); a field through a scale of
  the grid's; a field of colors as they are (`scale: { type: "identity" }`;
  values that are not colors draw nothing); a condition (an expression, or
  a rank test of the rows the grid shows, `{ top: n, field }`); or a list
  of these, the first giving a row an output winning. A row a channel
  gives no output has no look. Cells have no series, so `{ series: true }`
  is refused, and take only `fill` and `color`.
- **Scales** (`scales`) are the grid's, shared by every channel naming one,
  in columns and rows alike, as a chart's are by its marks: a channel
  scale is a gradient through hex colors along a number or time field,
  whose domain, unless given, spans every field read through it over the
  rows the grid shows (the records and their groups' aggregates together)
  and grows as rows stream in; a scale of categories colors values by its
  `map`, else by the theme's palette at the value's place in its domain,
  kept as values come and go. Without a `domain`, such a scale keeps a
  place for every value it has ever seen, so give streams of new
  categories one.
- **Text** over a fill without a `color` is black or white, whichever has
  the higher WCAG contrast with what it lands on: the fill over the grid's
  surface, and in selected rows the selection's tint over that (a
  translucent theme background is taken over a white page under dark
  text, and a black one under light text). The grid
  works it out for the colors it reads; for fills given as the page's CSS
  variables or color names, CSS works it out from what the page gives
  them, so they follow the page (and style more slowly). A fill of
  `currentColor` is the grid's text color; a page variable holding
  `currentColor` would follow the ink over it, so give fills colors.
- **Group rows** read their level's table: a column's `aggregateEncode`
  names the groups' aggregates (`{ field: "latency" }` for `latency:
  mean("latency")`). A mean, minimum, or maximum takes its field's display
  colors; sums and counts, which are not in their field's units, need a
  scale. Levels above the last give no look from the grouping fields
  below them, and rank tests are refused. `setGroups` refuses groups
  lacking an aggregate a look reads, changing nothing.
- **Pivots** take looks by aggregate (`aggregates.latency.encode`), read
  from each combination's row: the rows and pivot fields and every
  aggregate. A rank test ranks a pivot value's column; totals columns read
  their row's totals.
- **Remote grids** ask the source for the fields looks read, and color
  rows as their blocks arrive. Their scales need domains (gradients and
  scales of categories alike: rows arrive in blocks, so neither the extent
  nor first appearance is known), and rank tests are refused. Group rows
  give no look from aggregates the query lacks.
- **`model.update({ scales, encode })`** compiles the new looks before
  anything changes, as with `fields`; a refused update changes nothing.
  `model.cellAt(row, column)` reads a cell's state, value, text, and look;
  `model.lookAt` its look alone.
- Forced-colors mode drops looks for the system's colors.

## Cells

A cell writes its value's text. A column draws more with a link from its
field's display, a cell kind, or a custom renderer; a column without a
field draws only what a renderer draws.

```ts
import { barCell, chipCell, symbolCell } from "herceg/grid";

createGridModel({
  data: rowView(requests),
  fields: {
    trace: { link: { url: ["/traces/", { value: true }] } },
    status: { mappings: [{ value: "error", color: "#c62828" }] },
  },
  columns: [
    { field: "trace" }, // a link in each cell
    { field: "latency", cell: barCell() }, // from 0, within the rows' extent
    { field: "cpu", cell: barCell({ domain: [0, 1], track: true }) },
    { field: "status", cell: chipCell(), encode: { color: { field: "status" } } },
    { field: "region", cell: symbolCell(), encode: { symbol: { field: "region" } } },
  ],
});
```

**Links.** A text cell of a field whose display has a
[`link`](fields.md#links) holds an anchor with the link's text, opening in
a new browsing context (`target="_blank" rel="noopener noreferrer"`). A
row missing a value its URL reads, or whose values make a URL of a scheme
links do not take, writes its text. The anchor takes the cell's focus:
Enter and a press follow it (a modified press as the browser does), Space
still selects the row, and arrows move on. A link is the theme's accent,
or the column's `color` look.

**Cell kinds** draw behind or beside the text, which stays:

| Kind | Fields | Draws |
| --- | --- | --- |
| `barCell({ domain, base, track, text })` | numbers | A bar from `base` (0) to the value, within `domain`; else each end from the field's display (`min`, `max`), else the rows' extent with the base in it, found again as rows change. Values below the base draw toward the start. `track: true` draws the bar's full extent behind it. `encode.color` colors the bar. `text: false` draws the bar alone, its text naming the cell for screen readers. |
| `chipCell()` | numbers, categories | The text in a chip filled by `encode.color` (the theme's muted color, faint, by default; `currentColor` is the grid's text color), its text black or white, whichever contrasts more over the cell's fill, in selected rows too. |
| `symbolCell({ size, text })` | any | A symbol of `size` square pixels (64) before the text, shaped by `encode.symbol` (a circle by default) and filled by `encode.color`. `text: false` draws the symbol alone, its text naming the cell for screen readers. |

- Missing values and group rows write their text alone. A kind a field's
  kind does not take is refused, in TypeScript and when the column is
  described (`grid columns[1].cell: bar cells draw numbers; "service"
  holds categories; give a number field, or chipCell()`).
- **`encode.symbol`** takes symbol cells' shapes in the forms colors take:
  a symbol's name (`{ value: "triangle" }`), a category field (symbols in
  turn by first appearance, as charts' points take them), a field through
  a scale of categories (`map` names symbols), a condition, or a list.
  Columns of other cells refuse it.
- A kind's `spec` is its portable form (`barCell({ domain: [0, 1] }).spec`
  is `{ kind: "bar", domain: [0, 1] }`); what draws it in the page comes
  with the grid.
- **Remote grids** hold no records, so bars need both ends (`domain`, or
  the display's `min` and `max`), and symbols in turn are refused (name a
  scale of categories).

**Custom renderers** draw columns' cells in code, by column id:

```ts
createGrid(element, {
  model,
  ariaLabel: "Requests",
  cells: {
    status: {
      fields: ["error"], // fields `read` gives, besides the column's own
      create(host) {
        const badge = host.ownerDocument.createElement("span");
        host.append(badge);
        return {
          update(cell) {
            badge.textContent = cell.text;
            badge.className = cell.read("error") ? "badge failed" : "badge";
          },
          destroy() {},
        };
      },
    },
  },
});
```

- **Lifecycle.** A view is created once for each cell element given the
  column, and updated as the element shows another row, its row changes
  (a table's rows change together), or its look, selection, or index
  moves. It is destroyed once: when the element leaves the column or
  shows a group's row, when the renderer is replaced
  (`grid.update({ cells })`; `cells: undefined` gives columns their own
  cells back), and with the grid.
- **The cell** (`GridCellContext`) is the model's read of it (`state`,
  `value`, `text`, `look`, `link`, `bar`), its `row`, `rowIndex`,
  `column`, and `selected`, and `read(field)` of the fields the renderer
  names. Rows are the same row when their refs' `scope` and `id` agree. A
  `signal` aborts when the next update supersedes this one and on
  destroy: asynchronous work checks it before drawing, and `read` refuses
  after it.
- **Keys.** `interaction` is `"text"` by default: what the renderer draws
  is presentation (its host is `inert`: hidden from screen readers, never
  focused, and its presses the cell's), and the cell's text names the
  cell. With `"control"`, one button or link takes the cell's focus,
  its Enter and Space its own. With `"composite"`, Enter or F2 moves the
  focus to the cell's first control, keys are the controls' until Escape
  goes back to the cell, and Tab leaves the grid. Presses on controls are
  theirs: the grid neither selects nor reports a click. A disabled or
  hidden control is passed over; with none left, the cell takes the focus.
- **Errors.** A view that throws is reported once (`reportError`), and its
  cell writes its text until it leaves the column; the rest of the grid
  draws on.
- **Frameworks.** A renderer with `framework` instead of `create` is a
  framework adapter's: in each draw the grid hands it the cells to draw
  and the hosts to let go of, and shows each cell's text until it says
  the cell's content is drawn. React, Vue, and Svelte have no cells yet.
- Pivot grids take no renderers: their rows are combinations, not
  records.

**Columns without fields** have an id and write their `text`: literal
text and fields written through their displays (`["Open ", { field:
"trace" }]`). A renderer draws more where `cells` gives one, and the text
then names its cells for screen readers and is the renderer's
`cell.text`. They take looks, but no sort, format, aggregate, or kind;
remote grids ask the source for the fields their text reads.

```ts
const model = createGridModel({
  data: rowView(requests),
  columns: [{ field: "trace" }, { id: "open", title: "", text: ["Open ", { field: "trace" }] }],
});
createGrid(element, {
  model,
  ariaLabel: "Requests",
  cells: {
    open: {
      interaction: "control",
      fields: ["trace"],
      create(host) {
        const button = host.ownerDocument.createElement("button");
        button.textContent = "Open";
        host.append(button);
        let trace: string | null = null;
        button.addEventListener("click", () => openTrace(trace));
        return {
          update(cell) {
            trace = cell.read("trace");
          },
        };
      },
    },
  },
});
```

## Linking a grid and a chart

A grid and a chart over one table, each with a view of its own: the grid's
selected rows restrict the chart, and the chart's brush filters the grid.

```ts
import { col, createChart, point, rowView, selectionStore } from "herceg";
import { createGrid, createGridModel } from "herceg/grid";

const store = selectionStore(requests);
const gridRows = rowView(requests);
const chartRows = rowView(requests);
createGrid(gridElement, { model: createGridModel({ data: gridRows, columns, selectionStore: store }), ariaLabel: "Requests" });
const chart = createChart(chartElement, {
  marks: [point(chartRows, { x: "time", y: "latency" })],
  interaction: { brush: "x" },
});

store.subscribe(() => {
  const picked = store.get("grid-rows");
  chartRows.restrict(picked?.kind === "rows" ? picked.rows : null); // none selected: all rows
});
chart.on("select", ({ selection, phase }) => {
  if (phase !== "commit") return;
  const x = selection?.kind === "brush" ? selection.x : null;
  gridRows.setQuery({ ...gridRows.query, filter: x ? col("time").ge(x[0]).and(col("time").le(x[1])) : true });
});
```

How they link is the application's choice; nothing filters automatically.
To highlight rather than filter, bind charts and the grid to one channel
instead ([Selected rows](interaction.md#selected-rows)).

## Grouped rows

Given [row groups](data.md#row-groups) as `groups`, the grid shows a
header row per group, followed when expanded by the groups of the level
below or, on the last level, by its rows.

```ts
import { bar, count, groupRows, mean, rowView } from "herceg";

const view = rowView(requests);
const traffic = groupRows(view, { by: ["region", "service"], ops: { n: count(), latency: mean("latency") } });
const model = createGridModel({
  data: view,
  groups: traffic,
  columns: [
    { field: "service" },
    { field: "region" },
    { field: "time" },
    { field: "latency", aggregate: "latency", format: { maximumFractionDigits: 1 } },
  ],
});
bar(traffic.tableOf("region"), { x: "region", y: "latency" }); // the same groups, charted
```

- A header names its group and counts its rows ("api (1,204)"), indented
  by level. A grouping field's column shows the key; a column with an
  `aggregate` shows the group's value.
- Groups start collapsed. `model.setExpanded(["eu", "api"], true)`,
  `expandAll()`, and `collapseAll()`; expansion is kept by key as rows
  stream and through resets.
- Clicking a header sorts each group's rows by its field, and groups among
  their siblings by the column's aggregate (or key, for grouping fields).
  `model.setGroupSort` orders groups by any field of the groups' tables.
- Selecting a header selects every row of the group the view shows; its
  checkbox is mixed when some are (`model.selectionState(i)`). Rows
  appended to a group later are not selected.
- `model.row(i)` tells a group header (`kind: "group"`) from a table row
  (`kind: "row"`); each has a `version` and a `ref` that
  `model.indexOf(ref)` finds again.

## Pivots

A [row pivot](data.md#row-pivots) shows in a grid from `herceg/grid/pivot`,
which grids without one never load.

```ts
import { createPivotGrid, createPivotGridModel } from "herceg/grid/pivot";

const model = createPivotGridModel({
  data: traffic, // pivotRows(view, { rows: "region", pivot: "status", ops: { n: count(), latency: mean("latency") } })
  fields: { latency: { format: { duration: "millisecond" } }, status: { mappings: [{ value: "503", text: "Unavailable" }] } },
  rowColumn: { title: "Region", width: 100 },
  aggregates: { latency: { title: "Latency" }, n: { title: "Requests" } },
});
createPivotGrid(element, { model, ariaLabel: "Requests by region and status" });
model.pinColumn("region", "left");
```

- A row per pivot row; columns for the rows field, each value and
  aggregate, and the totals. With several aggregates, a header row of
  values spans their aggregates' columns.
- **Field displays** (`fields`, as other grids take them) title the rows
  column by its field's label and write its keys, head each pivot value's
  columns by its text ("Unavailable"; the columns' ids keep the raw
  value), and write an aggregate of a field that keeps its kind (a `min`,
  `max`, `mean`, or `sum` of numbers; a `min`, `max`, or `mean` of times)
  in the field's format, without its mappings. Counts and aggregates that
  change the kind are plain numbers; aggregates' titles stay their `title`,
  else their name. `model.update({ fields })` takes new ones.
- **Formats**: `rowColumn.format` and each aggregate's `format` take every
  form for their kind, over the field's display; `valueFormat` writes the
  pivot field's values (numbers or times) over their columns, over its
  display's format.
- Absent combinations are blank; a missing value is empty unless its
  field's display gives missing text, and a missing key reads "(missing)",
  or its field's missing text.
- Generated columns take the usual commands by id, with full titles
  ("api, Latency") as their accessible names. A value streaming in later
  gets columns of its own without moving the columns in view.
- Clicking a header sorts the rows by its column (absent and missing last),
  without touching the view's order.
- Selecting a row selects its rows of the view, so a chart restricted to
  them shows them.
- A pivot that stopped at its limit says so in a notice under the grid.

## Remote grids

`herceg/grid/remote` shows rows that live elsewhere: a database behind an
API, or a table served from a worker. The page holds the rows in view and
a few around them; filters, sorts, and groups run where the data is.

```ts
import { createRemoteGrid, createRemoteGridModel } from "herceg/grid/remote";

const model = createRemoteGridModel({
  source,
  query: {
    filter: ["==", ["field", "status"], "error"],
    sort: [{ field: "time", order: "descending" }],
  },
  columns: [{ field: "time", format: { timeStyle: "medium" } }, { field: "service" }, { field: "latency" }],
});
createRemoteGrid(element, { model, ariaLabel: "Failed requests" });
```

Columns take the same [formats](#formats), and the model the same
[`fields`](#field-displays) and `update`, as local grids: rules naming a
table match the source's name.

**The query** (`GridQuery`) is plain JSON a server can run: a version (1),
the source's name, a filter (a portable expression, as `col(...)`
builds), sort keys, and optional groups with aggregates (`count`, `sum`,
`mean`, `min`, `max`). Layout and user state stay in the model.
`validateGridQuery(query, schema)` checks one and refuses unknown
properties. Its semantics are the local grid's: missing values sort last
both ways, labels by UTF-16 code units, ties by the source's key; times are
epoch ms, and queries cannot bin them.

**The source** (`GridSource`) has a `schema` (field kinds and a unique,
unchanging key field) and answers `rows(request, signal)`: `limit` rows or
groups from `offset` under a parent group's key path, as typed columns
(`Float64Array` numbers and times with NaN missing; categories as codes
into a window dictionary), with the total.

- **Snapshots.** A query's first request has `snapshot: null`; the answer
  names a snapshot later requests ask for, so rows do not shift between
  windows while data changes. The grid calls `release` for each snapshot
  it stops reading. A source that cannot keep one rejects with
  `GridSourceError("snapshot-expired")`.
- **Stale answers** (old revisions, windows, or groups no longer shown) are
  dropped and their requests aborted through `signal`.
- **`locate`**, if the source has it, lets the focus follow its record to a
  new query.

A source over HTTP, with the server sending columns as JSON arrays:

```ts
import { type GridSource, GridSourceError, type WindowColumn } from "herceg/grid/remote";

type Values = readonly (number | string | null)[];
const numbers = (values: Values) => Float64Array.from(values, (v) => (v === null ? Number.NaN : +v));
function labels(values: Values): WindowColumn {
  const dictionary = [...new Set(values.filter((v) => v !== null).map(String))];
  return { codes: Int32Array.from(values, (v) => (v === null ? -1 : dictionary.indexOf(String(v)))), dictionary };
}

const source: GridSource = {
  schema: {
    source: "requests",
    version: "3",
    fields: { id: "number", time: "time", service: "category", latency: "number" },
    key: "id",
  },
  async rows(request, signal) {
    const response = await fetch("/api/rows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
    const body = await response.json();
    if (!response.ok) throw new GridSourceError(body.code ?? "unavailable", body.message);
    const kinds = this.schema.fields as Record<string, string>;
    const columns = Object.fromEntries(
      Object.entries(body.columns as Record<string, Values>).map(([field, values]) => [
        field,
        kinds[field] === "category" ? labels(values) : numbers(values),
      ]),
    );
    if (body.kind === "rows") return { ...body, columns };
    return { ...body, columns, rowCounts: numbers(body.rowCounts), childCounts: numbers(body.childCounts) };
  },
};
```

| Entry | Gives |
| --- | --- |
| `herceg/grid/memory` | `memorySource(table, { key: "id", latency: 20 })`: a source over a Herceg table that answers as a server would, for tests, trials, and workers. |
| `herceg/grid/conformance` | Fixtures a server must answer alike (missing values, string order, times, group sorts, pagination within a snapshot), and `checkGridSource(driver)` to run them. |

**Loading.** Rows not loaded are placeholders ("Loading…", `aria-busy`).
Failures are announced, with a notice offering to retry (`model.retry()`;
`model.refresh()` reads the query again). `model.status` says what is
loading, what failed, and what is cached.

| Model option | Default | Means |
| --- | --- | --- |
| `blockSize` | 128 | Rows per request. |
| `maxRequests` | 2 | Requests at a time. |
| `cachedBlocks`, `cacheBytes` | 16, 8 MiB | Blocks kept besides those in view. |
| `settleDelay` | 50 ms | Wait while a scrollbar is dragged far (asking at least every 150 ms). |
| `maxExpanded` | 256 | Groups expanded at once. |

**Selections** are keys or conditions, never positions, in a
`RemoteSelectionStore` (`remoteSelectionStore(schema)`): clicks select by
key; Shift ranges need every row between loaded; Ctrl+A selects the
query's filter as a condition; a group header selects rows matching the
group. `selectionCondition(selection, key)` turns a selection into a filter
a server can run; `model.selectedCount` is null for conditions.

**Groups** are asked for as they expand (`setExpanded(key, true)`); headers
read row counts and aggregates from the source (a column's `aggregate`
naming the query's `as`). There is no `expandAll`.

## Accessibility

- A grid is one tab stop (`role="grid"`; `role="treegrid"` when grouped).
  Arrows, Page Up/Down, Home/End, and Ctrl+Home/End move the focus,
  scrolling the cell into view.
- Space toggles the focused row's selection, Shift+arrows extend it,
  Ctrl+A (Cmd+A) selects every row, Escape clears; Enter or Space on a
  header sorts by it.
- In grouped grids, a row's first cell stands for the row: Right expands,
  Left collapses or goes to the parent group; Enter on any header cell
  toggles it.
- Sorting, selecting, and column changes are announced. Rows say their
  index and selection; grouped rows their level and place.
- Linked cells' anchors and control cells' controls take the cell's
  focus; a composite cell's controls are entered with Enter or F2 and left
  with Escape ([Cells](#cells)). A cell holding the focus in its content
  is outlined as a focused cell is.
- Kinds' drawing is hidden from screen readers: bars, chips, and symbols
  read as their text.
- Forced-colors mode uses system colors; cells drop their looks, and
  chips their fills, their text the row's.

## In React

`<Grid>` from `@herceg/react/grid` shows a model the application makes and
owns; data, scrolling, focus, selection, sorting, and column layout go
through the model, never through React.

```tsx
import { rowView } from "herceg";
import { createGridModel } from "herceg/grid";
import { Grid } from "@herceg/react/grid";

function Requests({ data }: { data: typeof requests }) {
  const model = useMemo(
    () => createGridModel({ data: rowView(data), columns: [{ field: "time" }, { field: "latency" }] }),
    [data],
  );
  return <Grid model={model} ariaLabel="Requests" style={{ height: 400 }} />;
}
```

A new `model` makes a new grid; `ariaLabel`, `theme`, and `headerHeight`
change in place. `onRowClick`, `onCellClick`, and `onRender` hear the
grid's [events](#events), the latest handler each time. A model no one keeps stops following its view, so one
made with `useMemo` needs no cleanup. Cell kinds and links come with the
model's columns; `<Grid>` takes no custom renderers yet. Vue and Svelte
have no grid component; call `createGrid` on an element.

## Limits

- Rows have one height (`rowHeight`, 28 pixels by default); columns have
  explicit widths. Rows taller together than 8 million pixels scroll
  scaled (a pixel scrolled moves more than one).
- Not available: column groups other than a pivot's values, sizing columns
  to content, moving columns by touch (the menu moves them), editing,
  copying, custom renderers in React, Vue, and Svelte, and in pivot grids.
  Remote grids have no pivots and no bins in queries.
- Custom renderers update every mounted cell of their columns when any row
  of a local grid's table changes, as a table's rows share one version.
- Only mounted rows are in the DOM, so text selection, the browser's find,
  and screen readers reach only those. Announcements are in English, and
  grids have not been tried with screen readers themselves.
- Firefox drops the levels of grouped rows (it ignores `aria-level` in
  grids that number their rows).
- Grids are not part of the portable spec, so Python and payloads do not
  carry them.

Benchmarks against TanStack Table, AG Grid, and Glide Data Grid are in the
[comparison](../comparison.md#grids).
