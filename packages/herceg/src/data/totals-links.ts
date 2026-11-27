// Totals' contributors (totals.ts records what they keep): their one row
// stands for every row the view shows, those whose value of an aggregate's
// field is finite for that aggregate. Part of the lineage reader
// (contributors.ts), so totals no one reads through carry none of it.

import type { ContributorLink, Removed, TotalsRecord } from "./contributor-records.ts";
import { measureOf, operandsOf } from "./group-lineage.ts";

/** The totals' one link and what their fields read, made once per record. */
const made = /* @__PURE__ */ new WeakMap<
  TotalsRecord,
  {
    links: readonly ContributorLink[];
    operandOf: (field: string | undefined) => string | undefined;
  }
>();

export function totalsLinks(record: TotalsRecord): readonly ContributorLink[] {
  return readerOf(record).links;
}

function readerOf(record: TotalsRecord) {
  const known = made.get(record);
  if (known) return known;
  const { source, view, aggregates } = record;
  const operandOf = operandsOf(aggregates);
  /** The values of the field `field` reads, if any. */
  const operand = (field: string | undefined) => {
    const name = operandOf(field);
    return name === undefined ? undefined : source.numbers(name as never);
  };
  const only = (target: number) => {
    if (target !== 0) throw new RangeError(`Totals have one row, not row ${target}`);
  };
  const link: ContributorLink = {
    get rows() {
      return source.length;
    },
    targets: 1,
    single: false,
    partition: true,
    contributors: (target, visit, field) => {
      only(target);
      link.incidences!((position) => visit(position), field);
    },
    targetsOf: (position, visit, field) => {
      if (link.targetAt(position, field) === 0) visit(0);
    },
    targetAt: (position, field) => {
      if (!record.current() || view.indexOf(position) < 0) return -1;
      const values = operand(field);
      return !values || Number.isFinite(values[position]!) ? 0 : -1;
    },
    count: (target, field) => {
      only(target);
      let count = 0;
      link.incidences!(() => count++, field);
      return count;
    },
    classOf: (field) => operandOf(field) ?? null,
    operandOf,
    passes: () => undefined,
    // Stopped, their values no longer follow the rows.
    measureOf: (field) => (record.current() ? measureOf(aggregates, field) : undefined),
    incidences: (visit, field) => {
      if (!record.current()) return;
      const values = operand(field);
      const { indices, length } = view.read();
      for (let i = 0; i < length; i++) {
        const position = indices ? indices[i]! : i;
        if (!values || Number.isFinite(values[position]!)) visit(position, 0);
      }
    },
    byteLength: 0,
  };
  const reader = { links: [link], operandOf };
  made.set(record, reader);
  return reader;
}

/** What the row the totals dropped at `slot` fed for `field`, from their log; false where it holds it no more. */
export function totalsRemoved(
  record: TotalsRecord,
  slot: number,
  field: string | undefined,
  out: Removed,
): boolean {
  record.current();
  const log = record.log;
  const at = log ? log.find(slot) : -1;
  if (at < 0) return false;
  const name = readerOf(record).operandOf(field);
  const k = name === undefined ? -1 : record.logged.indexOf(name);
  out.value = k < 0 ? Number.NaN : log!.value(at, k);
  const fed = name === undefined || Number.isFinite(out.value);
  out.target = fed ? log!.target(at) : -1;
  return true;
}
