// Tooltip totals and paths in the chart: the built-in box draws a mark's
// total as a bold row after its points, without a swatch, and a tree's
// path part as content does; hover and click events, `chart.inspect()`,
// `renderTooltip`, and the keyboard's `i` read the totals.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { bar } from "../../src/marks/bar.ts";
import { line } from "../../src/marks/line.ts";
import { sunburst } from "../../src/marks/sunburst.ts";
import type { AxisInspection, Inspection } from "../../src/model/model.ts";
import { contractTest } from "../helpers/contracts.ts";
import { modelOf } from "./helpers.ts";

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
  const chart = createChart(host, { locale: "en-US", timeZone: "UTC", ...options });
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

/** Moves the pointer to pixel (`px`, `py`) of the chart, waits for what it loads, and draws. */
async function point(chart: Chart, px: number, py: number, type = "pointermove") {
  const rect = chart.root.getBoundingClientRect();
  chart.root.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      clientX: rect.left + px,
      clientY: rect.top + py,
      pointerType: "mouse",
      button: 0,
    }),
  );
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  chart.render();
}

/** Points at `x` on the x axis, at the plot's middle. */
const at = (chart: Chart, x: number, type?: string) => {
  const { plot } = chart.getPanels()[0]!;
  return point(chart, chart.toPixel(x, { axis: "x" })!, plot.y + plot.height / 2, type);
};

const box = (chart: Chart) =>
  [...chart.root.children].find(
    (child): child is HTMLDivElement =>
      child instanceof HTMLDivElement &&
      child.style.padding === "8px 10px" &&
      child.style.display === "block",
  );
/** The box's rows, its heading first where it has one. */
const rows = (chart: Chart) => [...(box(chart)?.children ?? [])] as HTMLElement[];
const key = (chart: Chart, name: string) =>
  chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
const said = (chart: Chart) => chart.root.querySelector("[aria-live]")!.textContent;

/** Three regions' revenue over three days. */
const revenue = () =>
  table({
    day: [1, 1, 1, 2, 2, 2, 3],
    region: ["north", "south", "west", "north", "south", "west", "north"],
    revenue: [100, 80, 70, 120, 90, 60, 110],
    units: [10, 8, 7, 12, 9, 6, 11],
  });

/** A flare-like tree three levels deep. */
const classes = () =>
  table({
    level1: ["vis", "vis", "vis", "util"],
    level2: ["data", "data", "events", "math"],
    level3: ["Data", "Tuple", "Event", "Arrays"],
    size: [3000, 1000, 2000, 500],
  });

describe("tooltip totals", () => {
  contractTest(
    "tooltip.total.box.engine",
    async () => {
      const chart = await mount({
        marks: [
          line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
          bar(revenue(), {
            x: "day",
            y: "units",
            series: "region",
            axis: "right",
            tooltip: { total: { label: "Units" } },
          }),
        ],
      });
      await at(chart, 1);
      const shown = rows(chart);
      // The place, three lines, their total, three bars, theirs.
      expect(shown.map((row) => row.textContent)).toEqual([
        "1",
        "north100",
        "south80",
        "west70",
        "Total250",
        "north10",
        "south8",
        "west7",
        "Units25",
      ]);
      for (const total of [shown[4]!, shown[8]!]) {
        const [swatch, label, value] = total.children as unknown as HTMLElement[];
        // No swatch in its place; the label and value bold, in the text's color.
        expect(getComputedStyle(swatch!).backgroundColor).toBe("rgba(0, 0, 0, 0)");
        expect(swatch!.getBoundingClientRect().width).toBe(8);
        expect(getComputedStyle(label!).fontWeight).toBe("600");
        expect(getComputedStyle(value!).fontWeight).toBe("600");
        expect(getComputedStyle(label!).color).toBe(getComputedStyle(shown[1]!.children[1]!).color);
        // Label left, value right, as fields' rows.
        expect(value!.getBoundingClientRect().right).toBeCloseTo(
          (shown[1]!.children[2] as HTMLElement).getBoundingClientRect().right,
          0,
        );
      }
    },
    "draws each mark's total after its points, bold and without a swatch",
  );

  contractTest(
    "inspection.totals.events.engine",
    async () => {
      const told: Inspection[] = [];
      const hovered: (Inspection | undefined)[] = [];
      const clicked: (Inspection | undefined)[] = [];
      const chart = await mount({
        tooltip: { pin: "click" },
        renderTooltip: (inspection) => {
          told.push(inspection);
          return `All: ${(inspection as AxisInspection).totals?.[0]?.text ?? "–"}`;
        },
        marks: [
          line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
        ],
      });
      chart.on("hover", ({ inspection }) => hovered.push(inspection));
      chart.on("click", ({ inspection }) => clicked.push(inspection));
      const total = { mark: 0, label: "Total", value: 250, text: "250", count: 3 };
      const { plot } = chart.getPanels()[0]!;
      expect(
        (chart.inspect(chart.toPixel(1, { axis: "x" })!, plot.y + 10) as AxisInspection).totals,
      ).toMatchObject([total]);
      await at(chart, 1);
      expect(hovered.at(-1)).toMatchObject({ totals: [total] });
      expect(told.at(-1)).toMatchObject({ totals: [total] });
      expect(box(chart)!.textContent).toBe("All: 250");
      await at(chart, 1, "pointerdown");
      await at(chart, 1, "pointerup");
      expect(clicked.at(-1)).toMatchObject({ totals: [total] });
    },
    "carries totals in chart.inspect(), hover and click events, and renderTooltip",
  );

  contractTest(
    "tooltip.total.keyboard.engine",
    async () => {
      const chart = await mount({
        marks: [
          line(revenue(), { x: "day", y: "revenue", series: "region", tooltip: { total: true } }),
          line(revenue(), { x: "day", y: "units", series: "region" }),
        ],
      });
      chart.root.focus();
      key(chart, "ArrowRight");
      for (let loading = chart.loading; loading; loading = chart.loading) await loading;
      chart.render();
      key(chart, "i");
      expect(said(chart)).toBe(
        "6 series at 1: north 100; south 80; west 70; Total 250; north 10; south 8; west 7",
      );
    },
    "reads each mark's total after its points",
  );

  contractTest(
    "tooltip.path.box.engine",
    async () => {
      // B3: the path line and the value line, under no heading.
      const chart = await mount({
        tooltip: { heading: false },
        marks: [
          sunburst(classes(), {
            path: ["level1", "level2", "level3"],
            value: "size",
            levels: 3,
            tooltip: {
              content: [
                "flare/",
                { path: true, separator: "/" },
                "\n",
                { value: true, format: { number: ",d" } },
              ],
            },
          }),
        ],
      });
      const model = modelOf(chart);
      const result = model.items!.result()!;
      for (let i = 0; i < result.count; i++) {
        const [read] = model.inspectItem(result.item(i).key)!.points;
        if (read!.label !== "vis / data / Data") continue;
        await point(chart, read!.px, read!.py);
      }
      const [only, ...rest] = rows(chart);
      expect(rest).toEqual([]);
      expect(only!.textContent).toBe("flare/vis/data/Data\n3,000");
      // Two lines beside its swatch.
      const [swatch, label] = only!.children as unknown as HTMLElement[];
      expect(getComputedStyle(swatch!).backgroundColor).not.toBe("rgba(0, 0, 0, 0)");
      const size = Number.parseFloat(getComputedStyle(label!).fontSize);
      expect(label!.getBoundingClientRect().height).toBeGreaterThan(2 * size);
    },
    "writes B3's path line and value line in the box",
  );
});
