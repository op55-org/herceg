// Compile-time tests of the grid components in TSX (`jsxImportSource:
// "vue"`), run by `npm run typecheck`: JSX checks a component as templates
// do, so the schema is inferred from `model`, and `cells` follows it.
import { rowView, table } from "herceg";
import { createGridModel } from "herceg/grid";
import { Grid } from "../src/grid.ts";

const requests = table({ latency: new Float64Array(3), host: ["a", "b", "c"] });
const model = createGridModel({
  data: rowView(requests),
  columns: [{ field: "host" }, { field: "latency" }, { id: "open", title: "" }],
});

export const Requests = () => (
  <Grid
    model={model}
    ariaLabel="Requests"
    cells={{
      open: {
        fields: ["host", "latency"],
        interaction: "control",
        render: (cell) => {
          const latency: number | null = cell.read("latency");
          // @ts-expect-error read gives a field's own kind
          const wrong: string | null = cell.read("latency");
          return <button type="button">{`${latency} ${wrong}`}</button>;
        },
      },
    }}
    onRowClick={({ ref }) => ref.id}
  />
);

export const WrongField = () => (
  <Grid
    model={model}
    ariaLabel="Requests"
    cells={{
      // @ts-expect-error a field the grid's table lacks
      open: { fields: ["hots"], render: () => null },
    }}
  />
);

// @ts-expect-error grids need an accessible name
export const Unnamed = () => <Grid model={model} />;
