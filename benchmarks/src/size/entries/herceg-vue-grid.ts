import { Grid } from "@herceg/vue/grid";
import { rowView, table, time } from "herceg";
import { createGridModel } from "herceg/grid";
import { type Component, createApp, h } from "vue";

// Vue is excluded from this bundle: an application using the adapter already
// ships it. The entry measures herceg/grid plus the adapter. (h() cannot
// infer the schema of a generic component; templates checked by vue-tsc do.)
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  const data = table({ t: time(x), v: y });
  const model = createGridModel({ data: rowView(data), columns: [{ field: "t" }, { field: "v" }] });
  createApp({ render: () => h(Grid as Component, { model, ariaLabel: "Values" }) }).mount(element);
}
