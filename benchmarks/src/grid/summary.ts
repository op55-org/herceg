// The summary scenarios' headings and totals row, which every grid is
// configured to show:
//
//   headings  two levels over the columns: "Part g" over each group of 20
//             fields, "Half h" over each run of 10 (a category, a time, and
//             eight numbers)
//   totals    a row under the rows, over every row shown: n1's sum, n2's
//             minimum, n3's maximum, the row count under n4, n7's mean, and
//             n9's sum; "Total" under c0, the first column without a total
//
// Sums and means are of integers (n1, n7, n9), so every grid's sum is exact
// whatever order it adds in. Totals are written as the cells of their
// column are, but the count, which is written plainly ("100,000"). Grids
// without totals of their own (AG Grid Community, TanStack Table) keep them
// in adapter code, `TotalsTracker`: sums and counts by batch, an extreme
// found again from the rows when one leaves them.

import { FORMAT, formatNumber, type GridTable } from "./fixture.ts";

export type TotalOp = "count" | "sum" | "mean" | "min" | "max";

/** Each totalled field's operation; the count is of rows, shown under n4. */
export const TOTALS: Readonly<Record<string, TotalOp>> = {
  n1: "sum",
  n2: "min",
  n3: "max",
  n4: "count",
  n7: "mean",
  n9: "sum",
};

/** The field whose column says "Total". */
export const LABEL_FIELD = "c0";
export const LABEL = "Total";

/** The headings over field `index`, from the top. */
export function headingsOf(index: number): [string, string] {
  return [`Part ${Math.floor(index / 20) + 1}`, `Half ${Math.floor(index / 10) + 1}`];
}

const countFormat = new Intl.NumberFormat(FORMAT.locale, { maximumFractionDigits: 2 });

/** The totals row's text under `field`, given its total (NaN or undefined where there is none). */
export function totalText(field: string, total: number | undefined): string {
  if (field === LABEL_FIELD) return LABEL;
  const op = TOTALS[field];
  if (!op) return "";
  return op === "count" ? countFormat.format(total ?? 0) : formatNumber(total);
}

/**
 * Totals of a rolling window of rows, kept in adapter code: counts and sums
 * follow each batch appended and evicted, and an extreme leaving the window
 * is found again from the rows held. Updates and filters are not followed
 * (the summary scenarios make none).
 */
export class TotalsTracker {
  readonly #fields: GridTable["fields"];
  readonly #chunks: GridTable[] = [];
  #start: number;
  #end: number;
  readonly #sums = new Map<string, number>();
  readonly #counts = new Map<string, number>();
  readonly #extremes = new Map<string, number>();

  constructor(table: GridTable) {
    this.#fields = table.fields;
    this.#start = table.firstId;
    this.#end = table.firstId;
    for (const field of Object.keys(TOTALS)) {
      this.#sums.set(field, 0);
      this.#counts.set(field, 0);
    }
    this.#add(table);
  }

  /** Each totalled field's total now. */
  get values(): Record<string, number> {
    const values: Record<string, number> = {};
    for (const [field, op] of Object.entries(TOTALS)) {
      const n = this.#counts.get(field)!;
      values[field] =
        op === "count"
          ? this.#end - this.#start
          : op === "sum"
            ? this.#sums.get(field)!
            : op === "mean"
              ? n > 0
                ? this.#sums.get(field)! / n
                : Number.NaN
              : this.#extreme(field, op);
    }
    return values;
  }

  append(batch: GridTable, evict: number): void {
    if (evict > 0) this.#evict(evict);
    this.#add(batch);
  }

  #add(batch: GridTable) {
    this.#chunks.push(batch);
    this.#end += batch.length;
    for (const [field, op] of Object.entries(TOTALS)) {
      if (op === "count") continue;
      const values = batch.columns[this.#index(field)] as Float64Array;
      let sum = this.#sums.get(field)!;
      let n = this.#counts.get(field)!;
      let extreme = this.#extremes.get(field);
      for (const value of values) {
        if (Number.isNaN(value)) continue;
        sum += value;
        n++;
        if (extreme !== undefined && (op === "min" ? value < extreme : value > extreme))
          extreme = value;
      }
      this.#sums.set(field, sum);
      this.#counts.set(field, n);
      if (extreme !== undefined) this.#extremes.set(field, extreme);
    }
  }

  #evict(count: number) {
    const end = Math.min(this.#end, this.#start + count);
    for (const [field, op] of Object.entries(TOTALS)) {
      if (op === "count") continue;
      const f = this.#index(field);
      let sum = this.#sums.get(field)!;
      let n = this.#counts.get(field)!;
      const extreme = this.#extremes.get(field);
      let lost = false;
      this.#each(this.#start, end, f, (value) => {
        sum -= value;
        n--;
        if (value === extreme) lost = true;
      });
      this.#sums.set(field, sum);
      this.#counts.set(field, n);
      // Found again when next read.
      if (lost) this.#extremes.delete(field);
    }
    this.#start = end;
    while (this.#chunks.length > 1 && this.#chunks[1]!.firstId <= this.#start) this.#chunks.shift();
  }

  /** The minimum or maximum of a field's values in the window, found from the rows when not known. */
  #extreme(field: string, op: "min" | "max"): number {
    const known = this.#extremes.get(field);
    if (known !== undefined) return known;
    let extreme = Number.NaN;
    this.#each(this.#start, this.#end, this.#index(field), (value) => {
      if (Number.isNaN(extreme) || (op === "min" ? value < extreme : value > extreme))
        extreme = value;
    });
    if (!Number.isNaN(extreme)) this.#extremes.set(field, extreme);
    return extreme;
  }

  /** Calls `visit` with each finite value of field `f` of the rows [from, to). */
  #each(from: number, to: number, f: number, visit: (value: number) => void) {
    for (const chunk of this.#chunks) {
      const start = Math.max(from, chunk.firstId);
      const end = Math.min(to, chunk.firstId + chunk.length);
      const values = chunk.columns[f] as Float64Array;
      for (let id = start; id < end; id++) {
        const value = values[id - chunk.firstId]!;
        if (!Number.isNaN(value)) visit(value);
      }
    }
  }

  #index(field: string): number {
    return this.#fields.findIndex(({ name }) => name === field);
  }
}
