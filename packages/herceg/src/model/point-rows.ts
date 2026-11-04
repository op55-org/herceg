// The table rows a point a mark draws stands for: its row, the rows a
// summary's point summarizes (a bin, a box) in its panel, or every row of
// a heatmap's cell with a value. Clicks' row selections
// (model/selected-rows.ts) and click targets' `rows()` (model/provenance.ts)
// read points alike. It imports no code, so the picking chunk takes it
// without sharing a module with charts' first chunks.

import type { Mark } from "../marks/mark.ts";
import type { Series } from "../marks/series.ts";
import { facetsOf } from "./item-conditions.ts";
import type { ChartModel, DrawnPanel } from "./model.ts";

/** The positions of the rows of `mark`'s table that point `position` of `series`, drawn in `panel`, stands for. */
export function pointRows(
  model: ChartModel,
  mark: Mark,
  series: Series,
  position: number,
  panel: DrawnPanel,
): Uint32Array {
  const table = mark.table!;
  const at = (k: number) => (series.rows === undefined ? k : series.rows[k]!);
  const row = at(position);
  if (!mark.summarizes && mark.tooltip !== "cell") return Uint32Array.of(row);
  const found: number[] = [];
  if (!mark.summarizes) {
    // Every row drawn in the cell (with a value), not only the one whose value it shows.
    const [x, y] = [series.x[row]!, series.y[row]!];
    const values = table.numbers((mark.spec as unknown as { color: string }).color as never);
    const scale = panel.y ?? panel.yRight!;
    for (let k = 0; k < series.length; k++) {
      const other = at(k);
      if (
        series.x[other] === x &&
        series.y[other] === y &&
        Number.isFinite(values[other]!) &&
        (mark.shows?.(series, other, scale, panel.x) ?? true)
      )
        found.push(other);
    }
    return Uint32Array.from(found);
  }
  // A summary that names no rows of its own (a contour's band, of a grid it interpolates) stands for none.
  if (!mark.summarized) return new Uint32Array(0);
  const member = mark.summarized(series, position);
  // Of its panel's facet values, where the facet splits the mark.
  const facets = facetsOf(model, panel.key, mark).map(({ field, ...group }) => {
    const { codes, dictionary } = table.categories(field as never);
    const code = dictionary.indexOf((group as { value: string }).value);
    return (row: number) => codes[row] === code;
  });
  // The rows the mark reads: a view's, or every row of its table.
  const read = mark.rows?.().positions;
  const length = read ? read.length : table.length;
  for (let k = 0; k < length; k++) {
    const at = read ? read[k]! : k;
    if (member(at) && facets.every((holds) => holds(at))) found.push(at);
  }
  return Uint32Array.from(found);
}
