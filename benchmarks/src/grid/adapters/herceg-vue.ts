// Herceg's grid through `@herceg/vue/grid`: the same table, view, and model
// as the plain adapter, with the grid mounted by a Vue app (mounted
// synchronously). Data, sorting, filtering, scrolling, and selection go
// through the model and table, never Vue. In the framework cells scenarios,
// `cells` draws the cell-bearing columns with `VueCell` (vue-cells.ts) from
// each cell's value and text, as herceg-react draws `ReactCell`; n4's bar's
// domain is adapter code, found from the rows at mount; n1's link is a
// control cell.

import { Grid, type VueGridCells } from "@herceg/vue/grid";
import type { Schema, Table } from "herceg";
import { type Component, createApp, h } from "vue";
import { type Adapter, GRID_HEIGHT, GRID_WIDTH, HEADER_HEIGHT } from "../adapter.ts";
import { CELL_FIELDS, DOM_CELL_CSS, extentOf } from "../cells.ts";
import type { GridTable } from "../fixture.ts";
import { VueCell } from "../vue-cells.ts";
import { hercegHandle, hercegTable, THEME } from "./herceg.ts";

/** The framework cells scenarios' cells, by column. */
function vueCells(fixture: GridTable): VueGridCells<Schema> {
  if (!document.getElementById("bc-cells-style")) {
    const style = document.createElement("style");
    style.id = "bc-cells-style";
    style.textContent = DOM_CELL_CSS;
    document.head.append(style);
  }
  const extent = extentOf(fixture, "n4");
  return Object.fromEntries(
    CELL_FIELDS.map((field) => [
      field,
      {
        ...(field === "n1" && { interaction: "control" as const }),
        render: (cell) =>
          h(VueCell, { field, value: cell.value ?? undefined, text: cell.text, extent }),
      },
    ]),
  );
}

export const adapter: Adapter = {
  id: "herceg-vue",
  renderer:
    "DOM rows and cells written through field displays, mounted through @herceg/vue/grid (Vue 3); framework cells scenarios: Vue cells through teleports",
  processing: { sort: "native (row view)", filter: "native (row view, expression)" },
  prepare: hercegTable,
  mount: (container, fixture, input, options) =>
    hercegHandle(
      container,
      fixture,
      input as Table<Schema>,
      (model) => {
        const cells = options?.cells === "framework" ? vueCells(fixture) : undefined;
        // Generic components are cast for h(), which cannot infer their schema.
        const app = createApp({
          render: () =>
            h(Grid as Component, {
              model,
              ariaLabel: "Benchmark grid",
              headerHeight: HEADER_HEIGHT,
              theme: THEME,
              style: { width: `${GRID_WIDTH}px`, height: `${GRID_HEIGHT}px` },
              cells,
            }),
        });
        app.mount(container);
        return { destroy: () => app.unmount() };
      },
      options,
    ),
};
