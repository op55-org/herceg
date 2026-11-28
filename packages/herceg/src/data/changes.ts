// The change journal: what a table's changes since one of its versions add
// up to, for readers that read the table when they draw (heatmaps'
// patched cells and images) rather than following each change through a
// listener. A journal attaches to a table the first time a reader asks,
// so tables nothing reads through it keep none.

import type { Schema, Table, TableChange } from "./table.ts";

/** Changes a journal keeps: a reader further behind rebuilds. */
const KEPT = 16;

/** The table as a change left it: its version, `rowOffset`, and length. */
interface State {
  readonly version: number;
  readonly offset: number;
  readonly length: number;
  /** The change that led here; null for the state the journal attached at. */
  readonly change: TableChange | null;
}

const journals = /* @__PURE__ */ new WeakMap<Table, State[]>();

/** Rows a change updated in place, as positions now, and the fields it wrote. */
export interface UpdatedSpan {
  readonly start: number;
  readonly end: number;
  readonly fields: readonly string[];
}

/**
 * A table's changes since a version, as one: `updated` spans every row
 * updated in place, and `spans` lists each change's own span, so that
 * readers of few rows written apart read only those.
 */
export interface Changes extends TableChange {
  readonly spans: readonly UpdatedSpan[];
}

/** No change: what a reader as current as the table hears. */
const NONE: Changes = {
  dropped: 0,
  appended: 0,
  updated: null,
  fields: [],
  reset: false,
  spans: [],
};

/**
 * The table's changes since `version`, merged into one as a transaction's
 * writes are (positions the table's now): the rows dropped from the front
 * and appended at the end, rows an ordered table inserted (with the rows
 * appended counted among them), the span updated in place and its fields.
 * Undefined when the reader must rebuild: a reset since, more than 16
 * changes since, a version from before the journal attached, which is
 * the first time anything asks of the table, or a change the journal has
 * not heard yet (read by a listener told before it). A reader that read the table
 * inside a transaction that has written to it (`untold`) read rows its
 * version does not name, and rebuilds once it is told.
 */
export function changesSince<S extends Schema>(of: Table<S>, version: number): Changes | undefined {
  // Read by position whatever the schema.
  const table = of as unknown as Table;
  const states = journalOf(table);
  const first = states[0]!.version;
  const now = states[states.length - 1]!;
  if (version === table.version) return NONE;
  // A listener before the journal's reads a change it has not heard yet.
  if (now.version !== table.version) return undefined;
  if (!Number.isInteger(version) || version < first || version > table.version) return undefined;
  const since = states[version - first]!;
  // One change is told as it was, so an ordered table's appends stay apart from its insertions.
  if (version === now.version - 1) {
    const change = now.change!;
    if (change.reset) return undefined;
    const { updated, fields } = change;
    return { ...change, spans: updated ? [{ ...updated, fields }] : [] };
  }
  let inserted = Number.POSITIVE_INFINITY;
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  const fields: string[] = [];
  /** Each change's span by slot (`rowOffset` plus position), which drops leave in place. */
  const slots: [number, number, readonly string[]][] = [];
  for (let i = version - first + 1; i < states.length; i++) {
    const { change, offset } = states[i]!;
    if (change!.reset) return undefined;
    if (change!.inserted) inserted = Math.min(inserted, offset + change!.inserted.start);
    const updated = change!.updated;
    if (!updated) continue;
    slots.push([offset + updated.start, offset + updated.end, change!.fields]);
    from = Math.min(from, offset + updated.start);
    to = Math.max(to, offset + updated.end);
    for (const field of change!.fields) if (!fields.includes(field)) fields.push(field);
  }
  const dropped = Math.min(now.offset - since.offset, since.length);
  const kept = since.length - dropped;
  const arrived = now.length - kept;
  const start = Math.max(0, from - now.offset);
  const end = Math.min(now.length, to - now.offset);
  const span = start < end ? { start, end } : null;
  const spans: UpdatedSpan[] = [];
  for (const [from, to, fields] of slots) {
    const start = Math.max(0, from - now.offset);
    const end = Math.min(now.length, to - now.offset);
    if (start < end) spans.push({ start, end, fields });
  }
  return {
    dropped,
    // Rows taken in before others count as inserted, as the rows after them may have moved.
    appended: inserted === Number.POSITIVE_INFINITY ? arrived : 0,
    inserted:
      inserted === Number.POSITIVE_INFINITY
        ? null
        : { start: Math.min(kept, Math.max(0, inserted - now.offset)), count: arrived },
    updated: span,
    fields: span ? fields : [],
    reset: false,
    spans,
  };
}

/** The journal of `table`, attached on first use. */
function journalOf(table: Table): State[] {
  let states = journals.get(table);
  if (states) return states;
  const kept: State[] = [
    { version: table.version, offset: table.rowOffset, length: table.length, change: null },
  ];
  states = kept;
  journals.set(table, kept);
  table.subscribe((change) => {
    const { version, rowOffset: offset, length } = table;
    // A change heard out of turn (a listener before this one wrote to the
    // table) has no state of its own to start from: readers before it rebuild.
    if (version !== kept[kept.length - 1]!.version + 1) {
      kept.length = 0;
      kept.push({ version, offset, length, change: null });
      return;
    }
    kept.push({ version, offset, length, change });
    if (kept.length > KEPT + 1) kept.shift();
  });
  return states;
}
