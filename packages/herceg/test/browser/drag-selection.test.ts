import { afterEach, expect, it } from "vitest";
import { table } from "../../src/data/table.ts";
import { type Chart, createChart } from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import { pageOrigin, realMouse } from "./helpers.ts";

const mounted: Chart[] = [];
const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const chart of mounted.splice(0)) chart.destroy();
  for (const host of hosts.splice(0)) host.remove();
  window.getSelection()?.removeAllRanges();
});

async function mount(pan = false) {
  const host = document.createElement("div");
  host.style.cssText = "width:400px;height:300px";
  document.body.append(host);
  hosts.push(host);
  const chart = createChart(host, {
    renderer: "svg",
    title: "Selectable chart title",
    interaction: { pan: pan ? "x" : false },
    marks: [line(table({ x: [0, 1, 2], y: [1, 3, 2] }), { x: "x", y: "y" })],
  });
  mounted.push(chart);
  await chart.loading;
  window.getSelection()?.removeAllRanges();
  return chart;
}

async function mouse(chart: Chart, type: "move" | "press" | "release", x: number, y: number) {
  const at = pageOrigin(chart.root);
  await realMouse({ type, x: at.x + x, y: at.y + y });
}

async function drag(chart: Chart, from: [number, number], to: [number, number]) {
  await mouse(chart, "move", ...from);
  await mouse(chart, "press", ...from);
  try {
    for (const t of [0.25, 0.5, 0.75, 1])
      await mouse(chart, "move", from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
  } finally {
    await mouse(chart, "release", ...to);
  }
}

it("pans without selecting page text", async () => {
  const chart = await mount(true);
  const { plot } = chart.getPanels()[0]!;
  await drag(
    chart,
    [plot.x + 10, plot.y + 10],
    [plot.x + plot.width - 10, plot.y + plot.height + 18],
  );
  expect(chart.getViewport().x).not.toBeNull();
  expect(window.getSelection()?.toString()).toBe("");
});

it("leaves a static chart's text selectable", async () => {
  const chart = await mount();
  const title = [...chart.root.querySelectorAll("text")].find(
    (el) => el.textContent === "Selectable chart title",
  )!;
  const bounds = title.getBoundingClientRect();
  const root = chart.root.getBoundingClientRect();
  const y = bounds.top - root.top + bounds.height / 2;
  await drag(chart, [bounds.left - root.left + 2, y], [bounds.right - root.left - 2, y]);
  expect(window.getSelection()?.toString()).toContain("electable chart titl");
  expect(chart.getViewport().x).toBeNull();
});

it("keeps focus and click events for a press without a drag", async () => {
  const chart = await mount(true);
  const clicks: unknown[] = [];
  chart.on("click", (event) => clicks.push(event));
  const { plot } = chart.getPanels()[0]!;
  const at: [number, number] = [plot.x + plot.width / 2, plot.y + plot.height / 2];
  await mouse(chart, "move", ...at);
  await mouse(chart, "press", ...at);
  await mouse(chart, "release", ...at);
  expect(document.activeElement).toBe(chart.root);
  expect(clicks).toHaveLength(1);
  expect(chart.getViewport().x).toBeNull();
});

it("keeps native legend clicks", async () => {
  const chart = await mount(true);
  chart.update({ legend: true });
  chart.render();
  const button = chart.root.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
  let press: PointerEvent | undefined;
  button.addEventListener("pointerdown", (event) => (press = event));
  const box = button.getBoundingClientRect();
  const root = chart.root.getBoundingClientRect();
  const at: [number, number] = [
    box.left - root.left + box.width / 2,
    box.top - root.top + box.height / 2,
  ];
  await mouse(chart, "move", ...at);
  await mouse(chart, "press", ...at);
  await mouse(chart, "release", ...at);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(button.getAttribute("aria-pressed")).toBe("false");
  expect(press?.defaultPrevented).toBe(false);
  expect(chart.getHiddenKeys()).toHaveLength(1);
});
