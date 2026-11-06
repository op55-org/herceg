// Herceg's grid through `@herceg/react/grid`: the same table, view, and model
// as the plain adapter, with the grid mounted by React (rendered
// synchronously with flushSync). Data, sorting, filtering, scrolling, and
// selection go through the model and table, never React, as the component
// documents. In the React cells scenarios, `cells` draws the cell-bearing
// columns with `ReactCell` (react-cells.tsx) from each cell's value and
// text; n4's bar's domain is adapter code, found from the rows at mount, as
// the other React grids find it; n1's link is a control cell.

import { Grid, type ReactGridCells } from "@herceg/react/grid";
import type { Schema, Table } from "herceg";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { type Adapter, GRID_HEIGHT, GRID_WIDTH, HEADER_HEIGHT } from "../adapter.ts";
import { CELL_FIELDS, DOM_CELL_CSS, extentOf } from "../cells.ts";
import type { GridTable } from "../fixture.ts";
import { ReactCell } from "../react-cells.tsx";
import { hercegHandle, hercegTable, THEME } from "./herceg.ts";

/** The React cells scenarios' cells, by column. */
function reactCells(fixture: GridTable): ReactGridCells<Schema> {
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
        render: (cell) => (
          <ReactCell
            field={field}
            value={cell.value ?? undefined}
            text={cell.text}
            extent={extent}
          />
        ),
      },
    ]),
  );
}

export const adapter: Adapter = {
  id: "herceg-react",
  renderer:
    "DOM rows and cells written through field displays, mounted through @herceg/react/grid (React 19); React cells scenarios: cells through portals",
  processing: { sort: "native (row view)", filter: "native (row view, expression)" },
  prepare: hercegTable,
  mount: (container, fixture, input, options) =>
    hercegHandle(
      container,
      fixture,
      input as Table<Schema>,
      (model) => {
        const root = createRoot(container);
        const cells = options?.cells === "react" ? reactCells(fixture) : undefined;
        flushSync(() =>
          root.render(
            <Grid
              model={model}
              ariaLabel="Benchmark grid"
              headerHeight={HEADER_HEIGHT}
              theme={THEME}
              style={{ width: GRID_WIDTH, height: GRID_HEIGHT }}
              cells={cells}
            />,
          ),
        );
        return { destroy: () => root.unmount() };
      },
      options,
    ),
};
