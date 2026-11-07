// TanStack Table v9 with TanStack Virtual, in production React, following
// the official virtualized rows and columns examples: native core, sorted,
// and filtered row models; stable row ids; fixed-size row and column
// virtualizers (10 rows and 3 columns of overscan); only virtual cells
// rendered. Row objects are the input; appends, evictions, and updates pass
// a new data array that keeps unchanged row objects, the documented way to
// change data. State changes render synchronously (flushSync), as React does
// for a click. Sorting uses the `basic` comparator with missing values
// last; filters are the built-in `inNumberRange` and, for category
// membership (no built-in), a filter function on the column. With looks,
// each cell's style carries its background and text color, from the row and
// a domain kept by adapter code (looks.ts); appends render every row in view
// again, so cells follow the domain. With cells, the cell-bearing columns'
// `cell` renders a React component drawing cells.ts' bars, chips, links,
// and symbols (react-cells.tsx; in the framework cells scenarios, the one with
// state); n4's bar's domain is adapter code, found from the rows at mount.
// With the summary, columns sit in two levels of column groups (`group`),
// whose header rows draw the groups over the columns in view, and a footer
// row sticky at the bottom shows totals adapter code keeps (summary.ts'
// `TotalsTracker`: the table has no totals of its own), rendered again with
// the rows after each change.

import {
  type ColumnFiltersState,
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  type FilterFn,
  filterFn_inNumberRange,
  type ReactTable,
  type RowSelectionState,
  rowSelectionFeature,
  rowSortingFeature,
  type SortingState,
  sortFn_basic,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useRef } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import {
  type Adapter,
  COLUMN_WIDTH,
  GRID_HEIGHT,
  GRID_WIDTH,
  type GridHandle,
  HEADER_HEIGHT,
  type MountOptions,
  OVERSCAN_ROWS,
  ROW_HEIGHT,
  type RowObject,
  readDomVisible,
  rowObjects,
  scrollport,
} from "../adapter.ts";
import { CELL_FIELDS, DOM_CELL_CSS, domContent, extentOf } from "../cells.ts";
import { formatValue, type GridField, type GridTable } from "../fixture.ts";
import { type CellLook, cellLook, type LookDomain, LookTracker } from "../looks.ts";
import { CellView, ReactCell } from "../react-cells.tsx";
import { headingsOf, TotalsTracker, totalText } from "../summary.ts";

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic },
  columnFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { inNumberRange: filterFn_inNumberRange },
  rowSelectionFeature,
});
type Features = typeof features;
type Table = ReactTable<Features, RowObject>;

const helper = createColumnHelper<Features, RowObject>();

const inLabels: FilterFn<Features, RowObject> = (row, id, labels: Set<string>) =>
  labels.has(row.getValue(id) as string);

function columnsFor(
  fields: GridField[],
  cells: { extent: readonly [number, number]; react: boolean } | undefined,
  summary = false,
) {
  const leaves = helper.columns(
    fields.map((field) =>
      helper.accessor(field.name, {
        header: field.name,
        cell:
          cells && (CELL_FIELDS as readonly string[]).includes(field.name)
            ? (info) => {
                const value = info.getValue() as number | string | undefined;
                const props = {
                  field: field.name,
                  value,
                  text: formatValue(field.kind, value),
                  extent: cells.extent,
                };
                return cells.react ? <ReactCell {...props} /> : <CellView {...props} />;
              }
            : (info) => formatValue(field.kind, info.getValue() as number | string | undefined),
        sortFn: "basic",
        sortUndefined: "last",
        filterFn: field.kind === "category" ? inLabels : "inNumberRange",
      }),
    ),
  );
  if (!summary) return leaves;
  // Two levels of groups, as the summary's headings place the columns.
  const parts: { id: string; columns: { id: string; columns: typeof leaves }[] }[] = [];
  leaves.forEach((leaf, f) => {
    const [part, half] = headingsOf(f);
    if (parts.at(-1)?.id !== part) parts.push({ id: part, columns: [] });
    const halves = parts.at(-1)!.columns;
    if (halves.at(-1)?.id !== half) halves.push({ id: half, columns: [] });
    halves.at(-1)!.columns.push(leaf);
  });
  return parts.map(({ id, columns }) =>
    helper.group({
      id,
      header: id,
      columns: columns.map((group) =>
        helper.group({ id: group.id, header: group.id, columns: group.columns }),
      ),
    }),
  ) as unknown as typeof leaves;
}

const CSS = `
.tt-grid{background:#fff;color:#181d1f}
.tt-grid table{display:grid;border-collapse:collapse}
.tt-grid thead{display:grid;position:sticky;top:0;z-index:1;background:#f8f8f8}
.tt-grid tr{display:flex}
.tt-grid th,.tt-grid td{display:flex;flex:none;box-sizing:border-box;padding:0 8px;overflow:hidden;white-space:nowrap;align-items:center}
.tt-grid th{height:${HEADER_HEIGHT}px;font-weight:600;border-bottom:1px solid #ddd}
.tt-grid td{height:${ROW_HEIGHT}px;border-bottom:1px solid #eee}
.tt-grid tr[aria-selected=true]{background:#dbe9fb}
.tt-grid tfoot{display:grid;position:sticky;bottom:0;z-index:1;background:#f8f8f8}
.tt-grid tfoot td{font-weight:600;border-top:1px solid #ddd}
.tt-grid .tt-group{position:relative;height:${HEADER_HEIGHT}px}
.tt-grid .tt-group th{position:absolute;top:0;justify-content:center;border-left:1px solid #ddd}
`;

interface State {
  data: RowObject[];
  sorting: SortingState;
  columnFilters: ColumnFiltersState;
  rowSelection: RowSelectionState;
}

interface GridProps {
  state: State;
  columns: ReturnType<typeof columnsFor>;
  table: RefObject<Table | null>;
  scroller: RefObject<HTMLDivElement | null>;
  /** With looks: the fields' names and the rows' domain. */
  looks: { fields: GridField[]; domain: LookDomain } | undefined;
  /** With the summary: the fields, and each totalled field's total. */
  totals: { fields: GridField[]; values: Record<string, number> } | undefined;
}

/** A row object's value of a looks field: NaN for missing numbers. */
function rowValue(row: RowObject, field: string): number | string | undefined {
  const value = row[field];
  return value === undefined && field !== "c0" ? Number.NaN : value;
}

/** A styled cell's look, from its inline style. */
function styledLook(cell: Element): CellLook | undefined {
  const { backgroundColor, color } = (cell as HTMLElement).style;
  if (!backgroundColor && !color) return undefined;
  return { fill: backgroundColor || undefined, color: color || undefined };
}

function Grid({ state, columns, table: tableRef, scroller, looks, totals }: GridProps) {
  const table = useTable({
    features,
    columns,
    data: state.data,
    getRowId: (row) => String(row.id),
    state: {
      sorting: state.sorting,
      columnFilters: state.columnFilters,
      rowSelection: state.rowSelection,
    },
  });
  tableRef.current = table;
  const scrollRef = useRef<HTMLDivElement>(null);
  scroller.current = scrollRef.current;
  const rows = table.getRowModel().rows;
  const headerGroups = table.getHeaderGroups();
  const headers = headerGroups.at(-1)!.headers;
  // Memoized as TanStack Virtual's documentation asks: a new key function
  // makes the virtualizer read every row's key again.
  const getItemKey = useCallback((index: number) => rows[index]!.id, [rows]);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey,
    overscan: OVERSCAN_ROWS,
  });
  const columnVirtualizer = useVirtualizer({
    count: headers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => COLUMN_WIDTH,
    horizontal: true,
    overscan: 3,
  });
  const virtualColumns = columnVirtualizer.getVirtualItems();
  const width = columnVirtualizer.getTotalSize();
  const paddingLeft = virtualColumns[0]?.start ?? 0;
  const paddingRight = width - (virtualColumns.at(-1)?.end ?? 0);
  const pad = (size: number, Cell: "th" | "td") =>
    size > 0 ? <Cell style={{ width: size, padding: 0 }} /> : null;
  return (
    <div
      ref={scrollRef}
      className="tt-grid"
      style={{ width: GRID_WIDTH, height: GRID_HEIGHT, overflow: "auto", position: "relative" }}
    >
      <table>
        <thead>
          {headerGroups.slice(0, -1).map((group) => {
            // Groups over the columns in view, each placed at its first column.
            const first = virtualColumns[0]?.index ?? 0;
            const last = virtualColumns.at(-1)?.index ?? -1;
            let start = 0;
            return (
              <tr key={group.id} className="tt-group" style={{ width }}>
                {group.headers.map((header) => {
                  const at = start;
                  start += header.colSpan;
                  if (header.isPlaceholder || at > last || at + header.colSpan <= first)
                    return null;
                  return (
                    <th
                      key={header.id}
                      style={{ left: at * COLUMN_WIDTH, width: header.colSpan * COLUMN_WIDTH }}
                    >
                      <table.FlexRender header={header} />
                    </th>
                  );
                })}
              </tr>
            );
          })}
          <tr style={{ width }}>
            {pad(paddingLeft, "th")}
            {virtualColumns.map((column) => {
              const header = headers[column.index]!;
              return (
                <th key={header.id} style={{ width: COLUMN_WIDTH }}>
                  <table.FlexRender header={header} />
                </th>
              );
            })}
            {pad(paddingRight, "th")}
          </tr>
        </thead>
        <tbody
          style={{ display: "grid", height: rowVirtualizer.getTotalSize(), position: "relative" }}
        >
          {rowVirtualizer.getVirtualItems().map((item) => {
            const row = rows[item.index]!;
            const cells = row.getAllCells();
            return (
              <tr
                key={row.id}
                data-id={row.id}
                aria-selected={row.getIsSelected()}
                style={{ position: "absolute", transform: `translateY(${item.start}px)`, width }}
              >
                {pad(paddingLeft, "td")}
                {virtualColumns.map((column) => {
                  const cell = cells[column.index]!;
                  const look =
                    looks &&
                    cellLook(
                      looks.fields[column.index]!.name,
                      (name) => rowValue(row.original, name),
                      looks.domain,
                    );
                  return (
                    <td
                      key={cell.id}
                      data-field={column.index}
                      style={{ width: COLUMN_WIDTH, background: look?.fill, color: look?.color }}
                    >
                      <table.FlexRender cell={cell} />
                    </td>
                  );
                })}
                {pad(paddingRight, "td")}
              </tr>
            );
          })}
        </tbody>
        {totals && (
          <tfoot>
            <tr style={{ width }}>
              {pad(paddingLeft, "td")}
              {virtualColumns.map((column) => {
                const { name } = totals.fields[column.index]!;
                return (
                  <td key={name} data-field={column.index} style={{ width: COLUMN_WIDTH }}>
                    {totalText(name, totals.values[name])}
                  </td>
                );
              })}
              {pad(paddingRight, "td")}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function mount(
  container: HTMLElement,
  gridTable: GridTable,
  input: unknown,
  options: MountOptions = {},
): GridHandle {
  if (!document.getElementById("tt-grid-style")) {
    const style = document.createElement("style");
    style.id = "tt-grid-style";
    style.textContent = CSS;
    document.head.append(style);
  }
  const fields = gridTable.fields;
  const cells = options.cells !== undefined && options.cells !== false;
  if (cells && !document.getElementById("bc-cells-style")) {
    const style = document.createElement("style");
    style.id = "bc-cells-style";
    style.textContent = DOM_CELL_CSS;
    document.head.append(style);
  }
  // Adapter code: the rows' extent, which n4's bars are drawn within.
  const columns = columnsFor(
    fields,
    cells ? { extent: extentOf(gridTable, "n4"), react: options.cells === "framework" } : undefined,
    options.summary,
  );
  const totals = options.summary ? new TotalsTracker(gridTable) : undefined;
  const table: RefObject<Table | null> = { current: null };
  const scroller: RefObject<HTMLDivElement | null> = { current: null };
  const root = createRoot(container);
  let state: State = {
    data: input as RowObject[],
    sorting: [],
    columnFilters: [],
    rowSelection: {},
  };
  const tracker = options.looks ? new LookTracker(gridTable) : undefined;
  const render = (change: Partial<State>) => {
    state = { ...state, ...change };
    const looks = tracker && { fields, domain: tracker.domain };
    const summary = totals && { fields, values: totals.values };
    flushSync(() =>
      root.render(
        <Grid
          state={state}
          columns={columns}
          table={table}
          scroller={scroller}
          looks={looks}
          totals={summary}
        />,
      ),
    );
  };
  render({});
  const element = () => container.querySelector<HTMLDivElement>(".tt-grid")!;

  return {
    visible() {
      const scroll = element();
      const view = scrollport(scroll);
      view.top = scroll.querySelector("thead")!.getBoundingClientRect().bottom;
      const footer = scroll.querySelector("tfoot");
      if (footer) view.bottom = footer.getBoundingClientRect().top;
      const shown = readDomVisible({
        // From layout: the style string of a tall body is serialized with six digits.
        count: Math.round(
          scroll.querySelector("tbody")!.getBoundingClientRect().height / ROW_HEIGHT,
        ),
        view,
        top: scroll.scrollTop,
        left: scroll.scrollLeft,
        rows: scroll.querySelectorAll("tbody tr"),
        rowId: (row) => Number(row.getAttribute("data-id")),
        cells: (row) => row.querySelectorAll("td[data-field]"),
        cellField: (cell) => Number(cell.getAttribute("data-field")),
        selected: (row) => row.getAttribute("aria-selected") === "true",
        ...(tracker && { look: styledLook }),
        ...(cells && { content: domContent }),
      });
      if (footer) {
        const texts = new Map<number, string>();
        for (const cell of footer.querySelectorAll("td[data-field]"))
          texts.set(Number(cell.getAttribute("data-field")), cell.textContent ?? "");
        shown.totals = shown.columns.map((field) => texts.get(field) ?? "");
      }
      return shown;
    },
    rowCount: () => table.current!.getRowModel().rows.length,
    order: () => table.current!.getRowModel().rows.map((row) => row.original.id),
    scrollTo(top, left) {
      const scroll = element();
      scroll.scrollTop = top;
      scroll.scrollLeft = left;
    },
    scrollOffset: () => ({ top: element().scrollTop, left: element().scrollLeft }),
    sort(keys) {
      render({ sorting: keys.map((key) => ({ id: key.field, desc: key.descending })) });
    },
    filter(filter) {
      if (!filter) render({ columnFilters: [] });
      else if (filter.kind === "range")
        render({ columnFilters: [{ id: filter.field, value: [filter.min, filter.max] }] });
      else render({ columnFilters: [{ id: filter.field, value: new Set(filter.labels) }] });
    },
    append(batch, evict) {
      tracker?.append(batch, evict);
      totals?.append(batch, evict);
      const kept = evict > 0 ? state.data.slice(evict) : state.data;
      render({ data: kept.concat(rowObjects(batch)) });
    },
    update(field, ids, values) {
      const name = fields[field]!.name;
      const data = state.data.slice();
      // Rows stay in identity order, so a row's index follows from the first row's identity.
      const first = data[0]!.id;
      for (let i = 0; i < ids.length; i++) {
        const index = ids[i]! - first;
        data[index] = { ...data[index]!, [name]: values[i] };
      }
      render({ data });
    },
    selectRange(start, end) {
      const rows = table.current!.getRowModel().rows;
      const rowSelection: RowSelectionState = {};
      for (let i = start; i < end; i++) rowSelection[rows[i]!.id] = true;
      render({ rowSelection });
    },
    clearSelection: () => render({ rowSelection: {} }),
    selectedIds: () => table.current!.getSelectedRowModel().rows.map((row) => row.original.id),
    destroy: () => root.unmount(),
  };
}

export const adapter: Adapter = {
  id: "tanstack-table",
  renderer:
    "DOM table, React 19 (TanStack Virtual rows with 10 overscan, columns with 3); cells scenarios: React cells",
  processing: { sort: "native (sorted row model)", filter: "native (filtered row model)" },
  prepare: rowObjects,
  mount,
};
