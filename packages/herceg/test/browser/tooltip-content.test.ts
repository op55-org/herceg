// Tooltip content (`tooltip.content`): each point's row written from label
// parts when the chart inspects, drawn in the tooltip in its parts'
// styles, and read by the keyboard. What writes it loads as the first frame
// of a chart whose marks have content or fields draws, and only then; the
// frame does not wait for it, tooltips, announcements, and `ready` do.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { encodedCategory, time } from "../../src/data/column.ts";
import { orderedTable } from "../../src/data/ordered.ts";
import { table } from "../../src/data/table.ts";
import {
  type Chart,
  type ChartOptions,
  createChart,
  forgetWriters,
  loadInteraction,
} from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import { LOADED } from "../../src/model/guides.ts";
import { contractTest } from "../helpers/contracts.ts";

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

function made(options: ChartOptions): Chart {
  const chart = createChart(host, { locale: "en-US", timeZone: "UTC", ...options });
  charts.push(chart);
  return chart;
}

async function mount(options: ChartOptions): Promise<Chart> {
  const chart = made(options);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  return chart;
}

function hover(chart: Chart, x: number) {
  const { plot } = chart.getPanels()[0]!;
  const rect = chart.root.getBoundingClientRect();
  const px = chart.toPixel(x, { axis: "x" })!;
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", {
      bubbles: true,
      clientX: rect.left + px,
      clientY: rect.top + plot.y + plot.height / 2,
    }),
  );
  chart.render();
}

const box = (chart: Chart) =>
  [...chart.root.querySelectorAll<HTMLElement>('div[aria-hidden="true"]')].find(
    (div) => div.style.display === "block",
  );
const rows = (chart: Chart) => [...(box(chart)?.children ?? [])].map((row) => row.textContent);
const key = (chart: Chart, name: string) =>
  chart.root.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
const said = (chart: Chart) => chart.root.querySelector("[aria-live]")!.textContent;
const written = (chart: Chart) =>
  chart
    .inspect(chart.toPixel(start, { axis: "x" })!, 150)
    ?.points[0]?.content?.map((run) => run.text)
    .join("");
/** Waits past the frame and timeout after which a chart attaches its controller. */
const settle = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
const importWriters = () =>
  import("../../src/marks/tooltip-writers.ts").then((module) => module.tooltipWriters);
/** The writers' import, held until `arrive` is called. */
function holdWriters(): () => void {
  let arrive!: () => void;
  const arrived = new Promise<void>((resolve) => {
    arrive = resolve;
  });
  forgetWriters(() => arrived.then(importWriters));
  return arrive;
}

const SERIES = ["pump-a", "pump-b", "flow"] as const;
const start = Date.UTC(2026, 9, 1, 11, 42, 7, 318);
/** A7's observations: every series in one ordered table, each at its own times. */
function observations() {
  const times: number[] = [];
  const codes: number[] = [];
  const values: number[] = [];
  for (let i = 0; i < 20; i++)
    for (const [s] of SERIES.entries()) {
      times.push(start + i * 1_000 + s * 40);
      codes.push(s);
      values.push(100 * (s + 1) + i + 0.31);
    }
  return orderedTable(
    {
      time: time(Float64Array.from(times)),
      series: encodedCategory(Int32Array.from(codes), SERIES),
      value: Float64Array.from(values),
    },
    { orderBy: "time" },
  );
}
const row = [
  { series: true, style: { fontWeight: 600 } },
  " ",
  { value: true, format: { number: ".1f" } },
  " ",
  { field: "time", format: { time: "%H:%M:%S.%L" } },
] as const;

describe("tooltip content", () => {
  contractTest(
    "tooltip.content.loading.engine",
    async () => {
      const plain = made({ marks: [line(table({ t: [0, 1], v: [1, 2] }), { x: "t", y: "v" })] });
      await plain.ready;
      expect(LOADED[3]).toBeUndefined();
      expect(plain.inspect(plain.toPixel(1, { axis: "x" })!, 150)?.points[0]?.text).toBe("2");
      // The writers held, with the controller on the page: the first frame
      // draws as the chart is made, and input waits for them.
      await loadInteraction();
      const arrive = holdWriters();
      try {
        const chart = made({
          inspection: { mode: "nearest-x", snap: "each" },
          marks: [
            line(observations(), {
              x: "time",
              y: "value",
              series: "series",
              tooltip: { content: row, fields: ["series"] },
            }),
          ],
        });
        let ready = false;
        void chart.ready.then(() => {
          ready = true;
        });
        const [early] = chart.inspect(chart.toPixel(start, { axis: "x" })!, 150)!.points;
        expect(early).toMatchObject({ label: "pump-a" });
        expect(early!.content).toBeUndefined();
        expect(early!.fields).toBeUndefined();
        // Exports, which inspect nothing, need not wait for them.
        expect(chart.toSVG()).toMatch(/^<svg /);
        hover(chart, start);
        chart.root.focus();
        key(chart, "ArrowRight");
        await settle();
        // No tooltip and nothing said in the default text before they arrive.
        expect(box(chart)).toBeUndefined();
        expect(said(chart)).toBe("");
        expect(ready).toBe(false);
        expect(chart.loading).toBeDefined();
        arrive();
        await chart.ready;
        expect(written(chart)).toBe("pump-a 100.3 11:42:07.318");
        const [first] = chart.inspect(chart.toPixel(start, { axis: "x" })!, 150)!.points;
        expect(first!.fields?.map((field) => field.text)).toEqual(["pump-a"]);
        // The input that came first plays, written as the marks ask.
        for (let loading = chart.loading; loading; loading = chart.loading) await loading;
        chart.render();
        expect(said(chart)).toMatch(/^pump-a 100\.3 11:42:07\.318 at /);
        expect(rows(chart)).toContain("pump-a 100.3 11:42:07.318");
      } finally {
        forgetWriters(importWriters);
      }
    },
    "draws the first frame without its writers, which only marks with content or fields load, and holds tooltips, announcements, and ready for them",
  );

  it("reports writers that cannot load as code a chart loads, rejecting ready", async () => {
    await loadInteraction();
    forgetWriters(() => Promise.reject(new Error("the network is down")));
    const errors: unknown[] = [];
    try {
      const chart = made({
        onError: (error) => errors.push(error),
        inspection: { mode: "nearest-x", snap: "each" },
        marks: [
          line(observations(), {
            x: "time",
            y: "value",
            series: "series",
            tooltip: { content: row },
          }),
        ],
      });
      // Drawn without them first.
      expect(chart.inspect(chart.toPixel(start, { axis: "x" })!, 150)?.points[0]).toBeDefined();
      await expect(chart.ready).rejects.toMatchObject({ phase: "load" });
      expect(errors).toHaveLength(1);
      expect(chart.root.querySelector('[role="alert"]')).not.toBeNull();
    } finally {
      forgetWriters(importWriters);
    }
  });

  it("draws an update that first needs the writers at once, its controller attached", async () => {
    await loadInteraction();
    const arrive = holdWriters();
    try {
      const chart = await mount({
        inspection: { mode: "nearest-x", snap: "each" },
        marks: [line(observations(), { x: "time", y: "value", series: "series" })],
      });
      chart.update({
        marks: [
          line(observations(), {
            x: "time",
            y: "value",
            series: "series",
            tooltip: { content: row },
          }),
          line(observations(), { x: "time", y: "value", series: "series", strokeWidth: 3 }),
        ],
      });
      chart.render();
      const loading = chart.loading;
      expect(loading).toBeDefined();
      // Drawn at once: the second mark is inspected before the writers arrive.
      expect(chart.inspect(chart.toPixel(start, { axis: "x" })!, 150)!.points).toHaveLength(6);
      expect(written(chart)).toBeUndefined();
      arrive();
      await loading;
      expect(written(chart)).toBe("pump-a 100.3 11:42:07.318");
    } finally {
      forgetWriters(importWriters);
    }
  });

  contractTest(
    "tooltip.content.engine",
    async () => {
      const chart = await mount({
        inspection: { mode: "nearest-x", snap: "each", within: { milliseconds: 30_000 } },
        marks: [
          line(observations(), {
            x: "time",
            y: "value",
            series: "series",
            tooltip: { content: row, fields: [{ field: "series", label: "Name" }] },
          }),
        ],
      });
      hover(chart, start + 5_000);
      const [, ...lines] = rows(chart);
      expect(lines).toEqual([
        "pump-a 105.3 11:42:12.318",
        "Namepump-a",
        "pump-b 205.3 11:42:12.358",
        "Namepump-b",
        "flow 305.3 11:42:12.398",
        "Nameflow",
      ]);
      // The swatch stays; each part is a run in its part's style.
      const point = box(chart)!.children[1] as HTMLElement;
      const [swatch, text] = [...point.children] as HTMLElement[];
      expect(swatch!.style.background).not.toBe("none");
      const runs = [...text!.children] as HTMLElement[];
      expect(runs.map((run) => run.textContent)).toEqual([
        "pump-a",
        " ",
        "105.3",
        " ",
        "11:42:12.318",
      ]);
      expect(runs[0]!.style.fontWeight).toBe("600");
      expect(runs[2]!.style.fontWeight).toBe("");
    },
    "shows A7's rows: one line of parts each, in series order, styled, with fields under it",
  );

  contractTest(
    "tooltip.content.keyboard.engine",
    async () => {
      const chart = await mount({
        inspection: { mode: "nearest-x", snap: "each", within: { milliseconds: 30_000 } },
        marks: [
          line(observations(), {
            x: "time",
            y: "value",
            series: "series",
            tooltip: { content: row },
          }),
        ],
      });
      chart.root.focus();
      key(chart, "ArrowRight");
      // The row whole in place of the name and value, then where it is.
      expect(said(chart)).toMatch(/^pump-a 100\.3 11:42:07\.318 at /);
      key(chart, "ArrowRight");
      expect(said(chart)).toMatch(/^pump-a 101\.3 11:42:08\.318 at /);
      // Up to the series drawn above it (pump-a is lowest).
      key(chart, "ArrowUp");
      expect(said(chart)).toMatch(/^pump-b 201\.3 11:42:08\.358, 2 of 3 at /);
      key(chart, "i");
      expect(said(chart)).toMatch(
        /^3 series at .*: pump-a 101\.3 11:42:08\.318; pump-b 201\.3 11:42:08\.358; flow 301\.3 11:42:08\.398$/,
      );
    },
    "is what the keyboard reads, arriving and with i",
  );
});
