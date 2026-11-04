import { displayOf } from "herceg/fields";

// Field display alone, as an application's KPI tile reads it: a label and a value's text.
export function render(element: HTMLElement, _x: Float64Array, y: Float64Array) {
  const latency = displayOf(
    { latency: { label: "Latency", format: { duration: "millisecond" } } },
    { field: "latency", kind: "number" },
  );
  element.textContent = `${latency.label}: ${latency.text(y[0] ?? Number.NaN)}`;
}
