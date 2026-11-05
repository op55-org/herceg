// select()'s conditions before a chart's interaction controller and brush
// have loaded: made at once, each with its condition through derived
// tables. A file of its own, so that nothing on its page
// has loaded the controller or the brush, and this file does not import
// helpers.ts, whose import loads the controller.
import { afterEach, expect, it } from "vitest";
import { derive } from "../../src/data/derive.ts";
import { col } from "../../src/data/expr.ts";
import { table } from "../../src/data/table.ts";
import { createChart, forgetInteraction } from "../../src/dom/chart.ts";
import type { ChartEvents } from "../../src/dom/events.ts";
import { line } from "../../src/marks/line.ts";

const host = document.createElement("div");
host.style.cssText = "width:600px;height:300px";
document.body.append(host);

afterEach(() => {
  forgetInteraction();
  host.remove();
});

it("gives select()'s conditions their source before the controller and the brush load", async () => {
  // The controller never arrives.
  forgetInteraction(() => new Promise(() => {}));
  const days = table({ day: [0, 1, 2, 3, 4], revenue: [5, 1, 7, 8, 2] }, { name: "days" });
  const busy = derive(days).filter(col("revenue").gt(2)).table();
  const chart = createChart(host, {
    renderer: "svg",
    marks: [line(busy, { x: "day", y: "revenue" })],
    interaction: { brush: "x" },
  });
  await chart.ready;
  expect(chart.getPanels()).toHaveLength(1);
  expect(chart.loading).toBeDefined();
  const events: ChartEvents["select"][] = [];
  chart.on("select", (event) => events.push(event));
  chart.select([1, 3]);
  // Reported at once: nothing waits for the brush's module or the controller.
  expect(events).toHaveLength(1);
  const [held] = events[0]!.conditions;
  expect(held?.table).toBe(busy);
  expect(held?.source).toEqual({
    table: "days",
    condition: [
      "and",
      ["and", [">=", ["field", "day"], 1], ["<=", ["field", "day"], 3]],
      [">", ["field", "revenue"], 2],
    ],
  });
  chart.destroy();
});
