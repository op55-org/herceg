// The built-in tooltip's content: fields of the row it is at, and content
// of the application's own (`renderTooltip`) in its box.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart, MountedChart } from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import type { Inspection } from "../../src/model/model.ts";

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

/** A chart that has loaded what reads tooltip fields and draws content of its own. */
async function mount(options: ChartOptions): Promise<Chart> {
  const chart = createChart(host, { locale: "en-US", ...options });
  charts.push(chart);
  await chart.loading;
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

const requests = () =>
  table({ t: [0, 1, 2], p99: [210, 304, 250], requests: [9_800, 12_480, 11_020] });

describe("the tooltip", () => {
  it("shows the fields of the row under its point's value, as the keyboard reads them", async () => {
    const chart = await mount({
      marks: [
        line(requests(), {
          x: "t",
          y: "p99",
          tooltip: { fields: [{ field: "requests", label: "Requests" }] },
        }),
      ],
      y: { tooltipFormat: { style: "unit", unit: "millisecond" } },
    });
    hover(chart, 1);
    expect(rows(chart)).toEqual(["1", "p99304 ms", "Requests12,480"]);
    // A field's row has no swatch of its own: it is part of the point above.
    const [, point, field] = box(chart)!.children as unknown as HTMLElement[];
    const swatch = (row: HTMLElement) => (row.firstChild as HTMLElement).style.background;
    expect(swatch(point!)).not.toBe("none");
    expect(swatch(field!)).toBe("none");
    key(chart, "ArrowRight");
    expect(chart.root.querySelector("[aria-live]")!.textContent).toBe(
      "0. p99: 210 ms, Requests: 9,800",
    );
  });

  it("shows content of the application's own in its box, as text or a node", async () => {
    const seen: Inspection[] = [];
    const chart = await mount({
      marks: [line(requests(), { x: "t", y: "p99" })],
      renderTooltip: (inspection) => {
        seen.push(inspection);
        return `<b>${inspection.points[0]!.text}</b>`;
      },
    });
    hover(chart, 1);
    // Text is never parsed as markup.
    expect(box(chart)!.textContent).toBe("<b>304</b>");
    expect(box(chart)!.querySelector("b")).toBeNull();
    // Called when what the tooltip is at changes, not on every move.
    hover(chart, 1);
    expect(seen).toHaveLength(1);
    hover(chart, 2);
    expect(seen.map((inspection) => inspection.value)).toEqual([1, 2]);
    // The crosshair stays, and the keyboard reads the inspection.
    expect(chart.root.querySelector("svg line")!.getAttribute("visibility")).toBe("visible");
    key(chart, "ArrowRight");
    expect(chart.root.querySelector("[aria-live]")!.textContent).toBe("0. p99: 210");

    const node = document.createElement("strong");
    node.textContent = "own";
    chart.update({ renderTooltip: (inspection) => (inspection.value === 2 ? node : null) });
    hover(chart, 2);
    expect(box(chart)!.firstElementChild).toBe(node);
    // Null shows the built-in content.
    hover(chart, 0);
    expect(rows(chart)).toEqual(["0", "p99210"]);
    chart.update({ renderTooltip: undefined });
    hover(chart, 2);
    expect(rows(chart)).toEqual(["2", "p99250"]);
  });

  it("asks for content again when the data it was inspected on changes, the inspection alike", async () => {
    const data = table({ t: [0, 1, 2], p99: [210, 304, 250], host: ["a", "b", "c"] });
    const chart = await mount({
      marks: [line(data, { x: "t", y: "p99" })],
      renderTooltip: (inspection) => `on ${data.value("host", inspection.points[0]!.row!)}`,
    });
    hover(chart, 1);
    expect(box(chart)!.textContent).toBe("on b");
    // The same times and values, of other hosts: the inspection reads as before.
    data.reset({ t: [0, 1, 2], p99: [210, 304, 250], host: ["x", "y", "z"] });
    chart.render();
    expect(box(chart)!.textContent).toBe("on y");
  });

  it("never asks for content of an inspection whose data a hover listener changed", async () => {
    const data = table({ t: [0, 1, 2], p99: [210, 304, 250], host: ["a", "b", "c"] });
    const chart = await mount({
      marks: [line(data, { x: "t", y: "p99" })],
      renderTooltip: (inspection) => `on ${data.value("host", inspection.points[0]!.row!)}`,
    });
    // Row 2 is gone before the tooltip would show it, and the chart drew that.
    const stop = chart.on("hover", () => {
      stop();
      data.reset({ t: [0], p99: [210], host: ["a"] });
      chart.render();
    });
    hover(chart, 2);
    chart.render();
    expect(box(chart)!.textContent).toBe("on a");
  });

  it("leaves the tooltip to a frame a hover listener drew", async () => {
    const data = table({ t: [0, 1, 2], p99: [210, 304, 250], host: ["a", "b", "c"] });
    const chart = await mount({
      marks: [line(data, { x: "t", y: "p99" })],
      interaction: { zoom: "x" },
      renderTooltip: (inspection) => `on ${data.value("host", inspection.points[0]!.row!)}`,
    });
    // It zooms in to the start: the pointer is over row 0 or 1 of that view.
    const stop = chart.on("hover", () => {
      stop();
      chart.setViewport([0, 1]);
      chart.render();
    });
    hover(chart, 2);
    expect(box(chart)!.textContent).not.toBe("on c");
  });

  it("never asks for content of an inspection whose data an edge listener changed", async () => {
    const data = table({ t: [0, 1, 2], p99: [210, 304, 250], host: ["a", "b", "c"] });
    const chart = await mount({
      marks: [line(data, { x: "t", y: "p99" })],
      interaction: { zoom: "x", limits: { x: { extent: [0, 2], edge: true } } },
      renderTooltip: (inspection) => `on ${data.value("host", inspection.points[0]!.row!)}`,
    });
    hover(chart, 2);
    expect(box(chart)!.textContent).toBe("on c");
    // A view near the end: its listener drops row 2 before the tooltip would read it.
    const stop = chart.on("edge", () => data.reset({ t: [0], p99: [210], host: ["a"] }));
    chart.setViewport([1, 2]);
    chart.render();
    stop();
    chart.render();
    expect(box(chart)?.textContent ?? "").not.toBe("on c");
  });

  it("keeps a fragment's content, asking for it again only when what it is at changes", async () => {
    let calls = 0;
    const chart = await mount({
      marks: [line(requests(), { x: "t", y: "p99" })],
      renderTooltip: (inspection) => {
        calls++;
        const content = document.createDocumentFragment();
        content.append("at ", document.createElement("b"));
        content.lastChild!.textContent = String(inspection.value);
        return content;
      },
    });
    hover(chart, 1);
    hover(chart, 1);
    expect([box(chart)!.textContent, calls]).toEqual(["at 1", 1]);
    hover(chart, 2);
    expect([box(chart)!.textContent, calls]).toEqual(["at 2", 2]);
  });

  it("loads nothing into a chart destroyed meanwhile, and stops watching its box on destroy", async () => {
    const observed: [ResizeObserver, Element][] = [];
    const stopped: ResizeObserver[] = [];
    const observe = ResizeObserver.prototype.observe;
    const disconnect = ResizeObserver.prototype.disconnect;
    vi.spyOn(ResizeObserver.prototype, "observe").mockImplementation(function (
      this: ResizeObserver,
      target,
      options,
    ) {
      observed.push([this, target]);
      observe.call(this, target, options);
    });
    vi.spyOn(ResizeObserver.prototype, "disconnect").mockImplementation(function (
      this: ResizeObserver,
    ) {
      stopped.push(this);
      disconnect.call(this);
    });
    const marks = [line(requests(), { x: "t", y: "p99", tooltip: { fields: ["requests"] } })];
    const early = createChart(host, { marks });
    const loading = early.loading;
    early.destroy();
    await loading;
    expect(MountedChart.modelOf(early).fields).toBeUndefined();
    const late = await mount({ marks, renderTooltip: () => "own" });
    const box = late.root.querySelector('div[aria-hidden="true"]')!;
    const watching = observed.filter(([, target]) => target === box).map(([observer]) => observer);
    expect(watching).toHaveLength(1);
    late.destroy();
    expect(stopped).toContain(watching[0]);
    vi.restoreAllMocks();
  });

  it("places content of its own as the built-in content, inside the chart", async () => {
    const chart = await mount({
      marks: [line(requests(), { x: "t", y: "p99" })],
      renderTooltip: () => "a long piece of content of the application's own",
    });
    hover(chart, 2);
    const tip = box(chart)!.getBoundingClientRect();
    const root = chart.root.getBoundingClientRect();
    expect(tip.width).toBeGreaterThan(100);
    expect(tip.right).toBeLessThanOrEqual(root.right);
    expect(tip.left).toBeGreaterThanOrEqual(root.left);
  });
});
