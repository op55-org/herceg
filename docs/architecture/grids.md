# Grid architecture

How `herceg/grid` keeps state, follows streaming rows, virtualizes the
DOM, and loads remote rows. For using grids, see the
[Grids guide](../guide/grids.md).

- [The model](#the-model)
- [Columns](#columns)
- [Grouped rows](#grouped-rows)
- [Pivots](#pivots)
- [Selection](#selection)
- [The DOM grid](#the-dom-grid)
- [Remote grids](#remote-grids)

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
  bar's domain, kept with a revision the DOM grid redraws mounted cells
  by, `cellsRevision`), and whose DOM part, run only when a cell mounts,
  reaches the page only through the element it is given. Chips' text
  takes black or white as cells' text over fills does, over the chip on
  the cell's fill, in plain and selected rows. A kind's
  stylesheet, and the host's for links and renderers, are added to the
  grid's root as the first such cell mounts, so grids without them match
  none of their rules.
- **Framework cells.** A renderer with `framework` is handed its cells in
  each draw, after DOM renderers' updates and before the focus is placed:
  at once in the grid's own frame and on the first draw, in the next
  frame for draws called from code (a framework's render). Each cell shows
  its text until the framework acknowledges that update's content
  (`drawn`, by generation: an update superseded makes its acknowledgement
  stale, and once the view goes one reaches nothing), and a focused cell's
  controls are taken out of the tab order but the one its focus gives,
  which takes the page's focus where the cell had it, unless the user has
  taken it elsewhere. Every host a framework lets go of reaches it once:
  destroying the grid hands each framework its hosts, those of batches
  not yet handed too.
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
command half done.

**New queries** start a new snapshot and release the old one; the focus
goes to its column's header and back to its record once a source with
`locate` finds it.

**Selections** (`grid/remote-selection.ts`) are keys, or a condition with
keys added and taken out, which a server can run (`selectionCondition`).
Select-all captures the query's filter; a group header selects rows
matching its key path (`groupCondition`). Otherwise a group's state is
counted from records loaded now, claiming "all" only when every record is
loaded and selected.

**The reference source** (`grid/memory.ts`) runs queries with the local
grid's row views and groups, a snapshot being a view of the table that
expires when the table changes. The conformance fixtures
(`grid/conformance.ts`) are worked out by hand from these semantics and
checked against it.
