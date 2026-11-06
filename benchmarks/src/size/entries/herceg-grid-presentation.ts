import { rowView, table, time } from "herceg";
import { barCell, createGrid, createGridModel } from "herceg/grid";

// A grid presenting its values: a threshold look through the field's display, a data bar, and links.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const data = table({ t: time(x), v: y });
  const model = createGridModel({
    data: rowView(data),
    columns: [{ field: "t" }, { field: "v", cell: barCell(), encode: { color: { field: "v" } } }],
    fields: {
      t: { link: { url: ["/at/", { value: true }] } },
      v: { thresholds: { base: "#2e7d32", steps: [{ value: 0.5, color: "#c62828" }] } },
    },
  });
  return createGrid(element, { model, ariaLabel: "Values" });
}
