import { rowView, table, time } from "herceg";
import { createGrid, createGridModel, exportGrid } from "herceg/grid";

// A grid with a button that downloads what it shows as CSV.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const data = table({ t: time(x), v: y });
  const model = createGridModel({ data: rowView(data), columns: [{ field: "t" }, { field: "v" }] });
  const button = element.ownerDocument.createElement("button");
  button.textContent = "Download CSV";
  button.addEventListener("click", async () => {
    const link = element.ownerDocument.createElement("a");
    link.href = URL.createObjectURL(await exportGrid(model));
    link.download = "values.csv";
    link.click();
  });
  element.append(button);
  return createGrid(element, { model, ariaLabel: "Values" });
}
