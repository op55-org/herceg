// Herceg's grid through `@herceg/svelte/grid`: the same table, view, and
// model as the plain adapter, with the grid mounted by Svelte (`mount`, its
// effects run with flushSync). Data, sorting, filtering, scrolling, and
// selection go through the model and table, never Svelte. In the framework
// cells scenarios, `cells` draws the cell-bearing columns with `SvelteCell`
// (svelte-cells/) from each cell's value and text, as herceg-react draws
// `ReactCell`; n4's bar's domain is adapter code, found from the rows at
// mount; n1's link is a control cell.

import type { Schema, Table } from "herceg";
import { flushSync, mount, unmount } from "svelte";
import { type Adapter, GRID_HEIGHT, GRID_WIDTH, HEADER_HEIGHT } from "../adapter.ts";
import { DOM_CELL_CSS, extentOf } from "../cells.ts";
import BenchGrid from "../svelte-cells/BenchGrid.svelte";
import { hercegHandle, hercegTable, THEME } from "./herceg.ts";

export const adapter: Adapter = {
  id: "herceg-svelte",
  renderer:
    "DOM rows and cells written through field displays, mounted through @herceg/svelte/grid (Svelte 5); framework cells scenarios: Svelte cells mounted into their hosts",
  processing: { sort: "native (row view)", filter: "native (row view, expression)" },
  prepare: hercegTable,
  mount: (container, fixture, input, options) =>
    hercegHandle(
      container,
      fixture,
      input as Table<Schema>,
      (model) => {
        const framework = options?.cells === "framework";
        if (framework && !document.getElementById("bc-cells-style")) {
          const style = document.createElement("style");
          style.id = "bc-cells-style";
          style.textContent = DOM_CELL_CSS;
          document.head.append(style);
        }
        const app = mount(BenchGrid, {
          target: container,
          props: {
            model,
            extent: framework ? extentOf(fixture, "n4") : undefined,
            ariaLabel: "Benchmark grid",
            headerHeight: HEADER_HEIGHT,
            theme: THEME,
            style: `width: ${GRID_WIDTH}px; height: ${GRID_HEIGHT}px`,
          },
        });
        flushSync();
        return { destroy: () => void unmount(app) };
      },
      options,
    ),
};
