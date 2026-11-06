import { Grid } from "@herceg/react/grid";
import { rowView, table, time } from "herceg";
import { createGridModel } from "herceg/grid";
import { createRoot } from "react-dom/client";

// React and React DOM are excluded from this bundle: an application using the
// adapter already ships them. The entry measures herceg/grid plus the adapter.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const data = table({ t: time(x), v: y });
  const model = createGridModel({ data: rowView(data), columns: [{ field: "t" }, { field: "v" }] });
  createRoot(element).render(<Grid model={model} ariaLabel="Values" />);
}
