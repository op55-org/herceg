// Aggregate operations as derivations (`derive(...).aggregate`) and pivots
// (herceg/pivot) take them: `count()`, `sum("revenue")`, ... Their own
// module, so pivots and grids that name operations load no derivation code.

import type { AggregateOp } from "../spec/spec.ts";

/** An aggregate operation and the field it reads; `count()` reads none. */
export interface Aggregation<F extends string = string> {
  op: AggregateOp;
  field?: F;
}

/** Counts rows; with a field, its finite values. */
export function count(): { readonly op: "count" };
export function count<F extends string>(field: F): { readonly op: "count"; readonly field: F };
export function count(field?: string) {
  return field === undefined ? { op: "count" } : { op: "count", field };
}
export const sum = <F extends string>(field: F) => ({ op: "sum", field }) as const;
export const mean = <F extends string>(field: F) => ({ op: "mean", field }) as const;
export const median = <F extends string>(field: F) => ({ op: "median", field }) as const;
export const min = <F extends string>(field: F) => ({ op: "min", field }) as const;
export const max = <F extends string>(field: F) => ({ op: "max", field }) as const;
export const q1 = <F extends string>(field: F) => ({ op: "q1", field }) as const;
export const q3 = <F extends string>(field: F) => ({ op: "q3", field }) as const;
export const stdev = <F extends string>(field: F) => ({ op: "stdev", field }) as const;
export const variance = <F extends string>(field: F) => ({ op: "variance", field }) as const;
export const distinct = <F extends string>(field: F) => ({ op: "distinct", field }) as const;
export const first = <F extends string>(field: F) => ({ op: "first", field }) as const;
export const last = <F extends string>(field: F) => ({ op: "last", field }) as const;
