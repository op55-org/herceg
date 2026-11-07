import { PivotGrid } from "@herceg/vue/grid/pivot";
import { count, mean, rowView, table, time } from "herceg";
import { createPivotGridModel } from "herceg/grid/pivot";
import { pivotRows } from "herceg/pivot";
import { type Component, createApp, h } from "vue";

// Vue is excluded, as for herceg-vue-grid, and h() takes the component as such.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const data = table({ t: time(x), v: y, k: Float64Array.from(x, (_, i) => i % 4) });
  const pivot = pivotRows(rowView(data), {
    rows: "t",
    pivot: "k",
    ops: { n: count(), avg: mean("v") },
  });
  const model = createPivotGridModel({ data: pivot });
  createApp({ render: () => h(PivotGrid as Component, { model, ariaLabel: "Values" }) }).mount(
    element,
  );
}
