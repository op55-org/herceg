// Links of field displays in tooltips: written as text while the tooltip
// follows the pointer, links once it is pinned (http, https, mailto, and
// relative URLs only, opening beside the chart), reached by the keyboard,
// and kept in focus as the pinned content is drawn again.
import "./interactive.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { category } from "../../src/data/column.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import type { FieldDisplays } from "../../src/fields.ts";
import { line } from "../../src/marks/line.ts";
import { MOUSE } from "./helpers.ts";

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

const data = () =>
  table({
    t: [0, 1, 2, 3],
    v: [1, 3, 2, 5],
    trace: category(["4bf92f35", "a b/c", null, "d"]),
    scheme: category(["https", "javascript", "https", "data"]),
  });

const fields: FieldDisplays = {
  trace: {
    label: "Trace",
    link: {
      url: [{ field: "scheme" }, "://traces.example.com/t/", { value: true }],
      text: ["Trace ", { value: true }],
    },
  },
};

async function mount(options: Partial<ChartOptions> = {}): Promise<Chart> {
  const chart = createChart(host, {
    errorMode: "throw",
    renderer: "svg",
    locale: "en-US",
    fields,
    marks: [line(data(), { x: "t", y: "v", tooltip: { fields: ["trace"] } })],
    tooltip: { pin: "click" },
    ...options,
  });
  charts.push(chart);
  for (let loading = chart.loading; loading; loading = chart.loading) await loading;
  chart.render();
  return chart;
}

/** The chart's pixel of data (x, y), in the page. */
function pixel(chart: Chart, x: number, y: number): [number, number] {
  const rect = chart.root.getBoundingClientRect();
  return [
    rect.left + chart.toPixel(x, { axis: "x" })!,
    rect.top + chart.toPixel(y, { axis: "y" })!,
  ];
}

function hover(chart: Chart, x: number, y: number) {
  const [clientX, clientY] = pixel(chart, x, y);
  chart.root.dispatchEvent(
    new PointerEvent("pointermove", { bubbles: true, clientX, clientY, pointerId: MOUSE }),
  );
  chart.render();
}

function click(chart: Chart, x: number, y: number) {
  const [clientX, clientY] = pixel(chart, x, y);
  for (const type of ["pointerdown", "pointerup"])
    chart.root.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX, clientY, pointerId: MOUSE, button: 0 }),
    );
  chart.root.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX, clientY }));
  chart.render();
}

function key(target: Element, name: string) {
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }),
  );
}

/** The chart's own tooltip box: the first child of its root padded as tooltips are. */
const tooltipOf = (chart: Chart) =>
  [...chart.root.children].find(
    (child): child is HTMLDivElement =>
      child instanceof HTMLDivElement && child.style.padding === "8px 10px",
  )!;

describe("a tooltip field's link", () => {
  it("is its text while the tooltip follows the pointer", async () => {
    const chart = await mount();
    hover(chart, 0, 1);
    const tip = tooltipOf(chart);
    expect(tip.style.display).toBe("block");
    expect(tip.textContent).toContain("Trace 4bf92f35");
    expect(tip.querySelector("a")).toBeNull();
  });

  it("is a link once pinned, opening beside the chart, and text again once let go", async () => {
    const chart = await mount();
    const hovers: unknown[] = [];
    chart.on("hover", ({ inspection }) => hovers.push(inspection?.points[0]?.fields?.[0]?.link));
    click(chart, 1, 3);
    const tip = tooltipOf(chart);
    // A scheme a value makes with the text after it is checked: "javascript:"
    // is no link, and the value is written as text.
    expect(chart.pinned).toEqual({ value: 1, axis: "x", panel: "" });
    expect(tip.querySelector("a")).toBeNull();
    expect(tip.lastElementChild!.lastElementChild!.textContent).toBe("a b/c");
    chart.pin({ value: 0 });
    chart.render();
    const link = tip.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("https://traces.example.com/t/4bf92f35");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("noopener noreferrer");
    expect(link.textContent).toBe("Trace 4bf92f35");
    expect(tip.querySelectorAll("a")).toHaveLength(1);
    hover(chart, 0, 1);
    expect(hovers.at(-1)).toEqual({
      url: "https://traces.example.com/t/4bf92f35",
      text: "Trace 4bf92f35",
    });
    // A missing trace, or a data: URL, is no link.
    for (const at of [2, 3]) {
      chart.pin({ value: at });
      chart.render();
      expect(tip.querySelector("a")).toBeNull();
    }
    chart.pin(null);
    hover(chart, 0, 1);
    expect(tip.querySelector("a")).toBeNull();
    expect(tip.textContent).toContain("Trace 4bf92f35");
  });

  it("is reached from the keyboard, and keeps the focus as the content is drawn again", async () => {
    const rows = data();
    const chart = await mount({
      marks: [line(rows, { x: "t", y: "v", tooltip: { fields: ["trace"] } })],
    });
    chart.root.focus();
    key(chart.root, "ArrowRight");
    chart.render();
    key(chart.root, "Enter");
    chart.render();
    const tip = tooltipOf(chart);
    expect(document.activeElement).toBe(tip);
    // WebKit on macOS reaches links with Option-Tab, as Safari does.
    if (navigator.userAgent.includes("Safari") && !navigator.userAgent.includes("Chrome"))
      await userEvent.keyboard("{Alt>}{Tab}{/Alt}");
    else await userEvent.tab();
    const link = tip.querySelector("a")!;
    expect(document.activeElement).toBe(link);
    // The row's value changes: its link is drawn again, and the focus stays on it.
    rows.replace(0, { v: [2] });
    chart.render();
    const again = tip.querySelector("a")!;
    expect(again).not.toBe(link);
    expect(document.activeElement).toBe(again);
    key(again, "Escape");
    expect(chart.pinned).toBeNull();
    expect(document.activeElement).toBe(chart.root);
  });
});

describe("content of the application's own", () => {
  it("is not asked for again as the pin changes, nor when it gives the built-in content", async () => {
    for (const given of [null, "Details"]) {
      let calls = 0;
      const chart = await mount({
        fields: undefined,
        marks: [line(data(), { x: "t", y: "v" })],
        renderTooltip: () => {
          calls++;
          return given;
        },
      });
      hover(chart, 1, 3);
      expect(calls).toBe(1);
      click(chart, 1, 3);
      expect(chart.pinned).not.toBeNull();
      chart.pin(null);
      chart.render();
      expect(calls).toBe(1);
      chart.destroy();
    }
  });
});
