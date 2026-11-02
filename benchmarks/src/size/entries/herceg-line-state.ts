import { createChart, line, table, time } from "herceg";
import { chartState } from "herceg/state";

// A line chart with state support: its selection given as an option, as adapters' are.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  return createChart(element, {
    state: chartState,
    marks: [line(table({ t: time(x), v: y }), { x: "t", y: "v" })],
    selection: null,
  });
}
