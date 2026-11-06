import { PivotGrid } from "@herceg/react/grid/pivot";
import { count, mean, rowView, table, time } from "herceg";
import { createPivotGridModel } from "herceg/grid/pivot";
import { pivotRows } from "herceg/pivot";
import { createRoot } from "react-dom/client";

// React and React DOM are excluded, as for herceg-react-grid.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const data = table({ t: time(x), v: y, k: Float64Array.from(x, (_, i) => i % 4) });
  const pivot = pivotRows(rowView(data), {
    rows: "t",
    pivot: "k",
    ops: { n: count(), avg: mean("v") },
  });
  const model = createPivotGridModel({ data: pivot });
  createRoot(element).render(<PivotGrid model={model} ariaLabel="Values" />);
}
