import { rowView, table, time } from "herceg";
import { compileFields } from "herceg/fields";
import { createGrid, createGridModel } from "herceg/grid";

// A grid given field displays: the label titles its column, and the format writes its cells.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const data = table({ t: time(x), v: y });
  const model = createGridModel({
    data: rowView(data),
    columns: [{ field: "t" }, { field: "v" }],
    fields: compileFields({ v: { label: "Latency", format: { duration: "millisecond" } } }),
  });
  return createGrid(element, { model, ariaLabel: "Values" });
}
