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
| Presentation | The column list | Order, widths, pins, hidden columns, formats |
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

**Formatting** reads values through one Intl formatter per column, made
once (`format/format.ts` caches them), and keeps no strings.

Models are held weakly by what they follow, so a model no one keeps stops
on its own; `dispose()` stops it at once.

## Columns

The column list is the one record of the layout, keyed by column id.
`resizeColumn`, `moveColumn`, `pinColumn`, and `setColumnVisible` replace
one entry or reorder the list; `model.columns` returns it for
`setColumns`.

- What a column shows (title, alignment, formatter, reader) is made when
  columns are set and kept by the commands. Placing columns is one pass
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
  map by the ratio.
- **Focus** follows the WAI grid pattern: one tab stop, held by the focused
  cell when mounted, else by the grid. While focus is inside, the focused
  cell is never recycled: its row stays mounted outside the window, clipped
  by the spacer (`overflow: clip`). Grouped grids are tree grids with
  `aria-level`, `aria-posinset`, `aria-setsize`, and `aria-expanded`; a
  header's first cell holds a checkbox, since `aria-selected` has no mixed
  value.
- **Styling.** Theme tokens become custom properties on the grid's root,
  read by one stylesheet each grid carries, so grids in shadow roots are
  styled. Frames go through the shared scheduler; grids out of view wait.
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
