// herceg/web's fragments: hosts mounted once from a payload, given, held,
// or fetched; unmounted with their fetch aborted; observed as a page inserts,
// moves, and removes them; and what they tell the page as DOM events.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MountedChart } from "../../src/dom/chart.ts";
import { ChartError } from "../../src/spec/errors.ts";
import type { ChartSpec } from "../../src/spec/spec.ts";
import { getChart, mount, unmount } from "../../src/web/mount.ts";
import { observe } from "../../src/web/observe.ts";
import { encodePayload } from "../../src/web/payload.ts";

const spec: ChartSpec = {
  width: 400,
  height: 200,
  renderer: "svg",
  interaction: { brush: "x" },
  data: { d: { columns: { x: [0, 1, 2, 3], y: [1, 3, 2, 4] } } },
  marks: [{ type: "line", x: "x", y: "y", data: "d" }],
};

let page: HTMLDivElement;
let heard: { type: string; detail: unknown; target: EventTarget | null }[];
const listen = (event: Event) =>
  heard.push({ type: event.type, detail: (event as CustomEvent).detail, target: event.target });
const TYPES = ["ready", "error", "click", "select", "viewport"].map((type) => `herceg:${type}`);

beforeEach(() => {
  page = document.createElement("div");
  document.body.append(page);
  heard = [];
  for (const type of TYPES) document.addEventListener(type, listen);
});

afterEach(() => {
  for (const type of TYPES) document.removeEventListener(type, listen);
  page.remove();
});

/** A fragment host, as herceg.web.fragment writes one, holding `held` as its payload. */
function host(id: string, held?: object): HTMLDivElement {
  const element = document.createElement("div");
  element.id = id;
  element.setAttribute("data-herceg", "");
  element.dataset.hercegHeight = "200";
  element.innerHTML = `<style data-herceg-style>#${id}{height:200px}</style><div data-herceg-fallback><p>Chart not loaded yet</p></div>`;
  if (held) {
    const template = document.createElement("template");
    template.setAttribute("data-herceg-payload", "");
    template.content.textContent = JSON.stringify(held);
    element.append(template);
  }
  return element;
}

const inline = { protocol: 1, kind: "chart", spec, buffers: [] };
const tick = () => new Promise((resolve) => setTimeout(resolve));

describe("fragments", () => {
  it("mount once from a payload, sized and told ready", async () => {
    const element = host("a");
    page.append(element);
    const mounting = mount(element, { src: encodePayload(spec) });
    expect(mount(element)).toBe(mounting);
    const chart = await mounting;
    expect(getChart(element)).toBe(chart);
    expect(element.querySelector("style")).toBeNull();
    expect(element.style.height).toBe("200px");
    expect(element.querySelector<HTMLElement>("[data-herceg-fallback]")!.hidden).toBe(true);
    expect(element.querySelectorAll("[data-herceg-runtime]")).toHaveLength(1);
    expect(heard).toEqual([{ type: "herceg:ready", detail: { id: "a" }, target: element }]);
  });

  it("tell the page of views and selections as JSON", async () => {
    const element = host("b");
    page.append(element);
    const chart = await mount(element, { src: encodePayload(spec) });
    chart.setViewport({ x: [1, 2] });
    chart.select({ x: [0.5, 1.5], y: null, lasso: null });
    chart.select(null);
    expect(heard.slice(1).map(({ type, detail }) => [type, detail])).toEqual([
      ["herceg:viewport", { id: "b", viewport: { x: [1, 2], y: null, yRight: null, time: [] } }],
      ["herceg:select", { id: "b", selection: { x: [0.5, 1.5], y: null, lasso: null, time: [] } }],
      ["herceg:select", { id: "b", selection: null }],
    ]);
  });

  it("unmount at once, a fetch under way aborted, and mount again", async () => {
    const element = host("c");
    page.append(element);
    const url = URL.createObjectURL(new Blob([encodePayload(spec)]));
    const mounting = mount(element, { src: url });
    unmount(element);
    unmount(element);
    await expect(mounting).rejects.toMatchObject({ name: "AbortError" });
    expect(getChart(element)).toBeUndefined();
    expect(element.querySelector("[data-herceg-runtime]")).toBeNull();
    expect(element.querySelector<HTMLElement>("[data-herceg-fallback]")!.hidden).toBe(false);
    await tick();
    expect(heard).toEqual([]);
    // A chart drawn is destroyed: it leaves the page.
    const chart = await mount(element, { src: url });
    expect(chart.root.isConnected).toBe(true);
    unmount(element);
    expect(chart.root.isConnected).toBe(false);
    URL.revokeObjectURL(url);
  });

  it("show what is not a payload in their place, and tell the page once", async () => {
    const element = host("d");
    page.append(element);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = mount(element, { src: new TextEncoder().encode("<!doctype html>") });
    await expect(failure).rejects.toBeInstanceOf(ChartError);
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
    expect(element.querySelector('[role="alert"]')!.textContent).toBe(
      'Chart could not be rendered\npayload: the response is not a Herceg payload (it starts with "<!doctype"); return herceg.web.payload(chart) from the data_url route',
    );
    expect(element.querySelector<HTMLElement>("[data-herceg-fallback]")!.hidden).toBe(true);
    expect(heard.map(({ type, detail }) => [type, detail])).toEqual([
      [
        "herceg:error",
        {
          id: "d",
          error: expect.objectContaining({ code: "load-failed", phase: "load" }),
        },
      ],
    ]);
  });

  it("tell of a spec the chart refuses once, and keep it from the console when asked", async () => {
    const element = host("e");
    page.append(element);
    const quiet = (event: Event) => event.preventDefault();
    document.addEventListener("herceg:error", quiet);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // A line colored by a name both a field and a color: the feature compiler refuses it.
    const refused: ChartSpec = {
      data: { d: { columns: { t: [0, 1], v: [1, 2], red: ["a", "b"] } } },
      marks: [{ type: "line", x: "t", y: "v", color: "red", data: "d" }],
    };
    await expect(mount(element, { src: encodePayload(refused) })).rejects.toThrow(
      /names both a field and a color/,
    );
    document.removeEventListener("herceg:error", quiet);
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
    expect(heard.filter(({ type }) => type === "herceg:error")).toHaveLength(1);
    // The chart exists, showing why it cannot draw.
    expect(getChart(element)).toBeDefined();
  });
});

describe("fragments unmounted at awkward moments", () => {
  it("destroy a chart that a listener of its first error unmounted while it was made", async () => {
    const element = host("i");
    page.append(element);
    const destroyed = vi.spyOn(MountedChart.prototype, "destroy");
    const leave = () => unmount(element);
    document.addEventListener("herceg:error", leave);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // Two marks of one id: refused as the chart is made.
    const twice: ChartSpec = {
      ...spec,
      marks: [
        { type: "line", x: "x", y: "y", data: "d", id: "a" },
        { type: "line", x: "x", y: "y", data: "d", id: "a" },
      ],
    };
    await expect(mount(element, { src: encodePayload(twice) })).rejects.toMatchObject({
      name: "AbortError",
    });
    document.removeEventListener("herceg:error", leave);
    logged.mockRestore();
    expect(destroyed).toHaveBeenCalledOnce();
    destroyed.mockRestore();
    expect(getChart(element)).toBeUndefined();
    expect(element.querySelector("[data-herceg-runtime]")).toBeNull();
  });

  it("tell nothing of a chart unmounted as its first frame is drawn", async () => {
    const element = host("j");
    page.append(element);
    const mounting = mount(element, { src: encodePayload(spec) });
    // The chart is made a few microtasks in, its first frame drawn as it is:
    // `ready` has settled, and what resolves the mount is queued.
    while (!getChart(element)) await Promise.resolve();
    unmount(element);
    await expect(mounting).rejects.toMatchObject({ name: "AbortError" });
    await tick();
    expect(heard).toEqual([]);
  });
});

describe("observing a page", () => {
  it("mounts hosts present and inserted, keeps moved ones, and unmounts removed ones", async () => {
    page.append(host("f", inline));
    const stop = observe(page);
    const inserted = host("g", inline);
    page.append(inserted);
    await tick();
    await vi.waitFor(() =>
      expect(heard.filter(({ type }) => type === "herceg:ready")).toHaveLength(2),
    );
    const first = page.querySelector("#f")!;
    const chart = getChart(first)!;
    // Moved within the page: the same chart.
    page.append(first);
    await tick();
    expect(getChart(first)).toBe(chart);
    // Removed: unmounted.
    inserted.remove();
    await tick();
    expect(getChart(inserted)).toBeUndefined();
    // Markup restored with a drawing in it is mounted afresh.
    const saved = page.innerHTML;
    page.innerHTML = saved;
    await tick();
    expect(getChart(first)).toBeUndefined();
    const restored = page.querySelector("#f")!;
    await vi.waitFor(() => expect(getChart(restored)).toBeDefined());
    expect(restored.querySelectorAll("[data-herceg-runtime]")).toHaveLength(1);
    // A host whose content is replaced in place (an HTMX innerHTML swap of
    // it, or a restore with it as the history element) is mounted afresh.
    const before = getChart(restored)!;
    const content = restored.innerHTML;
    restored.innerHTML = content;
    await tick();
    expect(before.root.isConnected).toBe(false);
    await vi.waitFor(() => expect(getChart(restored)).toBeDefined());
    expect(getChart(restored)).not.toBe(before);
    expect(restored.querySelectorAll("[data-herceg-runtime]")).toHaveLength(1);
    // Stopping unmounts what it mounted.
    stop();
    expect(getChart(restored)).toBeUndefined();
  });

  it.each([
    ["the destination's first", ["b", "a"]],
    ["the source's first", ["a", "b"]],
  ] as const)("keeps the chart of a host moved between observed roots, %s", async (_, order) => {
    const roots = { a: document.createElement("div"), b: document.createElement("div") };
    page.append(roots.a, roots.b);
    const moving = host("k", inline);
    roots.a.append(moving);
    const stops = order.map((name) => observe(roots[name]));
    await vi.waitFor(() => expect(getChart(moving)).toBeDefined());
    const chart = getChart(moving)!;
    roots.b.append(moving);
    await tick();
    expect(getChart(moving)).toBe(chart);
    expect(chart.root.isConnected).toBe(true);
    // The destination's observer owns it now: stopping it unmounts it.
    stops[order.indexOf("b")]!();
    expect(getChart(moving)).toBeUndefined();
    stops[order.indexOf("a")]!();
  });

  it.each([
    ["the destination's first", ["b", "a"]],
    ["the source's first", ["a", "b"]],
  ] as const)(
    "mounts afresh a host moved between observed roots and given new content at once, %s",
    async (_, order) => {
      const roots = { a: document.createElement("div"), b: document.createElement("div") };
      page.append(roots.a, roots.b);
      const moving = host("l", inline);
      roots.a.append(moving);
      const stops = order.map((name) => observe(roots[name]));
      await vi.waitFor(() => expect(getChart(moving)).toBeDefined());
      const before = getChart(moving)!;
      roots.b.append(moving);
      moving.innerHTML = host("l", inline).innerHTML;
      await vi.waitFor(() => expect(getChart(moving)).toBeDefined());
      expect(getChart(moving)).not.toBe(before);
      expect(before.root.isConnected).toBe(false);
      expect(moving.querySelectorAll("[data-herceg-runtime]")).toHaveLength(1);
      for (const stop of stops) stop();
      expect(getChart(moving)).toBeUndefined();
    },
  );

  it("watches roots within roots once", async () => {
    const inner = document.createElement("div");
    page.append(inner);
    const nested = host("m", inline);
    inner.append(nested);
    const stopPage = observe(page);
    const stopInner = observe(inner);
    await vi.waitFor(() => expect(getChart(nested)).toBeDefined());
    const first = getChart(nested)!;
    nested.innerHTML = host("m", inline).innerHTML;
    await vi.waitFor(() => expect(getChart(nested)).not.toBe(first));
    expect(nested.querySelectorAll("[data-herceg-runtime]")).toHaveLength(1);
    await tick();
    expect(heard.filter(({ type }) => type === "herceg:ready")).toHaveLength(2);
    // The page's root still holds it once the inner one is let go.
    stopInner();
    expect(getChart(nested)).toBeDefined();
    stopPage();
    expect(getChart(nested)).toBeUndefined();
  });

  it("leaves the page's own charts mounted when it stops, and unmounts them when removed", async () => {
    const own = host("n");
    const found = host("o", inline);
    page.append(own, found);
    const chart = await mount(own, { src: encodePayload(spec) });
    const stop = observe(page);
    await vi.waitFor(() => expect(getChart(found)).toBeDefined());
    stop();
    expect(getChart(own)).toBe(chart);
    expect(chart.root.isConnected).toBe(true);
    expect(getChart(found)).toBeUndefined();
    // Observed again, a host the page mounted goes with its element.
    const again = observe(page);
    own.remove();
    await tick();
    expect(getChart(own)).toBeUndefined();
    expect(chart.root.isConnected).toBe(false);
    again();
  });

  it("tells of a host without a payload", async () => {
    const empty = host("h");
    page.append(empty);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const stop = observe(page);
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    logged.mockRestore();
    expect(heard[0]!.detail).toMatchObject({
      id: "h",
      error: {
        code: "load-failed",
        message:
          'fragment "h": it holds no payload and names none to fetch; make it with herceg.web.fragment(chart)',
      },
    });
    stop();
  });
});
