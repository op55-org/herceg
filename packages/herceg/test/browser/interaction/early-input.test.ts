// Input before a chart's first frame, while it waits for code (the guides'
// compiler): kept, and played once the panels it lands in are drawn, though
// the page has the controller already. Alone in its file, so that nothing
// has loaded that compiler yet.
import { expect, it } from "vitest";
import { columns, panel } from "../../../src/layout.ts";
import { line } from "../../../src/marks/line.ts";
import { panels } from "../../../src/model/panels.ts";
import { drag, mount, mountNow, rows } from "./helpers.ts";

it("pans once the chart has drawn the panel a drag started in", async () => {
  const data = rows();
  // A chart that loads the controller, and not the guides' compiler.
  await mount({ marks: [line(data, { x: "t", y: "v" })] });
  const chart = mountNow({
    marks: [
      // Painted out of the marks' order, which the guides' compiler plans.
      line(data, { x: "t", y: "v", panel: "now", zIndex: 1 }),
      line(data, { x: "t", y: "w", panel: "before" }),
    ],
    panels: panels(columns([1, 1], [panel("now"), panel("before")])),
    x: { scope: "panel" },
    interaction: { pan: "x" },
  });
  expect(chart.loading).toBeDefined();
  // In the left half of the chart's 640 pixels, which panel "now" fills.
  drag(chart, [
    [160, 200],
    [130, 200],
    [100, 200],
  ]);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  expect(chart.getViewport({ panel: "now" }).x).not.toBeNull();
  expect(chart.getViewport({ panel: "before" }).x).toBeNull();
});
