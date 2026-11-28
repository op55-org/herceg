// Brushing a scatter of a million rows, with a histogram and a box plot following.

import { category } from "../../src/data/column.ts";
import { col } from "../../src/data/expr.ts";
import { selectionStore, selectWhere } from "../../src/data/selection.ts";
import { table } from "../../src/data/table.ts";
import { estimateText } from "../../src/layout/text.ts";
import { boxplot } from "../../src/marks/boxplot.ts";
import { histogram } from "../../src/marks/histogram.ts";
import { point } from "../../src/marks/point.ts";
import { membershipOf } from "../../src/model/memberships.ts";
import { ChartModel } from "../../src/model/model.ts";
import { rowSelection } from "../../src/model/row-selection.ts";
import { measure, N } from "./shared.ts";

export async function run(): Promise<void> {
  // Brushing a scatter of a million rows, with a histogram and a box plot
  // following it through one selection store: each step moves the brush (a
  // condition on x and y), and every chart draws its next scene. The steps
  // cycle through 20 places, so each one tests the condition again; the box
  // plot's rows are ordered by value once, the first time a selection is drawn.
  const brushed = table({
    x: Float64Array.from({ length: N }, () => Math.random() * 100),
    y: Float64Array.from({ length: N }, () => Math.random() * 100),
    g: category(Array.from({ length: N }, (_, i) => `g${i % 5}`)),
  });
  const focus = selectionStore(brushed);
  const linked = [
    point(brushed, { x: "x", y: "y" }),
    histogram(brushed, { x: "y" }),
    boxplot(brushed, { x: "g", y: "y" }),
  ].map((mark) => {
    const selection = rowSelection({ store: focus, channel: "brush" });
    const chart = new ChartModel({ marks: [mark], rowSelection: selection });
    chart.setSize(600, 400, 1);
    selection.highlight(chart);
    return chart;
  });
  let place = 0;
  const moveBrush = () => {
    const a = 10 + (place++ % 20);
    focus.set(
      "brush",
      selectWhere(
        col("x")
          .ge(a)
          .and(col("x").le(a + 30))
          .and(col("y").ge(20).and(col("y").le(60))),
      ),
    );
  };
  moveBrush();
  for (const chart of linked) chart.scene(estimateText, true);
  measure(
    "row selection: brush 1M points, scatter, histogram, box plot follow",
    () => {
      moveBrush();
      for (const chart of linked) chart.scene(estimateText, true);
    },
    { warmup: 5, samples: 30 },
  );
  const brushMembership = membershipOf(focus as never, "brush");
  measure(
    "row selection: brush 1M points, membership alone",
    () => {
      moveBrush();
      void brushMembership.selected;
    },
    { warmup: 5, samples: 30 },
  );
}
