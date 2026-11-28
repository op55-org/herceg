// Custom marks: custom items over a table and over a sorted view.

import { type RowView, rowView } from "../../src/data/row-view.ts";
import { type Table, table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { custom } from "../../src/marks/custom.ts";
import { ChartModel } from "../../src/model/model.ts";
import { staticCompilers } from "../../src/render/compilers.ts";
import { measure } from "./shared.ts";

export async function run(): Promise<void> {
  // Custom items over a view sorted against its table's order: each item
  // call finds its row's position in its series, over a table by halving
  // and over the view through an index of its positions.
  const SQUARES = 32_000;
  const squareRows = table({
    x: Float64Array.from({ length: SQUARES }, (_, i) => i),
    y: Float64Array.from({ length: SQUARES }, (_, i) => (i * 7919) % 1000),
  });
  type Squares = typeof squareRows extends Table<infer S> ? S : never;
  const squaresOf = (data: Table<Squares> | RowView<Squares>) =>
    custom(data, {
      x: "x",
      y: "y",
      draw({ series, x, y, item, rect }) {
        for (const s of series)
          for (let k = 0; k < s.length; k++) {
            const row = s.rowAt(k);
            item(s, row, () => rect(x(s.x[row]!), y(s.y[row]!), 2, 2));
          }
      },
    });
  for (const [name, data] of [
    ["a table", squareRows],
    ["a descending view", rowView(squareRows, { sort: [{ field: "x", order: "descending" }] })],
  ] as const) {
    const chart = new ChartModel({ marks: [squaresOf(data)] }, undefined, staticCompilers());
    let width = 800;
    measure(
      `custom: 32,000 items over ${name}, scene`,
      () => {
        // A new size each time: the scene is drawn again.
        width = width === 800 ? 801 : 800;
        chart.setSize(width, 600, 1);
        chart.scene(estimateText);
      },
      { warmup: 5, samples: 30 },
    );
  }
}
