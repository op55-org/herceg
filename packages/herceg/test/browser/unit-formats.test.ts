// Durations, SI and binary prefixes, and text around number patterns in
// live charts: axes load the guide compiler for them, tooltip fields and
// gauges write them, and every engine writes them as static output does.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { gauge } from "../../src/marks/gauge.ts";
import { line } from "../../src/marks/line.ts";
import { renderToSVG } from "../../src/render/static.ts";

let host: HTMLDivElement;
const charts: Chart[] = [];

beforeEach(() => {
  host = document.createElement("div");
  host.style.cssText = "width:600px;height:300px";
  document.body.append(host);
});

afterEach(() => {
  for (const chart of charts.splice(0)) chart.destroy();
  host.remove();
});

async function mount(options: ChartOptions): Promise<Chart> {
  const chart = createChart(host, { locale: "en-US", ...options });
  charts.push(chart);
  await chart.loading;
  return chart;
}

const usage = () =>
  table({ t: [0, 1, 2, 3], ms: [450, 66_000, 95_000, 120_000], bytes: [0, 1e6, 2e6, 1_572_864] });
const texts = (root: Element) =>
  [...root.querySelectorAll("svg text")].map((text) => text.textContent).filter(Boolean);
const rows = (chart: Chart) =>
  [
    ...([...chart.root.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')].find(
      (div) => div.style.display === "block",
    )?.children ?? []),
  ].map((row) => row.textContent);

describe("formats of every form in live charts", () => {
  it("write axes' ticks and tooltip rows and fields as static output does", async () => {
    const options: ChartOptions = {
      y: { format: { duration: "millisecond" } },
      marks: [
        line(usage(), {
          x: "t",
          y: "ms",
          tooltip: { fields: [{ field: "bytes", label: "Memory", format: { binary: "B" } }] },
        }),
      ],
    };
    const chart = await mount(options);
    expect(texts(chart.root)).toEqual(expect.arrayContaining(["0ms", "20s", "1m", "1m 20s", "2m"]));
    const svg = renderToSVG({ locale: "en-US", width: 600, height: 300, ...options });
    for (const label of ["0ms", "20s", "1m 20s", "2m"]) expect(svg).toContain(`>${label}<`);
    // The tooltip reads the axis' format, and the field its own.
    const { plot } = chart.getPanels()[0]!;
    const rect = chart.root.getBoundingClientRect();
    chart.root.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: rect.left + chart.toPixel(3, { axis: "x" })!,
        clientY: rect.top + plot.y + plot.height / 2,
      }),
    );
    chart.render();
    expect(rows(chart)).toEqual(["3", "ms2m", "Memory1.5 MiB"]);
  });

  it("write gauges' values and ends", async () => {
    const chart = await mount({
      marks: [gauge(usage(), { value: "bytes", max: 4e6, format: { si: "B" } })],
    });
    expect(texts(chart.root)).toEqual(expect.arrayContaining(["1.6 MB", "0 B", "4 MB"]));
  });
});
