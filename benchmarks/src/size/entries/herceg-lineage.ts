// A bar of row groups highlighting a selection of their source's rows
// through lineage: the chart, its row selection, and the lineage reader
// (contributors and coverage). Until the binding resolver loads the
// reader itself, the entry takes it from the package's source.
import {
  bar,
  category,
  createChart,
  groupRows,
  rowSelection,
  rowView,
  selectionStore,
  sum,
  table,
} from "herceg";
import { relationTo } from "../../../../packages/herceg/src/data/contributors.ts";
import { coverageOf } from "../../../../packages/herceg/src/model/coverage.ts";

export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const sales = table({ region: category(Array.from(x, (_, i) => `region ${i % 12}`)), v: y });
  const store = selectionStore(sales);
  const regions = groupRows(rowView(sales), { by: ["region"], ops: { total: sum("v") } });
  const relation = relationTo(regions.table, sales);
  const coverage = relation && coverageOf(relation, "total", store, "brush");
  const chart = createChart(element, {
    marks: [bar(regions.table, { x: "region", y: "total" })],
    rowSelection: rowSelection({ store, channel: "brush" }),
  });
  return { chart, coverage };
}
