import { category, rowView, table, time } from "herceg";
import { createGrid, createGridModel, sparklineCell } from "herceg/grid";

// A grid of ten series, each row drawing its series' values over time from
// another table, matched by key.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const names = Array.from({ length: 10 }, (_, i) => `s${i}`);
  const points = table({
    series: category(Array.from(x, (_, i) => names[i % 10]!)),
    t: time(x),
    v: y,
  });
  const model = createGridModel({
    data: rowView(table({ series: category(names) })),
    columns: [
      { field: "series" },
      { id: "trend", cell: sparklineCell({ data: points, key: "series", x: "t", y: "v" }) },
    ],
  });
  return createGrid(element, { model, ariaLabel: "Series" });
}
