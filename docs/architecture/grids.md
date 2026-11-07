# Grid architecture

How `herceg/grid` keeps state, follows streaming rows, virtualizes the
DOM, and loads remote rows. For using grids, see the
[Grids guide](../guide/grids.md).

- [The model](#the-model)
- [Columns](#columns)
- [Grouped rows](#grouped-rows)
- [Pivots](#pivots)
- [Headings and the totals row](#headings-and-the-totals-row)
- [Selection](#selection)
- [The DOM grid](#the-dom-grid)
- [Remote grids](#remote-grids)
- [Export and copy](#export-and-copy)

## The model

A grid's state lives in a DOM-free model (`grid/model.ts`, also the entry
`herceg/grid/model`; what it shares with the remote model is in
`grid/base.ts`), in three parts kept apart:

| Part | Owner | Holds |
| --- | --- | --- |
| Query | The row view | Filter and sort, changed through `view.setQuery` |
| Presentation | The column list and the model's options | Order, widths, pins, hidden columns, formats; field displays (`fields`, changed by `update`) |
| Interaction | The model | Viewport and scroll, focused cell, selection anchor (selected rows live in a `SelectionStore` channel) |

The view, store, and table belong to the application. Several grids share
them with a model each, since a model holds one viewport and one focus.

**Lazy, like views.** Changes to the view, its table, or the store notify
the model's listeners at once; the next read catches up without notifying
again (readers inside listeners would otherwise loop).

**Rows by identity.** Rows are followed by generation and identity
(`Table.identity`), found again with `RowView.indexOf`, exact because sorted views
break ties by position. Catching up after a change of the table, but not of
the query (`RowView.queryRevision`), puts the top row back where it was, so
rows dropped from a rolling window or sorted in above do not move the rows
in view. A new query, a reset, or a top row gone keep the pixel offset. The
focus keeps to its row; when the row leaves it goes to the row now at its
index.

**Formatting** writes values through one writer per column, made once
from the column's format, in any form axes take (Intl formatters are
cached by `format/format.ts`, patterns by `format/patterns.ts`), and keeps
no strings. Formats are checked against the field's kind as columns are
described, naming the column's path. A grid given field displays
(`fields`) asks them for each column's display instead (`columnDisplay`,
`fields/grid.ts`): its title, description, cell text, key text, aggregate
text, and link. The display code (rules, checks, format writers) is part
of the grid core, since a model writes cells synchronously: rules given to
a model are compiled when it is given them (`fields/compiled.ts`), and a
`compileFields(rules)` result is taken as it is, so grids and charts can
share one compilation. A category column's texts are kept per dictionary
entry, written the first time a cell shows the entry (a `WeakMap` keyed by
the dictionary, reset by its compaction revision), so a mapping runs once
per category value shown, not once per drawn cell.

`model.update({ fields })` makes what every column shows with the new
displays (`restyle`: for a pivot, its generated columns too) before it
changes anything, so a refused update leaves the model as it was; the
column list, sort, groups, selection, focus, and scroll are kept, and
listeners are told once.

**Looks** (`grid/looks.ts`) are compiled by the channel code charts use
(`encoding/`), so a grid's channels take every form a mark's colors take;
the grid model imports nothing of marks. They are compiled once per change
of columns, groups, scales, displays, or encodings, against each table
cells read: the records (`encode`), each group level's table
(`aggregateEncode`, levels above the last keeping only the entries whose
fields they have), a pivot's long table and rows' totals, and for remote
grids each block's window, cached per window. Nothing is kept per row: a
look is read when a cell is written, through the channel's reader for the
table's version (a category field's outputs per dictionary code). The
grid's scales (`LookScales`) are shared by every table: a channel scale's
domain spans every (rows, field) read through it, rank tests rank the
records (in a pivot, each value's column), and both are brought up to
date before cells are read, once per display the model makes, never while
reading. `looksRevision` counts changes of what looks were compiled from,
domains, and ranks' nth values, so the DOM grid writes looks again only
when it moves. A palette place is `var(--hg-palette-N)`, which the DOM
grid resolves from its theme, so models hold no theme. Updates compile the
new looks before anything changes, as `fields` do.

Models are held weakly by what they follow, so a model no one keeps stops
on its own; `dispose()` stops it at once.

## Columns

The column list is the one record of the layout, keyed by column id.
`resizeColumn`, `moveColumn`, `pinColumn`, and `setColumnVisible` replace
one entry or reorder the list; `model.columns` returns it for
`setColumns`.

- What a column shows (title, alignment, formatter, reader, link, kind,
  and the fields they read) is made when columns are set and kept by the
  commands. A column without a field writes its `text` parts through
  their fields' displays, and has a null field and kind in the layout. Placing columns is one pass
  (O(columns)), and the DOM grid sees by identity that no cell text needs
  writing when columns only move, resize, pin, or hide.
- Shown columns are placed pinned left, unpinned, pinned right, each in the
  list's order, so unpinning returns a column to its place.
- **Holding pins.** Pinned columns are held at their edges while they leave
  the others 120 pixels (`MIN_SCROLLING_WIDTH`); otherwise they let go
  (`pinned: null` in their layout entries) and scroll with the rest until
  the grid widens. This is the layout's only dependence on the viewport,
  so a resize places columns again only when it crosses that line. Held
  columns take no part in horizontal scrolling.

## Grouped rows

Grouped grids (`grid/grouped.ts`) show [row
groups](data.md#row-groups) as header rows followed, when expanded, by the
level below or the group's rows.

- **Expansion** is the set of group ids (key paths) expanded otherwise than
  by default, so it survives streaming, resets, and collapsed ancestors.
  Ids of groups gone are forgotten once they outnumber the groups present.
- **The display** is parallel arrays (each header's group, depth, row index
  as `Float64Array` prefix counts, and place among siblings), with a rank
  per group and level. A row index finds its header by binary search and a
  table row as an offset past it; no object stands for any row.
- Rebuilding fills arrays for every group (O(groups)) but visits, reads
  expansion of, and sorts only groups shown; collapsed groups' children are
  neither sorted nor visited.
- Expanding or collapsing keeps the top row in place. While rows stream
  into an expanded grid, its groups' rows are kept current rather than
  listed again.
- **Selected counts** per group are counted once per selection and change
  of the groups' rows (a pass over the row set, finding each row's last
  level group, then summing up the levels). Appends leave counts of row
  sets alone, and the model's own clicks adjust the counts they change.

## Pivots

A pivot's grid (`grid/pivot.ts` and `dom/grid-pivot.ts`, in
`herceg/grid/pivot`) is a grid model whose groups are the pivot's, one
level deep and never expanded. The model takes the pivot through a small
interface (`GridPivot`: generated columns, their revision, the crosstab's
fields, and the table cells read rows from), so `herceg/grid` holds none
of it.

- When the pivot's values change, columns are generated again and laid out
  from the column list by id. New values' columns go in column order, or
  after the user moved columns, before the next column in column order; the
  first scrolling column in view keeps its place on screen. Layout given
  for columns not generated yet waits for them.
- Sort keys name the crosstab's fields and order the rows without touching
  the view's order.
- **Header rows** (`HeaderRows`): a row of values over their aggregates'
  headers, each value spanning a run of adjacent shown columns at the same
  edge, so values parted by pinning get a header each. Only headers over
  mounted columns are mounted, with logical `aria-colindex` and
  `aria-colspan`.

## Headings and the totals row

**Headings** are part of a column's description (`heading`: a title,
`{ id, title }`, or a path of them from the top), checked as columns are
set: one id has one title at a level across the list. Headers over them
are runs of adjacent shown columns whose paths agree by id at that level
and every level above, found over every shown column, so the header rows
do not change as the grid scrolls (`dom/grid-headings.ts`). A column moved
out of its run, or held at an edge apart from its neighbors, has a header
of its own. Only headers over mounted columns are mounted, with logical
`aria-colindex` and `aria-colspan`, and the rows count in `aria-rowcount`.
Columns' own headers are named with their headings ("Latency, p99").

**The totals row** is one reader shared by the local and remote models
(`totalsRow` in `grid/base.ts`): given where totals come from (a
`TotalsSource`: a key that moves with them and with looks, their state, a
writer per column, a value and a look per column), it gives the row's
`version`, state, and each cell's text and look, keeping a writer per
column for one layout and set of totals. "Total" goes in the first shown
column without a total, so it moves as columns move, pin, or hide. A local
grid's totals are `rowTotals` of its view, or the grand total of its
groups (their own one-group level, never a sum of groups' sums); a pivot's
are its totals row. Looks come from `aggregateEncode` compiled against the
totals' table, as group rows' do; a pivot's totals row reads each value's
column's totals through a table per value that holds the pivot field, so
its rules match the cells above, and its fills join the domains of the
cells above. The DOM grid draws the row in a footer rowgroup, sticky at
the bottom of the scroller, through the same cell writer as body and group
rows, rewriting cells only when the row's version, the columns, or the
theme move. Its `aria-rowindex` follows the rows once their count is
known. Focus moves to it and back like any row and stays on it as rows
stream; it is never selected.

## Selection

Selection commands write a `RowSet` into the store's channel. Toggles and
ranges change the set the model last put there while the channel still
holds it and the table was not reset; otherwise they start a new set from
the channel's rows, evaluating a condition once. Ranges are the view's
positions between two places, added in one pass (`RowSet.addAll`). A
condition in the channel shows as selected rows, compiled once per change
and counted after commands, not per frame.

A plain click goes through `model.click(rowIndex)`: it selects the row
alone, or with `selection: { click: "toggle" }` clears the selection where
the row is all of it (`selectedAlone`: one row, or a group's header whose
rows are the whole selection; for a remote model, a record's key alone, or
a group's scope).

**Revision.** `model.revision` counts the notifications the model sends
its listeners (a batch of commands counts once), so it changes exactly when
what the grid shows may have.

## The DOM grid

`dom/grid.ts` is a scroll container (`role="grid"`) holding a sticky header
row and a spacer as tall as the rows.

- **Virtualization.** Only rows in view, plus ten above and below, are
  mounted, each with the cells of columns in view and two more each side.
  Nothing is pooled beyond them.
- **Identity.** A mounted row follows its row's ref and a cell its column's
  id. Rows still shown keep their elements, so rows moved by a rolling
  window or sort move without rewriting text; text is written only for
  newly shown rows, after an in-place table change (`modifiedVersion`), or
  for new columns. Elements of rows that left are reused for rows that
  entered, moved into place so the DOM order is the display order screen
  readers follow.
- **Pinned cells** are in the row's flex flow with `position: sticky`, so
  the browser holds them with no frame of lag; other cells are placed
  absolutely and scroll under them. Pinning duplicates nothing: each row is
  one element with its cells in display order and logical `aria-colindex`.
  A 1200 × 600 grid of 100k rows by 20 columns mounts 588 cells in 42 rows
  with or without three pinned columns.
- **Header gestures** (`dom/grid-columns.ts`): a press moving more than
  4 px drags, with the pointer captured; resizes apply once a frame, moves
  commit on release, Escape restores. Touches on headers scroll. The column
  menu (`dom/grid-menu.ts`) is a WAI menu calling the same model commands,
  each checked again when chosen.
- **Tall grids.** Browsers lay out boxes up to about 33.5 million pixels
  (Firefox 17.9 million), Chrome stops drawing one-pixel lines past 2^24,
  and single precision keeps half pixels exact only below 2^23. The spacer
  is therefore at most 8 million pixels; taller rows scroll scaled. Each
  frame pairs the scroller's offset with the model's top it stands for, so
  the grid's own scrolling keeps exact targets and only the user's offsets
  map by the ratio. Scrolled scaled, rows the browser scrolls natively
  land in the wrong place, so a frame the grid draws first takes the
  scroller's offset where it moved since the last scroll event: an offset
  a script set in the frame's callbacks (synced or animated scrolling)
  shows in that frame, not the next.
- **Focus** follows the WAI grid pattern: one tab stop, held by the focused
  cell when mounted, else by the grid. While focus is inside, the focused
  cell is never recycled: its row stays mounted outside the window, clipped
  by the spacer (`overflow: clip`). Grouped grids are tree grids with
  `aria-level`, `aria-posinset`, `aria-setsize`, and `aria-expanded`; a
  header's first cell holds a checkbox, since `aria-selected` has no mixed
  value.
- **Styling.** Theme tokens become custom properties on the grid's root,
  read by one stylesheet each grid carries, so grids in shadow roots are
  styled. A cell's look is custom properties and `data-look`, written
  only where they differ. Text over a fill takes black or white by WCAG's
  relative luminance of what it lands on (the fill composited over the
  surface, under the selection's tint in selected rows) against the
  crossover of 0.1791. The grid works both inks out for fills it parses,
  cached by fill and theme; fills only the page reads (CSS variables,
  color names) take CSS relative colors over the channels the theme gives
  as numbers, so they follow the page, at a higher style cost. Forced
  colors drop looks. Frames go through the shared scheduler; grids out of
  view wait.
- **The cell host** (`dom/grid-cells.ts`) is what a cell element holds
  besides its text: a linked cell's anchor, a kind's view
  (`grid/cells.ts`), or a custom renderer's view in a host element. A
  view belongs to the element while it shows its column: created when the
  element is first given it, updated as it shows other rows (or its row's
  version, look, selection, or index moves), and destroyed when the
  element leaves the column, shows a row of another kind, the renderer is
  replaced, or the grid goes. Cells of columns drawing text alone take
  none of this path. Each update has an `AbortController`, and a reader of
  its row's values bound to the record (`rowValues`: by identity in a
  local table, by the window it arrived in for a remote grid), so a sort
  before the next draw does not move what `read` reads; the reader goes
  just before the signal aborts. Contexts copy a row's ref as `{ scope, id }`
  (which `indexOf` still finds) and give a column's layout without what it
  draws with, so contexts a renderer keeps hold no remote blocks, table,
  grid, or model. A view that throws is reported once and its cell writes
  its text. A draw a renderer asks for while one runs is the next frame's.
  A renderer's `create`, `update`, `destroy`, or abort listener that
  changes the model or destroys the grid stops the draw, and the next
  frame writes every mounted cell again; a destroyed grid takes no
  updates.
- **Cell kinds** are descriptors (`barCell()`): a frozen portable `spec`,
  and through a symbol-keyed property an implementation whose model part
  checks the field's kind and binds what the kind reads of the rows (a
  bar's domain, a sparkline's index), and whose DOM part, run only when a
  cell mounts, reaches the page only through the element it is given.
  What a kind reads moves a revision per column (`cellsRevision(column)`),
  by which the DOM grid redraws that column's mounted cells alone, so a
  sparkline's data streaming in updates no other column's custom or
  framework cells. Views are given the column's layout and the row height; a kind
  drawing to its cell's size (`sized`) is redrawn as its column's width
  changes, without a revision. Chips' text
  takes black or white as cells' text over fills does, over the chip on
  the cell's fill, in plain and selected rows. A kind's
  stylesheet, and the host's for links and renderers, are added to the
  grid's root as the first such cell mounts, so grids without them match
  none of their rules.
- **Sparklines** (`grid/sparklines.ts`) describe a column without a field
  through their kind's `describe` hook: the column's content gets a
  `Sparkline` of the grid and the data, which checks the key, x, and y
  fields of both tables, and gives the cell's text (its summary), its
  read (`cellAt`'s `sparkline`), and its paths. On the first read after a
  change it buckets the data's rows by key (`grid/sparkline-index.ts`: a
  counting sort into a map of keys, each bucket's start, count, and room,
  and the rows as table positions in x order in one array: about 4 bytes
  a row and 40 a key). Appends, which the table reports by an unchanged
  `modifiedVersion`, `generation`, and `rowOffset`, are taken in as the
  data's listener runs, so no read or frame finds the index half
  updated: each new row goes into its bucket's room, a full bucket moves
  to the array's end with a quarter more, a full array lays every bucket
  out again with a quarter more and an eighth spare (up to ~5.6 bytes a
  row and 36 a key; a category key's code-to-bucket cache adds 4–8 bytes
  a label of its dictionary), and buckets the new rows put out of x order
  are sorted again. Other changes, and a view's, build it again on the
  next read. When cells drew since the previous change, a microtask after
  the changing task makes the summaries and paths of the keys drawn last
  (at most 256) in the box they were drawn in, so the next frame only
  writes them. A row's series is read between binary searches for the window's ends,
  with the rows either side for the lines crossing them, and reduced by
  `lod/m4-joined.ts`: charts' M4 per device pixel column, with gaps inside
  a column joined so a path is at most four points a pixel and one break
  a pixel boundary. Paths are charts' (`traceLine` into `SvgPath`, a
  tenth of a pixel). The base model has each sparkline follow its data
  while the column is the model's: the data holds the sparkline weakly
  (a `FinalizationRegistry` stops a forgotten one), and replacing the
  columns or `dispose()` stops it and lets go of its index at once.
- **Framework cells.** A renderer with `framework` is handed its cells in
  each draw, after DOM renderers' updates and before the focus is placed:
  at once in the grid's own frame and on the first draw, in the next
  frame for draws called from code (a framework's render). Each cell shows
  its text, its host laid out unseen, until the framework acknowledges
  that update's content
  (`drawn`, by generation: an update superseded makes its acknowledgement
  stale, and once the view goes one reaches nothing), and a focused cell's
  controls are taken out of the tab order but the one its focus gives,
  which takes the page's focus where the cell had it, unless the user has
  taken it elsewhere. Every host a framework lets go of reaches it once:
  destroying the grid hands each framework its hosts, those of batches
  not yet handed too. The adapters' grids draw their cells through it,
  keyed by host and row ([React, Vue, and
  Svelte](../guide/frameworks.md#grids)): React's (`@herceg/react/grid`)
  as portals into the hosts, committed with `flushSync` in the grid's
  frame and as state set in the layout effect that makes the grid; Vue's
  (`@herceg/vue/grid`) as teleports, committed by Vue's flush in the
  microtask after the frame's callback, before paint, and acknowledged
  from each cell's mounted or updated hook; Svelte's
  (`@herceg/svelte/grid`) as a component mounted into each host with the
  grid component's contexts, committed with `flushSync` in the grid's
  frame and acknowledged from an effect after the content's own.
- **Events** (`grid.on`): `rowClick` and `cellClick` name the row by the
  model's `GridRef`, taken before the click selects (listeners of the
  selection may move or restrict rows), and give its index after; Enter on
  a body cell reports `cause: "keyboard"`. `render` reports the model's
  revision after each frame drawn, built only while it has a listener.
  Listeners that throw are reported (`reportError`); the others still run.
- `destroy()` unschedules the grid, undoes a drag under way, closes its
  menu, and removes listeners, observers, and elements.

## Remote grids

The remote model (`grid/remote.ts`, `RemoteGridModel`) and the local one
subclass one base (`BaseGridModel`) holding what does not depend on where
rows are: columns, viewport and scroll, focus and range anchor (by ref),
and listeners. Each model provides rows through a few synchronous methods;
nothing asynchronous reaches the base or the DOM grid. Loading and failure
states reach the DOM grid through a small hook (`GridExtras`, from
`dom/grid-remote.ts`), so `herceg/grid` holds no remote code.

**The query** (`grid/query.ts`) is versioned JSON checked against the
source's schema. It reuses `Expression`, the groups' aggregate operations,
field kinds, and `data/order.ts`'s sort order, with ties by the source's
key so pages of one snapshot fit together. Its grouping has the same
semantics as `groupRows`. It is separate from the chart spec. Queries have
no bins, since a fixed step cannot be a local calendar day.

**The protocol** (`grid/source.ts`). A request names `offset`, `limit`, a
parent's key path, the fields wanted, the query revision, the schema
version, and the snapshot (null for a query's first request, which starts
one). Answers are windows of typed columns with the parent's total; group
windows add row and child counts. The model checks every answer against
its request (lengths, kinds, codes within the window dictionary, totals
that never change within a snapshot, unique keys) and keeps only current
answers; others are dropped and their requests aborted. Key paths cross
JSON with infinities spelled out (`encodeGroupPath`). Windows viewing a
much larger buffer are copied, so the cache cannot hold a source's arrays.

**The tree of lists.** The model holds the answer as sibling lists: the
query's rows or first-level groups, and under each expanded group its
list. A list has its total (or how far it has been read, while unknown),
its loaded blocks (128 rows, aligned), and its expanded children with
prefix sums of the rows they show. A row index finds its list by a binary
search per level; an unloaded run is one range, with nothing kept per row.
Refs are a list and a place, so focus and the top row follow rows through
expansion and loading.

**Requests** are planned once changes settle (a microtask): blocks in
view, then the focused row's, then one ahead in the scroll direction, two
at a time. Requests more than two blocks from the view are aborted. A jump
waits 50 ms to settle and asks at least every 150 ms; keyboard moves never
wait. The first request of a revision goes alone, so the rest ask for its
snapshot. The cache keeps wanted blocks plus 16 (and 8 MiB), dropping the
farthest first, never a mounted block. The model calls the source only in a
microtask after a command, so neither listeners nor the source ever see a
command half done, and checks again when the microtask comes: a block,
totals, or locate no longer wanted (a revision ended, totals replaced, a
model disposed) is not asked for, and one of a snapshot expired meanwhile
fails as the snapshot's. Ending a revision (a new query, a refresh,
`dispose`) aborts its requests, releases its snapshot (once no export
holds it), and lets go of its blocks and its expiry, so requests the
source never settles hold nothing it read.

**New queries** start a new snapshot and release the old one; the focus
goes to its column's header and back to its record once a source with
`locate` finds it.

**Selections** (`grid/remote-selection.ts`) are keys, or a condition with
keys added and taken out, which a server can run (`selectionCondition`).
Select-all captures the query's filter; a group header selects rows
matching its key path (`groupCondition`). Otherwise a group's state is
counted from records loaded now, claiming "all" only when every record is
loaded and selected.

**Totals.** A remote model with `totals` asks the source for them
(`GridSource.totals`, given the query and the snapshot) after each
snapshot's first answer, and again with a new snapshot; answers are
checked against the request (`checkTotals`: its revision and snapshot,
one value per aggregate), copied (an answer's arrays may view larger
buffers), and dropped when no longer current. While they load or after
they failed, the row's cells are empty and the row says so
(`status.totals`, `data-state`, `aria-busy`); a failure of the totals
alone is announced as theirs, goes with the totals replaced or dropped
(giving back the rows' last failure), and `retry()` asks again. An expired snapshot, whichever request found
it, is kept on its revision apart from other failures: it is the grid's
error (`status.error`) until a refresh, whatever fails after, and no
totals are asked of it. A source without `totals` makes the option fail as
it is given. Looks are checked against the totals' kinds when columns,
totals, or scales are given, and compile against each answer as group
rows' compile against each window.

**The reference source** (`grid/memory.ts`) runs queries with the local
grid's row views and groups, a snapshot being a view of the table that
expires when the table changes. The conformance fixtures
(`grid/conformance.ts`) are worked out by hand from these semantics and
checked against it.

## Export and copy

**Reading.** `exportGrid` (`grid/export.ts`) and copy (`dom/grid-copy.ts`)
read models through members keyed by symbols no public entry exports
(`grid/export-rows.ts`), so models gain no public methods and only small
accessors load with every grid. `[EXPORT_ROWS]` gives what an export
reads, captured synchronously as it starts; the reading itself loads with
`exportGrid`. A local model gives its table, view, snapshot of positions,
grouped projection, pivot, layout, settings, and totals; the local reader
(`grid/export-local.ts`) copies the rows' positions where the view orders
or filters them, and the selection's members in the view's order (4 bytes
a row), computes the totals row's cells, and records the table's generation, offset, writes
(`writesOf`), and `modifiedVersion`, the view's query revision, and the
groups' or pivot's revision. Before each chunk and before it resolves it
compares them: appends leave an ungrouped projection of records to go on
(positions start at the table's first row, which only drops move;
in-place writes and inserts move `modifiedVersion`). Sparkline columns'
data are checked by their revision. It refuses to start inside a
transaction that has written to the table, as the table itself says
(`untold`), whenever the model was made: the table's rows are changed,
but its groups and totals follow only once listeners hear.

**Remote exports.** The remote model captures its query, revision,
snapshot, fields, expanded groups, layout, settings, and the totals
answer it holds, and takes a hold on the snapshot (`Revision.holds`):
ending the revision releases the snapshot only once no export holds it.
The reader (`grid/remote-export.ts`, loaded on the first remote export)
walks the lists depth first through the groups expanded at the start,
asking for blocks of that snapshot (its own, released when it ends, where
the grid had none yet: claimed as its first answer comes, before it is
checked) with at most two requests in flight, those asked ahead and those
it waits for alike, checking each answer as the grid checks windows, and
each list's total against its other answers, the rows they hold, and the
group's child count. It keeps its own place and windows (copied where
they view a larger buffer, as the grid's blocks are), never the grid's
lists or blocks, so scrolling, collapsing, or a new query change nothing
it reads. It asks for the totals (where the grid had not read them) as
it first reads, not as it is made. Ending it aborts its requests, ends
those waiting for a place without asking them (those out may never
answer), and releases its hold; `exportGrid` stops waiting at once
when its signal aborts, whatever the source does with it, and closes a
reader that loads after.

**Writing.** Readers fill a row's cells and which are plain numbers (raw
numbers and times, never escaped); the writer quotes fields as RFC 4180
asks, escapes formulas (`grid/delimited.ts`: a leading tab or line
break, or `=`, `+`, `-`, `@` after any controls, format characters, and
spaces importers drop or trim, unless the text is wholly a number in the
locale's format, built from `Intl.NumberFormat`'s parts), and turns each
chunk's text into a `Blob` part, yielding (`scheduler.yield`, else a
message) after ~8 ms or 1M characters. The `Blob` is made of the parts.

**Copy** listens for `copy` on the document (Firefox fires it at the body
when nothing is selected) and acts when the grid holds the page's focus,
nothing is selected on the page, and the focus is not in a cell's
controls: the nearest grid copies, so grids in grids copy their own. It
reads at most `maxCells` cells (`[COPY_ROWS]`: the local selection's
positions in the view's order, found by a pass over the view's snapshot
that stops past the limit; the remote one's keys, each found loaded), writes
TSV with the export's field writer, and sets `text/plain` in the event,
announcing the outcome in the grid's live region.
