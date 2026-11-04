import { createChart, line, table, time } from "herceg";

// A line chart given field displays: the label names its series and titles
// its axis, and the format writes its ticks and tooltips.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  return createChart(element, {
    fields: { v: { label: "Latency", format: { duration: "millisecond" } } },
    y: { title: [{ label: "v" }] },
    marks: [line(table({ t: time(x), v: y }), { x: "t", y: "v" })],
  });
}
