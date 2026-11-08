// Charts load what moves custom marks' values only when they have custom
// marks: bars, points, and lines animating values never download it. This
// file loads its modules afresh, so what the page fetched tells.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { bar } from "../../src/marks/bar.ts";
import { custom } from "../../src/marks/custom.ts";
import { line } from "../../src/marks/line.ts";
import { point } from "../../src/marks/point.ts";

const charts: Chart[] = [];

beforeAll(() => {
  // Modules fetched from here on fit in the page's record of what it fetched.
  performance.clearResourceTimings();
  performance.setResourceTimingBufferSize(10_000);
});

afterEach(() => {
  for (const chart of charts.splice(0)) {
    const host = chart.root.parentElement;
    chart.destroy();
    host?.remove();
  }
});

/**
 * Whether the page fetched the module of `dom/` named `name`. Engines may
 * record a fetch a task after its module runs (WebKit under load), so
 * fetches expected are waited for.
 */
const fetched = (name: string) =>
  performance
    .getEntriesByType("resource")
    .some((entry) => new URL(entry.name).pathname.endsWith(`/src/dom/${name}`));

async function mount(options: Partial<ChartOptions>): Promise<Chart> {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:0;top:0;width:600px;height:300px";
  document.body.append(host);
  const chart = createChart(host, { animation: { values: true }, marks: [], ...options });
  charts.push(chart);
  chart.render();
  await chart.loading;
  return chart;
}

describe("what moves custom marks' values", () => {
  it("is never fetched by bar, point, and line charts animating values", async () => {
    const sales = table({ region: ["N", "S"], sales: [10, 30] });
    const series = table({ t: [0, 1, 2], v: [1, 3, 2] });
    await mount({ marks: [bar(sales, { x: "region", y: "sales" })] });
    await mount({ marks: [point(series, { x: "t", y: "v" }), line(series, { x: "t", y: "v" })] });
    sales.setColumn("sales", [30, 10]);
    series.setColumn("v", [2, 1, 3]);
    for (const chart of charts) chart.render();
    await expect.poll(() => fetched("value-transition.ts")).toBe(true);
    expect(fetched("value-custom.ts")).toBe(false);
  });

  it("is fetched for a chart with a custom mark animating values, which `loading` waits for", async () => {
    const data = table({ id: ["a"], start: [1], end: [2] });
    await mount({
      marks: [
        custom(data, {
          x: ["start", "end"],
          y: "id",
          draw: ({ series, x, y, path }) => {
            for (const s of series) path(`M${x(s.x[0]!)},${y(s.y[0]!)}`);
          },
        }),
      ],
    });
    await expect.poll(() => fetched("value-custom.ts")).toBe(true);
  });
});
