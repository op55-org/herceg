import { RemoteGrid } from "@herceg/vue/grid/remote";
import { createRemoteGridModel, type GridSource } from "herceg/grid/remote";
import { type Component, createApp, h } from "vue";

// Vue is excluded, as for herceg-vue-grid, and h() takes the component as such.
export function render(element: HTMLElement, x: Float64Array, y: Float64Array) {
  // A source answering from the page's arrays, as an HTTP source would from its responses.
  const source: GridSource = {
    schema: { source: "values", version: "1", fields: { t: "time", v: "number" }, key: null },
    async rows(request) {
      const end = Math.min(x.length, request.offset + request.limit);
      return {
        kind: "rows",
        revision: request.revision,
        snapshot: "values",
        parent: request.parent,
        offset: request.offset,
        length: end - request.offset,
        total: x.length,
        columns: { t: x.slice(request.offset, end), v: y.slice(request.offset, end) },
      };
    },
  };
  const model = createRemoteGridModel({ source, columns: [{ field: "t" }, { field: "v" }] });
  createApp({ render: () => h(RemoteGrid as Component, { model, ariaLabel: "Values" }) }).mount(
    element,
  );
}
