// A bar of row groups highlighting a selection of their source's rows
// through lineage: the chart, its row selection, and the lineage reader
// (contributors, coverage, and how bars draw it), which `lineage` brings.
import {
  bar,
  category,
  createChart,
  groupRows,
  lineage,
  rowSelection,
  rowView,
  selectionStore,
  sum,
  table,
} from "herceg";

export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const sales = table({ region: category(Array.from(x, (_, i) => `region ${i % 12}`)), v: y });
  const regions = groupRows(rowView(sales), { by: ["region"], ops: { total: sum("v") } });
  return createChart(element, {
    marks: [bar(regions.table, { x: "region", y: "total" })],
    rowSelection: rowSelection({ store: selectionStore(sales), channel: "brush", lineage }),
  });
}
