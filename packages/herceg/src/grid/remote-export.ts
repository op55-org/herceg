// Reading a remote grid's rows for an export, loaded as one starts (the
// model captures what it reads first, in remote.ts): every row the grid
// lists, block by block from the snapshot its rows come from, through the
// groups that were expanded, depth first, at most two requests at a time.
// It keeps its own place in the answer, never the grid's lists or blocks,
// so the grid scrolling, collapsing, or asking a new query changes nothing
// it reads.

import type { Fields } from "../data/expression.ts";
import { type GroupKey, groupId } from "../data/groups.ts";
import type { Schema } from "../data/table.ts";
import type { FormatSettings, PlacedColumn } from "./columns.ts";
import { GridExportError, rawCell, summariesOf, totalsCells } from "./export-read.ts";
import type { ReadRequest, RowsRead } from "./export-rows.ts";
import type { GridAggregate, GridQuery, GridSchema } from "./query.ts";
import {
  groupCell,
  groupTexts,
  totalsOf as remoteTotals,
  windowKinds,
  windowValue,
} from "./remote.ts";
import { aggregateKind } from "./remote-list.ts";
import { later, ownColumns } from "./remote-requests.ts";
import {
  checkTotals,
  checkWindow,
  encodeGroupPath,
  type GridSource,
  GridSourceError,
  type RowsRequest,
  type RowsWindow,
  type TotalsRequest,
  valueAt,
  type WindowRows,
  windowFields,
} from "./source.ts";

/** What a remote model captured as an export of its rows began, and what the export asked for. */
export interface RemoteRead extends Omit<ReadRequest, "totals"> {
  readonly source: GridSource<Schema>;
  readonly schema: GridSchema<Schema>;
  readonly query: GridQuery;
  readonly revision: number;
  /** The grid's snapshot, which the model keeps until `release`; null for one the export starts. */
  readonly snapshot: string | null;
  /** Whether the source had said the snapshot expired. */
  readonly expired: boolean;
  readonly release: () => void;
  /** The fields blocks of rows hold. */
  readonly fields: readonly string[];
  /** Ids of the groups shown expanded. */
  readonly expanded: ReadonlySet<string>;
  readonly blockSize: number;
  /** The shown columns, whose first names group rows. */
  readonly layout: readonly PlacedColumn[];
  readonly settings: FormatSettings;
  /**
   * The totals to write: their aggregates, and the source's answer where
   * the grid had read it for the snapshot (else the export asks); false or
   * null for none.
   */
  readonly totals:
    | false
    | null
    | {
        readonly aggregates: readonly GridAggregate[];
        readonly fields: Fields | null;
      };
}

/** A window of a list, as read. */
interface Read {
  readonly index: number;
  readonly data: RowsWindow;
  readonly fields: WindowRows;
}

/** A list being read: a parent's rows or groups. */
interface Frame {
  readonly parent: GroupKey;
  readonly leaf: boolean;
  /** The next row's place in the list. */
  next: number;
  /** Its rows, once known: as many as its group counts, or as its windows say. */
  total: number | null;
  /** The rows its answers have held, up to the end of the furthest; a total short of them is false. */
  seen: number;
  /** The window read, and the next one asked for ahead. */
  read: Read | null;
  ahead: { index: number; promise: Promise<Read> } | null;
}

const IN_FLIGHT = 2;
const ENDED = "The export ended";

/** The rows of `read`'s snapshot, read as asked for. */
export function readRemote(read: RemoteRead): RowsRead {
  const { source, schema, query, blockSize, columns, raw, at } = read;
  if (read.rows !== "shown")
    throw new Error(
      `${at} rows: a remote grid exports the rows it shows, not its records or selection; give rows: "shown"`,
    );
  if (read.expired) throw snapshotExpired(at);
  const by = query.group?.by ?? [];
  const label = read.layout[0]?.id;
  const texts =
    by.length > 0 && !raw ? groupTexts(read.layout, query, read.settings, schema, columns) : [];
  const summaries = summariesOf(columns, at);
  const controller = new AbortController();
  let snapshot = read.snapshot;
  /** Whether the export started the snapshot, which it then releases. */
  let own = false;
  let closed = false;
  let failure: unknown = null;
  let flying = 0;
  const asked = read.totals || null;
  const totalsOf = (fields: Fields) =>
    totalsCells(remoteTotals(asked!.aggregates, fields, schema, read.settings), columns, raw);
  let totals: RowsRead["totals"] = asked?.fields ? totalsOf(asked.fields) : null;
  let totalsRead: Promise<void> | null = null;
  const stack: Frame[] = [frame([], null)];
  const root = stack[0]!;

  function frame(parent: GroupKey, total: number | null): Frame {
    return {
      parent,
      leaf: parent.length === by.length,
      next: 0,
      total,
      seen: 0,
      read: null,
      ahead: null,
    };
  }

  /** The export's failure: the source's, a snapshot expired as an export's. */
  function fail(error: unknown): never {
    failure ??=
      error instanceof GridSourceError && error.code === "snapshot-expired"
        ? snapshotExpired(at)
        : error;
    controller.abort();
    throw failure;
  }

  /** Requests waiting for a place: at most `IN_FLIGHT` go at once, asked ahead or not. */
  const waiting: (() => void)[] = [];

  /** Calls the source once a request may go and the export has not ended, then lets the next go. */
  function send<T>(call: () => T | Promise<T>): Promise<T> {
    const place =
      flying < IN_FLIGHT ? Promise.resolve() : new Promise<void>((go) => waiting.push(go));
    flying++;
    const sent = place
      .then(() => {
        if (closed) throw failure ?? new Error(ENDED);
        return call();
      })
      .finally(() => {
        flying--;
        waiting.shift()?.();
      });
    // Read later, or never (a list ended first): its failure is the read's, not unhandled.
    sent.catch(() => {});
    return sent;
  }

  function ask(list: Frame, index: number): Promise<Read> {
    const depth = list.parent.length;
    const kinds = windowKinds(list.leaf, depth, read.fields, query, schema);
    const request: RowsRequest = {
      query,
      revision: read.revision,
      schemaVersion: schema.version,
      snapshot,
      parent: encodeGroupPath(list.parent),
      offset: index * blockSize,
      limit: blockSize,
      fields: list.leaf ? read.fields : [],
    };
    const promise = send(() => source.rows(request, controller.signal)).then((data) => {
      // A snapshot this request started is the export's to release, whatever the answer holds.
      const started =
        request.snapshot === null && typeof data?.snapshot === "string" ? data.snapshot : null;
      if (closed || (started !== null && snapshot !== null)) {
        if (started !== null) later(() => source.release?.(started));
        if (closed) throw failure ?? new Error(ENDED);
      } else if (started !== null) {
        snapshot = started;
        own = true;
      }
      checkWindow(data, request, list.leaf ? "rows" : "groups", kinds, {
        key: list.leaf ? schema.key : null,
        ...(!list.leaf && { group: by[depth]! }),
      });
      if (started !== null) askTotals();
      // One list's answers agree: one total, which no answer holds rows past.
      if (data.length > 0) list.seen = Math.max(list.seen, request.offset + data.length);
      const total = data.total ?? list.total;
      if (
        total !== null &&
        (total < list.seen ||
          (data.total !== null && list.total !== null && data.total !== list.total))
      )
        throw new GridSourceError(
          "invalid-response",
          "The answer's total differs from its list's other answers or its group's count, or is short of their rows",
        );
      list.total = total;
      // Its own arrays: a window viewing a source's larger buffers would keep them.
      const owned = ownColumns(data, kinds);
      return { index, data: owned, fields: windowFields(kinds, owned.columns) };
    });
    promise.catch(() => {});
    return promise;
  }

  /** Reads window `index` of `list`, and asks for the one after it while there is room. */
  function load(list: Frame, index: number): Promise<void> {
    // Asked once the export reads, not as it is made: it may be stopped before.
    askTotals();
    const ahead = list.ahead?.index === index ? list.ahead.promise : null;
    list.ahead = null;
    return (ahead ?? ask(list, index)).then((answer) => {
      list.read = answer;
      const more = list.total === null || (index + 1) * blockSize < list.total;
      if (more && !closed && snapshot !== null && flying < IN_FLIGHT)
        list.ahead = { index: index + 1, promise: ask(list, index + 1) };
    }, fail);
  }

  function askTotals() {
    if (totals || totalsRead || !asked || snapshot === null) return;
    const aggregate = asked.aggregates;
    const request: TotalsRequest = {
      query,
      revision: read.revision,
      schemaVersion: schema.version,
      snapshot,
      aggregate,
    };
    const kinds: Record<string, string> = Object.create(null);
    for (const one of aggregate)
      kinds[one.as] = aggregateKind(one, schema.fields as Record<string, string>);
    totalsRead = send(() => source.totals!(request, controller.signal)).then((answer) => {
      checkTotals(answer, request);
      totals = totalsOf(windowFields(kinds, answer.columns));
    });
    totalsRead.catch(() => {});
  }

  function write(
    list: Frame,
    { data, fields }: Read,
    row: number,
    cells: string[],
    plain: Uint8Array,
  ) {
    columns.forEach((column, c) => {
      if (!list.leaf) {
        if (!raw) {
          cells[c] = texts[c]!(data, row, list.parent);
          plain[c] = 0;
          return;
        }
        const { value, kind } = groupCell(
          column,
          data,
          fields,
          row,
          list.parent,
          by,
          schema,
          column.id === label,
        );
        rawCell(cells, plain, c, value, kind);
      } else if (raw && column.field !== null)
        rawCell(cells, plain, c, windowValue(fields, column.field, row), column.kind);
      else {
        const link = column.content.link?.(fields, row);
        cells[c] = link ? link.text : column.content.text(fields, row);
        plain[c] = 0;
      }
    });
  }

  function next(cells: string[], plain: Uint8Array): boolean | Promise<boolean> {
    for (;;) {
      if (failure) throw failure;
      const list = stack.at(-1);
      if (!list) return totalsRead && !totals ? totalsRead.then(() => false, fail) : false;
      if (list.total !== null && list.next >= list.total) {
        stack.pop();
        continue;
      }
      const index = Math.floor(list.next / blockSize);
      if (list.read?.index !== index) return load(list, index).then(() => next(cells, plain));
      const row = list.next - index * blockSize;
      // A window shorter than asked for is the list's last.
      if (row >= list.read.data.length) {
        stack.pop();
        continue;
      }
      write(list, list.read, row, cells, plain);
      list.next++;
      if (!list.leaf) {
        const { data } = list.read;
        const key = [...list.parent, valueAt(data, by[list.parent.length]!, row)];
        if (read.expanded.has(groupId(key)))
          stack.push(frame(key, (data as RowsWindow & { kind: "groups" }).childCounts[row]!));
      }
      return true;
    }
  }

  return {
    // Known for rows alone: groups' rows depend on what they hold.
    get total() {
      return by.length === 0 ? root.total : null;
    },
    get totals() {
      return totals;
    },
    next,
    check() {
      if (failure) throw failure;
      summaries();
    },
    close() {
      if (closed) return;
      closed = true;
      controller.abort();
      // Requests waiting for a place end now, asking nothing, though those out may never answer.
      for (const go of waiting.splice(0)) go();
      read.release();
      const started = snapshot;
      if (own && started !== null) later(() => source.release?.(started));
    },
  };
}

/** The export failure for a snapshot the source no longer has. */
function snapshotExpired(at: string): GridExportError {
  return new GridExportError(
    "snapshot-expired",
    `${at}: the source no longer has the rows' snapshot; export again`,
  );
}
