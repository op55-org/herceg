// What row groups (groups.ts) and totals (totals-links.ts, which reads
// them) tell of their aggregates' contributors (contributor-records.ts).

import type { Measure } from "./contributor-records.ts";

/** An aggregate as its name, operation, and field. */
interface Aggregate {
  readonly name: string;
  readonly op: string;
  readonly field: string | undefined;
}

/**
 * What each field of a groups' or totals' table reads of its contributors,
 * by name: an aggregate with a field reads that field's finite values, so
 * its contributors are the rows where it is finite; counts of rows, keys,
 * and unknown names read the rows themselves.
 */
export function operandsOf(
  aggregates: readonly Aggregate[],
): (field: string | undefined) => string | undefined {
  const operands = new Map<string, string>();
  for (const { name, field } of aggregates) if (field !== undefined) operands.set(name, field);
  return (field) => (field === undefined ? undefined : operands.get(field));
}

/** A count or sum of the source's field, as a measure; the other aggregates have none. */
export function measureOf(aggregates: readonly Aggregate[], field: string): Measure | undefined {
  const aggregate = aggregates.find((a) => a.name === field);
  if (aggregate?.op === "count")
    return aggregate.field === undefined
      ? { op: "count" }
      : { op: "count", field: aggregate.field };
  if (aggregate?.op === "sum") return { op: "sum", field: aggregate.field! };
  return undefined;
}
