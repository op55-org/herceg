import "./interactive.ts";
import { afterEach, expect, it } from "vitest";
import { userEvent } from "vitest/browser";
import { MOUSE } from "../../../../scripts/browser/mouse.ts";
import { table } from "../../src/data/table.ts";
import { type Chart, type ChartOptions, createChart } from "../../src/dom/chart.ts";
import { line } from "../../src/marks/line.ts";
import { rangeNavigator } from "../../src/model/navigator.ts";
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

// Bug: a press that took the focus itself (a drag's, which keeps the
// press's default) made `:focus-visible` match, so a ring showed after it.
it("draws no focus ring after a press, until a key; Tab draws it", async () => {
  /** Whether `element` draws a focus ring: browsers' rings for focus are outlines. */
  const ring = (element: HTMLElement) => getComputedStyle(element).outlineStyle !== "none";
  for (const press of ["brush", "pan", "click"] as const) {
    const host = document.createElement("div");
    host.style.cssText = "width:400px;height:300px";
    document.body.append(host);
    hosts.push(host);
    const chart = createChart(host, {
      renderer: "svg",
      interaction: press === "brush" ? { brush: "xy" } : { pan: press === "pan" ? "x" : false },
      marks: [line(table({ x: [0, 1, 2], y: [1, 3, 2] }), { x: "x", y: "y" })],
    });
    mounted.push(chart);
    await chart.loading;
    const { plot } = chart.getPanels()[0]!;
    const from: [number, number] = [plot.x + 40, plot.y + 40];
    if (press === "click") {
      await mouse(chart, "move", ...from);
      await mouse(chart, "press", ...from);
      await mouse(chart, "release", ...from);
    } else await drag(chart, from, [plot.x + 120, plot.y + 100]);
    expect(document.activeElement, press).toBe(chart.root);
    expect(ring(chart.root), `${press}: no ring after the press`).toBe(false);
    // A modifier held for the next press is no keyboard use; an arrow key is.
    await userEvent.keyboard("{Shift}");
    expect(ring(chart.root), `${press}: none after Shift`).toBe(false);
    await userEvent.keyboard("{ArrowRight}");
    expect(ring(chart.root), `${press}: a ring once a key is pressed`).toBe(true);
    // A press on the chart it focused already puts the pointer in use again.
    await mouse(chart, "press", ...from);
    await mouse(chart, "release", ...from);
    expect(ring(chart.root), `${press}: no ring after another press`).toBe(false);
    await userEvent.keyboard("{ArrowLeft}");
    expect(ring(chart.root), `${press}: a ring after the next key`).toBe(true);
    chart.root.blur();
    expect(chart.root.style.outlineStyle, press).toBe("");
    expect(chart.root.getAttribute("data-herceg-focus"), press).toBe("");
  }
  // Tab, from an element before the chart, draws the ring at once.
  const before = document.createElement("button");
  document.body.prepend(before);
  try {
    before.focus();
    await userEvent.keyboard("{Tab}");
    const root = mounted[0]!.root;
    expect(document.activeElement).toBe(root);
    expect(ring(root)).toBe(true);
    // Dragged once it has the focus by the keyboard, it draws none.
    const { plot } = mounted[0]!.getPanels()[0]!;
    await drag(mounted[0]!, [plot.x + 40, plot.y + 40], [plot.x + 120, plot.y + 100]);
    expect(document.activeElement).toBe(root);
    expect(ring(root)).toBe(false);
  } finally {
    before.remove();
  }
});

// Bug: the focus a press gave an application's control, in a shadow root
// under the chart, kept the outline the chart had left out once the
// focus moved in that shadow root, where the chart heard nothing.
it("leaves the focus rings of the application's controls in the chart to the page", async () => {
  const chart = await mount();
  const holder = document.createElement("div");
  holder.style.cssText = "position:absolute;left:10px;top:10px";
  chart.root.append(holder);
  const [first, second] = [document.createElement("input"), document.createElement("input")];
  holder.attachShadow({ mode: "open" }).append(first, second);
  const box = first.getBoundingClientRect();
  const root = chart.root.getBoundingClientRect();
  const at: [number, number] = [box.left - root.left + 5, box.top - root.top + box.height / 2];
  await mouse(chart, "move", ...at);
  await mouse(chart, "press", ...at);
  await mouse(chart, "release", ...at);
  expect(holder.shadowRoot!.activeElement).toBe(first);
  second.focus();
  first.focus();
  // A text field draws its ring whatever focused it.
  for (const input of [first, second]) {
    expect(input.style.cssText).toBe("");
    expect(input.getAttributeNames()).toEqual([]);
  }
  expect(getComputedStyle(first).outlineStyle).not.toBe("none");
});

// Bug: the outline left out after a press was given back as its longhand,
// which lost a shorthand of the page's (one of a variable, here).
it("keeps the outline the page gives the chart through presses, keys, and blur", async () => {
  const chart = await mount(true);
  const { style } = chart.root;
  style.setProperty("--o", "5px dashed rgb(255, 0, 0)");
  style.setProperty("outline", "var(--o)");
  const kept = (step: string) => {
    expect(style.getPropertyValue("outline"), step).toBe("var(--o)");
    expect(getComputedStyle(chart.root).outlineStyle, step).toBe("dashed");
  };
  const { plot } = chart.getPanels()[0]!;
  await drag(chart, [plot.x + 40, plot.y + 40], [plot.x + 120, plot.y + 100]);
  expect(document.activeElement).toBe(chart.root);
  kept("after a press");
  await userEvent.keyboard("{ArrowRight}");
  kept("after a key");
  chart.root.blur();
  kept("after blur");
  await drag(chart, [plot.x + 40, plot.y + 40], [plot.x + 120, plot.y + 100]);
  chart.destroy();
  mounted.splice(mounted.indexOf(chart), 1);
  expect(style.getPropertyValue("outline"), "once destroyed").toBe("var(--o)");
});

// Bug: where the browser drew no ring after a key (Firefox, for the focus
// a click gives), the chart drew its own over the outline the page gives.
it("draws the page's outline after a key, not the browser's ring", async () => {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(".dotted:focus { outline: 5px dotted rgb(255, 0, 0) !important }");
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  try {
    for (const [outline, style] of [
      ["inline", "dashed"],
      ["sheet", "dotted"],
    ] as const) {
      const chart = await mount();
      if (outline === "inline") chart.root.style.outline = "5px dashed rgb(255, 0, 0)";
      else chart.root.classList.add("dotted");
      const declared = chart.root.style.cssText;
      const { plot } = chart.getPanels()[0]!;
      await mouse(chart, "move", plot.x + 40, plot.y + 40);
      await mouse(chart, "press", plot.x + 40, plot.y + 40);
      await mouse(chart, "release", plot.x + 40, plot.y + 40);
      expect(document.activeElement, outline).toBe(chart.root);
      await userEvent.keyboard("{ArrowRight}");
      expect(getComputedStyle(chart.root).outlineStyle, outline).toBe(style);
      expect(chart.root.style.cssText, outline).toBe(declared);
    }
  } finally {
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  }
});

/** Page styles that take the outline off focus, keeping (or not) one for `:focus-visible`. */
const RESETS = [
  ":focus { outline: none } :focus-visible { outline: 2px solid rgb(0, 0, 255) }",
  ":focus:not(:focus-visible) { outline: none }",
];

// Bug: the ring a key asks for where the browser draws none weighed
// nothing, so a page's `:focus` reset took it off again.
it("draws a ring for a key after a click under a page's focus reset", async () => {
  for (const reset of RESETS) {
    const style = document.createElement("style");
    style.textContent = reset;
    document.head.append(style);
    try {
      const chart = await mount();
      const { plot } = chart.getPanels()[0]!;
      await mouse(chart, "move", plot.x + 40, plot.y + 40);
      await mouse(chart, "press", plot.x + 40, plot.y + 40);
      await mouse(chart, "release", plot.x + 40, plot.y + 40);
      expect(document.activeElement, reset).toBe(chart.root);
      await userEvent.keyboard("{ArrowRight}");
      expect(getComputedStyle(chart.root).outlineStyle, reset).not.toBe("none");
    } finally {
      style.remove();
    }
  }
});

// Bugs: a chart in a frame, made by the page around it, made its rules in
// the page's window, which the frame's document cannot adopt; kept them for
// the frame's window, which outlives the documents it navigates through;
// and took its navigator's sliders, elements of the frame's window, for
// none of its own.
it("draws no ring after a press on a chart a frame holds, made by the page around it", async () => {
  const frame = document.createElement("iframe");
  frame.style.cssText = "border:0;width:420px;height:320px";
  const loaded = () =>
    new Promise<void>((resolve) => frame.addEventListener("load", () => resolve(), { once: true }));
  const first = loaded();
  document.body.append(frame);
  hosts.push(frame);
  await first;
  const mountIn = async (options: Partial<ChartOptions>) => {
    const inner = frame.contentDocument!;
    inner.body.style.margin = "0";
    const host = inner.createElement("div");
    host.style.cssText = "width:400px;height:300px";
    inner.body.append(host);
    const chart = createChart(host, {
      renderer: "svg",
      marks: [line(table({ x: [0, 1, 2], y: [1, 3, 2] }), { x: "x", y: "y" })],
      ...options,
    });
    mounted.push(chart);
    await chart.loading;
    return chart;
  };
  // Firefox's and WebKit's input waits for events in the test's own frame:
  // the press is dispatched in the frame's window, the key typed. The ring
  // of what the press focused, after it and after the key.
  const pressThenKey = async (target: Element, x: number, y: number) => {
    const view = frame.contentWindow as Window & typeof globalThis;
    for (const type of ["pointerdown", "pointerup"])
      target.dispatchEvent(
        new view.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          clientX: x,
          clientY: y,
          pointerId: MOUSE,
          pointerType: "mouse",
          isPrimary: true,
          button: 0,
          buttons: type === "pointerdown" ? 1 : 0,
        }),
      );
    const focused = frame.contentDocument!.activeElement;
    const ring = () => view.getComputedStyle(focused!).outlineStyle !== "none";
    const pressed = ring();
    await userEvent.keyboard("{ArrowRight}");
    return { focused, rings: [pressed, ring()] };
  };
  for (const which of ["the frame's first document", "the next one it navigates to"]) {
    if (mounted.length > 0) {
      for (const chart of mounted.splice(0)) chart.destroy();
      const next = loaded();
      frame.srcdoc = "<!doctype html><body></body>";
      await next;
    }
    const chart = await mountIn({ interaction: { pan: "x" } });
    const box = chart.root.getBoundingClientRect();
    const { plot } = chart.getPanels()[0]!;
    const { focused, rings } = await pressThenKey(
      chart.root,
      box.left + plot.x + 40,
      box.top + plot.y + 40,
    );
    expect(focused, which).toBe(chart.root);
    expect(rings, `${which}: no ring after the press, one after a key`).toEqual([false, true]);
  }
  const chart = await mountIn({ navigator: rangeNavigator() });
  const shown = chart.root.querySelector('[role="slider"][aria-label="Shown range"]')!;
  const box = shown.getBoundingClientRect();
  const { focused, rings } = await pressThenKey(
    shown,
    box.left + box.width / 2,
    box.top + box.height / 2,
  );
  expect(focused, "the navigator's window").toBe(shown);
  expect(rings, "the navigator's window").toEqual([false, true]);
});
