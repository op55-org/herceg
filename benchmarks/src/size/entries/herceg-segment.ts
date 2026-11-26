import { createChart, segment, table } from "herceg";

export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  // An arrow from each point to the next.
  const n = Math.min(x.length, y.length) - 1;
  const moves = table({
    x0: x.subarray(0, n),
    x1: x.subarray(1, n + 1),
    y0: y.subarray(0, n),
    y1: y.subarray(1, n + 1),
  });
  return createChart(element, {
    marks: [segment(moves, { x: ["x0", "x1"], y: ["y0", "y1"], caps: { to: "arrow" } })],
  });
}
